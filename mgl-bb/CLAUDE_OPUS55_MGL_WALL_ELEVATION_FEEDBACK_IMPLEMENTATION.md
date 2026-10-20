# MGL Smart implementation prompt for Claude Opus 5.5 Max

You are the senior engineer responsible for completing a production quality improvement of the MGL Smart Revit add-in and its connected ERP. Work in `osohbayr1016/mgl-e-c`. Execute implementation, verification, and candidate packaging. Do not stop after proposing an architecture, producing a checklist, or adding UI placeholders. Read the actual code, identify root causes, implement connected vertical slices, and carry them through meaningful checks.

The operating model and effort level are selected outside this prompt. Use the configured Opus 5.5 Max session for careful engineering. Keep progress updates and the final handoff in Mongolian; code identifiers follow repository conventions. User-facing text is Mongolian except for the requested English Revit category names.

## 1 Mission and established facts

Deliver three connected outcomes:

1. Fix and improve Wall Elevation according to the confirmed architect requirements below, including practical background generation while the user continues modeling.
2. Build a complete feedback system: the Revit tool itself accepts a message and explicit file attachments, stores attachments privately in Cloudflare R2, and delivers requests to an ERP engineering inbox visible only to the verified Өсөхбаяр account with Software Engineer access.
3. Investigate Revit 2027 failures separately from Revit 2024, fix reproduced defects, add diagnostics and regression coverage, and make the release gate prove compatibility independently for each supported year.

The user tested add-in 1.45 on Revit 2024 and now reports errors on Revit 2027. The exact 2027 exception and reproduction are not supplied. Do not invent a root cause or assume this is only a runtime migration problem. Add the diagnostic path needed to turn subsequent reports into reproducible cases, and independently investigate available 2027 environments now.

Repository research baseline: main `e993deb49de827c5e75ffbfa6429f1bd1963e7a2`, checked 2026-10-16. Fresh-read the current checkout, main, relevant open PRs, local changes, and installed build before editing. This SHA is evidence, not an instruction to reset the user's checkout. The baseline csproj says 1.40.0 while WALL_ELEVATIONS.md describes overlay builds through 1.45.0. Resolve this discrepancy without discarding valid uncommitted Wall Elevation work.

This prompt is self-contained. Do not depend on the previous chat or a Word report to recover requirements.

## 2 Working rules

- Read applicable AGENTS.md and CLAUDE.md instructions, current build/deploy documentation, and the files you change. Code and fresh evidence take precedence over stale historical documentation. Stay within this feature's scope.
- Inspect git status and diff before touching anything. Preserve other people's changes. Use an isolated branch/worktree when appropriate, carrying only the reviewed changes necessary for this task. Never reset, clean, or overwrite unrelated work.
- Create a persistent implementation checkpoint and requirement matrix. Assign each requirement an ID, implementation location, verification method, and final status. Update the checkpoint at phase boundaries so work survives context limits.
- Make routine decisions using the defaults in this prompt. Ask only if an identity, incompatible source change, required credential, or irreversible action truly cannot be resolved. Continue independent implementation while that narrow dependency is unavailable.
- Do not introduce paid AI services, large client models, automatic model training, or AI dependencies for room detection, layout, or feedback. This work must function without MGL AI.
- Do not auto-edit production RVTs, sync a user's central model, kill a working Revit instance, or overwrite an open user's installed DLL. Test on disposable copies and isolated test instances. Preserve settings, credentials, and offline queues.
- Complete source changes, tests, migration scripts, installation package, and a reviewable change set. Respect existing explicit deployment authorization if present; otherwise provide a tested candidate and precise rollout steps, without assuming this prompt authorizes publishing to every employee.
- A missing Revit installation or unavailable real model does not excuse stopping backend/frontend implementation. Mark only the dependent validation BLOCKED or NOT RUN. Never substitute compilation or core tests for a live Revit test.
- Do not claim the result is issue-free or fully compatible without the required evidence. Never weaken tests, suppress real errors, or relabel a reproduced regression as an acceptable known issue to obtain PASS.

## 3 Read these existing integration points

Inspect fresh equivalents if files have moved:

### Revit and Wall Elevation

- `revit-mcp/addin/WallElevation/WallElevationCommand.cs`, `WallElevationWorkflow.cs`, `WeJob.cs`.
- `WallElevation/Core/WeSettings.cs`, `WePlanner.cs`, `WeMarkers.cs`, `WeRoomBoundary.cs`, `WeKeyPlan.cs`, `WeAnnotation.cs`, `WeAnnotationPlanner.cs`, `WeOverride.cs`, `WeValidation.cs`, `WeNaming.cs`, `WeSheetComposer.cs`, `WeSheetLayout.cs`.
- `WallElevation/Revit/ElevationTargetResolver.cs`, `ElevationGenerationCoordinator.cs`, `WallElevationViewFactory.cs`, `WeSheetService.cs`, `WeReviewPanel.cs`, `GeneratedElevationRepository.cs`, `WeAnnoSourceReader.cs`, `WeKeyPlanService.cs`, `WeAxonService.cs`, `WeLivePreview.cs`.
- `WallElevation/Ui/WallElevationDialog.cs`, `WePlanEditor.cs`.
- `CloneDrawings/CdJobHost.cs`, `ApiClient.cs`, `SettingsStore.cs`, `Licensing/LicenseGate.cs`, `Licensing/DeviceSession.cs`, `WorkTracking/TrackingHttpTransport.cs`, `App.cs`, `AssistantPaneProvider.cs`, `Ui/Revit/RibbonBuilder.cs`.
- `revit-mcp/addin/RevitMcpAddin.csproj`, `revit-mcp/docs/WALL_ELEVATIONS.md`.

