# MGL AI · Интеграцын архитектур (Session D)

> Энэ хавтас нь A (норматив AI) · B (ажилтны платформ) · C (чанарын хаалга)
> гурвыг **нэг хувилбарлагдсан бүтээгдэхүүн** болгож холбох гэрээ, тест,
> хаалгыг агуулна.  Эзний системийн логикийг ЭНД дахин бичихгүй.
> Дэлгэрэнгүй баримт: `docs/mgl-ai/ARCHITECTURE.md` (урсгал), `OPERATIONS.md`
> (ажиллуулалт), `TRAINING.md` (сургалт), `ai/knowledge/README.md` (нормын сан).

## Нэг тушаал

```
cd ai
npm run mgl-ai:verify            # --fast  ~15 с: unit + гэрээ + drift + нууцын хил + clean-machine
npm run mgl-ai:verify:full       # + typecheck ×4 (ai, integration, backend, frontend), backend бүх тест
npm run mgl-ai:verify:e2e        # + E2E / MODEL_EVAL / PERFORMANCE: ЭНЭ tree-ийн wrangler dev-ийг :3998 дээр өөрөө асаана (prod-copy D1 + .dev.vars-ыг үндсэн tree-ээс хуулна); runtime = бодит :39217 (ai:start), байхгүй бол MODEL_EVAL BLOCKED
node integration/verify.mjs --only int:drift,int:compat
```

Гаралт: `integration/reports/release-gate.json` (`mgl-ai-release-gate/1`) —
`releaseReady`, `blocking[]`, `warnings[]`, ангилал бүрийн `results`, §35
матриц, эх кодоос цуглуулсан `versions`.  **Unit ногоон ≠ release-ready**:
`releaseReady` нь зөвхөн `--e2e` горимд, бүх ангилал ажиллаж, blocking хоосон,
A/B-ийн WIP merge хийгдсэн үед л `true`.

## Юу хаана ажилладаг вэ

| Хаана | Юу | Үнэний эзэн |
|---|---|---|
| Ажилтны PC — хөтөч (SPA) | `orchestrator.runTurn`: plan → tool ‖ norm → context → generate → validate → messages | ХЭЗЭЭ Ч үнэн шийдэхгүй — тээвэр + харуулалт |
| Ажилтны PC — `mgl-ai-runtime` (node, `%LOCALAPPDATA%\MglAi`) | llama.cpp инференс (`/generate`), локал нормын сан `knowledge.sqlite` (`/norm`), updater, health | **Загварын гаралт** (магадлалтай), **нормын хайлт/эшлэл** (детерминист, A) |
| Ажилтны PC — Revit add-in | Revit контекст, BIM үйлдэл | Revit баримт |
| Компанийн backend (Cloudflare Worker) | эрх, prompt угсралт (ГАНЦ газар), ERP хэрэгсэл (gateway DSL), tfc гэрээ бичих, эшлэл дахин шийдэх, feedback, релизийн манифест (D1) | **Эрх · ERP өгөгдөл · хариултын гэрээ · хөрвүүлсэн нормын бүртгэл** (A, Worker-ийн код) |
| Админ | релиз нийтлэх (D1 `ai_model_releases`/`ai_knowledge_packs`/`ai_runtime_installers`), feedback хянах, эрхийн профайл | шийдвэр |

**Норматив үнэн** = Session A-ийн `/norm` хариу (PC) + Worker-ийн хөрвүүлсэн
бүртгэл (`backend/src/lib/mglai/norm/generated/`).  Хоёр нь ИЖИЛ багцаас
(`datasetSha256`) гарсан байх ёстой — зөрвөл `NORM_DATA_VERSION_MISMATCH`.
Session D түүнийг ДАХИН ТОДОРХОЙЛОХГҮЙ; зөвхөн гурван хэрэглэгч (frontend
`NormAnswer`, backend `parseLocalNorm`, B `httpNormProviders`) нэг хэлбэр
уншиж байгааг барина (`test/drift.test.ts`).

## Бүрэлдэхүүн ба хувилбар

