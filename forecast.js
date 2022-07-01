require('dotenv').config();
let variables = process.env

//INFLUXDB
const token = variables.TOKEN_INFLUX
const url = variables.URL_INFLUX
let org = variables.ORG_INFLUX
let bucket = variables.BUCKET_INFLUX
const {InfluxDB, Point} = require('@influxdata/influxdb-client')
const clientInflux = new InfluxDB({url, token})
let writeClient = clientInflux.getWriteApi(org, bucket, 'ns')
let queryClient = clientInflux.getQueryApi(org)

const fs = require("fs");
//Forecasting con "time series forecasting"
const timeseries = require("timeseries-analysis");
const sampleDim = 78        //Contiene il numero di sample da considerare per effetuare il forecast
const degree = 1            //Numero di coefficienti da calcolare

//Forecasting FBProphet
const {exec} = require("child_process");
const path = require("path");
const environmentName = "air-quality-monitoring-system"                                 //Nome dell'environment conda
const folderPath = path.resolve()                                                       //Path dove risiede questo script
const pythonScriptTrain = folderPath + "\\prophetForecasting\\fitmodel.py"              //Path dove salvare i coefficienti
const pythonScriptForecast = folderPath + "\\prophetForecasting\\forecasting.py"        //Path dello script che esegue FBProphet
const measurementForecast = "measurementForecasting"                                  //Measurement per salvare i dati del forecast
//FIREBASE
let admin = require("firebase-admin");
let db = admin.firestore();

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
    let forC
    if(isNaN(forecast))
        forC = 0
    else
        forC = forecast

    let point = new Point(measurementForecast)
        .tag('id', id)
        .tag('algorithm', algorithm)
        .floatField('forecast_' + field, forC.toFixed(2))           //Valore forecastato
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

module.exports = {totalForecast}