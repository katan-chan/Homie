# Homie Product Specification / Đặc tả sản phẩm Homie

## English

### Purpose and status

> Homie is not primarily a productivity dashboard. It is a shared world containing two individual lives and one shared relationship.

These documents specify future experiences for Minh (`minhle`) and Yến (`haiyen`). They are a documentation-only design proposal, not implemented features or permission to start implementation. Suggested names, models, endpoints, and limits are proposals to confirm when each feature is selected. MVP means the smallest proposed implementation, not current functionality. All TODO boxes intentionally remain unchecked.

The supplied brief ends inside its reusable-entities list after `User` and `Journal`; this specification infers the remaining entities from the ten complete feature descriptions. No additional feature is inferred from that unfinished list.

### Experience model

```text
                         HOMIE
                           |
          +----------------+----------------+
          |                |                |
       ME / YOU            US             GARDEN
          |                |                |
       Journal         Playground       visual world
       Mood            Activities       memories
       thoughts        Interaction      milestones
          |                |                |
          +--------+-------+                |
                   |                        |
                   v                        |
               OUR TIME <-------------------+
                   |
               Calendar
               Memories
               Trackers
               History
```

The brief calls these four experience questions but supplies five; this overview retains all five perspectives:

| Perspective | Question |
| --- | --- |
| Me | How am I doing? |
| You | How are you doing, within what you choose to share? |
| Us | What are we doing together? |
| Our Time | What has happened to us? |
| Garden | What has our relationship grown into? |

```text
Daily Mood --optional reference--> Personal Journal
Personal Journal --explicit share--> Shared Playground
Shared Playground --explicit keep--> Memory
Memory --authorized references--> Timeline + Garden

Daily emotion -> Share / interact -> Save meaningful moments
              -> Memory -> Garden grows
```

This core loop is an invitation, never a required sequence. Recording a mood does not automatically publish a journal entry. Quiet days, negative emotions, periods, and apologies must not damage the garden or produce relationship-quality scores.

### Feature index

| Specification | Purpose | Dependencies for an independent MVP |
| --- | --- | --- |
| [01 Personal Journal](01-personal-journal.md) | Two private personal corners with explicit sharing | Session authorization and private storage; sharing requires Playground |
| [02 Shared Playground](02-shared-playground.md) | Asynchronous posts for the two partners | Session authorization and shared storage; standalone posts work without Journal |
| [03 Mood Jar](03-mood-jar.md) | Emotional history using valence and energy | Session authorization and private storage; starts as a 2D view |
| [04 Relationship Calendar](04-relationship-calendar.md) | Daily/monthly views over authorized events | At least one event source; unavailable sources remain absent |
| [05 Memories](05-memories.md) | Moments worth keeping for future selves | Shared storage; manual text memories work without Playground |
| [06 Kiss & Apology Counter](06-kiss-apology-counter.md) | Playful interactions without partner rankings | Shared event storage |
| [07 Period Tracker](07-period-tracker.md) | Sensitive owner-controlled manual tracking | Private storage and field-level access policy |
| [08 Seminar & Activity Roulette](08-seminar-activity-roulette.md) | A pool of things to try together | Shared storage; manual completion history |
| [09 Garden Rules](09-garden-rules.md) | Agreements and the history of their revisions | Shared storage and revision-bound acknowledgements |
| [10 Garden Integration](10-garden-integration.md) | An authorized visual projection of relationship history | At least one eligible source; shell integration requires interface review |

### Actual repository baseline

Read [current scope](../features.md), [architecture](../architecture.md), [interfaces](../interfaces.md), [authentication](../authentication.md), [contributing](../contributing.md), and [deployment](../deployment.md) before implementing. Those files describe running code; this folder describes future design.

