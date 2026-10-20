# MGL AI — Ажиллуулах гарын авлага

Дөрвөн журам: **загвар гаргах · санал батлах · норм нэмэх · эрх олгох**.

> ### ⚠️ Ажилтны PC-ийн ПРОДАКШН шинэчлэлт — ЗӨВХӨН Session B-ийн release урсгал (2026-09-14)
>
> Ажилтанд **Git, Node, гар шингээлт, гар дахин асаалт ХЭРЭГГҮЙ.**  Ажилтны PC-ийн ганц суулгац нь
> `MGL-AI-Setup.exe` (`ai/deployment/installer/bootstrap.ps1`), ганц шинэчлэлтийн зам нь:
>
> ```
> release манифест (mgl-ai-release/1, /fleet/release-manifest)
> → татах / stage (.part)  → SHA-256 тулгалт (зөрвөл SHA_MISMATCH, хэзээ ч идэвжихгүй)
> → нийцлийн шалгалт (requires / minRuntime / schema)
> → хувилбартай бүрэлдэхүүнийг идэвхжүүлэх (app|runtime|model|knowledge|normRegistry — versions/<v>/ + заагч)
> → шаардлагатай бол runtime дахин асаалт (супервайзер)
> → health (тал тус бүр) → smoke (/generate, /norm)
> → lastKnownGood тэмдэглэх
> → унавал буцаалт (rollbackOk, last-update.json)
> ```
>
> Дэлгэрэнгүй: `DEPLOYMENT.md` §2, §3, §8 (P0-1).  Энэ файлын `git pull` / `npm install` / `ai:ingest:norm` /
> `ai:restart` / `ai:stop` / `ai:start` бүхий БҮХ заавар (§1, §8, §9) нь **хөгжүүлэгч/админы машинд л** зориулагдсан —
> ажилтны PC-д хэрэглэхгүй.  Хөгжүүлэгчийн машин дээр repo-гоос ажиллуулж буй runtime нь ажилтны суулгацтай ИЖИЛ
> код боловч суулгац/шинэчлэлтийн зам нь ӨӨР.

---

## 1. Хөгжүүлэгчийн машинд repo-гоос суулгах (ХӨГЖҮҮЛЭГЧ/АДМИН — ажилтны PC = `MGL-AI-Setup.exe`)

⚠️ Энэ хэсэг **developer-only**.  Ажилтны PC-ийн суулгац, шинэчлэлт нь дээрх release урсгал
(`DEPLOYMENT.md`) — ажилтан `npm`, `git` ажиллуулахгүй.

```powershell
# 1. Repo-гоос
cd ai
npm install
npm run ai:doctor          # энэ машин юу чадах вэ

# 2. llama-server
npm run ai:setup           # хаанаас татахыг заана
#    → задлаад бүх .exe/.dll -г %LOCALAPPDATA%\MglAi\bin руу

# 3. Загвар
$env:MGLAI_TOKEN = "<ERP-ийн сессийн JWT>"
npm run ai:model -- pull
npm run ai:model -- activate <release_uid>

# 4. Асаах
npm run ai:dev
```

Дараа нь ERP-д нэвтэрч **MGL AI** цэс рүү орно. Эхний удаад
`%LOCALAPPDATA%\MglAi\secret.txt` -ийн агуулгыг хуулж «Нууц» талбарт тавина.

⚠️ **Загваргүйгээр ч ажиллана.** Тэр үед чат нь «хайлтын горим» руу шилжиж,
олдсон норм, ERP-ийн хариуг эшлэлтэй нь үзүүлнэ. Хуудас хоосон болохгүй.

---

## 2. Шинэ загварын хувилбар гаргах (§32, §38)

**Автоматаар хийгддэг алхам БАЙХГҮЙ. Тав дахь алхам нь хүний шийдвэр.**

