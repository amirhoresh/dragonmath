/* DragonMath — game logic.
   One specific kid, ~11-12, ADHD. Builds 1-10 multiplication fluency.
   ADHD rules baked in: one thing on screen, reward the attempt, trivial start,
   visible progress, hard stop. No network, all state in localStorage. */

'use strict';

// ---------- persistence ----------
const SAVE_KEY = 'dragonmath.save.v1';

const defaultSave = () => ({
  stars: 0,            // lifetime stars -> dragon growth
  mastery: {},         // "a x b" -> {seen, correct(first-try), wrong(total mistakes)}
  lastPlayed: 0,
  muted: false,        // sound on/off
  days: {},            // "YYYY-MM-DD" -> {a:answered, c:first-try-correct, s:stars, m:mistakes}
  topics: {},          // mode -> {q:questions, ft:first-try, miss:total mistakes, solved:eventually-right}
  lastActivityTs: 0,   // when she last answered a question
  syncUrl: '',         // parent's Google Apps Script URL (optional)
  childName: '',       // optional, for the parent email
  lastSync: 0,
  tablesLevel: 1,      // current level in the timed Tables game
  craveDone: '',        // todayKey() when she satisfied today's craving
  review: { sessions: [{},{},{},{},{}] }, // exam-review session progress
});

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    return Object.assign(defaultSave(), JSON.parse(raw));
  } catch { return defaultSave(); }
}
function save(s) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch {}
}

let state = load();

// ---------- progress tracking + parent sync ----------
const TOPIC_LABEL = {
  count: 'Multiplication', pop: 'Speed (Bubble Pop)', division: 'Division',
  primes: 'Primes', shapes: 'Shapes', triangles: 'Triangles', fractions: 'Fractions',
  tables: 'Times Tables (timed)', drill: 'Number Drill', rect: 'Area & Perimeter',
  quads: 'Quadrilateral Properties', factors: 'Factor Pairs',
  numline: 'Number Line', oporder: 'Order of Operations', bignum: 'Large Numbers',
};

// ---------- daily craving ----------
const CRAVING_MODES = ['count','pop','tables','drill','division','primes','shapes','triangles','rect','fractions','quads','factors','numline','oporder','bignum'];
const CRAVING_HE = {
  count: 'כפל בנקודות', pop: 'בועות מהירות', tables: 'לוח הכפל', drill: 'אלוף המספרים',
  division: 'חילוק', primes: 'מספרים ראשוניים',
  shapes: 'צורות', triangles: 'משולשים', rect: 'שטח והיקף', fractions: 'שברים',
  quads: 'תכונות מרובעים', factors: 'פירוק לגורמים',
  numline: 'ציר מספרים', oporder: 'סדר פעולות', bignum: 'מספרים גדולים',
};
// which home button to highlight (null = direct button id)
const CRAVING_HOME_BTN = {
  count: 'play-mul', pop: 'play-mul', tables: 'play-mul', drill: 'play-mul',
  shapes: 'play-geo', triangles: 'play-geo', rect: 'play-geo', quads: 'play-geo',
  division: 'play-calc', primes: 'play-numbers', fractions: 'play-fractions',
  factors: 'play-numbers', numline: 'play-numbers',
  oporder: 'play-calc', bignum: 'play-calc',
};
function todayCraving() {
  const dayNum = Math.floor(Date.now() / 86400000);
  return CRAVING_MODES[dayNum % CRAVING_MODES.length];
}
function cravingDone() { return state.craveDone === todayKey(); }
function satisfyCraving(mode) {
  if (!cravingDone() && mode === todayCraving()) {
    state.craveDone = todayKey();
    save(state);
  }
}
function todayKey(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function dayBucket() {
  const k = todayKey();
  return state.days[k] || (state.days[k] = { a: 0, c: 0, s: 0, m: 0 });
}
function pruneDays() {
  const keys = Object.keys(state.days).sort();
  while (keys.length > 60) delete state.days[keys.shift()];
}
// one question answered: correct = got it right eventually, tries = wrong attempts before that
function recordActivity(correct, tries) {
  const d = dayBucket();
  d.a++; if (correct) d.c++; d.m += tries;
  state.lastActivityTs = Date.now();
  pruneDays();
  save(state);
}
function recordTopic(mode, tries, solved) {
  const t = state.topics[mode] || (state.topics[mode] = { q: 0, ft: 0, miss: 0, solved: 0 });
  t.q++; t.miss += tries; if (solved) t.solved++; if (solved && tries === 0) t.ft++;
}
function weekStats() {
  const now = new Date();
  let answered = 0, correct = 0, stars = 0, mistakes = 0, daysPracticed = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(now); d.setDate(now.getDate() - i);
    const b = state.days[todayKey(d)];
    if (b) { answered += b.a; correct += b.c; stars += b.s; mistakes += b.m; if (b.a > 0) daysPracticed++; }
  }
  return { answered, correct, stars, mistakes, daysPracticed, accuracy: answered ? Math.round(correct / answered * 100) : 0 };
}
function daysIdle() {
  if (!state.lastActivityTs) return null;
  return Math.floor((Date.now() - state.lastActivityTs) / 86400000);
}
// facts she struggles with most: low first-try accuracy and/or many mistakes
function weakestFacts(n) {
  const arr = [];
  for (const k in state.mastery) {
    const m = state.mastery[k];
    if (m.seen >= 3) arr.push({ fact: k.replace('x', '×'), acc: Math.round((m.correct / m.seen) * 100), miss: m.wrong || 0, seen: m.seen });
  }
  arr.sort((x, y) => (x.acc - y.acc) || (y.miss - x.miss));
  return arr.slice(0, n || 6);
}
// topics ranked by how much she fumbles them (mistakes per question)
function topicStruggle() {
  const out = [];
  for (const k in state.topics) {
    const t = state.topics[k];
    if (t.q >= 3) out.push({
      topic: TOPIC_LABEL[k] || k, q: t.q,
      missPerQ: +(t.miss / t.q).toFixed(2),
      firstTry: Math.round(t.ft / t.q * 100),
      solved: Math.round(t.solved / t.q * 100),
    });
  }
  out.sort((a, b) => b.missPerQ - a.missPerQ);
  return out;
}
const ALL_MODES = ['count', 'pop', 'division', 'primes', 'shapes', 'triangles', 'fractions', 'tables'];
function buildPayload() {
  // games she has never opened (zero questions answered)
  const avoided = ALL_MODES.filter((m) => !(state.topics[m] && state.topics[m].q > 0)).map((m) => TOPIC_LABEL[m]);
  let allQ = 0, allDays = 0;
  for (const m in state.topics) allQ += state.topics[m].q || 0;
  for (const k in state.days) if ((state.days[k].a || 0) > 0) allDays++;
  return {
    app: 'dragonmath', childName: state.childName || '',
    lastActivityTs: state.lastActivityTs || 0, sentAt: Date.now(),
    stars: state.stars, stage: STAGES[stageIndex(state.stars)].label,
    days: state.days, week: weekStats(),
    weakest: weakestFacts(8), struggle: topicStruggle(),
    avoided, totals: { questions: allQ, daysPracticed: allDays },
  };
}
function syncNow(force, isTest) {
  if (!state.syncUrl || !navigator.onLine) return false;
  if (!force && Date.now() - (state.lastSync || 0) < 30000) return false;
  try {
    const payload = buildPayload();
    if (isTest) payload.test = true;
    fetch(state.syncUrl, {
      method: 'POST', mode: 'no-cors', keepalive: true,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    state.lastSync = Date.now(); save(state);
    return true;
  } catch { return false; }
}
function escAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

// ---------- sound (WebAudio synth — no audio files, stays offline) ----------
const audio = {
  ctx: null,
  ensure() {
    if (this.ctx) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  },
  // play a short tone with a soft attack/decay envelope
  tone(freq, dur, when = 0, type = 'sine', vol = 0.18) {
    if (state.muted || !this.ctx) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  },
  correct() { this.tone(660, 0.12, 0, 'triangle'); this.tone(990, 0.16, 0.10, 'triangle'); },
  pop()     { this.tone(520, 0.07, 0, 'square', 0.12); },
  wrong()   { this.tone(200, 0.18, 0, 'sine', 0.14); },
  grow()    { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, i * 0.09, 'triangle', 0.16)); },
};

// ---------- Sparky (pet) growth ----------
// Many small steps with rising thresholds → slow growth that builds anticipation.
const PET = 'ספארקי';
const STAGES = [
  { min: 0,    label: 'ביצה' },
  { min: 80,   label: 'בוקע מהביצה' },
  { min: 200,  label: 'דרקון תינוק' },
  { min: 380,  label: 'דרקון קטן' },
  { min: 620,  label: 'דרקון צעיר' },
  { min: 950,  label: 'דרקון נמרץ' },
  { min: 1400, label: 'דרקון אביר' },
  { min: 2000, label: 'דרקון אגדי' },
];
function stageIndex(stars) {
  let i = 0;
  for (let k = 0; k < STAGES.length; k++) if (stars >= STAGES[k].min) i = k;
  return i;
}
function stageProgress(stars) {
  const i = stageIndex(stars);
  const cur = STAGES[i].min;
  const next = i + 1 < STAGES.length ? STAGES[i + 1].min : cur;
  if (next === cur) return 1;
  return Math.min(1, (stars - cur) / (next - cur));
}

// Cute SVG dragon. Features unlock gradually across the 8 stages.
// stage 0-9 → phase-01..10
const STAGE_PHASE = ['phase-01','phase-02','phase-03','phase-04','phase-05','phase-06','phase-07','phase-08','phase-09','phase-10'];

function dragonSVG(stage) {
  const phase = STAGE_PHASE[Math.min(stage, STAGE_PHASE.length - 1)];
  const label = (STAGES[stage] || {}).label || '';
  return `<div class="dragon-float" role="img" aria-label="${PET}, ${label}">
    <div class="dragon-breathe">
      <div class="dragon-sprite" style="background-image:url('assets/${phase}.png')"></div>
    </div>
  </div>`;
}

// ---------- fact selection (adaptive) ----------
function factKey(a, b) { return a + 'x' + b; }
function factWeight(a, b) {
  const m = state.mastery[factKey(a, b)] || { seen: 0, correct: 0 };
  const acc = m.seen ? m.correct / m.seen : 0;
  // unseen + low-accuracy facts get more weight; harder facts (big numbers) a bit more
  const novelty = m.seen === 0 ? 2.2 : 1;
  const struggle = 1 + (1 - acc) * 2;
  const size = 1 + (a + b) / 40;
  return novelty * struggle * size;
}
function pickFact(trivial) {
  if (trivial) {
    // first problem of a round: always easy
    const a = 1 + Math.floor(rand() * 5);          // 1..5
    const b = [1, 2, 2, 3][Math.floor(rand() * 4)]; // 1..3
    return rand() < 0.5 ? [a, b] : [b, a];
  }
  const pool = [];
  for (let a = 1; a <= 10; a++) for (let b = 1; b <= 10; b++) pool.push([a, b]);
  const weights = pool.map(([a, b]) => factWeight(a, b));
  const total = weights.reduce((x, y) => x + y, 0);
  for (let t = 0; t < 20; t++) {
    let r = rand() * total, choice = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) { choice = pool[i]; break; } }
    const key = 'm:' + Math.min(choice[0], choice[1]) + 'x' + Math.max(choice[0], choice[1]);
    if (t === 19 || !recentHas(key, 8)) { remember(key); return choice; }
  }
  return pool[pool.length - 1];
}
// deterministic-ish PRNG seeded by time, fine for a game
let _seed = (Date.now() >>> 0) || 12345;
function rand() { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; }

function recordAttempt(a, b, correct, tries) {
  const k = factKey(a, b);
  const m = state.mastery[k] || { seen: 0, correct: 0, wrong: 0 };
  m.seen++; if (correct) m.correct++; m.wrong = (m.wrong || 0) + (tries || 0);
  state.mastery[k] = m;
}

// ---------- answer options ----------
function answerOptions(answer, spread = 3) {
  const opts = new Set([answer]);
  let guard = 0;
  while (opts.size < 4 && guard++ < 60) {
    const delta = (Math.floor(rand() * spread) + 1) * (rand() < 0.5 ? 1 : -1);
    const cand = answer + delta;
    if (cand > 0) opts.add(cand);
  }
  return shuffleInPlace([...opts]);
}

// ---------- round controller (stop rule combo D) ----------
const ROUND = { maxProblems: 12, maxMs: 5 * 60 * 1000, maxWrongStreak: 3 };
let round = null;
let drill = null;

function startRound(mode, opts = {}) {
  audio.ensure(); // first user gesture — unlock audio
  round = {
    mode: mode || 'count', // 'count' = Build & Count, 'pop' = Bubble Pop
    ...opts,
    index: 0,
    correctCount: 0,
    starsEarned: 0,
    wrongStreak: 0,
    combo: 0,
    startTs: Date.now(),
    ending: false,
    recent: [],          // recently-asked question keys (anti-repeat window)
  };
  nextProblem(true);
}

// Anti-repeat: keep a sliding window of recent question keys so the same
// question can't pop up again for several turns. Each game uses its own key.
function recentHas(key, window) { return (round.recent || []).slice(-window).includes(key); }
function remember(key) { (round.recent || (round.recent = [])).push(key); }

function roundShouldEnd() {
  if (!round) return true;
  if (round.reviewMode) return round.index >= 15;  // review: exactly 15 questions
  if (round.index >= ROUND.maxProblems) return true;
  if (Date.now() - round.startTs >= ROUND.maxMs) return true;
  if (round.wrongStreak >= ROUND.maxWrongStreak) return true;
  return false;
}

let problem = null;
function nextProblem(trivial) {
  const makers = { shapes: makeShapeProblem, triangles: makeTriangleProblem, division: makeDivisionProblem, primes: makePrimeProblem, fractions: makeFractionProblem, rect: makeRectProblem, quads: makeQuadProblem, factors: makeFactorProblem, numline: makeNumlineProblem, oporder: makeOpOrderProblem, bignum: makeBignumProblem, review: makeReviewProblem };
  if (makers[round.mode]) {
    const make = makers[round.mode];
    if (!trivial && roundShouldEnd() && !round.ending) {
      round.ending = true; problem = make(true); renderRound(); return;
    }
    if (round.ending) { endRound(); return; }
    problem = make(false);
    renderRound();
    return;
  }
  // if stop rule hit, throw in one guaranteed-easy "win" problem, then end.
  if (!trivial && roundShouldEnd() && !round.ending) {
    round.ending = true;
    const [a, b] = pickFact(true);
    problem = makeProblem(a, b, /*finalWin*/ true);
    renderRound();
    return;
  }
  if (round.ending) { endRound(); return; }
  const [a, b] = pickFact(trivial);
  problem = makeProblem(a, b, false);
  renderRound();
}

function makeProblem(a, b, finalWin) {
  return {
    a, b, answer: a * b,
    options: answerOptions(a * b),
    counted: new Set(),       // which dot-rows tapped
    tries: 0,
    locked: false,
    finalWin,
  };
}

// ---------- star award ----------
function awardStars(n, fromEl) {
  if (!cravingDone() && round && round.mode === todayCraving()) n *= 2;
  const before = stageIndex(state.stars);
  round.starsEarned += n;
  state.stars += n;
  dayBucket().s += n;
  save(state);
  flyStars(n, fromEl);
  if (stageIndex(state.stars) > before) audio.grow(); // dragon leveled up
}

// =================================================================
// RENDERING
// =================================================================
const app = document.getElementById('app');

function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }

function renderHome() {
  round = null;
  tables = null;
  const si = stageIndex(state.stars);
  const prog = Math.round(stageProgress(state.stars) * 100);
  const idle = daysIdle();
  app.innerHTML = '';
  const home = el(`
    <div class="home">
      <div class="topbar">
        <h1 class="title">ספארקי <b>חשבון</b></h1>
        <button class="mute" id="settings" aria-label="אזור הורים">⚙️</button>
        <button class="mute" id="mute" aria-label="${state.muted ? 'הפעלת קול' : 'השתקה'}">${state.muted ? '🔇' : '🔊'}</button>
      </div>
      ${idle !== null && idle > 3 ? `<div class="idle-banner">🐉 ספארקי מתגעגע! לא שיחקת כבר ${idle} ימים</div>` : ''}
      <div class="dragon-wrap">
        ${dragonSVG(si)}
        <div class="dragon-name">${PET}</div>
        <div class="dragon-stage">${STAGES[si].label}</div>
        <div class="progress xpbar"><i style="width:${prog}%"></i></div>
      </div>
      <div class="stars-pill"><span class="star">★</span> ${state.stars}</div>
      ${(()=>{
        const mode = todayCraving();
        const done = cravingDone();
        if (done) return `<div class="craving-bubble craving-bubble--done">😊 תודה שמילאת את הבקשה שלי! ⭐⭐</div>`;
        return `<div class="craving-bubble">💬 אני רוצה לשחק <b>${CRAVING_HE[mode]}</b>! אקבל כוכבים כפולים! ⭐</div>`;
      })()}
      <div class="mode-buttons">
        <button class="btn btn--big btn--teal btn--has-sub${!cravingDone() && CRAVING_HOME_BTN[todayCraving()]==='play-mul' ? ' btn--craving' : ''}" id="play-mul">✖️ לוח הכפל<span class="btn-sub">1×1 עד 10×10</span></button>
        <button class="btn btn--big btn--pink btn--has-sub${!cravingDone() && CRAVING_HOME_BTN[todayCraving()]==='play-geo' ? ' btn--craving' : ''}" id="play-geo">🔷 גיאומטריה<span class="btn-sub">צורות, משולשים, שטח והיקף, מרובעים</span></button>
        <button class="btn btn--big btn--coral btn--has-sub${!cravingDone() && CRAVING_HOME_BTN[todayCraving()]==='play-numbers' ? ' btn--craving' : ''}" id="play-numbers">🔢 מספרים<span class="btn-sub">ראשוני/פריק, גורמים, ציר מספרים</span></button>
        <button class="btn btn--big btn--has-sub${!cravingDone() && CRAVING_HOME_BTN[todayCraving()]==='play-calc' ? ' btn--craving' : ''}" id="play-calc">🖩 חשבון<span class="btn-sub">חילוק ארוך ועם שארית, סדר פעולות</span></button>
        <button class="btn btn--big btn--teal btn--has-sub${!cravingDone() && CRAVING_HOME_BTN[todayCraving()]==='play-fractions' ? ' btn--craving' : ''}" id="play-fractions">🍕 שברים<span class="btn-sub">שברים רגילים, מעורבים ושקילים</span></button>
        <button class="btn btn--big btn--review btn--has-sub" id="play-review">📝 חזרה למבחן<span class="btn-sub">שאלות מסוג מבחן כיתה ה׳ — 5 פגישות</span></button>
      </div>
      <p class="subtitle">משחקים, לומדים — וספארקי גדל!</p>
    </div>
  `);
  app.appendChild(home);
  home.querySelector('#play-mul').onclick = () => renderMultiplicationMenu();
  home.querySelector('#play-geo').onclick = () => renderGeometryMenu();
  home.querySelector('#play-numbers').onclick = () => renderNumbersMenu();
  home.querySelector('#play-calc').onclick = () => renderCalcMenu();
  home.querySelector('#play-fractions').onclick = () => startRound('fractions');
  home.querySelector('#play-review').onclick = () => renderReviewMenu();
  home.querySelector('#mute').onclick = (e) => {
    state.muted = !state.muted;
    save(state);
    e.target.textContent = state.muted ? '🔇' : '🔊';
    e.target.setAttribute('aria-label', state.muted ? 'Unmute' : 'Mute');
    if (!state.muted) { audio.ensure(); audio.pop(); }
  };
  home.querySelector('#settings').onclick = () => renderSettings();
  syncNow(false);   // opportunistic push when the app is opened (if a URL is set)
}

