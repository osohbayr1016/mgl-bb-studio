# MGL AI · Ажилтны PC-ийн суулгац, шинэчлэлт, флот, сайжруулалт (Session B)

> 2026-09-11.  Салаа `mgl-ai-employee-deployment`.  **Deploy хийгээгүй, commit хийгээгүй.**
> Норматив retrieval / тооцоолуур / TrustedNormResult / GOLD suite нь Session A-ийн эзэмшил —
> энэ баримтын юу ч тэдгээрийг тодорхойлдоггүй.

## 1. Юу байсан, юу дутуу байсан (хэмжсэн)

| Байсан | Дутуу байсан |
|---|---|
| `installer/bootstrap.ps1` (60 KB IExpress, `%LOCALAPPDATA%\MglAi`, SHA-256) | ганц release манифест — гурван тусдаа бүртгэл, хоорондоо холбоосгүй |
| `modelManager.ts` — base/adapter/knowledge, `.part`→SHA→rename, rollback | **heartbeat-ийн дуудагч 0** → `ai_runtime_installs` хэзээ ч бөглөгдөөгүй |
| `updater.ts` — 6 цаг тутам, smoke, busy бол хойшлуулна | мэдлэгийн `.pack` татагддаг ч **шингэдэггүй** (`knowledge.sqlite` зөвхөн dev ingest-ээр) |
| `start.ps1 -Supervise` + bootstrap-ийн Task Scheduler | **хоёр өөр супервайзер**, давхар процессын хамгаалалтгүй |
| `/health` = амьд | health-ийн тал тус бүрийн төлөв, шалтгаан-код, эхний ажиллуулалтын шалгалт байхгүй |
| `ai_feedback` + 7 төлөвт машин | knowledge/runtime/normRegistry хувилбарын тамга байхгүй; алдааны inbox, регресс/SFT нэр дэвшигч байхгүй |
| — | телеметрийн түвшин, диагностик багц, лог эргэлт, repair — байхгүй |

## 2. Архитектур

```
ai/deployment/src/
  manifest.ts        mgl-ai-release/1 схем · validate · checkCompatibility (requires / minRuntime)
  layout.ts          %LOCALAPPDATA%\MglAi\{app,models,knowledge,registry,logs,state,updates/staging,diagnostics}
                     + versions/<v>/ + current.<component>.json ЗААГЧ (model нь modelManager-ийн state.json хэвээр)
  installedState.ts  state/installed.json — installationId (random UUID), components/previous, current/previous/lastKnownGood release
  updatePlan.ts      суулгасан × манифест → зөвхөн өөрчлөгдсөн бүрэлдэхүүн; sha өөр бол ч шинэчлэнэ; downgrade татгалзана
  activation.ts      staging → SHA → versions/<v>/ → заагч rename → health → бүгдийг буцаах
  health.ts          14 шалгалт · LOCAL_AI/KNOWLEDGE/NORM/COMPANY_BACKEND/REVIT · READY/DEGRADED/REPAIR_REQUIRED/UPDATING
  probes.ts          health.ts-ийн бодит хэрэгжүүлэлт — runtime-ийн НИЙТИЙН гарцаар (дотор/гаднаас ижил)
  normProviders.ts   NormSubsystem{Health,Version,SmokeTest}Provider интерфейс + mock + HTTP адаптер (/norm/info, /norm)
  supervisor.ts      цэвэр мөчлөг: lock+порт → давхар үгүй · унавал 5→60 с ухралт · зөөлөн зогсоолт
  telemetry.ts       OFF/MINIMAL/QUALITY/DEBUG цагаан жагсаалт + FORBIDDEN_KEY_PARTS + redactText + findSensitiveKeys
  heartbeat.ts       флотын ачаалал (hostname/IP/JWT ОРОХГҮЙ) → POST /api/mgl-ai/fleet/heartbeat
  diagnostics.ts     багц — өөрийгөө findSensitiveKeys-ээр шалгаж, нууц олдвол ЭКСПОРТЛОХГҮЙ
  logger.ts          JSONL, 2 MB × 5 эргэлт, мөр бүр redact
  agent.ts           runtime дотор: 2 мин дараа health+heartbeat, дараа нь 30 мин тутам; /deploy/* гарцууд
ai/deployment/bin/
  supervise.ts       Task Scheduler-ийн action: заагчаас entry уншиж node server.ts спавнана (--once/--status/--stop)
  health.ts          хөнгөн/--full тайлан, --diagnostics багц (exit 0/2/3)
  update.ts          манифест (allowlist хост) → plan → runUpdate; model нь runtime-ийн updater-ээр
backend/
  migrations 0295 ai_fleet_devices + ai_release_manifests · 0296 ai_failure_candidates/regression/sft ·
             0297 ai_model_candidates + ai_knowledge_releases · 0298 ai_message_install_context
  lib/mglai/fleet/heartbeat.ts       сервер талын цагаан жагсаалт (FORBIDDEN_FIELD → 400 бүхэлдээ)
  lib/mglai/releases/manifest.ts     угсралт (sha-гүй → алдаа) · CANDIDATE→APPROVED→CANARY→STABLE · сувгаар сонголт
  lib/mglai/improvement/failureCandidate.ts  👎→нэр дэвшигч · чиглүүлэлтийн зөвлөмж · ариутгал · SFT-ийн 3 хаалга
  routes/mglAiFleet.ts               /fleet/{heartbeat,release-manifest,message-context} + /admin/{fleet,releases,failures,regressions,sft,model-candidates,knowledge-releases}
frontend/
  features/mgl-ai-admin/MglAiFleetPage.tsx   /app/admin/mgl-ai-fleet — Флот / Алдаанууд / Релиз
  features/mgl-ai/lib/deployment.ts          санал хүсэлтэд суулгацын тамга (fire-and-forget)
```

