import { useEffect, useRef, useState, type ReactNode } from "react";

import { NumberBox, Region, Toggle, ToggleGroup } from "../../../src/react/index.js";
import { ROLE_NAMES, SECTION_NAMES, STYLE_NAMES, type Chord, type Role, type Style } from "../engine/compose/composer.js";
import { freshSeed } from "../engine/compose/random.js";
import { chordName, diatonic, keyName, noteName, romanNumeral, type ChordSymbol, type Key, type Mode } from "../engine/compose/theory.js";
import type { Project, Track } from "../engine/project.js";
import { host, type Selection } from "./state.js";

// Composing: the chord track and the form ("Structure") at the top of the arrangement, as rows of labelled cells,
// and a panel to generate them, and the notes of a track that follow them. What writes them is the host's
// composer, behind an interface that a model could implement later.

const ROLES_FOR: Record<"synth" | "drums", Role[]> = { synth: ["bass", "chords", "arp", "lead"], drums: ["drums"] };

/** A button that opens a list of actions below it. */
export function Menu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => !element.current?.contains(event.target as Node) && setOpen(false);
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div ref={element} className="menu">
      <button type="button" className="menu-button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        ⋮
      </button>
      {open && (
        <div role="menu" className="menu-list">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onSelect, close, children, disabled }: { onSelect: () => void; close: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        close();
        onSelect();
      }}
    >
      {children}
    </button>
  );
}

