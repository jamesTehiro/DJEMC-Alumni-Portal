# Messaging query, concurrency, security, and scalability audit

Audit date: 17 October 2026, Asia/Manila. **Overall health: HIGH RISK for wider production rollout.**

This is an audit, not an optimization implementation. No application code, schemas, conversation identities, roles, messages, or deployment settings were changed. No production load test, Aiven query, external attachment download, real upload, or live message send/delete was performed. Only this report and two JSON evidence artifacts were added.

## A. Overall messaging health

There are useful foundations: authenticated APIs; shared room authorization for HTTP and Socket.IO; cursor pagination in the unified message API; grouped unread counts; bulk participant loading for lists; deterministic direct keys; sender-scoped deletion in the two current message APIs; attachment type/size/signature checks; and client message-ID deduplication.

However, the current implementation is not consistently real-time across roles, has unbounded legacy history/list reads, performs per-recipient database operations on group sends, and exposes a second live route family with weaker policy and deletion semantics. Sending, preview updates, and attachment lifecycle changes are not atomic. Current deployment capacity has not been measured. These are concrete correctness and security concerns as well as optimization opportunities.

**Verdict:** do not certify any of the requested concurrency levels, or approve wider school use, on this evidence. Resolve the high-priority authorization/deletion/delivery gaps, remove the group-send amplification and unbounded reads, then measure an isolated deployment. This does not establish that 100 users necessarily exhaust the infrastructure; it establishes that efficient, correct service at even that level has not been demonstrated.

### Evidence and limitations

- Source inspection covered backend routes/controllers/models, migration declarations, server Socket.IO setup, auth/rate-limit/upload/storage middleware, and all four frontend messaging pages and shared hooks/components.
- Read-only SQL ran against the configured **loopback** database, using a direct mysql2 connection with session transactions set read-only. The application server/startup/sync was not imported. Queries were metadata reads and ordinary `EXPLAIN SELECT`, not `EXPLAIN ANALYZE` or table analysis.
- The local server is **MariaDB 10.4.32**, not the production Aiven MySQL server. Estimated local rows: 31 unified messages, 7 employer messages, 25 conversations, 34 participant rows, 18 employer conversations, and 58 users. These are optimizer estimates, not a production dataset or benchmark.
- Local `max_connections` is 151. That number is **not** Aiven's limit. Render plan, CPU/RAM, number of instances, production pool settings, Aiven connection limits/table sizes/latency, proxy controls, and Cloudinary account-level controls were not available.
- Local effective configuration inspection was allowlisted and redacted: pool default max 5/min 0/acquire 30 seconds/idle 10 seconds; local upload limit 5 MiB; Cloudinary configured; NODE_ENV unset, so the local default rate-limit mode is database. Secrets, host/database names, credentials, tokens, and message contents were not included in artifacts.
- [Local indexes and query plans](messaging-local-query-plans.json) contain schema metadata and estimates. [Controller probes](messaging-controller-probes.json) contain synthetic in-process results with database/storage methods stubbed. ORM-call counts are not measured SQL statement counts or latency results.

## B. Inventory and database query audit

### Active implementations and role coverage

| Surface | Routes and backend | Frontend / policy |
| --- | --- | --- |
| Unified conversations | `routes/messageRoutes.js`, mounted `/api/messages`; `controllers/messageController.js`; Conversation, ConversationParticipant, Message, User, AlumniProfile, EmployerProfile | Alumni Messages; Employer unified direct messages; both Admin scopes' forum views. Verified Alumni have forum/course/batch; batch is year **and course**. Employer has no forum access. Admin Alumni and Admin Employer have forum access; Registrar does not. |
| Employer–Admin private | `routes/adminEmployerMessageRoutes.js`, mounted `/api/admin-employer`; `controllers/adminEmployerMessageController.js`; EmployerConversation, EmployerMessage, User, EmployerProfile | EmployerMessagesPage merges unified and private conversations. AdminEmployerMessagesPage merges forum and private threads. Access is Employer or Employer-scoped Admin. Any Employer-scoped Admin can access these private conversations, not only the row's assigned admin; retain this existing policy unless explicitly changed. |
| Older chat API, still mounted | `routes/chatRoutes.js`, mounted `/api/chat`; `controllers/chatController.js`; Conversation and Message | No current frontend `/chat` API caller found. It remains reachable with authentication. It is not safe to treat it as inactive solely because the UI no longer uses it. |
| Attachments and deletion | Unified `/files/:messageId`, `/:conversationId/messages/:messageId`; private `/messages/files/:messageId`, `/messages/:employerId/:messageId` | MessageAttachment, AttachmentSelectionPreview, MessageOptionsMenu; authenticated fetch helpers in `services/api.js`. Local private folders or Cloudinary via uploadMiddleware/objectStorage. |

Unified routes also expose `/search-users`, `/direct`, `/conversations`, `/:conversationId`, `/:conversationId/read`, and legacy room aliases `/global`, `/employer`, `/course`, `/batch/:year`. The legacy `employer` room alias maps to the forum; current policy correctly rejects an Employer there. `/api/messages` POST delegates legacy room sending to the same authorization. These restrictions must remain intact.

