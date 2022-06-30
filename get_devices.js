/** Inizializzazione slider per aggiunta nuovo dispositivo **/
let id = "home"
setSliderBehaviour(id, "min_gas_value")
setSliderBehaviour(id, "max_gas_value")
$('input[type=range]').on('input', function () {
    let sliderClass = $(this).attr("class").split(" ")[0]
    setSliderBehaviour(id, sliderClass)
});

//Prendiamo tutti i device presenti su firestore, creiamo le loro carte e li visualizziamo nella webpage.
getDevices()

//Array contenente tutti gli esp32 registrati su firestore
window.arrayESP32 = [];

//Array contenente tutti i dati degli esp32 presenti su influx (medie degli ultimi tot. minuti per ogni valore)
window.influxData = [];

/* Prendiamo sia gli esp32 presenti su firestore che i loro dati su influx. Successivamente andiamo ad aggiungere quelli
* registrati sulla webpage. */
async function getDevices() {
    const response = await fetch('/devices');
    window.arrayESP32 = await response.json()
    const responseInflux = await fetch('/get_influx_data');
    window.influxData = await responseInflux.json()

    $("#loading").hide()                    //Nascondiamo la scritta di caricamento
    if (window.arrayESP32.length > 1) {
        addDevices();                       //Aggiungiamo i device alla schermata
    } else {
        $("#no_device").show()              //Mostriamo la scritta che non ci sono device da visualizzare
    }
}

//Funzione che combina i dati di influx con quelli di firestore. Aggiunge infine le carte con tali dati
async function addDevices() {
    //Scorriamo tutti i dispositivi che vogliamo visualizzare
    window.arrayESP32.forEach((dataFirestore) => {
        if (dataFirestore.id !== "default") { //Se non è l'esp di default
            let elementFromID = window.influxData.filter(x => x.id === dataFirestore.id)    //Filtriamo i dati influx per un determinato esp registrato
            let dataInfluxID = dataInfluxIDFormat(elementFromID, dataFirestore.id)          //Formattiamo i dati come vogliamo
            aggiungiCarta(dataFirestore, dataInfluxID)                                      //Aggiungiamo la carta di tale esp
        }
    })
}

/* Metodo per aggiungere la carta nella home, necessita dei dati da visualizzare (da influx) e dei dati specifici
* per un determinato esp (da firestore) */
function aggiungiCarta(dataFirestore, dataInflux) {
    //Nuovo layer per ogni dispositivo che vogliamo visualizzare
    const realTerrain = nuovoLayerMappa()

    //Nuova carta per ogni dispositivo che vogliamo visualizzare
    let newCard = creaDivCarta(dataFirestore, dataInflux)

    //Appendiamo la nuova carta creata al container
    $('#containerCards').append(newCard)

    //Creiamo una mappa per cisascuno degli esp registrati
    var map = L.map(`map${dataFirestore.id}`, {
        center: [dataFirestore.lat, dataFirestore.long],
        zoom: 15,
        layers: [realTerrain],
    });

    //Aggiungiamo il marker che permette di capire dove si trova nella mappa
    var marker = L.marker([dataFirestore.lat, dataFirestore.long]).addTo(map);

    //Impostiamo l'altezza della mappa
    $(`#map${dataFirestore.id}`).css('height', 180 + 'px');

    /* Istruzioni necessarie per evitare che la mappa non si veda bene. Controlla quando il div che contiene si modifica
    *  in modo tale da aggiornare la dimensione della mappa. (Non importante). */
    const resizeObserver = new ResizeObserver(() => {
        map.invalidateSize();
    });
    resizeObserver.observe($(`#map_div_${dataFirestore.id}`)[0])

    //Comportamento onclick dei bottoni

    //Quando clicca sul pulsante di grafana
    $(`#grafana_${dataFirestore.id}`).on("click", function () {
        visualizeGrafanaGraphs(dataFirestore.id)
    })

    //Quando clicca sul pulsante per rimuovere la registrazione dell'esp
    $(`#remove_${dataFirestore.id}`).on("click", function () {
        removeEsp32(dataFirestore)
    })

    //Settiamo il comportamento del modal del cambio dei parametri per ciascun esp
    setChangeParamBehaviour(dataFirestore)
}


