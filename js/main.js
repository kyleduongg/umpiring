let PITCHES = [];

const PITCH_NAMES = {
  FF: 'Four-Seam FB', SI: 'Sinker', FC: 'Cutter', SL: 'Slider',
  CH: 'Changeup', CU: 'Curveball', ST: 'Sweeper', SV: 'Slurve',
  FS: 'Split-Finger', KC: 'Knuckle Curve'
};


let currentIdx = 0;
let correct = 0;
let attempted = 0;
let errors = 0;
let awaitingNext = false;
let pitchStartTime = null;
let responseTimes = [];
let recentCalls = [];
let gameStarted = false;
let autoNextTimer = null;

const AUTO_NEXT_DELAY_MS = 1250;

const CALL_TIME_LIMIT_MS = 2000;
let timedMode = false;
let timedIntroShown = false;
let callCountdownTimer = null;
let countdownStartTimer = null;
let countdownRAF = null;
let callDeadline = 0;

const PRACTICE_COUNT = 3;
const MAX_ERRORS = 3;
const PLATE_HALF_WIDTH_FT = 0.708;

const FIXED_ZONE_TOP = 3.5;
const FIXED_ZONE_BOTTOM = 1.5;

const SCREEN_MIN_X = -2.2;
const SCREEN_MAX_X = 2.2;
const SCREEN_MIN_Z = 0.35;
const SCREEN_MAX_Z = 4.75;

const BORDERLINE_START_CORRECT = 4;
const BORDERLINE_SECOND_LEVEL_CORRECT = 8;
const BORDERLINE_CHANCE = 0.90;
const BORDERLINE_SECOND_LEVEL_CHANCE = 0.97;

const HOT_STREAK_THRESHOLD = 5;
const HOT_STREAK_HARD_POOL = 6;

const MLB_UMPIRE_REACTION_TIME_SECONDS = 0.45;
const JUNE_MLB_UMPIRE_AVG_ACCURACY = 94.3;

// ─── Helpers ───────────────────────────────────────────────────────────────
function shuffleArray(array) {
  const shuffled = [...array];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

function getPitchAnimationDuration(speed) {
  if (speed >= 95) return 250;
  if (speed >= 90) return 335;
  if (speed >= 85) return 420;
  return 500;
}

function isPitchInFixedStrikeZone(pitch) {
  const pitchRadiusPx = 8;

  const ballCenterX = xScale(pitch.plate_x);
  const ballCenterY = yScale(pitch.plate_z);

  const zoneLeftPx = xScale(-PLATE_HALF_WIDTH_FT);
  const zoneRightPx = xScale(PLATE_HALF_WIDTH_FT);
  const zoneTopPx = yScale(FIXED_ZONE_TOP);
  const zoneBottomPx = yScale(FIXED_ZONE_BOTTOM);

  const ballLeftPx = ballCenterX - pitchRadiusPx;
  const ballRightPx = ballCenterX + pitchRadiusPx;
  const ballTopPx = ballCenterY - pitchRadiusPx;
  const ballBottomPx = ballCenterY + pitchRadiusPx;

  const touchesHorizontally =
    ballRightPx >= zoneLeftPx &&
    ballLeftPx <= zoneRightPx;

  const touchesVertically =
    ballBottomPx >= zoneTopPx &&
    ballTopPx <= zoneBottomPx;

  return touchesHorizontally && touchesVertically;
}

function getDistanceFromZoneEdgePx(pitch) {
  const ballCenterX = xScale(pitch.plate_x);
  const ballCenterY = yScale(pitch.plate_z);

  const zoneLeftPx = xScale(-PLATE_HALF_WIDTH_FT);
  const zoneRightPx = xScale(PLATE_HALF_WIDTH_FT);
  const zoneTopPx = yScale(FIXED_ZONE_TOP);
  const zoneBottomPx = yScale(FIXED_ZONE_BOTTOM);

  const insideHorizontally =
    ballCenterX >= zoneLeftPx &&
    ballCenterX <= zoneRightPx;

  const insideVertically =
    ballCenterY >= zoneTopPx &&
    ballCenterY <= zoneBottomPx;

  if (insideHorizontally && insideVertically) {
    return Math.min(
      Math.abs(ballCenterX - zoneLeftPx),
      Math.abs(ballCenterX - zoneRightPx),
      Math.abs(ballCenterY - zoneTopPx),
      Math.abs(ballCenterY - zoneBottomPx)
    );
  }

  const dx = Math.max(zoneLeftPx - ballCenterX, 0, ballCenterX - zoneRightPx);
  const dy = Math.max(zoneTopPx - ballCenterY, 0, ballCenterY - zoneBottomPx);

  return Math.sqrt(dx * dx + dy * dy);
}

function isBorderlinePitch(pitch) {
  return getDistanceFromZoneEdgePx(pitch) <= 18;
}

function isOnScreenPitch(pitch) {
  if (!pitch) return false;

  const x = Number(pitch.plate_x);
  const z = Number(pitch.plate_z);

  return (
    Number.isFinite(x) &&
    Number.isFinite(z) &&
    x >= SCREEN_MIN_X &&
    x <= SCREEN_MAX_X &&
    z >= SCREEN_MIN_Z &&
    z <= SCREEN_MAX_Z
  );
}

function getCurrentStreak() {
  return (window.GameFeel && typeof window.GameFeel.combo === 'number')
    ? window.GameFeel.combo
    : 0;
}

function pickDesiredCall() {
  const n = recentCalls.length;
  if (n >= 2 && recentCalls[n - 1] === recentCalls[n - 2]) {
    return !recentCalls[n - 1];
  }
  const recent = recentCalls.slice(-8);
  const strikes = recent.filter(Boolean).length;
  const balls = recent.length - strikes;
  if (strikes - balls >= 3) return false;
  if (balls - strikes >= 3) return true;
  return Math.random() < 0.5;
}

function pickFromPool(pool) {
  if (!pool.length) return -1;
  const desiredStrike = pickDesiredCall();
  const matching = pool.filter(
    (i) => isPitchInFixedStrikeZone(PITCHES[i]) === desiredStrike
  );
  const finalPool = matching.length ? matching : pool;
  const pick = finalPool[Math.floor(Math.random() * finalPool.length)];
  recentCalls.push(isPitchInFixedStrikeZone(PITCHES[pick]));
  if (recentCalls.length > 30) recentCalls.shift();
  return pick;
}

function chooseNextPitchIndex(startIndex) {
  const onScreenIndexes = [];
  const borderlineIndexes = [];

  for (let i = startIndex; i < PITCHES.length; i++) {
    if (!isOnScreenPitch(PITCHES[i])) continue;

    onScreenIndexes.push(i);

    if (isBorderlinePitch(PITCHES[i])) {
      borderlineIndexes.push(i);
    }
  }

  const hotStreak = getCurrentStreak() >= HOT_STREAK_THRESHOLD;

  // Easy warm-up: the first few calls just avoid extreme off-screen pitches.
  if (!hotStreak && correct < BORDERLINE_START_CORRECT) {
    return onScreenIndexes.length ? onScreenIndexes[0] : startIndex;
  }

  // Decide whether to draw from the hard (borderline) pool.
  let useBorderline;
  if (hotStreak) {
    useBorderline = true; // ON FIRE: always a tough edge call...
  } else {
    const chance =
      correct >= BORDERLINE_SECOND_LEVEL_CORRECT
        ? BORDERLINE_SECOND_LEVEL_CHANCE
        : BORDERLINE_CHANCE;
    useBorderline = Math.random() < chance;
  }

  const pool =
    useBorderline && borderlineIndexes.length ? borderlineIndexes : onScreenIndexes;
  const pick = pickFromPool(pool);
  return pick >= 0 ? pick : startIndex;
}

function moveSelectedPitchIntoCurrentSlot(currentSlot, selectedIndex) {
  if (currentSlot === selectedIndex) return;

  const temp = PITCHES[currentSlot];
  PITCHES[currentSlot] = PITCHES[selectedIndex];
  PITCHES[selectedIndex] = temp;
}

function getAverageResponseTimeSeconds() {
  if (responseTimes.length === 0) return 0;

  const total = responseTimes.reduce((sum, time) => sum + time, 0);
  return total / responseTimes.length / 1000;
}

function formatAverageResponseTime() {
  const avg = getAverageResponseTimeSeconds();
  return avg > 0 ? `${avg.toFixed(2)}s` : '--';
}

function showNextButton(text = 'Next Pitch →') {
  const nextButton = document.getElementById('btn-next');
  if (!nextButton) return;

  nextButton.textContent = text;
  nextButton.style.setProperty('display', 'block', 'important');
  nextButton.style.setProperty('visibility', 'visible', 'important');
  nextButton.style.setProperty('opacity', '1', 'important');
}

function hideNextButton() {
  const nextButton = document.getElementById('btn-next');
  if (!nextButton) return;

  nextButton.style.setProperty('display', 'none', 'important');
}

function clearAutoNextTimer() {
  if (autoNextTimer) {
    clearTimeout(autoNextTimer);
    autoNextTimer = null;
  }
}

// ─── Timed mode: the 2-second call clock ────────────────────────────────────
function ensureCallTimerUI() {
  let wrap = document.getElementById('call-timer');
  if (wrap) return wrap;
  const panel = document.querySelector('.pitch-panel');
  const zoneWrap = document.querySelector('.zone-wrapper');
  if (!panel || !zoneWrap) return null;
  wrap = document.createElement('div');
  wrap.id = 'call-timer';
  wrap.className = 'call-timer';
  wrap.innerHTML =
    '<div class="call-timer-row">' +
      '<span class="call-timer-label">⏱ CALL CLOCK</span>' +
      '<span class="call-timer-num">2.0s</span>' +
    '</div>' +
    '<div class="call-timer-track"><div class="call-timer-fill"></div></div>';
  panel.insertBefore(wrap, zoneWrap);
  return wrap;
}

function showCountdownUI() {
  const wrap = ensureCallTimerUI();
  if (wrap) wrap.classList.add('show');
}

function hideCountdownUI() {
  const wrap = document.getElementById('call-timer');
  if (wrap) { wrap.classList.remove('show'); wrap.classList.remove('urgent'); }
}

function updateCountdownUI(remaining) {
  const wrap = document.getElementById('call-timer');
  if (!wrap) return;
  const num = wrap.querySelector('.call-timer-num');
  const fill = wrap.querySelector('.call-timer-fill');
  const pct = Math.max(0, Math.min(100, (remaining / CALL_TIME_LIMIT_MS) * 100));
  let color = 'var(--accent2)';
  if (remaining <= 700) color = 'var(--strike)';
  else if (remaining <= 1200) color = 'var(--accent)';
  if (fill) { fill.style.width = pct + '%'; fill.style.background = color; }
  if (num) { num.textContent = (remaining / 1000).toFixed(1) + 's'; num.style.color = color; }
  wrap.classList.toggle('urgent', remaining <= 700);
}

function clearCallTimers() {
  if (callCountdownTimer) { clearTimeout(callCountdownTimer); callCountdownTimer = null; }
  if (countdownStartTimer) { clearTimeout(countdownStartTimer); countdownStartTimer = null; }
  if (countdownRAF) { cancelAnimationFrame(countdownRAF); countdownRAF = null; }
  hideCountdownUI();
}

function tickCountdown() {
  const remaining = Math.max(0, callDeadline - performance.now());
  updateCountdownUI(remaining);
  if (remaining > 0) {
    countdownRAF = requestAnimationFrame(tickCountdown);
  }
}

function beginCallCountdown() {
  countdownStartTimer = null;
  if (awaitingNext || !gameStarted) return;
  callDeadline = performance.now() + CALL_TIME_LIMIT_MS;
  showCountdownUI();
  tickCountdown();
  callCountdownTimer = setTimeout(handleCallTimeout, CALL_TIME_LIMIT_MS);
}

function handleCallTimeout() {
  callCountdownTimer = null;
  if (awaitingNext || !gameStarted) return;
  makeCall('__timeout__');
}

function showTimedIntro(onContinue) {
  const overlay = document.createElement('div');
  overlay.className = 'timed-intro-overlay';
  overlay.innerHTML =
    '<div class="timed-intro-card">' +
      '<div class="timed-intro-badge">⏱️</div>' +
      '<h2>Now Let\u2019s Make It Harder</h2>' +
      '<p>Real umpires have to make the call the instant the pitch hits the plate. ' +
      'From here on you get just <strong>two seconds</strong> to call every pitch. Letting the clock run out counts as a blown call.</p>' +
      '<button type="button" class="timed-intro-btn">Play On</button>' +
    '</div>';
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
  const finish = () => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 250);
    if (typeof onContinue === 'function') onContinue();
  };
  overlay.querySelector('.timed-intro-btn').addEventListener('click', finish);
}

