<img src="icon.png" width="128" alt="Ground Control icon" align="right">

# Ground Control

A [LUNA](https://www.uaudio.com/luna) Add On that turns a **Softube Console 1 Mk II** into a
controller for LUNA's **API Vision** channel strip and **API 2500**. The Console 1's rings, LEDs
and meters follow LUNA.

> Ground Control is an independent project. It is not made, endorsed or supported by Softube,
> Universal Audio or API. Softube and Console 1 are trademarks of Softube AB; LUNA and Apollo of
> Universal Audio, Inc.; API and API Vision of their owners.

## Requirements

- LUNA 3.1.2 or later on macOS (Windows untested).
- A Softube Console 1 Mk II over USB. **Softube's Console 1 software must not be running**: it
  takes over the unit.
- API Vision or API 2500 in the track's console slot. Elsewhere only Volume, Pan, Solo and Mute
  work.

## Install

1. Download `Ground-Control.lunaaddon` from [Releases](../../releases).
2. Double-click it and click **Add** in LUNA.
3. Open it from **Add Ons → Windows**. After that it opens with your session and keeps running
   when its window is closed.

To update, open a newer `.lunaaddon`. If your Console 1 isn't found, pick it in **Settings** (the
gear, top right).

## Using it

**Selecting tracks.** Select a track, bus or the Main Output in LUNA and the Console 1 follows.
Or use **Track 1–20** and **Page −/+** on the Console 1. Past 20 tracks the buttons work in banks
of 20 (1–20, 21–40, …), within the selected track's bank; the window shows its number and name.

**On the API Vision:**

- **Input:** Input Gain. High/Low Cut drive the 215 filters and switch them on when moved off
  their ends. Filters to Comp → PAD, Phase Inv. → Ø, Preset → 50 Hz cut.
- **Shape:** on/off, Gate → threshold, Gate Release → release, Sustain → depth, Punch → attack,
  Hard Gate → gate/expander.
- **EQ:** on/off, the four 550 bands, Low/High Shelf/Bell.
- **Comp:** on/off, Ratio, Attack, Release, Threshold (225). Drive → 225 Type, Character → 225 Knee.
- Order → EQ PREDYN, Ext. Sidechain → SC LINK.

**On the API 2500:** Comp → power, Ratio, Attack, Release, Threshold, Parallel Dry/Wet → Mix.

**Everywhere:** Volume, Pan, Solo, Mute. On a stereo track, Pan moves the whole image.

**Display On** brings the window back after you close it. **Mode** steps through its views.

Each knob turn is one undo step.

## The window

- **Values / Graphs / Meters** (top right) choose what's shown.
- **Graphs:** EQ, compressor and gate curves with live gain reduction and gate state, plus input
  and output meters. The graph for the section you're turning is outlined.
- **API Vision pane:** the strip's switches. Click one to flip it in LUNA, including those the
  Console 1 can't reach.
- **Settings** (gear): which MIDI device, and meter tuning if the meters read high or low.

## Limitations

- Low Mid Q and High Mid Q do nothing. Parallel Dry/Wet does nothing on the API Vision.
- The EQ knobs drive the 550 only. With TYPE set to 560, the graph shows it but its bands stay
  in LUNA.
- On the 2500, Gain, Knee, Thrust, Type, Link and Headroom stay in LUNA.
- The EQ frequency knobs follow API's step order: clockwise lowers the frequency.
- The graphs are drawn from the settings, not measured; the EQ curve is close, not exact.

## License

Apache License 2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE). Changes:
[CHANGELOG.md](CHANGELOG.md).