```
1. Багц бэлдэх
     npm run ai:export-feedback -- 1.1.0
     → зөвхөн `approved` / `included_in_dataset` мөр гарна
     → давхардал, хоосон, богино мөр хасагдана
     → ai/datasets/mgl-dataset-1.1.0/{train.jsonl,manifest.json}

2. Бодлогын шалгалт (§35)
     python ai/training/dataset_lint.py ai/datasets/mgl-dataset-1.1.0/train.jsonl
     ⚠️ «41 ажилтан» гэсэн мөр УНАНА.  Тэрийг «get_active_employees дуудна»
        болгож ЗАСНА — устгахгүй, ЗАСНА.

3. Сургах  (GPU-тай нэг машин дээр)
     python ai/training/train_lora.py --dataset mgl-dataset-1.1.0
     → ai/models/adapters/mgl-dataset-1.1.0-r16/adapter

4. GGUF + quantize
     python ai/training/quantize.py --adapter <зам> --llama-cpp <зам> --version 1.1.0
     → mgl-ai-1.1.0-Q4_K_M.gguf + .json (sha256)

5. ҮНЭЛЭХ
     ai/evaluation -ийн golden багцаар шалга.
     ⚠️ Хуучин хувилбартай ХАРЬЦУУЛСАН оноогүйгээр цааш явахгүй.

6. ЛИЦЕНЗ
     ai/registry/LICENSES.md -ийн дөрвөн асуултад ☑ тавь.
     Хоосон бол ЭНД ЗОГСОНО.

7. R2 руу байршуул
     npx wrangler r2 object put mgl-progress-media/mgl-ai/<файл> --file=<зам> --remote

8. Бүртгэх  (D1)
     INSERT INTO ai_model_releases (release_uid, version, runtime_variant,
       base_model, quantization, artifact_url, artifact_bytes, artifact_sha256,
       license_cleared, eval_passed, channel, is_active)
     VALUES (…, 1, 1, 'canary', 0)

9. Туршилт — 1-2 ажилтан дээр
     UPDATE ai_model_releases SET channel = 'beta' WHERE release_uid = …

10. Гаргах
     UPDATE ai_model_releases SET is_active = 1, channel = 'stable' WHERE …
     ⚠️ `idx_ai_release_active` нь runtime_variant тутамд ГАНЦ идэвхтэй
        мөрийг албадана — хуучныг эхлээд 0 болго.
```

### Буцаах

```sql
UPDATE ai_model_releases SET is_active = 0 WHERE release_uid = '<шинэ>';
UPDATE ai_model_releases SET is_active = 1 WHERE release_uid = '<хуучин>';
UPDATE ai_model_releases SET channel = 'rolled_back' WHERE release_uid = '<шинэ>';
```

Ажилтны машин дээр: `npm run ai:model -- rollback`.
Локал `/model/activate` нь **өөрөө** буцаана — шинэ хувилбар ачаалагдахгүй бол
smoke тест унаж, өмнөх рүү автоматаар шилжинэ.

---

## 3. Санал хүсэлт батлах (§31)

**Хэн ч санал өгнө. Зөвхөн админ хөдөлгөнө.**

```
GET  /api/mgl-ai/admin/feedback?state=pending
POST /api/mgl-ai/admin/feedback/:id/state   { to: "reviewed" }
POST /api/mgl-ai/admin/feedback/:id/state   { to: "approved",
                                              corrected_answer: "…" }
```

Зөвшөөрөгдсөн шилжилтүүд (`lib/mglai/feedback.ts`, тестлэгдсэн):

```
pending ──► reviewed ──► approved ──► included_in_dataset ──► included_in_training_run
   │           │            │                 │                        (ЭЦСИЙН)
   └─► rejected ◄───────────┴─────────────────┘
   └─► needs_correction ──► reviewed
```

⚠️ **`pending → approved` ШУУД зам БАЙХГҮЙ.** Хяналт заавал.
⚠️ **👎 санал нь ЗАЛРУУЛГАГҮЙГЭЭР батлагдахгүй** — «муу» гэдэг нь загварт юу
заахыг хэлэхгүй.
⚠️ `included_in_training_run` нь **эцсийн** — сургалтад орсныг «ороогүй»
болгож болохгүй, зөвхөн дараагийн багцаас хасна.

---

## 4. Норм, стандарт нэмэх (§15, §16)

MGL AI нь дүрэм **ЗОХИОХГҮЙ**. Эшлэх зүйлгүй бол «баталгаажсан эх сурвалж
олдсонгүй» гэж хэлнэ. Тэрийг өөрчлөх ганц арга бол **бодит баримт нэмэх**.

