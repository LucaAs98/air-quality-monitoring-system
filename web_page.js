const express = require("express");
const open = require('open');

const app = express();

app.set('views', __dirname + '/');
app.engine('html', require('ejs').renderFile);
app.set('view engine', 'ejs');

app.use(express.static(__dirname));

/* Stiamo in ascolto su "localhost:3000". */
app.listen(3000, () => {
    console.log("Application started and Listening on port 3000");
});


/*** Richieste GET ***/
/* Ad URL "/home" rendirizziamo "home.html". Questo a sua volta chiamerà lo script "home.js". */
app.get("/home", (req, res) => {
    res.render("home.html");
});

app.post("/home", (req, res) => {
    res.render("home.html");
});


// All'avvio apriamo la home con il browser di default.
open("http://localhost:3000/home");