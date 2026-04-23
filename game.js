/* ═══════════════════════════════════════════════════════════════════
   DonauDodge v2 — game.js
   This version adds:
   • JS-driven background scroll — accelerates with difficulty
   • Tab-hide auto-pause (no dt spike on return)
   • Enter / Space restarts from game-over
   • Per-heli randomised float speed & phase
   • Double/triple spawns when score ≥ 30 (true Chaos mode)
   • Level-up screen flash (coloured radial burst)
   • Restart button auto-focus + 400 ms accidental-click guard
   • Game-over badges stacked via JS class (matched to HTML change)
═══════════════════════════════════════════════════════════════════ */

/* ── Difficulty presets ────────────────────────────────────────── */
const DIFF = {
  easy:   { speedStart:1.8, spawnStart:2400, rampSpeed:0.07, rampSpawn:55,  minSpawn:620, label:'Easy',   color:'#30D158', bg:'rgba(48,209,88,0.22)',  border:'rgba(48,209,88,0.42)',  glow:'rgba(48,209,88,0.28)'  },
  normal: { speedStart:2.5, spawnStart:1800, rampSpeed:0.13, rampSpawn:85,  minSpawn:380, label:'Normal', color:'#007AFF', bg:'rgba(0,122,255,0.18)',  border:'rgba(0,122,255,0.42)',  glow:'rgba(0,122,255,0.28)'  },
  hard:   { speedStart:3.8, spawnStart:1100, rampSpeed:0.20, rampSpawn:110, minSpawn:260, label:'Hard',   color:'#FF453A', bg:'rgba(255,69,58,0.22)',  border:'rgba(255,69,58,0.42)',  glow:'rgba(255,69,58,0.28)'  },
};
const HELI_SRCS = ['heli-yellow.webp', 'heli-blue.webp', 'heli-white.webp'];

const LEVELS = [
  { at:  0, name: 'Take off'    },
  { at:  6, name: 'On Course'   },
  { at: 15, name: 'Turbulence'  },
  { at: 28, name: 'Storm Zone'  },
  { at: 50, name: '🔥 Chaos'    },
];

const PORTFOLIO_THRESHOLD = 50;

/* ── DOM ───────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const playerEl  = $('player');
const playerIcon= $('player-icon');
const scorePill = $('score-pill');
const bestPill  = $('best-pill');
const comboPill = $('combo-pill');
const diffBadge = $('diff-badge');
const gameoverEl= $('gameover');
const goScoreEl = $('go-score');
const goSubEl   = $('go-sub');
const goDiffTag = $('go-diff-tag');
const recBadge  = $('record-badge');
const bgBase    = $('bg-base');
const bgOver    = $('bg-over');
const vfx       = $('vfx');
const vfxCtx    = vfx.getContext('2d');
const starsEl   = $('stars');
const starsCtx  = starsEl.getContext('2d');
const levelFlash= $('level-flash');
const pauseBtn    = $('pause-btn');
const pauseOverlay= $('pause-overlay');
const diffModal   = $('diff-modal');

/* ── Highscore (per-difficulty) ────────────────────────────────── */
const getHs  = d   => parseInt(localStorage.getItem(`dd_hs_${d}`) || '0');
const saveHs = (d,v) => localStorage.setItem(`dd_hs_${d}`, v);

/* ── State ─────────────────────────────────────────────────────── */
let selectedDiff = localStorage.getItem('dd_diff') || 'normal';

let g = {
  over:false, paused:false, score:0, combo:0, comboTimer:null,
  levelIdx:-1, heliSpeed:2.5, spawnRate:1800,
  lastSpawn:0, lastDiff:0, glowRafId:null,
};

/* Game-over setTimeout IDs — cancelled when restarting or returning to menu */
const goTimers = [];
function goTimeout(fn, ms) { const id = setTimeout(fn, ms); goTimers.push(id); return id; }
function clearGoTimers() { goTimers.forEach(clearTimeout); goTimers.length = 0; }

let px = 0, py = 0, ptx = 0, pty = 0, pvx = 0, pvy = 0;
/* Intermediate smoothed target — absorbs raw mouse-event staircase */
let stx = 0, sty = 0;
let lastTs = 0;
let manualPause = false;

/* Banded glow state — only writes to .style.filter when band crosses */
let _glowBand = -1;

/* Smooth background scroll — persists across restarts */
let bgBaseScroll = 0, bgOverScroll = 0;
const BG_SCROLL_FACTOR = 0.00278; /* matched to original 120s base speed at heliSpeed 2.5 */

/* ── Keyboard ──────────────────────────────────────────────────── */
const keys = {};
let kbdHintShown = false;

document.addEventListener('keydown', e => {
  keys[e.code] = true;

  const dirs = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'];
  if (dirs.includes(e.code)) e.preventDefault();

  /* Restart from game-over */
  if ((e.code === 'Enter' || e.code === 'Space') && gameoverEl.classList.contains('show')) {
    e.preventDefault();
    restartGame();
    return;
  }

  /* Close portfolio overlay on ESC */
  if (e.code === 'Escape' && $('portfolio').classList.contains('show')) {
    e.preventDefault();
    closePortfolio();
    return;
  }

  /* Close difficulty chooser on ESC */
  if (e.code === 'Escape' && diffModal.classList.contains('show')) {
    e.preventDefault();
    closeDiffChooser();
    return;
  }

  /* Pause toggle (Escape) — only during active gameplay */
  if (e.code === 'Escape' && !g.over &&
      $('startscreen').style.display === 'none' &&
      !gameoverEl.classList.contains('show')) {
    e.preventDefault();
    togglePause();
    return;
  }

  /* Shoot (Space) — during active gameplay */
  if (e.code === 'Space' && !g.over && !g.paused &&
      $('startscreen').style.display === 'none') {
    e.preventDefault();
    shootBullet();
    return;
  }

  /* Show keyboard hint once */
  const moveKeys = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD'];
  if (!kbdHintShown && moveKeys.includes(e.code)) {
    kbdHintShown = true;
    const h = $('kbd-hint');
    if (h) { h.classList.add('show'); setTimeout(() => h.classList.remove('show'), 2400); }
  }
});
document.addEventListener('keyup', e => { delete keys[e.code]; });