//Funzione chiamata al click del bottone "Vedi su Grafana", apriamo la dashboard relativa al device su grafana.
function visualizeGrafanaGraphs(id) {
    window.open("http://localhost:4000/d/BWTZxxr7z/iotproject2022?orgId=1&refresh=5s&from=now-5m&to=now&theme=dark&&var-id=" + id, '_blank').focus();
}

//Funzione chiamata al click del bottone "Rimuovi"
async function removeEsp32(dataFirestore) {
    $.post("/remove_device", {id: dataFirestore.id});           //Facciamo la richiesta di rimozione
    await new Promise(r => setTimeout(r, 500));     //Piccola sleep per dare il tempo di registrare il dispositivo e poi ricaricare la pagina
    window.location.reload();                                   //Ricarichiamo la pagina
}

/* Formattiamo i dati di influx come desideriamo. In poche parole ci servirà avere l'id, la temperatura, l'umidità e l'aqi
* per poterli visualizzare nella webpage. */
function dataInfluxIDFormat(dataToFormat, id) {
    //Inizializziamo a "No data" perchè se su influx non ci saranno dati per tale esp visualizzeremo questo messaggio.
    let newData = {
        id: id,
        temperature: "No data",
        humidity: "No data",
        aqi: "No data"
    }

    //Se invece abbiamo i dati per tale id li settiamo
    if (dataToFormat.length > 0) {
        let tempInData = dataToFormat.filter(obj => obj.field === "temperature")[0]
        let humInData = dataToFormat.filter(obj => obj.field === "humidity")[0]
        let aqiInData = dataToFormat.filter(obj => obj.field === "aqi")[0]

        if (tempInData !== undefined)
            newData.temperature = tempInData.value.toFixed(2)
        if (humInData !== undefined)
            newData.humidity = humInData.value.toFixed(2)
        if (aqiInData !== undefined)
            newData.aqi = aqiInData.value.toFixed(2)
    }
    return newData
}

//Ritorna un nuovo layer per la mappa di ogni esp32
function nuovoLayerMappa() {
    return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png?{foo}', {
        foo: 'bar',
        attribution: ''
    })
}

//Colora lo slider in mezzo ai valori scelti
function fillColor(sliderMin, sliderMax, sliderMaxValue, sliderTrack) {
    let percent1 = (sliderMin.value / sliderMaxValue) * 100;
    let percent2 = (sliderMax.value / sliderMaxValue) * 100;
    sliderTrack.style.background = `linear-gradient(to right, #dadae5 ${percent1}% , #3264fe ${percent1}% , #3264fe ${percent2}%, #dadae5 ${percent2}%)`;
}