### ERP and storage

- `backend/src/index.ts`, `types.ts`, `middleware/auth.ts`.
- `backend/src/lib/revitSessionCheck.ts`, `revitPolicy.ts`, `tokenValidity.ts`, `requestContext.ts`, `tenants.ts`, `officeAccess.ts`, `workerScope.ts`, `clientScope.ts`, `entitlement.ts`, `modules.ts`.
- `backend/src/routes/auth.ts`, `users.ts`, `upload.ts`, `media.ts`, `revitDevice.ts`, `revitLicense.ts`, `revitAddin.ts`, `suggestions.ts`.
- `backend/wrangler.toml`, migration naming conventions, `backend/scripts/cleanup/` and its R2 reference inventory.
- `frontend/src/shared/components/Layout.tsx`, `ProtectedRoute.tsx`, `MobileBottomNav.tsx`, `shared/context/AuthContext.tsx`, `shared/lib/roles.ts`, `app/routes.tsx`, API client and module configuration, `frontend/scripts/nav-matrix.mjs`.

### Verification and releases

- `revit-mcp/tests/WallElevation.Tests`, `WallElevation.Tests.Net48`, `WallElevation.UiSmoke`, `WallElevation.LiveGate`, `WallElevation.LiveGate.Driver`, `AddinInspect`.
- `revit-mcp/release-gate/wall-elevation/{build-candidate.ps1,gate.ps1,run-live.ps1,known-issues.json}`.
- `revit-mcp/installer/{install.ps1,build-bundle.ps1,test-installer.ps1,test-bundle.ps1,verify-bundle.ps1}`, packaging scripts and release manifests.

## 4 Access control is a product requirement

The new inbox is for the verified ERP account Өсөхбаяр, with the user-facing access role `Software Engineer`. It is NOT an inbox for all admins, all engineers, all seniors, or everyone with the same display name.

Baseline observations:

- UserRole currently contains `admin | engineer | architect | senior | client | worker`; no distinct global `software_engineer` role was found.
- `users.position` exists, but editable job-title text is not an authorization boundary.
- Existing suggestions use an admin inbox and public image URLs; do not reuse that authorization/storage contract for these engineering requests.
- Existing revitAddin routes hardcode OWNER_ID=1 with an Anand comment. That is not evidence that Өсөхбаяр is user ID 1. Do not copy it.

Implement a server-authoritative Software Engineer access role/capability, scoped to this engineering inbox. Prefer a separate role/capability membership and configured reviewer binding rather than rewriting the global UserRole system or rebuilding the users table. If a fresh checkout already has a suitable role/capability framework, reuse it.

Reviewer authorization must require ALL of:

1. An authenticated, currently active ERP user in the correct tenant.
2. Membership in the server-managed Software Engineer capability/access role.
3. A match to the explicitly configured, verified Өсөхбаяр reviewer account for that tenant.

Resolve the real account from authorized ERP/DB data using stable username, employee ID or other corroborating identity. Never grant access from a fuzzy name match or the first matching row. Bootstrap the capability only for the verified account. If identity is unavailable or ambiguous, implement the complete system with reviewer access disabled, provide a safe bootstrap command/configuration and the exact remaining identity question, and continue all tests with explicit fixture identities. Do not grant a broad fallback.

Additional rules:

- UI checks and server authorization use the same capability source. A hidden sidebar is insufficient.
- No implicit admin bypass to list/detail/count/search/export/download/update these requests. Admin's unrelated existing permissions remain unchanged.
- Re-read or safely invalidate current DB-backed authorization on permission changes; a stale JWT role or position must not retain reviewer access.
- Browser route guards, mobile navigation, command palette/search, unread counts, notifications, API handlers, attachment streams and any realtime subscription must enforce the same boundary.
- Reviewers do not gain permission to change their own capability/owner binding through request bodies.
- Internal authenticated staff may submit a request. The sender may receive their own minimal receipt/status within the submission flow, but never the all-request inbox, other users' requests, private triage notes, global counts or other attachments.
- Existing worker/client/office/tenant/module/session restrictions are not bypassed globally. Explicitly decide eligible submitter roles and preserve current restrictions; default to active internal admin/engineer/architect/senior staff. Extend narrower submitter access only if required by fresh product context.

## 5 Feedback from the Revit tool through to ERP

### F01 Submission UI inside Revit

Provide a discoverable `Санал хүсэлт` command in the add-in and a contextual entry in Wall Elevation's result/error/review flow. It must open without launching the MGL AI assistant, starting a model, or requiring a successful Wall Elevation run.

Use a modeless WPF flow consistent with the existing UI. Capture Revit data only in valid API contexts; send HTTP and stream files outside the Revit UI/API thread. Do not hold a transaction open during HTTP, file picking, or user typing.

Fields:

- Source/product/tool: Wall Elevation, another add-in tool, ERP, or other software request; tool ID and source context where available.
- Type: `Алдаа`, `Сайжруулалт`, `Асуулт`.
- Title and description; expected versus actual behavior; reproduction steps; optional suggested solution and impact.
- Explicit attachment picker with add/remove, filename/size display, progress, cancel, retry and clear validation errors.
- Optional selected active-view screenshot or diagnostic bundle, reviewed before sending. Never capture the desktop/other apps silently.

