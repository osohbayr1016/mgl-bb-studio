# MGL AI — Revit Intelligence (Session R)

Revit 2027 add-in дотор MGL AI ажилтны ЮУГ харж байгааг яг мэдэх, даалгаврыг
BIM элементтэй холбох, үйл ажиллагаанаас баримттай тайлан гаргах, загварын
өөрчлөлтийг детерминист нийцлийн хоолойд оруулах суурь.  Хувилбар 1
(2026-09-14).  Загвар (Qwen) ЭНД ХЭЗЭЭ Ч BIM үнэн, PASS/FAIL, тоо шийддэггүй.

## Байршил

```
revit-mcp/addin/Intelligence/          RevitMcpAddin.dll-ийн нэг хэсэг (net8/net10 л; net48/R24-д хасагдсан, MGL_INTELLIGENCE)
  Contracts/   RevitContextSnapshot · SceneGraph · Compliance · Tasks · Reports · RevitAction · MglAiWire · TestModel
  Core/        Revit-ГҮЙ логик: UnitsBoundary · SceneGraphStore · ChangeSetAdapter · TaskInterpreter · ProjectLinkPolicy
               ActivityJournal · ReportEvidence · ComplianceEvaluator · RevitActionValidator · DocKeys · TestFixtureRuleProvider
  Revit/       Autodesk.Revit.* адаптер: RevitContextExtractor · SceneGraphExtractor · IntelligenceTools · RevitIntelligenceHost · TestModelFixture
  Erp/         ErpTaskContextProvider (GET /api/revit/context) · ErpProjectsProvider (GET /api/projects)
  Ai/          IMglAiRevitClient · Mock · Unbound (SESSION_D_BINDING_REQUIRED) · MglAiRuntimeProbe
  Ui/          IntelligencePanel (Контекст · Даалгавар · Асуудал · Тайлан · AI · DEV) + ViewModels
revit-mcp/tests/Intelligence.Tests/    пакетгүй runner, 80 тест — `dotnet run` (--nologo БҮҮ өг: args болж очно)
```

Хуучин самбар `AssistantPane` («MGL туслах») энэ панелийг «AI» toggle-ийн ард
хостлоно (strangler, R-1).  Хоёр дахь dockable pane БАЙХГҮЙ.

## Thread-ийн загвар

```
Revit үйл явдал (DocumentChanged / SelectionChanged / ViewActivated)
   → ЗӨВХӨН id, нэр, дохио (Debouncer 150 мс)
   → арын thread: RevitToolBus.Call/TryCall (ГАНЦ ExternalEvent, Track 2-ийнх)
   → Revit-ийн API контекст дотор ХӨДЛӨШГҮЙ DTO үүснэ (RevitContextExtractor / SceneGraphExtractor)
   → DTO арын thread руу; граф · үнэлгээ · журнал · UI (Dispatcher)
```

HTTP, AI, геометрийн алхалт Revit-ийн үйл явдлын дотор ХЭЗЭЭ Ч.  Дотоод
төсөв: агшин зураг 400 мс, индекс 1500 мс, харилцаа 400 мс, геометр 600 мс.

## Scene graph

Гурван давхарга (INDEX → RELATIONS → GEOMETRY), lazy.  Ирмэг бүр эх сурвалж +
итгэлтэй: `ROOM_BOUNDARY`, `REVIT_HOST`, `FROM_TO_ROOM`, `LEVEL_PARAMETER`,
`REVIT_SPATIAL_API` = AUTHORITATIVE; `BOUNDING_BOX_APPROXIMATION` = APPROXIMATE
(нийцэлд ХЭЗЭЭ Ч эрх бүхий биш; энэ хувилбар үүсгэдэггүй).  Устгалт нь
`GetElement == null → MarkDeleted` — dereference хийхгүй.

Өөрчлөлт: `ChangeTracker` → `ChangeSetCoalescer` (1200/15000/2000 ХЭВЭЭР) →
`BimEmitter.ComplianceHook += …` (multicast) → `ChangeSetAdapter` → `RevitChangeSet`
→ `SceneGraphStore.ApplyChangeSet` → `scene_refresh` (TryCall, Revit завгүй бол дараа)
→ `ComplianceEvaluator` → `IssueStore` → журнал → самбар.

## Нийцэл — гурван анги