function goToNextPitch() {
  clearAutoNextTimer();
  clearCallTimers();

  if (!gameStarted) return;

  const gameOver = errors >= MAX_ERRORS || attempted >= PITCHES.length;

  if (gameOver) {
    showResults();
    return;
  }

  currentIdx++;

  if (currentIdx >= PITCHES.length) {
    showResults();
    return;
  }

  const selectedIndex = chooseNextPitchIndex(currentIdx);
  moveSelectedPitchIntoCurrentSlot(currentIdx, selectedIndex);

  loadPitch(currentIdx);
}

function scheduleAutoNext(gameOver) {
  clearAutoNextTimer();
  hideNextButton();

  const feedbackText = document.getElementById('feedback-text');
  if (feedbackText) {
    const bufferMessage = gameOver
      ? ''
      : '<br><span style="color:var(--muted);font-size:12px">Next pitch coming up...</span>';
    if (bufferMessage) feedbackText.innerHTML += bufferMessage;
  }

  autoNextTimer = setTimeout(() => {
    autoNextTimer = null;
    goToNextPitch();
  }, AUTO_NEXT_DELAY_MS);
}

function disableCallButtons() {
  const strikeButton = document.getElementById('btn-strike');
  const ballButton = document.getElementById('btn-ball');

  if (strikeButton) strikeButton.disabled = true;
  if (ballButton) ballButton.disabled = true;
}

function enableCallButtons() {
  const strikeButton = document.getElementById('btn-strike');
  const ballButton = document.getElementById('btn-ball');

  if (strikeButton) strikeButton.disabled = false;
  if (ballButton) ballButton.disabled = false;
}

