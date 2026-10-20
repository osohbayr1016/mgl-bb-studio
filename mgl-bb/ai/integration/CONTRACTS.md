# MGL AI · Гэрээний зураглал, merge эрсдэл, эзэн бүрийн шаардлага

> Session D · 2026-09-11 · `main`@`0df71a1`-ээс салсан `mgl-ai-integration` салаа.
> A/B/C-ийн WIP-ийг **уншсан, хөндөөгүй**.  Энэ файл нь checkpoint бүрд шинэчлэгдэнэ.

## 1. Гэрээнүүд (producer → consumer)

| # | Хил | Producer | Consumer | Схем / хувилбар | Эзэн | Failure semantics | Барих тест |
|---|---|---|---|---|---|---|---|
| 1 | `POST /norm` хариу | runtime `server.ts` ← A `retrieval/pipeline.ts` | FE `runtime.ts NormAnswer` → BE `localNorm.parseLocalNorm` (→ `/context` нотолгоо) · B `httpNormProviders.smokeRetrieval` · C `e2e.mjs` | хувилбаргүй; `status` 4 утга (цагаан жагсаалт ГУРВАН газар) | A | 503 = not_installed (алдаа БИШ); FE timeout ≠ offline | `drift` #2, `runtime.contract` |
| 2 | `GET /norm/info` | runtime | B `httpNormProviders.health/version`; FE (шууд биш) | `installed`, `documents[]`, `counts{}`; B `knowledge_version`/`registry_version`/`schema_version` ХҮЛЭЭЖ байна — runtime ӨГДӨГГҮЙ | A ↔ B | `installed:false` → NORM_NOT_INSTALLED | `drift` #6 (B merge-ийн дараа), `runtime.contract` |
| 3 | Dataset identity | A `datasetIdentity.ts` (ingest → `ai_documents.meta_json.dataset_identity`) ↔ A `norm/generated/manifest.generated.ts datasetSha256` | A `drift.ts` (`NORM_DATA_VERSION_MISMATCH`, ХАРААХАН БАЙХГҮЙ) · D `checkDataDrift` | `DATASET_IDENTITY_VERSION=1`; `RegistryManifest.version=1` | A | `/norm` эшлэл `dataset_sha256`-аа ХАРААХАН мэдээлдэггүй → тулгах боломжгүй | `compat` §14 (mock), amьд: `collectFromRuntime` |
| 4 | Загварын релиз | D1 `ai_model_releases` → `GET /runtime/manifest` | runtime `updater.ts` (`release_uid`, `artifact_sha256`, `minimum_runtime_version`, `kind`, `base_release_uid`) | хувилбаргүй мөр | backend (хуучин) | хоосон = «татах юм алга» | — (B-ийн updater тест) |
| 5 | Мэдлэгийн багц | D1 `ai_knowledge_packs` → `GET /runtime/knowledge-manifest` | `updater.ts KnowledgeManifestEntry` | хувилбаргүй | backend | ижил | — |
| 6 | Суулгагчийн бүрэлдэхүүн | `publish-installer.mjs` → R2 `mgl-ai-components.json` (НИЙТИЙН) | `installer/bootstrap.ps1` (node · llama.cpp · runtime-code) | хувилбаргүй, sha-гүй файл, `generated_at` л | хуучин | sha таарахгүй → татгалзана | — |
| 7 | **B шинэ** релизийн манифест | B `deployment/manifest.ts` | B `updatePlan.ts`, `installedState.ts` | `mgl-ai-release/1`; 6 бүрэлдэхүүн; `requires[]`; sha ЗААВАЛ | B | validate fail-closed (хагас манифест = бүхэлдээ татгалзана) | `drift` #6 |
| 8 | Суулгасан төлөв | B `installedState.ts` | B health/updatePlan; (ирээдүйд) `/runtime/heartbeat` | `mgl-ai-installed/1`; `installationId` = randomUUID (хардвер БИШ) | B | — | B |
| 9 | Health report | B `health.ts` | флот (heartbeat?), FE `RuntimeStatus`? — ХОЛБООГҮЙ | схемгүй; 5 facet × {READY,DEGRADED,OFFLINE,MISSING,REPAIR_REQUIRED,UNKNOWN}; нийт {READY,DEGRADED,REPAIR_REQUIRED,UPDATING} | B | REPAIR_REQUIRED fail-closed; COMPANY_BACKEND OFFLINE нь fatal БИШ | — |
| 10 | `POST /plan` · `POST /context` хариу | backend | FE `PlanResponse` / `AiContextResponse`, validator (`trusted_contract` tfc-1) | `mglai-sys-6`, `mglai-tools-1`, `tfc-1` | backend/C | — | `drift` #9 (түлхүүр ⊆) |
| 11 | `POST /generate` SSE | runtime | FE `streamGenerate`, C `e2e.mjs` | event ∈ {start,token,heartbeat,done,error}; `stop_reason` ∈ {stop,length,aborted,repetition,timeout}; 413 `context_overflow` | runtime | `repetition`/`timeout` = АМЖИЛТГҮЙ хариулт, хадгалахгүй | `runtime.contract` |
| 12 | Runtime variant | runtime `variantFromName` (НЭЭЛТТЭЙ: `employee-<size>b-<quant>`) | backend `version.ts RUNTIME_VARIANTS` (ХААЛТТАЙ) → `/messages isRuntimeVariant` → `ai_messages.runtime_variant` | — | backend | ⚠️ олонлогт байхгүй variant → NULL (2026-09-11 хүртэл 8B бүх хариулт NULL байв — ЗАСАВ) | `drift` #1 |
| 13 | Feedback → dataset | `/feedback` → `ai_feedback` (`review_state` машин) → `export-feedback.mjs` → `build_behavior_sft.mjs` | training | `review_state` CHECK; `pending→approved` шууд зам байхгүй | backend/C | — | backend unit |
| 14 | E2E харнесс | C `evaluation/lib/e2e.mjs` | дуудна: `/auth/login`, `/plan`, `/tool`, `/norm`, `/context`, `/generate`; FE `validator.ts`-ийг `registerHooks`-оор | — | C | secret-ийг `%LOCALAPPDATA%\MglAi\secret.txt`-ээс — CI-д боломжгүй | `verify --e2e` (reachability) |
| 15 | Хөтөч ↔ runtime тохиргоо | FE `localStorage mglai.port`, `DEFAULT_PORT` | runtime `MGLAI_PORT`/`DEFAULT_PORT`; B `httpNormProviders.baseUrl` | 39217 гурван газар | — | — | `drift` #4 |
| 16 | Control plane | runtime `DEFAULT_CONTROL_PLANE` ↔ FE `DEFAULT_API_HOST` | — | хос (одоо таарна) | — | — | `drift` #4 |

## 2. Тохиргооны эзэмшил (§25)

| Утга | Эзэн (ЭХ) | Хуулбар / хос | Тэмдэглэл |
|---|---|---|---|
| runtime порт | `ai/runtime/src/config.ts DEFAULT_PORT` / env `MGLAI_PORT` | FE `runtime.ts DEFAULT_PORT` + `localStorage mglai.port`; B `httpNormProviders.baseUrl`; C `--rt` | мөргөлдөөн шийдэх механизм АЛГА |
| engine порт | `DEFAULT_ENGINE_PORT` 39218 / `MGLAI_ENGINE_PORT` | `bench-responsiveness.mjs` | 39219 = embed (vectorLocal) |
| data dir | `MGLAI_DATA_DIR` ?? `%LOCALAPPDATA%\MglAi` (config.ts) | B `layout.ts resolveLayout` (ижил env, ижил өгөгдмөл) ✅ | runtime `state.json` (ModelManager) ≠ B `state/installed.json` — хоёр тусдаа файл, B `mirrorModel()`-оор тусгана |
| model path | ModelManager `models/state.json` (эх) | B installed.json `model` = ТУСГАЛ ✅; dev: `MGLAI_MODEL_PATH` (`dev-local`) | |
| knowledge path | `dataDir/knowledge/knowledge.sqlite` (config.ts) | B `layout.knowledge` ижил хавтас ✅ | |
| registry | Worker код (`norm/generated/`) | B `layout.registry` хавтас — PC-д ЮУ Ч ТАВИГДАХГҮЙ (загварчлалын зөрүү, §3.3) | |
| API origin | runtime `DEFAULT_CONTROL_PLANE`/`MGLAI_CONTROL_PLANE`; FE `DEFAULT_API_HOST` (`resolveApiHost` prod-д env-г ХАЙХРАХГҮЙ) | C `--api`, `MGLAI_EVAL_API` | |
| release channel | D1 `ai_runtime_installers.channel`, `ai_model_releases.channel`; B manifest `channel` ∈ {admin,canary,stable}; installed.json `channel` | — | D1 мөр ба B манифестын channel хооронд адаптер алга |
| telemetry level | БАЙХГҮЙ (heartbeat үргэлж явна) | — | B тодорхойлно |
| allowed origins | `DEFAULT_ORIGINS` + `MGLAI_ALLOWED_ORIGINS` (config.ts) | — | auth.ts 3-р давхарга |
| sampling | `engine/samplingPreset.ts` (ГАНЦ) | server.ts `undefined` дамжуулна ✓ (generateGuard test) | |

