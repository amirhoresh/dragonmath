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

function startRound() {
  round = {
    index: 0,
    correctCount: 0,
    starsEarned: 0,
    wrongStreak: 0,
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
  round.starsEarned += n;
  state.stars += n;
  save(state);
  flyStars(n, fromEl);
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
      <h1 class="title">Dragon<b>Math</b></h1>
      <div class="dragon-wrap">
        ${dragonSVG(si)}
        <div class="dragon-name">${STAGES[si].name}</div>
        <div class="dragon-stage">${STAGES[si].label}</div>
        <div class="progress xpbar"><i style="width:${prog}%"></i></div>
      </div>
      <div class="stars-pill"><span class="star">★</span> ${state.stars}</div>
      <button class="btn btn--big btn--pink" id="play">Play ▶</button>
      <p class="subtitle">Tap the rows, count them up, pick the answer!</p>
    </div>
  `);
  app.appendChild(home);
  home.querySelector('#play').onclick = () => startRound();
}

function renderRound() {
  const p = problem;
  const left = Math.max(0, ROUND.maxProblems - round.index);
  const pct = (round.index / ROUND.maxProblems) * 100;

  app.innerHTML = '';
  const view = el(`
    <div class="round">
      <div class="topbar">
        <div class="progress"><i style="width:${pct}%"></i></div>
        <div class="left-count">${left} left</div>
      </div>
      <div class="prompt-card">
        <p class="prompt-text"><span class="a">${p.a}</span> group${p.a === 1 ? '' : 's'} of <span class="b">${p.b}</span> = ?</p>
        <div class="running" id="running">${p.finalWin ? 'One more — you got this! ⭐' : 'Tap each row to count…'}</div>
      </div>
      <div class="dots" id="dots"></div>
      <div class="hint" id="hint"></div>
      <div class="answers" id="answers"></div>
    </div>
  `);
  app.appendChild(view);

  // dots
  const dots = view.querySelector('#dots');
  for (let r = 0; r < p.a; r++) {
    const row = el(`<div class="dot-row" data-row="${r}" style="grid-template-columns:repeat(${p.b},30px)"></div>`);
    for (let c = 0; c < p.b; c++) row.appendChild(el('<span class="dot"></span>'));
    const tag = el('<span class="row-tag"></span>');
    row.appendChild(tag);
    row.onclick = () => toggleRow(r);
    dots.appendChild(row);
  }

  // answers
  const answers = view.querySelector('#answers');
  p.options.forEach((opt) => {
    const b = el(`<button class="btn answer">${opt}</button>`);
    b.onclick = (e) => chooseAnswer(opt, b);
    answers.appendChild(b);
  });
}

function toggleRow(r) {
  const p = problem;
  if (p.locked) return;
  if (p.counted.has(r)) p.counted.delete(r); else p.counted.add(r);
  const rows = [...document.querySelectorAll('.dot-row')];
  // running total = number of counted rows * b, shown in counting-up order
  let count = 0;
  rows.forEach((row, i) => {
    const tag = row.querySelector('.row-tag');
    if (p.counted.has(i)) {
      row.classList.add('counted');
      count += p.b;
      tag.textContent = count;
    } else {
      row.classList.remove('counted');
      tag.textContent = '';
    }
  });
  const running = document.getElementById('running');
  if (running && !p.finalWin) {
    running.textContent = count > 0 ? `Counted: ${count}` : 'Tap each row to count…';
  }
}

function chooseAnswer(opt, btn) {
  const p = problem;
  if (p.locked) return;
  const hint = document.getElementById('hint');

  if (opt === p.answer) {
    p.locked = true;
    btn.classList.add('correct');
    recordAttempt(p.a, p.b, p.tries === 0);
    round.correctCount++;
    round.wrongStreak = 0;
    // reward the attempt: more stars if first try, but always some
    const gained = p.tries === 0 ? 5 : 2;
    awardStars(gained, btn);
    confetti();
    hint.textContent = p.tries === 0 ? 'Yes! ⭐⭐⭐' : 'Got it! ⭐';
    round.index++;
    setTimeout(() => nextProblem(false), 850);
  } else {
    p.tries++;
    btn.classList.add('wrong');
    setTimeout(() => btn.classList.remove('wrong'), 350);
    if (p.tries >= 3) {
      // reveal answer with the dot picture, then move on
      p.locked = true;
      recordAttempt(p.a, p.b, false);
      round.wrongStreak++;
      hint.textContent = `It's ${p.answer}. Count the dots: ${p.a} row${p.a === 1 ? '' : 's'} of ${p.b}.`;
      revealAllRows();
      round.index++;
      setTimeout(() => nextProblem(false), 1700);
    } else {
      hint.textContent = p.tries === 1 ? 'Almost — try again!' : 'One more try — count the rows!';
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
      <p class="cooldown">Come back later for more — your dragon needs a rest 😴</p>
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

// ---------- go ----------
renderHome();
