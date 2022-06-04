//Array dei dispositivi da visualizzare. Si dovranno prendere da firebase.
let arrayESP32 = [
    {
        id: 'esp0',
        lat: 44.49712,
        long: 11.34248
    },
    {
        id: 'esp1',
        lat: 43.49712,
        long: 10.34248
    },
    {
        id: 'esp2',
        lat: 45.49712,
        long: 12.34248
    },
    {
        id: 'esp3',
        lat: 46.49712,
        long: 17.34248
    },]
//Array di tutti i dispositivi esp32 che abbiamo nel db
let allESP32 = [
    {
        id: 'esp0',
        lat: 44.49712,
        long: 11.34248
    },
    {
        id: 'esp1',
        lat: 43.49712,
        long: 10.34248
    },
    {
        id: 'esp2',
        lat: 45.49712,
        long: 12.34248
    },
    {
        id: 'esp3',
        lat: 46.49712,
        long: 17.34248
    },
    {
        id: 'esp4',
        lat: 44.49712,
        long: 11.34248
    },
    {
        id: 'esp5',
        lat: 44.49712,
        long: 11.34248
    },
    {
        id: 'esp6',
        lat: 44.49712,
        long: 11.34248
    },
    {
        id: 'esp7',
        lat: 44.49712,
        long: 11.34248
    }]

//Scorriamo tutti i dispositivi che vogliamo visualizzare
arrayESP32.forEach((result, idx) => {
    aggiungiCarta(result, idx)
})

//Controlliamo che l'esp32 che vogliamo aggiungere si trovi nel db e che non lo stiamo già visualizzando
function validateForm() {
    let x = document.forms["form_add_esp32"]["device_name"].value;
    //Se il campo è vuoto diamo errore
    if (x === "") {
        alert("Name must be filled out");
        return false;
    } else {
        //Cerchiamo l'id tra tutti i dispositivi esp32 che abbiamo nel db
        let espToAdd = allESP32.filter(obj => {
            return obj.id === x
        })
        //Se non è stato trovato diamo errore
        if (espToAdd.length === 0) {
            alert("This device doesn't exists!");
            return false;
        } else {
            //Controlliamo che l'esp non si trovi già tra quelli visualizzati
            if (arrayESP32.includes(arrayESP32.find(el => el.id === espToAdd[0].id)) !== true) {
                //Bisogna aggiungere alla lista degli esp visualizzati quello nuovo
                arrayESP32.push(espToAdd[0])
                //Aggiungiamolo alla schermata home
                aggiungiCarta(espToAdd[0], allESP32.indexOf(espToAdd[0]))
                return true;
            } else {
                //Se lo stiamo già visualizzando diamo errore
                alert("This device is already visualized!");
                return false;
            }
        }
    }
}

//Metodo per aggiungere la carta nella home, necessita dei dati da visualizzare e dell'id (in numero) dell'esp
function aggiungiCarta(result, idx) {
    //Nuovo layer per ogni dispositivo che vogliamo visualizzare
    const realTerrain = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {})

    //Nuova carta per ogni dispositivo che vogliamo visualizzare
    let newCard = `<div class="col">
        <div class="card">
            <div class="card-body">
                <div class="row g-0">
                    <div class="col-md-5">
                        <h5 class="card-title">${result.id}</h5>
                        <ul class="list-group list-group-flush">
                            <li class="list-group-item">Temperature: 27</li>
                            <li class="list-group-item">Humidity: 20%</li>
                            <li class="list-group-item">AQI: 0.5</li>
                        </ul>
                    </div>
                    <div class="vr col-md-1 offset-md-1"></div>
                    <div class="col-md-5 ms-auto">
                        <div class="d-grid gap-2">
                            <button class="btn btn-primary" type="button" onclick=visualizeGrafanaGraphs(${idx})>Vedi su grafana</button>
                            <button class="btn btn-primary" type="button" data-bs-toggle="collapse" href="#map_div_${idx}" role="button" aria-expanded="false" aria-controls="map_div_${idx}">Vedi su mappa</button>
                            <button class="btn btn-primary" type="button" onclick=changeParameters(${idx})>Cambia parametri</button>
                            <button class="btn btn-danger" type="button" onclick=removeEsp32(${idx})>Rimuovi</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="collapse" id="map_div_${idx}">
                <div id="map${idx}"></div>
            </div>
        </div>
    </div>`

    //Appendiamo una carta di un nuovo dispositivo
    $('#containerCards').append(newCard)

    //Creiamo la mappa per quest'ultimo
    var map = L.map(`map${idx}`, {
        center: [result.lat, result.long],
        zoom: 15,
        layers: [realTerrain],
    });

    //Aggiungiamo il marker che permette di capire dove si trova nella mappa
    var marker = L.marker([result.lat, result.long]).addTo(map);

    //Impostiamo l'altezza della mappa
    $(`#map${idx}`).css('height', 180 + 'px');

    /* Istruzioni necessarie per evitare che la mappa non si veda bene. Controlla quando il div che contiene si modifica
    *  in modo tale da aggiornare la dimensione della mappa. (Non importante)*/
    const resizeObserver = new ResizeObserver(() => {
        map.invalidateSize();
    });
    resizeObserver.observe($(`#map_div_${idx}`)[0])
}


//Funzione chiamata al click del bottone "Vedi su Grafana"
function visualizeGrafanaGraphs(idx){
    alert("Visualizza grafico per -> esp" + idx)
    //Visualizza grafico per esp + idx, potremmo farlo visualizzare sotto, oppure restituire solo il link
}

//Funzione chiamata al click del bottone "Cambia Parametri"
function changeParameters(idx){
    alert("Cambia parametri per -> esp" + idx)
    //Cambia parametri per + idx
}

//Funzione chiamata al click del bottone "Rimuovi"
function removeEsp32(idx){
    alert("Rimuovi -> esp" + idx)
    //Rimuovi dagli esp visualizzati quello con id esp + idx
}