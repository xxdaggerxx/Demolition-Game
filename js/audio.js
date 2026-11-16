// Procedural music and sound effects using the Web Audio API (no audio files needed).
(function (root) {
  const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

  // A minor: Am - F - C - G   (MIDI roots and chord tones)
  const PROG = [
    { root: 45, chord: [57, 60, 64] },
    { root: 41, chord: [53, 57, 60] },
    { root: 48, chord: [55, 60, 64] },
    { root: 43, chord: [55, 59, 62] },
  ];
  const BASS_STEPS = [0, 3, 6, 8, 10, 11, 14];
  const ARP = [0, 1, 2, 1, 2, 3, 2, 1];

  class GameAudio {
    constructor() {
      this.ctx = null;
      this.musicOn = true;
      this.sfxOn = true;
      this.mode = 'plan';
      this.step = 0;
      this.bar = 0;
      this.nextTime = 0;
      this.timer = null;
      this.lastCrumble = 0;
      this.lastHit = 0;
    }

    unlock() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = (this.ctx = new AC());
        this.master = ctx.createDynamicsCompressor();
        this.master.threshold.value = -14;
        this.master.ratio.value = 4;
        this.master.connect(ctx.destination);
        this.musicGain = ctx.createGain();
        this.musicGain.gain.value = this.musicOn ? 0.32 : 0;
        this.musicGain.connect(this.master);
        this.sfxGain = ctx.createGain();
        this.sfxGain.gain.value = this.sfxOn ? 0.9 : 0;
        this.sfxGain.connect(this.master);
        const len = ctx.sampleRate * 2;
        this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        // Brown-ish noise for rumbles
        this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
        const b = this.brown.getChannelData(0);
        let last = 0;
        for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (!this.timer) this.startMusic();
    }

    setMusic(on) {
      this.musicOn = on;
      if (this.musicGain) this.musicGain.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.1);
    }

    setSfx(on) {
      this.sfxOn = on;
      if (this.sfxGain) this.sfxGain.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
    }

    setMode(mode) { this.mode = mode; }

    // ---------------- Music ----------------
    startMusic() {
      this.nextTime = this.ctx.currentTime + 0.1;
      this.timer = setInterval(() => this.schedule(), 25);
    }

    schedule() {
      const ctx = this.ctx;
      const bpm = this.mode === 'tense' ? 132 : 108;
      const stepDur = 60 / bpm / 4;
      while (this.nextTime < ctx.currentTime + 0.15) {
        this.playStep(this.step, this.nextTime, stepDur);
        this.nextTime += stepDur;
        this.step = (this.step + 1) % 16;
        if (this.step === 0) this.bar = (this.bar + 1) % 4;
      }
    }

    playStep(s, t, dur) {
      const mode = this.mode;
      const ch = PROG[this.bar];
      if (mode === 'title' || mode === 'calm') {
        if (s === 0) this.pad(ch.chord, t, dur * 16, 0.05);
        if (s === 0 || s === 8) this.bass(ch.root, t, dur * 6, 0.12);
        if (s % 4 === 2) this.arp(ch.chord[(s / 2) % 3 | 0] + 12, t, dur * 1.5, 0.025);
        return;
      }
      // plan & tense
      if (s === 0) this.pad(ch.chord, t, dur * 16, 0.035);
      if (BASS_STEPS.includes(s)) this.bass(ch.root + (s === 14 ? 12 : 0), t, dur * 1.6, 0.16);
      if (s % 2 === 0) {
        const n = ch.chord[ARP[(s / 2) % 8] % 3] + (ARP[(s / 2) % 8] === 3 ? 12 : 12);
        this.arp(n, t, dur * 1.2, mode === 'tense' ? 0.05 : 0.035);
      }
      if (s === 0 || s === 8 || (mode === 'tense' && (s === 4 || s === 12 || s === 10))) this.kick(t, 0.55);
      if (s === 4 || s === 12) this.snare(t, 0.22);
      if (mode === 'tense' ? true : s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.07 : 0.04);
    }

    osc(type, freq, t, dur, vol, dest, attack = 0.005) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(dest || this.musicGain);
      o.start(t);
      o.stop(t + dur + 0.05);
      return o;
    }

    bass(n, t, dur, vol) {
      const ctx = this.ctx;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(900, t);
      f.frequency.exponentialRampToValueAtTime(180, t + dur);
      f.connect(this.musicGain);
      this.osc('sawtooth', NOTE(n), t, dur, vol, f);
      this.osc('sine', NOTE(n - 12), t, dur, vol * 0.8);
    }

    pad(chord, t, dur, vol) {
      for (const n of chord) {
        const ctx = this.ctx;
        const o = ctx.createOscillator();
        const o2 = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'triangle'; o2.type = 'triangle';
        o.frequency.value = NOTE(n); o2.frequency.value = NOTE(n) * 1.004;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(vol, t + 0.4);
        g.gain.setValueAtTime(vol, t + dur - 0.4);
        g.gain.linearRampToValueAtTime(0, t + dur);
        o.connect(g); o2.connect(g); g.connect(this.musicGain);
        o.start(t); o2.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
      }
    }

    arp(n, t, dur, vol) { this.osc('square', NOTE(n), t, dur, vol); }

    kick(t, vol, dest) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.connect(g).connect(dest || this.musicGain);
      o.start(t); o.stop(t + 0.3);
    }

    noiseHit(t, dur, vol, type, freq, dest, q = 1, buffer) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = buffer || this.noise;
      src.playbackRate.value = 0.8 + Math.random() * 0.4;
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      src.connect(f).connect(g).connect(dest || this.musicGain);
      src.start(t, Math.random() * 1.0, dur + 0.1);
      return { f, g };
    }

    snare(t, vol) {
      this.noiseHit(t, 0.18, vol, 'bandpass', 1800, null, 0.8);
      this.osc('triangle', 190, t, 0.1, vol * 0.6);
    }

    hat(t, vol) { this.noiseHit(t, 0.04, vol, 'highpass', 7000); }

    // ---------------- SFX ----------------
    ready() { return this.ctx && this.sfxOn; }

    explosion(strength) {
      if (!this.ready()) return;
      const t = this.ctx.currentTime;
      const s = strength / 10;
      // sharp crack
      this.noiseHit(t, 0.25, 0.9, 'highpass', 900, this.sfxGain, 0.7);
      // body of the boom
      const { f } = this.noiseHit(t, 1.2 + s * 1.6, 1.0, 'lowpass', 1800, this.sfxGain, 0.5, this.noise);
      f.frequency.setValueAtTime(2500, t);
      f.frequency.exponentialRampToValueAtTime(90, t + 1.0 + s);
      // sub thump
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(28, t + 0.6 + s * 0.6);
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.9 + s * 0.8);
      o.connect(g).connect(this.sfxGain);
      o.start(t); o.stop(t + 2);
      // rumble tail
      this.noiseHit(t + 0.05, 2 + s * 2, 0.6, 'lowpass', 160, this.sfxGain, 0.7, this.brown);
    }

    crumble(intensity) {
      if (!this.ready()) return;
      const t = this.ctx.currentTime;
      if (t - this.lastCrumble < 0.06) return;
      this.lastCrumble = t;
      const v = Math.min(0.5, 0.08 + intensity * 0.06);
      this.noiseHit(t, 0.12 + Math.random() * 0.25, v, 'bandpass', 300 + Math.random() * 900, this.sfxGain, 1.2);
      if (intensity > 3) this.noiseHit(t, 0.6, v * 0.8, 'lowpass', 120, this.sfxGain, 0.7, this.brown);
    }

    rumble() {
      if (!this.ready()) return;
      const t = this.ctx.currentTime;
      if (t - (this.lastRumble || 0) < 1.2) return;
      this.lastRumble = t;
      this.noiseHit(t, 3.5, 0.55, 'lowpass', 140, this.sfxGain, 0.6, this.brown);
    }

    hit() {
      if (!this.ready()) return;
      const t = this.ctx.currentTime;
      if (t - this.lastHit < 0.08) return;
      this.lastHit = t;
      // glass + thud
      for (let i = 0; i < 3; i++) this.osc('square', 2200 + Math.random() * 2600, t + i * 0.025, 0.12, 0.05, this.sfxGain);
      this.noiseHit(t, 0.3, 0.35, 'bandpass', 600, this.sfxGain, 1);
      this.osc('sawtooth', 120, t, 0.25, 0.15, this.sfxGain);
    }

    place() {
      if (!this.ready()) return;
      const t = this.ctx.currentTime;
      this.osc('square', 660, t, 0.06, 0.12, this.sfxGain);
      this.osc('square', 990, t + 0.05, 0.08, 0.1, this.sfxGain);
    }

    remove() {
      if (!this.ready()) return;
      const t = this.ctx.currentTime;
      this.osc('square', 500, t, 0.06, 0.1, this.sfxGain);
      this.osc('square', 330, t + 0.05, 0.08, 0.1, this.sfxGain);
    }

    click() {
      if (!this.ready()) return;
      this.osc('triangle', 880, this.ctx.currentTime, 0.05, 0.12, this.sfxGain);
    }

    error() {
      if (!this.ready()) return;
      const t = this.ctx.currentTime;
      this.osc('sawtooth', 160, t, 0.18, 0.15, this.sfxGain);
    }

    // Site warning horn: kind = 'long' | 'short' | 'clear'
    horn(kind) {
      if (!this.ready()) return;
      const t = this.ctx.currentTime;
      const blasts = kind === 'short' ? [[0, 0.35], [0.5, 0.35]] : [[0, kind === 'clear' ? 1.6 : 1.2]];
      for (const [at, dur] of blasts) {
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = 1400; f.Q.value = 0.8;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t + at);
        g.gain.linearRampToValueAtTime(0.22, t + at + 0.05);
        g.gain.setValueAtTime(0.22, t + at + dur - 0.08);
        g.gain.linearRampToValueAtTime(0, t + at + dur);
        f.connect(g).connect(this.sfxGain);
        const base = kind === 'clear' ? 262 : 233;
        for (const mul of [1, 1.335, 2]) {
          const o = this.ctx.createOscillator();
          o.type = 'sawtooth'; o.frequency.value = base * mul;
          o.connect(f); o.start(t + at); o.stop(t + at + dur + 0.05);
        }
      }
    }

    beep(final) {
      if (!this.ready()) return;
      const t = this.ctx.currentTime;
      this.osc('square', final ? 1320 : 880, t, final ? 0.5 : 0.15, 0.2, this.sfxGain);
    }

    fuse(duration) {
      if (!this.ready()) return;
      const t = this.ctx.currentTime;
      this.noiseHit(t, duration, 0.08, 'highpass', 4000, this.sfxGain, 0.5);
    }

    carAlarm() {
      if (!this.ready()) return;
      const t = this.ctx.currentTime;
      if (t - (this.lastAlarm || 0) < 1.5) return;
      this.lastAlarm = t;
      for (let i = 0; i < 8; i++) this.osc('square', i % 2 ? 980 : 760, t + i * 0.16, 0.15, 0.07, this.sfxGain);
      this.noiseHit(t, 0.25, 0.4, 'bandpass', 900, this.sfxGain, 1.5);
    }

    glass() {
      if (!this.ready()) return;
      const t = this.ctx.currentTime;
      if (t - (this.lastGlass || 0) < 0.07) return;
      this.lastGlass = t;
      for (let i = 0; i < 5; i++) this.osc('sine', 2500 + Math.random() * 4000, t + Math.random() * 0.15, 0.2, 0.04, this.sfxGain, 0.001);
      this.noiseHit(t, 0.18, 0.18, 'highpass', 5000, this.sfxGain, 0.8);
    }

    cut() {
      if (!this.ready()) return;
      const t = this.ctx.currentTime;
      this.noiseHit(t, 0.5, 0.5, 'bandpass', 3200, this.sfxGain, 2);
      this.noiseHit(t, 0.3, 0.6, 'lowpass', 300, this.sfxGain, 0.7, this.brown);
      this.osc('sawtooth', 90, t, 0.25, 0.2, this.sfxGain);
    }

    shoo() {
      if (!this.ready()) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(900, t);
      o.frequency.exponentialRampToValueAtTime(2200, t + 0.12);
      o.frequency.exponentialRampToValueAtTime(1500, t + 0.25);
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g).connect(this.sfxGain);
      o.start(t); o.stop(t + 0.35);
    }

    scream() {
      if (!this.ready()) return;
      const t = this.ctx.currentTime;
      if (t - (this.lastScream || 0) < 0.4) return;
      this.lastScream = t;
      const o = this.ctx.createOscillator();
      const f = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(520, t);
      o.frequency.linearRampToValueAtTime(700, t + 0.15);
      o.frequency.exponentialRampToValueAtTime(260, t + 0.8);
      f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 3;
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
      o.connect(f).connect(g).connect(this.sfxGain);
      o.start(t); o.stop(t + 0.9);
    }

    cash() {
      if (!this.ready()) return;
      const t = this.ctx.currentTime;
      this.osc('square', NOTE(88), t, 0.08, 0.08, this.sfxGain);
      this.osc('square', NOTE(93), t + 0.08, 0.25, 0.08, this.sfxGain);
      this.noiseHit(t + 0.02, 0.12, 0.2, 'highpass', 6000, this.sfxGain, 0.6);
    }

    jingle(win) {
      if (!this.ready()) return;
      const t = this.ctx.currentTime;
      const notes = win ? [72, 76, 79, 84, 79, 84] : [67, 63, 60, 55];
      notes.forEach((n, i) => {
        this.osc('square', NOTE(n), t + i * 0.13, 0.25, 0.12, this.sfxGain);
        this.osc('triangle', NOTE(n - 12), t + i * 0.13, 0.3, 0.12, this.sfxGain);
      });
    }
  }

  root.GameAudio = GameAudio;
})(window);
