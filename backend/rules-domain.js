// Nội quy: pure state machine over the `rules` document. No I/O; the API wraps it in a doc-store update.
export const MEMBERS = Object.freeze(['minhle', 'haiyen']);
export const LIMITS = Object.freeze({ title: 120, text: 3000, reason: 500, rules: 200, revisions: 200 });

export function rulesError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

export const emptyRules = () => ({ rules: [] });

const LABELS = { title: 'tiêu đề', text: 'nội dung', reason: 'lý do' };
function cleanText(value, field, required) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw rulesError(400, 'invalid_' + field, `Phần ${LABELS[field]} phải là chữ.`);
  const trimmed = value.trim();
  if (required && !trimmed) throw rulesError(400, 'invalid_' + field, `Cần nhập ${LABELS[field]}.`);
  if ([...trimmed].length > LIMITS[field]) throw rulesError(400, 'invalid_' + field, `Phần ${LABELS[field]} dài quá ${LIMITS[field]} ký tự.`);
  return trimmed;
}
function requireMember(actor) {
  if (!MEMBERS.includes(actor)) throw rulesError(401, 'unauthenticated', 'Cần đăng nhập.');
}
function findRule(doc, ruleId) {
  const rule = doc.rules.find(item => item.id === ruleId);
  if (!rule) throw rulesError(404, 'not_found', 'Không tìm thấy nội quy.');
  return rule;
}
// Every edit names the version it was based on; a stale client gets 409 and keeps its draft.
function writable(doc, actor, ruleId, version) {
  requireMember(actor);
  const rule = findRule(doc, ruleId);
  if (!Number.isInteger(version)) throw rulesError(400, 'invalid_version', 'Thiếu version.');
  if (version !== rule.version) throw rulesError(409, 'version_conflict', 'Nội quy vừa được thay đổi ở nơi khác.');
  if (rule.archivedAt) throw rulesError(409, 'archived', 'Nội quy đã được lưu trữ.');
  return rule;
}
function revision(rule, actor, input, now, withReason) {
  if (rule.revisions.length >= LIMITS.revisions) throw rulesError(409, 'too_many_revisions', 'Nội quy này có quá nhiều bản sửa.');
  const n = rule.revisions.length + 1;
  rule.revisions.push({
    n,
    title: cleanText(input?.title, 'title', true),
    text: cleanText(input?.text, 'text', true),
    reason: withReason ? cleanText(input?.reason, 'reason', false) : '',
    byId: actor,
    at: now,
  });
  // A new proposal replaces a pending one; the proposer counts as agreeing.
  rule.proposedN = n;
  rule.agreements[n] = [actor];
  return n;
}

export function proposeRule(doc, actor, input, { id, now }) {
  requireMember(actor);
  if (doc.rules.length >= LIMITS.rules) throw rulesError(409, 'too_many_rules', 'Đã có quá nhiều nội quy.');
  const rule = { id, revisions: [], activeN: null, proposedN: null, agreements: {}, archiveRequestBy: null, archivedAt: null, version: 1 };
  revision(rule, actor, input, now, false);
  doc.rules.push(rule);
  return rule;
}

export function proposeRevision(doc, actor, ruleId, input, { now }) {
  const rule = writable(doc, actor, ruleId, input?.version);
  revision(rule, actor, input, now, true);
  // Changing the wording withdraws an open archive request (as in the approved prototype).
  rule.archiveRequestBy = null;
  rule.version++;
  return rule;
}

export function agree(doc, actor, ruleId, input) {
  const rule = writable(doc, actor, ruleId, input?.version);
  if (!Number.isInteger(input?.n) || input.n !== rule.proposedN) throw rulesError(409, 'stale_revision', 'Bản này không còn là đề xuất đang chờ.');
  const agreed = rule.agreements[input.n];
  if (!agreed.includes(actor)) agreed.push(actor);
  if (MEMBERS.every(member => agreed.includes(member))) {
    rule.activeN = input.n;
    rule.proposedN = null;
  }
  rule.version++;
  return rule;
}

export function requestArchive(doc, actor, ruleId, input) {
  const rule = writable(doc, actor, ruleId, input?.version);
  if (rule.archiveRequestBy) throw rulesError(409, 'archive_pending', 'Đã có đề nghị lưu trữ.');
  rule.archiveRequestBy = actor;
  rule.version++;
  return rule;
}

export function confirmArchive(doc, actor, ruleId, input, { now }) {
  const rule = writable(doc, actor, ruleId, input?.version);
  if (!rule.archiveRequestBy) throw rulesError(409, 'archive_not_requested', 'Chưa có ai đề nghị lưu trữ.');
  if (rule.archiveRequestBy === actor) throw rulesError(403, 'needs_partner', 'Người còn lại cần xác nhận lưu trữ.');
  rule.archivedAt = now;
  rule.version++;
  return rule;
}

// Either member may withdraw or decline an open archive request.
export function cancelArchive(doc, actor, ruleId, input) {
  const rule = writable(doc, actor, ruleId, input?.version);
  if (!rule.archiveRequestBy) throw rulesError(409, 'archive_not_requested', 'Chưa có ai đề nghị lưu trữ.');
  rule.archiveRequestBy = null;
  rule.version++;
  return rule;
}

// Shape check for documents read from storage, so a corrupt file fails loudly instead of half-working.
export function validateRulesDoc(doc) {
  const ok = doc && Array.isArray(doc.rules) && doc.rules.every(rule => rule && typeof rule.id === 'string'
    && Array.isArray(rule.revisions) && rule.agreements && typeof rule.agreements === 'object' && Number.isInteger(rule.version));
  if (!ok) throw rulesError(500, 'corrupt_rules', 'Dữ liệu nội quy bị hỏng.');
  return doc;
}