The older chat API exposes `/users`, `/conversations`, `/conversation`, `/message`, `/messages/:conversation_id`, and `DELETE /conversation/:id`. The private API's conversation lists and histories are separate from the unified tables; numeric IDs are different namespaces. The frontend uses source/thread prefixes to distinguish them. No identity migration or merging is proposed by this audit.

### Query-by-query findings

Line references are to the audited working-tree files. MC = `controllers/messageController.js`; EC = `controllers/adminEmployerMessageController.js`; CC = `controllers/chatController.js`.

| File/function | Purpose and current queries | Existing index support / problem | Recommendation and priority |
| --- | --- | --- | --- |
| MC `getUserWithProfiles`:123 | Joined User PK lookup with both profiles on nearly every operation, including socket subscriptions | User PK and local profile user_id index help. Most queries select full model attributes, including fields not needed for messaging, before serializing an allowlist. | Select only required identity/access/avatar attributes. Retain fresh access checks; do not cache authorization indefinitely. MEDIUM. |
| MC `ensureConversation`:128 / `ensureParticipant`:158 | `findOrCreate`, optional metadata update; group descriptors ensured on every list load; participant ensured on history/read/send | Key and membership unique indexes help. `findOrCreate` may issue transaction/control statements and multiple SQL operations, not just one SELECT. Even GET paths can write/hold connections. | Avoid repeated initialization on hot read/send paths; bulk/lazy membership maintenance with equivalent access rules. HIGH for sends, MEDIUM for reads. |
| MC `getAccessibleConversations`:427 | User lookup; ensure up to three group descriptors; direct participant join; viewer participant join; latest map; unread map; load participant users for **all** listed conversations; application-side sort | Membership user_id index and unique pair support lookups. No conversation-list pagination. Group member Users/profiles are loaded even though participant identities are returned only for direct conversations. Full group membership can dominate memory/result bytes. | Restrict counterpart hydration to direct conversations; bound lists with a stable activity cursor, preserving pinned groups and identities. HIGH. |
| MC `getLatestMessageMap`:345 | One grouped `MAX(id)` query, then one batched lookup including sender/profiles | Not N+1. Grouped work grows with total history/list size. Local messages has `(conversation_id,createdAt)`, not explicit `(conversation_id,id)`. | Explain candidate `(conversation_id,id)`; evaluate latest pointer/conditional preview only after correctness tests. Do not add a third overlapping index blindly. HIGH/MEDIUM. |
| MC `getUnreadCountMap`:378 | One grouped `COUNT(id)` with conversation IN, `sender_id <> viewer`, and per-conversation timestamp OR predicates | Already bulk: **50 conversations do not cause 50 count calls**. `(conversation_id,createdAt)` matches time windows. Large OR expressions and large unread histories still cost work. `unread_count` column is not the authoritative source; `is_read` is not used here. | Benchmark a join to viewer memberships with per-row watermark filtering; retain current semantics initially. Consider ID watermarks later. Do not add an is_read index for this query. MEDIUM. |
| MC `getConversationMessages`:550 | Access checks, membership ensure, `conversation_id=? AND id<before ORDER BY id DESC LIMIT`, reverse results to chronological order, joined senders/profiles | Default 30, maximum 50 already implemented; no offset. Local plan uses conversation-createdAt index with filesort. `limit` accepts negative/noninteger numbers; `before` validation is loose. `has_more` can be true for a final full page. | Validate positive integer cursor/limit and test `(conversation_id,id)` index. Limit+1 can make has_more precise. Retain chronological response order. HIGH for index/validation, LOW for extra terminal fetch. |
| MC read helper:331 / `markConversationAsRead`:590 | Access + membership ensure + timestamp update to server wall-clock now | Unique pair supports UPDATE. No last-seen ID supplied; multiple tabs/requests can race, and timestamps can move backwards if older updates execute later. Snapshot-to-mark timing can clear unseen messages. | Mark only through a delivered/seen watermark; update monotonically and throttle acknowledgements. HIGH. |
| MC search:603 | Up to 20 users, role predicates, `LOWER(name/email) LIKE '%q%'`, profile joins | Local role/admin_scope index narrows candidates; leading-wildcard matching still scans candidates. Search is not conversation-history search. | Bound input, retain debounce, explain alternatives at realistic data sizes. A normal B-tree on name does not fix contains search. MEDIUM. |
| MC direct creation:693 | User/target lookups, deterministic key lookup, create, bulk two participants or two findOrCreate calls | Unique key prevents duplicate keyed rows if present, but separate lookup/create lacks retry-on-unique-error and an atomic membership transaction. Target role/status allowlist is not enforced here. | Enforce the approved role matrix server-side; atomic create/member setup with duplicate-key recovery. Preserve the existing key format. HIGH. |
| MC send:765, group audiences:171–228 | Sender/conversation/access/membership, query audience, **serial per-audience findOrCreate** for course/batch, insert, preview update, plus participant query/logging when io exists | Per-member work is the principal N+1-style problem. Course includes sender again. Audience joins have only local AlumniProfile user_id index, not course/year lookup index. Hot conversation preview row is shared by every sender. | Remove repeated audience synchronization from each send; use bounded bulk maintenance with equivalent membership/access behavior. Remove debug-only participant queries; transact insert/preview and make preview monotonic. HIGH. |
| MC legacy room delegates:900/914 | Additional user and room-resolution work, then calls unified send/history controller | Inherits authorization and bounded history, but repeats profile/descriptor lookups and setup | Keep compatibility; avoid redundant loads internally only after approval. LOW/MEDIUM. |
| MC delete:934 | User/access checks, scoped message lookup, storage delete, atomic sender-scoped SQL delete, latest-message lookup, preview update | PK helps lookup; latest query needs conversation/id ordering. Storage deletion and SQL/preview are not one atomic lifecycle; no delete event | Preserve sender predicate; durable cleanup/retry, concurrency-safe preview, recipient synchronization. HIGH for consistency. |
| MC download:995 | PK message, user/profile, conversation and optional participant authorization; filesystem or object-storage download | PK + membership pair supported. Remote file fully buffered; redundant unreachable remote branch. Legacy CC can expose raw stored refs. | Streaming with bounds/timeouts and private provider access; preserve authorization. HIGH for attachment memory/privacy, LOW for duplicate branch. |
| EC `ensureEmployerConversation`:175 | Employer lookup/profile, admin resolution, findOrCreate, possibly changes adminId | employerId unique and adminId FK index locally. Called on history/send/delete before access rejection; wrong employer requests can create/reassign a conversation before returning 403 | Authorize requested employer before initialization/mutation; avoid admin reassignment during reads unless required by established policy. HIGH. |
| EC list:245 | Admin loads all Employers unless optional page/limit passed; batched existing conversations, optional bulk create missing rows, hydrated joins, JS sorting | Bulk, not N+1; optional pagination defaults to **off**, and UI requests omit it. Page selection is by employer creation time, then activity sorting only within that page. No reliable global activity cursor. | Make the UI/API bounded together, with equivalent ordering and a stable cursor; avoid unnecessary read-path creation. HIGH. |
| EC history:386 | Ensures conversation, checks access, hydrates conversation, fetches **all messages ordered by createdAt ASC** | `(conversationId,createdAt)` exists locally, but no limit. Equal timestamps have no explicit ID tiebreaker. Both private-chat UIs call it without pagination. | Latest 30–50 plus ID cursor/tiebreaker and older-page UI. HIGH. |
| EC send:196 | Ensure + access, message insert then preview update | No enclosing transaction/idempotency key, no Socket.IO broadcast. Concurrent preview updates can regress; partial failure can invite duplicate retries | Atomic/monotonic persistence and deduplicated retries; equivalent recipient notification path. HIGH. |
| EC download:436 / delete:478 | Message+conversation PK join and access; own-sender delete scoped by id/conversation/sender; latest timestamp lookup and preview update | Existing indexes useful; no delete transaction/events, file-first lifecycle, full remote buffer | Same safety/streaming/synchronization recommendations as unified. HIGH/MEDIUM. |
| CC list/create:32/66 | OR on user1Id/user2Id, batch partner fetch; no list limit; separate pair lookup/create without conversation_key/type/member setup | No local user1Id/user2Id indexes; legacy creation bypasses canonical direct keys and role policy | Reconcile this live compatibility surface with existing policy before any removal; do not automatically change identities. HIGH. |
| CC history/send:128/101 | Pair-member check, unbounded ordered history; insert then update conversation; no room event | No history limit, current sender metadata/read semantics absent, raw Message serialization exposes storage refs | Bound/restrict the compatibility API or make it obey the current contract after approval. HIGH. |
| CC deleteConversation:148 | Pair-member check, `Message.destroy({conversation_id})`, then conversation destroy | Deletes **both senders'** history and can affect a current direct conversation with matching user1Id/user2Id. Not covered by current own-message deletion tests | Resolve this alternate deletion route as a release gate. Do not execute deletion during investigation. HIGH. |
| Global rateLimitStore | When database mode: INSERT/UPSERT + SELECT per HTTP request, periodic expiry DELETE | RateLimitEntry window uniqueness/expiry indexes support storage, but these operations share application connections. Limit is IP-based across all API traffic | Trusted client-key derivation and per-user/action controls; account for store overhead in query counts. HIGH. |

