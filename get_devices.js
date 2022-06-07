getDevices()

window.arrayESP32 = [];

async function getDevices() {
    const response = await fetch('/devices');
    window.arrayESP32 = await response.json()
    if (window.arrayESP32.length > 1) {
        $("#loading").hide()
        addDevices();
    } else {
        $("#no_device").show()
        $("#loading").hide()
    }
}

function addDevices() {
    //Scorriamo tutti i dispositivi che vogliamo visualizzare
    window.arrayESP32.forEach((result) => {
        if (result.id !== "default")
            aggiungiCarta(result)
    })
}

//Metodo per aggiungere la carta nella home, necessita dei dati da visualizzare e dell'id (in numero) dell'esp
function aggiungiCarta(result) {
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
                            <button class="btn btn-primary" type="button" id="grafana_${result.id}">Vedi su grafana</button>
                            <button class="btn btn-primary" type="button" data-bs-toggle="collapse" href="#map_div_${result.id}" role="button" aria-expanded="false" aria-controls="map_div_${result.id}">Vedi su mappa</button>
                            <button type="button" class="btn btn-primary" data-bs-toggle="modal" data-bs-target=#modal${result.id} data-bs-whatever=${result.id}>Cambia Parametri</button>
                            <button class="btn btn-danger" type="button" id="remove_${result.id}">Rimuovi</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="collapse" id="map_div_${result.id}">
                <div id="map${result.id}"></div>
            </div>
        </div>
       
        <div class="modal fade" id=modal${result.id} tabindex="-1" aria-labelledby=modal${result.id}Label aria-hidden="true">
          <div class="modal-dialog">
            <div class="modal-content">  
                <form id="modal-form-${result.id}">
                  <div class="modal-header">
                    <h5 class="modal-title" id=modal${result.id}Label>Change ${result.id}'s parameters</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                  </div>
                  <div class="modal-body">
             
                       <div class="mb-3">
                        <label for="max_gas_value_${result.id}" class="form-label">MAX_GAS_VALUE</label>
                        <input type="text" class="form-control" id="max_gas_value_${result.id}" value=${result.max} name="max_gas" aria-describedby="max_gas_help">
                      </div>
                      <div class="mb-3">
                        <label for="min_gas_value_${result.id}" class="form-label">MIN_GAS_VALUE</label>
                        <input type="text" class="form-control" id="min_gas_value_${result.id}" value=${result.min} name="min_gas" aria-describedby="min_gas_help">
                      </div>
                      <div class="mb-3">
                        <label for="sample_frequency_value_${result.id}" class="form-label">SAMPLE FREQUENCY</label>
                        <input type="text" class="form-control" id="sample_frequency_value_${result.id}" value=${result.sample_frequency} name="sample_frequency" aria-describedby="sample_frequency_help">
                      </div>
                       <label for="protocol_dropdown_${result.id}" class="form-label">PROTOCOL</label>
                            <div class="dropdown">
                                <button class="btn btn-secondary dropdown-toggle" type="button" id="protocol_dropdown_${result.id}"
                                        data-bs-toggle="dropdown" aria-expanded="false">
                                    ${result.protocol}
                                </button>
                                <ul class="dropdown-menu" aria-labelledby="protocol_dropdown_${result.id}">
                                    <li class="dropdown-item">MQTT</li>
                                    <li class="dropdown-item">COAP</li>
                                    <li class="dropdown-item">HTTP</li>
                                </ul>
                            </div>
                  </div>
                  <div class="modal-footer">
                    <button type="button" class="btn btn-danger" data-bs-dismiss="modal">Close</button>
                    <button type="submit" class="btn btn-success" id="change_parameters_${result.id}">Cambia parametri</button>
                  </div>
                </div>
            </form>
          </div>
        </div>
    </div>`

    //Appendiamo una carta di un nuovo dispositivo
    $('#containerCards').append(newCard)

    //Creiamo la mappa per quest'ultimo
    var map = L.map(`map${result.id}`, {
        center: [result.lat, result.long],
        zoom: 15,
        layers: [realTerrain],
    });

    //Aggiungiamo il marker che permette di capire dove si trova nella mappa
    var marker = L.marker([result.lat, result.long]).addTo(map);

    //Impostiamo l'altezza della mappa
    $(`#map${result.id}`).css('height', 180 + 'px');

    /* Istruzioni necessarie per evitare che la mappa non si veda bene. Controlla quando il div che contiene si modifica
    *  in modo tale da aggiornare la dimensione della mappa. (Non importante)*/
    const resizeObserver = new ResizeObserver(() => {
        map.invalidateSize();
    });
    resizeObserver.observe($(`#map_div_${result.id}`)[0])

    //Comportamento onclick dei bottoni
    $(`#grafana_${result.id}`).on("click", function () {
        visualizeGrafanaGraphs(result.id)
    })

    $(`#remove_${result.id}`).on("click", function () {
        removeEsp32(result)
    })


    //Comportamento del modal
    let modal = document.getElementById(`modal${result.id}`);

    modal.addEventListener('show.bs.modal', function (event) {
        //Quando clicchiamo un elemento della dropdown cambiamo il nome di essa
        $(`.dropdown-item`).on('click', function () {
            let protocol = $(this).text()
            $(`#protocol_dropdown_${result.id}`).text(protocol)
        })


        /* Controlliamo che i campi siano correttamente completati. */
        $(`#modal-form-${result.id}`).validate({
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
                let modalBodyInputMax = modal.querySelector(`.modal-body input#max_gas_value_${result.id}`);
                let modalBodyInputMin = modal.querySelector(`.modal-body input#min_gas_value_${result.id}`);
                let modalBodyInputSample = modal.querySelector(`.modal-body input#sample_frequency_value_${result.id}`);
                let modalBodyInputProtocol = modal.querySelector(`.modal-body button#protocol_dropdown_${result.id}`);

                let data = {
                    id: result.id,
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
    //Visualizza grafico per esp + result.id, potremmo farlo visualizzare sotto, oppure restituire solo il link
}

//Funzione chiamata al click del bottone "Cambia Parametri"
function sendNewParameters(result) {

}

//Funzione chiamata al click del bottone "Rimuovi"
function removeEsp32(result) {
    $.post("/remove_device", {id: result.id});
    window.location.reload();
}

