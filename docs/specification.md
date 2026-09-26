# daw-ui — specification

Status: describes version 1. This is the normative description of behaviour; the tests in [`test/`](../test) (jsdom) and [`e2e/`](../e2e) (Playwright) are its executable form, and [`perf/`](../perf) measures it. When code and this document disagree, one of them is a bug. The rules every component follows are in [principles.md](./principles.md).

- [1. Scope](#1-scope)
- [2. Parts](#2-parts)
- [3. Value model](#3-value-model)
- [4. Formats](#4-formats)
- [5. Value controls](#5-value-controls-knob-fader-numberbox)
- [6. Gestures](#6-gestures)
- [7. Meter](#7-meter)
- [8. Toggle](#8-toggle)
- [9. ToggleGroup](#9-togglegroup)
- [10. Direction](#10-direction)
- [11. Performance budgets](#11-performance-budgets)

## 1. Scope

| Layer | Entry point | Depends on | Responsibility |
| --- | --- | --- | --- |
| Core | `@addstack/daw-ui` | nothing | Ranges and scales, formats, geometry, meter ballistics. |
| React binding | `@addstack/daw-ui/react` | `react`, `react-dom` (peers, ≥ 19) | Headless components. |

Non-goals: styling, audio processing, and application state such as undo history or automation. The components report what the user did; the application decides what it means.

## 2. Parts

A component is a namespace of parts (`Knob.Root`, `Knob.Control`, …). A part must be rendered inside its component's `Root`, or it throws.

Each part:

- renders one element (listed per part below) and passes through the props of that element;
- accepts `className` and `style` as values or as functions of the part's state; a function's result is used as if it had been passed directly;
- accepts `render`: an element, which is cloned with the part's props merged into its own, or a function `(props, state) => element`;
- merges props in this way: the user's event handler runs first, and if it calls `event.preventDefault()`, the part's own handler is skipped; class names are joined; the user's style is spread over the part's inline style; refs all receive the element.

Inline styles set by parts are limited to positioning (`position`, logical insets, `translate`, `clip-path`) and `touch-action: none` on drag targets.

## 3. Value model

`createRange({ min, max, step?, scale? })`:

- requires `max > min` and `step > 0`, and throws a `RangeError` otherwise;
- `clamp(v)` limits to `[min, max]`;
- `constrain(v)` clamps, then snaps to `min + k·step` when `step` is set (rounded to the decimals of `step` and `min`, then clamped again), and otherwise rounds to 12 significant digits;
- `normalize(v)` returns the travel position in `[0, 1]` through the scale;
- `denormalize(t)` clamps `t` to `[0, 1]`, maps it through the scale, and constrains the result.

Scales map a value in `[min, max]` to travel and back:

| Scale | Travel of `v` |
| --- | --- |
| `linear` | `(v − min) / (max − min)` |
| `log` | `ln(v / min) / ln(max / min)`; requires `min > 0` |
| `power(e)` | `linear(v)^(1/e)` |
| `decibel` | `(a(v)^¼ − a(min)^¼) / (a(max)^¼ − a(min)^¼)` with `a(dB) = 10^(dB/20)`; `min = −∞` is allowed and maps to travel 0 |

## 4. Formats

A format is `{ format(value): string; parse(text): number | null }`. `parse` returns `null` for text it does not understand. Parsed values are constrained by the range afterwards.

Built-in formats:

- print numbers with `Intl.NumberFormat` in the given `locale` (default: the runtime's), with a fixed number of decimals and no grouping; a value that rounds to zero prints without a sign;
- parse either decimal separator (`.` or `,`) and the Unicode minus sign (U+2212);
- add only unit symbols that are the same in every language (Hz, kHz, dB, ms, s, %) and signs (−∞);
- take every word or letter from the application. `pan` requires `left`, `right` and `center`.

| Format | Output | Accepted input |
| --- | --- | --- |
| `number({ digits = 2, unit? })` | `1.50`, `120.00 BPM` | a number, optionally followed by `unit` (case-insensitive) |
| `decibel({ digits = 1 })` | `-6.0 dB`; `-∞ dB` for `−Infinity` | a number, optionally `dB`; `-inf…` or `-∞` |
| `frequency()` | below 1000: `Hz` with 1 decimal under 100, else 0; from 1000: `kHz` with 2 decimals under 10 000, else 1 | a number, optionally `Hz`; a number followed by `k` or `kHz` |
| `percent({ digits = 0 })` | the fraction as a percentage in the locale's style | a number, optionally `%`; divided by 100 |
| `pan({ left, right, center })` | `center` when `round(|v|·100) = 0`, else the amount followed by `left` or `right` | `center`; a number (÷100); a number followed by `left` (negative) or `right` |
| `time()` | milliseconds: 2 decimals under 10, 1 under 100, else 0, then `ms`; from 1000: seconds with 2 decimals and `s` | a number, optionally `ms`; a number followed by `s` (×1000) |

## 5. Value controls (Knob, Fader, NumberBox)

### 5.1 State

Each root holds a value: controlled when `value` is given, otherwise starting at `constrain(defaultValue ?? origin)`. `origin` defaults to `min` and is clamped. The displayed value is `clamp(value)`.

State exposed to parts: `value`, `normalized`, `originNormalized`, `text` (formatted value), `dragging`, `disabled`, `bipolar` (`0 < originNormalized < 1`).

A change is **applied** as follows: the candidate is constrained; if it equals the last value this control produced or rendered (`Object.is`), nothing happens; otherwise a gesture starts if none is open (§6), the uncontrolled value is set, and `onValueChange(value, { reason, event })` is called. A controlled control shows the new value only when the parent passes it back.

### 5.2 Drag

On primary-button pointerdown on the control (not disabled): the default action is prevented, the control takes focus, captures the pointer, and optionally requests pointer lock (`pointerLock`). The drag keeps a travel position `p`, starting at `normalize(value)`.

On each pointermove, `Δ` is the pointer movement since the previous event (`movementX/Y` while locked, else client coordinates): up for vertical controls, towards the inline end for horizontal ones (§10). Then `p = clamp01(p + Δ / sensitivity × (Shift ? 0.1 : 1))`, and `denormalize(p)` is applied with reason `"drag"`. Because `p` is clamped, moving back after overshooting an end responds at once. `dragging` is true from the first move until the pointer is released, cancelled or loses capture; then the gesture ends.

`sensitivity` (pixels for the full travel) defaults to 200 for a knob, to the track's length along the orientation for a fader (the control's length if there is no track, 200 if that is 0), and for a number box to `clamp(2·(max − min) / step, 100, 1000)` (400 without a step or with an infinite range).

### 5.3 Keyboard

On the focused control (not disabled):

| Key | Continuous range | With `step` |
| --- | --- | --- |
| ArrowUp; ArrowRight (§10) | travel + 0.01 (Shift: + 0.001) | value + step |
| ArrowDown; ArrowLeft (§10) | travel − 0.01 (Shift: − 0.001) | value − step |
| PageUp / PageDown | travel ± 0.1 | travel ± 0.1 if that is more than one step, else ± step |
| Home / End | `min` / `max` | same |
| Delete, Backspace | reset | same |

Each handled key prevents its default action and is one gesture.

### 5.4 Wheel

A non-passive wheel listener (unless `wheel={false}`) converts the event to pixels (`deltaMode` lines × 33, pages × 800) towards a higher value: `−deltaY`, or when `deltaY` is 0, `−deltaX` with Shift (a vertical wheel turned horizontal) and `deltaX` without. Travel moves by `pixels × 0.0005` (Shift: ×0.1), so a 100 px notch is 5%. The default action is prevented when the event is handled, so the page does not scroll. A burst of wheel events is one gesture, which ends 400 ms after the last event.

### 5.5 Reset

Double-click (knob, fader) and Delete/Backspace apply `resetValue ?? defaultValue ?? origin` with reason `"reset"` as one gesture.

### 5.6 Parts

| Part | Element | Behaviour |
| --- | --- | --- |
| `*.Root` | `div` | Holds the value. Knob: `--knob-value`, `--knob-angle` (`−sweep/2 + normalized·sweep`, in deg). Fader: `--fader-value`, `data-orientation`. Data: `dragging`, `disabled`, `bipolar`. |
| `Knob.Control`, `Fader.Control` | `div` | `role="slider"`, `tabindex` 0 (−1 disabled), `aria-valuemin` (omitted when infinite), `aria-valuemax`, `aria-valuenow` (omitted when infinite), `aria-valuetext` = formatted value, `aria-orientation`, `aria-disabled`, `aria-labelledby` = the mounted `Label`. Handles §5.2–5.5. |
| `*.Label` | `span` | Its id labels the control while mounted. A click focuses the control. |
| `*.Value` | `output` | The formatted value (or `children(text, value)`), `for` the control, `aria-live="off"`, `dir="auto"`. |
| `Knob.Track` | `path` | Arc over the full sweep, radius `radius` (40) around (50, 50), `fill="none"`. |
| `Knob.Range` | `path` | Arc from the origin's angle to the value's angle. An empty arc is a bare move command. |
| `Knob.Pointer` | `line` | From radius `from` (0) to `to` (40) at the value's angle. |
| `Fader.Track` | `div` | `position: relative`; its length is the default sensitivity. |
| `Fader.Range` | `div` | Absolutely positioned from the lower of origin and value, with length equal to their distance. |
| `Fader.Thumb`, `Fader.Tick` | `div` | Centred on the value (thumb) or on `normalize(value)` (tick). Ticks are `aria-hidden`. |
| `NumberBox.Field` | `span`, or `input` while editing | Display: `role="spinbutton"` with the value attributes, `dir="auto"`. See §5.7. |

Angles are in degrees, clockwise from 12 o'clock. `sweep` defaults to 270.

### 5.7 Number box editing

Editing starts on double-click, on Enter, or on a typed character matching `[0-9.,+−-]` without Ctrl, Meta or Alt (the draft is then that character). The draft starts as the formatted value, selected. While editing, the field is a text input with `inputmode="decimal"`, labelled by the `Label`, with `data-editing` on the root and the field. Enter applies `format.parse(draft)` with reason `"input"` as one gesture if it is not `null`, then gives focus back to the display. Escape discards the draft and gives focus back. Blur applies like Enter, without moving focus. Only the first of Enter or blur applies.

## 6. Gestures

A gesture groups the changes of one user action. `onGestureStart()` is called immediately before the first applied change of the action; `onGestureEnd(value)` (value controls) or `onGestureEnd()` (toggle groups) is called when the action ends, only if a gesture started. An action that changes nothing produces no callbacks.

| Component | One action |
| --- | --- |
| Value controls | a drag (pointerdown → release); a key press; a burst of wheel events; a reset; a typed value |
| ToggleGroup | a press, including the toggles an exclusive press turns off; a paint stroke; a Shift+Arrow paint step; a keyboard press |

A controlled `ToggleGroup` whose parent did not take a change shows its `value` prop again when the gesture ends.

## 7. Meter

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
- at most every 250 ms: `aria-valuenow` (level rounded to 0.1 dB) and `aria-valuetext` (`format`, default `formats.decibel()`) on the track.

| Part | Element | Behaviour |
| --- | --- | --- |
| `Meter.Track` | `div` | `role="meter"`, `aria-valuemin`/`max`, initial `aria-valuenow` = `min`, `aria-labelledby` = the mounted `Label`, `position: relative`. |
| `Meter.Bar` | `div` | `position: absolute; inset: 0`, clipped with `clip-path: inset(…)` to the level from the start edge (bottom, or inline start). |
| `Meter.Peak` | `div` | Its start edge sits at the peak. |
| `Meter.Clip` | `button` | A press calls `resetClip()`; the next frame clears `data-clipped`. It belongs outside `Meter.Track`, because a meter's content is presentational. |
| `Meter.Label` | `span` | Labels the track while mounted. |

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
| Arrow along the axis | the next enabled toggle in the line in that direction (Left/Right follow the reading direction, §10) |
| Arrow across the axis | the toggle at the same position (or the last one) in the next line in that direction whose toggle there is enabled |
| Home / End | the first / last enabled toggle of the line; with Ctrl, of the group |

Handled keys prevent their default action. With Shift, an arrow move within the same lane between paintable toggles also sets the target toggle to the state of the one focus came from (reason `"paint"`, one gesture).

## 10. Direction

The direction is read from the DOM (`getComputedStyle(element).direction`): at pointerdown for drags, at keydown for keys, and once at mount for styles that have no logical form.

- Horizontal value controls: dragging towards the inline end increases the value; in RTL, ArrowLeft increases and ArrowRight decreases. Positions use `inset-inline-start`; the thumb and ticks are centred with `translate` of −50% (LTR) or +50% (RTL).
- Horizontal meters clip the bar from the inline end.
- Toggle groups: Left and Right move along the reading direction.
- Vertical controls, knobs, Up and Down do not depend on direction.

## 11. Performance budgets

Checked on every change; a regression fails CI.

| Budget | Where |
| --- | --- |
| Dragging one knob renders no other knob. | `test/knob.test.tsx` |
| Painting three steps of a 64-step group-owned grid renders exactly those three toggles. | `test/toggle.test.tsx` |
| Running meters render nothing in React (16 meters, 120 frames); all meters share one frame loop. | `test/meter.test.tsx` |
| In a production build with 64 strips: 0 React commits while meters run; for a fader drag, at most one commit per pointer event plus two; for a paint stroke, plus three. | `perf/stress.perf.ts` |
| Minified and gzipped: core ≤ 2.7 kB, React binding (with core) ≤ 12.5 kB. | `scripts/size.mjs` |

Frame times and input latency under 4× CPU slowdown are measured in `perf/stress.perf.ts` and reported, not enforced.
