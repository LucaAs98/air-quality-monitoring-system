from prophet.serialize import model_from_json
import sys

esp = sys.argv[1]
with open('./prophetForecasting/models/'+esp+'serialized_model.json', 'r') as fin:
    m = model_from_json(fin.read())  # Load model
time = int(sys.argv[2])
future_dates = m.make_future_dataframe(periods=time, freq="s")
forecast = m.predict(future_dates)
print(forecast.yhat.iloc[-1])
