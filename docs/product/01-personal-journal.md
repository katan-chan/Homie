# Personal Journal / Nhật ký cá nhân

## English

### 1. Feature description

Future proposal: Minh's Corner and Yến's Corner are lightweight personal journal/Padlet spaces, separate from their existing public profile tabs. A thought belongs to its author before it belongs to the relationship. Follow the [shared conventions](README.md#proposed-engineering-conventions).

### 2. User experience / expected behavior

Open your authenticated corner, write a dated thought, optionally link your own mood and add tags, then save privately. Saved entries appear in a simple chronological board/list. A conspicuous “Share with Minh/Yến” action previews the exact content being shared; nothing is shared by opening or saving an entry. A shared post can later be kept as a [Memory](05-memories.md). No posting streaks or obligation to share.

### 3. Functional requirements

MVP: create/read/edit/archive private text entries; list by date with pagination; tags; optional authorized mood reference. Suggested text limit 4000 characters, at most 10 tags of 30 characters, subject also to the 8192-byte body limit. Save explicitly; no automatic public publishing. Start with a saved state rather than a draft/published workflow.

Integration slice: share/unshare with [Playground](02-shared-playground.md). Interpret `PRIVATE` / `SHARED` as disclosure state; `MEMORY` is a derived badge when a linked Memory exists, not a third permission level. If drafts are added later, `draft`/`saved` remains independent of visibility; “published” must never imply public access.

### 4. Architecture

Suggested `js/journal.js` inside the authenticated dashboard and `backend/journal.js` for domain logic; final filenames/navigation require confirmation. Keep `js/profile.js` and public profile GET unchanged. Owner-scoped reads work independently; sharing depends on Playground. Sharing atomically creates a text snapshot and sets the entry's shared-post link. Journal edits affect only the journal; updating the snapshot requires another explicit previewed action. Never implement sharing by allowing the partner to fetch the private entry.

### 5. Suggested data model

`JournalEntry { id, authorId, body, occurredAt, timeZone, tags[], moodEntryId?, visibility: PRIVATE|SHARED, sharedPostId?, createdAt, updatedAt, archivedAt?, version }`.

`memoryIds`/`MEMORY` badge are derived from authorized references, not duplicated memory stories. Owner ID and timestamps come from the session/server. `moodEntryId` must be the author's record; sharing a journal does not share that mood or its private note. Proposed later `mediaIds[]` and draft state are outside text MVP.

### 6. Frontend responsibilities

Show privacy beside save/share controls, accessible labelled editor, empty/loading/error states, and archive confirmation. Use `textContent`; keep private text out of URL/hash. Preserve an unsaved draft in memory on save failure or expiry for the same identity; warn before destructive navigation where feasible. Clear it on logout/account switch/unmount. Abort fetches, reject late callbacks, and return idempotent cleanup. Do not add sample entries.

### 7. Backend/API responsibilities

Proposed routes: `GET/POST /api/journal`; `GET/PUT /api/journal/:id`; `POST /api/journal/:id/archive`; later `POST .../share` and `POST .../unshare`. List always scopes to session author; partner requests cannot obtain private entry details even when a shared snapshot exists. Writes accept validated entry fields plus `requestId` for creates/actions and `version` for updates/actions. Reject client authors, unknown fields, invalid dates/tags/mood IDs. Return `{ record }` or paginated `{ items, nextCursor }` and errors per overview.

Unshare clears the link/disclosure state, revokes the shared snapshot, and makes linked Memory content unavailable to the partner and derived calendar/garden. Archiving a private original does not silently revoke an intentionally shared snapshot: offer separate unshare and explain the difference. Persist these operations atomically with authorization and retry deduplication.

### 8. Important edge cases

Double-click share returns one post; failed save never reports success. Two windows editing an entry get a version conflict instead of lost text. An archived/inaccessible mood does not expose its note through a dangling link. Partner replies are not copied back into the private journal. If Playground is not implemented, omit share controls entirely. A revoked source produces a neutral unavailable state without cached text.

### 9. Privacy / permission considerations

Guest: no access. Author: CRUD/archive/share/unshare own entries. Partner: no journal access, only explicitly shared snapshots through Playground. The server applies this matrix to detail, lists, search, calendar, media, and counts. Neither public profile HTML nor garden data may contain private entry metadata. Revocation cannot erase what a recipient already read or copied; communicate that without claiming perfect recall of shared information.

### 10. TODO checklist

- [ ] MVP: confirm private-corner placement, editor/date limits, and storage contract.
- [ ] MVP: implement owner-scoped persistence, validation, API and version conflicts.
- [ ] MVP: implement list/editor/archive, error recovery, and identity-safe cleanup.
- [ ] MVP: complete ownership, persistence, mobile, and keyboard acceptance tests.
- [ ] Integration: implement atomic share/unshare snapshots and permission propagation.
- [ ] Later: evaluate server drafts, filters/search, protected media, and export/deletion policy.

### 11. Testing requirements

Node tests: both owners, guest/partner denial, forged author, invalid tags/dates, inaccessible mood, body byte limit, conflicts, failed/restarted storage, duplicate share and revocation propagation. Browser tests: default private save, preview before share, same-user expiry recovery, logout/account change clears text, keyboard forms, mobile overflow, late response after tab exit. Use existing fixture/temporary-server conventions; cross-feature tests are required only when integrations ship.

### 12. Future extensions

Protected media, draft/saved states, richer personal board layouts, tags/search, and intentional selection of a paragraph for sharing. These require separate acceptance criteria; no public journal, automatic partner access, or real-time collaborative editing is implied.

---

## Tiếng Việt

### 1. Mô tả tính năng

Đề xuất tương lai: Góc của Minh và Góc của Yến là nhật ký/Padlet cá nhân gọn nhẹ, tách khỏi tab hồ sơ công khai. Một suy nghĩ trước hết thuộc về người viết. Áp dụng [quy ước chung](README.md#quy-ước-kỹ-thuật-được-đề-xuất).

### 2. Trải nghiệm / hành vi mong đợi

Vào góc riêng sau đăng nhập, viết chuyện có ngày giờ, gắn cảm xúc của mình và tag nếu muốn, rồi lưu riêng. Bản ghi đã lưu hiện theo thời gian. Nút “Chia sẻ với Minh/Yến” phải cho xem trước đúng phần sẽ gửi; mở hoặc lưu nhật ký không tự chia sẻ. Bài chung sau đó có thể thành [Kỷ niệm](05-memories.md). Không có streak hay yêu cầu phải chia sẻ.

### 3. Yêu cầu chức năng

MVP: tạo/xem/sửa/archive nhật ký chữ riêng tư, danh sách theo ngày có phân trang, tag, tham chiếu cảm xúc đúng quyền. Đề xuất tối đa 4000 ký tự, 10 tag dài 30 ký tự; vẫn phải tuân thủ giới hạn body 8192 byte. Lưu bằng thao tác rõ ràng, không tự đăng công khai. Bắt đầu bằng trạng thái đã lưu, chưa cần luồng draft/published.

Lát cắt tích hợp: share/unshare với [Góc chia sẻ](02-shared-playground.md). `PRIVATE`/`SHARED` là quyền chia sẻ; `MEMORY` chỉ là nhãn suy ra khi có kỷ niệm liên kết, không phải mức quyền thứ ba. Nếu thêm draft, trạng thái `draft`/`saved` độc lập với visibility; “published” không có nghĩa ai cũng xem được.

### 4. Kiến trúc

Gợi ý `js/journal.js` trong dashboard đã đăng nhập và `backend/journal.js` cho domain; tên file/điều hướng cần chốt khi làm. Không sửa public GET hay `js/profile.js` để chứa nhật ký. Đọc theo owner chạy riêng được; share cần Góc chia sẻ. Share tạo snapshot chữ và link bài chung trong một commit atomic. Sửa nhật ký chỉ sửa bản gốc; cập nhật snapshot cần preview và thao tác rõ ràng. Không cho người kia gọi API đọc bản gốc riêng.

### 5. Mô hình dữ liệu gợi ý

`JournalEntry { id, authorId, body, occurredAt, timeZone, tags[], moodEntryId?, visibility: PRIVATE|SHARED, sharedPostId?, createdAt, updatedAt, archivedAt?, version }`.

`memoryIds`/nhãn `MEMORY` suy ra từ link đúng quyền, không lưu trùng câu chuyện. Owner và timestamp lấy từ session/server. Cảm xúc liên kết phải thuộc tác giả; chia sẻ nhật ký không tự chia sẻ cảm xúc hoặc note riêng. `mediaIds[]` và trạng thái nháp thuộc giai đoạn sau.

### 6. Trách nhiệm frontend

Hiện quyền riêng tư cạnh nút lưu/chia sẻ, editor có nhãn, trạng thái trống/loading/lỗi và xác nhận archive. Dùng `textContent`, không đặt nội dung vào URL/hash. Giữ nháp trong RAM khi lưu lỗi/hết phiên cho cùng người; cảnh báo trước khi bỏ thay đổi nếu phù hợp. Xóa khi logout/đổi người/unmount. Abort fetch, chặn callback muộn, cleanup gọi lại an toàn. Không tạo ghi chép mẫu.

### 7. Trách nhiệm backend/API

Route đề xuất: `GET/POST /api/journal`; `GET/PUT /api/journal/:id`; `POST /api/journal/:id/archive`; sau đó `POST .../share`, `POST .../unshare`. List luôn theo tác giả từ session; partner không đọc được chi tiết nhật ký dù đã có snapshot chung. Write nhận field hợp lệ cùng `requestId` cho create/action, `version` cho update/action. Từ chối author giả, field lạ, ngày/tag/mood ID sai. Response và lỗi theo overview.

Unshare xóa link/trạng thái chia sẻ, thu hồi snapshot và gỡ nội dung Memory phụ thuộc khỏi người kia, lịch, vườn. Archive nhật ký gốc không tự thu hồi snapshot đã chủ động chia sẻ: cung cấp unshare riêng và giải thích rõ. Lưu atomic, kiểm tra quyền và chống lặp khi retry.

### 8. Tình huống biên quan trọng

Bấm share hai lần chỉ tạo một bài; lưu lỗi không báo thành công. Sửa từ hai cửa sổ trả conflict thay vì mất chữ. Cảm xúc bị archive/không còn quyền không làm lộ note qua link hỏng. Reply của partner không sao chép vào nhật ký riêng. Chưa có Góc chia sẻ thì không hiện nút share. Nguồn thu hồi hiện thông báo trung tính, không giữ chữ trong cache.

### 9. Riêng tư / phân quyền

Guest không được đọc. Tác giả tạo/xem/sửa/archive/share/unshare bài của mình. Partner không đọc nhật ký, chỉ đọc snapshot được gửi qua Góc chia sẻ. Server áp dụng cho chi tiết/list/search/lịch/media/số lượng. HTML hồ sơ và dữ liệu vườn không chứa metadata nhật ký riêng. Thu hồi không thể xóa điều người kia đã đọc hoặc tự sao chép; không hứa khả năng đó.

### 10. Checklist TODO

- [ ] MVP: chốt vị trí góc riêng, giới hạn editor/ngày và storage.
- [ ] MVP: lưu theo owner, validate, API, version conflict.
- [ ] MVP: list/editor/archive, phục hồi lỗi, cleanup theo danh tính.
- [ ] MVP: test quyền, persistence, mobile, bàn phím.
- [ ] Tích hợp: share/unshare atomic và truyền quyền thu hồi.
- [ ] Sau: cân nhắc nháp server, lọc/tìm kiếm, media riêng, export/xóa.

### 11. Yêu cầu kiểm thử

Node: hai owner, guest/partner bị từ chối, author giả, ngày/tag sai, mood sai quyền, body quá byte, conflict, storage lỗi/restart, share lặp, thu hồi lan sang dữ liệu phụ thuộc. Browser: lưu mặc định riêng, preview trước share, phục hồi hết phiên cùng người, xóa chữ khi logout/đổi người, form bàn phím, overflow mobile, response muộn sau rời tab. Dùng fixture/server tạm hiện có; test tích hợp khi triển khai liên kết.

### 12. Mở rộng tương lai

Media riêng, draft/saved, bố cục bảng cá nhân, tag/tìm kiếm và chọn một đoạn để chia sẻ. Mỗi phần cần tiêu chí riêng; không ngầm có nhật ký công khai, partner tự xem hoặc sửa chung real-time.
