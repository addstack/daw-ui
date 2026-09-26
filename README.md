<h1 align="center">daw-ui</h1>

<p align="center">
  <b>Headless React components for audio apps.</b><br>
  Knobs, faders, number boxes, level meters and toggle groups you paint by dragging, the way Ableton Live and FL Studio work. Unstyled, accessible, in any language, and measured for speed.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@addstack/daw-ui"><img src="https://img.shields.io/npm/v/@addstack/daw-ui" alt="npm"></a>
  <a href="https://github.com/addstack/daw-ui/actions/workflows/ci.yml"><img src="https://github.com/addstack/daw-ui/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/addstack/daw-ui/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@addstack/daw-ui" alt="MIT license"></a>
</p>

<p align="center">
  <a href="https://addstack.github.io/daw-ui/docs/">Documentation</a> ·
  <a href="https://addstack.github.io/daw-ui/playground/">Playground</a> ·
  <a href="#-quick-start">Quick start</a> ·
  <a href="#-components">Components</a> ·
  <a href="#-performance">Performance</a> ·
  <a href="https://github.com/addstack/daw-ui/blob/main/docs/principles.md">Principles</a> ·
  <a href="https://github.com/addstack/daw-ui/blob/main/docs/specification.md">Specification</a>
</p>

---

📖 <a href="https://addstack.github.io/daw-ui/docs/"><b>Documentation</b></a>: every component with live demos and its props.<br>
🎛️ <a href="https://addstack.github.io/daw-ui/playground/"><b>Playground</b></a>: a drum machine and mixer built from these components, with real Web Audio meters, in English or Polish, left to right or right to left.

General UI libraries stop where music software starts. A volume fader is not a range input: it has a dB law, goes down to −∞, resets on double-click and moves in fine steps with Shift. A row of mute buttons is not a list of checkboxes: you drag across it to mute eight tracks at once. And 64 meters running at 60 frames per second cannot go through React state. `daw-ui` does this part:

- 🎚️ **DAW input.** Relative vertical drag, Shift for fine steps, double-click and Delete to reset, the mouse wheel, optional pointer lock, and a typed value with units ("1k", "-6 dB", "50L").
- 🖌️ **Painting.** Drag across toggles to set them all, as on a step sequencer. Fast drags do not skip steps. Lanes keep a stroke on the mute row of a mixer, and exclusive solo stays on the solo row.
- ↩️ **Gestures.** Every user action is wrapped in `onGestureStart` / `onGestureEnd`, so it becomes one undo step or one automation pass.
- ⚡ **Measured performance.** Meters never render through React. Budgets on React commits and bundle size fail CI. Frame times are reported on every change.
- ♿ **Accessible.** Correct roles, `aria-valuetext` as users read it ("-6.0 dB"), and a keyboard path for everything, including painting.
- 🌍 **No built-in language.** Numbers follow the user's locale, words come from your app, and right-to-left layouts work.
- 🧩 **Headless, like Base UI.** Parts, `data-*` attributes, CSS variables and a `render` prop. Style it yourself, or publish a shadcn registry on top.

## 🚀 Quick start

```bash
npm install @addstack/daw-ui
```

Requires React 19.

```tsx
import { formats, scales } from "@addstack/daw-ui";
import { Knob } from "@addstack/daw-ui/react";

export function Cutoff({ filter }: { filter: BiquadFilterNode }) {
  return (
    <Knob.Root
      min={20}
      max={20_000}
      defaultValue={20_000}
      scale={scales.log}
      format={formats.frequency()}
      onValueChange={(hz) => filter.frequency.setTargetAtTime(hz, filter.context.currentTime, 0.01)}
      className="knob"
    >
      <Knob.Label>Cutoff</Knob.Label>
      <Knob.Control className="knob-control">
        <svg viewBox="0 0 100 100">
          <Knob.Track className="knob-track" />
          <Knob.Range className="knob-range" />
          <Knob.Pointer className="knob-pointer" from={10} to={28} />
        </svg>
      </Knob.Control>
      <Knob.Value />
    </Knob.Root>
  );
}
```

The parts carry no styles. Style them with classes, the `data-*` attributes they set, and CSS variables:

```css
.knob-control { width: 48px; height: 48px; }
.knob-track, .knob-range { fill: none; stroke-width: 9; stroke-linecap: round; }
.knob-track { stroke: #2a2a30; }
.knob-range { stroke: #ff9f0a; }
.knob[data-dragging] .knob-range { stroke: #ffb340; }
```

## 🧩 Components

Every part takes `className` and `style` (plain values: state reaches CSS through `data-*` attributes and CSS variables), `render` to replace its element, and the props of the element it renders. The types are exported per part, e.g. `Knob.Root.Props` and `Knob.Root.State`.

### Knob, Fader, NumberBox

Three views of one value model. They share these props:

