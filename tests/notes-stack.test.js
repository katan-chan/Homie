import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { withBrowser } from './helpers/notes-browser.mjs';

const root = new URL('../', import.meta.url);

for (const scenario of ['missing executable', 'signal-terminated child']) {
  test(`browser startup cleanup is bounded for ${scenario}`, { timeout: 10000 }, async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'homie-browser-failure-'));
    const profiles = resolve(directory, 'profiles');
    const chrome = resolve(directory, 'chrome');
    try {
      // Real process failures exercise the same startup/cleanup path as Chrome.
      await mkdir(profiles);
      if (scenario === 'signal-terminated child') {
        await writeFile(chrome, '#!/bin/sh\nkill -TERM $$\n', { mode: 0o755 });
      }
      const result = spawnSync(process.execPath, ['--test-name-pattern=^local vendor',
        'tests/notes-stack.test.js'], { cwd: root, encoding: 'utf8', timeout: 4000,
        killSignal: 'SIGKILL',
        env: { ...process.env, CHROME_PATH: chrome, TMPDIR: profiles } });
      assert.equal(result.error, undefined, `Startup failure must finish promptly: ${result.error?.message}`);
      assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
      assert.match(result.stdout + result.stderr, scenario === 'missing executable' ? /ENOENT/ : /SIGTERM/);
      assert.deepEqual(await readdir(profiles), [], 'Failed startup must remove the temporary browser profile');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test('local vendor mounts real Vietnamese collaborative editors with per-origin undo and redo', { timeout: 45000 }, async () => {
  const built = spawnSync(process.execPath, ['scripts/build-notes.js'], { cwd: root, encoding: 'utf8' });
  assert.equal(built.status, 0, `Notes vendor build must succeed:\n${built.stdout}${built.stderr}`);
  const proof = await withBrowser(evaluate => evaluate(`(async () => {
    const v = await import('/assets/vendor/notes.js');
    const { Editor, Document, Paragraph, Text, Bold, Italic, Underline, TextStyle, Color,
      BulletList, OrderedList, ListItem, ListKeymap, TaskList, TaskItem,
      Collaboration, CollaborationCaret, Y, IndexeddbPersistence, Awareness,
      encodeAwarenessUpdate, applyAwarenessUpdate, yUndoPluginKey } = v;
    const a = new Y.Doc(), b = new Y.Doc();
    const awarenessA = new Awareness(a), awarenessB = new Awareness(b);
    const extensions = [Document, Paragraph, Text, Bold, Italic, Underline,
      TextStyle, Color, BulletList, OrderedList, ListItem, ListKeymap, TaskList,
      TaskItem.configure({ nested: true })];
    const mount = (doc, awareness, name) => {
      const element = document.createElement('div');
      document.body.append(element);
      return new Editor({ element, extensions: [...extensions,
        Collaboration.configure({ document: doc, field: 'body' }),
        CollaborationCaret.configure({ provider: { awareness }, user: { name, color: '#a43d62' } })] });
    };
    const editorA = mount(a, awarenessA, 'Minh Lê');
    const readyA = new Promise(resolve => editorA.on('create', resolve));
    editorA.commands.setContent('<p>Chào bạn</p>');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a), 'remote');
    const editorB = mount(b, awarenessB, 'Hải Yến');
    await Promise.all([readyA, new Promise(resolve => editorB.on('create', resolve))]);
    // Seed content is not part of either person's edit history.
    yUndoPluginKey.getState(editorA.state).undoManager.clear();
    yUndoPluginKey.getState(editorB.state).undoManager.clear();
    editorA.commands.insertContentAt(1, 'Minh: ');
    editorA.chain().setTextSelection({ from: 7, to: 11 }).setBold().setColor('#9a3456').run();
    editorB.commands.insertContentAt(editorB.state.doc.content.size - 1, ' – Hải Yến');
    editorB.chain().setTextSelection({ from: 1, to: 5 }).setItalic().setUnderline().run();
    editorB.view.focus();
    const sync = () => {
      const fromA = Y.encodeStateAsUpdate(a), fromB = Y.encodeStateAsUpdate(b);
      Y.applyUpdate(a, fromB, 'remote');
      Y.applyUpdate(b, fromA, 'remote');
    };
    sync();
    applyAwarenessUpdate(awarenessA, encodeAwarenessUpdate(awarenessB, [b.clientID]), 'remote');
    applyAwarenessUpdate(awarenessB, encodeAwarenessUpdate(awarenessA, [a.clientID]), 'remote');
    const converged = { a: editorA.getJSON(), b: editorB.getJSON(), text: editorA.getText() };
    const undoA = editorA.commands.undo(); sync();
    const afterUndoA = { a: editorA.getJSON(), b: editorB.getJSON(), text: editorA.getText() };
    const redoA = editorA.commands.redo(); sync();
    const afterRedoA = { a: editorA.getJSON(), b: editorB.getJSON(), text: editorA.getText() };
    const undoB = editorB.commands.undo(); sync();
    const afterUndoB = { a: editorA.getJSON(), b: editorB.getJSON(), text: editorA.getText() };
    const peerCaret = editorA.view.dom.querySelector('.collaboration-carets__label')?.textContent;
    const listEditor = new Editor({ element: document.createElement('div'), extensions,
      content: '<p>Việc cần làm</p>' });
    listEditor.commands.toggleBulletList(); const bullet = listEditor.getJSON();
    listEditor.commands.toggleOrderedList(); const ordered = listEditor.getJSON();
    listEditor.commands.toggleTaskList(); const checklist = listEditor.getJSON();
    const database = 'homie-stack-' + crypto.randomUUID();
    const offline = new Y.Doc();
    const persistence = new IndexeddbPersistence(database, offline);
    await persistence.whenSynced;
    offline.getText('draft').insert(0, 'Bản nháp tiếng Việt');
    await persistence.destroy(); offline.destroy();
    const restored = new Y.Doc();
    const reload = new IndexeddbPersistence(database, restored);
    await reload.whenSynced;
    const draft = restored.getText('draft').toString();
    await reload.clearData(); await reload.destroy(); restored.destroy();
    listEditor.destroy(); editorA.destroy(); editorB.destroy();
    awarenessA.destroy(); awarenessB.destroy(); a.destroy(); b.destroy();
    return { converged, undoA, afterUndoA, redoA, afterRedoA, undoB, afterUndoB,
      peerCaret, bullet, ordered, checklist, draft, exports: Object.keys(v) };
  })()`));
  assert.equal(proof.converged.text, 'Minh: Chào bạn – Hải Yến');
  assert.deepEqual(proof.converged.a, proof.converged.b);
  const seed = proof.converged.a.content[0].content.find(node => node.text === 'Chào');
  assert.deepEqual(seed.marks.map(mark => mark.type).sort(), ['bold', 'italic', 'textStyle', 'underline']);
  assert.equal(seed.marks.find(mark => mark.type === 'textStyle').attrs.color, '#9a3456');
  assert.equal(proof.undoA, true);
  assert.equal(proof.afterUndoA.text, 'Chào bạn – Hải Yến');
  assert.deepEqual(proof.afterUndoA.a, proof.afterUndoA.b);
  assert.deepEqual(proof.afterUndoA.a.content[0].content[0].marks.map(mark => mark.type).sort(), ['italic', 'underline']);
  assert.equal(proof.redoA, true);
  assert.deepEqual(proof.afterRedoA.a, proof.converged.a);
  assert.deepEqual(proof.afterRedoA.a, proof.afterRedoA.b);
  assert.equal(proof.undoB, true);
  assert.equal(proof.afterUndoB.text, 'Minh: Chào bạn');
  assert.deepEqual(proof.afterUndoB.a, proof.afterUndoB.b);
  assert.deepEqual(proof.afterUndoB.a.content[0].content.find(node => node.text === 'Chào').marks.map(mark => mark.type).sort(), ['bold', 'textStyle']);
  assert.equal(proof.peerCaret, 'Hải Yến');
  assert.equal(proof.bullet.content[0].type, 'bulletList');
  assert.equal(proof.ordered.content[0].type, 'orderedList');
  assert.equal(proof.checklist.content[0].type, 'taskList');
  assert.equal(proof.checklist.content[0].content[0].type, 'taskItem');
  assert.equal(proof.checklist.content[0].content[0].attrs.checked, false);
  assert.equal(proof.draft, 'Bản nháp tiếng Việt');
  for (const name of ['Editor', 'Extension', 'Y', 'IndexeddbPersistence', 'Collaboration',
    'CollaborationCaret', 'Awareness', 'removeAwarenessStates', 'ySyncPluginKey', 'yUndoPluginKey']) {
    assert.ok(proof.exports.includes(name), `Missing public vendor API: ${name}`);
  }
});

test('production build ships a locally importable editor bundle with its legal notices', { timeout: 45000 }, async () => {
  const built = spawnSync(process.execPath, ['scripts/build.js'], { cwd: root, encoding: 'utf8' });
  assert.equal(built.status, 0, `Production build must succeed:\n${built.stdout}${built.stderr}`);
  const dist = new URL('dist/', root);
  assert.deepEqual(await readFile(new URL('assets/vendor/notes.js', dist)),
    await readFile(new URL('assets/vendor/notes.js', root)));
  assert.ok((await readFile(new URL('assets/vendor/notes.LICENSES.txt', dist))).length > 0);
  const html = await withBrowser(evaluate => evaluate(`(async () => {
    const { Editor, Document, Paragraph, Text } = await import('/assets/vendor/notes.js');
    const editor = new Editor({ element: document.body,
      extensions: [Document, Paragraph, Text], content: '<p>Vườn của chúng mình</p>' });
    const result = editor.getHTML(); editor.destroy(); return result;
  })()`), dist);
  assert.equal(html, '<p>Vườn của chúng mình</p>');
});

// A hand-built PNG fixture keeps the alpha expectations independent of FFmpeg.
function alphaPng() {
  const crc32 = bytes => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(12); header.writeUInt32BE(8, 4); header[8] = 8; header[9] = 6;
  const row = Buffer.from([0, ...Array(4).fill([255, 0, 0, 255]).flat(),
    ...Array(4).fill([255, 0, 0, 128]).flat(), ...Array(4).fill([255, 0, 0, 0]).flat()]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array(8).fill(row)))),
    chunk('IEND', Buffer.alloc(0))]);
}

