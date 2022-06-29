require('dotenv').config();
let variables = process.env
const axios = require("axios");
const fs = require('fs')
var express = require('express'),
    router = express.Router();

let {sendDelays} = require("./utils")
let {totalForecast} = require("./forecast")

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
const topic1 = "sensor/values"      //Topic per la ricezione dei valori dell'esp
const topic2 = "delay"              //Topic per la ricezione del delay calcolato sull'esp
const topic3 = "acknowledgement/"    //Topic perinviare l'ack all'esp quando invia messaggi MQTT
const topics = [topic1, topic2]

//INFLUXDB
const token = variables.TOKEN_INFLUX
const url = variables.URL_INFLUX
let org = variables.ORG_INFLUX
let bucket = variables.BUCKET_INFLUX
const {InfluxDB, Point} = require('@influxdata/influxdb-client')
const clientInflux = new InfluxDB({url, token})
let writeClient = clientInflux.getWriteApi(org, bucket, 'ns')
let queryClient = clientInflux.getQueryApi(org)

/** FORECASTING */
const tempoNuovoForecast = 120000 //Tempo dopo la quale effettuare un nuovo forecast (in millisecondi)
let forecastFlag = false;

//Forecasting FBProphet
let mapForecasting = new Map()                                                          //Segna per ogni scheda attiva quando è stato eseguito l'ultimo forecast (FBProphet)


let delayFlag = 0;

/** MQTT **/
//Quando riceve un messaggio MQTT
clientMQTT.on('message', async (topic, payload) => {
    if (topic !== topics[1]) {
        //Abbiamo ricevuto un messaggio tramite MQTT al primo topic
        if (payload.toString() !== "Errore") {
            let message = JSON.parse(payload.toString())
            //Mandiamo l'ack per calcolare il delay del messaggio MQTT
            if (delayFlag) {
                sendAcknowledgementForDelay(message.i)
            }
            console.log('MQTT ' + message.i + ' -> ' + JSON.stringify(message))
            await pointCreation(message, "MQTT")
        } else {
            console.log("Non sono riuscito a leggere i dati dai sensori!")
        }
    } else {
        //Dobbiamo inviare il nuovo delay a firebase, secondo topic
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

//Mandiamo l'acknoledgment all'esp per sapere quanto è stato il delay
function sendAcknowledgementForDelay(id) {
    clientMQTT.publish(topic3 + id, "{ack: \'ok\'}", {
        qos: 0,
        retain: false
    }, (error) => {
        if (error) {
            console.error(error)
        } else {
            console.log("Ack MQTT inviato all'esp -> " + id)
        }
    })
}

//Funzione chiamata da web_page quando viene cambiato il valore dello switch
function changeSwitchFlag(flag, switchType) {
    switch (switchType) {
        case "forecast":
            forecastFlag = flag
            break;
        case "delay":
            if (flag === "true") {
                delayFlag = 1
            } else {
                delayFlag = 0;
            }
            break;
    }
}

//Funzione per creare il punto da salvare su influx
async function pointCreation(message, protocol) {
    //Prepariamo i valori da salvare
    let id = message.i
    let temp = parseFloat(message.t).toFixed(2)
    let hum = parseFloat(message.h).toFixed(2)
    let gas = parseFloat(message.g).toFixed(2)

    //Se lo switch sulla home page è attivo allora viene effettuato altrimenti no
    if (forecastFlag) {
        if (!mapForecasting.has(id)) {
            totalForecast(id, temp, hum, gas)
            mapForecasting.set(id, new Date())
        } else {
            let d = new Date()
            //Se è il momento di fare un nuovo forecast, lo avviamo
            if ((d - mapForecasting.get(id)) > tempoNuovoForecast) {
                totalForecast(id, temp, hum, gas)
                mapForecasting.set(id, d)       //Settiamo il nuovo tempo di inizio dell'ultimo forecast
            }
        }
    }

    //OpenWeather Data
    const urlOpenWeather = 'https://api.openweathermap.org/data/2.5/weather?lat=' + message.lt + '&lon=' + message.ln + '&units=metric&appid=3e877f0f053735d3715ca7e534ca8efa'

    //Prendiamo la temperatura da openWeatherMap
    let tempOpenWeather = await axios.get(urlOpenWeather).then(response => {
        return response.data.main.temp
    }).catch(error => {
        console.error("Errore! Non sono riuscito a fare la richiesta a OpenWeatherMap")
    })

    //Settiamo il mesurement nella quale scrivere i nostri dati su influx
    let measurement = 'measurements'

    //Creaiamo il punto con tutti i valori necessari
    let point = new Point(measurement)
        .tag('id', id)
        .tag('gps', message.lt + "," + message.ln)
        .floatField('temperature', temp)
        .floatField('humidity', hum)
        .floatField('gas', gas)
        .floatField('aqi', parseFloat(message.a).toFixed(2))
        .floatField('wifi_signal', parseFloat(message.w).toFixed(2))

    if (tempOpenWeather !== undefined)
        point.floatField('tempOpenWeather', tempOpenWeather)

    //Se è presente il delay del messaggio allora andiamo a salvarlo su firestore
    if (message.delayMess !== undefined && message.delayMess !== 0 && delayFlag) {
        await sendDelays(message.i, message.delayMess, protocol)
    }
    //Scriviamo il punto su influx
    writeClient.writePoint(point)
}

module.exports = {pointCreation, changeSwitchFlag}