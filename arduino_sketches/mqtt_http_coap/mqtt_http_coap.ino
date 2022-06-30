#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <coap-simple.h>
#include "DHT.h"

//Costanti per identificare il protocollo tramite intero
#define MQTT 0
#define HTTP 1
#define COAP 2
#define UNDEFINED 3     //Usato quando l'esp non è ancora inizializzato
#define DHTPIN 21
#define DHTTYPE DHT11   // DHT 11
#define MAX_DELAY_INIT 19000  //Delay prima di fare una nuova richiesta di inizializzazione +1000 generale

// WiFi
const char *ssid = "Vodafone-C02090047";        // WiFi name
const char *password = "ERxFJfcyc3rtpY3H";      // WiFi password

//HTTP
String serverName = "http://192.168.1.7:3000/sensordata";   //URL per inviare dati con HTTP
HTTPClient http;
String serverInit = "http://192.168.1.7:3000/initialize";   //URL per richiesta di inizializzazione dell'esp

//Variables
//Position (Hardcoded)
const float lat = 44.4945441;
const float lon = 11.3440067;
String client_id = "esp32_caio";    //Client ID (Hardcoded)
const int n_measure_aqi = 5;        //Quante misure del gas prendere per calcolare aqi
int current_measure = 0;            //Misura corrente per calcolo aqi
int protocol = MQTT;                //Protocollo di default
float MAX_GAS_VALUE = 0;            //MAX_GAS di default
float MIN_GAS_VALUE = 0;            //MIN_GAS di default
int SAMPLE_FREQUENCY = 1000;        //SAMPLE_FREQUENCY di default
float arrGas[n_measure_aqi] = {};   //Array dove vengono salvati tutti i valori del gas (per calcolo aqi)
bool inizializzato = false;         //Flag per verificare che l'esp sia inizializzato
int countDelayInit = 0;             //Count utile per capire quando effettuare la nuova richiesta di inizializzazione
String initString = "Sto facendo la richiesta di inizializzazione...";
int tempoInizDelay = 0;             //Variabile che prenderà sempre i millisecondi iniziali, utile per il calcolo del delay HTTP
bool delayFlag = false;
int counterSF = 0;                  //Contatore per le operazioni di MQTT e HTTP
int countProt[3] = {0, 0, 0};


//MQTT
const char *mqtt_broker = "broker.emqx.io";     //Broker MQTT pubblico
const char *mqtt_username = "emqx";
const char *mqtt_password = "public";
const int mqtt_port = 1883;
const char *topic = "sensor/values";                                //Topic per inviare i dati dei sensori
const char *topicDelay = "delay";                                   //Topic per inviare il delay della richiesta HTTP dopo che viene calcolato
String topicReceive = String("device/parameters/" + client_id);     //Topic per ricevere i parametri dell'esp dal server
String topicAck = String("acknowledgement/" + client_id);           //Topic per ricevere l'ack quando invia un messaggio MQTT
String topicPacketNumber = String("packet_number/");           //Topic per ricevere l'ack quando invia un messaggio MQTT

bool flagAck = false;

//CoAP
WiFiUDP udp;
Coap coap(udp);
// CoAP callback
void callback_sensordata(CoapPacket &packet, IPAddress ip, int port);

//JSON
StaticJsonDocument<200> doc;

//WiFi
WiFiClient espClient;
PubSubClient client(espClient);

//Sensors
//DHT11
DHT dht(DHTPIN, DHTTYPE);
//MQ-2
int greenLed = 13;
int smokeA0 = A5;

//Inizializzazione connessione wifi
void initWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi ..");
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print('.');
    delay(1000);
  }
  Serial.println(WiFi.localIP());
}

//Inizializzazione connessione MQTT
void initMQTT() {
  //Connessione al broker MQTT
  client.setServer(mqtt_broker, mqtt_port);
  client.setCallback(callback);
  //Finchè non si connette continuiamo a provarci
  while (!client.connected()) {
    //client_id += String(WiFi.macAddress());
    Serial.printf("The client %s connects to the public mqtt broker\n", client_id.c_str());
    if (client.connect(client_id.c_str())) {
      Serial.println("Public emqx mqtt broker connected");
    } else {
      Serial.print("Failed with state ");
      Serial.print(client.state());
      delay(2000);
    }
  }

  //Ci sottoscriviamo al topic per ricevere i parametri di inizializzazione (o di cambio parametri)
  client.subscribe(topicReceive.c_str());
  //Ci sottoscriviamo al topic per ricevere gli ack dei messaggi MQTT
  client.subscribe(topicAck.c_str());
}

