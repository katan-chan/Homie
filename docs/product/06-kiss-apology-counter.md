# Kiss & Apology Counter / Nụ hôn và lời xin lỗi

## English

### 1. Feature description

Future playful exchanges and descriptive weekly/monthly counts. An apology is an act of care, not a negative point; a kiss is affection, not debt enforcement. Follow [shared conventions](README.md#proposed-engineering-conventions).

### 2. User experience / expected behavior

Send a digital kiss to the other partner, or (if chosen later) record an offline kiss. A recipient may acknowledge or return a digital kiss without obligation. Write an apology with a reason and optional message; the recipient may acknowledge seeing it, but that does not mean forgiveness or resolution. Optional wording such as “Least troublesome human of the week” is opt-in playful copy, never a default leaderboard. “+2 kisses owed” can only be a mutually agreed joke, not an automatic punishment or enforceable balance.

### 3. Functional requirements

Recommended MVP: sender-authored digital kiss and apology events, history, author edit/archive and visible counts by sender/type for current week/month. Suggested kiss note 500 characters, apology reason 200 and message 1000. No acknowledgement requirement in MVP; no ranking of who is the better partner, apology streaks, negative score, or incentives to avoid sincere apologies. Counts are contextual, not judgments. Status transitions are a later slice.

### 4. Architecture

Input -> event-specific validation/actor-target policy -> shared durable event storage -> authenticated event API -> history/count UI -> [Calendar](04-relationship-calendar.md) references. Suggested `backend/relationship-events.js` and `js/relationship-events.js` may share date/pagination plumbing, but keep kiss/apology validators separate.

**Model trade-off:** two models make different fields/status rules explicit and easier to validate. One `RelationshipEvent { type, actorId, targetId, occurredAt, payload }` reduces duplicated persistence/queries, but untyped `metadata` can hide invalid combinations and sensitive fields. Recommend a discriminated union with allowlisted kiss/apology payloads in one small module only if implemented together; otherwise start with one concrete event and share code when a second consumer exists. No generic event engine.

### 5. Suggested data model

`RelationshipEvent { id, type: kiss|apology, actorId, targetId, occurredAt, timeZone, payload, createdAt, updatedAt, archivedAt?, version }`.

Kiss payload: `{ mode: digital, note? }`; later `{ status: sent|received|returned, acknowledgedAt?, returnEventId? }`. Apology payload: `{ reason, message? }`; later `{ acknowledgement: pending|seen, acknowledgedAt? }`. A returned kiss is a new event linked to the original, not a duplicate count on both “sent” and “returned” labels. Never infer forgiveness from status. No stored aggregate counters; derive from authorized active records.

### 6. Frontend responsibilities

Separate labelled kiss/apology forms, explicit recipient, calm confirmations, undo/archive and recent history. Avoid accusatory comparisons; make playful statistics optional and clearly contextual. Prevent duplicate taps, show pending/error without inflating persisted counts, support keyboard/touch/reduced motion. No garden degradation for apologies or missing kisses; clear event history on logout/account change and abort work on cleanup.

### 7. Backend/API responsibilities

Proposed `GET/POST /api/relationship-events`, `GET/PUT /api/relationship-events/:id`, `POST /api/relationship-events/:id/archive`; later `POST .../acknowledge` and `POST .../return-kiss`. Only session actor can create/edit/archive their event; target must be the other fixed account. Both read shared events. Only target acknowledges/returns, without editing sender text. Use typed payload validation, `requestId`, versions, CSRF and atomic writes. Weekly/monthly summaries use source records once per event, Monday-based display-zone boundaries, and no private counters.

### 8. Important edge cases

Rapid taps/retries create one event per request ID. No self-target or forged sender. Backdated events regroup historical counts. Recipient acknowledgement races with author edits need version checks; editing acknowledged text invalidates/requires new acknowledgement by later policy. Archiving removes active counts but not an unrelated return event. Clock/date changes do not reset totals through stored-counter drift.

### 9. Privacy / permission considerations

Events and apology reasons are private to the two partners, not public profiles or the public garden. Export counts/reasons only under the same membership policy. Garden inclusion is excluded by default and requires a separate consent/design decision; no apology-derived visual punishment.

**Open Design Decision:** digital sends give a clear sender/recipient interaction; manual logs reflect offline life; supporting both needs separate mode/count semantics. Recommend digital-only MVP. **Open Design Decision:** required apology acknowledgement records receipt but can create pressure and confusion with forgiveness; optional acknowledgement preserves choice. Recommend no required acknowledgement, with optional “seen” later. Confirm whether playful statistics and kiss jokes should exist at all.

### 10. TODO checklist

#### Phase 1 — Domain (MVP)

- [ ] Confirm kiss mode, optional acknowledgement, playful-copy policy and model trade-off.
- [ ] Define typed payloads, target rules, event date and count semantics.

#### Phase 2 — Backend (MVP)

- [ ] Add event persistence, create/list/detail/update/archive and actor checks.
- [ ] Add derived week/month counts, bounded queries, deduplication and conflicts.

#### Phase 3 — Frontend (MVP)

- [ ] Build forms/history and optional descriptive counts with accessible error/undo flows.
- [ ] Add duplicate-tap protection and identity/abort cleanup.

#### Phase 4 — Integration

- [ ] Expose event references to Calendar without storing calendar copies.
- [ ] Keep Garden excluded unless a separate non-punitive opt-in is approved.

#### Phase 5 — Tests / later

- [ ] Test type/actor/target policy, retry, counts/timezone, archive and browser flows.
- [ ] Later: define optional acknowledgement/return transitions and manual recording semantics.

### 11. Testing requirements

Node: distinct payload validation, forged sender/target, guest/third-ID denial, retry deduplication, versions, own versus partner edit, CSRF, date/week/month boundaries, one event counted once, persistence failure/restart. Browser: kiss tap retry, apology failure keeps text, no ranking/punishment copy, keyboard/mobile, optional statistics and logout cleanup. Later target-only status tests must include invalid transitions and editing after acknowledgement.

### 12. Future extensions

Optional seen/returned statuses, manual offline events, jointly chosen playful labels and portable event history. Do not add automatic penalties, a “better partner” score, or a forgiveness deadline.

---

## Tiếng Việt

### 1. Mô tả tính năng

Tương tác vui trong tương lai và count mô tả theo tuần/tháng. Xin lỗi là quan tâm, không phải điểm trừ; nụ hôn là tình cảm, không phải cơ chế đòi nợ. Theo [quy ước chung](README.md#quy-ước-kỹ-thuật-được-đề-xuất).

### 2. Trải nghiệm / hành vi mong đợi

Gửi nụ hôn số cho người kia hoặc ghi nụ hôn ngoài đời nếu sau này chọn. Người nhận có thể xác nhận/hôn lại, không bắt buộc. Viết lời xin lỗi có lý do và lời nhắn; xác nhận đã xem không có nghĩa tha thứ hoặc giải quyết xong. “Người ít phiền nhất tuần” chỉ là copy vui opt-in, không leaderboard mặc định. “Nợ thêm 2 nụ hôn” chỉ là trò đùa cả hai đồng ý, không phạt tự động hay sổ nợ bắt buộc.

### 3. Yêu cầu chức năng

Đề xuất MVP: sự kiện nụ hôn số/xin lỗi do người gửi viết, history, tác giả sửa/archive, count theo người gửi/loại trong tuần/tháng hiện tại. Note hôn gợi ý 500 ký tự, reason 200, message 1000. MVP không bắt xác nhận; không xếp hạng ai tốt hơn, streak xin lỗi, điểm âm hoặc khuyến khích tránh xin lỗi chân thành. Count chỉ cung cấp ngữ cảnh. Status chuyển sau.

### 4. Kiến trúc

Input -> validate theo loại/quyền actor-target -> lưu sự kiện chung bền -> API authenticated -> history/count -> tham chiếu [Lịch](04-relationship-calendar.md). Gợi ý `backend/relationship-events.js`, `js/relationship-events.js` dùng chung ngày/phân trang nhưng validator hôn/xin lỗi tách rõ.

**Đánh đổi model:** hai model làm rõ field/status, dễ validate. Một `RelationshipEvent { type, actorId, targetId, occurredAt, payload }` giảm lưu trữ/query lặp nhưng `metadata` tùy ý dễ giấu tổ hợp sai/field nhạy cảm. Đề xuất discriminated union có payload allowlist nếu làm cả hai cùng lúc; nếu chỉ làm một loại, bắt đầu model cụ thể và dùng chung khi có consumer thứ hai. Không event engine tổng quát.

### 5. Mô hình dữ liệu gợi ý

`RelationshipEvent { id, type: kiss|apology, actorId, targetId, occurredAt, timeZone, payload, createdAt, updatedAt, archivedAt?, version }`.

Kiss: `{ mode: digital, note? }`; sau `{ status: sent|received|returned, acknowledgedAt?, returnEventId? }`. Apology: `{ reason, message? }`; sau `{ acknowledgement: pending|seen, acknowledgedAt? }`. Hôn lại là sự kiện mới liên kết bản gốc, không đếm bản gốc hai lần ở nhãn sent/returned. Không suy ra tha thứ từ status. Count suy ra bản ghi active đúng quyền, không lưu bộ đếm độc lập.

### 6. Trách nhiệm frontend

Form hôn/xin lỗi riêng có nhãn, người nhận rõ, xác nhận nhẹ nhàng, undo/archive/history. Không so sánh buộc tội; thống kê vui tùy chọn, có ngữ cảnh. Chặn tap lặp, pending/lỗi không tăng count chưa lưu, hỗ trợ bàn phím/chạm/reduced motion. Vườn không xấu đi vì xin lỗi/thiếu hôn; logout/đổi người xóa history, cleanup abort.

### 7. Trách nhiệm backend/API

Đề xuất `GET/POST /api/relationship-events`, `GET/PUT /api/relationship-events/:id`, `POST /api/relationship-events/:id/archive`; sau `POST .../acknowledge`, `POST .../return-kiss`. Actor session tạo/sửa/archive sự kiện mình, target phải là tài khoản còn lại. Cả hai đọc sự kiện chung. Chỉ target xác nhận/hôn lại, không sửa chữ người gửi. Validate payload theo type, request ID/version/CSRF/write atomic. Tổng hợp tuần/tháng đếm mỗi sự kiện một lần, tuần bắt đầu thứ Hai theo zone hiển thị, không bộ đếm riêng.

### 8. Tình huống biên quan trọng

Tap/retry nhanh chỉ một sự kiện/request ID. Không tự target/giả người gửi. Backdate đổi nhóm count. Xác nhận đồng thời sửa cần version; sửa chữ đã xác nhận phải vô hiệu/xác nhận lại theo policy sau. Archive bỏ count active nhưng không xóa nụ hôn trả lại độc lập. Đổi ngày không làm trôi tổng do bộ đếm lưu sẵn.

### 9. Riêng tư / phân quyền

Sự kiện/lý do xin lỗi chỉ hai người, không hồ sơ/vườn public. Export count/reason cùng policy membership. Mặc định loại khỏi Garden; đưa vào cần quyết định consent riêng, tuyệt đối không phạt vườn từ xin lỗi.

**Open Design Decision / Quyết định thiết kế còn mở:** gửi số có actor/target rõ; log thủ công phản ánh ngoài đời; cả hai cần mode/count khác nhau. Đề xuất MVP chỉ số. **Open Design Decision:** bắt xác nhận cho biết đã nhận nhưng gây áp lực/nhầm tha thứ; tùy chọn giữ tự chủ. Đề xuất không bắt xác nhận, sau có “đã xem” tùy chọn. Chốt có muốn thống kê vui/trò đùa nợ hôn hay không.

### 10. Checklist TODO

#### Giai đoạn 1 — Domain (MVP)

- [ ] Chốt mode hôn, xác nhận tùy chọn, copy vui và đánh đổi model.
- [ ] Payload theo type, target, ngày và cách đếm.

#### Giai đoạn 2 — Backend (MVP)

- [ ] Persistence, create/list/detail/update/archive, quyền actor.
- [ ] Count tuần/tháng suy ra, query giới hạn, chống lặp/conflict.

#### Giai đoạn 3 — Frontend (MVP)

- [ ] Form/history/count tùy chọn, lỗi/undo accessible.
- [ ] Chặn tap lặp, cleanup danh tính/abort.

#### Giai đoạn 4 — Tích hợp

- [ ] Tham chiếu cho Lịch, không copy dữ liệu.
- [ ] Loại khỏi Garden cho tới khi có opt-in không trừng phạt được duyệt.

#### Giai đoạn 5 — Test / sau

- [ ] Type/actor/target, retry, count/zone, archive/browser.
- [ ] Sau: xác nhận/hôn lại và ngữ nghĩa ghi ngoài đời.

### 11. Yêu cầu kiểm thử

Node: payload từng type, actor/target giả, guest/ID thứ ba, retry, version, sửa own/partner, CSRF, ranh giới ngày/tuần/tháng, đếm một lần, lưu lỗi/restart. Browser: retry tap hôn, lỗi xin lỗi giữ chữ, không ranking/copy phạt, bàn phím/mobile, thống kê tùy chọn, logout. Test status sau gồm target-only, transition sai và sửa sau xác nhận.

### 12. Mở rộng tương lai

Seen/returned tùy chọn, log ngoài đời, nhãn vui cả hai chọn, history portable. Không phạt tự động, điểm người yêu tốt hơn hoặc hạn phải tha thứ.
