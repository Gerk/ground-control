// Copyright 2026 Mark Guertin. Licensed under the Apache License, Version 2.0 (see LICENSE).
// Ground Control: logic with no DOM, so tests can exercise it against Luna.MockEngine.
//
// A Softube Console 1 Mk II (MIDI device "Console 1", CCs on channel 1, absolute 0-127) drives
// the API Vision channel strip (plugin `uaudio_api_vision_ext` in the track's `console` slot) on
// whichever track is selected in LUNA, plus that track's volume, pan, solo and mute. Values go
// back to the Console 1 so its LED rings and buttons show LUNA's state, and its 20 track buttons
// light the selected track. CC numbers: docs/console1-mk2-midi.md.

const C1_DEVICE = 'Console 1'; // the unit's own MIDI name; renamed units are picked in the window
const API_STRIP = 'uaudio_api_vision_ext';
const GESTURE_IDLE_MS = 400;
const TRACK_BUTTON_FIRST = 21; // Select Track 1..20 = CC21..40
const PAGE_MINUS = 97;
const PAGE_PLUS = 96;
const METER_IN = [110, 111];   // input meter L/R
const METER_OUT = [112, 113];  // output meter L/R
const METER_MS = 25;           // at most 40 meter updates a second
const METER_REFRESH_MS = 250;  // resend a non-zero meter this often, in case the C1 lets it fall
// The Console 1 Mk II meter: CC value at each printed mark (measured on a Mk II, 0 dB = 103).
// LUNA's meter `level` is a meter scale, not amplitude. From -18 dBFS up it is linear in dB, 3 dB
// per 1/11 (dB = 33 * (level - 1)): a 1 kHz tone at -18/-12/-6/0 dBFS read 0.4545 / 0.6364 /
// 0.8182 / 1.0 (2026-11-24). Below -18 it bends and stretches to about -60 at 0: measured
// 2026-11-25 by turning the API strip's output Level down under a -12 dBFS tone (the track
// meter reads before the fader). Assuming 33 dB below -18 made the C1 hang near -24, then drop.
const LEVEL_DB_SPAN = 33;
const LEVEL_DB_TABLE = [
  [0, -60], [0.0517, -52.1], [0.0929, -45.8], [0.1392, -40.7], [0.1904, -35.2],
  [0.2394, -30.4], [0.3249, -23.6], [0.4545, -18], [0.6364, -12], [0.8182, -6], [1, 0],
];
const METER_OFFSET_DB = 0; // calibration trim, if ever needed
// The C1 meter has 17 LEDs over 0..127 (~7.94 each) and lights an LED as soon as the value passes
// the one below it, so a value on a mark lights one LED too many. Aim at the LED's middle instead.
// Photos of a -18/-12/-6/0 dBFS tone: -12 and -6 lit one above their mark.
const METER_LED_SHIFT = -4;
const METER_SCALE = [[-60, 0], [-24, 33], [-12, 56], [-6, 80], [0, 103], [6, 127]];
// The API Vision strip's own meters (`<track>/effects/console/meters/*`), measured 2026-11-25 with a
// steady -12 dBFS tone. They copy the hardware's LEDs, so they move in steps:
//   input_meter     0.2 per 6 dB (0.6 = -12 dBFS, 1.0 = 0 dBFS)
//   output_meter    1/11 per 3 dB, the track meter's scale
//   compress_meter  0, 0.2 ... 1.0: the 225's gain-reduction LEDs
//   expand_meter    0 open, 1 closed (the 235 gate)
const METER_SHAPE = 114;
const METER_COMP = 115;
// The Shape and Comp meters are rows of 11 LEDs that light one dot, left to right over 0..127
// (measured on a Mk II). Comp is printed -20 . . 10 . 6 . 3 . . 0 dB (0 dB at the right end);
// Shape is printed - . . . . 0 dB . . . . + (0 dB in the middle).
const ROW_LEDS = 11;
// Fast attack, slow release: more gain reduction (or the gate closing) moves the dot left and
// jumps there at once so peaks show; the way back toward 0 dB walks one LED at a time.
const ROW_STEP_MS = 25;

/**
 * Meter tuning the window lets the user change live (saved in the Add On's local storage). The
 * constants above are the defaults; code reads the live values from here.
 */
const TUNING_FIELDS = [
  { key: 'compReleaseMs', label: 'Comp fall-back', unit: 'ms per LED, 0 = jump', min: 0, max: 500, step: 5, def: ROW_STEP_MS },
  { key: 'shapeReleaseMs', label: 'Shape fall-back', unit: 'ms per LED, 0 = jump', min: 0, max: 500, step: 5, def: 5 },
  { key: 'meterMs', label: 'Meter update interval', unit: 'ms', min: 10, max: 500, step: 5, def: METER_MS },
  { key: 'offsetDb', label: 'Input/Output meter trim', unit: 'dB', min: -12, max: 12, step: 0.5, def: METER_OFFSET_DB },
  { key: 'ledShift', label: 'Input/Output LED aim', unit: 'CC', min: -8, max: 8, step: 1, def: METER_LED_SHIFT },
];
const tuning = Object.fromEntries(TUNING_FIELDS.map((f) => [f.key, f.def]));
const COMP_REST_LED = 10;                      // 0 dB: no gain reduction
const SHAPE_REST_LED = 5;                      // 0 dB: gate open