/* ── Auto-pause on tab hide ────────────────────────────────────── */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    g.paused = true;
  } else if (!g.over && !manualPause) {
    if (g.paused) {
      g.paused = false;
      startLoop();
    }
  }
});

/* Tap anywhere on the dimmed overlay (but not the card) to resume */
pauseOverlay.addEventListener('click', e => {
  if (e.target === pauseOverlay) togglePause();
});

/* ── Pause control ─────────────────────────────────────────────── */
function togglePause() {
  if (g.over) return;
  if (g.paused) {
    g.paused = false;
    manualPause = false;
    pauseOverlay.classList.remove('show');
    pauseBtn.classList.remove('paused');
    pauseBtn.textContent = '❚❚';
    startLoop();
  } else {
    g.paused = true;
    manualPause = true;
    pauseOverlay.classList.add('show');
    pauseBtn.classList.add('paused');
    pauseBtn.textContent = '▶';
  }
}

/* ── animationend auto-cleanup ─────────────────────────────────── */
scorePill.addEventListener('animationend', () => scorePill.classList.remove('pop'));

/* ── Canvas & stars ────────────────────────────────────────────── */
/* Stars are generated once in a normalised [0..1] coordinate space
   so resizing just redraws the same pattern at a new size — no
   jarring reshuffle. */
const starField = Array.from({ length: 200 }, () => ({
  nx: Math.random(),
  ny: Math.random(),
  r : Math.random() * 1.1 + 0.2,
  a : Math.random() * 0.4 + 0.1,
}));

function resizeAll() {
  vfx.width = starsEl.width = innerWidth;
  vfx.height = starsEl.height = innerHeight;
  drawStars();
}
resizeAll();
window.addEventListener('resize', () => {
  resizeAll();
  /* During gameplay: clamp target/pos to new bounds without teleporting.
     Only re-center if the player hasn't been positioned yet. */
  const maxX = innerWidth  - 100;
  const maxY = innerHeight * 0.85 - 50;
  if (ptx > maxX) ptx = maxX; if (pty > maxY) pty = maxY;
  if (stx > maxX) stx = maxX; if (sty > maxY) sty = maxY;
  if (px  > maxX) px  = maxX; if (py  > maxY) py  = maxY;
});

function drawStars() {
  starsCtx.clearRect(0, 0, starsEl.width, starsEl.height);
  const w = starsEl.width, h = starsEl.height;
  for (let i = 0; i < starField.length; i++) {
    const s = starField[i];
    starsCtx.beginPath();
    starsCtx.arc(s.nx * w, s.ny * h, s.r, 0, Math.PI * 2);
    starsCtx.fillStyle = `rgba(255,255,255,${s.a})`;
    starsCtx.fill();
  }
}

/* ── Input ─────────────────────────────────────────────────────── */
document.addEventListener('mousemove', e => {
  ptx = e.clientX - 50;
  pty = e.clientY - 50;
});
document.addEventListener('touchmove', e => {
  e.preventDefault();
  ptx = e.touches[0].clientX - 50;
  pty = e.touches[0].clientY - 50;
}, { passive: false });

/* Shoot on click/tap — ignore clicks on UI buttons/controls */
function isUITarget(t) {
  return t && (t.closest('button, a, .go-card, #diff-modal, #pause-overlay, #startscreen, #portfolio'));
}
let firing = false;
function stopFiring() { firing = false; }
document.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  if (isUITarget(e.target)) return;
  if ($('startscreen').style.display !== 'none') return;
  firing = true;
  shootBullet();
});
document.addEventListener('mouseup',    stopFiring);
document.addEventListener('mouseleave', stopFiring);
document.addEventListener('touchstart', e => {
  if (isUITarget(e.target)) return;
  if ($('startscreen').style.display !== 'none') return;
  firing = true;
  shootBullet();
}, { passive: true });
document.addEventListener('touchend',    stopFiring);
document.addEventListener('touchcancel', stopFiring);

/* Shoot-button (mobile) hold-to-fire */
(() => {
  const sb = $('shoot-btn');
  if (!sb) return;
  const press = e => { e.preventDefault(); firing = true; shootBullet(); };
  sb.addEventListener('mousedown',  press);
  sb.addEventListener('touchstart', press, { passive: false });
})();

/* ── Portfolio unlock ──────────────────────────────────────────── */
function bestOverall() {
  return Math.max(getHs('easy'), getHs('normal'), getHs('hard'));
}
function isPortfolioUnlocked() {
  return localStorage.getItem('dd_portfolio_unlocked') === '1' ||
         bestOverall() >= PORTFOLIO_THRESHOLD;
}
function setPortfolioUnlocked(flash = false) {
  localStorage.setItem('dd_portfolio_unlocked', '1');
  const btn = $('work-btn');
  if (!btn) return;
  btn.classList.remove('locked');
  if (flash) {
    btn.classList.remove('unlock-flash');
    void btn.offsetWidth;
    btn.classList.add('unlock-flash');
  }
}
function refreshPortfolioCard() {
  const btn = $('work-btn');
  if (!btn) return;
  if (isPortfolioUnlocked()) btn.classList.remove('locked');
  else                       btn.classList.add('locked');
}

/* Lock popover — shown when user clicks locked "See my work" */
function showLockPopover() {
  const pop  = $('lock-popover');
  const fill = $('lp-fill');
  const cur  = $('lp-current');
  if (!pop || !fill || !cur) return;

  const best = bestOverall();
  const shown = Math.min(best, PORTFOLIO_THRESHOLD);
  const pct   = Math.max(0.04, Math.min(1, shown / PORTFOLIO_THRESHOLD));

  /* Reset + show so the fill animates in each time */
  pop.classList.remove('show');
  fill.style.width = '0%';
  cur.textContent  = '0';
  void pop.offsetWidth;

  pop.classList.add('show');

  /* Delay animation a tick so CSS picks it up */
  requestAnimationFrame(() => {
    fill.style.width = (pct * 100).toFixed(1) + '%';
    /* Count-up of current best */
    const t0 = performance.now();
    const dur = 700;
    (function step(ts) {
      const t = Math.min((ts - t0) / dur, 1);
      const v = Math.round(shown * (1 - Math.pow(1 - t, 3)));
      cur.textContent = v;
      if (t < 1) requestAnimationFrame(step);
    })(performance.now());
  });

  clearTimeout(showLockPopover._tid);
  showLockPopover._tid = setTimeout(() => pop.classList.remove('show'), 2800);
}

