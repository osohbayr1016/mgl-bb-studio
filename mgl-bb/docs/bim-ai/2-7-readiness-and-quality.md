# 2-7-readiness-and-quality — бүрэн бүтэн байдал/бэлэн байдлын шалгалт, салбар хоорондын олдвор, FP/FN хяналт, «хянахад бэлэн» хаалга

> **Track:** 2 · READINESS & QUALITY (Track 2-ийн ГАРЦЫН ХААЛГА)
> **v2 хэсэг:** §59 (MODEL COMPLETENESS / READINESS CHECK) · §60 (CROSS-DISCIPLINE INTERACTION) · §66 (FALSE POSITIVE / FALSE NEGATIVE MONITORING) · §69 («READY FOR REVIEW» GATE) · дам: §67 (ноцтой байдал), §57 (амьдралын мөчлөг), §68 (хүчингүй болголт), §70 (бодит төслийн тест), §34 (засаглал), §82 (мастер шалгуур)
> **Хамаарал (depends on):** `2-3-compliance-engine` — `compliance_findings`, `finding_elements`, `finding_teams`, `finding_edges`, `rule_run_ledger` ХҮСНЭГТҮҮД нь тэнд үүснэ (⚠️ `backend/src/routes/compliance.ts`-ийн ФАЙЛ ба `/api/compliance` МОУНТ нь `2-3`-ынх БИШ — `2-2`-ынх, §3.6-г үз); `2-5-finding-surface` — `finding_overrides.override_kind = 'FALSE_POSITIVE'` нь §66-ийн ЦОРЫН ГАНЦ худал дохионы эх сурвалж; `2-2-rule-model` — `rules.severity`, `rules.issue_class`, `rules.expect_applicable`, `rule_test_cases.expect_verdict`; `2-6-team-training` — `rule_test_cases`-ыг `eval/golden/rules.json` руу экспортлох; `2-1-team-context` — `team_code TEXT` гэрээ. Эдгээргүйгээр энэ сесс УНШИХ юмгүй.
> **Блоклож буй (blocks):** ЮУГ Ч ҮГҮЙ. Энэ бол Track 2-ийн СҮҮЛИЙН файл — гарцын хаалга. Түүнээс доош хамаарал байхгүй.
> **Хөндөх файлууд:** `backend/src/lib/readiness.ts` (ШИНЭ), `backend/src/lib/readiness.test.ts` (ШИНЭ), `backend/src/lib/complianceModel.ts`, `backend/src/routes/compliance.ts`, `frontend/src/features/projects/readiness/ReadinessPanel.tsx` (ШИНЭ), `frontend/src/features/projects/detail/ProjectTabs.tsx`, `frontend/src/shared/lib/search/sections.ts`, `frontend/src/shared/i18n/mn.json`, `frontend/src/shared/i18n/en.json`. **ӨӨР ФАЙЛ БАЙХГҮЙ.**
> **Deploy тоо:** 2 (1 × `wrangler deploy` → 1 × `pages deploy`). **Migration БАЙХГҮЙ — энэ сесс зөвхөн УНШИНА.** Add-in (C#) ШААРДЛАГАГҮЙ. Шинэ i18n түлхүүр `mn.json` БА `en.json` ХОЁУЛАНД нэмэгдэнэ.

---

## 0. ЭНЭ СЕССИЙН ДҮРЭМ

**Хамрах хүрээ (scope).** Дээрх ес хан файл. Track 2-ийн БУСАД файл (`2-1`…`2-6`, `2-8`) нь өөрсдийн хүснэгт, өөрсдийн C#-ыг эзэмшинэ — тэднийг ҮҮНД ЗАСАХГҮЙ. Энэ сесс нь **зөвхөн УНШИХ талын** ажил: одоо байгаа хүснэгтүүдээс тоолж, нэгтгэж, буцаана.

**Migration БАЙХГҮЙ.** Энэ бол Track 2-ийн ЦОРЫН ГАНЦ migration-гүй сесс. Тиймээс энэ нь хамгийн хямд бөгөөд **хамгийн амархан буруу хийгддэг** нь: шинэ багана байхгүй тул алдаа нь схемийн алдаа биш, **бодлогын алдаа** болно — нэг хүний нэрийг тайланд оруулах, «гэрчилгээ» гэсэн үг бичих, багийн тоог 7 гэж хатууруулах. Гурвуулаа буцаах боломжгүй ул мөр үлдээнэ (хэвлэсэн тайлан, ажилтны итгэл).

**Бусад агентуудтай зэрэг ажиллаж байна.** Ажлын мод дээр өөр хүний хагас дууссан, эвдэрсэн ч байж болох өөрчлөлт байна. Өөрийн task-т хамаарахгүй файлыг ЗАСАХГҮЙ, БУЦААХГҮЙ, ЦЭВЭРЛЭХГҮЙ. `npm run build` бүхэл програмыг хөрвүүлдэг тул чиний хөндөөгүй файл дээр унаж болно — алдаа өөрийн файлууд дээр байгаа эсэхийг шалгаад, бусдыг нь эзэнд мэдэгд.

**Deploy хийж болох уу?** Тийм, гэхдээ **`2-3` болон `2-5` deploy хийгдсэний ДАРАА**. Тэдгээр хүснэгт байхгүй бол энэ сессийн бүх SQL нь `no such table` алдаа өгнө.

### ЭНЭ СЕССИД ХЭЗЭЭ Ч ХИЙЖ БОЛОХГҮЙ

| ⛔ | Дүрэм | Юу болох вэ |
|---|---|---|
| 1 | `/api/*`-д `purpose === 'mcp'` токеныг ХЭЗЭЭ Ч татгалзуулж болохгүй | Add-in REST дуудлага бүрээ 365 хоногийн mcp токеноор гарын үсэг зурдаг, сэргээх урсгал БАЙХГҮЙ. ~20 компьютер, `Install.bat`, Revit хаалттай. Алсаас сэргээх БОЛОМЖГҮЙ ганц өөрчлөлт. `middleware/auth.ts:101-102` |
| 2 | `users` / `projects`-ыг `migrations apply`-аар ДАХИН БҮТЭЭХГҮЙ | 19 ба 33 cascade хүүхэдтэй. `migrations apply` нь транзакц дотор ажилладаг тул cascade УНАЖ, хүүхэд мөр бүрийг устгана. Энэ сесс migration бичихгүй тул зөвхөн санамж. |
| 3 | Migration нь ЗӨВХӨН НЭМЭГДЭНЭ | Хэрэгжсэн файлыг засах нь продакшн дээр ЧИМЭЭГҮЙ NO-OP. Энэ сесс migration АВАХГҮЙ — дугаар нөөцлөхгүй, `d1_migrations`-д хүрэхгүй. |
| 4 | Trigger дотор `END;` ТОМООР, өөрийн мөрөнд | wrangler-ийн задлагч том-жижиг үсэг ялгадаг. Энэ сесс trigger бичихгүй. |
| 5 | Инференс нь итгэмжлэгдсэн замд ХЭЗЭЭ Ч байхгүй | `RevitToolEventHandler.Execute`, `ChangeTracker.OnDocumentChanged`, keyword/model салаа — гурвуулаа хориотой. Энэ сесс C# хөндөхгүй. |
| 6 | Бусад агентын хийгээгүй ажилд ХҮРЭХГҮЙ | `git restore` / `checkout --` / `stash` / `reset` / `git add -A` — аль нь ч БАЙХГҮЙ. Файл бүрийг нэрээр нь нэм. |
| 7 | `DocumentChanged` дотор баримт нь ЗӨВХӨН УНШИХ | Транзакц, `Regenerate()`, дискний бичилт, сүлжээ — юу ч байхгүй. Энэ сесс C# хөндөхгүй. |
| 8 | **НЭГ ХҮНИЙГ НЭРЛЭСЭН ТОО ЭНД ХЭЗЭЭ Ч ГАРАХГҮЙ** | Элемент түвшний үйл ажиллагаа нь ЗӨВХӨН ӨӨРИЙГӨӨ ХАРАХАД — дөрвөн migration толгой (`0201:23-32`, `0203:25-31`, `0205:42-46`) ба `routes/learning.ts:67-71` дээр бичигдсэн, `revitNoteAi.test.ts:262`-оор ТҮГЖИГДСЭН. «BA багт 14 олдвор, үүнээс 9 нь <нэр>» гэсэн мөр нь энэ дүрмийг зөрчинө. |
| 9 | **«Баталгаажлаа», «зөвшөөрөгдсөн», «нийцсэн» гэж ХЭЗЭЭ Ч бичихгүй** | §69-R3: энэ нь хууль зүйн гэрчилгээ БИШ. UI мөр бүр «Дүрмийн багц X, хувилбар Y-ээр шалгав» хэлбэртэй. `readiness.test.ts` үүнийг тестээр барина (§3.8). |
| 10 | **Багийн тоог хаана ч ХАТУУ БИЧИХГҮЙ** | `Team checks: n/n`-ийн `n` нь АМЬДААР бодогдоно: төсөлд оролцож буй баг (`project_team_shares.share_percent > 0`) **∩** дүрмийн багцТАЙ баг. **ЭЗЭН БАТАЛСАН 2026-08-30:** багц авах салбар нь ЯГ НАЙМ — BA · BB · HAS · TSBU · TSAH · HD · AU · IZ (v2 §46); `0007_teams.sql:38-47` нь ЕС мөр (тэр 8 + MGMT), `0074` нь EZ, GT нэмж АРВАН НЭГ болгоно, ба **MGMT · EZ · GT нь багц АВАХГҮЙ** тул хуваарьт ОРОХГҮЙ. Найм нь ТӨЛӨВЛӨЛТИЙН тоо, кодод бичих ЛИТЕРАЛ БИШ. |
| 11 | `finding_overrides`-ыг UPDATE ХИЙХГҮЙ | Тэр нь `2-5`-ын өөрийн append-only trigger дор. Энэ сесс түүнээс зөвхөн `SELECT` хийнэ. |
| 12 | Энэ сессийн ямар ч route-ыг MCP хэрэгсэл болгохгүй | `/mcp` нь `workerScopeGuard`, `entitlementGuard` ба tenant `tid` шалгалтыг НЭГ ЗЭРЭГ тойрдог. `routes/learning.ts` толгой үүнийг шууд хориглосон. |

---

## 1. КОНТЕКСТ

### Систем (хүйтэн сессид хангалттай хэмжээгээр)

| Хэсэг | Юу вэ |
|---|---|
| `backend/` | Cloudflare Worker — `@cloudflare/workers-oauth-provider` дотор Hono. D1 + R2 + KV + нэг Durable Object + Workers AI. `wrangler deploy` нь typecheck ХИЙХГҮЙ. |
| `frontend/` | Vite + React 19 SPA, Cloudflare Pages төсөл **`mgl-design-system`**. Хуудас бүр lazy. Frontend unit тест БАЙХГҮЙ. |
| `revit-mcp/addin/` | Revit 2024–2027 C#/WPF add-in, 46 `.cs` файл, **тест ТЭГ**, ~20 ажилтны компьютер, **авто шинэчлэл БАЙХГҮЙ**. Энэ сесс түүнийг ХӨНДӨХГҮЙ. |
| Багууд | `teams` хүснэгт. `0007_teams.sql:38-47` → BA, BB, HAS, TSBU, TSAH, HD, AU, IZ, MGMT (ЕС). `0074`-өөр EZ, GT нэмэгдэж АРВАН НЭГ. **ЭЗЭН БАТАЛСАН 2026-08-30 (v2 §46):** тэдгээрээс ЯГ НАЙМ нь дүрмийн багц авах салбар (BA · BB · HAS · TSBU · TSAH · HD · AU · IZ — шипсэн `IMPLEMENTED_TEAMS`-тэй ижил, `frontend/src/features/projects/team-reports/TeamReportsTab.tsx:52-61`); **MGMT · EZ · GT нь багцгүй**. Багийн ГИШҮҮНИЙ ТОО нь БАТАЛГААЖААГҮЙ хэвээр (§9-1). |
| Migration | Дискэн дээрх хамгийн өндөр нь **`0216_assistant_log_timing.sql`**. Энэ сесс дугаар АВАХГҮЙ. |

### Яагаад энэ даалгавар байна вэ

1. Эзний R2 нь хоёр хагастай: «зөрчлийг олох» БА **«цоорхойг харах» (see the gap)**. Хоёр дахь нь өнөөдөр ОГТ байхгүй — репод бүрэн бүтэн байдлын нэг ч дохио байхгүй.
2. §59-ийн таван ангиллын **`TEAM_STANDARD`** нь эзний R3-ыг (баг бүр өөр дүрэмтэй) гаралт дээр ХАРАГДУУЛДАГ цорын ганц зүйл. Түүнгүйгээр багийн дотоод стандартын зөрчил нь БНбД-ын зөрчлөөс ялгагдахгүй.
3. §60-ийн салбар хоорондын олдвор нь бодит асуудал: нэг `.rvt` файлыг хэд хэдэн салбарын инженер хуваалцдаг гэдгийг код өөрөө бичсэн (`AssistantPane.xaml.cs:246-254`).
4. §66-гүйгээр «AI зөв ажиллаж байна уу» гэсэн асуултад хариулах арга БАЙХГҮЙ. Одоогийн байдлаар худал дохионы тоо ТЭГ учир нь хэмжигдээгүй, олдвор ч байхгүй.
5. §69-ийн хаалга нь эзэнд харагдах ЦОРЫН ГАНЦ нэгдсэн дүр зураг. Түүнийг буруу (гэрчилгээ мэт) бичвэл хууль зүйн эрсдэл болно (§35–36).
6. Хувийн нууцын үл хөдлөх дүрэм нь энэ сессийн БҮХ дэлгэцийн хэлбэрийг шийднэ. Түүнийг зөрчсөн самбар нь ажилчдыг add-in-аас зайлуулна — тэр нь R7-ыг өөр замаар зөрчсөн хэрэг.

---

## 2. БАТАЛГААЖСАН ОДООГИЙН ЗАН ТӨЛӨВ

> Доорх `file:line` бүрийг энэ сесс өөрөө нээж баталгаажуулав (**2026-08-30**, commit `6a8e4f5`).

### 2.1 ХУВИЙН НУУЦЫН ҮЛ ХӨДЛӨХ ДҮРЭМ — дөрвөн migration толгой + route толгой, тестээр түгжсэн

Энэ бол §69 ба §66-ийн бүх дэлгэцийг тодорхойлдог хязгаарлалт. Дөрвөн газарт ЗОРИУД давтагдсан:

```
backend/migrations/0201_bim_artifacts.sql:23   -- ⚠️ ХУВИЙН НУУЦЫН ҮЛ ХӨДЛӨХ ДҮРЭМ (`lib/revitNoteAi.ts:152`-ийн шипсэн
backend/migrations/0201_bim_artifacts.sql:24   --    шийдвэртэй НЭГ, `revitNoteAi.test.ts:262`-оор түгжигдсэн):
backend/migrations/0201_bim_artifacts.sql:25   --    ЭЛЕМЕНТ ТҮВШНИЙ ҮЙЛ АЖИЛЛАГАА НЬ ЗӨВХӨН ӨӨРИЙГӨӨ ХАРАХАД.
backend/migrations/0201_bim_artifacts.sql:27   --      (а) өөрийн мөрөөр хязгаарлагдсан (`actor_user_id = viewer.sub`), эсвэл
backend/migrations/0201_bim_artifacts.sql:28   --      (б) зөвхөн НЭГТГЭСЭН (aggregate)
backend/migrations/0201_bim_artifacts.sql:30   --    ХЭЗЭЭ Ч буцаахгүй.
backend/migrations/0203_revit_transactions.sql:25  -- ⚠️ ХУВИЙН НУУЦЫН ҮЛ ХӨДЛӨХ ДҮРЭМ — 0201-ийнхтэй ИЖИЛ, зориуд дахин бичив
backend/migrations/0203_revit_transactions.sql:29  --    `op_name`, `added_count` зэрэг нь ахлагчийн тайланд ХЭЗЭЭ Ч орохгүй
backend/migrations/0205_learning_events.sql:42     -- ⚠️ ХУВИЙН НУУЦЫН ҮЛ ХӨДЛӨХ ДҮРЭМ — 0201/0203/0204-ийнхтэй ИЖИЛ,
backend/migrations/0205_learning_events.sql:43     --    зориуд дөрөв дэх удаагаа бичив
```

Route түвшинд ижил зүйл:

| Баримт | file:line | Бодит текст |
|---|---|---|
| Унших маршрут бүр өөрийн мөр эсвэл нэгтгэсэн | `backend/src/routes/learning.ts:67-69` | «элемент түвшний үйл ажиллагаа нь ЗӨВХӨН ӨӨРИЙГӨӨ ХАРАХАД … (б) зөвхөн НЭГТГЭСЭН тоолуур буцаана» |
| `GET /health` нь **админд ч** нийлбэр | `backend/src/routes/learning.ts:70-71` | «`GET /health` нь админд ч ЗӨВХӨН нийлбэр өгнө — нэрлэсэн жагсаалт ХЭЗЭЭ Ч биш» |

### 2.2 `GET /api/learning/health` — шипсэн жишээ: 11 нийлбэр, нэг ч нэр байхгүй

`backend/src/routes/learning.ts:894` нь `requireAdmin()` дор боловч буцаах бүх талбар нь `COUNT(*)` / `MAX()` / `SUM()`:

```
learning.ts:894   learning.get('/health', requireAdmin(), async (c) => {
learning.ts:897        (SELECT COUNT(*) FROM learning_events)                        AS events_total,
learning.ts:898        (SELECT COUNT(*) FROM learning_events WHERE parts_missing <> 0) AS events_unsatisfied,
learning.ts:904        (SELECT COUNT(*) FROM revit_transactions)                     AS txns_total,
learning.ts:907        (SELECT COUNT(*) FROM revit_element_touches)                  AS touches_total,
learning.ts:909        (SELECT COUNT(*) FROM bim_sessions)                           AS sessions_total,
learning.ts:911        (SELECT COALESCE(SUM(dropped_count), 0) FROM bim_sessions)    AS declared_dropped
```

⚠️ **Энэ бол хуулах загвар.** §69 ба §66-ийн route бүр яг ийм хэлбэртэй байна: `GROUP BY` нь `severity`, `issue_class`, `team_code`, `rule_uid` — **ХЭЗЭЭ Ч `user_id` / `actor_user_id` БИШ**.

### 2.3 `ChangeTracker.Hits` — HR-ийн хил нь кодод АЛЛ ХЭДИЙН шийдэгдсэн

```
ChangeTracker.cs:90    /// <summary>
ChangeTracker.cs:91    /// Энэ элементийг ХЭДЭН УДАА хөндсөн бэ.
ChangeTracker.cs:93    /// ⚠️ ЭНЭ БОЛ ЗӨВХӨН ӨӨРИЙГӨӨ ШАЛГАХ ТОО (2026-08-26-ны шийдвэр).
ChangeTracker.cs:94    /// Ахлагчийн тайланд ХЭЗЭЭ Ч ОРОХГҮЙ: нэг ханыг 20 удаа хөндсөн нь
ChangeTracker.cs:95    /// «муу ажилтан» гэсэн үг биш, суралцаж яваа хүний хэвийн байдал.
ChangeTracker.cs:96    /// Тайланд оруулбал энэ нь шинэ ажилтныг шийтгэх хэрэгсэл болно.
ChangeTracker.cs:97    /// Инженер өөрөө «би энд хэт удаан эргэлдсэн байна» гэдгээ хармаар
ChangeTracker.cs:98    /// бол самбартаа харна.
ChangeTracker.cs:100   public int Hits;
```

⚠️ **Энэ шийдвэр нь §66-д ШУУД хамаарна.** «Хэн хамгийн олон зөрчил гаргасан бэ» гэсэн үзүүлэлт нь `Hits`-тэй яг ижил алдаа — өөр нэртэй. Түүнийг хийвэл ажилчид add-in-ыг унтраана, тэр нь R7-ыг өөр замаар зөрчсөн хэрэг.

### 2.4 Нэг `.rvt` файлыг олон салбар хуваалцдаг — `_scopeAll` анхдагчаар FALSE

```
AssistantPane.xaml.cs:246   /// <summary>
AssistantPane.xaml.cs:247   /// Менежер «файлын бүх ажлыг» харахыг хүссэн эсэх (`?scope=all`).
AssistantPane.xaml.cs:249   /// ⚠️ Анхдагч нь ҮРГЭЛЖ false.  Нэг .rvt файлыг олон салбарын инженер
AssistantPane.xaml.cs:250   /// хуваалцдаг ба хуудасны холбоос нь багийн ХУВААЛЦСАН тул бүх ажлыг
AssistantPane.xaml.cs:251   /// анхдагчаар харуулбал цахилгаанчин архитекторын ажил дээр явц илгээх
AssistantPane.xaml.cs:252   /// эрсдэл үүснэ.  Сервер энэ тугийг зөвхөн admin/senior-д хүлээж авна.
AssistantPane.xaml.cs:254   private bool _scopeAll;
```

⚠️ Энэ нь §60-ийн ХАГАСЫГ баталж, НӨГӨӨ ХАГАСТАЙ нь мөргөлдөнө. «Надад МИНИЙ салбарын олдворыг үзүүл» нь зөв анхдагч; гэвч §60-R4 нь «алдаа бүр харж байгаа багийнх гэж бүү тооц» гэдэг — BA инженер нь **BB эзэмшсэн, BA-д НӨЛӨӨЛСӨН** олдворыг харах ЁСТОЙ. §3.3 нь үүнийг хоёр өөр түлхүүрээр шийднэ.

### 2.5 `AccordionForm.isFilled` — гурван төлөвийн ялгааг шипсэн прецедент

```
AccordionForm.tsx:41   /** A field is "filled" when its value isn't empty/false/empty-array.
AccordionForm.tsx:42    *  Boolean false counts as unfilled (a deliberate empty checkbox)
AccordionForm.tsx:43    *  so the progress bar reflects what the user has actually said
AccordionForm.tsx:44    *  rather than what they've merely been shown. */
AccordionForm.tsx:45   function isFilled(value: unknown): boolean {
AccordionForm.tsx:49     if (typeof value === 'boolean') return value;
```

⚠️ **Энэ дүрмийг §59-д ЗААВАЛ давтана.** Чагтлаагүй нүд = «хэрэглэгч ХЭЛЭЭГҮЙ», «үгүй гэж хэлсэн» БИШ. Хэрэв бүрэн бүтэн байдлын хөдөлгүүр нь `false`-ыг «байхгүй» гэж уншвал шинэ загвар бүр дээр 20 худал олдвор гаргана — тэр нь §66-ийн худал дохионы хамгийн том эх сурвалж болно.

### 2.6 BA-ийн 21 мөр, IZ-ийн 16 мөрийн зургийн жагсаалт — бэлэн бүрэн бүтэн байдлын шалгуур

```
ba/BaDocument.tsx:81    const DRAWING_LIST_ROWS: Array<{ no: number; key: keyof BaReportAnswers; label: string }> = [
ba/BaDocument.tsx:82      { no: 1, key: 'dl_cover', label: 'Нүүр хуудас' },
ba/BaDocument.tsx:86      { no: 5, key: 'dl_floor_plans', label: 'Давхрын байгуулалтууд' },
ba/BaDocument.tsx:88      { no: 7, key: 'dl_sections', label: 'Огтлолууд' },
ba/BaDocument.tsx:98      { no: 17, key: 'dl_elevator', label: 'Цахилгаан шат, шатны хэсэглэл' },
ba/BaDocument.tsx:100     { no: 19, key: 'dl_fire_stair', label: 'Галын шатны хэсэглэл' },
ba/BaDocument.tsx:102     { no: 21, key: 'dl_other', label: 'Бусад нарийн хэсэглэл' },
iz/template.ts:47        { key: 'dl_ceiling_layout', label: '7.  Таазны байгуулалт', kind: 'checkbox', span: 'full' },
iz/template.ts:49        { key: 'dl_lighting_layout', label: '9.  Гэрлийн байгуулалт', kind: 'checkbox', span: 'full' },
iz/template.ts:55        { key: 'dl_quantities', label: '16. Тоо хэмжээ', kind: 'checkbox', span: 'full' },
```

⚠️ `dl_*` нь өнөөдөр ГАРААР чагтлагддаг. Add-in нь харгалзах Revit хуудсыг илрүүлээд түүнийг АВТОМАТААР тавьж чадна — гарын чагтыг **идэвхгүй илрүүлэлт** болгож хувиргана (§71: үйлдэл бүрд гар оролт шаардахгүй). Энэ сесс тэрийг ХИЙХГҮЙ (C# хөндөхгүй), гэхдээ уншлагын хэлбэрийг тэр ирээдүйд БЭЛТГЭНЭ: §3.2-ын `sheet_coverage` дохио нь эх сурвалжаа `manual | detected` гэж ялгана.

### 2.7 `bb/template.ts` CALC_SECTION — шипсэн салбарын бэлэн байдлын хаалга

```
bb/template.ts:350   export const CALC_SECTION: BbSection = {
bb/template.ts:352     title: 'Тооцоо төлөвлөлт',
bb/template.ts:356       key: 'limit_state_first_group',   label: '1-р бүлэг хязгаарын төлвөөр тооцсон',
bb/template.ts:362       key: 'limit_state_second_group',  label: '2-р бүлэг хязгаарын төлвөөр шалгасан',
bb/template.ts:368       key: 'progressive_collapse_calc', label: 'Өргөжин нурах эвдрэлийг тооцсон',
bb/template.ts:374       key: 'permanent_monitoring',      label: 'Даацын бүтээцийн байнгын хяналт шинжилгээ',
bb/template.ts:380   };
```

⚠️ Дөрвөн boolean = «энэ салбар хянуулахад бэлэн үү». §69-ийн `Team checks: n/n` нь яг ЭНЭ хэлбэрийг **дүрмийн түвшинд** давтана: багц дүрэм АЖИЛЛАСАН уу, үгүй юу.

### 2.8 `0216` — «хэмжилтээ хэмжих» заль нь репод аль хэдийн байна

```
0216_assistant_log_timing.sql:65   -- ⚠️ Хуучин `decided_by` баганатай ДАВХАРДАНА (ижил гурван утга) — ЗОРИУД.
0216_assistant_log_timing.sql:66   --    Тэд add-in-ы ӨӨР ХОЁР кодын замаас гарна (`IntentRouter.DecidedByTag`
0216_assistant_log_timing.sql:67   --    ба `Timing`-ийн бичилт), тиймээс `route_layer <> decided_by` гэсэн мөр
0216_assistant_log_timing.sql:68   --    нь өөрөө хэмжилтийн БҮРТГЭЛИЙН АЛДААНЫ дохио.
0216_assistant_log_timing.sql:72   ALTER TABLE assistant_logs ADD COLUMN route_layer TEXT
0216_assistant_log_timing.sql:73     GENERATED ALWAYS AS (json_extract(timing_json, '$.route_layer')) VIRTUAL;
```

⚠️ §66 нь яг үүнийг давтана: **хөдөлгүүрийн дүгнэлтийг хүний дүгнэлтийн ХАЖУУД хадгалж, ЗӨРҮҮГ өгөгдөл гэж үзнэ.** `2-5`-ын `finding_overrides` нь хоёуланг нь аль хэдийн барьдаг — `verdict_at_override` (хөдөлгүүр) ба `override_kind` (хүн). Шинэ багана ХЭРЭГГҮЙ.

### 2.9 `nominate.py` / `run_golden.py` — «автоматаар нэр дэвшүүл, ГАРААР батал» ба «хоосон = ХАТУУ БЛОК»

```
eval/nominate.py:1     r"""ХЭЦҮҮ ТОХИОЛДЛЫН НЭР ДЭВШҮҮЛЭЛТ (1B-5 §3.5) — ЗӨВХӨН УНШИНА.
eval/nominate.py:4     нэр дэвшүүлэх мөрүүдийг ХЭВЛЭНЭ.  Хаана ч БИЧИХГҮЙ — `difficult_cases.json`
eval/nominate.py:5     руу оруулах цорын ганц зам нь ХҮН `freeze.py add`-ээр батлах явдал.
eval/nominate.py:9     ⚠️ НЭР ДЭВШҮҮЛЭЛТ АВТОМАТ, БАТЛАХ НЬ АВТОМАТ БИШ.  Автомат оруулбал загвар
eval/nominate.py:10    өөрийн ЭРГЭЛЗЭЭГЭЭ өөрөө шалгуур болгож, гогцоо хаагдана
eval/run_golden.py:315         if name in required and res["rows"] == 0:
eval/run_golden.py:316             blocked.append(name)          # ❌ АЛГАСАХГҮЙ
eval/run_golden.py:352                 print(f"     {name}: ХООСОН — «хараахан хэмжээгүй» гэдэг нь "
eval/run_golden.py:353                       f"«хэмжих шаардлагагүй» гэсэн үг БИШ (§3.4).",
eval/run_golden.py:356         sys.exit(2)
```

⚠️ Хоёр дүрэм шууд өвлөгдөнө: (1) маргаантай олдворыг АВТОМАТААР `rule_test_cases` руу оруулахгүй — зөвхөн нэр дэвшүүлнэ; (2) **хэмжигдээгүй нь «сайн» гэсэн үг БИШ** — §69-ийн хаалга нь мэдээлэл дутуу үед НОГООН болохгүй, `UNKNOWN` болно.

### 2.10 Багийн бүртгэл ба төслийн бүрэлдэхүүн

```
0007_teams.sql:38   INSERT OR IGNORE INTO teams (code, name_mn, name_en, sort_order) VALUES
0007_teams.sql:39     ('BA',   'Барилга архитектур',    'Architecture',       10),
0007_teams.sql:40     ('BB',   'Барилга бүтээц',        'Structure',          20),
0007_teams.sql:47     ('MGMT', 'Менежмент',             'Management',         90);
0042_project_team_shares.sql:28   CREATE TABLE IF NOT EXISTS project_team_shares (
0042_project_team_shares.sql:30     project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
0042_project_team_shares.sql:31     team_id    INTEGER NOT NULL REFERENCES teams(id)    ON DELETE CASCADE,
0042_project_team_shares.sql:32     share_percent REAL NOT NULL DEFAULT 0
0042_project_team_shares.sql:37     UNIQUE(project_id, team_id)
```

⚠️ `share_percent` нийлбэр 100 болохыг ЮУ Ч шаарддаггүй (0042-ын толгойд зориуд бичсэн). Тиймээс `Team checks`-ийн хуваарь нь **`share_percent > 0` бүхий баг** — хувиар жинлэхгүй.

⚠️ **ХОЁР ДАХЬ ШҮҮЛТ — ЭЗЭН БАТАЛСАН 2026-08-30.** Хуваарь нь тэр багуудын дотроос **дүрмийн багцТАЙ** нь Л байна. Багц авах салбар нь ЯГ НАЙМ (BA · BB · HAS · TSBU · TSAH · HD · AU · IZ, v2 §46); **MGMT · EZ · GT нь багц АВАХГҮЙ**. Тэдний аль нэг нь `share_percent > 0`-той төсөлд байвал багцгүй тул `ran` нь ХЭЗЭЭ Ч үнэн болохгүй ба хаалга МӨНХӨД улаан үлдэнэ — тиймээс тэднийг хуваариас ХАСНА. Багцгүй код нь `TEAM = UNCERTAIN` **БИШ** (`2-1` §3.4 «ДҮРМИЙН БАГЦГҮЙ БАГ» — эзэн баталсан 2026-08-30): илрүүлэлт нь АМЖИЛТТАЙ болсон, `bim_sessions.team_code` нь **бодит код** (MGMT/EZ/GT), `team_source` нь шатны бодит эх сурвалж, `team_confidence` нь шатны бодит утга, `learning_events` нь тэр кодоор **ШОШГОЛНО** (§72 — эс бөгөөс ажил БАГГҮЙ корпуст орно), chip нь «Баг: EZ (дүрмийн багцгүй)» гэж уншина ба хэрэглэгчээс ЮУ Ч ШААРДАХГҮЙ. Зөвхөн **нийцлийн шалгалт** алгасагдана (`complianceEnabled` → `false`). Хоёр төлөвийг ХОЛИХГҮЙ: UNCERTAIN = илрүүлэлт УНАСАН (`team_code` NULL, `team_source='uncertain'`, `team_confidence` 0.0, шошго null, chip «Баг: тодорхойгүй», хэрэглэгчээс залруулга шаардана). ⛔ Аль ч тохиолдолд багцгүй баг нь **ӨӨР БАГИЙН дүрэм рүү ХЭЗЭЭ Ч УНАХГҮЙ** — багц алга бол шалгалт АЛГА, орлуулга БИШ (v2 §48-R6). Найм нь ТӨЛӨВЛӨЛТИЙН тоо — доорх SQL нь тоог БИШ, багцын ОРШИХУЙГ шалгана.

⚠️ **ЭХНИЙ РЕЛИЗҮҮДЭД ХУВААРЬ НЬ НЭГ БАЙНА — ЭЗЭН БАТАЛСАН 2026-08-30.** Бүрэн бичигдэх ЭХНИЙ дүрмийн багц нь **BA (Барилга архитектур)**; `frontend/src/features/projects/team-reports/ba/` нь аль хэдийн **12 БНбД эшлэлтэй** (түүнээс 3 нь `ba/template.ts`-д — `:570`, `:597`, `:600`; `grep -ro БНбД`, 2026-08-30-нд тоолов) — салбаруудаас ХАМГИЙН ТОМ бэлэн үр (BB 5, HAS 1, үлдсэн тав нь ТЭГ), тиймээс ажиллах багц хүртэлх ХАМГИЙН БОГИНО зам. Үлдсэн долоо нь BA-гийн БҮТЦЭЭР бичигдэнэ. **IZ (Интерьер зураг) нь эзний эрэмбээр ХОЁРДУГААРТ, гэхдээ `iz/` бүхэлдээ БНбД эшлэл ТЭГ** — түүний багцыг загвараас ХУРААХ боломжгүй, норм каталогоос ЗОХИОХ ёстой; энэ бол багцын хөтөлбөрийн ГОЛ хуваарийн эрсдэл. Практик үр дагавар: BA л багцтай байх хугацаанд `Team checks` нь ихэнх төсөл дээр **1/1** гэж уншигдана — тэр нь ЗӨВ. «Найман баг шалгагдсан» гэж УНШИГДАХААР шошго БҮҮ бич; §69-R3-ын дагуу шошго нь ҮРГЭЛЖ «дүрмийн багц X, хувилбар Y-ээр шалгав» хэлбэртэй.

### 2.11 `/api/compliance` ба `readiness.ts` өнөөдөр БАЙХГҮЙ

```bash
ls backend/src/routes/compliance.ts backend/src/lib/complianceModel.ts backend/src/lib/readiness.ts
```

Хэмжсэн гаралт (2026-08-30):

```
ls: backend/src/lib/complianceModel.ts: No such file or directory
ls: backend/src/lib/readiness.ts: No such file or directory
ls: backend/src/routes/compliance.ts: No such file or directory
```

⚠️ `compliance.ts` ба `complianceModel.ts` -ыг **`2-2` үүсгэнэ** (тэр файлын толгойд «(ШИНЭ)» гэж бичигдсэн). Энэ сесс тэдгээрийг ЗӨВХӨН ӨРГӨТГӨНӨ. Хэрэв `2-2` хараахан хэрэгжээгүй бол энэ сесс ЭХЭЛЖ БОЛОХГҮЙ (§5).

### 2.12 Өрөөний талбар нь серверт ХҮРДЭГ цорын ганц геометрийн дохио

```
0120_qto_fields_rooms.sql:22   CREATE TABLE IF NOT EXISTS qto_rooms (
0120_qto_fields_rooms.sql:26     number      TEXT NOT NULL DEFAULT '',
0120_qto_fields_rooms.sql:27     name        TEXT NOT NULL DEFAULT '',
0120_qto_fields_rooms.sql:28     level       TEXT NOT NULL DEFAULT '',
0120_qto_fields_rooms.sql:29     area_m2     REAL,
```

⚠️ «Өрөө байхгүй» (§59-R2 №3) -ыг өнөөдөр л хэмжиж болно: сүүлийн `qto_run`-д `qto_rooms` мөр ТЭГ. Гэхдээ энэ нь **ГАРААР түлхэгддэг** (`Тоо хэмжээ илгээх`), тиймээс сүүлийн түлхэлтийн огноо нь өөрөө нэг бүрэн бүтэн байдлын дохио (§3.2, `qto_staleness`).

### 2.13 Өндөр барилгын босго — прозоор л байгаа

```
project-sections/generalTemplate.ts:86   hint: 'Онцгой: 51м-ээс дээш эсвэл 16 давхраас дээш барилга.',
project-sections/generalTemplate.ts:94   hint: 'БНбД 21-01-02 ангилал',
```

⚠️ Энэ бол репо дахь хамгийн эрх мэдэлтэй өндөр барилгын мэдэгдэл ба §59-ийн «төслийн мэдээлэл дутуу» шалгуурын гол оролт: `building_complexity_class` хоосон бол ӨНДӨР БАРИЛГЫН дүрмийн багц АЖИЛЛАХГҮЙ, тэр нь ЧИМЭЭГҮЙ БАЙХ ЁСГҮЙ.

---

## 3. ХИЙХ АЖИЛ

### 3.0 Migration ШААРДЛАГАГҮЙ — зориуд

```bash
ls backend/migrations | tail -5
# Хүлээгдэх: … 0216_assistant_log_timing.sql
```

**Энэ сесс дугаар АВАХГҮЙ.** Учир нь §59/§60/§66/§69-ийн БҮХ өгөгдөл нь `2-2`, `2-3`, `2-5`-ын хүснэгтэд аль хэдийн байна:

| v2 шаардлага | Хаанаас уншина | Эзэн |
|---|---|---|
| Ноцтой байдлаар тоолсон олдвор | `compliance_findings.severity`, `.verdict`, `.issue_class`, `.lifecycle_state` | `2-3` |
| Салбар хоорондын харьяалал | `compliance_findings.owner_team_code` + `finding_teams(finding_id, team_code, relation)` | `2-3` |
| Хамаарал (dependency) | `finding_edges(from_finding_id, to_finding_id, kind)` | `2-3` |
| Дүрэм АЖИЛЛАСАН уу | `rule_run_ledger(session_id, rule_uid, ruleset_version, considered, applicable, evaluated, skipped_reason, aborted)` | `2-3` |
| Худал дохио (FP) | `finding_overrides.override_kind = 'FALSE_POSITIVE'` + `.review_state` | `2-5` |
| Алдсан зөрчил (FN) | `rule_test_cases.expect_verdict = 'VIOLATION'` + `.verified = 1` | `2-2` (экспорт нь `2-6`) |
| Дүрмийн ноцтой байдал / анги | `rules.severity`, `rules.issue_class`, `rules.expect_applicable` | `2-2` |
| Багийн бүртгэл | `teams` × `project_team_shares` | шипсэн (0007 / 0042) |

⚠️ **Хэрэв уншихад шинэ багана хэрэгтэй болвол — ЭНЭ СЕССЭД БҮҮ НЭМ.** Тухайн хүснэгтийн эзэн файлд (`2-2`/`2-3`/`2-5`) хүсэлт болгон бич, §9-д асуулт болгон гарга. Хоёр агент нэг хүснэгт рүү багана нэмбэл `duplicate column name` алдаа гарч, файл ХАГАС хэрэгжинэ.

### 3.1 `backend/src/lib/complianceModel.ts` — §59-ийн бүрэн бүтэн байдлын толь нэмнэ

`2-2` энэ файлыг үүсгэсэн ба `VERDICTS` / `SEVERITIES` / `ISSUE_CLASSES` / `EVIDENCE_LEVELS`-ыг аль хэдийн эзэмшинэ. Энэ сесс дараах блокыг **төгсгөлд нь нэмнэ** — өмнөх экспортыг ЗАСАХГҮЙ.

```ts
/* ================================================================== */
/*  §59 БҮРЭН БҮТЭН БАЙДАЛ / БЭЛЭН БАЙДАЛ                              */
/* ================================================================== */

/**
 * v2 §59-R2-ын АРВАН нөхцөл, ЯГ ТЭР дарааллаар.
 *
 * ⚠️ Энэ бол ХААЛТТАЙ багц.  `Record<CompletenessCheck, …>` болгосон учир
 *    шинэ шалгуур нэмбэл `COMPLETENESS_SPEC` дээр compile алдаа гарна —
 *    `bimEvents.ts`-ийн `REQUIRED_PARTS_OF` ба `webPush.ts`-ийн
 *    `CATEGORY_OF`-той яг ижил заль.
 */
export const COMPLETENESS_CHECKS = [
  'required_categories',   // 1. шаардлагатай ангилал дутуу
  'required_params',       // 2. параметр дутуу
  'rooms',                 // 3. өрөө дутуу
  'openings',              // 4. хаалга/цонх дутуу
  'sheets',                // 5. хуудас дутуу
  'model_warnings',        // 6. шийдэгдээгүй Revit warning
  'documentation',         // 7. баримтжуулалт дутуу
  'unapproved_types',      // 8. батлагдаагүй family/type
  'project_information',   // 9. төслийн мэдээлэл дутуу
  'required_evidence',     // 10. шаардлагатай нотолгоо дутуу
] as const;
export type CompletenessCheck = (typeof COMPLETENESS_CHECKS)[number];

/**
 * ГУРВАН ТӨЛӨВ — `AccordionForm.isFilled` (`AccordionForm.tsx:41-44`)-ийн
 * шийдвэрийг ЗОРИУД давтав.
 *
 * ⚠️ `asserted_absent` ба `unknown` -ыг НЭГТГЭВЭЛ шинэ загвар бүр дээр
 *    бүх шалгуур «дутуу» болж, §66-ийн худал дохионы хамгийн том эх
 *    сурвалж болно.  Чагтлаагүй нүд нь «үгүй» биш, «ХЭЛЭЭГҮЙ».
 */
export const COMPLETENESS_STATES = ['unknown', 'asserted_absent', 'asserted_present'] as const;
export type CompletenessState = (typeof COMPLETENESS_STATES)[number];

/** Дохионы эх сурвалж — §71-ийн «гар оролтгүй» зорилтын хэмжүүр. */
export const COMPLETENESS_SOURCES = ['manual', 'detected', 'derived', 'unavailable'] as const;
export type CompletenessSource = (typeof COMPLETENESS_SOURCES)[number];

export type CompletenessSpec = {
  /** Монгол шошго — UI ба хэвлэлд ЭНЭ гарна. */
  label_mn: string;
  /** §59-R3-ын таван ангиллын аль нь болох. */
  issue_class: IssueClass;
  /** §67-ийн хэмжээс.  Хаалганы тооцоонд ЭНЭ орно. */
  severity: Severity;
  /** Дохиог хаанаас авах вэ (2026-08-30-ны бодит боломж). */
  source: CompletenessSource;
  /** `unavailable` бол ЯАГААД — §9-д асуулт болж гарна. */
  blocked_reason?: string;
};

export const COMPLETENESS_SPEC: Record<CompletenessCheck, CompletenessSpec> = {
  required_categories: {
    label_mn: 'Шаардлагатай ангилал',
    issue_class: 'PROJECT_INCOMPLETENESS',
    severity: 'HIGH',
    source: 'derived',
  },
  required_params: {
    label_mn: 'Дүрэмд шаардагдах параметр',
    issue_class: 'MODEL_QUALITY',
    severity: 'MEDIUM',
    source: 'derived',
  },
  rooms: {
    label_mn: 'Өрөөний бүртгэл',
    issue_class: 'PROJECT_INCOMPLETENESS',
    severity: 'HIGH',
    source: 'derived',
  },
  openings: {
    label_mn: 'Хаалга, цонх',
    issue_class: 'MODEL_QUALITY',
    severity: 'MEDIUM',
    source: 'derived',
  },
  sheets: {
    label_mn: 'Зургийн жагсаалт',
    issue_class: 'PROJECT_INCOMPLETENESS',
    severity: 'MEDIUM',
    source: 'manual',
  },
  model_warnings: {
    label_mn: 'Шийдэгдээгүй Revit сануулга',
    issue_class: 'MODEL_QUALITY',
    severity: 'LOW',
    source: 'unavailable',
    blocked_reason:
      'Add-in нь Revit-ийн Warning жагсаалтыг ОГТ уншдаггүй — 46 .cs файлд FailuresProcessing / GetWarnings байхгүй.',
  },
  documentation: {
    label_mn: 'Тайлбар бичгийн бөглөлт',
    issue_class: 'PROJECT_INCOMPLETENESS',
    severity: 'LOW',
    source: 'derived',
  },
  unapproved_types: {
    label_mn: 'Батлагдаагүй family / type',
    issue_class: 'TEAM_STANDARD',
    severity: 'MEDIUM',
    source: 'unavailable',
    blocked_reason:
      'Багийн «батлагдсан family» жагсаалт репод БАЙХГҮЙ — эзний шийдвэр шаардлагатай (§9-4).',
  },
  project_information: {
    label_mn: 'Төслийн ангилал ба өндөр',
    issue_class: 'PROJECT_INCOMPLETENESS',
    severity: 'CRITICAL',
    source: 'derived',
  },
  required_evidence: {
    label_mn: 'Шаардлагатай нотолгоо',
    issue_class: 'UNKNOWN_NEEDS_REVIEW',
    severity: 'LOW',
    source: 'derived',
  },
};
```

⚠️ **`model_warnings` ба `unapproved_types` нь `unavailable` — ЗОРИУД.** Тэднийг «бүрэн» гэж дүр эсгэхээс илүү, шалгуур нь ХАРАГДАЖ байгаад «одоогоор хэмжигдэхгүй» гэж бичих нь §69-ийн бүх зорилготой нийцнэ (`run_golden.py:352-353`-ын философи). Тэд бүрэн бүтэн байдлын хувийг **бууруулахгүй** — хуваарьт ОГТ орохгүй (§3.4).

### 3.2 §59 — арван нөхцөл, тус бүрд нь шалгаж болох дохио

| # | v2 §59-R2 нөхцөл | Бодит дохио (2026-08-30) | `issue_class` | severity |
|---|---|---|---|---|
| 1 | required model categories missing | `rule_run_ledger.skipped_reason = 'no_category'` бүхий мөрийн `rule_uid` жагсаалт | `PROJECT_INCOMPLETENESS` | HIGH |
| 2 | missing parameters | `rule_run_ledger.skipped_reason = 'missing_params'` (`rules.requires_params_json`-оос) | `MODEL_QUALITY` | MEDIUM |
| 3 | missing rooms | Сүүлийн `qto_run`-д `qto_rooms` мөр = 0 (`0120_qto_fields_rooms.sql:22`) | `PROJECT_INCOMPLETENESS` | HIGH |
| 4 | missing doors/windows | `qto_facts.category IN ('Doors','Windows')` мөр = 0 | `MODEL_QUALITY` | MEDIUM |
| 5 | incomplete sheets | Багийн `dl_*` чагтын `asserted_present` харьцаа (BA 21, IZ 16 — §2.6) | `PROJECT_INCOMPLETENESS` | MEDIUM |
| 6 | unresolved warnings | **БОЛОМЖГҮЙ** — add-in Revit warning уншдаггүй | — | — |
| 7 | missing documentation | `project_team_reports.answers_json`-ийн бөглөгдсөн харьцаа (`isFilled` дүрмээр) | `PROJECT_INCOMPLETENESS` | LOW |
| 8 | unapproved families/types | **БОЛОМЖГҮЙ** — батлагдсан жагсаалт байхгүй | — | — |
| 9 | incomplete project information | `project_build_context` мөр байхгүй ЭСВЭЛ `building_complexity_class` хоосон (`generalTemplate.ts:86`) | `PROJECT_INCOMPLETENESS` | CRITICAL |
| 10 | missing required evidence | `learning_events` дээр `DATASET_ELIGIBLE_SQL`-ыг зөрчсөн (`parts_missing <> 0`) мөрийн НИЙЛБЭР | `UNKNOWN_NEEDS_REVIEW` | LOW |

⚠️ **ЭНЭ СЕССИЙН ГОЛ АРХИТЕКТУРЫН ШИЙДВЭР.** Дээрх дохиог хоёр өөр замаар илэрхийлнэ:

* **Дүрмээр бичигдсэн цоорхой** — `2-2`-д `issue_class = 'PROJECT_INCOMPLETENESS'` эсвэл `'TEAM_STANDARD'` -тай дүрэм зохиогдож, `2-3`-ын хөдөлгүүр түүнийг `compliance_findings` мөр болгож БИЧНЭ. №1, 2, 3, 4, 9 нь ийм байх ёстой.
* **Уншлагаар гаргасан цоорхой** — энэ сесс `GET …/readiness`-ийн хариунд `gaps[]` болгон ТООЦООЛЖ буцаана, ЮУ Ч БИЧИХГҮЙ. №5, 7, 10 нь ийм.

Хоёулаа НЭГ тоолуур руу нийлнэ (§3.4). Уншлагын салаа нь энэ сессийг migration-гүй байлгаж байгаа шалтгаан.

⚠️ **`sheet_coverage` дохионы эх сурвалжийг ЗААВАЛ ялгана.** `{check:'sheets', source:'manual'}` нь өнөөдрийн байдал; add-in хуудсыг илрүүлж эхэлбэл `source:'detected'` болно. Эх сурвалжийг ялгаагүй бол «инженер чагтлахаа мартсан» ба «зураг үнэхээр байхгүй» хоёр ялгагдахгүй — §66-ийн худал дохио.

### 3.3 §60 — салбар хоорондын олдвор: СОНГОЛТЫН түлхүүр ≠ ЭЗЭМШЛИЙН түлхүүр

**Хоёр өөр түлхүүр, хоорондоо хутгаж БОЛОХГҮЙ:**

| Түлхүүр | Юунд | Утга |
|---|---|---|
| **Сонголтын түлхүүр** | Дүрэм СОНГОХ (`2-2`/`2-3`) | Сессийн `bim_sessions.team_code`. BA сесс нь `WHERE team_code = 'BA' OR team_code IS NULL` — IZ-ийн дүрмийг ХЭЗЭЭ Ч харахгүй. |
| **Эзэмшлийн түлхүүр** | Олдвор ХАРУУЛАХ (энэ сесс) | `compliance_findings.owner_team_code` + `finding_teams(finding_id, team_code, relation)`, `relation IN ('owner','affected','responsible')`. |

§60-R3 нь «affected teams» -ыг ОЛОН ТООГООР бичсэн тул `finding_teams` нь холбоос хүснэгт байх ёстой — багана биш. Уншлагын гол SQL:

```sql
-- GET /api/compliance/projects/:id/findings?team=<code>
-- «НАДАД хамаатай олдворууд» — эзэмшсэн + нөлөөлсөн + хариуцсан.
SELECT f.id, f.dedup_key, f.rule_uid, f.rule_version, f.ruleset_version,
       f.verdict, f.severity, f.issue_class, f.evidence_level,
       f.lifecycle_state, f.stale_at, f.stale_reason,
       f.owner_team_code,
       ft.relation                            AS my_relation,
       (SELECT GROUP_CONCAT(x.team_code)
          FROM finding_teams x
         WHERE x.finding_id = f.id AND x.relation = 'affected')     AS affected_team_codes,
       (SELECT x.team_code
          FROM finding_teams x
         WHERE x.finding_id = f.id AND x.relation = 'responsible'
         LIMIT 1)                                                   AS responsible_team_code,
       (SELECT COUNT(*) FROM finding_edges e
         WHERE e.to_finding_id = f.id AND e.kind = 'causes')        AS caused_by_count
  FROM compliance_findings f
  INNER JOIN finding_teams ft
          ON ft.finding_id = f.id
         AND ft.team_code  = ?1                 -- ХАРАГЧИЙН баг
 WHERE f.project_id = ?2
   AND f.lifecycle_state IN ('OPEN', 'REOPENED')
   AND f.stale_at IS NULL
 ORDER BY CASE f.severity
            WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2
            WHEN 'LOW' THEN 3 ELSE 4 END,
          f.id DESC
 LIMIT 200
```

⚠️ **`f.detected_by` / `f.user_id` энэ SELECT-д ОГТ БАЙХГҮЙ — ЗОРИУД.** Салбар хоорондын харагдац нь БАГИЙН харагдац; хүнийхийг биш. Хэрэв ирээдүйд «миний олдвор» гэсэн харагдац хэрэгтэй бол тэр нь ӨӨР route бөгөөд `detected_by = viewer.sub` -ээр хатуу хязгаарлагдана (үл хөдлөх дүрмийн (а) салаа).

**§60-R3-ын дөрвөн талбар хэрхэн хангагдаж байна:**

| §60-R3 шаардлага | Хаанаас |
|---|---|
| owning team | `compliance_findings.owner_team_code` |
| affected teams (ОЛОН) | `finding_teams … relation = 'affected'` |
| responsible role | `finding_teams … relation = 'responsible'` → `teams.lead_user_id` руу биш, БАГИЙН КОД руу. Хүний нэр гарахгүй. |
| dependency | `finding_edges(kind = 'causes')` — үндсэн шалтгаан рүү заасан ирмэг |

⚠️ **`responsible` нь ХҮН биш, БАГ.** v2 нь «responsible role» гэсэн — үүрэг, хувь хүн биш. Нэр оруулбал үл хөдлөх дүрэм зөрчигдөнө; мөн `2-1`-ийн багийн шийдэлт эргэж засагдвал (§73) хуучин нэр буруу болно.

### 3.4 §69 — «Хянахад бэлэн» хаалга: `backend/src/lib/readiness.ts` (ШИНЭ)

**ЦЭВЭР функц. D1 БАЙХГҮЙ, Hono БАЙХГҮЙ, `Autodesk.*` БАЙХГҮЙ.** Тиймээс `node --test`-ээр Revit ч, D1 ч байхгүйгээр тестлэгдэнэ (`leaveWindow.test.ts`-ийн загвар).

```ts
/**
 * §69 «ХЯНАХАД БЭЛЭН» ХААЛГА — ЦЭВЭР ТООЦООЛОЛ.
 *
 * ⚠️ ЭНЭ НЬ ХУУЛЬ ЗҮЙН ГЭРЧИЛГЭЭ БИШ (v2 §69-R3).  Энэ нь инженерийн
 *    УРЬДЧИЛСАН хяналтын хаалга.  Гаралтын мөр бүр «шалгав» гэж бичнэ —
 *    «баталгаажлаа», «зөвшөөрөгдсөн», «нийцсэн» гэж ХЭЗЭЭ Ч бичихгүй.
 *    `readiness.test.ts` үүнийг мөрөөр нь барина.
 *
 * ⚠️ НЭГТГЭСЭН ЗҮЙЛ Л ОРНО.  Оролт бүр нь тоолуур; хэрэглэгчийн id,
 *    нэр, элементийн эзэн энд ОГТ БАЙХГҮЙ (0201:23-32-ын үл хөдлөх дүрэм).
 */

/** §67-ийн таван түвшин — `complianceModel.ts`-тэй НЭГ. */
export type SeverityCounts = Record<'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO', number>;

export type ReadinessInput = {
  /** OPEN/REOPENED, stale БИШ олдворууд ноцтой байдлаар. */
  open_by_severity: SeverityCounts;
  /** `verdict = 'UNCERTAIN'` мөрийн тоо (мөн OPEN/REOPENED). */
  uncertain_open: number;
  /** §59-ийн шалгуурын төлөв. */
  completeness: ReadonlyArray<{
    check: string;
    state: 'unknown' | 'asserted_absent' | 'asserted_present';
    /** `unavailable` эх сурвалжтай шалгуур ХУВААРЬТ ОРОХГҮЙ. */
    countable: boolean;
  }>;
  /** Багийн хамрах хүрээ — `project_team_shares` ∩ багцТАЙ баг, АМЬДААР. */
  team_checks: ReadonlyArray<{ team_code: string; ran: boolean }>;
  /** `rule_run_ledger`-ийн эрүүл мэнд. */
  ledger: {
    /** `rules.expect_applicable = 1` атлаа `applicable = 0` болсон дүрмийн тоо. */
    expected_but_inapplicable: number;
    /** `aborted > 0` бүхий мөрийн тоо. */
    aborted: number;
    /** Бүртгэлд ямар ч мөр байхгүй эсэх. */
    empty: boolean;
    /** Нийтлэгдээгүй `pack_sha256`-аар ажилласан сессийн тоо. */
    unpublished_pack_sessions: number;
  };
};

/* --- ХАТУУ ТООНУУД, тус бүр нь ШАЛТГААНТАЙ --- */

/** Ноцтой зөрчил үлдээд «бэлэн» гэж хэлэх боломжгүй. */
export const READY_MAX_CRITICAL = 0;
/** HIGH нь §67-R2-оор CRITICAL-тай ижил хатуу хаалгатай. */
export const READY_MAX_HIGH = 0;
/**
 * UNCERTAIN = «бид шийдэж чадаагүй».  Шийдэгдээгүй эргэлзээтэйгээр
 * «бэлэн» гэвэл §65 (нотолгоонд суурилсан) утгагүй болно.  Хүн
 * ACKNOWLEDGED / DISMISSED болговол тоолуураас гардаг тул энэ нь
 * ажлыг гацаахгүй — шийдвэр гаргахыг л шаардана.
 */
export const READY_MAX_UNCERTAIN = 0;
/**
 * 95% нь дурын тоо БИШ: `unavailable` хоёр шалгуур хуваарьт ороогүй
 * тул хуваарь нь ойролцоогоор найм.  8-аас нэг нь `unknown` бол 87.5%
 * — тэр нь БЭЛЭН БИШ байх ёстой.  Тиймээс босго нь 100-аас доогуур,
 * гэхдээ нэг ч шалгуур дутахыг зөвшөөрөхгүй өндөр байх ёстой.
 */
export const READY_MIN_COMPLETENESS_PCT = 95;

export type ReadinessStatus = 'READY' | 'NOT_READY' | 'UNKNOWN';

export type ReadinessResult = {
  status: ReadinessStatus;
  /** Яагаад бэлэн биш — i18n түлхүүр + тоо.  Чөлөөт бичвэр БИШ. */
  blockers: ReadonlyArray<{ key: string; count: number }>;
  completeness_pct: number;
  completeness_known: number;
  completeness_total: number;
  team_checks_done: number;
  team_checks_total: number;
};

/**
 * §59-ийн бүрэн бүтэн байдлын хувь.
 *
 * ⚠️ `countable = false` шалгуур нь ХУВААРЬТ ОРОХГҮЙ.  «Хэмжиж
 *    чадахгүй» зүйлийг «дутуу» гэж тоолбол хувь нь мөнхөд 80% дээр
 *    зогсож, хаалга утгагүй болно.  Тэр шалгуурууд нь `gaps[]`-д
 *    `unavailable` гэж ХАРАГДСАН хэвээр үлдэнэ — нуугдахгүй.
 */
export function computeCompleteness(
  rows: ReadinessInput['completeness'],
): { pct: number; known: number; total: number } {
  const countable = rows.filter((r) => r.countable);
  const total = countable.length;
  if (total === 0) return { pct: 0, known: 0, total: 0 };
  const known = countable.filter((r) => r.state !== 'unknown').length;
  return { pct: Math.round((known / total) * 100), known, total };
}

/**
 * §69-ийн `Team checks: n/n`.
 *
 * ⚠️ ХУВААРЬ НЬ АМЬД БҮРТГЭЛ.  7 ч биш, 8 ч биш, 9 ч биш — төсөлд
 *    оролцож БУЙ баг (`project_team_shares.share_percent > 0`) ба
 *    дүрмийн багцТАЙ багийн ОГТЛОЛЦОЛ.  Админ ажиллаж байхад баг
 *    нэмж чадна (`POST /api/teams`), багц ч нэмэгдэж болно.
 *
 * ⚠️ ЭЗЭН БАТАЛСАН 2026-08-30 (v2 §46): багц авах салбар нь ЯГ НАЙМ
 *    (BA · BB · HAS · TSBU · TSAH · HD · AU · IZ); MGMT · EZ · GT нь
 *    багц АВАХГҮЙ тул хуваарьт ОРОХГҮЙ — эс бөгөөс MGMT-тэй төсөл
 *    мөнхөд `NOT_READY` үлдэнэ.  Тэр найм нь ТӨЛӨВЛӨЛТИЙН тоо;
 *    ЭНД болон `readiness.ts`-д ЛИТЕРАЛ болж ХЭЗЭЭ Ч орохгүй —
 *    шүүлт нь §3.6-ийн SQL дэх багцын ОРШИХУЙН шалгалт.
 */
export function computeTeamChecks(
  rows: ReadinessInput['team_checks'],
): { done: number; total: number } {
  return { done: rows.filter((r) => r.ran).length, total: rows.length };
}

/**
 * ГУРВАН ТӨЛӨВТ ХААЛГА.
 *
 * ⚠️ `UNKNOWN` нь `NOT_READY`-ээс ӨӨР бөгөөд ЗААВАЛ БАЙХ ёстой:
 *    «хэмжигдээгүй» гэдэг нь «зөрчилгүй» гэсэн үг БИШ
 *    (`eval/run_golden.py:352-353`-ын шийдвэрийг давтав).  Хөдөлгүүр
 *    огт ажиллаагүй загварыг НОГООН харуулбал инженер «Хянахад бэлэн»
 *    гэж тэмдэглэж, шалгагдаагүй загвар хяналтад орно.
 */
export function computeReadiness(input: ReadinessInput): ReadinessResult {
  const c = computeCompleteness(input.completeness);
  const t = computeTeamChecks(input.team_checks);
  const blockers: Array<{ key: string; count: number }> = [];

  /* --- 1. ТОДОРХОЙГҮЙ: хөдөлгүүр найдвартай ажиллаагүй --- */
  const unknown: Array<{ key: string; count: number }> = [];
  if (input.ledger.empty) unknown.push({ key: 'readiness.blocker.ledgerEmpty', count: 1 });
  if (input.ledger.expected_but_inapplicable > 0)
    unknown.push({
      key: 'readiness.blocker.expectedInapplicable',
      count: input.ledger.expected_but_inapplicable,
    });
  if (input.ledger.aborted > 0)
    unknown.push({ key: 'readiness.blocker.aborted', count: input.ledger.aborted });
  if (input.ledger.unpublished_pack_sessions > 0)
    unknown.push({
      key: 'readiness.blocker.unpublishedPack',
      count: input.ledger.unpublished_pack_sessions,
    });
  if (unknown.length > 0) {
    return { status: 'UNKNOWN', blockers: unknown, ...spread(c, t) };
  }

  /* --- 2. БЭЛЭН БИШ --- */
  if (input.open_by_severity.CRITICAL > READY_MAX_CRITICAL)
    blockers.push({ key: 'readiness.blocker.critical', count: input.open_by_severity.CRITICAL });
  if (input.open_by_severity.HIGH > READY_MAX_HIGH)
    blockers.push({ key: 'readiness.blocker.high', count: input.open_by_severity.HIGH });
  if (input.uncertain_open > READY_MAX_UNCERTAIN)
    blockers.push({ key: 'readiness.blocker.uncertain', count: input.uncertain_open });
  if (c.pct < READY_MIN_COMPLETENESS_PCT)
    blockers.push({ key: 'readiness.blocker.completeness', count: c.total - c.known });
  if (t.done < t.total)
    blockers.push({ key: 'readiness.blocker.teamChecks', count: t.total - t.done });

  return { status: blockers.length === 0 ? 'READY' : 'NOT_READY', blockers, ...spread(c, t) };
}

function spread(
  c: { pct: number; known: number; total: number },
  t: { done: number; total: number },
) {
  return {
    completeness_pct: c.pct,
    completeness_known: c.known,
    completeness_total: c.total,
    team_checks_done: t.done,
    team_checks_total: t.total,
  };
}

/**
 * §69-R3 — ГЭРЧИЛГЭЭНИЙ ХЭЛ ХОРИОТОЙ.
 *
 * ⚠️ Хориотой үгс: «баталгаажлаа», «зөвшөөрөгдсөн», «нийцсэн»,
 *    «certified», «approved», «compliant».  Хаалганы шошго ҮРГЭЛЖ
 *    «шалгав» — юу шалгасныг нь хувилбартай нь хамт хэлнэ.
 */
export const FORBIDDEN_GATE_WORDS = [
  'баталгаажлаа',
  'баталгаажсан',
  'зөвшөөрөгдсөн',
  'нийцсэн',
  'certified',
  'approved',
  'compliant',
] as const;

/** «Дүрмийн багц 2026-09-01.1, хувилбар 4-өөр шалгав» */
export function checkedLabel(rulesetVersion: string, ruleCount: number): string {
  return `Дүрмийн багц ${rulesetVersion}, ${ruleCount} дүрмээр шалгав`;
}

/** «12 дүрмээс 9 нь шалгагдав» — «бүгд OK» ГЭЖ ХЭЗЭЭ Ч бичихгүй. */
export function coverageLabel(applicable: number, evaluated: number): string {
  return `${applicable} дүрмээс ${evaluated} нь шалгагдав`;
}
```

**§69-ийн харагдац v2-ын жишээтэй ЯГ таарна:**

```
ТӨСЛИЙН ХЯНАЛТЫН БЭЛЭН БАЙДАЛ

Ноцтой зөрчил (CRITICAL):     0
Өндөр зөрчил (HIGH):          1
Дунд зөрчил (MEDIUM):         4
Тодорхойгүй олдвор:           3
Загварын бүрэн байдал:       96%
Багийн шалгалт:              6/7

Төлөв:
⚠️ БЭЛЭН БИШ

Дүрмийн багц 2026-09-01.1, 14 дүрмээр шалгав · 2026-08-30 14:02
Энэ нь инженерийн урьдчилсан хяналт — хууль зүйн гэрчилгээ БИШ.
```

⚠️ Сүүлийн мөр нь **UI-д ҮРГЭЛЖ харагдана**, tooltip дотор биш. §69-R3-ыг зөвхөн код дээр бичих нь хангалтгүй — хэрэглэгч уншдаг газарт байх ёстой.

### 3.5 §66 — худал эерэг / худал сөрөг: ХОЁР ЧИГЛЭЛ, ноцтой байдлаар жинлэсэн

**Хэмжүүрийн тодорхойлолт (шинэ багана ШААРДЛАГАГҮЙ):**

| Хэмжүүр | Тодорхойлолт | Эх сурвалж |
|---|---|---|
| `emitted[sev]` | Цонхонд үүссэн олдворын тоо, `verdict <> 'PASS'` | `compliance_findings` |
| `false_positive[sev]` | `finding_overrides.override_kind = 'FALSE_POSITIVE'` **БА** `review_state IN ('reviewed','verified')` | `finding_overrides` (`2-5`) |
| `fp_rate[sev]` | `false_positive[sev] / emitted[sev]` | тооцоолол |
| `unnecessary_warnings` | `verdict_at_override = 'WARNING'` бүхий `override_kind IN ('FALSE_POSITIVE','RULE_WRONG','NOT_APPLICABLE_HERE')` | `finding_overrides` |
| `expected_violations[sev]` | `rule_test_cases.expect_verdict = 'VIOLATION'` **БА** `verified = 1`, `rules.severity`-ээр бүлэглэсэн | `rule_test_cases` (`2-2`) |
| `missed_violations[sev]` | Тэдгээрээс сүүлийн golden гүйлтэд `PASS` буцаасан нь | `eval/last_run.json` (`2-6`) |
| `recall[sev]` | `1 − missed_violations[sev] / expected_violations[sev]` | тооцоолол |
| `uncertain_rate` | `verdict = 'UNCERTAIN'` / нийт олдвор | `compliance_findings` |
| `late_catch` | Шинэ `ruleset_version` дор `VIOLATION` болсон `dedup_key`, өмнөх хувилбар дор `PASS` байсан | `compliance_findings` + `RULE_VALIDATION` төлөв солигдлын мөр |

⚠️ **FN-ийг хэмжих ЭРХ МЭДЭЛТЭЙ газар нь D1 БИШ.** «Алдсан зөрчил» гэдэг нь тодорхойлолтоороо хөдөлгүүр ГАРГААГҮЙ мөр — түүнийг олдворын хүснэгтээс тоолох боломжгүй. Тиймээс:

* **Албан ёсны FN** = `revit-mcp/eval/run_golden.py --kind rules` -ийн үр дүн. `2-6`-ийн `gen-rule-golden.mjs` нь `rule_test_cases (verified = 1)`-ыг `eval/golden/rules.json` руу экспортлоно; гүйлтийн үр дүн `eval/last_run.json`-д үлдэнэ. Энэ бол релизийн хаалга.
* **Онлайн FN ойролцоолол (PROXY)** = `late_catch`. Энэ нь «өмнөх дүрмийн багц үүнийг алдсан байна» гэдгийг харуулна. **Албан ёсныг ОРЛОХГҮЙ** — UI дээр «ойролцоо» гэж тэмдэглэгдэнэ.

**§66-R3 бол ЗӨВЛӨГӨӨ БИШ, ТАТГАЛЗАХ ШАЛГУУР.** Цэвэр функц:

```ts
/**
 * §66-R3 — «олон сануулга гаргаад ноцтой зөрчлийг алддаг систем нь
 * АМЖИЛТГҮЙ».  Тиймээс энэ нь ТАТГАЛЗАХ шалгуур: нийт нарийвчлал
 * сайжирсан ч CRITICAL-ийн recall буурсан бол багц ГАРАХГҮЙ.
 *
 * ⚠️ Тэвчээрийн тоонууд нь `pull_and_retrain.py`-ийн шипсэн
 *    `--max-drop 0.02` / `--max-drop-intent 0.05` -ыг ЗОРИУД давтав,
 *    гэхдээ CRITICAL дээр ТЭГ: ноцтой зөрчлийн мэдрэмж буурахыг
 *    «бага зэрэг» гэж зөвшөөрөх боломжгүй.
 */
export const RECALL_MAX_DROP_OVERALL = 0.02;
export const RECALL_MAX_DROP_PER_SEVERITY = 0.05;
export const RECALL_MAX_DROP_CRITICAL = 0.0;

export function packRegressed(
  prev: Partial<Record<keyof SeverityCounts, number>>,
  next: Partial<Record<keyof SeverityCounts, number>>,
  overallPrev: number,
  overallNext: number,
): { regressed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (overallPrev - overallNext > RECALL_MAX_DROP_OVERALL)
    reasons.push(`overall recall ${overallPrev.toFixed(3)} → ${overallNext.toFixed(3)}`);
  for (const sev of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const) {
    const p = prev[sev];
    const n = next[sev];
    if (p == null || n == null) continue;      // хэмжигдээгүйг уналт гэж тооцохгүй
    const limit = sev === 'CRITICAL' ? RECALL_MAX_DROP_CRITICAL : RECALL_MAX_DROP_PER_SEVERITY;
    if (p - n > limit) reasons.push(`${sev} recall ${p.toFixed(3)} → ${n.toFixed(3)}`);
  }
  return { regressed: reasons.length > 0, reasons };
}
```

⚠️ **`p == null || n == null` салаа нь ЗААВАЛ.** `run_golden.py:315`-ийн философи: хэмжигдээгүй хуваарийг «унасан» гэж тооцвол шинэ ноцтой байдал нэмэх бүрд багц блоклогдоно; харин «дамжсан» гэж тооцвол хэмжилтгүй багц гарна. Тиймээс ЭНД дамжуулж, БЛОКЛОХ ажлыг `run_golden.py`-ийн хоосон-хуваарийн дүрэмд үлдээнэ (энэ нь аль хэдийн `exit 2` хийдэг).

**«Хэмжилтээ хэмжих» (0216-ийн заль):** хөдөлгүүрийн дүгнэлт нь `finding_overrides.verdict_at_override`-д, хүний дүгнэлт нь `override_kind`-д ХӨЛДӨНӨ. Тэдний ЗӨРҮҮ нь §66-ийн өгөгдөл. Шинэ багана хэрэггүй — `2-5` аль хэдийн хоёуланг нь хадгалдаг.

**Маргаантай олдворыг АВТОМАТААР тест болгохгүй.** `nominate.py:9-10`-ийн дүрмийг өвлөнө: `GET …/quality?nominate=1` нь `rule_test_cases` болгож болох нэр дэвшигчдийг **ХЭВЛЭНЭ**, БИЧИХГҮЙ. Оруулах цорын ганц зам нь `2-2`-ийн курацийн UI.

### 3.6 Route-ууд — `backend/src/routes/compliance.ts`-д НЭМНЭ

`2-2` нь энэ файлыг үүсгэж, `/api/compliance`-ыг `index.ts` ба `lib/modules.ts`-д бүртгэсэн байна. Энэ сесс ГУРВАН GET нэмнэ. Бүгд `requireRole('engineer','architect','senior','admin')` (файлын түвшний хамгаалалт `2-2`-д аль хэдийн байна).

```ts
/* ================================================================== */
/*  §69 БЭЛЭН БАЙДЛЫН ХААЛГА — ЗӨВХӨН НЭГТГЭСЭН                        */
/* ================================================================== */

/**
 * `GET /api/compliance/projects/:id/readiness`
 *
 * ⚠️ ХАРИУНД ХЭРЭГЛЭГЧИЙН ID, НЭР, ЭЛЕМЕНТИЙН ЭЗЭН ОГТ БАЙХГҮЙ.
 *    `routes/learning.ts:894`-ийн `/health`-ийн хэлбэрийг давтав.
 * ⚠️ `withEdgeCache` ХЭРЭГЛЭХГҮЙ: хариу нь дүрмийн багцын хувилбар,
 *    багийн бүртгэл ба олдворын төлөвөөс хамаардаг — гурвуулаа
 *    ажиллаж байхад өөрчлөгддөг тул `varyTags`-ыг бүрэн тоолох
 *    боломжгүй (`lib/edgeCache.ts:47` — автомат хэрэглэгчийн хамрах
 *    хүрээ БАЙХГҮЙ).
 */
compliance.get('/projects/:id/readiness', async (c) => {
  const projectId = Number(c.req.param('id'));
  if (!Number.isInteger(projectId) || projectId <= 0) return c.json({ error: 'bad_id' }, 400);

  /* 1. Ноцтой байдлаар нэгтгэсэн нээлттэй олдвор. */
  const sev = await c.env.DB.prepare(
    `SELECT severity, verdict, COUNT(*) AS n
       FROM compliance_findings
      WHERE project_id = ?1
        AND lifecycle_state IN ('OPEN','REOPENED')
        AND stale_at IS NULL
      GROUP BY severity, verdict`,
  ).bind(projectId).all<{ severity: string; verdict: string; n: number }>();

  /* 2. Багийн хамрах хүрээ — АМЬД бүртгэлээс, хатуу тоо БАЙХГҮЙ.
   *
   * ⚠️ ХОЁР шүүлт, хоёулаа ЗААВАЛ:
   *    (a) баг нь ЭНЭ ТӨСӨЛД оролцож байна  (`share_percent > 0`);
   *    (b) баг нь дүрмийн багцТАЙ           (нийтлэгдсэн `rules` мөр).
   *
   * (b)-гүйгээр MGMT · EZ · GT (ЭЗЭН БАТАЛСАН 2026-08-30: багц
   * АВАХГҮЙ — v2 §46) нь `share_percent > 0`-той бол `ran` нь ХЭЗЭЭ Ч
   * үнэн болохгүй тул хаалга МӨНХӨД улаан үлдэнэ.  Багцгүй код нь
   * `TEAM = UNCERTAIN` **БИШ** (`2-1` §3.4): илрүүлэлт амжилттай,
   * `team_code` нь бодит код, `learning_events` нь тэр кодоор
   * ШОШГОЛСОН хэвээр (§72) — зөвхөн нийцлийн шалгалт алгасагдана.
   * ӨӨР БАГИЙН дүрмээр ХЭЗЭЭ Ч шалгагдахгүй (v2 §48-R6).
   * Шалгалт нь ОРШИХУЙН — «найм» гэсэн тоо ХААНА Ч БАЙХГҮЙ.
   * `idx_rules_team_pub (team_code, status) WHERE status='published'`
   * нь энэ `EXISTS`-ыг индексээр хангана (`2-2` §3.1).
   */
  const teams = await c.env.DB.prepare(
    `SELECT t.code AS team_code,
            EXISTS (SELECT 1
                      FROM rule_run_ledger l
                      JOIN rules r ON r.rule_uid = l.rule_uid
                     WHERE l.project_id = ?1
                       AND r.team_code = t.code
                       AND l.evaluated > 0) AS ran
       FROM project_team_shares pts
       JOIN teams t ON t.id = pts.team_id
      WHERE pts.project_id = ?1
        AND pts.share_percent > 0
        AND EXISTS (SELECT 1
                      FROM rules r2
                     WHERE r2.team_code = t.code
                       AND r2.status = 'published')
      ORDER BY pts.sort_order, t.sort_order`,
  ).bind(projectId).all<{ team_code: string; ran: number }>();

  /* 3. Бүртгэлийн эрүүл мэнд — §69-ийн НОГООН-ыг татгалзах нөхцөл. */
  const ledger = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM rule_run_ledger WHERE project_id = ?1)          AS rows_total,
       (SELECT COUNT(*) FROM rule_run_ledger l
          JOIN rules r ON r.rule_uid = l.rule_uid
         WHERE l.project_id = ?1 AND r.expect_applicable = 1 AND l.applicable = 0)
                                                                             AS expected_but_inapplicable,
       (SELECT COALESCE(SUM(aborted), 0) FROM rule_run_ledger WHERE project_id = ?1)
                                                                             AS aborted,
       (SELECT COUNT(*) FROM bim_sessions s
         WHERE s.project_id = ?1
           AND s.pack_sha256 IS NOT NULL
           AND s.pack_sha256 NOT IN (SELECT pack_sha256 FROM rule_pack_versions))
                                                                             AS unpublished_pack_sessions`,
  ).bind(projectId).first<Record<string, number>>();

  /* 4. §59 — уншлагаар гаргасан цоорхойнууд (§3.2-ын №5, 7, 10). */
  const gaps = await deriveCompletenessGaps(c.env.DB, projectId);

  const result = computeReadiness({
    open_by_severity: foldSeverity(sev.results),
    uncertain_open: foldUncertain(sev.results),
    completeness: gaps.map((g) => ({
      check: g.check,
      state: g.state,
      countable: COMPLETENESS_SPEC[g.check].source !== 'unavailable',
    })),
    team_checks: (teams.results ?? []).map((r) => ({ team_code: r.team_code, ran: r.ran === 1 })),
    ledger: {
      expected_but_inapplicable: ledger?.expected_but_inapplicable ?? 0,
      aborted: ledger?.aborted ?? 0,
      empty: (ledger?.rows_total ?? 0) === 0,
      unpublished_pack_sessions: ledger?.unpublished_pack_sessions ?? 0,
    },
  });

  return c.json({
    project_id: projectId,
    ...result,
    gaps,                            // §59 — «цоорхойг харах» (эзний R2)
    checked_label: checkedLabel(rulesetVersion, ruleCount),
    disclaimer_key: 'readiness.disclaimer',   // §69-R3 — UI-д ЗААВАЛ гарна
    as_of: new Date().toISOString(),
  });
});
```

Үлдсэн хоёр:

| Route | Юу буцаана | Хамгаалалт |
|---|---|---|
| `GET /api/compliance/projects/:id/gaps` | §59-ийн 10 шалгуур тус бүрийн `{check, state, source, issue_class, severity, detail}` — детал нь ТООЛУУР (жишээ нь «21-ээс 14 хуудас»), нэр БИШ | Дээрхтэй ижил |
| `GET /api/compliance/quality?days=30&team=<code>` | §66-ийн бүх хэмжүүр, `severity` × `issue_class`-ээр бүлэглэсэн. `?nominate=1` бол маргаантай `rule_uid`-ийн нэр дэвшүүлэлт (ЗӨВХӨН ХЭВЛЭНЭ) | `requireManager()` — тоо нь багийн түвшинд, хүний түвшинд БИШ |

⚠️ **`/quality` нь `requireManager()` боловч мөр бүр нь `rule_uid` эсвэл `team_code`-оор бүлэглэгдсэн.** Ахлагч «энэ дүрэм 40% худал дохио өгч байна» гэдгийг харна — «энэ инженер 40% алдаа гаргаж байна» гэдгийг ХЭЗЭЭ Ч биш.

### 3.7 Frontend — `ReadinessPanel.tsx` (ШИНЭ) + шинэ таб

**Шинэ файл:** `frontend/src/features/projects/readiness/ReadinessPanel.tsx`

Гурван хэсэг, тус бүр нь `id="sec-…"` + `scroll-mt-24` (`sections.ts:26`-ийн хоёр алхамт дүрэм):

| DOM id | Гарчиг | Агуулга |
|---|---|---|
| `sec-project-readiness` | «Хянахад бэлэн байдал» | §69-ийн зургаан тоолуур + төлөв + `checked_label` + `disclaimer` |
| `sec-project-gaps` | «Цоорхой» | §59-ийн 10 шалгуур; `unavailable` нь саарал, «одоогоор хэмжигдэхгүй» гэсэн тайлбартай |
| `sec-project-quality` | «Дүрмийн чанар» | §66 — зөвхөн `isManager` бол харагдана |

`ProjectTabs.tsx`-д НЭГ таб нэмнэ (`overview / info / deadlines / mail / report / charts / asr` -ийн дараа):

```tsx
<TabsTrigger value="readiness" className="h-auto flex-none gap-2 py-1.5">
  <ShieldCheck className="hidden size-4 sm:block" />
  {t('readiness.tab')}
