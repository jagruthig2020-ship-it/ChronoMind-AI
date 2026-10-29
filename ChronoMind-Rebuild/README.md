# ChronoMind AI — clean rebuild

First milestone: reproduce a participant-separated prediction benchmark for PVT median reaction time. This is **not** a clinically validated cognitive forecast.

## Windows / VS Code

Open this folder in VS Code. Open a terminal (Terminal > New Terminal) and run:

```powershell
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python src/train.py
```

If `py` is unavailable, use `python` in the first command. Results are written to `artifacts/evaluation.csv`; saved models are in `artifacts/`. Never report scores before running the script.

## Why this approach?

- The CSV has three tasks with different outcome measures. First train on PVT only.
- `medianrt` is the prediction target and must not be a feature.
- `id` is used only for grouped splitting, never as a model feature.
- Missing ambient light is imputed using training-set median only.
- `time_of_day` is encoded cyclically.
- Compare against a simple baseline; held-out R² may be low or negative.
- This first version excludes KSS sleepiness because a future scheduling prediction cannot know future subjective sleepiness. We can build a separate nowcasting model later.

## Next milestones

Inspect participant-grouped cross-validation, then add a FastAPI endpoint, reaction-time mini-test and deployable frontend.