function openPortfolio(e) {
  if (e) e.stopPropagation();
  const btn = $('work-btn');
  if (!isPortfolioUnlocked()) {
    if (btn) {
      btn.classList.remove('deny');
      void btn.offsetWidth;
      btn.classList.add('deny');
    }
    showLockPopover();
    return;
  }
  $('portfolio').classList.add('show');
}
function closePortfolio() {
  $('portfolio').classList.remove('show');
}

/* Dismiss the popover when user clicks outside it */
document.addEventListener('click', e => {
  const pop = $('lock-popover');
  if (!pop || !pop.classList.contains('show')) return;
  if (e.target.closest('#lock-popover')) return;
  if (e.target.closest('#work-btn')) return;
  pop.classList.remove('show');
});

/* ── Difficulty ────────────────────────────────────────────────── */
function setDiff(diff) {
  selectedDiff = diff;
  localStorage.setItem('dd_diff', diff);
  const d = DIFF[diff];
  const r = document.documentElement;
  r.style.setProperty('--diff-bg',     d.bg);
  r.style.setProperty('--diff-border', d.border);
  r.style.setProperty('--diff-glow',   d.glow);
  r.style.setProperty('--diff-text',   d.color);
  bestPill.textContent = `Best: ${getHs(diff)}`;
}
setDiff(selectedDiff);
refreshPortfolioCard();

/* ── Difficulty chooser flow ──────────────────────────────────── */
function openDiffChooser()  { diffModal.classList.add('show'); }
function closeDiffChooser() { diffModal.classList.remove('show'); }
function startGameWith(diff) {
  setDiff(diff);
  closeDiffChooser();
  startGame();
}

/* ── Particles ─────────────────────────────────────────────────── */
const parts = [];
const MAX_PARTS = 220;

function spawnTrail(dt) {
  const spd = Math.hypot(pvx, pvy);
  if (spd < 1.2) return;
  if (parts.length >= MAX_PARTS) return;
  const count = Math.min(4, Math.ceil(spd * 0.3 * dt));
  for (let i = 0; i < count; i++) {
    parts.push({
      x: px + 50 + (Math.random() - 0.5) * 24,
      y: py + 50 + (Math.random() - 0.5) * 24,
      vx: -Math.abs(pvx) * 0.22 - Math.random() * 1.4,
      vy: (Math.random() - 0.5) * 1.1,
      r: Math.random() * 2.4 + 0.7,
      a: Math.min(spd * 0.032, 0.42),
      life: 1,
      hue: 198 + Math.random() * 36,
    });
  }
  /* Hard cap — drop oldest if we overshoot */
  if (parts.length > MAX_PARTS) parts.splice(0, parts.length - MAX_PARTS);
}

function tickParticles(dt) {
  vfxCtx.clearRect(0, 0, vfx.width, vfx.height);
  /* Single save/restore; group-set globalAlpha per particle */
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.life -= 0.042 * dt;
    if (p.life <= 0) { parts.splice(i, 1); continue; }
    vfxCtx.globalAlpha = p.a * p.life;
    vfxCtx.beginPath();
    vfxCtx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
    vfxCtx.fillStyle = `hsl(${p.hue},88%,72%)`;
    vfxCtx.fill();
  }
  vfxCtx.globalAlpha = 1;
}

/* ── Speed lines ───────────────────────────────────────────────── */
/* Persistent lines — much cheaper than per-frame canvas gradients */
const speedLines = [];
const MAX_SPEED_LINES = 14;

function drawSpeedLines(spd) {
  if (spd < 2) return;
  const alpha = Math.min((spd - 2) / 16, 0.11);
  const target = Math.min(MAX_SPEED_LINES, Math.floor(spd / 3));
  while (speedLines.length < target) {
    speedLines.push({
      x: Math.random() * vfx.width,
      y: Math.random() * vfx.height,
      len: Math.random() * 220 + 100,
      vx: -(6 + Math.random() * 8),
    });
  }
  if (speedLines.length > target) speedLines.length = target;
  vfxCtx.save();
  vfxCtx.lineWidth = 0.6;
  vfxCtx.strokeStyle = `rgba(190,218,255,${alpha})`;
  for (let i = 0; i < speedLines.length; i++) {
    const L = speedLines[i];
    L.x += L.vx;
    if (L.x < -L.len) {
      L.x = vfx.width + Math.random() * 40;
      L.y = Math.random() * vfx.height;
      L.len = Math.random() * 220 + 100;
    }
    vfxCtx.beginPath();
    vfxCtx.moveTo(L.x, L.y);
    vfxCtx.lineTo(L.x - L.len, L.y);
    vfxCtx.stroke();
  }
  vfxCtx.restore();
}

/* ── Helicopters ───────────────────────────────────────────────── */
const helis = [];

function spawnHeli(extraDelay = 0) {
  const doSpawn = () => {
    if (g.over) return;
    const maxY = Math.max(80, innerHeight - 220);

    /* Wall-prevention: never spawn if the right half already has ≥3
       active helis. Keeps the field traversable even in Chaos mode. */
    const rightHelis = [];
    for (let j = 0; j < helis.length; j++) {
      const h = helis[j];
      if (!h._crashed && h._x > innerWidth * 0.35) rightHelis.push(h);
    }
    if (rightHelis.length >= 3) return;

    /* Fair-Y: find a Y with a ≥180 px vertical gap from every heli
       still in the spawn zone. If no slot found after 16 attempts,
       skip this spawn — better to drop than to create an unwinnable
       wall. */
    const GAP = 180;
    let y = Math.random() * maxY;
    let ok = false;
    for (let attempt = 0; attempt < 16; attempt++) {
      ok = true;
      for (let j = 0; j < rightHelis.length; j++) {
        if (Math.abs(rightHelis[j]._top - y) < GAP) { ok = false; break; }
      }
      if (ok) break;
      y = Math.random() * maxY;
    }
    if (!ok) return;

    const wrap = document.createElement('div');
    wrap.className = 'heli-wrap';
    wrap.style.top = y + 'px';

    const img = document.createElement('img');
    img.src       = HELI_SRCS[Math.floor(Math.random() * HELI_SRCS.length)];
    img.className = 'heli-img';

    /* Randomise float speed and phase per helicopter */
    const dur = (1.4 + Math.random() * 1.2).toFixed(2);
    img.style.animationDuration = dur + 's';
    img.style.animationDelay    = (-Math.random() * parseFloat(dur)).toFixed(2) + 's';

    /* Cache hitbox height once image loads */
    wrap._h = 80;
    img.addEventListener('load', () => {
      if (img.naturalWidth) wrap._h = Math.round(img.naturalHeight * 200 / img.naturalWidth);
    }, { once: true });

    wrap.appendChild(img);
    document.body.appendChild(wrap);

    wrap._top     = y;
    wrap._x       = innerWidth + 40 + Math.random() * 60;
    wrap._spd     = g.heliSpeed + Math.random() * 1.8;
    wrap._counted = false;
    wrap.style.transform = `translateX(${wrap._x}px)`;
    helis.push(wrap);
  };

  extraDelay ? setTimeout(doSpawn, extraDelay) : doSpawn();
}

