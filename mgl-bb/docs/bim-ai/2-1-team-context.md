# 2-1-team-context — багийн контекст, автомат бөгөөд буцаагдах багийн илрүүлэлт

> **Track:** 2 · TEAM-SCOPED COMPLIANCE (суурь 1 — бүх дүрэм, олдвор, сургалт үүн дээр түшинэ)
> **v2 хэсэг:** §46 (олон багийн оюун), §47 (мэдлэгийн дөрвөн хамрах хүрээ), §48 (автомат илрүүлэлт), §49 (багийн зан төлөв — сонголтын түлхүүр), §60 (салбар хоорондын харилцан үйлдэл — багийн тал), §72 (хэрэглэгч/баг/төсөл нь нэгдүгээр зэргийн өгөгдөл), §73 (буцаагдах илрүүлэлт); §83-ын суурь **2** (team-aware context) ба **11** (team/company/project isolation)
> **Хамаарал (depends on):** `2-0-OWNER-BRIEF` — R3…R6-ийн тайлал ба хүлээн авах бүртгэл. Схемийн түвшинд 2-2 … 2-8-аас ХАМААРАХГҮЙ.
> **Блоклож буй (blocks):** `2-2-rule-model` (дүрмийн багц `team_code`-оор түлхүүрлэгдэнэ), `2-3-compliance-engine` (`compliance_findings.owner_team_code`), `2-6-team-training` (сургалтын мөр бүр багаар шошголно), `2-7-readiness-and-quality` (§60 салбар хоорондын олдвор). Эдгээрийн АЛЬ Ч НЬ энэ файлгүйгээр эхэлж чадахгүй — `team_code` гэдэг үг тэдэнд оршин байхгүй.
> **Хөндөх файлууд:** `backend/migrations/0217_bim_session_team.sql` (ШИНЭ), `backend/migrations/0218_team_attributions.sql` (ШИНЭ), `backend/migrations/0219_learning_events_team.sql` (ШИНЭ), `backend/src/lib/teamContext.ts` (ШИНЭ), `backend/src/lib/teamContext.test.ts` (ШИНЭ), `backend/src/lib/bimEvents.ts`, `backend/src/routes/revit.ts`, `revit-mcp/addin/TeamContext.cs` (ШИНЭ), `revit-mcp/addin/RevitApi.cs`, `revit-mcp/addin/QtoDtos.cs`, `revit-mcp/addin/AssistantPane.xaml`, `revit-mcp/addin/AssistantPane.xaml.cs`, `revit-mcp/addin/App.cs`, `revit-mcp/training/check_team_context.py` (ШИНЭ). **ӨӨР ФАЙЛ БАЙХГҮЙ.**
> **ЭЗЭН БАТАЛСАН (2026-08-30):** салбарын баг нь **НАЙМ** — BA · BB · HAS · TSBU · TSAH · HD · AU · IZ; `MGMT`, `EZ`, `GT` гурав нь дүрмийн багц АВАХГҮЙ (§2.17, v2 §46). Эхний бүрэн багц нь **BA**, IZ нь хоёрдугаарт. Найм нь ТӨЛӨВЛӨЛТИЙН тоо — ростер ажиллах үед `teams.code`-оос уншигдана.
> **Deploy тоо:** 2 — (1) `d1 migrations apply` 0217→0218→0219, (2) `wrangler deploy`. ЯГ ЭНЭ ДАРААЛЛААР. Add-in (C#) нь **НЭГ РЕЛИЗИЙН** нэг хэсэг — энэ сессид тусад нь **ТАРААХГҮЙ**. Frontend deploy **ШААРДЛАГАГҮЙ**.

---

## 0. ЭНЭ СЕССИЙН ДҮРЭМ

**Хамрах хүрээ (scope).** Багийн контекстийг СЕРВЕР шийдэж, add-in түүнийг кэшлэнэ. Энэ сессид дүрэм, олдвол, сургалт, норм — юу ч хийхгүй. Дээрх 14 файлаас гадуур нэг ч мөр бүү өөрчил.

**Бусад агентуудтай зэрэг ажиллаж байна.** Ажлын мод дээр өөр агентын дуусаагүй, магадгүй **хөрвөхгүй** өөрчлөлт байж болно. `npm run build` унасан нь автоматаар чинийх БИШ — алдаа чиний хөндөөгүй файлд байвал эзэнд хэлж, түүнийг бүү зас. `git restore` / `git checkout --` / `git stash` / `git reset` / `git add -A` — **ХЭЗЭЭ Ч**.

**Deploy хийж болох уу?** Болно, гэхдээ ЯГ хоёр удаа, ЯГ дээрх дарааллаар. Миграциас ӨМНӨ worker deploy хийвэл `bim_sessions.team_code` уншдаг код байхгүй багана руу хандаж, ажилтны сесс бүр 500 өгнө.

**ЭНЭ СЕССИД ХЭЗЭЭ Ч ХИЙЖ БОЛОХГҮЙ:**

| ⛔ | Дүрэм | Яагаад — бодит үр дагавар |
|---|---|---|
| 1 | `/api/*` дээр `purpose === 'mcp'` токеныг **ХЭЗЭЭ Ч** татгалзуулахгүй | Add-in бүх REST дуудлагаа 365 хоногийн mcp токеноор гарын үсэг зурдаг, refresh урсгал БАЙХГҮЙ. Энэ бол алсаас сэргээх боломжгүй ЦОРЫН ГАНЦ өөрчлөлт: ~20 PC, `Install.bat`, Revit хаалттай. Тогтоол `middleware/auth.ts:101-102`, `types.ts:209-212`, `lib/tokenValidity.ts:30-34`. Энэ сессийн шинэ гарц бүр **/api/revit** дор сууна — тэр router аль хэдийн mcp токеныг хүлээж авдаг. |
| 2 | `users` (19 каскад хүүхэд) эсвэл `projects` (33) -ыг `wrangler d1 migrations apply`-аар **ДАХИН БҮТЭЭХГҮЙ** | `migrations apply` файл бүрийг гүйлгээнд ороодог ба тэнд каскад АЖИЛЛАДАГ. Эцгийг DROP хийвэл хүүхэд мөр бүр устана. Энэ сесс тэр хоёрыг ХӨНДӨХГҮЙ — `team_attributions` дээр `REFERENCES` **байхгүй**. |
| 3 | Миграци нь **зөвхөн нэмэгддэг**. Бичихийн өмнө `ls backend/migrations \| tail -5` | Хэрэгжсэн файлыг засах нь продакшн дээр **ЧИМЭЭГҮЙ NO-OP**. Ах дүү агентууд дугаараа зэрэг авч байна; репо аль хэдийн 6 давхардсан дугаартай (0002, 0060, 0080, 0110, 0120, 0121). |
| 4 | Триггер доторх `END;` нь **ТОМ ҮСГЭЭР, ӨӨРИЙН МӨРӨНД** | wrangler-ийн задлагчийн regex нь том/жижиг үсэгт мэдрэг. Буруу бол файл ХАГАС хэрэгжиж, `d1_migrations` мөр БИЧИГДЭХГҮЙ — цорын ганц хууль ёсны засвар нь ШИНЭ ДУГААР. |
| 5 | Инференс **ХЭЗЭЭ Ч** итгэмжит зам дээр биш | `RevitToolEventHandler.Execute` (⛔ гэрээ `RevitToolBus.cs:442-454`), `ChangeTracker.OnDocumentChanged` (⛔ гэрээ `ChangeTracker.cs:764-775`). Энэ сесс инференс ОГТ нэмэхгүй — багийн шат нь детерминист SQL. |
| 6 | `DocumentChanged` дотор баримт нь **УНШИХ ЗОРИУЛАЛТТАЙ**: transaction алга, `Regenerate()` алга, **дискний бичилт алга**, сүлжээ алга | Түүнийг сольсон сканнер бодит төсөл дээр 120+ секунд болдог байв. Багийн илрүүлэлтийн НЭГ Ч мөр тэр хандлагч дотор орохгүй. |
| 7 | `ChangeTracker.Gate`-ийг арын thread-ээс **АВАХГҮЙ** | `OnDocumentChanged` нь гүйлгээ бүрт Revit-ийн ҮНДСЭН thread дээр `lock (Gate)` авдаг (`ChangeTracker.cs:798`). Арын thread түүнийг HTTP хүлээж байхдаа барих нь хэрэглэгчийн дараагийн хулганы чирэлтийг бүтэн timeout-ийн турш зогсооно. |
| 8 | `DockablePane.Show()` / `Focus()`-ийг **ХЭЗЭЭ Ч** дуудахгүй | Add-in дахь ЦОРЫН ГАНЦ `Show()` нь хэрэглэгчийн өөрийнх нь ribbon команд (`AssistantPaneProvider.cs:54`). Автоматаар нээх нь файл нээх бүрт ~300 px ба фокусыг булаана — R7-ийн хамгийн магадлалтай эвдрэл. |
| 9 | `SetBusy`-г арын ажилд **ХЭРЭГЛЭХГҮЙ** | `AssistantPane.xaml.cs:351` нь `Mouse.OverrideCursor`-ыг тавьдаг — тэр нь WPF-д **АППЛИКЕЙШН ДАМЖСАН**. Юу ч блоклоогүй байхад Revit бүхэлдээ «завгүй» курсор харуулна. |
| 10 | `Gate` барьж байж `Dispatcher.Invoke` **ХИЙХГҮЙ** | UI thread өөрөө `lock (Gate)`-д блоклогдож болно; түгжээ барьсан thread-ээс түүн рүү marshalling хийх нь хоёр thread-ийн deadlock — хэрэглэгчид Revit «өлгөгдсөн» мэт харагдана. |
| 11 | Салбарын багцыг **ӨГӨГДЛӨӨС** ав — 8, 9, 11 гэж хатуу бичихгүй | **ЭЗЭН БАТАЛСАН (2026-08-30):** салбарын баг **НАЙМ** — BA · BB · HAS · TSBU · TSAH · HD · AU · IZ (v2 §46). Гэвч `teams` хүснэгт **11** мөртэй хэвээр: `0007_teams.sql:39-47` ес мөр (найм + `MGMT`), `0074_seed_ez_gt_teams.sql:12-14` нь `EZ` + `GT` нэмнэ. Найм гэдэг нь **ТӨЛӨВЛӨЛТИЙН** тоо (хэдэн дүрмийн багц зохиох вэ), кодод шалгах ЛИТЕРАЛ БИШ — ростер ажиллах үед `teams.code`-оос уншигдана (§2.17). |
| 12 | Өөр агентын хадгалаагүй ажлыг **ХӨНДӨХГҮЙ** | Дээрх 14 файл л чинийх. |

---

## 1. КОНТЕКСТ

### Систем (хүйтэн сессид хангалттай хэмжээгээр)

| Хэсэг | Юу вэ |
|---|---|
| `backend/` | Cloudflare Worker. Default export нь `@cloudflare/workers-oauth-provider`, Hono нь түүний `defaultHandler`. D1 + R2 + KV + нэг Durable Object + Workers AI. |
| `frontend/` | Vite + React 19 SPA, Pages төсөл `mgl-design-system`. **ЭНЭ СЕССИД ХӨНДӨХГҮЙ.** |
| `revit-mcp/addin/` | Revit 2024–2027 C#/WPF add-in, **46 `.cs` файл**, **ТЭГ тест**, ~20 ажилтны PC дээр, **auto-update БАЙХГҮЙ**. Тарааx = `Install.bat` × 20, Revit хаалттай. |
| BIM үйл явдлын сан | Миграци 0201–0210: `bim_artifacts`, `bim_sessions`, `revit_transactions`, `revit_element_touches`, `learning_events` + 8 append-only триггер + 9 GENERATED VIRTUAL багана. Ганц бичигч нь `backend/src/lib/bimEvents.ts`. |
| Багийн хэмжээс | `teams` (0007) + `user_teams` (0052, `is_primary` тугтай олон-олон) + `blocks.team_id` (0057) + `project_team_shares` (0042). |

### Платформын хатуу хязгаарууд (энэ даалгаварт хамаарах хэсэг)

- **D1-ийн 100 bind-ийн тааз.** `bimEvents.ts:327` дахь `rowsPerStatement(binds) = floor(100 / (binds + 1))` — нэг баганы зориудын нөөцтэй. Багана нэмэх бүрт нэг statement-д багтах мөрийн тоо буурч, ingest-ийн хүчин чадал шууд буурна.
- **0206-ын триггерүүд.** Дөрвөн хүснэгт (`bim_artifacts`, `revit_transactions`, `revit_element_touches`, `learning_events`) дээр UPDATE нь ABORT. Тэдэнд нэмсэн багана нь **ХЭЗЭЭ Ч ард нь дүүргэгдэхгүй**.
- **Тээврийн дүрэм.** `migrations apply` файлыг `d1_migrations`-ийн INSERT-тэй залгаж НЭГ `--command` болгодог; задлагч нь блок тайлбарыг ойлгодоггүй, мөрөн доторх `;`-ээр хуваадаг, олон statement-д унадаг (`0209_bim_generated_indexes.sql:6-13`). Энэ Track-д **файл бүр ≤ 7 өөрийн statement**, statement бүр `IF NOT EXISTS` / `INSERT OR IGNORE`.
- **JWT-д баг БАЙХГҮЙ.** `signToken` нь `{sub, role}` л зөөнө; баг бүр хүсэлтэд DB-ээс шийдэгдэнэ.

### Яагаад энэ даалгавар байна вэ

1. **BIM давхаргад баг гэдэг ойлголт ОГТ байхгүй.** `grep -ci team` нь 0200–0216-ийн **арван долоон файл тус бүр дээр 0** буцаана (§2.1-ийн хэмжилт).
2. **Add-in-д ч байхгүй.** 46 `.cs` файлын аль ч нэгэнд `team` гэсэн тэмдэгт мөр байхгүй (§2.2).
3. **`revit_documents.team_code` нь 0187:30-д зарлагдсан боловч БИЧИГЧГҮЙ** — handshake-ийн INSERT баганын жагсаалтад байхгүй (§2.3).
4. **Аль хэдийн бэлэн байгаа гинжийг хэн ч холбоогүй.** `/context`-ийн таван хүснэгтийн JOIN нь `blocks b` хүртэл ЯВЧИХСАН (`revit.ts:807-812`) — `b.team_id` + `teams` нэмэх нь хоёр баганын өөрчлөлт (§2.4).
5. **`/auth/me` нь баг + бүх харьяаллыг аль хэдийн буцаадаг** (`auth.ts:117-145`), гэвч add-in нэвтрэхдээ `role`-оос бусдыг бүгдийг хаядаг — `LoginUser`-д НЭГ property (§2.5).
6. **Хоёрдогч харьяаллаар шүүх нь продакшн дээр батлагдсан гэмтэл**: БА-гийн бүх гишүүн IZ ба EZ-д хоёрдогчоор бүртгэлтэй, 42 мөрийн оронд 242 гарсан (§2.6). Энэ бол R5-ийн эвдрэлийн бодит хэлбэр.
7. **`foldText` давхар үсгийг хураадаг** тул `codePrefix('ББ-01') === 'b'` (§2.7) — угтвар дангаараа багийг шийдэж чадахгүй.

---

## 2. БАТАЛГААЖСАН ОДООГИЙН ЗАН ТӨЛӨВ

> Доорх `file:line` бүрийг энэ сесс өөрөө нээж баталгаажуулав (**2026-08-30**, commit `6a8e4f5`). Тоолуурын гаралт нь энэ машин дээр бодитоор ажилласан командын үр дүн.

### 2.1 BIM-ийн үйл явдлын сангийн 17 миграцид «team» ГЭСЭН ҮГ БАЙХГҮЙ — хэмжсэн

```bash
for f in backend/migrations/020*.sql backend/migrations/021*.sql; do
  printf "%-46s %s\n" "$(basename $f)" "$(grep -ci team "$f")"
done
```

Хэмжсэн гаралт (2026-08-30):

```
0200_assistant_feedback_note.sql               0
0201_bim_artifacts.sql                         0
0202_bim_sessions.sql                          0
0203_revit_transactions.sql                    0
0204_revit_element_touches.sql                 0
0205_learning_events.sql                       0
0206_bim_append_only.sql                       0
0207_bim_generated_columns.sql                 0
0208_bim_capture_settings.sql                  0
0209_bim_generated_indexes.sql                 0
0210_bim_generated_indexes_2.sql               0
0211_user_tokens_valid_from.sql                0
0212_assistant_log_provenance.sql              0
0213_assistant_model_eval.sql                  0
0214_assistant_review.sql                      0
0215_assistant_trust_taxonomy.sql              0
0216_assistant_log_timing.sql                  0
```

`bim_sessions`-ийн бүтэн баганын жагсаалт (`0202_bim_sessions.sql:46-101`) — `session_uid`, `user_id`, `project_id`, `revit_document_id`, `doc_uid`, `doc_title`, `is_link`, `central_path_hash`, `machine_hash`, `worksharing`, `revit_version`, `revit_build`, `addin_version`, `addin_channel`, `model_version`, `prompt_version`, `ruleset_version`, `capture_schema`, `capture_policy`, `notice_version`, `started_at`, `ended_at`, `client_tz_offset_min`, `first_seen_at`, `last_seen_at`, `clock_skew_sec`, `txn_count`, `event_count`, `dropped_count`. **Баг гэсэн ойлголт байхгүй.**

### 2.2 Add-in-ийн 46 `.cs` файлд ч байхгүй — хэмжсэн

```bash
grep -c -i team revit-mcp/addin/*.cs | grep -v ':0'   # тэг биш мөрүүд
ls revit-mcp/addin/*.cs | wc -l
```

Хэмжсэн гаралт:

```
      46
```

Эхний команд НЭГ Ч МӨР гаргаагүй — 46 файлын бүгд нь `:0`. Мөн:

```bash
grep -n -i team backend/src/routes/revit.ts
```

гаралт хоосон. **2644 мөр Revit-ийн route-д баг гэсэн үг байхгүй.**

### 2.3 `revit_documents.team_code` нь зарлагдсан боловч БИЧИГЧГҮЙ — батлагдсан

| Баримт | file:line | Бодит код / текст |
|---|---|---|
| Багана зарлагдсан | `backend/migrations/0187_revit_documents.sql:30` | `  team_code     TEXT,` |
| handshake-ийн INSERT нь түүнийг ОРУУЛААГҮЙ | `backend/src/routes/revit.ts:357-360` | `INSERT INTO revit_documents (project_id, doc_uid, uid_source, file_name, revit_version, is_link, sheet_count, created_by, last_seen_by)` |
| handshake-ийн UPDATE нь ч ОРУУЛААГҮЙ | `backend/src/routes/revit.ts:347-351` | `UPDATE revit_documents SET file_name = ?, revit_version = ?, is_link = ?, sheet_count = ?, last_seen_at = datetime('now'), last_seen_by = ? WHERE id = ?` |

**Дүгнэлт:** урьдчилан огтолсон, бүрэн хоосон нүх. Түүнийг дүүргэхэд **миграци ХЭРЭГГҮЙ** — зөвхөн route-ийн өөрчлөлт.

### 2.4 Таван хүснэгтийн JOIN нь `blocks`-д АЛЬ ХЭДИЙН хүрсэн — батлагдсан

`backend/src/routes/revit.ts:805-812`:

```
revit.ts:805      `SELECT rb.sheet_uid, rb.sheet_number, rb.sheet_name, rb.status, rb.task_id,
revit.ts:806              t.name AS task_name, d.name AS drawing_name, b.name AS block_name
revit.ts:807         FROM revit_sheet_bindings rb
revit.ts:808         LEFT JOIN tasks t       ON t.id = rb.task_id
revit.ts:809         LEFT JOIN components co ON co.id = t.component_id
revit.ts:810         LEFT JOIN drawings d    ON d.id = co.drawing_id
revit.ts:811         LEFT JOIN blocks b      ON b.id = d.block_id   // ← `b.team_id` энд байна
revit.ts:812        WHERE rb.revit_document_id = ? AND rb.user_id IS NULL
```

`blocks.team_id` нь `0057_project_templates.sql:17-21`-д `ON DELETE SET NULL` ба `(project_id, team_id)` индекстэйгээр нэмэгдсэн. Тиймээс **`b.team_id` + `JOIN teams` = хоёр баганын өөрчлөлт**, шинэ хүснэгт хэрэггүй.

### 2.5 `/auth/me` нь хариултыг аль хэдийн буцаадаг; add-in түүнийг хаядаг

| Баримт | file:line | Бодит код |
|---|---|---|
| Үндсэн баг | `backend/src/routes/auth.ts:124-125` | `LEFT JOIN user_teams ut_p ON ut_p.user_id = u.id AND ut_p.is_primary = 1` / `LEFT JOIN teams pt ON pt.id = ut_p.team_id` |
| Бүх харьяалал | `backend/src/routes/auth.ts:142-145` | `FROM user_teams ut JOIN teams t ON t.id = ut.team_id WHERE ut.user_id = ? ORDER BY ut.is_primary DESC, t.sort_order` |
| Add-in-ийн login DTO | `revit-mcp/addin/QtoDtos.cs:116-120` | `public class LoginUser { [JsonPropertyName("role")] public string Role { get; set; } }` |

**Add-in нэвтрэхдээ `role`-оос өөр ЮУГ Ч авдаггүй**, `/auth/me`-г ХЭЗЭЭ Ч дууддаггүй. `AddinSettings` (`QtoDtos.cs:228+`) нь `api_host`, `token_enc`, `username`, `project_id`, `project_name`, `include_links`, `selected_schedules`, `sheet_gen` — **баг байхгүй**.

### 2.6 БА → IZ/EZ хоёрдогч харьяаллын ГЭМТЭЛ — продакшн дээр хэмжигдсэн

`backend/src/routes/attendance.ts:1241-1247`, эх тайлбарыг үгчлэн:

```
attendance.ts:1241   // ⚠️ ЯАГААД ХАРЬЯАЛАЛ БҮРЭЭР БИШ, ЗӨВХӨН ҮНДСЭН БАГААР ВЭ:
attendance.ts:1242   // `daily-grid`-ийн `team_id` шүүлт нь `user_teams`-ийн ЯМАР Ч мөрөөр
attendance.ts:1243   // тааруулдаг.  Энэ жагсаалтад тэр нь буруу хариу өгнө — production
attendance.ts:1244   // өгөгдөл дээр БА багийн бүх гишүүн IZ, EZ багт хоёрдогчоор
attendance.ts:1245   // бүртгэлтэй тул «IZ» гэж шүүхэд 42-ын оронд 242 мөр гарч, IZ-ийн
attendance.ts:1246   // сениор БА-гийн хүмүүсийн өрийг хүлээж авах байсан.  Үндсэн багаар
attendance.ts:1247   // шүүхэд бүлгүүд ДАВХЦАХГҮЙ (нийлбэр нь яг `total`)
```

⚠️ **Энэ бол R5-ийн эвдрэлийн БОДИТ хэлбэр.** «Ямар ч харьяалал»-аар багийг шийдвэл БА-гийн архитекторт IZ-ийн интерьерийн дүрмийн багц ачаалагдана. Тиймээс **3-р шат нь `is_primary = 1`-ээр ЗААВАЛ шүүнэ**.

### 2.7 `foldText` давхар үсгийг хураадаг — `ББ` → `b`

`backend/src/lib/textFold.ts:46-52`:

```
textFold.ts:47       .replace(/kh/g, 'h')
textFold.ts:48       .replace(/ts/g, 'c')
textFold.ts:49       .replace(/y/g, 'i')
textFold.ts:50       .replace(/[^a-z0-9]+/g, ' ')
textFold.ts:51       .replace(/([a-z])\1+/g, '$1')      // ← ДАВХАР ҮСЭГ ХУРААГДАНА
```

`codePrefix` (`backend/src/lib/revitMatch.ts:63-71`) нь `foldText(raw)`-ийн эхний үгийн латин үсгэн хэсгийг авна. Тиймээс:

| Оролт | `codePrefix` | Тайлбар |
|---|---|---|
| `БА-01` | `ba` | зөв |
| `ХАС-12` | `has` | `kh→h` |
| `ЦБУ-3` | `cbu` | `ц→ts→c` |
| **`ББ-01`** | **`b`** | ← давхар үсэг хурааж, НЭГ үсэг үлдэв |
| `Б-101` | `b` | ← ижил үр дүн, ӨӨР баг |

⚠️ Гэхдээ `foldText('BB')` мөн **`'b'`** буцаана. Тиймээс `codePrefix(sheet) === foldText(team.code)` харьцуулалт нь **өөртэйгээ нийцтэй** боловч **хэт өргөн**: «Бетон хийцийн план», «Б-101» зэрэг нь бүгд BB-тэй таарна. Иймд §3.4-ийн 4-р шат нь **ганц үсэгтэй фолдын үед 5-р шатын ангиллын профайлтай ЗААВАЛ давхар нийцэх** ёстой (доор).

### 2.8 `/context` нь бүртгэгдээгүй баримтад 404 өгдөг — тиймээс шинэ гарц түүнийг ДАВТАЖ БОЛОХГҮЙ

`backend/src/routes/revit.ts:792`:

```
revit.ts:792   if (!doc) return c.json({ error: 'Баримт бүртгэгдээгүй байна — эхлээд холбоно уу' }, 404);
```

Мөн `revit.ts:753-758` дахь тайлбар (үгчлэн): «продакшн дээр **434 холбоосын мөр бүгд `suggested` хэвээр** байсан ба самбар «Холбогдсон ажил алга» гээд мухардаж, шинэ ажилтан хэзээ ч эхэлж чаддаггүй байв».

⚠️ **Эндээс хоёр хатуу дүгнэлт:** (а) шинэ `GET /team-context` **ХЭЗЭЭ Ч 404 өгөхгүй** — бүртгэгдээгүй баримт бол `uncertain` төлөв буцаана; (б) 1-р шат (`status='confirmed'` холбоос) нь бодит байдал дээр ХОВОР — тиймээс тэр нь шатны ОРОЙ болохоос ЭХЛЭХ НӨХЦӨЛ БИШ.

### 2.9 `bim_sessions` бол 0206-ын триггерээс ГАДНА байгаа ЦОРЫН ГАНЦ BIM хүснэгт

`backend/scripts/check-bim-events.mjs:35`:

```
check-bim-events.mjs:34   /** `bim_sessions` нь ХУВЬСДАГ хэмжээс — 0206-д ороогүй, UPDATE зөвшөөрөгдөнө. */
check-bim-events.mjs:35   const IMMUTABLE = TABLES.filter((t) => t !== 'bim_sessions');
```

`0206_bim_append_only.sql` нь ЯГ дөрвөн хүснэгт дээр найман триггер үүсгэнэ (`bim_artifacts_append_only` `:1`, `bim_artifacts_redact_once` `:8`, `revit_transactions_*` `:15`/`:22`, `revit_element_touches_*` `:29`/`:36`, `learning_events_*` `:43`/`:50`) — `END;` бүр ТОМ ҮСГЭЭР өөрийн мөрөнд.

⚠️ **Тиймээс §73-ын «буцаагдах» шаардлагыг хангах ЦОРЫН ГАНЦ байрлал нь `bim_sessions`.** Түүн дээр триггер нэмэх нь энэ бүхнийг устгана.

### 2.10 Bind-ийн төсөв — хэмжсэн

`backend/src/lib/bimEvents.ts`:

```
bimEvents.ts:327   function rowsPerStatement(binds: number): number {
bimEvents.ts:348   export const ARTIFACT_BINDS = ARTIFACT_INSERT_COLUMNS.length;  // = 12
bimEvents.ts:384   export const SESSION_BINDS  = SESSION_INSERT_COLUMNS.length;   // = 27
bimEvents.ts:386   export const SESSION_ROWS_PER_STATEMENT = rowsPerStatement(SESSION_BINDS);  // = 3
bimEvents.ts:415   export const TXN_BINDS      = TXN_INSERT_COLUMNS.length;       // = 21
bimEvents.ts:457   export const TOUCH_BINDS    = TOUCH_INSERT_COLUMNS.length;     // = 17
bimEvents.ts:502   export const EVENT_BINDS    = EVENT_INSERT_COLUMNS.length;     // = 23
bimEvents.ts:503   export const EVENT_ROWS_PER_STATEMENT = rowsPerStatement(EVENT_BINDS);     // = 4
```

| Хүснэгт | Одоо | +4 бодит багана | Мөр/statement өмнө → дараа |
|---|---|---|---|
| `bim_sessions` | 27 | **31** | `floor(100/28)=3` → `floor(100/32)=3` — **ӨӨРЧЛӨГДӨХГҮЙ** |
| `learning_events` | 23 | 27 | `floor(100/24)=4` → `floor(100/28)=3` — **25% АЛДАГДАЛ** |

⚠️ Мөн: 2-4 нь `bim_sessions`-д ТАВ ДАХЬ бодит багана — **`perf_json`** — нэмнэ (`2-4` §3.1, дискэн дээрх дугаар нь **`0226`**; context pack-ийн 2-р хувилбар түүнийг `0232` гэж нэрлэсэн ба энэ зөрүү `2-4` §3.0-д нээлттэй бүртгэгдсэн — **дугаарыг бус БАГАНЫН НЭРийг лавла**). 31 → 32 → `floor(100/33)=3`, мөн өөрчлөгдөхгүй. **ЗУРГАА ДАХЬ бодит багана нь 33 → `floor(100/34)=2`** болгож, сессийн ingest-ийг гуравны нэгээр удаашруулна. Тиймээс §72-ын `company_id` нь энэ сессид **бодит багана болж ОРОХГҮЙ**, мөн `pack_sha256` ч адил (хоёулаа §9-ийн 9-р асуулт).

### 2.11 `learning_events`-ийн GENERATED VIRTUAL загвар аль хэдийн ажиллаж байна

`backend/migrations/0209_bim_generated_indexes.sql:17-36` нь `parts_missing`, `intent`, `sheet_uid`, `rule_id`, `feedback`, `progress_entry_id` — бүгд `json_extract(payload_json, '$.<key>')`, бүгд `VIRTUAL`. `0210:14-28` нь тэдэн дээрх индексүүд. `0205`-ын индексүүд: `idx_le_uid` `:166`, `idx_le_seq` `:168`, `idx_le_txn` `:171`, `idx_le_project` `:173`, `idx_le_curation` `:176`, `idx_le_actor` `:180`.

⚠️ **`learning_events.session_id` (`0205:108`) дээр ИНДЕКС БАЙХГҮЙ.** Багаар шүүх бүр бүтэн хүснэгтийн скан болно — 0219 үүнийг засна.

### 2.12 Хэн үйлдэж байгааг СЕРВЕР токеноос авдаг, клиентээс АВДАГГҮЙ

`backend/src/routes/learning.ts:338-340`:

```
learning.ts:338   // ⚠️ Токеноос, клиентээс БИШ.  Ажилтан өөр хүний нэрээр бүртгүүлж
learning.ts:339   //    чадах ёсгүй.
learning.ts:340   user_id: user.sub,
```

Мөн `lib/jwt.ts` нь гарын үсэг + `exp`-ийг л шалгадаг — `alg` шалгалт байхгүй, `purpose` баталгаажуулалт байхгүй.

⚠️ **Тиймээс add-in баг ЗАРЛАЖ БОЛОХГҮЙ.** Тэр нотолгоо илгээнэ; сервер шатыг ажиллуулж, хариуг буцаана. Энэ нь мөн залруулга ~20 PC-г дахин суулгахгүйгээр тархах ЦОРЫН ГАНЦ хэлбэр.

### 2.13 `/api/revit` router нь дөрвөн үүрэгт хаалттай; `worker` автоматаар 403

```
revit.ts:59    const REVIT_ROLES: UserRole[] = ['engineer', 'architect', 'senior', 'admin'];
revit.ts:95    revit.use('*', requireRole(...REVIT_ROLES));
revit.ts:120   function isManager(role: string): boolean { return role === 'admin' || role === 'senior'; }
```

`lib/workerScope.ts:18-33`-ийн `WORKER_ALLOWED_PREFIXES` нь `/api/auth`, `/api/attendance`, `/api/attendance-confirmations`, `/api/leaves`, `/api/notifications`, `/api/push`, `/api/upload` — `/api/revit` **байхгүй**, тул хаалттай-анхдагчаар 403.

⚠️ **Иймд шинэ гарц бүр `/api/revit` ДОР сууна** — эрхийн гэрээ, модулийн ангилал (`lib/modules.ts` дахь `/api/revit`), mcp-токен хүлээн авалт бүгд ҮНЭГҮЙ өвлөгдөнө. Шинэ дээд түвшний угтвар нэмбэл `lib/modules.ts:99` `API_PREFIXES` + `:166` `MODULE_OF`-д нэмэхгүй бол `entitlementGuard` түүнийг ангилалгүй нэвтрүүлнэ.

### 2.14 Ажилд хуваарилагдсан эсэхийг шалгах бэлэн дүрэм

`backend/src/routes/revit.ts:195-207` (`isAssigned`) ба `:865-867`:

```
revit.ts:865          AND (t.assigned_to = ?
revit.ts:866               OR EXISTS (SELECT 1 FROM task_assignees ta
revit.ts:867                           WHERE ta.task_id = t.id AND ta.user_id = ?))
```

`revit_sheet_bindings.status` нь `0188:35-36`-д `CHECK (status IN ('suggested','confirmed','ignored'))`.

### 2.15 Add-in-ийн UI ба амьдралын мөчлөгийн бэхэлгээ

| Баримт | file:line | Утга |
|---|---|---|
| Цорын ганц `Show()` | `AssistantPaneProvider.cs:54` | `pane.Show();` — ЗӨВХӨН `AssistantPaneCommand.Execute` дотор, хэрэглэгчийн ribbon даралт |
| Самбар нь залхуу singleton | `AssistantPaneProvider.cs:27` | `public static AssistantPane View => _view ?? (_view = new AssistantPane());` |
| `SetBusy` нь курсорыг АППЛИКЕЙШН ДАМЖУУЛАН тавина | `AssistantPane.xaml.cs:341`, `:351` | `Mouse.OverrideCursor = busy ? Cursors.AppStarting : null;` |
| `ChangeTracker.Init` нь ӨӨРИЙН try/catch-д | `App.cs:68-75` | «Тусдаа try: бүртгэл унавал ХЯМД нөөц зам ажиллана» |
| Унтраалтын дараалал тогтоосон | `App.cs:165-194` | `ChangeTracker.Shutdown` → `Metrics.EmitSummary` → `Metrics.Shutdown` → `AssistantLog.Shutdown` → `RevitToolBus.Shutdown` (ХАМГИЙН СҮҮЛД) |
| `Gate` нь үндсэн thread дээр | `ChangeTracker.cs:275`, `:798` | `private static readonly object Gate = new object();` / `lock (Gate)` |
| Хэрэгслийн timeout-ын хүснэгт | `RevitApi.cs:489-514` | `TimeoutFor(tool)` — 15/25/30/45/120 сек |
| Add-in-ийн context DTO | `RevitApi.cs:106-125` | `ContextResult` — `document`, `resolved`, `unbound_sheet_uids`, `my_task_count`, `bound_task_count`, `sheet_count`, `is_manager`, `scope`. **Баг байхгүй.** |
| Context дуудлага | `RevitApi.cs:304-313` | `GetContextAsync(host, token, docUid, projectId, allScope)` |
| Самбарын статусын мөр | `AssistantPane.xaml:333` | `<TextBlock x:Name="StatusText" …>` — шинэ chip түүний хажууд сууна |

### 2.16 Тестийн зам — `node --test` + `registerHooks`

`backend/src/lib/webPush.test.ts:18-28`:

```
webPush.test.ts:18   registerHooks({
webPush.test.ts:19     resolve(specifier, context, nextResolve) {
webPush.test.ts:20       if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
webPush.test.ts:21         return nextResolve(`${specifier}.ts`, context);
webPush.test.ts:26   const { CATEGORY_OF, PUSH_CATEGORIES, resolvePrefs } = await import('./pushSweep.ts');
```

⚠️ Өргөтгөлгүй харьцангуй импорттой эх файлыг импортлох тест нь ЭХЛЭЭД `registerHooks` хийж, ДАРАА нь `await import(...)` хийх ёстой. Энгийн статик импорт нь **зөвхөн `node --test` дор** унана — `tsc` ногоон хэвээр байх тул эвдрэл нь тестийг ажиллуулах хүртэл үл үзэгдэнэ.

### 2.17 Багийн ростер — ЭЗЭН БАТАЛСАН НАЙМ (2026-08-30)

**ЭЗЭН БАТАЛСАН (2026-08-30).** Салбарын баг нь **НАЙМ**, `teams.sort_order`-ийн дарааллаар: `BA` Барилга архитектур · `BB` Барилга бүтээц · `HAS` Халаалт агаар сэлгэлт · `TSBU` Цэвэр бохир ус · `TSAH` Цахилгаан · `HD` Холбоо дохиолол · `AU` Автомат удирдлага · `IZ` Интерьер зураг. Эзний үг: «MGMT-ийг хасаад үлдсэн 8-н багийг оруулна». Энэ нь **v2 §46**-д тэмдэглэгдсэн ба одоо ажиллаж буй UI-ийн `IMPLEMENTED_TEAMS`-тэй (`frontend/src/features/projects/team-reports/TeamReportsTab.tsx:52-61`) ЯГ таарна.

Харин `teams` хүснэгт нь **11** мөртэй хэвээр: `backend/migrations/0007_teams.sql:39-47` нь ЕС мөр тарина (дээрх найм + `MGMT` Менежмент), `backend/migrations/0074_seed_ez_gt_teams.sql:12-14` нь `EZ` Эскиз зураг + `GT` Гадна тохижилт хоёрыг **төслийн тохиргооны блокийн угтварын баг** болгон нэмнэ.

⚠️ **MGMT, EZ, GT гурав нь дүрмийн багц АВАХГҮЙ, нийцлийн шалгалт ч ХИЙГДЭХГҮЙ** (эзэн баталсан 2026-08-30, v2 §46-ийн ростерын тэмдэглэл). Энэ нь илрүүлэлт унасан гэсэн үг **БИШ**: мөр нь бодит `team_code`-оор шошголсон хэвээр (attribution зөв), зөвхөн шалгалт алгасагдана. §3.4-ийн «**ДҮРМИЙН БАГЦГҮЙ БАГ**» харьцуулах хүснэгтийг үз — тэр төлөв нь `TEAM = UNCERTAIN`-аас ӨӨР бөгөөд түүнтэй ХЭЗЭЭ Ч ХОЛИГДОХГҮЙ. Багцгүй багийг ӨӨР БАГИЙН дүрмээр шалгах нь **ХОРИОТОЙ** (v2 §48-R6).

⚠️ **Дарааллын шийдвэр (ЭЗЭН БАТАЛСАН 2026-08-30):** эхний БҮРЭН дүрмийн багц нь **BA — Барилга архитектур**, тэр нь үлдсэн долоогийн бүтцийн загвар болно (v2 §46). Хэмжсэн үндэслэл (2026-08-30, энэ машин дээр): `frontend/src/features/projects/team-reports/ba/template.ts` нь **831 мөр** — салбарын загваруудаас ХАМГИЙН ТОМ (BB 417 · TSAH 346 · HD 321 · AU 288 · HAS 269 · IZ 65) — бөгөөд норм лавлагаа агуулсан гурвын нэг (`ba/template.ts:570`, `:597`, `:600` — БНбД 23-01-09). **IZ нь эзний дарааллаар ХОЁРДУГААРТ** (эзэн R6-д Интерьерийг ил нэрлэсэн), ГЭВЧ `iz/template.ts` нь **65 мөр, норм лавлагаа ТЭГ** — иймд IZ-ийн багцыг загвараас ХУРААХ БОЛОМЖГҮЙ, нормын каталогоос **ЗОХИОХ** ёстой. Энэ бол багцын хөтөлбөрийн гол хуваарийн эрсдэл.

⚠️ **ЭНЭ ТООГ КОДОД ХАТУУ БИЧИХГҮЙ.** Найм гэдэг нь **ТӨЛӨВЛӨЛТИЙН** баримт (хэдэн багц зохиох вэ), ажиллах үеийн литерал БИШ — ростер `teams.code`-оос уншигдана (⛔ хориг 11). `teams` дараа нь өсөж болно; шинэ салбар нэмэгдэхэд валидац ч, шат ч УНАХ ЁСГҮЙ.

⚠️ **Гишүүдийн бодит ТОО хараахан баталгаажаагүй.** Продакшны D1 энэ машинаас **хүрэлцээгүй** (Cloudflare API алдаа **7403 not authorized**), тул баг тус бүрт хэдэн идэвхтэй хүн үндсэн харьяалалтай байгаа нь **ХЭМЖИГДЭЭГҮЙ — ТААМАГ хэвээр**; §7-ийн 4-р блок түүнийг хаана. Ростер өөрөө шийдэгдсэн, тоолуур нь шийдэгдээгүй.

---

## 3. ХИЙХ АЖИЛ

### 3.0 Дугаар авах

```bash
ls backend/migrations | tail -5
# 2026-08-30-нд хэмжсэн гаралт:
#   0212_assistant_log_provenance.sql
#   0213_assistant_model_eval.sql
#   0214_assistant_review.sql
#   0215_assistant_trust_taxonomy.sql
#   0216_assistant_log_timing.sql
```

Энэ сессийн нөөцлөгдсөн блок: **0217, 0218, 0219**. (Track 2-ын бүтэн нөөц нь 0217–0245; 0220 болон дээшхийг 2-2 … 2-8 эзэмшинэ.) **Бичихийн ЯГ ӨМНӨ дээрх командыг ДАХИН ажиллуул** — ах дүү агентууд дугаараа зэрэг авч байна. Хэрэв `tail -5` нь 0216-аас өндөр зүйл харуулбал ЗОГС, эзэнд хэл.

Файл бүрийн дараа:

```bash
cd backend && node scripts/check-bim-events.mjs
node --test src/lib/migrationSchema.test.ts
```

### 3.1 Миграци 0217 — `bim_sessions` дээрх §48-ын дөрвөл

```sql
-- =============================================================
-- 0217_bim_session_team.sql — §48-ын дөрвөл: bim_sessions дээрх багийн контекст
-- =============================================================
-- ЗОРИЛГО: v2 §48-R4 нь team_id / team_confidence / team_source /
-- team_last_verified дөрвийг ЗААВАЛ хадгална гэж заасан.  Тэдгээрийг
-- `bim_sessions` дээр байрлуулна: сесс = НЭГ хэрэглэгч × НЭГ баримт, энэ
-- бол багийн контекстийн ЯГ ЗӨВ ширхэглэл.
--
-- ⚠️ ЯАГААД `bim_sessions` ДЭЭР, БУСАД ДЭЭР БИШ ВЭ:
-- `bim_sessions` нь 0206-ын найман триггерээс ГАДНА байгаа ЦОРЫН ГАНЦ BIM
-- хүснэгт (`backend/scripts/check-bim-events.mjs:35`).  §73 нь илрүүлэлт
-- залруулагдах ёстой гэж шаарддаг — UPDATE зөвхөн ЭНД хууль ёсны.
-- `learning_events` дээр бодит багана нэмбэл (а) 0206 түүнийг ард нь
-- дүүргэхийг БҮРЭН хориглоно, (б) EVENT_BINDS 23→25 нь statement тутмын
-- мөрийг 4→3 болгож, хамгийн их урсгалтай хүснэгтийн ingest-ийг 25%
-- удаашруулна (R7-ийн шууд зөрчил).
--
-- ⚠️ BIND АРИФМЕТИК (bimEvents.ts:327 `floor(100/(binds+1))`):
--   ⚠️ ЗАСВАР (ЭЗНИЙ ШИЙДВЭР Ш3, 2026-08-31): 0217 нь `company_id`-г МӨН нэмнэ.
--   SESSION_BINDS 27 → 31 (баг) → 32 (`company_id`) → 33 (`perf_json`).
--   floor(100/28)=3 → floor(100/34)=2.  ХҮЛЭЭН АВСАН зардал.
--   2-4-ийн `perf_json` (дискэн дээр 0226) нь ТАВ ДАХЬ бодит багана нэмнэ
--   → 32 → floor(100/33)=3, мөн адил.
--   ЗУРГАА ДАХЬ бодит багана → 33 → floor(100/34)=2.  ТИЙМ УЧРААС §72-ын
--   `company_id` нь ЭНД БАЙХГҮЙ (§9-ийн блоклогч асуулт).
--
-- ⚠️ `team_code` TEXT, `team_id` INTEGER БИШ.  Шалтгаан 0069-д бичигдсэн:
-- «баг дахин тарихад мөр амьд үлдэхийн тулд кодоор лавлана».  Мөн дүрмийн
-- багц нь `teams` хүснэгтгүй C# клиент рүү очно, `codePrefix()` нь код
-- хэлбэрийн мөр гаргадаг, `revit_documents.team_code` аль хэдийн TEXT (0187:30).
--
-- ⚠️ REFERENCES ЗАРЛАЛ БАЙХГҮЙ — шалтгаан 0201-д бүтнээр бичигдсэн
-- (`ON DELETE SET NULL` нь хүүхдийн UPDATE болж, append-only триггерийг
-- асааж, эцгийн DELETE-ийг БҮХЭЛД НЬ ABORT болгодог).
--
-- ⚠️ ЭНЭ ФАЙЛ 6 STATEMENT.  Тээврийн тааз 7 (0209:6-13-ын хэмжилт).
-- =============================================================

ALTER TABLE bim_sessions ADD COLUMN team_code TEXT

ALTER TABLE bim_sessions ADD COLUMN team_confidence REAL NOT NULL DEFAULT 0

ALTER TABLE bim_sessions ADD COLUMN team_source TEXT NOT NULL DEFAULT 'uncertain'

ALTER TABLE bim_sessions ADD COLUMN team_last_verified TEXT

CREATE INDEX IF NOT EXISTS idx_bim_sessions_team
  ON bim_sessions (team_code, started_at DESC) WHERE team_code IS NOT NULL

CREATE INDEX IF NOT EXISTS idx_bim_sessions_team_uncertain
  ON bim_sessions (started_at DESC) WHERE team_code IS NULL
```

> ⚠️ **ЗАСВАР (ЭЗНИЙ ШИЙДВЭР Ш3, 2026-08-31):** дээрх блокт **`ALTER TABLE bim_sessions ADD COLUMN company_id TEXT NOT NULL DEFAULT 'default';`** мөн ОРНО (файл 7 statement болно).  TEXT — `companies` хүснэгт репод БАЙХГҮЙ, компанийн таних тэмдэг нь `lib/tenants.ts`-ийн `TenantSpec.id`; анхдагч нь `lib/requestContext.ts:35`-ын `DEFAULT_TENANT_ID`.
>
> ⚠️ Дээрх блокт statement төгсгөлийн цэг таслалыг ЗОРИУДААР бичээгүй — файлд бичихдээ statement бүрийн төгсгөлд `;` нэмнэ, ГЭХДЭЭ мөрөн ДОТОР `;` бүү тавь (0209:6-13-ын дүрэм). `team_source`-т SQL `CHECK` **БАЙХГҮЙ**: хаалттай олонлог нь `lib/teamContext.ts`-ийн `Record<TeamSource, …>`-д (0205-ын `kind`-ийн адил заль) — CHECK өөрчлөх нь хүснэгт дахин бүтээхийг шаардана.

### 3.2 Миграци 0218 — `team_attributions` (§73-ын залруулгын түүх)

> ⚠️ **ХОЁР ЗАСВАР (2026-08-31).**  (1) Доорх DDL-ийн дөрвөн `/* --- … --- */`
> **блок тайлбар** нь `migrationSchema.test.ts`-ийн тээврийн хамгаалалтад
> ТАТГАЛЗАНА (`raw.includes('/*')`) — шипсэн файлд тэдгээр нь `--` мөрийн
> тайлбар болж бичигдсэн.  (2) Багана нь **18**, «17» БИШ: §6/§7-ийн хуучин
> тоо нь арифметикийн алдаа байв.  Нэг ч багана хасаагүй — `scope_kind` нь
> бусад талбараас ГАРГАЖ АВАХ БОЛОМЖГҮЙ (нэг мөр `session_id`,
> `revit_document_id`, `project_id` гурвуулангаа агуулж болох ба тэдгээр нь
> КОНТЕКСТ; `scope_kind` нь залруулга ХЭР ХОЛ үйлчлэхийг заана — `sticky`
> бол `document`, эс бөгөөс `session`).

```sql
-- =============================================================
-- 0218_team_attributions.sql — §73: илрүүлэлт нь БУЦААГДАХ ёстой
-- =============================================================
-- ЗОРИЛГО: v2 §73 нь тавыг хадгал гэж заасан — таасан баг, итгэлцэл,
-- эх сурвалж, ДАРАА НЬ БАТАЛГААЖСАН баг, залруулгын түүх.  `bim_sessions`
-- нь ЗӨВХӨН ОДООГИЙН төлөв; түүх нь энд, зөвхөн нэмэгддэг байдлаар.
--
-- ⚠️ ЗАЛРУУЛГА нь ХУУЧИН МӨРИЙГ УСТГАХГҮЙ.  Шинэ мөр нэмж, өмнөхийг
-- `superseded_by` -аар ХҮЧИНГҮЙ БОЛГОНО.  «Машин IZ гэж таасан, хүн BA
-- гэж зассан» гэдэг нь §66-ын хуурамч-эерэг хэмжилтийн ЦОРЫН ГАНЦ түүхий
-- эд — түүнийг устгах нь хэмжих боломжийг устгана.
--
-- ⚠️ ХОЁР ТРИГГЕРИЙН ХЭЛБЭР нь 0206-ынхтой ЯГ ИЖИЛ: UPDATE нь ЗӨВХӨН
-- `superseded_at`-ыг NULL-ээс утга руу шилжүүлэх үед л зөвшөөрөгдөнө.
-- Багана заалт БИЧИХГҮЙ (`BEFORE UPDATE ON <t>`, `OF ...` -гүй) —
-- 1B-1 §2.7-д хэмжсэнээр `BEFORE UPDATE OF col` нь дараа нь ALTER-ээр
-- нэмэгдсэн баганыг ХАМГААЛДАГГҮЙ.
--
-- ⚠️ `END;` нь ТОМ ҮСГЭЭР, ӨӨРИЙН МӨРӨНД.  wrangler-ийн задлагчийн regex
-- нь `/\sEND[;\s]$/` — жижиг үсгээр бичвэл файл ХАГАС хэрэгжиж,
-- `d1_migrations` мөр үлдэхгүй ба цорын ганц засвар нь ШИНЭ ДУГААР.
--
-- ⚠️ REFERENCES БАЙХГҮЙ (0201-ийн шалтгаан).  `user_id`, `project_id`,
-- `revit_document_id` нь энгийн INTEGER.
--
-- ⚠️ ЭНЭ ФАЙЛ 6 STATEMENT.
-- =============================================================

CREATE TABLE IF NOT EXISTS team_attributions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,

  /* --- ХАМРАХ ХҮРЭЭ --- */
  -- session | document | project.  Нэг залруулга хэр өргөн үйлчлэхийг заана:
  -- `session` = зөвхөн энэ Revit процесс, `document` = энэ .rvt цаашид,
  -- `project` = төслийн бүх баримт.  §73-ын «сүүлд баталгаажсан баг».
  scope_kind          TEXT    NOT NULL DEFAULT 'session',
  session_id          INTEGER,
  revit_document_id   INTEGER,
  project_id          INTEGER,
  -- Хэний сесс/баримт дээр — ҮЙЛДЭГЧ.  Токеноос, клиентээс БИШ.
  user_id             INTEGER NOT NULL,

  /* --- ТААСАН (машин) --- */
  inferred_team_code  TEXT,
  inferred_confidence REAL    NOT NULL DEFAULT 0,
  inferred_source     TEXT    NOT NULL DEFAULT 'uncertain',
  -- Шатны бүх нэр дэвшигч + оноо.  ЗАМ, ФАЙЛЫН НЭР ХАДГАЛАХГҮЙ (0202:39).
  evidence_json       TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(evidence_json)),
  -- 1-р ба 3-р шат ЗӨРЧИЛДВӨЛ: ["BA","IZ"].  NULL = зөрчилгүй.
  conflict_json       TEXT,

  /* --- БАТАЛГААЖСАН (хүн) --- */
  verified_team_code  TEXT,
  verified_by         INTEGER,
  verified_at         TEXT,
  -- manual | membership | manager.  Хүн ямар эрхээр баталгаажуулсан.
  verified_via        TEXT,

  /* --- ХҮЧИНТЭЙ ХУГАЦААНЫ ЗААГ --- */
  superseded_by       INTEGER,
  superseded_at       TEXT,

  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
)

CREATE INDEX IF NOT EXISTS idx_team_attr_session
  ON team_attributions (session_id, id DESC) WHERE session_id IS NOT NULL

CREATE INDEX IF NOT EXISTS idx_team_attr_doc
  ON team_attributions (revit_document_id, id DESC) WHERE revit_document_id IS NOT NULL

CREATE INDEX IF NOT EXISTS idx_team_attr_live
  ON team_attributions (user_id, id DESC) WHERE superseded_at IS NULL

CREATE TRIGGER IF NOT EXISTS team_attributions_append_only
BEFORE UPDATE ON team_attributions
WHEN NEW.superseded_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'team_attributions is append-only - only superseding may UPDATE');
END;

CREATE TRIGGER IF NOT EXISTS team_attributions_supersede_once
BEFORE UPDATE ON team_attributions
WHEN OLD.superseded_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'team_attributions: row already superseded');
END;
```

### 3.3 Миграци 0219 — `learning_events` дээрх ВИРТУАЛ багийн багана

```sql
-- =============================================================
-- 0219_learning_events_team.sql — үйл явдал бүрийн БАГ, bind зардалгүй
-- =============================================================
-- ЗОРИЛГО: §72 нь цуглуулсан мөр бүр багаар шошголсон байхыг шаарддаг.
--
-- ⚠️ ЯАГААД GENERATED VIRTUAL, БОДИТ БАГАНА БИШ ВЭ — ХОЁР ШАЛТГААН:
--   (1) 0206-ын `learning_events_append_only` триггер нь UPDATE-ийг ABORT
--       болгодог тул бодит багана нь ХУУЧИН МӨРӨНД ХЭЗЭЭ Ч дүүргэгдэхгүй,
--       БҮРМӨСӨН NULL үлдэнэ.
--   (2) EVENT_BINDS 23 → 25 нь `floor(100/24)=4` -ийг `floor(100/26)=3`
--       болгоно — хамгийн их урсгалтай хүснэгт дээр 25% алдагдал.
--   VIRTUAL нь bind = 0, хуучин мөрүүд payload-аасаа шууд шийдэгдэнэ.
--
-- ⚠️ ХАМГИЙН ЧУХАЛ ДҮРЭМ — ҮЙЛ ЯВДЛЫН БАГЫГ JOIN-ААР ШИЙДЭХГҮЙ.
-- `BimEmitter` нь `team_code` / `team_source`-ыг БИЧИХ МӨЧИД `payload_json`
-- руу ХӨЛДӨӨНӨ.  Хэрэв багийг `bim_sessions`-руу JOIN хийж шийдвэл §73-ын
-- залруулга (нэг хувьсдаг мөрийн UPDATE) нь хэдэн зуун ХӨДӨЛШГҮЙ мөрийн
-- утгыг ЧИМЭЭГҮЙ дахин шошголно: IZ-ийн дүрмээр гаргасан 400 шийдвэр нь
-- маргааш «BA, гараар баталгаажсан» болж, BA-гийн сургалтын корпусыг
-- хордуулна.  `learning_events` нь триггерээр хамгаалагдсан тул ТҮҮНИЙГ
-- дараа нь ЗАСАХ БОЛОМЖГҮЙ.
--
-- ⚠️ Индекслэгдсэн GENERATED баганыг DROP хийхэд ЭХЛЭЭД индексийг устгана
-- (1B-1 §2.5-ын хэмжилт).  JSON түлхүүрийн нэрийг НЭГ УДАА зөв тогтоо.
--
-- ⚠️ ЭНЭ ФАЙЛ 5 STATEMENT.
-- =============================================================

ALTER TABLE learning_events ADD COLUMN team_code TEXT
  GENERATED ALWAYS AS (json_extract(payload_json, '$.team_code')) VIRTUAL

ALTER TABLE learning_events ADD COLUMN team_source TEXT
  GENERATED ALWAYS AS (json_extract(payload_json, '$.team_source')) VIRTUAL

CREATE INDEX IF NOT EXISTS idx_le_session
  ON learning_events (session_id, id) WHERE session_id IS NOT NULL

CREATE INDEX IF NOT EXISTS idx_le_team
  ON learning_events (team_code, occurred_at) WHERE team_code IS NOT NULL

CREATE INDEX IF NOT EXISTS idx_le_team_source
  ON learning_events (team_source, occurred_at) WHERE team_source IS NOT NULL
```

⚠️ `idx_le_session` нь **§2.11-д хэмжсэн дутагдлыг** засаж байгаа — `0205:108`-ын `session_id` дээр өнөөдөр индекс байхгүй.

### 3.4 `backend/src/lib/teamContext.ts` (ШИНЭ) — §48-ын шат НЭГ газар

Энэ файл нь **цэвэр логик + нэг өгөгдлийн уншилт**. Түүний доторх шийдвэрийн функц нь `D1Database`-гүй, тестлэгдэх боломжтой.

```ts
/**
 * §48 АВТОМАТ БАГИЙН ИЛРҮҮЛЭЛТ — ЦОРЫН ГАНЦ хэрэгжүүлэлт.
 *
 * ⚠️ НОТОЛГОО ДЭЭШЭЭ, ШИЙДВЭР ДООШОО.  Add-in баг ЗАРЛАХГҮЙ — нотолгоо
 * илгээнэ, сервер шатыг ажиллуулж, хариуг буцаана.  Шалтгаан:
 * `routes/learning.ts:338-340` нь клиентээс ирсэн хэн болохыг аль хэдийн
 * татгалздаг, `lib/jwt.ts` нь гарын үсэг + `exp`-ийг л шалгадаг тул клиент
 * дурын багийг зарлаж чадна.  Мөн энэ бол залруулга ~20 PC-г дахин
 * суулгахгүйгээр тархах ЦОРЫН ГАНЦ хэлбэр.
 */

/** §48-R4-ийн `team_source`.  ХААЛТТАЙ олонлог — SQL CHECK БИШ, TS Record. */
export const TEAM_SOURCES = [
  'binding',        // 1-р шат  — батлагдсан хуудасны холбоос → blocks.team_id
  'document',       // 1b       — revit_documents.team_code
  'project_shares', // 2-р шат  — project_team_shares-д ганц салбар
  'user_primary',   // 3-р шат  — user_teams.is_primary = 1
  'sheet_prefix',   // 4-р шат  — ЗӨВХӨН БАТАЛГААЖУУЛАГЧ
  'behavior',       // 5-р шат  — ЗӨВХӨН БАТАЛГААЖУУЛАГЧ
  'manual',         // хүний баталгаажуулалт (§73)
  'uncertain',      // 6-р шат
] as const;
export type TeamSource = (typeof TEAM_SOURCES)[number];

/**
 * Шат тус бүрийн итгэлцэл.
 *
 * ⚠️ ЭНЭ БОЛ ИТГЭЛЦЛИЙН УРАЛДААН БИШ — §48-R3 нь «preferred hierarchy»
 * гэж заасан, жигнэсэн холимог БИШ.  ШИЙДВЭРЛЭГЧ шатууд нь v2-ын
 * дарааллаар (binding → project metadata → identity) явах ба ЭХНИЙ нэр
 * дэвшигч гаргасан нь ЯЛНА.  Итгэлцэл нь тусад нь МЭДЭЭЛДЭГ тоо —
 * `project_shares` (0.75) нь `user_primary` (0.85)-аас өмнө шалгагдана.
 *
 * ⚠️ ГЭХДЭЭ ЭНЭ ДАРААЛАЛ ДАНГААРАА ХАНГАЛТГҮЙ.  `binding`, `document`,
 * `project_shares` гурав нь ТӨСЛИЙН/БАРИМТЫН дохио — үйлдэж буй хүнийг
 * ОГТ АСУУДАГГҮЙ.  Тиймээс тэдгээрийн аль нэг нь `user_primary`-тай
 * ЗӨРВӨЛ үр дүн нь UNCERTAIN болно (доорх `decideTeam`-ийн ЗӨРЧЛИЙН
 * ДҮРЭМ).  Эс бөгөөс MGMT-гүй ганц хуваарьтай төсөл (интерьер-л, эсвэл
 * ZA засвар — MGL-д ЭНГИЙН) дээр BA-гийн архитектор HAS-ийн дүрмийн
 * багцыг ЧИМЭЭГҮЙ ачаалах байсан: яг R5/§48-R6-ийн эвдрэл.
 */
export const TIER_CONFIDENCE: Record<TeamSource, number> = {
  binding: 1.0,
  document: 0.95,
  project_shares: 0.75,
  user_primary: 0.85,
  sheet_prefix: 0.65,
  behavior: 0.6,
  manual: 1.0,
  uncertain: 0.0,
};

/**
 * Хүлээн авах босго.  Харьцуулалт нь ХАТУУ `>` — `>=` эсэх нь бүхэл
 * шат оршин байх эсэхийг шийддэг тул кодод ил бичигдэнэ.
 */
export const TEAM_ACCEPT_CONFIDENCE = 0.7;

/**
 * ШИЙДВЭРЛЭГЧ vs БАТАЛГААЖУУЛАГЧ.
 *
 * ⚠️ 4- ба 5-р шат нь сессийг ХЭЗЭЭ Ч ДАНГААРАА шийдэхгүй.  Шалтгаан
 * §2.7-д хэмжигдсэн: `textFold.ts:51` давхар үсгийг хураадаг тул
 * `codePrefix('ББ-01') === 'b'`, мөн `foldText('BB') === 'b'` — өөртэйгээ
 * нийцтэй ч ХЭТ ӨРГӨН.  «Б-101» эсвэл «Бетон хийцийн план» нь бүгд BB
 * болж, инженерийн зурж буй зүйлийн ОРОЙГООР бүтээцийн дүрмийн багц
 * ачаалагдах байсан.  Тэд зөвхөн UNCERTAIN дээрх сонгогчийг урьдчилан
 * тэмдэглэж, шийдэгдсэн хариуны итгэлцлийг өсгөж чадна.
 */
export const RESOLVING_SOURCES: readonly TeamSource[] = [
  'binding',
  'document',
  'project_shares',
  'user_primary',
] as const;

export const CORROBORATING_SOURCES: readonly TeamSource[] = [
  'sheet_prefix',
  'behavior',
] as const;

/** §47-ын мэдлэгийн дөрвөн түвшин — БОДИТ ХАДГАЛАЛТТАЙ. */
export const KNOWLEDGE_SCOPES = ['GLOBAL', 'COMPANY', 'TEAM', 'PROJECT'] as const;
export type KnowledgeScope = (typeof KNOWLEDGE_SCOPES)[number];

/** Нөөцлөгдсөн ХУУРАМЧ кодууд — бодит багт ХЭЗЭЭ Ч оноож болохгүй. */
export const RESERVED_TEAM_CODES = new Set(['NORM', 'GENERAL', 'ROOMS', 'FIRE', 'EXTORG']);

export interface TeamCandidate {
  team_code: string;
  source: TeamSource;
  confidence: number;
  /** Тухайн шатны түүхий тоо — evidence_json руу орно.  ЗАМ, ФАЙЛЫН НЭР БИШ. */
  detail?: Record<string, number | string>;
}

export interface TeamDecision {
  team_code: string | null;
  team_confidence: number;
  team_source: TeamSource;
  /** ≥2 элемент бол зөрчил — UNCERTAIN.  NULL = зөрчилгүй. */
  conflict: string[] | null;
  /** Шатны БҮХ нэр дэвшигч — UI-ийн сонгогчийг урьдчилан тэмдэглэхэд. */
  candidates: TeamCandidate[];
}

/**
 * §48-ын шат — ЦЭВЭР ФУНКЦ.  DB хандалт байхгүй тул `node --test`-ээр
 * бүрэн хэмжигдэнэ.  Дуудагч (route) нь дөрвөн SQL асуулгыг гүйцэтгээд
 * үр дүнг `TeamCandidate[]` болгож энд өгнө.
 *
 * ⚠️ ЗӨРЧЛИЙН ДҮРЭМ (ӨРГӨТГӨСӨН).  ХҮНЭЭС ГАРААГҮЙ шийдвэрлэгч шат
 * (`binding`, `document`, `project_shares` — гурвуулаа төсөл/баримтын
 * дохио) ба `user_primary` хоёулаа нэр дэвшигч гаргаад ЗӨРСӨН бол үр дүн
 * нь **UNCERTAIN + conflict**, өндөр шат БИШ.
 *
 * ⚠️ ЯАГААД ЗӨВХӨН `binding` vs `user_primary` БИШ ВЭ: `project_shares`
 * нь үйлдэж буй хүнийг ОГТ асуудаггүй тул MGMT-г хассаны дараа ганц
 * хуваарь үлдсэн ЯМАР Ч төсөл дээр (интерьер-л ажил, ZA засвар) BA-гийн
 * архитекторыг HAS болгож шийдэж, HAS-ийн багцыг ЧИМЭЭГҮЙ ачаалах байв.
 * §48-R6 «do not silently apply the wrong team's rules» нь тэр шатанд ч
 * адилхан үйлчилнэ; `AssistantPane.xaml.cs:246-253` нь нэг .rvt-г олон
 * салбарын инженер хуваалцдагийг аль хэдийн бичсэн.
 *
 * ⚠️ ЗӨРЧИЛ нь ЗӨВХӨН `user_primary` нэр дэвшигчтэй үед л боломжтой.
 * Хэрэглэгчид ҮНДСЭН баг байхгүй бол (`is_primary = 1` мөргүй) зөрчих
 * тал БАЙХГҮЙ тул шатны дараалал хэвийн ажиллана.
 * (Эзний баталгаажуулалт — §9-ийн 3-р асуулт.)
 */
export function decideTeam(candidates: TeamCandidate[]): TeamDecision;

/**
 * Кодын **ХЭЛБЭРИЙН** шалгалт — `projects.ts:2772-2777`-ийн
 * `normaliseTeamCode`-той ижил дүрэм (`/^[A-Z]{2,8}$/`, нөөцлөгдсөнийг хасна).
 *
 * ⚠️ ЭНЭ БОЛ ХЭЛБЭР, ГИШҮҮНЧЛЭЛ БИШ.  `team_code`-ийн БОДИТ валидац нь
 * **АМЬД `teams.code`-ийг** хүлээн авна — `EXISTS (SELECT 1 FROM teams
 * WHERE code = ?)`, `code IN ('BA','BB',…)` **БИШ**.  Эзэн 2026-08-30-нд
 * салбарын наймыг баталсан ч тэр нь ТӨЛӨВЛӨЛТИЙН тоо: **шинэ салбар
 * нэмэгдэхэд валидац УНАХ ЁСГҮЙ** (⛔ хориг 11).
 *
 * ⚠️ Иймд `MGMT`, `EZ`, `GT` нь ХҮЧИНТЭЙ `team_code` хэвээр.  Тэд зөвхөн
 * дүрмийн багцгүй (§2.17) — хүчингүй БИШ.  Валидацаас унагаах нь
 * `POST /team-context/verify`-ийг тэдгээр багийн гишүүдэд эвдэнэ.
 */
export function isTeamCodeShape(code: string): boolean;   // /^[A-Z]{2,8}$/ && !RESERVED

/**
 * 4-р шатны ХАСАХ ЖАГСААЛТ.  Эхлэлд `teams.code`-ийн фолдыг урьдчилан
 * тооцоолж, (а) 2 тэмдэгтээс богино эсвэл (б) фолдын дараа ДАВХАРДСАН
 * бүх кодыг ХАЯНА.  `BB` нь яг тэр тохиолдол (`foldText('BB') === 'b'`).
 */
export function foldableTeamCodes(codes: string[]): Map<string, string>;

/**
 * Ямар хамрах хүрээ ажиллахыг заана (§47).
 *
 * ⚠️ `TEAM` нь ХОЁР ТУСДАА шалтгаанаар унана — тэдгээрийг БҮҮ ХОЛИ:
 *   (1) `team_code === null` — ИЛРҮҮЛЭЛТ ӨӨРӨӨ УНАСАН (UNCERTAIN);
 *   (2) `team_code !== null` ГЭВЧ `packedTeamCodes`-д БАЙХГҮЙ — илрүүлэлт
 *       АМЖИЛТТАЙ, гэхдээ тэр багт дүрмийн багц зохиогдоогүй (эзэн
 *       баталсан 2026-08-30: `MGMT`, `EZ`, `GT` — §2.17).
 * `packedTeamCodes` өгөгдөөгүй бол багцын шүүлт ХИЙГДЭХГҮЙ (хуучин зан төлөв).
 */
export function scopesFor(d: TeamDecision,
                          packedTeamCodes?: ReadonlySet<string>): KnowledgeScope[];
// team_code === null                        → ['GLOBAL','COMPANY','PROJECT']
// team_code байгаа, багцТАЙ                 → ['GLOBAL','COMPANY','TEAM','PROJECT']
// team_code байгаа, багцГҮЙ (MGMT/EZ/GT)    → ['GLOBAL','COMPANY','PROJECT']

/**
 * Энэ сесст НИЙЦЛИЙН ШАЛГАЛТ ажиллах уу (ЭЗЭН БАТАЛСАН 2026-08-30).
 *
 * ⚠️ `packedTeamCodes` нь АЖИЛЛАХ ҮЕД дамжина — 2-2-ын дүрмийн бүртгэлээс
 * (`SELECT DISTINCT team_code FROM rules WHERE team_code IS NOT NULL`).
 * ЖАГСААЛТ ЭНД ХАТУУ БИЧИГДЭХГҮЙ: найм бол төлөвлөлтийн тоо, шинэ салбар
 * нэмэгдэхэд энэ функц ӨӨРЧЛӨГДӨХГҮЙ (⛔ хориг 11).  Аргументаар авдаг
 * тул энэ файл 2-2-оос **схемийн түвшинд ХАМААРАХГҮЙ** хэвээр үлдэнэ.
 *
 * ⚠️ `false` буцаах нь «баг тодорхойгүй» ГЭСЭН ҮГ **БИШ**.  Хоёр төлөв ӨӨР:
 *   UNCERTAIN     → `team_code === null`; мөр нь БАГГҮЙ шошготой.
 *   БАГЦГҮЙ БАГ   → `team_code` нь БОДИТ код; мөр нь ТҮҮГЭЭР шошголно
 *                   (attribution ЗӨВ хэвээр), зөвхөн шалгалт алгасагдана.
 * ⛔ Багцгүй баг нь ӨӨР БАГИЙН дүрэм рүү ХЭЗЭЭ Ч УНАХГҮЙ (v2 §48-R6).
 */
export function complianceEnabled(d: TeamDecision,
                                  packedTeamCodes: ReadonlySet<string>): boolean;
```

**Дөрвөн ШИЙДВЭРЛЭГЧ шатны SQL** (route-д, дарааллаараа):

```sql
-- 1-р шат · binding · 1.00
-- ⚠️ ЗӨВХӨН ҮЙЛДЭГЧИД ХУВААРИЛАГДСАН ажлын холбоос.  Холбоос нь БАГААР
--    ХУВААЛЦСАН (`rb.user_id IS NULL`) тул шүүлтгүй бол цахилгаанчин
--    архитекторын багийг өвлөнө (`revit.ts:763-769`-ийн ижил шалтгаан).
SELECT tm.code AS team_code, COUNT(*) AS n
  FROM revit_sheet_bindings rb
  JOIN tasks t       ON t.id = rb.task_id
  JOIN components co ON co.id = t.component_id
  JOIN drawings d    ON d.id = co.drawing_id
  JOIN blocks b      ON b.id = d.block_id
  JOIN teams tm      ON tm.id = b.team_id
 WHERE rb.revit_document_id = ?
   AND rb.user_id IS NULL
   AND rb.status = 'confirmed'
   AND (t.assigned_to = ?
        OR EXISTS (SELECT 1 FROM task_assignees ta
                    WHERE ta.task_id = t.id AND ta.user_id = ?))
 GROUP BY tm.code
 ORDER BY n DESC;

-- 1b-р шат · document · 0.95
SELECT team_code FROM revit_documents WHERE id = ? AND team_code IS NOT NULL;

-- 2-р шат · project_shares · 0.75
-- ⚠️ ЗӨВХӨН MGMT-ийг хассаны дараа ЯГ НЭГ мөр үлдвэл.  Хоёр ба түүнээс
--    дээш бол энэ шат ЮУ Ч гаргахгүй — «магадгүй» гэдэг нь баг биш.
SELECT tm.code AS team_code
  FROM project_team_shares pts
  JOIN teams tm ON tm.id = pts.team_id
 WHERE pts.project_id = ? AND pts.share_percent > 0 AND tm.code <> 'MGMT';

-- ⚠️ `tm.code <> 'MGMT'` нь энэ шатны ҮЛДСЭН ЦОРЫН ГАНЦ хатуу бичигдсэн код,
--    бөгөөд ЗӨВШӨӨРӨГДСӨН литерал: эзэн 2026-08-30-нд MGMT-ийг салбарын
--    наймаас ил хассан (§2.17) тул тэр нь энэ шатны ЧИМЭЭГҮЙ ялагч болох
--    ёсгүй.  ⛔ ГЭХДЭЭ `EZ`, `GT` хоёрыг ЭНД ХАСАХГҮЙ: тэд хууль ёсны
--    `team_code` бөгөөд хуваарь дээр гарвал шат нь тэднийг ЗӨВ шийднэ.
--    Дүрмийн багцгүй нь §3.4-ийн «ДҮРМИЙН БАГЦГҮЙ БАГ» төлөвөөр
--    ДАРАА НЬ илэрхийлэгдэнэ.  ИЛРҮҮЛЭЛТ ба БАГЦ хоёрыг ЭНД БҮҮ ХОЛИ.

-- 3-р шат · user_primary · 0.85
-- ⚠️ `is_primary = 1` нь ЗААВАЛ (§2.6-ийн 42 → 242 гэмтэл).
SELECT tm.code AS team_code
  FROM user_teams ut
  JOIN teams tm ON tm.id = ut.team_id
 WHERE ut.user_id = ? AND ut.is_primary = 1;
```

**Хоёр БАТАЛГААЖУУЛАГЧ шат:**

```
4-р шат · sheet_prefix · 0.65
  `revit_sheet_bindings.sheet_number`-ээс `codePrefix()` (revitMatch.ts:63-71).
  ⚠️ ГУРВАН нөхцөл ЗААВАЛ хангагдана:
     (a) ≥3 хуудас дээр ижил угтвар (modal prefix),
     (b) угтварын урт нь `foldText(teams.code)`-ийн уртай ЯГ таарна,
     (c) тухайн код нь `foldableTeamCodes()`-ийн хасах жагсаалтад БАЙХГҮЙ.
  Ганц үсэгтэй фолд (BB) нь (c)-гээр шууд хасагдана.

5-р шат · behavior · ≤0.60
  `revit_element_touches.category`-ийн холимог vs багийн профайл:
     Ducts / Air Terminals / Mechanical Equipment       → HAS
     Pipes / Plumbing Fixtures / Pipe Fittings          → TSBU
     Lighting Fixtures / Electrical Equipment / Conduit → TSAH
     Furniture / Casework / Ceilings                    → IZ
     Structural Framing / Structural Foundations / Rebar→ BB
     Walls / Doors / Windows / Rooms                    → BA
  ⚠️ §48-R2 нь ЗӨВХӨН инференс дээр тулгуурлахыг хориглодог тул энэ нь
     ХЭЗЭЭ Ч дангаараа шийдэхгүй.  Профайл нь `lib/teamContext.ts`-д
     тогтмол Record — `teams.code` дээр түлхүүрлэгдэнэ, шинэ код нэмэхэд
     зүгээр л профайлгүй үлдэнэ (унахгүй).
```

**UNCERTAIN-ийн үед ЯГ ЮУ БОЛОХ (ДООШ БУУНА, ХЭЗЭЭ Ч БЛОКЛОХГҮЙ):**

| Юу | Утга |
|---|---|
| `team_code` | `NULL` |
| `team_confidence` | `0.0` |
| `team_source` | `'uncertain'` |
| Хамрах хүрээ (§47) | `GLOBAL` + `COMPANY` + `PROJECT`. **`TEAM` ачаалагдахгүй** — багийн дүрмийн багц НЭГ Ч ачаалагдахгүй. |
| Сургалтын эрх (§73-R3) | **БАЙХГҮЙ.** Тэр сессийн үйл явдал сургалтын багцад орохгүй. |
| UI | Самбарын статусын мөрөнд НЭГ chip: «Баг: тодорхойгүй». 4/5-р шатнаас урьдчилан бөглөгдсөн сонгогч. |
| Юу ХИЙХГҮЙ | Диалог нээхгүй, `DockablePane.Show()` дуудахгүй, `SetBusy` хийхгүй, ажлыг блоклохгүй, дахин дахин сануулахгүй. |

**ДҮРМИЙН БАГЦГҮЙ БАГ — UNCERTAIN-ААС ӨӨР ТӨЛӨВ (ЭЗЭН БАТАЛСАН 2026-08-30):**

Илрүүлэлт **амжилттай** болсон ч шийдэгдсэн багт дүрмийн багц байхгүй байж болно. Эзэн 2026-08-30-нд салбарын **найм** багийг баталсан (§2.17) тул `teams`-ийн үлдсэн гурав — **`MGMT`, `EZ`, `GT`** — багцгүй үлдэнэ. Энэ нь UNCERTAIN **БИШ**, түүнтэй ХЭЗЭЭ Ч ХОЛИГДОХГҮЙ:

| | **UNCERTAIN** (илрүүлэлт унасан) | **ДҮРМИЙН БАГЦГҮЙ БАГ** (илрүүлэлт амжилттай) |
|---|---|---|
| Утга | Нэр дэвшигч огт байхгүй, эсвэл шийдвэрлэгч шатууд ЗӨРСӨН | Баг ТОДОРХОЙ; тэр багт багц зохиогдоогүй |
| `bim_sessions.team_code` | `NULL` | **Бодит код** (`MGMT` / `EZ` / `GT`) |
| `team_source` | `'uncertain'` | Шатны бодит эх сурвалж (`binding`, `document`, `project_shares`, `user_primary`, `manual`) |
| `team_confidence` | `0.0` | Шатны бодит итгэлцэл (1.00 … 0.75) |
| `team_attributions` мөр | Бичигдэнэ (`inferred_team_code` NULL) | Бичигдэнэ, **бодит кодтой** |
| `learning_events`-ийн шошго (§3.7 `stampTeam`) | `team_code: null` | **`team_code` = тэр код** — сургалтын өгөгдөл ЗӨВ ХАРЬЯАЛАГДАНА |
| Хамрах хүрээ (§47) | `GLOBAL` + `COMPANY` + `PROJECT` | `GLOBAL` + `COMPANY` + `PROJECT` (ижил — `TEAM` ачаалагдахгүй) |
| Нийцлийн шалгалт | Ажиллахгүй | **Тэр сесст АЛГАСАГДАНА** (`complianceEnabled` → `false`) |
| Самбарын chip | «Баг: тодорхойгүй» | «Баг: EZ (дүрмийн багцгүй)» — баг нь МЭДЭГДЭЖ байна |
| Хэрэглэгчээс юу шаардах | Chip дээр дарж баг сонгох (§73-ын залруулга) | **ЮУ Ч ШААРДАХГҮЙ** — залруулах зүйл алга, баг нь зөв |

⛔ **ХАМГИЙН ЧУХАЛ:** багцгүй баг нь ӨӨР БАГИЙН дүрэм рүү **ХЭЗЭЭ Ч УНАХГҮЙ**. «MGMT-д багц алга, тэгвэл BA-гийнхыг хэрэглэе» гэдэг нь v2 §48-R6-ийн «do not silently apply the wrong team's rules»-ийн ЯГ тэр зөрчил. Багц алга бол шалгалт **АЛГА**, орлуулга БИШ.

⚠️ **Яагаад шошго нь ҮЛДЭХ ЁСТОЙ вэ:** §72 нь цуглуулсан мөр бүр багаар шошголсон байхыг шаарддаг. Багцгүй багийн сессийг `team_code: null` болгож «дугуйлбал» тэр ажил БАГГҮЙ корпуст орно, дараа нь MGMT/EZ/GT-д багц зохиох болвол ЭХЛЭХ өгөгдөл нь алга болсон байна. Шошго нь үнэ төлбөргүй (`stampTeam`, bind зардал тэг); шалгалт нь тийм биш.

⚠️ **Багцын жагсаалт ХАТУУ БИЧИГДЭХГҮЙ.** `complianceEnabled(d, packedTeamCodes)` нь багцтай багуудын олонлогийг **АРГУМЕНТААР** авна; ажиллах үед 2-2-ын дүрмийн бүртгэлээс уншигдана. Эзэн баталсан найм нь **ТӨЛӨВЛӨЛТИЙН** тоо — хэдэн багц зохиох вэ гэдэг нь, кодод шалгах литерал БИШ (⛔ хориг 11).

### 3.5 `backend/src/lib/teamContext.test.ts` (ШИНЭ) — 20 тохиолдол

```ts
// Run with:  node --test src/lib/teamContext.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// ⚠️ Эх код нь өргөтгөлгүй харьцангуй импорт бичдэг; Node-ийн ESM loader
// түүнийг шийддэггүй (`webPush.test.ts:18-28`-ын ижил заль).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const { decideTeam, foldableTeamCodes, isTeamCodeShape, scopesFor,
        complianceEnabled, TEAM_ACCEPT_CONFIDENCE,
        TIER_CONFIDENCE } = await import('./teamContext.ts');
