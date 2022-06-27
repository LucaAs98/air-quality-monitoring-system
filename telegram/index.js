//Elimina stampa di librerie obsolete
process.env.NTBA_FIX_319 = 1;

require('dotenv').config({path: '../.env'});
const TelegramBot = require('node-telegram-bot-api');
const CronJob = require('cron').CronJob;
const CronTime = require('cron').CronTime;

//Definizione delle costanti
const REPORT = "report"
const TEMP = "temperature"
const HUM = "humidity"
const RSSI = "wifi_signal"
const AQI = "aqi"
const tempo_report = 5  //Tempo entro la quale prendere i dati per i vari report

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

/** Inizializzazione Telegram **/
const tokenT = '5413400956:AAFa429GqUMqDwAKwU0ZcSi4rQOK_9UgGRI';
const bot = new TelegramBot(tokenT, {polling: true});
let mapJobs = new Map()         //Mappa lista dei job attivi
let activeUsers = new Map()     //Lista utenti attivi
let devices = new Map()         //Mappa dei device (key=ID, value=location)

//Set del menù del bot
bot.setMyCommands([
    {command: '/start', description: 'Start the bot'},
    {command: '/report', description: 'Report'},
    {command: '/temperature', description: 'temperature'},
    {command: '/humidity', description: 'humidity'},
    {command: '/wifi_strength', description: 'wifi_strength'},
    {command: '/aqi', description: 'aqi'},
    {command: '/periodic_report', description: 'periodic_report'},
    {command: '/stop', description: 'Stop the report'},
    {command: '/change_board', description: 'change_board'},
    {command: '/disconnect', description: 'disconnect'},
])

//Aggiorna gli utenti attivi del bot
updateUsersAndDevices()

//Per osservare gli errori di pooling
bot.on("polling_error", console.log);

//Quando riceve il messaggio start può selezionare il device da "seguire"
bot.onText(/\/start/, async (msg) => {
    let chatId = msg.chat.id;   //Prendiamo l'id della chat
    //Se la mappa degli utenti attivi non contiene già l'utente
    if (!activeUsers.has(chatId)) {
        //Prendiamo i dispositivi registrati su firestore e ritorniamo le options per visualizzarli come bottoni sulla tastiera
        let options = await listOfDevice()
        //Mandiamo il messaggio e cambiamo la tastiera su telegram
        bot.sendMessage(chatId, "Select a device:", options).then(res => {
            //Il messaggio successivo conterrà l'id del device scelto. Stiamo in ascolto per una sola volta
            bot.once('message', async (msg) => {
                setEsp(chatId, msg)                 //Registriamo l'esp scelto per tale utente.
            });
        }).catch(err => {
            bot.sendMessage(chatId, `Oops! An error has occured in /start. Try again` + err);
        });
    } else {
        //Altrimenti significa che ha già selezionato il device
        bot.sendMessage(chatId, `Device already selected!`);
    }
});

//Quando riceve il messaggio report, restituisce il singolo report
bot.onText(/\/report/, async (msg) => {
    let chatId = msg.chat.id;
    //Se ha selezionato il device da "seguire"
    if (initBoard(chatId)) {
        //Inviamo il report singolo per il device scelto
        await sendQuery(chatId, REPORT)
    }
});

//Report per solo la temperatura
bot.onText(/\/temperature/, async (msg) => {
    let chatId = msg.chat.id;
    if (initBoard(chatId)) {
        await sendQuery(chatId, TEMP)
    }
});

//Report per solo l'umidità'
bot.onText(/\/humidity/, async (msg) => {
    let chatId = msg.chat.id;
    if (initBoard(chatId)) {
        await sendQuery(chatId, HUM)
    }
});

//Report per il segnale del wifi
bot.onText(/\/wifi_strength/, async (msg) => {
    let chatId = msg.chat.id;
    if (initBoard(chatId)) {
        await sendQuery(chatId, RSSI)
    }
});

//Report per solo la qualità dell'aria
bot.onText(/\/aqi/, async (msg) => {
    let chatId = msg.chat.id;
    if (initBoard(chatId)) {
        await sendQuery(chatId, AQI)
    }
});