test('PNG converts to a static one-frame GIF and PNG poster with measured binary alpha', async () => {
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
  const directory = await mkdtemp(resolve(tmpdir(), 'homie-notes-media-'));
  const png = resolve(directory, 'source.png'), gif = resolve(directory, 'static.gif');
  const poster = resolve(directory, 'poster.png');
  const run = (binary, args, encoding = 'utf8') => {
    const result = spawnSync(binary, args, { encoding, timeout: 15000 });
    assert.equal(result.status, 0, `${binary} failed: ${result.error?.message || result.stderr}`);
    return result.stdout;
  };
  try {
    await writeFile(png, alphaPng());
    run(ffmpeg, ['-v', 'error', '-nostdin', '-i', png, '-filter_complex',
      '[0:v]split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=128',
      '-gifflags', '-offsetting', '-frames:v', '1', '-y', gif]);
    run(ffmpeg, ['-v', 'error', '-nostdin', '-i', gif, '-frames:v', '1', '-y', poster]);
    for (const [file, codec] of [[gif, 'gif'], [poster, 'png']]) {
      const metadata = JSON.parse(run(ffprobe, ['-v', 'error', '-count_frames', '-show_entries',
        'stream=codec_name,width,height,nb_read_frames', '-of', 'json', file])).streams[0];
      assert.equal(metadata.codec_name, codec);
      assert.equal(metadata.nb_read_frames, '1');
      assert.equal(metadata.width, 12); assert.equal(metadata.height, 8);
    }
    const alpha = file => [...run(ffmpeg, ['-v', 'error', '-nostdin', '-i', file, '-frames:v', '1',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], null)].filter((_, index) => index % 4 === 3);
    const original = Array(8).fill([...Array(4).fill(255), ...Array(4).fill(128), ...Array(4).fill(0)]).flat();
    const converted = Array(8).fill([...Array(8).fill(255), ...Array(4).fill(0)]).flat();
    assert.deepEqual(alpha(png), original);
    assert.deepEqual(alpha(gif), converted);
    assert.deepEqual(alpha(poster), converted);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