function resetGameState() {
  clearAutoNextTimer();

  currentIdx = 0;
  correct = 0;
  attempted = 0;
  errors = 0;
  awaitingNext = false;
  pitchStartTime = null;
  responseTimes = [];
  recentCalls = [];
  gameStarted = false;
  timedMode = false;
  timedIntroShown = false;
  clearCallTimers();

  PITCHES = shuffleArray(PITCHES);

  updateStats();
  buildDots();
  hideNextButton();
  disableCallButtons();
  if (window.GameFeel) GameFeel.reset();

  const toast = document.getElementById('feedback-toast');
  const icon = document.getElementById('feedback-icon');
  const text = document.getElementById('feedback-text');

  if (toast) toast.className = '';
  if (icon) icon.textContent = '🎯';
  if (text) {
    text.style.color = 'var(--muted)';
    text.textContent = 'Click Start Game when you are ready to call pitches.';
  }

  zoneBox.attr('opacity', 0);
  pitchCircle.attr('r', 0).attr('opacity', 0);
  resultRing.attr('r', 0).attr('opacity', 0);

  updateProgressText();
}

// ─── SVG Setup ───────────────────────────────────────────────────────────
const W = 340, H = 380;
const MARGIN = { left: 40, right: 20, top: 30, bottom: 40 };
const plotW = W - MARGIN.left - MARGIN.right;
const plotH = H - MARGIN.top - MARGIN.bottom;

const xScale = d3.scaleLinear().domain([-2.5, 2.5]).range([0, plotW]);
const yScale = d3.scaleLinear().domain([0, 5]).range([plotH, 0]);

const svg = d3.select('#zone-svg')
  .attr('width', W)
  .attr('height', H);

const g = svg.append('g')
  .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);

const fieldLayer = g.append('g').attr('class', 'umpire-field-view');

const defs = svg.append('defs');

const bgGrad = defs.append('linearGradient')
  .attr('id', 'umpBgGrad')
  .attr('x1', '0%').attr('y1', '0%')
  .attr('x2', '0%').attr('y2', '100%');
bgGrad.append('stop').attr('offset', '0%').attr('stop-color', '#08130f');
bgGrad.append('stop').attr('offset', '55%').attr('stop-color', '#0c1a14');
bgGrad.append('stop').attr('offset', '100%').attr('stop-color', '#0a130f');

const grassGrad = defs.append('linearGradient')
  .attr('id', 'umpGrassGrad')
  .attr('x1', '0%').attr('y1', '0%')
  .attr('x2', '0%').attr('y2', '100%');
grassGrad.append('stop').attr('offset', '0%').attr('stop-color', '#244f3b');
grassGrad.append('stop').attr('offset', '50%').attr('stop-color', '#1b4332');
grassGrad.append('stop').attr('offset', '100%').attr('stop-color', '#153426');

const dirtGrad = defs.append('radialGradient')
  .attr('id', 'dirtGrad')
  .attr('cx', '50%')
  .attr('cy', '78%')
  .attr('r', '80%');
dirtGrad.append('stop').attr('offset', '0%').attr('stop-color', '#a67242').attr('stop-opacity', 0.95);
dirtGrad.append('stop').attr('offset', '48%').attr('stop-color', '#80542f').attr('stop-opacity', 0.86);
dirtGrad.append('stop').attr('offset', '100%').attr('stop-color', '#261d18').attr('stop-opacity', 0.28);

const zoneGlow = defs.append('filter')
  .attr('id', 'zoneGlow')
  .attr('x', '-50%').attr('y', '-50%')
  .attr('width', '200%').attr('height', '200%');
zoneGlow.append('feGaussianBlur')
  .attr('stdDeviation', 3.2)
  .attr('result', 'blur');
const zoneMerge = zoneGlow.append('feMerge');
zoneMerge.append('feMergeNode').attr('in', 'blur');
zoneMerge.append('feMergeNode').attr('in', 'SourceGraphic');

fieldLayer.append('rect')
  .attr('x', -MARGIN.left)
  .attr('y', -MARGIN.top)
  .attr('width', W)
  .attr('height', H)
  .attr('fill', 'url(#umpBgGrad)');

fieldLayer.append('ellipse')
  .attr('cx', xScale(-1.95))
  .attr('cy', yScale(4.95))
  .attr('rx', 52)
  .attr('ry', 22)
  .attr('fill', 'rgba(255,255,255,0.06)');

fieldLayer.append('ellipse')
  .attr('cx', xScale(1.95))
  .attr('cy', yScale(4.95))
  .attr('rx', 52)
  .attr('ry', 22)
  .attr('fill', 'rgba(255,255,255,0.06)');

fieldLayer.append('path')
  .attr(
    'd',
    `M ${xScale(-2.45)} ${yScale(5.05)} C ${xScale(-1.7)} ${yScale(4.08)}, ${xScale(1.7)} ${yScale(4.08)}, ${xScale(2.45)} ${yScale(5.05)} L ${xScale(2.45)} ${plotH} L ${xScale(-2.45)} ${plotH} Z`
  )
  .attr('fill', 'url(#umpGrassGrad)')
  .attr('opacity', 0.96);

fieldLayer.append('path')
  .attr(
    'd',
    `M ${xScale(-0.52)} ${yScale(5.05)} C ${xScale(-0.34)} ${yScale(4.2)}, ${xScale(0.34)} ${yScale(4.2)}, ${xScale(0.52)} ${yScale(5.05)} L ${xScale(0.34)} ${plotH} L ${xScale(-0.34)} ${plotH} Z`
  )
  .attr('fill', 'rgba(255,255,255,0.035)');

fieldLayer.append('line')
  .attr('x1', xScale(-0.85)).attr('y1', yScale(0.58))
  .attr('x2', xScale(-2.16)).attr('y2', yScale(4.48))
  .attr('stroke', 'rgba(245,245,245,0.18)')
  .attr('stroke-width', 1.4);

fieldLayer.append('line')
  .attr('x1', xScale(0.85)).attr('y1', yScale(0.58))
  .attr('x2', xScale(2.16)).attr('y2', yScale(4.48))
  .attr('stroke', 'rgba(245,245,245,0.18)')
  .attr('stroke-width', 1.4);

fieldLayer.append('ellipse')
  .attr('cx', xScale(0))
  .attr('cy', yScale(0.68))
  .attr('rx', plotW * 0.47)
  .attr('ry', 82)
  .attr('fill', 'url(#dirtGrad)')
  .attr('opacity', 0.96);

fieldLayer.append('ellipse')
  .attr('cx', xScale(0))
  .attr('cy', yScale(1.95))
  .attr('rx', 78)
  .attr('ry', 20)
  .attr('fill', 'rgba(232,200,64,0.08)');

const plateTop = yScale(0.48);
const plateBottom = yScale(0.08);
const plateLeft = xScale(-PLATE_HALF_WIDTH_FT);
const plateRight = xScale(PLATE_HALF_WIDTH_FT);
const plateMid = xScale(0);

fieldLayer.append('polygon')
  .attr(
    'points',
    `${plateLeft},${plateTop} ${plateRight},${plateTop} ${plateRight},${(plateTop + plateBottom) / 2} ${plateMid},${plateBottom} ${plateLeft},${(plateTop + plateBottom) / 2}`
  )
  .attr('fill', 'rgba(245,245,236,0.98)')
  .attr('stroke', 'rgba(255,255,255,0.95)')
  .attr('stroke-width', 1.5);

fieldLayer.append('rect')
  .attr('x', xScale(-0.62))
  .attr('y', yScale(0.62))
  .attr('width', xScale(0.62) - xScale(-0.62))
  .attr('height', 14)
  .attr('fill', 'rgba(255,255,255,0.05)')
  .attr('stroke', 'rgba(255,255,255,0.10)');