```

Заавал байх тохиолдлууд:

| # | Тохиолдол | Хүлээгдэх |
|---|---|---|
| 1 | Зөвхөн `binding` = BA | `BA`, 1.00, `binding` |
| 2 | Зөвхөн `document` = IZ | `IZ`, 0.95, `document` |
| 3 | Зөвхөн `project_shares` = HAS | `HAS`, 0.75, `project_shares` |
| 4 | Зөвхөн `user_primary` = TSAH | `TSAH`, 0.85, `user_primary` |
| 5 | `project_shares`=HAS **ба** `user_primary`=BA | **UNCERTAIN**, `conflict = ['HAS','BA']` — өргөтгөсөн зөрчлийн дүрэм: `project_shares` нь хүнээс гараагүй тул `user_primary`-г ЧИМЭЭГҮЙ дарж чадахгүй |
| 5б | `project_shares`=HAS, `user_primary` нэр дэвшигч БАЙХГҮЙ | `HAS`, 0.75, `project_shares` — зөрчих тал байхгүй тул дараалал хэвийн ажиллана |
| 5в | `project_shares`=HAS **ба** `user_primary`=HAS (санал нийлэв) | `HAS`, 0.75, `project_shares` — зөрчил БИШ |
| 6 | `binding`=BA, `user_primary`=IZ | **UNCERTAIN**, `conflict = ['BA','IZ']` |
| 6б | `document`=IZ, `user_primary`=BA | **UNCERTAIN**, `conflict = ['IZ','BA']` — 1b шат ч мөн хүнээс гараагүй |
| 7 | §2.6-ын гэмтэл: `user_teams` нь BA(primary), IZ, EZ | `BA` — хоёрдогч мөрүүд нэр дэвшигч ҮҮСГЭХГҮЙ |
| 8 | Зөвхөн `sheet_prefix` = BA (0.65) | **UNCERTAIN** — баталгаажуулагч дангаараа шийдэхгүй |
| 9 | Зөвхөн `behavior` = HAS (0.60) | **UNCERTAIN** |
| 10 | `sheet_prefix`=BA + `behavior`=BA | **UNCERTAIN** — гэхдээ candidates-д хоёулаа |
| 11 | Нэр дэвшигч огт байхгүй | **UNCERTAIN**, `candidates = []` |
| 12 | `foldableTeamCodes(['BA','BB','HAS','TSBU','IZ'])` | `BB` **БАЙХГҮЙ** (фолд `'b'`, 2 тэмдэгтээс богино) |
| 13 | `foldText('BB') === foldText('Б')` шалгалт | Хоёулаа `'b'` — иймд угтвар дангаараа BB-г шийдэж ЧАДАХГҮЙ |
| 14 | `isTeamCodeShape('NORM')` | `false` — нөөцлөгдсөн |
| 15 | `isTeamCodeShape('ba')` | `false` — том үсэг шаардлагатай |
| 16 | `scopesFor(UNCERTAIN)` | `['GLOBAL','COMPANY','PROJECT']` — `TEAM` **БАЙХГҮЙ** |
| 17 | `TIER_CONFIDENCE.sheet_prefix > TEAM_ACCEPT_CONFIDENCE` | `false` — босго нь баталгаажуулагчийг ХАСНА |
| 18 | Босгын харьцуулалт нь ХАТУУ `>` | 0.70 яг тэнцүү нэр дэвшигч → UNCERTAIN |
| 19 | `complianceEnabled({team_code:'EZ', team_source:'user_primary', …}, new Set(['BA','BB','HAS','TSBU','TSAH','HD','AU','IZ']))` | `false` — багц алга. ⚠️ ГЭХДЭЭ шийдвэр нь `team_code === 'EZ'`, `team_source === 'user_primary'` хэвээр — `'uncertain'` **БИШ** (эзэн баталсан 2026-08-30, §3.4-ийн харьцуулах хүснэгт) |
| 20 | `scopesFor({team_code:'EZ', …}, <дээрх багц>)` | `['GLOBAL','COMPANY','PROJECT']` — `TEAM` БАЙХГҮЙ, гэвч UNCERTAIN-аас ӨӨР шалтгаанаар. Мөн `scopesFor(<ижил>, undefined)` → `TEAM` БАЙНА (багцын шүүлтгүй хуучин зан төлөв) |

### 3.6 `backend/src/routes/revit.ts` — дөрвөн өөрчлөлт

| # | Юу | Дэлгэрэнгүй |
|---|---|---|
| 1 | **`GET /api/revit/team-context`** — ШИНЭ | Query: `doc_uid` (сонголттой), `project_id` (сонголттой), `hint_team_code` (сонголттой, **ЗӨВХӨН НОТОЛГОО**). **ХЭЗЭЭ Ч 404 өгөхгүй** (`/context`-ийн `:792`-ээс ялгаатай — §2.8). Баримт бүртгэгдээгүй бол `team_source: 'uncertain'` буцаана. Хариу: `{ team_code, team_confidence, team_source, team_last_verified, conflict, candidates[], scopes[], compliance_enabled, attribution_id, teams[] }`. `teams[]` нь **АМЬД РОСТЕР** (`SELECT code, name_mn, sort_order FROM teams ORDER BY sort_order`) — клиент ростерын тоог (8/9/11) хатуу бичихгүйн тулд; тэр нь `teams`-ийн **БҮХ** мөр (өнөөдөр 11), зөвхөн багцтай найм БИШ (§2.17). `compliance_enabled` нь `complianceEnabled(decision, packedTeamCodes)`-ийн үр дүн — багцгүй баг (MGMT/EZ/GT) шийдэгдвэл `false`, ГЭВЧ `team_code` нь бодит код, `team_source` нь `'uncertain'` БИШ (§3.4). Кэш **БАЙХГҮЙ** (`withEdgeCache` нь хэрэглэгчээр хуваадаггүй). |
| 2 | **`POST /api/revit/team-context/verify`** — ШИНЭ | Body: `{ doc_uid?, project_id?, session_uid?, team_code, sticky? }`. **ЭРХИЙН ХААЛГА:** `team_code` нь дуудагчийн `user_teams`-ийн ЯМАР Ч мөрөнд байх ЁСТОЙ (`is_primary` шаардлагагүй — хүн өөрийн хоёрдогч багаа сонгож болно) ЭСВЭЛ `isManager(user.role)`; эс бөгөөс **403**. §82-ийн 4-р шалгуур (тэг хөндлөн-багийн алдагдал). Үйлдэл: (а) `team_attributions`-д ШИНЭ мөр (`verified_team_code`, `verified_by = user.sub`, `verified_at`, `verified_via`), (б) өмнөх амьд мөрийг `superseded_by`/`superseded_at`-аар хаана, (в) нээлттэй `bim_sessions` мөрийг UPDATE (`team_source = 'manual'`, `team_confidence = 1.0`, `team_last_verified = datetime('now')`), (г) `sticky === true` бол `revit_documents.team_code`-ийг бичнэ. |
| 3 | **`GET /api/revit/team-attributions`** — ШИНЭ | Query: `doc_uid` эсвэл `session_uid`. **ЗӨВХӨН ӨӨРИЙГӨӨ ХАРНА** — `WHERE user_id = ?` (`user.sub`). Менежер ч гэсэн өөр хүний мөр харахгүй: элемент түвшний үйл ажиллагаа нь өөрийгөө-харах-л зарчимтай (0201:23-32, `0203:27`, `0205:44`-д гурав давтагдсан, `revitNoteAi.test.ts:262`-т түгжигдсэн). |
| 4 | **`GET /api/revit/context`-д `team` блок** | Одоо байгаа хариунд НЭМЭЛТ талбар: `"team": { team_code, team_confidence, team_source, team_last_verified, conflict }`. Байгаа талбар НЭГ Ч өөрчлөгдөхгүй — хуучин add-in-ууд үл мэдэгдэх талбарыг чимээгүй хаяна (`System.Text.Json`-ийн анхдагч). |
| 5 | **handshake нь `revit_documents.team_code` бичнэ** | `revit.ts:357-360`-ийн INSERT-д `team_code` НЭМЭГДЭНЭ (шатнаас шийдэгдсэн утга эсвэл NULL). `:347-351`-ийн UPDATE-д **ЗӨВХӨН одоогийн утга NULL байвал** бичнэ — **хүний бичсэн утгыг ХЭЗЭЭ Ч дарж бичихгүй** (§73-ын буцаагдах чанар). |

**`lib/modules.ts`-д өөрчлөлт ХЭРЭГГҮЙ** — гурван гарц бүгд `/api/revit` дор, тэр угтвар `API_PREFIXES` (`modules.ts:99`) ба `MODULE_OF` (`:166`)-д аль хэдийн байгаа, `workerScope`-д байхгүй тул `worker` автоматаар 403.

### 3.7 `backend/src/lib/bimEvents.ts` — эмитерийн ХӨЛДӨӨЛТ

`SESSION_INSERT_COLUMNS` (`bimEvents.ts:354-381`)-ийн ТӨГСГӨЛД дөрөв нэмнэ (дараалал нь `SESSION_VALUES_TUPLE`-тэй уялдана):

```ts
  'txn_count',
  'event_count',
  'dropped_count',
