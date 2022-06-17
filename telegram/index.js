//Elimina stampa di librerie obsolete
process.env.NTBA_FIX_319 = 1;
//require
require('dotenv').config({path: '../.env'});
const TelegramBot = require('node-telegram-bot-api');
const CronJob = require('cron').CronJob;
const CronTime = require('cron').CronTime;

/** Inizializzazione FIREBASE **/
let admin = require("firebase-admin");
let serviceAccount = require("../progettoiot2022-firebase-adminsdk-hoxdu-085c6305e8.json");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://progettoiot2022-default-rtdb.europe-west1.firebasedatabase.app"
});
let db = admin.firestore();

//INFLUXDB
let variables = process.env
const token = variables.TOKEN_INFLUX
const url = variables.URL_INFLUX
const {InfluxDB, Point} = require('@influxdata/influxdb-client')
const clientInflux = new InfluxDB({url, token})
let org = process.env.ORG_INFLUX
let bucket = process.env.BUCKET_INFLUX
let queryClient = clientInflux.getQueryApi(org)

//Telegram toker
const tokenT = '5413400956:AAFa429GqUMqDwAKwU0ZcSi4rQOK_9UgGRI';
// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(tokenT, {polling: true});

//mappa lista dei job attivi
let mapJobs = new Map()

//lista utenti attivi
let activeUsers = new Map()
let devices = new Map()

//flag per il change o il set
let flagChange = false

getUserFirestore()

//Per osservare gli errori di pooling
bot.on("polling_error", console.log);

//Start (da rivedere)
bot.onText(/\/start/, async (msg) => {
    let chatId = msg.chat.id;

    if (!activeUsers.has(chatId)) {
        let strMsg = await listOfDevice(true)
        bot.sendMessage(chatId, strMsg).then(res => {
            bot.onText(/\/set (.+)/, async (msg) => setEsp(chatId, msg));
        }).catch(err => {
            bot.sendMessage(chatId, `Oops! An error has occured. Try again` + err);
        })
    } else {
        bot.sendMessage(msg.chat.id, `La selezione della scheda è stata già effettuata!`);
    }
});

bot.onText(/\/info/, async (msg) => {
    let message = `<b>Air Quality monitoring Bot</b>\n/help per vedere la lista dei comandi`
    bot.sendMessage(chatId, message, {parse_mode: "HTML"})
});

bot.onText(/\/help/, async (msg) => {
    let message = "Non ancora inizializzato!"
    bot.sendMessage(chatId, message)
});

//Singolo report
bot.onText(/\/report/, async (msg) => {
    let chatId = msg.chat.id;
    if (initBoard(chatId)) {
        await sendQuery(chatId, 0)
    }
});

//Report per solo la temperatura
bot.onText(/\/temperature/, async (msg) => {

    let chatId = msg.chat.id;
    if (initBoard(chatId)) {
        await sendQuery(chatId, 1)
    }
});

//Report per solo l'umidità'
bot.onText(/\/humidity/, async (msg) => {

    let chatId = msg.chat.id;
    if (initBoard(chatId)) {
        await sendQuery(chatId, 2)
    }
});

//Report per il segnale del wifi
bot.onText(/\/wifi_strength/, async (msg) => {

    let chatId = msg.chat.id;
    if (initBoard(chatId)) {
        await sendQuery(chatId, 3)
    }
});

//Report per solo la qualità dell'aria
bot.onText(/\/aqi/, async (msg) => {
    let chatId = msg.chat.id;
    if (initBoard(chatId)) {
        await sendQuery(chatId, 4)
    }
});