/* Bonus spawns at high difficulty */
function trySpawn() {
  spawnHeli();
  if (g.score >= 50 && Math.random() < 0.35) spawnHeli(360 + Math.random() * 200);
  else if (g.score >= 30 && Math.random() < 0.22) spawnHeli(420 + Math.random() * 280);
}

function clearHelis() {
  helis.forEach(h => h.remove());
  helis.length = 0;
}

/* ── Collectibles ──────────────────────────────────────────────── */
const collectibles = [];
let slowmoUntil = 0;         /* timestamp when slow-mo ends */
let nextStarAt = 0;          /* timestamp when next star should spawn */
let nextPowerAt = 0;         /* timestamp when next slow-mo should spawn */
const starInterval  = () => 6800  + Math.random() * 2400;
const powerInterval = () => 26000 + Math.random() * 10000;

function spawnCollectible(type) {
  if (g.over) return;
  const wrap = document.createElement('div');
  wrap.className = 'pickup-wrap';
  const pickup = document.createElement('div');
  pickup.className = 'pickup ' + type;
  pickup.textContent = type === 'star' ? '★'
                     : type === 'firepower' ? '🔥'
                     : '✧';
  wrap.appendChild(pickup);
  document.body.appendChild(wrap);

  const maxY = Math.max(120, innerHeight - 200);
  wrap._top   = 60 + Math.random() * (maxY - 60);
  wrap._x     = innerWidth + 40;
  wrap._spd   = g.heliSpeed * 0.7 + 0.4;
  wrap._type  = type;
  wrap._dead  = false;
  wrap.style.top = '0px';
  wrap.style.transform = `translate(${wrap._x}px, ${wrap._top}px)`;
  collectibles.push(wrap);
}

function clearCollectibles() {
  collectibles.forEach(c => c.remove());
  collectibles.length = 0;
}

function hitCircle(cx, cy, r) {
  /* Player centre is (px+50, py+50); collides if distance < r+32 */
  const dx = (px + 50) - cx;
  const dy = (py + 50) - cy;
  return dx * dx + dy * dy < (r + 32) * (r + 32);
}

function collectStar(wrap) {
  /* +3 bonus score, gold burst */
  g.score += 3;
  scorePill.textContent = `Score: ${g.score}`;
  scorePill.classList.remove('pop');
  void scorePill.offsetWidth;
  scorePill.classList.add('pop');
  checkLevel();

  const cx = wrap._x + 26, cy = wrap._top + 26;
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 2.5 + Math.random() * 5;
    parts.push({
      x: cx, y: cy,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      r: 2.2 + Math.random() * 2.4,
      life: 1, a: 0.95,
      hue: 44 + Math.random() * 14,
    });
  }
  const pop = document.createElement('div');
  pop.className = 'bonus';
  pop.textContent = '+3 ★';
  pop.style.left = cx + 'px';
  pop.style.top  = (cy - 8) + 'px';
  document.body.appendChild(pop);
  setTimeout(() => pop.remove(), 900);
}

function activateSlowmo() {
  slowmoUntil = performance.now() + 3000;
  document.body.classList.add('slowmo-active');
  const pop = document.createElement('div');
  pop.className = 'bonus';
  pop.textContent = 'SLOW-MO';
  pop.style.left = (px + 50) + 'px';
  pop.style.top  = (py + 10) + 'px';
  pop.style.color = '#cfb4ff';
  pop.style.textShadow = '0 0 12px rgba(180,140,255,0.9)';
  document.body.appendChild(pop);
  setTimeout(() => pop.remove(), 900);

  /* Rainbow burst */
  for (let i = 0; i < 30; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 3 + Math.random() * 5;
    parts.push({
      x: px + 50, y: py + 50,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      r: 2 + Math.random() * 2.5,
      life: 1, a: 0.9,
      hue: Math.random() * 360,
    });
  }
}

/* ── Firepower power-up ────────────────────────────────────────── */
let firePowerUntil = 0;
let nextFirePowerAt = 0;
const firePowerInterval = () => 28000 + Math.random() * 14000;
const FIREPOWER_DURATION = 8000;

function isFirePowerActive(ts) {
  return (ts || performance.now()) < firePowerUntil;
}

function activateFirePower() {
  firePowerUntil = performance.now() + FIREPOWER_DURATION;
  document.body.classList.add('firepower-active');
  const sb = $('shoot-btn');
  if (sb) sb.classList.add('show');
  const fp = $('fp-pill');
  if (fp) fp.classList.add('show');

  /* Pickup burst — fiery radial */
  for (let i = 0; i < 30; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 3 + Math.random() * 5;
    parts.push({
      x: px + 50, y: py + 50,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      r: 2 + Math.random() * 2.5,
      life: 1, a: 0.95,
      hue: 14 + Math.random() * 28,
    });
  }

  const pop = document.createElement('div');
  pop.className = 'bonus';
  pop.textContent = 'FIREPOWER';
  pop.style.left = (px + 50) + 'px';
  pop.style.top  = (py + 10) + 'px';
  pop.style.color = '#ffb04e';
  pop.style.textShadow = '0 0 14px rgba(255,130,30,0.9)';
  document.body.appendChild(pop);
  setTimeout(() => pop.remove(), 900);
}