Make full RVT/model attachment opt-in through explicit file selection. Never auto-upload the user's model, all project files, entire journals or continuous screenshots. Permit ordinary useful evidence formats such as PNG/JPEG/WebP, PDF, TXT/LOG, JSON, ZIP and explicitly selected RVT/RFA within configured limits. Unknown/active formats must not be executed or rendered unsafely.

The form must work with no active model for general requests. It should remain usable for saving a draft when auth/network/license refresh is unavailable. Submission still requires valid authentication; do not make a public endpoint to work around failure.

### F02 Diagnostics that distinguish 2024 and 2027

Collect a small, versioned diagnostic schema:

- Revit major year AND full build/update number.
- Actual loaded add-in assembly/file/informational version, assembly location, SHA256, package/build ID and source commit when available.
- Runtime/.NET description, OS and relevant UI DPI/display information.
- Tool/command ID, operation stage, correlation/job/request IDs and timings.
- Exception type/message, bounded stack trace, inner exception and meaningful Revit failure IDs when available.
- View type, relevant settings, selected room/view/sheet identities and host/link status only as necessary, with explicit disclosure of project-identifying fields.
- Observed current version and target fixed version, separate from user-entered text.

Do not label all exceptions as a generic “Revit error”. Distinguish validation, permission, upload, offline, cancellation, missing source, API compatibility and unexpected defects. Exclude access tokens, cookies, passwords, device secrets, license credentials, signed URLs and unrelated document content from diagnostics. Show an understandable attachment/diagnostic summary before submission.

Do not swallow fatal process-level exceptions and pretend it is safe to continue. A crash handler may leave a bounded local diagnostic for the next launch; it must not block crash shutdown or start unsafe Revit API work.

### F03 Reliable offline submission and authentication

- Use existing device-bound add-in authentication/session renewal, cancellation and HTTP conventions. Do not embed R2 credentials, mint a new long-lived MCP token, or add an unauthenticated REST exemption.
- `purpose:'revit'` sessions are path-limited by `revitSessionCheck.ts`. Add only the submission/upload/own-receipt paths needed by the add-in, preferably method-aware. This must not grant the ERP triage inbox to a device session just because the session contains an admin role.
- A `revit-refresh` credential remains renewal-only and cannot submit or download feedback files directly.
- Persist a bounded local draft/outbox scoped by API host, tenant and submitting account. Never send user A's queued request after signing in as user B.
- Keep shared preferences/outbox storage safe across simultaneous Revit 2024 and 2027 processes: versioned compatible serialization, atomic replacement and appropriate inter-process coordination. Do not let one runtime erase another runtime's pending submission.
- Preserve selected bytes with a safe local copy or verify original size/hash before retrying. If the file moved or changed, explain and request reselection; do not silently send different bytes.
- Use stable client request/idempotency IDs. Timeout-after-success, repeated clicks, double Revit instances, session expiry and restart must not create duplicate requests or attachments.
- Classify retryable errors, use bounded backoff with jitter, honor Retry-After, bound disk use and concurrency, and distinguish cancellation from failure. Do not retry permanent validation/authorization denials indefinitely.
- Offline draft, queued, uploading, submitted, failed, retry and cancelled are clear UI states. Show “sent” only after server acknowledgement. Return a stable request number.
- Isolate feedback networking from work tracking/AI circuit breakers so feedback failure does not stop time tracking or poison other tools.

### F04 Private R2 storage and D1 metadata

Keep file bytes in PRIVATE Cloudflare R2 and metadata/workflow/history in D1. Use opaque server-generated object keys and attachment IDs.

Prefer a dedicated private `FEEDBACK_BUCKET` binding with no public domain or r2.dev access. Integrate it into the current tenant binding resolution rather than accidentally using the default company's bucket for another tenant. Feedback must return a clear unavailable response if its private binding is missing; never fall back to MEDIA_BUCKET. If choosing an existing private bucket instead, prove every generic reader/signed route cannot expose the new namespace and document that choice before using it.

Never return `/media/<key>` links for feedback. The existing public `/media` mount is not a protected download route. No public presigned GET URLs or anonymous download tokens for private requests. Serve through authenticated, reviewer-authorized attachment endpoints with private/no-store, safe Content-Disposition and nosniff headers. Do not expose storage keys as authority. Safe previews must fetch protected bytes; unknown files are attachment downloads, not executable inline content.

Implement a staged workflow with explicit attachment states, such as:

1. Authenticated sender creates/gets an idempotent draft.
2. Server reserves an attachment bound to that draft, actor and tenant, and issues an upload identity.
3. Bytes are uploaded as bounded streams; use an authenticated multipart protocol for large files if needed.
4. Server verifies completed object existence, actual bytes, limits and integrity metadata before marking ready.
5. Finalizing a request links only that sender's ready attachments and atomically transitions its D1 state.

Do not pretend D1 and R2 share one transaction. Handle R2 success/D1 failure, part upload failure, cancellation, finalize races and request retries. Reconcile abandoned uploads with an age/state-aware cleanup job. Preserve referenced files and submitted requests. Audit generic orphan/lifecycle cleanup so it cannot delete valid feedback objects. Do not implement broad destructive cleanup as part of this task.