function renderGeometryMenu() {
  app.innerHTML = '';
  const view = el(`
    <div class="home mul-menu">
      <div class="topbar">
        <button class="mute" id="back" aria-label="חזרה">‹</button>
        <h1 class="title">🔷 <b>גיאומטריה</b></h1>
        <span style="width:52px"></span>
      </div>
      ${!cravingDone() && ['shapes','triangles','rect','quads'].includes(todayCraving()) ? `<div class="craving-bubble">💬 ספארקי רוצה <b>${CRAVING_HE[todayCraving()]}</b>! ⭐x2</div>` : ''}
      <div class="mode-buttons mul-mode-buttons">
        <button class="btn btn--big btn--coral${!cravingDone() && todayCraving()==='shapes' ? ' btn--craving' : ''}" id="play-shapes">🔷 צורות</button>
        <button class="btn btn--big${!cravingDone() && todayCraving()==='triangles' ? ' btn--craving' : ''}" id="play-triangles">📐 משולשים</button>
        <button class="btn btn--big btn--teal${!cravingDone() && todayCraving()==='rect' ? ' btn--craving' : ''}" id="play-rect">📏 שטח והיקף</button>
        <button class="btn btn--big btn--purple${!cravingDone() && todayCraving()==='quads' ? ' btn--craving' : ''}" id="play-quads">🔲 תכונות מרובעים</button>
      </div>
    </div>
  `);
  app.appendChild(view);
  view.querySelector('#back').onclick = () => renderHome();
  view.querySelector('#play-shapes').onclick = () => startRound('shapes');
  view.querySelector('#play-triangles').onclick = () => startRound('triangles');
  view.querySelector('#play-rect').onclick = () => startRound('rect');
  view.querySelector('#play-quads').onclick = () => startRound('quads');
}

// ---------- חזרה למבחן — exam review sessions ----------
const REVIEW_SESSION_COUNT = 5;

function buildReviewQueue() {
  // 15 questions per session: 6 fractions, 3 numline, 2 oporder, 2 bignum, 2 factors
  return shuffleInPlace([
    'fractions','fractions','fractions','fractions','fractions','fractions',
    'numline','numline','numline',
    'oporder','oporder',
    'bignum','bignum',
    'factors','factors',
  ]);
}

function makeReviewProblem(finalWin) {
  const idx = round.reviewQueueIdx || 0;
  const type = round.reviewQueue[idx] || 'fractions';
  round.reviewQueueIdx = idx + 1;
  let p;
  if (type === 'fractions') p = makeFractionProblem(finalWin);
  else if (type === 'numline') p = makeNumlineProblem(finalWin);
  else if (type === 'oporder') p = makeOpOrderProblem(finalWin);
  else if (type === 'bignum') p = makeBignumProblem(finalWin);
  else if (type === 'factors') p = makeFactorProblem(finalWin);
  p.reviewType = type;
  return p;
}

function startReview(sessionIdx) {
  audio.ensure();
  const queue = buildReviewQueue();
  round = {
    mode: 'review', reviewMode: true,
    reviewSessionIdx: sessionIdx,
    reviewQueue: queue, reviewQueueIdx: 0,
    index: 0, correctCount: 0, starsEarned: 0,
    wrongStreak: 0, combo: 0, startTs: Date.now(),
    ending: false, recent: [],
  };
  nextProblem(true);
}

function renderReviewMenu() {
  if (!state.review) state.review = {sessions: Array(REVIEW_SESSION_COUNT).fill(0).map(()=>({}))};
  while (state.review.sessions.length < REVIEW_SESSION_COUNT) state.review.sessions.push({});
  app.innerHTML = '';
  const sessions = state.review.sessions;
  const allDone = sessions.every(s=>s.done);
  const cards = sessions.map((s,i) => {
    const done = s.done;
    const icon = done ? '✅' : '▶';
    const stars = done && s.stars ? ` ★${s.stars}` : '';
    return `<button class="btn btn--big review-session-btn${done?' review-done':''}" data-idx="${i}">${icon} פגישה ${i+1}${stars}</button>`;
  }).join('');
  const view = el(`
    <div class="home mul-menu">
      <div class="topbar">
        <button class="mute" id="back" aria-label="חזרה">‹</button>
        <h1 class="title">📝 <b>חזרה למבחן</b></h1>
        <span style="width:52px"></span>
      </div>
      <p class="review-subtitle">כל פגישה — 15 שאלות בערך 5 דקות<br>שאלות מסוג המבחן, מעורבות</p>
      ${allDone ? '<div class="craving-bubble craving-bubble--done">🏆 סיימת את כל הפגישות! כל הכבוד!</div>' : ''}
      <div class="mode-buttons mul-mode-buttons">${cards}</div>
    </div>
  `);
  app.appendChild(view);
  view.querySelector('#back').onclick = () => renderHome();
  view.querySelectorAll('.review-session-btn').forEach(btn => {
    btn.onclick = () => startReview(Number(btn.dataset.idx));
  });
}

function renderReviewComplete(sessionIdx, starsEarned) {
  app.innerHTML = '';
  const nextIdx = sessionIdx + 1;
  const hasNext = nextIdx < REVIEW_SESSION_COUNT;
  const view = el(`
    <div class="end">
      <h2>פגישה ${sessionIdx+1} הושלמה! 🎉</h2>
      <div class="earned">צברת <span class="star">★</span> ${starsEarned} כוכבים!</div>
      <div class="stars-pill"><span class="star">★</span> ${state.stars} בסך הכול</div>
      ${hasNext
        ? `<button class="btn btn--big btn--teal" id="next-review">פגישה ${nextIdx+1} ←</button>`
        : '<p style="font-size:1.3em;margin:12px 0">🏆 סיימת את כל הפגישות!</p>'
      }
      <button class="btn btn--big" id="review-menu">כל הפגישות</button>
      <button class="btn" id="go-home">בית 🏠</button>
    </div>
  `);
  app.appendChild(view);
  if (hasNext) view.querySelector('#next-review').onclick = () => startReview(nextIdx);
  view.querySelector('#review-menu').onclick = () => renderReviewMenu();
  view.querySelector('#go-home').onclick = () => renderHome();
  confetti(40);
}

function renderNumbersMenu() {
  app.innerHTML = '';
  const cr = todayCraving(), done = cravingDone();
  const view = el(`
    <div class="home mul-menu">
      <div class="topbar">
        <button class="mute" id="back" aria-label="חזרה">‹</button>
        <h1 class="title">🔢 <b>מספרים</b></h1>
        <span style="width:52px"></span>
      </div>
      ${!done && ['primes','factors','numline'].includes(cr) ? `<div class="craving-bubble">💬 ספארקי רוצה <b>${CRAVING_HE[cr]}</b>! ⭐x2</div>` : ''}
      <div class="mode-buttons mul-mode-buttons">
        <button class="btn btn--big${!done && cr==='primes' ? ' btn--craving' : ''}" id="play-primes">🧱 מספרים ראשוניים</button>
        <button class="btn btn--big btn--coral${!done && cr==='factors' ? ' btn--craving' : ''}" id="play-factors">🔍 פירוק לגורמים</button>
        <button class="btn btn--big btn--teal${!done && cr==='numline' ? ' btn--craving' : ''}" id="play-numline">📏 ציר מספרים</button>
      </div>
    </div>
  `);
  app.appendChild(view);
  view.querySelector('#back').onclick = () => renderHome();
  view.querySelector('#play-primes').onclick = () => startRound('primes');
  view.querySelector('#play-factors').onclick = () => startRound('factors');
  view.querySelector('#play-numline').onclick = () => startRound('numline');
}

function renderCalcMenu() {
  app.innerHTML = '';
  const cr = todayCraving(), done = cravingDone();
  const view = el(`
    <div class="home mul-menu">
      <div class="topbar">
        <button class="mute" id="back" aria-label="חזרה">‹</button>
        <h1 class="title">🖩 <b>חשבון</b></h1>
        <span style="width:52px"></span>
      </div>
      ${!done && ['division','oporder','bignum'].includes(cr) ? `<div class="craving-bubble">💬 ספארקי רוצה <b>${CRAVING_HE[cr]}</b>! ⭐x2</div>` : ''}
      <div class="mode-buttons mul-mode-buttons">
        <button class="btn btn--big btn--coral btn--has-sub${!done && cr==='division' ? ' btn--craving' : ''}" id="play-division">➗ חילוק<span class="btn-sub">לחץ לבחירת רמה</span></button>
        <button class="btn btn--big btn--pink${!done && cr==='oporder' ? ' btn--craving' : ''}" id="play-oporder">🔢 סדר פעולות</button>
        <button class="btn btn--big${!done && cr==='bignum' ? ' btn--craving' : ''}" id="play-bignum">🔭 מספרים גדולים</button>
      </div>
    </div>
  `);
  app.appendChild(view);
  view.querySelector('#back').onclick = () => renderHome();
  view.querySelector('#play-division').onclick = () => renderDivisionMenu();
  view.querySelector('#play-oporder').onclick = () => startRound('oporder');
  view.querySelector('#play-bignum').onclick = () => startRound('bignum');
}

function renderDivisionMenu() {
  app.innerHTML = '';
  const view = el(`
    <div class="home mul-menu">
      <div class="topbar">
        <button class="mute" id="back" aria-label="חזרה">‹</button>
        <h1 class="title">➗ <b>חילוק</b></h1>
        <span style="width:52px"></span>
      </div>
      <div class="mode-buttons mul-mode-buttons">
        <button class="btn btn--big btn--coral btn--has-sub" id="div-all">🌀 הכל מעורב<span class="btn-sub">כל הרמות, מגוון</span></button>
        <button class="btn btn--big btn--has-sub" id="div-basic">✖️ חילוק בסיסי<span class="btn-sub">לוח הכפל הפוך, עד 10×10</span></button>
        <button class="btn btn--big btn--teal btn--has-sub" id="div-long">📏 חילוק ארוך<span class="btn-sub">2-3 ספרות, חילוק עם שלבים</span></button>
        <button class="btn btn--big btn--pink btn--has-sub" id="div-rem">➗ חילוק עם שארית<span class="btn-sub">מנה ושארית</span></button>
      </div>
    </div>
  `);
  app.appendChild(view);
  view.querySelector('#back').onclick = () => renderCalcMenu();
  view.querySelector('#div-all').onclick   = () => startRound('division', {divFilter: 'all'});
  view.querySelector('#div-basic').onclick = () => startRound('division', {divFilter: 'basic'});
  view.querySelector('#div-long').onclick  = () => startRound('division', {divFilter: 'long'});
  view.querySelector('#div-rem').onclick   = () => startRound('division', {divFilter: 'remainder'});
}

function renderMultiplicationMenu() {
  app.innerHTML = '';
  const view = el(`
    <div class="home mul-menu">
      <div class="topbar">
        <button class="mute" id="back" aria-label="חזרה">‹</button>
        <h1 class="title">✖️ <b>כפל</b></h1>
        <span style="width:52px"></span>
      </div>
      ${!cravingDone() && ['count','pop','tables','drill'].includes(todayCraving()) ? `<div class="craving-bubble">💬 ספארקי רוצה <b>${CRAVING_HE[todayCraving()]}</b>! ⭐x2</div>` : ''}
      <div class="mode-buttons mul-mode-buttons">
        <button class="btn btn--big btn--teal${!cravingDone() && todayCraving()==='count' ? ' btn--craving' : ''}" id="play-count">🔢 כפל בנקודות</button>
        <button class="btn btn--big btn--pink${!cravingDone() && todayCraving()==='pop' ? ' btn--craving' : ''}" id="play-pop">⚡ בועות מהירות</button>
        <button class="btn btn--big${!cravingDone() && todayCraving()==='tables' ? ' btn--craving' : ''}" id="play-tables">🏆 לוח הכפל</button>
        <button class="btn btn--big btn--coral${!cravingDone() && todayCraving()==='drill' ? ' btn--craving' : ''}" id="play-drill">🏅 אלוף המספרים</button>
      </div>
    </div>
  `);
  app.appendChild(view);
  view.querySelector('#back').onclick = () => renderHome();
  view.querySelector('#play-count').onclick = () => startRound('count');
  view.querySelector('#play-pop').onclick = () => startRound('pop');
  view.querySelector('#play-tables').onclick = () => startTables(state.tablesLevel || 1);
  view.querySelector('#play-drill').onclick = () => renderTablePicker();
}

// ---------- number drill (per-number table trainer, multi-select) ----------
const DRILL_TIME = 10000; // ms per question
const DRILL_FAST = 5000;  // ms threshold for "fast" answer
const TILE_COLORS = ['btn--teal','btn--pink','btn--coral','','btn--teal','btn--pink','btn--coral','','btn--teal','btn--pink'];
const PREVIEW_COLORS = ['#ff5db1','#7b4dff','#21c1a6','#ff9a3d','#ffd23f','#ff5db1','#7b4dff','#21c1a6','#ff9a3d','#ffd23f'];

function drillKey(n, k) { return n + 'x' + k; }

function drillTableOptions(n, answer) {
  const all = Array.from({length: 10}, (_, i) => n * (i + 1));
  const wrong = all.filter(x => x !== answer);
  for (let i = wrong.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [wrong[i], wrong[j]] = [wrong[j], wrong[i]]; }
  const opts = [answer, ...wrong.slice(0, 3)];
  for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }
  return opts;
}

function renderTablePicker() {
  round = null; drill = null;
  app.innerHTML = '';
  const selected = new Set();
  const tiles = Array.from({length: 10}, (_, i) => {
    const n = i + 1;
    return `<button class="btn number-tile ${TILE_COLORS[i]}" data-n="${n}">${n}<span class="tile-x">×</span></button>`;
  }).join('');
  const view = el(`
    <div class="home mul-menu">
      <div class="topbar">
        <button class="mute" id="back" aria-label="חזרה">‹</button>
        <h1 class="title">🏅 <b>אלוף המספרים</b></h1>
        <span style="width:52px"></span>
      </div>
      <p class="subtitle" style="margin:0 0 4px">בחרי מספרים לאימון:</p>
      <div class="number-picker">${tiles}</div>
      <button class="btn btn--big btn--teal" id="go" style="width:100%;max-width:340px;display:none">התחילי! ▶</button>
    </div>
  `);
  app.appendChild(view);
  const goBtn = view.querySelector('#go');
  view.querySelector('#back').onclick = () => renderMultiplicationMenu();
  view.querySelectorAll('[data-n]').forEach(btn => {
    btn.onclick = () => {
      const n = parseInt(btn.dataset.n, 10);
      if (selected.has(n)) { selected.delete(n); btn.classList.remove('tile--selected'); }
      else { selected.add(n); btn.classList.add('tile--selected'); }
      const nums = [...selected].sort((a,b) => a-b);
      if (nums.length === 0) { goBtn.style.display = 'none'; }
      else { goBtn.style.display = ''; goBtn.textContent = `התחילי! ▶  (${nums.join(', ')}×)`; }
    };
  });
  goBtn.onclick = () => startTableDrill([...selected].sort((a,b) => a-b));
}

function startTableDrill(nums) {
  audio.ensure();
  // Build queue of {n,k} pairs for all selected numbers, shuffled together
  const pairs = [];
  nums.forEach(n => { for (let k = 1; k <= 10; k++) pairs.push({n, k}); });
  for (let i = pairs.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pairs[i], pairs[j]] = [pairs[j], pairs[i]]; }
  drill = { nums, queue: pairs, results: {}, perfect: true, starsEarned: 0, total: pairs.length };
  round = { mode: 'drill', starsEarned: 0 };
  renderDrillPreview(nums);
}

function renderDrillPreview(nums) {
  app.innerHTML = '';
  // For each number, show its full table grouped
  const sections = nums.map(n => {
    const rows = Array.from({length: 10}, (_, i) => {
      const k = i + 1;
      return `<div class="drill-preview-row" style="background:${PREVIEW_COLORS[i]}">${n} × ${k} = <b>${n * k}</b></div>`;
    }).join('');
    return `<div class="drill-preview-group"><div class="drill-preview-label">לוח ${n}</div>${rows}</div>`;
  }).join('');
  const title = nums.length === 1 ? `✨ לוח ${nums[0]}` : `✨ לוחות ${nums.join(' + ')}`;
  const view = el(`
    <div class="round drill-preview-screen">
      <div class="topbar">
        <button class="mute" id="back" aria-label="חזרה">‹</button>
        <h2 class="title" style="font-size:clamp(20px,4vh,32px)">${title}</h2>
        <span style="width:52px"></span>
      </div>
      <div class="drill-preview-table">${sections}</div>
      <button class="btn btn--big btn--teal" id="go">בואי נתחיל! ▶</button>
    </div>
  `);
  app.appendChild(view);
  view.querySelector('#back').onclick = () => renderTablePicker();
  view.querySelector('#go').onclick = () => renderDrillQuestion();
}

function renderDrillQuestion() {
  if (!drill || drill.queue.length === 0) { renderDrillEnd(); return; }
  const { queue, results, total } = drill;
  const { n, k } = queue[0];
  const answer = n * k;
  const opts = drillTableOptions(n, answer);
  const done = Object.keys(results).length;

  clearDrillTimer();
  app.innerHTML = '';
  const view = el(`
    <div class="round">
      <div class="topbar">
        <button class="mute" id="back" aria-label="חזרה">‹</button>
        <div class="drill-progress">${done}/${total}</div>
        <span style="width:52px"></span>
      </div>
      <div class="timer-bar"><i id="drill-timer-i" style="width:100%;transition:width ${DRILL_TIME}ms linear"></i></div>
      <div class="stage">
        <div class="drill-question">${n} × ${k} = ?</div>
      </div>
      <div class="answers">
        ${opts.map(o => `<button class="btn btn--ghost answer-btn" data-val="${o}">${o}</button>`).join('')}
      </div>
    </div>
  `);
  app.appendChild(view);
  view.querySelector('#back').onclick = () => { clearDrillTimer(); renderTablePicker(); };
  drill.questionStart = Date.now();
  requestAnimationFrame(() => { const ti = view.querySelector('#drill-timer-i'); if (ti) ti.style.width = '0%'; });
  drill._timer = setTimeout(() => onDrillAnswer(false, false, n, k, answer, null), DRILL_TIME);
  view.querySelectorAll('.answer-btn').forEach(btn => {
    btn.onclick = () => {
      const chosen = parseInt(btn.dataset.val, 10);
      onDrillAnswer(chosen === answer, Date.now() - drill.questionStart < DRILL_FAST, n, k, answer, btn);
    };
  });
}

function clearDrillTimer() {
  if (drill && drill._timer) { clearTimeout(drill._timer); drill._timer = null; }
}

function onDrillAnswer(correct, fast, n, k, answer, fromEl) {
  clearDrillTimer();
  if (!drill) return;
  app.querySelectorAll('.answer-btn').forEach(b => {
    b.disabled = true;
    if (parseInt(b.dataset.val, 10) === answer) b.classList.add('correct');
    else if (!correct && b === fromEl) b.classList.add('wrong');
  });
  const rk = drillKey(n, k);
  if (correct) {
    audio.correct();
    const alreadyWrong = drill.results[rk] === 'wrong';
    drill.results[rk] = alreadyWrong ? 'retry-ok' : (fast ? 'fast' : 'slow');
    drill.queue.shift();
    let stars = alreadyWrong ? 1 : (fast ? 3 : 1);
    if (!cravingDone() && todayCraving() === 'drill') stars *= 2;
    drill.starsEarned += stars; round.starsEarned += stars;
    state.stars += stars; dayBucket().s += stars; save(state);
    if (fromEl) flyStars(stars, fromEl);
    recordAttempt(n, k, true, alreadyWrong ? 1 : 0);
    recordTopic('drill', alreadyWrong ? 1 : 0, true);
    recordActivity(true, alreadyWrong ? 1 : 0);
    setTimeout(() => renderDrillQuestion(), 600);
  } else {
    audio.wrong();
    drill.perfect = false;
    if (!drill.results[rk]) drill.results[rk] = 'wrong';
    drill.queue.shift(); drill.queue.push({n, k});
    recordAttempt(n, k, false, 1);
    recordTopic('drill', 1, false);
    recordActivity(false, 1);
    setTimeout(() => renderDrillQuestion(), 800);
  }
}

