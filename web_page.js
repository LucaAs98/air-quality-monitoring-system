/** Inizializzazione NODEJS **/
require('dotenv').config();
let variables = process.env
const express = require("express");
const open = require('open');
const app = express();
const sendAlerts = require("./telegram/index")
const {pointCreation, changeSwitchFlag} = require("./receiver")
const {createDeviceMessage, influxDataFormat} = require("./utils")
const axios = require("axios");

app.set('views', __dirname + '/');
app.engine('html', require('ejs').renderFile);
app.set('view engine', 'ejs');

app.use(express.urlencoded());
app.use(express.static(__dirname));
app.use(express.json());

/** Inizializzazione FIREBASE **/
let admin = require("firebase-admin");
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
let mapJobs = new Map()     //Mappa lista dei job attivi

//Contiene gli esp presenti su firebase
let arrayESP32 = [];

//Flag delay da segnalare all'esp
let delayFlag = 0;
let forecastFlag = false;

/* Stiamo in ascolto su "localhost:3000". */
app.listen(3000, () => {
    console.log("Application started and Listening on port 3000");
});

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
        `from(bucket: "${bucket}")
                |> range(start: -1d)
                |> filter(fn: (r) => r["_field"] != "_message")
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

/* Ad URL "/get_flags_values" inviamo alla home i valori degli switch delay e forecast. */
app.get("/get_flags_values", async (req, res) => {
    res.json({delay: delayFlag, forecast: forecastFlag});     //Se tutto va bene li restituiamo
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
        prima_richiesta: true,  //Serve per non far partire subito il conteggio dei delay di coap quando cambia protocollo
    };

    //Aggiorniamo il device a quel determinato id
    const request = await db.collection('device').doc(id).update(data)
    data.id = req.body.id;
    arrayESP32.filter(obj => obj.id === id)[0] = data;

    //Dopo aver aggiornato i dati su firestore andiamo a comunicarli anche all'esp32
    sendNewParameters(data);

    //Prendiamo quale operazione coap dobbiamo effettuare dopo l'aggiornamento dei parametri
    let coapOp = parseInt(req.body.cop)

    //Scegliamo quale operazione effettuare
    switch (coapOp) {
        case 0:     //Crea nuovo Job (Passato da qualcos'altro a COAP)
            if (!mapJobs.has(id))
                createCoAPJob(id, data.sample_frequency)
            break;
        case 1:     //Stoppa Job (Passato da coap a qualcos'altro)
            if (mapJobs.has(id)) {
                mapJobs.get(id).stop()
                mapJobs.delete(id)
            }
            break;
    }
    res.end();
});

//Quando cambiamo il valore dello switch del forecasting lo segnaliamo a "receiver" in modo tale che possa avviarlo o meno
app.post("/forecasting", async (req, res) => {
    forecastFlag = req.body.flag
    changeSwitchFlag(forecastFlag, "forecast")
    res.end();
});

//Quando cambiamo il valore dello switch del delay lo segnaliamo a "receiver" in modo tale che possa inviarli o meno
app.post("/delay", async (req, res) => {
    if (req.body.flag === "true") {
        delayFlag = 1
    } else {
        delayFlag = 0
    }

    changeSwitchFlag(req.body.flag, "delay")
    arrayESP32.forEach(obj => {
        //Segnaliamo all'esp che è stato attivato il delay
        let parameters = {
            id: obj.id,
            max_gas_value: obj.max_gas_value,
            min_gas_value: obj.min_gas_value,
            sample_frequency: obj.sample_frequency,
            protocol: obj.protocol.trim(),
        }
        //Inviamo i suoi stessi parametri, ma con il flag cambiato
        sendNewParameters(parameters)
    })
    res.end();
});

//Rimuoviamo un device togliendolo da firestore in modo tale da non poterlo più visualizzare nella webpage
app.post("/remove_device", async (req, res) => {
    //Rimuoviamo il device da firestore
    const request = await db.collection('device').doc(req.body.id).delete()
    //Se sono presenti job con tale device li stoppiamo
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
    //Inviamo la segnalazione
    sendNewParameters(parameters)
    res.end()
})

//Riceviamo i dati tramite HTTP dall'esp, creiamo quindi il punto e lo spediamo ad InfluxDB
app.post('/sensordata', async function (req, res) {
    let message = req.body
    console.log("HTTP " + req.body.i + " -> " + JSON.stringify(req.body))
    await pointCreation(message, "HTTP")
    res.end();
});

//Riceviamo la richiesta di inizializzazione da parte dell'esp
app.post('/initialize', async function (req, res) {
    let message = req.body
    //OpenWeather Data
    const urlOpenWeather = 'https://api.openweathermap.org/data/2.5/weather?lat=' + message.lt + '&lon=' + message.ln + '&units=metric&appid=3e877f0f053735d3715ca7e534ca8efa'

    //Prendiamo la temperatura da openWeatherMap
    let espPosition = await axios.get(urlOpenWeather).then(response => {
        return response.data.name + " - " + response.data.sys.country
    }).catch(error => {
        console.error("Errore! Non sono riuscito a prendere la posizione dell'esp!")
    })

    console.log("Richiesta inizializzazione da parte di -> " + message.ip)

    //Prendiamo i parametri Salvati in precedenza da firebase
    let parameters = arrayESP32.filter(obj => obj.id === message.id)[0]

    //Se ci sono parametri allora settiamo anche l'ip del device e aggiorniamo il suo ip anche su firebase
    if (parameters !== undefined) {
        parameters.ip = message.ip;
        //Aggiorniamo il device a quel determinato id aggiungendo l'ip
        await db.collection('device').doc(parameters.id).update({
            ip: message.ip,
            lt: message.lt,
            ln: message.ln,
            city: espPosition
        })
        arrayESP32.filter(obj => obj.id === parameters.id)[0] = parameters.ip;
        parameters.id = message.id
        //Mandiamo i parametri di inizializzazione all'esp
        sendNewParameters(parameters)
        res.end()
    } else {
        console.log("Il dispositivo " + message.id + " non è stato ancora registrato!")
        res.sendStatus(501)
    }
});

//Creazione del job COAP
function createCoAPJob(id, sF) {
    //Ogni quanto effettuare una richiesta COAP
    let sampleFrequency = parseInt(sF)
    console.log("Creazione Job per -> " + id)
    let d = new Date()
    //Aggiungiamo i millisecondi della sampleFrequency alla data di ora
    d.setMilliseconds(d.getMilliseconds() + sampleFrequency)
    //Creiamo il job
    let job = new CronJob(createCronTimeString(d), async function () {
        await coapRequest(id);      //Facciamo la richiesta all'esp
        let g = new Date()
        //Calcolo e settaggio del prossimo tempo di esecuzione
        g.setMilliseconds(g.getMilliseconds() + sampleFrequency)
        this.setTime(new CronTime(createCronTimeString(g)))
    });
    //Start effettivo del job
    console.log("Avvio Job di -> " + id)
    job.start();
    //Aggiunta del job alla mappa di quelli attivi
    mapJobs.set(id, job)
}

//Crea la stringa per il tempo per cron
function createCronTimeString(d) {
    let seconds = d.getSeconds()
    let minutes = d.getMinutes()
    let hours = d.getHours()

    return seconds + ' ' + minutes + ' ' + hours + ' * * *'
}

//Richiesta COAP all'esp
async function coapRequest(id) {
    //Prendiamo i dati dell'esp alla quale fare la richiesta
    let obj = arrayESP32.filter(obj => obj.id === id)[0]

    //Se l'esp scelto esiste
    if (obj !== undefined) {
        //IP del device alla quale fare richiesta
        let broker_address = obj.ip

        //Se abbiamo ricevuto l'ip del device alla quale fare richiesta
        if (broker_address !== undefined) {
            //Settiamo le options per la richiesta COAP
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

            //Settiamo le variabili per il delay
            let tempoInizPerformance = new Date()
            //Inizializzata in questo modo perchè se il delay corrisponde a zero significa che c'è stato qualche problema
            let tempoFinalPerformance = tempoInizPerformance        //Conterrà il tempo finale (ricezione messaggio COAP)

            //Effettua la richiesta effettiva
            let req = await coap.request(options)
            let jsonData    //Variabile nella quale salveremo il messaggio ricevuto

            //Una volta che riceviamo la risposta COAP controlliamo che sia andato tutto a buon fine
            req.on('response', function (res) {
                //Se il codice ricevuto come risposta è dioverso 2.05 abbiamo un errore
                if (res.code !== '2.05') return console.log("CoAP Error!");
                //Altrimenti se riceve dati andiamo a fare il parse JSON del messaggio
                res.on('data', function () {
                    jsonData = JSON.parse(res.payload)
                });
                res.on('end', async function () {
                    //Al termine della richiesta  se è tutto apposto inviamo il delay al db e creiamo il punto
                    if (res.code === '2.05') {
                        //Alla prima richiesta non mandiamo il delay perchè ci può essere ancora in esecuzione l'invio di un messaggio precedente
                        if (!obj.prima_richiesta)
                            tempoFinalPerformance = new Date()
                        else obj.prima_richiesta = false

                        console.log("COAP " + id + " -> " + JSON.stringify(jsonData))
                        jsonData.delayMess = tempoInizPerformance - tempoFinalPerformance
                        await pointCreation(jsonData, "COAP")
                    } else {
                        //Stampiamo l'errore
                        console.log('[coap] coap res.code=' + res.code);
                    }
                });
            })
            req.on('timeout', function (err) {
                console.error(err)
            })
            req.on('error', function (err) {
                console.error(err)
            })
            req.end();
        } else {
            //Se non abbiamo ancora ricevuto l'ip del device alla quale fare richiesta
            console.log("Non ho a disposizione l'ip del dispositivo " + id + "!")
        }
    } else {
        //Se il dispositivo scelto non esiste
        console.log("Il dispositivo non è presente nel database!")
    }
}

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
            lat: 44.490931818740, /******************** CONTROLLA *************/
            long: 11.35460682369,
            prima_richiesta: true
        }
        if (resD.ip !== undefined) {
            data.ip = resD.ip
        }

        arrayESP32.push(data)

        //Se il device ha settato come protocollo COAP creiamo il suo job
        if (resD.protocol.trim() === 'COAP') {
            if (!mapJobs.has(result.id)) {
                createCoAPJob(result.id, resD.sample_frequency)
            }
        }
    })
    //Restituiamo tutti i device
    return arrayESP32
}

//Funzione per inviare i vari parametri al nostro esp
function sendNewParameters(data) {
    clientMQTT.publish(topics[0] + data.id, createDeviceMessage(data.protocol, data.sample_frequency, data.max_gas_value, data.min_gas_value, delayFlag), {
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

//Funzione che resta in loop (ogni due min) alla ricerca di nuovi alert da influx
async function searchAlert() {
    let query = "from(bucket: \"_monitoring\") |> range(start: -2m) " +
        "|> filter(fn: (r) => r[\"_measurement\"] == \"statuses\")" +
        "|> filter(fn: (r) => r[\"_check_name\"] == \"AQI Check\")" +
        "|> filter(fn: (r) => r[\"_field\"] == \"_message\")" +
        "|> filter(fn: (r) => r[\"_level\"] == \"crit\")"

    //Salviamo in "data" tutti i dati che ci servono da influx
    let data = []

    //Scorriamo tutti i risultati della query
    await queryClient.queryRows(query, {
        next: (row, tableMeta) => {
            const tableObject = tableMeta.toObject(row)
            data.push(tableObject)
        },
        error: (error) => {
            console.log('Error, i cannot load influx data.' + ' -> ' + error);
        },
        //Quando abbiamo completato mandiamo gli alert su telegram
        complete: () => {
            sendAlerts(data)
        },
    })
}

//Creazione del job per gli alert
let jobAlert = new CronJob('45 */2 * * * *', async function () {
    await searchAlert()
});

jobAlert.start();