| Бүрэлдэхүүн | Хувилбарын эх сурвалж | Хэн шинэчилдэг | Хэмнэл |
|---|---|---|---|
| app (SPA) | Pages deploy commit (package.json `0.0.0` — хувилбаргүй, **B тодорхойлно**) | Pages deploy | өдөр бүр |
| runtime | `ai/runtime/src/config.ts RUNTIME_VERSION` = `ai/package.json version` (drift тест барина) | `publish-installer.mjs --pack-runtime` → R2 `mgl-ai-runtime-<v>.zip` | долоо хоног |
| model | D1 `ai_model_releases.version` + `artifact_sha256`; runtime `/info.active_model` | админ INSERT, `updater.ts` татна | сар |
| adapter (LoRA) | D1 `kind='adapter'`, `base_release_uid` | ижил | сар |
| knowledge (`knowledge.sqlite`) | D1 `ai_knowledge_packs.version` + `sha256`; SQLite схем `ai_schema_meta.version` (= `retrieval/src/db.ts SCHEMA_VERSION`) | хөгжүүлэгч `ai:ingest:norm` → `ai_knowledge_releases` (sha) → release манифест → ажилтны PC автомат stage/SHA/activate (Session B) | норм ирэх бүрд |
| normRegistry | `backend/.../norm/generated/manifest.generated.ts` (`datasetSha256`, `contentSha256`) — **Worker-ийн код, PC-д файл БАЙХГҮЙ** | `ai:norm:generate` + worker deploy | knowledge-тэй ХАМТ |
| revit add-in | `revit-mcp/addin` хувилбар | тусдаа | тусдаа |
| гэрээнүүд | `runtime-api/1` (энд), `tfc-1` (backend↔frontend), `mglai-sys-6`, `mglai-tools-1`, `mglai-rag-1` (backend `version.ts`) | код | код |

Нийцлийн матриц: `src/compat/matrix.ts` (`CONSTRAINTS` — мөр бүр `reason`
+ `owner`).  B-ийн `ai/deployment/src/manifest.ts checkCompatibility` нь
РЕЛИЗИЙН манифестын `requires[]`-ийг PC дээр шалгана; энэ матриц нь КОДЫН
гэрээний хувилбаруудыг CI дээр шалгана.  Хоёр давхарга, хоёр эзэн.

⚠️ **§15-ийн хамгийн аюултай хамаарал:** `openKnowledgeDb` нь SQLite схемийн
хувилбар ≠ `SCHEMA_VERSION` бол `ai_documents`, `ai_chunks`, `ai_rules` … БҮГДИЙГ
`DROP` хийдэг.  Runtime-ийн `SCHEMA_VERSION` өссөн релиз knowledge багцгүй
тарвал ажилтны мэдлэг чимээгүй устана.  Матрицад `knowledge-schema-matches-runtime`
BLOCKING.

## Релиз хэрхэн шалгагдах вэ

```
өөрчлөлт → эзний тест → mgl-ai:verify --full → (нэр дэвшигч багц)
        → mgl-ai:verify --e2e (release gate) → админ/канари → stable
```

Хаалга **fail-closed**: ажиллаагүй ангилал `NOT_RUN`, merge хийгдээгүй эзний
suite `BLOCKED_BY_<X>`, хувь хэмжээ хэзээ ч тооцохгүй.

## Алдааг хэрхэн мөшгих вэ (өнөөдрийн бодит байдал)

| Асуулт | Хариулах өгөгдөл | Төлөв |
|---|---|---|
| Аль хүсэлт унав? | хөтөч `requestId` → `/plan` echo → `/context`/`/tool`/`/messages`-д илгээгддэг | ⚠️ D1-д ХАДГАЛАГДАХГҮЙ (`ai_messages`-д багана алга); runtime `/generate`-д ЯВДАГГҮЙ; `msg_uid` л холбоос |
| Аль загвар хариулав? | `ai_messages.runtime_variant` + `model_version` | ✅ 2026-09-11-ээс (`employee-8b-q4` олонлогт нэмэгдэв); `model_version` нь БҮТЭЭГДЭХҮҮНИЙ хувилбар (1.0.0), загварынх БИШ |
| Аль мэдлэг/бүртгэл? | `/norm/info.knowledge_version` (kf1) + `/api/mgl-ai/norm-registry.registry_version` (rf1); health `NORM_DATA_VERSION_MISMATCH`; B heartbeat `versions{}` | ✅ 2026-09-14 (мессеж бүрд A `diag_json.norm` + `local_norm.drift`) |
| Гэрээ юу хийв? | `ai_messages.diag_json` (0280) | ✅ |
| Ажилтан X ямар хувилбартай? | `ai_runtime_installs` (heartbeat) | runtime + model л; knowledge/registry/adapter дутуу (B) |
| Дахин давтаж болох уу? | `ai_feedback.prompt_snapshot/answer_snapshot` + `context_ref` | хэсэгчлэн |

