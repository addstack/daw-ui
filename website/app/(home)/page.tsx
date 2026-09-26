import Link from 'next/link';

import FaderDemo from '@/components/demos/fader';
import KnobDemo from '@/components/demos/knob';
import BipolarKnobDemo from '@/components/demos/knob-bipolar';
import MeterDemo from '@/components/demos/meter';
import SequencerDemo from '@/components/demos/toggle-group-sequencer';
import { playgroundUrl } from '@/lib/shared';

const features = [
  {
    title: 'DAW input',
    text: 'Vertical drag, Shift for fine steps, double-click to reset, the wheel, pointer lock, and typed values like "1k" or "-6 dB".',
  },
  {
    title: 'Painting',
    text: 'Drag across steps to set them all, right-drag to erase. Fast drags skip nothing, and lanes keep strokes on one row.',
  },
  {
    title: 'Gestures',
    text: 'Every drag, key press or stroke is one onGestureStart / onGestureEnd pair: one undo step, one automation pass.',
  },
  {
    title: 'Measured performance',
    text: '64 running meters cause zero React renders. Commit budgets and bundle size fail CI; frame times are reported.',
  },
  {
    title: 'Accessible, in any language',
    text: 'Sliders, spin buttons and meters with values read as shown. No English built in, numbers in the user’s locale, RTL.',
  },
  {
    title: 'Headless, like Base UI',
    text: 'Parts, data attributes, CSS variables and a render prop. Style it with Tailwind, or publish your own shadcn registry.',
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-20 px-4 py-16 sm:px-6">
      <section className="grid items-center gap-12 lg:grid-cols-[1fr_auto]">
        <div className="max-w-xl min-w-0">
          <p className="text-sm font-medium text-fd-primary">Headless React components for audio apps</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-balance sm:text-5xl">
            Knobs, faders and meters that work like a DAW.
          </h1>
          <p className="mt-5 text-lg text-fd-muted-foreground">
            Unstyled and accessible parts in the style of Base UI, with the input, painting and gestures of Ableton Live and FL
            Studio. In any language, and measured for speed.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/docs"
              className="rounded-lg bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
            >
              Get started
            </Link>
            <a href={playgroundUrl} className="rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-fd-accent">
              Open the playground
            </a>
          </div>
          <pre className="mt-8 w-fit rounded-lg border bg-fd-card px-4 py-2.5 font-mono text-sm">npm install @addstack/daw-ui</pre>
        </div>

        <div className="flex min-w-0 flex-col items-center gap-8 rounded-2xl border bg-fd-card p-6 shadow-sm sm:p-8">
          <div className="flex flex-wrap items-end justify-center gap-8">
            <div className="flex flex-col gap-8">
              <KnobDemo />
              <BipolarKnobDemo />
            </div>
            <MeterDemo />
            <FaderDemo />
          </div>
          {/* Sixteen steps are wider than a phone: the sequencer scrolls inside the card. */}
          <div className="flex max-w-full justify-center-safe overflow-x-auto pb-1">
            <SequencerDemo />
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature) => (
          <div key={feature.title} className="rounded-xl border bg-fd-card p-5">
            <h2 className="font-semibold">{feature.title}</h2>
            <p className="mt-2 text-sm text-fd-muted-foreground">{feature.text}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