### Query counts: what was actually checked

Synthetic controller probes used 50 direct conversations, no group descriptors, and batched latest/unread lookups. Result: **7 ORM calls**: 1 user lookup, 3 participant reads, and 3 message reads. The participants and MAX-ID stubs used synthetic rows; this is control-flow evidence, not an exact production SQL trace. Group initialization, rate limiting, implicit findOrCreate transactions, hooks, and network latency are not included.

Course-send probes, with io disabled so broadcasting/debug database work was excluded:

| Synthetic audience | Membership ensure calls | Total modeled ORM calls |
| --- | --- | --- |
| 50 | 51 | 57 |
| 500 | 501 | 507 |

Real `findOrCreate` can execute several SQL statements and transaction operations per call. With io enabled, another participant SELECT runs for every unified send; course sends also have their verification SELECT. The modeled counts therefore understate SQL amplification. No synthetic message was written to any database.

### Index inventory and local EXPLAIN results

Observed locally, not asserted for production:

- `messages`: PK(id), `(conversation_id,createdAt)`, sender_id, is_read. **No explicit `(conversation_id,id)`**. The April migration declares that index against `Messages` while current models use lowercase `messages`; do not assume migration application/casing equivalence on Aiven.
- `employermessages`: PK(id), `(conversationId,createdAt)`, senderId.
- `conversationparticipants`: composite PK(conversation_id,user_id), **two additional unique indexes on the same pair**, user_id and conversation_id indexes. The single conversation_id index may overlap the PK prefix; verify FK requirements before proposing removal.
- `conversations`: PK(id), **11 indexes covering only conversation_key**, type, `(batch_year,course)`. No local user1Id/user2Id index or type/activity composite.
- `employerconversations`: PK(id), unique employerId, adminId.
- `users`: PK(id), role/admin_scope, **12 indexes on email**, alumni_record_id. `alumniprofiles`: PK(id), user_id only.

