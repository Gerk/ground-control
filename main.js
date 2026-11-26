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
  $('device').classList.toggle('ok', s.connected && !s.deviceMissing);
  renderDevicePick(s);
  $('track').querySelector('.num').textContent = s.track ? String(s.track.number) : '–';
  $('track').querySelector('.name').textContent = s.track ? s.track.name : 'No track selected';
  const strip = $('track').querySelector('.strip');
  strip.textContent = !s.track ? '' : s.hasStrip ? 'API Vision' : 'no API Vision strip';
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
  if (s.lastCc) $('footer').textContent = `CC${s.lastCc.cc} = ${s.lastCc.value}${s.lastCc.entry ? ` · ${s.lastCc.entry.label}` : ''}`;
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
  status(session.name.value ?? session.uid);
  c1 = new Console1(luna, session, { deviceName: savedDevice(), onChange: () => {
    queueRender();
    clearTimeout(hitTimer);
    hitTimer = setTimeout(() => { if (c1) { c1.lastCc = c1.lastCc && { ...c1.lastCc, cc: -1 }; queueRender(); } }, 600);
  } });
  await c1.start();
  render();
}

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
window.addEventListener('beforeunload', () => c1?.dispose());
connect();