+ // §48-R4-ийн дөрвөл.  0217-д нэмэгдсэн.  27 → 31 bind, дараа нь
+ // `company_id` (Ш3) → 32, `perf_json` (0226) → 33,
+ // floor(100/34) = 2 — SESSION_ROWS_PER_STATEMENT 3-аас 2 БУУРНА (Ш3).
+ 'team_code',
+ 'team_confidence',
+ 'team_source',
+ 'team_last_verified',
+ // §72 (Ш3) ба 2-4-ийн 0226 — ДАРААЛАЛ ЛОАД-БЕАРИНГ: баг, дараа нь
+ // company_id, ХАМГИЙН СҮҮЛД perf_json.
+ 'company_id',
+ 'perf_json',
] as const;
```

Мөн **үйл явдал бичих замд ХӨЛДӨӨЛТ**:

```ts
/**
 * ⚠️ ҮЙЛ ЯВДЛЫН БАГЫГ БИЧИХ МӨЧИД ХӨЛДӨӨНӨ, JOIN-ААР ШИЙДЭХГҮЙ.
 *
 * `bim_sessions.team_code` нь ОДООГИЙН төлөв.  Хэрэв `learning_events`-ийн
 * багыг `session_id`-аар JOIN хийж шийдвэл §73-ын нэг залруулга (нэг мөрийн
 * UPDATE) нь хэдэн зуун ХӨДӨЛШГҮЙ мөрийн УТГЫГ дахин бичнэ.  0206-ын
 * триггер тэднийг ЗАСАХ БОЛОМЖГҮЙ болгодог тул энэ нь эргэлт буцалтгүй.
 *
 * Иймд `payload_json` руу дөрвийг ХИЙНЭ: `team_code`, `team_source`,
 * `team_confidence`, `attribution_id`.  0219 нь эхний хоёрыг GENERATED
 * VIRTUAL болгож индекслэнэ — bind зардал ТЭГ.
 *
 * ⚠️ ДҮРМИЙН БАГЦГҮЙ БАГ (`MGMT` / `EZ` / `GT` — эзэн баталсан 2026-08-30,
 * §2.17) нь ЭНД ЯЛГААГҮЙ: `team_code` нь тэр багийн БОДИТ код байна.
 * Нийцлийн шалгалт алгасагдсан ч ШОШГО үлдэх ЁСТОЙ (§3.4-ийн харьцуулах
 * хүснэгт) — эс бөгөөс тэр ажил БАГГҮЙ корпуст ороод, дараа нь тэр багт
 * багц зохиох үед эхлэх өгөгдөл БАЙХГҮЙ болно.  ⛔ Багцгүй гэдгээр
 * `team_code`-ыг NULL болгох нь §72-ын шаардлагыг ЗӨРЧИНӨ.
 */