function renderDrillEnd() {
  if (drill && drill.perfect) {
    let bonus = 5;
    if (!cravingDone() && todayCraving() === 'drill') bonus = 10;
    drill.starsEarned += bonus; round.starsEarned += bonus;
    state.stars += bonus; dayBucket().s += bonus; save(state);
  }
  satisfyCraving('drill');
  state.lastPlayed = Date.now(); save(state); syncNow(true);
  const { nums, results, starsEarned, perfect } = drill;
  const si = stageIndex(state.stars);
  // Build summary grouped by number
  const summaryGroups = nums.map(n => {
    const rows = Array.from({length: 10}, (_, i) => {
      const k = i + 1;
      const r = results[drillKey(n, k)];
      const icon = r === 'fast' ? '✅' : r === 'slow' ? '⚡' : r === 'retry-ok' ? '🔁' : '❓';
      const cls = r === 'fast' ? 'drill-fast' : r === 'slow' ? 'drill-slow' : r === 'retry-ok' ? 'drill-retry' : '';
      return `<div class="drill-row ${cls}">${icon} ${n} × ${k} = <b>${n * k}</b></div>`;
    }).join('');
    return nums.length > 1 ? `<div class="drill-group-label">לוח ${n}</div>${rows}` : rows;
  }).join('');
  app.innerHTML = '';
  const end = el(`
    <div class="end">
      <h2>${perfect ? '🏆 מושלם!' : 'כל הכבוד! 🎉'}</h2>
      <div class="drill-table-summary">${summaryGroups}</div>
      <div class="earned">צברת <span class="star">★</span> ${starsEarned} הפעם${perfect ? ' (+5 בונוס!)' : ''}</div>
      <div class="stars-pill"><span class="star">★</span> ${state.stars} בסך הכול</div>
      <div class="drill-end-buttons">
        <button class="btn btn--big btn--teal" id="again">שוב! 🔁</button>
        <button class="btn btn--big btn--pink" id="pick">בחרי מספר</button>
      </div>
    </div>
  `);
  app.appendChild(end);
  end.querySelector('#again').onclick = () => startTableDrill(nums);
  end.querySelector('#pick').onclick = () => renderTablePicker();
  confetti(perfect ? 55 : 35);
}

// ---------- parent area (progress + sync setup) ----------
function renderSettings() {
  round = null;
  const w = weekStats();
  const idle = daysIdle();
  const struggle = topicStruggle();
  const weak = weakestFacts(6);
  const idleText = idle === null ? 'No practice yet'
    : idle === 0 ? 'Practiced today 🎉'
    : `${idle} day${idle === 1 ? '' : 's'} since last practice`;
  app.innerHTML = '';
  const view = el(`
    <div class="settings">
      <div class="topbar">
        <button class="mute" id="back" aria-label="Back">‹</button>
        <h2 class="title settings-title">Parent area</h2>
      </div>
      <div class="parent-scroll">
        <div class="stat-card">
          <h3>This week</h3>
          <div class="stat-row"><b>${w.daysPracticed}/7</b> days · <b>${w.answered}</b> questions · <b>${w.accuracy}%</b> first-try · <span class="star">★</span> ${w.stars}</div>
          <div class="stat-sub ${idle !== null && idle > 3 ? 'warn' : ''}">${idleText} · ${w.mistakes} slip-ups this week</div>
        </div>
        <div class="stat-card">
          <h3>Where she struggles most</h3>
          ${struggle.length ? '<ul class="struggle">' + struggle.slice(0, 5).map((t) =>
            `<li><span>${t.topic}</span><span>${t.missPerQ} slips/question · ${t.firstTry}% first-try</span></li>`).join('') + '</ul>'
            : '<p class="muted">Not enough data yet — play a few rounds.</p>'}
          ${weak.length ? '<div class="weak-facts">Hardest facts: ' + weak.map((f) => `${f.fact}`).join(', ') + '</div>' : ''}
        </div>
        <label class="fld">Child's name (optional)
          <input id="child" type="text" value="${escAttr(state.childName)}" placeholder="e.g. Maya" />
        </label>
        <label class="fld">Parent sync URL — for the weekly email + 3-day idle alert
          <input id="syncurl" type="url" value="${escAttr(state.syncUrl)}" placeholder="https://script.google.com/macros/s/…/exec" inputmode="url" />
        </label>
        <div class="settings-actions">
          <button class="btn btn--teal" id="save">Save</button>
          <button class="btn btn--ghost" id="test">Send test</button>
        </div>
        <div class="hint" id="shint"></div>
        <div class="settings-actions" style="margin-top:24px;border-top:1px solid #ece4ff;padding-top:16px">
          <button class="btn btn--danger" id="resetAll">Reset all progress</button>
        </div>
        <div class="hint" id="rhint"></div>
        <div class="setup-help">
          <b>To get the emails — one-time setup (~10 min):</b>
          <ol>
            <li><a href="https://script.google.com" target="_blank" rel="noopener">Open Google Apps Script</a> → <i>New project</i>.</li>
            <li><a href="https://raw.githubusercontent.com/amirhoresh/dragonmath/master/parent-sync/Code.gs" target="_blank" rel="noopener">Copy the script code</a> → paste it in, set your email near the top.</li>
            <li><i>Run ▸ setup</i> (approve the prompts) → <i>Deploy ▸ New deployment ▸ Web app</i> (Execute as <b>Me</b>, access <b>Anyone</b>) → copy the <code>…/exec</code> URL.</li>
            <li>Paste that URL above → <b>Save</b> → <b>Send test</b>. A test email should arrive in a minute.</li>
          </ol>
          Then you'll get a weekly review + an alert after 3 idle days. Nothing else leaves the device.
        </div>
      </div>
    </div>
  `);
  app.appendChild(view);
  view.querySelector('#back').onclick = () => renderHome();
  view.querySelector('#save').onclick = () => {
    state.childName = view.querySelector('#child').value.trim().slice(0, 40);
    state.syncUrl = view.querySelector('#syncurl').value.trim();
    save(state);
    view.querySelector('#shint').textContent = 'Saved ✓';
  };
  view.querySelector('#resetAll').onclick = () => {
    const rhint = view.querySelector('#rhint');
    if (rhint.dataset.confirm !== '1') {
      rhint.textContent = 'Are you sure? Tap again to erase everything.';
      rhint.dataset.confirm = '1';
      return;
    }
    const syncUrl = state.syncUrl;
    const childName = state.childName;
    state = defaultSave();
    state.syncUrl = syncUrl;
    state.childName = childName;
    save(state);
    renderHome();
  };
  view.querySelector('#test').onclick = () => {
    state.childName = view.querySelector('#child').value.trim().slice(0, 40);
    state.syncUrl = view.querySelector('#syncurl').value.trim();
    save(state);
    const shint = view.querySelector('#shint');
    if (!state.syncUrl) { shint.textContent = 'Paste your sync URL first.'; return; }
    if (!navigator.onLine) { shint.textContent = 'You are offline — connect and try again.'; return; }
    syncNow(true, true);
    shint.textContent = 'Test sent ✓ — check your email in a minute.';
  };
}

function roundTopbar() {
  const left = Math.max(0, ROUND.maxProblems - round.index);
  const pct = (round.index / ROUND.maxProblems) * 100;
  const combo = round.combo >= 2 ? `<div class="combo">🔥 ×${round.combo}</div>` : '';
  return `
    <div class="topbar">
      <div class="left-count">${left} left</div>
      <div class="progress"><i style="width:${pct}%"></i></div>
      ${combo}
      <button class="mute" id="round-back" aria-label="חזרה">›</button>
    </div>`;
}

// size the dot array to fit BOTH the width and height of its stage box (never scroll)
function sizeDots(stage, dots, a, b) {
  if (!stage || !dots) return;
  const W = stage.clientWidth, H = stage.clientHeight;
  if (!W || !H) return;
  const ROW_TAG = 38, ROW_PADX = 20, MAX_DOT = 30, MIN_DOT = 4;
  const gap = b > 6 ? 6 : 10;
  const rgap = a > 6 ? 5 : 8;  // row gap (tighter for tall grids)
  const rowPadY = 4;           // .dot-row vertical padding total
  const byW = (Math.min(W, 540) - ROW_TAG - ROW_PADX - (b - 1) * gap) / b;
  const byH = (H - (a - 1) * rgap) / a - rowPadY;
  let dot = Math.floor(Math.min(byW, byH));
  dot = Math.max(MIN_DOT, Math.min(MAX_DOT, dot));
  dots.style.setProperty('--dot', dot + 'px');
  dots.style.setProperty('--gap', gap + 'px');
  dots.style.setProperty('--rgap', rgap + 'px');
}

function renderRound() {
  if (round.mode === 'triangles') return renderTriangles();
  if (round.mode === 'shapes') return renderShapes();
  if (round.mode === 'rect') return renderRect();
  if (round.mode === 'quads') return renderQuad();
  if (round.mode === 'factors') return renderFactors();
  if (round.mode === 'numline') return renderNumline();
  if (round.mode === 'oporder') return renderOpOrder();
  if (round.mode === 'bignum') return renderBignum();
  if (round.mode === 'review') {
    const rt = problem.reviewType;
    if (rt === 'fractions') return renderFractions();
    if (rt === 'numline')   return renderNumline();
    if (rt === 'oporder')   return renderOpOrder();
    if (rt === 'bignum')    return renderBignum();
    if (rt === 'factors')   return renderFactors();
  }
  if (round.mode === 'division') return renderDivision();
  if (round.mode === 'primes') return renderPrimes();
  if (round.mode === 'fractions') return renderFractions();
  if (round.mode === 'pop') return renderBubblePop();
  return renderBuildCount();
}

// After a reveal, wait for a tap so she has time to read the answer.
function showContinue() {
  const view = document.querySelector('.round');
  if (!view || view.querySelector('#continue')) return;
  const b = el('<button class="btn btn--big continue" id="continue">המשך ▶</button>');
  b.onclick = () => nextProblem(false);
  view.appendChild(b);
}

// ---------- paint-to-count helper (shared by Count & Learn and Division) ----------
// No dots by default — she calculates from memory. If stuck, she taps "paint",
// then taps each ROW to fill it; the row tag skip-counts (b, 2b, 3b…).
function buildPaintStage(stage, rows, cols) {
  stage.innerHTML = '';
  const btn = el('<button class="btn btn--ghost paint-btn">🎨 צבעי את הנקודות</button>');
  btn.onclick = () => paintGrid(stage, rows, cols);
  stage.appendChild(btn);
}
function paintGrid(stage, rows, cols) {
  stage.innerHTML = '<div class="dots" id="dots"></div>';
  const dots = stage.querySelector('#dots');
  let filled = 0;
  for (let r = 0; r < rows; r++) {
    const row = el(`<div class="dot-row paintable" style="grid-template-columns:repeat(${cols},var(--dot)) auto"></div>`);
    for (let c = 0; c < cols; c++) row.appendChild(el('<span class="dot"></span>'));
    const tag = el('<span class="row-tag"></span>');
    row.appendChild(tag);
    row.onclick = () => {
      if (problem.locked || row.classList.contains('counted')) return;
      row.classList.add('counted');
      filled++;
      tag.textContent = filled * cols;
      audio.pop();
    };
    dots.appendChild(row);
  }
  requestAnimationFrame(() => sizeDots(stage, dots, rows, cols));
}
// full filled grid with cumulative tags — used on the answer reveal
function revealFullGrid(stage, rows, cols) {
  stage.innerHTML = '<div class="dots" id="dots"></div>';
  const dots = stage.querySelector('#dots');
  for (let r = 0; r < rows; r++) {
    const row = el(`<div class="dot-row counted" style="grid-template-columns:repeat(${cols},var(--dot)) auto"></div>`);
    for (let c = 0; c < cols; c++) row.appendChild(el('<span class="dot"></span>'));
    row.appendChild(el(`<span class="row-tag">${(r + 1) * cols}</span>`));
    dots.appendChild(row);
  }
  requestAnimationFrame(() => sizeDots(stage, dots, rows, cols));
}

function renderBuildCount() {
  const p = problem;
  app.innerHTML = '';
  const view = el(`
    <div class="round">
      ${roundTopbar()}
      <div class="prompt-card">
        <p class="prompt-text">${p.a === 1 ? 'קבוצה אחת' : `<span class="a">${p.a}</span> קבוצות`} של <span class="b">${p.b}</span> = ?</p>
        <div class="running" id="running">${p.finalWin ? 'עוד אחת — את יכולה! ⭐' : 'כמה זה ביחד? אם צריך — צבעי לספור'}</div>
      </div>
      <div class="stage"></div>
      <div class="hint" id="hint"></div>
      <div class="answers" id="answers"></div>
    </div>
  `);
  app.appendChild(view);
  buildPaintStage(view.querySelector('.stage'), p.a, p.b);

  const answers = view.querySelector('#answers');
  p.options.forEach((opt) => {
    const b = el(`<button class="btn answer">${opt}</button>`);
    b.onclick = (e) => chooseAnswer(opt, b);
    answers.appendChild(b);
  });
}

// shared scoring — used by both Build & Count and Bubble Pop
function commitCorrect(p, fromEl) {
  p.locked = true;
  if (p.a && p.b) recordAttempt(p.a, p.b, p.tries === 0, p.tries);
  recordActivity(p.tries === 0, p.tries);   // day.c counts first-try-correct
  recordTopic(round.mode, p.tries, true);
  round.correctCount++;
  round.wrongStreak = 0;
  round.combo = p.tries === 0 ? round.combo + 1 : 0;
  const gained = p.tries === 0 ? 5 : 2;
  awardStars(gained, fromEl);
  audio.correct();
  confetti();
  round.index++;
}
function commitWrongReveal(p) {
  p.locked = true;
  if (p.a && p.b) recordAttempt(p.a, p.b, false, p.tries);
  recordActivity(false, p.tries);
  recordTopic(round.mode, p.tries, false);
  round.wrongStreak++;
  round.combo = 0;
  round.index++;
}

function chooseAnswer(opt, btn) {
  const p = problem;
  if (p.locked) return;
  const hint = document.getElementById('hint');

  if (opt === p.answer) {
    btn.classList.add('correct');
    const firstTry = p.tries === 0;
    commitCorrect(p, btn);
    hint.textContent = firstTry ? 'כל הכבוד! ⭐⭐⭐' : 'יפה! ⭐';
    setTimeout(() => nextProblem(false), 850);
  } else {
    p.tries++;
    audio.wrong();
    btn.classList.add('wrong');
    setTimeout(() => btn.classList.remove('wrong'), 350);
    if (p.tries >= 2) {
      hint.textContent = `התשובה היא ${p.answer}. זה ${p.a === 1 ? 'שורה אחת' : `${p.a} שורות`} של ${p.b}.`;
      revealFullGrid(document.querySelector('.round .stage'), p.a, p.b);
      commitWrongReveal(p);
      showContinue();
    } else {
      hint.textContent = 'כמעט! עוד ניסיון אחד';
    }
  }
}

// ---------- Bubble Pop ----------
function renderBubblePop() {
  const p = problem;
  app.innerHTML = '';
  const view = el(`
    <div class="round">
      ${roundTopbar()}
      <div class="prompt-card">
        <p class="prompt-text"><span class="a">${p.a}</span> × <span class="b">${p.b}</span> = ?</p>
        <div class="running">${p.finalWin ? 'עוד אחת — את יכולה! ⭐' : 'פוצצי את התשובה הנכונה!'}</div>
      </div>
      <div class="pool" id="pool"></div>
      <div class="hint" id="hint"></div>
    </div>
  `);
  app.appendChild(view);
  const pool = view.querySelector('#pool');
  requestAnimationFrame(() => spawnBubbles(pool));
}

function spawnBubbles(pool) {
  const p = problem;
  const H = pool.clientHeight || 360;
  const n = p.options.length;
  p.options.forEach((val, i) => {
    const color = COLORS[(i + 1) % COLORS.length];
    const b = el(`<button class="bubble">${val}</button>`);
    b.style.left = (6 + i * (88 / n)) + '%';
    b.style.background = `radial-gradient(circle at 32% 30%, rgba(255,255,255,.5), transparent 62%), ${color}`;
    pool.appendChild(b);
    if (!reduce) {
      const dist = H + 130;
      const dur = 4200 + i * 350 + Math.random() * 900;
      b.__anim = b.animate(
        [{ transform: 'translateY(0)' }, { transform: `translateY(-${dist}px)` }],
        { duration: dur, iterations: Infinity, easing: 'linear', delay: i * 250 }
      );
    } else {
      // reduced motion: place bubbles statically, spread vertically
      b.style.bottom = (20 + i * 70) + 'px';
    }
    b.onclick = () => popBubble(b, val, pool);
  });
}

function stopBubbles(pool) {
  [...pool.querySelectorAll('.bubble')].forEach((b) => b.__anim && b.__anim.pause());
}

function popBubble(b, val, pool) {
  const p = problem;
  if (p.locked) return;
  const hint = document.getElementById('hint');

  if (val === p.answer) {
    const firstTry = p.tries === 0;
    audio.pop();
    b.classList.add('correct');
    stopBubbles(pool);
    commitCorrect(p, b);
    hint.textContent = firstTry ? `בּוּם! 🔥 ${p.a}×${p.b}=${p.answer}` : `יפה! ${p.answer}`;
    setTimeout(() => nextProblem(false), 800);
  } else {
    p.tries++;
    audio.wrong();
    b.classList.add('wrong');
    if (b.__anim) b.__anim.cancel();
    setTimeout(() => b.remove(), 220);
    if (p.tries >= 2) {
      stopBubbles(pool);
      [...pool.querySelectorAll('.bubble')].forEach((x) => {
        if (parseInt(x.textContent, 10) === p.answer) x.classList.add('correct');
      });
      hint.textContent = `התשובה היא ${p.answer}.  ${p.a} × ${p.b} = ${p.answer}`;
      commitWrongReveal(p);
      showContinue();
    } else {
      hint.textContent = 'לא זו — נסי שוב!';
    }
  }
}

function revealAllRows() {
  const p = problem;
  const rows = [...document.querySelectorAll('.dot-row')];
  let count = 0;
  rows.forEach((row, i) => {
    row.classList.add('counted');
    count += p.b;
    row.querySelector('.row-tag').textContent = count;
  });
}