//Report periodico
bot.onText(/\/periodic_report/, async (msg) => {
    let chatId = msg.chat.id;
    if (initBoard(chatId)) {
        //Controlla se l'utente non abbia già un report attivo
        if (!mapJobs.has(chatId)) {
            //catena di istruzioni per creare il report
            let f = new Date()
            bot.sendMessage(
                msg.chat.id,
                `Ciao! ${msg.chat.first_name}, ogni quanto vuoi essere notificato? Scrivi la risposta in questo formato -> /save **h**m**s`
            ).then(res => {
                //Memorizzazione del tempo
                bot.onText(/\/save (.+)/, async (msg) => {
                    let pattern = /(([0-1][0-9]|2[0-3])h)([0-5][0-9]m)([0-5][0|5]s)/gi //pattern
                    let time = msg.text.match(pattern); //estrazione del pattern
                    //Controllo per verificare che la stringa in input segua abbia seguito il pattern
                    if (time == null)
                        bot.sendMessage(msg.chat.id, 'Input error!');
                    else {
                        console.log("3casasdasdasdadas")
                        //Ci ricaviamo il tempo(ore, minuti e secondi)
                        let spl = time[0].split(/h|m|s/)
                        let h = parseInt(spl[0])
                        let m = parseInt(spl[1])
                        let s = parseInt(spl[2])

                        createCronJob(chatId, f, h, m, s)
                        await db.collection('telegramuser').doc(chatId + "").update({
                            report: {
                                h: h,
                                m: m,
                                s: s
                            }
                        }).catch(err => console.log(err))
                        bot.sendMessage(chatId, 'Report avviato!');
                    }
                });
            }).catch(() => {
                bot.sendMessage(msg.chat.id, `Oops! An error has occured. Try again`);
            })
        } else {
            bot.sendMessage(chatId, 'Hai già un report periodico attivo!');
        }
    }
});

//Stoppa il report periodico
bot.onText(/\/stop/, async (msg) => {
    let chatId = msg.chat.id;
    if (initBoard(chatId)) {
        //Controllo per verificare che esiste il job dell'utente
        if (mapJobs.has(chatId)) {
            //Stop e rimozione del job
            mapJobs.get(chatId).stop()
            mapJobs.delete(chatId)
            bot.sendMessage(chatId, 'Report stoppato!');
            await db.collection('telegramuser').doc(chatId + "").update({report: null}).catch(err => console.log(err))
        } else {
            bot.sendMessage(chatId, 'Non hai un report periodico attivo!');
        }
    }
});

bot.onText(/\/change_board/, async (msg) => {
    let chatId = msg.chat.id;
    if (initBoard(chatId)) {
        let strMsg = await listOfDevice(false)
        bot.sendMessage(chatId, strMsg).then(res => {
            bot.onText(/\/change (.+)/, async (msg) => changeEsp(chatId, msg));
        }).catch(err => {
            bot.sendMessage(chatId, `Oops! An error has occured. Try again` + err);
        })
    }
});

//Stoppa il report periodico
bot.onText(/\/disconnect/, async (msg) => {
    let chatId = msg.chat.id;
    if (initBoard(chatId)) {
        await db.collection('telegramuser').doc(chatId + "").delete()
        activeUsers.delete(chatId)
        bot.sendMessage(chatId, 'Arrivederci! \u{1F44B}\u{1F44B}\u{1F44B}\n\n Digita /start per rincominciare');

    }
});

async function getUserFirestore() {

    async function gUF() {
        const usersCollection = await db.collection('telegramuser').get();
        //Per ognuno di essi assegnamo tutti i parametri necessari.
        usersCollection.forEach((result) => {
            if (result.id !== "default") {
                let resD = result.data()
                let id = parseInt(result.id)
                activeUsers.set(id, {scheda: resD.scheda, report: resD.report})
                if (resD.report !== null) {
                    createCronJob(id, new Date(), resD.report.h, resD.report.m, resD.report.s)
                }
            }
        })
    }

    await gUF()
    await updateDevices()
}

//Effettua la query su influx
async function sendQuery(chatId, idQuery) {
    let data = []

    let query = createQuery(chatId, idQuery)

    await queryClient.queryRows(query, {
        next: (row, tableMeta) => {
            const tableObject = tableMeta.toObject(row)
            data.push(tableObject)
        },
        error: (error) => {
            bot.sendMessage(chatId, "Error!");
        },
        complete: () => {
            if (data.length > 0) {
                //Creazione del messaggio da mandare all'utente
                let mess = createMessage(idQuery, data, activeUsers.get(chatId).scheda)
                bot.sendMessage(chatId, mess);
            } else {
                bot.sendMessage(chatId, "Non sono presenti dati per il momento!");
            }
        },
    })
}