Duplicate indexes add write/storage costs; no indexes were dropped. Compare definitions, uniqueness, FK dependencies, and production metadata before a separate migration. Do not merely increase pool size or rerun alter-sync to compensate.

| Ordinary local EXPLAIN SELECT | Access path / estimate | Interpretation |
| --- | --- | --- |
| Unified conversation history by ID cursor | ref via `(conversation_id,createdAt)`, estimated 9 rows, `Using filesort` | Supports testing the missing conversation/id index, not a measured latency claim. |
| Grouped latest MAX(id) | range, estimated 14 rows, covering index | Bulk aggregation already works; scale of scanned history still matters. |
| Grouped unread timestamp windows | range via conversation/createdAt, estimated 3 rows | Existing timestamp index is useful; no evidence to add an is_read index for this query. |
| Participant lookup by user_id | ref using user_id, estimated 1 row | Appropriate lookup index present locally. |
| Employer history ordered by timestamp | ALL over estimated 7 rows, filesort despite candidate composite | Tiny-table optimizer choice is not proof of a missing index. Unbounded rows are the confirmed issue. |
| Legacy pair list | ALL over estimated 25 rows, filesort; no possible key | Legacy OR-pair path lacks specific lookup indexes locally. Decide compatibility policy before indexing unused UI paths. |
| Contains user search with role filter | role/admin_scope ref, estimated 37 rows with residual filter | Role index helps; substring filtering remains. |

Queries used representative literals and did not return message content. Full ORM JOIN plans and production statistics remain to be captured safely on the isolated production-equivalent test database.

## C. Concurrency and real-time assessment

### Persistence, races, ordering, and resources

- Async MySQL I/O allows overlapping requests; InnoDB-generated message IDs distinguish inserts. No evidence that unrelated concurrent inserts inherently mix conversation IDs. Controllers derive sender identity from authenticated users and scope message queries by conversation.
- There is **no client-generated idempotency key or unique send-request constraint** in either send path. Client deduplication by returned ID prevents rendering the same row twice; it cannot prevent two rows from a retried POST.
- Message INSERT and conversation preview UPDATE are separate commits. If UPDATE fails after INSERT, the API can fail despite a stored message; retry can insert another. If A inserts before B but A's update completes last, preview metadata can regress.
- Concurrent send/delete can make the cached preview disagree with actual latest content. Deletion removes storage before the sender-scoped SQL delete and latest lookup/update, with no durable compensation if subsequent work fails. Recipient clients receive no deletion event.
- ID-based history is deterministic, but live events from independently completing requests may be emitted in a different ID order. `mergeUniqueById` appends/prepends; it does not sort. Admin/private histories sort by createdAt without ID tiebreakers.
- Read markers use server timestamps, not delivered message IDs. An initial history snapshot, followed by a later mark-now request, can mark intervening unseen messages read. Newly ensured memberships initialize last_read_at to now, intentionally/implicitly excluding older history from unread counts. Hidden tabs also acknowledge active-room socket messages.
- Every active Alumni recipient emits a read HTTP request for each incoming active-room message. One busy group can create approximately R read requests per message for R connected active readers, each with access/membership database work, in addition to the sender's audience loop.
- Pool max defaults to **5 per process**, not per user. The forked email worker imports the same database configuration and can have another pool. For N web instances each forking a worker, the configured upper bound is roughly `2 × N × poolMax`, plus migrations/admin/monitoring connections. Actual allocation depends on demand. Confirm deployed worker topology before budgeting Aiven connections.
- A rough pool bound is `poolMax / mean connection-held time` for simple operations; this is not a throughput guarantee. Sequential per-recipient calls multiply required operations, while transactions consume checkout time. Shared authentication, rate limits, email jobs, and other portal requests compete with messaging.
- Unbounded results, ORM profile hydration, repeated array merging, image fetching, full-file buffers, and room/member debug logs add CPU/heap/event-loop pressure. No RSS/event-loop-delay measurements were taken.

### Socket.IO findings

Server evidence: `server.js`:214–324. Client evidence: `MessagesPage.jsx`:236–350.

