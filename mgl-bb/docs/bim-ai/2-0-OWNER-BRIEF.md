# 2-0-OWNER-BRIEF — эзний хүсэлт, R1–R7, хүлээн авах шалгуур, v2 §40–84-ийн мөрдөлт

> **Track:** 2 · REGULATORY COMPLIANCE LAYER (үндэслэлийн баримт — ажлын сесс БИШ)
> **Хамаарал (depends on):** байхгүй. Энэ бол Track 2-ийн ЭХНИЙ баримт бөгөөд зөвхөн `docs/bim-ai/REVIT_BIM_AI_Architecture_Freeze_v2.md`-ээс хамаарна.
> **Блоклож буй (blocks):** `2-1-team-context`, `2-2-rule-model`, `2-3-compliance-engine`, `2-4-nonblocking-runtime`, `2-5-finding-surface`, `2-6-team-training`, `2-7-readiness-and-quality`, `2-8-install-and-health` — эдгээрийн АЛЬ Ч нь энд бичигдсэн R1–R7-ийн тайлал болон §82-ийн хүлээн авах бүртгэлтэй ЗӨРЧИЛДӨЖ БОЛОХГҮЙ.
> **Хөндөх файлууд:** `docs/bim-ai/2-0-OWNER-BRIEF.md` (ШИНЭ). **ӨӨР ФАЙЛ БАЙХГҮЙ.**
> **Deploy тоо:** 0. Migration **БАЙХГҮЙ**. Worker deploy **ХИЙХГҮЙ**. Frontend deploy **ШААРДЛАГАГҮЙ**. Add-in (C#) **ШААРДЛАГАГҮЙ**.
> **v2 хэсэг:** §40, §41, §42, §43, §44, §45, §82, §83, §84 — нэмээд §46–§81-ийн бүрэн мөрдөлтийн индекс (§3.5).

---

## ЭЗНИЙ ШИЙДВЭР — 2026-08-31 (ХААГДСАН, дахин бүү маргалда)

Track 2-ийн хэрэгжүүлэлт эхлэхийн өмнө §9-ийн гурван нээлттэй хаалтыг эзэн шийдэв.

| # | Асуулт (өмнө нь §9-д НЭЭЛТТЭЙ) | **ШИЙДВЭР** | Үр дагавар |
|---|---|---|---|
| **Ш3** | `bim_sessions`-д `company_id` нэмэх үү? (нэг талын хаалга, 0217-г блоклож байв) | **НЭМНЭ** | `0217` нь `company_id`-г МӨН нэмнэ. Bind 32 → **33**, тиймээс `rowsPerStatement` = `floor(100/34)` = **2** (өмнө 3). ⚠️ Практик зардал БАГА: `bim_sessions` нь бага урсгалтай (жилд ~122k мөр). Өндөр урсгалтай `learning_events` (23 bind) нь ХӨНДӨГДӨХГҮЙ. |
| **Ш4** | БНбД / MNS баримтыг хэн авчрах вэ? (§9-3, R2/R5/R6-ийн критик зам, өмнө нь **эзэнгүй**) | **ЭЗЭН ӨӨРӨӨ НИЙЛҮҮЛНЭ** | ⛔ **Дүрмийн АГУУЛГА зохиохыг ХОЙШЛУУЛНА.** Дүрмийн ЗАГВАР (хүснэгт, `RuleEngine`, грамматик, `clampByVerification`) баригдана; BA/IZ-ийн 24 дүрэм ба ~120 тест кейс баримт ирэх хүртэл БИЧИГДЭХГҮЙ. Бүтцийн загвар болгож 2 жишээ дүрэм үлдэж болно. Баримт ирэхэд `rule_clauses` дүүргэх нь бүх дүрмийг **код өөрчлөхгүйгээр** ахиулна — ганц өгөгдлийн нийтлэл, add-in дахин тараахгүй. |
| **Ш5** | Хэр хол явах вэ? | **Track 2-ыг БҮТНЭЭР**, есөн сессээр | Долгион бүрийн дараа эзэнд тайлагнана. |

⚠️ **ЭНЭ МАШИН ДЭЭР СҮЛЖЭЭ БАЙХГҮЙ (хэмжсэн 2026-08-31):** `github.com` ба `cloudflare.com` хоёул
timeout. Тиймээс продакшн D1 руу хүрэхгүй, **deploy хийхгүй**, багц татахгүй. Энэ нь 2026-08-30-ны
«Cloudflare **7403** not authorized»-оос **ӨӨР** шалтгаан — эрхийн бус, **сүлжээний** асуудал.
Бүх ажил локал: код, миграц, тест, `tsc --noEmit`, `dotnet build`. Бүх §6/§7-ийн deploy-ийн
шалгуур нь **хойшлогдоно**, цуцлагдахгүй.

---

## 0. ЭНЭ СЕССИЙН ДҮРЭМ

**Хамрах хүрээ (scope).** Энэ файл нь **ажлын даалгавар БИШ**. Энэ бол Track 2-ийн бүх сессийг хэмжих **гэрээ**. Тиймээс §3-д код БАЙХГҮЙ — зөвхөн мөрдөлтийн матриц ба хүлээн авах бүртгэл. Бусад бүх зүйл (арван гарчиг, таван талбарын толгой, §2-ийн баталгаажуулалтын иш татлага, §7-ийн scope блок) байрандаа хэвээр.

**Хоёр уншигчтай.** (1) **Эзэн** — §1, §3.1, §3.2, §6, §9-ийг уншина. (2) **Хэрэгжүүлэгч агент** — бүхнийг уншина. Эзний уншдаг хэсгүүдэд `file:line` иш татлага бага, шийдвэр их байна.

**Бусад агентуудтай зэрэг ажиллаж байна.** Track 2-ийн 8 сессийн баримтыг ӨӨР агентууд зэрэг бичиж байна. Энэ файл нь тэдний хамтын эх сурвалж. Хэрэв ямар нэг сессийн баримт энд бичигдсэн R1–R7-ийн тайлал, §82-ийн бүртгэл, эсвэл §3.5-ын матрицтай зөрчилдвөл — **энэ файл давамгайлна**, тэр баримтыг засна.

**Deploy хийж болох уу?** Үгүй. Энэ файл нь `.md`. Migration байхгүй, worker deploy байхгүй, add-in build байхгүй.

**ЭНЭ СЕССИД ХЭЗЭЭ Ч ХИЙЖ БОЛОХГҮЙ:**

| Хориотой | Яагаад |
|---|---|
| Эзний үгийг «цэвэрлэх», орчуулах, товчлох | Латин галиг бичсэн монгол өгүүлбэрүүд (`Bi oilgomjgu helchlee`) нь ЭХ СУРВАЛЖ. Дахин бичсэн хувилбар нь хэдэн сарын дараа «эзэн үнэндээ юу хүссэн бэ» гэсэн маргааныг шийдэж чадахгүй |
| Багийн ТООГ (8, 11 — эсвэл хуучин «7») код, схем, CHECK-д ХАТУУ бичих | **ЭЗЭН БАТАЛСАН (2026-08-30): салбарын баг НАЙМ** — BA, BB, HAS, TSBU, TSAH, HD, AU, IZ (v2 §46, §9-1). Гэхдээ `teams` хүснэгт нь **АРВАН НЭГ** мөртэй хэвээр: `backend/migrations/0007_teams.sql:39-47` нь ЕСӨН мөр (тэр 8 + MGMT), `0074_seed_ez_gt_teams.sql:12-14` дээр нь EZ, GT нэмнэ. Найм гэдэг нь **ТӨЛӨВЛӨЛТИЙН** тоо (хэдэн дүрмийн багц зохиох вэ), эмхэтгэх литерал БИШ. Ростер өөрчлөгдөж БОЛНО — шинэ салбар нэмэгдэх, багууд нийлэх нь `teams`-д нэг INSERT, кодын өөрчлөлт БАЙХ ЁСГҮЙ. Тиймээс салбарын жагсаалтыг `teams.code`-оос ажиллах үед унших ба тоог хэзээ ч литералаар бичихгүй |
| `/api/*`-д `purpose === 'mcp'` токеныг ТАТГАЛЗАХ | Add-in бүх REST дуудлагаа тэр токеноор хийдэг, refresh урсгал БАЙХГҮЙ, ~20 PC дээр Install.bat-аар гараар суулгасан. Энэ бол алсаас засаж БОЛОХГҮЙ ЦОРЫН ГАНЦ өөрчлөлт. `backend/src/middleware/auth.ts:101-102` дээр «`purpose` шалгалт ЭНД БАЙХГҮЙ бөгөөд нэмэхийг ХОРИГЛОНО» гэж бичээстэй |
| `users` эсвэл `projects`-ийг `wrangler d1 migrations apply`-аар ДАХИН БАРИХ | `migrations apply` нь файл бүрийг гүйлгээнд ороодог бөгөөд тэнд каскад АЖИЛЛАДАГ. `users` 19, `projects` 33 каскад хүүхэдтэй — эцгийг нь устгавал бүх хүүхэд мөр арилна |
| Хэрэгжсэн migration файлыг засах | Продакшн дээр ЧИМЭЭГҮЙ NO-OP. Дугаар `ls backend/migrations \| tail -5` (2026-08-30-ны байдлаар хамгийн сүүлийнх нь `0216_assistant_log_timing.sql`, нийт 206 файл) |
| Trigger дотор `end;` жижиг үсгээр | wrangler-ийн задлагч регистрт мэдрэг. `END;` ТОМ үсгээр, өөрийн мөрөнд |
| Инференсийг `DocumentChanged`, tool bus handler, эсвэл итгэмжлэгдсэн замд тавих | `revit-mcp/addin/ChangeTracker.cs`-ийн `OnDocumentChanged` дотор баримт нь ЗӨВХӨН УНШИХ — гүйлгээ, `Regenerate()`, дискний бичилт, сүлжээ БАЙХГҮЙ. Түүнийг сольсон скайнер 120+ секунд авдаг байсан |
| Өөр агентын хийж буй ажлыг хөндөх | `git restore` / `git checkout --` / `git stash` / `git reset` / `git add -A` — АЛЬ Ч НЬ БОЛОХГҮЙ |

---

## 1. КОНТЕКСТ

### 1.1 Эзний хүсэлт — ҮГЧЛЭН (2026-08-30)

> continue implementing those things one by one with lot of sub agents under you and make it faster to implement
> and make my Revit AI addin ready for installing and really collect data with no mistake and can detect their workflow
> and see the gap and return the bug of the building to fix based on the ondor barilgiin norm durem.
> Also we have 7 teams. All rules are different in a 7 teams.
> So I need to train the datas on a each teams and they need to detect the member automatically and works on their data
> and make that project really works fine based on their team.
> Bi oilgomjgu helchlee.
> Hervee BA giin bag baival norm durem, rules ni zovhon BA deer suurilsan, barilga architecture uuded barilga barihad
> ymar asuudal bolon ymar aldaa baigaag AI ni automatically detect hiigeed helj ogdog baih heregtei baina.
> Ter ni Interior iin bag baival shuud Interior iin bagt ni ondor barilgiin norm d ymar ymar durem baidgiig ni helj ogood
> aldaag ni zasahad ni tusladag baih heregtei. Teriig ni Add in automataar detect hiigeed shuud norm durmiig ni realtime
> zasahad belen ajilladag bolgomoor baina.
> Hamgiin chuhal ni Add-in ogt humuusiin workflow, ajillah uil yvtsad noloolohgui bas ogt gatsalt baihgu manual aar ym
> hiih shaardlagaguigeer realtime ajilladag baimaar baina.
> Minii huseltiig biyluuleed hurdan ajilladag bolgohoo martvaa. Ternees omno MD file dotor minii huseltiig nemj oruulaad
> implement hiihed beltge

Мөн өдөр ирсэн дараагийн мессеж, ҮГЧЛЭН:

> this is new MD File that you need to use in the conversation. implement my request using this MD file.
> Everything included here

— заасан файл: `docs/bim-ai/REVIT_BIM_AI_Architecture_Freeze_v2.md` (2672 мөр).

**⚠️ Дээрх хоёр блокийг ХЭЗЭЭ Ч засахгүй, орчуулахгүй, товчлохгүй.** Латин галиг бичсэн монгол хэсгүүд («Bi oilgomjgu helchlee», «Hervee BA giin bag baival…», «Minii huseltiig biyluuleed hurdan ajilladag bolgohoo martvaa») нь эх сурвалж. Аль ч Track 2 баримт эзний санааг иш татахдаа ЭНЭ хэсгээс, дахин бичсэн хувилбараас БИШ иш татна.

### 1.2 Цэвэр монголоор — дахин томьёолол

Эзэн долоон зүйл хүсэж байна:

1. **Add-in суулгахад бэлэн болгоод**, ажилтнуудын PC дээр ажиллуулж, **алдаагүй өгөгдөл цуглуулах**.
2. Add-in нь хүний **ажлын урсгалыг таньж**, **дутууг олж харж**, барилгын алдааг **ӨНДӨР БАРИЛГЫН норм дүрмийн дагуу** зааж өгөх.
3. Компанид **найман салбарын баг** бий — эзэн 2026-08-30-нд «MGMT-ийг хасаад үлдсэн 8-н багийг оруулна» гэж **БАТАЛСАН** (`teams.sort_order`-оор: BA · BB · HAS · TSBU · TSAH · HD · AU · IZ). Эзний 1.1-ийн ҮГЧЛЭН бичвэрт «7 teams» гэж байгаа нь тэр өдрийн ярианд засагдсан; эх бичвэрийг ХЭВЭЭР үлдээв. **Баг бүрийн дүрэм ӨӨР** — дүрэм нь баг тус бүрд хамаарна, хэзээ ч нийтэд биш.
4. **Баг тус бүрийн өгөгдлөөр сургана.** Add-in нь тухайн үйлдэл хийж буй **гишүүнийг АВТОМАТААР таньж**, зөвхөн тэр багийн өгөгдөл дээр ажиллана. Гараар сонгох ЁСГҮЙ.
5. **BA (Барилга архитектур) баг бол** — норм дүрэм нь ЗӨВХӨН BA-д тулгуурлана; барилга архитектурын үүднээс ямар асуудал, ямар алдаа байгааг AI **өөрөө илрүүлж хэлж өгнө**. **ЭЗЭН БАТАЛСАН (2026-08-30): BA бол ЭХНИЙ бүрэн дүрмийн багц** бөгөөд нөгөө долоог түүний бүтцээр бичнэ (§3.5, §5.2).
6. **IZ (Интерьер) баг бол** — өндөр барилгын нормд интерьерт ямар дүрэм байдгийг **шууд хэлж өгөөд**, алдааг нь засахад **бодит цагт** тусална. **ЭЗЭН БАТАЛСАН (2026-08-30): IZ нь эзний дараалалд ХОЁРДУГААРТ** — гэвч IZ-д хураах түүх БАЙХГҮЙ (доорх R6 мөр), тиймээс энэ бол багцын хөтөлбөрийн гол хуваарийн эрсдэл.
7. **ХАМГИЙН ЧУХАЛ:** Add-in нь хүмүүсийн ажлын урсгалд **ОГТ нөлөөлөхгүй**, **ОГТ гацалт үүсгэхгүй**, **гараар юм хийх шаардлагагүй**, бодит цагт, хурдан ажиллана.

Мөн: «lot of sub agents under you» — Track 2-ийн 8 баримтыг **зэрэг** бичиж, хэрэгжүүлэлтийг **гурван давалгаагаар** зэрэгцүүлнэ (§5).

### 1.3 R1–R7 — тайлал ба хариуцагч баримт

| # | Хүсэлт (эзний үгээр) | Юу гэсэн үг вэ | v2 §§ | Track 2 баримт |
|---|---|---|---|---|
| **R1** | «make my Revit AI addin ready for installing and really collect data with no mistake» | Add-in нь ~20 PC дээр найдвартай суух, суусныхаа дараа өөрийгөө шалгах, хувилбараа мэдээлэх; BIM үйл явдлын бүртгэлд бодит өгөгдөл бичиж эхлэх (өнөөдөр бичигч БАЙХГҮЙ — §2.1) | §74, §71, §75, §40 | `2-8-install-and-health`, `2-4-nonblocking-runtime`, `2-1-team-context` |
| **R2** | «can detect their workflow and see the gap and return the bug of the building to fix based on the ondor barilgiin norm durem» | Гурван тусдаа чадвар: (a) ажлын урсгал таних = өөрчлөлтийн урсгалыг тасралтгүй бүртгэх; (b) дутуу таних = загварын бүрэн бус байдал нь ТУСДАА ангилал (`PROJECT_INCOMPLETENESS`), алдаа биш; (c) зөрчил мэдээлэх = БНбД эх сурвалж, тооцоо, элемент, засах зөвлөмжтэй | §51, §55, §59, §40, §45 | `2-3-compliance-engine`, `2-2-rule-model`, `2-7-readiness-and-quality` |
| **R3** | «we have 7 teams. All rules are different in a 7 teams» | **ЭЗЭН БАТАЛСАН (2026-08-30): НАЙМАН салбарын баг** — BA · BB · HAS · TSBU · TSAH · HD · AU · IZ («MGMT-ийг хасаад үлдсэн 8-н багийг оруулна»). Эзний үгэн дэх «7» нь тэр өдөр найм болж засагдав (v2 §46, §9-1 ХААГДСАН). Дүрэм нь **баг-хамаарлаар** хадгалагдана. Нэг сесс нь зөвхөн өөрийн багийн + компанийн нийтийн багцыг ачаална. «Нэг компани = нэг дүрмийн багц» гэсэн таамаг ХОРИОТОЙ (v2 §46). ⚠️ Найм нь **төлөвлөлтийн** тоо — багцгүй код (MGMT, EZ, GT) нь ЮУГААР Ч шалгагдахгүй, ГЭВЧ `TEAM = UNCERTAIN` **БОЛОХГҮЙ**: илрүүлэлт нь амжилттай, `team_code` нь бодит код хэвээр, зөвхөн шалгалт алгасагдана (`2-1-team-context` §3.4); тоо кодод хэзээ ч эмхэтгэгдэхгүй (§0-ийн хүснэгт) | §46, §47, §49, §50, §82-4 | `2-1-team-context`, `2-2-rule-model`, `2-6-team-training` |
| **R4** | «they need to detect the member automatically and works on their data» | Add-in нь баг зарлахгүй — **нотолгоо илгээнэ**, Worker шийднэ, хариуг add-in кэшлэнэ. Итгэлцүүр хүрэлцэхгүй бол `UNCERTAIN`, буруу багийн дүрэм ЧИМЭЭГҮЙ хэрэглэхгүй (§48-R6). Засвар нь БУЦААХ БОЛОМЖТОЙ (§73) | §48, §50, §72, §73 | `2-1-team-context`, `2-6-team-training` |
| **R5** | «Hervee BA giin bag baival … rules ni zovhon BA deer suurilsan … AI ni automatically detect hiigeed helj ogdog» | BA сесс нь `WHERE team_code = 'BA' OR team_code IS NULL` — IZ-ийн дүрмийг ХЭЗЭЭ Ч харахгүй. Илрүүлэлт нь автомат: хэрэглэгч «шалга» товч дарахгүй. **ЭЗЭН БАТАЛСАН (2026-08-30): BA бол ЭХНИЙ бүрэн багц** — бүтцийн загвар нь энэ бөгөөд нөгөө долоог түүгээр бичнэ. Шалтгаан нь хураах материал: `frontend/src/features/projects/team-reports/ba/` нь **12 «БНбД» дурдлага** (`types.ts` 7, `template.ts` 3, `BaDocument.tsx` 2), ялгаатай **найман БНбД код** (`21-01-02 / 21-02-02`, `21-05-10`, `23-01-09`, `25-01-20`, `31-01-…`, `31-01-10`, `35-01-22`) авч явдаг — аль ч салбарынхаас ИХ (BB 3 ялгаатай код, HAS 1, TSBU/CBU · TSAH · HD · AU · IZ бүгд ТЭГ). Хэмжсэн 2026-08-30 | §49, §61, §65, §53-R2 | `2-2-rule-model`, `2-3-compliance-engine` |
| **R6** | «Interior iin bag baival shuud … ondor barilgiin norm d ymar ymar durem baidgiig ni helj ogood aldaag ni zasahad ni tusladag» | IZ-д өндөр барилгын интерьер дүрмийн багц. **ЭЗЭН БАТАЛСАН (2026-08-30): IZ бол найман багийн НЭГ, БА эзний дараалалд ХОЁРДУГААРТ** (эхнийх нь BA — R5 мөр; §9-2 ХААГДСАН). ⚠️ IZ-д репо дотор нэг ч `norms_*` тэмдэглэгээ, нэг ч «БНбД» дурдлага БАЙХГҮЙ (нөгөө 7 салбарт `norms_*` нийт 57 бий: BB 13 · TSAH 9 · TSBU/CBU 8 · HAS 8 · HD 7 · BA 6 · AU 6), тиймээс IZ-ийн багцыг **норм каталогоос шинээр зохиох** ёстой, шаблоноос хураах боломжгүй — энэ бол багцын хөтөлбөрийн ГОЛ хуваарийн эрсдэл | §49, §61, §51, §65 | `2-2-rule-model`, `2-3-compliance-engine`, `2-5-finding-surface` |
| **R7** | «Hamgiin chuhal ni Add-in ogt humuusiin workflow … noloolohgui bas ogt gatsalt baihgu manual aar ym hiih shaardlagaguigeer realtime» | **ХАТУУ бүтээгдэхүүний шаардлага** (v2 §53:1822). Дөрвөн эгнээ: HOT / BACKGROUND / COLD / REMOTE. HOT эгнээ хэзээ ч инференс хүлээхгүй. COLD эгнээ нь «хийж чадвал хий» — өрсөлдөөн гарвал ЭНЭ мөчлөгийг ОРХИНО. Модал цонх байхгүй, автомат pane нээхгүй | §53, §54, §55, §76, §84 | `2-4-nonblocking-runtime`, `2-5-finding-surface` |

---

## 2. БАТАЛГААЖСАН ОДООГИЙН ЗАН ТӨЛӨВ

> Доорх `file:line` бүрийг энэ сесс өөрөө нээж баталгаажуулав (**2026-08-30**, commit `6a8e4f5`). Продакшны D1 руу хандах боломжгүй байсан (Cloudflare API error 7403 not authorized) тул **АМЬД өгөгдлийн тухай мэдэгдэл БАЙХГҮЙ** — 0201–0216 migration-ууд продакшн дээр ХЭРЭГЖСЭН эсэх нь **ТААМАГ**, §9-5.

Энэ хэсэг нь v2 §83-ын **арван дөрвөн суурь** тус бүрийг SHIPPED / PARTIAL / ABSENT гэж үнэн шударгаар үнэлнэ. Track 2 сесс бүр өөрийн §1-д энэ хүснэгтийн өөрт хамаарах мөрийг иш татна.

### 2.1 Суурь №1 — Canonical event model — **SHIPPED, ГЭВЧ ҮЙЛДВЭРЛЭГЧГҮЙ**

| Баримт | file:line | Бодит код / текст |
|---|---|---|
| Таван хүснэгт бүтээгдсэн | `backend/migrations/0201_bim_artifacts.sql` … `0205_learning_events.sql` | `bim_artifacts`, `bim_sessions`, `revit_transactions`, `revit_element_touches`, `learning_events` |
| Зөвхөн нэмэх (append-only) хамгаалалт | `backend/migrations/0206_bim_append_only.sql` | `grep -c "CREATE TRIGGER"` → **8** |
| Ганц бичигч модуль | `backend/src/lib/bimEvents.ts:144` | `export const DATASET_ELIGIBLE_SQL = 'parts_missing = 0';` |
| Дүрмийн шалгалт аль хэдийн үг сангийн нэг хэсэг | `backend/src/lib/bimEvents.ts:232` | `RULE_VALIDATION: ['RULE_VERDICT'],` |
| Хиймэл дагуулын бит тавигдах нөхцөл | `backend/src/lib/bimEvents.ts:741` | `if (has(input.payload, 'rule_id') && has(input.payload, 'passed')) present.add(part);` |
| Хүлээн авах endpoint | `backend/src/routes/learning.ts:279` | `learning.post('/events', async (c) => {` |
| Дүрмийн хувилбарын багана аль хэдийн бий | `backend/migrations/0205_learning_events.sql:154` · `0202_bim_sessions.sql:75` | `ruleset_version TEXT,` — **бичигч БАЙХГҮЙ** |

**⚠️ ГЭВЧ — ЭНЭ БОЛ БҮРЭН БАРИГДСАН, БҮРЭН ХООСОН ДЭВТЭР.** Хэмжсэн гаралт (2026-08-30):

```bash
grep -rn "api/learning" revit-mcp/addin/ | wc -l
grep -rn "session_uid" revit-mcp/addin/ --exclude-dir=Resources | wc -l
ls revit-mcp/addin/*.cs | wc -l
```

```
0
0
46
```

Add-in-ийн 46 `.cs` файлын нэг нь ч `/api/learning`-т хандахгүй, «session» гэдэг ойлголт нь ерөөс БАЙХГҮЙ. **R1-ийн «really collect data with no mistake»-ийг блоклож буй ЦОРЫН ГАНЦ зүйл нь энэ дутуу C# бичигч.** Сервер тал бэлэн — багц хязгаар, идемпотентчлал, `bim.events.logging` унтраалга бүгд байна.

### 2.2 Суурь №2 — Team-aware context — **ABSENT**

Хэмжсэн гаралт (2026-08-30):

```bash
grep -ci team backend/migrations/020*.sql backend/migrations/021*.sql
grep -rni "team" revit-mcp/addin/ --exclude-dir=Resources | wc -l
```

```
… бүх 17 файл дээр 0
0
```

BIM өгөгдлийн давхарга бүхэлдээ **салбар мэдэхгүй**. Add-in дээр ч, 0201–0216-ийн аль ч migration дээр ч `team` гэсэн үг БАЙХГҮЙ. Байгаа цорын ганц дэгээ:

| Баримт | file:line | Төлөв |
|---|---|---|
| Багийн хэмжээс өөр газар байгаа | `backend/migrations/0007_teams.sql:39-47` | 9 мөр суулгасан: BA, BB, HAS, TSBU, TSAH, HD, AU, IZ, MGMT |
| Дараа нь нэмэгдсэн | `backend/migrations/0074_seed_ez_gt_teams.sql:12-14` | EZ, GT → нийт **11** код |
| `revit_documents.team_code` зарлагдсан | `backend/migrations/0187_revit_documents.sql:30` | `team_code     TEXT,` — **уншигч ч, бичигч ч БАЙХГҮЙ** |
| Хуудас→баг руу очих холбоос аль хэдийн бий | `backend/src/routes/revit.ts:805-812` | `LEFT JOIN tasks → components → drawings → blocks b` — `b.team_id` нэмэх нь хоёр баганын өөрчлөлт |
| Салбарын хатуу жагсаалт (7, IZ-гүй) | `backend/src/lib/projectCategories.ts:35` | `const AZ_TEAMS = ['BA','BB','HAS','TSBU','TSAH','HD','AU'] as const;` — **баталсан ростероос ХОЦРОГДСОН** (IZ дутуу) |
| Салбарын хатуу жагсаалт (8, IZ-тэй) | `frontend/src/features/projects/team-reports/TeamReportsTab.tsx:52-61` | `IMPLEMENTED_TEAMS` — BA, BB, HAS, TSBU, TSAH, HD, AU, **IZ**. ✅ **Энэ нь эзний баталсан НАЙМТАЙ ЯГ таарна** |
| «Бүх 7 баг» гэсэн бичээс | `frontend/src/features/projects/team-reports/docHelpers.ts:4` | `Бүх 7 баг (BA, BB, HAS, TSBU/CBU, TSAH, HD, AU)` — **баталсан ростероос ХОЦРОГДСОН** (IZ дутуу) |

**✅ РОСТЕР ХААГДСАН — ЭЗЭН БАТАЛСАН (2026-08-30).** «MGMT-ийг хасаад үлдсэн 8-н багийг оруулна» — өөрөөр хэлбэл `teams.sort_order`-оор **BA · BB · HAS · TSBU · TSAH · HD · AU · IZ**. Дээрх хүснэгтийн гурван хатуу жагсаалт нь **репо өөртэйгээ зөрчилдөж байсныг** харуулсан баримт хэвээр үлдэнэ; тэдгээрийн аль нь ЗӨВ болох нь одоо шийдэгдэв — **шипсэн UI (`TeamReportsTab.tsx:52-61`) нь зөв, нөгөө хоёр нь хоцрогдсон**. Гурван үр дагавар:

1. **`teams` дэх 11 мөрийн 3 нь дүрмийн багц ХЭЗЭЭ Ч авахгүй:** `MGMT` (`0007:47`), `EZ` ба `GT` (`0074:12-14`). Тэдгээр нь `teams`-д байгаа шалтгаан нь блокийн угтвар / төслийн тохируулгад сонгогдох явдал, инженерийн салбар БИШ.
2. **Багцгүй код нь ЮУГААР Ч шалгагдахгүй** — өөр багийн дүрмээр ХЭЗЭЭ Ч биш (v2 §48-R6). Энэ бол §82-4-ийн (ТЭГ алдагдал) шууд үр дагавар. ⚠️ Гэхдээ энэ нь **`TEAM = UNCERTAIN` БИШ**: илрүүлэлт АМЖИЛТТАЙ болно — `team_code` нь бодит код (`MGMT`/`EZ`/`GT`), `team_source` нь шатны бодит эх сурвалж, `learning_events` нь тэр кодоор ШОШГОЛОГДОНО (§72), хэрэглэгчээс ЮУ Ч ШААРДАХГҮЙ. Зөвхөн нийцлийн шалгалт алгасагдана. Хоёр төлөвийн бүрэн харьцуулалт: `2-1-team-context` §3.4.
3. **`Team checks: n/n` хаалга (v2 §69) нь тухайн ТӨСӨЛ дээр байгаа, багцтай багуудыг л тоолно** — литерал 8-ыг ХЭЗЭЭ Ч биш. v2 §69-ийн жишээн дэх `7/7` нь зурган жишээ, шаардлага БИШ.

⚠️ **`projectCategories.ts:35` ба `docHelpers.ts:4`-ийг ЭНЭ Track засахгүй** — тэдгээр нь төслийн тохируулга ба багийн тайлангийн гадаргуу бөгөөд Track 2-ийн хамрах хүрээнээс ГАДНА (§0-ийн scope дүрэм). Зөвхөн энд баримтжуулав.

**v2 §39-ийн үе шатны жагсаалтад team-aware context-д зориулсан ҮЕ ШАТ ОГТ БАЙХГҮЙ.** Энэ бол хуучин төлөвлөгөө тооцоогүй ШИНЭ ажил, бөгөөд эзний R3/R4/R5/R6-ийн бүх жин үүн дээр байна.

**⚠️ ХОЁРДОГЧ ГИШҮҮНЧЛЭЛИЙН УРХИ — продакшны өгөгдлөөр батлагдсан.** `backend/src/routes/attendance.ts:1240-1247`:

```
attendance.ts:1244   // өгөгдөл дээр БА багийн бүх гишүүн IZ, EZ багт хоёрдогчоор
attendance.ts:1245   // бүртгэлтэй тул «IZ» гэж шүүхэд 42-ын оронд 242 мөр гарч,
attendance.ts:1246   // сениор БА-гийн хүмүүсийн өрийг хүлээж авах байсан.
```

Багийг АЛЬ Ч гишүүнчлэлээр таньвал BA-гийн архитекторт IZ-ийн дүрмийн багц очно — яг R5-ийн бүтэлгүйтэл. Тиймээс автомат таних нь **`is_primary = 1`** дээр л ажиллана.

### 2.3 Бусад арван хоёр суурь

| # | Суурь | Төлөв | Нотолгоо (`file:line`) |
|---|---|---|---|
| 3 | Regulatory document registry | **ABSENT** | `backend/migrations/0120_norm_catalog.sql:19-27` — `norm_items` нь `id, key, code, title, category_id, position, created_at` ЗӨВХӨН. Заалт, хуудас, хэвлэл, хүчин төгөлдөр огноо, PDF холбоос АЛГА. `:75` дээр `norm_bnbd_31_17_10` «Өндөр барилга, өндөр цогцолборын төлөвлөлт» ганц мөрөөр байна — салбарын хамаарал БАЙХГҮЙ |
| 4 | Versioned rule model | **ABSENT** | `ruleset_version` багана `0202:75` ба `0205:154` дээр бэлэн, `learning_events.rule_id` нь `0209:27` дээр GENERATED VIRTUAL, `0210:21` дээр индекслэгдсэн — **бүгд хоосон, бичигчгүй**. Дүрмийн хүснэгт репод БАЙХГҮЙ |
| 5 | Rule applicability engine | **ABSENT** | Өндөр барилгын босго нь зөвхөн UI-ийн зөвлөмжийн мөр: `frontend/.../project-sections/generalTemplate.ts:86` → `hint: 'Онцгой: 51м-ээс дээш эсвэл 16 давхраас дээш барилга.'` — тооцоолж болох талбар БИШ |
| 6 | Deterministic calculation engine | **ABSENT** | Тоонууд нь зөвхөн зохиомж: `revit-mcp/CLAUDE.md:7-11` өөрөө «**design-guidance values** … For a real permit set, verify each number against the current official БНбД / MNS document» гэж бичсэн |
| 7 | Incremental compliance engine | **PARTIAL (зөвхөн клиент тал)** | `revit-mcp/addin/ChangeTracker.cs:55` → `private const int FlushIntervalMs = 3000;`, `:313` → `_flushTimer = new Timer(_ => FlushDirty(), null, FlushIntervalMs, FlushIntervalMs);`. v2 §55-ын 1→2 шат бэлэн. 3–7 шат (өөрчлөлт→элемент→дүрэм→шалгалт→олдвор) БАЙХГҮЙ |
| 8 | Source/evidence model | **PARTIAL** | `backend/migrations/0212_assistant_log_provenance.sql:45-47` (`model_version`, `addin_version`, `client_ts`); `0215_assistant_trust_taxonomy.sql:50-61` (8 утгат `source_type` × 4 утгат `review_state`). **⚠️ САЛАЛТ:** `learning_events.provenance` нь ӨӨР, зургаан утгат үг сан (`backend/src/lib/bimEvents.ts:243-252`: `UNVERIFIED, MACHINE_GENERATED, RULE_VERIFIED, HUMAN_VERIFIED, HUMAN_CORRECTED, REJECTED`) бөгөөд хооронд нь хөрвүүлэх функц репод БАЙХГҮЙ. Олдворт зориулсан `evidence_level` тэнхлэг огт байхгүй |
| 9 | Finding lifecycle | **ABSENT** | Аль ч migration-д `compliance_findings`, `finding_*` хүснэгт байхгүй |
| 10 | Golden evaluation | **PARTIAL** | Харш бэлэн: `revit-mcp/eval/` (manifest, `run_golden.py`, `freeze.py`, `assert_no_leak.py`, 6 хуваарь). Гэвч `revit-mcp/eval/golden/rules.json` нь `"rows": []` бөгөөд өөрийнхөө `_note`-д «revit-mcp/CLAUDE.md:59-116-ийн тоонууд … golden болгож **ХӨЛДӨӨЖ БОЛОХГҮЙ**» гэж бичсэн. `run_golden.py:356` → `sys.exit(2)` — хоосон шаардлагатай хуваарь нь **ХАТУУ БЛОК**. `backend/migrations/0213_assistant_model_eval.sql:44` `eval_passed` багана бий |
| 11 | Team/company/project isolation | **PARTIAL** | Тенант/модулийн тусгаарлалт бий: `backend/src/lib/modules.ts:51,122,246` (`/api/learning` → модуль `learning`). **Багийн тусгаарлалт БАЙХГҮЙ:** `backend/src/middleware/auth.ts:138` → `export const requireManager = () => requireRole(...ADMIN_ROLES, 'senior');` — багийн гишүүнчлэлийн шалгалт ОГТ АЛГА |
| 12 | Performance instrumentation | **PARTIAL** | `backend/migrations/0216_assistant_log_timing.sql:57-59` `timing_json` + GENERATED хурдан скаляр — гэвч ЗӨВХӨН чатын зам. Add-in талын `Percentiles` / `Timing` нь `%APPDATA%\RevitMcpAddin\timing.log`-д л үлдэнэ, серверт хүрэхгүй |
| 13 | Degraded/offline mode | **PARTIAL** | Загварын гурван шатлалт fallback (татсан → embedded → түлхүүр үгийн давхарга) ба assistant log-ийн локал дараалал бий. **Дүрмийн багцын fallback БАЙХГҮЙ, BIM үйл явдлын локал дараалал БАЙХГҮЙ** |
| 14 | Safe deployment/versioning | **PARTIAL** | `0213:44` идэвхжүүлэлтийн хаалга, `BuildInfo.cs`, `package-addin.ps1`-ийн sha256 manifest бий. **SIGN БАЙХГҮЙ, TEST БАЙХГҮЙ (revit-mcp/addin-д C# тест ТЭГ), REPORT HEALTH БАЙХГҮЙ.** Хэмжсэн: `ls -d revit-mcp/dist` → `No such file or directory`, `ls -d revit-mcp/addin/bin` → `No such file or directory`. **Буцах цэг өнөөдөр БАЙХГҮЙ** |

**Дүн: 1 SHIPPED (үйлдвэрлэгчгүй) · 6 PARTIAL · 7 ABSENT.**

### 2.4 ҮНЭГҮЙ ОЛЗ — дүгнэлт бичихэд migration ч, үг сангийн засвар ч ШААРДЛАГАГҮЙ

Track 2-ийн хамгийн үнэтэй нээлт: **дүрмийн шалгалтын дүгнэлт бичих суваг АЛЬ ХЭДИЙН БҮРЭН БЭЛЭН.** Дөрвөн баримт үүнийг батална:

| Баримт | file:line | Бодит код |
|---|---|---|
| `RULE_VALIDATION` нь үг санд аль хэдийн бий | `backend/src/lib/bimEvents.ts:232` | `RULE_VALIDATION: ['RULE_VERDICT'],` |
| Бит нь `rule_id` + `passed` хосоор тавигдана | `backend/src/lib/bimEvents.ts:741` | `if (has(input.payload, 'rule_id') && has(input.payload, 'passed')) present.add(part);` |
| `rule_id` нь bind зарцуулдаггүй виртуал багана | `backend/migrations/0209_bim_generated_indexes.sql:27-28` | `ALTER TABLE learning_events ADD COLUMN rule_id TEXT` / `GENERATED ALWAYS AS (json_extract(payload_json, '$.rule_id')) VIRTUAL;` |
| Индекслэгдсэн | `backend/migrations/0210_bim_generated_indexes_2.sql:20` | `CREATE INDEX IF NOT EXISTS idx_le_rule` |

Тиймээс дүгнэлт бүр `kind='RULE_VALIDATION'`, `payload_contract='v1:RULE_VALIDATION+RULE_VERDICT'` гэж бичигдэнэ. **Шинэ үйл явдлын төрөл, шинэ хиймэл дагуулын бит, тусдаа `compliance_events` хүснэгт — ГУРВУУЛАА ХОРИОТОЙ**, учир нь бүгд байгаа слотыг давхардуулж, `DATASET_ELIGIBLE_SQL`-ийг (сургалтад тэнцэх мөрийн ЦОРЫН ГАНЦ тодорхойлолт) эвдэнэ.

**⚠️ ГЭВЧ ЭНЭ ҮНЭГҮЙ ОЛЗ НЬ БАС ҮНЭГҮЙ ХОРДУУЛАХ СУВАГ.** Бит тавигдсанаар `parts_missing = 0` болж, мөр нь `DATASET_ELIGIBLE_SQL`-ээр **АВТОМАТААР** сургалтад тэнцэнэ. Хэрэв дүгнэлт нь баталгаажаагүй 1200 мм-ийн босгоос гарсан бол, зургаан долоо хоногийн WARNING нь хэдэн арван мянган тэнцсэн `passed=false` мөр болж, загварыг тэдгээр дээр дахин сургана — бөгөөд §66 үүнийг илрүүлж ЧАДАХГҮЙ, учир нь цорын ганц үнэний эх сурвалж нь ЯГ ТЭР дүрэм. Тиймээс `2-1` нь бичих үед `verification_state`, `rule_version`, `ruleset_version`, `pack_sha256`, `team_code`, `team_source`-ийг payload дотор **ХӨЛДӨӨНӨ** (0220), бөгөөд хамаарал нь үйл явдлын төрлөөс БИШ, хөлдөөсөн `verification_state`-ээс шалтгаална.

### 2.5 R7-ийн машин механизм — АЛЬ ХЭДИЙН БАЙГАА хэсэг

Эзний хамгийн чухал шаардлага (гацалтгүй) нь тэг дээрээс эхлэхгүй. Add-in дотор ажиллаж байгаа зүйлс:

```
ChangeTracker.cs:55    private const int FlushIntervalMs = 3000;
ChangeTracker.cs:313   _flushTimer = new Timer(_ => FlushDirty(), null, FlushIntervalMs, FlushIntervalMs);
ChangeTracker.cs:800   lock (Gate)                      ← гүйлгээ ТУТАМ, Revit-ийн үндсэн урсгал дээр
ChangeTracker.cs:801   if (Suppressed.Contains(key)) return;   ← бусдын sync/reload-ийг тоолохгүй
RevitToolBus.cs:134    private static readonly SemaphoreSlim Gate = new SemaphoreSlim(1, 1);
RevitToolBus.cs:440    private const int MaxPerSlice = 4;
RevitToolBus.cs:458    while (done < MaxPerSlice && _queue.TryDequeue(out ToolCall call))
Nudges.cs:34           public const int MaxPerDay = 2;
Nudges.cs:36           public static readonly TimeSpan MinGap = TimeSpan.FromMinutes(90);
Nudges.cs:42           public static readonly TimeSpan QuietAfterTyping = TimeSpan.FromSeconds(90);
```

| Юу бэлэн | Track 2-ийн үр дагавар |
|---|---|
| §55-ын 1→2 шат (дебаунс) — 3 секундын дискний flush | `2-4` нь үүн дээр ЮУ Ч нэмэхгүй (§4-ийн 7-р дүрэм) — ӨӨРИЙН `IsBackground` урсгал үүсгэнэ |
| `Suppressed` олонлог — «энэ бол миний ажил уу?» | `2-3`-ын хуучралын гурван триггерийн НЭГ НЬ ЗААВАЛ `Suppressed.Remove(key)` дээр байна, эс бөгөөс worksharing дээр олдвор хэзээ ч шинэчлэгдэхгүй |
| `MaxPerSlice = 4` + `RaiseAgain()` — Revit-ийн мессежийн гогцоо эргэлдэнэ | `2-3`-ийн `collect_rule_inputs` нь ≤150 элемент + дотоод 1500 мс хугацаа + `{more, cursor}`. ⚠️ ХЭРЭГСЭЛ ӨӨРӨӨ (`RuleFactExtractor`, `RevitTools.cs`-ийн бүртгэл, `RevitApi.TimeoutFor`) нь `2-3`-ынх; `2-4` нь ЗӨВХӨН COLD дуудлагын байрлал ба `TryCall`-ыг эзэмшинэ |
| **§76-ийн мэдэгдлийн ядаргааны төсөв** — `MaxPerDay = 2` НИЙТ | ⚠️ `Nudges` нь өнөөдөр **ҮЙЛДВЭРЛЭЛИЙН НЭГ Ч ДУУДАГЧГҮЙ.** Хэмжсэн: `grep -rn "Nudges\." revit-mcp/addin/ --exclude-dir=Resources` нь `Nudges.cs`-ээс гадуур **юу ч буцаахгүй**. §76 нь АРХИТЕКТУРААР шийдэгдсэн, ҮЙЛ АЖИЛЛАГААГААР БИШ. **`MaxPerDay`-г БҮҮ ӨСГӨ** — файлын толгой өөрөө өдөрт олон удаа дуугарвал хүмүүс add-in-ээ унтраадаг гэж бичсэн |

### 2.6 Deploy-гүйгээр тохируулагдах унтраалганууд — АЛЬ ХЭДИЙН БЭЛЭН

`backend/migrations/0208_bim_capture_settings.sql` нь найман `app_settings` түлхүүр суулгасан:

```
0208:14   bim.capture.mode              'full'        -- full | salient | meta | off
0208:17   bim.capture.elements_per_txn  '24'
0208:20   bim.capture.elements_per_session '4000'
0208:23   bim.capture.element_sample_n  '8'
0208:27   bim.capture.txn_batch_max     '200'
0208:30   bim.capture.artifact_max_bytes '2097152'
0208:37   bim.capture.notice_version    '2026-09-01'   ← ИРЭЭДҮЙН огноо, §9-4
0208:40   bim.events.logging            'on'           ← ЕРӨНХИЙ УНТРААЛГА
```

**Track 2-ийн бүх шинэ тохируулга ЯГ ЭНЭ нэрийн орон зайд ордог** (`bim.compliance.*` — `0228_compliance_settings.sql`-ийн найм, нэмээд `0230_compliance_authority.sql`-ийн хоёр; §3.5), кодын тогтмол болж ХЭЗЭЭ Ч эмхэтгэгдэхгүй. Шалтгаан нь энгийн: add-in-д автомат шинэчлэл байхгүй тул эмхэтгэсэн тогтмолыг засах нь ~20 машины дахин суулгалт, харин `app_settings`-ийн UPDATE нь агшин зуурын, буцаах боломжтой. Энэ бол §3.2-ийн LEVEL 0 → LEVEL 2 дэвшилтийн бүхэл бүтэн механизм.

### 2.7 Хэмжигдсэн ба хэмжигдээгүй — ялгааг ил гаргах

| Зүйл | Төлөв | Эх сурвалж |
|---|---|---|
| Чатын замын латент (p50/p95/p99/max) | **ХЭМЖИГДСЭН**, серверт хүрдэг | `0216:57-59` `timing_json` + GENERATED скаляр |
| `OnDocumentChanged`-ийн үргэлжлэх хугацаа | **ХЭМЖИГДСЭН**, гэвч ЗӨВХӨН локал `timing.log` дээр, 1/64 түүврээр | `Percentiles` `DocChanged` хуримтлагч |
| `FlushDirty`-ийн түгжээ барих хугацаа | **ХЭМЖИГДСЭН**, локал, түүвэрлээгүй | `Percentiles` `FlushLock` хуримтлагч |
| Дүрмийн үнэлгээний хугацаа (`RuleEval`) | **ХЭМЖИГДЭЭГҮЙ** — хуримтлагч нь оршихгүй | `2-4` ТУНХАГЛАНА (`Percentiles.cs` §3.11), `2-3` БИЧНЭ |
| `collect_rule_inputs`-ийн хугацаа (`InputCollect`) | **ХЭМЖИГДЭЭГҮЙ** | `2-4` ТУНХАГЛАНА, `2-3` БИЧНЭ |
| Инженер тутмын өдрийн үйл явдлын тоо | **ХЭМЖИГДЭЭГҮЙ** — 1B-1 §9 «ХЭН Ч ХЭМЖЭЭГҮЙ» | §9-7 |
| Add-in-ийн C# тестийн хамрах хүрээ | **ТЭГ** — `revit-mcp/addin`-д тестийн төсөл БАЙХГҮЙ | §2.3-ийн 14-р мөр |

**⚠️ Тиймээс Track 2-ийн ЯМАР Ч латентын тоо нь «УРЬДЧИЛСАН» гэсэн шошготой байна.** v2 §30 нь 250 мс-ийг бүхэлд нь SLO болгож иш татахыг ИЛЭРХИЙ хориглодог. Төсөв нь **ЭЦСИЙН SLO** болох цорын ганц зам: 30 хоногийн өгөгдөл, ≥10 өөр `machine_hash`-аас.

---

## 3. ХИЙХ АЖИЛ

> **⚠️ Энэ §3-д КОД БАЙХГҮЙ** — энэ баримт нь ажлын сесс биш, гэрээ. Бодит DDL, C#, TypeScript нь `2-1` … `2-8` сессийн баримтуудад байна.

### 3.1 Хамрах хүрээ — IN SCOPE / OUT OF SCOPE

Шугамыг v2 §40 (эхний MVP) ба §81 (бүтээгдэхүүний хувьсал) татна.

**IN SCOPE — Track 2 (release N):**

| Юу | v2 үндэслэл |
|---|---|
| Баталгаажсан норм баримт → дүрэм → Revit загвар → **PASS / WARNING / VIOLATION / UNCERTAIN** дөрвөн утгат дүгнэлт | §40:1426-1429 |
| Дүгнэлт бүр нь 7 талбар авч явна: эх сурвалж, заалт, хуудас, хувилбар, тооцоо, хамрагдсан Revit элемент, засах зөвлөмж | §40:1434-1440 |
| Баг-хамааралт дүрмийн багц, автомат баг таних, буцаах боломжтой засвар | §46–50, §72, §73 |
| Идэвхгүй (passive), нэмэгдлээр (incremental), гацалтгүй бодит цагийн шалгалт | §51–55 |
| Олдворын амьдралын мөчлөг, хуучирсан олдворыг хүчингүй болгох, үндсэн шалтгааны бүлэглэлт | §57, §58, §77 |
| Нотолгоо-нэгдүгээрт AI, тодорхойгүй байдлыг илэрхий гаргах, гарын авлагын override | §65, §64, §68 |
| «Хянахад бэлэн» хаалга — **хууль эрх зүйн баталгаа БИШ** | §69:2238 |
| Суурилуулалтын шугам, эрүүл мэндийн мэдээлэл, доройтсон/офлайн горим | §74, §75 |
| Мэдэгдлийн ядаргааны төсөв | §76 |

**OUT OF SCOPE — Track 2-т ОРОХГҮЙ:**

| Юу | Яагаад |
|---|---|
| Автомат засвар (auto-fix), загвар өөрчлөх | §40:1442 «No autonomous generation is required for the first MVP». §81-ийн 5-р шат |
| TEXT → BIM, SKETCH → BIM, IMAGE → BIM үүсгэлт | §81-ийн 6–8-р шат |
| Level-4 BIM архитектор | §81-ийн 9-р шат |
| Олон компанийн (multi-tenant) BIM тусгаарлалт | §41-ийн 12-р шалгуур — «eventually», Track 2-т биш. ⚠️ `bim_sessions` дээр `company_id` нэмэх шийдвэрийг **0217 гарахаас ӨМНӨ** авах ёстой (§9-8) |
| MCP дээр олдворын хос хэрэгсэл | `/mcp` нь `workerScopeGuard`, `entitlementGuard`, тенантын `tid` гурвыг ЗЭРЭГ тойрдог |

### 3.2 Эхний хувилбарын эрх мэдлийн түвшин (v2 §80)

v2 §80 нь зургаан түвшин зарлана: `LEVEL 0 OBSERVE` → `1 EXPLAIN` → `2 RECOMMEND` → `3 PREVIEW` → `4 HUMAN-APPROVED EXECUTE` → `5 LIMITED AUTONOMOUS EXECUTE`.

**Release N нь LEVEL 0 — OBSERVE дээр гарна.** DLL нь БҮРЭН хөдөлгүүрийг (үнэлэгч, багц ачаалагч, коалесцер, ялгаруулагч, мэдэгдлийн урсгал, гүйлтийн дэвтэр, эрүүл мэндийн тайлан) агуулна, гэвч `app_settings['bim.compliance.authority_level'] = '0'`.

| Шийдвэр | Яагаад |
|---|---|
| Хөдөлгүүр нь release N дотор **бүтнээр** явна, дараагийн хувилбарт үлдээхгүй | Add-in-д автомат шинэчлэл БАЙХГҮЙ. Хөдөлгүүрийг хойшлуулах нь ~20 PC-ийн гараар суулгалтыг ХОЁР УДАА төлнө |
| LEVEL 0 нь **хоосон багц БИШ, нэг дүрмийн canary багц** ачаална (үргэлж хамаарна, `severity='INFO'`, `report: false`) | Хоосон багц гэдэг нь нэг ч дүрэм таарахгүй, `collect_rule_inputs` хэзээ ч дуудагдахгүй, `RuleEval` хэзээ ч ажиллахгүй гэсэн үг. Тэгвэл Revit-ийг гацаах чадвартай ЯГ ХОЁР шатны хэмжилт хоосон хэвээр үлдээд, эхний жинхэнэ багц 20 машин дээр ЗЭРЭГ асна |
| LEVEL 1 (EXPLAIN) ба LEVEL 2 (RECOMMEND) руу дэвших нь **нэг `app_settings` UPDATE + нэг дүрмийн багц нийтлэл** — DLL БАЙХГҮЙ, Install.bat БАЙХГҮЙ, 20 PC БАЙХГҮЙ | Дүрэм нь эмхэтгэсэн C# биш, **ӨГӨГДӨЛ**. Буруу `1200` нь дахин нийтлэл; буруу `if` нь 20 машины дахин суулгалт |
| Дэвшилт нь **үе шаттай**: `bim.compliance.rollout_pct` (өгөгдмөл `'0'`) нь `machine_hash`-ийг 0–99-т буулгаж харьцуулна | Эхний жинхэнэ багц 1–2 машинд очно, 20-д биш |
| **LEVEL 3 ба түүнээс дээш нь Track 2-ийн хамрах хүрээнд ОРОХГҮЙ** | §40-R4 нь MVP-г RECOMMEND дээр таглана |

⚠️ **ЭНЭ ХОЁР ДУГУЙ ӨНӨӨДӨР АЛЬ Ч MIGRATION-Д БАЙХГҮЙ.** `bim.compliance.authority_level` ба `bim.compliance.rollout_pct` нь `2-4`-ийн `0228_compliance_settings.sql`-ийн НАЙМАН түлхүүрийн дунд ОРООГҮЙ (тэр файлын толгой өөрөө «НӨӨЦ ТЭГ: ЕС ДЭХ дугуй нь ШИНЭ ФАЙЛ, ШИНЭ ДУГААР шаардана» гэж бичсэн). Мөр байхгүй бол `authorityFromSetting(null)` нь `'OBSERVE'` руу унана — **АЮУЛГҮЙ, гэвч дэвшилт БОЛОМЖГҮЙ**, өөрөөр хэлбэл §3.2-ийн бүх шийдвэр, §6-ийн LEVEL 2 зам хоёулаа ажиллахгүй. Тиймээс §3.5-д тэдгээрт **шинэ файл `0230_compliance_authority.sql`** (`2-4`-ийнх, нөөц блокоос) хуваарилав, `COMPLIANCE_KEYS`-ийн УНШИГЧТАЙГААР.

### 3.3 Шийдэгдсэн архитектур — нэг хуудсаар

Дөрвөн эгнээ. v2 §54-ийн үг санг (HOT / BACKGROUND / COLD / REMOTE) хэрэглэнэ; v1 §31-ийн FAST PATH / AI PATH нэрс шинэ кодод **ХЭЗЭЭ Ч** гарахгүй.

```
   Revit гүйлгээ
        │
        ▼
┌──────────────────────────────────────────────────────────────────┐
│ HOT — ChangeTracker.OnDocumentChanged, Revit-ийн ҮНДСЭН УРСГАЛ   │
│  · одоо байгаа олонлогийн алгебр — ӨӨРЧЛӨГДӨХГҮЙ                │
│  · + RawRing.Append(entry) — БАЙГАА lock (Gate) дотор НЭГ дуудлага│
│    Revit API-ийн НЭМЭЛТ дуудлага ТЭГ.  Халуун замд хуваарилалт ТЭГ│
│  ⛔ гүйлгээ · Regenerate · диск · сүлжээ · инференс — ХЭЗЭЭ Ч     │
└──────────────────────────────────────────────────────────────────┘
        │  _wake сигнал
        ▼
┌──────────────────────────────────────────────────────────────────┐
│ BACKGROUND — ComplianceScheduler, ӨӨРИЙН IsBackground урсгал     │
│  · RawRing-ийг хязгаартай хуулна (түгжээг ШУУД суллана)          │
│  · ChangeSetCoalescer: settle 1200ms / defer 15000ms / <=2000 эл. │
│  · дүрмийн триггер индекс: Dictionary<(category,change), Rule[]>  │
│  · ЗОГСОХ ХААЛГА: BatchQto.IsBatch? UserBusy? Gate.Wait(0) бүтсэн?│
│    → энэ мөчлөгийг ОРХИНО.  Орхих нь ХЭВИЙН, алдаа БИШ           │
│  · RuleEngine.Evaluate — цэвэр, Autodesk.Revit төрөл БАЙХГҮЙ      │
│  ⛔ ChangeTracker._flushTimer дээр ЮУ Ч нэмэхгүй (§4-ийн дүрэм 7) │
└──────────────────────────────────────────────────────────────────┘
        │                                    │
        ▼ хэрэгтэй бол                        ▼ олдвор
┌───────────────────────────────┐  ┌──────────────────────────────┐
│ COLD — RevitToolBus           │  │ REMOTE — BimEmitter          │
│  ExternalEvent, MaxPerSlice=4 │  │  ӨӨРИЙН IsBackground урсгал  │
│  collect_rule_inputs:         │  │  BlockingCollection(4096)    │
│   <=150 элемент, дотоод       │  │  + backoff + circuit breaker │
│   1500ms хугацаа, {more,cursor}│  │  → POST /api/learning/events │
│  Gate.Wait(0) — өрсөлдвөл SKIP│  │  ТӨЛӨВ ӨӨРЧЛӨГДСӨН дүгнэлт л  │
│  ГЕОМЕТР УНШИХ ЦОРЫН ГАНЦ ГАЗАР│  │  AiHttp — ТУСДАА HttpClient   │
└───────────────────────────────┘  └──────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────────┐
│ ГАДАРГУУ — ribbon товчны гарчиг дээрх тоолуур (set_compliance_badge)│
│  · pane-г ХЭЗЭЭ Ч автоматаар нээхгүй (DockablePane.Show() ХОРИОТОЙ)│
│  · release N нь push ТЭГ ялгаруулна.  Nudges.MaxPerDay НЭМЭГДЭХГҮЙ│
│  · жагсаалт нь ЗӨВХӨН татахад (PULL) уншигдана                    │
└──────────────────────────────────────────────────────────────────┘
```

⚠️ **ХАМГИЙН СҮҮЛИЙН ХАЙРЦАГ НЬ МЕХАНИЗМ, RELEASE N-ИЙН ХАРАГДАХ ЗАН ТӨЛӨВ БИШ.** `set_compliance_badge`, `PushButton`-ы барилт, `FindingFeed` гурвуулаа release N-ийн DLL дотор **ЗААВАЛ** явна (`2-4` §3.16 «PULL нь энэ релизэд ЗААВАЛ») — гэвч `authority_level = '0'` үед `AUTHORITY_CAPS.OBSERVE` нь `{ collect: true, surface: false }` — **`surface: false`** (`2-5` §3.9, `2-5-finding-surface.md:501`) тул тоолуур **ХАРАНХУЙ**, ribbon-ийн гарчиг ӨӨРЧЛӨГДӨХГҮЙ. Тоолуур **LEVEL 1 (EXPLAIN) дээр АНХ АСНА** — §6-ийн LEVEL 2 руу дэвших замын жагсаалт. **Хураангуй тоо (дүрмийн ID, заалт, элемент БАЙХГҮЙ) ч гэсэн харуулалт мөн** тул LEVEL 0-д ГАРАХГҮЙ; §3.4-ийн 2-р шалгуурын няцаагдах ажиглалт нь серверийн талын `rule_run_ledger` + `timing.log` дээр байна, badge дээр БИШ. Энэ өгүүлбэрийг `2-5` §3.9-ийн LEVEL 0 мөр ба `2-4` §3.16 хоёулаа ижил утгаар давтана.

**Гурван тэнхлэг олдвор бүр дээр — ХЭЗЭЭ Ч нийлүүлэхгүй:**

| Тэнхлэг | Утгууд | v2 |
|---|---|---|
| `verdict` | `PASS` `WARNING` `VIOLATION` `UNCERTAIN` (яг 4; `NOT_APPLICABLE` нь хамаарлын үр дүн бөгөөд мөр болж ХЭЗЭЭ Ч бичигдэхгүй) | §40:1426 |
| `issue_class` | `REGULATORY_VIOLATION` `MODEL_QUALITY` `PROJECT_INCOMPLETENESS` `TEAM_STANDARD` `UNKNOWN_NEEDS_REVIEW` | §59:2003-2007 |
| `evidence_level` | `RULE_BACKED` `MODEL_DERIVED` `HUMAN_VERIFIED` `AI_INFERRED` `UNKNOWN` | §65:2151-2155 |

**Багийн шийдвэрийн шат (v2 §48) — ШИЙДВЭРЛЭГЧ ба БАТАЛГААЖУУЛАГЧ түвшин:**

| Түвшин | Дохио | `team_source` | Итгэл | Төрөл |
|---|---|---|---|---|
| 1 | `revit_sheet_bindings` → tasks → components → drawings → `blocks.team_id` → `teams.code` (холбоос нь `revit.ts:805-812` дээр АЛЬ ХЭДИЙН бий) | `binding` | 1.00 | ШИЙДВЭРЛЭГЧ |
| 1b | `revit_documents.team_code` (`0187:30`, өнөөдөр үхмэл багана) | `document` | 0.95 | ШИЙДВЭРЛЭГЧ |
| 2 | `project_team_shares` — багцгүй кодуудыг (MGMT, EZ, GT) хассаны дараа яг нэг мөр `share_percent > 0` бол | `project_shares` | 0.75 | ШИЙДВЭРЛЭГЧ |
| 3 | `user_teams WHERE is_primary = 1` → `teams.code` | `user_primary` | 0.85 | ШИЙДВЭРЛЭГЧ |
| 4 | Хуудасны дугаарын угтвар | `sheet_prefix` | 0.65 | **ЗӨВХӨН БАТАЛГААЖУУЛАГЧ** |
| 5 | Ангиллын хольц (Ducts/Pipes→HAS/TSBU, Lighting→TSAH, Furniture→IZ, Rebar→BB, Walls/Rooms→BA) | `behavior` | ≤0.60 | **ЗӨВХӨН БАТАЛГААЖУУЛАГЧ** |
| 6 | Юу ч босгоос давсангүй | `uncertain` | 0.00 | — |

⚠️ **ЭРЭМБЭ НЬ ИТГЭЛЦЛЭЭР БИШ, v2 §48-ын «preferred hierarchy»-ээр тогтоно** — `project_shares` (0.75) нь `user_primary` (0.85)-аас **ӨМНӨ** шалгагдана. Шийдвэрлэгч шатууд нь binding → document → project metadata → identity гэсэн дарааллаар явах ба нэр дэвшигч гаргасан ЭХНИЙ шат ЯЛНА; итгэлцэл нь тусад нь МЭДЭЭЛДЭГ тоо, уралдааны оноо БИШ (`2-1` §3.4-ийн `TIER_CONFIDENCE` тайлбар ба §10-ийн шийдвэрийн бүртгэл).

Шийдвэрлэгч түвшний итгэл нь `TEAM_ACCEPT_CONFIDENCE` (0.70)-оос **ХАТУУ ИХ (`>`)** байна. Түвшин 1 ба 3 ЗӨРВӨЛ → үр дүн нь `UNCERTAIN` + `conflict_json`, түвшин 1 БИШ (§48-R6 «do not silently apply the wrong team's rules»).

**БАГЦГҮЙ КОДЫН ДҮРЭМ — ЭЗЭН БАТАЛСАН (2026-08-30).** Баталсан найман салбар нь **BA · BB · HAS · TSBU · TSAH · HD · AU · IZ**; `teams` дэх үлдсэн гурав — **MGMT** (`0007_teams.sql:47`), **EZ** ба **GT** (`0074_seed_ez_gt_teams.sql:12-14`) — дүрмийн багц ХЭЗЭЭ Ч авахгүй. Тиймээс шат нь тэдгээрийн НЭГИЙГ гаргаж ирвэл:

- үр дүн нь **`team_code = <тэр код>`, `team_source` нь шатны бодит эх сурвалж, `team_confidence` нь шатны бодит утга** — өөрөөр хэлбэл **илрүүлэлт АМЖИЛТТАЙ**, зөвхөн **ачаалах багц БАЙХГҮЙ**;
- ⛔ энэ нь **`TEAM = UNCERTAIN` БИШ** бөгөөд түүнтэй ХЭЗЭЭ Ч ХОЛИГДОХГҮЙ. UNCERTAIN = илрүүлэлт УНАСАН (`team_code` NULL, `team_source='uncertain'`, итгэл 0.0, хэрэглэгчээс залруулга шаардана); багцгүй баг = илрүүлэлт БҮТСЭН, засах зүйл АЛГА. Бүрэн харьцуулах хүснэгт нь `2-1-team-context` §3.4-т;
- тэр сесс нь **ЮУГААР Ч шалгагдахгүй** (`complianceEnabled` → `false`) — хамгийн ойрын, хамгийн том, эсвэл өгөгдмөл багийн дүрмээр ОРЛУУЛАХЫГ ХОРИГЛОНО (v2 §46-ийн ростерын тэмдэглэл, §48-R6, §82-4);
- `learning_events` нь тэр кодоор **ШОШГОЛОГДСОН хэвээр** (§72) — багцгүй сессийн шошгыг NULL болгож «дугуйлбал» тэр ажил БАГГҮЙ корпуст орж, дараа нь MGMT/EZ/GT-д багц зохиох болвол ЭХЛЭХ өгөгдөл нь алга болно;
- гадаргуу дээр «**Баг: EZ (дүрмийн багцгүй)**» чип гарна — «Баг: тодорхойгүй» БИШ, диалог БИШ, хэрэглэгчээс ЮУ Ч ШААРДАХГҮЙ (§6-ийн release N жагсаалт).

⚠️ **Найм гэдэг нь ТӨЛӨВЛӨЛТИЙН тоо** (хэдэн багц зохиох вэ), эмхэтгэх литерал БИШ. Багцтай эсэхийг **багцын бүртгэлээс** (`team_code` бүхий дүрмийн мөр байгаа эсэх) шалгана, `teams`-ээс ХАСАХ хатуу жагсаалтаас БИШ — ингэснээр 9 дэх салбар нэмэгдэхэд DLL-д ямар ч өөрчлөлт шаардагдахгүй.

### 3.4 Хүлээн авах бүртгэл — v2 §82-ийн арван зургаан үндсэн шалгуур

Мөр бүр нь **няцаагдах боломжтой** ажиглалттай. «Ажиллаж байна» гэсэн үг хүчингүй.

| # | §82 шалгуур | Эзэн баримт | Няцаагдах ажиглалт |
|---|---|---|---|
| 1 | no mandatory workflow interruption | `2-4` | Add-in суулгасны дараа Revit-д гарч ирэх ШИНЭ модал цонхны тоо = **0**. `grep -c "DockablePane.*Show()" revit-mcp/addin/` → **1** (зөвхөн ribbon команд) |
| 2 | no per-action manual checking requirement | `2-3`, `2-5` | **Release N (LEVEL 0):** хэрэглэгч ямар ч товч дараагүйгээр 20 минут зурахад (a) тухайн сессийн `rule_run_ledger` дээр мөр НЭМЭГДСЭН, (b) `%APPDATA%\RevitMcpAddin\timing.log` дээр `Coalesce`, `RuleEval`, `InputCollect` гурав ХООСОН БИШ. ⚠️ LEVEL 0 нь `AUTHORITY_CAPS.OBSERVE` = `{ collect: true, surface: false }` (**`surface: false`**) тул ribbon-ийн тоолуур ӨӨРЧЛӨГДӨХГҮЙ — тэр ажиглалт нь §6-ийн LEVEL 1-ийн жагсаалтад байна. Эзэн эхний хувилбар дээр тоолуур хайвал ЗӨВ систем эвдэрсэн мэт харагдана |
| 3 | automatic team context where safely determinable | `2-1` | BA-ийн хэрэглэгчээр нэвтэрч `GET /api/revit/team-context` → `{team_code:'BA', team_source:'user_primary', team_confidence:0.85}`. Гишүүнчлэлгүй хэрэглэгчээр → `team_source:'uncertain'`, `team_code:null` |
| 4 | **zero cross-team confidential knowledge leakage** | `2-1`, `2-2`, `2-6` | BA-ийн токеноор дүрмийн багц татахад `rules[].team_code` олонлог нь `{'BA', null}` — өөр ямар ч код БАЙХГҮЙ. IZ-ийн дүрмийн `rule_uid` буцаж ирвэл ЗӨРЧИЛ |
| 5 | proactive compliance detection | `2-3` | Нэг өрөөний өргөнийг багасгасны дараа 90 секундэд олдвор бүртгэгдсэн байна (хэрэглэгч юу ч дараагүй) |
| 6 | source-traceable regulatory findings | `2-2` | Олдвор бүр дээр `document_uid` + `verification_state`. `CLAUSE_CITED`/`HUMAN_VERIFIED` бол `edition`+`clause`+`effective_from` NOT NULL (**0221_rules.sql**-ийн CHECK — 0223 нь `project_context_packs`) |
| 7 | incremental rather than full re-analysis | `2-3`, `2-4` | Нэг элемент өөрчлөхөд `rule_run_ledger.considered` нь бүх дүрмийн тооноос БАГА |
| 8 | stale-finding invalidation | `2-3` | Synchronize-with-Central-ийн дараа тухайн баримтын олдвор бүр дээр `stale_at` бөглөгдсөн, `stale_reason='sync'` |
| 9 | root-cause grouping | `2-5` | `finding_edges` дээр `kind='causes'` мөр үүсээд UI нь «1 үндсэн + N үр дагавар» гэж харуулна |
| 10 | bounded AI resource usage | `2-4` | `bim.compliance.max_elements_per_set` (2000) ба `bim.compliance.raw_ring_max` (4000) давсан үед `bim_sessions.dropped_count` НЭМЭГДЭНЭ, POST хийхгүй. ⚠️ Хоёулаа `0228_compliance_settings.sql`-ийн НАЙМАН дугуйн дунд БАЙГАА бөгөөд `loadComplianceConfig` УНШДАГ — `verdicts_per_session` гэдэг түлхүүр аль ч migration-д БАЙХГҮЙ тул ажиглалт болгож ХЭРЭГЛЭХГҮЙ |
| 11 | offline/degraded operation | `2-4` | Сүлжээ таслахад Revit ХЭВИЙН ажиллана, дараалал 4096-д дүүрч, 5 удаагийн алдааны дараа circuit breaker онгойно |
| 12 | deterministic calculations where possible | `2-2` | `RuleEngine` нь `Autodesk.Revit`-ийн НЭГ Ч төрөл ашиглахгүй — `dotnet run`-аар Revit-гүй тестлэгдэнэ |
| 13 | explicit uncertainty | `2-2`, `2-3` | Оролт дутуу үед `verdict='UNCERTAIN'`, `Quantity.Missing=true`; `untyped_param` нь ҮРГЭЛЖ `Missing` |
| 14 | reproducible model versions | `2-6`, `2-8` | Дүгнэлт бүрийн `payload_json`-д `pack_sha256` хөлдөөгдсөн; нийтлэгдээгүй hash → `evidence_level='UNKNOWN'` |
| 15 | safe deployment and rollback | `2-8` | Тараахаас ӨМНӨ өмнөх сайн zip архивлагдсан байна (өнөөдөр `revit-mcp/dist` БАЙХГҮЙ — §9-6) |
| 16 | measurable FP/FN performance | `2-7` | `finding_overrides`-оос FP хувь тооцоологдож, `rule_run_ledger`-ээс «хэзээ ч ажиллаагүй дүрэм» ил гарна |

**⚠️ 4-Р ШАЛГУУР НЬ v1 §29-ӨӨС ХАТУУ.** v1 нь зөвхөн **компани** хоорондын тусгаарлалт шаарддаг байсан; v2 §82 нь **баг** хоорондын нууц мэдлэгийн ТЭГ алдагдал шаардана. **Репо өнөөдөр үүнийг ЗӨРЧИЖ БАЙНА**: `backend/src/middleware/auth.ts:138` → `requireManager = () => requireRole(...ADMIN_ROLES, 'senior')` — багийн гишүүнчлэлийн шалгалт ОГТ БАЙХГҮЙ, тиймээс аль ч сениор аль ч багийн өгөгдлийг засаж чадна. Track 2 нь энэ хийдлийг ӨРГӨТГӨХГҮЙ; шинэ гадаргуу бүр өөрөө багийн хамрах хүрээгээ шалгана.

### 3.5 Мөрдөлтийн матриц — R1–R7 ба §83-ын 14 суурь → хариуцагч баримт

⚠️ **ДООРХИ «Migration» БАГАНА НЬ ЗӨВХӨН МЭДЭЭЛЛИЙН ЗОРИУЛАЛТТАЙ.** Нөөцлөлтийн албан ёсны бүртгэл нь (a) энэ хэсгийн доорхи **бүрэн хуваарилалтын хүснэгт**, (b) тухайн баримт бүрийн **§3.0** — тэнд дугаар нь ЗАРЛАГДАНА. Бичихийн ЯГ ӨМНӨХ мөчид `ls backend/migrations | tail -5` **ДАХИН** ажиллуулна; зэрэгцээ агентууд дугаар авч байна, репод аль хэдийн зургаан давхардсан дугаар бий (0002, 0060, 0080, 0110, 0120, 0121), хэрэгжсэн файлыг засах нь продакшн дээр ЧИМЭЭГҮЙ NO-OP.

| §83 суурь | Одоогийн төлөв (§2) | Хариуцагч баримт | Migration | R-хамаарал | v2 §§ |
|---|---|---|---|---|---|
| 1 Canonical event model | SHIPPED, үйлдвэрлэгчгүй | `2-4-nonblocking-runtime` (C# ялгаруулагч) | 0226–0228 | R1 | §71, §72, §75 |
| 2 Team-aware context | ABSENT | `2-1-team-context` | 0217–0219 | R3, R4, R5, R6 | §46–48, §72, §73 |
| 3 Regulatory document registry | ABSENT | `2-2-rule-model` | 0220 | R2, R5, R6 | §7–9, §65 |
| 4 Versioned rule model | ABSENT | `2-2-rule-model` | 0221, 0223 | R3, R5, R6 | §49, §50, §64 |
| 5 Rule applicability engine | ABSENT | `2-2-rule-model` | 0221, 0223 | R2, R5, R6 | §61, §62 |
| 6 Deterministic calculation engine | ABSENT | `2-2-rule-model` | 0222 | R2 | §62, §63 |
| 7 Incremental compliance engine | PARTIAL (клиент) | `2-3-compliance-engine` + `2-4` | 0224–0225, 0229 | R2, R7 | §51, §52, §54, §55 |
| 8 Source/evidence model | PARTIAL | `2-3-compliance-engine` | 0224 | R2, R5, R6 | §65, §67 |
| 9 Finding lifecycle | ABSENT | `2-3` (төлөв) + `2-5` (override) | 0224–0225, 0237 | R2, R6 | §56, §57, §58, §68, §77 |
| 10 Golden evaluation | PARTIAL (хоосон хуваарь) | `2-7-readiness-and-quality` | — | R2 | §66, §70, §79 |
| 11 Team/company/project isolation | PARTIAL (баг АЛГА) | `2-1` + `2-6-team-training` | 0238–0240 | R3, R4 | §47, §50, §82-4 |
| 12 Performance instrumentation | PARTIAL (чат) | `2-4-nonblocking-runtime` | 0226 | R7 | §30, §54 |
| 13 Degraded/offline mode | PARTIAL | `2-4-nonblocking-runtime` | 0228 | R1, R7 | §75 |
| 14 Safe deployment/versioning | PARTIAL | `2-8-install-and-health` | 0241–0242 | R1 | §74, §79, §80 |

⚠️ **ДУГААРЫН БЛОКИЙН ИНДЕКС нь `docs/bim-ai/README.md:133-142`; ДООРХИ ХҮСНЭГТ нь Track 2-ийн НӨӨЦЛӨЛТИЙН БҮРТГЭЛ.** Хоёулаа нийцнэ — доорхи хүснэгт нь README-ийн 0217–0242 блокоос ГАДУУР дугаар авахгүй. Ганц ялгаа нь: README нь **0229–0236**-ыг «нөөц — шаардлага гарвал ав, §3.0-д зарла» гэж үлдээсэн бөгөөд Track 2 нь тэр зөвшөөрлөөр **0229 (`2-3`) ба 0230 (`2-4`)** ХОЁРЫГ авав (шалтгаан нь доорхи хоёр шийдвэр). ⚠️ **`2-3` ба `2-4` ХОЁУЛАА 0229-ыг зарласан ЖИНХЭНЭ мөргөлдөөн байсныг** `2-8-install-and-health.md:372` тэмдэглэсэн; §0-ийн «энэ файл давамгайлна» дүрмээр **энд шийдэгдэв: 0229 нь `2-3`-ынх, `2-4` нь 0230 руу шилжинэ** (§8-ийн үлдэгдлийн хүснэгт). Бүрэн хуваарилалт:

| Баримт | Migration | Файлууд |
|---|---|---|
| `2-1-team-context` | **0217–0219** | `0217_bim_session_team`, `0218_team_attributions`, `0219_learning_events_team` |
| `2-2-rule-model` | **0220–0223** | `0220_regulatory_documents`, `0221_rules`, `0222_rule_conflicts_tests`, `0223_project_context_packs` |
| `2-3-compliance-engine` | **0224–0225 + 0229** | `0224_compliance_findings`, `0225_finding_links`, `0229_rule_run_ledger` |
| `2-4-nonblocking-runtime` | **0226–0228 (+0230)** | `0226_perf_scalars`, `0227_compliance_notice_state`, `0228_compliance_settings`, `0230_compliance_authority` |
| `2-5-finding-surface` | **0237** | `0237_finding_overrides` |
| `2-6-team-training` | **0238–0240** | `0238_assistant_team_scope`, `0239_model_capabilities`, `0240_team_rule_scope` |
| `2-7-readiness-and-quality` | **БАЙХГҮЙ** | зөвхөн УНШИНА: 0222, 0224, 0225, **0229**, 0237 |
| `2-8-install-and-health` | **0241–0242** | `0241_addin_releases`, `0242_addin_installs` |
| НӨӨЦ | **0231–0236** | README-ийн нийт нөөц нь **0217–0242**; 0229 ба 0230 нь дээр эзэмшигдэв. Файл хуваах шаардлага гарвал л ав, авсан бол тухайн баримтын §3.0-д зарла |

⚠️ **ХОЁР ШИЙДВЭР ЭНД АВАГДАВ, учир нь §3.4-ийн ажиглалтууд тэднээс хамаарна:**

1. **`rule_run_ledger` нь `2-3`-ынх, дугаар нь 0229.** `2-7` нь §0-ийн 3-р дүрмээрээ **migration АВАХГҮЙ** гэж зарласан бөгөөд өөрийн хамаарлын мөрөнд «`rule_run_ledger` … нь тэнд (`2-3`) үүснэ» гэж бичсэн. Тиймээс `2-3` §9 №2-ын асуулт («хэн эзэмших вэ») **ЭНД ХААГДЛАА**. `2-3`-ын зохиогч §3.0-даа 0229-ыг зарлана. Үүнгүйгээр §3.4-ийн 7 ба 16-р шалгуур ажиглагдах ОБЪЕКТГҮЙ үлдэнэ.
2. **`bim.compliance.authority_level` ба `bim.compliance.rollout_pct` нь 0228-д БАЙХГҮЙ.** `0228_compliance_settings.sql` нь ЯГ найман statement (толгой нь «НӨӨЦ ТЭГ: ЕС ДЭХ дугуй нь ШИНЭ ФАЙЛ, ШИНЭ ДУГААР шаардана» гэж бичсэн). Энэ хоёр түлхүүр нь §3.2-ийн БҮХ дэвшилтийн механизм тул **шинэ файл `0230_compliance_authority.sql` (`2-4`-ийнх)**-д `INSERT OR IGNORE`-оор суух ба `loadComplianceConfig`-ийн `COMPLIANCE_KEYS` массивт УНШИГЧТАЙГААР нэмэгдэнэ — уншигчгүй дугуй нь дугуй байхгүйгээс ДОР (`assistant.min_confidence`-ийн урхи).

**✅ ГУРАВДАХЬ ШИЙДВЭР — ЭЗЭН БАТАЛСАН (2026-08-30): ДҮРМИЙН БАГЦЫН ДАРААЛАЛ.** Дээрх матриц нь ЮУГ хэн бичихийг заана; энэ нь **ЯМАР ДАРААЛЛААР** бичихийг заана.

| Дараалал | Баг | Яагаад | Хаана бичигдэнэ |
|---|---|---|---|
| **1 (ЭХНИЙ БҮРЭН БАГЦ)** | **BA** — Барилга архитектур | Хамгийн том хураах корпус: `frontend/src/features/projects/team-reports/ba/` нь **12 «БНбД» дурдлага**, найман ялгаатай код агуулна (аль ч салбарынхаас ИХ; BB 3 ялгаатай, HAS 1, бусад ТЭГ). Ажиллах багц руу хүрэх ХАМГИЙН БОГИНО зам | `2-2-rule-model` (0221, 0223) |
| **2** | **IZ** — Интерьер зураг | Эзэн R6-д ӨӨРӨӨ нэрлэсэн. ⚠️ **IZ-д БНбД дурдлага ТЭГ** — багцыг норм каталогоос **шинээр зохионо**, шаблоноос хураахгүй | `2-2-rule-model` |
| **3–8** | BB · HAS · TSBU · TSAH · HD · AU | BA-гийн **бүтцийн загвараар** бичигдэнэ | `2-2-rule-model` |
| **ХЭЗЭЭ Ч** | MGMT · EZ · GT | Инженерийн салбар БИШ — багц БАЙХГҮЙ, тиймээс нийцлийн шалгалт АЛГАСАГДАНА. Баг нь ТОДОРХОЙ хэвээр — `TEAM = UNCERTAIN` **БИШ** (§3.3-ын «багцгүй кодын дүрэм», `2-1` §3.4) | — |

**BA нь ЗАГВАР, зөвхөн эхний ажил БИШ.** BA-гийн багцын бүтэц (дүрмийн мөрийн хэлбэр, заалтын иш татлагын талбарууд, `rule_test_cases`-ийн зургаан заавал тохиолдол, `verification_state`-ийн шат) нь нөгөө долоогийн **бүтцийн гэрээ** болно. Тиймээс BA-г бичихдээ хийсэн бүтцийн шийдвэр бүрийг `2-2-rule-model` §3-д ил бичнэ — тэднийг дараа нь долоон удаа давтана.

⚠️ **ХУВААРИЙН ГОЛ ЭРСДЭЛ НЬ IZ.** BA нь хураах материалтай тул тооцоолж болно; IZ нь ТЭГЭЭС эхэлнэ, бөгөөд түүний оролт нь §9-3-ын албан ёсны БНбД баримтаас ШУУД хамаарна. IZ-ийн багц нь BA-гийнхаас **удаан** байх магадлалтай ба тэр хугацааг BA-гийн хурдаар БҮҮ тооц.

**v2 §46–§81-ийн бүрэн индекс** (§40–45, §82–84-ийг энэ баримт өөрөө хариуцна):

| v2 § | Сэдэв | Баримт |
|---|---|---|
| 46, 47, 48, 72, 73 | Олон багийн оюун ухаан, баг таних, буцаах боломж | `2-1-team-context` |
| 49, 50 | Баг-хамааралт AI зан төлөв ба сургалт | `2-2-rule-model` (дүрмийн хамрах хүрээ) + `2-6-team-training` (өгөгдлийн хамрах хүрээ) |
| 51, 52, 55, 56 | Идэвхгүй бодит цаг, нэмэгдлийн хөдөлгүүр, дебаунс, амьд төлөв | `2-3-compliance-engine` |
| 53, 54, 75, 76 | Гацалтгүй архитектур, доройтол, мэдэгдлийн ядаргаа | `2-4-nonblocking-runtime` |
| 57, 58, 68, 77 | Олдворын мөчлөг, хуучрал, override, үндсэн шалтгаан | `2-5-finding-surface` |
| 59, 60, 61, 62, 63, 64, 65, 67 | Бүрэн бус байдал, салбар хоорондын, хамаарал, нэгж, ирмэг, зөрчил, нотолгоо, ноцтой байдал | `2-2-rule-model` + `2-3-compliance-engine` |
| 66, 69, 70, 78, 79 | FP/FN, «хянахад бэлэн» хаалга, дүрмийн golden, сургалтын хамаарал, чадварын бүртгэл | `2-7-readiness-and-quality` |
| 71, 74, 80, 81 | Гар оролтгүй бүртгэл, суулгалт, эрх мэдлийн түвшин, хувьсал | `2-8-install-and-health` |

### 3.6 v2 §41 — арван гурван амжилтын шалгуур

| # | §41 шалгуур | Track 2-т төлөв |
|---|---|---|
| 1 | Existing Add-in functionality remains stable | Хариуцагч `2-4`. Дүрэм: COLD эгнээ нь `Gate.Wait(0)` — өрсөлдвөл ОРХИНО, хэрэглэгчийн `list_sheets` хэзээ ч блоклогдохгүй |
| 2 | Current fast operations remain fast | Хариуцагч `2-4`. HOT замын нэмэгдэл нь гүйлгээ тутам НЭГ ring бичилт, Revit API-ийн нэмэлт дуудлага ТЭГ |
| 3 | Local/private inference is possible | Аль хэдийн үнэн — intent классификатор офлайн, DLL дотор embedded. Дүрмийн үнэлэгч мөн локал |
| 4 | Regulatory data is versioned and traceable | `2-2`. **⚠️ §9-3-т блоклогдсон** — албан ёсны БНбД баримт олдоогүй байна |
| 5 | Human corrections are structured learning signals | `2-5` (`finding_overrides`) + `2-6` |
| 6 | Company knowledge is isolated | PARTIAL. Тенант тусгаарлалт бий; **баг тусгаарлалт `2-1`/`2-6`-д** |
| 7 | New models can be evaluated and rejected | PARTIAL — `0213:44` `eval_passed` бий, `2-7` нь дүрмийн хувилбарт өргөтгөнө |
| 8 | Revit AI actions are validated before execution | Track 2-т ХАМААРАХГҮЙ — LEVEL 0/1/2 нь юу ч ГҮЙЦЭТГЭХГҮЙ |
| 9 | Image/sketch uncertainty is explicit | Track 2-т ХАМААРАХГҮЙ (§81-ийн 7–8-р шат) |
| 10 | Regulatory results are source-traceable | `2-2`. `UNVERIFIED` дүрэм нь код ХЭЛЭХГҮЙ — «дотоод шалгуур (эх сурвалж баталгаажаагүй)» |
| 11 | Continuous learning is controlled and reversible | `2-6`. Хөлдөөсөн `verification_state`-аар хамаарал тодорхойлогдоно |
| 12 | Eventually support multiple companies | ХОЙШЛУУЛСАН. ⚠️ `company_id`-ийн шийдвэрийг 0217-оос ӨМНӨ авна (§9-8) |
| 13 | Eventually support multimodal Level-4 | ХОЙШЛУУЛСАН — §81 |

### 3.7 v2 §43 — хэрэгжүүлэхээс өмнөх есөн бүтээгдэхүүн

Эзний «continue implementing those things one by one» гэсэн заавар нь **§43:1520-ийн зөвшөөрөл** бөгөөд энэ хаалгыг онгойлгож байна. Гэвч ес нь тус бүр нэрлэгдэх ёстой:

| # | §43 бүтээгдэхүүн | Төлөв |
|---|---|---|
| 1 | Complete the architecture-freeze audit | **ДУУССАН** — Track 1A/1B/1C-ийн 14 сессийн баримт |
| 2 | Finalize the canonical event model | **ДУУССАН** — 0201–0210 + `bimEvents.ts` |
| 3 | Finalize the regulatory document/rule model | **ЭНЭ ТӨЛӨВЛӨГӨӨГӨӨР ГҮЙЦЭТГЭНЭ** — `2-2-rule-model`. ⚠️ Агуулга нь §9-3-т блоклогдсон |
| 4 | Finalize the trust/provenance model | **ХЭСЭГЧИЛСЭН** — 0212/0215 бий, ГЭВЧ `provenance` (6 утга) ↔ `source_type` (8 утга) САЛСАН. `2-3` нь `evidence_level`-ийг ГУРАВДАХЬ тэнхлэг болгож нэгтгэнэ |
| 5 | Finalize the Golden-Eval strategy | **ХЭСЭГЧИЛСЭН** — харш бий, `rules.json` хоосон. `2-7` |
| 6 | Finalize tenant/company isolation | **ХЭСЭГЧИЛСЭН** — `lib/tenants.ts`, `lib/modules.ts` бий; BIM хүснэгтэд `company_id` БАЙХГҮЙ. §9-8 |
| 7 | Finalize performance budgets | **ЭНЭ ТӨЛӨВЛӨГӨӨГӨӨР** — `2-4`. ⚠️ Бүх тоо УРЬДЧИЛСАН, хэмжсэн мөр ТЭГ (§9-7) |
| 8 | Finalize AI/Revit execution boundaries | **ДУУССАН** — HOT/BACKGROUND/COLD/REMOTE, `2-4`-д баталгаажна |
| 9 | Review and approve the implementation order | **ЭНЭ БАРИМТЫН §5** |

---

## 4. ХӨНДӨЖ БОЛОХГҮЙ (load-bearing)

### 4.1 v2 §44 — арван хоёр хэрэгжүүлэлтийн хамгаалалт

| # | §44 хамгаалалт | Track 2-ийн практик хэлбэр |
|---|---|---|
| 1 | Inspect the real repository first | §2-ийн `file:line` бүрийг нээж шалгана. Буруу мөрийн дугаар нь хүйтэн сессийг худал зам руу оруулна — иш татлагагүйгээс ДОР |
| 2 | State what currently exists | Сесс бүрийн §2 нь 180–390 мөр байна |
| 3 | State exactly what will change | Сесс бүрийн толгойд `Хөндөх файлууд` + `**ӨӨР ФАЙЛ БАЙХГҮЙ.**` |
| 4 | Make the smallest safe change | HOT зам нь гүйлгээ тутам НЭГ ring бичилт; `learning_events`-д бодит багана ТЭГ |
| 5 | Run relevant tests | `cd backend && npm test` (суурь 44/44), `node --test src/lib/migrationSchema.test.ts` ALTER бүрийн өмнө |
| 6 | Run build/static checks | `cd backend && npx tsc --noEmit`; `cd frontend && npm run verify` |
| 7 | Run integration tests where available | `node backend/scripts/check-bim-events.mjs` — `bim_sessions`/`learning_events` хөндсөн файл бүрийн ДАРАА |
| 8 | Measure performance where relevant | `%APPDATA%\RevitMcpAddin\timing.log`. **250 мс-ийг SLO болгож иш татахыг v2 §30 ХОРИГЛОНО** |
| 9 | Report all changes | `git status --short` + `git diff --stat` (§7-ийн scope блок) |
| 10 | Report assumptions | Батлаагүй зүйлийг **ТААМАГ** гэж тэмдэглээд §9 руу түлхэнэ |
| 11 | Report unresolved risks | Сесс бүрийн §9 |
| 12 | Do not silently modify unrelated systems | Даалгаврынхаа хамрах хүрээнээс ГАДНА файл засахгүй, засварлахгүй, буцаахгүй |

**§44-R13 ЗОГСОХ ДҮРЭМ (v2:1541):** сүйтгэх, эргэлт буцалтгүй, аюулгүй байдалд нөлөөлөх, эсвэл ойлгомжгүй зан төлөвтэй тулгарвал — **таамаглахгүй, тэр үйлдлийг ЗОГСООЖ, эрсдэлийг тайлбарлана.** Энэ дүрэм заавал ажиллах гурван тохиолдол: (a) `/api/*`-д `purpose:'mcp'`-г татгалзах ямар нэг өөрчлөлт; (b) `users` эсвэл `projects`-ийг `migrations apply`-аар дахин барих; (c) хэрэгжсэн migration файл засах.

### 4.2 Ес хатуу хориглолт — Track 2-ийн бүх баримтад ЗААВАЛ давтагдана

| # | Хориотой | Хаана (баталгаажсан) | Яагаад эвдрэх вэ |
|---|---|---|---|
| 1 | `/api/*`-д `purpose === 'mcp'` татгалзах | `backend/src/middleware/auth.ts:101-102` | ~20 PC, Install.bat, Revit хаалттай, refresh урсгал БАЙХГҮЙ. Алсаас засаж БОЛОХГҮЙ ЦОРЫН ГАНЦ өөрчлөлт |
| 2 | `users` (19 каскад) / `projects` (33 каскад)-ийг `migrations apply`-аар дахин барих | CLAUDE.md-ийн path-B гарын авлага | `migrations apply` нь гүйлгээнд ороодог бөгөөд каскад АЖИЛЛАНА — бүх хүүхэд мөр устана |
| 3 | Хэрэгжсэн migration засах | `ls backend/migrations \| tail -5` → `0216_assistant_log_timing.sql` | Продакшн дээр ЧИМЭЭГҮЙ NO-OP |
| 4 | Trigger дотор `end;` жижгээр | `backend/migrations/0206_bim_append_only.sql` — 8 trigger, бүгд `END;` томоор | wrangler-ийн задлагч регистрт мэдрэг; хагас хэрэгжсэн DB, засах цорын ганц арга нь ШИНЭ дугаар |
| 5 | Инференсийг итгэмжлэгдсэн замд | `revit-mcp/addin/ChangeTracker.cs:764-775` ⛔ гэрээ · `RevitToolBus.cs:442-454` ⛔ гэрээ | Revit-ийн мессежийн гогцоо гацна. Сольсон скайнер 120+ секунд авдаг байсан |
| 6 | `DocumentChanged` дотор гүйлгээ / `Regenerate()` / дискний бичилт / сүлжээ | `ChangeTracker.cs:764-775` | Revit тэнд баримтыг ЗӨВХӨН УНШИХ горимд барина |
| 7 | `ChangeTracker.Gate`-ийг tool bus дуудлага, дискний бичилт, эсвэл `await` дээгүүр барих | `ChangeTracker.cs:800` (`lock (Gate)` гүйлгээ тутам), `:570-572` («ДИСК БИЧИЛТ ТҮГЖЭЭНЭЭС ГАДНА») | Хэрэглэгчийн дараагийн хулганы чирэлт хэрэгслийн бүтэн хугацаагаар гацна |
| 8 | `DockablePane.Show()` дуудах | `revit-mcp/addin/AssistantPaneProvider.cs:54` — репо дахь ЦОРЫН ГАНЦ `Show()`, тэр нь хэрэглэгчийн ribbon товч | Файл нээх бүрд ~300px ба фокус хулгайлна. R7-ийн хамгийн магадлалтай регресс |
| 9 | `ChangeTracker.Gate` эсвэл tool-bus `Gate` барьж болох урсгалаас `Dispatcher.Invoke` | UI урсгал өөрөө `lock (Gate)`-д блоклогдож болно | Хоёр урсгалын deadlock — хэрэглэгчид Revit гацсан мэт харагдана |

**Нэмэлт: `ChangeTracker._flushTimer` дээр ЮУ Ч нэмэхгүй.** `ChangeTracker.cs:313` → `_flushTimer = new Timer(_ => FlushDirty(), null, FlushIntervalMs, FlushIntervalMs);` — энэ бол **үечилсэн** таймер. Өмнөх дуудлага дуусаагүй байхад дахин асна. Хоёр зэрэгцээ `FlushDirty` нь ижил `path + ".tmp"` (`:577`) руу бичих ба хоёр дахь `File.Move` нь залгидаг `catch` руу шидэгдэнэ; `Dirty.Clear()` (`:558`) аль хэдийн ажилласан тул тэр өөрчлөлтүүд **дискэнд ХЭЗЭЭ Ч хүрэхгүй**. Өнөөдөр callback нь миллисекунд тул давхцал болдоггүй; 2 секундын дүрмийн үнэлгээ эсвэл 20 секундын POST нь үүнийг ХЭВИЙН болгоно.

---

## 5. ДАРААЛАЛ БА ХАМААРАЛ

**Урьдчилсан нөхцөл:** байхгүй. Энэ баримт нь Track 2-ийн ЭХНИЙ файл.

### 5.1 Баримт бичих — БҮГД ЗЭРЭГ

```
                    2-0-OWNER-BRIEF  (энэ файл — ЭХЛЭЭД, ганцаараа)
                            │
        ┌──────────┬────────┼────────┬──────────┬──────────┬──────────┬──────────┐
        ▼          ▼        ▼        ▼          ▼          ▼          ▼          ▼
      2-1        2-2      2-3      2-4        2-5        2-6        2-7        2-8
   team-ctx  rule-model  engine  runtime   findings   training  readiness  install
        └──────────┴────────┴────────┴──────────┴──────────┴──────────┴──────────┘
                            БҮГД ЗЭРЭГ БИЧИГДЭНЭ
```

Найман сессийн баримт бүгд **зэрэг** бичигдэнэ, учир нь энэ файл нь хуваалцсан бүх гэрээг (R1–R7, §82-ийн бүртгэл, гурван тэнхлэг, багийн шат, migration-ы дугаарын блок) хадгалж байгаа тул зохиогчид бие биеэсээ хамаарахгүй. Эзний «lot of sub agents under you» нь ЯГ энэ.

### 5.2 Хэрэгжүүлэлт — ГУРВАН ДАВАЛГАА

| Давалгаа | Баримт | Яагаад энэ бүлэг вэ | Зэрэг ажиллах боломж |
|---|---|---|---|
| **1** | `2-1-team-context` (0217–0219) · `2-2-rule-model` (0220–0223) · `2-4-nonblocking-runtime` (0226–0228, +0230) · `2-8-install-and-health` (0241–0242) | Хамаарал БАЙХГҮЙ. Тус бүр нь өөрийн ШИНЭ хүснэгт/багана үүсгэнэ, бусдын гаралтыг УНШИХГҮЙ | **4 агент зэрэг** |
| **2** | `2-3-compliance-engine` (0224–0225, 0229) · `2-6-team-training` (0238–0240) | `2-3` нь `2-2`-ын дүрмийн загвар ба `2-1`-ийн багийн талбаруудыг ХЭРЭГЛЭНЭ. `2-6` нь `2-1`-ийн `team_code` рельс дээр явна | **2 агент зэрэг**, давалгаа 1 дууссаны ДАРАА |
| **3** | `2-5-finding-surface` (0237) · `2-7-readiness-and-quality` (migration БАЙХГҮЙ) | `2-5` нь `compliance_findings` дээр бичнэ (`2-3`). `2-7` нь 0222/0224/0225/0229/0237-ийг УНШИНА | **2 агент зэрэг**, давалгаа 2 дууссаны ДАРАА |

**Бүрэн зэрэгцүүлэлт нь БОЛОХГҮЙ:** `2-5` нь байхгүй `compliance_findings` хүснэгтийн эсрэг override барих байсан.

**✅ БАГЦЫН ХӨТӨЛБӨР НЬ ДАВАЛГААНААС ТУСДАА ЗАМ — ЭЗЭН БАТАЛСАН (2026-08-30).** Дээрх гурван давалгаа нь **бүтэц** (хүснэгт, хөдөлгүүр, гадаргуу) барина; **дүрмийн агуулга** нь §3.5-ын дарааллаар явна: **BA ЭХЛЭЭД БҮРЭН**, дараа нь IZ, дараа нь үлдсэн зургаа. Хоёр зам нь өөр өөр хурдтай ба хоёр өөр саадтай:

- **Бүтцийн зам** нь энэ репод дуусна — блоклогч БАЙХГҮЙ, давалгаа 1 өнөөдөр эхэлж чадна.
- **Багцын зам** нь §9-3-т **блоклогдсон** (албан ёсны БНбД баримт олдоогүй). Тиймээс давалгаа 1 нь **BA-гийн багц бэлэн болохыг ХҮЛЭЭХГҮЙ** — `2-2` нь дүрмийн загвар, схем, ачаалагчийг бичих ба BA-гийн жинхэнэ мөрүүд дараа нь **өгөгдлөөр** (migration БИШ, багц нийтлэлээр) ирнэ. Энэ бол §3.2-ийн «дүрэм нь эмхэтгэсэн C# биш, ӨГӨГДӨЛ» шийдвэрийн шууд ашиг: BA-гийн багц хожуу ирсэн ч DLL дахин суулгахгүй.
- **BA-гийн бүтцийн шийдвэрүүд нь `2-2`-т БИЧИГДЭНЭ, IZ хүлээхгүй.** IZ-ийн агуулга нь хамгийн урт хугацаа авах тул түүнийг замын шүүмжлэлт зам гэж тооцно (§3.5-ын эрсдэлийн тэмдэглэл).

### 5.3 Deploy дараалал — БҮХ сесс давтана

```
1.  npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml
        ↓  (шинэ багана ЭХЛЭЭД)
2.  npx wrangler deploy --config wrangler.toml
        ↓  (түүнийг уншдаг код ХОЁРДУГААРТ)
3.  (шаардлагатай бол) cd frontend && npm run build
        && npx -y wrangler@latest pages deploy dist --project-name mgl-design-system --branch main
        ↓
4.  Add-in (C#) — ГАНЦ хувилбар, ~20 PC, Install.bat, Revit хаалттай.  ХАМГИЙН СҮҮЛД
```

**Шинэ багана нь түүнийг уншдаг кодоос ХАТУУ ӨМНӨХ deploy-д гарна.** `--config wrangler.toml` нь ЗААВАЛ (репын үндэст байгаа `wrangler.jsonc` нь өөр worker зарладаг).

### 5.4 Дараа нь юу ирэх вэ

| Дараагийн зүйл | Энэ баримтаас юу авах вэ |
|---|---|
| `2-1` … `2-8` | R1–R7-ийн тайлал, §82-ийн бүртгэл, §3.5-ын матриц, ес хориглолт, migration-ы дугаарын блок |
| `docs/bim-ai/README.md`-ийн шинэчлэл | Track 2 мөр, хамаарлын диаграмын өргөтгөл |
| Release N+1 | LEVEL 1/2 руу дэвшилт — DLL БИШ, зөвхөн `app_settings` + багц нийтлэл. **Эхний жинхэнэ багц нь BA-гийнх** (ЭЗЭН БАТАЛСАН 2026-08-30, §3.5); IZ хоёрдугаарт, үлдсэн зургаа BA-гийн бүтцээр |

---

## 6. ХҮЛЭЭН АВАХ ШАЛГУУР

Энэ бол **эзэнд зориулсан** release N-ийн «дууссан» тодорхойлолт. Тэмдэглэгээ бүр нь ажиглаж болох зүйл.

### Release N — LEVEL 0 (OBSERVE)

- [ ] Add-in нь Revit 2024/2025/2026/2027-д суулгагдаж, Revit хэвийн нээгдэнэ; ШИНЭ модал цонх ГАРАХГҮЙ
- [ ] Суулгасны дараа өөрийгөө шалгах (self-check) нь дөрвөн хувилбар ДЭЭР Ч ногоон буцаана
- [ ] Ажлын нэг өдрийн дараа `bim_sessions` дээр тухайн ажилтны мөр бий, `dropped_count = 0`
- [ ] `learning_events` дээр `kind='SESSION_START'`, `'TXN'` төрлийн бодит мөр бий — **дэвтэр хоосон байхаа больсон** (R1)
- [ ] `GET /api/revit/team-context` нь BA-ийн ажилтанд `team_code='BA'` буцаана; хэрэглэгч юу ч сонгоогүй (R4)
- [ ] Багийн хамаарал тодорхойгүй үед pane дээр ганц блоклохгүй чип «Баг: тодорхойгүй» гарна — диалог БИШ, гацалт БИШ
- [ ] `bim.compliance.authority_level = '0'` — олдвор ХЭРЭГЛЭГЧИД ХАРАГДАХГҮЙ, гэвч canary дүрэм өдөр бүр ажиллаж, `rule_run_ledger` дээр мөр үлдээнэ
- [ ] `%APPDATA%\RevitMcpAddin\timing.log` дээр `Coalesce`, `RuleEval`, `InputCollect` гурван шинэ хуримтлагч ХООСОН БИШ
- [ ] Ажилтнаас «Revit удаан болсон уу?» гэж асуухад хариу нь «үгүй» (R7) — 30 хоногийн ажиглалт
- [ ] Сүлжээ тасарсан үед Revit ХЭВИЙН ажиллана; сүлжээ сэргэхэд дараалал өөрөө хоосорно
- [ ] `revit-mcp/dist/` дотор өмнөх сайн zip архивлагдсан — **буцах цэг БАЙНА** (өнөөдөр БАЙХГҮЙ, §9-6)

### LEVEL 2 (RECOMMEND) руу дэвших зам — DLL БАЙХГҮЙ

- [ ] Албан ёсны БНбД баримт олдож, `regulatory_documents` + `rule_clauses` дүүрсэн (§9-3)
- [ ] **BA-гийн багц нь ЭХНИЙ БҮРЭН багц болж дууссан** (ЭЗЭН БАТАЛСАН 2026-08-30) — дүрэм бүр нь заалт иш татсан, `verification_state` нь дор хаяж `CLAUSE_CITED`, дор хаяж НЭГ дүрэм `HUMAN_VERIFIED`, `rule_test_cases`-д зургаан заавал шалгах тохиолдол бичигдсэн
- [ ] **BA-гийн багцын БҮТЭЦ нь `2-2-rule-model` §3-д ил бичигдсэн** — нөгөө долоог түүгээр бичих гэрээ болно
- [ ] Дор хаяж нэг IZ дүрэм `HUMAN_VERIFIED` төлөвт хүрсэн. ⚠️ IZ-д хураах шаблон БАЙХГҮЙ (БНбД дурдлага ТЭГ) тул энэ мөр нь BA-гийнхаас **удаан** байхаар төлөвлөгдсөн — BA-гийн хурдаар БҮҮ тооц
- [ ] **Багцгүй код (MGMT, EZ, GT) бүхий сесс нь БОДИТ `team_code`-оо буцаана, `team_source` нь `'uncertain'` БИШ, `compliance_enabled === false`, `learning_events` нь тэр кодоор шошголсон** — өөр багийн дүрмээр ОРЛУУЛААГҮЙ (§3.3-ын багцгүй кодын дүрэм, `2-1` §3.4, §72, §82-4)
- [ ] `revit-mcp/eval/golden/rules.json` дээр мөр орж, `run_golden.py --kind rules` нь **exit 0**
- [ ] `bim.compliance.rollout_pct = '10'` — эхний жинхэнэ багц 1–2 машинд очно
- [ ] 7 хоногийн дараа `finding_overrides`-ийн худал эерэг хувь тогтвортой бол → `authority_level = '1'` (EXPLAIN)
- [ ] **`'1'` болсны ДАРАА** — хэрэглэгч ямар ч товч дараагүйгээр 20 минут зурахад ribbon-ийн гарчиг дээрх тоолуур ӨӨРЧЛӨГДСӨН байна (§3.4-ийн 2-р шалгуурын LEVEL 1 ажиглалт; LEVEL 0 дээр `surface: false` тул ГАРАХГҮЙ)
- [ ] Дахин 7 хоногийн дараа → `authority_level = '2'` (RECOMMEND), `rollout_pct = '100'`
- [ ] Бүх дэвшилт нь **нэг `app_settings` UPDATE + нэг багц нийтлэл**. Install.bat БАЙХГҮЙ, ~20 PC БАЙХГҮЙ

---

## 7. ШАЛГАХ КОМАНД

```bash
# --- 1. ЭНЭ ФАЙЛ БҮТЭЦТЭЙ ЭСЭХ ---
cd /Users/twissu/Desktop/company/MGL-ERP/mgl-e-c
grep -c '^## ' docs/bim-ai/2-0-OWNER-BRIEF.md
# Хүлээгдэх: 10

grep -n '^## ' docs/bim-ai/2-0-OWNER-BRIEF.md
# Хүлээгдэх: 0..9 дугаартай арван гарчиг, ЯГ энэ дарааллаар

# --- 2. ЭЗНИЙ ҮГ ҮГЧЛЭН БАЙГАА ЭСЭХ ---
grep -c 'Bi oilgomjgu helchlee' docs/bim-ai/2-0-OWNER-BRIEF.md
grep -c 'Minii huseltiig biyluuleed hurdan ajilladag bolgohoo martvaa' docs/bim-ai/2-0-OWNER-BRIEF.md
# Хүлээгдэх: 1 ба 1.  ТЭГ бол эзний үг алдагдсан — файл ХҮЧИНГҮЙ

# --- 3. §2-ЫН ИШ ТАТЛАГА БОДИТ ЭСЭХ ---
sed -n '55p;313p' revit-mcp/addin/ChangeTracker.cs
# Хүлээгдэх: FlushIntervalMs = 3000  ба  new Timer(_ => FlushDirty(), ...)

sed -n '232p' backend/src/lib/bimEvents.ts
# Хүлээгдэх: RULE_VALIDATION: ['RULE_VERDICT'],

sed -n '144p' backend/src/lib/bimEvents.ts
# Хүлээгдэх: export const DATASET_ELIGIBLE_SQL = 'parts_missing = 0';

sed -n '279p' backend/src/routes/learning.ts
# Хүлээгдэх: learning.post('/events', async (c) => {

sed -n '138p' backend/src/middleware/auth.ts
# Хүлээгдэх: export const requireManager = () => requireRole(...ADMIN_ROLES, 'senior');

grep -c 'CREATE TRIGGER' backend/migrations/0206_bim_append_only.sql
# Хүлээгдэх: 8

# --- 4. «ҮЙЛДВЭРЛЭГЧГҮЙ ДЭВТЭР» БАТАЛГАА ---
grep -rn "api/learning" revit-mcp/addin/ | wc -l
grep -rn "session_uid" revit-mcp/addin/ --exclude-dir=Resources | wc -l
ls revit-mcp/addin/*.cs | wc -l
# Хүлээгдэх: 0, 0, 46

# --- 5. «БАГ МЭДЭХГҮЙ» БАТАЛГАА ---
grep -ci team backend/migrations/020*.sql backend/migrations/021*.sql
# Хүлээгдэх: 17 файл бүр дээр 0

grep -rni "team" revit-mcp/addin/ --exclude-dir=Resources | wc -l
# Хүлээгдэх: 0

# --- 5b. РОСТЕР — ЭЗЭН БАТАЛСАН НАЙМ (2026-08-30) ---
sed -n '52,61p' frontend/src/features/projects/team-reports/TeamReportsTab.tsx
# Хүлээгдэх: IMPLEMENTED_TEAMS = BA, BB, HAS, TSBU, TSAH, HD, AU, IZ  (ЯГ 8)
# Энэ бол эзний баталсан ростер.  Багц авах салбарууд нь ЯГ ЭНЭ ОЛОНЛОГ.

sed -n '39,47p' backend/migrations/0007_teams.sql; sed -n '12,14p' backend/migrations/0074_seed_ez_gt_teams.sql
# Хүлээгдэх: 0007 → 9 мөр (баталсан 8 + MGMT), 0074 → +EZ, +GT  = `teams`-д АРВАН НЭГ
# MGMT, EZ, GT нь багц ХЭЗЭЭ Ч авахгүй → шалгалт алгасагдана, ГЭВЧ баг нь тодорхой
# хэвээр — TEAM = UNCERTAIN БИШ (§3.3, `2-1` §3.4)

grep -rho "БНбД" frontend/src/features/projects/team-reports/ba/ | wc -l
# Хүлээгдэх: 12   (types.ts 7 + template.ts 3 + BaDocument.tsx 2 + BaPanel.tsx 0)
# → BA нь ЭХНИЙ бүрэн багц болох шалтгаан (§3.5)

grep -c "БНбД" frontend/src/features/projects/team-reports/iz/template.ts
# Хүлээгдэх: 0  → IZ-ийн багцыг ШИНЭЭР зохионо, хураахгүй

# --- 6. ХООСОН GOLDEN ХУВААРЬ ---
python3 -c "import json;print(len(json.load(open('revit-mcp/eval/golden/rules.json'))['rows']))"
# Хүлээгдэх: 0   (энэ нь ХАТУУ БЛОК — run_golden.py:356 sys.exit(2))

# --- 7. MIGRATION-ЫН СҮҮЛ (сесс бүрийн өмнө ДАХИН ажиллуулна) ---
ls backend/migrations | tail -5
# Хүлээгдэх (2026-08-30): ...0216_assistant_log_timing.sql
# ⚠️ Зэрэгцээ агентууд дугаар авч байгаа тул ЭНЭ ТООГ ИТГЭЛТЭЙ БҮҮ АВ

# --- 8. БУЦАХ ЦЭГ БАЙГАА ЭСЭХ (өнөөдөр БАЙХГҮЙ) ---
ls -d revit-mcp/dist 2>&1
# Хүлээгдэх ӨНӨӨДӨР: No such file or directory  → §9-6-ын блок

# --- 9. SCOPE ХЯНАЛТ ---
git status --short
git diff --stat
# Зөвшөөрөгдсөн ЦОРЫН ГАНЦ өөрчлөлт:
#   docs/bim-ai/2-0-OWNER-BRIEF.md   (шинэ файл)
# Өөр ЯМАР Ч файл өөрчлөгдсөн бол ЗОГС — өөр агентын ажил байна.
# git add -A БҮҮ хэрэглэ — файлыг нэрээр нь нэм.
```

---

## 8. ROLLBACK

| Юу буцаах | Хэрхэн |
|---|---|
| Энэ баримт | `rm docs/bim-ai/2-0-OWNER-BRIEF.md` — эсвэл өөрийн commit-оо `git revert` |
| Migration | **Migration ШААРДЛАГАГҮЙ.** Энэ сессид SQL БАЙХГҮЙ |
| Worker / Frontend / Add-in | **Deploy ХИЙГДЭЭГҮЙ.** Буцаах юу ч байхгүй |
| Edge cache | Хамаарахгүй — HTTP гадаргуу хөндөгдөөгүй |

**Өгөгдлийн эрсдэл: ТЭГ.** Энэ файл нь зөвхөн `.md` бөгөөд ямар ч ажиллах кодоос уншигддаггүй.

**Rollback-ийн шалгуур:** Энэ баримтыг зөвхөн ДАРААХ тохиолдолд буцаана — (a) эзэн R1–R7-ийн тайлал нь түүний санааг буруу илэрхийлсэн гэж хэлсэн; (b) §9-ийн блоклогч асуултын хариу нь §3.1-ийн хамрах хүрээг үндсээр нь өөрчилсөн; (c) v2 freeze өөрөө шинэчлэгдсэн. Аль ч тохиолдолд **буцаахаас илүү зөв нь ЗАСАХ** — учир нь `2-1` … `2-8` бүгд энэ файлыг иш татна, устгавал тэдгээр нь эх сурвалжгүй үлдэнэ.

**✅ (b)-ГИЙН ЖИШЭЭ 2026-08-30-НД ҮНЭХЭЭР ТОХИОЛДОВ — БУЦААГААГҮЙ, ЗАСАВ.** Энэ мөр өмнө нь «жишээ нь «долоон баг» нь үнэндээ өөр найман код байсан» гэсэн **таамаг** триггерийг агуулж байсан. Тэр яг тохиолдов: эзэн §9-1/§9-2-т хариулж, ростер нь **найман салбар** (BA · BB · HAS · TSBU · TSAH · HD · AU · IZ, MGMT хассан) гэдгийг баталлаа. Дээрх дүрмийн дагуу баримт **буцаагдаагүй** — §0, §1.2-3, §1.3-ийн R3/R5/R6, §2.2, §3.3, §3.5, §5.2, §5.4, §6, §9 засагдав, дугаарлалт хэвээр үлдэв. **Энэ бол «буцаахаас илүү зөв нь ЗАСАХ» дүрмийн ажилласан анхны тохиолдол** бөгөөд цаашид ижил төрлийн ростерын өөрчлөлт (9 дэх салбар нэмэгдэх, багууд нийлэх) ижил замаар — засварын PR-аар, буцаалтаар БИШ — явна.

**⚠️ ЭНЭ ФАЙЛЫГ ЗАСАХ НЬ ДАВХАР ҮҮРЭГТЭЙ.** R1–R7-ийн тайлал эсвэл §82-ийн бүртгэлийг өөрчилвөл, түүнийг иш татсан бүх сессийн баримтыг ИЖИЛ PR-д шалгана. Хос файлууд хоорондоо салсныг барих тест БАЙХГҮЙ.

**⚠️ 2026-08-30-НЫ ЗАСВАРЫН ҮЛДЭГДЭЛ — ДАРААХ МӨРҮҮД ХУУЧИН (ХҮЧИНГҮЙ) ДУГААРЛАЛТЫГ ХЭВЭЭР АВЧ ЯВНА.** §3.5-ын хуваарилалт нь `README.md`-ийн индекстэй нийцсэн; доорхи ах дүү баримтууд нь ЭНЭ ФАЙЛААС ЗАСАГДААГҮЙ (нэг сесс = нэг файл). Хэрэгжүүлэгч тус бүрийн зохиогч ижил PR-д засна:

| Файл | Хуучирсан иш татлага | Юу байх ёстой |
|---|---|---|
| `2-1-team-context.md` | :249, :377 «2-4-ийн `0232`» · :862 «0232-ын дараа 32 bind» · :866 «`project_build_context` (0226)» · :1147 «0221-0227 / 0232-0236» · :1151 «2-4-ийн 0232» | `2-4`-ийн perf багана нь **0226**; `project_build_context` нь **0223**; блокууд нь 0220–0223 / 0226–0228 |
| `2-3-compliance-engine.md` | :310-ийн «Нөөцлөлтийн зөрүү» догол мөр · §9 №1 (:1464) · §9 №2 (:1465) | Зөрүү ХААГДСАН: `2-3` = **0224, 0225, 0229**; `rule_run_ledger` нь `2-3`-ынх. Гурвуулаа устгагдана, §3.0-д 0229 зарлагдана |
| `2-4-nonblocking-runtime.md` | §10-ийн сүүлийн мөр «Context pack-ийн 2-р хувилбар нь 2-4-т 0232-0236-г оноосон» | Зөрүү ХААГДСАН: `2-4` = **0226, 0227, 0228 + 0230** (`authority_level`, `rollout_pct`) |
| `2-5-finding-surface.md` | :322, :324 «0228–0231 нь 2-3-ынх», «0229-ыг `finding_elements_teams`-д өгсөн» · :1282 «`compliance_findings` (0228)» · :1283 «`finding_edges` (0230)» · :1317, :1441, :1561, :1575 «0228–0231» · :1576 «`2-4`-ийн 0235» | `compliance_findings` = **0224**, `finding_edges` = **0225**, `rule_run_ledger` = **0229**, `authority_level` = **0230** |
| **БҮХ Track 2 баримт** | «7 баг» · «долоон баг» · «7 teams» · «ростер нь ТОДОРХОЙГҮЙ» · «ХЭН Ч ТААРАХГҮЙ» гэсэн бичвэр бүр | **ЭЗЭН БАТАЛСАН (2026-08-30): НАЙМАН салбарын баг** — BA · BB · HAS · TSBU · TSAH · HD · AU · IZ; MGMT · EZ · GT нь багц авахгүй (v2 §46, энэ файлын §1.3-R3, §2.2, §3.3, §9-1/§9-2/§9-17). §1.1-ийн эзний ҮГЧЛЭН бичвэр дэх «7 teams» нь **эх сурвалж** — түүнийг ХЭЗЭЭ Ч засахгүй, зөвхөн тайлалыг нь засна |

---

## 9. ЭХЛЭХИЙН ӨМНӨ ТОДРУУЛАХ

> Эдгээрийг репогоос ХАРИУЛАХ БОЛОМЖГҮЙ — эзэн эсвэл продакшны асуулга шаардана.
> Энэ бол Track 2-ийн ХАМГИЙН ЧУХАЛ хэсэг.
>
> **ТӨЛӨВ (2026-08-30):** №1, №2 ба №17 нь **ХААГДСАН** — эзэн ростерыг баталсан (найм; MGMT · EZ · GT нь багц авахгүй). Үлдсэн БЛОКЛОГЧ нь **№3 ба №4**.
>
> ⚠️ **ДУГААР ХЭЗЭЭ Ч ДАХИН АШИГЛАГДАХГҮЙ, ХЭЗЭЭ Ч ШИЛЖИХГҮЙ.** Ах дүү баримтууд асуултыг дугаараар нь иш татдаг (`§9-1`, `§9-2`, `§9-3` …), тиймээс хаагдсан асуултыг **УСТГАХГҮЙ** — хариу нь мөрөндөө үлдэж, аудитын мөр хадгалагдана. Шинэ асуулт нь ҮРГЭЛЖ дараагийн чөлөөт дугаарыг авна.

### 9.1 БЛОКЛОГЧ — эзний шийдвэр эсвэл продакшны асуулга шаардана

| # | Асуулт | Яагаад чухал | Хэрхэн олох |
|---|---|---|---|
| **1** | ✅ **ХААГДСАН 2026-08-30 — АМЬД БАГИЙН ЖАГСААЛТ ЮУ ВЭ?** **ЭЗЭН БАТАЛСАН: НАЙМАН салбарын баг** — «MGMT-ийг хасаад үлдсэн 8-н багийг оруулна», өөрөөр хэлбэл `teams.sort_order`-оор **BA · BB · HAS · TSBU · TSAH · HD · AU · IZ**. (Асуулт нь: migration 11 код суулгадаг — `0007:39-47` → 9, `0074:12-14` → +EZ, GT; v2 §46 нь тэр үед «7 teams» гэж бичсэн; шипсэн UI `TeamReportsTab.tsx:52-61` нь 8) | **ЮУГ ШИЙДЭВ:** дүрмийн багц **найм** зохионо; `Team checks: n/n` нь ТӨСӨЛ дээрх багцтай багуудыг тоолно (литерал 8 БИШ); шипсэн UI нь зөв, `projectCategories.ts:35` ба `docHelpers.ts:4` нь хоцрогдсон; v2 §46 нь ЭНЭ ӨДӨР засагдав — гарчиг нь одоо «MULTI-TEAM INTELLIGENCE — 8 DISCIPLINE TEAMS». ⚠️ §46-г **ХЭСГЭЭР** иш тат, МӨРӨӨР БИШ: тэр хэсэг дахин бичигдсэн тул хуучин мөрийн дугаарууд хүчингүй. ⚠️ **ХЭВЭЭР ХҮЧИНТЭЙ:** тоог ХЭЗЭЭ Ч литералаар бичихгүй — ростер өөрчлөгдөж БОЛНО, салбарын олонлогийг `teams.code`-оос ажиллах үед унших. ⚠️ **БАГИЙН ГИШҮҮДИЙН ТОО ХЭВЭЭР БАТАЛГААЖААГҮЙ** — продакшны D1 хүрэхгүй (Cloudflare API error **7403 not authorized**); зөвхөн РОСТЕР шийдэгдсэн | Ростер: **эзэн, 2026-08-30 (ХАРИУЛСАН)**. Гишүүдийн тоо ХЭВЭЭР нээлттэй: `npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml --command "SELECT code, name_mn, sort_order FROM teams ORDER BY sort_order"` ба `SELECT t.code, COUNT(*) FROM user_teams ut JOIN teams t ON t.id=ut.team_id JOIN users u ON u.id=ut.user_id WHERE u.status='active' AND ut.is_primary=1 GROUP BY t.code` |
| **2** | ✅ **ХААГДСАН 2026-08-30 — IZ нь багуудын НЭГ мөн үү? AU ЯАХ ВЭ?** **ЭЗЭН БАТАЛСАН: ХОЁУЛАА ТИЙМ.** Баталсан найм нь IZ ба AU ХОЁУЛАНГ агуулна. Мөн **ЭЗЭН BA-г ЭХНИЙ бүрэн дүрмийн багц болгож сонгов**; IZ нь эзний дараалалд ХОЁРДУГААРТ (R6-д ӨӨРӨӨ нэрлэсэн). (Асуулт нь: `projectCategories.ts:35` `AZ_TEAMS` нь IZ-гүй ДОЛОО; `docHelpers.ts:4` нь «Бүх 7 баг»; `TeamReportsTab.tsx:52-61` нь IZ-тэй НАЙМ) | **ЮУГ ШИЙДЭВ:** багцын дараалал = **BA → IZ → BB · HAS · TSBU · TSAH · HD · AU** (§3.5). BA нь бүтцийн ЗАГВАР — `ba/` нь 12 «БНбД» дурдлага, найман ялгаатай кодтой, аль ч салбарынхаас ИХ. ⚠️ **ХЭВЭЭР ХҮЧИНТЭЙ ЭРСДЭЛ:** IZ-д нэг ч `norms_*` тэмдэглэгээ, нэг ч «БНбД» дурдлага БАЙХГҮЙ (нөгөө 7-д `norms_*` нийт 57) — IZ-ийн багцыг **норм каталогоос шинээр зохионо**, шаблоноос хураахгүй. Энэ бол багцын хөтөлбөрийн ГОЛ хуваарийн эрсдэл | **Эзэн, 2026-08-30 (ХАРИУЛСАН).** MGMT/EZ/GT-ийн тухай үлдсэн хэсэг нь ШИНЭ **№17** болж тусгаарлагдав |
| **3** | **АЛБАН ЁСНЫ БНбД БАРИМТЫГ ХЭН, АЛЬ ХЭВЛЭЛЭЭР НЬ ОЛЖ ИРЭХ ВЭ?** Репод БНбД-ийн PDF корпус БАЙХГҮЙ. `norm_items` (`0120:19-27`) нь код+гарчиг ЗӨВХӨН — заалт, хуудас, хэвлэл, хүчин төгөлдөр огноо АЛГА. `revit-mcp/CLAUDE.md:7-11` өөрийнхөө тоонуудыг «design-guidance … verify each number against the current official БНбД / MNS» гэж хэлнэ. `eval/golden/rules.json` нь мөрөө хөлдөөхийг ШУУД хориглоно | Үүнгүйгээр §40-R3-ын долоон нотолгооны талбар бөглөгдөхгүй, `run_golden.py --kind rules` нь ҮРГЭЛЖ exit 2, бөгөөд §4.1-ийн заалтаар **ямар ч дүрэм код ХЭЛЖ ЧАДАХГҮЙ** — бүтээгдэхүүн зөвхөн «дотоод шалгуур» гэж хэлнэ. **Энэ бол инженерийн ажил БИШ, баримт олж ирэх ажил, ЭЗЭНГҮЙ, ХУВААРЬГҮЙ.** R2/R5/R6-ийн эгзэгтэй зам | Эзэн эсвэл гадаад тал: mcis.gov.mn-ээс БНбД 31-17-10, 31-03, 21-01-02, 21-02-02, БД 21-102-12, БНОД 22-01-21, БНбД 35-01-22 гэх мэт баримтын **албан ёсны, хүчин төгөлдөр хэвлэлийг** олж ирэх |
| **4** | **АЖИЛТНЫ МЭДЭГДЭЛ, ГЭРЭЭ ҮНЭХЭЭР ШИНЭЧЛЭГДСЭН ҮҮ?** Commit `9fe82a0` нь 0195-ийн «геометр, файлын агуулга цуглуулахгүй» амлалтыг эзний шийдвэрээр ЦУЦАЛСАН бөгөөд «Ажилтны мэдэгдэл, гэрээ ЗААВАЛ шинэчлэгдэнэ» гэж бичсэн. `bim.capture.notice_version` нь `'2026-09-01'` — ИРЭЭДҮЙН огноо | Олдвор нь элементийн ID, өрөөний нэр, хэмжээ агуулна; RawRing нь гүйлгээ тутам түүвэрлэсэн ID нэмнэ; §3.3-ын оролцогч танилт нь Windows SID-ийн hash ба Revit хэрэглэгчийн нэр нэмнэ. Энэ нь үйл явдлын дэвтрээс ЧАНД ИЛҮҮ | Эзэн. Хууль зүйн урьдчилсан нөхцөл, тохь тух биш |
| **17** | ✅ **ХААГДСАН 2026-08-30 — MGMT, EZ, GT-ИЙГ ЯАХ ВЭ?** **ЭЗЭН БАТАЛСАН: тэд дүрмийн багц АВАХГҮЙ.** Баталсан найм нь **BA · BB · HAS · TSBU · TSAH · HD · AU · IZ**; `teams` дэх үлдсэн гурав тэрхүү наймын ГАДНА үлдэнэ. ⚠️ **ҮНЭНЧ НЮАНС (тэмдэглэл, БЛОКЛОГЧ БИШ):** эзэнд `0007_teams.sql`-ийн ЕСӨН мөрийг үзүүлж, тэр «MGMT-ийг хасаад үлдсэн 8» гэж хариулсан. `0074_seed_ez_gt_teams.sql:12-14`-ээр ДАРАА нэмэгдсэн **EZ (Эскиз зураг)** ба **GT (Гадна тохижилт)** нь тэр жагсаалтад байгаагүй тул эзэнд НЭРЛЭЖ тавигдаагүй — тэд наймын гадна үлдэх нь **байгуулалтаар** гарсан дүгнэлт, шууд хариултаар БИШ. Хоёулаа блокийн угтвар / төслийн тохируулгад сонгогддог баг бөгөөд инженерийн салбар БИШ тул дүгнэлт зогсож байна | **ЮУГ ШИЙДЭВ: (a)** MGMT, EZ, GT нь дүрмийн багц авахгүй — §2.2-ын 1-р үр дагавар, §3.3-ын «багцгүй кодын дүрэм», §3.5-ын «ХЭЗЭЭ Ч» мөр нь ТААМАГ БАЙХАА БОЛЬЖ, эзний баталсан төлөв болов. **(b)** Багцгүй код шийдэгдвэл: `team_code` нь **БОДИТ код**, `team_source` нь шатны бодит эх сурвалж, `team_confidence` нь шатны бодит утга, `learning_events` нь тэр кодоор ШОШГОЛОГДОНО (§72), чип нь «Баг: EZ (дүрмийн багцгүй)». Энэ нь **`TEAM = UNCERTAIN` БИШ** (`2-1-team-context` §3.4-ийн харьцуулах хүснэгт) — хэрэглэгчээс ЮУ Ч ШААРДАХГҮЙ. Зөвхөн нийцлийн шалгалт АЛГАСАГДАНА (`complianceEnabled` → `false`), олдвор ТЭГ, өөр багийн дүрмээр ХЭЗЭЭ Ч ОРЛУУЛАХГҮЙ (§48-R6, §82-4) | **Эзэн, 2026-08-30 (ХАРИУЛСАН).** Хэрэв эзэн хожим EZ эсвэл GT-д багц ХҮСВЭЛ, багцын тоо 8-аас 9/10 болж §3.5-ын дараалал уртсана — тэр нь багцын бүртгэлд нэмэгдэх мөр, кодын өөрчлөлт БИШ (⚠️ найм нь ТӨЛӨВЛӨЛТИЙН тоо). ⚠️ «Багц алга бол BA-гийн дүрмийг хэрэглэе» гэсэн хариу нь §82-4-ийг ЭВДЭНЭ — тэр тохиолдолд §44-R13-ын ЗОГСОХ дүрэм ажиллана |

### 9.2 Техникийн — прод/алсын D1 дээр л шалгагдана

| # | Асуулт | Яагаад чухал |
|---|---|---|
| **5** | **0212–0216 migration-ууд продакшн дээр ҮНЭХЭЭР ХЭРЭГЖСЭН ҮҮ?** — **ТААМАГ**, хэмжигдээгүй | Хэрэв үгүй бол add-in нь `addin_version`, `timing_json`-г БАЙХГҮЙ багана руу бичиж байна. `npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml --command "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 20"` |
| **6** | **БУЦАХ ЦЭГ БАЙХГҮЙ.** `ls -d revit-mcp/dist` → `No such file or directory`; `revit-mcp/addin/bin` мөн байхгүй; `dist/` нь gitignore-той | 1C §8 нь 2026-08-24-ний zip-үүдийг буцах цэг гэж нэрлэдэг — тэдгээр нь ОРШИХГҮЙ. **Эхний муу хувилбар өнөөдөр сэргээгдэхгүй.** Тараахаас ӨМНӨ архив үүсгэх ёстой |
| **7** | **ҮЙЛ ЯВДЛЫН ХУРДЫГ ХЭН Ч ХЭМЖЭЭГҮЙ.** 1B-1 §9 нь инженер тутам өдөрт 40–200 гэдгийг ИЛЭРХИЙ ТААМАГ гэж бичсэн | `settle_ms=1200`, `max_defer_ms=15000`, `raw_ring_max=4000`, `max_elements_per_set=2000` — 0228-ийн дөрвөн тоо бүгд энэ таамаг дээр тогтоно. Багажилсан НЭГ өдөр (`%APPDATA%\RevitMcpAddin\timing.log`) шийднэ |

### 9.3 Эзний шийдвэр — инженерийн биш

| # | Асуулт | Бидний санал | Юуг өөрчилнө |
|---|---|---|---|
| **8** | `bim_sessions` дээр `company_id` ОДОО нэмэх үү? v2 §72 нь зургаан нэгдүгээр зэргийн талбарын дунд нэрлэсэн | ⚠️ **ҮНЭГҮЙ БАЙХАА БОЛЬСОН** — `bim_sessions` нь 32 bind дээр байх бөгөөд ЗУРГААДАХЬ бодит багана нь мөр/statement-ийг 3-аас 2 болгож бууруулна. `session_meta_json` дотор GENERATED VIRTUAL-аар л явна, тэгвэл тенант түлхүүр болж индексжүүлэгдэхгүй | **0217 гарахаас ӨМНӨ шийднэ.** Append-only хүснэгтэд дараа нэмэх нь БОЛОМЖГҮЙ |
| **9** | ЗӨРЧЛИЙН ДҮРЭМ зөв үү? Түвшин 1 (холбоос) BA гэж хэлээд түвшин 3 (үндсэн баг) IZ гэвэл → `UNCERTAIN` | §48-R6 «do not silently apply the wrong team's rules». `AssistantPane.xaml.cs:246-253` нь нэг .rvt-г хэд хэдэн салбарын инженер хуваалцдагийг тэмдэглэсэн | Батлах, эсвэл аль тал ялахыг зааж өгөх |
| **10** | Гараар багаа засах нь БАРИМТ ТУТАМ наалдацтай байх уу (`revit_documents.team_code` бичих), эсвэл зөвхөн СЕСС тутам уу? | Наалдацтай нь хамаагүй тав тухтай, гэвч нэг инженерийн засвар нь тэр хуваалцсан .rvt дээрх БУСДЫН сессийн үр дүнг өөрчилнө | `2-1`-ийн зан төлөв |
| **11** | Хэрэглэгч ГИШҮҮН БИШ багаа сонгож болох уу? | Бид `POST /team-context/verify`-г `user_teams` гишүүнчлэл ЭСВЭЛ `isManager` дээр таглана; өөрөөр бол §82-4 (ТЭГ алдагдал) эвдэрнэ | Хамгаалалтын хатуулаг |
| **12** | **Хуваалцсан ажлын станцыг яах вэ?** `identity_match='mismatch'` үед бид `UNCERTAIN` болгоно — аюулгүй ч гэсэн жинхэнэ хуваалцсан BIM машин ямар ч багц ачаалж чадахгүй болно | Revit эхлэхэд «хэн гар дээр байна» гэсэн нэг асуулт зөвшөөрөгдөх үү? Хэрэв тийм бол §71-R2-ийн ТАВАН зөвшөөрөгдсөн диалогийн жагсаалтад багтах уу, эсвэл зургаа дахь нь болох уу? | `2-1` + R7-ийн тайлал |
| **13** | **Release N-д PUSH ТЭГ байх нь хүлээн зөвшөөрөгдөх үү?** Бид зөвхөн ribbon товчны гарчиг дээр тоолуур гаргана; toast, nudge, web push БАЙХГҮЙ | R2/R6-ийн «immediately states», «realtime» гэдгийг идэвхтэй мэдэгдэл гэж унших боломжтой. `Nudges.cs`-ийн толгой өөрөө «өдөрт 8 удаа дуугарвал хүмүүс add-in-ээ унтраадаг» гэж бичсэн — тэр нь R7 үгчлэн | Батлах, эсвэл release N+1-д нэг nudge суваг нэмэхийг зөвшөөрөх |
| **14** | Шөнийн бүтэн төслийн скан хэрэгтэй юу, аль машин дээр? | `BatchQto` нь хараа хяналтгүй хостыг АЛЬ ХЭДИЙН өгдөг. Release N нь тэнд compliance-ийг ЗОРИУД унтраана | Хуваарь ба хамаарлын шийдвэр |
| **15** | Ажилтнууд суулгагчийг ӨӨРСДӨӨ татаж болох уу? | `backend/src/routes/revitAddin.ts:9` → `const OWNER_ID = 1;`, `:21` → `if (!user \|\| user.sub !== OWNER_ID)`. Гурван файлын өөрчлөлт | R1-ийн тараалт гараар зөөх эсвэл өөрөө үйлчлэх байх ялгаа |
| **16** | **Код гарын үсэг (code signing)** — гэрчилгээ авах уу, эсвэл гарын үсэггүй байдал байнгын хийдэл гэж хүлээн зөвшөөрөх үү? | §74-ийн SIGN/VERIFY шат гэрчилгээгүйгээр хаагдахгүй. `pack_sha256` нь **дүрмийн багцыг** хамгаална, DLL-ийг БИШ | `2-8` |

### Хавсралт — энэ баримт ЮУГ БАТАЛГААЖУУЛААГҮЙ ВЭ

| Мэдэгдэл | Төлөв |
|---|---|
| Салбарын багийн РОСТЕР (аль кодууд багц авах вэ) | ✅ **ЭЗЭН БАТАЛСАН 2026-08-30** — найм: BA · BB · HAS · TSBU · TSAH · HD · AU · IZ (§9-1 ХААГДСАН). Кодоос БИШ, эзнээс шийдэгдсэн |
| Продакшны `teams` хүснэгтийн БОДИТ мөрүүд | **ТААМАГ** — D1 хүрэхгүй (Cloudflare 7403). Migration-аас 11 мөр таамаглаж байна (9 + EZ + GT); эзний баталсан найм нь тэдгээрийн ДЭД ОЛОНЛОГ |
| Баг тус бүрийн ГИШҮҮДИЙН ТОО | **ХЭМЖИГДЭЭГҮЙ** — D1 хүрэхгүй (Cloudflare 7403). Ростер шийдэгдсэн ч `user_teams … is_primary = 1`-ийн тоо ХЭВЭЭР баталгаажаагүй (§9-1) |
| EZ, GT, MGMT багц авах эсэх | ✅ **ЭЗЭН БАТАЛСАН 2026-08-30 — АВАХГҮЙ** (§9-17 ХААГДСАН). ⚠️ Нюанс: эзэнд `0007`-ийн ЕСӨН мөр үзүүлэгдсэн тул EZ/GT нь НЭРЛЭГДЭЖ асуугдаагүй — тэд баталсан наймын гадна үлдэх нь байгуулалтаар гарсан дүгнэлт |
| 0201–0216 продакшн дээр хэрэгжсэн эсэх | **ТААМАГ** — D1 хүрэхгүй |
| `learning_events`, `bim_sessions` дахь мөрийн тоо | **ТААМАГ** — D1 хүрэхгүй. §2.1-ийн «хоосон дэвтэр» дүгнэлт нь ҮЙЛДВЭРЛЭГЧ БАЙХГҮЙГЭЭС гарсан бөгөөд мөр тоолсноос БИШ |
| Инженер тутмын өдрийн үйл явдлын хурд | **ХЭМЖИГДЭЭГҮЙ** — 1B-1 §9 өөрөө «ХЭН Ч ХЭМЖЭЭГҮЙ» гэж бичсэн |
| Латентын бүх төсөв (`settle_ms`, `RuleEval` p95, гэх мэт) | **УРЬДЧИЛСАН.** Хэмжсэн мөр ТЭГ. 250 мс-ийг SLO болгож иш татахыг v2 §30 ХОРИГЛОНО |
| Бодит MGL төслүүд дэх `AreaVolumeSettings` утга | **ХЭМЖИГДЭЭГҮЙ** — `2-2`-ийн блоклогч асуулт |
| MGL загварууд дахь суурь түвшний нэршлийн конвенц | **ХЭМЖИГДЭЭГҮЙ** — `2-2`-ийн блоклогч асуулт |
