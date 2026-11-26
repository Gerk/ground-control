// Copyright 2026 Mark Guertin. Licensed under the Apache License, Version 2.0 (see LICENSE).
// Runs against Luna.MockEngine: no LUNA needed. `npm test`.
import { describe, expect, it } from 'vitest';
import { Luna } from '@uaudio/luna-builder-sdk';

globalThis.Luna = Luna; // logic.js is a classic script that reads the Luna global
await import('../logic.js');
const { Console1Logic, Console1 } = globalThis;
const API = Console1Logic.API_STRIP;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** API Vision's parameters as LUNA lists them (a subset), added to a track's console slot. */
function addApiStrip(engine, base) {
  const add = (id, name, o) => { engine.addControl(`${base}/${id}`, 'parameter', o); engine.setValue(`${base}/${id}`, 'name', name); };
  const stepped = (id, name, strs, index = 0) => {
    add(id, name, { discrete: true, value: index, real: index, str: strs[index], automatable: true, normalized: index / (strs.length - 1) });
    engine.setValue(`${base}/${id}`, 'num_steps', strs.length);
    engine.setValue(`${base}/${id}`, 'real_values', strs.map((_, i) => i));
    engine.setValue(`${base}/${id}`, 'string_values', strs);
  };
  stepped('input_select', 'Input Select', ['Line', 'Mic']);
  add('line_gain', 'Line Gain', { discrete: false, value: 0, real: 0, str: '0.0 dB', automatable: true });
  add('mic_gain', 'Mic Gain', { discrete: false, value: 0.429, real: 40.5, str: '40.5 dB', automatable: true });
  add('215_lp_filter', '215 LP Filter', { discrete: false, value: 1, real: 1, str: '40.8 k', automatable: true });
  add('215_hp_filter', '215 HP Filter', { discrete: false, value: 0, real: 12, str: '12.0 Hz', automatable: true });
  stepped('215_on', '215 On', ['Off', 'On']);
  stepped('pad', 'Pad', ['Off', 'On']);
  stepped('cut_filter', 'Cut Filter', ['Off', '50 Hz']);
  stepped('phase', 'Phase', ['Normal', 'Inverted']);
  stepped('eq_on', 'EQ On', ['Off', 'On']);
  stepped('550_lf_gain', '550 LF Gain', ['-12 dB', '-9 dB', '-6 dB', '-4 dB', '-2 dB', '0 dB', '2 dB', '4 dB', '6 dB', '9 dB', '12 dB'], 5);
  stepped('550_lf_filter', '550 LF Filter', ['Shelf', 'Peak']);
  add('225_thresh', '225 Thresh', { discrete: false, value: 0, real: 13, str: '13.0 dB', automatable: true });
}

async function setup({ c1 = true } = {}) {
  const engine = new Luna.MockEngine();
  engine.addSession('abc', { name: 'Mix', tracks: ['Piano', 'Organ', 'Bass'] });
  engine.addPlugin(API, { name: 'API Vision Channel Strip' });
  engine.addMidiDevice('Keyboard', { uid: 'kbd' }); // LUNA always has a MIDI device list
  if (c1) engine.addMidiDevice('Console 1', { uid: 'c1' });
  await engine.settled();
  const luna = await Luna.connect({ port_: engine.port() });
  const session = await luna.session();
  // API Vision in the console slot of Piano and Organ; Bass has none.
  for (const name of ['Piano', 'Organ']) {
    const t = session.tracks.items.find((x) => x.name.value === name);
    engine.addNode(`${t.path}/effects/console`, { properties: { uid: `console_${name}`, insert_type: 'console', plugin_id: API, plugin_name: 'API Vision Channel Strip', external_sdk_instance_id: 7, plugin_error: null } });
    engine.addNode(`${t.path}/effects/console/controls`);
    addApiStrip(engine, `${t.path}/effects/console/controls`);
  }
  await engine.settled();
  const track = (name) => session.tracks.items.find((x) => x.name.value === name);
  const select = async (name) => {
    engine.setValue(session.context.path, 'last_selected_track', track(name).id);
    engine.setValue(session.context.path, 'selection_tracks', [track(name).id]);
    await engine.settled();
  };
  await select('Piano');
  const c = new Console1(luna, session, {});
  await c.start();
  await settle(engine, c);
  return { engine, luna, session, c, track, select, strip: (name) => `${track(name).path}/effects/console/controls` };
}

