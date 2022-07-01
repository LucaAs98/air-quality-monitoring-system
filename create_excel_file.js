const reader = require('xlsx')

/** Inizializzazione FIREBASE **/
let admin = require("firebase-admin");
let serviceAccount = require("./progettoiot2022-firebase-adminsdk-hoxdu-085c6305e8.json");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://progettoiot2022-default-rtdb.europe-west1.firebasedatabase.app"
});
let db = admin.firestore();

getAndWriteDelays()

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
    console.log("Delay inviato!")
    await db.collection('delay_mess').doc(id).collection('tempi').doc((new Date()).toString()).set({
        protocol: protocol,
        delay: delay
    })
}

function scriviSuExcel(delays) {
    let workBook = reader.utils.book_new();
    const ws = reader.utils.json_to_sheet(delays)
    reader.utils.book_append_sheet(workBook, ws, "Delays")
    reader.writeFile(workBook, './delays.xlsx')
}