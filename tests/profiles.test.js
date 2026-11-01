import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProfiles, validateAvatar } from '../backend/profiles.js';

const legacy = () => ({
  minhle: { id: 'minhle', displayName: 'Minh', bio: '' },
  haiyen: { id: 'haiyen', displayName: 'Yến', bio: 'hi' },
});

function fakeRemote(saved) {
  let doc = saved === undefined ? null : structuredClone(saved);
  return {
    get doc() { return doc; },
    async getDocument() { return doc === null ? null : structuredClone(doc); },
    async putDocument(name, value) { doc = structuredClone(value); },
  };
}

async function profilesWith(t, saved) {
  const dir = await mkdtemp(join(tmpdir(), 'homie-profiles-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const remote = fakeRemote(saved);
  return { profiles: createProfiles(dir, remote), remote };
}

test('legacy profiles load', async t => {
  const { profiles } = await profilesWith(t, legacy());
  assert.deepEqual(await profiles.get('minhle'), { id: 'minhle', displayName: 'Minh', bio: '' });
});

test('setAvatar then text PUT keeps avatar', async t => {
  const { profiles, remote } = await profilesWith(t, legacy());
  await profiles.setAvatar('minhle', { version: 1, mime: 'image/webp' });
  const next = await profiles.update('minhle', { displayName: 'Minh Lê', bio: 'hi' });
  assert.deepEqual(next, { id: 'minhle', displayName: 'Minh Lê', bio: 'hi', avatar: { version: 1, mime: 'image/webp' } });
  assert.deepEqual(remote.doc.minhle.avatar, { version: 1, mime: 'image/webp' });
});

test('stored avatar survives a reload', async t => {
  const saved = legacy();
  saved.minhle.avatar = { version: 3, mime: 'image/jpeg' };
  const { profiles } = await profilesWith(t, saved);
  assert.deepEqual((await profiles.get('minhle')).avatar, { version: 3, mime: 'image/jpeg' });
});

test('setAvatar(null) removes the field', async t => {
  const { profiles } = await profilesWith(t, legacy());
  await profiles.setAvatar('minhle', { version: 1, mime: 'image/webp' });
  assert.equal('avatar' in await profiles.setAvatar('minhle', null), false);
  assert.equal('avatar' in await profiles.get('minhle'), false);
});

test('stored avatar with extra keys is rejected', async t => {
  const saved = legacy();
  saved.minhle.avatar = { version: 1, mime: 'image/webp', url: 'x' };
  const { profiles } = await profilesWith(t, saved);
  await assert.rejects(profiles.get('minhle'), /Profile storage is unavailable/);
});

test('validateAvatar', () => {
  assert.equal(validateAvatar({ version: 0, mime: 'image/webp' }), null);
  assert.equal(validateAvatar({ version: 1.5, mime: 'image/webp' }), null);
  assert.equal(validateAvatar({ version: 1, mime: 'image/png' }), null);
  assert.equal(validateAvatar(null), null);
  assert.deepEqual(validateAvatar({ version: 2, mime: 'image/jpeg' }), { version: 2, mime: 'image/jpeg' });
});