export function stampTeam(
  payload: Record<string, unknown>,
  ctx: { team_code: string | null; team_source: TeamSource;
         team_confidence: number; attribution_id: number | null },
): Record<string, unknown>;
```

⚠️ **§72-ын зургаан талбарын бодит байрлал** (энэ сессийн шийдвэр):

| §72-ын талбар | Хаана | Тайлбар |
|---|---|---|
| `company_id` | **`bim_sessions.company_id` (0217)** — ЭЗЭН БАТАЛСАН Ш3, 2026-08-31 | TEXT (`lib/tenants.ts`-ийн `TenantSpec.id`; `companies` ХҮСНЭГТ БАЙХГҮЙ), анхдагч `'default'` = `requestContext.DEFAULT_TENANT_ID`.  Bind 27 → 32 → 33 (`perf_json`), `floor(100/34)=2`.  Эзэн зардлыг МЭДСЭЭР БАЙЖ баталсан: `bim_sessions` бага урсгалтай.  ⛔ ДАРААГИЙН бодит багана нэмэхгүй — шинэ тоо `perf_json` / `payload_json` дотор. |
| `team_id` | `bim_sessions.team_code` (0217) + `payload_json` (0219) | TEXT, INTEGER БИШ (0069-ийн прецедент). |
| `project_id` | Аль хэдийн байгаа | `bim_sessions.project_id` (`0202:55`). |
| `user_role` | `payload_json`, эмит хийх мөчид токеноос | Багана БИШ — bind зардалгүй, JWT нь `{sub, role}` зөөнө. |
| `project_phase` | **2-2-ын `project_build_context` (0226)** | Энэ сесс эзэмшихгүй. |
| `discipline` | **== `team_code`** | Хоёр талбар БИШ. MGL-д салбар = баг; хоёр нэр нь зөрөх боломж үүсгэнэ. |

### 3.8 `revit-mcp/addin/TeamContext.cs` (ШИНЭ) — цэвэр, net48-д тохирсон

```csharp
/// <summary>
/// Багийн контекстийн КЭШ ба ТӨЛӨВ.  ЦЭВЭР — `Autodesk.Revit.*` төрөл
/// НЭГ Ч БАЙХГҮЙ.
///
/// ⚠️ ЯАГААД REVIT-ГҮЙ ВЭ:
///   (1) net48 (Revit 2024) build дээр ч хөрвөх ёстой,
///   (2) `check_team_context.py` нь `dotnet run`-аар ЭНЭ ГАНЦ ФАЙЛЫГ
///       Revit суулгацгүйгээр хөрвүүлж тестэлнэ — `Nudges.cs`,
///       `Timing.cs`, `Percentiles.cs`-ийн ижил загвар.  Add-in-д
///       C# тест ТЭГ байгаа тул энэ бол цорын ганц хамрах боломж.
///
/// ⚠️ ЭНЭ АНГИ БАГ ШИЙДДЭГГҮЙ.  Шат нь СЕРВЕР дээр
/// (`backend/src/lib/teamContext.ts`).  Энд зөвхөн: кэш унших/бичих,
/// шинэчлэх хугацаа, chip-ийн текст.
/// </summary>
public static class TeamContext
{
    /// <summary>%APPDATA%\RevitMcpAddin\team-context.json</summary>
    public static string CachePath { get; }