function deactivateFirePower() {
  firePowerUntil = 0;
  document.body.classList.remove('firepower-active');
  const sb = $('shoot-btn');
  if (sb) sb.classList.remove('show');
  const fp = $('fp-pill');
  if (fp) fp.classList.remove('show');
}

/* ── Bullets ───────────────────────────────────────────────────── */
const bullets = [];
let lastShotAt = 0;
const SHOT_COOLDOWN = 280;
const BULLET_SPEED  = 14;

function clearBullets() {
  bullets.forEach(b => b.remove());
  bullets.length = 0;
}

function shootBullet() {
  if (g.over || g.paused) return;
  if (!isFirePowerActive()) return;

  const b = document.createElement('div');
  b.className = 'bullet';
  /* Fire from the gondola/cabin (lower part of balloon), not the envelope */
  b._x = px + 82;
  b._y = py + 78;
  b.style.transform = `translate(${b._x}px, ${b._y}px)`;
  document.body.appendChild(b);
  bullets.push(b);

  /* Muzzle flash at gondola */
  for (let i = 0; i < 8; i++) {
    const a = (Math.random() - 0.5) * 0.8;
    parts.push({
      x: b._x, y: b._y + 3,
      vx: 5 + Math.random() * 3.5, vy: Math.sin(a) * 2.2,
      r: 1.6 + Math.random() * 1.8, life: 1, a: 0.95,
      hue: 28 + Math.random() * 22,
    });
  }

  /* Recoil kick — brief nudge backward */
  ptx -= 2.4;
  stx -= 1.2;
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b._x += BULLET_SPEED * dt;
    b.style.transform = `translate(${b._x}px, ${b._y}px)`;

    if (b._x > innerWidth + 40) { b.remove(); bullets.splice(i, 1); continue; }

    /* Collision with helis */
    for (let j = helis.length - 1; j >= 0; j--) {
      const h = helis[j];
      if (h._crashed) continue;
      const hw = 200, hh = h._h || 80, s = 0.24;
      if (b._x > h._x + hw * s && b._x < h._x + hw * (1 - s) &&
          b._y > h._top + hh * s && b._y < h._top + hh * (1 - s)) {
        /* Hit — explode heli, grant score */
        const ex = document.createElement('img');
        ex.src = 'explosion.gif?t=' + Date.now();
        ex.style.cssText = `position:fixed;left:${h._x + 40}px;top:${h._top - 10}px;
          width:120px;height:120px;z-index:99;pointer-events:none;`;
        document.body.appendChild(ex);
        setTimeout(() => ex.remove(), 900);

        for (let k = 0; k < 20; k++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 2 + Math.random() * 5;
          parts.push({
            x: h._x + hw/2, y: h._top + hh/2,
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            r: 1.5 + Math.random() * 2, life: 1, a: 1,
            hue: 15 + Math.random() * 40,
          });
        }

        g.score += 2;
        scorePill.textContent = `Score: ${g.score}`;
        scorePill.classList.remove('pop');
        void scorePill.offsetWidth;
        scorePill.classList.add('pop');
        checkLevel();

        h.remove(); helis.splice(j, 1);
        b.remove(); bullets.splice(i, 1);
        break;
      }
    }
  }
}

/* ── Pixel collision (zero DOM reads) ──────────────────────────── */
function hit(px, py, hx, hy, hw, hh) {
  const s = 0.26;
  return (px + 100) > (hx + hw * s) && px < (hx + hw * (1 - s)) &&
         (py + 100) > (hy + hh * s) && py < (hy + hh * (1 - s));
}

/* ── Level badge + flash ───────────────────────────────────────── */
function checkLevel() {
  /* Portfolio unlock — first time reaching threshold */
  if (g.score >= PORTFOLIO_THRESHOLD && !localStorage.getItem('dd_portfolio_unlocked')) {
    setPortfolioUnlocked(false);
    g.unlockedThisRun = true;
  }

  let lvl = 0;
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (g.score >= LEVELS[i].at) { lvl = i; break; }
  }
  if (lvl === g.levelIdx) return;
  g.levelIdx = lvl;

  /* Hide level 0 "Abheben" (trivial start state) — only show real progress */
  if (lvl === 0) {
    diffBadge.classList.remove('show');
  } else {
    diffBadge.textContent = `Level ${lvl} · ${LEVELS[lvl].name}`;
    diffBadge.style.color = 'rgba(255,255,255,0.85)';
    diffBadge.classList.add('show');
  }

  /* Radial colour flash */
  if (levelFlash && lvl > 0) {
    const c = DIFF[selectedDiff].glow.replace('0.28', '0.5');
    levelFlash.style.background =
      `radial-gradient(ellipse 120% 80% at 50% 50%, ${c} 0%, transparent 70%)`;
    levelFlash.style.display = 'block';
    levelFlash.style.animation = 'none';
    void levelFlash.offsetWidth;
    levelFlash.style.animation = 'lvlFlash 0.75s ease-out forwards';
    setTimeout(() => { levelFlash.style.display = 'none'; }, 750);
  }
}

/* ── Near-miss bonus ───────────────────────────────────────────── */
let _vigTimer = null;
function nearMissEffect(x, y) {
  /* Gold particle burst */
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 2 + Math.random() * 4;
    parts.push({
      x, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      r: 2 + Math.random() * 2,
      life: 1, a: 0.95,
      hue: 42 + Math.random() * 14,
    });
  }
  /* Vignette pulse */
  const vig = $('vignette');
  if (vig) {
    vig.classList.add('pulse');
    clearTimeout(_vigTimer);
    _vigTimer = setTimeout(() => vig.classList.remove('pulse'), 240);
  }
  /* "+1" popup */
  const pop = document.createElement('div');
  pop.className = 'bonus';
  pop.textContent = '+1';
  pop.style.left = x + 'px';
  pop.style.top  = (y - 10) + 'px';
  document.body.appendChild(pop);
  setTimeout(() => pop.remove(), 900);
}

/* ── Combo ─────────────────────────────────────────────────────── */
function registerDodge() {
  g.score++;
  scorePill.textContent = `Score: ${g.score}`;
  scorePill.classList.remove('pop');
  void scorePill.offsetWidth;
  scorePill.classList.add('pop');
  checkLevel();
  clearTimeout(g.comboTimer);
  g.combo++;
  if (g.combo >= 3) {
    comboPill.textContent = `${g.combo}× Combo!`;
    comboPill.classList.add('show');
  }
  g.comboTimer = setTimeout(() => {
    g.combo = 0;
    comboPill.classList.remove('show');
  }, 2500);
}