### Runtime-ийн шинэ гарцууд (`server.ts`, нэвтрэлттэй)

`GET /deploy/health[?full=1]` · `GET /deploy/health/last` · `GET /deploy/state` · `POST /deploy/telemetry {level}` (DEBUG-ийг локалоос асаахгүй) · `POST /deploy/heartbeat` · `GET /deploy/diagnostics`.  `/info` одоо `deployment: {installation_id, channel, versions, release}` буцаана.

### Хатуу дүрмүүд

- **Хэш таарахгүй файл хэзээ ч идэвхжихгүй** — `.part` устгагдана, `SHA_MISMATCH`.  Манифестын бүрэлдэхүүн бүрд sha256 ЗААВАЛ; sha-гүй `ai_model_releases` мөрөөс манифест угсрахаас татгалзана.
- **Ажиллаж буй хувилбар дээр дарж бичихгүй** — `versions/<v>/` + заагч rename.  Health унавал ТЭР РЕЛИЗИЙН БҮХ идэвхжсэн бүрэлдэхүүн буцна (нэгийг нь биш).  Анхны суулгац унавал заагч УСТАЖ «суулгаагүй» болно.
- **`lastKnownGoodRelease` зөвхөн health READY-ийн дараа.**
- **Ажилтны яриа ≠ сургалтын өгөгдөл.**  `NEW → APPROVED_SFT` шилжилт байхгүй; SFT нэр дэвшигч нь MODEL_BEHAVIOR/APPROVED_SFT + REDACTED + залруулгатай мөрөөс Л.  `INCLUDED` төлөв админы товчоор биш, багц угсрагчаас.
- **Телеметри цагаан жагсаалт, хоёр давхарга** (клиент `telemetry.ts` + сервер `fleet/heartbeat.ts`).  `FORBIDDEN_KEY_PARTS` ХОС тогтмол — хамт өөрчил.  Түлхүүрт «token» үг орсон тул `first_token_ms` → `ttft_p50_ms` болсон.
- **installation_id = санамсаргүй UUID**, хардверийн хээ биш.  Хостын нэр/хэрэглэгчийн нэр/IP хүлээн авахгүй (400).
- **Model промоушн энэ шатанд хаалттай**: `POST /admin/model-candidates/:id/status {PRODUCTION}` → 403.

