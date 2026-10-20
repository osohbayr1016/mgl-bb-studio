# Engineering feedback + Wall Elevation + Revit 2024/2027 — implementation checkpoint

> Persistent checkpoint for the task described in `CLAUDE_OPUS55_MGL_WALL_ELEVATION_FEEDBACK_IMPLEMENTATION.md`
> (the prompt lives untracked in the main checkout). Update at every phase boundary.
> Branch: `feat/engineering-feedback-we-2026-10-16` · worktree `C:\Users\User\project\mgl-we-feedback`.
> Status words: TODO · IN PROGRESS · CODE COMPLETE (compiles + unit/route tests) · LIVE VERIFIED (ran in Revit / real browser)
> · DEFERRED (owner decision pending) · BLOCKED (environment/credential missing) · NOT RUN.

## Phase A — baseline (2026-10-16)

### Git
- main checkout `C:\Users\User\project\mgl-e-c` @ `e993deb4`; dirty files belong to another agent
  (`backend/src/lib/blockDuplicate.ts`, `taskCreditReconcileQueue*`, `routes/blocks.ts`, untracked
  `backend/migrations/0404_task_credit_reconcile_claim.sql`) — NOT touched.
- This work: isolated worktree, branch `feat/engineering-feedback-we-2026-10-16` from `e993deb4`.
- **Discrepancy resolved (csproj 1.40.0 vs docs 1.45.0):** the distributed/installed 1.45.0 (`release.json`
  `git_sha 38c92e19`, `git_dirty true`, built 2026-10-14T10:20:56Z) = branch `feat/roomplan-furniture-tiers`
  (9 commits NOT in main: Room Plan floor studio, tiered furniture, installer in-use fix, InformationalVersion fix)
  + the WallElevation overlay later committed to main as `99e0acdf`. A candidate built from main alone would
  silently regress Room Plan. → merge commit `e4c12461` = main + feat tip `38c92e19` (only csproj conflicted;
  App.cs/RibbonBuilder.cs/CLAUDE.md auto-merged and checked). Version 1.45.0 in the merge; candidate = **1.46.0**.

### Installed add-in on this PC (both installed 2026-10-16 01:08Z, i.e. today)
| Year | Revit build (RevitAPI.dll FileVersion) | Manifest assembly | DLL sha256 | payload_sha256 | install note |
|---|---|---|---|---|---|
| 2024 | 24.1.0.66 (20230701_1515) | `%LOCALAPPDATA%\MGL\RevitAddin\2024\versions\1.45.0\RevitMcpAddin.dll` | `60834f87…de0` | `604a5c66…f20e` | `reuse=True` (folder from 10-14 build kept) |
| 2027 | 27.2.0.39 (20260716_1515) | `…\2027\versions\1.45.0\RevitMcpAddin.dll` | `a3e45386…548a` | `17668fc8…012a` | `reuse=False` |
- One `.addin` manifest per year (`%APPDATA%\Autodesk\Revit\Addins\<y>\RevitMcpAddin.addin`), no duplicates;
  2024 also has `pyRevit.addin`. 2025/2026 Revit not installed (dirs only).

### Revit 2027 investigation so far (V01/V02)
- Revit 2027 journal `journal.0176.txt` (2026-10-15, add-in 1.43.0):
  `API_ERROR … Assembly version conflict in some references in RevitMcpAddin.dll: Addin's module RevitAPI of
  version 27.3.0.0 conflicts with same preloaded module of version 27.2.0.0` (same for RevitAPIUI). Cause:
  csproj floats `Nice3point.Revit.Api.* Version="$(RevitVersion).*"` → restores **2027.3.0** while this PC runs
  **27.2**; 2024 floats to **2024.3.60** while this PC runs **24.1**. Revit still loaded the add-in
  (events + buttons registered after the warning).