fieldLayer.append('path')
  .attr(
    'd',
    `M ${xScale(-1.52)} ${plotH + 14} C ${xScale(-1.1)} ${yScale(0.55)}, ${xScale(1.1)} ${yScale(0.55)}, ${xScale(1.52)} ${plotH + 14} Z`
  )
  .attr('fill', 'rgba(7,9,13,0.78)')
  .attr('stroke', 'rgba(255,255,255,0.08)');

fieldLayer.append('path')
  .attr(
    'd',
    `M ${xScale(-0.6)} ${yScale(0.92)} C ${xScale(-0.42)} ${yScale(1.28)}, ${xScale(0.42)} ${yScale(1.28)}, ${xScale(0.6)} ${yScale(0.92)} L ${xScale(0.46)} ${yScale(0.62)} C ${xScale(0.24)} ${yScale(0.75)}, ${xScale(-0.24)} ${yScale(0.75)}, ${xScale(-0.46)} ${yScale(0.62)} Z`
  )
  .attr('fill', 'rgba(18,22,33,0.90)')
  .attr('stroke', 'rgba(232,234,240,0.16)')
  .attr('stroke-width', 1.2);

fieldLayer.append('path')
  .attr(
    'd',
    `M ${xScale(-2.42)} ${yScale(5.1)} Q ${xScale(0)} ${yScale(4.1)} ${xScale(2.42)} ${yScale(5.1)} L ${xScale(2.42)} ${yScale(5.8)} L ${xScale(-2.42)} ${yScale(5.8)} Z`
  )
  .attr('fill', 'rgba(4,8,14,0.58)');

const zoneBox = g.append('rect')
  .attr('class', 'zone-box')
  .attr('fill', 'rgba(255,255,255,0.015)')
  .attr('stroke', '#e6a23c')
  .attr('stroke-width', 2.2)
  .attr('stroke-dasharray', '6,4')
  .attr('filter', 'url(#zoneGlow)')
  .attr('rx', 3)
  .attr('opacity', 0);

const pitchCircle = g.append('circle')
  .attr('r', 0)
  .attr('fill', 'transparent')
  .attr('stroke', 'rgba(255,255,255,0.95)')
  .attr('stroke-width', 1.5)
  .attr('opacity', 0);

const resultRing = g.append('circle')
  .attr('r', 0)
  .attr('fill', 'none')
  .attr('stroke', 'transparent')
  .attr('stroke-width', 2)
  .attr('opacity', 0);

// ─── Dot progress tracker ─────────────────────────────────────────────────
function buildDots() {
  const container = document.getElementById('pitch-dots');
  if (!container) return;
  container.innerHTML = '';
}

function ensureDot(idx) {
  const container = document.getElementById('pitch-dots');
  if (!container) return null;

  const existingDot = document.getElementById(`dot-${idx}`);
  if (existingDot) return existingDot;

  const d = document.createElement('div');
  d.className = 'dot';
  d.id = `dot-${idx}`;
  container.appendChild(d);

  return d;
}

function updateProgressText() {
  const progressText = document.getElementById('progress-text');
  if (!progressText) return;

  const remainingErrors = Math.max(MAX_ERRORS - errors, 0);
  progressText.textContent =
    `Pitch ${attempted + 1} · Errors ${errors}/${MAX_ERRORS} · ${remainingErrors} left`;
}

// ─── Load pitch ───────────────────────────────────────────────────────────
function loadPitch(idx) {
  clearAutoNextTimer();
  clearCallTimers();

  const p = PITCHES[idx];
  if (!p) return;

  const showZone = idx < PRACTICE_COUNT;

  document.getElementById('count-balls').textContent = p.balls;
  document.getElementById('count-strikes').textContent = p.strikes;
  document.getElementById('pitcher-name').textContent = p.pitcher;

  const typeName = PITCH_NAMES[p.pitch_type] || p.pitch_type;
  document.getElementById('pitch-type-badge').textContent = typeName;
  document.getElementById('pitch-speed').innerHTML = `${p.speed} <span>mph</span>`;

  const distFt = 55;
  const tSec = (distFt / (p.speed * 5280 / 3600)).toFixed(3);
  document.getElementById('pitch-travel-note').textContent = `≈ ${tSec}s to plate`;

  const zoneLeft = -PLATE_HALF_WIDTH_FT;
  const zoneRight = PLATE_HALF_WIDTH_FT;

  zoneBox
    .attr('x', xScale(zoneLeft))
    .attr('y', yScale(FIXED_ZONE_TOP))
    .attr('width', xScale(zoneRight) - xScale(zoneLeft))
    .attr('height', yScale(FIXED_ZONE_BOTTOM) - yScale(FIXED_ZONE_TOP))
    .attr('opacity', showZone ? 1 : 0)
    .attr('stroke', '#e6a23c');

  const phaseMsg = document.getElementById('phase-msg');
  const phaseLabel = document.getElementById('phase-label');
  const phaseDesc = document.getElementById('phase-desc');
  const phaseCard = document.getElementById('phase-card');

  if (showZone) {
    phaseMsg.textContent = `◆ PRACTICE (${idx + 1}/${PRACTICE_COUNT}) — Strike zone visible`;
    phaseMsg.style.opacity = 1;
    phaseLabel.textContent = '📋 Practice Phase';
    phaseDesc.textContent = 'The strike zone box is shown for the first 3 pitches. After that, you get no guide.';
    phaseCard.style.background = 'rgba(232,200,64,0.07)';
    phaseCard.style.borderColor = 'rgba(232,200,64,0.25)';
  } else {
    phaseMsg.textContent = '🔴 LIVE MODE — No zone guide';
    phaseMsg.style.opacity = 1;
    phaseLabel.textContent = '⚾ Live Mode';
    phaseDesc.textContent = 'Zone box hidden. Keep calling pitches until you make 3 errors.';
    phaseCard.style.background = 'rgba(255,79,79,0.07)';
    phaseCard.style.borderColor = 'rgba(255,79,79,0.25)';
  }

  const startX = xScale(0);
  const startY = yScale(5.5);
  const endX = xScale(p.plate_x);
  const endY = yScale(p.plate_z);

  const typeColors = {
    FF: '#ff7f7f',
    SI: '#ff9f7f',
    FC: '#ffd07f',
    SL: '#7fbfff',
    CH: '#7fffbf',
    CU: '#bf7fff',
    ST: '#ff7fbf',
    SV: '#c0ff7f',
    FS: '#7fffff',
    KC: '#ffbf7f'
  };

  const pitchColor = typeColors[p.pitch_type] || '#ffffff';

  pitchCircle
    .attr('cx', startX)
    .attr('cy', startY)
    .attr('r', 8)
    .attr('fill', pitchColor)
    .attr('stroke', '#fff')
    .attr('stroke-width', 1.5)
    .attr('opacity', 0.9);

  g.selectAll('.trail').remove();

  const pitchAnimationDuration = getPitchAnimationDuration(p.speed);

  pitchCircle
    .transition()
    .duration(pitchAnimationDuration)
    .ease(d3.easeCubicIn)
    .attr('cx', endX)
    .attr('cy', endY)
    .attr('opacity', 1);

  resultRing
    .attr('r', 0)
    .attr('cx', endX)
    .attr('cy', endY)
    .attr('opacity', 0);

  enableCallButtons();
  hideNextButton();

  const toast = document.getElementById('feedback-toast');
  toast.className = '';

  document.getElementById('feedback-icon').textContent = '🎯';
  document.getElementById('feedback-text').style.color = 'var(--muted)';
  document.getElementById('feedback-text').textContent =
    'Make your call. If any part of the ball touches the zone, it is a strike.';

  if (idx > 0) {
    document.getElementById(`dot-${idx - 1}`)?.classList.remove('current');
  }

  const currentDot = ensureDot(idx);
  if (currentDot) currentDot.classList.add('current');

  updateProgressText();

  awaitingNext = false;
  pitchStartTime = performance.now();

  if (timedMode) {
    countdownStartTimer = setTimeout(beginCallCountdown, pitchAnimationDuration);
  }
}