```
1. Баримтыг бүртгэх
     INSERT INTO regulatory_documents (doc_uid, code, title_mn, doc_family,
       edition, effective_from, status)
     VALUES ('BNBD-21-01-02', 'БНбД 21-01-02', 'Галын аюулгүй байдал',
             'BNBD', '2002', '2002-01-01', 'in_force');

2. Заалт оруулах — хуудас, дугаартай нь
     INSERT INTO rule_clauses (clause_uid, document_uid, clause_no,
       page_no, text_mn, text_source)
     VALUES ('BNBD-21-01-02#4.2.1', 'BNBD-21-01-02', '4.2.1', 17, '…', 'manual');

3. Хайлтад оруулах
     ai_knowledge_documents + ai_knowledge_chunks (0274)
     `clause_uid` -ийг ЗААВАЛ бөглө — эшлэл түүгээр 0220 руу буцаж шийдэгдэнэ.

4. Дүрэм болгох (шаардлагатай бол)
     `rules` (0221).  `verification_state = 'CLAUSE_CITED'` болгоход
     `clause_uid + edition_ref + effective_from` ГУРВУУЛАА заавал —
     CHECK нь албадана.
```

⚠️ **`verification_state` нь итгэлийн төлөвийг хавчина.** `UNVERIFIED` дүрэм нь
MGL AI-д ХЭЗЭЭ Ч «Баталгаажсан» гэж харагдахгүй, зөвхөн «Эргэлзээтэй».
Энэ нь алдаа биш — эзний шийдвэр Ш4 (2026-08-31).

---

## 5. Revit эрх олгох (§24)

```
PUT /api/mgl-ai/admin/permissions/:userId
{ "revit_level": "SAFE_WRITE", "project_scope": [30, 51] }
```

| Түвшин | Юу чадах вэ |
|---|---|
| `READ_ONLY` | **өгөгдмөл** — зөвхөн үзнэ |
| `SAFE_WRITE` | зөвшөөрөгдсөн бичилт, **баталгаажуулалттай** |
| `CONFIRM_EVERY_WRITE` | бүх бичилт, баталгаажуулалттай |
| `PROJECT_ADMIN` | төслийн өргөтгөсөн хэрэгсэл |
| `FULL_AGENT` | баталгаажуулалтгүй (бодлого зөвшөөрвөл) |

⚠️ **Мөр байхгүй = `READ_ONLY`**, «хязгааргүй» биш.
⚠️ **Өөртөө олгож болохгүй** — маршрут 403, мөн 0273-ийн
`CHECK (granted_by <> user_id)`.
⚠️ **Roslyn нь шатнаас гадуур** — `FULL_AGENT` ч дур мэдэн C# ажиллуулахгүй.

---

## 6. Унтраах

| Юу | Хэрхэн |
|---|---|
| MGL AI бүхэлдээ | `app_settings` `mglai.enabled = '0'` → бүх зам **503** |
| Захиалагчийн горим | `mglai.client_mode = '0'` (өгөгдмөл) |
| Тухайн байгууллагад | `ENABLED_MODULES`-оос `mglai` -г хас → **403** |
| Нэг ажилтны локал | `POST http://127.0.0.1:39217/shutdown` |

⚠️ Гурван 403/503 нь **өөр утгатай**: `mglai_disabled` = түр зогсоосон,
`module_disabled` = худалдаж аваагүй, `mglai_denied` = эрхгүй.
Холих нь дэмжлэгийн ажлыг гурав дахин нэмнэ.

---

## 7. Оношилгоо

| Асуудал | Хаанаас харах |
|---|---|
| «AI хариулахгүй байна» | `npm run ai:doctor` → хөдөлгүүр, загвар, порт |
| «Хариу муу байна» | `/info` → `engine: echo` мөн үү? Загвар суулгаагүй байж болно |
| «Компанийн мэдээлэл буруу» | `/api/mgl-ai/tool` -ийн хариу — хэрэгсэл ажилласан уу |
| «Норм буруу» | `ai_knowledge_chunks.clause_uid` → `rules.verification_state` |
| «Хэт удаан» | `ai_messages.first_token_ms`, `total_ms` |
| «Эшлэл зохиосон» | `POST /messages` -ийн `dropped_citations` — сервер аль хэдийн хассан |
| Хэн ямар хэрэгсэл дуудав | `ai_action_audits` (татгалзсан оролдлого ч бичигдэнэ) |

---

## 8. Норматив мэдлэг шингээх (§11) — 2026-09-08 (ХӨГЖҮҮЛЭГЧ/АДМИН)

⚠️ **`ai:ingest:norm` нь хөгжүүлэгчийн машины команд.**  Ажилтны PC-д мэдлэгийн сан (`knowledge.sqlite`) нь
`ai_knowledge_releases` → release манифестын `knowledge` бүрэлдэхүүнээр (stage → SHA → `knowledge/versions/<v>/` →
заагч → health) ирнэ; ажилтан шингээлт хийхгүй, `ai:restart` ажиллуулахгүй (`DEPLOYMENT.md` §2, §8 P0-5).