</TabsTrigger>
```

⚠️ **Табын утга нь `useTabParam`-аар л явна** (`ProjectTabs` нь `value`/`onValueChange`-ыг эцгээсээ авдаг ба тэр нь URL-тэй холбогдсон). `useState` руу буулгавал глобал хайлтын мөр эвдэрнэ.

`sections.ts`-д ГУРВАН мөр:

```ts
{
  page: '/app/projects',
  to: '/app/projects?section=sec-project-readiness',
  labelKey: 'readiness.title',
  keywords: 'бэлэн байдал хянахад бэлэн readiness review gate хаалга belen',
},
{
  page: '/app/projects',
  to: '/app/projects?section=sec-project-gaps',
  labelKey: 'readiness.gaps.title',
  keywords: 'цоорхой дутуу бүрэн бус gap completeness missing tsoorhoi',
},
{
  page: '/app/projects',
  to: '/app/projects?section=sec-project-quality',
  labelKey: 'readiness.quality.title',
  keywords: 'дүрмийн чанар худал дохио false positive fp fn quality durmiin chanar',
  roles: ['admin', 'senior'],
},
```

**i18n түлхүүрүүд — `mn.json` БА `en.json` ХОЁУЛАНД (одоогоор зөрөх БАЙХГҮЙ, тэгээд ч байлгахгүй):**

| Түлхүүр | mn | en |
|---|---|---|
| `readiness.tab` | Бэлэн байдал | Readiness |
| `readiness.title` | Төслийн хяналтын бэлэн байдал | Project review readiness |
| `readiness.status.READY` | Хянахад бэлэн | Ready for review |
| `readiness.status.NOT_READY` | ⚠️ Бэлэн биш | ⚠️ Not ready |
| `readiness.status.UNKNOWN` | Тодорхойгүй — шалгалт бүрэн ажиллаагүй | Unknown — checks did not complete |
| `readiness.critical` | Ноцтой зөрчил | Critical violations |
| `readiness.high` | Өндөр зөрчил | High violations |
| `readiness.medium` | Дунд зөрчил | Medium violations |
| `readiness.uncertain` | Тодорхойгүй олдвор | Uncertain findings |
| `readiness.completeness` | Загварын бүрэн байдал | Model completeness |
| `readiness.teamChecks` | Багийн шалгалт | Team checks |
| `readiness.disclaimer` | Энэ нь инженерийн урьдчилсан хяналт — хууль зүйн гэрчилгээ БИШ. | This is an engineering pre-review gate — never a legal certification. |
| `readiness.blocker.ledgerEmpty` | Дүрмийн гүйлтийн бүртгэл хоосон | No rule-run ledger rows |
| `readiness.blocker.expectedInapplicable` | Ажиллах ёстой {n} дүрэм хамаарахгүй болов | {n} rules expected to apply did not |
| `readiness.blocker.aborted` | {n} дүрэм тасалдав | {n} rules aborted |
| `readiness.blocker.unpublishedPack` | {n} сесс нийтлэгдээгүй дүрмийн багцаар ажиллав | {n} sessions ran an unpublished rule pack |
| `readiness.gaps.unavailable` | Одоогоор хэмжигдэхгүй | Not measurable yet |
| `readiness.quality.proxy` | Ойролцоо үзүүлэлт — албан ёсны хэмжилт биш | Proxy metric — not the authoritative measurement |

### 3.8 `backend/src/lib/readiness.test.ts` (ШИНЭ) — 14 тест

`readiness.ts` нь харьцангуй импортгүй ЦЭВЭР модуль тул `registerHooks` ШААРДЛАГАГҮЙ — гэхдээ `complianceModel.ts`-ээс төрөл татвал шаардлагатай болно. Аюулгүй тал нь `leaveWindow.test.ts:15-21`-ийн hook-ыг ХУУЛЖ тавих.

| # | Тест | Хүлээгдэх |
|---|---|---|
| 1 | Бүртгэл хоосон | `status === 'UNKNOWN'`, `NOT_READY` БИШ |
| 2 | `expect_applicable` дүрэм `applicable = 0` | `UNKNOWN` |
| 3 | `aborted > 0` | `UNKNOWN` |
| 4 | Нийтлэгдээгүй `pack_sha256` | `UNKNOWN` |
| 5 | CRITICAL = 1, бусад бүх зүйл төгс | `NOT_READY`, blocker `readiness.blocker.critical` |
| 6 | HIGH = 1 | `NOT_READY` |
| 7 | UNCERTAIN = 1 | `NOT_READY` |
| 8 | `team_checks` 6/7 | `NOT_READY`, blocker count = 1 |
| 9 | Бүх зүйл цэвэр | `READY` |
| 10 | `countable = false` шалгуур хуваарьт ОРОХГҮЙ | 8 countable, 1 unavailable → `total === 8` |
| 11 | Бүх шалгуур `unknown` | `pct === 0`, `total > 0` |
| 12 | `packRegressed` — CRITICAL 0.98 → 0.97 | `regressed === true` (тэвчээр ТЭГ) |
| 13 | `packRegressed` — MEDIUM 0.90 → 0.87 | `regressed === false` (0.05 дотор) |
| 14 | **`checkedLabel` ба `coverageLabel` нь `FORBIDDEN_GATE_WORDS`-ийн НЭГ Ч үг агуулахгүй** | assert |

```ts
test('§69-R3: хаалганы шошго гэрчилгээний хэл ХЭРЭГЛЭХГҮЙ', () => {
  const labels = [checkedLabel('2026-09-01.1', 14), coverageLabel(12, 9)];
  for (const label of labels) {
    for (const word of FORBIDDEN_GATE_WORDS) {
      assert.ok(!label.toLowerCase().includes(word.toLowerCase()),
        `«${word}» нь «${label}» дотор гарч БОЛОХГҮЙ`);
    }
  }
});
```

### 3.9 Ажиллуулсан жишээ — BA ба IZ

**BA (Барилга архитектур) — илэрсэн цоорхой:**

```
Төсөл: Хүннү сити, В блок · Баг: BA · Дүрмийн багц 2026-09-01.1

