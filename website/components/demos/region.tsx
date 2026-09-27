'use client';

import { musicalGrid } from '@addstack/daw-ui';
import { Notes, Region, Timeline, type Note } from '@addstack/daw-ui/react';

// 120 BPM: a bar is 2 seconds.
const grid = musicalGrid({ bpm: 120 });

// The parts of a song: regions with a name and nothing inside.
const sections = [
  { name: 'Intro', at: 0, duration: 4, color: 'bg-neutral-700' },
  { name: 'Verse', at: 4, duration: 8, color: 'bg-sky-800' },
  { name: 'Chorus', at: 12, duration: 8, color: 'bg-orange-700' },
  { name: 'Outro', at: 20, duration: 4, color: 'bg-neutral-700' },
];

// Four bars of a melody in eighths, in seconds of the clip.
const melody: Note[] = Array.from({ length: 32 }, (_, index) => ({
  at: index * 0.25,
  duration: 0.2,
  pitch: [60, 62, 64, 67, 69, 67, 64, 62][index % 8]! + (index >= 16 ? 5 : 0),
}));

export default function RegionDemo() {
  return (
    <Timeline.Root start={0} end={24} className="w-full max-w-2xl overflow-hidden rounded-md bg-neutral-900 text-white select-none">
      <Timeline.Ruler grid={grid} className="h-6 border-b border-neutral-800 font-mono text-[10px] text-neutral-400 [&_[data-label]]:top-0.5 [&_[data-label]]:ps-1" />
      <div className="relative">
        <Timeline.Grid grid={grid} spacing={64} className="text-white/10" />

        {/* A region fills the height of the row it is in: here, 24 px. */}
        <div role="group" aria-label="Sections" className="relative h-6 border-b border-neutral-800">
          {sections.map((section) => (
            <Region.Root key={section.name} at={section.at} duration={section.duration} className="px-px py-0.5">
              <Region.Header className={`flex h-full items-center rounded-sm px-1.5 text-[11px] font-medium ${section.color}`}>
                <Region.Label className="truncate">{section.name}</Region.Label>
              </Region.Header>
            </Region.Root>
          ))}
        </div>

        {/* A clip of four bars, trimmed: it starts at bar 4 and shows its content from the second second on. */}
        <div role="group" aria-label="Lead" className="relative h-20">
          <Region.Root at={6} duration={6} offset={2} className="flex flex-col overflow-hidden rounded-sm bg-emerald-950/80">
            <Region.Header className="flex h-4 shrink-0 items-center bg-emerald-800 px-1 text-[10px]">
              <Region.Label className="truncate">Lead</Region.Label>
            </Region.Header>
            <Region.Content className="flex-1">
              <Notes.Root notes={melody} className="h-full">
                <Notes.Shape className="text-emerald-400" />
              </Notes.Root>
            </Region.Content>
          </Region.Root>
        </div>
      </div>
    </Timeline.Root>
  );
}
