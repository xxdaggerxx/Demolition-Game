// Physics simulation for the demolition game, built on Matter.js.
// Works both in the browser (global Matter) and in Node (for headless tests).
(function (root) {
  const M = root.Matter || (typeof require !== 'undefined' ? require('../lib/matter.min.js') : null);
  const { Engine, Bodies, Body, Composite, Constraint, Events, Query, Vector } = M;

  const WORLD = { w: 1600, h: 900, groundY: 820 };
  const COL_W = 12;
  const SLAB_H = 10;
  const STEP_MS = 1000 / 120; // physics sub-step
  // Collision categories. Wall panels are cladding: they hang off the frame and
  // never carry load, so they only collide with the ground, neighbours and cars.
  const CAT = { struct: 0x1, wall: 0x2, ground: 0x4, neighbor: 0x8, prop: 0x10 };

  // Building materials. pieces = [short, long] fragment counts when a member is
  // blown apart (blast) or crushed by the load above (crush).
  const MATERIALS = {
    concrete: {
      name: 'Concrete', colTough: 3, slabTough: 4, breakDist: 4.5, stiffness: 0.95,
      density: { column: 0.0030, slab: 0.0032 },
      blast: { pieces: [2, 4], scale: [0.55, 0.35] }, crush: { pieces: [1, 2], scale: [0.45, 0.2] },
    },
    brick: {
      name: 'Brick', colTough: 2, slabTough: 3, breakDist: 3.6, stiffness: 0.95,
      density: { column: 0.0034, slab: 0.0024 },
      blast: { pieces: [2, 5], scale: [0.6, 0.3] }, crush: { pieces: [2, 3], scale: [0.55, 0.25] },
    },
    steel: {
      name: 'Steel', colTough: 6, slabTough: 6, breakDist: 7, stiffness: 0.8,
      density: { column: 0.0024, slab: 0.0026 },
      blast: { pieces: [1, 2], scale: [0.92, 0.05] }, crush: { pieces: [1, 2], scale: [0.92, 0.05] },
    },
    // Landmark looks: physics shared with brick / steel, but drawn differently.
    sandstone: {
      name: 'Sandstone', colTough: 2, slabTough: 3, breakDist: 3.8, stiffness: 0.95,
      density: { column: 0.0032, slab: 0.0024 },
      blast: { pieces: [2, 5], scale: [0.6, 0.3] }, crush: { pieces: [2, 3], scale: [0.55, 0.25] },
    },
    marble: {
      name: 'Marble', colTough: 2, slabTough: 3, breakDist: 3.8, stiffness: 0.95,
      density: { column: 0.0034, slab: 0.0026 },
      blast: { pieces: [2, 4], scale: [0.6, 0.3] }, crush: { pieces: [2, 3], scale: [0.55, 0.25] },
    },
    iron: {
      name: 'Wrought iron', colTough: 6, slabTough: 6, breakDist: 6, stiffness: 0.9,
      density: { column: 0.0026, slab: 0.0026 },
      blast: { pieces: [1, 2], scale: [0.92, 0.05] }, crush: { pieces: [1, 2], scale: [0.92, 0.05] },
    },
    glass: {
      name: 'Glass', colTough: 3, slabTough: 4, breakDist: 4.5, stiffness: 0.95, glassWalls: true,
      density: { column: 0.0030, slab: 0.0032 },
      blast: { pieces: [2, 4], scale: [0.55, 0.35] }, crush: { pieces: [1, 2], scale: [0.45, 0.2] },
    },
  };

  const BASE = {
    column: { friction: 0.9, frictionStatic: 1.2, restitution: 0.02 },
    slab: { friction: 0.9, frictionStatic: 1.2, restitution: 0.02 },
    wall: { density: 0.0012, friction: 0.8, frictionStatic: 1.0, restitution: 0.03, toughness: 1, breakDist: 3.5 },
    frag: { density: 0.0025, friction: 0.9, frictionStatic: 1.0, restitution: 0.05 },
    tank: { density: 0.0040, friction: 0.8, frictionStatic: 1.0, restitution: 0.02, toughness: 3 },
    spire: { density: 0.0008, friction: 0.8, frictionStatic: 1.0, restitution: 0.02, toughness: 3 },
    belfry: { density: 0.0030, friction: 0.8, frictionStatic: 1.0, restitution: 0.02, toughness: 3 },
    beam: { density: 0.0026, friction: 0.8, frictionStatic: 1.0, restitution: 0.03, toughness: 6 },
    sign: { density: 0.0016, friction: 0.8, frictionStatic: 1.0, restitution: 0.02, toughness: 3 },
  };

  // ---------- Charges: types and prices ----------
  const CHARGE_TYPES = {
    standard: { name: 'Dynamite', base: 150, perKg: 40 },
    shaped: { name: 'Shaped', base: 240, perKg: 64 },
    cutter: { name: 'Cutter', base: 450, perKg: 0 },
  };
  function chargeCost(type, strength) {
    const t = CHARGE_TYPES[type] || CHARGE_TYPES.standard;
    return t.base + t.perKg * (type === 'cutter' ? 0 : strength);
  }
  const NETTING_COST = 600;
  const BYSTANDER_PENALTY = 75;
  const CAR_HIT_PENALTY = 30;

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createSim(level, seed) {
    const engine = Engine.create({
      enableSleeping: false,
      positionIterations: 12,
      velocityIterations: 10,
      constraintIterations: 6,
    });
    engine.gravity.y = 1;
    const sim = {
      engine,
      world: engine.world,
      level,
      mat: MATERIALS[level.material || 'concrete'],
      rand: rng(seed || 12345),
      pieces: [], // all building bodies (incl. fragments)
      joints: [], // { c, breakDist }
      neighbors: [], // logical neighbours: { def, x, y, w, h, cracks, flash, damage, fragile }
      cars: [],
      people: [],
      charges: [],
      fx: [], // events for renderer/audio
      hits: [],
      carHits: 0,
      penalty: 0,
      neighborPen: 0,
      carPen: 0,
      bystanderPen: 0,
      bystanders: 0,
      netting: false,
      time: 0,
      groundY: WORLD.groundY,
      nextChargeId: 1,
      nextPersonId: 1,
      spawnIn: 4,
      rec: null,
      stepCount: 0,
    };

    const ground = Bodies.rectangle(WORLD.w / 2, WORLD.groundY + 200, WORLD.w * 4, 400, {
      isStatic: true, label: 'ground', friction: 1, frictionStatic: 1.5,
      collisionFilter: { category: CAT.ground, mask: 0xffff },
    });
    Composite.add(sim.world, ground);
    sim.ground = ground;

    buildTarget(sim);
    buildNeighbors(sim);
    buildCars(sim);

    Events.on(engine, 'collisionStart', (e) => onCollisions(sim, e));
    return sim;
  }

  function pushFx(sim, e) {
    e.t = sim.time;
    sim.fx.push(e);
    if (sim.rec) sim.rec.fxLog.push(e);
  }

  function makePiece(sim, kind, x, y, w, h, extra, overrides) {
    const m = Object.assign({}, BASE[kind], overrides || {});
    const body = Bodies.rectangle(x, y, w, h, {
      density: m.density, friction: m.friction, frictionStatic: m.frictionStatic,
      restitution: m.restitution, frictionAir: 0.002, slop: 0.02, label: kind,
      chamfer: kind === 'frag' ? undefined : { radius: 1 },
      collisionFilter: kind === 'wall'
        ? { category: CAT.wall, mask: CAT.ground | CAT.neighbor | CAT.prop }
        : { category: CAT.struct, mask: CAT.struct | CAT.ground | CAT.neighbor | CAT.prop },
    });
    body.plugin.piece = Object.assign({
      kind, w, h, toughness: m.toughness || 0, lastHit: -1000, shade: 0.9 + sim.rand() * 0.2, y0: y, vx: 0, vy: 0,
      material: sim.level.material || 'concrete',
    }, extra || {});
    sim.pieces.push(body);
    Composite.add(sim.world, body);
    return body;
  }

  // Rigidly joins two bodies (or a body to the world) at the given world points.
  function weld(sim, a, b, points, breakDist, stiffness) {
    for (const p of points) {
      const c = Constraint.create({
        bodyA: a,
        pointA: Vector.sub(p, a.position),
        bodyB: b || undefined,
        pointB: b ? Vector.sub(p, b.position) : { x: p.x, y: p.y },
        length: 0, stiffness: stiffness || 0.95, damping: 0.05,
        render: { visible: false },
      });
      Composite.add(sim.world, c);
      sim.joints.push({ c, breakDist });
    }
  }

  function buildTarget(sim) {
    if (sim.level.structure === 'truss') return buildTruss(sim);
    const L = sim.level;
    const mat = sim.mat;
    const B = L.bays, F = L.floors, bw = L.bayW, fh = L.floorH;
    const colH = fh - SLAB_H;
    const left = L.x - (B * bw) / 2;
    const gy = WORLD.groundY;
    sim.building = { left, right: left + B * bw, height: F * fh, top: gy - F * fh };
    const colOver = { density: mat.density.column, toughness: mat.colTough };
    const slabOver = { density: mat.density.slab, toughness: mat.slabTough };

    const slabs = []; // slabs[f][j]
    const cols = []; // cols[f][i]
    const walls = [];
    for (let f = 0; f < F; f++) {
      const base = gy - f * fh;
      cols[f] = [];
      for (let i = 0; i <= B; i++) {
        const x = left + i * bw;
        cols[f][i] = makePiece(sim, 'column', x, base - colH / 2, COL_W, colH, { floor: f, line: i }, colOver);
      }
      slabs[f] = [];
      const sy = base - colH - SLAB_H / 2;
      for (let j = 0; j < B; j++) {
        const x0 = left + j * bw - (j === 0 ? COL_W / 2 : 0);
        const x1 = left + (j + 1) * bw + (j === B - 1 ? COL_W / 2 : 0);
        slabs[f][j] = makePiece(sim, 'slab', (x0 + x1) / 2, sy, x1 - x0, SLAB_H, { floor: f, bay: j, x0, x1 }, slabOver);
      }
      walls[f] = [];
      for (let j = 0; j < B; j++) {
        const x0 = left + j * bw + COL_W / 2 + 0.5;
        const x1 = left + (j + 1) * bw - COL_W / 2 - 0.5;
        const ww = x1 - x0, wh = colH - 3;
        const isLobby = f === 0 && (j === Math.floor(B / 2) || (B % 2 === 0 && j === B / 2 - 1));
        walls[f][j] = makePiece(sim, 'wall', (x0 + x1) / 2, base - colH / 2 - 1.5, ww, wh, {
          floor: f, bay: j, lobby: isLobby, style: (f + j) % 3, glass: !!mat.glassWalls,
        });
      }
    }

    const slabAt = (f, x) => {
      for (const s of slabs[f]) if (x >= s.plugin.piece.x0 - 0.01 && x <= s.plugin.piece.x1 + 0.01) return s;
      return null;
    };
    const cBreak = mat.breakDist, stiff = mat.stiffness;
    for (let f = 0; f < F; f++) {
      const base = gy - f * fh;
      const topY = base - colH;
      for (let i = 0; i <= B; i++) {
        const col = cols[f][i];
        const x = col.position.x;
        for (const dx of [-COL_W / 2 + 1.5, COL_W / 2 - 1.5]) {
          const s = slabAt(f, x + dx);
          if (s) weld(sim, col, s, [{ x: x + dx, y: topY }], cBreak, stiff);
        }
        for (const dx of [-COL_W / 2 + 1.5, COL_W / 2 - 1.5]) {
          if (f === 0) weld(sim, col, null, [{ x: x + dx, y: base }], cBreak, stiff);
          else {
            const s = slabAt(f - 1, x + dx);
            if (s) weld(sim, col, s, [{ x: x + dx, y: base }], cBreak, stiff);
          }
        }
      }
      for (let j = 0; j < B - 1; j++) {
        const a = slabs[f][j], b = slabs[f][j + 1];
        const x = a.plugin.piece.x1;
        const sy = topY - SLAB_H / 2;
        weld(sim, a, b, [{ x, y: sy - SLAB_H / 2 + 1.5 }, { x, y: sy + SLAB_H / 2 - 1.5 }], cBreak, stiff);
      }
      for (let j = 0; j < B; j++) {
        const w = walls[f][j];
        const pc = w.plugin.piece;
        const x0 = w.position.x - pc.w / 2 + 3, x1 = w.position.x + pc.w / 2 - 3;
        weld(sim, w, slabs[f][j], [{ x: x0, y: topY }, { x: x1, y: topY }], BASE.wall.breakDist);
      }
    }

    // Rooftop extras: they sit high up, so they love to topple sideways.
    const roofY = gy - F * fh;
    const addRoof = (kind, w, h, cx) => {
      const body = makePiece(sim, kind, cx, roofY - h / 2 - 0.5, w, h, { floor: F, roof: true });
      for (const dx of [-w / 2 + 4, w / 2 - 4]) {
        const s = slabAt(F - 1, cx + dx);
        if (s) weld(sim, body, s, [{ x: cx + dx, y: roofY }], 5);
      }
      return body;
    };
    if (L.roof === 'tank') addRoof('tank', 40, 46, left + bw);
    if (L.roof === 'sign') addRoof('sign', Math.min(B * bw - 20, 110), 40, L.x);
    if (L.roof === 'spire') addRoof('spire', B * bw + COL_W - 6, 96, L.x);
    if (L.roof === 'belfry') addRoof('belfry', B * bw - 14, 40, L.x);
    // clock faces near the top of a clock tower
    if (L.clockFloor != null) for (const w of walls[L.clockFloor]) w.plugin.piece.clock = true;
    if (L.lean) applyLean(sim, L.lean);

    sim.cols = cols; sim.slabs = slabs; sim.walls = walls;
    sim.totalMass = sim.pieces.reduce((s, b) => s + b.mass, 0);
    sim.comX0 = sim.pieces.reduce((s, b) => s + b.mass * b.position.x, 0) / sim.totalMass;
  }

  // Tilt the whole (already welded) structure about the bottom corner it leans
  // toward, like the famous tower. Constraint offsets on bodies rotate with them;
  // the foundation anchors are world points and are rotated here.
  function applyLean(sim, angle) {
    const b = sim.building;
    const pivot = { x: angle > 0 ? b.right + COL_W / 2 : b.left - COL_W / 2, y: WORLD.groundY };
    const rot = (p) => Vector.add(pivot, Vector.rotate(Vector.sub(p, pivot), angle));
    for (const body of sim.pieces) {
      Body.setPosition(body, rot(body.position));
      Body.setAngle(body, body.angle + angle);
      body.plugin.piece.y0 = body.position.y;
    }
    for (const j of sim.joints) if (!j.c.bodyB) j.c.pointB = rot(j.c.pointB);
    const xs = sim.pieces.map((p) => p.position.x);
    sim.building.leanLeft = Math.min(...xs);
    sim.building.leanRight = Math.max(...xs);
  }

  // ---------- Lattice (truss) structures, e.g. an iron tower ----------
  // Members are rigid bars joined at nodes. Intact members share a negative
  // collision group so the overlapping ends at each node don't fight; once a
  // member has torn completely free it rejoins normal collisions as rubble.
  const TRUSS_GROUP = -7;
  function buildTruss(sim) {
    const L = sim.level;
    const gy = WORLD.groundY;
    const H = L.height, base = L.baseHalf, cx = L.x;
    const hw = (h) => L.topHalf + (base - L.topHalf) * Math.pow(1 - h / H, 2.1);
    const levels = L.trussLevels;
    const lefts = levels.map((h) => ({ x: cx - hw(h), y: gy - h }));
    const rights = levels.map((h) => ({ x: cx + hw(h), y: gy - h }));
    const apex = { x: cx, y: gy - H };
    const nodeOwner = new Map(); // node key -> primary member
    const key = (p) => `${Math.round(p.x)}:${Math.round(p.y)}`;
    let idx = 0;
    const T = 7;
    const member = (a, b, extra) => {
      const len = Vector.magnitude(Vector.sub(b, a));
      const mid = Vector.mult(Vector.add(a, b), 0.5);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const thick = (extra && extra.thick) || T;
      const over = (extra && extra.over) || 0;
      const body = makePiece(sim, 'beam', mid.x, mid.y, len + over * 2, thick, Object.assign({ truss: true, idx: idx++, floor: 0 }, extra || {}),
        { density: sim.mat.density.column, toughness: sim.mat.colTough });
      Body.setAngle(body, ang);
      body.collisionFilter.group = TRUSS_GROUP;
      body.plugin.piece.y0 = body.position.y;
      // rigid connection at each end: two pins along the member's axis
      const u = { x: Math.cos(ang), y: Math.sin(ang) };
      for (const [p, dir] of [[a, 1], [b, -1]]) {
        const k = key(p);
        const pts = [p, Vector.add(p, Vector.mult(u, 4 * dir))];
        if (p.y >= gy - 0.5) weld(sim, body, null, pts, sim.mat.breakDist, sim.mat.stiffness);
        else if (nodeOwner.has(k)) weld(sim, body, nodeOwner.get(k), pts, sim.mat.breakDist, sim.mat.stiffness);
        else nodeOwner.set(k, body);
      }
      return body;
    };
    const n = levels.length;
    for (let k = 0; k < n - 1; k++) {
      member(lefts[k], lefts[k + 1], { leg: true, floor: k });
      member(rights[k], rights[k + 1], { leg: true, floor: k });
    }
    member(lefts[n - 1], apex, { leg: true, floor: n - 1 });
    member(rights[n - 1], apex, { leg: true, floor: n - 1 });
    for (let k = 1; k < n; k++) {
      const deck = L.decks.includes(k);
      member(lefts[k], rights[k], { floor: k, deck, arch: k === 1, thick: deck ? 9 : 6, over: deck ? 14 : 0 });
    }
    for (let k = 1; k < n - 1; k++) {
      if (k % 2) member(lefts[k], rights[k + 1], { floor: k, diag: true, thick: 5 });
      else member(rights[k], lefts[k + 1], { floor: k, diag: true, thick: 5 });
    }
    // flagpole on top
    member(apex, { x: cx, y: gy - H - 46 }, { floor: n, thick: 4, mast: true });
    sim.building = { left: cx - base, right: cx + base, height: H, top: gy - H };
    sim.cols = []; sim.slabs = []; sim.walls = [];
    sim.truss = true;
    sim.totalMass = sim.pieces.reduce((s, b) => s + b.mass, 0);
    sim.comX0 = sim.pieces.reduce((s, b) => s + b.mass * b.position.x, 0) / sim.totalMass;
  }

  function releaseFreeTrussMembers(sim) {
    if (!sim.truss) return;
    const held = new Set();
    for (const j of sim.joints) { held.add(j.c.bodyA); if (j.c.bodyB) held.add(j.c.bodyB); }
    for (const b of sim.pieces) {
      if (b.collisionFilter.group === TRUSS_GROUP && !held.has(b)) b.collisionFilter.group = 0;
    }
  }

  function buildNeighbors(sim) {
    const gy = WORLD.groundY;
    for (const n of sim.level.neighbors) {
      const nb = { def: n, x: n.x, y: gy - n.h / 2, w: n.w, h: n.h, damage: 0, flash: 0, cracks: [], fragile: !!n.fragile };
      const opts = { isStatic: true, label: 'neighbor', friction: 0.8, collisionFilter: { category: CAT.neighbor, mask: 0xffff } };
      const body = Bodies.rectangle(n.x, gy - n.h / 2, n.w, n.h, opts);
      body.plugin.neighbor = nb;
      Composite.add(sim.world, body);
      if (n.style === 'church') {
        // the steeple is part of the same building
        const sw = 34, sh = 110;
        const st = Bodies.rectangle(n.x, gy - n.h - sh / 2, sw, sh, Object.assign({}, opts));
        st.plugin.neighbor = nb;
        Composite.add(sim.world, st);
        nb.steeple = { w: sw, h: sh };
      }
      sim.neighbors.push(nb);
    }
    const ns = sim.level.neighbors.slice().sort((a, b) => a.x - b.x);
    // The danger zone is the whole gap between the neighbours (lot + streets).
    sim.zone = { left: ns[0].x + ns[0].w / 2, right: ns[ns.length - 1].x - ns[ns.length - 1].w / 2 };
    // The lot itself is the building footprint plus a little working room.
    const pad = sim.level.lotPad == null ? 1e9 : sim.level.lotPad;
    sim.lot = {
      left: Math.max(sim.zone.left, sim.building.left - pad),
      right: Math.min(sim.zone.right, sim.building.right + pad),
    };
    // Directional jobs: the building must be toppled into a marked drop zone.
    if (sim.level.topple) {
      const [d0, d1] = sim.level.dropZone;
      sim.dropZone = { left: d0, right: d1, dir: sim.level.topple === 'left' ? -1 : 1 };
      sim.lot.left = Math.min(sim.lot.left, d0);
      sim.lot.right = Math.max(sim.lot.right, d1);
    }
  }

  const CAR_COLORS = ['#e63946', '#457b9d', '#f4a261', '#2a9d8f', '#8338ec', '#ffbe0b'];
  function buildCars(sim) {
    (sim.level.cars || []).forEach((x, i) => {
      const w = 46, h = 18;
      const car = Bodies.rectangle(x, WORLD.groundY - h / 2 - 4, w, h, {
        density: 0.003, friction: 0.6, frictionStatic: 0.9, restitution: 0.05, label: 'car', chamfer: { radius: 4 },
        collisionFilter: { category: CAT.prop, mask: CAT.struct | CAT.ground | CAT.neighbor | CAT.wall | CAT.prop },
      });
      car.plugin.car = { w, h, color: CAR_COLORS[(i + sim.level.id) % CAR_COLORS.length], damage: 0, lastHit: -1000 };
      Composite.add(sim.world, car);
      sim.cars.push(car);
    });
  }

  // ---------- Charges ----------
  function pieceAt(sim, p) {
    const found = Query.point(sim.pieces.filter((b) => b.plugin.piece.kind !== 'frag'), p);
    if (!found.length) return null;
    const order = { column: 0, beam: 0, slab: 1, tank: 2, sign: 2, spire: 2, belfry: 2, wall: 3 };
    found.sort((a, b) => order[a.plugin.piece.kind] - order[b.plugin.piece.kind]);
    return found[0];
  }

  function addCharge(sim, body, p, strength, delay, type) {
    const local = Vector.rotate(Vector.sub(p, body.position), -body.angle);
    type = type || 'standard';
    const ch = { id: sim.nextChargeId++, body, local, strength: type === 'cutter' ? 2 : strength, delay, type, fired: false,
      cost: chargeCost(type, strength) };
    sim.charges.push(ch);
    return ch;
  }

  function chargePos(ch) {
    return Vector.add(ch.body.position, Vector.rotate(ch.local, ch.body.angle));
  }

  function spent(sim) {
    return sim.charges.reduce((s, c) => s + c.cost, 0) + (sim.netting ? NETTING_COST : 0);
  }

  function removeJointsOf(sim, body) {
    sim.joints = sim.joints.filter((j) => {
      if (j.c.bodyA === body || j.c.bodyB === body) {
        Composite.remove(sim.world, j.c);
        return false;
      }
      return true;
    });
  }

  function breakJoint(sim, j) {
    Composite.remove(sim.world, j.c);
    j.broken = true;
  }

  function jointPos(j) {
    const c = j.c;
    const a = c.bodyA ? Vector.add(c.bodyA.position, c.pointA) : c.pointA;
    const b = c.bodyB ? Vector.add(c.bodyB.position, c.pointB) : c.pointB;
    return { a, b };
  }

  function removePiece(sim, body) {
    removeJointsOf(sim, body);
    Composite.remove(sim.world, body);
    const i = sim.pieces.indexOf(body);
    if (i >= 0) sim.pieces.splice(i, 1);
    body.plugin.piece.destroyed = true;
  }

  // Breaks a member into fragments. mode: 'blast' | 'crush' | 'cut'
  function shatter(sim, body, mode) {
    const pc = body.plugin.piece;
    removePiece(sim, body);
    if (mode === 'cut') return cutMember(sim, body);
    let spec = mode === 'crush' ? sim.mat.crush : sim.mat.blast;
    if (pc.kind === 'tank' || pc.kind === 'sign' || pc.kind === 'spire' || pc.kind === 'belfry') spec = { pieces: [1, 2], scale: [0.95, 0.03] };
    const [short, long] = spec.pieces;
    const nx = pc.w > pc.h ? long : short;
    const ny = pc.w > pc.h ? 1 : long;
    const fw = pc.w / nx, fh = pc.h / ny;
    const frags = [];
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < ny; k++) {
        const lx = -pc.w / 2 + fw * (i + 0.5), ly = -pc.h / 2 + fh * (k + 0.5);
        const wp = Vector.add(body.position, Vector.rotate({ x: lx, y: ly }, body.angle));
        const s = spec.scale[0] + sim.rand() * spec.scale[1];
        const w = Math.max(3, fw * s), h = Math.max(3, fh * s);
        const f = makePiece(sim, 'frag', wp.x, wp.y, w, h, { parentKind: pc.kind, shade: pc.shade });
        Body.setAngle(f, body.angle + (sim.rand() - 0.5) * (mode === 'cut' ? 0.1 : 0.6));
        Body.setVelocity(f, body.velocity);
        frags.push(f);
      }
    }
    return frags;
  }

  // A linear cutting charge removes a slice from the middle of a member: two
  // stubs remain and are nudged toward the middle of the building.
  function cutMember(sim, body) {
    const pc = body.plugin.piece;
    const vertical = pc.h >= pc.w;
    const len = vertical ? pc.h : pc.w, thick = vertical ? pc.w : pc.h;
    const cx = (sim.building.left + sim.building.right) / 2;
    const inward = Math.sign(cx - body.position.x) || 1;
    // keep a stub at one end and a short chunk that kicks inward; the rest is vaporised
    const parts = [{ at: 0.5 - 0.3 / 2, len: 0.3, kick: 0 }, { at: -0.5 + 0.18 / 2, len: 0.18, kick: 1.6 }];
    const frags = [];
    for (const part of parts) {
      const off = part.at * len;
      const l = part.len * len;
      const local = vertical ? { x: 0, y: off } : { x: off, y: 0 };
      const wp = Vector.add(body.position, Vector.rotate(local, body.angle));
      const f = makePiece(sim, 'frag', wp.x, wp.y, vertical ? thick : l, vertical ? l : thick,
        { parentKind: pc.kind, shade: pc.shade, cut: true });
      Body.setAngle(f, body.angle);
      Body.setVelocity(f, Vector.add(body.velocity, { x: inward * part.kick, y: 0 }));
      frags.push(f);
    }
    return frags;
  }

  function shatterGlass(sim, wall) {
    const pc = wall.plugin.piece;
    if (pc.destroyed) return;
    removePiece(sim, wall);
    for (let i = 0; i < 3; i++) {
      const wp = Vector.add(wall.position, { x: (sim.rand() - 0.5) * pc.w * 0.6, y: (sim.rand() - 0.5) * pc.h * 0.6 });
      const f = makePiece(sim, 'frag', wp.x, wp.y, 4 + sim.rand() * 4, 3 + sim.rand() * 3, { parentKind: 'glass', shade: 1 },
        { density: 0.0018, restitution: 0.15 });
      Body.setVelocity(f, Vector.add(wall.velocity, { x: (sim.rand() - 0.5) * 2, y: -sim.rand() * 1.2 }));
      Body.setAngle(f, sim.rand() * 3);
    }
    pushFx(sim, { type: 'glass', x: wall.position.x, y: wall.position.y, w: pc.w, h: pc.h });
  }

  function detonate(sim, ch) {
    ch.fired = true;
    const p = chargePos(ch);
    const host = ch.body;
    const hostAlive = sim.pieces.includes(host);
    if (ch.type === 'cutter') {
      // A linear cutting charge slices the member cleanly with almost no blast.
      if (hostAlive) {
        if (host.plugin.piece.kind === 'wall' && host.plugin.piece.glass) shatterGlass(sim, host);
        else shatter(sim, host, 'cut');
      }
      for (const b of sim.pieces) {
        const d = Vector.sub(b.position, p), dist = Vector.magnitude(d);
        if (dist > 24 || dist < 0.001) continue;
        Body.setVelocity(b, Vector.add(b.velocity, Vector.mult(Vector.div(d, dist), 0.5 * (1 - dist / 24))));
      }
      releaseFreeTrussMembers(sim);
      pushFx(sim, { type: 'cut', x: p.x, y: p.y, angle: host.angle, vertical: host.plugin.piece.h > host.plugin.piece.w });
      return;
    }
    const s = ch.strength;
    const R = 26 + s * 13;
    if (hostAlive) {
      if (s >= host.plugin.piece.toughness) shatter(sim, host, 'blast');
      else removeJointsOf(sim, host);
    }
    for (const j of sim.joints) {
      const { a } = jointPos(j);
      const d = Vector.magnitude(Vector.sub(a, p));
      if (d < R * 0.5 || (d < R * 0.8 && sim.rand() < (s / 10) * (1 - d / R))) breakJoint(sim, j);
    }
    sim.joints = sim.joints.filter((j) => !j.broken);
    // Shaped charges focus the blast toward the middle of the building.
    let aim = null;
    if (ch.type === 'shaped') {
      const cx = (sim.building.left + sim.building.right) / 2;
      aim = Math.abs(cx - p.x) < 6 ? { x: 0, y: 1 } : { x: Math.sign(cx - p.x), y: 0 };
    }
    for (const b of sim.pieces.slice()) {
      const d = Vector.sub(b.position, p);
      const dist = Vector.magnitude(d);
      if (dist > R) continue;
      const pc = b.plugin.piece;
      if (pc.kind === 'wall' && pc.glass && dist < R * 1.1) { shatterGlass(sim, b); continue; }
      const fall = 1 - dist / R;
      const dir = dist > 0.001 ? Vector.div(d, dist) : { x: sim.rand() - 0.5, y: -0.5 };
      let kick = Math.min(18, (0.35 * Math.pow(s, 1.5) * fall * fall) / Math.sqrt(Math.max(b.mass, 0.15)));
      let kdir = dir;
      if (aim) {
        const dot = dir.x * aim.x + dir.y * aim.y;
        if (dot < 0.2) kick *= 0.15;
        kdir = Vector.normalise(Vector.add(dir, Vector.mult(aim, 0.8)));
      }
      const jitter = { x: (sim.rand() - 0.5) * kick * 0.3, y: (sim.rand() - 0.5) * kick * 0.3 };
      Body.setVelocity(b, Vector.add(b.velocity, Vector.add(Vector.mult(kdir, kick), jitter)));
      Body.setAngularVelocity(b, b.angularVelocity + (sim.rand() - 0.5) * 0.04 * s * fall);
    }
    // glass panels a little further out shatter from the shock wave
    for (const b of sim.pieces.slice()) {
      const pc = b.plugin.piece;
      if (pc.kind === 'wall' && pc.glass && Vector.magnitude(Vector.sub(b.position, p)) < R * 1.3) shatterGlass(sim, b);
    }
    releaseFreeTrussMembers(sim);
    pushFx(sim, { type: 'explosion', x: p.x, y: p.y, strength: s, radius: R, shaped: !!aim, aim });
  }

  // ---------- Bystanders ----------
  const SHIRTS = ['#ef476f', '#118ab2', '#06d6a0', '#ffd166', '#8338ec', '#f77f00', '#3a86ff'];
  function spawnPerson(sim) {
    const side = sim.rand() < 0.5 ? -1 : 1;
    const z = sim.zone;
    const x = side < 0 ? z.left - 120 - sim.rand() * 80 : z.right + 120 + sim.rand() * 80;
    const target = z.left + 12 + sim.rand() * (z.right - z.left - 24);
    sim.people.push({
      id: sim.nextPersonId++, x, y: WORLD.groundY, dir: -side, speed: 24 + sim.rand() * 14, state: 'walk', target,
      shirt: SHIRTS[Math.floor(sim.rand() * SHIRTS.length)], skin: ['#f1c27d', '#c68642', '#8d5524', '#ffdbac'][Math.floor(sim.rand() * 4)],
      hat: sim.rand() < 0.35, anim: sim.rand() * 10, say: 0,
    });
  }

  function inZone(sim, p) { return p.x > sim.zone.left - 4 && p.x < sim.zone.right + 4; }

  // Advances bystanders by dt seconds. spawn = whether new ones may wander in.
  function updatePeople(sim, dt, spawn) {
    const cfg = sim.level.people;
    if (spawn && cfg) {
      sim.spawnIn -= dt;
      const active = sim.people.filter((p) => p.state === 'walk' || p.state === 'watch').length;
      if (sim.spawnIn <= 0) {
        if (active < cfg.max) spawnPerson(sim);
        sim.spawnIn = cfg.every * (0.7 + sim.rand() * 0.6);
      }
    }
    for (let i = sim.people.length - 1; i >= 0; i--) {
      const p = sim.people[i];
      p.say = Math.max(0, p.say - dt);
      if (p.state === 'walk') {
        p.dir = Math.sign(p.target - p.x) || p.dir;
        p.x += p.dir * p.speed * dt;
        p.anim += dt * p.speed * 0.25;
        if (Math.abs(p.target - p.x) < 2) { p.state = 'watch'; p.say = 2.5; p.dir = Math.sign(sim.level.x - p.x) || 1; }
      } else if (p.state === 'shoo' || p.state === 'panic') {
        p.x += p.dir * (p.state === 'panic' ? 150 : 110) * dt;
        p.anim += dt * 30;
        if (p.x < sim.zone.left - 400 || p.x > sim.zone.right + 400) sim.people.splice(i, 1);
      }
    }
  }

  function personAt(sim, pt, tol) {
    tol = tol || 10;
    let best = null, bestD = 1e9;
    for (const p of sim.people) {
      if (p.state === 'shoo' || p.state === 'panic') continue;
      const dx = Math.abs(pt.x - p.x), dy = p.y - 16 - pt.y;
      if (dx < tol && Math.abs(dy) < 16 + tol * 0.6 && dx < bestD) { best = p; bestD = dx; }
    }
    return best;
  }

  function shoo(sim, p) {
    p.state = 'shoo';
    p.dir = p.x < (sim.zone.left + sim.zone.right) / 2 ? -1 : 1;
    p.say = 1.2;
  }

  function shooAll(sim) { for (const p of sim.people) if (p.state === 'walk' || p.state === 'watch') shoo(sim, p); }

  // Called when the charges go off: anyone still in the danger zone panics.
  function bystandersAtBlast(sim) {
    for (const p of sim.people) {
      if (!inZone(sim, p)) continue;
      p.state = 'panic';
      p.dir = p.x < (sim.zone.left + sim.zone.right) / 2 ? -1 : 1;
      p.say = 2;
      sim.bystanders++;
      sim.bystanderPen += BYSTANDER_PENALTY;
      sim.penalty += BYSTANDER_PENALTY;
      pushFx(sim, { type: 'bystander', x: p.x, y: p.y - 40, pen: BYSTANDER_PENALTY });
    }
  }

  function peopleInZone(sim) { return sim.people.filter((p) => inZone(sim, p) && p.state !== 'shoo' && p.state !== 'panic').length; }

  // ---------- Simulation ----------
  // Advances the simulation in fixed sub-steps. Matter.js is unstable with
  // variable time steps, so leftover time is carried over to the next call.
  function step(sim, ms) {
    sim.acc = (sim.acc || 0) + ms;
    let n = 0;
    while (sim.acc >= STEP_MS && n < 12) {
      for (const ch of sim.charges) if (!ch.fired && sim.time >= ch.delay * 1000) detonate(sim, ch);
      for (const b of sim.pieces) { b.plugin.piece.vx = b.velocity.x; b.plugin.piece.vy = b.velocity.y; }
      Engine.update(sim.engine, STEP_MS);
      sim.time += STEP_MS;
      checkImpacts(sim);
      checkJoints(sim);
      cullLost(sim);
      updatePeople(sim, STEP_MS / 1000, false);
      for (const nb of sim.neighbors) nb.flash = Math.max(0, nb.flash - STEP_MS / 400);
      sim.acc -= STEP_MS;
      sim.stepCount++;
      if (sim.rec && sim.stepCount % 2 === 0) recordFrame(sim);
      n++;
    }
    if (n === 12) sim.acc = 0; // too slow to keep up: drop time rather than spiral
  }

  function lowestInLine(sim, col) {
    const pc = col.plugin.piece;
    for (let f = 0; f < pc.floor; f++) {
      const c = sim.cols[f][pc.line];
      if (!c.plugin.piece.destroyed) return false;
    }
    return true;
  }

  function checkImpacts(sim) {
    let crushed = 0;
    let jointsChanged = false;
    for (const b of sim.pieces.slice()) {
      const pc = b.plugin.piece;
      if (pc.destroyed) continue;
      const dvx = b.velocity.x - pc.vx, dvy = b.velocity.y - pc.vy;
      const dv = Math.sqrt(dvx * dvx + dvy * dvy);
      if (dv < 2.6) continue;
      if (pc.kind === 'wall' && pc.glass) { shatterGlass(sim, b); continue; }
      if (dv > 3.5 && pc.kind !== 'frag' && sim.rand() < (pc.truss ? 0.4 : 0.15)) {
        for (const j of sim.joints) if (j.c.bodyA === b || j.c.bodyB === b) { breakJoint(sim, j); jointsChanged = true; }
      }
    }
    // Cladding tears off once its floor has dropped.
    for (const row of sim.walls) {
      for (const w of row) {
        const pc = w.plugin.piece;
        const dropped = w.position.y - pc.y0;
        const grounded = dropped > 1 && w.bounds.max.y > WORLD.groundY - 0.5;
        if (pc.destroyed || pc.detached || (dropped < sim.level.floorH * 0.3 && !grounded)) continue;
        pc.detached = true;
        for (const j of sim.joints) if (j.c.bodyA === w || j.c.bodyB === w) { breakJoint(sim, j); jointsChanged = true; }
      }
    }
    // A column that has dropped well below where it was built is no longer
    // supported as designed: once it lands, the load above crushes it.
    const fh = sim.level.floorH;
    for (const row of sim.cols) {
      for (const b of row) {
        const pc = b.plugin.piece;
        if (pc.destroyed) continue;
        const dropped = b.position.y - pc.y0;
        if (pc.crushAt == null) {
          if (dropped > fh * 0.3 && (b.velocity.y < 1.2 || dropped > fh * 0.9) && lowestInLine(sim, b)) {
            pc.crushAt = sim.time + 40 + sim.rand() * 90;
          }
        } else if (sim.time >= pc.crushAt && crushed < 8) {
          pushFx(sim, { type: 'crush', x: b.position.x, y: b.position.y, material: pc.material });
          shatter(sim, b, 'crush');
          crushed++;
        }
      }
    }
    if (jointsChanged) { sim.joints = sim.joints.filter((j) => !j.broken); releaseFreeTrussMembers(sim); }
  }

  function checkJoints(sim) {
    let changed = false;
    for (const j of sim.joints) {
      const { a, b } = jointPos(j);
      const dx = a.x - b.x, dy = a.y - b.y;
      if (dx * dx + dy * dy > j.breakDist * j.breakDist) {
        breakJoint(sim, j);
        changed = true;
      }
    }
    if (changed) { sim.joints = sim.joints.filter((j) => !j.broken); releaseFreeTrussMembers(sim); }
  }

  function cullLost(sim) {
    for (let i = sim.pieces.length - 1; i >= 0; i--) {
      const b = sim.pieces[i];
      if (b.position.y > WORLD.h + 400 || Math.abs(b.position.x - WORLD.w / 2) > WORLD.w * 1.6) {
        sim.lostMass = (sim.lostMass || 0) + b.mass;
        removePiece(sim, b);
      }
    }
  }

  function onCollisions(sim, e) {
    for (const pair of e.pairs) {
      let piece = null, other = null;
      if (pair.bodyA.plugin.piece) { piece = pair.bodyA; other = pair.bodyB; }
      else if (pair.bodyB.plugin.piece) { piece = pair.bodyB; other = pair.bodyA; }
      if (!piece) continue;
      const pc = piece.plugin.piece;
      const speed = Vector.magnitude(Vector.sub(piece.velocity, other.velocity || { x: 0, y: 0 }));
      const contact = pair.collision && pair.collision.supports && pair.collision.supports[0]
        ? { x: pair.collision.supports[0].x, y: pair.collision.supports[0].y } : { x: piece.position.x, y: piece.position.y };
      if (other.plugin.neighbor) {
        if (speed > 2.2 && sim.time - pc.lastHit > 400) {
          pc.lastHit = sim.time;
          const nb = other.plugin.neighbor;
          let pen = Math.round(Math.min(60, Math.max(10, speed * piece.mass * 9)) / 5) * 5;
          if (nb.fragile) pen *= 2;
          if (sim.netting) pen = Math.max(5, Math.round(pen / 10) * 5);
          sim.penalty += pen;
          sim.neighborPen += pen;
          nb.damage += pen;
          nb.flash = 1;
          nb.cracks.push({ x: contact.x, y: contact.y, r: 6 + pen / 3, seed: sim.rand() });
          sim.hits.push({ x: contact.x, y: contact.y, pen });
          pushFx(sim, { type: 'hit', x: contact.x, y: contact.y, pen, speed, kind: pc.kind, fragile: nb.fragile, netting: sim.netting });
        }
      } else if (other.plugin.car) {
        const car = other.plugin.car;
        if (speed > 1.8 && piece.mass > 0.05 && sim.time - car.lastHit > 500 && car.damage < 3) {
          car.lastHit = sim.time;
          car.damage++;
          sim.carHits++;
          sim.carPen += CAR_HIT_PENALTY;
          sim.penalty += CAR_HIT_PENALTY;
          pushFx(sim, { type: 'car', x: other.position.x, y: other.position.y - 14, pen: CAR_HIT_PENALTY, damage: car.damage });
        }
      } else if (speed > 2.5 && piece.mass > 0.08) {
        pushFx(sim, { type: 'impact', x: contact.x, y: contact.y, speed, mass: piece.mass, ground: other.label === 'ground', material: pc.material });
      }
    }
  }

  // Once the dust has mostly settled, let resting rubble go to sleep so the
  // pile stops jittering (Matter.js piles never fully come to rest otherwise).
  function allowSleep(sim) {
    if (sim.engine.enableSleeping) return;
    sim.engine.enableSleeping = true;
    for (const b of sim.pieces) b.sleepThreshold = 30;
    for (const b of sim.cars) b.sleepThreshold = 30;
    const fh = sim.level.floorH;
    const fallen = (b) => b && b.plugin.piece && b.position.y - b.plugin.piece.y0 > fh * 0.5;
    for (const j of sim.joints) if (fallen(j.c.bodyA) && (!j.c.bodyB || fallen(j.c.bodyB))) breakJoint(sim, j);
    sim.joints = sim.joints.filter((j) => !j.broken);
    releaseFreeTrussMembers(sim);
  }

  function kineticLevel(sim) {
    let s = 0;
    for (const b of sim.pieces) if (!b.isSleeping) s += b.speed;
    return sim.pieces.length ? s / sim.pieces.length : 0;
  }

  // ---------- Replay recording ----------
  function startRecording(sim) {
    sim.rec = {
      frames: [], fxLog: [], bodies: new Map(),
      charges: sim.charges.map((c) => ({ hostId: c.body.id, local: c.local, strength: c.strength, delay: c.delay, type: c.type })),
    };
    recordFrame(sim);
  }

  function recordFrame(sim) {
    const rec = sim.rec;
    const list = sim.pieces.concat(sim.cars);
    const data = new Float32Array(list.length * 4);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!rec.bodies.has(b.id)) rec.bodies.set(b.id, b);
      data[i * 4] = b.id; data[i * 4 + 1] = b.position.x; data[i * 4 + 2] = b.position.y; data[i * 4 + 3] = b.angle;
    }
    rec.frames.push({
      t: sim.time,
      data,
      people: sim.people.map((p) => ({ x: p.x, y: p.y, state: p.state, dir: p.dir, anim: p.anim, say: p.say, shirt: p.shirt, skin: p.skin, hat: p.hat })),
      nb: sim.neighbors.map((n) => [n.cracks.length, n.flash]),
      cars: sim.cars.map((c) => c.plugin.car.damage),
    });
  }

  function stopRecording(sim) {
    const rec = sim.rec;
    sim.rec = null;
    return rec;
  }

  // ---------- Scenes: what the renderer draws (live or from a replay frame) ----------
  function liveScene(sim) {
    return {
      level: sim.level, lot: sim.lot, zone: sim.zone, building: sim.building, netting: sim.netting, dropZone: sim.dropZone,
      pieces: sim.pieces,
      cars: sim.cars.map((c) => ({ position: c.position, angle: c.angle, car: c.plugin.car, damage: c.plugin.car.damage })),
      people: sim.people,
      neighbors: sim.neighbors,
      charges: sim.charges.filter((c) => !c.fired).map((c) => {
        const p = chargePos(c);
        return { x: p.x, y: p.y, angle: c.body.angle, strength: c.strength, delay: c.delay, type: c.type, ref: c };
      }),
    };
  }

  function frameScene(sim, rec, idx) {
    const fr = rec.frames[Math.max(0, Math.min(rec.frames.length - 1, idx))];
    const pieces = [], cars = [];
    const pose = new Map();
    for (let i = 0; i < fr.data.length; i += 4) {
      const body = rec.bodies.get(fr.data[i]);
      const proxy = { position: { x: fr.data[i + 1], y: fr.data[i + 2] }, angle: fr.data[i + 3], plugin: body.plugin };
      pose.set(fr.data[i], proxy);
      if (body.plugin.car) {
        const ci = sim.cars.indexOf(body);
        cars.push({ position: proxy.position, angle: proxy.angle, car: body.plugin.car, damage: fr.cars[ci] || 0 });
      } else pieces.push(proxy);
    }
    const charges = [];
    for (const c of rec.charges) {
      if (fr.t >= c.delay * 1000) continue;
      const h = pose.get(c.hostId);
      if (!h) continue;
      const p = Vector.add(h.position, Vector.rotate(c.local, h.angle));
      charges.push({ x: p.x, y: p.y, angle: h.angle, strength: c.strength, delay: c.delay, type: c.type });
    }
    const neighbors = sim.neighbors.map((n, i) => Object.assign({}, n, { cracks: n.cracks.slice(0, fr.nb[i][0]), flash: fr.nb[i][1] }));
    return {
      level: sim.level, lot: sim.lot, zone: sim.zone, building: sim.building, netting: sim.netting, dropZone: sim.dropZone,
      pieces, cars, people: fr.people, neighbors, charges, t: fr.t,
    };
  }

  // ---------- Load X-ray ----------
  // A tributary-area estimate of how much weight each column carries, and which
  // columns will lose their support once the planted charges cut the ones below.
  function willCut(ch) {
    const pc = ch.body.plugin.piece;
    return ch.type === 'cutter' || ch.strength >= pc.toughness;
  }

  function loadMap(sim) {
    if (sim.truss) return new Map();
    const L = sim.level, B = L.bays, F = L.floors, bw = L.bayW;
    const share = (i) => ((i === 0 || i === B) ? 0.5 : 1) * bw;
    // weight per unit width of one floor (slabs + cladding) and per column
    const floorMass = [];
    for (let f = 0; f < F; f++) {
      const m = sim.slabs[f].reduce((a, b) => a + b.mass, 0) + sim.walls[f].reduce((a, b) => a + b.mass, 0);
      floorMass[f] = m / (B * bw);
    }
    const colMass = sim.cols[0][0].mass;
    const roofLoad = new Array(B + 1).fill(0);
    for (const b of sim.pieces) {
      const pc = b.plugin.piece;
      if (!pc.roof) continue;
      const i = Math.max(0, Math.min(B, Math.round((b.position.x - sim.building.left) / bw)));
      roofLoad[i] += b.mass;
    }
    // which lines are cut, and from which floor up
    const cutFrom = new Array(B + 1).fill(Infinity);
    for (const ch of sim.charges) {
      const pc = ch.body.plugin.piece;
      if (pc.kind === 'column' && willCut(ch)) cutFrom[pc.line] = Math.min(cutFrom[pc.line], pc.floor);
    }
    const base = [];
    let maxBase = 0;
    for (let f = 0; f < F; f++) {
      base[f] = [];
      for (let i = 0; i <= B; i++) {
        let load = roofLoad[i] + (F - 1 - f) * colMass;
        for (let g = f; g < F; g++) load += floorMass[g] * share(i);
        base[f][i] = load;
        maxBase = Math.max(maxBase, load);
      }
    }
    const out = new Map();
    for (let f = 0; f < F; f++) {
      const load = base[f].slice();
      // load from cut lines is shed to the nearest surviving lines on that floor
      for (let i = 0; i <= B; i++) {
        if (cutFrom[i] > f) continue;
        const nbrs = [];
        for (let d = 1; d <= B && nbrs.length === 0; d++) {
          if (i - d >= 0 && cutFrom[i - d] > f) nbrs.push(i - d);
          if (i + d <= B && cutFrom[i + d] > f) nbrs.push(i + d);
        }
        for (const n of nbrs) load[n] += base[f][i] / nbrs.length;
      }
      for (let i = 0; i <= B; i++) {
        const col = sim.cols[f][i];
        out.set(col, {
          ratio: load[i] / maxBase,
          cut: cutFrom[i] === f,
          drops: cutFrom[i] < f, // supported by a column that will be cut
          overloaded: cutFrom[i] > f && load[i] > base[f][i] * 1.6,
        });
      }
    }
    return out;
  }

  // ---------- Scoring ----------
  function evaluate(sim, budget) {
    const gy = WORLD.groundY;
    const H = sim.building.height;
    const lot = sim.lot;
    let inMass = 0, total = 0;
    const tops = [];
    for (const b of sim.pieces) {
      total += b.mass;
      if (b.position.x >= lot.left && b.position.x <= lot.right) inMass += b.mass;
      tops.push({ h: gy - b.bounds.min.y, m: b.mass });
    }
    total += sim.lostMass || 0;
    tops.sort((a, b) => a.h - b.h);
    let acc = 0, rubble = 0;
    const target = (total - (sim.lostMass || 0)) * 0.97;
    for (const t of tops) { acc += t.m; rubble = t.h; if (acc >= target) break; }
    const targetRubble = Math.min(H * 0.35, sim.level.floorH * 1.6);
    const collapse = Math.max(0, Math.min(1, (H - rubble) / (H - targetRubble)));
    const contain = total > 0 ? inMass / total : 0;
    budget = budget || sim.level.budget || 1;
    const used = spent(sim);
    const underBudget = sim.charges.length === 0 ? 0 : Math.max(0, 1 - used / budget);

    // Directional jobs: how far the wreckage moved toward the drop zone.
    let direction = null, directionPts = 0, wrongWay = false;
    if (sim.dropZone) {
      let m = 0, mx = 0;
      for (const b of sim.pieces) { m += b.mass; mx += b.mass * b.position.x; }
      const shift = ((m ? mx / m : sim.comX0) - sim.comX0) * sim.dropZone.dir;
      direction = Math.max(0, Math.min(1, shift / (H * 0.3)));
      wrongWay = shift < -H * 0.05;
      directionPts = Math.round(direction * 250 * collapse);
    }
    const collapsePts = Math.round(collapse * (sim.dropZone ? 350 : 400));
    const containPts = Math.round(Math.pow(contain, 2) * (sim.dropZone ? 300 : 400) * collapse);
    const budgetPts = Math.round(underBudget * 200 * collapse);
    const penalty = Math.min(sim.penalty, 9999);
    const score = Math.max(0, collapsePts + containPts + directionPts + budgetPts - penalty);
    const success = collapse >= 0.6 && (!sim.dropZone || direction >= 0.4);
    let stars = 0;
    if (success) {
      stars = 1;
      if (score >= 650 && sim.hits.length <= 3 && sim.bystanders === 0) stars = 2;
      if (score >= 830 && penalty === 0) stars = 3;
    }
    return {
      collapse, contain, underBudget, spent: used, budget, rubbleHeight: rubble, hits: sim.hits.length,
      carHits: sim.carHits, bystanders: sim.bystanders,
      collapsePts, containPts, budgetPts, penalty, direction, directionPts, wrongWay, directional: !!sim.dropZone,
      neighborPen: sim.neighborPen, carPen: sim.carPen, bystanderPen: sim.bystanderPen,
      score, success, stars,
    };
  }

  const API = {
    WORLD, COL_W, SLAB_H, MATERIALS, CHARGE_TYPES, NETTING_COST, BYSTANDER_PENALTY,
    createSim, step, allowSleep, pieceAt, addCharge, chargePos, chargeCost, spent, detonate, evaluate, kineticLevel,
    updatePeople, personAt, shoo, shooAll, bystandersAtBlast, peopleInZone,
    startRecording, stopRecording, liveScene, frameScene, loadMap,
  };
  root.DemoPhysics = API;
  if (typeof module !== 'undefined') module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
