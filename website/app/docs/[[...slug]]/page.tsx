import { source } from '@/lib/source';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from 'fumadocs-ui/layouts/docs/page';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/components/mdx';
import type { Metadata } from 'next';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { getPageImageUrl, getPageMarkdownUrl, gitConfig } from '@/lib/shared';
import type { ComponentProps } from 'react';

const repository = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

/**
 * Links in the documents included from docs/ point at files of the
 * repository: the two documents become pages, everything else goes to GitHub.
 */
function repositoryHref(href: string | undefined): string | undefined {
  if (!href || /^[a-z]+:|^#|^\//.test(href)) return href;
  const [target = '', hash] = href.split('#');
  const page = { './principles.md': '/docs/principles', './specification.md': '/docs/specification' }[target];
  if (page) return hash ? `${page}#${hash}` : page;
  return `${repository}/tree/${gitConfig.branch}/${target.replace(/^(\.\.\/)+/, '')}`;
}

export default async function Page(props: PageProps<'/docs/[[...slug]]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const markdownUrl = getPageMarkdownUrl(page).url;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      {!page.data.hideTitle && <DocsTitle>{page.data.title}</DocsTitle>}
      {!page.data.hideTitle && <DocsDescription className="mb-0">{page.data.description}</DocsDescription>}
      <div className="flex flex-row gap-2 items-center border-b pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover
          markdownUrl={markdownUrl}
          githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/website/content/docs/${page.path}`}
        />
      </div>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            // Relative links between pages, and links in the documents included from docs/.
            a: page.data.hideTitle ? RepositoryLink : createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<'/docs/[[...slug]]'>): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      // Metadata URLs are not prefixed with the base path.
      images: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}${getPageImageUrl(page).url}`,
    },
  };
}

function RepositoryLink({ href, ref: _ref, ...props }: ComponentProps<'a'>) {
  const target = repositoryHref(href);
  if (target?.startsWith('/docs')) return <Link href={target} {...props} />;
  return <a href={target} {...props} />;
}
