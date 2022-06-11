#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <coap-simple.h>

//Costanti
#define MQTT 0
#define HTTP 1
#define COAP 2

// WiFi
const char *ssid = "Vodafone-C02090047"; // Enter your WiFi name
const char *password = "ERxFJfcyc3rtpY3H";  // Enter WiFi password

//HTTP
//Your Domain name with URL path or IP address with path
String serverName = "http://192.168.1.8:3000/sensordata";
HTTPClient http;

//Values
const float lat = 44.495;
const float lon = 11.386;
String client_id = "esp32_nash";
const int n_measure_aqi = 5;
int current_measure = 0;
int protocol = MQTT;
float MAX_GAS_VALUE = 3;
float MIN_GAS_VALUE = 1;
int SAMPLE_FREQUENCY = 2000;
float arrGas[n_measure_aqi] = {};


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

StaticJsonDocument<200> doc;

WiFiClient espClient;
PubSubClient client(espClient);

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

void initHTTP() {
  // Your Domain name with URL path or IP address with path
  http.begin(serverName);
  http.addHeader("Content-Type", "application/json");
}

void initCoAP() {
  Serial.println("Setup Callback Light");
  coap.server(callback_sensordata, "sensordata");
  // start coap server/client
  coap.start();
}

void setup() {
  // Set software serial baud to 115200;
  Serial.begin(115200);
  initWiFi();

  initMQTT();

  initHTTP();

  initCoAP();

}

void callback(char *topic, byte *payload, unsigned int length) {
  String message = "";
  Serial.println();
  Serial.print("Message:");
  for (int i = 0; i < length; i++) {
    message.concat(String((char) payload[i]));
  }

  //char json[] = message;

  // Deserialize the JSON document
  DeserializationError error = deserializeJson(doc, message);

  // Test if parsing succeeds.
  if (error) {
    Serial.print(F("deserializeJson() failed: "));
    Serial.println(error.f_str());
    return;
  }

  // Fetch values.
  protocol = doc["protocol"];
  MAX_GAS_VALUE = doc["max_gas"];
  MIN_GAS_VALUE = doc["min_gas"];
  SAMPLE_FREQUENCY = doc["sample_frequency"];
  Serial.println("New values:");
  Serial.println("Protocol:" + String(protocol));
  Serial.println("MAX_GAS_VALUE:" + String(MAX_GAS_VALUE));
  Serial.println("MIN_GAS_VALUE:" + String(MIN_GAS_VALUE));
  Serial.println("SAMPLE_FREQUENCY:" + String(SAMPLE_FREQUENCY));
  Serial.println();
}

int calcoloAQI(float max, float min, float * arrGas, int *counter) {
  int aqi = 2;
  float average = 0;
  Serial.println("Counter in calcoloAQI --> " + String(*counter));
  if (*counter < n_measure_aqi - 1) {
    average = avg(arrGas, *counter + 1);
    *counter += 1;
  } else {
    average = avg(arrGas, sizeof(arrGas));
    if (*counter == ((n_measure_aqi * 2) - 1)) {
      Serial.println("Ho fatto l'assegnamento");
      *counter = n_measure_aqi;
    } else {
      *counter += 1;
    }
    Serial.println("Sto uscendo dall'else del calcoloAQI con counter --> " + String(*counter));
  }
  if (average >= MAX_GAS_VALUE) {
    aqi = 0;
  } else if (MIN_GAS_VALUE <= average < MAX_GAS_VALUE) {
    aqi = 1;
  }
  Serial.println("AQI --> " + String(aqi));
  return aqi;
}

float avg(float * array, int len) {
  Serial.println("Lunghezza array in avg --> " + String(len));
  long sum = 0L ;
  for (int i = 0 ; i < len ; i++)
    sum += array[i] ;
  return  ((float) sum) / len ;
}

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

void stampaErroriHTTP(int httpResponseCode) {
  if (httpResponseCode > 0) {
    Serial.print("HTTP Response code: ");
  } else {
    Serial.print("Error code: ");
  }
  Serial.println(httpResponseCode);
}

// CoAP server endpoint URL
void callback_sensordata(CoapPacket &packet, IPAddress ip, int port) {
  Serial.println("Sensor Data Request");

  const char *messaggio = calcoloValori().c_str();

  coap.sendResponse(ip, port, packet.messageid, messaggio,
                    strlen(messaggio), COAP_CONTENT, COAP_APPLICATION_JSON,
                    packet.token, packet.tokenlen);
}

String calcoloValori() {

  float temperature = random(6, 300) / 100.0;
  float humidity = random(6, 300) / 100.0;
  float gas = random(6, 300) / 100.0;
  arrGas[current_measure % n_measure_aqi] = gas;
  int aqi = 2;
  float wifi_signal = WiFi.RSSI();

  //Serial.println("Current_Measure in loop --> " + String(current_measure));
  aqi = calcoloAQI(MAX_GAS_VALUE, MIN_GAS_VALUE, arrGas, &current_measure);

  String msg = creaMessaggio(temperature, humidity, gas, aqi, wifi_signal);
  Serial.println(msg);
  return msg;
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    String messaggio;
    if (protocol == MQTT || protocol == HTTP) {
      Serial.println("Creazione messaggio!");
      messaggio = calcoloValori();
    }

    if (protocol == MQTT) {
      client.publish(topic, messaggio.c_str());
    } else if (protocol == HTTP) {
      initHTTP();
      // Send HTTP POST request
      int httpResponseCode = http.POST(messaggio);
      stampaErroriHTTP(httpResponseCode);

      // Free resources
      http.end();
    }
  } else {
    Serial.println("WiFi Disconnected");
  }
  client.loop();
  coap.loop();
  //Serial.println("--------------------");
  delay(SAMPLE_FREQUENCY);
}