    /// <summary>Сервер дахин асуухаас өмнөх хамгийн бага завсар.</summary>
    public const int RefreshIntervalSec = 900;   // 15 мин

    /// <summary>Сүлжээгүй үед кэш хүчинтэй байх дээд хугацаа.</summary>
    public const int StaleAfterSec = 86400;      // 24 цаг

    /// <summary>Багийн контекст авах HTTP хүлээлтийн дээд хугацаа.</summary>
    public const int RequestTimeoutSec = 5;

    public sealed class State
    {
        public string TeamCode;        // null = UNCERTAIN
        public double Confidence;
        public string Source;          // TEAM_SOURCES-ийн нэг
        public string LastVerified;    // ISO-8601 эсвэл null
        public string[] Conflict;      // null = зөрчилгүй
        public string[] Candidates;    // сонгогчийг урьдчилан тэмдэглэхэд
        // ⚠️ Серверийн `scopes`-д "TEAM" байгаа эсэх.  false + TeamCode != null
        //    = ДҮРМИЙН БАГЦГҮЙ БАГ (MGMT/EZ/GT — эзэн баталсан 2026-08-30).
        //    Клиент багцын ЖАГСААЛТЫГ мэдэхгүй — зөвхөн энэ туг (⛔ хориг 11).
        public bool   HasRulePack;
        public long   FetchedAtUnix;
    }

    /// <summary>
    /// СҮҮЛД хэрэглэгдсэн төлөв.  `LoadCache()` ба `RefreshTeamContextSoon`
    /// хоёулаа энд бичнэ; `App.OnShutdown` (§3.12) үүнийг диск рүү хадгална.
    /// ⚠️ `volatile` — арын thread бичиж, UI thread уншина.  Түгжээ БАЙХГҮЙ:
    /// нэг лавлагаа солих нь атом, ба `State` нь бичигдсэний дараа
    /// ХЭЗЭЭ Ч ӨӨРЧЛӨГДӨХГҮЙ (immutable-аар хэрэглэнэ).
    /// </summary>
    public static volatile State Current;

    /// <summary>
    /// UNCERTAIN эсэх — `TeamCode == null`, өөрөөр хэлбэл ИЛРҮҮЛЭЛТ УНАСАН.
    /// ⚠️ Энэ нь `!HasRulePack`-тай ИЖИЛ БИШ (эзэн баталсан 2026-08-30):
    /// багцгүй баг нь МЭДЭГДЭЖ байгаа баг — chip түүнийг НЭРЛЭНЭ, «тодорхойгүй»
    /// гэж ХЭЛЭХГҮЙ, хэрэглэгчээс залруулга ч ШААРДАХГҮЙ (§3.4).
    /// </summary>
    public static bool IsUncertain(State s);

    /// <summary>
    /// Дахин асуух эсэх (цэвэр, тестлэгдэх).
    /// ⚠️ `s == null` (кэш байхгүй / уншилт унасан) бол **ҮРГЭЛЖ `true`** —
    /// эс бөгөөс эхний ажиллуулалтад ХЭЗЭЭ Ч асуулга явахгүй ба §3.11-ийн
    /// chip мөнхөд хоосон үлдэнэ.
    /// </summary>
    public static bool ShouldRefresh(State s, long nowUnix);

    /// <summary>Кэш нь хэтэрхий хуучирсан эсэх — chip дээр «(хуучин)» нэмнэ.</summary>
    public static bool IsStale(State s, long nowUnix);

    /// <summary>Chip-ийн текст.  mn/en — `Lang.T`-ийн ижил дүрэм.</summary>
    public static string ChipText(State s, bool mongolian);
    //  binding        → «Баг: BA (холбоосоор)»       / "Team: BA (binding)"
    //  document       → «Баг: BA (файлаас)»          / "Team: BA (document)"
    //  project_shares → «Баг: HAS (төслөөс)»         / "Team: HAS (project)"
    //  user_primary   → «Баг: BA (профайлаас)»       / "Team: BA (profile)"
    //  manual         → «Баг: BA ✔»                  / "Team: BA ✔"
    //  uncertain      → «Баг: тодорхойгүй»           / "Team: unknown"
    //  conflict != null → «Баг: тодорхойгүй (BA/IZ)» / "Team: unknown (BA/IZ)"
    //  ⚠️ HasRulePack == false, TeamCode != null (MGMT/EZ/GT — эзэн баталсан
    //     2026-08-30) → «Баг: EZ (дүрмийн багцгүй)» / "Team: EZ (no rule pack)"
    //     — «тодорхойгүй» ГЭЖ ХЭЛЭХГҮЙ.  Баг зөв илрүүлэгдсэн, зөвхөн
    //     нийцлийн шалгалт алгасагдсан."

    /// <summary>
    /// Дискнээс уншина.  ⚠️ Хоёр Revit нэг %APPDATA% хуваалцаж болно тул
    /// түр файл нь process-id дагаварт: `team-context.<pid>.json.tmp`,
    /// дараа нь `File.Move` (ChangeTracker.cs:577-581-ийн загвар).
    /// Уншилт унавал `null` — ХЭЗЭЭ Ч шидэхгүй.
    /// </summary>
    public static State LoadCache();
    public static void  SaveCache(State s);
}
```

### 3.9 `revit-mcp/addin/RevitApi.cs` — DTO + хоёр арга

```csharp
public class TeamContextResult
{
    [JsonPropertyName("team_code")]        public string TeamCode { get; set; }
    [JsonPropertyName("team_confidence")]  public double Confidence { get; set; }
    [JsonPropertyName("team_source")]      public string Source { get; set; }
    [JsonPropertyName("team_last_verified")] public string LastVerified { get; set; }
    [JsonPropertyName("conflict")]         public List<string> Conflict { get; set; }
    [JsonPropertyName("candidates")]       public List<TeamCandidateDto> Candidates { get; set; }
        = new List<TeamCandidateDto>();
    [JsonPropertyName("scopes")]           public List<string> Scopes { get; set; }
        = new List<string>();
    [JsonPropertyName("attribution_id")]   public long? AttributionId { get; set; }
    /// <summary>АМЬД РОСТЕР — клиент багийн тоог (8/9/11) ХЭЗЭЭ Ч хатуу
    /// бичихгүйн тулд.  `teams`-ийн БҮХ мөр (өнөөдөр 11), зөвхөн дүрмийн
    /// багцтай найм БИШ (§2.17).</summary>
    [JsonPropertyName("teams")]            public List<TeamRosterDto> Teams { get; set; }
        = new List<TeamRosterDto>();
}

