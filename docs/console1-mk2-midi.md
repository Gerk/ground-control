# Softube Console 1 Mk II: MIDI map (unofficial)

Softube doesn't publish this. Ground Control uses everything below; the "?" roles in the
controls table were settled against the hardware and are in `logic.js` (`LAYOUT`).

**Source:** Greg Nicolett's Cubase MIDI Remote template `Softube_Console 1 Mk2.midiremote`, posted
in the [Steinberg forum thread "Softube Console 1 MK2 + MIDI Remote"](https://forums.steinberg.net/t/softube-console-1-mk2-midi-remote-controller-gold/921485)
(post 8). Decoded 2026-11-24. The file is a "Steinberg Resource File": a text header, then zlib
streams holding `Softube_Console 1 Mk2.json` (the surface) and `___midiremote.json` (the mappings).

## Transport

- **Port:** MIDI in and out both named `Console 1` (the template's detection filter).
- **Messages:** 62 controls, all Control Change on **channel 1**, absolute 0–127.
- **Steps:** the encoders are endless but send absolute values in steps of 3. Hold **Fine Adjust**
  for steps of 1 (forum reports).
- **Feedback (verified):** sending a CC back to the `Console 1` output sets that
  knob's LED ring or that button's LED; CC21–40 light the track buttons.
- **Meters:** input L/R = CC110/111, output L/R = CC112/113, Shape = CC114, Compressor = CC115
  (from ReaLearn's Console 1 Mk II preset, helgoboss/helgobox). The LEDs are evenly spaced over
  0–127; the printed marks sit at −60 = 0, −24 ≈ 33, −12 ≈ 56, −6 ≈ 80, 0 = 103 (verified),
  +6 = 127. Whether the meter holds a value without being resent is not verified.
  Each meter has 17 LEDs (index 0–16); the marks are on LEDs 0, 4, 7, 10, 13 and 16. Observed with
  a test tone: LED k is the top one lit when the CC is above (k−1)×127/16 and at most k×127/16, so
  a value exactly on a mark lights one LED too high. Send about 4 less (the LED's middle).
- **Software:** reportedly the unit stops sending MIDI while Softube's Console 1 software has it.
  **Shape (114) and Comp (115)** are horizontal rows of 11 LEDs that light a single dot, left to
  right over 0..127 (verified). Comp is printed −20 … 10, 6, 3, 0 dB (0 dB at the right end);
  Shape is printed −, 0 dB (middle), +.
- **Software:** Softube 2.5.97+ (Dec 2024) has an official "Use Mk I/II as MIDI Controllers" option in the
  On-Screen Display menu.

## Controls

The sections come from each control's position on the template's surface grid (x across, y down)
and from what the author bound it to in Cubase. The exact roles within a section are educated
guesses, marked "?".

| Section | CC | Kind | Likely role |
|---|---|---|---|
| Top row | 102 | button | ? (bound to "open editor") |
| | 104 | button | ? (bound to "open instrument") |
| | 97 / 96 | buttons | previous / next (bound to prev/next track) |
| | 21–40 | 20 buttons | track select 1–20 |
| | 17 | button | ? (far right) |
| Input | 107 | knob | input gain |
| | 105 | knob | filter (high/low cut ?) |
| | 103 | knob | filter (high/low cut ?) |
| | 61, 108, 58 | buttons | filter-to-compressor / phase / ? |
| Shape (gate) | 53 | button | Shape on |
| | 54, 56, 55, 57 | knobs | gate, release, sustain, punch (order ?) |
| | 59 | button | hard gate ? |
| EQ | 80 | button | EQ on |
| | 93 / 65 | buttons | low / high shelf-bell ? |
| | 92, 91 | knobs | low band: frequency, gain ? |
| | 90, 89, 88 | knobs | low-mid: Q, frequency, gain ? |
| | 87, 86, 85 | knobs | high-mid: Q, frequency, gain ? |
| | 83, 82 | knobs | high band: frequency, gain ? |
| Compressor | 46 | button | Comp on |
| | 49, 50, 51, 48, 47 | knobs | ratio, parallel, attack, release, threshold (order ?) |
| Output | 15 | knob | drive |
| | 18 | knob | character |
| | 10 | knob | pan |
| | 7 | knob | volume |
| | 13 / 12 | buttons | solo / mute |

Many of these CCs fall in 32–63. LUNA rewrites those as 14-bit LSBs in track recordings, but
`Luna.MidiInput` (and so the MIDI Mapper) gets them raw.

## Pairing with LUNA's API Vision strip

Softube's own map for the Apollo version of the API Vision strip
(`/Library/Application Support/Softube/ApolloMaps/UADACMap_UADAPIVisionChannelStrip.txt`,
installed with Softube's Console 1 software) assigns API parameters to Console 1 control names
(IN_Gain, EQ_LMF_Freq, COMP_Threshold, OUT_Drive, ...). Ground Control follows the same
assignments for LUNA's `uaudio_api_vision_ext`, so the controls land where a Console 1 user
expects them.
