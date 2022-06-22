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

//Set del menù del bot ------------------------------------------------- DA FINIRE!!!!!
bot.setMyCommands([
    {command: '/start', description: 'Start the bot'},
    {command: '/info', description: 'info'},
    {command: '/help', description: 'help'},
    {command: '/report', description: 'report'},
    {command: '/temperature', description: 'temperature'},
    {command: '/humidity', description: 'humidity'},
    {command: '/wifi_strength', description: 'wifi_strength'},
    {command: '/aqi', description: 'aqi'},
    {command: '/periodic_report', description: 'periodic_report'},
    {command: '/stop', description: 'Stop the report'},
    {command: '/change_board', description: 'change_board'},
    {command: '/disconnect', description: 'disconnect'},
])


getUserFirestore()

//Per osservare gli errori di pooling
bot.on("polling_error", console.log);

//Start
bot.onText(/\/start/, async (msg) => {
    let chatId = msg.chat.id;

    if (!activeUsers.has(chatId)) {
        //Prendiamo i dispositivi registrati su firestore e ritorniamo le options per visualizzarli come bottoni sulla tastiera
        let options = await listOfDevice()
        //Mandiamo il messaggio e cambiamo la tastiera su telegram
        bot.sendMessage(chatId, "Select a device:", options).then(res => {
            //Il messaggio successivo conterrà l'id del device scelto. Stiamo in ascolto per una sola volta
            bot.once('message', async (msg) => {
                setEsp(chatId, msg) //Registriamo l'esp scelto per tale utente.
            });
        }).catch(err => {
            bot.sendMessage(chatId, `Oops! An error has occured in /start. Try again` + err);
        });
    } else {
        bot.sendMessage(chatId, `Device already selected!`);
    }
});

bot.onText(/\/info/, async (msg) => {
    let chatId = msg.chat.id;
    let message = `<b>Air Quality monitoring Bot</b>\n/help per vedere la lista dei comandi`
    bot.sendMessage(chatId, message, {parse_mode: "HTML"})
});

bot.onText(/\/help/, async (msg) => {
    let chatId = msg.chat.id
    let message = "Comando da fare!"
    bot.sendMessage(chatId, message)
})

function modifyTime(action, mappaValori) {
    let operazione = action.substring(0, 3)
    let tempo = action.substring(3).toLowerCase()
    let done = false;
    switch (operazione) {
        case 'piu': {
            mappaValori[tempo]++
            break;
        }
        case 'men': {
            mappaValori[tempo]--
            break;
        }
        case "fat": {
            done = true;
            break;
        }
    }
    return done
}