// ====================== DIVISION GAME ======================
// Inverse of the times tables, no remainders. "Split N dots into R equal rows —
// how many in each row?" Reuses the Build & Count dot array + reveal.
function makeDivisionProblem(finalWin) {
  const easy = finalWin || round.index === 0;

  // subtypes: basic(×-table), medium(quotient 11-19), long(quotient 21-49, 3-digit),
  //           xlarge(4-digit ÷ 1-digit), div2(3-digit ÷ 2-digit), remainder(with שארית)
  const divFilter = round.divFilter || 'all';
  let divType = 'basic';
  if (!easy) {
    if (divFilter === 'basic') {
      divType = 'basic';
    } else if (divFilter === 'long') {
      const r = rand();
      divType = r < 0.25 ? 'medium' : r < 0.55 ? 'long' : r < 0.78 ? 'xlarge' : 'div2';
    } else if (divFilter === 'remainder') {
      divType = 'remainder';
    } else {
      // 'all' — weighted mix
      const r = rand();
      if      (r < 0.30) divType = 'basic';
      else if (r < 0.48) divType = 'medium';
      else if (r < 0.63) divType = 'long';
      else if (r < 0.76) divType = 'xlarge';
      else if (r < 0.88) divType = 'div2';
      else               divType = 'remainder';
    }
  }

  if (divType === 'medium') {
    for (let t = 0; t < 20; t++) {
      const q = 11 + Math.floor(rand() * 9); // 11..19
      const d = 2 + Math.floor(rand() * 8);  // 2..9
      const key = 'dvm:' + d + '/' + q;
      if (t === 19 || !recentHas(key, 6)) {
        remember(key);
        return { divType, kind: 'div', a: d, dividend: d * q, answer: q, options: answerOptions(q, 4), tries: 0, locked: false, finalWin };
      }
    }
  }

  if (divType === 'long') {
    for (let t = 0; t < 20; t++) {
      const q = 21 + Math.floor(rand() * 29); // 21..49
      const d = 2 + Math.floor(rand() * 8);
      const key = 'dvl:' + d + '/' + q;
      if (t === 19 || !recentHas(key, 6)) {
        remember(key);
        return { divType, kind: 'div', a: d, dividend: d * q, answer: q, options: answerOptions(q, 6), tries: 0, locked: false, finalWin };
      }
    }
  }

  if (divType === 'xlarge') {
    // 4-digit dividend ÷ 1-digit, quotient 100..499
    for (let t = 0; t < 20; t++) {
      const q = 101 + Math.floor(rand() * 399); // 101..499, always 3-digit
      const d = 2 + Math.floor(rand() * 8);
      if (d * q > 9999) continue; // keep 4-digit
      const key = 'dvx:' + d + '/' + q;
      if (t === 19 || !recentHas(key, 6)) {
        remember(key);
        return { divType, kind: 'div', a: d, dividend: d * q, answer: q, options: answerOptions(q, 20), tries: 0, locked: false, finalWin };
      }
    }
  }

  if (divType === 'div2') {
    // 3-digit ÷ 2-digit, divisor 12..25, quotient 8..18
    for (let t = 0; t < 20; t++) {
      const d = 12 + Math.floor(rand() * 14); // 12..25
      const q = 8  + Math.floor(rand() * 11); // 8..18
      const key = 'dv2:' + d + '/' + q;
      if (t === 19 || !recentHas(key, 6)) {
        remember(key);
        return { divType, kind: 'div', a: d, dividend: d * q, answer: q, options: answerOptions(q, 4), tries: 0, locked: false, finalWin };
      }
    }
  }

  if (divType === 'remainder') {
    // dividend ÷ divisor = quotient שארית remainder
    for (let t = 0; t < 20; t++) {
      const d = 3 + Math.floor(rand() * 7);  // 3..9
      const q = 5 + Math.floor(rand() * 16); // 5..20
      const r = 1 + Math.floor(rand() * (d - 1)); // 1..d-1
      const dvd = d * q + r;
      if (dvd > 199) continue;
      const key = 'dvr:' + d + '/' + q + '+' + r;
      if (t === 19 || !recentHas(key, 6)) {
        remember(key);
        const answer = `${q} שארית ${r}`;
        return { divType, kind: 'div', a: d, dividend: dvd, answer, quotientNum: q, remainderNum: r,
          options: remainderOptions(q, r, d), tries: 0, locked: false, finalWin };
      }
    }
  }

  // basic: weight by ×-fact weakness
  let divisor, quotient;
  if (easy) {
    divisor = 2 + Math.floor(rand() * 2);
    quotient = 2 + Math.floor(rand() * 3);
  } else {
    const pool = [];
    for (let d = 2; d <= 10; d++) for (let q = 2; q <= 10; q++) pool.push([d, q]);
    const weights = pool.map(([d, q]) => factWeight(d, q));
    const total = weights.reduce((x, y) => x + y, 0);
    for (let t = 0; t < 20; t++) {
      let r = rand() * total, pick = pool[pool.length - 1];
      for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) { pick = pool[i]; break; } }
      [divisor, quotient] = pick;
      if (t === 19 || !recentHas('dv:' + divisor + '/' + quotient, 8)) break;
    }
  }
  remember('dv:' + divisor + '/' + quotient);
  return {
    divType: 'basic', kind: 'div', a: divisor, b: quotient, dividend: divisor * quotient,
    answer: quotient, options: answerOptions(quotient),
    tries: 0, locked: false, finalWin,
  };
}

function remainderOptions(q, r, divisor) {
  const correct = `${q} שארית ${r}`;
  const tried = new Set([correct]);
  const opts = [correct];
  let guard = 0;
  while (opts.length < 4 && guard++ < 60) {
    const dq = Math.floor(rand() * 5) - 2; // -2..2
    const dr = Math.floor(rand() * 5) - 2;
    if (dq === 0 && dr === 0) continue;
    const wq = q + dq, wr = r + dr;
    if (wq < 1 || wr <= 0 || wr >= divisor) continue;
    const s = `${wq} שארית ${wr}`;
    if (!tried.has(s)) { tried.add(s); opts.push(s); }
  }
  // fallback: vary q only
  for (let i = 1; opts.length < 4; i++) {
    const s = `${q + i * 2} שארית ${r}`;
    if (!tried.has(s)) { tried.add(s); opts.push(s); }
  }
  return shuffleInPlace(opts);
}

function renderDivision() {
  const p = problem;
  if (p.divType !== 'basic') return renderDivAdvanced();
  app.innerHTML = '';
  const view = el(`
    <div class="round">
      ${roundTopbar()}
      <div class="prompt-card">
        <p class="prompt-text"><span class="a">${p.dividend}</span> ÷ <span class="b">${p.a}</span> = ?</p>
        <div class="running">${p.finalWin ? 'עוד אחת — את יכולה! ⭐' : `${p.dividend} נקודות, ${p.a} שורות שוות — כמה בכל שורה? אם צריך, צבעי לספור`}</div>
      </div>
      <div class="stage"></div>
      <div class="hint" id="hint"></div>
      <div class="answers" id="answers"></div>
    </div>
  `);
  app.appendChild(view);
  buildPaintStage(view.querySelector('.stage'), p.a, p.b);
  const answers = view.querySelector('#answers');
  p.options.forEach((opt) => {
    const b = el(`<button class="btn answer">${opt}</button>`);
    b.onclick = () => chooseDivAnswer(opt, b);
    answers.appendChild(b);
  });
}

function renderDivAdvanced() {
  const p = problem;
  const subMap = {
    medium:    `${p.dividend} ÷ ${p.a} — עבדי בשלבים`,
    long:      `פרקי את ${p.dividend}: כמה פעמים ${p.a} נכנס?`,
    xlarge:    `חילוק ארוך — ${p.dividend} ÷ ${p.a}`,
    div2:      `${p.dividend} ÷ ${p.a} — נחשי וכפלי לבדיקה`,
    remainder: `${p.dividend} ÷ ${p.a} — מה המנה ומה השארית?`,
  };
  const questionText = p.divType === 'remainder'
    ? `<span class="a">${p.dividend}</span> ÷ <span class="b">${p.a}</span> = ?`
    : `<span class="a">${p.dividend}</span> ÷ <span class="b">${p.a}</span> = ?`;
  app.innerHTML = '';
  const view = el(`
    <div class="round">
      ${roundTopbar()}
      <div class="prompt-card">
        <p class="prompt-text">${questionText}</p>
        <div class="running">${p.finalWin ? 'עוד אחת — את יכולה! ⭐' : (subMap[p.divType] || '')}</div>
      </div>
      <div class="hint" id="hint"></div>
      <div class="answers" id="answers"></div>
    </div>
  `);
  app.appendChild(view);
  const answers = view.querySelector('#answers');
  p.options.forEach((opt) => {
    const b = el(`<button class="btn answer">${opt}</button>`);
    b.onclick = () => chooseDivAnswer(opt, b);
    answers.appendChild(b);
  });
}

function divAdvancedHint(p) {
  const { dividend, a: divisor, divType } = p;

  if (divType === 'remainder') {
    const { quotientNum: q, remainderNum: r } = p;
    return `<div style="text-align:center;line-height:2">` +
      `${divisor}×${q}=${divisor*q}, ו-${dividend}-${divisor*q}=<b>${r}</b><br>` +
      `תשובה: <b>${q} שארית ${r}</b></div>`;
  }

  if (divType === 'xlarge') {
    const q = p.answer;
    const bigQ = Math.floor(q / 100) * 100;
    const smallQ = q - bigQ;
    const bigD = bigQ * divisor;
    const smallD = dividend - bigD;
    const steps = smallQ === 0
      ? `${bigD} ÷ ${divisor} = ${bigQ}`
      : `${bigD} ÷ ${divisor} = <b>${bigQ}</b><br>${smallD} ÷ ${divisor} = <b>${smallQ}</b><br>סה"כ: ${bigQ}+${smallQ} = <b>${q}</b>`;
    return `<div style="text-align:center;line-height:2">${steps}</div>`;
  }

  if (divType === 'div2') {
    const q = p.answer;
    return `<div style="text-align:center;line-height:2">` +
      `בדיקה: ${q} × ${divisor} = <b>${dividend}</b></div>`;
  }

  // medium / long: partial-quotients decomposition
  const q = p.answer;
  const tens = Math.floor(q / 10) * 10;
  const ones = q % 10;
  let steps;
  if (ones === 0) {
    steps = `${dividend} = ${tens} × ${divisor}`;
  } else {
    steps = `${tens * divisor} ÷ ${divisor} = <b>${tens}</b><br>${ones * divisor} ÷ ${divisor} = <b>${ones}</b><br>סה"כ: ${tens}+${ones} = <b>${q}</b>`;
  }
  return `<div style="text-align:center;line-height:2">התשובה: <b>${q}</b><br><span style="font-size:0.85em;color:var(--gray)">${steps}</span></div>`;
}

function chooseDivAnswer(opt, btn) {
  const p = problem;
  if (p.locked) return;
  const hint = document.getElementById('hint');
  if (opt === p.answer) {
    btn.classList.add('correct');
    const firstTry = p.tries === 0;
    commitCorrect(p, btn);
    hint.textContent = firstTry ? 'כל הכבוד! ⭐⭐⭐' : 'יפה! ⭐';
    setTimeout(() => nextProblem(false), 850);
  } else {
    p.tries++;
    audio.wrong();
    btn.classList.add('wrong');
    setTimeout(() => btn.classList.remove('wrong'), 350);
    if (p.tries >= 2) {
      const stage = document.querySelector('.round .stage');
      if (stage) {
        hint.textContent = `התשובה היא ${p.answer}. ${p.dividend} ÷ ${p.a} = ${p.answer} — בכל שורה ${p.answer}.`;
        revealFullGrid(stage, p.a, p.b);
      } else {
        hint.innerHTML = divAdvancedHint(p);
      }
      commitWrongReveal(p);
      showContinue();
    } else {
      hint.textContent = 'כמעט! עוד ניסיון אחד';
    }
  }
}

// ====================== PRIMES GAME ======================
// "A number that can't form a full rectangle." Binary ראשוני / פריק, then the
// dots reveal the rectangle (composite) or single line (prime). Range 2–30.
const PRIMES_30 = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29];
const COMPOSITES_30 = [4, 6, 8, 9, 10, 12, 14, 15, 16, 18, 20, 21, 22, 24, 25, 26, 27, 28, 30];
const PRIMES_EASY = [2, 3, 5];
const COMPOSITES_EASY = [4, 6, 9];

function isPrimeNum(n) {
  if (n < 2) return false;
  for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
  return true;
}
// most-square factor pair with both factors > 1 (composite); [1, n] if prime
function squareFactor(n) {
  let best = [1, n];
  for (let r = 2; r * r <= n; r++) if (n % r === 0) best = [r, n / r];
  return best;
}

function makePrimeProblem(finalWin) {
  const easy = finalWin || round.index === 0;
  const primes = easy ? PRIMES_EASY : PRIMES_30;
  const comps = easy ? COMPOSITES_EASY : COMPOSITES_30;
  let n, guard = 0;
  do {
    const set = rand() < 0.5 ? primes : comps;   // ~50/50 so both answers stay live
    n = set[Math.floor(rand() * set.length)];
  } while (recentHas('pr:' + n, easy ? 2 : 8) && guard++ < 16);
  remember('pr:' + n);
  return { kind: 'prime', n, isPrime: isPrimeNum(n), tries: 0, locked: false, finalWin };
}

function renderPrimes() {
  const p = problem;
  app.innerHTML = '';
  const view = el(`
    <div class="round">
      ${roundTopbar()}
      <div class="prompt-card">
        <p class="prompt-text">${p.finalWin ? 'עוד אחת! ⭐' : 'המספר הזה ראשוני או פריק?'}</p>
        <div class="running">ראשוני = מתחלק רק ב-1 ובעצמו</div>
      </div>
      <div class="prime-num">${p.n}</div>
      <div class="stage"><div class="dots" id="dots"></div></div>
      <div class="hint" id="hint"></div>
      <div class="answers answers--two" id="answers">
        <button class="btn answer" id="opt-prime">ראשוני</button>
        <button class="btn answer" id="opt-comp">פריק</button>
      </div>
    </div>
  `);
  app.appendChild(view);
  view.querySelector('#opt-prime').onclick = (e) => choosePrime(true, e.currentTarget);
  view.querySelector('#opt-comp').onclick = (e) => choosePrime(false, e.currentTarget);
}

function primeExplain(p) {
  if (p.isPrime) return `${p.n} ראשוני — אפשר לסדר אותו רק בשורה אחת.`;
  const [r, c] = squareFactor(p.n);
  return `${p.n} פריק — אפשר לסדר אותו במלבן של ${r} × ${c}.`;
}

// fill the stage with the rectangle (composite) or single row (prime)
function revealPrimeDots() {
  const p = problem;
  const stage = document.querySelector('.round .stage');
  const dots = document.getElementById('dots');
  if (!dots) return;
  dots.innerHTML = '';
  const [rows, cols] = p.isPrime ? [1, p.n] : squareFactor(p.n);
  for (let r = 0; r < rows; r++) {
    const row = el(`<div class="dot-row" style="grid-template-columns:repeat(${cols},var(--dot))"></div>`);
    for (let c = 0; c < cols; c++) row.appendChild(el('<span class="dot"></span>'));
    dots.appendChild(row);
  }
  requestAnimationFrame(() => sizeDots(stage, dots, rows, cols));
}

function choosePrime(saysPrime, btn) {
  const p = problem;
  if (p.locked) return;
  const hint = document.getElementById('hint');
  if (saysPrime === p.isPrime) {
    btn.classList.add('correct');
    commitCorrect(p, btn);
    revealPrimeDots();
    hint.textContent = primeExplain(p);
    setTimeout(() => nextProblem(false), 1200);
  } else {
    p.tries++;
    audio.wrong();
    btn.classList.add('wrong');
    setTimeout(() => btn.classList.remove('wrong'), 350);
    if (p.tries >= 2) {
      const right = document.getElementById(p.isPrime ? 'opt-prime' : 'opt-comp');
      if (right) right.classList.add('correct');
      revealPrimeDots();
      hint.textContent = primeExplain(p);
      commitWrongReveal(p);
      showContinue();
    } else {
      hint.textContent = 'אופס, נסי שוב 🙂';
    }
  }
}

// ====================== FRACTIONS GAME ======================
// +, −, × with same and unlike denominators (unlike = one denom is a multiple
// of the other). Answers must be in simplest form. Shown concretely: shaded
// bars for +/−, an area grid for ×. Feeds the same dragon/stars + stop-rule.
function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t; } return a || 1; }
function reduceFrac(n, d) { const g = gcd(n, d); return { n: n / g, d: d / g }; }
function fsame(a, b) { return a.n === b.n && a.d === b.d; }        // same written form
function feq(a, b) { return a.n * b.d === b.n * a.d; }             // same value

function buildFrac(subtype, easy) {
  const ri = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  let op, o1, o2, raw;
  if (subtype === 'addSame') {
    const d = easy ? ri(3, 5) : ri(3, 8);
    const n1 = ri(1, d - 2), n2 = ri(1, d - 1 - n1);
    op = '+'; o1 = { n: n1, d }; o2 = { n: n2, d }; raw = { n: n1 + n2, d };
  } else if (subtype === 'subSame') {
    const d = easy ? ri(3, 5) : ri(3, 8);
    const n1 = ri(2, d - 1), n2 = ri(1, n1 - 1);
    op = '-'; o1 = { n: n1, d }; o2 = { n: n2, d }; raw = { n: n1 - n2, d };
  } else if (subtype === 'mul') {
    const d1 = ri(2, easy ? 3 : 4), d2 = ri(2, easy ? 3 : 4);
    const n1 = ri(1, d1 - 1), n2 = ri(1, d2 - 1);
    op = '×'; o1 = { n: n1, d: d1 }; o2 = { n: n2, d: d2 }; raw = { n: n1 * n2, d: d1 * d2 };
  } else if (subtype === 'addUnlike') {
    const ds = ri(2, easy ? 2 : 4), k = ri(2, 3), dl = ds * k;
    const a = ri(1, ds - 1), ak = a * k, b = ri(1, dl - 1 - ak);
    op = '+'; o1 = { n: a, d: ds }; o2 = { n: b, d: dl }; raw = { n: ak + b, d: dl };
  } else { // subUnlike — larger (denom dl) minus smaller (denom ds), stays positive
    const ds = ri(2, easy ? 2 : 4), k = ri(2, 3), dl = ds * k;
    const a = ri(1, ds - 1), ak = a * k, b = ri(ak + 1, dl - 1);
    op = '-'; o1 = { n: b, d: dl }; o2 = { n: a, d: ds }; raw = { n: b - ak, d: dl };
  }
  return { subtype, op, o1, o2, raw, ans: reduceFrac(raw.n, raw.d) };
}

function fracOptions(p) {
  const ans = p.ans, raw = p.raw, cands = [];
  if (!fsame(raw, ans)) cands.push({ n: raw.n, d: raw.d });               // forgot to simplify
  if (p.op === '+' || p.op === '×') cands.push({ n: p.o1.n + p.o2.n, d: p.o1.d + p.o2.d }); // added the bottoms too
  if (p.op === '-') cands.push({ n: Math.abs(p.o1.n - p.o2.n) || 1, d: Math.abs(p.o1.d - p.o2.d) });
  cands.push({ n: ans.n + 1, d: ans.d }, { n: ans.n, d: ans.d + 1 },
             { n: ans.n + 1, d: ans.d + 1 }, { n: Math.max(1, ans.n - 1), d: ans.d }, { n: ans.n + 2, d: ans.d });
  const out = [];
  const ok = (f) => f && Number.isInteger(f.n) && Number.isInteger(f.d) && f.n > 0 && f.d > 1
                    && !fsame(f, ans) && !out.some((o) => fsame(o, f));
  for (const c of cands) { if (out.length >= 3) break; if (ok(c)) out.push(c); }
  let e = 2; while (out.length < 3 && e < 24) { const f = { n: ans.n + e, d: ans.d }; if (ok(f)) out.push(f); e++; }
  return shuffleInPlace([{ n: ans.n, d: ans.d, correct: true }, ...out.map((f) => ({ n: f.n, d: f.d, correct: false }))]);
}

