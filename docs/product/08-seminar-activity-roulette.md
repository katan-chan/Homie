# Seminar & Activity Roulette / Bốc thăm chủ đề và hoạt động

## English

### 1. Feature description

A future shared pool of things to discuss, learn, create, explore, play, make and experience together. Example topic: “If humans lived for 500 years, would marriage still work the same way?” Follow [shared conventions](README.md#proposed-engineering-conventions).

### 2. User experience / expected behavior

Add an idea, browse the pool, then press “🌱 Plant a Seed” or “🎲 Pick something for us”. A random eligible idea appears; choose skip or done. Done can include a date, optional notes and each person's optional enjoyment rating. History celebrates experiences without making completion a productivity goal. A seminar is an activity category, not a separate scheduling platform.

### 3. Functional requirements

MVP: idea create/read/edit/archive, categories `Talk`, `Learn/Seminar`, `Create`, `Explore`, `Play`, `Make`, `Relationship`, `Silly`; optional positive estimated duration, random pick, skip, done, optional rating and paginated history. Suggested title 120, description 2000, completion note 1000 characters; duration 1–1440 minutes if supplied; each optional rating is integer 1–5 and means enjoyment only.

Recommend exclude ideas completed in the last 14 local calendar days and those skipped in the current session; the repeat window is an open decision. If none qualify, show why and offer an explicit reset/relax action, never silently repeat. Uniform random is sufficient; no machine learning. An idea may be repeated later; completion belongs to an occurrence, not a permanent `completed` Boolean on the idea.

### 4. Architecture

Suggested `backend/activities.js`, `js/activities.js`: pool/filter input -> validated eligibility -> server random selection -> persisted selection/completion -> API -> card/history -> [Calendar](04-relationship-calendar.md), optional [Memory](05-memories.md)/[Playground](02-shared-playground.md) references and [Garden](10-garden-integration.md) opt-in. Inject a random source for pure-function tests rather than asserting chance. Server-side selection lets two devices agree on one current pick; no realtime channel needed.

### 5. Suggested data model

`Activity { id, createdBy, title, description, category, estimatedDurationMinutes?, createdAt, updatedAt, archivedAt?, version }`.

`ActivitySession { id, selectedBy, activityId, status: picked|skipped|completed, selectedAt, completedAt?, occurredAt?, timeZone, notes?, ratingsByUser, gardenOptIn: false, version }`.

An `ActivityCompletion` is the completed form of a session, not another duplicated record in MVP. Display `completed`, latest `completedAt` or average enjoyment only as derived convenience fields. Skipped idea IDs can be maintained in mounted session state; a persisted pick retains one source ID and its history identity. Notes belong to their author or require a selected shared-edit policy; recommend completion recorder owns notes. Source links always recheck access.

### 6. Frontend responsibilities

Editable pool, clear category labels, picked card, skip/done controls, optional rating, history and honest no-eligible state. Disable duplicate pending picks/completions; retry without another completion. Preserve failed input drafts, accessible keyboard controls, reduced-motion reveal and 44 px targets. Do not add default sample ideas to stored data. Clear session/cards/private notes on identity changes and cleanup.

### 7. Backend/API responsibilities

Proposed `GET/POST /api/activities`, `GET/PUT /api/activities/:id`, `POST /api/activities/:id/archive`; `POST /api/activity-picks` accepts optional category filter and session-skipped IDs plus `requestId`; `GET /api/activity-history`; `POST /api/activity-sessions/:id/skip`, `POST .../complete`, `POST .../rating`.

Members read pool/history; creators edit/archive their ideas. Recommend either member can mark a shared picked session done/skip, protected by version and terminal-state checks; a person edits only their own rating. Actor always comes from session. Validate IDs/status/duration/category/time/text, persist one pick/completion atomically with deduplication, recheck source eligibility at write time. No client-supplied aggregate rating or completed count. Text notes/rating do not automatically create a Memory.

### 8. Important edge cases

Empty pool, all ideas recent/skipped, archived idea selected on another device, two simultaneous picks or completions, future/backdated completion and missing duration. Retain a neutral history reference for an archived idea without resurrecting it in the pool. Both users completing the same session creates one completion; two genuine sessions of the same idea remain separate. A rating change updates that person's rating only.

### 9. Privacy / permission considerations

Pool, notes, ratings and history are shared only between the two members. Public garden growth may not expose titles or private notes; Garden requires its own authorized opt-in. Enjoyment ratings describe an activity, not the partner or relationship. No ranking who completed more.

**Open Design Decision:** fixed recent-completion exclusion is predictable but can empty a small pool; weighted repetition allows more choices but is harder to explain. Recommend uniform picks with explicit reset and a configurable 14-day starting proposal. Author-only idea edits are simple; co-editing could be useful but needs version/ownership agreement. Confirm concurrent-pick UX (one shared current pick versus independent picks); recommend one current shared pick, resumed if it exists.

### 10. TODO checklist

#### Phase 1 — Domain (MVP)

- [ ] Confirm repeat window, one-current-pick behavior, edit/note rights and rating meaning.
- [ ] Define Activity/session schema, category/duration validation and eligibility function.

#### Phase 2 — Backend (MVP)

- [ ] Add pool persistence/routes, authorized filtering and deterministic-testable random pick.
- [ ] Add pick/skip/complete/rating transitions, history, versions and deduplication.

#### Phase 3 — Frontend (MVP)

- [ ] Build pool editor/pick card/skip/done/rating/history and explicit empty/reset states.
- [ ] Handle pending actions, retry, keyboard/mobile and identity cleanup.

#### Phase 4 — Integration

- [ ] Expose completion references to Calendar; optional explicit post/Memory creation later.
- [ ] Add opted-in seed/sprout descriptors only after Garden integration is selected.

#### Phase 5 — Tests / later

- [ ] Test eligibility/time window/empty pool, injected RNG, concurrent transitions and UI retry.
- [ ] Later: time/indoor/outdoor/budget/energy filters, weighted random and enjoyment-based suggestions.

### 11. Testing requirements

Node: allowlisted category, duration/text limits, actor/creator policy, seeded/injected random selection, recent exclusions, no eligible result, archived source, current-pick races, double done, terminal states, per-user ratings, storage failures and pagination. Browser: pick/skip/done, honest reset confirmation, failed retry keeps state, accessible motion/card controls, small screens, logout and late-response cleanup. Do not test actual randomness by expecting a particular real random outcome.

### 12. Future extensions

Weighted selection, time/budget/location/energy filters, safe saved links, user-authored seminar prompts and simple rating-based heuristics. No ML, automatic activities from sensitive moods, paid recommendation service, or mandatory completion quota.

---

## Tiếng Việt

### 1. Mô tả tính năng

Kho chung để bàn luận, học, sáng tạo, khám phá, chơi, làm và trải nghiệm cùng nhau. Ví dụ: “Nếu con người sống 500 năm, hôn nhân có còn như bây giờ không?”. Theo [quy ước chung](README.md#quy-ước-kỹ-thuật-được-đề-xuất).

### 2. Trải nghiệm / hành vi mong đợi

Thêm/xem ý tưởng rồi bấm “🌱 Gieo một hạt” hoặc “🎲 Chọn gì đó cho tụi mình”. Hiện ý tưởng đủ điều kiện ngẫu nhiên; bỏ qua hoặc xong. Khi xong có ngày, note và mỗi người đánh giá độ thích tùy chọn. History ghi nhận trải nghiệm, không mục tiêu năng suất. Seminar là category hoạt động, không hệ lịch riêng.

### 3. Yêu cầu chức năng

MVP: tạo/xem/sửa/archive ý tưởng; category `Talk`, `Learn/Seminar`, `Create`, `Explore`, `Play`, `Make`, `Relationship`, `Silly`; thời lượng dương tùy chọn, random, skip/done/rating/history phân trang. Title gợi ý 120, description 2000, note hoàn thành 1000 ký tự; duration 1–1440 phút nếu có; rating từng người số nguyên 1–5 chỉ mức thích.

Đề xuất bỏ ý tưởng đã hoàn thành trong 14 ngày địa phương gần nhất và đã skip trong session hiện tại; cửa sổ lặp còn mở. Hết lựa chọn thì giải thích và cho reset/nới điều kiện rõ ràng, không lặp âm thầm. Uniform random đủ, không ML. Ý tưởng được làm lại; completion thuộc lần thực hiện, không Boolean `completed` vĩnh viễn trên idea.

### 4. Kiến trúc

Gợi ý `backend/activities.js`, `js/activities.js`: pool/filter -> validate đủ điều kiện -> server random -> lưu lần chọn/hoàn thành -> API -> card/history -> tham chiếu [Lịch](04-relationship-calendar.md), [Memory](05-memories.md)/[Góc chia sẻ](02-shared-playground.md) tùy chọn, opt-in [Vườn](10-garden-integration.md). Inject RNG để test hàm thuần. Chọn trên server giúp hai thiết bị thống nhất một lượt hiện tại, không cần real-time.

### 5. Mô hình dữ liệu gợi ý

`Activity { id, createdBy, title, description, category, estimatedDurationMinutes?, createdAt, updatedAt, archivedAt?, version }`.

`ActivitySession { id, selectedBy, activityId, status: picked|skipped|completed, selectedAt, completedAt?, occurredAt?, timeZone, notes?, ratingsByUser, gardenOptIn: false, version }`.

`ActivityCompletion` là session đã completed, không bản ghi trùng khác trong MVP. `completed`, `completedAt` mới nhất, độ thích trung bình chỉ suy ra. ID đã skip có thể giữ state của view; lượt chọn được lưu giữ nguồn và ID lịch sử. Note thuộc người viết hoặc cần policy đồng sửa; đề xuất recorder sở hữu note. Link nguồn kiểm tra quyền lại.

### 6. Trách nhiệm frontend

Pool editor, category rõ, picked card, skip/done/rating/history, trạng thái hết lựa chọn trung thực. Khóa action đang chờ, retry không hoàn thành thêm. Giữ nháp lỗi, bàn phím, reveal reduced-motion, target 44 px. Không thêm idea mẫu vào storage. Xóa session/card/note khi đổi người/cleanup.

### 7. Trách nhiệm backend/API

Đề xuất `GET/POST /api/activities`, `GET/PUT /api/activities/:id`, `POST /api/activities/:id/archive`; `POST /api/activity-picks` nhận filter category/ID skip trong session và request ID; `GET /api/activity-history`; `POST /api/activity-sessions/:id/skip`, `POST .../complete`, `POST .../rating`.

Thành viên đọc pool/history; creator sửa/archive idea. Đề xuất cả hai done/skip lượt chung, có version/terminal-state; mỗi người sửa rating mình. Actor từ session. Validate ID/status/duration/category/giờ/chữ, lưu pick/completion atomic cùng chống lặp, kiểm tra nguồn còn đủ điều kiện tại write. Không nhận aggregate rating/count client. Note/rating không tự tạo Memory.

### 8. Tình huống biên quan trọng

Pool trống, mọi idea mới làm/skip, idea vừa archive ở thiết bị khác, hai lượt chọn/complete đồng thời, nhập thời gian tương lai/quá khứ, thiếu duration. History tham chiếu trung tính idea archive, không đưa lại pool. Hai người done cùng session chỉ một completion; hai session thật cùng idea vẫn khác nhau. Sửa rating chỉ thay rating người đó.

### 9. Riêng tư / phân quyền

Pool/note/rating/history chỉ hai người. Vườn public không lộ title/note; vườn có quyền/opt-in riêng. Rating chấm hoạt động, không người yêu/mối quan hệ. Không xếp hạng ai làm nhiều hơn.

**Open Design Decision / Quyết định thiết kế còn mở:** loại cố định dễ hiểu nhưng pool nhỏ dễ hết; weighted repeat nhiều lựa chọn nhưng khó giải thích. Đề xuất uniform, reset rõ, 14 ngày cấu hình làm điểm khởi đầu. Creator-only đơn giản; đồng sửa cần version/thỏa thuận. Chốt một lượt chung hiện tại hay lượt độc lập; đề xuất một lượt chung, có thì resume.

### 10. Checklist TODO

#### Giai đoạn 1 — Domain (MVP)

- [ ] Chốt cửa sổ lặp/lượt chung/quyền edit-note/ý nghĩa rating.
- [ ] Schema idea/session, category/duration, hàm eligibility.

#### Giai đoạn 2 — Backend (MVP)

- [ ] Pool persistence/routes, lọc quyền/random test được.
- [ ] Pick/skip/complete/rating, history/version/chống lặp.

#### Giai đoạn 3 — Frontend (MVP)

- [ ] Pool editor/card/skip/done/rating/history, empty/reset rõ.
- [ ] Pending/retry/bàn phím/mobile/cleanup danh tính.

#### Giai đoạn 4 — Tích hợp

- [ ] Completion cho Lịch; sau mới chủ động tạo post/Memory.
- [ ] Descriptor mầm có opt-in sau khi chọn tích hợp Vườn.

#### Giai đoạn 5 — Test / sau

- [ ] Eligibility/time/empty/RNG injected/transition đồng thời/retry UI.
- [ ] Sau: time/indoor-outdoor/budget/energy, weighted random, gợi ý theo độ thích.

### 11. Yêu cầu kiểm thử

Node: category/duration/chữ, actor/creator, RNG inject, cửa sổ vừa làm, hết lựa chọn, nguồn archive, race lượt chung, double done, terminal-state, rating từng người, storage/phân trang. Browser: pick/skip/done, reset có xác nhận, retry giữ state, motion/control accessible, mobile/logout/callback muộn. Không test ngẫu nhiên thật bằng kỳ vọng cố định.

### 12. Mở rộng tương lai

Weighted, filter thời gian/ngân sách/vị trí/năng lượng, link an toàn, chủ đề tự viết, heuristic theo rating. Không ML, gợi ý tự động từ mood nhạy cảm, dịch vụ trả phí hoặc quota hoàn thành.