**⚠️ Энэ нь сургалт БИШ, хайлт.**  §16 «DO NOT start by fine-tuning» —
норм нь загварын жинд ОРОХГҮЙ, локал SQLite-д орж эшлэлтэйгээр татагдана.
Дэлгэрэнгүй: `ai/knowledge/README.md`.

```bash
cd ai
npm run ai:ingest:norm -- data-train-files/<багц> --verify   # локал сан руу
npm run ai:eval:norm                                         # ХЭМЖИНЭ
```

Сан: `%LOCALAPPDATA%\MglAi\knowledge\knowledge.sqlite` — **D1 БИШ**.
Runtime-ийн гарц: `POST /norm`, `GET /norm/info` (порт 39217).

| Юу | Хаанаас |
|---|---|
| «Норм олдохгүй байна» | `GET /norm/info` → `installed: false` бол шингээгээгүй |
| «Хариу буруу мөр заасан» | `/norm`-ийн `legs` — аль хөл олсныг харуулна |
| «Итгэлгүй гэж байна» | `status: uncertain` + `note_mn` — дутуу нөхцөл эсвэл хүний хяналт |
| Хэмжүүр уналаа | `ai/evaluation/benchmarks/norm-golden-*.json` — өмнөхтэй харьцуул |

⚠️ **`ai:eval:norm` нь баталгаажаагүй дүрмийн гоожилт 0-ээс өөр байвал УНАНА.**
Тэр нь хэрэгжүүлэлтийн алдаа биш, БОДЛОГЫН эвдрэл.

## 9. Тооцоолдог норм (БД 21-101-12) — бүртгэл үүсгэх, хувилбар цоожлох (2026-09-11)

**⚠️ Тоо, ангилал, томьёог ЗАГВАР шийддэггүй.**  БД 21-101-12-ын дүрэм, томьёо нь
`ai/norm-compiler`-оор Worker-ийн typed бүртгэл (`backend/src/lib/mglai/norm/generated/`)
болж хөрвөгдөж, `/context` тэндээс `TrustedNormResult` үүсгэнэ (Architecture §16).

```bash
cd ai
npm run ai:norm:generate                 # багц → generated/*.generated.ts + manifest (ГАРААР ЗАСАХГҮЙ)
npm run ai:norm:generate -- --check      # үүсгэсэн файл багцтай зөрвөл exit 1 (CI-д)
npm run ai:ingest:norm -- data-train-files/MGL_AI_BD_21_101_12_dataset --verify   # локал сан (хайлт)
npm run ai:eval:norm                     # хайлтын хэмжүүр (Recall@5, алтан, NO_MATCH)
npm run ai:eval:gold                     # GOLD A01–A10/B01–B10 бодит гинжээр (Level 1, загваргүй)
npm run ai:eval:gold -- --gen            # + бодит Qwen3 үүсгэлт + validator (Level 2)
```

- **Хувилбарын цоож (Amendment A).**  Бүртгэл ба локал сан ХОЁУЛАА багцын файлуудын
  SHA-256-г хадгална.  Ажилтны сан өөр хувилбар (`/norm`-ийн `citation.dataset_sha256`)
  буцаавал `/context` үр дүнг `data_version_mismatch` болгож (`NORM_DATA_VERSION_MISMATCH`),
  эрх бүхий хариулт өгөхгүй.  Засах: багцыг шинэчилсэн бол **хоёуланг** нь дахин
  үүсгэ/шингээ — `ai:norm:generate` (→ Worker deploy) ба **мэдлэгийн release** (хөгжүүлэгч/админ
  `ai:ingest:norm`-оор шинэ `knowledge.sqlite` угсарч `ai_knowledge_releases`-д sha-тай бүртгэнэ → release
  манифест → ажилтны PC автоматаар stage/SHA/activate/health).  `ai:ingest:norm` + `ai:restart`-ыг ажилтны
  PC дээр гараар ажиллуулахгүй — зөвхөн хөгжүүлэгчийн машинд.  Флотын тулгалт: B-ийн health
  `NORM_DATA_VERSION_MISMATCH` (`ai/deployment/src/normVersion.ts`, `/norm/info.knowledge_version` ↔
  `/api/mgl-ai/norm-registry.registry_version`).
