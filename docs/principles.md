# Principles

Rules every component in `daw-ui` follows. A change that breaks one of them needs a reason written down here first.

## 1. Headless, in the style of Base UI

The package ships behaviour, not looks. Someone else must be able to publish a shadcn registry with their own design on top of it, using only the public API.

- A component is a namespace of parts named like Base UI's: `Knob.Root`, `Knob.Control`, `Knob.Label`, `Knob.Value`, `Fader.Track`, `Fader.Thumb`, …
- Each part renders one element and takes that element's props, and `render` (an element or a function) to replace the element. `className` and `style` are plain values, never functions of the part's state (section 7).
- State is exposed as `data-*` attributes (`data-dragging`, `data-pressed`, `data-disabled`, `data-orientation`, …) and, for values, as CSS variables on the root (`--knob-value`, `--fader-value`), so styling needs no JavaScript.
- Thresholds on a value, such as "red above 0 dB", are declared once as a prop and exposed as an attribute that changes only when the value crosses one. The application never has to compare values in code to style a part.
- Types are exported per part: `Knob.Root.Props`, `Knob.Root.State`. A registry wraps them the way shadcn wraps Base UI.
- The library sets no colours, sizes, fonts or spacing. Inline styles are limited to what behaviour needs: positioning along a track (with logical properties) and `touch-action`.
- `data-slot` and anything else registry-specific belongs in the registry, not here.

## 2. Accessibility

- Every control has the right role and state: `slider` for knobs and faders, `spinbutton` for number boxes, `meter` for level meters, `button` with `aria-pressed` for toggles.
- Values are announced as users read them: `aria-valuetext` comes from the same `format` that draws the value ("-6.0 dB", not "-6").
- Every part without visible text needs an accessible name. The library never invents one; a `Label` part or an `aria-label` from the consumer provides it.
- Focus is visible and predictable. Groups use a roving tab index, so a 16×64 step grid is one tab stop.

## 3. Internationalization

The library does not decide the language of an application. **No English text is hard-coded**: nothing a user sees or a screen reader announces comes from the library as English words.

- Numbers are formatted with `Intl.NumberFormat` in the consumer's locale (the runtime default unless `locale` is given): "1,50 kHz" in Polish, "1.50 kHz" in English.
- Unit symbols that are the same in every language (Hz, kHz, dB, ms, s, %) and mathematical signs (−∞) may appear. Words and their abbreviations may not: the pan format takes its "L/R/C" (or "L/P/Ś") from the consumer.
- Parsing accepts both decimal separators and the Unicode minus sign.

## 4. Right-to-left layouts

Arabic, Hebrew and Persian interfaces run right to left, and a component must work there without extra code. The direction is read from the DOM (`dir` / CSS `direction`), not from a prop.

- **What follows the reading direction:** horizontal faders and meters fill from the inline start (the right edge in RTL); horizontal drag increases towards the inline end; Left and Right arrow keys on horizontal controls and in toggle groups move the value or focus along the reading direction; Home goes to the inline start.
- **What does not:** vertical controls (up is always more), knobs (clockwise is always more, as on hardware), and Up and Down keys. Time on a timeline also runs left to right, the convention of music software and notation, and so do the fields of a song position or a timecode.
- Formatted values render with `dir="auto"`: the text decides its own direction, so "-6.0 dB" keeps its order inside a right-to-left page, and a value with an Arabic unit reads right to left.
- Positioning uses logical properties (`inset-inline-start`, not `left`). Where CSS has no logical form (`translate`, `clip-path`), the part reads the direction once when it mounts. Timelines, which run left to right in every language, use physical properties on purpose.
- RTL behaviour is covered by tests in real browsers, like any other layout-dependent behaviour.

## 5. Input

- Every pointer interaction has a keyboard equivalent. Painting toggles by dragging has Shift+Arrow.
- Modifiers mean the same everywhere: **Shift** is fine adjustment, **double-click** and **Delete** reset, **Cmd/Ctrl** is the alternative action (e.g. additive solo).
- Mouse, pen and touch go through Pointer Events with pointer capture, so a drag continues outside the element and never leaves listeners behind.
- Toggles react on press, not on release, as in hardware and desktop DAWs.

## 6. Gestures

Every user action is wrapped in `onGestureStart` / `onGestureEnd`: a drag, a key press, a burst of wheel events, a reset, a typed value, a paint stroke, an exclusive solo that turns five toggles off. An application uses them to make each action one undo step and to record automation. A gesture starts only when something changes.

## 7. Performance

Performance is a requirement, measured on every change.

- **Assume that everything renders often.** A drag commits on every pointer event, and automation changes controlled values on every frame, on every channel. Work done per render is multiplied by the number of channels and the frame rate, so it is never "negligible". Parts therefore run no application code per render to style themselves: `className` and `style` take values, not functions of state, and state reaches CSS only through attributes and CSS variables, which the browser applies without JavaScript. An API that invites per-render work in the hot path is a performance bug, even when each call is cheap.
- **Values that change at audio-visual rates never go through React state.** Meters, and the value of knobs, faders and number boxes, are written straight to the DOM: a drag, a key or automation changes what the parts show without rendering anything. Values that change on their own (meter levels, automation, modulation) are read once per animation frame by one shared loop (`read`), not pushed through props.
- An interaction re-renders only what it changes: dragging one knob does not render its siblings.
- **Drawing happens when what is drawn changes, not when it moves.** Waveforms draw canvas tiles once and let CSS move and stretch them: playback and scrolling draw nothing that is drawn already. What must be drawn is queued and spread over frames within a budget, visible first, so that no frame is dropped for it.
- Layout is read at the start of a gesture, not on every pointer move.
- **Budgets that are deterministic gate CI**: React render counts per interaction (zero for a drag, zero for automation through `read`, zero for running meters), bundle size.
- **Timings are measured and reported**: frame times and input latency in Chromium under 4× CPU throttling on a stress page (64 channel strips, a 16×64 step grid). CI runners are too noisy to gate on them; the numbers go to the job summary.
- Core functions have micro-benchmarks (`vitest bench`).

## 8. Values and state

- Every stateful part works controlled (`value` + `onValueChange`) and uncontrolled (`defaultValue`).
- Values are in natural units (Hz, dB, ms, −1…1 for pan). The travel position in [0, 1] is derived through a `Range` with a `Scale`.
- Callbacks receive `details` with the `reason` and the native `event`; value callbacks also receive the `delta`, for relative uses such as endless encoders.

## 9. Packaging

- No runtime dependencies. The core (`@addstack/daw-ui`) does not import React; the React binding is `@addstack/daw-ui/react`.
- Safe to import during server rendering: `"use client"` on React modules, no `window` access at import time.
- ESM only, `sideEffects: false`.

## 10. Specification and tests

[`specification.md`](./specification.md) describes the behaviour; tests in `test/` (jsdom) and `e2e/` (Playwright, Chromium, Firefox and WebKit) are its executable form. Pointer behaviour that depends on layout is tested in real browsers.
