# 2-2-rule-model — хувилбартай дүрмийн загвар, багийн дүрмийн багц, хамаарлын хөдөлгүүр, нэгж, зөрчилдөөн, ноцтой байдал

> **Track:** 2 · REGULATORY INTELLIGENCE (зүйл 2 — дүрмийн суурь)
> **v2 хэсэг:** §10 (RULE EXTRACTION) · §11 (REGULATORY RULE ENGINE) · §61 (RULE APPLICABILITY ENGINE) · §62 (UNITS / GEOMETRY / COORDINATE SAFETY) · §64 (CONFLICTING RULES) · §67 (SEVERITY AND RISK MODEL) · §83-ын 3, 4, 5, 6-р суурь
> **Хамаарал (depends on):** `2-1-team-context` — `team_code TEXT` гэрээ, багийн шийдэлтийн шат, `team_attributions`. `2-0-OWNER-BRIEF` — R2/R3/R5/R6-ийн эх бичвэр. Эдгээргүйгээр дүрмийг ХЭНД хамаарахыг илэрхийлэх талбар байхгүй.
> **Блоклож буй (blocks):** `2-3-compliance-engine` (эдгээр дүрмийг ГҮЙЦЭТГЭНЭ) · `2-5-finding-surface` (олдвор эдгээр заалтыг ЭШЛЭНЭ) · `2-6-team-training` (`rule_test_cases` нь golden корпус болно) · `2-7-readiness-and-quality` (бэлэн байдлыг severity-ээр тоолно).
> **Хөндөх файлууд:** `backend/migrations/0220_regulatory_documents.sql` (ШИНЭ), `backend/migrations/0221_rules.sql` (ШИНЭ), `backend/migrations/0222_rule_conflicts_tests.sql` (ШИНЭ), `backend/migrations/0223_project_context_packs.sql` (ШИНЭ), `backend/src/lib/complianceModel.ts` (ШИНЭ), `backend/src/lib/ruleApplicability.ts` (ШИНЭ), `backend/src/lib/ruleApplicability.test.ts` (ШИНЭ — §3.13.1-ийн TS ↔ C# тулгалтын нэг тал), `backend/src/lib/rulePack.ts` (ШИНЭ), `backend/src/routes/compliance.ts` (ШИНЭ), `backend/src/index.ts`, `backend/src/lib/modules.ts`, `revit-mcp/addin/Units.cs` (ШИНЭ), `revit-mcp/addin/RuleFacts.cs` (ШИНЭ), `revit-mcp/addin/RuleEngine.cs` (ШИНЭ), `revit-mcp/addin/RulePack.cs` (ШИНЭ), `revit-mcp/training/check_rules.py` (ШИНЭ). **ӨӨР ФАЙЛ БАЙХГҮЙ.**
> **Deploy тоо:** 2 (1 × `d1 migrations apply` → 1 × `wrangler deploy`). Migration 4. Add-in (C#) — ЭНЭ СЕССИД ЗӨВХӨН БИЧНЭ, НЭГ РЕЛИЗИД `2-3`, `2-4`, `2-8`-тай хамт л тарна. Frontend deploy ШААРДЛАГАГҮЙ.

---

## 0. ЭНЭ СЕССИЙН ДҮРЭМ

**Хамрах хүрээ (scope).** Дүрмийн ӨГӨГДЛИЙН ЗАГВАР ба хамаарлын хөдөлгүүр. Дүрмийг ГҮЙЦЭТГЭХ давхарга (`ComplianceScheduler`, coalescer, олдворын амьдралын мөчлөг) нь `2-3`-ынх. Багийн илрүүлэлт нь `2-1`-ийнх. Энэ сесс нь эдгээрийн аль нэгийг Ч хэрэгжүүлэхгүй — зөвхөн тэдгээрийн уншдаг хүснэгт, гэрээ, цэвэр функцийг гаргана.

**Бусад агентуудтай зэрэг ажиллаж байна.** Ажлын мод дээр өөр агентын дуусаагүй, магадгүй КОМПАЙЛ ХИЙГДЭХГҮЙ өөрчлөлт байж болно. Дээрх «Хөндөх файлууд» жагсаалтад ОРООГҮЙ ямар ч файлыг үүсгэх/засах/устгахгүй. Бүтэн build унасан бол эхлээд алдаа нь ЧИНИЙ файлууд дээр эсэхийг шалга.

**Deploy хийж болох уу?** Тийм — migration эхэлж, дараа нь worker. Гэхдээ **шинэ багана нь түүнийг уншдаг кодоос ХАТУУ ӨМНӨХ deploy-д гарна**.

**ЭНЭ СЕССИД ХЭЗЭЭ Ч ХИЙЖ БОЛОХГҮЙ:**

| ⛔ | Дүрэм | Яагаад |
|---|---|---|
| 1 | `/api/*` дээр `purpose === 'mcp'` токеныг ТАТГАЛЗУУЛАХГҮЙ | Add-in бүх REST дуудлагаа 365 хоногийн mcp токеноор гарын үсэг зурдаг, refresh урсгал БАЙХГҮЙ. ~20 компьютер, `Install.bat`, Revit хаалттай — АЛСААС СЭРГЭЭХ БОЛОМЖГҮЙ ЦОРЫН ГАНЦ өөрчлөлт. Тогтоосон газар: `backend/src/middleware/auth.ts:101-102`, `backend/src/types.ts:209-212`, `backend/src/lib/tokenValidity.ts:30-34` |
| 2 | `users` (19 cascade хүүхэд) ба `projects` (33)-ыг `migrations apply`-аар ДАХИН БАЙГУУЛАХГҮЙ | `migrations apply` файл бүрийг transaction дотор ороодог — тэнд cascade АЖИЛЛАДАГ. Эцгийг drop хийхэд бүх хүүхэд мөр АРИЛНА. §61-ийн 12 оролт `projects`-д БАГАНА БОЛЖ ОРОХГҮЙ; тусдаа `project_build_context` хүснэгт болно |
| 3 | Migration нь ЗӨВХӨН НЭМЭГДЭНЭ. Хэрэгжсэн файлыг засах нь продакшн дээр ЧИМЭЭГҮЙ NO-OP | Бичихийн ӨМНӨ `ls backend/migrations \| tail -5` ажиллуул. `0120_norm_catalog.sql` нь хэрэгжсэн — түүнийг `gen-norm-seed.mjs`-ээр дахин үүсгэх нь ЮУ Ч ХИЙХГҮЙ (§2.2) |
| 4 | Trigger дотор `END;` нь ТОМ ҮСГЭЭР, ӨӨРИЙН МӨРӨНД | wrangler-ийн задлагч регистр мэдэрдэг. Энэ сессийн 4 файлын аль нь ч trigger агуулахгүй — гэхдээ `2-5` агуулна |
| 5 | Инференс нь итгэмжлэгдсэн зам дээр ХЭЗЭЭ Ч БАЙХГҮЙ | `RevitToolEventHandler.Execute`-д биш (⛔ гэрээ `RevitToolBus.cs:442-454`), `ChangeTracker.OnDocumentChanged`-д биш (⛔ гэрээ `ChangeTracker.cs:764-775`). `RuleEngine.cs` нь ЦЭВЭР — LLM дуудлага байхгүй |
| 6 | `DocumentChanged` дотор баримт бичиг УНШИХ ГОРИМД | Transaction байхгүй, элемент өөрчлөхгүй, `Regenerate()` байхгүй, ДИСК БИЧИЛТ БАЙХГҮЙ, сүлжээ байхгүй. Түүнийг орлуулсан сканнер 120+ секунд авдаг байсан |
| 7 | `ChangeTracker.Gate`-ийг tool-bus дуудлага / диск / await-ын туршид БАРИХГҮЙ | `OnDocumentChanged` нь transaction БҮРТ Revit-ийн үндсэн урсгал дээр `lock (Gate)` авдаг (`ChangeTracker.cs:800`) |
| 8 | `DockablePane.Show()`-г ХЭЗЭЭ Ч дуудахгүй | Цорын ганц `Show()` нь хэрэглэгчийн ribbon товч (`AssistantPaneProvider.cs:47-54`). Автоматаар нээх нь R7-ийн хамгийн магадлалтай регресс |
| 9 | `Gate` барьж болох урсгалаас `Dispatcher.Invoke` хийхгүй | UI урсгал өөрөө `lock (Gate)`-д тээглэж болно — хоёр урсгалын deadlock, хэрэглэгчид Revit өлгөгдсөн мэт харагдана |
| 10 | Бүх C# өөрчлөлт НЭГ релизид | Auto-update байхгүй, ~20 компьютер, `Install.bat`, Revit хаалттай. Хагас бэлэн релиз БҮХЭЛДЭЭ хойшилно |
| 11 | Салбарын олонлогийг `teams.code`-оос АЖИЛЛАХ ҮЕД унших | 7, 8, 9, 11 гэж хатуу бичихгүй. **Бүртгэл нь ЭЗЭН БАТАЛСАН (2026-08-30): НАЙМАН салбарын баг** — BA · BB · HAS · TSBU · TSAH · HD · AU · IZ (v2 §46). Гэхдээ `teams` хүснэгтэд **11 мөр** байна (`0007_teams.sql:39-47` нь дээрх 8 + `MGMT`, `0074_seed_ez_gt_teams.sql:12-14` нь `EZ` + `GT`), тиймээс 8 гэдэг нь **ТӨЛӨВЛӨЛТИЙН тоо** (хэдэн багц зохиох вэ), КОМПАЙЛ ХИЙХ ЛИТЕРАЛ БИШ. `MGMT`, `EZ`, `GT` нь багцгүй → v2 §48-ын `TEAM = UNCERTAIN`, ЮУТАЙ Ч тулгагдахгүй |
| 12 | Өөр агентын хадгалаагүй ажилд ХҮРЭХГҮЙ | `git restore` / `checkout --` / `stash` / `reset` / `git add -A` — аль нь ч БАЙХГҮЙ |

---

## 1. КОНТЕКСТ

### Систем (хүйтэн сессид хангалттай хэмжээгээр)

| Хэсэг | Юу вэ |
|---|---|
| `backend/` | Cloudflare Worker — `@cloudflare/workers-oauth-provider` дотор Hono. D1 + R2 + KV + нэг Durable Object + Workers AI |
| `frontend/` | Vite + React 19 SPA, Cloudflare Pages төсөл `mgl-design-system` |
| `revit-mcp/addin/` | Revit 2024–2027 C#/WPF add-in, 46 `.cs` файл, ТЕСТ БАЙХГҮЙ, AUTO-UPDATE БАЙХГҮЙ, ~20 ажилтны компьютер |
| Migration | `backend/migrations/`, `NNNN_name.sql`, зөвхөн нэмэгдэнэ. Дискэн дээрх хамгийн өндөр нь **`0216_assistant_log_timing.sql`**, нийт **206 файл** (2026-08-30-нд `ls backend/migrations \| tail -8` + `wc -l`-ээр хэмжив) |
| Багууд | `teams` — нийт **11 мөр**: `0007_teams.sql:39-47` нь 9-ийг (BA, BB, HAS, TSBU, TSAH, HD, AU, IZ, MGMT), `0074_seed_ez_gt_teams.sql:12-14` нь EZ + GT-г тарьдаг. **ЭЗЭН БАТАЛСАН (2026-08-30): дүрмийн багц авах нь НАЙМАН салбарын баг** — BA · BB · HAS · TSBU · TSAH · HD · AU · IZ (`teams.sort_order`-ын дараалал; v2 §46). Тэр найм нь шипсэн `IMPLEMENTED_TEAMS`-тэй ЯГ ижил (`frontend/src/features/projects/team-reports/TeamReportsTab.tsx:52-61`). **MGMT, EZ, GT — БАГЦГҮЙ** |

### Платформын хатуу хязгаарууд (энэ даалгаварт хамаарах хэсэг)

- **D1 нь statement бүрт 100 bind.** `bimEvents.ts:313-329`-ийн `rowsPerStatement(binds) = floor(100 / (binds + 1))` — нэг баганын нөөцийг ЗОРИУДААР үлдээдэг.
- **`migrations apply` нь тээврийн дүрэмтэй** — §2.12.
- **D1 нь ажиллах үед FK-г ХЭРЭГЖҮҮЛДЭГГҮЙ**, гэхдээ `migrations apply`-ын transaction дотор cascade АЖИЛЛАДАГ.
- **Add-in-д auto-update БАЙХГҮЙ.** Тоо солих нь публикац, `if` солих нь 20 компьютер дахин суулгах.

### Яагаад энэ даалгавар байна вэ

1. **Дүрмийн загвар ОГТ БАЙХГҮЙ.** `grep -rn "compliance\|_findings\|rule_versions\|regulatory" backend/migrations backend/src` нь хоосон буцаадаг. v2 §83-ын 3 (баримтын бүртгэл), 4 (хувилбартай дүрэм), 5 (хамаарлын хөдөлгүүр), 6 (детерминист тооцоолол) — ДӨРВҮҮЛЭЭ шинэ талбай.
2. **Байгаа цорын ганц «норм»-ын хүснэгт нь НОМ ЗҮЙ, бүртгэл БИШ** — `norm_items` нь код + гарчиг л агуулна (§2.1). Заалт байхгүй тул ямар ч олдвор «БНбД 31-03» гэхээс хэтэрч эшлэх боломжгүй.
3. **Каталогийг ЗОРИУДААР баггүй болгосон** (§2.4) — эзний R3 («баг бүрийн дүрэм өөр») яг үүнийг буцааж нэхэж байна. **ЭЗЭН БАТАЛСАН (2026-08-30):** тэр «баг бүр» нь НАЙМАН салбарын баг (BA · BB · HAS · TSBU · TSAH · HD · AU · IZ), MGMT/EZ/GT-г ОРУУЛАХГҮЙ (v2 §46).
4. **Тоонууд нь БАТАЛГААЖААГҮЙ** гэдгийг репо өөрөө хоёр газар зарлачихсан (§2.6, §2.7) — тиймээс дүрэм өнөөдөр «VIOLATION» гэж хэлж БОЛОХГҮЙ.
5. **`learning_events.rule_id` нь аль хэдийн үүсгэгдсэн, индекслэгдсэн** (§2.10) — дүгнэлт бичих суудал БЭЛЭН, бөглөх дүрэм нь алга.

---

## 2. БАТАЛГААЖСАН ОДООГИЙН ЗАН ТӨЛӨВ

> Доорх `file:line` бүрийг энэ сесс өөрөө нээж баталгаажуулав (**2026-08-30**, commit `6a8e4f5`).

### 2.1 `norm_items` нь НОМ ЗҮЙ — бүртгэл БИШ — батлагдсан

```
backend/migrations/0120_norm_catalog.sql:19   CREATE TABLE IF NOT EXISTS norm_items (
backend/migrations/0120_norm_catalog.sql:20     id          INTEGER PRIMARY KEY AUTOINCREMENT,
backend/migrations/0120_norm_catalog.sql:21     key         TEXT NOT NULL UNIQUE,            -- checkbox-ийн immutable түлхүүр
backend/migrations/0120_norm_catalog.sql:22     code        TEXT NOT NULL,
backend/migrations/0120_norm_catalog.sql:23     title       TEXT NOT NULL,
backend/migrations/0120_norm_catalog.sql:24     category_id INTEGER NOT NULL REFERENCES norm_categories(id) ON DELETE CASCADE,
backend/migrations/0120_norm_catalog.sql:25     position    INTEGER NOT NULL DEFAULT 0,
backend/migrations/0120_norm_catalog.sql:26     created_at  TEXT NOT NULL DEFAULT (datetime('now'))
backend/migrations/0120_norm_catalog.sql:27   );
```

| Юу БАЙХГҮЙ | Үр дагавар |
|---|---|
| `version` / `edition` | Ямар хэвлэлийг эшилснийг ХЭН Ч хэлж чадахгүй |
| `effective_from` / `superseded_by` | v2 §9 (баримтын хувилбарлалт) хэрэгжих суурьгүй |
| `clause` / `section` / `page` | v2 §11-ийн 8 мөшгих талбараас 3 нь ирж ЧАДАХГҮЙ |
| `threshold` / `unit` / `formula` | Тоо БАЙХГҮЙ. Тооцоолох юм алга |
| `team_code` / салбар | R3/R5/R6 холбогдох талбаргүй |
| `jurisdiction` | v2 §61-ийн 6-р оролт байхгүй |

`GET /api/norm-catalog` нь **ямар ч role хамгаалалтгүй** — `normCatalog.get('/', async (c) => {` (`backend/src/routes/normCatalog.ts:38`), харин бичилтүүд нь `requireAdmin()` (`:72`, `:149`, `:158`, `:198`) эсвэл `requireManager()` (`:109`, `:180`). Өөрөөр хэлбэл `client` ч бүх каталогийг уншина.

### 2.2 `0120` нь МАШИНААР ҮҮСГЭГДСЭН, БАС ХЭРЭГЖСЭН — дахин үүсгэх нь ЧИМЭЭГҮЙ NO-OP — батлагдсан

```
backend/migrations/0120_norm_catalog.sql:1    -- ⚙️ АВТОМАТААР ҮҮСГЭСЭН (scripts/gen-norm-seed.mjs) — гараар бүү засварла.
backend/migrations/0120_norm_catalog.sql:2    -- Эх сурвалж: frontend/.../norm/catalog.ts · 8 ангилал, 69 норм.
```

Үүсгэгчийн гаралт нь ХАТУУ БИЧИГДСЭН:

```
backend/scripts/gen-norm-seed.mjs:9    // Гаралт:      migrations/0120_norm_catalog.sql
backend/scripts/gen-norm-seed.mjs:30   const outPath = join(here, '..', 'migrations', '0120_norm_catalog.sql');
backend/scripts/gen-norm-seed.mjs:103  writeFileSync(outPath, header + schema + '\n' + statements.join('\n\n') + '\n', 'utf8');
```

⚠️ **`0120` нь аль хэдийн хэрэгжсэн migration.** `node scripts/gen-norm-seed.mjs` ажиллуулах нь дискэн дээрх файлыг л дарж бичнэ; `d1_migrations`-д тэр нэр аль хэдийн байгаа тул продакшн дээр ЯМАР Ч НӨЛӨӨГҮЙ. **Норм нэмэх бүрт ШИНЭ ДУГААР авна.** Энэ сессийн 4 файл нь `0120`-д ХҮРЭХГҮЙ — тэдгээр нь дэргэд нь шинэ хүснэгтүүд байгуулна.

### 2.3 Өндөр барилгын анкер нь ЯГ НЭГ мөр, салбарын харьяалалгүй — батлагдсан

```
backend/migrations/0120_norm_catalog.sql:75   ('norm_bnbd_31_17_10', 'БНбД 31-17-10', 'Өндөр барилга, өндөр цогцолборын төлөвлөлт', 3, 80),
```

`category_id = 3` (`urban`), `position = 80`. **Салбарын багана байхгүй тул энэ мөр нь BA-д ч, IZ-д ч, HAS-д ч харьяалагдахгүй.** Хажуугийн өндөр барилгад холбогдох мөрүүд (мөн бүгд салбаргүй):

| Мөр | Код | Гарчиг |
|---|---|---|
| `:45` | БНбД 23-04-07 | Орон сууц, олон нийтийн барилгын нарны тусгал (инсоляц) |
| `:47` | БНбД 25-01-20 | Барилгын дулаан хамгаалалт |
| `:51` | БНОД 22-01-21 | Газар хөдлөлтийн бүс нутагт барилга төлөвлөх |
| `:53` | БНбД 21-01-02 | Барилга байгууламжийн галын аюулгүй байдал |
| `:54` | БНбД 21-02-02 | Зураг төслийн галын норм |
| `:58` | БД 21-102-12 | Барилга байгууламжийн утааны эсрэг хамгаалалт |
| `:75` | **БНбД 31-17-10** | **Өндөр барилга, өндөр цогцолборын төлөвлөлт** |
| `:76` | БНбД 35-01-22 | Хөгжлийн бэрхшээлтэй иргэдэд зориулсан барилгын төлөвлөлт |
| `:82` | БНбД 40-02-12 | Усан хангамж |

⚠️ **ЦАХИЛГААН ШАТНЫ НОРМ КАТАЛОГТ БАЙХГҮЙ.** 69 мөрийн дунд лифт/цахилгаан шатны нэг ч код алга. Эзний өндөр барилгын брифийн лифтийн хэсэгт өнөөдөр ЭШЛЭХ БАРИМТ БАЙХГҮЙ (§9).

### 2.4 Каталогийг ЗОРИУДААР баггүй болгосон — батлагдсан

```
frontend/src/features/projects/team-reports/norm/catalog.ts:5-7
 * Төслийн хэмжээний "Норм дүрэм" таб энэ жагсаалтыг checkbox-оор
 * харуулна. Өмнө нь 7 баг тус бүр өөрийн жижиг норм жагсаалттай
 * байсныг (давхардсан) нэг канон жагсаалтаар сольсон — багуудын
 * норм кодуудыг бүгдийг нь энд шилжүүлж аль нэгийг ч алдаагүй.
```

Мөн тэр файлын толгойд:

```
frontend/src/features/projects/team-reports/norm/catalog.ts:10-13
 * 8 бүлгээр зохион байгуулсан. ЖАГСААЛТ БҮРЭН БУС — БНбД нь олон
 * зуугаар тоологдож, жил бүр шинэчлэгддэг тул шинэ кодыг энэ
 * файлд нэмж өргөтгөнө. Хүчин төгөлдөр эсэхийг mcis.gov.mn-ээс
 * шалгана.
```

⚠️ Хоёр дүгнэлт. Нэг: **«7 баг тус бүр өөрийн норм жагсаалттай» байсан нь ТҮҮХЭН БАРИМТ** — эзний R3 нь шинэ санаа биш, буцаах хүсэлт. Хоёр: **каталогийн хүчин төгөлдөр байдал БАТАЛГААЖААГҮЙ гэдгийг файл өөрөө хэлдэг** — каталогт байгаа нь «хүчинтэй» гэсэн үг БИШ.

⚠️ **Дээрх «7» нь ТҮҮХЭН ТОО, өнөөдрийн бүртгэл БИШ.** Тэр тайлбар нь нэгтгэлийн ӨМНӨХ (IZ-д норм жагсаалт байгаагүй) байдлыг тэмдэглэсэн — файлын бичвэрийг ЗОРИУД хэвээр иш татав. **Өнөөдрийн бүртгэл нь ЭЗЭН БАТАЛСАН (2026-08-30) НАЙМАН салбарын баг** (BA · BB · HAS · TSBU · TSAH · HD · AU · IZ, v2 §46), тэр найм тус бүр өөрийн багц авна.

### 2.5 57 өнчирсөн `norms_*` тугнууд — уншигч ТЭГ — батлагдсан

```bash
cd frontend/src/features/projects/team-reports
grep -rn "norms_" ba/types.ts bb/types.ts has/types.ts cbu/types.ts \
                  tsah/types.ts hd/types.ts au/types.ts iz/types.ts | wc -l
```

Хэмжсэн гаралт:

```
57
```

| Баг | Файл:мөр | Тоо | Жишээ түлхүүр |
|---|---|---|---|
| BA | `ba/types.ts:50-55` | 6 | `norms_fire` (// БНбД 21-01-02 / 21-02-02), `norms_accessibility` (// БНбД 35-01-22), `norms_thermal` (// БНбД 25-01-20) |
| BB | `bb/types.ts:26-38` | 13 | `norms_bnbd_50_01_16`, `norms_bnod_22_01_21`, `norms_bnbd_31_17_10`, `norms_bnbd_20_04_17` |
| HAS | `has/types.ts:22-29` | 8 | `norms_bnbd_41_01_11`, `norms_bnbd_31_17_10`, `norms_mns_6058` |
| TSBU (`cbu/`) | `cbu/types.ts:25-32` | 8 | `norms_bnbd_40_02_12`, `norms_bnbd_31_17_10`, `norms_mns_6502` |
| TSAH | `tsah/types.ts:21-29` | 9 | `norms_bnbd_31_17_23`, `norms_bd_43_105_12`, `norms_mns_iec_60364` |
| HD | `hd/types.ts:20-26` | 7 | `norms_mns_5532`, `norms_mns_6586`, `norms_mns_iec_62305` |
| AU | `au/types.ts:32-37` | 6 | `norms_mns_iso_16484`, `norms_mns_kn_x` |
| **IZ** | — | **0** | **БАЙХГҮЙ** |

Уншигч байхгүй нь батлагдсан:

```bash
grep -rn "norms_" --include="*.ts" --include="*.tsx" frontend/src backend/src | grep -v "/types.ts:"
```

Хэмжсэн гаралт:

```
(хоосон — exit code 1)
```

⚠️ **Энэ бол фирмийн ӨӨРИЙН, инженерүүдийн бичсэн, салбар бүрийн норм зураглал** — `2-6`-ийн `team_rule_scope`-ын үр. Кодоос устгах гэсэн ямар ч «ашиглагдаагүй экспорт цэвэрлэх» ажил үүнийг АВЧ ОДНО, тиймээс §3.14-т эхлээд хураана.

⚠️ **`БНбД 31-17-10` нь НАЙМАН салбарын 6-д нь бий** (`bb/types.ts:36`, `has/types.ts:24`, `cbu/types.ts:30`, `tsah/types.ts:27`, `hd/types.ts:20`, `au/types.ts:32`) — **BA ба IZ-д БАЙХГҮЙ**. Энэ бол `norm_items`-д `team_code` БАГАНА нэмэх нь буруу гэдгийн эмпирик нотолгоо: харьцаа нь олон-олон. **IZ-д ЮУ Ч БАЙХГҮЙ — түүний багцыг ЗОХИОНО, хурааж авахгүй** (§3.14.1-ийн дараалал: IZ нь эзний тэргүүлэх ач холбогдлоор ХОЁРДУГААРТ, гэхдээ хураах материалгүй).

⚠️ **Дээрх найман мөр нь ЭЗНИЙ БАТАЛСАН (2026-08-30) БҮТЭН бүртгэл** — v2 §46-ийн 8 салбар, `IMPLEMENTED_TEAMS` (`TeamReportsTab.tsx:52-61`)-тэй ЯГ таарна. `MGMT`, `EZ`, `GT`-д `norms_*` туг ч, багц ч БАЙХГҮЙ.

### 2.6 Репо дэх тоонууд нь БАТАЛГААЖААГҮЙ гэж ӨӨРӨӨ зарласан — батлагдсан

```
revit-mcp/CLAUDE.md:7-11
> ⚠️ The figures below are **design-guidance values** distilled from public
> sources (see *Sources*). They are good enough for schematic modeling and demos.
> For a real permit set, verify each number against the current official БНбД /
> MNS document — codes are revised often (most were renumbered to the `-21`/`-22`/
> `-23` editions).
```

Тэр «доорх тоонууд» нь `revit-mcp/CLAUDE.md:59-116`-ийн §3 — хонгилын өргөн ≥1.2 м (урт ≤10 м) / ≥1.5 м (>10 м) (`:64-66`), нүүлгэн шилжүүлэх хаалга ≥1.2 м (`:67-68`), дотоод хаалга ≥0.9 / ≥0.8 м (`:69-70`), таазны цэвэр өндөр ≥2.4 м, хонгил ≥2.2 м, техникийн гарц ≥1.8 м (`:76-78`), налуу зам ≤5 % / өргөн ≥0.9 м (`:85-86`), инсоляц 3–4 ц/өдөр (`:94-96`), нүүлгэн шилжүүлэх шатны галд тэсвэрлэлт ≥2 ц (`:106`), MSK 5/6/7/8/9 ≈ 25/50/100/200/400 см/с² (`:109-110`).

### 2.7 Golden `rules` хуваарь ХООСОН БАС ХӨЛДӨӨСӨН — батлагдсан

```
revit-mcp/eval/golden/rules.json
{
 "_note": "GOLDEN-EVAL · дүрмийн хөдөлгүүр (БНбД хэмжээс).  ХООСОН ШИЛЖИНЭ — revit-mcp/CLAUDE.md:59-116-ийн тоонууд нь өөрсдөө «design-guidance, албан ёсны БНбД-тэй тулгаагүй» тул golden болгож ХӨЛДӨӨЖ БОЛОХГҮЙ (§9-ийн 3-р асуулт).",
 "partition": "rules",
 "frozen": true,
 "preprocess_contract": "fold-v1",
 "rows": []
}
```

Хажууд нь `revit-mcp/eval/golden/bim.json` мөн `"rows": []` бөгөөд «⚠️ Хоосныг АЛГАСАХГҮЙ: `--kind bim` загвар энэ файл дүүрэх хүртэл БЛОКЛОГДОНО (§3.4)» гэж бичсэн.

⚠️ **§2.6 + §2.7 хамтдаа нэг л дүгнэлт өгнө: өнөөдөр дүрэм «VIOLATION» гэж хэлж БОЛОХГҮЙ.** Энэ нь §3.5-ын `verification_state` ХАВЧААРЫН БҮХ ҮНДЭСЛЭЛ.

### 2.8 Өндөр барилгын босго нэг биш, ДӨРӨВ — батлагдсан

| # | Босго | Хаана | Бодит текст |
|---|---|---|---|
| 1 | **51 м ЭСВЭЛ 16 давхар** | `frontend/.../project-sections/generalTemplate.ts:86` | `hint: 'Онцгой: 51м-ээс дээш эсвэл 16 давхраас дээш барилга.',` |
| 2 | **30 м** | `frontend/.../bb/template.ts:309` | `hint: '30м-ээс өндөр барилгад заавал хийнэ.',` (салхины резонансын шалгалт) |
| 3 | **21 давхар** | `frontend/.../bb/template.ts:173` | `hint: 'МАКС ӨРГӨӨ хурлын зөвлөмжийн дагуу 21 давхрын өндөр барилгад бүрэн цутгамал хийц зөвлөмж болгодог.',` |
| 4 | **15-р давхар** | `frontend/.../hd/template.ts:101-105` | `label: '15-р давхраас дээш гар утасны сүлжээ өргөгч'` + `hint: 'Өндөр давхар нь шилэн фасадны нөлөөгөөр сүлжээ унах боломжтой.'` |

Мөн тоогүй, зөвхөн «өндөр барилгад» гэсэн хоёр дүрэм:

```
frontend/src/features/projects/team-reports/has/template.ts:90    hint: 'БНбД 31-17-10 дагуу өндөр барилгад бүсчлэх шаардлагатай.',
frontend/src/features/projects/team-reports/cbu/template.ts:86    hint: 'Өндөр барилгад заавал бүсчилнэ.',
frontend/src/features/projects/team-reports/bb/template.ts:151    hint: 'Өндөр барилгад 15см-ээс ихгүй (БНбД 50-01-16).',
```

⚠️ **`is_high_rise` ГЭСЭН ГАНЦ БУЛЬ БАЙХГҮЙ, БАС БАЙЖ БОЛОХГҮЙ.** 51 м / 16 давхар нь БАРИМТЫН БАГЦЫГ нээдэг; үлдсэн гурав нь тус тусын дүрмийн өөрсдийн хаалга. Дөрөв нь дөрвөн `applicability` болно (§3.6).

⚠️ **Өндөр ба давхрын тоо нь өнөөдөр ЧӨЛӨӨТ ТЕКСТ:**

```
frontend/src/features/projects/team-reports/ba/types.ts:18   height: string; // e.g. "12.5 м"
frontend/src/features/projects/team-reports/ba/types.ts:19   floors: string; // e.g. "3"
frontend/src/features/projects/team-reports/ba/types.ts:74   plan_above_ground_floors?: string;
```

Тэдгээр нь `project_team_reports.answers_json` доторх JSON тул query хийх боломжгүй. Тиймээс `project_build_context` (§3.4) шаардлагатай.

### 2.9 §62 — нэгжийн одоогийн байдал — батлагдсан

**Revit-ийн дотоод уртын нэгж нь аравтын ФУТ; БНбД-ийн тоо бүр метрийн.** Add-in дахь бүх хөрвүүлэлт (8 газар, 7 нь `QtoExtractor.cs`-д):

```
revit-mcp/addin/QtoExtractor.cs:152   ReadConverted(e, BuiltInParameter.HOST_AREA_COMPUTED, UnitTypeId.SquareMeters);
revit-mcp/addin/QtoExtractor.cs:154   ReadConverted(e, BuiltInParameter.HOST_VOLUME_COMPUTED, UnitTypeId.CubicMeters);
revit-mcp/addin/QtoExtractor.cs:357   double mm = UnitUtils.ConvertFromInternalUnits(layer.Width, UnitTypeId.Millimeters);
revit-mcp/addin/QtoExtractor.cs:462   double? v = ReadConverted(e, bip, UnitTypeId.Meters);
revit-mcp/addin/QtoExtractor.cs:510   density = UnitUtils.ConvertFromInternalUnits(asset.Density, UnitTypeId.KilogramsPerCubicMeter);
revit-mcp/addin/GridDimensioner.cs:49 double offset = UnitUtils.ConvertToInternalUnits(3.0, UnitTypeId.Meters);
```

**ӨНЦӨГ / НАЛУУ ХӨРВҮҮЛЭЛТ ОГТ БАЙХГҮЙ.** `UnitTypeId.Degrees` / `Radians` нь 46 `.cs` файлын аль нь ч БАЙХГҮЙ. Revit-ийн дотоод өнцгийн нэгж нь РАДИАН — налуу замын ≤5 % / ≤5° дүрэм өнөөдөр бичигдвэл 0.0873-ыг 5-тай харьцуулж ҮРГЭЛЖ PASS буцаана.

⚠️ **`Round3OrNull`-ыг ДАХИН АШИГЛАХГҮЙ:**

```
revit-mcp/addin/QtoExtractor.cs:528   private static double? Round3OrNull(bool has, double value)
revit-mcp/addin/QtoExtractor.cs:529   {
revit-mcp/addin/QtoExtractor.cs:530       if (!has)
revit-mcp/addin/QtoExtractor.cs:531           return null;
revit-mcp/addin/QtoExtractor.cs:532       double rounded = Math.Round(value, 3);
revit-mcp/addin/QtoExtractor.cs:533       return rounded == 0 ? (double?)null : rounded;   // ← ЖИНХЭНЭ ТЭГ → NULL
revit-mcp/addin/QtoExtractor.cs:534   }
```

v2 §63 нь `zero` ба `missing input`-ыг **ТУСДАА** заавал тестлэх тохиолдол гэж жагсаадаг (`REVIT_BIM_AI_Architecture_Freeze_v2.md:2097-2108`). Энэ функц тэр хоёрыг нэг болгодог.

**Сервер тал нэгжийг ХАРДАГГҮЙ.** `backend/src/lib/teamReportFieldCatalog.ts` нь frontend template-үүдээс АВТОМАТААР ГАРГАСАН хуулбар (`:4-13` толгой) бөгөөд `CatalogField` нь `{ key, label, kind, variants?, options?, columns? }` (`:19-26`) — `suffix` ч, `hint` ч БАЙХГҮЙ:

```bash
grep -c "suffix\|hint" backend/src/lib/teamReportFieldCatalog.ts
```

Хэмжсэн гаралт:

```
0
```

⚠️ Өөрөөр хэлбэл MCP/AI-д хүрч буй бүх тоо НЭГЖГҮЙ, БАС бүх норм эшлэл (`hint`-д амьдардаг 20 мөр) СЕРВЕРТ ОГТ ХҮРДЭГГҮЙ. `rules.unit` нь `NOT NULL` байх ёстойн шалтгаан.

### 2.10 ҮНЭГҮЙ ХОЖИЛ — дүгнэлтийн суудал АЛЬ ХЭДИЙН БЭЛЭН — батлагдсан

```
backend/src/lib/bimEvents.ts:168        'RULE_VALIDATION',
backend/src/lib/bimEvents.ts:232        RULE_VALIDATION: ['RULE_VERDICT'],
backend/src/lib/bimEvents.ts:95         RULE_VERDICT: 32,
backend/src/lib/bimEvents.ts:740-741      case 'RULE_VERDICT':
                                            if (has(input.payload, 'rule_id') && has(input.payload, 'passed')) present.add(part);
backend/src/lib/bimEvents.ts:144        export const DATASET_ELIGIBLE_SQL = 'parts_missing = 0';
backend/src/lib/bimEvents.ts:302        export const CONTRACT_VERSION = 1;
backend/migrations/0209_bim_generated_indexes.sql:27   ALTER TABLE learning_events ADD COLUMN rule_id TEXT
backend/migrations/0209_bim_generated_indexes.sql:28     GENERATED ALWAYS AS (json_extract(payload_json, '$.rule_id')) VIRTUAL;
backend/migrations/0210_bim_generated_indexes_2.sql:20 CREATE INDEX IF NOT EXISTS idx_le_rule
backend/migrations/0210_bim_generated_indexes_2.sql:21   ON learning_events (rule_id, occurred_at) WHERE rule_id IS NOT NULL;
```

Дүгнэлт бүр `kind='RULE_VALIDATION'`, `payload_contract='v1:RULE_VALIDATION+RULE_VERDICT'`-аар бичигдэнэ. **Migration ч, `bimEvents.ts`-д засвар ч ШААРДЛАГАГҮЙ.** Энэ сесс нь `rule_uid`-ыг тэр `payload_json.rule_id`-д яг таарах хэлбэрээр гаргах ҮҮРЭГТЭЙ — өөр түлхүүрийн нэр зохиох нь тарьчихсан индексийг хаядаг.

### 2.11 Дүрэм нь ӨГӨГДӨЛ байх ЁСТОЙ — суваг нь бэлэн — батлагдсан

`intent-model.json` нь DLL дотор шигтгээстэй, гэхдээ сервер шинэчилж чаддаг:

```
revit-mcp/addin/RevitMcpAddin.csproj:134-137   <EmbeddedResource Include="Resources\intent-model.json"
                                                 Condition="Exists('Resources\intent-model.json')" />
revit-mcp/addin/IntentModel.cs:80              public const string PreprocessContract = "fold-v1";
revit-mcp/addin/IntentModel.cs:250-254         // 1) Татаж авсан шинэ загвар (байвал)  → LocalModelPath
revit-mcp/addin/IntentModel.cs:256-258         // 2) Add-in дотор шигтгэсэн суурь загвар → LoadEmbedded()
revit-mcp/addin/IntentModel.cs:311-312         if (!string.Equals(m.PreprocessContract, PreprocessContract, StringComparison.Ordinal))
                                                   return null;                 // ← ГЭРЭЭ ЗӨРВӨЛ ТАТГАЛЗАНА
revit-mcp/addin/ApiClient.cs:166-167           string path = "/api/revit/assistant/model";
                                               if (!string.IsNullOrEmpty(have)) path += "?have=" + Uri.EscapeDataString(have);
revit-mcp/addin/ApiClient.cs:179-181           if (root.TryGetProperty("unchanged", out JsonElement un) && un.ValueKind == JsonValueKind.True)
                                                   return null;
```

Гурван түвшний уналт (татсан → шигтгээстэй → байхгүй, `IntentModel.cs:249-268`) ба `catch { return null; }` (`ApiClient.cs:194-196`) нь v2 §75-ийн офлайн горим АЛЬ ХЭДИЙН хэрэгжсэн гэсэн үг. **`RulePack.cs` нь энэ файлын бараг хуулбар болно** — өөр загвар зохиох шаардлагагүй.

Add-in дээр `Units.cs`, `RuleFacts.cs`, `RuleEngine.cs`, `RulePack.cs` — дөрвүүлээ ОДООГООР БАЙХГҮЙ (`ls` нь `No such file or directory` дөрвөн удаа буцаана). Сервер тал дээр `complianceModel.ts`, `ruleApplicability.ts`, `rulePack.ts`, `routes/compliance.ts` мөн БАЙХГҮЙ.

### 2.12 Migration-ы тээврийн дүрэм — хэмжигдсэн — батлагдсан

```
backend/migrations/0209_bim_generated_indexes.sql:6-12
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ (2026-08-27-нд хаягдах алсын D1 дээр хэмжив).
-- `wrangler d1 migrations apply` нь файлыг d1_migrations-ийн INSERT-тэй
-- залгаад НЭГ --command болгож D1-ийн /query руу илгээдэг.  Тэр задлагч нь
--   (1) блок тайлбарыг (slash-star хэлбэр) ОЙЛГОДОГГҮЙ,
--   (2) мөрөн доторх ; -ээр ХУВААДАГ,
--   (3) нэг дуудлагад олон statement байвал унадаг.
-- Иймд ФАЙЛ БҮР <= 9 statement, блок тайлбаргүй, мөрөн дотор ; -гүй байна.
```

⚠️ **Энэ сессид дээд хязгаарыг 9 биш, 7 БОЛГОЖ хатууруулна.** 9 нь ХЭМЖИГДСЭН ТААЗ; 9 дээр зогсох нь ямар ч нөөцгүй гэсэн үг — review-д нэг индекс нэмэхэд файл хагас хэрэгжиж, `d1_migrations`-д мөр үлдэхгүй, дараагийн `apply` нь хагас үүссэн объект дээр дахин ажиллана. Statement бүр `IF NOT EXISTS` / `INSERT OR IGNORE` байх нь тэр тохиолдлыг ШИНЭ ДУГААРААР дахин ажиллуулах боломжтой болгоно.

`backend/package.json:18` — `"verify": "tsc --noEmit && node --test \"src/**/*.test.ts\" && node scripts/check-bim-events.mjs"`. `backend/src/lib/migrationSchema.test.ts` нь давхардсан `ALTER … ADD COLUMN` нэрийг барих харуул — ALTER бүрийн ӨМНӨ ажиллуулна (энэ сесс ALTER хийхгүй, гэхдээ дүрэм хүчинтэй).

---

## 3. ХИЙХ АЖИЛ

### 3.0 Дугаар авах

```bash
cd backend && ls migrations | tail -5
# Хүлээгдэх (2026-08-30): 0212 … 0216_assistant_log_timing.sql
```

**Track 2-ын хуваарилалтаар энэ баримт бичиг 0220–0223-ыг эзэмшинэ.**

⚠️ **ЗЭРЭГЦЭЭ СЕССҮҮД ДУГААР АВЧ БАЙНА.** `2-1-team-context` нь 0217–0220-ыг нэхэж болзошгүй. **Бичихийн ЯГ ӨМНӨ `ls migrations | tail -5` дахин ажиллуул.** Хэрэв 0220 аль хэдийн эзэлсэн бол ЭНЭ БЛОКИЙГ БҮХЭЛД НЬ нэгээр шилжүүл (0221–0224) — файлын нэр ба §5, §7, §8-ын бүх лавлагаа хамт шилжинэ. Репод аль хэдийн 6 давхардсан дугаар бий (0002, 0060, 0080, 0110, 0120, 0121) бөгөөд 0120 нь яг энэ сессийн сэдэв дээр давхардсан (`0120_norm_catalog.sql` ба `0120_qto_fields_rooms.sql`).

`REFERENCES`-ийн дүрэм: эдгээр 4 файлын хүснэгтүүд нь 0206-ийн ЗӨВХӨН НЭМЭГДЭХ trigger-т ХАМААРАХГҮЙ (тэр trigger-үүд нь зөвхөн `bim_artifacts`, `revit_transactions`, `revit_element_touches`, `learning_events`). Тиймээс `REFERENCES users(id)` энд ХУУЛЬ ЁСНЫ. Харин **эдгээр хүснэгтээс `bim_*` эсвэл `learning_events` рүү `REFERENCES` ХЭЗЭЭ Ч БИЧИХГҮЙ** — `ON DELETE SET NULL` нь хүүхдийн UPDATE болж, зөвхөн-нэмэгдэх trigger-ийг асааж, эцгийн DELETE-ийг БҮХЭЛД НЬ ABORT хийдэг (1B-1 §2.6-д хэмжсэн).

---

### 3.1 `0220_regulatory_documents.sql` — баримтын бүртгэл + заалт (§83-ын 3-р суурь)

**Statement тоо: 7** (2 CREATE TABLE + 5 CREATE INDEX). Таазанд 2 нөөцтэй.

```sql
-- =============================================================
-- 0220_regulatory_documents.sql — БНбД / БД / MNS баримтын БҮРТГЭЛ ба ЗААЛТ
-- =============================================================
-- ЗОРИЛГО: `norm_items` (0120) нь НОМ ЗҮЙ — код + гарчиг л агуулна.  Хувилбар,
-- хүчин төгөлдөр огноо, заалт, хуудас, босго БАЙХГҮЙ.  Тиймээс өнөөдөр ямар ч
-- олдвор «БНбД 31-03» гэхээс хэтэрч эшлэх боломжгүй бөгөөд v2 §11-ийн 8
-- мөшгих талбараас 3 нь (section, page, version) ирж ЧАДАХГҮЙ.  Энэ файл
-- тэдгээрийг зөвхөн НЭМНЭ — `norm_items`-д ХҮРЭХГҮЙ, тэр нь checkbox-ийн
-- тогтвортой түлхүүрээ хадгална.
--
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ: ФАЙЛ БҮР <= 7 statement (хэмжигдсэн тааз нь 9), блок
-- тайлбаргүй, мөрөн дотор ; -гүй.  Statement бүр IF NOT EXISTS.
--
-- ⚠️ `norm_item_key` нь `norm_items.key` рүү заана — ГЭХДЭЭ FK БИШ.  0120-ийн
-- DELETE нь заалтын түүхийг устгах ёсгүй, мөн бүртгэлд каталогт огт байхгүй
-- баримт (жишээ нь лифтийн норм) орж ирнэ.  Холбоос сул байх нь ЗОРИУД.
--
-- ⚠️ `edition` ба `effective_from` нь NULL байж БОЛНО — «бид хараахан албан
-- ёсны хэвлэлийг олж аваагүй» гэдгийг илэрхийлэх ЦОРЫН ГАНЦ арга.  Тэр NULL
-- нь 0221-ийн CHECK-ээр дамжин дүрмийг UNVERIFIED-д хорино.

CREATE TABLE IF NOT EXISTS regulatory_documents (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_uid        TEXT    NOT NULL UNIQUE,
  code           TEXT    NOT NULL,
  title_mn       TEXT    NOT NULL,
  title_en       TEXT,
  doc_family     TEXT    NOT NULL DEFAULT 'BNBD'
                   CHECK (doc_family IN ('BNBD','BD','BNOD','MNS','SNIP','IEC','ISO','GOST','INTERNAL','OTHER')),
  jurisdiction   TEXT    NOT NULL DEFAULT 'MN',
  edition        TEXT,
  effective_from TEXT,
  superseded_by  TEXT,
  status         TEXT    NOT NULL DEFAULT 'unconfirmed'
                   CHECK (status IN ('unconfirmed','in_force','superseded','withdrawn')),
  norm_item_key  TEXT,
  source_url     TEXT,
  artifact_id    INTEGER,
  acquired_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  acquired_at    TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_regdoc_code ON regulatory_documents (code, edition);

CREATE INDEX IF NOT EXISTS idx_regdoc_status ON regulatory_documents (status, jurisdiction);

CREATE INDEX IF NOT EXISTS idx_regdoc_norm_item ON regulatory_documents (norm_item_key) WHERE norm_item_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS rule_clauses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  clause_uid   TEXT    NOT NULL UNIQUE,
  document_uid TEXT    NOT NULL,
  clause_no    TEXT    NOT NULL,
  page_no      INTEGER,
  table_no     TEXT,
  text_mn      TEXT,
  text_source  TEXT    NOT NULL DEFAULT 'manual'
                 CHECK (text_source IN ('manual','pdf_extract','ocr','unknown')),
  verified_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  verified_at  TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_clause_doc ON rule_clauses (document_uid, clause_no);

CREATE INDEX IF NOT EXISTS idx_clause_verified ON rule_clauses (verified_at) WHERE verified_at IS NOT NULL;
```

`doc_uid` нь `BNBD-31-17-10`, `BNBD-21-01-02`, `BNOD-22-01-21` хэлбэрийн ТОГТВОРТОЙ мөр. `clause_uid` нь `BNBD-31-17-10#5.4.2`. Хоёулаа дүрмийн багц дотор ЯВНА, тиймээс DLL-д дугаар биш мөр очно.

---

### 3.2 `0221_rules.sql` — хувилбартай дүрэм + хамаарлын индекс (§83-ын 4, 5-р суурь)

**Statement тоо: 7** (2 CREATE TABLE + 5 CREATE INDEX). Таазанд 2 нөөцтэй.

```sql
-- =============================================================
-- 0221_rules.sql — ХУВИЛБАРТАЙ ДҮРМИЙН ЗАГВАР ба §52-ын ХАМААРЛЫН ИНДЕКС
-- =============================================================
-- ЗОРИЛГО: v2 §10-ын дүрмийн бүтэц + §61-ийн хамаарлын предикат + §62-ын
-- нэгж + §67-ын ноцтой байдал.
--
-- ⚠️ ХАМГИЙН ЧУХАЛ БАГАНА нь `verification_state`.  Тэр нь ГУРАВ ХАВЧИНА:
--   (1) дүгнэлт  — UNVERIFIED дүрэм ХАМГИЙН ИХДЭЭ 'WARNING', ХЭЗЭЭ Ч
--       'VIOLATION' биш.
--   (2) нотолгоо — `evidence_level` нь MODEL_DERIVED болж албадагдана,
--       ХЭЗЭЭ Ч RULE_BACKED биш.
--   (3) эшлэл   — UNVERIFIED дүрэм КОД, ЗААЛТ, ГАРЧИГ ХАРУУЛАХГҮЙ.  Зөвхөн
--       «дотоод шалгуур (эх сурвалж баталгаажаагүй)».
-- Яагаад: revit-mcp/CLAUDE.md:7-11 нь өөрийн тоонуудыг «design-guidance,
-- албан ёсны БНбД-тэй тулгаагүй» гэж зарласан, eval/golden/rules.json нь
-- тэднийг golden болгож хөлдөөхийг ХОРИГЛОСОН.  Ноцтой байдлыг бууруулаад
-- «БНбД 31-03» гэж хэвлэх нь архитекторыг мэргэжлийн шийдвэрээ
-- баталгаажаагүй тоон дээр тулгуурлуулна.
--
-- ⚠️ CHECK-ээр албадана: CLAUSE_CITED / HUMAN_VERIFIED дүрэм нь clause_uid,
-- edition_ref, effective_from-гүйгээр ОРШИЖ ЧАДАХГҮЙ.  Баталгааг UI-ийн
-- бичвэр биш, ӨГӨГДЛИЙН САН барина.
--
-- ⚠️ `requires_triggered_json` нь §52-ын хамаарлын индекс.  Үүнийг ОДОО
-- нэмнэ — дараа нэмэх нь өссөн хүснэгт дээр rebuild шаардана.
--
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ: <= 7 statement, блок тайлбаргүй, мөрөн дотор ; -гүй.

CREATE TABLE IF NOT EXISTS rules (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_uid               TEXT    NOT NULL,
  version                INTEGER NOT NULL DEFAULT 1,
  semantic_hash          TEXT    NOT NULL,
  team_code              TEXT,
  title_mn               TEXT    NOT NULL,
  title_en               TEXT,
  document_uid           TEXT,
  clause_uid             TEXT,
  edition_ref            TEXT,
  effective_from         TEXT,
  verification_state     TEXT    NOT NULL DEFAULT 'UNVERIFIED'
                           CHECK (verification_state IN ('UNVERIFIED','CLAUSE_CITED','HUMAN_VERIFIED')),
  issue_class            TEXT    NOT NULL DEFAULT 'REGULATORY_VIOLATION'
                           CHECK (issue_class IN ('REGULATORY_VIOLATION','MODEL_QUALITY','PROJECT_INCOMPLETENESS','TEAM_STANDARD','UNKNOWN_NEEDS_REVIEW')),
  severity               TEXT    NOT NULL DEFAULT 'MEDIUM'
                           CHECK (severity IN ('CRITICAL','HIGH','MEDIUM','LOW','INFO')),
  unit                   TEXT    NOT NULL DEFAULT 'NONE'
                           CHECK (unit IN ('MM','M','M2','M3','DEG','PCT','COUNT','KG_M3','H','NONE')),
  coordinate_system      TEXT    NOT NULL DEFAULT 'none'
                           CHECK (coordinate_system IN ('none','project','shared','survey')),
  expect_applicable      INTEGER NOT NULL DEFAULT 0 CHECK (expect_applicable IN (0,1)),
  requires_context_json  TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(requires_context_json)),
  applicability_json     TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(applicability_json)),
  check_json             TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(check_json)),
  requires_params_json   TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(requires_params_json)),
  requires_triggered_json TEXT   NOT NULL DEFAULT '[]' CHECK (json_valid(requires_triggered_json)),
  exceptions_json        TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(exceptions_json)),
  recommendation_mn      TEXT,
  status                 TEXT    NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft','review','published','retired')),
  authored_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at            TEXT,
  created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (verification_state = 'UNVERIFIED'
         OR (clause_uid IS NOT NULL AND edition_ref IS NOT NULL AND effective_from IS NOT NULL)),
  CHECK (team_code IS NULL OR team_code GLOB '[A-Z][A-Z]*')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_uid_version ON rules (rule_uid, version);

CREATE INDEX IF NOT EXISTS idx_rules_team_pub ON rules (team_code, status) WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_rules_clause ON rules (clause_uid) WHERE clause_uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rules_severity ON rules (severity, verification_state);

CREATE TABLE IF NOT EXISTS rule_deps (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_uid     TEXT    NOT NULL,
  rule_version INTEGER NOT NULL,
  dep_kind     TEXT    NOT NULL
                 CHECK (dep_kind IN ('category','parameter','context','relationship')),
  dep_key      TEXT    NOT NULL,
  change_kind  TEXT    CHECK (change_kind IN ('add','modify','delete')),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rule_deps_lookup ON rule_deps (dep_kind, dep_key, change_kind);
```

**`team_code IS NULL` = БҮХ КОМПАНИД (global/company scope).** Дүрэм СОНГОХ query нь үргэлж `WHERE status = 'published' AND (team_code = ?1 OR team_code IS NULL)` — BA-ийн сесс IZ-ийн дүрмийг ХЭЗЭЭ Ч ХАРАХГҮЙ. Энэ бол R3/R5/R6-ийн механик хэрэгжилт.

`rule_deps` нь §52-ын «дүрэм → хамаарал → нөлөөлөгдөх → өдөөгч» гинжийг query хийх боломжтой болгоно. `2-3`-ын coalescer нь өөрчлөгдсөн (category, change) хосыг `idx_rule_deps_lookup`-аар шууд дүрэм рүү хөрвүүлнэ — БҮХ дүрмийн санг үзэхгүй (v2 §51-R3).

---

### 3.3 `0222_rule_conflicts_tests.sql` — зөрчилдөөн (§64) + тест кейс (§70)

**Statement тоо: 6** (2 CREATE TABLE + 4 CREATE INDEX). Таазанд 3 нөөцтэй.

```sql
-- =============================================================
-- 0222_rule_conflicts_tests.sql — ЗӨРЧИЛДӨХ ДҮРЭМ ба ДҮРМИЙН ТЕСТ КЕЙС
-- =============================================================
-- ЗОРИЛГО: v2 §64 нь зөрчилдөөнийг ИЛЭРХИЙЛЭГДЭХ ТӨЛӨВ болгохыг шаарддаг —
-- хөдөлгүүр нэгийг нь ЧИМЭЭГҮЙ СОНГОХГҮЙ.  v2 §70 нь дүрэм бүр бодит
-- төслөөс баталгаажсан тест кейс хуримтлуулахыг шаарддаг.
--
-- ⚠️ `rule_conflicts` нь БҮРТГЭЛ, шийдвэр БИШ.  Хоёр дүрэм зөрчилдөж байгааг
-- энд бүртгэвэл `2-3`-ын хөдөлгүүр UNCERTAIN буцаана — нэгийг нь сонгохгүй.
-- `precedence` нь NULL байж БОЛНО: v2 §64 нь «hierarchy/priority IF KNOWN»
-- гэсэн — мэдэгдэхгүй нь хууль ёсны төлөв.
--
-- ⚠️ `rule_test_cases` нь ХОЁР ҮҮРЭГТЭЙ: регрессийн тест БАС golden корпус.
-- `backend/scripts/gen-rule-golden.mjs` нь ЗӨВХӨН verified=1 мөрийг
-- revit-mcp/eval/golden/rules.json руу гаргана — тэр хуваарь нь өнөөдөр
-- хоосон бөгөөд `run_golden.py --kind rules` -ыг БЛОКЛОДОГ.
--
-- ⚠️ v2 §63-ын ЗААВАЛ ЁСТОЙ кейсүүд: threshold-1 / threshold / threshold+1 /
-- zero / missing_input / invalid_input / min_max / mixed_units / exception /
-- multi_rule / conflict / no_context.  Дээр нь ЭНЭ ТӨСЛИЙН нэмэлт:
-- mixed_provenance (нэгжийн эх үүсвэр зөрөх — §3.8).
--
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ: <= 7 statement, блок тайлбаргүй, мөрөн дотор ; -гүй.

CREATE TABLE IF NOT EXISTS rule_conflicts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_uid_a    TEXT    NOT NULL,
  rule_uid_b    TEXT    NOT NULL,
  conflict_kind TEXT    NOT NULL DEFAULT 'threshold'
                  CHECK (conflict_kind IN ('threshold','applicability','unit','definition','cross_discipline')),
  scope         TEXT    NOT NULL DEFAULT 'intra_pack'
                  CHECK (scope IN ('intra_pack','cross_discipline')),
  precedence    TEXT    CHECK (precedence IN ('a_wins','b_wins','unknown')),
  note_mn       TEXT,
  detected_by   TEXT    NOT NULL DEFAULT 'human'
                  CHECK (detected_by IN ('human','authoring_check','verdict_stream')),
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rule_conflicts_pair ON rule_conflicts (rule_uid_a, rule_uid_b, conflict_kind);

CREATE INDEX IF NOT EXISTS idx_rule_conflicts_scope ON rule_conflicts (scope, precedence);

CREATE TABLE IF NOT EXISTS rule_test_cases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  case_uid      TEXT    NOT NULL UNIQUE,
  rule_uid      TEXT    NOT NULL,
  rule_version  INTEGER NOT NULL DEFAULT 1,
  case_class    TEXT    NOT NULL
                  CHECK (case_class IN ('threshold_minus','threshold','threshold_plus','zero','missing_input','invalid_input','min_max','mixed_units','mixed_provenance','exception','multi_rule','conflict','no_context','ordinary')),
  inputs_json   TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(inputs_json)),
  expect_verdict TEXT   NOT NULL
                  CHECK (expect_verdict IN ('PASS','WARNING','VIOLATION','UNCERTAIN','NOT_APPLICABLE')),
  expect_value  REAL,
  source_kind   TEXT    NOT NULL DEFAULT 'authored'
                  CHECK (source_kind IN ('authored','real_project','regression')),
  source_note   TEXT,
  verified      INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
  verified_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  verified_at   TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rule_tests_rule ON rule_test_cases (rule_uid, rule_version, case_class);

CREATE INDEX IF NOT EXISTS idx_rule_tests_verified ON rule_test_cases (verified, rule_uid) WHERE verified = 1;
```

⚠️ `expect_verdict` нь `NOT_APPLICABLE`-ыг ЗӨВШӨӨРНӨ — учир нь тест нь хамаарлын хөдөлгүүрийг ч шалгана. Харин **олдворын хүснэгт (`2-3`) дээр `verdict` нь ЯГ 4 утга** — `NOT_APPLICABLE` нь мөр болж ХЭЗЭЭ Ч ҮҮСЭХГҮЙ (§3.6).

---

### 3.4 `0223_project_context_packs.sql` — төслийн контекст (§61) + багцын хувилбар

**Statement тоо: 6** (2 CREATE TABLE + 4 CREATE INDEX). Таазанд 3 нөөцтэй.

```sql
-- =============================================================
-- 0223_project_context_packs.sql — §61-ийн ХАМААРЛЫН ОРОЛТ ба ДҮРМИЙН БАГЦ
-- =============================================================
-- ЗОРИЛГО: §61 нь 12 оролт дээр хамаарлыг тогтоохыг шаарддаг.  Тэдгээрийн 8
-- нь өнөөдөр ХАДГАЛАХ ГАЗАРГҮЙ.  `projects` дээр багана болж ОРОХГҮЙ — тэр нь
-- 33 cascade хүүхэдтэй бөгөөд rebuild нь ХОРИОТОЙ.  Тиймээс хүүхэд хүснэгт.
--
-- ⚠️ ТҮЛХҮҮР нь (project_id, doc_uid) — нэг төсөлд подиум ба цамхаг тус тусын
-- контексттэй байж БОЛНО.  doc_uid нь `revit_documents.doc_uid`-тай ижил мөр,
-- гэхдээ FK БИШ: контекстийг Revit баримт бүртгэгдэхээс ӨМНӨ админ бөглөнө.
--
-- ⚠️ ӨНДРИЙГ ХОСТ БАРИМТААС УНШИХГҮЙ.  HAS / TSBU / TSAH / HD / AU-ийн хост
-- файлд ихэвчлэн Room ч, давхрын Level ч БАЙХГҮЙ (тэдгээр нь холбоос дотор).
-- Хостоос уншвал 5 багийн өндөр барилгын шалгалт БҮГД ЧИМЭЭГҮЙ УНТАРНА.
-- Тиймээс контекстийг АРХИТЕКТОР/АДМИН нэг удаа бичиж, БАГЦТАЙ ХАМТ хүргэнэ.
--
-- ⚠️ height_m нь ЯЛГАВАР, үнэмлэхүй тоо БИШ: дээд давхрын түвшин хасах газрын
-- түвшний давхар.  Revit-ийн ProjectElevation нь shared coordinate дээр
-- Улаанбаатарын ~1300 м газрын өндрийг агуулж болно.
--
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ: <= 7 statement, блок тайлбаргүй, мөрөн дотор ; -гүй.

CREATE TABLE IF NOT EXISTS project_build_context (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id            INTEGER NOT NULL,
  doc_uid               TEXT    NOT NULL DEFAULT '',
  building_type         TEXT,
  occupancy_class       TEXT,
  occupant_load         INTEGER,
  gross_area_m2         REAL,
  height_m              REAL,
  height_basis          TEXT    NOT NULL DEFAULT 'unknown'
                          CHECK (height_basis IN ('unknown','levels_diff','manual','proposed')),
  grade_level_name      TEXT,
  top_level_name        TEXT,
  stories_above_grade   INTEGER,
  stories_below_grade   INTEGER,
  jurisdiction          TEXT    NOT NULL DEFAULT 'MN',
  project_phase         TEXT    CHECK (project_phase IN ('concept','sketch','permit','working','asbuilt')),
  fire_safety_class     TEXT,
  seismic_intensity     TEXT,
  room_boundary_location TEXT   CHECK (room_boundary_location IN ('Center','Finish','CoreCenter','CoreBoundary')),
  special_requirements_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(special_requirements_json)),
  authored_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  authored_at           TEXT,
  proposed_json         TEXT    CHECK (proposed_json IS NULL OR json_valid(proposed_json)),
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pbc_project_doc ON project_build_context (project_id, doc_uid);

CREATE INDEX IF NOT EXISTS idx_pbc_height ON project_build_context (height_m, stories_above_grade);

CREATE TABLE IF NOT EXISTS rule_pack_versions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  team_code       TEXT    NOT NULL,
  ruleset_version TEXT    NOT NULL,
  pack_sha256     TEXT    NOT NULL CHECK (length(pack_sha256) = 64),
  pack_contract   TEXT    NOT NULL DEFAULT 'rulepack-v1',
  rule_count      INTEGER NOT NULL DEFAULT 0,
  body_json       TEXT    NOT NULL CHECK (json_valid(body_json)),
  status          TEXT    NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','published','retired')),
  published_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published_at    TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pack_team_version ON rule_pack_versions (team_code, ruleset_version);

CREATE INDEX IF NOT EXISTS idx_pack_sha ON rule_pack_versions (pack_sha256);
```

`doc_uid` нь `NOT NULL DEFAULT ''` — хоосон мөр нь «энэ төслийн БҮХ баримтад хамаарах анхдагч контекст». Ингэснээр unique индекс NULL-ын семантикт татагдахгүй.

---

### 3.5 `backend/src/lib/complianceModel.ts` — ГУРВАН ТЭНХЛЭГ ба ХАВЧААР

```ts
/* =============================================================
 * complianceModel.ts — нийцлийн салангид ГУРВАН ТЭНХЛЭГ + баталгааны ХАВЧААР.
 * -------------------------------------------------------------
 * ⚠️ ГУРВАН ТЭНХЛЭГИЙГ ХЭЗЭЭ Ч НЭГТГЭХГҮЙ.
 *   verdict        — юу гарсан бэ            (v2 §40-R2, 4 утга)
 *   issue_class    — ямар төрлийн асуудал вэ (v2 §59-R3, 5 утга)
 *   evidence_level — хэр найдвартай вэ       (v2 §65-R2, 5 утга)
 * `TEAM_STANDARD` нь эзний R3-ыг ГАРАЛТАД харагдуулдаг цорын ганц утга:
 * багийн дотоод стандарт зөрчил ≠ норм зөрчил.
 *
 * ⚠️ `evidence_level` бол ГУРАВ ДАХЬ ангилал.  `assistant_examples.source_type`
 * (0215:52-55, 8 утга) ба `learning_events.provenance` (bimEvents.ts:243-252,
 * 6 утга) хоёрыг ДАХИН АШИГЛАХГҮЙ — тэр хоёр өөрсдөө ч зөрчилддөг бөгөөд
 * репод хооронд нь хөрвүүлэх функц БАЙХГҮЙ.
 * ============================================================= */

export const VERDICTS = ['PASS', 'WARNING', 'VIOLATION', 'UNCERTAIN'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const ISSUE_CLASSES = [
  'REGULATORY_VIOLATION',
  'MODEL_QUALITY',
  'PROJECT_INCOMPLETENESS',
  'TEAM_STANDARD',
  'UNKNOWN_NEEDS_REVIEW',
] as const;
export type IssueClass = (typeof ISSUE_CLASSES)[number];

export const EVIDENCE_LEVELS = [
  'RULE_BACKED',
  'MODEL_DERIVED',
  'HUMAN_VERIFIED',
  'AI_INFERRED',
  'UNKNOWN',
] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const VERIFICATION_STATES = ['UNVERIFIED', 'CLAUSE_CITED', 'HUMAN_VERIFIED'] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

/** Нэг дүгнэлтийн ноцтой байдлын дараалал — §67 ба §69-д хэрэглэнэ. */
export const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1,
};

/**
 * БАТАЛГААНЫ ХАВЧААР — v2 §35/§36-ын хууль эрх зүйн байрлалын хэрэгжилт.
 *
 * ⚠️ ЯАГААД ГУРВАН ЗҮЙЛИЙГ ЗЭРЭГ ХАВЧИХ ВЭ:
 *   revit-mcp/CLAUDE.md:7-11 нь өөрийн тоонуудыг «design-guidance … verify
 *   each number against the current official БНбД / MNS» гэж зарласан.
 *   eval/golden/rules.json нь тэднийг golden болгохыг ХОРИГЛОСОН.  Ноцтой
 *   байдлыг л бууруулаад «БНбД 31-03» гэж хэвлэвэл архитектор баталгаажаагүй
 *   тоон дээр хонгил өргөсгөх зардал гаргах, эсвэл захиалагчид эшлэх эрсдэлтэй.
 *   Ноцтой байдал буурсан нь эшлэлийг мэргэжлийн батламж биш болгодоггүй.
 */
export interface ClampInput {
  readonly verificationState: VerificationState;
  readonly rawVerdict: Verdict;
  readonly rawEvidence: EvidenceLevel;
  readonly severity: Severity;
}
export interface ClampOutput {
  readonly verdict: Verdict;
  readonly evidenceLevel: EvidenceLevel;
  readonly severity: Severity;
  /** true бол UI нь код/заалт/гарчиг ХАРУУЛАХГҮЙ. */
  readonly suppressCitation: boolean;
  readonly citationLabelMn: string | null;
}

export function clampByVerification(input: ClampInput): ClampOutput {
  if (input.verificationState === 'UNVERIFIED') {
    return {
      // (1) VIOLATION → WARNING.  PASS ба UNCERTAIN хэвээр.
      verdict: input.rawVerdict === 'VIOLATION' ? 'WARNING' : input.rawVerdict,
      // (2) нотолгоо нь загвараас гаргасан гэж албадана.
      evidenceLevel: 'MODEL_DERIVED',
      // (3) CRITICAL нь UNVERIFIED дүрмээс гарч ЧАДАХГҮЙ.
      severity: input.severity === 'CRITICAL' ? 'HIGH' : input.severity,
      suppressCitation: true,
      citationLabelMn: 'дотоод шалгуур (эх сурвалж баталгаажаагүй)',
    };
  }
  return {
    verdict: input.rawVerdict,
    evidenceLevel: input.rawEvidence,
    severity: input.severity,
    suppressCitation: false,
    citationLabelMn: null,
  };
}
```

**Энэ хавчаар нь golden блокийг ЗОГСОЛТ БИШ, ДЭВШЛИЙН ХААЛГА болгоно:** дүрэм нь хүн заалт эшилж, `0222`-ын 5 заавал ёстой тест кейсийг бичсэн үед л `HUMAN_VERIFIED` (тэгснээр `VIOLATION` + эшлэх эрх) болно. Хөдөлгүүр нь өнөөдөр ҮНЭНЧЭЭР тарж чадна.

---

### 3.6 `backend/src/lib/ruleApplicability.ts` — §61-ийн хамаарлын хөдөлгүүр

**Дүрэм ГҮЙЦЭТГЭХЭЭС ӨМНӨ ажиллах ЦЭВЭР модуль.** `Autodesk.Revit`-ийн ямар ч төрөл, ямар ч D1 дуудлага байхгүй — оролт нь POCO.

#### §61-ийн 12 оролт ба тэдгээрийн одоогийн байршил

| # | §61 оролт | Өнөөдрийн эх сурвалж | Байдал |
|---|---|---|---|
| 1 | building type | `generalTemplate.ts:63` `building_purpose_category` | `answers_json` доторх JSON — **query хийх боломжгүй** |
| 2 | occupancy | — | **ГЭР БҮЛГҮЙ** |
| 3 | area | — (`qto_rooms.area_m2` нь өрөөний нийлбэр) | **ГЭР БҮЛГҮЙ** |
| 4 | **height** | `ba/types.ts:18` `height: string` | чөлөөт текст — **ГЭР БҮЛГҮЙ** |
| 5 | **number of floors** | `ba/types.ts:19`, `:74` | чөлөөт текст — **ГЭР БҮЛГҮЙ** |
| 6 | jurisdiction | — | **ГЭР БҮЛГҮЙ** |
| 7 | use | `generalTemplate.ts:63` (1-тэй ижил) | JSON blob |
| 8 | project phase | — | **ГЭР БҮЛГҮЙ** |
| 9 | fire classification | `generalTemplate.ts:89` `fire_safety_class` | JSON blob |
| 10 | team / discipline | `teams.code` + `2-1`-ийн шийдэлт | **БИЙ** |
| 11 | project-specific requirements | — | **ГЭР БҮЛГҮЙ** |
| 12 | effective regulation version | — (`norm_items`-д хувилбар байхгүй) | **ГЭР БҮЛГҮЙ** |

**8 нь гэр бүлгүй: 2, 3, 4, 5, 6, 8, 11, 12.** `project_build_context` (§3.4) нь тэдгээрийг бүгдийг гаргана.

#### Өндөр барилгын хаалга

```ts
/** Баримтын багцыг нээх канон предикат.
 *  Эх сурвалж: generalTemplate.ts:86 — «Онцгой: 51м-ээс дээш эсвэл 16
 *  давхраас дээш барилга.»  ЭНЭ НЬ БАРИМТЫН БАГЦЫГ л нээнэ — дүрэм бүр
 *  өөрийн босготой (доорх хүснэгт). */
export const HIGH_RISE_HEIGHT_M = 51;
export const HIGH_RISE_STORIES = 16;

export function opensHighRiseDocumentSet(ctx: BuildContext): boolean | null {
  if (ctx.heightM == null && ctx.storiesAboveGrade == null) return null; // UNCERTAIN
  if (ctx.heightM != null && ctx.heightM > HIGH_RISE_HEIGHT_M) return true;
  if (ctx.storiesAboveGrade != null && ctx.storiesAboveGrade > HIGH_RISE_STORIES) return true;
  return false;
}
```

Нээгдэх баримтын багц (бүгд `0120`-д мөртэй, §2.3): `БНбД 31-17-10` (`:75`), `БНбД 21-01-02` (`:53`), `БНбД 21-02-02` (`:54`), `БД 21-102-12` (`:58`), `БНОД 22-01-21` (`:51`), `БНбД 35-01-22` (`:76`), `БНбД 25-01-20` (`:47`), `БНбД 23-04-07` (`:45`), `БНбД 40-02-12` (`:82`).

**ДӨРВӨН БОСГО = ДӨРВӨН ДҮРЭМ, ДӨРВӨН ХААЛГА.** `is_high_rise` ганц буль хэзээ ч байхгүй:

| Хаалга | Утга | Ямар дүрэмд | Эх сурвалж |
|---|---|---|---|
| `project.height_m > 51` OR `project.stories_above_grade > 16` | баримтын багц | BA, IZ-ийн өндөр барилгын дүрмүүд | `generalTemplate.ts:86` |
| `project.height_m > 30` | салхины резонанс заавал | BB-ийн `BB-HR-WIND-RES-001` | `bb/template.ts:309` |
| `project.stories_above_grade >= 21` | бүрэн цутгамал зөвлөмж (компанийн практик) | BB-ийн `BB-CO-CASTINPLACE-001` | `bb/template.ts:173` |
| `project.stories_above_grade > 15` | сүлжээ өргөгч | HD-ийн `HD-HR-REPEATER-001` | `hd/template.ts:101` |

⚠️ **21 давхрын мөр нь НОРМ БИШ.** `bb/template.ts:173` нь «МАКС ӨРГӨӨ хурлын зөвлөмжийн дагуу» гэж бичсэн. Тиймээс тэр дүрэм нь `issue_class = 'TEAM_STANDARD'`, `document_uid = NULL`, `verification_state = 'UNVERIFIED'` байх ЁСТОЙ — норм гэж эшилбэл хурлын тэмдэглэлийг хууль болгож харуулна.

#### Хамаарлын үр дүн

```ts
export type Applicability =
  | { kind: 'APPLICABLE' }
  | { kind: 'NOT_APPLICABLE'; reason: string }
  | { kind: 'UNCERTAIN'; missing: readonly string[] };

/** ⚠️ NOT_APPLICABLE нь МӨР БОЛЖ ХЭЗЭЭ Ч ҮҮСЭХГҮЙ.
 *  v2 §11:366-370 нь 5 төлөв жагсаадаг, §40-R2:1426-1429 нь 4.  Зөрүүг ингэж
 *  шийдэв: NOT_APPLICABLE бол ХАМААРЛЫН ҮР ДҮН, дүгнэлт БИШ (§61: «Only after
 *  applicability is established should the rule be executed»).  ГэхДЭЭ тэр нь
 *  `rule_run_ledger`-т (2-3) тоологдоно — эс тэгвэл «дүрэм ажиллаагүй» ба
 *  «загвар цэвэр» хоёр ЯЛГАГДАХГҮЙ. */
export function evaluateApplicability(
  rule: RuleDef,
  ctx: BuildContext,
  facts: FactBag,
): Applicability { /* … */ }
```

`UNCERTAIN` нь хамаарлын оролт дутуу үед буцна (жишээ нь `height_m == null`), БАС `rule_run_ledger.skipped_reason`-д бичигдэнэ. **Дутуу контекст нь ЧИМЭЭГҮЙ БАЙХ ёсгүй** — `2-5` нь түүнийг `PROJECT_INCOMPLETENESS` баннераар харуулна («төслийн өндөр тодорхойгүй — өндөр барилгын шалгалт ажиллахгүй»).

---

### 3.7 `rulepack-v1` — бүтэн JSON схем ба хоёр ажлын жишээ

> **ЭЗЭН БАТАЛСАН (2026-08-30) — BA нь ЭХНИЙ БҮРЭН БАГЦ.** Эзэн «BA — Барилга архитектур»-ыг сонгов.
> **BA-ийн багц нь БҮТЭЦИЙН ТЕМПЛЕЙТ**: үлдсэн долоон салбарын багц (BB · HAS · TSBU · TSAH · HD · AU · IZ)
> нь BA-ийн `rule_uid` нэрлэлт, `applicability` / `check` / `requires` бүтэц, `verification_state`-ийн
> хавчаар, тест кейсийн 5 заавал ангилалыг ХУУЛЖ бичигдэнэ — өөр бүтэц ЗОХИОХГҮЙ. Шалтгаан нь §3.14.1-д
> хэмжигдсэн: `ba/` нь **12 БНбД эшлэлтэй**, аль ч салбараас том үрийн корпус. Багцыг зохиох ДАРААЛАЛ ба
> салбар тус бүрийн үрийн тоо — **§3.14.1**.

`backend/src/lib/rulePack.ts` нь багцыг угсарч, sha256-г тооцоолж, `rule_pack_versions`-д бичнэ. Багцын бүрэн бүтэц:

```jsonc
{
  "pack_contract": "rulepack-v1",
  "team_code": "BA",
  "ruleset_version": "2026-09-01.1",
  "pack_sha256": "<серверээс нийтэлнэ — клиент өөрийн уншсан байтыг тулгана>",
  "generated_at": "2026-09-01T00:00:00Z",
  "project_context": {
    "project_id": 0,
    "doc_uid": "",
    "height_m": null,
    "stories_above_grade": null,
    "grade_level_name": null,
    "top_level_name": null,
    "room_boundary_location": null,
    "fire_safety_class": null,
    "seismic_intensity": null,
    "project_phase": null,
    "jurisdiction": "MN"
  },
  "rules": [ /* доорх хоёр жишээ */ ]
}
```

#### BA-ийн бүрэн дүрэм — хонгилын цэвэр өргөн (КАНОН ТЕМПЛЕЙТ)

⚠️ **Энэ бол ЭХНИЙ БҮРЭН БИЧИГДСЭН ДҮРЭМ, БАС бүх багцын БҮТЭЦИЙН ЭХ ХУВИЛБАР** (эзэн баталсан 2026-08-30). Дараагийн долоон салбар шинэ талбар, шинэ оператор, шинэ нэрлэлт зохиохгүй — доорх бүтцийг хуулж, тоо ба `applicability`-г л сольж бичнэ.

```jsonc
{
  "rule_uid": "BA-HR-CORRIDOR-W-001",
  "version": 1,
  "team_code": "BA",
  "semantic_hash": "<sha256(canonical(applicability)+canonical(check)+unit)>",

  "title_mn": "Хонгилын цэвэр өргөн",
  "title_en": "Corridor clear width",

  "document_uid": "BNBD-31-03",
  "clause_uid": null,
  "edition_ref": null,
  "effective_from": null,
  "verification_state": "UNVERIFIED",

  "issue_class": "REGULATORY_VIOLATION",
  "severity": "HIGH",

  "unit": "MM",
  "coordinate_system": "none",

  "expect_applicable": true,
  "requires_context": ["project.height_m", "doc.room_boundary_location"],

  "applicability": {
    "all": [
      { "any": [
        { "project.height_m":            { "gt": 51 } },
        { "project.stories_above_grade": { "gt": 16 } }
      ] },
      { "doc.room_boundary_location": { "eq": "Finish" } },
      { "element.category":           { "eq": "Rooms" } },
      { "element.name_folded":        { "contains_any": ["hongil", "koridor"] } }
    ]
  },

  "check": {
    "if":   { "element.length_m":       { "gt": 10 } },
    "then": { "element.clear_width_mm": { "gte": 1500 } },
    "else": { "element.clear_width_mm": { "gte": 1200 } }
  },

  "requires": {
    "params": ["clear_width_mm", "length_m"],
    "triggered_by": [
      { "category": "Rooms", "change": "modify" },
      { "category": "Walls", "change": "modify" },
      { "category": "Walls", "change": "add"    },
      { "category": "Walls", "change": "delete" }
    ]
  },

  "exceptions": [],

  "recommendation_mn": "Хонгилын цэвэр өргөнийг 1500 мм хүртэл нэмэгдүүлнэ. Хэрэв хонгилын урт 10 м-ээс богино бол 1200 мм хангалттай."
}
```

Тооны эх сурвалж: `revit-mcp/CLAUDE.md:64-66` — «Corridor / хонгил width: ≥ 1.2 m if length ≤ 10 m; ≥ 1.5 m if length > 10 m». Тэр файл өөрийгөө `:7-11`-д баталгаажаагүй гэж зарласан тул `verification_state: "UNVERIFIED"` нь ЗАЙЛШГҮЙ — тиймээс энэ дүрэм хамгийн ихдээ `WARNING` гаргана, `evidence_level` нь `MODEL_DERIVED`, эшлэл нь «дотоод шалгуур (эх сурвалж баталгаажаагүй)».

⚠️ **`doc.room_boundary_location = "Finish"` нь ЗААВАЛ.** Revit-ийн `AreaVolumeSettings` анхдагч нь Wall Centre; 200 мм-ийн хоёр ханын хоорондох хонгил тэгвэл 1600 мм гэж уншигдана, харин цэвэр өргөн нь 1400 мм. `>= 1500` нь ЖИНХЭНЭ ЗӨРЧИЛ дээр PASS буцаана — архитекторт «шалгасан, цэвэр» гэж харуулсан ХУДАЛ СӨРӨГ бол R2-ийн хамгийн муу уналт. `AreaVolumeSettings`, `SpatialElementBoundaryLocation`, `GetBoundarySegments` — гурвуулаа 46 `.cs` файлын аль нь ч БАЙХГҮЙ (§9).

#### IZ-ийн бүрэн дүрэм — таазны цэвэр өндөр (ХОЁРДУГААР, ЗОХИОСОН)

⚠️ **IZ нь эзний тэргүүлэх ач холбогдлоор ХОЁРДУГААРТ** (эзэн брифдээ Интерьерийг НЭРЛЭСЭН, баталсан 2026-08-30) — **гэхдээ `iz/`-д БНбД эшлэл ТЭГ** (§3.14.1). Тиймээс доорх дүрэм нь темплейтээс ХУРААГДААГҮЙ, норм каталогоос ЗОХИОГДСОН. Бүтэц нь дээрх BA-ийн канон темплейтийн ЯГ хуулбар.

```jsonc
{
  "rule_uid": "IZ-HR-CEIL-H-001",
  "version": 1,
  "team_code": "IZ",
  "semantic_hash": "<sha256(canonical(applicability)+canonical(check)+unit)>",

  "title_mn": "Таазны цэвэр өндөр",
  "title_en": "Clear ceiling height",

  "document_uid": "BNBD-31-03",
  "clause_uid": null,
  "edition_ref": null,
  "effective_from": null,
  "verification_state": "UNVERIFIED",

  "issue_class": "REGULATORY_VIOLATION",
  "severity": "HIGH",

  "unit": "MM",
  "coordinate_system": "none",

  "expect_applicable": true,
  "requires_context": ["project.height_m"],

  "applicability": {
    "all": [
      { "any": [
        { "project.height_m":            { "gt": 51 } },
        { "project.stories_above_grade": { "gt": 16 } }
      ] },
      { "element.category": { "eq": "Rooms" } }
    ]
  },

  "check": {
    "if":   { "element.name_folded":  { "contains_any": ["hongil", "koridor"] } },
    "then": { "element.ceiling_h_mm": { "gte": 2200 } },
    "else": { "element.ceiling_h_mm": { "gte": 2400 } }
  },

  "requires": {
    "params": ["ceiling_h_mm"],
    "triggered_by": [
      { "category": "Ceilings", "change": "modify" },
      { "category": "Ceilings", "change": "add"    },
      { "category": "Ceilings", "change": "delete" },
      { "category": "Levels",   "change": "modify" }
    ]
  },

  "exceptions": [],

  "recommendation_mn": "Өрөөний таазны цэвэр өндрийг 2400 мм, хонгилд 2200 мм хүртэл өргөсгөнө. Инженерийн шугам сүлжээг тааз доогуур явуулж байгаа бол зам солино."
}
```

Тооны эх сурвалж: `revit-mcp/CLAUDE.md:76-78` — «Ceiling height (clear), rooms: ≥ 2.4 m; corridors ≥ 2.2 m; service/technical passages to lowest projection ≥ 1.8 m».

⚠️ **IZ-д `norms_*` тэг мөр байгаа (§2.5) тул IZ-ийн багцыг ХУРААХГҮЙ, ЗОХИОНО.** Энэ дүрэм нь IZ-ийн ЭХНИЙ мөр бөгөөд түүнийг интерьерийн инженер л баталгаажуулж чадна (§9).

#### `RulePack.cs` — клиент тал

`revit-mcp/addin/RulePack.cs` нь `IntentModel.cs`-ийн бараг хуулбар:

| Механизм | `IntentModel.cs` дэх эх хувилбар | `RulePack.cs` дэх хэлбэр |
|---|---|---|
| Гэрээ таарахгүй бол ТАТГАЛЗАХ | `:311-312` `PreprocessContract` тулгалт | `PackContract = "rulepack-v1"`, зөрвөл `null` |
| Гурван түвшний уналт | `:249-268` татсан → шигтгээстэй → байхгүй | татсан → шигтгээстэй canary → байхгүй |
| ETag `?have=` товчлол | `ApiClient.cs:166-167`, `:179-181` | `GET /api/compliance/pack?team=BA&have=<version>` |
| Офлайн ЧИМЭЭГҮЙ | `ApiClient.cs:194-196` `catch { return null; }` | ижил — **404-ыг ч тэсвэрлэж, локал хуулбараа хадгална** |
| Шигтгээс | `csproj:134-137` `EmbeddedResource` | `Resources\rulepack-canary.json` |

⚠️ **Кэшийн файлын нэр нь ХЭШ БАС PID агуулна:** `%APPDATA%\RevitMcpAddin\rulepack-<TEAM>-<sha256[:16]>-<pid>.json`. `%APPDATA%` нь хэрэглэгчийн бичих эрхтэй — инженер 1500-ыг 1000 болгож засвал олдвор алга болох ба `ruleset_version` хэвээр байх тул сервер нийтэлсэн багц хэрэгжсэн гэж итгэнэ. Клиент өөрийн уншсан байтыг hash хийж, нэртэйгээ тулгана; таарахгүй бол ТАТГАЛЗАНА. Ачаалсан hash нь handshake-д БАС дүгнэлт бүрд явна.

---

### 3.8 `revit-mcp/addin/Units.cs` ба `RuleFacts.cs` — §62

```csharp
/// <summary>
/// Нэгжийн аюулгүй байдал (v2 §62).  ⚠️ ЭНЭ ФАЙЛ Autodesk.Revit-ийн ямар ч
/// төрөл ХЭРЭГЛЭХГҮЙ — `RuleEngine` шиг Revit-гүйгээр тестлэгдэнэ
/// (`revit-mcp/training/check_rules.py` нь энэ файлыг ГАНЦААР нь compile хийнэ).
///
/// ⚠️ ЯАГААД ЗӨВХӨН `Unit` ХҮРЭЛЦЭХГҮЙ ВЭ:
///   Монгол төслийн темплейт дээр «Өргөн» нэртэй project parameter нь нэг
///   family дээр LENGTH spec-тэй (дотоод 3.937 фут → 1200 мм зөв хөрвөнө),
///   өөр family дээр NUMBER spec-тэй, шууд 1200 гэсэн тоо агуулна.  Хоёулаа
///   `MM` гэж зарлана.  Хоёр дахийг фут гэж хөрвүүлбэл 365 760 мм болж бүх
///   зүйл PASS; хөрвүүлэхгүй бол эхнийх 3.9 мм болж бүх зүйл VIOLATION.
///   `RequireSame` нь ялгаж ЧАДАХГҮЙ.  Тиймээс эх үүсвэрийг АВЧ ЯВНА.
/// </summary>
public enum QuantitySource { BuiltinGeometry, TypedParam, UntypedParam, Computed }

public readonly struct Quantity
{
    public readonly double Value;
    public readonly string Unit;      // MM | M | M2 | M3 | DEG | PCT | COUNT | KG_M3 | H | NONE
    public readonly bool   Missing;
    public readonly QuantitySource Source;
    public readonly string SpecId;    // GetUnitTypeId()/GetTypeId() эсвэл null

    /// <summary>⚠️ ХӨРВҮҮЛЭЛТ ЗӨВШӨӨРӨГДӨХ НӨХЦӨЛ: BuiltinGeometry, эсвэл
    /// LENGTH/ANGLE spec-тэй TypedParam.  `UntypedParam` (Integer / Number /
    /// Text) нь ҮРГЭЛЖ Missing=true → UNCERTAIN.  Таамаглах эрхгүй.</summary>
    public static bool ConversionAllowed(QuantitySource s, string specId) { /* … */ }

    /// <summary>⚠️ ЗӨРВӨЛ ШИДНЭ, хөрвүүлэхгүй.  Тэр шидэлт нь §63-ын
    /// `mixed_units` кейс.  Эх үүсвэр зөрвөл `mixed_provenance` (6 дахь
    /// заавал ёстой кейс).</summary>
    public static void RequireSame(in Quantity a, in Quantity b) { /* throw */ }
}
```

**Хатуу дүрмүүд:**

1. **Хөрвүүлэлт ЯГ НЭГ ГАЗАРТ** — `RuleFactExtractor` (`2-3`-ын `collect_rule_inputs` дотор). `RuleEngine` нь фут гэж юу болохыг МЭДЭХГҮЙ.
2. **Өнцөг нь `UnitTypeId.Degrees`-ээр ил хөрвөнө.** Revit-ийн дотоод өнцөг нь радиан; 5° босготой налуу замын дүрэм 0.0873-ыг харьцуулбал ҮРГЭЛЖ PASS (§2.9).
3. **`Round3OrNull`-ыг ХЭРЭГЛЭХГҮЙ** (`QtoExtractor.cs:528-534`) — жинхэнэ тэгийг NULL болгодог; §63 нь `zero` ба `missing_input`-ыг ТУСДАА шаарддаг.
4. **`rules.unit` нь `NOT NULL`** 10 утгын хаалттай олонлог дээр. Сервер нь `suffix`-ыг хардаггүй (§2.9) тул нэгж нь ЗӨВХӨН энэ баганад амьдарна.
5. **`coordinate_system`** нь `none` бол дүрэм геометрийн байрлалаас хамаарахгүй. `project` / `shared` / `survey` бол `2-3` нь `RevitLinkInstance.GetTotalTransform()` шаардана — тэр нь 46 файлын аль нь ч БАЙХГҮЙ. ⚠️ **Энэ нь ЗӨВЛӨМЖ БИШ, ХААЛГА:** `POST /api/compliance/rules/:uid/publish` нь `coordinate_system <> 'none'` дүрмийг **409 `coordinate_capability_missing`**-ээр буцаана, `rulePack.ts` нь түүнийг багц угсрах query-ээсээ ХАСНА (§3.11). Прозоор орхивол §3.9-ийн `RuleEngine` нь Revit-ийн ямар ч төрөлгүй тул фрэйм зөрөхийг ӨӨРӨӨ БАРЬЖ ЧАДАХГҮЙ — v2 §62-ын хориглосон далд фрэйм таамаглал ЧИМЭЭГҮЙ ажиллана.

---

### 3.9 `revit-mcp/addin/RuleEngine.cs` — цэвэр гүйцэтгэгч

```csharp
/// <summary>
/// Дүрмийн гүйцэтгэгч.  ⚠️ Autodesk.Revit-ийн ямар ч төрөл БАЙХГҮЙ:
/// оролт нь `FactBag` (string → Quantity), гаралт нь `RuleOutcome`.
///
/// ⚠️ ЯАГААД REVIT-ГҮЙ ВЭ: `revit-mcp/addin`-д C# тест ТЭГ.  Цорын ганц
/// ажиллаж байгаа харш нь `check_nudge.py` / `check_parity.py` — тэдгээр нь
/// НЭГ Revit-гүй файлыг түр csproj-д хийж `dotnet run` хийдэг
/// (`revit-mcp/training/check_nudge.py:32-45`).  Мөн net48 (R24) build нь
/// Revit 2024-ийн API-тай тул шинэ хувилбарын төрөл ХЭРЭГЛЭЖ БОЛОХГҮЙ.
///
/// ⛔ ИНФЕРЕНС ЭНД ХЭЗЭЭ Ч БАЙХГҮЙ.  LLM дуудлага, сүлжээ, диск байхгүй.
/// </summary>
public static class RuleEngine
{
    public enum Verdict { Pass, Warning, Violation, Uncertain }

    public sealed class RuleOutcome
    {
        public string  RuleUid;
        public int     RuleVersion;
        public Verdict Result;
        public string  Severity;          // CRITICAL … INFO
        public string  IssueClass;
        public string  EvidenceLevel;
        public double? ObservedValue;
        public double? ThresholdValue;
        public string  Unit;
        public string[] MissingInputs;
        public string[] ConflictRuleUids; // ≥2 бол Result = Uncertain
        public string  SkippedReason;     // NOT_APPLICABLE-ийн шалтгаан
    }

    /// <summary>Хамаарал → шалгалт → хавчаар.  Дараалал НЬ АЧАА ҮҮРНЭ:
    /// §61 «Only after applicability is established should the rule be
    /// executed» — хамаарлыг тогтоохоос ӨМНӨ check ажиллуулбал контекстгүй
    /// төсөл дээр утгагүй тоо гарна.</summary>
    public static RuleOutcome Evaluate(RuleDef rule, BuildContext ctx, FactBag facts);

    /// <summary>Багц дотор нэг элемент дээр хоёр дүрэм зөрчилдвөл НЭГ
    /// UNCERTAIN гарна — нэгийг нь ЧИМЭЭГҮЙ СОНГОХГҮЙ (v2 §64).</summary>
    public static RuleOutcome Reconcile(RuleOutcome[] outcomes, ConflictTable table);
}
```

`RuleDef.check` дэх операторын хаалттай олонлог (`rulePack.ts`-д ижил): `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `between`, `in`, `contains_any`, `exists`. Логик хослуулагч: `all`, `any`, `not`. **Дурын илэрхийлэл (eval, formula string) БАЙХГҮЙ** — `%APPDATA%`-д байгаа файл нь ажиллах код болж ХУВИРАХГҮЙ.

---

### 3.10 §64 — зөрчилдөөнийг шийдэх

**Дүрэм: нэгийг нь ХЭЗЭЭ Ч ЧИМЭЭГҮЙ СОНГОХГҮЙ.** Нэг элемент дээр хоёр ХАМААРАЛТАЙ дүрэм зөрчилдсөн үр дүн өгвөл:

```
verdict             = UNCERTAIN
issue_class         = UNKNOWN_NEEDS_REVIEW
conflict_rule_uids  = ["BA-HR-CORRIDOR-W-001", "BB-COL-ENCROACH-002"]   ← >= 2
evidence_level      = clamp-ийн үр дүн (хамгийн бага итгэлтэй нь)
severity            = SEVERITY_RANK-ийн ХАМГИЙН ӨНДӨР нь
```

Харуулах бүрэлдэхүүн (v2 §64-R4): зөрчилдөж буй эх сурвалж бүр, тэдгээрийн `edition_ref`, тэдгээрийн `applicability`, `rule_conflicts.precedence` (мэдэгдэж байвал). **Тэдгээрийг УНШИХ гарц нь `GET /api/compliance/conflicts?rule=<uid>` (§3.12)** — бүртгэлгүй бол харуулах бүрэлдэхүүн ХООСОН байна.

**`rule_conflicts.detected_by`-ын гурван утга, гурван бичигч** — утга бүр ХЭН бичихийг нэрлэнэ, эс тэгвэл CHECK нь шипсэн мэт уншигдана:

| `detected_by` | Бичигч | Хэзээ | Эзэн |
|---|---|---|---|
| `human` | `POST /api/compliance/conflicts` (`requireAdmin()`, §3.12) | Инженер/админ гараар бүртгэнэ | **ЭНЭ СЕСС** |
| `authoring_check` | `POST /api/compliance/rules/:uid/publish`-ийн нийтлэхийн ӨМНӨХ тулгалт (§3.11) | Нэр дэвшигч дүрэм ижил `document_uid`/ангилал дээрх нийтлэгдсэн дүрэмтэй босгоороо зөрөх үед | **ЭНЭ СЕСС** |
| `verdict_stream` | **`2-3`-ын серверийн эвлэрүүлэх ажил** — `compliance_findings` дээрх нэгтгэл | Ижил `element_uid`/`room_uid` дээр ӨӨР `owner_team_code`-той хоёр олдвор эсрэг босго шаардаж байвал | **`2-3` — РЕЛИЗ N-д ХЭРЭГЖИХГҮЙ** |

⚠️ **`verdict_stream` нь `0222`-т CHECK утга болж БЭЛТГЭГДЭНЭ, гэхдээ РЕЛИЗ N-д ТЭР УТГАТАЙ НЭГ Ч МӨР БАЙХГҮЙ.** Утгыг одоо тавих шалтгаан: `rule_conflicts` дээр CHECK өргөтгөх нь хожим хүснэгт rebuild шаардана. **Шипсэн мэт уншиж БОЛОХГҮЙ** — §6-д «`SELECT COUNT(*) FROM rule_conflicts WHERE detected_by='verdict_stream'` → 0» гэсэн шалгуур байгаа нь яг үүнийг барихын тулд. Хэрэгжүүлэлт нь `2-3`-д (§5-ын гар өгөлт), нээлттэй асуулт нь §9.4-т.

**Хоёр төрөл, хоёр газар:**

| Төрөл | Хаана илэрнэ | Яагаад |
|---|---|---|
| `intra_pack` | Клиент (`RuleEngine.Reconcile`) | Хоёр дүрэм НЭГ багцад байна — сесс хоёуланг нь барьж байна |
| `cross_discipline` | **Сервер**, дүгнэлтийн урсгал дээр (`2-3`) | Дүрэм сонгох предикат нь `team_code = ?1 OR team_code IS NULL` тул BA-ийн сесс BB-ийн дүрмийг ХЭЗЭЭ Ч барихгүй. Клиент дээр илрүүлэх нь БҮТЭЦИЙН ХУВЬД БОЛОМЖГҮЙ. **Оролт:** ижил `element_uid`/`room_uid`, өөр `owner_team_code` бүхий олдворын хос. **Гаралт:** `rule_conflicts` (`detected_by='verdict_stream'`, `scope='cross_discipline'`) + `finding_edges(kind='conflicts_with')` — `finding_edges` нь `2-3`-ын хүснэгт (`0230`), тиймээс ажил нь тэнд. **Энэ сесс схемийг л бэлдэнэ** |

⚠️ Зөрчилдөж буй дүрмийг ХОЁР багцад хоёуланд нь тарихгүй: багцын хэмжээ хоёр дахин нэмэгдэх ба инженерийн засаж чадахгүй тугийг нүүр рүү нь харуулах нь §76-ийн ядаргааны эх үүсвэр. Сервер хоёр талыг нь хоёуланг нь барьдаг — нэгтгэл тэнд байх ёстой.

---

### 3.11 §67 — ноцтой байдал нь ДҮРЭМ дээр БАС ОЛДВОР дээр

`severity` нь `rules` (`0221`) дээр БАС `compliance_findings` (`2-3`) дээр байна. **Хоёр газар байх нь давхардал биш:**

- **Дүрэм дээрх нь** — v2 §67-R2: «Critical regulatory/safety issues should receive stronger validation and stricter deployment gates». Багц НИЙТЛЭХ хаалга нь `severity`-г уншина: `CRITICAL` дүрэм нь `verification_state = 'HUMAN_VERIFIED'` БАС 5 заавал ёстой `rule_test_cases` мөргүйгээр `status = 'published'` болж ЧАДАХГҮЙ.
- **Олдвор дээрх нь** — хавчаарын ДАРААХ бодит утга. `UNVERIFIED` дүрэм `CRITICAL` гэж мэдүүлж чадахгүй (`clampByVerification` нь `HIGH` болгож буулгана), тиймээс өнөөдөр `2-7`-ийн бэлэн байдлын хаалганд `CRITICAL` тоолуур ТЭГ байх нь ЗӨВ, алдаа биш.

Нийтлэх хаалганы предикат (`routes/compliance.ts` дотор):

```ts
const MIN_TESTS_BY_SEVERITY: Record<Severity, number> = {
  CRITICAL: 5, HIGH: 5, MEDIUM: 3, LOW: 1, INFO: 0,
};
// CRITICAL / HIGH нь §63-ын гол 5 кейсийг ЗААВАЛ шаардана:
const REQUIRED_CASE_CLASSES = [
  'threshold_minus', 'threshold', 'threshold_plus', 'zero', 'missing_input',
] as const;

/* ⚠️ КООРДИНАТЫН ХААЛГА — §62-ын прозыг ХААЛГА болгож хатууруулав.
 * `RevitLinkInstance.GetTotalTransform()` нь 46 add-in `.cs` файлын аль нь ч
 * БАЙХГҮЙ (§3.8-ын 5-р дүрэм).  Тиймээс `coordinate_system <> 'none'` дүрэм
 * нь ямар фрэйм дээр хэмжигдсэнээ МЭДЭХГҮЙ утга дээр ажиллана — v2 §62-ын
 * ЯГ хориглодог «далд фрэйм таамаглал».  §3.9-ийн `RuleEngine` нь Revit-ийн
 * ямар ч төрөлгүй тул өөрөө ч барьж чадахгүй.  Тиймээс ӨГӨГДЛИЙН САНГИЙН
 * ХААЛГА болгоно, зөвлөмж биш. */
const LINK_TRANSFORM_CAPABILITY_SHIPPED = false;   // ← ГАНЦ ТОГТМОЛ хаалгыг өргөнө
```

**Нийтлэх хаалганы БҮРЭН предикат** — `POST /api/compliance/rules/:uid/publish` нь дараах ДӨРВИЙН аль нэг нь биелэхгүй бол **409** + нэрлэсэн шалтгаан буцаана:

| # | Нөхцөл | 409-ийн `reason` | Эх сурвалж |
|---|---|---|---|
| 1 | `rule_test_cases` тоо ≥ `MIN_TESTS_BY_SEVERITY[severity]` | `insufficient_tests` | v2 §70 |
| 2 | `CRITICAL`/`HIGH` бол `REQUIRED_CASE_CLASSES` тав нь бүгд бий | `missing_case_class` | v2 §63 |
| 3 | `CRITICAL` бол `verification_state = 'HUMAN_VERIFIED'` | `unverified_critical` | v2 §67-R2 |
| 4 | **`coordinate_system = 'none'`, ЭСВЭЛ `LINK_TRANSFORM_CAPABILITY_SHIPPED === true`** | **`coordinate_capability_missing`** | **v2 §62** |

⚠️ **Тогтмолыг ХЭЗЭЭ өргөж болох вэ:** `revit-mcp/addin/`-д `GetTotalTransform()` бодитоор гарч, `BasisZ != (0,0,1)` эсвэл `Origin.Z != 0` үед ИЛ ТАТГАЛЗАХ салаа бичигдсэний ДАРАА. Тэр чадварын албан ёсны бүртгэл нь `2-6`-ийн `model_capabilities` (`0239`) — гэхДЭЭ **энэ сесс тэр хүснэгтийг УНШИХГҮЙ**: `2-6` нь долгион 2, энэ нь долгион 1, тиймээс хараахан байхгүй хүснэгт рүү query бичих нь `no such table` алдаа. Долгион 2-ын дараа тогтмолыг `model_capabilities`-ийн уншилтаар солих нь `2-6`-ийн ажил (§5).

⚠️ **ИЖИЛ ХААЛГА `rulePack.ts`-д ДАВХАР БАЙНА.** Багц угсрах query нь `WHERE status='published' AND (coordinate_system = 'none' OR ?LINK_TRANSFORM_SHIPPED)` — эс тэгвэл гараар `UPDATE rules SET status='published'` хийсэн мөр багцад орж, клиент дээр чимээгүй ажиллана. Хоёр газар шалгах нь давхардал биш: маршрут нь ЗОХИОГЧИЙГ, `rulePack.ts` нь ӨГӨГДЛИЙН САНГИЙН БОДИТ ТӨЛӨВИЙГ хаана.

**`authoring_check` — нийтлэхийн ӨМНӨХ зөрчилдөөний илрүүлэлт.** Хаалга давсны дараа, `status='published'` бичихийн ӨМНӨ маршрут нь нэр дэвшигч дүрмийг ижил `document_uid` эсвэл ижил элементийн ангилал дээр АЛЬ ХЭДИЙН нийтлэгдсэн дүрмүүдтэй тулгана: `applicability_json`-ы огтлолцол хоосон биш БА `check_json`-ы босго зөрж байвал `rule_conflicts`-д `detected_by = 'authoring_check'`, `scope`-ыг `team_code` ижил эсэхээр (`intra_pack` / `cross_discipline`), `precedence = 'unknown'` гэж мөр бичнэ. **Мөр бичих нь нийтлэхийг ЗОГСООХГҮЙ** — v2 §64 нь зөрчилдөөнийг ИЛЭРХИЙЛЭГДЭХ ТӨЛӨВ болгохыг шаарддаг, хориглохыг биш. Ингэснээр `rule_conflicts.detected_by`-ын гурван утгаас ХОЁР нь (`human` — `POST /conflicts`, `authoring_check` — энд) бодит бичигчтэй болно.

---

### 3.12 `backend/src/routes/compliance.ts` ба бүртгэл

Шинэ угтвар: **`/api/compliance`**. Гарцууд:

| Метод + зам | Хамгаалалт | Юу хийх |
|---|---|---|
| `GET /api/compliance/pack?team=BA&have=<v>` | `requireRole('engineer','architect','senior','admin')` | Багцыг буцаана; хувилбар өөрчлөгдөөгүй бол `{ version, unchanged: true }` |
| `GET /api/compliance/rules` | ижил | Нийтлэгдсэн дүрмийн жагсаалт (баг шүүлттэй) |
| `POST /api/compliance/rules` | `requireAdmin()` | Ноорог дүрэм үүсгэх |
| `PATCH /api/compliance/rules/:uid` | `requireManager()` | Ноорог засах; `verification_state` ахиулах |
| `POST /api/compliance/rules/:uid/publish` | `requireAdmin()` | §3.11-ийн хаалга; амжилтгүй бол 409 |
| `GET /api/compliance/documents` | ижил | Баримт + заалт |
| `POST /api/compliance/documents` | `requireAdmin()` | Баримт бүртгэх |
| `GET/PUT /api/compliance/context/:projectId` | GET ижил, PUT `requireRole('admin','architect','senior')` | `project_build_context` |
| `GET /api/compliance/tests?rule=<uid>` | `requireManager()` | `rule_test_cases` |
| **`POST /api/compliance/tests`** | **`requireManager()`** | **`rule_test_cases` мөр ҮҮСГЭХ** — `case_uid`, `rule_uid`, `rule_version`, `case_class`, `inputs_json`, `expect_verdict`, `expect_value?`, `source_kind`, `source_note?`. Их бие нь `0222`-ын CHECK олонлогуудтай ЯГ таарахыг сервер тал шалгана: `case_class` нь 14 утгын нэг, `expect_verdict` нь 5 утгын нэг, `source_kind ∈ ('authored','real_project','regression')`. `verified` нь ҮРГЭЛЖ 0-оор эхэлнэ — POST нь баталгаажуулж ЧАДАХГҮЙ |
| **`PATCH /api/compliance/tests/:case_uid`** | **`requireAdmin()`** | **Баталгаажуулах / буцаах** — `verified` 0↔1, `verified_by = viewer.sub`, `verified_at`. `inputs_json`/`expect_verdict` засвал `verified` нь 0 руу АВТОМАТААР унана (баталгаажсан тест чимээгүй өөрчлөгдөж болохгүй). Зохиогч ба баталгаажуулагч ХОЁР ӨӨР ЭРХ — тиймээс POST нь `requireManager()`, PATCH нь `requireAdmin()` |
| **`GET /api/compliance/conflicts?rule=<uid>`** | **`requireManager()`** | **`rule_conflicts` жагсаалт** — §3.10-ын харуулах бүрэлдэхүүн (эсрэг тал бүрийн `edition_ref`, `applicability`, `precedence`) энэ гарцаас л өгөгдөл авна |
| **`POST /api/compliance/conflicts`** | **`requireAdmin()`** | **Зөрчилдөөн БҮРТГЭХ** — `detected_by = 'human'`, `created_by = viewer.sub`. `ON CONFLICT (rule_uid_a, rule_uid_b, conflict_kind) DO UPDATE SET precedence = excluded.precedence, note_mn = excluded.note_mn` — `idx_rule_conflicts_pair` нь UNIQUE тул давхардсан бүртгэл нь алдаа биш, ШИНЭЧЛЭЛТ |

Бүртгэлийн хоёр өөрчлөлт:

```ts
// backend/src/index.ts — импорт + mount.  `/api/learning` (index.ts:217)-ын
// хажууд, ижил хэв маягаар.
import compliance from './routes/compliance';
app.route('/api/compliance', compliance);
```

```ts
// backend/src/lib/modules.ts — API_PREFIXES (:99-155) ба MODULE_OF (:166-…)
// ХОЁУЛАНД нэмнэ.  ⚠️ Ангилагдаагүй угтвар нь entitlementGuard-ыг ШАЛГАЛТГҮЙ
// давдаг — `/api/learning': 'learning'` (:246)-ын яг хажууд:
  '/api/compliance',            // API_PREFIXES дотор
  '/api/compliance': 'learning', // MODULE_OF дотор
```

⚠️ **`lib/workerScope.ts`-д НЭМЭХГҮЙ.** `WORKER_ALLOWED_PREFIXES` (`:18-33`) нь ЦАГААН ЖАГСААЛТ — нэмэхгүй байх нь `worker`-ыг ЗӨВ ХААНА.

⚠️ **MCP хос гарц ҮҮСГЭХГҮЙ.** `/mcp` нь root зам бөгөөд `workerScopeGuard`, `entitlementGuard`, tenant `tid` шалгалт — ГУРВУУЛАНГ НЬ зэрэг тойрдог. `backend/src/routes/learning.ts`-ийн толгой энэ гэр бүлийг MCP-д гаргахыг ХОРИГЛОСОН.

---

### 3.13 `revit-mcp/training/check_rules.py` — Revit-гүй харш

`check_nudge.py` (`:32-45`) нь `Nudges.cs`-ийг ганцаар нь түр `net10.0` csproj-д хийж `dotnet run` хийдэг. `check_rules.py` нь ЯГ ижил хэв маягаар `Units.cs` + `RuleFacts.cs` + `RuleEngine.cs` ГУРВЫГ compile хийж, `rule_test_cases`-ээс экспортолсон кейсүүдийг ажиллуулна. **`--parity` тугтай бол дээр нь TS талыг (`ruleApplicability.ts`) `node --test`-ээр ажиллуулж, хоёр гаралтыг тулгана — §3.13.1.**

Шалгах ёстой хамгийн бага олонлог:

| # | Тест | Хүлээгдэх |
|---|---|---|
| 1 | `threshold_minus` — 1499 мм, урт 12 м | `Violation` (хавчаарын ӨМНӨ) |
| 2 | `threshold` — 1500 мм, урт 12 м | `Pass` |
| 3 | `threshold_plus` — 1501 мм, урт 12 м | `Pass` |
| 4 | `zero` — 0 мм | `Violation`, `MissingInputs` ХООСОН |
| 5 | `missing_input` — `clear_width_mm` байхгүй | `Uncertain`, `MissingInputs = ["clear_width_mm"]` |
| 6 | `mixed_units` — M vs MM | `RequireSame` шидэх |
| 7 | `mixed_provenance` — `UntypedParam` эх үүсвэр | `Uncertain`, ХӨРВҮҮЛЭЛТГҮЙ |
| 8 | `no_context` — `height_m == null` | `NOT_APPLICABLE` биш, `Uncertain` |
| 9 | `conflict` — хоёр дүрэм зөрчилдөнө | `Uncertain`, `ConflictRuleUids.Length >= 2` |
| 10 | UNVERIFIED хавчаар | `Violation` → `Warning`, `EvidenceLevel = "MODEL_DERIVED"` |
| 11 | `room_boundary_location = "Center"` | `NOT_APPLICABLE`, `SkippedReason = "boundary_location"` |
| 12 | `DEG` дүрэм радиан эх сурвалж дээр | ШИДНЭ (эсвэл `Uncertain`), ҮРГЭЛЖ PASS БИШ |

#### 3.13.1 ХАМААРЛЫН ПРЕДИКАТЫН ТУЛГАЛТ — TS ↔ C# (ЗААВАЛ)

⚠️ **§61-ийн предикат ХОЁР ХЭЛ ДЭЭР ХОЁР УДАА бичигдэж байна, бөгөөд тэдгээрийг тэнцүү байлгах юу ч БАЙХГҮЙ.** `evaluateApplicability` (`ruleApplicability.ts`, §3.6) ба `RuleEngine.Evaluate`-ийн хамаарлын үе шат (`RuleEngine.cs`, §3.9) — хоёулаа ижил `applicability_json`-ыг тайлбарлана.

**Аль нь ЖИНХЭНЭ ШИЙДДЭГ вэ:** `rule_pack_versions` нь `(team_code, ruleset_version)`-оор түлхүүрлэгдсэн бөгөөд төслийн контекст АГУУЛАХГҮЙ — тиймээс **сервер хамаарлыг УРЬДЧИЛЖ ХЭРЭГЖҮҮЛЖ ЧАДАХГҮЙ**. Ажиллах үед шийддэг нь **C# хувилбар**. Харин `2-7`-ийн §59 дохио ба `rule_run_ledger.skipped_reason`-ийн ХҮЛЭЭЛТ нь **TS хувилбараас** тооцогдоно. Зөрвөл: клиент дүрмийг алгасах, сервер ажилласан гэж тоолох — `2-7`-ийн хаалга НОГООН, шалгалт нь ХИЙГДЭЭГҮЙ. Яг `check_parity.py`-ийн барьдаг бүтэлгүйтлийн хэлбэр — «эмхэтгэл амжилттай болно · тест ногоон гарна · нарийвчлал ЧИМЭЭГҮЙ унана — хэн ч мэдэхгүй» (`check_parity.py:7-9`), тэр скрипт 2026-08-24-нд яг ийм зөрүүг бодитоор олсон (`:16-18`, 215 мөрийн 7 дээр).

**Тиймээс `check_rules.py` нь ХОЁР ГҮЙЛТ хийнэ, `check_parity.py`-ийн хэв маягаар:**

```
1. rule_test_cases-ээс экспортолсон ижил fixture олонлог
      ├─→ node --test  backend/src/lib/ruleApplicability.test.ts   (TS тал)
      └─→ dotnet run   (Units.cs + RuleFacts.cs + RuleEngine.cs)   (C# тал)
2. Хоёр гаралтыг мөр мөрөөр тулгана:
      Applicability.kind   ЯГ таарна  (APPLICABLE | NOT_APPLICABLE | UNCERTAIN)
      skipped_reason       ЯГ таарна  (мөр тулгалт, NULL нь NULL-тай)
      missing[]            ЯГ таарна  (эрэмбэлсэн)
3. Нэг ч мөр зөрвөл exit 1 — «хэдэн хувь таарлаа» гэсэн ЗӨӨЛӨН хаалга БАЙХГҮЙ
```

**Тулгалтад ЗААВАЛ багтах олонлог** (дээрх 12 кейсээс гадна, бүгд хамаарлын ҮЕ ШАТЫГ л шалгана):

| # | Fixture | Хоёр талд ижил байх ёстой |
|---|---|---|
| P1 | `height_m = 52`, `stories = null` | `APPLICABLE` |
| P2 | `height_m = 51` ЯГ | `NOT_APPLICABLE`, `reason='high_rise_gate'` (хатуу `>`) |
| P3 | `height_m = null`, `stories = null` | `UNCERTAIN`, `missing=['project.height_m']` |
| P4 | `height_m = null`, `stories = 17` | `APPLICABLE` (`any` салаа) |
| P5 | `room_boundary_location = 'Center'` | `NOT_APPLICABLE`, `reason='boundary_location'` |
| P6 | `room_boundary_location = null` | `UNCERTAIN`, `missing=['doc.room_boundary_location']` |
| P7 | `element.category = 'Walls'` (дүрэм нь `Rooms`) | `NOT_APPLICABLE`, `reason='category'` |
| P8 | `name_folded` таарахгүй | `NOT_APPLICABLE`, `reason='name'` |

⚠️ `HIGH_RISE_HEIGHT_M = 51` ба `HIGH_RISE_STORIES = 16` нь **ХОЁР ФАЙЛД ХОЁУЛАНД** бичигдэнэ. Тэдгээрийг тогтмолын нэрээр нь тулгах тест (P1/P2/P4) БАЙХГҮЙ бол нэг талд 51-ийг 50 болгосон засвар ЧИМЭЭГҮЙ өнгөрнө.

---

### 3.14 Багцыг байгаа корпусаас үрлэх

Гурван эх сурвалж, гурван өөр итгэлийн түвшин. **Бүгд `UNVERIFIED`-ээр эхэлнэ.**

| Эх сурвалж | Юу өгөх | Хэрхэн |
|---|---|---|
| **`norm_items` 69 мөр** (`0120:41-111`) | `regulatory_documents` мөрүүд — `doc_uid`, `code`, `title_mn`, `norm_item_key` | Кодоос `doc_uid` гаргах (`БНбД 31-17-10` → `BNBD-31-17-10`). `edition`, `effective_from` нь **NULL**, `status = 'unconfirmed'` — тэр нь §9-ийн 1-р асуултын хариу ирэх хүртэл ҮНЭН |
| **57 `norms_*` туг** (§2.5) | `team_rule_scope` (`2-6`)-ын үр: аль баг аль баримтыг мөрддөг | НАЙМАН салбарын `types.ts`-ээс key + тайлбар хосыг хурааж, `norm_items.key` рүү зураглана — **IZ-д ЮУ Ч БАЙХГҮЙ тул бодитоор 7 файлаас хураагдана** (BA 6 · BB 13 · HAS 8 · TSBU 8 · TSAH 9 · HD 7 · AU 6 · IZ 0, §3.14.1) |
| **Темплейтийн `hint` мөрүүд** | Бодит босго ба хаалга | BB: `:151` (суулт ≤15 см), `:302` (салхины даралт ≈33 кг/м²), `:309` (30 м), `:173` (21 давхар, КОМПАНИЙН ПРАКТИК), `:235` (MNS GOST 34028:2024). HAS: `:90` (бүсчлэл). TSBU: `:86` (даралтын бүсчлэл). HD: `:101` (15 давхар). BA: `ba/template.ts:597`, `:600` (БНбД 23-01-09 уур амьсгал) |
| **`revit-mcp/CLAUDE.md` §3** | Хэмжээсийн тоонууд | `:64-66`, `:67-68`, `:69-70`, `:76-78`, `:85-86`, `:94-96`, `:106`, `:109-110`. **Бүгд `UNVERIFIED`** — `:7-11` нь өөрөө тэгж зарласан |
| **BA-ийн баримтын JSX** | Материалын тогтмолууд | `BaDocument.tsx:458`/`:466`/`:471` (ρ = 2500 кг/м³), `:583` (XPS ≈ 40 кг/м³), `:618` (чулуун хөвөн ≈ 100 кг/м³), `:644` (MNS 6227:2010, GB/T 23932-2009), `:737` (БНбД 25-01-20), `:800` (250 мм өргөгдсөн шал) |

⚠️ **`BaDocument.tsx` нь TEMPLATE БИШ, 1000+ мөрийн JSX.** «Template-ээс дүрэм гаргах» ямар ч скрипт BA-ийн материалын тогтмолуудыг ЧИМЭЭГҮЙ АЛДАНА — тэдгээрийг гараар хуулна.

⚠️ **`bb/template.ts:173` нь НОРМ БИШ.** `issue_class = 'TEAM_STANDARD'`, `document_uid = NULL`. Хурлын зөвлөмжийг БНбД гэж эшлэх нь мэргэжлийн хариуцлагын асуудал.

#### 3.14.1 БАГЦЫГ ЗОХИОХ ДАРААЛАЛ — ЭЗЭН БАТАЛСАН (2026-08-30)

**Найман салбарын багц зохиогдоно** (MGMT / EZ / GT — БАГЦГҮЙ, §1). Дараалал нь эзний шийдвэр БАС хэмжигдсэн үрийн материалын хосолмол:

**1. BA — Барилга архитектур. ЭХНИЙ, БҮРЭН, БАС БҮТЭЦИЙН ТЕМПЛЕЙТ.** Эзэн сонгов. `ba/` нь аль ч салбараас том БНбД корпустай (12 эшлэл), тиймээс ажиллаж байгаа багц хүртэлх ХАМГИЙН БОГИНО зам. Үлдсэн долоо нь BA-ийн бүтцийн эсрэг бичигдэнэ (§3.7).

**2. IZ — Интерьер зураг. ХОЁРДУГААРТ, ЭЗНИЙ ТЭРГҮҮЛЭХ АЧ ХОЛБОГДЛООР.** Эзэн брифдээ Интерьерийг НЭРЛЭСЭН. ⚠️ **Гэхдээ `iz/`-д БНбД эшлэл ТЭГ, `norms_*` туг ТЭГ** — IZ-ийн багцыг темплейтээс ХУРААХ БОЛОМЖГҮЙ, норм каталог (`0120`) ба `revit-mcp/CLAUDE.md` §3-аас **ЗОХИОНО**. **Энэ бол багцын хөтөлбөрийн ГОЛ ХУВААРИЙН ЭРСДЭЛ**: 2-р байрны багц нь хамгийн их гар ажил шаардана, тиймээс IZ-ийн интерьерийн инженерийг BA-ийн ажил дуусахаас ӨМНӨ хуваарьт оруулна.

**3–8. Үлдсэн зургаа — үрийн материалаар эрэмбэлэв.** BB → HAS → TSAH → TSBU → HD → AU.

Хэмжсэн үрийн тоо (2026-08-30, `frontend/src/features/projects/team-reports/<баг>/` лавлах бүрээр):

| Дараалал | Баг | `types.ts` `norms_*` туг | БНбД эшлэл (лавлахын нийт) | Ялгаатай норм код бичигдсэн | Хураах уу, зохиох уу |
|---|---|---|---|---|---|
| **1** | **BA** Барилга архитектур | 6 (`ba/types.ts:50-55`) | **12** (`types.ts` 7 · `template.ts` 3 · `BaDocument.tsx` 2) | 6 БНбД (21-01-02 · 21-05-10 · 23-01-09 · 25-01-20 · 31-01-10 · 35-01-22) + GB/T 23932-2009 | **ХУРААНА** — хамгийн том корпус |
| **2** | **IZ** Интерьер зураг | **0** | **0** | **0** | ⚠️ **ЗОХИОНО** — эзний тэргүүлэх ач холбогдол, үр БАЙХГҮЙ |
| 3 | **BB** Барилга бүтээц | 13 (`bb/types.ts:26-38`) | 5 (`template.ts` 3 · `types.ts` 2) | 12 (3 БНбД · 1 БНОД · 8 БД 11-1xx/50-103) | ХУРААНА — тугийн тоогоор хамгийн их |
| 4 | **HAS** Халаалт агаар сэлгэлт | 8 (`has/types.ts:22-29`) | 1 (`template.ts:90`) | 1 (БНбД 31-17-10) | ХУРААНА (тугаар), тоо нь ЗОХИОГДОНО |
| 5 | **TSAH** Цахилгаан | 9 (`tsah/types.ts:21-29`) | 0 | 0 (тугийн нэрэнд MNS IEC 60364 г.м.) | Туг ХУРААНА, тоо ЗОХИОНО |
| 6 | **TSBU** Цэвэр бохир ус | 8 (`cbu/types.ts:25-32`) | 0 | 0 | Туг ХУРААНА, тоо ЗОХИОНО |
| 7 | **HD** Холбоо дохиолол | 7 (`hd/types.ts:20-26`) | 0 | 0 | Туг ХУРААНА, тоо ЗОХИОНО |
| 8 | **AU** Автомат удирдлага | 6 (`au/types.ts:32-37`) | 0 | 0 | Туг ХУРААНА, тоо ЗОХИОНО |

Хэмжсэн команд (дахин ажиллуулж болно):

```bash
cd frontend/src/features/projects/team-reports
for d in ba bb has cbu tsah hd au iz; do
  echo "$d  norms_=$(grep -c 'norms_' $d/types.ts)  БНбД=$(grep -rhoE 'БНбД' $d/ | wc -l)"
done
# Хэмжсэн гаралт (2026-08-30):
#   ba  norms_=6   БНбД=12
#   bb  norms_=13  БНбД=5
#   has norms_=8   БНбД=1
#   cbu norms_=8   БНбД=0
#   tsah norms_=9  БНбД=0
#   hd  norms_=7   БНбД=0
#   au  norms_=6   БНбД=0
#   iz  norms_=0   БНбД=0
```

⚠️ **Тугийн тоо ба БНбД эшлэлийн тоо нь ХОЁР ӨӨР ЗҮЙЛ хэмждэг.** Туг нь «энэ баг ямар баримт мөрддөг вэ» (хамрах хүрээ, `2-6`-ийн `team_rule_scope`); БНбД эшлэл нь «репод БОДИТ норм код бичигдсэн үү» (эшлэх чадвар). BB нь тугаар тэргүүлдэг ч эшлэлээр BA-аас 2.4 дахин бага, бөгөөд түүний 8 `БД 11-1xx` нь зөвлөмжийн гарын авлага — тиймээс BA нь ЭХЛЭХ цэг байх нь зөв.

⚠️ **Дараалал нь ЗЭРЭГ АЖИЛЛАХЫГ ХОРИГЛОХГҮЙ.** BA-ийн бүтэц §3.7-д тогтмогц үлдсэн долоог зэрэг зохиож болно. Дараалал нь зөвхөн (а) ХЭН эхлээд эхлэх вэ, (б) аль баг үр байхгүйгээс УДААН болохыг урьдчилан хэлнэ.

⚠️ **Release N+1-ийн хаалга: багц бүрт ХАМГИЙН БАГА 3 дүрэм × 8 салбар = 24 дүрэм** (§9.1-ийн 6-р мөр). Энэ нь өмнө нь долоон багаар тооцогдож байсан — ЭЗНИЙ БАТАЛСАН найм нь тоог 21-ээс 24 болгоно.

---

## 4. ХӨНДӨЖ БОЛОХГҮЙ (load-bearing)

| Юу | Хаана (баталгаажсан) | Яагаад эвдрэх вэ |
|---|---|---|
| `purpose === 'mcp'` токен `/api/*`-д ажиллах | `middleware/auth.ts:101-102`, `types.ts:209-212`, `lib/tokenValidity.ts:30-34` | Add-in-ийн БҮХ REST дуудлага тэр токеноор явдаг, refresh байхгүй. Хаавал ~20 компьютер Revit хаалттай дахин суулгах — АЛСААС СЭРГЭЭХГҮЙ |
| `users` / `projects` бүтэц | 19 ба 33 cascade хүүхэд | `migrations apply` нь transaction дотор cascade асаадаг. §61-ийн 12 оролт `projects`-д багана болж ОРОХГҮЙ — `project_build_context` хүүхэд хүснэгт болно |
| `0120_norm_catalog.sql` | `:1-2` толгой, `gen-norm-seed.mjs:30` `outPath` | Хэрэгжсэн migration. Дахин үүсгэх нь ЧИМЭЭГҮЙ NO-OP. `norm_items.key` нь `project_team_reports` доторх checkbox-ийн тогтвортой холбоос — өөрчилвөл бүх төслийн сонголт өнчирнө |
| `norm_items.key` бүрэн бүтэн байдал | `0120:21`, `normCatalog.ts:13-15` | `PATCH /items/:id` (`normCatalog.ts:109-144`) нь `key`-д ХҮРДЭГГҮЙ. Дүрэм нь `key`-ээр л холбогдоно — `id` (орчноос хамаарна) ч, `code` (засагдана) ч биш |
| 57 `norms_*` тугнууд | `ba/types.ts:50-55`, `bb/types.ts:26-38`, `has/types.ts:22-29`, `cbu/types.ts:25-32`, `tsah/types.ts:21-29`, `hd/types.ts:20-26`, `au/types.ts:32-37` | Салбар бүрийн норм зураглалын ЦОРЫН ГАНЦ үлдэгдэл. Устгавал `2-6`-ийн үр алга болно. **Энэ сесс тэдгээрийг УНШИНА, ЗАСАХГҮЙ** |
| `learning_events.rule_id` үүсгэгдсэн багана | `0209:27-28`, индекс `0210:20-21` | Дүгнэлт бичих суудал БЭЛЭН. Өөр түлхүүрийн нэр сонговол индекс дэмий болно |
| `DATASET_ELIGIBLE_SQL` | `bimEvents.ts:144` | Сургалтад тэнцэх мөрийн ЦОРЫН ГАНЦ тодорхойлолт. Өөрийн `WHERE` бичих нь ХОРИОТОЙ |
| `bimEvents.ts` bind тооцоо | `:501-503` `EVENT_BINDS = 23`, `EVENT_ROWS_PER_STATEMENT = 4` | Энэ сесс `learning_events`-д багана НЭМЭХГҮЙ. Нэмвэл 23→25 нь 4 мөрийг 3 болгож, хамгийн өндөр урсгалтай хүснэгтэд 25 % алдагдал |
| 0206-ийн 8 trigger | `0206_bim_append_only.sql:1-55` | Энэ сессийн 4 хүснэгтээс `bim_*` / `learning_events` рүү `REFERENCES` бичих нь `ON DELETE SET NULL`-ыг хүүхдийн UPDATE болгож, эцгийн DELETE-ийг БҮХЭЛД НЬ ABORT хийнэ |
| `WORKER_ALLOWED_PREFIXES` | `lib/workerScope.ts:18-33` | Цагаан жагсаалт. `/api/compliance` нэмэхгүй байх нь `worker`-ыг ЗӨВ хаана |
| **ХОС ФАЙЛ: `backend/src/lib/ruleApplicability.ts` ↔ `revit-mcp/addin/RuleEngine.cs`** | §3.6 ба §3.9. Репогийн конвенц: `CLAUDE.md` «Twin files that must move together» (`lib/leavePolicy.ts` ↔ frontend хос, `lib/teamReportStatusQuestions.ts` ↔ `status-questions.ts` г.м. — **аль нь ч type-ээр ч, тестээр ч хамгаалагдаагүй**) | §61-ийн предикат ХОЁР ХЭЛ дээр хоёр удаа бичигдэнэ. **ХАМТ ЗӨӨГДӨХ ЁСТОЙ:** `HIGH_RISE_HEIGHT_M = 51`, `HIGH_RISE_STORIES = 16`, дөрвөн хаалга (51м/16 давхар · 30м · 21 давхар · 15 давхар), `Applicability`-ийн гурван `kind`, `reason` мөрийн үгсийн сан (`high_rise_gate` · `boundary_location` · `category` · `name`), `missing[]`-ийн түлхүүрийн нэрс. Ажиллах үед C# тал ШИЙДНЭ (`rule_pack_versions` нь төслийн контекстгүй тул сервер урьдчилж хэрэгжүүлж чадахгүй), харин `2-7`-ийн `rule_run_ledger.skipped_reason` хүлээлт нь TS талаас тооцогдоно — зөрвөл дүрэм АЛГАСАГДАЖ, хаалга НОГООН болно. **Цорын ганц харуул нь §3.13.1-ийн тулгалт** |
| `IntentModel.cs` гэрээ таарахгүй бол татгалзах | `:311-312` | `RulePack.cs` энэ хэв маягийг ХУУЛНА. «Ойролцоо таарвал ачаална» гэсэн хувилбар нь буруу дүрмээр чимээгүй ажиллана |
| `QtoExtractor.Round3OrNull` | `:528-534` | Жинхэнэ тэгийг NULL болгодог. Дүрмийн зам дээр ДАХИН АШИГЛАХГҮЙ — §63 нь `zero` ба `missing_input`-ыг ТУСДАА шаарддаг |
| `RevitToolBus`-ын ⛔ гэрээ | `RevitToolBus.cs:442-454` | `RuleEngine` нь энэ handler дээр ХЭЗЭЭ Ч ажиллахгүй. Ажиллуулбал Revit-ийн message loop зогсоно |
| `ChangeTracker.OnDocumentChanged` | `ChangeTracker.cs:764-775`, `:800` | Уншихаас өөр юу ч болохгүй. `Gate`-ийг диск/сүлжээ/await-ын туршид БАРИХГҮЙ |

---

## 5. ДАРААЛАЛ БА ХАМААРАЛ

### Урьдчилсан нөхцөл

| # | Нөхцөл | Хэрхэн шалгах |
|---|---|---|
| 1 | `2-1`-ийн `team_code TEXT` гэрээ тогтсон | `2-1-team-context.md` §3-ыг унших. Дүрэм нь `team_id INTEGER` ХЭРЭГЛЭХГҮЙ |
| 2 | Migration дугаар сул | `ls backend/migrations \| tail -5` — бичихийн ЯГ ӨМНӨ |
| 3 | 0212–0216 продакшн дээр хэрэгжсэн эсэх | `SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 20` (§9) |
| 4 | `backend` build ногоон | `cd backend && npx tsc --noEmit` |

### Deploy дараалал

```
1. cd backend
2. npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml
       ↓  0220 → 0221 → 0222 → 0223  (дарааллаар, файл бүр <= 7 statement)
3. npx tsc --noEmit          ← ХАТУУ ШААРДЛАГА: wrangler deploy typecheck ХИЙДЭГГҮЙ
4. npm test                  ← суурь 23 тест файл (2026-08-30) + ЭНЭ СЕССИЙН 1 =
                             24.  Шинэ файл нь ruleApplicability.test.ts (§3.13.1)
5. node scripts/check-bim-events.mjs
6. npx wrangler deploy --config wrangler.toml
       ↓  complianceModel.ts · ruleApplicability.ts · rulePack.ts · routes/compliance.ts
7. C# файлууд (Units / RuleFacts / RuleEngine / RulePack) — БИЧНЭ, ГЭХДЭЭ
   ЭНЭ СЕССИД ТАРААХГҮЙ.  2-3, 2-4, 2-8-тай хамт НЭГ релизид.
```

**Шинэ багана нь түүнийг уншдаг кодоос ХАТУУ ӨМНӨХ deploy-д гарна.** `--config wrangler.toml` нь ЗААВАЛ — репийн үндэст `wrangler.jsonc` байгаа нь өөр worker зарладаг.

### ЗЭРЭГЦЭЭ ХИЙЖ БОЛОХ Track 2 баримт бичгүүд

Эзэн хурдыг хүссэн. Энэ баримт бичиг **дараах баримт бичгүүдтэй БҮРЭН ЗЭРЭГЦЭЭ** хэрэгжинэ:

| Баримт | Зэрэгцээ юу? | Яагаад мөргөлдөхгүй вэ |
|---|---|---|
| `2-1-team-context` | ✅ ТИЙМ | Өөр migration блок (0217–0219), өөр хүснэгт (`bim_sessions`, `team_attributions`). Зөвхөн `team_code TEXT` гэрээг ХУВААЛЦАНА — тэр нь энэ баримтын өмнө ТОГТСОН |
| `2-4-nonblocking-runtime` | ✅ ТИЙМ | Өөр migration блок (0226–0228 + 0230), C# нь `ComplianceScheduler` / `BimEmitter` — энэ сессийн 4 C# файлд ХҮРЭХГҮЙ |
| `2-8-install-and-health` | ✅ ТИЙМ | Өөр migration блок (0241–0242), `addin_releases` / `addin_installs`. Нийтлэг файл БАЙХГҮЙ |
| `2-3-compliance-engine` | ⚠️ ХЭСЭГЧЛЭН | Энэ баримтын §3.5–§3.9-ийн ГЭРЭЭ тогтсоны ДАРАА эхэлнэ. `2-3` нь `compliance_findings`-ыг эзэмшинэ; энэ сесс тэр хүснэгтэд ХҮРЭХГҮЙ |
| `2-6-team-training` | ⚠️ ХЭСЭГЧЛЭН | `rule_test_cases` (0222) хэрэгжсэний дараа `gen-rule-golden.mjs` бичигдэнэ |
| `2-5`, `2-7` | ❌ ҮГҮЙ | `2-3`-ын дараа. Олдвор байхгүй бол эшлэх юм ч, тоолох юм ч алга |

**Долгион 1 = `2-1` + `2-2` + `2-4` + `2-8` — дөрвүүлээ нэг зэрэг.** `2-2` нь `2-1`-ээс зөвхөн НЭГ ГЭРЭЭ (`team_code TEXT`) авдаг тул хүлээх шаардлагагүй; тэр гэрээ энэ баримтын толгойд аль хэдийн тогтоогдсон.

### Дараа нь юу ирэх вэ

| Баримт | Энэ сессээс юуг хэрэглэх вэ |
|---|---|
| `2-3-compliance-engine` | `rules`, `rule_deps` (өдөөгчийн индекс), `RuleEngine.Evaluate`, `ruleApplicability.ts`, `Quantity` |
| `2-5-finding-surface` | `rule_clauses`, `clampByVerification`, `suppressCitation`, `SEVERITY_RANK` |
| `2-6-team-training` | `rule_test_cases` (verified=1) → `eval/golden/rules.json` |
| `2-7-readiness-and-quality` | `severity`, `expect_applicable`, `issue_class` |

### ГАР ӨГӨЛТ — энэ сесс НЭЭНЭ, өөр сесс ДУУСГАНА

Дараах ГУРАВ нь энэ сессийн хамрах хүрээнээс ГАДНА, гэхдээ **энэ сессийн бүтэц тэднийг ХҮЛЭЭЖ БАЙГАА тул нэрлэж өгөх ЁСТОЙ.** Нэрлээгүй орхивол §3.11-ийн нийтлэх хаалга нь мухардал болно (тест бичих зам байхгүй ⇒ `CRITICAL`/`HIGH` дүрэм ХЭЗЭЭ Ч нийтлэгдэхгүй).

| Юу | ХЭН дуусгах | Юу гэж тохирсон |
|---|---|---|
| **`rule_test_cases`-ын КУРАЦИЙН UI** (таб) | **`2-5-finding-surface`** — `frontend/src/features/revit-assistant/AssistantCurationPage.tsx` нь ТҮҮНИЙ «Хөндөх файлууд»-д аль хэдийн байгаа (`OverridesTab.tsx`-ийн хажууд `RuleTestsTab.tsx`) | ⚠️ `2-7`-ийн §3.5 нь «оруулах цорын ганц зам нь `2-2`-ийн курацийн UI» гэж бичсэн. **Тэр өгүүлбэрийг ингэж уншина:** оруулах зам нь `2-2`-ийн БИЧИХ МАРШРУТ (`POST/PATCH /api/compliance/tests`, §3.12); түүнийг харуулах ХУУДАС нь `2-5`-ынх. `2-7` өөрөө нь ЗӨВХӨН УНШИНА (`?nominate=1` нь ХЭВЛЭНЭ, БИЧИХГҮЙ — `nominate.py:9-10`-ийн өвлөсөн дүрэм), тиймээс UI-г түүнд өгөх нь түүний «`INSERT`/`UPDATE`/`DELETE` ОГТ байхгүй» гэсэн хамрах хүрээг эвдэнэ |
| **`verdict_stream` зөрчилдөөн илрүүлэгч** | **`2-3-compliance-engine`** — `compliance_findings` ба `finding_edges` (`0225`) нь түүний хүснэгт | Энэ сесс `0222`-т CHECK утгыг л бэлдэнэ. **Релиз N-д тэр утгатай мөр ТЭГ** (§6-ын шалгуур) |
| **`model_capabilities`-аар координатын хаалгыг өргөх** | **`2-6-team-training`** — `0239` нь түүний migration | Энэ сесс `LINK_TRANSFORM_CAPABILITY_SHIPPED = false` ТОГТМОЛ хэрэглэнэ. Долгион 1-д тэр хүснэгт БАЙХГҮЙ тул түүн рүү query бичих нь `no such table` |

⚠️ **РЕЛИЗ N-д UI БАЙХГҮЙ БАЙЖ БОЛНО, БИЧИХ ЗАМ БАЙХГҮЙ БАЙЖ БОЛОХГҮЙ.** UI ирэх хүртэл админ `POST /api/compliance/tests`-ыг `curl`-ээр (эсвэл нэг удаагийн seed скриптээр) хөтөлнө — §7-ийн **10c** блокт бүтэн жишээ бий. Маршрут нь ЗААВАЛ энэ сессид гарна: `2-5` нь долгион 3, харин §3.11-ийн хаалга нь долгион 1-д аль хэдийн хүчинтэй болно.

---

## 6. ХҮЛЭЭН АВАХ ШАЛГУУР

### Migration

- [ ] `ls backend/migrations | tail -6` нь `0220_regulatory_documents.sql`, `0221_rules.sql`, `0222_rule_conflicts_tests.sql`, `0223_project_context_packs.sql` дөрвийг харуулна
- [ ] Файл бүрийн statement тоо: `0220` = **7**, `0221` = **7**, `0222` = **6**, `0223` = **6**. Аль нь ч 7-оос ХЭТРЭХГҮЙ
- [ ] `grep -c '/\*' backend/migrations/022[0-3]*.sql` → **0 0 0 0** (блок тайлбар байхгүй)
- [ ] `grep -n ';.*[^ ]' backend/migrations/022[0-3]*.sql | grep -v '^\s*$'` → мөрийн ТӨГСГӨЛӨӨС өөр `;` байхгүй
- [ ] `grep -c 'IF NOT EXISTS' backend/migrations/0220_regulatory_documents.sql` → **7**
- [ ] Дөрвөн файлын аль нь ч `bim_artifacts`, `revit_transactions`, `revit_element_touches`, `learning_events` рүү `REFERENCES` БИЧИХГҮЙ: `grep -c 'REFERENCES \(bim_\|revit_\|learning_\)' backend/migrations/022[0-3]*.sql` → **0**
- [ ] `npx wrangler d1 migrations apply … --remote` → 4 файл АМЖИЛТТАЙ, `d1_migrations`-д 4 шинэ мөр

### Схем

- [ ] `PRAGMA table_info(rules)` нь `verification_state`, `unit`, `severity`, `issue_class`, `team_code`, `semantic_hash`, `expect_applicable`, `requires_triggered_json` бүгдийг харуулна
- [ ] `INSERT INTO rules (rule_uid, semantic_hash, title_mn, verification_state) VALUES ('X',' h','t','CLAUSE_CITED')` → **CHECK constraint failed** (clause_uid/edition_ref/effective_from дутуу)
- [ ] `INSERT … verification_state='UNVERIFIED'` ижил мөрөөр → **АМЖИЛТТАЙ**
- [ ] `INSERT INTO rules … unit='FT'` → **CHECK constraint failed**
- [ ] `INSERT INTO rules … severity='BLOCKER'` → **CHECK constraint failed**
- [ ] `INSERT INTO rule_pack_versions … pack_sha256='abc'` → **CHECK constraint failed** (length ≠ 64)
- [ ] `project_build_context`-д нэг `(project_id, doc_uid)` хосыг хоёр удаа оруулах → **UNIQUE constraint failed**

### Код

- [ ] `cd backend && npx tsc --noEmit` → **ЦЭВЭР**
- [ ] `npm test` → **суурь + 1 = 24 тест файл** (2026-08-30-нд `ls src/lib/*.test.ts src/mcp/*.test.ts | wc -l` = **23**; энэ сесс `ruleApplicability.test.ts`-ыг НЭМНЭ, §3.13.1). Уналт ТЭГ. ⚠️ `node --test "src/**/*.test.ts"` нь Node **v22.14.0** дээр файл болгонд `ERR_UNKNOWN_FILE_EXTENSION: ".ts"` шидэж 0/24 унана — суурь нь өөрөө УЛААН. `.ts` glob-ыг Node **>= 23.6** (эсвэл `--experimental-strip-types`) шаардана. Тиймээс суурийг ЯГ ижил Node хувилбар дээр авч харьцуулна
- [ ] `node scripts/check-bim-events.mjs` → ногоон
- [ ] `clampByVerification({ verificationState:'UNVERIFIED', rawVerdict:'VIOLATION', rawEvidence:'RULE_BACKED', severity:'CRITICAL' })` → `{ verdict:'WARNING', evidenceLevel:'MODEL_DERIVED', severity:'HIGH', suppressCitation:true }`
- [ ] `clampByVerification({ verificationState:'HUMAN_VERIFIED', rawVerdict:'VIOLATION', … })` → `verdict:'VIOLATION'`, `suppressCitation:false`
- [ ] `opensHighRiseDocumentSet({ heightM:null, storiesAboveGrade:null })` → **`null`** (UNCERTAIN, `false` БИШ)
- [ ] `opensHighRiseDocumentSet({ heightM:52 })` → `true`; `{ heightM:51 }` → `false` (ЯГ 51 нь хатуу `>`)
- [ ] `opensHighRiseDocumentSet({ storiesAboveGrade:17 })` → `true`; `{ storiesAboveGrade:16 }` → `false`

### API

- [ ] `GET /api/compliance/pack?team=BA` `engineer`-ийн токеноор → **200**, `pack_contract: "rulepack-v1"`
- [ ] Ижил дуудлага `?have=<яг тэр хувилбар>` → **200** `{ unchanged: true }`, `rules` талбар БАЙХГҮЙ
- [ ] `GET /api/compliance/pack?team=BA` **`client`**-ийн токеноор → **403**
- [ ] `GET /api/compliance/pack?team=BA` `worker`-ийн токеноор → **403** (workerScope)
- [ ] `POST /api/compliance/rules` `engineer`-ийн токеноор → **403**
- [ ] `POST /api/compliance/rules/BA-HR-CORRIDOR-W-001/publish` (тест кейс 0 байхад, severity=HIGH) → **409**, `reason: "insufficient_tests"`

**Тест кейс бичих зам БОДИТООР АЖИЛЛАХ (§3.11-ийн мухардлыг хаах шалгуур):**

- [ ] `POST /api/compliance/tests` `engineer`-ийн токеноор → **403**; `senior`-ийн токеноор → **201**
- [ ] `POST /api/compliance/tests` `case_class: 'ХЭЛБЭРГҮЙ'`-ээр → **400** (`0222`-ын 14 утгын CHECK-тэй тулгагдана, DB-д ХҮРЭХГҮЙ)
- [ ] `POST /api/compliance/tests` `expect_verdict: 'MAYBE'`-ээр → **400**; `source_kind: 'guess'`-ээр → **400**
- [ ] `POST /api/compliance/tests` нь `verified: 1` илгээхэд ч мөр нь `verified = 0` болно: `SELECT verified FROM rule_test_cases WHERE case_uid = ?` → **0**
- [ ] `PATCH /api/compliance/tests/:case_uid` `{verified:1}` `senior`-ийн токеноор → **403**; `admin`-ийн токеноор → **200**, `verified_by` бөглөгдөнө
- [ ] **БҮТЭН ГИНЖ:** шинэ `severity='HIGH'` дүрэм үүсгэ → `REQUIRED_CASE_CLASSES`-ийн ТАВАН кейс `POST` → `publish` → **200**, `status='published'`
- [ ] Тэр таван кейсийн НЭГИЙГ устгаад дахин `publish` → **409**, `reason: "missing_case_class"`
- [ ] `severity='CRITICAL'` дүрэм, 5 кейстэй, `verification_state='UNVERIFIED'` → `publish` → **409**, `reason: "unverified_critical"`

**Координатын хаалга (§62):**

- [ ] `coordinate_system='shared'` дүрэм, 5 кейстэй, `HUMAN_VERIFIED` → `publish` → **409**, `reason: "coordinate_capability_missing"`
- [ ] Тэр дүрмийг гараар `UPDATE rules SET status='published'` хийсний ДАРАА ч багцад ОРОХГҮЙ: `GET /api/compliance/pack?team=BA` → `jq '[.rules[] | select(.coordinate_system != "none")] | length'` → **0**
- [ ] `grep -n "LINK_TRANSFORM_CAPABILITY_SHIPPED" backend/src/routes/compliance.ts backend/src/lib/rulePack.ts` → **ХОЁУЛАНД** олдоно

**Зөрчилдөөний бүртгэл (§64):**

- [ ] `POST /api/compliance/conflicts` `senior`-ийн токеноор → **403**; `admin`-ийн токеноор → **201**, `detected_by='human'`
- [ ] Ижил `(rule_uid_a, rule_uid_b, conflict_kind)`-ыг дахин `POST` → **200**, мөрийн тоо НЭМЭГДЭХГҮЙ, `precedence` нь ШИНЭЧЛЭГДСЭН (`ON CONFLICT … DO UPDATE`)
- [ ] `GET /api/compliance/conflicts?rule=<uid>` нь `edition_ref`, `applicability_json`, `precedence` ГУРВУУЛАНГ буцаана (§3.10-ын харуулах бүрэлдэхүүн)
- [ ] Ижил `document_uid` дээр босго нь зөрөх хоёр дахь дүрмийг `publish` хийхэд `rule_conflicts`-д `detected_by='authoring_check'` мөр ҮҮСНЭ, гэхдээ `publish` нь **200** (зөрчилдөөн нь бүртгэл, хориг БИШ)
- [ ] **`SELECT COUNT(*) FROM rule_conflicts WHERE detected_by='verdict_stream'` → 0** — тэр утга нь `2-3`-ынх, релиз N-д БИЧИГДЭХГҮЙ (§3.10)

- [ ] BA-ийн багц дотор `team_code='IZ'` дүрэм **НЭГ Ч БАЙХГҮЙ**: `jq '[.rules[] | select(.team_code != "BA" and .team_code != null)] | length'` → **0**

**Багийн бүртгэл — ЭЗЭН БАТАЛСАН 8 (2026-08-30):**

- [ ] `SELECT DISTINCT team_code FROM rules WHERE team_code IS NOT NULL` → зөвхөн `BA · BB · HAS · TSBU · TSAH · HD · AU · IZ`-ийн дэд олонлог. **`MGMT`, `EZ`, `GT` НЭГ Ч БАЙХГҮЙ**
- [ ] `SELECT COUNT(*) FROM rule_pack_versions WHERE team_code IN ('MGMT','EZ','GT')` → **0** (тэдгээр нь багц авахгүй)
- [ ] `GET /api/compliance/pack?team=MGMT` → **404** эсвэл хоосон багц; ХЭЗЭЭ Ч өөр багийн дүрэм буцаахгүй (v2 §48 — багцгүй баг нь ЮУТАЙ Ч тулгагдахгүй. ⚠️ Энэ нь `TEAM = UNCERTAIN` **БИШ**: илрүүлэлт амжилттай, `team_code` нь бодит `MGMT` — зөвхөн шалгалт алгасагдана. `2-1 §3.4`-ийг үз)
- [ ] `grep -nE "(^|[^_a-zA-Z])(7|8|9|11)( |\)|,).*(team|баг)" backend/src/lib/rulePack.ts backend/src/routes/compliance.ts` → салбарын ТООГ хатуу бичсэн газар **БАЙХГҮЙ**; олонлог нь `teams.code`-оос ажиллах үед уншигдана (§0-ын 11-р дүрэм)

### Дүрмийн агуулга

- [ ] `BA-HR-CORRIDOR-W-001` ба `IZ-HR-CEIL-H-001` хоёулаа `"verification_state": "UNVERIFIED"`
- [ ] Хоёулаа `requires.triggered_by` ХООСОН БИШ (§52-ын индекс query хийгдэнэ)
- [ ] `BA-HR-CORRIDOR-W-001`-ийн `applicability` нь `doc.room_boundary_location = "Finish"`-ыг АГУУЛНА
- [ ] `SELECT COUNT(*) FROM rules WHERE unit='NONE' AND check_json <> '{}'` → **0** (тоон дүрэм нэгжгүй байж болохгүй)
- [ ] `SELECT COUNT(*) FROM rules WHERE verification_state<>'UNVERIFIED' AND clause_uid IS NULL` → **0**

### C# (compile л, Revit шаардахгүй)

- [ ] `python revit-mcp/training/check_rules.py` → 12/12 кейс тэнцэнэ
- [ ] `grep -c "Autodesk.Revit" revit-mcp/addin/RuleEngine.cs revit-mcp/addin/RuleFacts.cs revit-mcp/addin/Units.cs` → **0 0 0**
- [ ] `grep -c "Round3OrNull" revit-mcp/addin/RuleEngine.cs revit-mcp/addin/RuleFacts.cs revit-mcp/addin/Units.cs` → **0 0 0**

### ХАМААРЛЫН ТУЛГАЛТ — TS ↔ C# (§3.13.1)

- [ ] `node --test backend/src/lib/ruleApplicability.test.ts` → **P1–P8 бүгд тэнцэнэ**
- [ ] `python revit-mcp/training/check_rules.py --parity` → **P1–P8 дээр хоёр талын `kind` / `skipped_reason` / `missing[]` ЯГ таарна**, зөрсөн мөр бүрийг хэвлэж **exit 1**
- [ ] Санаатай эвдэлж баталгаажуулах: `ruleApplicability.ts`-ийн `HIGH_RISE_HEIGHT_M`-ыг түр 50 болго → `--parity` нь **P2 дээр УНАНА** (`NOT_APPLICABLE` vs `APPLICABLE`). Буцааж 51 болго. **Энэ алхмыг алгасвал тулгалт нь ажиллаж байгаа эсэх нь батлагдаагүй** — `check_parity.py:16-18` нь 2026-08-24-нд яг ийм маягаар бодит алдаа барьсан (215 мөрийн 7)
- [ ] `grep -c "HIGH_RISE_HEIGHT_M\|HIGH_RISE_STORIES" backend/src/lib/ruleApplicability.ts revit-mcp/addin/RuleEngine.cs` → **хоёулаа > 0** (хос файл, §4)

### Хамрах хүрээ

- [ ] `git status --short` нь ЗӨВХӨН толгойн жагсаалтын файлуудыг харуулна
- [ ] Бүтэн build улаан бол алдаа нь ЭНЭ жагсаалтад БАЙХГҮЙ файлууд дээр эсэхийг батал

---

## 7. ШАЛГАХ КОМАНД

```bash
# --- 1. ДУГААР — бичихийн ЯГ ӨМНӨ ---
cd /Users/twissu/Desktop/company/MGL-ERP/mgl-e-c/backend
ls migrations | tail -5
# Хүлээгдэх: 0212 … 0216_assistant_log_timing.sql
# 0220 аль хэдийн эзэлсэн бол БҮХ БЛОКИЙГ нэгээр шилжүүл (§3.0)

# --- 2. STATEMENT ТОО — тээврийн дүрэм ---
for f in migrations/0220_*.sql migrations/0221_*.sql migrations/0222_*.sql migrations/0223_*.sql; do
  n=$(grep -c ';' "$f")
  echo "$f  → $n statement"
done
# Хүлээгдэх: 7 / 7 / 6 / 6.  Аль нь ч 7-оос ИХ бол ХУВААНА.

# --- 3. БЛОК ТАЙЛБАР БАЙХГҮЙ ---
grep -n '/\*' migrations/022[0-3]*.sql
# Хүлээгдэх: гаралт БАЙХГҮЙ

# --- 4. BIM ХҮСНЭГТ РҮҮ FK БАЙХГҮЙ ---
grep -n 'REFERENCES \(bim_\|revit_\|learning_\)' migrations/022[0-3]*.sql
# Хүлээгдэх: гаралт БАЙХГҮЙ

# --- 5. ХАРУУЛУУД ---
node --test src/lib/migrationSchema.test.ts
npx tsc --noEmit
npm test
node scripts/check-bim-events.mjs
# Хүлээгдэх: бүгд ногоон; npm test нь 24 тест файл (суурь 23 + ruleApplicability.test.ts).
# ⚠️ Node v22.14.0 дээр npm test нь ERR_UNKNOWN_FILE_EXTENSION-оор 0/23 унана —
#    .ts glob-д Node >= 23.6 эсвэл --experimental-strip-types хэрэгтэй.  `node --version`-оо
#    суурь авсан үеийнхтэй тулгана, эс бөгөөс «улаан» нь чиний өөрчлөлт БИШ.

# --- 6. MIGRATION (эхлээд), ДАРАА НЬ WORKER ---
npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml
# Хүлээгдэх: 4 файл амжилттай
npx wrangler deploy --config wrangler.toml

# --- 7. СХЕМ ПРОДАКШН ДЭЭР ---
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('regulatory_documents','rule_clauses','rules','rule_deps','rule_conflicts','rule_test_cases','project_build_context','rule_pack_versions') ORDER BY name"
# Хүлээгдэх: 8 мөр

# --- 8. CHECK ХЯЗГААРЛАЛТ ЖИНХЭНЭ ЭСЭХ ---
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "INSERT INTO rules (rule_uid, semantic_hash, title_mn, verification_state) VALUES ('TMP-1','h','t','CLAUSE_CITED')"
# Хүлээгдэх: CHECK constraint failed
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "INSERT INTO rules (rule_uid, semantic_hash, title_mn, unit) VALUES ('TMP-2','h','t','FT')"
# Хүлээгдэх: CHECK constraint failed

# --- 9. БАГЦ — БАГИЙН ТУСГААРЛАЛТ ---
# ӨМНӨ: /api/compliance байхгүй → 404
# ДАРАА:
curl -s -H "Authorization: Bearer $TOKEN_ENGINEER" \
  "https://<worker>/api/compliance/pack?team=BA" | jq '.pack_contract, ([.rules[] | select(.team_code!="BA" and .team_code!=null)] | length)'
# Хүлээгдэх: "rulepack-v1"  ба  0

curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN_CLIENT" \
  "https://<worker>/api/compliance/pack?team=BA"
# Хүлээгдэх: 403

# --- 10. C# — REVIT-ГҮЙ ХАРШ ---
cd ../revit-mcp/training
../../revit-mcp/server/.venv/Scripts/python.exe check_rules.py
# Хүлээгдэх: 12/12 OK
grep -c "Autodesk.Revit" ../addin/RuleEngine.cs ../addin/RuleFacts.cs ../addin/Units.cs
# Хүлээгдэх: 0 0 0

# --- 10b. ХАМААРЛЫН ТУЛГАЛТ — TS ↔ C# (§3.13.1) ---
cd /Users/twissu/Desktop/company/MGL-ERP/mgl-e-c/backend
node --test src/lib/ruleApplicability.test.ts
# Хүлээгдэх: P1–P8 ногоон
cd ../revit-mcp/training
../../revit-mcp/server/.venv/Scripts/python.exe check_rules.py --parity
# Хүлээгдэх: "PARITY OK  8/8".  Зөрвөл мөр бүрийг хэвлээд exit 1.
#
# ⚠️ ХАРУУЛ НЬ ӨӨРӨӨ АЖИЛЛАЖ БАЙГААГ БАТАЛ (энэ алхмыг АЛГАСАХГҮЙ):
#   ruleApplicability.ts-ийн HIGH_RISE_HEIGHT_M -ыг ТҮР 50 болго
../../revit-mcp/server/.venv/Scripts/python.exe check_rules.py --parity
# Хүлээгдэх: P2 дээр УНАНА (exit 1).  Дараа нь 51 болгож БУЦААНА.
grep -c "HIGH_RISE_HEIGHT_M\|HIGH_RISE_STORIES" \
  ../../backend/src/lib/ruleApplicability.ts ../addin/RuleEngine.cs
# Хүлээгдэх: хоёулаа > 0 — хос файл (§4)

# --- 10c. ТЕСТ КЕЙС БИЧИХ ЗАМ (§3.11-ийн мухардлыг хаах) ---
# ⚠️ РЕЛИЗ N-д КУРАЦИЙН UI БАЙХГҮЙ (тэр нь 2-5-ынх, §5).  Админ ЭНЭ ЗАМААР хөтөлнө.
for CLS in threshold_minus threshold threshold_plus zero missing_input; do
  curl -s -o /dev/null -w "$CLS %{http_code}\n" -X POST \
    -H "Authorization: Bearer $TOKEN_SENIOR" -H "Content-Type: application/json" \
    -d "{\"case_uid\":\"BA-HR-CORRIDOR-W-001#$CLS\",\"rule_uid\":\"BA-HR-CORRIDOR-W-001\",\"rule_version\":1,\"case_class\":\"$CLS\",\"inputs_json\":\"{}\",\"expect_verdict\":\"PASS\",\"source_kind\":\"authored\"}" \
    "https://<worker>/api/compliance/tests"
done
# Хүлээгдэх: тав тавуулаа 201
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "Authorization: Bearer $TOKEN_SENIOR" \
  "https://<worker>/api/compliance/rules/BA-HR-CORRIDOR-W-001/publish"
# Хүлээгдэх: 403 (publish нь requireAdmin)
curl -s -X POST -H "Authorization: Bearer $TOKEN_ADMIN" \
  "https://<worker>/api/compliance/rules/BA-HR-CORRIDOR-W-001/publish" | jq '.status, .reason'
# Хүлээгдэх: "published", null
# Нэг кейс устгаад дахин:
# Хүлээгдэх: 409  "missing_case_class"

# --- 10d. КООРДИНАТЫН ХААЛГА (§62) ---
curl -s -X POST -H "Authorization: Bearer $TOKEN_ADMIN" \
  "https://<worker>/api/compliance/rules/<shared-coord-rule>/publish" | jq '.reason'
# Хүлээгдэх: "coordinate_capability_missing"
grep -n "LINK_TRANSFORM_CAPABILITY_SHIPPED" \
  /Users/twissu/Desktop/company/MGL-ERP/mgl-e-c/backend/src/routes/compliance.ts \
  /Users/twissu/Desktop/company/MGL-ERP/mgl-e-c/backend/src/lib/rulePack.ts
# Хүлээгдэх: ХОЁУЛАНД олдоно (маршрут ба багц угсрагч — давхар хаалга)

# --- 10e. ЗӨРЧИЛДӨӨНИЙ БҮРТГЭЛ (§64) ---
cd /Users/twissu/Desktop/company/MGL-ERP/mgl-e-c/backend
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT detected_by, COUNT(*) AS n FROM rule_conflicts GROUP BY detected_by"
# Хүлээгдэх: 'human' ба/эсвэл 'authoring_check' мөр гарч БОЛНО.
#            'verdict_stream' мөр ХЭЗЭЭ Ч ГАРАХГҮЙ — тэр нь 2-3-ынх (§3.10).

# --- 11. ХАМРАХ ХҮРЭЭ ---
cd /Users/twissu/Desktop/company/MGL-ERP/mgl-e-c
git status --short
git diff --stat
# Зөвшөөрөгдсөн зөвхөн:
#   backend/migrations/0220_regulatory_documents.sql
#   backend/migrations/0221_rules.sql
#   backend/migrations/0222_rule_conflicts_tests.sql
#   backend/migrations/0223_project_context_packs.sql
#   backend/src/lib/complianceModel.ts
#   backend/src/lib/ruleApplicability.ts
#   backend/src/lib/ruleApplicability.test.ts
#   backend/src/lib/rulePack.ts
#   backend/src/routes/compliance.ts
#   backend/src/index.ts
#   backend/src/lib/modules.ts
#   revit-mcp/addin/Units.cs
#   revit-mcp/addin/RuleFacts.cs
#   revit-mcp/addin/RuleEngine.cs
#   revit-mcp/addin/RulePack.cs
#   revit-mcp/training/check_rules.py
#   docs/bim-ai/2-2-rule-model.md
# git add -A БҮҮ хэрэглэ — файл бүрийг нэрээр нь нэм.
```

**Гар туршилт (Revit нээлттэй, автоматжуулах боломжгүй) — ЭНЭ СЕССИД ХИЙХГҮЙ, релизийн үед:**

1. BA-ийн инженерийн компьютерт багц татагдаж `%APPDATA%\RevitMcpAddin\rulepack-BA-<sha[:16]>-<pid>.json` үүссэн эсэх
2. Тэр файлыг ГАРААР засаад Revit дахин эхлүүлэхэд `RulePack` нь hash зөрснөөр ТАТГАЛЗАЖ, шигтгээстэй canary руу унасан эсэх
3. Сүлжээ салгасан үед add-in ажиллаж, локал багц хэвээр ачаалагдаж байгаа эсэх (§75)

---

## 8. ROLLBACK

| Алхам | Буцаах арга |
|---|---|
| Migration хэрэгжихээс ӨМНӨ | Дөрвөн `.sql` файлыг устгана. **Өгөгдлийн эрсдэл: ТЭГ** |
| Migration хэрэгжсэний ДАРАА | Хүснэгтүүд ХЭВЭЭР ҮЛДЭЭНЭ. Тэдгээр нь ХООСОН, `2-3` хүртэл ямар ч уншигчгүй. `DROP TABLE` нь ШИНЭ migration шаардах ба ямар ч ашиггүй эрсдэл |
| Worker deploy | Өмнөх commit-оос `npx wrangler deploy --config wrangler.toml`. `/api/compliance` нь 404 болно; add-in нь `RulePack`-ийн `catch` дотор ЧИМЭЭГҮЙ өнгөрнө (`IntentModel`/`ApiClient.cs:194-196`-ийн хэв маяг) |
| Файл бүтэлгүйтсэн (хагас хэрэгжсэн) | **⚠️ ШИНЭ ДУГААР ЗААВАЛ.** Хагас хэрэгжсэн файл нь `d1_migrations`-д мөр ҮЛДЭЭХГҮЙ, тиймээс дараагийн `apply` нь түүнийг ДАХИН ажиллуулна. Statement бүр `IF NOT EXISTS` тул дахин ажиллах нь аюулгүй — ГЭХДЭЭ хэрэв дугаарыг нь өөрчилсөн бол хуучин нэрийг гараар `d1_migrations`-д оруулж БОЛОХГҮЙ |
| C# файлууд | Дөрвөн шинэ `.cs` файлыг устгана. Тэдгээр нь `App.cs`-ээс дуудагдахгүй, `RevitTools.ToolNames` (`:53-64`)-д БҮРТГЭГДЭХГҮЙ тул add-in-ийн зан төлөв ӨӨРЧЛӨГДӨХГҮЙ |

**Хэрэгжсэн migration файлыг засах нь продакшн дээр ЧИМЭЭГҮЙ NO-OP.**

**Кэшийн үлдэгдэл:** `withEdgeCache` энэ сессид ХЭРЭГЛЭГДЭХГҮЙ. `/api/compliance/pack` нь `?have=` товчлолоор ажиллана — edge cache нэмбэл багцын хувилбарыг хуучин болгож, инженерүүд өөр өөр дүрмээр ажиллана.

**Rollback-ийн шалгуур.** Дараах шинж тэмдгүүд буцаахыг зөвтгөнө: (а) `npx tsc --noEmit` нь ЭНЭ жагсаалтын файл дээр унасан; (б) `/api/compliance/pack` нь `engineer`-т 500 буцааж байгаа; (в) `check-bim-events.mjs` улаан болсон; (г) migration хагас хэрэгжсэн. Дараах нь буцаахыг ЗӨВТГӨХГҮЙ: багц хоосон (canary л байгаа) — тэр нь ЗОРИУД төлөв; `CRITICAL` тоолуур тэг — `UNVERIFIED` хавчаарын ЗӨВ үр дүн.

---

## 9. ЭХЛЭХИЙН ӨМНӨ ТОДРУУЛАХ

Эдгээрийг репогоос ХАРИУЛАХ БОЛОМЖГҮЙ — эзэн эсвэл продакшны асуулга шаардана.

### 9.1 Эзний шийдвэр — инженерийн биш

> **✅ ХОЁР АСУУЛТ ХААГДСАН — ЭЗЭН БАТАЛСАН 2026-08-30.** (1) **Бүртгэл нь НАЙМАН салбарын баг**: BA · BB · HAS · TSBU · TSAH · HD · AU · IZ — эзний үг: «MGMT-ийг хасаад үлдсэн 8-н багийг оруулна». `MGMT`, `EZ`, `GT` нь багцгүй. (2) **BA нь эхний бүрэн багц ба бүтэцийн темплейт**, IZ нь хоёрдугаарт. Дэлгэрэнгүй: v2 §46, энэ баримтын §3.7 ба §3.14.1. Доорх 2 ба 3-р мөр нь ТҮҮХЭН БҮРТГЭЛ болж үлдэв — асуулт БИШ.

| # | Асуулт | Яагаад чухал | Хэрхэн олох |
|---|---|---|---|
| 1 | **АЛБАН ЁСНЫ БНбД БАРИМТЫГ ХЭН, ЯМАР ХЭВЛЭЛЭЭР ХУДАЛДАЖ АВАХ ВЭ?** | Эдгээргүйгээр `rule_clauses` хоосон, `verification_state` нь `UNVERIFIED` дээр ҮҮРД гацна, ямар ч дүрэм КОД ХАРУУЛЖ ЧАДАХГҮЙ (§3.5), `eval/golden/rules.json` хоосон хэвээр (`run_golden.py --kind rules` exit 2). R2/R5/R6-ийн ЭГЦ ЗАМ. **Одоо ЭЗЭНГҮЙ.** Энэ бол баримт худалдан авалт, инженерчлэл БИШ | Эзэн. mcis.gov.mn-ээс аль хэвлэл хүчинтэйг тодруулна |
| 2 | ~~**IZ (Интерьер зураг) нь ДҮРЭМ ЭЗЭМШИХ баг мөн үү?**~~ **✅ ХААГДСАН — ТИЙМ (ЭЗЭН БАТАЛСАН 2026-08-30).** | IZ нь баталсан 8-ын нэг, БАС **эзний тэргүүлэх ач холбогдлоор ХОЁРДУГААР багц**. Репо өөртэйгөө зөрж байсан (`projectCategories.ts:35` `AZ_TEAMS`, `TeamFormTemplatesPage.tsx:33-70`, `docHelpers.ts:4` — IZ-гүй ДОЛОО; `tasks.ts:395`, `teamMeta.ts:9`, `teamReportFieldCatalog.ts` — НАЙМ, IZ-тэй) — эзэн НАЙМЫГ сонгосноор зөрүү дуусав, тэр найм нь шипсэн `IMPLEMENTED_TEAMS`-тэй (`TeamReportsTab.tsx:52-61`) ЯГ ижил. IZ-д `norms_*` туг ТЭГ, БНбД эшлэл ТЭГ (§2.5, §3.14.1) тул түүний багцыг **ЗОХИОНО, хурааж авахгүй** | ✅ Хаагдсан. Үлдсэн ажил нь эзний биш, инженерийнх: интерьерийн инженер IZ-ийн эхний 3 дүрмийг баталгаажуулна |
| 3 | ~~**MGMT, EZ, GT нь дүрмийн багц авах уу?**~~ **✅ ХААГДСАН — ҮГҮЙ (ЭЗЭН БАТАЛСАН 2026-08-30).** | MGMT нь зураг төслийн салбар БИШ; EZ/GT (`0074_seed_ez_gt_teams.sql:12-14`) нь блокийн угтвар болж тарьсан, гишүүнгүй. **Гурвуулаа багцгүй, нийцлийн шалгалтгүй.** `teams`-д мөртэй ч багцгүй баг нь **ЮУТАЙ Ч тулгагдахгүй** — ӨӨР БАГИЙН дүрмээр ХЭЗЭЭ Ч шалгагдахгүй. ⚠️ **Энэ төлөв нь `TEAM = UNCERTAIN` БИШ** (канон: `2-1 §3.4`): илрүүлэлт **амжилттай** болсон тул `bim_sessions.team_code` нь бодит код (`MGMT`/`EZ`/`GT`), `team_source`/`team_confidence` нь шатны бодит утга, `learning_events` нь тэр кодоор ШОШГОЛОГДОНО — сургалтын өгөгдөл зөв харьяалагдана. Зөвхөн `complianceEnabled` → `false`. `UNCERTAIN` гэдэг нь илрүүлэлт УНАСАН тохиолдол (`team_code = NULL`) бөгөөд хэрэглэгчээс залруулга шаардана; багцгүй баг нь ЮУ Ч шаардахгүй, баг нь аль хэдийн зөв. v2 §69-ийн «Team checks: n/n» хаалга нь **төсөл дээр БОДИТООР байгаа багуудын багцыг л** тоолно, 8 гэсэн литералыг БИШ | ✅ Хаагдсан |
| 4 | **ЦАХИЛГААН ШАТНЫ НОРМ АЛЬ ВЭ?** | 69 мөрийн каталогт лифт/цахилгаан шатны НЭГ Ч код байхгүй (§2.3), харин `fireTemplate.ts` нь `evac_dedicated_fire_lift`, `smoke_dedicated_ff_lift_shaft`, `integ_fa_lift_recall` талбартай. Өндөр барилгын галын лифтийн дүрэм ЭШЛЭХ БАРИМТГҮЙ | Эзэн + галын инженер |
| 5 | **`bb/template.ts:173`-ын «21 давхар» нь норм уу, компанийн практик уу?** | Текст нь «МАКС ӨРГӨӨ хурлын зөвлөмжийн дагуу» гэсэн. Бид үүнийг `issue_class='TEAM_STANDARD'`, `document_uid=NULL` гэж шийдэв. Норм гэж эшлэвэл хурлын тэмдэглэлийг хууль болгож харуулна | Эзэн — баталгаажуулах |
| 6 | **ХЭН, ХЭДЭН ДҮРЭМ ЗОХИОХ ВЭ — БАГ ТУС БҮРЭЭР?** (ДАРААЛАЛ нь ХААГДСАН, ХҮН ба ТОО нь НЭЭЛТТЭЙ) | **ДАРААЛАЛ ✅ ХААГДСАН (ЭЗЭН БАТАЛСАН 2026-08-30):** BA эхэлж, БҮРЭН бичигдэж, бүтэцийн темплейт болно; IZ хоёрдугаарт (эзний тэргүүлэх ач холбогдол, гэхдээ үрийн материал ТЭГ); дараа нь BB → HAS → TSAH → TSBU → HD → AU үрийн тоогоор (§3.14.1). **ХЭВЭЭР НЭЭЛТТЭЙ нь агуулга:** энэ сесс **зохион байгуулалт** нь шипдэг, **агуулга** нь ХОЁРХОН баг дээр — бүрэн бичигдсэн дүрэм нь `BA-HR-CORRIDOR-W-001` (§3.7-ийн канон темплейт) ба `IZ-HR-CEIL-H-001` — ХОЁР. `BB-HR-WIND-RES-001`, `BB-CO-CASTINPLACE-001`, `HD-HR-REPEATER-001` нь §3.6-ийн хаалганы хүснэгтэд **зөвхөн нэр** болж байгаа, бие нь БАЙХГҮЙ; **HAS, TSBU, TSAH, AU-д ЮУ Ч БАЙХГҮЙ**. Тиймээс Release N дээр BB / HAS / TSBU / TSAH / HD / AU-ийн инженерт багц нь **canary ганц дүрэм** — add-in нь ЮУ Ч ХИЙХГҮЙ мэт харагдана, харин `2-6`-ийн баг тус бүрийн сургалт ч мөн тэгээс эхэлнэ. Энэ нь эзний **R3 («баг бүр өөр дүрэмтэй»)**-ыг агуулгаар нь биелүүлээгүй гэсэн үг | Баг тус бүрийн ахлах (эзний дараалал аль хэдийн тогтсон). **Хураах эх сурвалж БЭЛЭН**: `БНбД 31-17-10` нь `bb/types.ts:36`, `has/types.ts:24`, `cbu/types.ts:30`, `tsah/types.ts:27`, `hd/types.ts:20`, `au/types.ts:32`-д тугтай (§2.5), нийт 57 `norms_*` туг. **Багц бүрт ХАМГИЙН БАГА 3 дүрэм × НАЙМАН салбар = 24 дүрэм** — Release N+1-ийн хаалга (өмнөх долоон багийн 21 БИШ). IZ-д `norms_*` ба БНбД эшлэл ХОЁУЛАА ТЭГ тул түүнийг ХУРААХГҮЙ, ЗОХИОНО — **хуваарийн гол эрсдэл** (§3.14.1) |

### 9.2 Хэмжигдээгүй — хэн ч шалгаагүй

| # | Асуулт | Яагаад чухал | Хэрхэн олох |
|---|---|---|---|
| 7 | **Бодит MGL төслүүдэд `AreaVolumeSettings`-ийн boundary location ЮУ БАЙНА ВЭ?** | Revit-ийн анхдагч нь Wall Centre. Тийм бол `BA-HR-CORRIDOR-W-001` нь ХЭЗЭЭ Ч хамаарахгүй (`applicability`-д `"Finish"` шаардсан) — өөрөөр хэлбэл BA-ийн жишээ дүрэм нь ХЭВЛЭГДЭХ БОЛОМЖГҮЙ, зөвхөн формат үзүүлбэр болно. `AreaVolumeSettings`, `SpatialElementBoundaryLocation`, `GetBoundarySegments` — гурвуулаа 46 `.cs` файлын аль нь ч БАЙХГҮЙ | Нэг жинхэнэ өндөр барилгын загварыг нээж, Revit → Area and Volume Computations-ыг унших |
| 8 | **Түвшний нэрлэлтийн конвенц юу вэ (газрын түвшний давхар)?** | `height_m` нь ЯЛГАВАР — дээд давхар хасах газрын түвшний давхар. `Level.ProjectElevation` нь shared coordinate дээр Улаанбаатарын ~1300 м-ийг агуулж болно; түүнийг үнэмлэхүй авбал 2 давхар ZA засварын төсөл дээр өндөр барилгын БҮХ багц асна. «±0.000» эсвэл «1 давхар» гэсэн конвенц байна уу, эсвэл `project_build_context` бүрийг ГАРААР бөглөх үү? | Хэдэн жинхэнэ загварын Level нэрсийг харах |
| 9 | **Инженер бүр өдөрт хэдэн үйл явдал үүсгэдэг вэ?** | 1B-1 §9 нь 40–200/өдөр гэдгийг ТААМАГ гэж бичсэн («ХЭН Ч ХЭМЖЭЭГҮЙ»). Дүгнэлт бүр `learning_events` мөр болно; дүрмийн тоогоор үржинэ. 10 GB D1-ийг бүх ERP хуваалцдаг | Нэг өдрийн хэмжилт — `%APPDATA%\RevitMcpAddin\timing.log` |

### 9.3 Техникийн — прод/алсын D1 дээр л шалгагдана

| # | Асуулт | Яагаад чухал | Хэрхэн олох |
|---|---|---|---|
| 10 | ~~**Амьд багийн бүртгэл юу вэ?**~~ **✅ БҮРТГЭЛ ХААГДСАН — ГИШҮҮНИЙ ТОО НЭЭЛТТЭЙ.** | **Бүртгэл нь ЭЗЭН БАТАЛСАН (2026-08-30): НАЙМАН салбарын баг** — BA · BB · HAS · TSBU · TSAH · HD · AU · IZ (v2 §46), тэр найм нь шипсэн `IMPLEMENTED_TEAMS`-тэй (`TeamReportsTab.tsx:52-61`) ЯГ таарна. `teams` хүснэгтэд нийт 11 мөр (`0007_teams.sql:39-47` нь 8 + MGMT, `0074_seed_ez_gt_teams.sql:12-14` нь EZ + GT) — гурав нь БАГЦГҮЙ. **ХЭВЭЭР ХЭМЖИГДЭЭГҮЙ нь баг тус бүрийн БОДИТ ГИШҮҮНИЙ ТОО:** продакшн D1 руу энэ машинаас хүрэх боломжгүй хэвээр (Cloudflare 7403). **Тоог ХЭЗЭЭ Ч хатуу бичихгүй** — `teams.code`-оос ажиллах үед уншина; 8 нь ТӨЛӨВЛӨЛТИЙН тоо (хэдэн багц зохиох вэ), литерал БИШ | Доорх (a) — зөвхөн гишүүний тоог хэмжинэ |
| 11 | **0212–0216 продакшн дээр ХЭРЭГЖСЭН үү?** | Хэрэв үгүй бол `learning_events.rule_id` (`0209:27`) байхгүй байж болох ба §2.10-ын «үнэгүй хожил» худал болно | Доорх (b) |
| 12 | **`norm_items`-д продакшн дээр яг 69 мөр байна уу?** | Админ `POST /items` (`normCatalog.ts:72`)-ээр нэмсэн мөрүүд нь `norm_c_<8hex>` санамсаргүй түлхүүртэй — кодоос гаргаж болохгүй. Тийм мөр хэд байгаа нь §3.14-ийн зураглалын аргыг шийднэ | Доорх (c) |

```bash
cd backend

# a) Амьд багийн бүртгэл
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT code, name_mn, sort_order FROM teams ORDER BY sort_order"

# b) Migration-ы хэрэгжсэн байдал
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 20"

# c) norm_items-ийн бодит бүрэлдэхүүн
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT COUNT(*) AS total, SUM(CASE WHEN key LIKE 'norm_c_%' THEN 1 ELSE 0 END) AS admin_added FROM norm_items"

# d) Төсөл бүрийн сонгосон норм — §3.14-ийн зураглалын бодит хэрэглээ
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT COUNT(*) FROM project_team_reports WHERE team_code='NORM' AND answers_json <> '{}'"
```

### 9.4 Энэ сессийн шийдвэрүүд — эзний баталгаа шаардах

| # | Шийдвэр | Эсрэг хувилбар |
|---|---|---|
| 12 | `verification_state = 'UNVERIFIED'` нь ЭШЛЭЛИЙГ ч дардаг («дотоод шалгуур»), зөвхөн ноцтой байдлыг биш | Зөвхөн ноцтой байдал буулгаад «БНбД 31-03»-ыг хэвлэх. Бид татгалзав: ноцтой байдал буурсан нь эшлэлийг мэргэжлийн батламж биш болгодоггүй, `norm_items`-д хувилбарын талбар байхгүй тул аль хэвлэлийг эшилснийг ХЭН Ч хэлж чадахгүй |
| 13 | `NOT_APPLICABLE` нь ОЛДВОР МӨР болж хэзээ ч үүсэхгүй (v2 §11:366-370-ын 5 vs §40-R2:1426-1429-ийн 4) | 5 дахь дүгнэлт болгох. Бид татгалзав: §61 нь «Only after applicability is established should the rule be executed» гэсэн — хамаарахгүй нь дүгнэлт биш. ГЭХДЭЭ `rule_run_ledger` (`2-3`)-д ЗААВАЛ тоологдоно |
| 14 | Салбар хоорондын зөрчилдөөнийг СЕРВЕР илрүүлнэ, клиент биш | Зөрчилдөж буй дүрмийг хоёр багцад тарих. Бид татгалзав: багц хоёр дахин том болох ба инженерийн засаж чадахгүй тугийг харуулах нь §76-ийн ядаргаа |
| 15 | Дүрэм нь ӨГӨГДӨЛ (`rulepack-v1`), compile хийсэн C# БИШ | Дүрмийг DLL-д шигтгэх. Бид татгалзав: буруу `1200` нь дахин нийтлэх, буруу `if` нь ~20 компьютер дахин суулгах |
| 16 | **`rule_test_cases` руу бичих зам нь МАРШРУТ (`POST` + `PATCH /api/compliance/tests`), UI нь `2-5`-ынх** (§5-ын гар өгөлт). Зохиох нь `requireManager()`, баталгаажуулах нь `requireAdmin()` — ХОЁР ӨӨР ХҮН | UI-г энэ сессид (frontend deploy нэмнэ) эсвэл `2-7`-д (түүний «зөвхөн SELECT» хамрах хүрээг эвдэнэ) хийх. Бид татгалзав. ⚠️ **Гэхдээ маршрутыг хойшлуулж БОЛОХГҮЙ БАЙСАН**: §3.11-ийн хаалга нь ≥5 тест шаарддаг тул бичих замгүйгээр `CRITICAL`/`HIGH` дүрэм ХЭЗЭЭ Ч нийтлэгдэхгүй, v2 §70/§63/§66 гурвуулаа хүчингүй болно |
| 17 | **`coordinate_system <> 'none'` нь нийтлэхийг 409-өөр ЗОГСООНО** (`coordinate_capability_missing`), хаалгыг `LINK_TRANSFORM_CAPABILITY_SHIPPED` ТОГТМОЛ өргөнө | Прозоор («релиз N-д тийм дүрэм нийтлэгдэхгүй») орхих. Бид татгалзав: §3.9-ийн `RuleEngine` нь Revit-ийн ямар ч төрөлгүй тул фрэйм зөрөхийг өөрөө барьж ЧАДАХГҮЙ — v2 §62-ын хориглосон «далд фрэйм таамаглал» чимээгүй ажиллана. Хаалгыг `model_capabilities` (`2-6`, `0239`) руу шууд холбохоос ч татгалзав: долгион 1-д тэр хүснэгт БАЙХГҮЙ |
| 18 | **`rule_conflicts.detected_by`-ын гурван утгаас ХОЁР нь (`human`, `authoring_check`) энэ сессид бичигчтэй болно; `verdict_stream` нь `2-3`-ынх, релиз N-д ТЭГ мөр** | Гурав дахь утгыг `0222`-оос ХАСАХ. Бид татгалзав: `rule_conflicts` дээр CHECK өргөтгөх нь хожим хүснэгт rebuild шаардана. **Оронд нь §6-д «`verdict_stream` тоо = 0» гэсэн шалгуур** тавьж, шипсэн мэт уншигдахаас сэргийлэв |
| 19 | **`ruleApplicability.ts` ↔ `RuleEngine.cs` нь ХОС ФАЙЛ** (§4), тэдгээрийг `check_rules.py --parity` барина | Хоёр хэрэгжилтийг тестгүй орхих. Бид татгалзав: репогийн бүх хос файл «type-ээр ч, тестээр ч хамгаалагдаагүй» бөгөөд `check_parity.py:16-18` нь 2026-08-24-нд яг ийм зөрүүг бодитоор барьсан. Ажиллах үед C# тал ШИЙДНЭ, харин `2-7`-ийн хүлээлт нь TS талаас тооцогдоно — зөрвөл хаалга НОГООН, шалгалт ХИЙГДЭЭГҮЙ |

---

### Хавсралт — энэ сессид олдсон зөрүү

| Зөрүү | Хаана | Аль нь эрх мэдэлтэй |
|---|---|---|
| ~~v2 §46 «7 teams» ↔ `0007_teams.sql` 9 мөр ↔ `0074` нэмээд 11~~ **✅ ШИЙДЭГДСЭН 2026-08-30** | спек vs migration | **ЭЗЭН БАТАЛСАН: НАЙМАН салбарын баг** (BA · BB · HAS · TSBU · TSAH · HD · AU · IZ) — v2 §46 нь дахин бичигдэж, гарчиг нь «8 DISCIPLINE TEAMS» болов. `teams`-ийн 11 мөрөөс `MGMT`, `EZ`, `GT` нь БАГЦГҮЙ (⚠️ багцгүй ≠ `TEAM = UNCERTAIN` — `2-1 §3.4`). Баталсан 8 нь `IMPLEMENTED_TEAMS` (`TeamReportsTab.tsx:52-61`)-тэй ЯГ ижил. **Дүрэм ХЭВЭЭР:** `teams.code`-оос ажиллах үед унших, тоог хатуу бичихгүй |
| **ШИНЭ (2026-08-30, ЭЗЭН БАТАЛСАН): BA нь эхний бүрэн багц** | эзний шийдвэр | BA нь бүтэцийн темплейт (§3.7), IZ хоёрдугаарт эзний тэргүүлэх ач холбогдлоор — гэхдээ `iz/`-д БНбД эшлэл ТЭГ тул ЗОХИОГДОНО, хураагдахгүй (§3.14.1) |
| v2 §11:366-370-ын 5 төлөв ↔ §40-R2:1426-1429-ийн 4 | спек дотор өөртэйгөө | **§40-R2 ҮНЭН** (MVP). `NOT_APPLICABLE` нь хамаарлын үр дүн |
| `0209:12` «<= 9 statement» ↔ энэ сессийн «<= 7» | хэмжигдсэн тааз vs ажлын хязгаар | **7 нь ажлын хязгаар** — 9 бол нөөцгүй |
| `revit-mcp/CLAUDE.md:50` «БНбД 31-23-22» accessibility ↔ `0120:76` «БНбД 35-01-22» | хоёр өөр код, ижил сэдэв | **ТААМАГ — аль нь хүчинтэйг тодруулаагүй.** §9-ийн 1-р асуултын хамрах хүрээнд |
| `teamReportFieldCatalog.ts` нь `suffix`/`hint`-ийг хаядаг | `grep -c` = 0 | Нэгж ба норм эшлэл сервертэй хүрэхгүй. `rules.unit` нь `NOT NULL` байх шалтгаан |