## 3. Загварчлалын зөрүү (шийдвэр шаардлагатай)

### 3.1 Дөрвөн релизийн метадата
`ai_model_releases` (D1, мөр бүр) · `ai_knowledge_packs` (D1) · `mgl-ai-components.json` (R2, bootstrap) · **`mgl-ai-release/1`** (B, шинэ).
`updater.ts` эхний хоёрыг ойлгоно; `bootstrap.ps1` гурав дахийг; `updatePlan.ts` дөрөв дэхийг Л.
**Санал (D):** `mgl-ai-release/1`-ийг КАНОН болгож, backend-д `GET /api/mgl-ai/runtime/release?channel=` нэмэх — D1 гурван хүснэгтээс манифест УГСАРДАГ адаптер, **`routes/mglAi.ts`-ээс ГАДУУР** тусдаа файл (`lib/mglai/releaseManifest.ts`) + нэг мөр mount.  `updater.ts` нь шинэ манифестыг `updatePlan`-аар уншдаг болтол хуучин хоёр гарц ХЭВЭЭР (backward-compatible).  Эзэн: **B** (producer + consumer хоёулаа B-ийнх).

### 3.2 `normRegistry` бүрэлдэхүүний газарзүй
A: Worker-ийн код (`generated/*.ts`, worker deploy-оор тархана).  B: PC-ийн бүрэлдэхүүн (`layout.registry`, `url:null`).
**Санал:** B манифестад `normRegistry.version` = A-ийн `manifest.generated.ts` `contentSha256`-ийн эхний 12 тэмдэгт (эсвэл `generatorVersion+documents[].datasetSha256` хэш), `url:null`, `meta.location:'worker'`.  PC дээр шалгах зүйл нь **`/norm/info documents[].dataset_sha256` ↔ Worker `/context`-ийн бүртгэл** — тэр нь A-ийн `drift.ts`.  B-ийн `checkCompatibility` энэ өгөгдлийн зөрүүг ХЭЗЭЭ Ч харахгүй гэдгийг B-ийн README-д бичих.

### 3.3 Гурван төлөвийн олонлог (§17)
B `FacetStatus` (6) · FE `ModelState` (7) · даалгаврын {READY,DEGRADED,OFFLINE,INCOMPATIBLE,REPAIR_REQUIRED}.
**Санал:** B `health.ts`-д `INCOMPATIBLE` нэмэх (compat зөрчил = тусдаа шалтгаан, REPAIR_REQUIRED биш — засвар нь «дахин тат» биш «өөр хувилбар»); FE `RuntimeStatus`-д facet→ModelState map (B эзэмшинэ, FE `runtime.ts`-д нэмэгдэнэ).

### 3.4 Мэдлэг чимээгүй устах зам (§15)
`retrieval/src/db.ts openKnowledgeDb`: `ai_schema_meta.version ≠ SCHEMA_VERSION` → `DERIVED_TABLES` (БҮХ мэдлэг) DROP.  Хөгжүүлэгчид зөв (дахин шингээнэ), флотод аюултай.
**Санал (A):** runtime горимд (`buildState`) зөрүүг **fail-closed** болгох — `/norm` 503 `knowledge_schema_mismatch` + updater-т «knowledge багц шинэчлэх» дохио; DROP нь зөвхөн `ai:ingest:norm` замд.  **B:** манифестын `knowledge.meta.schemaVersion` + `runtime.requires knowledge>=` эсрэг чиглэл.

## 4. Merge эрсдэл (§28)

| Файл | A | B | C | D | Эрсдэл | Ялагч / хук |
|---|---|---|---|---|---|---|
| `ai/package.json` scripts | ✎ (`ai:check`, `ai:test`, `ai:norm:generate`) | (магадгүй `ai:deploy*`) | — | ✎ (`mgl-ai:verify*`, `integration:*` — СҮҮЛИЙН мөрөнд, тусдаа hunk) | **HIGH** | Мөр бүр тусдаа нэр — текстээр нэгдэнэ; `ai:check`/`ai:test`-д B `deployment/test/**` нэмэх бол A-ийн мөр дээр |
| `ai/tsconfig.json` | ✎ бүхэл файл дахин форматлав + `norm-compiler/**` | `deployment/**` нэмэх ёстой | — | ✗ (өөрийн `integration/tsconfig.json`) | **HIGH** | A-ийн формат ялна; B нэг мөр `include`-д |
| `backend/src/routes/mglAi.ts` | `/context`-д drift/registry | манифест gateway бол | bug fix | ✗ | **HIGH** | Route бүрийн семантик эзэн; ШИНЭ route = тусдаа файл + `mountX()` |
| `ai/runtime/src/server.ts` | `/norm`, `/norm/info` хувилбар | health/installed | — | ✗ | **HIGH** | `/norm*` A, `/info`·`/update*`·health B; `/generate` хэн ч биш |
| `frontend/.../lib/runtime.ts` | `NormAnswer` шинэ талбар | `RuntimeInfo` health | — | ✗ | MEDIUM | interface тус бүр өөр эзэн |
| `backend/src/lib/mglai/localNorm.ts`, `currentness.ts` | ✎ | — | — | ✗ | LOW | A |
| `backend/src/lib/mglai/version.ts` | — | — | — | ✎ (RUNTIME_VARIANTS +2) | LOW | D-ийн 1 hunk |
| `ai/evaluation/*` | — | — | ✎ | ✗ | LOW | C |
| `CLAUDE.md`, `docs/mgl-ai/*.md` | ✎ | ✎ | ✎ | ✎ (README/CONTRACTS энд, CLAUDE.md-д 1 pointer) | HIGH | хэсэг бүр append-only, өөрийн гарчиг дор |
| `ai/deployment/**` · `ai/norm-compiler/**` · `backend/.../norm/**` · `ai/integration/**` | A | B | — | D | SAFE | |

## 5. Эзэн бүрд шаардлагатай өөрчлөлт

### A
1. `/norm` `citation`-д `dataset_sha256`, `dataset_id`, `dataset_version`; `/norm/info documents[]`-д ижил гурав + дээд түвшинд `schema_version` (= `SCHEMA_VERSION`), `retrieval_version`, `knowledge_version` (багцуудын sha-гийн хэш эсвэл манифестын version), `registry_version` — B `NormInfoBody` яг эдгээр нэрийг хүлээж байна; D `collectFromRuntime` ч мөн.
2. `openKnowledgeDb` схемийн зөрүүг runtime горимд fail-closed (§3.4).
3. `NORM_DATA_VERSION_MISMATCH`-ийг `/context` `local_norm.registry_drift:{expected,actual}` талбараар ил гаргах.
4. `status` олонлогт утга нэмэх бол `localNorm.ts STATUSES` + FE `NormAnswer` + `integration/contracts/runtimeApi.ts NORM_STATUSES` нэг коммитод (drift тест барина).
5. `ai/package.json`/`tsconfig.json` мөрөө B-тэй зөвшилцөж хамгийн сүүлд merge.

