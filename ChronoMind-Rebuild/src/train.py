from pathlib import Path
import json
import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import RandomForestRegressor, HistGradientBoostingRegressor
from sklearn.model_selection import GroupShuffleSplit, GroupKFold, cross_validate
from sklearn.metrics import mean_absolute_error, r2_score

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts'
OUT.mkdir(exist_ok=True)
df = pd.read_csv(ROOT / 'data/raw/BrighterTimeData.csv')
assert {'id','task','medianrt','time_of_day','time_awake','ambient_light_log','kss_score'}.issubset(df.columns)
pvt = df.loc[df.task == 'PVT'].copy()
pvt = pvt.dropna(subset=['medianrt','id'])
pvt = pvt.loc[np.isfinite(pvt['medianrt']) & (pvt['medianrt'] > 0)]
# Cyclic clock-time representation; time of day in decimal hours.
pvt['hour_sin'] = np.sin(2 * np.pi * pvt.time_of_day / 24)
pvt['hour_cos'] = np.cos(2 * np.pi * pvt.time_of_day / 24)
features = ['hour_sin','hour_cos','time_awake','ambient_light_log']
X, y, groups = pvt[features], pvt['medianrt'], pvt['id']
train_idx, test_idx = next(GroupShuffleSplit(n_splits=1, test_size=.2, random_state=42).split(X,y,groups))
Xtrain, Xtest = X.iloc[train_idx], X.iloc[test_idx]
ytrain, ytest = y.iloc[train_idx], y.iloc[test_idx]
preprocess = ColumnTransformer([('numeric',SimpleImputer(strategy='median'),features)])
models = {
    'baseline': DummyRegressor(strategy='median'),
    'random_forest': RandomForestRegressor(n_estimators=250,min_samples_leaf=5,random_state=42,n_jobs=-1),
    'gradient_boosting': HistGradientBoostingRegressor(max_iter=150,l2_regularization=5,random_state=42),
}
results=[]
for name, estimator in models.items():
    pipe = Pipeline([('preprocess',preprocess),('model',estimator)])
    pipe.fit(Xtrain,ytrain)
    pred=pipe.predict(Xtest)
    results.append({'model':name,'test_mae_ms':round(mean_absolute_error(ytest,pred),3),'test_r2':round(r2_score(ytest,pred),4),'train_participants':int(groups.iloc[train_idx].nunique()),'test_participants':int(groups.iloc[test_idx].nunique()),'test_rows':len(test_idx)})
    joblib.dump(pipe,OUT/f'{name}.joblib')
report=pd.DataFrame(results).sort_values('test_mae_ms')
report.to_csv(OUT/'evaluation.csv',index=False)
print(report.to_string(index=False))
print('\nModels saved in artifacts/. The test set is held out by participant.')
