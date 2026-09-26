Read [docs/principles.md](docs/principles.md) before changing or adding components: headless Base UI-style parts, accessibility, no hard-coded English, and measured performance are requirements. [docs/specification.md](docs/specification.md) is the normative description of behaviour.

Commits follow Conventional Commits; PRs are squash-merged and semantic-release reads the PR title.

The documentation site is in `website/` (Next.js with Fumadocs, deployed to GitHub Pages with the playground). Its props tables are generated from the library's types by `website/scripts/generate-api.mts`: document props with JSDoc and `@default` tags in `src/`, and when adding a part, add it to `PARTS` there and to its page in `website/content/docs/`. Demos in `website/components/demos/` are shown with their source as the code tab.