### B
0. **ЭЗНИЙ ШИЙДВЭР (2026-09-11) — ГАНЦ ИДЭВХЖҮҮЛЭЛТИЙН ЗАМ.**  `ai/deployment/src/activation.ts` нь бүрэлдэхүүний
   идэвхжүүлэлт/буцаалтын ЦОРЫН ГАНЦ хөдөлгүүр: staged артефакт шалгах → нийцэл/хэш → нөлөөлсөн бүрэлдэхүүнийг зогсоох →
   атомоор солих → health → known-good тэмдэглэх эсвэл rollback.  `updater.ts` нь ДЭЭД ТҮВШНИЙ оркестрлогч хэвээр (манифест
   шалгах, татах/staging) бөгөөд дараа нь activation.ts-ийг ДУУДНА.  `updater.ts` (`manager.activate/rollback`,
   `activateAdapter/rollbackAdapter`, мөр 397/404/467/473) ба `server.ts /model/activate` (мөр 1184/1192) дахь давхар
   идэвхжүүлэлт/буцаалтын логикийг ХАСАХ/шилжүүлэх.  D-ийн `drift.test.ts` §10 нь B merge хийгдмэгц үүнийг барина
   (activation.ts-ээс гадуур `.activate(`/`.rollback(` дуудлага = FAIL).
0b. **C-ийн GAP-027 (redaction.ts-ийг telemetry/feedback/diagnostics-д), GAP-028 (single-slot дараалал = health/UX төлөв, эвдрэл биш)** — §5d.
1. `mgl-ai-release/1`-ийн backend producer (§3.1) — B `routes/mglAiFleet.ts /fleet/release-manifest`-ээр БАРИГДСАН ✅; `index.ts`-д mount + `updater.ts`-ийг тэр манифест руу шилжүүлэх л үлдсэн.
2. `normRegistry` = Worker бүрэлдэхүүн гэж дахин загварчлах (§3.2).
3. `health.ts`-д `INCOMPATIBLE`; `FacetStatus→ModelState` map (§3.3).
4. `/runtime/heartbeat`-д `installation_id`, `knowledge_version`, `registry_version`, `adapter_version`, `health_summary` (healthSummary()) — D1 `ai_runtime_installs`-д багана (миграц B-ийн дугаарын блокоос).
5. `ai/tsconfig.json include`-д `deployment/**` — A-ийн форматын дээр; `ai:check`/`ai:test`-д `deployment/test/**`.
6. `channel` — D1 мөрийн `channel` ↔ манифестын `channel` адаптер.
7. `installer/bootstrap.ps1`-ийн `mgl-ai-components.json` → `mgl-ai-release/1` руу шилжих төлөвлөгөө (эсвэл хоёрыг үүсгэгч нэг скрипт).

### C
0. `scorecard.mjs` live probe + `perf-baseline` нь `:3000` хатуу — `MGLAI_API`-аас уншуулах; GAP-012/013 todo; GAP-029 бүтээгдэхүүний шийдвэр хүлээнэ.
1. `evaluation/lib/e2e.mjs`: `secret`, `rt`, `api`-г `MGLAI_DATA_DIR`/`MGLAI_PORT`/env-ээс — echo engine дээр CI-д ажиллах боломж (`verify --e2e`-ийн `eval:conv` одоо reachability-гээр л blocked).
2. Тайлангийн `identity` блокт `knowledge_sha`, `registry_content_sha`, `runtime_version` (`freeze-baseline.mjs`).
3. `ai_feedback` → regression case хувиргагчид `msg_uid` + `diag_json` + хувилбарын тамга хадгалагдахыг барих тест.
4. Red-team-д: `/metrics` (диагностик) хариу энгийн хэрэглэгчийн UI-д гарахгүй эсэх (FE `RuntimeStatus`).

### Repo (эзэнгүй)
1. ~~`backend/package-lock.json` ↔ `package.json` зөрчил~~ — **ЗАССАН 2026-09-11 (D, эзний зөвшөөрлөөр).**  Бодит шалтгаан хоёр: `agents@0.15.0`-ийн заавал peer `ai@^6`/`react@^19` lock-д байгаагүй + npm 11 optional peer `@cloudflare/ai-chat@0.11.0`-ыг (`agents>=0.17.1` шаарддаг, бидний 0.15-тай нийцгүй) татаж `ai@7` мөргөлдүүлдэг → `overrides {"@cloudflare/ai-chat":"0.8.0"}`; `wrangler` 4.83.0 (peer `workers-types@^4`) vs root `workers-types ^5` → `wrangler ^4.121.0` (5.20260804.1 pair).  `--force`/`--legacy-peer-deps` ХЭРЭГЛЭЭГҮЙ.  Нотолгоо: цэвэр `npm ci` ✓ (429 багц), tsc ✓, test 1238/1241 (3 өмнөх), `deploy --dry-run` ✓, `dev --local` ✓.  INSTALLATION хаалга одоо PASS.
2. `ai/training/readiness.mjs:221` хатуу Python зам (dev-only, warning).

## 5b. Дахин синк (2026-09-11, checkpoint 1-ийн дараа) — эзний WIP-ийн шинэ байдал

Уншсан, хөндөөгүй.  `npm run mgl-ai:merge-forecast -- --tree A=… --tree B=… --tree C=… --tree D=…`:
124 өөрчлөгдсөн файл, **давхцал 2** — `ai/package.json` (A+D), `ai/tsconfig.json` (A+B).  Миграцын дугаар давхцаагүй.

**B** (`mgl-ai-session-b`): `ai/deployment/src/` 16 модуль + `test/` 8 файл; `ai/runtime/src/server.ts`-д
`createDeploymentAgent` (buildState-д, унавал runtime үргэлжилнэ) + **`/deploy/health|health/last|state|telemetry|heartbeat|diagnostics`**;
backend `routes/mglAiFleet.ts` (**тусдаа файл** — `index.ts`-д ХАРААХАН mount хийгдээгүй), `lib/mglai/{fleet,releases,improvement}`,
миграц **0290** (`ai_fleet_devices`, `ai_release_manifests`) · **0291** (`ai_failure_candidates`, `ai_regression_candidates`,
`ai_sft_candidates`) · **0292** (`ai_model_candidates`, `ai_knowledge_releases`).  `GET /fleet/release-manifest` = §3.1-ийн
producer ✅.  Heartbeat нь `versions{app,runtime,model,knowledge,normRegistry,revit,release,last_known_good}` + `healthSummary` явуулна
(§20 ✅ флотын түвшинд).  ⚠️ Үлдсэн: `updater.ts` (хуучин D1 манифест) ба `activation.ts` (шинэ) ХОЁР шинэчлэлтийн зам зэрэг
оршино — аль нь ажилтны PC дээр ЖИНХЭНЭ идэвхжүүлэлт хийх вэ гэдгийг B тодорхойлж, нөгөөг нь унтраах.

**A** (`mgl-e-c` үндсэн tree): `retrieval/src/{citation,pipeline,search,normalize,datasetProfiles,ingest}.ts`, `datasetIdentity.ts`,
`test/docLock.test.ts` + fixtures, `norm-compiler/`, backend `norm/{registryTypes,generated/}`, `currentness.ts`, `normEntities.ts`.
Drift тест (MGL_AI_REPO=A-ийн tree): datasetIdentity v1 ✓, manifest sha ✓; `/norm/info`-д хувилбарын талбар ХАРААХАН алга.

**C** (`mgl-ai-session-c`): `ai/evaluation/production-readiness/{cases,lib(fakeWire,load),suites(intent-routing,
hallucination-contract,security-injection).test.mjs}` — загваргүй, `node --test`; backend `groundingGuard.ts` (+test),
`intent/lang/promptFrame/researchPlan/toolPlan/gateway-entities` засвар, **`routes/mglAi.ts`** (`/context`-д `applyGroundingGuard`),
frontend `validator.ts` (`EMPTY_AFTER_REPAIR`).  D-ийн `verify.mjs` эдгээр гурван suite-ийг `c:*` id-ээр бүртгэв (merge хийгдмэгц
автоматаар ажиллана; хүртэл BLOCKED_BY_C).

**Гэрээний шинэ хил (B):** `/deploy/health` (`HealthReport`), `/deploy/state` (`mgl-ai-installed/1`) — `contracts/runtimeApi.ts`-д
`DEPLOY_HEALTH`, `DEPLOY_STATE`; `runtime.contract.test.ts` B merge хийгдтэл `skip`.


## 5c. Нэгдсэн E2E smoke — хэмжсэн (2026-09-11, main@0df71a1 + D)