/// <summary>
/// GET /api/revit/team-context — ХЭЗЭЭ Ч 404 өгөхгүй.
///
/// ⚠️ `TeamContext.RequestTimeoutSec` (5 сек) -ийн `CancellationTokenSource`
/// -оор хязгаарлана.  `ApiClient.Http`-ийн 180 секундыг ХЭРЭГЛЭЖ БОЛОХГҮЙ:
/// тэр нь 20k мөрийн QTO push-д зориулагдсан (`ApiClient.cs:56`), 5 секундын
/// chip нь гурван минут «дүүжлэгдэж» болохгүй.
///
/// ⚠️ `hintTeamCode` нь ЗӨВХӨН НОТОЛГОО.  Сервер `user_teams`-ээр
/// баталгаажуулна; клиентийн зарлалыг ХЭЗЭЭ Ч итгэхгүй.
/// </summary>
public static Task<TeamContextResult> GetTeamContextAsync(
    string host, string token, string docUid, int? projectId, string hintTeamCode = null);

/// <summary>
/// POST /api/revit/team-context/verify — §73-ын залруулга.
/// `sticky = true` бол сервер `revit_documents.team_code`-ийг бичнэ.
/// </summary>
public static Task<TeamContextResult> VerifyTeamAsync(
    string host, string token, string docUid, int? projectId,
    string teamCode, bool sticky);
```

⚠️ **`RevitApi.TimeoutFor` (`:489-514`) нь ХӨНДӨГДӨХГҮЙ, `RevitTools.ToolNames` (`RevitTools.cs:53-65`) ч мөн адил.** Энэ сесс **ШИНЭ Revit хэрэгсэл нэмэхГҮЙ**: 1–3-р шатны бүх нотолгоо серверт handshake-ээр аль хэдийн байдаг (`revit_sheet_bindings.sheet_number`), 4-р шат түүнээс тооцогдоно. Иймд `AgentChat.ToolSpecs`, `ClientAllowedTools`, `lib/revitAgent.ts` `ALLOWED_TOOLS`, `mgl_agent.ALLOWED`, `revit_mcp/server.py` — таван ихэр жагсаалтын АЛЬ Ч НЬ хөндөгдөхгүй. `TeamContext.RequestTimeoutSec = 5` нь тэр 5 секундын «хувин».

### 3.10 `revit-mcp/addin/QtoDtos.cs` — `TeamOverride` бол ЗӨВЛӨМЖ, ЗАРЛАЛ БИШ

```csharp
        /// <summary>
        /// Хэрэглэгчийн сонгосон баг — ⚠️ ЗӨВЛӨМЖ (hint), ЗАРЛАЛ БИШ.
        ///
        /// Сервер рүү `hint_team_code` гэж илгээгдэнэ.  Сервер түүнийг
        /// `user_teams` (аль ч харьяалал) эсвэл `isManager`-ээр
        /// БАТАЛГААЖУУЛНА; эс бөгөөс 403.  Энэ файлыг тухайн Windows
        /// хэрэглэгч засаж чадах тул ХЭЗЭЭ Ч эрхийн эх сурвалж БОЛОХГҮЙ
        /// (§82-ийн 4-р шалгуур: тэг хөндлөн-багийн алдагдал).
        /// </summary>
        [JsonPropertyName("team_override")]
        public string TeamOverride { get; set; }
```

### 3.11 `AssistantPane.xaml` + `.xaml.cs` — блоклохгүй chip

`AssistantPane.xaml:333`-ын `StatusText`-ийн ХАЖУУД:

```xml
<Border x:Name="TeamChip" Visibility="Collapsed"
        Margin="8,0,0,0" Padding="6,1" CornerRadius="8"
        Background="{DynamicResource ChipBg}">
  <StackPanel Orientation="Horizontal">
    <TextBlock x:Name="TeamChipText" Style="{StaticResource MutedText}" />
    <Button   x:Name="TeamChipFix" Content="…" Margin="4,0,0,0"
              Style="{StaticResource LinkButton}" Visibility="Collapsed" />
  </StackPanel>
</Border>
```

```csharp
/// <summary>
/// Chip-ийг шинэчилнэ.  ⚠️ ЯГ ГУРВАН ХОРИГ:
///   (1) `SetBusy` ХЭРЭГЛЭХГҮЙ — тэр нь `Mouse.OverrideCursor`-ыг
///       АППЛИКЕЙШН ДАМЖУУЛАН тавьдаг (`AssistantPane.xaml.cs:351`);
///       арын chip нь бүх Revit-ийг «завгүй» болгож харагдуулна.
///   (2) `DockablePane.Show()` / `Focus()` ХЭЗЭЭ Ч ДУУДАХГҮЙ.  Add-in дахь
///       цорын ганц `Show()` нь хэрэглэгчийн ribbon даралт
///       (`AssistantPaneProvider.cs:54`).  Самбар хаалттай байвал chip
///       зүгээр л ХҮЛЭЭНЭ — файл нээх бүрт 300 px булаах нь R7-ийн эвдрэл.
///   (3) `ChangeTracker.Gate` эсвэл tool-bus `Gate` барьсан thread-ээс
///       `Dispatcher.Invoke` ХЭЗЭЭ Ч дуудахгүй — UI thread өөрөө
///       `lock (Gate)`-д блоклогдож болох тул deadlock болно.  Энэ арга
///       нь ЗӨВХӨН `Dispatcher.InvokeAsync` (галт-мартах) ашиглана.
/// </summary>
private void SetTeamChip(TeamContext.State s);