function buildFracNew(subtype) {
  const ri = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

  if (subtype === 'fracOfNum') {
    const dOpts = [2, 3, 4, 5, 8, 10];
    const d = dOpts[Math.floor(rand() * dOpts.length)];
    const n = ri(1, d - 1);
    const k = ri(2, 10);
    const baseNum = d * k, answer = n * k;
    const wrong = [];
    for (const c of [n*(k+1), n*(k-1>0?k-1:k+2), (n+1)*k, d*k, answer+n, answer+d]) {
      if (c > 0 && c !== answer && !wrong.includes(c)) wrong.push(c);
      if (wrong.length >= 3) break;
    }
    let e = 1; while (wrong.length < 3) { if (answer+e !== answer) wrong.push(answer+e); e++; }
    const options = shuffleInPlace([{val:answer,correct:true},...wrong.slice(0,3).map(v=>({val:v,correct:false}))]);
    return {subtype, n, d, baseNum, answer, options, cacheKey:`${n}/${d}x${k}`};
  }

  if (subtype === 'improper') {
    const dir = rand() < 0.5 ? 'toMixed' : 'toImproper';
    const d = ri(2, 8), w = ri(1, 4), n = ri(1, d - 1);
    const numer = w * d + n;
    let options;
    if (dir === 'toMixed') {
      const correct = {w, n, d, correct:true};
      const wrong = [];
      const cands = [{w,n:n===1?2:n-1,d},{w,n:n+1<d?n+1:1,d},{w:w+1,n,d},{w:Math.max(1,w-1),n,d},{w,n:d-1,d}];
      for (const c of cands) {
        if (c.n>0&&c.n<c.d&&!(c.w===w&&c.n===n&&c.d===d)&&!wrong.some(x=>x.w===c.w&&x.n===c.n&&x.d===c.d)) wrong.push(c);
        if (wrong.length>=3) break;
      }
      let e=1; while(wrong.length<3){wrong.push({w:w+e+1,n,d});e++;}
      options = shuffleInPlace([correct,...wrong.slice(0,3).map(c=>({...c,correct:false}))]);
    } else {
      const correct = {n:numer,d,correct:true};
      const wrong = [];
      const cands = [{n:numer+1,d},{n:numer-1,d},{n:w*d,d},{n:(w+1)*d+n,d},{n:numer,d:d+1}];
      for (const c of cands) {
        if (c.n>0&&c.d>1&&!(c.n===numer&&c.d===d)&&!wrong.some(x=>x.n===c.n&&x.d===c.d)) wrong.push(c);
        if (wrong.length>=3) break;
      }
      let e=1; while(wrong.length<3){wrong.push({n:numer+e+1,d});e++;}
      options = shuffleInPlace([correct,...wrong.slice(0,3).map(c=>({...c,correct:false}))]);
    }
    return {subtype, dir, w, n, d, numer, options, cacheKey:`${numer}/${d}${dir}`};
  }

  if (subtype === 'equiv') {
    let n1, d1;
    do { d1 = ri(2, 6); n1 = ri(1, d1-1); } while (gcd(n1,d1) > 1);
    const k = ri(2, 5);
    const n = n1*k, d = d1*k;
    const ans = {n:n1, d:d1};
    const wrong = [];
    for (const c of [{n:n1+1,d:d1},{n:n1,d:d1+1},{n,d},{n:Math.max(1,n1-1),d:d1},{n:n1+1,d:d1+1}]) {
      if (c.n>0&&c.d>1&&!(c.n===n1&&c.d===d1)&&!wrong.some(x=>x.n===c.n&&x.d===c.d)) wrong.push(c);
      if (wrong.length>=3) break;
    }
    let e=2; while(wrong.length<3){wrong.push({n:n1+e,d:d1});e++;}
    const options = shuffleInPlace([{...ans,correct:true},...wrong.slice(0,3).map(f=>({...f,correct:false}))]);
    return {subtype, n, d, ans, options, cacheKey:`${n}/${d}`};
  }

  if (subtype === 'wholeFrac') {
    const whole = ri(2, 6), d = ri(2, 7), n = ri(1, d-1);
    const raw = {n:whole*n, d};
    const ans = reduceFrac(raw.n, raw.d);
    const wrong = [];
    for (const c of [{n:raw.n,d:raw.d},{n:ans.n+1,d:ans.d},{n:ans.n,d:ans.d+1},{n:whole+n,d},{n:ans.n*2,d:ans.d}]) {
      if (c.n>0&&c.d>1&&!fsame(c,ans)&&!wrong.some(x=>fsame(x,c))) wrong.push(c);
      if (wrong.length>=3) break;
    }
    let e=1; while(wrong.length<3){const f={n:ans.n+e,d:ans.d};if(!fsame(f,ans))wrong.push(f);e++;}
    const options = shuffleInPlace([{...ans,correct:true},...wrong.slice(0,3).map(f=>({...f,correct:false}))]);
    return {subtype, whole, n, d, raw, ans, options, cacheKey:`${whole}x${n}/${d}`};
  }
}

function makeFractionProblem(finalWin) {
  const easy = finalWin || round.index === 0;
  const OLD = ['addSame', 'subSame', 'mul', 'addUnlike', 'subUnlike'];
  const NEW = ['fracOfNum', 'improper', 'equiv', 'wholeFrac'];
  // New types appear twice in the pool to give them equal weight vs 5 old types
  const pool = easy ? ['addSame', 'fracOfNum'] : [...OLD, ...NEW, ...NEW];
  let p, key;
  for (let t = 0; t < 20; t++) {
    const subtype = pool[Math.floor(rand() * pool.length)];
    if (NEW.includes(subtype)) {
      p = buildFracNew(subtype);
      key = `fr:${subtype}:${p.cacheKey}`;
    } else {
      p = buildFrac(subtype, easy);
      key = `fr:${p.o1.n}/${p.o1.d}${p.op}${p.o2.n}/${p.o2.d}`;
      p.options = fracOptions(p);
    }
    if (easy || t === 19 || !recentHas(key, 6)) break;
  }
  remember(key);
  p.kind = 'frac'; p.tries = 0; p.locked = false; p.finalWin = finalWin;
  return p;
}

function fracTile(f) { return `<span class="frac"><span class="frac-n">${f.n}</span><span class="frac-d">${f.d}</span></span>`; }

// a bar split into d parts with the first n shaded
function fracBarSVG(n, d, fill) {
  const W = 320, H = 46, seg = W / d;
  let cells = '';
  for (let i = 0; i < d; i++)
    cells += `<rect x="${i * seg}" y="0" width="${seg}" height="${H}" fill="${i < n ? fill : '#fff'}" stroke="#2a2150" stroke-width="3"/>`;
  return `<svg viewBox="-2 -2 ${W + 4} ${H + 4}" class="frac-bar" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${cells}</svg>`;
}

// area model for a×b: d1 columns × d2 rows; overlap of n1 cols & n2 rows is the product
function fracGridSVG(n1, d1, n2, d2) {
  const S = 46, W = d1 * S, H = d2 * S;
  let cells = '';
  for (let r = 0; r < d2; r++) for (let c = 0; c < d1; c++) {
    const inA = c < n1, inB = r < n2;
    const fill = inA && inB ? '#7b4dff' : (inA || inB ? '#dccdff' : '#fff');
    cells += `<rect x="${c * S}" y="${r * S}" width="${S}" height="${S}" fill="${fill}" stroke="#2a2150" stroke-width="3"/>`;
  }
  return `<svg viewBox="-2 -2 ${W + 4} ${H + 4}" class="frac-grid" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${cells}</svg>`;
}

function fracRunning(p) {
  if (p.op === '×') return 'איזה חלק מהשלם צבוע? (בצורה מצומצמת)';
  if (p.op === '-') return 'כמה נשאר? (בצורה מצומצמת)';
  return 'כמה יוצא ביחד? (בצורה מצומצמת)';
}

function fracExplain(p) {
  if (p.subtype === 'fracOfNum') return `${p.n}/${p.d} מ-${p.baseNum} = ${p.answer}`;
  if (p.subtype === 'improper') {
    if (p.dir === 'toMixed') return `${p.numer}/${p.d} = ${p.w} ו-${p.n}/${p.d}`;
    return `${p.w} ו-${p.n}/${p.d} = ${p.numer}/${p.d}`;
  }
  if (p.subtype === 'equiv') return `${p.n}/${p.d} = ${p.ans.n}/${p.ans.d}`;
  if (p.subtype === 'wholeFrac') return `${p.whole} × ${p.n}/${p.d} = ${p.ans.n}/${p.ans.d}`;
  const r = p.raw, a = p.ans;
  if (fsame(r, a)) return `התשובה: ${a.n}/${a.d}`;
  return `${r.n}/${r.d} = ${a.n}/${a.d} (מצמצמים)`;
}

function mixedTile(w, n, d) {
  return `<span class="mixed-num"><span class="mixed-whole">${w}</span>${fracTile({n,d})}</span>`;
}

function renderFractions() {
  const p = problem;
  if (p.subtype === 'fracOfNum') return renderFracOfNum(p);
  if (p.subtype === 'improper')  return renderImproper(p);
  if (p.subtype === 'equiv')     return renderEquivFrac(p);
  if (p.subtype === 'wholeFrac') return renderWholeFrac(p);
  // existing op-based render
  app.innerHTML = '';
  const eq = `${fracTile(p.o1)}<span class="op">${p.op}</span>${fracTile(p.o2)}<span class="op">=</span><span class="qmark">?</span>`;
  const visual = p.op === '×'
    ? fracGridSVG(p.o1.n, p.o1.d, p.o2.n, p.o2.d)
    : fracBarSVG(p.o1.n, p.o1.d, COLORS[0]) + fracBarSVG(p.o2.n, p.o2.d, COLORS[2]);
  const view = el(`
    <div class="round">
      ${roundTopbar()}
      <div class="prompt-card">
        <p class="prompt-text frac-eq">${eq}</p>
        <div class="running">${p.finalWin ? 'עוד אחת — את יכולה! ⭐' : fracRunning(p)}</div>
      </div>
      <div class="frac-stage" id="fstage">${visual}</div>
      <div class="hint" id="hint"></div>
      <div class="answers" id="answers"></div>
    </div>
  `);
  app.appendChild(view);
  const answers = view.querySelector('#answers');
  p.options.forEach((o) => {
    const b = el(`<button class="btn answer frac-answer" data-correct="${o.correct}">${fracTile(o)}</button>`);
    b.onclick = () => chooseFrac(o, b);
    answers.appendChild(b);
  });
}

function renderFracOfNum(p) {
  app.innerHTML = '';
  const view = el(`
    <div class="round">
      ${roundTopbar()}
      <div class="prompt-card">
        <p class="prompt-text" style="gap:8px">כמה זה ${fracTile({n:p.n,d:p.d})} מ-<b>${p.baseNum}</b>?</p>
        <div class="running">שבר מתוך מספר</div>
      </div>
      <div class="frac-stage">${fracBarSVG(p.n, p.d, COLORS[1])}</div>
      <div class="hint" id="hint"></div>
      <div class="answers" id="answers"></div>
    </div>
  `);
  app.appendChild(view);
  const answers = view.querySelector('#answers');
  p.options.forEach(o => {
    const b = el(`<button class="btn btn--big answer num-answer" data-correct="${o.correct}">${o.val}</button>`);
    b.onclick = () => chooseFracNum(o, b);
    answers.appendChild(b);
  });
}

function renderImproper(p) {
  app.innerHTML = '';
  const prompt = p.dir === 'toMixed'
    ? `<span class="frac-eq">${fracTile({n:p.numer,d:p.d})}</span>`
    : `<span class="frac-eq">${mixedTile(p.w, p.n, p.d)}</span>`;
  const running = p.dir === 'toMixed' ? 'הפוך לשבר מעורב' : 'הפוך לשבר בלתי מדויק';
  const view = el(`
    <div class="round">
      ${roundTopbar()}
      <div class="prompt-card">
        <p class="prompt-text">${prompt}</p>
        <div class="running">${running}</div>
      </div>
      <div class="hint" id="hint"></div>
      <div class="answers" id="answers"></div>
    </div>
  `);
  app.appendChild(view);
  const answers = view.querySelector('#answers');
  p.options.forEach(o => {
    const display = p.dir === 'toMixed' ? mixedTile(o.w, o.n, o.d) : fracTile(o);
    const b = el(`<button class="btn answer frac-answer" data-correct="${o.correct}">${display}</button>`);
    b.onclick = () => chooseFrac(o, b);
    answers.appendChild(b);
  });
}

function renderEquivFrac(p) {
  app.innerHTML = '';
  const view = el(`
    <div class="round">
      ${roundTopbar()}
      <div class="prompt-card">
        <p class="prompt-text">צמצמ${fracTile({n:p.n,d:p.d})}</p>
        <div class="running">חפשי את המחלק המשותף הגדול</div>
      </div>
      <div class="frac-stage">${fracBarSVG(p.n, p.d, COLORS[2])}</div>
      <div class="hint" id="hint"></div>
      <div class="answers" id="answers"></div>
    </div>
  `);
  app.appendChild(view);
  const answers = view.querySelector('#answers');
  p.options.forEach(o => {
    const b = el(`<button class="btn answer frac-answer" data-correct="${o.correct}">${fracTile(o)}</button>`);
    b.onclick = () => chooseFrac(o, b);
    answers.appendChild(b);
  });
}

function renderWholeFrac(p) {
  app.innerHTML = '';
  const view = el(`
    <div class="round">
      ${roundTopbar()}
      <div class="prompt-card">
        <p class="prompt-text" style="gap:6px"><b>${p.whole}</b><span class="op">×</span>${fracTile({n:p.n,d:p.d})}<span class="op">=</span><span class="qmark">?</span></p>
        <div class="running">כפל שבר במספר שלם</div>
      </div>
      <div class="hint" id="hint"></div>
      <div class="answers" id="answers"></div>
    </div>
  `);
  app.appendChild(view);
  const answers = view.querySelector('#answers');
  p.options.forEach(o => {
    const b = el(`<button class="btn answer frac-answer" data-correct="${o.correct}">${fracTile(o)}</button>`);
    b.onclick = () => chooseFrac(o, b);
    answers.appendChild(b);
  });
}

function chooseFracNum(o, btn) {
  const p = problem;
  if (p.locked) return;
  const hint = document.getElementById('hint');
  if (o.correct) {
    btn.classList.add('correct');
    commitCorrect(p, btn);
    hint.textContent = p.tries === 0 ? 'כל הכבוד! ⭐⭐⭐' : 'יפה! ⭐';
    setTimeout(() => nextProblem(false), 900);
  } else {
    p.tries++;
    audio.wrong();
    btn.classList.add('wrong');
    setTimeout(() => btn.classList.remove('wrong'), 350);
    if (p.tries >= 2) {
      const right = document.querySelector('.num-answer[data-correct="true"]');
      if (right) right.classList.add('correct');
      hint.textContent = fracExplain(p);
      commitWrongReveal(p);
      showContinue();
    } else {
      hint.textContent = 'לא בדיוק — נסי שוב';
    }
  }
}

function revealFrac() {
  const p = problem;
  if (['fracOfNum','improper','equiv','wholeFrac'].includes(p.subtype)) return;
  if (p.op === '×') return;
  const st = document.getElementById('fstage');
  if (st) st.innerHTML = fracBarSVG(p.raw.n, p.raw.d, COLORS[3]);
}

function chooseFrac(o, btn) {
  const p = problem;
  if (p.locked) return;
  const hint = document.getElementById('hint');
  if (o.correct) {
    btn.classList.add('correct');
    const firstTry = p.tries === 0;
    commitCorrect(p, btn);
    hint.textContent = firstTry ? 'כל הכבוד! ⭐⭐⭐' : 'יפה! ⭐';
    setTimeout(() => nextProblem(false), 900);
  } else {
    p.tries++;
    audio.wrong();
    btn.classList.add('wrong');
    setTimeout(() => btn.classList.remove('wrong'), 350);
    const needsSimplify = feq(o, p.ans);   // right value, just not reduced
    if (p.tries >= 2) {
      const right = document.querySelector('.frac-answer[data-correct="true"]');
      if (right) right.classList.add('correct');
      revealFrac();
      hint.textContent = fracExplain(p);
      commitWrongReveal(p);
      showContinue();
    } else {
      hint.textContent = needsSimplify ? 'כמעט! צריך לצמצם את השבר' : 'לא בדיוק — נסי שוב';
    }
  }
}

// ====================== TABLES (timed levels) GAME ======================
// Levels of 30 questions (3 per number 1–10, no commutative repeats). Each answer
// is timed (10s at L1, −1s per level, floor 4s). +1 point right, −1 wrong/timeout.
// Correct answers convert to dragon stars at the end of the level.
let tables = null;
const MAX_TABLES_LEVEL = 4;                                         // L4 = 4s = hardest
function tablesTime(level) { return Math.max(4, 12 - 2 * level); }  // 10, 8, 6, 4
function tablesStarsPerCorrect(level) { return 1 + Math.min(level, MAX_TABLES_LEVEL); } // 2…5, more when harder

function generateTablesLevel() {
  // all 55 distinct facts (canonical a≤b → no commutative repeats), then take 15,
  // capping the trivial ×1 / ×10 ones so the level isn't padded with freebies.
  const all = [];
  for (let a = 1; a <= 10; a++) for (let b = a; b <= 10; b++) all.push([a, b]);
  shuffleInPlace(all);
  const qs = [];
  let trivial = 0;
  for (const [a, b] of all) {
    if (qs.length >= 15) break;
    const isTriv = a === 1 || b === 1 || a === 10 || b === 10;
    if (isTriv && trivial >= 3) continue;
    qs.push(rand() < 0.5 ? [a, b] : [b, a]);   // randomize which side is shown first
    if (isTriv) trivial++;
  }
  return shuffleInPlace(qs);
}

function startTables(level) {
  audio.ensure();
  round = null;
  level = Math.min(Math.max(1, level), MAX_TABLES_LEVEL);
  // a run earns stars only if it's her frontier level (first clear) or the hardest level
  const earns = (level === MAX_TABLES_LEVEL) || (level >= (state.tablesLevel || 1));
  tables = { level, perQ: tablesTime(level), earns, queue: generateTablesLevel(),
    i: 0, correct: 0, wrong: 0, points: 0, locked: true, raf: 0, deadline: 0 };
  renderTablesStart();
}

function renderTablesStart() {
  const t = tables;
  const maxSel = Math.min(state.tablesLevel || 1, MAX_TABLES_LEVEL);  // levels she's unlocked
  const canEasier = t.level > 1;
  const canHarder = t.level < maxSel;
  app.innerHTML = '';
  const view = el(`
    <div class="tables-start">
      <div class="tl-nav">
        <button class="btn btn--ghost tl-step" id="easier" ${canEasier ? '' : 'disabled'}>קל יותר</button>
        <div class="tl-badge">שלב ${t.level}</div>
        <button class="btn btn--ghost tl-step" id="harder" ${canHarder ? '' : 'disabled'}>קשה יותר</button>
      </div>
      <p class="tl-sub">${t.queue.length} שאלות · ${t.perQ} שניות לכל אחת</p>
      ${t.earns
        ? `<p class="tl-tip">כל תשובה נכונה = ${tablesStarsPerCorrect(t.level)} ⭐ לספארקי</p>`
        : `<p class="tl-practice">מצב אימון — בשלב הזה לא נצברים כוכבים.<br>עברי לשלב הבא כדי לצבור! ⭐</p>`}
      <p class="tl-tip">תעני מהר ככל שאפשר — בכל שלב הזמן מתקצר!</p>
      <button class="btn btn--big btn--teal" id="go">התחלה ▶</button>
      <button class="btn btn--ghost" id="home">בית</button>
    </div>
  `);
  app.appendChild(view);
  if (canEasier) view.querySelector('#easier').onclick = () => startTables(t.level - 1);
  if (canHarder) view.querySelector('#harder').onclick = () => startTables(t.level + 1);
  view.querySelector('#go').onclick = () => { tables.locked = false; renderTablesQuestion(); };
  view.querySelector('#home').onclick = () => renderHome();
}

function renderTablesQuestion() {
  const t = tables;
  const [a, b] = t.queue[t.i];
  t.a = a; t.b = b; t.answer = a * b; t.locked = false;
  app.innerHTML = '';
  const view = el(`
    <div class="round tables">
      <div class="topbar">
        <div class="tl-pill">שלב ${t.level}</div>
        <div class="progress"><i style="width:${(t.i / t.queue.length) * 100}%"></i></div>
        <div class="tl-pill ${t.points < 0 ? 'neg' : ''}" id="tpoints">${t.points} נק׳</div>
      </div>
      <div class="timer-bar"><i id="tbar" style="width:100%"></i></div>
      <div class="prompt-card"><p class="prompt-text"><span class="a">${a}</span> × <span class="b">${b}</span> = ?</p></div>
      <div class="hint" id="hint"></div>
      <div class="answers" id="answers"></div>
    </div>
  `);
  app.appendChild(view);
  const answers = view.querySelector('#answers');
  answerOptions(t.answer).forEach((opt) => {
    const btn = el(`<button class="btn answer">${opt}</button>`);
    btn.onclick = () => tablesAnswer(opt, btn);
    answers.appendChild(btn);
  });
  t.tbar = view.querySelector('#tbar');
  t.deadline = performance.now() + t.perQ * 1000;
  tablesTick();
}

function tablesTick() {
  const t = tables;
  if (!t || t.locked) return;
  const rem = t.deadline - performance.now();
  const frac = Math.max(0, rem / (t.perQ * 1000));
  if (t.tbar) { t.tbar.style.width = (frac * 100) + '%'; t.tbar.classList.toggle('low', frac < 0.34); }
  if (rem <= 0) { tablesTimeout(); return; }
  t.raf = requestAnimationFrame(tablesTick);
}
function tablesStopTimer() { if (tables && tables.raf) cancelAnimationFrame(tables.raf); }