/**
 * The layout. `param` is an API Vision parameter id (a function picks one from the strip), or
 * `track` names a track control. `kind`: knob (absolute value), toggle (press flips a switch),
 * tristate (the Console 1's three-position buttons, used here as two-position switches; `leds`
 * gives the value lighting each state: [off, on]).
 */
const LAYOUT = [
  // Input
  { cc: 107, section: 'Input', label: 'Input Gain', kind: 'knob', param: (s) => (Console1Logic.isMic(s) ? 'mic_gain' : 'line_gain') },
  { cc: 105, section: 'Input', label: 'High Cut', kind: 'knob', param: '215_lp_filter' },
  { cc: 103, section: 'Input', label: 'Low Cut', kind: 'knob', param: '215_hp_filter' },
  { cc: 61, section: 'Input', label: 'Filters to Comp', kind: 'toggle', param: '215_sc' },
  { cc: 108, section: 'Input', label: 'Phase Inv.', kind: 'toggle', param: 'phase' },
  // Shape -> 235 gate
  { cc: 53, section: 'Shape', label: 'Shape On', kind: 'toggle', param: '235_on' },
  { cc: 54, section: 'Shape', label: 'Gate', kind: 'knob', param: '235_thresh' },
  { cc: 56, section: 'Shape', label: 'Gate Release', kind: 'knob', param: '235_release' },
  { cc: 55, section: 'Shape', label: 'Sustain', kind: 'knob', param: '235_depth' },
  { cc: 57, section: 'Shape', label: 'Punch', kind: 'knob', param: '235_attack' },
  { cc: 59, section: 'Shape', label: 'Hard Gate', kind: 'toggle', param: '235_g_e' },
  // EQ -> 550
  { cc: 80, section: 'EQ', label: 'EQ On', kind: 'toggle', param: 'eq_on' },
  { cc: 92, section: 'EQ', label: 'Low Freq', kind: 'knob', param: '550_lf_freq' },
  { cc: 91, section: 'EQ', label: 'Low Gain', kind: 'knob', param: '550_lf_gain' },
  { cc: 89, section: 'EQ', label: 'Low Mid Freq', kind: 'knob', param: '550_lmf_freq' },
  { cc: 88, section: 'EQ', label: 'Low Mid Gain', kind: 'knob', param: '550_lmf_gain' },
  { cc: 86, section: 'EQ', label: 'High Mid Freq', kind: 'knob', param: '550_hmf_freq' },
  { cc: 85, section: 'EQ', label: 'High Mid Gain', kind: 'knob', param: '550_hmf_gain' },
  { cc: 83, section: 'EQ', label: 'High Freq', kind: 'knob', param: '550_hf_freq' },
  { cc: 82, section: 'EQ', label: 'High Gain', kind: 'knob', param: '550_hf_gain' },
  { cc: 93, section: 'EQ', label: 'Low Shelf/Bell', kind: 'tristate', param: '550_lf_filter', leds: [127, 63] },
  { cc: 65, section: 'EQ', label: 'High Shelf/Bell', kind: 'tristate', param: '550_hf_filter', leds: [127, 63] },
  // Compressor -> 225
  { cc: 46, section: 'Comp', label: 'Comp On', kind: 'toggle', param: '225_on' },
  { cc: 49, section: 'Comp', label: 'Ratio', kind: 'knob', param: '225_ratio' },
  { cc: 51, section: 'Comp', label: 'Attack', kind: 'knob', param: '225_attack' },
  { cc: 48, section: 'Comp', label: 'Release', kind: 'knob', param: '225_release' },
  { cc: 47, section: 'Comp', label: 'Threshold', kind: 'knob', param: '225_thresh' },
  // Output (Drive/Character as Softube's own API Vision map uses them)
  { cc: 15, section: 'Output', label: 'Drive (225 Type)', kind: 'knob', param: '225_type' },
  { cc: 18, section: 'Output', label: 'Character (225 Knee)', kind: 'knob', param: '225_knee' },
  { cc: 14, section: 'Output', label: 'Order (EQ Pre-Dyn)', kind: 'tristate', param: 'eq_predyn', leds: [63, 0] },
  { cc: 17, section: 'Output', label: 'Ext. Sidechain (SC Link)', kind: 'tristate', param: 'sc_link', leds: [127, 63] },
  { cc: 7, section: 'Output', label: 'Volume', kind: 'knob', track: 'gain' },
  { cc: 10, section: 'Output', label: 'Pan', kind: 'knob', track: 'pan' },
  { cc: 13, section: 'Output', label: 'Solo', kind: 'toggle', track: 'solo' },
  { cc: 12, section: 'Output', label: 'Mute', kind: 'toggle', track: 'mute' },
];

