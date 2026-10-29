"""Compare population and personalized PVT forecasts on unseen participants."""
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.model_selection import GroupShuffleSplit
from sklearn.impute import SimpleImputer
from sklearn.pipeline import make_pipeline
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error

ROOT = Path(__file__).resolve().parents[1]
df = pd.read_csv(ROOT / 'data/raw/BrighterTimeData.csv')
p = df.loc[df.task.eq('PVT')].dropna(subset=['id', 'medianrt', 'time_of_day', 'time_awake']).copy()
p = p.loc[np.isfinite(p.medianrt) & (p.medianrt > 0)].copy()
p['hour_sin'] = np.sin(2*np.pi*p.time_of_day/24)
p['hour_cos'] = np.cos(2*np.pi*p.time_of_day/24)
p['date'] = pd.to_datetime(p['date'])
p = p.sort_values(['id', 'date', 'entry_no']).reset_index(drop=True)
features = ['hour_sin','hour_cos','time_awake','ambient_light_log']
train_idx, test_idx = next(GroupShuffleSplit(n_splits=1,test_size=.2,random_state=42).split(p,groups=p.id))
train, test = p.iloc[train_idx].copy(), p.iloc[test_idx].copy()

# No test participant contributes to fitting either population or residual model.
pop = make_pipeline(SimpleImputer(strategy='median'), RandomForestRegressor(n_estimators=250,min_samples_leaf=5,random_state=42,n_jobs=-1))
pop.fit(train[features],train.medianrt)

# Build training rows with the first 5 observations as each person's calibration.
def calibrated_rows(frame):
    records=[]
    for pid, g in frame.groupby('id'):
        g=g.sort_values(['date','entry_no']).copy()
        if len(g)<=5: continue
        baseline=g.iloc[:5].medianrt.mean()
        later=g.iloc[5:].copy()
        later['baseline_ms']=baseline
        later['delta_ms']=later.medianrt-baseline
        records.append(later)
    return pd.concat(records,ignore_index=True) if records else pd.DataFrame()

train_cal = calibrated_rows(train)
test_cal = calibrated_rows(test)
if train_cal.empty or test_cal.empty: raise RuntimeError('Not enough calibration data')
residual_features = features + ['baseline_ms']
residual = make_pipeline(SimpleImputer(strategy='median'),RandomForestRegressor(n_estimators=250,min_samples_leaf=5,random_state=42,n_jobs=-1))
residual.fit(train_cal[residual_features],train_cal.delta_ms)

actual = test_cal.medianrt.to_numpy()
pred_pop = pop.predict(test_cal[features])
pred_person = test_cal.baseline_ms.to_numpy()
pred_resid = pred_person + residual.predict(test_cal[residual_features])
report = pd.DataFrame([
    {'model':'Population Random Forest','MAE_ms':mean_absolute_error(actual,pred_pop)},
    {'model':'Personal baseline (first 5)','MAE_ms':mean_absolute_error(actual,pred_person)},
    {'model':'Personalized residual Random Forest','MAE_ms':mean_absolute_error(actual,pred_resid)},
]).round(3)
output=ROOT/'artifacts'/'personalization_evaluation.csv'
output.parent.mkdir(exist_ok=True)
report.to_csv(output,index=False)
print('Held-out participants:',test.id.nunique(),'| Future test observations:',len(test_cal))
print(report.to_string(index=False))
print('Saved:',output)