`VERIFIED_NORM` (баталгаажсан эх + ил BIM хамаарал + детерминист хэмжилт + эрх
бүхий ирмэг) · `MODEL_QUALITY` (`ModelQualityRuleProvider`: өрөө хаалттай биш /
байрлуулаагүй, хаалга хостгүй, давхаргүй) · `REVIEW_CANDIDATE`
(`HUMAN_REVIEW_REQUIRED`; синтетик, нэгж зөрсөн, provenance тодорхойгүй).
`ProductionBimRuleProvider` → `NO_EXECUTABLE_BIM_RULES` — текстэн заалтаас
дүрэм зохиохгүй; Session A-ийн компайлер ирээдүйд `IBimRuleProvider`-оор
холбогдоно.  `TestFixtureRuleProvider` зөвхөн `is_test_fixture` баримтад.

## Даалгавар · тайлан

`TaskInterpreter` (кирилл/латин/англи, TextFold) → `TASK_INTERPRETATION` →
`TaskCandidateResolver` (графаас ЖИНХЭНЭ элемент) → Next/Prev/Show/Шалгасан ✓.
Явц ХЭЗЭЭ Ч тооцохгүй: `PROGRESS_ESTIMATE_UNAVAILABLE` (R-9).
Тайлан: `ActivityJournal` (JSONL, `%APPDATA%\RevitMcpAddin\intelligence\`) →
`ReportEvidenceBuilder` (баримт бүр эх сурвалж + журналын seq) → `ReportRenderer`
(TECHNICAL_SELF_REPORT · TEAM_TASK_REPORT · MANAGER_REPORT — менежерт элементийн
тоо ХЭЗЭЭ Ч).  Загваргүй ч детерминист; урьдчилсан харагдац л, ERP руу илгээхгүй.

## Синтетик тест загвар (DEV таб, NON-PRODUCTION)

`test_project_new` (NewProjectDocument(Metric) → тэмдэглэ → SaveAs → нээ) ·
`test_model_gate` · `test_model_create` (10000×8000 мм, L2 = 3000, 6 хана, шал,
Room 101/102/Corridor, хаалга/цонх family байвал) · `test_model_mutate`
(move/delete_interior_wall, delete_door) · `test_model_save` · `test_project_open`
(зөвхөн `intelligence\test-models\`).  Хаалт: агуулгатай баримтад ҮРГЭЛЖ татгалзана.
Манифест `test-model-manifest-<doc_key>.json`, логик нэрс (`wall.exterior.north` …).

## Session D-ийн залгаас (SESSION_D_BINDING_REQUIRED)

1. `IMglAiRevitClient` — серверийн нэг ээлжийн endpoint (эсвэл `packages/mglai-common`-д
   зөөсөн оркестраци) ирэхэд `RevitIntelligenceHost.BindAi(...)` л солигдоно.
2. `IMglAiLocalAuthProvider` — локал runtime-ийн нууцын нийлүүлэгч (B-ийн суулгацын гэрээ).
3. Хариултын гэрээний баталгаажуулалт (`validator.ts`) хөтөч дээр л байдаг — Revit-д хос хэрэгтэй.
4. `revit_context` утсан гэрээ аль хэдийн серверт бий (`lib/mglai/revitContext.ts`); `MglAiWire.FromSnapshot` түүнийг үүсгэнэ.

## R4 — бичих үйлдэл (ХИЙГЭЭГҮЙ)

`RevitActionEnvelope` + `RevitActionValidator` гэрээ л; `ActionSafety.MaxLevel = PROPOSE`,
бичих үйлдэл бүр `WRITE_ACTION_DISABLED_IN_THIS_RELEASE`.  Ирээдүйн зам: схем → эрх →
элемент байгаа/засварлагдах эсэх → геометрийн ба BIM preflight → preview → баталгаа →
RevitToolBus → Transaction → дахин унших → дахин шалгах → commit/rollback → аудит.

## Phase 5 — SHARED_CLIENT_NEUTRAL_TURN_FOUNDATION (2026-09-14, main-merge-d@80c0075 дээр)

⚠️ **ТӨЛӨВ: суурь л, «нэг зам» ХАРААХАН БИШ.**  Revit → `packages/mglai-common` хөдөлгүүр;
хөтөч → өөрийн `orchestrator.ts` ХЭВЭЭР.  Тиймээс ТҮР ХОЁР хэрэгжүүлэлт зэрэгцэн байна;
«нэг хуваалцсан зам дууссан» гэж хөтөч package руу шилжиж, паритетын тест тэнцтэл ХЭЛЭХГҮЙ.

```
Хөтөч (ирээдүйд) ─┐
Revit add-in ─────┼─→ ажилтны PC-ийн runtime  POST 127.0.0.1:39217/turn  (SSE: ai… → result)
Дуу (ирээдүйд) ───┘        └─ packages/mglai-common/src/turn/engine.ts   ← хөтчийн orchestrator.ts-ийн МЕХАНИК ПОРТ
                                 ├─ backend: Worker /api/mgl-ai/{plan,tool,context,messages,conversations} (Bearer = erp_token | paired)
                                 ├─ runtime: loopback /norm, /generate (энэ процесс өөрөө, X-MglAi-Secret)
                                 └─ validate · applyContract · enforceTrusted · davtalt — БҮГД тэр нэг файлд
```

- `packages/mglai-common/src/turn/` — `engine.ts` (orchestrator-ийн порт: `apiFetch` → `deps.backend.fetch`,
  `askNorm/streamGenerate` → `deps.runtime`; `surface` + `revit_context` нэмэгдсэн, өөр ЮУ Ч өөрчлөгдөөгүй),
  `transports.ts` (гэрээ), `fetchTransports.ts` (`createBackendTransport` = apiFetch-ийн семантик,
  `createLocalRuntimeTransport` = runtime.ts-ийн streamGenerate/askNorm-ын үг үсгийн порт), цэвэр модулиуд
  (aiEvents · aiBudget · aiErrors · types · validate · validator · contract · memory[MemoryStorage] · aiMachine).
  DOM/localStorage/process ЭНД БАЙХГҮЙ — `test/turnEngine.test.ts` grep-ээр барина (4 тест).
- `ai/runtime/src/turn.ts` + server.ts-д 3 мөр: `POST /turn` (`/generate`-тэй ижил хаалга).  `erp_token`
  дуудагчаас, үгүй бол `/pair`-ийн итгэмжлэл; токен хариуд ХЭЗЭЭ Ч гарахгүй; `cache` явахгүй.  `runtime/test/turn.test.ts` (4).
- Revit: `Intelligence/Ai/MglAiTurnClient.cs` — SSE уншина, оркестраци/validator C#-д БАЙХГҮЙ; нууц
  `LocalAppDataAuthProvider` (`%LOCALAPPDATA%\MglAi\secret.txt`, runtime-ийн өөрийн файл, зөвхөн уншина).
  Хост одоо `MglAiTurnClient`-ийг холбодог (`Binding = LIVE:/turn`); `Unbound`/`Mock` нь fallback/тест.
- **Хэмжсэн (2026-09-14, тусгаарласан runtime :39307, echo engine, БОДИТ Worker):** plan 884 мс → context 217 мс
  (`surface:revit`, `revit_context` Worker-т хүрсэн) → generation 34 токен, эхний токен 1 мс → нийт 1 253 мс.
  Сүлжээ тасрахад `BACKEND_OFFLINE` гэж ил (хуурамч хариултгүй).
- Тест runtime: ЗӨВХӨН `ai/runtime/test/helpers/isolatedRuntime.ts` (яг PID + үүссэн цаг + порт нотолгоо;
  Session R порт 39307; 39217/39227-д ХЭЗЭЭ Ч хүрэхгүй; нотлогдохгүй бол зогсоохгүй).
- ⚠️ ХӨТӨЧ ХАРААХАН `/turn`-ИЙГ ХЭРЭГЛЭДЭГГҮЙ — `orchestrator.ts` хэвээр.  Дараагийн алхам: хөтчийн
  `lib/*.ts`-ийг package-ийн re-export болгож (паритетын хаалга: `check-ai-stream`, `check-ai-validator`,
  `ai:eval:conv`), дараа нь хөтчийг ч `/turn` руу шилжүүлэх эсэхийг шийднэ (offline-д хөтөч өөрөө
  engine-ийг ажиллуулж болно — тээвэр л солигдоно).
- ⚠️ Ажилтны PC-ийн runtime код өөрчлөгдсөн (`/turn`).  **Ажилтанд тараах зам нь Session B-ийн
  релизийн хоолой Л**: манифест → staging → SHA шалгалт → нийцэл → хувилбартай идэвхжүүлэлт →
  дахин асаалт → health → smoke → lastKnownGood → буцаалт.  Ажилтанд Git ШААРДАХГҮЙ.
  `git pull` + `ai:restart` нь ЗӨВХӨН DEVELOPER_LOCAL_WORKFLOW (хөгжүүлэгчийн өөрийн PC).  Deploy ХИЙГЭЭГҮЙ.

## R3 — хөтөч ХУВААЛЦСАН хөдөлгүүр рүү шилжив: SHARED_TURN_ENGINE_SINGLE_PATH (2026-09-14)

**Phase 5-ийн «түр хоёр хэрэгжүүлэлт» ДУУССАН.**  Хөтөч · ажилтны runtime (`POST /turn`) · Revit гурвуулаа
`@mgl/mglai-common/turn`-ийн НЭГ `runTurn`-ыг дуудна; хөтчийн хуулбар модулиуд устсан.

```
Хөтөч ─ MglAiPage ─ lib/browserTurn.ts (BrowserTurnAdapter: apiFetch · createLocalRuntimeTransport · localStorage) ─┐
Revit add-in ─ MglAiTurnClient (SSE) ─ runtime POST /turn ─ ai/runtime/src/turn.ts ────────────────────────────────┼─→ @mgl/mglai-common/turn
Дуу (ирээдүйд) ─ өөрийн adapter ───────────────────────────────────────────────────────────────────────────────────┘      runTurn(input, {backend, runtime})
                                                                                                                             ├─ оркестраци · validator · гэрээ · давталт · засвар · нормын семантик · aiMachine
                                                                                                                             ├─ backend: /api/mgl-ai/{plan,tool,context,messages,conversations}
                                                                                                                             └─ runtime: /norm · /generate
```

- **Багцын export аудит.**  `@mgl/mglai-common` нь ЭХ КОДООР тархдаг багц (`files: ["src"]`, `exports` → `.ts`; барих алхам
  байхгүй, хэрэглэгч бүр өөрөө компайлдана: backend esbuild · ai/ Node type-stripping · frontend Vite).  Засвар:
  `ai/package.json` + `frontend/package.json`-д `file:../packages/mglai-common` хамаарал (`npm ci` цэвэр — symlink, realpath
  нь node_modules-ийн ГАДНА тул Node .ts-ийг хуулна); runtime `../../../packages/…` харьцангуй замаа `@mgl/mglai-common/turn`
  болгов; `src/turn/index.ts` барил (`./turn`); `tsconfig.turn.json` — `src/turn/**` нь WinterCG глобал (fetch/AbortSignal/
  performance) хэрэглэдэг тул цэвэр ES2023 tsconfig-оос ТУСДАА, DOM lib-ээр (`types: []`) шалгагдана, `npm run check` хоёуланг
  ажиллуулна; хөтчийн-зөвхөн глобалыг `test/turnEngine.test.ts` grep-ээр хориглоно.  Хэрэглэгчийн smoke:
  `ai/integration/test/packageConsumer.test.ts` (4).  Frontend TS6 `bundler` resolution + Vite build ч багцыг шийддэг (хэмжсэн).
- **Паритетын харнесс** `ai/evaluation/parity/` (`npm run ai:parity`): `legacy/` = коммит 24694e7-ийн хуучин хөтчийн
  orchestrator + 10 модулийн байт-ижил хуулбар (ОРАКУЛ, продакшнд импортлогдохгүй), `turn-parity.test.mjs` = 15 кейс
  (17 тест) ГУРВАН замаар (A оракул · B хөтчийн adapter · C runtime тээвэр) ижил хуурамч сүлжээ → үр дүн · үйл явдлын дараалал ·
  утсан хүсэлтүүд байт-ижил; зориудын зөрүү ХОЁР Л (`/conversations.surface`, `/context.revit_context`, зөвхөн Revit кейст).
  `no-second-engine.test.mjs` = 7 бүтцийн инвариант (канон байршил ганц · хөтөч/runtime багцаас импортолно · устсан хуулбар
  дахин үүсэхгүй · цөмийн экспорт багцаас гадна тодорхойлогдохгүй · оракулыг продакшн импортлохгүй · C#-д validator//generate
  байхгүй) — мутацийн тестээр баригдана гэдгийг шалгасан.
- **Хөтчид ҮЛДСЭН**: `browserTurn.ts` (дамжуулалт), `memory.ts` (localStorage adapter, логик багцаас), `runtime.ts`
  (probe/pair/warmup/profile/update/metrics/загварын төлөв — `streamGenerate`/`askNorm` устсан), `frameBatch` · `markdown` ·
  `useStickyScroll` · `usage` · `deployment` (UI/хөтчийн л).  **УСТСАН**: orchestrator · aiEvents · aiBudget · aiErrors ·
  aiMachine · contract · validator · validate · types.  Session C-ийн suite, `check-ai-*` скрипт, `ai/evaluation/lib/e2e.mjs`,
  `ai/training/build_behavior_sft.mjs`, `ai/integration` drift/compat бүгд багцын эхийг уншдаг болсон.
- **Тээврийн паритетын засвар (уншилтаар олдсон, харнесс биш):** `fetchTransports.ApiNetworkError` нь хөтчийн `apiFetch`-тэй
  адил `timedOut`/`attempts` тээдэг болов — үгүй бол `classifyError` тээврийн хугацаа дуусалтыг `RETRIEVAL_TIMEOUT` биш
  `BACKEND_OFFLINE` гэж ангилах байсан; `ApiError` нь `code`/`payload`; мессежүүд apiFetch-тэй үг үсгээр ижил.
- **Загварын үнэлгээний суурь ӨӨРЧЛӨГДӨӨГҮЙ** (MODEL_BASELINE_REFERENCE = Session D канон: GOLD L1 38/38 + B09
  EXPECTED_NO_SOURCE, GOLD L2 38/38, conv бүтэц 22/22, conv үүсгэлт 32/34, company 7/10) — хөдөлгүүрийн код механик порт,
  паритет байт-ижил тул бодит Qwen дахин ажиллуулаагүй (:39217-д хүрэхгүй).
- R4 бичих үйлдэл ХЭВЭЭР ХААЛТТАЙ (`ActionSafety.MaxLevel = PROPOSE`, `WRITE_ACTION_DISABLED_IN_THIS_RELEASE`).

## R3.5 — REAL_REVIT_QWEN_ACCEPTANCE = PASS_WITH_QUALITY_NOTE (2026-09-15, коммит 1ce9b25 · 2b84c9c · 388d695)

Бодит Revit 2027 + синтетик fixture + бодит Qwen3-8B (:39217, зөвхөн /norm,/generate) + локал wrangler dev, TEST_ONLY
gateway :39307 (`ai/runtime/test/helpers/acceptanceGateway.ts`).  Q1 «Энэ юу вэ?» · Q2 «Энэ хананд ямар асуудал байна?» ·
Q3 «Өнөөдрийн хийсэн ажлын тайлан гарга.» · үргэлжлэл «Тэгвэл энэ хананы өндөр хэд вэ?» — хүргэсэн хариулт бүр итгэмжлэгдсэн
Revit баримтыг хадгалсан; зохиомол норм/явцын хувь/ажилтны үйл ажиллагаа validator-ыг давж гараагүй; BACKEND_OFFLINE 9 мс,
хариултгүй.  **Чанарын тэмдэглэл (R4-ийн аюулгүй байдлын саад БИШ):** Qwen хэмжээг заримдаа орхидог (mustMention засвар нөхнө);
3000 мм → «3 м» хөрвүүлдэг (тоон шалгалт консерватив — нэгжийн эквивалентыг сулруулахгүй, тусдаа сайжруулалт); монгол
үг хэллэг товч/эвгүй; хэмжээний мөр асуудлын асуултад илүүц; урт тайлан GPU ачаалалтай үед удаан (38 с/308 токен).

## R4.1 — CONFIRM_WRITE нээгдэв (2026-09-15) — SET_PARAMETER · MOVE_ELEMENT · CHANGE_TYPE, ЗӨВХӨН ил баталгаатай

```
typed RevitActionEnvelope (evidence: SELECTION/TOOL_RESULT/ISSUE/USER_INPUT — LLM C# ХЭЗЭЭ Ч)
 → RevitActionValidator (схем) + ActionPreconditions (бодлого + DocumentFacts/ElementFacts: бичих боломж, элемент байгаа, host doc,
   worksharing, pinned, prohibited категори, параметр цагаан жагсаалт Comments/Mark/Description, read-only, storage, утгын схем,
   MOVE ≤ 500 мм, төрөл нийцтэй, REVIEW_CANDIDATE нормын засвар зөвшөөрөхгүй)
 → ActionPreview (binding_hash = sha256(doc_fp | uniqueId | before_fp | proposal_hash | nonce); doc_fp = docKey|title|ChangeSeq)
 → ХЭРЭГЛЭГЧИЙН ИЛ БАТАЛГАА (UI Apply → USER_UI; DEV bridge: ил токен USER-CONFIRMS-<preview_id>) — загвар/хэрэгсэл/ERP ХЭЗЭЭ Ч
 → RevitToolBus → ExternalEvent → Transaction → ДАХИН авч ДАХИН шалгана → яг НЭГ мутаци → Regenerate → дахин унших
 → postcondition (утга =, байршил ±1 мм, төрөл =) → COMMIT (+ график/асуудал шууд дахин үнэлнэ) | ROLLBACK → аудит JSONL.
```
Бодит Revit (fixture 025925): **A** SET_PARAMETER Comments → APPLIED/verified 13.8 мс, буруу токен → NOT_CONFIRMED (preview
хэрэглэгдэнэ); **C** preview → өөр элемент хөдөлгөв → STALE_ACTION_PREVIEW, мутацигүй; **D** зориудын postcondition уналт →
ROLLED_BACK, утга хэвээр; **B** MOVE +100 мм Y → APPLIED 36.6 мс, график v506; +100 мм X (өөрийн тэнхлэгийн дагуу, хоёр талдаа
холбоотой хана) → Revit байршлыг өөрчилсөнгүй → POSTCONDITION_FAILED → ROLLED_BACK (хамгаалалт ажилласан); 5000 мм →
DELTA_OUT_OF_BOUNDS preview-д.  CHANGE_TYPE: цэвэр тест тэнцсэн, бодит тест fixture-д хоёр дахь төрөл нэмэгдсэний дараа.
ХААЛТТАЙ: DELETE · CREATE_* · PLACE_* · SAFE_AUTOFIX · AUTONOMOUS_SANDBOX.  Аудит: `%APPDATA%\RevitMcpAddin\intelligence\actions-<pid>.jsonl`.

## R4.2 — загварын санал (`RevitActionCandidate`) → детерминист `RevitActionBinder` → CONFIRM_WRITE; CHANGE_TYPE амьд (2026-09-15)

**Загварын гаралт бол ИТГЭМЖЛЭГДЭЭГҮЙ САНАЛ, эрх БИШ.**  Хариултын төгсгөлд `<<<MGLAI-ACTION>>>{json}<<<END-MGLAI-ACTION>>>`
блок ирвэл хуваалцсан хөдөлгүүр (`packages/mglai-common/src/turn/revitAction.ts`) хэлний засвар/dedupe/гэрээнээс ӨМНӨ
салгаж, хатуу схемээр (`schema_version` · `action_type ∈ {SET_PARAMETER, MOVE_ELEMENT, CHANGE_TYPE}` · `target.reference =
CURRENT_SELECTION` · `arguments` (мөр л) · `reason_mn` · `confidence`) шалгана; `action_id`/`binding_hash`/`preview_id`/
`doc_fingerprint`/`before`/`evidence`/`confirmed*`/`safety_level`/`proposal_source`/`element_id`/`unique_id` зэрэг
ИТГЭМЖЛЭГДСЭН түлхүүр байвал бүхэлд нь ХАЯГДАНА (`revitActionCandidateRejected`).  Хариултын текстээс блок арилна.

```
answer → extractActionCandidate → TurnResult.revitActionCandidate (untrusted)
 → RevitActionBinder.Bind(candidate, ШИНЭ snapshot, асуулт, docKey, issues)   [C#, детерминист]
     схем → CURRENT_SELECTION = яг НЭГ элемент (0 → NO_TARGETS, 2+ → TARGET_AMBIGUOUS, өөр lavlagaa → TARGET_NOT_GROUNDED)
     → утга/тоо/тэнхлэг ХЭРЭГЛЭГЧИЙН АСУУЛТАД байх ёстой (CANDIDATE_NOT_GROUNDED_IN_REQUEST · INSUFFICIENT_ACTION_PARAMETERS —
       «жаахан зөө» → 100 мм ТААМАГЛАХГҮЙ; MOVE яг нэг тэнхлэг, ≤ 500 мм; кирилл «У»/«Х» ≡ Y/X)
     → нормын засвар зөвхөн VERIFIED_NORM асуудалд (NORM_AUTHORIZATION_INSUFFICIENT — REVIEW_CANDIDATE эрх БИШ)
     → envelope: requested_by MODEL · proposal_source MODEL · safety_level ҮРГЭЛЖ CONFIRM_WRITE · evidence SELECTION+USER_INPUT
 → RevitActionValidator → ActionPreview (R4.1-ийн ижил хаалт) → карт «Загварын санал» → ХЭРЭГЛЭГЧ Apply (USER_UI) → Transaction.
```
Сервер тал (R3.5-B-ийн үргэлжлэл, `CROSS_OWNER_REVIEW_REQUIRED`): сонголт + мутацийн үг («болго», «зөө», «соли», «өөрчлөх санал»)
→ `REVIT_ACTION` intent; системийн prompt-д «ӨӨРЧЛӨЛТИЙН САНАЛ» дүрэм ЗӨВХӨН бэлгэдлийн placeholder-оор (CURRENT_SELECTION /
PARAMETER_NAME / VALUE; хуурамч id, утга БАЙХГҮЙ) + тэнхлэгийн зураглал (X→dx_mm, Y→dy_mm, Z→dz_mm); `revitForbidden`
REVIT_ACTION-д «өөрчиллөө/солилоо/зөөлөө/амжилттай…» гэсэн гүйцэтгэсэн мэт өгүүлбэрийг хориглоно.  Few-shot REVIT_*-д унтраалттай.

**CHANGE_TYPE-ийн fixture:** синтетик загварт баримтын ӨӨРИЙН хананы төрлийг `Duplicate` хийж `MGL-AI-TEST Wall 1 Test Alt`
(манифест `wall_types.walltype.alt`) үүсгэнэ — загварын файл, компанийн template, сан ХЭЗЭЭ Ч ашиглагдахгүй.  Preview
`valid_types` жагсаалттай; `CanonicalizeChangeType` нэрийг баримтын төрлүүдтэй тулгана.

**Бодит Revit (fixture 033938 → 043806, Qwen3-8B, TEST_ONLY gateway :39307):**
- CHANGE_TYPE: буруу утга → VALUE_SCHEMA_INVALID; байхгүй нэр → TYPE_NOT_FOUND; өөр категорийн төрөл → TYPE_INCOMPATIBLE; preview-ийн
  дараа өөр элемент хөдөлгөв → STALE_ACTION_PREVIEW; зориудын postcondition → ROLLED_BACK; USER_UI Apply → APPLIED/PASSED (audit 12/13,
  Wall 1 → alt 2784, дараа нь буцааж сольсон).
- AI SET_PARAMETER («…Comments-ийг 'AI санал тест' болгож өөрчлөх санал гарга.») → candidate → BOUND → карт → хэрэглэгч Apply →
  APPLIED, `requested_by: MODEL`, `confirmed_by: USER_UI` (audit 14–16, давтан 17–19).
- AI MOVE («…Y чиглэлд 100 мм зөөх санал гарга.»): эхний оролдлогод загвар `dz_mm:100` гаргасан → binder INSUFFICIENT_ACTION_PARAMETERS
  (audit 20 — хамгаалалт ажилласан); тэнхлэгийн зураглалыг prompt-д нэмсний дараа 7 туршилтаас 3-т `dy_mm:100` → BOUND → preview
  (10000, 8000) → (10000, 8100), 4-т блок ОГТ гаргаагүй (модель тогтворгүй — safety-д нөлөөгүй).  USER_UI Apply-ийн баталгаа
  ЭНЭ ээлжинд хийгдээгүй (dry-run preview л, бичилтгүй).
- «Энэ ханыг жаахан зөө.» → блок алга (санал ГАРГААГҮЙ); «Нормд тааруулж автоматаар зас.» → блок алга + татгалзсан тайлбар.
- VM: санал ч, хаялт ч ирээгүй ээлжинд өмнөх хаялтын мессеж УЛДДЭГ байсныг (хэрэглэгч «дахин гарлаа» гэж ойлгосон) засав —
  «Энэ ээлжинд загвар өөрчлөлтийн санал гаргаагүй».
ХААЛТТАЙ хэвээр: DELETE · CREATE_* · PLACE_* · SAFE_AUTOFIX · AUTONOMOUS_SANDBOX; загвар `confirmed=true` ХЭЗЭЭ Ч тавьж чадахгүй.
Тест: C# 80 (ActionBinderTests 8 + кирилл тэнхлэг), `packages/mglai-common` 33 (revitAction 5), backend mglai 446, parity 24.
