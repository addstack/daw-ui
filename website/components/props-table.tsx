import { TypeTable, type TypeNode } from 'fumadocs-ui/components/type-table';
import type { ReactNode } from 'react';

import api from '@/generated/api.json';

type Part = keyof typeof api;

/** One row, as scripts/generate-api.mts writes it. */
type ApiProp = { name: string; type: string; fullType?: string; description: string; default?: string; required: boolean };

const tables: Record<Part, ApiProp[]> = api;

/** Renders `code` spans of a doc comment as code. */
function inline(text: string): ReactNode {
  return text.split(/(`[^`]+`)/).map((chunk, index) =>
    chunk.startsWith('`') && chunk.endsWith('`') ? <code key={index}>{chunk.slice(1, -1)}</code> : chunk,
  );
}

/**
 * The props of a part, generated from the library's types by
 * scripts/generate-api.mts: only the props the library declares, not the
 * ones of the element the part renders.
 */
export function PropsTable({ part }: { part: Part }) {
  const type: Record<string, TypeNode> = {};
  for (const prop of tables[part]) {
    type[prop.name] = {
      type: <code>{prop.type}</code>,
      typeDescription: prop.fullType ? <code>{prop.fullType}</code> : undefined,
      description: prop.description ? inline(prop.description) : undefined,
      default: prop.default ? <code>{prop.default}</code> : undefined,
      required: prop.required,
    };
  }
  return <TypeTable type={type} />;
}