- **Runtime нь санг ЗӨВХӨН УНШИНА.**  Схем зөрвөл (`SCHEMA_VERSION`) `/norm` **503
  `knowledge_schema_mismatch`**, дахин шингээлт явж байхад **503 `knowledge_unavailable`** —
  хөтөч үүнийг «хайлт амжсангүй» (retrieval_failed) гэж харуулна, «олдсонгүй» гэж ХЭЗЭЭ Ч
  хэлэхгүй.
- **Хилийн зөрчил (Amendment C).**  Авалцан асах хэм яг 28.0 °C → `needs_human_review`,
  `source_boundary_conflict` (бичлэг `<= 28`, эх бичвэр `< 28`).  Багцыг засахгүй — эх
  сурвалжийн хоёрдмол утга нь ХҮНИЙ шийдвэр.
- **Шинэ тооцоолдог багц нэмэх** = `ai/norm-compiler/src/adapters/`-д адаптер + `compile.ts`-ийн
  `ADAPTERS` жагсаалт + `norm-compiler/test`-д багцын тоон утгын тест.  Хайлтын профайл
  (`retrieval/src/datasetProfiles.ts`) тусдаа — хоёулаа хэрэгтэй.

| Юу | Хаанаас |
|---|---|
| «Хувилбар зөрсөн» шошго | `/context` → `norm_trace.drift` (`registrySha` vs `localSha`) |
| Аль дүрэм/томьёо сонгогдов | `norm_trace.selected_records`, `rule`, `calculation.steps` |
| Хариулт template болов (validator) | `ai_messages.diag_json` → `contract.final = template`, `violations` |
| Follow-up алга | `TrustedNormResult.followups[].required` — гэрээ нь өгүүлбэрийг ЗААВАЛ нэмнэ |

### 9.1 Багцын чанар, төлөвийн бүртгэл, тусгаарлалт (Session A final pass, 2026-09-14)

```bash
cd ai
npm run ai:dataset:repr                       # DRY RUN: Python repr (`{'gt': 2200}`) бүхий мөр/файл
npm run ai:dataset:repr -- --write --check    # газар дээр нь засаж manifest sha-г шинэчилнэ; үлдвэл exit 1
npm run ai:ingest:norm -- <багц…> --verify --strict   # танигдаагүй баталгаажилтын төлөв → exit 1
npm run ai:norm:generate                      # багц өөрчлөгдсөн (repr) тул SHA шинэ → ДАХИН үүсгэ
npm run ai:train:split                        # сургалт ↔ үнэлгээ давхцал (train/val 0 байх ЁСТОЙ)
```

- **GAP-023 — Python repr багцад ОРОХГҮЙ.**  `retrieval/src/reprText.ts` (`normalizeReprText`) нэг
  хэрэгжүүлэлт: `{'gt': 2200}` → `> 2200`, `{'min': a, 'max': b}` → `a–b`, СНиП хавсралтын
  `{'without_used_attic': 51, …}` → «дээврийн хөндий ашиглахгүй (without_used_attic): 51 %» — эх
  түлхүүр хаалтанд ҮЛДЭНЭ (утга/мөшгөлт алдагдахгүй).  Шингээлт (`datasetProfiles.ts`) ЯГ ижил
  функцээр цэвэрлэдэг; `scripts/normalize-dataset-repr.mjs` түүхий багцыг засна (тасарсан alias-ыг
  зорилтот хэсгээс дахин угсарна).  2026-09-14: БД 21-101-12 (4 хэсэг ×3 талбар + 8 тест), СНиП
  (17 хэсэг + 17 alias + 13 aliases.json + 17 SFT) — Session C `dataset-lint --strict` PYTHON_REPR 0.
  ⚠️ `data-train-files/` gitignore-д тул багц авсан PC бүр `ai:dataset:repr -- --write` ажиллуулна.
