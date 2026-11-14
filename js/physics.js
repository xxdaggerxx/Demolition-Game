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
  // never carry load, so they only collide with the ground and the neighbours.
  const CAT = { struct: 0x1, wall: 0x2, ground: 0x4, neighbor: 0x8 };

  const MAT = {
    column: { density: 0.0030, friction: 0.9, frictionStatic: 1.2, restitution: 0.02, toughness: 3, breakDist: 4.5 },
    slab: { density: 0.0032, friction: 0.9, frictionStatic: 1.2, restitution: 0.02, toughness: 4, breakDist: 4.5 },
    wall: { density: 0.0012, friction: 0.8, frictionStatic: 1.0, restitution: 0.03, toughness: 1, breakDist: 3.5 },
    frag: { density: 0.0025, friction: 0.9, frictionStatic: 1.0, restitution: 0.05 },
  };

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
      rand: rng(seed || 12345),
      pieces: [], // all building bodies (incl. fragments)
      joints: [], // { c, breakDist }
      neighbors: [],
      charges: [],
      fx: [], // events for renderer/audio: explosion, impact, hit
      hits: [],
      penalty: 0,
      time: 0,
      groundY: WORLD.groundY,
      nextChargeId: 1,
    };

    const ground = Bodies.rectangle(WORLD.w / 2, WORLD.groundY + 200, WORLD.w * 4, 400, {
      isStatic: true, label: 'ground', friction: 1, frictionStatic: 1.5,
      collisionFilter: { category: CAT.ground, mask: 0xffff },
    });
    Composite.add(sim.world, ground);
    sim.ground = ground;

    buildTarget(sim);
    buildNeighbors(sim);

    Events.on(engine, 'collisionStart', (e) => onCollisions(sim, e));
    return sim;
  }

  function makePiece(sim, kind, x, y, w, h, extra) {
    const m = MAT[kind];
    const body = Bodies.rectangle(x, y, w, h, {
      density: m.density, friction: m.friction, frictionStatic: m.frictionStatic,
      restitution: m.restitution, frictionAir: 0.002, slop: 0.02, label: kind,
      chamfer: kind === 'frag' ? undefined : { radius: 1 },
      collisionFilter: kind === 'wall'
        ? { category: CAT.wall, mask: CAT.ground | CAT.neighbor }
        : { category: CAT.struct, mask: CAT.struct | CAT.ground | CAT.neighbor },
    });
    body.plugin.piece = Object.assign({
      kind, w, h, toughness: m.toughness || 0, lastHit: -1000, shade: 0.9 + sim.rand() * 0.2, y0: y, vx: 0, vy: 0,
    }, extra || {});
    sim.pieces.push(body);
    Composite.add(sim.world, body);
    return body;
  }

  // Rigidly joins two bodies (or a body to the world) at the given world points.
  function weld(sim, a, b, points, breakDist) {
    for (const p of points) {
      const c = Constraint.create({
        bodyA: a,
        pointA: Vector.sub(p, a.position),
        bodyB: b || undefined,
        pointB: b ? Vector.sub(p, b.position) : { x: p.x, y: p.y },
        length: 0, stiffness: 0.95, damping: 0.05,
        render: { visible: false },
      });
      Composite.add(sim.world, c);
      sim.joints.push({ c, breakDist });
    }
  }

  function buildTarget(sim) {
    const L = sim.level;
    const B = L.bays, F = L.floors, bw = L.bayW, fh = L.floorH;
    const colH = fh - SLAB_H;
    const left = L.x - (B * bw) / 2;
    const gy = WORLD.groundY;
    sim.building = { left, right: left + B * bw, height: F * fh, top: gy - F * fh };

    const slabs = []; // slabs[f][j]
    const cols = []; // cols[f][i]
    const walls = [];
    for (let f = 0; f < F; f++) {
      const base = gy - f * fh;
      cols[f] = [];
      for (let i = 0; i <= B; i++) {
        const x = left + i * bw;
        cols[f][i] = makePiece(sim, 'column', x, base - colH / 2, COL_W, colH, { floor: f, line: i });
      }
      slabs[f] = [];
      const sy = base - colH - SLAB_H / 2;
      for (let j = 0; j < B; j++) {
        const x0 = left + j * bw - (j === 0 ? COL_W / 2 : 0);
        const x1 = left + (j + 1) * bw + (j === B - 1 ? COL_W / 2 : 0);
        slabs[f][j] = makePiece(sim, 'slab', (x0 + x1) / 2, sy, x1 - x0, SLAB_H, { floor: f, bay: j, x0, x1 });
      }
      walls[f] = [];
      for (let j = 0; j < B; j++) {
        const x0 = left + j * bw + COL_W / 2 + 0.5;
        const x1 = left + (j + 1) * bw - COL_W / 2 - 0.5;
        const ww = x1 - x0, wh = colH - 3;
        const isLobby = f === 0 && (j === Math.floor(B / 2) || (B % 2 === 0 && j === B / 2 - 1));
        walls[f][j] = makePiece(sim, 'wall', (x0 + x1) / 2, base - colH / 2 - 1.5, ww, wh, {
          floor: f, bay: j, lobby: isLobby, style: (f + j) % 3,
        });
      }
    }

    const slabAt = (f, x) => {
      for (const s of slabs[f]) if (x >= s.plugin.piece.x0 - 0.01 && x <= s.plugin.piece.x1 + 0.01) return s;
      return null;
    };
    const cBreak = MAT.column.breakDist;
    for (let f = 0; f < F; f++) {
      const base = gy - f * fh;
      const topY = base - colH;
      for (let i = 0; i <= B; i++) {
        const col = cols[f][i];
        const x = col.position.x;
        // column top -> slab of this floor
        for (const dx of [-COL_W / 2 + 1.5, COL_W / 2 - 1.5]) {
          const s = slabAt(f, x + dx);
          if (s) weld(sim, col, s, [{ x: x + dx, y: topY }], cBreak);
        }
        // column bottom -> slab below, or the foundation
        for (const dx of [-COL_W / 2 + 1.5, COL_W / 2 - 1.5]) {
          if (f === 0) weld(sim, col, null, [{ x: x + dx, y: base }], cBreak);
          else {
            const s = slabAt(f - 1, x + dx);
            if (s) weld(sim, col, s, [{ x: x + dx, y: base }], cBreak);
          }
        }
      }
      // slab-to-slab moment connections
      for (let j = 0; j < B - 1; j++) {
        const a = slabs[f][j], b = slabs[f][j + 1];
        const x = a.plugin.piece.x1;
        const sy = topY - SLAB_H / 2;
        weld(sim, a, b, [{ x, y: sy - SLAB_H / 2 + 1.5 }, { x, y: sy + SLAB_H / 2 - 1.5 }], MAT.slab.breakDist);
      }
      // wall panels hang off the slab above and sit on the slab below
      for (let j = 0; j < B; j++) {
        const w = walls[f][j];
        const pc = w.plugin.piece;
        const x0 = w.position.x - pc.w / 2 + 3, x1 = w.position.x + pc.w / 2 - 3;
        weld(sim, w, slabs[f][j], [{ x: x0, y: topY }, { x: x1, y: topY }], MAT.wall.breakDist);
      }
    }
    sim.cols = cols; sim.slabs = slabs; sim.walls = walls;
    sim.totalMass = sim.pieces.reduce((s, b) => s + b.mass, 0);
  }

  function buildNeighbors(sim) {
    const gy = WORLD.groundY;
    for (const n of sim.level.neighbors) {
      const body = Bodies.rectangle(n.x, gy - n.h / 2, n.w, n.h, {
        isStatic: true, label: 'neighbor', friction: 0.8, collisionFilter: { category: CAT.neighbor, mask: 0xffff },
      });
      body.plugin.neighbor = { def: n, damage: 0, flash: 0, cracks: [] };
      Composite.add(sim.world, body);
      sim.neighbors.push(body);
    }
    const ns = sim.level.neighbors.slice().sort((a, b) => a.x - b.x);
    sim.lot = { left: ns[0].x + ns[0].w / 2, right: ns[ns.length - 1].x - ns[ns.length - 1].w / 2 };
  }

  // ---------- Charges ----------
  function pieceAt(sim, p) {
    const found = Query.point(sim.pieces.filter((b) => b.plugin.piece.kind !== 'frag'), p);
    if (!found.length) return null;
    // Prefer structural members over wall panels
    const order = { column: 0, slab: 1, wall: 2 };
    found.sort((a, b) => order[a.plugin.piece.kind] - order[b.plugin.piece.kind]);
    return found[0];
  }

  function addCharge(sim, body, p, strength, delay) {
    const local = Vector.rotate(Vector.sub(p, body.position), -body.angle);
    const ch = { id: sim.nextChargeId++, body, local, strength, delay, fired: false };
    sim.charges.push(ch);
    return ch;
  }

  function chargePos(ch) {
    return Vector.add(ch.body.position, Vector.rotate(ch.local, ch.body.angle));
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

  function shatter(sim, body, coarse) {
    const pc = body.plugin.piece;
    removeJointsOf(sim, body);
    Composite.remove(sim.world, body);
    sim.pieces.splice(sim.pieces.indexOf(body), 1);
    pc.destroyed = true;
    // A crushed (coarse) column mostly turns to dust: just two small chunks remain.
    const long = coarse ? 2 : 4, short = coarse ? 1 : 2;
    const nx = pc.w > pc.h ? long : short;
    const ny = pc.w > pc.h ? 1 : long;
    const fw = pc.w / nx, fh = pc.h / ny;
    const frags = [];
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < ny; k++) {
        const lx = -pc.w / 2 + fw * (i + 0.5), ly = -pc.h / 2 + fh * (k + 0.5);
        const wp = Vector.add(body.position, Vector.rotate({ x: lx, y: ly }, body.angle));
        const s = coarse ? 0.45 + sim.rand() * 0.2 : 0.55 + sim.rand() * 0.35;
        const f = makePiece(sim, 'frag', wp.x, wp.y, Math.max(3, fw * s), Math.max(3, fh * s), {
          parentKind: pc.kind, shade: pc.shade,
        });
        Body.setAngle(f, body.angle + (sim.rand() - 0.5) * 0.6);
        Body.setVelocity(f, body.velocity);
        frags.push(f);
      }
    }
    return frags;
  }

  function detonate(sim, ch) {
    ch.fired = true;
    const p = chargePos(ch);
    const s = ch.strength;
    const R = 26 + s * 13;
    const host = ch.body;
    if (sim.pieces.includes(host)) {
      if (s >= host.plugin.piece.toughness) shatter(sim, host, false);
      else removeJointsOf(sim, host);
    }
    // Break joints near the blast
    for (const j of sim.joints) {
      const { a } = jointPos(j);
      const d = Vector.magnitude(Vector.sub(a, p));
      if (d < R * 0.5 || (d < R * 0.8 && sim.rand() < (s / 10) * (1 - d / R))) breakJoint(sim, j);
    }
    sim.joints = sim.joints.filter((j) => !j.broken);
    // Blast wave: velocity kick that falls off with distance and is resisted by mass
    for (const b of sim.pieces) {
      const d = Vector.sub(b.position, p);
      const dist = Vector.magnitude(d);
      if (dist > R) continue;
      const fall = 1 - dist / R;
      const dir = dist > 0.001 ? Vector.div(d, dist) : { x: sim.rand() - 0.5, y: -0.5 };
      const kick = Math.min(18, (0.35 * Math.pow(s, 1.5) * fall * fall) / Math.sqrt(Math.max(b.mass, 0.15)));
      const jitter = { x: (sim.rand() - 0.5) * kick * 0.3, y: (sim.rand() - 0.5) * kick * 0.3 };
      Body.setVelocity(b, Vector.add(b.velocity, Vector.add(Vector.mult(dir, kick), jitter)));
      Body.setAngularVelocity(b, b.angularVelocity + (sim.rand() - 0.5) * 0.04 * s * fall);
    }
    sim.fx.push({ type: 'explosion', x: p.x, y: p.y, strength: s, radius: R });
  }

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
      sim.acc -= STEP_MS;
      n++;
    }
    if (n === 12) sim.acc = 0; // too slow to keep up: drop time rather than spiral
    for (const n of sim.neighbors) n.plugin.neighbor.flash = Math.max(0, n.plugin.neighbor.flash - ms / 400);
  }

  // Progressive collapse: when a falling part of the structure is suddenly
  // stopped, the dynamic load crushes the lowest surviving column in each line
  // and shakes loose the connections of whatever was hit.
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
    const list = sim.pieces.slice();
    let jointsChanged = false;
    for (const b of list) {
      const pc = b.plugin.piece;
      if (pc.destroyed) continue;
      const dvx = b.velocity.x - pc.vx, dvy = b.velocity.y - pc.vy;
      const dv = Math.sqrt(dvx * dvx + dvy * dvy);
      if (dv < 2.6) continue;
      if (dv > 3.5 && pc.kind !== 'frag' && sim.rand() < 0.15) {
        for (const j of sim.joints) if (j.c.bodyA === b || j.c.bodyB === b) { breakJoint(sim, j); jointsChanged = true; }
      }
    }
    // Cladding tears off once its floor has dropped.
    for (const row of sim.walls) {
      for (const w of row) {
        const pc = w.plugin.piece;
        if (pc.detached || w.position.y - pc.y0 < sim.level.floorH * 0.3) continue;
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
          sim.fx.push({ type: 'crush', x: b.position.x, y: b.position.y });
          shatter(sim, b, true);
          crushed++;
        }
      }
    }
    if (jointsChanged) sim.joints = sim.joints.filter((j) => !j.broken);
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
    if (changed) sim.joints = sim.joints.filter((j) => !j.broken);
  }

  function cullLost(sim) {
    for (let i = sim.pieces.length - 1; i >= 0; i--) {
      const b = sim.pieces[i];
      if (b.position.y > WORLD.h + 400 || Math.abs(b.position.x - WORLD.w / 2) > WORLD.w * 1.6) {
        removeJointsOf(sim, b);
        Composite.remove(sim.world, b);
        sim.pieces.splice(i, 1);
        sim.lostMass = (sim.lostMass || 0) + b.mass;
        b.plugin.piece.destroyed = true;
      }
    }
  }

  function onCollisions(sim, e) {
    for (const pair of e.pairs) {
      let piece = null, other = null;
      if (pair.bodyA.plugin.piece) { piece = pair.bodyA; other = pair.bodyB; }
      else if (pair.bodyB.plugin.piece) { piece = pair.bodyB; other = pair.bodyA; }
      if (!piece) continue;
      const speed = Vector.magnitude(Vector.sub(piece.velocity, other.velocity || { x: 0, y: 0 }));
      const contact = pair.collision && pair.collision.supports && pair.collision.supports[0]
        ? { x: pair.collision.supports[0].x, y: pair.collision.supports[0].y } : { x: piece.position.x, y: piece.position.y };
      if (other.label === 'neighbor') {
        const pc = piece.plugin.piece;
        if (speed > 2.2 && sim.time - pc.lastHit > 400) {
          pc.lastHit = sim.time;
          const pen = Math.round(Math.min(60, Math.max(10, speed * piece.mass * 9)) / 5) * 5;
          sim.penalty += pen;
          const nb = other.plugin.neighbor;
          nb.damage += pen;
          nb.flash = 1;
          nb.cracks.push({ x: contact.x - other.position.x, y: contact.y - other.position.y, r: 6 + pen / 3, seed: sim.rand() });
          sim.hits.push({ x: contact.x, y: contact.y, pen });
          sim.fx.push({ type: 'hit', x: contact.x, y: contact.y, pen, speed, kind: pc.kind });
        }
      } else if (speed > 2.5 && piece.mass > 0.08) {
        sim.fx.push({ type: 'impact', x: contact.x, y: contact.y, speed, mass: piece.mass, ground: other.label === 'ground' });
      }
    }
  }

  // Once the dust has mostly settled, let resting rubble go to sleep so the
  // pile stops jittering (Matter.js piles never fully come to rest otherwise).
  function allowSleep(sim) {
    if (sim.engine.enableSleeping) return;
    sim.engine.enableSleeping = true;
    for (const b of sim.pieces) b.sleepThreshold = 30;
    // Joints still holding wreckage together just fight the contacts in the
    // pile; anything that has fallen is free rubble now.
    const fh = sim.level.floorH;
    const fallen = (b) => b && b.plugin.piece && b.position.y - b.plugin.piece.y0 > fh * 0.5;
    for (const j of sim.joints) if (fallen(j.c.bodyA) || fallen(j.c.bodyB)) breakJoint(sim, j);
    sim.joints = sim.joints.filter((j) => !j.broken);
  }

  function kineticLevel(sim) {
    let s = 0;
    for (const b of sim.pieces) if (!b.isSleeping) s += b.speed;
    return sim.pieces.length ? s / sim.pieces.length : 0;
  }

  // ---------- Scoring ----------
  function evaluate(sim) {
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
    // Rubble height = height below which 97% of the building mass lies
    tops.sort((a, b) => a.h - b.h);
    let acc = 0, rubble = 0;
    const target = (total - (sim.lostMass || 0)) * 0.97;
    for (const t of tops) { acc += t.m; rubble = t.h; if (acc >= target) break; }
    const targetRubble = Math.min(H * 0.35, sim.level.floorH * 1.6);
    const collapse = Math.max(0, Math.min(1, (H - rubble) / (H - targetRubble)));
    const contain = total > 0 ? inMass / total : 0;
    const used = sim.charges.length;
    const totalStrength = sim.charges.reduce((s, c) => s + c.strength, 0);
    const maxStrength = sim.level.maxCharges * 10;
    const efficiency = used === 0 ? 0 : Math.max(0, 1 - totalStrength / maxStrength);

    const collapsePts = Math.round(collapse * 400);
    const containPts = Math.round(Math.pow(contain, 2) * 400 * collapse);
    const effPts = Math.round(efficiency * 200 * collapse);
    const penalty = Math.min(sim.penalty, 9999);
    const score = Math.max(0, collapsePts + containPts + effPts - penalty);
    const success = collapse >= 0.6;
    let stars = 0;
    if (success) {
      stars = 1;
      if (score >= 650 && sim.hits.length <= 3) stars = 2;
      if (score >= 850 && sim.hits.length === 0) stars = 3;
    }
    return {
      collapse, contain, efficiency, rubbleHeight: rubble, hits: sim.hits.length,
      collapsePts, containPts, effPts, penalty, score, success, stars,
    };
  }

  const API = {
    WORLD, COL_W, SLAB_H, createSim, step, allowSleep, pieceAt, addCharge, chargePos, detonate, evaluate, kineticLevel,
  };
  root.DemoPhysics = API;
  if (typeof module !== 'undefined') module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
