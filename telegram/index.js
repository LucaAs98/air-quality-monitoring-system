//Elimina stampa di librerie obsolete
process.env.NTBA_FIX_319 = 1;
//require
require('dotenv').config({path: '../.env'});
const TelegramBot = require('node-telegram-bot-api');
const CronJob = require('cron').CronJob;
const CronTime = require('cron').CronTime;

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

//Per osservare gli errori di pooling
bot.on("polling_error", console.log);

//Start (da rivedere)
bot.onText(/\/start/, (msg) => {
    let chatId = msg.chat.id;
    let message = `<b>Air Quality monitoring Bot</b>\n/help to see the list of commands`
    bot.sendMessage(msg.chat.id, message, {parse_mode: "HTML"})
});

//Singolo report
bot.onText(/\/report/, async (msg) => {
    let chatId = msg.chat.id;

    let query = `from(bucket: "iotProject2022")
  |> range(start: -5m)
  |> filter(fn: (r) =>
    r.id == "esp32_nostro"
    and r._field != "gas" )
  |>group(columns: ["_field"])
  |>mean()`

    await sendQuery(chatId, query, 0)
});


//Report per solo la temperatura
bot.onText(/\/temperature/, async (msg) => {

    let chatId = msg.chat.id;
    let query = `from(bucket: "iotProject2022")
  |> range(start: -5m)
  |> filter(fn: (r) =>
    r.id == "esp32_nostro"
    and r._field == "temperature" )
  |>group(columns: ["_field"])
  |>mean()`

    await sendQuery(chatId, query, 1)
});

//Report per solo l'umidità'
bot.onText(/\/humidity/, async (msg) => {

    let chatId = msg.chat.id;
    let query = `from(bucket: "iotProject2022")
  |> range(start: -5m)
  |> filter(fn: (r) =>
    r.id == "esp32_nostro"
    and r._field == "humidity" )
  |>group(columns: ["_field"])
  |>mean()`

    await sendQuery(chatId, query, 2)
});

//Report per il segnale del wifi
bot.onText(/\/wifi_strength/, async (msg) => {

    let chatId = msg.chat.id;
    let query = `from(bucket: "iotProject2022")
  |> range(start: -5m)
  |> filter(fn: (r) =>
    r.id == "esp32_nostro"
    and r._field == "wifi_signal" )
  |>group(columns: ["_field"])
  |>mean()`

    await sendQuery(chatId, query, 3)
});

//Report per solo la qualità dell'aria
bot.onText(/\/aqi/, async (msg) => {

    let chatId = msg.chat.id;
    let query = `from(bucket: "iotProject2022")
  |> range(start: -5m)
  |> filter(fn: (r) =>
    r.id == "esp32_nostro"
    and r._field == "aqi" )
  |>group(columns: ["_field"])
  |>mean()`

    await sendQuery(chatId, query, 4)
});

//Report periodico
bot.onText(/\/periodic_report/, async (msg) => {
    let chatId = msg.chat.id;

    //Controlla se l'utente non abbia già un report attivo
    if (!mapJobs.has(chatId)) {
        //catena di istruzioni per creare il report
        let f = new Date()
        bot.sendMessage(
            msg.chat.id,
            `Hello! ${msg.chat.first_name}, how often do you want to be notified? Write the response in this format -> /save **h**m**s`
        ).then(res => {
            console.log("1casasdasdasdadas")
            //Memorizzazione del tempo
            bot.onText(/\/save (.+)/, (msg) => {
                console.log("2casasdasdasdadas")
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

                    let query = `from(bucket: "iotProject2022")
  |> range(start: -5m)
  |> filter(fn: (r) =>
    r.id == "esp32_nostro"
    and r._field != "gas" )
  |>group(columns: ["_field"])
  |>mean()`
                    f = addTime(f, h, m, s) //Ci calcoliamo quando deve essere visualizzato il nuovo report

                    let strCronTime = createCronTimeString(f) //Creazione della string

                    //Creazione del job periodico
                    let job = new CronJob(strCronTime, async function () {
                        let g = new Date()
                        //Calcolo e settaggio del prossimo tempo di esecuzione
                        g = addTime(g, h, m, s)
                        this.setTime(new CronTime(createCronTimeString(g)))
                        await sendQuery(chatId, query, 0)
                    });
                    //Start del job
                    job.start();
                    //Aggiunta del job ala mappa di quelli attivi
                    mapJobs.set(chatId, job)

                    bot.sendMessage(chatId, 'Report avviato!' + '\n\nNext: ' + f);
                }
            });
        }).catch(() => {
            bot.sendMessage(msg.chat.id, `Oops! An error has occured. Try again`);
        })
    } else {
        bot.sendMessage(chatId, 'Hai già un report periodico attivo!');
    }
});

//Stoppa il report periodico
bot.onText(/\/stop/, async (msg) => {
    let chatId = msg.chat.id;

    //Controllo per verificare che esiste il job dell'utente
    if (mapJobs.has(chatId)) {
        //Stop e rimozione del job
        mapJobs.get(chatId).stop()
        mapJobs.delete(chatId)
        bot.sendMessage(chatId, 'Report stoppato!');
    } else {
        bot.sendMessage(chatId, 'Non hai un report periodico attivo!');
    }
});

//Effettua la query su influx
async function sendQuery(chatId, query, idQuery) {
    let data = []

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
                let mess = createMessage(idQuery, data)
                const d = new Date();
                bot.sendMessage(chatId, mess + '\n\nData: ' + d);
            } else {
                bot.sendMessage(chatId, "Error! Try later!");
            }
        },
    })
}

//Creazione del messaggio in base alla query
function createMessage(idMessage, data) {

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
            let mess = 'Bologna (BO)\n\n'
            
            //creazione stringa
            for (let arr of ordMes) {
                mess += arr + '\n'
            }
            return mess
        }
            break;
        case 1: {
            let mess = 'Bologna (BO)\n\n'
            mess += '\u{1F321}' + " Temperature: " + data[0]._value.toFixed(2) + " °C"
            return mess
        }
            break;
        case 2: {
            let mess = 'Bologna (BO)\n\n'
            mess += '\u{1F4A6}' + " Humidity: " + data[0]._value.toFixed(2) + " %"
            return mess
        }
            break;
        case 3: {
            let mess = 'Bologna (BO)\n\n'
            mess += '\u{1F4F6}' + " WiFi signal strength: " + data[0]._value.toFixed(2) + " dBm"
            return mess
        }
            break;
        case 4: {
            let mess = 'Bologna (BO)\n\n'
            mess += '\u{2757}' + " Air Quality Index: " + data[0]._value.toFixed(2) + " AQI"
            return mess
        }
            break;
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