function getSelectTimeKeyboard(mappaValori) {
    return [[//+
        {text: "+", callback_data: "piuOre1"},
        {text: "+", callback_data: "piuOre2"},
        {text: "+", callback_data: "piuMin1"},
        {text: "+", callback_data: "piuMin2"},
    ],
        [ //Valori
            {text: mappaValori["ore1"], callback_data: mappaValori["ore1"]},
            {text: mappaValori["ore2"] + "  H", callback_data: mappaValori["ore2"]},
            {text: mappaValori["min1"], callback_data: mappaValori["min1"]},
            {text: mappaValori["min2"] + "  M", callback_data: mappaValori["min2"]},
        ],
        [//-
            {text: "-", callback_data: "menOre1"},
            {text: "-", callback_data: "menOre2"},
            {text: "-", callback_data: "menMin1"},
            {text: "-", callback_data: "menMin2"},
        ],
        //Done
        [
            {text: "Done", callback_data: "fat"}
        ]
    ]
}


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
    let mappaValori = {"ore1": 0, "ore2": 0, "min1": 0, "min2": 0}
    let chatId = msg.chat.id;
    let message = "How often do you want to be notified? Select it here:"
    let initOpts = {
        "parse_mode": "Markdown",
        "reply_markup":
            JSON.stringify({
                "inline_keyboard": getSelectTimeKeyboard(mappaValori)
            })
    } //Option iniziali per il messaggio da visualizzare

    if (initBoard(chatId)) {
        //Controlla se l'utente non abbia già un report attivo
        if (!mapJobs.has(chatId)) {
            //catena di istruzioni per creare il report
            let f = new Date()
            bot.sendMessage(chatId, message, initOpts).then(res => {
                bot.on('callback_query', async function onCallbackQuery(callbackQuery) {
                    console.log("Sto selezionando il tempo...")
                    let erroreData = false;
                    let messaggioAlert = "You are selecting the time ..."
                    const action = callbackQuery.data;
                    const msg = callbackQuery.message;
                    let text = "How often do you want to be notified? Select it here:";

                    let done = modifyTime(action, mappaValori)


                    if (!done) {
                        //Option per il messaggio quando l'utente sta ancora selezionando il tempo
                        let optsNonDone = {
                            chat_id: msg.chat.id,
                            message_id: msg.message_id,
                            "parse_mode": "Markdown",
                            "reply_markup":
                                JSON.stringify({
                                    "inline_keyboard": getSelectTimeKeyboard(mappaValori)
                                })
                        };
                        bot.editMessageText(text, optsNonDone);
                    } else {
                        let tempoDaArray = "" + mappaValori["ore1"] + mappaValori["ore2"] + "h" + mappaValori["min1"] + mappaValori["min2"] + "m"
                        const areAllZeros = (currentValue) => currentValue === 0;
                        if (!Array.from(Object.values(mappaValori)).every(areAllZeros)) {
                            let pattern = /(([0-1][0-9]|2[0-3])h)([0-5][0-9]m)/gi //pattern
                            let time = tempoDaArray.match(pattern); //estrazione del pattern
                            //Controllo per verificare che la stringa in input segua abbia seguito il pattern
                            if (time == null) {
                                erroreData = true;
                                messaggioAlert = "Time not allowed!"
                            } else {
                                //options per il messaggio quando l'utente ha cliccato "Done" ed è tutto ok
                                let optsDone = {
                                    chat_id: msg.chat.id,
                                    message_id: msg.message_id,
                                };
                                //Ci ricaviamo il tempo(ore, minuti e secondi)
                                let spl = time[0].split(/h|m/)
                                let h = parseInt(spl[0])
                                let m = parseInt(spl[1])

                                createCronJob(chatId, f, h, m)
                                await db.collection('telegramuser').doc(chatId + "").update({
                                    report: {
                                        h: h,
                                        m: m,
                                    }
                                }).catch(err => console.log(err))
                                bot.removeListener("callback_query")
                                messaggioAlert = "Time selected successfully!"
                                bot.editMessageText('Report started!', optsDone);
                            }
                        } else {
                            erroreData = true;
                            messaggioAlert = "Tempo non ammesso! Sono tutti zeri!"
                        }
                    }
                    bot.answerCallbackQuery(callbackQuery.id, {text: messaggioAlert, show_alert: erroreData})
                });
            })
        } else {
            bot.sendMessage(chatId, 'You already have an active periodic record!');
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
            bot.sendMessage(chatId, 'Report stopped!');
            await db.collection('telegramuser').doc(chatId + "").update({report: null}).catch(err => console.log(err))
        } else {
            bot.sendMessage(chatId, 'You don\'t have an active periodic report!');
        }
    }
});

bot.onText(/\/change_board/, async (msg) => {
    let chatId = msg.chat.id;
    if (initBoard(chatId)) {
        let options = await listOfDevice()
        bot.sendMessage(chatId, "Select a device:", options).then(res => {
            bot.once('message', async (msg) => {
                changeEsp(chatId, msg)
            });
        }).catch(err => {
            bot.sendMessage(chatId, `Oops! An error has occured in change_board. Try again ` + err);
        })
    }
});