//Quando riceve il messaggio periodic_report, inizia a ricevere il report ogni tot.
bot.onText(/\/periodic_report/, async (msg) => {
    let chatId = msg.chat.id;
    //Oggetto contenente i valori delle ore e dei minuti che l'utente sceglie per ricevere il report
    let mappaValori = {"ore1": 0, "ore2": 0, "min1": 0, "min2": 0}
    let message = "How often do you want to be notified? Select it here:"   //Messaggio iniziale
    //Option iniziali per visualizzare la tastiera corretta
    let initOpts = {
        "parse_mode": "Markdown",
        "reply_markup":
            JSON.stringify({
                "inline_keyboard": getSelectTimeKeyboard(mappaValori)
            })
    }

    if (initBoard(chatId)) {
        //Controlla se l'utente non abbia già un report attivo
        if (!mapJobs.has(chatId)) {
            //Inizia la catena di istruzioni per creare il report
            let f = new Date()                                          //Prendiamo la data/orario corrente
            //Inviamo il messaggio iniziale e visualizziamo la "tastiera" per selezionare l'orario
            bot.sendMessage(chatId, message, initOpts).then(res => {
                //Quando l'utente cambia quanche valore entriamo qui
                bot.on('callback_query', async function onCallbackQuery(callbackQuery) {
                    //Conterrà true se ci sarà qualche errore nella formattazione della data
                    let erroreData = false;
                    let messaggioAlert = "You are selecting the time ..."
                    //Prendiamo "piuOra" oppure "menOra" ecc...
                    const action = callbackQuery.data;
                    const msg = callbackQuery.message;

                    //Done è uguale a true se l'utente ha cliccato "Done", altrimenti andiamo a modificare i valori nella nostra tastiera inline
                    let done = modifyTime(action, mappaValori)

                    //Se l'utente non ha terminato dobbiamo aggiornare la tastiera inline con i nuovi valori
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
                        //Modifichiamo la tastiera inline
                        bot.editMessageText(message, optsNonDone);
                    } else {
                        //Se l'utente ha terminato la selezione del tempo allora andiamo ad effettuare le seguenti operazioni
                        //Formattiamo correttamente il tempo
                        let tempoDaArray = "" + mappaValori["ore1"] + mappaValori["ore2"] + "h" + mappaValori["min1"] + mappaValori["min2"] + "m"
                        //Controlliamo che non siano tutti zeri (tempo non valido per il report)
                        const areAllZeros = (currentValue) => currentValue === 0;
                        if (!Array.from(Object.values(mappaValori)).every(areAllZeros)) {
                            //Se non sono tutti zeri, controlliamo che il tempo sia formattato correttamente
                            let pattern = /(([0-1][0-9]|2[0-3])h)([0-5][0-9]m)/gi   //Pattern
                            let time = tempoDaArray.match(pattern);                 //Estrazione del pattern
                            //Controllo per verificare che la stringa in input segua il pattern
                            if (time == null) {
                                //Significa che il tempo è formattato male, avvisiamo l'utente
                                erroreData = true;
                                messaggioAlert = "Time not allowed!"
                            } else {
                                //options per il messaggio quando l'utente ha cliccato "Done" ed è tutto ok
                                let optsDone = {
                                    chat_id: msg.chat.id,
                                    message_id: msg.message_id,
                                };
                                //Ci ricaviamo il tempo(ore, minuti)
                                let spl = time[0].split(/h|m/)
                                let h = parseInt(spl[0])
                                let m = parseInt(spl[1])

                                //Creiamo il job con tali valori
                                createCronJob(chatId, f, h, m)
                                //Aggiorniamo nel database che l'utente ha avviato un report
                                await db.collection('telegramuser').doc(chatId + "").update({
                                    report: {
                                        h: h,
                                        m: m,
                                    }
                                }).catch(err => console.log(err))
                                bot.removeListener("callback_query")                    //Rimuoviamo il listener dalla inline keyboard per evitare problemi
                                messaggioAlert = "Time selected successfully!"          //Avvisiamo l'utente che la selezione dell tempo è andata a buon fine
                                bot.editMessageText('Report started!', optsDone);   //Scriviamo all'utente che il report è iniziato
                            }
                        } else {
                            //Significa che l'utente ha messo tutti zeri, avvisiamo che non può farlo
                            erroreData = true;
                            messaggioAlert = "Time not allowed! They are all zeros!"
                        }
                    }
                    //Segnaliamo che la callback è stata ricevuta, utile a non far buggare l'inline keyboard con caricamenti infiniti
                    bot.answerCallbackQuery(callbackQuery.id, {text: messaggioAlert, show_alert: erroreData})
                });
            })
        } else {
            //Avvisiamo l'utente se ha già un report attivo
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
            //Avvisiamo l'utente che il report è stato stoppato con successo
            bot.sendMessage(chatId, 'Report stopped!');
            //Aggiorniamo anche firebase per segnalare che l'utente non ha report attivi
            await db.collection('telegramuser').doc(chatId + "").update({report: null}).catch(err => console.log(err))
        } else {
            //Non ha un report attivo da stoppare
            bot.sendMessage(chatId, 'You don\'t have an active periodic report!');
        }
    }
});