- Compile-time API surface experiment (2026-10-16): the merged source compiles with **0 errors** against the
  MINIMUM packages `2024.0.0`, `2025.0.2`, `2026.0.4`, `2027.0.0` (and `2027.2.0`). ⇒ no compile-visible use of
  API members newer than each year's first release. The version-conflict warning is real but is NOT by itself
  evidence of a crash. Fix planned (V02): pin per year to the minimum supported update and document it.
- No exception attributable to MGL in journals 0175/0176 (the one API_ERROR exception there is Autodesk's
  MEPSizingCalculator dockable pane). Revit 2027 has NOT run since 1.45.0 was installed → the user's 2027
  failure is not yet reproduced locally. Next: run the live gate on 2027 with the candidate; add diagnostics (F02)
  so the next report carries year/build/DLL hash/exception.
- `wall-elevations.log` last written 2026-10-14 18:29 (before the 1.45.0 install).

### Reviewer identity (A03) — resolved, read-only
- 2026-10-16, `wrangler d1 execute mgl-progress-db-v3 --remote --json` (SELECT only; `changed_db: false`,
  `rows_written: 0`): broad search on `full_name LIKE '%сөх%' | '%СӨХ%' | '%Өсөх%'` and username
  `%osoh% | %usukh% | %osokh%` returned **exactly one** row:
  `id 75 · username usukhbayar · full_name «Оюунбүрэн Өсөхбаяр» · employee_id USH · role admin · status active ·
  position «Software engineer» · created 2026-08-04`.
- Four independent fields agree (Cyrillic name, Latin username transliteration, employee code, job title).
  Binding = `(user_id 75, username 'usukhbayar', employee_id 'USH')`; runtime requires ALL to still match the
  live `users` row + active status + live capability. Job title is corroboration only, never an authorization input.
- `revitAddin.ts` OWNER_ID=1 (Anand) is unrelated and not reused.

### Baseline build of merged source
- `Release R24` 0 errors (28 warnings), `Release R27` 0 errors (30 warnings) — 2026-10-16.

## Phase B — feedback vertical slice (2026-10-16)

Commits on the branch: `d7d1b09d` backend (migrations 0410–0414, `routes/engineeringFeedback.ts`,
`lib/engineeringFeedback{,Access}.ts`, session policy, tenants, cron sweep) · `bce41b1a` ERP UI.

- Backend route tests `routes/engineeringFeedback.test.ts` 18/18 (real authMiddleware + workerScope + clientScope
  + media route, node:sqlite, R2 fake incl. multipart). Full `npm test`: the only failures are the 5 pre-existing
  main-baseline ones (system catalog stale, migration number duplicates, transport statement counts, templateNote,
  taskAlloc clean↔upgrade) — each re-checked on the main checkout.
- Frontend: `tsc -b` 0, eslint clean on touched files, `npm run verify` PASS; new pages are lazy chunks.
- Browser E2E (headless Chrome via CDP, scratch `wrangler dev :3187` on a COPY of the local prod-copy D1 + 0410–0414,
  miniflare R2, Vite :5199): 31/31 — submit with 2 Cyrillic-named files → ПХ number receipt; admin (id 1) no row,
  route = not-found panel, API 404, can_review=false; reviewer (id 75) row visible, unread count, deep link, blob
  image/text preview, triage → in progress → ready for retest with reply + private note, fix release linked; sender
  sees reply + release, private note absent from DOM AND API JSON, still-broken → reopened; notifications go to the
  reviewer (new + activity) and the sender (update, no private note); 390 px no horizontal overflow.
- System catalog generator skips capability rows (0 catalog delta from this change); the generated file was NOT
  regenerated — its existing staleness belongs to other changes (pre-existing failing test, out of scope).

Not done for F04/F05 in production: R2 bucket `mgl-engineering-feedback` not created, migrations 0410–0414 not
applied remotely, worker/Pages not deployed (no deployment authorization in this task).

## Phase C — Revit add-in feedback, W10, V02–V04 (2026-10-16)

Commits: `9c11ef47` add-in feedback F01–F03 · `7193a264` W10 assistant hidden · `09b2e022` V02 pin · `284d1dac` V03
installer · `b0e033ab` V04 gate.