⚠️ БЭЛЭН БИШ
  Ноцтой зөрчил:      1   BA-HR-CORRIDOR-W-001 · Өрөө 3-104
                          issue_class = REGULATORY_VIOLATION · severity = HIGH
                          Эзэмшигч баг: BA · Нөлөөлсөн: —
  Тодорхойгүй:        2   BA-HR-CORRIDOR-W-001 · Өрөө 3-118, 3-119
                          Шалтгаан: доод хилийн байрлал «Wall Centre» —
                          цэвэр өргөнийг тооцох боломжгүй
  Цоорхой:
    • Төслийн ангилал ба өндөр — ТОДОРХОЙГҮЙ (CRITICAL)
      `building_complexity_class` хоосон тул ӨНДӨР БАРИЛГЫН
      дүрмийн багц ОГТ АЖИЛЛАХГҮЙ.  Энэ нь чимээгүй байх ЁСГҮЙ.
    • Зургийн жагсаалт — 21-ээс 14 (MEDIUM, эх сурвалж: manual)
      Дутуу: 11 Шилэн ханын нэгдсэн түүвэр · 17 Цахилгаан шат ·
             19 Галын шатны хэсэглэл
  Багийн шалгалт: 6/7 — HAS ажиллаагүй
```

**IZ (Интерьер зураг) — салбар хоорондын олдвор (§60):**

```
Төсөл: Хүннү сити, В блок · Баг: IZ

