(function () {
  const GF = {
    score: 0,
    combo: 0,
    bestCombo: 0,
    pointsThisGame: 0,
    soundOn: true,
    ac: null,
    built: false
  };
  window.GameFeel = GF;
  GF.renderLeaderboard = function () { renderLeaderboard(); };

  function ctx() {
    if (!GF.ac) {
      try { GF.ac = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { GF.ac = null; }
    }
    return GF.ac;
  }
  function resumeAudio() {
    const c = ctx();
    if (c && c.state === 'suspended') c.resume();
  }
  function tone(freq, startOffset, dur, type, gain) {
    const c = ctx();
    if (!c || !GF.soundOn) return;
    const t = c.currentTime + startOffset;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.16, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.03);
  }
  function noiseBurst(startOffset, dur, gain, hp) {
    const c = ctx();
    if (!c || !GF.soundOn) return;
    const t = c.currentTime + startOffset;
    const n = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource();
    s.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp || 1400;
    const g = c.createGain();
    g.gain.value = gain || 0.18;
    s.connect(f).connect(g).connect(c.destination);
    s.start(t);
  }
  const sfx = {
    correct() { tone(660, 0, 0.12, 'triangle', 0.16); tone(988, 0.07, 0.16, 'triangle', 0.14); noiseBurst(0, 0.04, 0.10, 2200); },
    crack()   { noiseBurst(0, 0.06, 0.22, 900); tone(180, 0, 0.05, 'square', 0.12); },
    wrong()   { tone(196, 0, 0.20, 'sawtooth', 0.15); tone(150, 0.12, 0.24, 'sawtooth', 0.13); },
    combo(level) { const base = 523; [0, 0.07, 0.14, 0.21].forEach((s, i) => tone(base * Math.pow(1.16, i + level), s, 0.14, 'square', 0.11)); },
    start()   { [392, 523, 659, 784].forEach((f, i) => tone(f, i * 0.09, 0.20, 'triangle', 0.15)); },
    over()    { [392, 311, 233].forEach((f, i) => tone(f, i * 0.17, 0.32, 'sine', 0.16)); }
  };

  let elScore, elCombo, elComboTxt, elMult, elOuts, elSoundBtn, elFloaters, elFlash, zoneWrap;
  let elLbList, elLbSave;
  let activeCallouts = 0;

  // ── Leaderboard (persists across refreshes via the browser's localStorage) ──
  var LB_KEY = 'umpireLeaderboardV1';
  var pendingRun = null;   // a finished game waiting to be saved
  var lastSavedId = null;  // highlight the most recently saved row

  function loadLB() {
    try {
      var raw = localStorage.getItem(LB_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveLB(arr) {
    try { localStorage.setItem(LB_KEY, JSON.stringify(arr)); } catch (e) { /* storage blocked */ }
  }
  function addToLB(entry) {
    var arr = loadLB();
    arr.push(entry);
    arr.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    arr = arr.slice(0, 25);
    saveLB(arr);
    return arr;
  }
  function renderLeaderboard() {
    if (!elLbList || !elLbSave) return;

    // Save form — only while there's a freshly finished, unsaved run.
    elLbSave.innerHTML = '';
    if (pendingRun) {
      var row = el('div', 'gf-lb-saverow');
      row.appendChild(el('span', 'gf-lb-savelabel',
        'Save your ' + (pendingRun.score || 0).toLocaleString() + ' pts:'));
      var input = el('input', 'gf-lb-input');
      input.type = 'text'; input.maxLength = 24; input.placeholder = 'Your name';
      var btn = el('button', 'gf-lb-savebtn', 'Save');
      btn.type = 'button';
      function doSave() {
        var name = (input.value || '').trim().slice(0, 24) || 'YOU';
        addToLB({
          id: pendingRun.id, name: name, score: pendingRun.score,
          acc: pendingRun.acc, streak: pendingRun.streak, ts: pendingRun.ts
        });
        lastSavedId = pendingRun.id;
        pendingRun = null;
        renderLeaderboard();
      }
      btn.addEventListener('click', doSave);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doSave(); } });
      row.appendChild(input);
      row.appendChild(btn);
      elLbSave.appendChild(row);
      setTimeout(function () { try { input.focus(); } catch (e) {} }, 40);
    }

    // Top scores list
    elLbList.innerHTML = '';
    var arr = loadLB();
    if (!arr.length) {
      elLbList.appendChild(el('li', 'gf-lb-empty', 'No scores yet — play a game!'));
      return;
    }
    arr.slice(0, 8).forEach(function (e, i) {
      var li = el('li', 'gf-lb-row' + (e.id === lastSavedId ? ' you' : ''));
      li.innerHTML =
        '<span class="gf-lb-rank">' + (i + 1) + '</span>' +
        '<span class="gf-lb-name">' + (e.name || '---') + '</span>' +
        '<span class="gf-lb-acc">' + (e.acc != null ? e.acc + '%' : '--') + '</span>' +
        '<span class="gf-lb-score">' + (e.score || 0).toLocaleString() + '</span>';
      elLbList.appendChild(li);
    });
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function build() {
    if (GF.built) return;
    zoneWrap = document.querySelector('.zone-wrapper');
    // Put the scoreboard in the right-hand column so it's visible during play.
    const rightPanel = document.querySelector('.right-panel');
    const host = rightPanel || document.querySelector('.pitch-panel');
    if (!host || !zoneWrap) return;

    /* Scoreboard card (matches the other right-column cards) */
    const card = el('div', 'panel-card gf-scoreboard');
    card.appendChild(el('h3', null, 'Scoreboard'));

    const top = el('div', 'gf-sb-top');

    const scoreWrap = el('div', 'gf-score-wrap');
    scoreWrap.appendChild(el('span', 'gf-score-label', 'Score'));
    elScore = el('span', 'gf-score', '0');
    scoreWrap.appendChild(elScore);
    top.appendChild(scoreWrap);

    const comboWrap = el('div', 'gf-combo-wrap');
    comboWrap.appendChild(el('span', 'gf-combo-fire', '🔥'));
    elComboTxt = el('span', 'gf-combo-txt', 'x0');
    comboWrap.appendChild(elComboTxt);
    elMult = el('span', 'gf-mult', '1× pts');
    comboWrap.appendChild(elMult);
    elCombo = comboWrap;
    top.appendChild(elCombo);

    const bottom = el('div', 'gf-sb-bottom');
    const outsWrap = el('div', 'gf-outs-wrap');
    outsWrap.appendChild(el('span', 'gf-outs-label', 'Outs'));
    elOuts = el('div', 'gf-outs');
    for (let i = 0; i < 3; i++) elOuts.appendChild(el('span', 'gf-out', '⚾'));
    outsWrap.appendChild(elOuts);
    bottom.appendChild(outsWrap);

    elSoundBtn = el('button', 'gf-sound', '🔊');
    elSoundBtn.type = 'button';
    elSoundBtn.title = 'Toggle sound';
    elSoundBtn.addEventListener('click', () => {
      GF.soundOn = !GF.soundOn;
      elSoundBtn.textContent = GF.soundOn ? '🔊' : '🔇';
      if (GF.soundOn) { resumeAudio(); sfx.correct(); }
    });
    bottom.appendChild(elSoundBtn);

    card.appendChild(top);
    card.appendChild(bottom);
    // Place the scoreboard just below the LIVE MODE card.
    const phaseCard = document.getElementById('phase-card');
    if (rightPanel && phaseCard && phaseCard.parentNode === rightPanel) {
      rightPanel.insertBefore(card, phaseCard.nextSibling);
    } else {
      host.insertBefore(card, host.firstChild);
    }

    /* floater + flash layers stay over the zone where the action is */
    zoneWrap.style.position = zoneWrap.style.position || 'relative';
    elFlash = el('div', 'gf-flash');
    elFloaters = el('div', 'gf-floaters');
    zoneWrap.appendChild(elFlash);
    zoneWrap.appendChild(elFloaters);

    // Leaderboard lives in a popup modal (in index.html); grab its elements.
    elLbSave = document.getElementById('gf-lb-save');
    elLbList = document.getElementById('gf-lb-list');

    GF.built = true;
    renderHud();
    renderLeaderboard();
  }

  function renderHud() {
    if (!GF.built) return;
    elScore.textContent = GF.score.toLocaleString();
    elComboTxt.textContent = 'x' + GF.combo;
    const m = multiplier();
    elMult.textContent = m + '× pts';
    elCombo.classList.toggle('live', GF.combo >= 2);
  }

  function bumpScore() {
    if (!elScore) return;
    elScore.classList.remove('bump');
    void elScore.offsetWidth;
    elScore.classList.add('bump');
  }

  function spawnFloat(textHtml, kind) {
    if (!elFloaters) return;
    const f = el('div', 'gf-float', textHtml);
    f.style.color = kind === 'wrong' ? 'var(--wrong)'
      : kind === 'big' ? 'var(--accent)' : 'var(--correct)';
    elFloaters.appendChild(f);
    setTimeout(() => f.remove(), 1100);
  }

  function spawnCallout(text) {
    if (!elFloaters) return;
    const c = el('div', 'gf-callout', text);
    // Stack multiple call-outs (e.g. GREAT EYE! + ON FIRE!) so they don't overlap.
    c.style.top = (44 + activeCallouts * 46) + 'px';
    activeCallouts++;
    elFloaters.appendChild(c);
    setTimeout(() => { c.remove(); activeCallouts = Math.max(0, activeCallouts - 1); }, 1200);
  }

  function flash(kind) {
    if (!elFlash) return;
    elFlash.className = 'gf-flash ' + (kind === 'wrong' ? 'go-wrong' : 'go-correct');
    if (kind === 'wrong' && zoneWrap) {
      zoneWrap.classList.remove('gf-shake');
      void zoneWrap.offsetWidth;
      zoneWrap.classList.add('gf-shake');
    }
    setTimeout(() => { if (elFlash) elFlash.className = 'gf-flash'; }, 520);
  }

  function pressButton(kind) {
    const id = kind === 'strike' ? 'btn-strike' : 'btn-ball';
    const b = document.getElementById(id);
    if (!b) return;
    b.classList.remove('gf-press');
    void b.offsetWidth;
    b.classList.add('gf-press');
  }

  function multiplier() {
    return Math.min(1 + Math.floor(GF.combo / 3), 5);
  }

  function setOuts(errs) {
    if (!elOuts) return;
    [...elOuts.children].forEach((node, i) => {
      const lost = i < errs;
      node.classList.toggle('lost', lost);
      node.textContent = lost ? '❌' : '⚾';
    });
  }

  const MILESTONES = {
    5: 'ON FIRE!',
    8: 'RED HOT!',
    12: 'UNHITTABLE!',
    16: 'LEGENDARY!'
  };

  const RANKS = [
    { minAcc: 0,  min: 0,    badge: '🧢', title: 'Sandlot Rookie',     blurb: 'Everyone starts somewhere — keep your eye on the zone.' },
    { minAcc: 62, min: 300,  badge: '⚾', title: 'Single-A Call-Up',    blurb: 'Finding your footing behind the plate. Keep sharpening that eye.' },
    { minAcc: 75, min: 900,  badge: '🎯', title: 'Big-League Umpire',   blurb: "Solid, dependable calls — you belong in the show." },
    { minAcc: 84, min: 1800, badge: '⭐', title: 'All-Star Arbiter',    blurb: 'Elite zone awareness. The crowd respects your eye.' },
    { minAcc: 90, min: 2800, badge: '🧤', title: 'Gold-Glove Eyes',     blurb: 'Almost nothing gets past you out there.' },
    { minAcc: 94, min: 4000, badge: '🏆', title: 'Hall-of-Fame Vision', blurb: 'You out-umped the umps. Cooperstown is on the line.' }
  ];
  function rankFor(score, accuracyPct) {
    const acc = (typeof accuracyPct === 'number') ? accuracyPct : 0;
    let r = RANKS[0];
    for (const tier of RANKS) {
      if (acc >= tier.minAcc && score >= tier.min) r = tier;
    }
    return r;
  }

  GF.onStart = function (onComplete) {
    build();
    resumeAudio();
    sfx.start();
    const ov = el('div', 'gf-playball');
    ov.appendChild(el('span', null, '⚾ PLAY BALL!'));
    document.body.appendChild(ov);
    setTimeout(() => {
      ov.remove();
      if (typeof onComplete === 'function') onComplete();
    }, 1150);
  };

  GF.onCall = function (info) {
    build();
    info = info || {};
    const correct = !!info.isCorrect;
    const pitch = info.pitch || {};
    const responseTime = info.responseTime || 0;
    const borderline = !!info.borderline;

    pressButton(info.userCall);

    if (correct) {
      GF.combo += 1;
      GF.bestCombo = Math.max(GF.bestCombo, GF.combo);
      const mult = multiplier();

      // Difficulty from how close the pitch was to the zone edge.
      // d ~ 0px = right on the edge (brutal call); large = an obvious ball/strike.
      const d = (typeof info.edgeDistancePx === 'number') ? info.edgeDistancePx : 45;
      const MAX_D = 80;
      const diff = Math.max(0, Math.min(1, (MAX_D - d) / MAX_D)); // 0 = easy, 1 = hardest
      // Quadratic ramp: obvious pitches pay almost nothing, edge pitches pay big.
      const difficultyPoints = Math.round(20 + diff * diff * 280);

      const speedBonus = Math.max(0, Math.round(((pitch.speed || 85) - 82) * 3));
      const quickBonus = responseTime > 0
        ? Math.max(0, Math.min(80, Math.round((1400 - responseTime) / 14)))
        : 0;

      let earned = Math.round((difficultyPoints + speedBonus + quickBonus) * mult);
      // Practice pitches (zone visible) are easy — award far fewer points.
      if (info.practice) earned = Math.max(8, Math.round(earned * 0.2));
      GF.score += earned;
      GF.pointsThisGame += earned;

      const big = mult >= 3 || diff >= 0.7;
      let label = '+' + earned;
      if (mult > 1) label += ' <span style="font-size:.6em;opacity:.85">×' + mult + '</span>';
      spawnFloat(label, big ? 'big' : 'correct');

      flash('correct');
      sfx.correct();
      if (borderline) { spawnCallout('GREAT EYE!'); sfx.crack(); }
      if (MILESTONES[GF.combo]) { spawnCallout(MILESTONES[GF.combo]); sfx.combo(Math.min(GF.combo / 3, 4)); }

      bumpScore();
    } else {
      GF.combo = 0;
      spawnFloat('MISS', 'wrong');
      flash('wrong');
      sfx.wrong();
    }

    if (typeof info.errors === 'number') setOuts(info.errors);
    renderHud();
  };

  GF.reset = function () {
    GF.score = 0;
    GF.combo = 0;
    GF.bestCombo = 0;
    GF.pointsThisGame = 0;
    setOuts(0);
    renderHud();
    const old = document.getElementById('gf-rank');
    if (old) old.remove();
  };

  GF.onGameOver = function (stats) {
    stats = stats || {};
    build();
    sfx.over();

    // Record this run as a pending (unsaved) leaderboard entry.
    pendingRun = {
      id: 'r' + Date.now(),
      score: GF.score,
      acc: (stats.accuracyPct != null ? stats.accuracyPct : null),
      streak: GF.bestCombo,
      ts: Date.now()
    };
    renderLeaderboard();

    const section = document.getElementById('comparison-section');
    if (!section) return;

    const old = document.getElementById('gf-rank');
    if (old) old.remove();

    const r = rankFor(GF.score, stats.accuracyPct);
    const banner = el('div', 'gf-rank');
    banner.id = 'gf-rank';
    banner.innerHTML =
      '<div class="gf-rank-kicker">Final Rank</div>' +
      '<div class="gf-rank-badge">' + r.badge + '</div>' +
      '<div class="gf-rank-title">' + r.title + '</div>' +
      '<div class="gf-rank-score">' + GF.score.toLocaleString() +
        '<small>Total Points</small></div>' +
      '<div class="gf-rank-row">' +
        '<span><strong>' + (stats.correct || 0) + '</strong>Correct</span>' +
        '<span><strong>' + GF.bestCombo + '</strong>Best Streak</span>' +
        '<span><strong>' + (stats.accuracyPct != null ? stats.accuracyPct + '%' : '--') + '</strong>Accuracy</span>' +
      '</div>' +
      '<div class="gf-rank-blurb">' + r.blurb + '</div>' +
      '<button type="button" id="gf-open-lb" class="gf-rank-lb-btn">🏆 Save to Leaderboard</button>';

    const header = section.querySelector('h1');
    if (header && header.nextSibling) {
      section.insertBefore(banner, header.nextSibling);
    } else {
      section.insertBefore(banner, section.firstChild);
    }

    const openBtn = document.getElementById('gf-open-lb');
    if (openBtn) openBtn.addEventListener('click', function () {
      if (window.openLeaderboard) window.openLeaderboard();
    });
  };

  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (k === 's' || e.key === 'ArrowLeft') {
      const b = document.getElementById('btn-strike');
      if (b && !b.disabled) { resumeAudio(); b.click(); }
    } else if (k === 'b' || e.key === 'ArrowRight') {
      const b = document.getElementById('btn-ball');
      if (b && !b.disabled) { resumeAudio(); b.click(); }
    } else if (k === ' ' || e.key === 'Enter') {
      const n = document.getElementById('btn-next');
      if (n && n.offsetParent !== null) { e.preventDefault(); n.click(); }
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
