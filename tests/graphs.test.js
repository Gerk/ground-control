// Copyright 2026 Mark Guertin. Licensed under the Apache License, Version 2.0 (see LICENSE).
// The graphs' math (graphs.js GraphLogic). No LUNA or DOM needed. `npm test`.
import { describe, expect, it } from 'vitest';

await import('../graphs.js');
const { GraphLogic: G } = globalThis;

const at = (eq, f) => G.eqResponse(eq, [f]).total[0];

describe('EQ shapes', () => {
  it('a bell reaches its gain at its frequency and is flat far away', () => {
    expect(G.peakDb(1000, 1000, 6, 1)).toBeCloseTo(6, 6);
    expect(G.peakDb(1000, 1000, -9, 1)).toBeCloseTo(-9, 6);
    expect(Math.abs(G.peakDb(20, 1000, 6, 1))).toBeLessThan(0.1);
  });

  it('shelves reach their gain on their side and nothing on the other', () => {
    expect(G.lowShelfDb(20, 400, 6)).toBeCloseTo(6, 1);
    expect(Math.abs(G.lowShelfDb(20000, 400, 6))).toBeLessThan(0.05);
    expect(G.highShelfDb(20000, 2500, -6)).toBeCloseTo(-6, 1);
    expect(Math.abs(G.highShelfDb(20, 2500, -6))).toBeLessThan(0.05);
    expect(G.lowShelfDb(400, 400, 6)).toBeCloseTo(3, 1); // half the gain at the corner
  });

  it('filters are -3 dB at their corner and 12 dB/octave beyond', () => {
    expect(G.highPassDb(100, 100)).toBeCloseTo(-3.01, 1);
    expect(G.highPassDb(25, 100) - G.highPassDb(12.5, 100)).toBeCloseTo(12, 0);
    expect(G.lowPassDb(10000, 10000)).toBeCloseTo(-3.01, 1);
  });

  it('550 Q narrows as gain rises', () => {
    expect(G.q550(12)).toBeGreaterThan(G.q550(2));
    expect(G.q550(-6)).toBe(G.q550(6));
  });

  it('EQ off still computes the bands (drawn greyed); the filters are kept apart', () => {
    const eq = { on: false, mode: '550', bands: [{ type: 'peak', f: 1000, g: 12 }], hp: { on: true, f: 100 }, lp: { on: false, f: 0 } };
    expect(at(eq, 1000)).toBeGreaterThan(11.9);
    expect(G.eqResponse(eq, [1000]).filters[0]).toBeCloseTo(0, 1);
    expect(G.eqResponse(eq, [100]).filters[0]).toBeCloseTo(-3.01, 1);
    expect(at({ ...eq, on: true }, 1000)).toBe(at(eq, 1000));
  });
});

describe('what is heard', () => {
  const base = { on: true, mode: '550', bands: [{ type: 'peak', f: 1000, g: 12 }], hp: { on: true, f: 100 }, lp: { on: false, f: 0 } };
  const r = (eq, f) => G.eqResponse(eq, [f]);

  it('the 50 Hz cut is always heard', () => {
    expect(r({ ...base, cut50: true }, 50).heard[0]).toBeLessThan(-6); // HP at 100 plus the cut
    expect(r({ ...base, cut50: true, on: false }, 50).heard[0]).toBeLessThan(-6);
  });

  it('EQ on the sidechain: drawn, not heard', () => {
    const eq = { ...base, sc: true };
    expect(r(eq, 1000).total[0]).toBeGreaterThan(11.9);
    expect(r(eq, 1000).heard[0]).toBeCloseTo(0, 1);
  });

  it('filters on the sidechain: not heard either', () => {
    expect(r({ ...base, filtersSc: true }, 100).heard[0]).toBeCloseTo(0, 1);
    expect(r(base, 100).heard[0]).toBeCloseTo(-3.01, 1);
  });
});

describe('dynamics curves', () => {
  it('compressor: unity below threshold, 1/ratio above', () => {
    const c = { threshold: -10, ratio: 4 };
    expect(G.compOut(-30, c)).toBe(-30);
    expect(G.compOut(10, c)).toBe(-5);
  });

  it('soft knee bends smoothly and meets the hard curve outside the knee', () => {
    const c = { threshold: 0, ratio: 4, knee: 10 };
    expect(G.compOut(-5, c)).toBeCloseTo(-5, 6);
    expect(G.compOut(5, c)).toBeCloseTo(1.25, 6);
    expect(G.compOut(0, c)).toBeLessThan(0);
  });

  it('gate drops by depth below threshold; expander falls 2:1 down to depth', () => {
    expect(G.gateOut(-50, { threshold: -40, depth: 30 })).toBe(-80);
    expect(G.gateOut(-30, { threshold: -40, depth: 30 })).toBe(-30);
    expect(G.gateOut(-45, { threshold: -40, depth: 30, mode: 'expand' })).toBe(-50);
    expect(G.gateOut(-80, { threshold: -40, depth: 30, mode: 'expand' })).toBe(-110);
  });
});