- Frontend: HTML, CSS, JavaScript ES modules; no React, Next.js, state framework, or general event bus.
- `js/tabs.js` is the only registry. Four lazy-loaded tabs exist: `garden`, `dashboard`, `minhle`, `haiyen`. Only `dashboard` requires authentication. It is still a placeholder.
- `js/app.js` owns hash navigation, panels, focus, abort, loading, retry, and disposal. Tabs export `render(container, { signal })`; prefer synchronous render and idempotent cleanup. An async render must settle on abort, and late callbacks must not mutate a disposed subtree. Cleanup is not globally serialized across rapid navigation.
- `js/background.js` mounts two shared canvases once. Its cleanup function exposes `update(background)`; the only current option is `showCharacters`. Images, resizing, and setting changes schedule redraws; there is no continuous loop. Tabs inherit the background and must not mount a second full-page scene or import its renderer.
- `js/auth.js` provides `apiRequest`, `getUser`, `refreshSession`, and identity-specific `authEvents`. Requests include cookies; POST/PUT use the `X-Requested-With: Homie` header. Public profiles use `js/profile.js` and remain public.
- Native Node.js 22 backend: `createBackend(frontendOrigins, options)` returns an unlistened HTTP server. `backend/auth.js` uses salted scrypt hashes, HttpOnly session cookies, bounded login work, and rate limits. Sessions are in one process's RAM and disappear on restart.
- Only health, auth, and public profile endpoints exist. Profile text is validated and written through a serialized temporary-file/rename sequence by `backend/profiles.js`. There is no journal, media, calendar, or relationship database.
- `.env` and `.data/` are local runtime data. Build copies only frontend source/assets into `dist/`. The checked-in Vercel config proxies `/api` to Render; that is configuration evidence, not verification of current production behavior. The checked-in free Render config has no durable volume.

### Proposed shared domain vocabulary

| Entity | Meaning and ownership |
| --- | --- |
| User | Existing fixed account ID; public profile text is not private domain storage |
| JournalEntry | Author-owned thought, private by default |
| SharedPost / Reply / Reaction | Intentional two-person exchange; authors own their contributions |
| MoodEntry | Owner-controlled emotional record; sharing is per record |
| Memory | Curated shared story, optionally referencing a shared source and reusable media |
| KissEvent / ApologyEvent | Sender-authored events with recipient-owned acknowledgements |
| ActivityIdea / ActivitySession | Reusable idea versus one selection/completion occurrence |
| CalendarEvent | Manually authored shared occasion; other features remain source records |
| PeriodRecord / PeriodSharing | Yến-owned sensitive record and explicit grant, separate from public profiles |
| Rule / RuleRevision / Agreement | Current agreement plus immutable revisions and version-specific acknowledgements |
| MediaAsset | Future protected file metadata and access references; no upload provider chosen |
| GardenProjection | Derived, viewer-authorized visual descriptors; no second copy of source stories |

There is one fixed two-person relationship in the MVP. Do not introduce registration, additional accounts, multi-tenant relationship management, a generic plugin system, or machine learning. Extract small reusable authorization/date/storage functions only when needed by real consumers.

### Proposed engineering conventions