Надад хамаатай олдвор (2):
  1. IZ-HR-CEIL-H-001 · Тааз 2 180 мм (шаардлага ≥ 2 200 мм)
     Эзэмшигч: IZ · Хариуцах: IZ · Хамаарал: —
  2. HAS-DUCT-DROP-004 · Агаарын суваг доод тал 2 100 мм
     Эзэмшигч: HAS · Нөлөөлсөн: IZ, BA · Хариуцах: HAS
     Хамаарал: энэ нь (1)-ийн ҮНДСЭН ШАЛТГААН (`finding_edges.kind = 'causes'`)
     ⚠️ Энэ мөр IZ-ийн дүрмийн багцаас ГАРААГҮЙ — сервер нь HAS-ийн
        дүгнэлтийн урсгалаас илрүүлж, `finding_teams`-ээр IZ-д хүргэв.

  Цоорхой:
    • Зургийн жагсаалт — 16-аас 9 (MEDIUM)
      Дутуу: 7 Таазны байгуулалт · 9 Гэрлийн байгуулалт · 16 Тоо хэмжээ
      ⚠️ 7 дутуу байхад таазны өндрийн дүрэм нь ХЭСЭГЧИЛСЭН нотолгоотой.
```

⚠️ Хоёр жишээнд ч **нэг ч хүний нэр байхгүй**. «Хэн энэ ханыг зурсан бэ» гэсэн асуулт нь энэ дэлгэцийн ХАРИУЛАХ асуулт БИШ.

---

## 4. ХӨНДӨЖ БОЛОХГҮЙ (load-bearing)

| Юу | Хаана (баталгаажсан) | Яагаад эвдрэх вэ |
|---|---|---|
| Хувийн нууцын үл хөдлөх дүрэм | `0201:23-32`, `0203:25-31`, `0205:42-46`, `learning.ts:67-71` | Дөрвөн migration толгойд ЗОРИУД давтагдсан бөгөөд `revitNoteAi.test.ts:262`-оор түгжсэн. Нэг хүний нэрлэсэн тоог тайланд оруулах нь энэ дүрмийг зөрчинө — буцаах боломжгүй (хэвлэсэн тайлан, алдагдсан итгэл). |
| **HR / хөдөлмөрийн хил (v2 §34)** | `ChangeTracker.cs:90-100` | «Нэг ханыг 20 удаа хөндсөн нь муу ажилтан гэсэн үг биш» гэдэг нь 2026-08-26-ны бичигдсэн шийдвэр. Энэ систем нь **ажилтны хяналтын хэрэгсэл БИШ**. «Хамгийн олон зөрчилтэй инженер», «багийн алдааны эрэмбэ», «хэн хамгийн олон удаа хүчингүй болгосон бэ» — гурвуулаа ХОРИОТОЙ. Хийвэл ажилчид add-in-ыг унтраана, тэр нь R7-ыг өөр замаар зөрчинө. |
| `GET /api/learning/health`-ийн нэгтгэсэн хэлбэр | `learning.ts:894-918` | Админд ч нийлбэр л өгдөг. Энэ сессийн route бүр яг тэр хэлбэрийг барина. `GROUP BY user_id` бичих нь дүрмийг зөрчинө. |
| `_scopeAll` анхдагч FALSE | `AssistantPane.xaml.cs:246-254` | Нэг `.rvt`-г олон салбар хуваалцдаг. Анхдагчаар бүх салбарын олдворыг харуулбал цахилгаанчин архитекторын ажлыг «засах» гэж оролдоно. Сонголтын анхдагч нь ҮРГЭЛЖ өөрийн баг. |
| `AccordionForm.isFilled`-ийн гурван төлөв | `AccordionForm.tsx:41-52` | `false` = «хэлээгүй», «үгүй» БИШ. Нэгтгэвэл шинэ загвар бүр 20 худал олдвор гаргана. |
| §69-R3 — гэрчилгээ БИШ | v2 `:2238` | «Баталгаажлаа», «зөвшөөрөгдсөн», «нийцсэн» гэсэн үг нь мэргэжлийн хариуцлагын мэдэгдэл болно. Дүрмүүд өөрсдөө `UNVERIFIED` (`2-2`) байхад тэр нь худал мэдэгдэл. |
| Багийн тоог хатууруулахгүй | `0007_teams.sql:38-47` (9 мөр), `0074` (+EZ, GT = 11), v2 **§46** (мөрөөр БИШ, ХЭСГЭЭР эшлэ) | Бүртгэл нь ажиллаж байхад админаар өөрчлөгддөг. Эзэн баталсан **найм** нь ТӨЛӨВЛӨЛТИЙН тоо (хэдэн багц бичих вэ), кодод ЛИТЕРАЛ БИШ — `Team checks: 8/8` гэж хатуу бичвэл **9 дэх** баг нэмэгдэхэд ЧИМЭЭГҮЙ буруу болно. Олонлог нь `teams.code`-оос АМЬДААР уншигдана, багцтай олонлог нь аргумент болж дамжина. |
| `finding_overrides`-ыг зөвхөн УНШИНА | `2-5`-ын 0237, append-only trigger | UPDATE нь `ABORT` өгнө. §66-ийн бүх тоо тэндээс `SELECT`-ээр гарна. |
| `nominate` нь БИЧИХГҮЙ | `eval/nominate.py:9-10` | Автоматаар тест болговол загвар өөрийн эргэлзээгээ өөрөө шалгуур болгож, гогцоо хаагдана. |
| `run_golden.py`-ийн хоосон-блок | `eval/run_golden.py:315-316, 352-356` | «Хэмжигдээгүй» ≠ «сайн». `UNKNOWN` төлөв нь энэ шийдвэрийн шууд өв. |
| `purpose:'mcp'` токен | `middleware/auth.ts:101-102` | Энэ сесс auth хөндөхгүй, гэхдээ шинэ route нь `/api/compliance` дор орсноор тэр дүрмийг өвлөнө. |
| `users` / `projects` дахин бүтээхгүй | 19 ба 33 cascade хүүхэд | Энэ сесс migration бичихгүй тул зөвхөн санамж. |

---

## 5. ДАРААЛАЛ БА ХАМААРАЛ

### Урьдчилсан нөхцөл

| # | Нөхцөл | Хэрхэн шалгах |
|---|---|---|
| 1 | `2-3` deploy хийгдсэн — `compliance_findings`, `finding_teams`, `finding_edges`, `rule_run_ledger` байна | `npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml --command "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'compliance%' OR name LIKE 'finding_%' OR name='rule_run_ledger'"` |
| 2 | `2-5` deploy хийгдсэн — `finding_overrides` байна | Ижил асуулга, `name='finding_overrides'` |
| 3 | `2-2` deploy хийгдсэн — `rules`, `rule_test_cases`, `rule_pack_versions` байна, `/api/compliance` mount хийгдсэн | `curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOK" https://<worker>/api/compliance/rules` → **401 биш, 200 эсвэл 403** |
| 4 | `backend/src/lib/complianceModel.ts` байна | `ls backend/src/lib/complianceModel.ts` |