/**
 * Per-strip meter profiles, keyed by the console slot's plugin id. Each strip names its meter
 * nodes under `<track>/effects/console/meters` and how their levels read; a strip without an
 * entry gets no Input/Comp/Shape metering. Add LUNA's other strips (Neve, SSL ...) here once
 * measured: their meters may use other names, step sizes and ranges.
 *   input: { node, dbSpan }   level 1.0 = 0 dBFS, dB = dbSpan * (level - 1)
 *   comp:  { node, leds }     [level, LED] pairs onto the Comp row (LED 10 = 0 dB, 0 = -20)
 *   shape: { node }           0 = open (0 dB, middle LED) .. 1 = closed (far left)
 */
const STRIPS = {
  [API_STRIP]: {
    name: 'API Vision',
    meters: {
      input: { node: 'input_meter', dbSpan: 30 },
      // The 225's five gain-reduction LEDs. Full scale (1.0) is the plugin's 12 dB, between the 10
      // and -20 marks: LED 2 (observed). The steps below it are a guess.
      comp: { node: 'compress_meter', leds: [[0, 10], [0.2, 9], [0.4, 8], [0.6, 7], [0.8, 5], [1, 2]] },
      shape: { node: 'expand_meter' },
    },
  },
};

/**
 * Heard centre of a stereo channel when one side moves across and the other stays at its edge:
 * [pan travel of the moving side (0 = its own edge, 1 = the other edge), heard centre
 * (0 = middle, 1 = fully at the far side)]. Measured on LUNA 3.1.2 with a steady 1 kHz tone:
 * master bus L/R levels at each 1/16 of travel, centre = (gR - gL) / (gR + gL) in amplitude
 * (the tangent panning law). Both sides measured the same.
 */
const HEARD_CENTRE = [
  [0, 0], [0.0625, 0.046], [0.125, 0.098], [0.1875, 0.143], [0.25, 0.188], [0.3125, 0.248],
  [0.375, 0.306], [0.4375, 0.373], [0.5, 0.44], [0.5625, 0.481], [0.625, 0.519], [0.6875, 0.595],
  [0.75, 0.674], [0.8125, 0.734], [0.875, 0.808], [0.9375, 0.897], [1, 1],
];
const EDGE = 0.01; // a pan this close to its edge counts as there

/** Linear interpolation in a table of [x, y] pairs sorted by x (or by y, with `inverse`). */
function lerpTable(table, v, inverse = false) {
  const [i, o] = inverse ? [1, 0] : [0, 1];
  const t = Math.max(0, Math.min(1, v));
  for (let n = 1; n < table.length; n++) {
    const a = table[n - 1], b = table[n];
    if (t <= b[i]) return a[o] + ((b[o] - a[o]) * (t - a[i])) / (b[i] - a[i] || 1);
  }
  return table[table.length - 1][o];
}

