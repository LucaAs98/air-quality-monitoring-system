/** Inizializzazione NODEJS **/
require('dotenv').config();
let variables = process.env
const pointCreation = require("./receiver")
const express = require("express");
const open = require('open');
const app = express();

app.set('views', __dirname + '/');
app.engine('html', require('ejs').renderFile);
app.set('view engine', 'ejs');

app.use(express.urlencoded());
app.use(express.static(__dirname));
app.use(express.json());

/* Stiamo in ascolto su "localhost:3000". */
app.listen(3000, () => {
    console.log("Application started and Listening on port 3000");
});

/** Inizializzazione FIREBASE **/
let admin = require("firebase-admin");
let serviceAccount = require("./progettoiot2022-firebase-adminsdk-hoxdu-085c6305e8.json");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://progettoiot2022-default-rtdb.europe-west1.firebasedatabase.app"
});
let db = admin.firestore();

/** Inizializzazione MQTT **/
const mqtt = require('mqtt')
const host = variables.HOST_MQTT
const port = variables.PORT_MQTT
const connectUrl = `mqtt://${host}:${port}`
const clientMQTT = mqtt.connect(connectUrl, {
    clean: true,
    connectTimeout: 4000,
    username: variables.USERNAME_MQTT,
    password: variables.PASSWORD_MQTT,
    reconnectPeriod: 1000,
})
const topics = ["device/parameters/"]   //Topic per inviare all'esp i parametri da cambiare.

/** Inizializzazione INFLUXDB **/
const token = variables.TOKEN_INFLUX
const url = variables.URL_INFLUX
const {InfluxDB, Point} = require('@influxdata/influxdb-client')
const clientInflux = new InfluxDB({url, token})
let org = variables.ORG_INFLUX
let bucket = variables.BUCKET_INFLUX
let queryClient = clientInflux.getQueryApi(org)

//CoAP
const coap = require('coap')
const CronJob = require('cron').CronJob;
const CronTime = require('cron').CronTime;
//mappa lista dei job attivi
let mapJobs = new Map()


let arrayESP32 = [];

/*** Richieste GET ***/
/* Ad URL "/home" rendirizziamo "home.html". Questo a sua volta chiamerà lo script "home.js". */
app.get("/home", (req, res) => {
    res.render("home.html");
});

/* Ad URL "/devices" chiediamo di prendere tutti i device registrati su firebase. */
app.get("/devices", async (req, res) => {
    let errore;
    let response = await getDevices().catch((err) => errore = err);

    if (!response) {
        console.log('Error, i cannot load the devices.' + '\n' + errore);
    } else {
        res.json(response);     //Se tutto va bene li restituiamo
    }
});

/* Ad URL "/get_influx_data" chiediamo di prendere i dati da influxdB. */
app.get("/get_influx_data", async (req, res) => {
    let fluxQuery =
        `from(bucket: "${variables.BUCKET_INFLUX}")
                |> range(start: -10d)
                |> group(columns: ["id", "_field"])
                |> mean()`

    //Salviamo in "data" tutti i dati che ci servono da influx
    let data = []

    //Scorriamo tutti i risultati della query
    await queryClient.queryRows(fluxQuery, {
        next: (row, tableMeta) => {
            const tableObject = tableMeta.toObject(row)
            data.push(tableObject)
        },
        error: (error) => {
            console.log('Error, i cannot load influx data.' + ' -> ' + error);
        },
        //Quando abbiamo completato formattiamo i dati come vogliamo e li restituiamo
        complete: () => {
            data = influxDataFormat(data)
            res.json(data);
        },
    })
});

/*** Richieste POST **/

//A richiesta post della home renidirizziamo l'html
app.post("/home", (req, res) => {
    res.render("home.html");
});

