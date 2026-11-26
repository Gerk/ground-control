// Copyright 2026 Mark Guertin. Licensed under the Apache License, Version 2.0 (see LICENSE).
// Ground Control graphs: the followed strip's EQ response, compressor and gate curves.
//
// GraphLogic is plain math with no DOM (tested in tests/graphs.test.js). GraphView draws it on
// canvases. Nothing here runs unless the window is showing the graphs. The live parts (level
// meters, gain-reduction and gate bars) are DOM bars moved with CSS transforms, so meter
// updates never redraw a canvas.
//
// The curves are drawn from the strip's settings, not measured from its audio:
// - EQ: textbook analog filter shapes. API's 550 and 560 use "proportional Q" (the band narrows as
//   its gain rises), approximated here, so the shape is close but not exact. The 215 filters are
//   drawn as 12 dB/octave.
// - Compressor and gate: the static input/output curve from threshold, ratio, knee and depth, in
//   the strip's own dB scale. Attack and release don't change it.

const GRAPH_FREQS = (() => {
  const out = [];
  for (let i = 0; i <= 240; i++) out.push(20 * Math.pow(1000, i / 240)); // 20 Hz .. 20 kHz
  return out;
})();

/** |H(jw)| in dB of (b0 s^2 + b1 s + b2) / (a0 s^2 + a1 s + a2), s = j*w (w = f / f0). */
function biquadDb([b0, b1, b2], [a0, a1, a2], w) {
  const nr = b2 - b0 * w * w, ni = b1 * w;
  const dr = a2 - a0 * w * w, di = a1 * w;
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

const GraphLogic = {
  FREQS: GRAPH_FREQS,
  SHELF_Q: Math.SQRT1_2,

  /** API 550 proportional Q: broad at small boosts and cuts, narrower toward +/-12 dB. */
  q550(gainDb) { return 0.55 + 0.11 * Math.abs(gainDb); },
  /** API 560 graphic bands (octave spaced), also proportional. */
  q560(gainDb) { return 0.9 + 0.09 * Math.abs(gainDb); },

  peakDb(f, f0, g, q) {
    if (!g) return 0;
    const A = Math.pow(10, g / 40);
    return biquadDb([1, A / q, 1], [1, 1 / (A * q), 1], f / f0);
  },
  lowShelfDb(f, f0, g, q = GraphLogic.SHELF_Q) {
    if (!g) return 0;
    const A = Math.pow(10, g / 40), r = Math.sqrt(A) / q;
    return 20 * Math.log10(A) + biquadDb([1, r, A], [A, r, 1], f / f0);
  },
  highShelfDb(f, f0, g, q = GraphLogic.SHELF_Q) {
    if (!g) return 0;
    const A = Math.pow(10, g / 40), r = Math.sqrt(A) / q;
    return 20 * Math.log10(A) + biquadDb([A, r, 1], [1, r, A], f / f0);
  },
  highPassDb(f, fc) { return biquadDb([1, 0, 0], [1, Math.SQRT2, 1], f / fc); },
  lowPassDb(f, fc) { return biquadDb([0, 0, 1], [1, Math.SQRT2, 1], f / fc); },

  /**
   * EQ response in dB at each frequency. `eq`:
   *   { on, mode: '550' | '560', bands: [{ type: 'peak'|'lowshelf'|'highshelf', f, g }],
   *     hp: { on, f }, lp: { on, f }, cut50, sc, filtersSc }
   * `cut50` is the preamp's 50 Hz cut; `sc` / `filtersSc` send the EQ / the 215 filters to the
   * compressor's sidechain only, so they shape what it hears, not the audio.
   * Returns { total, filters, heard }: `total` is the settings' whole shape (filters plus bands,
   * whether or not the EQ is on, so it can be drawn greyed); `filters` the filters alone;
   * `heard` what reaches the audio (no bands while the EQ is off or on the sidechain, no 215
   * filters while they're on the sidechain).
   */
  eqResponse(eq, freqs = GRAPH_FREQS) {
    const qFor = eq.mode === '560' ? GraphLogic.q560 : GraphLogic.q550;
    return freqs.reduce((acc, f) => {
      const pre = eq.cut50 ? GraphLogic.highPassDb(f, 50) : 0;
      let filt = 0;
      if (eq.hp?.on && eq.hp.f > 0) filt += GraphLogic.highPassDb(f, eq.hp.f);
      if (eq.lp?.on && eq.lp.f > 0) filt += GraphLogic.lowPassDb(f, eq.lp.f);
      let bands = 0;
      for (const b of eq.bands ?? []) {
        if (b.type === 'lowshelf') bands += GraphLogic.lowShelfDb(f, b.f, b.g);
        else if (b.type === 'highshelf') bands += GraphLogic.highShelfDb(f, b.f, b.g);
        else bands += GraphLogic.peakDb(f, b.f, b.g, qFor(b.g));
      }
      acc.filters.push(pre + filt);
      acc.total.push(pre + filt + bands);
      acc.heard.push(pre + (eq.filtersSc ? 0 : filt) + (eq.on && !eq.sc ? bands : 0));
      return acc;
    }, { total: [], filters: [], heard: [] });
  },

  /** Compressor output level for an input level (dB), with a soft knee `knee` dB wide. */
  compOut(x, { threshold, ratio, knee = 0 }) {
    const r = Math.max(1, ratio || 1);
    const over = x - threshold;
    if (knee > 0 && Math.abs(over) <= knee / 2) {
      return x + ((1 / r - 1) * (over + knee / 2) ** 2) / (2 * knee);
    }
    return over > 0 ? threshold + over / r : x;
  },

  /**
   * Gate/expander output level for an input level (dB). Gate: below threshold the level drops by
   * `depth`. Expand: below threshold it falls 2 dB per dB (1:2), never more than `depth`.
   */
  gateOut(x, { threshold, depth, mode = 'gate' }) {
    if (x >= threshold) return x;
    if (mode === 'expand') return Math.max(x - depth, threshold + (x - threshold) * 2);
    return x - depth;
  },

  /** The Console 1's meter marks, dB → height 0..1 (the hardware's own spacing). */
  METER_MARKS: [[-60, 0], [-24, 33], [-12, 56], [-6, 80], [0, 103], [6, 127]],
  meterPos(db) {
    const m = GraphLogic.METER_MARKS;
    if (!(db > m[0][0])) return 0;
    for (let i = 1; i < m.length; i++) {
      if (db <= m[i][0]) return (m[i - 1][1] + ((db - m[i - 1][0]) / (m[i][0] - m[i - 1][0])) * (m[i][1] - m[i - 1][1])) / 127;
    }
    return 1;
  },

  /** A number out of a display string ("4.0", "4:1", "-10.5 dB"), or null. */
  num(s) {
    const m = /-?\d+(\.\d+)?/.exec(String(s ?? ''));
    return m ? Number(m[0]) : null;
  },

  /**
   * What to draw for a strip, read through `get(id)` → a live control (or undefined).
   * Returns { eq, comp, gate }, each null when the strip has none.
   */
  stateFor(pluginId, get) {
    const real = (id) => { const c = get(id); const v = c?.real.value; return typeof v === 'number' ? v : null; };
    const on = (id) => real(id) === 1;
    const disp = (id) => get(id)?.display.value ?? '';
    if (pluginId === 'uaudio_api_vision_ext') {
      const is560 = real('eq_select') === 1;
      const bands = is560
        ? [[31, '31hz'], [63, '63hz'], [125, '125hz'], [250, '250hz'], [500, '500hz'], [1000, '1khz'], [2000, '2khz'], [4000, '4khz'], [8000, '8khz'], [16000, '16khz']]
          .map(([f, id]) => ({ type: 'peak', f, g: real(`560_${id}`) ?? 0 }))
        : [
          { type: on('550_lf_filter') ? 'peak' : 'lowshelf', f: real('550_lf_freq') ?? 100, g: real('550_lf_gain') ?? 0 },
          { type: 'peak', f: real('550_lmf_freq') ?? 500, g: real('550_lmf_gain') ?? 0 },
          { type: 'peak', f: real('550_hmf_freq') ?? 3000, g: real('550_hmf_gain') ?? 0 },
          { type: on('550_hf_filter') ? 'peak' : 'highshelf', f: real('550_hf_freq') ?? 10000, g: real('550_hf_gain') ?? 0 },
        ];
      const filtersOn = on('215_on');
      const predyn = on('eq_predyn');
      const gain = on('input_select') ? 'mic_gain' : 'line_gain';
      return {
        eq: {
          on: on('eq_on'), mode: is560 ? '560' : '550', bands,
          hp: { on: filtersOn, f: real('215_hp_filter') ?? 0 },
          lp: { on: filtersOn, f: real('215_lp_filter') ?? 0 },
          cut50: on('cut_filter'), sc: on('eq_sc'), filtersSc: on('215_sc'),
          title: is560 ? 'EQ · 560 graphic' : 'EQ · 550',
          filtersNote: [filtersOn ? (on('215_sc') ? 'filters → sidechain' : '') : 'filters off',
            on('eq_sc') ? 'EQ → sidechain' : '', on('cut_filter') ? '50 Hz cut' : ''].filter(Boolean).join(' · '),
        },
        // The strip's switches, grouped and named as on its own panel. `id`: the parameter a click
        // flips; `color`: the LED colour when on (the strip's PAD and POWER light red).
        // `columns`: two columns of [top, bottom] sections, as the strip stacks them.
        strip: {
          power: on('power'),
          columns: [[0, 1], [2, 3]],
          sections: [
            { title: 'Line Amp', value: `${disp('input_select')} ${disp(gain)}`.trim(), buttons: [
              { id: 'pad', label: 'PAD', on: on('pad'), color: 'red', tip: 'Pad' },
              { id: 'phase', label: 'Ø', on: on('phase'), tip: 'Phase invert' },
              { id: 'cut_filter', icon: 'hpf', on: on('cut_filter'), tip: '50 Hz low cut' },
            ] },
            { title: 'Sweep Filter', buttons: [
              { id: '215_sc', label: 'SC', on: on('215_sc'), tip: 'Filters to the compressor sidechain only' },
              { id: '215_on', label: 'ON', on: filtersOn, tip: 'Filters in' },
            ] },
            { title: 'EQ Filter', buttons: [
              { id: 'eq_predyn', label: 'PREDYN', on: predyn, tip: 'EQ before the dynamics' },
              { id: 'eq_select', label: 'TYPE', on: is560, tip: is560 ? '560 graphic EQ' : '550 EQ' },
              { id: 'eq_sc', label: 'DYN SC', on: on('eq_sc'), tip: 'EQ to the compressor sidechain only' },
            ] },
            { title: 'Vision', buttons: [
              { id: 'sc_link', label: 'SC LINK', on: on('sc_link'), tip: 'Stereo sidechain link' },
              { id: 'power', label: 'POWER', on: on('power'), color: 'red', tip: 'Strip power' },
            ] },
          ],
        },
        comp: {
          on: on('225_on'), threshold: real('225_thresh') ?? 0, ratio: real('225_ratio') ?? 1,
          knee: real('225_knee') === 0 ? 10 : 0,
          title: 'Compressor · 225',
          readout: [['Thresh', disp('225_thresh')], ['Ratio', `${disp('225_ratio')}:1`], ['Type', disp('225_type')],
            ['Attack', disp('225_attack')], ['Release', disp('225_release')], ['Knee', disp('225_knee')]],
        },
        gate: {
          on: on('235_on'), threshold: real('235_thresh') ?? -40, depth: real('235_depth') ?? 0,
          mode: real('235_g_e') === 1 ? 'expand' : 'gate',
          title: `${real('235_g_e') === 1 ? 'Expander' : 'Gate'} · 235`,
          readout: [['Thresh', disp('235_thresh')], ['Depth', disp('235_depth')],
            ['Attack', disp('235_attack')], [disp('235_r_h') === 'Hold' ? 'Hold' : 'Release', disp('235_release')]],
        },
      };
    }
    if (pluginId === 'uaudio_api_2500_ext') {
      const threshold = GraphLogic.num(disp('threshold'));
      const ratio = GraphLogic.num(disp('ratio'));
      return {
        eq: null,
        gate: null,
        strip: null,
        comp: threshold === null || ratio === null ? null : {
          on: on('power'), threshold, ratio, knee: 0,
          title: 'Compressor · 2500',
          readout: [['Thresh', disp('threshold')], ['Ratio', disp('ratio')], ['Attack', disp('attack')], ['Release', disp('release')]],
        },
      };
    }
    return { eq: null, comp: null, gate: null, strip: null };
  },
};

// ---------- drawing ----------

const GCOL = {
  bg: '#1a1a1a', grid: '#2c2c2c', gridMajor: '#3a3a3a', axis: '#8a8a8a', curve: '#F7C449',
  off: '#6a6a6a', filter: '#7fb7d9', unity: '#4a4a4a', gr: '#ff9a5a', open: '#6fcf7f', closed: '#ff8080',
};

/** Size a canvas to its box at the screen's pixel density; returns a 2D context in CSS pixels. */
function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  return { ctx, w: canvas.clientWidth, h: canvas.clientHeight };
}