const Console1Logic = {
  HEARD_CENTRE,

  /**
   * The MIDI device to use: the one named `chosen` if it is there, else one named "Console 1",
   * else one whose name contains "console 1" (any case). Only devices LUNA can read from count.
   */
  pickDevice(devices, chosen = null) {
    const usable = devices.filter((d) => d.inputPort);
    const named = (n) => usable.find((d) => d.name.value === n);
    return (chosen && named(chosen))
      ?? named(C1_DEVICE)
      ?? usable.find((d) => (d.name.value ?? '').toLowerCase().includes(C1_DEVICE.toLowerCase()))
      ?? null;
  },

  /** Stereo pan knob (0..1, 0.5 = straight up) to LUNA's { l, r } normalized pans. */
  stereoPans(k) {
    // Heard centre, -1 hard L .. 1 hard R. CC 63..65 is straight up (the ring sends 64).
    const x = Math.abs(k - 0.5) <= 1.01 / 127 ? 0 : Math.max(-1, Math.min(1, (k - 0.5) * 2));
    const travel = lerpTable(HEARD_CENTRE, Math.abs(x), true);
    return x >= 0 ? { l: travel, r: 1 } : { l: 0, r: 1 - travel };
  },

  /**
   * LUNA's stereo pans to the knob (0..1). Off the knob's path (both sides moved in from their
   * edges, e.g. set in LUNA's UI) it shows the pans' midpoint.
   */
  stereoKnob(l, r) {
    if (r >= 1 - EDGE && l >= 0) return 0.5 + lerpTable(HEARD_CENTRE, l) / 2;
    if (l <= EDGE) return 0.5 - lerpTable(HEARD_CENTRE, 1 - r) / 2;
    return (l + r) / 2;
  },
  STRIPS,
  C1_DEVICE,
  API_STRIP,
  LAYOUT,
  GESTURE_IDLE_MS,
  TUNING_FIELDS,
  tuning,
  get METER_MS() { return tuning.meterMs; },
  get ROW_STEP_MS() { return tuning.compReleaseMs; },
  /** Change tuning values (unknown keys and non-numbers are ignored); returns the live set. */
  setTuning(values = {}) {
    for (const f of TUNING_FIELDS) {
      const v = Number(values[f.key]);
      if (values[f.key] !== undefined && values[f.key] !== '' && Number.isFinite(v)) tuning[f.key] = Math.max(f.min, Math.min(f.max, v));
    }
    return { ...tuning };
  },
  resetTuning() {
    for (const f of TUNING_FIELDS) tuning[f.key] = f.def;
    return { ...tuning };
  },
  /** Which LED (0..16) the Console 1 lights at the top for a CC value, as observed. */
  ledFor(cc) {
    return cc <= 0 ? -1 : Math.floor(cc / (127 / 16)) + 1;
  },

  byCc: new Map(LAYOUT.map((e) => [e.cc, e])),

  isMic(slot) {
    const sel = slot?.params.find((c) => c.id === 'input_select');
    return sel?.display.value === 'Mic';
  },

  steps(control) {
    return control.discrete.value ? (control.numSteps.value ?? control.realValues.value?.length ?? 0) : 0;
  },

  /** CC value (0..127) to a write: stepped controls split the range into equal bands. */
  valueFor(control, cc) {
    const v = Math.max(0, Math.min(127, cc));
    const steps = Console1Logic.steps(control);
    if (steps >= 2) {
      const index = Math.min(steps - 1, Math.floor((v * steps) / 128));
      const reals = control.realValues.value;
      if (Array.isArray(reals) && reals.length === steps) return { view: 'real', value: reals[index] };
      return { view: 'normalized', value: index / (steps - 1) };
    }
    return { view: 'normalized', value: v / 127 };
  },

  /** The control's value as a CC (0..127), the inverse of valueFor. */
  ccFor(control) {
    const norm = control.normalized.value;
    const steps = Console1Logic.steps(control);
    if (steps >= 2) {
      const reals = control.realValues.value;
      let index = Array.isArray(reals) ? reals.indexOf(control.real.value) : -1;
      if (index < 0 && typeof norm === 'number') index = Math.round(norm * (steps - 1));
      if (index < 0) return undefined;
      // The middle of the step's band, so the next turn moves off it evenly.
      return Math.min(127, Math.floor(((index + 0.5) * 128) / steps));
    }
    return typeof norm === 'number' ? Math.round(Math.max(0, Math.min(1, norm)) * 127) : undefined;
  },

  /** On/off of a two-position control: the second of its values is "on". */
  isOn(control) {
    const reals = control.realValues.value;
    if (Array.isArray(reals) && reals.length >= 2) return reals.indexOf(control.real.value) >= 1;
    if (typeof control.real.value === 'boolean') return control.real.value;
    return (control.normalized.value ?? 0) >= 0.5;
  },

  /** LUNA's meter level (a dB-linear meter scale, 1.0 = 0 dBFS) in dBFS. */
  levelDb(level) {
    const v = Math.max(0, Math.min(level, 1.2));
    if (v >= 1) return LEVEL_DB_SPAN * (v - 1);
    for (let i = 1; i < LEVEL_DB_TABLE.length; i++) {
      const [l1, d1] = LEVEL_DB_TABLE[i];
      if (v <= l1) {
        const [l0, d0] = LEVEL_DB_TABLE[i - 1];
        return d0 + ((v - l0) / (l1 - l0)) * (d1 - d0);
      }
    }
    return 0;
  },

  /** A LUNA meter level as a Console 1 meter CC value. */
  meterCc(level) {
    if (!(level > 0)) return 0;
    return Console1Logic.dbCc(Console1Logic.levelDb(level));
  },

  /** The API strip's input meter (steps of 0.2 = 6 dB, 1.0 = 0 dBFS) as a Console 1 meter CC. */
  inputCc(level, dbSpan = STRIPS[API_STRIP].meters.input.dbSpan) {
    if (!(level > 0)) return 0;
    return Console1Logic.dbCc(dbSpan * (Math.min(level, 1.2) - 1));
  },

  /** dBFS as a Console 1 (vertical) meter CC, aimed at the middle of the LED. */
  dbCc(dbfs) {
    const db = dbfs + tuning.offsetDb;
    if (db <= METER_SCALE[0][0]) return 0;
    let cc = 127;
    for (let i = 1; i < METER_SCALE.length; i++) {
      const [d1, c1] = METER_SCALE[i];
      if (db <= d1) {
        const [d0, c0] = METER_SCALE[i - 1];
        cc = c0 + ((db - d0) / (d1 - d0)) * (c1 - c0);
        break;
      }
    }
    return Math.max(1, Math.round(cc + tuning.ledShift));
  },

  /** CC lighting LED k (0..10) of an 11-LED row: the middle of its band, as on the tall meters. */
  rowCc(k) {
    const led = Math.max(0, Math.min(ROW_LEDS - 1, Math.round(k)));
    return led === 0 ? 0 : Math.round((led - 0.5) * (127 / (ROW_LEDS - 1)));
  },

  /** The Comp meter's LED for the strip's compress_meter level (0 = no gain reduction). */
  compLed(level, leds = STRIPS[API_STRIP].meters.comp.leds) {
    const v = Math.max(0, Math.min(1, level ?? 0));
    for (let i = 1; i < leds.length; i++) {
      const [l1, k1] = leds[i];
      if (v <= l1) {
        const [l0, k0] = leds[i - 1];
        return Math.round(k0 + ((v - l0) / (l1 - l0)) * (k1 - k0));
      }
    }
    return leds.at(-1)[1];
  },

  /** The Shape meter's LED for the strip's expand_meter level (0 open = 0 dB, 1 closed = far left). */
  shapeLed(level) {
    const v = Math.max(0, Math.min(1, level ?? 0));
    return Math.round(SHAPE_REST_LED * (1 - v));
  },

  COMP_REST_LED,
  SHAPE_REST_LED,

  /** The track buttons' bank (0 for tracks 1-20, 1 for 21-40, ...) and lit button (0..19). */
  bankOf(index) {
    return { bank: Math.floor(index / 20), button: index % 20 };
  },
};