Define integrity verification honestly. An R2 multipart ETag is not a SHA256 of the whole original file. Distinguish a client-reported hash from a server-verified checksum; use supported incremental/chunk verification or storage checksum facilities without buffering the complete model. Do not claim stronger verification than actually performed.

Default limits if no existing appropriate limits: at most 5 explicit attachments and 100 MiB total per request; ordinary files up to 25 MiB each; an explicitly selected RVT/RFA/ZIP may use the multipart path up to the remaining request total. Make limits configurable and shared by server/client; use streaming byte checks, not Content-Length alone. Validate names, control characters, extensions/content types, ownership, upload expiry and all multipart operations. Do not buffer a whole large RVT in Worker memory or the Revit UI process. Invalid parts must not attach to another request or tenant.

Suggested D1 concepts, adapting to repository conventions:

- engineering requests: opaque ID, human request number, submitting user, recipient binding, source/product/tool, type/title/body, expected/actual/steps, diagnostics schema/json, status, priority, duplicate link, Revit year/full build, add-in version/hash, fixed release, created/updated/submitted timestamps and concurrency version.
- attachments/uploads: request ID, owner/tenant, opaque object key, sanitized original name, media type, actual byte size, integrity data, upload state/expiry and timestamps.
- events/comments: actor, visibility, state/priority changes, notes, duplicate/reopen actions, release links and timestamps.
- reviewer capability membership/configuration without altering the global users role CHECK constraint.

Use new append-only migrations, reserve currently free migration numbers after fresh inspection, and do not edit already applied migrations. Do not rebuild/drop users or other parent tables to add this capability.

### F05 ERP inbox and follow-through

Add a sidebar entry such as `Програмын хүсэлтүүд`, visible only when server capability says the current verified Software Engineer can review. Add the actual protected route and page, not only a sidebar item. Reuse the design system and Mongolian UI conventions. Cover desktop, collapsed sidebar, mobile navigation and deep links.

Features:

- Paginated, searchable list with unread status and filters for source/tool, request type, priority, status, Revit year/full build, add-in version/hash and date.
- Request detail with description, reproduction, expected/actual, versioned diagnostic context, attachments, preview/download, timeline and clearly separated private engineering notes versus sender-visible replies.
- Status workflow: received → triaged → in progress → awaiting information/ready for retest → resolved, plus duplicate/rejected and reopen handling. Adapt names to a coherent finite transition model; record every change and actor.
- Priority and duplicate grouping without hiding the original evidence. An unresolved 2027 regression can be filtered and related to 2024 results.
- Link a source commit/PR and the actual fixed release per Revit year. Never promise a fix or auto-close a report solely because a build number increased.
- `Бэлэн засварыг шалгах` or equivalent retest flow: sender can send “still broken” with current diagnostics, or confirm it works. Preserve the original report and history.
- Unread count and in-app notifications go only to the authorized reviewer account. Do not call a generic “notify all reviewers/admins” helper without narrowing its recipients. No external email/Slack notifications are required.
- Allow ERP staff to submit other software requests using the same secure submission contract; they do not gain the reviewer sidebar.
- Avoid an enormous speculative analytics dashboard. The essential operational view is requests → diagnosis → implementation → fixed release → retest.

Protect user text from XSS, parameterize queries, validate status/duplicate links and use optimistic concurrency so simultaneous edits do not silently overwrite history. A duplicate relation cannot reference an inaccessible tenant/request or itself.

## 6 Wall Elevation requirements to implement

The following defaults resolve earlier unanswered routine choices. Expose a deliberate option where useful; do not reopen all previous questions before starting.

### W01 Useful background generation

The user must continue other work/modeling while generation proceeds. Revit API calls remain on the valid main-thread API context; HTTP and pure snapshot calculations may run elsewhere. Inspect and correct the actual long steps rather than just wrapping the existing synchronous loop in Task.Run.

Baseline: CdJobHost passes a 150 ms slice budget, but WeJob.Step does not subdivide work with that budget. Whole-view annotation and some existing-sheet operations are single steps; synchronous fallback also exists.

Split work at safe transaction boundaries, measure slow individual API calls, cache expensive repeated reads, avoid idle starvation and continuous forced Idling spinning, and keep modeless progress/Pause/Resume/Cancel responsive. Do not leave a Transaction/TransactionGroup open across user modeling or Idling yields. Avoid silent blocking fallback when the background host is unavailable; give a useful recoverable state.

Observe source changes while a job is active. Unrelated modeling should proceed; changed/deleted selected rooms, walls, floors, ceilings or link transforms must invalidate affected snapshots and replan safely or pause that affected work with a useful message. Do not complete using silently stale geometry. Preserve Undo/Redo behavior and do not mix the user's modeling into generator ownership/deletion tracking.

### W02 All elevations on one sheet with four placement regions

This is NOT a requirement to shrink everything until it prints neatly. Architects want all generated elevations together on one editable sheet, even if they do not fit. The user later creates another sheet and moves selected views manually.

