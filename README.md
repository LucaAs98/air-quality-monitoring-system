# ☁️⛈️🌤️ Sistema di Monitoraggio della Qualità dell'Aria Interna Basato su IoT

## Descrizione del Progetto

Questo progetto consiste nello sviluppo di un'applicazione IoT per scenari di smart home, includendo funzionalità di monitoraggio dei parametri ambientali interni, come temperatura, umidità e concentrazione di gas, raccolta e previsione dei dati. Il sistema include i seguenti componenti:

### Componenti del Sistema

1. **Dispositivo Smart IoT**
   - Costituito da una scheda di prototipazione (ad es. ESP32) collegata a sensori ambientali.
   - Sensori inclusi: temperatura esterna, umidità esterna e rilevazione di fuga di gas (es. monossido di carbonio).

2. **Proxy Dati**
   - Applicazione software che gira su un dispositivo non IoT (es. laptop o Raspberry Pi).
   - Si occupa di acquisire e memorizzare i dati su un database INFLUX.

3. **Sistema di Gestione Dati**
   - Utilizza strumenti INFLUX e GRAFANA per la memorizzazione delle serie temporali e la creazione di dashboard.

4. **Analisi Dati**
   - Applicazione separata per la previsione dei valori di temperatura, umidità e concentrazione di gas nei successivi X secondi.

### Funzionalità

Il dispositivo IoT deve supportare le seguenti funzionalità:

- **Acquisizione Dati:** Valori dei sensori acquisiti ogni `SAMPLE FREQUENCY` secondi.
- **Trasmissione Dati:** Trasmissione dei valori dei sensori a un back-end remoto tramite Wi-Fi, utilizzando protocolli di messaggistica come MQTT, CoAP o HTTP.
- **Configurazione Dinamica:** Possibilità di cambiare il protocollo e configurare i parametri a runtime.
- **Calcolo dell'Indice di Qualità dell'Aria (AQI):** L'AQI viene calcolato in base alla media delle ultime 5 misurazioni.

### Componenti Aggiuntivi

- **Recupero della Temperatura Esterna:** Sviluppato un componente per recuperare la temperatura esterna media dalla tua posizione attuale tramite un servizio API meteo aperto.
- **Bot Telegram:** Un bot per ricevere avvisi e report periodici con i valori medi dei sensori.
- **Dashboard Web:** Una dashboard web per monitorare più stazioni di qualità dell'aria contemporaneamente, con funzionalità di registrazione e configurazione di nuovi dispositivi.

## Tecnologie Utilizzate

Scheda ESP32 con sensori DHT11 (per temperatura/umidità) e MQ-2 (per monitoraggio gas).

## Valutazione delle Prestazioni

È stata effettuata una valutazione delle prestazioni dell'acquisizione dati e dei componenti di analisi, calcolando il ritardo medio e il rapporto di consegna dei pacchetti per ciascun protocollo supportato, e l'errore quadratico medio (MSE) per gli algoritmi di previsione.
