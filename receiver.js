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
const clientInflux = new InfluxDB({url, token})
let writeClient = clientInflux.getWriteApi(org, bucket, 'ns')

//OpenWeather
const urlOpenWeather = 'https://api.openweathermap.org/data/2.5/weather?lat=44.495377359445904&lon=11.386158929048305&units=metric&appid=3e877f0f053735d3715ca7e534ca8efa'

/** MQTT **/
//Quando riceve un messaggio MQTT
clientMQTT.on('message', async (topic, payload) => {
    console.log('MQTT -> ', topic, payload.toString())
    let message = JSON.parse(payload.toString())

    //Prendiamo la temperatura da openWeatherMap
    let tempOpenWeather = await axios.get(urlOpenWeather).then(response => {
        return response.data.main.temp
    }).catch(error => {
        console.error("Errore! Non sono riuscito a fare la richiesta a OpenWeatherMap")
    })
        
    let point = new Point('measurement')
        .tag('id', 'esp32_nostro')
        .tag('gps', 'BO')
        .floatField('temperature', parseFloat(message.temperature))
        .floatField('humidity', parseFloat(message.humidity))
        .floatField('gas', parseFloat(message.gas))
        .floatField('aqi', parseFloat(message.aqi))
        .floatField('wifi_signal', parseFloat(message.wifi_signal))
        .floatField('tempOpenWeather', tempOpenWeather)

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