1. **Navigation:** private feature UI may start inside the existing authenticated dashboard, with feature modules scoped to its container. Whether selected experiences become additional registry tabs is an open UX decision. Keep public profile tabs public; never embed private journal data in their public response. New top-level tabs require `requiresAuth: true` and registry-only registration, without feature branches in the router. No tab IDs are reserved by these specs.
2. **Module ownership:** the app controls routing/focus; feature UI controls its subtree. Requests receive the mount signal. Clear loaded private data on logout/account change, invalidate in-flight responses, and use `authEvents` only for identity changes. Expired-session drafts may remain in memory for the same identity while the view is mounted; explicitly logging out, switching identity, or disposing the view clears them. Do not persist sensitive drafts in localStorage by default. Do not assume the current app automatically clears every future private view.
3. **Backend boundary:** proposed `backend/<domain>.js` modules own validation, policy, and persistence; `backend/server.js` stays the native HTTP entry. Derive the actor from `auth.userId(request)`, never a submitted owner ID. Relationship reads require session membership; private and sensitive records require additional ownership/grant checks. Filter list/detail/aggregate/media/projection results before returning them.
4. **API conventions:** every endpoint in the feature files is proposed and does not exist yet. Prefer GET/POST/PUT already supported by CORS; archive and state actions use POST rather than silently introducing DELETE/PATCH. Validate exact allowlisted fields, JSON MIME, and bounded body size; stay within the current 8192-byte JSON limit for text MVPs. Use existing allowed-Origin and custom-header CSRF checks for all writes. Define allowed methods, HEAD/OPTIONS, errors, and update callers/docs/tests together.
5. **Responses and races:** proposed detail/write responses are `{ record }`, lists `{ items, nextCursor }`. Lists use opaque cursors and `limit` 1–50, default 20, stable ordering by relevant date then ID. Missing session is 401; inaccessible/missing private record is 404; disallowed visible action is 403; validation is 400, MIME 415, oversized JSON 413, conflict 409, and storage failure a generic 500. No unauthorized existence/count leaks. Updates carry `version`; mismatch gives 409 without overwriting. Create/action writes carry `requestId`, deduplicated per actor, operation, and payload in durable storage; retrying the same ID with another payload gives 409. Persist the deduplication outcome with the write, not in session RAM. Final endpoint payloads must enumerate action fields alongside entity fields.
6. **Time:** instant events use UTC ISO timestamps plus captured IANA `timeZone`; user-entered dates remain `YYYY-MM-DD` date-only values. Proposed relationship display zone is `Asia/Bangkok`, to confirm with Minh and Yến. Group instants in the selected display zone; do not parse date-only values through UTC midnight. Weeks start Monday in that zone. Backdated records are supported; `createdAt` is not the event date. Calendar ranges are inclusive start, exclusive end and bounded to 93 days per request.
7. **Storage:** select durable production storage, backup/restore, schema versioning, and access isolation before release. A local-only prototype may follow the existing queued atomic JSON-file pattern in separate private domain files, but it remains one-process storage and is not a production choice. Multi-record share/revoke/save actions need one atomic commit in the chosen store; separate file renames are not a transaction. Do not automatically buy a hosting plan or choose a database/provider here.
8. **Media:** text-first MVPs store `mediaIds: []` or omit media fields. Future `MediaAsset` references prevent duplicate bytes; server checks the parent record's current access before issuing a short-lived URL. No media in `assets/`, public profiles, static build output, logs, or permanent public URLs. Upload validation, private delivery, retention, and orphan cleanup require a separate storage decision; never send base64 uploads through existing text JSON routes.
9. **Shared lifecycle:** journal sharing creates an explicit text snapshot in a SharedPost, not a live private read. Journal edits do not silently change it. Saving that post creates an editable Memory story with source references and shared media IDs. Unsharing/revoking a journal-derived post removes its source content and dependent memory content from the partner, calendar, and garden. Source links resolve only with authorization. A standalone memory has no private-source dependency. References must not widen source permissions; visibility/grant changes invalidate derived results immediately. Partner-written contributions are separate records, not permission to restore revoked source content.
10. **Accessibility and appearance:** Vietnamese UI labels, semantic headings, visible keyboard focus, touch targets at least 44 px, mobile safe areas, and reduced motion remain requirements. Preserve the approved sunset-pink garden, raster flowers, two Loopy, logo behavior, sidebar behavior, and title space. No flower SVGs or automatic visual redesign.

### Suggested delivery order and decisions

Start by confirming private storage and authorization conventions, then implement one standalone slice such as Journal (private-only) or Playground (text-only). Mood, activities, rules, and kiss/apology events can be separate slices. Add sharing and Memory conversion when both source and target exist. Calendar can consume only installed sources. Garden projection comes after eligible sources and permission tests. Period tracking can ship separately only after its sensitive-data boundary is verified.