## Тест ангиллууд

`UNIT` · `INTEGRATION` (энэ хавтас: бодит runtime гэрээ, drift, compat, typecheck; C `streaming-faults`)
· `SECURITY` (нууцын хил, runtime auth, visibility; C `hallucination-contract`, `security-injection`) · `INSTALLATION`
(clean-machine, lockfile) · `E2E` (D smoke, C `live-backend`, C conv/company) · `MODEL_EVAL` (A `eval:norm`, C
`dataset-lint`/`training-lint`) · `PERFORMANCE` (C `perf-baseline`, `bench-responsiveness`).  Тус бүр тусдаа тайлагнагдана.
Session C-ийн `npm run ai:readiness` (scorecard) нь C-ийн өөрийн нэгтгэгч — энд ДАХИН ажиллуулахгүй, suite бүрийг шууд дуудна.

## Хуваалцсан багц — `packages/mglai-common`

Репод анх «twin файл» заншил л байсан (shared package алга).  GAP-027-оос хойш `packages/mglai-common/`
(`@mgl/mglai-common`) нь Worker · Node · хөтөч гурвуулаа ИЖИЛ хэрэгжүүлэлтийг импортлодог цэвэр TS багц:
`lib: ES2023`, `types: []`.  Backend `file:../packages/mglai-common` хамаарлаар (symlink, `npm ci` ✓, esbuild ✓),
`ai/` нь харьцангуй `.ts` импортоор (rootDir-гүй).  Одоо: `redaction` (нууцын маск — алгоритм ганц, бодлого эзнийх) ба
`normIdentity` (мэдлэг ↔ бүртгэлийн dataset SHA харьцуулагч — runtime `/norm/info` · backend `/api/mgl-ai/norm-registry` ·
B `deployment/src/normVersion.ts` гурвуулаа).

## Файлууд

- `src/contracts/runtimeApi.ts` — runtime API-ийн хэлбэр, талбар бүрийн ХЭРЭГЛЭГЧ тэмдэглэгдсэн
- `src/contracts/shape.ts` — хамааралгүй хэлбэр шалгагч
- `src/contracts/sources.ts` — хос файлуудын эх кодыг унших туслах
- `src/compat/matrix.ts` · `collect.ts` — нийцлийн матриц, хувилбар цуглуулагч (эх код + амьд runtime)
- `src/gate/releaseGate.ts` — `mgl-ai-release-gate/1`, §35 матриц
- `test/runtime.contract.test.ts` — ЖИНХЭНЭ `createRuntimeServer` (echo, түр data dir)
- `test/secrets.security.test.ts` — sentinel нууц/токен гоожилт
- `test/drift.test.ts` — variant/status/phase/port/control-plane/response-key хосууд
- `test/compat.test.ts` — матриц + knowledge↔registry sha
- `test/cleanMachine.install.test.ts` — абсолют зам, хуучин акаунт, `npm ci --dry-run`
- `test/e2e.smoke.test.ts` — бодит backend + echo runtime, хөтчийн дараалал (C-ийн `e2e.mjs`-ээр); §18 семантик
- `test/redaction.crossConsumer.test.ts` — канон · backend re-export · B deployment ижил функц, ижил гаралт
- `verify.mjs` — оркестрлогч
- `CONTRACTS.md` — гэрээний зураглал, merge эрсдэл, эзэн бүрд шаардлагатай өөрчлөлт
