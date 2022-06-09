#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>

// WiFi
const char *ssid = "Vodafone-C02090047"; // Enter your WiFi name
const char *password = "ERxFJfcyc3rtpY3H";  // Enter WiFi password

//HTTP
//Your Domain name with URL path or IP address with path
String serverName = "http://192.168.1.7:3000/sensordata";
HTTPClient http;

//Costanti
#define MQTT 0
#define HTTP 1
#define COAP 2

//Values
const float lat = 44.495;
const float lon = 11.386;
String client_id = "esp32_luca";
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

void setup() {
  // Set software serial baud to 115200;
  Serial.begin(115200);
  initWiFi();

  initMQTT();

  initHTTP();

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
  Serial.print(protocol);

  Serial.println();
  Serial.println("-----------------------");
}

int calcoloAQI(float max, float min, float * arrGas) {
  int aqi = 2;
  float average = avg(arrGas, sizeof(arrGas));
  if (average >= MAX_GAS_VALUE) {
    aqi = 0;
  } else if (MIN_GAS_VALUE <= average < MAX_GAS_VALUE) {
    aqi = 1;
  }
  Serial.print(aqi);
  return aqi;
}

float avg(float * array, int len) {
  long sum = 0L ;
  for (int i = 0 ; i < len ; i++)
    sum += array [i] ;
  return  ((float) sum) / len ;
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {

    float temperature = random(6, 300) / 100.0;
    float humidity = random(6, 300) / 100.0;
    float gas = random(6, 300) / 100.0;
    arrGas[current_measure] = gas;
    int aqi = 2;
    String stringaAQI = String("");
    float wifi_signal = WiFi.RSSI();

    Serial.println();
    Serial.print("Current_Measure --> ");
    Serial.print(current_measure);

    if (current_measure < n_measure_aqi - 1) {
      current_measure += 1;
    } else {
      current_measure = 0;
      Serial.println();
      Serial.print("AQI --> ");
      aqi = calcoloAQI(MAX_GAS_VALUE, MIN_GAS_VALUE, arrGas);
      stringaAQI = String(", \"aqi\":") + aqi;
    }

    String messaggio = String("{\"temperature\":") + temperature +
                       String(", \"humidity\":") + humidity +
                       String(", \"gas\":") + gas +
                       String(", \"wifi_signal\":") + wifi_signal +
                       String(", \"id\":\"") + client_id + String("\"") +
                       String(", \"lat\":") + lat +
                       String(", \"lon\": ") + lon +
                       stringaAQI +
                       String("}");

    Serial.println(protocol);
    Serial.println(protocol == MQTT);
    Serial.println(protocol == HTTP);
    if (protocol == MQTT) {
      client.publish(topic, messaggio.c_str());

    } else if (protocol == HTTP) {
       initHTTP();
      // Send HTTP POST request
      int httpResponseCode = http.POST(messaggio);
      if (httpResponseCode > 0) {
        Serial.print("HTTP Response code: ");
        Serial.println(httpResponseCode);
      }
      else {
        Serial.print("Error code: ");
        Serial.println(httpResponseCode);
      }
      // Free resources
      http.end();
    }
  } else {
    Serial.println("WiFi Disconnected");
  }
  client.loop();
  delay(SAMPLE_FREQUENCY);
}
