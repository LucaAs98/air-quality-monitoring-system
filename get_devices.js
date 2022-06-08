getDevices()

window.arrayESP32 = [];
window.influxData = [];

async function getDevices() {
    const response = await fetch('/devices');
    window.arrayESP32 = await response.json()
    const responseInflux = await fetch('/get_influx_data');
    window.influxData = await responseInflux.json()

    if (window.arrayESP32.length > 1) {
        $("#loading").hide()
        addDevices();
    } else {
        $("#no_device").show()
        $("#loading").hide()
    }
}

async function addDevices() {
    //Scorriamo tutti i dispositivi che vogliamo visualizzare
    window.arrayESP32.forEach((res_firestore) => {
        if (res_firestore.id !== "default") {
            let elementFromID = window.influxData.filter(x => x.id === res_firestore.id)
            let dataInfluxID = dataInfluxIDFormat(elementFromID, res_firestore.id)
            console.log(dataInfluxID)
            aggiungiCarta(res_firestore, dataInfluxID)
        }
    })
}

//Metodo per aggiungere la carta nella home, necessita dei dati da visualizzare e dell'id (in numero) dell'esp
function aggiungiCarta(res_firestore, dataInflux) {
    //Nuovo layer per ogni dispositivo che vogliamo visualizzare
    const realTerrain = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png?{foo}', {
        foo: 'bar',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    })

    //Nuova carta per ogni dispositivo che vogliamo visualizzare
    let newCard = `<div class="col">
        <div class="card">
            <div class="card-body">
                <div class="row g-0">
                    <div class="col-md-5">
                        <h5 class="card-title">${res_firestore.id}</h5>
                        <ul class="list-group list-group-flush">
                            <li class="list-group-item">Temperature: ${dataInflux.temperature}</li>
                            <li class="list-group-item">Humidity: ${dataInflux.humidity}</li>
                            <li class="list-group-item">AQI: ${dataInflux.aqi}</li>
                        </ul>
                    </div>
                    <div class="vr col-md-1 offset-md-1"></div>
                    <div class="col-md-5 ms-auto">
                        <div class="d-grid gap-2">
                            <button class="btn btn-primary" type="button" id="grafana_${res_firestore.id}">Vedi su grafana</button>
                            <button class="btn btn-primary" type="button" data-bs-toggle="collapse" href="#map_div_${res_firestore.id}" role="button" aria-expanded="false" aria-controls="map_div_${res_firestore.id}">Vedi su mappa</button>
                            <button type="button" class="btn btn-primary" data-bs-toggle="modal" data-bs-target=#modal${res_firestore.id} data-bs-whatever=${res_firestore.id}>Cambia Parametri</button>
                            <button class="btn btn-danger" type="button" id="remove_${res_firestore.id}">Rimuovi</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="collapse" id="map_div_${res_firestore.id}">
                <div id="map${res_firestore.id}"></div>
            </div>
        </div>
       
        <div class="modal fade" id=modal${res_firestore.id} tabindex="-1" aria-labelledby=modal${res_firestore.id}Label aria-hidden="true">
          <div class="modal-dialog">
            <div class="modal-content">  
                <form id="modal-form-${res_firestore.id}">
                  <div class="modal-header">
                    <h5 class="modal-title" id=modal${res_firestore.id}Label>Change ${res_firestore.id}'s parameters</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                  </div>
                  <div class="modal-body">
             
                       <div class="mb-3">
                        <label for="max_gas_value_${res_firestore.id}" class="form-label">MAX_GAS_VALUE</label>
                        <input type="text" class="form-control" id="max_gas_value_${res_firestore.id}" value=${res_firestore.max} name="max_gas" aria-describedby="max_gas_help">
                      </div>
                      <div class="mb-3">
                        <label for="min_gas_value_${res_firestore.id}" class="form-label">MIN_GAS_VALUE</label>
                        <input type="text" class="form-control" id="min_gas_value_${res_firestore.id}" value=${res_firestore.min} name="min_gas" aria-describedby="min_gas_help">
                      </div>
                      <div class="mb-3">
                        <label for="sample_frequency_value_${res_firestore.id}" class="form-label">SAMPLE FREQUENCY</label>
                        <input type="text" class="form-control" id="sample_frequency_value_${res_firestore.id}" value=${res_firestore.sample_frequency} name="sample_frequency" aria-describedby="sample_frequency_help">
                      </div>
                       <label for="protocol_dropdown_${res_firestore.id}" class="form-label">PROTOCOL</label>
                            <div class="dropdown">
                                <button class="btn btn-secondary dropdown-toggle" type="button" id="protocol_dropdown_${res_firestore.id}"
                                        data-bs-toggle="dropdown" aria-expanded="false">
                                    ${res_firestore.protocol}
                                </button>
                                <ul class="dropdown-menu" aria-labelledby="protocol_dropdown_${res_firestore.id}">
                                    <li class="dropdown-item">MQTT</li>
                                    <li class="dropdown-item">COAP</li>
                                    <li class="dropdown-item">HTTP</li>
                                </ul>
                            </div>
                  </div>
                  <div class="modal-footer">
                    <button type="button" class="btn btn-danger" data-bs-dismiss="modal">Close</button>
                    <button type="submit" class="btn btn-success" id="change_parameters_${res_firestore.id}">Cambia parametri</button>
                  </div>
                </div>
            </form>
          </div>
        </div>
    </div>`

    //Appendiamo una carta di un nuovo dispositivo
    $('#containerCards').append(newCard)

    //Creiamo la mappa per quest'ultimo
    var map = L.map(`map${res_firestore.id}`, {
        center: [res_firestore.lat, res_firestore.long],
        zoom: 15,
        layers: [realTerrain],
    });

    //Aggiungiamo il marker che permette di capire dove si trova nella mappa
    var marker = L.marker([res_firestore.lat, res_firestore.long]).addTo(map);

    //Impostiamo l'altezza della mappa
    $(`#map${res_firestore.id}`).css('height', 180 + 'px');

    /* Istruzioni necessarie per evitare che la mappa non si veda bene. Controlla quando il div che contiene si modifica
    *  in modo tale da aggiornare la dimensione della mappa. (Non importante)*/
    const resizeObserver = new ResizeObserver(() => {
        map.invalidateSize();
    });
    resizeObserver.observe($(`#map_div_${res_firestore.id}`)[0])

    //Comportamento onclick dei bottoni
    $(`#grafana_${res_firestore.id}`).on("click", function () {
        visualizeGrafanaGraphs(res_firestore.id)
    })

    $(`#remove_${res_firestore.id}`).on("click", function () {
        removeEsp32(res_firestore)
    })

    //Comportamento del modal
    let modal = document.getElementById(`modal${res_firestore.id}`);

    modal.addEventListener('show.bs.modal', function (event) {
        //Quando clicchiamo un elemento della dropdown cambiamo il nome di essa
        $(`.dropdown-item`).on('click', function () {
            let protocol = $(this).text()
            $(`#protocol_dropdown_${res_firestore.id}`).text(protocol)
        })

        /* Controlliamo che i campi siano correttamente completati. */
        $(`#modal-form-${res_firestore.id}`).validate({
            errorClass: "my-error-class",
            rules: {
                max_gas: {
                    required: true,
                    number: true
                },
                min_gas: {
                    required: true,
                    number: true
                },
                sample_frequency: {
                    required: true,
                    number: true
                },
            },
            messages: {
                max_gas: {
                    required: "Please enter the max gas value",
                    number: "Enter a number please"
                },
                min_gas: {
                    required: "Please enter the min gas value",
                    number: "Enter a number please"
                },
                sample_frequency: {
                    required: "Please enter the sample frequency value",
                    number: "Enter a number please"
                }
            },
            //Se tutto va bene inviamo i dati a firebase
            submitHandler: function (form, e) {
                // Aggiorniamo il contenuto del modal
                let modalBodyInputMax = modal.querySelector(`.modal-body input#max_gas_value_${res_firestore.id}`);
                let modalBodyInputMin = modal.querySelector(`.modal-body input#min_gas_value_${res_firestore.id}`);
                let modalBodyInputSample = modal.querySelector(`.modal-body input#sample_frequency_value_${res_firestore.id}`);
                let modalBodyInputProtocol = modal.querySelector(`.modal-body button#protocol_dropdown_${res_firestore.id}`);

                let data = {
                    id: res_firestore.id,
                    max: modalBodyInputMax.value,
                    min: modalBodyInputMin.value,
                    sample_frequency: modalBodyInputSample.value,
                    protocol: modalBodyInputProtocol.textContent
                }

                $.post("/update_device", data);
                window.location.reload();
            }
        });
    })
}


