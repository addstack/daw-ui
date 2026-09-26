import { createGetUrl } from 'fumadocs-core/source';

export const appName = 'daw-ui';
export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';

export const gitConfig = {
  user: 'addstack',
  repo: 'daw-ui',
  branch: 'main',
};

/** Where the site is served from: `/daw-ui` on GitHub Pages, empty locally. */
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** The playground is a separate Vite app, published next to the docs. */
export const playgroundUrl = `${basePath}/playground/`;

const getContentUrl = createGetUrl(docsContentRoute);

export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'content.md'];

  return { segments, url: getContentUrl(segments, page.locale) };
}

const getImageUrl = createGetUrl(docsImageRoute);

export function getPageImageUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'image.png'];

  return { segments, url: getImageUrl(segments, page.locale) };
}