`verify --e2e` нь ЭНЭ tree-ийн `wrangler dev` (prod-copy D1, :3998) + echo runtime-ийг асааж, C-ийн `e2e.mjs`
клиентээр хөтчийн яг дарааллыг туулна (`test/e2e.smoke.test.ts`).  Загваргүй; хариултын чанар хэмжигдэхгүй.

| Кейс | Үр дүн | Тайлбар |
|---|---|---|
| Мэндчилгээ | PASS | plan CASUAL → context → echo → `show_confidence=false` |
| Компанийн өгөгдөл | **FAIL** | `query_entities` ажилласан ч `trusted_contract.answerMode='free'`, facts=0 → зохиомол тоо validator-оор өнгөрнө.  **C** `groundingGuard.ts` (WIP) яг үүнийг засаж байна; merge хийгдмэгц PASS болох ёстой. |
| Норм | PASS | локал `/norm` → `/context.local_norm` (УББ 12-01-01 1.6, NEEDS_HUMAN_REVIEW) → `/messages` эшлэл сервер дээр |
| **§18 offline-norm** | **FAIL** | `norm_answer: null` (runtime offline / мэдлэггүй / timeout — гурвуулаа ижил) → `answerMode='refusal'`, `noMatch=true` = «эх сурвалж олдсонгүй».  **Хайлт унасан ≠ олдсонгүй.**  Шаардлага: orchestrator `norm_answer → { unavailable: 'offline' · 'timeout' · 'not_installed' }`; backend `/context` тэр үед `retrievalNoMatch=false` + тусдаа `norm_unavailable` трейлер («Нормын сан энэ компьютерт хүрэхгүй байна»).  Эзэн: **C/A** (`routes/mglAi.ts /context`, `trustedFacts.ts`) + frontend orchestrator. |
| Follow-up | PASS | `conv_state_next` дамжиж, 2 дахь ээлж FOLLOW_UP |

C-ийн `eval:conv` (бодит Qwen3-8B, :39217) энэ tree-ийн backend дээр: бүтэц 21/22, унасан **H «норм NO_MATCH»** — лифтний
асуултад одоо refusal биш хариу гарч байна (10 баримттай локал сан өргөжсөнөөс хойш).  Эзэн C: алтан кейсийг шинэ сангаар
дахин баталгаажуулах.  `eval:company` 8/10 (бодит загварын хариулт; MODEL_EVAL).


## 5d. Session C production-readiness — хүлээн авалт (2026-09-11)

C-ийн worktree-г уншсан, хөндөөгүй.  C-ийн мэдээлсэн тоог **энэ машин дээр C-ийн tree-д дахин ажиллуулж
баталгаажуулав** (D-ийн хэмжилт, C-ийн scorecard-ын тоо биш):

| C suite (`evaluation/production-readiness/suites/`) | D-ийн дахин ажиллуулалт | Хаалганд орсон id / ангилал |
|---|---|---|
| intent-routing | 113 pass · 0 fail · 2 todo | `c:intent-routing` · UNIT |
| conversation-context | 9 pass · 0 fail | `c:conversation-context` · UNIT |
| units-numbers-language | 14 pass · 0 fail · 12 todo | `c:units-numbers-language` · UNIT |
| streaming-faults | 18 pass · 0 fail | `c:streaming-faults` · INTEGRATION |
| hallucination-contract | 16 pass · 0 fail | `c:hallucination-contract` · SECURITY |
| security-injection | 19 pass · 0 fail | `c:security-injection` · SECURITY |
| live-backend (`MGLAI_API`) | — (--e2e, энэ tree-ийн backend руу) | `c:live-backend` · E2E |
| `tools/dataset-lint` (`--strict`, `--root` = үндсэн tree-ийн `data-train-files`) | C: 14 багц · 6 алдаа | `c:dataset-lint` · MODEL_EVAL · эзэн **A** (өгөгдөл) |
| `tools/training-lint` (`--strict`) | C: BLOCKED (`ai/training/out` алга) | `c:training-lint` · MODEL_EVAL |
| perf-baseline (`MGLAI_API`/`MGLAI_RUNTIME`) | C: 11 pass (бодит runtime) | `c:perf-baseline` · PERFORMANCE · blocking:false |
| `groundingGuard.test.ts`, `redaction.test.ts` (backend) | C: 454/454 backend mglai | `backend:mglai` glob автоматаар |

C-ийн категорийн тоо (175/55/95/107/90) нь дээрх suite + backend/frontend unit-ийн НИЙЛБЭР — хаалганд suite бүр
тусдаа орно; C-ийн `npm run ai:readiness` (scorecard.mjs) нь C-ийн ӨӨРИЙН нэгтгэгч хэвээр, D-ийн `verify.mjs` түүнийг
ДАХИН ажиллуулахгүй (давхардал).  ⚠️ C-ийн scorecard `pct` тооцдог — D-ийн хаалга хувь ХЭЗЭЭ Ч тооцохгүй (§7 мандат).
⚠️ C-ийн `scorecard.mjs` live probe + `perf-baseline` нь `:3000`-ыг хатуу бичсэн (`MGLAI_API` env байгаа ч probe-д
хэрэглэдэггүй) — өөр tree-ийн WIP backend руу хэмжилт явах эрсдэл; D-ийн `--e2e` нь `MGLAI_API=:3998` өгдөг.  C-д: probe-ыг
`MGLAI_API`-аас уншуулах (жижиг).

### GAP-ийн чиглүүлэлт (D хэрэгжүүлэхгүй)

| GAP | Хэнд | Утга | Хаалганд хэрхэн тусах |
|---|---|---|---|
| GAP-023 (P1) | **A** | БД 21-101-12 + СНиП багцын `knowledge_chunks` мөр 28–31 Python-repr текст (`text_mn` нь `['…']` хэлбэр) | `c:dataset-lint` FAIL (6 алдаа) → MODEL_EVAL blocking |
| GAP-032 (P1) | **A** | «Лифтний хонгилын хананы галд тэсвэрлэх хугацаа» → 31-23-12-ийн хамааралгүй хэсэг `supported`; C-ийн conv-e2e кейс H, D-ийн `eval:conv` H хоёулаа унана | `eval:conv` E2E FAIL (одоо) |
| GAP-022 (P2) | **A** | `extractNormEntities`: `2 200 мджм2`, `g ni 2200`, `1.800`, `1800,5` → undefined | `c:units-numbers-language` 12 todo → A засмагц todo→pass |
| GAP-024/025/026 | **A** | retrieval-test ↔ SFT давхардал (902 асуулт) · `verification_status` цагаан жагсаалт ↔ GOLD v3 утга (`registered_full_text` 296, …) зөрүү · тестийн id багц хооронд давхцах (17 хос) | `c:dataset-lint` warning/error |
| GAP-027 | **B** (холболт) | C-ийн `backend/src/lib/mglai/redaction.ts`-ийг telemetry (heartbeat payload), feedback snapshot, `/deploy/diagnostics`, лог экспортод холбох — нууц/PII нь флот руу явахгүй.  ⚠️ B-ийн `deployment/src/diagnostics.ts` ба C-ийн `redaction.ts` хоёулаа «ариутгах» ойлголт — НЭГ хэрэгжүүлэлт (C-ийнх backend, B-ийнх runtime — B нь C-ийн дүрмийг runtime тал руу хуулбарлахгүй, `ai/deployment`-д импортлох боломжгүй тул ГАНЦ эх сурвалжийн жагсаалтыг `ai/` дор хуваалцах шийдвэр хэрэгтэй) | `int:secrets` (D) sentinel-ээр барина; B merge-ийн дараа D `/deploy/diagnostics` sentinel тест нэмнэ |
| GAP-028 | **B** | llama-server single-slot: зэрэгцээ 4 хүсэлт дараалалд орж first-token p90 5 с+ — энэ нь ЭВДРЭЛ биш ДАРААЛАЛ; `/deploy/health`, флотын `health`, FE `ModelState=BUSY`-д «дараалалд» гэж ил гаргах (REPAIR_REQUIRED/OFFLINE БИШ) | `c:perf-baseline` blocking:false; B `health.ts` INCOMPATIBLE-тэй хамт `QUEUED` төлөв |
| GAP-012/013 (P3) | C | англи `standard`, «өргөн» → NORMATIVE худал эерэг | C-ийн todo |
| GAP-030 | C/repo | backend бүтэн `npm test`-ийн 3 өмнөх унасан тест (миграцын дугаар/тээвэр/templateNote) | `backend:all` warning (D) |