// ─── Call handler ─────────────────────────────────────────────────────────
function makeCall(userCall) {
  if (!gameStarted) return;
  if (awaitingNext) return;

  awaitingNext = true;
  clearCallTimers();

  const timedOut = userCall === '__timeout__';

  const responseTime = pitchStartTime ? performance.now() - pitchStartTime : 0;
  if (responseTime > 0) {
    responseTimes.push(responseTime);
  }

  disableCallButtons();

  const p = PITCHES[currentIdx];

  const userStrike = userCall === 'strike';
  const actualStrike = isPitchInFixedStrikeZone(p);
  const umpireStrike = p.call === 'called_strike';
  const isCorrect = timedOut ? false : (userStrike === actualStrike);

  attempted++;

  if (isCorrect) {
    correct++;
  } else {
    errors++;
  }

  const dot = ensureDot(currentIdx);
  if (dot) {
    dot.classList.remove('current');
    dot.classList.add(isCorrect ? 'correct' : 'wrong');
  }

  const endX = xScale(p.plate_x);
  const endY = yScale(p.plate_z);

  pitchCircle
    .attr('fill', actualStrike ? 'var(--strike)' : 'var(--ball)')
    .attr('stroke', isCorrect ? 'var(--correct)' : 'var(--wrong)')
    .attr('stroke-width', 3);

  resultRing
    .attr('cx', endX)
    .attr('cy', endY)
    .attr('r', 8)
    .attr('stroke', isCorrect ? 'var(--correct)' : 'var(--wrong)')
    .attr('stroke-width', 2)
    .attr('opacity', 0.9);

  resultRing
    .transition()
    .duration(500)
    .ease(d3.easeLinear)
    .attr('r', 26)
    .attr('opacity', 0);

  if (currentIdx >= PRACTICE_COUNT) {
    zoneBox
      .transition()
      .duration(200)
      .attr('opacity', 0.6)
      .attr('stroke', actualStrike ? 'var(--strike)' : 'var(--ball)');
  }

  const toast = document.getElementById('feedback-toast');
  const icon = document.getElementById('feedback-icon');
  const text = document.getElementById('feedback-text');

  toast.className = isCorrect ? 'correct' : 'wrong';
  icon.textContent = isCorrect ? '✅' : (timedOut ? '⏰' : '❌');

  const actualCallLabel = actualStrike ? 'STRIKE' : 'BALL';
  const umpireCallLabel = umpireStrike ? 'STRIKE' : 'BALL';

  let umpireNote;

  if (actualStrike === umpireStrike) {
    umpireNote = `The MLB umpire also called it a ${umpireCallLabel}.`;
  } else if (actualStrike) {
    umpireNote =
      `The MLB umpire called it a ${umpireCallLabel}, but in this challenge it touches the zone, so it is a ${actualCallLabel}.`;
  } else {
    umpireNote =
      `The MLB umpire called it a ${umpireCallLabel}, but in this challenge it misses the zone, so it is a ${actualCallLabel}.`;
  }

  const visualBorderline = isBorderlinePitch(p);

  const diffNote = visualBorderline
    ? ` This was a close edge pitch.`
    : '';

  const verdictLead = timedOut
    ? `<strong>Too slow!</strong> You ran out the clock. `
    : `<strong>${isCorrect ? 'Correct!' : 'Wrong!'}</strong> `;

  text.style.color = 'var(--text)';
  text.innerHTML =
    `${verdictLead}This pitch is a <strong style="color:${actualStrike ? 'var(--strike)' : 'var(--ball)'}">${actualCallLabel}</strong>. ${umpireNote}${diffNote}<span style="color:var(--muted);font-size:12px"> (${p.pitch_type} @ ${p.speed} mph from ${p.pitcher})</span>`;

  updateStats();
  updateProgressText();

  if (window.GameFeel) {
    GameFeel.onCall({
      isCorrect: isCorrect,
      userCall: userCall,
      pitch: p,
      responseTime: responseTime,
      borderline: visualBorderline,
      edgeDistancePx: getDistanceFromZoneEdgePx(p),
      practice: currentIdx < PRACTICE_COUNT,
      errors: errors
    });
  }

  const gameOver = errors >= MAX_ERRORS || attempted >= PITCHES.length;

  // First time the player gets more than 5 correct: introduce the call clock.
  if (!gameOver && !timedMode && !timedIntroShown && correct > 5) {
    timedIntroShown = true;
    clearAutoNextTimer();
    hideNextButton();
    showTimedIntro(() => {
      timedMode = true;
      goToNextPitch();
    });
    return;
  }

  scheduleAutoNext(gameOver);
}

// ─── Stats ────────────────────────────────────────────────────────────────
function updateStats() {
  const pct = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;

  const hdrCorrect = document.getElementById('hdr-correct');
  const hdrAttempts = document.getElementById('hdr-attempts');
  const hdrAccuracy = document.getElementById('hdr-accuracy');

  if (hdrCorrect) hdrCorrect.textContent = correct;
  if (hdrAttempts) hdrAttempts.textContent = attempted;
  if (hdrAccuracy) hdrAccuracy.textContent = attempted > 0 ? `${pct}%` : '--%';

  const accPct = document.getElementById('acc-pct');
  const accBar = document.getElementById('acc-bar');
  const sideCorrect = document.getElementById('side-correct');
  const sidePitches = document.getElementById('side-pitches');

  if (accPct) accPct.textContent = `${pct}%`;
  if (accBar) accBar.style.width = `${pct}%`;
  if (sideCorrect) sideCorrect.textContent = correct;
  if (sidePitches) sidePitches.textContent = attempted;
}

// ─── Buttons ──────────────────────────────────────────────────────────────
document.getElementById('btn-next').addEventListener('click', goToNextPitch);

document.getElementById('btn-strike').addEventListener('click', () => makeCall('strike'));
document.getElementById('btn-ball').addEventListener('click', () => makeCall('ball'));

const continueButton = document.getElementById('btn-continue-instructions');
const startButton = document.getElementById('btn-start-game');

if (continueButton) {
  continueButton.addEventListener('click', () => {
    const readyCard = document.getElementById('game-ready-card');
    const instructionsCard = document.getElementById('game-instructions-card');

    if (readyCard) {
      readyCard.style.display = 'none';
    }

    if (instructionsCard) {
      instructionsCard.style.display = 'block';
    }
  });
}

if (startButton) {
  startButton.addEventListener('click', () => {
    clearAutoNextTimer();
    gameStarted = true;

    const overlay = document.getElementById('game-start-overlay');

    if (overlay) {
      overlay.style.display = 'none';
    }

    if (window.GameFeel) {
      GameFeel.onStart(() => loadPitch(0));
    } else {
      loadPitch(0);
    }
  });
}

