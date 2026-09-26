import path from "node:path";

import { createMDX } from "fumadocs-mdx/next";

// GitHub Pages serves the site under /daw-ui; locally it runs at the root.
const basePath = process.env.PAGES_BASE_PATH ?? "";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: "export",
  reactStrictMode: true,
  basePath,
  // Every page becomes a folder with an index.html, which static hosts serve without rewrites.
  trailingSlash: true,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  // The docs import the built library from ../dist (run `npm run build` first), as users do.
  turbopack: { root: path.join(import.meta.dirname, "..") },
  outputFileTracingRoot: path.join(import.meta.dirname, ".."),
  // The repository's own CLAUDE.md covers the docs; `next dev` should not write agent files into website/.
  agentRules: false,
};

export default withMDX(config);