async function cc(engine, c, list) {
  engine.receiveMidi('Console 1', list.map(([n, v]) => [0xb0, n, v]));
  await engine.settled();
  await wait(20);
  await c.binding;
  await engine.settled();
}

/** Let pushes arrive, the follow chain run and sends land. */
async function settle(engine, c) {
  for (let i = 0; i < 3; i++) {
    await engine.settled();
    await wait(25);
    await c.binding;
  }
  await engine.settled();
}

const sentTo = (engine, n) => engine.midiSent.filter((m) => m.outputPortUid && m.bytes?.[1] === n).map((m) => m.bytes[2]);

describe('Console1Logic', () => {
  it('maps every layout CC once', () => {
    const ccs = Console1Logic.LAYOUT.map((e) => e.cc);
    expect(new Set(ccs).size).toBe(ccs.length);
  });

  it('puts stepped values in the middle of their band and back', () => {
    const control = { discrete: { value: true }, numSteps: { value: 11 }, realValues: { value: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }, real: { value: 5 }, normalized: { value: 0.5 } };
    const cc = Console1Logic.ccFor(control);
    expect(Console1Logic.valueFor(control, cc)).toEqual({ view: 'real', value: 5 });
    expect(Console1Logic.valueFor(control, cc + 3)).toEqual({ view: 'real', value: 5 }); // one detent stays on the step
  });
});

describe('meter scale', () => {
  it('takes live tuning, clamped, and resets to the defaults', () => {
    const base = Console1Logic.dbCc(-12);
    const t = Console1Logic.setTuning({ offsetDb: 6, compReleaseMs: 9999, ledShift: 'x' });
    expect(t.offsetDb).toBe(6);
    expect(t.compReleaseMs).toBe(500);                       // clamped to its max
    expect(t.ledShift).toBe(-4);                         // not a number: unchanged
    expect(Console1Logic.dbCc(-12)).not.toBe(base);      // +6 dB trim moved it
    Console1Logic.resetTuning();
    expect(Console1Logic.dbCc(-12)).toBe(base);
    expect(Console1Logic.ROW_STEP_MS).toBe(25);
  });

  it('maps the strip meters onto the Console 1 rows', () => {
    expect(Console1Logic.inputCc(1)).toBe(Console1Logic.dbCc(0));
    expect(Console1Logic.inputCc(0.8)).toBe(Console1Logic.dbCc(-6));
    expect(Console1Logic.inputCc(0)).toBe(0);
    expect(Console1Logic.compLed(0)).toBe(10);
    expect(Console1Logic.compLed(1)).toBe(2);
    expect(Console1Logic.shapeLed(0)).toBe(5);
    expect(Console1Logic.shapeLed(1)).toBe(0);
    expect(Console1Logic.rowCc(0)).toBe(0);
    expect(Console1Logic.rowCc(10)).toBe(121);
  });

  it('puts the printed marks where they sit on the Console 1', () => {
    const at = (db) => Console1Logic.dbCc(db);
    // Marks sit on LEDs 4 (-24), 7 (-12), 10 (-6), 13 (0), 16 (+6); each must top out exactly there.
    const led = (db) => Console1Logic.ledFor(at(db));
    expect(led(0)).toBe(13);
    expect(led(-6)).toBe(10);
    expect(led(-12)).toBe(7);
    expect(led(-24)).toBe(4);
    expect(led(6)).toBe(16);
    // The measured tone levels: -18/-12/-6/0 dBFS read 0.4545/0.6364/0.8182/1.0 in LUNA.
    expect(Console1Logic.levelDb(0.4545)).toBeCloseTo(-18, 0);
    expect(Console1Logic.levelDb(0.6364)).toBeCloseTo(-12, 0);
    expect(Console1Logic.levelDb(0.8182)).toBeCloseTo(-6, 0);
    // Below -18 LUNA's scale bends (measured 2026-11-25): no cliff, the bottom is about -60.
    expect(Console1Logic.levelDb(0.1392)).toBeCloseTo(-40.7, 1);
    expect(Console1Logic.levelDb(0.0517)).toBeCloseTo(-52.1, 1);
    expect(Console1Logic.ledFor(Console1Logic.meterCc(0.1392))).toBeLessThan(4);  // -41 sits below the -24 mark
    expect(Console1Logic.ledFor(Console1Logic.meterCc(0.0517))).toBeGreaterThan(0); // -52 still lights
    expect(Console1Logic.ledFor(Console1Logic.meterCc(1))).toBe(13);
    expect(Console1Logic.meterCc(0)).toBe(0);
    expect(Console1Logic.ledFor(Console1Logic.meterCc(4))).toBe(16);
  });
});