//Funzione chiamata al click del bottone "Vedi su Grafana"
function visualizeGrafanaGraphs(id) {
    window.open("https://cyberdude.it/wp-content/uploads/2021/01/science-of-earworms-explain-why-never-gonna-give-you-up-is-stuck-in-our-heads-30-years-later.png", '_blank').focus();
    //Visualizza grafico per esp + res_firestore.id, potremmo farlo visualizzare sotto, oppure restituire solo il link
}

//Funzione chiamata al click del bottone "Rimuovi"
async function removeEsp32(res_firestore) {
    $.post("/remove_device", {id: res_firestore.id});
    await new Promise(r => setTimeout(r, 500));
    window.location.reload();
}

function dataInfluxIDFormat(dataToFormat, id) {
    let newData = {}
    if (dataToFormat.length > 0) {
        let temperature = dataToFormat.filter(obj => obj.field === "temperature")[0]
        let humidity = dataToFormat.filter(obj => obj.field === "humidity")[0]
        let aqi = dataToFormat.filter(obj => obj.field === "aqi")[0]

        newData = {
            id: id,
            temperature: temperature.value.toFixed(2),
            humidity: humidity.value.toFixed(2),
            aqi: aqi.value.toFixed(2)
        }
    } else {
        newData = {
            id: id,
            temperature: "No data",
            humidity: "No data",
            aqi: "No data",
        }
    }
    return newData
}