describe('level meter scale', () => {
  it('lands on the Console 1 marks and clamps at the ends', () => {
    expect(G.meterPos(-Infinity)).toBe(0);
    expect(G.meterPos(-80)).toBe(0);
    expect(G.meterPos(-24)).toBeCloseTo(33 / 127, 6);
    expect(G.meterPos(0)).toBeCloseTo(103 / 127, 6);
    expect(G.meterPos(12)).toBe(1);
    expect(G.meterPos(-9)).toBeGreaterThan(G.meterPos(-12));
  });
});

describe('reading a strip', () => {
  const control = (real, display = String(real)) => ({ real: { value: real }, display: { value: display } });

  it('API Vision: 550 bands with shelf/peak, filters, 225 and 235', () => {
    const p = {
      eq_on: control(1), eq_select: control(0), '215_on': control(1), '215_hp_filter': control(80), '215_lp_filter': control(16000),
      '550_lf_filter': control(0), '550_lf_freq': control(100), '550_lf_gain': control(4),
      '550_hf_filter': control(1), '550_hf_freq': control(10000), '550_hf_gain': control(-2),
      '225_on': control(1), '225_thresh': control(-10, '-10.0 dB'), '225_ratio': control(4, '4.0'), '225_knee': control(0, 'Soft'),
      '235_on': control(0), '235_thresh': control(-47), '235_depth': control(80), '235_g_e': control(1, 'Expand'),
    };
    const s = G.stateFor('uaudio_api_vision_ext', (id) => p[id]);
    expect(s.eq.mode).toBe('550');
    expect(s.eq.bands[0]).toEqual({ type: 'lowshelf', f: 100, g: 4 });
    expect(s.eq.bands[3]).toEqual({ type: 'peak', f: 10000, g: -2 });
    expect(s.eq.hp).toEqual({ on: true, f: 80 });
    expect(s.comp).toMatchObject({ on: true, threshold: -10, ratio: 4, knee: 10 });
    expect(s.gate).toMatchObject({ on: false, threshold: -47, depth: 80, mode: 'expand' });
    expect(s.comp.readout.map(([k]) => k)).toEqual(['Thresh', 'Ratio', 'Type', 'Attack', 'Release', 'Knee']);
    expect(s.comp.readout[1]).toEqual(['Ratio', '4.0:1']);
    expect(s.gate.readout.map(([k]) => k)).toEqual(['Thresh', 'Depth', 'Attack', 'Release']);
  });

  it('API Vision switches: lit as set, grouped as on the strip', () => {
    const p = { pad: control(1), phase: control(0), cut_filter: control(1), '215_on': control(1), eq_predyn: control(1), eq_sc: control(1), power: control(1) };
    const s = G.stateFor('uaudio_api_vision_ext', (id) => p[id]).strip;
    expect(s.sections.map((x) => x.title)).toEqual(['Line Amp', 'Sweep Filter', 'EQ Filter', 'Vision']);
    expect(s.columns).toEqual([[0, 1], [2, 3]]); // Line Amp over Sweep Filter, EQ Filter over Vision
    expect(s.sections[2].buttons.map((b) => b.label)).toEqual(['PREDYN', 'TYPE', 'DYN SC']);
    const btn = (sec, label) => s.sections.find((x) => x.title === sec).buttons.find((b) => (b.label ?? b.icon) === label);
    expect(btn('Line Amp', 'PAD')).toMatchObject({ on: true, color: 'red' });
    expect(btn('Line Amp', 'Ø').on).toBe(false);
    expect(btn('Line Amp', 'hpf').on).toBe(true);
    expect(btn('Sweep Filter', 'ON').on).toBe(true);
    expect(btn('EQ Filter', 'PREDYN').on).toBe(true);
    expect(btn('EQ Filter', 'DYN SC').on).toBe(true);
    expect(btn('Vision', 'POWER').on).toBe(true);
    expect(s.sections.flatMap((x) => x.buttons).every((b) => typeof b.id === 'string')).toBe(true);
  });

  it('API Vision on the 560 graphic EQ reads its ten bands', () => {
    const p = { eq_on: control(1), eq_select: control(1), '560_1khz': control(6) };
    const s = G.stateFor('uaudio_api_vision_ext', (id) => p[id]);
    expect(s.eq.mode).toBe('560');
    expect(s.eq.bands).toHaveLength(10);
    expect(s.eq.bands.find((b) => b.f === 1000).g).toBe(6);
  });

  it('API 2500: compressor only, threshold and ratio from their displays', () => {
    const p = { power: control(1), threshold: control(0.4, '-12.0 dB'), ratio: control(0.3, '4:1') };
    const s = G.stateFor('uaudio_api_2500_ext', (id) => p[id]);
    expect(s.eq).toBeNull();
    expect(s.gate).toBeNull();
    expect(s.comp).toMatchObject({ on: true, threshold: -12, ratio: 4 });
  });

  it('an unknown strip has nothing to draw', () => {
    expect(G.stateFor('something_else', () => undefined)).toEqual({ eq: null, comp: null, gate: null, strip: null });
  });
});