function tablesScore(correct) {
  const t = tables;
  if (correct) { t.correct++; t.points++; } else { t.wrong++; t.points = Math.max(0, t.points - 1); }
  recordActivity(correct, correct ? 0 : 1);
  recordTopic('tables', correct ? 0 : 1, correct);
  recordAttempt(t.a, t.b, correct, correct ? 0 : 1);
}

function tablesAnswer(opt, btn) {
  const t = tables;
  if (t.locked) return;
  t.locked = true; tablesStopTimer();
  const hint = document.getElementById('hint');
  if (opt === t.answer) {
    btn.classList.add('correct');
    audio.correct();
    tablesScore(true);
    hint.textContent = 'יפה! ⭐';
    setTimeout(tablesAdvance, 600);
  } else {
    btn.classList.add('wrong');
    audio.wrong();
    [...document.querySelectorAll('.answer')].forEach((x) => { if (+x.textContent === t.answer) x.classList.add('correct'); });
    tablesScore(false);
    hint.textContent = `${t.a} × ${t.b} = ${t.answer}`;
    setTimeout(tablesAdvance, 950);
  }
}

function tablesTimeout() {
  const t = tables;
  if (t.locked) return;
  t.locked = true; tablesStopTimer();
  audio.wrong();
  [...document.querySelectorAll('.answer')].forEach((x) => { if (+x.textContent === t.answer) x.classList.add('correct'); });
  tablesScore(false);
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = `נגמר הזמן! ${t.a} × ${t.b} = ${t.answer}`;
  setTimeout(tablesAdvance, 950);
}

function tablesAdvance() {
  if (!tables) return;
  tables.i++;
  if (tables.i >= tables.queue.length) return endTablesLevel();
  renderTablesQuestion();
}

function endTablesLevel() {
  const t = tables;
  const lvl = t.level, total = t.queue.length, correct = t.correct, points = t.points;
  const craveMul = (t.earns && !cravingDone() && todayCraving() === 'tables') ? 2 : 1;
  const stars = t.earns ? correct * tablesStarsPerCorrect(lvl) * craveMul : 0;
  const before = stageIndex(state.stars);
  if (stars > 0) { state.stars += stars; dayBucket().s += stars; }
  if (t.earns) satisfyCraving('tables');
  if (t.earns && lvl < MAX_TABLES_LEVEL) state.tablesLevel = Math.max(state.tablesLevel || 1, lvl + 1);
  state.lastPlayed = Date.now();
  save(state);
  syncNow(true);
  const grew = stageIndex(state.stars) > before;
  const si = stageIndex(state.stars);
  const canAdvance = lvl < MAX_TABLES_LEVEL;
  app.innerHTML = '';
  const view = el(`
    <div class="end">
      <h2>שלב ${lvl} הושלם! 🎉</h2>
      <div class="dragon-wrap">${dragonSVG(si)}<div class="dragon-name">${PET}${grew ? ' גדל! 🎉' : ''}</div></div>
      <div class="earned">${correct}/${total} נכון · ${points} נק׳</div>
      <div class="earned">${t.earns ? `צברת <span class="star">★</span> ${stars}` : 'מצב אימון — בלי כוכבים ⭐'}</div>
      ${canAdvance
        ? `<button class="btn btn--big btn--teal" id="next">שלב ${lvl + 1} — מהר יותר! →</button>
           <button class="btn btn--big btn--ghost" id="stay">להישאר בשלב ${lvl} (אימון, בלי כוכבים)</button>`
        : `<button class="btn btn--big btn--teal" id="stay">עוד פעם — השלב הכי קשה! 🔥</button>`}
      <button class="btn btn--big btn--ghost" id="home">בית</button>
    </div>
  `);
  app.appendChild(view);
  if (grew) audio.grow();
  confetti(40);
  if (stars > 0) flyStars(Math.min(stars, 6), view.querySelector('.star'));
  const nextBtn = view.querySelector('#next');
  if (nextBtn) nextBtn.onclick = () => startTables(lvl + 1);
  view.querySelector('#stay').onclick = () => startTables(lvl);
  view.querySelector('#home').onclick = () => renderHome();
}

// ====================== SHAPES GAME ======================
// Quadrilaterals: square, rectangle, rhombus, parallelogram, trapezoid, kite.
const SHAPES = {
  square:        { he: 'ריבוע',   pts: '25,25 75,25 75,75 25,75', rule: '4 צלעות שוות וכל הזוויות ישרות' },
  rectangle:     { he: 'מלבן',    pts: '12,30 88,30 88,70 12,70', rule: '4 זוויות ישרות, והצלעות שמנגד שוות' },
  rhombus:       { he: 'מעוין',   pts: '50,12 86,50 50,88 14,50', rule: '4 צלעות שוות, אבל הזוויות אינן ישרות' },
  parallelogram: { he: 'מקבילית', pts: '30,30 92,30 70,70 8,70',  rule: 'שני זוגות של צלעות מקבילות ושוות' },
  trapezoid:     { he: 'טרפז',    pts: '28,30 72,30 92,70 8,70',  rule: 'רק זוג אחד של צלעות מקבילות' },
  kite:          { he: 'דלתון',   pts: '50,10 80,42 50,90 20,42', rule: 'שני זוגות של צלעות צמודות שוות' },
};
const SHAPE_KEYS = Object.keys(SHAPES);
const BUILD_KEYS = ['square', 'rectangle', 'parallelogram', 'trapezoid', 'rhombus', 'kite'];
const BUILD_EXAMPLES = {
  square: [{x:1,y:1},{x:3,y:1},{x:3,y:3},{x:1,y:3}],
  rectangle: [{x:0,y:1},{x:4,y:1},{x:4,y:3},{x:0,y:3}],
  parallelogram: [{x:0,y:3},{x:3,y:3},{x:4,y:1},{x:1,y:1}],
  trapezoid: [{x:0,y:3},{x:4,y:3},{x:3,y:1},{x:1,y:1}],
  rhombus: [{x:2,y:0},{x:3,y:2},{x:2,y:4},{x:1,y:2}],
  kite: [{x:2,y:0},{x:4,y:2},{x:2,y:3},{x:0,y:2}],
};

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

function shapeSVG(pts, size, fill) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-hidden="true"><polygon points="${pts}" fill="${fill}" stroke="#2a2150" stroke-width="3" stroke-linejoin="round"/></svg>`;
}

// ---------- Area & Perimeter — rectangles and squares ----------
function rectAnswerOptions(answer, a, b, subtype) {
  const cands = new Set();
  if (subtype === 'area') {
    cands.add(2 * (a + b)); cands.add(a + b); cands.add(a * a); cands.add(b * b);
    cands.add((a + 1) * b); cands.add(a * (b + 1));
  } else {
    cands.add(a * b); cands.add(a + b); cands.add(4 * a); cands.add(4 * b);
    cands.add(2 * a + b); cands.add(a + 2 * b);
  }
  cands.delete(answer);
  const wrong = [...cands].filter(x => x > 0);
  let guard = 0;
  const deltas = [2, -2, 4, -4, 6, -6, 8, -8];
  while (wrong.length < 3 && guard < 24) { const c = answer + deltas[guard++ % deltas.length]; if (c > 0 && c !== answer && !wrong.includes(c)) wrong.push(c); }
  const opts = [answer, ...wrong.slice(0, 3)];
  for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }
  return opts;
}

function makeRectProblem(finalWin) {
  let a, b, isSquare, subtype, guard = 0;
  do {
    isSquare = rand() < 0.4;
    a = 2 + Math.floor(rand() * 10);
    b = isSquare ? a : (2 + Math.floor(rand() * 10));
    if (!isSquare && b === a) b = b < 11 ? b + 1 : b - 1;
    subtype = finalWin ? 'area' : (rand() < 0.5 ? 'area' : 'perimeter');
  } while (recentHas(`re:${subtype}:${Math.min(a,b)}x${Math.max(a,b)}`, 4) && guard++ < 14);
  remember(`re:${subtype}:${Math.min(a,b)}x${Math.max(a,b)}`);
  const answer = subtype === 'area' ? a * b : 2 * (a + b);
  return { kind: 'rect', subtype, isSquare, a, b, answer, options: rectAnswerOptions(answer, a, b, subtype), tries: 0, locked: false, finalWin };
}

function rectSVG(a, b, isSquare) {
  const W = 260, H = 180, maxW = 160, maxH = 110;
  let rw, rh;
  if (isSquare) { rw = rh = Math.min(maxW, maxH); }
  else {
    const ratio = a / b;
    if (ratio > maxW / maxH) { rw = maxW; rh = Math.round(maxW / ratio); }
    else { rh = maxH; rw = Math.round(maxH * ratio); }
    rw = Math.max(rw, 40); rh = Math.max(rh, 40);
  }
  const rx = (W - rw) / 2, ry = (H - rh) / 2;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="#e8f0ff" stroke="#7b4dff" stroke-width="3.5" rx="5"/>
    <text x="${rx + rw/2}" y="${ry - 8}" text-anchor="middle" font-size="22" font-weight="900" fill="#ff5db1">${a}</text>
    <text x="${rx + rw + 12}" y="${ry + rh/2 + 8}" text-anchor="start" font-size="22" font-weight="900" fill="#ff5db1">${b}</text>
  </svg>`;
}

function renderRect() {
  const p = problem;
  const shapeName = p.isSquare ? 'ריבוע' : 'מלבן';
  const qText = p.subtype === 'area' ? `מה ה<b>שטח</b> של ה${shapeName}?` : `מה ה<b>היקף</b> של ה${shapeName}?`;
  const formula = p.subtype === 'area'
    ? (p.isSquare ? `שטח = ${p.a} × ${p.a}` : `שטח = ${p.a} × ${p.b}`)
    : (p.isSquare ? `היקף = 4 × ${p.a}` : `היקף = 2 × (${p.a} + ${p.b})`);
  app.innerHTML = '';
  const view = el(`
    <div class="round">
      ${roundTopbar()}
      <div class="prompt-card">
        <p class="prompt-text" style="font-size:clamp(18px,3.4vh,26px)">${qText}</p>
        ${p.finalWin ? '<div class="running">עוד אחת — את יכולה! ⭐</div>' : '<button class="btn btn--ghost hint-btn" id="hint-btn">💡 רמז (−⭐)</button>'}
      </div>
      <div class="shape-stage">${rectSVG(p.a, p.b, p.isSquare)}</div>
      <div class="hint" id="hint"></div>
      <div class="answers" id="answers"></div>
    </div>
  `);
  app.appendChild(view);
  if (!p.finalWin) {
    view.querySelector('#hint-btn').onclick = () => {
      view.querySelector('#hint-btn').remove();
      view.querySelector('#hint').textContent = formula;
      state.stars = Math.max(0, state.stars - 1);
      dayBucket().s = Math.max(0, (dayBucket().s || 0) - 1);
      save(state);
    };
  }
  p.options.forEach(opt => {
    const b = el(`<button class="btn answer" data-correct="${opt === p.answer}">${opt}</button>`);
    b.onclick = () => chooseRect(opt, b);
    view.querySelector('#answers').appendChild(b);
  });
}

function chooseRect(opt, btn) {
  const p = problem;
  if (p.locked) return;
  const hint = document.getElementById('hint');
  if (opt === p.answer) {
    btn.classList.add('correct');
    commitCorrect(p, btn);
    hint.textContent = p.tries === 0 ? 'כל הכבוד! ⭐⭐⭐' : 'יפה! ⭐';
    setTimeout(() => nextProblem(false), 900);
  } else {
    p.tries++; audio.wrong(); btn.classList.add('wrong');
    setTimeout(() => btn.classList.remove('wrong'), 350);
    if (p.tries >= 2) {
      const {a, b, isSquare, subtype, answer} = p;
      hint.textContent = subtype === 'area'
        ? (isSquare ? `שטח = ${a} × ${a} = ${answer}` : `שטח = ${a} × ${b} = ${answer}`)
        : (isSquare ? `היקף = 4 × ${a} = ${answer}` : `היקף = 2 × (${a} + ${b}) = ${answer}`);
      const right = document.querySelector('[data-correct="true"]');
      if (right) right.classList.add('correct');
      commitWrongReveal(p);
      showContinue();
    } else {
      hint.textContent = 'כמעט! עוד ניסיון אחד';
    }
  }
}

// ---------- Factor pairs ----------
const FACTOR_NUMS = [12,15,16,18,20,24,25,28,30,32,36,40,42,45,48,54,56,60,63,70,72,80,90];
const FACTOR_NUMS_EASY = [12,15,18,20,24,30];

function allFactorPairs(n) {
  const pairs = [];
  for (let a = 2; a * a <= n; a++) if (n % a === 0) pairs.push([a, n / a]);
  return pairs;
}

function makeFactorProblem(finalWin) {
  const ri = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const easy = finalWin || round.index === 0;
  const nums = easy ? FACTOR_NUMS_EASY : FACTOR_NUMS;
  let n, pairs, guard = 0;
  do {
    n = nums[Math.floor(rand() * nums.length)];
    pairs = allFactorPairs(n);
  } while (pairs.length === 0 || (recentHas('fc:'+n, 5) && guard++ < 15));
  remember('fc:'+n);
  const [a, b] = pairs[Math.floor(rand() * pairs.length)];
  const pairSet = new Set(pairs.map(([x,y]) => `${x}x${y}`));
  const wrong = [];
  for (const [x,y] of [[a+1,b],[a,b+1],[a-1>1?a-1:a+2,b],[a,b-1>1?b-1:b+2],[a+2,b],[a,b+2],[a+1,b+1]]) {
    const key = x<=y?`${x}x${y}`:`${y}x${x}`;
    if (x>1&&y>1&&!pairSet.has(key)&&!wrong.some(([px,py])=>px===x&&py===y)) wrong.push([x,y]);
    if (wrong.length>=3) break;
  }
  let ex=1; while(wrong.length<3){wrong.push([a+ex+2,b+ex]);ex++;}
  const options = shuffleInPlace([
    {a,b,correct:true},
    ...wrong.slice(0,3).map(([x,y])=>({a:x,b:y,correct:false}))
  ]);
  return {kind:'factor', n, a, b, options, tries:0, locked:false, finalWin};
}

function renderFactors() {
  const p = problem;
  app.innerHTML = '';
  const view = el(`
    <div class="round">
      ${roundTopbar()}
      <div class="prompt-card">
        <p class="prompt-text">${p.finalWin?'עוד אחת! ⭐':'איזה זוג מספרים מכפלתו'} <b>${p.n}</b>?</p>
        <div class="running">${p.n} = ? × ?</div>
      </div>
      <div class="hint" id="hint"></div>
      <div class="answers" id="answers"></div>
    </div>
  `);
  app.appendChild(view);
  p.options.forEach(opt => {
    const b = el(`<button class="btn btn--big answer factor-opt" data-correct="${opt.correct}">${opt.a} × ${opt.b}</button>`);
    b.onclick = () => chooseFactorPair(opt, b);
    view.querySelector('#answers').appendChild(b);
  });
}

function chooseFactorPair(opt, btn) {
  const p = problem;
  if (p.locked) return;
  const hint = document.getElementById('hint');
  if (opt.correct) {
    btn.classList.add('correct');
    commitCorrect(p, btn);
    hint.textContent = `${p.a} × ${p.b} = ${p.n} ✔`;
    setTimeout(() => nextProblem(false), 1000);
  } else {
    p.tries++;
    audio.wrong();
    btn.classList.add('wrong');
    setTimeout(() => btn.classList.remove('wrong'), 350);
    if (p.tries >= 2) {
      const right = document.querySelector('.factor-opt[data-correct="true"]');
      if (right) right.classList.add('correct');
      hint.textContent = `${p.a} × ${p.b} = ${p.n}`;
      commitWrongReveal(p);
      showContinue();
    } else {
      hint.textContent = `${opt.a} × ${opt.b} ≠ ${p.n} — נסי שוב`;
    }
  }
}

// ---------- Number line ----------
function numlineSVG(pointVal, rangeEnd, d) {
  const W = 340, H = 90, pad = 26, lineY = 54, drawW = W - 2*pad;
  const totalTicks = d * rangeEnd;
  let ticks = '', labels = '';
  for (let i = 0; i <= totalTicks; i++) {
    const x = (pad + (i / totalTicks) * drawW).toFixed(1);
    const isMajor = i % d === 0;
    const h = isMajor ? 20 : 10;
    ticks += `<line x1="${x}" y1="${lineY-h/2}" x2="${x}" y2="${lineY+h/2}" stroke="#2a2150" stroke-width="${isMajor?2.5:1.5}"/>`;
    if (isMajor) labels += `<text x="${x}" y="${lineY+30}" text-anchor="middle" font-size="15" fill="#2a2150" font-weight="700">${i/d}</text>`;
  }
  const dotX = (pad + (pointVal / rangeEnd) * drawW).toFixed(1);
  return `<svg viewBox="0 0 ${W} ${H}" class="numline-svg" preserveAspectRatio="xMidYMid meet">
    <line x1="${pad}" y1="${lineY}" x2="${W-pad}" y2="${lineY}" stroke="#2a2150" stroke-width="3.5"/>
    ${ticks}${labels}
    <circle cx="${dotX}" cy="${lineY}" r="12" fill="#ff4488" stroke="#2a2150" stroke-width="2.5"/>
    <circle cx="${dotX}" cy="${lineY}" r="5"  fill="#fff"/>
  </svg>`;
}

function makeNumlineProblem(finalWin) {
  const ri = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const easy = finalWin || round.index === 0;
  const type = easy ? 'simple' : ['simple','simple','mixed','decimal'][Math.floor(rand()*4)];

  if (type === 'simple') {
    const dOpts = easy ? [2,3,4] : [2,3,4,5,6,8];
    const d = dOpts[Math.floor(rand()*dOpts.length)], n = ri(1, d-1);
    const rightVal = n / d;
    // build pool of nearby fractions from common denominators, sorted by proximity
    const pool = [];
    for (const pd of [2,3,4,5,6,8,10]) for (let pn=1; pn<pd; pn++) if (Math.abs(pn/pd-rightVal)>0.01) pool.push({n:pn,d:pd});
    pool.sort((a,b) => Math.abs(a.n/a.d-rightVal) - Math.abs(b.n/b.d-rightVal));
    const wrong = pool.slice(0,3);
    const options = shuffleInPlace([{n,d,correct:true},...wrong.map(o=>({...o,correct:false}))]);
    return {kind:'numline', type, n, d, rangeEnd:1, options, tries:0, locked:false, finalWin};
  }

  if (type === 'mixed') {
    const dOpts = [2,3,4], d = dOpts[Math.floor(rand()*dOpts.length)];
    const w = ri(1,2), n = ri(1, d-1), rangeEnd = w+1;
    const wrong = [];
    for (const c of [{w,n:n===1?2:n-1,d},{w,n:n+1<d?n+1:1,d},{w:w+1,n,d},{w:Math.max(1,w-1),n,d}]) {
      if (!(c.w===w&&c.n===n&&c.d===d)&&!wrong.some(x=>x.w===c.w&&x.n===c.n&&x.d===c.d)) wrong.push(c);
      if (wrong.length>=3) break;
    }
    while(wrong.length<3) wrong.push({w:w+wrong.length+1,n,d});
    const options = shuffleInPlace([{w,n,d,correct:true},...wrong.slice(0,3).map(c=>({...c,correct:false}))]);
    return {kind:'numline', type, w, n, d, rangeEnd, options, tries:0, locked:false, finalWin};
  }

  // decimal
  const decOpts = [0.5,1.5,2.5,3.5,0.25,1.25,2.25,3.25,1.75,0.75,4.5,0.5];
  let val;
  do { val = decOpts[Math.floor(rand()*decOpts.length)]; } while (recentHas('nl:'+val, 4));
  remember('nl:'+val);
  const rangeEnd = Math.ceil(val)+1;
  const decD = String(val).includes('.25')||String(val).includes('.75') ? 4 : 2;
  const wrong = decOpts.filter(x=>x!==val).slice(0,3);
  const options = shuffleInPlace([{val,correct:true},...wrong.map(v=>({val:v,correct:false}))]);
  return {kind:'numline', type:'decimal', val, rangeEnd, decD, options, tries:0, locked:false, finalWin};
}

