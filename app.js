/* DragonMath — game logic.
   One specific kid, ~11-12, ADHD. Builds 1-10 multiplication fluency.
   ADHD rules baked in: one thing on screen, reward the attempt, trivial start,
   visible progress, hard stop. No network, all state in localStorage. */

'use strict';

// ---------- persistence ----------
const SAVE_KEY = 'dragonmath.save.v1';

const defaultSave = () => ({
  stars: 0,            // lifetime stars -> dragon growth
  mastery: {},         // "a x b" -> {seen, correct}
  lastPlayed: 0,
  muted: false,        // sound on/off
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

// ---------- dragon growth ----------
// 5 stages by lifetime stars. Each stage = bigger + new accessory.
const STAGES = [
  { name: 'Eggbert',  min: 0,   label: 'a wobbly egg' },
  { name: 'Sparky',   min: 30,  label: 'a baby dragon' },
  { name: 'Blaze',    min: 90,  label: 'a young dragon' },
  { name: 'Ember',    min: 200, label: 'a strong dragon' },
  { name: 'Pyrus',    min: 400, label: 'a mighty dragon!' },
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

// Cute SVG dragon. Scale + crown/wings appear by stage.
function dragonSVG(stage) {
  const scale = [0.74, 0.86, 1.0, 1.12, 1.25][stage];
  const crown = stage >= 4
    ? '<path d="M70 36 l8 -16 8 12 8 -16 8 16 8 -12 8 16 z" fill="#ffd23f" stroke="#2a2150" stroke-width="3" stroke-linejoin="round"/>'
    : '';
  const wings = stage >= 2
    ? '<path d="M40 96 q-34 -10 -30 30 q22 -10 34 4 z" fill="#7b4dff" stroke="#2a2150" stroke-width="3"/>' +
      '<path d="M160 96 q34 -10 30 30 q-22 -10 -34 4 z" fill="#7b4dff" stroke="#2a2150" stroke-width="3"/>'
    : '';
  // Egg-only look for stage 0
  if (stage === 0) {
    return `<svg class="dragon-svg dragon-bob" viewBox="0 0 200 200" role="img" aria-label="${STAGES[0].name}, ${STAGES[0].label}">
      <ellipse cx="100" cy="118" rx="58" ry="70" fill="#ffe9c7" stroke="#2a2150" stroke-width="4"/>
      <path d="M55 110 l16 14 14 -16 14 16 14 -16 16 16" fill="none" stroke="#ff9a3d" stroke-width="6" stroke-linecap="round"/>
      <circle cx="84" cy="96" r="6" fill="#2a2150"/><circle cx="116" cy="96" r="6" fill="#2a2150"/>
    </svg>`;
  }
  return `<svg class="dragon-svg dragon-bob" viewBox="0 0 200 200" role="img" aria-label="${STAGES[stage].name}, ${STAGES[stage].label}" style="transform:scale(${scale})">
    ${wings}
    <ellipse cx="100" cy="130" rx="56" ry="52" fill="#21c1a6" stroke="#2a2150" stroke-width="4"/>
    <ellipse cx="100" cy="148" rx="34" ry="28" fill="#bff3e8" stroke="#2a2150" stroke-width="3"/>
    <circle cx="100" cy="78" r="44" fill="#21c1a6" stroke="#2a2150" stroke-width="4"/>
    ${crown}
    <circle cx="84" cy="74" r="9" fill="#fff" stroke="#2a2150" stroke-width="3"/>
    <circle cx="116" cy="74" r="9" fill="#fff" stroke="#2a2150" stroke-width="3"/>
    <circle cx="86" cy="76" r="4" fill="#2a2150"/><circle cx="118" cy="76" r="4" fill="#2a2150"/>
    <path d="M92 96 q8 8 16 0" fill="none" stroke="#2a2150" stroke-width="4" stroke-linecap="round"/>
    <path d="M70 44 l-6 -16 18 8 z" fill="#ff5db1" stroke="#2a2150" stroke-width="3" stroke-linejoin="round"/>
    <path d="M130 44 l6 -16 -18 8 z" fill="#ff5db1" stroke="#2a2150" stroke-width="3" stroke-linejoin="round"/>
  </svg>`;
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
  let r = rand() * total;
  for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) return pool[i]; }
  return pool[pool.length - 1];
}
// deterministic-ish PRNG seeded by time, fine for a game
let _seed = (Date.now() >>> 0) || 12345;
function rand() { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; }

function recordAttempt(a, b, correct) {
  const k = factKey(a, b);
  const m = state.mastery[k] || { seen: 0, correct: 0 };
  m.seen++; if (correct) m.correct++;
  state.mastery[k] = m;
}

// ---------- answer options ----------
function answerOptions(answer) {
  const opts = new Set([answer]);
  let guard = 0;
  while (opts.size < 4 && guard++ < 50) {
    const delta = [-2, -1, 1, 2, 3, -3][Math.floor(rand() * 6)];
    const cand = answer + delta;
    if (cand > 0 && cand <= 120) opts.add(cand);
  }
  const arr = [...opts];
  // shuffle
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

// ---------- round controller (stop rule combo D) ----------
const ROUND = { maxProblems: 12, maxMs: 5 * 60 * 1000, maxWrongStreak: 3 };
let round = null;

function startRound(mode) {
  audio.ensure(); // first user gesture — unlock audio
  round = {
    mode: mode || 'count', // 'count' = Build & Count, 'pop' = Bubble Pop
    index: 0,
    correctCount: 0,
    starsEarned: 0,
    wrongStreak: 0,
    combo: 0,
    startTs: Date.now(),
    ending: false,
  };
  nextProblem(true);
}

function roundShouldEnd() {
  if (!round) return true;
  if (round.index >= ROUND.maxProblems) return true;
  if (Date.now() - round.startTs >= ROUND.maxMs) return true;
  if (round.wrongStreak >= ROUND.maxWrongStreak) return true;
  return false;
}

let problem = null;
function nextProblem(trivial) {
  const makers = { shapes: makeShapeProblem, triangles: makeTriangleProblem, division: makeDivisionProblem, primes: makePrimeProblem, fractions: makeFractionProblem };
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
  const before = stageIndex(state.stars);
  round.starsEarned += n;
  state.stars += n;
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
  const si = stageIndex(state.stars);
  const prog = Math.round(stageProgress(state.stars) * 100);
  app.innerHTML = '';
  const home = el(`
    <div class="home">
      <div class="topbar">
        <h1 class="title">Dragon<b>Math</b></h1>
        <button class="mute" id="mute" aria-label="${state.muted ? 'Unmute' : 'Mute'}">${state.muted ? '🔇' : '🔊'}</button>
      </div>
      <div class="dragon-wrap">
        ${dragonSVG(si)}
        <div class="dragon-name">${STAGES[si].name}</div>
        <div class="dragon-stage">${STAGES[si].label}</div>
        <div class="progress xpbar"><i style="width:${prog}%"></i></div>
      </div>
      <div class="stars-pill"><span class="star">★</span> ${state.stars}</div>
      <div class="mode-buttons">
        <button class="btn btn--big btn--teal" id="play-count">🔢 Count &amp; Learn</button>
        <button class="btn btn--big btn--pink" id="play-pop">⚡ Bubble Pop</button>
        <button class="btn btn--big btn--coral" id="play-shapes">🔷 Shapes</button>
        <button class="btn btn--big" id="play-triangles">📐 Triangles</button>
        <button class="btn btn--big btn--teal" id="play-division">➗ Division</button>
        <button class="btn btn--big btn--pink" id="play-primes">🧱 Primes</button>
        <button class="btn btn--big btn--coral" id="play-fractions">🍕 Fractions</button>
      </div>
      <p class="subtitle">Multiply, divide, pop bubbles & learn shapes — grow your dragon!</p>
    </div>
  `);
  app.appendChild(home);
  home.querySelector('#play-count').onclick = () => startRound('count');
  home.querySelector('#play-pop').onclick = () => startRound('pop');
  home.querySelector('#play-shapes').onclick = () => startRound('shapes');
  home.querySelector('#play-triangles').onclick = () => startRound('triangles');
  home.querySelector('#play-division').onclick = () => startRound('division');
  home.querySelector('#play-primes').onclick = () => startRound('primes');
  home.querySelector('#play-fractions').onclick = () => startRound('fractions');
  home.querySelector('#mute').onclick = (e) => {
    state.muted = !state.muted;
    save(state);
    e.target.textContent = state.muted ? '🔇' : '🔊';
    e.target.setAttribute('aria-label', state.muted ? 'Unmute' : 'Mute');
    if (!state.muted) { audio.ensure(); audio.pop(); }
  };
}

function roundTopbar() {
  const left = Math.max(0, ROUND.maxProblems - round.index);
  const pct = (round.index / ROUND.maxProblems) * 100;
  const combo = round.combo >= 2 ? `<div class="combo">🔥 ×${round.combo}</div>` : '';
  return `
    <div class="topbar">
      <div class="progress"><i style="width:${pct}%"></i></div>
      ${combo}
      <div class="left-count">${left} left</div>
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

function renderBuildCount() {
  const p = problem;
  app.innerHTML = '';
  const view = el(`
    <div class="round">
      ${roundTopbar()}
      <div class="prompt-card">
        <p class="prompt-text">${p.a === 1 ? 'קבוצה אחת' : `<span class="a">${p.a}</span> קבוצות`} של <span class="b">${p.b}</span> = ?</p>
        <div class="running" id="running">${p.finalWin ? 'עוד אחת — את יכולה! ⭐' : 'כמה נקודות יש בסך הכול?'}</div>
      </div>
      <div class="stage"><div class="dots" id="dots"></div></div>
      <div class="hint" id="hint"></div>
      <div class="answers" id="answers"></div>
    </div>
  `);
  app.appendChild(view);

  // dots
  const dots = view.querySelector('#dots');
  for (let r = 0; r < p.a; r++) {
    const row = el(`<div class="dot-row" data-row="${r}" style="grid-template-columns:repeat(${p.b},var(--dot)) auto"></div>`);
    for (let c = 0; c < p.b; c++) row.appendChild(el('<span class="dot"></span>'));
    const tag = el('<span class="row-tag"></span>');
    row.appendChild(tag);
    dots.appendChild(row);
  }
  // size dots to fit BOTH the width and height of the stage (never scroll)
  requestAnimationFrame(() => sizeDots(view.querySelector('.stage'), dots, p.a, p.b));

  // answers
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
  if (p.a && p.b) recordAttempt(p.a, p.b, p.tries === 0);
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
  if (p.a && p.b) recordAttempt(p.a, p.b, false);
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
      revealAllRows();
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
  let divisor, quotient;
  if (easy) {
    divisor = 2 + Math.floor(rand() * 2);    // 2..3 rows
    quotient = 2 + Math.floor(rand() * 3);   // 2..4 per row
  } else {
    // weight by the underlying ×-fact she misses; skip the trivial ÷1 / =1 cases
    const pool = [];
    for (let d = 2; d <= 10; d++) for (let q = 2; q <= 10; q++) pool.push([d, q]);
    const weights = pool.map(([d, q]) => factWeight(d, q));
    const total = weights.reduce((x, y) => x + y, 0);
    let r = rand() * total, pick = pool[pool.length - 1];
    for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) { pick = pool[i]; break; } }
    [divisor, quotient] = pick;
    // no identical question back-to-back
    if (divisor + '/' + quotient === round.lastDivKey) return makeDivisionProblem(finalWin);
  }
  round.lastDivKey = divisor + '/' + quotient;
  return {
    kind: 'div', a: divisor, b: quotient, dividend: divisor * quotient,
    answer: quotient, options: answerOptions(quotient),
    tries: 0, locked: false, finalWin,
  };
}

function renderDivision() {
  const p = problem;
  app.innerHTML = '';
  const view = el(`
    <div class="round">
      ${roundTopbar()}
      <div class="prompt-card">
        <p class="prompt-text"><span class="a">${p.dividend}</span> ÷ <span class="b">${p.a}</span> = ?</p>
        <div class="running">${p.finalWin ? 'עוד אחת — את יכולה! ⭐' : `חילקנו ${p.dividend} נקודות ל-${p.a} שורות שוות. כמה בכל שורה?`}</div>
      </div>
      <div class="stage"><div class="dots" id="dots"></div></div>
      <div class="hint" id="hint"></div>
      <div class="answers" id="answers"></div>
    </div>
  `);
  app.appendChild(view);
  const dots = view.querySelector('#dots');
  for (let r = 0; r < p.a; r++) {
    const row = el(`<div class="dot-row" data-row="${r}" style="grid-template-columns:repeat(${p.b},var(--dot)) auto"></div>`);
    for (let c = 0; c < p.b; c++) row.appendChild(el('<span class="dot"></span>'));
    row.appendChild(el('<span class="row-tag"></span>'));
    dots.appendChild(row);
  }
  requestAnimationFrame(() => sizeDots(view.querySelector('.stage'), dots, p.a, p.b));
  const answers = view.querySelector('#answers');
  p.options.forEach((opt) => {
    const b = el(`<button class="btn answer">${opt}</button>`);
    b.onclick = () => chooseDivAnswer(opt, b);
    answers.appendChild(b);
  });
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
      hint.textContent = `התשובה היא ${p.answer}. ${p.dividend} ÷ ${p.a} = ${p.answer} — בכל שורה ${p.answer}.`;
      revealAllRows();
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
  } while (n === round.lastPrimeN && guard++ < 12);
  round.lastPrimeN = n;
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
      hint.textContent = 'נסי שוב — חשבי אם אפשר לסדר אותו במלבן';
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

function makeFractionProblem(finalWin) {
  const easy = finalWin || round.index === 0;
  const types = ['addSame', 'subSame', 'mul', 'addUnlike', 'subUnlike'];
  const subtype = easy ? 'addSame' : types[Math.floor(rand() * types.length)];
  const p = buildFrac(subtype, easy);
  const key = `${p.o1.n}/${p.o1.d}${p.op}${p.o2.n}/${p.o2.d}`;
  if (key === round.lastFracKey && !easy) return makeFractionProblem(finalWin);
  round.lastFracKey = key;
  p.kind = 'frac'; p.tries = 0; p.locked = false; p.finalWin = finalWin;
  p.options = fracOptions(p);
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
  const r = p.raw, a = p.ans;
  if (fsame(r, a)) return `התשובה: ${a.n}/${a.d}`;
  return `${r.n}/${r.d} = ${a.n}/${a.d} (מצמצמים)`;
}

function renderFractions() {
  const p = problem;
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

function revealFrac() {
  const p = problem;
  if (p.op === '×') return; // the grid already shows the shaded answer
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

function makeShapeProblem(finalWin) {
  const subtype = finalWin ? 'name' : ['name', 'name', 'rule', 'build'][Math.floor(rand() * 4)];
  const avoid = round.lastShapeKey;
  const pick = (keys) => {
    let k, guard = 0;
    do { k = keys[Math.floor(rand() * keys.length)]; } while (k === avoid && keys.length > 1 && guard++ < 12);
    return k;
  };
  if (subtype === 'build') {
    const key = pick(BUILD_KEYS);
    round.lastShapeKey = key;
    return { kind: 'shapes', subtype, key, corners: [], N: 5, need: 4, tries: 0, locked: false, finalWin };
  }
  const key = pick(SHAPE_KEYS);
  round.lastShapeKey = key;
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
    do { key = TRI_BUILD_KEYS[Math.floor(rand() * TRI_BUILD_KEYS.length)]; } while (key === round.lastShapeKey && guard++ < 8);
    round.lastShapeKey = key;
    return { kind: 'tri', subtype, target: key, corners: [], N: 5, need: 3, tries: 0, locked: false, finalWin };
  }
  if (subtype === 'anglefact') {
    let a, b;
    do { a = 20 + Math.floor(rand() * 9) * 10; b = 20 + Math.floor(rand() * 9) * 10; } while (a + b >= 170 || a + b < 40);
    const answer = 180 - a - b;
    const opts = new Set([answer]);
    let guard = 0;
    while (opts.size < 4 && guard++ < 60) { const c = answer + [10, -10, 20, -20, 30][Math.floor(rand() * 5)]; if (c > 0 && c < 160) opts.add(c); }
    return { kind: 'tri', subtype, a1: a, a2: b, answer, options: shuffleInPlace([...opts]), tries: 0, locked: false, finalWin };
  }
  const set = subtype === 'angleName' ? TRI_ANGLES : (subtype === 'rule' ? (rand() < 0.5 ? TRI_SIDES : TRI_ANGLES) : TRI_SIDES);
  const setName = set === TRI_ANGLES ? 'angles' : 'sides';
  const keys = Object.keys(set);
  const key = keys[Math.floor(rand() * keys.length)];
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
  const si = stageIndex(state.stars);
  state.lastPlayed = Date.now();
  save(state);
  app.innerHTML = '';
  const end = el(`
    <div class="end">
      <h2>Great job! 🎉</h2>
      <div class="dragon-wrap">
        ${dragonSVG(si)}
        <div class="dragon-name">${STAGES[si].name} grew!</div>
      </div>
      <div class="earned">You earned <span class="star">★</span> ${round.starsEarned} this round</div>
      <div class="stars-pill"><span class="star">★</span> ${state.stars} total</div>
      <button class="btn btn--big btn--teal" id="home">Back home</button>
      <p class="cooldown">Come back later — your dragon needs a rest 😴</p>
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

// ---------- go ----------
renderHome();
