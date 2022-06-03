require('dotenv').config();
let variables = process.env
//INFLUXDB
const token = variables.TOKEN_INFLUX
const url = variables.URL_INFLUX

const {InfluxDB, Point} = require('@influxdata/influxdb-client')
const clientInflux = new InfluxDB({url, token})

let org = process.env.ORG_INFLUX
let bucket = process.env.BUCKET_INFLUX

let queryClient = clientInflux.getQueryApi(org)
let fluxQuery = `from(bucket: "iotProject2022")
 |> range(start: -10d)
 |> filter(fn: (r) => r._measurement == "measurement")`

let data = []

queryClient.queryRows(fluxQuery, {
    next: (row, tableMeta) => {
        const tableObject = tableMeta.toObject(row)
        data.push(tableObject)
    },
    error: (error) => {
        console.error('\nError', error)
    },
    complete: () => {
        console.log(data)
        console.log('\nSuccess')
    },
})