## 3. Ажилтны PC-ийн урсгал (одоогийн bootstrap.ps1)

```
MGL-AI-Setup.exe → node, llama.cpp (SHA) → runtime-code → app\versions\<v>\ + app\current.runtime.json
→ Task Scheduler: node app\versions\<v>\deployment\bin\supervise.ts (lock+порт, унавал ухралттай)
→ /health → deployment\bin\health.ts → тал тус бүрийн мөр (LOCAL_AI, KNOWLEDGE, NORM, COMPANY_BACKEND, REVIT)
→ ERP нээх → /pair → загвар татагдана → 5 с дараа /fleet/heartbeat → админы флот хүснэгтэд гарна
```

Шинэ суулгацад `KNOWLEDGE MISSING`, `NORM MISSING`, `MODEL_MISSING` нь ХҮЛЭЭГДЭЖ БУЙ (хосолсны дараа ирнэ).

## 4. Хэмжсэн

- `cd ai && npm run ai:deploy:test` — **59/59** (манифест 11 · төлөвлөгөө 11 · идэвхжүүлэлт/буцаалт 7 · супервайзер 8 · health 9 · телеметри/диагностик/лог 12 · хүлээн авалтын harness 1).  `npm run ai:test` runtime 111/111 хэвээр.
- `cd backend && node --test src/lib/mglai/{fleet,releases,improvement}/*.test.ts` — **23/23**; бүх backend suite 1261/1264 (унасан 3 нь Session B-ээс ӨМНӨ байсан `migrationSchema.test.ts`-ийн түүхэн давхардал/statement тоо).
- `tsc`: ai · backend · frontend `tsc -b` — цэвэр.  eslint шинэ файлууд — цэвэр.  4 миграц throwaway sqlite дээр ажилласан, CHECK-ууд татгалзалтаа хийсэн.
- Багцалсан runtime (`publish-installer --pack-runtime`, 258 KB, deployment/ орсон) → `versions/<v>/` + заагч → `supervise.ts --once` асаав → runtime-ийг `taskkill /F` → **5 с-д сэргэв** → хоёр дахь супервайзер `ALREADY_RUNNING`-ээр гарав.  Echo горим, тусдаа порт (39241), dev PC-ийн 39217 хөндөгдөөгүй.
- Runtime + agent echo горимд: `/deploy/health` 166 мс, тал бүрийн код зөв (`RUNTIME_ENTRY_MISSING`/`MODEL_MISSING`/`KNOWLEDGE_NOT_INSTALLED`), `/deploy/diagnostics` 200, heartbeat `NOT_PAIRED`.
- **Урхи (хэмжсэн):** Windows дээр `spawn({detached:true, stdio:'ignore'})` хүүхэд нь эцэг гармагц үхнэ; stdio-г файл руу өгөхөд амьдарна — `supervise.ts --once` ингэж засагдсан.

## 5. Бодит PC дээр ҮЛДСЭН нэг шалгалт

Хөгжүүлэгчийн PC дээр bootstrap ажиллуулах нь амьд MGL AI runtime-ийн Task Scheduler даалгаврыг сольж, процессыг алах тул ЭНД ажиллуулаагүй.  Цэвэр (эсвэл туршилтын) Windows машин дээр:

```powershell
cd ai; node scripts/publish-installer.mjs --pack-runtime          # runtime zip (deployment/ орсон)
powershell -ExecutionPolicy Bypass -File installer\bootstrap.ps1 -ManifestUrl "file:///.../ai/dist/mgl-ai-components.json"
# хүлээгдэж буй: Task 'MGL AI runtime' action = ...\deployment\bin\supervise.ts, тал бүрийн health мөр хэвлэгдэнэ
node "$env:LOCALAPPDATA\MglAi\app\versions\<v>\deployment\bin\supervise.ts" --status
```

