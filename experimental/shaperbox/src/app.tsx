import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";

import { formats } from "../../../src/core/index.js";
import { NumberBox, Toggle } from "../../../src/react/index.js";
import type { Box, SourceName } from "../engine/box.js";
import { LOOPS } from "../engine/loops.js";
import { ShaperBoxPanel } from "./panel.js";

// An experimental take on Cableguys' ShaperBox 3, built on daw-ui: nine shapers in a chain, each moving one thing
// (volume, a filter, time, pan, width, noise, crush, drive, a flanger or phaser) by a wave drawn over a cycle that
// follows the tempo or starts on a transient, over the whole signal or over three bands, each with its own wave.
// On its own page here, with a loop or a file to shape; as an effect in the experimental DAW.

const bpmFormat = formats.number({ digits: 2, unit: "BPM" });

const interactive = (target: EventTarget | null) =>
  target instanceof HTMLElement && target.closest("input, select, textarea, button, [role=slider], [role=spinbutton], [role=button], [contenteditable]") !== null;

export function App({ box }: { box: Box }) {
  const [playing, setPlaying] = useState(false);
  const [source, setSource] = useState<SourceName>(box.source);
  const [tempoKey, setTempoKey] = useState(0);
  const [status, setStatus] = useState("");
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const play = useCallback(
    async (next: boolean) => {
      setPlaying(next);
      await box.start();
      box.play(next);
    },
    [box],
  );

  const open = async (file: File) => {
    try {
      setStatus(`Opening ${file.name}…`);
      const bpm = await box.loadFile(file);
      setSource("File");
      setTempoKey((key) => key + 1);
      setStatus(
        bpm === null
          ? `${file.name} plays in a loop. Set the tempo to its own, so that the waves line up with it.`
          : `${file.name} plays in a loop, at ${bpm} BPM: the tempo whole bars of 4/4 give its length.`,
      );
    } catch {
      setStatus(`${file.name} could not be read as audio.`);
    }
  };

  // Space plays and stops, as in a DAW, unless a control has the key.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== " " || event.repeat || interactive(event.target)) return;
      event.preventDefault();
      void play(!box.playing);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [box, play]);

  const files = (event: DragEvent) => event.dataTransfer.types.includes("Files");

  return (
    <main
      className="shaperbox-ui box"
      data-dropping={dropping || undefined}
      onDragOver={(event) => {
        if (!files(event)) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => event.currentTarget === event.target && setDropping(false)}
      onDrop={(event) => {
        if (!files(event)) return;
        event.preventDefault();
        setDropping(false);
        const file = event.dataTransfer.files[0];
        if (file) void open(file);
      }}
    >
      <ShaperBoxPanel
        box={box}
        lead={
          <>
            <h1>
              daw-ui <span>experimental shaperbox</span>
            </h1>
            <div className="transport">
              <Toggle pressed={playing} onPressedChange={(pressed) => void play(pressed)} aria-label="Play" className="play" title="Play or stop (Space)">
                {playing ? "■" : "▶"}
              </Toggle>
              <NumberBox.Root
                key={tempoKey}
                min={40}
                max={240}
                step={0.01}
                defaultValue={box.bpm}
                format={bpmFormat}
                onValueChange={(bpm) => box.setBpm(bpm)}
                className="number"
              >
                <NumberBox.Label className="field-label">Tempo</NumberBox.Label>
                <NumberBox.Field className="field-box tempo" />
              </NumberBox.Root>
              <label className="field">
                <span className="field-label">Audio</span>
                <select
                  value={source}
                  onChange={(event) => {
                    const next = event.target.value as SourceName;
                    box.useSource(next);
                    setSource(next);
                  }}
                >
                  {LOOPS.map((loop) => (
                    <option key={loop} value={loop}>
                      {loop} loop
                    </option>
                  ))}
                  {box.file && <option value="File">{box.file.name}</option>}
                </select>
              </label>
              <button type="button" onClick={() => fileInput.current?.click()}>
                Open file…
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="audio/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void open(file);
                  event.target.value = "";
                }}
              />
            </div>
          </>
        }
      />
      <p className="status" role="status">
        {status || "Press ▶ or Space to play the loop. Drop an audio file anywhere to shape your own."}
      </p>
    </main>
  );
}