/**
 * One pan knob for a stereo channel, which LUNA pans with two controls, `pan_left` and
 * `pan_right` (SDK fact 84). The knob sets where the image's centre is heard. Straight up is
 * L100/R100. Turning right brings L across toward R (R stays at 100R); turning left is the
 * mirror. The pan position for a heard centre comes from HEARD_CENTRE (measured), so the image
 * moves evenly with the knob. Every write is absolute from the knob: nothing is remembered.
 * Selecting a track writes nothing. It looks enough like a Luna Control for the knob, ring and
 * page code paths.
 */
function stereoPan(main) {
  const left = main.panLeft;
  const right = main.panRight;
  const both = [left, right];
  const now = () => ({ l: left.normalized.value ?? 0, r: right.normalized.value ?? 1 });
  const onBoth = (view) => (fn) => {
    const offs = both.map((c) => c[view].onChange(fn));
    return () => offs.forEach((off) => off());
  };
  return {
    path: `${main.path}/controls/pan_left+pan_right`,
    id: 'pan',
    stereo: true,
    discrete: { value: false },
    numSteps: { value: 0 },
    realValues: { value: undefined },
    normalized: {
      get value() { const { l, r } = now(); return Console1Logic.stereoKnob(l, r); },
      onChange: onBoth('normalized'),
      async set(k) {
        const { l, r } = Console1Logic.stereoPans(k);
        await Promise.all([left.normalized.set(l), right.normalized.set(r)]);
      },
    },
    real: { get value() { return undefined; }, onChange: onBoth('real') },
    display: { get value() { return `${left.display.value ?? ''} ${right.display.value ?? ''}`.trim(); } },
    begin() { both.forEach((c) => c.begin()); },
    end() { both.forEach((c) => c.end()); },
  };
}

/**
 * Follows the selected track and drives it from the Console 1.
 *
 *   const c1 = new Console1(luna, session, { onChange });
 *   await c1.start();
 *   c1.dispose();
 */
class Console1 {
  constructor(luna, session, { onChange = () => {}, out = null, deviceName = null } = {}) {
    this.luna = luna;
    this.session = session;
    this.onChange = onChange;
    this.deviceName = deviceName || null; // chosen in the window; null = automatic
    this.out = out ?? new Luna.SendMidi(luna);
    this.device = null;
    this.track = null;      // the followed Luna.Track
    this.slot = null;       // its API Vision slot, or null
    this.pan = null;        // stereoPan() for a stereo track, else null (track.pan is used)
    this.unsubs = [];
    this.trackUnsubs = [];
    this.midiStop = null;
    this.writes = new Map(); // control path -> { control, pending, busy, timer, touching }
    this.lastCc = null;
    this.meterSent = new Map();  // meter CC -> last value sent
    this.meterTimer = null;
    this.meterRefresh = null;
    this.meterStops = [];
    this.ownedMeters = [];   // strip Meter objects this class made
    this.meterSources = null;
    this.meterProfile = null;  // STRIPS entry of the followed strip
    this.rowLed = new Map();     // Shape/Comp row CC -> LED shown now
    this.rowTarget = new Map();  // Shape/Comp row CC -> LED it is walking to
    this.rowTimers = new Map(); // row CC -> interval walking its dot
    this.binding = Promise.resolve();
  }

  /** The tracks the buttons count, in LUNA's order: without the system click and count-in tracks. */
  tracks() {
    return this.session.visibleTracks;
  }