- Default: one sheet per selected room, not one sheet for an entire multi-room batch. Allow a deliberate existing target sheet choice. Do not change this implicitly based on fit.
- Four initial regions: upper left, upper right, lower left, lower right. Keep deterministic side/label ordering without rotating the actual elevation content for packing.
- Place extra/oversize elevations in visibly offset stacks within these regions, keeping identity/title discoverable. Never place all items at identical coordinates where they cannot be selected. Provide selection through the result list.
- Do not create automatic continuation sheets. Preserve chosen view scales. Do not omit a view because it does not fit.
- Key plan, 3D, selected legends and ready-made image slots stay on the same sheet in distinguishable helper positions; they must not silently vanish. Prefer remaining usable area, then a visibly offset overflow area. If necessary, permit spill beyond the printable frame while protecting title-block text where practicable; report these as “байрлуулж цэгцлэх”, not “ready to print”.
- Correct the bottom usable-area calculation/SheetBottomBand/title-block obstacle handling so valid lower areas are not unnecessarily excluded. Show usable area and overflow in preview where feasible.
- Intentional overlap/out-of-frame placement is an allowed layout state in this mode. The existing CheckSheet/Refit/Continuation paths must not “repair” it by spreading views to new sheets. Audit ALL initial and rerun placement paths.
- Rerunning preserves manually moved existing viewports, titles, scale and render placements, adds only newly needed views, and avoids duplicates. A separate explicit “Дахин байрлуулах” action may reset placement after a preview.
- When a user manually moves a generated view to another sheet, retain it there on future runs and find its actual current sheet. Do not pull it back or create another copy.
- Do not silently consolidate previously generated multi-sheet sets. Offer an explicit selected-set “Нэг sheet дээр цуглуулах” action if implemented, preserving old sets by default.

### W03 Independent visible scales

Expose elevation scale, 3D/axon scale and key-plan scale separately in the main settings. These fields already exist in baseline settings; make them discoverable and honor them throughout generation and reruns. In this single-sheet mode, FitAxonUnderKeyPlan/NarrowColumn or equivalent logic must not override the user's selections to reduce page count.

Ready-made render images use paper width/height/aspect handling, not an invented model scale. Keep existing explicit image placement/fill behavior reliable. No automatic render generation is requested.

### W04 Automatically choose a valid center

Select a Room identity, read its actual boundary/phase/link transform, and determine valid interior marker position(s) without requiring the user to position the center correctly. Moving a room tag or clicking near a wall must not move the generation center incorrectly.

The baseline already derives marker positions from view planes. Its Fits validation is not a universal check on every newly created isolated marker. Preserve useful geometry logic and close this validation gap.

Rectangular rooms should use a meaningful center. L/U-shaped rooms, islands/holes, narrow and rotated rooms require an interior point validated against the actual region. A bounding-box midpoint or polygon centroid alone is insufficient. Use multiple safe markers when one point cannot face all required walls. Confirm view direction, lateral coverage, depth and interior membership for EVERY marker. Do not move the user's Room.Location, Room tag, walls or source model to make generation work.

### W05 Sheet and elevation numbering ranges

Add clear settings for both sheet number and elevation/detail labels: prefix, start/end allowed range and digit padding as relevant; support alphabetical or numeric side labels. Default labels restart per room with room identity included where needed to prevent same-sheet conflicts; allow explicit batch-continuous numbering if useful.

Preview the actual count/next numbers/conflicts before generation. End is a range limit, not a reason to create blank sheets or fake extra elevations. If the range is insufficient, require correcting it before mutation; do not silently exceed it or renumber unrelated sheets. Handle existing numbers atomically and preserve generated identities independently of visible names.

Synchronize viewport detail numbers, view titles, key-plan labels, sheet names/ranges and displayed references. Preserve deliberate manual names unless the user explicitly requests a rename. Provide deterministic behavior when adding/removing a side later.

### W06 Find every result and its current sheet

Provide a persistent/reconstructable result browser: Room → Elevation → actual current Sheet, with new/updated/needs arrangement/unplaced/failed states and direct actions to open a sheet, open a view and select its viewport. Rebuild it from generated view identity plus real viewport placement, not only the original generated sheet or a short in-memory job history.

Handle manual move, rename, delete, unplaced view, restart and multi-room batch. The current review panel and last-five-job cards are useful foundations, not the complete index.

On user action, locate/highlight the selected sheet/view among Project Browser entries using supported Revit behavior. Test exact native behavior on 2024 and 2027. Do not promise arbitrary permanent coloring of all native tree rows unless a supported API is actually demonstrated. When Browser Organization filters an item out, explain that and still open it from the result browser. Do not mutate office Browser Organization silently.

Do not steal focus while the user models elsewhere. Completion notification and an explicit navigation action satisfy discoverability without interruption.

### W07 Location key plan and manual vertical crop

- Show elevation IDs, viewing arrows and actual sheet references in the room key plan/location legend. Keep references correct after manually moving views or changing numbers.
- Add per-elevation lower/upper crop controls in mm relative to the room's relevant finished floor, with Auto/reset and interactive preview where feasible. Persist the override on the generated view and restore it on rerun.
- Distinguish an intentional partial crop from accidental missing wall coverage. Adapt the “Босоо хүрээ ханын өндрөөс бага” validation to the user's declared intended bounds without disabling real source/direction/depth or upstairs-geometry checks.
- Do not modify an existing Extensible Storage schema under the same GUID. Use a versioned new schema/migration/reader fallback if adding fields. Preserve existing generated identities and overrides.

### W08 Floor ceiling joints and steps

The requested features are panel/tile joints AND level changes/steps. Baseline slab snapshots primarily contain bounding boxes and horizontal plan faces; that is not sufficient evidence of accurate sloped-floor section heights or tile layout.

