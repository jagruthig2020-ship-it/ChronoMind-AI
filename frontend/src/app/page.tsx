"use client";

import { useEffect, useRef, useState } from "react";
import { ExtraLab, EXTRA, extraIds, type ExtraGame } from "./ExtraLab";

type Game = "reaction" | "search" | "memory" | ExtraGame;
type ThemePreference = "light" | "dark" | "system";
type Page = "home" | "about" | "lab" | "results" | "planner" | "calendar";
type RecordItem = { id: string; game: Game; at: string; score: number; unit: string; details: string; sleep: number; sleepy: number };
type Plan = { id: string; title: string; at: string; minutes: number; feedback?: "helped" | "neutral" | "not_helpful"; source?: "manual" | "exploratory" };
type Goal = "attention" | "memory" | "visual" | "explore";
const STORE = "chronomind-v4";
const gameInfo: Record<Game, { title: string; subtitle: string; unit: string; lower: boolean }> = {
  reaction: { title: "Reaction Time", subtitle: "Attention and response speed", unit: "ms", lower: true },
  search: { title: "Visual Search", subtitle: "Find a target among distractions", unit: "s", lower: true },
  memory: { title: "2-Back Memory", subtitle: "Keep track of a changing sequence", unit: "%", lower: false },
  ...Object.fromEntries(extraIds.map(id => [id, {title:EXTRA[id].name,subtitle:EXTRA[id].description,unit:EXTRA[id].unit,lower:EXTRA[id].lower}])) as Record<ExtraGame,{title:string;subtitle:string;unit:string;lower:boolean}>,
};
const NAV: { id: Page; label: string; icon: string }[] = [
  { id: "home", label: "Overview", icon: "◈" }, { id: "about", label: "The idea", icon: "✳" },
  { id: "lab", label: "Cognitive lab", icon: "◎" }, { id: "results", label: "Your results", icon: "▥" },
  { id: "planner", label: "Focus planner", icon: "◷" }, { id: "calendar", label: "Calendar", icon: "▦" },
];
const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? (b[Math.floor((b.length - 1) / 2)] + b[Math.floor(b.length / 2)]) / 2 : 0; };
const localDateTime = (d: Date) => { const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return x.toISOString().slice(0, 16); };
function download(filename: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
function makeIcs(title: string, start: Date, minutes: number) {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const safe = title.replace(/[\\;,\n]/g, " ");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ChronoMind//Focus Planner//EN", "BEGIN:VEVENT", `UID:${Date.now()}@chronomind.local`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(new Date(start.getTime() + minutes * 60000))}`, `SUMMARY:${safe}`, "DESCRIPTION:An exploratory focus block planned with ChronoMind.", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}
function LineChart({ data, unit, lower }: { data: RecordItem[]; unit: string; lower: boolean }) {
  if (!data.length) return <div className="empty">Your first completed session will appear here.</div>;
  const vals = data.slice(-12).map(x => x.score), lo = Math.min(...vals), hi = Math.max(...vals);
  const coords = vals.map((v, i) => ({ x: 34 + (i / Math.max(1, vals.length - 1)) * 600, y: 155 - ((v - lo) / Math.max(1, hi - lo)) * 110 }));
  return <div><svg viewBox="0 0 670 190" className="plot" role="img" aria-label="History of scores">
    {[40, 95, 150].map(y => <line key={y} x1="30" x2="640" y1={y} y2={y} stroke="#e5eae3" />)}
    <polyline fill="none" stroke="#4e765e" strokeWidth="3" strokeLinejoin="round" points={coords.map(p => `${p.x},${p.y}`).join(" ")} />
    {coords.map((p, i) => <g key={i}><circle cx={p.x} cy={p.y} r="5" fill="#cf9065" stroke="white" strokeWidth="2"/><text x={p.x} y={p.y - 13} textAnchor="middle" fontSize="12" fill="#50655a">{vals[i]}</text></g>)}
  </svg><p className="small">Last {vals.length} sessions · {unit} · {lower ? "Lower is faster" : "Higher is better"}</p></div>;
}
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

function getParticipantId(): string {
  const key = "chronomind-participant-id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = `cm_${crypto.randomUUID().replaceAll("-", "")}`;
    localStorage.setItem(key, id);
  }
  return id;
}

type PersonalInsight = {
  task_id: string;
  protocol_version: string;
  session_count: number;
  observed_median_rt_ms: number | null;
  observed_mean_accuracy: number | null;
  evidence_status: string;
};

function protocolFor(game: Game): string {
  return game === "reaction" || game === "search" ? "browser-v4" : game === "memory" ? "browser-memory-v4" : "exploratory-v2";
}

async function fetchPersonalInsight(game: Game): Promise<PersonalInsight> {
  const params = new URLSearchParams({task_id: game, protocol_version: protocolFor(game)});
  const response = await fetch(`${API_URL}/api/insights/${getParticipantId()}?${params}`, {cache: "no-store"});
  if (!response.ok) throw new Error(`Insights API returned ${response.status}`);
  return response.json() as Promise<PersonalInsight>;
}

async function sendSessionToBackend(game: Game, score: number): Promise<void> {
  const payload: {
    participant_id: string;
    task_id: string;
    protocol_version: string;
    median_rt_ms?: number;
    accuracy?: number;
  } = {
    participant_id: getParticipantId(),
    task_id: game,
    protocol_version: protocolFor(game),
  };

  if (game === "reaction") {
    payload.median_rt_ms = score;
  } else if (game === "search") {
    payload.median_rt_ms = score * 1000;
  } else {
    payload.accuracy = score / 100;
  }

  const response = await fetch(`${API_URL}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Session API returned ${response.status}`);
  }
}

