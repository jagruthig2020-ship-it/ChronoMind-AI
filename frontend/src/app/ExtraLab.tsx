"use client";
import { useEffect, useMemo, useRef, useState } from "react";

export type ExtraGame = "go" | "vigilance" | "symbol" | "distractor" | "sequence" | "match" | "stroop" | "switch" | "pattern" | "coding";
type Domain = "Attention" | "Visual attention" | "Working memory" | "Cognitive control" | "Reasoning";
type Spec = { name: string; domain: Domain; description: string; instruction: string; unit: string; lower: boolean };
export const EXTRA: Record<ExtraGame, Spec> = {
  go: { name:"Go / No-Go", domain:"Cognitive control", description:"Respond to GO; resist NO-GO", instruction:"Tap GO only when the prompt says GO. For NO-GO, tap Skip. Both count as decisions.", unit:"%", lower:false },
  vigilance: { name:"Focus Vigilance", domain:"Attention", description:"Spot a rare signal", instruction:"Choose Signal when you see ★, otherwise choose No signal. Stay attentive across rounds.", unit:"%", lower:false },
  symbol: { name:"Find the Symbol", domain:"Visual attention", description:"Identify an odd symbol", instruction:"Find the single different symbol in the grid. Select its numbered position.", unit:"%", lower:false },
  distractor: { name:"Distractor Challenge", domain:"Visual attention", description:"Search with competing shapes", instruction:"Find the unique target symbol in the grid. Select its numbered position.", unit:"%", lower:false },
  sequence: { name:"Sequence Recall", domain:"Working memory", description:"Remember a short sequence", instruction:"Memorize the digit sequence, then choose the exact match from four options.", unit:"%", lower:false },
  match: { name:"Memory Match", domain:"Working memory", description:"Remember recently seen pairs", instruction:"Study the symbol pair, then choose the same pair from four options.", unit:"%", lower:false },
  stroop: { name:"Color Conflict", domain:"Cognitive control", description:"Ignore the written word", instruction:"Select the INK COLOR of the word, not what the word says.", unit:"%", lower:false },
  switch: { name:"Rule Switch", domain:"Cognitive control", description:"Change decision rules", instruction:"Follow the current rule: choose either the color or the shape of the symbol.", unit:"%", lower:false },
  pattern: { name:"Pattern Sequence", domain:"Reasoning", description:"Continue a number pattern", instruction:"Find the next number in the pattern.", unit:"%", lower:false },
  coding: { name:"Symbol Matching", domain:"Reasoning", description:"Use a symbol-to-number key", instruction:"Use the key to identify the number assigned to the highlighted symbol.", unit:"%", lower:false },
};
export const extraIds = Object.keys(EXTRA) as ExtraGame[];
type Round = { prompt: string; options: string[]; answer: string; note?: string; accent?: string };
const pick = <T,>(xs:T[]) => xs[Math.floor(Math.random()*xs.length)];
const shuffle = <T,>(xs:T[]) => { const a=[...xs]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
const COLORS = ["Red","Blue","Green","Purple"];
const INKS:Record<string,string> = { Red:"#d65b5b", Blue:"#5089d9", Green:"#379e76", Purple:"#9568c9" };
function createRound(game:ExtraGame, difficulty:number):Round {
  if (game==="go" || game==="vigilance") {
    const yes = Math.random() < (game==="go"?.7:.3);
    return {prompt:game==="go"?(yes?"GO":"NO-GO"):(yes?"★":"☆"),options:game==="go"?["GO","Skip"]:["Signal","No signal"],answer:game==="go"?(yes?"GO":"Skip"):(yes?"Signal":"No signal")};
  }
  if (game==="symbol" || game==="distractor") {
    const count = difficulty>=3?16:9, idx=Math.floor(Math.random()*count);
    const base=game==="symbol"?"○":"◇", target=game==="symbol"?"●":"◆";
    const cells=Array.from({length:count},(_,i)=>i===idx?target:base);
    return {prompt:cells.map((c,i)=>`${i+1}. ${c}`).join("     "),options:Array.from({length:count},(_,i)=>String(i+1)),answer:String(idx+1),note:`Find ${target} among ${base}`};
  }
  if (game==="sequence" || game==="match") {
    if(game==="sequence") {
      const digits=Array.from({length:difficulty>=3?5:4},()=>Math.floor(Math.random()*8)+1);
      const correct=digits.join(" "); const options=new Set([correct]);
      while(options.size<4){const changed=[...digits], i=Math.floor(Math.random()*digits.length);changed[i]=changed[i]===9?1:changed[i]+1;options.add(changed.join(" "));}
      return {prompt:correct,options:shuffle([...options]),answer:correct,note:"Study this sequence. It will disappear after 2 seconds."};
    }
    const icons=["☀","☾","◆","✿","★","♣","♥"];
    const a=pick(icons),b=pick(icons.filter(x=>x!==a)),correct=`${a} ${b}`;
    const options=new Set([correct]);while(options.size<4) options.add(`${pick(icons)} ${pick(icons)}`);
    return {prompt:correct,options:shuffle([...options]),answer:correct,note:"Study this pair. It will disappear after 2 seconds."};
  }
  if(game==="stroop") {
    const word=pick(COLORS), ink=pick(COLORS.filter(c=>c!==word));
    return {prompt:word,options:shuffle(COLORS),answer:ink,accent:INKS[ink],note:"Choose the ink color, not the word."};
  }
  if(game==="switch") {
    const rule=pick(["COLOR","SHAPE"]),color=pick(COLORS),shape=pick(["Circle","Square","Triangle"]);
    return {prompt:`${rule}: ${color} ${shape}`,options:rule==="COLOR"?shuffle(COLORS):shuffle(["Circle","Square","Triangle"]),answer:rule==="COLOR"?color:shape,note:`Rule: choose the ${rule.toLowerCase()}.`};
  }
  if(game==="pattern") {
    const start=Math.floor(Math.random()*12)+1,step=Math.floor(Math.random()*5)+2;
    const correct=String(start+step*4);
    return {prompt:[0,1,2,3].map(i=>start+i*step).join("  ·  ")+"  ·  ?",options:shuffle([correct,String(Number(correct)+step),String(Number(correct)-1),String(Number(correct)+1)]),answer:correct};
  }
  const symbols=["◆","●","▲","■"],key=shuffle(["1","2","3","4"]),i=Math.floor(Math.random()*4);
  return {prompt:`${symbols.map((s,j)=>`${s}=${key[j]}`).join("    ")}     |     ${symbols[i]} = ?`,options:shuffle(["1","2","3","4"]),answer:key[i]};
}
export function ExtraLab({game,onComplete,onBack}:{game:ExtraGame;onComplete:(score:number,details:string)=>void;onBack:()=>void}) {
  const [phase,setPhase]=useState<"intro"|"study"|"play"|"done">("intro");
  const [round,setRound]=useState(0);
  const [correct,setCorrect]=useState(0);
  const [difficulty,setDifficulty]=useState(1);
  const [question,setQuestion]=useState<Round|null>(null);
  const [feedback,setFeedback]=useState("");
  const [responses,setResponses]=useState<number[]>([]);
  const startTime=useRef(0),timeout=useRef<ReturnType<typeof setTimeout>|null>(null);
  const saved=useRef(false);
  const spec=EXTRA[game];
  useEffect(()=>()=>{if(timeout.current)clearTimeout(timeout.current);},[]);
  const trials=8;
  function present(q:Round) {
    if(timeout.current)clearTimeout(timeout.current);
    setQuestion(q);setFeedback("");
    if(game==="sequence"||game==="match") {
      setPhase("study");
      timeout.current=setTimeout(()=>{setPhase("play");startTime.current=performance.now();},2000);
    } else {setPhase("play");startTime.current=performance.now();}
  }
  function begin(){if(timeout.current)clearTimeout(timeout.current);saved.current=false;setRound(0);setCorrect(0);setResponses([]);setDifficulty(1);present(createRound(game,1));}
  function answer(value:string){
    if(phase!=="play"||!question)return;
    const ok=value===question.answer, nextCorrect=correct+(ok?1:0);
    const elapsed=Math.round(performance.now()-startTime.current);
    const nextResponses=[...responses,elapsed];
    setCorrect(nextCorrect);setResponses(nextResponses);
    const next=round+1;
    if(next>=trials){
      if(!saved.current){const ordered=[...nextResponses].sort((a,b)=>a-b);const medianMs=Math.round((ordered[3]+ordered[4])/2);saved.current=true;onComplete(Math.round(nextCorrect/trials*100),`${nextCorrect}/${trials} correct; ${trials} trials; protocol=exploratory-v2; difficulty=adaptive; medianResponseMs=${medianMs}`);}
      setPhase("done");return;
    }
    const nextDifficulty=nextCorrect>=Math.ceil(next*.8)?3:nextCorrect<=Math.floor(next*.4)?1:2;
    setDifficulty(nextDifficulty);setRound(next);setFeedback(ok?"Correct":"Not quite");present(createRound(game,nextDifficulty));
  }
  const avg=useMemo(()=>responses.length?Math.round(responses.reduce((a,b)=>a+b,0)/responses.length):0,[responses]);
  return <div className="cm-extra">
    <div className="between"><div><div className="kicker">{spec.domain} · Exploratory task</div><h2>{spec.name}</h2></div><span className="pill">{phase==="intro"?"Ready":`${Math.min(round+1,trials)}/${trials}`}</span></div>
    <p className="small">{spec.instruction}</p>
    {phase==="intro"?<div className="cm-extra-center"><div className="cm-extra-mark">✳</div><h2>Ready to explore?</h2><p>Eight short rounds. A practice experience, not a validated clinical assessment.</p><button className="btn" onClick={begin}>Start {spec.name}</button></div>:null}
    {phase==="study"&&question?<div className="cm-extra-center" aria-live="polite"><div className="small">Memorize this</div><div className="cm-extra-prompt">{question.prompt}</div><p>Choices appear in two seconds…</p></div>:null}
    {phase==="play"&&question?<div className="cm-extra-center"><div className="small">{question.note||"Choose the correct answer"}</div><div className="cm-extra-prompt" style={question.accent?{color:question.accent}:undefined}>{(game==="sequence"||game==="match")?"?":question.prompt}</div><div className="cm-extra-options">{question.options.map((o,i)=><button type="button" key={`${round}-${i}`} onClick={()=>answer(o)}>{o}</button>)}</div><p className="small" role="status">{feedback} · Difficulty {difficulty}</p></div>:null}
    {phase==="done"?<div className="cm-extra-center"><div className="kicker">Session saved</div><div className="metric">{Math.round(correct/trials*100)}%</div><h2>{correct} of {trials} correct</h2><p>Average decision time: {avg} ms. Scores are exploratory; difficulty adapts between rounds, so direct comparisons across sessions require caution.</p><div className="row"><button className="btn" onClick={begin}>Try again</button><button className="btn secondary" onClick={onBack}>Back to lab</button></div></div>:null}
    <style jsx>{`.cm-extra{padding:4px 0}.cm-extra-center{text-align:center;display:flex;align-items:center;flex-direction:column;gap:16px;padding:40px 10px}.cm-extra-mark{font-size:60px;color:var(--accent)}.cm-extra-prompt{font-size:clamp(23px,4vw,40px);font-weight:750;white-space:pre-wrap;line-height:1.8;max-width:780px;overflow-wrap:anywhere}.cm-extra-options{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;max-width:690px}.cm-extra-options button{background:var(--card);color:var(--ink);border:1px solid var(--line);padding:15px 20px;min-width:76px;border-radius:12px;font-size:17px;cursor:pointer}.cm-extra-options button:hover,.cm-extra-options button:focus-visible{outline:2px solid var(--accent)}.cm-extra-center p{max-width:580px}`}</style>
  </div>;
}