## 6. Session A-тай холбох цэгүүд

| Интерфейс | Өнөөдөр | Session A гаргахад |
|---|---|---|
| `NormSubsystemHealthProvider` | `/norm/info`-ийн `installed`, `counts` | `knowledge_version`, `registry_version`, `schema_version` талбар нэмбэл `httpNormProviders.version()` шууд уншина |
| `NormSubsystemSmokeTestProvider.smokeCalculator` | `skipped: true, NORM_CALC_SMOKE_NOT_EXPOSED` (health → NORM DEGRADED) | нийтийн тооцоолуурын гарц гарахад НЭГ функц солино |
| Regression `target: 'NORM'` | `ai_regression_candidates.expected_json` ерөнхий JSON | `RegressionCandidateExporter` хэрэгжүүлж `norm-golden.mjs` кейс болгоно |
| `ai_failure_candidates.trusted_summary_json` | route бичдэггүй (NULL) | `/messages`-ийн `diag_json`-оос `contract_violations/no_match/citation_issue` хуулах нь mglAi.ts-ийн засвар — Session A-тай зэрэгцээ тул хийгээгүй |
| Knowledge bundle = бэлэн `knowledge.sqlite` | `ai_knowledge_packs.url` нь .pack (ingest-гүй) | Session A-ийн компиляц sqlite гаргаж `ai_knowledge_releases`-д бүртгэвэл manifest.knowledge тэрийг тээвэрлэнэ |

## 7. Хийгээгүй / дараагийн

- Runtime-код шинэчлэлтийн дараа `/shutdown` → супервайзер шинэ заагчаас асаах гинжийг `update.ts`-д `afterSwitch` болгож холбоогүй (bootstrap нь одоо заагчтай тул суурь бэлэн).
- Uninstall скрипт (§33), Revit add-in бүрэлдэхүүний бодит татаж авалт (§19 P1) — манифестад `revit` талбар бий, суулгагч хэсэг байхгүй.
- Canary rollout автоматжуулалт — суваг оноох нь админы гар (`PATCH /admin/fleet/:id`).
- `start.ps1 -Supervise` (dev repo) нь хэвээр; ажилтны PC-д bootstrap-ийн task л байна.

## 8. Хатуужуулалтын давалт (2026-09-11, 2-р хэсэг)

### P0-1 · Runtime шинэчлэлт → дахин асаалт → health → буцаалт (ХОЛБОГДСОН)

```
stage(SHA) → compat → заагч солих → state/update.json{switching} → /shutdown
→ супервайзер update.json-ыг «зориудын гарц» гэж уншиж УХРАЛТГҮЙ заагчаас асаана
→ /info.deployment.running ≟ хүлээсэн (VERSION_MISMATCH) → /deploy/health?full=1 → /generate smoke
→ PASS: markHealthy + lastKnownGood · FAIL: заагч буцаах → update.json{rolling_back} → /shutdown
   → хуучин асна → хуучны хувилбар + health → rollbackOk · state/last-update.json{code, rollbackReason, rollbackOk}
```

- Заагч зогсоолтоос ӨМНӨ солигдоно, спавн бүр заагчаас уншина → супервайзер хуучин хувилбарыг «санамсаргүй» асаах мөч байхгүй.
- `ProcessCoordinator` интерфейс (`activation.ts`): бодит нь `bin/update.ts` (HTTP, супервайзер алга бол `supervise.ts --once`-ийг өөрөө асаана); тестэд fixture runtime.
- `deployment/test/restartChain.test.ts` — **бодит процессууд** (супервайзер + `fixtures/fakeRuntime.ts`), 7 хувилбар: амжилт · асахгүй (RESTART_FAILED) · буруу хувилбар (VERSION_MISMATCH) · health унах · smoke дундуур унах · **буцаалт ч унах (ROLLBACK_FAILED, rollbackOk=false)** · «reboot» + хуучирсан lock + давхар супервайзер.  24 с.
- `bin/update.ts` дээр `ai/scripts/publish-installer.mjs` нь багц доторх `package.json.version`-ийг манифестын хувилбараар тамгалдаг болов — `/info.deployment.running.runtime` тэндээс уншина.