Open decisions: navigation within dashboard versus new tabs; final field limits and text editing; durable store/media provider and operational costs; confirmation of display timezone; deletion/export/retention policy; exact garden visuals and explicit source opt-ins; optional period sharing and any later estimates. This proposal recommends safe MVP defaults in the feature documents but does not claim these decisions have been approved for implementation.

### Handoff and verification checklist

- [ ] Select one feature and confirm its MVP, open decisions, and dependencies.
- [ ] Write its concrete payload/response examples, permission matrix, persistence/migration plan, and failure semantics before implementation.
- [ ] Implement only that slice; update current scope/interfaces/auth/deployment docs when behavior actually changes.
- [ ] Run `node --check` on changed JS, `npm test` for relevant backend/domain changes, and `npm run build` for frontend/build changes.
- [ ] Run `npm run test:browser` / `npm run test:layout` where UI is affected; these use Chrome CDP port 9333 and running local frontend/API. Auth browser tests require an operator-supplied `AUTH_TEST_PASSWORD`; never commit/log real credentials.
- [ ] Use `node:test` / `node:assert/strict`, fixture credentials, temporary storage, servers on port 0, and guaranteed cleanup. Test missing/expired session, both users, guest, forged IDs, CSRF, write failures, concurrency, and unauthorized aggregates.
- [ ] Test rapid navigation, abort/cleanup, retry, account changes, keyboard/sidebar focus, reduced motion, and the viewport matrix in contributing.md. Confirm no private data appears in build output.
- [ ] Report commands actually run and remaining limitations. Do not infer production readiness from a passing build.

---

## Tiếng Việt

### Mục đích và trạng thái

> Homie không nên trở thành một dashboard quản lý năng suất. Đây là một thế giới chung, bên trong có hai cuộc sống cá nhân và một mối quan hệ cùng được vun đắp.

Bộ tài liệu này mô tả các trải nghiệm tương lai của Minh (`minhle`) và Yến (`haiyen`). Đây là đề xuất thiết kế chỉ bằng tài liệu, không phải tính năng đã chạy hoặc chỉ dẫn bắt đầu triển khai. Tên, model, API và giới hạn được đề xuất cần xác nhận khi chọn làm từng tính năng. MVP là phiên bản tối thiểu dự kiến, không phải hiện trạng. Các ô TODO cố ý chưa được đánh dấu hoàn thành.

Nội dung đính kèm kết thúc giữa danh sách entity dùng chung, sau `User` và `Journal`; các entity còn lại được suy ra từ mô tả đầy đủ của mười tính năng. Không suy đoán thêm tính năng từ phần bị thiếu.

### Mô hình trải nghiệm

```text
                         HOMIE
                           |
          +----------------+----------------+
          |                |                |
      MÌNH / BẠN        TỤI MÌNH          KHU VƯỜN
          |                |                |
       Nhật ký         Góc chia sẻ      thế giới hình ảnh
       Cảm xúc         Hoạt động        kỷ niệm
       suy nghĩ        Tương tác        cột mốc
          |                |                |
          +--------+-------+                |
                   |                        |
                   v                        |
          THỜI GIAN CỦA TỤI MÌNH <-----------+
                   |
                  Lịch
                 Kỷ niệm
                Theo dõi
                Lịch sử
```

Yêu cầu gọi là bốn câu hỏi nhưng liệt kê năm; tài liệu giữ đủ năm góc nhìn:

| Góc nhìn | Câu hỏi |
| --- | --- |
| Mình | Hôm nay mình thế nào? |
| Bạn | Bạn thế nào, trong những điều bạn muốn chia sẻ? |
| Tụi mình | Tụi mình đang cùng làm gì? |
| Thời gian của tụi mình | Những gì đã xảy ra với tụi mình? |
| Khu vườn | Mối quan hệ của tụi mình đã vun đắp nên điều gì? |

