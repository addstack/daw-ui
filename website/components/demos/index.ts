import type { ComponentType } from 'react';

import FaderDemo from './fader';
import KnobDemo from './knob';
import BipolarKnobDemo from './knob-bipolar';
import MeterDemo from './meter';
import NumberBoxDemo from './number-box';
import ToggleDemo from './toggle';
import MixerDemo from './toggle-group-mixer';
import SequencerDemo from './toggle-group-sequencer';

/** Demos by file name, for `<ComponentPreview name="…" />`. */
export const demos = {
  fader: FaderDemo,
  knob: KnobDemo,
  'knob-bipolar': BipolarKnobDemo,
  meter: MeterDemo,
  'number-box': NumberBoxDemo,
  toggle: ToggleDemo,
  'toggle-group-mixer': MixerDemo,
  'toggle-group-sequencer': SequencerDemo,
} satisfies Record<string, ComponentType>;

export type DemoName = keyof typeof demos;
