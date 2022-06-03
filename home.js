//Array dei dispositivi da visualizzare. Si dovranno prendere da firebase.
let arrayESP32 = [
    {
        id: 'esp1',
        lat: 44.49712,
        long: 11.34248
    },
    {
        id: 'esp2',
        lat: 44.49712,
        long: 11.34248
    },
    {
        id: 'esp3',
        lat: 44.49712,
        long: 11.34248
    },
    {
        id: 'esp4',
        lat: 44.49712,
        long: 11.34248
    }]


//Scorriamo tutti i dispositivi che vogliamo visualizzare
arrayESP32.forEach((result, idx) => {
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
                            <button class="btn btn-primary" type="button">Vedi su grafana</button>
                            <button class="btn btn-primary" type="button" data-bs-toggle="collapse" href="#map_div_${idx}" role="button" aria-expanded="false" aria-controls="map_div_${idx}">Vedi su mappa</button>
                            <button class="btn btn-primary" type="button">Cambia parametri</button>
                            <button class="btn btn-danger" type="button">Rimuovi</button>
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
})