// ─── Comparison helpers ───────────────────────────────────────────────────
function getJuneUmpireAccuracyFromData() {
  if (!PITCHES.length) return null;

  let comparable = 0;
  let correctUmpireCalls = 0;

  PITCHES.forEach((p) => {
    if (p.call !== 'called_strike' && p.call !== 'ball') return;

    const actualStrike = isPitchInFixedStrikeZone(p);
    const umpireStrike = p.call === 'called_strike';

    comparable++;

    if (actualStrike === umpireStrike) {
      correctUmpireCalls++;
    }
  });

  if (comparable === 0) return null;

  return correctUmpireCalls / comparable;
}

// ─── Results / Comparison Section ─────────────────────────────────────────
function showResults() {
  const pct = attempted > 0 ? correct / attempted : 0;
  const userAccuracyPct = Math.round(pct * 100);
  const avgUserTime = getAverageResponseTimeSeconds();

  const juneUmpireAccuracyPct = JUNE_MLB_UMPIRE_AVG_ACCURACY;
  const umpireAvgReactionTime = MLB_UMPIRE_REACTION_TIME_SECONDS;

  const comparisonSection = document.getElementById('comparison-section');
  if (!comparisonSection) return;

  comparisonSection.classList.add('show');

  if (window.GameFeel) {
    GameFeel.onGameOver({
      correct: correct,
      errors: errors,
      attempted: attempted,
      accuracyPct: userAccuracyPct,
      avgTime: avgUserTime
    });
  }

  const userAccuracyEl = document.getElementById('compare-user-accuracy');
  const umpireAccuracyEl = document.getElementById('compare-mlb-accuracy');
  const userSpeedEl = document.getElementById('compare-user-speed');
  const umpireSpeedEl = document.getElementById('compare-mlb-speed');

  if (userAccuracyEl) userAccuracyEl.textContent = `${userAccuracyPct}%`;
  if (umpireAccuracyEl) umpireAccuracyEl.textContent = `${juneUmpireAccuracyPct.toFixed(1)}%`;
  if (userSpeedEl) userSpeedEl.textContent = avgUserTime > 0 ? `${avgUserTime.toFixed(2)}s` : '--s';
  if (umpireSpeedEl) umpireSpeedEl.textContent = `${umpireAvgReactionTime.toFixed(2)}s`;

  const accuracyNote = document.getElementById('compare-accuracy-note');
  const speedNote = document.getElementById('compare-speed-note');
  const summary = document.getElementById('comparison-summary');

  if (accuracyNote) {
    const accuracyDiff = Math.abs(userAccuracyPct - juneUmpireAccuracyPct).toFixed(1);

    if (userAccuracyPct > juneUmpireAccuracyPct) {
      accuracyNote.textContent =
        `You were ${accuracyDiff}% higher than the June MLB umpire average. Great Job!`;
    } else if (userAccuracyPct === juneUmpireAccuracyPct) {
      accuracyNote.textContent =
        `You matched the June MLB umpire average. Great Job!`;
    } else {
      accuracyNote.textContent =
        `You were ${accuracyDiff}% below the June MLB umpire average.`;
    }
  }

  if (speedNote) {
    if (avgUserTime > 0) {
      if (avgUserTime < umpireAvgReactionTime) {
        speedNote.textContent =
          `Your average response time was ${(umpireAvgReactionTime / avgUserTime).toFixed(1)}× faster than the approximate MLB umpire call time.`;
      } else if (avgUserTime === umpireAvgReactionTime) {
        speedNote.textContent =
          `Your average response time matched the approximate MLB umpire call time.`;
      } else {
        speedNote.textContent =
          `Your average response time was ${(avgUserTime / umpireAvgReactionTime).toFixed(1)}× slower than the approximate MLB umpire call time.`;
      }
    } else {
      speedNote.textContent = 'Not enough timing data yet.';
    }
  }

  if (summary) {
    summary.textContent =
      `You finished with ${correct} correct calls, ${errors} errors, ${attempted} total pitches, and an average response time of ${avgUserTime > 0 ? avgUserTime.toFixed(2) : '--'} seconds.`;
  }

  document.querySelectorAll('.reveal-card').forEach((card) => {
    card.classList.remove('revealed');
  });

  if (summary) {
    summary.classList.remove('show');
  }

  comparisonSection.scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });
}

// ─── Reveal cards ─────────────────────────────────────────────────────────
document.querySelectorAll('.btn-reveal-card').forEach((button) => {
  button.addEventListener('click', () => {
    const targetId = button.dataset.target;
    const card = document.getElementById(targetId);

    if (card) {
      card.classList.add('revealed');
    }

    const allRevealed = [...document.querySelectorAll('.reveal-card')]
      .every((cardEl) => cardEl.classList.contains('revealed'));

    const summary = document.getElementById('comparison-summary');

    if (summary && allRevealed) {
      summary.classList.add('show');
    }
  });
});