### Бүтээгдэхүүний / нээлттэй шийдвэр (алдаа гэж ЧИМЭЭГҮЙ хаахгүй)

| # | Асуулт | Одоогийн байдал | Хаалганд |
|---|---|---|---|
| GAP-014 | `describe_system` хэрэгсэл захиалагчид харагдах уу (`toolsForMode('client')` агуулна — дотоод бүтэц задрах) | OPEN, SHARED | тэмдэглэл; эзний шийдвэр хүртэл ХААХГҮЙ |
| GAP-029 | Офлайн кэш (backend хүрэхгүй үед сүүлийн ERP хариу/данныг харуулах) — `promptFrame dataFreshness` мөрийг frontend хэзээ ч илгээдэггүй | NOT_IMPLEMENTED | `Feedback`/`General AI` тэмдэглэл |
| Revit | Revit add-in ↔ MGL AI E2E холболт | NOT_IMPLEMENTED (C scorecard ч мөн) | §35 `Revit = NOT_IMPLEMENTED` |

## 5e. Merge overlap — C vs A/B (2026-09-11, hunk-ийн мөрийн муж дээр)

`merge-forecast`: 5 tree, давхцал — `CLAUDE.md` (B+C+D), `ai/package.json` (A+C+D), `orchestrator.ts` (A+C), `MglAiPage.tsx`
(A+C), `intent.ts` `turn.ts` `turnPlan.ts` `promptFrame.ts` `validator.ts` (A+C), `runtime.ts` (B+C), `version.ts` (A+D),
`tsconfig.json` (A+B), `mglAi.ts` (A+C).  Миграцын дугаар давхцаагүй (B 0290–0292).

| Файл | A hunk (base мөр) | C hunk | Текстийн эрсдэл | Семантик шийдэл |
|---|---|---|---|---|
| `backend/src/routes/mglAi.ts` | 45–52, 125–140, 523–585, 696, 756–800, 826–849, 894–924, **966–988**, 1000, 1232–1299 | 64, **975–989**, 1265 | **ХАТУУ мөргөлдөнө** (/context return блок) | ХОЁУЛАНГ: `trusted_contract: applyGroundingGuard(buildTrustedContract({ …A-ийн шинэ оролт (registry drift, currentness)… }), {intent, toolResults, revitContextPresent, responseLanguage})` — C-ийн ГАДУУР бүрхүүл, A-ийн ДОТООД оролт.  Мөр 64 (import) + 1265 (диаг) нь C-ийнх, хадгална. |
| `frontend/.../lib/validator.ts` | 2, 40–81, 136–137, 213–290, 325–328, **389–391**, 445, **475–499** | **67**, **385**, **483** | ХАТУУ мөргөлдөнө (3 газар) | C: `EMPTY_AFTER_REPAIR` код + NOTICE + `enforceContract` төгсгөлийн салаа — гурвуулаа НЭМЭЛТ; A-ийн validator өөрчлөлт (currentness/citation) дээр C-ийн салааг үлдээнэ.  `check-ai-validator` (29) + C hallucination (16) хоёулаа ногоон байх ёстой. |
| `frontend/.../lib/orchestrator.ts` | 44–122, 210, 358, 471–521, 572, **595–600**, 779–845, 1102–1195 | 305, **531**, 547, **615**, 857, 921–934, 1000–1044 | ДУНД (521↔531, 600↔615 зэргэлдээ) | C = алдааны сэргэлт/fault хук (`streaming-faults` 18 тест хамгаална); A = норм/registry урсгал.  Хоёулаа `runTurn` дотор өөр шатанд — А-ийн шатыг, C-ийн catch/notice-ийг хадгална. |
| `frontend/.../MglAiPage.tsx` | 85, **318–322**, 500, 515, 696 | 26, **321** | ХАТУУ (321) | Гараар: A-ийн UI + C-ийн нэг мөр (aiErrors хук). |
| `backend/src/lib/mglai/intent.ts` | 185 | 65–177 (85 ins) | текст мөргөлдөхгүй | C-ийн ангилагч (intent-routing 113 тест хамгаална) + A-ийн 185 (норм таних) — хоёулаа орно; A-ийн нэмэлт C-ийн шинэ дүрэмтэй зөрөх эсэхийг `c:intent-routing` шалгана. |
| `backend/src/lib/mglai/turn.ts` | 35, 454 | 126, 465, 487 | БАГА (454↔465) | хоёулаа нэмэлт |
| `backend/src/lib/mglai/turnPlan.ts` | **20**, **26**, 204, 240, 249 | **18**, 220 | import мөр мөргөлдөнө | хоёр import-ыг хадгална |
| `backend/src/lib/mglai/promptFrame.ts` | 357–470 | 506 | үгүй | хоёулаа |
| `frontend/.../lib/runtime.ts` | — | (C) | B `RuntimeInfo`, C `NormResult`/алдаа | interface тус бүр өөр эзэн — хоёулаа |
| `ai/package.json` | 16, 33, 41 (ai:check/ai:norm:generate/ai:test) | 36–41 (readiness/lint/perf) | зэргэлдээ | бүх мөрийг хадгална (нэр давхцахгүй); D-ийн мөрүүд төгсгөлд |
| `CLAUDE.md` | (A ?) | 1222 (+38, MGL AI хэсэгт) | B/D төгсгөлд | append-only; хэсэг бүр өөрийн гарчиг |

**Дүрэм:** shared файл дээр «нэг салааг бүхлээр нь авах» ХОРИОТОЙ — C-ийн хук нь регрессийн тест (intent-routing,
streaming-faults, hallucination, validator) -ээр хамгаалагдсан тул merge-ийн дараа `mgl-ai:verify --full` дээр `c:*` бүгд
PASS, A-ийн `ai:retrieval`/`ai:norm-compiler`/`eval:norm` PASS байх нь merge зөв болсны ЦОРЫН ГАНЦ нотолгоо.


## 5f. Эзний шийдвэрүүд (2026-09-11, checkpoint 2) — merge дараалал, хаалт, GAP-027

**Merge ХАРААХАН ХИЙХГҮЙ.**  A эцсийн checkpoint-доо, B эцсийн hardening-даа хүртэл хүлээнэ.  Дараа нь
**A → C → B**: A нь `/context`, TrustedNormResult, нормын урсгал, validator-ын ЭЦСИЙН семантикийг тогтооно; C-ийн хук
A-ийн эцсийн семантик дээр БҮРХҮҮЛ/нэмэлт хаалт болж нийлнэ (файл солихгүй); B хамгийн сүүлд (deployment/runtime/
control-plane — үндсэн AI хүсэлтийн замд семантик эзэмшил хамгийн бага).  Зөрчилтэй файлыг нэг салаанаас БҮХЛЭЭР авахгүй;
үр дүнг `mgl-ai:verify --full` + A/C/B-ийн өөрсдийн suite-ээр нотолно.  Эзэн бүр merge-ийн өмнө ЗӨВХӨН өөрийн хянасан
ажлаа өөрийн салаанд коммитлоно (хамааралгүй staged файлгүй); push/deploy үгүй.

**Ил үлдэх хаалтууд:** GAP-032 — A · C-ийн хатуу давхцал (`mglAi.ts`, `validator.ts`, `MglAiPage.tsx`, `orchestrator.ts`)
— зөвхөн A эцсийн болсны ДАРАА · B-ийн runtime update/restart hardening — эцсийн интеграцын ӨМНӨ · Revit AI —
`NOT_IMPLEMENTED`, далдаар «бэлэн» гэж тооцохгүй.

### GAP-027 — НЭГ канон redaction (хэрэгжүүлсэн, D)

`packages/mglai-common/` — runtime-agnostic цэвэр TypeScript багц (`@mgl/mglai-common`, `lib: ES2023`, `types: []` — Node/
Worker/DOM API импортлоход tsc унана; `common:tsc-agnostic` suite барина).  `src/redaction.ts` = Session C-ийн алгоритм
(канон) + B-ийн `SECRET_VALUE_RES` хоёр хэв маягийг нэгтгэсэн (`secret_kv` доод урт 8→6); `redactText` = B-ийн нэрээр
drop-in.  C-ийн 7 тест ХЭВЭЭР + B-ийн 4 кейс → `packages/mglai-common/test/redaction.test.ts` (11).

