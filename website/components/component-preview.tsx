import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { ServerCodeBlock } from 'fumadocs-ui/components/codeblock.rsc';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';

import { demos, type DemoName } from '@/components/demos';

/** A live demo, and its source file as the code tab, so the code shown is the code that runs. */
export async function ComponentPreview({ name }: { name: DemoName }) {
  const Demo = demos[name];
  const code = await readFile(path.join(process.cwd(), 'components/demos', `${name}.tsx`), 'utf8');
  return (
    <Tabs items={['Preview', 'Code']} className="not-prose">
      <Tab value="Preview" className="p-0">
        <div className="flex min-h-64 flex-wrap items-center justify-center-safe gap-10 overflow-x-auto p-10">
          <Demo />
        </div>
      </Tab>
      <Tab value="Code">
        <ServerCodeBlock code={code.trim()} lang="tsx" />
      </Tab>
    </Tabs>
  );
}