//Inizializzazione connessione HTTP
void initHTTP(String server) {
  http.begin(server);
  http.addHeader("Content-Type", "application/json");
}

//Inizializzazione connessione COAP
void initCoAP() {
  coap.server(callback_sensordata, "sensordata");
  coap.start();
}

//Funzione per ricevere messaggi dal server tramite MQTT
void callback(char *topic, byte *payload, unsigned int length) {
  String message = "";
  for (int i = 0; i < length; i++) {
    message.concat(String((char) payload[i]));
  }

  //Quando riceviamo il messaggio dei parametri dobbiamo interpretare il JSON
  DeserializationError error = deserializeJson(doc, message);

  //Controlliamo che il parsing dei dati JSON sia andato a buon fine
  if (error) {
    Serial.print(F("deserializeJson() failed: "));
    Serial.println(error.f_str());
    Serial.println("I can't set the new parameters, JSON error!");
  } else {
    if (String(topic).equals(topicReceive)) {
      // Se il messaggio arrivato è correttamente formattato prendiamo i dati che ci servono da esso
      int exProt = protocol;

      protocol = doc["protocol"];
      MAX_GAS_VALUE = doc["max_gas_value"];
      MIN_GAS_VALUE = doc["min_gas_value"];
      bool newDelayFlag = doc["delayFlag"];

      //Se il protocollo non è COAP dobbiamo settare la SAMPLE_FREQUENCY altrimenti i tempi saranno dettati dal server
      if (protocol != COAP)
        SAMPLE_FREQUENCY = doc["sample_frequency"];
      else
        SAMPLE_FREQUENCY = 1000;

      if (protocol != exProt)
        counterSF = SAMPLE_FREQUENCY;

      //Stampa dei dati ricevuti
      Serial.println();
      Serial.println("Protocol:" + String(protocol));
      Serial.println("MAX_GAS_VALUE:" + String(MAX_GAS_VALUE));
      Serial.println("MIN_GAS_VALUE:" + String(MIN_GAS_VALUE));
      Serial.println("SAMPLE_FREQUENCY:" + String(SAMPLE_FREQUENCY));
      Serial.println("DelayFlag:" + String(newDelayFlag));
      Serial.println();

      //In caso il protocollo non sia stato definito continuiamo a richiedere l'inizializzazione
      if (protocol != UNDEFINED) {
        //Se il dispositivo è inizializzato allora controllliamo se c'è da inviare il numero dei pacchetti
        if (delayFlag && !newDelayFlag) {
          client.publish(topicPacketNumber.c_str(), String("{\"id\": \"" + client_id + "\" , \"MQTT_packets\": " + String(countProt[MQTT]) + " , \"HTTP_packets\": " + String(countProt[HTTP]) +  " , \"COAP_packets\": " + String(countProt[COAP]) + "}").c_str());
          countProt[MQTT] = 0;
          countProt[HTTP] = 0;
          countProt[COAP] = 0;
        }
        delayFlag = newDelayFlag;
        inizializzato = true;
      } else {
        inizializzato = false;
        countDelayInit = 0;
        initString = "Sto facendo la richiesta di inizializzazione...";
      }
    } else {
      if (delayFlag) {
        Serial.println("Inizio: " + String(tempoInizDelay));
        int fine = millis();
        Serial.println("Fine: " + String(fine));
        int delayMessage =  fine - tempoInizDelay;            //Calcoliamo il delay
        Serial.println("delay: " + String(delayMessage));
        Serial.println("MQTT delay sent!");
        client.publish(topicDelay, String("{\"id\": \"" + client_id + "\" , \"delay\": " + String(delayMessage) + ", \"protocol\": \"MQTT\" }").c_str());
      }
    }
  }
}

//Funzione per calcolare la qualità dell'aria
int calcoloAQI(float max, float min, float * arrGas, int *counter) {
  int aqi = 2;
  float average = 0;
  if (*counter < n_measure_aqi - 1) {
    average = avg(arrGas, *counter + 1);
    *counter += 1;
  } else {
    average = avg(arrGas, sizeof(arrGas));
    if (*counter == ((n_measure_aqi * 2) - 1)) {
      *counter = n_measure_aqi;
    } else {
      *counter += 1;
    }
  }
  if (average >= MAX_GAS_VALUE) {
    aqi = 0;
  } else if (MIN_GAS_VALUE <= average && average < MAX_GAS_VALUE) {
    aqi = 1;
  }
  return aqi;
}