| Prop | |
| --- | --- |
| `value`, `defaultValue`, `onValueChange(value, { reason, event, delta })` | Controlled or uncontrolled. `reason` is `"drag"`, `"keyboard"`, `"wheel"`, `"reset"` or `"input"`; `delta` is the change, for relative uses such as preset browsing. |
| `read` | For values that change on their own (automation, modulation, a control surface): called once per animation frame, shown without rendering. While the user drags, the user's value wins. |
| `onGestureStart()`, `onGestureEnd(value)` | Around each user action: a drag, a key press, a burst of wheel events, a reset, a typed value. |
| `min`, `max`, `step` | Defaults to 0…1, continuous. |
| `wrap`, `endless` | What happens past the ends. `wrap` comes around, as a phase does (`max` is `min`). `endless` keeps counting, like a hardware encoder: `min`…`max` is one turn of a knob (not for faders). |
| `scale` | How travel maps to value: `scales.linear`, `scales.log` (Hz, ms), `scales.power(n)`, `scales.decibel` (a console fader law: 0 dB at about 80%). |
| `format` | Text for the readout and `aria-valuetext`, and parsing of typed values. See [formats](#-values-and-formats). |
| `origin` | Where the range is drawn from: `origin={0}` on a −1…1 pan knob fills from the center (`data-bipolar`). |
| `zones` | Named thresholds, e.g. `{ hot: 0 }` on a dB fader: every part gets `data-zone="hot"` above 0 dB. See [zones](#-zones). |
| `resetValue` | Where double-click and Delete go. Defaults to `defaultValue`, then `origin`. |
| `sensitivity` | Pixels of drag for the full travel. Knob: 200. Fader: the track length, so the thumb follows the pointer. |
| `wheel`, `pointerLock`, `disabled` | The wheel is on by default. Pointer lock hides the cursor during a drag, as desktop DAWs do. |

| Input | Effect |
| --- | --- |
| Drag up / right | Increases. Shift: 10 times finer. |
| Arrow keys | 1% of the travel (Shift: 0.1%), or one `step`. |
| Page Up / Page Down | 10% of the travel. |
| Home / End | Minimum / maximum. |
| Double-click, Delete, Backspace | Reset. |
| Wheel | 5% per notch (Shift: finer). |

**Knob** parts: `Root` (sets `--knob-value` and `--knob-angle`), `Control` (`role="slider"`), `Label`, `Value`, and the SVG parts `Track`, `Range`, `Pointer` and `Modulation` (the arc to where an LFO moves the value now, read once per frame), which draw into a `viewBox="0 0 100 100"`. `sweep` sets the rotation (270° by default, a full circle when the knob wraps or is endless). An endless knob is a `spinbutton`, since it has no minimum or maximum.

When a value changes, the parts write what they show straight to the DOM: dragging a knob, or 128 controls following automation through `read`, renders nothing in React.

**Fader** parts: `Root` (sets `--fader-value`, `orientation` is vertical by default), `Control`, `Label`, `Track`, `Range`, `Thumb`, `Tick` and `Value`.

```tsx
<Fader.Root min={-Infinity} max={6} defaultValue={0} scale={scales.decibel} format={formats.decibel()}>
  <Fader.Label>Volume</Fader.Label>
  <Fader.Control>
    <Fader.Track className="track">
      <Fader.Range className="range" />
      {[6, 0, -6, -12, -24, -48].map((db) => (
        <Fader.Tick key={db} value={db}>{db}</Fader.Tick>
      ))}
      <Fader.Thumb className="thumb" />
    </Fader.Track>
  </Fader.Control>
  <Fader.Value />
</Fader.Root>
```

**NumberBox** is the tempo field of a DAW: `Root`, `Label` and `Field` (`role="spinbutton"`). Drag it up and down. Double-click it, press Enter or type a digit to edit it as text, then Enter or leave the field to apply, or Escape to cancel.

With `Segments` instead of `Field`, it shows the value as fields that change one at a time, from the format: the bars, beats and sixteenths of a song position, the frames of a timecode, the decimals of a tempo. Each field is a `spinbutton` named by the labels you pass; dragging it or pressing up and down steps it and carries into the next field, and left and right move between fields.

```tsx
<NumberBox.Root min={0} max={999 * 4} format={formats.position()}>
  <NumberBox.Label>Position</NumberBox.Label>
  <NumberBox.Segments labels={{ bars: "Bar", beats: "Beat", divisions: "Sixteenth" }} />
</NumberBox.Root>
```

### Meter

A peak meter with hold and a clip indicator. `read` is called once per animation frame: return the level in dBFS from an `AnalyserNode` or from your audio code. One shared `requestAnimationFrame` loop drives every meter and writes to the DOM directly, so running meters cause no React renders.

```tsx
<Meter.Root read={() => peakDecibels(analyser)} min={-60} max={6}>
  <Meter.Label>Kick</Meter.Label>
  <Meter.Clip aria-label="Reset clip" />
  <Meter.Track className="track">
    <Meter.Bar className="bar" />
    <Meter.Peak className="peak" />
  </Meter.Track>
</Meter.Root>
```

`Bar` covers the track and is clipped to the level, so a gradient stays in place: green below, red at the top. The root sets `--meter-level`, `--meter-peak`, `data-active` while there is signal, `data-clipped` after a clip, and `data-zone` for its `zones`. `fall`, `hold` and `clipAbove` tune the ballistics.

### Toggle and ToggleGroup

`Toggle` is a button with `aria-pressed` that reacts on press, not on release. `behavior` is `"toggle"`, `"momentary"` (on while held) or `"hybrid"` (latches on a short press, momentary on a long one, like the buttons of hardware controllers).

`ToggleGroup` adds what DAWs do with rows of buttons:

- **`paint`**: dragging from a toggle sets every toggle the pointer crosses to the state the first one took. With `erase="secondary"`, the right button always erases, as in FL Studio.
- **`lane`** (on `Toggle`): toggles of one lane form a line, such as the mute buttons of a mixer's channels or one row of a step sequencer. A stroke paints along its lane even when the pointer drifts over another lane.
- **`exclusive`**: turning a toggle on turns the others in its lane off. `"click"` is Ableton Live's solo (Cmd/Ctrl+click adds); a map sets it per lane.
- **Keyboard**: the group is one tab stop. Arrows move along a lane and across lanes, Home and End go to the ends, and Shift+Arrow paints.
- **Gestures**: a stroke, or an exclusive press that turns five toggles off, is one `onGestureStart` / `onGestureEnd`.

```tsx
// A mixer: each strip holds its own mute and solo buttons, with state in your store.
<ToggleGroup paint exclusive={{ solo: "click" }} onGestureStart={history.begin} onGestureEnd={history.commit}>
  {tracks.map((track) => (
    <div key={track.id} className="strip">
      <Toggle lane="mute" pressed={track.muted} onPressedChange={(muted) => setMuted(track.id, muted)} aria-label={`Mute ${track.name}`}>M</Toggle>
      <Toggle lane="solo" pressed={track.soloed} onPressedChange={(soloed) => setSoloed(track.id, soloed)} aria-label={`Solo ${track.name}`}>S</Toggle>
    </div>
  ))}
</ToggleGroup>

// A step sequencer: the group holds the pattern.
<ToggleGroup paint erase="secondary" multiple defaultValue={pattern} onValueChange={setPattern}>
  {rows.map((row) =>
    steps.map((step) => <Toggle key={`${row}:${step}`} lane={row} value={`${row}:${step}`} aria-label={`${row}, step ${step + 1}`} />),
  )}
</ToggleGroup>
```

Toggles subscribe to the group with selectors: painting one step of a 16 × 64 grid renders that step, not the grid.

## 🔢 Values and formats

`createRange({ min, max, step, scale })` is the value model behind the controls, and you can use it on its own (for automation lanes or MIDI mapping, for example). The built-in `formats` print numbers with `Intl.NumberFormat` in the user's locale (or a `locale` you pass). They add only unit symbols that read the same in every language, and parse typed text back into a value:

| Format | Shows | Parses |
| --- | --- | --- |
| `formats.decibel()` | `-6.0 dB`, `-∞ dB` | `-6`, `-6,5 dB`, `-inf` |
| `formats.frequency()` | `440 Hz`, `1.50 kHz` | `440`, `1k`, `1.5 kHz` |
| `formats.time()` | `250 ms`, `1.50 s` | `250`, `1.5 s` |
| `formats.percent()` | `50%` (`50 %` in German) | `50`, `50%` |
| `formats.pan({ left, right, center })` | `50L`, `C`, `50R` with your letters | `50L`, `-50`, `C` |
| `formats.number({ digits, unit })` | `120.00 BPM` | `128`, `128 BPM` |
| `formats.position({ beatsPerBar, divisions })` | beats as `12.3.2` (bars, beats, sixteenths) | `12.3.2`, `12` |
| `formats.timecode({ fps })` | seconds as `01:02:03:12` | `01:02:03:12`, `1500` (from the right) |

A format is just `{ format(value): string; parse(text): number | null; segments? }`, so you can write your own. `segments` lists its fields (a name, the step of the value per step of the field, and its number and text in a value) and the text between them, for `NumberBox.Segments`.

`createRange` also takes `wrap` and `endless`, as the controls do.

## 🚦 Zones

Thresholds are declared, not computed per render. `zones` maps names to lower bounds in the control's units; every part gets `data-zone` with the zone the value is in, and the attribute changes only when a bound is crossed:

```tsx
<Fader.Root min={-Infinity} max={6} scale={scales.decibel} zones={{ hot: 0 }}>
  <Fader.Control>
    <Fader.Track>
      <Fader.Range className="bg-orange-500 data-[zone=hot]:bg-red-500" />
      <Fader.Tick value={6} className="data-[zone=hot]:text-red-500">+6</Fader.Tick>
    </Fader.Track>
  </Fader.Control>
</Fader.Root>

<Meter.Root read={peak} zones={{ warm: -18, hot: -6, clip: 0 }} />
```

A value at a bound belongs to the zone below it: 0 dB is not yet `hot`. Ticks carry the zone of their own value, and meters write `data-zone` from their frame loop, without React. `zoneOf(value, zones)` from the core gives the same answer in your own code, e.g. for a canvas.

## ↩️ Gestures, undo and automation

```tsx
<Fader.Root
  onGestureStart={() => history.begin("Volume")}
  onValueChange={(db) => track.setVolume(db)}
  onGestureEnd={() => history.commit()}
/>
```

A gesture starts with the first change, so a click that changes nothing leaves no empty undo step. While a gesture is open, write the values to an automation lane; that is how DAWs record knob movements.

## ⚡ Performance

In a DAW, UI work competes with the audio thread, so performance is measured, not assumed ([principles, section 7](https://github.com/addstack/daw-ui/blob/main/docs/principles.md#7-performance)). Every CI run renders a stress page with 64 channel strips (running meters, pan knobs, faders, mute and solo) and a 16 × 64 step sequencer, in a production build, with the CPU slowed down 4×:

| Scenario | Main thread per frame (ms) | Of which JavaScript (ms) | Dropped frames | Input → frame p50 / p95 (ms) | React commits |
| --- | --: | --: | --: | --: | --: |
| 64 meters running | 5.0 | 0.2 | 0 of 181 | – | 0 |
| Fader drag, meters running | 8.3 | 0.4 | 0 of 91 | 9.8 / 11.2 | 0 |
| Paint 64 steps, meters running | 7.4 | 1.1 | 1 of 89 | 10.1 / 11.8 | 32 for 30 moves |
| Automation on 128 knobs and faders, through `read` | 12.2 | 2.7 | 1 of 180 | – | 0 |
| The same automation through React state (`value`) | 19.4 | 9.9 | 24 of 157 | – | one per frame |

A 60 Hz frame has 16.7 ms. The last row is the comparison: controlled `value` props updated every frame cost the budget, `read` does not.

The deterministic numbers fail CI when they get worse: React commits per interaction (zero for drags, automation through `read` and running meters), renders per painted step (unit tests), and bundle size (15.2 kB for everything, minified and gzipped). Timings go to the job summary, because shared CI machines are too noisy to fail on them.

## 🎨 Building a styled library on top

The package ships behaviour only, so it can sit under your design system or a shadcn registry, the way Base UI sits under shadcn/ui. The [documentation's demos](https://github.com/addstack/daw-ui/tree/main/website/components/demos) show it with Tailwind, and the [playground](https://github.com/addstack/daw-ui/blob/main/playground/main.tsx) is written like that: its `components/ui` sections wrap the parts with `data-slot` and classes, and the app imports those.

- State is exposed as attributes: `data-dragging`, `data-disabled`, `data-bipolar`, `data-zone`, `data-orientation`, `data-pressed`, `data-painting="on" | "off"`, `data-editing`, `data-active`, `data-clipped`.
- `className` and `style` are plain values, never functions of state. In a DAW everything renders often (every pointer event of a drag, every frame of automation), so styling must not run code per render; the browser applies attributes and CSS variables by itself.
- Values are exposed as CSS variables: `--knob-value`, `--knob-angle`, `--fader-value`, `--meter-level`, `--meter-peak`.
- `render` replaces a part's element: `<Knob.Control render={<button />} />`. Handlers are merged; call `event.preventDefault()` in yours to skip the part's own handling.
- The only inline styles are positioning along a track (with logical properties) and `touch-action`.

## ♿ Accessibility and languages

Knobs and faders are sliders, number boxes are spin buttons, meters are meters, and toggles are buttons with `aria-pressed`. Values are announced as they are shown. A meter's accessible value updates four times a second, not 60. Nothing in the library is English: parts without visible text need a name from you (a `Label` part or `aria-label`), numbers follow the locale, and horizontal controls and arrow keys follow the reading direction in right-to-left pages. The details are in [docs/principles.md](https://github.com/addstack/daw-ui/blob/main/docs/principles.md).

## 📐 Specification

[docs/specification.md](https://github.com/addstack/daw-ui/blob/main/docs/specification.md) describes the behaviour. The tests in `test/` (jsdom) and `e2e/` (Playwright in Chromium, Firefox and WebKit) are its executable form.

## License

MIT
