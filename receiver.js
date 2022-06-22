require('dotenv').config();
let variables = process.env

const axios = require("axios");

//Inizializza MQTT
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
const topic1 = "sensor/values"
const topic2 = "delay"      //Topic per la ricezione del delay calcolato sull'esp
const topics = [topic1, topic2]

//INFLUXDB
const token = variables.TOKEN_INFLUX
const url = variables.URL_INFLUX
let org = variables.ORG_INFLUX
let bucket = variables.BUCKET_INFLUX
const {InfluxDB, Point} = require('@influxdata/influxdb-client')
const clientInflux = new InfluxDB({url, token})
let writeClient = clientInflux.getWriteApi(org, bucket, 'ns')

//FIREBASE
let admin = require("firebase-admin");
let db = admin.firestore();


/** MQTT **/
//Quando riceve un messaggio MQTT
clientMQTT.on('message', async (topic, payload) => {
    if (topic !== topics[1]) {
        //Abbiamo ricevuto un messaggio tramite MQTT
        if (payload.toString() !== "Errore") {
            let message = JSON.parse(payload.toString())
            console.log('MQTT ' + message.i + ' -> ' + JSON.stringify(message))
            await pointCreation(message, "MQTT")
        } else {
            console.log("Non sono riuscito a leggere i dati dai sensori!")
        }
    } else {
        //Dobbiamo inviare il nuovo delay a firebase
        if (payload.toString() !== "Errore") {
            let message = JSON.parse(payload.toString())
            await sendDelays(message.id, message.delay, message.protocol)
        } else {
            console.log("Errore nei dati del delay!")
        }
    }
})

//Quando si connette si sottoscrive ai due topic a cui siamo interessati
clientMQTT.on('connect', () => {
    console.log("Connected")
    clientMQTT.subscribe(topics, () => {
        console.log(`Subscribe to topics '${topics}'`)
    })
})

async function pointCreation(message, protocol) {
    //OpenWeather Data
    const urlOpenWeather = 'https://api.openweathermap.org/data/2.5/weather?lat=' + message.lt + '&lon=' + message.ln + '&units=metric&appid=3e877f0f053735d3715ca7e534ca8efa'

    //Prendiamo la temperatura da openWeatherMap
    let tempOpenWeather = await axios.get(urlOpenWeather).then(response => {
        return response.data.main.temp
    }).catch(error => {
        console.error("Errore! Non sono riuscito a fare la richiesta a OpenWeatherMap")
    })

    let measurement = 'measurements'

    let point = new Point(measurement)
        .tag('id', message.i)
        .tag('gps', message.lt + "," + message.ln)
        .floatField('temperature', parseFloat(message.t).toFixed(2))
        .floatField('humidity', parseFloat(message.h).toFixed(2))
        .floatField('gas', parseFloat(message.g).toFixed(2))
        .floatField('aqi', parseFloat(message.a).toFixed(2))
        .floatField('wifi_signal', parseFloat(message.w).toFixed(2))
        .floatField('tempOpenWeather', tempOpenWeather)


    //Se è presente il delay del messaggio allora andiamo a ssalvarlo su firestore
    if (message.delayMess !== undefined && message.delayMess !== 0) {
        await sendDelays(message.i, message.delayMess, protocol)
    }
    writeClient.writePoint(point)
}

//Funzione per inviare i delay a firestore
async function sendDelays(id, delay, protocol) {
    console.log("Delay inviato!")
    await db.collection('delay_mess').doc(id).collection('tempi').doc((new Date()).toString()).set({
        protocol: protocol,
        delay: delay
    })
}

//Funzione per prendere da firestore i delay di un determinato device (NON ANCORA USATA)
async function getDelays(id) {
    const delays = await db.collection('delay_mess').doc(id).collection("tempi").get();
    delays.forEach((result) => {
        let resD = result.data()
        console.log(resD)
    })
}

module.exports = pointCreation