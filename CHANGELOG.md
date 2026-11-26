# Changelog

| Version | Changes |
|---|---|
| 0.8.0 | The window **floats** above LUNA's windows again. **Graphs:** Values and Graphs toggle buttons add EQ, compressor and gate graphs of the followed strip: the 550 or 560 EQ with the 215 filters, the 225 or 2500 compressor curve with live gain reduction, and the 235 gate or expander curve with open/closed, plus meters: In as the strip's five input VU LEDs (−12 to +18), Out as a smooth L/R meter with peak hold (their own Meters toggle). The 215 filter corners are marked HP and LP. **Low/High Cut now switch the 215 filters on** when moved off their ends (and off when both are back), since no Console 1 button drives that switch. An **API Vision** pane shows the strip's switches as lit/grey buttons named as on its panel (PAD, Ø, 50 Hz cut, SC, PREDYN, TYPE, DYN SC, SC LINK, POWER), **clickable** to flip them in LUNA; the Console 1's **Filters to Comp and Preset buttons now drive PAD and the 50 Hz cut** (matching the strip's Line Amp layout; Filters to SC moves to the pane); the EQ graph includes the 50 Hz cut and separates what's heard from what only feeds the sidechain. The Console 1's **Display On** button brings the window back after it's closed (lit while it shows); **Mode** steps through the views (values, graphs, graphs with meters, everything). The gate and compressor panes list their settings in a labelled grid. They only run while shown, and meter updates never redraw the curves. |
| 0.7.0 | The window no longer floats above LUNA's windows: it is an ordinary window they can cover. |
| 0.6.1 | API 2500: Comp On drives its power button (the on/off LUNA shows), not the hidden Comp In. |
| 0.6.0 | **Buses and the Main Output:** selecting one in LUNA follows it, and the track buttons count them in LUNA's order (cue buses skipped). **API 2500** in a console slot: Comp On, Threshold, Ratio, Attack, Release, and Parallel Dry/Wet as Mix; the Comp meter follows the 2500's VU in G/R mode, matched to its printed G/R scale. Strips are now described per plugin, so more can be added. |
| 0.5.2 | Icon (radar dish). |
| 0.5.1 | Works with a renamed Console 1: automatically finds a device whose name contains "Console 1", and a **device menu** in the window picks any MIDI device (saved on this machine). |
| 0.5.0 | Renamed **Ground Control** (was "Console 1"). Same features; installs as a new Add On, so remove the old one. |
| 0.4.6 | Stereo Pan moves the heard centre of the image, from full width; nothing can get stuck. |
| 0.4.5 | Stereo pan keeps its spread: fast turns or switching tracks no longer fold the track to mono. |
| 0.4.4 | Pan works on stereo tracks: it moves both sides of the image, not just the left. |
| 0.4.3 | Snappier meter defaults (25 ms updates, Shape falls back at 5 ms per LED). |
| 0.4.2 | Output meter tracks quiet signals smoothly down to −60 instead of hanging at −24 and dropping. |
| 0.4.1 | Shape meter jumps both ways (the gate opening was too slow); separate Comp and Shape fall-back settings. |
| 0.4.0 | Meter settings panel: meter timing and calibration adjustable live. |
| 0.3.3 | Comp and Shape dots jump to peaks and fall back one LED at a time. |
| 0.3.2 | Comp and Shape dots move one LED at a time instead of jumping. |
| 0.3.1 | Input, Comp and Shape meters, driven by the API strip's own meters. |
| 0.2.4 | Meters land exactly on the printed marks. |
| 0.2.3 | Meters hold steady levels instead of dropping out. |
| 0.2.2 | Meters use LUNA's measured meter scale. |
| 0.2.0 | Output and input meters. |
| 0.1.1 | Track buttons skip LUNA's hidden click and count-in tracks. |
| 0.1.0 | First version: follows the selected track both ways; drives the API Vision strip, volume, pan, solo and mute; LED and ring feedback. |