/* ── Player ────────────────────────────────────────────────────── */
function centerPlayer() {
  ptx = stx = px = innerWidth  / 2 - 50;
  pty = sty = py = innerHeight * 0.55 - 50; /* slightly below centre — clears HUD */
}

const KEY_SPD = 11;

/* ── Snappy single-stage smoothing ────────────────────────────────
   One exponential lerp — frame-rate-independent, minimal lag.
   The earlier two-stage filter amplified dt spikes, which felt jerky.
   Clamping dt to [0, 1.6] prevents tab-hide / GC jumps from
   producing teleport frames. */
const BAL_RESPONSE = 0.36;

function updatePlayer(dt) {
  /* Keyboard moves target (mouse/touch wrote to ptx/pty already) */
  if (keys['ArrowLeft']  || keys['KeyA']) ptx -= KEY_SPD * dt;
  if (keys['ArrowRight'] || keys['KeyD']) ptx += KEY_SPD * dt;
  if (keys['ArrowUp']    || keys['KeyW']) pty -= KEY_SPD * dt;
  if (keys['ArrowDown']  || keys['KeyS']) pty += KEY_SPD * dt;

  const maxX = innerWidth  - 100;
  const maxY = innerHeight * 0.85 - 50;
  if (ptx < 0) ptx = 0; else if (ptx > maxX) ptx = maxX;
  if (pty < 0) pty = 0; else if (pty > maxY) pty = maxY;

  const dtc   = dt > 1.6 ? 1.6 : dt;
  const alpha = 1 - Math.pow(1 - BAL_RESPONSE, dtc);
  const nx    = px + (ptx - px) * alpha;
  const ny    = py + (pty - py) * alpha;

  /* Keep stx/sty in sync so legacy code paths reading them stay sane */
  stx = nx; sty = ny;

  /* Derive velocity from position delta — for visuals only */
  pvx = dt > 0 ? (nx - px) / dt : 0;
  pvy = dt > 0 ? (ny - py) / dt : 0;

  px = nx; py = ny;

  const angle = pvx * 4;
  const a = angle > 22 ? 22 : (angle < -22 ? -22 : angle);
  const absV = pvx < 0 ? -pvx : pvx;
  const scale = 1 + (absV > 3.6 ? 0.20 : absV / 20);

  playerEl.style.transform =
    `translate3d(${px}px,${py}px,0) rotate(${a}deg) scale(${scale})`;

  /* Banded glow — only touches the DOM when the band changes */
  const spd = Math.sqrt(pvx * pvx + pvy * pvy);
  const band = spd < 3 ? 0 : (spd < 8 ? 1 : (spd < 14 ? 2 : (spd < 22 ? 3 : 4)));
  if (band !== _glowBand) {
    _glowBand = band;
    playerEl.style.filter = band === 0
      ? ''
      : `drop-shadow(0 0 ${band * 5}px rgba(120,200,255,${(band * 0.14).toFixed(2)}))`;
  }
}