Дөрвүүлээ хангагдаагүй бол **ЭХЛЭХГҮЙ** — эзэнд мэдэгд.

### Deploy дараалал

```
1. backend/  npx tsc --noEmit                      ← өөрийн файл цэвэр эсэх
2. backend/  npm test                              ← readiness.test.ts 14/14
3. backend/  npx wrangler deploy --config wrangler.toml
                                                   ← route гарна
4. frontend/ npm run verify                        ← tsc -b + check:notes + build
5. frontend/ npx -y wrangler@latest pages deploy dist \
               --project-name mgl-design-system --branch main
                                                   ← самбар гарна
6. Шалгах: dist/index.html-ийн hash == сайтын hash
```

**Migration БАЙХГҮЙ тул «шинэ багана нь түүнийг уншдаг кодоос ХАТУУ ӨМНӨХ deploy-д гарна» гэсэн дүрэм ЭНЭ СЕССЭД ХАМААРАХГҮЙ** — гэхдээ дээрх урьдчилсан нөхцөл 1–3 нь яг тэр дүрмийн ӨӨР ХЭЛБЭР: `2-3`/`2-5`/`2-2`-ын багана нь энэ сессийн кодоос ХАТУУ ӨМНӨ гарсан байх ёстой.

⚠️ **Frontend нь backend-ээс ХОЙШ.** Самбар нь эхлээд 404 авбал `ProjectTabs`-ийн шинэ таб хоосон карт харуулна — хэрэглэгч «эвдэрсэн» гэж уншина.

