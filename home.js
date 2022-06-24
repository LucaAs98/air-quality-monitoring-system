//Nascondiamo la scritta che non ci sono device registrati. Verrà mostrata se dopo averli presi non ne abbiamo.
$("#no_device").hide()

//Nascondiamo l'errore dell'id già presente per mostrarlo quando necessario
$("#errore_id_presente").hide()

//Prendiamo tutti i device presenti su firestore, creiamo le loro carte e li visualizziamo nella webpage.
$.getScript("./get_devices.js")
    .done(function (script, textStatus) {
        console.log("Devices loaded");
    })
    .fail(function (jqxhr, settings, exception) {
        console.log("Error in loading devices");
    });

//Settiamo come si deve comportare la parte dell'aggiunta di un device
setAddDeviceBehaviour();

//Quando clicchiamo un elemento della dropdown per il protocollo cambiamo il nome di essa
$(`.dropdown-item`).on('click', function () {
    let protocol = $(this).text()
    $(`#protocol_dropdown`).text(protocol)
})

/** MODAL **/
//Setta il comportamento del modal che si apre quando aggiungiamo un device nella webpage.
function setAddDeviceBehaviour() {
    //Comportamento del modal che si apre quando aggiungiamo un device nella webpage.
    let modal = document.getElementById(`modal_add_device`);
    modal.addEventListener('show.bs.modal', function (event) {
        // Prendiamo gli elementi dall'html
        let modalBodyInputTitle = modal.querySelector(`.modal-body input#id_new_device`);
        let modalBodyInputSample = modal.querySelector(`.modal-body input#sample_frequency_value_new_device`);
        let modalBodyInputProtocol = modal.querySelector(`.modal-body button#protocol_dropdown`);

        /* Controlliamo che i campi siano correttamente completati. */
        $("#modal-form").validate({
            errorClass: "my-error-class",
            rules: {
                id: {
                    required: true,
                },
                sample_frequency: {
                    required: true,
                    number: true
                },
            },
            messages: {
                id: {
                    required: "Please enter the id value",
                },
                sample_frequency: {
                    required: "Please enter the sample frequency value",
                    number: "Enter a number please"
                }
            },
        });
        /* Abbiamo dovuto separare la validate dalla submit per poter mettere un piccolo delay e dare il tempo
         * di salvare i dati prima di ricaricare la pagina. */
        $(`#add_new_device`).click(async function () {
            if (!$("#modal-form").valid()) { // Not Valid
                return false;
            } else {
                //Se stiamo già visualizzando questo device allora diamo un errore
                if (window.arrayESP32.some(e => e.id === modalBodyInputTitle.value)) {
                    $("#errore_id_presente").show()
                } else {
                    let data = {
                        id: modalBodyInputTitle.value,
                        max_gas_value: $(`#slider-2-home`).val(),   //behaviour dello slider impostato in get_device
                        min_gas_value: $(`#slider-1-home`).val(),
                        sample_frequency: modalBodyInputSample.value,
                        protocol: modalBodyInputProtocol.textContent
                    }
                    //Aggiungiamo il nuovo device a firebase
                    $.post("/add_device", data);
                    //Piccola sleep per avere il tempo di aggiornare i dati e poter ricaricare infine la pagina
                    await new Promise(r => setTimeout(r, 500));
                    window.location.reload();
                }
            }
        });
    })
}