require('dotenv').config();
let variables = process.env

const axios = require("axios");
const fs = require('fs')

//time series forecasting
const timeseries = require("timeseries-analysis");
const sampleDim = 78
const degree = 1

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
let queryClient = clientInflux.getQueryApi(org)

//Forecasting
const {exec} = require("child_process");
const path = require("path");
const environmentName = "air-quality-monitoring-system"
const folderpath = path.resolve()
const pythonScriptTrain = folderpath + "\\prophetForecasting\\fitmodel.py"
const pythonScriptForecast = folderpath + "\\prophetForecasting\\forecasting.py"
const measurementForecast = "forecastingExample"
let mapForecasting = new Map()

//FIREBASE
let admin = require("firebase-admin");
let db = admin.firestore();

let flagfor = false


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
    let id = message.i
    let temp = parseFloat(message.t).toFixed(2)
    let hum = parseFloat(message.h).toFixed(2)
    let gas = parseFloat(message.g).toFixed(2)

    if(!mapForecasting.has(id)){
        totalForecast(id, temp, hum, gas)
        mapForecasting.set(id, new Date())
    }else{
        let d = new Date()
        //120000 due minuti
        if((d-mapForecasting.get(id)) > 120000){
            totalForecast(id, temp, hum, gas)
            mapForecasting.set(id, d)
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

    let measurement = 'measurements'

    let point = new Point(measurement)
        .tag('id', id)
        .tag('gps', message.lt + "," + message.ln)
        .floatField('temperature', temp)
        .floatField('humidity', hum)
        .floatField('gas', gas)
        .floatField('aqi', parseFloat(message.a).toFixed(2))
        .floatField('wifi_signal', parseFloat(message.w).toFixed(2))
        .floatField('tempOpenWeather', tempOpenWeather)

    //Se è presente il delay del messaggio allora andiamo a ssalvarlo su firestore
    if (message.delayMess !== undefined && message.delayMess !== 0) {
        await sendDelays(message.i, message.delayMess, protocol)
    }

    writeClient.writePoint(point)
}

async function totalForecast(id, temp, hum, gas) {
    tempForecast(id, "temperature", temp)
    tempForecast(id, "humidity", hum)
    tempForecast(id, "gas", gas)

    let devices = await db.collection("device").get()

    let sf = 1000

    devices.forEach((result) => {
        if (result.id === id)
            sf = result.data().sample_frequency
    })

    trainModelFBProphet(id, "temperature", temp, sf)
    trainModelFBProphet(id, "humidity", hum, sf)
    trainModelFBProphet(id, "gas", gas, sf)
}

function writeForecastPoint(id, field, value, forecast, algorithm) {
    let point = new Point(measurementForecast)
        .tag('id', id)
        .tag('algorithm', algorithm)
        .floatField('forecast_' + field, forecast.toFixed(2))
        .floatField(field, value)

    writeClient.writePoint(point)
}

async function tempForecast(id, field, value) {

    let query = `from(bucket: "iotProject2022")|> range(start: -12h)
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
            let nd = data.map(t => [t._time,
                t._value])

            let forecast = timeseriesForecasting(nd)

            writeForecastPoint(id, field, value, forecast, 'TimeSeriesAnalysis')
        }
    })

}

function timeseriesForecasting(data) {
    // Load the data

    let t = new timeseries.main(data.slice(data.length - 1 - sampleDim, data.length));
    let coeffs = t.ARMaxEntropy({degree: degree})
    let forecast = 0;	// Init the value at 0.
    for (let i = 0; i < coeffs.length; i++) {	// Loop through the coefficients
        forecast -= (t.data[t.data.length - 1 - i][1]) * coeffs[i];
        // Explanation for that line:
        // t.data contains the current dataset, which is in the format [ [date, value], [date,value], ... ]
        // For each coefficient, we substract from "forecast" the value of the "N - x" datapoint's value, multiplicated by the coefficient, where N is the last known datapoint value, and x is the coefficient's index.
    }
    return forecast
}

async function trainModelFBProphet(esp, field, value, sf) {

    let pathModel = `./prophetForecasting/models/${esp}_${field}_model.json`

    await exec(`conda run -n ${environmentName} python ${pythonScriptTrain} ${esp} ${field} ${pathModel}`, (error, stdout, stderr) => {
        if (error) {
            console.log(`error: ${error.message}`);
            return;
        }
        if (stderr) {
            console.log(`stderr: ${stderr}`);
        }
    })

    let flag = fs.existsSync(pathModel)

    while (!flag) {
        await new Promise(r => setTimeout(r, 2000));
        flag = fs.existsSync(pathModel)
    }

    console.log("trainig completato!")

    forecastFBProphet(esp, field, value, sf)

}

function forecastFBProphet(esp, field, value, sf) {

    let pathModel = `./prophetForecasting/models/${esp}_${field}_model.json`

    exec(`conda run -n ${environmentName} python ${pythonScriptForecast} ${sf} ${pathModel}`, (error, stdout, stderr) => {
        if (error) {
            console.log(`error: ${error.message}`);
            return;
        }
        if (stderr) {
            //console.log(`stderr: ${stderr}`);
            //return;
        }
        let forecast = parseFloat(stdout)
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

module.exports = {pointCreation}