Read the actual visible/intersection geometry relevant to the target wall/view. Preserve material surface/cut pattern origin, orientation and spacing where the model defines them. Distinguish geometric seams, material patterns and drafting annotations. Do not invent missing joints or take one bbox elevation as the local height everywhere.

Support multiple ceiling heights, stepped floor/ceiling edges and slopes where the source actually contains them. Keep elevations versus sections/details semantically correct: an elevation does not expose every internal floor layer merely by toggling an annotation. Provide a correct source-linked section/detail path where needed and verify print/PDF behavior.

Bathroom drawings need a different preset, fixtures/partition handling and possibly floor sections. Implement well-defined geometry and preset foundations now. The company-specific bathroom detail, waterproofing/threshold/layer conventions, exact required view count and annotation rules remain pending the user's example image. Do not invent a “correct standard” or normative dimensions; explicitly mark that acceptance item pending sample rather than falsely complete.

### W09 Unified room presets and English categories

- One Wall Elevation workflow for Interior and Architecture. Preserve sheet classification/folder/template behavior through a visible purpose/preset selection rather than competing commands with hidden locked settings.
- Offer room presets such as Interior, Architecture, Bathroom and Custom. A preset includes annotation selection, category visibility, view templates, key plan/3D/legends/image slots and sheet metadata.
- Suggest a preset from room parameters/name and actual contents with a short explanation; users can override it. Use deterministic rules, not a required AI model.
- Mixed-room batches must retain per-room preset/overrides. One global checkbox matrix must not force bathrooms and offices to the same settings.
- Keep advanced checkboxes available. Show recognizable English Revit category names, with accurate group labels/tooltips for combined categories: Walls, Doors, Windows, Floors, Ceilings, Plumbing Fixtures, Furniture, Casework, Generic Models, etc. Avoid presenting a mixed electrical group as one exact native category.
- Respect existing saved preferences and manual customizations when migrating settings.

### W10 Assistant default and postponed curved walls

Do not open MGL AI assistant automatically. Set appropriate initial visibility and account for restored session state/upgrades. Keep the explicit assistant command working and keep the generation progress/feedback UI independent.

Curved-wall strategy is deliberately deferred until architects choose the expected representation. Preserve an honest unsupported/review state. A chord-based forced flat view is not a true length-unwrapped curved-wall drawing; do not label it as such. Do not block unrelated improvements on this future choice.

## 7 Revit 2024 and 2027 compatibility work

### V01 Establish the actual failing environment

Record installed full Revit builds, actual loaded DLL paths/hashes, manifests, plugin version, source/overlay hash and runtime. Check for duplicate .addin manifests, stale payload folders, side-by-side installs, missing dependencies and “installed new package but running old DLL until restart”. Ask for the smallest missing 2027 repro/log only after adding useful diagnostics and investigating locally available cases; never guess the error.

Baseline targets: Release R24 → net48; R25/R26 → net8.0-windows; R27 → net10.0-windows. Bare dotnet build falls back to R27, so use explicit configurations. Re-read current project settings before use. Autodesk documents Revit 2027's .NET 10 migration; do not retarget it to .NET 8 based on older Revit assumptions.

### V02 Version-specific API behavior

Investigate relevant differences empirically: startup/event registration, conditional compilation features present only in 2027, modeless WPF ownership/DPI, selection from sheets/linked rooms, ElevationMarker orientation and far clip, CropBox transforms, viewport/label measurements, reference validity for dimensions, spot levels/relative base, key plan/3D visibility, masking/transparency/red frames, export to PDF, cancellation/rollback and background job scheduling.

Use focused compatibility adapters where a real difference is established. Do not scatter “if 2027 then ignore error”, disable validation, suppress failures globally, use localized UI strings as geometry identity, or change shared 2024 behavior without regression checks.

Audit floating `Nice3point.Revit.Api.*` package versions and compilation against a newer API minor than the installed Revit update. Pin/document a supported baseline per year and exercise the minimum supported update. A missing API member needs a compatible implementation or an honest required-update message, not a crash.

### V03 Installer and package integrity

Baseline installer can reuse a version folder when the OLD folder's own payload list verifies, while current.json records the NEW payload hash. Fix same-version/different-payload handling so metadata cannot claim uninstalled bytes. Prefer immutable version/build identity; reject conflicting reused versions or create an unambiguous build folder as appropriate. Do not delete a DLL loaded in the user's running Revit.

Use a fresh version greater than the actual latest distributed one, not a hardcoded downgrade to 1.40. Build and package each year's correct runtime/API. Preserve credentials, outboxes and settings on update. Validate extracted payload, loaded assembly and package manifest hashes. Test new install, upgrade from 1.45, reinstallation, conflict payload and rollback.

The candidate builder's default overlay includes only `addin/WallElevation`. This task also changes shared auth/feedback/UI/installer code. Ensure the tested candidate includes ALL intended relevant changes, without including unrelated WIP. Record exact source/overlay manifest and hash. A green test on a candidate missing the new feedback module is not evidence.

### V04 Correct the release gate's evidence model

Keep separate statuses for 2024 and 2027 at build, UI smoke, synthetic live, real project and PDF/export levels. Compile 2025/2026 for shared-code regression if advertised, but never claim them live-verified without running them.