### P0-2 · Windows дахин асаалт
Супервайзер: PID амьд ч (1) `pidIsRuntime` false (PID дахин ашиглагдсан) эсвэл (2) lock 2 мин-ээс хуучин атлаа /health хариулахгүй → lock хуучирсан гэж цэвэрлэнэ; порт хариулж байвал ALREADY_RUNNING (давхар асаахгүй).  Хэмжсэн: fixture суулгацын процессуудыг `Stop-Process`-оор алж (симуляц) `Start-ScheduledTask` → Phase 2 PASS ×3, хуучирсан lock цэвэрлэгдсэн.

### P0-3 · Цэвэр машины хүлээн авалтын harness — `installer/acceptance.ps1`
Repo clone ШААРДАХГҮЙ (bootstrap.ps1 + acceptance.ps1 хоёр файл + runtime zip/манифест).  15 алхам, PASS/FAIL/BLOCKED мөр + JSON тайлан, exit = FAIL тоо.  `-Mode Fixture` нь ӨӨРИЙН root/порт/task (`MglAi-acceptance`, 39271, «MGL AI acceptance»), echo хөдөлгүүр — амьд суулгацыг хөндөхгүй; `-Cleanup` буцаана.

**Энэ PC дээр хэмжсэн (Fixture, 2026-09-11): Phase 1 — 11 PASS · 0 FAIL · 4 BLOCKED; Phase 2 (симуляц) — 3 PASS.**  BLOCKED: 09/10 бодит reboot, 13/14 ERP JWT (прод D1-д 0295–0299 миграц хараахан байхгүй тул зориуд өгөөгүй).  Алхам 05/11/12/15 нь Task Scheduler-ийн БОДИТ супервайзерээр дамжсан дахин асаалтын гинж (мэдлэг v1 → v2 → sha буруу → эвдэрсэн sqlite → RESTART_FAILED → v2 буцаалт → repair).
**Гадны машин дээр ҮЛДСЭН ГАНЦ ажил:** цэвэр Windows-д `-Mode Real -Phase 1` → reboot → `-Phase 2` (алхам 09/10), ERP JWT-тэй (13/14).

### P0-4 · Session A адаптер — `backend/src/lib/mglai/improvement/trustedSummary.ts`
`TrustedResultFeedbackSummary` (schemaVersion 1, kind, authoritative, sourceDocumentCode, ruleOrFormulaId, verificationState, resultFingerprint, validatorOutcome, validatorViolations, noMatch, citationIssue) + `sanitizeTrustedSummary` (цагаан жагсаалт) + `TrustedResultSummaryProvider` (`NULL_PROVIDER`) + `toRoutingSignals` → `recommendRoute`.  **Session D:** provider-ийг Session A-ийн эцсийн `TrustedNormResult`/`diag_json` гэрээнд холбоно (`routes/mglAiFleet.ts`-ийн `trustedSummaries` тогтмол); `mglAi.ts` хөндөгдөхгүй.

### P0-5 · Ганц идэвхжүүлэлтийн семантик
`updater.ts` (runtime) = манифест + татах шийдвэр; мэдлэгийн багц → `activateKnowledge` → `activation.ts activateSingleComponent`.  `installKnowledgePack` (.pack зам) дуудагдахаа болив.  `server.ts` мэдлэгийн санг заагчаар нээнэ (`resolveKnowledgeDb`).  `consolidation.test.ts` нь `ai/runtime/src`/`bin`-д заагч/бүртгэлийн бичилт гарвал унана (тайлбарыг хасаад grep).

