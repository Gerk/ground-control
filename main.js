// Copyright 2026 Mark Guertin. Licensed under the Apache License, Version 2.0 (see LICENSE).
// Ground Control: DOM wiring. Connects to LUNA, runs a Console1 (logic.js) on the focused session and
// shows the followed track and the strip's values.

const $ = (id) => document.getElementById(id);
let luna;
let c1;
let queued = false;
let hitTimer;

const status = (text) => { $('status').textContent = text; };

function queueRender() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; render(); });
}

function render() {
  if (!c1) return;
  const s = c1.snapshot();
  $('device').textContent = s.deviceMissing
    ? `"${s.deviceChoice}" not found${s.connected ? `, using "${s.deviceName}"` : ''}`
    : s.connected ? `${s.deviceName} connected` : 'Console 1 not found';
  $('device').hidden = s.connected && !s.deviceMissing; // only shown when something's wrong
  renderDevicePick(s);
  $('track').querySelector('.num').textContent = s.track ? String(s.track.number) : '–';
  $('track').querySelector('.name').textContent = s.track ? s.track.name : 'No track selected';
  const strip = $('strip');
  strip.textContent = !s.track ? '' : s.stripName ?? 'no supported console strip';
  strip.classList.toggle('none', !!s.track && !s.hasStrip);

  const bySection = new Map();
  for (const e of s.entries) {
    if (!bySection.has(e.section)) bySection.set(e.section, []);
    bySection.get(e.section).push(e);
  }
  const root = $('sections');
  root.replaceChildren(...[...bySection].map(([name, entries]) => {
    const sec = document.createElement('section');
    sec.append(Object.assign(document.createElement('h3'), { textContent: name }));
    for (const e of entries) {
      const row = document.createElement('div');
      row.className = 'row' + (e.display === null ? ' na' : '') + (s.lastCc?.cc === e.cc ? ' hit' : '');
      row.append(Object.assign(document.createElement('span'), { textContent: e.label }),
        Object.assign(document.createElement('span'), { className: 'v', textContent: e.display ?? '—' }));
      sec.append(row);
    }
    return sec;
  }));
  if (graphsOn()) { syncGraphSubs(); updateHighlight(); }
}

// ---------- device menu (saved on this machine) ----------

const DEVICE_KEY = 'com.markguertin.groundcontrol.device';
const savedDevice = () => { try { return localStorage.getItem(DEVICE_KEY) || null; } catch { return null; } };
let pickKey = '';

/** Rebuild the device menu only when the list or the choice changed (it would close while open). */
function renderDevicePick(s) {
  const names = [...new Set([...(s.deviceChoice ? [s.deviceChoice] : []), ...s.deviceNames])];
  const key = JSON.stringify([s.deviceChoice, names]);
  if (key === pickKey) return;
  pickKey = key;
  const pick = $('device-pick');
  pick.replaceChildren(new Option('Automatic ("Console 1")', ''), ...names.map((n) => new Option(n, n)));
  pick.value = s.deviceChoice ?? '';
}

$('device-pick').addEventListener('change', (e) => {
  const name = e.target.value;
  try { if (name) localStorage.setItem(DEVICE_KEY, name); else localStorage.removeItem(DEVICE_KEY); } catch {}
  c1?.setDeviceName(name);
});

async function bindSession() {
  c1?.dispose();
  c1 = null;
  const session = luna.sessions.current();
  if (!session) { status('no session open'); return; }
  await session.ready();
  status(''); // the header only speaks up when something's wrong
  c1 = new Console1(luna, session, { deviceName: savedDevice(), onDisplay: showWindow, onMode: cycleView, onChange: () => {
    queueRender();
    clearTimeout(hitTimer);
    hitTimer = setTimeout(() => { if (c1) { c1.lastCc = c1.lastCc && { ...c1.lastCc, cc: -1 }; queueRender(); } }, 600);
  } });
  await c1.start();
  c1.setDisplayLit(document.visibilityState === 'visible');
  render();
}