//Cambia il device "seguito" dall'utente
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

//Rimuove il device seguito
bot.onText(/\/disconnect/, async (msg) => {
    let chatId = msg.chat.id;
    if (initBoard(chatId)) {
        //Rimuove da firebase l'utente (significa che non sta seguendo nessuna board)
        await db.collection('telegramuser').doc(chatId + "").delete()
        //Lo rimuoviamo anche dalla nostra mappa
        activeUsers.delete(chatId)
        //Se esiste un job in esecuzione per quell'utente allora lo stoppiamo
        if (mapJobs.has(chatId)) {
            //Stop e rimozione del job
            mapJobs.get(chatId).stop()
            mapJobs.delete(chatId)
            bot.sendMessage(chatId, 'Report stopped!');
        }
        //Avvisiamo l'utente che ha eliminato il device che stava seguendo
        bot.sendMessage(chatId, 'Goodbye! \u{1F44B}\u{1F44B}\u{1F44B}\n\n Type /start to start over!');
    }
});


//Aggiorna la lista degli utenti attivi e dei device registrati
async function updateUsersAndDevices() {
    //Aggiorniamo gli utenti
    async function updateUsers() {
        //Prende gli utenti attivi da firestore
        const usersCollection = await db.collection('telegramuser').get();
        //Per ognuno di essi assegnamo tutti i parametri necessari
        usersCollection.forEach((result) => {
            if (result.id !== "default") {
                let resD = result.data()
                let id = parseInt(result.id)
                activeUsers.set(id, {scheda: resD.scheda, report: resD.report})
                //Se l'utente aveva un report attivo allora lo riavviamo
                if (resD.report !== null) {
                    createCronJob(id, new Date(), resD.report.h, resD.report.m)
                }
            }
        })
    }

    await updateUsers()
    await updateDevices()   //Aggiorniamo i devices
}

//Funzione utile a modificare i valori della tastiera inline quando l'utente seleziona ogni quanto vuole il report
function modifyTime(action, mappaValori) {
    let operazione = action.substring(0, 3)             //piu o men
    let tempo = action.substring(3).toLowerCase()       //Ora1, Ora2, Min1, Min2 (i valori che poi prenderà dall'oggetto)
    let done = false;                                   //Flag che ci indicherà se l'utente ha terminato la selezione del tempo
    //A seconda dell'operazione che dobbiamo effettuare modifichiamo il valori del tempo
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

//Restituisce la tastiera inline per la selezione del tempo del report. La chiamiamo anche per aggiornare i valori ogni volta
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

//Effettua la query su influx per richiedere i report
async function sendQuery(chatId, idQuery) {
    let data = []       //Salveremo tutti i valori presi da influx da inviare all'utente

    let query = createQuery(chatId, idQuery)    //Creiamo la query a seconda dei valori specifici che vogliamo

    //Scorriamo i risultati della query e salviamo in data ciò che ci interessa
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
                //Se ci sono dei dati criamo il messaggio da mandare all'utente
                let mess = createMessage(idQuery, data, activeUsers.get(chatId).scheda)
                bot.sendMessage(chatId, mess);
            } else {
                //Altrimenti scriviamo all'utente che non ci sono dati
                bot.sendMessage(chatId, "There are no data for the moment!");
            }
        },
    })
}

//A seconda dei dati richiesti creiamo la query corretta
function createQuery(chatId, idQuery) {
    //Prendiamo la scheda associata all'utente
    let nameBoard = activeUsers.get(chatId).scheda

    if(idQuery === "report"){
        return `from(bucket: "${bucket}") |> range(start: -${tempo_report}m) 
            |> filter(fn: (r) => r.id == "${nameBoard}" and r._field != "gas" )
            |>group(columns: ["_field"]) |> mean()`
    } else {
        return `from(bucket: "${bucket}") |> range(start: -${tempo_report}m)
            |> filter(fn: (r) => r.id == "${nameBoard}" and r._field == "${idQuery}" )
            |>group(columns: ["_field"]) |>mean()`
    }
}