export default function ChronoMindPage() {
  const [page, setPage] = useState<Page>("home");
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [systemDark, setSystemDark] = useState(false);
  const [game, setGame] = useState<Game>("reaction");
  const [labMinutes, setLabMinutes] = useState(5);
  const [browseDomain, setBrowseDomain] = useState("All");
  const [extraSession, setExtraSession] = useState(0);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [personalInsight, setPersonalInsight] = useState<PersonalInsight | null>(null);
  const [insightStatus, setInsightStatus] = useState("Loading personal baseline…");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [greeting, setGreeting] = useState("Welcome back");
  const [today, setToday] = useState("");
  const [sleep, setSleep] = useState(7);
  const [sleepy, setSleepy] = useState(4);
  const [mlPrediction, setMlPrediction] = useState<number | null>(null);
  const [mlStatus, setMlStatus] = useState("");
  const [mlLoading, setMlLoading] = useState(false);
  const [ambientLight, setAmbientLight] = useState("");
  async function runResearchPrediction() {
    setMlLoading(true);
    setMlStatus("");
    setMlPrediction(null);
    try {
      const now = new Date();
      const hour = now.getHours() + now.getMinutes() / 60;
      const [wh, wm] = wakeTime.split(":").map(Number);
      const wakeHour = wh + wm / 60;
      const awake = (hour - wakeHour + 24) % 24;
      const light = ambientLight.trim() === "" ? null : Number(ambientLight);
      if (light !== null && !Number.isFinite(light)) throw new Error("Enter a valid ambient light value");
      const res = await fetch(`${API_URL}/api/research-prediction`, {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({time_of_day: hour, time_awake: awake, ambient_light_log: light}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Prediction API returned ${res.status}`);
      }
      const result: {predicted_pvt_median_rt_ms: number; ambient_light_imputed: boolean} = await res.json();
      setMlPrediction(result.predicted_pvt_median_rt_ms);
      setMlStatus(result.ambient_light_imputed ? "Ambient light was missing and imputed by the training pipeline." : "Ambient light was provided.");
    } catch (e) { setMlStatus(e instanceof Error ? e.message : "Prediction unavailable"); }
    finally { setMlLoading(false); }
  }

  const [task, setTask] = useState("Deep work / studying");
  const [goal, setGoal] = useState<Goal>("explore");
  const [wakeTime, setWakeTime] = useState("07:00");
  const [device, setDevice] = useState("mouse / trackpad");
  const [planSource, setPlanSource] = useState<"manual" | "exploratory">("manual");
  const [minutes, setMinutes] = useState(45);
  const [planAt, setPlanAt] = useState("");
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState<"intro" | "waiting" | "go" | "feedback" | "done">("intro");
  const [practice, setPractice] = useState(0);
  const [reactionTrials, setReactionTrials] = useState<number[]>([]);
  const [lastReaction, setLastReaction] = useState<number | null>(null);
  const [falseStarts, setFalseStarts] = useState(0);
  const [searchRound, setSearchRound] = useState(0);
  const [searchTimes, setSearchTimes] = useState<number[]>([]);
  const [searchTarget, setSearchTarget] = useState(0);
  const [searchCells, setSearchCells] = useState<string[]>([]);
  const [memorySeq, setMemorySeq] = useState<string[]>([]);
  const [memoryIndex, setMemoryIndex] = useState(0);
  const [memoryAnswers, setMemoryAnswers] = useState<boolean[]>([]);
  const [memoryStarted, setMemoryStarted] = useState(false);
  const [memoryVisible, setMemoryVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const started = useRef(0);
  const phaseRef = useRef<typeof phase>("intro");
  const savedRef = useRef(false);
  const searchStart = useRef(0);
  const memoryIndexRef = useRef(0);
  const memoryAnswersRef = useRef<boolean[]>([]);
  const memorySeqRef = useRef<string[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("chronomind-theme");
      if (stored === "light" || stored === "dark" || stored === "system") setTheme(stored);
    } catch { /* storage unavailable */ }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(media.matches);
    const handleChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);
  function chooseTheme(value: ThemePreference) {
    setTheme(value);
    try { localStorage.setItem("chronomind-theme", value); } catch { /* storage unavailable */ }
  }
  const resolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  function setStage(next: typeof phase) { phaseRef.current = next; setPhase(next); }
  useEffect(() => {
    try { const raw = localStorage.getItem(STORE) || localStorage.getItem("chronomind-v3"); if (raw) { const data = JSON.parse(raw); if (Array.isArray(data.records)) setRecords(data.records); if (Array.isArray(data.plans)) setPlans(data.plans); } } catch { /* corrupted storage ignored */ }
    const now = new Date(); const hour = now.getHours();
    setGreeting(hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening");
    setToday(now.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }));
    setPlanAt(localDateTime(new Date(now.getTime() + 60 * 60000)));
    setHydrated(true);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, []);
  useEffect(() => { if (hydrated) localStorage.setItem(STORE, JSON.stringify({ records, plans })); }, [records, plans, hydrated]);

  const saveResult = (which: Game, score: number, details: string) => {
    if (savedRef.current) return;
    savedRef.current = true;

    const record: RecordItem = {
      id: crypto.randomUUID(),
      game: which,
      at: new Date().toISOString(),
      score: Math.round(score * 10) / 10,
      unit: gameInfo[which].unit,
      details: `${details}; goal=${goal}; wake=${wakeTime}; device=${device}; protocol=v4`,
      sleep,
      sleepy,
    };

    setRecords(prev => [...prev, record]);
    setStage("done");

    void sendSessionToBackend(which, record.score).catch(error => {
      console.error("ChronoMind backend save failed:", error);
    });
  };
  const resetGame = (which: Game) => {
    if (timer.current) clearTimeout(timer.current);
    savedRef.current = false; setGame(which); setExtraSession(x=>x+1); setStage("intro"); setPractice(0); setReactionTrials([]); setLastReaction(null); setFalseStarts(0);
    setSearchRound(0); setSearchTimes([]); setMemoryIndex(0); memoryIndexRef.current = 0; setMemoryAnswers([]); memoryAnswersRef.current = []; setMemoryStarted(false); setMemoryVisible(false); setMessage("");
  };
  function startReaction() {
    if (timer.current) clearTimeout(timer.current);
    setStage("waiting");
    timer.current = setTimeout(() => { started.current = performance.now(); setStage("go"); }, 1400 + Math.random() * 2400);
  }
  function tapReaction() {
    if (phaseRef.current === "waiting") { if (timer.current) clearTimeout(timer.current); setFalseStarts(v => v + 1); setStage("feedback"); setMessage("Too soon — wait for the signal."); return; }
    if (phaseRef.current === "go") {
      const ms = Math.round(performance.now() - started.current); setLastReaction(ms);
      if (practice < 2) { setPractice(v => v + 1); setMessage("Warm-up complete. Keep going."); setStage("feedback"); return; }
      const updated = [...reactionTrials, ms]; setReactionTrials(updated);
      if (updated.length === 5) saveResult("reaction", median(updated), `5 measured trials; ${falseStarts} early taps`);
      else { setMessage("Recorded. Ready for the next one?"); setStage("feedback"); }
    }
  }
  function newSearchRound(round: number) {
    const index = Math.floor(Math.random() * 36);
    const cells = Array.from({ length: 36 }, (_, i) => i === index ? "Q" : "O");
    setSearchTarget(index); setSearchCells(cells); setSearchRound(round); searchStart.current = performance.now(); setStage("go");
  }
  function chooseSearch(i: number) {
    if (phaseRef.current !== "go") return;
    if (i !== searchTarget) { setMessage("Not quite — find the Q among the O's."); return; }
    const seconds = Math.round((performance.now() - searchStart.current) / 100) / 10;
    const updated = [...searchTimes, seconds]; setSearchTimes(updated); setMessage("");
    if (updated.length === 5) saveResult("search", median(updated), "Median seconds to find Q across 5 grids");
    else { setStage("feedback"); setMessage(`Found in ${seconds}s. Next grid?`); }
  }
  function startMemory() {
    const letters = ["A", "B", "C", "D"];
    const seq = Array.from({ length: 12 }, () => letters[Math.floor(Math.random() * letters.length)]);
    const matchPositions = [2, 4, 7, 10];
    for (let i=2;i<seq.length;i++) { if (matchPositions.includes(i)) seq[i]=seq[i-2]; else if (seq[i]===seq[i-2]) seq[i]=letters.filter(x=>x!==seq[i-2])[Math.floor(Math.random()*3)]; }
    memorySeqRef.current = seq; setMemorySeq(seq); memoryIndexRef.current = 0; setMemoryIndex(0);
    memoryAnswersRef.current = []; setMemoryAnswers([]); setMemoryStarted(true); setMemoryVisible(true); setStage("go");
  }
  function answerMemory(same: boolean) {
    if (!memoryVisible || !memoryStarted) return;
    const i = memoryIndexRef.current; if (i < 2) return;
    const correct = (memorySeqRef.current[i] === memorySeqRef.current[i - 2]) === same;
    const updated = [...memoryAnswersRef.current, correct]; memoryAnswersRef.current = updated; setMemoryAnswers(updated);
    if (i === memorySeqRef.current.length - 1) {
      setMemoryVisible(false); setMemoryStarted(false);
      saveResult("memory", (updated.filter(Boolean).length / updated.length) * 100, `${updated.filter(Boolean).length}/${updated.length} correct 2-back decisions`);
    } else { memoryIndexRef.current = i + 1; setMemoryIndex(i + 1); }
  }
  function advanceMemory() {
    const i = memoryIndexRef.current;
    if (i >= 2) return;
    memoryIndexRef.current = i + 1; setMemoryIndex(i + 1);
  }
  useEffect(() => {
    if (page !== "results" || !hydrated) return;
    let active = true;
    setPersonalInsight(null);
    setInsightStatus("Loading personal baseline…");
    fetchPersonalInsight(game)
      .then(data => { if (active) { setPersonalInsight(data); setInsightStatus(""); } })
      .catch(() => { if (active) setInsightStatus("Backend baseline unavailable. Your local results are still visible."); });
    return () => { active = false; };
  }, [page, game, records.length, hydrated]);

  const byGame = (g: Game) => records.filter(r => r.game === g);
  const candidates: Record<Goal, Game[]> = {
    attention: ["reaction", "vigilance", "go", "stroop"],
    memory: ["memory", "sequence", "match", "switch"],
    visual: ["search", "symbol", "distractor", "coding"],
    explore: ["reaction", "search", "memory", ...extraIds],
  };
  const recommendationPool = labMinutes === 2 ? candidates[goal].filter(g => g !== "memory" && g !== "reaction" && g !== "search") : candidates[goal];
  const recommendation: Game = [...(recommendationPool.length ? recommendationPool : candidates[goal])].sort((a,b) => byGame(a).length-byGame(b).length)[0];
  const recommendationReason = `Selected from your ${goal} activities, prioritizing tasks with fewer recorded sessions. Selection is rule-based, not ML.`;
  const latestPlan = plans.at(-1);
  function feedbackPlan(id: string, feedback: NonNullable<Plan["feedback"]>) { setPlans(old => old.map(p => p.id === id ? {...p, feedback} : p)); }

  const recent = records.slice(-1)[0];
  const uniqueDays = new Set(records.map(r => r.at.slice(0, 10))).size;
  const reaction = byGame("reaction");
  const grouped = ["morning", "afternoon", "evening", "night"].map(band => {
    const list = reaction.filter(r => { const hour = new Date(r.at).getHours(); return (hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 17 ? "afternoon" : hour >= 17 && hour < 22 ? "evening" : "night") === band; });
    return { band, count: list.length, score: list.length ? median(list.map(x => x.score)) : 0 };
  });
  const comparable = grouped.filter(g => g.count >= 2);
  const reactionDays = new Set(reaction.map(r => new Date(r.at).toLocaleDateString())).size;
  const ranked = [...comparable].sort((a,b) => a.score-b.score);
  const observedGap = ranked.length > 1 ? ranked[1].score-ranked[0].score : 0;
  // Conservative heuristic gate, NOT a validated statistical confidence interval.
  // We deliberately avoid claiming an optimal time from sparse or noisy measurements.
  const canSuggest = reaction.length >= 12 && reactionDays >= 5 && comparable.length >= 2 && observedGap >= 30;
  const evidenceMessage = reaction.length < 12 ? `Collect ${12-reaction.length} more reaction-time sessions, ideally across different days and times.` : reactionDays < 5 ? `You have data from ${reactionDays} distinct days; collect measurements on at least 5 days.` : comparable.length < 2 ? "We need at least two sessions in two different parts of the day." : observedGap < 30 ? "Observed time-of-day differences are small or ambiguous. We cannot prefer one window." : "An exploratory difference is visible. It is not validated predictive accuracy.";
  const best = [...comparable].sort((a, b) => a.score - b.score)[0];
  function suggestTime() {
    if (!best || !canSuggest) return;
    const hours: Record<string, number> = { morning: 9, afternoon: 14, evening: 19, night: 22 };
    const d = new Date(); d.setHours(hours[best.band], 0, 0, 0); if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    setPlanAt(localDateTime(d)); setPlanSource("exploratory"); setMessage(`Tentative ${best.band} suggestion selected. Review before adding.`);
  }
  function createEvent() {
    const d = new Date(planAt); if (!planAt || Number.isNaN(d.getTime())) { setMessage("Choose a valid date and time first."); return; }
    if (d.getTime() < Date.now()) { setMessage("Choose a future time."); return; }
    if (d.getHours() >= 22 || d.getHours() < 6 || d.getHours() + minutes/60 > 22) { setMessage("This time overlaps typical protected sleep hours (10 PM–6 AM). Please choose another time."); return; }
    download("chronomind-focus-window.ics", makeIcs(task, d, minutes), "text/calendar;charset=utf-8");
    setPlans(prev => [...prev, { id: crypto.randomUUID(), title: task, at: d.toISOString(), minutes, source: planSource }]);
    setMessage("Calendar file downloaded. Open it to add the event to your calendar.");
  }
  function exportData() { download("chronomind-data.json", JSON.stringify({ records, plans }, null, 2), "application/json"); }
  const selectPage = (p: Page) => { setPage(p); setMessage(""); if (timer.current) clearTimeout(timer.current); if (p !== "lab" && phaseRef.current === "waiting") setStage("intro"); };

  return <div className={`cm-root ${resolvedTheme === "dark" ? "theme-dark" : "theme-light"}`} data-theme={resolvedTheme}>
    <style jsx global>{`
      :root{--bg:#f7f8f3;--card:#fffefa;--ink:#273d33;--muted:#7a8a80;--line:#e2e9df;--accent:#456e55;--soft:#eaf1e8;--warm:#c98960}
      .cm-root.theme-dark{--bg:#111a18;--card:#1c2925;--ink:#eaf1e9;--muted:#b2c1b7;--line:#34483e;--accent:#a4d2b1;--soft:#293e33;--warm:#e6aa7c;--surface:#23342b;--field:#202f29;--tint:#263c30;--stage:#20392d;--accent-text:#15271b;--chip:#314b39;--subtle:#b3c9b9;color-scheme:dark}
      .cm-root.theme-light{--surface:#fffefa;--field:#fff;--tint:#f0f5ed;--stage:#e7f0e5;--accent-text:#fff;--chip:#edf3e9;--subtle:#66796c;color-scheme:light}
      .cm-root.theme-dark .side button{color:var(--muted)}.cm-root.theme-dark .side button.active,.cm-root.theme-dark .side button:hover{background:var(--soft);color:var(--ink)}
      .cm-root.theme-dark .top,.cm-root.theme-dark .footer{border-color:var(--line)}
      .cm-root.theme-dark .field label,.cm-root.theme-dark .note,.cm-root.theme-dark .warm,.cm-root.theme-dark .stage p{color:var(--muted)}
      .cm-root.theme-dark .field input,.cm-root.theme-dark .field select{background:var(--field);border-color:var(--line);color:var(--ink)}
      .cm-root.theme-dark .note,.cm-root.theme-dark .step{background:var(--tint)}.cm-root.theme-dark .warm{background:#342b24}
      .cm-root.theme-dark .game-choice,.cm-root.theme-dark .subnav button,.cm-root.theme-dark .search-grid button{background:var(--card);color:var(--ink);border-color:var(--line)}
      .cm-root.theme-dark .game-choice:hover,.cm-root.theme-dark .game-choice.chosen{background:var(--soft);border-color:var(--accent)}
      .cm-root.theme-dark .stage{background:radial-gradient(circle at 50% 35%,#304b3a,var(--stage))}
      .cm-root.theme-dark .tap{background:#3c5a47;color:var(--ink);box-shadow:0 0 0 13px #ffffff0b}.cm-root.theme-dark .tap.go{background:#b47851;color:#fff}
      .cm-root.theme-dark .memory-letter,.cm-root.theme-dark .search-grid button{color:var(--accent)}
      .cm-root.theme-dark .btn{color:var(--accent-text)}.cm-root.theme-dark .btn.secondary{background:var(--soft);color:var(--accent)}.cm-root.theme-dark .btn.ghost{color:var(--accent)}
      .cm-root.theme-dark .pill{background:var(--chip);color:var(--ink)}.cm-root.theme-dark .empty{border-color:var(--line);color:var(--muted)}
      .cm-root.theme-dark .subnav button.active{background:var(--accent);color:var(--accent-text)}
      .cm-root.theme-dark .plot line{stroke:var(--line)}.cm-root.theme-dark .plot text{fill:var(--ink)}
      .cm-root.theme-dark .cm-theme-control{background:var(--soft);border-color:var(--line)}
      .cm-theme-control{display:flex;align-items:center;gap:5px;border:1px solid var(--line);padding:4px;border-radius:12px;background:var(--card)}
      .cm-theme-control button{border:0;border-radius:8px;padding:8px 10px;background:transparent;color:var(--muted);font-size:12px}
      .cm-theme-control button[aria-pressed="true"]{background:var(--soft);color:var(--ink);font-weight:700}
      @media(prefers-reduced-motion:reduce){.cm-root *{transition:none!important;animation:none!important}}
      *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}button,input,select{font:inherit}button{cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}
      .cm-root{min-height:100vh;background:var(--bg)}.top{max-width:1240px;margin:auto;padding:22px 30px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}.brand{font-size:21px;letter-spacing:-.05em;font-weight:760}.brand span{color:var(--accent)}.top-note{color:var(--muted);font-size:12px}.shell{max-width:1240px;margin:auto;display:grid;grid-template-columns:210px minmax(0,1fr);gap:46px;padding:32px 30px 90px}.side{position:sticky;top:25px;align-self:start}.side small{display:block;color:#a0aba1;letter-spacing:.15em;text-transform:uppercase;font-size:10px;margin:8px 12px 16px}.side button{width:100%;display:flex;gap:14px;align-items:center;text-align:left;border:0;border-radius:11px;background:transparent;color:#718077;padding:13px 14px;margin-bottom:4px;font-size:13px}.side button.active,.side button:hover{background:#e7efe4;color:#3b6149}.side button span{font-size:19px;width:20px}.side-foot{font-size:11px;color:#9aa69c;line-height:1.7;margin:30px 13px}.content{min-width:0;max-width:930px}.eyebrow{color:#5c8066;font-size:11px;font-weight:750;letter-spacing:.17em;text-transform:uppercase}.hero{padding:15px 0 28px}.hero h1,.section-head h1{font:normal clamp(40px,5vw,62px)/1.08 Georgia,serif;letter-spacing:-.045em;margin:12px 0}.hero p,.section-head p{max-width:590px;font-size:14px;line-height:1.8;color:var(--muted)}.section-head{padding:16px 0 25px}.section-head h1{font-size:clamp(36px,4vw,52px)}.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:23px;box-shadow:0 4px 15px #304b3805}.card h2{font-size:17px;letter-spacing:-.025em;margin:0 0 8px}.card h3{font-size:14px;margin:0 0 7px}.card p{line-height:1.65}.small{color:var(--muted);font-size:12px;line-height:1.7}.kicker{color:#93a297;text-transform:uppercase;letter-spacing:.13em;font-size:10px;font-weight:700}.grid{display:grid;gap:16px}.two{grid-template-columns:repeat(2,minmax(0,1fr))}.three{grid-template-columns:repeat(3,minmax(0,1fr))}.stat{font:normal 37px Georgia,serif;letter-spacing:-.05em;margin:10px 0 3px}.btn{border:0;background:var(--accent);color:white;border-radius:11px;padding:12px 17px;font-size:12px;font-weight:650}.btn:hover{filter:brightness(.94)}.btn.secondary{background:var(--soft);color:var(--accent)}.btn.ghost{background:transparent;color:var(--accent);border:1px solid var(--line)}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.between{display:flex;justify-content:space-between;align-items:center;gap:12px}.pill{border-radius:99px;background:#edf3e9;color:#537660;padding:7px 11px;font-size:11px}.field{display:grid;gap:8px}.field label{font-size:12px;color:#66796c}.field input,.field select{width:100%;padding:11px 12px;background:#fff;border:1px solid #dfe8dc;border-radius:10px;color:var(--ink);font-size:13px}.field input[type=range]{padding:0;accent-color:var(--accent)}.note{background:#f0f5ed;border-radius:12px;padding:13px 15px;color:#66786b;font-size:12px;line-height:1.7}.warm{background:#fcf4ec;border-left:3px solid var(--warm);border-radius:0 10px 10px 0;padding:13px 15px;color:#7b6c60;font-size:12px;line-height:1.7}.game-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}.game-choice{text-align:left;border:1px solid var(--line);border-radius:15px;padding:17px;background:#fffefa;color:var(--ink);min-height:150px;transition:.2s}.game-choice:hover,.game-choice.chosen{border-color:#8ba991;background:#eff5eb}.game-choice .symbol{display:block;font:normal 28px Georgia,serif;color:#b77e58;margin-bottom:15px}.game-choice b{display:block;font-size:14px}.game-choice small{display:block;color:var(--muted);margin-top:6px;font-size:11px;line-height:1.5}.stage{margin-top:16px;min-height:310px;border-radius:16px;background:radial-gradient(circle,#edf4e9,#e7f0e5);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center}.stage h2{font:normal 26px Georgia,serif}.stage p{max-width:410px;color:#6e8072;font-size:12px;line-height:1.7}.tap{width:110px;height:110px;border:0;border-radius:50%;background:#d6e5d6;color:#42674d;font-weight:750;box-shadow:0 0 0 13px #ffffff6b;margin:10px}.tap.go{background:#ce885b;color:white}.tap.wait{background:#d6d7c6}.search-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:7px;width:min(100%,350px);margin:12px auto}.search-grid button{aspect-ratio:1;border:1px solid #d5e2d2;background:#fffefa;border-radius:8px;font-size:21px;color:#557563}.memory-letter{font:normal 84px Georgia,serif;color:#496b53;margin:5px 0}.empty{min-height:155px;border:1px dashed #dce6db;border-radius:12px;display:grid;place-items:center;color:#96a399;font-size:12px;text-align:center;padding:25px}.plot{width:100%;height:auto}.history{display:grid;gap:9px}.history-item{padding:13px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:12px}.history-item:last-child{border:0}.history-item b{font-size:13px}.history-item span{color:var(--muted);font-size:11px}.footer{border-top:1px solid var(--line);margin-top:32px;padding-top:18px;color:#9aa79d;font-size:11px;line-height:1.7}.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.step{background:#f0f4ed;border-radius:13px;padding:17px}.step strong{font:normal 25px Georgia,serif;color:#bb825e}.step b{display:block;margin:13px 0 5px;font-size:12px}.step p{font-size:11px;color:var(--muted);line-height:1.6}.message{color:#54755e;font-size:12px;margin-top:14px}.subnav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}.subnav button{border:1px solid var(--line);background:#fffefa;padding:9px 13px;border-radius:99px;color:#718276;font-size:12px}.subnav button.active{background:var(--accent);color:white}.metric{font:normal 30px Georgia,serif;margin:12px 0 2px}
      @media(max-width:900px){.shell{grid-template-columns:1fr;gap:12px}.side{position:static;display:flex;overflow-x:auto;gap:6px}.side small,.side-foot{display:none}.side button{white-space:nowrap;width:auto}.two{grid-template-columns:1fr 1fr}}
      @media(max-width:640px){.top{padding:18px}.shell{padding:16px 16px 55px}.top-note{display:none}.side button{padding:10px}.side button span{display:none}.hero h1{font-size:43px}.two,.three,.game-cards,.steps{grid-template-columns:1fr}.card{padding:18px}.stage{min-height:290px}.stat{font-size:31px}}
    `}</style>
    <header className="top"><div className="brand"><span>✳</span> chronomind <span style={{fontSize:11,fontWeight:500,letterSpacing:0,color:"var(--muted)"}}> / personal rhythms</span></div><div className="row"><div className="top-note">A calmer way to understand your focus</div><div className="cm-theme-control" role="group" aria-label="Appearance"><button type="button" aria-pressed={theme === "light"} onClick={() => chooseTheme("light")}>☀ Light</button><button type="button" aria-pressed={theme === "dark"} onClick={() => chooseTheme("dark")}>☾ Dark</button><button type="button" aria-pressed={theme === "system"} onClick={() => chooseTheme("system")}>◫ Auto</button></div></div></header>
    <div className="shell"><aside className="side"><small>Explore</small>{NAV.map(item => <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => selectPage(item.id)}><span>{item.icon}</span>{item.label}</button>)}<div className="side-foot">Made for curiosity, not diagnosis. Sessions are saved in this browser and sent to the configured API server. No account or cloud sync.</div></aside>
      <main className="content">
        {page === "home" && <><div className="hero"><div className="eyebrow">{today || "Your personal space"}</div><h1>{greeting}.<br/>How's your mind today?</h1><p>A small daily check-in. A few minutes of play. A clearer picture of how your attention changes over time.</p></div>
          <div className="grid three"><div className="card"><div className="kicker">Sessions recorded</div><div className="stat">{records.length}</div><div className="small">Across all cognitive activities</div></div><div className="card"><div className="kicker">Days explored</div><div className="stat">{uniqueDays}</div><div className="small">Different days with measurements</div></div><div className="card"><div className="kicker">Activities available</div><div className="stat">13</div><div className="small">Five cognitive domains</div></div></div>
          <div className="grid two" style={{marginTop:16}}><section className="card"><div className="kicker">Before you begin</div><h2 style={{marginTop:8}}>A quick context check-in</h2><p className="small">Your answers will be saved alongside new sessions to help you interpret patterns.</p><div className="grid two" style={{marginTop:20}}><div className="field"><label>Sleep last night · {sleep} h</label><input type="range" min="0" max="12" step="0.5" value={sleep} onChange={e=>setSleep(Number(e.target.value))}/></div><div className="field"><label>Sleepiness now · {sleepy}/9</label><input type="range" min="1" max="9" value={sleepy} onChange={e=>setSleepy(Number(e.target.value))}/></div></div><button className="btn" style={{marginTop:20}} onClick={()=>selectPage("lab")}>Explore the cognitive lab →</button></section>
            <section className="card"><div className="kicker">Your latest snapshot</div><h2 style={{marginTop:8}}>A pattern takes time</h2>{recent ? <><div className="stat">{recent.score} {recent.unit}</div><p className="small">{gameInfo[recent.game].title} · {new Date(recent.at).toLocaleDateString()}</p></> : <div className="empty" style={{marginTop:15}}>Complete a game to begin your history.</div>}<div className="note" style={{marginTop:15}}>ChronoMind doesn't assume one time of day works for everyone. Repeated sessions can help us explore your own variation.</div></section></div>
          <section className="card" style={{marginTop:16}}><div className="between"><div><div className="kicker">The cognitive lab</div><h2 style={{marginTop:7}}>Thirteen ways to explore your mind</h2></div><button className="btn secondary" onClick={()=>selectPage("lab")}>See all activities</button></div><div className="game-cards" style={{marginTop:20}}>{(Object.keys(gameInfo) as Game[]).map((g,i)=><button className="game-choice" key={g} onClick={()=>{resetGame(g);selectPage("lab")}}><span className="symbol">{["◉","⌕","◇","✳","✦","▦","◈"][i%7]}</span><b>{gameInfo[g].title}</b><small>{gameInfo[g].subtitle}</small></button>)}</div></section>
        </>}
        {page === "about" && <><div className="section-head"><div className="eyebrow">The idea behind ChronoMind</div><h1>Your brain has a rhythm.<br/>Let's learn yours.</h1><p>Most calendars organize your time. ChronoMind explores whether your own repeated cognitive measurements can help you understand when certain kinds of work feel easier.</p></div><section className="card"><h2>How the experience works</h2><div className="steps" style={{marginTop:20}}>{[["01","Check in","Share a little context about sleep and alertness."],["02","Play","Explore attention, search, memory, control, and reasoning tasks."],["03","Reflect","See your personal scores over time."],["04","Plan","Experiment with a focus window and review it."]].map(([n,t,d])=><div className="step" key={n}><strong>{n}</strong><b>{t}</b><p>{d}</p></div>)}</div></section><div className="grid two" style={{marginTop:16}}><section className="card"><h2>What the research says</h2><p className="small">Our existing research dataset includes PVT, Visual Search and N2Back observations. Participant-separated model evaluations suggested personal baselines are important. Browser-game results are tracked separately from those research measurements.</p></section><section className="card"><h2>What we're careful about</h2><p className="small">These games are exploratory activities, not validated clinical tests. Task selection is rule-based; there is no live ML inference yet. Reaction time is not the same as intelligence or overall productivity. Timing suggestions are hypotheses to test, not proven optimal schedules.</p></section></div></>}
        {page === "lab" && <><div className="section-head"><div className="eyebrow">Your cognitive playground</div><h1>Small games.<br/>Meaningful observations.</h1><p>Choose an activity. Each one explores a different narrow skill. Repeat sessions across days to start building your personal picture.</p></div>
          <section className="card" style={{marginBottom:16}}><div className="kicker">A lab that responds to you</div><h2 style={{marginTop:8}}>What would you like to explore today?</h2><div className="grid two" style={{marginTop:16}}><div className="field"><label>Today's goal</label><select value={goal} onChange={e=>setGoal(e.target.value as Goal)}><option value="explore">Explore my cognitive rhythm</option><option value="attention">Attention / staying focused</option><option value="memory">Memory / studying</option><option value="visual">Visual attention / detail work</option></select></div><div className="field"><label>Input device (for measurement context)</label><select value={device} onChange={e=>setDevice(e.target.value)}><option>mouse / trackpad</option><option>touchscreen</option><option>keyboard</option></select></div></div><div className="field" style={{marginTop:12,maxWidth:260}}><label>Wake-up time (optional context)</label><input type="time" value={wakeTime} onChange={e=>setWakeTime(e.target.value)}/></div><div className="note" style={{marginTop:14}}><b>Suggested: {gameInfo[recommendation].title}.</b> {recommendationReason} You can choose another assessment below. Selection is rule-based, not a trained ML prediction.</div><div className="field" style={{marginTop:12,maxWidth:220}}><label>Available time</label><select value={labMinutes} onChange={e=>setLabMinutes(Number(e.target.value))}><option value={2}>2 minutes</option><option value={5}>5 minutes</option><option value={10}>10 minutes</option></select></div><button className="btn" style={{marginTop:13}} onClick={()=>resetGame(recommendation)}>Try suggested assessment →</button><button className="btn secondary" style={{marginTop:13,marginLeft:8}} onClick={()=>resetGame(extraIds[Math.floor(Math.random()*extraIds.length)])}>Surprise me ✳</button></section>
          <div className="subnav" style={{marginBottom:14}}>{["All","Attention","Visual attention","Working memory","Cognitive control","Reasoning"].map(d=><button key={d} className={browseDomain===d?"active":""} onClick={()=>setBrowseDomain(d)}>{d}</button>)}</div>
          <div className="game-cards">{(Object.keys(gameInfo) as Game[]).filter(g=>browseDomain==="All" || (g==="reaction"?"Attention":g==="search"?"Visual attention":g==="memory"?"Working memory":EXTRA[g as ExtraGame]?.domain)===browseDomain).map((g,i)=><button key={g} className={`game-choice ${game===g?"chosen":""}`} onClick={()=>resetGame(g)}><span className="symbol">{["◉","⌕","◇","✳","✦","▦","◈"][i%7]}</span><b>{gameInfo[g].title}</b><small>{gameInfo[g].subtitle}</small></button>)}</div>
          {extraIds.includes(game as ExtraGame) ? <section className="card" style={{marginTop:16}}><ExtraLab key={`${game}-${extraSession}`} game={game as ExtraGame} onComplete={(score,details)=>saveResult(game,score,details)} onBack={()=>resetGame("reaction")}/></section> : <section className="card" style={{marginTop:16}}><div className="between"><div><div className="kicker">Now playing</div><h2 style={{marginTop:7}}>{gameInfo[game].title}</h2></div><span className="pill">{game === "reaction" ? "2 warm-ups + 5 trials" : game === "search" ? "5 rounds" : "12 letters"}</span></div>
            <div className="stage">
              {game === "reaction" && <>{phase === "intro" && <><div className="tap">◉</div><h2>Ready when you are.</h2><p>Wait for the circle to turn orange, then tap. Two warm-ups won't count toward your score.</p><button className="btn" onClick={startReaction}>Begin reaction test</button></>}{phase === "waiting" && <><button className="tap wait" onClick={tapReaction}>Wait</button><h2>Hold on…</h2><p>Tap only after the color changes.</p></>}{phase === "go" && <><button className="tap go" onClick={tapReaction}>TAP!</button><h2>Now!</h2></>}{phase === "feedback" && <><h2>{lastReaction !== null ? `${lastReaction} ms` : "A little early"}</h2><p>{message}</p><button className="btn" onClick={startReaction}>Next trial →</button></>}{phase === "done" && <><h2>Your session is saved.</h2><div className="metric">{median(reactionTrials)} ms</div><p>Median of five recorded responses. Your results are saved on this device.</p><div className="row"><button className="btn" onClick={()=>selectPage("results")}>See results</button><button className="btn secondary" onClick={()=>resetGame("reaction")}>Play again</button></div></>}{phase !== "done" && <p className="small">Warm-up {practice}/2 · Recorded {reactionTrials.length}/5 · Early taps {falseStarts}</p>}</>}
              {game === "search" && <>{phase === "intro" && <><div className="tap">⌕</div><h2>Find the odd one out.</h2><p>Find the letter Q hidden among the O's. Complete five grids. Your median search time is saved.</p><button className="btn" onClick={()=>newSearchRound(1)}>Start visual search</button></>}{phase === "go" && <><h2>Find the Q</h2><p>Round {searchRound} of 5</p><div className="search-grid">{searchCells.map((c,i)=><button key={`${searchRound}-${i}`} onClick={()=>chooseSearch(i)} aria-label={`Grid position ${i+1}: ${c}`}>{c}</button>)}</div></>}{phase === "feedback" && <><h2>Nicely spotted.</h2><p>{message}</p><button className="btn" onClick={()=>newSearchRound(searchRound+1)}>Next grid →</button></>}{phase === "done" && <><h2>Search complete.</h2><div className="metric">{median(searchTimes)} s</div><p>Median time across five grids.</p><div className="row"><button className="btn" onClick={()=>selectPage("results")}>See results</button><button className="btn secondary" onClick={()=>resetGame("search")}>Play again</button></div></>}</>}
              {game === "memory" && <>{phase === "intro" && <><div className="tap">◇</div><h2>Two steps back.</h2><p>Watch a sequence of letters. For each letter after the first two, decide whether it matches the one from two positions earlier.</p><button className="btn" onClick={startMemory}>Start 2-back</button></>}{phase === "go" && <><div className="small">Letter {memoryIndex+1} of {memorySeq.length}</div><div className="memory-letter">{memorySeq[memoryIndex]}</div>{memoryIndex<2 ? <><p>Observe this letter. Decisions begin at letter 3.</p><button className="btn" onClick={advanceMemory}>Next letter →</button></> : <><p>Does this match the letter from two steps ago?</p><div className="row"><button className="btn" onClick={()=>answerMemory(true)}>Match</button><button className="btn secondary" onClick={()=>answerMemory(false)}>No match</button></div></>}</>}{phase === "done" && <><h2>Memory session saved.</h2><div className="metric">{Math.round(memoryAnswers.filter(Boolean).length/memoryAnswers.length*100)}%</div><p>{memoryAnswers.filter(Boolean).length} correct out of {memoryAnswers.length} decisions.</p><div className="row"><button className="btn" onClick={()=>selectPage("results")}>See results</button><button className="btn secondary" onClick={()=>resetGame("memory")}>Play again</button></div></>}</>}
            </div><div className="between" style={{marginTop:15}}><p className="small">Browser timing and input devices can affect results.</p><button className="btn ghost" onClick={()=>resetGame(game)}>Reset activity</button></div>
          </section>}</>}
        {page === "results" && <><section className="card" style={{marginBottom:16}}><div className="kicker">Experimental ML · research PVT</div><h2>Population reaction-time estimate</h2><p className="small">Uses current clock time and the wake-up time from your check-in. The wake-up time must be from today; overnight wakefulness is not represented. This model was trained on BrighterTime PVT data, not these browser games. It is not a validated personal forecast.</p><div className="field" style={{maxWidth:250,marginTop:12}}><label>Ambient light log (optional, training-data units)</label><input type="number" step="any" value={ambientLight} onChange={e=>setAmbientLight(e.target.value)} placeholder="Leave blank to impute" /></div><button className="btn" style={{marginTop:12}} onClick={()=>void runResearchPrediction()} disabled={mlLoading}>{mlLoading ? "Estimating…" : "Run experimental ML estimate"}</button>{mlPrediction !== null && <div className="stat" style={{marginTop:12}}>{mlPrediction} ms</div>}{mlStatus && <p className="small">{mlStatus}</p>}<p className="small">Not used for clinical interpretation or automatic scheduling recommendations.</p></section><div className="section-head"><div className="eyebrow">Your cognitive history</div><h1>Notice the pattern,<br/>not just the number.</h1><p>Your measurements belong to you. Compare your own sessions, not yourself against a universal standard.</p></div><div className="grid three">{(Object.keys(gameInfo) as Game[]).map(g=><div className="card" key={g}><div className="kicker">{gameInfo[g].title}</div><div className="stat">{byGame(g).length ? `${byGame(g).at(-1)?.score}` : "—"}</div><div className="small">{gameInfo[g].unit} · {byGame(g).length} sessions</div></div>)}</div><section className="card" style={{marginTop:16}}><div className="between"><h2>Personal baseline · {gameInfo[game].title}</h2><span className="pill">Descriptive only</span></div>{personalInsight ? <><div className="stat">{personalInsight.observed_median_rt_ms !== null ? `${game === "search" ? Math.round(personalInsight.observed_median_rt_ms / 100) / 10 : personalInsight.observed_median_rt_ms} ${gameInfo[game].unit}` : personalInsight.observed_mean_accuracy !== null ? `${Math.round(personalInsight.observed_mean_accuracy * 1000) / 10}%` : "—"}</div><p className="small">{personalInsight.session_count} server-recorded sessions for this game and protocol. {personalInsight.observed_median_rt_ms !== null ? "Median response time across sessions." : "Mean accuracy across sessions."} This is not an ML prediction.</p></> : <p className="small">{insightStatus}</p>}</section><section className="card" style={{marginTop:16}}><div className="between"><h2>Performance over time</h2><span className="pill">Personal data</span></div><div className="subnav" style={{marginTop:15}}>{(Object.keys(gameInfo) as Game[]).map(g=><button key={g} className={game===g?"active":""} onClick={()=>setGame(g)}>{gameInfo[g].title}</button>)}</div><LineChart data={byGame(game)} unit={gameInfo[game].unit} lower={gameInfo[game].lower}/></section><section className="card" style={{marginTop:16}}><div className="between"><h2>Recent sessions</h2><button className="btn secondary" onClick={exportData}>Export JSON</button></div>{records.length ? <div className="history">{records.slice(-8).reverse().map(r=><div className="history-item" key={r.id}><div><b>{gameInfo[r.game].title}</b><br/><span>{new Date(r.at).toLocaleString()} · Sleep {r.sleep}h · Sleepiness {r.sleepy}/9</span></div><b>{r.score} {r.unit}</b></div>)}</div> : <div className="empty">No sessions yet. Your lab results will appear here.</div>}</section></>}
        {page === "planner" && <><div className="section-head"><div className="eyebrow">Your focus planner</div><h1>Make space for<br/>your best work.</h1><p>Choose a time yourself, or explore a tentative suggestion once you have enough repeated reaction-time sessions at different times of day.</p></div><div className="note" style={{marginBottom:16}}>{canSuggest ? `Exploratory signal: your ${best?.band} sessions currently have the lowest median reaction time among sampled periods. This is a descriptive comparison, not a validated prediction of productivity.` : `${evidenceMessage} You currently have ${reaction.length} reaction-time sessions.`}</div><section className="card"><div className="kicker">Plan a focus block</div><h2 style={{marginTop:8}}>One thing at a time.</h2><div className="grid three" style={{marginTop:20}}><div className="field"><label>What will you work on?</label><select value={task} onChange={e=>setTask(e.target.value)}><option>Deep work / studying</option><option>Writing / creative work</option><option>Reading / revision</option><option>Admin / routine tasks</option><option>Personal project</option></select></div><div className="field"><label>Duration</label><select value={minutes} onChange={e=>setMinutes(Number(e.target.value))}><option value={25}>25 minutes</option><option value={45}>45 minutes</option><option value={60}>60 minutes</option><option value={90}>90 minutes</option></select></div><div className="field"><label>Start time</label><input type="datetime-local" value={planAt} onChange={e=>{setPlanAt(e.target.value);setPlanSource("manual");}}/></div></div><div className="row" style={{marginTop:20}}><button className="btn secondary" disabled={!canSuggest} onClick={suggestTime}>Suggest from my sessions</button><button className="btn" onClick={()=>selectPage("calendar")}>Continue to calendar →</button></div></section><section className="card" style={{marginTop:16}}><h2>Did your focus window help?</h2>{latestPlan ? <><p className="small">{latestPlan.title} · {new Date(latestPlan.at).toLocaleString()} · {latestPlan.minutes} minutes. Feedback is subjective and is not proof of improved productivity.</p><div className="row">{([['helped','It helped'],['neutral','It was okay'],['not_helpful','Not really']] as const).map(([value,label])=><button key={value} className={latestPlan.feedback===value?'btn':'btn secondary'} onClick={()=>feedbackPlan(latestPlan.id,value)}>{label}</button>)}</div></> : <p className="small">Create a focus block first, then come back and share how it went.</p>}</section><div className="warm" style={{marginTop:16}}>A fast reaction time doesn't automatically mean better learning or creative work. Treat suggested windows as experiments and reflect on how they actually feel.</div></>}
        {page === "calendar" && <><div className="section-head"><div className="eyebrow">Calendar integration</div><h1>Turn a plan<br/>into a moment.</h1><p>Export a focus block to your calendar. You stay in control of what gets added.</p></div><section className="card"><h2>Your next focus window</h2><div className="grid three" style={{marginTop:18}}><div className="field"><label>Task</label><select value={task} onChange={e=>setTask(e.target.value)}><option>Deep work / studying</option><option>Writing / creative work</option><option>Reading / revision</option><option>Admin / routine tasks</option><option>Personal project</option></select></div><div className="field"><label>Start</label><input type="datetime-local" value={planAt} onChange={e=>{setPlanAt(e.target.value);setPlanSource("manual");}}/></div><div className="field"><label>Duration</label><select value={minutes} onChange={e=>setMinutes(Number(e.target.value))}><option value={25}>25 minutes</option><option value={45}>45 minutes</option><option value={60}>60 minutes</option><option value={90}>90 minutes</option></select></div></div><button className="btn" style={{marginTop:20}} onClick={createEvent}>Download calendar event (.ics)</button>{message && <div className="message" role="status">{message}</div>}<p className="small">This downloads an event file compatible with many calendar apps. It does not directly connect to or edit your Google Calendar.</p></section><section className="card" style={{marginTop:16}}><h2>Planned focus windows</h2>{plans.length ? <div className="history">{plans.slice(-6).reverse().map(p=><div className="history-item" key={p.id}><div><b>{p.title}</b><br/><span>{new Date(p.at).toLocaleString()}</span></div><b>{p.minutes} min</b></div>)}</div> : <div className="empty">Your planned focus blocks will appear here.</div>}</section></>}
        <footer className="footer"><div>ChronoMind is an exploratory personal project, not a medical or diagnostic tool. Research-dataset measurements and browser activities are not interchangeable.</div><div className="row" style={{marginTop:12}}><button className="btn ghost" onClick={exportData}>Export my data</button><button className="btn ghost" onClick={()=>{if(window.confirm("Delete all saved ChronoMind sessions and plans from this browser?")){setRecords([]);setPlans([]);setMessage("Local data deleted.");}}}>Delete saved data</button></div></footer>
      </main></div>
  </div>;
}