1. Handshake verifies JWT. Joins call `authorizeConversationSubscription`, which reloads the user and applies the HTTP conversation policy. Good: current Employer forum access is rejected even for stale participant rows, and normal emits target `conversation:<id>`, not every socket.
2. **Only Alumni's MessagesPage instantiates socket.io-client.** EmployerMessagesPage, AdminEmployerMessagesPage, and AdminAlumniMessagesPage have no socket subscription. Private EmployerMessage sends have no broadcast. Admin pages poll conversation lists, but load history only when the thread/forum ID changes or on their own send; incoming remote messages can leave an open history stale indefinitely. Employer history may reload when polled conversation state changes, giving delayed rather than real-time delivery.
3. Alumni reconnect rejoins the active room but does not fetch missed history or replay from a last-received cursor. Socket.IO's default server-to-client delivery is at-most-once; reconnect alone is not history recovery. [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/).
4. The earlier activeConversationId effect updates `activeConversationIdRef` before the room-switch effect reads it. The latter consequently can fail to leave the previous room. Subscriptions accumulate until disconnect. The UI filters active display, but the network still receives old-room payloads and stale-room unread updates. Async join/leave races also lack acknowledgement/cancellation handling.
5. Existing room membership is not revoked when a user is suspended, loses role/access, changes course, or the JWT expires. Access is checked on join, not on every subsequent broadcast. The socket may keep receiving old-room data until disconnect; this needs explicit revocation/session-lifetime design.
6. `socket.disconnect()` is present on component cleanup. No obvious repeated listener registration inside each message handler was found; the primary issue is room lifecycle and the missing role integrations, not a proven listener-count leak.
7. No user-specific rooms, delivery acknowledgements/replay cursor, connection-state recovery configuration, durable delivery outbox, cross-instance adapter, or join-event rate limits were found. Joining the room uses the raw supplied identifier after authorization; use of legacy aliases/leading-zero IDs can therefore authorize a numeric conversation but subscribe to a different room string. This is a delivery mismatch, not a demonstrated cross-conversation disclosure.
8. Socket CORS callback returns allow=true even for unmatched origins. This is not an authentication bypass, but it is not an effective origin allowlist. Socket auth also has a fallback secret unlike HTTP auth, and does not revalidate account existence/status at handshake. Join authorization mitigates some initial-access cases; never rely on the fallback.
9. Single-instance room broadcasts can work for connected authorized Alumni, subject to the correctness gaps above. With multiple web processes, an HTTP send can land on a node different from the recipient socket. The in-memory adapter does not forward that event. A compatible inter-node adapter and a deployment/session-routing plan are required; sticky sessions are needed when HTTP long-polling is used unless the chosen architecture explicitly handles equivalent session state. No Redis or infrastructure was installed. [Socket.IO multiple-node requirements](https://socket.io/docs/v4/using-multiple-nodes/).

### Frontend state and polling

- Polling is nominally 60 seconds visible, 120 seconds hidden, with 300-second maximum backoff. Most loader functions catch errors instead of rejecting, so the polling hook often cannot detect failures and apply backoff. There is no randomized jitter.
- `useAdaptivePoll` singleton is an in-browser module map, not cross-tab/process deduplication. It stores one subscriber task, not a multicast result. With multiple subscribers its timer closure can be cancelled by an unmount while subscribers remain. Current messaging routes generally mount one role page, so treat this as a lifecycle risk rather than proven repeated polling in normal navigation.
- Alumni and Admin Employer message loaders lack the request-generation guard used by EmployerMessagesPage. A slow response for thread A can overwrite thread B's visible history after a rapid switch. IDs/authorization on the server do not make this client-state race safe. Test both pending fetches and sends when switching.
- Older-message controls exist in Alumni and Admin Alumni; Employer unified history takes the default latest page without an older cursor control, and Admin Employer forum history requests 30 without older-history controls. Pagination must be completed end-to-end, not just added to the backend.
- MessageAttachment fetches each image as an authenticated blob on mount. A loaded page with 30 image messages can add roughly 30 authenticated downloads and backend buffers. Browser blob URLs are revoked on cleanup. Every role escapes message text through normal React text rendering; no message-body `dangerouslySetInnerHTML` was found.

## D. Security and severity register

No unauthenticated arbitrary-conversation read or proven anonymous takeover was demonstrated, so **no CRITICAL finding is asserted**. HIGH findings below still block wider rollout.

| Severity | Finding / evidence | Proposed fix requiring separate approval |
| --- | --- | --- |
| HIGH | Legacy CC deletion wipes both participants' messages. Synthetic member request returned 200 with delete WHERE containing conversation_id only. | Enforce the intended deletion contract across every mounted route; verify legitimate legacy consumers before restricting/deprecating. |
| HIGH | MC direct creation checks target existence/self only, not the search policy or source verification. Synthetic Employer → Registrar-admin creation returned 200 even though search excludes that target. CC also lacks a role matrix. | Share an explicit, approved server-side role/status policy across creation/read/send/socket/legacy routes without enabling removed features. |
| HIGH | Course/batch per-recipient setup and read-ack fanout; no scalable send budget | Remove audience synchronization from per-message work; bulk/bounded maintenance and throttled seen acknowledgements. |
| HIGH | Open histories are not real-time for three roles; Alumni reconnect gaps and old-room retention | Implement consistent role-appropriate subscriptions/recovery, accurate leave/revocation, and recipient refresh/delete events. Preserve identity/source namespaces. |
| HIGH | Unbounded private/legacy history and default unpaginated lists | Cursor-based API and UI, stable tiebreakers, capped initial results. |
| HIGH | No send idempotency / insert-preview transaction / monotonic cached preview | Design idempotent request keys and atomic monotonic persistence; durable delivery/cleanup when necessary. Schema changes only with a reviewed migration. |
| HIGH | Cloud storage does not make `isPublic:false` private: uploadBuffer always sends delivery type `upload`, and stores an opaque base64url reference containing the public URL | Verify account controls with synthetic files, then design authenticated/restricted delivery and migration. Backend download auth does not secure a public provider URL. CC raw Message responses expose stored refs to authorized participants. No real private URL was fetched. Cloudinary documents `upload` as public by default: [access controls](https://cloudinary.com/documentation/control_access_to_media). |
| HIGH | Full upload/download buffers; upload precedes conversation authorization; rejected/failed controller requests have no explicit attachment cleanup | Authorize conversation before expensive transfer where possible; bounded streaming, timeouts, admission control, and orphan cleanup. Keep current type/size limits. |
| HIGH | Production rate-limit mode defaults to `proxy`, which only calls next; upstream limiting is unverified. Database mode trusts raw X-Forwarded-For, fails open on store errors, and has one shared IP quota; socket joins bypass Express limits | Verify deployed upstream controls; trusted proxy chain, action/user-aware limits, socket join/connection controls, and store-failure policy. |
| MEDIUM | Local explicit conversation/id history index missing; duplicate local indexes; broad profile hydration | Verify production metadata/EXPLAIN first; review one minimal index migration and equivalent-column deduplication separately. |
| MEDIUM | Timestamp read races, stale cross-thread UI responses, wall-clock/ID ordering differences | Delivered-message watermark, monotonic updates, stale response guards, stable ordering. |
| MEDIUM | Message size/ID validation incomplete; sanitizer mounted before body parsing | Validate text length and positive integer inputs after JSON/multipart parsing. Global sanitize middleware cannot sanitize a body that has not been parsed yet. Sequelize parameterization reduces injection risk but is not full input validation. |
| MEDIUM | Socket secret fallback, permissive origins, no post-join revocation; production DB TLS disables certificate verification (`database.js`:36) | Fail closed on missing secret; enforce supported origins/session lifecycle; validate database TLS chain. Coordinate with auth/deployment rather than silently changing it during this audit. |
| MEDIUM | Group per-send/join logs enumerate users/sockets; each emit traverses full room for debug output | Remove or sample/redact logs; avoid database work performed solely to log audience size. |
| LOW | normalizeMessagePayload always generates attachment URL for a message object with an ID, even if attachment is null; duplicate download remote branch | Return null for absent attachment; remove unreachable duplicate branch in a focused follow-up. |

Current unified/private message deletion explicitly compares sender identity and retains sender in the DELETE predicate; existing tests cover cross-sender rejection, including Admins. Preserve these checks. The legacy conversation deletion exception is not disproved by those passing tests.

### Attachment limits, storage, and transfer costs

The supported set is PDF, DOC, DOCX, PNG, JPG/JPEG, WebP and GIF. Chat upload checks an extension/MIME mapping plus header signatures; DOC/DOCX checking is a shallow ZIP/OLE header check, not full document/container inspection. Multer accepts one attachment. Backend fileSize is configurable, default 10 MiB; the inspected local override is **5 MiB**. Frontend `utils/messageAttachments.js` defaults to 10 MiB and the inspected frontend production environment file does not override that value. The checked-out configurations can therefore advertise/accept different limits client-side and server-side; verify deployed values and align configuration without silently changing the approved backend limit.

Cloud uploads accumulate chunks, concatenate a Buffer, then construct a Blob/FormData; remote downloads call `arrayBuffer()` and create a Buffer before sending. At a 5 MiB limit, 100 simultaneous maximum-size files represent **500 MiB of payload alone**, before copies, response state and the rest of the process. This is arithmetic, not measured peak RSS or a claim that 100 uploads fit the Render instance. Per-file limits do not cap total concurrent transfer memory. The upload middleware runs after authentication but before conversation access checks, so a request later rejected by the controller can already have incurred storage work. Message image previews also multiply download traffic.

With configured Cloudinary credentials the local runtime selects external storage; otherwise it falls back to private local folders. Render's deployed environment and disk mount were not inspected, and older local file references still need their original persistent files. Local fallback is unsafe to assume durable across Render deploys without a verified disk mount. No files were uploaded, downloaded or removed during the audit.

## E. Safest optimization order

1. **Release gates:** agree the direct-message role matrix, resolve legacy whole-conversation deletion, verify private attachment delivery, and validate real deployed rate controls. Add isolated regression cases for each bypass before changing behavior. Preserve Employer forum restrictions and existing admin scopes.
2. **Low-risk query reduction:** remove debug-only participant SELECTs/log enumeration, select only necessary attributes, hydrate participant users only for direct counterparts. Bound validation/limits without changing supported file types or maximum size.
3. **Group send path:** separate audience reconciliation from the hot message INSERT; preserve course/batch authorization and new-member semantics. Compare query count versus audience size before/after. Do not change conversation keys.
4. **Pagination end-to-end:** private history and conversation lists, legacy API handling, older-page controls for currently truncated unified clients. Stable ID ordering and current ordering UX must be verified together.
5. **Correctness under concurrency:** idempotency, atomic/monotonic preview persistence, read watermarks, safe delete/attachment compensation, stale frontend result guards. These need reviewed transaction/migration designs.
6. **Real-time consistency:** role-appropriate socket support or explicit delta polling, reconnect recovery, accurate room leave/revocation and delete propagation. Avoid simply speeding up whole-history polling.
7. **Production-equivalent index validation:** verify actual Aiven table/index metadata, compare representative plans, add only justified composites, review duplicate indexes and FK dependencies. No blind index creation/removal or identity migration.
8. **Resource tuning after measurement:** bounded streaming, pool/worker connection budgets and deployment sizing. Multiple instances require adapter/routing design; do not add distributed infrastructure before measurements justify it.

## F. Scalability verdict

Logged-in users L, active socket connections C, active senders A, and sent messages/second M are different quantities. C may exceed L with multiple tabs; in today's UI only Alumni messaging opens a socket. A login does not continuously consume a database connection. For a sender average interval T seconds, `M = A / T`.

The following are **illustrative offered workloads, not capacity or throughput measurements**. Assume one messaging tab/user, all visible; 10% send once per 10 seconds in the moderate-send column. Lists poll once/minute for Alumni/Admin Alumni or twice/minute for Employer/Admin Employer. Read acknowledgements, history opens, image downloads, retries, socket joins, and other portal traffic are additional.

| Concurrent messaging users | Moderate offered sends/s | All users sending every 10s | List HTTP requests/s, 1–2 endpoints | Assessment of current implementation |
| --- | --- | --- | --- | --- |
| 100 | 1 | 10 | 1.7–3.3 | Not certified. Small direct-chat workload may be modest, but one populated course and eager images/read acknowledgements can dominate; correctness gaps apply at any size. |
| 500 | 5 | 50 | 8.3–16.7 | Not certified. Serial group membership work, private-history size, pool wait, hydration and debug fanout need measurements before rollout. |
| 1,000 | 10 | 100 | 16.7–33.3 | Not certified. Five default web connections provide a narrow shared query budget; group hot rows, unbounded histories and read fanout are likely first bottlenecks. |
| 5,000 | 50 | 500 | 83.3–166.7 | Current architecture should not be approved as efficient. Complete bounded queries and send/delivery fixes, then test suitable infrastructure. Extra instances alone lose cross-node events with today's adapter. |
| 10,000 | 100 | 1,000 | 166.7–333.3 | No defensible support claim. Requires measured connection/RAM/CPU/network budgets, high-fanout tests, production-size indexes/history, reliable delivery, and potentially a reviewed multi-node design. |

No single table row above predicts failure at a precise user count. Message frequency, group sizes, image sizes, residency time, active-role mix, network RTT and database resources matter more than a login count alone. The top database bottlenecks are group-send membership ensures; whole private histories; unbounded conversation/member hydration; latest/unread aggregation over growing history; per-event read updates; and database-backed global rate limiting where enabled.

## G. Isolated performance-test plan and readiness gates

### Isolation and fixtures

- Provision an explicit disposable `*_test` database and separate backend environment. Do not use the current local database merely because it is loopback; its name is not a test database. Use a separate storage account/folder configured as a sandbox, synthetic users, and no production tokens or real Gmail recipients. Do not seed or clean the production database.
- Before launch, validate an allowlisted test hostname and test-database name, and record CPU/RAM, Node/Sequelize/Socket.IO versions, pool settings, worker topology, database engine/version/max connections, network RTT, rate-control mode, and fixture counts. Refuse production Render/Firebase/Aiven endpoints. No load runner or dependency was installed in this audit.
- Seed synthetic verified Alumni across courses/batches, Employers, Admin Employer and Admin Alumni. Include disallowed-role fixtures for authorization tests. Keep legacy private/unified identities distinct. Proposed test data: 50/500 conversations per heavy user; histories of 30, 1,000 and 100,000 messages; group audiences 10/100/500/1,000/5,000, including one hot forum/course. These are future fixtures, not existing or measured data.

### Runner and scenarios

Use Artillery's Socket.IO engine plus HTTP actions, or k6 for HTTP combined with a Socket.IO-aware receiver harness. A generic WebSocket client is not a substitute for the Socket.IO protocol. Artillery supports combining HTTP actions and Socket.IO scenarios: [official engine documentation](https://www.artillery.io/docs/reference/engines/socketio).

1. Start with 2 synthetic accounts. Log in by the real API, obtain tokens without logging them, load conversations/history, join authorized numeric rooms, send through the **HTTP** API, and correlate returned message ID with each intended receiver's event. Do not emit a fictitious socket send event: the current server only defines join/leave for this flow.
2. Test read-only list/history/search independently, then idle socket connections, direct sends across many pairs, the private Employer–Admin path, and course/batch/forum sends with increasing audience sizes. Keep each role's allowed features unchanged.
3. Use persistent virtual users and control their lifetime to reach **100, 500, 1,000, 5,000 and 10,000 active clients**. Artillery arrival rate is not itself concurrent users. Calibrate 10% active senders at 10-second intervals separately from all-users-active tests. Gate each stage on the prior stage; use 2-minute ramps, 10-minute steady periods, then a longer soak only if resource headroom permits.
4. Replay the real UI request mix: list polling, history initialization, post-read calls, old-page loads, image-preview downloads and normal background traffic. Run HTTP-only and socket+HTTP variants to separate database limits from fanout limits. Include one/minute and 10-second list storms only as explicit stress scenarios, not fabricated normal behavior.
5. Retry the same synthetic send after a simulated response loss; submit simultaneous distinct sends; create the same direct pair concurrently; delete only fixture-owned messages while another fixture sends; reorder/delay responses while switching threads; vary same-second timestamps. Assert exact stored-row counts, stable latest preview, no duplicated messages, no wrong-thread rendering and no sender-policy bypass.
6. Disconnect/reconnect receivers during sends, switch rooms rapidly, revoke a synthetic user's access while connected, open multiple tabs, and test unauthorized joins/history/files/deletes across all role combinations. No real records are involved. Test limits with negative/fractional cursors and overlong text safely.
7. Upload/download synthetic files of 100 KiB, 1 MiB and the **configured current limit**, then 1/5/10/20 simultaneous transfers. Keep the allowed MIME/extension set and limit unchanged. Check invalid signature rejection, upload-before-auth behavior, orphaned files, memory plateau and cancellation/timeout handling.

### Measurements and suggested acceptance targets

Record per role/route and workload stage: HTTP p50/p95/p99 send/history/list latency; accepted messages/sec; status/error/timeout/429 rates; database SQL count and time/request (including auth, findOrCreate transaction statements and rate store); pool in-use/waiting/acquire timeouts; Aiven connections/CPU/IO/lock waits; Node CPU/RSS/heap/GC/event-loop lag; response/file bytes; socket connection count/room occupancy; intended-versus-observed deliveries; and event delivery p50/p95/p99.

Use returned persisted IDs and synthetic correlation labels for deduplication accounting. Measure send-start → receiver-event and commit/response → event separately. Cross-machine timestamps require clock synchronization, or measure with a shared receiver collector. Do not confuse room-join acknowledgement with message delivery, and do not report delivery success from an HTTP 201 alone.

Suggested targets to agree before testing, **not measured results or promised service levels**: text-send p95 under 500 ms/p99 under 1 s; first history page p95 under 500 ms; delivery p95 under 1 s; unexpected HTTP errors under 1%; zero unauthorized deliveries, duplicate logical sends, wrong-thread displays, missing persisted messages, or permission bypasses in deterministic scenarios. No sustained pool wait growth or unbounded RSS increase. Stop a stage on security/correctness failure, OOM, persistent pool timeouts, or resource saturation; higher stages are not automatic.

### What ran in this audit

- Ordinary read-only local metadata/EXPLAIN inspection: completed; results in JSON. **Not a latency or Aiven load test.**
- Synthetic in-process controller probes: completed; 7 calls for 50 direct conversations; 57/507 calls for course audiences 50/500; role-policy and legacy-deletion observations captured. **No real sends/deletes/SQL writes.**
- `node --test tests/employerForumAccess.test.js tests/messageDeletionPermissions.test.js`: **19 passed, 0 failed**. These use model stubs and cover current Employer forum restrictions and own-message deletion. They are not multi-user database or deployment benchmarks.
- Production load tests: **not run**. Render/Aiven production metadata/plans: **not inspected**. Browser/real socket sessions: **not run**. Capacity, p50/p95/p99, actual messages/sec, production error rates, CPU/RAM and connection utilization under load are **unmeasured**.
- Frontend build was not rerun because application code was not changed.

**Production readiness conclusion:** retain the existing role features, but treat the high-severity policy/deletion, real-time consistency, hot group-send path, unbounded reads, and storage/rate-control issues as gates before broader deployment. Review and approve focused fixes individually, then validate at each target workload in isolation. No optimization has been implemented by this audit.

### External reference boundaries

Official references support platform/protocol behavior, not DJEMC capacity claims. [Render persistent disks](https://render.com/docs/disks) documents the default ephemeral filesystem; therefore local fallback needs a verified mounted persistent path or external storage. Local Cloudinary configuration suggests current local uploads use external storage, but it does not establish Render's deployed provider settings or persistence of legacy local paths. [MySQL EXPLAIN](https://dev.mysql.com/doc/refman/8.4/en/explain.html) describes plan inspection; the captured local plans are from MariaDB and cannot substitute for production MySQL plans. No provider tier, price, or service capacity was inferred from generic documentation.