describe('Console1', () => {
  it('follows the selected track and lights its button', async () => {
    const { engine, c, select } = await setup();
    expect(c.track.name.value).toBe('Piano');
    expect(c.slot).not.toBe(null);
    // Buttons count channels in LUNA's order; the mock puts Main Output first: Main, Piano, Organ, Bass.
    expect(c.tracks().map((ch) => ch.name.value)).toEqual(['Main Output', 'Piano', 'Organ', 'Bass']);
    expect(sentTo(engine, 22).at(-1)).toBe(127); // Piano is button 2
    await select('Organ');
    await settle(engine, c);
    expect(c.track.name.value).toBe('Organ');
    expect(sentTo(engine, 23).at(-1)).toBe(127);
    expect(sentTo(engine, 22).at(-1)).toBe(0);
  });

  it('selects tracks from the track buttons and Page -/+', async () => {
    const { engine, session, c } = await setup();
    await cc(engine, c, [[24, 127]]); // Select Track 4 (Main Output is 1)
    expect(session.context.selectionTracks.value).toEqual([session.tracksInOrder[2].id]);
    expect(c.track.name.value).toBe('Bass');
    await cc(engine, c, [[97, 127]]); // Page - : previous track
    expect(c.track.name.value).toBe('Organ');
    await cc(engine, c, [[40, 127]]); // Track 20 does not exist: nothing changes
    expect(c.track.name.value).toBe('Organ');
  });

  it('turns a knob into one gesture on the API parameter', async () => {
    const { engine, c, strip } = await setup();
    await cc(engine, c, [[47, 30], [47, 60], [47, 90]]); // Threshold
    expect(engine.value(`${strip('Piano')}/225_thresh`, 'normalized_value')).toBeCloseTo(90 / 127);
    await c.releaseAll();
    await engine.settled();
    await wait(20);
    const touches = engine.touches.filter((t) => t.includes('225_thresh'));
    expect(touches).toEqual([`${strip('Piano')}/225_thresh:on`, `${strip('Piano')}/225_thresh:off`]);
  });

  it('steps a stepped parameter and snaps the ring to it after the turn', async () => {
    const { engine, c, strip } = await setup();
    await cc(engine, c, [[91, 127]]); // Low Gain to the top
    expect(engine.value(`${strip('Piano')}/550_lf_gain`, 'real_value')).toBe(10);
    await wait(Console1Logic.GESTURE_IDLE_MS + 60);
    await engine.settled();
    expect(sentTo(engine, 91).at(-1)).toBe(Math.floor(10.5 * 128 / 11));
  });

  it('flips switches with a button press and lights them', async () => {
    const { engine, c, strip } = await setup();
    await cc(engine, c, [[80, 127]]); // EQ On
    expect(engine.value(`${strip('Piano')}/eq_on`, 'real_value')).toBe(1);
    expect(sentTo(engine, 80).at(-1)).toBe(127);
    await cc(engine, c, [[80, 127]]);
    expect(engine.value(`${strip('Piano')}/eq_on`, 'real_value')).toBe(0);
    expect(sentTo(engine, 80).at(-1)).toBe(0);
    await cc(engine, c, [[93, 63]]); // Low Cut/Bell/Shelf: Shelf -> Peak, LED shows "Bell"
    expect(engine.value(`${strip('Piano')}/550_lf_filter`, 'real_value')).toBe(1);
    expect(sentTo(engine, 93).at(-1)).toBe(63);
  });

  it('switches the 215 filters on when a cut knob leaves its end, and off when both are back', async () => {
    const { engine, c, strip } = await setup();
    const on = () => engine.value(`${strip('Piano')}/215_on`, 'real_value');
    expect(on()).toBe(0);
    await cc(engine, c, [[103, 40]]); // Low Cut up from 12 Hz
    expect(on()).toBe(1);
    await cc(engine, c, [[105, 90]]); // High Cut down too: stays on
    expect(on()).toBe(1);
    await cc(engine, c, [[103, 0]]); // Low Cut back; High Cut still in
    expect(on()).toBe(1);
    await cc(engine, c, [[105, 127]]); // both at rest: off
    expect(on()).toBe(0);
  });

  it('flips a strip switch from the window, one touch each, and relights a Console 1 LED on it', async () => {
    const { engine, c, strip } = await setup();
    await c.toggleParam('pad');
    await engine.settled();
    expect(engine.value(`${strip('Piano')}/pad`, 'real_value')).toBe(1);
    await c.toggleParam('pad');
    await engine.settled();
    expect(engine.value(`${strip('Piano')}/pad`, 'real_value')).toBe(0);
    await c.toggleParam('phase'); // also the Console 1's Phase Inv. button
    await settle(engine, c);
    expect(engine.value(`${strip('Piano')}/phase`, 'real_value')).toBe(1);
    expect(sentTo(engine, 108).at(-1)).toBe(127);
    await c.toggleParam('no_such_switch'); // ignored
  });

  it('Mode asks the page for its next view, and only blinks', async () => {
    const { engine, c, track } = await setup();
    let presses = 0;
    c.onMode = () => { presses++; };
    await cc(engine, c, [[104, 127]]);
    await cc(engine, c, [[104, 0]]);
    expect(presses).toBe(2);
    expect(c.track).toBe(track('Piano'));
    await wait(200);
    await settle(engine, c);
    expect(sentTo(engine, 104).at(-1)).toBe(0); // put back off after the press
  });

  it('Display On asks the page to show or hide its window, and lights while it shows', async () => {
    const { engine, c, track } = await setup();
    let presses = 0;
    c.onDisplay = () => { presses++; };
    await cc(engine, c, [[102, 127]]);
    await cc(engine, c, [[102, 0]]); // the unit alternates; each message is a press
    expect(presses).toBe(2);
    expect(c.track).toBe(track('Piano')); // nothing else moved
    c.setDisplayLit(true);
    await settle(engine, c);
    expect(sentTo(engine, 102).at(-1)).toBe(127);
    c.setDisplayLit(false);
    await settle(engine, c);
    expect(sentTo(engine, 102).at(-1)).toBe(0);
    c.setDisplayLit(true);
    await settle(engine, c);
    await cc(engine, c, [[102, 0]]); // pressed while showing: the unit turns its LED off
    await settle(engine, c);
    expect(sentTo(engine, 102).at(-1)).toBe(127); // and it's put back on
  });

  it('Filters to Comp and Preset drive the strip\'s PAD and 50 Hz cut', async () => {
    const { engine, c, strip } = await setup();
    await cc(engine, c, [[61, 127]]);
    expect(engine.value(`${strip('Piano')}/pad`, 'real_value')).toBe(1);
    expect(sentTo(engine, 61).at(-1)).toBe(127);
    await cc(engine, c, [[58, 127]]);
    expect(engine.value(`${strip('Piano')}/cut_filter`, 'real_value')).toBe(1);
    await cc(engine, c, [[58, 0]]);
    expect(engine.value(`${strip('Piano')}/cut_filter`, 'real_value')).toBe(0);
    expect(sentTo(engine, 58).at(-1)).toBe(0);
  });

  it('drives Input Gain to Line or Mic gain by the input switch', async () => {
    const { engine, c, strip } = await setup();
    await cc(engine, c, [[107, 127]]);
    expect(engine.value(`${strip('Piano')}/line_gain`, 'normalized_value')).toBeCloseTo(1);
    engine.setValue(`${strip('Piano')}/input_select`, 'real_value', 1);
    engine.setValue(`${strip('Piano')}/input_select`, 'string_value', 'Mic');
    await engine.settled();
    await c.releaseAll();
    await cc(engine, c, [[107, 0]]);
    expect(engine.value(`${strip('Piano')}/mic_gain`, 'normalized_value')).toBeCloseTo(0);
  });

  it('mirrors changes made in LUNA onto the rings', async () => {
    const { engine, c, strip } = await setup();
    engine.setValue(`${strip('Piano')}/225_thresh`, 'normalized_value', 0.5);
    await settle(engine, c);
    expect(sentTo(engine, 47).at(-1)).toBe(64);
  });

  it('drives volume, pan, mute and solo on a track without the strip', async () => {
    const { engine, c, select, track } = await setup();
    await select('Bass');
    await settle(engine, c);
    expect(c.slot).toBe(null);
    await cc(engine, c, [[12, 127]]); // Mute
    expect(track('Bass').mute.on).toBe(true);
    await cc(engine, c, [[7, 127]]); // Volume to the top
    expect(track('Bass').gain.normalized.value).toBeCloseTo(1);
    await c.releaseAll();
    await cc(engine, c, [[47, 90]]); // Threshold: no strip, so the ring goes back to 0
    expect(sentTo(engine, 47).at(-1)).toBe(0);
  });

  it('pans a stereo track by its heard centre: straight up is L100/R100', async () => {
    const { engine, c, select, track } = await setup();
    engine.addTrack('abc', 'keys', { name: 'Keys', stemFormat: 'stereo' });
    for (let i = 0; i < 20 && !track('Keys'); i++) { await engine.settled(); await wait(10); }
    const main = track('Keys').main;
    await main.controls.load?.();
    const [L, R] = main.pans;
    await L.normalized.set(0);
    await R.normalized.set(1);
    await select('Keys');
    await settle(engine, c);
    expect(L.normalized.value).toBe(0);                // selecting writes nothing
    expect(R.normalized.value).toBe(1);
    expect(sentTo(engine, 10).at(-1)).toBe(64);         // ring straight up
    await cc(engine, c, [[10, 95]]);                    // right: L comes across, R stays
    const want = Console1Logic.stereoPans(95 / 127);
    expect(L.normalized.value).toBeCloseTo(want.l, 3);
    expect(R.normalized.value).toBe(1);
    expect(want.l).toBeGreaterThan(95 / 127 - 0.5);     // the curve, not a straight line
    await cc(engine, c, [[10, 127]]);                   // hard right: both at 100R
    expect(L.normalized.value).toBeCloseTo(1, 3);
    await cc(engine, c, [[10, 20]]);                    // left: R comes across, L at 100L
    expect(L.normalized.value).toBeCloseTo(0, 3);
    expect(R.normalized.value).toBeCloseTo(Console1Logic.stereoPans(20 / 127).r, 3);
    await cc(engine, c, [[10, 64]]);                    // back up: full width again
    expect(L.normalized.value).toBeCloseTo(0, 2);
    expect(R.normalized.value).toBeCloseTo(1, 2);
    await c.releaseAll();
    await settle(engine, c);
    expect(sentTo(engine, 10).at(-1)).toBe(64);
    for (const k of [0, 0.2, 0.5, 0.7, 1]) {            // ring reads the curve back
      const p = Console1Logic.stereoPans(k);
      expect(Console1Logic.stereoKnob(p.l, p.r)).toBeCloseTo(k, 3);
    }
  });

  it('finds a renamed unit: by a name containing "Console 1", or the one chosen', async () => {
    const { engine, c } = await setup({ c1: false });
    engine.addMidiDevice('Desk', { uid: 'desk' });
    await settle(engine, c);
    expect(c.device).toBe(null);                          // nothing called Console 1
    expect(c.deviceNames()).toContain('Desk');
    c.setDeviceName('Desk');                              // chosen in the window
    await settle(engine, c);
    expect(c.device?.name.value).toBe('Desk');
    expect(c.snapshot().deviceMissing).toBe(false);
    engine.receiveMidi('Desk', [[0xb0, 7, 127]]);        // it drives the track
    await settle(engine, c);
    expect(c.track.gain.normalized.value).toBeCloseTo(1);
    c.setDeviceName('Gone');                              // chosen one missing: automatic, flagged
    await settle(engine, c);
    expect(c.device).toBe(null);
    expect(c.snapshot().deviceMissing).toBe(true);
    engine.addMidiDevice('Console 1 Mk II', { uid: 'c1b' }); // automatic: name contains Console 1
    await settle(engine, c);
    expect(c.device?.name.value).toBe('Console 1 Mk II');
    c.setDeviceName(null);
    expect(c.snapshot().deviceMissing).toBe(false);
  });

  it('waits quietly without a Console 1 and picks it up when it appears', async () => {
    const { engine, c } = await setup({ c1: false });
    expect(c.device).toBe(null);
    engine.addMidiDevice('Console 1', { uid: 'c1' });
    await settle(engine, c);
    expect(c.device?.name.value).toBe('Console 1');
  });

  it('skips LUNA\'s hidden click and count-in tracks', async () => {
    const { engine, c, track } = await setup();
    engine.setValue(track('Organ').path, 'track_type', 'click'); // Organ stands in for CLICK
    await settle(engine, c);
    await cc(engine, c, [[23, 127]]); // Select Track 3 is now Bass (Main Output, Piano, Bass)
    expect(c.track.name.value).toBe('Bass');
  });

  it('drives the output meter from the track and holds a steady level', async () => {
    const { engine, c, track } = await setup();
    const meterPath = `${track('Piano').path}/outputs/main/meters/level`;
    if (!engine.has(meterPath)) engine.addNode(meterPath, { properties: { level: [0, 0], peak: [0, 0], clip: [0, 0], enabled: true, num_streams: 2 } });
    await settle(engine, c);
    engine.setValue(meterPath, 'level', [1, 0.5]);
    await settle(engine, c);
    await wait(Console1Logic.METER_MS + 20);
    expect(sentTo(engine, 112).at(-1)).toBe(Console1Logic.meterCc(1));
    expect(sentTo(engine, 113).at(-1)).toBe(Console1Logic.meterCc(0.5));
    await wait(400); // a steady tone: LUNA sends nothing more, the meter must hold
    expect(sentTo(engine, 112).at(-1)).toBe(Console1Logic.meterCc(1));
    engine.setValue(meterPath, 'level', [0, 0]); // LUNA falls to 0 when the sound stops
    await settle(engine, c);
    await wait(Console1Logic.METER_MS + 20);
    expect(sentTo(engine, 112).at(-1)).toBe(0);
  });

  it('follows a selected bus, drives its strip, and skips the cue buses', async () => {
    const { engine, session, c } = await setup();
    engine.addBus('abc', 'lesl', { name: 'Leslie', busType: 'aux', stemFormat: 'stereo' });
    for (let i = 0; i < 20 && !session.buses.byId('lesl'); i++) { await engine.settled(); await wait(10); }
    const bus = session.buses.byId('lesl');
    engine.addNode(`${bus.path}/effects/console`, { properties: { uid: 'console_lesl', insert_type: 'console', plugin_id: API, plugin_name: 'API Vision Channel Strip', external_sdk_instance_id: 9, plugin_error: null } });
    engine.addNode(`${bus.path}/effects/console/controls`);
    addApiStrip(engine, `${bus.path}/effects/console/controls`);
    await engine.settled();
    expect(c.tracks().map((ch) => ch.name.value)).toEqual(['Main Output', 'Piano', 'Organ', 'Bass', 'Leslie']);
    engine.setValue(session.context.path, 'last_selected_track', 'lesl');
    engine.setValue(session.context.path, 'selection_tracks', ['lesl']);
    await settle(engine, c);
    expect(c.track.name.value).toBe('Leslie');
    expect(c.snapshot().stripName).toBe('API Vision');
    expect(sentTo(engine, 25).at(-1)).toBe(127);      // button 5
    await cc(engine, c, [[47, 127]]);                   // Threshold on the bus's strip
    expect(c.slot.params.find((p) => p.id === '225_thresh').normalized.value).toBeCloseTo(1);
  });

  it('drives an API 2500 on the Main Output: comp controls, Mix, and its G/R meter', async () => {
    const { engine, session, c } = await setup();
    engine.addPlugin(Console1Logic.API_2500, { name: 'API 2500 Bus Compressor' });
    const base = `${session.master.path}/effects/console`;
    engine.addNode(base, { properties: { uid: 'console_master', insert_type: 'console', plugin_id: Console1Logic.API_2500, plugin_name: 'API 2500 Bus Compressor', external_sdk_instance_id: 8, plugin_error: null } });
    engine.addNode(`${base}/controls`);
    const add = (id, o) => { engine.addControl(`${base}/controls/${id}`, 'parameter', o); engine.setValue(`${base}/controls/${id}`, 'name', id); };
    const stepped = (id, strs, index) => {
      add(id, { discrete: true, value: index, real: index, str: strs[index], automatable: true, normalized: index / (strs.length - 1) });
      engine.setValue(`${base}/controls/${id}`, 'num_steps', strs.length);
      engine.setValue(`${base}/controls/${id}`, 'real_values', strs.map((_, i) => i));
      engine.setValue(`${base}/controls/${id}`, 'string_values', strs);
    };
    add('threshold', { discrete: false, value: 0, real: 10, str: '10.0 dB', automatable: true });
    add('mix', { discrete: false, value: 1, real: 100, str: '100 %', automatable: true });
    stepped('ratio', ['1.5:1', '2:1', '3:1', '4:1', '6:1', '10:1', 'inf:1'], 3);
    stepped('power', ['Off', 'On'], 1);
    stepped('vu_meter', ['In', 'Out', 'GR'], 2);
    engine.addNode(`${base}/meters`);
    engine.addNode(`${base}/meters/vu_left`, { properties: { type: 'meter', level: [0.993], peak: [0], clip: [0], enabled: true, num_streams: 1 } });
    await engine.settled();
    engine.setValue(session.context.path, 'last_selected_track', session.master.id);
    engine.setValue(session.context.path, 'selection_tracks', [session.master.id]);
    await settle(engine, c);
    expect(c.track.name.value).toBe('Main Output');
    expect(c.snapshot().stripName).toBe('API 2500');
    const param = (id) => c.slot.params.find((p) => p.id === id);
    await cc(engine, c, [[50, 0]]);                     // Parallel Dry/Wet = Mix
    expect(param('mix').normalized.value).toBeCloseTo(0);
    await cc(engine, c, [[47, 127]]);                   // Threshold
    expect(param('threshold').normalized.value).toBeCloseTo(1);
    await c.releaseAll();
    await cc(engine, c, [[46, 0]]);                     // Comp On flips the 2500's Power
    expect(param('power').real.value).toBe(0);
    await cc(engine, c, [[107, 90]]);                   // Input Gain: nothing on a 2500, ring back to 0
    expect(sentTo(engine, 107).at(-1)).toBe(0);
    await wait(Console1Logic.METER_MS + 20);
    expect(sentTo(engine, 115).at(-1)).toBe(Console1Logic.rowCc(10)); // no gain reduction
    engine.setValue(`${base}/meters/vu_left`, 'level', [0.456]);       // needle on G/R 6
    await settle(engine, c);
    await wait(Console1Logic.METER_MS + 20);
    expect(sentTo(engine, 115).at(-1)).toBe(Console1Logic.rowCc(5));  // the "6" mark
    engine.setValue(`${base}/controls/vu_meter`, 'real_value', 0);     // VU switched to In: no G/R
    engine.setValue(`${base}/controls/vu_meter`, 'value', 0);
    await settle(engine, c);
    await wait(Console1Logic.METER_MS + Console1Logic.ROW_STEP_MS * 8);
    expect(sentTo(engine, 115).at(-1)).toBe(Console1Logic.rowCc(10));
  });

  it('drives Input, Comp and Shape from the API strip meters', async () => {
    const { engine, c, track, select } = await setup();
    const base = `${track('Organ').path}/effects/console/meters`;
    engine.addNode(base);
    for (const n of ['input_meter', 'output_meter', 'compress_meter', 'expand_meter']) {
      engine.addNode(`${base}/${n}`, { properties: { type: 'meter', level: [0], peak: [0], clip: [0], enabled: true, num_streams: 1 } });
    }
    await select('Organ');
    await settle(engine, c);
    await wait(Console1Logic.METER_MS + 20);
    // At rest: Comp on 0 dB (far right), Shape on 0 dB (middle), Input dark.
    expect(sentTo(engine, 115).at(-1)).toBe(Console1Logic.rowCc(10));
    expect(sentTo(engine, 114).at(-1)).toBe(Console1Logic.rowCc(5));
    engine.setValue(`${base}/input_meter`, 'level', [0.6]);
    engine.setValue(`${base}/compress_meter`, 'level', [0.6]);
    engine.setValue(`${base}/expand_meter`, 'level', [1]);
    await settle(engine, c);
    await wait(Console1Logic.METER_MS + 20);
    await wait(Console1Logic.ROW_STEP_MS * 12);
    expect(sentTo(engine, 115)).not.toContain(Console1Logic.rowCc(9)); // a peak jumps, it doesn't walk
    expect(sentTo(engine, 110).at(-1)).toBe(Console1Logic.dbCc(-12)); // 0.6 = -12 dBFS
    expect(sentTo(engine, 111).at(-1)).toBe(Console1Logic.dbCc(-12)); // mono: both sides
    expect(sentTo(engine, 115).at(-1)).toBe(Console1Logic.rowCc(7));  // the "3" mark
    expect(sentTo(engine, 114).at(-1)).toBe(0);                        // gate closed: far left
    const before = sentTo(engine, 115).length;
    engine.setValue(`${base}/compress_meter`, 'level', [0]); // release: walks back to 0 dB
    await settle(engine, c);
    await wait(Console1Logic.METER_MS + Console1Logic.ROW_STEP_MS * 6);
    expect(sentTo(engine, 115).slice(before).filter((v, i, a) => v !== a[i - 1])).toEqual([8, 9, 10].map((k) => Console1Logic.rowCc(k)));
    await select('Bass'); // no API strip: rows rest, Input dark
    await settle(engine, c);
    await wait(Console1Logic.METER_MS + Console1Logic.ROW_STEP_MS * 12);
    expect(sentTo(engine, 110).at(-1)).toBe(0);
    expect(sentTo(engine, 114).at(-1)).toBe(Console1Logic.rowCc(5));
  });
});
