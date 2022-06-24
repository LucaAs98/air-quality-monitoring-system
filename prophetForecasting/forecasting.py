import sys

from prophet.serialize import model_from_json

#Prendiamo i parametri dalla chiamata dello script
sf = int((int(sys.argv[1])) / 1000)         #Sample frequesncy in secondi
path = sys.argv[2]                          #Path del file del modello

#Apriamo il file e recuperiamo il modello sulla quale effettuare il forecasting
with open(path, 'r') as fin:
    m = model_from_json(fin.read())

#Creiamo il DataFrame con i valori sulla quale effettuare il forecast
future_dates = m.make_future_dataframe(periods=sf, freq="s")
#Effettuiamo il forecast
forecast = m.predict(future_dates)
print(forecast.yhat.iloc[-1])