### P0-6 · Бодит хувилбарын ажиглалт
`/info.deployment.running` = {runtime: package.json, knowledge: заагч таарвал хувилбар/`legacy`, model}.  Health `version_match` (LOCAL_AI, degraded) → заагч 1.2 / процесс 1.1 = `VERSION_MISMATCH` → **DEGRADED, READY биш**.  Heartbeat `running_versions` + `update.last`; D1 `ai_fleet_devices.running_versions_json` (0299); диагностик `runningVersions`, `lastUpdate`.

### P1
- Суулгагчийн таамаглалын аудит: Session B кодод `C:\Users`, repo зам, dev порт, `.dev.vars`, venv **0** (grep).  `-SkipNode` зөвхөн Fixture горим (баримтжуулсан).  Тестүүд temp root.
- Диск/тасарсан таталт: `INSUFFICIENT_SPACE` (statfs, 2×хэмжээ+512 MB), сүлжээ/ENOSPC/цуцлалт → `.part` устгагдана, заагч хэвээр; эвдэрсэн `.ok` staging дахин татагдана; `cleanStaleStaging` (7 хоног / `.part`).
- Диагностик: `runningVersions`, `lastUpdate{code, rollbackReason, rollbackOk}`, `releases.lastKnownGood`, health reason codes; JWT/credential/hostname хэвээр хаалттай (тест).