//Media degli elementi di un array
float avg(float * array, int len) {
  long sum = 0L ;
  for (int i = 0 ; i < len ; i++)
    sum += array[i] ;
  return  ((float) sum) / len ;
}

//Funzione per creare la stringa da mandare al server
String creaMessaggio(float temperature, float humidity, float gas, int aqi, float wifi_signal) {
  return String("{\"t\":") + temperature +
         String(", \"h\":") + humidity +
         String(", \"g\":") + gas +
         String(", \"w\":") + wifi_signal +
         String(", \"i\":\"") + client_id + String("\"") +
         String(", \"lt\":") + String(lat, 7) +
         String(", \"ln\": ") + String(lon, 7) +
         String(", \"a\": ") + aqi +
         String("}");
}

//Stampa gli errori o i successi della connessione http, return true se è andato tutto bene
boolean stampaErroriHTTP(int httpResponseCode) {
  bool ok = true;
  if (httpResponseCode > 0) {
    Serial.print("HTTP Response code: ");
  } else {
    Serial.print("Error code: ");
    ok = false;
  }
  Serial.println(httpResponseCode);
  //Se stiamo chiedendo l'inizializzazione di un device non presente su firestore il server ci restituirà il codice 501
  if (httpResponseCode == 501) {
    Serial.println("Nessun dispositivo registrato con questo id!");
    ok = false;
  }
  return ok;
}

//Callback COAP, chiamata quando deve inviare un messaggio tramite il protocollo COAP
void callback_sensordata(CoapPacket &packet, IPAddress ip, int port) {
  const char *messaggio = calcoloValori().c_str();      //Prendiamo i valori dai sensori e restituiamo il messaggio da inviare
  //Invio della risposta COAP
  coap.sendResponse(ip, port, packet.messageid, messaggio,
                    strlen(messaggio), COAP_CONTENT, COAP_APPLICATION_JSON,
                    packet.token, packet.tokenlen);
}

//Prendiamo i valori dai sensori e calcoliamo la qualità dell'aria, inoltre creaimo il messaggio da inviare
String calcoloValori() {
  //DHT11
  float h = dht.readHumidity();         //Leggiamo l'umidità
  float t = dht.readTemperature();      //Leggiamo la temperatura

  //MQ-2
  int g = analogRead(smokeA0);          //Leggiamo il valore del gas

  //Controlliamo che non ci siano stati errori nella lettura dei valori dei sensori
  if (isnan(h) || isnan(t) || isnan(g)) {
    Serial.println(F("Failed to read from sensors!"));
    return "Errore";
  } else {
    //Se la lettura dei sensori è andata a buon fine dobbiamo calcolare prima di tutto l'aqi
    arrGas[current_measure % n_measure_aqi] = g;                                //Moving Average Window
    int aqi = 2;                                                                    //Inizializziamo l'aqi a 2
    aqi = calcoloAQI(MAX_GAS_VALUE, MIN_GAS_VALUE, arrGas, &current_measure);   //Calcolo aqi
    float wifi_signal = WiFi.RSSI();                                            //Misuriamo anche l'RSSI del WiFi
    String msg = creaMessaggio(t, h, g, aqi, wifi_signal);                      //Creazione del messaggio
    Serial.println(client_id + " - Protocollo: " + protocol + " --> " + msg);   //Stampiamo per vedere se il messaggio è corretto
    if (delayFlag) {
      countProt[protocol] += 1;
      Serial.println("N MQTT -> " + String(countProt[MQTT]));
      Serial.println("N HTTP -> " + String(countProt[HTTP]));
      Serial.println("N COAP -> " + String(countProt[COAP]));
    }
    return msg;
  }
}

/* Mandiamo il messaggio al server per inizializzare i parametri dell'esp, tramite l'id il server ci riconoscerà e ci invierà
  i dati corretti per il nostro esp. */
