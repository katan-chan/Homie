import { build } from 'esbuild';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

// One bundle guarantees a single Yjs instance across the editor and persistence.
export async function buildNotes() {
  const outfile = resolve(root, 'assets/vendor/notes.js');
  const result = await build({
    absWorkingDir: root,
    stdin: {
      contents: `
        export { Editor, Extension } from '@tiptap/core';
        export { Document } from '@tiptap/extension-document';
        export { Paragraph } from '@tiptap/extension-paragraph';
        export { Text } from '@tiptap/extension-text';
        export { Bold } from '@tiptap/extension-bold';
        export { Italic } from '@tiptap/extension-italic';
        export { Underline } from '@tiptap/extension-underline';
        export { TextStyle, Color } from '@tiptap/extension-text-style';
        export { BulletList, OrderedList, ListItem, ListKeymap, TaskList, TaskItem } from '@tiptap/extension-list';
        export { Collaboration } from '@tiptap/extension-collaboration';
        export { CollaborationCaret } from '@tiptap/extension-collaboration-caret';
        export * as Y from 'yjs';
        export { IndexeddbPersistence } from 'y-indexeddb';
        export { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
        export { ySyncPluginKey, yUndoPluginKey } from '@tiptap/y-tiptap';
      `,
      resolveDir: root,
      sourcefile: 'notes-vendor-entry.js',
      loader: 'js',
    },
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    minify: true,
    legalComments: 'inline',
    metafile: true,
  });
  // MIT requires the full notices; some packages have no preservable JS comments.
  const packages = [...new Set(Object.keys(result.metafile.inputs)
    .map(input => input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)/)?.[1])
    .filter(Boolean))].sort();
  const notices = await Promise.all(packages.map(async path => {
    const directory = resolve(root, path);
    const metadata = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
    const license = (await readdir(directory)).find(name => /^licen[sc]e(?:\..*)?$/i.test(name));
    if (!license) throw new Error(`Missing license notice for ${metadata.name}`);
    return `${metadata.name}@${metadata.version}\n${await readFile(resolve(directory, license), 'utf8')}`;
  }));
  await writeFile(resolve(root, 'assets/vendor/notes.LICENSES.txt'), notices.join('\n\n---\n\n'));
  console.log(`Notes vendor built: ${outfile} (${(await stat(outfile)).size} bytes)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildNotes();
}
