import { formats } from "../../src/core/index.js";
import { Keys, Notes, type Note } from "../../src/react/index.js";
import { log } from "./harness.js";

// Keyboards for the e2e and perf tests; every press and release goes to the harness, without rendering.
// - "Piano": C3 to C5, 15 white keys of 28 px, 100 px tall, black keys 60 px long.
// - "Roll keys": C4 to B4, one row of 20 px per semitone, beside notes over the same range; again right to left.
// - "Grand": the 88 keys of a piano; with ?play, keys held elsewhere change every 50 ms, through read.

const format = formats.pitch({ names: ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"], locale: "en" });
const between = (lowest: number, highest: number) => Array.from({ length: highest - lowest + 1 }, (_, index) => lowest + index);

function Keyboard({ name, range, ...props }: Omit<Keys.Root.Props, "range"> & { name: string; range: readonly [number, number] }) {
  return (
    <Keys.Root
      range={range}
      format={format}
      aria-label={name}
      onPress={(note, { reason, velocity }) => log({ source: name, type: "press", value: note, reason, velocity })}
      onRelease={(note, { reason }) => log({ source: name, type: "release", value: note, reason })}
      {...props}
    >
      {between(...range).map((note) => (
        <Keys.Key key={note} note={note} className="key" />
      ))}
    </Keys.Root>
  );
}

// One note per pitch of the roll, a beat each.
const scale: Note[] = between(60, 71).map((pitch, index) => ({ at: index * 0.25, duration: 0.25, pitch }));

function Roll({ name }: { name: string }) {
  return (
    <div className="roll">
      <Keyboard name={name} range={[60, 71]} orientation="vertical" layout="rows" className="keys roll-keys" />
      <Notes.Root notes={scale} range={[60, 71]} aria-label={`${name} notes`} className="roll-notes">
        <Notes.Shape />
      </Notes.Root>
    </div>
  );
}

const playing = new URLSearchParams(location.search).has("play");
// A chord that moves every 50 ms, across the whole keyboard.
const chord = () => {
  const root = 21 + (Math.floor(performance.now() / 50) % 80);
  return [root, root + 4, root + 7];
};

export function KeysView() {
  return (
    <main>
      <h1>daw-ui keys</h1>
      <Keyboard name="Piano" range={[48, 72]} className="keys piano" />
      <Roll name="Roll keys" />
      <div dir="rtl">
        <Roll name="RTL roll keys" />
      </div>
      <Keyboard name="Grand" range={[21, 108]} className="keys grand" read={playing ? chord : undefined} />
    </main>
  );
}