```text
Cảm xúc hằng ngày --liên kết tùy chọn--> Nhật ký cá nhân
Nhật ký --chủ động chia sẻ--> Góc chia sẻ
Góc chia sẻ --chủ động giữ lại--> Kỷ niệm
Kỷ niệm --tham chiếu đúng quyền--> Dòng thời gian + Khu vườn

Cảm xúc -> Chia sẻ / tương tác -> Giữ lại khoảnh khắc ý nghĩa
        -> Kỷ niệm -> Khu vườn lớn lên
```

Luồng này là lời mời, không phải việc phải làm mỗi ngày. Ghi cảm xúc không tự đăng nhật ký. Ngày yên lặng, cảm xúc buồn, kỳ kinh và lời xin lỗi không làm vườn héo hay tạo điểm số chất lượng mối quan hệ.

### Danh mục tính năng

| Đặc tả | Mục đích | Phụ thuộc để làm MVP riêng |
| --- | --- | --- |
| [01 Nhật ký cá nhân](01-personal-journal.md) | Hai góc riêng, chia sẻ có chủ đích | Session và lưu trữ riêng; chia sẻ cần Góc chia sẻ |
| [02 Góc chia sẻ](02-shared-playground.md) | Bài viết bất đồng bộ cho hai người | Session và lưu trữ chung; bài độc lập không cần Nhật ký |
| [03 Hũ cảm xúc](03-mood-jar.md) | Lịch sử cảm xúc theo sắc thái và năng lượng | Session và lưu trữ riêng; bắt đầu bằng 2D |
| [04 Lịch mối quan hệ](04-relationship-calendar.md) | Xem ngày/tháng từ sự kiện được phép đọc | Ít nhất một nguồn; nguồn chưa làm không xuất hiện |
| [05 Kỷ niệm](05-memories.md) | Những điều muốn gửi tới bản thân tương lai | Lưu trữ chung; nhập chuyện bằng chữ không cần Góc chia sẻ |
| [06 Nụ hôn và lời xin lỗi](06-kiss-apology-counter.md) | Tương tác vui, không xếp hạng người yêu | Lưu sự kiện chung |
| [07 Theo dõi kỳ kinh](07-period-tracker.md) | Yến tự kiểm soát dữ liệu nhạy cảm | Lưu trữ riêng và quyền theo từng nhóm thông tin |
| [08 Bốc thăm chủ đề và hoạt động](08-seminar-activity-roulette.md) | Kho ý tưởng cùng trải nghiệm | Lưu trữ chung; lịch sử hoàn thành thủ công |
| [09 Nội quy khu vườn](09-garden-rules.md) | Thỏa thuận và lịch sử thay đổi | Lưu trữ chung, xác nhận gắn với phiên bản |
| [10 Kết nối khu vườn](10-garden-integration.md) | Biểu diễn lịch sử bằng hình ảnh đúng quyền | Ít nhất một nguồn phù hợp; cần review interface của shell |

### Nền tảng thực tế của repository

Trước khi triển khai, đọc [phạm vi](../features.md), [kiến trúc](../architecture.md), [interface](../interfaces.md), [đăng nhập](../authentication.md), [quy tắc và kiểm tra](../contributing.md), [deploy](../deployment.md). Các tài liệu đó mô tả code đang có; thư mục này mô tả thiết kế tương lai.