### ЗЭРЭГ ХИЙЖ БОЛОХ ажил (эзэн хурдыг хүссэн)

| Файл | Энэтэй ЗЭРЭГ бичиж болох уу | Яагаад |
|---|---|---|
| `2-1-team-context` | ✅ Тийм | Зөвхөн `team_code TEXT` гэрээг хуваалцана — хүснэгт огтлолцохгүй |
| `2-2-rule-model` | ✅ БИЧИХ нь тийм · ❌ ХЭРЭГЖҮҮЛЭХ нь үгүй | Энэ сесс `rules.severity`/`expect_applicable`-ыг УНШИНА — тэр багана эхлээд байх ёстой |
| `2-3-compliance-engine` | ✅ БИЧИХ нь тийм · ❌ ХЭРЭГЖҮҮЛЭХ нь үгүй | Хүснэгтүүд эхлээд |
| `2-4-nonblocking-runtime` | ✅ Тийм, бүрэн | C# ажил — энэ сесстэй ямар ч файл хуваалцахгүй |
| `2-5-finding-surface` | ✅ БИЧИХ нь тийм · ⚠️ ХЭРЭГЖҮҮЛЭХ нь `compliance.ts`, `complianceModel.ts`-ыг ХУВААЛЦАНА | **Тэр хоёр файлыг НЭГ АГЕНТ л нэг зэрэг засах ёстой.** Дараалуулах: `2-5` → `2-7`. |
| `2-6-team-training` | ✅ Тийм | Python + `assistant_*` — огтлолцохгүй |
| `2-8-install-and-health` | ✅ Тийм, бүрэн | `addin_releases` / `addin_installs` — огтлолцохгүй |

