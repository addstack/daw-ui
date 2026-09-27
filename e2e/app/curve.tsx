import { useState } from "react";

import { musicalGrid, type CurvePoint } from "../../src/core/index.js";
import { Curve, useCurveEditing } from "../../src/react/index.js";

// An editable curve on its own: 400 × 100 px for 4 s (100 px per second), moves snapped to sixteenths at
// 120 BPM. The application keeps the points each gesture leaves, and shows them for the tests.

const initial: CurvePoint[] = [
  { at: 0, value: 0 },
  { at: 1, value: 0.5 },
  { at: 2, value: 1 },
  { at: 4, value: 0 },
];
const grid = musicalGrid({ bpm: 120, locale: "en" });

export function CurveView() {
  const [points, setPoints] = useState(initial);
  const editing = useCurveEditing({ snap: { time: grid }, onGestureEnd: setPoints });
  return (
    <main>
      <h1>daw-ui curve</h1>
      <output data-testid="points">{JSON.stringify(points)}</output>
      <Curve.Root points={points} editing={editing} aria-label="Volume" className="curve-edit">
        <Curve.Fill className="clip-curve-fill" />
        <Curve.Line className="clip-curve" thickness={2} />
        <Curve.Dots className="clip-curve" />
        <Curve.Bend className="curve-bend" data-testid="bend" />
        <Curve.Handle className="curve-handle" aria-label="Point" />
      </Curve.Root>
    </main>
  );
}