//Ritorna una nuova card per ogni esp32 registrato.
function creaDivCarta(dataFirestore, dataInflux) {
    return `<div class="col">
        <div class="card">
            <div class="card-body">
                <div class="row g-0">
                    <div class="col-md-5">
                        <h5 class="card-title">${dataFirestore.id}</h5>
                        <ul class="list-group list-group-flush">
                            <li class="list-group-item">Temperature: ${dataInflux.temperature}</li>
                            <li class="list-group-item">Humidity: ${dataInflux.humidity}</li>
                            <li class="list-group-item">AQI: ${dataInflux.aqi}</li>
                        </ul>
                    </div>
                    <div class="vr col-md-1 offset-md-1"></div>
                    <div class="col-md-5 ms-auto">
                        <div class="d-grid gap-2">
                            <button class="btn btn-primary" type="button" id="grafana_${dataFirestore.id}">Dashboard Grafana</button>
                            <button class="btn btn-primary" type="button" data-bs-toggle="collapse" href="#map_div_${dataFirestore.id}" role="button" aria-expanded="false" aria-controls="map_div_${dataFirestore.id}">View position</button>
                            <button type="button" class="btn btn-primary" data-bs-toggle="modal" data-bs-target=#modal${dataFirestore.id} data-bs-whatever=${dataFirestore.id}>Change parameters</button>
                            <button class="btn btn-danger" type="button" id="remove_${dataFirestore.id}">Remove</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="collapse" id="map_div_${dataFirestore.id}">
                <div id="map${dataFirestore.id}"></div>
            </div>
        </div>
       
        <div class="modal fade" id=modal${dataFirestore.id} tabindex="-1" aria-labelledby=modal${dataFirestore.id}Label aria-hidden="true" data-bs-keyboard="false" data-bs-backdrop="static">
          <div class="modal-dialog">
            <div class="modal-content">  
                <form id="modal-form-${dataFirestore.id}">
                <div class="modal-header">
                    <h5 class="modal-title" id=modal${dataFirestore.id}Label>Change ${dataFirestore.id}'s parameters</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                       
                <label><strong>MIN</strong> and <strong>MAX</strong> GAS VALUE:</label>
                <div class="wrapper">
                    <div class="container">
                        <div class="slider-track" id=slider-track-${dataFirestore.id}></div>
                        <input class="min_gas_value" type="range" min="0" max="10000" value=${dataFirestore.min_gas_value} step="10" id=slider-1-${dataFirestore.id}>
                        <input class="max_gas_value" type="range" min="0" max="10000" value=${dataFirestore.max_gas_value} step="10" id=slider-2-${dataFirestore.id}>
                    </div>
                    <div class="row label-min-max">
                        <div class="col-6">
                            <label class="form-label">MIN:</label> <span id=range1-${dataFirestore.id}>0</span>
                        </div>
                        <div class="col-6">
                            <label class="form-label">MAX:</label> <span id=range2-${dataFirestore.id}> 100</span>
                        </div>
                    </div>
                </div>
                       
                  <div class="mb-3">
                    <label for="sample_frequency_value_${dataFirestore.id}" class="form-label">SAMPLE FREQUENCY</label>
                    <input type="number" class="form-control" id="sample_frequency_value_${dataFirestore.id}" 
                    value=${dataFirestore.sample_frequency} name="sample_frequency" aria-describedby="sample_frequency_help"
                    value="2000" step="2000" min="2000">
                  </div>
                   <label for="protocol_dropdown_${dataFirestore.id}" class="form-label">PROTOCOL</label>
                        <div class="dropdown">
                            <button class="btn btn-secondary dropdown-toggle" type="button" id="protocol_dropdown_${dataFirestore.id}"
                                    data-bs-toggle="dropdown" aria-expanded="false">${dataFirestore.protocol}</button>
                            <ul class="dropdown-menu" aria-labelledby="protocol_dropdown_${dataFirestore.id}">
                                <li class="dropdown-item">MQTT</li>
                                <li class="dropdown-item">COAP</li>
                                <li class="dropdown-item">HTTP</li>
                            </ul>
                        </div>
              </div>
                  <div class="modal-footer">
                    <button type="button" class="btn btn-danger" data-bs-dismiss="modal">Close</button>
                    <button type="button" class="btn btn-success" id="change_parameters_${dataFirestore.id}">Change parameters</button>
                  </div>
                </div>
            </form>
          </div>
        </div>
    </div>`
}

