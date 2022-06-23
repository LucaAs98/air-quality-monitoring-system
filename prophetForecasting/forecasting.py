import sys

from prophet.serialize import model_from_json

sf = int((int(sys.argv[1])) / 1000)
path = sys.argv[2]

with open(path, 'r') as fin:
    m = model_from_json(fin.read())  # Load model

future_dates = m.make_future_dataframe(periods=sf, freq="s")
forecast = m.predict(future_dates)
print(forecast.yhat.iloc[-1])