At baseline the gate reads one generic real-project-validation.json and checks simple PASS/tester/model fields. Replace/extend this with evidence bound to Revit year, full product build, actual DLL/package hash, candidate/source ID, model fixture ID/version, scenario set and test timestamp. A 2024 signoff cannot satisfy 2027. Stale reports or a previous DLL hash cannot satisfy a new candidate. Human approval/signature is never fabricated by a test script.

Use the existing live harness, adding scenarios for every changed behavior rather than replacing it with mocks. Core tests on net48/net10 and WPF smoke tests do not prove in-process Revit API behavior.

Use canonical source fixtures and upgrade disposable copies for 2027. Never try to save a 2027-upgraded RVT back to 2024. Align phase/units/link transforms and compare semantic geometry, annotation counts/values, sheet locations/scales, visibility, PDF and screenshots with justified tolerances; binary image equality is not required.

Missing environment/evidence is NOT RUN/BLOCKED/NOT VERIFIED. Reproduced release-blocking known bugs remain FAIL. Never let editing known-issues.json or omitting a scenario erase a failure. Add tests for the gate's own false-PASS cases.

## 8 API and schema contract to define before implementation

Choose final names consistent with the repository, but write and test a clear contract equivalent to:

| Surface | Caller | Required boundary |
| --- | --- | --- |
| Capabilities and limits | authenticated current user | own flags only; no inbox metadata |
| Create/update own draft and reserve/upload/abort/complete attachment | eligible staff/add-in | tenant + submitter + draft/upload ownership + allowed method/path |
| Finalize submission | eligible owner | idempotent; only verified ready attachments |
| Own receipt/public status/retest | original submitter | minimal own data; no private engineering notes or global list |
| Inbox list/count/search/detail/export | ERP Software Engineer reviewer | configured Өсөхбаяр account AND live capability AND tenant |
| Attachment preview/download | same authorized reviewer | authorized parent request; private byte stream |
| Triage/comment/priority/duplicate/release/status | same reviewer | valid transition + audit event + optimistic concurrency |

Suggested prefix `/api/engineering-feedback` is not permission by itself. Add the narrow add-in paths to session policy without allowing management routes. Do not mount the new router underneath the existing `/api/revit-addin` OWNER_ID=1 guard or the admin suggestions router. Explicitly integrate the right module so a progress-only/add-in deployment does not accidentally disable core support, and ensure frontend/backend module mapping agrees. Default engineering feedback to an appropriate existing core/support module, not paid AI.

Public item numbers can be human-readable; IDs and R2 keys must still be protected. Enforce authorization on HEAD/range/preview/download/count as well as normal GET/POST. Avoid cross-tenant cache keys and shared cached private responses. If cookie-authenticated mutations are used, preserve the application's CSRF/origin protections; CORS is not authorization.

## 9 Implementation sequence and checkpoints

Phase A — Establish baseline and contract

- Record git/installed build state and known failures without making unverified claims.
- Produce the requirement matrix, targeted change map, feedback auth/storage/API contract and year-specific test plan.
- Then proceed directly; do not stop with only this plan.

Phase B — One secure feedback vertical slice

- Capability + verified recipient binding + append-only schema + protected draft/upload/finalize/private download endpoints.
- Revit form submits a real request with an attachment and diagnostics.
- Өсөхбаяр sees it in the protected ERP inbox; unauthorized fixtures cannot list it or fetch its bytes.
- Then complete retry/outbox, triage/history/retest and ERP submission flows.

Phase C — Wall Elevation workflow

- Background/source-change handling; single-sheet staging/intentional overlap; scale preservation; manual move/rerun protection; current-location result browser.
- Center validation; number ranges; key-plan references; vertical crop; unified presets/English labels; assistant visibility; well-defined floor/ceiling geometry improvements.
- Keep curved-wall method and sample-dependent bathroom conventions explicitly deferred, not replaced with speculative behavior.

Phase D — Cross-year root causes and release machinery

- Reproduce/fix available 2027 defects, add regressions for each root cause and rerun 2024 for shared changes.
- Fix candidate scope, stale payload reuse and per-year/per-hash real-project evidence.
- Package and inspect correct builds, run synthetic/live/real-project checks where available, and prepare a truthful candidate handoff.

At every phase update the checkpoint with completed IDs, exact commands/results, source/build hashes, remaining blockers and next concrete actions. Keep commits reviewable and scoped to coherent changes.

## 10 Mandatory verification

Write meaningful tests for this consequential change. Test real Hono handlers/auth/storage behavior and Revit workflows where available, not only helpers that mirror implementation.

### Backend and frontend

- Verified owner+capability succeeds; same name/wrong ID, another Software Engineer, admin/senior/architect/engineer without binding, revoked capability, inactive user, expired token and wrong tenant are denied.
- Sidebar, route/deep link, inbox list/count/detail/search/export and every attachment path have matching authorization. No auto-admin leak.
- Valid device session can submit using only allowed paths; refresh credentials and device sessions cannot obtain the reviewer inbox. Revoked devices and session scope restrictions still work.
- Cross-request/owner/tenant upload IDs, arbitrary R2 keys, reused upload IDs, invalid MIME/name, oversize streams, missing parts, expired upload and malicious preview files are rejected safely.
- Timeout-after-finalize, double submit, retries and concurrent finalize produce one request/attachment set; changed idempotent payload conflicts rather than overwriting.
- R2/D1 partial failure and cleanup preserve ready/referenced files; public `/media`, generic private-bucket readers and guessed URLs do not expose feedback.
- Internal notes never reach submitter responses or notification previews. Only the designated reviewer receives the new-request notification/count.
- Stale optimistic updates do not erase history; duplicate links are valid and tenant-local.
- Mobile/desktop form and inbox work for loading/empty/error/offline states and attachments with Cyrillic filenames.
- Run current backend tests and typecheck, frontend required verify/build and relevant navigation checks. Report unrelated baseline failures without repairing unrelated features.