function createQuery(chatId, idQuery) {

    let nameBoard = activeUsers.get(chatId).scheda

    switch (idQuery) {
        case 0:
            return `from(bucket: "iotProject2022") |> range(start: -5m) 
            |> filter(fn: (r) => r.id == "${nameBoard}" and r._field != "gas" )
            |>group(columns: ["_field"]) |> mean()`
        case 1:
            return `from(bucket: "iotProject2022") |> range(start: -5m) 
            |> filter(fn: (r) => r.id == "${nameBoard}" and r._field == "temperature" )
            |>group(columns: ["_field"]) |> mean()`
        case 2:
            return `from(bucket: "iotProject2022") |> range(start: -5m)
            |> filter(fn: (r) => r.id == "${nameBoard}" and r._field == "humidity" )
            |>group(columns: ["_field"]) |>mean()`
        case 3:
            return `from(bucket: "iotProject2022") |> range(start: -5m)
            |> filter(fn: (r) => r.id == "${nameBoard}" and r._field == "wifi_signal" )
            |>group(columns: ["_field"]) |>mean()`
        case 4:
            return `from(bucket: "iotProject2022") |> range(start: -5m)
            |> filter(fn: (r) => r.id == "${nameBoard}" and r._field == "aqi" )
            |>group(columns: ["_field"]) |>mean()`
    }


}

//Creazione del messaggio in base alla query
function createMessage(idMessage, data, idEsp) {

    let board = devices.get(idEsp)
    let mess = board + '\n\n'

    switch (idMessage) {
        case 0: { //Query completa
            let ordMes = Array(5)
            //Ordinamento dei valori
            for (let measure of data) {
                switch (measure._field) {
                    case "temperature":
                        ordMes[0] = '\u{1F321}' + " Temperature: " + measure._value.toFixed(2) + " °C"
                        break;
                    case "tempOpenWeather":
                        ordMes[1] = '\u{1F321}' + " Temperature OpenWeather: " + measure._value.toFixed(2) + " °C"
                        break;
                    case "humidity":
                        ordMes[2] = '\u{1F4A6}' + " Humidity: " + measure._value.toFixed(2) + " %"
                        break;
                    case "aqi":
                        ordMes[3] = '\u{2757}' + " Air Quality Index: " + measure._value.toFixed(2) + " AQI"
                        break;
                    case "wifi_signal":
                        ordMes[4] = '\u{1F4F6}' + " WiFi signal strength: " + measure._value.toFixed(2) + " dBm"
                        break;
                }
            }


            //creazione stringa
            for (let arr of ordMes) {
                mess += arr + '\n'
            }
            return mess
        }
        case 1: {
            mess += '\u{1F321}' + " Temperature: " + data[0]._value.toFixed(2) + " °C"
            return mess
        }
        case 2: {
            mess += '\u{1F4A6}' + " Humidity: " + data[0]._value.toFixed(2) + " %"
            return mess
        }
        case 3: {
            mess += '\u{1F4F6}' + " WiFi signal strength: " + data[0]._value.toFixed(2) + " dBm"
            return mess
        }
        case 4: {
            mess += '\u{2757}' + " Air Quality Index: " + data[0]._value.toFixed(2) + " AQI"
            return mess
        }
    }
}

//Funzione per aggiungere il tempo a una data
function addTime(d, h, m, s) {
    d.setSeconds(d.getSeconds() + s);
    d.setMinutes(d.getMinutes() + m);
    d.setHours(d.getHours() + h);
    return d
}

//Crea la stringa per il tempo per cron
function createCronTimeString(data) {
    let seconds = data.getSeconds()
    let minutes = data.getMinutes()
    let hours = data.getHours()

    return seconds + ' ' + minutes + ' ' + hours + ' * * *'
}

function createCronJob(chatId, data, h, m, s) {
    data = addTime(data, h, m, s) //Ci calcoliamo quando deve essere visualizzato il nuovo report

    let strCronTime = createCronTimeString(data) //Creazione della string

    //Creazione del job periodico

    let job = new CronJob(strCronTime, async function () {
        let g = new Date()
        //Calcolo e settaggio del prossimo tempo di esecuzione
        g = addTime(g, h, m, s)
        this.setTime(new CronTime(createCronTimeString(g)))
        await sendQuery(chatId, 0)
    });

    //Start del job
    job.start();
    //Aggiunta del job ala mappa di quelli attivi
    mapJobs.set(chatId, job)
}