//Creazione del messaggio in base alla query
function createMessage(idMessage, data, idEsp) {

    let board = devices.get(idEsp)
    let mess = board + '\n\n'

    switch (idMessage) {
        case REPORT: { //Query completa
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


            //Creazione stringa
            for (let arr of ordMes) {
                mess += arr + '\n'
            }
            return mess
        }
        case TEMP: {
            mess += '\u{1F321}' + " Temperature: " + data[0]._value.toFixed(2) + " °C"
            return mess
        }
        case HUM: {
            mess += '\u{1F4A6}' + " Humidity: " + data[0]._value.toFixed(2) + " %"
            return mess
        }
        case RSSI: {
            mess += '\u{1F4F6}' + " WiFi signal strength: " + data[0]._value.toFixed(2) + " dBm"
            return mess
        }
        case AQI: {
            mess += '\u{2757}' + " Air Quality Index: " + data[0]._value.toFixed(2) + " AQI"
            return mess
        }
    }
}

//Funzione per aggiungere il tempo a una data (Per il prossimo orario nella quale inviare il nuovo report)
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

//Crea il job del report periodico
function createCronJob(chatId, data, h, m) {
    data = addTime(data, h, m)                      //Ci calcoliamo quando deve essere visualizzato il nuovo report
    let strCronTime = createCronTimeString(data)    //Creazione della stringa formattata come si aspetta la libreria

    //Creazione del job periodico
    let job = new CronJob(strCronTime, async function () {
        let g = new Date()
        //Calcolo e settaggio del prossimo tempo di esecuzione
        g = addTime(g, h, m)
        this.setTime(new CronTime(createCronTimeString(g)))
        await sendQuery(chatId, REPORT)
    });

    //Start del job
    job.start();
    //Aggiunta del job ala mappa di quelli attivi
    mapJobs.set(chatId, job)
}

//Metodo che prende tutti i device da firebase
async function updateDevices() {
    const devicesCollection = await db.collection('device').get();
    devices = new Map();
    //Per ognuno di essi assegnamo tutti i parametri necessari.
    devicesCollection.forEach((result) => {
        if (result.id !== "default")
            devices.set(result.id, result.data().city)
    })
}

//Per ogni scheda manda l'alert agli utenti che l'hanno registrata
function sendAlerts(alerts) {
    for (let al of alerts) {
        avvisaUtenti(al.id)
    }
}

//Se l'utente è attivo ed ha una scheda selezionata allora gli verranno mandati in automatico tutti gli alert relativi ad essa
function avvisaUtenti(idEsp) {
    activeUsers.forEach((value, key) => {
        if (value.scheda === idEsp)
            bot.sendMessage(key, '\u{26A0}\u{26A0}\u{26A0} ATTENTION! \u{26A0}\u{26A0}\u{26A0}\n' +
                'Critical AQI level for device: ' + idEsp)
    })
}

//Controlla se l'utente ha selezionato una scheda o meno
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
        //Se l'utente non ha ancora selezionato alcuna board eseguiamo i seguenti comandi
        let textMsg = msg.text.trim()                  //Esp selezionato da tastiera

        //Verifichiamo che l'esp selezionato sia esistente
        if(devices.has(textMsg)){
            let jsonData = {
                scheda: textMsg,
                report: null
            }
            activeUsers.set(chatId, jsonData)
        }

        if (!activeUsers.has(chatId)) {
            bot.sendMessage(chatId, "Selected device doesn't exists!")
        } else {
            bot.sendMessage(chatId, "Device selected successfully!")
            //Creaimo un doc chiamato con l'id e salviamo all'interno di esso tutti i dati relativi a quel determinato device
            let request = await db.collection('telegramuser').doc("" + chatId).set(activeUsers.get(chatId)).catch(err => console.log(err))
        }
    } else {
        bot.sendMessage(chatId, `The device selection has already been made!`);
    }
}

//Funzione che permette all'utente di cambiare il device "seguito". Verrà mantenuto il report periodico (se selezionato)
async function changeEsp(chatId, msg) {
    //Simile al set, ma in questo caso aggiorniamo e basta
    if (activeUsers.has(chatId)) {
        let textMsg = msg.text.trim()
        let flagInterno = false

        //Verifichiamo che l'esp selezionato sia esistente
        if(devices.has(textMsg)){
            let jsonData = {
                scheda: textMsg,
                report: null
            }
            activeUsers.set(chatId, jsonData)
            flagInterno = true
        }

        if (!flagInterno) {
            bot.sendMessage(chatId, "Input Error!")
        } else {
            bot.sendMessage(chatId, "Device selected successfully!")
            //Creaimo un doc chiamato con l'id e salviamo all'interno di esso tutti i dati relativi a quel determinato device
            let request = await db.collection('telegramuser').doc("" + chatId).set(activeUsers.get(chatId)).catch(err => console.log(err))
        }
    } else {
        bot.sendMessage(chatId, `You haven't selected your device yet!`);
    }
}

module.exports = sendAlerts