// The Console 1's Display On button brings this window back (closed or hidden). LUNA has no way
// to hide one Add On window (window.close() needs a click), so closing it is its close button.
// A closed window's page keeps running (run_hidden, no unload_on_close), so the C1 still works.
const ADD_ON_ID = 'com.markguertin.groundcontrol';
function showWindow() {
  if (luna && document.visibilityState !== 'visible') luna.gui.showAddOn(ADD_ON_ID).catch(() => {});
}
document.addEventListener('visibilitychange', () => c1?.setDisplayLit(document.visibilityState === 'visible'));

async function connect() {
  for (;;) {
    try { luna = await Luna.connect(); break; } catch (e) {
      status(e instanceof Luna.NotRunning ? 'waiting for LUNA…' : e.message);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  Luna.bindShortcuts(luna);
  await luna.sessions.ready();
  let last;
  const rebind = () => {
    const uid = luna.sessions.current()?.uid;
    if (uid === last && c1) return;
    last = uid;
    bindSession().catch((e) => status(e.message));
  };
  luna.sessions.focused.onChange(rebind);
  luna.sessions.items.onChange(rebind);
  luna.status.onChange(() => {
    if (luna.status.value === 'disconnected') status('reconnecting…');
    else if (luna.status.value === 'connected') { last = undefined; rebind(); }
  });
  rebind();
}

// ---------- graphs and meters (Values and Graphs toggles, saved on this machine) ----------
// Only while Graphs is on: otherwise nothing here subscribes, computes or draws. Two paths:
// - drawGraphs: the canvases (EQ, gate, compressor curves). Only when a strip setting changes,
//   the strip changes, the view changes or the window resizes.
// - drawLive: level meters and the gain-reduction / gate bars, as CSS transforms on fixed DOM
//   bars (no canvas). On LUNA's meter pushes, at most once per screen frame. A hidden window
//   gets no frames, so it draws nothing.

const VIEW_KEY = 'com.markguertin.groundcontrol.view';
const METERS_KEY = 'com.markguertin.groundcontrol.meters';
const graphsOn = () => document.body.classList.contains('graphs');
const metersOn = () => graphsOn() && document.body.classList.contains('meters');
let graphSlot = null;
let graphUnsubs = [];
let meterList = null;
let meterUnsubs = [];
let graphQueued = false;
let liveQueued = false;
const barGeom = { gate: null, comp: null };
// Which graph lights up when a Console 1 control moves: by section, plus the filters (EQ graph)
// and Drive/Character (the 225's type and knee).
const SECTION_GRAPH = { EQ: 'eq', Comp: 'comp', Shape: 'gate' };
const CC_GRAPH = { 105: 'eq', 103: 'eq', 15: 'comp', 18: 'comp', 107: 'strip', 108: 'strip', 61: 'strip', 58: 'strip', 14: 'strip', 17: 'strip' };
const PEAK_HOLD_MS = 1500;

/** `view`: 'values', 'graphs' or 'both' (what's saved). The two buttons toggle their half. */
function applyView(view) {
  const v = ['values', 'graphs', 'both'].includes(view) ? view : 'values';
  const shown = { values: v !== 'graphs', graphs: v !== 'values' };
  for (const b of $('view').querySelectorAll('button')) {
    if (b.dataset.view !== 'meters') b.setAttribute('aria-pressed', String(shown[b.dataset.view]));
  }
  document.body.classList.toggle('values', shown.values);
  document.body.classList.toggle('graphs', shown.graphs);
  applyMeters(document.body.classList.contains('meters'));
  syncGraphSubs();
  if (graphsOn()) { queueGraphs(); queueLive(); }
}

/**
 * Subscribe while graphs show: every parameter of the followed strip (some aren't on the
 * Console 1) and its meters. Released as soon as Graphs is turned off or the strip changes.
 */
function syncGraphSubs() {
  const on = graphsOn();
  const slot = on ? c1?.slot ?? null : null;
  if (slot !== graphSlot || (!on && graphUnsubs.length)) {
    for (const u of graphUnsubs.splice(0)) u();
    graphSlot = slot;
    if (graphSlot) for (const c of graphSlot.params) graphUnsubs.push(c.real.onChange(queueGraphs));
    if (on) queueGraphs();
  }
  // With the level meters off, only the comp and gate bars' meters are watched.
  const meters = on ? c1?.meterWatchList(metersOn() ? null : ['comp', 'shape']) ?? null : null;
  const same = meters && meterList && meters.length === meterList.length && meters.every((m, i) => m === meterList[i]);
  if (!same) {
    for (const u of meterUnsubs.splice(0)) u();
    meterList = meters;
    for (const m of meterList ?? []) meterUnsubs.push(m.onChange(queueLive));
    if (on) queueLive();
  }
}

function queueGraphs() {
  if (graphQueued) return;
  graphQueued = true;
  requestAnimationFrame(() => { graphQueued = false; drawGraphs(); });
}

function queueLive() {
  if (liveQueued) return;
  liveQueued = true;
  requestAnimationFrame(() => { liveQueued = false; drawLive(); });
}

/** Outline the graph for the section being turned (class toggles only). */
function updateHighlight() {
  const hit = c1?.lastCc && c1.lastCc.cc >= 0 ? CC_GRAPH[c1.lastCc.cc] ?? SECTION_GRAPH[c1.lastCc.entry?.section] : null;
  for (const card of document.querySelectorAll('.graph')) card.classList.toggle('hit', card.dataset.graph === hit);
}

function graphCard(name, spec, emptyText) {
  const card = document.querySelector(`.graph[data-graph="${name}"]`);
  card.querySelector('.none').hidden = !!spec;
  card.querySelector('.none').textContent = c1?.slot ? emptyText : 'No supported console strip';
  card.querySelector('.plot').hidden = !spec;
  if (spec) card.querySelector('.title').textContent = spec.title;
  const state = card.querySelector('.state');
  state.textContent = spec ? (spec.on ? 'on' : 'off') : '';
  state.classList.toggle('on', !!spec?.on);
  card.classList.toggle('on', !!spec?.on);
  queueLive(); // its live bar follows on/off at once
  const detail = card.querySelector('.detail');
  if (detail) detail.textContent = detail.title = spec?.detail ?? '';
  const readout = card.querySelector('.readout');
  if (readout) readout.replaceChildren(...(spec?.readout ?? []).map(([label, value]) => {
    const cell = document.createElement('div');
    cell.title = `${label}: ${value}`;
    cell.append(Object.assign(document.createElement('small'), { textContent: label }), Object.assign(document.createElement('span'), { textContent: value }));
    return cell;
  }));
  return card;
}

/** Put a card's live bar beside its plot (positions from the last canvas draw). */
function placeBar(card, geom) {
  const bar = card.querySelector('.live');
  const text = card.querySelector('.live-text');
  bar.hidden = text.hidden = !geom;
  if (!geom) return;
  const plot = card.querySelector('.plot');
  Object.assign(bar.style, { left: `${plot.offsetLeft + geom.x}px`, top: `${plot.offsetTop + geom.y}px`, height: `${geom.h}px` });
  Object.assign(text.style, { left: `${plot.offsetLeft + geom.x + 3}px`, top: `${plot.offsetTop + geom.y + geom.h + 3}px` });
}

function drawGraphs() {
  if (!graphsOn() || !c1) return;
  syncGraphSubs();
  updateHighlight();
  const slot = c1.slot;
  const st = GraphLogic.stateFor(slot?.pluginId.value, (id) => slot?.params.find((c) => c.id === id));
  const eq = graphCard('eq', st.eq, 'No EQ on this strip');
  if (st.eq) {
    // Frequencies grey, gains gold (`.val`), as the other panes' values.
    const parts = st.eq.mode === '550'
      ? st.eq.bands.map((b) => [`${b.f >= 1000 ? `${b.f / 1000}k` : b.f} `, `${b.g > 0 ? '+' : ''}${b.g}`])
      : [];
    if (st.eq.filtersNote) parts.push([st.eq.filtersNote, null]);
    const detail = eq.querySelector('.detail');
    detail.replaceChildren(...parts.flatMap(([text, gain], i) => [
      ...(i ? [' · '] : []), text,
      ...(gain === null ? [] : [Object.assign(document.createElement('span'), { className: 'val', textContent: gain })]),
    ]));
    GraphView.drawEq(eq.querySelector('canvas'), st.eq);
  }
  const gate = graphCard('gate', st.gate, 'No gate on this strip');
  barGeom.gate = st.gate ? GraphView.drawGate(gate.querySelector('canvas'), st.gate).bar : null;
  const comp = graphCard('comp', st.comp, 'No compressor on this strip');
  barGeom.comp = st.comp ? GraphView.drawComp(comp.querySelector('canvas'), st.comp).bar : null;
  placeBar(gate, barGeom.gate);
  placeBar(comp, barGeom.comp);
  drawStrip(st.strip);
  drawLive();
}

// Clicking a strip button flips that switch in LUNA (one undo step); the redraw follows LUNA.
document.querySelector('.graph.strip .sw-sections').addEventListener('click', (e) => {
  const id = e.target.closest('button.sw')?.dataset.id;
  if (id) c1?.toggleParam(id);
});

const HPF_ICON = '<svg viewBox="0 0 16 10" aria-hidden="true"><path d="M1 9 L6 2 H15" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

/** Strip pane: the strip's switches as lit/greyed buttons, in the strip's own sections. */
function drawStrip(strip) {
  const card = document.querySelector('.graph.strip');
  card.querySelector('.none').hidden = !!strip;
  card.querySelector('.none').textContent = c1?.slot ? 'No switches for this strip' : 'No supported console strip';
  const state = card.querySelector('.state');
  state.textContent = strip ? (strip.power ? 'on' : 'off') : '';
  state.classList.toggle('on', !!strip?.power);
  const box = card.querySelector('.sw-sections');
  const input = card.querySelector('.sw-input');
  box.hidden = input.hidden = !strip;
  if (!strip) return;
  // The input on its own line above the switches: source and gain (the strip's GAIN knob).
  const inputSec = strip.sections.find((sec) => sec.value);
  input.hidden = !inputSec;
  if (inputSec) {
    const [source, ...gain] = inputSec.value.split(' ');
    input.replaceChildren(Object.assign(document.createElement('small'), { textContent: 'Input' }),
      Object.assign(document.createElement('b'), { textContent: source }),
      Object.assign(document.createElement('span'), { textContent: gain.join(' ') }));
    input.title = `Input: ${inputSec.value}`;
  }
  const section = (sec) => {
    const el = Object.assign(document.createElement('div'), { className: 'sw-sec' });
    const h = Object.assign(document.createElement('h4'), { textContent: sec.title });
    const btns = Object.assign(document.createElement('div'), { className: 'sw-btns' });
    for (const b of sec.buttons) {
      const sw = Object.assign(document.createElement('button'), { type: 'button', className: `sw${b.on ? ' on' : ''}${b.color === 'red' ? ' red' : ''}`, title: `${b.tip}: ${b.on ? 'on' : 'off'} (click to switch)` });
      sw.dataset.id = b.id;
      const face = document.createElement('b');
      if (b.icon === 'hpf') face.innerHTML = HPF_ICON; else face.textContent = b.label;
      sw.append(document.createElement('i'), face);
      btns.append(sw);
    }
    el.append(h, btns);
    return el;
  };
  box.replaceChildren(...strip.columns.map((ids) => {
    const col = Object.assign(document.createElement('div'), { className: 'sw-col' });
    col.append(...ids.map((i) => section(strip.sections[i])));
    return col;
  }));
}

// ---------- live parts ----------

const peaks = new Map(); // bar element -> { pos, t }

function setText(el, text) { if (el.textContent !== text) el.textContent = text; }

function setMeter(name, dbs) {
  const meter = document.querySelector(`.meter[data-meter="${name}"]`);
  meter.classList.toggle('none', !dbs);
  const now = performance.now();
  meter.querySelectorAll('.bar').forEach((bar, i) => {
    const pos = dbs ? GraphLogic.meterPos(dbs[i]) : 0;
    bar.firstElementChild.style.transform = `scaleY(${(1 - pos).toFixed(3)})`;
    let pk = peaks.get(bar);
    if (!pk || pos >= pk.pos || now - pk.t > PEAK_HOLD_MS) { pk = { pos, t: now }; peaks.set(bar, pk); }
    bar.lastElementChild.style.transform = `translateY(${((1 - pk.pos) * 100).toFixed(1)}%)`; // % of its own (full) height: no layout read
    bar.lastElementChild.style.opacity = pk.pos > 0 ? '1' : '0';
  });
}

/** IN: light `n` of the five LEDs (null: none, greyed). */
function setInputLeds(n) {
  const meter = document.querySelector('.meter[data-meter="input"]');
  meter.classList.toggle('none', n === null);
  meter.querySelectorAll('.led').forEach((led, i) => led.classList.toggle('on', n !== null && i < n));
}

function drawLive() {
  if (!graphsOn() || !c1) return;
  if (metersOn()) {
    setInputLeds(c1.inputLeds());
    setMeter('output', c1.levelsDb().output);
  }
  const { grDb, gateClosed } = c1.dynamicsReadout();
  const comp = document.querySelector('.graph.comp');
  // A section that's off shows its bar empty and greyed: an off 2500 reports its G/R meter
  // at full scale, which would read as maxed out.
  if (barGeom.comp) {
    const on = comp.classList.contains('on');
    const gr = on ? grDb ?? 0 : 0;
    comp.querySelector('.live i').style.transform = `scaleY(${Math.max(0, Math.min(1, gr / 20)).toFixed(3)})`;
    setText(comp.querySelector('.live-text'), !on || grDb === null ? '' : gr >= 0.5 ? `-${gr.toFixed(0)}` : '0');
  }
  const gate = document.querySelector('.graph.gate');
  if (barGeom.gate) {
    const on = gate.classList.contains('on');
    const closed = on ? gateClosed ?? 0 : 0;
    const shut = closed > 0.5;
    gate.querySelector('.live i').style.transform = `scaleY(${Math.max(0, Math.min(1, closed)).toFixed(3)})`;
    gate.querySelector('.live').classList.toggle('closed', shut);
    gate.querySelector('.live-text').classList.toggle('closed', shut);
    setText(gate.querySelector('.live-text'), !on || gateClosed === null ? '' : shut ? 'closed' : 'open');
  }
}

/** IN's five LEDs, bottom to top, labelled and coloured as the API strip's VU (-12 .. +18). */
for (const [db, cls] of [['-12', ''], ['-6', ''], ['0', ''], ['+8', 'warn'], ['+18', 'hot']]) {
  const led = Object.assign(document.createElement('div'), { className: `led ${cls}`.trim() });
  led.append(Object.assign(document.createElement('span'), { textContent: String(db) }), document.createElement('i'));
  document.querySelector('.meter[data-meter="input"] .leds').append(led);
}

/** OUT's scale marks, placed once (the C1's printed marks). */
for (const scale of document.querySelectorAll('.meter .scale')) {
  for (const [db] of GraphLogic.METER_MARKS) {
    scale.append(Object.assign(document.createElement('span'), { textContent: db > 0 ? `+${db}` : String(db), style: `bottom:${(GraphLogic.meterPos(db) * 100).toFixed(1)}%` }));
  }
}

/** Level meters on or off (with the graphs; the button is greyed without them). Off leaves the
 * meters in place, greyed and empty, so the layout doesn't change. */
function applyMeters(on) {
  document.body.classList.toggle('meters', on);
  const b = $('view').querySelector('[data-view="meters"]');
  b.setAttribute('aria-pressed', String(on && graphsOn()));
  b.disabled = !graphsOn();
  syncGraphSubs();
  if (metersOn()) queueLive();
  else if (graphsOn()) { setInputLeds(null); setMeter('output', null); } // empty them, once
}

$('view').addEventListener('click', (e) => {
  const which = e.target.closest('button')?.dataset.view;
  if (!which) return;
  if (which === 'meters') {
    const on = !document.body.classList.contains('meters');
    try { localStorage.setItem(METERS_KEY, on ? 'on' : 'off'); } catch {}
    applyMeters(on);
    return;
  }
  const shown = { values: document.body.classList.contains('values'), graphs: graphsOn() };
  shown[which] = !shown[which];
  if (!shown.values && !shown.graphs) return; // one always stays on
  const view = shown.values && shown.graphs ? 'both' : shown.graphs ? 'graphs' : 'values';
  try { localStorage.setItem(VIEW_KEY, view); } catch {}
  applyView(view);
});
// The Console 1's Mode button steps through the views: values, graphs, graphs with meters, everything.
const VIEW_CYCLE = [['values', false], ['graphs', false], ['graphs', true], ['both', true]];
function cycleView() {
  const values = document.body.classList.contains('values');
  const view = values && graphsOn() ? 'both' : graphsOn() ? 'graphs' : 'values';
  const meters = document.body.classList.contains('meters');
  const i = VIEW_CYCLE.findIndex(([v, m]) => v === view && (v === 'values' || m === meters));
  const [next, nextMeters] = VIEW_CYCLE[(i + 1) % VIEW_CYCLE.length];
  try { localStorage.setItem(VIEW_KEY, next); localStorage.setItem(METERS_KEY, nextMeters ? 'on' : 'off'); } catch {}
  document.body.classList.toggle('meters', nextMeters);
  applyView(next);
}
// Each plot, not just the whole area: the rows rebalance inside it (another strip's buttons) without the area changing size.
const plotWatch = new ResizeObserver(() => { if (graphsOn()) queueGraphs(); });
for (const plot of document.querySelectorAll('#graphs .plot')) plotWatch.observe(plot);
try { document.body.classList.toggle('meters', localStorage.getItem(METERS_KEY) !== 'off'); } catch { document.body.classList.add('meters'); }
try { applyView(localStorage.getItem(VIEW_KEY)); } catch { applyView('values'); }

// ---------- settings dialog ----------

$('settings-btn').addEventListener('click', () => $('settings').showModal());
$('settings-close').addEventListener('click', () => $('settings').close());
$('settings').addEventListener('click', (e) => { if (e.target === $('settings')) $('settings').close(); }); // click outside

// ---------- meter settings (live, saved on this machine) ----------

const TUNING_KEY = 'com.markguertin.groundcontrol.tuning';

function saveTuning() {
  try { localStorage.setItem(TUNING_KEY, JSON.stringify(Console1Logic.tuning)); } catch {}
}

function buildTuning() {
  try { Console1Logic.setTuning(JSON.parse(localStorage.getItem(TUNING_KEY) ?? '{}')); } catch {}
  const grid = $('tuning-grid');
  const inputs = new Map();
  for (const f of Console1Logic.TUNING_FIELDS) {
    const input = Object.assign(document.createElement('input'), { type: 'number', min: f.min, max: f.max, step: f.step, value: Console1Logic.tuning[f.key] });
    input.title = `default ${f.def}`;
    input.addEventListener('input', () => {
      Console1Logic.setTuning({ [f.key]: input.value });
      saveTuning();
      c1?.updateMeters(); // trim and aim apply at once
    });
    input.addEventListener('change', () => { input.value = Console1Logic.tuning[f.key]; }); // show the clamped value
    inputs.set(f.key, input);
    grid.append(Object.assign(document.createElement('label'), { textContent: f.label }), input,
      Object.assign(document.createElement('span'), { className: 'unit', textContent: `${f.unit} (default ${f.def})` }));
  }
  $('tuning-reset').addEventListener('click', () => {
    Console1Logic.resetTuning();
    saveTuning();
    for (const [key, input] of inputs) input.value = Console1Logic.tuning[key];
    c1?.updateMeters();
  });
}

buildTuning();
window.addEventListener('beforeunload', () => { for (const u of [...graphUnsubs.splice(0), ...meterUnsubs.splice(0)]) u(); c1?.dispose(); });
connect();
