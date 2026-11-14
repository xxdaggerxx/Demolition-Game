// Game controller: phases, input, HUD and scoring flow.
(function () {
  const P = window.DemoPhysics;
  const LEVELS = window.LEVELS;
  const $ = (id) => document.getElementById(id);

  const canvas = $('game');
  const renderer = new Renderer(canvas);
  const audio = new GameAudio();
  window.__implode = { renderer, state: null };

  const STORE_KEY = 'implode-progress-v1';
  const progress = loadProgress();

  const state = {
    phase: 'title', // title | plan | countdown | blast | result
    levelIndex: 0,
    sim: null,
    strength: 3,
    delay: 0,
    hover: null,
    planLeft: 0,
    countdown: 0,
    blastTime: 0,
    settleTime: 0,
    showLot: true,
    detonatedWithLeft: 0,
  };

  // ---------------- Persistence ----------------
  function loadProgress() {
    try {
      const p = JSON.parse(localStorage.getItem(STORE_KEY));
      if (p && p.best) return p;
    } catch (e) { /* ignore */ }
    return { unlocked: 1, best: {} };
  }
  function saveProgress() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch (e) { /* ignore */ }
  }

  // ---------------- Screens ----------------
  function showScreen(id) {
    for (const s of ['screenTitle', 'screenLevels', 'screenResult']) $(s).classList.toggle('hidden', s !== id);
    $('overlay').classList.toggle('hidden', !id);
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
      b.innerHTML = `<span class="n">Job ${L.id}${locked ? ' 🔒' : ''}</span><span class="t">${L.name}</span>
        <span class="s">${stars}</span><br><span class="b">${best ? 'Best: ' + best.score : L.floors + ' floors · ' + L.bays + ' bays'}</span>`;
      b.onclick = () => { audio.click(); startLevel(i); };
      grid.appendChild(b);
    });
  }

  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), ms || 1800);
  }

  // ---------------- Level flow ----------------
  function startLevel(i) {
    const L = LEVELS[i];
    state.levelIndex = i;
    state.sim = P.createSim(L, (Math.random() * 1e9) | 0);
    state.phase = 'plan';
    state.planLeft = L.planTime;
    state.hover = null;
    state.blastTime = 0;
    state.settleTime = 0;
    renderer.clearFx();
    renderer.setLevel(L);
    showScreen(null);
    $('hud').classList.remove('hidden');
    $('toolbar').classList.remove('hidden');
    $('btnMenu').classList.remove('hidden');
    $('countdown').classList.add('hidden');
    $('levelName').textContent = `${L.id}. ${L.name}`;
    $('timerLabel').textContent = 'Planning time';
    setControlsEnabled(true);
    updateHud();
    audio.setMode('plan');
    toast(L.blurb, 3500);
  }

  function setControlsEnabled(on) {
    for (const el of $('toolbar').querySelectorAll('button, input')) el.disabled = !on;
  }

  function detonate() {
    if (state.phase !== 'plan') return;
    if (!state.sim.charges.length) { audio.error(); toast('Plant at least one charge first!'); return; }
    state.phase = 'countdown';
    state.countdown = 3;
    state.detonatedWithLeft = state.planLeft;
    state.hover = null;
    setControlsEnabled(false);
    audio.setMode('tense');
    audio.beep(false);
    audio.fuse(3);
    const cd = $('countdown');
    cd.textContent = '3';
    cd.classList.remove('hidden');
  }

  function beginBlast() {
    $('countdown').classList.add('hidden');
    state.phase = 'blast';
    state.blastTime = 0;
    state.sim.time = 0;
    state.sim.acc = 0;
    $('timerLabel').textContent = 'Demolition';
  }

  function finishBlast() {
    state.phase = 'result';
    const ev = P.evaluate(state.sim);
    const L = LEVELS[state.levelIndex];
    const timeBonus = ev.success ? Math.round((state.detonatedWithLeft / L.planTime) * 100) : 0;
    const total = ev.success ? ev.score + timeBonus : 0;
    audio.setMode('calm');
    audio.jingle(ev.success);

    $('resTitle').textContent = ev.success
      ? (ev.stars === 3 ? 'Perfect implosion!' : ev.hits === 0 ? 'Clean job!' : 'Demolished!')
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
      ['Explosive efficiency', pct(ev.efficiency), ev.effPts],
      ['Hits on neighbours', String(ev.hits), -ev.penalty],
      ['Time bonus', Math.round(state.detonatedWithLeft) + 's left', timeBonus],
    ];
    $('resTable').innerHTML = rows.map(([a, b, c]) =>
      `<tr><td>${a}</td><td>${b}</td><td class="${c < 0 ? 'neg' : ''}">${c > 0 ? '+' : ''}${c}</td></tr>`).join('');
    $('resTotal').textContent = ev.success ? `Score: ${total}` : 'Collapse at least 60% of the building to pass';

    const prev = progress.best[L.id];
    let bestMsg = prev ? `Best: ${prev.score}` : '';
    if (ev.success) {
      if (!prev || total > prev.score) {
        progress.best[L.id] = { score: total, stars: Math.max(ev.stars, prev ? prev.stars : 0) };
        bestMsg = prev ? 'New best score!' : '';
      } else if (ev.stars > prev.stars) prev.stars = ev.stars;
      progress.unlocked = Math.max(progress.unlocked, Math.min(LEVELS.length, state.levelIndex + 2));
      saveProgress();
    }
    $('resBest').textContent = bestMsg;
    const hasNext = state.levelIndex + 1 < LEVELS.length;
    $('btnNext').classList.toggle('hidden', !(ev.success && hasNext));
    setTimeout(() => { if (state.phase === 'result') showScreen('screenResult'); }, 600);
  }

  function goLevels() {
    audio.setMode('title');
    state.phase = 'title';
    $('hud').classList.add('hidden');
    $('toolbar').classList.add('hidden');
    $('countdown').classList.add('hidden');
    buildLevelGrid();
    showScreen('screenLevels');
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
    const tb = $('timer').parentElement;
    if (state.phase === 'plan' || state.phase === 'countdown') {
      $('timer').textContent = fmtTime(state.planLeft);
      tb.classList.toggle('warn', state.phase === 'plan' && state.planLeft <= 10);
    } else {
      $('timer').textContent = state.blastTime.toFixed(1) + 's';
      tb.classList.remove('warn');
    }
  }

  function updateStrengthUi() {
    const s = state.strength;
    $('strength').value = s;
    $('strengthVal').textContent = s;
    $('strengthKg').textContent = `(${(s * s * 0.25).toFixed(s < 3 ? 2 : 1)} kg)`;
    const hint = s < 3 ? 'Too weak to cut columns — only loosens joints'
      : s < 4 ? 'Cuts columns (not slabs)'
        : s < 7 ? 'Cuts columns and slabs'
          : 'Heavy — expect flying debris!';
    $('strengthHint').textContent = hint;
  }

  // ---------------- Input ----------------
  function eventWorld(e) {
    const r = canvas.getBoundingClientRect();
    return renderer.toWorld(e.clientX - r.left, e.clientY - r.top);
  }

  function computeHover(p) {
    const sim = state.sim;
    for (const ch of sim.charges) {
      const cp = P.chargePos(ch);
      if (Math.hypot(cp.x - p.x, cp.y - p.y) < Math.max(11, 16 / renderer.scale)) return { charge: ch };
    }
    const body = P.pieceAt(sim, p);
    if (!body) return null;
    const pc = body.plugin.piece;
    if (pc.kind === 'wall') return { body: null, point: null, wall: true };
    // snap the charge to the member's centre line
    const local = Matter.Vector.rotate(Matter.Vector.sub(p, body.position), -body.angle);
    if (pc.kind === 'column') { local.x = 0; local.y = Math.max(-pc.h / 2 + 7, Math.min(pc.h / 2 - 7, local.y)); }
    else { local.y = 0; local.x = Math.max(-pc.w / 2 + 6, Math.min(pc.w / 2 - 6, local.x)); }
    const point = Matter.Vector.add(body.position, Matter.Vector.rotate(local, body.angle));
    let weak = null;
    if (state.strength < pc.toughness) weak = `Needs strength ${pc.toughness}+ to cut this ${pc.kind}`;
    return { body, point, weak };
  }

  // ---- Touch & mouse: tap = plant/remove, one-finger drag = pan, pinch = zoom ----
  const pointers = new Map(); // pointerId -> {x, y}
  let gesture = null; // { startX, startY, moved, pinchDist, button, pointerType }
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
    canvas.style.cursor = state.hover && (state.hover.body || state.hover.charge) ? 'crosshair' : 'grab';
  }

  function tapAt(e) {
    if (state.phase !== 'plan') return;
    const h = computeHover(eventWorld(e));
    state.hover = h;
    if (!h) return;
    const sim = state.sim;
    if (h.charge) {
      sim.charges.splice(sim.charges.indexOf(h.charge), 1);
      audio.remove();
      state.hover = null;
    } else if (h.wall) {
      audio.error();
      toast('Wall panels are just cladding — target columns and floor slabs');
    } else if (h.body) {
      const L = LEVELS[state.levelIndex];
      if (sim.charges.length >= L.maxCharges) { audio.error(); toast(`Charge limit reached (${L.maxCharges})`); return; }
      P.addCharge(sim, h.body, h.point, state.strength, state.delay);
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
      // one finger lifted out of a pinch: keep panning with the remaining finger
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
  canvas.addEventListener('pointerleave', (e) => { if (!pointers.size) state.hover = null; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Mouse wheel / trackpad pinch zoom on desktop
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = screenPos(e);
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    renderer.zoomAt(p.x, p.y, factor);
  }, { passive: false });

  // Stop iOS Safari from zooming the whole page instead of the game
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    audio.unlock();
    const k = e.key.toLowerCase();
    if (state.phase === 'plan' && /^[0-9]$/.test(k)) {
      state.strength = k === '0' ? 10 : +k;
      updateStrengthUi();
    } else if (k === ' ' && state.phase === 'plan') { e.preventDefault(); detonate(); }
    else if (k === 'r' && state.sim && state.phase !== 'title') startLevel(state.levelIndex);
    else if (k === 'escape' && state.phase !== 'title') goLevels();
    else if (k === 'm') toggleMusic();
    else if (k === 'v') renderer.resetCamera();
    else if (k === '+' || k === '=') renderer.zoomAt(renderer.playCenter().x, renderer.playCenter().y, 1.25);
    else if (k === '-') renderer.zoomAt(renderer.playCenter().x, renderer.playCenter().y, 0.8);
    else if (k === 's') toggleSfx();
  });

  $('strength').addEventListener('input', (e) => { state.strength = +e.target.value; updateStrengthUi(); });
  for (const b of $('delays').querySelectorAll('button')) {
    b.addEventListener('click', () => {
      state.delay = +b.dataset.d;
      for (const o of $('delays').querySelectorAll('button')) o.classList.toggle('on', o === b);
      audio.click();
    });
  }
  $('btnClear').onclick = () => { if (state.phase === 'plan') { state.sim.charges = []; audio.remove(); updateHud(); } };
  $('btnDetonate').onclick = () => { audio.unlock(); detonate(); };
  $('btnPlay').onclick = () => { audio.unlock(); audio.click(); audio.setMode('title'); buildLevelGrid(); showScreen('screenLevels'); };
  $('btnBackTitle').onclick = () => { audio.click(); showScreen('screenTitle'); };
  $('btnLevels').onclick = () => { audio.click(); goLevels(); };
  $('btnRetry').onclick = () => { audio.click(); startLevel(state.levelIndex); };
  $('btnNext').onclick = () => { audio.click(); startLevel(state.levelIndex + 1); };
  $('btnMenu').onclick = () => { audio.click(); goLevels(); };

  function toggleMusic() { audio.unlock(); audio.setMusic(!audio.musicOn); $('btnMusic').classList.toggle('off', !audio.musicOn); }
  function toggleSfx() { audio.unlock(); audio.setSfx(!audio.sfxOn); $('btnSfx').classList.toggle('off', !audio.sfxOn); }
  $('btnView').onclick = () => { audio.click(); renderer.resetCamera(); };
  $('btnMusic').onclick = toggleMusic;
  $('btnSfx').onclick = toggleSfx;
  window.addEventListener('resize', () => renderer.resize());
  document.addEventListener('pointerdown', () => audio.unlock(), { once: true });

  // ---------------- Main loop ----------------
  function handleFx() {
    const sim = state.sim;
    for (const f of sim.fx) {
      if (f.type === 'explosion') {
        renderer.addExplosion(f.x, f.y, f.strength);
        audio.explosion(f.strength);
      } else if (f.type === 'crush') {
        renderer.addDust(f.x, f.y, 5, true);
        audio.crumble(4);
        audio.rumble();
      } else if (f.type === 'impact') {
        if (f.ground && f.speed > 2.5) renderer.addDust(f.x, f.y, f.mass > 1 ? 4 : 1, f.mass > 1);
        audio.crumble(Math.min(6, f.speed * f.mass));
      } else if (f.type === 'hit') {
        renderer.addText(f.x, f.y - 10, `-${f.pen}`, 'rgba(255,70,60,A)');
        audio.hit();
      }
    }
    sim.fx.length = 0;
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (state.phase === 'plan') {
      state.planLeft -= dt;
      if (state.planLeft <= 0) {
        state.planLeft = 0;
        if (state.sim.charges.length) { toast("Time's up — detonating!"); detonate(); }
        else { toast("Time's up!"); state.phase = 'blast'; state.blastTime = 0; setControlsEnabled(false); }
      }
    } else if (state.phase === 'countdown') {
      const before = Math.ceil(state.countdown);
      state.countdown -= dt;
      const after = Math.ceil(state.countdown);
      if (after !== before && after > 0) { $('countdown').textContent = after; audio.beep(false); }
      if (state.countdown <= 0) { audio.beep(true); beginBlast(); }
    } else if (state.phase === 'blast') {
      const maxDelay = Math.max(0, ...state.sim.charges.map((c) => c.delay));
      // brief slow motion right after each blast wave for drama
      const t = state.blastTime;
      const slow = t < maxDelay + 0.6 ? 0.45 : t < maxDelay + 1.4 ? 0.45 + (t - maxDelay - 0.6) / 0.8 * 0.55 : 1;
      state.blastTime += dt * slow;
      P.step(state.sim, dt * 1000 * slow);
      handleFx();
      if (state.blastTime > maxDelay + 2.5) P.allowSleep(state.sim);
      const k = P.kineticLevel(state.sim);
      if (state.blastTime > maxDelay + 3 && k < 0.05) state.settleTime += dt; else state.settleTime = 0;
      if (state.settleTime > 0.8 || state.blastTime > maxDelay + 14) finishBlast();
    } else if (state.phase === 'result') {
      P.step(state.sim, dt * 1000);
      handleFx();
    }

    const tb = $('toolbar');
    const bottomInset = tb.classList.contains('hidden') ? 10 : tb.offsetHeight + 16;
    renderer.setInsets(window.innerHeight < 500 ? 46 : 70, Math.max(bottomInset, window.innerHeight < 500 ? 50 : 90));
    renderer.update(dt);
    renderer.draw({
      sim: state.sim, phase: state.phase, hover: state.phase === 'plan' ? state.hover : null,
      strength: state.strength, delay: state.delay, showLot: state.phase === 'plan',
    });
    $('btnView').classList.toggle('hidden', !renderer.isZoomed());
    updateHud();
    requestAnimationFrame(frame);
  }

  window.__implode.state = state;
  // Title screen backdrop: show the first level standing
  state.sim = P.createSim(LEVELS[0], 1);
  updateStrengthUi();
  showScreen('screenTitle');
  requestAnimationFrame(frame);
})();
