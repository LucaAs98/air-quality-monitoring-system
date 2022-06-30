const fs = require("fs");

/** Inizializzazione FIREBASE **/
let admin = require("firebase-admin");
let db = admin.firestore();

let mappaCounters = new Map()

//Funzione che crea il messagio da inviare all'esp32
function createDeviceMessage(protocol, sample_frequency, max_gas_value, min_gas_value, delayFlag) {
    return '{ \"protocol\": \"' + getProtocolFromString(protocol) + '\",' +
        '\"sample_frequency\":' + sample_frequency + ',' +
        '\"max_gas_value\":' + max_gas_value + ',' +
        '\"min_gas_value\":' + min_gas_value + ',' +
        '\"delayFlag\":' + delayFlag + '}'
}

//Formattiamo i dati di influx come vogliamo per poterli usare nel nostro codice
function influxDataFormat(data) {
    let newData = []
    data.forEach(obj =>
        newData.push({
            id: obj.id,
            field: obj._field,
            value: obj._value,
        }))
    return newData
}

/* Funzione che dato il protocollo in stringa restituisce il suo numero corrispondente. Abbiamo fatto questo per prenderlo
* più semplicemente dall'esp32 occupando anche meno memoria. */
function getProtocolFromString(protocol) {
    switch (protocol.trim()) {
        case "MQTT":
            return 0;
        case "HTTP":
            return 1;
        case "COAP":
            return 2;
        default:
            return 3;
    }
}

//Prende i delay e poi gli scrive su file excel
async function getAndWriteDelays() {
    let delays = await getDelays()
    scriviSuExcel(delays)
}

//Funzione per prendere da firestore i delay
async function getDelays() {
    let allDelays = [];
    let ids = ["esp32_caio", "esp32_nash"]
    for (let i = 0; i < ids.length; i++) {
        const resultQuery = await db.collection('delay_mess').doc(ids[i]).collection("tempi").get();
        resultQuery.forEach((result) => {
            let resD = result.data()
            resD.id = ids[i]
            allDelays.push(resD)
        })
    }
    return allDelays
}

//Funzione per inviare i delay a firestore
async function sendDelays(id, delay, protocol) {
    console.log("Delay inviato! " + id + " -> " + protocol + "  Delay _> " + delay)
    await db.collection('delay_mess').doc(id).collection('tempi').doc((new Date()).toString()).set({
        protocol: protocol,
        delay: delay
    })
}

//Funzione per inviare i delay a firestore
async function sendPacketNumber(id, realPackets) {
    console.log("Numero pacchetti salvato su firestore! " + id)
    await db.collection('num_pacchetti').doc(id).set({
        MQTT_arr: mappaCounters.get(id).MQTT,
        MQTT_real: realPackets.MQTT,
        HTTP_arr: mappaCounters.get(id).HTTP,
        HTTP_real: realPackets.HTTP,
        COAP_arr: mappaCounters.get(id).COAP,
        COAP_real: realPackets.COAP,
    })
}

function scriviSuExcel(delays) {
    let writeStream = fs.createWriteStream("delays.xlsx");
    let header = "ID" + "\t" + " Protocol" + "\t" + "Value" + "\n";
    writeStream.write(header);

    delays.forEach(obj => {
        let row = "" + obj.id + "\t" + " " + obj.protocol + "\t" + obj.delay + "\n"
        writeStream.write(row);
    })

    writeStream.close();
}

function incrementaCounterMessaggi(id, protocollo){
    if (!mappaCounters.has(id)){
        mappaCounters.set(id, {MQTT: 0, HTTP: 0, COAP: 0})
    }

    let countersObj = mappaCounters.get(id)
    switch (protocollo) {
        case "MQTT": {
            countersObj.MQTT++
            break;
        }
        case "HTTP": {
            countersObj.HTTP++
            break;
        }
        case "COAP": {
            countersObj.COAP++
            break;
        }
    }
    mappaCounters.set(id, countersObj)
    console.log("Mappa modificata: " + JSON.stringify(mappaCounters.get(id)))
}

function resetAllCounters() {
    mappaCounters = new Map()
}

function resetCounterId(id){
    mappaCounters.set(id, {MQTT: 0, HTTP: 0, COAP: 0})
}

module.exports = {getAndWriteDelays, sendDelays, createDeviceMessage, influxDataFormat, incrementaCounterMessaggi, resetAllCounters, resetCounterId, sendPacketNumber}