# ChronoMind AI — Backend

ChronoMind AI is a cognitive performance tracking and personalized scheduling prototype.

This backend provides APIs for recording cognitive game results, calculating personal performance baselines, and returning evidence-based insights.

## Tech Stack

- Python
- FastAPI
- Pydantic
- SQLite
- Uvicorn

## Project Structure

```text
CM-AI/
├── frontend/
├── ChronoMind-Rebuild/
│   ├── artifacts/
│   └── src/
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   └── README.md
└── .venv/
```

## Features

### Session Recording

Records cognitive game performance, including participant ID, game type, and measured results.

### Personal Baselines

Uses recorded sessions to calculate individual performance baselines.

### Cognitive Insights

Provides task-specific performance summaries based on available observations.

### Research Models

Existing research artifacts include:

- Baseline model
- Random Forest model
- Gradient Boosting model

These models are not automatically used for live predictions. They require validated feature mapping and evaluation before integration.

## Local Setup

Open PowerShell in the CM-AI directory.

### 1. Install dependencies

```powershell
.\.venv\Scripts\python.exe -m pip install -r .\backend\requirements.txt
```

### 2. Start the backend

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --app-dir backend --reload --port 8000
```

### 3. Open API documentation

Visit:

http://127.0.0.1:8000/docs

## API Endpoints

### GET /api/health

Checks whether the backend is running.

### POST /api/sessions

Records a cognitive game session.

### GET /api/insights/{participant_id}

Returns personal performance insights for a participant.

## Development Roadmap

- [x] Train and evaluate initial research models
- [x] Build Next.js frontend
- [ ] Verify FastAPI backend locally
- [ ] Connect frontend games to session API
- [ ] Calculate and display personal baselines
- [ ] Validate personalized predictions on prospective data
- [ ] Integrate scheduling recommendations
- [ ] Add authentication and privacy controls
- [ ] Deploy and test the complete application

## Limitations

ChronoMind is an experimental prototype, not a medical diagnostic tool.

The existing research models were trained on a specific dataset and should not be assumed to generalize to all browser-based cognitive games.

Performance insights must distinguish measured results from predictions, and the application should report insufficient evidence when reliable conclusions cannot be made.