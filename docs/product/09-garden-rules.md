# Garden Rules / Nội quy khu vườn

## English

### 1. Feature description

A future “Our Constitution” / “Garden Rules” space preserving both current agreements and how the partners learned to live together. It is a private product feature, not the developer instructions in root `AGENTS.md` or a permission to edit that file. Follow [shared conventions](README.md#proposed-engineering-conventions).

### 2. User experience / expected behavior

Propose a rule, read/discuss it, acknowledge a particular version, and later propose a revision. Example evolution: “Never sleep while angry” becomes “If we are too tired to resolve an argument, we tell each other that we still care, then continue the conversation tomorrow.” History preserves the lesson rather than erasing the older wording. Agreement is deliberate; opening a page is not agreement.

### 3. Functional requirements

MVP: create proposal, edit via new immutable revision, view active wording and history, acknowledge the exact revision, and propose/archive with explicit shared confirmation. Suggested title 120, rule text 3000, change note 500 characters. A proposed revision becomes active only after both fixed users explicitly agree to it. Previous active revision stays active until then. No silent edit to an already agreed rule. Plain text is sufficient; Markdown is optional later with safe rendering.

### 4. Architecture

Suggested `backend/rules.js`, `js/rules.js`: proposal input -> validation/version/author policy -> append revision + agreements -> authenticated API -> active/proposed/history UI -> optional [Calendar](04-relationship-calendar.md)/[Garden](10-garden-integration.md) reference. Native Node module with atomic updates; not a collaborative document engine. Internal Markdown or structured records are choices, but runtime relationship rules must not live in publicly built files or root `rules.md` committed with personal content.

### 5. Suggested data model

`Rule { id, createdBy, activeRevisionId?, proposedRevisionId?, status: proposed|active|archived, createdAt, archivedAt?, version }`.

`RuleRevision { id, ruleId, number, title, text, changeNote?, createdBy, createdAt }`; `Agreement { ruleId, revisionId, userId, agreedAt }`; proposed `ArchiveRequest { ruleId, requestedBy, confirmedBy?, requestedAt, confirmedAt? }`.

`agreedBy` is derived from Agreement records for that exact revision, not copied to every revision. Revisions are immutable; edits append. Only one current proposal is recommended for MVP, with version conflicts instead of branching histories. An initial proposal has no active revision until both agree.

### 6. Frontend responsibilities

Present “Hiến pháp của tụi mình” or “Nội quy khu vườn” after copy is chosen. Clearly distinguish current agreement, pending proposal, who has acknowledged it, and previous wording. Label revision/date/author; accessible comparison/history, explicit agree/archive-confirm buttons, errors and conflict drafts. No forced checkbox accepting all rules at login. Clean identity/requests on logout or view disposal.

### 7. Backend/API responsibilities

Proposed `GET/POST /api/rules`, `GET /api/rules/:id`, `GET /api/rules/:id/revisions`, `POST /api/rules/:id/revisions`, `POST /api/rules/:id/agree`, `POST /api/rules/:id/archive-request`, `POST /api/rules/:id/archive-confirm`.

Both members may propose revisions/read history; each may agree only as their own session user. Agree action names `revisionId`, expected rule `version`, `requestId`; stale/superseded proposal gives 409. Revision author may replace a pending proposal with a new revision, never mutate the old one; all acknowledgements reset for the new version. Both-member approval activates a revision atomically. Archive needs the other person's explicit confirmation by recommendation, not a forged `agreedBy` array. CSRF, validation, idempotency, immutable history and durable writes apply. Clarify withdrawn proposals and restore in later policy.

### 8. Important edge cases

One agrees while the other submits a revision: version checks prevent activating stale wording. Same-user repeated agrees cannot count as two people. Archive request does not immediately remove active wording. A failed revision write leaves active rule intact. An archived rule/history remains visible to authorized members; future hard deletion/export retention needs a separate decision. Never auto-create the example rule as data.

### 9. Privacy / permission considerations

Rules/history/agreements are private to the partners. Neither may impersonate the other's acknowledgement or change historical text. Calendar/Garden consume only explicitly selected shared milestones, not sensitive conflict wording. Do not expose private rules through repository files, public profiles, logs, or static assets.

**Open Design Decision:** immediate author activation is simpler but can turn one person's wish into a joint rule; bilateral revision agreement is slower but preserves intent. Recommend bilateral agreement. Creator-only archive is simple but asymmetric; bilateral confirmation protects a joint agreement but requires another action. Recommend bilateral archive. Confirm UI title, Markdown versus plain text and restore/withdrawal semantics before implementation.

### 10. TODO checklist

#### Phase 1 — Domain (MVP)

- [ ] Confirm activation/archive agreement policy, title and plain-text limits.
- [ ] Define Rule/Revision/Agreement schemas and pending/active transitions.

#### Phase 2 — Backend (MVP)

- [ ] Add immutable revision storage and create/read/history/propose routes.
- [ ] Add session-bound agreement, atomic activation/archive confirmation and conflict checks.

#### Phase 3 — Frontend (MVP)

- [ ] Build current/proposed/history views and explicit acknowledgement controls.
- [ ] Preserve failed/conflict drafts, keyboard focus and identity-safe cleanup.

#### Phase 4 — Integration

- [ ] Optionally expose approved revision milestones to Calendar, without duplicating text.
- [ ] Keep Garden rule descriptors opt-in and separate from enforcement.

#### Phase 5 — Tests / later

- [ ] Test immutable history, two distinct acknowledgements, stale revision and archive races.
- [ ] Later: withdrawal/restore policy, safe Markdown, comparison and JSON export.

### 11. Testing requirements

Node: initial/pending/active transitions, immutable revisions, forged agreements, same-user duplicate agreement, stale revision 409, proposal/agree races, bilateral archive, guest denial, failure/restart and exact version history. Browser: current-versus-proposed wording, history comparison, explicit agree and pending archive, keyboard/mobile, failed draft recovery and logout. Verify no feature modifies `AGENTS.md` or stores runtime rules in `dist/`.

### 12. Future extensions

Richer revision diff, withdrawn proposals, agreed restoration, safe Markdown, portable history export and carefully chosen milestones. No automated enforcement, relationship compliance score, or rule-derived penalties.

---

## Tiếng Việt

### 1. Mô tả tính năng

“Hiến pháp của tụi mình” / “Nội quy khu vườn” lưu cả thỏa thuận hiện tại và cách hai người học sống cùng nhau. Đây là tính năng riêng, không phải hướng dẫn developer trong `AGENTS.md` và không cấp quyền sửa file đó. Theo [quy ước chung](README.md#quy-ước-kỹ-thuật-được-đề-xuất).

### 2. Trải nghiệm / hành vi mong đợi

Đề xuất điều, đọc/bàn, xác nhận phiên bản cụ thể rồi đề xuất sửa khi cần. Ví dụ từ “Không bao giờ ngủ khi còn giận” thành “Nếu quá mệt để giải quyết, mình nói rằng vẫn quan tâm nhau rồi tiếp tục nói chuyện ngày mai”. History giữ bài học, không xóa wording cũ. Mở trang không có nghĩa đồng ý.

### 3. Yêu cầu chức năng

MVP: tạo đề xuất, sửa bằng revision mới bất biến, xem wording active/history, xác nhận đúng revision, đề xuất/archive có xác nhận chung rõ ràng. Title gợi ý 120, text 3000, change note 500 ký tự. Revision chỉ active sau cả hai user đồng ý rõ; bản active cũ giữ tới lúc đó. Không sửa âm thầm rule đã thống nhất. Chữ thuần đủ, Markdown an toàn để sau.

### 4. Kiến trúc

Gợi ý `backend/rules.js`, `js/rules.js`: input đề xuất -> validate/version/quyền -> thêm revision/agreements -> API riêng -> active/proposed/history -> tham chiếu [Lịch](04-relationship-calendar.md)/[Vườn](10-garden-integration.md) tùy chọn. Node native/write atomic, không document editor cộng tác tổng quát. Markdown hay record là lựa chọn nội bộ; rule runtime không nằm trong file public build hoặc root rules.md commit nội dung cá nhân.

### 5. Mô hình dữ liệu gợi ý

`Rule { id, createdBy, activeRevisionId?, proposedRevisionId?, status: proposed|active|archived, createdAt, archivedAt?, version }`.

`RuleRevision { id, ruleId, number, title, text, changeNote?, createdBy, createdAt }`; `Agreement { ruleId, revisionId, userId, agreedAt }`; đề xuất `ArchiveRequest { ruleId, requestedBy, confirmedBy?, requestedAt, confirmedAt? }`.

`agreedBy` suy ra đúng revision, không copy sang bản mới. Revision bất biến; sửa là append. Đề xuất MVP chỉ một proposal hiện tại, conflict thay vì nhánh history. Proposal đầu chưa có active tới khi cả hai đồng ý.

### 6. Trách nhiệm frontend

Chốt tên “Hiến pháp của tụi mình” hoặc “Nội quy khu vườn”. Phân biệt thỏa thuận active, proposal chờ, ai xác nhận, wording cũ. Nhãn version/ngày/tác giả, comparison/history accessible, nút đồng ý/xác nhận archive rõ, lỗi/conflict giữ nháp. Không buộc tick chấp nhận tất cả khi login. Logout/dispose dọn identity/request.

### 7. Trách nhiệm backend/API

Đề xuất `GET/POST /api/rules`, `GET /api/rules/:id`, `GET /api/rules/:id/revisions`, `POST /api/rules/:id/revisions`, `POST /api/rules/:id/agree`, `POST /api/rules/:id/archive-request`, `POST /api/rules/:id/archive-confirm`.

Cả hai đọc/history/đề xuất; mỗi người chỉ agree bằng session mình. Action agree có revision ID/version rule/request ID; proposal cũ/bị thay trả 409. Tác giả proposal có thể thay bằng revision mới, không mutate cũ; xác nhận reset ở bản mới. Cả hai duyệt thì active atomic. Đề xuất archive cần người kia xác nhận rõ, không array `agreedBy` client giả. CSRF/validate/chống lặp/history bất biến/write bền. Policy rút proposal/restore cần làm rõ sau.

### 8. Tình huống biên quan trọng

Một người agree lúc người kia sửa: version ngăn active wording cũ. Agree lặp cùng user không tính hai người. Archive request chưa bỏ active. Lưu revision lỗi giữ rule active. Rule archive/history còn cho thành viên đọc; hard delete/export retention cần quyết định riêng. Không tạo rule ví dụ vào dữ liệu.

### 9. Riêng tư / phân quyền

Rule/history/agreements chỉ hai người. Không giả xác nhận partner hoặc sửa chữ lịch sử. Lịch/Vườn chỉ nhận milestone được chọn, không wording xung đột nhạy cảm. Không lộ qua repo/profile/log/asset public.

**Open Design Decision / Quyết định thiết kế còn mở:** tác giả active ngay đơn giản nhưng biến mong muốn cá nhân thành rule chung; cả hai agree chậm hơn nhưng đúng ý. Đề xuất cả hai agree. Creator-only archive đơn giản nhưng lệch quyền; xác nhận cả hai bảo vệ thỏa thuận nhưng thêm bước. Đề xuất archive hai người. Chốt tên UI, Markdown/chữ thuần, restore/rút proposal trước code.

### 10. Checklist TODO

#### Giai đoạn 1 — Domain (MVP)

- [ ] Chốt policy active/archive, tên, giới hạn chữ thuần.
- [ ] Schema Rule/Revision/Agreement, transition pending/active.

#### Giai đoạn 2 — Backend (MVP)

- [ ] Lưu revision bất biến, create/read/history/propose.
- [ ] Agree theo session, active/archive atomic, conflict.

#### Giai đoạn 3 — Frontend (MVP)

- [ ] View active/proposed/history, control xác nhận rõ.
- [ ] Giữ nháp lỗi/conflict, focus bàn phím, cleanup danh tính.

#### Giai đoạn 4 — Tích hợp

- [ ] Milestone revision được duyệt cho Lịch nếu chọn, không copy text.
- [ ] Descriptor rule trong vườn opt-in, tách khỏi thực thi.

#### Giai đoạn 5 — Test / sau

- [ ] History bất biến, hai user agree, stale revision/race archive.
- [ ] Sau: rút/restore, Markdown an toàn, compare/export JSON.

### 11. Yêu cầu kiểm thử

Node: initial/pending/active, revision bất biến, agree giả/lặp cùng user, version cũ 409, race propose/agree, archive cả hai, guest, lỗi/restart/history đúng. Browser: wording active/proposed/history, nút agree rõ/archive đang chờ, bàn phím/mobile, phục hồi nháp/logout. Xác nhận không sửa AGENTS.md hoặc lưu rule runtime vào dist.

### 12. Mở rộng tương lai

Diff phong phú, rút proposal, restore có đồng ý, Markdown an toàn, export history portable, milestone chọn lọc. Không enforcement tự động, điểm tuân thủ mối quan hệ hoặc phạt theo rule.
