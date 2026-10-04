# Period Tracker / Theo dõi kỳ kinh

## English

### 1. Feature description

Future sensitive personal tracking controlled by Yến, not public profile content or a shared score. MVP is manual recording only. This specification defines software behavior; it does not provide medical advice or a prediction algorithm. Follow [shared conventions](README.md#proposed-engineering-conventions).

### 2. User experience / expected behavior

Yến records a start date, optionally an end date, symptoms and a note. Recorded days appear in her private tracker/calendar. An optional cycle-day label is a date-count from the recorded start, not a biological prediction. Minh sees no indication that records exist by default. If sharing is later enabled, Yến previews the exact fields and date range before granting/revoking access.

### 3. Functional requirements

MVP: owner-only create/read/edit/archive, date range/history, nullable end for an ongoing record, manual symptoms and notes. Suggested at most 10 symptom labels of 80 characters and note 1000. End must not precede start. Potential overlaps require explicit review, not auto-merging or silently changing dates. No automatic expected-next-cycle calculation in MVP. Later estimates must be clearly labelled and separated from observations, with a separately reviewed rule and no claim of diagnostic, fertility, or contraceptive use.

### 4. Architecture

Suggested `backend/cycles.js`, `js/cycles.js`: manual input -> date validation and owner/grant policy -> separate sensitive storage -> protected API -> tracker UI -> authorized calendar summaries. Keep period fields out of `/api/profiles`, auth user JSON, general shared feed and Garden. Centralize a small cycle-specific policy for list/detail/calendar/export/media rather than letting each consumer invent access rules. Text JSON-file prototype is local-only; production durability and sensitive-data backup/access choices block release.

### 5. Suggested data model

`CycleEntry { id, ownerId: haiyen, startDate, endDate?, symptoms[], note?, createdAt, updatedAt, archivedAt?, version }`.

Future `CycleSharing { ownerId, recipientId: minhle, allowedFields[], fromDate, toDate, grantedAt, revokedAt?, version }`. Empty/missing grant means deny, never inferred consent from being partners. Proposed first grant allowlist is `recordedDates`; symptoms/notes require distinct explicit choices later. Dates are local date-only values, creation timestamps UTC ISO. Estimated dates would be a derived response `estimatedNextStartDate?`, `isEstimated: true`, `methodVersion`, never a recorded `CycleEntry`.

### 6. Frontend responsibilities

Private entry/history view with labelled date inputs, optional symptoms/note, accessible ongoing marker, errors and archive confirmation. Do not render a partner tab/empty tracker that reveals existence. Clear sensitive DOM/state on logout/account switch; no URL note/date details, localStorage, service-worker cache, or public notification preview. Show “recorded” versus “estimated” distinctly if estimates ever ship. Preserve same-owner failure draft only in mounted memory.

### 7. Backend/API responsibilities

Proposed `GET/POST /api/cycles`, `GET/PUT /api/cycles/:id`, `POST /api/cycles/:id/archive`: owner-only in MVP. Later `GET/PUT /api/cycle-sharing` and `POST /api/cycle-sharing/revoke` are Yến-only grant controls; partner reads receive only a field-filtered summary, not the full record schema. Actor is session-derived; deny submitted owner changes. Use common version/idempotency/CSRF/body/date checks, no-store and generic errors. Filter before aggregation and serialize only allowed fields; do not send hidden fields for the client to hide. Revocation invalidates calendar/export/projection caches immediately. Never log symptoms/notes.

### 8. Important edge cases

Ongoing record, same-day start/end, leap days, correction of a past date, overlapping entries and uncertain dates. Requesting someone else's ID returns neutral inaccessible. A revocation racing with a read must not issue a fresh authorized summary afterward; in-flight/UI results are invalidated by grant/identity revision. Production restore/export must retain access policy, not accidentally turn sensitive files public. Deleting a grant does not delete the owner's recorded data.

### 9. Privacy / permission considerations

Yến owns all cycle records and grants; Minh has no read/write/count/icon access by default; guests have none. Partnership is not consent. Photos of records, if ever supported, need protected media policy. Exclude period information from garden projections even when dates are shared with Minh, unless a separately approved specific opt-in design exists; recommendation is to keep it excluded.

**Open Design Decision:** owner-only is safest and simplest; sharing recorded dates can aid mutual care; field-level symptoms/notes add usefulness but greater sensitivity and revocation complexity. Recommend owner-only MVP, then an explicit revocable dates-only grant if requested. Confirm grant scope, duration, export retention and whether estimates should ever be offered before those slices begin.

### 10. TODO checklist

#### Phase 1 — Domain (MVP)

- [ ] Confirm owner-only boundary, date/overlap behavior, symptom/note limits and retention.
- [ ] Define CycleEntry validation and private calendar summary shape.

#### Phase 2 — Backend (MVP)

- [ ] Add separate sensitive persistence and Yến-only CRUD/archive/range routes.
- [ ] Enforce policy in details/lists/aggregates/export paths and reject forged owners.

#### Phase 3 — Frontend (MVP)

- [ ] Build manual entry/history, ongoing state, labelled inputs and error/archive flows.
- [ ] Clear sensitive state on logout/account switch/unmount and avoid client persistence.

#### Phase 4 — Integration

- [ ] Add Yến-only calendar references without period data in public/shared responses.
- [ ] Later: implement exact grant field/range filtering and atomic revocation if selected.

#### Phase 5 — Tests / later

- [ ] Verify guest/Minh denial through direct API, calendar/counts, cache and browser state.
- [ ] Later: decide export/backup protection; separately specify and review any estimates.

### 11. Testing requirements

Node: Yến allowed, Minh/guest denied, forged owner, valid/invalid/leap/overlapping dates, ongoing end, versions, CSRF, byte limits, failed/corrupt storage and restored policy. Browser: no period data in public profiles/Minh DOM/URLs, same-owner draft recovery, identity switching, date inputs, keyboard/mobile. Future sharing tests must enumerate each grant field/range, revoked grants, no count leakage and calendar parity. No test needs real personal cycle data.

### 12. Future extensions

Explicit configurable sharing, optional labelled estimates only after separate design review, protected portable export and symptom-history views. No diagnostic scoring, fertility/contraceptive guidance, partner surveillance, reminders without consent, or garden-health interpretation.

---

## Tiếng Việt

### 1. Mô tả tính năng

Theo dõi dữ liệu cá nhân nhạy cảm do Yến kiểm soát, không phải hồ sơ công khai hay điểm chung. MVP chỉ ghi thủ công. Đặc tả mô tả phần mềm, không đưa lời khuyên y khoa hoặc thuật toán dự đoán. Theo [quy ước chung](README.md#quy-ước-kỹ-thuật-được-đề-xuất).

### 2. Trải nghiệm / hành vi mong đợi

Yến nhập ngày bắt đầu, ngày kết thúc nếu có, triệu chứng/note tùy chọn. Ngày đã ghi hiện trong tracker/lịch riêng của Yến. Nhãn ngày chu kỳ tùy chọn chỉ đếm ngày từ start đã nhập, không dự đoán sinh học. Minh mặc định không thấy dấu hiệu có bản ghi. Nếu thêm sharing, Yến preview đúng field/range trước cấp/thu hồi.

### 3. Yêu cầu chức năng

MVP: owner tạo/xem/sửa/archive, range/history, end nullable cho kỳ đang diễn ra, symptom/note nhập tay. Gợi ý tối đa 10 symptom label dài 80, note 1000 ký tự. End không trước start. Record trùng khoảng cần review rõ, không tự merge/sửa ngày. Không tính kỳ tiếp theo trong MVP. Ước tính sau phải có nhãn/tách quan sát, rule được review riêng, không tuyên bố dùng để chẩn đoán/sinh sản/tránh thai.

### 4. Kiến trúc

Gợi ý `backend/cycles.js`, `js/cycles.js`: nhập -> validate ngày/quyền -> lưu nhạy cảm riêng -> API bảo vệ -> tracker -> summary lịch đúng quyền. Không thêm field kỳ kinh vào profiles/auth user/feed chung/Garden. Policy cycle nhỏ dùng chung cho list/detail/lịch/export/media, không mỗi consumer tự đặt quyền. JSON-file chỉ prototype local; storage production bền và bảo vệ backup/access là điều kiện release.

### 5. Mô hình dữ liệu gợi ý

`CycleEntry { id, ownerId: haiyen, startDate, endDate?, symptoms[], note?, createdAt, updatedAt, archivedAt?, version }`.

Sau: `CycleSharing { ownerId, recipientId: minhle, allowedFields[], fromDate, toDate, grantedAt, revokedAt?, version }`. Không có/empty grant là từ chối, không suy consent từ quan hệ. Allowlist đầu đề xuất `recordedDates`; symptom/note cần lựa chọn rõ khác về sau. Ngày giữ date-only, timestamp tạo UTC ISO. Ngày ước tính là response suy ra `estimatedNextStartDate?`, `isEstimated: true`, `methodVersion`, không ghi thành CycleEntry quan sát.

### 6. Trách nhiệm frontend

View riêng nhập/history, date input có nhãn, symptom/note tùy chọn, kỳ đang diễn ra accessible, lỗi/xác nhận archive. Không render tab/empty tracker cho partner để lộ sự tồn tại. Xóa DOM/state khi logout/đổi người; không detail ngày/note trong URL/localStorage/service-worker cache/preview thông báo public. Nếu có estimate, phân biệt “đã ghi”/“ước tính”. Nháp lỗi chỉ trong RAM view còn mount cho cùng owner.

### 7. Trách nhiệm backend/API

Đề xuất `GET/POST /api/cycles`, `GET/PUT /api/cycles/:id`, `POST /api/cycles/:id/archive`, MVP Yến-only. Sau `GET/PUT /api/cycle-sharing`, `POST /api/cycle-sharing/revoke` chỉ Yến quản lý grant; read partner chỉ trả summary đã lọc field, không full schema. Actor từ session, từ chối đổi owner. Version/idempotency/CSRF/body/ngày/no-store/lỗi chung theo overview. Lọc trước tổng hợp và serialize field được phép, không gửi field rồi để client ẩn. Thu hồi vô hiệu cache lịch/export/projection ngay. Không log symptom/note.

### 8. Tình huống biên quan trọng

Kỳ đang diễn ra, start=end, ngày nhuận, sửa ngày cũ, khoảng trùng, ngày chưa chắc. Đọc ID người khác trả inaccessible trung tính. Thu hồi race với read không được cấp summary mới sau đó; response/UI đang chờ vô hiệu theo grant/identity revision. Restore/export phải giữ policy, không làm file nhạy cảm public. Xóa grant không xóa dữ liệu owner.

### 9. Riêng tư / phân quyền

Yến sở hữu record/grant; Minh mặc định không read/write/count/icon; guest không có quyền. Quan hệ không tự là consent. Ảnh record nếu có cần media riêng. Dù share ngày với Minh, vẫn loại khỏi Garden trừ thiết kế opt-in riêng được duyệt; đề xuất tiếp tục loại.

**Open Design Decision / Quyết định thiết kế còn mở:** owner-only an toàn/đơn giản; share ngày hỗ trợ chăm sóc; symptom/note hữu ích nhưng nhạy cảm và khó thu hồi hơn. Đề xuất MVP owner-only, sau có grant ngày-only thu hồi được nếu yêu cầu. Chốt field/range/thời hạn/export retention và có estimate hay không trước từng lát cắt.

### 10. Checklist TODO

#### Giai đoạn 1 — Domain (MVP)

- [ ] Chốt owner-only, ngày/khoảng trùng, giới hạn symptom/note/retention.
- [ ] Validate CycleEntry và shape summary lịch riêng.

#### Giai đoạn 2 — Backend (MVP)

- [ ] Lưu nhạy cảm riêng, CRUD/archive/range chỉ Yến.
- [ ] Policy detail/list/tổng hợp/export, từ chối owner giả.

#### Giai đoạn 3 — Frontend (MVP)

- [ ] Input/history thủ công, trạng thái ongoing, lỗi/archive có nhãn.
- [ ] Xóa khi logout/đổi người/unmount, không persist client.

#### Giai đoạn 4 — Tích hợp

- [ ] Tham chiếu lịch Yến-only, không response public/chung chứa kỳ kinh.
- [ ] Sau: grant field/range và thu hồi atomic nếu chọn.

#### Giai đoạn 5 — Test / sau

- [ ] Guest/Minh bị từ chối qua API trực tiếp/lịch/count/cache/browser.
- [ ] Sau: bảo vệ export/backup; đặc tả/review estimate riêng.

### 11. Yêu cầu kiểm thử

Node: Yến được phép, Minh/guest từ chối, owner giả, ngày đúng/sai/nhuận/trùng, ongoing, version, CSRF, byte cap, storage lỗi/corrupt, policy sau restore. Browser: không dữ liệu kỳ kinh trong profile/DOM Minh/URL, nháp cùng owner, đổi người, input ngày/bàn phím/mobile. Sharing sau test từng field/range/grant thu hồi, không count lộ, quyền lịch giống API. Không dùng dữ liệu kỳ kinh thật.

### 12. Mở rộng tương lai

Sharing cấu hình rõ, estimate có nhãn sau review riêng, export portable được bảo vệ, lịch sử symptom. Không chẩn đoán, hướng dẫn sinh sản/tránh thai, giám sát partner, nhắc khi chưa đồng ý hay suy sức khỏe vườn.