  async start() {
    await this.session.ready();
    // The device list is outside the session: watch it so a Console 1 plugged in later is seen.
    const devices = this.luna.midiDevices.watch({ recursive: true });
    this.unsubs.push(devices.release);
    await devices.ready;
    this.findDevice();
    this.unsubs.push(this.luna.midiDevices.onChange(() => this.findDevice()));
    this.unsubs.push(this.session.focusedTrack.onChange(() => this.follow()));
    this.unsubs.push(this.session.tracks.onChange(() => this.sendTrackLeds()));
    await this.follow();
  }

  findDevice() {
    const device = Console1Logic.pickDevice(this.luna.midiDevices.items, this.deviceName);
    if (device === this.device) return;
    this.midiStop?.();
    this.midiStop = null;
    this.device = device;
    if (device) {
      this.midiStop = new Luna.MidiInput(this.luna).listen(device, (m) => {
        if (m.type === 'controlChange' && m.channel === 0) this.handleCC(m.data1, m.data2);
      });
      this.sendAll();
    }
    this.onChange();
  }

  /** Use the MIDI device with this name (null or '' = automatic). */
  setDeviceName(name) {
    this.deviceName = name || null;
    this.findDevice();
    this.onChange();
  }

  /** Names of the MIDI devices LUNA can read from, for the window's device menu. */
  deviceNames() {
    return this.luna.midiDevices.items.filter((d) => d.inputPort).map((d) => d.name.value).filter(Boolean);
  }

  /** Follow LUNA's selected track (serialized, so quick switches settle on the last one). */
  follow() {
    this.binding = this.binding.then(() => this.bind(this.session.focusedTrack.value ?? null)).catch((e) => console.warn('Console 1: follow failed', e));
    return this.binding;
  }

  async bind(track) {
    if (track === this.track && track) return;
    await this.releaseAll();
    this.stopMeter();
    for (const u of this.trackUnsubs) u();
    this.trackUnsubs = [];
    this.track = track;
    this.slot = null;
    this.pan = null;
    if (track) {
      await Promise.all([track.loadStrip(), track.controls.load(), track.effects.load()]);
      const slot = track.effects.items.find((s) => s.id === 'console' && s.pluginId.value === API_STRIP) ?? null;
      if (slot) await slot.controls.load();
      if (this.track !== track) return; // switched again meanwhile
      this.slot = slot;
      if (track.main.stereo) this.pan = stereoPan(track.main);
      // Re-bind when the console slot changes plugin (API Vision added or removed).
      const consoleSlot = track.effects.items.find((s) => s.id === 'console');
      if (consoleSlot) this.trackUnsubs.push(consoleSlot.pluginId.onChange(() => { this.track = null; this.follow(); }));
      for (const entry of LAYOUT) {
        const control = this.controlFor(entry);
        if (!control) continue;
        const send = () => this.sendFeedback(entry);
        this.trackUnsubs.push(control.normalized.onChange(send));
        this.trackUnsubs.push(control.real.onChange(send));
      }
      // Input Gain follows the Line/Mic switch.
      const inputSelect = this.slot?.params.find((c) => c.id === 'input_select');
      if (inputSelect) this.trackUnsubs.push(inputSelect.real.onChange(() => this.sendFeedback(Console1Logic.byCc.get(107))));
      this.trackUnsubs.push(track.name.onChange(() => this.onChange()));
      this.watchMeter(track);
    }
    this.sendAll();
    this.onChange();
  }

  /** The live control a layout entry drives on the followed track, if any. */
  controlFor(entry) {
    if (!this.track) return undefined;
    if (entry.track === 'pan' && this.pan) return this.pan;
    if (entry.track) return this.track[entry.track];
    if (!this.slot) return undefined;
    const id = typeof entry.param === 'function' ? entry.param(this.slot) : entry.param;
    return this.slot.params.find((c) => c.id === id);
  }

  handleCC(cc, value) {
    this.lastCc = { cc, value, entry: Console1Logic.byCc.get(cc) };
    if (cc >= TRACK_BUTTON_FIRST && cc < TRACK_BUTTON_FIRST + 20) {
      const index = this.track ? this.tracks().indexOf(this.track) : -1;
      const bank = index >= 0 ? Console1Logic.bankOf(index).bank : 0;
      this.selectIndex(bank * 20 + (cc - TRACK_BUTTON_FIRST));
    } else if (cc === PAGE_MINUS || cc === PAGE_PLUS) {
      const index = this.track ? this.tracks().indexOf(this.track) : -1;
      this.selectIndex(index + (cc === PAGE_PLUS ? 1 : -1));
    } else {
      const entry = Console1Logic.byCc.get(cc);
      const control = entry && this.controlFor(entry);
      if (control) {
        if (entry.kind === 'knob') this.write(control, value);
        else this.press(entry, control);
      } else if (entry) {
        this.sendFeedback(entry); // nothing to drive: put the LED back
      }
    }
    this.onChange();
  }

  /** Select a track by its position in LUNA's order; out of range does nothing but relight. */
  async selectIndex(index) {
    const track = this.tracks()[index];
    if (!track) return this.sendTrackLeds();
    await this.session.context.select({ trackUids: [track.id] });
    await this.session.context.lastSelectedTrack.set(track.id);
  }

