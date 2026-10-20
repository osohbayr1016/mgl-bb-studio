# MGL Revit add-in — UI/UX redesign: plan and handoff

> **This file is the durable handoff.** If a session ends, the next one continues from §0 — it must not restart research.
> Update §3 (phases), §8 (changed files), §9 (checks) after every phase.
> Raw investigator evidence (file:line quotes, truth tables, verbatim strings) lives in
> [`MGL_UI_UX_REDESIGN_EVIDENCE.md`](MGL_UI_UX_REDESIGN_EVIDENCE.md). Executable code is authoritative; line numbers there are at the baseline commit and drift.

## 0. Next exact action

**All six phases are done in code** (2026-10-03) and committed on a feature branch. What is left is **manual QA on a Windows PC with real Revit** — §11 is the checklist, in priority order: (1) ribbon width/collapse on R24 and R27 at 100–200 % DPI; (2) `%APPDATA%\RevitMcpAddin\ribbon-ids.log` after the first catalog «Нээх»; (3) Light/Dark theme switch with each pane/dialog open; (4) the three `*.UiSmoke` runs for PNGs (`SMOKE_OUT=<dir> dotnet run` in `revit-mcp/tests/{SheetNumerator,Smart,CloneDrawings}.UiSmoke`). No further code phase is planned; owner decisions are in §12.

## 1. Scope, baseline, rules

- **Scope:** `revit-mcp/addin/`, directly related `revit-mcp/tests/`, and add-in docs/build resources only. Not the ERP site, backend, AI training, business rules, licensing policy or model-generation algorithms.
- **Baseline:** `main` @ `07934ebb` (add-in **1.13.0**), clean tree. The audit that produced the 12 findings was static; **nothing in this redesign has been observed in a live Revit**.
- **Build matrix (must be preserved):** R24 = Revit 2024 / net48 (FamilyHub, Intelligence, WorkTracking, WorkPane, Smart, SmartPublish, SmartCount, ClashCheck, ChangeImpact and the MCP executor are *excluded* via `<Compile Remove>` + `#if MGL_*`); R25/R26 = net8.0-windows; R27 = net10.0-windows. New shared UI code compiles in all four, so no net8-only APIs and no references to excluded classes.
- **Never touched:** `PushButtonData.Name` values, external-command class names, AddInId, pane GUIDs, serialized settings keys, licence/device/token logic, `Application.Current` / `Application.Resources`, `MGL_RIBBON_TAB`.
- **Not done by this work:** no install into a live Revit Addins folder (`-p:DeployToRevit=false` always), no push, no publish, no commit unless asked.
- Mongolian is the default visible language. Machine identifiers (enums, parameter names, payload keys, provider names, naming-template tokens, user-entered names) are never translated. `Lang.cs` bilingual assistant-response detection is **not** replaced by a UI-language setting.

## 2. Verification tooling (this Mac, 2026-10-03)

The add-in *can* be compiled here with a user-local .NET 10 SDK (`dotnet-install.sh`, installed in the session scratchpad — **not** in the repo) and `-p:EnableWindowsTargeting=true`; the Revit API comes from NuGet, so no Revit install is needed. Pure `net10.0` test runners run natively. See the memory note `revit-addin-builds-on-mac`.

| Check | How | Baseline @ 07934ebb |
|---|---|---|
| Compile R24/R25/R26/R27 | `dotnet build revit-mcp/addin/RevitMcpAddin.csproj -c "Release R2x" -p:Platform=x64 -p:DeployToRevit=false -p:EnableWindowsTargeting=true` (+ out-of-tree `BaseIntermediateOutputPath`/`OutDir`) | **0 errors, 26 warnings each** (all CS0649 in `Nudges.cs`) |
| Pure tests | `dotnet run -c Release` in each `revit-mcp/tests/*.Tests` | AutoAnnotate 17/17 · CloneDrawings 62/62 · Intelligence 80/80 · SheetNumerator 174/174 · WorkPane 17/17 · WorkTracking 36/36 pass. **FamilyHub 51/52, Licensing 34/35, Reinforcement 246/247, Smart 349/376 fail only on Windows-only assumptions** (`D:\Out` paths, display-adapter probe, `a:b.rfa` file name, cwd-relative source scan). Any *new* failure is mine. |
| `*.UiSmoke`, `*.LiveHarness` (net10.0-windows WPF) | can be *compiled* on the Mac, **cannot be run** | **NOT RUN here.** Reproduce on a Windows PC with `dotnet run` (UiSmoke honours `SMOKE_OUT` for PNGs). |
| Native Revit behaviour (ribbon collapse/width, theme switch, DPI, QAT/shortcut ids, PostCommand) | live Revit only | **NOT VERIFIED.** Manual QA list in §11. |

## 3. Phase status

