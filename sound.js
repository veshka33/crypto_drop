"use strict";
// Procedural sound (Web Audio), no audio files. Off by default; the page has a toggle.
(function (g) {
  let ctx = null, master = null, noiseBuf = null, enabled = false, drone = null, ver = 0;
  const rnd = (a, b) => a + Math.random() * (b - a);

  function setup(c) {
    ctx = c; master = ctx.createGain(); master.gain.value = 0.7; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  function env(gn, t0, dur, peak, attack) {
    gn.gain.setValueAtTime(0.0001, t0);
    gn.gain.linearRampToValueAtTime(peak, t0 + Math.min(attack, dur * 0.6));
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }
  function noise(at, dur, o = {}) {
    if (!enabled) return;
    const { type = "lowpass", f0 = 800, f1 = f0, q = 1, g = 0.2, attack = 0.02 } = o, t0 = ctx.currentTime + at;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const gn = ctx.createGain(); env(gn, t0, dur, g, attack);
    src.connect(f); f.connect(gn); gn.connect(master); src.start(t0, Math.random()); src.stop(t0 + dur + 0.05);
  }
  function tone(at, dur, o = {}) {
    if (!enabled) return;
    const { type = "sine", f0 = 100, f1 = f0, g = 0.3, attack = 0.01, lp = 0 } = o, t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator(); osc.type = type;
    osc.frequency.setValueAtTime(f0, t0); osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const gn = ctx.createGain(); env(gn, t0, dur, g, attack);
    let out = osc;
    if (lp) { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp; osc.connect(f); out = f; }
    out.connect(gn); gn.connect(master); osc.start(t0); osc.stop(t0 + dur + 0.05);
  }
  function startDrone() {
    if (drone) return;
    const t = ctx.currentTime, gn = ctx.createGain(), lp = ctx.createBiquadFilter();
    gn.gain.setValueAtTime(0.0001, t); gn.gain.linearRampToValueAtTime(0.05, t + 3);
    lp.type = "lowpass"; lp.frequency.value = 220; lp.connect(gn); gn.connect(master);
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.type = "sine"; o1.frequency.value = 55; o2.type = "triangle"; o2.frequency.value = 55.7;
    o1.connect(lp); o2.connect(lp); o1.start(t); o2.start(t);
    drone = { gn, o1, o2 };
  }
  function stopDrone() {
    if (!drone) return;
    const { gn, o1, o2 } = drone, t = ctx.currentTime;
    gn.gain.cancelScheduledValues(t); gn.gain.setValueAtTime(Math.max(gn.gain.value, 0.0001), t);
    gn.gain.linearRampToValueAtTime(0.0001, t + 0.4); o1.stop(t + 0.5); o2.stop(t + 0.5); drone = null;
  }

  const Sfx = {
    get enabled() { return enabled; },
    async enable(on) {
      const my = ++ver;
      if (!on) { enabled = false; if (ctx) stopDrone(); return; }
      if (!ctx) setup(new (g.AudioContext || g.webkitAudioContext)());
      await ctx.resume();
      if (my !== ver) return;
      enabled = true; startDrone(); Sfx.pluck();
    },
    reach() { noise(0, 0.6, { f0: 250, f1: 600, g: 0.4, attack: 0.25 }); },
    grab() {
      tone(0, 0.4, { f0: 120, f1: 40, g: 0.55 });
      noise(0, 0.22, { type: "bandpass", f0: 1800, f1: 400, q: 1.5, g: 0.3 });
      noise(0.07, 0.15, { type: "bandpass", f0: 1200, f1: 300, q: 2, g: 0.18 });
    },
    gone() {
      noise(0, 1.5, { f0: 700, f1: 50, g: 0.28, attack: 0.1 });
      tone(0, 1.5, { f0: 80, f1: 28, g: 0.25, attack: 0.1 });
    },
    back() {
      noise(0, 1.3, { f0: 50, f1: 900, g: 0.25, attack: 0.8 });
      tone(0, 1.3, { f0: 30, f1: 90, g: 0.22, attack: 0.8 });
    },
    throwIt() {
      noise(0, 0.4, { type: "bandpass", f0: 400, f1: 3000, q: 0.8, g: 0.3, attack: 0.05 });
      tone(0.15, 0.35, { f0: 100, f1: 42, g: 0.5 });
    },
    creak() {
      for (let i = 0; i < 4; i++) {
        const at = i * rnd(0.1, 0.2), f = rnd(150, 260);
        tone(at, rnd(0.15, 0.3), { type: "sawtooth", f0: f, f1: f * rnd(0.6, 0.85), g: 0.11, lp: 900 });
        noise(at, 0.2, { type: "bandpass", f0: 1200, f1: 700, q: 6, g: 0.09 });
      }
    },
    pluck() {
      const f = [196, 262, 330, 392][Math.floor(Math.random() * 4)];
      tone(0, 0.6, { type: "triangle", f0: f, g: 0.2 });
      tone(0.02, 0.4, { f0: f * 2, g: 0.07 });
    },
    wrong() {
      tone(0, 0.8, { type: "sawtooth", f0: 98, g: 0.22, lp: 500 });
      tone(0, 0.8, { type: "sawtooth", f0: 104, g: 0.2, lp: 500 });
      noise(0, 0.6, { f0: 300, g: 0.12 });
    },
    ignite() {
      tone(0, 0.05, { type: "square", f0: 2400, f1: 1800, g: 0.08 });
      tone(0.09, 0.05, { type: "square", f0: 1600, f1: 1200, g: 0.07 });
      noise(0.12, 0.3, { type: "highpass", f0: 1500, f1: 3000, g: 0.12, attack: 0.03 });
    },
    crackle(dur = 1.2) {
      noise(0, dur, { type: "bandpass", f0: 900, f1: 600, q: 0.7, g: 0.18, attack: 0.15 });
      for (let i = 0; i < 22; i++) noise(rnd(0, dur), rnd(0.012, 0.03), { type: "highpass", f0: rnd(2500, 5500), g: rnd(0.12, 0.3), attack: 0.002 });
    },
    whisper(dur) { noise(0, Math.max(0.5, dur), { type: "bandpass", f0: 3000, f1: 4500, q: 1.2, g: 0.16, attack: 0.3 }); },
    // test helper: render one sound offline and return its samples
    async _render(name, secs) {
      const saved = { ctx, master, noiseBuf, enabled }, oc = new OfflineAudioContext(1, Math.ceil(44100 * secs), 44100);
      setup(oc); enabled = true; Sfx[name](1.2);
      const data = (await oc.startRendering()).getChannelData(0).slice();
      ({ ctx, master, noiseBuf, enabled } = saved);
      return data;
    }
  };
  g.Sfx = Sfx;
})(window);