function plotLine(ctx, xs, ys, X, Y, color, width = 2, dash = []) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  xs.forEach((x, i) => (i ? ctx.lineTo(X(x), Y(ys[i])) : ctx.moveTo(X(x), Y(ys[i]))));
  ctx.stroke();
  ctx.restore();
}

function label(ctx, text, x, y, align = 'left', color = GCOL.axis) {
  ctx.fillStyle = color;
  ctx.font = '10px Menlo, monospace';
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}

const GraphView = {
  /** EQ: response over 20 Hz..20 kHz, +/-18 dB. */
  drawEq(canvas, eq) {
    const { ctx, w, h } = fitCanvas(canvas);
    const pad = { l: 30, r: 8, t: 8, b: 18 };
    const lo = Math.log10(20), hi = Math.log10(20000);
    const X = (f) => pad.l + ((Math.log10(f) - lo) / (hi - lo)) * (w - pad.l - pad.r);
    const Y = (db) => pad.t + ((18 - Math.max(-18, Math.min(18, db))) / 36) * (h - pad.t - pad.b);
    ctx.lineWidth = 1;
    for (const f of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
      ctx.strokeStyle = [100, 1000, 10000].includes(f) ? GCOL.gridMajor : GCOL.grid;
      ctx.beginPath(); ctx.moveTo(X(f), pad.t); ctx.lineTo(X(f), h - pad.b); ctx.stroke();
      label(ctx, f >= 1000 ? `${f / 1000}k` : String(f), X(f), h - 5, 'center');
    }
    for (const db of [-18, -12, -6, 0, 6, 12, 18]) {
      ctx.strokeStyle = db === 0 ? GCOL.unity : GCOL.grid;
      ctx.beginPath(); ctx.moveTo(pad.l, Y(db)); ctx.lineTo(w - pad.r, Y(db)); ctx.stroke();
      label(ctx, db > 0 ? `+${db}` : String(db), pad.l - 4, Y(db) + 3, 'right');
    }
    if (!eq) return;
    const { total, heard } = GraphLogic.eqResponse(eq);
    // The settings' shape in yellow while it's what you hear; greyed and dashed while the EQ is
    // off or only on the sidechain. Then what you do hear, in blue, when that differs.
    const eqHeard = eq.on && !eq.sc;
    plotLine(ctx, GraphLogic.FREQS, total, X, Y, eqHeard ? GCOL.curve : GCOL.off, 2, eqHeard ? [] : [4, 4]);
    if ((!eqHeard || eq.filtersSc) && heard.some((d) => Math.abs(d) > 0.05)) plotLine(ctx, GraphLogic.FREQS, heard, X, Y, GCOL.filter, 1.5);
    // The 550's four bands are labelled (the 560's ten would crowd each other).
    const BAND_NAMES = ['LOW', 'LMID', 'HMID', 'HIGH'];
    eq.bands.forEach((b, i) => {
      if (!b.g && eq.mode === '560') return;
      const color = eqHeard && b.g ? GCOL.curve : GCOL.off;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(X(b.f), Y(b.g), 3.5, 0, Math.PI * 2); ctx.fill();
      if (eq.mode === '550') label(ctx, BAND_NAMES[i], X(b.f), Math.max(pad.t + 9, Y(b.g) - 8), 'center', color);
    });
    // The 215 filters' corners: blue rings (grey while the filters are off), on the curve. A corner
    // outside 20 Hz..20 kHz (the filters rest at 12 Hz and 40.8 kHz) sits at the edge with an arrow.
    for (const [key, name] of [['hp', 'HP'], ['lp', 'LP']]) {
      const flt = eq[key];
      if (!(flt?.f > 0)) continue;
      const f = Math.max(20, Math.min(20000, flt.f));
      const out = f !== flt.f;
      const r = GraphLogic.eqResponse(eq, [f]);
      const y = Y((eq.on ? r.total : r.filters)[0]);
      const color = flt.on && !eq.filtersSc ? GCOL.filter : GCOL.off;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.fillStyle = GCOL.bg;
      ctx.beginPath(); ctx.arc(X(f), y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
      const tag = flt.on && eq.filtersSc ? `${name} SC` : name;
      const text = out ? (key === 'hp' ? `‹${tag}` : `${tag}›`) : tag;
      // At an edge, the label goes inside the plot beside the ring, clear of the axis numbers.
      const edge = X(f) < pad.l + 20 ? 'left' : X(f) > w - pad.r - 20 ? 'right' : null;
      const tx = edge === 'left' ? X(f) + 8 : edge === 'right' ? X(f) - 8 : X(f);
      label(ctx, text, tx, edge ? y - 7 : Math.max(pad.t + 9, y - 8), edge ?? 'center', color);
    }
  },

  /** A dynamics curve: output against input, with a unity diagonal. */
  drawDynamics(canvas, spec, { min, max, curve, marker }) {
    const { ctx, w, h } = fitCanvas(canvas);
    const pad = { l: 30, r: 8, t: 8, b: 18 };
    const bar = 30; // room for the live readout bar
    const size = Math.max(10, Math.min(w - pad.l - pad.r - bar, h - pad.t - pad.b));
    const ox = pad.l + Math.max(0, (w - pad.l - pad.r - bar - size) / 2), oy = pad.t;
    const every = size < 220 ? (max - min > 80 ? 40 : 20) : 20; // fewer labels when small
    const S = (v) => ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * size;
    const X = (v) => ox + S(v);
    const Y = (v) => oy + size - S(v);
    ctx.lineWidth = 1;
    for (let v = Math.ceil(min / 10) * 10; v <= max; v += 10) {
      ctx.strokeStyle = v === 0 ? GCOL.gridMajor : GCOL.grid;
      ctx.beginPath(); ctx.moveTo(X(v), oy); ctx.lineTo(X(v), oy + size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox, Y(v)); ctx.lineTo(ox + size, Y(v)); ctx.stroke();
      if (v % every === 0) {
        label(ctx, String(v), X(v), oy + size + 12, 'center');
        label(ctx, String(v), ox - 4, Y(v) + 3, 'right');
      }
    }
    plotLine(ctx, [min, max], [min, max], X, Y, GCOL.unity, 1, [3, 3]);
    if (!spec) return { X, Y, size, ox, oy };
    const xs = [];
    for (let i = 0; i <= 200; i++) xs.push(min + ((max - min) * i) / 200);
    plotLine(ctx, xs, xs.map(curve), X, Y, spec.on ? GCOL.curve : GCOL.off, 2, spec.on ? [] : [4, 4]);
    if (marker !== undefined) {
      ctx.strokeStyle = spec.on ? GCOL.curve : GCOL.off;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(X(marker), oy); ctx.lineTo(X(marker), oy + size); ctx.stroke();
      ctx.setLineDash([]);
    }
    // Where the live readout bar goes (a DOM element moved by the window, so meter updates never
    // redraw this canvas).
    return { X, Y, size, ox, oy, bar: { x: Math.min(w - 14, ox + size + 20), y: oy, h: size } };
  },

  drawComp(canvas, comp) {
    return GraphView.drawDynamics(canvas, comp, { min: -40, max: 20, curve: (x) => GraphLogic.compOut(x, comp), marker: comp?.threshold });
  },

  drawGate(canvas, gate) {
    return GraphView.drawDynamics(canvas, gate, { min: -80, max: 20, curve: (x) => GraphLogic.gateOut(x, gate), marker: gate?.threshold });
  },
};

globalThis.GraphLogic = GraphLogic;
globalThis.GraphView = GraphView;
