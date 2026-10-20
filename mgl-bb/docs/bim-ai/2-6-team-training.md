# 2-6-team-training — багаар хамрагдсан сургалт, дүрмийн туршилтын өгөгдөл, гар оролтгүй цуглуулга, хамаарлын давхарга, чадварын бүртгэл

> **Track:** 2 · TEAM-SCOPED COMPLIANCE (сургалт ба өгөгдлийн хагас)
> **v2 хэсэг:** §50 (багийн сургалт) · §70 (бодит төслөөс дүрмийн туршилтын багц) · §71 (гар оролтгүй цуглуулга) · §78 (хамаарлын давхарга) · §79 (загварын чадварын бүртгэл). Хилийн нөхцөл: §29 (компанийн тусгаарлалт), §72 (баг = нэгдүгээр зэргийн өгөгдөл), §73-R3 (баталгаажаагүй багийн оноолт дээр ХЭЗЭЭ Ч сургахгүй), **§46 (НАЙМАН салбарын баг — ЭЗЭН БАТАЛСАН 2026-08-30, §2.12), §48 (багцгүй баг ⇒ нийцлийн шалгалт АЛГАСАГДАНА, ЮУТАЙ Ч тулгагдахгүй — тэр нь `TEAM = UNCERTAIN` БИШ, §2.12), §69 («Team checks: n/n» нь багцтай багийг л тоолно)**.
> **Хамаарал (depends on):** `2-1-team-context` (`team_code`, `team_attributions`, `team_source`) · `2-2-rule-model` (`rules.rule_uid`, `rule_test_cases`, `verification_state`) · `2-5-finding-surface` (`finding_overrides` — override нь ЗӨВХӨН хянагдсаны ДАРАА сургалтын өгөгдөл болно).
> **Блоклож буй (blocks):** `2-7-readiness-and-quality` (худал эерэг / худал сөрөгийн метрик нь `rule_test_cases`-ыг уншина) · ирээдүйн ямар ч багаар салгасан загварын ажил.
> **Хөндөх файлууд:** `backend/migrations/0238_assistant_team_scope.sql` (ШИНЭ), `backend/migrations/0239_model_capabilities.sql` (ШИНЭ), `backend/migrations/0240_team_rule_scope.sql` (ШИНЭ), `backend/src/lib/trainingRelevance.ts` (ШИНЭ), `backend/src/lib/trainingRelevance.test.ts` (ШИНЭ), `backend/src/lib/modelCapability.ts` (ШИНЭ), `backend/src/lib/modelCapability.test.ts` (ШИНЭ), `backend/src/lib/assistantLogInsert.ts`, `backend/src/lib/assistantExampleInsert.ts`, `backend/src/routes/revit.ts`, `backend/src/routes/compliance.ts`, `backend/scripts/gen-rule-golden.mjs` (ШИНЭ), `revit-mcp/training/pull_and_retrain.py`, `revit-mcp/training/datasets.manifest.json`, `revit-mcp/eval/golden/rules.json`, `revit-mcp/eval/manifest.json`, `frontend/src/features/revit-assistant/AssistantCurationPage.tsx` (+ `components/PendingTab.tsx`). **ӨӨР ФАЙЛ БАЙХГҮЙ.**
> **Deploy тоо:** 3 (1 × `d1 migrations apply` → 1 × `wrangler deploy` → 1 × `pages deploy`). Migration 3. Add-in (C#) дахин суулгах **ШААРДЛАГАГҮЙ** — энэ сесс C# ОГТ хөндөхгүй. Python сургагч нь эзний машин дээр гардаг, deploy БИШ.

---

## 0. ЭНЭ СЕССИЙН ДҮРЭМ

**Хамрах хүрээ (scope).** Энэ сесс нь СУРГАЛТЫН ӨГӨГДЛИЙН давхарга — багийн хамрах хүрээ, хамаарлын шүүлт, дүрмийн туршилтын багц, чадварын бүртгэл. Дүрмийн хөдөлгүүр (`2-3`), багийн илрүүлэлт (`2-1`), олдворын мөчлөг (`2-5`) нь ЭНД БАЙХГҮЙ. Гурван миграц, `backend/` доорх ЕС файл (шинэ `trainingRelevance{,.test}.ts` · `modelCapability{,.test}.ts` · `gen-rule-golden.mjs`, ба одоо байгаа хоёр insert lib · `revit.ts` · `compliance.ts`), хоёр frontend файл, дөрвөн Python/JSON файл — **өөр юу ч биш**.

**Бусад агентуудтай зэрэг ажиллаж байна.** Ажлын мод дээр өөр агентын дуусаагүй, эмхэтгэгдэхгүй өөрчлөлт байж БОЛНО. Дээрх жагсаалтад БАЙХГҮЙ файлыг ЗАСАХГҮЙ, буцаахгүй, цэвэрлэхгүй. `npm run build` бүтэн апп эмхэтгэдэг тул чиний хөндөөгүй файл дээр унаж БОЛНО — алдаа чинийх мөн эсэхийг шалгаад, биш бол эзэнд хэлээд цааш яв.

**Deploy хийж болох уу?** Болно, гурван алхмаар, ЯГ ЭНЭ дарааллаар: миграц → worker → pages. Урвуулж БОЛОХГҮЙ (§5).

| ⛔ | Дүрэм | Зөрчвөл юу болох вэ |
|---|---|---|
| 1 | `/api/*`-ыг `purpose === 'mcp'` токеныг ТАТГАЛЗДАГ болгож ХЭЗЭЭ Ч болохгүй | Add-in бүх REST дуудлагаа тэр 365 хоногийн токеноор гарын үсэг зурдаг, refresh урсгал БАЙХГҮЙ. ~20 PC, `Install.bat`, Revit хаалттай. Алсаас сэргээх БОЛОМЖГҮЙ ЦОРЫН ГАНЦ өөрчлөлт. Тогтоосон газрууд: `middleware/auth.ts:101-102`, `types.ts:209-212`, `lib/tokenValidity.ts:30-34` |
| 2 | `users` (19 каскад хүүхэд) эсвэл `projects` (33) -ыг `migrations apply`-аар ДАХИН БАРИХГҮЙ | `migrations apply` файл бүрийг гүйлгээнд ороодог, тэнд каскад ФИРНЭ — эцгийг устгах нь бүх хүүхэд мөрийг арчина. Энэ сессийн бүх ALTER нь ЦЭВЭР НЭМЭЛТ; `assistant_examples`/`assistant_logs` нь `users`-ын хүүхэд тул тэднийг ч rebuild хийхгүй |
| 3 | Миграц бол append-only. Бичихийн ӨМНӨ `ls backend/migrations \| tail -5` гүйцэтгэ | Хэрэгжсэн файлыг засах нь продакшн дээр ЧИМЭЭГҮЙ NO-OP. Ах дүү сессүүд дугаар зэрэг авч байна; репод аль хэдийн зургаан давхардсан дугаар бий |
| 4 | Триггерийн `END;` нь ТОМООР, өөрийн мөрөнд | wrangler-ийн statement хуваагчийн regex нь том/жижиг үсэг ялгадаг. Энэ сессийн гурван миграцад триггер БАЙХГҮЙ, гэхдээ дүрэм хэвээр |
| 5 | Инференс нь tool bus, `DocumentChanged`, итгэмжлэгдсэн замд ХЭЗЭЭ Ч БАЙХГҮЙ | ⛔ гэрээ `RevitToolBus.cs:442-454` ба `ChangeTracker.cs:769-775`. Энэ сесс C# ХӨНДӨХГҮЙ тул зөрчих гадаргуу байхгүй, дүрэм хэвээр |
| 6 | `DocumentChanged` дотор баримт ЗӨВХӨН УНШИГДАНА | Гүйлгээ, `Regenerate()`, файл бичилт БАЙХГҮЙ. Түүнийг сольсон сканнер 120+ секунд авдаг байсан |
| 7 | `ChangeTracker.Gate`-ыг bus дуудлага / диск / await дээгүүр БАРИХГҮЙ | Revit-ийн үндсэн урсгал транзакц бүр дээр тэр түгжээг авдаг. Энэ сесст хамааралгүй ч дүрэм хэвээр |
| 8 | `DockablePane.Show()`-ыг ХЭЗЭЭ Ч дуудахгүй | Ганц `Show()` нь хэрэглэгчийн ribbon товч (`AssistantPaneProvider.cs:54`). Энэ сесс C# хөндөхгүй |
| 9 | `Gate` барьж болох урсгалаас `Dispatcher.Invoke` хийхгүй | Хоёр урсгалын deadlock — хэрэглэгчид Revit өлгөгдсөн мэт харагдана |
| 10 | Бүх C# өөрчлөлт НЭГ хувилбарт | Энэ сесст C# БАЙХГҮЙ, тиймээс add-in хувилбарт нэмэр оруулахгүй. Хэрэв C# бичих сонирхол төрвөл — ЗОГС, тэр нь `1C`/`2-8`-ын ажил |
| 11 | Салбарын багц нь `teams.code`-оос АЖИЛЛАХ ҮЕД уншигдана | 7, 8, 9, 11 гэсэн тоог ХАТУУ БИЧИХГҮЙ. **ЭЗЭН БАТАЛСАН (2026-08-30): салбарын баг НАЙМ** — BA · BB · HAS · TSBU · TSAH · HD · AU · IZ (v2 §46). Гэвч `teams` хүснэгт нь АРВАН НЭГ мөртэй (0007 ес суулгадаг, 0074 хоёр нэмдэг), тиймээс найм гэдэг нь ТӨЛӨВЛӨЛТИЙН тоо (хэдэн дүрмийн багц бичих вэ), эмхэтгэх ТОГТМОЛ БИШ. §2.12-ыг үз |
| 12 | Өөр агентын хадгалаагүй ажлыг хөндөхгүй | `git restore` / `checkout --` / `stash` / `reset` / `git add -A` БАЙХГҮЙ. Файл бүрийг нэрээр нь нэм |

**ЭНЭ СЕССИД ХЭЗЭЭ Ч ХИЙЖ БОЛОХГҮЙ:**

- Багаар салгасан ЗАГВАРЫН ЖИН гаргах (`idx_assistant_model_active`-ыг хаях). Шалтгаан §2.5-д хэмжигдсэн; §50-R3 нь retrieval scope / rule scope-ыг ИЛ ЗӨВШӨӨРДӨГ.
- `DATASET_ELIGIBLE_SQL`-ыг тойрч өөрийн `WHERE` бичих (`bimEvents.ts:144`). Тэр бол сургалтад тэнцэх мөрийн ЦОРЫН ГАНЦ тодорхойлолт.
- `0215`-ын `source_type` / `review_state` хоёр тэнхлэгийг НЭГ багана болгож нийлүүлэх.
- `row_id` томьёог өөрчлөх (`train_intent.py:155-169`) — хөлдөөсөн 361 мөрийн багц ба 65 `exclude_row_ids` НЭГЭН ЗЭРЭГ утгаа алдана.
- `eval/golden/rules.json`-д `revit-mcp/CLAUDE.md:59-116`-ийн тоонуудыг golden болгож хөлдөөх — файл өөрөө үүнийг хориглодог.
- `model_capabilities`-д `authority_level >= 3` мөр үүсгэх, эсвэл маршрутын 400-г зөөлрүүлэх (§3.7-ийн валидац 2). v2 §40-R4 нь MVP-г LEVEL 2 (RECOMMEND)-оор ТАСАЛДАГ.
- `assertCapability`-г нийтлэх замаас ХАСАХ. Уншигчгүй бүртгэл нь хаалга БИШ, зөвхөн баримтжуулалт (§3.7-1).
- `0238`-д 8 дахь statement нэмэх. Файл 7/7 буюу тээврийн ТААЗАН дээр (§3.0).

---

## 1. КОНТЕКСТ

### Систем (хүйтэн сессид хангалттай хэмжээгээр)

| Хэсэг | Юу вэ |
|---|---|
| `backend/` | Cloudflare Worker — Hono нь `@cloudflare/workers-oauth-provider`-ын дотор. D1 + R2 + KV + нэг Durable Object + Workers AI |
| `frontend/` | Vite + React 19 SPA, Cloudflare Pages төсөл **`mgl-design-system`** (`--project-name`-ыг ЗААВАЛ ил дамжуулна) |
| `revit-mcp/addin/` | Revit 2024–2027 C#/WPF add-in, 46 `.cs`, C# тест ТЭГ, авто-шинэчлэл БАЙХГҮЙ, ~20 ажилтны PC дээр `Install.bat` |
| `revit-mcp/training/` | Python санаа таних сургагч — scikit-learn TF-IDF (char 2–6) + LogisticRegression, 9 анги |
| `revit-mcp/eval/` | Golden үнэлгээний хурсанд — 6 хуваарь, `manifest.json`, `run_golden.py`, `freeze.py`, `assert_no_leak.py` |
| Миграц | Диск дээрх хамгийн өндөр файл **0216_assistant_log_timing.sql** (2026-08-30-нд шалгав) |

### Платформын хатуу хязгаарууд (энэ даалгаварт хамаарах хэсэг)

- **D1 нэг statement-д 100 bind.** `rowsPerStatement(binds) = floor(100 / binds)`. Багана нэмэх нь statement тутмын мөрийг БУУРУУЛЖ БОЛНО — §2.7-г үз.
- **`migrations apply` нь файлыг `d1_migrations` INSERT-тэй НЭГ `--command`-д нийлүүлдэг.** Хуваагч нь `/* */` блок тайлбарыг ойлгодоггүй, мөр доторх ямар ч `;` дээр хуваадаг, нэг дуудлагад хэт олон statement байвал унадаг. **Файл бүр ≤ 7 ӨӨРИЙН statement**, зөвхөн `--` тайлбар, мөр дотор `;` БАЙХГҮЙ, бүх statement `IF NOT EXISTS` / `INSERT OR IGNORE`.
- **SQLite `ADD COLUMN`.** `CHECK` ЗӨВШӨӨРӨГДДӨГ (0215:29-34 хэмжсэн), `NOT NULL` нь ТОГТМОЛ өгөгдмөлтэй байх ёстой, `REFERENCES` агуулсан багана өгөгдмөл нь NULL байх ЁСТОЙ, огнооны багананд `DEFAULT (datetime('now'))` өгч БОЛОХГҮЙ.
- **`DROP INDEX` + `CREATE INDEX` нь ХҮСНЭГТИЙГ ДАХИН БАРИХГҮЙ.** Тиймээс §3.1-ийн өвөрмөц индексийн солилт нь `users`-ын каскадын хоригийн дор АЮУЛГҮЙ.
- **D1 ажиллах үед гадаад түлхүүрийг шалгадаггүй**, харин `migrations apply`-ийн гүйлгээнд каскад фирдэг.

### Яагаад энэ даалгавар байна вэ

1. Эзний хүсэлт: «I need to train the datas on a each teams … works on their data». Өнөөдөр багаар салгах ГАДАРГУУ БАЙХГҮЙ — `assistant_examples` ба `assistant_logs` хоёулаа багийн баганагүй. ⚠️ **«each team» гэдэг нь 2026-08-30-нд ТОДОРХОЙЛОГДСОН (ЭЗЭН БАТАЛСАН): найман салбарын баг** — BA · BB · HAS · TSBU · TSAH · HD · AU · IZ; MGMT · EZ · GT нь дүрмийн багц АВАХГҮЙ (§2.12). Эхний бүрэн багц нь **BA**.
2. Илүү муу нь: `0195:59-60`-ийн `UNIQUE(text, intent)` нь хоёр багийг НЭГ өгүүлбэрийг ӨӨРӨӨР шошголохыг **биет байдлаар хориглодог**. Багийн дүрэм өөр гэдэг нь багийн шошго ч өөр гэсэн үг.
3. Илүү бас муу нь: `0215`-ын итгэлийн таксономи нь ХЭРЭГЛЭГЧГҮЙ. `pull_and_retrain.py:168-182` нь `source_type` ба `review_state`-ыг ХАЯДАГ. Аль хэдийн үхсэн хэмжээс дээр багийн тэнхлэг нэмэх нь ХОЁР ДАХЬ үхсэн хэмжээс нийлүүлнэ.
4. Хэмжсэн: нийлүүлэгдсэн корпус бүхэлдээ 2402 өвөрмөц мөр, `source_counts` нь **seed 2357 · manual 45** — `usage` эх сурвалжтай мөр **ТЭГ**. `HUMAN_VERIFIED = RULE_VERIFIED = HUMAN_CORRECTED = 0`.
5. §79-ийн чадварын бүртгэл БАЙХГҮЙ: `assistant_models` нь наймаас зургааг нь агуулдаггүй, `eval_passed` нь ганц boolean тул §80-ийн зургаан эрхийн түвшин тус бүрд бие даасан хаалга барих боломжгүй. ⚠️ Бүртгэл нь **уншигчтай** байж л зорилгоо биелүүлнэ: `2-5:1235` нь нийтлэлийн түвшний хаалгыг, `2-2:1244` нь тогтмолыг сольж уншихыг ХОЁУЛАА `2-6`-д (энэ док) шилжүүлсэн. Тиймээс энэ сесс хүснэгт ҮҮСГЭХЭЭР ЗОГСОХГҮЙ — бичих зам (§3.7) ба уншигч хаалга (§3.7-1) хоёуланг нь ХАМТ нийлүүлнэ.
6. §70-ийн дүрмийн golden хуваарь нь ХООСОН ба ХАТУУ БЛОКЛОДОГ — `run_golden.py --kind rules` нь `sys.exit(2)`. Тэр хаалга АЛЬ ХЭДИЙН зэвсэглэсэн; түүнийг тэжээх зам л байхгүй.
7. Курацийн дараалалд багийн шүүлтгүй. BA-гийн senior нь IZ-ийн өгүүлбэрийг BA-гийн корпуст дэвшүүлж чадна, ба `revit.ts:2403` нь ЭХНИЙ шийдвэр ялдаг тул алдааг буцаах боломжгүй.

---

## 2. БАТАЛГААЖСАН ОДООГИЙН ЗАН ТӨЛӨВ

> Доорх `file:line` бүрийг энэ сесс өөрөө нээж баталгаажуулав (2026-08-30, commit `6a8e4f5`).

### 2.1 Корпус нь 100% синтетик — «usage» эх сурвалжтай мөр ТЭГ — БАТЛАГДСАН

Энэ бол бүх шаардлагыг дахин тавьдаг хэмжилт. Эзэн «багаар нь сургана» гэж хэлж байгаа боловч сургах БОДИТ өгөгдөл өнөөдөр ТЭГ.

| Баримт | file:line | Бодит утга |
|---|---|---|
| Сүүлд сургасан корпусын хэмжээ | `revit-mcp/training/data/report.json` (`examples`) | `2402` өвөрмөц (эвхэлтээр давхардал хассан) |
| Эх сурвалжийн задаргаа | `revit-mcp/training/data/report.json:74-77` | `"source_counts": { "manual": 45, "seed": 2357 }` |
| Түүхий мөрийн нийлбэр | `datasets.manifest.json` `_row_count_note` | 2532 түүхий → 2402 өвөрмөц. **Хоёр өөр тоо** — андуурч болохгүй |
| Хөндлөн шалгалт / хөлдөөсөн | `report.json` `accuracy` / `frozen_accuracy` | `0.9366` / `0.9501`, `frozen_n = 361`, `frozen_missing_ids = 0` |
| `production.json` | `ls revit-mcp/training/data/` | **ФАЙЛ БАЙХГҮЙ** — 12 файл байгаагийн нэг ч биш |

```
revit-mcp/training/data/ (2026-08-30):
  _en_seen.txt  bootstrap.json  english-audit.md  english.json
  eval-holdout.ids.json  hard-negatives.json  multilang-audit.md
  multilang.json  report.json  report.prev.json  seed-audit.md  seed.json
                                              ← production.json БАЙХГҮЙ
```

`production.json` бол `pull()`-ийн ЦОРЫН ГАНЦ гаралт (`pull_and_retrain.py:183`). Тэр байхгүй нь «сервер рүү татах алхам БОДИТООР ХЭЗЭЭ Ч гүйгээгүй» гэсэн үг. Тиймээс **нийлүүлэгдсэн загварын 100% нь синтетик** — LLM монгол инженерүүд юу бичих байх гэж төсөөлсөн нь. `AssistantCurationPage.tsx:29-33` энэ дүгнэлтийг өөрөө бичсэн байдаг.

**Үр дүн эзэнд хэлэх ёстой хэлбэрээр:** багаар салгасан сургалт (R4) нь БҮХ БАГ ДЭЭР НЭГЭН ЗЭРЭГ ТЭГЭЭС эхэлнэ. Кураци гүйхээс өмнө зарласан ямар ч «BA-гийн загварын нарийвчлал» гэдэг тоо нь **няцаагдах боломжгүй** — учир нь тэр багт харьяалагдах баталгаажсан мөр НЭГ Ч БАЙХГҮЙ.

⚠️ **Тэгээс эхлэх нь тэгш БИШ — эхлэл цэг нь ЭЗЭН БАТАЛСАН (2026-08-30): BA.** Найман салбарын багц НЭГЭН ЗЭРЭГ БИШ, ДАРААЛЛААР бичигдэнэ ба **BA (Барилга архитектур) нь эхнийх** (§2.12, v2 §46). Тиймээс баталгаажсан мөр, дүрмийн туршилтын кейс (v2 §70, §3.8) ба курацийн бодит хэмнэл нь БҮГД эхлээд BA дээр хуримтлагдана — BA бол хэмжигдэх ЭХНИЙ баг, ба түүний тоо л дараагийн долоогийн төлөвлөлтийн суурь болно.

### 2.2 `0215`-ын backfill нь гурван итгэмжит төлөвийг ХЭЗЭЭ Ч оноохгүй — БАТЛАГДСАН

```
0215_assistant_trust_taxonomy.sql:97   -- ⚠️ Энэ backfill нь HUMAN_VERIFIED / RULE_VERIFIED / HUMAN_CORRECTED-ыг
0215_assistant_trust_taxonomy.sql:98   --    ХЭЗЭЭ Ч оноохгүй -- анхны бодлогын цөм ЗОРИУД ХООСОН эхэлнэ.
0215_assistant_trust_taxonomy.sql:99   UPDATE assistant_examples
0215_assistant_trust_taxonomy.sql:100    SET source_type = CASE source
0215_assistant_trust_taxonomy.sql:101      WHEN 'usage'  THEN 'UNKNOWN'
0215_assistant_trust_taxonomy.sql:102      WHEN 'manual' THEN 'HUMAN'
0215_assistant_trust_taxonomy.sql:103      ELSE 'AI_GENERATED'
0215_assistant_trust_taxonomy.sql:104    END;
```

Найман `source_type` утга нь `0215:50-54`-д CHECK-тэй; дөрвөн `review_state` нь `0215:59-61`-д. Тэдгээр нь **ХОЁР ТУСДАА ТЭНХЛЭГ**, `0215:3-8` тэрийг ил бичсэн: «Нэг мөр AI_GENERATED БАС хүнээр баталгаажсан байж БОЛНО — энэ нь зөрчил биш». Тэднийг нэг багана болгож нийлүүлэх нь миграцийн БҮХ утгыг устгана.

Тэнцэх дүрэм нь `0215:9-11`-д ил бичигдсэн:

```
0215_assistant_trust_taxonomy.sql:9    --      eligible(row) = policy_allows(row.source_type)
0215_assistant_trust_taxonomy.sql:10   --                      AND row.review_state IN ('reviewed','verified')
0215_assistant_trust_taxonomy.sql:11   --    Бодлогын gate нь энд БИШ, 1B-4-ийн сургалтын манифест дээр хэрэгжинэ.
```

### 2.3 НИЙЛҮҮЛЭГДСЭН ТАСАРХАЙ — сургагч `source_type`-ыг ХАЯДАГ — БАТЛАГДСАН

Сервер тал өгдөг. `GET /assistant/export` (`revit.ts:2592`, `requireAdmin()`) нь мөр тус бүр дээр `source_type`, `review_state`, `reviewed_by`, `reviewed_at`, `origin_log_id`, `source_log_id`-ыг БУЦААДАГ (`revit.ts:2613-2617`), ба `per_source_type` нэгтгэлийг ч буцаадаг.

Сургагч авдаггүй:

```
pull_and_retrain.py:168    clean = [
pull_and_retrain.py:169        {"text": r["text"], "intent": r["intent"],
pull_and_retrain.py:170         "style": r.get("style") or "",
pull_and_retrain.py:178         "source": r.get("source") or "usage",
pull_and_retrain.py:179         **({"slot": r["slot"]} if r.get("slot") else {})}
pull_and_retrain.py:180        for r in rows
```

`text` / `intent` / `style` / `source` / `slot` — ТАВ. `source_type` ба `review_state` энд УНАНА.

Хэмжсэн:

```bash
grep -rn "source_type" revit-mcp/training/ revit-mcp/eval/ | wc -l
grep -rn "review_state" revit-mcp/training/ revit-mcp/eval/ | wc -l
```

Хэмжсэн гаралт (2026-08-30):

```
0
0
```

**Дүгнэлт.** `0215`-ын таксономи бүхэлдээ ХЭРЭГЛЭГЧГҮЙ. `0215:9-11`-ийн тэнцэх дүрэм нь ХЭРЭГЖЭЭГҮЙ. Тиймээс **дараалал ЗААВАЛ**: эхлээд `source_type`-ыг дамжуулж, ДАРАА нь `team_code`-ыг ЯГ ТЭР ТӨМӨР ЗАМААР. Урвуулбал хоёр дахь үхсэн хэмжээс нийлүүлнэ.

### 2.4 §50-ийн БЛОКЕР — `UNIQUE(text, intent)` нь хоёр багийг өөрөөр шошголохыг хориглоно — БАТЛАГДСАН

```
0195_assistant_learning.sql:58   -- Ижил мөр хоёр удаа орохгүй (санаа тус бүрд).
0195_assistant_learning.sql:59   CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_ex_uniq
0195_assistant_learning.sql:60     ON assistant_examples(text, intent);
```

BA-гийн инженер «явцаа өгье» гэдгийг `submit_progress` гэж шошголлоо гэж бодъё. IZ-ийн инженер ижил өгүүлбэрийг өөр санаагаар шошголох гэвэл — өөр `intent` тул индекс зөвшөөрнө. Гэвч **ижил (text, intent) хосыг өөр багийн нотолгоо болгон хоёр удаа хадгалах** боломж БАЙХГҮЙ: BA-гийн баталгаажсан мөр ба IZ-ийн баталгаажаагүй мөр нэг мөр рүү нурна. §50-R5-ын «team-specific data must remain traceable to company / team / project / source / verification state / model version / dataset version» долоон шинжийн ХОЁР ДАХЬ нь биетээр боломжгүй.

Засвар нь ГУРВАЛСАН өвөрмөц индекс (§3.1). `DROP INDEX` + `CREATE INDEX` нь хүснэгтийг ДАХИН БАРИХГҮЙ тул хориг 2-т нийцнэ.

### 2.5 Багаар салгасан ЗАГВАРЫН ЖИН нь БУРУУ механизм — гурван хэмжилт

**(а) Ганц идэвхтэй загвар нь биет хориг.**

```
0195_assistant_learning.sql:145  -- ⚠️ Хоёр загвар зэрэг идэвхтэй байвал add-in аль нь ирэхийг мэдэхгүй.
0195_assistant_learning.sql:146  -- Хэсэгчилсэн ӨВӨРМӨЦ индекс нь үүнийг БҮРЭН хаана.
0195_assistant_learning.sql:147  CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_model_active
0195_assistant_learning.sql:148    ON assistant_models(is_active) WHERE is_active = 1;
```

Найман идэвхтэй загвар гаргах нь (ЭЗЭН БАТАЛСАН найман салбарын баг, §2.12): энэ индексийг хаях + `team_code` нэмэх + `UNIQUE(team_code, is_active) WHERE is_active = 1` үүсгэх + `GET /assistant/model`-д багийн параметр нэмэх + **add-in-ыг дахин бариад ~20 PC дээр гараар суулгах**. Сүүлчийнх нь буцаах боломжгүй үйлдэл.

**(б) Корпусыг хуваавал сургалт ЗҮГЭЭР Л ТАТГАЛЗАНА.**

```
train_intent.py:307        flag = "  ⚠️ ЦӨӨН" if n < 25 else ""
train_intent.py:309        missing = [i for i in INTENTS if dist.get(i, 0) == 0]
train_intent.py:310        if missing:
train_intent.py:311            raise SystemExit(f"Жишээгүй санаа: {missing}")
```

2402 мөрийг ЭЗЭН БАТАЛСАН найман салбарт (2026-08-30, §2.12) хуваавал багт дунджаар ~300 мөр, 9 санаанд ~33. Сул ангиуд (`unknown` 0.852, `submit_progress` 0.906 — `report.json` `per_intent`) шууд тэг рүү унана. Багийн нэг ч санаанд жишээ байхгүй бол `SystemExit`.

**(в) Ачаалалт нь бодит зардал.** Нийлүүлэгдсэн `revit-mcp/addin/Resources/intent-model.json` нь **941 248 байт**. Найман багийн жин = **~7.5 MB** (8 × 941 248 = 7 529 984 байт), roaming профайл дээр Revit эхлэх бүрд. Ямар ч нарийвчлалын ашиггүй: 9 ангийн санаа таних роутер нь «энэ өгүүлбэр юу гуйж байна вэ» гэдэгт хариулдаг — тэр асуулт нь ЖИНХЭНЭ БАГИЙН МЭДРЭМЖГҮЙ.

**Шийдвэр (§50-R3-ын дөрвөн зөвшөөрөгдсөн механизмаас).** Багийн зан төлөв = **retrieval scope + rule scope**, загварын хувилбар БИШ. `idx_assistant_model_active` ХЭВЭЭР ҮЛДЭНЭ. §50-R4 («бүх багийн зан төлөвийг нэг ялгаагүй загварт шахаж болохгүй») нь ХАНГАГДАНА, учир нь дүрмийн багц (`2-2`), дүрмийн хамрах хүрээ (`team_rule_scope`, §3.3) ба сургалтын корпусын хуваалт (`team_code`, §3.1) нь бүгд багаар салгагдана — зөвхөн 9 ангийн роутер л хуваалтгүй.

### 2.6 §79-ийн чадварын бүртгэл — наймаас зургаа нь БАЙХГҮЙ — БАТЛАГДСАН

`assistant_models` (`0195:122-143`) багана: `id, version, weights_json, intents_json, example_count, accuracy, per_intent_json, is_active, note, trained_by, created_at`. `0213` гурав нэмсэн:

```
0213_assistant_model_eval.sql:35   ALTER TABLE assistant_models ADD COLUMN eval_json TEXT;
0213_assistant_model_eval.sql:40   ALTER TABLE assistant_models ADD COLUMN eval_dataset_version TEXT;
0213_assistant_model_eval.sql:44   ALTER TABLE assistant_models ADD COLUMN eval_passed INTEGER NOT NULL DEFAULT 0;
0213_assistant_model_eval.sql:47   CREATE INDEX IF NOT EXISTS idx_assistant_models_evalpass
```

v2 §79-ийн найман талбартай тулгавал:

| §79 талбар | `assistant_models` дээр |
|---|---|
| `task` | **БАЙХГҮЙ** |
| `model_version` | `version` ✅ |
| `team_scope` | **БАЙХГҮЙ** |
| `input_types` | **БАЙХГҮЙ** |
| `output_types` | **БАЙХГҮЙ** |
| `confidence` | `accuracy` — ойролцоо, гэхдээ даалгаварын БУС загварын түвшинд |
| `evaluation_status` | `eval_passed` — ганц boolean |
| `allowed_actions` | **БАЙХГҮЙ** |

`eval_passed` нь ганц boolean тул §80-R3-ын «эрхийн түвшин бүр БИЕ ДААСАН үнэлгээний хаалгатай» шаардлагыг барихгүй: LEVEL 0-д тэнцсэн загвар LEVEL 2-т ч тэнцсэн харагдана. Тиймээс §79 нь `assistant_models`-ыг ӨРГӨТГӨХ БИШ, **ШИНЭ ХҮСНЭГТ** — картинал өөр (нэг загвар, ОЛОН чадвар × багийн хамрах хүрээ).

### 2.7 Bind арифметик нь СПЕЦЭЭС УРГАНА — гараар тоолох зүйл байхгүй — БАТЛАГДСАН

```
assistantLogInsert.ts:25    export const D1_MAX_BINDS = 100;
assistantLogInsert.ts:31    export const ASSISTANT_LOG_COLUMNS = [ … ] as const;   // 17 багана
assistantLogInsert.ts:62    export const ASSISTANT_LOG_BINDS = ASSISTANT_LOG_COLUMNS.length;
assistantLogInsert.ts:69    export const ASSISTANT_LOG_ROWS_PER_STATEMENT = Math.floor(
assistantLogInsert.ts:70      D1_MAX_BINDS / ASSISTANT_LOG_BINDS,
```

```
assistantExampleInsert.ts:35   export const ASSISTANT_EXAMPLE_COLUMN_SPEC = [ … ];  // 14 багана
assistantExampleInsert.ts:48   ['reviewed_at', "CASE WHEN ? = 'pending' THEN NULL ELSE datetime('now') END"],
assistantExampleInsert.ts:72   export const ASSISTANT_EXAMPLE_BINDS =
assistantExampleInsert.ts:73     ASSISTANT_EXAMPLE_TUPLE.split('?').length - 1;      // 13 bind
assistantExampleInsert.ts:80   export const ASSISTANT_EXAMPLE_ROWS_PER_STATEMENT = Math.floor(
```

⚠️ `assistant_examples`-д багана 14 ч bind 13 — `reviewed_at`-ийн CASE нь баганыг bind-гүйгээр бөглөдөг. Энэ ялгааг андуурч болохгүй.

**Энэ сессийн нэмэлтийн ЗАРДАЛ (хэмжсэн арифметик):**

| Хүснэгт | Одоо | `team_code` нэмсний дараа | Statement тутмын мөр |
|---|---|---|---|
| `assistant_logs` | 17 bind → `floor(100/17) = 5` | 18 bind → `floor(100/18) = 5` | **ӨӨРЧЛӨГДӨХГҮЙ** |
| `assistant_examples` | 13 bind → `floor(100/13) = 7` | 14 bind → `floor(100/14) = 7` | **ӨӨРЧЛӨГДӨХГҮЙ** |

Тиймээс энэ сессийн ALTER нь ingest-ийн бүтээмжид ТЭГ зардалтай. `assistant_logs`-д ХОЁР ДАХЬ бодит багана нэмбэл 19 → `floor(100/19) = 5` хэвээр, ГУРАВ ДАХЬ нь 20 → 5 хэвээр, дөрөв дэх нь 21 → 4 болж унана — тэр босгыг §4-д бичсэн.

### 2.8 §70-ийн golden хуваарь нь ХООСОН ба ХАТУУ БЛОКЛОДОГ — БАТЛАГДСАН

```
eval/golden/rules.json   {"_note": "GOLDEN-EVAL · дүрмийн хөдөлгүүр (БНбД хэмжээс).  ХООСОН
                          ШИЛЖИНЭ — revit-mcp/CLAUDE.md:59-116-ийн тоонууд нь өөрсдөө
                          «design-guidance, албан ёсны БНбД-тэй тулгаагүй» тул golden
                          болгож ХӨЛДӨӨЖ БОЛОХГҮЙ", "partition": "rules",
                          "frozen": true, "preprocess_contract": "fold-v1", "rows": []}
```

```
run_golden.py:241    ap.add_argument("--kind", required=True, choices=["intent", "bim", "rules"])
run_golden.py:295    required = man["required_partitions"][args.kind]
run_golden.py:314        if name in required and res["rows"] == 0:
run_golden.py:315            blocked.append(name)          # ❌ АЛГАСАХГҮЙ
run_golden.py:346    if blocked:
run_golden.py:356        sys.exit(2)
```

`eval/manifest.json` → `required_partitions.rules = ["rules", "regressions"]`, `golden.rules.rows = 0`, `golden.bim.rows = 0`, `golden.difficult_cases.rows = 0`, `golden.intents.rows = 61`, `golden.regressions.rows = 4`, `golden.adversarial.rows = 18`, `dataset_version = "2026-08-28.1"`, `exclude_row_ids` = **65** id.

Хуваарийн нэр ГУРВАН газар хатуу бичигдсэн:

```
assert_no_leak.py:85   PARTITIONS = ["intents", "bim", "rules", "difficult_cases", "regressions", "adversarial"]
freeze.py:458          choices=["intents", "bim", "rules", "difficult_cases", "adversarial"]
eval/manifest.json     required_partitions.{intent,bim,rules}
```

**Дүгнэлт.** §70-ийн үүр АЛЬ ХЭДИЙН байгаа, хаалга АЛЬ ХЭДИЙН зэвсэглэсэн. Хоёр дахь хурсанд бариулах ХЭРЭГГҮЙ — зөвхөн МӨР бичих зам хэрэгтэй (§3.8).

### 2.9 Курацийн дараалалд БАГИЙН ШҮҮЛТ БАЙХГҮЙ, ба ЭХНИЙ шийдвэр ялдаг — БАТЛАГДСАН

```
revit.ts:2125   revit.get('/assistant/pending', async (c) => {
revit.ts:2127     if (!isManager(user.role)) return c.json({ error: 'Хандах эрхгүй' }, 403);
revit.ts:2136     const where = status ? 'l.review_status = ?' : 'l.curated = 0 AND l.review_status IS NULL';
```

`where` дотор багийн нөхцөл БАЙХГҮЙ. `isManager` = admin эсвэл senior, багийн гишүүнчлэлийн шалгалт ХААНА Ч БАЙХГҮЙ. Тиймээс **BA-гийн senior нь IZ-ийн инженерийн мөрийг харна, шошгоно, дэвшүүлнэ.**

Алдаа нь буцаагдахгүй:

```
revit.ts:2395   // ⚠️ `AND review_status IS NULL` — давхар хяналт ЭХНИЙ шийдвэрийг
revit.ts:2396   //    ДАРЖ БИЧИХГҮЙ (татгалзсаныг дэвшүүлсэн болгож чадахгүй).
revit.ts:2399               review_status = 'promoted',
revit.ts:2403           AND review_status IS NULL`,
```

Эрэмбэлэлт нь бүтээгдэхүүний шийдвэр (`revit.ts:2158-2170`: тэмдэглэлтэй → залруулсан → 👎 → fallback → бусад) ба клиент талд ДАХИН эрэмбэлэхгүй (`PendingTab.tsx:35-38`). Тиймээс багийн шүүлт нь `ORDER BY`-г ХӨНДӨХГҮЙ, зөвхөн `WHERE`-д нэмэгдэнэ.

Сервер тал таксономийг ӨӨРӨӨ ургуулдаг (гэрээ G1) — клиент зарлаж болох ч сервер `assistant_logs.predicted`-ыг ӨӨРӨӨ уншаад `deriveSourceType`-аар шийднэ:

```
revit.ts:2306        `SELECT id, predicted FROM assistant_logs WHERE id IN (…)`
revit.ts:2328        source_type: deriveSourceType({
assistantExampleInsert.ts:157  export function deriveSourceType(input: { … })
assistantExampleInsert.ts:133  export const CLIENT_DECLARABLE_SOURCE_TYPES = [ … ]
```

Энэ загварыг `team_code` дээр ЯГ ДАВТАНА (§3.6): клиент зарлана, СЕРВЕР шийднэ.

### 2.10 §78-д ЭМХЭТГЭЛЭЭР БАРИХ прецедент АЛЬ ХЭДИЙН байна — БАТЛАГДСАН

```
bimEvents.ts:144   export const DATASET_ELIGIBLE_SQL = 'parts_missing = 0';
bimEvents.ts:159   export const LEARNING_EVENT_KINDS = [ … ] as const;      // 16 утга
bimEvents.ts:180   export type LearningEventKind = (typeof LEARNING_EVENT_KINDS)[number];
bimEvents.ts:224   export const REQUIRED_PARTS_OF: Record<LearningEventKind, readonly SatellitePart[]> = {
bimEvents.ts:231     RULE_VALIDATION: ['RULE_VERDICT'],
bimEvents.ts:244   export const PROVENANCE_VALUES = [ … ] as const;          // 6 утга
bimEvents.ts:302   export const CONTRACT_VERSION = 1;
```

`REQUIRED_PARTS_OF` нь `Record<LearningEventKind, …>` БҮРЭН бичлэг — шинэ `kind` нэмэхэд `tsc` УНАНА. `bimEvents.ts:153-158` энэ сонголтыг ил тайлбарладаг: сая мөртэй append-only хүснэгтэд CHECK өөрчлөх нь хүснэгтийг ДАХИН БАРИХЫГ шаардана, тэр нь энэ загварын хийж ЧАДАХГҮЙ цорын ганц зүйл.

`trainingRelevance.ts` (§3.4) нь ЯГ ЭНЭ ХЭЛБЭРИЙГ давтана.

⚠️ Мөн `check-bim-events.mjs:35` нь `IMMUTABLE = TABLES.filter((t) => t !== 'bim_sessions')` гэж бичдэг — дөрвөн BIM хүснэгт дээр UPDATE ABORT өгнө. Тиймээс `learning_events`-д **БОДИТ** багана нэмээд ХОЙШ БӨГЛӨХ боломжгүй. Энэ сессийн бодит багана бүр нь `assistant_*` дээр буюу ШИНЭ хүснэгт дээр; `learning_events` дээрх ганц нэмэлт (`verification_state`, §3.1-ийн 7 дахь statement) нь **GENERATED ALWAYS … VIRTUAL** — тэр нь `payload_json`-ы проекц тул хойш бөглөх шаардлагагүй, bind нэмэхгүй, ба `2-1`-ийн 0219-ийн ЯГ ИЖИЛ хэв маяг.

### 2.11 Компанийн дадал ба норм НЭГ УТАСГҮЙ мөрөнд хадгалагдаж байна — БАТЛАГДСАН

```
frontend/src/features/projects/team-reports/bb/template.ts:173
      hint: 'МАКС ӨРГӨӨ хурлын зөвлөмжийн дагуу 21 давхрын өндөр барилгад бүрэн цутгамал хийц зөвлөмж болгодог.',
```

Энэ нь **нэрлэсэн хурлаас ургасан компанийн дадал**, БНбД БИШ. Гэвч тэр нь БНбД иш татсан бусад `hint`-үүдтэй ЯГ ИЖИЛ утасгүй мөр — ялгах машин уншигдах талбар БАЙХГҮЙ. AI хурлын тэмдэглэлийг ӨНДӨР БАРИЛГЫН ХУУЛЬ гэж иш татах нь UX-ийн алдаа биш, **хариуцлагын асуудал**.

Тиймээс `team_rule_scope.source_kind ∈ ('norm','company_practice','team_standard')` нь ачаа даадаг багана (§3.3), ба `2-2`-ын `verification_state` клампаас ТУСДАА тэнхлэг: `verification_state` нь «эх сурвалж баталгаажсан уу», `source_kind` нь «энэ ямар төрлийн эрх мэдэл вэ».

### 2.12 Багийн бүртгэл — ЭЗЭН БАТАЛСАН НАЙМ (2026-08-30); гишүүдийн тоо БАТАЛГААЖААГҮЙ

```
0007_teams.sql:38-47  INSERT OR IGNORE INTO teams (code, name_mn, name_en, sort_order) VALUES
                        ('BA'…10) ('BB'…20) ('HAS'…30) ('TSBU'…40) ('TSAH'…50)
                        ('HD'…60) ('AU'…70) ('IZ'…80) ('MGMT'…90);
0074_seed_ez_gt_teams.sql:12-14  → EZ, GT нэмнэ (нийт 11)
```

**ЭЗЭН БАТАЛСАН (2026-08-30).** Салбарын баг НАЙМ: **BA** Барилга архитектур · **BB** Барилга бүтээц · **HAS** Халаалт агаар сэлгэлт · **TSBU** Цэвэр бохир ус · **TSAH** Цахилгаан · **HD** Холбоо дохиолол · **AU** Автомат удирдлага · **IZ** Интерьер зураг — `teams.sort_order`-ын дарааллаар. Эзний үг: «MGMT-ийг хасаад үлдсэн 8-н багийг оруулна». Энэ нь v2 §46-д тэмдэглэгдсэн (тэр хэсэг 2026-08-30-нд «8 DISCIPLINE TEAMS» болж дахин бичигдсэн) ба нийлүүлэгдсэн UI-ийн `IMPLEMENTED_TEAMS` (`frontend/src/features/projects/team-reports/TeamReportsTab.tsx:52-61`) -тэй ЯГ ТААРНА.

**Өмнөх зөрчил ШИЙДЭГДСЭН.** Энэ докийн өмнөх хувилбар «репо өөртэйгөө зөрчилдөж байна (7 · 8 · 11), хэнтэй ч таарахгүй» гэж бичсэн. Эзэн наймыг сонгосон — тэр нь шипсэн UI аль хэдийн хэрэгжүүлсэн багц. Үлдсэн гурав нь:

| Код | Хаанаас | Дүрмийн багц | Юу болох вэ |
|---|---|---|---|
| `MGMT` (Менежмент) | `0007_teams.sql:38-47`-ын ес дэх мөр | **БАЙХГҮЙ** | Дизайны салбар БИШ — нийцлийн шалгалт хийгдэхгүй |
| `EZ` (Эскиз зураг) | `0074_seed_ez_gt_teams.sql:12-14` | **БАЙХГҮЙ** | Төсөл тохируулахад блокийн угтвар болж сонгогддог, дүрэмгүй |
| `GT` (Гадна тохижилт) | `0074_seed_ez_gt_teams.sql:12-14` | **БАЙХГҮЙ** | Мөн адил |

**Нэг үнэнч нарийвчлал (тэмдэглэл, БЛОКЕР БИШ).** Эзэнд `0007_teams.sql`-ийн ЕС мөрийг үзүүлж, тэр «MGMT-ийг хасаад үлдсэн 8» гэж хариулсан. **`EZ` ба `GT` (сүүлд `0074`-өөр нэмэгдсэн) түүнд НЭР ЗААЖ тавигдаагүй.** Тэд наймын жагсаалтад БҮТЦЭЭРЭЭ багтаагүй, ба инженерийн салбар БИШ — төсөл тохируулахад блокийн угтвар болж сонгогддог баг — тул дүгнэлт ХҮЧИН ТӨГӨЛДӨР. Гэхдээ ил нэрлэгдээгүйг ЭНД тэмдэглэв; §9.3-ын асуулт 9 нь ХААГДСАН ХЭВЭЭР ба ДАХИН НЭЭХГҮЙ.

**⚠️ БАГЦГҮЙ БАГ нь `TEAM = UNCERTAIN` БИШ — ХОЁР ӨӨР ТӨЛӨВ (ЗАСВАРЛАВ 2026-08-30).** Энэ докийн өмнөх хувилбар «багцгүй баг `UNCERTAIN`-д унана» гэж бичсэн нь БУРУУ байв. Каноник эх нь `2-1-team-context.md` §3.4 («**ДҮРМИЙН БАГЦГҮЙ БАГ — UNCERTAIN-ААС ӨӨР ТӨЛӨВ**»), тэр нь эхнээсээ ЗӨВ байсан:

| | **UNCERTAIN** (илрүүлэлт УНАСАН) | **ДҮРМИЙН БАГЦГҮЙ БАГ** (илрүүлэлт АМЖИЛТТАЙ) |
|---|---|---|
| `bim_sessions.team_code` | `NULL` | **ЖИНХЭНЭ КОД** — MGMT / EZ / GT |
| `team_source` | `uncertain` | шатны ЖИНХЭНЭ эх сурвалж |
| `team_confidence` | `0.0` | ЖИНХЭНЭ утга |
| `learning_events`-ийн шошго | `null` | **ТЭР КОДООР ТАМГАЛАГДСАН** |
| Чип | «Баг: тодорхойгүй» | «Баг: EZ (дүрмийн багцгүй)» |
| Хэрэглэгчээс асуух уу | ТИЙМ — засаж өгөхийг гуйна | **ҮГҮЙ** — баг аль хэдийн ЗӨВ |
| Юу өөр вэ | бүх шат | **ЗӨВХӨН** нийцлийн үнэлгээ алгасагдана (`complianceEnabled → false`) |

**ХОЁУЛАНГИЙН хувьд: багцгүй баг ӨӨР БАГИЙН дүрэм рүү ХЭЗЭЭ Ч унахгүй.** Багц байхгүй нь ШАЛГАЛТ БАЙХГҮЙ гэсэн үг, ОРЛУУЛСАН шалгалт БИШ — сүүлийнх нь v2 §48-ын «буруу багийн дүрмийг чимээгүй хэрэглэхгүй» дүрмийн зөрчил. Биет илрэл нь `team_rule_scope`-д мөргүй байх (§3.3) ба `model_capabilities`-д `team_scope` мөргүй байх (§3.2): хоёулаа хаалттай-өгөгдмөл.

**Яагаад шошго АМЬД ҮЛДЭХ ЁСТОЙ вэ.** v2 §72 нь цуглагдсан МӨР БҮРИЙГ багаар тамгалахыг шаарддаг. Багцгүй сессийг NULL болгож нулласан бол тэр ажил БАГГҮЙ корпуст унаж, MGMT / EZ / GT-д хэн нэгэн багц зохиох өдөр ЭХЛЭХ ӨГӨГДӨЛ нь АЛГА БОЛСОН байх байсан (§3.4).

**v2 §69-ийн «Team checks: n/n» нь НАЙМ гэсэн литерал БИШ.** Хуваарь нь «тэр төсөл дээр БОДИТООР байгаа багуудын, багцтай нь» — багцгүй баг нь тоологчийн ХҮРТЭЛ Ч, ХУВААРЬ ХҮРТЭЛ Ч орохгүй. MGMT-тэй төсөл дээр 8/8 гэж хэвлэх нь худал ногоон.

**ХЭВЭЭР БАТАЛГААЖААГҮЙ: БАГ ТУС БҮРИЙН ГИШҮҮДИЙН ТОО.** Продакшны D1 руу энэ машинаас ХҮРЭХГҮЙ БАЙВ (Cloudflare API алдаа **7403 not authorized**), тиймээс амьд гишүүнчлэлийн тархалт хэмжигдээгүй — §9-1-ийн асуулт 2 НЭЭЛТТЭЙ ХЭВЭЭР. Бүртгэл өөрөө л шийдэгдсэн. Гишүүнчлэл нь `user_teams(user_id, team_id, is_primary)` (`0052_user_teams_junction.sql:11-16`) — НЭГЭЭС ОЛОН баг байж болно.

**⚠️ ЭНЭ НЬ ХАТУУ БИЧИХ ЗӨВШӨӨРӨЛ ОГТ БИШ. Энэ сессийн бүх код `teams.code`-оос АЖИЛЛАХ ҮЕД уншина. 7, 8, 9, 11 гэсэн тоо ЭНЭ СЕССИЙН КОДОД ХЭЗЭЭ Ч БИЧИГДЭХГҮЙ.** Найм нь ТӨЛӨВЛӨЛТИЙН баримт (хэдэн дүрмийн багц бичих вэ, §9-3-ын асуулт 9), эмхэтгэх тогтмол БИШ. Баг нэмэгдэх/хасагдах өдөр код өөрчлөгдөх ЁСГҮЙ.

**Эхний багц: BA (Барилга архитектур) — ЭЗЭН БАТАЛСАН 2026-08-30.** BA нь бүрэн эхээрээ эхэлж бичигдэх ба үлдсэн долоогийн БҮТЦИЙН ЗАГВАР болно. Шалтгаан нь хэмжигдсэн: `frontend/src/features/projects/team-reports/ba/` нь **12** БНбД иш татлагатай (`types.ts` 7 · `template.ts` 3 · `BaDocument.tsx` 2) — салбар тус бүрийн хамгийн том суурь корпус (`bb/` 5, `has/` 1, `au/` · `hd/` · `iz/` · `tsah/` · `cbu/` бүгд **0** — ⚠️ TSBU-гийн загвар нь `cbu/` хавтсанд, `TeamReportsTab.tsx:247` тэрийг `TSBU` кодтой холбодог). **IZ (Интерьер) нь эзний тэргүүлэх эрэмбээр ХОЁРДУГААРТ** — эзэн түүнийг товчоондоо нэрлэсэн — ГЭВЧ `iz/` хавтасны ДӨРВӨН файлын АЛЬ НЬ Ч БНбД иш татлагагүй, тиймээс IZ-ийн багцыг загвараас ХУРААХ боломжгүй, норм каталогоос (`frontend/src/features/projects/team-reports/norm/`, 44 БНбД иш татлага) **ШИНЭЭР ЗОХИОХ** ёстой. Энэ бол багцын хөтөлбөрийн ГОЛ ХУВААРИЙН ЭРСДЭЛ — BA-гийн хурд IZ дээр ДАВТАГДАХГҮЙ.

---

## 3. ХИЙХ АЖИЛ

### 3.0 Дугаар авах

**ЭХЛЭХИЙН ӨМНӨ ЗААВАЛ:**

```bash
ls backend/migrations | tail -5
# 2026-08-30-нд хэмжсэн хамгийн өндөр файл: 0216_assistant_log_timing.sql
```

Track 2 нь **0217–0245** блокийг нөөцөлсөн. Энэ сессид оногдсон дугаар: **0238, 0239, 0240**.

⚠️ **Дугаарын түүх — андуурч болохгүй.** Даалгаврын товчооны АНХНЫ хувилбар `0230` ба `0231` гэж бичсэн байсан. REV-2-т бүх Track 2 файлыг **≤ 7 өөрийн statement** болгож дахин хуваасан тул `0231` (2 хүснэгт + 6 индекс = 8 statement) нь тээврийн дүрмийг зөрчихөөр байсан. Тиймээс:

| Хуучин (rev-1) | Одоо (rev-2) | Агуулга | Өөрийн statement |
|---|---|---|---|
| 0230 | **0238** | `assistant_logs.team_code` + `assistant_examples.team_code` + өвөрмөц индексийн солилт + `learning_events.verification_state` (VIRTUAL) | 7 |
| 0231 (хагас) | **0239** | `model_capabilities` | 4 |
| 0231 (хагас) | **0240** | `team_rule_scope` | 4 |

Ах дүү сессүүд дугаар ЗЭРЭГ авч байна. `tail -5` дээр 0238–0240 аль хэдийн байвал **ЗОГС** ба эзнээс асуу — нөөцөлсөн SPARE нь 0243–0245.

⚠️ **0238 нь 7/7 буюу тээврийн ТААЗАН дээр байна.** Түүнд өөр НЭГ Ч statement нэмж БОЛОХГҮЙ — 8 дахь нь файлыг ХАГАС хэрэгжүүлж, `d1_migrations`-д мөр ҮЛДЭЭХГҮЙ, ба цорын ганц хууль ёсны засвар нь ШИНЭ ДУГААР болно. Нэмэлт хэрэгтэй бол SPARE **0244**-ийг ав (**0243 БИШ** — `2-1` §8 түүнийг өөрийн 0219-ийн rollback-д заасан) ба энэ §3.0-д тэр авалтыг ЗАРЛА.

Мөн ALTER бүрийн өмнө:

```bash
cd backend && node --test src/lib/migrationSchema.test.ts
# 0214 ба 0215 хоёул `reviewed_at` нэмэх шахсан явдлын дараа энэ хамгаалалт бий болсон.
```

### 3.1 `0238_assistant_team_scope.sql` — багийн хамрах хүрээг сургалтын корпуст оруулах

```sql
-- ==================================================================
-- 0238_assistant_team_scope.sql — СУРГАЛТЫН КОРПУСЫН БАГИЙН ХАМРАХ ХҮРЭЭ (2-6)
--
-- ЗОРИЛГО: v2 §50 «Team-specific data must remain traceable to company,
--   team, project, source, verification state, model version, dataset
--   version».  Долоон шинжийн ХОЁР ДАХЬ нь (team) өнөөдөр `assistant_logs`
--   ба `assistant_examples` дээр БАЙХГҮЙ.  Энэ миграц түүнийг нэмнэ ба
--   0195:59-60-ын өвөрмөц индексийг ГУРВАЛСАН болгож, хоёр багийг нэг
--   өгүүлбэрийг ӨӨРӨӨР шошголохыг зөвшөөрнө.
--
-- ⚠️ team_code TEXT, team_id INTEGER БИШ.  Шалтгаан: 0069-ийн прецедент
--    («баг дахин суулгагдахад мөр амьд үлдэхийн тулд кодоор лавлана»),
--    `revit_documents.team_code` аль хэдийн TEXT (0187:30), ба дүрмийн
--    багц нь `teams` хүснэгтгүй C# клиентэд хүргэгддэг.  Валидац нь
--    /^[A-Z]{2,8}$/ + амьд `teams.code` хайлт, роутын талд.
--
-- ⚠️ NULL = КОМПАНИ ДАЯАР (баг харгалзахгүй).  Энэ бол ЦОРЫН ГАНЦ
--    хамгаалж болох backfill өгөгдмөл: одоо байгаа 2402 мөр нь ямар ч
--    багийн нотолгоо БИШ (§2.1 — бүгд синтетик), тэднийг ямар нэг багт
--    оноох нь ТӨСӨӨЛӨЛ болно.  ЗОРИУД BACKFILL ХИЙХГҮЙ.
--
-- ⚠️ BIND АРИФМЕТИК (`lib/assistantLogInsert.ts` / `assistantExampleInsert.ts`
--    дээр хэмжсэн):  assistant_logs 17 → 18 bind → floor(100/18) = 5 мөр
--    (ӨӨРЧЛӨГДӨХГҮЙ) · assistant_examples 13 → 14 bind → floor(100/14) = 7
--    мөр (ӨӨРЧЛӨГДӨХГҮЙ).  Ingest-ийн бүтээмжид ТЭГ зардал.
--
-- ⚠️ DROP INDEX + CREATE INDEX нь ХҮСНЭГТИЙГ ДАХИН БАРИХГҮЙ.  Тиймээс
--    `users`-ын 19 каскад хүүхдийн хориг ЗӨРЧИГДӨХГҮЙ.  `assistant_examples`
--    нь `users`-ын хүүхэд (0195:53) — ХҮСНЭГТИЙГ ХЭЗЭЭ Ч rebuild хийхгүй.
--
-- ⚠️ IFNULL(team_code, '') — SQLite-д NULL нь өөртэйгөө ТЭНЦЭХГҮЙ тул
--    цэвэр `UNIQUE(text, intent, team_code)` нь компани даяарын мөрийг
--    ХЭДЭН УДАА Ч оруулахыг зөвшөөрнө.  Хоосон мөрөнд буулгах нь тэр
--    нүхийг хаана.  `''` нь хүчинтэй team_code БИШ (regex 2-8 үсэг).
--
-- ⚠️ ДАРААЛАЛ: ALTER x2 → DROP → CREATE UNIQUE → CREATE INDEX x2 → ALTER.
--    Өвөрмөц индексийг ЭХЛЭЭД хаяхгүй бол хоёр өвөрмөц хязгаарлалт үлдэж,
--    гуравласан нь утгагүй болно.  7 дахь ALTER нь ӨӨР хүснэгт дээр тул
--    дараалалд хамаарахгүй.
--
-- ⚠️ 7 дахь statement нь `learning_events` дээр — ЦОРЫН ГАНЦ ГАДНЫ ХҮСНЭГТ.
--    §3.4-ийн `TRAINING_RELEVANCE.RULE_VALIDATION` нь мөрийн ХӨЛДӨӨСӨН
--    `verification_state`-ээс шийдэгддэг ба тэр багана Track 2-т ЭЗЭНГҮЙ
--    байв (`2-1` §3.0 нь 0220-оос дээшхийг ИЛ ГАДУУРХДАГ, түүний 0219 нь
--    ЗӨВХӨН `team_code`/`team_source` гаргадаг).  Эзэнгүй үлдээвэл файлын
--    хамгийн ачаа даадаг салаа МӨНХӨД идэвхгүй: `RULE_VALIDATION` бүр
--    `evaluation_only` болж `HUMAN_VERIFIED` вердикт цөмд ХЭЗЭЭ Ч орохгүй.
--
-- ⚠️ GENERATED ALWAYS … VIRTUAL — bind ЗАРДАЛГҮЙ.  `EVENT_BINDS` 23 ХЭВЭЭР,
--    statement тутам 4 мөр ХЭВЭЭР (`bimEvents.ts:348-503`).  БОДИТ багана нь
--    ingest-ийг удаашруулах ба 0206-ын append-only триггер UPDATE-ыг хаадаг
--    тул хойш бөглөх БОЛОМЖГҮЙ — VIRTUAL нь ЦОРЫН ГАНЦ зөв хэлбэр
--    (`2-1`-ийн 0219-ийн адил).
--
-- ⚠️ ИНДЕКС ЗОРИУД ТАВИХГҮЙ: (1) файл 7/7 тээврийн таазан дээр,
--    (2) `verification_state`-ыг SQL-ээр ШҮҮХГҮЙ — тэнцэх мөрийн ЦОРЫН ГАНЦ
--    SQL шүүлт нь `DATASET_ELIGIBLE_SQL`, `verification_state` нь TypeScript
--    талд `relevanceOf`-оор уншигдана.  Индекс ҮНЭХЭЭР хэрэгтэй бол SPARE
--    **0244** (0243-ыг `2-1` өөрийн rollback-д заасан).
--
-- Нийт 7 statement (= таазан дээр), блок тайлбаргүй, мөр дотор нэмэлт цэгтэй таслал байхгүй.

-- 1. Түүхий бүртгэлийн баг — СЕРВЕР бөглөнө (клиент зарлаж БОЛОХГҮЙ).
ALTER TABLE assistant_logs ADD COLUMN team_code TEXT;

-- 2. Шошголсон жишээний баг — курацийн үед СЕРВЕР бөглөнө.
ALTER TABLE assistant_examples ADD COLUMN team_code TEXT;

-- 3. Хуучин хос өвөрмөц индексийг хаяна (0195:59-60).
DROP INDEX IF EXISTS idx_assistant_ex_uniq;

-- 4. ГУРВАЛСАН өвөрмөц — «нэг өгүүлбэр, нэг санаа, нэг баг».
CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_ex_uniq
  ON assistant_examples(text, intent, IFNULL(team_code, ''));

-- 5. Сургалтын экспортын гол унших хэлбэр — «баг + итгэл + санаа».
CREATE INDEX IF NOT EXISTS idx_assistant_ex_team
  ON assistant_examples(team_code, review_state, source_type, intent);

-- 6. Курацийн дараалалын багийн шүүлт (`GET /assistant/pending?team=`).
CREATE INDEX IF NOT EXISTS idx_assistant_logs_team
  ON assistant_logs(team_code, curated, created_at DESC);

-- 7. §78-ийн хамаарлын давхаргын ЦОРЫН ГАНЦ өгөгдлийн эх сурвалж.
ALTER TABLE learning_events ADD COLUMN verification_state TEXT GENERATED ALWAYS AS (json_extract(payload_json, '$.verification_state')) VIRTUAL;
```

⚠️ **7 дахь statement нь ЭНЭ ДОКИЙН ХАМРАХ ХҮРЭЭГ ЗОРИУД ӨРГӨТГӨЖ БАЙНА.** Анхны хувилбар `verification_state`-ыг «`2-1`-ийн 0220 гаргана» гэж иш татсан боловч `2-1` §3.0 нь 0220-оос дээшхийг ИЛ ГАДУУРХДАГ ба түүний 0219 нь `team_code`/`team_source` ХОЁРЫГ Л гаргадаг — тэр багана Track 2-ын НЭГ Ч баримтад эзэнгүй байв. Цорын ганц хэрэглэгч нь ЭНЭ файл (§3.4) тул эзэн ч ЭНЭ файл. Багана нь ЗӨВХӨН ХЭЛБЭР: түүнийг БӨГЛӨХ нь `2-3`-ын `RULE_VALIDATION` payload ба `2-4` §3.9-ийн эмиттерийн тамганы жагсаалт (`team_code` / `team_source` / `team_confidence` / `attribution_id`-ийн ХАЖУУД `verification_state`) — §5-ийн урьдчилсан нөхцөл 7. Бичихгүй бол багана NULL, `relevanceOf` нь `evaluation_only` (аюулгүй тал), гэхдээ `HUMAN_VERIFIED` вердикт цөмд ХЭЗЭЭ Ч орохгүй.

### 3.2 `0239_model_capabilities.sql` — v2 §79-ийн бүртгэл

```sql
-- ==================================================================
-- 0239_model_capabilities.sql — ЗАГВАРЫН ЧАДВАРЫН БҮРТГЭЛ (2-6, v2 §79)
--
-- ЗОРИЛГО: «Do not assume one model can safely perform every task.»
--   §79-ийн НАЙМАН талбар БҮГД, нэрийг нь өөрчлөхгүйгээр, + §80-ийн
--   `authority_level`.
--
-- ⚠️ ЯАГААД ШИНЭ ХҮСНЭГТ, `assistant_models`-ыг ӨРГӨТГӨХГҮЙ ВЭ:
--    КАРДИНАЛ ӨӨР.  Нэг загвар нь ОЛОН чадвартай (task) байж болно, ба
--    чадвар тус бүр нь ӨӨР багийн хамрах хүрээ, ӨӨР эрхийн түвшинтэй.
--    `assistant_models`-д багана нэмэх нь «нэг загвар = нэг даалгавар»
--    гэж хатууруулна, тэр нь §79-ийн эсрэг.  Мөн `assistant_models`-ын
--    `eval_passed` (0213:44) нь ГАНЦ boolean — §80-R3-ын «түвшин бүр
--    БИЕ ДААСАН үнэлгээний хаалгатай» шаардлагыг барихгүй.
--
-- ⚠️ authority_level 0..5 = v2 §80: 0 OBSERVE · 1 EXPLAIN · 2 RECOMMEND
--    3 PREVIEW · 4 HUMAN-APPROVED EXECUTE · 5 LIMITED AUTONOMOUS EXECUTE.
--    v2 §40-R4 нь MVP-г 2-оор таслана.  CHECK нь 5 хүртэл зөвшөөрдөг ч
--    3+ рүү дэвших нь ЭНЭ СЕССИЙН ХАМРАХ ХҮРЭЭНЭЭС ГАДУУР.
--
-- ⚠️ team_scope NULL = БҮХ БАГТ хамаарна (компанийн хэмжээнд).  9 ангийн
--    санаа таних роутер нь ЯГ ТЭР тохиолдол — §2.5-ыг үз.
--
-- ⚠️ team_scope-ын БОДИТ УТГЫН ОРОН ЗАЙ (ЭЗЭН БАТАЛСАН 2026-08-30, §2.12):
--    NULL (компани даяар) + НАЙМАН салбарын хамрах хүрээ — BA · BB · HAS ·
--    TSBU · TSAH · HD · AU · IZ.  Тэдгээр нь v2 §46-ын багц ба шипсэн
--    `IMPLEMENTED_TEAMS`-тэй ЯГ ТААРНА.
--    ⚠️ БАГЦГҮЙ КЭЙС ИЛЭЭР: MGMT · EZ · GT нь `teams`-д БАЙГАА ч дүрмийн
--    багцгүй, тиймээс тэдэнд `model_capabilities` мөр ХЭЗЭЭ Ч ҮҮСГЭХГҮЙ.
--    `assertCapability` (§3.7-1) нь мөргүй үед `no_row` → ТАТГАЛЗАНА, тэр
--    нь ЗӨВ зан төлөв: багцгүй баг эрх мэдлийн түвшин авахгүй.
--    ⚠️ Энэ нь `TEAM = UNCERTAIN` БИШ (§2.12): сесс нь ЖИНХЭНЭ `team_code`-
--    оороо тамгалагдсан хэвээр, зөвхөн нийцлийн үнэлгээ алгасагдана, ба
--    ӨӨР БАГИЙН дүрэм рүү унах зам БАЙХГҮЙ.
--    Валидац нь `teams`-ын АМЬД мөрөөс —
--    наймыг маршрутад ХАТУУ БИЧИХГҮЙ (§3.7-ийн валидац 1).
--
-- ⚠️ REFERENCES users(id) нь ЭНД ХУУЛЬ ЁСНЫ.  `model_capabilities` дээр
--    append-only триггер БАЙХГҮЙ (0206 нь зөвхөн дөрвөн BIM хүснэгтийг
--    нэрлэдэг), тиймээс 1B-1 §2.6-ийн «ON DELETE SET NULL → хүүхдийн
--    UPDATE → триггер → эцгийн DELETE бүхэлдээ ABORT» гинж энд ФИРЭХГҮЙ.
--
-- Нийт 4 statement (<= 7).

CREATE TABLE IF NOT EXISTS model_capabilities (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,

  /* --- §79-ийн НАЙМАН талбар --- */
  -- «floor_plan_detection», «intent_routing», «rule_eval», «note_prose»
  task              TEXT    NOT NULL,
  -- `assistant_models.version` эсвэл дүрмийн багцын `ruleset_version`.
  -- ЗОРИУД FK БИШ: багц нь загвар БИШ, хоёулаа энэ баганад суудаг.
  model_version     TEXT    NOT NULL,
  -- NULL = бүх багт.  Эс бөгөөс `teams.code` (валидац роутын талд) —
  -- практикт ЭЗЭН БАТАЛСАН найман салбарын аль нэг (§2.12).  MGMT/EZ/GT
  -- дээр мөр ҮҮСГЭХГҮЙ: багцгүй баг = `no_row` = ТАТГАЛЗАНА.
  team_scope        TEXT,
  -- JSON массив: ["text"] | ["revit_elements","project_context"] | ["image"]
  input_types       TEXT    NOT NULL DEFAULT '[]',
  -- JSON массив: ["intent"] | ["verdict","evidence"] | ["prose_mn"]
  output_types      TEXT    NOT NULL DEFAULT '[]',
  -- Хэмжсэн итгэл (0..1).  Хөлдөөсөн багц дээрх нарийвчлал, CV БИШ —
  -- CV нь корпус хөдлөхөд харьцуулах боломжгүй (train_intent.py:471-484).
  confidence        REAL,
  evaluation_status TEXT    NOT NULL DEFAULT 'untested'
                            CHECK (evaluation_status IN
                              ('untested','experimental','approved','revoked')),
  -- JSON массив: ["read-only"] | ["no-production-write"] | ["recommend"]
  allowed_actions   TEXT    NOT NULL DEFAULT '["read-only"]',

  /* --- §80: түвшин тус бүрд БИЕ ДААСАН хаалга --- */
  authority_level   INTEGER NOT NULL DEFAULT 0
                            CHECK (authority_level BETWEEN 0 AND 5),
  -- Аль golden гүйлт энэ түвшинг нээв (`eval/last_run.json`-ийн хуулбар).
  eval_run_json     TEXT,
  eval_dataset_version TEXT,

  /* --- Мөрийн хөтлөгч --- */
  is_active         INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
  note              TEXT,
  granted_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Гол унших хэлбэр: «энэ даалгаварт, энэ багт, юу зөвшөөрөгдсөн бэ».
CREATE INDEX IF NOT EXISTS idx_model_cap_lookup
  ON model_capabilities(task, team_scope, is_active);

-- «Аль загварын хувилбар ямар эрхтэй вэ» — хувилбар татах шалгалт.
CREATE INDEX IF NOT EXISTS idx_model_cap_version
  ON model_capabilities(model_version, authority_level);

-- Туршилтын загвар чимээгүй эрх авахаас сэргийлэх аудит.
CREATE INDEX IF NOT EXISTS idx_model_cap_status
  ON model_capabilities(evaluation_status, authority_level, is_active);
```

### 3.3 `0240_team_rule_scope.sql` — дүрэм ↔ баг ↔ эрх мэдлийн төрөл

```sql
-- ==================================================================
-- 0240_team_rule_scope.sql — ДҮРМИЙН БАГИЙН ХАМРАХ ХҮРЭЭ (2-6, v2 §50/§60)
--
-- ЗОРИЛГО: v2 §50-R3-ын дөрвөн зөвшөөрөгдсөн механизмаас БИД «rule scope»-ыг
--   сонгосон (§2.5-ыг үз).  Энэ хүснэгт нь тэр сонголтын БОДИТ хэрэгжилт:
--   «дүрэм R нь баг T-д ЭЗЭН | ХАМААРАЛТАЙ | ЗӨВЛӨМЖ мөн үү».
--
-- ⚠️ mode нь ГУРВАН утга, ба ялгаа нь ачаа даана:
--    'own'      — тэр багийн дүрэм.  Багц татахад ОРНО, олдвор нь тэр багт
--                 ЭЗЭМШИГДЭНЭ.
--    'shared'   — олон багт нэгэн зэрэг хамаарна (ж: гал).  ХЭД ХЭДЭН
--                 мөр, баг тус бүрд НЭГ.
--    'advisory' — багт ХАРАГДАНА ч тэр баг ЗАСАХГҮЙ (өөр багийн ажил).
--                 Багц татахад ОРОХГҮЙ — §76-ийн ядаргааны эх сурвалж.
--
-- ⚠️ source_kind нь ЭРХ МЭДЛИЙН ТӨРӨЛ, `2-2`-ын `verification_state`-аас
--    ТУСДАА тэнхлэг.  Хэмжсэн шалтгаан: `bb/template.ts:173` нь «МАКС
--    ӨРГӨӨ хурлын зөвлөмжийн дагуу…» гэсэн КОМПАНИЙН ДАДЛЫГ БНбД иш
--    татсан бусад hint-тэй ЯГ ИЖИЛ утасгүй мөрөнд хадгалдаг.  AI хурлын
--    тэмдэглэлийг ӨНДӨР БАРИЛГЫН ХУУЛЬ гэж иш татах нь UX-ийн алдаа биш,
--    ХАРИУЦЛАГЫН асуудал.  'company_practice' ба 'team_standard' нь
--    ХЭЗЭЭ Ч БНбД код харуулахгүй (`2-2` §4.1-ийн кламп).
--
-- ⚠️ rule_uid нь `2-2`-ын `rules.rule_uid`-ыг лавладаг.  REFERENCES
--    ЗОРИУД ТАВИАГҮЙ — `rules` нь дүрмийн багц дахин нийтлэгдэхэд мөр
--    сольж болох ба D1 ажиллах үед FK шалгадаггүй тул FK нь худал
--    аюулгүй байдал өгнө.  Валидац нь `POST /api/compliance/rule-scope`
--    дээр.
--
-- ⚠️ team_id REFERENCES teams(id) нь ХУУЛЬ ЁСНЫ (append-only триггергүй),
--    гэхдээ БИД `team_code` TEXT ашиглана — 0069-ийн прецедент, ба дүрмийн
--    багц нь `teams` хүснэгтгүй C# клиентэд хүрдэг.
--
-- ⚠️ ХЭН МӨР АВАХ ВЭ (ЭЗЭН БАТАЛСАН 2026-08-30, §2.12): ЗӨВХӨН найман
--    салбарын баг — BA · BB · HAS · TSBU · TSAH · HD · AU · IZ.
--    **MGMT · EZ · GT нь ЭНЭ ХҮСНЭГТЭД МӨРГҮЙ.**  Тэд `teams`-д байгаа ч
--    дизайны салбар БИШ (MGMT) эсвэл зөвхөн блокийн угтвар (EZ/GT), тиймээс
--    дүрмийн багц авахгүй.  Мөргүй нь ХООСОН БАГЦ гэсэн үг — тэр сесс
--    ЮУТАЙ Ч ТУЛГАГДАХГҮЙ.  ⚠️ Тэр нь `TEAM = UNCERTAIN` БИШ (§2.12):
--    `team_code` нь ЖИНХЭНЭ кодоороо үлдэж, `learning_events` тэр кодоор
--    шошгологдсоор байна (v2 §72) — зөвхөн шалгалт алгасагдана.  ⚠️ ӨӨР
--    БАГИЙН дүрэм рүү «ойролцоо» гэж унагаах ЗАМ БАЙХГҮЙ бөгөөд байх ч
--    ЁСГҮЙ — BA-гийн коридорын өргөнөөр MGMT-ийн сессийг шалгах нь худал
--    олдвор.  Схемийн талд хориг ТАВИХГҮЙ (`teams`-д CHECK хийвэл баг нэмэх
--    бүрд миграц шаардана) — хамгаалалт нь §3.7-ийн `POST /rule-scope`-ын
--    амьд `teams` хайлт ба админы сахилга — ба ЭНЭ ТАЙЛБАР.
--
-- ⚠️ ЭХНИЙ ДҮҮРГЭГДЭХ БАГ: **BA** (ЭЗЭН БАТАЛСАН 2026-08-30).  BA-гийн багц
--    бүрэн эхээрээ эхэлж бичигдэж, үлдсэн долоогийн БҮТЦИЙН ЗАГВАР болно.
--    IZ хоёрдугаарт — гэхдээ `iz/` загварт БНбД иш татлага ТЭГ тул түүний
--    мөрүүд норм каталогоос ШИНЭЭР зохиогдоно (§2.12).
--
-- Нийт 4 statement (<= 7).

CREATE TABLE IF NOT EXISTS team_rule_scope (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_uid     TEXT    NOT NULL,
  team_code    TEXT    NOT NULL,
  mode         TEXT    NOT NULL DEFAULT 'own'
                       CHECK (mode IN ('own','shared','advisory')),
  source_kind  TEXT    NOT NULL DEFAULT 'norm'
                       CHECK (source_kind IN ('norm','company_practice','team_standard')),
  -- Компанийн дадлын гарал үүсэл: «МАКС ӨРГӨӨ хурал 2026-03-14».
  -- source_kind = 'norm' үед NULL.
  practice_origin TEXT,
  note         TEXT,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Нэг дүрэм нэг багт НЭГ Л мөртэй.
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_rule_scope_uniq
  ON team_rule_scope(rule_uid, team_code);

-- Багц угсрах гол хэлбэр: «энэ багийн 'own' + 'shared' дүрмүүд».
CREATE INDEX IF NOT EXISTS idx_team_rule_scope_team
  ON team_rule_scope(team_code, mode);

-- Урвуу хайлт: «энэ дүрэм ХЭДЭН багт хамаарах вэ» (§60 cross-discipline).
CREATE INDEX IF NOT EXISTS idx_team_rule_scope_rule
  ON team_rule_scope(rule_uid, mode);
```

### 3.4 `backend/src/lib/trainingRelevance.ts` (ШИНЭ) — v2 §78-ийн ил хамаарлын давхарга

v2 §78: «Not every observed action should train a model … Build an explicit task/data relevance layer.» ERP-д нэвтрэх нь сургалтын жишээ БИШ.

```ts
/**
 * v2 §78 · СУРГАЛТЫН ХАМААРЛЫН ДАВХАРГА.
 *
 * ⚠️ ЯАГААД `Record<LearningEventKind, …>` БҮРЭН БИЧЛЭГ ВЭ:
 *    `bimEvents.ts:224`-ийн `REQUIRED_PARTS_OF`-той ЯГ ИЖИЛ шалтгаанаар.
 *    `learning_events.kind` дээр DB CHECK ЗОРИУД ТАВИАГҮЙ (0205:116) —
 *    сая мөртэй append-only хүснэгтэд CHECK өөрчлөх нь ХҮСНЭГТИЙГ ДАХИН
 *    БАРИХЫГ шаардана.  Хаалттай багцыг ЭНД барина: шинэ `kind` нэмэхэд
 *    `tsc` УНАНА, чимээгүй «ямар нэгэн өгөгдмөл» рүү унахгүй.
 *
 * ⚠️ ЭНД БОДЛОГО БАЙНА, ШҮҮЛТ БИШ.  Сургалтад тэнцэх мөрийн ЦОРЫН ГАНЦ
 *    SQL шүүлт нь `bimEvents.ts:144`-ийн `DATASET_ELIGIBLE_SQL`
 *    (`parts_missing = 0`).  Өөрийн `WHERE` бичихийг ХОРИГЛОНО.
 */
import type { LearningEventKind } from './bimEvents';

/** `2-2`-ын `rules.verification_state`-ийн ХОС (twin) — гурвуулаа ХАМТ хөдөлнө. */
export const VERIFICATION_STATES = [
  'UNVERIFIED', 'CLAUSE_CITED', 'HUMAN_VERIFIED',
] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

/**
 *  · `never`            — сургалтад ХЭЗЭЭ Ч орохгүй (ERP нэвтрэлт, tool дуудлага).
 *  · `evaluation_only`  — ҮНЭЛГЭЭ / сөрөг жишээ / нэмэгдүүлэлтэд л.
 *  · `core`             — сургалтын ЦӨМД орж болно (нэмэлт нөхцөл доор).
 */
export const RELEVANCE_VALUES = ['never', 'evaluation_only', 'core'] as const;
export type Relevance = (typeof RELEVANCE_VALUES)[number];

export type RelevanceSpec =
  | { readonly kind: 'fixed'; readonly relevance: Relevance; readonly why: string }
  | {
      readonly kind: 'by_verification';
      readonly coreWhen: readonly VerificationState[];
      readonly otherwise: Relevance;
      readonly why: string;
    };

/**
 * ⚠️ `RULE_VALIDATION` нь ТОГТМОЛ БИШ — ЭНЭ БОЛ ЭНЭ ФАЙЛЫН ХАМГИЙН
 *    АЧАА ДААДАГ ШИЙДВЭР.
 *
 *    `bimEvents.ts:739-741` нь `payload_json`-д `rule_id` БА `passed`
 *    байвал `RULE_VERDICT` битийг тавьдаг.  `REQUIRED_PARTS_OF
 *    .RULE_VALIDATION = ['RULE_VERDICT']` (`:231`) тул тэр мөрийн
 *    `parts_missing` нь 0 болж, `DATASET_ELIGIBLE_SQL`-д АВТОМАТААР
 *    тэнцэнэ.  Хэрэв бид `RULE_VALIDATION ⇒ core` гэж БОЛЗОЛГҮЙ
 *    буулгавал: `revit-mcp/CLAUDE.md:7-12` өөрөө «баталгаажаагүй
 *    зөвлөмжийн утга» гэж хүлээн зөвшөөрсөн 1200 мм босгоос гарсан
 *    зургаан долоо хоногийн WARNING нь хэдэн арван мянган тэнцэх мөр
 *    болж загварыг сургана.  §66-ийн худал эерэгийн хяналт үүнийг
 *    ИЛРҮҮЛЖ ЧАДАХГҮЙ — цорын ганц эх сурвалж нь ТЭР ЛЕ дүрэм.
 *
 *    Тиймээс хамаарал нь мөрийн ХӨЛДӨӨСӨН `verification_state`-ийн
 *    функц.  ⚠️ Тэр баганыг **ЭНЭ ДОК ӨӨРӨӨ** үүсгэнэ — `0238`-ын 7 дахь
 *    statement (§3.1).  `2-1`-ийн 0219 нь ЗӨВХӨН `team_code` ба
 *    `team_source` хоёрыг гаргадаг ба `2-1` §3.0 нь 0220-оос дээшхийг ИЛ
 *    ГАДУУРХДАГ, тиймээс энэ багана өмнө нь ЭЗЭНГҮЙ байв (§3.4-ийн хүснэгт).
 */
export const TRAINING_RELEVANCE: Record<LearningEventKind, RelevanceSpec> = {
  // --- ХЭЗЭЭ Ч: телеметр, амьдралын мөчлөг, багажийн дуудлага ---
  SESSION_START:  { kind: 'fixed', relevance: 'never', why: 'Амьдралын мөчлөг. v2 §78 «ERP login event → not a training example».' },
  SESSION_END:    { kind: 'fixed', relevance: 'never', why: 'Мөн адил.' },
  TOOL_INVOKED:   { kind: 'fixed', relevance: 'never', why: 'Багажийн дуудлага нь дизайны шийдвэр БИШ.' },
  TOOL_RESULT:    { kind: 'fixed', relevance: 'never', why: 'Мөн адил.' },

  // --- ЗӨВХӨН ҮНЭЛГЭЭ: машины гаралт, хүний баталгаагүй ---
  AI_PREDICTION:  { kind: 'fixed', relevance: 'evaluation_only', why: 'v2 §42-R2: AI гаралтыг өөрийг нь сургах нь ХОРИОТОЙ өөрийгөө тэжээх гогцоо.' },
  AI_ACTION:      { kind: 'fixed', relevance: 'evaluation_only', why: 'Мөн адил.' },
  USER_FEEDBACK:  { kind: 'fixed', relevance: 'evaluation_only', why: '👍/👎 нь ШОШГО БИШ — курацийн дараалалын ЭРЭМБЭ (revit.ts:2163-2166).' },
  TEXT:           { kind: 'fixed', relevance: 'evaluation_only', why: 'Түүхий бичвэр — хүний баталгаагүй.' },
  IMAGE:          { kind: 'fixed', relevance: 'evaluation_only', why: 'Мультимодал нь Track 2-ын хамрах хүрээнээс ГАДУУР.' },
  SKETCH:         { kind: 'fixed', relevance: 'evaluation_only', why: 'Мөн адил.' },
  REVIT_STATE:    { kind: 'fixed', relevance: 'evaluation_only', why: 'Загварын хэсгийн зураг — контекст, шошго БИШ.' },
  USER_ACTION:    { kind: 'fixed', relevance: 'evaluation_only', why: 'Ажлын урсгалын дохио (R2). Хүн юу ЗӨВ гэснийг хэлэхгүй.' },
  PROGRESS_REPORT:{ kind: 'fixed', relevance: 'evaluation_only', why: 'Явцын хувь нь хүний хяналтын жагсаалтаас гардаг, загвараас БИШ.' },

  // --- ЦӨМ: хүний баталгаа БАЙНА ---
  HUMAN_CORRECTION: { kind: 'fixed', relevance: 'core', why: 'Хүн машиныг ЗАССАН — 0215-ын HUMAN_CORRECTED-ийн үйл явдлын хос.' },
  FINAL_APPROVAL:   { kind: 'fixed', relevance: 'core', why: 'Хүн ЭЦСИЙН БАТАЛГАА өгсөн.' },

  RULE_VALIDATION: {
    kind: 'by_verification',
    coreWhen: ['HUMAN_VERIFIED'],
    otherwise: 'evaluation_only',
    why: 'Дээрх ⚠️ блокийг үз. Баталгаажаагүй дүрмийн вердикт нь ГАЗАР ЗҮЙН ҮНЭН БИШ.',
  },
};

/** Мөрийн хөлдөөсөн контекст — `payload_json`-оос уншина, JOIN-оор БИШ. */
export interface RelevanceContext {
  /**
   * `learning_events.verification_state` — хөлдөөсөн, GENERATED VIRTUAL.
   * ⚠️ Баганыг `0238`-ын 7 дахь statement үүсгэнэ (§3.1).  Түүнийг БӨГЛӨХ
   *    нь `2-3`-ын вердиктийн `payload_json` ба `2-4` §3.9-ийн эмиттерийн
   *    тамганы ажил — тэд хоёулаа `verification_state`-ыг мөрөнд ХӨЛДӨӨХ
   *    ЁСТОЙ (§5-ийн урьдчилсан нөхцөл 6).
   *    `null` = «мэдэхгүй» ⇒ `RULE_VALIDATION` нь `evaluation_only` болно.
   */
  readonly verificationState: VerificationState | null;
}

/** Нийт функц — `kind` бүрд утга буцаана, `undefined` БАЙХГҮЙ. */
export function relevanceOf(
  kind: LearningEventKind,
  ctx: RelevanceContext,
): Relevance {
  const spec = TRAINING_RELEVANCE[kind];
  if (spec.kind === 'fixed') return spec.relevance;
  if (ctx.verificationState === null) return spec.otherwise;
  return spec.coreWhen.includes(ctx.verificationState) ? 'core' : spec.otherwise;
}

/**
 * Багийн оноолтын ЭХ СУРВАЛЖ — ЗӨВХӨН эдгээр нь БАТАЛГААЖСАН гэж тооцогдоно.
 * `2-1`-ийн шатны `team_source`-ын дэд багц.
 *
 * ⚠️ v2 §73-R3: «Do not permanently train on unverified team attribution.»
 *    `sheet_prefix` ба `behavior` нь ТААМАГЛАСАН тул ЭНД БАЙХГҮЙ.
 */
export const VERIFIED_TEAM_SOURCES = ['binding', 'document', 'manual'] as const;
export type VerifiedTeamSource = (typeof VERIFIED_TEAM_SOURCES)[number];

export function isVerifiedTeamSource(s: string | null): s is VerifiedTeamSource {
  return s !== null && (VERIFIED_TEAM_SOURCES as readonly string[]).includes(s);
}

/**
 * СУРГАЛТАД ТЭНЦЭХ ЭСЭХ — БҮРЭН предикат.
 *
 * ⚠️ Нөхцөл 1 нь ЗААВАЛ SQL талд `DATASET_ELIGIBLE_SQL`-ээр хэрэгжинэ.
 *    Үлдсэн нь мөрийн ӨӨРИЙН ХӨЛДӨӨСӨН талбараас шийдэгдэнэ — JOIN
 *    ХЭРЭГГҮЙ.  Энэ нь ЦОРЫН ГАНЦ зөв хэлбэр: `learning_events` нь
 *    append-only (0206) тул хожим засах БОЛОМЖГҮЙ, ба `bim_sessions`
 *    руу JOIN хийвэл §73-ийн залруулга нь ХЭДЭН ЗУУН түүхэн мөрийн
 *    утгыг ЧИМЭЭГҮЙ өөрчилнө.
 */
export interface EligibilityInput {
  readonly kind: LearningEventKind;
  readonly partsMissing: number;          // SQL: DATASET_ELIGIBLE_SQL
  readonly verificationState: VerificationState | null;  // хөлдөөсөн
  readonly teamSource: string | null;     // хөлдөөсөн
  readonly teamCode: string | null;       // хөлдөөсөн
  readonly currentVerifiedTeam: string | null;  // `team_attributions` (2-1)
  readonly packPublished: boolean;        // `pack_sha256` нийтлэгдсэн үү (2-2)
  readonly identityMatch: 'match' | 'mismatch' | 'unknown';  // ⚠️ ЭЗЭНГҮЙ — доорхыг үз
}

export function isCoreTrainingEligible(x: EligibilityInput): boolean {
  if (x.partsMissing !== 0) return false;                                  // 1
  if (relevanceOf(x.kind, { verificationState: x.verificationState }) !== 'core') return false; // 2
  if (!isVerifiedTeamSource(x.teamSource)) return false;                   // 3 · §73-R3
  if (x.teamCode !== null && x.teamCode !== x.currentVerifiedTeam) return false; // 4
  if (!x.packPublished) return false;                                      // 5
  if (x.identityMatch === 'mismatch') return false;                        // 6
  return true;
}
```

⚠️ **БАГЦГҮЙ БАГИЙН МӨР — ЦУГЛУУЛНА, ХАРЬЯАЛУУЛНА, ГЭВЧ ДҮРЭМД ХЭЗЭЭ Ч СУРГАХГҮЙ** (ЭЗЭН БАТАЛСАН 2026-08-30, §2.12).
`MGMT` · `EZ` · `GT` нь `teams`-д мөртэй тул тэдгээр хэрэглэгчийн `assistant_logs` / `learning_events` мөр нь **бүрэн эрхтэй цуглагдана** ба `team_code` нь §3.6-ийн сервер талын шийдлээр ЯГ ЖИНХЭНЭ багаараа тамгалагдана — багийг NULL болгож нуух нь `2-1`-ийн харьяаллын шатыг худал болгоно. Ялгаа нь **ХЭРЭГЛЭЭНД**, цуглуулгад БИШ, ба тэр яг v2 §78-ийн хамаарлын давхаргын зорилго: «Not every observed action should train a model».

⚠️ **БАГЦГҮЙ СЕСС нь ШОШГОТОЙ ХЭВЭЭР — тэр нь `TEAM = UNCERTAIN` БИШ (§2.12).** Багц байхгүй нь илрүүлэлт УНАСАН гэсэн үг БИШ: илрүүлэлт АМЖИЛТТАЙ болсон, баг нь ЗӨВ, зөвхөн нийцлийн үнэлгээ алгасагдана. Тиймээс тэр сессийн `learning_events` мөр нь **ЖИНХЭНЭ кодоороо** (`MGMT` / `EZ` / `GT`) шошгологдсон хэвээр үлдэж, сургалтын өгөгдөл ЗӨВ ХАРЬЯАЛАЛТАЙ хадгалагдана. Хоёр шалтгаан, хоёулаа заавал: (1) **v2 §72** нь цуглагдсан МӨР БҮРИЙГ багаар тамгалахыг шаарддаг, тиймээс шошгогүй мөр нь §72-ыг ШУУД зөрчинө; (2) багцгүй сессийг NULL болговол тэр ажил БАГГҮЙ корпуст унаж, MGMT / EZ / GT-д хэн нэгэн багц ЗОХИОХ өдөр **ЭХЛЭХ ӨГӨГДӨЛ нь АЛГА БОЛСОН** байх байсан — эргэн харах түүх ҮЛДЭХГҮЙ. Доорх хүснэгтэд ялгаа нь СҮҮЛИЙН ГУРВАН мөрөнд Л байна; дээд гурав нь ХОЁУЛАНД ТИЙМ.

| Хэрэглээ | Найман салбарын баг | MGMT · EZ · GT |
|---|---|---|
| Мөр цуглуулах, `team_code` тамгалах | ТИЙМ | **ТИЙМ** |
| Курацийн дараалалд харагдах, шошголох | ТИЙМ | **ТИЙМ** |
| Санаа таних роутерын корпус (компани даяар, §2.5) | ТИЙМ | **ТИЙМ** |
| `team_rule_scope` мөр (§3.3) | ТИЙМ | **ҮГҮЙ** |
| `model_capabilities` мөр (§3.2) | ТИЙМ | **ҮГҮЙ** |
| **Дүрмийн сургалт / вердиктийн ЦӨМ** | ТИЙМ (нөхцөл 1-6) | **ХЭЗЭЭ Ч** |

Механик нь ШИНЭ КОД ШААРДАХГҮЙ — аль хэдийн байгаа хоёр хаалга үүнийг хийнэ: (1) `RULE_VALIDATION` нь `verificationState = 'HUMAN_VERIFIED'` үед Л `core` болно, ба багцгүй багт дүрэм байхгүй тул `RULE_VALIDATION` үйл явдал ҮҮСЭХ Ч ҮГҮЙ; (2) `packPublished` (нөхцөл 5) нь `team_rule_scope`-д мөргүй багт ХЭЗЭЭ Ч `true` болохгүй. Тиймээс **тусдаа «MGMT-ийг хас» шүүлт БИЧИХГҮЙ** — хаалттай-өгөгдмөл өөрөө хийнэ, ба жагсаалтад суурилсан шүүлт нь баг нэмэгдэх өдөр хуучирна.

⚠️ **Нөхцөл 2-6-ийн эх сурвалж — ХОЁР НЬ ЭЗЭНГҮЙ ХЭВЭЭР.** (2026-08-30-нд Track 2-ын бүх баримтыг нээж шалгав. Нөхцөл 2-ын оролт нь анх эзэнгүй байсныг ЭНЭ ДОК ӨӨРТӨӨ АВЧ хаав — доорх блокийг үз.)

| # | Оролт | Эх сурвалж | Төлөв |
|---|---|---|---|
| 2 | мөр дээрх **ХӨЛДӨӨСӨН** `verification_state` (`learning_events`-ийн VIRTUAL багана) | **ЭНЭ ДОК** — `0238`-ын 7 дахь statement (§3.1). Тамгалагч нь `2-3`-ын вердиктийн payload + `2-4` §3.9-ийн эмиттер | **ЭЗЭНТЭЙ (ЗАСВАРЛАВ)** |
| 3, 4 | хөлдөөсөн `team_source` / `team_code`, ба `team_attributions` | `2-1` §3.3 `0219_learning_events_team.sql` (GENERATED VIRTUAL) ба `2-1` §3.2 `0218_team_attributions.sql` | **ЭЗЭНТЭЙ** |
| 5 | `packPublished` — нийтлэгдсэн хэшийн бүртгэл | `2-2` §3.4-ийн **`rule_pack_versions`**, тэр нь **`0223_project_context_packs.sql`**-д үүсдэг | **ЭЗЭНТЭЙ** |
| 5 | мөр дээрх **ХӨЛДӨӨСӨН** `pack_sha256` (`learning_events`-ийн VIRTUAL багана) | **ХЭН Ч ЭЗЭМШИХГҮЙ** | **ЭЗЭНГҮЙ** |
| 6 | `identity_match` | **ХЭН Ч ЭЗЭМШИХГҮЙ** | **ЭЗЭНГҮЙ** |

⚠️ **`rule_pack_versions` бол 0223, 0227 БИШ.** Даалгаврын товчооны rev-2 нь `0227` гэж бичсэн боловч `2-2` нь бодитоор **0220–0223**-ыг эзэмшдэг ба багцын бүртгэлийг `0223`-д тавьсан. Мөн `2-2`-ын **`0220` нь `regulatory_documents`**, багцын хэш БИШ — хоёрыг андуурч болохгүй.

⚠️ **Хөлдөөсөн `pack_sha256` / `verification_state` / `ruleset_version` VIRTUAL багана нь ЭЗЭНГҮЙ БАЙВ.** `2-3` §2.10 тэднийг «`2-1` (0219/0220)» гэж заадаг ч `2-1` §3.0 нь **0220-ыг ИЛ ГАДУУРХДАГ** («0220 болон дээшхийг 2-2 … 2-8 эзэмшинэ») ба түүний 0219 нь `team_code`/`team_source` ХОЁРЫГ Л гаргадаг. Гурвуулаа эзэнгүй үлдээх БОЛОМЖГҮЙ байсан тул хуваав:

- **`verification_state` — ЭНЭ ДОК АВЛАА** (`0238`-ын 7 дахь statement, §3.1). Тэр нь §3.4-ийн ЦОРЫН ГАНЦ `by_verification` салааны өгөгдлийн эх сурвалж бөгөөд өөр хэрэглэгчгүй; эзэнгүй үлдээвэл «энэ файлын хамгийн ачаа даадаг шийдвэр» гэж зарласан салаа МӨНХӨД `evaluation_only` буцаана. `2-1`-ийг өөрчлөх ШААРДЛАГАГҮЙ — 0219 ба 0238 өөр багана нэмдэг.
- **`pack_sha256` — ЭЗЭНГҮЙ ХЭВЭЭР.** Тэр нь багцын БҮРЭН БҮТЭН БАЙДЛЫН хяналт (`2-2`-ын `rule_pack_versions`-той тулгагдана) тул тэр бүртгэлийг эзэмшдэг доктой ХАМТ хөдлөх ЁСТОЙ. Мөн 0238 нь 7/7 таазан дээр.
- **`identity_match` — ЭЗЭНГҮЙ ХЭВЭЭР** (доорх ⚠️ блок).

Хоёр эзэнгүй оролт нь §5-ийн урьдчилсан нөхцөл 6 хэвээр.

⚠️ **`identity_match` нь Track 2-т ЭЗЭНГҮЙ.** `grep -rn identity_match docs/bim-ai/2-*.md` нь ЗӨВХӨН `2-0` §9-12 (нээлттэй асуулт) ба ЭНЭ файлыг өгнө. `2-4` нь **0226 (`perf_json`) · 0227 (`compliance_notice_state`) · 0228 (тохиргоо)** гуравыг эзэмшдэг — тэнд `identity_match` гэсэн талбар ч, `0233` гэсэн миграц ч **БАЙХГҮЙ**. Тэр нь «хэн гар дээр байна» гэсэн СЕССИЙН ХЭН БЭ-гийн дохио тул `bim_sessions` ба `team_attributions`-ыг эзэмшдэг **`2-1`**-д харьяалагдана: `bim_sessions`-ийн `team_source`-той ИЖИЛ хэлбэрийн TEXT талбар (`'match' | 'mismatch' | 'unknown'`), enum нь `lib/teamContext.ts`-д. Энэ ДОК тэрийг ГАРГАХГҮЙ (§0-ийн хамрах хүрээ) — зөвхөн ХЭРЭГЛЭНЭ.

⚠️ **ГЭХДЭЭ ЭНЭ ДОК БЛОКЛОГДОХГҮЙ.** Нөхцөл 6 нь ЗӨВХӨН `'mismatch'` дээр татгалздаг; эзэн олдтол дуудагч `'unknown'` дамжуулах ба тэр нь ӨНГӨРНӨ. Блоклох ажлыг нөхцөл 1-5 хийнэ. Үнэ нь ӨӨР бөгөөд түүнийг ил бичих ЁСТОЙ: §73-R3-ын **хуваалцсан ажлын станцын хамгаалалт** (нэг PC дээр өөр хүний токеноор бичигдсэн мөр) нь `identity_match` эзэн олох хүртэл **ХЭРЭГЖЭЭГҮЙ ХЭВЭЭР**. Талбарыг `EligibilityInput`-д ОДООНООС үлдээнэ — хожим нэмэх нь БҮХ дуудагчийг өөрчилнө.

Нөхцөл 1-5-ын аль нэгний оролт байхгүй бол `isCoreTrainingEligible` нь `false` БУЦААНА — «мэдэхгүй» бол «тэнцэхгүй». Энэ бол зөв өгөгдмөл.

### 3.5 `trainingRelevance.test.ts` (ШИНЭ) — эмхэтгэлийн бус баталгаа

```ts
// node --test src/lib/trainingRelevance.test.ts
// ⚠️ registerHooks шаардлагагүй — энэ файл нь зөвхөн `./bimEvents`-ээс ТӨРӨЛ
//    импортолдог (`import type`), тиймээс ажиллах үед импорт үүсэхгүй.
```

Хамрах ёстой найман нөхцөл (§6-д хүлээн авах шалгуур болгон давтагдана):

1. `TRAINING_RELEVANCE`-ийн түлхүүрийн тоо `LEARNING_EVENT_KINDS.length` (= 16) -тэй ТЭНЦЭНЭ.
2. `SESSION_START`, `SESSION_END`, `TOOL_INVOKED`, `TOOL_RESULT` → `never`.
3. `AI_PREDICTION` → `evaluation_only` (verification state ямар ч байсан).
4. `RULE_VALIDATION` + `verificationState = 'HUMAN_VERIFIED'` → `core`.
5. `RULE_VALIDATION` + `'UNVERIFIED'` → `evaluation_only`.
6. `RULE_VALIDATION` + `null` → `evaluation_only`.
7. `isCoreTrainingEligible` нь `teamSource = 'sheet_prefix'` дээр `false`.
8. `isCoreTrainingEligible` нь `teamCode = 'BA'`, `currentVerifiedTeam = 'IZ'` дээр `false`.

### 3.5-1 `modelCapability.test.ts` (ШИНЭ) — хаалганы дөрвөн нөхцөл

```ts
// node --test src/lib/modelCapability.test.ts
// ⚠️ `decideCapability` нь ЦЭВЭР (D1-гүй) тул импортын заль ШААРДЛАГАГҮЙ.
```

1. Мөр ОГТ байхгүй → `{ ok: false, reason: 'no_row' }` — **хаалттай-өгөгдмөл**.
2. `evaluation_status = 'experimental'`, `authority_level = 2` → `not_approved` (түвшин хангалттай ч ТАТГАЛЗАНА).
3. `team_scope = 'BA'` (level 0) ба `team_scope = null` (level 2) хоёулаа байхад, `teamCode = 'BA'`, `needLevel = 2` → `level_too_low`, `granted = 0` — **багийн мөр компанийн мөрийг ДАРНА**.
4. `evaluation_status = 'approved'`, `is_active = 1`, `authority_level = 2`, `needLevel = 2` → `{ ok: true, granted: 2 }`.

### 3.6 Backend — багийн багана бичих, экспортлох, шүүх

| # | Файл:мөр | Өөрчлөлт |
|---|---|---|
| 1 | `assistantLogInsert.ts:58` (`ASSISTANT_LOG_COLUMNS`-ийн сүүлийн бичлэг) | `'team_code',` нэмнэ. Bind 17 → 18, statement тутмын мөр 5 хэвээр — ТООГ ГАРААР ЗАСАХГҮЙ, `ROWS_PER_STATEMENT` өөрөө тооцно |
| 2 | `assistantExampleInsert.ts:55` (`COLUMN_SPEC`-ийн сүүлийн бичлэг) | `['team_code', '?'],` нэмнэ. Bind 13 → 14, мөр 7 хэвээр |
| 3 | `assistantExampleInsert.ts` (шинэ export) | `resolveExampleTeam()` — курацийн үед багийг СЕРВЕР шийднэ (доор) |
| 4 | `revit.ts:1721` `POST /assistant/logs` | Bind массивт `team_code` нэмнэ. Утга нь **сервер талаас**: `user.sub` → `user_teams WHERE is_primary = 1` → `teams.code`. Клиентээс ХЭЗЭЭ Ч авахгүй |
| 5 | `revit.ts:2136` `GET /assistant/pending` | `where`-д багийн шүүлт нэмнэ (доор) |
| 6 | `revit.ts:2140-2154` (SELECT) | `l.team_code` нэмнэ — хянагч аль багийн мөр болохыг ХАРНА |
| 7 | `revit.ts:2328` `POST /assistant/examples` | `team_code: resolveExampleTeam(...)` — `deriveSourceType`-тай ЯГ ИЖИЛ загвар |
| 8 | `revit.ts:2613-2617` `GET /assistant/export` | SELECT-д `team_code` нэмнэ, `per_team` нэгтгэл нэмнэ. Шүүлтийг ЧАНГАРУУЛАХГҮЙ |

**Багийн шүүлт (`GET /assistant/pending`).** `revit.ts:2136`-ийг СОЛИНО:

```ts
// ⚠️ ЯАГААД ЭНЭ ШҮҮЛТ ЗААВАЛ ВЭ:
//    `isManager` нь admin ЭСВЭЛ senior — багийн гишүүнчлэлийн шалгалт
//    ХААНА Ч БАЙХГҮЙ.  Тиймээс BA-гийн senior нь IZ-ийн инженерийн
//    мөрийг харж, шошголж, дэвшүүлж чадна.  `revit.ts:2403`-ын
//    `AND review_status IS NULL` нь ЭХНИЙ шийдвэрийг ялагч болгодог тул
//    тэр алдааг БУЦААХ БОЛОМЖГҮЙ — багийн корпус БАЙНГА бохирдоно.
//    (v2 §82-ийн 4-р шалгуур: ТЭГ хөндлөн багийн алдагдал.)
const teamRaw = (c.req.query('team') || '').trim().toUpperCase();
const team = /^[A-Z]{2,8}$/.test(teamRaw) ? teamRaw : null;

const clauses: string[] = [];
const binds: unknown[] = [];
clauses.push(status ? 'l.review_status = ?' : 'l.curated = 0 AND l.review_status IS NULL');
if (status) binds.push(status);
if (team) {
  // ⚠️ NULL-ыг ОРУУЛНА: багийг тодорхойлж чадаагүй мөр (2-1-ийн
  //    'uncertain') хаана ч харагдахгүй болж ХОГ БОЛОХ ёсгүй.  Тэднийг
  //    багийн шүүлт ямар ч байсан харуулна — хянагч л тэдгээрийг
  //    багт хуваарилж чадна.
  clauses.push('(l.team_code = ? OR l.team_code IS NULL)');
  binds.push(team);
}
const where = clauses.join(' AND ');
```

⚠️ Bind тооцоо: `status` (0..1) + `team` (0..1) + `limit` (1) = хамгийн ихдээ 3. D1-ийн 100-д ойртохгүй.

**`resolveExampleTeam` (шинэ, `assistantExampleInsert.ts`).**

```ts
/**
 * Курацлагдсан жишээний баг — СЕРВЕР шийднэ (гэрээ G1, `deriveSourceType`-той ижил).
 *
 * ⚠️ Клиентийн зарласан `team_code`-ыг ИТГЭЛ гэж үзэхгүй.  Дараалал:
 *   1. Гарал үүслийн бүртгэлийн `assistant_logs.team_code` (тэр нь өөрөө
 *      сервер талд бичигдсэн) — ХАМГИЙН ИТГЭЛТЭЙ.
 *   2. Бүртгэл олдоогүй / NULL бол → хянагчийн ил сонголт, ГЭХДЭЭ зөвхөн
 *      тэр багт гишүүн эсвэл `isManager` бол (роут шалгана).
 *   3. Эс бөгөөс NULL = КОМПАНИ ДАЯАР.
 *
 * ⚠️ ХЭЗЭЭ Ч «хянагчийн үндсэн баг»-ыг чимээгүй оноохгүй.  Тэр нь IZ-ийн
 *    өгүүлбэрийг BA гэж тамгалах ЯГ ТЭР алдаа.
 */
export function resolveExampleTeam(input: {
  originTeam: string | null;   // assistant_logs.team_code
  declared: string | null;     // клиентийн сонголт
  declaredAllowed: boolean;    // роут: гишүүн эсвэл isManager
}): string | null {
  if (input.originTeam) return input.originTeam;
  if (input.declared && input.declaredAllowed && /^[A-Z]{2,8}$/.test(input.declared)) {
    return input.declared;
  }
  return null;
}
```

### 3.7 `backend/src/routes/compliance.ts` — таван роут (гурав уншина, хоёр бичнэ)

⚠️ **Урьдчилсан нөхцөл.** `routes/compliance.ts`-ыг `2-2`/`2-3` ҮҮСГЭНЭ (`app.route('/api/compliance', …)` мөн `lib/modules.ts`-ийн `API_PREFIXES` + `MODULE_OF` бүртгэл нь ТЭДНИЙ ажил — `index.ts` ба `modules.ts` нь ЭНЭ СЕССИЙН файлын жагсаалтад БАЙХГҮЙ). Хэрэв энэ сесс гүйхэд файл БАЙХГҮЙ бол §3.7-г АЛГАСАНА, §6-ийн харгалзах шалгуурыг «блоклогдсон» гэж тэмдэглээд эзэнд хэлнэ. Таван роутыг файлын ТӨГСГӨЛД нэмнэ.

⚠️ **АЛЬ ХЭДИЙН БАЙГАА РОУТ ХӨНДӨХ ЦОРЫН ГАНЦ ЗӨВШӨӨРӨЛ — §3.7-1-ийн ХОЁР МӨР.** `2-2` §3.11-ийн `POST /api/compliance/rules/:uid/publish` ба `2-2` §3.12-ийн `GET /api/compliance/pack` хоёрт `assertCapability(...)` дуудлагыг НЭМНЭ (доор). Энэ нь дур зоргоор биш: `2-2:1244` нь тогтмолыг `model_capabilities`-ийн уншилтаар солихыг **«`2-6`-ийн ажил (§5)»** гэж ИЛ ШИЛЖҮҮЛСЭН, ба `2-5:1235` нь нийтлэлийн түвшний хаалгыг **`2-6`-ийн `model_capabilities.authority_level`** дээр тавихаар заасан. `2-6` нь долгион 2, `2-2` нь долгион 1 — тиймээс энэ сесс гүйх үед хоёр маршрут АЛЬ ХЭДИЙН байна. Өөр НЭГ Ч мөр хөндөхгүй.

```
GET  /api/compliance/rule-scope?team=BA
     → { scope: [{ rule_uid, mode, source_kind, practice_origin }] }
     Эрх: аль ч authenticated (роутерийн requireRole-оос гадна нэмэлт хаалгагүй)
     ⚠️ `mode = 'advisory'` мөр БУЦААНА ч клиент багц татахад ТЭДНИЙГ ОРУУЛАХГҮЙ.

POST /api/compliance/rule-scope
     Биет: { rule_uid, team_code, mode, source_kind, practice_origin?, note? }
     Эрх: requireAdmin()
     Валидац: team_code → /^[A-Z]{2,8}$/ БА `SELECT 1 FROM teams WHERE code = ?`
              source_kind = 'norm' үед practice_origin ЗААВАЛ NULL
              source_kind ≠ 'norm' үед practice_origin ЗААВАЛ утгатай (§2.11)
     `INSERT … ON CONFLICT(rule_uid, team_code) DO UPDATE` — idempotent.

GET  /api/compliance/capabilities?task=&team=
     → { capabilities: [ …model_capabilities мөрүүд… ] }
     Эрх: requireAdmin()
     ⚠️ `authority_level >= 3` мөрийг ЖАГСААНА — ГЭХДЭЭ ҮҮСГЭХ зам БАЙХГҮЙ
        (POST/PATCH нь 400 өгнө).  Жагсаах нь АУДИТ: гараар SQL бичсэн мөрийг
        ИЛРҮҮЛНЭ.

POST  /api/compliance/capabilities            Эрх: requireAdmin() → 201, давхардал 409
PATCH /api/compliance/capabilities/:id        Эрх: requireAdmin() → 200
     Биет: { task, model_version, team_scope?, input_types?, output_types?,
             confidence?, evaluation_status?, allowed_actions?, authority_level?,
             eval_run_json?, eval_dataset_version?, note? }
     ⚠️ PATCH дээр `task` ба `model_version` нь ХӨДӨЛГӨӨНГҮЙ — өөр даалгавар
        бол өөр мөр (§79-ийн кардинал).

     ⚠️ ГУРВАН ВАЛИДАЦ, ХОЁУЛАА МАРШРУТАД, СЕРВЕР талд:
       1. `team_scope` нь NULL ЭСВЭЛ /^[A-Z]{2,8}$/ БА `SELECT 1 FROM teams
          WHERE code = ?` мөр буцаана — амьд бүртгэлээс, тоо ХАТУУ БИЧИХГҮЙ (§2.12).
       2. `authority_level >= 3` → **400** «MVP нь LEVEL 2-оор тасарна» (v2 §40-R4).
          CHECK нь 5 хүртэл зөвшөөрдөг нь ИРЭЭДҮЙН схемийн зай, зөвшөөрөл БИШ.
       3. `evaluation_status = 'approved'` → `eval_run_json` нь `passed === true`
          БА `blocked.length === 0` БА `eval.model_version === <мөрийн
          model_version>` ГУРВЫГ ХАНГАНА (`revit.ts:1970-1973`-ийн хуулбар).
          Аль нэг дутвал **400**.
```

⚠️ **`/api/compliance` нь `lib/workerScope.ts`-ийн allowlist-д БАЙХГҮЙ** (`workerScope.ts:18-33` — найман угтвар, `compliance` тэдний нэг нь БИШ). Тэр нь ЗӨВ: allowlist нь хаалттай-өгөгдмөл, `worker` дүр 403 авна. **Тэр файлыг ЗАСАХГҮЙ.**

### 3.7-1 `backend/src/lib/modelCapability.ts` (ШИНЭ) — бүртгэлийг УНШДАГ хаалга

⚠️ **ЯАГААД ЗААВАЛ ВЭ.** Бичигчгүй, уншигчгүй `model_capabilities` нь v2 §79-ийн зорилгыг («prevent experimental AI from silently gaining production authority») ХЭРЭГЖҮҮЛЭХГҮЙ — тэр нь хаалга биш, зүгээр л баримтжуулалт. §3.7-ийн `POST`/`PATCH` нь БИЧИГЧ талыг, энэ файл нь **УНШИГЧ талыг** хаана.

```ts
/**
 * v2 §79 + §80 · ЧАДВАРЫН ХААЛГА.
 *
 * ⚠️ `assistant_models.eval_passed` (`0213:44`) нь ГАНЦ boolean тул LEVEL 0-д
 *    тэнцсэн загвар LEVEL 2-т ч тэнцсэн харагдана.  §80-R3 нь түвшин бүрд
 *    БИЕ ДААСАН хаалга шаарддаг — тэр нь мөр тус бүрийн `authority_level`.
 *
 * ⚠️ ТАТГАЛЗАЛ НЬ НЭРЛЭСЭН ШАЛТГААНТАЙ.  Чимээгүй `false` буцаавал дуудагч
 *    «яагаад» гэдэгт хариулж чадахгүй ба хаалгыг тойрох гэж оролдоно.
 */
export type CapabilityVerdict =
  | { readonly ok: true;  readonly granted: number }
  | { readonly ok: false; readonly reason: 'no_row' | 'inactive' }
  | { readonly ok: false; readonly reason: 'not_approved'; readonly status: string }
  | { readonly ok: false; readonly reason: 'level_too_low'; readonly granted: number };

export interface CapabilityRow {
  readonly task: string;
  readonly team_scope: string | null;
  readonly evaluation_status: string;
  readonly authority_level: number;
  readonly is_active: number;
}

/**
 * ЦЭВЭР шийдэгч — DB хүрэхгүй тул `node --test`-ээр шууд шалгагдана.
 *
 * ⚠️ ХАМРАХ ХҮРЭЭНИЙ ДАРААЛАЛ: багийн тусгай мөр компанийн мөрийг ДАРНА
 *    (`team_scope = 'BA'` > `NULL`) — §47-ийн шатны ЯГ ИЖИЛ дараалал.
 *    Урвуулбал BA-д ЗОРИУД хязгаарласан түвшинг компанийн мөр чимээгүй өргөнө.
 * ⚠️ ХААЛТТАЙ-ӨГӨГДМӨЛ: мөргүй ⇒ `no_row` ⇒ ТАТГАЛЗАНА.  «Бүртгэлд байхгүй»
 *    нь «зөвшөөрөгдсөн» БИШ — `lib/workerScope.ts`-ийн allowlist-ийн бодлого.
 */
export function decideCapability(
  rows: readonly CapabilityRow[],
  task: string,
  teamCode: string | null,
  needLevel: number,
): CapabilityVerdict {
  const match = rows.filter((r) => r.task === task && (r.team_scope === teamCode || r.team_scope === null));
  if (match.length === 0) return { ok: false, reason: 'no_row' };
  const chosen = match.find((r) => r.team_scope !== null) ?? match[0]!;
  if (chosen.is_active !== 1) return { ok: false, reason: 'inactive' };
  if (chosen.evaluation_status !== 'approved') return { ok: false, reason: 'not_approved', status: chosen.evaluation_status };
  if (chosen.authority_level < needLevel) return { ok: false, reason: 'level_too_low', granted: chosen.authority_level };
  return { ok: true, granted: chosen.authority_level };
}

/** Маршрутын бүрхүүл — логик бүхэлдээ `decideCapability` дээр, энд ЗӨВХӨН SQL. */
export async function assertCapability(
  db: D1Database,
  task: string,
  teamCode: string | null,
  needLevel: number,
): Promise<CapabilityVerdict> {
  const rs = await db
    .prepare(
      `SELECT task, team_scope, evaluation_status, authority_level, is_active
         FROM model_capabilities
        WHERE task = ?1 AND (team_scope = ?2 OR team_scope IS NULL)`,
    )
    .bind(task, teamCode)
    .all<CapabilityRow>();
  return decideCapability(rs.results ?? [], task, teamCode, needLevel);
}
```

**ХОЁР НЭРЛЭСЭН ДУУДАГЧ — өөр дуудагч БАЙХГҮЙ.**

| # | Дуудагч (роут) | Дуудлага | Татгалзвал |
|---|---|---|---|
| 1 | `POST /api/compliance/rules/:uid/publish` (`2-2` §3.11) — түүний ДӨРВӨН нөхцөлийн ДАРАА, `status='published'` бичихийн **ӨМНӨ** | `assertCapability(db, 'rule_eval', rule.team_code, 2)` | **409** + `reason`, `2-2`-ын бусад татгалзалтай ижил хэлбэр. `2-5:1235`-ын «түвшний хаалга» ЭНД амьдарна |
| 2 | `GET /api/compliance/pack?team=BA` (`2-2` §3.12) — багцын `authority_level`-ыг шийдэх үед | `assertCapability(db, 'rule_eval', team, 0)` | `ok:false` ⇒ багц `authority_level: 0` (OBSERVE)-оор гарна, **алдаа БИШ**. Бүртгэлгүй баг 0-ээс дээш эрх ХЭЗЭЭ Ч авахгүй |

⚠️ **Дуудлага 1 нь `revit.ts:1970-1973`-ийн гурван нөхцөлийг ОРЛОХГҮЙ, ДЭЭР НЬ зогсоно.** Тэр гурав нь `assistant_models`-ын **жин** нийтлэх хаалга; `assertCapability` нь **дүрмийн багц** нийтлэх хаалга — өөр артефакт, өөр хаалга. Гурван нөхцөлийн хуулбар нь §3.7-ийн валидац 3-аар (`evaluation_status = 'approved'`) шалгагдана, тиймээс тэдгээр НЭГ ДАВХАР ДООШ шилжинэ, алга болохгүй.

### 3.8 `backend/scripts/gen-rule-golden.mjs` (ШИНЭ) — v2 §70

`2-2`-ын `rule_test_cases` нь golden корпус ХОЁУЛАА болно. Хоёр дахь хурсанд БАРИХГҮЙ — `revit-mcp/eval/` аль хэдийн байгаа (§2.8).

```
ЗОРИЛГО: `rule_test_cases` (0225, `2-2`) → `revit-mcp/eval/golden/rules.json`

ГАРГАЦ: ЗӨВХӨН `verified = 1` мөр.  «Verified = TRUE» нь v2 §70-ийн
        жишээнд ЗААВАЛ талбар — баталгаажаагүй тохиолдол ХАДГАЛАГДАНА ч
        ТАВАН хэрэглээний АЛЬ Ч НЭГЭНД ОРОХГҮЙ.

ГҮЙЛТ:  node backend/scripts/gen-rule-golden.mjs --remote     (уншина, бичихгүй)
        node backend/scripts/gen-rule-golden.mjs --remote --write

МӨРИЙН ХЭЛБЭР (`eval/golden/rules.json`-ийн `rows` дотор):
  {
    "row_id":   "<sha256(preprocess(rule_uid + '\\x00' + case_uid))[:16]>",
    "rule_uid": "BA-HR-CORRIDOR-W-001",
    "case_uid": "case-001",
    "team_code": "BA",
    "inputs":   { "element.clear_width_mm": 1450, "element.length_m": 12 },
    "expect":   { "verdict": "WARNING", "issue_class": "REGULATORY_VIOLATION" },
    "verified": true,
    "verified_by": 2,
    "verified_at": "2026-09-14"
  }

⚠️ ХЭЗЭЭ Ч БИЧИХГҮЙ:
   · `verified = 0` мөр.
   · `revit-mcp/CLAUDE.md:59-116`-ийн тоог гараар — тэр файл өөрөө
     «design-guidance, албан ёсны БНбД-тэй тулгаагүй» гэж бичдэг ба
     `eval/golden/rules.json`-ийн `_note` түүнийг golden болгохыг
     ИЛЭЭР ХОРИГЛОДОГ.
   · `row_id`-ыг `train_intent.py:155-169`-ээс ӨӨР томьёогоор.  Санааны
     golden багц тэр томьёог ашигладаг; хоёр өөр томьёо нэг файлд
     БАЙХГҮЙ (`eval/manifest.json`-ийн `row_id._why`).

⚠️ ФАЙЛ БИЧСЭНИЙ ДАРАА ЗААВАЛ: `eval/manifest.json`-ийн `golden.rules.sha256`
   ба `.rows`-ыг шинэчилнэ.  `freeze.py`-ийн бүртгэлийн урсгалыг ашиглана —
   sha256-г ГАРААР БИЧИХГҮЙ.
```

⚠️ **`--write` нь ЗӨВХӨН `verified = 1` мөр ирсэн үед файл бичнэ.** Тэг мөр буцвал `rows: []`-ыг ХЭВЭЭР үлдээж, `exit 0` өгнө — `run_golden.py --kind rules` нь ТҮҮНИЙГ БЛОКЛОСООР байх нь ЗӨВ (§2.8). «Хараахан хэмжээгүй» ба «хэмжих шаардлагагүй» хоёрыг ялгах ёстой.

⚠️ **ЭХНИЙ МӨРҮҮД НЬ BA-ГИЙНХ БАЙНА — ЭЗЭН БАТАЛСАН 2026-08-30.** BA (Барилга архитектур) нь бүрэн бичигдэх ЭХНИЙ дүрмийн багц (§2.12), тиймээс **v2 §70-ийн «дүрэм тус бүрд баталгаажсан туршилтын кейс» хуримтлал ч эхлээд BA дээр л явагдана**: `rule_test_cases`-ийн эхний `verified = 1` мөрүүд, `gen-rule-golden.mjs`-ийн эхний бодит гаралт, ба `run_golden.py --kind rules`-ыг ТЭГ 2-оос ГАРГАХ эхний боломж — гурвуулаа BA-гийн кейсээс ирнэ. Хүлээгдэх дараалал: `team_code = 'BA'` мөр л эхлээд гарна, `per_team` нэгтгэлд ганц түлхүүр байна, тэр нь алдаа БИШ.

**BA-гийн курацийн урсгал нь ҮЛДСЭН ДОЛООГИЙН ЗАГВАР.** Эхний багц бол зөвхөн агуулга биш, **процессын эталон**: дүрмийг хэн зохиох · `verification_state`-ыг хэн `HUMAN_VERIFIED` болгох · кейсийг хэн `verified = 1` гэж тамгалах · `model_capabilities`-ийн `approved` мөрийг ямар golden гүйлтэд түшиглэн үүсгэх (§9-3-ын асуулт 13). Эдгээрийг BA дээр НЭГ УДАА тогтоовол дараагийн баг бүр нь агуулга бөглөх ажил болж хураагдана. **BB · HAS · TSBU · TSAH · HD · AU-гийн багцыг BA-гийн бүтэц тогтохоос ӨМНӨ эхлүүлэхгүй** — эс бөгөөс долоон өөр хэлбэр гарч, `gen-rule-golden.mjs`-ийн нэг мөрийн хэлбэр (`row_id` · `inputs` · `expect`) долоон удаа дахин хэлэлцэгдэнэ.

⚠️ **IZ нь эрэмбээрээ ХОЁРДУГААРТ ч хурдаараа БИШ.** Эзэн IZ (Интерьер)-ыг ил нэрлэсэн, гэвч `frontend/src/features/projects/team-reports/iz/` -ийн дөрвөн файлын АЛЬ НЬ Ч БНбД иш татлагагүй (BA-гийн 12-той харьцуул, §2.12). IZ-ийн кейсүүдийг ЗАГВАРААС ХУРААХ боломжгүй — норм каталогоос ШИНЭЭР зохиогдоно. Хуваарь гаргахдаа BA-гийн хугацааг IZ дээр хуулж БОЛОХГҮЙ.

### 3.9 `revit-mcp/training/pull_and_retrain.py` — тасархайг ЭХЛЭЭД засах

⚠️ **ДАРААЛАЛ АЧАА ДААНА.** Эхлээд `source_type`/`review_state`, ДАРАА нь `team_code`. Урвуулбал үхсэн хэмжээс дээр хоёр дахь үхсэн хэмжээс нийлүүлнэ (§2.3).

`pull_and_retrain.py:168-182`-ийн `clean` толийг ӨРГӨТГӨНӨ:

```python
    clean = [
        {"text": r["text"], "intent": r["intent"],
         "style": r.get("style") or "",
         "source": r.get("source") or "usage",
         # --- 2-6 · АЛХАМ 1: 0215-ын ИТГЭЛИЙН ТАКСОНОМИ ---
         # ⚠️ 2026-08-30 хүртэл ЭНД ХАЯГДДАГ байсан.  Экспортын endpoint
         #    (revit.ts:2613-2617) хоёуланг нь БУЦААДАГ; 0215:9-11-ийн
         #    тэнцэх дүрэм нь ЭНЭ ХОЁР ТАЛБАРГҮЙГЭЭР хэрэгжих БОЛОМЖГҮЙ
         #    байсан.  Хоёр тэнхлэгийг НИЙЛҮҮЛЖ БОЛОХГҮЙ (0215:3-8).
         "source_type": r.get("source_type") or "UNKNOWN",
         "review_state": r.get("review_state") or "pending",
         # --- 2-6 · АЛХАМ 2: БАГИЙН ХАМРАХ ХҮРЭЭ (0238) ---
         # ⚠️ None = КОМПАНИ ДАЯАР.  Багийг ТААМАГЛАХГҮЙ.
         "team": r.get("team_code"),
         **({"slot": r["slot"]} if r.get("slot") else {})}
        for r in rows
        if (r.get("text") or "").strip() and (r.get("intent") or "").strip()
    ]
```

Дараа нь `train_intent.py`-ийн `load_rows` дээр **ХОЁР шинэ тоологч**, шинэ шүүлт БИШ:

```
эх сурвалж:  manual 45 · seed 2357
итгэл     :  AI_GENERATED 2357 · HUMAN 45           ← ШИНЭ
баг       :  (компани даяар) 2402                    ← ШИНЭ
```

⚠️ **ЭНЭ СЕССЭД БОДЛОГЫН ХААЛГА ТАВИХГҮЙ.** `0215:11` нь бодлого нь сургалтын манифест дээр хэрэгжинэ гэж заасан; гэвч өнөөдөр цөмийн бодлого (`HUMAN_VERIFIED ∪ RULE_VERIFIED ∪ HUMAN_CORRECTED`) нь **ТЭГ мөр** өгнө (§2.1-2.2). Шүүлтийг ОДОО чангаруулбал дараагийн загвар ЗҮГЭЭР Л БАРИГДАХГҮЙ (`train_intent.py:309-311`). Тиймээс: **энэ сесс зөвхөн ХЭМЖИНЭ**; хаалгыг эзэн цөм тэгээс дээш гарсны дараа тавина (§9-4).

### 3.10 Манифест ба golden бүртгэл

**`revit-mcp/training/datasets.manifest.json`** — `production.json`-ы бичлэгт `_why`-д нэг өгүүлбэр нэмнэ (мөр УСТГАХГҮЙ, дараалал ХӨДӨЛГӨХГҮЙ — `_order_note` нь давхардал хасалтын тэргүүлэх эрэмбийг тодорхойлдог):

```
"_why": "… (одоо байгаа текст) …  2-6: мөр тус бүр `source_type`,
         `review_state`, `team` талбар агуулна.  `team = null` нь
         КОМПАНИ ДАЯАР гэсэн үг, ТААМАГЛАСАН баг БИШ."
```

⚠️ **`sha256` нь `production.json`-д `null` хэвээр** — машин бичдэг тул тогтоохгүй. Бусад таван файлын sha256-г ХӨНДӨХГҮЙ; тэднийг өөрчлөх нь `pull_and_retrain.datasets()` дээр `SystemExit` өгнө.

**`revit-mcp/eval/golden/rules.json`** — `_note`-ыг ӨРГӨТГӨНӨ, `rows: []` ХЭВЭЭР:

```
"_note": "GOLDEN-EVAL · дүрмийн хөдөлгүүр (БНбД хэмжээс).  ХООСОН ШИЛЖИНЭ
          … (одоо байгаа текст) …  2-6: цорын ганц бөглөх зам нь
          `backend/scripts/gen-rule-golden.mjs`, тэр нь `rule_test_cases`-аас
          ЗӨВХӨН `verified = 1` мөр экспортолно.  ГАРААР мөр нэмэхийг
          ХОРИГЛОНО."
```

**`revit-mcp/eval/manifest.json`** — `required_partitions` ба `golden.*` -ыг ЭНЭ СЕССЭД ХӨНДӨХГҮЙ (мөр нэмэгдэх үед `freeze.py` шинэчилнэ). Зөвхөн `_note`-д `gen-rule-golden.mjs`-ыг дурдана.

### 3.11 Frontend — курацийн багийн шүүлт

`AssistantCurationPage.tsx`: `PendingTab`-д `team` prop дамжуулна; `components/PendingTab.tsx`: `Select`-ээр баг сонгоод query-д `?team=` нэмнэ.

```tsx
// ⚠️ Багийн жагсаалтыг ХАТУУ БИЧИХГҮЙ.  `GET /api/teams` нь ямар ч
//    authenticated дүрд нээлттэй (`routes/teams.ts:60` дээр middleware
//    БАЙХГҮЙ), тиймээс амьд бүртгэлээс уншина.  7, 8, 9, 11 гэсэн тоо
//    ЭНД ХЭЗЭЭ Ч бичигдэхгүй.
// ⚠️ ЭЗЭН БАТАЛСАН (2026-08-30): дүрмийн багц авах салбарын баг НАЙМ —
//    BA · BB · HAS · TSBU · TSAH · HD · AU · IZ (v2 §46, §2.12).  ГЭВЧ
//    ЭНЭ SELECT нь наймаар ХЯЗГААРЛАГДАХГҮЙ: `teams` нь арван нэг мөртэй
//    ба MGMT / EZ / GT-ийн хэрэглэгчид ч бүртгэл үүсгэдэг тул тэдний мөр
//    курацийн дараалалд БАЙНА — жагсаалтаас хасвал тэр материал хаана ч
//    харагдахгүй ХОГ болно (§3.4-ийн «цуглуулна, дүрэмд сургахгүй»).
//    Шүүлт бол ХАРАХ хэрэгсэл; сургалтын хаалга нь `team_rule_scope` ба
//    `model_capabilities` дээр, ЭНД БИШ.
const teams = useApiQuery<{ teams: { code: string; name_mn: string }[] }>(
  ['/teams'], '/teams',
);
```

Шүүлтийн утга нь `?tab=` -тай ИЖИЛ URL-д амьдарна (`useTabParam`-ийн хажууд `useSearchParams`), тиймээс хянагч холбоос хуваалцаж чадна. Мөрийн картад (`LogCard.tsx`) `team_code` тэмдэглэгээ нэмнэ — хянагч аль багийн материалыг дэвшүүлж байгаагаа ХАРНА.

⚠️ **Клиент талд ДАХИН ЭРЭМБЭЛЭХГҮЙ.** `PendingTab.tsx:35-38` тэрийг ил хориглодог: серверийн `ORDER BY CASE` (`revit.ts:2158-2170`) бол бүтээгдэхүүний шийдвэр.

### 3.12 v2 §71 — ЗӨВШӨӨРӨГДСӨН ЦОНХНЫ БҮРЭН ЖАГСААЛТ (ЗӨВХӨН ТОДОРХОЙЛОЛТ)

v2 §71-R2: гар оролт ЗӨВХӨН таван зүйлд шаардагдана. Энэ нь бүтээгдэхүүний харуулж болох цонхны **БҮРЭН ALLOWLIST**:

| # | Зөвшөөрөгдсөн харилцан үйлдэл | Өнөөдөр хаана байгаа |
|---|---|---|
| 1 | Verification (баталгаажуулах) | `2-1`-ийн багийн чип дэх «Баталгаажуулах» |
| 2 | Correction (залруулах) | Курацийн `CorrectDialog` (`ReviewDialogs.tsx`) |
| 3 | Approval (батлах) | Курацийн «Дэвшүүлэх» |
| 4 | Dispute (маргах) | `2-5`-ийн олдвор дээрх «Зөвшөөрөхгүй» |
| 5 | Override (давж шийдэх) | `2-5`-ийн `finding_overrides` |

**Энэ таваас гадна ямар ч цонх нь v2 §53-R2-ыг ЗӨРЧНӨ.** Ribbon-ийн бичээс нь цонх БИШ. Багийн шүүлтийн `Select` нь ВЕБ дээрх админы хэрэгсэл, add-in дээрх цонх БИШ — тиймээс allowlist-д хамаарахгүй.

⚠️ Цуглуулгын тал АЛЬ ХЭДИЙН §71-д нийцдэг: `POST /api/learning/events` (`routes/learning.ts:279`) ба `assistant_logs`-ын багц нь хэрэглэгчийн ямар ч үйлдэлгүйгээр бичигддэг. Энэ сесс тэр нийцлийг ХАДГАЛНА — шинэ цонх НЭМЭХГҮЙ.

---

## 4. ХӨНДӨЖ БОЛОХГҮЙ (load-bearing)

| Юу | Хаана (баталгаажсан) | Яагаад эвдрэх вэ |
|---|---|---|
| `/api/*` нь `purpose === 'mcp'` токеныг хүлээж авах | `middleware/auth.ts:101-102`, `types.ts:209-212`, `lib/tokenValidity.ts:30-34` | Add-in бүх REST дуудлагаа тэр 365 хоногийн токеноор гардаг, refresh БАЙХГҮЙ. Алсаас сэргээх боломжгүй ЦОРЫН ГАНЦ өөрчлөлт: ~20 PC × `Install.bat` × Revit хаалттай |
| `users` / `projects` -ыг rebuild хийхгүй | 19 / 33 каскад хүүхэд | `assistant_examples.created_by` (`0195:53`), `.reviewed_by` (`0215:65`), `assistant_logs.reviewed_by` (`0214:27`) бүгд `users`-ын хүүхэд. `migrations apply`-ийн гүйлгээнд эцгийг устгах нь бүх мөрийг арчина |
| `idx_assistant_model_active` | `0195:147-148` | Хоёр загвар зэрэг идэвхтэй бол `GET /assistant/model` аль нь ирэхийг мэдэхгүй. Багаар салгасан ЖИН нь БУРУУ механизм (§2.5) — энэ индексийг ХЭВЭЭР үлдээнэ |
| `source_type` ба `review_state` нь ХОЁР ТУСДАА тэнхлэг | `0215:3-8` | Нэг багана болгож нийлүүлэх нь `0215`-ын БҮХ утгыг устгана. Мөр AI_GENERATED БАС хүнээр баталгаажсан байж БОЛНО |
| `DATASET_ELIGIBLE_SQL = 'parts_missing = 0'` | `bimEvents.ts:144` | Сургалтад тэнцэх мөрийн ЦОРЫН ГАНЦ SQL тодорхойлолт. Өөрийн `WHERE` бичих нь `parts_missing`-ийн бүх утгыг тойрч, дутуу нотолгоотой мөрийг корпуст оруулна |
| `REQUIRED_PARTS_OF` бүрэн бичлэг | `bimEvents.ts:224-241` | `Record<LearningEventKind, …>` — шинэ `kind` нэмэхэд `tsc` унана. `trainingRelevance.ts` ЯГ ЭНЭ загварыг давтана; аль нэгийг нь `Partial<>` болговол шинэ үйл явдал чимээгүй сургалтад орно |
| `row_id` томьёо | `train_intent.py:155-169`, `eval/manifest.json` `row_id.formula` | Хөлдөөсөн 361 мөрийн багц (`eval-holdout.ids.json`) ба 65 `exclude_row_ids` -ийн ЦОРЫН ГАНЦ холбоос. Өөрчилвөл ухралтын түүх бүхэлдээ утгаа алдана; `evaluate_frozen` нь 10%-иас дээш id алдагдвал ХАТУУ УНАНА |
| Хоосон golden хуваарь = ХАТУУ БЛОК | `run_golden.py:314-317, 356` | `rows == 0` бол `blocked` → `sys.exit(2)`. «Хараахан хэмжээгүй» ба «хэмжих шаардлагагүй» хоёрыг ялгах ЦОРЫН ГАНЦ механизм. `--kind rules`-ыг «алгасах» болговол хэмжигдээгүй дүрмийн хөдөлгүүр ногоон харагдана |
| `eval/golden/rules.json`-д ГАРААР мөр нэмэхгүй | `eval/golden/rules.json` `_note`, `revit-mcp/CLAUDE.md:7-12` | Репо дэх БНбД тоонууд өөрсдөө «design-guidance, албан ёсны БНбД-тэй тулгаагүй». Тэднийг golden болгох нь БУРУУ доод хэмжээг албан ёсны шошготой инженерийн өмнө тавина |
| Курацийн серверийн `ORDER BY CASE` | `revit.ts:2158-2170`, `PendingTab.tsx:35-38` | Тэмдэглэлтэй → залруулсан → 👎 → fallback → бусад. Клиент талд `sort` дуудвал хамгийн үнэ цэнтэй материал доош булагдана |
| `AND review_status IS NULL` (ЭХНИЙ шийдвэр ялна) | `revit.ts:2403`, `:2466` | Татгалзсаныг дэвшүүлсэн болгож чадахгүй. Хасвал хоёр хянагч бие биенийхээ шийдвэрийг чимээгүй дарж бичнэ |
| `WHERE assistant_examples.review_state <> 'rejected'` | `revit.ts:2384` | Үүнгүйгээр `is_active = 1` нь ТАТГАЛЗСАН жишээг чимээгүй АМИЛУУЛНА |
| `lib/workerScope.ts`-ийн allowlist | `workerScope.ts:18-33` | Хаалттай-өгөгдмөл. `/api/compliance` тэнд БАЙХГҮЙ нь ЗӨВ — `worker` дүр 403 авна. Тэр файлыг ЭНЭ СЕССЭД ЗАСАХГҮЙ |
| `assistant_logs` дээр 4 дэх бодит багана нэмэхгүй | `assistantLogInsert.ts:69-71` (хэмжсэн) | 18 → 5 мөр/statement, 19 → 5, 20 → 5, **21 → 4**. Дөрөв дэх нэмэлт нь ingest-ийн round trip-ийг 25% нэмнэ. Шаардлагатай бол `timing_json`-ы загвараар JSON + GENERATED VIRTUAL ашиглана (`0216:57-91`) |
| `check-bim-events.mjs` ногоон байх | `backend/package.json:18`, `check-bim-events.mjs:35` | `npm run verify`-ийн гурав дахь алхам. Bind арифметик хуучирсан тогтмолыг барина — тэр нь зөвхөн продакшн дээр илэрдэг ангийн алдаа |
| `learning_events.verification_state` нь **VIRTUAL**, БОДИТ БИШ | §3.1-ийн 7 дахь statement, `bimEvents.ts:348-503` | Бодит багана болговол `EVENT_BINDS` 23 → 24 болж `floor(100/25) = 4` хэвээр үлдэх ч дараагийн нэмэлт 3 болгож унагана; илүү муу нь 0206-ын append-only триггер UPDATE-ыг хаадаг тул түүхэн мөрийг ХОЙШ БӨГЛӨХ БОЛОМЖГҮЙ. VIRTUAL нь `payload_json`-ы проекц тул тамгалагч бичих даруйд ХУУЧИН мөр ч утгатай болно |
| 0238 нь 7/7 — статемент НЭМЭХГҮЙ | §3.0-ийн тээврийн дүрэм | 8 дахь statement нь файлыг ХАГАС хэрэгжүүлж `d1_migrations`-д мөр ҮЛДЭЭХГҮЙ. Дараагийн `apply` нь ижил файлыг ХАГАС үүссэн объект дээр дахин гүйлгэнэ. Нэмэлт хэрэгтэй бол SPARE **0244** (0243 нь `2-1`-ийн rollback-д захиалагдсан) |
| `assertCapability` нь нийтлэх хаалганы ХЭСЭГ | §3.7-1, `2-5:1235`, `2-2:1244` | Хасвал `model_capabilities` нь бичигдээд ХЭН Ч УНШИХГҮЙ хүснэгт болно, ба §79-ийн зорилго («туршилтын AI чимээгүй продакшны эрх авахаас сэргийлэх») хэрэгжихгүй. Хүснэгт байгаа нь хаалга байгааг БАТАЛГААЖУУЛАХГҮЙ — уншигч л баталгаажуулна |
| `authority_level >= 3`-ыг маршрут ОРУУЛАХГҮЙ | §3.7-ийн валидац 2, v2 §40-R4 | CHECK нь 5 хүртэл зөвшөөрдөг нь ирээдүйн схемийн зай. Маршрутын 400-г хасвал admin нэг POST-оор LEVEL 4 (HUMAN-APPROVED EXECUTE) олгож чадна — тэр нь `2-5` §2.11-ийн «засвар ХЭЗЭЭ Ч автоматаар хэрэгжихгүй» дөрвөн шалтгааныг НЭГ мөрөөр тойрно |

---

## 5. ДАРААЛАЛ БА ХАМААРАЛ

**Урьдчилсан нөхцөл:**

| # | Нөхцөл | Хэрхэн шалгах |
|---|---|---|
| 1 | `2-1` нийлүүлэгдсэн — `bim_sessions.team_code`, `team_attributions`, хөлдөөсөн `team_source` | `wrangler d1 execute … --command "PRAGMA table_info(bim_sessions)"` дотор `team_source` байх |
| 2 | `2-2` нийлүүлэгдсэн — `rules.rule_uid`, `rule_test_cases`, `verification_state` | `PRAGMA table_info(rule_test_cases)` мөр буцаах |
| 3 | `2-5` нийлүүлэгдсэн — `finding_overrides` (override нь хянагдсаны ДАРАА л сургалтын өгөгдөл) | `PRAGMA table_info(finding_overrides)` |
| 4 | 0212–0216 продакшн дээр ХЭРЭГЖСЭН | `SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 10` (§9-3) |
| 5 | `routes/compliance.ts` оршиж байгаа, ба түүнд `2-2`-ын `POST /rules/:uid/publish` + `GET /pack` АЛЬ ХЭДИЙН байгаа (§3.7 ба §3.7-1-д ХЭРЭГТЭЙ) | `ls backend/src/routes/compliance.ts` · `grep -n "rules/:uid/publish\|/pack" backend/src/routes/compliance.ts` |
| 6 | ⚠️ **ЭЗЭНГҮЙ ОРОЛТ — эхлэхийн ӨМНӨ эзэнтэй болгоно.** `isCoreTrainingEligible`-ийн нөхцөл 5 нь `learning_events`-ийн хөлдөөсөн `pack_sha256` VIRTUAL баганыг, нөхцөл 6 нь `identity_match`-ыг шаарддаг. Хоёулаа Track 2-ын баримтад ЭЗЭНГҮЙ ХЭВЭЭР (§3.4-ийн хүснэгт). ⚠️ **`verification_state` НЬ ЭНД БАЙХАА БОЛЬСОН** — түүнийг `0238`-ын 7 дахь statement (§3.1) үүсгэнэ | `grep -rn "identity_match\|learning_events ADD COLUMN" docs/bim-ai/2-*.md` → `identity_match` нь ЗӨВХӨН `2-0` §9-12 ба энэ файлд; `learning_events ADD COLUMN` нь `2-1:533/536` (`team_code`, `team_source`) БА энэ файлын 0238 (`verification_state`). **`pack_sha256` ба `identity_match` нь `2-1`-д харьяалагдана** — тэнд нэмэгдтэл дуудагч `packPublished`-ыг эзний ил шийдвэрээр ба `identityMatch = 'unknown'` (→ өнгөрнө) дамжуулна |
| 7 | ⚠️ **ТАМГАЛАГЧИЙН ГЭРЭЭ — `0238`-ын шинэ баганыг ХЭН бөглөх вэ.** Багана нь `payload_json`-ы проекц тул `2-3`-ын `RULE_VALIDATION` payload БА `2-4` §3.9-ийн эмиттерийн тамганы жагсаалт хоёулаа `verification_state`-ыг ЗААВАЛ бичих ЁСТОЙ (`team_code` / `team_source` / `team_confidence` / `attribution_id`-ийн ХАЖУУД). Бичихгүй бол багана NULL болж `HUMAN_VERIFIED` вердикт ХЭЗЭЭ Ч цөмд орохгүй — чимээгүй, аюулгүй тал руу унасан, гэхдээ БҮРЭН ИДЭВХГҮЙ | Вердикт урсаж эхэлсний дараа: `--command "SELECT COUNT(*) AS n FROM learning_events WHERE kind='RULE_VALIDATION' AND verification_state IS NOT NULL"` → **n > 0**. n = 0 бол тамгалагч бичихээ мартсан |

**Deploy дараалал (урвуулж БОЛОХГҮЙ):**

```
1. cd backend
   npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml
      → 0238, 0239, 0240
            │
            ▼   ⚠️ ШИНЭ БАГАНА НЬ ТҮҮНИЙГ УНШДАГ КОДООС ХАТУУ ӨМНӨХ DEPLOY-Д ГАРНА.
            │      Урвуулбал `POST /assistant/logs` нь `team_code` руу bind хийж,
            │      D1 «no such column» өгч БҮХ бүртгэлийн багц унана.
2. npx wrangler deploy --config wrangler.toml
      → trainingRelevance.ts, modelCapability.ts, insert lib-үүд, revit.ts, compliance.ts
            │
            ▼   ⚠️ Frontend нь `?team=` дамжуулна.  Worker түүнийг ойлгохоос
            │      ӨМНӨ нийлүүлбэл шүүлт чимээгүй ҮЛ ТООГДОНО (санамсаргүй
            │      биш — параметр үл мэдэгдэх тул сервер бүх багийг буцаана).
3. cd frontend && npm run verify
   npx -y wrangler@latest pages deploy dist --project-name mgl-design-system --branch main
            │
            ▼
4. (deploy БИШ) Эзний машин дээр:  "$PY" pull_and_retrain.py --offline   (§7-ийн venv интерпретатор)
      → шинэ тоологч гарч ирснийг ХАРНА, шүүлт ЧАНГАРААГҮЙ
```

**⚠️ `--config wrangler.toml` нь ЗААВАЛ** — репо язгуурт `wrangler.jsonc` нь өөр worker зарладаг ба wrangler-ийн тохиргоо олох механизм түүнийг сонгож болно. Бүх `pages` дэд командыг `npx -y wrangler@latest`-ээр — тогтоосон 4.83.0 нь `CLOUDFLARE_ACCOUNT_ID`-ыг `pages` дээр ЧИМЭЭГҮЙ ҮЛ ТООДОГ.

### ЗЭРЭГ ХИЙЖ БОЛОХ АЖИЛ (эзэн хурдыг хүссэн)

| Doc | Энэ доктой ЗЭРЭГ хийж болох уу | Яагаад |
|---|---|---|
| `2-1-team-context` | **ҮГҮЙ — ӨМНӨ** | `team_code` / `team_source`-ыг тодорхойлдог. Энэ док түүнийг ХЭРЭГЛЭНЭ |
| `2-2-rule-model` | **ҮГҮЙ — ӨМНӨ** | `rule_uid` ба `rule_test_cases` -гүйгээр §3.8 бичих зүйлгүй |
| `2-3-compliance-engine` | **ТИЙМ** | Файл давхцалгүй. Хоёулаа `2-1`/`2-2`-оос ХАМААРНА, бие биенээсээ ХАМААРАХГҮЙ |
| `2-4-nonblocking-runtime` | **ТИЙМ** | Файл давхцалгүй (0226–0228, `ChangeTracker.cs`, `BimEmitter.cs`). ⚠️ `2-4` нь `identity_match`-ыг **ӨГДӨГГҮЙ** — тэр талбар Track 2-т ЭЗЭНГҮЙ (§3.4). Энэ докийн `EligibilityInput` түүнийг ХЭРЭГЛЭНЭ ч эзэнгүй үед `'unknown'` дамжина, тэр нь блоклохгүй |
| `2-5-finding-surface` | **ХЭСЭГЧЛЭН** | Миграц зэрэг бичиж болно; §3.12-ийн ЦОНХНЫ ALLOWLIST-ыг ХОЁУЛАА иш татна тул текстийг тохируулна |
| `2-7-readiness-and-quality` | **ҮГҮЙ — ДАРАА** | `rule_test_cases`-ийн уншилтыг энэ док нээнэ (§3.8) |
| `2-8-install-and-health` | **ТИЙМ** | Add-in / суулгацын тал. Файл давхцалгүй |

**Хэрэгжүүлэлтийн долгион:** долгион 1 = `2-1`, `2-2`, `2-4`, `2-8` · долгион 2 = **`2-3`, `2-6` (энэ док)** · долгион 3 = `2-5`, `2-7`.

### Дараа нь юу ирэх вэ

| Хэрэглэгч | Юуг хэрэглэнэ |
|---|---|
| `2-7` | `rule_test_cases` → `gen-rule-golden.mjs` → худал эерэг / худал сөрөгийн метрик (v2 §66) |
| `2-3` | `team_rule_scope(team_code, mode)` → багц угсрах `WHERE mode IN ('own','shared')`. ⚠️ Мөргүй баг (MGMT · EZ · GT — ЭЗЭН БАТАЛСАН 2026-08-30, §2.12) дээр энэ асуулга ХООСОН багц буцаана; тэр нь ЗӨВ: нийцлийн шалгалт АЛГАСАГДАНА (`TEAM = UNCERTAIN` БИШ — сесс нь ЖИНХЭНЭ `team_code`-оороо үлдэнэ, §2.12), ӨӨР багийн дүрэм рүү унагаахгүй. Бодит мөр эхлээд **BA** дээр гарна |
| `2-2` (долгион 1-д нийлүүлэгдсэн) | `assertCapability('rule_eval', team, 2)` → `POST /compliance/rules/:uid/publish`-ийн 409, ба `GET /compliance/pack`-ийн `authority_level` шийдэл (§3.7-1). ⚠️ Тэр ХОЁР дуудлагыг ЭНЭ сесс нэмнэ — `2-2:1244` түүнийг ил шилжүүлсэн |
| Ирээдүйн загварын ажил | `model_capabilities.authority_level` → §80-ийн эрхийн шат. Схем нь 5 хүртэл, маршрут нь 2 хүртэл — LEVEL 3+ рүү гарах нь ШИНЭ шийдвэр |

---

## 6. ХҮЛЭЭН АВАХ ШАЛГУУР

### Миграц

- [ ] `ls backend/migrations | tail -5` → `0240_team_rule_scope.sql` хамгийн сүүлд
- [ ] Гурван файл тус бүр **≤ 7 өөрийн statement**: 0238 = **7** (тааз дээр), 0239 = 4, 0240 = 4
- [ ] Гурван файлд `/* */` блок тайлбар **ТЭГ**, мөр доторх нэмэлт `;` **ТЭГ**
- [ ] `migrations apply` → `d1_migrations`-д гурван мөр нэмэгдсэн
- [ ] `PRAGMA table_info(assistant_logs)` → `team_code` БАЙНА
- [ ] `PRAGMA table_info(assistant_examples)` → `team_code` БАЙНА
- [ ] `PRAGMA index_list(assistant_examples)` → `idx_assistant_ex_uniq` БАЙНА, ба `PRAGMA index_info` нь **ГУРВАН** багана харуулна
- [ ] `SELECT COUNT(*) FROM assistant_examples WHERE team_code IS NOT NULL` → **0** (backfill ЗОРИУД хийгээгүй)
- [ ] `PRAGMA table_info(learning_events)` → `verification_state` БАЙНА, ба `EVENT_BINDS` нь **23 ХЭВЭЭР** (VIRTUAL багана bind нэмэхгүй)
- [ ] `INSERT` -ийн ДАРАА: `SELECT verification_state FROM learning_events WHERE payload_json LIKE '%HUMAN_VERIFIED%' LIMIT 1` → `'HUMAN_VERIFIED'` (json_extract ажиллаж байна)
- [ ] Миграцийн ДАРАА ШУУД (POST хийхээс ӨМНӨ): `SELECT COUNT(*) FROM model_capabilities` → **0**, `SELECT COUNT(*) FROM team_rule_scope` → **0**
- [ ] `model_capabilities`-д `authority_level = 6` оруулах оролдлого → `CHECK constraint failed`
- [ ] `team_rule_scope`-д `mode = 'owner'` оруулах оролдлого → `CHECK constraint failed`
- [ ] Нэг `(rule_uid, team_code)` хосыг хоёр удаа оруулах → `UNIQUE constraint failed`

### Backend

- [ ] `cd backend && npx tsc --noEmit` → чиний файлууд дээр алдаа **ТЭГ**
- [ ] `node --test src/lib/trainingRelevance.test.ts` → **8/8** дамжина
- [ ] `node --test "src/**/*.test.ts"` → суурь 44/44-ээс ДООШ БУУГААГҮЙ
- [ ] `node scripts/check-bim-events.mjs` → ногоон
- [ ] `ASSISTANT_LOG_ROWS_PER_STATEMENT === 5` (18 bind-ийн ДАРАА) — тестээр эсвэл `node -e` -ээр
- [ ] `ASSISTANT_EXAMPLE_ROWS_PER_STATEMENT === 7` (14 bind-ийн ДАРАА)
- [ ] `Object.keys(TRAINING_RELEVANCE).length === LEARNING_EVENT_KINDS.length` → **16**
- [ ] `relevanceOf('RULE_VALIDATION', { verificationState: 'UNVERIFIED' })` → `'evaluation_only'`
- [ ] `relevanceOf('RULE_VALIDATION', { verificationState: 'HUMAN_VERIFIED' })` → `'core'`
- [ ] `relevanceOf('SESSION_START', …)` → `'never'`
- [ ] `GET /api/revit/assistant/pending?team=BA` → **200**, буцсан мөр бүр нь `team_code === 'BA'` ЭСВЭЛ `team_code === null`
- [ ] `GET /api/revit/assistant/pending?team=xx%3Bdrop` → **200** (regex татгалзсан ⇒ шүүлтгүй), SQL алдаа БАЙХГҮЙ
- [ ] `GET /api/revit/assistant/export` → мөр бүрд `team_code` талбар БАЙНА, `per_team` нэгтгэл БАЙНА
- [ ] `GET /api/revit/assistant/export` -ийн `count` нь энэ deploy-ийн ӨМНӨХ утгатай **ЯГ ИЖИЛ** (шүүлт ЧАНГАРААГҮЙ)
- [ ] `POST /api/compliance/rule-scope` `source_kind: 'company_practice'` + `practice_origin: null` → **400**
- [ ] `POST /api/compliance/rule-scope` `team_code: 'ZZZ'` (`teams`-д байхгүй) → **400**
- [ ] `POST /api/compliance/rule-scope` `team_code: 'MGMT'` → **201**. ⚠️ **АЛДАА БИШ** — валидац нь АМЬД `teams`-ээс шалгадаг, MGMT тэнд БАЙНА. «MGMT · EZ · GT багцгүй» (ЭЗЭН БАТАЛСАН 2026-08-30, §2.12) нь **бодлого**, DB CHECK БИШ; схемд хориг тавьбал баг нэмэх бүрд миграц шаардана (§3.3). Хамгаалалт нь админы сахилга + §3.3-ын тайлбар
- [ ] `worker` дүрийн токеноор `GET /api/compliance/rule-scope` → **403** (`workerScope` allowlist)

### `model_capabilities` — БҮТЭН ЭРГЭЛТ (§79-ийн бүртгэл нь БОДИТООР ажиллаж байгааг батлана)

- [ ] `node --test src/lib/modelCapability.test.ts` → **4/4** дамжина
- [ ] `POST /api/compliance/capabilities` `{ task: 'rule_eval', model_version: '2026-09-01.1', team_scope: 'BA', authority_level: 2, evaluation_status: 'approved', eval_run_json: <passed:true, blocked:[], model_version:'2026-09-01.1'> }` → **201**
- [ ] Дараа нь `GET /api/compliance/capabilities?task=rule_eval&team=BA` → мөр **1**, `authority_level = 2`
- [ ] `POST … { authority_level: 3 }` → **400** «MVP нь LEVEL 2-оор тасарна» (v2 §40-R4)
- [ ] `POST … { team_scope: 'ZZZ' }` (`teams`-д байхгүй) → **400**
- [ ] `POST … { evaluation_status: 'approved', eval_run_json: null }` → **400**
- [ ] `POST … { evaluation_status: 'approved', eval_run_json: <model_version: 'ӨӨР'> }` → **400** (гурав дахь нөхцөл: хувилбар ТУЛГАГДАНА)
- [ ] `PATCH /api/compliance/capabilities/:id { evaluation_status: 'revoked' }` → **200**, дараа нь `assertCapability('rule_eval','BA',2)` → `not_approved`
- [ ] ⚠️ **ХААЛГА БОДИТООР УНШИГДАЖ БАЙНА:** `model_capabilities` ХООСОН үед `POST /api/compliance/rules/BA-HR-CORRIDOR-W-001/publish` → **409**, `reason: 'no_row'`. Дээрх мөрийг үүсгэсний ДАРАА ижил дуудлага → **200**. ⚠️ Энэ ХОЁР мөр нь `2-2`-ын дөрвөн нөхцөлийг АЛЬ ХЭДИЙН давсан дүрэм дээр гүйнэ, эс бөгөөс 409-ийн шалтгаан нь `2-2`-ынх болно, энэ хаалганых БИШ
- [ ] `GET /api/compliance/pack?team=HD` (`model_capabilities`-д HD мөргүй) → **200**, `authority_level: 0` — алдаа БИШ

### Frontend

- [ ] `cd frontend && npm run verify` → ногоон
- [ ] `/app/admin/assistant?tab=pending` → багийн `Select` харагдана, сонголтууд `GET /api/teams`-ээс ирнэ
- [ ] Гараар: багийн жагсаалтад ХАТУУ бичсэн код байхгүй — `grep -n "'BA'" frontend/src/features/revit-assistant/` → **тэг мөр**
- [ ] Гараар: баг сонгоход URL-д `&team=BA` гарна, refresh хийхэд хадгалагдана
- [ ] Гараар: мөрийн картад багийн тэмдэглэгээ, `team_code === null` үед «компани даяар»

### Сургалтын гогцоо

- [ ] `revit-mcp/training`-аас `"$PY" pull_and_retrain.py --offline` (§7-ийн venv интерпретатор) → «итгэл:» ба «баг:» гэсэн ХОЁР ШИНЭ тоологч хэвлэгдэнэ
- [ ] `report.json`-ийн `examples` нь **2402** хэвээр (шүүлт чангараагүй)
- [ ] `grep -c "source_type" revit-mcp/training/pull_and_retrain.py` → **≥ 1** (өмнө нь 0)
- [ ] `node backend/scripts/gen-rule-golden.mjs --remote` (бичихгүй) → `verified = 1` мөрийн ТООГ хэвлэнэ. ⚠️ Мөр гарч ирэхэд эхний `team_code` нь **`BA`** байна — BA бол ЭЗЭН БАТАЛСАН (2026-08-30) эхний бүрэн багц (§3.8). Ганц түлхүүртэй `per_team` нь алдаа БИШ
- [ ] `rule_test_cases` хоосон үед `--write` → `eval/golden/rules.json`-ийн `rows` нь `[]` ХЭВЭЭР, `exit 0`
- [ ] `"$PY" revit-mcp/eval/run_golden.py --kind rules` → **exit 2**, «БЛОКЛОВ: rules» (ЭНЭ БОЛ ЗӨВ ХАРИУ)
- [ ] `"$PY" revit-mcp/eval/run_golden.py --kind intent` → **exit 0** (ухралт гараагүй)

### Хамрах хүрээ

- [ ] `git status --short` → зөвхөн §Хөндөх файлууд-д жагсаасан замууд
- [ ] `git diff --stat` → `backend/src/index.ts`, `lib/modules.ts`, `lib/workerScope.ts` дээр **өөрчлөлт БАЙХГҮЙ**
- [ ] `git diff --stat -- revit-mcp/addin/` → **хоосон** (энэ сесс C# ХӨНДӨХГҮЙ)
- [ ] ⚠️ Бүтэн build нь өөр агентын файл дээр унаж БОЛНО — алдаа чиний хөндсөн файлд байгаа эсэхийг ШАЛГА

---

## 7. ШАЛГАХ КОМАНД

⚠️ **ЭНЭ БЛОК НЬ НЭГ ДАРААЛСАН СЕСС** — `cd` нь ДАРААГИЙН командад ҮЛДДЭГ. Блок бүрийн эхэнд ажлын хавтас нь тайлбараар бичигдсэн; алгасаж гүйцэтгэвэл эхлээд репогийн язгуурт буц. Python нь `revit-mcp/server/.venv` дотор (`revit-mcp/training/` нь ӨӨРИЙН venv-гүй), тиймээс интерпретаторыг НЭГ хувьсагчид тавина.

```bash
# --- 1. ДУГААР АВАХ (бичихийн ӨМНӨ) ---   [cwd = репогийн язгуур]
ls backend/migrations | tail -5
# Хүлээгдэх: 0216_assistant_log_timing.sql хамгийн сүүлд.
# 0238-0240 аль хэдийн байвал ЗОГС — ах дүү сесс дугаар авсан байна.

# ⚠️ Интерпретаторыг ЭНД, язгуураас АБСОЛЮТ болгож тогтооно — доор `cd` хийсний
#    дараа ч хүчинтэй хэвээр.  Системийн `python` дээр sklearn БАЙХГҮЙ —
#    `pull_and_retrain.py` → `train_intent.py` түүнийг шаарддаг — ба
#    `revit-mcp/training/` нь ӨӨРИЙН venv-гүй.  POSIX venv дээр `Scripts`
#    нь `bin`, `python.exe` нь `python` болно.
PY="$PWD/revit-mcp/server/.venv/Scripts/python.exe"
"$PY" -c "import sys; print(sys.version)"
# Хүлээгдэх: хувилбар хэвлэгдэнэ.  Унавал `Scripts` → `bin`, `python.exe` → `python`.

cd backend && node --test src/lib/migrationSchema.test.ts
# Хүлээгдэх: pass.  0214/0215 хоёул `reviewed_at` нэмэх шахсаны дараа бий болсон.

# --- 2. МИГРАЦИЙН ТЭЭВРИЙН ДҮРЭМ (бичсэний ДАРАА) ---   [cwd = backend/]
for f in 0238_assistant_team_scope 0239_model_capabilities 0240_team_rule_scope; do
  n=$(grep -c ';' migrations/$f.sql)
  b=$(grep -c '/\*' migrations/$f.sql)
  echo "$f: statement=$n блок_тайлбар=$b"
done
# Хүлээгдэх:  0238: 7 0  ·  0239: 4 0  ·  0240: 4 0
# ⚠️ 0238 нь ТААЗ дээр (7/7).  8 гарвал ЗОГС — statement нэмэгдсэн байна.
# ⚠️ statement > 7 эсвэл блок_тайлбар > 0 бол ЗОГС — файл хагас хэрэгжинэ.

# --- 3. МИГРАЦ (deploy 1) ---   [cwd = backend/ хэвээр — ДАХИН `cd backend` ХИЙХГҮЙ]
npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 5"
# Хүлээгдэх: 0240, 0239, 0238 дээр гуравт нь.

npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT COUNT(*) AS n FROM pragma_table_info('assistant_examples') WHERE name='team_code'"
# Хүлээгдэх: n = 1

npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT COUNT(*) AS cols FROM pragma_index_info('idx_assistant_ex_uniq')"
# ӨМНӨ: cols = 2  (text, intent)
# ДАРАА: cols = 3  (text, intent, IFNULL(team_code,''))

npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT COUNT(*) AS scoped FROM assistant_examples WHERE team_code IS NOT NULL"
# Хүлээгдэх: scoped = 0.  ⚠️ Тэгээс ӨӨР бол хэн нэгэн backfill хийсэн — ТААМАГ өгөгдөл.

npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT COUNT(*) AS n FROM pragma_table_info('learning_events') WHERE name='verification_state'"
# Хүлээгдэх: n = 1.  ⚠️ Энэ бол §3.4-ийн `by_verification` салааны ЦОРЫН ГАНЦ
#            өгөгдлийн эх сурвалж — 0 бол `RULE_VALIDATION` мөнхөд evaluation_only.
# Хүлээгдэх: scoped = 0.  ⚠️ Тэгээс ӨӨР бол хэн нэгэн backfill хийсэн — ТААМАГ өгөгдөл.

# --- 4. BACKEND (deploy 2) ---   [cwd = backend/ хэвээр]
npx tsc --noEmit
node --test src/lib/trainingRelevance.test.ts
node --test src/lib/modelCapability.test.ts
node --test "src/**/*.test.ts"
node scripts/check-bim-events.mjs
node -e "const m=require('./src/lib/assistantLogInsert.ts');" 2>/dev/null || true
# Хүлээгдэх: tsc чиний файлууд дээр цэвэр; trainingRelevance 8/8; modelCapability 4/4; суурь 44/44.

npx wrangler deploy --config wrangler.toml

# --- 5. РОУТ (deploy 2-ын ДАРАА) ---   [cwd хамаарахгүй]
API=https://mgl-progress-api.<акк>.workers.dev
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOK" \
  "$API/api/revit/assistant/pending?team=BA"
# Хүлээгдэх: 200

curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOK" \
  "$API/api/revit/assistant/pending?team=xx%3Bdrop%20table"
# Хүлээгдэх: 200 (regex татгалзсан ⇒ шүүлт үл тоогдоно), 500 БИШ.

curl -s -H "Authorization: Bearer $TOK" "$API/api/revit/assistant/export" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('count',d['count']); print('per_team',d.get('per_team')); print('team_code талбар:', 'team_code' in (d['rows'][0] if d['rows'] else {}))"
# Хүлээгдэх: count нь deploy-ийн ӨМНӨХ утгатай ЯГ ИЖИЛ; per_team = {"(none)": <count>}

# --- 6. FRONTEND (deploy 3) ---   [cwd = backend/ → frontend/]
cd ../frontend && npm run verify
npx -y wrangler@latest pages deploy dist --project-name mgl-design-system --branch main
npx -y wrangler@latest pages deployment list --project-name mgl-design-system | head -3
# Хүлээгдэх: дээд мөр нь ЧИНИЙ commit.  ⚠️ «шинэ production deployment ялна» —
# амжилтын мессежэнд бүү итгэ, dist/index.html-ийн hash-ыг сайт дээрхтэй тулга.

grep -rn "'BA'\|\"BA\"" src/features/revit-assistant/ | wc -l
# Хүлээгдэх: 0 — багийн код ХАТУУ БИЧИГДЭЭГҮЙ.  [cwd = frontend/]

# --- 7. СУРГАЛТЫН ГОГЦОО (deploy БИШ, эзний машин) ---   [cwd = frontend/ → revit-mcp/training/]
cd ../revit-mcp/training
# ⚠️ `revit-mcp/training`-аас интерпретатор нь `../server/.venv/…` буюу `$PY`.
#    `../../server/…` нь репогийн язгуурт `server/` хайх ба ТЭР ХАВТАС БАЙХГҮЙ
#    (`1B-4` §7-д хэмжсэн: репогийн зарим docstring `..\..\server\…` гэж бичдэг
#    нь `training\` доторх ДЭД хавтаснаас бичигдсэн).
"$PY" pull_and_retrain.py --offline 2>&1 | grep -E "эх сурвалж|итгэл|баг"
# Хүлээгдэх гурван мөр:
#   эх сурвалж:  manual 45 · seed 2357
#   итгэл     :  AI_GENERATED 2357 · HUMAN 45
#   баг       :  (компани даяар) 2402

"$PY" ../eval/run_golden.py --kind rules; echo "exit=$?"
# Хүлээгдэх: exit=2, «❌ БЛОКЛОВ: rules».  ЭНЭ БОЛ ЗӨВ ХАРИУ, алдаа БИШ.

"$PY" ../eval/run_golden.py --kind intent; echo "exit=$?"
# Хүлээгдэх: exit=0 — санааны хуваарь ухраагүй.
# ⚠️ `run_golden.py` нь sklearn ХЭРЭГЛЭХГҮЙ (`dotnet run` -аар harness асаадаг),
#    гэхдээ ЭНЭ БЛОКИЙН БҮХ Python-ыг НЭГ интерпретатораар гүйлгэнэ —
#    Windows дээр нүцгэн `python` нь Store-ийн хоосон stub байж БОЛНО.

# --- 8. ХАМРАХ ХҮРЭЭНИЙ ХЯНАЛТ ---   [cwd = revit-mcp/training/ → репогийн язгуур]
cd ../..
git status --short
git diff --stat
# Зөвшөөрөгдсөн замууд ЗӨВХӨН:
#   backend/migrations/023{8,9}_*.sql  backend/migrations/0240_*.sql
#   backend/src/lib/trainingRelevance{,.test}.ts  backend/src/lib/modelCapability{,.test}.ts
#   backend/src/lib/assistantLogInsert.ts  backend/src/lib/assistantExampleInsert.ts
#   backend/src/routes/revit.ts  backend/src/routes/compliance.ts
#   backend/scripts/gen-rule-golden.mjs
#   revit-mcp/training/pull_and_retrain.py  revit-mcp/training/datasets.manifest.json
#   revit-mcp/eval/golden/rules.json  revit-mcp/eval/manifest.json
#   frontend/src/features/revit-assistant/AssistantCurationPage.tsx
#   frontend/src/features/revit-assistant/components/PendingTab.tsx
#   docs/bim-ai/2-6-team-training.md
# git add -A БҮҮ хэрэглэ — файл бүрийг НЭРЭЭР нь нэм.
```

---

## 8. ROLLBACK

### 8.1 Миграц хэрэгжихээс ӨМНӨ

Файлыг устгаад дуусна. **Өгөгдлийн эрсдэл: ТЭГ.**

### 8.2 Миграц хэрэгжсэний ДАРАА

**⚠️ ШИНЭ ДУГААР ЗААВАЛ** — хэрэгжсэн файлыг засах нь продакшн дээр **ЧИМЭЭГҮЙ NO-OP**.

| Юу | Хэрхэн буцаах |
|---|---|
| `assistant_logs.team_code` / `assistant_examples.team_code` | **БҮҮ ХАЯ.** `DROP COLUMN` нь `idx_assistant_ex_team` / `idx_assistant_logs_team` -ийг эхлээд хаяхыг шаардана, ба SQLite-ийн `DROP COLUMN` нь эдгээр хүснэгтэд эрсдэлтэй. NULL багана нь ямар ч уншигчийг эвдэхгүй — **ҮЛДЭЭ** |
| `idx_assistant_ex_uniq` (гурвалсан) | ШИНЭ миграц: `DROP INDEX` + `CREATE UNIQUE INDEX … ON assistant_examples(text, intent)`. ⚠️ **`team_code IS NOT NULL` мөр байвал энэ УНАНА** (`UNIQUE constraint failed`). Эхлээд `SELECT COUNT(*) … WHERE team_code IS NOT NULL` шалга |
| `learning_events.verification_state` (VIRTUAL) | **БҮҮ ХАЯ.** GENERATED VIRTUAL багана нь хадгалалт эзэлдэггүй, bind нэмдэггүй, ба `payload_json`-д талбар байхгүй үед NULL буцаана — ямар ч уншигчийг эвдэхгүй. Индексгүй тул `2-1` §8-ийн «индекслэгдсэн GENERATED баганыг шууд DROP хийж болохгүй» асуудал ЭНД БАЙХГҮЙ, гэхдээ ХЭРЭГГҮЙ эрсдэл — **ҮЛДЭЭ** |
| `model_capabilities` | ⚠️ **ЭХЛЭЭД worker-ыг буцаа, ДАРАА нь хүснэгтийг ХАЯ.** `POST /rules/:uid/publish` нь `assertCapability`-аар түүнийг УНШДАГ (§3.7-1) — хүснэгтийг эхэлж хаявал тэр маршрут `no such table` өгч, дүрэм нийтлэх бүхэлдээ 500 болно. Дараалал: `wrangler deploy` (өмнөх commit, дуудлага АЛГА) → ШИНЭ миграц `DROP TABLE IF EXISTS model_capabilities`. Хүүхэдгүй, каскадгүй |
| `team_rule_scope` | Мөн адил. ⚠️ ГЭХДЭЭ `2-3` нь багц угсрахдаа түүнийг уншиж эхэлсэн бол багц ХООСРОНО — эхлээд `2-3`-ыг буцаа |
| Worker | `npx wrangler deploy --config wrangler.toml` өмнөх commit-оос |
| Pages | Өмнөх commit-оос **дахин build хийж deploy** хийнэ. ⚠️ Dashboard-ийн rollback биш — «шинэ production deployment ялна» |
| `pull_and_retrain.py` | `git checkout <prev> -- revit-mcp/training/pull_and_retrain.py`. Дараагийн `--offline` гүйлт нь `production.json`-ыг ХУУЧИН хэлбэрээр дахин бичнэ |

**Өгөгдлийн эрсдэл: ТЭГ.** Гурван миграц бүгд ЦЭВЭР НЭМЭЛТ: хоёр nullable ALTER, нэг GENERATED VIRTUAL ALTER, хоёр шинэ хүснэгт, нэг индексийн солилт. Мөр УСТГАХ, backfill ХИЙХ, хүснэгт ДАХИН БАРИХ ЮУ Ч БАЙХГҮЙ.

**Кэшийн үлдэгдэл.** `withEdgeCache` нь эдгээр роутын алинд ч хэрэглэгддэггүй. Frontend талд TanStack Query кэш нь хуудас refresh хийхэд арилна.

**Rollback-ийн шалгуур.** Дараах шинж тэмдгийн АЛЬ НЭГ гарвал буцаа: (1) `POST /assistant/logs` нь 500 өгч эхэлсэн — `team_code` багана deploy-ийн дараалал буруугаас байхгүй байж болно; (2) `GET /assistant/export`-ийн `count` унасан — шүүлт санамсаргүй чангарсан, дараагийн загварын нарийвчлал ЧИМЭЭГҮЙ унана; (3) курацийн дараалал ХООСОН харагдах — багийн шүүлт `team_code IS NULL` мөрийг санамсаргүй хассан; (4) `run_golden.py --kind intent` нь ухралт мэдээлсэн.

---

## 9. ЭХЛЭХИЙН ӨМНӨ ТОДРУУЛАХ

Эдгээрийг репогоос ХАРИУЛАХ БОЛОМЖГҮЙ — эзэн эсвэл продакшны асуулга шаардана.

> **✅ ЭЗЭН БАТАЛСАН 2026-08-30 — хоёр асуулт ХААГДСАН, ДАХИН АСУУХГҮЙ.**
> **(1) Бүртгэл = найман салбарын баг:** BA · BB · HAS · TSBU · TSAH · HD · AU · IZ (`teams.sort_order`-ын дараалал). MGMT · EZ · GT нь `teams`-д үлдэнэ ГЭВЧ дүрмийн багц, нийцлийн шалгалт АВАХГҮЙ (§2.12, v2 §46).
> **(2) Эхний бүрэн багц = BA (Барилга архитектур)**, ба тэр нь үлдсэн долоогийн бүтцийн загвар. IZ хоёрдугаарт, гэхдээ БНбД суурьгүй тул ШИНЭЭР зохиогдоно (§3.8).
> Хаагдаагүй нь: **баг тус бүрийн ГИШҮҮДИЙН ТОО** (доорх асуулт 2) — продакшны D1 энэ машинаас ХҮРЭХГҮЙ ХЭВЭЭР (Cloudflare **7403 not authorized**).

### 9.1 Техникийн — прод/алсын D1 дээр л шалгагдана

| # | Асуулт | Яагаад чухал | Хэрхэн олох |
|---|---|---|---|
| 1 | ~~**Амьд `teams` бүртгэл юу вэ?**~~ **✅ ХААГДСАН — ЭЗЭН БАТАЛСАН 2026-08-30: салбарын баг НАЙМ** (BA · BB · HAS · TSBU · TSAH · HD · AU · IZ), MGMT · EZ · GT нь багцгүй (§2.12). Диск дээрх `teams` нь арван нэг мөртэй ХЭВЭЭР — найм нь ТӨЛӨВЛӨЛТИЙН тоо | `team_rule_scope`-ийн мөр (§3.3), `model_capabilities.team_scope` (§3.2), ба дүрмийн багц бичих ХӨТӨЛБӨР эндээс ургана. ⚠️ v2 §69-ийн «Team checks: n/n» нь **төсөл дээр БОДИТООР байгаа, БАГЦТАЙ** багийг тоолно — найм гэсэн литерал БИШ, багцгүй баг тоологч/хуваарь ХОЁУЛАНД нь орохгүй. Тоог ХАТУУ БИЧИХГҮЙ | Хэрэгжүүлэхийн ӨМНӨ баталгаажуулах (заавал биш, шийдвэр аль хэдийн байна): `--command "SELECT code, name_mn, sort_order FROM teams ORDER BY sort_order"` |
| 2 | **Багийн үндсэн гишүүнчлэлийн тархалт?** | `assistant_logs.team_code`-ыг `user_teams WHERE is_primary = 1` -ээс ургуулна. HD/AU-д ганц хүн байвал тэр багийн корпус нь НЭГ ХҮНИЙ зуршил болно — өөрийг нь БУС хэнд ч харуулах нь өөрийгөө-л-харах хамгаалалтыг зөрчинө | `--command "SELECT t.code, COUNT(*) n FROM user_teams ut JOIN teams t ON t.id=ut.team_id JOIN users u ON u.id=ut.user_id WHERE u.status='active' AND ut.is_primary=1 GROUP BY t.code ORDER BY n DESC"` |
| 3 | **0212–0216 продакшн дээр ХЭРЭГЖСЭН үү?** | Эс бөгөөс add-in аль хэдийн БАЙХГҮЙ багана руу `addin_version`/`timing_json` бичиж байна, ба энэ сессийн `source_type` дамжуулалт хоосон буцаана | `--command "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 20"` |
| 4 | **`assistant_examples`-ийн `source_type` тархалт бодитоор юу вэ?** | §2.1-2.2 нь бүтцээр нотолсон (`HUMAN_VERIFIED = RULE_VERIFIED = HUMAN_CORRECTED = 0`), гэвч курацийн UI 2026-08-28-нд нийлүүлэгдсэн — сүүлийн хоёр хоногт кураци гүйсэн бол тоо тэгээс дээш байж БОЛНО | `--command "SELECT source_type, review_state, COUNT(*) n FROM assistant_examples GROUP BY 1,2 ORDER BY n DESC"` |

### 9.2 Хэмжигдээгүй — хэн ч тоолоогүй

| # | Асуулт | Яагаад чухал |
|---|---|---|
| 5 | **Кураци ГҮЙХ ҮҮ, ямар хэмнэлээр?** Өнөөдөр `production.json` БАЙХГҮЙ — татах алхам ХЭЗЭЭ Ч гүйгээгүй | Багаар салгасан сургалт нь ТЭГЭЭС эхэлнэ. Долоо хоногт 20 мөр бол багт жилд ~130 — нэг ч багт хүрэлцэхгүй. Хэмнэлийг мэдэхгүй бол «BA-гийн загвар хэзээ бэлэн болох вэ» гэдэгт хариулах БОЛОМЖГҮЙ |
| 6 | **Багт хэдэн мөр байвал багаар салгах нь утга учиртай вэ?** | `train_intent.py:307` нь 25-аас доош санааг ⚠️ гэж тэмдэглэдэг, `:309-311` нь тэг санаа дээр ХАТУУ УНАНА. Багийн доод босго ТОДОРХОЙЛООГҮЙ. Санал: багт ≥ 200 баталгаажсан мөр ба санаа тус бүрд ≥ 25 |

### 9.3 Эзний шийдвэр — инженерийн биш

| # | Асуулт | Юуг өөрчлөх вэ |
|---|---|---|
| 7 | **Сургалтын цөмийн бодлогын хаалгыг ХЭЗЭЭ асаах вэ?** Энэ сесс зөвхөн ХЭМЖДЭГ (§3.9). `0215:9-11`-ийн `policy_allows(source_type) AND review_state IN ('reviewed','verified')`-ыг ОДОО асаавал корпус ТЭГ болж, сургалт `SystemExit` өгнө | Хаалга асаах огноо. Санал: `source_type IN ('HUMAN','HUMAN_VERIFIED','HUMAN_CORRECTED','RULE_VERIFIED')` -ын нийлбэр 500 мөрөөс давсны дараа |
| 8 | **Багаар салгасан ЗАГВАРЫН ЖИН хэзээ нэгэн цагт хэрэгтэй юу?** Бид retrieval scope + rule scope сонгосон (§2.5, v2 §50-R3 зөвшөөрдөг) | «Тийм» бол `idx_assistant_model_active` -ыг хаях + add-in-ыг ДАХИН БАРЬЖ ~20 PC дээр суулгах шаардлагатай. Энэ нь `2-8`-ын хувилбарт багтах ёстой; хойшлуулбал ХОЁР ДАХЬ 20-PC-ийн ажиллагаа гарна |
| 9 | ~~**MGMT, EZ, GT багт дүрмийн багц олгох уу?**~~ **✅ ХААГДСАН — ЭЗЭН БАТАЛСАН 2026-08-30: ҮГҮЙ.** MGMT нь дизайны салбар БИШ; EZ / GT нь төсөл тохируулах блокийн угтаг (`0074_seed_ez_gt_teams.sql:12-14`) | `team_rule_scope` (§3.3) ба `model_capabilities` (§3.2) -д тэдний мөр ХЭЗЭЭ Ч үүсэхгүй; тэдгээр сессид нийцлийн шалгалт АЛГАСАГДАНА, ЮУТАЙ Ч тулгагдахгүй — ӨӨР БАГИЙН дүрэм рүү унагаах зам БАЙХГҮЙ. ⚠️ Энэ нь `TEAM = UNCERTAIN` БИШ (§2.12): илрүүлэлт АМЖИЛТТАЙ болсон тул мөр нь цуглагдаж, ЖИНХЭНЭ `team_code`-оор тамгалагдаж, курацид харагдсаар байна — зөвхөн ДҮРМИЙН сургалтын дохио болохгүй (§3.4). **Кодын өөрчлөлт ШААРДЛАГАГҮЙ** — хоёр хүснэгт хоёулаа хаалттай-өгөгдмөл |
| 10 | **Курацийн багийн шүүлт нь ЗӨВЛӨМЖ үү, АЛБАДЛАГА уу?** Одоо: `?team=` нь СОНГОЛТ, шүүлтгүй бол бүх багийн мөр харагдана | «Албадлага» бол admin бус senior-ыг өөрийн багаар ХАТУУ хязгаарлана — тэр нь `isManager`-ын одоогийн зан төлөвийг ӨӨРЧИЛНӨ (шипсэн гадаргуу). Тусдаа шийдвэр |
| 11 | **Компанийн дадлыг (`source_kind = 'company_practice'`) хэн батлах вэ?** `bb/template.ts:173`-ын «МАКС ӨРГӨӨ хурлын зөвлөмж» гэх мэт | `practice_origin`-д ЮУ бичих вэ — хурлын огноо, протоколын дугаар, эсвэл чөлөөт текст үү? AI хурлын тэмдэглэлийг БНбД гэж иш татах нь ХАРИУЦЛАГЫН асуудал (§2.11) |
| 12 | **Ажилтны мэдэгдэл / гэрээ ШИНЭЧЛЭГДСЭН ҮҮ?** Commit `9fe82a0` нь 0195-ын «геометр, файлын агуулга цуглуулахгүй» амлалт ЦУЦЛАГДСАН гэж бичсэн ба «Ажилтны мэдэгдэл, гэрээ ЗААВАЛ шинэчлэгдэнэ» гэсэн. `bim.capture.notice_version` нь ИРЭЭДҮЙН огноонд суулгагдсан | Энэ сесс нь мөрд БАГИЙН харьяаллыг нэмнэ — «энэ өгүүлбэрийг BA-гийн инженер бичсэн». Мэдэгдэл шинэчлэгдээгүй бол цуглуулгын хамрах хүрээ гэрээнээс ГАДУУР |
| 13 | **`model_capabilities`-ийн мөрийг ХЭН, ЯМАР баримт дээр батлах вэ?** §3.7-ийн валидац 3 нь `evaluation_status = 'approved'`-ыг golden гүйлтийн ГУРВАН нөхцөлтэй тулгадаг, гэвч `eval/golden/rules.json` нь ХООСОН ба `run_golden.py --kind rules` нь exit 2 өгдөг (§2.8). Тиймээс `task = 'rule_eval'` дээр батлагдсан мөр өнөөдөр **ҮҮСЭХ БОЛОМЖГҮЙ** | Хэрэв эзэн дүрмийн багцыг golden мөргүйгээр нийтлүүлэхийг хүсвэл ЭНЭ Л газарт ил хөнгөлөлт хэрэгтэй (ж: `task = 'rule_eval'` дээр LEVEL 0-ыг golden-гүйгээр зөвшөөрөх). Чимээгүй тойрох зам БАЙХГҮЙ — `assertCapability` нь `no_row` дээр ТАТГАЛЗАНА |
| 14 | **`authority_level` LEVEL 3+ рүү хэзээ гарах вэ?** Схем нь 5 хүртэл (v2 §80), маршрут нь өнөөдөр 2 хүртэл (v2 §40-R4) | LEVEL 3 (PREVIEW) нь загварын гаралтыг Revit дотор ХАРУУЛАХ гэсэн үг — тэр нь `2-5` §2.11-ийн дөрвөн шалтгааныг (үүнд «алсаас буцаах зам байхгүй») дахин нээнэ. Шинэ шийдвэр, энэ сессийн хамрах хүрээнээс ГАДУУР |

### Хавсралт — ЭНЭ СЕССЭД ХАРИУЛАГДААГҮЙ, ТААМАГ гэж тэмдэглэсэн зүйлс

| Мэдэгдэл | Яагаад ТААМАГ вэ |
|---|---|
| «`HUMAN_VERIFIED` / `RULE_VERIFIED` / `HUMAN_CORRECTED` = 0 мөр» | БҮТЦЭЭР нотлогдсон (`0215:97-104`-ийн backfill тэднийг ХЭЗЭЭ Ч оноохгүй, ба тэднийг бичих ЦОРЫН ГАНЦ зам болох `deriveSourceType`-ийн дуудагч 2026-08-28-нд шипсэн). Продакшны тоо БАТАЛГААЖААГҮЙ — §9.1-4 |
| «Баг тус бүрийн ГИШҮҮДИЙН ТОО» | Продакшн D1 руу ХҮРЭХГҮЙ БАЙВ (Cloudflare 7403), `user_teams` асуулга гүйгээгүй — §9.1-2 НЭЭЛТТЭЙ. ⚠️ **Бүртгэл өөрөө ТААМАГ БИШ БОЛСОН**: эзэн 2026-08-30-нд найман салбарын багийг баталсан (§2.12), тэр нь шипсэн `IMPLEMENTED_TEAMS`-тэй таарна; диск дээрх `teams` нь арван нэг мөртэй ХЭВЭЭР ба гурав нь багцгүй |
| «0212–0216 хэрэгжсэн» | БАТАЛГААЖААГҮЙ. Диск дээр файл байгаа; продакшны `d1_migrations` шалгагдаагүй |
| «Курацийн UI-г 2026-08-28-аас хойш ашигласан эсэх» | БАТАЛГААЖААГҮЙ. Хуудас commit `6a8e4f5`-д нийлүүлэгдсэн |
| «`revit-mcp/eval/last_run.json`-ийн одоогийн төлөв» | Уншаагүй. `run_golden.py --kind intent` -ийн exit кодыг §7-д ШАЛГУУР болгосон |
