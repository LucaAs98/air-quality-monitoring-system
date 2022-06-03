require('dotenv').config();
let variables = process.env

//Inizializza MQTT
const mqtt = require('mqtt')
const host = variables.HOST_MQTT
const port = variables.PORT_MQTT
const connectUrl = `mqtt://${host}:${port}`
const clientMQTT = mqtt.connect(connectUrl, {
    clean: true,
    connectTimeout: 4000,
    username: 'luca',
    password: 'public',
    reconnectPeriod: 1000,
})


//INFLUXDB
const token = variables.TOKEN_INFLUX
const url = variables.URL_INFLUX
let org = variables.ORG_INFLUX
let bucket = variables.BUCKET_INFLUX
const {InfluxDB, Point} = require('@influxdata/influxdb-client')
const axios = require("axios");
const clientInflux = new InfluxDB({url, token})
let writeClient = clientInflux.getWriteApi(org, bucket, 'ns')


/** MQTT **/
//Quando riceve un messaggio MQTT
clientMQTT.on('message', async (topic, payload) => {
    console.log('MQTT -> ', topic, payload.toString())
    let message = JSON.parse(payload.toString())

    let point = new Point('measurement')
        .tag('id', 'esp32_nostro')
        .tag('gps', 'BO')
        .floatField('temperature', parseFloat(message.temperature))
        .floatField('humidity', parseFloat(message.humidity))
        .floatField('gas', parseFloat(message.gas))
        .floatField('aqi', parseFloat(message.aqi))
        .floatField('wifi_signal', parseFloat(message.wifi_signal))

    writeClient.writePoint(point)
})

//Quando si connette si sottoscrive ai due topic a cui siamo interessati
clientMQTT.on('connect', () => {
    console.log("Connected")
    const topic1 = "sensor/values"
    const topics = [topic1]

    clientMQTT.subscribe(topics, () => {
        console.log(`Subscribe to topics '${topics}'`)
    })
})

//Loop dove andiamo a prendere tutto ciò che dobbiamo poi mandare a ThingSpeak
const SAMPLE_FREQUENCY = 2000


//Calcolo media
function average(array) {
    const sum = array.reduce((a, b) => a + b, 0);
    return (sum / array.length) || 0; //Average
}