- Frontend dùng HTML, CSS, JavaScript ES modules; không có React, Next.js, framework state hay event bus tổng quát.
- `js/tabs.js` là registry duy nhất. Bốn tab tải lazy là `garden`, `dashboard`, `minhle`, `haiyen`; chỉ `dashboard` yêu cầu đăng nhập và vẫn giữ chỗ.
- `js/app.js` sở hữu hash, panel, focus, abort, loading, retry và disposal. Tab xuất `render(container, { signal })`, ưu tiên render đồng bộ và cleanup gọi lại an toàn. Render async phải kết thúc khi abort; callback muộn không được sửa subtree đã dọn. Cleanup không được tuần tự hóa toàn cục khi đổi tab nhanh.
- `js/background.js` mount hai canvas chung một lần. Cleanup có `update(background)`; tùy chọn hiện có duy nhất là `showCharacters`. Tải ảnh, resize, đổi cấu hình mới lên lịch vẽ; không có vòng animation liên tục. Tab kế thừa nền, không tự mount cảnh toàn trang hoặc import renderer.
- `js/auth.js` cung cấp `apiRequest`, `getUser`, `refreshSession`, `authEvents` dành riêng cho danh tính. Request gửi cookie; POST/PUT gửi `X-Requested-With: Homie`. Hồ sơ dùng `js/profile.js` và tiếp tục là nội dung công khai.
- Backend Node.js native 22: `createBackend(frontendOrigins, options)` trả HTTP server chưa listen. `backend/auth.js` dùng salted scrypt, cookie HttpOnly, giới hạn việc hash và số lần đăng nhập. Session nằm trong RAM một process, mất khi restart.
- Chỉ có API health, auth và hồ sơ công khai. `backend/profiles.js` validate chữ và ghi file tạm rồi rename theo hàng đợi. Chưa có database cho nhật ký, media, lịch hay mối quan hệ.
- `.env`, `.data/` là runtime local. Build chỉ copy frontend và asset vào `dist/`. Cấu hình Vercel đã có proxy `/api` tới Render; điều này chứng minh cấu hình trong repo, không xác nhận production đang hoạt động. Render free trong repo chưa có volume bền.

### Các khái niệm dữ liệu dùng chung được đề xuất

| Entity | Ý nghĩa và quyền sở hữu |
| --- | --- |
| User | ID hai tài khoản hiện có; hồ sơ công khai không lưu dữ liệu riêng |
| JournalEntry | Suy nghĩ thuộc tác giả, mặc định riêng tư |
| SharedPost / Reply / Reaction | Trao đổi có chủ đích; mỗi người sở hữu phần mình viết |
| MoodEntry | Cảm xúc do owner kiểm soát, chia sẻ từng bản ghi |
| Memory | Câu chuyện được giữ lại, có thể tham chiếu nguồn chung và media dùng lại |
| KissEvent / ApologyEvent | Người gửi viết sự kiện, người nhận xác nhận phần của mình |
| ActivityIdea / ActivitySession | Ý tưởng dùng nhiều lần khác với một lần chọn/thực hiện |
| CalendarEvent | Dịp chung nhập tay; dữ liệu tính năng khác vẫn ở nguồn gốc |
| PeriodRecord / PeriodSharing | Bản ghi nhạy cảm của Yến và quyền chia sẻ rõ ràng, tách khỏi hồ sơ |
| Rule / RuleRevision / Agreement | Thỏa thuận hiện tại, lịch sử bất biến, xác nhận từng phiên bản |
| MediaAsset | Metadata và quyền truy cập file trong tương lai; chưa chọn nhà cung cấp |
| GardenProjection | Mô tả hình ảnh suy ra theo quyền người xem, không sao chép câu chuyện |

MVP chỉ có một mối quan hệ của hai tài khoản cố định. Không thêm đăng ký, tài khoản khác, quản lý nhiều cặp, plugin tổng quát hay machine learning. Chỉ tách hàm quyền/ngày/lưu trữ nhỏ khi có nơi dùng thực tế.

### Quy ước kỹ thuật được đề xuất

