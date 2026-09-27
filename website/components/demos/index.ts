import type { ComponentType } from 'react';

import ArrangementDemo from './arrangement';
import FaderDemo from './fader';
import KnobDemo from './knob';
import BipolarKnobDemo from './knob-bipolar';
import EndlessKnobDemo from './knob-endless';
import ModulationDemo from './knob-modulation';
import WrapKnobDemo from './knob-wrap';
import MeterDemo from './meter';
import MixerBlockDemo from './mixer';
import NotesDemo from './notes';
import NumberBoxDemo from './number-box';
import SegmentsDemo from './number-box-segments';
import RegionDemo from './region';
import TimelineDemo from './timeline';
import ToggleDemo from './toggle';
import MixerDemo from './toggle-group-mixer';
import SequencerDemo from './toggle-group-sequencer';
import WaveformDemo from './waveform';
import RecordingDemo from './waveform-recording';
import SampleDemo from './waveform-sample';

/** Demos by file name, for `<ComponentPreview name="…" />`. */
export const demos = {
  arrangement: ArrangementDemo,
  fader: FaderDemo,
  knob: KnobDemo,
  'knob-bipolar': BipolarKnobDemo,
  'knob-endless': EndlessKnobDemo,
  'knob-modulation': ModulationDemo,
  'knob-wrap': WrapKnobDemo,
  meter: MeterDemo,
  mixer: MixerBlockDemo,
  notes: NotesDemo,
  'number-box': NumberBoxDemo,
  'number-box-segments': SegmentsDemo,
  region: RegionDemo,
  timeline: TimelineDemo,
  toggle: ToggleDemo,
  'toggle-group-mixer': MixerDemo,
  'toggle-group-sequencer': SequencerDemo,
  waveform: WaveformDemo,
  'waveform-recording': RecordingDemo,
  'waveform-sample': SampleDemo,
} satisfies Record<string, ComponentType>;

export type DemoName = keyof typeof demos;
