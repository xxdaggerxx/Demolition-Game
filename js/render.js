// Canvas renderer: background, building, neighbours, charges and particle effects.
(function (root) {
  const { WORLD } = root.DemoPhysics;

  const FACADES = [
    { wall: '#e9d8a6', trim: '#c9b27c' },
    { wall: '#d98a6a', trim: '#b5654a' },
    { wall: '#cfd8e3', trim: '#9fb0c4' },
    { wall: '#f2c57c', trim: '#d39f4f' },
    { wall: '#b8c4a8', trim: '#8d9c7a' },
  ];

  const DEFAULT_VIEW = { x0: 290, x1: 1310, y0: 95, y1: 838 };

  function shadeHex(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
    const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
    const b = Math.min(255, Math.round((n & 255) * f));
    return `rgb(${r},${g},${b})`;
  }

  function seeded(seed) {
    let s = seed;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.particles = [];
      this.texts = [];
      this.rings = [];
      this.flash = 0;
      this.shake = 0;
      this.time = 0;
      this.clouds = [];
      const r = seeded(7);
      for (let i = 0; i < 14; i++) {
        this.clouds.push({ x: r() * 3000 - 700, y: 60 + r() * 260, s: 0.6 + r() * 0.9, v: 4 + r() * 10 });
      }
      this.resize();
    }

    resize() {
      // Remember the player's camera so a resize (e.g. a phone's address bar
      // sliding away, or rotating the device) doesn't throw it away.
      const keep = this.base && this.base.view === (this.view || this.base.view) && this.zoom
        ? { zoom: this.zoom, c: this.toWorld(this.playCenter().x, this.playCenter().y), moved: this.isZoomed() } : null;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = window.innerWidth, h = window.innerHeight;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.dpr = dpr;
      this.cw = w; this.ch = h;
      // Fit the interesting part of the world (the street) between the HUD and
      // the toolbar so nothing clickable is ever hidden behind the UI.
      const top = this.insetTop || 0, bottom = this.insetBottom || 0;
      const view = this.view || DEFAULT_VIEW;
      const availH = Math.max(200, h - top - bottom);
      // Phones held upright: frame just the job site so the building isn't tiny;
      // the neighbours are a drag away.
      let fit = view;
      if (this.focus && h > w * 1.15) fit = { x0: Math.max(view.x0, this.focus.x0), x1: Math.min(view.x1, this.focus.x1), y0: view.y0, y1: view.y1 };
      const scale = Math.min(w / (fit.x1 - fit.x0), availH / (fit.y1 - fit.y0));
      // Base framing; the player's pinch/pan camera sits on top of it.
      this.base = {
        scale,
        ox: w / 2 - ((fit.x0 + fit.x1) / 2) * scale,
        // sit the street just above the toolbar; spare space goes to the sky
        oy: top + availH - view.y1 * scale,
        view,
      };
      this.resetCamera();
      if (keep && keep.moved) {
        this.zoom = keep.zoom;
        this.scale = this.base.scale * keep.zoom;
        const pc = this.playCenter();
        this.ox = pc.x - keep.c.x * this.scale;
        this.oy = pc.y - keep.c.y * this.scale;
        this.clampCamera();
      }
      this.skyline = null;
    }

    // Frame the camera on a level: both neighbours plus some headroom.
    setLevel(level) {
      if (!level) { this.view = null; this.focus = null; this.resize(); return; }
      const ns = level.neighbors;
      const bw = level.shape === 'bridge' ? level.span + 170 : level.shape === 'needle' ? level.saucerW
        : level.shape === 'cooling' ? level.baseHalf * 2 : level.shape === 'stadium' ? level.span
          : level.shape === 'suspension' ? level.mainSpan + level.sideSpan * 2 + 160
            : level.shape === 'mast' ? Math.max(...level.guys.map((g) => g.dx)) * 2 + 40
        : level.structure === 'truss' ? level.baseHalf * 2 : level.bays * level.bayW;
      const th = level.shape === 'bridge' ? level.deckH + level.trussH + 40 : level.shape === 'needle' ? level.height + 120
        : level.shape === 'stadium' ? level.roofH + level.camber + 30 : level.shape === 'suspension' ? level.deckH + level.towerH + 30
          : level.shape === 'mast' ? level.height + 70 : level.shape === 'cooling' ? level.height + 40
        : level.structure === 'truss' ? level.height + 50
          : level.floors * level.floorH + (level.roof === 'spire' ? (level.spireH || 96) + 4 : level.roof ? 50 : 0);
      let x0 = Math.min(level.x - bw / 2, ...ns.map((n) => n.x - n.w / 2)) - 70;
      let x1 = Math.max(level.x + bw / 2, ...ns.map((n) => n.x + n.w / 2)) + 70;
      if (level.dropZone) { x0 = Math.min(x0, level.dropZone[0] - 70); x1 = Math.max(x1, level.dropZone[1] + 70); }
      if (level.viewX1) x1 = Math.max(x1, level.viewX1);
      // steam rising from a cooling tower
      this.steam = level.shape === 'cooling' ? { x: level.x, y: WORLD.groundY - level.height } : null;
      const topY = WORLD.groundY - Math.max(th,
        ...ns.map((n) => n.h + (n.style === 'church' ? 170 : 0)));
      let y0 = topY - 60;
      const y1 = WORLD.groundY + (level.terrain ? level.terrain.lowY - WORLD.groundY + 18 : 18);
      // keep a sensible minimum frame so small levels don't look over-zoomed
      if (y1 - y0 < 420) y0 = y1 - 420;
      if (x1 - x0 < 760) { const c = (x0 + x1) / 2; x0 = c - 380; x1 = c + 380; }
      this.view = { x0, x1, y0, y1 };
      // the job site: building plus a little street, or the whole drop zone / river
      let f0 = level.x - bw / 2 - 50, f1 = level.x + bw / 2 + 50;
      if (level.dropZone) { f0 = Math.min(f0, level.dropZone[0] - 20); f1 = Math.max(f1, level.dropZone[1] + 20); }
      if (level.water) { f0 = Math.min(f0, level.water[0] - 20); f1 = Math.max(f1, level.water[1] + 20); }
      if (level.pool) { f0 = Math.min(f0, level.pool[0] - 30); f1 = Math.max(f1, level.pool[1] + 30); }
      this.focus = { x0: f0, x1: f1 };
      this.resize();
      this.resetCamera();
    }

    setInsets(top, bottom) {
      if (top === this.insetTop && bottom === this.insetBottom) return;
      this.insetTop = top; this.insetBottom = bottom;
      this.resize();
    }

    // ---------------- Camera (pinch-zoom / pan) ----------------
    resetCamera() {
      this.zoom = 1;
      this.scale = this.base.scale;
      this.ox = this.base.ox;
      this.oy = this.base.oy;
    }

    // Zoom by `factor` keeping the world point under screen point (sx, sy) fixed.
    zoomAt(sx, sy, factor) {
      const z = Math.max(0.6, Math.min(5, this.zoom * factor));
      const w = this.toWorld(sx, sy);
      this.zoom = z;
      this.scale = this.base.scale * z;
      this.ox = sx - w.x * this.scale;
      this.oy = sy - w.y * this.scale;
      this.clampCamera();
    }

    panBy(dx, dy) {
      this.ox += dx;
      this.oy += dy;
      this.clampCamera();
    }

    // Keep the middle of the screen over the level so it can't be lost off-screen.
    // Middle of the area not covered by the HUD and toolbar.
    playCenter() {
      const top = this.insetTop || 0, bottom = this.insetBottom || 0;
      return { x: this.cw / 2, y: (top + this.ch - bottom) / 2 };
    }

    clampCamera() {
      const v = this.base.view;
      const pc = this.playCenter();
      const c = this.toWorld(pc.x, pc.y);
      const cx = Math.max(v.x0, Math.min(v.x1, c.x));
      const cy = Math.max(v.y0, Math.min(WORLD.groundY, c.y));
      this.ox += (c.x - cx) * this.scale;
      this.oy += (c.y - cy) * this.scale;
    }

    isZoomed() {
      return Math.abs(this.zoom - 1) > 0.01 || Math.abs(this.ox - this.base.ox) > 1 || Math.abs(this.oy - this.base.oy) > 1;
    }

    toWorld(sx, sy) {
      return { x: (sx - this.ox) / this.scale, y: (sy - this.oy) / this.scale };
    }

    // ---------------- Effects ----------------
    addExplosion(x, y, s) {
      const n = 10 + s * 3;
      this.flash = Math.min(1, this.flash + 0.25 + s * 0.05);
      this.shake = Math.min(28, this.shake + 4 + s * 1.8);
      this.rings.push({ x, y, r: 4, max: 30 + s * 16, life: 1 });
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = (0.5 + Math.random()) * (40 + s * 22);
        this.particles.push({ t: 'fire', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 6 + s * 1.5 + Math.random() * 6, life: 0, max: 0.25 + Math.random() * 0.3 });
      }
      for (let i = 0; i < n * 1.5; i++) {
        const a = Math.random() * Math.PI * 2, sp = Math.random() * (30 + s * 14);
        this.particles.push({ t: 'smoke', x: x + (Math.random() - 0.5) * 10, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 15, r: 8 + Math.random() * 10 + s, grow: 18 + s * 2, life: 0, max: 1.6 + Math.random() * 1.8, g: 0.35 + Math.random() * 0.25 });
      }
      for (let i = 0; i < n * 1.2; i++) {
        const a = Math.random() * Math.PI * 2, sp = (0.4 + Math.random()) * (120 + s * 45);
        this.particles.push({ t: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.3 + Math.random() * 0.5 });
      }
      for (let i = 0; i < n; i++) {
        const a = -Math.PI * Math.random(), sp = (0.3 + Math.random()) * (60 + s * 25);
        this.particles.push({ t: 'chip', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 20, sz: 1.5 + Math.random() * 3, life: 0, max: 1 + Math.random() });
      }
    }

    addDust(x, y, amount, big, red) {
      for (let i = 0; i < amount; i++) {
        this.particles.push({ red,
          t: 'dust', x: x + (Math.random() - 0.5) * 20, y: y + (Math.random() - 0.5) * 8,
          vx: (Math.random() - 0.5) * (big ? 70 : 40), vy: -Math.random() * (big ? 25 : 15),
          r: (big ? 14 : 7) + Math.random() * 10, grow: big ? 16 : 10, life: 0, max: 2.5 + Math.random() * 3, g: 0.3 + Math.random() * 0.2,
        });
      }
    }

    addText(x, y, text, color) {
      this.texts.push({ x, y, text, color, life: 0, max: 1.4 });
    }

    clearFx() { this.particles = []; this.texts = []; this.rings = []; this.flash = 0; this.shake = 0; }

    update(dt) {
      this.time += dt;
      if (this.steam && dt > 0 && Math.random() < dt * 6) {
        this.particles.push({ t: 'steam', x: this.steam.x + (Math.random() - 0.5) * 120, y: this.steam.y + 4, vx: 8 + Math.random() * 6, vy: -18 - Math.random() * 10,
          r: 14 + Math.random() * 10, grow: 12, life: 0, max: 4 + Math.random() * 2, g: 1 });
      }
      for (const c of this.clouds) { c.x += c.v * dt; if (c.x > 2400) c.x = -800; }
      const ps = this.particles;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.life += dt;
        if (p.life >= p.max) { ps.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.t === 'smoke' || p.t === 'dust' || p.t === 'steam') {
          p.vx *= 1 - 1.2 * dt; p.vy = p.vy * (1 - 1.2 * dt) - 6 * dt; p.r += p.grow * dt * (1 - p.life / p.max);
        } else if (p.t === 'fire') {
          p.vx *= 1 - 5 * dt; p.vy *= 1 - 5 * dt; p.vy -= 30 * dt;
        } else if (p.t === 'spark') {
          p.vy += 300 * dt; p.vx *= 1 - 1.5 * dt;
        } else if (p.t === 'glass') {
          p.vy += 500 * dt; p.rot += p.vr * dt;
          if (p.y > WORLD.groundY - 1) { p.y = WORLD.groundY - 1; p.vy *= -0.4; p.vx *= 0.5; }
        } else if (p.t === 'chip') {
          p.vy += 600 * dt; p.rot += p.vr * dt;
          if (p.y > WORLD.groundY - 1) { p.y = WORLD.groundY - 1; p.vy *= -0.3; p.vx *= 0.6; }
        }
      }
      if (ps.length > 1600) ps.splice(0, ps.length - 1600);
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const r = this.rings[i];
        r.life -= dt * 2.2; r.r += (r.max - r.r) * Math.min(1, dt * 10);
        if (r.life <= 0) this.rings.splice(i, 1);
      }
      for (let i = this.texts.length - 1; i >= 0; i--) {
        const t = this.texts[i];
        t.life += dt; t.y -= 30 * dt;
        if (t.life > t.max) this.texts.splice(i, 1);
      }
      this.flash = Math.max(0, this.flash - dt * 3);
      this.shake = Math.max(0, this.shake - dt * 30);
    }

    addGlass(x, y, w, h) {
      for (let i = 0; i < 14; i++) {
        this.particles.push({
          t: 'glass', x: x + (Math.random() - 0.5) * w, y: y + (Math.random() - 0.5) * h,
          vx: (Math.random() - 0.5) * 160, vy: -Math.random() * 120, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 30,
          sz: 2 + Math.random() * 3, life: 0, max: 0.8 + Math.random() * 0.8,
        });
      }
    }

    addCut(x, y, vertical) {
      this.flash = Math.min(1, this.flash + 0.1);
      this.shake = Math.min(28, this.shake + 2);
      for (let i = 0; i < 26; i++) {
        const a = vertical ? (Math.random() < 0.5 ? 0 : Math.PI) + (Math.random() - 0.5) * 0.9 : -Math.PI / 2 + (Math.random() - 0.5) * 2;
        const sp = 80 + Math.random() * 220;
        this.particles.push({ t: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.3 + Math.random() * 0.4 });
      }
      for (let i = 0; i < 5; i++) {
        this.particles.push({ t: 'smoke', x, y, vx: (Math.random() - 0.5) * 20, vy: -10, r: 5, grow: 10, life: 0, max: 1.2, g: 0.5 });
      }
    }

    // ---------------- Drawing ----------------
    // state.scene comes from DemoPhysics.liveScene() or frameScene() (replays).
    draw(state) {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.drawSky(ctx);
      const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
      ctx.save();
      ctx.translate(this.ox + sx, this.oy + sy);
      ctx.scale(this.scale, this.scale);
      this.drawClouds(ctx);
      this.drawSkyline(ctx);
      const sc = state.scene;
      this.drawGround(ctx, sc, state);
      if (sc) {
        this.drawNeighbors(ctx, sc);
        this.drawBuilding(ctx, sc, state);
        if (state.xray) this.drawXray(ctx, sc, state.xray);
        this.drawCars(ctx, sc);
        if (sc.level.water) this.drawWater(ctx, sc);
        this.drawCharges(ctx, sc, state);
        if (state.hover) this.drawHover(ctx, state.hover, state);
        this.drawPeople(ctx, sc, state);
      }
      this.drawParticles(ctx);
      ctx.restore();
      if (this.flash > 0) {
        ctx.fillStyle = `rgba(255,240,200,${this.flash * 0.55})`;
        ctx.fillRect(0, 0, this.cw, this.ch);
      }
    }

    drawSky(ctx) {
      const g = ctx.createLinearGradient(0, 0, 0, this.ch);
      g.addColorStop(0, '#4fb3ff');
      g.addColorStop(0.6, '#a9dcff');
      g.addColorStop(1, '#e8f6ff');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.cw, this.ch);
      const sx = this.ox + 1330 * this.scale, sy = this.oy + 140 * this.scale, r = 55 * this.scale;
      const sg = ctx.createRadialGradient(sx, sy, r * 0.3, sx, sy, r * 3);
      sg.addColorStop(0, 'rgba(255,250,200,0.9)');
      sg.addColorStop(1, 'rgba(255,250,200,0)');
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(sx, sy, r * 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff3a8';
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
    }

    drawClouds(ctx) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (const c of this.clouds) {
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.scale(c.s, c.s);
        ctx.beginPath();
        ctx.arc(0, 0, 30, 0, Math.PI * 2);
        ctx.arc(32, -12, 36, 0, Math.PI * 2);
        ctx.arc(70, 0, 28, 0, Math.PI * 2);
        ctx.arc(36, 12, 30, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    drawSkyline(ctx) {
      if (!this.skyline) {
        const r = seeded(42);
        const far = [], near = [];
        let x = -2000;
        while (x < 3600) { const w = 40 + r() * 70; far.push({ x, w, h: 120 + r() * 260 }); x += w + 4; }
        x = -2000;
        while (x < 3600) { const w = 50 + r() * 90; near.push({ x, w, h: 60 + r() * 160 }); x += w + r() * 30; }
        this.skyline = { far, near };
      }
      const gy = WORLD.groundY;
      ctx.fillStyle = '#b6d4ea';
      for (const b of this.skyline.far) ctx.fillRect(b.x, gy - b.h, b.w, b.h);
      ctx.fillStyle = '#9cc3dd';
      for (const b of this.skyline.near) ctx.fillRect(b.x, gy - b.h, b.w, b.h);
      ctx.fillStyle = '#7cc66b';
      ctx.beginPath();
      ctx.moveTo(-2000, gy);
      for (let x = -2000; x <= 3600; x += 40) ctx.lineTo(x, gy - 30 - Math.sin(x * 0.006) * 22 - Math.sin(x * 0.017) * 8);
      ctx.lineTo(3600, gy);
      ctx.fill();
    }

    drawGround(ctx, sc, state) {
      const gy = WORLD.groundY;
      const T = sc && sc.level.terrain;
      if (T) {
        // the valley beyond the slope, then the hillside itself
        ctx.fillStyle = '#6fae5f';
        ctx.fillRect(T.slopeX0, gy - 30, 5000, T.lowY - gy + 30);
        const top = (x) => (x <= T.slopeX0 ? gy : x >= T.slopeX1 ? T.lowY : gy + ((x - T.slopeX0) / (T.slopeX1 - T.slopeX0)) * (T.lowY - gy));
        ctx.fillStyle = '#8a5a3b';
        ctx.beginPath(); ctx.moveTo(-3000, gy); ctx.lineTo(T.slopeX0, gy); ctx.lineTo(T.slopeX1, T.lowY); ctx.lineTo(5000, T.lowY);
        ctx.lineTo(5000, 3000); ctx.lineTo(-3000, 3000); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#5cb85c'; ctx.lineWidth = 10;
        ctx.beginPath(); ctx.moveTo(-3000, gy + 4); ctx.lineTo(T.slopeX0, gy + 4); ctx.lineTo(T.slopeX1, T.lowY + 4); ctx.lineTo(5000, T.lowY + 4); ctx.stroke();
        // road at the bottom of the hill
        ctx.fillStyle = '#5b5f66'; ctx.fillRect(T.slopeX1, T.lowY, 5000, 12);
        ctx.fillStyle = '#e9e3c9';
        for (let x = T.slopeX1 + 10; x < 3000; x += 26) ctx.fillRect(x, T.lowY + 5, 12, 2);
        void top;
      } else {
        ctx.fillStyle = '#8a5a3b';
        ctx.fillRect(-3000, gy, 8000, 3000);
        ctx.fillStyle = '#6f4529';
        for (let x = -3000; x < 5000; x += 46) ctx.fillRect(x, gy + 26 + ((x / 46) % 3) * 12, 18, 6);
        ctx.fillStyle = '#5cb85c';
        ctx.fillRect(-3000, gy, 8000, 9);
        ctx.fillStyle = '#4a9d4a';
        ctx.fillRect(-3000, gy + 9, 8000, 3);
      }
      if (!sc) return;
      if (sc.level.stadium) this.drawStadiumBowl(ctx, sc.level);
      const { left, right } = sc.lot;
      const z = sc.level.terrain ? { left: sc.zone.left, right: Math.min(sc.zone.right, sc.level.terrain.slopeX0) } : sc.zone;
      // street (asphalt) between the neighbours, then the dirt lot
      ctx.fillStyle = '#5b5f66';
      ctx.fillRect(z.left, gy, z.right - z.left, 12);
      ctx.fillStyle = '#e9e3c9';
      for (let x = z.left + 6; x < z.right - 10; x += 26) {
        if (x > left - 8 && x < right) continue;
        ctx.fillRect(x, gy + 5, 12, 2);
      }
      ctx.fillStyle = '#b89a72';
      ctx.fillRect(left, gy, right - left, 12);
      if (state.showLot) {
        // danger zone (where bystanders must not stand) and the lot
        ctx.fillStyle = 'rgba(255,60,40,0.06)';
        ctx.fillRect(z.left, 0, z.right - z.left, gy);
        ctx.fillStyle = 'rgba(80,220,120,0.10)';
        ctx.fillRect(left, 0, right - left, gy);
        ctx.setLineDash([10, 8]);
        ctx.strokeStyle = 'rgba(40,160,80,0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(left, 40); ctx.lineTo(left, gy); ctx.moveTo(right, 40); ctx.lineTo(right, gy); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (sc.dropZone) this.drawDropZone(ctx, sc.dropZone, state);
      if (sc.level.water) {
        const [w0, w1] = sc.level.water;
        ctx.fillStyle = '#6b5a45';
        ctx.fillRect(w0, gy, w1 - w0, 12);
      }
      if (sc.abutments) this.drawAbutments(ctx, sc);
      if (sc.level.pool) this.drawPool(ctx, sc.level.pool);
      for (const x of [left, right]) {
        ctx.save();
        ctx.translate(x, gy - 16);
        ctx.fillStyle = '#333'; ctx.fillRect(-2, 0, 4, 16);
        ctx.fillStyle = '#ffd23f'; ctx.fillRect(-9, -2, 18, 7);
        ctx.fillStyle = '#222';
        ctx.fillRect(-9, -2, 4, 7); ctx.fillRect(-1, -2, 4, 7); ctx.fillRect(7, -2, 2, 7);
        ctx.restore();
      }
    }

    drawDropZone(ctx, dz, state) {
      const gy = WORLD.groundY;
      const w = dz.right - dz.left;
      // gravel target area with yellow/black edges
      ctx.fillStyle = '#c9a66b';
      ctx.fillRect(dz.left, gy, w, 12);
      ctx.fillStyle = '#ffd23f';
      for (let x = dz.left; x < dz.right; x += 24) ctx.fillRect(x, gy + 1, 12, 3);
      // chevrons pointing the way the building must fall
      const pulse = 0.55 + 0.45 * Math.sin(this.time * 4);
      ctx.fillStyle = `rgba(255,120,30,${state.showLot ? 0.35 + pulse * 0.4 : 0.25})`;
      for (let x = dz.left + 30; x < dz.right - 20; x += 46) {
        ctx.beginPath();
        if (dz.dir < 0) { ctx.moveTo(x, gy - 20); ctx.lineTo(x + 14, gy - 32); ctx.lineTo(x + 20, gy - 32); ctx.lineTo(x + 6, gy - 20); ctx.lineTo(x + 20, gy - 8); ctx.lineTo(x + 14, gy - 8); }
        else { ctx.moveTo(x + 20, gy - 20); ctx.lineTo(x + 6, gy - 32); ctx.lineTo(x, gy - 32); ctx.lineTo(x + 14, gy - 20); ctx.lineTo(x, gy - 8); ctx.lineTo(x + 6, gy - 8); }
        ctx.closePath(); ctx.fill();
      }
      // sign
      const sx = dz.dir < 0 ? dz.left + 40 : dz.right - 40;
      ctx.fillStyle = '#4a4e57';
      ctx.fillRect(sx - 2, gy - 70, 4, 70);
      ctx.fillStyle = '#ff7b00'; ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(sx - 38, gy - 96, 76, 30, 5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('DROP ZONE', sx, gy - 84);
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.fillText(dz.dir < 0 ? '◀ ◀ ◀' : '▶ ▶ ▶', sx, gy - 70);
    }

    // X-ray overlay: columns coloured by the share of the building's weight they carry.
    drawXray(ctx, sc, loads) {
      const b = sc.building;
      ctx.save();
      ctx.fillStyle = 'rgba(10,25,45,0.72)';
      ctx.fillRect(b.left - 14, b.top - 60, b.right - b.left + 28, WORLD.groundY - b.top + 60);
      // faint slabs
      for (const p of sc.pieces) {
        const pc = p.plugin.piece;
        if (pc.kind !== 'slab' && !pc.roof) continue;
        ctx.save(); ctx.translate(p.position.x, p.position.y); ctx.rotate(p.angle);
        ctx.strokeStyle = 'rgba(120,200,255,0.6)'; ctx.lineWidth = 1;
        ctx.strokeRect(-pc.w / 2, -pc.h / 2, pc.w, pc.h);
        ctx.restore();
      }
      const heat = (r) => {
        const t = Math.max(0, Math.min(1, r));
        const h = 120 - 120 * t; // green -> red
        return `hsl(${h},90%,55%)`;
      };
      ctx.textAlign = 'center';
      for (const [col, info] of loads) {
        const pc = col.plugin.piece;
        ctx.save(); ctx.translate(col.position.x, col.position.y); ctx.rotate(col.angle);
        if (info.drops) {
          ctx.fillStyle = 'rgba(200,120,255,0.35)';
          ctx.fillRect(-pc.w / 2, -pc.h / 2, pc.w, pc.h);
          ctx.strokeStyle = '#c77dff'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2]);
          ctx.strokeRect(-pc.w / 2, -pc.h / 2, pc.w, pc.h); ctx.setLineDash([]);
          ctx.fillStyle = '#e0b3ff'; ctx.font = 'bold 12px system-ui, sans-serif';
          ctx.fillText('↓', 0, 4);
        } else if (info.cut) {
          ctx.fillStyle = 'rgba(255,255,255,0.15)';
          ctx.fillRect(-pc.w / 2, -pc.h / 2, pc.w, pc.h);
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(-pc.w / 2, -4); ctx.lineTo(pc.w / 2, 4); ctx.stroke();
        } else {
          ctx.fillStyle = heat(info.ratio);
          if (info.overloaded) ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.time * 10);
          ctx.fillRect(-pc.w / 2, -pc.h / 2, pc.w, pc.h);
          ctx.globalAlpha = 1;
          if (info.overloaded) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(-pc.w / 2, -pc.h / 2, pc.w, pc.h); }
        }
        ctx.restore();
        if (!info.drops && !info.cut) {
          ctx.font = 'bold 8px system-ui, sans-serif';
          ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.fillStyle = '#fff';
          const label = Math.round(info.ratio * 100) + '%';
          ctx.strokeText(label, col.position.x, col.position.y + 3);
          ctx.fillText(label, col.position.x, col.position.y + 3);
        }
      }
      ctx.restore();
    }

    drawNeighbors(ctx, sc) {
      for (const nb of sc.neighbors) {
        const d = nb.def;
        const x0 = d.x - d.w / 2, y0 = WORLD.groundY - d.h;
        ctx.save();
        if (d.style === 'church') this.drawChurch(ctx, nb, x0, y0);
        else if (d.style === 'gothic') this.drawGothicNeighbor(ctx, d, x0, y0);
        else if (d.style === 'warehouse') this.drawWarehouse(ctx, d, x0, y0);
        else this.drawPlainNeighbor(ctx, d, x0, y0);
        // protective netting, if bought for this job
        if (sc.netting) {
          const inner = d.x < sc.level.x ? x0 + d.w - 16 : x0;
          ctx.fillStyle = 'rgba(40,40,40,0.18)';
          ctx.fillRect(inner, y0, 16, d.h);
          ctx.strokeStyle = 'rgba(30,30,30,0.5)';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          for (let y = y0; y < WORLD.groundY; y += 6) { ctx.moveTo(inner, y); ctx.lineTo(inner + 16, y + 6); ctx.moveTo(inner + 16, y); ctx.lineTo(inner, y + 6); }
          ctx.stroke();
        }
        // panes shattered by ground vibration
        if (nb.panes && nb.panes.length) {
          const slots = root.DemoPhysics.windowSlots(nb);
          for (const i of nb.panes) {
            const s = slots[i];
            if (!s) continue;
            ctx.fillStyle = '#10161f'; ctx.fillRect(s.x, s.y, s.w, s.h);
            ctx.strokeStyle = 'rgba(220,240,255,0.9)'; ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(s.x + s.w * 0.5, s.y + s.h * 0.45);
            ctx.lineTo(s.x, s.y + 2); ctx.moveTo(s.x + s.w * 0.5, s.y + s.h * 0.45); ctx.lineTo(s.x + s.w, s.y + s.h * 0.3);
            ctx.moveTo(s.x + s.w * 0.5, s.y + s.h * 0.45); ctx.lineTo(s.x + s.w * 0.3, s.y + s.h);
            ctx.moveTo(s.x + s.w * 0.5, s.y + s.h * 0.45); ctx.lineTo(s.x + s.w, s.y + s.h * 0.9);
            ctx.stroke();
          }
        }
        // cracks
        ctx.strokeStyle = 'rgba(30,20,20,0.75)';
        ctx.lineWidth = 1.6;
        for (const c of nb.cracks) {
          const r = seeded(Math.floor(c.seed * 1e6) + 1);
          for (let k = 0; k < 4; k++) {
            ctx.beginPath();
            ctx.moveTo(c.x, c.y);
            let px = c.x, py = c.y;
            const a = r() * Math.PI * 2;
            for (let s = 0; s < 3; s++) {
              px += Math.cos(a + (r() - 0.5)) * c.r / 3;
              py += Math.sin(a + (r() - 0.5)) * c.r / 3;
              ctx.lineTo(px, py);
            }
            ctx.stroke();
          }
        }
        if (nb.flash > 0) {
          ctx.fillStyle = `rgba(255,40,40,${nb.flash * 0.45})`;
          ctx.fillRect(x0, y0, d.w, d.h);
          if (nb.steeple) ctx.fillRect(d.x - nb.steeple.w / 2, y0 - nb.steeple.h, nb.steeple.w, nb.steeple.h);
        }
        ctx.restore();
      }
    }

    drawPlainNeighbor(ctx, d, x0, y0) {
      ctx.fillStyle = d.color;
      ctx.strokeStyle = shadeHex(d.color, 0.55);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(x0, y0, d.w, d.h, 4); ctx.fill();
      const cols = Math.max(2, Math.floor(d.w / 34));
      const rows = Math.floor((d.h - 30) / 38);
      const ww = d.w / cols;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const wx = x0 + c * ww + ww * 0.22, wy = y0 + 22 + r * 38;
          if (d.style === 'glass') {
            ctx.fillStyle = 'rgba(220,245,255,0.55)';
            ctx.fillRect(x0 + c * ww + 3, wy - 6, ww - 6, 30);
          } else {
            ctx.fillStyle = '#2d4a6b';
            ctx.fillRect(wx, wy, ww * 0.56, 22);
            ctx.fillStyle = 'rgba(255,255,255,0.45)';
            ctx.fillRect(wx + 2, wy + 2, ww * 0.16, 8);
          }
        }
      }
      if (d.style === 'brick') {
        ctx.strokeStyle = 'rgba(0,0,0,0.08)';
        ctx.lineWidth = 1;
        for (let y = y0 + 8; y < WORLD.groundY; y += 8) { ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + d.w, y); ctx.stroke(); }
      }
      ctx.fillStyle = shadeHex(d.color, 0.45);
      ctx.fillRect(d.x - 12, WORLD.groundY - 34, 24, 34);
      ctx.fillStyle = shadeHex(d.color, 0.7);
      ctx.fillRect(x0 - 4, y0 - 8, d.w + 8, 10);
      ctx.fillRect(x0 + d.w * 0.15, y0 - 22, 22, 14);
      ctx.strokeStyle = shadeHex(d.color, 0.55);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(x0, y0, d.w, d.h, 4); ctx.stroke();
    }

    drawGothicNeighbor(ctx, d, x0, y0) {
      const dark = shadeHex(d.color, 0.6);
      ctx.fillStyle = d.color; ctx.strokeStyle = dark; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.rect(x0, y0, d.w, d.h); ctx.fill(); ctx.stroke();
      // pinnacles along the roofline
      ctx.fillStyle = dark;
      for (let x = x0; x <= x0 + d.w; x += d.w / 6) {
        ctx.beginPath(); ctx.moveTo(x - 5, y0); ctx.lineTo(x, y0 - 22); ctx.lineTo(x + 5, y0); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#5d6b78';
      ctx.fillRect(x0, y0 - 4, d.w, 5);
      // rows of pointed windows
      const cols = Math.floor(d.w / 26), rows = Math.floor((d.h - 40) / 44);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const cx = x0 + (c + 0.5) * (d.w / cols), top = y0 + 18 + r * 44, ww = 9;
        ctx.fillStyle = '#2f4a66';
        ctx.beginPath(); ctx.moveTo(cx - ww / 2, top + 26); ctx.lineTo(cx - ww / 2, top + 6); ctx.quadraticCurveTo(cx - ww / 2, top, cx, top - 3);
        ctx.quadraticCurveTo(cx + ww / 2, top, cx + ww / 2, top + 6); ctx.lineTo(cx + ww / 2, top + 26); ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1;
      for (let x = x0 + d.w / cols; x < x0 + d.w - 1; x += d.w / cols) { ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, WORLD.groundY); ctx.stroke(); }
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.arc(d.x, WORLD.groundY - 26, 12, Math.PI, 0); ctx.lineTo(d.x + 12, WORLD.groundY); ctx.lineTo(d.x - 12, WORLD.groundY); ctx.fill();
    }

    drawChurch(ctx, nb, x0, y0) {
      const d = nb.def;
      const stone = d.color, dark = shadeHex(d.color, 0.55);
      ctx.fillStyle = stone;
      ctx.strokeStyle = dark;
      ctx.lineWidth = 3;
      // nave with a pitched roof
      ctx.beginPath(); ctx.rect(x0, y0, d.w, d.h); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#7a4e3a';
      ctx.beginPath(); ctx.moveTo(x0 - 6, y0 + 2); ctx.lineTo(d.x, y0 - 34); ctx.lineTo(x0 + d.w + 6, y0 + 2); ctx.closePath(); ctx.fill(); ctx.stroke();
      // stone courses
      ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 1;
      for (let y = y0 + 10; y < WORLD.groundY; y += 10) { ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + d.w, y); ctx.stroke(); }
      // steeple
      const sw = nb.steeple.w, sh = nb.steeple.h, sx = d.x - sw / 2, sy = y0 - sh;
      ctx.fillStyle = stone; ctx.strokeStyle = dark; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.rect(sx, sy, sw, sh); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#5d6b78';
      ctx.beginPath(); ctx.moveTo(sx - 4, sy); ctx.lineTo(d.x, sy - 46); ctx.lineTo(sx + sw + 4, sy); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(d.x - 1.5, sy - 60, 3, 16); ctx.fillRect(d.x - 6, sy - 55, 12, 3);
      // bell opening
      ctx.fillStyle = '#3a2a1a';
      ctx.beginPath(); ctx.arc(d.x, sy + 30, 9, Math.PI, 0); ctx.lineTo(d.x + 9, sy + 44); ctx.lineTo(d.x - 9, sy + 44); ctx.fill();
      ctx.fillStyle = '#d4a017'; ctx.beginPath(); ctx.arc(d.x, sy + 36, 5, Math.PI, 0); ctx.fill();
      // stained-glass arched windows
      const n = 3;
      for (let i = 0; i < n; i++) {
        const wx = x0 + (i + 0.5) * (d.w / n);
        const wy = y0 + 40;
        const g = ctx.createLinearGradient(wx, wy - 20, wx, wy + 40);
        g.addColorStop(0, '#e63946'); g.addColorStop(0.5, '#457b9d'); g.addColorStop(1, '#ffbe0b');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(wx, wy, 10, Math.PI, 0); ctx.lineTo(wx + 10, wy + 40); ctx.lineTo(wx - 10, wy + 40); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = dark; ctx.lineWidth = 2; ctx.stroke();
      }
      // door
      ctx.fillStyle = '#5a3825';
      ctx.beginPath(); ctx.arc(d.x, WORLD.groundY - 30, 13, Math.PI, 0); ctx.lineTo(d.x + 13, WORLD.groundY); ctx.lineTo(d.x - 13, WORLD.groundY); ctx.fill();
      // "fragile" plaque
      ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(d.x - 30, y0 + 96, 60, 16, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#3a2a1a'; ctx.font = 'bold 9px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('HISTORIC ×2', d.x, y0 + 107);
    }

    pieceColors(material, kind) {
      if (material === 'brick') return kind === 'column' ? '#b5523b' : '#7a5236';
      if (material === 'sandstone') return kind === 'column' ? '#d8b779' : '#b8935a';
      if (material === 'marble') return kind === 'column' ? '#f3efe6' : '#d9d2c3';
      if (material === 'iron') return '#6b4f3a';
      if (material === 'steel') return kind === 'column' ? '#6f8496' : '#5f7486';
      return kind === 'column' ? '#adb2bc' : '#979ca6';
    }

    drawBuilding(ctx, sc, state) {
      const level = sc.level;
      this.curLevel = level;
      const facade = FACADES[(level.id - 1) % FACADES.length];
      const material = level.material || 'concrete';
      for (const b of sc.pieces) if (b.plugin.piece.kind === 'wall') this.drawWall(ctx, b, facade, material);
      const hoverBody = state.hover && state.hover.body;
      for (const b of sc.pieces) {
        const pc = b.plugin.piece;
        if (pc.kind === 'wall') continue;
        ctx.save();
        ctx.translate(b.position.x, b.position.y);
        ctx.rotate(b.angle);
        if (pc.kind === 'tank') { this.drawTank(ctx, pc, hoverBody === b); ctx.restore(); continue; }
        if (pc.kind === 'sign') { this.drawSign(ctx, pc, hoverBody === b); ctx.restore(); continue; }
        if (pc.kind === 'spire') { this.drawSpire(ctx, pc, hoverBody === b); ctx.restore(); continue; }
        if (pc.kind === 'belfry') { this.drawBelfry(ctx, pc, hoverBody === b); ctx.restore(); continue; }
        if (pc.kind === 'beam') { this.drawBeam(ctx, pc, hoverBody === b); ctx.restore(); continue; }
        if (pc.kind === 'anchor') { this.drawAnchor(ctx, pc, hoverBody === b); ctx.restore(); continue; }
        if (pc.kind === 'crown') { this.drawCrown(ctx, pc, hoverBody === b); ctx.restore(); continue; }
        if (pc.kind === 'saucer') { this.drawSaucer(ctx, pc, hoverBody === b); ctx.restore(); continue; }
        if (pc.kind === 'needle') { this.drawNeedleTip(ctx, pc, hoverBody === b); ctx.restore(); continue; }
        if (pc.kind === 'frag') {
          let base;
          if (pc.parentKind === 'glass') {
            ctx.fillStyle = 'rgba(190,235,255,0.85)';
            ctx.strokeStyle = 'rgba(255,255,255,0.9)';
            ctx.lineWidth = 0.8;
            ctx.beginPath(); ctx.moveTo(-pc.w / 2, pc.h / 2); ctx.lineTo(0, -pc.h / 2); ctx.lineTo(pc.w / 2, pc.h / 2); ctx.closePath();
            ctx.fill(); ctx.stroke();
            ctx.restore();
            continue;
          }
          if (pc.parentKind === 'wall') base = material === 'glass' ? '#9fd8f0' : facade.wall;
          else if (pc.parentKind === 'tank') base = '#7d8b99';
          else if (pc.parentKind === 'sign') base = '#ffd23f';
          else if (pc.parentKind === 'spire') base = '#4f6d7a';
          else if (pc.parentKind === 'belfry') base = '#f3efe6';
          else if (pc.parentKind === 'beam') base = pc.stone ? '#b9ad98' : this.beamColors(material)[0];
          else if (pc.parentKind === 'saucer') base = '#dfe6ec';
          else if (pc.parentKind === 'needle') base = '#c9d2da';
          else base = this.pieceColors(material, pc.parentKind === 'slab' ? 'slab' : 'column');
          ctx.fillStyle = shadeHex(base, pc.shade * 0.95);
          ctx.strokeStyle = '#4a4e57';
          ctx.lineWidth = 1.2;
          ctx.fillRect(-pc.w / 2, -pc.h / 2, pc.w, pc.h);
          ctx.strokeRect(-pc.w / 2, -pc.h / 2, pc.w, pc.h);
          if (pc.cut) { ctx.fillStyle = '#ff9f1c'; ctx.fillRect(-pc.w / 2, pc.h > pc.w ? -pc.h / 2 : -pc.h / 2, pc.h > pc.w ? pc.w : 2, pc.h > pc.w ? 2 : pc.h); }
          ctx.restore();
          continue;
        }
        const isHover = hoverBody === b;
        ctx.fillStyle = shadeHex(this.pieceColors(material, pc.kind), pc.shade);
        ctx.strokeStyle = isHover ? '#ff3b30' : '#474b54';
        ctx.lineWidth = isHover ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.roundRect(-pc.w / 2, -pc.h / 2, pc.w, pc.h, 2);
        ctx.fill(); ctx.stroke();
        if (pc.archUnder) {
          const w = pc.w, y = pc.h / 2, d = 50;
          ctx.fillStyle = shadeHex('#cfae72', pc.shade);
          ctx.beginPath();
          ctx.moveTo(-w / 2, y); ctx.lineTo(w / 2, y); ctx.lineTo(w / 2, y + d);
          ctx.ellipse(0, y + d, w / 2 - 7, d - 8, 0, 0, Math.PI, true);
          ctx.lineTo(-w / 2, y + d); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(0, y + d, w / 2 - 7, d - 8, 0, 0, Math.PI, true); ctx.stroke();
          // parapet and track on top
          ctx.fillStyle = '#8a6a3a';
          ctx.fillRect(-w / 2, -pc.h / 2 - 4, w, 3);
        }
        if (material === 'steel') {
          // I-beam flanges and rivets
          ctx.strokeStyle = 'rgba(30,40,50,0.45)'; ctx.lineWidth = 1;
          ctx.beginPath();
          if (pc.kind === 'column') { ctx.moveTo(-pc.w / 2 + 3, -pc.h / 2 + 1); ctx.lineTo(-pc.w / 2 + 3, pc.h / 2 - 1); ctx.moveTo(pc.w / 2 - 3, -pc.h / 2 + 1); ctx.lineTo(pc.w / 2 - 3, pc.h / 2 - 1); }
          else { ctx.moveTo(-pc.w / 2 + 1, -pc.h / 2 + 2.5); ctx.lineTo(pc.w / 2 - 1, -pc.h / 2 + 2.5); ctx.moveTo(-pc.w / 2 + 1, pc.h / 2 - 2.5); ctx.lineTo(pc.w / 2 - 1, pc.h / 2 - 2.5); }
          ctx.stroke();
          ctx.fillStyle = 'rgba(30,40,50,0.5)';
          if (pc.kind === 'slab') for (let x = -pc.w / 2 + 6; x < pc.w / 2 - 3; x += 10) { ctx.beginPath(); ctx.arc(x, 0, 1, 0, Math.PI * 2); ctx.fill(); }
        } else if (material === 'brick') {
          ctx.strokeStyle = 'rgba(255,230,200,0.35)'; ctx.lineWidth = 0.8;
          ctx.beginPath();
          if (pc.kind === 'column') for (let y = -pc.h / 2 + 5; y < pc.h / 2; y += 5) { ctx.moveTo(-pc.w / 2 + 1, y); ctx.lineTo(pc.w / 2 - 1, y); }
          else for (let x = -pc.w / 2 + 8; x < pc.w / 2; x += 8) { ctx.moveTo(x, -pc.h / 2 + 1); ctx.lineTo(x, pc.h / 2 - 1); }
          ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          if (pc.kind === 'column') ctx.fillRect(-pc.w / 2 + 2, -pc.h / 2 + 2, 2.5, pc.h - 4);
          else ctx.fillRect(-pc.w / 2 + 2, -pc.h / 2 + 2, pc.w - 4, 2);
        }
        ctx.restore();
      }
    }

    drawSpire(ctx, pc, hover) {
      const w = pc.w, h = pc.h;
      // pointed slate roof with gilded finial
      ctx.fillStyle = '#4f6d7a';
      ctx.strokeStyle = hover ? '#ff3b30' : '#2b3d45';
      ctx.lineWidth = hover ? 2.5 : 2;
      ctx.beginPath(); ctx.moveTo(-w / 2, h / 2); ctx.lineTo(0, -h / 2 + 8); ctx.lineTo(w / 2, h / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
      for (let i = 1; i < 6; i++) { const y = h / 2 - i * (h - 8) / 6; const hw = (w / 2) * (1 - i / 6); ctx.beginPath(); ctx.moveTo(-hw, y); ctx.lineTo(hw, y); ctx.stroke(); }
      ctx.fillStyle = '#e9c46a';
      ctx.fillRect(-1.5, -h / 2, 3, 10);
      ctx.beginPath(); ctx.arc(0, -h / 2 + 1, 3, 0, Math.PI * 2); ctx.fill();
      // little dormer clock-room windows
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(-w * 0.18, h / 2 - 22, 6, 9); ctx.fillRect(w * 0.18 - 6, h / 2 - 22, 6, 9);
    }

    drawBelfry(ctx, pc, hover) {
      const w = pc.w, h = pc.h;
      ctx.fillStyle = '#f3efe6';
      ctx.strokeStyle = hover ? '#ff3b30' : '#9a8f7a';
      ctx.lineWidth = hover ? 2.5 : 1.5;
      ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2 + 6, w, h - 6, 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#d9d2c3';
      ctx.fillRect(-w / 2 - 3, -h / 2 + 2, w + 6, 6);
      // arched bell openings
      ctx.fillStyle = '#5a5248';
      for (let i = 0; i < 3; i++) {
        const x = -w / 2 + (i + 0.5) * (w / 3);
        ctx.beginPath(); ctx.arc(x, -2, 5, Math.PI, 0); ctx.lineTo(x + 5, h / 2 - 4); ctx.lineTo(x - 5, h / 2 - 4); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#d4a017';
      ctx.beginPath(); ctx.arc(0, 2, 3, Math.PI, 0); ctx.fill();
    }

    // Wrought-iron lattice girder (a rectangle along its local x axis)
    beamColors(material) {
      if (material === 'whitesteel') return ['#eef2f5', '#8795a1'];
      if (material === 'redsteel') return ['#d2492f', '#7a2415'];
      return ['#6b4f3a', '#3e2c20'];
    }

    // Lattice girder (a rectangle along its local x axis)
    drawBeam(ctx, pc, hover) {
      const l = pc.w, t = pc.h;
      const [col, dark] = this.beamColors(pc.material);
      if (pc.hidden) return;
      if (pc.cable || pc.hanger) {
        ctx.strokeStyle = hover ? '#ff3b30' : pc.guy ? '#5a5f66' : '#2b2f36';
        ctx.lineWidth = hover ? 3 : Math.max(1.4, t * 0.8);
        ctx.beginPath(); ctx.moveTo(-l / 2 - 1, 0); ctx.lineTo(l / 2 + 1, 0); ctx.stroke();
        return;
      }
      if (pc.mastSeg) {
        // radio masts are painted in red and white bands
        const band = Math.floor((pc.band || 0) / 1) % 2 === 0 ? '#e63946' : '#f8f8f8';
        ctx.fillStyle = band; ctx.strokeStyle = hover ? '#ff3b30' : '#7a2415'; ctx.lineWidth = hover ? 2 : 0.8;
        ctx.fillRect(-l / 2, -t / 2, l, t); ctx.strokeRect(-l / 2, -t / 2, l, t);
        return;
      }
      if (pc.shell || pc.coolLeg || pc.ring) {
        ctx.fillStyle = shadeHex(pc.ring ? '#b9bec6' : '#cfd3d9', pc.shade);
        ctx.strokeStyle = hover ? '#ff3b30' : '#7d838c'; ctx.lineWidth = hover ? 2.5 : 1.3;
        ctx.fillRect(-l / 2 - 1, -t / 2, l + 2, t); ctx.strokeRect(-l / 2 - 1, -t / 2, l + 2, t);
        if (pc.coolLeg) { ctx.strokeStyle = '#7d838c'; ctx.beginPath(); ctx.moveTo(-l / 2, -t / 2); ctx.lineTo(l / 2, t / 2); ctx.stroke(); }
        return;
      }
      if (pc.roofDeck) {
        ctx.fillStyle = '#f1f4f7'; ctx.strokeStyle = hover ? '#ff3b30' : '#8795a1'; ctx.lineWidth = hover ? 2.2 : 1.2;
        ctx.fillRect(-l / 2 - 1, -t / 2, l + 2, t); ctx.strokeRect(-l / 2 - 1, -t / 2, l + 2, t);
        ctx.fillStyle = '#d2dbe3'; for (let x = -l / 2 + 8; x < l / 2; x += 14) ctx.fillRect(x, -t / 2 + 2, 3, t - 4);
        return;
      }
      if (pc.pylon || pc.tower) {
        const steel = pc.tower;
        ctx.fillStyle = steel ? '#c0392b' : shadeHex('#c9ccd1', pc.shade);
        ctx.strokeStyle = hover ? '#ff3b30' : steel ? '#7a2415' : '#6f747c'; ctx.lineWidth = hover ? 2.5 : 1.5;
        ctx.fillRect(-l / 2, -t / 2, l, t); ctx.strokeRect(-l / 2, -t / 2, l, t);
        ctx.strokeStyle = steel ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1; ctx.beginPath();
        for (let x = -l / 2 + 10; x < l / 2 - 2; x += 14) { ctx.moveTo(x, -t / 2); ctx.lineTo(x + 7, t / 2); }
        ctx.stroke();
        return;
      }
      if (pc.pier) {
        // masonry pier
        ctx.fillStyle = shadeHex('#b9ad98', pc.shade);
        ctx.strokeStyle = hover ? '#ff3b30' : '#6f6553';
        ctx.lineWidth = hover ? 2.5 : 1.5;
        ctx.fillRect(-l / 2, -t / 2, l, t); ctx.strokeRect(-l / 2, -t / 2, l, t);
        ctx.strokeStyle = 'rgba(80,70,50,0.45)'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = -l / 2 + 10, k = 0; x < l / 2; x += 10, k++) {
          ctx.moveTo(x, -t / 2); ctx.lineTo(x, t / 2);
          ctx.moveTo(x - 5, k % 2 ? -t / 2 : 0); ctx.lineTo(x - 5, k % 2 ? 0 : t / 2);
        }
        ctx.stroke();
        return;
      }
      if (pc.arch) {
        ctx.strokeStyle = col; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(0, t / 2, l / 2 - 6, 26, 0, 0, Math.PI); ctx.stroke();
      }
      if (pc.mast) {
        ctx.fillStyle = dark; ctx.fillRect(-l / 2, -1.5, l, 3);
        ctx.fillStyle = '#e63946'; ctx.fillRect(l / 2 - 10, -8, 10, 6);
        return;
      }
      if (pc.road) {
        // road deck: steel girder with asphalt on top
        ctx.fillStyle = col; ctx.strokeStyle = hover ? '#ff3b30' : dark; ctx.lineWidth = hover ? 2.2 : 1.2;
        ctx.fillRect(-l / 2, -t / 2, l, t); ctx.strokeRect(-l / 2, -t / 2, l, t);
        ctx.fillStyle = '#3d4046';
        ctx.fillRect(-l / 2, -t / 2, l, 4);
        ctx.fillStyle = '#f1e9c9';
        for (let x = -l / 2 + 6; x < l / 2 - 8; x += 20) ctx.fillRect(x, -t / 2 + 1.5, 9, 1);
        return;
      }
      ctx.strokeStyle = hover ? '#ff3b30' : dark;
      ctx.lineWidth = hover ? 2.2 : 1.4;
      ctx.fillStyle = pc.material === 'iron' ? 'rgba(107,79,58,0.25)' : col;
      ctx.fillRect(-l / 2, -t / 2, l, t);
      ctx.beginPath(); ctx.moveTo(-l / 2, -t / 2); ctx.lineTo(l / 2, -t / 2); ctx.moveTo(-l / 2, t / 2); ctx.lineTo(l / 2, t / 2); ctx.stroke();
      ctx.strokeStyle = hover ? '#ff3b30' : (pc.material === 'iron' ? col : dark); ctx.lineWidth = 1;
      ctx.beginPath();
      const step = Math.max(5, t * 1.2);
      for (let x = -l / 2, up = true; x < l / 2 - 0.1; x += step, up = !up) {
        ctx.moveTo(x, up ? -t / 2 : t / 2); ctx.lineTo(Math.min(l / 2, x + step), up ? t / 2 : -t / 2);
      }
      ctx.stroke();
      if (pc.deck) {
        ctx.strokeStyle = dark; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-l / 2, -t / 2 - 6); ctx.lineTo(l / 2, -t / 2 - 6);
        for (let x = -l / 2; x <= l / 2; x += 6) { ctx.moveTo(x, -t / 2); ctx.lineTo(x, -t / 2 - 6); }
        ctx.stroke();
      }
    }

    // Flying-saucer observation deck
    drawSaucer(ctx, pc, hover) {
      const w = pc.w, h = pc.h;
      const edge = hover ? '#ff3b30' : '#6b7884';
      ctx.lineWidth = hover ? 2.5 : 1.6; ctx.strokeStyle = edge;
      // underside flare
      ctx.fillStyle = '#c3ccd4';
      ctx.beginPath(); ctx.moveTo(-w / 2 + 6, 0); ctx.lineTo(w / 2 - 6, 0); ctx.lineTo(28, h / 2); ctx.lineTo(-28, h / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
      // main disc
      ctx.fillStyle = '#f4f6f8';
      ctx.beginPath(); ctx.ellipse(0, -2, w / 2, 9, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // window band
      ctx.fillStyle = '#274a66';
      ctx.beginPath(); ctx.roundRect(-w / 2 + 14, -5, w - 28, 5, 2); ctx.fill();
      ctx.fillStyle = '#ffd23f';
      for (let x = -w / 2 + 20; x < w / 2 - 20; x += 12) ctx.fillRect(x, -4, 6, 3);
      // roof dome with the orange cap
      ctx.fillStyle = '#ff7b00';
      ctx.beginPath(); ctx.ellipse(0, -8, w * 0.3, 7, 0, Math.PI, 0); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e9edf0';
      ctx.beginPath(); ctx.ellipse(0, -11, w * 0.14, 5, 0, Math.PI, 0); ctx.fill(); ctx.stroke();
    }

    drawNeedleTip(ctx, pc, hover) {
      const w = pc.w, h = pc.h;
      ctx.fillStyle = '#d6dde3'; ctx.strokeStyle = hover ? '#ff3b30' : '#6b7884'; ctx.lineWidth = hover ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(-w / 2, h / 2); ctx.lineTo(-0.8, -h / 2); ctx.lineTo(0.8, -h / 2); ctx.lineTo(w / 2, h / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = Math.floor(this.time * 2) % 2 ? '#ff2d2d' : '#7a1010';
      ctx.beginPath(); ctx.arc(0, -h / 2, 2.2, 0, Math.PI * 2); ctx.fill();
    }

    // River: translucent water over whatever has sunk into it
    drawWater(ctx, sc) {
      const [x0, x1] = sc.level.water;
      const gy = WORLD.groundY, d = root.DemoPhysics.WATER_DEPTH;
      const g = ctx.createLinearGradient(0, gy - d, 0, gy + 12);
      g.addColorStop(0, 'rgba(70,160,225,0.62)'); g.addColorStop(1, 'rgba(20,80,150,0.85)');
      ctx.fillStyle = g;
      ctx.fillRect(x0, gy - d, x1 - x0, d + 12);
      ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let x = x0; x <= x1; x += 6) {
        const y = gy - d + Math.sin(x * 0.07 + this.time * 2.2) * 1.4;
        if (x === x0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
      for (let x = x0 + 20; x < x1 - 20; x += 46) {
        const o = Math.sin(this.time * 1.3 + x) * 6;
        ctx.beginPath(); ctx.moveTo(x + o, gy - d + 9); ctx.lineTo(x + o + 14, gy - d + 9); ctx.stroke();
      }
    }

    drawAbutments(ctx, sc) {
      const gy = WORLD.groundY;
      for (const a of sc.abutments) {
        const inner = a.x - a.side * a.w / 2, outer = a.x + a.side * a.w / 2, top = gy - a.h + 10;
        // approach ramp behind the abutment
        ctx.fillStyle = '#7cc66b';
        ctx.beginPath(); ctx.moveTo(outer, top + 4); ctx.lineTo(outer + a.side * 230, gy); ctx.lineTo(outer, gy); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#3d4046'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(outer, top + 2); ctx.lineTo(outer + a.side * 230, gy - 2); ctx.stroke();
        // stone block
        ctx.fillStyle = '#b9ad98'; ctx.strokeStyle = '#6f6553'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.rect(Math.min(inner, outer), top, a.w, gy - top + 12); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = 'rgba(80,70,50,0.4)'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let y = top + 12; y < gy; y += 12) { ctx.moveTo(Math.min(inner, outer), y); ctx.lineTo(Math.max(inner, outer), y); }
        ctx.stroke();
        // bearing shelf reaching to the bridge end, and the road on top
        ctx.fillStyle = '#8f8573';
        ctx.fillRect(Math.min(inner, inner - a.side * 12), top + 5, 12, 6);
        ctx.fillStyle = '#3d4046';
        ctx.fillRect(Math.min(inner, outer), top - 4, a.w, 5);
      }
    }

    drawAnchor(ctx, pc, hover) {
      ctx.fillStyle = shadeHex('#8d939b', pc.shade); ctx.strokeStyle = hover ? '#ff3b30' : '#4a4e57'; ctx.lineWidth = hover ? 2.5 : 1.5;
      ctx.beginPath(); ctx.roundRect(-pc.w / 2, -pc.h / 2, pc.w, pc.h, 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(0, -pc.h / 2 + 3, 3, 0, Math.PI * 2); ctx.fill();
    }

    drawCrown(ctx, pc, hover) {
      ctx.fillStyle = '#2f2f2f'; ctx.strokeStyle = hover ? '#ff3b30' : '#111'; ctx.lineWidth = hover ? 2.5 : 1.2;
      ctx.fillRect(-pc.w / 2, -pc.h / 2, pc.w, pc.h); ctx.strokeRect(-pc.w / 2, -pc.h / 2, pc.w, pc.h);
      ctx.fillStyle = '#a8473a'; ctx.fillRect(-pc.w / 2 + 4, -pc.h / 2 + 3, pc.w - 8, pc.h - 6);
    }

    drawWarehouse(ctx, d, x0, y0) {
      const dark = shadeHex(d.color, 0.55);
      ctx.fillStyle = d.color; ctx.strokeStyle = dark; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.rect(x0, y0, d.w, d.h); ctx.fill(); ctx.stroke();
      // sawtooth roof
      ctx.fillStyle = shadeHex(d.color, 0.8);
      const n = Math.max(2, Math.round(d.w / 40)), tw = d.w / n;
      ctx.beginPath(); ctx.moveTo(x0, y0);
      for (let i = 0; i < n; i++) { ctx.lineTo(x0 + i * tw, y0 - 18); ctx.lineTo(x0 + (i + 1) * tw, y0); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // corrugated siding, roller door, high windows
      ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = x0 + 6; x < x0 + d.w; x += 6) { ctx.moveTo(x, y0); ctx.lineTo(x, WORLD.groundY); }
      ctx.stroke();
      ctx.fillStyle = '#5b5f66'; ctx.fillRect(d.x - 22, WORLD.groundY - 46, 44, 46);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath();
      for (let y = WORLD.groundY - 40; y < WORLD.groundY; y += 6) { ctx.moveTo(d.x - 22, y); ctx.lineTo(d.x + 22, y); }
      ctx.stroke();
      ctx.fillStyle = '#2d4a6b';
      for (let x = x0 + 10; x < x0 + d.w - 20; x += 30) ctx.fillRect(x, y0 + 14, 20, 10);
    }

    drawStadiumBowl(ctx, L) {
      const gy = WORLD.groundY, x0 = L.x - L.span / 2, x1 = L.x + L.span / 2;
      ctx.fillStyle = '#4caf50'; ctx.fillRect(x0 + 140, gy - 4, L.span - 280, 6);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(L.x, gy - 4); ctx.lineTo(L.x, gy + 2); ctx.stroke();
      for (const s of [-1, 1]) {
        const outer = s < 0 ? x0 + 10 : x1 - 10, inner = s < 0 ? x0 + 140 : x1 - 140;
        ctx.fillStyle = '#8d99ae';
        ctx.beginPath(); ctx.moveTo(outer, gy - 150); ctx.lineTo(inner, gy - 6); ctx.lineTo(inner, gy); ctx.lineTo(outer, gy); ctx.closePath(); ctx.fill();
        // seat rows
        for (let i = 1; i < 12; i++) {
          const t = i / 12, x = outer + (inner - outer) * t, y = gy - 150 + 144 * t;
          ctx.fillStyle = i % 2 ? '#e63946' : '#457b9d';
          ctx.fillRect(Math.min(x, x - s * 10), y - 3, 10, 3);
        }
      }
    }

    drawPool(ctx, pool) {
      const gy = WORLD.groundY, [p0, p1] = pool;
      ctx.fillStyle = '#e9e5d6'; ctx.fillRect(p0 - 8, gy - 3, p1 - p0 + 16, 15);
      const g = ctx.createLinearGradient(0, gy - 14, 0, gy + 10);
      g.addColorStop(0, 'rgba(90,210,235,0.85)'); g.addColorStop(1, 'rgba(30,140,200,0.95)');
      ctx.fillStyle = g; ctx.fillRect(p0, gy - 12, p1 - p0, 22);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let x = p0; x <= p1; x += 5) { const y = gy - 12 + Math.sin(x * 0.12 + this.time * 3) * 1; if (x === p0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
      // ladder, palm trees and a lounger
      ctx.strokeStyle = '#b0b7bf'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p1 - 10, gy - 22); ctx.lineTo(p1 - 10, gy - 4); ctx.moveTo(p1 - 4, gy - 22); ctx.lineTo(p1 - 4, gy - 4); ctx.stroke();
      for (const [px, h] of [[p0 - 18, 90], [p1 + 26, 110]]) {
        ctx.strokeStyle = '#8b5a2b'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(px, gy); ctx.quadraticCurveTo(px + 8, gy - h / 2, px + 4, gy - h); ctx.stroke();
        ctx.fillStyle = '#2a9d8f';
        for (let a = 0; a < 6; a++) {
          const ang = -Math.PI / 2 + (a - 2.5) * 0.55;
          ctx.beginPath(); ctx.ellipse(px + 4 + Math.cos(ang) * 16, gy - h + Math.sin(ang) * 8 + 6, 18, 5, ang, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.fillStyle = '#ffffff'; ctx.fillRect(p1 + 40, gy - 8, 34, 4);
      ctx.fillStyle = '#ffb703'; ctx.fillRect(p1 + 40, gy - 12, 26, 4);
    }

    drawTank(ctx, pc, hover) {
      const w = pc.w, h = pc.h;
      ctx.strokeStyle = '#3d4650'; ctx.lineWidth = 2;
      // legs
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 5, h / 2); ctx.lineTo(-w / 2 + 9, 0);
      ctx.moveTo(w / 2 - 5, h / 2); ctx.lineTo(w / 2 - 9, 0);
      ctx.moveTo(-w / 2 + 6, h / 2 - 4); ctx.lineTo(w / 2 - 8, 2);
      ctx.moveTo(w / 2 - 6, h / 2 - 4); ctx.lineTo(-w / 2 + 8, 2);
      ctx.stroke();
      // barrel
      ctx.fillStyle = '#8d6e52';
      ctx.strokeStyle = hover ? '#ff3b30' : '#4b3626';
      ctx.lineWidth = hover ? 2.5 : 1.8;
      ctx.beginPath(); ctx.roundRect(-w / 2 + 3, -h / 2 + 8, w - 6, h / 2 - 6, 3); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#4b3626'; ctx.lineWidth = 1;
      for (const y of [-h / 2 + 13, -h / 2 + 20]) { ctx.beginPath(); ctx.moveTo(-w / 2 + 3, y); ctx.lineTo(w / 2 - 3, y); ctx.stroke(); }
      // conical lid
      ctx.fillStyle = '#6b5240';
      ctx.beginPath(); ctx.moveTo(-w / 2 + 1, -h / 2 + 9); ctx.lineTo(0, -h / 2); ctx.lineTo(w / 2 - 1, -h / 2 + 9); ctx.closePath(); ctx.fill(); ctx.stroke();
    }

    drawSign(ctx, pc, hover) {
      const w = pc.w, h = pc.h;
      ctx.fillStyle = '#4a4e57';
      ctx.fillRect(-w / 2 + 10, 0, 4, h / 2); ctx.fillRect(w / 2 - 14, 0, 4, h / 2);
      ctx.fillStyle = '#ffd23f';
      ctx.strokeStyle = hover ? '#ff3b30' : '#3a2a1a';
      ctx.lineWidth = hover ? 2.5 : 2;
      ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h * 0.62, 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e63946';
      ctx.font = `bold ${Math.round(h * 0.32)}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText((this.curLevel && this.curLevel.signText) || 'BIG SALE!', 0, -h / 2 + h * 0.31);
      ctx.textBaseline = 'alphabetic';
    }

    drawWall(ctx, b, facade, material) {
      const pc = b.plugin.piece;
      const lv = this.curLevel || {};
      if (lv.sections) {
        const sec = lv.sections.find((s) => pc.bay < s.to);
        if (sec) facade = FACADES[sec.facade % FACADES.length];
      }
      if (lv.chimney) {
        ctx.save(); ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle);
        ctx.fillStyle = shadeHex('#a8473a', pc.shade); ctx.fillRect(-pc.w / 2, -pc.h / 2, pc.w, pc.h);
        ctx.strokeStyle = 'rgba(255,220,190,0.3)'; ctx.lineWidth = 0.8; ctx.beginPath();
        for (let y = -pc.h / 2 + 4; y < pc.h / 2; y += 4) { ctx.moveTo(-pc.w / 2, y); ctx.lineTo(pc.w / 2, y); }
        ctx.stroke();
        if (pc.floor % 4 === 2) { ctx.fillStyle = '#3d3d3d'; ctx.fillRect(-pc.w / 2, -2, pc.w, 4); }
        ctx.restore();
        return;
      }
      ctx.save();
      ctx.translate(b.position.x, b.position.y);
      ctx.rotate(b.angle);
      const w = pc.w, h = pc.h;
      if (pc.glass) {
        const g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
        g.addColorStop(0, '#bfeaff'); g.addColorStop(0.5, '#6fb7dd'); g.addColorStop(1, '#3d8fbf');
        ctx.fillStyle = g;
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.strokeStyle = '#2b5f80'; ctx.lineWidth = 1.2;
        ctx.strokeRect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1);
        ctx.beginPath(); ctx.moveTo(0, -h / 2); ctx.lineTo(0, h / 2); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.beginPath(); ctx.moveTo(-w / 2 + 3, h / 2 - 6); ctx.lineTo(-w / 2 + w * 0.35, -h / 2 + 3); ctx.lineTo(-w / 2 + w * 0.45, -h / 2 + 3); ctx.lineTo(-w / 2 + 3, h / 2 - 1); ctx.fill();
        ctx.restore();
        return;
      }
      if (material === 'sandstone' || material === 'marble') { this.drawLandmarkWall(ctx, pc, material); ctx.restore(); return; }
      const wallColor = material === 'brick' ? '#c8643f' : material === 'steel' ? '#a9b8a0' : facade.wall;
      const trim = material === 'brick' ? '#8f3f28' : material === 'steel' ? '#7d8d74' : facade.trim;
      ctx.fillStyle = shadeHex(wallColor, pc.shade);
      ctx.fillRect(-w / 2, -h / 2, w, h);
      if (material === 'brick') {
        ctx.strokeStyle = 'rgba(255,230,200,0.3)'; ctx.lineWidth = 0.7;
        ctx.beginPath();
        for (let y = -h / 2 + 4; y < h / 2; y += 4) { ctx.moveTo(-w / 2, y); ctx.lineTo(w / 2, y); }
        ctx.stroke();
      } else if (material === 'steel') {
        ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = -w / 2 + 5; x < w / 2; x += 5) { ctx.moveTo(x, -h / 2); ctx.lineTo(x, h / 2); }
        ctx.stroke();
      }
      ctx.strokeStyle = trim;
      ctx.lineWidth = 1;
      ctx.strokeRect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1);
      if (pc.lobby) {
        ctx.fillStyle = '#3b5f86';
        ctx.fillRect(-w / 2 + 6, -h / 2 + 8, w - 12, h - 8);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(-w / 2 + 9, -h / 2 + 11, 4, h - 14);
        ctx.strokeStyle = '#26394f';
        ctx.beginPath(); ctx.moveTo(0, -h / 2 + 8); ctx.lineTo(0, h / 2); ctx.stroke();
      } else if (material !== 'steel' || pc.floor % 2 === 1) {
        const n = w > 44 ? 2 : 1;
        const gw = (w - 10) / n;
        for (let i = 0; i < n; i++) {
          const wx = -w / 2 + 5 + i * gw + gw * 0.12, ww = gw * 0.76, wy = -h / 2 + 8, wh = material === 'steel' ? 10 : h - 18;
          ctx.fillStyle = '#2f5175';
          if (material === 'brick') { ctx.beginPath(); ctx.arc(wx + ww / 2, wy + ww / 2, ww / 2, Math.PI, 0); ctx.lineTo(wx + ww, wy + wh); ctx.lineTo(wx, wy + wh); ctx.fill(); }
          else ctx.fillRect(wx, wy, ww, wh);
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.fillRect(wx + 2, wy + 2, ww * 0.18, Math.min(8, wh - 4));
          ctx.fillStyle = trim;
          ctx.fillRect(wx - 2, wy + wh, ww + 4, 3);
        }
      }
      ctx.restore();
    }

    drawLandmarkWall(ctx, pc, material) {
      const w = pc.w, h = pc.h;
      if (material === 'marble') {
        ctx.fillStyle = shadeHex('#f6f2ea', pc.shade);
        ctx.fillRect(-w / 2, -h / 2, w, h);
        // open arcade: dark arches separated by slim columns
        const n = 2, gw = w / n;
        for (let i = 0; i < n; i++) {
          const cx = -w / 2 + (i + 0.5) * gw, aw = gw * 0.62;
          ctx.fillStyle = '#6d6458';
          ctx.beginPath(); ctx.arc(cx, -h / 2 + 4 + aw / 2, aw / 2, Math.PI, 0); ctx.lineTo(cx + aw / 2, h / 2 - 3); ctx.lineTo(cx - aw / 2, h / 2 - 3); ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = '#d9d2c3';
        ctx.fillRect(-w / 2, h / 2 - 3, w, 3);
        ctx.fillRect(-w / 2, -h / 2, w, 2);
        return;
      }
      // sandstone gothic panel
      ctx.fillStyle = shadeHex('#e3c58e', pc.shade);
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.strokeStyle = 'rgba(120,85,40,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = -w / 2 + 6; x < w / 2; x += 6) { ctx.moveTo(x, -h / 2); ctx.lineTo(x, h / 2); }
      ctx.stroke();
      if (pc.clock) {
        const r = Math.min(w, h) * 0.42;
        ctx.fillStyle = '#e9c46a'; ctx.beginPath(); ctx.arc(0, 0, r + 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fffaf0'; ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#3a2a1a';
        for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; ctx.fillRect(Math.cos(a) * r * 0.8 - 1, Math.sin(a) * r * 0.8 - 1, 2, 2); }
        // hands run on real time, just for fun
        const now = new Date();
        const hr = ((now.getHours() % 12) + now.getMinutes() / 60) * Math.PI / 6 - Math.PI / 2;
        const mn = now.getMinutes() * Math.PI / 30 - Math.PI / 2;
        ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(hr) * r * 0.5, Math.sin(hr) * r * 0.5); ctx.stroke();
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(mn) * r * 0.78, Math.sin(mn) * r * 0.78); ctx.stroke();
        return;
      }
      // tall pointed (gothic) windows
      const n = w > 44 ? 2 : 1, gw = (w - 8) / n;
      for (let i = 0; i < n; i++) {
        const cx = -w / 2 + 4 + (i + 0.5) * gw, ww = gw * 0.5, top = -h / 2 + 6, bot = h / 2 - 5;
        ctx.fillStyle = '#2f4a66';
        ctx.beginPath(); ctx.moveTo(cx - ww / 2, bot); ctx.lineTo(cx - ww / 2, top + ww); ctx.quadraticCurveTo(cx - ww / 2, top, cx, top - 2);
        ctx.quadraticCurveTo(cx + ww / 2, top, cx + ww / 2, top + ww); ctx.lineTo(cx + ww / 2, bot); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#b08a4e'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, bot); ctx.stroke();
      }
    }

    drawCars(ctx, sc) {
      for (const c of sc.cars) {
        const car = c.car, d = c.damage;
        ctx.save();
        ctx.translate(c.position.x, c.position.y);
        ctx.rotate(c.angle);
        const w = car.w, h = car.h;
        const squash = 1 - d * 0.14;
        // wheels
        ctx.fillStyle = '#222';
        for (const x of [-w / 2 + 10, w / 2 - 10]) { ctx.beginPath(); ctx.arc(x, h / 2 - 1, 5, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#999';
        for (const x of [-w / 2 + 10, w / 2 - 10]) { ctx.beginPath(); ctx.arc(x, h / 2 - 1, 2, 0, Math.PI * 2); ctx.fill(); }
        // body
        ctx.fillStyle = car.color;
        ctx.strokeStyle = shadeHex(car.color, 0.5);
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.roundRect(-w / 2, -1, w, h / 2 + 1, 4); ctx.fill(); ctx.stroke();
        // cabin, squashed by damage
        const ch = (h / 2 + 3) * squash;
        ctx.beginPath();
        ctx.moveTo(-w / 2 + 9, -1); ctx.lineTo(-w / 2 + 15, -1 - ch); ctx.lineTo(w / 2 - 13, -1 - ch); ctx.lineTo(w / 2 - 7, -1);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = c.glass ? '#1d2630' : d > 0 ? '#8fa3b3' : '#bfe3ff';
        ctx.fillRect(-w / 2 + 15, -ch + 1, w / 2 - 17, ch - 3);
        ctx.fillRect(2, -ch + 1, w / 2 - 17, ch - 3);
        if (d > 0 || c.glass) {
          ctx.strokeStyle = '#333'; ctx.lineWidth = 0.8;
          ctx.beginPath(); ctx.moveTo(-w / 2 + 18, -ch + 2); ctx.lineTo(-4, -3); ctx.moveTo(6, -ch + 2); ctx.lineTo(w / 2 - 18, -3); ctx.stroke();
        }
        // flashing hazard lights once hit
        if ((d > 0 || c.glass) && Math.floor(this.time * 4) % 2 === 0) {
          ctx.fillStyle = '#ffb703';
          ctx.fillRect(-w / 2, 1, 3, 3); ctx.fillRect(w / 2 - 3, 1, 3, 3);
        }
        ctx.restore();
      }
    }

    drawPeople(ctx, sc, state) {
      for (const p of sc.people) {
        if (p.boat) { this.drawBoat(ctx, p, state); continue; }
        const running = p.state === 'shoo' || p.state === 'panic';
        const moving = running || p.state === 'walk';
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(p.dir < 0 ? -1 : 1, 1);
        const swing = moving ? Math.sin(p.anim) * (running ? 0.9 : 0.5) : 0;
        const lean = running ? 0.18 : 0;
        // legs
        ctx.strokeStyle = '#2b2d42'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, -12); ctx.lineTo(Math.sin(swing) * 6, -1);
        ctx.moveTo(0, -12); ctx.lineTo(-Math.sin(swing) * 6, -1);
        ctx.stroke();
        ctx.rotate(lean);
        // body
        ctx.fillStyle = p.shirt;
        ctx.beginPath(); ctx.roundRect(-4.5, -26, 9, 15, 3); ctx.fill();
        // arms
        ctx.strokeStyle = p.skin; ctx.lineWidth = 2.5;
        ctx.beginPath();
        if (p.state === 'panic') { ctx.moveTo(-3, -23); ctx.lineTo(-7, -33); ctx.moveTo(3, -23); ctx.lineTo(7, -33); }
        else if (p.state === 'watch') { ctx.moveTo(3, -23); ctx.lineTo(6, -29); ctx.moveTo(-3, -23); ctx.lineTo(-4, -14); }
        else { ctx.moveTo(0, -23); ctx.lineTo(-Math.sin(swing) * 6, -14); ctx.moveTo(0, -23); ctx.lineTo(Math.sin(swing) * 6, -14); }
        ctx.stroke();
        // head
        ctx.fillStyle = p.skin;
        ctx.beginPath(); ctx.arc(0, -31, 5, 0, Math.PI * 2); ctx.fill();
        if (p.hat) { ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(0, -33, 5.5, Math.PI, 0); ctx.fill(); ctx.fillRect(-7, -33.5, 14, 2); }
        ctx.fillStyle = '#222';
        ctx.fillRect(2, -32, 1.5, 1.5);
        if (p.state === 'panic') { ctx.beginPath(); ctx.arc(3, -28.5, 1.4, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
        // speech bubbles
        if (p.say > 0 || (state.showLot && p.state === 'watch')) {
          const txt = p.state === 'panic' ? 'AAAH!' : p.state === 'shoo' ? 'Sorry!' : p.state === 'watch' ? (p.say > 0 ? 'Ooh!' : '?') : '';
          if (txt) {
            ctx.font = 'bold 9px system-ui, sans-serif';
            ctx.textAlign = 'center';
            const tw = ctx.measureText(txt).width + 8;
            ctx.fillStyle = p.state === 'panic' ? '#ffdddd' : '#fff';
            ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.roundRect(p.x - tw / 2, p.y - 54, tw, 13, 4); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#3a2a1a';
            ctx.fillText(txt, p.x, p.y - 44.5);
          }
        }
        // tap target hint while planning
        if (state.showLot && (p.state === 'watch' || p.state === 'walk') && p.x > sc.zone.left - 4 && p.x < sc.zone.right + 4) {
          const a = 0.5 + 0.5 * Math.sin(this.time * 6);
          ctx.strokeStyle = `rgba(255,60,40,${0.4 + a * 0.5})`;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(p.x, p.y - 1, 10, 3.5, 0, 0, Math.PI * 2); ctx.stroke();
        }
      }
    }

    drawBoat(ctx, p, state) {
      const bob = Math.sin(this.time * 2.4 + p.id) * 1.2;
      const moving = p.state !== 'watch';
      ctx.save();
      ctx.translate(p.x, p.y + bob);
      ctx.scale(p.dir < 0 ? -1 : 1, 1);
      ctx.rotate(Math.sin(this.time * 1.7 + p.id) * 0.04);
      // hull
      ctx.fillStyle = p.shirt; ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-17, -6); ctx.lineTo(19, -6); ctx.lineTo(13, 4); ctx.lineTo(-14, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.fillRect(-16, -7.5, 34, 2.5);
      // cabin and skipper
      ctx.fillStyle = '#fdf6e3'; ctx.beginPath(); ctx.roundRect(-10, -17, 14, 10, 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#7cc0ea'; ctx.fillRect(-7, -15, 8, 4);
      ctx.fillStyle = p.skin; ctx.beginPath(); ctx.arc(9, -11, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1d3557'; ctx.fillRect(6, -15.5, 6.5, 2);
      ctx.restore();
      if (moving) {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(p.x - p.dir * 18, p.y + 1); ctx.lineTo(p.x - p.dir * 30, p.y + 2); ctx.stroke();
      }
      const txt = p.state === 'panic' ? 'ABANDON SHIP!' : p.state === 'shoo' ? 'Aye aye!' : p.state === 'watch' ? (p.say > 0 ? 'Ahoy!' : '') : '';
      if (txt) {
        ctx.font = 'bold 9px system-ui, sans-serif'; ctx.textAlign = 'center';
        const tw = ctx.measureText(txt).width + 8;
        ctx.fillStyle = p.state === 'panic' ? '#ffdddd' : '#fff'; ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(p.x - tw / 2, p.y - 38, tw, 13, 4); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#3a2a1a'; ctx.fillText(txt, p.x, p.y - 28.5);
      }
      if (state.showLot && (p.state === 'watch' || p.state === 'walk')) {
        const a = 0.5 + 0.5 * Math.sin(this.time * 6);
        ctx.strokeStyle = `rgba(255,60,40,${0.4 + a * 0.5})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(p.x, p.y + 2, 24, 6, 0, 0, Math.PI * 2); ctx.stroke();
      }
    }

    addPane(x, y, w, h) {
      for (let i = 0; i < 6; i++) {
        this.particles.push({ t: 'glass', x: x + (Math.random() - 0.5) * w, y: y + (Math.random() - 0.5) * h,
          vx: (Math.random() - 0.5) * 60, vy: -Math.random() * 40, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 20,
          sz: 2 + Math.random() * 2, life: 0, max: 0.9 + Math.random() * 0.6 });
      }
    }

    addSplash(x, y, big) {
      for (let i = 0; i < (big ? 12 : 5); i++) {
        this.particles.push({
          t: 'chip', col: 'rgba(200,235,255,0.9)', x: x + (Math.random() - 0.5) * 14, y,
          vx: (Math.random() - 0.5) * 120, vy: -80 - Math.random() * (big ? 220 : 120), rot: 0, vr: 0,
          sz: 2 + Math.random() * 2.5, life: 0, max: 0.5 + Math.random() * 0.5,
        });
      }
    }

    drawCharge(ctx, p, strength, delay, blink, angle, alpha, type) {
      ctx.save();
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(angle || 0);
      if (type === 'cutter') {
        // linear cutting charge: copper strip wrapped round the member
        ctx.fillStyle = '#ff9f1c'; ctx.strokeStyle = '#7a3e00'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(-8, -2.5, 16, 5, 1.5); ctx.fill(); ctx.stroke();
        ctx.fillStyle = blink ? '#ff2222' : '#5a1a1a';
        ctx.beginPath(); ctx.arc(0, 0, 1.4, 0, Math.PI * 2); ctx.fill();
      } else if (type === 'shaped') {
        const s = 0.8 + strength * 0.06;
        ctx.scale(s, s);
        ctx.fillStyle = '#b87333'; ctx.strokeStyle = '#5a3210'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(-6, -7); ctx.lineTo(6, -7); ctx.lineTo(3, 7); ctx.lineTo(-3, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#ffd6a5';
        ctx.beginPath(); ctx.moveTo(-3, -7); ctx.lineTo(0, -2); ctx.lineTo(3, -7); ctx.fill();
        ctx.fillStyle = blink ? '#ff2222' : '#5a1a1a';
        ctx.beginPath(); ctx.arc(0, 2, 1.6, 0, Math.PI * 2); ctx.fill();
      } else {
        const s = 0.8 + strength * 0.06;
        ctx.scale(s, s);
        ctx.fillStyle = '#d62828'; ctx.strokeStyle = '#5c0d0d'; ctx.lineWidth = 1.2;
        for (const dx of [-4, 0, 4]) { ctx.beginPath(); ctx.roundRect(dx - 2.2, -7, 4.4, 14, 1.5); ctx.fill(); ctx.stroke(); }
        ctx.fillStyle = '#222';
        ctx.fillRect(-6.5, -2, 13, 3);
        ctx.fillStyle = blink ? '#ff2222' : '#5a1a1a';
        ctx.beginPath(); ctx.arc(0, -0.5, 1.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.fillStyle = '#fff';
      const label = type === 'cutter' ? '✂' : String(strength);
      ctx.strokeText(label, p.x, p.y - 11);
      ctx.fillText(label, p.x, p.y - 11);
      if (delay > 0) {
        const dl = '+' + delay + 's';
        ctx.font = 'bold 8px system-ui, sans-serif';
        ctx.fillStyle = '#ffd23f';
        ctx.strokeText(dl, p.x, p.y + 18);
        ctx.fillText(dl, p.x, p.y + 18);
      }
      ctx.restore();
    }

    drawCharges(ctx, sc, state) {
      const blinkOn = Math.floor(this.time * (state.phase === 'countdown' ? 8 : 2)) % 2 === 0;
      sc.charges.forEach((ch, n) => {
        this.drawCharge(ctx, ch, ch.strength, ch.delay, blinkOn, ch.angle, 1, ch.type);
        if (state.seqOpen) {
          // firing-order badge
          ctx.fillStyle = '#3a2a1a'; ctx.beginPath(); ctx.arc(ch.x + 11, ch.y - 2, 7, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#ffd23f'; ctx.font = 'bold 9px system-ui, sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(String(n + 1), ch.x + 11, ch.y + 1);
        }
        if (state.preview != null && state.preview >= ch.delay && state.preview < ch.delay + 0.45) {
          const k = (state.preview - ch.delay) / 0.45;
          ctx.strokeStyle = `rgba(255,80,40,${1 - k})`; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(ch.x, ch.y, 8 + k * 26, 0, Math.PI * 2); ctx.stroke();
        }
      });
    }

    drawHover(ctx, hover, state) {
      if (hover.charge) {
        const p = root.DemoPhysics.chargePos(hover.charge);
        ctx.strokeStyle = '#ff3b30';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, 13, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p.x - 7, p.y - 7); ctx.lineTo(p.x + 7, p.y + 7); ctx.moveTo(p.x + 7, p.y - 7); ctx.lineTo(p.x - 7, p.y + 7); ctx.stroke();
        return;
      }
      if (!hover.point) return;
      const type = state.chargeType;
      const R = type === 'cutter' ? 24 : 26 + state.strength * 13;
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = 'rgba(255,80,40,0.8)';
      ctx.fillStyle = 'rgba(255,120,40,0.12)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (type === 'shaped' && state.scene) {
        // the blast is focused toward the middle of the building
        const b = state.scene.building;
        const cx = (b.left + b.right) / 2;
        const ang = Math.abs(cx - hover.point.x) < 6 ? Math.PI / 2 : cx > hover.point.x ? 0 : Math.PI;
        ctx.moveTo(hover.point.x, hover.point.y);
        ctx.arc(hover.point.x, hover.point.y, R, ang - 0.9, ang + 0.9);
        ctx.closePath();
      } else ctx.arc(hover.point.x, hover.point.y, R, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.restore();
      this.drawCharge(ctx, hover.point, state.strength, state.delay, true, hover.body ? hover.body.angle : 0, 0.7, type);
      const msg = hover.weak || hover.cost;
      if (msg) {
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.fillStyle = hover.weak ? '#ffcf33' : '#b6ff9e';
        ctx.strokeText(msg, hover.point.x, hover.point.y + 32);
        ctx.fillText(msg, hover.point.x, hover.point.y + 32);
      }
    }

    drawParticles(ctx) {
      for (const p of this.particles) {
        const k = p.life / p.max;
        if (p.t === 'smoke') {
          const a = (1 - k) * 0.55;
          const c = Math.round(90 + 100 * p.g + 40 * k);
          ctx.fillStyle = `rgba(${c},${c - 4},${c - 10},${a})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        } else if (p.t === 'steam') {
          const a = Math.sin(Math.PI * Math.min(1, k * 1.2)) * 0.55;
          ctx.fillStyle = `rgba(250,252,255,${a})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        } else if (p.t === 'dust') {
          const a = Math.sin(Math.PI * Math.min(1, k * 1.3)) * 0.5;
          ctx.fillStyle = p.red ? `rgba(190,110,80,${a})` : `rgba(196,176,145,${a})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'lighter';
      for (const p of this.particles) {
        const k = p.life / p.max;
        if (p.t === 'fire') {
          const g = Math.round(220 - 160 * k);
          ctx.fillStyle = `rgba(255,${g},40,${(1 - k) * 0.9})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 + k), 0, Math.PI * 2); ctx.fill();
        } else if (p.t === 'spark') {
          ctx.strokeStyle = `rgba(255,220,120,${1 - k})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      for (const p of this.particles) {
        if (p.t !== 'chip' && p.t !== 'glass') continue;
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        if (p.t === 'glass') {
          ctx.fillStyle = `rgba(200,240,255,${1 - p.life / p.max})`;
          ctx.beginPath(); ctx.moveTo(-p.sz / 2, p.sz / 2); ctx.lineTo(0, -p.sz / 2); ctx.lineTo(p.sz / 2, p.sz / 2); ctx.fill();
        } else {
          ctx.fillStyle = p.col || '#8d8f96';
          ctx.fillRect(-p.sz / 2, -p.sz / 2, p.sz, p.sz);
        }
        ctx.restore();
      }
      for (const r of this.rings) {
        ctx.strokeStyle = `rgba(255,255,255,${r.life * 0.7})`;
        ctx.lineWidth = 3 * r.life + 1;
        ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.textAlign = 'center';
      for (const t of this.texts) {
        const a = 1 - t.life / t.max;
        ctx.font = 'bold 18px system-ui, sans-serif';
        ctx.lineWidth = 4;
        ctx.strokeStyle = `rgba(0,0,0,${a})`;
        ctx.fillStyle = t.color.replace('A', a);
        ctx.strokeText(t.text, t.x, t.y);
        ctx.fillText(t.text, t.x, t.y);
      }
    }
  }

  root.Renderer = Renderer;
})(window);