  /** A button press flips its switch: one touch-bracketed write (one undo step). */
  async press(entry, control) {
    try {
      if (entry.track === 'mute' || entry.track === 'solo') {
        await control.toggle();
      } else {
        const reals = control.realValues.value;
        const on = Console1Logic.isOn(control);
        if (Array.isArray(reals) && reals.length >= 2) await control.real.set(on ? reals[0] : reals[1]);
        else await control.normalized.set(on ? 0 : 1);
      }
    } catch (e) {
      console.warn('Console 1: press refused', entry.label, e);
    }
    this.sendFeedback(entry);
  }

  /** A knob turn: one touch gesture per turn, newest value only while a write is in flight. */
  write(control, cc) {
    let w = this.writes.get(control.path);
    if (!w) { w = { control, pending: null, busy: false, timer: null, touching: false }; this.writes.set(control.path, w); }
    w.pending = Console1Logic.valueFor(control, cc);
    if (!w.touching) { control.begin(); w.touching = true; }
    clearTimeout(w.timer);
    w.timer = setTimeout(() => this.release(control.path), GESTURE_IDLE_MS);
    if (!w.busy) this.flush(w);
  }

  async flush(w) {
    w.busy = true;
    try {
      while (w.pending) {
        const { view, value } = w.pending;
        w.pending = null;
        try {
          await (view === 'real' ? w.control.real.set(value) : w.control.normalized.set(value));
        } catch (e) {
          console.warn('Console 1: write refused', w.control.path, e);
        }
      }
    } finally {
      w.busy = false;
    }
  }

  release(path) {
    const w = this.writes.get(path);
    if (!w) return;
    if (w.busy) { w.timer = setTimeout(() => this.release(path), 50); return; }
    if (w.touching) { w.control.end(); w.touching = false; }
    this.writes.delete(path);
    // The turn is over: show where LUNA landed (stepped controls snap).
    const entry = LAYOUT.find((e) => this.controlFor(e) === w.control);
    if (entry) this.sendFeedback(entry);
  }

  async releaseAll() {
    for (const [path, w] of [...this.writes]) {
      clearTimeout(w.timer);
      while (w.busy) await new Promise((r) => setTimeout(r, 5));
      if (w.touching) w.control.end();
      this.writes.delete(path);
    }
  }

  // ---------- meters ----------

  /**
   * Follow the meters: the track's main meter drives the Output meter; the API strip's own
   * input, compressor and gate meters drive Input, Comp and Shape. LUNA pushes only when a level
   * changes (about 30 a second while it moves, once for a steady tone) and falls to 0 itself when
   * the sound stops, so the last value is held, never timed out.
   */
  watchMeter(track) {
    const sources = { out: track.meter };
    const profile = this.slot ? STRIPS[this.slot.pluginId.value] : null;
    for (const [role, spec] of Object.entries(profile?.meters ?? {})) {
      const m = new Luna.Meter(this.luna, `${this.slot.path}/meters/${spec.node}`);
      sources[role] = m;
      this.ownedMeters.push(m);
    }
    this.meterProfile = profile;
    this.meterSources = sources;
    const schedule = () => {
      if (!this.meterTimer) this.meterTimer = setTimeout(() => { this.meterTimer = null; this.updateMeters(); }, tuning.meterMs);
    };
    for (const m of Object.values(sources)) this.meterStops.push(m.onChange(schedule));
    // Keep the meters lit between LUNA's pushes (a steady level sends none, and the Shape and
    // Comp rows always show a dot).
    this.meterRefresh = setInterval(() => {
      for (const [cc, v] of this.meterSent) this.send(cc, v);
    }, METER_REFRESH_MS);
    this.updateMeters();
  }

  stopMeter() {
    for (const stop of this.meterStops) stop();
    this.meterStops = [];
    for (const m of this.ownedMeters) m.dispose?.();
    this.ownedMeters = [];
    this.meterSources = null;
    this.meterProfile = null;
    clearTimeout(this.meterTimer);
    this.meterTimer = null;
    clearInterval(this.meterRefresh);
    this.meterRefresh = null;
    this.updateMeters();
  }

  /** The CC value for each meter from the current sources (all at rest without a track). */
  meterValues() {
    const s = this.meterSources ?? {};
    const spec = this.meterProfile?.meters ?? {};
    const level = (m) => m?.level.value ?? [];
    const out = level(s.out);
    const inp = level(s.input);
    return [
      [METER_OUT[0], Console1Logic.meterCc(out[0] ?? 0)],
      [METER_OUT[1], Console1Logic.meterCc(out[1] ?? out[0] ?? 0)],
      [METER_IN[0], s.input ? Console1Logic.inputCc(inp[0] ?? 0, spec.input.dbSpan) : 0],
      [METER_IN[1], s.input ? Console1Logic.inputCc(inp[1] ?? inp[0] ?? 0, spec.input.dbSpan) : 0],
    ];
  }

