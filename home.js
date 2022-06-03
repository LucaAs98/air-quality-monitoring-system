var realTerrain = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {})
var realTerrain2 = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {})
var realTerrain3 = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {})
var realTerrain4 = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {})

const mapDiv1 = document.getElementById("map1");
const mapDiv2 = document.getElementById("map2");
const mapDiv3 = document.getElementById("map3");
const mapDiv4 = document.getElementById("map4");


var mymap1 = L.map('map11', {
    center: [44.49712, 11.34248],
    zoom: 15,
    layers: [realTerrain],
});

var marker = L.marker([44.49712, 11.34248]).addTo(mymap1);

var mymap2 = L.map('map22', {
    center: [44.49712, 11.34248],
    zoom: 15,
    layers: [realTerrain2],
});

var marker2 = L.marker([44.49712, 11.34248]).addTo(mymap2);



var mymap3 = L.map('map33', {
    center: [44.49712, 11.34248],
    zoom: 15,
    layers: [realTerrain3],
});

var marker3 = L.marker([44.49712, 11.34248]).addTo(mymap3);


var mymap4 = L.map('map44', {
    center: [44.49712, 11.34248],
    zoom: 15,
    layers: [realTerrain4],
});

var marker4 = L.marker([44.49712, 11.34248]).addTo(mymap4);

const resizeObserver = new ResizeObserver(() => {
    mymap1.invalidateSize();
    mymap2.invalidateSize();
    mymap3.invalidateSize();
    mymap4.invalidateSize();
});


resizeObserver.observe(mapDiv1)
resizeObserver.observe(mapDiv2)
resizeObserver.observe(mapDiv3)
resizeObserver.observe(mapDiv4)

/*
resizeObserver2.observe(mapDiv2)
resizeObserver3.observe(mapDiv3)
resizeObserver4.observe(mapDiv4)*/
