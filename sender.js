require('dotenv').config();
let variables = process.env

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

//Quando si connette iniziamo a pubblicare sui topic che ci interessano
clientMQTT.on('connect', () => {
    console.log("Connected")
    const topic1 = "sensor/values"
    const topics = [topic1]

    pubblica(topics)
})

//Funzione che permette la pubblicazione di dati
const msIntervalloDiInvio = 2000

function pubblica(topics) {
    //Loop che pubblica una temp e hum float random tra 6 e 300
    setInterval(function () {
        clientMQTT.publish(topics[0], createMessage().toString(), {
            qos: 0,
            retain: false
        }, (error) => {
            if (error) {
                console.error(error)
            }
        })
    }, msIntervalloDiInvio)
}

//Genera un float random
function getRandomFloat(min, max) {
    const str = (Math.random() * (max - min) + min);

    return parseFloat(str);
}

function createMessage() {
    return '{' +
        '"temperature": "' + getRandomFloat(6, 300) + '",' +
        '"humidity": "' + getRandomFloat(6, 300) + '",' +
        '"gas": "' + getRandomFloat(6, 300) + '",' +
        '"aqi": "' + getRandomFloat(-1, 1.3) + '",' +
        '"wifi_signal": "' + getRandomFloat(6, 300) + '"}'
}