  /** The LED each Shape/Comp row should end up on. */
  rowTargets() {
    const s = this.meterSources ?? {};
    const spec = this.meterProfile?.meters ?? {};
    const first = (m) => m?.level.value?.[0];
    return [
      [METER_COMP, s.comp ? Console1Logic.compLed(first(s.comp), spec.comp.leds) : COMP_REST_LED],
      [METER_SHAPE, s.shape ? Console1Logic.shapeLed(first(s.shape)) : SHAPE_REST_LED],
    ];
  }

  updateMeters() {
    for (const [cc, v] of this.meterValues()) this.sendMeter(cc, v);
    for (const [cc, led] of this.rowTargets()) {
      this.rowTarget.set(cc, led);
      // First value, or a peak (further left than shown): jump straight there.
      if (!this.rowLed.has(cc) || led < this.rowLed.get(cc)) { this.rowLed.set(cc, led); this.sendMeter(cc, Console1Logic.rowCc(led)); }
    }
    for (const [cc, target] of this.rowTarget) {
      if (this.rowLed.get(cc) === target || this.rowTimers.has(cc)) continue;
      const ms = cc === METER_SHAPE ? tuning.shapeReleaseMs : tuning.compReleaseMs;
      if (ms <= 0) { this.rowLed.set(cc, target); this.sendMeter(cc, Console1Logic.rowCc(target)); continue; }
      this.rowTimers.set(cc, setInterval(() => this.stepRow(cc), ms));
    }
  }

  /** Walk one row's dot one LED toward its target; stop when it arrives. */
  stepRow(cc) {
    const now = this.rowLed.get(cc);
    const target = this.rowTarget.get(cc);
    if (now !== target) {
      const next = now + Math.sign(target - now);
      this.rowLed.set(cc, next);
      this.sendMeter(cc, Console1Logic.rowCc(next));
      if (next !== target) return;
    }
    clearInterval(this.rowTimers.get(cc));
    this.rowTimers.delete(cc);
  }

  sendMeter(cc, v) {
    if (this.meterSent.get(cc) === v) return;
    this.meterSent.set(cc, v);
    this.send(cc, v);
  }

  // ---------- feedback to the Console 1 ----------

  send(cc, value) {
    if (!this.device?.outputPort) return;
    this.out.sendControllerToOutput(this.device, cc, value).catch(() => {});
  }

  /** Show one control's value: knob ring, button LED or three-position LED. */
  sendFeedback(entry) {
    if (!entry) return;
    const control = this.controlFor(entry);
    if (control && this.writes.get(control.path)?.touching) return; // mid-turn: the ring is already there
    let value = 0;
    if (control) {
      if (entry.kind === 'knob') value = Console1Logic.ccFor(control) ?? 0;
      else if (entry.kind === 'tristate') value = entry.leds[Console1Logic.isOn(control) ? 1 : 0];
      else value = Console1Logic.isOn(control) ? 127 : 0;
    }
    this.send(entry.cc, value);
    this.onChange();
  }

  sendTrackLeds() {
    const index = this.track ? this.tracks().indexOf(this.track) : -1;
    const lit = index >= 0 ? Console1Logic.bankOf(index).button : -1;
    for (let b = 0; b < 20; b++) this.send(TRACK_BUTTON_FIRST + b, b === lit ? 127 : 0);
  }

  sendAll() {
    this.sendTrackLeds();
    for (const entry of LAYOUT) this.sendFeedback(entry);
  }

  /** For the page: the followed track and every layout entry with its current value. */
  snapshot() {
    const index = this.track ? this.tracks().indexOf(this.track) : -1;
    return {
      connected: !!this.device,
      deviceName: this.device?.name.value ?? null,
      deviceChoice: this.deviceName,
      deviceMissing: !!this.deviceName && this.device?.name.value !== this.deviceName,
      deviceNames: this.deviceNames(),
      track: this.track ? { name: this.track.name.value ?? this.track.id, number: index + 1 } : null,
      hasStrip: !!this.slot,
      entries: LAYOUT.map((e) => {
        const c = this.controlFor(e);
        return { ...e, display: c ? (c.display.value ?? '') : null, cc: c ? (e.kind === 'knob' ? Console1Logic.ccFor(c) : Console1Logic.isOn(c) ? 'on' : 'off') : null };
      }),
      lastCc: this.lastCc,
    };
  }

  dispose() {
    this.stopMeter();
    for (const timer of this.rowTimers.values()) clearInterval(timer);
    this.rowTimers.clear();
    this.midiStop?.();
    for (const u of [...this.unsubs, ...this.trackUnsubs]) u();
    for (const w of this.writes.values()) {
      clearTimeout(w.timer);
      if (w.touching) w.control.end();
    }
    this.writes.clear();
    this.unsubs = [];
    this.trackUnsubs = [];
  }
}

globalThis.Console1Logic = Console1Logic;
globalThis.Console1 = Console1;
