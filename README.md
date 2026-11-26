<img src="icon.png" width="128" alt="Ground Control icon" align="right">

# Ground Control

A [LUNA](https://www.uaudio.com/luna) Add On that turns a **Softube Console 1 Mk II** into a
hands-on controller for LUNA's **API Vision** channel strip, with the hardware's rings, buttons
and meters mirroring LUNA.

> Ground Control is an independent project. It is not made, endorsed or supported by Softube,
> Universal Audio or API. Softube and Console 1 are trademarks of Softube AB; LUNA and Apollo of
> Universal Audio, Inc.; API and API Vision of their owners.

## What it does

- **Follows the selected track, both ways.** Select a track in LUNA and the Console 1 follows,
  with that track's number lit. Select Track 1–20 or Page −/+ on the Console 1 and LUNA's
  selection follows. LUNA's hidden click and count-in tracks are skipped.
- **Drives the API Vision strip** on that track: Input Gain, High/Low Cut (215 filters), Filters
  to Compressor, Phase; Shape (235 gate); all four bands of the 550 EQ with shelf/bell; the 225
  compressor (Ratio, Attack, Release, Threshold, on/off); Drive and Character as Softube's own API
  map uses them; plus the track's **Volume, Pan, Solo and Mute**.
- **Stereo tracks:** Pan moves where the stereo image is heard. Straight up is L100/R100 (full
  width); turning right brings the left side across while the right stays at 100R, and turning
  left does the mirror. The movement follows LUNA's measured pan curve, so the image moves
  evenly with the knob. For other L/R settings, use LUNA's own pan knobs.
- **Mirrors LUNA:** knob rings and button LEDs show the strip's real settings and update when you
  change something in LUNA or switch tracks. No knob jumps.
- **Meters:** all four work.
  - **Output** shows the selected track's level (before the fader, as LUNA's own track meters),
    calibrated with a test tone to the printed marks (−60 to +6).
  - **Input** shows the API strip's input level.
  - **Comp** shows the 225's gain reduction: the dot rests on 0 dB and moves left as it
    compresses, with the plugin's full 12 dB just past the 10 mark.
  - **Shape** shows the 235 gate: the dot sits on 0 dB while the gate is open and jumps to −
    when it closes.
  - Input, Comp and Shape move in steps, as the API strip's own LED meters do. The Comp and Shape
    rows show a single dot (all the hardware rows can draw). The Comp dot jumps to a peak at once
    and walks back toward 0 dB one LED at a time; the Shape dot jumps both ways.
- **Meter settings** (bottom of the window): how fast the Comp and Shape dots fall back, how
  often meters update, and a trim and LED aim for the Input/Output meters if your unit reads a
  little high or low. Changes apply at once and are kept on this machine; **Reset to defaults**
  undoes them. Reinstalling resets them.
- A knob turn is one undo step.

## Requirements

- **LUNA 3.1.2 or later** on macOS. Windows should work but hasn't been tried.
- A **Softube Console 1 Mk II** over USB. No Softube software is needed.
- Tracks with LUNA's **API Vision** console strip. On other tracks only Volume, Pan, Solo and Mute
  respond.

## Install

1. Download `Ground-Control.lunaaddon` from [Releases](../../releases).
2. Double-click it, or open it from LUNA. LUNA asks to add it; click **Add**.
3. Open it from **Add Ons → Windows**. After that it opens with your session and keeps running
   while its window is hidden.

**Quit Softube's Console 1 software** (On-Screen Display) first: while it runs it takes over the
unit. The Console 1 shows up in LUNA as the MIDI device **"Console 1"**; plugging it in later is
fine. If you renamed it (in Audio MIDI Setup), Ground Control still finds a device whose name
contains "Console 1"; otherwise pick it from the **device menu** at the top of the window. The
choice is kept on this machine.

To update, open a newer `.lunaaddon`; it replaces the installed one.

## Not done yet

- The **Low Mid Q, High Mid Q, Parallel Dry/Wet and Preset** controls do nothing (the API strip
  has no natural target for them).
- Only the **API Vision** strip is supported, not LUNA's other console strips. Meter and control
  details are kept per strip (`STRIPS` and `LAYOUT` in `logic.js`) so others can be added.
- The EQ frequency knobs follow API's own step order, so turning clockwise lowers the frequency.

## How it works

An Add On is a web page LUNA hosts; it talks to LUNA's engine through Universal Audio's
[LUNA Builder SDK](https://github.com/uaudio-labs/luna-builder-sdk).

- `logic.js` has everything except the page: the control layout (`LAYOUT`, one row per Console 1
  control: CC → API parameter id or track control), the meter scales, and the `Console1` class
  that follows the selected track, writes controls (each turn a touch gesture, so one undo step)
  and sends values back to the Console 1 for rings, LEDs and meters.
- `main.js` and `index.html` are the window: status, the strip's current values, Meter settings.
- The Console 1's MIDI map, meters and LED behaviour: [docs/console1-mk2-midi.md](docs/console1-mk2-midi.md).
- LUNA's track meter is a meter scale, not amplitude: from −18 dBFS up, dB = 33 × (level − 1);
  below that it bends to 0 at about −60 (`LEVEL_DB_TABLE`, measured with a 1 kHz tone). The API
  strip's own meters (`effects/console/meters/*`) step like the hardware's LEDs.
- Stereo pan uses `HEARD_CENTRE`, LUNA's pan curve measured from the master bus L/R levels,
  with the heard centre taken from the L/R amplitude ratio (tangent law).

## Development

```sh
git clone --recurse-submodules https://github.com/Gerk/ground-control.git
cd ground-control
(cd luna-builder-sdk && npm ci)   # the SDK, pinned as a submodule
npm install
npm test                          # runs against the SDK's mock engine; no LUNA needed
npx ua-builder install            # link it into LUNA's Add Ons folder for live testing
npm run pack                      # Ground-Control.lunaaddon, runtime files only
```

## License

Copyright 2026 Mark Guertin. Licensed under the [Apache License 2.0](LICENSE); see
[NOTICE](NOTICE). Includes Universal Audio's LUNA Builder SDK (`vendor/`), also Apache 2.0.

Changes: [CHANGELOG.md](CHANGELOG.md).