1. **Điều hướng:** UI riêng có thể bắt đầu trong dashboard đã khóa đăng nhập, module chỉ sở hữu container của mình. Việc thêm tab registry cho trải nghiệm nào là quyết định UX còn mở. Hồ sơ vẫn công khai; không đưa nhật ký riêng vào response hồ sơ. Tab cấp cao mới cần `requiresAuth: true`, chỉ đăng ký trong registry, không thêm nhánh tính năng trong router. Đặc tả chưa giữ trước ID tab.
2. **Vòng đời module:** app sở hữu routing/focus, tính năng sở hữu subtree. Fetch nhận signal. Khi logout/đổi tài khoản phải xóa dữ liệu riêng đã tải, vô hiệu hóa response đang chờ; `authEvents` chỉ thông báo đổi danh tính. Bản nháp khi hết phiên chỉ giữ trong RAM cho cùng người và trong view còn mount; logout chủ động, đổi người hoặc dispose sẽ xóa. Không mặc định lưu nháp nhạy cảm vào localStorage. Không giả định app hiện tại tự xóa mọi view riêng được thêm sau này.
3. **Backend:** module dự kiến `backend/<domain>.js` lo validate, quyền và lưu trữ; `backend/server.js` tiếp tục là HTTP native. Actor lấy từ `auth.userId(request)`, không lấy owner do client gửi. Đọc nội dung chung cần session thành viên; nội dung riêng/nhạy cảm cần thêm owner/grant. Lọc quyền trước khi trả danh sách, chi tiết, tổng hợp, media hoặc projection.
4. **API:** mọi endpoint trong đặc tả đều chưa tồn tại. Ưu tiên GET/POST/PUT đã có trong CORS; archive và thao tác trạng thái dùng POST, không tự thêm DELETE/PATCH. Chỉ nhận field hợp lệ, MIME JSON, body có giới hạn; MVP chữ phải nằm trong giới hạn 8192 byte hiện tại. Mọi write giữ kiểm tra Origin và header chống CSRF. Cập nhật method, HEAD/OPTIONS, lỗi, caller, tài liệu và test cùng lúc.
5. **Response và tranh chấp:** chi tiết/write dự kiến `{ record }`, danh sách `{ items, nextCursor }`. Cursor opaque; `limit` 1–50, mặc định 20, thứ tự ổn định theo ngày phù hợp rồi ID. Thiếu phiên 401; bản ghi riêng không tồn tại/không được xem 404; hành động bị cấm trên bản ghi nhìn thấy 403; validate 400, MIME 415, body quá lớn 413, xung đột 409, lưu lỗi 500 chung. Không lộ sự tồn tại hoặc số lượng dữ liệu không được xem. Update gửi `version`, lệch thì 409 và không ghi đè. Create/action gửi `requestId`, chống lặp theo actor, thao tác, payload trong storage bền; dùng cùng ID với payload khác trả 409. Lưu kết quả chống lặp cùng write, không trong RAM session. Payload cuối cần liệt kê field thao tác cùng field entity.
6. **Thời gian:** sự kiện có giờ lưu ISO UTC và IANA `timeZone` lúc ghi; ngày nhập tay giữ `YYYY-MM-DD`. Đề xuất zone hiển thị chung `Asia/Bangkok`, cần xác nhận với Minh và Yến. Nhóm sự kiện theo zone hiển thị, không đổi ngày thuần thành UTC nửa đêm. Tuần bắt đầu thứ Hai theo zone đó. Cho nhập sự kiện quá khứ; `createdAt` không thay ngày xảy ra. Range lịch gồm ngày đầu, không gồm ngày cuối, tối đa 93 ngày/request.
7. **Lưu trữ:** cần chọn storage bền, backup/restore, version schema và tách quyền trước release. Prototype chỉ local có thể dùng hàng đợi và JSON atomic như hiện tại nhưng ở file domain riêng; vẫn chỉ một process, không phải lựa chọn production. Share/revoke/save nhiều bản ghi cần commit atomic trong storage được chọn; rename nhiều file riêng không tạo transaction. Chưa tự chọn database, media provider hoặc mua gói hosting.
8. **Media:** MVP chữ dùng `mediaIds: []` hoặc chưa có field media. MediaAsset sau này dùng tham chiếu để tránh lưu trùng byte; server kiểm tra quyền hiện tại của bản ghi cha trước khi cấp URL ngắn hạn. Không đặt media trong `assets/`, hồ sơ, dist, log hay URL public vĩnh viễn. Upload, phân phối riêng, retention và dọn file mồ côi cần quyết định storage riêng; không gửi base64 qua API JSON chữ.
9. **Luồng chia sẻ:** chia sẻ nhật ký tạo snapshot chữ có chủ đích trong SharedPost, không mở quyền đọc trực tiếp nhật ký. Sửa nhật ký không tự sửa bài đã chia sẻ. Giữ bài thành Memory tạo câu chuyện có thể sửa, tham chiếu nguồn và media chung. Thu hồi bài từ nhật ký phải gỡ nội dung nguồn và nội dung kỷ niệm phụ thuộc khỏi người kia, lịch và vườn. Link nguồn chỉ mở khi đúng quyền. Kỷ niệm độc lập không phụ thuộc nhật ký riêng. Tham chiếu không mở rộng quyền nguồn; đổi visibility/grant phải vô hiệu hóa dữ liệu suy ra ngay. Phần người kia tự viết là bản ghi riêng, không cho phép khôi phục nội dung đã thu hồi.
10. **Giao diện:** giữ nhãn tiếng Việt, heading semantic, focus rõ, target ít nhất 44 px, safe-area và reduced motion. Giữ vườn hồng hoàng hôn, hoa raster, hai Loopy, logo, sidebar và khoảng trống tiêu đề đã duyệt. Không tạo hoa SVG hoặc tự thiết kế lại.