| Хэрэглэгч | Холболт | Төлөв |
|---|---|---|
| backend (Worker) | `backend/package.json` `"@mgl/mglai-common": "file:../packages/mglai-common"` (symlink; `npm ci` ✓ 430 багц); `backend/src/lib/mglai/redaction.ts` = `export * from '@mgl/mglai-common/redaction'` (алгоритмгүй).  tsc ✓ (Bundler resolution, node_modules-ээр rootDir-ийн гадна), esbuild ✓ (`packages/mglai-common/src/redaction.ts` bundle-д орно, хэмжсэн).  `redaction.consumer.test.ts`: re-export ≡ канон (===). | ✅ D |
| ai/deployment (Node, B) | `ai/deployment/src/telemetry.ts`: `SECRET_VALUE_RES` + өөрийн `redactText`-ийг ХАСЧ `export { redactText } from '../../../packages/mglai-common/src/redaction.ts'` (ai tsconfig NodeNext, `.ts` өргөтгөл; `ai/package.json`-д хүрэхгүй — тэр нь A/C/D-ийн халуун файл).  `FORBIDDEN_KEY_PARTS`, telemetry түвшин, `findSensitiveKeys` = БОДЛОГО, B-д ХЭВЭЭР. | ⏳ B (merge-ийн дараа) |
| хөтөч | хэрэгтэй бол `../../../../packages/mglai-common/src/redaction.ts` (DOM хамааралгүй) | — |

**Хэмжсэн зөрүү (B-ийн одоогийн `redactText` vs канон, cross-consumer sentinel):** B-ийнх JSON `api_key:"…"` хашилттай утга,
sentinel (`SECRET_TEST_TOKEN…`), имэйл/утас, `sk-ant-`/AKIA түлхүүр, PEM блокийг МАСКАЛДАГГҮЙ (`MGL_AI_REPO=<B tree>
node --test integration/test/redaction.crossConsumer.test.ts` — 4 sentinel зөрөв).  Канон руу шилжмэгц
`int:redaction-cross` (SECURITY) нь `redactText === canon.redactText` (хуулбар биш) + гаралт тэнцүү гэдгийг барина.

⚠️ **Merge (A→C→B) дээр:** C-ийн `backend/src/lib/mglai/redaction.ts` (бүтэн алгоритм) ↔ D-ийн re-export → **D-ийнх ялна**;
C-ийн `redaction.test.ts` нь `./redaction.ts`-ээр re-export-ыг ачаалж канон дээр ажиллана (кейс бүр багцын тестэд ч бий).


## 5g. Дахин синк 2026-09-14 — A FINAL (main), B ХӨЛДСӨН (cc3b27d), C WIP; merge-ийн ХЭМЖСЭН туршилт

**Төлөв:** A эцсийн pass `main`-д (`a2f6c4b`, `01c1166`; main одоо `bbc7a92`) · B `cc3b27d` (`mgl-ai-employee-deployment`,
цэвэр tree, миграц 0290–0294) · C `mgl-ai-production-readiness` @dada0b1, 22 файл **uncommitted** (эзний §3: C өөрийн
салаанд коммитлох ёстой) · D `mgl-ai-integration` @7e3895b+.  Merge ХИЙГЭЭГҮЙ (зөвшөөрөл хүлээнэ).

**Туршилтын merge (scratchpad `int-dryrun`, түр салаа `tmp/int-dryrun`, БОДИТ салаа хөндөгдөөгүй, дараа нь устгана):**
`main(A)` → `+D` (зөрчилгүй) → `+C diff --3way` → `+B cc3b27d`.  Хэмжсэн зөрчил:

| Алхам | Файл | Зөрчил | Шийдэл (C = A-ийн эцсийн семантикийн БҮРХҮҮЛ; B = хамгийн сүүлд) |
|---|---|---|---|
| A+D | — | 0 | цэвэр |
| +C | `backend/src/routes/mglAi.ts` | 2 (import; `/context` `trusted_contract` блок) | `applyGroundingGuard(buildTrustedContract({ …A-ийн ЭЦСИЙН оролт: trustedNorm, normRetrievalFailed, normCodeAliases, evidenceNumbers, retrievalNoMatch(attempted && !failed — P0-14)… }), {intent, toolResults, revitContextPresent, responseLanguage})` — хоёр import хадгална |
| +C | `backend/src/lib/mglai/intent.ts` | 1 (нормын regex багц) | A-ийн `g`-regex (`g ni/нь/=/:` + зайтай нэгж, GAP-022) + A-ийн МДж regex; **ангиллын regex нь C-ийнх** `[вv][1-4]` — A-ийн `[вvааббгд][1-4]` нь «а1 формат», «д1 хуудас»-ыг норм гэж ХУДАЛ таньдаг (C хэмжсэн; `c:intent-routing` 113 барина) |
| +C | `frontend/.../MglAiPage.tsx` | 1 (түүхийн шүүлт) | A-ийн `messagesRef.current` (хуучин closure-ийн засвар, P0-13) + НЭГДСЭН шүүлт: `role==='user' \|\| (!error && !errorShape && !isInvalidAnswer(errorShape) && !incomplete && content)` — C-ийн `isInvalidAnswer` import |
| +C | `frontend/.../lib/orchestrator.ts` | 1 (stopReason жагсаалт) | нэгдэл: `repetition \| timeout \| template (A) \| interrupted (C)` |
| +C | `CLAUDE.md` | 1 (127 мөр) | хоёуланг хадгална (A-ийн хэсэг, дараа нь C-ийн хэсэг) |
| +C | `backend/src/lib/mglai/redaction.ts` | add/add | **D-ийн re-export ялна** (§5f); C-ийн `redaction.test.ts` re-export-оор канон дээр ажиллана ✓ |
| +C | validator.ts · turn.ts · turnPlan.ts · promptFrame.ts · lang.ts · toolPlan.ts · researchPlan.ts · entities.ts · aiErrors.ts · runtime.ts · `ai/package.json` | 0 | 3-way цэвэр |
| +B | `ai/package.json` | 2 | `ai:check`/`ai:test` = runtime + retrieval + norm-compiler + deployment дөрвөн glob; A-ийн `ai:dataset:repr`, B-ийн `ai:deploy:*`/`ai:supervise` бүгд |
| +B | `ai/tsconfig.json` | 1 | `include` = runtime · retrieval · norm-compiler · deployment (A-ийн формат) |
| +B | `ai/runtime/src/server.ts` | 3 (`buildState` мэдлэгийн сан) | **ХОЁУЛАА**: B-ийн `resolveKnowledgeDb(resolveLayout(...))` заагчаас `knowledgePath` + A-ийн `openKnowledgeDb({ path: knowledgePath, readOnly: true })` + `knowledgeSchema` (503 схем зөрвөл); state-д `knowledgeSchema` + `knowledgePath` хоёулаа |
| +B | `CLAUDE.md` | 1 (28 мөр) | хоёуланг |
| +B | бусад 60 файл | 0 | цэвэр |

**Merge-ийн дараах ЗААВАЛ алхмууд (нэгтгэсэн tree дээр хэмжсэн):**
1. `ai/retrieval/test/docLock.test.ts:212` — A-ийн guard regex `openKnowledgeDb\(\{ path: cfg\.knowledgeDb, readOnly: true \}\)` нь B-ийн
   `knowledgePath`-тай зөрнө → `path: (?:cfg\.knowledgeDb|knowledgePath)` (A-ийн зорилго — readOnly — хэвээр).
2. `cd backend && npm run gen:system-catalog` — C/A-ийн цэс/i18n өөрчлөлт → `systemCatalog.generated.ts` дахин үүсгэх
   (`systemCatalog.test.ts --check` унаж байсан, дахин үүсгэсний дараа backend mglai **531/531**).
3. `npm ci` (backend) — `@mgl/mglai-common` symlink (D); junction-той scratch-д `int:redaction-cross`-ийн `===` шалгалт
   модулийн зам зөрсөн тул унасан (артефакт; бодит checkout-д D-д PASS).