/// <summary>
/// Баримт солигдоход арын thread дээр багийн контекст асууна.
/// `Task.Run` — `RevitToolBus.Call`-ыг UI thread-ээс дуудвал deadlock
/// (`AssistantPane.xaml.cs:186-189`-ийн ижил дүрэм).  Гэхдээ энэ нь
/// tool-bus-д ОГТ хүрэхгүй, зөвхөн HTTP.
/// Алдаа гарвал ЧИМЭЭГҮЙ — кэшийн утга үлдэнэ, хэрэглэгчид юу ч
/// харагдахгүй (§75-ын доройтол).
///
/// ⚠️ ДУУДАГДАХ ЦОРЫН ГАНЦ ГАЗАР: `ReloadAsync` (`AssistantPane.xaml.cs:364`)
/// -ийн ТӨГСГӨЛ, `docUid` тодорхой болсны ДАРАА.  `ReloadAsync` бол
/// `get_document_context`-ыг дахин уншдаг ГАНЦ зам тул тэр нэг цэг нь
/// самбар ачаалагдах (`:290`), «Шинэчлэх» товч (`:1328`), холбоос
/// үүсгэсний дараах дахин уншилт (`:673`, `:1309`, `:1812`) — БҮГДИЙГ
/// хамарна.  Тусдаа `DocumentOpened` захиалга НЭМЭХГҮЙ.
///
/// ⛔ `ChangeTracker.OnDocumentChanged`-ээс ХЭЗЭЭ Ч БИШ, мөн
/// `ChangeTracker.Gate` эсвэл tool-bus `Gate` барьсан ЯМАР Ч thread-ээс
/// БИШ (⛔ хориг 7 ба 9).
/// </summary>
private void RefreshTeamContextSoon(string docUid)
{
    AddinSettings st = Settings;
    if (string.IsNullOrEmpty(st.Token)) return;

    TeamContext.State cached = TeamContext.Current;
    long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
    if (!TeamContext.ShouldRefresh(cached, now)) return;   // 15 мин доторх — сүлжээ хөндөхгүй

    // `SyncIntentModelSoon` (`:1928-1958`)-ийн ЯГ ИЖИЛ загвар: галт-мартах
    // `Task.Run`, төгсгөлд нь `Dispatcher.InvokeAsync`.
    _ = Task.Run(async () =>
    {
        try
        {
            TeamContextResult r = await RevitApi
                .GetTeamContextAsync(st.ApiHost, st.Token, docUid, st.ProjectId, st.TeamOverride)
                .ConfigureAwait(false);
            if (r == null) return;

            // ⚠️ Талбаруудыг ЗАДЛАЖ өгнө — `TeamContext.cs` нь `RevitApi`-гийн
            //    DTO-г МЭДЭХГҮЙ (доорх `FromResult`-ийн тайлбарыг үз).
            TeamContext.State s = TeamContext.FromResult(
                r.TeamCode, r.Confidence, r.Source, r.LastVerified,
                r.Conflict?.ToArray(), r.Candidates?.Select(c => c.TeamCode).ToArray(),
                // ⚠️ Багцтай эсэхийг СЕРВЕРИЙН `scopes`-оос гаргана — клиент
                //    багцтай багуудын ЖАГСААЛТЫГ ХЭЗЭЭ Ч хадгалахгүй.
                r.Scopes != null && r.Scopes.Contains("TEAM"),
                DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            TeamContext.Current = s;
            TeamContext.SaveCache(s);          // диск — АРЫН thread дээр, UI хүлээхгүй

            await Dispatcher.InvokeAsync(() => SetTeamChip(s));
        }
        catch { /* офлайн / 5 сек timeout — кэшийн chip хэвээр (§75) */ }
    });
}
```

⚠️ **`ReloadAsync`-д НЭМЭГДЭХ ЯГ НЭГ МӨР** (`docUid` олдсоны дараа, `SetBusy(false)`-ийн өмнө):

```csharp
+           RefreshTeamContextSoon(docUid);
```

⚠️ Мөн `TeamContext`-д НЭГ хөрвүүлэгч нэмэгдэнэ — `RevitApi`-гүй, цэвэр:

```csharp
    /// <summary>Серверийн хариуг кэшийн төлөв болгоно.  ⚠️ Энэ файл
    /// `TeamContextResult`-ыг МЭДЭХГҮЙ (тэр нь `RevitApi.cs`-д, `net48`
    /// тестийн хамрах хүрээнээс ГАДНА) тул талбаруудыг ЗАДЛАЖ өгнө.</summary>
    public static State FromResult(string teamCode, double conf, string source,
                                   string lastVerified, string[] conflict,
                                   string[] candidates, bool hasRulePack,
                                   long nowUnix);
```

Chip дээр дарахад: `uncertain` бол `teams[]`-ээс сонгогч гарч ирнэ (`candidates`-аар урьдчилан тэмдэглэгдсэн); сонгоход `VerifyTeamAsync`. Энэ бол §71-R2-ийн зөвшөөрөгдсөн таван харилцан үйлдлийн **verification** — модаль диалог БИШ, самбар доторх мөр.

### 3.12 `revit-mcp/addin/App.cs` — өөрийн try/catch-д

`OnStartup` дотор, `ChangeTracker.Init`-ийн ДАРАА (`App.cs:68-75`-ийн блокийн дараа):

```csharp
            // Багийн контекстийн КЭШ — диск + JSON, Revit API БАЙХГҮЙ.
            // ⚠️ Тусдаа try: кэш эвдэрсэн бол баг «тодорхойгүй» болно,
            //    add-in бүхэлдээ ачаалагдахгүй байх нь ХАМААГҮЙ дор.
            // ⚠️ `LoadCache()` нь `TeamContext.Current`-ыг ЧУХ БӨГЛӨНӨ — §3.11-ийн
            //    `RefreshTeamContextSoon` тэндээс `ShouldRefresh`-ыг тооцно.
            try { TeamContext.Current = TeamContext.LoadCache(); }
            catch { /* кэшгүй эхэлнэ — сервер эхний хүсэлтэд хариулна */ }
```

`OnShutdown` дотор, `ChangeTracker.Shutdown`-ийн ДАРАА, `Metrics.EmitSummary`-ийн ӨМНӨ (`App.cs:165-186`-ын хооронд):

```csharp
            // ⚠️ `Current` нь §3.11-д бичигдсэн СҮҮЛИЙН төлөв; NULL бол
            //    (нэг ч амжилттай асуулга гараагүй) юу ч бичихгүй.
            try { if (TeamContext.Current != null) TeamContext.SaveCache(TeamContext.Current); }
            catch { /* унтраалт дээр чимээгүй */ }
```

⚠️ **`RevitToolBus.Shutdown()` ХАМГИЙН СҮҮЛД хэвээр** (`App.cs:194`). TeamContext нь tool-bus-д хүрдэггүй тул дараалал өөрчлөгдөхгүй.

### 3.13 `revit-mcp/training/check_team_context.py` (ШИНЭ) — шинэ хаалга

`check_nudge.py`-ийн ижил загвар: түр `.csproj` үүсгэж **ЗӨВХӨН `TeamContext.cs`**-ийг `net10.0` дээр `dotnet run`-аар хөрвүүлж, дараах баталгаануудыг шалгана:

| # | Батлах зүйл |
|---|---|
| 1 | `IsUncertain(state{TeamCode=null})` → `true` |
| 2 | `IsUncertain(state{TeamCode="BA"})` → `false` |
| 3 | `ShouldRefresh` нь `RefreshIntervalSec`-ийн дотор `false` |
| 4 | `ShouldRefresh` нь түүнээс хойш `true` |
| 5 | `IsStale` нь `StaleAfterSec`-ийн дараа `true` |
| 6 | `ChipText(uncertain, mn)` нь «тодорхойгүй» агуулна |
| 7 | `ChipText(conflict=['BA','IZ'], mn)` нь ХОЁУЛАНГ нь агуулна |
| 8 | `ChipText(...)` нь `TEAM_SOURCES`-ийн 8 утга тус бүрт ХООСОН БИШ мөр буцаана |
| 9 | `RequestTimeoutSec == 5` — 180 секундын `ApiClient.Http` руу гулсахаас сэргийлнэ |
| 10 | `ShouldRefresh(null, now)` → **`true`** — эхний ажиллуулалтад асуулга ЗААВАЛ явна (§3.11-ийн утас таслагдахаас сэргийлнэ) |
| 11 | `FromResult(...)` нь `Current`-ыг ӨӨРЧЛӨХГҮЙ (цэвэр хөрвүүлэгч); утга оноох нь ЗӨВХӨН дуудагчийн үүрэг |
| 12 | `ChipText(state{TeamCode="EZ", HasRulePack=false}, mn)` нь «EZ»-г агуулна БА «тодорхойгүй» гэж **ХЭЛЭХГҮЙ**; `IsUncertain(тэр state)` → **`false`**. Багцгүй баг нь UNCERTAIN БИШ (эзэн баталсан 2026-08-30, §3.4) |

Дараа нь `pull_and_retrain.py`-ийн хаалганы жагсаалтад (`:15-27`, `:578-597`) нэмнэ.

⚠️ 12-р хаалга нь **эзний 2026-08-30-ны шийдвэрийн** цорын ганц автоматжуулсан хамгаалалт клиент талд: MGMT/EZ/GT-г «тодорхойгүй» гэж харуулах регресс нь хоёр төлөвийг ХОЛИНО (§3.4).

---

## 4. ХӨНДӨЖ БОЛОХГҮЙ (load-bearing)

| Юу | Хаана (баталгаажсан) | Яагаад эвдрэх вэ |
|---|---|---|
| `/api/*` нь `purpose:'mcp'` токеныг хүлээж авдаг | `middleware/auth.ts:101-102`, `types.ts:209-212`, `lib/tokenValidity.ts:30-34` | Add-in бүх дуудлагаа түүгээр хийдэг, refresh БАЙХГҮЙ. ~20 PC, `Install.bat`, Revit хаалттай — алсаас сэргээх БОЛОМЖГҮЙ. |
| `users` / `projects` -ыг `migrations apply`-аар дахин бүтээхгүй | 19 ба 33 каскад хүүхэд | Хүүхэд мөр бүр устана. `team_attributions` дээр `REFERENCES` **байхгүй** нь тэр рискийг мөн хаана. |
| 0206-ын найман триггер | `0206_bim_append_only.sql:1-55` | `learning_events` дээр бодит багана нэмбэл түүнийг ард нь дүүргэх боломжгүй. 0219 нь ЗӨВХӨН VIRTUAL. |
| `bim_sessions` нь триггерээс ГАДНА | `check-bim-events.mjs:35` | Түүн дээр триггер нэмбэл §73-ын буцаагдах чанар БҮРМӨСӨН алга болно — багийг залруулах цорын ганц газар устана. |
| `SESSION_INSERT_COLUMNS`-ийн дараалал | `bimEvents.ts:354-381` + `SESSION_VALUES_TUPLE` `:385` | Дараалал `?`-уудтай уялддаг. Дунд нь оруулбал утгууд ХАЖУУ БАГАНА руу бичигдэнэ, алдаа гарахгүй. |
| `EVENT_BINDS = 23` | `bimEvents.ts:502-503` | +2 бодит багана нь `floor(100/26)=3` болгоно — хамгийн их урсгалтай хүснэгтийн ingest 25%-иар удаашрана (R7). |
| `ChangeTracker.OnDocumentChanged` | `ChangeTracker.cs:764-775`, `:798` | Тэнд транзакц, диск, сүлжээ, инференс — юу ч БАЙХГҮЙ. Сольсон сканнер 120+ секунд болдог байв. |
| `ChangeTracker.Gate` | `ChangeTracker.cs:275`, `:798` | Арын thread түүнийг барих нь Revit-ийн үндсэн thread-ийг гүйлгээ бүрт зогсооно. |
| `AssistantPaneProvider.cs:54`-ийн ЦОРЫН ГАНЦ `Show()` | `AssistantPaneProvider.cs:39-63` | Автоматаар нээх нь файл нээх бүрт фокус + 300 px булаана — R7-ийн эвдрэл. |
| `SetBusy` / `Mouse.OverrideCursor` | `AssistantPane.xaml.cs:341`, `:351` | АППЛИКЕЙШН ДАМЖСАН курсор. Арын chip түүнийг хэрэглэвэл Revit бүхэлдээ «завгүй» харагдана. |
| `App.cs`-ийн унтраалтын дараалал | `App.cs:165-194` | `RevitToolBus.Shutdown` ХАМГИЙН СҮҮЛД. Дундуур нь thread join оруулбал Revit хаагдахдаа өлгөгдөнө — хэрэглэгч түүнийг «сүйрэл» гэж уншиж, албадан хаана. |
| `revit_documents.team_code`-ийн хүний утга | §3.6-ийн 5-р мөр | Handshake нь ЗӨВХӨН NULL байвал бичнэ. Дарж бичвэл §73-ын залруулга сесс бүрт устана. |
| Багцгүй баг → ӨӨР БАГИЙН дүрэм рүү унахгүй | §2.17, §3.4-ийн харьцуулах хүснэгт (эзэн баталсан 2026-08-30) | `MGMT`/`EZ`/`GT` нь дүрмийн багц АВАХГҮЙ. «Багц алга бол хамгийн ойрынхыг нь хэрэглэе» гэдэг нь v2 §48-R6-ийн «do not silently apply the wrong team's rules»-ийн ЯГ тэр зөрчил — багц алга бол шалгалт АЛГА. |
| Багцгүй баг ≠ UNCERTAIN | §3.4-ийн харьцуулах хүснэгт, §3.7 `stampTeam` | Багцгүй багийн `team_code`-ыг NULL болгож «дугуйлбал» тэр ажил БАГГҮЙ корпуст орж, §72-ын шошголох шаардлагыг зөрчинө. Дараа нь тэр багт багц зохиох үед эхлэх өгөгдөл БАЙХГҮЙ болно. |
| `team_code`-ийн валидац нь АМЬД `teams.code` | §3.4-ийн `isTeamCodeShape`, `projects.ts:2772-2777` | `code IN ('BA',…)` гэсэн хатуу жагсаалт бол шинэ салбар нэмэгдэхэд `verify` 403 өгч эхэлнэ. Эзэн баталсан найм нь ТӨЛӨВЛӨЛТИЙН тоо, валидацын олонлог БИШ (⛔ хориг 11). |
| Өөрийгөө-харах-л зарчим | `0201:23-32`, `0203:27`, `0205:44`, `revitNoteAi.test.ts:262` | `GET /team-attributions` нь `user_id = viewer.sub`. «Хэн хамгийн их буруу таагдсан» гэсэн харагдац нь дөрөв давтагдсан, тестээр түгжигдсэн дүрмийг зөрчинө. |
| `foldText`-ийн дүрэм | `textFold.ts:47-51` | Дөрвөн ихрийн нэг (backend TS, frontend TS, Python trainer, C# add-in). Нэгийг нь өөрчлөх нь Revit-ийн зорилго таних + вэб хайлтыг ЧИМЭЭГҮЙ доройтуулна. |
| `RevitTools.ToolNames` ба таван ихэр allowlist | `RevitTools.cs:53-65`, `AgentChat.cs:117-154` | Энэ сесс шинэ хэрэгсэл нэмэхгүй тул тавуулаа хөндөгдөхгүй. Нэмвэл тавуулаа хамт хөдлөх ёстой, эс бөгөөс загвар буруу дүгнэнэ. |
| `lib/modules.ts`-ийн `API_PREFIXES` × `MODULE_OF` | `modules.ts:99`, `:166` | Шинэ ДЭЭД ТҮВШНИЙ угтвар нэмбэл энд заавал ангилна, эс бөгөөс `entitlementGuard` шалгалтгүй нэвтрүүлнэ. Бид `/api/revit` дор л сууна. |

---

## 5. ДАРААЛАЛ БА ХАМААРАЛ

**Урьдчилсан нөхцөл:**

| # | Нөхцөл | Хэрхэн шалгах |
|---|---|---|
| 1 | Миграци 0201–0216 продакшн дээр ХЭРЭГЖСЭН | `SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 20` (§7). Эс бөгөөс 0217-ын `ALTER TABLE bim_sessions` унана. |
| 2 | 0216-аас өндөр дугаар репод БАЙХГҮЙ | `ls backend/migrations \| tail -5` |
| 3 | `2-0-OWNER-BRIEF` уншигдсан | R3…R6-ийн тайлал |

Deploy-ийн дараалал:

```
  1. cd backend
     npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml
         ├── 0217_bim_session_team.sql        (4 ALTER + 2 INDEX)
         ├── 0218_team_attributions.sql       (1 TABLE + 3 INDEX + 2 TRIGGER)
         └── 0219_learning_events_team.sql    (2 VIRTUAL + 3 INDEX)
                    │
                    ▼
  2. npx wrangler deploy --config wrangler.toml
         └── teamContext.ts · bimEvents.ts · revit.ts
                    │
                    ▼
  3. C# — НЭГ РЕЛИЗЭД багцлагдана.  ЭНЭ СЕССИД ТАРААХГҮЙ.
```

**Шинэ багана нь түүнийг уншдаг кодоос ХАТУУ ӨМНӨХ deploy-д гарна.** Урвуулбал `bim_sessions.team_code` уншдаг worker нь байхгүй багана руу хандаж, сесс бүрийн handshake 500 өгнө — ажилтан бүр «add-in эвдэрсэн» гэж мэдээлнэ.

### Зэрэг хийж БОЛОХ Track 2-ын баримтууд

Энэ файл нь схемийн түвшинд 2-2 … 2-8-аас **ХАМААРАХГҮЙ**. Эзэн хурдыг хүссэн тул:

| Долгион | Баримтууд | Тайлбар |
|---|---|---|
| **1 (ЗЭРЭГ)** | **2-1** (энэ), **2-2-rule-model**, **2-4-nonblocking-runtime**, **2-8-install-and-health** | Дөрвүүлээ өөр өөр миграцийн блок (0217-0219 / 0221-0227 / 2-4-ийн гурвал / 0241-0242), огтлолцох файл БАЙХГҮЙ. 2-2 нь `team_code`-ыг ЗӨВХӨН гадаад түлхүүр байдлаар лавлана — энэ файлын гэрээ (`TEAM_SOURCES`, `TEAM_ACCEPT_CONFIDENCE`, `team_code TEXT`) бэхлэгдсэн тул хүлээх шаардлагагүй. |
| **2** | 2-3-compliance-engine, 2-6-team-training | 2-3-д `owner_team_code` хэрэгтэй; 2-6-д `learning_events.team_code` (0219) хэрэгтэй. |
| **3** | 2-5-finding-surface, 2-7-readiness-and-quality | 2-5 нь 2-3-ын хүснэгтгүйгээр эхэлж чадахгүй; 2-7 нь §60-ын салбар хоорондын олдвор шаардана. |

⚠️ **`bim_sessions`-ийн bind-ийн төсөв нь 2-4-тэй ХУВААЛЦСАН нөөц.** Энэ файл 4 бодит багана авна (27→31), 2-4-ийн `perf_json` нэгийг (31→32). **Гурав дахь эзэн байх ЁСГҮЙ** — 33 нь мөр/statement-ийг 3→2 болгоно. Иймд 2-7 §3.6 ба 2-8-ийн шаарддаг `pack_sha256` нь `perf_json`-ы `GENERATED … VIRTUAL` болох ЁСТОЙ, бодит багана БИШ. 2-4-ийн зохиогчид энэ хязгаарыг хэлж, аль аль нь §3.1-ийн арифметикийг өөрийн баримтад давтан бич.

### Дараа нь юу ирэх вэ

| Хэрэглэгч | Юуг нь авах |
|---|---|
| 2-2 | `rules.team_code TEXT` — `WHERE team_code = ? OR team_code IS NULL` (§49-ийн СОНГОЛТЫН түлхүүр). `KNOWLEDGE_SCOPES` нь дүрмийн багцын хамрах хүрээний баганыг тодорхойлно. |
| 2-3 | `compliance_findings.owner_team_code` + `finding_teams(relation IN ('owner','affected','responsible'))` — §60-R3 нь ОЛОН нөлөөлөгдсөн баг гэж заасан тул JOIN хүснэгт. |
| 2-6 | `learning_events.team_code` (0219 VIRTUAL) + ХӨЛДӨӨСӨН `team_source` — сургалтын эрх нь мөрөөс ДАНГААР шийдэгдэнэ. |
| 2-7 | §69-ийн «Team checks: n/n» — **төсөл дээр бодитоор байгаа БӨГӨӨД дүрмийн багцтай** багуудаас тооцно. 7 ч бай, **8 ч бай** ЛИТЕРАЛ ХЭЗЭЭ Ч БИШ: эзэн баталсан найм (2026-08-30, §2.17) нь ТӨЛӨВЛӨЛТИЙН тоо. Багцгүй баг (MGMT/EZ/GT) нь хуваарь дээр байсан ч тоолуурын **аль ч талд ОРОХГҮЙ** — түүнийг хуваарьт тоолж, гүйцэтгэлд нь тоолохгүй бол «хэзээ ч бэлэн болохгүй» төсөл үүснэ. |

---

## 6. ХҮЛЭЭН АВАХ ШАЛГУУР

### Схем

- [ ] `PRAGMA table_info(bim_sessions)` → `team_code`, `team_confidence`, `team_source`, `team_last_verified` дөрвүүлээ **БА `company_id`** БАЙНА (ЭЗНИЙ ШИЙДВЭР Ш3, 2026-08-31); нийт багана **30 → 35**, bind **27 → 32**, дараа нь 2-4-ийн `perf_json`-той хамт **33** (`id`, `first_seen_at`, `last_seen_at` гурав нь bind-д ордоггүй — `bimEvents.ts:383`).
- [ ] `SELECT COUNT(*) FROM sqlite_master WHERE name IN ('idx_bim_sessions_team','idx_bim_sessions_team_uncertain')` → **2**
- [ ] `PRAGMA table_info(team_attributions)` → **18 багана**.  ⚠️ ЭНЭ ТОО ЗАСАГДСАН: §3.2-ын DDL нь 18 багана зарладаг байсан атлаа §6/§7 нь «17» гэж бичсэн байв (арифметикийн алдаа).  Нэг ч багана хасаагүй — `scope_kind` нь ГАРГАЖ АВАХ БОЛОМЖГҮЙ (нэг мөр гурван id-г зэрэг агуулж болох ба тэдгээр нь КОНТЕКСТ, харин `scope_kind` нь залруулгын ХАМРАХ ХҮРЭЭ).
- [ ] `SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND tbl_name='team_attributions'` → **2**
- [ ] `UPDATE team_attributions SET inferred_team_code='X' WHERE id=1` → **`RAISE(ABORT)`** алдаа
- [ ] `PRAGMA table_info(learning_events)` → `team_code`, `team_source` БАЙНА, хоёулаа `GENERATED … VIRTUAL`
- [ ] `SELECT COUNT(*) FROM sqlite_master WHERE name IN ('idx_le_session','idx_le_team','idx_le_team_source')` → **3**
- [ ] `SELECT COUNT(*) FROM d1_migrations WHERE name LIKE '021[789]%'` → **3**

### Bind-ийн арифметик

- [ ] `node backend/scripts/check-bim-events.mjs` → exit 0
- [ ] `grep -n 'SESSION_BINDS' backend/src/lib/bimEvents.ts` дараах тайлбартай: `// = 33`
- [ ] `SESSION_ROWS_PER_STATEMENT` нь **2** (`floor(100/34) = 2`) — ЭЗНИЙ ШИЙДВЭР Ш3-ын ХҮЛЭЭН АВСАН зардал.  `bim_sessions` нь бага урсгалтай (жилд ~122k мөр); өндөр урсгалтай `learning_events` ХӨНДӨГДӨӨГҮЙ
- [ ] `EVENT_BINDS` нь **23 ХЭВЭЭР** — 0219 нь ЗӨВХӨН VIRTUAL багана нэмсэн

### Шатны логик

- [ ] `cd backend && node --test src/lib/teamContext.test.ts` → **36/36 pass** (баримтын 20 заавал тохиолдол + гэрээний инварианту­уд)
- [ ] `cd backend && node --test src/lib/migrationSchema.test.ts` → pass
- [ ] `cd backend && npx tsc --noEmit` → чиний хөндсөн файлуудад алдаа БАЙХГҮЙ
- [ ] `cd backend && npm test` → өмнөх baseline-аас ДООШ буугаагүй

### Гарц (`--config wrangler.toml`-тай deploy-ийн дараа)

- [ ] `GET /api/revit/team-context?doc_uid=<БҮРТГЭГДЭЭГҮЙ>` → **200**, `team_source === 'uncertain'`. **404 БИШ** (`/context` нь 404 өгдөг — `revit.ts:792`)
- [ ] `GET /api/revit/team-context` нь `teams[]`-д АМЬД ростер буцаана; массивын урт нь `SELECT COUNT(*) FROM teams`-тэй тэнцүү (өнөөдөр **11**) — ЛИТЕРАЛ 7 ч БИШ, ЛИТЕРАЛ **8** ч БИШ. Эзэн баталсан найм нь дүрмийн багцын тоо, ростерын тоо БИШ (§2.17)
- [ ] Дүрмийн багцгүй багт шийдэгдсэн сесс (жишээ нь үндсэн баг нь `EZ`) → `team_code === 'EZ'`, `team_source` нь `'uncertain'` **БИШ**, `compliance_enabled === false`, `scopes`-д `TEAM` **БАЙХГҮЙ**. ⛔ Хариу нь ӨӨР БАГИЙН код буцаах ёсгүй (§3.4)
- [ ] `POST /team-context/verify` `{team_code:'EZ'}` — EZ-д харьяалагддаг хэрэглэгчээр → **200** (валидац нь амьд `teams.code`-оор явдаг; багцгүй нь хүчингүй ГЭСЭН ҮГ БИШ — §3.4-ийн `isTeamCodeShape`)
- [ ] BA-гийн ҮНДСЭН багтай хэрэглэгчээр (холбоосгүй баримт, `revit_documents.team_code` NULL, төслийн MGMT-гүй хуваарь нь ганц мөр БИШ) → `team_code === 'BA'`, `team_source === 'user_primary'`, `team_confidence === 0.85`
- [ ] Тэр ижил хэрэглэгч, гэхдээ төслийн MGMT-гүй хуваарь нь ЯГ НЭГ мөр = HAS → **`team_code === null`**, `team_source === 'uncertain'`, `conflict === ['HAS','BA']` — HAS БИШ (өргөтгөсөн зөрчлийн дүрэм)
- [ ] Тэр ижил хэрэглэгч (БА primary + IZ, EZ хоёрдогч) → `'IZ'` **ХЭЗЭЭ Ч** буцахгүй (§2.6-ын гэмтэл)
- [ ] Батлагдсан холбоос нь BA-руу, ҮНДСЭН баг нь IZ → **`team_code === null`**, `team_source === 'uncertain'`, `conflict === ['BA','IZ']`
- [ ] `POST /team-context/verify` `{team_code:'HD'}` HD-д ХАРЬЯАЛАГДДАГГҮЙ, менежер БИШ хэрэглэгчээр → **403**
- [ ] Тэр ижил дуудлага менежерээр → **200**, `team_source === 'manual'`, `team_confidence === 1.0`
- [ ] `verify` -ийн дараа `SELECT COUNT(*) FROM team_attributions WHERE superseded_at IS NOT NULL` → **≥1** (өмнөх мөр хаагдсан)
- [ ] `verify {sticky:true}` -ийн дараа `SELECT team_code FROM revit_documents WHERE doc_uid=?` → бичигдсэн
- [ ] Хоёр дахь handshake нь тэр утгыг **дарж бичээгүй**
- [ ] `GET /api/revit/team-attributions` нь ӨӨР хэрэглэгчийн мөр буцаадаггүй (admin-аар ч гэсэн)
- [ ] `GET /api/revit/context` нь `team` блоктой; **байгаа талбар НЭГ Ч өөрчлөгдөөгүй**
- [ ] `worker` үүрэгтэй токеноор `/api/revit/team-context` → **403** (`workerScope`-ийн хаалттай-анхдагч)
- [ ] `client` үүрэгтэй токеноор → **403** (`REVIT_ROLES`, `revit.ts:59`)
- [ ] `purpose:'mcp'` токеноор → **200** (⛔ хориг 1)

### Add-in (Revit нээлттэй, гараар)

- [ ] `grep -c "RefreshTeamContextSoon" revit-mcp/addin/AssistantPane.xaml.cs` → **2** (нэг тодорхойлолт + `ReloadAsync`-ийн ЯГ НЭГ дуудлага). `grep -rn "RefreshTeamContextSoon\|GetTeamContextAsync" revit-mcp/addin/ChangeTracker.cs` → **0 мөр** (⛔ хориг 7/9)
- [ ] `grep -c "DocumentOpened" revit-mcp/addin/AssistantPane.xaml.cs` → **0** — багийн контекст нь `ReloadAsync`-аар л шинэчлэгдэнэ, ШИНЭ Revit захиалга НЭМЭГДЭЭГҮЙ
- [ ] Гараар: BA-гийн ажилтнаар нэвтрээд файл нээхэд самбарын статусын мөрөнд «Баг: BA (…)» chip гарна
- [ ] Гараар: «Шинэчлэх» товчийг 15 минутын дотор дахин дарахад **сүлжээний хүсэлт ГАРАХГҮЙ** (`ShouldRefresh` = false); 15 минутын дараа ГАРНА
- [ ] Гараар: chip гарахад самбар **өөрөө нээгддэггүй**; хаалттай самбар хаалттай хэвээр
- [ ] Гараар: chip шинэчлэгдэхэд Revit-ийн курсор **өөрчлөгддөггүй** (`SetBusy` хэрэглээгүй нотолгоо)
- [ ] Гараар: сүлжээ таслахад chip кэшийн утга дээр үлдэнэ, алдааны цонх ГАРАХГҮЙ
- [ ] Гараар: зөрчилтэй үед chip нь «Баг: тодорхойгүй (BA/IZ)» — ажил блоклогдохгүй
- [ ] Гараар: chip дээр дарж баг сонгоход `verify` очиж, chip нь «Баг: BA ✔» болно
- [ ] `python revit-mcp/training/check_team_context.py` → exit 0 (12/12)
- [ ] `dotnet build RevitMcpAddin.csproj -c "Release R24" -p:Platform=x64` → `TeamContext.cs` net48 дээр хөрвөнө

### Хамрах хүрээ

- [ ] `git status --short` нь ЗӨВХӨН толгойн 14 файлыг харуулна
- [ ] Өөр агентын хадгалаагүй файл НЭГ Ч хөндөгдөөгүй

---

## 7. ШАЛГАХ КОМАНД

```bash
# --- 0. УРЬДЧИЛСАН НӨХЦӨЛ ---
ls backend/migrations | tail -5
# Хүлээгдэх: 0212 … 0216.  Өндөр зүйл байвал ЗОГС.

cd backend
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 20"
# Хүлээгдэх: 0201 … 0216 бүгд байна.  Байхгүй бол 0217 унана.

# --- 1. МИГРАЦИ (deploy 1/2) ---
npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml
# Хүлээгдэх: 0217, 0218, 0219 гурвуулаа applied.

# --- 2. СХЕМ БАТЛАХ ---
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT name FROM pragma_table_info('bim_sessions') WHERE name LIKE 'team%'"
# Хүлээгдэх: team_code, team_confidence, team_source, team_last_verified

npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT COUNT(*) AS n FROM pragma_table_info('team_attributions')"
# Хүлээгдэх: n = 18

npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='team_attributions'"
# Хүлээгдэх: team_attributions_append_only, team_attributions_supersede_once

npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT name FROM pragma_table_info('learning_events') WHERE name LIKE 'team%'"
# Хүлээгдэх: team_code, team_source

# --- 3. APPEND-ONLY ТРИГГЕР ---
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "UPDATE team_attributions SET inferred_team_code='X' WHERE id=(SELECT MIN(id) FROM team_attributions)"
# Хүлээгдэх: АЛДАА — 'team_attributions is append-only'.  Амжилттай бол ТРИГГЕР АЖИЛЛААГҮЙ.

# --- 4. АМЬД РОСТЕР (ростер нь ЭЗЭН БАТАЛСАН — §2.17; ЭНЭ БЛОК нь
#        ГИШҮҮДИЙН ТООГ хэмжинэ, тэр нь хараахан баталгаажаагүй) ---
# Хүлээгдэх (эхний асуулга): 11 мөр — BA, BB, HAS, TSBU, TSAH, HD, AU, IZ
#   (баталсан найм) + MGMT + EZ + GT (дүрмийн багцгүй гурав).
# ⚠️ Хэрэв 11-ээс өөр гарвал ЗОГС: ростер өөрчлөгдсөн байна, §2.17-г шинэчил.
#    Кодод 8, 9, 11 гэсэн ЛИТЕРАЛ БҮҮ бич — ⛔ хориг 11.
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT code, name_mn, sort_order FROM teams ORDER BY sort_order"

npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT t.code, COUNT(*) AS n FROM user_teams ut JOIN teams t ON t.id=ut.team_id JOIN users u ON u.id=ut.user_id WHERE ut.is_primary=1 AND u.status='active' GROUP BY t.code ORDER BY n DESC"

# --- 5. ХОЁРДОГЧ ХАРЬЯАЛЛЫН ГЭМТЭЛ (§2.6) ---
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT pt.code AS primary_team, st.code AS secondary_team, COUNT(*) AS n FROM user_teams p JOIN teams pt ON pt.id=p.team_id JOIN user_teams s ON s.user_id=p.user_id AND s.is_primary=0 JOIN teams st ON st.id=s.team_id WHERE p.is_primary=1 GROUP BY 1,2 ORDER BY n DESC"
# Хүлээгдэх: BA→IZ, BA→EZ мөрүүд их тоотой гарна.

# --- 6. ТЕСТ БА ХӨРВҮҮЛЭЛТ ---
node --test src/lib/teamContext.test.ts
# Хүлээгдэх: 36/36 pass

node --test src/lib/migrationSchema.test.ts
node scripts/check-bim-events.mjs
npx tsc --noEmit
npm test

# --- 7. WORKER DEPLOY (deploy 2/2) ---
npx wrangler deploy --config wrangler.toml
# ⚠️ --config wrangler.toml нь ЗААВАЛ: репогийн үндэсрүү орших wrangler.jsonc
#    нь ӨӨР worker («mgl», binding-гүй) зарладаг ба discovery түүнийг сонгож болно.

# --- 8. ГАРЦЫН УТАА ---
TOKEN="<mcp token>"                    # ӨМНӨ: багийн ойлголт байхгүй
API="https://mgl-progress-api.mglenc-design.workers.dev"

curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" \
  "$API/api/revit/team-context?doc_uid=ogt-baihgui-uid-12345"
# Хүлээгдэх: 200 (404 БИШ).  ДАРАА: {"team_source":"uncertain", ...}

curl -s -H "Authorization: Bearer $TOKEN" \
  "$API/api/revit/team-context?doc_uid=ogt-baihgui-uid-12345" | python3 -m json.tool
# Хүлээгдэх: team_code null, team_confidence 0, teams[] нь АМЬД ростер

curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"team_code":"HD"}' \
  "$API/api/revit/team-context/verify"
# Хүлээгдэх: HD-д харьяалагддаггүй, менежер БИШ хэрэглэгчээр → 403

curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $WORKER_TOKEN" \
  "$API/api/revit/team-context?doc_uid=x"
# Хүлээгдэх: 403 (workerScope)

# --- 9. C# ХААЛГА ---
cd ../revit-mcp/training
# ⚠️ Интерпретатор нь `revit-mcp/server/.venv` дотор — `training/` нь өөрийн
#    venv-гүй.  `revit-mcp/training`-аас харьцангуй зам нь `../server/…`,
#    `../../server/…` БИШ (сүүлийнх нь `<repo>/server` руу заана, тэр
#    БАЙХГҮЙ).  Системийн `python3` руу унах fallback ХЭРЭГЛЭХГҮЙ —
#    түүнд sklearn БАЙХГҮЙ (1B-4:266) ба алдааг ЧИМЭЭГҮЙ нуух болно.
../server/.venv/Scripts/python.exe check_team_context.py
# Хүлээгдэх: 12/12 OK, exit 0

# --- 10. ХАМРАХ ХҮРЭЭНИЙ ХЯНАЛТ ---
cd ../..
git status --short
git diff --stat
# Зөвшөөрөгдсөн зам ЗӨВХӨН:
#   backend/migrations/021{7,8,9}_*.sql
#   backend/src/lib/teamContext.ts
#   backend/src/lib/teamContext.test.ts
#   backend/src/lib/bimEvents.ts
#   backend/src/routes/revit.ts
#   revit-mcp/addin/TeamContext.cs
#   revit-mcp/addin/RevitApi.cs
#   revit-mcp/addin/QtoDtos.cs
#   revit-mcp/addin/AssistantPane.xaml
#   revit-mcp/addin/AssistantPane.xaml.cs
#   revit-mcp/addin/App.cs
#   revit-mcp/training/check_team_context.py
#   docs/bim-ai/2-1-team-context.md
# git add -A БҮҮ хэрэглэ — файл бүрийг нэрээр нь нэм.
```

**Гар туршилт (Revit нээлттэй, автоматжуулах боломжгүй):**

1. BA-гийн ажилтны бүртгэлээр нэвтэрч, БА-гийн `.rvt` нээ → chip нь «Баг: BA (…)» гэж 15 секундын дотор гарна.
2. Самбарыг ХААЖ, өөр файл нээ → chip **самбарыг өөрөө нээхгүй**, Revit-ийн зураглалын талбар хөдлөхгүй.
3. Сүлжээг тасал, файл нээ → chip кэшийн утга дээр үлдэнэ, диалог ГАРАХГҮЙ, ажил үргэлжилнэ.
4. `settings.json`-ы `team_override`-ыг харьяалагддаггүй баг руу гараар зас → сервер 403 өгнө, chip **өөрчлөгдөхгүй** (клиентийн зарлал ажиллахгүй).
5. Ханыг чирж байхад chip шинэчлэгдэх мөчийг ажигла → **чирэлт саатахгүй** (`Gate` баригдаагүй нотолгоо).
6. Revit-ийг хаа → **өлгөгдөхгүй**, ердийн хугацаанд хаагдана (`App.cs`-ийн дараалал зөв).
7. Revit 2024 (net48) build дээр 1–6-г ДАВТ.

---

## 8. ROLLBACK

| Алхам | Буцаах арга |
|---|---|
| Worker (deploy 2/2) | `git revert` → `npx wrangler deploy --config wrangler.toml`. **Өгөгдлийн эрсдэл: ТЭГ.** Багана үлдэнэ, тэдгээрийг уншдаг код л алга болно. |
| Миграци 0219 | Индексүүдийг эхлээд DROP, дараа нь VIRTUAL багануудыг DROP — **ШИНЭ ДУГААРААР** (0243, нөөцлөгдсөн). 1B-1 §2.5-д хэмжсэнээр индекслэгдсэн GENERATED баганыг шууд DROP хийж болохгүй. |
| Миграци 0218 | `DROP TRIGGER` × 2 → `DROP INDEX` × 3 → `DROP TABLE team_attributions` — **ШИНЭ ДУГААРААР**. ⚠️ Түүнд хүний баталгаажуулалт ОРСОН байвал бүгд алдагдана. |
| Миграци 0217 | **ХИЙХГҮЙ.** `bim_sessions`-аас баганыг устгах нь бодит ашиг өгөхгүй; тэдгээр нь NULL/анхдагчтай сууж, юуг ч эвдэхгүй — `accent_color`, `tv_kiosk`, `model_xkt_url`-ийн адил үлдэц. |
| Add-in (C#) | ЭНЭ СЕССИД ТАРААГААГҮЙ тул буцаах зүйл БАЙХГҮЙ. Тарааснаас хойш бол ~20 PC-г гараар дахин суулгах — тиймээс НЭГ РЕЛИЗИЙН дүрэм. |

**⚠️ ШИНЭ ДУГААР ЗААВАЛ** — хэрэгжсэн файлыг засах нь продакшн дээр **ЧИМЭЭГҮЙ NO-OP**. 0217/0218/0219-ийг «засаад дахин apply хийе» гэж бүү оролд: `d1_migrations` тэдгээрийг хэрэгжсэн гэж үзэх тул юу ч болохгүй, чи түүнийг зөвхөн худал ногоон гаралтаас мэдэхгүй.

**Өгөгдлийн эрсдэл:** 0217 ба 0219 нь **ТЭГ** — зөвхөн нэмнэ, юу ч дарж бичихгүй, `bim_sessions`-ийн одоо байгаа мөрүүд `team_source = 'uncertain'` анхдагчтай үлдэнэ. 0218 нь шинэ хүснэгт. **ГАНЦ бодит эрсдэл нь handshake-ийн `revit_documents.team_code` бичилт** — тэр нь ЗӨВХӨН NULL үед бичихээр хязгаарлагдсан, тул хүний утга АЛДАГДАХГҮЙ.

**Кэшийн үлдэгдэл:** `withEdgeCache` энэ гурван гарцын АЛЬ Ч НЬ хэрэглэхгүй (хэрэглэгчээр хуваадаггүй тул). Add-in талд `%APPDATA%\RevitMcpAddin\team-context.json` үлдэнэ — 24 цагийн `StaleAfterSec`-ийн дараа хүчингүй, эсвэл гараар устгана.

**Rollback-ийн шалгуур.** Дараах шинж илэрвэл ЭРГҮҮЛ: (а) handshake эсвэл `/context` дээр 500-ийн огцом өсөлт (миграцигүйгээр deploy хийсэн шинж); (б) ажилтнууд буруу багийн chip мэдээлж байгаа бөгөөд `team_source` нь `sheet_prefix` эсвэл `behavior` — тэр хоёр ШИЙДВЭРЛЭХ ЁСГҮЙ, ил алдаа; (в) `bim_sessions`-ийн ingest хугацаа хоёр дахин уртсах (bind-ийн арифметик буруу).

---

## 9. ЭХЛЭХИЙН ӨМНӨ ТОДРУУЛАХ

Эдгээрийг репогоос **ХАРИУЛАХ БОЛОМЖГҮЙ** — эзэн эсвэл продакшны асуулга шаардана.

> **2026-08-30-нд ХААГДСАН.** Эзэн 1, 2, 6-р асуултыг хариулав: салбарын баг нь **НАЙМ** (MGMT-г хассан), IZ нь түүний нэг, `MGMT`/`EZ`/`GT` гурав нь дүрмийн багц АВАХГҮЙ. Мөн эхний бүрэн багц нь **BA — Барилга архитектур**. Дэлгэрэнгүй нь §2.17 ба v2 §46-д. Доорх мөрүүд нь ТҮҮХ болон үлдсэн ажлыг заана — дахин нээж БҮҮ хэлэлц.

### 9.1 Блоклогч — эзний шийдвэр шаардлагатай (1, 2, 6 нь ХААГДСАН)

| # | Асуулт | Яагаад чухал | Хэрхэн олох |
|---|---|---|---|
| 1 | ~~**АМЬД БАГИЙН РОСТЕР ЮУ ВЭ?**~~ **ХААГДСАН — ЭЗЭН БАТАЛСАН 2026-08-30** | Салбарын баг нь **НАЙМ**: BA · BB · HAS · TSBU · TSAH · HD · AU · IZ («MGMT-ийг хасаад үлдсэн 8-н багийг оруулна»). `teams` нь **11** мөртэй хэвээр; `MGMT`, `EZ`, `GT` гурав нь дүрмийн багцгүй (§2.17, v2 §46). Найм нь **ТӨЛӨВЛӨЛТИЙН** тоо — ажиллах үед ростер `teams.code`-оос уншигдана (⛔ хориг 11). **ҮЛДСЭН ЗҮЙЛ (шийдэгдээгүй):** (а) баг тус бүрийн ГИШҮҮДИЙН ТОО хэмжигдээгүй — продакшны D1 энэ машинаас хүрэлцээгүй (Cloudflare 7403); (б) 4-р шатны фолдын хасах жагсаалтыг бодит ростероор дахин тооц (`BB` нь мэдэгдэж байгаа мөргөлдөөн). | §7-ийн 4-р блок — зөвхөн ТООЛУУР |
| 2 | ~~**IZ нь ДОЛООГИЙН НЭГ ҮҮ?**~~ **ХААГДСАН — ЭЗЭН БАТАЛСАН 2026-08-30** | **ТИЙМ — IZ нь баталсан НАЙМЫН нэг.** Репод байсан долоо-vs-найм зөрүү (`projectCategories.ts:35`, `TeamFormTemplatesPage.tsx:33-70`, `docHelpers.ts:4` нь IZ-гүй ДОЛОО; `tasks.ts:395`, `teamMeta.ts:9`, `teamReportFieldCatalog.ts` нь IZ-тэй НАЙМ) нь эзний шийдвэрээр хаагдав — баталсан найм нь `IMPLEMENTED_TEAMS`-ийн олонлог. ⚠️ **ХҮЧИНТЭЙ ХЭВЭЭР:** IZ-д хуучин `norms_*` туг **ТЭГ**, мөн `iz/template.ts` нь **65 мөр, норм лавлагаа ТЭГ** (хэмжсэн 2026-08-30) — түүний багц **ЗОХИОГДОХ** ёстой, загвараас хураах БОЛОМЖГҮЙ. Эзний дарааллаар IZ нь **ХОЁРДУГААРТ**, эхнийх нь **BA** (§2.17). | ХААГДСАН |
| 3 | **ЗӨРЧЛИЙН ДҮРЭМ ЗӨВ ҮҮ, ба ХИР ӨРГӨН ҮҮ?** | Холбоос BA гэж, үндсэн баг IZ гэж хэлэхэд бид **UNCERTAIN + conflict** гэж шийдсэн. §48-ын ordinal уншлага нь «холбоос ялна» гэнэ; §48-R6 ба R5 нь «буруу багийн дүрмийг чимээгүй хэрэглэхгүй» гэнэ. ⚠️ **Бид дүрмийг ӨРГӨТГӨВ**: `binding` төдийгүй `document` ба `project_shares` (гурвуулаа ХҮНЭЭС ГАРААГҮЙ дохио) нь `user_primary`-тай зөрвөл UNCERTAIN. Шалтгаан: MGMT-г хассаны дараа ганц хуваарьтай төсөл (интерьер-л ажил, ZA засвар — MGL-д ЭНГИЙН) дээр BA-гийн архитектор HAS-ийн багц авах байв. **ЗАРДАЛ:** ийм төсөл дээр ҮНДСЭН багтай хүн бүр UNCERTAIN болж, chip дээр нэг удаа сонголт хийхийг шаардана. Баталгаажуул, эсвэл (а) зөвхөн `binding` vs `user_primary` руу нарийсга, эсвэл (б) `RESOLVING_SOURCES`-ыг `['binding','document','user_primary','project_shares']` болгон дараалуулж зөрчлийг арилга. | Эзэн |
| 4 | **ХУВААЛЦСАН АЖЛЫН БАЙРЫГ ЯАЖ ЗОХИЦУУЛАХ ВЭ?** | `settings.json` ба add-in-ийн суулгац хоёулаа Windows хэрэглэгч тутам. Нэг Windows бүртгэл хуваалцвал НЭГ MGL хэн болох, НЭГ токен, хэн гарын дэргэд сууж байгааг ДАХИН ШАЛГАХ юм БАЙХГҮЙ. Тэгвэл BB-гийн инженер BA гэж шийдэгдэж, BA-гийн багц ачаалагдана (R5-ийн эвдрэл). Revit start дээр «хэн байна?» гэсэн асуулт §71-R2-ийн ТАВАН зөвшөөрөгдсөн диалогт багтах уу, эсвэл зургаа дахь нь болох уу? | Эзэн |
| 5 | **БАТАЛГААЖУУЛАЛТ БАРИМТ ТУТАМ НААЛДАЦТАЙ БАЙХ УУ?** | `sticky:true` нь `revit_documents.team_code` бичнэ — хамаагүй тааламжтай, ГЭХДЭЭ нэг инженерийн залруулга тэр хуваалцсан `.rvt` дээрх БУСАД инженерийн сесс юу гэж шийдэгдэхийг өөрчилнө. Сесс тутам уу, баримт тутам уу? | Эзэн |
| 6 | ~~**MGMT / EZ / GT дүрмийн багц АВАХ УУ?**~~ **ХААГДСАН — ЭЗЭН БАТАЛСАН 2026-08-30** | **ҮГҮЙ — гурвуулаа багц АВАХГҮЙ.** Эзэн MGMT-ийг ил хассан; EZ ба GT нь блокийн угтварын баг (`0074_seed_ez_gt_teams.sql:12-14`) тул салбарын наймд ороогүй. Тэдгээрийн сесс нь `GLOBAL` + `COMPANY` + `PROJECT` хамрах хүрээгээр л ажиллаж, нийцлийн шалгалт **АЛГАСАГДАНА** — ГЭВЧ мөр нь бодит `team_code`-оор ШОШГОЛНО (§3.4-ийн харьцуулах хүснэгт, §3.7 `stampTeam`). ⛔ Өөр багийн дүрэм рүү унахыг **ХОРИГЛОНО** (v2 §48-R6). | ХААГДСАН |

### 9.2 Техникийн — прод/алсын D1 дээр л шалгагдана

| # | Асуулт | Яагаад чухал | Хэрхэн олох |
|---|---|---|---|
| 7 | **0212–0216 продакшн дээр ХЭРЭГЖСЭН ҮҮ?** | Хэрэв үгүй бол add-in аль хэдийн байхгүй багана руу `addin_version`, `timing_json` бичиж байна, мөн 0217-ын `ALTER TABLE bim_sessions` унана. | §7-ийн 0-р блок |
| 8 | **СЕСС ГЭЖ ЮУ ВЭ?** | `bim_sessions.session_uid` -д ҮЙЛДВЭРЛЭГЧ БАЙХГҮЙ (`grep session_uid revit-mcp/addin/*.cs` хоосон). Хэрэв нэг сесс BA host + BB link-ийг хамарвал дөрвөн багийн талбар ХОЁРДМОЛ утгатай болно. 2-4 үүнийг хариулах ёстой; энэ файл түүний хариултыг өвлөнө. | 2-4 + эзэн |
| 9 | **`company_id` -г ОДОО оруулах уу?** | §72 нь зургаан талбарын нэгээр нэрлэсэн, `lib/tenants.ts` байгаа, гэвч НЭГ Ч BIM хүснэгтэд байхгүй. Зөвхөн нэмэгддэг хүснэгтэд ДАРАА нь нэмэх нь БОЛОМЖГҮЙ. ⚠️ Энэ нь **ҮНЭГҮЙ БИШ**: `bim_sessions` нь 0217-ын дараа 31, 2-4-ийн `perf_json`-ы дараа 32 bind; зургаа дахь бодит багана нь 33 → `floor(100/34)=2`, ingest гуравны нэгээр удаашрана. **0217 гарахаас ӨМНӨ шийд.** | Эзэн + 2-4 |
| 9б | **`bim_sessions.pack_sha256`-г ХЭН нэмэх вэ, ямар хэлбэрээр?** | ⚠️ **ӨНӨӨДӨР ЯМАР Ч БАРИМТ ТҮҮНИЙГ НЭМЭХГҮЙ.** Энэ файлын 0217 нь дөрвөн БАГИЙН талбар л нэмнэ; 2-4 §3.1 нь `perf_json`-ыг нэмнэ; хоёуланд нь `pack_sha256` БАЙХГҮЙ. Гэтэл 2-7 §3.6-ийн «нийтлэгдээгүй багц» тоолуур (`§69`-ийн зургаан блоклогчийн нэг) нь `bim_sessions.pack_sha256`-аас УНШИНА, 2-8 нь түүнийг handshake-ээр илгээнэ гэж бичсэн. Шийдвэр: (а) `perf_json`-ы `GENERATED ALWAYS AS (json_extract(perf_json,'$.pack_sha256')) VIRTUAL` — **bind ТЭГ, зөвлөж буй хувилбар**, эсвэл (б) 2-7 §3.6-г `bim_sessions.ruleset_version` → `rule_pack_versions` JOIN руу дахин бичих. Бодит багана болгох нь **ХОРИОТОЙ** (33 bind → 2 мөр/statement). Аль нь ч бол 2-4 §3.1, 2-7 §9-ийн 5-р асуулт, 2-8-ийн 23-р мөрийг НЭГ ЗАСВАРААР уялдуул. | 2-4 + 2-7 + 2-8 |
| 10 | **ХОЁРДОГЧ ХАРЬЯАЛЛЫН БОДИТ ХЭМЖЭЭ ЯМАР ВЭ?** | §2.6 нь БА→IZ/EZ-г бичсэн ч тоо нь 2026-08 үеийнх. Өнөөдрийн тоо нь 3-р шатны эрсдэлийг хэмжинэ. | §7-ийн 5-р блок |
| 11 | **АЖИЛТНЫ МЭДЭГДЭЛ ШИНЭЧЛЭГДСЭН ҮҮ?** | Commit `9fe82a0` нь 0195-ын «геометр, файлын агуулга хадгалахгүй» амлалтыг эзний шийдвэрээр ЦУЦАЛСАН гэж бичсэн, «Ажилтны мэдэгдэл, гэрээ ЗААВАЛ шинэчлэгдэнэ». `bim.capture.notice_version` нь ИРЭЭДҮЙН огноо (`0208:37`). Энэ сесс `team_attributions`-д «хэн ямар багт таагдсан, хэн зассан» нэмнэ — мэдэгдэлд орох ёстой шинэ ангилал. | Эзэн |

### 9.3 Хэмжигдээгүй — хэн ч тоолоогүй

| # | Асуулт | Яагаад чухал |
|---|---|---|
| 12 | **`RefreshIntervalSec = 900` зөв үү?** | Нэг ч ажилтны машин дээр хэмжигдээгүй. Хэт богино бол ~20 PC × 8 цаг = өдөрт ~640 нэмэлт хүсэлт (өчүүхэн), хэт урт бол баг солигдоход chip хоцорно. Нэг өдрийн хэмжилтээр л шийднэ. |
| 13 | **4-р шатны «≥3 хуудас» босго зөв үү?** | Бодит MGL хуудасны дугаарлалтын конвенцийг батлаагүй — `foldText` дүрэм шалгагдсан, КОРПУС шалгагдаагүй. `revit_sheet_bindings.sheet_number`-ийн бодит түгээлтийг харах ёстой. **ТААМАГ.** |
| 14 | **5-р шатны ангиллын профайл MGL-ийн загварт таарах уу?** | Ducts→HAS, Furniture→IZ гэх зэрэг нь ЕРӨНХИЙ Revit конвенц дээр тулгуурласан, MGL-ийн бодит `revit_element_touches.category` түгээлтэд тулгаагүй. `learning_events` ledger нь өнөөдөр ХООСОН (үйлдвэрлэгчгүй) тул хэмжих өгөгдөл ч байхгүй. **ТААМАГ.** |

### Хавсралт — энэ баримт бичихдээ илэрсэн зөрүү

| Зөрүү | Алины дагуу |
|---|---|
| ~~v2 §46 «7 teams» vs `0007_teams.sql:39-47`-ын ЕС мөр (+`0074:12-14`-ийн хоёр = 11) vs UI-ийн `IMPLEMENTED_TEAMS` = 8~~ **ШИЙДЭГДСЭН 2026-08-30** | **ЭЗЭН БАТАЛСАН: НАЙМ.** UI-ийн `IMPLEMENTED_TEAMS` (`frontend/src/features/projects/team-reports/TeamReportsTab.tsx:52-61`) зөв байсан; v2 §46 нь тэр дагуу дахин бичигдсэн («8 DISCIPLINE TEAMS»). `teams` нь 11 мөртэй хэвээр, `MGMT`/`EZ`/`GT` нь багцгүй. Ростерыг ажиллах үед `teams.code`-оос **АВСААР БАЙНА** — найм нь төлөвлөлтийн тоо, литерал БИШ. |
| v2 §48-ын шатанд «Company / Project Metadata» нь «User Role / Identity»-ээс ӨМНӨ; бидний итгэлцэл нь эсрэг (0.75 vs 0.85) | **v2-ын ДАРААЛАЛ ялна.** §48-R3 нь «preferred hierarchy» гэж бичсэн, итгэлцлийн уралдаан БИШ. Итгэлцэл нь тусад нь мэдээлдэг тоо. |
| v2 §48-R4 нь `team_id` гэж бичсэн; бид `team_code` хэрэглэв | **ЗОРИУДЫН ХАЗАЙЛТ.** 0069-ийн прецедент, `revit_documents.team_code` (0187:30) аль хэдийн TEXT, дүрмийн багц нь `teams` хүснэгтгүй C# клиент рүү очно. §72-ын семантик хадгалагдана. |
| v2 §72 нь `discipline`-ийг `team_id`-аас ТУСАД НЬ жагсаасан | **НЭГТГЭВ.** MGL-д салбар = баг (`teams` бол цорын ганц салбарын хэмжээс). Хоёр талбар нь зөрөх боломж үүсгэнэ. |
| `1C-addin-release.md` нь C# өөрчлөлт бүрийг НЭГ РЕЛИЗЭД гэж заасан | **ДАГАСАН.** Энэ сессийн C# нь тарааХГҮЙ. |
