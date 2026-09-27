// Generates the props tables of the docs (generated/api.json) from the
// library's types, so they cannot drift from the code. Reads the built
// declarations in ../dist: run `npm run build` in the repository root first.
//
// A part's props type includes every prop of the element it renders; the
// tables list only the props the library declares, and put the ones every
// part shares (className, style, render) last.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createGenerator } from "fumadocs-typescript";

const root = path.resolve(import.meta.dirname, "..");
const library = path.resolve(root, "..");

/** The documented parts, by the name the docs use. */
const PARTS = [
  "Knob.Root",
  "Knob.Control",
  "Knob.Label",
  "Knob.Track",
  "Knob.Range",
  "Knob.Pointer",
  "Knob.Modulation",
  "Knob.Value",
  "Fader.Root",
  "Fader.Control",
  "Fader.Label",
  "Fader.Track",
  "Fader.Range",
  "Fader.Thumb",
  "Fader.Tick",
  "Fader.Value",
  "NumberBox.Root",
  "NumberBox.Label",
  "NumberBox.Field",
  "NumberBox.Segments",
  "NumberBox.Segment",
  "Meter.Root",
  "Meter.Label",
  "Meter.Track",
  "Meter.Bar",
  "Meter.Peak",
  "Meter.Clip",
  "Toggle",
  "ToggleGroup",
  "Timeline.Root",
  "Timeline.Playhead",
  "Timeline.Ruler",
  "Timeline.Grid",
  "Region.Root",
  "Region.Header",
  "Region.Label",
  "Region.Content",
  "Waveform.Root",
  "Waveform.Shape",
  "Waveform.Progress",
] as const;

const SHARED = ["className", "style", "render"];

export type ApiProp = {
  name: string;
  /** The type, short enough for a table cell. */
  type: string;
  /** The full type, when `type` is shortened. */
  fullType?: string;
  description: string;
  default?: string;
  required: boolean;
};

/** A type from the native TypeScript API (`typescript/unstable/sync`), as far as this script uses it. */
type NativeType = { isUnionType(): boolean; getTypes(): NativeType[] };

/**
 * The members of a type, with unions expanded through aliases, so that a
 * prop typed `Orientation` reads `"vertical" | "horizontal"`. `true | false`
 * becomes `boolean`, and `undefined` (every optional prop has it) is left out.
 */
function members(type: NativeType, print: (type: NativeType) => string): string[] {
  const out = type.isUnionType() ? type.getTypes().flatMap((member) => members(member, print)) : [print(type)];
  const unique = [...new Set(out)].filter((member) => member !== "undefined");
  if (unique.includes("true") && unique.includes("false")) {
    return ["boolean", ...unique.filter((member) => member !== "true" && member !== "false")];
  }
  return unique;
}

/** Splits a printed union at its top level: `A | (B | C)` into `A` and `(B | C)`. */
function splitUnion(printed: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < printed.length; index++) {
    const char = printed[index]!;
    if ("(<[{".includes(char)) depth++;
    else if (")>]}".includes(char) && printed[index - 1] !== "=") depth--;
    else if (char === "|" && depth === 0) {
      out.push(printed.slice(start, index).trim());
      start = index + 1;
    }
  }
  out.push(printed.slice(start).trim());
  // A parenthesized member, such as a function in a union, loses its parentheses; `describe` adds them back.
  return out.map((member) => (member.startsWith("(") && member.endsWith(")") && splitUnion(member.slice(1, -1)).length === 1 ? member.slice(1, -1) : member));
}

const isFunction = (member: string) => member.startsWith("(") && member.includes("=>");
const shortName = (member: string) =>
  isFunction(member) ? "function" : member.startsWith("React.ReactElement") ? "ReactElement" : member.length > 20 ? "object" : member;

/** The full type, and a short one for the table: functions read `function`, long object types `object`. */
function describe(list: string[]): { full: string; short: string } {
  const full = list.map((member) => (isFunction(member) ? `(${member})` : member)).join(" | ");
  let short = list.map((member) => (isFunction(member) ? "function" : member)).join(" | ");
  if (short.length > 48) short = [...new Set(list.map(shortName))].join(" | ");
  return { full, short };
}

const exportName = (part: string) => part.replace(".", "_");
const content = [
  `import type { Fader, Knob, Meter, NumberBox, Region, Timeline, Toggle, ToggleGroup, Waveform } from "@addstack/daw-ui/react";`,
  ...PARTS.map((part) => `export type ${exportName(part)} = ${part}.Props;`),
].join("\n");

const generator = createGenerator({ tsconfigPath: path.join(root, "tsconfig.json") });
const api: Record<string, ApiProp[]> = {};

for (const part of PARTS) {
  const fromLibrary = new Set<string>();
  const types = new Map<string, { full: string; short: string }>();
  const [doc] = await generator.generateDocumentation(
    { path: path.join(root, "scripts/__api.ts"), content },
    exportName(part),
    {
      transform(entry, type, symbol) {
        // Keep props the library declares, not the ones from @types/react. Some
        // names are declared by both, e.g. `radius` and `from` on SVG elements.
        const declaredByLibrary = symbol.declarations.some((declaration) => {
          let node = declaration.resolve(this.program) as { parent?: unknown; fileName?: string } | undefined;
          while (node?.parent) node = node.parent as typeof node;
          const file = node?.fileName ?? "";
          return file.startsWith(library) && !file.includes("node_modules");
        });
        if (!declaredByLibrary) return;
        fromLibrary.add(entry.name);
        const print = (member: NativeType) => this.checker.typeToString(member as never, this.declaration);
        // React's ReactNode is a union of nine types; it reads better by its name.
        const whole = print(type as unknown as NativeType);
        const list = whole.includes("ReactNode")
          ? splitUnion(whole).filter((member) => member !== "undefined")
          : members(type as unknown as NativeType, print);
        types.set(entry.name, describe(list));
      },
    },
  );
  if (!doc) throw new Error(`No type found for ${part}.`);

  const props = doc.entries
    .filter((entry) => fromLibrary.has(entry.name))
    // Plain `children` needs no row; a part whose children are special documents them.
    .filter((entry) => !(entry.name === "children" && !entry.description))
    .map((entry): ApiProp => {
      const { full, short } = types.get(entry.name)!;
      const prop: ApiProp = { name: entry.name, type: short, description: entry.description, required: entry.required };
      if (short !== full) prop.fullType = full;
      const fallback = entry.tags.find((tag) => tag.name === "default")?.text;
      if (fallback) prop.default = fallback;
      return prop;
    });
  props.sort((a, b) => Number(SHARED.includes(a.name)) - Number(SHARED.includes(b.name)));
  api[part] = props;
}

await mkdir(path.join(root, "generated"), { recursive: true });
await writeFile(path.join(root, "generated/api.json"), `${JSON.stringify(api, null, 2)}\n`);
console.log(`Generated props for ${PARTS.length} parts.`);
process.exit(0);
