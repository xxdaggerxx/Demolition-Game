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
      const view = this.view || { x0: 290, x1: 1310, y0: 95, y1: 838 };
      const availH = Math.max(200, h - top - bottom);
      const scale = Math.min(w / (view.x1 - view.x0), availH / (view.y1 - view.y0));
      this.scale = scale;
      this.ox = w / 2 - ((view.x0 + view.x1) / 2) * scale;
      this.oy = top + availH / 2 - ((view.y0 + view.y1) / 2) * scale;
      this.skyline = null;
    }

    // Frame the camera on a level: both neighbours plus some headroom.
    setLevel(level) {
      if (!level) { this.view = null; this.resize(); return; }
      const ns = level.neighbors;
      const bw = level.bays * level.bayW;
      let x0 = Math.min(level.x - bw / 2, ...ns.map((n) => n.x - n.w / 2)) - 70;
      let x1 = Math.max(level.x + bw / 2, ...ns.map((n) => n.x + n.w / 2)) + 70;
      const topY = WORLD.groundY - Math.max(level.floors * level.floorH, ...ns.map((n) => n.h));
      let y0 = topY - 60;
      const y1 = WORLD.groundY + 18;
      // keep a sensible minimum frame so small levels don't look over-zoomed
      if (y1 - y0 < 420) y0 = y1 - 420;
      if (x1 - x0 < 760) { const c = (x0 + x1) / 2; x0 = c - 380; x1 = c + 380; }
      this.view = { x0, x1, y0, y1 };
      this.resize();
    }

    setInsets(top, bottom) {
      if (top === this.insetTop && bottom === this.insetBottom) return;
      this.insetTop = top; this.insetBottom = bottom;
      this.resize();
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

    addDust(x, y, amount, big) {
      for (let i = 0; i < amount; i++) {
        this.particles.push({
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
      for (const c of this.clouds) { c.x += c.v * dt; if (c.x > 2400) c.x = -800; }
      const ps = this.particles;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.life += dt;
        if (p.life >= p.max) { ps.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.t === 'smoke' || p.t === 'dust') {
          p.vx *= 1 - 1.2 * dt; p.vy = p.vy * (1 - 1.2 * dt) - 6 * dt; p.r += p.grow * dt * (1 - p.life / p.max);
        } else if (p.t === 'fire') {
          p.vx *= 1 - 5 * dt; p.vy *= 1 - 5 * dt; p.vy -= 30 * dt;
        } else if (p.t === 'spark') {
          p.vy += 300 * dt; p.vx *= 1 - 1.5 * dt;
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

    // ---------------- Drawing ----------------
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
      if (state.sim) {
        this.drawGround(ctx, state.sim, state);
        this.drawNeighbors(ctx, state.sim);
        this.drawBuilding(ctx, state.sim, state);
        this.drawCharges(ctx, state);
        if (state.hover) this.drawHover(ctx, state.hover, state);
      } else {
        this.drawGround(ctx, null, state);
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
      // sun
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
      // hills
      ctx.fillStyle = '#7cc66b';
      ctx.beginPath();
      ctx.moveTo(-2000, gy);
      for (let x = -2000; x <= 3600; x += 40) ctx.lineTo(x, gy - 30 - Math.sin(x * 0.006) * 22 - Math.sin(x * 0.017) * 8);
      ctx.lineTo(3600, gy);
      ctx.fill();
    }

    drawGround(ctx, sim, state) {
      const gy = WORLD.groundY;
      ctx.fillStyle = '#8a5a3b';
      ctx.fillRect(-3000, gy, 8000, 3000);
      ctx.fillStyle = '#6f4529';
      for (let x = -3000; x < 5000; x += 46) ctx.fillRect(x, gy + 26 + ((x / 46) % 3) * 12, 18, 6);
      ctx.fillStyle = '#5cb85c';
      ctx.fillRect(-3000, gy, 8000, 9);
      ctx.fillStyle = '#4a9d4a';
      ctx.fillRect(-3000, gy + 9, 8000, 3);
      if (!sim) return;
      // the demolition lot
      const { left, right } = sim.lot;
      ctx.fillStyle = '#b89a72';
      ctx.fillRect(left, gy, right - left, 12);
      if (state.showLot) {
        ctx.fillStyle = 'rgba(80,220,120,0.10)';
        ctx.fillRect(left, 0, right - left, gy);
        ctx.setLineDash([10, 8]);
        ctx.strokeStyle = 'rgba(40,160,80,0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(left, 40); ctx.lineTo(left, gy); ctx.moveTo(right, 40); ctx.lineTo(right, gy); ctx.stroke();
        ctx.setLineDash([]);
      }
      // hazard barriers at the lot edges
      for (const x of [left + 6, right - 6]) {
        ctx.save();
        ctx.translate(x, gy - 16);
        ctx.fillStyle = '#333'; ctx.fillRect(-2, 0, 4, 16);
        ctx.fillStyle = '#ffd23f'; ctx.fillRect(-9, -2, 18, 7);
        ctx.fillStyle = '#222';
        ctx.fillRect(-9, -2, 4, 7); ctx.fillRect(-1, -2, 4, 7); ctx.fillRect(7, -2, 2, 7);
        ctx.restore();
      }
    }

    drawNeighbors(ctx, sim) {
      for (const b of sim.neighbors) {
        const nb = b.plugin.neighbor;
        const d = nb.def;
        const x0 = d.x - d.w / 2, y0 = WORLD.groundY - d.h;
        ctx.save();
        // body
        ctx.fillStyle = d.color;
        ctx.strokeStyle = shadeHex(d.color, 0.55);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(x0, y0, d.w, d.h, 4);
        ctx.fill();
        // windows
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
        // door
        ctx.fillStyle = shadeHex(d.color, 0.45);
        ctx.fillRect(d.x - 12, WORLD.groundY - 34, 24, 34);
        // roof
        ctx.fillStyle = shadeHex(d.color, 0.7);
        ctx.fillRect(x0 - 4, y0 - 8, d.w + 8, 10);
        ctx.fillRect(x0 + d.w * 0.15, y0 - 22, 22, 14);
        ctx.strokeStyle = shadeHex(d.color, 0.55);
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.roundRect(x0, y0, d.w, d.h, 4); ctx.stroke();
        // cracks
        ctx.strokeStyle = 'rgba(30,20,20,0.75)';
        ctx.lineWidth = 1.6;
        for (const c of nb.cracks) {
          const r = seeded(Math.floor(c.seed * 1e6) + 1);
          const cx = b.position.x + c.x, cy = b.position.y + c.y;
          for (let k = 0; k < 4; k++) {
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            let px = cx, py = cy;
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
        }
        ctx.restore();
      }
    }

    drawBuilding(ctx, sim, state) {
      const facade = FACADES[(sim.level.id - 1) % FACADES.length];
      // walls first (they are cladding, drawn behind the frame)
      for (const b of sim.pieces) if (b.plugin.piece.kind === 'wall') this.drawWall(ctx, b, facade);
      for (const b of sim.pieces) {
        const pc = b.plugin.piece;
        if (pc.kind === 'wall') continue;
        if (pc.kind === 'frag') {
          const base = pc.parentKind === 'wall' ? facade.wall : '#a3a8b2';
          ctx.fillStyle = shadeHex(base, pc.shade * 0.95);
          ctx.strokeStyle = '#4a4e57';
          ctx.lineWidth = 1.2;
          const v = b.vertices;
          ctx.beginPath();
          ctx.moveTo(v[0].x, v[0].y);
          for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
          ctx.closePath();
          ctx.fill(); ctx.stroke();
          continue;
        }
        ctx.save();
        ctx.translate(b.position.x, b.position.y);
        ctx.rotate(b.angle);
        const isHover = state.hover && state.hover.body === b;
        ctx.fillStyle = shadeHex(pc.kind === 'column' ? '#adb2bc' : '#979ca6', pc.shade);
        ctx.strokeStyle = isHover ? '#ff3b30' : '#474b54';
        ctx.lineWidth = isHover ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.roundRect(-pc.w / 2, -pc.h / 2, pc.w, pc.h, 2);
        ctx.fill(); ctx.stroke();
        // subtle highlight
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        if (pc.kind === 'column') ctx.fillRect(-pc.w / 2 + 2, -pc.h / 2 + 2, 2.5, pc.h - 4);
        else ctx.fillRect(-pc.w / 2 + 2, -pc.h / 2 + 2, pc.w - 4, 2);
        ctx.restore();
      }
    }

    drawWall(ctx, b, facade) {
      const pc = b.plugin.piece;
      ctx.save();
      ctx.translate(b.position.x, b.position.y);
      ctx.rotate(b.angle);
      const w = pc.w, h = pc.h;
      ctx.fillStyle = shadeHex(facade.wall, pc.shade);
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.strokeStyle = facade.trim;
      ctx.lineWidth = 1;
      ctx.strokeRect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1);
      if (pc.lobby) {
        ctx.fillStyle = '#3b5f86';
        ctx.fillRect(-w / 2 + 6, -h / 2 + 8, w - 12, h - 8);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(-w / 2 + 9, -h / 2 + 11, 4, h - 14);
        ctx.strokeStyle = '#26394f';
        ctx.beginPath(); ctx.moveTo(0, -h / 2 + 8); ctx.lineTo(0, h / 2); ctx.stroke();
      } else {
        const n = w > 44 ? 2 : 1;
        const gw = (w - 10) / n;
        for (let i = 0; i < n; i++) {
          const wx = -w / 2 + 5 + i * gw + gw * 0.12, ww = gw * 0.76, wy = -h / 2 + 8, wh = h - 18;
          ctx.fillStyle = '#2f5175';
          ctx.fillRect(wx, wy, ww, wh);
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.beginPath(); ctx.moveTo(wx + 2, wy + wh * 0.6); ctx.lineTo(wx + ww * 0.6, wy + 2); ctx.lineTo(wx + ww * 0.8, wy + 2); ctx.lineTo(wx + 2, wy + wh * 0.85); ctx.fill();
          ctx.fillStyle = facade.trim;
          ctx.fillRect(wx - 2, wy + wh, ww + 4, 3);
        }
      }
      ctx.restore();
    }

    drawCharge(ctx, p, strength, delay, blink, angle, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(angle || 0);
      const s = 0.8 + strength * 0.06;
      ctx.scale(s, s);
      // dynamite bundle
      ctx.fillStyle = '#d62828';
      ctx.strokeStyle = '#5c0d0d';
      ctx.lineWidth = 1.2;
      for (const dx of [-4, 0, 4]) { ctx.beginPath(); ctx.roundRect(dx - 2.2, -7, 4.4, 14, 1.5); ctx.fill(); ctx.stroke(); }
      ctx.fillStyle = '#222';
      ctx.fillRect(-6.5, -2, 13, 3);
      // LED
      ctx.fillStyle = blink ? '#ff2222' : '#5a1a1a';
      ctx.beginPath(); ctx.arc(0, -0.5, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.fillStyle = '#fff';
      const label = String(strength);
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

    drawCharges(ctx, state) {
      const sim = state.sim;
      const blinkOn = Math.floor(this.time * (state.phase === 'countdown' ? 8 : 2)) % 2 === 0;
      for (const ch of sim.charges) {
        if (ch.fired) continue;
        const p = root.DemoPhysics.chargePos(ch);
        this.drawCharge(ctx, p, ch.strength, ch.delay, blinkOn, ch.body.angle);
      }
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
      const R = 26 + state.strength * 13;
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = 'rgba(255,80,40,0.8)';
      ctx.fillStyle = 'rgba(255,120,40,0.12)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(hover.point.x, hover.point.y, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
      this.drawCharge(ctx, hover.point, state.strength, state.delay, true, hover.body ? hover.body.angle : 0, 0.7);
      if (hover.weak) {
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.fillStyle = '#ffcf33';
        ctx.strokeText(hover.weak, hover.point.x, hover.point.y + 32);
        ctx.fillText(hover.weak, hover.point.x, hover.point.y + 32);
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
        } else if (p.t === 'dust') {
          const a = Math.sin(Math.PI * Math.min(1, k * 1.3)) * 0.5;
          ctx.fillStyle = `rgba(196,176,145,${a})`;
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
        if (p.t !== 'chip') continue;
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = '#8d8f96';
        ctx.fillRect(-p.sz / 2, -p.sz / 2, p.sz, p.sz);
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