/** The headers of the chord and form rows, beside the arrangement's track headers. */
export function ComposeHeaders({ project, onCompose }: { project: Project; onCompose: () => void }) {
  return (
    <>
      <div className="lane-header">
        <span>Chords</span>
        <span className="lane-header-key">{project.chords.length > 0 ? keyName(project.key) : ""}</span>
        <Menu label="Chords">
          {(close) => (
            <>
              <MenuItem close={close} onSelect={() => void host.recompose(freshSeed())} disabled={project.sections.length === 0}>
                New chords for this structure
              </MenuItem>
              <MenuItem close={close} onSelect={onCompose}>
                Compose…
              </MenuItem>
              <MenuItem close={close} onSelect={() => host.commit({ ...host.project, chords: [] })} disabled={project.chords.length === 0}>
                Clear chords
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
      <div className="lane-header">
        <span>Structure</span>
        <Menu label="Structure">
          {(close) => (
            <>
              <MenuItem close={close} onSelect={() => void host.compose({ style: project.style, key: project.key, seed: freshSeed() })}>
                Generate structure and chords
              </MenuItem>
              <MenuItem close={close} onSelect={onCompose}>
                Compose…
              </MenuItem>
              <MenuItem close={close} onSelect={() => host.commit({ ...host.project, sections: [], chords: [] })} disabled={project.sections.length === 0}>
                Clear structure and chords
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
    </>
  );
}

/** Chords to put in a chord's place: the key's own, as triads and sevenths, and two often borrowed. */
function choices(key: Key): ChordSymbol[] {
  const own = Array.from({ length: 7 }, (_, step) => diatonic(key, step));
  const sevenths = Array.from({ length: 7 }, (_, step) => diatonic(key, step, true));
  const borrowed: ChordSymbol[] =
    key.mode === "major"
      ? [
          { root: (key.tonic + 10) % 12, quality: "maj" },
          { root: (key.tonic + 5) % 12, quality: "min" },
        ]
      : [
          { root: (key.tonic + 7) % 12, quality: "maj" },
          { root: (key.tonic + 5) % 12, quality: "maj" },
        ];
  return [...own, ...sevenths, ...borrowed];
}

/** The chord track: a cell for each chord, which plays it on the selected track and can be changed. */
export function ChordLane({ project, selection }: { project: Project; selection: Selection }) {
  const [editing, setEditing] = useState<string | null>(null);
  const chord = project.chords.find((one) => one.id === editing);
  return (
    <div className="lane-row chords" role="group" aria-label="Chords">
      {project.chords.map((one) => (
        <Region.Root
          key={one.id}
          at={one.at}
          duration={one.duration}
          className="chord-cell"
          data-selected={editing === one.id || undefined}
          title={`${chordName(one, project.key)} (${romanNumeral(one, project.key)}): click to hear it, double-click to change it`}
          onPointerDown={(event) => {
            event.stopPropagation();
            void host.previewChord(selection.track, one);
          }}
          onDoubleClick={() => setEditing(one.id)}
        >
          <Region.Label className="chord-name">{chordName(one, project.key)}</Region.Label>
        </Region.Root>
      ))}
      {chord && <ChordPicker chord={chord} project={project} selection={selection} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ChordPicker({ chord, project, selection, onClose }: { chord: Chord; project: Project; selection: Selection; onClose: () => void }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    element.current?.querySelector<HTMLButtonElement>("[aria-pressed=true], button")?.focus();
    const away = (event: PointerEvent) => !element.current?.contains(event.target as Node) && onClose();
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, []);
  return (
    <div
      ref={element}
      role="dialog"
      aria-label={`Change ${chordName(chord, project.key)}`}
      className="chord-picker"
      style={{ left: `calc((${chord.at} - var(--timeline-start)) * var(--timeline-scale))` }}
      onKeyDown={(event) => event.key === "Escape" && onClose()}
    >
      {choices(project.key).map((choice) => {
        const same = choice.root === chord.root && choice.quality === chord.quality;
        return (
          <button
            key={`${choice.root} ${choice.quality}`}
            type="button"
            aria-pressed={same}
            onPointerEnter={() => void host.previewChord(selection.track, choice)}
            onClick={() => {
              host.setChord(chord.id, choice);
              onClose();
            }}
          >
            <span>{chordName(choice, project.key)}</span>
            <span className="roman">{romanNumeral(choice, project.key)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The form: a cell for each section; a double-click loops it. */
export function SectionLane({ project }: { project: Project }) {
  return (
    <div className="lane-row sections" role="group" aria-label="Structure">
      {project.sections.map((section) => (
        <Region.Root
          key={section.id}
          at={section.at}
          duration={section.duration}
          className="section-cell"
          data-kind={section.kind}
          data-looped={(project.loop.on && project.loop.start === section.at && project.loop.end === section.at + section.duration) || undefined}
          title={`${section.name}: double-click to loop it`}
          onDoubleClick={() => host.setLoop({ on: true, start: section.at, end: section.at + section.duration })}
        >
          <Region.Label className="section-name">{section.name}</Region.Label>
          <span className="section-energy" style={{ width: `${section.energy * 100}%` }} aria-hidden="true" />
        </Region.Root>
      ))}
    </div>
  );
}

const TONICS = Array.from({ length: 12 }, (_, pc) => pc);

/** The panel to compose: the style and key of the form and chords, and the notes of each track. */
export function ComposePanel({ project, selection, onSelect }: { project: Project; selection: Selection; onSelect: (selection: Selection) => void }) {
  const [style, setStyle] = useState<Style>(project.style);
  const [key, setKey] = useState<Key>(project.key);
  const [seed, setSeed] = useState(project.seed);
  const [busy, setBusy] = useState(false);
  const track = project.tracks.find((one) => one.id === selection.track);
  const planned = project.sections.length > 0;

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="compose" aria-busy={busy}>
      <section className="compose-block" aria-label="Structure and chords">
        <h3>Structure and chords</h3>
        <div className="compose-row">
          <span className="field-label">Style</span>
          <ToggleGroup aria-label="Style" value={[style]} onValueChange={(value) => value[0] && setStyle(value[0] as Style)} className="segmented">
            {(Object.keys(STYLE_NAMES) as Style[]).map((one) => (
              <Toggle key={one} value={one} className="segment">
                {STYLE_NAMES[one]}
              </Toggle>
            ))}
          </ToggleGroup>
        </div>
        <div className="compose-row">
          <span className="field-label">Key</span>
          <select aria-label="Tonic" value={key.tonic} onChange={(event) => setKey({ ...key, tonic: Number(event.target.value) })}>
            {TONICS.map((pc) => (
              <option key={pc} value={pc}>
                {noteName(pc, key)}
              </option>
            ))}
          </select>
          <ToggleGroup aria-label="Mode" value={[key.mode]} onValueChange={(value) => value[0] && setKey({ ...key, mode: value[0] as Mode })} className="segmented">
            <Toggle value="major" className="segment">
              Major
            </Toggle>
            <Toggle value="minor" className="segment">
              Minor
            </Toggle>
          </ToggleGroup>
        </div>
        <div className="compose-row">
          <NumberBox.Root min={0} max={999_999} step={1} value={seed} onValueChange={setSeed} className="number">
            <NumberBox.Label className="field-label">Seed</NumberBox.Label>
            <NumberBox.Field className="field-box seed" />
          </NumberBox.Root>
          <button type="button" onClick={() => setSeed(freshSeed())} title="Another seed: another song">
            Another
          </button>
        </div>
        <div className="compose-row">
          <button type="button" className="primary" disabled={busy} onClick={() => void run(() => host.compose({ style, key, seed }))}>
            {planned ? "Generate again" : "Generate structure and chords"}
          </button>
          <button type="button" disabled={busy || !planned} onClick={() => void run(() => host.recompose(freshSeed()))} title="Keep the structure, change the chords">
            New chords
          </button>
        </div>
        <p className="compose-note">
          The same style, key and seed give the same song. {planned ? `Now: ${STYLE_NAMES[project.style]}, ${keyName(project.key)}, ${project.sections.length} sections, ${project.chords.length} chords.` : ""}
        </p>
      </section>

      <section className="compose-block" aria-label="Parts">
        <h3>Parts</h3>
        {!planned && <p className="compose-note">Generate a structure and chords first: the parts follow them.</p>}
        {planned && track?.instrument && <TrackPart track={track} busy={busy} run={run} />}
        {planned && track && !track.instrument && <p className="compose-note">{track.name} is an audio track: select an instrument track to generate its notes.</p>}
        <div className="compose-row">
          <span className="field-label">New track</span>
          {(["drums", "bass", "chords", "arp", "lead"] as Role[]).map((role) => (
            <button key={role} type="button" disabled={busy || !planned} onClick={() => void run(async () => onSelect({ track: await host.addPart(role, freshSeed()), clip: null }))}>
              + {ROLE_NAMES[role]}
            </button>
          ))}
        </div>
      </section>

      <section className="compose-block wide" aria-label="Sections">
        <h3>Sections</h3>
        <ol className="compose-sections">
          {project.sections.map((section) => (
            <li key={section.id}>
              <span className="section-kind" data-kind={section.kind}>
                {SECTION_NAMES[section.kind]}
              </span>
              <span>{section.duration / 4} bars</span>
              <span className="section-chords">
                {project.chords
                  .filter((chord) => chord.at >= section.at && chord.at < section.at + section.duration)
                  .slice(0, 8)
                  .map((chord) => chordName(chord, project.key))
                  .join(" ")}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/** Generating the selected track's notes: in a role it suits, again with another seed. */
function TrackPart({ track, busy, run }: { track: Track; busy: boolean; run: (work: () => Promise<unknown>) => Promise<void> }) {
  const roles = ROLES_FOR[track.instrument!];
  const [role, setRole] = useState<Role>(track.role && roles.includes(track.role) ? track.role : roles[0]!);
  useEffect(() => setRole(track.role && roles.includes(track.role) ? track.role : roles[0]!), [track.id]);
  return (
    <>
      <div className="compose-row">
        <span className="field-label">{track.name} plays</span>
        <ToggleGroup aria-label="Role" value={[role]} onValueChange={(value) => value[0] && setRole(value[0] as Role)} className="segmented">
          {roles.map((one) => (
            <Toggle key={one} value={one} className="segment">
              {ROLE_NAMES[one]}
            </Toggle>
          ))}
        </ToggleGroup>
      </div>
      <div className="compose-row">
        <button type="button" className="primary" disabled={busy} onClick={() => void run(() => host.generate(track.id, role, track.role === role && track.seed !== undefined ? track.seed : freshSeed()))}>
          Generate {track.name}'s notes
        </button>
        <button type="button" disabled={busy || track.role !== role} onClick={() => void run(() => host.generate(track.id, role, freshSeed()))} title="The same role, other notes">
          Another take
        </button>
      </div>
      <p className="compose-note">Its clips are replaced with one for each section it plays in; undo brings them back.</p>
    </>
  );
}