**Хэрэгжүүлэлтийн долгион (context pack-ийн дагуу):** долгион 1 = `2-1`, `2-2`, `2-4`, `2-8` · долгион 2 = `2-3`, `2-6` · долгион 3 = `2-5`, **`2-7`**. Энэ файл нь СҮҮЛД, `2-5`-ын ДАРАА.

### Дараа нь юу ирэх вэ

ЮУ Ч ҮГҮЙ. Энэ бол Track 2-ийн гарцын хаалга. Түүний §6-ийн шалгуур бүр хангагдвал Track 2 дууссан гэж тооцно.

---

## 6. ХҮЛЭЭН АВАХ ШАЛГУУР

### Backend

- [ ] `cd backend && npx tsc --noEmit` → өөрийн хөндсөн файлууд дээр алдаа **0**
- [ ] `cd backend && npm test` → `readiness.test.ts` **14/14 pass**, өмнөх багц регресс **0**
- [ ] `grep -c "user_id\|actor_user_id\|detected_by\|full_name" backend/src/lib/readiness.ts` → **0**
- [ ] `grep -rn "GROUP BY.*user_id" backend/src/routes/compliance.ts` → **тааралт БАЙХГҮЙ**
- [ ] `grep -rn "баталгаажлаа\|зөвшөөрөгдсөн\|нийцсэн\|certified" backend/src/lib/readiness.ts` → зөвхөн `FORBIDDEN_GATE_WORDS` тодорхойлолт дотор (**7 мөр**), өөр хаана ч байхгүй
- [ ] `GET /api/compliance/projects/1/readiness` (engineer токеноор) → **200**, хариунд `status`, `blockers[]`, `completeness_pct`, `team_checks_total`, `gaps[]`, `disclaimer_key` байна
- [ ] Тэр хариунд `"user_id"`, `"username"`, `"full_name"`, `"detected_by"` гэсэн мөр **ОГТ БАЙХГҮЙ** (`grep` -ээр шалгана)
- [ ] `rule_run_ledger` хоосон төсөл дээр → `status === "UNKNOWN"`, `"NOT_READY"` **БИШ**
- [ ] `team_checks_total` нь `SELECT COUNT(*) FROM project_team_shares pts JOIN teams t ON t.id = pts.team_id WHERE pts.project_id = 1 AND pts.share_percent > 0 AND EXISTS (SELECT 1 FROM rules r WHERE r.team_code = t.code AND r.status = 'published')` -тэй **ЯГ тэнцүү** (ЭЗЭН БАТАЛСАН 2026-08-30: багцгүй MGMT · EZ · GT нь хуваарьт ОРОХГҮЙ — v2 §46)
- [ ] MGMT-ыг `share_percent > 0`-тойгоор нэмээд дахин дуудахад `team_checks_total` нь **ӨӨРЧЛӨГДӨХГҮЙ** (багц авдаггүй баг хаалгыг мөнхөд улаан болгохгүй)
- [ ] `grep -c "7\b" backend/src/lib/readiness.ts` дотор багийн тоо болох литерал **БАЙХГҮЙ** (нүдээр шалгана)
- [ ] `GET /api/compliance/quality?days=30` (engineer токеноор) → **403**; (senior токеноор) → **200**
- [ ] `?nominate=1` нь `rule_test_cases` руу **ЮУ Ч БИЧИХГҮЙ**: дуудахын өмнө/дараа `SELECT COUNT(*) FROM rule_test_cases` ижил
- [ ] `node backend/scripts/check-bim-events.mjs` → **pass** (энэ сесс BIM хүснэгтэд хүрээгүйг батална)

### Frontend

- [ ] `cd frontend && npm run verify` → **pass**
- [ ] Төслийн дэлгэц дээр «Бэлэн байдал» таб гарна; `?tab=readiness` шууд нээгдэнэ
- [ ] `/app/projects?section=sec-project-readiness` → тэр карт руу гүйлгэж, гэрэлтүүлнэ
- [ ] Хажуугийн хайлтад «бэлэн» гэж бичихэд гурван мөр гарна (engineer-т хоёр, senior-т гурав)
- [ ] `readiness.disclaimer` мөр нь картан дээр ХАРАГДАНА (tooltip дотор биш)
- [ ] Шинэ түлхүүр бүр `mn.json` БА `en.json` хоёуланд байна: `node -e "const a=require('./src/shared/i18n/mn.json'),b=require('./src/shared/i18n/en.json');const k=Object.keys(a).filter(x=>x.startsWith('readiness'));console.log(k.length, k.filter(x=>!(x in b)))"` → зөрүү **[]**
- [ ] Гараар: engineer эрхээр нэвтрээд «Дүрмийн чанар» хэсэг **ХАРАГДАХГҮЙ**
- [ ] Гараар: дэлгэц дээр ямар ч хүний нэр, аватар, «хэн» гэсэн багана **БАЙХГҮЙ**
- [ ] Гараар: `NOT_READY` төлөвт `blockers[]` бүр монголоор, тоотойгоо гарна

### Хамрах хүрээ

- [ ] `git status --short` нь §-ийн толгойд жагсаасан **ес хан файлыг** харуулна
- [ ] `ls backend/migrations | tail -5` нь **`0216_assistant_log_timing.sql`** хэвээр — энэ сесс дугаар аваагүй
- [ ] `npm run build` бусад агентын файл дээр унасан бол тэр алдаа **өөрийн файлд БАЙХГҮЙ** гэдгийг батлаад эзэнд мэдэгд

---

## 7. ШАЛГАХ КОМАНД

```bash
# --- 0. УРЬДЧИЛСАН НӨХЦӨЛ: хамаарах хүснэгтүүд байгаа эсэх ---
cd backend
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'compliance%' OR name LIKE 'finding_%' OR name IN ('rule_run_ledger','rules','rule_test_cases','rule_pack_versions')) ORDER BY name"
# Хүлээгдэх: compliance_findings, finding_edges, finding_elements, finding_overrides,
#            finding_teams, rule_pack_versions, rule_run_ledger, rule_test_cases, rules
# Аль нэг нь дутуу бол ЭХЛЭХГҮЙ.

# --- 1. MIGRATION АВААГҮЙ ГЭДГИЙГ БАТЛАХ ---
ls migrations | tail -5
# Хүлээгдэх: … 0216_assistant_log_timing.sql   (ШИНЭ дугаар БАЙХГҮЙ)

# --- 2. TYPECHECK + ТЕСТ ---
npx tsc --noEmit
npm test
# Хүлээгдэх: readiness.test.ts 14/14; өмнөх багц регрессгүй

# --- 3. ХУВИЙН НУУЦЫН ГРЕП — ХАМГИЙН ЧУХАЛ ШАЛГАЛТ ---
grep -n "user_id\|actor_user_id\|detected_by\|full_name\|username" src/lib/readiness.ts
# Хүлээгдэх: гаралт ХООСОН

grep -n "GROUP BY" src/routes/compliance.ts
# Хүлээгдэх: severity / issue_class / team_code / rule_uid / verdict л байна.
#            user_id, actor_user_id ГАРВАЛ deploy ХИЙХГҮЙ.

# --- 4. ГЭРЧИЛГЭЭНИЙ ХЭЛ ---
grep -n "баталгаажлаа\|баталгаажсан\|зөвшөөрөгдсөн\|нийцсэн\|certified\|approved\|compliant" \
  src/lib/readiness.ts ../frontend/src/features/projects/readiness/ReadinessPanel.tsx
# Хүлээгдэх: ЗӨВХӨН FORBIDDEN_GATE_WORDS-ийн 7 мөр.  UI бичвэрт ГАРВАЛ засна.

# --- 5. БАГИЙН ТОО ХАТУУ БИЧИГДЭЭГҮЙ ЭСЭХ ---
grep -n "= 7\|=== 7\|/ 7\|'7'\|\"7\"" src/lib/readiness.ts src/routes/compliance.ts
# Хүлээгдэх: гаралт ХООСОН

# --- 6. BIM ХҮСНЭГТЭД ХҮРЭЭГҮЙ ЭСЭХ ---
node scripts/check-bim-events.mjs
# Хүлээгдэх: pass

# --- 7. DEPLOY (энэ дарааллаар) ---
npx wrangler deploy --config wrangler.toml

# --- 8. АМЬД ШАЛГАЛТ ---
# ӨМНӨ: /api/compliance/projects/1/readiness → 404
# ДАРАА:
curl -s -H "Authorization: Bearer $TOK_ENGINEER" \
  "https://mgl-progress-api.<acct>.workers.dev/api/compliance/projects/1/readiness" | tee /tmp/r.json
# Хүлээгдэх: 200, status ∈ {READY,NOT_READY,UNKNOWN}
grep -o '"user_id"\|"username"\|"full_name"\|"detected_by"' /tmp/r.json
# Хүлээгдэх: гаралт ХООСОН

curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOK_ENGINEER" \
  "https://mgl-progress-api.<acct>.workers.dev/api/compliance/quality?days=30"
# Хүлээгдэх: 403
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOK_SENIOR" \
  "https://mgl-progress-api.<acct>.workers.dev/api/compliance/quality?days=30"
# Хүлээгдэх: 200

# --- 9. NOMINATE НЬ БИЧИХГҮЙ ГЭДГИЙГ БАТЛАХ ---
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT COUNT(*) AS n FROM rule_test_cases"
curl -s -H "Authorization: Bearer $TOK_SENIOR" \
  "https://mgl-progress-api.<acct>.workers.dev/api/compliance/quality?days=30&nominate=1" > /dev/null
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT COUNT(*) AS n FROM rule_test_cases"
# Хүлээгдэх: хоёр тоо ЯГ ИЖИЛ

# --- 10. FRONTEND ---
cd ../frontend
npm run verify
npx -y wrangler@latest pages deploy dist --project-name mgl-design-system --branch main
npx -y wrangler@latest pages deployment list --project-name mgl-design-system | head -3
# Хүлээгдэх: дээд мөр нь ЭНЭ commit.  Success мессежид БҮҮ итгэ — hash тулга:
grep -o 'index-[A-Za-z0-9]*\.js' dist/index.html
curl -s https://mgl-design-system.pages.dev/ | grep -o 'index-[A-Za-z0-9]*\.js'
# Хүлээгдэх: хоёр hash ИЖИЛ

# --- 11. ХАМРАХ ХҮРЭЭНИЙ ХЯНАЛТ ---
cd ..
git status --short
git diff --stat
# Зөвшөөрөгдсөн зам ЗӨВХӨН:
#   backend/src/lib/readiness.ts
#   backend/src/lib/readiness.test.ts
#   backend/src/lib/complianceModel.ts
#   backend/src/routes/compliance.ts
#   frontend/src/features/projects/readiness/ReadinessPanel.tsx
#   frontend/src/features/projects/detail/ProjectTabs.tsx
#   frontend/src/shared/lib/search/sections.ts
#   frontend/src/shared/i18n/mn.json
#   frontend/src/shared/i18n/en.json
#   docs/bim-ai/2-7-readiness-and-quality.md
# git add -A БҮҮ хэрэглэ — файл бүрийг нэрээр нь нэм.
```