//Inviamo il nuovo device a firebase
app.post("/add_device", async (req, res) => {
    const id = req.body.id
    const data = {
        max_gas_value: req.body.max_gas_value,
        min_gas_value: req.body.min_gas_value,
        protocol: req.body.protocol.trim(),
        sample_frequency: req.body.sample_frequency,
    };

    //Creaimo un doc chiamato con l'id e salviamo all'interno di esso tutti i dati relativi a quel determinato device
    const request = await db.collection('device').doc(id).set(data)
    data.id = id;
    sendNewParameters(data)
});

//Inviamo l'update del device
app.post("/update_device", async (req, res) => {
    const id = req.body.id
    const data = {
        max_gas_value: req.body.max_gas_value,
        min_gas_value: req.body.min_gas_value,
        protocol: req.body.protocol.trim(),
        sample_frequency: req.body.sample_frequency,
    };

    //Aggiorniamo il device a quel determinato id
    const request = await db.collection('device').doc(id).update(data)
    data.id = req.body.id;
    arrayESP32.filter(obj => obj.id === id)[0] = data;

    //Dopo aver aggiornato i dati su firestore andiamo a comunicarli anche all'esp32
    sendNewParameters(data);


    let coapOp = parseInt(req.body.cop)

    switch (coapOp) {
        case 0:
            if (!mapJobs.has(id))
                createCoAPJob(id, data.sample_frequency)
            break;
        case 1:
            if (mapJobs.has(id)) {
                mapJobs.get(id).stop()
                mapJobs.delete(id)
            }
            break;
        default:
            console.log('Stringa!')
    }
    res.end();
});

function createCoAPJob(id, sF) {
    let sampleFrequency = parseInt(sF)
    console.log("Creazione Job per -> " + id)
    let d = new Date()
    d.setMilliseconds(d.getMilliseconds() + sampleFrequency)
    let job = new CronJob(createCronTimeString(d), async function () {
        let g = new Date()
        //Calcolo e settaggio del prossimo tempo di esecuzione
        g.setMilliseconds(g.getMilliseconds() + sampleFrequency)
        this.setTime(new CronTime(createCronTimeString(g)))
        await coapRequest(id);
    });
    //Start del job
    console.log("Avvio Job di -> " + id)
    job.start();
    //Aggiunta del job ala mappa di quelli attivi
    mapJobs.set(id, job)
}

//Crea la stringa per il tempo per cron
function createCronTimeString(d) {
    let seconds = d.getSeconds()
    let minutes = d.getMinutes()
    let hours = d.getHours()

    return seconds + ' ' + minutes + ' ' + hours + ' * * *'
}

async function coapRequest(id) {
    let obj = arrayESP32.filter(obj => obj.id === id)[0]

    if (obj !== undefined) {
        let broker_address = obj.ip

        if (broker_address !== undefined) {
            var options = {
                host: broker_address,
                port: 5683,
                pathname: "/sensordata",
                method: 'GET',
                confirmable: true,
                options: {
                    'Content-Format': 'application/json'
                }
            }

            let req = await coap.request(options)
            let jsonData

            req.on('response', function (res) {
                if (res.code !== '2.05') return console.log("CoAP Error!");

                res.on('data', function () {
                    jsonData = JSON.parse(res.payload)
                });
                res.on('end', async function () {
                    if (res.code === '2.05') {
                        console.log("COAP " + id + " -> " + JSON.stringify(jsonData))
                        await pointCreation(jsonData)
                    } else {
                        console.log('[coap] coap res.code=' + res.code);
                    }
                });
            })
            req.end();
        } else {
            console.log("Non ho a disposizione l'ip del dispositivo " + id + "!")
        }
    } else {
        console.log("Il dispositivo non è presente nel database!")
    }
}


//Rimuoviamo un device togliendolo da firestore in modo tale da non poterlo più visualizzare nella webpage
app.post("/remove_device", async (req, res) => {
    const request = await db.collection('device').doc(req.body.id).delete()
    if (mapJobs.has(req.body.id)) {
        mapJobs.get(req.body.id).stop()
        mapJobs.delete(req.body.id)
    }
    //Segnaliamo all'esp che è stato rimosso dal db
    let parameters = {
        id: req.body.id,
        max_gas_value: 0,
        min_gas_value: 0,
        sample_frequency: 1000,
        protocol: "UNDEFINED"
    }
    sendNewParameters(parameters)
    res.end()
})

