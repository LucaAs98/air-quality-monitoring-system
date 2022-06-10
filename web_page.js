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
        max_gas_value: req.body.max,
        min_gas_value: req.body.min,
        protocol: req.body.protocol,
        sample_frequency: req.body.sample_frequency,
    };

    //Creaimo un doc chiamato con l'id e salviamo all'interno di esso tutti i dati relativi a quel determinato device
    const request = await db.collection('device').doc(id).set(data)
});

//Inviamo l'update del device
app.post("/update_device", async (req, res) => {
    const id = req.body.id
    const data = {
        max_gas_value: req.body.max,
        min_gas_value: req.body.min,
        protocol: req.body.protocol,
        sample_frequency: req.body.sample_frequency,
    };

    //Aggiorniamo il device a quel determinato id
    const request = await db.collection('device').doc(id).update(data)

    //Dopo aver aggiornato i dati su firestore andiamo a comunicarli anche all'esp32
    clientMQTT.publish(topics[0] + id, createMessage(data.protocol, data.sample_frequency, data.max_gas_value, data.min_gas_value), {
        qos: 0,
        retain: false
    }, (error) => {
        if (error) {
            console.error(error)
        }
    })
});

//Rimuoviamo un device togliendolo da firestore in modo tale da non poterlo più visualizzare nella webpage
app.post("/remove_device", async (req, res) => {
    const request = await db.collection('device').doc(req.body.id).delete()
})

//Riceviamo i dati tramite HTTP dall'esp, creiamo quindi il punto e lo spediamo ad InfluxDB
app.post('/sensordata', async function (req, res) {
    let message = req.body
    await pointCreation(message)
    res.end();
});

//Metodo che prende tutti i device da firebase
async function getDevices() {
    const devicesCollection = await db.collection('device').get();
    let arrayESP32 = [];

    //Per ognuno di essi assegnamo tutti i parametri necessari.
    devicesCollection.forEach((result) => {
        arrayESP32.push({
            id: result.id,
            max: result.data().max_gas_value,
            min: result.data().min_gas_value,
            sample_frequency: result.data().sample_frequency,
            protocol: result.data().protocol,
            lat: 44.490931818740,
            long: 11.35460682369
        })
    })

    //Restituiamo tutti i device
    return arrayESP32
}

//Funzione che crea il messagio da inviare all'esp32
function createMessage(protocol, sample_frequency, max_gas, min_gas) {
    return '{ \"protocol\": \"' + getProtocol(protocol) + '\",' +
        '\"sample_frequency\":' + sample_frequency + ',' +
        '\"max_gas\":' + max_gas + ',' +
        '\"min_gas\":' + min_gas + '}'
}

/* Funzione che dato il protocollo in stringa restituisce il suo numero corrispondente. Abbiamo fatto questo per prenderlo
* più semplicemente dall'esp32 occupando anche meno memoria. */
function getProtocol(protocol) {
    console.log(protocol)
    switch (protocol) {
        case "MQTT":
            return 0;
        case "HTTP":
            return 1;
        case "COAP":
            return 2;
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

// All'avvio apriamo la home con il browser di default.
open("http://localhost:3000/home");