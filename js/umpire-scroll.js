// ─── One Game, Every Call Scrollytelling Section (real on-page, no iframe) ───
(function initOneGameEveryCallScroll() {
  function startWhenReady() {
    const host = document.getElementById('one-game-scroll-section');
    if (!host) return;
    if (typeof d3 === 'undefined') { setTimeout(startWhenReady, 100); return; }
let GAMES_DATA = [];

// ══════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════
const ZONE_LEFT  = -0.708;
const ZONE_RIGHT =  0.708;
const W = 400, H = 400;
const MG = { top:28, right:22, bottom:36, left:22 };
const PW = W - MG.left - MG.right;
const PH = H - MG.top  - MG.bottom;

const xSc = d3.scaleLinear().domain([-2.2, 2.2]).range([0, PW]);
const ySc = d3.scaleLinear().domain([0.3, 4.8]).range([PH, 0]);

const TYPE_COLORS = {
  '4-Seam Fastball':'#e05050', 'Sinker':'#ff8c42', 'Cutter':'#f0c040',
  'Slider':'#5ba3ff', 'Sweeper':'#9b7fe8', 'Curveball':'#2fc4b2',
  'Changeup':'#4ade80', 'Split-Finger':'#f97316', 'Knuckle Curve':'#06b6d4',
  'Slurve':'#c084fc', 'Unknown':'#6b7280',
};
function typeColor(n){ return TYPE_COLORS[n] || '#9ca3af'; }

// A pitch counts as touching the zone if the baseball overlaps the displayed strike zone.
// This keeps the yellow highlight matched to what the viewer sees on the chart.
const BALL_RADIUS_FT = 0.12;
function pitchTouchesZone(p, zone) {
  const top = zone && Number.isFinite(zone.top) ? zone.top : p.t;
  const bot = zone && Number.isFinite(zone.bot) ? zone.bot : p.b;
  return (
    p.x + BALL_RADIUS_FT >= ZONE_LEFT &&
    p.x - BALL_RADIUS_FT <= ZONE_RIGHT &&
    p.z + BALL_RADIUS_FT >= bot &&
    p.z - BALL_RADIUS_FT <= top
  );
}

function markDisplayedZoneMisses(pitches, zone) {
  pitches.forEach(p => {
    const touches = pitchTouchesZone(p, zone);
    p._wrongStrike = p.c === 1 && !touches;
    p._wrongBall = p.c === 0 && touches;
    p._actualMiss = p._wrongStrike || p._wrongBall;
  });
}

// ══════════════════════════════════════
//  STATE
// ══════════════════════════════════════
let currentGame = null;
let currentStep = 0;
const TOTAL_STEPS = 8;

// ══════════════════════════════════════
//  GAME LOADING
// ══════════════════════════════════════
function pickRandomGame() {
  const idx = Math.floor(Math.random() * GAMES_DATA.length);
  loadGame(GAMES_DATA[idx]);
}

function loadGame(game) {
  currentGame = game;
  currentStep = 0;

  document.getElementById('scroll-hero-matchup').textContent = `${game.away} @ ${game.home}`;
  document.getElementById('scroll-hero-meta').textContent    = `${game.date} · ${game.stats.total} called pitches`;
  document.getElementById('scroll-scroll-hint').style.display = 'block';
  document.getElementById('scroll-story').style.display = 'block';

  // Fill text spans
  document.getElementById('scroll-s1-total').textContent   = game.stats.total;
  document.getElementById('scroll-s3-total').textContent   = game.stats.total;
  const slide3Strikes = document.getElementById('scroll-s3-strikes');
  const slide3Balls = document.getElementById('scroll-s3-balls');
  if (slide3Strikes) slide3Strikes.textContent = game.stats.strikes;
  if (slide3Balls) slide3Balls.textContent = game.stats.balls;
  document.getElementById('scroll-s4-strikes').textContent = game.stats.strikes;
  document.getElementById('scroll-s5-balls').textContent   = game.stats.balls;
  document.getElementById('scroll-s6-missed').textContent  = game.stats.missed;
  document.getElementById('scroll-s6-miss-b').textContent  = `${game.stats.ms} pitch${game.stats.ms!==1?'es':''}`;
  document.getElementById('scroll-s6-miss-s').textContent  = `${game.stats.mb} pitch${game.stats.mb!==1?'es':''}`;

  // Type pills
  const pills = document.getElementById('scroll-type-pills-left');
  pills.innerHTML = '';
  Object.entries(game.types).slice(0,8).forEach(([name, count]) => {
    const pill = document.createElement('div');
    pill.className = 'type-pill';
    pill.innerHTML = `<div class="type-pill-dot" style="background:${typeColor(name)}"></div><span>${name} <strong style="color:${typeColor(name)}">(${count})</strong></span>`;
    pills.appendChild(pill);
  });

  // Summary grid
  document.getElementById('scroll-summary-grid').innerHTML = `
    <div class="summary-card"><div class="big" style="color:var(--correct)">${game.stats.acc}%</div><div class="label">Call Accuracy</div></div>
    <div class="summary-card"><div class="big" style="color:var(--ink)">${game.stats.total}</div><div class="label">Total Called Pitches</div></div>
    <div class="summary-card"><div class="big" style="color:var(--strike)">${game.stats.strikes}</div><div class="label">Called Strikes</div></div>
    <div class="summary-card"><div class="big" style="color:var(--ball)">${game.stats.balls}</div><div class="label">Called Balls</div></div>
    <div class="summary-card"><div class="big" style="color:var(--miss-dark)">${game.stats.missed}</div><div class="label">Missed Calls</div></div>
    <div class="summary-card"><div class="big" style="font-size:24px;line-height:1.2;letter-spacing:0.5px;color:#ffffff;"><div>${game.stats.ms} strike${game.stats.ms!==1?'s':''} called a <span style="color:var(--ball)">ball</span></div><div style="margin-top:8px;">${game.stats.mb} ball${game.stats.mb!==1?'s':''} called a <span style="color:var(--strike)">strike</span></div></div><div class="label">Miss Type Breakdown</div></div>
  `;

  // Verdict
  const missRate = (game.stats.missed/game.stats.total*100).toFixed(1);
  let verdict;
  if (game.stats.acc >= 94) {
    verdict = `With <strong>${game.stats.acc}%</strong> accuracy, this was a strong outing. The umpire missed only <strong>${game.stats.missed}</strong> of ${game.stats.total} pitches — ${missRate}% miss rate. Even at this level, several misses came on pitches within an inch of the zone boundary, where no human eye can be consistently perfect.`;
  } else if (game.stats.acc >= 90) {
    verdict = `At <strong>${game.stats.acc}%</strong>, the umpire got most calls right — but missed <strong>${game.stats.missed}</strong> pitches (${missRate}%). The toughest calls were borderline pitches right on the zone edge, where a batter's height and a pitcher's movement conspire to make certainty impossible.`;
  } else {
    verdict = `At <strong>${game.stats.acc}%</strong>, this was a rough game behind the plate. <strong>${game.stats.missed}</strong> pitches — ${missRate}% of all calls — went the wrong way. Some were clear misses; others borderline pitches that could have gone either way. All happened in under half a second.`;
  }
  document.getElementById('scroll-accuracy-verdict').innerHTML = verdict;

  // Progress dots
  const prog = document.getElementById('scroll-viz-progress');
  prog.innerHTML = '';
  for (let i = 1; i <= TOTAL_STEPS; i++) {
    const dot = document.createElement('div');
    dot.className = 'prog-dot' + (i === 1 ? ' active' : '');
    dot.id = `scroll-prog-${i}`;
    dot.onclick = () => document.getElementById(`scroll-section-${i}`).scrollIntoView({behavior:'smooth'});
    prog.appendChild(dot);
  }

  // Reset all sections to invisible (for re-use)
  document.querySelectorAll('.scroll-section').forEach(el => el.classList.remove('visible'));

  // Reset SVG
  clearAll();
  renderViz(1);
  setTimeout(updateScrollStoryStepFromViewport, 50);
}

// ══════════════════════════════════════
//  SVG SETUP
// ══════════════════════════════════════
const svg = d3.select('#scroll-zone-svg');
const defs = svg.append('defs');

// Glow for missed
const glow = defs.append('filter').attr('id','scroll-missGlow');
glow.append('feGaussianBlur').attr('in','SourceGraphic').attr('stdDeviation','3').attr('result','b');
const fm2 = glow.append('feMerge');
fm2.append('feMergeNode').attr('in','b');
fm2.append('feMergeNode').attr('in','SourceGraphic');

// Shadow for zone box
const shadow = defs.append('filter').attr('id','scroll-shadow');
shadow.append('feDropShadow').attr('dx',0).attr('dy',0).attr('stdDeviation','5').attr('flood-color','rgba(240,192,64,0.35)');

// Main group
const G = svg.append('g').attr('transform', `translate(${MG.left},${MG.top})`);

// Persistent background layer (for zone chart steps 3-7)
const bgLayer     = G.append('g').attr('class','bg-layer');
// Dynamic content layer (everything that changes per step)
const dynLayer    = G.append('g').attr('class','dyn-layer');
// Missed rings on top
const ringsLayer  = G.append('g').attr('class','rings-layer');

function clearAll() {
  bgLayer.selectAll('*').remove();
  dynLayer.selectAll('*').remove();
  ringsLayer.selectAll('*').remove();
  document.getElementById('scroll-viz-legend').innerHTML = '';
}

function clearDynamic() {
  dynLayer.selectAll('*').remove();
  ringsLayer.selectAll('*').remove();
  document.getElementById('scroll-viz-legend').innerHTML = '';
}

// ══════════════════════════════════════
//  ZONE BACKGROUND (steps 3–7)
// ══════════════════════════════════════
function drawZoneBg(avgTop, avgBot) {
  bgLayer.selectAll('*').remove();

  // Grid
  [-2,-1,0,1,2].forEach(x => {
    bgLayer.append('line').attr('x1',xSc(x)).attr('x2',xSc(x)).attr('y1',0).attr('y2',PH)
      .attr('stroke','rgba(255,255,255,0.05)').attr('stroke-width',1);
  });
  [1,2,3,4].forEach(z => {
    bgLayer.append('line').attr('x1',0).attr('x2',PW).attr('y1',ySc(z)).attr('y2',ySc(z))
      .attr('stroke','rgba(255,255,255,0.05)').attr('stroke-width',1);
  });

  // Home plate
  const px = xSc(0), py = ySc(0.3);
  bgLayer.append('path')
    .attr('d',`M${px-18},${py} L${px+18},${py} L${px+18},${py-6} L${px},${py-14} L${px-18},${py-6} Z`)
    .attr('fill','rgba(255,255,255,0.08)').attr('stroke','rgba(255,255,255,0.15)').attr('stroke-width',1);

  // Zone rect
  const zx = xSc(ZONE_LEFT), zw = xSc(ZONE_RIGHT)-xSc(ZONE_LEFT);
  const zy = ySc(avgTop),    zh = ySc(avgBot)-ySc(avgTop);
  bgLayer.append('rect').attr('x',zx).attr('y',zy).attr('width',zw).attr('height',zh)
    .attr('fill','rgba(240,192,64,0.04)').attr('stroke','rgba(240,192,64,0.6)')
    .attr('stroke-width',1.5).attr('stroke-dasharray','6,4').attr('rx',1).attr('filter','url(#scroll-shadow)');
  bgLayer.append('text').attr('x',zx+zw/2).attr('y',zy-5).attr('text-anchor','middle')
    .attr('fill','rgba(240,192,64,0.4)').attr('font-family','IBM Plex Mono,monospace')
    .attr('font-size','8px').attr('letter-spacing','1.5px').text('STRIKE ZONE');

  // Axes
  const xAx = G.append('g').attr('class','axis-x').attr('transform',`translate(0,${PH})`);
  xAx.call(d3.axisBottom(xSc).ticks(5).tickFormat(d=>`${d}ft`).tickSize(3));
  xAx.selectAll('text').attr('fill','rgba(255,255,255,0.25)').attr('font-size','8px').attr('font-family','IBM Plex Mono,monospace');
  xAx.select('.domain').attr('stroke','rgba(255,255,255,0.08)');
  xAx.selectAll('.tick line').attr('stroke','rgba(255,255,255,0.08)');

  const yAx = G.append('g').attr('class','axis-y');
  yAx.call(d3.axisLeft(ySc).ticks(4).tickFormat(d=>`${d}ft`).tickSize(3));
  yAx.selectAll('text').attr('fill','rgba(255,255,255,0.25)').attr('font-size','8px').attr('font-family','IBM Plex Mono,monospace');
  yAx.select('.domain').attr('stroke','rgba(255,255,255,0.08)');
  yAx.selectAll('.tick line').attr('stroke','rgba(255,255,255,0.08)');
}

function getAvgZone(pitches) {
  const tops = pitches.map(p=>p.t).filter(Boolean);
  const bots = pitches.map(p=>p.b).filter(Boolean);
  return { top: tops.reduce((a,b)=>a+b,0)/tops.length, bot: bots.reduce((a,b)=>a+b,0)/bots.length };
}

// ══════════════════════════════════════
//  RENDER DISPATCH
// ══════════════════════════════════════
function renderViz(step) {
  if (!currentGame) return;
  currentStep = step;

  // Update progress dots
  for (let i=1; i<=TOTAL_STEPS; i++) {
    const dot = document.getElementById(`scroll-prog-${i}`);
    if (dot) dot.className = 'prog-dot' + (i===step?' active':'');
  }

  const pitches = currentGame.pitches;
  const zone    = getAvgZone(pitches);
  markDisplayedZoneMisses(pitches, zone);
  const captions = [
    '',
    'Every Pitch The Umpire Saw',
    'Pitch Type Breakdown',
    `${currentGame.stats.strikes} Strikes vs ${currentGame.stats.balls} Balls`,
    `All ${pitches.length} Pitch Locations`,
    `${currentGame.stats.strikes} Called Strikes`,
    `${currentGame.stats.balls} Called Balls`,
    `${currentGame.stats.missed} Missed Calls`,
    'Game Summary'
  ];
  document.getElementById('scroll-viz-caption').textContent = captions[step] || '';

  if (step <= 3) {
    // Clear zone bg axes too
    bgLayer.selectAll('*').remove();
    G.selectAll('.axis-x,.axis-y').remove();
    clearDynamic();
  } else {
    // Ensure zone bg drawn; if coming from step 1/2 axes may not exist
    G.selectAll('.axis-x,.axis-y').remove();
    clearDynamic();
    drawZoneBg(zone.top, zone.bot);
  }

  if      (step === 1) renderSpiral(pitches);
  else if (step === 2) renderBlobSplit(pitches);
  else if (step === 3) renderCallSplit(pitches);
  else if (step === 4) renderZoneDots(pitches, p=>p.c===1?'rgba(200,57,43,0.75)':'rgba(37,99,176,0.65)', ()=>5, ()=>0.88, false,
      [{color:'rgba(200,57,43,0.8)',label:'Called Strike'},{color:'rgba(37,99,176,0.8)',label:'Called Ball'}]);
  else if (step === 5) renderZoneDots(pitches.filter(p=>p.c===1),
      ()=>'rgba(200,57,43,0.9)',
      ()=>5.5,
      ()=>0.95,
      true,
      [{color:'rgba(200,57,43,0.9)',label:'Called Strike'},{color:'rgba(245,155,0,0.9)',label:'Outside Zone, Called Strike'}],
      pitches.filter(p=>p.c===0), 'rgba(37,99,176,0.1)',
      p=>p._wrongStrike);
  else if (step === 6) renderZoneDots(pitches.filter(p=>p.c===0),
      ()=>'rgba(37,99,176,0.9)',
      ()=>5.5,
      ()=>0.95,
      true,
      [{color:'rgba(37,99,176,0.9)',label:'Called Ball'},{color:'rgba(245,155,0,0.9)',label:'Inside Zone, Called Ball'}],
      pitches.filter(p=>p.c===1), 'rgba(200,57,43,0.1)',
      p=>p._wrongBall);
  else if (step === 7) renderZoneDots(pitches,
      p=>p._actualMiss?'#f59b00':(p.c===1?'rgba(200,57,43,0.28)':'rgba(37,99,176,0.24)'),
      ()=>4.8,
      p=>p._actualMiss?1:0.28,
      true,
      [{color:'rgba(200,57,43,0.35)',label:'Called Strike'},{color:'rgba(37,99,176,0.35)',label:'Called Ball'},{color:'#f59b00',label:'Missed Call'}],
      null, null,
      p=>p._actualMiss);
  else if (step === 8) renderZoneDots(pitches,
      p=>p.c===1?'rgba(200,57,43,0.75)':'rgba(37,99,176,0.65)',
      ()=>4.8,
      p=>p._actualMiss?0.95:0.65,
      true,
      [{color:'rgba(200,57,43,0.8)',label:'Called Strike'},{color:'rgba(37,99,176,0.8)',label:'Called Ball'},{color:'rgba(245,155,0,0.9)',label:'Missed Call Highlight'}],
      null, null,
      p=>p._actualMiss);
}

// ══════════════════════════════════════
//  STEP 1: PHYLLOTAXIS SPIRAL
// ══════════════════════════════════════
function renderSpiral(pitches) {
  const cx = PW / 2, cy = PH / 2;
  const PHI = Math.PI * (3 - Math.sqrt(5)); // golden angle
  const n   = pitches.length;
  const scale = Math.sqrt(n) * 4.2; // radius scale

  // Compute positions
  const nodes = pitches.map((p, i) => {
    const r     = Math.sqrt(i + 0.5) / Math.sqrt(n) * scale;
    const theta = i * PHI;
    return {
      ...p,
      tx: cx + r * Math.cos(theta),
      ty: cy + r * Math.sin(theta),
    };
  });

  dynLayer.selectAll('.spiral-dot')
    .data(nodes)
    .enter().append('circle')
    .attr('class','spiral-dot')
    .attr('cx', d => d.tx)
    .attr('cy', d => d.ty)
    .attr('r', 0)
    .attr('fill', d => typeColor(d.n))
    .attr('opacity', 0.88)
    .attr('cursor','pointer')
    .on('mouseover', (ev,d) => showTip(ev,d))
    .on('mousemove', (ev)   => moveTip(ev))
    .on('mouseout',  ()     => hideTip())
    .transition().duration(600).delay((d,i) => i * 1.5)
    .attr('r', 4.2);

  renderLegend([
    {color:'rgba(255,255,255,0.45)', label:'Every dot is one pitch the umpire had to call, colored by pitch type'}
  ]);
}


// ══════════════════════════════════════
//  STEP 2: SPLIT BY CALL RESULT
// ══════════════════════════════════════
function renderCallSplit(pitches) {
  const groups = [
    { key: 'strike', label: 'Called Strikes', color: 'rgba(200,57,43,0.92)', data: pitches.filter(p => p.c === 1), cx: PW * 0.32 },
    { key: 'ball', label: 'Called Balls', color: 'rgba(37,99,176,0.92)', data: pitches.filter(p => p.c === 0), cx: PW * 0.68 }
  ];
  const cy = PH * 0.48;
  const PHI = Math.PI * (3 - Math.sqrt(5));
  const positioned = [];

  groups.forEach(group => {
    const n = Math.max(group.data.length, 1);
    group.data.forEach((p, i) => {
      const r = Math.sqrt(i + 0.5) / Math.sqrt(n) * (Math.sqrt(n) * 4.7);
      const theta = i * PHI;
      positioned.push({
        ...p,
        groupLabel: group.label,
        groupColor: group.color,
        tx: group.cx + r * Math.cos(theta),
        ty: cy + r * Math.sin(theta)
      });
    });
  });

  dynLayer.selectAll('.call-split-dot')
    .data(positioned)
    .enter().append('circle')
    .attr('class','call-split-dot')
    .attr('cx', PW / 2)
    .attr('cy', PH / 2)
    .attr('r', 0)
    .attr('fill', d => d.groupColor)
    .attr('stroke', 'rgba(255,255,255,0.22)')
    .attr('stroke-width', 0.5)
    .attr('opacity', 0)
    .attr('cursor','pointer')
    .on('mouseover', (ev,d) => showTip(ev,d))
    .on('mousemove', (ev)   => moveTip(ev))
    .on('mouseout',  ()     => hideTip())
    .transition().duration(700).delay((d,i) => i * 2.5).ease(d3.easeCubicOut)
    .attr('cx', d => d.tx)
    .attr('cy', d => d.ty)
    .attr('r', 5)
    .attr('opacity', 0.9);

  groups.forEach(group => {
    const pct = (group.data.length / pitches.length * 100).toFixed(1);

    dynLayer.append('text')
      .attr('x', group.cx)
      .attr('y', cy - 102)
      .attr('text-anchor','middle')
      .attr('fill', group.color)
      .attr('font-family','Bebas Neue, sans-serif')
      .attr('font-size','30px')
      .attr('letter-spacing','2px')
      .attr('opacity',0)
      .text(group.data.length)
      .transition().delay(450).duration(250).attr('opacity',1);

    // Keep the label and percentage on separate lines so the two groups
    // never collide on narrower screens.
    dynLayer.append('text')
      .attr('x', group.cx)
      .attr('y', cy - 72)
      .attr('text-anchor','middle')
      .attr('fill','rgba(255,255,255,0.82)')
      .attr('font-family','IBM Plex Mono, monospace')
      .attr('font-size','9px')
      .attr('letter-spacing','1px')
      .attr('opacity',0)
      .text(group.key === 'strike' ? 'CALLED STRIKES' : 'CALLED BALLS')
      .transition().delay(550).duration(250).attr('opacity',1);

    dynLayer.append('text')
      .attr('x', group.cx)
      .attr('y', cy - 56)
      .attr('text-anchor','middle')
      .attr('fill','rgba(255,255,255,0.48)')
      .attr('font-family','IBM Plex Mono, monospace')
      .attr('font-size','9px')
      .attr('letter-spacing','1px')
      .attr('opacity',0)
      .text(`${pct}% OF CALLS`)
      .transition().delay(650).duration(250).attr('opacity',1);
  });

  renderLegend([
    {color:'rgba(200,57,43,0.92)', label:'Called Strike'},
    {color:'rgba(37,99,176,0.92)', label:'Called Ball'}
  ]);
}

// ══════════════════════════════════════
//  STEP 2: BLOB SPLIT BY PITCH TYPE
// ══════════════════════════════════════
function renderBlobSplit(pitches) {
  const types = {};
  pitches.forEach(p => {
    if (!types[p.n]) types[p.n] = [];
    types[p.n].push(p);
  });
  const sorted = Object.entries(types).sort((a,b) => b[1].length - a[1].length);
  const numTypes = sorted.length;

  // Layout: give labels enough room so pitch-type names do not overlap.
  // The old 5-column layout squeezed long labels like "4-Seam Fastball" and "Split-Finger" together.
  const cols = numTypes <= 4 ? numTypes : 4;
  const rows = Math.ceil(numTypes / cols);
  const padX = PW / (cols + 1);

  function rowY(row) {
    if (rows === 1) return PH * 0.48;
    if (rows === 2) return row === 0 ? PH * 0.34 : PH * 0.70;
    return [PH * 0.16, PH * 0.50, PH * 0.83][row] ?? (PH * (row + 1) / (rows + 1));
  }

  // Map each type to a center point
  const centers = {};
  sorted.forEach(([name], idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    centers[name] = {
      x: padX * (col + 1),
      y: rowY(row),
    };
  });

  // Build all nodes with target positions using force simulation
  const nodes = pitches.map(p => ({
    ...p,
    targetGroup: p.n,
  }));

  // Phyllotaxis within each group to get local offsets
  const groupIdx = {};
  const positioned = nodes.map(p => {
    const key = p.targetGroup;
    if (groupIdx[key] === undefined) groupIdx[key] = 0;
    const i     = groupIdx[key]++;
    const total = types[key].length;
    const PHI   = Math.PI * (3 - Math.sqrt(5));
    const r     = Math.sqrt(i + 0.5) / Math.sqrt(total) * (Math.sqrt(total) * 3.3);
    const theta = i * PHI;
    const cx    = centers[key].x;
    const cy    = centers[key].y;
    return {
      ...p,
      tx: cx + r * Math.cos(theta),
      ty: cy + r * Math.sin(theta),
    };
  });

  // Draw dots, animate from spiral positions (or center if no prior step)
  dynLayer.selectAll('.blob-dot')
    .data(positioned)
    .enter().append('circle')
    .attr('class','blob-dot')
    .attr('cx', PW/2)
    .attr('cy', PH/2)
    .attr('r', 4)
    .attr('fill', d => typeColor(d.n))
    .attr('opacity', 0.0)
    .attr('cursor','pointer')
    .on('mouseover', (ev,d) => showTip(ev,d))
    .on('mousemove', (ev)   => moveTip(ev))
    .on('mouseout',  ()     => hideTip())
    .transition().duration(700).delay((d,i) => i * 2.5).ease(d3.easeCubicOut)
    .attr('cx', d => d.tx)
    .attr('cy', d => d.ty)
    .attr('r', 4.2)
    .attr('opacity', 0.88);

  function shortPitchName(name) {
    return {
      '4-Seam Fastball': '4-Seam FB',
      'Split-Finger': 'Splitter',
      'Knuckle Curve': 'Knuckle',
    }[name] || name;
  }

  // Type labels below each blob center
  sorted.forEach(([name, group]) => {
    const c     = centers[name];
    const count = group.length;
    const total = pitches.length;
    const pct   = (count/total*100).toFixed(1);
    const blobRadius = Math.sqrt(count) * 3.3;
    const labelY = c.y + blobRadius + 18;

    dynLayer.append('text')
      .attr('class','blob-label')
      .attr('x', c.x)
      .attr('y', labelY)
      .attr('text-anchor','middle')
      .attr('fill', typeColor(name))
      .attr('font-family','IBM Plex Mono,monospace')
      .attr('font-size','9px')
      .attr('font-weight','700')
      .attr('opacity',0)
      .text(shortPitchName(name))
      .transition().delay(600).duration(300).attr('opacity',0.95);

    dynLayer.append('text')
      .attr('class','blob-label')
      .attr('x', c.x)
      .attr('y', labelY + 12)
      .attr('text-anchor','middle')
      .attr('fill','rgba(255,255,255,0.42)')
      .attr('font-family','IBM Plex Mono,monospace')
      .attr('font-size','8px')
      .attr('opacity',0)
      .text(`${count} (${pct}%)`)
      .transition().delay(700).duration(300).attr('opacity',1);
  });

  renderLegend([]);
}

// ══════════════════════════════════════
//  STEPS 4–8: ZONE SCATTER
// ══════════════════════════════════════
function renderZoneDots(pitches, colorFn, sizeFn, opFn, showMiss, legendItems, ghostPitches, ghostColor, highlightFn) {
  // Ghost layer
  if (ghostPitches && ghostPitches.length) {
    dynLayer.selectAll('.ghost-dot')
      .data(ghostPitches)
      .enter().append('circle')
      .attr('class','ghost-dot')
      .attr('cx', p => xSc(p.x))
      .attr('cy', p => ySc(p.z))
      .attr('r', 4)
      .attr('fill', ghostColor)
      .attr('stroke','none')
      .attr('pointer-events','none');
  }

  // Main dots. Yellow indicates a highlight/ring only; the pitch keeps its original call color.
  const isHighlighted = highlightFn || (p => showMiss && p.m);
  const nonMissed = pitches.filter(p => !isHighlighted(p));
  const missed    = pitches.filter(p => isHighlighted(p));

  function plot(data, cls) {
    dynLayer.selectAll(`.${cls}`)
      .data(data)
      .enter().append('circle')
      .attr('class', cls)
      .attr('cx', p => xSc(p.x))
      .attr('cy', p => ySc(p.z))
      .attr('r', 0)
      .attr('fill', p => colorFn(p))
      .attr('stroke', p => isHighlighted(p) ? 'rgba(245,155,0,0.95)' : 'rgba(255,255,255,0.2)')
      .attr('stroke-width', p => isHighlighted(p) ? 2.2 : 0.5)
      .attr('opacity', p => opFn(p))
      .attr('cursor','pointer')
      .attr('filter', p => isHighlighted(p) ? 'url(#scroll-missGlow)' : null)
      .on('mouseover', (ev,p) => showTip(ev,p))
      .on('mousemove', (ev)   => moveTip(ev))
      .on('mouseout',  ()     => hideTip())
      .transition().duration(300).delay((d,i) => i * 4)
      .attr('r', p => sizeFn(p));
  }

  plot(nonMissed, 'zone-dot-nm');
  plot(missed,    'zone-dot-m');

  // Pulsing rings for missed
  if (showMiss) {
    missed.forEach(p => {
      const ring = ringsLayer.append('circle')
        .attr('cx', xSc(p.x)).attr('cy', ySc(p.z))
        .attr('r', 9).attr('fill','none')
        .attr('stroke','rgba(245,155,0,0.7)').attr('stroke-width',1.7)
        .attr('pointer-events','none');
      function pulse() {
        ring.attr('r',9).attr('opacity',0.8)
          .transition().duration(1200).ease(d3.easeLinear)
          .attr('r',20).attr('opacity',0).on('end', pulse);
      }
      pulse();
    });
  }

  renderLegend(legendItems);
}

// ══════════════════════════════════════
//  LEGEND + TOOLTIP
// ══════════════════════════════════════
function renderLegend(items) {
  const leg = document.getElementById('scroll-viz-legend');
  leg.innerHTML = '';
  items.forEach(({color,label}) => {
    const el = document.createElement('div');
    el.className = 'viz-leg-item';
    el.innerHTML = `<div class="viz-leg-dot" style="background:${color}"></div><span>${label}</span>`;
    leg.appendChild(el);
  });
}

const tooltip = document.getElementById('scroll-pitch-tooltip');
function showTip(event, p) {
  const callLabel = p.c===1?'Called Strike':'Called Ball';
  const callClass = p.c===1?'tt-call-s':'tt-call-b';
  const speedStr  = p.v ? `${p.v} mph · ` : '';
  const missLine  = p.m ? '<div class="tt-miss">⚠ Missed Call</div>' : '';
  const zoneNote  = p.m ? (p.c===1?'Outside zone, called strike':'Inside zone, called ball') : '';
  tooltip.innerHTML = `
    <div class="tt-type">${p.n}</div>
    <div class="${callClass}">${callLabel}</div>
    <div style="color:rgba(255,255,255,0.5);font-size:10px;margin-top:2px">${speedStr}Inn ${p.i} · ${p.p.split(', ').reverse().join(' ')}</div>
    ${p.x!==undefined?`<div style="color:rgba(255,255,255,0.4);font-size:10px">x: ${p.x.toFixed(2)}ft · z: ${p.z.toFixed(2)}ft</div>`:''}
    ${missLine}
    ${zoneNote?`<div style="color:rgba(245,155,0,0.7);font-size:10px">${zoneNote}</div>`:''}
  `;
  tooltip.classList.add('visible');
  moveTip(event);
}
function moveTip(event) {
  let x = event.clientX + 14, y = event.clientY - 10;
  if (x + 210 > window.innerWidth)  x = event.clientX - 220;
  if (y + 130 > window.innerHeight) y = event.clientY - 130;
  tooltip.style.left = x+'px';
  tooltip.style.top  = y+'px';
}
function hideTip() { tooltip.classList.remove('visible'); }

// ══════════════════════════════════════
//  SCROLL OBSERVER
// ══════════════════════════════════════
const stepMap = {
  'scroll-section-1':1,'scroll-section-2':2,'scroll-section-3':3,'scroll-section-4':4,
  'scroll-section-5':5,'scroll-section-6':6,'scroll-section-7':7,'scroll-section-8':8
};

const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      const step = stepMap[entry.target.id];
      if (step && step !== currentStep && currentGame) {
        renderViz(step);
      }
    }
  });
}, { threshold: 0.4, rootMargin:'0px 0px -5% 0px' });