4. **Миграцын дугаарын мөргөлдөөн:** үндсэн tree-ийн uncommitted `backend/migrations/0290_progress_latest_indexes.sql`
   (Cloudflare зардлын аудит, өөр агент) ↔ B-ийн `0290_mgl_ai_fleet.sql` (коммитлогдсон).  D1 нэрээр эрэмбэлдэг тул хоёулаа
   apply болно, гэхдээ репогийн «дугаарын блок» дүрэм зөрчигдөнө — **эзний шийдвэр: аль нь 0295 болох вэ** (санал: uncommitted
   0290_progress_latest_indexes → 0295, учир нь B-ийнх коммит + миграц бүр өмнөхөө лавладаг).

**Нэгтгэсэн tree дээрх `mgl-ai:verify --full` (2026-09-14):** ai runtime 111 · retrieval 74 · norm-compiler 5 · **deployment 83** ·
backend mglai 531 · backend releases 28 · fe check-ai 110 · common redaction 11 · runtime-contract 14 · compat 8 · gate 7 ·
typecheck ×4 ✓ · **C бүх suite ✓** (113/9/14/18/16/19) · dataset-lint ✓ · secrets/auth/visibility ✓ · clean-machine ✓.
**Үлдсэн улаан:** `int:drift` §10 — B `cc3b27d` идэвхжүүлэлт/буцаалтыг activation.ts-д НЭГТГЭЭГҮЙ (`updater.ts:408/415/478/484`,
`server.ts:1328/1336`; эзний шийдвэр §5f — B-ийн эцсийн hardening-д); `int:redaction-cross` — B `telemetry.ts` канон руу
заагаагүй (GAP-027 холболт, B); `backend:all` 3 өмнөх (warning).

**Нэгтгэсэн tree дээрх `--e2e` (богино зам `C:\Users\User\project\mgl-int-dryrun`, салаа `tmp/int-dryrun` — ТҮР, устгаж болно):**
`int:e2e-smoke` **6/6** (ерөнхий · ERP grounded — C-ийн groundingGuard · норм `local_norm` + `dataset_sha256` + drift `not_applicable` ·
**§18 runtime_down → `answer_contract.kind = norm_unavailable`, `noMatch=false`** — A-ийн P0-14 засвар хэмжигдэв · follow-up
NEW_TOPIC→FOLLOW_UP · тайлан) · `c:live-backend` **10/10** · `eval:norm` (A GOLD) PASS · `eval:conv` (C, бодит Qwen3-8B) PASS —
2026-09-11-д унасан кейс H (GAP-032) одоо тэнцэв · `eval:company` **детерминист бус**: 6/10, 8/10 (бодит загвар), 3 дахь гүйлтэд
workerd «crashed unexpectedly» ×2 гэсэн лог гарсан — дараа нь ОЛСОН ШАЛТГААН: D-ийн өөрийн цэвэрлэгээний алхам зэрэгцээ
`taskkill workerd.exe` хийсэн (wrangler түүнийг «crash» гэж бүртгээд дахин асаадаг); 24 plan/tool/context хүсэлтийн ачааллын
шалгалт 0 crash.  miniflare 5.20260804.1-alpha (wrangler 4.121) тогтворгүй гэх нотолгоо ОДООГООР АЛГА, гэвч alpha тул релизийн
өмнө `--e2e`-г цэвэр орчинд дахин хэмжинэ.
⚠️ Scratchpad-ын урт зам (257 тэмдэгт) дээр D1 «internal error» өгдөг — MAX_PATH; dry-run-ыг богино зам руу нүүлгэв.

**§4/§5 — `NormResultSummaryProvider` адаптер (D, хэрэгжүүлсэн):** `backend/src/lib/mglai/improvement/trustedSummaryFromDiag.ts` —
A-ийн `/messages` `diag_json.norm` (`kind, verification, authoritative, document, records, calculator`) + гэрээний diag (`mode, final,
violations`) → B-ийн `TrustedResultFeedbackSummary` (schemaVersion 1); хөдөлгүүр/validator ДАХИН ажиллуулахгүй (Amendment B), текст
агуулахгүй, B-ийн `sanitizeTrustedSummary` хилээр дахин ариутгагдана; §18 ялгаа хадгалагдана (`retrieval_failed` ≠ `noMatch`).
8 тест.  **B-ийн холболтын хук** (нэгтгэлд, `routes/mglAiFleet.ts` — B-ийн файл, 3 мөр): `NULL_TRUSTED_SUMMARY_PROVIDER`-ийг
`diagTrustedSummaryProvider(c.env.DB).summaryForMessage(...)`-оор солино (dry-run дээр хийж backend tsc ✓, mglai 539/539 ✓).

**Гэрээний өөрчлөлт (A final):** `/norm` citation-д `dataset_sha256`, `source_url` (`runtimeApi.ts NORM_CITATION`-д нэмэв);
backend `norm/drift.ts` бүртгэлтэй тулгана ✓ (§3.2-ийн PC-талын шалгалт БИЕЛСЭН); tfc **`tfc-2`** (frontend `'tfc-1' | 'tfc-2'`
union — `collect.ts` union-aware болов); `mglai-sys-7`; `/messages` нь HMAC гарын үсэгтэй `TrustedNormResult` +
`trusted_norm_seq` хүлээж авна (Amendment B) — E2E smoke нормын мессежийг гарын үсэггүй хадгалдаг тул тэр зам одоо
«гарын үсэггүй → эшлэл/итгэл тэр объектоос гарахгүй» гэж ажиллана (шалгагдана).  `/norm/info`-д `knowledge_version`/
`registry_version`/`schema_version` ХЭВЭЭР АЛГА (B-ийн `version()` null) — A/B-д нээлттэй.


## 5h. ЭЦСИЙН НЭГТГЭЛ — `mgl-ai-integration-final` (2026-09-14, worktree `C:\Users\User\project\mgl-int-final`)

**Дараалал (эзний §13):** D snapshot `mgl-ai-integration`@0bf89d2 → `main`@160b758 (A final `a2f6c4b`+`01c1166`; дараах 3 коммит
teams/SW, MGL AI файл хөндөөгүй) **0 зөрчил** → C `fda2875` **5 зөрчил + 1 add/add** (§5g-ийн шийдлүүд яг хэвээр) → B
`e9819a5` (⊃ `cc3b27d`) **4 зөрчил** (package.json ×2, tsconfig, server.ts ×3, CLAUDE.md) → D адаптер/засварууд.
`tmp/int-dryrun` (хуучин B 0290–0294) нь ТҮҮХ — эх сурвалж болгож ХЭРЭГЛЭЭГҮЙ.

**Миграц:** B = **0295–0299** (`0295_mgl_ai_fleet` · `0296_mgl_ai_failure_inbox` · `0297_mgl_ai_release_registries` ·
`0298_mgl_ai_message_install_context` · `0299_mgl_ai_fleet_running_versions`); үндсэн tree-ийн uncommitted `0290_progress_latest_indexes`
хөндөгдөөгүй, энэ салаанд байхгүй.  `migrationSchema.test.ts`-ийн 3 унасан тест нь 0200/0243/0244/0245-ын ӨМНӨХ давхардал (repo, MGL AI биш).

**Семантик шийдэл (эзний §9–10, бүгд хэрэгжсэн):** `mglAi.ts` = C `applyGroundingGuard(A buildTrustedContract(эцсийн оролт))`;
`intent.ts` = A g/МДж/«1.800 хоёрдмол» + C `[вv][1-4]` ангилал (`c:intent-routing` 113 ✓); `orchestrator.ts` = template+interrupted;
`MglAiPage.tsx` = A `messagesRef` + C `isInvalidAnswer`; `validator.ts` 3-way цэвэр (A tfc-2 + C EMPTY_AFTER_REPAIR); `server.ts` =
B `knowledgePath` заагч + A `readOnly`/`knowledgeSchema`/503 + B `/deploy/*`; `docLock.test.ts` guard `(?:cfg\.knowledgeDb|knowledgePath)`.

**D-ийн нэгтгэлийн ажил (e102722):**
- Канон redaction SHA/утасны алдаа (B олсон): `phone` regex `(?<!\d)…(?!\d)` → `(?<![0-9A-Za-z])…(?![0-9A-Za-z])` — 64-hex
  доторх «…f84894884e…» утас гэж баригдахаа болив; JWT/base64/hex биеийн доторх 8 орон ч мөн; кирилл/цэг таслал/хашилтын хажуух утас
  хэвээр баригдана; secret/token/hex_token дүрэм өөрчлөгдөөгүй.  `REDACTION_REVISION = 2`.  +6 тест (24/24); backend consumer ✓, B telemetry ✓,
  cross-consumer ✓ (3/3, B `telemetry.ts` канон функцтэй `===`).