//Settiamo il comportamento del modal del cambio dei parametri per ciascun esp
function setChangeParamBehaviour(dataFirestore) {
    //Comportamento del modal del cambio parametri
    let modal = document.getElementById(`modal${dataFirestore.id}`);

    modal.addEventListener('show.bs.modal', function (event) {
            //Quando clicchiamo un elemento della dropdown cambiamo il nome di essa
            $(`.dropdown-item`).on('click', function () {
                let protocol = $(this).text().trim()
                $(`#protocol_dropdown_${dataFirestore.id}`).text(protocol)
            })

            setSliderBehaviour(dataFirestore.id, "min_gas_value")
            setSliderBehaviour(dataFirestore.id, "max_gas_value")

            /* Controlliamo che i campi siano correttamente completati. */
            $(`#modal-form-${dataFirestore.id}`).validate({
                errorClass: "my-error-class",
                rules: {
                    sample_frequency: {
                        required: true,
                        number: true
                    },
                },
                messages: {
                    sample_frequency: {
                        required: "Please enter the sample frequency value",
                        number: "Enter a number please"
                    }
                },
            })
            /* Abbiamo dovuto separare la validate dalla submit per poter mettere un piccolo delay e dare il tempo
            * di salvare i dati prima di ricaricare la pagina. */
            $(`#change_parameters_${dataFirestore.id}`).click(async function () {
                if (!$(`#modal-form-${dataFirestore.id}`).valid()) { // Not Valid
                    return false;
                } else {
                    // Aggiorniamo il contenuto del modal, prendiamo i campi
                    let modalBodyInputSample = modal.querySelector(`.modal-body input#sample_frequency_value_${dataFirestore.id}`);
                    let modalBodyInputProtocol = modal.querySelector(`.modal-body button#protocol_dropdown_${dataFirestore.id}`);
                    //Prendiamo il nuovo protocollo selezionato
                    let newProtocol = modalBodyInputProtocol.textContent.trim()
                    //Prendiamo il vecchio protocollo per verificare che ci sia stato o meno un passaggio da "qualcosa" a COAP
                    let oldProtocol = arrayESP32.find(e => e.id === dataFirestore.id).protocol
                    let coapOp      //Operazione da fare a seconda di oldProtocol

                    if (oldProtocol !== newProtocol) {
                        if (newProtocol === 'COAP') {
                            coapOp = 0      //Avvia nuovo job coap
                        } else {
                            if (oldProtocol === 'COAP' && newProtocol !== 'COAP') {
                                coapOp = 1  //Ferma job coap
                            } else
                                coapOp = 2  //Non fare niente
                        }
                    } else {
                        coapOp = 2          //Non fare niente
                    }

                    //Estraiamo i dati dai vari campi e creiamo l'oggetto con i nuovi valori
                    let data = {
                        id: dataFirestore.id,
                        max_gas_value: $("#slider-2-" + dataFirestore.id).val(),
                        min_gas_value: $("#slider-1-" + dataFirestore.id).val(),
                        sample_frequency: modalBodyInputSample.value,
                        protocol: newProtocol,
                        cop: coapOp
                    }
                    //Mandiamo i nuovi dati sia a firebase che all'esp32
                    $.post("/update_device", data);
                    //Piccola sleep per avere il tempo di aggiornare i dati e poter ricaricare infine la pagina
                    await new Promise(r => setTimeout(r, 500));
                    window.location.reload();
                }
            });

            //Ogni volta che modifichiamo lo slider aggiorniamo il tutto
            $('input[type=range]').on('input', function () {
                let sliderClass = $(this).attr("class").split(" ")[0]
                setSliderBehaviour(dataFirestore.id, sliderClass)
            });
        }
    );
}

//Setta come avviene la gestione degli slider
function setSliderBehaviour(id, sliderClass) {
    let sliderMin = document.getElementById(`slider-1-${id}`);
    let sliderMax = document.getElementById(`slider-2-${id}`);
    let displayValMin = document.getElementById(`range1-${id}`);
    let displayValMax = document.getElementById(`range2-${id}`);
    let minGap = 10;
    let sliderTrack = document.getElementById(`slider-track-${id}`);
    let sliderMaxValue = document.getElementById(`slider-1-${id}`).max;

    //Settiamo i limiti per i valori max e min
    if (sliderClass === "max_gas_value") {
        if (parseInt(sliderMax.value) - parseInt(sliderMin.value) <= minGap) {
            sliderMax.value = parseInt(sliderMin.value) + minGap;
        }
        displayValMax.textContent = sliderMax.value;
        fillColor(sliderMin, sliderMax, sliderMaxValue, sliderTrack);
    } else {
        if (parseInt(sliderMax.value) - parseInt(sliderMin.value) <= minGap) {
            sliderMin.value = parseInt(sliderMax.value) - minGap;
        }
        displayValMin.textContent = sliderMin.value;
        fillColor(sliderMin, sliderMax, sliderMaxValue, sliderTrack);
    }

}