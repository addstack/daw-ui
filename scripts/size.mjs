// Bundle size budget: what an application adds when it imports everything,
// minified and gzipped, with React left out. Fails over the budget.
import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

import { build } from "vite";

// About 10% above the current size: growth is a decision, taken by raising the budget in the same change.
const BUDGETS = {
  "@addstack/daw-ui": { entry: "src/core/index.ts", limit: 6_700 },
  "@addstack/daw-ui/react": { entry: "src/react/index.ts", limit: 30_500 },
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
  rows.push(`| \`${name}\` | ${(gzip / 1000).toFixed(2)} kB | ${(limit / 1000).toFixed(2)} kB | ${ok ? "✅" : "❌"} |`);
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