//Riceviamo i dati tramite HTTP dall'esp, creiamo quindi il punto e lo spediamo ad InfluxDB
app.post('/sensordata', async function (req, res) {
    let message = req.body
    console.log("HTTP " + req.body.i + " -> " + JSON.stringify(req.body))
    await pointCreation(message)
    res.end();
});

//Riceviamo la richiesta di inizializzazione da parte dell'esp
app.post('/initialize', async function (req, res) {
    let message = req.body
    console.log("Richiesta inizializzazione da parte di -> " + message.ip)
    let parameters = arrayESP32.filter(obj => obj.id === message.id)[0]

    if (parameters !== undefined) {
        parameters.ip = message.ip;
        //Aggiorniamo il device a quel determinato id aggiungendo l'ip
        await db.collection('device').doc(parameters.id).update({ip: parameters.ip})
        arrayESP32.filter(obj => obj.id === parameters.id)[0] = parameters.ip;
        parameters.id = message.id
        sendNewParameters(parameters)
        res.end()
    } else {
        console.log("Il dispositivo " + message.id + " non è stato ancora registrato!")
        res.sendStatus(501)
    }
});


//Metodo che prende tutti i device da firebase
async function getDevices() {
    const devicesCollection = await db.collection('device').get();
    arrayESP32 = []

    //Per ognuno di essi assegnamo tutti i parametri necessari.
    devicesCollection.forEach((result) => {
        let resD = result.data()
        let data = {
            id: result.id,
            max_gas_value: resD.max_gas_value,
            min_gas_value: resD.min_gas_value,
            sample_frequency: resD.sample_frequency,
            protocol: resD.protocol.trim(),
            lat: 44.490931818740,
            long: 11.35460682369
        }
        if (resD.ip !== undefined) {
            data.ip = resD.ip
        }

        arrayESP32.push(data)

        if (resD.protocol === 'COAP') {
            if (!mapJobs.has(result.id)) {
                createCoAPJob(result.id, resD.sample_frequency)
            }
        }
    })

    //Restituiamo tutti i device
    return arrayESP32
}

//Funzione che crea il messagio da inviare all'esp32
function createMessage(protocol, sample_frequency, max_gas_value, min_gas_value) {
    return '{ \"protocol\": \"' + getProtocol(protocol) + '\",' +
        '\"sample_frequency\":' + sample_frequency + ',' +
        '\"max_gas_value\":' + max_gas_value + ',' +
        '\"min_gas_value\":' + min_gas_value + '}'
}

/* Funzione che dato il protocollo in stringa restituisce il suo numero corrispondente. Abbiamo fatto questo per prenderlo
* più semplicemente dall'esp32 occupando anche meno memoria. */
function getProtocol(protocol) {
    switch (protocol.trim()) {
        case "MQTT":
            return 0;
        case "HTTP":
            return 1;
        case "COAP":
            return 2;
        default:
            return 3;
    }
}

//Formattiamo i dati di influx come vogliamo per poterli usare nel nostro codice
function influxDataFormat(data) {
    let newData = []
    data.forEach(obj =>
        newData.push({
            id: obj.id,
            field: obj._field,
            value: obj._value,
        }))
    return newData
}

function sendNewParameters(data) {
    clientMQTT.publish(topics[0] + data.id, createMessage(data.protocol, data.sample_frequency, data.max_gas_value, data.min_gas_value), {
        qos: 0,
        retain: false
    }, (error) => {
        if (error) {
            console.error(error)
        } else {
            console.log("Dati inviati all'esp -> " + data.id)
        }
    })
}

// All'avvio apriamo la home con il browser di default.
open("http://localhost:3000/home");