require('dotenv').config({path: '../.env'});
let variables = process.env
/** Inizializzazione INFLUXDB **/
const token = variables.TOKEN_INFLUX
const url = variables.URL_INFLUX
const {InfluxDB, Point} = require('@influxdata/influxdb-client')
const timeseries = require("timeseries-analysis");
const clientInflux = new InfluxDB({url, token})
let org = variables.ORG_INFLUX
let bucket = variables.BUCKET_INFLUX
let queryClient = clientInflux.getQueryApi(org)
let measurement = "measurementForecasting"

const fs = require('fs');

function buildQuery(id, alg, field) {
    return `t1 = from(bucket: "iotProject2022")
|> range(start: -2d)
|> filter(fn: (r) => r["_measurement"] == "${measurement}")
|> filter(fn: (r) => r["_field"] == "forecast_${field}")
|> filter(fn: (r) => r["algorithm"] == "${alg}")
|> filter(fn: (r) => r["id"] == "${id}")
|> keep(columns: ["_value", "_time"])
|> rename(columns:{"_value":"forecast_value"})

    t2 = from(bucket: "iotProject2022")
|> range(start: -2d)
|> filter(fn: (r) => r["_measurement"] == "${measurement}")
|> filter(fn: (r) => r["_field"] == "${field}")
|> filter(fn: (r) => r["algorithm"] == "${alg}")
|> filter(fn: (r) => r["id"] == "${id}")
|> keep(columns: ["_value", "_time"])
|> rename(columns:{"_value": "value"})

    join(tables: {t1, t2}, on: ["_time"])`
}

function buildQuery2(alg, field) {
    return `t1 = from(bucket: "iotProject2022")
|> range(start: -2d)
|> filter(fn: (r) => r["_measurement"] == "${measurement}")
|> filter(fn: (r) => r["_field"] == "forecast_${field}")
|> filter(fn: (r) => r["algorithm"] == "${alg}")
|> keep(columns: ["_value", "_time"])
|> rename(columns:{"_value":"forecast_value"})

    t2 = from(bucket: "iotProject2022")
|> range(start: -2d)
|> filter(fn: (r) => r["_measurement"] == "${measurement}")
|> filter(fn: (r) => r["_field"] == "${field}")
|> filter(fn: (r) => r["algorithm"] == "${alg}")
|> keep(columns: ["_value", "_time"])
|> rename(columns:{"_value": "value"})

    join(tables: {t1, t2}, on: ["_time"])`
}

async function takeData(id, alg, field, flag) {
    let query

    if (!flag)
        query = buildQuery(id, alg, field)
    else
        query = buildQuery2(alg, field)


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
            let error = 0.0

            for (let i = 0; i < data.length; i++) {
                error += Math.pow((data[i].value - data[i].forecast_value), 2)
            }

            let message
            if(!flag){
                message = `${id} MSE forecast_${field}:` + (error / data.length) + "\n"
            }
            else{
                message = `MSE forecast_${field}:` + (error / data.length) + "\n"
            }

            console.log(`${id} MSE forecast_${field}:` + (error / data.length))
            fs.writeFile('./mse.txt', message, {flag: 'a'},
                err => {
                });
        }
    })
}

async function calcMSE(id, alg) {
    await takeData(id, alg, "temperature", false)
    await new Promise(r => setTimeout(r, 500));
    await takeData(id, alg, "humidity", false)
    await new Promise(r => setTimeout(r, 500));
    await takeData(id, alg, "gas", false)
    await new Promise(r => setTimeout(r, 500));
}

async function totalMSE(alg) {
    await takeData(" ", alg, "temperature", true)
    await new Promise(r => setTimeout(r, 500));
    await takeData(" ", alg, "humidity", true)
    await new Promise(r => setTimeout(r, 500));
    await takeData(" ", alg, "gas", true)
    await new Promise(r => setTimeout(r, 500));
}

let id = ["esp32_nash", "esp32_caio"]
let algorithm = ["FBProphet", "TimeSeriesAnalysis"]

async function cycle() {
    for (let j = 0; j < 2; j++) {
        let flag = 'w'
        if (j === 1) {
            flag = 'a'
        }
        fs.writeFile('./mse.txt', "\nMSE " + algorithm[j] + "\n", {flag: flag}, err => {
        });
        for (let i = 0; i < 2; i++) {
            await calcMSE(id[i], algorithm[j])
            await new Promise(r => setTimeout(r, 2000));
        }
    }



    for (let i = 0; i < 2; i++) {
        fs.writeFile('./mse.txt', "\nMSE totale " + algorithm[i] + "\n", {flag: 'a'}, err => {})
        await totalMSE(algorithm[i])
        await new Promise(r => setTimeout(r, 2000));
    }
}

cycle()