//Metodo che prende tutti i device da firebase
async function updateDevices() {
    const devicesCollection = await db.collection('device').get();
    //Per ognuno di essi assegnamo tutti i parametri necessari.
    devicesCollection.forEach((result) => {
        if (result.id !== "default")
            devices.set(result.id, result.data().city)
    })
}

function sendAlerts(alerts) {
    for (let al of alerts) {
        avvisaUtenti(al.id)
    }
}

function avvisaUtenti(idEsp) {

    activeUsers.forEach((value, key) => {
        if (value.scheda === idEsp)
            bot.sendMessage(key, '\u{26A0}\u{26A0}\u{26A0} ATTENZIONE \u{26A0}\u{26A0}\u{26A0}\n' +
                'Livello AQI critico per scheda: ' + idEsp)
    })
}

function initBoard(chatId) {
    if (!activeUsers.has(chatId)) {
        bot.sendMessage(chatId, "Non hai ancora selezionato la scheda da monitorare! Digita /start")
        return false
    } else
        return true
}

async function listOfDevice(set) {
    let strMsg = "Seleziona un dispositivo presente nella seguente lista:\n"
    await updateDevices()

    devices.forEach((coord, board) =>
        strMsg += board + "\n"
    )

    if (set)
        strMsg += "Digita /set nomeDispositivo"
    else
        strMsg += "Digita /change nomeDispositivo"

    return strMsg
}

async function setEsp(chatId, msg) {

    if (!activeUsers.has(chatId)) {
        let textMsg = msg.text.substring(4).trim()
        let iteratorDevices = devices.keys()
        let result = true
        let valueIt
        do {
            valueIt = iteratorDevices.next()
            if (!valueIt.done) {
                if (textMsg === valueIt.value) {
                    let jsonData = {
                        scheda: textMsg,
                        report: null
                    }
                    activeUsers.set(chatId, jsonData)
                    console.log(activeUsers)
                    result = false
                }
            } else {
                result = false
            }
        } while (result)

        if (!activeUsers.has(chatId)) {
            bot.sendMessage(chatId, "Errore nell'input!")
        } else {
            bot.sendMessage(chatId, "Scelta memorizzata!")
            //Creaimo un doc chiamato con l'id e salviamo all'interno di esso tutti i dati relativi a quel determinato device
            let request = await db.collection('telegramuser').doc("" + chatId).set(activeUsers.get(chatId)).catch(err => console.log(err))
        }
    } else {
        bot.sendMessage(chatId, `La selezione della scheda è stata già effettuata!`);
    }

}

async function changeEsp(chatId, msg) {

    if (activeUsers.has(chatId)) {
        let textMsg = msg.text.substring(8).trim()
        let iteratorDevices = devices.keys()
        let flagInterno = false
        let result = true
        let valueIt
        do {
            valueIt = iteratorDevices.next()
            if (!valueIt.done) {
                console.log(textMsg)
                console.log(valueIt.value)
                console.log(textMsg === valueIt.value)
                if (textMsg === valueIt.value) {
                    let jsonData = {
                        scheda: textMsg,
                        report: null
                    }
                    activeUsers.set(chatId, jsonData)
                    console.log(activeUsers)
                    result = false
                    flagInterno = true
                }
            } else {
                result = false
            }
        } while (result)

        if (!flagInterno) {
            bot.sendMessage(chatId, "Errore nell'input!")
            console.log("miaoooo")
        } else {
            bot.sendMessage(chatId, "Scelta memorizzata!")
            //Creaimo un doc chiamato con l'id e salviamo all'interno di esso tutti i dati relativi a quel determinato device
            let request = await db.collection('telegramuser').doc("" + chatId).set(activeUsers.get(chatId)).catch(err => console.log(err))
        }

        flagChange = false
    } else {
        bot.sendMessage(chatId, `Non hai ancora selezionato la tua scheda`);
    }

}

module.exports = sendAlerts