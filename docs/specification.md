# daw-ui — specification

Status: describes version 1. This is the normative description of behaviour; the tests in [`test/`](../test) (jsdom) and [`e2e/`](../e2e) (Playwright) are its executable form, and [`perf/`](../perf) measures it. When code and this document disagree, one of them is a bug. The rules every component follows are in [principles.md](./principles.md).

- [1. Scope](#1-scope)
- [2. Parts](#2-parts)
- [3. Value model](#3-value-model)
- [4. Formats](#4-formats)
- [5. Value controls](#5-value-controls-knob-fader-numberbox-xy-pad-multi-slider-slider)
- [6. Gestures](#6-gestures)
- [7. Meter and Spectrum](#7-meter-and-spectrum)
- [8. Toggle](#8-toggle)
- [9. ToggleGroup](#9-togglegroup)
- [10. Timeline, Region, Waveform, Notes and Curve](#10-timeline-region-waveform-notes-and-curve)
- [11. Keys](#11-keys)
- [12. Direction](#12-direction)
- [13. Performance budgets](#13-performance-budgets)

## 1. Scope

| Layer | Entry point | Depends on | Responsibility |
| --- | --- | --- | --- |
| Core | `@addstack/daw-ui` | nothing | Ranges and scales, formats, geometry, meter ballistics, peaks of audio, time grids. |
| React binding | `@addstack/daw-ui/react` | `react`, `react-dom` (peers, ≥ 19) | Headless components. |

Non-goals: styling, audio processing, and application state such as undo history or automation. The components report what the user did; the application decides what it means.

## 2. Parts

A component is a namespace of parts (`Knob.Root`, `Knob.Control`, …). A part must be rendered inside its component's `Root`, or it throws.

Each part:

- renders one element (listed per part below) and passes through the props of that element;
- accepts `className` and `style` as plain values, never as functions of state: state reaches CSS through data attributes and CSS variables ([principles, section 7](./principles.md#7-performance));
- accepts `render`: an element, which is cloned with the part's props merged into its own, or a function `(props, state) => element`;
- merges props in this way: the user's event handler runs first, and if it calls `event.preventDefault()`, the part's own handler is skipped; class names are joined; the user's style is spread over the part's inline style; refs all receive the element.

A part that moves focus because of a pointer press, or of a click on a `Label`, calls `focus({ preventScroll: true, focusVisible: false })`: it shows no focus ring, as the browser's own focusing on a click shows none. Focus moved by keys keeps the ring.

Inline styles set by parts are limited to positioning (`position`, insets, `translate`, `clip-path`, and `z-index` on black keys), `touch-action: none` on drag targets, and `user-select: none` (with `-webkit-user-select`) on parts that show text: every `Label`, `Knob.Value`, `Fader.Value`, `Fader.Tick`, the display of `NumberBox.Field`, `NumberBox.Segments` (its segments inherit it), `Meter.Clip`, `Toggle`, `Timeline.Ruler`, `Region.Header`, `Region.Label`, `XYPad.Value`, `Slider.Label`, `Slider.Value`, `MultiSlider.Label`, `MultiSlider.Value` and `Keys.Key`. The text input of a number box being edited is selectable.

## 3. Value model

`createRange({ min, max, step?, scale?, wrap?, endless? })`:

- requires `max > min` and `step > 0`, and throws a `RangeError` otherwise;
- `clamp(v)` brings `v` into the range: it limits it to `[min, max]`, or, with `wrap` or `endless`, as below;
- `constrain(v)` clamps, then snaps to `min + k·step` when `step` is set (to `k·step` when `min` is `−∞`; rounded to the decimals of `step` and `min`), and otherwise rounds to 12 significant digits; then it clamps again;
- `normalize(v)` returns the travel position of `v` through the scale;
- `denormalize(t)` brings `t` into the travel, maps it through the scale, and constrains the result.

A range has one of three kinds of ends, which decide how values and travel are brought into it:

| | `clamp(v)` | `normalize(v)` | `denormalize(t)` |
| --- | --- | --- | --- |
| bounded (default) | `[min, max]` | in `[0, 1]` | `t` clamped to `[0, 1]` |
| `wrap` | `min + ((v − min) mod (max − min))`, in `[min, max)`: `max` is the same point as `min` | in `[0, 1)` | `t − ⌊t⌋` |
| `endless` | `v`, unchanged | `(v − min) / (max − min)`, not bounded | `min + t·(max − min)`, not bounded |

`wrap` and `endless` require a finite `min` and `max`, and `endless` requires the linear scale; otherwise `createRange` throws a `RangeError`. With both, `endless` applies. On an endless range, `min … max` only sets the scale: it is one turn of a knob.

Scales map a value in `[min, max]` to travel and back:

| Scale | Travel of `v` |
| --- | --- |
| `linear` | `(v − min) / (max − min)` |
| `log` | `ln(v / min) / ln(max / min)`; requires `min > 0` |
| `power(e)` | `linear(v)^(1/e)` |
| `decibel` | `(a(v)^¼ − a(min)^¼) / (a(max)^¼ − a(min)^¼)` with `a(dB) = 10^(dB/20)`; `min = −∞` is allowed and maps to travel 0 |

### Zones

`zoneOf(value, zones)` takes zones as a map from name to lower bound, in the value's units. The value is in the zone with the highest bound that it is strictly above; a value at a bound belongs to the zone below (0 dB is not in `{ clip: 0 }`). Below every bound, and without zones, it is in no zone (`undefined`). The order of the map does not matter.

Controls that take `zones` expose the zone as `data-zone`, so that thresholds are styled in CSS and the attribute changes only when a bound is crossed.

## 4. Formats

A format is `{ format(value): string; parse(text): number | null; segments? }`. `parse` returns `null` for text it does not understand. Parsed values are constrained by the range afterwards.

`segments`, when present, is a fixed list of the value's fields and the literal text between them, for `NumberBox.Segments` (§5.8):

- a field is `{ type: "field", name, step, get(value), format(value), min?, max? }`: `step` is the change of the value for one step of the field, in the value's units; `get` is the field's number in a value, `format` its text; `min` and `max` bound that number when it has bounds;
- a literal is `{ type: "literal", text }`.

Fields are views of the one value, so a step past a field's end carries into the next field. The built-in formats with segments build `format(value)` by joining the segments' texts.

Built-in formats:

- print numbers with `Intl.NumberFormat` in the given `locale` (default: the runtime's), with a fixed number of decimals and no grouping; a value that rounds to zero prints without a sign;
- parse either decimal separator (`.` or `,`) and the Unicode minus sign (U+2212);
- add only unit symbols that are the same in every language (Hz, kHz, dB, ms, s, %) and signs (−∞);
- take every word or letter from the application. `pan` requires `left`, `right` and `center`, and `pitch` requires `names`.

| Format | Output | Accepted input |
| --- | --- | --- |
| `number({ digits = 2, unit? })` | `1.50`, `120.00 BPM` | a number, optionally followed by `unit` (case-insensitive) |
| `decibel({ digits = 1 })` | `-6.0 dB`; `-∞ dB` for `−Infinity` | a number, optionally `dB`; `-inf…` or `-∞` |
| `frequency()` | below 1000: `Hz` with 1 decimal under 100, else 0; from 1000: `kHz` with 2 decimals under 10 000, else 1 | a number, optionally `Hz`; a number followed by `k` or `kHz` |
| `percent({ digits = 0 })` | the fraction as a percentage in the locale's style | a number, optionally `%`; divided by 100 |
| `pan({ left, right, center })` | `center` when `round(|v|·100) = 0`, else the amount followed by `left` or `right` | `center`; a number (÷100); a number followed by `left` (negative) or `right` |
| `time()` | milliseconds: 2 decimals under 10, 1 under 100, else 0, then `ms`; from 1000: seconds with 2 decimals and `s` | a number, optionally `ms`; a number followed by `s` (×1000) |
| `position({ beatsPerBar = 4, divisions = 4 })` | beats as `bar.beat.division`, each counted from 1: with `n = ⌊v·divisions + 10⁻⁹⌋`, bar `⌊n / (beatsPerBar·divisions)⌋ + 1`, beat `⌊(n mod beatsPerBar·divisions) / divisions⌋ + 1`, division `(n mod divisions) + 1` | one to three whole numbers (the first may be negative) separated by `.`, `:`, `,`, `;` or spaces, missing ones being 1: `(bar − 1)·beatsPerBar + (beat − 1) + (division − 1) / divisions` |
| `pitch({ names, middleC = 4 })` | a MIDI note `n` (rounded) as `names[n mod 12]` followed by the octave `⌊n / 12⌋ − 5 + middleC`; `names` must have 12 entries, or it throws a `RangeError` | a name of `names` (the longest that matches, whatever the case, `#` read as `♯`), then any of `♯`, `#` (+1) and `♭`, `b` (−1), then a whole octave number, which may be negative |
| `timecode({ fps })` | seconds as `hh:mm:ss:ff`, two digits each, from `n = ⌊|v|·fps + 10⁻⁹⌋` frames; a minus sign before the hours when `v < 0` and `n > 0`. `fps` must be a whole number greater than 0, or it throws a `RangeError` | one to four whole numbers separated as for `position`, filled from the right (frames last); 3 to 8 digits alone are split into pairs from the right (`1500` is 15 s); a leading minus negates |

Segments of the built-in formats:

| Format | Fields (`name`: `step`, bounds) | Literals |
| --- | --- | --- |
| `number` | `integer`: 1, text with the sign of the rounded value (`-0` included); `fraction`: 10^−digits, 0 … 10^digits − 1, padded to `digits` (only when `digits > 0`). Both from the value rounded to `digits`. | the locale's decimal separator; `" " + unit` when `unit` is set |
| `position` | `bars`: `beatsPerBar`; `beats`: 1, 1 … `beatsPerBar`; `divisions`: 1 / `divisions`, 1 … `divisions` | `.` |
| `timecode` | `hours`: 3600, from 0; `minutes`: 60, 0 … 59; `seconds`: 1, 0 … 59; `frames`: 1 / `fps`, 0 … `fps` − 1 | `:` |

## 5. Value controls (Knob, Fader, NumberBox, XY pad, multi-slider, slider)

### 5.1 State

Each root holds a value in a store outside React: controlled when `value` is given, otherwise starting at `constrain(defaultValue ?? origin)`. `origin` defaults to `min` and is clamped. The displayed value is `clamp(value)`.

Every part describes what it shows of the value: attributes (e.g. `aria-valuenow`, `d`, `data-zone`), CSS properties (e.g. `--knob-value`, `bottom`) and text. React applies the description when the part renders. When only the value or `dragging` changes, the store gives the new state to every part, which writes the differences from its element to the DOM (attributes and styles compared with the DOM, text written into React's own text node); **no component renders**. A controlled value reaches the parts through the store as well, after the parent renders.

With `read`, the root calls it once per animation frame through the frame loop shared with meters (§7.2), and shows `constrain(read())` through the store, except while the pointer is down on the control or a gesture is open (§6): the user's value wins until they let go.

State exposed to parts: `value`, `normalized` (not bounded on an endless control, §3), `originNormalized`, `text` (formatted value), `dragging`, `disabled`, `bipolar` (`0 < originNormalized < 1`), `zone` (`zoneOf(value, zones)`, §3).

The root takes `wrap` and `endless` (§3) into its range; `Fader.Root` does not take `endless`.

Every part of a knob, fader or number box carries the data attributes `data-dragging`, `data-disabled`, `data-bipolar` and `data-zone` for this state; fader parts also carry `data-orientation`, number box parts `data-editing`. `Fader.Tick` is the exception: its `data-zone` is the zone of its own `value`.

A change is **applied** as follows: the candidate is constrained; if it equals the last value this control produced or showed (`Object.is`), nothing happens; otherwise a gesture starts if none is open (§6), an uncontrolled control shows the value through the store, and `onValueChange(value, { reason, event, delta })` is called. A controlled control shows the new value only when the parent passes it back.

`delta` is the new value minus the previous one. On a wrapping range it follows the direction of the input: a drag, wheel or key towards higher values whose raw difference is negative (the value came around past `max`) gets `max − min` added, and the other way round, so a step up from 350° to 10° is `+20`. A reset and a typed value have no direction and report the raw difference.

### 5.2 Drag

On primary-button pointerdown on the control (not disabled): the default action is prevented, the control takes focus, captures the pointer, and optionally requests pointer lock (`pointerLock`). The drag keeps a travel position `p`, starting at `normalize(value)`.

On each pointermove, `Δ` is the pointer movement since the previous event (`movementX/Y` while locked, else client coordinates): up for vertical controls, towards the inline end for horizontal ones (§12). Then `p = clamp01(p + Δ / sensitivity × (Shift ? 0.1 : 1))`, and `denormalize(p)` is applied with reason `"drag"`. Because `p` is clamped, moving back after overshooting an end responds at once. On a wrapping or endless range, `p` is not clamped, and the drag goes round. `dragging` is true from the first move until the pointer is released, cancelled or loses capture; then the gesture ends.

`sensitivity` (pixels for the full travel) defaults to 200 for a knob, to the track's length along the orientation for a fader (the control's length if there is no track, 200 if that is 0), and for a number box to `clamp(2·(max − min) / step, 100, 1000)` (400 without a step or with an infinite range; an endless number box takes `2·(max − min) / step` unclamped, two pixels per step).

### 5.3 Keyboard

On the focused control (not disabled):

| Key | Continuous range | With `step` |
| --- | --- | --- |
| ArrowUp; ArrowRight (§12) | travel + 0.01 (Shift: + 0.001) | value + step |
| ArrowDown; ArrowLeft (§12) | travel − 0.01 (Shift: − 0.001) | value − step |
| PageUp / PageDown | travel ± 0.1 | travel ± 0.1 if that is more than one step, else ± step |
| Home / End | `min` / `max` | same |
| Delete, Backspace | reset | same |

On a wrapping range, End goes to the last value before `max`, `min + (⌈(max − min) / step⌉ − 1)·step`, and does nothing on a continuous one. An endless range ignores Home and End. Arrows and Page keys give the direction for `delta` (§5.1).

Each handled key prevents its default action and is one gesture.

### 5.4 Wheel

A non-passive wheel listener (unless `wheel={false}`) converts the event to pixels (`deltaMode` lines × 33, pages × 800) towards a higher value: `−deltaY`, or when `deltaY` is 0, `−deltaX` with Shift (a vertical wheel turned horizontal) and `deltaX` without. Travel moves by `pixels × 0.0005` (Shift: ×0.1), so a 100 px notch is 5%. The default action is prevented when the event is handled, so the page does not scroll. A burst of wheel events is one gesture, which ends 400 ms after the last event.

### 5.5 Reset

Double-click (knob, fader) and Delete/Backspace apply `resetValue ?? defaultValue ?? origin` with reason `"reset"` as one gesture.

### 5.6 Parts

| Part | Element | Behaviour |
| --- | --- | --- |
| `*.Root` | `div` | Holds the value. Knob: `--knob-value`, `--knob-angle` (`−sweep/2 + normalized·sweep`, in deg; both not bounded on an endless knob). Fader: `--fader-value`. |
| `Knob.Control`, `Fader.Control` | `div` | `role="slider"`, `tabindex` 0 (−1 disabled), `aria-valuemin` (omitted when infinite), `aria-valuemax` (on a wrapping range, the last value End reaches, else `max`), `aria-valuenow` (omitted when infinite), `aria-valuetext` = formatted value, `aria-orientation`, `aria-disabled`, `aria-labelledby` = the mounted `Label`. On an endless knob: `role="spinbutton"`, without `aria-valuemin`, `aria-valuemax` and `aria-orientation`. Handles §5.2–5.5. |
| `*.Label` | `span` | Its id labels the control while mounted. A click focuses the control. |
| `*.Value` | `output` | The formatted value, `for` the control, `aria-live="off"`, `dir="auto"`. With `children` as a function, `children(text, value)` is rendered instead, and that part (alone) renders on every change of the value. |
| `Knob.Track` | `path` | Arc over the full sweep, radius `radius` (40) around (50, 50), `fill="none"`. |
| `Knob.Range` | `path` | Arc from the origin's angle to the value's angle. An empty arc is a bare move command. An endless knob draws none: `d` is absent. |
| `Knob.Pointer` | `line` | From radius `from` (0) to `to` (40) at the value's angle. |
| `Knob.Modulation` | `path` | The arc at radius `radius` (46) from the value's angle to the angle of `read()`, the modulated value in the knob's units. `read` is called once per animation frame and the arc (`d`) is written by the frame loop only, never by a render. |
| `Knob.ModulationRange` | `path` | The arc at radius `radius` (46) over the depth of a modulation: `d` = the depth given, else the value of the `Knob.ModulationDepth` with the same `source` (default `""`), else 0. With `p` the value's travel, from `p` to `p + d`, or from `p − |d|` to `p + |d|` with `bipolar`, each clamped to 0 … 1 unless the knob wraps or is endless. No `d` attribute when the depth is 0. Rewritten without rendering when the value or the depth changes, and when a handle of its source mounts or unmounts. |
| `Knob.ModulationDepth` | `div` | A value control of its own (§5.1–§5.5) for the depth of the modulation `source`: `role="slider"`, `min` −1, `max` 1, `origin` 0, `step` 0.01 unless given, resets to `resetValue` or else 0, default format `formats.percent()`, disabled with the knob; `aria-valuetext` its format, `--knob-depth` its value. It does not change the knob's value. |
| `Fader.Track` | `div` | `position: relative`; its length is the default sensitivity. |
| `Fader.Range` | `div` | Absolutely positioned from the lower of origin and value, with length equal to their distance. |
| `Fader.Thumb`, `Fader.Tick` | `div` | Centred on the value (thumb) or on `normalize(value)` (tick). Ticks are `aria-hidden`. |
| `NumberBox.Field` | `span`, or `input` while editing | Display: `role="spinbutton"` with the value attributes (without `aria-valuemin` and `aria-valuemax` when endless), `dir="auto"`. See §5.7. |
| `NumberBox.Segments` | `div`, or `input` while editing | `role="group"` labelled by the `Label`, `dir="ltr"`. Renders the format's segments, through `children(segment)` when given (called when the format changes, not the value), else a `NumberBox.Segment` each. See §5.8. |
| `NumberBox.Segment` | `span` | A field: `role="spinbutton"`, `tabindex` 0 (−1 disabled), `aria-label` = `labels[name]`, `aria-valuenow` = `get(value)`, `aria-valuemin`/`aria-valuemax` = the field's bounds, `data-segment` = `name`, text `format(value)`. A literal: its text, `aria-hidden`, `data-literal`. |

Angles are in degrees, clockwise from 12 o'clock. `sweep` defaults to 270, and to 360 on a wrapping or endless knob.

### 5.7 Number box editing

Editing starts on double-click, on Enter, or on a typed character matching `[0-9.,+−-]` without Ctrl, Meta or Alt (the draft is then that character). The draft starts as the formatted value, selected. While editing, the field is a text input with `inputmode="decimal"`, labelled by the `Label`, with `data-editing` on the root and the field. Enter applies `format.parse(draft)` with reason `"input"` as one gesture if it is not `null`, then gives focus back to the display. Escape discards the draft and gives focus back. Blur applies like Enter, without moving focus. Only the first of Enter or blur applies.

### 5.8 Number box segments

`NumberBox.Segments` throws when the root's format has no `segments`. Its `labels` prop maps field names to accessible names from the application. The first field has the control's id, so the `Label` focuses it on click.

A field's text and `aria-valuenow` are written through the store (§5.1): a change of the value renders neither the group nor the segments. On a field, with `s` its step and `v` the last value (§5.1):

| Input | Effect |
| --- | --- |
| ArrowUp / ArrowDown | applies `v ± s`, reason `"keyboard"`, one gesture |
| ArrowLeft / ArrowRight | focuses the previous / next field of the group; the group is always left to right |
| drag | as §5.2 up to the movement, then every 4 px up (40 px with Shift) applies `v + s`, and every 4 px down `v − s`, reason `"drag"`; the remainder carries to the next move |
| wheel | as §5.4 up to the pixels, then every 100 px (a notch) applies one step, reason `"wheel"` |
| Enter, double-click, a typed character that starts a value | edits the whole value as text (§5.7); Enter and Escape give focus back to this field |
| PageUp, PageDown, Home, End, Delete, Backspace | as on the field (§5.3, §5.5), on the whole value |

Each step's `delta` (§5.1) has the direction of the input.

### 5.9 XY pad

`XYPad.Root` (`div`, `role="group"`, named by `XYPad.Label`) holds a list of values `[x, y]`, one per thumb: controlled by `value`, or starting at `defaultValue` (default one thumb at `[x.min, y.min]`), each constrained to the ranges `createRange(x)` and `createRange(y)` (defaults 0 … 1). A change constrains the thumb's value, and does nothing if it is the same; otherwise it starts a gesture if none is under way, shows it at once when uncontrolled (controlled, when the parent passes it back), and calls `onValueChange(values, { reason, event, thumb })` with every thumb's value. Thumbs do not constrain each other. With `read`, `read()` once per animation frame gives the values, unless a thumb is held or a gesture is under way.

- **Drag.** A primary press on `XYPad.Thumb index={i}` drags thumb `i`; on `XYPad.Control` away from the thumbs, the thumb nearest in travel to the pointer first takes the pointer's position, then is dragged. The control's box is read at the press. Each move adds to the thumb's travel `Δx / width` across (negated right to left) and `−Δy / height` up, times 0.1 with Shift, clamped to 0 … 1, and changes the value to `denormalize` of it, reason `"drag"`. The pointer is captured; release ends the gesture. `data-dragging` is on the thumb meanwhile.
- **Keys** on a thumb, each one gesture, reason `"keyboard"`: ArrowLeft and ArrowRight move `x` (ArrowRight towards `max` left to right, towards `min` right to left), ArrowUp and ArrowDown move `y`, by the axis's `step`, else by 0.01 of travel (0.001 with Shift); PageUp and PageDown move `y` by 0.1 of travel; Home and End set `x` to `min` and `max`. Delete and Backspace, and a double-click, reset the thumb to `resetValue[i]`, else `defaultValue[i]`, reason `"reset"`.
- **Parts.** `XYPad.Control` (`div`, `position: relative`, `touch-action: none`). `XYPad.Thumb` (`div`, `role="slider"`, `tabindex` 0, `aria-valuemin`/`aria-valuemax` the finite bounds of `x`, `aria-valuenow` its finite `x`, `aria-valuetext` = `format.x(x) + ", " + format.y(y)`, `data-xy-thumb`; `position: absolute`, `inset-inline-start` and `bottom` the travel of `x` and `y` in percent, `translate: −50% 50%` (`50% 50%` right to left), `--xy-pad-x` and `--xy-pad-y` the travel, `touch-action: none`). `XYPad.Value` (`output`, `dir="auto"`, `user-select: none`) the text of thumb `index` (default 0): both formats joined with ", ", or one with `axis`. Positions, attributes and texts are rewritten without rendering. `disabled` ignores input, sets `data-disabled` and removes the thumbs from the tab order. Default formats: `formats.number({ digits: 2 })`.

### 5.10 Multi-slider

`MultiSlider.Root` (`div`, `role="group"`, named by `MultiSlider.Label`) holds a list of values on one range `createRange({ min, max, step, scale })` (defaults 0 … 1): controlled by `value`, or starting at `defaultValue`, each constrained. A change constrains the values it sets and keeps those that differ; if none does, nothing happens; otherwise it starts a gesture if none is under way, shows them at once when uncontrolled (controlled, when the parent passes them back), and calls `onValueChange(values, { reason, event, indexes })` with every value and the indexes that changed. With `read`, `read()` once per animation frame gives the values, unless a stroke or a gesture is under way. Default format: `formats.number({ digits: 2 })`, 0 digits when `step` is whole.

- **Strokes.** A primary press on `MultiSlider.Control` prevents the default action and reads, once, the control's box and each item's left and right; the value at a height `y` is `denormalize(clamp01(1 − (y − top) / height))`. Items whose span contains the pointer's `x` take the value at its `y` (reason `"paint"`), and the nearest of them is focused. On each move, from the previous point to the current one, every item whose span meets the segment's horizontal extent takes the value at the height of the segment where it crosses the item's middle, clamped to the segment: reason `"paint"`. With Shift at the press, the item nearest the pointer alone moves, its travel changed by `−Δy / height × 0.1` per move, clamped to 0 … 1: reason `"drag"`. The control captures the pointer and has `data-painting` until release, cancel or lost capture, which end the gesture.
- **Keys** on an item, each one gesture: ArrowUp and ArrowDown change it by `step`, else by 0.01 of travel (0.001 with Shift); PageUp and PageDown by 0.1 of travel; Home and End set `min` and `max` (reason `"keyboard"`). ArrowLeft and ArrowRight focus the previous or next item along the reading direction; with Shift, that item first takes this one's value (reason `"paint"`). Delete and Backspace, and a double-click, reset the item to `resetValue`, else its `defaultValue`, else `origin` (default `min`): reason `"reset"`.
- **Parts.** `MultiSlider.Control` (`div`, `position: relative`, `touch-action: none`). `MultiSlider.Item index={i}` (`div`, `role="slider"`, `aria-orientation="vertical"`, `aria-label` the number `i + 1` unless given, `aria-valuemin`/`aria-valuemax` the finite bounds, `aria-valuenow` its finite value, `aria-valuetext` its format; `tabindex` 0 on the focusable item, at first item 0, then the last focused, −1 on the others and on all while disabled; `position: absolute`, `inset-block: 0`, `inset-inline-start: i / n` and `width: 1 / n` in percent of `n` values, `--multi-slider-value` its travel). `MultiSlider.Range` (`div` in an item, `position: absolute`, `bottom` the lower and `height` the distance of the travels of `origin` and the value, in percent). `MultiSlider.Value` (`output`, `dir="auto"`, `user-select: none`) the text of value `index`, else of the item last focused or changed. What they show is rewritten without rendering. `disabled` ignores input and sets `data-disabled`.

### 5.11 Slider

`Slider.Root` (`div`, `role="group"`, named by `Slider.Label`, `data-orientation`, default `"horizontal"`) holds a list of values on one range `createRange({ min, max, step, scale })` (defaults 0 … 1), in order: controlled by `value`, or starting at `defaultValue` (default one thumb at `min`), each constrained and then raised to the one before it. Thumb `i` moves between its neighbours, `values[i − 1]` (else `min`) and `values[i + 1]` (else `max`). A change constrains the value, clamps it to those bounds, and does nothing if it is the same; otherwise it starts a gesture if none is under way, shows it at once when uncontrolled (controlled, when the parent passes it back), and calls `onValueChange(values, { reason, event, thumb })`. With `read`, `read()` once per animation frame gives the values, put in order, unless a thumb is held or a gesture is under way. The root sets `--slider-value-i`, each thumb's travel, and `data-dragging` while a thumb is dragged. Default format: `formats.number({ digits: 2 })`, 0 digits when `step` is whole.

- **Drag.** A primary press on `Slider.Thumb index={i}` focuses it and drags it; on `Slider.Control` away from the thumbs, the thumb nearest in travel to the pointer (of thumbs at the same distance, the later one when the pointer is past them) first takes the pointer's position on `Slider.Track`, then is dragged. The track's box is read at the press. Each move adds to the thumb's travel `Δx / width` (negated right to left) or `−Δy / height` when vertical, times 0.1 with Shift, clamped to the travels of its neighbours, and changes the value to `denormalize` of it, reason `"drag"`. At the first move, if the thumb shares its value with a neighbour, the drag goes to the last thumb of that value when moving up, the first when moving down, which is then focused. The pointer is captured; release ends the gesture. `data-dragging` is on the thumb meanwhile.
- **Keys** on a thumb, each one gesture, reason `"keyboard"`: ArrowUp and ArrowRight raise it, ArrowDown and ArrowLeft lower it (Left and Right follow the reading direction when horizontal), by `step`, else by 0.01 of travel (0.001 with Shift); PageUp and PageDown by 0.1 of travel; Home and End set it to its lower and upper bound. Delete and Backspace, and a double-click, reset it to `resetValue[i]`, else `defaultValue[i]`, within its bounds: reason `"reset"`.
- **Parts.** `Slider.Control` (`div`, `touch-action: none`). `Slider.Track` (`div`, `position: relative`). `Slider.Thumb index={i}` (`div`, `role="slider"`, `tabindex` 0 (−1 disabled), `aria-orientation`, `aria-valuemin`/`aria-valuemax` its finite bounds, `aria-valuenow` its finite value, `aria-valuetext` its format, `data-slider-thumb`; `position: absolute`, `inset-inline-start` (or `bottom` when vertical) its travel in percent, `translate: −50% 0` (`50% 0` right to left; `0 50%` vertical), `--slider-value` its travel, `touch-action: none`). `Slider.Range` (`div`, `position: absolute`) from the first thumb's travel to the last's, or from `origin`'s (default `min`) to the value with one thumb. `Slider.Band index={b}` (`div`, `position: absolute`) from the travel of thumb `b − 1` (0 for `b = 0`) to that of thumb `b` (1 past the last thumb). Range and bands are placed with `inset-inline-start` and `width` (`bottom` and `height` when vertical) in percent of what holds them. `Slider.Value` (`output`, `dir="auto"`, `user-select: none`) the text of thumb `index` (default 0). Positions, attributes and texts are rewritten without rendering. `disabled` ignores input, sets `data-disabled` and removes the thumbs from the tab order.

## 6. Gestures

A gesture groups the changes of one user action. `onGestureStart()` is called immediately before the first applied change of the action; `onGestureEnd(value)` (value controls) or `onGestureEnd()` (toggle groups) is called when the action ends, only if a gesture started. An action that changes nothing produces no callbacks.

| Component | One action |
| --- | --- |
| Value controls | a drag (pointerdown → release); a key press; a burst of wheel events; a reset; a typed value; a multi-slider's stroke |
| ToggleGroup | a press, including the toggles an exclusive press turns off; a paint stroke; a Shift+Arrow paint step; a keyboard press |

A controlled `ToggleGroup` whose parent did not take a change shows its `value` prop again when the gesture ends.

## 7. Meter and Spectrum

### 7.1 Ballistics (`createMeterBallistics`)

Options: `floor` (−70 dBFS; the meter root passes its `min`), `fall` (24 dB/s), `hold` (1000 ms), `clipAbove` (0 dBFS). `update(input, now)` with `input` in dBFS (NaN counts as silence) and `now` in ms:

- `level = max(input, previous level − fall·elapsed, floor)`: rises at once, falls at `fall`;
- if `level ≥ peak`, the peak is set to `level` and the hold restarts; otherwise, once `hold` ms have passed since the peak was set, `peak = max(level, peak − fall·elapsed)`;
- `clipped` becomes true when `input > clipAbove` and stays true until `resetClip()`.

### 7.2 Component

`Meter.Root` (`div`) reads `read()` (or the `level` prop, or silence) once per animation frame through one `requestAnimationFrame` loop shared by all meters, which runs while at least one meter is mounted. For each frame it writes directly to the DOM, without React state, and only when a value changed:

- `--meter-level` and `--meter-peak` on the root: travel positions rounded to 0.001 (range `min` … `max`, default −60 … +6, scale `scale`);
- `data-active` on the root while the peak is above `min`;
- `data-clipped` on the root and on every mounted `Meter.Clip` while clipped;
- `data-zone` on the root: the zone of `zones` the level is in (§3);
- at most every 250 ms: `aria-valuenow` (level rounded to 0.1 dB) and `aria-valuetext` (`format`, default `formats.decibel()`) on the track.

| Part | Element | Behaviour |
| --- | --- | --- |
| `Meter.Track` | `div` | `role="meter"`, `aria-valuemin`/`max`, initial `aria-valuenow` = `min`, `aria-labelledby` = the mounted `Label`, `position: relative`. |
| `Meter.Bar` | `div` | `position: absolute; inset: 0`, clipped with `clip-path: inset(…)` to the level from the start edge (bottom, or inline start). |
| `Meter.Peak` | `div` | Its start edge sits at the peak. |
| `Meter.Clip` | `button` | A press calls `resetClip()`; the next frame clears `data-clipped`. It belongs outside `Meter.Track`, because a meter's content is presentational. |
| `Meter.Label` | `span` | Labels the track while mounted. |

### 7.3 Spectrum

`Spectrum.Root` (`div`, `role="img"`, `position: relative`, named by the application) shows levels in dB of `n` FFT bins, bin `k` at `k · sampleRate / (2n)` Hz: with `read`, `read()` once per animation frame on the shared frame loop, while the root intersects the viewport; else `bins`, drawn when they or the props change. It measures its client width `w` and height in CSS pixels (a `ResizeObserver`). The axis across is `createRange({ min, max, scale })` in hertz (defaults 20, 20 000, `scales.log`); column `c` of `w` covers the bins from `denormalize(c / w)` to `denormalize((c + 1) / w)` divided by the bin width, worked out again when `w`, `n`, `sampleRate` or the axis change. A column's level is the highest level of the whole bins it covers; when it covers none, the Catmull–Rom curve through the four bins around its middle, at its middle; non-finite levels count as −200 dB. With `tilt`, `tilt · log₂(f / 1000)` is added, `f` the geometric middle of the column. With a finite `fall` and a previous frame, a column's level is `max(new, previous − fall · elapsed seconds)`; otherwise the new one. The level maps to a height from `floor` (−90, the bottom) to `ceiling` (0, the top), clamped.

The parts are `canvas` elements (`aria-hidden`, `position: absolute; inset: 0; width: 100%; height: 100%`, `transition: color 1ms`, whose `transitionend` makes them read their colour again), sized to the root in device pixels, which clear and draw each new frame in their computed `color`, with points in the middle of each column: `Spectrum.Line` strokes the levels (`thickness` 1.5 CSS pixels), `Spectrum.Fill` fills from the bottom left along the levels to the bottom right, `Spectrum.Peak` strokes, per column, the highest level since it was last reached `hold` ms ago (1000), falling after that at `fall` dB per second (24) down to the level (`thickness` 1). Nothing renders.

## 8. Toggle

A `button` (`type="button"`) with `aria-pressed`, `data-pressed`, `data-disabled` and `aria-disabled` when disabled. State is, in order: the group's value when inside a `ToggleGroup` and given a `value`; else `pressed` (controlled); else internal state starting at `defaultPressed`.

Behaviour by `behavior`:

- `"toggle"`: flips on primary pointerdown (inside a group: see §9.2), not on release. The `click` that follows a pointer press is ignored. A click without a preceding pointerdown (Enter, Space, assistive technology) flips it with reason `"keyboard"`.
- `"momentary"`: on at pointerdown (or Space/Enter keydown, ignoring repeats), off with reason `"release"` at pointer release, cancel or lost capture (or keyup).
- `"hybrid"`: flips at press; at release, if held for at least `holdDelay` ms (250), goes back to its state before the press with reason `"release"`.

Pointerdown with the primary button prevents the default action and focuses the toggle. Disabled toggles ignore all input.

## 9. ToggleGroup

A `div` with `role="group"`, `data-orientation`, `data-disabled`, and `data-painting="on" | "off"` during a paint stroke.

### 9.1 Group value

The group holds the values of pressed toggles that have a `value`: controlled with `value`, else starting at `defaultValue` (or empty). Pressing such a toggle adds its value (appended with `multiple`, else replacing the array) or removes it, and calls `onValueChange(next, details)`. Toggles without a `value` keep their own state; the group only coordinates them.

### 9.2 Pressing and painting

On pointerdown on a `"toggle"` toggle with the primary button, or with the secondary button when `erase="secondary"`:

1. The target state is `false` for the secondary button, else the opposite of the toggle's state.
2. A gesture starts; the toggle is set to the target (reason `"press"`), with exclusivity (§9.3).
3. Without `paint`, the gesture ends.
4. With `paint`, the group captures the pointer and reads, once, the boxes of the paintable toggles (plain `"toggle"` behaviour, not disabled) in the lane of the first toggle (`lane` equal, including both undefined). In a lane, boxes extend without limit across the lane's axis (the lane's axis is vertical for `orientation="vertical"`, else horizontal), so drifting over another lane keeps painting this one.
5. On each pointermove, every box the segment from the previous pointer position to the current one enters is visited in the order the segment reaches it; each toggle is visited once per stroke and set to the target (reason `"paint"`) if it differs. A toggle painted already is not flipped back when the pointer returns.
6. Release, cancel or lost capture ends the stroke and the gesture.

With `erase="secondary"`, `contextmenu` events in the group are cancelled.

### 9.3 Exclusivity

`exclusive` is a mode, `false`, or a map from lane to mode (a toggle without a lane uses the key `""`). When a press turns a toggle on and its lane's mode is `"click"` without Cmd/Ctrl, or `"modifier"` with Cmd/Ctrl, every other pressed, enabled toggle in the same lane is turned off with reason `"exclusive"`, in the same gesture. Painted toggles are not exclusive.

### 9.4 Keyboard

The group is one tab stop: the focusable toggle is the last focused one, else the first enabled toggle in document order; the others have `tabindex=-1`.

Toggles are arranged into lines: one line per lane (in order of first appearance) when any toggle has a lane; else rows of `columns` for `orientation="grid"`; else a single line. The lines' axis is vertical for `orientation="vertical"`, else horizontal.

| Key | Moves focus to |
| --- | --- |
| Arrow along the axis | the next enabled toggle in the line in that direction (Left/Right follow the reading direction, §12) |
| Arrow across the axis | the toggle at the same position (or the last one) in the next line in that direction whose toggle there is enabled |
| Home / End | the first / last enabled toggle of the line; with Ctrl, of the group |

Handled keys prevent their default action. With Shift, an arrow move within the same lane between paintable toggles also sets the target toggle to the state of the one focus came from (reason `"paint"`, one gesture).

## 10. Timeline, Region, Waveform, Notes and Curve

### 10.1 Peaks (`createPeaks`, `createPeaksRecorder`, `peaksFromAudiowaveform`, `readPeaks`)

`Peaks` holds `sampleRate`, `channels`, `length` (samples per channel), `duration` (`length / sampleRate`), `levels`, and optionally `subscribe`. Level 0 has buckets of `samplesPerPeak` samples (default 256, a whole number ≥ 1, else a `RangeError`); level k + 1 merges pairs of buckets of level k (an odd last bucket alone), down to one bucket. Each level holds, per channel, an `Int8Array` of the minimum and maximum of each bucket in turn, as `clamp(round(sample · 127), −127, 127)`. An array may be longer than the buckets in use, `⌈length / samplesPerPeak⌉`.

- `createPeaksRecorder({ sampleRate, channels, samplesPerPeak? })` returns empty peaks (at least one channel, else a `RangeError`) with `append(channels)`: the samples extend every channel by the longest array given; a channel given fewer samples, or none, adds no range where it has none, and a bucket with no sample of a channel is (0, 0). The last bucket holds the samples so far until it is full. After each `append`, every listener of `subscribe(listener)` is called with the second where the first changed bucket starts. Peaks appended in blocks equal the peaks of the whole.
- `createPeaks(channels, sampleRate, options?)` is a recorder given all samples at once, returned without listeners ever called.
- `peaksFromAudiowaveform(json)` reads the JSON of `audiowaveform`: `data` holds the minimum and maximum of each bucket for each channel in turn; 16-bit values are divided by 256 and rounded; `samplesPerPeak` is `samples_per_pixel`, and `length` is the number of buckets times it.
- `readPeaks(peaks, out, { time, secondsPerColumn, channel?, samples? })` fills `out.length / 2` columns with their minimum and maximum in [−1, 1]. With `samples` (one array per channel) and fewer samples per column than `samplesPerPeak` of level 0, a column from sample position `s` to `e = min(s + samples per column, n − 1)` (`n` the shortest array) takes the range of the signal linearly interpolated at `s` and `e` and of the samples between, clamped to [−1, 1]; columns outside `[0, n − 1)` are (0, 0). Otherwise it reads the coarsest level whose `samplesPerPeak` does not exceed the samples per column (level 0 if all do), and for a column starting at sample `s = (time + i · secondsPerColumn) · sampleRate` takes every bucket from `⌊s / spp⌋` to `max(⌊s / spp⌋ + 1, ⌈(s + samples per column) / spp⌉)`, within the buckets in use (bucket values ÷ 127). Columns that start at or after `length`, or cover no bucket, are (0, 0). Without `channel`, all channels are merged.

### 10.2 Grids (`musicalGrid`, `clockGrid`, `gridStep`)

A `TimeGrid` is `{ steps, label(time, step) }`: `steps` are seconds between lines, from fine to coarse, each a whole multiple of the one before; `label` is the text of the line at `time` when lines are `step` apart. `gridStep(grid, scale, spacing)` is the first step with `step · scale ≥ spacing`, or the last.

- `musicalGrid({ bpm, beatsPerBar = 4, divisions = 4, locale? })` (`bpm > 0`, else a `RangeError`), with `beat = 60 / bpm` and `bar = beat · beatsPerBar`: steps `beat / divisions` (when `divisions > 1`), `beat`, then `bar · 2^k` for k = 0 … 10. The label is `formats.position({ beatsPerBar, divisions, locale })` at `time / beat` beats, with the first field alone when `step` is at least a bar, the first two when at least a beat, else all three, joined by `.` (a step within 10⁻⁹ of a unit counts as it).
- `clockGrid({ locale? })`: steps 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60, 300, 600, 1800, 3600, 7200, 14 400, 28 800, 57 600 s. The label has `d` decimals, 0 for a step ≥ 1 s, 1 for ≥ 0.1, 2 for ≥ 0.01, else 3; from `t = round(|time| · 10^d)`, it is `m:ss`, or `h:mm:ss` from an hour on, then the locale's decimal separator and `d` digits when `d > 0`, with the locale's minus sign before it when `time < 0` and `t > 0`. Digits follow the locale.

### 10.3 Timeline

`Timeline.Root` (`div`, `position: relative`) holds a view outside React: `start` and `end` in seconds (`end > start`, else a `RangeError`) and the width of its padding box in CSS pixels, measured before the first paint and then by a `ResizeObserver`. `scale = width / (end − start)` CSS pixels per second (0 before measurement). It writes to its element `--timeline-start`: `start`, and `--timeline-scale`: `scale` followed by `px`, when the view or the width changes.

The playhead is the `position` prop (default 0), or with `read`, `read()` once per animation frame on the shared frame loop. When it changes, it is written, with the number written in, only into the CSS of the parts that follow it (`Timeline.Playhead`, `Waveform.Progress`, `Notes.Progress`), never as a CSS variable: a variable on the root would recalculate the style of everything on the timeline every frame, and one on each part would make every part that defines it costlier to recalculate when the view scrolls.

With `readView`, `readView()` gives `[start, end]` once per animation frame. None of these changes renders a component. The root adds no role and no element for what it holds: its children are the application's, and it knows nothing of them.

Parts place themselves in CSS from these variables, with the physical `left` and `translate`: time runs left to right in every direction (§12).

| Part | Element | Behaviour |
| --- | --- | --- |
| `Timeline.Playhead` | `div` | `aria-hidden`; `position: absolute`, `inset-block: 0` (the root's height), `left: 0`, `translate: calc((position − var(--timeline-start)) · var(--timeline-scale)) 0`, rewritten when the playhead moves. |
| `Timeline.Grid` | `div` | `aria-hidden`, `position: absolute; inset: 0; overflow: hidden`. Draws in tiles (§10.5), placed on the view, with no start or end, a line `max(1, round(devicePixelRatio))` device pixels wide at every multiple of `gridStep(grid, scale of the tile, spacing)` (default spacing 12). A new `grid` with the same `steps`, and the same `spacing`, draws nothing again. |
| `Timeline.Ruler` | `div` | `aria-hidden`, `position: relative; overflow: hidden`, and its `children`. Holds a `span` with `data-label` and the text `grid.label(k · step, step)` for every whole `k` with `k · step` in `[start − w/2, end + w/2]` (`w = end − start`, `step = gridStep(grid, scale, spacing)`, default spacing 64), placed with `position: absolute; left: 0; white-space: nowrap; translate: calc((k · step − var(--timeline-start)) · var(--timeline-scale)) 0`. The labels change only when the view leaves that stretch or the step changes; a new `grid` rewrites texts that differ. |

### 10.4 Region

`Region.Root` (`div`, `role="group"`) must be inside a `Timeline.Root`. It holds a placement outside React: `at`, `duration` (default 0) and `offset` (default 0) from props, and with `read`, `read()` once per animation frame, its fields replacing those given. `position: absolute`, `inset-block: 0` (the height of the box it is in), `left: 0`, `width: calc(duration · var(--timeline-scale))`, `translate: calc((at − var(--timeline-start)) · var(--timeline-scale)) 0`, with the numbers written in (no CSS variables of its own); a new placement rewrites `width` and `translate` without rendering. `aria-labelledby` = its mounted `Region.Label`.

| Part | Element | Behaviour |
| --- | --- | --- |
| `Region.Header` | `div` | `user-select: none`. |
| `Region.Label` | `span` | `user-select: none`. Its id labels the region while mounted. |
| `Region.Content` | `div` | `position: relative`. |

A region has no behaviour of its own: moving and trimming it is the application changing its props.

### 10.5 Tiles

`Timeline.Grid` and the parts of waveforms, notes and curves draw into canvas tiles appended to their element, without React:

- Content has its own seconds: audio time for a waveform, timeline time for a grid. A part gives what can be drawn (the whole file; everything for a grid), what its element shows (the region's `offset … offset + duration`; everything), what is in view, and where content time `t` is from its element's left edge (`t − offset`; `t − var(--timeline-start)`).
- A **layer** is drawn at one scale `s` (the timeline's scale when it starts). Its tile `i` covers content from `i · T` to `(i + 1) · T`, `T = 1024 / s`, within what can be drawn; tiles exist only where they overlap what the element shows. A tile is `round(length · s · devicePixelRatio)` device pixels wide and as tall as the part times `devicePixelRatio`, and is placed in time: `left: 0`, `height: 100%`, `width: calc(length · var(--timeline-scale))`, `translate: calc(place · var(--timeline-scale)) 0`. At another scale it stretches in place; when `place` changes (a trimmed region), tiles are placed again without being drawn.
- A tile is cleared and drawn with `fillStyle` set to the part's computed `color`.
- **In view** are the tiles overlapping the content in view; one tile on each side, within what the element shows, is drawn after them. Tiles more than two tiles away from the view are removed.
- Tiles are drawn by one queue shared by all tiled parts, in animation frames, at most 4 ms per frame (a tile that starts within the budget finishes), taking parts in turn and, in each, the tiles in view before the ones beside them. A part out of the viewport (`IntersectionObserver`) or with no height draws nothing.
- **A new layer** starts over the current one when the scale is outside ½ … 2 times the top layer's, or 150 ms after the last change of scale within that; a change below 10⁻⁶ of the scale is none. The current layer stays until the new one has drawn every tile in view, then is removed. A layer never finished is dropped when another starts, unless nothing else is shown. A change of the part's height, of `devicePixelRatio`, of `prefers-color-scheme` or of the inherited `color` (reported by a hidden element with a 1 ms transition of `color`) also starts a new layer.
- Content that changes from a time on (audio arriving) marks the tiles that end after it as not drawn; they are drawn again in the next frames over what they show.

### 10.6 Waveform

`Waveform.Root` (`div`, `role="img"`, `position: relative; overflow: hidden`, sized by CSS) shows the audio of `peaks`:

- **In a `Region.Root`**, from the region's `offset` for its `duration`, on the timeline's axis, where the region starts `at`. Its own `offset`, `duration`, `position` and `read` do not apply.
- **In a `Timeline.Root` outside a region**, on the timeline's axis from its second 0, which is `offset` (default 0) in the audio, for `duration` (default for ever); the timeline gives the playhead.
- **Otherwise, on its own**, from `offset` (default 0) for `duration` (default `peaks.duration − offset`, at least 0; growing with peaks that have `subscribe`), as its own axis (§10.3) from 0 to that duration across its width, with the playhead at `position − offset` (default 0), or `read() − offset` once per animation frame.

`Waveform.Shape` and `Waveform.Progress` (`div`, `position: absolute; inset: 0`) draw the audio, or the channel `channel`, in tiles (§10.5). A tile draws one column per device pixel from `readPeaks` (with the root's `samples`), as a rectangle from the maximum to the minimum around the middle, at least one device pixel tall. Other `peaks`, `samples` or `channel` remove what is drawn and start a new layer; a new `at`, `duration` or `offset` only places the tiles again and draws the ones that come into view. When the peaks change from second `f` of the audio, the tiles from `f` on are drawn again.

`Waveform.Progress` is clipped to the played part, with the playhead and the region's `at` (0 on its own) written in: `clip-path: inset(0 max(0px, calc(100% − (position − at) · var(--timeline-scale))) 0 0)`, rewritten when either changes.

### 10.7 Notes

`Notes.Root` (`div`, `role="img"`, `position: relative; overflow: hidden`, sized by CSS) shows `notes`, each `{ at, duration, pitch }` in seconds of the clip, on an axis like a waveform's (§10.6): in a `Region.Root`, the region's; in a `Timeline.Root` outside a region, the timeline's from its second 0; otherwise its own, from `offset` (default 0) for `duration` (default the end of the last note − `offset`, at least 0), with its own playhead.

`Notes.Shape` and `Notes.Progress` (`div`, `position: absolute; inset: 0`) draw them in tiles (§10.5), content extending from 0 to the end of the last note. The rows are the whole pitches from `lowest` to `highest`, `range` or else the lowest and highest pitch of the notes; a tile `h` device pixels tall gives each `h / rows`. A note whose pitch is in the range is a rectangle from `round((at − start) · p)` to `round((at + duration − start) · p)` across (`start` the tile's first second, `p` its device pixels per second) and from `round((highest − pitch) · h / rows)` to `round((highest − pitch + 1) · h / rows)` down, at least one device pixel each way. A tile draws the notes that start before its end and end after its start, found by a binary search over the notes sorted by `at` (sorted once per array). Another `notes` array, or another range, removes what is drawn and starts a new layer; a new placement of the region only places the tiles again. `Notes.Progress` is clipped at the playhead as `Waveform.Progress` is.

### 10.8 Curve

A curve is `points` sorted by `at` (a component sorts an unsorted array once, stably), each `{ at, value, shape }`. `shape` (default `"linear"`) is how it goes to the next point.

`curveValue(points, time, range?)`: with no points, `NaN`; before the first point, its value; at or after the last, its value. Otherwise, between the last point `a` at or before `time` and the next `b` (the later of points at the same time counts, so they make a jump), with `n` = `range.normalize` (identity without a range), `f = (time − a.at) / (b.at − a.at)` and `e = curveEase(a.shape, f)`: `n(a.value) + (n(b.value) − n(a.value)) · e`, through `range.denormalize` with a range. `curveEase` is `f` for `"linear"` or 0, 0 before the end for `"hold"`, and `f ** 2 ** (3 · t)` for a tension `t` clamped to −1 … 1.

`Curve.Root` (`div`, `role="img"`, `position: relative; overflow: hidden`) shows `points` on the range `createRange({ min, max, scale })` (defaults 0, 1, linear), on an axis like a waveform's (§10.6), content lasting on its own up to the last point. `Curve.Line` and `Curve.Fill` (`div`, `position: absolute; inset: 0`) draw in tiles (§10.5), content extending for ever. In a tile `h` device pixels tall, a travel position `p` is at `(1 − clamp(p, 0, 1)) · h` from the top. Each traces, from `m` device pixels before the tile to `m` after (the line's width plus 2 for the line, 2 for the fill), the value there, then each point in between: a line to where the segment ends (for a held segment, the point's value before it), a line to the point's own value when it differs, and for a tension, a point every 2 device pixels between. `Curve.Line` strokes it `thickness` CSS pixels (default 1) times `devicePixelRatio` wide, with round joins; `Curve.Fill` closes it along the travel position of `origin` (default `min`) and fills it. Another `points` array, range, `thickness` or `origin` removes what is drawn and starts a new layer.

### 10.9 Curve editing

`useCurveEditing(options)` returns the same `CurveEditing` object on every render, holding `options`. Given to `Curve.Root` as `editing`, it is attached to what the root shows (its points sorted, its range and axis, its element) on every render; the root is then `role="group"` with `data-editable`.

- **Points shown.** During a gesture, the points it makes; otherwise the root's. Drawing parts draw a gesture's points as they change, without rendering, over the stretch that changed: from the point before the first point that is not the same object, to the point after the last (`-∞` and `∞` at the ends), drawn again over itself (§10.5). A gesture ends, and the points return to the root's.
- **Selection.** A set of indexes. `select(indexes)`, `selectAll()`, `selected`; `onSelectedChange(indexes)` when a press or a key changes it. A press on a point's handle selects it alone unless it is selected; with Cmd or Ctrl, it toggles it. A press that selected a point already selected, and did not become a drag, selects it alone on release. A primary press on the root away from the handles, without a modifier, clears it. When the root's points change count outside a gesture, other than by an add or a remove of the engine's, the selection is cleared.
- **Locks.** `lock` gives an index `"time"`, `"value"` or `"both"`. A point locked in both has no handle and is never moved or removed.
- **Handles.** `Curve.Handle` renders one element per point that needs one: the tab stop (the current point, or the first not locked in both), the selected points, the point within 8 CSS px of the pointer (the nearest among the two points on each side of the pointer's time), and the held one. Each is `position: absolute; left: 0; top: (1 − p) · 100%` (rounded to 1/1000 %), `translate: calc(place · var(--timeline-scale) − 50%) −50%` where `place` is where its time is from the root's left (as a tile's, §10.5), `touch-action: none`, `data-curve-handle`; `role="slider"`, `aria-orientation="vertical"`, `aria-valuemin`/`aria-valuemax` the range's finite bounds, `aria-valuenow` its finite value, `aria-valuetext` = `format.time(at) + ", " + format.value(value)` (defaults `formats.number({ digits: 2, unit: "s" })` and `formats.number({ digits: 2 })`), `tabindex` 0 for the tab stop and −1 else, `data-selected`, `data-dragging`, all rewritten without rendering as the point moves. `Curve.Bend` renders one element, `aria-hidden`, `data-curve-bend`, at the middle in time of the segment within 8 px of the pointer (if no point is), or the held one, on the curve there, for segments not held, of positive length, whose ends differ in travel position.
- **Drags.** A primary press on a handle focuses it and follows the pointer, captured; it becomes a drag after 3 px. For a point, from the snapshot at the press, the held point moves by `(Δx / scale)` seconds and `−(Δy / height)` of travel; unless Shift is held, its time snaps to multiples of `gridStep(snap.time, scale, 12)` and its value to multiples of `snap.value`. The move is clamped for the group (the selection and the held point, less points locked in both): no point unlocked in time passes the nearest point on each side that does not move in time, no value unlocked leaves 0 … 1 of travel. Points move on their unlocked axes; a value is `range.denormalize(travel + Δ)`. For a bend, the segment's first point takes the tension `t` for which `0.5 ** 2 ** (3t)` puts the middle at the pointer's travel (the fraction clamped to 0.01 … 0.99, `t` to −1 … 1, and 0 when under 0.03 in size, as `"linear"`).
- **Changes.** Every step passes through `constrain` (if given); when the result differs from the points shown, `onGestureStart()` before the first, then the points are shown and `onPointsChange(points, { reason, event })` is called. When a gesture that changed something ends, `onGestureEnd(points)`.
- **Adds and removes.** A double-click on the root away from the handles, with `canAdd` not `false`, inserts `{ at, value }` at the pointer (snapped as a drag is) after the points at or before it, as one gesture with reason `"add"`, then selects and focuses it. A double-click on a handle, or Delete or Backspace on it, removes the selection (or the point alone if it is not selected), less points locked in both, with `canRemove` not `false`: reason `"remove"`. A double-click on a bend handle makes its segment `"linear"`: reason `"bend"`.
- **Keys** on a handle, each one gesture with reason `"keyboard"` (`"bend"` for Alt), applying to the selection if the point is in it, else to the point: Left and Right focus the previous or next point not locked in both; with Cmd or Ctrl they move it by a snap step (without `snap.time`, 10 px; with Shift, 1 px). Up and Down move the value by `snap.value` (snapped), else by 0.01 of travel (with Shift, 0.001); with Alt they add ∓0.1 (Shift: 0.02) to the tension of the segment after the point, the sign that moves its middle up for Up. Space selects the point alone (with Cmd or Ctrl, toggles it).

## 11. Keys

`Keys.Root` (`div`, `role="group"`, `data-orientation`, `data-layout`, `data-disabled`, `position: relative`, `touch-action: none`) has a key for each note from `range[0]` to `range[1]`, MIDI note numbers; the application renders a `Keys.Key note={n}` for each. A note is black when `n mod 12` is 1, 3, 6, 8 or 10, and white otherwise.

- **Placement.** Along the keyboard, a key spans, in units of the layout:
  - `layout="piano"` (default), in white keys: with `o = 7·⌊n / 12⌋` and `c = n mod 12`, a white key `[o + w, o + w + 1]`, `w` its index among the white keys of the octave (C is 0, B is 6); a black key `[o + 7c / 12, o + 7(c + 1) / 12]`. The keyboard spans from the start of the key of `range[0]` to the end of the key of `range[1]`.
  - `layout="rows"`, in semitones: a black key `[n, n + 1]`; a white key `[n − ½, n + 1 + ½]`, without the half on a side where the next note is white. The keyboard spans `[range[0], range[1] + 1]`, and keys are clipped to it: key `n`'s row is the row `Notes` draws pitch `n` in over the same range (§10.7).

  A key's start and size, as fractions of the keyboard's length in percent (rounded to 1/1000 %), are its `left` and `width` when `orientation="horizontal"` (default), left to right in every direction, or its `bottom` and `height` when `"vertical"`. Across the keyboard it has `inset-block: 0` or `inset-inline: 0`. Keys are `position: absolute`; black keys have `z-index: 1`.
- **Keys.** `Keys.Key` is a `button` (`type="button"`) with `aria-label` = `format.format(note)` (default `formats.number({ digits: 0 })`), `data-black` or `data-white`, `data-orientation`, `user-select: none`, and `aria-disabled` and `data-disabled` when it or the root is `disabled`.
- **Down.** A key is down while something holds it: a pointer, or the keyboard. When it gets its first holder, `data-pressed` is set and `onPress(note, { reason, event, velocity })` is called; when it loses its last, `data-pressed` is removed and `onRelease(note, { reason, event })` is called; `reason` is `"pointer"` or `"keyboard"`. `held`, when `read` is not given, and `read()` once per animation frame, are the notes held elsewhere: their keys have `data-held`. Keys are written without rendering.
- **Pointer.** A primary press on a key of an enabled root prevents the default action, focuses the key, captures the pointer and reads the box of every key once. The pressed key, and then on each move the key under the pointer (the first black key whose box contains it, else the first white one), is held by the pointer if it is enabled: moving onto another key lets go of the previous one and holds the new one; off the keys, the pointer holds none. Release, cancel or lost capture lets go. A key's velocity is `velocity` when it is a number; with `"position"` (default), the travel from the key's back to its front within its box, clamped to 0 … 1: `(y − top) / height` horizontally, `(x − left) / width` vertically, `(right − x) / width` right to left.
- **Keyboard.** The keyboard is one tab stop: `tabindex` 0 on the focusable key, at first `clamp(60, range[0], range[1])`, then the last focused one; −1 on the others, and on every key while the root is disabled. On a key of an enabled root, Space and Enter (not repeated) hold the key, if enabled, with velocity `velocity`, or 0.8 with `"position"`, until their keyup, or until focus leaves the keyboard. ArrowRight and ArrowUp focus the next enabled key above, ArrowLeft and ArrowDown the next below; PageUp the first enabled key at or above `note + 12`, else the highest; PageDown the first at or below `note − 12`, else the lowest; Home and End the lowest and highest. While the keyboard holds a key, moving focus lets go of it and holds the key focused. Handled keys prevent their default action.

## 12. Direction

The direction is read from the DOM (`getComputedStyle(element).direction`): at pointerdown for drags, at keydown for keys, and once at mount for styles that have no logical form.

- Horizontal value controls: dragging towards the inline end increases the value; in RTL, ArrowLeft increases and ArrowRight decreases. Positions use `inset-inline-start`; the thumb and ticks are centred with `translate` of −50% (LTR) or +50% (RTL).
- Horizontal meters clip the bar from the inline end.
- Toggle groups and multi-sliders: Left and Right move along the reading direction; a multi-slider's items lie along it.
- Horizontal sliders run along the reading direction, their thumbs, range and bands with them, as horizontal faders do.
- Vertical controls, knobs, Up and Down do not depend on direction.
- Time on a timeline and the fields of number box segments run left to right in every direction (§10, §5.8).
- Keys run from low to high left to right, or bottom to top, in every direction, and their arrow keys do not change; the back of the keys of a vertical keyboard is at the inline start (§11).

## 13. Performance budgets

Checked on every change; a regression fails CI.

| Budget | Where |
| --- | --- |
| Dragging a knob renders nothing, not even the knob; `read` and `Knob.Modulation` render nothing per frame. | `test/knob.test.tsx`, `test/live.test.tsx` |
| Dragging the depth of a knob's modulation, or the knob, moves its range and renders nothing. | `test/knob-modulation.test.tsx` |
| Painting three steps of a 64-step group-owned grid renders exactly those three toggles. | `test/toggle.test.tsx` |
| Running meters render nothing in React (16 meters, 120 frames); all meters share one frame loop. | `test/meter.test.tsx` |
| Dragging a thumb of an XY pad renders nothing. | `test/xy-pad.test.tsx` |
| A stroke across a multi-slider renders nothing. | `test/multi-slider.test.tsx` |
| A spectrum that reads its bins every frame renders nothing. | `test/spectrum.test.tsx` |
| Dragging a thumb of a slider renders nothing. | `test/slider.test.tsx` |
| Pressing keys, gliding across them and reading keys held elsewhere renders nothing. | `test/keys.test.tsx` |
| In a production build with 64 strips: 0 React commits while meters run, during a fader drag, and while 128 knobs and faders follow automation through `read`; for a paint stroke, at most one commit per pointer event plus three. | `perf/stress.perf.ts` |
| Playback, scrolling, and a new placement of a region draw no tile that is drawn already; a zoom draws only after it rests or past twice or half the scale; drawing takes at most 4 ms per frame. | `test/timeline.test.tsx` |
| In a production build with 32 waveforms on a timeline under a ruler and two grids: 0 React commits during playback, scrolling, recording and zooming, while the view pages along with a MIDI track of 3760 notes more, while it zooms with an automation lane of 2000 bent points more, and at most 2 for a drag of one of those points when editable (the press, and the application keeping the points); 0 tiles drawn during playback, at most 128 while the view pages along for 3 s, and while recording a 33rd take, at most one tile per frame (plus two). | `perf/stress.perf.ts` |
| In a production build, 8 spectra of 2048 bins read every frame make 0 React commits. | `perf/stress.perf.ts` |
| In a production build, a stroke across 64 values of a multi-slider sets every one and makes 0 React commits. | `perf/stress.perf.ts` |
| With 88 keys in a production build: 0 React commits while `read` holds keys that change every 50 ms, and during a glissando across the keyboard. | `perf/stress.perf.ts` |
| Minified and gzipped: core ≤ 7.3 kB, React binding (with core) ≤ 44 kB; an application importing only a knob ≤ 8.6 kB, only an XY pad ≤ 6.2 kB, only a keyboard ≤ 5.3 kB, only a multi-slider ≤ 6.5 kB, only a slider ≤ 6.9 kB, only a spectrum ≤ 4.6 kB, a timeline with regions and waveforms ≤ 8.6 kB, an editable curve ≤ 13.5 kB. | `scripts/size.mjs` |

Frame times, main-thread time per frame and input latency under 4× CPU slowdown are measured in `perf/stress.perf.ts` and reported, not enforced.
