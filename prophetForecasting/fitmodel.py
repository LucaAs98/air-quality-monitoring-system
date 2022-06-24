import sys

import pandas as pd
from influxdb_client import InfluxDBClient
from influxdb_client.client.write_api import SYNCHRONOUS
from prophet import Prophet
from prophet.serialize import model_to_json

#Inizializzazione INFLUX
token = '0k-LO5VmaViza7ENc4C_9LIucTtOQmWGA-XWYHewT4yYeIMx01gSei4H-ivjGqtLQ8xgXEjTFn1YCfGXafOY3g=='
org = 'andrea.cirina@studio.unibo.it'
bucket = 'iotProject2022'
client = InfluxDBClient(url="https://eu-central-1-1.aws.cloud2.influxdata.com", token=token, org=org)
query_api = client.query_api()
write_api = client.write_api(write_options=SYNCHRONOUS)

#Prendiamo i parametri dalla chiamata dello script
esp = sys.argv[1]
field = sys.argv[2]
pathModel = sys.argv[3]

#Query per prendere i dati da INFLUXD per effettuare il training del modello
query = 'from(bucket: "' + bucket + '")' \
        ' |> range(start: -24h)' \
        ' |> filter(fn: (r) => r._measurement == "measurements")' \
        ' |> filter(fn: (r) => r._field == "' + field + '")' \
        ' |> filter(fn: (r) => r.id == "' + esp + '")'

result = client.query_api().query(org=org, query=query)

#Scorriamo i risultati della query e li inseriamo in un DataFrame pandas
raw = []
for table in result:
    for record in table.records:
        raw.append((record.get_value(), record.get_time()))

df = pd.DataFrame(raw, columns=['y', 'ds'], index=None)
df['ds'] = df['ds'].values

#Settiamo e fittiamo il modello
model = Prophet(interval_width=0.95)
model.fit(df)

#Crea il file JSON con il modello
with open(pathModel, 'w') as fout:
    fout.write(model_to_json(model))