//Stoppa il report periodico
bot.onText(/\/disconnect/, async (msg) => {
    let chatId = msg.chat.id;
    if (initBoard(chatId)) {
        await db.collection('telegramuser').doc(chatId + "").delete()
        activeUsers.delete(chatId)
        if (mapJobs.has(chatId)) {
            //Stop e rimozione del job
            mapJobs.get(chatId).stop()
            mapJobs.delete(chatId)
        }
        bot.sendMessage(chatId, 'Report stopped!');
        bot.sendMessage(chatId, 'Goodbye! \u{1F44B}\u{1F44B}\u{1F44B}\n\n Type /start to start over!');
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
                    createCronJob(id, new Date(), resD.report.h, resD.report.m)
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
                bot.sendMessage(chatId, "There are no data for the moment!");
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
function addTime(d, h, m) {
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

function createCronJob(chatId, data, h, m) {
    data = addTime(data, h, m) //Ci calcoliamo quando deve essere visualizzato il nuovo report

    let strCronTime = createCronTimeString(data) //Creazione della string

    //Creazione del job periodico

    let job = new CronJob(strCronTime, async function () {
        let g = new Date()
        //Calcolo e settaggio del prossimo tempo di esecuzione
        g = addTime(g, h, m)
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
            bot.sendMessage(key, '\u{26A0}\u{26A0}\u{26A0} ATTENTION! \u{26A0}\u{26A0}\u{26A0}\n' +
                'Critical AQI level for device: ' + idEsp)
    })
}

function initBoard(chatId) {
    if (!activeUsers.has(chatId)) {
        bot.sendMessage(chatId, "You have not yet selected the device to monitor! Type /start")
        return false
    } else
        return true
}

/* Prendiamo i dispositivi registrati su firestore e restituiamo un bottone per ognuno. La lista dei bottoni verrà visualizzata
* nella tastiera quando un utente dovrà aggiungere un esp da seguire o quando vorrà cambiare l'esp seguito. */
async function listOfDevice() {
    //Aggiorna i device registrati
    await updateDevices()
    let buttonList = [] //Lista che conterrà ogni bottone da visualizzare nella tastiera

    devices.forEach((coord, board) => buttonList.push([{text: board}]))

    //Ritorniamo le options per la tastiera
    return {
        "parse_mode": "Markdown",
        "reply_markup": {
            "keyboard": buttonList,
            "one_time_keyboard": true
        },
    }
}

//Setta l'esp scelto da telegram per tale utente, salviamo il tutto su firestore
async function setEsp(chatId, msg) {
    if (!activeUsers.has(chatId)) {
        let textMsg = msg.text
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
                    result = false
                }
            } else {
                result = false
            }
        } while (result)
        if (!activeUsers.has(chatId)) {
            bot.sendMessage(chatId, "Input Error!")
        } else {
            bot.sendMessage(chatId, "Device selected successfully!")
            //Creaimo un doc chiamato con l'id e salviamo all'interno di esso tutti i dati relativi a quel determinato device
            let request = await db.collection('telegramuser').doc("" + chatId).set(activeUsers.get(chatId)).catch(err => console.log(err))
        }
    } else {
        bot.sendMessage(chatId, `The device selection has already been made!`);
    }
}

async function changeEsp(chatId, msg) {
    if (activeUsers.has(chatId)) {
        let textMsg = msg.text.trim()
        let iteratorDevices = devices.keys()
        let flagInterno = false
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
                    result = false
                    flagInterno = true
                }
            } else {
                result = false
            }
        } while (result)

        if (!flagInterno) {
            bot.sendMessage(chatId, "Input Error!")
        } else {
            bot.sendMessage(chatId, "Device selected successfully!")
            //Creaimo un doc chiamato con l'id e salviamo all'interno di esso tutti i dati relativi a quel determinato device
            let request = await db.collection('telegramuser').doc("" + chatId).set(activeUsers.get(chatId)).catch(err => console.log(err))
        }
        flagChange = false
    } else {
        bot.sendMessage(chatId, `You haven't selected your device yet!`);
    }
}

module.exports = sendAlerts