document.querySelectorAll('#one-game-scroll-section .scroll-section').forEach(el => observer.observe(el));



// Extra fallback: IntersectionObserver can miss hidden sections after the story appears.
// This keeps the graph synced to the section closest to the middle of the viewport.
function updateScrollStoryStepFromViewport() {
  if (!currentGame) return;
  const sections = Array.from(document.querySelectorAll('#one-game-scroll-section .scroll-section'));
  if (!sections.length) return;

  const mid = window.innerHeight * 0.52;
  let best = null;
  let bestDistance = Infinity;

  sections.forEach(section => {
    const rect = section.getBoundingClientRect();
    const sectionMid = rect.top + rect.height / 2;
    const distance = Math.abs(sectionMid - mid);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = section;
    }
  });

  if (!best) return;
  best.classList.add('visible');
  const step = stepMap[best.id];
  if (step && step !== currentStep) renderViz(step);
}

window.addEventListener('scroll', () => requestAnimationFrame(updateScrollStoryStepFromViewport), { passive: true });
window.addEventListener('resize', () => requestAnimationFrame(updateScrollStoryStepFromViewport));

// ══════════════════════════════════════
//  INIT
// ══════════════════════════════════════
const scrollNewGameButton = document.querySelector('#one-game-scroll-section .btn-new-game');
if (scrollNewGameButton) scrollNewGameButton.addEventListener('click', pickRandomGame);
const scrollTryAnotherButton = document.querySelector('#one-game-scroll-section .continue-btn');
if (scrollTryAnotherButton) {
  scrollTryAnotherButton.addEventListener('click', () => {
    pickRandomGame();
    document.getElementById('one-game-scroll-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
fetch('data/games.json')
  .then(response => {
    if (!response.ok) throw new Error(`Could not load data/games.json: ${response.status}`);
    return response.json();
  })
  .then(data => {
    GAMES_DATA = data;
    pickRandomGame();
    setTimeout(() => { renderViz(1); updateScrollStoryStepFromViewport(); }, 100);
    setTimeout(() => { renderViz(1); updateScrollStoryStepFromViewport(); }, 600);
  })
  .catch(error => {
    console.error(error);
    const meta = document.getElementById('scroll-hero-meta');
    if (meta) meta.textContent = 'Could not load data/games.json. Use Live Server or GitHub Pages.';
  });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startWhenReady);
  } else {
    startWhenReady();
  }
})();
