import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyRules, proposeRule, proposeRevision, agree, requestArchive, confirmArchive, cancelArchive, validateRulesDoc, LIMITS } from '../backend/rules-domain.js';

const now = '2026-10-06T03:00:00.000Z';
const fails = (fn, status, code) => assert.throws(fn, error => error.status === status && error.code === code);
function setup() {
  const doc = emptyRules();
  const rule = proposeRule(doc, 'minhle', { title: ' Nói ra khi buồn ', text: 'Nói trong ngày.' }, { id: 'r1', now });
  return { doc, rule };
}

test('a new rule waits for the partner; the proposer already counts as agreeing', () => {
  const { doc, rule } = setup();
  assert.equal(rule.title, undefined);
  assert.deepEqual(rule.revisions[0], { n: 1, title: 'Nói ra khi buồn', text: 'Nói trong ngày.', reason: '', byId: 'minhle', at: now });
  assert.equal(rule.activeN, null);
  assert.equal(rule.proposedN, 1);
  assert.deepEqual(rule.agreements[1], ['minhle']);
  // Agreeing again as the proposer cannot count as two people.
  agree(doc, 'minhle', 'r1', { n: 1, version: 1 });
  assert.equal(rule.activeN, null);
  assert.deepEqual(rule.agreements[1], ['minhle']);
  agree(doc, 'haiyen', 'r1', { n: 1, version: 2 });
  assert.equal(rule.activeN, 1);
  assert.equal(rule.proposedN, null);
  assert.equal(rule.version, 3);
});

test('the active revision stays until both agree; a newer proposal replaces a pending one', () => {
  const { doc, rule } = setup();
  agree(doc, 'haiyen', 'r1', { n: 1, version: 1 });
  proposeRevision(doc, 'haiyen', 'r1', { title: 'Nói ra khi buồn', text: 'Bản 2', reason: 'Rõ hơn', version: 2 }, { now });
  assert.equal(rule.activeN, 1);
  assert.equal(rule.proposedN, 2);
  assert.deepEqual(rule.agreements[2], ['haiyen']);
  proposeRevision(doc, 'minhle', 'r1', { title: 'Mới', text: 'Bản 3', version: 3 }, { now });
  assert.equal(rule.activeN, 1);
  assert.equal(rule.proposedN, 3);
  assert.deepEqual(rule.agreements[3], ['minhle']);
  // Agreeing to the superseded proposal is refused even with a fresh version.
  fails(() => agree(doc, 'minhle', 'r1', { n: 2, version: 4 }), 409, 'stale_revision');
  agree(doc, 'haiyen', 'r1', { n: 3, version: 4 });
  assert.equal(rule.activeN, 3);
  assert.deepEqual(rule.revisions.map(item => item.text), ['Nói trong ngày.', 'Bản 2', 'Bản 3']);
});

test('every edit checks version and validates input', () => {
  const { doc, rule } = setup();
  fails(() => agree(doc, 'haiyen', 'r1', { n: 1, version: 0 }), 409, 'version_conflict');
  fails(() => agree(doc, 'haiyen', 'r1', { n: 1 }), 400, 'invalid_version');
  fails(() => proposeRevision(doc, 'haiyen', 'r1', { title: 'x', text: 'y', version: 7 }, { now }), 409, 'version_conflict');
  fails(() => proposeRevision(doc, 'haiyen', 'r1', { title: ' ', text: 'y', version: 1 }, { now }), 400, 'invalid_title');
  fails(() => proposeRevision(doc, 'haiyen', 'r1', { title: 'x', text: 'y'.repeat(LIMITS.text + 1), version: 1 }, { now }), 400, 'invalid_text');
  fails(() => proposeRevision(doc, 'haiyen', 'r1', { title: 'x', text: 'y', reason: 5, version: 1 }, { now }), 400, 'invalid_reason');
  fails(() => proposeRule(doc, 'minhle', { title: 'x'.repeat(LIMITS.title + 1), text: 'y' }, { id: 'r2', now }), 400, 'invalid_title');
  // Emoji count as one character, matching the form counter.
  proposeRule(doc, 'minhle', { title: '💗'.repeat(LIMITS.title), text: 'y' }, { id: 'r2', now });
  fails(() => agree(doc, 'guest', 'r1', { n: 1, version: 1 }), 401, 'unauthenticated');
  fails(() => agree(doc, 'haiyen', 'nope', { n: 1, version: 1 }), 404, 'not_found');
  assert.equal(rule.version, 1);
  assert.equal(rule.revisions.length, 1);
});

test('archive needs a request from one member and confirmation by the other', () => {
  const { doc, rule } = setup();
  requestArchive(doc, 'minhle', 'r1', { version: 1 });
  assert.equal(rule.archiveRequestBy, 'minhle');
  assert.equal(rule.archivedAt, null);
  fails(() => requestArchive(doc, 'haiyen', 'r1', { version: 2 }), 409, 'archive_pending');
  fails(() => confirmArchive(doc, 'minhle', 'r1', { version: 2 }, { now }), 403, 'needs_partner');
  cancelArchive(doc, 'haiyen', 'r1', { version: 2 });
  assert.equal(rule.archiveRequestBy, null);
  fails(() => confirmArchive(doc, 'haiyen', 'r1', { version: 3 }, { now }), 409, 'archive_not_requested');
  requestArchive(doc, 'haiyen', 'r1', { version: 3 });
  confirmArchive(doc, 'minhle', 'r1', { version: 4 }, { now });
  assert.equal(rule.archivedAt, now);
  fails(() => proposeRevision(doc, 'minhle', 'r1', { title: 'x', text: 'y', version: 5 }, { now }), 409, 'archived');
});

test('proposing a revision withdraws an open archive request', () => {
  const { doc, rule } = setup();
  requestArchive(doc, 'haiyen', 'r1', { version: 1 });
  proposeRevision(doc, 'minhle', 'r1', { title: 'x', text: 'y', version: 2 }, { now });
  assert.equal(rule.archiveRequestBy, null);
});

test('stored documents are shape-checked', () => {
  assert.deepEqual(validateRulesDoc(emptyRules()), { rules: [] });
  assert.throws(() => validateRulesDoc({ rules: [{ id: 1 }] }), error => error.code === 'corrupt_rules');
  assert.throws(() => validateRulesDoc(null), error => error.code === 'corrupt_rules');
});