document.getElementById('btn-restart').addEventListener('click', () => {
  resetGameState();

  const overlay = document.getElementById('game-start-overlay');
  const readyCard = document.getElementById('game-ready-card');
  const instructionsCard = document.getElementById('game-instructions-card');

  if (overlay) {
    overlay.style.display = 'flex';
  }

  if (readyCard) {
    readyCard.style.display = 'block';
  }

  if (instructionsCard) {
    instructionsCard.style.display = 'none';
  }

  const comparisonSection = document.getElementById('comparison-section');
  if (comparisonSection) {
    comparisonSection.classList.remove('show');
  }

  document.querySelectorAll('.reveal-card').forEach((card) => {
    card.classList.remove('revealed');
  });

  const summary = document.getElementById('comparison-summary');
  if (summary) {
    summary.classList.remove('show');
  }

  const gameScreen = document.getElementById('game-screen');
  if (gameScreen) {
    gameScreen.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────
async function init() {
  try {
    const response = await fetch('data/pitches.json');

    if (!response.ok) {
      throw new Error(`Could not load data/pitches.json: ${response.status}`);
    }

    const loadedPitches = await response.json();

    const playablePitches = loadedPitches.filter(isOnScreenPitch);
    PITCHES = shuffleArray(playablePitches.length >= 20 ? playablePitches : loadedPitches);

    buildDots();
    updateStats();
    hideNextButton();
    disableCallButtons();
    updateProgressText();

    const readyCard = document.getElementById('game-ready-card');
    const instructionsCard = document.getElementById('game-instructions-card');

    if (readyCard) {
      readyCard.style.display = 'block';
    }

    if (instructionsCard) {
      instructionsCard.style.display = 'none';
    }

    const feedbackText = document.getElementById('feedback-text');
    if (feedbackText) {
      feedbackText.textContent = 'Click Start Game when you are ready to call pitches.';
    }
  } catch (error) {
    console.error(error);

    const feedbackText = document.getElementById('feedback-text');
    if (feedbackText) {
      feedbackText.textContent =
        'Could not load data/pitches.json. If you are testing locally, use VS Code Live Server instead of opening the file directly.';
    }
  }
}

init();

// ─── Umpire Accuracy Visualization ─────────────────────────────────────────
// This section loads data/umpire.json and renders the interactive umpire chart.

async function initUmpireAccuracyFromJson() {
  const section = document.getElementById('umpire-accuracy-section');
  const chartSvg = document.getElementById('umpire-chart-svg');

  if (!section || !chartSvg) return;

  try {
    const response = await fetch('data/umpire.json');

    if (!response.ok) {
      throw new Error(`Could not load data/umpire.json: ${response.status}`);
    }

    const rawData = await response.json();
    initUmpireAccuracyViz(rawData);
  } catch (error) {
    console.error(error);

    const heroSub = document.getElementById('umpire-hero-sub');
    if (heroSub) {
      heroSub.textContent =
        'Could not load data/umpire.json. If testing locally, use VS Code Live Server instead of opening the file directly.';
    }
  }
}

function initUmpireAccuracyViz(RAW) {
  const AVG = RAW.avg;
  let currentSort = 'accuracy';
  let currentLimit = 'all';
  let currentOrder = 'asc';
  let searchTerm = '';

  const margin = { top: 20, right: 80, bottom: 10, left: 152 };
  const barHeight = 20;
  const barGap = 5;

  const chartSvg = d3.select('#umpire-chart-svg');
  const tooltip = document.getElementById('umpire-tooltip');

  const heroNum = document.getElementById('umpire-hero-num');
  const heroSub = document.getElementById('umpire-hero-sub');
  const statUmpires = document.getElementById('umpire-stat-umpires');
  const statPitches = document.getElementById('umpire-stat-pitches');
  const statGames = document.getElementById('umpire-stat-games');

  if (heroNum) heroNum.textContent = `${AVG.toFixed(2)}%`;
  if (heroSub) {
    heroSub.textContent = `Across ${RAW.umpires.length} umpires during the June 2025 MLB season`;
  }

  const totalUmpires = RAW.umpires.length;
  const totalPitches = d3.sum(RAW.umpires, (d) => d.pitches);
  const totalGames = d3.sum(RAW.umpires, (d) => d.games);

  if (statUmpires) statUmpires.textContent = totalUmpires.toLocaleString();
  if (statPitches) statPitches.textContent = totalPitches.toLocaleString();
  if (statGames) statGames.textContent = totalGames.toLocaleString();

  function getSortValue(d) {
    if (currentSort === 'above-exp') return d.accuracy_above_exp;
    if (currentSort === 'games') return d.games;
    return d.accuracy;
  }

  function sortUmpires(data, order = currentOrder) {
    return data.sort((a, b) => {
      const aValue = getSortValue(a);
      const bValue = getSortValue(b);

      if (order === 'asc') {
        return aValue - bValue;
      }

      return bValue - aValue;
    });
  }

  function getFilteredUmpires() {
    let data = [...RAW.umpires];

    if (searchTerm) {
      data = data.filter((d) =>
        d.umpire.toLowerCase().includes(searchTerm.toLowerCase())
      );

      return sortUmpires(data, currentOrder);
    }

    data = sortUmpires(data, 'desc');

    if (currentLimit !== 'all') {
      data = data.slice(0, currentLimit);
    }

    return sortUmpires(data, currentOrder);
  }

  function getUmpireBarColor(d) {
    if (d.accuracy >= AVG + 0.5) return '#45b86a';
    if (d.accuracy < AVG - 0.5) return '#e05050';
    return '#5a7090';
  }

  function renderUmpireChart() {
    const data = getFilteredUmpires();
    const noResults = document.getElementById('umpire-no-results');

    if (data.length === 0) {
      chartSvg.style('display', 'none');
      if (noResults) noResults.style.display = 'block';
      return;
    }

    chartSvg.style('display', 'block');
    if (noResults) noResults.style.display = 'none';

    const chartWrap = document.querySelector('.umpire-chart-wrap');
    const width = chartWrap.clientWidth;
    const totalHeight =
      data.length * (barHeight + barGap) + margin.top + margin.bottom + 40;
    const innerWidth = width - margin.left - margin.right;

    chartSvg.attr('width', width).attr('height', totalHeight);
    chartSvg.selectAll('*').remove();

    const minAccuracy = d3.min(data, (d) => d.accuracy) - 0.5;
    const maxAccuracy = d3.max(data, (d) => d.accuracy) + 0.3;

    const xScaleViz = d3
      .scaleLinear()
      .domain([Math.max(minAccuracy, 88), maxAccuracy])
      .range([0, innerWidth]);

    const yScaleViz = d3
      .scaleBand()
      .domain(data.map((d) => d.umpire))
      .range([margin.top, margin.top + data.length * (barHeight + barGap)])
      .paddingInner(0.18)
      .paddingOuter(0.1);

    const chartGroup = chartSvg
      .append('g')
      .attr('transform', `translate(${margin.left},0)`);

    data.forEach((d, i) => {
      if (i % 2 === 0) {
        chartGroup
          .append('rect')
          .attr('x', -margin.left)
          .attr('y', yScaleViz(d.umpire) - 2)
          .attr('width', width)
          .attr('height', yScaleViz.bandwidth() + 4)
          .attr('fill', 'rgba(255,255,255,0.018)')
          .attr('pointer-events', 'none');
      }
    });

    const xAxisGroup = chartGroup
      .append('g')
      .attr('class', 'umpire-axis')
      .attr(
        'transform',
        `translate(0,${margin.top + data.length * (barHeight + barGap) + 8})`
      )
      .call(
        d3
          .axisBottom(xScaleViz)
          .ticks(6)
          .tickFormat((d) => `${d.toFixed(1)}%`)
          .tickSize(-data.length * (barHeight + barGap) - 8)
      );

    xAxisGroup
      .selectAll('.tick line')
      .attr('stroke', '#2e4636')
      .attr('stroke-dasharray', '3,3');

    xAxisGroup.select('.domain').remove();

    const yAxisGroup = chartGroup
      .append('g')
      .attr('class', 'umpire-axis')
      .attr('transform', 'translate(-8,0)')
      .call(d3.axisLeft(yScaleViz).tickSize(0));

    yAxisGroup.select('.domain').remove();

    yAxisGroup
      .selectAll('text')
      .attr('text-anchor', 'end')
      .attr('fill', '#8a94b0')
      .attr('font-size', '11px')
      .attr('font-family', 'IBM Plex Mono, monospace')
      .style('cursor', 'pointer');

    const avgX = xScaleViz(AVG);

    chartGroup
      .append('line')
      .attr('x1', avgX)
      .attr('x2', avgX)
      .attr('y1', margin.top - 4)
      .attr('y2', margin.top + data.length * (barHeight + barGap) + 8)
      .attr('stroke', '#e6a23c')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '5,4')
      .attr('opacity', 0.75);

    chartGroup
      .append('text')
      .attr('x', avgX + 4)
      .attr('y', margin.top - 6)
      .attr('class', 'umpire-avg-label')
      .text(`AVG ${AVG}%`);

    data.forEach((d, i) => {
      chartGroup
        .append('text')
        .attr('x', -margin.left + 2)
        .attr('y', yScaleViz(d.umpire) + yScaleViz.bandwidth() / 2 + 4)
        .attr('fill', '#3a4260')
        .attr('font-family', 'IBM Plex Mono, monospace')
        .attr('font-size', '9px')
        .text(`#${i + 1}`);
    });

    const bars = chartGroup
      .selectAll('.umpire-bar')
      .data(data, (d) => d.umpire)
      .enter()
      .append('rect')
      .attr('class', 'umpire-bar')
      .attr('x', 0)
      .attr('y', (d) => yScaleViz(d.umpire))
      .attr('width', 0)
      .attr('height', yScaleViz.bandwidth())
      .attr('rx', 3)
      .attr('fill', (d) => getUmpireBarColor(d))
      .attr('opacity', 0.85)
      .attr('cursor', 'pointer');

    bars
      .transition()
      .duration(500)
      .delay((d, i) => i * 8)
      .attr('width', (d) => Math.max(0, xScaleViz(d.accuracy)));

    const labels = chartGroup
      .selectAll('.umpire-bar-label')
      .data(data, (d) => d.umpire)
      .enter()
      .append('text')
      .attr('class', 'umpire-bar-label')
      .attr('x', (d) => xScaleViz(d.accuracy) + 5)
      .attr('y', (d) => yScaleViz(d.umpire) + yScaleViz.bandwidth() / 2 + 4)
      .attr('fill', (d) => getUmpireBarColor(d))
      .attr('font-family', 'IBM Plex Mono, monospace')
      .attr('font-size', '10px')
      .attr('font-weight', '600')
      .attr('opacity', 0)
      .text((d) => `${d.accuracy.toFixed(2)}%`);

    labels
      .transition()
      .delay((d, i) => i * 8 + 300)
      .duration(200)
      .attr('opacity', 1);

    bars
      .on('mouseover', function (event, d) {
        d3.select(this).attr('opacity', 1).attr('filter', 'brightness(1.2)');

        labels
          .filter((labelData) => labelData.umpire === d.umpire)
          .attr('opacity', 1)
          .attr('font-size', '11px');

        showUmpireTooltip(event, d);
      })
      .on('mousemove', function (event) {
        positionUmpireTooltip(event);
      })
      .on('mouseout', function (event, d) {
        d3.select(this).attr('opacity', 0.85).attr('filter', null);

        labels
          .filter((labelData) => labelData.umpire === d.umpire)
          .attr('font-size', '10px');

        hideUmpireTooltip();
      });

    yAxisGroup
      .selectAll('text')
      .on('mouseover', function (event, name) {
        const d = data.find((item) => item.umpire === name);
        if (!d) return;

        bars
          .filter((barData) => barData.umpire === name)
          .attr('opacity', 1)
          .attr('filter', 'brightness(1.2)');

        showUmpireTooltip(event, d);
      })
      .on('mousemove', function (event) {
        positionUmpireTooltip(event);
      })
      .on('mouseout', function () {
        bars.attr('opacity', 0.85).attr('filter', null);
        hideUmpireTooltip();
      });
  }

  function showUmpireTooltip(event, d) {
    if (!tooltip) return;

    document.getElementById('tt-name').textContent = d.umpire;
    document.getElementById('tt-accuracy').textContent = `${d.accuracy.toFixed(2)}%`;
    document.getElementById('tt-expected').textContent = `${d.expected_accuracy.toFixed(2)}%`;

    const aboveExpectedEl = document.getElementById('tt-above-exp');
    const aboveSign = d.accuracy_above_exp >= 0 ? '+' : '';

    aboveExpectedEl.textContent = `${aboveSign}${d.accuracy_above_exp.toFixed(2)}%`;
    aboveExpectedEl.className =
      `tt-val ${d.accuracy_above_exp >= 0 ? 'up' : 'down'}`;

    document.getElementById('tt-pitches').textContent = d.pitches.toLocaleString();
    document.getElementById('tt-games').textContent = d.games;
    document.getElementById('tt-consistency').textContent =
      `${d.avg_consistency.toFixed(2)}%`;

    const correctAboveEl = document.getElementById('tt-correct-above');
    const correctSign = d.correct_above_exp >= 0 ? '+' : '';

    correctAboveEl.textContent =
      `${correctSign}${d.correct_above_exp.toFixed(2)} pitches`;

    correctAboveEl.className =
      `tt-val ${d.correct_above_exp >= 0 ? 'up' : 'down'}`;

    const rangeMin = 85;
    const rangeMax = 100;
    const toPercent = (value) =>
      `${((value - rangeMin) / (rangeMax - rangeMin) * 100).toFixed(1)}%`;

    document.getElementById('tt-range-fill').style.left = toPercent(d.min_accuracy);
    document.getElementById('tt-range-fill').style.width =
      `${((d.max_accuracy - d.min_accuracy) / (rangeMax - rangeMin) * 100).toFixed(1)}%`;

    document.getElementById('tt-range-min').style.left = toPercent(d.min_accuracy);
    document.getElementById('tt-range-max').style.left = toPercent(d.max_accuracy);
    document.getElementById('tt-range-cur').style.left = toPercent(d.accuracy);

    document.getElementById('tt-min-label').textContent =
      `${d.min_accuracy.toFixed(1)}%`;

    document.getElementById('tt-max-label').textContent =
      `${d.max_accuracy.toFixed(1)}%`;

    document.getElementById('tt-avg-label').textContent =
      `${d.accuracy.toFixed(2)}%`;

    const badgeWrap = document.getElementById('tt-badge-wrap');

    let badgeClass;
    let badgeText;

    if (d.accuracy >= 95.5) {
      badgeClass = 'elite';
      badgeText = '⭐ Elite Accuracy';
    } else if (d.accuracy >= AVG) {
      badgeClass = 'good';
      badgeText = '✓ Above Average';
    } else {
      badgeClass = 'below';
      badgeText = '↓ Below Average';
    }

    badgeWrap.innerHTML = `<span class="tt-badge ${badgeClass}">${badgeText}</span>`;

    tooltip.classList.add('visible');
    positionUmpireTooltip(event);
  }

  function positionUmpireTooltip(event) {
    if (!tooltip) return;

    const tooltipWidth = 260;
    const tooltipHeight = 320;
    const padding = 14;

    let x = event.clientX + padding;
    let y = event.clientY - tooltipHeight / 2;

    if (x + tooltipWidth > window.innerWidth - 10) {
      x = event.clientX - tooltipWidth - padding;
    }

    if (y < 10) y = 10;

    if (y + tooltipHeight > window.innerHeight - 10) {
      y = window.innerHeight - tooltipHeight - 10;
    }

    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }

  function hideUmpireTooltip() {
    if (!tooltip) return;
    tooltip.classList.remove('visible');
  }

  document.querySelectorAll('.umpire-sort-btn').forEach((button) => {
    button.addEventListener('click', function () {
      document.querySelectorAll('.umpire-sort-btn').forEach((btn) => {
        btn.classList.remove('active');
      });

      this.classList.add('active');
      currentSort = this.id.replace('sort-', '');
      renderUmpireChart();
    });
  });

  document.querySelectorAll('.umpire-limit-btn').forEach((button) => {
    button.addEventListener('click', function () {
      document.querySelectorAll('.umpire-limit-btn').forEach((btn) => {
        btn.classList.remove('active');
      });

      this.classList.add('active');

      const limitValue = this.dataset.limit;
      currentLimit = limitValue === 'all' ? 'all' : Number(limitValue);

      renderUmpireChart();
    });
  });

  document.querySelectorAll('.umpire-order-btn').forEach((button) => {
    button.addEventListener('click', function () {
      document.querySelectorAll('.umpire-order-btn').forEach((btn) => {
        btn.classList.remove('active');
      });

      this.classList.add('active');
      currentOrder = this.dataset.order || 'desc';

      renderUmpireChart();
    });
  });

  const searchBox = document.getElementById('umpire-search-box');

  if (searchBox) {
    searchBox.addEventListener('input', function () {
      searchTerm = this.value.trim();
      renderUmpireChart();
    });
  }

  window.addEventListener('resize', () => {
    clearTimeout(window._umpireAccuracyResizeTimer);
    window._umpireAccuracyResizeTimer = setTimeout(renderUmpireChart, 120);
  });

  renderUmpireChart();
}

initUmpireAccuracyFromJson();