### Хүлээн авалтын хураангуй
| | |
|---|---|
| RUNTIME_RESTART_CHAIN | PASS (7 fixture-процесс тест + Task Scheduler-ийн бодит гинж acceptance 05/11/12/15) |
| WINDOWS_RESTART | PASS (симуляц: алах → task асаах → Phase 2 3/3) · **бодит reboot BLOCKED** |
| ACTIVATION | PASS |
| ROLLBACK | PASS (буцаалт ч унах хувилбар ROLLBACK_FAILED гэж ил) |
| VERSION_MATCH | PASS (health VERSION_MISMATCH → DEGRADED; restartChain #3) |
| REPAIR | PASS (`--repair` acceptance 15; `-Cleanup` uninstall PASS) |
| FEEDBACK | BLOCKED (ERP JWT + прод миграц) — pipeline тесттэй (28) |
| FLEET | BLOCKED (ижил) — heartbeat/сервер тесттэй |
| PRIVACY | PASS (телеметри/диагностик/сервер цагаан жагсаалт, 20+ тест) |

## 9. Session D-д үлдсэн интеграц/хүлээн авалтын ажил (Session B ХӨЛДСӨН)

1. **Бодит цэвэр Windows reboot хүлээн авалт** — гадны машин: `installer/acceptance.ps1 -Mode Real -Phase 1` → reboot → `-Phase 2` (алхам 09/10).
2. **Feedback/Fleet продын шалгалт** — нэвтрэлттэй орчин + прод миграц 0295–0299 хүртэл BLOCKED (алхам 13/14).
3. **`TrustedResultFeedbackSummary`** (`backend/src/lib/mglai/improvement/trustedSummary.ts`, `routes/mglAiFleet.ts`-ийн `trustedSummaries`) — Session A-ийн эцсийн канон TrustedNormResult / diag гэрээнд Session D холбоно.
4. **`NormSubsystemSmokeTestProvider.smokeCalculator`** (`ai/deployment/src/normProviders.ts`) — A/D интеграцийн хамаарал; өнөөдөр `skipped`.
5. **Хуваалцсан файлын нэгтгэл** — `ai/package.json`, `ai/tsconfig.json`, `ai/runtime/src/server.ts`, `backend/src/index.ts`, `frontend/src/shared/i18n/{mn,en}.json`, `CLAUDE.md` — Session D хийнэ, Session B биш.
6. **`backend/src/lib/mglai/systemCatalog.generated.ts`** — эцсийн интеграцийн дараа `npm run gen:system-catalog` дахин.
7. **Прод миграц/deploy алхмууд** (0295–0299 → worker → Pages → runtime zip `--apply`) — зөвхөн баримтжуулсан, ХАРААХАН АЖИЛЛУУЛАХГҮЙ.

## 10. Session D dry-run-ийн 3 блокерын засвар (2026-09-14, Session B follow-up)

1. **Идэвхжүүлэлтийн ГАНЦ семантик (P0-5 бүрэн).**  Загвар/адаптерын «activate → хөдөлгүүр дахин барих → smoke → унавал rollback → хуучны smoke» гинж нь өмнө нь `updater.ts installBase`, `updater.ts applyPendingAdapter`, `server.ts /model/activate` гурван газарт давхардаж байсан.  Одоо `deployment/src/activation.ts` `switchModel(target)` цорын ганц хэрэгжүүлэлт (`SMOKE_FAILED_ROLLED_BACK` / `ROLLBACK_FAILED` ил); гурвуулаа түүнийг дуудна.  `consolidation.test.ts`: `ai/runtime/src` + `deployment/bin`-д `manager.activate(`/`rollback(`/`activateAdapter(`/`rollbackAdapter(` нь ЗӨВХӨН `switchModel({…})`-ийн `activate:`/`rollback:` шинж дотор; `function switchModel` зөвхөн activation.ts-д (сөрөг нотолгоо: server.ts-д давхар дуудлага нэмэхэд тест унасан).  `switchModel.test.ts` (7): дараалал, буцаалт, updater-ийн хоёр зам fake manager дээр.
2. **Канон редакц (GAP-027).**  `packages/mglai-common` — Session D-ийн `0bf89d2`-оос БАЙТ-ИЖИЛ хуулбар (merge-д D-ийнх ялна); `backend/src/lib/mglai/redaction.ts` мөн D-ийн re-export; `backend/package.json`-д `"@mgl/mglai-common": "file:../packages/mglai-common"` (D-тэй ижил мөр; lockfile-ийг D эзэмшинэ).  `ai/deployment/src/telemetry.ts`: `SECRET_VALUE_RES` устсан, `redactText` = канон функцийн re-export (`===`), `findSensitiveKeys` нь `redactSecrets().counts`-аар; `failureCandidate.ts redactCandidateText` = канон `redact` + B-ийн «Овог.Нэр» бодлого (нууцын regex үгүй).  ⚠️ **Канон дээр олдсон худал эерэг (D-д):** `phone` дүрэм `(?<!\d)…(?!\d)` хилтэй тул sha256 hex дотор 8 орон олно — `sha256("model 0.4") = 836fb811a8b2c3f84894884e…` → `[REDACTED_PHONE]`.  B-ийн `findSensitiveKeys` бүтэн 64-hex утгыг үл хамааруулна (тест); лог мөрөн дэх sha нь канон засагдтал гажина.  Санал: `(?<![\p{L}\d])…(?![\p{L}\d])`.
3. **Миграцын дугаар 0290–0294 → 0295–0299** (0290 = main-ийн uncommitted `progress_latest_indexes`, 0282 = origin/main; 0283–0289 нь нөгөө агентын зориуд алгассан завсар тул хөндөөгүй).  Fresh `node:sqlite` дээр 277/277 файл (B + main 0290 + origin 0282) алдаагүй, ≥0282 дугаар давхардалгүй; B-ийн 9 хүснэгт + `running_versions_json` бий.  ⚠️ `tmp/int-dryrun` салаанд B-ийн ХУУЧИН 0290–0294 хуулбар үлдсэн — D дахин merge хийхдээ тэднийг хаяна.

Хуваалцсан файл (D нэгтгэнэ): `backend/package.json` (1 мөр, D-тэй ижил), `packages/mglai-common/**` (байт-ижил), `backend/src/lib/mglai/redaction.ts` + `redaction.consumer.test.ts` (байт-ижил).  `backend/node_modules/@mgl/mglai-common` junction нь энэ PC-ийн локал (untracked; main-ийн node_modules junction-оор дамжина).