- **GAP-025 — баталгаажилтын төлөв ГУРВАН ангитай** (`retrieval/src/rules.ts`): `EXECUTABLE_VERIFICATION`
  (эрх бүхий), `KNOWN_NON_EXECUTABLE_VERIFICATION` (шалтгаантай хаалт), танигдаагүй (хаалттай +
  тайлагнагдана; `ai:ingest:norm --strict` exit 1; `norm-compiler` ЗОГСОНО).  Мөрийн зарласан төлөв
  (`source.` / `answer_source.verification_status`) баримтын өгөгдмөл `verified_official_text`-ээр
  ДАРАГДАХГҮЙ — өмнө нь БНбД 31-23-12 (`official_mcis_pdf`, 349 дүрэм) ба 31-24-22
  (`registered_full_text`, 395 дүрэм) ЧИМЭЭГҮЙ эрх бүхий болсон байв.  Тэр өдөр хоёулаа
  хаалттай байсан (алтан 97 → 78/111, 23 «хаалттай» гэж ил).  **Эзний шийдвэр (2026-09-14, follow-up):**
  `official_mcis_pdf` ба `registered_full_text` хоёрыг **эх сурвалжийн эрхээр** `EXECUTABLE_VERIFICATION`-д
  ил нэмэв → алтан 97/111 буцав (31-23-12 11/13, 31-24-22 14/16 — үлдсэн 4 нь ангиллын оролт, тусдаа).
  ⚠️ Эх сурвалжийн эрх ≠ хүчин төгөлдөр байдал: дүрэм «executable source» +
  `CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED` хоёулаа байж болно; хуулийн төлөв `currentness.ts`-ийн
  тусдаа машинаар (эшлэлд `legal_review_required: true` хэвээр).  Багцын өөрийн хаалт
  (`usable_for_current_compliance: false`, 31-24-22-ын 4 мөр) эзний whitelist-ээс ДЭЭГҮҮР — доошлуулна;
  `true` туг ХЭЗЭЭ Ч дээшлүүлэхгүй; танигдаагүй төлөв хаалттай; зарласан төлөв өгөгдмөлөөр солигдохгүй
  (31-23-12-ын `official_legalinfo`, 31-24-22-ын `official_order` төлөвийн хэсэг тус бүр 1 — бүртгэлтэй хаалттай).
- **GAP-026 — тестийн id `<doc_id>::<test_id>`** (шингээлтэд аль хэдийн); багц ДОТОРХ давхардал одоо
  алдаа (өмнө нь `INSERT OR REPLACE` чимээгүй дардаг байв); `retrieval/test/testIdCollision.test.ts`
  бүх локал багцыг нэг санд оруулж давхцалгүйг батална (түүхий id 481 бүлэгт баримт хооронд давхцдаг).
  21-04-05-ын 336 тест `test_id`-гүй → байрлалаар `Q0001…` (анхааруулга, багцын дутагдал).
- **GAP-024 — `training/split-manifest.json`**: train/val/test = `training/out/behavior-sft-*`; eval =
  held-out + GOLD suite + багцын тест/кейс; `excluded_from_training` = багцын `domain_sft_verified` /
  `sft_seed` (үнэлгээний толь — qa тестийн ЯГ ижил асуулт, ямар ч сургалтын скрипт уншдаггүй).
  `ai:train:split` хэмжсэн: train/val ↔ eval яг 0 · ойролцоо 0; хассан ↔ eval 1186 яг / 54 ойролцоо
  (Session C training-lint 902/54 — уншсан eval багц өөр).  Мэдлэг устгаагүй — дахин ангилсан.
- **GAP-032 — зангуу үг (`anchorTerms`, `pipeline.ts`).**  «Лифтний хонгилын хананы галд тэсвэрлэх
  хугацаа» → 31-23-12 §6.3.6 (ХОЛБОХ хонгил, REI45) зээлэгдэж байв: «хонгил» + «хана» давхцлын
  босго давдаг, «лифт» (корпусын 0.16 %) хэсэгт байхгүй.  Кирилл асуултын эхний хоёр агуулгын
  токеноос ≤0.5 % (эсвэл ≤5 хэсэг) давтамжтай хамгийн ховрыг ЗӨВХӨН босго дээрх (ov = need)
  FTS хэсгээс шаардана — Recall@5 96.6 % (2854/2955) ЯГ хэвээр, лифт → `insufficient_evidence /
  no_content_overlap`.  Бүх асуултад шаардвал −50, англи асуултад дүрмийн үг зангуу болдог (хэмжсэн).
- **GAP-022** — `normEntities.ts`: «2 200 МДж/м²», «2 200 мджм2», «g ni/нь 2200», «1800,5» (аравтын),
  «24,000» (мянгат); **«1.800» ХОЁРДМОЛ** → хөдөлгүүр `insufficient_context` («мянгат уу, аравтын уу»),
  таамаглахгүй — Session C-ийн todo тест 1800 гэж хүлээдэг, эзний зааврын дагуу ЗОРИУД зөрүү.
