#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <coap-simple.h>
#include "DHT.h"

//Costanti
#define MQTT 0
#define HTTP 1
#define COAP 2
#define DHTPIN 21
#define DHTTYPE DHT11   // DHT 11

// WiFi
const char *ssid = "Vodafone-C02090047"; // Enter your WiFi name
const char *password = "ERxFJfcyc3rtpY3H";  // Enter WiFi password

//HTTP
//Your Domain name with URL path or IP address with path
String serverName = "http://192.168.1.7:3000/sensordata";
HTTPClient http;
//HTTP to initialize esp
String serverInit = "http://192.168.1.7:3000/initialize";

//Values
const float lat = 44.495;
const float lon = 11.386;
String client_id = "esp32_luca";
const int n_measure_aqi = 5;
int current_measure = 0;
int protocol = MQTT;
float MAX_GAS_VALUE = 0;
float MIN_GAS_VALUE = 0;
int SAMPLE_FREQUENCY = 5000;
float arrGas[n_measure_aqi] = {};
bool inizializzato = false;
bool connectionOk = false;


//MQTT
const char *mqtt_broker = "broker.emqx.io";
const char *topic = "sensor/values";
const char *topicReceive = String("device/parameters/" + client_id).c_str();
const char *mqtt_username = "emqx";
const char *mqtt_password = "public";
const int mqtt_port = 1883;

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
//Threshold gas
int sensorThres = 130;

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
  //connecting to a mqtt broker
  client.setServer(mqtt_broker, mqtt_port);
  client.setCallback(callback);
  while (!client.connected()) {
    //client_id += String(WiFi.macAddress());
    Serial.printf("The client %s connects to the public mqtt broker\n", client_id.c_str());
    if (client.connect(client_id.c_str())) {
      Serial.println("Public emqx mqtt broker connected");
    } else {
      Serial.print("failed with state ");
      Serial.print(client.state());
      delay(2000);
    }
  }
  // publish and subscribe
  client.subscribe(topicReceive);
}

//Inizializzazione connessione http
void initHTTP(String server) {
  // Your Domain name with URL path or IP address with path
  http.begin(server);
  http.addHeader("Content-Type", "application/json");
}

//Inizializzazione connessione coap
void initCoAP() {
  coap.server(callback_sensordata, "sensordata");
  coap.start();
}

//Funzione per ricevere messaggi dal server
void callback(char *topic, byte *payload, unsigned int length) {
  String message = "";
  Serial.println();
  Serial.print("Message:");
  for (int i = 0; i < length; i++) {
    message.concat(String((char) payload[i]));
  }

  // Deserialize the JSON document
  DeserializationError error = deserializeJson(doc, message);

  // Test if parsing succeeds.
  if (error) {
    Serial.print(F("deserializeJson() failed: "));
    Serial.println(error.f_str());
    Serial.println("I can't set the new parameters, JSON error!");
  } else {
    // Se il messaggio arrivato è correttamente formattato
    protocol = doc["protocol"];
    MAX_GAS_VALUE = doc["max_gas"];
    MIN_GAS_VALUE = doc["min_gas"];
    SAMPLE_FREQUENCY = doc["sample_frequency"];
    inizializzato = true;
    Serial.println("New values:");
    Serial.println("Protocol:" + String(protocol));
    Serial.println("MAX_GAS_VALUE:" + String(MAX_GAS_VALUE));
    Serial.println("MIN_GAS_VALUE:" + String(MIN_GAS_VALUE));
    Serial.println("SAMPLE_FREQUENCY:" + String(SAMPLE_FREQUENCY));
    Serial.println();
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
  } else if (MIN_GAS_VALUE <= average < MAX_GAS_VALUE) {
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
bool stampaErroriHTTP(int httpResponseCode) {
  bool ok = false;
  if (httpResponseCode > 0) {
    Serial.print("HTTP Response code: ");
    ok = true;
  } else {
    Serial.print("Error code: ");
  }
  Serial.println(httpResponseCode);
  return ok;
}

// CoAP server endpoint URL
void callback_sensordata(CoapPacket &packet, IPAddress ip, int port) {
  Serial.println("Sensor Data Request");

  const char *messaggio = calcoloValori().c_str();

  coap.sendResponse(ip, port, packet.messageid, messaggio,
                    strlen(messaggio), COAP_CONTENT, COAP_APPLICATION_JSON,
                    packet.token, packet.tokenlen);
}

//Prendiamo i valori dai sensori e calcoliamo la qualità dell'aria
String calcoloValori() {
  //DHT11
  //Read humidity
  float h = dht.readHumidity();
  // Read temperature as Celsius
  float t = dht.readTemperature();

  //MQ-2
  int g = analogRead(smokeA0);

  // Check if any reads failed and exit early (to try again).
  if (isnan(h) || isnan(t) || isnan(g)) {
    Serial.println(F("Failed to read from sensors!"));
    return "Errore";
  } else {
    Serial.println();
    Serial.print("Humidity: " + String(h));
    Serial.print(" - Temperature: " + String(t));
    Serial.print(" - Gas value: " + String(g));
    Serial.println();

    arrGas[current_measure % n_measure_aqi] = g;
    int aqi = 2;
    float wifi_signal = WiFi.RSSI();

    aqi = calcoloAQI(MAX_GAS_VALUE, MIN_GAS_VALUE, arrGas, &current_measure);

    String msg = creaMessaggio(t, h, g, aqi, wifi_signal);
    Serial.println(msg);
    return msg;
  }
}

/* Mandiamo il messaggio al server per inizializzare i parametri dell'esp, tramite l'id il server ci riconoscerà e ci invierà
i dati corretti per il nostro esp. */
void initParameters() {
  bool ok = false;
  String messaggioInit = String("{\"id\": \"" + client_id + "\"}");
  initHTTP(serverInit);
  Serial.println("Ho inviato il messaggio di inizializzazione");
  // Send HTTP POST request
  int httpResponseCode = http.POST(messaggioInit);
  ok = stampaErroriHTTP(httpResponseCode);
  inizializzato = ok;
  // Free resources
  http.end();
}

//SETUP
void setup() {
  // Set software serial baud to 115200;
  Serial.begin(115200);

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
  if (WiFi.status() == WL_CONNECTED) {
    if (!inizializzato) {
      initParameters();
      delay(3000);
    } else {
      String messaggio;

      if (protocol == MQTT || protocol == HTTP) {
        messaggio = calcoloValori();
      }

      if (protocol == MQTT) {
        client.publish(topic, messaggio.c_str());
      } else if (protocol == HTTP) {
       connectionOk = false;

        while(!connectionOk){
        initHTTP(serverName);
        // Send HTTP POST request
                int httpResponseCode = http.POST(messaggio);
                connectionOk = stampaErroriHTTP(httpResponseCode);

                // Free resources
                http.end();
        }
      }
    }
  } else {
    Serial.println("WiFi Disconnected");
  }
  client.loop();
  coap.loop();
  //Serial.println("--------------------");*/
  delay(SAMPLE_FREQUENCY);
}