### Revit 2024 AND Revit 2027

Run each applicable scenario in each year and identify the actual loaded DLL hash:

1. Background generation while modeling elsewhere, active sketch/command, focus preservation, Pause/Resume/Cancel, Undo/Redo, source mutation/deletion, link unload and document close.
2. Four, nine and twenty elevations on a single sheet; oversize/intentional overlap; no automatic continuation; helpers and image slots remain discoverable; no scale override.
3. Rerun after manual viewport placement, moving to a manually created sheet, renaming/deleting sheet/view, adding/removing a side and restarting Revit. No duplicates or forced reflow.
4. Room tag away from center; rotated rectangles; L/U/island/narrow rooms; linked rooms/transforms/phases; all marker positions valid and views facing correct walls.
5. Elevation 1:50 with 3D 1:25 and an independent key plan scale; chosen values remain exact through generation and rerun.
6. Sheet/label range boundaries, insufficient range, occupied numbers, label swaps and added sides. View/viewport/key-plan/report references agree.
7. Result browser opens/selects actual current sheet/view; native Browser locate handles closed/filtered Browser honestly.
8. Manual lower/upper crop and reset; no upstairs geometry leak, missing intended wall segment or unintended depth. Preview cancellation/rollback leaves no temporary elements.
9. Tile/panel patterns, floor/ceiling steps/slopes from known source geometry and representative PDF outputs. Sample-dependent bathroom acceptance remains pending, not fake PASS.
10. Mixed room presets, English categories, unified classification behavior, AI assistant initially hidden, selected ready-made images preserved.
11. Feedback form from tool/error/no-model states; selected file and diagnostics reach R2/ERP; session expiry mid-upload; offline/restart/double Revit instance; cancellation and Cyrillic filenames.
12. Clean install/upgrade/stale payload conflict/side-by-side years, actual assembly load and release manifest validation.

### Gate tests

Prove that missing 2027 live reports, only-2024 real-project approval, wrong DLL hash, stale candidate, incomplete scenario set and reproduced blocking known issue cannot produce full PASS. State build-only versus live-verified coverage for 2025/2026 if included.

## 11 Definition of done and final handoff

The work is complete when the connected implementation exists, required feasible checks have run, and remaining unavailable evidence is identified precisely. Do not present a partial UI mock as a complete system.

Provide in Mongolian:

1. Concrete resulting behavior and the major fixed root causes.
2. Requirement matrix with implemented/verified/deferred/blocked status, separating code complete from live verified.
3. Exact role/capability semantics, verified recipient binding approach, and evidence that other users/admins cannot read the inbox or attachments. If real identity is unresolved, say the reviewer is unbound and fail-closed; include the one safe binding step.
4. Feedback flow, actual API routes/schema/migrations, private R2 binding/tenant configuration, limits, outbox and cleanup behavior.
5. 2024-versus-2027 matrix with full product builds, loaded DLL hashes, candidate source/package hashes, executed commands and evidence paths. Link each 2027 fix to a reproduction and regression where possible.
6. Reviewable branch/commits or PR, new versioned installer/package locations, install/update/restart instructions and rollback instructions that preserve credentials/offline work.
7. Any environment-dependent blocked checks and the smallest next action, without claiming successful deployment or tests that did not happen.
8. Explicitly deferred curved-wall representation and sample-dependent bathroom conventions. Do not broaden this into a reason to leave the rest unfinished.

Begin by reading the fresh repository and baseline, then implement. Do not respond with another general recommendation list.

## Reference notes for verifying technical assumptions

Consult current official documentation while implementing version-sensitive APIs:

- Autodesk Revit 2027 .NET 10 migration: https://help.autodesk.com/view/RVT/2027/ENU/?guid=GUID-8D7A4715-EAF8-4BD1-BE78-061F900D0BCE
- Autodesk Revit API main-thread access: https://help.autodesk.com/cloudhelp/2024/ENU/Revit-API/files/Revit_API_Developers_Guide/Introduction/Getting_Started/Using_the_Autodesk_Revit_API/Revit_API_Revit_API_Developers_Guide_Introduction_Getting_Started_Using_the_Autodesk_Revit_API_Deployment_Options_html.html
- Autodesk Idling behavior: https://help.autodesk.com/cloudhelp/2026/ENU/Revit-API-MainReference/files/html/56145d84-e948-730a-dc72-2a7b88a50a99.htm
- Autodesk Revit 2024 Find in Project Browser: https://help.autodesk.com/cloudhelp/2024/ENU/Revit-GetStarted/files/GUID-C8D3E5A6-02A5-43A9-AFFC-D49DD27398B1.htm
- Cloudflare R2 Workers API: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- Cloudflare R2 multipart upload: https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/
- Cloudflare R2 multipart ETags and part limits: https://developers.cloudflare.com/r2/objects/upload-objects/
