# Mood Jar / Hũ cảm xúc

## English

### 1. Feature description

A future emotional-history jar for each person. Colored translucent candy-like balls represent feelings, not mental-health diagnoses, productivity, or relationship quality. Follow [shared conventions](README.md#proposed-engineering-conventions).

### 2. User experience / expected behavior

Record how you feel using two labelled dimensions: `valence` from negative to positive and `energy` from low to high. Optionally name the feeling or add a note. Tap/click or keyboard-select a ball to see its owner, local date/time, dimensions, label, and permitted note. Choose a date range; a readable list accompanies the visual jar. You can explicitly share a record, without sharing your entire history.

### 3. Functional requirements

Proposed MVP allows multiple updates per day, with editing/archive of each record. Valence ranges from -1 to 1; energy from 0 to 1, both finite numbers. Suggested label limit 80 characters, note 1000. No compulsory daily check-in or “good mood” target.

Mapping proposal: hue communicates valence/category; brightness/saturation provides a redundant intensity cue based on distance from neutral; energy uses labelled size/visual emphasis. Energy and intensity are different concepts. Four illustrative quadrants are excited/joyful, peaceful/content, sad/tired, stressed/angry; these are optional labels, not inferred diagnoses. Color/size cannot be the only means of reading a feeling. MVP is DOM/CSS or a feature-contained 2D canvas; 3D is not required.

### 4. Architecture

Suggested `js/moods.js` and `backend/moods.js`: dimension input -> validation/ownership -> private domain storage -> authorized range API -> 2D jar and list. Feature canvas stays inside its container and never replaces shell canvases. Ball layout can be a stable function of record ID for testing; fetches are independent of rendering. [Journal](01-personal-journal.md) may reference an owner's mood; [Calendar](04-relationship-calendar.md) reads authorized entries. [Garden](10-garden-integration.md) receives only separately opted-in descriptors, not notes or raw mood history.

### 5. Suggested data model

`MoodEntry { id, ownerId, occurredAt, timeZone, valence, energy, label?, note?, visibility: PRIVATE|SHARED, gardenOptIn: false, createdAt, updatedAt, archivedAt?, version }`.

Day is derived in the selected display zone, not stored as another source of truth. Sharing a journal containing a mood reference does not change the mood's visibility. No average relationship score or diagnostic field.

### 6. Frontend responsibilities

Accessible range inputs with textual endpoints, optional note, privacy controls, selectable balls and list/detail view. For a canvas jar use corresponding keyboard-accessible DOM controls. Stable layouts, limited rendered records, mobile fit, reduced-motion behavior, loading/empty/retry states. No physics loop for MVP. Clear history on identity changes; abort fetch/observers and ignore late responses.

### 7. Backend/API responsibilities

Proposed `GET /api/moods?from=&to=&ownerId=` and `POST /api/moods`; `GET/PUT /api/moods/:id`; `POST /api/moods/:id/archive`. Range reads combine the viewer's own entries with the partner's explicitly shared entries; requesting a partner filter must not reveal private totals. POST/PUT validate finite bounds, allowed fields/dates/text, visibility and garden opt-in; author comes from session. Common pagination, request IDs, version conflicts, CSRF, no-store responses and storage rules apply. No server diagnosis or sentiment extraction from notes.

### 8. Important edge cases

Identical timestamps still have unique IDs. Edits retain identity and ordering; deletion/archive removes projections. Midnight/timezone travel does not collapse two records. Neutral valence is valid; NaN, Infinity, and out-of-range input are rejected. Hundreds of balls need paging/range limits and a list rather than unreadable piling. A revoked shared mood disappears from partner calendar summaries immediately.

### 9. Privacy / permission considerations

Default recommendation: owner-only record including label/note. Partner sees only explicit shared records; guests see none. Do not expose “a private mood exists,” hidden counts, or aggregate distributions. Garden use needs distinct opt-in and must not imply emotional or relationship health. Logs, URLs, build output and public profiles contain no mood content.

**Open Design Decision:** one daily entry is simpler and easier to summarize; multiple updates preserve emotional change without overwriting the day. Recommend multiple updates, but confirm before implementation. Also confirm whether sharing includes the note or supports separate note consent; MVP recommendation shares the explicitly previewed whole record.

### 10. TODO checklist

#### Phase 1 — Domain (MVP)

- [ ] Confirm update frequency and sharing scope; define finite valence/energy schema and text limits.
- [ ] Define owner/range/visibility policy and local-day handling.

#### Phase 2 — Backend (MVP)

- [ ] Add separate mood persistence and create/detail/update/archive routes.
- [ ] Add authenticated range query, permission filtering, versions and retry deduplication.

#### Phase 3 — Frontend (MVP)

- [ ] Build mood input, 2D jar, accessible list/ball detail and error states.
- [ ] Add mounted-view cleanup and identity-safe draft/history handling.

#### Phase 4 — Integration

- [ ] Expose authorized mood references to Journal/Calendar when those consumers exist.
- [ ] Add explicit garden opt-in only after projection permission design is approved.

#### Phase 5 — Tests / later

- [ ] Test bounds, midnight ranges, owner/partner/guest policy, conflicts and browser ball selection.
- [ ] Later: evaluate physics/WebGL costs and portable history export without scoring.

### 11. Testing requirements

Node: finite bounds, multiple same-day records, UTC-to-Bangkok midnight grouping, invalid dates, private detail/list/count denial, unshare, forged owner, storage failure/restart, conflict and duplicate creates. Browser: all quadrants/neutral labels, keyboard/touch ball details, color-independent reading, empty/large jars, resize, reduced motion, rapid navigation and logout cleanup. Canvas tests may use the existing background-test style of controlled browser globals; real focus/layout still needs CDP browser tests.

### 12. Future extensions

Richer 2D physics or optional WebGL/3D with a list fallback, custom labels, filtering and export. No AI diagnosis, mood ranking, pressure streaks, or predictions about the relationship.

---

## Tiếng Việt

### 1. Mô tả tính năng

Hũ lưu lịch sử cảm xúc cho từng người. Viên kẹo/bi trong suốt có màu biểu diễn cảm giác, không chẩn đoán sức khỏe tâm thần hoặc chấm điểm năng suất/mối quan hệ. Theo [quy ước chung](README.md#quy-ước-kỹ-thuật-được-đề-xuất).

### 2. Trải nghiệm / hành vi mong đợi

Ghi cảm xúc bằng hai trục có nhãn: `valence` từ tiêu cực tới tích cực, `energy` từ thấp tới cao. Có thể đặt tên cảm xúc hoặc viết note. Chạm/bấm/chọn bằng bàn phím một viên để đọc owner, ngày giờ địa phương, hai trục, label và note được phép xem. Chọn khoảng ngày; có danh sách chữ song song với hũ. Chia sẻ từng bản ghi có chủ đích, không mở cả lịch sử.

### 3. Yêu cầu chức năng

MVP đề xuất nhiều lần cập nhật mỗi ngày, sửa/archive từng bản ghi. Valence -1 đến 1, energy 0 đến 1; phải là số hữu hạn. Label gợi ý 80 ký tự, note 1000. Không bắt buộc check-in hằng ngày hoặc đạt mục tiêu vui vẻ.

Đề xuất màu: hue biểu diễn sắc thái/nhóm; độ sáng/bão hòa thêm tín hiệu cường độ theo khoảng cách tới trung tính; energy dùng kích thước/nhấn mạnh có nhãn. Năng lượng không đồng nghĩa cường độ. Bốn góc minh họa: phấn khích/vui, bình yên/hài lòng, buồn/mệt, căng thẳng/giận; chỉ là label tùy chọn, không chẩn đoán tự động. Không chỉ dựa vào màu/kích thước. MVP dùng DOM/CSS hoặc canvas 2D trong container; không cần 3D.

### 4. Kiến trúc

Gợi ý `js/moods.js`, `backend/moods.js`: nhập hai trục -> validate/quyền -> lưu domain riêng -> API khoảng ngày đúng quyền -> hũ 2D và danh sách. Canvas tính năng không thay canvas nền shell. Bố trí viên ổn định theo ID giúp test; tải dữ liệu độc lập render. [Nhật ký](01-personal-journal.md) có thể tham chiếu mood của owner; [Lịch](04-relationship-calendar.md) đọc bản ghi được phép. [Vườn](10-garden-integration.md) chỉ nhận descriptor có opt-in riêng, không note/lịch sử thô.

### 5. Mô hình dữ liệu gợi ý

`MoodEntry { id, ownerId, occurredAt, timeZone, valence, energy, label?, note?, visibility: PRIVATE|SHARED, gardenOptIn: false, createdAt, updatedAt, archivedAt?, version }`.

Ngày suy ra theo zone hiển thị, không lưu thành nguồn thứ hai. Share nhật ký có link mood không đổi quyền mood. Không có điểm trung bình mối quan hệ hoặc field chẩn đoán.

### 6. Trách nhiệm frontend

Range input accessible, nhãn đầu/cuối bằng chữ, note và quyền tùy chọn; chọn viên, list/detail. Canvas cần DOM control tương ứng cho bàn phím. Bố trí ổn định, giới hạn bản ghi render, fit mobile, reduced motion, loading/trống/retry. MVP không loop physics. Xóa lịch sử khi đổi người; abort fetch/observer, chặn response muộn.

### 7. Trách nhiệm backend/API

Đề xuất `GET /api/moods?from=&to=&ownerId=`, `POST /api/moods`; `GET/PUT /api/moods/:id`; `POST /api/moods/:id/archive`. Range gồm mood của viewer và mood partner đã share; filter partner không làm lộ tổng riêng. Validate số hữu hạn/giới hạn, field/ngày/chữ, visibility/opt-in; owner lấy session. Dùng phân trang, request ID, version, CSRF, no-store và storage chung. Không suy diễn tâm lý từ note.

### 8. Tình huống biên quan trọng

Cùng timestamp vẫn khác ID. Sửa giữ ID/thứ tự; archive gỡ projection. Qua nửa đêm/đổi zone không gộp hai bản ghi. Valence trung tính hợp lệ; từ chối NaN/Infinity/ngoài khoảng. Nhiều viên cần phân trang/range/list, không chất đống khó đọc. Mood bị thu hồi biến mất khỏi tổng hợp lịch partner ngay.

### 9. Riêng tư / phân quyền

Đề xuất mặc định chỉ owner xem cả label/note. Partner chỉ xem bản ghi được share rõ ràng; guest không xem. Không lộ “có mood riêng”, count hoặc phân bố ẩn. Đưa vào vườn cần opt-in riêng và không diễn giải thành sức khỏe cảm xúc/mối quan hệ. Không để nội dung mood trong log/URL/dist/hồ sơ public.

**Open Design Decision / Quyết định thiết kế còn mở:** một bản ghi/ngày đơn giản, dễ tổng hợp; nhiều lần giữ được thay đổi mà không ghi đè ngày. Đề xuất nhiều lần nhưng cần chốt trước code. Cũng cần chốt share cả note hay xin phép note riêng; MVP đề xuất preview và share toàn bản ghi được chọn.

### 10. Checklist TODO

#### Giai đoạn 1 — Domain (MVP)

- [ ] Chốt tần suất và phần được chia sẻ; schema hai trục hữu hạn, giới hạn chữ.
- [ ] Định nghĩa quyền owner/range/visibility và ngày địa phương.

#### Giai đoạn 2 — Backend (MVP)

- [ ] Lưu mood riêng, route create/detail/update/archive.
- [ ] Query range có session, lọc quyền, version, chống retry lặp.

#### Giai đoạn 3 — Frontend (MVP)

- [ ] Input mood, hũ 2D, list/detail accessible, trạng thái lỗi.
- [ ] Cleanup view, nháp/lịch sử đúng danh tính.

#### Giai đoạn 4 — Tích hợp

- [ ] Cấp tham chiếu đúng quyền cho Nhật ký/Lịch khi consumer có thật.
- [ ] Chỉ thêm opt-in vườn sau khi duyệt quyền projection.

#### Giai đoạn 5 — Test / sau

- [ ] Test bounds, nửa đêm, owner/partner/guest, conflict, chọn viên trên browser.
- [ ] Sau: cân nhắc physics/WebGL và export lịch sử không chấm điểm.

### 11. Yêu cầu kiểm thử

Node: bounds hữu hạn, nhiều mood/ngày, UTC sang ngày Bangkok, ngày sai, từ chối detail/list/count riêng, unshare, owner giả, storage lỗi/restart, conflict, create lặp. Browser: bốn góc/trung tính, detail bằng bàn phím/chạm, đọc không cần màu, hũ trống/lớn, resize, reduced motion, đổi tab/logout. Test canvas có thể mock globals như test background; focus/layout thật cần CDP.

### 12. Mở rộng tương lai

Physics 2D hoặc WebGL/3D tùy chọn với list dự phòng, label riêng, lọc/export. Không chẩn đoán AI, xếp hạng mood, streak gây áp lực hoặc dự đoán mối quan hệ.