function renderNumline() {
  const p = problem;
  app.innerHTML = '';
  let pointVal, d;
  if (p.type==='simple')  { pointVal = p.n/p.d;       d = p.d; }
  else if (p.type==='mixed') { pointVal = p.w + p.n/p.d; d = p.d; }
  else                    { pointVal = p.val;          d = p.decD; }
  const view = el(`
    <div class="round">
      ${roundTopbar()}
      <div class="prompt-card">
        <p class="prompt-text">${p.finalWin?'עוד אחת! ⭐':'מה הערך של הנקודה האדומה?'}</p>
      </div>
      <div class="numline-stage">${numlineSVG(pointVal, p.rangeEnd, d)}</div>
      <div class="hint" id="hint"></div>
      <div class="answers" id="answers"></div>
    </div>
  `);
  app.appendChild(view);
  p.options.forEach(o => {
    let display;
    if (p.type==='simple')       display = fracTile(o);
    else if (p.type==='mixed')   display = `${o.w?`<b>${o.w}</b>`:''}${fracTile({n:o.n,d:o.d})}`;
    else                         display = o.val;
    const b = el(`<button class="btn answer frac-answer" data-correct="${o.correct}">${display}</button>`);
    b.onclick = () => chooseNumline(o, b);
    view.querySelector('#answers').appendChild(b);
  });
}

function chooseNumline(o, btn) {
  const p = problem;
  if (p.locked) return;
  const hint = document.getElementById('hint');
  if (o.correct) {
    btn.classList.add('correct');
    commitCorrect(p, btn);
    const ans = p.type==='decimal' ? p.val : p.type==='mixed' ? `${p.w} ו-${p.n}/${p.d}` : `${p.n}/${p.d}`;
    hint.textContent = `✔ ${ans}`;
    setTimeout(() => nextProblem(false), 1100);
  } else {
    p.tries++;
    audio.wrong();
    btn.classList.add('wrong');
    setTimeout(() => btn.classList.remove('wrong'), 350);
    if (p.tries >= 2) {
      const right = document.querySelector('.frac-answer[data-correct="true"]');
      if (right) right.classList.add('correct');
      const ans = p.type==='decimal' ? p.val : p.type==='mixed' ? `${p.w} ו-${p.n}/${p.d}` : `${p.n}/${p.d}`;
      hint.textContent = `הנקודה מסמנת ${ans}`;
      commitWrongReveal(p);
      showContinue();
    } else {
      hint.textContent = 'לא בדיוק — נסי שוב';
    }
  }
}

// ---------- Order of operations ----------
function makeOpOrderProblem(finalWin) {
  const ri = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const easy = finalWin || round.index === 0;
  const type = easy ? 0 : Math.floor(rand() * 4);
  let expr, answer, distractors;

  if (type === 0) {
    const a=ri(2,20), b=ri(2,9), c=ri(2,9);
    answer = a + b*c;
    distractors = [(a+b)*c, a*b+c, a+b+c];
    expr = `${a} + ${b} × ${c}`;
  } else if (type === 1) {
    const a=ri(2,12), b=ri(2,12), c=ri(2,6);
    answer = (a+b)*c;
    distractors = [a+b*c, (a+b)*c+c, a+b+c];
    expr = `(${a} + ${b}) × ${c}`;
  } else if (type === 2) {
    let a,b,c,d;
    do {a=ri(3,9);b=ri(3,9);c=ri(2,6);d=ri(2,6);} while(a*b<=c*d);
    answer = a*b - c*d;
    distractors = [(a*b-c)*d, a*b-c+d, a*(b-c)*d];
    expr = `${a} × ${b} - ${c} × ${d}`;
  } else {
    const a=ri(20,60), b=ri(2,10), c=ri(2,8), d=ri(2,8);
    answer = a - b + c*d;
    distractors = [a-(b+c)*d, (a-b+c)*d, a-b+c+d];
    expr = `${a} - ${b} + ${c} × ${d}`;
  }

  const valid = distractors.filter(x=>Number.isFinite(x)&&x>0&&x!==answer);
  while(valid.length<3) valid.push(answer+valid.length+1);
  const options = shuffleInPlace([{val:answer,correct:true},...valid.slice(0,3).map(v=>({val:v,correct:false}))]);
  return {kind:'oporder', expr, answer, options, tries:0, locked:false, finalWin};
}

function renderOpOrder() {
  const p = problem;
  app.innerHTML = '';
  const view = el(`
    <div class="round">
      ${roundTopbar()}
      <div class="prompt-card">
        <p class="prompt-text">${p.finalWin?'עוד אחת! ⭐':'מה התוצאה?'}</p>
        <div class="bignum-expr">${p.expr} = ?</div>
        <div class="running">כפל לפני חיבור — סוגריים ראשון!</div>
      </div>
      <div class="hint" id="hint"></div>
      <div class="answers" id="answers"></div>
    </div>
  `);
  app.appendChild(view);
  p.options.forEach(o => {
    const b = el(`<button class="btn btn--big answer num-answer" data-correct="${o.correct}">${o.val}</button>`);
    b.onclick = () => chooseNum(o, b, `${p.expr} = ${p.answer}`);
    view.querySelector('#answers').appendChild(b);
  });
}

// ---------- Large numbers ----------
function makeBignumProblem(finalWin) {
  const ri = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const easy = finalWin || round.index === 0;
  const type = easy ? 'add' : ['add','sub','mul','div'][Math.floor(rand()*4)];
  let expr, answer, distractors;

  if (type === 'add') {
    const a=ri(10000,50000), b=ri(1000,9999);
    answer = a+b; distractors = [answer+10, answer-100, answer+1000];
    expr = `${a.toLocaleString()} + ${b.toLocaleString()}`;
  } else if (type === 'sub') {
    const a=ri(20000,80000), b=ri(1000,9999);
    answer = a-b; distractors = [answer+10, answer-100, answer+100];
    expr = `${a.toLocaleString()} - ${b.toLocaleString()}`;
  } else if (type === 'mul') {
    const a=ri(100,500), b=ri(11,49);
    answer = a*b; distractors = [a*(b+1), a*(b-1), (a+1)*b];
    expr = `${a} × ${b}`;
  } else {
    const ans=ri(10,99), b=ri(7,12);
    answer = ans; const a=ans*b;
    distractors = [ans+1, ans-1, ans+b];
    expr = `${a} ÷ ${b}`;
  }

  const valid = distractors.filter(x=>x>0&&x!==answer);
  while(valid.length<3) valid.push(answer+valid.length*10+1);
  const options = shuffleInPlace([{val:answer,correct:true},...valid.slice(0,3).map(v=>({val:v,correct:false}))]);
  return {kind:'bignum', expr, answer, options, tries:0, locked:false, finalWin};
}

function renderBignum() {
  const p = problem;
  app.innerHTML = '';
  const view = el(`
    <div class="round">
      ${roundTopbar()}
      <div class="prompt-card">
        <p class="prompt-text">${p.finalWin?'עוד אחת! ⭐':'מה התוצאה?'}</p>
        <div class="bignum-expr">${p.expr} = ?</div>
      </div>
      <div class="hint" id="hint"></div>
      <div class="answers" id="answers"></div>
    </div>
  `);
  app.appendChild(view);
  p.options.forEach(o => {
    const b = el(`<button class="btn btn--big answer num-answer" data-correct="${o.correct}">${o.val.toLocaleString()}</button>`);
    b.onclick = () => chooseNum(o, b, `${p.expr} = ${p.answer.toLocaleString()}`);
    view.querySelector('#answers').appendChild(b);
  });
}

function chooseNum(o, btn, explainText) {
  const p = problem;
  if (p.locked) return;
  const hint = document.getElementById('hint');
  if (o.correct) {
    btn.classList.add('correct');
    commitCorrect(p, btn);
    hint.textContent = p.tries===0 ? 'כל הכבוד! ⭐⭐⭐' : 'יפה! ⭐';
    setTimeout(() => nextProblem(false), 900);
  } else {
    p.tries++;
    audio.wrong();
    btn.classList.add('wrong');
    setTimeout(() => btn.classList.remove('wrong'), 350);
    if (p.tries >= 2) {
      const right = document.querySelector('.num-answer[data-correct="true"]');
      if (right) right.classList.add('correct');
      hint.textContent = explainText;
      commitWrongReveal(p);
      showContinue();
    } else {
      hint.textContent = 'לא בדיוק — נסי שוב';
    }
  }
}

// ---------- Quadrilateral properties — true/false ----------
const QUAD_TF = [
  // TRUE
  { he: 'מלבן הוא גם מקבילית', correct: true,  explain: 'למלבן שתי זוגות צלעות מקבילות' },
  { he: 'ריבוע הוא גם מלבן',   correct: true,  explain: 'לריבוע 4 זוויות ישרות, כמו מלבן' },
  { he: 'ריבוע הוא גם מעוין',  correct: true,  explain: 'לריבוע 4 צלעות שוות, כמו מעוין' },
  { he: 'מעוין הוא גם מקבילית',correct: true,  explain: 'למעוין שתי זוגות צלעות מקבילות' },
  { he: 'לריבוע כל הצלעות שוות', correct: true, explain: '4 צלעות שוות — זו הגדרת הריבוע' },
  { he: 'לריבוע כל הזוויות 90°', correct: true, explain: '4 זוויות ישרות — זו הגדרת הריבוע' },
  { he: 'למלבן האלכסונים שווים',  correct: true, explain: 'תכונה מיוחדת של המלבן' },
  { he: 'למעוין האלכסונים ניצבים זה לזה', correct: true, explain: 'האלכסונים של מעוין חוצים זה את זה ב-90°' },
  { he: 'לטרפז יש זוג אחד של צלעות מקבילות', correct: true, explain: 'זו ההגדרה של טרפז' },
  { he: 'לדלתון יש שני זוגות צלעות שכנות שוות', correct: true, explain: 'זו ההגדרה של דלתון' },
  { he: 'לכל מקבילית הצלעות הנגדיות שוות', correct: true, explain: 'צלעות נגדיות במקבילית תמיד שוות' },
  { he: 'לריבוע האלכסונים ניצבים זה לזה', correct: true, explain: 'ריבוע הוא גם מעוין, ולמעוין אלכסונים ניצבים' },
  { he: 'לריבוע האלכסונים שווים', correct: true, explain: 'ריבוע הוא גם מלבן, ולמלבן אלכסונים שווים' },
  { he: 'למקבילית הזוויות הנגדיות שוות', correct: true, explain: 'תכונת בסיס של כל מקבילית' },
  { he: 'לכל מקבילית האלכסונים חוצים זה את זה', correct: true, explain: 'האלכסונים תמיד חוצים זה את זה במקבילית' },
  { he: 'לריבוע יש 4 ציר סימטריה', correct: true, explain: 'לריבוע שני אלכסונים + שתי חציות של צלעות — 4 ציר' },
  { he: 'לדלתון יש לפחות ציר סימטריה אחד', correct: true, explain: 'לדלתון ציר סימטריה אחד לפחות' },
  // FALSE
  { he: 'כל מקבילית היא גם מלבן', correct: false, explain: 'מקבילית לא חייבת להיות בעלת זוויות ישרות' },
  { he: 'כל מקבילית היא גם מעוין', correct: false, explain: 'מקבילית לא חייבת להיות בעלת צלעות שוות' },
  { he: 'טרפז הוא גם מקבילית',   correct: false, explain: 'לטרפז זוג אחד בלבד — למקבילית שניים' },
  { he: 'לדלתון יש שתי זוגות צלעות מקבילות', correct: false, explain: 'לדלתון בדרך כלל אין צלעות מקבילות' },
  { he: 'לכל מקבילית האלכסונים שווים', correct: false, explain: 'רק במלבן (וריבוע) האלכסונים שווים' },
  { he: 'מלבן הוא גם מעוין',    correct: false, explain: 'מלבן לא חייב להיות בעל ארבע צלעות שוות' },
  { he: 'לכל מעוין הזוויות 90°', correct: false, explain: 'רק לריבוע יש זוויות 90° — לא לכל מעוין' },
  { he: 'ריבוע הוא גם טרפז',    correct: false, explain: 'לריבוע שתי זוגות צלעות מקבילות — לכן אינו טרפז' },
  { he: 'לטרפז תמיד האלכסונים שווים', correct: false, explain: 'רק לטרפז שווה-שוקיים האלכסונים שווים' },
  { he: 'כל מעוין הוא גם מלבן', correct: false, explain: 'מעוין לא חייב להיות בעל זוויות ישרות' },
  { he: 'לטרפז אין ציר סימטריה', correct: false, explain: 'לטרפז שווה-שוקיים יש ציר סימטריה' },
];

function makeQuadProblem(finalWin) {
  let idx, guard = 0;
  do { idx = Math.floor(rand() * QUAD_TF.length); }
  while (recentHas('qd:' + idx, 8) && guard++ < 30);
  remember('qd:' + idx);
  const q = QUAD_TF[idx];
  return { kind: 'quad', idx, statement: q.he, correct: q.correct, explain: q.explain, tries: 0, locked: false, finalWin };
}

function renderQuad() {
  const p = problem;
  app.innerHTML = '';
  const view = el(`
    <div class="round">
      ${roundTopbar()}
      <div class="prompt-card">
        <p class="prompt-text" style="font-size:clamp(17px,3.2vh,24px)">נכון או לא נכון?</p>
        ${p.finalWin ? '<div class="running">עוד אחת — כמעט שם! ⭐</div>' : ''}
      </div>
      <div class="quad-statement">${p.statement}</div>
      <div class="hint" id="hint"></div>
      <div class="answers answers--two">
        <button class="btn btn--big btn--teal answer" id="ans-true">✅ נכון</button>
        <button class="btn btn--big btn--coral answer" id="ans-false">❌ לא נכון</button>
      </div>
    </div>
  `);
  app.appendChild(view);
  view.querySelector('#ans-true').onclick  = () => chooseQuad(true,  view.querySelector('#ans-true'));
  view.querySelector('#ans-false').onclick = () => chooseQuad(false, view.querySelector('#ans-false'));
}

function chooseQuad(answer, btn) {
  const p = problem;
  if (p.locked) return;
  const hint = document.getElementById('hint');
  const isCorrect = answer === p.correct;
  if (isCorrect) {
    btn.classList.add('correct');
    commitCorrect(p, btn);
    hint.textContent = '✔ ' + p.explain;
    setTimeout(() => nextProblem(false), 1300);
  } else {
    p.tries++;
    p.locked = true;
    audio.wrong();
    btn.classList.add('wrong');
    const rightBtn = answer ? document.getElementById('ans-false') : document.getElementById('ans-true');
    if (rightBtn) rightBtn.classList.add('correct');
    hint.textContent = (p.correct ? '✅ נכון!' : '❌ לא נכון!') + ' — ' + p.explain;
    commitWrongReveal(p);
    showContinue();
  }
}

function makeShapeProblem(finalWin) {
  const subtype = finalWin ? 'name' : ['name', 'name', 'rule', 'build'][Math.floor(rand() * 4)];
  const pick = (keys) => {
    let k, guard = 0;
    do { k = keys[Math.floor(rand() * keys.length)]; } while (recentHas('sh:' + k, 3) && keys.length > 3 && guard++ < 16);
    return k;
  };
  if (subtype === 'build') {
    const key = pick(BUILD_KEYS);
    remember('sh:' + key);
    return { kind: 'shapes', subtype, key, corners: [], N: 5, need: 4, tries: 0, locked: false, finalWin };
  }
  const key = pick(SHAPE_KEYS);
  remember('sh:' + key);
  const others = shuffleInPlace(SHAPE_KEYS.filter((k) => k !== key)).slice(0, 3);
  const optionKeys = shuffleInPlace([key, ...others]);
  return { kind: 'shapes', subtype, key, optionKeys, tries: 0, locked: false, finalWin };
}

function renderShapes() {
  if (problem.subtype === 'name') return renderShapeName();
  if (problem.subtype === 'rule') return renderShapeByRule();
  return renderShapeBuild();
}

function renderShapeName() {
  const p = problem;
  app.innerHTML = '';
  const view = el(`
    <div class="round">
      ${roundTopbar()}
      <div class="prompt-card">
        <p class="prompt-text">${p.finalWin ? 'עוד אחת — את יכולה! ⭐' : 'איזו צורה זאת?'}</p>
      </div>
      <div class="shape-stage">${shapeSVG(SHAPES[p.key].pts, 200, COLORS[1])}</div>
      <div class="hint" id="hint"></div>
      <div class="answers" id="answers"></div>
    </div>
  `);
  app.appendChild(view);
  const answers = view.querySelector('#answers');
  p.optionKeys.forEach((k) => {
    const b = el(`<button class="btn answer" data-correct="${k === p.key}">${SHAPES[k].he}</button>`);
    b.onclick = () => chooseShape(k === p.key, b);
    answers.appendChild(b);
  });
}

function renderShapeByRule() {
  const p = problem;
  app.innerHTML = '';
  const view = el(`
    <div class="round">
      ${roundTopbar()}
      <div class="prompt-card">
        <p class="prompt-text" style="font-size:24px">${p.finalWin ? 'עוד אחת! ⭐' : 'איזו צורה מתאימה לכלל?'}</p>
        <div class="running">${SHAPES[p.key].rule}</div>
      </div>
      <div class="shape-options" id="answers"></div>
      <div class="hint" id="hint"></div>
    </div>
  `);
  app.appendChild(view);
  const answers = view.querySelector('#answers');
  p.optionKeys.forEach((k) => {
    const b = el(`<button class="shape-opt" data-correct="${k === p.key}">${shapeSVG(SHAPES[k].pts, 110, COLORS[2])}<span>${SHAPES[k].he}</span></button>`);
    b.onclick = () => chooseShape(k === p.key, b);
    answers.appendChild(b);
  });
}

// generic multiple-choice handler shared by shapes + triangles
function chooseChoice(isCorrect, btn, revealText) {
  const p = problem;
  if (p.locked) return;
  const hint = document.getElementById('hint');
  if (isCorrect) {
    const firstTry = p.tries === 0;
    btn.classList.add('correct');
    commitCorrect(p, btn);
    hint.textContent = firstTry ? 'כל הכבוד! ⭐⭐⭐' : 'יפה! ⭐';
    setTimeout(() => nextProblem(false), 900);
  } else {
    p.tries++;
    audio.wrong();
    btn.classList.add('wrong');
    setTimeout(() => btn.classList.remove('wrong'), 350);
    if (p.tries >= 2) {
      hint.textContent = revealText;
      const right = document.querySelector('[data-correct="true"]');
      if (right) right.classList.add('correct');
      commitWrongReveal(p);
      showContinue();
    } else {
      hint.textContent = 'כמעט! נסי שוב';
    }
  }
}

function chooseShape(isCorrect, btn) {
  chooseChoice(isCorrect, btn, `זאת ${SHAPES[problem.key].he}.`);
}

// ---- build mode (tap 4 dots on a grid) ----
function renderShapeBuild() {
  const p = problem;
  const span = (p.N - 1) * 100;
  app.innerHTML = '';
  const view = el(`
    <div class="round">
      ${roundTopbar()}
      <div class="prompt-card">
        <p class="prompt-text">בְּני: <span class="a">${SHAPES[p.key].he}</span></p>
        <div class="running" id="running">הקישי על 4 נקודות כדי לבנות את הצורה</div>
      </div>
      <div class="grid-wrap"><svg id="grid" viewBox="-30 -30 ${span + 60} ${span + 60}"></svg></div>
      <div class="hint" id="hint"></div>
      <div class="answers"><button class="btn btn--ghost" id="clear">נקה</button></div>
    </div>
  `);
  app.appendChild(view);
  drawGrid();
  view.querySelector('#clear').onclick = () => {
    if (p.locked) return;
    p.corners = [];
    drawGrid();
    const r = document.getElementById('running');
    if (r) r.textContent = 'הקישי על 4 נקודות כדי לבנות את הצורה';
  };
}

