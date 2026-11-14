// Game controller: phases, input, HUD, budget/shop, replays and scoring flow.
(function () {
  const P = window.DemoPhysics;
  const LEVELS = window.LEVELS;
  const $ = (id) => document.getElementById(id);
  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

  const canvas = $('game');
  const renderer = new Renderer(canvas);
  const audio = new GameAudio();
  window.__implode = { renderer, state: null };

  // ---------------- Shop catalogue ----------------
  const SHOP = [
    { id: 'megaphone', icon: '📢', name: 'Megaphone', price: 800,
      desc: 'Adds a “Clear area” button that sends every bystander running out of the danger zone at once.' },
    { id: 'overtime', icon: '⏱', name: 'Overtime Permit', price: 1500,
      desc: '+30 seconds of planning time on every job.' },
    { id: 'detonator', icon: '🎛', name: 'Precision Detonator', price: 2000,
      desc: 'Finer fuse delays: 0.1s, 0.75s, 2.5s and 3s for perfectly sequenced implosions.' },
    { id: 'xray', icon: '🩻', name: 'Load X-ray', price: 2500,
      desc: 'See how much weight every column carries, and which ones will lose their support once your charges go off.' },
    { id: 'shaped', icon: '🔻', name: 'Shaped Charges', price: 3500,
      desc: 'Copper-lined charges that focus the blast toward the middle of the building — far less debris thrown outward. Cost 60% more per charge.' },
    { id: 'netting', icon: '🕸', name: 'Debris Netting', price: 4000,
      desc: `Hang protective nets on the neighbours (${money(P.NETTING_COST)} per job from the budget). Hits on them cost ~90% less.` },
    { id: 'cutter', icon: '✂', name: 'Cutter Charges', price: 5000,
      desc: `Linear cutting charges slice any member — even steel — cleanly with almost no blast. ${money(P.chargeCost('cutter', 0))} each.` },
  ];
  const BASE_DELAYS = [0, 0.25, 0.5, 1, 1.5, 2];
  const FINE_DELAYS = [0, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3];
  const START_CASH = 1000;
  const PAY_PER_POINT = 5;
  const REPLAY_PAY_FRACTION = 0.3;

  const STORE_KEY = 'implode-progress-v2';
  const progress = loadProgress();

  const state = {
    phase: 'title', // title | plan | countdown | blast | result | replay
    levelIndex: 0,
    sim: null,
    strength: 3,
    delay: 0,
    chargeType: 'standard',
    xray: false,
    hover: null,
    planLeft: 0,
    planTime: 0,
    countdown: 0,
    blastTime: 0,
    settleTime: 0,
    detonatedWithLeft: 0,
    rec: null,
    replay: null, // { t, playing, speed }
  };

  // ---------------- Persistence ----------------
  function loadProgress() {
    try {
      const p = JSON.parse(localStorage.getItem(STORE_KEY));
      if (p && p.best) return Object.assign({ cash: START_CASH, owned: {} }, p);
    } catch (e) { /* storage unavailable */ }
    return { unlocked: 1, best: {}, cash: START_CASH, owned: {} };
  }
  function saveProgress() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch (e) { /* storage unavailable */ }
  }
  const owns = (id) => !!progress.owned[id];

  // ---------------- Screens ----------------
  function showScreen(id) {
    for (const s of ['screenTitle', 'screenLevels', 'screenShop', 'screenResult']) $(s).classList.toggle('hidden', s !== id);
    $('overlay').classList.toggle('hidden', !id);
    for (const el of document.querySelectorAll('.cashVal')) el.textContent = money(progress.cash);
  }

  function buildLevelGrid() {
    const grid = $('levelGrid');
    grid.innerHTML = '';
    LEVELS.forEach((L, i) => {
      const b = document.createElement('button');
      b.className = 'lvl';
      const best = progress.best[L.id];
      const locked = i + 1 > progress.unlocked;
      b.disabled = locked;
      const stars = best ? '★'.repeat(best.stars) + '☆'.repeat(3 - best.stars) : '☆☆☆';
      const mat = P.MATERIALS[L.material || 'concrete'].name;
      b.innerHTML = `<span class="n">Job ${L.id}${locked ? ' 🔒' : ''} · ${mat}${L.topple ? ' · ↔' : ''}${L.landmark ? ' · ' + L.landmark : ''}</span><span class="t">${L.name}</span>
        <span class="s">${stars}</span><br><span class="b">${best ? 'Best: ' + best.score + ' · ' : ''}Budget ${money(L.budget)}</span>`;
      b.onclick = () => { audio.click(); startLevel(i); };
      grid.appendChild(b);
    });
  }

  function buildShop() {
    const grid = $('shopGrid');
    grid.innerHTML = '';
    for (const it of SHOP) {
      const d = document.createElement('div');
      d.className = 'item' + (owns(it.id) ? ' owned' : '');
      const btn = owns(it.id)
        ? '<button class="btn small" disabled>Owned ✓</button>'
        : `<button class="btn small ${progress.cash >= it.price ? 'red' : ''}" ${progress.cash >= it.price ? '' : 'disabled'}>Buy ${money(it.price)}</button>`;
      d.innerHTML = `<div class="top"><span class="ic">${it.icon}</span><span class="nm">${it.name}</span></div>
        <div class="ds">${it.desc}</div>${btn}`;
      const b = d.querySelector('button');
      if (!owns(it.id)) {
        b.onclick = () => {
          if (progress.cash < it.price) return;
          progress.cash -= it.price;
          progress.owned[it.id] = true;
          saveProgress();
          audio.cash();
          buildShop();
          showScreen('screenShop');
        };
      }
      grid.appendChild(d);
    }
  }

  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), ms || 1800);
  }

  // ---------------- Toolbar ----------------
  function buildDelays() {
    const list = owns('detonator') ? FINE_DELAYS : BASE_DELAYS;
    if (!list.includes(state.delay)) state.delay = 0;
    const seg = $('delays');
    seg.innerHTML = '';
    for (const d of list) {
      const b = document.createElement('button');
      b.textContent = d === 0 ? '0s' : String(d);
      b.classList.toggle('on', d === state.delay);
      b.onclick = () => {
        state.delay = d;
        for (const o of seg.querySelectorAll('button')) o.classList.toggle('on', o === b);
        audio.click();
      };
      seg.appendChild(b);
    }
    const sel = $('delaySel');
    sel.innerHTML = list.map((d) => `<option value="${d}" ${d === state.delay ? 'selected' : ''}>⏱ ${d}s</option>`).join('');
    sel.onchange = () => {
      state.delay = +sel.value;
      for (const o of seg.querySelectorAll('button')) o.classList.toggle('on', +o.textContent.replace('s', '') === state.delay);
      audio.click();
    };
  }

  function refreshToolbar() {
    for (const b of $('types').querySelectorAll('button')) {
      const t = b.dataset.t;
      const avail = t === 'standard' || owns(t);
      b.disabled = !avail || state.phase !== 'plan';
      b.title = avail ? '' : 'Buy in the shop';
      const [ic, tx] = { standard: ['🧨', 'Dynamite'], shaped: ['🔻', 'Shaped'], cutter: ['✂', 'Cutter'] }[t];
      b.innerHTML = `<span class="ic">${avail ? ic : '🔒'}</span><span class="tx"> ${tx}</span>`;
      b.classList.toggle('on', t === state.chargeType);
    }
    if (state.chargeType !== 'standard' && !owns(state.chargeType)) state.chargeType = 'standard';
    $('btnNetting').classList.toggle('hidden', !owns('netting'));
    $('btnXray').classList.toggle('hidden', !owns('xray') || !!(state.sim && state.sim.truss));
    $('btnXray').classList.toggle('on', state.xray);
    $('btnMegaphone').classList.toggle('hidden', !owns('megaphone'));
    if (state.sim) $('btnNetting').classList.toggle('on', state.sim.netting);
    $('btnNetting').innerHTML = `🕸<span class="tx"> Netting ${state.sim && state.sim.netting ? 'ON' : money(P.NETTING_COST)}</span>`;
    updateStrengthUi();
  }

  function setControlsEnabled(on) {
    for (const el of $('toolbar').querySelectorAll('button, input')) el.disabled = !on;
    if (on) refreshToolbar();
  }

  // ---------------- Level flow ----------------
  // ---------------- Saving / restoring a charge layout (for Retry) ----------------
  // Members are identified by kind + floor + column line / bay, so the layout can be
  // re-planted on a freshly built copy of the same building.
  function memberKey(pc) {
    return `${pc.kind}:${pc.floor}:${pc.kind === 'column' ? pc.line : pc.kind === 'slab' ? pc.bay : pc.kind === 'beam' ? pc.idx : 0}`;
  }

  function snapshotSetup(sim) {
    return {
      levelId: sim.level.id,
      netting: sim.netting,
      charges: sim.charges.map((c) => ({
        key: memberKey(c.body.plugin.piece), local: { x: c.local.x, y: c.local.y },
        strength: c.type === 'cutter' ? state.strength : c.strength, delay: c.delay, type: c.type,
      })),
    };
  }

  function restoreSetup(sim, setup) {
    const byKey = new Map(sim.pieces.map((b) => [memberKey(b.plugin.piece), b]));
    const budget = LEVELS[state.levelIndex].budget;
    let skipped = 0;
    if (setup.netting && owns('netting')) sim.netting = true;
    for (const c of setup.charges) {
      const body = byKey.get(c.key);
      const typeOk = c.type === 'standard' || owns(c.type);
      const cost = P.chargeCost(c.type, c.strength);
      if (!body || !typeOk || P.spent(sim) + cost > budget || sim.charges.length >= LEVELS[state.levelIndex].maxCharges) { skipped++; continue; }
      const world = Matter.Vector.add(body.position, Matter.Vector.rotate(c.local, body.angle));
      P.addCharge(sim, body, world, c.strength, c.delay, c.type);
    }
    return skipped;
  }

  // Retry keeps the layout from the last detonation (or the one being planned).
  function retryLevel() {
    let setup = null;
    if (state.phase === 'plan' && state.sim && state.sim.charges.length) setup = snapshotSetup(state.sim);
    else if (state.lastSetup && state.lastSetup.levelId === LEVELS[state.levelIndex].id) setup = state.lastSetup;
    startLevel(state.levelIndex, setup);
  }

  function startLevel(i, setup) {
    const L = LEVELS[i];
    state.levelIndex = i;
    state.sim = P.createSim(L, (Math.random() * 1e9) | 0);
    state.phase = 'plan';
    state.planTime = L.planTime + (owns('overtime') ? 30 : 0);
    state.planLeft = state.planTime;
    state.hover = null;
    state.blastTime = 0;
    state.settleTime = 0;
    state.rec = null;
    state.replay = null;
    renderer.clearFx();
    renderer.setLevel(L);
    showScreen(null);
    $('hud').classList.remove('hidden');
    $('toolbar').classList.remove('hidden');
    $('replayBar').classList.add('hidden');
    $('btnMenu').classList.remove('hidden');
    $('countdown').classList.add('hidden');
    $('levelName').textContent = `${L.id}. ${L.name}`;
    $('timerLabel').textContent = 'Planning time';
    buildDelays();
    let restored = 0, skipped = 0;
    if (setup && setup.levelId === L.id) {
      skipped = restoreSetup(state.sim, setup);
      restored = state.sim.charges.length;
    }
    setControlsEnabled(true);
    updateHud();
    audio.setMode('plan');
    if (restored) {
      toast(`🔁 Your previous setup is back (${restored} charge${restored > 1 ? 's' : ''}${skipped ? `, ${skipped} couldn't be re-placed` : ''}). Tweak it or detonate!`, 3500);
    } else toast(L.blurb, 4000);
  }

  function budgetLeft() {
    return LEVELS[state.levelIndex].budget - P.spent(state.sim);
  }

  function detonate() {
    if (state.phase !== 'plan') return;
    if (!state.sim.charges.length) { audio.error(); toast('Plant at least one charge first!'); return; }
    state.phase = 'countdown';
    state.countdown = 3;
    state.detonatedWithLeft = state.planLeft;
    state.lastSetup = snapshotSetup(state.sim);
    state.hover = null;
    setControlsEnabled(false);
    audio.setMode('tense');
    audio.beep(false);
    audio.fuse(3);
    const cd = $('countdown');
    cd.textContent = '3';
    cd.classList.remove('hidden');
    const n = P.peopleInZone(state.sim);
    if (n) toast(`⚠ ${n} bystander${n > 1 ? 's' : ''} still in the danger zone — tap them!`, 2500);
  }

  function beginBlast() {
    $('countdown').classList.add('hidden');
    state.phase = 'blast';
    state.blastTime = 0;
    state.sim.time = 0;
    state.sim.acc = 0;
    P.startRecording(state.sim);
    P.bystandersAtBlast(state.sim);
    $('timerLabel').textContent = 'Demolition';
  }

  function finishBlast() {
    state.phase = 'result';
    const sim = state.sim;
    state.rec = sim.rec ? P.stopRecording(sim) : null;
    const L = LEVELS[state.levelIndex];
    const ev = P.evaluate(sim, L.budget);
    const timeBonus = ev.success ? Math.round((state.detonatedWithLeft / state.planTime) * 100) : 0;
    const total = ev.success ? ev.score + timeBonus : 0;
    audio.setMode('calm');
    audio.jingle(ev.success);

    $('resTitle').textContent = ev.success
      ? (ev.directional ? (ev.stars === 3 ? 'Bullseye! Right on target!' : 'Toppled!') : ev.stars === 3 ? 'Perfect implosion!' : ev.penalty === 0 ? 'Clean job!' : 'Demolished!')
      : ev.directional && ev.collapse >= 0.6 ? (ev.wrongWay ? 'It fell the wrong way!' : 'Missed the drop zone!')
        : 'Building still standing!';
    const starsEl = $('resStars');
    starsEl.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const s = document.createElement('span');
      s.textContent = '★';
      if (i < ev.stars) { s.className = 'on'; s.style.animationDelay = 0.2 + i * 0.25 + 's'; }
      starsEl.appendChild(s);
    }
    const pct = (v) => Math.round(v * 100) + '%';
    const rows = [
      ['Collapse', pct(ev.collapse), ev.collapsePts],
      ['Debris kept on the lot', pct(ev.contain), ev.containPts],
      ...(ev.directional ? [[`Toppled ${L.topple} into the drop zone`, pct(ev.direction), ev.directionPts]] : []),
      ['Under budget', `${money(ev.spent)} of ${money(ev.budget)}`, ev.budgetPts],
      ['Hits on neighbours', String(ev.hits), -ev.neighborPen],
    ];
    if (L.cars && L.cars.length) rows.push(['Cars damaged', String(ev.carHits), -ev.carPen]);
    rows.push(['Bystanders in the blast zone', String(ev.bystanders), -ev.bystanderPen]);
    rows.push(['Time bonus', Math.round(state.detonatedWithLeft) + 's left', timeBonus]);
    $('resTable').innerHTML = rows.map(([a, b, c]) =>
      `<tr><td>${a}</td><td>${b}</td><td class="${c < 0 ? 'neg' : ''}">${c > 0 ? '+' : ''}${c}</td></tr>`).join('');
    $('resTotal').textContent = ev.success ? `Score: ${total}`
      : ev.directional && ev.collapse >= 0.6 ? `Topple it ${L.topple.toUpperCase()} into the drop zone to pass`
        : 'Collapse at least 60% of the building to pass';
    setTicker(headlines(ev, L, sim, timeBonus));

    const prev = progress.best[L.id];
    let bestMsg = prev ? `Best: ${prev.score}` : '';
    let pay = 0;
    if (ev.success) {
      pay = Math.round((total * PAY_PER_POINT * (prev ? REPLAY_PAY_FRACTION : 1)) / 10) * 10;
      if (!prev || total > prev.score) {
        progress.best[L.id] = { score: total, stars: Math.max(ev.stars, prev ? prev.stars : 0) };
        bestMsg = prev ? 'New best score!' : '';
      } else if (ev.stars > prev.stars) prev.stars = ev.stars;
      progress.unlocked = Math.max(progress.unlocked, Math.min(LEVELS.length, state.levelIndex + 2));
      progress.cash += pay;
      saveProgress();
    }
    $('resBest').textContent = bestMsg;
    $('resPay').textContent = ev.success
      ? `💰 Payout: ${money(pay)}${prev ? ' (repeat job, 30%)' : ''} · Company cash: ${money(progress.cash)}`
      : `No payout · Company cash: ${money(progress.cash)}`;
    const hasNext = state.levelIndex + 1 < LEVELS.length;
    $('btnNext').classList.toggle('hidden', !(ev.success && hasNext));
    $('btnReplay').classList.toggle('hidden', !state.rec || state.rec.frames.length < 2);
    if (pay) setTimeout(() => audio.cash(), 900);
    setTimeout(() => { if (state.phase === 'result') showScreen('screenResult'); }, 600);
  }

  // ---------------- News ticker ----------------
  function headlines(ev, L, sim, timeBonus) {
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const n = L.name;
    const out = [];
    if (!ev.success) {
      if (ev.directional && ev.collapse >= 0.6) {
        out.push(ev.wrongWay
          ? pick([`${n} topples the WRONG way — neighbours duck for cover`, `Oops! ${n} falls backwards as crowd gasps`, `Compass trouble? ${n} goes the other way`])
          : pick([`${n} misses its drop zone by a mile`, `${n} crumples on the spot instead of toppling`, `“It was supposed to lean,” admits red-faced foreman`]));
      } else {
        out.push(pick([`Embarrassment: ${n} refuses to fall`, `${n} still standing after demolition “fizzles”`,
          `Locals jeer as ${n} shrugs off explosives`, `Dust settles, ${n} doesn't`]));
      }
    } else if (ev.directional) {
      out.push(ev.stars === 3 ? pick([`TIMBER! ${n} lands right on target`, `Bullseye! ${n} topples neatly into empty lot`])
        : pick([`${n} felled ${L.topple}ward to applause`, `Crowd yells “TIMBER!” as ${n} goes down`]));
    } else if (ev.stars === 3) {
      out.push(pick([`Textbook implosion! ${n} drops into its own footprint`, `${n} vanishes in seconds — experts call it “flawless”`,
        `Not a scratch next door as ${n} comes down`]));
    } else {
      out.push(pick([`${n} demolished, crews begin cleanup`, `Goodbye, ${n}: landmark reduced to rubble`, `${n} comes down in a cloud of dust`]));
    }
    const church = sim.neighbors.find((x) => x.fragile && x.damage > 0);
    if (church) out.push(pick(['Historic church damaged — mayor “absolutely furious”', 'Steeple cracked! Heritage society demands answers']));
    if (ev.hits >= 4) out.push(pick([`Neighbours furious as debris smashes ${ev.hits} windows`, 'Building next door “looks like Swiss cheese,” says owner']));
    else if (ev.hits > 0) out.push(pick(['Minor damage next door: “just a few scratches,” insists foreman', 'Neighbour reports chipped paint, demands new paint job']));
    if (ev.carHits) out.push(pick([`${ev.carHits} hit${ev.carHits > 1 ? 's' : ''} on parked cars — insurers groan`, 'Car alarms wail across the block', 'Motorist returns to find car “slightly flatter”']));
    if (ev.bystanders) out.push(pick(['Spectators flee dust cloud — safety officials investigate', `${ev.bystanders} onlooker${ev.bystanders > 1 ? 's' : ''} sprint from blast zone, hair “very dusty”`]));
    if (L.material === 'glass' && ev.success) out.push('Glass rain! Shards sparkle across the street');
    if (L.material === 'steel' && ev.success) out.push(sim.charges.some((c) => c.type === 'cutter') ? 'Precision cutters slice steel frame like butter' : 'Steel giant buckles under heavy charges');
    if (L.roof === 'tank' && ev.success) out.push('Rooftop water tank takes its final plunge');
    if (L.landmark) {
      out.push(ev.success
        ? pick([`Theme park says farewell to its ${n} replica`, `Tourists snap final selfies as ${n} replica falls`, `Souvenir shop sells out of mini ${n}s`])
        : pick([`${n} replica proves tougher than the original`, `Theme park closure delayed — ${n} still standing`]));
    }
    if (L.lean && ev.success) out.push('After centuries of leaning (well, a few years), the tower finally lies down');
    if (L.clockFloor != null && ev.success) out.push('Clock stops for good — witnesses confirm the exact time');
    if (ev.success && ev.underBudget >= 0.4) out.push(`Demolition firm finishes ${money(ev.budget - ev.spent)} under budget`);
    if (ev.success && timeBonus >= 75) out.push(`Speedy crew blows ${n} in record time`);
    if (ev.penalty === 0 && ev.success) out.push('Safety inspector: “Zero incidents. Remarkable.”');
    out.push(pick(['Local bakery reports record sales to dust-covered onlookers', 'Pigeons demand compensation for lost rooftop',
      'Weather: clear skies, with a 100% chance of dust', 'Traffic: expect delays near the demolition site', 'Construction cranes already circling the empty lot']));
    const change = ev.success ? `▲ ${(ev.stars * 1.7 + Math.random() * 2 + 0.3).toFixed(1)}%` : `▼ ${(3 + Math.random() * 4).toFixed(1)}%`;
    out.push(`IMPLODE CO. ${change}`);
    return out;
  }

  function setTicker(items) {
    const el = $('tickerText');
    const text = items.join('   •   ');
    el.textContent = text;
    el.style.animation = 'none';
    void el.offsetWidth; // restart the animation
    el.style.animation = '';
    el.style.animationDuration = Math.max(12, text.length * 0.16) + 's';
  }

  function goLevels() {
    audio.setMode('title');
    state.phase = 'title';
    state.replay = null;
    $('hud').classList.add('hidden');
    $('toolbar').classList.add('hidden');
    $('replayBar').classList.add('hidden');
    $('countdown').classList.add('hidden');
    buildLevelGrid();
    showScreen('screenLevels');
  }

  // ---------------- Replay ----------------
  function frameIndexAt(rec, t) {
    let lo = 0, hi = rec.frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (rec.frames[mid].t <= t) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  function startReplay() {
    if (!state.rec) return;
    state.phase = 'replay';
    state.replay = { t: 0, playing: true, speed: state.replay ? state.replay.speed : 0.5 };
    renderer.clearFx();
    showScreen(null);
    $('toolbar').classList.add('hidden');
    $('replayBar').classList.remove('hidden');
    $('timerLabel').textContent = 'Replay';
    $('rpPlay').textContent = '❚❚';
    syncSpeedButtons();
    audio.setMode('calm');
    // fire any effects that happened right at t = 0 (bystanders, first charges)
    emitReplayFx(-1, 0);
  }

  function endReplay() {
    state.phase = 'result';
    state.replay = null;
    renderer.clearFx();
    $('replayBar').classList.add('hidden');
    $('timerLabel').textContent = 'Demolition';
    showScreen('screenResult');
  }

  function syncSpeedButtons() {
    for (const b of $('rpSpeeds').querySelectorAll('button')) b.classList.toggle('on', +b.dataset.s === state.replay.speed);
  }

  function emitReplayFx(t0, t1) {
    for (const f of state.rec.fxLog) if (f.t > t0 && f.t <= t1) playFx(f);
  }

  function replayDuration() { return state.rec.frames[state.rec.frames.length - 1].t; }

  function seekReplay(t) {
    state.replay.t = Math.max(0, Math.min(replayDuration(), t));
    renderer.clearFx();
  }

  // ---------------- HUD ----------------
  function fmtTime(s) {
    s = Math.max(0, Math.ceil(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function updateHud() {
    const sim = state.sim;
    if (!sim) return;
    const L = LEVELS[state.levelIndex];
    $('chargeCount').textContent = `${sim.charges.length} / ${L.maxCharges}`;
    const left = budgetLeft();
    $('budgetLeft').textContent = money(left);
    $('budgetLeft').style.color = left < L.budget * 0.15 ? '#d62828' : '';
    const tb = $('timer').parentElement;
    if (state.phase === 'plan' || state.phase === 'countdown') {
      $('timer').textContent = fmtTime(state.planLeft);
      tb.classList.toggle('warn', state.phase === 'plan' && state.planLeft <= 10);
    } else if (state.phase === 'replay') {
      $('timer').textContent = (state.replay.t / 1000).toFixed(1) + 's';
      tb.classList.remove('warn');
    } else {
      $('timer').textContent = state.blastTime.toFixed(1) + 's';
      tb.classList.remove('warn');
    }
  }

  function updateStrengthUi() {
    const s = state.strength;
    const cutter = state.chargeType === 'cutter';
    $('strength').value = s;
    $('strength').disabled = cutter || state.phase !== 'plan';
    $('strengthVal').textContent = cutter ? '—' : s;
    $('strengthKg').textContent = cutter ? '(fixed)' : `(${(s * s * 0.25).toFixed(s < 3 ? 2 : 1)} kg)`;
    const mat = state.sim ? state.sim.mat : P.MATERIALS.concrete;
    let hint;
    if (cutter) hint = 'Slices any member cleanly — no strength needed';
    else if (s < mat.colTough) hint = `Too weak for ${mat.name.toLowerCase()} columns (need ${mat.colTough}+)`;
    else if (s < mat.slabTough) hint = `Cuts columns (slabs need ${mat.slabTough}+)`;
    else if (s < 7) hint = 'Cuts columns and slabs';
    else hint = 'Heavy — expect flying debris!';
    $('strengthHint').textContent = hint;
    const cost = P.chargeCost(state.chargeType, s);
    $('typeCost').textContent = `${money(cost)} each`;
    $('typeHint').textContent = state.chargeType === 'shaped' ? 'Blast aims at the building centre'
      : state.chargeType === 'cutter' ? 'Clean cut, tiny blast' : 'Classic all-round blast';
  }

  // ---------------- Input ----------------
  function eventWorld(e) {
    const r = canvas.getBoundingClientRect();
    return renderer.toWorld(e.clientX - r.left, e.clientY - r.top);
  }

  function computeHover(p) {
    const sim = state.sim;
    const person = P.personAt(sim, p, Math.max(9, 16 / renderer.scale));
    if (person) return { person };
    for (const ch of sim.charges) {
      const cp = P.chargePos(ch);
      if (Math.hypot(cp.x - p.x, cp.y - p.y) < Math.max(11, 16 / renderer.scale)) return { charge: ch };
    }
    const body = P.pieceAt(sim, p);
    if (!body) return null;
    const pc = body.plugin.piece;
    if (pc.kind === 'wall' && state.chargeType !== 'cutter') return { body: null, point: null, wall: true };
    if (pc.kind === 'wall') return { body: null, point: null, wall: true };
    // snap the charge to the member's centre line
    const local = Matter.Vector.rotate(Matter.Vector.sub(p, body.position), -body.angle);
    if (pc.kind === 'column') { local.x = 0; local.y = Math.max(-pc.h / 2 + 7, Math.min(pc.h / 2 - 7, local.y)); }
    else if (pc.kind === 'slab' || pc.kind === 'beam') { local.y = 0; local.x = Math.max(-pc.w / 2 + 6, Math.min(pc.w / 2 - 6, local.x)); }
    else { local.x = Math.max(-pc.w / 2 + 6, Math.min(pc.w / 2 - 6, local.x)); local.y = Math.max(-pc.h / 2 + 6, Math.min(pc.h / 2 - 6, local.y)); }
    const point = Matter.Vector.add(body.position, Matter.Vector.rotate(local, body.angle));
    let weak = null;
    const label = { column: 'column', slab: 'slab', tank: 'water tank', sign: 'billboard', spire: 'spire', belfry: 'belfry', beam: 'iron girder' }[pc.kind];
    if (state.chargeType !== 'cutter' && state.strength < pc.toughness) weak = `Needs strength ${pc.toughness}+ to cut this ${label}`;
    const cost = P.chargeCost(state.chargeType, state.strength);
    return { body, point, weak, cost: `${money(cost)} · ${money(budgetLeft())} left` };
  }

  // ---- Touch & mouse: tap = plant/remove, one-finger drag = pan, pinch = zoom ----
  const pointers = new Map(); // pointerId -> {x, y}
  let gesture = null;
  const TAP_SLOP = 10;

  function screenPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function pinchInfo() {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  function updateHover(e) {
    if (state.phase !== 'plan') { state.hover = null; canvas.style.cursor = 'default'; return; }
    state.hover = computeHover(eventWorld(e));
    const h = state.hover;
    canvas.style.cursor = h && h.person ? 'pointer' : h && (h.body || h.charge) ? 'crosshair' : 'grab';
  }

  function tapAt(e) {
    if (state.phase !== 'plan' && state.phase !== 'countdown') return;
    const sim = state.sim;
    const h = computeHover(eventWorld(e));
    if (h && h.person) {
      P.shoo(sim, h.person);
      audio.shoo();
      return;
    }
    if (state.phase !== 'plan') return;
    state.hover = h;
    if (!h) return;
    if (h.charge) {
      sim.charges.splice(sim.charges.indexOf(h.charge), 1);
      audio.remove();
      state.hover = null;
    } else if (h.wall) {
      audio.error();
      toast('Wall panels are just cladding — target columns, slabs or rooftop structures');
    } else if (h.body) {
      const L = LEVELS[state.levelIndex];
      const cost = P.chargeCost(state.chargeType, state.strength);
      if (sim.charges.length >= L.maxCharges) { audio.error(); toast(`Charge limit reached (${L.maxCharges})`); return; }
      if (cost > budgetLeft()) { audio.error(); toast(`Over budget! This charge costs ${money(cost)}, you have ${money(budgetLeft())} left`); return; }
      P.addCharge(sim, h.body, h.point, state.strength, state.delay, state.chargeType);
      audio.place();
      state.hover = e.pointerType === 'mouse' ? computeHover(eventWorld(e)) : null;
    }
    updateHud();
  }

  canvas.addEventListener('pointerdown', (e) => {
    audio.unlock();
    if (e.button === 2) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, screenPos(e));
    if (pointers.size === 1) {
      const p = screenPos(e);
      gesture = { startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, moved: false, pinch: null, pointerType: e.pointerType };
    } else if (pointers.size === 2 && gesture) {
      gesture.moved = true; // a second finger turns this into a pinch, never a tap
      gesture.pinch = pinchInfo();
      state.hover = null;
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) { if (e.pointerType === 'mouse') updateHover(e); return; }
    const p = screenPos(e);
    pointers.set(e.pointerId, p);
    if (!gesture) return;
    if (pointers.size >= 2 && gesture.pinch) {
      const now = pinchInfo();
      if (gesture.pinch.dist > 0) renderer.zoomAt(now.mx, now.my, now.dist / gesture.pinch.dist);
      renderer.panBy(now.mx - gesture.pinch.mx, now.my - gesture.pinch.my);
      gesture.pinch = now;
      return;
    }
    if (!gesture.moved && Math.hypot(p.x - gesture.startX, p.y - gesture.startY) > TAP_SLOP) {
      gesture.moved = true;
      state.hover = null;
      canvas.style.cursor = 'grabbing';
    }
    if (gesture.moved) renderer.panBy(p.x - gesture.lastX, p.y - gesture.lastY);
    else if (e.pointerType === 'mouse') updateHover(e);
    gesture.lastX = p.x; gesture.lastY = p.y;
  });

  function endPointer(e, cancelled) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 1 && gesture) {
      const [rest] = pointers.values();
      gesture.pinch = null; gesture.lastX = rest.x; gesture.lastY = rest.y;
      return;
    }
    if (pointers.size === 0 && gesture) {
      if (!gesture.moved && !cancelled) tapAt(e);
      gesture = null;
      if (e.pointerType === 'mouse') updateHover(e);
    }
  }
  canvas.addEventListener('pointerup', (e) => endPointer(e, false));
  canvas.addEventListener('pointercancel', (e) => endPointer(e, true));
  canvas.addEventListener('pointerleave', () => { if (!pointers.size) state.hover = null; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = screenPos(e);
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    renderer.zoomAt(p.x, p.y, factor);
  }, { passive: false });

  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    audio.unlock();
    const k = e.key.toLowerCase();
    if (state.phase === 'plan' && /^[0-9]$/.test(k)) {
      state.strength = k === '0' ? 10 : +k;
      updateStrengthUi();
    } else if (k === ' ' && state.phase === 'plan') { e.preventDefault(); detonate(); }
    else if (k === ' ' && state.phase === 'replay') { e.preventDefault(); $('rpPlay').click(); }
    else if (k === 'r' && state.sim && state.phase !== 'title') retryLevel();
    else if (k === 'escape' && state.phase === 'replay') endReplay();
    else if (k === 'escape' && state.phase !== 'title') goLevels();
    else if (k === 'm') toggleMusic();
    else if (k === 'v') renderer.resetCamera();
    else if (k === '+' || k === '=') renderer.zoomAt(renderer.playCenter().x, renderer.playCenter().y, 1.25);
    else if (k === '-') renderer.zoomAt(renderer.playCenter().x, renderer.playCenter().y, 0.8);
    else if (k === 's') toggleSfx();
    else if (k === 'x') toggleXray();
  });

  $('strength').addEventListener('input', (e) => { state.strength = +e.target.value; updateStrengthUi(); });
  for (const b of $('types').querySelectorAll('button')) {
    b.addEventListener('click', () => {
      const t = b.dataset.t;
      if (t !== 'standard' && !owns(t)) { toast('Buy this in the shop first'); return; }
      state.chargeType = t;
      audio.click();
      refreshToolbar();
    });
  }
  function toggleXray() {
    if (!owns('xray') || state.phase !== 'plan') return;
    state.xray = !state.xray;
    audio.click();
    refreshToolbar();
  }
  $('btnXray').onclick = toggleXray;
  $('btnNetting').onclick = () => {
    if (state.phase !== 'plan') return;
    const sim = state.sim;
    if (!sim.netting && budgetLeft() < P.NETTING_COST) { audio.error(); toast('Not enough budget for netting'); return; }
    sim.netting = !sim.netting;
    audio.click();
    refreshToolbar();
    updateHud();
  };
  $('btnMegaphone').onclick = () => {
    if (state.phase !== 'plan' && state.phase !== 'countdown') return;
    P.shooAll(state.sim);
    audio.shoo();
    toast('📢 “Clear the area, please!”');
  };
  $('btnClear').onclick = () => { if (state.phase === 'plan') { state.sim.charges = []; audio.remove(); updateHud(); } };
  $('btnDetonate').onclick = () => { audio.unlock(); detonate(); };
  $('btnPlay').onclick = () => { audio.unlock(); audio.click(); audio.setMode('title'); buildLevelGrid(); showScreen('screenLevels'); };
  $('btnBackTitle').onclick = () => { audio.click(); showScreen('screenTitle'); };
  $('btnShop').onclick = () => { audio.click(); buildShop(); showScreen('screenShop'); };
  $('btnShopBack').onclick = () => { audio.click(); buildLevelGrid(); showScreen('screenLevels'); };
  $('btnLevels').onclick = () => { audio.click(); goLevels(); };
  $('btnRetry').onclick = () => { audio.click(); retryLevel(); };
  $('btnNext').onclick = () => { audio.click(); startLevel(state.levelIndex + 1); };
  $('btnMenu').onclick = () => { audio.click(); goLevels(); };
  $('btnReplay').onclick = () => { audio.click(); startReplay(); };

  $('rpPlay').onclick = () => {
    const r = state.replay;
    if (!r) return;
    if (!r.playing && r.t >= replayDuration()) seekReplay(0);
    r.playing = !r.playing;
    $('rpPlay').textContent = r.playing ? '❚❚' : '▶';
  };
  $('rpRestart').onclick = () => { if (state.replay) { seekReplay(0); emitReplayFx(-1, 0); } };
  $('rpScrub').addEventListener('input', (e) => {
    if (!state.replay) return;
    seekReplay((+e.target.value / 1000) * replayDuration());
  });
  for (const b of $('rpSpeeds').querySelectorAll('button')) {
    b.onclick = () => { if (state.replay) { state.replay.speed = +b.dataset.s; syncSpeedButtons(); } };
  }
  $('rpDone').onclick = () => { audio.click(); endReplay(); };

  function toggleMusic() { audio.unlock(); audio.setMusic(!audio.musicOn); $('btnMusic').classList.toggle('off', !audio.musicOn); }
  function toggleSfx() { audio.unlock(); audio.setSfx(!audio.sfxOn); $('btnSfx').classList.toggle('off', !audio.sfxOn); }
  $('btnView').onclick = () => { audio.click(); renderer.resetCamera(); };
  $('btnMusic').onclick = toggleMusic;
  $('btnSfx').onclick = toggleSfx;
  window.addEventListener('resize', () => renderer.resize());
  document.addEventListener('pointerdown', () => audio.unlock(), { once: true });

  // ---------------- Effects ----------------
  function playFx(f) {
    if (f.type === 'explosion') {
      renderer.addExplosion(f.x, f.y, f.strength);
      audio.explosion(f.strength);
    } else if (f.type === 'cut') {
      renderer.addCut(f.x, f.y, f.vertical);
      audio.cut();
    } else if (f.type === 'crush') {
      renderer.addDust(f.x, f.y, 5, true, f.material === 'brick');
      audio.crumble(4);
      audio.rumble();
    } else if (f.type === 'impact') {
      if (f.ground && f.speed > 2.5) renderer.addDust(f.x, f.y, f.mass > 1 ? 4 : 1, f.mass > 1, f.material === 'brick');
      audio.crumble(Math.min(6, f.speed * f.mass));
    } else if (f.type === 'glass') {
      renderer.addGlass(f.x, f.y, f.w, f.h);
      audio.glass();
    } else if (f.type === 'hit') {
      renderer.addText(f.x, f.y - 10, `-${f.pen}${f.fragile ? ' ⛪' : ''}`, 'rgba(255,70,60,A)');
      audio.hit();
    } else if (f.type === 'car') {
      renderer.addText(f.x, f.y - 10, `-${f.pen} 🚗`, 'rgba(255,170,40,A)');
      audio.carAlarm();
    } else if (f.type === 'bystander') {
      renderer.addText(f.x, f.y, `-${f.pen} 😱`, 'rgba(255,90,200,A)');
      audio.scream();
    }
  }

  function handleFx() {
    const sim = state.sim;
    for (const f of sim.fx) playFx(f);
    sim.fx.length = 0;
  }

  // ---------------- Main loop ----------------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const sim = state.sim;

    if (state.phase === 'plan') {
      state.planLeft -= dt;
      P.updatePeople(sim, dt, true);
      if (state.planLeft <= 0) {
        state.planLeft = 0;
        if (sim.charges.length) { toast("Time's up — detonating!"); detonate(); }
        else { toast("Time's up!"); state.phase = 'blast'; state.blastTime = 0; setControlsEnabled(false); }
      }
    } else if (state.phase === 'countdown') {
      P.updatePeople(sim, dt, false);
      const before = Math.ceil(state.countdown);
      state.countdown -= dt;
      const after = Math.ceil(state.countdown);
      if (after !== before && after > 0) { $('countdown').textContent = after; audio.beep(false); }
      if (state.countdown <= 0) { audio.beep(true); beginBlast(); }
    } else if (state.phase === 'blast') {
      const maxDelay = Math.max(0, ...sim.charges.map((c) => c.delay));
      // brief slow motion right after the blasts for drama
      const t = state.blastTime;
      const slow = t < maxDelay + 0.6 ? 0.45 : t < maxDelay + 1.4 ? 0.45 + (t - maxDelay - 0.6) / 0.8 * 0.55 : 1;
      state.blastTime += dt * slow;
      P.step(sim, dt * 1000 * slow);
      handleFx();
      if (state.blastTime > maxDelay + 2.5) P.allowSleep(sim);
      const k = P.kineticLevel(sim);
      if (state.blastTime > maxDelay + 3 && k < 0.05) state.settleTime += dt; else state.settleTime = 0;
      if (state.settleTime > 0.8 || state.blastTime > maxDelay + 14) finishBlast();
    } else if (state.phase === 'result') {
      P.step(sim, dt * 1000);
      handleFx();
    } else if (state.phase === 'replay') {
      const r = state.replay;
      const dur = replayDuration();
      if (r.playing) {
        const t0 = r.t;
        r.t = Math.min(dur, r.t + dt * 1000 * r.speed);
        emitReplayFx(t0, r.t);
        if (r.t >= dur) { r.playing = false; $('rpPlay').textContent = '▶'; }
      }
      $('rpScrub').value = Math.round((r.t / dur) * 1000);
      $('rpTime').textContent = (r.t / 1000).toFixed(1) + 's';
    }

    const bar = state.phase === 'replay' ? $('replayBar') : $('toolbar');
    const bottomInset = bar.classList.contains('hidden') ? 10 : bar.offsetHeight + 16;
    renderer.setInsets(window.innerHeight < 500 ? 46 : 70, Math.max(bottomInset, window.innerHeight < 500 ? 50 : 90));
    // particles run at replay speed so slow-mo looks right
    renderer.update(state.phase === 'replay' && state.replay.playing ? dt * state.replay.speed : state.phase === 'replay' ? 0 : dt);
    const scene = state.phase === 'replay'
      ? P.frameScene(sim, state.rec, frameIndexAt(state.rec, state.replay.t))
      : P.liveScene(sim);
    const xrayOn = state.xray && state.phase === 'plan' && owns('xray') && !sim.truss;
    $('xrayLegend').classList.toggle('hidden', !xrayOn);
    renderer.draw({
      xray: xrayOn ? P.loadMap(sim) : null,
      scene, phase: state.phase, hover: state.phase === 'plan' ? state.hover : null,
      strength: state.strength, delay: state.delay, chargeType: state.chargeType, showLot: state.phase === 'plan',
    });
    $('btnView').classList.toggle('hidden', !renderer.isZoomed());
    updateHud();
    requestAnimationFrame(frame);
  }

  window.__implode.state = state;
  window.__implode.progress = progress;
  // Title screen backdrop: show the first level standing
  state.sim = P.createSim(LEVELS[0], 1);
  updateStrengthUi();
  showScreen('screenTitle');
  requestAnimationFrame(frame);
})();