/* ── Score count-up ────────────────────────────────────────────── */
function countUp(target) {
  const dur = Math.min(target * 28, 1100);
  const t0  = performance.now();
  (function tick(ts) {
    const t    = Math.min((ts - t0) / dur, 1);
    goScoreEl.textContent = Math.round(target * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(tick);
  })(performance.now());
}

/* ── Game Over ─────────────────────────────────────────────────── */
function triggerGameOver(hitEl) {
  g.over = true;
  if (g.glowRafId) { cancelAnimationFrame(g.glowRafId); g.glowRafId = null; }
  clearTimeout(g.comboTimer);
  g.comboTimer = null;
  comboPill.classList.remove('show');
  parts.length = 0;

  /* Explosion */
  const ex = document.createElement('img');
  ex.src = 'explosion.gif';
  ex.style.cssText = `position:fixed;left:${px+10}px;top:${py+10}px;
    width:120px;height:120px;z-index:99;pointer-events:none;`;
  document.body.appendChild(ex);
  goTimeout(() => ex.remove(), 1300);

  /* Radial glow burst */
  const bx = px + 60, by = py + 60;
  let glowA = 0.72;
  const glowFade = () => {
    if (glowA <= 0) { vfxCtx.clearRect(0, 0, vfx.width, vfx.height); g.glowRafId = null; return; }
    vfxCtx.clearRect(0, 0, vfx.width, vfx.height);
    const gr = vfxCtx.createRadialGradient(bx, by, 0, bx, by, 160);
    gr.addColorStop(0, `rgba(255,130,10,${glowA})`);
    gr.addColorStop(1, 'rgba(255,100,0,0)');
    vfxCtx.fillStyle = gr;
    vfxCtx.fillRect(0, 0, vfx.width, vfx.height);
    glowA -= 0.022;
    g.glowRafId = requestAnimationFrame(glowFade);
  };
  glowFade();

  playerIcon.style.backgroundImage = "url('gif_bg2.webp?v=2')";
  if (hitEl) hitEl._crashed = true;

  /* Survivors keep flying — give them a small momentum burst so it's
     visually clear they continue past the crash site */
  for (let i = 0; i < helis.length; i++) {
    const h = helis[i];
    if (h._crashed) continue;
    h._spd *= 1.35;
  }

  document.body.classList.add('shake');
  goTimeout(() => document.body.classList.remove('shake'), 520);

  const fallY = innerHeight * 0.84 - 50;
  playerEl.style.transition = 'transform 1.4s cubic-bezier(0.33,0,0.55,1)';
  playerEl.style.transform  = `translate3d(${px}px,${fallY}px,0) rotate(8deg)`;
  if (hitEl) {
    hitEl.style.transition = 'transform 1.4s cubic-bezier(0.33,0,0.55,1)';
    hitEl.style.transform  = `translateX(${hitEl._x}px) translateY(${fallY - hitEl._top}px)`;
  }

  goTimeout(() => {
    const fire = document.createElement('img');
    fire.src = 'fire.gif?t=' + Date.now();
    fire.style.cssText = `position:fixed;left:${px-22}px;top:${fallY-24}px;
      width:144px;height:144px;z-index:9;pointer-events:none;
      filter:drop-shadow(0 0 24px rgba(255,140,30,0.8));`;
    document.body.appendChild(fire);
    const fire2 = document.createElement('img');
    fire2.src = 'fire.gif?t=' + (Date.now()+1);
    fire2.style.cssText = `position:fixed;left:${px+40}px;top:${fallY-10}px;
      width:96px;height:96px;z-index:9;pointer-events:none;opacity:0.85;`;
    document.body.appendChild(fire2);
  }, 1380);

  goTimeout(() => {
    const prev  = getHs(selectedDiff);
    const isNew = g.score > prev;
    if (isNew) saveHs(selectedDiff, g.score);
    const best = isNew ? g.score : prev;

    bestPill.textContent = `Best: ${best}`;
    goSubEl.textContent  = `Highscore: ${best}`;
    recBadge.classList.toggle('show', isNew);

    const d = DIFF[selectedDiff];
    goDiffTag.textContent      = `${d.label} played`;
    goDiffTag.style.color      = d.color;
    goDiffTag.style.borderColor = d.border;

    countUp(g.score);

    /* Confetti — only on new highscore */
    if (isNew) {
      const kon = document.createElement('img');
      kon.src = 'kon.gif?t=' + Date.now();
      kon.style.cssText = `position:fixed;left:50%;top:6px;transform:translateX(-50%);
        width:260px;z-index:250;pointer-events:none;`;
      document.body.appendChild(kon);
      setTimeout(() => kon.remove(), 2600);
    }

    gameoverEl.classList.add('show');

    /* Auto-focus restart button after 400 ms — prevents accidental retap
       and makes keyboard restart work without needing Enter first */
    goTimeout(() => {
      const btn = document.querySelector('.go-btn');
      if (btn) btn.focus({ preventScroll: true });
    }, 400);
  }, 1320);
}

/* ── Main loop ─────────────────────────────────────────────────── */
/* Token-guarded RAF: every startLoop() bumps the token, stale RAFs
   exit on their next tick. This eliminates the class of "game hangs
   after restart" bugs caused by orphaned loops holding loopActive. */
let loopActive = false;
let loopToken  = 0;
function startLoop() {
  loopToken++;
  loopActive = true;
  lastTs = 0;
  const tok = loopToken;
  const step = ts => {
    if (tok !== loopToken || !loopActive) return;
    loop(ts);
    if (tok === loopToken && loopActive) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function loop(ts) {
  if (g.paused) { loopActive = false; return; }

  const dt = lastTs ? Math.min((ts - lastTs) / 16.667, 3) : 1;
  lastTs = ts;

  if (!g.over) {
    updatePlayer(dt);
    spawnTrail(dt);
  }

  const spd = Math.hypot(pvx, pvy);
  tickParticles(dt);
  if (!g.over) drawSpeedLines(spd);

  /* JS-driven background scroll — speed proportional to heliSpeed */
  if (!g.over) {
    const scrollDelta = g.heliSpeed * dt * BG_SCROLL_FACTOR;
    bgBaseScroll = (bgBaseScroll + scrollDelta)     % 50;
    bgOverScroll = (bgOverScroll + scrollDelta * 2) % 50;
    bgBase.style.transform = `translateX(-${bgBaseScroll}%)`;
    bgOver.style.transform = `translateX(-${bgOverScroll}%)`;
  }

  /* Spawn with jitter */
  if (!g.over && ts - g.lastSpawn > g.spawnRate) {
    trySpawn();
    g.lastSpawn = ts - g.spawnRate * (Math.random() * 0.15);
  }

  /* Difficulty ramp every 5 s */
  const preset = DIFF[selectedDiff];
  if (!g.over && ts - g.lastDiff > 5000) {
    g.heliSpeed += preset.rampSpeed;
    if (g.spawnRate > preset.minSpawn) g.spawnRate -= preset.rampSpawn;
    g.lastDiff = ts;
  }

  /* Slow-mo multiplier on enemy movement (not player, not bg) */
  const slow = ts < slowmoUntil ? 0.35 : 1;
  if (slow === 1 && document.body.classList.contains('slowmo-active')) {
    document.body.classList.remove('slowmo-active');
  }

  /* Update helis — continue after crash so survivors keep flying;
     the heli that hit the balloon is flagged ._crashed and skipped */
  for (let i = helis.length - 1; i >= 0; i--) {
    const h = helis[i];
    if (h._crashed) continue;
    h._x -= h._spd * dt * slow;
    h.style.transform = `translateX(${h._x}px)`;
    const hw = 200, hh = h._h || 80;
    if (!h._counted && h._x + hw < px) {
      const dy = Math.abs((h._top + hh / 2) - (py + 50));
      if (!g.over && dy < 90) { nearMissEffect(h._x + hw, h._top + hh / 2); g.score++; }
      if (!g.over) registerDodge();  /* registerDodge also does score++ */
      h._counted = true;
    }
    if (!g.over && hit(px, py, h._x, h._top, hw, hh)) { triggerGameOver(h); break; }
    if (h._x < -300)                              { h.remove(); helis.splice(i, 1); }
  }

  /* Hold-to-fire — auto-repeat while mouse/touch held down */
  if (firing && !g.over && !g.paused && ts - lastShotAt > 85) {
    shootBullet();
    lastShotAt = ts;
  }

  /* Bullets — active even if player crashed (bullets already in flight) */
  updateBullets(dt);

  /* Collectible spawns — cached next-timestamp avoids frame-by-frame random */
  if (!g.over && ts >= nextStarAt) {
    spawnCollectible('star');
    nextStarAt = ts + starInterval();
  }
  if (!g.over && g.score >= 10 && ts >= nextPowerAt) {
    spawnCollectible('slowmo');
    nextPowerAt = ts + powerInterval();
  }
  if (!g.over && g.score >= 8 && ts >= nextFirePowerAt) {
    spawnCollectible('firepower');
    nextFirePowerAt = ts + firePowerInterval();
  }

  /* Firepower timer — drives the HUD pill and auto-hides the fire button */
  if (firePowerUntil) {
    if (ts >= firePowerUntil) {
      deactivateFirePower();
    } else {
      const fpTime = $('fp-time');
      if (fpTime) fpTime.textContent = Math.max(0, Math.ceil((firePowerUntil - ts) / 1000));
    }
  }

  /* Update collectibles */
  for (let i = collectibles.length - 1; i >= 0; i--) {
    const c = collectibles[i];
    c._x -= c._spd * dt * slow;
    c.style.transform = `translate(${c._x}px, ${c._top}px)`;
    if (!g.over && !c._dead && hitCircle(c._x + 26, c._top + 26, 22)) {
      c._dead = true;
      if      (c._type === 'star')      collectStar(c);
      else if (c._type === 'firepower') activateFirePower();
      else                              activateSlowmo();
      c.remove();
      collectibles.splice(i, 1);
      continue;
    }
    if (c._x < -80) { c.remove(); collectibles.splice(i, 1); }
  }

  /* After crash: exit once nothing is moving */
  if (g.over && helis.length === 0 && bullets.length === 0 && parts.length === 0) {
    loopActive = false;
    return;
  }
}

/* ── Controls ──────────────────────────────────────────────────── */
function startGame() {
  $('startscreen').style.display = 'none';
  $('start-bg').style.display    = 'none';
  $('aurora').style.display      = 'none';
  $('stars').style.display       = 'none';
  $('bg-base').style.display     = 'block';
  $('bg-over').style.display     = 'block';
  $('clouds').style.display      = 'block';
  $('vignette').style.display    = 'block';
  $('exit-btn').classList.add('show');
  $('pause-btn').classList.add('show');
  /* shoot button stays hidden — only shown while firepower is active */
  $('hud').style.display         = 'flex';
  $('diff-badge').style.display  = 'block';
  playerEl.style.display         = 'block';

  /* Disable CSS animations — loop drives scroll from here */
  bgBase.style.animation = 'none';
  bgOver.style.animation = 'none';

  centerPlayer();
  restartGame();
}

function exitGame() { returnToMenu(); }

/* Return to the startscreen without reloading the page */
function returnToMenu() {
  g.over = true;
  g.paused = false;
  manualPause = false;
  if (g.glowRafId) { cancelAnimationFrame(g.glowRafId); g.glowRafId = null; }
  clearTimeout(g.comboTimer);
  g.comboTimer = null;
  clearGoTimers();
  document.body.classList.remove('shake');

  clearHelis();
  clearBullets();
  if (typeof collectibles !== 'undefined') {
    collectibles.forEach(c => c.remove()); collectibles.length = 0;
  }
  parts.length = 0;
  speedLines.length = 0;
  deactivateFirePower();
  vfxCtx.clearRect(0, 0, vfx.width, vfx.height);
  document.querySelectorAll('img[src^="fire.gif"], img[src^="kon.gif"], img[src^="explosion.gif"]')
    .forEach(e => e.remove());
  document.querySelectorAll('.bonus').forEach(e => e.remove());

  gameoverEl.classList.remove('show');
  pauseOverlay.classList.remove('show');
  pauseBtn.classList.remove('paused');
  pauseBtn.textContent = '❚❚';
  $('exit-btn').classList.remove('show');
  $('pause-btn').classList.remove('show');
  $('shoot-btn').classList.remove('show');
  $('hud').style.display        = 'none';
  $('diff-badge').style.display = 'none';
  comboPill.classList.remove('show');
  playerEl.style.display        = 'none';
  playerEl.style.transition     = 'none';
  playerEl.style.filter         = '';

  $('bg-base').style.display  = 'none';
  $('bg-over').style.display  = 'none';
  $('clouds').style.display   = 'none';
  $('vignette').style.display = 'none';
  $('start-bg').style.display = 'block';
  $('stars').style.display    = 'block';
  $('startscreen').style.display = 'flex';
  /* aurora stays hidden — CSS has `display:none !important` by design */

  /* Refresh portfolio lock state; flash card if just unlocked */
  refreshPortfolioCard();
  if (g.unlockedThisRun) {
    g.unlockedThisRun = false;
    setTimeout(() => setPortfolioUnlocked(true), 260);
  }
}

function restartGame() {
  if (g.glowRafId) { cancelAnimationFrame(g.glowRafId); g.glowRafId = null; }
  clearTimeout(g.comboTimer);
  clearGoTimers();
  document.body.classList.remove('shake');
  centerPlayer();

  const preset = DIFF[selectedDiff];
  Object.assign(g, {
    over:false, paused:false, score:0, combo:0, comboTimer:null,
    levelIdx:-1, heliSpeed:preset.speedStart, spawnRate:preset.spawnStart,
    /* 800 ms grace: first heli cannot appear until player has settled */
    lastSpawn: performance.now() + 800 - preset.spawnStart,
    lastDiff:0, glowRafId:null,
  });
  lastTs = 0;
  manualPause = false;
  pvx = pvy = 0;
  stx = px; sty = py;
  _glowBand = -1;
  pauseOverlay.classList.remove('show');
  pauseBtn.classList.remove('paused');
  pauseBtn.textContent = '❚❚';

  scorePill.textContent = 'Score: 0';
  comboPill.classList.remove('show');
  gameoverEl.classList.remove('show');
  diffBadge.classList.remove('show');
  bestPill.textContent  = `Best: ${getHs(selectedDiff)}`;

  playerIcon.style.backgroundImage = "url('gif_bg.webp?v=2')";
  /* Flush the falling transition before applying the new transform —
     otherwise the browser tweens from crash-pos to centre on restart. */
  playerEl.style.transition = 'none';
  playerEl.style.filter     = '';
  void playerEl.offsetWidth;
  playerEl.style.transform  = `translate3d(${px}px,${py}px,0)`;

  clearHelis();
  clearCollectibles();
  clearBullets();
  speedLines.length = 0;
  slowmoUntil = 0;
  deactivateFirePower();
  /* First star no sooner than 2 s after start; slow-mo after normal interval */
  nextStarAt      = performance.now() + 2000 + starInterval() * 0.5;
  nextPowerAt     = performance.now() + powerInterval();
  nextFirePowerAt = performance.now() + 14000 + Math.random() * 6000;
  document.body.classList.remove('slowmo-active');
  parts.length = 0;
  vfxCtx.clearRect(0, 0, vfx.width, vfx.height);
  document.querySelectorAll('img[src^="fire.gif"], img[src^="kon.gif"], img[src^="explosion.gif"]')
    .forEach(e => e.remove());
  document.querySelectorAll('.bonus').forEach(e => e.remove());

  startLoop();
}
