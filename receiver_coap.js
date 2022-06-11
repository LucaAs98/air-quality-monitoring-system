//Inizializza COAP
const coap = require('coap')
const broker_address = '192.168.1.15'

//Loop dove andiamo a prendere tutto ciò che dobbiamo poi mandare a ThingSpeak
const msIntervallo = 2000
const numLetturePrimaDiCalcoloMedia = 5

//INFLUXDB
const token = '0k-LO5VmaViza7ENc4C_9LIucTtOQmWGA-XWYHewT4yYeIMx01gSei4H-ivjGqtLQ8xgXEjTFn1YCfGXafOY3g=='
const {InfluxDB, Point} = require('@influxdata/influxdb-client')
const url = 'https://eu-central-1-1.aws.cloud2.influxdata.com'

const clientInflux = new InfluxDB({url, token})

let org = 'andrea.cirina@studio.unibo.it'
let bucket = 'iotProject2022'
let writeClient = clientInflux.getWriteApi(org, bucket, 'ns')


async function coapRequest(){

    var options = {
        host: broker_address,
        port: 5683,
        pathname: "/sensordata",
        method: 'GET',
        confirmable: true,
        options: {
            'Content-Format': 'application/json'
        }
    }
    console.log("Sono qui!")
    var req = await coap.request(options)
    console.log("Richiesta fatta!")

    let jsonData

    req.on('response', function (res) {
        console.log('response code', res.code);
        if (res.code !== '2.05') return process.exit(1);

        res.on('data', function () {
            console.log(res.payload)
            jsonData = JSON.parse(res.payload)
        });
        res.on('end', function () {
            if (res.code === '2.05') {
                console.log('[coap] coap ready, request OK');
                console.log(jsonData)
                /*let point = new Point('measurement')
                    .tag('id', 'esp32_nostro')
                    .tag('gps', 'BO')
                    .floatField('temperature', parseFloat(jsonData.temperature))
                    .floatField('humidity', parseFloat(jsonData.humidity))
                    .floatField('gas', parseFloat(jsonData.gas))
                    .floatField('aqi', parseFloat(jsonData.aqi))
                    .floatField('wifi_signal', parseFloat(jsonData.wifi_signal))
                    .floatField('tempOpenWeather', 25.5)

                console.log("Scritto!")
                writeClient.writePoint(point)*/
            } else {
                console.log('[coap] coap res.code=' + res.code);
            }
        });
    })
    req.end();

    setInterval(coapRequest, 5000);
}

coapRequest()

/*//Calcolo media
function average(array) {
    const sum = array.reduce((a, b) => a + b, 0);
    return (sum / array.length) || 0; //Average
}

//Funzione per inviare sul cloud
function mandaSuThingSpeak() {
    //Calcolo medie dei valori
    const average_gas = average(gas_info)
    const average_temp = average(temp_info)
    const average_hum = average(hum_info)

    //Stampa medie su console
    console.log("\n-----------------------" +
        "\nGas average: " + average_gas +
        "\nTemp average: " + average_temp +
        "\nHum average: " + average_hum +
        "\n-----------------------\n")

    //Field ThingSpeak da inviare
    let fields = {field1: average_gas, field2: average_temp, field3: average_hum}
    //Invio vero e proprio
    clientThingSpeak.updateChannel(channelId, fields, function (err, resp) {
        if (!err && resp > 0) {
            console.log('Update successfully. Entry number was: ' + resp);
        } else {
            console.log(err)
        }
    });

    //Reset delle variabili da riempire nuovamente
    gas_info = []
    temp_info = []
    all_temp_info = []
    hum_info = []
    all_hum_info = []
}*/


