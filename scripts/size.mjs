// Bundle size budgets: what an application adds when it imports everything,
// and when it imports only some components, minified and gzipped, with React
// left out. The second kind checks that what an application does not import
// is left out of its bundle. Fails over a budget.
import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

import { build } from "vite";

// An entry that imports only `names` from the React binding, as an application would.
const CACHE = "node_modules/.cache/size";
function only(names) {
  mkdirSync(CACHE, { recursive: true });
  const file = `${CACHE}/${names.join("-")}.ts`;
  writeFileSync(file, `export { ${names.join(", ")} } from "../../../src/react/index.ts";\n`);
  return file;
}

// About 10% above the current size: growth is a decision, taken by raising the budget in the same change.
const BUDGETS = {
  "@addstack/daw-ui": { entry: "src/core/index.ts", limit: 7_300 },
  "@addstack/daw-ui/react": { entry: "src/react/index.ts", limit: 34_000 },
  "a knob alone": { entry: only(["Knob"]), limit: 8_600 },
  "an XY pad alone": { entry: only(["XYPad"]), limit: 6_200 },
  "a keyboard alone": { entry: only(["Keys"]), limit: 5_300 },
  "a timeline with regions and waveforms": { entry: only(["Timeline", "Region", "Waveform"]), limit: 8_600 },
  "an editable curve": { entry: only(["Curve", "useCurveEditing"]), limit: 13_500 },
};

let failed = false;
const rows = [];
for (const [name, { entry, limit }] of Object.entries(BUDGETS)) {
  const output = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: true,
      lib: { entry, formats: ["es"], fileName: "bundle" },
      rollupOptions: {
        external: ["react", "react-dom", "react/jsx-runtime"],
        onwarn(warning, warn) {
          if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
        },
      },
    },
  });
  const chunks = (Array.isArray(output) ? output : [output]).flatMap((result) => result.output);
  const code = chunks.filter((chunk) => chunk.type === "chunk").map((chunk) => chunk.code).join("\n");
  const gzip = gzipSync(code, { level: 9 }).length;
  const ok = gzip <= limit;
  failed ||= !ok;
  const label = name.startsWith("@") ? `\`${name}\`` : name;
  rows.push(`| ${label} | ${(gzip / 1000).toFixed(2)} kB | ${(limit / 1000).toFixed(2)} kB | ${ok ? "✅" : "❌"} |`);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${gzip} B gzip (budget ${limit} B)`);
}

mkdirSync("perf-results", { recursive: true });
writeFileSync(
  "perf-results/size.md",
  ["### Bundle size (minified + gzip, React excluded)", "", "| Entry | Size | Budget | |", "| --- | --: | --: | --- |", ...rows, ""].join(
    "\n",
  ),
);
if (failed) process.exit(1);
