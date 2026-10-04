# Shared Playground / Góc chia sẻ

## English

### 1. Feature description

A future private two-person Padlet/feed for intentional asynchronous exchanges. It is a shared place to leave something for each other, not a social network or full real-time chat. Follow the [shared conventions](README.md#proposed-engineering-conventions).

### 2. User experience / expected behavior

Write a thought, message, or question; the other person can read it when they return, react, and reply. Explicitly shared [Journal](01-personal-journal.md) entries arrive as previewed snapshots. “Save as Memory” opens a curation form rather than automatically turning every exchange into permanent history. Show both authors and dates; no read receipts or pressure to reply.

### 3. Functional requirements

MVP: text posts, a chronological paginated feed, author edits/archive, plain-text replies, and a small confirmed reaction vocabulary. Suggested post limit 4000 characters and reply limit 1000, additionally bounded by JSON bytes. One reaction per user/type/post; repeating the same action is idempotent. A later integration accepts journal snapshots and [Memory](05-memories.md) conversion. Photos, links, activity cards, and saved seminar ideas are later typed content, not arbitrary executable embeds.

### 4. Architecture

Suggested `js/playground.js` in the private dashboard and `backend/playground.js`. Standalone posts have no Journal dependency. Separate post/reply/reaction records so partner contributions are not overwritten when the post author edits. Reuse the session API client; fetch on view entry and explicit refresh for MVP. No WebSocket, polling loop, service worker, or general event bus is required.

### 5. Suggested data model

`SharedPost { id, authorId, kind: text|journalSnapshot, body, occurredAt, timeZone, sourceJournalId?, sourceJournalVersion?, mediaIds[], createdAt, updatedAt, archivedAt?, revokedAt?, version }`.

`Reply { id, postId, authorId, body, createdAt, updatedAt, archivedAt?, version }`; `Reaction { postId, userId, type, createdAt }`. Memory links are derived. Source-journal IDs are internal provenance, not permission to read that journal. A journal snapshot does not include a private mood note. Future activity/link attachments use typed source IDs with their own authorization checks.

### 6. Frontend responsibilities

Accessible feed/composer and reply forms; distinguish “shared with both” from journal privacy. Use text rendering, readable timestamps, empty/error/retry states, and in-memory failure drafts. Prevent duplicate submits; reconcile responses with current identity and mount signal. Hide feature data immediately on logout/account change. No public-profile insertion or infinite background fetching.

### 7. Backend/API responsibilities

Proposed `GET/POST /api/posts`, `GET/PUT /api/posts/:id`, `POST /api/posts/:id/archive`; `GET/POST /api/posts/:id/replies`, `PUT /api/replies/:id`, `POST /api/replies/:id/archive`; `POST /api/posts/:id/reactions` accepting `{ type, active, requestId }`. Later `POST /api/posts/:id/save-memory` uses Memory rules. Creates accept `requestId`, changes accept `version` where applicable; server sets authors.

Both members read active shared posts; only authors edit/archive their text, only reply authors edit/archive replies, and each user changes their own reactions. An archived parent hides replies/reactions from the active feed but preserves them for an authorized history view; a revoked parent must not reveal source text through replies, previews, counts, or Memory snapshots. Journal-source revocation follows the overview's atomic policy. Do not log content.

### 8. Important edge cases

A stale reply cannot attach to a revoked/archived post. Double reaction/save-memory retry does not duplicate content. Post-edit conflicts retain the attempted text. A post with no replies remains a valid Memory candidate. Archived versus revoked states have different access semantics and UI wording. Later link previews must not execute arbitrary HTML or fetch untrusted URLs server-side without a separate design.

### 9. Privacy / permission considerations

All reads require membership; guests receive no feed, IDs, media URLs, or counts. Partner access to a post never grants access to its private journal source. Neither partner may rewrite the other's reply. Saving content as a Memory does not widen its audience; source revocation propagates to derived content. Caches must be per identity and discarded on identity change.

### 10. TODO checklist

- [ ] MVP: confirm composer, feed order, reaction vocabulary, archive wording, and storage.
- [ ] MVP: implement post/reply/reaction validation, session policy, persistence, and pagination.
- [ ] MVP: implement accessible feed/editor, retry, conflicts, and cleanup.
- [ ] MVP: test two-member behavior and guest/forged-author denial.
- [ ] Integration: accept explicit journal snapshots and Memory conversion atomically.
- [ ] Later: protected photos, safe links, questions/activity cards, seminar references.

### 11. Testing requirements

Node: authorship and reply ownership, reaction uniqueness, private-source denial, guest denial, revoked parent access, pagination, retry deduplication, concurrent edits, CSRF, body limits, failure/restart persistence. Browser: asynchronous refresh, safe text/XSS rendering, keyboard reply flow, failed draft recovery, rapid tab switches, logout clears feed, touch targets and reduced motion. No test assumes real-time delivery.

### 12. Future extensions

Typed posts, protected media, pinning, search, and optional notifications only if requested. Real-time chat, online presence, public discovery, followers, and engagement rankings are outside this proposal.

---

## Tiếng Việt

### 1. Mô tả tính năng

Đề xuất một Padlet/feed riêng cho hai người, trao đổi có chủ đích và không cần cùng online. Đây là nơi để lại điều muốn gửi cho nhau, không phải mạng xã hội hay chat real-time đầy đủ. Theo [quy ước chung](README.md#quy-ước-kỹ-thuật-được-đề-xuất).

### 2. Trải nghiệm / hành vi mong đợi

Viết suy nghĩ, lời nhắn hoặc câu hỏi; người kia đọc khi quay lại, thả cảm xúc và trả lời. [Nhật ký](01-personal-journal.md) chỉ xuất hiện bằng snapshot được preview và chia sẻ rõ ràng. “Giữ làm kỷ niệm” mở form chọn lọc, không tự biến mọi trao đổi thành lịch sử lâu dài. Hiện tác giả và ngày; không read receipt hay thúc giục trả lời.

### 3. Yêu cầu chức năng

MVP: bài chữ, feed theo thời gian có phân trang, tác giả sửa/archive, reply chữ và bộ reaction nhỏ được chốt. Gợi ý bài tối đa 4000 ký tự, reply 1000, đồng thời giới hạn byte JSON. Mỗi user/type/post chỉ một reaction; thao tác lặp không nhân bản. Tích hợp sau nhận snapshot nhật ký và chuyển [Kỷ niệm](05-memories.md). Ảnh/link/card hoạt động/ý tưởng seminar là kiểu nội dung sau này, không phải embed tùy ý có thể chạy code.

### 4. Kiến trúc

Gợi ý `js/playground.js` trong dashboard riêng, `backend/playground.js`. Bài độc lập không phụ thuộc Nhật ký. Tách post/reply/reaction để sửa bài không ghi đè phần partner viết. Dùng API client session, tải khi vào view và refresh thủ công. MVP không cần WebSocket, polling liên tục, service worker hoặc event bus tổng quát.

### 5. Mô hình dữ liệu gợi ý

`SharedPost { id, authorId, kind: text|journalSnapshot, body, occurredAt, timeZone, sourceJournalId?, sourceJournalVersion?, mediaIds[], createdAt, updatedAt, archivedAt?, revokedAt?, version }`.

`Reply { id, postId, authorId, body, createdAt, updatedAt, archivedAt?, version }`; `Reaction { postId, userId, type, createdAt }`. Link Memory suy ra từ tham chiếu. ID nhật ký nguồn chỉ phục vụ provenance nội bộ, không cấp quyền đọc. Snapshot không chứa note cảm xúc riêng. Card/link sau này tham chiếu ID có kiểu và kiểm tra quyền riêng.

### 6. Trách nhiệm frontend

Feed/composer/reply dễ dùng bằng bàn phím; phân biệt “cả hai cùng xem” với riêng tư của nhật ký. Render chữ an toàn, ngày dễ đọc, trạng thái trống/lỗi/retry và nháp RAM khi lỗi. Chặn submit lặp, chỉ nhận response đúng danh tính và signal. Xóa dữ liệu khi logout/đổi tài khoản. Không nhét vào hồ sơ public hoặc fetch nền vô hạn.

### 7. Trách nhiệm backend/API

Đề xuất `GET/POST /api/posts`, `GET/PUT /api/posts/:id`, `POST /api/posts/:id/archive`; `GET/POST /api/posts/:id/replies`, `PUT /api/replies/:id`, `POST /api/replies/:id/archive`; `POST /api/posts/:id/reactions` nhận `{ type, active, requestId }`. Sau đó `POST /api/posts/:id/save-memory` theo quy tắc Memory. Create nhận `requestId`, change nhận `version` khi phù hợp; server đặt tác giả.

Hai thành viên đọc bài chung đang hoạt động; chỉ tác giả sửa/archive bài, tác giả reply sửa/archive reply, mỗi người đổi reaction của mình. Parent archive ẩn reply/reaction khỏi feed nhưng giữ cho history đúng quyền; parent revoked không được làm lộ nội dung qua reply/preview/count/Memory. Thu hồi nguồn nhật ký theo chính sách atomic trong overview. Không log nội dung.

### 8. Tình huống biên quan trọng

Reply cũ không được gắn vào bài vừa thu hồi/archive. Retry reaction/save-memory không nhân bản. Conflict khi sửa giữ chữ đang nhập. Bài chưa có reply vẫn có thể thành Memory. Archive và revoke khác quyền, cần wording rõ. Preview link sau này không chạy HTML tùy ý hoặc fetch URL không tin cậy trên server nếu chưa có thiết kế riêng.

### 9. Riêng tư / phân quyền

Mọi read cần membership; guest không thấy feed/ID/URL media/count. Đọc bài không cho partner đọc nhật ký nguồn. Không ai sửa reply của người kia. Chuyển Memory không mở thêm người xem; thu hồi nguồn truyền tới nội dung suy ra. Cache theo danh tính và xóa khi đổi người.

### 10. Checklist TODO

- [ ] MVP: chốt composer, thứ tự feed, reaction, wording archive và storage.
- [ ] MVP: validate/quyền/lưu trữ/phân trang post, reply, reaction.
- [ ] MVP: feed/editor accessible, retry/conflict/cleanup.
- [ ] MVP: test hai thành viên, guest và author giả.
- [ ] Tích hợp: snapshot nhật ký và chuyển Memory atomic.
- [ ] Sau: ảnh riêng, link an toàn, card câu hỏi/hoạt động, seminar.

### 11. Yêu cầu kiểm thử

Node: quyền post/reply, reaction duy nhất, từ chối nguồn riêng/guest, parent revoked, phân trang, retry, sửa đồng thời, CSRF, body quá giới hạn, storage lỗi/restart. Browser: refresh bất đồng bộ, render an toàn/XSS, reply bằng bàn phím, phục hồi nháp, đổi tab nhanh, logout xóa feed, target chạm và reduced motion. Không giả định nhận bài real-time.

### 12. Mở rộng tương lai

Bài có kiểu, media riêng, ghim/tìm kiếm, thông báo nếu được yêu cầu. Chat real-time, trạng thái online, khám phá công khai, follower và xếp hạng tương tác không nằm trong đề xuất.