### Thứ tự gợi ý và quyết định còn mở

Xác nhận storage riêng và quyền trước, rồi chọn một lát cắt độc lập như Nhật ký chỉ riêng tư hoặc Góc chia sẻ chỉ chữ. Cảm xúc, hoạt động, nội quy và nụ hôn/xin lỗi có thể làm riêng. Nối share và chuyển Memory khi cả nguồn/đích đã có. Lịch chỉ đọc nguồn đã triển khai. Projection vườn làm sau nguồn phù hợp và test quyền. Theo dõi kỳ kinh có thể release riêng khi ranh giới dữ liệu nhạy cảm đã được kiểm chứng.

Còn mở: đặt tính năng trong dashboard hay thêm tab; giới hạn field và cách sửa chữ; storage/media provider và chi phí; zone hiển thị; chính sách xóa/export/retention; hình ảnh vườn và opt-in nguồn; chia sẻ kỳ kinh và dự đoán sau này. Đặc tả đề xuất mặc định an toàn nhưng không coi các quyết định này đã được duyệt để code.

### Checklist bàn giao và kiểm chứng

- [ ] Chọn một tính năng, xác nhận MVP, quyết định mở và phụ thuộc.
- [ ] Viết ví dụ payload/response, ma trận quyền, persistence/migration và cách xử lý lỗi trước khi code.
- [ ] Chỉ làm lát cắt đó; cập nhật phạm vi/interface/auth/deploy khi hành vi thật sự đổi.
- [ ] Chạy `node --check` trên JS đã đổi, `npm test` cho backend/domain liên quan, `npm run build` cho frontend/build.
- [ ] Chạy `npm run test:browser` / `npm run test:layout` khi đổi UI; cần Chrome CDP 9333 và frontend/API local. Test auth cần `AUTH_TEST_PASSWORD` do người chạy cung cấp; không commit/log mật khẩu thật.
- [ ] Dùng `node:test`, `node:assert/strict`, credential fixture, storage tạm, port 0, cleanup chắc chắn. Test guest, hai user, phiên thiếu/hết hạn, ID giả, CSRF, lưu lỗi, concurrency và tổng hợp sai quyền.
- [ ] Test đổi tab nhanh, abort/cleanup, retry, đổi tài khoản, bàn phím/focus sidebar, reduced motion và kích thước trong contributing.md. Kiểm tra build không chứa dữ liệu riêng.
- [ ] Báo lệnh đã chạy và giới hạn; build đạt không đồng nghĩa sẵn sàng production.