- **F01–F03** (`revit-mcp/addin/Feedback/`, Core is Revit/WPF-free): modeless «Санал хүсэлт» window (ribbon Library
  slot, always enabled, no license gate, works with no document) + Wall Elevation dialog button with context; versioned
  diagnostics (`mgl-diag/1`: Revit year/build/language, DLL path/version/SHA-256, release.json version/commit, runtime,
  OS, DPI, stage, exception classification, secrets masked, ≤64 KiB); crash capture (observe-only, only stacks inside
  `RevitMcpAddin.`); offline outbox `%APPDATA%\RevitMcpAddin\feedback` scoped by SHA-256(host|tenant|user), lease file
  (`FileShare.None` + `DeleteOnClose`), atomic writes, idempotent `client_request_id`, staged upload (draft → single PUT
  or 8 MiB parts with per-part SHA-256 → complete → submit), equal-jitter backoff + Retry-After, 401 → auth_required
  without burning attempts. Token read per request and scope re-checked (a token switch never sends another user's item).
  Tests: `tests/Feedback.Tests` 28/28 (incl. a real second-process lease probe), MglUi.Tests 140/140, R24–R27 0 errors.
- **W10:** assistant dockable pane `VisibleByDefault = false` + one-time hide after upgrade; health report moved to
  `HealthReporter` (no longer depends on the pane being open). Curved walls stay unsupported/review (no change).
- **V02:** per-year pinned `Nice3point.Revit.Api.*` (2024.0.0 / 2025.0.2 / 2026.0.4 / 2027.0.0); AddinInspect 9/9 for
  2024 and 2027 (compiled ≤ installed).
- **V03:** installer reuses `versions\<v>` only for the SAME payload; otherwise replace, or `versions\<v>-b<sha8>` when the
  old DLL is loaded; current.json records folder + on-disk payload; candidate builder records `excluded_uncommitted` and
  per-year DLL SHA-256. `test-bundle.ps1` 66/66 with the new installer; the old installer fails 7 checks of scenario H.
- **V04:** `gate-lib.ps1` + `gate-selftest.ps1` (44/44; mutation 12/12 killed). Evidence bound to year + run.json Revit
  build + DLL SHA-256 + candidate tag + fixture identity + complete scenario set (`required-scenarios.json`,
  `scenario_plan`); per-year build / UI smoke (new `WallElevation.UiSmoke.Net48`) / live / PDF-export / real project.
  Real-data check on the 1.45.0 bundle: the 2024 run `20261014-182152` (19-scenario filter) that the old gate read as
  PASS is now NOT VERIFIED; a tampered candidate DLL hash → build FAIL. UI smoke net10 + net48 PASS.

## Phase D — Wall Elevation W01–W10 (2026-10-16)

Commits: `6a502880` W02/W03 (+W01 no silent sync fallback) · `a7684b7b` W04 · `509fc6cf` W05 · `c37c55d6` W07 · `aaa5d497` W06 ·
`ae246e17` W09 · `bc630ce1` W10 (chord wording) · `c89497ef` W01 (source watch + replan, pending annotation signature) · `a759a86f` W08 ·
`246770ed` job-start log + slope wording · `3eb18c29` live-gate scenarios · `94f34c53` version 1.46.0.

- Core tests (net10 AND net48 = Revit 2024 runtime): **346/346** each. Mutation checks (each mutation must fail a test): W07 15/16
  (survivor = a redundant planner-side guard behind the tested annotation clamp), W09 12/12, W01 15/15, W08 11/11 + 1/1.
- UI smoke (real WPF, outside Revit) net10 + net48 PASS (crop editor, presets, result browser).
- Builds: Release R24 0 errors (28 warnings, baseline), Release R27 0 errors (30 warnings, baseline); LiveGate 2024/2027 build.
- New required live scenarios (`required-scenarios.json`): REPLAN-HOST-102 (W01), FOCUS-HOST-103 (W06), CROP-STORED-105 (W07),
  SURF-LINK-201A (W08; synthetic host model gets a flat + a sloped ceiling and a +150 platform in room 201A), PRESET-INT-B102 /
  PRESET-KEEP-B102 (W09, Interior ribbon command).
- Live results: see «Phase E» below.

Deliberately NOT done (owner decision or sample pending): curved-wall representation (chord-based forced view only, honestly labelled);
bathroom conventions (preset exists, its annotation set is a placeholder until the sample arrives); W08 material surface-pattern report and
a section/detail path for floor layers; Project Browser row colouring (no supported API — locate = ShowElements + pane).

## Phase E — live release gate (2026-10-16, this PC, own Revit instances, synthetic models)

Command: `release-gate\wall-elevation\gate.ps1 -BuildCandidate -Live -Years 2024,2027` (HEAD in a temp worktree; installs the candidate
per user; `run-live.ps1` starts its OWN Revit per year — the user's Revit/models are never touched).  The user worked on this PC during the
runs; the driver waits for idle input, keeps focus off the test Revit and records human input as `environment.interference` (BLOCKED).

### Run 1 — candidate `1.46.0-94f34c53` (bundle sha256 `1226de55…`; DLL 2024 `e4b45537…`, 2027 `63e4029e…`) → FINAL: FAIL
Build/AddinInspect 2024+2027 PASS · unit net10/net48 346/346 · UI smoke ×2 PASS.
- **2024** (`WeGate\2024\20261016-155209`, Revit 2024.1): aborted at SEL-HOST-EMPTY-101 → no live report («NOT RUN»).  Before that:
  CROP-STORED-105, PRESET-INT-B102 and all 8 W08 `surf.*` checks PASS; FAIL = GEN-HIDE-102, GEN-LINK-103 (viewport overlap),
  PRESET-KEEP-B102 (key plan sketch 12→13), SURF-LINK-201A (`host.furnishings_visible`).
- **2027** (`WeGate\2027\20261016-160859`, Revit 2027.2 build 27.2.0.39): PASS 28, FAIL 9.  W01 REPLAN-HOST-102: `replan.detected`,
  `replan.replanned` («#17 дахин төлөвлөв (хана өөрчлөгдсөн) 14 мс»), `replan.one_sheet` PASS; W06 FOCUS-HOST-103: `focus.active_view_kept`,
  `focus.no_results_window`, `focus.logged` PASS; W07 CROP-STORED-105 PASS (0…1500 mm applied, others unchanged, state kept); W08 all 8
  `surf.*` PASS (two ceiling spots 2345 mm apart, sloped spot exactly on the face 5740.851 mm, step spot, main floor spot, sloped ceiling not
  dimensioned, flat dimensioned, all spot references); W09 PRESET-INT-B102 PASS (Interior ribbon command, preset stored on all views).

Root causes of every non-PASS (none was relabelled; each has a fix + a regression test or a gate check):

| Scenario(s) | Cause | Fix |
|---|---|---|
| GEN-HIDE-102, GEN-LINK-103, REPLAN-HOST-102, FOCUS-HOST-103 (`sheets.layout`, both years) | **Product (W02)**: 5th/6th elevation went straight to the offset stack over A although the A1 sheet had free space | `7662fb81`: region row → free sheet space → stack; test replays the exact live compositions; mutations 4/4 |
| PRESET-KEEP-B102 (`rerun.own_annotations_stable`, both years) | **Product**: key plan fill cut labels then markers (2 Boolean steps) on the first run, both at once on a rerun → boundary segments 12↔13 | `7662fb81`: refill rebuilt from the original room loops, one deterministic box order (`WeFillHoles`), skipped when unchanged; mutations 4/4 |
| SEL-HOST-EMPTY-101 (2024 hang → run aborted) | **Product (W06)**: the result browser's absolute saved position (taken while Revit was restored) sat in the middle of the maximised drawing area and swallowed the click; then the run-live ESC opened the picker's «Бусад сонголт» dialog nobody answered | `7662fb81`: position relative to the Revit window (`WeFloatPlacement`); `a4b8a753`: driver refuses/handles a covering Revit window, dismisses dialogs opened by the ESC |
| SURF-LINK-201A (`host.furnishings_visible`, both years) | **Gate**: `InRoom` tested XY only — furniture of room 101 (L1) under 201A (L2) counted as "in the room" | `a4b8a753`: room height range |
| SEL-TAG-102 (2027) | **Environment**: a human click 1.5 s before the driver's (pick at (20139, 7146) mm, target (13000, 5500)) — not detected because only keys counted | `a4b8a753`: Jrn.L/R/MButtonDown + Jrn.Wheel (selection) → BLOCKED |
| GEN-EXTRA-101 → RERUN-EXTRA-101 (2027) | **Environment (Revit)**: journal «API queue command … MglWallElevations cannot be invoked in this context» — the posted command was dropped | `a4b8a753`: gate detects the rejection in the journal and re-posts (≤ 3) |

Also BLOCKED once (2027 GEN-HIDE-102): `VK_RIGHT` typed by the user into the test Revit.

### Run 2 — candidate `1.46.0-a4b8a753` (bundle sha256 `57a10159…475b`; DLL 2024 `65333dc5…`, 2027 `6b947d2e…`) → FINAL: FAIL
Build/AddinInspect ×2 PASS · unit net10/net48 353/353 · UI smoke ×2 PASS.
- **2027** (`WeGate\2027\20261016-164703`): **PASS 36, FAIL 1**.  W02 fix confirmed live (GEN-HIDE-102, GEN-LINK-103, REPLAN-HOST-102,
  FOCUS-HOST-103 `sheets.layout` PASS); every selection/editability scenario PASS; SURF-LINK-201A PASS with the 3D `InRoom`; W01/W06/W07/W08/W09
  checks PASS.  FAIL = PRESET-KEEP-B102 (sketch 12→13 again — see below).
- **2024** (`WeGate\2024\20261016-163405`): PASS 26, **BLOCKED 9**, FAIL 2.  The BLOCKED were caused by the gate itself: the new human-click
  detection used the journal READ time (the stamp regex never matched lines starting with two spaces; Revit flushes the journal 4–38 s late),
  so the driver's own clicks looked human (SEL-ANNO-ELEV-101 was a real user window in front of the test Revit).  FAIL = PRESET-KEEP-B102 and
  FOCUS-HOST-103 (the check found NEG-TEMPLATE-107's result window still open; the product had logged «фокус булаахгүй» and opened nothing).

| Finding | Cause | Fix |
|---|---|---|
| PRESET-KEEP-B102 still 12→13 (both years) | **Product**: both runs now cut in one step, but the box SIZES differ — Revit's elevation marker grows once its views are placed on a sheet, and text marks become two-line in References; the first run refilled in the Markers phase (small marker) | `eaf93269`: fill re-checked after Sheets + References for every key plan drawn in the run (signature-based, no-op when unchanged) |
| 2024 false BLOCKED ×8 | **Gate**: journal timestamps not parsed | `a11e38cc`: stamps parsed and kept across reads; click = ours only −150…+1000 ms after our injection; wheel never ours |
| FOCUS-HOST-103 (2024) | **Gate**: stale window from an earlier scenario | `a11e38cc`: close stale result window in setup + require no «самбар нээгдэв» in the log |
| (observation) gate leaves window positions in the user's `ui-prefs.json` | **Gate** | `beb552fb`: run-live backs up / restores it around each test Revit |

Also added after run 2: `36c8e5f4` FEEDBACK-OPEN-101 (live evidence for F01/F02 — the Revit feedback form opens from the ribbon, diagnostics
carry `mgl-diag/1` + the Revit year + the SHA-256 of the DLL Revit loaded; the user's outbox is unchanged; Send is never pressed).
PostCommand re-post (`a4b8a753`): implemented, the journal showed no rejection in run 2, so it was not exercised live.

### Run 3 — candidate `1.46.0-36c8e5f4` (all fixes + FEEDBACK-OPEN-101)
Started 16:56 in the background; handed off before it finished at the user's request ("finish now").  Its result is in
`%LOCALAPPDATA%\MGL\WeGate\{2024,2027}\20261016-1656*` and `revit-mcp\dist\gate\1.46.0-36c8e5f4\gate\gate-report.md` — NOT part of this
handoff's evidence.  The fixes made after run 2 (`eaf93269` key plan settle, `a11e38cc`, `beb552fb`, `36c8e5f4`) are therefore
CODE COMPLETE + unit/build verified, live verification = run 3.

## Requirement matrix

| ID | Requirement (short) | Implementation location | Verification | Status |
|---|---|---|---|---|
| A01 | Reviewer = authenticated active user + tenant | backend `lib/engineeringFeedbackAccess.ts` | route tests (Hono + node:sqlite) | CODE COMPLETE · LIVE VERIFIED (local wrangler + browser) |
| A02 | Server-managed Software Engineer capability (no users rebuild) | migration + `access_capabilities` table | route tests | CODE COMPLETE · LIVE VERIFIED (local) |
| A03 | Explicit verified reviewer binding (no fuzzy/first row) | `engineering_feedback_reviewer_binding` (0410) + guarded bootstrap 0414 | tests + identity evidence | CODE COMPLETE · LIVE VERIFIED (local; prod NOT applied) |
| A04 | No admin bypass; DB-backed (no stale JWT role/position) | access lib | tests (admin/senior/engineer/architect denied) | CODE COMPLETE · LIVE VERIFIED (local: admin id 1 → 404 + no row) |
| A05 | Same capability source for UI + API (sidebar, route, mobile, search, counts, notifications, attachments) | frontend capability hook + backend | tests + browser E2E | CODE COMPLETE · LIVE VERIFIED (browser E2E) |
| A06 | Reviewer cannot change own capability/binding via body | no such route; bootstrap is CLI/SQL | test | CODE COMPLETE |
| A07 | Submitters = active internal admin/engineer/architect/senior; worker/client closed | access lib + scope allowlists unchanged | tests | CODE COMPLETE |
| F01 | Revit «Санал хүсэлт» modeless form (+ WE contextual entry), works with no model | add-in `Feedback/` | build R24–R27 + MglUi tests; live | CODE COMPLETE · live NOT RUN |
| F02 | Versioned diagnostics (year+build, DLL path/version/hash, package/commit, runtime/OS/DPI, stage, exception, view…) | add-in `Feedback/Core/FeedbackDiagnostics.cs`, `FeedbackDiagnosticsCollector.cs`, crash store | Feedback.Tests | CODE COMPLETE · live NOT RUN |
| F03 | Offline outbox per host+tenant+account, cross-process safe, idempotent, retry/backoff, states | add-in `Feedback/Core/FeedbackOutbox.cs`, `FeedbackSender.cs` | Feedback.Tests 28/28 (2nd-process lease probe, fake server) | CODE COMPLETE · live NOT RUN |
| F04 | Private R2 `FEEDBACK_BUCKET` + D1 staged draft/attachment/finalize; no /media; limits; cleanup | backend routes + migration + wrangler | route tests w/ R2 fake | CODE COMPLETE · LIVE VERIFIED (local miniflare R2; real bucket NOT created) |
| F05 | ERP inbox page «Програмын хүсэлтүүд» + triage/history/retest + ERP submission | frontend `features/engineering-feedback/` | verify + browser E2E | CODE COMPLETE · LIVE VERIFIED (browser E2E 31/31, local) |
| W01 | Useful background generation, source-change handling | `WeJob` (replan, slow-step log), `Core/WeSourceWatch`, `WallElevationWorkflow` (no silent sync fallback), pending signature (`WeIdentity.Pending`) | unit (SourceWatchTests) + live REPLAN-HOST-102 | CODE COMPLETE · live: Phase E |
| W02 | All elevations on one sheet, 4 regions, offset stacks, no continuation, rerun preserves manual moves | `Core/WeSingleSheet`, `WeSheetService` | unit (SingleSheetTests) + live GEN-*/RERUN-* | CODE COMPLETE · live: Phase E |
| W03 | Independent visible scales honored end-to-end | `Core/WeViewState` scale rule, dialog, services | unit (ViewStateTests) + live views.scale | CODE COMPLETE · live: Phase E |
| W04 | Valid marker centre for every marker (L/U/holes/rotated/narrow) | `Core/WeMarkers` | unit (MarkerCentreTests) + live GEN-LINK-102/103/104 | CODE COMPLETE · live: Phase E |
| W05 | Sheet/label numbering ranges, preview, conflicts | `Core/WeNumbering`, dialog | unit (NumberingTests) + UiSmoke | CODE COMPLETE · live: existing scenarios only |
| W06 | Result browser Room → Elevation → current Sheet; no focus steal | `Ui/WeResultView`, `Revit/WeResultBrowser`, `WeResultReader`, `WeJob.Finished` | unit (ResultIndexTests) + UiSmoke + live GEN-HIDE-102, FOCUS-HOST-103 | CODE COMPLETE · live: Phase E (Project Browser locate itself not automatable: driver cannot reach the modeless WPF window via UIA) |
| W07 | Key plan refs + per-elevation vertical crop (new ES schema) | `Core/WeVerticalCrop`, `Core/WeKeyPlanRef`, `Revit/WeViewStateStore` (GUID c4a7e2d9…) | unit (VerticalCropTests, KeyPlanRefTests) + UiSmoke + live CROP-STORED-105 | CODE COMPLETE · live: Phase E |
| W08 | Floor/ceiling steps, multiple heights, slopes from real faces; bathroom preset pending sample | `Core/WeSurfaceProfile`, `WeSlabPlane`, `WeAnnoSourceReader.PlanFaces`, `WeAnnotator.HostFace` | unit (SurfaceProfileTests) + live SURF-LINK-201A | CODE COMPLETE (foundations) · live: Phase E · bathroom conventions DEFERRED (sample) |
| W09 | Unified presets + English category labels | `Core/WePreset`, `WeSettings`, planner, dialog | unit (PresetTests) + UiSmoke + live PRESET-INT/KEEP-B102 | CODE COMPLETE · live: Phase E |
| W10 | Assistant hidden by default; curved walls honest unsupported | `AssistantPaneProvider`, `HealthReporter`, `App.cs`; `WallElevationPlanner.ChordViewNote` | build R24–R27 + ForceTests | CODE COMPLETE · live NOT RUN (curved wall not in the synthetic model) |
| V01 | Establish failing env (builds, DLL hashes, manifests) | this file | evidence (journals, installed DLLs) | DONE locally; the user's 2027 failure NOT reproduced here (F02 diagnostics will carry it) |
| V02 | Version-specific API behaviour; pin API packages | csproj + adapters | min-package builds + AddinInspect 9/9 ×2 | CODE COMPLETE (pin) · in-Revit behaviour differences NOT RUN |
| V03 | Installer same-version/different-payload; candidate scope | `installer/install.ps1`, `build-candidate.ps1` | test-bundle 66/66 (old installer fails H) | CODE COMPLETE |
| V04 | Release gate evidence bound to year/build/hash/candidate | `release-gate/wall-elevation/gate{,-lib,-selftest}.ps1`, `required-scenarios.json` | self-test 44/44, mutation 12/12, real-data run | CODE COMPLETE |

## Next concrete actions
1. Human real-project validation per Revit year (gate stage 6 — only a person can sign `real-project-validation.json`).
2. Deployment needs explicit authorization: R2 bucket → D1 0410–0414 → worker → Pages; add-in zip 1.46.0 distribution.
3. Owner decisions: curved-wall representation; bathroom sample (conventions, view count, annotation rules).
