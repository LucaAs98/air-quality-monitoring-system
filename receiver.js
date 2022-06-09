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


//INFLUXDB
const token = variables.TOKEN_INFLUX
const url = variables.URL_INFLUX
let org = variables.ORG_INFLUX
let bucket = variables.BUCKET_INFLUX
const {InfluxDB, Point} = require('@influxdata/influxdb-client')
const clientInflux = new InfluxDB({url, token})
let writeClient = clientInflux.getWriteApi(org, bucket, 'ns')


/** MQTT **/
//Quando riceve un messaggio MQTT
clientMQTT.on('message', async (topic, payload) => {
    console.log('MQTT -> ', topic, payload.toString())
    let message = JSON.parse(payload.toString())
    await pointCreation(message)
})

//Quando si connette si sottoscrive ai due topic a cui siamo interessati
clientMQTT.on('connect', () => {
    console.log("Connected")
    const topic1 = "sensor/values"
    const topic2 = "device/parameters"
    const topics = [topic1]

    clientMQTT.subscribe(topics, () => {
        console.log(`Subscribe to topics '${topics}'`)
    })
})

/** HTTP **/
async function pointCreation(message) {
    console.log(message)
    //OpenWeather Data
    const urlOpenWeather = 'https://api.openweathermap.org/data/2.5/weather?lat=' + message.lat + '&lon=' + message.lon + '&units=metric&appid=3e877f0f053735d3715ca7e534ca8efa'

    //Prendiamo la temperatura da openWeatherMap
    let tempOpenWeather = await axios.get(urlOpenWeather).then(response => {
        return response.data.main.temp
    }).catch(error => {
        console.error("Errore! Non sono riuscito a fare la richiesta a OpenWeatherMap")
    })

    let point = new Point('measurement')
        .tag('id', message.id)
        .tag('gps', message.lat + "," + message.lon)
        .floatField('temperature', parseFloat(message.temperature).toFixed(2))
        .floatField('humidity', parseFloat(message.humidity).toFixed(2))
        .floatField('gas', parseFloat(message.gas).toFixed(2))
       // .floatField('aqi', parseFloat(message.aqi).toFixed(2))
        .floatField('wifi_signal', parseFloat(message.wifi_signal).toFixed(2))
        .floatField('tempOpenWeather', tempOpenWeather)


    writeClient.writePoint(point)
}
module.exports = pointCreation