void initParameters() {
  //Oltre l'id, inviamo al server anche l'ip (Per future richieste COAP) e la latitudine e la longitudine (Per prima richiesta OpenWeatherMap)
  String messaggioInit = String("{\"id\": \"" + client_id + "\", \"ip\": \"" + WiFi.localIP().toString() + "\", \"lt\":" + String(lat, 7) + ", \"ln\": " + String(lon, 7) + "}");
  initHTTP(serverInit);                             //Per settare il nuovo URL alla quale fare richiesta di inizializzazione
  int httpResponseCode = http.POST(messaggioInit);  //Mandiamo la richiesta
  http.end();
}

//Controlliamoche l'esp sia stato inizializzato prima di procedere nel prendere i dati dai sensori
void checkInitRequest() {
  //Se il contatore è a zero, effettuiamo una richiesta per i parametri
  if (countDelayInit == 0) {
    initParameters();                                       //Richiesta dei parametri
    countDelayInit = countDelayInit + SAMPLE_FREQUENCY;     //Incrementiamo il contatore per la richiesta di inizializzazione
  }//Se non è zero, aspettiamo tot secondi, se raggiungiamo la soglia dei venti ne facciamo un'altra
  else {
    if (countDelayInit == MAX_DELAY_INIT) {
      Serial.println();
      Serial.println("Nessuna risposta. Faccio una nuova richiesta!");
      initString = "Sto facendo la richiesta di inizializzazione...";
      countDelayInit = 0;
    }
    else {
      countDelayInit = countDelayInit + SAMPLE_FREQUENCY;   //Incrementiamo il contatore per la richiesta di inizializzazione
    }
  }
}

//SETUP
void setup() {
  // Set software serial baud to 115200;
  Serial.begin(115200);

  //Inizializziamo tutto
  initWiFi();
  initMQTT();
  initHTTP(serverName);
  initCoAP();

  //DHT11
  dht.begin();

  //Pin MQ-2
  pinMode(greenLed, OUTPUT);
  pinMode(smokeA0, INPUT);
}

//LOOP
void loop() {

  //Se è connesso ed inizilizzato possiamo procedere
  if (WiFi.status() == WL_CONNECTED) {
    if (!inizializzato) {
      //Se non è inizilizzato continuiamo a chiedere l'inizializzazione
      Serial.print(initString);
      initString = ".";
      checkInitRequest();
    } else {
      if (counterSF >= SAMPLE_FREQUENCY) {
        String messaggio;                   //Variabile che prenderà sempre il messaggio da inviare al server
        if (protocol == MQTT || protocol == HTTP) {
          messaggio = calcoloValori();      //COAP non compreso perchè il calcolo dei valori verrà fatto solamente quando necessario
        }

        if (protocol == MQTT) {
          if (delayFlag)
            tempoInizDelay = millis();

          client.publish(topic, messaggio.c_str());   //Se sta usando MQTT allora pubblichiamo al topic dedicato
        } else if (protocol == HTTP) {
          initHTTP(serverName);                               //Se invece sta usando HTTP inizializziamo il tutto per l'URL dedicato
          int delayMessageHTTP;
          int tempoInizDelayHTTP;
          int fineHTTP;
          if (delayFlag)
            tempoInizDelayHTTP = millis();                          //Prendiamo i millisecondi per poi caloclare il delay
          int httpResponseCode = http.POST(messaggio);        //Facciamo la richiesta
          if (delayFlag) {
            fineHTTP = millis();
            delayMessageHTTP = fineHTTP - tempoInizDelayHTTP;         //Calcoliamo il delay

          }
          bool ok = stampaErroriHTTP(httpResponseCode);       //Controlliamo che la richiesta sia andata a buon fine
          //Se è andata buon fine inviamo il delay al server
          if (ok && delayFlag) {
            Serial.println("HTTP delay sent!");
            Serial.println("Inizio: " + String(tempoInizDelayHTTP));
            Serial.println("Fine: " + String(fineHTTP));
            Serial.println("delay: " + String(delayMessageHTTP));
            client.publish(topicDelay, String("{\"id\": \"" + client_id + "\" , \"delay\": " + String(delayMessageHTTP) + ", \"protocol\": \"HTTP\" }").c_str());
          }
          http.end();
        }
        counterSF = 0;
      }

      counterSF = counterSF + 1;
    }
  } else {
    Serial.println("WiFi Disconnected");
  }
  client.loop();
  coap.loop();

  if (!inizializzato)
    delay(1000);
  else
    delay(1);
}