- `/norm/info` хувилбар (§8): runtime нь A-ийн `datasetIdentityOf`-оор `documents[].dataset_id/version/sha256`, `schema_version`
  (`ai_schema_meta`), `runtime_schema_version`, `knowledge_version` = `kf1:<sha256(эрэмбэлсэн doc=sha мөрүүд)[:16]>` гаргана;
  backend `GET /api/mgl-ai/norm-registry` (`routes/mglAiNormRegistry.ts`, тусдаа файл) A-ийн `manifest.generated.ts`-ийг `rf1:` хурууны
  хээтэй wire болгоно; `packages/mglai-common/src/normIdentity.ts` (`compareDatasetIdentity`, хоёр талын ганц харьцуулагч);
  `ai/deployment/src/normVersion.ts` B-ийн `httpNormProviders`-ийг бүрхэж `version()` = {kf1, rf1, schema}, `health()` =
  `NORM_DATA_VERSION_MISMATCH` (fatal → NORM facet READY биш) · `NORM_SCHEMA_MISMATCH` (§15) · `NORM_REGISTRY_UNREACHABLE` (ok, детайл) ·
  `NORM_DATA_VERSION_UNKNOWN` (sha-гүй хуучин шингээлт).  `agent.ts`-д 1 хук.  Шинэ хувилбарын эх сурвалж ҮГҮЙ — хоёр тал A-ийн
  `datasetIdentity()`.
- Fleet sync: `NULL_TRUSTED_SUMMARY_PROVIDER` → `diagTrustedSummaryProvider(c.env.DB)` (A diag → B хураангуй).
- `gen:system-catalog` нэгтгэсэн эх кодоос; `npm ci` ×3 цэвэр (backend 430, ai 3, frontend 531).

**`mgl-ai:verify --full` (e102722):** UNIT runtime 111 · retrieval 74 · norm-compiler 5 · **deployment 102** · backend mglai **539** ·
releases 36 · fe check-ai 110 · common redaction 24 · C intent 113 / conv 9 / units 14 / streaming 18 / hallucination 16 / injection 19 ·
dataset-lint ✓ · INTEGRATION contract 14 · drift **18/18** · compat 8 · gate 7 · typecheck ×4 ✓ · SECURITY secrets/auth/visibility/
redaction-cross ✓ · INSTALLATION clean-machine 5 ✓ · **BLOCKING 0**; warning: `backend:all` 3 өмнөх (0200/0243/0244/0245 давхардал,
тээвэр, templateNote).

**`mgl-ai:verify --e2e` (df7ccb5 + gate classification, 2026-09-14, backend :3998 prod-copy D1 + бодит Qwen3-8B runtime :39217):**
бүх 7 ангилал ажилласан · E2E `c:live-backend` 10 · `int:e2e-smoke` 6 (§18: `norm_retrieval.reason='runtime_down'` → `answer_contract.kind='norm_unavailable'`,
`trusted_contract.noMatch=false`) · `eval:conv` PASS · MODEL_EVAL `eval:norm` PASS · `eval:company` **7/10** (D, G: «16,8» ≠ хэрэгслийн 24 —
тоолол; J: `norm_trusted` ≠ `norm_legal_review` + «хүний хяналт» өгүүлбэр алга) · PERFORMANCE `c:perf-baseline` PASS · `perf:responsiveness` PASS ·
`c:dataset-lint` PASS (өгөгдөл нь зөвхөн үндсэн tree-ийн gitignore-той `ai/data-train-files`) · `c:training-lint` BLOCKED (`ai/training/out` —
`ai:build:sft` энэ мандатад ороогүй) → **releaseReady: true, BLOCKING 0, WARNINGS 2** (`backend:all` өмнөх 3; `eval:company` 7/10).
Эзний шийдвэр (эцсийн мандат §16): company golden нь бодит загвар дээр СТОХАСТИК → `eval:company` одоо `MODEL_EVAL` ангилал, `N/10 тэнцэв`-ийг
уншиж **6–9/10 = анхааруулга (blocking биш), <6/10 эсвэл тоо олдохгүй = blocking, 10/10 = PASS** (`parseCompanyGolden`, `COMPANY_WARN_MIN = 6`);
бодит тоо, унасан кейсүүд detail-д хэвээр.  Хоёр тусдаа гүйлт хоёулаа 7/10, ижил D/G/J — «санамсаргүй» биш тогтвортой сул тал, C/A-ийн
загварын чанарын ажил (READY_FOR_CANARY-ийн блокер, §5h-ийн уншигч энэ тоог хувь хэмжээ гэж бүү ойлго).

**Эзний suite (эцсийн backend :3999, бодит runtime):** A GOLD L1 Σ PASS 38 · FAIL 0 · EXPECTED_NO_SOURCE 1 (B09; Level 1 29/29) · GOLD L2 `--gen`
Σ PASS 38 · FAIL 0 · EXPECTED_NO_SOURCE 1 · conv `--gen` бүтэц 22/22, үүсгэлт **32/34** (C2 «төслийг заав», G «B-ийн нэр, A-ийн нэр биш» —
хоёулаа src=model, загварын чанар; эзний хүлээлт 34/34 ХАНГАГДААГҮЙ), гэрээний эх сурвалж model 9 / repaired 8 / template 0, хүчтэй давталт 0/17,
хэв маягийн гажиг 0/17.  Миграц 0295–0299 prod-copy snapshot дээр 5/5 (`ai_fleet_devices.running_versions_json` ✓).  Бодит PC:
мэдлэг 11 баримт (бүгд sha-тай) ↔ бүртгэл → `match`, `kf1:ce9489ca0270dbd8` / `rf1:4b84ee0d12ccaa47`, schema 3 = runtime 3, health `NORM_OK`.

## 6. Session D-ийн хийсэн засвар (энэ салаанд)

- `backend/src/lib/mglai/version.ts` — `RUNTIME_VARIANTS` += `employee-8b-q4`, `employee-8b-q5` (хувилбар тархалт, §29).  Тестээр баригдана.
- `ai/package.json` — `mgl-ai:verify`, `:full`, `:e2e`, `integration:test`, `integration:check`, `mgl-ai:merge-forecast` (сүүлийн hunk).
- `backend/package.json` + `package-lock.json` — lockfile-ын жинхэнэ зөрчлийн засвар (дээрх §5 Repo #1).
- `packages/mglai-common/` (шинэ, хуваалцсан) + `backend/src/lib/mglai/redaction.ts` (re-export) + `backend/package.json` file: хамаарал — GAP-027.
- `backend/src/lib/mglai/improvement/trustedSummaryFromDiag.ts` (+ тест) — A diag → B хураангуй адаптер (§4/§5).
- `ai/integration/test/e2e.smoke.test.ts` + `verify.mjs --e2e` — өөрийн tree-ийн backend-ийг асааж C-ийн үнэлгээг ТҮҮН РҮҮ чиглүүлнэ (:3000 дээрх өөр tree рүү биш).
- `ai/integration/**` — шинэ, эзэнгүй хавтас.

## 7. Хаалганы одоогийн төлөв

`node integration/verify.mjs` (fast, 2026-09-11, `mgl-ai-integration`@09be11b+): UNIT PASS (runtime 111 · retrieval 54 · backend
mglai 432 · fe check-ai 99) · INTEGRATION PASS (contract 12 · drift 13 · compat 8 · gate 7) · SECURITY PASS (secrets 1 · auth 17 ·
visibility+permissions 43) · INSTALLATION **PASS** (lockfile зассан) · C-ийн 6 suite + B-ийн deployment/releases + A-ийн
norm-compiler = **BLOCKED_BY_X** (merge хүлээнэ).  `--e2e` (энэ tree-ийн backend :3998 + бодит runtime :39217): `int:e2e-smoke`
4/6 (ERP free-contract → C groundingGuard; §18 offline-norm → C/A), `eval:norm` PASS, `eval:conv` 21/22 (H → GAP-032, A),
`eval:company` 8/10 (MODEL_EVAL), `perf:responsiveness` PASS.
**releaseReady: false** — blocking: normRegistry (A WIP), E2E 2 цоорхой; A/B/C merge хүлээгдэж байна.
