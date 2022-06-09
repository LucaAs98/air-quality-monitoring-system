require('dotenv').config();
let variables = process.env

const express = require("express");
const open = require('open');
const app = express();

app.set('views', __dirname + '/');
// Parse URL-encoded bodies (as sent by HTML forms)
app.use(express.urlencoded());
app.engine('html', require('ejs').renderFile);
app.set('view engine', 'ejs');

app.use(express.static(__dirname));

/* Stiamo in ascolto su "localhost:3000". */
app.listen(3000, () => {
    console.log("Application started and Listening on port 3000");
});


// Import the functions you need from the SDKs you need
let admin = require("firebase-admin");
let serviceAccount = require("./progettoiot2022-firebase-adminsdk-hoxdu-085c6305e8.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://progettoiot2022-default-rtdb.europe-west1.firebasedatabase.app"
});
//MQTT
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
const topics = ["device/parameters/"]

//INFLUXDB
const token = variables.TOKEN_INFLUX
const url = variables.URL_INFLUX

const {InfluxDB, Point} = require('@influxdata/influxdb-client')
const clientInflux = new InfluxDB({url, token})

let org = process.env.ORG_INFLUX
let bucket = process.env.BUCKET_INFLUX

let queryClient = clientInflux.getQueryApi(org)

// As an admin, the app has access to read and write all data, regardless of Security Rules
let db = admin.firestore();

/*** Richieste GET ***/
/* Ad URL "/home" rendirizziamo "home.html". Questo a sua volta chiamerà lo script "home.js". */
app.get("/home", (req, res) => {
    res.render("home.html");
});

app.get("/devices", async (req, res) => {
    let errore;
    let response = await getDevices().catch((err) => errore = err);

    if (!response) {
        console.log('Error, i cannot load the devices.' + '\n' + errore);
    } else {
        res.json(response);
    }
});

app.get("/get_influx_data", async (req, res) => {
    let fluxQuery = `from(bucket: "iotProject2022")
    |> range(start: -10d)
 |> group(columns: ["id", "_field"])
 |> mean()`

    let data = []

    await queryClient.queryRows(fluxQuery, {
        next: (row, tableMeta) => {
            const tableObject = tableMeta.toObject(row)
            data.push(tableObject)
        },
        error: (error) => {
            console.log('Error, i cannot load influx data.' + ' -> ' + error);
        },
        complete: () => {
            data = influxDataFormat(data)
            res.json(data);
        },
    })
});

/*** Richieste POST **/

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

    const request = await db.collection('device').doc(id).update(data)

    clientMQTT.publish(topics[0] + id, createMessage(data.protocol, data.sample_frequency, data.max_gas_value, data.min_gas_value), {
        qos: 0,
        retain: false
    }, (error) => {
        if (error) {
            console.error(error)
        }
    })
});

//Rimuoviamo un device
app.post("/remove_device", async (req, res) => {
    const request = await db.collection('device').doc(req.body.id).delete()
})


async function getDevices() {
    const devicesCollection = await db.collection('device').get();
    let arrayESP32 = [];

    devicesCollection.forEach((result) => {
        arrayESP32.push({
            id: result.id,
            max: result.data().max_gas_value,
            min: result.data().min_gas_value,
            sample_frequency: result.data().sample_frequency,
            protocol: result.data().protocol,
            lat: 41,
            long: 11
        })
    })

    return arrayESP32
}

function createMessage(protocol, sample_frequency, max_gas, min_gas) {
    return '{ \"protocol\": \"' + protocol.trim() + '\",' +
        '\"sample_frequency\":' + sample_frequency + ',' +
        '\"max_gas\":' + max_gas + ',' +
        '\"min_gas\":' + min_gas + '}'
}

/*

async function getInfluxData() {
    let fluxQuery = `from(bucket: "iotProject2022")
    |> range(start: -10d)
 |> group(columns: ["id", "_field"])
 |> mean()`

    let data = []

    await queryClient.queryRows(fluxQuery, {
        next: (row, tableMeta) => {
            const tableObject = tableMeta.toObject(row)
            data.push(tableObject)
        },
        error: (error) => {
            console.error('\nError', error)
        },
        complete: () => {
            //console.log(data)
            console.log('\nSuccess')
            console.log("primo" + data)

        },
    })
    console.log("secondo")
    return data
}
*/

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