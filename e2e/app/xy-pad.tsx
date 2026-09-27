import { useState } from "react";

import { XYPad, type XYValue } from "../../src/react/index.js";

// Two pads 200 × 100 px, both axes 0 … 1: one left to right, one in a right-to-left page. Each shows its values.

function Pad({ name }: { name: string }) {
  const [values, setValues] = useState<XYValue[]>([
    [0.25, 0.5],
    [0.75, 0.5],
  ]);
  return (
    <XYPad.Root value={values} onValueChange={setValues} className="xy-pad">
      <XYPad.Label>{name}</XYPad.Label>
      <XYPad.Control className="xy-pad-control" data-testid={`${name} control`}>
        <XYPad.Thumb index={0} aria-label={`${name} 1`} className="xy-pad-thumb" />
        <XYPad.Thumb index={1} aria-label={`${name} 2`} className="xy-pad-thumb" />
      </XYPad.Control>
      <output data-testid={`${name} values`}>{JSON.stringify(values)}</output>
    </XYPad.Root>
  );
}

export function XYPadView() {
  return (
    <main>
      <h1>daw-ui xy-pad</h1>
      <Pad name="Pad" />
      <div dir="rtl">
        <Pad name="RTL pad" />
      </div>
    </main>
  );
}