function drawGrid() {
  const p = problem, N = p.N, S = 100, svg = document.getElementById('grid');
  if (!svg) return;
  const need = p.need || 4;
  let shape = '';
  if (p.corners.length >= 2 && p.corners.length < need) {
    shape = `<polyline points="${p.corners.map((c) => c.x * S + ',' + c.y * S).join(' ')}" fill="none" stroke="#7b4dff" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>`;
  } else if (p.corners.length === need) {
    const o = orderCyclic(p.corners);
    shape = `<polygon points="${o.map((c) => c.x * S + ',' + c.y * S).join(' ')}" fill="rgba(123,77,255,.18)" stroke="#7b4dff" stroke-width="7" stroke-linejoin="round"/>`;
  }
  let dots = '';
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const placed = p.corners.some((c) => c.x === x && c.y === y);
    dots += `<circle class="gdot" data-x="${x}" data-y="${y}" cx="${x * S}" cy="${y * S}" r="${placed ? 22 : 13}" fill="${placed ? '#ff5db1' : '#cbb8ff'}"/>`;
  }
  svg.innerHTML = shape + dots;
  [...svg.querySelectorAll('.gdot')].forEach((d) => { d.onclick = () => tapDot(+d.dataset.x, +d.dataset.y); });
}

function tapDot(x, y) {
  const p = problem;
  if (p.locked) return;
  const need = p.need || 4;
  const idx = p.corners.findIndex((c) => c.x === x && c.y === y);
  if (idx >= 0) { p.corners.splice(idx, 1); drawGrid(); return; }
  if (p.corners.length >= need) return;
  audio.pop();
  p.corners.push({ x, y });
  drawGrid();
  if (p.corners.length === need) (p.kind === 'tri' ? checkTriBuild() : checkBuild());
}

function checkBuild() {
  const p = problem;
  const hint = document.getElementById('hint');
  const res = isShape(p.corners, p.key);
  if (res.ok) {
    p.locked = true;
    commitCorrect(p, document.getElementById('grid'));
    hint.textContent = `כל הכבוד! בנית ${SHAPES[p.key].he}! ⭐`;
    setTimeout(() => nextProblem(false), 1200);
  } else {
    p.tries++;
    audio.wrong();
    if (p.tries >= 2) {
      p.locked = true;
      hint.textContent = `זה לא בדיוק ${SHAPES[p.key].he}. ככה זה נראה:`;
      p.corners = BUILD_EXAMPLES[p.key].slice();
      drawGrid();
      commitWrongReveal(p);
      showContinue();
    } else {
      hint.textContent = (res.msg ? res.msg + ' — ' : '') + 'נסי שוב';
      p.corners = [];
      drawGrid();
    }
  }
}

// geometry helpers
function orderCyclic(pts) {
  const n = pts.length;
  const cx = pts.reduce((s, p) => s + p.x, 0) / n;
  const cy = pts.reduce((s, p) => s + p.y, 0) / n;
  return pts.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
}
function polyArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a.x * b.y - b.x * a.y; }
  return Math.abs(s / 2);
}
function isShape(corners, key) {
  for (let i = 0; i < corners.length; i++) for (let j = i + 1; j < corners.length; j++)
    if (corners[i].x === corners[j].x && corners[i].y === corners[j].y) return { ok: false, msg: 'יש נקודות כפולות' };
  const pts = orderCyclic(corners);
  if (polyArea(pts) < 0.5) return { ok: false, msg: 'הנקודות על קו אחד' };
  const e = [];
  for (let i = 0; i < 4; i++) e.push({ x: pts[(i + 1) % 4].x - pts[i].x, y: pts[(i + 1) % 4].y - pts[i].y });
  const L = e.map((v) => v.x * v.x + v.y * v.y);
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  const perp = (i) => dot(e[(i + 3) % 4], e[i]) === 0;
  const allRight = perp(0) && perp(1) && perp(2) && perp(3);
  const par02 = cross(e[0], e[2]) === 0;
  const par13 = cross(e[1], e[3]) === 0;
  const oppEqual = L[0] === L[2] && L[1] === L[3];
  const allEqual = L[0] === L[1] && L[1] === L[2] && L[2] === L[3];
  switch (key) {
    case 'square': return { ok: allEqual && allRight, msg: 'צריך 4 צלעות שוות וזוויות ישרות' };
    case 'rectangle': return { ok: allRight && oppEqual && !allEqual, msg: 'צריך 4 זוויות ישרות (ולא ריבוע)' };
    case 'parallelogram': return { ok: par02 && par13 && oppEqual && !allRight && !allEqual, msg: 'צריך 2 זוגות צלעות מקבילות (לא ישרות)' };
    case 'trapezoid': return { ok: (par02 !== par13), msg: 'צריך בדיוק זוג אחד של צלעות מקבילות' };
    case 'rhombus': return { ok: allEqual && !allRight, msg: 'צריך 4 צלעות שוות (אבל לא ריבוע)' };
    case 'kite': return { ok: ((L[0] === L[1] && L[2] === L[3]) || (L[1] === L[2] && L[3] === L[0])) && !allEqual, msg: 'צריך 2 זוגות של צלעות צמודות שוות' };
    default: return { ok: false };
  }
}

// ====================== TRIANGLES GAME ======================
const TRI_SIDES = {
  equilateral: { he: 'שווה־צלעות',  pts: '50,14 86,80 14,80', rule: 'כל שלוש הצלעות שוות' },
  isosceles:   { he: 'שווה־שוקיים', pts: '50,12 80,82 20,82', rule: 'שתי צלעות שוות' },
  scalene:     { he: 'שונה־צלעות',  pts: '16,80 90,80 66,26', rule: 'כל הצלעות שונות זו מזו' },
};
const TRI_ANGLES = {
  acute:  { he: 'חד־זווית',  pts: '50,16 82,80 18,80', rule: 'כל הזוויות קטנות מ-90°' },
  right:  { he: 'ישר־זווית', pts: '20,18 20,80 78,80', rule: 'יש בו זווית של 90°' },
  obtuse: { he: 'קהה־זווית', pts: '10,72 94,72 40,44', rule: 'יש בו זווית גדולה מ-90°' },
};
const TRI_BUILD = {
  right:     { he: 'ישר־זווית',  ex: [{x:1,y:1},{x:1,y:4},{x:4,y:4}] },
  isosceles: { he: 'שווה־שוקיים', ex: [{x:2,y:0},{x:0,y:4},{x:4,y:4}] },
  scalene:   { he: 'שונה־צלעות',  ex: [{x:0,y:0},{x:4,y:1},{x:2,y:4}] },
};
const TRI_BUILD_KEYS = Object.keys(TRI_BUILD);
const TRI_FILL = '#ff9a3d'; // coral (COLORS[4]) — inlined to avoid TDZ at load

function makeTriangleProblem(finalWin) {
  const subtype = finalWin ? 'sideName' : ['sideName', 'angleName', 'rule', 'anglefact', 'build'][Math.floor(rand() * 5)];
  if (subtype === 'build') {
    let key, guard = 0;
    do { key = TRI_BUILD_KEYS[Math.floor(rand() * TRI_BUILD_KEYS.length)]; } while (recentHas('tr:build:' + key, 2) && guard++ < 12);
    remember('tr:build:' + key);
    return { kind: 'tri', subtype, target: key, corners: [], N: 5, need: 3, tries: 0, locked: false, finalWin };
  }
  if (subtype === 'anglefact') {
    let a, b, tg = 0;
    do { a = 20 + Math.floor(rand() * 9) * 10; b = 20 + Math.floor(rand() * 9) * 10; }
    while ((a + b >= 170 || a + b < 40 || recentHas('tr:af:' + Math.min(a, b) + '-' + Math.max(a, b), 6)) && tg++ < 40);
    remember('tr:af:' + Math.min(a, b) + '-' + Math.max(a, b));
    const answer = 180 - a - b;
    const opts = new Set([answer]);
    let guard = 0;
    while (opts.size < 4 && guard++ < 60) { const c = answer + [10, -10, 20, -20, 30][Math.floor(rand() * 5)]; if (c > 0 && c < 160) opts.add(c); }
    return { kind: 'tri', subtype, a1: a, a2: b, answer, options: shuffleInPlace([...opts]), tries: 0, locked: false, finalWin };
  }
  const set = subtype === 'angleName' ? TRI_ANGLES : (subtype === 'rule' ? (rand() < 0.5 ? TRI_SIDES : TRI_ANGLES) : TRI_SIDES);
  const setName = set === TRI_ANGLES ? 'angles' : 'sides';
  const keys = Object.keys(set);
  let key, g = 0;
  do { key = keys[Math.floor(rand() * keys.length)]; } while (recentHas('tr:' + setName + ':' + key, 2) && g++ < 12);
  remember('tr:' + setName + ':' + key);
  return { kind: 'tri', subtype, set, setName, key, tries: 0, locked: false, finalWin };
}

function renderTriangles() {
  const p = problem;
  if (p.subtype === 'build') return renderTriBuild();
  if (p.subtype === 'anglefact') return renderTriAngleFact();
  if (p.subtype === 'rule') return renderTriByRule();
  return renderTriByName();
}

function renderTriByName() {
  const p = problem;
  const q = p.setName === 'angles' ? 'איזה משולש לפי הזוויות?' : 'איזה משולש לפי הצלעות?';
  app.innerHTML = '';
  const view = el(`
    <div class="round">
      ${roundTopbar()}
      <div class="prompt-card"><p class="prompt-text" style="font-size:24px">${p.finalWin ? 'עוד אחת! ⭐' : q}</p></div>
      <div class="shape-stage">${shapeSVG(p.set[p.key].pts, 200, TRI_FILL)}</div>
      <div class="hint" id="hint"></div>
      <div class="answers" id="answers"></div>
    </div>
  `);
  app.appendChild(view);
  const answers = view.querySelector('#answers');
  shuffleInPlace(Object.keys(p.set)).forEach((k) => {
    const b = el(`<button class="btn answer" data-correct="${k === p.key}" style="font-size:22px">${p.set[k].he}</button>`);
    b.onclick = () => chooseChoice(k === p.key, b, `זה ${p.set[p.key].he}.`);
    answers.appendChild(b);
  });
}

function renderTriByRule() {
  const p = problem;
  app.innerHTML = '';
  const view = el(`
    <div class="round">
      ${roundTopbar()}
      <div class="prompt-card">
        <p class="prompt-text" style="font-size:22px">${p.finalWin ? 'עוד אחת! ⭐' : 'איזה משולש מתאים לכלל?'}</p>
        <div class="running">${p.set[p.key].rule}</div>
      </div>
      <div class="shape-options" id="answers"></div>
      <div class="hint" id="hint"></div>
    </div>
  `);
  app.appendChild(view);
  const answers = view.querySelector('#answers');
  shuffleInPlace(Object.keys(p.set)).forEach((k) => {
    const b = el(`<button class="shape-opt" data-correct="${k === p.key}">${shapeSVG(p.set[k].pts, 110, TRI_FILL)}<span>${p.set[k].he}</span></button>`);
    b.onclick = () => chooseChoice(k === p.key, b, `זה ${p.set[p.key].he}.`);
    answers.appendChild(b);
  });
}

function triAngleSVG(a1, a2) {
  return `<svg width="230" height="170" viewBox="0 0 230 170" aria-hidden="true">
    <polygon points="20,150 210,150 150,28" fill="${TRI_FILL}" stroke="#2a2150" stroke-width="3" stroke-linejoin="round"/>
    <text x="42" y="140" font-size="20" font-weight="800" fill="#2a2150">${a1}°</text>
    <text x="172" y="143" font-size="20" font-weight="800" fill="#2a2150">${a2}°</text>
    <text x="138" y="58" font-size="24" font-weight="800" fill="#ff5db1">?</text>
  </svg>`;
}

function renderTriAngleFact() {
  const p = problem;
  app.innerHTML = '';
  const view = el(`
    <div class="round">
      ${roundTopbar()}
      <div class="prompt-card">
        <p class="prompt-text" style="font-size:22px">${p.finalWin ? 'עוד אחת! ⭐' : 'מה הזווית השלישית?'}</p>
        <div class="running">הזוויות במשולש יחד = 180°</div>
      </div>
      <div class="shape-stage">${triAngleSVG(p.a1, p.a2)}</div>
      <div class="hint" id="hint"></div>
      <div class="answers" id="answers"></div>
    </div>
  `);
  app.appendChild(view);
  const answers = view.querySelector('#answers');
  p.options.forEach((opt) => {
    const b = el(`<button class="btn answer" data-correct="${opt === p.answer}">${opt}°</button>`);
    b.onclick = () => chooseChoice(opt === p.answer, b, `התשובה: ${p.answer}°  (180−${p.a1}−${p.a2})`);
    answers.appendChild(b);
  });
}

function renderTriBuild() {
  const p = problem;
  const span = (p.N - 1) * 100;
  app.innerHTML = '';
  const view = el(`
    <div class="round">
      ${roundTopbar()}
      <div class="prompt-card">
        <p class="prompt-text">בְּני משולש: <span class="a">${TRI_BUILD[p.target].he}</span></p>
        <div class="running" id="running">הקישי על 3 נקודות כדי לבנות את המשולש</div>
      </div>
      <div class="grid-wrap"><svg id="grid" viewBox="-30 -30 ${span + 60} ${span + 60}"></svg></div>
      <div class="hint" id="hint"></div>
      <div class="answers"><button class="btn btn--ghost" id="clear">נקה</button></div>
    </div>
  `);
  app.appendChild(view);
  drawGrid();
  view.querySelector('#clear').onclick = () => {
    if (p.locked) return;
    p.corners = [];
    drawGrid();
    const r = document.getElementById('running');
    if (r) r.textContent = 'הקישי על 3 נקודות כדי לבנות את המשולש';
  };
}

function checkTriBuild() {
  const p = problem;
  const hint = document.getElementById('hint');
  const res = isTriangle(p.corners, p.target);
  if (res.ok) {
    p.locked = true;
    commitCorrect(p, document.getElementById('grid'));
    hint.textContent = `כל הכבוד! בנית משולש ${TRI_BUILD[p.target].he}! ⭐`;
    setTimeout(() => nextProblem(false), 1300);
  } else {
    p.tries++;
    audio.wrong();
    if (p.tries >= 2) {
      p.locked = true;
      hint.textContent = `זה לא בדיוק ${TRI_BUILD[p.target].he}. ככה זה נראה:`;
      p.corners = TRI_BUILD[p.target].ex.slice();
      drawGrid();
      commitWrongReveal(p);
      showContinue();
    } else {
      hint.textContent = (res.msg ? res.msg + ' — ' : '') + 'נסי שוב';
      p.corners = [];
      drawGrid();
    }
  }
}

function triSides(pts) {
  const d = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; };
  return [d(pts[0], pts[1]), d(pts[1], pts[2]), d(pts[2], pts[0])];
}
function isTriangle(corners, target) {
  const [a, b, c] = corners;
  const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
  if (area === 0) return { ok: false, msg: 'הנקודות על קו אחד' };
  const L = triSides(corners).slice().sort((x, y) => x - y);
  const right = L[0] + L[1] === L[2];
  const iso = L[0] === L[1] || L[1] === L[2] || L[0] === L[2];
  const scalene = L[0] !== L[1] && L[1] !== L[2] && L[0] !== L[2];
  switch (target) {
    case 'right': return { ok: right, msg: 'צריך זווית של 90°' };
    case 'isosceles': return { ok: iso, msg: 'צריך שתי צלעות שוות' };
    case 'scalene': return { ok: scalene, msg: 'צריך שכל הצלעות יהיו שונות' };
    default: return { ok: false };
  }
}

function endRound() {
  if (round.reviewMode) {
    const idx = round.reviewSessionIdx;
    if (!state.review) state.review = {sessions:[{},{},{},{},{}]};
    const prev = state.review.sessions[idx] || {};
    state.review.sessions[idx] = {done: true, stars: Math.max(prev.stars||0, round.starsEarned)};
    state.lastPlayed = Date.now();
    save(state);
    syncNow(true);
    renderReviewComplete(idx, round.starsEarned);
    return;
  }
  satisfyCraving(round.mode);
  const si = stageIndex(state.stars);
  state.lastPlayed = Date.now();
  save(state);
  syncNow(true);   // push fresh progress to the parent's sync URL (if set)
  app.innerHTML = '';
  const end = el(`
    <div class="end">
      <h2>כל הכבוד! 🎉</h2>
      <div class="dragon-wrap">
        ${dragonSVG(si)}
        <div class="dragon-name">${PET}</div>
        <div class="dragon-stage">${STAGES[si].label}</div>
      </div>
      <div class="earned">צברת <span class="star">★</span> ${round.starsEarned} הפעם</div>
      <div class="stars-pill"><span class="star">★</span> ${state.stars} בסך הכול</div>
      <button class="btn btn--big btn--teal" id="home">חזרה הביתה</button>
      <p class="cooldown">תחזרי אחר כך — ספארקי צריך לנוח 😴</p>
    </div>
  `);
  app.appendChild(end);
  end.querySelector('#home').onclick = () => renderHome();
  confetti(40);
}

// ---------- fx ----------
const fx = document.getElementById('fx');
const COLORS = ['#ff5db1', '#7b4dff', '#21c1a6', '#ffd23f', '#ff9a3d'];
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function confetti(n = 22) {
  if (reduce) return;
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.background = COLORS[i % COLORS.length];
    c.style.left = (40 + Math.random() * 20) + '%';
    c.style.top = '40%';
    fx.appendChild(c);
    const dx = (Math.random() - 0.5) * 360;
    const dy = -120 - Math.random() * 220;
    const rot = (Math.random() - 0.5) * 720;
    c.animate(
      [
        { transform: 'translate(0,0) rotate(0)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`, opacity: 1, offset: .7 },
        { transform: `translate(${dx * 1.2}px, ${dy + 320}px) rotate(${rot}deg)`, opacity: 0 },
      ],
      { duration: 1100 + Math.random() * 500, easing: 'cubic-bezier(.2,.6,.3,1)' }
    ).onfinish = () => c.remove();
  }
}

function flyStars(n, fromEl) {
  if (reduce || !fromEl) return;
  const r = fromEl.getBoundingClientRect();
  for (let i = 0; i < Math.min(n, 5); i++) {
    const s = document.createElement('div');
    s.className = 'flystar';
    s.textContent = '★';
    s.style.left = (r.left + r.width / 2) + 'px';
    s.style.top = (r.top) + 'px';
    fx.appendChild(s);
    const dx = (Math.random() - 0.5) * 80;
    s.animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${dx}px, -${120 + i * 14}px) scale(1.4)`, opacity: 0 },
      ],
      { duration: 800, easing: 'ease-out', delay: i * 60 }
    ).onfinish = () => s.remove();
  }
}

// ---------- service worker (offline) ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// keep the dot grid fitting on orientation / resize changes
window.addEventListener('resize', () => {
  if (round && round.mode === 'count' && problem && problem.a) {
    const stage = document.querySelector('.round .stage');
    sizeDots(stage, document.getElementById('dots'), problem.a, problem.b);
  }
});

// ---------- round back-navigation ----------
const ROUND_BACK = {
  count: renderMultiplicationMenu, pop: renderMultiplicationMenu,
  tables: renderMultiplicationMenu, drill: renderMultiplicationMenu,
  division: renderDivisionMenu, oporder: renderCalcMenu, bignum: renderCalcMenu,
  primes: renderNumbersMenu, factors: renderNumbersMenu, numline: renderNumbersMenu,
  shapes: renderGeometryMenu, triangles: renderGeometryMenu,
  rect: renderGeometryMenu, quads: renderGeometryMenu,
  fractions: renderHome,
  review: renderReviewMenu,
};

document.addEventListener('click', (e) => {
  if (e.target.closest('#round-back') && round) {
    const mode = round.mode;
    round = null;
    (ROUND_BACK[mode] || renderHome)();
  }
});

// ---------- go ----------
renderHome();