| Phase | Status | Notes |
|---|---|---|
| 0 — Inspect, verify, inventory, plan | **DONE** (6 of 9 read-only investigators finished; the remaining three — Smart/export engines, infra/API probe, docs/text systems — were stopped on request and are being covered in-line in the phase that needs them) | this file + evidence file |
| 1 — Shared UI layer, theme/version adapters, accessibility, window placement, text strategy, tool metadata | **DONE** (2026-10-03) | `Ui/Core` pure layer + `tests/MglUi.Tests`; WPF theme/styles/placement/prefs/automation; proven on `QtoProgressWindow` + `SchedulePickerDialog`; R24–R27 build green, 0 new warnings |
| 2 — Ribbon regroup, names, tooltips, icons, catalog/search, launching | **DONE in code; live Revit NOT verified** | `RibbonPlan` + `RibbonBuilder`, 24-tool metadata (1 source for ribbon + catalog), `ToolIcons`, `ToolCatalogCommand` («Хэрэгсэл хайх»), `PostCommand` launcher with `LookupCommandId` verification, 3 view-aware availability classes; old `SmartRibbon.cs`/`RfRibbon.cs` deleted |
| 3 — Account/settings, WorkPane/Assistant/Intelligence, dev-mode, first-use | **DONE in code; live Revit/visual NOT verified** (2026-10-03) | `SettingsDialog` async + `RequestGuard`, `LicenseDialog` + token state, `AssistantPane`/`WorkPane`/`IntelligencePanel`/`CdJobPaneView` on shared tokens (no local palettes — guarded by `SourceConsistencyTests`), `MGL_DEV_MODE` DEV tab, tokens set even when `MglControls.xaml` fails to load |
| 4 — Binding, sheet creation/numbering, CopyToOther, CloneDrawings, AutoAnnotate, reinforcement, schedules | **DONE in code; live Revit/visual NOT verified** (2026-10-03) | `BindingDialog` («Холбоос хадгалах», counts, search/filter, dirty-close guard) + `BindingView`; `BatchSheetDialog` + `BatchSheetRules` (inline errors, whole-run duplicate count, blocked-reason); `SheetNumeratorWindow` (tokens, automation names, work-area clamp); `CopyToOther`, `CloneDrawings` («Зураг хувилах»), `AutoAnnotate`, End-symbol/Section/Schedule dialogs via `RfUi` live brushes + `MglWindow`; Partition terminology |
| 5 — Count, clash, impact, exports, FamilyHub, remaining dialogs | **DONE in code; live Revit/visual NOT verified** (2026-10-03) | Smart windows (`UiKit.Prepare` → theme + work-area fit; live brushes), «Элемент тоолох»/«Давхцал шалгах»/«Файл гаргах»/«Гаргахын өмнөх шалгалт», `MglBusy` modal wait for ERP exports + binding handshake, FamilyHub: the English action/status labels localised (supplier, family and type names and the site's own «Download» button kept), duplicate prompt dialogs → `MglPrompt` |
| 6 — Regression checks, 4-config builds, final copy review, handoff | **DONE** (2026-10-03) | 4 configs 0 errors / 26 baseline warnings; all pure suites ≥ baseline; naming note added to 6 add-in docs + `docs/dev/08-qto-revit.md`; this file |

## 4. Audit findings — verified against the code

All 12 findings are **CONFIRMED** against `07934ebb` (static). Corrections to the audit wording are in the right column — use these, not the original text.

| # | Verdict | What the code says today / correction |
|---|---|---|
| F1 | CONFIRMED | 23 buttons / 7 panels is the **R25–R27** figure; **R24 has 17 buttons / 6 panels** (no `MglWorkPane`, `MglFamilyHub`, no Smart panel). Every button is a single `panel.AddItem(PushButtonData)` — no stacked items, pulldowns, `ToolTipImage` or contextual help anywhere. The App.cs «one large panel collapsed into one icon» lesson (App.cs:572-599, journal.0064) is preserved in §7. Crowding itself is **unverified**. |
| F2 | CONFIRMED | Names exist exactly as quoted. Nuance: the «Автомат хэмжээс» tooltip already says «хэмжээс, tag-ийг»; only the visible name hides it. Short verb-free labels were a deliberate 2026-08-26 width decision, so renaming trades against panel width (§7.4). |
| F3 | CONFIRMED | `SmartPublish`/`SmartCount` make **no network call** (grep). The «Сайт руу илгээх» panel title already names the ERP destination; the gap is the Smart side and the bare label «PDF». |
| F4 | CONFIRMED (3/3) | (a) App.cs:749 «эргүүлэх, толин тусгал одоохондоо байхгүй» is false since the introducing commit `0457c275` — dialog offers «Шилжүүлэх» / «Эргүүлж байрлуулах» / «Толин тусгал». (b) RfRibbon.cs:42/47 state «Esc = загварт юу ч өөрчлөхгүй» and «бүгдийг нэг Ctrl+Z» unconditionally; true only for dialog-cancel / Esc before first click / **preselected** path. In the no-preselection **pick loop each click is its own TransactionGroup**, Esc keeps everything already placed, Ctrl+Z undoes one click. (c) RfRibbon.cs:65-67 «үл үзэгдэх лавлагаа шугамд … холбоно» is false: `RfSectionRenderer.cs:268` uses **real references only** and skips a side lacking one. Corrections: the tooltip does not mention a "loop" at all; the section tooltip also omits the 1.13.0 «Загвар харагдацаас хуулах» mode. Further stale items: ScheduleExport «Сонголт нь загварт хадгалагдана» (it is `settings.json`, per Windows user, not the model); Settings tooltip «Токен … шифрлэгдэж хадгалагдана» (device session now; token not written to disk). |
| F5 | CONFIRMED | The dark palette is duplicated **byte-for-byte** (AssistantPane = WorkPane; Intelligence is an `I`-prefixed copy of 8 tokens) and a **fourth** copy exists in code (`CdJobPaneView`, accent orange `#E0833A`). 77 static brushes; 0 `DynamicResource`, 0 `ResourceDictionary` files, 0 `pack://`, **0 theme detection**. 8 distinct "error" reds, 9+ "warning" ambers, 7 greens. |
| F6 | CONFIRMED | SheetNumerator 960×620 min, ChangeImpact 1000×620, SmartCount `Width = 560` (a fixed width, not a minimum; its Run/Stop buttons sit **inside** the scroller). `RfUi.Setup` clamps to **primary** `SystemParameters.WorkArea` only, never `Left/Top`, and `App.ShowOwned` then re-centres on the owner. 0 uses of `GetDpi`/`DpiChanged`. Action buttons inside scrolling content: EndSymbol, SmartCount, ChangeImpact (+ Clash detail clipping). |
| F7 | CONFIRMED | `SettingsDialog.xaml.cs:119-130` and `:157-158` — `Task.Run(...).GetAwaiter().GetResult()` on the dialog thread (≈480 s worst case by constants, no cancel). The reload-on-open is already async. Status is «Токен хадгалагдсан (нэвтэрсэн: …)». Also: a late 401 can null a newer `_token`; the password box is never cleared; sign-in state comes from `settings.Token`, not `LicenseGate.Snapshot()`. `LicenseDialog` is already correctly awaited with `_cts`/`_busy`/`IsLoaded` guards — the model to copy. |
| F8 | CONFIRMED | Icon-only: ▾ (`ChecklistToggle`), Δ (`ChangesToggle`), AI (`IntelToggle`); ⟳ is 14 DIP. Only **one** real `Expander`; the rest are toggle-driven hosts. 24 sub-12 font sites in AssistantPane alone. Three different things are called "AI" (toggle, inner tab, chat agent); four different "refresh" buttons. 🎤 is inert (placeholder). |
| F9 | CONFIRMED | `DEV` is the **2nd** tab, no `x:Name`/`Visibility`; the panel is created unconditionally on first «AI» toggle. Guards (`TestModelFixture.Gate`, `IsTestMarked`, `TEST_*_REFUSED`) are in the tools and must stay — the tools are also reachable through the localhost bridge. Recommended gate: env var `MGL_DEV_MODE == "1"` (precedent `BridgeAuth.ArbitraryCodeAllowed` ← `MGL_ALLOW_EXEC`). `#if DEBUG` is **never defined** here, so it cannot be used. |
| F10 | CONFIRMED | «Цэвэрлэх» only un-ticks rows (SchedulePicker: **all** rows incl. filtered-out ones). «Бүгдийг батлах» sends ticked rows with a task as `confirmed` and **every other row as `ignored`** (server then stores confidence 1.0 / `manual`); disabled when nothing is ticked. |
| F11 | CONFIRMED | Window title, search hint, PLACE, conflict panel/buttons, «Family loaded», ADD TO REVIT, AUTH REQUIRED, METADATA…, status prefixes and pipeline messages with enum/exception names are English. Supplier/family/type names are data and stay. |
| F12 | CONFIRMED | Good patterns are real (SheetNumerator 41 AutomationIds + 6 KeyBindings; Assistant real Buttons + `e.Handled`). Gaps are systemic: **0 `FocusVisualStyle`/focus triggers anywhere**, 10 custom `ControlTemplate`s with no keyboard-focus trigger, `AutomationProperties.Name` almost absent (even SheetNumerator's ▲▼⤒⤓ lack names and its `FieldLabel`s are not `LabeledBy`). |

## 5. Tool inventory, naming map and ribbon decisions

### 5.1 Today (baseline) — every ribbon button

| # | Panel | PushButtonData.Name (stable id) | Visible Text | Command class | Availability | Icon · colour | Compile condition | R24 | R25–R27 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Ажлын явц | `MglWorkPane` (App.cs:608) | `MGL\nажил` | `WorkPane.WorkPaneCommand` | `WorkPane.WorkPaneAvailability` (always true) | inline Glyph(E823,E121) · Work #3FB984 | `#if MGL_WORK_TRACKING` (App.cs:604) | – | ✔ |
| 2 | Ажлын явц | `MglAssistantPane` (:624) | `MGL\nтуслах` | `AssistantPaneCommand` | ProgCA | `GlyphIcons.Assistant` (E99A,E90A) · #D4A853 | none | ✔ | ✔ |
| 3 | Ажлын явц | `MglRevitBinding` (:641) | `Зураг\nхолбох` | `BindingCommand` | ProgCA | `GlyphIcons.Link` (E71B) · #1F9AA8 | none | ✔ | ✔ |
| 4 | Сайт руу илгээх | `MglQtoExport` (:661) | `Тоо\nхэмжээ` | `QtoExportCommand` | QtoCA | `GlyphIcons.Quantity` (E8EF,E9F9,E80A) · #4A7FA5 | none | ✔ | ✔ |
| 5 | Сайт руу илгээх | `MglPdfExport` (:674) | `PDF` | `PdfViewExportCommand` | PdfVA | `GlyphIcons.Pdf` (EA90,E8A5,E749) · #B87333 | none | ✔ | ✔ |
| 6 | Сайт руу илгээх | `MglScheduleExport` (:690) | `Хүснэгт` | `ScheduleExportCommand` | QtoCA | `GlyphIcons.Table` (E80A,EA98,E8A5) · #2E9E6B | none | ✔ | ✔ |
| 7 | Загвар | `MglBatchSheets` (:706) | `Хуудас\nүүсгэх` | `BatchSheetCommand` | QtoCA | `GlyphIcons.Sheets` (E7C4,E8A5,E7C3) · #7C6BC4 | none | ✔ | ✔ |
| 8 | Загвар | `MglSheetNumerator` (:720) | `Хуудас\nдугаарлах` | `SheetNumerator.SheetNumeratorCommand` | QtoCA | `GlyphIcons.SheetNumerator` (E8CB,E8FD) · #8BAE3E | none | ✔ | ✔ |
| 9 | Загвар | `MglCopyToOther` (:738) | `Хуулж\nтавих` | `CopyToOtherCommand` | QtoCA | `GlyphIcons.CopyTo` (E8C8,E16F) · #C75B7A | none | ✔ | ✔ |
| 10 | Загвар | `MglCloneDrawings` (:757) | `Зураг\nклонлох` | `CloneDrawings.CloneDrawingsCommand` | QtoCA | `GlyphIcons.CloneDrawings` (E8B9,F5ED,E8C8) · #E0833A | none | ✔ | ✔ |
| 11 | Загвар | `MglAutoAnnotate` (:778) | `Автомат\nхэмжээс` | `AutoAnnotate.AutoAnnotateCommand` | AaAv | `GlyphIcons.AutoAnnotate` (EB3C,ED5E) · #3B8FD9 | none | ✔ | ✔ |
| 12 | Загвар | `MglFamilyHub` (:799) | `Family\nHub` | `FamilyHub.Revit.FamilyHubCommand` | QtoCA | inline Glyph(E896,E8B7,E7C3) · **IconColors.Link #1F9AA8 (same colour as #3)** | `#if MGL_FAMILYHUB` (App.cs:795) | – | ✔ |
| 13 | Smart | `MglSmartImpact` (SmartRibbon.cs:45) | `Өөрчлөлтийн\nнөлөө` | `ChangeImpact.ChangeImpactCommand` | QtoCA | inline Glyph(E81C,E9F5) · #8E6FD8 | `#if MGL_SMART` (App.cs:814) | – | ✔ |
| 14 | Smart | `MglSmartCount` (:83) | `Smart\nCount` | `SmartCount.SmartCountCommand` | QtoCA | inline Glyph(E9D9,E8EF) · #D49A2A | same | – | ✔ |
| 15 | Smart | `MglSmartClash` (:64) | `Clash\nшалгах` | `ClashCheck.ClashCheckCommand` | QtoCA | inline Glyph(E7BA,E783) · #D9534F | same | – | ✔ |
| 16 | Smart | `MglSmartPublish` (:101) | `Smart\nPublish` | `SmartPublish.SmartPublishCommand` | QtoCA | inline Glyph(E898,E749) · #1F9A7A | same | – | ✔ |
| 17 | Арматур | `MglRebarEndSymbol` (RfRibbon.cs:35) | `Арматурын\nтөгсгөлийн тэмдэг` | `Reinforcement.RebarEndSymbolCommand` | RfVA | inline Glyph(E7C8,E81D,E7C1) · #C0504D | none | ✔ | ✔ |
| 18 | Арматур | `MglRebarSectionAnnotation` (:54) | `Огтлолын арматурын\nтэмдэглэгээ` | `Reinforcement.SectionAnnotationCommand` | RfVA | inline Glyph(E8EC,ED5E) · #D08A2E | none | ✔ | ✔ |
| 19 | Арматур | `MglRebarRefresh` (:76) | `Тэмдэглэгээ\nшинэчлэх` | `Reinforcement.RefreshAnnotationsCommand` | RfVA | inline Glyph(E72C,E895) · #4F9D69 | none | ✔ | ✔ |
| 20 | Түүвэр | `MglScheduleClone` (:93) | `Түүвэр\nхувилах` | `Reinforcement.ScheduleCloneCommand` | QtoCA | inline Glyph(E16F,E8C8) · #5B7DB1 | none | ✔ | ✔ |
| 21 | Түүвэр | `MglScheduleSync` (:110) | `Түүвэр\nсинк хийх` | `Reinforcement.ScheduleSyncCommand` | QtoCA | inline Glyph(E8AB,E895) · **#7C6BC4 (identical to `Sheets`, #7)** | none | ✔ | ✔ |
| 22 | Тохиргоо | `MglLicense` (App.cs:830) | `MGL\nнэвтрэлт` | `Licensing.LicenseCommand` | `Licensing.LicenseAvailability` (always true) | `GlyphIcons.Account` (E72E,E77B) · #C9A227 | none | ✔ | ✔ |
| 23 | Тохиргоо | `MglQtoSettings` (:846) | `Тохиргоо` | `QtoSettingsCommand` | **none** (App.cs:855 passes `null`) | `GlyphIcons.Settings` (E713,E9F5) · #8B94A0 | none | ✔ | ✔ |

All 23 are `IExternalCommand` classes with exactly one button each; none is off the ribbon. Three non-ribbon surfaces: dockable panes «MGL туслах» (`6f1a2c74-…`), «MGL ажил» (`b6c1a3e2-…`), «MGL — Зураг клонлох» (`3f3d4d16-…`, opened by Clone Drawings only). Seven availability classes exist; `QtoCommandAvailability`/`ProgressCommandAvailability` are the same predicate (project document, not a family) and enable **13** buttons whose commands then refuse inside `Execute` (CopyToOther needs a `ViewPlan`; CloneDrawings plan/section/3D; SectionAnnotation refuses Elevation although `RfViewAvailability` allows it). `MglQtoSettings` has no availability class (always enabled). Every command calls `LicenseGate.Ensure()` (the ribbon button is never disabled by licence).

### 5.2 Approved naming map (stable ids never change)

| Stable command name | Short ribbon label | Full user-facing name / purpose |
|---|---|---|
| (new) `MglToolCatalog` | Хэрэгсэл хайх | Хэрэгсэл хайх — MGL хэрэгслийн жагсаалт, заавар |
| MglWorkPane | Миний ажил | Миний ажил — таск, идэвхтэй цаг, тайлан |
| MglAssistantPane | AI туслах | AI туслах — асуух, өөрчлөлт харах, тайлангийн ноорог бэлтгэх |
| MglRevitBinding | Ажилтай холбох | Revit-ийн хуудсыг ERP-ийн ажилтай холбох |
| MglQtoExport | Тоо хэмжээ илгээх | Загварын тоо хэмжээг ERP-д илгээх |
| MglPdfExport | PDF илгээх | Идэвхтэй харагдацын PDF-ийг ERP-д илгээх |
| MglScheduleExport | Түүвэр илгээх | Revit-ийн түүврийн хүснэгтийг ERP-д илгээх |
| MglBatchSheets | Хуудас үүсгэх | Олон зургийн хуудас үүсгэх |
| MglSheetNumerator | Хуудас дугаарлах | Зургийн хуудсыг эрэмбэлж, дугаарлах |
| MglCopyToOther | Элемент хуулах | Элемент болон тэмдэглэгээг өөр хэсэгт хуулах |
| MglCloneDrawings | Зураг хувилах | Ижил элементийн ажлын зургийг хувилах |
| MglAutoAnnotate | Хэмжээс, тэмдэглэгээ | Хэмжээс, тэмдэглэгээ автоматаар тавих |
| MglFamilyHub | Family сан | Family хайх, төсөлд ачаалах, байрлуулах |
| MglSmartCount | Элемент тоолох | Элементийг шүүж, тоолж, загварт харуулах |
| MglSmartClash | Давхцал шалгах | Элементүүдийн геометрийн давхцал шалгах |
| MglSmartImpact | Өөрчлөлтийн нөлөө | Өөрчлөлтөд өртсөн элемент, харагдац, хуудсыг шинжлэх |
| MglSmartPublish | Файл гаргах | PDF, DWG, IFC файлыг хавтсанд гаргах |
| MglRebarEndSymbol | Төгсгөлийн тэмдэг | Арматурын төгсгөлийн тэмдэг тавих |
| MglRebarSectionAnnotation | Огтлолын тэмдэглэгээ | Огтлолын арматурын хэмжээс, тэмдэглэгээ тавих |
| MglRebarRefresh | Тэмдэглэгээ шинэчлэх | MGL-ийн арматурын тэмдэглэгээг шинэчлэх |
| MglScheduleClone | Түүвэр хувилах | Арматурын түүврийг бүлэг бүрээр хувилах |
| MglScheduleSync | Түүвэр шинэчлэх | Арматурын түүврийн зөрүүг шалгаж, засах |
| MglLicense | Бүртгэл, эрх | Компанийн бүртгэл, компьютерын ашиглах эрх |
| MglQtoSettings | Тохиргоо | ERP төсөл, холболт, харагдах байдлын тохиргоо |

Terminology rules: «Цэвэрлэх» → «Сонголт цуцлах» when it only deselects; Binding «Бүгдийг батлах» → «Холбоос хадгалах» (+ confirmed/ignored counts); «Preflight» → «Гаргахын өмнөх шалгалт»; «PLACE» → «Байрлуулах»; «Use existing» → «Байгаа Family-г ашиглах»; Partition = «Арматурын бүлэг (Partition)» (**not** a Workset); «Тэмдэглэгээ (Tag)» in intro help then clear Mongolian; Revit parameter names (Mark, Comments) stay identifiable.

### 5.3 Ribbon decisions

Panels (names are ids too — see risk below): **Ажил · Зураг · Арматур · Түүвэр · Шалгалт · Экспорт · Сан ба тохиргоо**, built from one data plan (`RibbonPlan`), so R24 gets only panels that have buttons (no empty «Шалгалт»).

| Panel | Large | Stacked | Notes |
|---|---|---|---|
| Ажил | Миний ажил (R25+), AI туслах | Хэрэгсэл хайх, Ажилтай холбох | R24: AI туслах large + the two stacked |
| Зураг | Хуудас дугаарлах, Зураг хувилах, Хэмжээс/тэмдэглэгээ | Элемент хуулах, Хуудас үүсгэх | confusable pair «Элемент хуулах» ↔ «Зураг хувилах» sit in different slot types |
| Арматур | Төгсгөлийн тэмдэг, Огтлолын тэмдэглэгээ, Тэмдэглэгээ шинэчлэх | — | labels now ≤ 11 chars/line (was 18) |
| Түүвэр | Элемент тоолох (R25+), Түүвэр хувилах, Түүвэр шинэчлэх | — | |
| Шалгалт (R25+) | Давхцал шалгах, Өөрчлөлтийн нөлөө | — | whole panel absent on R24 |
| Экспорт | Файл гаргах (R25+), **«ERP-д илгээх»** pulldown | — | pulldown = Тоо хэмжээг илгээх · PDF илгээх · Түүвэр илгээх. Explicit pulldown (not a split button) so the default action can never silently change destination. |
| Сан ба тохиргоо | Family сан (R25+) | Бүртгэл/эрх, Тохиргоо | |

Large buttons drop from 23 to **15** (+1 pulldown, 3 stacks) — pinned by `RibbonPlanTests`. **Risk, honestly:** the app's own history says Revit collapses an over-wide panel; whether this layout collapses at 1366/1600/1920 px and 100–200 % DPI is **unverified** — measure in live Revit. **Command-id risk:** Revit derives external-command ids from tab/panel/(pulldown)/Name (predicted `CustomCtrl_%CustomCtrl_%MGL%<panel>%<Name>`, pulldown members add a segment). Keeping `Name` stable is **not** enough: renaming panels / moving into a pulldown changes the id, so **QAT entries and keyboard shortcuts for moved buttons may need re-adding** (NEEDS LIVE CHECK). `PostCommand` from the catalog therefore verifies with `RevitCommandId.LookupCommandId` and degrades to a clear message — never a broken launch button.

## 6. Window / surface inventory

Totals (R25–R27 / R24): **25 / 15** WPF windows (19 / 14 modal), **4 / 2** dockable-pane `UserControl` types, **130 / 93** `TaskDialog` + `MessageBox` call sites in 37 files, 12 `Pick*` prompts, 1 OS dialog type (`OpenFolderDialog`, .NET 8+ so it lives in Smart). Full per-surface table with opened-by, modality, build, copy language, placement and theme approach: evidence file §«UI surface inventory». Windows with size/min/owner:

| # | Window | Source (size lines) | Width × Height | Min | SizeToContent / ResizeMode | Own startup | Owner / show path |
|---|---|---|---|---|---|---|---|
| 1 | SettingsDialog | `SettingsDialog.xaml:5-9` | 460 × auto | none | Height / NoResize | CenterScreen | modal (QtoExportCommand.cs:36/208/285, BindingCommand.cs:38, PdfViewExportCommand.cs:53, ScheduleExportCommand.cs:36); also `new SettingsDialog { Owner = this }` (QtoProgressWindow.xaml.cs:201) |
| 2 | BindingDialog | `BindingDialog.xaml:5-8` | 1040 × 680 | none | default resize | CenterScreen | modal (BindingCommand.cs:99) |
| 3 | BatchSheetDialog | `BatchSheetDialog.xaml:5-8` | 640 × 720 | none | default | CenterScreen | modal (BatchSheetCommand.cs:59) |
| 4 | SchedulePickerDialog | `SchedulePickerDialog.xaml:5-8` | 560 × 620 | none | default | CenterScreen | modal (ScheduleExportCommand.cs:59) |
| 5 | QtoProgressWindow | `QtoProgressWindow.xaml:5-10` | 560 × auto, MaxHeight 640 | none | Height / NoResize | CenterScreen | modal (QtoExportCommand.cs:128) |
| 6 | CopyToOtherDialog | `CopyToOtherCommand.cs:292-297` | 540 × auto | none | Height / NoResize; no ScrollViewer, no MaxHeight | CenterScreen | modal (:90) |
| 7 | AutoAnnotateDialog | `AutoAnnotateDialog.cs:34-40` | 860 × 640 | 760 × 560 | CanResizeWithGrip | CenterScreen | modal (AutoAnnotateCommand.cs:77) |
| 8 | CloneDrawingsDialog | `CloneDrawingsDialog.cs:110-117` | 1040 × 760 | 860 × 580 | CanResizeWithGrip | CenterScreen | modal (CloneDrawingsCommand.cs:122) |
| 9 | EndSymbolDialog | `EndSymbolDialog.cs:49-50` | 680 × 860 → clamped | 600 × 640 | `RfUi.Setup` then **NoResize** | CenterScreen | modal (EndSymbolCommands.cs:63) |
| 10 | SectionAnnotationDialog | `SectionAnnotationDialog.cs:98` | 1100 × 800 → clamped | 980 × 700 | CanResizeWithGrip | CenterScreen | modal (SectionAnnotationCommand.cs:106) |
| 11 | ScheduleCloneDialog | `ScheduleCloneDialog.cs:75` | 1000 × 760 → clamped | 860 × 620 | CanResizeWithGrip | CenterScreen | modal (ScheduleCloneCommands.cs:43) |
| 12 | ScheduleSyncDialog | `ScheduleSyncDialog.cs:70` | 1000 × 740 → clamped | 860 × 600 | CanResizeWithGrip | CenterScreen | modal (:104) |
| 13 | LicenseDialog | `LicenseDialog.cs:54-59` | 470 × auto | none | Height / NoResize | CenterOwner | modal (LicenseCommand.cs:16; LicenseGate.cs:146 uses the remembered handle) |
| 14 | PublishDialog | `PublishDialog.cs:149-154` | 1180 × 780 | 900 × 560 | default | CenterOwner | modal (SmartPublishCommand.cs:61); `ShowInTaskbar` not set |
| 15 | ProfileEditorDialog | `ProfileEditorDialog.cs:78-83` | 780 × 700 | 640 × 520 | default | CenterOwner | `Owner = this` (PublishDialog.cs:490) |
| 16 | PublishProgressWindow | `PublishProgressWindow.cs:37-42` | 480 × 190 | none | NoResize | CenterOwner | modeless `Show()` + `WindowInteropHelper` (SmartPublishCommand.cs:113-114; PublishImpactAnalysis.cs:45-46) + `OwnerLock` |
| 17 | ChangeImpactWindow | `ChangeImpactWindow.cs:111-116` | 1320 × 820 | **1000 × 620** | default | none set (WPF default) | modeless `SmartWindows.ShowModeless` → `ApplyOwner` (ChangeImpactCommand.cs:41) |
| 18 | ImpactHistoryDialog | `ChangeImpactWindow.cs:740-745` | 760 × 520 | none | default | CenterOwner | `Owner = owner`; `ShowDialog` (:433) |
| 19 | PromptDialog (anonymous `new Window`) | `ChangeImpactWindow.cs:711-714` | 480 × auto | none | Height / NoResize | CenterOwner | `Owner = owner`; `ShowDialog` (:731) |
| 20 | ClashWindow | `ClashWindow.cs:103-108` | 1240 × 800 | 960 × 600 | default | none set | modeless `SmartWindows` (ClashCheckCommand.cs:41) |
| 21 | ClashRuleDialog | `ClashRuleDialog.cs:52-59` | 900 × 780 | 700 × 520 | default | CenterOwner | `Owner = owner`; `ShowDialog` (ClashWindow.cs:360) |
| 22 | SmartCountWindow | `SmartCountWindow.cs:93-98` | 1180 × 780 | 900 × 560 | default | none set | modeless `SmartWindows` (SmartCountCommand.cs:41) |
| 23 | SheetNumeratorWindow | `SheetNumeratorWindow.xaml:5-10` | 1180 × 780 (or restored) | **960 × 620** | default | CenterScreen if no saved bounds, else Manual (xaml.cs:466-491) | modeless `Show()`; `WindowInteropHelper.Owner` (SheetNumeratorCommand.cs:90,104) |
| 24 | TextPromptDialog | `TextPromptDialog.cs:18-23` | 460 × auto | none | Height / NoResize | CenterOwner | `Owner = owner` when non-null (:60); `ShowDialog` (:61) |
| 25 | FamilyHubWindow | `FamilyHubWindow.xaml:5-6` | 1100 × 760 | 640 × 480 | default | CenterOwner | modeless `Show()`; `WindowInteropHelper.Owner = App.MainWindowHandle` (FamilyHubCommand.cs:39,43) |

**Easy-to-skip secondary surfaces (must be restyled/audited, not forgotten):** `TextPromptDialog` and `PromptDialog.Ask` (duplicates), `QtoProgressWindow`, `PublishProgressWindow` + `OwnerLock`, `ProfileEditorDialog`, `ClashRuleDialog`, `ImpactHistoryDialog`, `LicenseDialog`, the nested `IntelligencePanel`, `CdJobPaneView`, `SectionPreview`, `RfSearchBox`/`RfScheduleSourcePanel`, and the 130 TaskDialog/MessageBox call sites (copy only — they are Revit/OS chrome).

## 7. Design decisions

### 7.1 Shared UI layer (`revit-mcp/addin/Ui/`) — scoped, additive, no framework
- **No new `.xaml` files.** The repo documents `BG1002 …baml cannot be found` failures of the WPF two-pass compile (`docs/INSTALL_BUNDLE.md:30`, `docs/SMART.md:305`), has **zero** `pack://`/`ResourceDictionary` precedent, and an isolated load context (`EnableDynamicLoading`). Proven mechanisms are BAML via `InitializeComponent` (existing XAML) and fully code-built resources. So tokens and control styles are built in code / parsed from an in-code XAML string with `XamlReader.Parse` — no resource URIs.
- **Scoped, never global:** a themed dictionary is merged into one MGL window/pane's own `Resources`; `Application.Current.Resources` is never touched (0 references today; must stay 0).
- **Tokens** use `DynamicResource` keys so open surfaces re-theme. Keys deliberately reuse the existing pane key names (`Bg`, `BgRaised`, `BgInput`, `Line`, `Fg`, `FgMuted`, `Accent`, `Warn`, `Danger`) so the three dark panes migrate by `StaticResource` → `DynamicResource` plus deleting their copies.
- **Theme resolution:** Windows high contrast (`SystemParameters.HighContrast`) wins → system colours; else Revit `UIThemeManager.CurrentTheme` (Light/Dark; present in all four API versions) via an adapter set from `App`; else light. Revit's `ThemeChanged` + `SystemParameters.StaticPropertyChanged` re-theme open surfaces (weak, unsubscribed on close).
- **Pure core** (`Ui/Core`, no Revit/WPF) so a new `tests/MglUi.Tests` runs on macOS: theme resolver, palette + WCAG contrast arithmetic (contrast of every token pair is *tested*, not asserted), window-fit geometry (monitor removal, DPI), UI-prefs model, tool metadata, availability evaluator, search, ribbon plan.
- **UI prefs** (window size, first-use hint dismissal) in a **new** `%APPDATA%\RevitMcpAddin\ui-prefs.json` (atomic write). Never in `settings.json` (carries token handling), never in the RVT.
- **Window placement:** centre on the Revit owner's *actual* monitor, clamp size/min-size to that monitor's work area in DIPs (per-monitor DPI via `MonitorFromWindow`/`GetDpiForMonitor`, fallback system DPI), re-fit saved bounds that no longer intersect any monitor. Extends — not replaces — `RfUi.Setup`.

### 7.2 Tool metadata registry (one source)
`ToolMeta` (pure data, **all** tools incl. ones not compiled on R24) → feeds ribbon text, tooltips, extended help and the catalog. `RibbonPlan` is data too. Revit binding (`typeof(command).FullName`) lives only in `#if`-guarded code. A regression test pins the 23 stable names and checks: unique names, no empty panel for any module set, aliases resolve («clash», «count», «publish», «clone», «huudas dugaar», «armat…»), tooltip length caps, every tool states effect (reads/changes/creates files/sends to ERP/local history).

### 7.3 Catalog + launching
Modal `MglToolCatalog` command (new, R24-safe). Search is local (folded Cyrillic/Latin, old labels, English). Context (document? family? view kind? licence? ERP project? busy?) is read once, cheaply, in `Execute` — no collectors. «Нээх» closes the dialog, then `UIApplication.PostCommand` runs **inside the same API context** after `CanPostCommand` + `LookupCommandId`; `InvalidOperationException` (a command already posted) is caught and explained. `IExternalCommand.Execute` is never called directly; no fabricated `ExternalCommandData`; no UI click simulation. Each command still runs its own licence/availability guard when it actually starts.

### 7.4 Why names stay short on the ribbon
Short ribbon labels (≤ 2 lines, ≤ ~11 chars/line) because of the collapse lesson; the full action+result name is the catalog/dialog title and the tooltip's first line.

### 7.5 Development mode
`MGL_DEV_MODE == "1"` (process env, default off, same pattern as `MGL_ALLOW_EXEC`). The DEV tab is collapsed unless the helper says so; tool guards untouched.

## 8. Changed files

**Phase 0** — `docs/MGL_UI_UX_REDESIGN.md`, `docs/MGL_UI_UX_REDESIGN_EVIDENCE.md` (new).

**Phase 1 — shared UI layer (all new unless noted)**
- `addin/Ui/Core/` (pure, Revit/WPF-free, net48-safe): `MglPalette.cs` (tokens + WCAG contrast + theme resolver), `WindowFit.cs` (monitor/DPI-safe window geometry), `UiPrefsModel.cs`, `ToolMeta.cs`, `ToolAvailability.cs`, `ToolSearch.cs`, `RibbonPlan.cs`, `ToolCatalogData.cs` (all 24 tools' text), `ToolIconSpec.cs`.
- `addin/Ui/`: `MglTheme.cs`, `MglStyles.cs`, `Resources/MglControls.xaml` (**embedded resource, not a Page**), `MglWindow.cs`, `MglNative.cs`, `MglUiPrefs.cs` (→ `%APPDATA%\RevitMcpAddin\ui-prefs.json`), `MglAuto.cs`, `MglUiText.cs`, `MglUi.cs`, `ToolIconRenderer.cs`.
- `addin/Ui/Revit/RevitThemeBridge.cs`.
- Modified: `RevitMcpAddin.csproj` (`Page Remove` + `EmbeddedResource` for `Ui/Resources`), `App.cs` (theme bridge attach; `ShowOwned` respects `MglWindow`-managed placement).
- Proof surfaces: `QtoProgressWindow.xaml(.cs)` (themed, owner-monitor sizing, status colours → theme-aware `Kind`, honest «Revit түгжигдэнэ / цуцлах файлын хилд» note, destination in title), `SchedulePickerDialog.xaml(.cs)` (F10: «Харагдаж буйг сонгох» / «Сонголт цуцлах» with scope tooltips, hidden-selected count, inline error instead of MessageBox, «ERP-д илгээх»).
- Tests: `tests/MglUi.Tests/` (new project; 95 tests).

**Phase 2 — ribbon, icons, catalog**
- `addin/Ui/Revit/`: `RibbonBuilder.cs`, `ToolLauncher.cs`, `ToolContextProbe.cs`, `ToolCatalogCommand.cs`, `ToolAvailabilityClasses.cs` (`ToolCatalogAvailability`, `CopyToOtherAvailability`, `CloneDrawingsAvailability`, `SectionAnnotationAvailability`); `addin/Ui/ToolCatalogWindow.cs`.
- `App.cs`: `CreateRibbon` now delegates; ~330 lines of hand-built buttons + `IconColors` + `MakeButton` removed.
- **Deleted:** `Smart/Revit/SmartRibbon.cs`, `Reinforcement/RfRibbon.cs` (their stale tooltips were the F4 evidence; text now lives in `ToolCatalogData`).

**Phase 3 — account, panes, dev mode**
- `SettingsDialog.xaml(.cs)` rewritten: async sign-in/project reload (`Ui/Core/RequestGuard.cs`: request supersession, host-edit epoch, closed flag, late-401 guard), «1. Бүртгэл» / «2. ERP төсөл» / «Нарийвчилсан тохиргоо», visible save-blocked reason. `Licensing/LicenseDialog.cs` on shared tokens («Бүртгэлээс гарах», ✓/✕ status words); `Licensing/Core/LicenseText.cs` («захиалагч»); `RevitApi.cs` friendly network message.
- `AssistantPane`, `WorkPane/WorkPaneView`, `Intelligence/Ui/IntelligencePanel`, `CloneDrawings/CdJobPaneView`: local dark palettes deleted → shared `DynamicResource` tokens (`MglTheme.Apply`), ≥ 12 DIP secondary text, automation names, exclusive section expansion in `AssistantPane`, row colours via `DataTrigger`s (no code-built brushes). `MglTheme.Apply` now sets the **tokens even if `MglControls.xaml` fails to load**.
- `Intelligence/Core/DevMode.cs` (`MGL_DEV_MODE=1`) + `tests/Intelligence.Tests/DevModeTests.cs`; DEV tab collapsed and moved last.

**Phase 4 — workflows**
- `Ui/Core/BindingView.cs`, `Ui/Core/BatchSheetRules.cs` (pure; `BatchSheetCommand` numbering helpers now delegate to it); `BindingDialog.xaml(.cs)` («Холбоос хадгалах», counts of link/skip, search + filter, status words, confirm-before-save, dirty-close guard); `BatchSheetDialog.xaml(.cs)` (inline field errors, whole-run duplicate count, blocked-reason line, «<n>» and length help, no-title-block warning).
- `SheetNumerator/Ui/SheetNumeratorWindow.xaml(.cs)` (tokens, automation names incl. ▲▼⤒⤓, work-area clamp via `MglWindow` + own saved bounds), `Converters.cs`, `TextPromptDialog.cs`; `Core/Text.cs` title «Хуудас дугаарлах».
- `CopyToOtherCommand.cs` (dialog restyle, buttons outside the scroll area, «Элемент хуулах»), `CloneDrawings/*` («Зураг хувилах»; `MGL клон` transaction/view-name prefix **unchanged** — it is a data marker), `AutoAnnotate/*` («Хэмжээс, тэмдэглэгээ»), `Reinforcement/Ui/{RfUi,EndSymbolDialog,SectionAnnotationDialog,ScheduleCloneDialog}.cs` + `RfText.cs` (Partition = «Арматурын бүлэг (Partition)», not Workset).
- `Ui/MglBrushes.cs`: live theme brushes so code-built windows (`RfUi`, `UiKit`) follow Light/Dark without touching every call site.

**Phase 5 — remaining windows**
- `Smart/Ui/SmartUi.cs` (`UiKit.Prepare`, live brushes), `SmartCount/ClashCheck/ChangeImpact/SmartPublish` windows + their commands (titles/terminology), `Ui/MglBusy.cs` (used by `QtoExportCommand`, `ScheduleExportCommand`, `PdfViewExportCommand`, `BindingCommand` instead of `Task.Run(...).GetAwaiter().GetResult()` on the UI thread), `Ui/MglPrompt.cs`, `FamilyHub/*` (localised labels; `RevitCompatibilityCheck.DisplayLabel`).
- `Ui/MglWindow.cs` no longer references `App` (`OwnerHandleProvider`, set in `App.OnStartup`); `MglUiPrefs` no longer references `SettingsStore` → these files compile in the Revit-free smoke projects.

**Tests/projects:** `tests/MglUi.Tests` (123 tests incl. source-consistency guards), `tests/CloneDrawings.UiSmoke`, `SheetNumerator.UiSmoke`, `Smart.UiSmoke` csproj includes + `CloneDrawings.UiSmoke/Program.cs` (label/tag changes).
**Docs:** `docs/{AUTO_ANNOTATE,CLONE_DRAWINGS,INSTALL_BUNDLE,REINFORCEMENT,SHEET_NUMERATOR,SMART}.md` (naming note), `docs/dev/08-qto-revit.md` (ribbon names).


## 9. Checks run

| Check | Result |
|---|---|
| `dotnet build … "Release R24/R25/R26/R27"` after every phase (final: 2026-10-03, all four) | **0 errors, 26 warnings each = baseline** (no new warning) |
| `MglUi.Tests` (new) | **123/123** |
| Other pure suites, final run | AutoAnnotate 17/17 · CloneDrawings 62/62 · Intelligence 83/83 (80 + 3 `DevMode`) · SheetNumerator 174/174 · WorkPane 17/17 · WorkTracking 36/36 · **Reinforcement 247/247** (baseline 246/247) · FamilyHub 51/52 · Licensing 34/35 · Smart 349/376 — the last three fail **only** on the baseline's Windows-only assumptions (`a:b.rfa`, display-adapter probe, `D:\Out`/quarantine) |
| `CloneDrawings.UiSmoke`, `SheetNumerator.UiSmoke`, `Smart.UiSmoke` | **compile** with the shared-theme includes (0 errors); **NOT RUN** |
| `Ui/Resources/MglControls.xaml` as a WPF `Page` in a throwaway project (syntax/type/property validation) | 0 errors; a deliberately broken copy is rejected (`MC4005`) → the validator can fail |
| `MglControls.xaml` is embedded in the R24 and R27 DLLs | yes (raw XAML found in both) |
| Static cross-check `RibbonBuilder` bindings ↔ `ToolCatalogData` (also `SourceConsistencyTests`) | complete, R24-safe set = exactly the `Build=All` tools |
| `*.UiSmoke`, live Revit | **NOT RUN** |

## 10. Screenshots

None captured: this Mac cannot run WPF and no Revit is available. Before/after capture commands for a Windows PC: `SMOKE_OUT=<dir> dotnet run` in `revit-mcp/tests/{SheetNumerator,Smart,CloneDrawings,Reinforcement}.UiSmoke`.

## 11. Known limitations / manual QA (NOT RUN)

- **Ribbon collapse / width at 1366/1600/1920 px and 100–200 % DPI** (the app's own history: an over-wide panel collapsed into one icon): unverified. Measure live on R24 and R27.
- **Command ids**: panel/pulldown names changed, so QAT entries and keyboard shortcuts for moved buttons may need re-adding; the *stacked-item* id format is unknown (launcher tries two candidates and logs every attempt to `%APPDATA%\RevitMcpAddin\ribbon-ids.log` — read that file after the first catalog «Нээх» in live Revit).
- **Icons**: glyph code points are the previously eyeballed ones plus `E838/E8B7` (folder) for «Файл гаргах», `E753/E724/E898` (cloud) for the ERP pulldown, `E721/E71E` (search) for the catalog — **not seen** (no Segoe fonts on this Mac). Check 16/32 DIP in Light and Dark.
- **Theme/DPI**: `MglTheme` Light/Dark/High-contrast switching, live re-theme on Revit `ThemeChanged`, `MglWindow` placement on mixed-DPI multi-monitor setups, and the process's DPI awareness (system vs per-monitor) are unverified in real Revit. `MglNative` handles both modes but only one can be right.
- **AreaPlan**: the rebar tools' `RfView` rejects area plans; the catalog treats all plan kinds as "Plan" (the command still refuses with its own message).
- **Contextual help (F1)**: not wired — there is no bundled, working help target to point at.
- **XAML styles are loaded at runtime** (`XamlReader`); if that ever fails `MglStyles.LastError` is set, the palette **tokens are still applied** (panes/dialogs keep a readable themed background) but the implicit control styles are missing (system-default buttons/inputs). The load path has only been syntax-validated, never run in WPF here.
- **Visual regressions are likely somewhere** in the ~35 migrated windows: they were compiled and logic-tested, never rendered. Priority eyeball list: `SheetNumeratorWindow` (700-line XAML, DataGrid/TreeView templates now on tokens), `AssistantPane` (878 lines), `PublishDialog`/`ClashWindow` DataGrids (implicit `DataGrid`/`DataGridCell` styles now apply), `CopyToOtherDialog` `GroupBox` (system template, no themed style), `FamilyHubWindow` (kept its own light palette on purpose).
- **`MglBusy`** (modal «Сервертэй холбогдож байна» window shown only after 400 ms) removes the Revit «Not Responding» freeze but is **not cancellable**: `ApiClient` has no cancellation token, so a cancel button would be a false promise. The wait is still up to the old HTTP timeouts (≤ 180 s).
- **`CdJob`/`CdEngine` report text** now says «хувилах» for the tool; the nouns «клон»/«өмнөх клон» (the produced copies) and the `MGL клон` prefix (matched in code) are deliberately unchanged.
- `docs/dev/08-qto-revit.md` «Auth» section (365-day token) is stale since add-in 1.10 (device-key licence) — outside this UI task, not edited.

## 12. Open owner decisions

- `MglWorkPane` ribbon tooltip says «5 минут оролтгүй бол идэвхгүй болно / цаг автоматаар тоологдоно», while the pane's own rule (`WorkPaneView.xaml.cs:27-29`) forbids writing «цаг тоологдоно». The redesign keeps the *behaviour* untouched; wording of that one sentence needs an owner decision.
- `WorkPaneView.xaml:346-347` tracking disclosure is «эзний шийдвэр — өөрөө бүү хас»; it is kept verbatim.
- Whether to replace the inert 🎤 button (placeholder) — left as-is.
