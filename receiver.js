require('dotenv').config();
let variables = process.env
const axios = require("axios");
const fs = require('fs')
var express = require('express'),
    router = express.Router();

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
//Forecasting con "time series forecasting"
const timeseries = require("timeseries-analysis");
const sampleDim = 78        //Contiene il numero di sample da considerare per effetuare il forecast
const degree = 1            //Numero di coefficienti da calcolare
let forecastFlag = false;

//Forecasting FBProphet
const {exec} = require("child_process");
const path = require("path");
const environmentName = "air-quality-monitoring-system"                                 //Nome dell'environment conda
const folderPath = path.resolve()                                                       //Path dove risiede questo script
const pythonScriptTrain = folderPath + "\\prophetForecasting\\fitmodel.py"              //Path dove salvare i coefficienti
const pythonScriptForecast = folderPath + "\\prophetForecasting\\forecasting.py"        //Path dello script che esegue FBProphet
const measurementForecast = "forecastingExample"                                        //Measurement per salvare i dati del forecast
let mapForecasting = new Map()                                                          //Segna per ogni scheda attiva quando è stato eseguito l'ultimo forecast (FBProphet)

//FIREBASE
let admin = require("firebase-admin");
let db = admin.firestore();


/** MQTT **/
//Quando riceve un messaggio MQTT
clientMQTT.on('message', async (topic, payload) => {
    if (topic !== topics[1]) {
        //Abbiamo ricevuto un messaggio tramite MQTT al primo topic
        if (payload.toString() !== "Errore") {
            let message = JSON.parse(payload.toString())
            //Mandiamo l'ack per calcolare il delay del messaggio MQTT
            sendAcknowledgementForDelay(message.i)
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
function sendAcknowledgementForDelay(id){
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
function changeForecastFlag(flag) {
    forecastFlag = flag
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
        .floatField('tempOpenWeather', tempOpenWeather)

    //Se è presente il delay del messaggio allora andiamo a salvarlo su firestore
    if (message.delayMess !== undefined && message.delayMess !== 0) {
        await sendDelays(message.i, message.delayMess, protocol)
    }
    //Scriviamo il punto su influx
    writeClient.writePoint(point)
}

//Comincia il forecast per tutte le misure e tutti e due gli algoritmi
async function totalForecast(id, temp, hum, gas) {
    //Forecast con algoritmo "time series forecasting"
    tempForecast(id, "temperature", temp)
    tempForecast(id, "humidity", hum)
    tempForecast(id, "gas", gas)

    /* Per eseguire il forecasst con FBProphet ci serve la sample frequency dello specifico esp. Questo per prendere 
    * il valore corrispondente forecastato. */
    let devices = await db.collection("device").get()
    let sf = 1000       //Sample frequency
    devices.forEach((result) => {
        if (result.id === id)
            sf = result.data().sample_frequency
    })

    //Facciamo il forecast con FBProphet per tutti i field
    trainModelFBProphet(id, "temperature", temp, sf)
    trainModelFBProphet(id, "humidity", hum, sf)
    trainModelFBProphet(id, "gas", gas, sf)
}

//Funzione generale per scrivere un punto forecastato. Prende in input che algoritmo è stato usato
function writeForecastPoint(id, field, value, forecast, algorithm) {
    let point = new Point(measurementForecast)
        .tag('id', id)
        .tag('algorithm', algorithm)
        .floatField('forecast_' + field, forecast.toFixed(2))           //Valore forecastato
        .floatField(field, value)                                                       //Valore reale

    writeClient.writePoint(point)
}

//Forecast per "Time series forecasting"
async function tempForecast(id, field, value) {
    //Prendiamo i valori da considerare per effettuare il forecast
    let query = `from(bucket: "iotProject2022")
        |> range(start: -24h)
        |> filter(fn: (r) => r["_measurement"] == "measurements")
        |> filter(fn: (r) => r["id"] == "${id}")
        |> filter(fn: (r) => r["_field"] == "${field}")`

    let data = []

    await queryClient.queryRows(query, {
        next: (row, tableMeta) => {
            const tableObject = tableMeta.toObject(row)
            data.push(tableObject)
        },
        error: (error) => {
            console.error("Errore!", error)
        },
        complete: () => {
            let dataFormatted = data.map(t => [t._time, t._value]) //Mappiamo i valori come timeseries e valore (richiesto dalla libreria del forecast)

            //Eseguiamo il forecast vero e proprio
            let forecast = timeseriesForecasting(dataFormatted)

            //Scriviamo il punto forecastato
            writeForecastPoint(id, field, value, forecast, 'TimeSeriesAnalysis')
        }
    })

}

//Eseguiamo il forecast vero e proprio con la libreria "Time series forecasting"
function timeseriesForecasting(data) {
    //Prendiamo solo gli ultimi dati che ci interessano per creare la timeseries sulla quale effettuare il forecasting
    let t = new timeseries.main(data.slice(data.length - 1 - sampleDim, data.length));
    //Calcoliamo i coefficienti
    let coeffs = t.ARMaxEntropy({degree: degree})
    let forecast = 0;
    //Ciclo for che trova il valore predetto
    for (let i = 0; i < coeffs.length; i++) {   //Scorriamo i coefficienti ed effettuiamo le operazioni necessarie per predirre il valore
        forecast -= (t.data[t.data.length - 1 - i][1]) * coeffs[i];
    }
    return forecast
}

//Effettuiamo il training per trovare il modello FBProphet
async function trainModelFBProphet(esp, field, value, sf) {
    //Path del file nella quale salvare il modello
    let pathModel = `./prophetForecasting/models/${esp}_${field}_model.json`

    //Eseguiamo lo script per effettuare il training, gli passiamo l'id dell'esp, il field, e il path del file nella quale salvare il modello
    await exec(`conda run -n ${environmentName} python ${pythonScriptTrain} ${esp} ${field} ${pathModel}`, (error, stdout, stderr) => {
        if (error) {
            console.log(`error: ${error.message}`);
        }
    })

    //Controlliamo se il file sia presente
    let flagModelloEsistente = fs.existsSync(pathModel)

    //Stiamo in attesa che venga creato il file contenente il modello
    while (!flagModelloEsistente) {
        //Ogni 2 secondi controlliamo se è stato creato
        await new Promise(r => setTimeout(r, 2000));
        flagModelloEsistente = fs.existsSync(pathModel)
    }

    console.log("Trainig completato per il field -> " + field)

    //Avvia il forecasting vero e proprio
    forecastFBProphet(esp, field, value, sf)
}

//Effettua il forecast vero e proprio con FBProphet
function forecastFBProphet(esp, field, value, sf) {
    //Path dalla quale prendere il modello
    let pathModel = `./prophetForecasting/models/${esp}_${field}_model.json`

    //Eseguiamo lo script che effettua il forecast
    exec(`conda run -n ${environmentName} python ${pythonScriptForecast} ${sf} ${pathModel}`, (error, stdout, stderr) => {
        if (error) {
            console.log(`error: ${error.message}`);
            return;
        }
        //Prendiamo il valore forecastato dal terminale
        let forecast = parseFloat(stdout)
        //Scriviamo il punto forecastato su influx
        writeForecastPoint(esp, field, value, forecast, "FBProphet")
    })
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

module.exports = {pointCreation, changeForecastFlag}