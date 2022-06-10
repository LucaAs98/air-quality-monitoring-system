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

setAddDeviceBehaviour();

//Quando clicchiamo un elemento della dropdown per il protocollo cambiamo il nome di essa
$(`.dropdown-item`).on('click', function () {
    let protocol = $(this).text()
    $(`#protocol_dropdown`).text(protocol)
})

//Setta il comportamento del modal che si apre quando aggiungiamo un device nella webpage.
function setAddDeviceBehaviour(){
    //Comportamento del modal che si apre quando aggiungiamo un device nella webpage.
    let modal = document.getElementById(`modal_add_device`);
    modal.addEventListener('show.bs.modal', function (event) {
        // Prendiamo gli elementi dall'html
        let modalBodyInputTitle = modal.querySelector(`.modal-body input#id_new_device`);
        let modalBodyInputMax = modal.querySelector(`.modal-body input#max_gas_value_new_device`);
        let modalBodyInputMin = modal.querySelector(`.modal-body input#min_gas_value_new_device`);
        let modalBodyInputSample = modal.querySelector(`.modal-body input#sample_frequency_value_new_device`);
        let modalBodyInputProtocol = modal.querySelector(`.modal-body button#protocol_dropdown`);

        /* Controlliamo che i campi siano correttamente completati. */
        $("#modal-form").validate({
            errorClass: "my-error-class",
            rules: {
                id: {
                    required: true,
                },
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
                id: {
                    required: "Please enter the id value",
                },
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
            submitHandler: async function (form, e) {
                if (window.arrayESP32.some(e => e.id === modalBodyInputTitle.value)) {
                    $("#errore_id_presente").show()
                } else {
                    let data = {
                        id: modalBodyInputTitle.value,
                        max: modalBodyInputMax.value,
                        min: modalBodyInputMin.value,
                        sample_frequency: modalBodyInputSample.value,
                        protocol: modalBodyInputProtocol.textContent
                    }
                    $.post("/add_device", data);
                    await new Promise(r => setTimeout(r, 500));
                    window.location.reload();
                }
            }
        });
    })
}