**Гар туршилт (автоматжуулах боломжгүй):**

1. Admin эрхээр төсөл нээж «Бэлэн байдал» таб → зургаан тоолуур, төлөв, `checked_label`, disclaimer бүгд харагдана.
2. Engineer эрхээр ижил таб → «Дүрмийн чанар» хэсэг ХАРАГДАХГҮЙ, бусад нь харагдана.
3. `rule_run_ledger`-т мөргүй төсөл нээх → «Тодорхойгүй — шалгалт бүрэн ажиллаагүй», НОГООН БИШ.
4. `share_percent > 0` бүхий баг нэмээд дахин ачаалах → `Team checks`-ийн хуваарь 1-ээр НЭМЭГДЭНЭ (хатуу тоо байхгүйг батална).
5. Дэлгэцийг эхнээс нь эцэс хүртэл уншиж, **хүний нэр байхгүйг** нүдээр батал.

---

## 8. ROLLBACK

| Юу | Хэрхэн буцаах |
|---|---|
| Backend route | Хоёр GET-ыг `compliance.ts`-ээс хас, `readiness.ts` + `readiness.test.ts` устга, `complianceModel.ts`-ээс §59 блокыг хас → `npx wrangler deploy --config wrangler.toml` |
| Frontend самбар | Табыг `ProjectTabs.tsx`-ээс хас, `ReadinessPanel.tsx` устга, `sections.ts`-ийн гурван мөрийг хас → `npm run build && pages deploy` |
| i18n түлхүүр | Үлдээж болно — ашиглагдаагүй түлхүүр хор хөнөөлгүй. Хасах бол `mn.json` БА `en.json` ХОЁУЛАНГААС |

**Migration ШААРДЛАГАГҮЙ — тиймээс дугаарын үр дагавар БАЙХГҮЙ.** Энэ сесс `d1_migrations`-д хүрээгүй; буцаахад schema-д ул мөр үлдэхгүй.

**Өгөгдлийн эрсдэл: ТЭГ.** Энэ сессийн код нь `INSERT`, `UPDATE`, `DELETE` мэдэгдэл ОГТ агуулаагүй — зөвхөн `SELECT`. `?nominate=1` ч бичихгүй (§6-д тестээр батлагдана).

**Кэшийн үлдэгдэл:** `withEdgeCache` ХЭРЭГЛЭГДЭЭГҮЙ тул Cloudflare edge дээр цэвэрлэх зүйл байхгүй. Frontend нь TanStack Query-ийн ердийн кэштэй — хэрэглэгч дахин ачаалахад арилна.

**Rollback-ийн шалгуур.** Дараах шинж тэмдгийн АЛЬ НЭГ гарвал шууд буцаа:

* Хариунд хэрэглэгчийн id, нэр эсвэл `detected_by` гарсан (үл хөдлөх дүрэм зөрчигдсөн — **яаралтай**);
* UI-д «баталгаажлаа» / «зөвшөөрөгдсөн» / «нийцсэн» гэсэн үг гарсан (§69-R3 зөрчигдсөн — **яаралтай**);
* `Team checks`-ийн хуваарь нь `project_team_shares` ∩ багцТАЙ багтай таарахгүй байна (хатуу тоо орсон, эсвэл багцын `EXISTS` шүүлт унасан);
* Хөдөлгүүр ажиллаагүй төсөл НОГООН харагдсан (`UNKNOWN` салаа ажиллахгүй байна — инженер шалгагдаагүй загварыг хяналтад өгнө);
* `readiness` route нь `/api/compliance`-ийн бусад route-ыг удаашруулсан (D1 мөр уншилтын хязгаар).

---

## 9. ЭХЛЭХИЙН ӨМНӨ ТОДРУУЛАХ

Эдгээрийг репогоос ХАРИУЛАХ БОЛОМЖГҮЙ — эзэн эсвэл продакшны асуулга шаардана.

### 9.1 Техникийн — прод/алсын D1 дээр л шалгагдана

| # | Асуулт | Яагаад чухал | Хэрхэн олох |
|---|---|---|---|
| 1 | ~~**АМЬД БАГИЙН БҮРТГЭЛ ЯМАР ВЭ?**~~ **✅ ХААГДСАН — ЭЗЭН БАТАЛСАН 2026-08-30: багц авах салбар НАЙМ** (BA · BB · HAS · TSBU · TSAH · HD · AU · IZ, v2 §46); диск дээр `teams` нь 11 мөр (9 × 0007 + 2 × 0074) хэвээр ба **MGMT · EZ · GT нь багцгүй**. ⚠️ Багийн ГИШҮҮНИЙ ТОО нь БАТАЛГААЖААГҮЙ хэвээр — продакшн D1 энэ машинаас БОЛОМЖГҮЙ (Cloudflare алдаа **7403 not authorized**) | `Team checks: n/n`-ийн хуваарь нь одоо `share_percent > 0` ∩ багцТАЙ баг (§3.6). Тоог хатууруулах нь ХОРИОТОЙ хэвээр — асуулга нь одоо продакшнд НЭМЭЛТ код үүссэн эсэхийг л шалгана | `npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml --command "SELECT code, name_mn, sort_order FROM teams ORDER BY sort_order"` |
| 2 | **`0212`–`0216` продакшн дээр ХЭРЭГЖСЭН үү?** Баталгаажаагүй | Хэрэв үгүй бол `2-3`/`2-5`-ын migration-ууд ч эргэлзээтэй, энэ сессийн бүх SQL унана | `--command "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 20"` |
| 3 | `2-2`/`2-3`/`2-5`-ын migration дугаарууд **ЗӨРЖ БАЙНА**. Context pack нь 0217–0245 нөөцөлсөн ч `2-2` нь дискэн дээр 0220–0223 гэж бичсэн | Энэ сесс дугаар авахгүй тул шууд эрсдэл БАЙХГҮЙ, гэхдээ хүснэгтийн НЭР баталгаажих ёстой (`rule_pack_versions` эсэх г.м.) | `2-2`, `2-3`, `2-5` файлуудын §3.0-ыг тулгах; хэрэгжүүлэхийн өмнө `sqlite_master`-аас баталгаажуулах |
| 4 | `rule_run_ledger` нь `project_id` баганатай юу, эсвэл зөвхөн `session_id`-аар `bim_sessions` руу холбогддог уу? | §3.6-ийн гурван SQL бүхэлдээ үүнээс хамаарна. Хэрэв `project_id` байхгүй бол JOIN нэмнэ | `2-3`-ын §3-ыг унших; хэрэгжсэн бол `PRAGMA table_info(rule_run_ledger)` |
| 5 | `bim_sessions.pack_sha256` нь бодит багана уу, эсвэл `session_meta_json`-ийн GENERATED VIRTUAL уу? | §3.6-ийн «нийтлэгдээгүй багц» асуулга. Context pack нь VIRTUAL гэж заасан (0232) — `2-4` баталгаажуулна | `PRAGMA table_info(bim_sessions)` |

### 9.2 Хэмжигдээгүй — хэн ч тоолоогүй

| # | Асуулт | Яагаад чухал |
|---|---|---|
| 6 | Нэг төсөлд хэдэн олдвор үүсэх вэ? ХЭН Ч ХЭМЖЭЭГҮЙ (1B-1 §9 нь 40–200 үйл явдал/инженер/өдөр гэдгийг ЗОРИУД ТААМАГ гэж тэмдэглэсэн) | `readiness` route нь `compliance_findings` дээр 3–4 нэгтгэсэн асуулга хийнэ. 10 мянган мөртэй төсөл дээр D1-ийн мөр уншилт хэдэн зуун мянга болж болно. Эхний хэмжилтийн дараа `withEdgeCache` (60 с) нэмэх эсэхийг шийднэ |
| 7 | `READY_MIN_COMPLETENESS_PCT = 95` зөв үү? | Бодит өгөгдөлгүйгээр ТААМАГ. Эхний сарын дараа хэдэн төсөл 95%-д хүрч байгааг харж тохируулна |
| 8 | `READY_MAX_UNCERTAIN = 0` нь хэт хатуу юу? | §65-ийн логикоор зөв, гэхдээ практикт бараг ямар ч төсөл НОГООН болохгүй байж болно. Эхний хэмжилтийн дараа эзэн шийднэ |

### 9.3 Эзний шийдвэр — инженерийн биш

| # | Асуулт | Юу өөрчлөгдөх |
|---|---|---|
| 9 | ~~**`Team checks` бүрэн байхыг ЗААВАЛ шаардах уу?**~~ **✅ ХААГДСАН — ЭЗЭН БАТАЛСАН 2026-08-30: ХОЁУЛАА.** `done < total` бол `NOT_READY` хэвээр, гэхдээ хуваарь нь `share_percent > 0` **БА** «дүрмийн багцтай баг» гэсэн ХОЁР шүүлтийн огтлолцол | §3.6-ийн SQL-д `EXISTS (… rules … status='published')` нэмэгдсэн. MGMT `share_percent > 0`-той байсан ч багцгүй тул хуваарьт ОРОХГҮЙ — хаалга мөнхөд улаан үлдэхгүй |
| 10 | ~~**MGMT, EZ, GT дүрмийн багц авах уу?**~~ **✅ ХААГДСАН — ЭЗЭН БАТАЛСАН 2026-08-30: ҮГҮЙ.** MGMT нь дизайны салбар БИШ; EZ · GT нь төсөл тохируулах блокийн угтаг (`0074_seed_ez_gt_teams.sql:12-14`) | `team_rule_scope`-д (`2-6` §3.3) мөр БАЙХГҮЙ, нийтлэгдсэн `rules` мөр БАЙХГҮЙ, ба `Team checks`-ийн хуваарь тэднийг ХАСНА (§3.6). ⚠️ Тэдний сесс нь `TEAM = UNCERTAIN` **БОЛОХГҮЙ**: `team_code` нь бодит кодоор шошголсон хэвээр, зөвхөн шалгалт алгасагдана (`2-1` §3.4). ⛔ ӨӨР БАГИЙН дүрмээр ХЭЗЭЭ Ч шалгагдахгүй (v2 §48-R6). 📝 Нэг үнэнч нюанс (хааж буй асуулт БИШ): эзэнд `0007_teams.sql`-ийн ЕС мөрийг үзүүлэхэд «MGMT-ийг хасаад үлдсэн 8» гэж хариулсан; `0074`-өөр дараа нэмэгдсэн **EZ ба GT-г нэрээр нь тусад нь асуугаагүй**. Тэд наймд бүтцээрээ ороогүй ба салбар БИШ, блокийн угтварын баг тул дүгнэлт хүчинтэй — гэхдээ ил асуугаагүйг тэмдэглэв. |
| 11 | **Олдворыг үүсгэсэн хүнээс ӨӨР хүн харж болох уу?** Үл хөдлөх дүрэм нь элемент түвшний үйл ажиллагаанд «үгүй» гэдэг; гэвч төслийг хянаж буй BA senior нь тэр төслийн олдворыг харах шаардлагатай байж магадгүй | Бидний анхдагч нь НЭГТГЭСЭН + багийн түвшин. Түүнээс илүү зүйл нь дөрвөн газарт бичигдсэн дүрмийг өөрчилнө — эзний бичгээр өгсөн шийдвэр шаардлагатай |
| 12 | **«Хянахад бэлэн» гэдгийг ХЭН тэмдэглэх вэ?** Одоогийн загварт систем нь ЗӨВХӨН тооцоолж харуулна, хүн товч дардаггүй | Хэрэв товч хэрэгтэй бол тэр нь §71-R2-ын таван зөвшөөрөгдсөн харилцан үйлдлийн «approval»-д багтана. Шинэ хүснэгт шаардана — өөр сесс |
| 13 | **Revit-ийн Warning жагсаалтыг унших уу?** §59-R2 №6 нь өнөөдөр БОЛОМЖГҮЙ (add-in `FailuresProcessing` / `GetWarnings`-ыг огт хэрэглэдэггүй) | Хэрэв тийм бол `2-4`-т C# ажил нэмэгдэж, НЭГ релизэд багтана. Үгүй бол шалгуур нь мөнхөд `unavailable` |
| 14 | **Багийн «батлагдсан family/type» жагсаалт хаана байх вэ?** §59-R2 №8 нь энэгүйгээр хэмжигдэхгүй. Репод ямар ч ийм жагсаалт БАЙХГҮЙ | `TEAM_STANDARD` ангилал нь эзний R3-ыг гаралт дээр ХАРАГДУУЛДАГ цорын ганц зүйл — хоосон байвал R3 нь дүрмийн сонголтоор л илэрхийлэгдэнэ, олдвороор биш |
| 15 | **§34-ийн засаглалын хил.** Энэ самбар нь БАГИЙН түвшний тоо харуулна. Ажилтны мэдэгдэл, гэрээнд «AI нь загварын чанарыг шалгана, ажилтныг үнэлэхгүй» гэсэн заалт орсон уу? | Commit `9fe82a0` нь «Ажилтны мэдэгдэл, гэрээ ЗААВАЛ шинэчлэгдэнэ» гэж бүртгэсэн бөгөөд `notice_version` нь ИРЭЭДҮЙН огноогоор тарьсан. Энэ нь deploy-ийн урьдчилсан нөхцөл, тансаг зүйл БИШ |

### Хавсралт — ТААМАГ гэж тэмдэглэсэн зүйлс

Дараах зүйлийг энэ сесс **БАТАЛГААЖУУЛААГҮЙ** бөгөөд §3-ын кодыг хэрэгжүүлэхээс өмнө тулгах ЁСТОЙ:

| Зүйл | Яагаад ТААМАГ |
|---|---|
| `compliance_findings`-ийн багануудын НЭР (`owner_team_code`, `lifecycle_state`, `stale_at`, `dedup_key`, `project_id`) | `2-3-compliance-engine.md` дискэн дээр БАЙХГҮЙ (2026-08-30). Context pack-ийн нэршлийг ашиглав |
| `finding_teams(finding_id, team_code, relation)` ба `finding_edges(from_finding_id, to_finding_id, kind)` | Ижил шалтгаан |
| `rule_run_ledger`-ийн бүх багана | Ижил шалтгаан |
| `rule_pack_versions.pack_sha256` | `2-2`-ын толгойд `0223_project_context_packs.sql` гэж бичсэн — багцын хувилбарын хүснэгтийн эцсийн нэр баталгаажаагүй |
| `project_build_context`-ийн байршил ба багана | `2-2`-ын 0223 гэж таамагласан |
| `2-6`-ийн `gen-rule-golden.mjs`-ийн нэр ба гаралтын зам | `2-6-team-training.md` дискэн дээр БАЙХГҮЙ |
| Продакшны багийн ГИШҮҮНИЙ ТОО | Cloudflare API 7403 — асуулга гүйцэтгэх боломжгүй. ⚠️ РОСТЕР нь ТААМАГ БИШ: ЭЗЭН БАТАЛСАН 2026-08-30, багц авах салбар НАЙМ (v2 §46) |
| `0212`–`0216`-ийн хэрэгжсэн байдал | Ижил шалтгаан |
