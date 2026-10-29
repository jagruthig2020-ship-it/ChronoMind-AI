
"""ChronoMind API: sessions, personal baselines, experimental PVT ML."""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from statistics import median
import math
import os
import sqlite3

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator


DB = Path(
    os.environ.get(
        "CHRONOMIND_DB",
        str(Path(__file__).with_name("chronomind.sqlite3")),
    )
)

MODEL_PATH = (
    Path(__file__).resolve().parents[1]
    / "ChronoMind-Rebuild"
    / "artifacts"
    / "random_forest.joblib"
)


def connect():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn


@asynccontextmanager
async def lifespan(app: FastAPI):
    DB.parent.mkdir(parents=True, exist_ok=True)

    with connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                participant_id TEXT NOT NULL,
                task_id TEXT NOT NULL,
                protocol_version TEXT NOT NULL,
                recorded_at TEXT NOT NULL,
                median_rt_ms REAL,
                accuracy REAL,
                device_type TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_sessions_participant_task
            ON sessions(participant_id, task_id, protocol_version)
            """
        )

    yield


app = FastAPI(
    title="ChronoMind API",
    version="0.1.0",
    lifespan=lifespan,
)

origins = [
    origin.strip()
    for origin in os.environ.get(
        "CHRONOMIND_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class SessionIn(BaseModel):
    participant_id: str = Field(
        min_length=8,
        max_length=128,
        pattern=r"^[a-zA-Z0-9_-]+$",
    )
    task_id: str = Field(
        min_length=2,
        max_length=80,
        pattern=r"^[a-zA-Z0-9_-]+$",
    )
    protocol_version: str = Field(
        min_length=1,
        max_length=40,
        pattern=r"^[a-zA-Z0-9_.-]+$",
    )
    median_rt_ms: float | None = Field(
        default=None,
        gt=0,
        le=60000,
        allow_inf_nan=False,
    )
    accuracy: float | None = Field(
        default=None,
        ge=0,
        le=1,
        allow_inf_nan=False,
    )
    device_type: str | None = Field(
        default=None,
        max_length=50,
    )

    @field_validator("device_type")
    @classmethod
    def clean_device(cls, value):
        return value.strip() if value else None


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "model_status": (
            "research_model_available"
            if MODEL_PATH.is_file()
            else "model_file_missing"
        ),
    }


@app.post("/api/sessions", status_code=201)
def add_session(session: SessionIn):
    if session.median_rt_ms is None and session.accuracy is None:
        raise HTTPException(
            status_code=422,
            detail="Provide at least one measured outcome",
        )

    now = datetime.now(timezone.utc).isoformat()

    with connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO sessions (
                participant_id,
                task_id,
                protocol_version,
                recorded_at,
                median_rt_ms,
                accuracy,
                device_type
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session.participant_id,
                session.task_id,
                session.protocol_version,
                now,
                session.median_rt_ms,
                session.accuracy,
                session.device_type,
            ),
        )

        return {
            "id": cursor.lastrowid,
            "recorded_at": now,
            "status": "saved",
        }


@app.get("/api/insights/{participant_id}")
def insights(
    participant_id: str,
    task_id: str,
    protocol_version: str,
):
    if not participant_id or not task_id or not protocol_version:
        raise HTTPException(
            status_code=422,
            detail="Missing required filter",
        )

    with connect() as conn:
        rows = conn.execute(
            """
            SELECT median_rt_ms, accuracy
            FROM sessions
            WHERE participant_id = ?
              AND task_id = ?
              AND protocol_version = ?
            ORDER BY recorded_at, id
            """,
            (
                participant_id,
                task_id,
                protocol_version,
            ),
        ).fetchall()

    reaction_times = [
        row["median_rt_ms"]
        for row in rows
        if row["median_rt_ms"] is not None
    ]

    accuracies = [
        row["accuracy"]
        for row in rows
        if row["accuracy"] is not None
    ]

    return {
        "task_id": task_id,
        "protocol_version": protocol_version,
        "session_count": len(rows),
        "observed_median_rt_ms": (
            round(median(reaction_times), 2)
            if reaction_times
            else None
        ),
        "observed_mean_accuracy": (
            round(sum(accuracies) / len(accuracies), 4)
            if accuracies
            else None
        ),
        "evidence_status": "descriptive_only",
        "prediction": None,
        "scheduling_recommendation": None,
        "reason": (
            "Browser task measurements are not yet validated "
            "for personalized time-of-day predictions."
        ),
    }


@lru_cache(maxsize=1)
def load_research_model():
    import joblib

    if not MODEL_PATH.is_file():
        raise HTTPException(
            status_code=503,
            detail=f"Model file missing: {MODEL_PATH}",
        )

    try:
        # Load only your own trusted training artifact.
        return joblib.load(MODEL_PATH)
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "Model could not be loaded: "
                f"{type(exc).__name__}"
            ),
        ) from exc


class ResearchPredictionIn(BaseModel):
    time_of_day: float = Field(
        ge=0,
        lt=24,
        allow_inf_nan=False,
    )
    time_awake: float = Field(
        ge=0,
        le=48,
        allow_inf_nan=False,
    )
    ambient_light_log: float | None = Field(
        default=None,
        allow_inf_nan=False,
    )


@app.post("/api/research-prediction")
def research_prediction(data: ResearchPredictionIn):
    import pandas as pd

    model = load_research_model()

    frame = pd.DataFrame(
        [
            {
                "hour_sin": math.sin(
                    2 * math.pi * data.time_of_day / 24
                ),
                "hour_cos": math.cos(
                    2 * math.pi * data.time_of_day / 24
                ),
                "time_awake": data.time_awake,
                "ambient_light_log": data.ambient_light_log,
            }
        ]
    )

    try:
        estimate = float(model.predict(frame)[0])
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "Prediction unavailable: "
                f"{type(exc).__name__}"
            ),
        ) from exc

    if not math.isfinite(estimate):
        raise HTTPException(
            status_code=503,
            detail="Model produced an invalid prediction",
        )

    return {
        "predicted_pvt_median_rt_ms": round(estimate, 1),
        "model": "BrighterTime PVT population random forest",
        "evidence_status": "experimental_research_only",
        "ambient_light_imputed": (
            data.ambient_light_log is None
        ),
        "warning": (
            "Not validated for ChronoMind browser games "
            "or individual scheduling decisions."
        ),
    }
