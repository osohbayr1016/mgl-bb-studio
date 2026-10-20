# 2-8-install-and-health — тэг-алдаатай суулгалт, манифест/хэш/өөрийн шалгалт/эрүүл мэнд, хувилбарын нийцэл, буцаалт

> **Track:** 2 · INSTALL & HEALTH (эзний шаардлага **R1** — «make my Revit AI addin ready for installing»)
> **v2 хэсэг:** §74 (БҮХЭЛДЭЭ — есөн шат, клиентийн таван хувилбар, нийцгүй хувилбарын зан), §75-ийн **суулгалт/хувилбарын тал** (гурван шатлалт нөөц ачаалалт, офлайн дараалал). §80-ийн клиент тал (`authority_level`-ийг эрүүл мэндийн тайланд оруулах).
> **Хамаарал (depends on):** Схемийн түвшинд **БАЙХГҮЙ** — 0241/0242 нь ямар ч Track 2 хүснэгтээс хамаарахгүй. Зөвхөн **талбарын НЭР** зээлнэ: `BuildInfo.SelfCheck()`-ийн `ruleset_version` / `pack_sha256` хоёрыг **`2-2-rule-model`**-ээс (`revit-mcp/addin/RulePack.cs` нь ТҮҮНИЙ хөндөх файлын жагсаалтад байна; `rule_pack_versions` мөн тэнд), `authority_level`-ыг **`2-4-nonblocking-runtime`**-ээс (`0230_compliance_authority.sql`-ийн `app_settings['bim.compliance.authority_level']` түлхүүр ба түүнийг клиент рүү дамжуулах суваг; нэрийн жагсаалт `AUTHORITY_LEVELS` нь `2-5-finding-surface`-ынх). Тэр гурав хараахан бичигдээгүй бол `null` илгээнэ — блоклохгүй.
> **Блоклож буй (blocks):** **ТУХАЙН НЭГ add-in релиз БҮХЭЛДЭЭ.** Энэ файлын §3.4 (INSTALL), §3.5 (SELF-CHECK), §3.3 (MANIFEST/HASH) ба §8-ийн архивлалт хийгдээгүй бол ~20 ПК рүү тараалт **ЭХЛЭХГҮЙ**. `2-1`…`2-7`-ийн бүх C# нь энэ нэг релизээр л ажилтанд хүрнэ.
> **Хөндөх файлууд:** `backend/migrations/0241_addin_releases.sql` (ШИНЭ), `backend/migrations/0242_addin_installs.sql` (ШИНЭ), `backend/src/routes/revit.ts`, `backend/src/routes/revitAddin.ts`, `revit-mcp/addin/BuildInfo.cs`, `revit-mcp/addin/ApiClient.cs`, `revit-mcp/addin/QtoDtos.cs`, `revit-mcp/scripts/package-addin.ps1`, `revit-mcp/scripts/test-bridge.ps1`, `revit-mcp/README.md`, `revit-mcp/docs/ASSISTANT.md`. **ӨӨР ФАЙЛ БАЙХГҮЙ.**
> **Deploy тоо:** **2** (1 × `d1 migrations apply` → 1 × `wrangler deploy`) **+ 1 × add-in релиз** (~20 ПК, **ГАРААР**, Revit ХААЛТТАЙ). Frontend deploy **ШААРДЛАГАГҮЙ**. Бүх C# нь **НЭГ РЕЛИЗЭД**.

---

## 0. ЭНЭ СЕССИЙН ДҮРЭМ

**Хамрах хүрээ (scope).** Дээрх 11 файл. Өөр юу ч биш. Энэ сесс **дүрмийн хөдөлгүүр, багийн илрүүлэлт, олдворын амьдралын мөчлөг бичихгүй** — тэднийг `2-1`…`2-7` эзэмшинэ. Энэ сесс тэдний C#-ыг **тараах суваг**, тэдний **хувилбарыг мэдээлэх суваг**, ба **буцаах арга** барина.

**Энэ баримт нь `docs/bim-ai/1C-addin-release.md`-ийг ӨРГӨТГӨНӨ, ӨРСӨЛДӨХГҮЙ.** 1C нь тэр НЭГ релизийн агуулгыг (§3.1–§3.12) тодорхойлсон; энэ баримт нь тэр релизийг **хэрхэн савлаж, хэрхэн суулгаж, хэрхэн батлаж, хэрхэн буцаах** вэ гэдгийг нэмнэ. 1C-ийн «10 зүйлийн аль нэгийг ч хойшлуулж болохгүй» дүрэм энд ХЭВЭЭР үйлчилнэ — Track 2-ийн бүх C# нэмэлт нь тэр ЖАГСААЛТЫН ҮРГЭЛЖЛЭЛ болно (жагсаалт §5.3-т).

**Бусад агентуудтай зэрэг ажиллаж байна.** Ажлын мод дээр өөр хүний дуусаагүй, эмхэтгэгдэхгүй файл байж болно. Даалгаварт хамааралгүй файлыг үүсгэхгүй, засахгүй, устгахгүй. `git restore` / `git checkout --` / `git stash` / `git reset` / `git add -A` — **ХЭЗЭЭ Ч БИШ**. `npm run build` бүх апп-ыг эмхэтгэдэг тул унасан build автоматаар чинийх БИШ — алдаанууд зөвхөн хамааралгүй файлд байгаа эсэхийг шалгаад эзэнд мэдэгд.

**Deploy хийж болох уу?** Тийм — миграц эхэлж, дараа нь worker. Add-in релизийг **ЭНЭ СЕССЭД ТАРААХГҮЙ**: тараалт нь §8-ийн архивлалт хийгдсэний дараа, эзний ил зөвшөөрлөөр эхэлнэ.

**ЭНЭ СЕССИД ХЭЗЭЭ Ч ХИЙЖ БОЛОХГҮЙ:**

| ⛔ | Дүрэм | Яагаад — бодит үр дагавар |
|---|---|---|
| 1 | `/api/*`-д `purpose === 'mcp'` токеныг **ТАТГАЛЗУУЛАХГҮЙ** | Add-in REST дуудлага бүрээ 365 хоногийн `mcp` токеноор гарын үсэглэдэг; **refresh урсгал БАЙХГҮЙ**. Энэ бол алсаас сэргээх БОЛОМЖГҮЙ цорын ганц өөрчлөлт: ~20 ПК, `Install.bat`, Revit хаалттай. `backend/src/middleware/auth.ts:101-102`, `backend/src/types.ts:209-212`, `backend/src/lib/tokenValidity.ts:30-34`-д гурван газар бэхлэгдсэн. Шинэ `POST /api/revit/health` ч ЯГ ижил токеныг хүлээж авна |
| 2 | `users` / `projects`-ыг `wrangler d1 migrations apply`-аар **ДАХИН БАЙГУУЛАХГҮЙ** | `migrations apply` файл бүрийг транзакцад ороодог ба тэнд cascade ажилладаг. `users` 19, `projects` 33 cascade хүүхэдтэй — эцгийг drop хийвэл бүх хүүхэд мөр УСТАНА. 0242 нь `users(id)`-д зөвхөн **REFERENCES** тавина, `users`-ыг ХӨНДӨХГҮЙ |
| 3 | Миграц **зөвхөн нэмэгдэнэ** — хэрэгжсэн файлыг засах нь продакшн дээр **ЧИМЭЭГҮЙ NO-OP** | `d1_migrations`-д мөр аль хэдийн байгаа тул дахин ажиллахгүй. Бичихийн ӨМНӨ `ls backend/migrations | tail -5` заавал ажиллуул (§3.0) |
| 4 | Trigger дотор `END;` нь **ТОМ ҮСГЭЭР, ӨӨРИЙН МӨРӨНД** | wrangler-ийн салгагч regex нь том/жижиг үсгийг ялгадаг. 0241/0242-д trigger БАЙХГҮЙ тул энэ дүрэм зөвхөн урьдчилан сэргийлэлт |
| 5 | Инференс нь tool-bus handler, `DocumentChanged`, эсвэл итгэмжлэгдсэн зам дээр **ХЭЗЭЭ Ч БАЙХГҮЙ** | `revit-mcp/addin/RevitToolBus.cs:442-454` ба `revit-mcp/addin/ChangeTracker.cs:764-775`-д ⛔ гэрээ бичигдсэн. `BuildInfo.SelfCheck()` нь **цэвэр** — сүлжээ, Revit API, дискний бичилт хийхгүй |
| 6 | `DocumentChanged` дотор баримт нь **УНШИХ ТӨЛӨВ** — транзакц, `Regenerate()`, файлын бичилт БАЙХГҮЙ | Өмнөх сканнер 120+ секунд авдаг байсан. Энэ баримтын код тэр handler-ыг огт хөндөхгүй |
| 7 | `-p:DeployToRevit=true` хамгаалалтыг **СУЛРУУЛАХГҮЙ** | `RevitMcpAddin.csproj:167-173`-ын толгойд бичигдсэн: 2026-08-28-нд энгийн `dotnet build` энэ машины **дөрвүүлэн** амьд Revit суулгацыг commit хийгээгүй WIP-ээр дарж бичсэн. Тараалтын скрипт энэ target-д түшиглэдэггүй (`package-addin.ps1:182-186` нь `bin\x64\<cfg>`-ээс шууд савладаг) |
| 8 | `Uninstall.bat`-ыг **буцаалтын алхам болгож ХЭРЭГЛЭХГҮЙ** | `package-addin.ps1:104-109` нь `%APPDATA%\RevitMcpAddin`-ыг БҮХЭЛД НЬ устгана: `settings.json` (≈1 жилийн токен), `assistant-log.jsonl` (илгээгдээгүй сургалтын мөрүүдийн ЦОРЫН ГАНЦ хуулбар), `timing.log`, `changes\*.json`. §3.6-ийн `-KeepData` хүртэл буцаалтад хэрэглэхийг ХОРИГЛОНО |
| 9 | Add-in-ыг **буурааж** (downgrade) суулгахаас өмнө `assistant-log.jsonl`-ыг машинаас ХУУЛААГҮЙ бол буулгахгүй | Хуучин add-in JSON-ыг анхдагч тохиргоогоор задалж танихгүй талбарыг ХАЯДАГ, дараа нь `AssistantLog.Save()` (`revit-mcp/addin/AssistantLog.cs:211-220`) файлыг **санах ойн мөрүүдээс бүтнээр дахин бичдэг** — амжилттай flush болбүрт (`:479`), 👍/👎-д (`:319`), тайралтад (`:258`). Хугацааны болон event талбарууд БУЦААГДАШГҮЙ устана |
| 10 | User-Agent-ийн `MglRevitAddin/` угтварыг **ХЭЗЭЭ Ч ӨӨРЧЛӨХГҮЙ** | `revit-mcp/addin/ApiClient.cs:58-84`-д 2026-08-25-нд ХЭМЖИЖ баталсан: UA байхгүй → **403 / error 1010** (Cloudflare Browser Integrity Check, Worker-т хүрэхээс өмнө), UA-тай → 401. Хэлбэр эвдэрвэл бүх REST дуудлага АЛСААС зогсоно |
| 11 | Add-in-ы **гарын үсэг (code signing)** энэ сессид хийгдэхгүй, гэхдээ **чимээгүй алгасахгүй** | §74-ийн SIGN/VERIFY шат. Гэрчилгээ репод БАЙХГҮЙ; гарын үсэггүй байдал хэрэглэгчийн зааварт («Always Load») аль хэдийн шингэсэн — `frontend/src/features/revit-addin/RevitAddinPage.tsx:167-168`. §9-д эзний үйлдэл болгож бүртгэнэ |
| 12 | Өөр агентын ажилд хүрэхгүй | Дээрх 11 файлаас гадна юу ч биш |

---

## 1. КОНТЕКСТ

### Систем (хүйтэн сессид хангалттай хэмжээгээр)

| Хэсэг | Юу вэ |
|---|---|
| `backend/` | Cloudflare Worker — `@cloudflare/workers-oauth-provider` дотор Hono. D1 + R2 + KV + нэг Durable Object + Workers AI |
| `frontend/` | Vite + React 19 SPA, Cloudflare Pages төсөл **`mgl-design-system`** |
| `revit-mcp/addin/` | Revit 2024–2027 C#/WPF нэмэлт — **46 `.cs` файл, 15,442 мөр, ТЭГ тест, АВТОМАТ ШИНЭЧЛЭЛ БАЙХГҮЙ** |
| Ажилтан | ~49 мэдлэгийн ажилтан; Revit нэмэлт ~20 ПК дээр |
| Миграц | Дискэн дээрх хамгийн өндөр файл нь **0216_assistant_log_timing.sql**, нийт **206** файл (шалгасан 2026-08-30) |
| Тараалт | `revit-mcp/dist/` **БАЙХГҮЙ**, `revit-mcp/addin/bin/` **БАЙХГҮЙ** — хоёулаа `revit-mcp/.gitignore:9-13`-аар git-д ороогүй |

### Платформын хатуу хязгаарууд (энэ даалгаварт хамаарах хэсэг)

- **Add-in-д албадан шинэчлэх механизм БАЙХГҮЙ.** Тараалт бүр = ~20 машин × `Install.bat` × Revit хаалттай. Энэ хөтөлбөрийн ЦОРЫН ГАНЦ үнэхээр үнэтэй ажиллагаа.
- **Build нь зөвхөн Windows.** `UseWPF=true` (`RevitMcpAddin.csproj:18`), `Platforms=x64` (`:21`). Энэ ажлын машин дээр `dotnet`, `pwsh`, `powershell` гурвуулан **БАЙХГҮЙ** — BUILD/TEST/PACKAGE шатыг Windows машин рүү шилжүүлнэ.
- **Тараалтын суваг нь зөвхөн эзэнд нээлттэй.** `backend/src/routes/revitAddin.ts:9` дэх `OWNER_ID = 1` ба `:19-25` дэх router-ийн gate; ижил шалгалт `frontend/src/features/revit-addin/RevitAddinPage.tsx:32,48` ба `frontend/src/shared/components/Layout.tsx:606`-д давхардсан. Ажилтан өөрөө татаж ЧАДАХГҮЙ.
- **Нийтлэх (publish) endpoint БАЙХГҮЙ.** R2 түлхүүр `revit-addin/RevitMcpAddin-Revit<он>.zip` рүү юу ч бичдэггүй; цорын ганц зам нь `node backend/scripts/r2.mjs put media <түлхүүр> --file=… --remote` (`backend/scripts/r2.mjs:19-36`).
- **Хувилбарын мэдээлэл сервер рүү нэг л сувгаар очдог.** `assistant_logs.addin_version` (`backend/migrations/0212_assistant_log_provenance.sql:46`) — тэр нь **зөвхөн туслах самбар нээдэг хүнийг** хамарна. User-Agent-ыг `/api/revit/*`-ийн ямар ч route хадгалдаггүй (`grep` баталгаа §2.9).

### Яагаад энэ даалгавар байна вэ

1. **Тараах ЮМ БАЙХГҮЙ.** `revit-mcp/dist/` ба `addin/bin/` хоёулаа энэ машин дээр байхгүй, gitignore-д орсон. §74-ийн эхний дөрвөн шат гаралтгүй.
2. **БУЦААХ ЮМ БАЙХГҮЙ.** `1C-addin-release.md:1394` нь 2026-08-24-ний zip-үүдийг буцаалтын бай гэж нэрлэсэн боловч **тэдгээр файл байхгүй**. Эхний муу релиз одоогийн байдлаар сэргээгдэшгүй.
3. **Суулгагч амжилтгүй үедээ АМЖИЛТТАЙ гэж хэлдэг.** `package-addin.ps1:61-89` — `$ErrorActionPreference` тавиагүй, Revit ажиллаж байгаа эсэхийг шалгадаггүй, хуулахаас ӨМНӨ хуучин фолдерыг устгадаг, хуулалтын үр дүнг шалгадаггүй, «Дууслаа»-г **болзолгүй** хэвлэдэг.
4. **Өөрийн шалгалт нэг хувилбар дээр БАТАЛГААТАЙ УНАНА.** `test-bridge.ps1:76-86` нь `bridge.json` байхгүй бол 1-р алхамдаа `exit 1` хийдэг; `BridgeAuth.Issue` нь `App.cs:86`-д, `#if MCP_EXECUTOR` блок (`App.cs:77-101`) дотор — тэр нь `RevitMcpAddin.csproj:99-102`-оор net48-аас хасагддаг. Revit 2024-ийн zip дээр Test.bat **үргэлж улаанаар** унана.
5. **Савласан README буруу заавартай.** `package-addin.ps1:130-132` нь «дөрвөн бүлэг» гэж бичээд **гурвыг** нэрлэдэг — `Тоо хэмжээ | Хуудас | Явц` — гэтэл бодит панелууд нь `Ажлын явц` (`App.cs:376`), `Сайт руу илгээх` (`:413`), `Загвар` (`:458`), `Тохиргоо` (`:476`). Зөв суусан суулгац хэрэглэгчид **буруу харагдана**.
6. **Хэш тооцоологддог ч ХЭЗЭЭ Ч ШАЛГАГДДАГГҮЙ.** `package-addin.ps1:250-262` нь sha256-г zip-ийн **хажууд**, `dist/`-д бичдэг — хүлээн авагч ПК түүнийг физикээр харах боломжгүй.
7. **Тэг тест.** Репо даяар нэг `.csproj`, тест төсөл байхгүй, 15,442 мөр C#-д C# тест **ТЭГ**.
8. **Оптимизаци саяхан л залруулагдсан.** `RevitMcpAddin.csproj:77-90` — SDK-ийн `'$(Configuration)'=='Release'` шалгуур «Release R27»-т хэзээ ч таардаггүй тул өмнөх БҮХ «Release Rxx» build **оптимизацгүй** эмхэтгэгдсэн. Хуучин суулгац дээр авсан латентын суурь тоо **системтэйгээр пессимист**.

---

## 2. БАТАЛГААЖСАН ОДООГИЙН ЗАН ТӨЛӨВ

> Доорх `file:line` бүрийг энэ сесс өөрөө нээж баталгаажуулав (**2026-08-30**, commit `6a8e4f5`). Ажлын машин дээр `dotnet` / `pwsh` байхгүй тул **ажиллуулж** шалгасан зүйл байхгүй — бүгд эх кодын унших баталгаа.

### §74-ийн есөн шатны нэгдсэн байдал

| Шат | Төлөв | Нотолгоо | Юу дутуу вэ |
|---|---|---|---|
| BUILD | **ХЭРЭГЖСЭН** (гараар, ×4, зөвхөн Windows) | `RevitMcpAddin.csproj:9,13,54-75` | CI байхгүй, нэг оролтын цэг байхгүй |
| TEST | **БАЙХГҮЙ** | Репод нэг `.csproj`; `revit-mcp/training/check_parity.py:158-160`, `check_nudge.py:161-168` нь ганц Revit-гүй файлыг `dotnet run`-аар эмхэтгэдэг | C# unit тест ТЭГ |
| PACKAGE | **ХЭРЭГЖСЭН, ГЭХДЭЭ ХЭСЭГЧИЛСЭН РЕЛИЗ ГАРГАЖ ЧАДНА** | `package-addin.ps1:178-244`; `:188-191` нь `Write-Warning` + `continue` | Дутуу build → exit 0 |
| MANIFEST | **ХЭРЭГЖСЭН, ГЭХДЭЭ ӨНЧИН** | `package-addin.ps1:246-262` | `dist/`-д бичигддэг, git-д ороогүй, хэн ч уншдаггүй |
| HASH | **ТООЦООЛОГДДОГ, ШАЛГАГДДАГГҮЙ** | `package-addin.ps1:250` | Манифест zip-ийн ГАДНА тул хүлээн авагч шалгах боломжгүй |
| SIGN / VERIFY | **БАЙХГҮЙ** | csproj-д `SignAssembly` / `AssemblyOriginatorKeyFile` байхгүй; `RevitAddinPage.tsx:167-168` «гарын үсэггүй тул … Always Load» | Гэрчилгээ байхгүй |
| INSTALL | **ХЭРЭГЖСЭН, ГЭХДЭЭ FAIL-SAFE БИШ** | `package-addin.ps1:61-89` | 4 согог — §2.4 |
| SELF-CHECK | **ХЭСЭГЧИЛСЭН, R24 ДЭЭР БАТАЛГААТАЙ УНАНА** | `test-bridge.ps1:76-86` + `App.cs:77-101` + `csproj:99-102` | Хувилбар/загвар/дүрэм/сервер шалгадаггүй |
| REPORT HEALTH | **БАЙХГҮЙ** | `/api/revit/*`-д UA уншигч байхгүй; `Percentiles.cs` локал `timing.log` | Гадагш суваг ТЭГ |

### 2.1 BUILD — дөрвөн гар команд, найман Configuration, зөвхөн Windows

```
RevitMcpAddin.csproj:9      dotnet build RevitMcpAddin.csproj -c "Release R27" -p:Platform=x64
RevitMcpAddin.csproj:13     <Configurations>Debug R24;Debug R25;Debug R26;Debug R27;Release R24;Release R25;Release R26;Release R27</Configurations>
RevitMcpAddin.csproj:18     <UseWPF>true</UseWPF>
RevitMcpAddin.csproj:21     <Platforms>x64</Platforms>
RevitMcpAddin.csproj:54-56  R24 -> RevitVersion 2024, TargetFramework net48
RevitMcpAddin.csproj:58-60  R25 -> 2025, net8.0-windows
RevitMcpAddin.csproj:62-64  R26 -> 2026, net8.0-windows
RevitMcpAddin.csproj:66-68  R27 -> 2027, net10.0-windows
RevitMcpAddin.csproj:71-74  Fallback: Config нэрэнд Rxx байхгүй бол 2027/net10
```

**Хэмжсэн гаралт (2026-08-30):**

```
$ which dotnet pwsh powershell
dotnet not found
pwsh not found
powershell not found
```

⇒ Энэ агентын машин BUILD/TEST/PACKAGE шатыг **гүйцэтгэх боломжгүй**. §7-ийн бүх PowerShell команд Windows build машин дээр ажиллана.

### 2.2 `-p:DeployToRevit=true` хамгаалалт — ЗӨВ, ХЭВЭЭР ҮЛДЭНЭ

`RevitMcpAddin.csproj:167-173`-ын толгойн тайлбар (үг үсгээр):

```
csproj:167   ⚠️ ЗӨВХӨН ИЛ ЗӨВШӨӨРӨЛТЭЙ.  Энэ target урьд нь БОЛЗОЛГҮЙ байсан тул
csproj:168   `dotnet build` БҮР нь энэ машины АМЬД Revit нэмэлтийг чимээгүйхэн дарж
csproj:169   бичдэг байв.  2026-08-28-нд агентын энгийн `dotnet build` 2024/2025/
csproj:170   2026/2027 дөрвүүлэн суулгацыг commit хийгээгүй WIP кодоор дарсан.
csproj:194   <Target Name="DeployAddin" AfterTargets="Build"
csproj:195         Condition="'$(DeployToRevit)' == 'true'">
```

⚠️ `csproj:181-183`-д мөн бичсэн: тараалтын скрипт энэ target-д **түшиглэдэггүй** — `package-addin.ps1:182-186` нь `bin\x64\<cfg>`-ээс шууд савладаг. Тиймээс савлахад `-p:DeployToRevit=true` **нэмэх ШААРДЛАГАГҮЙ**.

### 2.3 `Optimize` — саяхан л залруулагдсан, латентын суурь тоог хүчингүй болгоно

```
csproj:77-88   ⚠️ ОПТИМИЗАЦИ. …  .NET SDK-ийн стандарт `'$(Configuration)' == 'Release'`
               шалгуурт ХЭЗЭЭ Ч таардаггүй — өөрөөр хэлбэл өнөөг хүртэл БҮХ
               «Release Rxx» build нь csc-д `optimize-` буюу ОПТИМИЗАЦГҮЙ
               эмхэтгэгдэж байсан …
csproj:89-91   <PropertyGroup Condition="$(Configuration.StartsWith('Release'))">
                 <Optimize>true</Optimize>
```

⇒ **Тогтоол:** энэ засварын ӨМНӨХ аль ч суулгац дээр авсан `timing.log`-ийн p50/p95 нь харьцуулах суурь болж **ЧАДАХГҮЙ**. `2-4`-ийн бүх латентын төсөв энэ релизийн ДАРАА цуглуулсан тоон дээр л тогтоно.

### 2.4 INSTALL — дөрвөн согог, бүгд нэг блокт

```
package-addin.ps1:61-89 (install.ps1 загвар, литерал here-string)
package-addin.ps1:62    # MGL Revit нэмэлт суулгагч — Revit __YEAR__
package-addin.ps1:69-72 if (-not (Test-Path (Join-Path $src 'RevitMcpAddin.addin'))) { … exit 1 }
package-addin.ps1:73    New-Item -ItemType Directory -Force -Path $dst | Out-Null
package-addin.ps1:76-77 $addin = Join-Path $dst 'RevitMcpAddin'
                        if (Test-Path $addin) { Remove-Item -Recurse -Force $addin }   # ← УСТГАЛТ ХУУЛАХААС ӨМНӨ
package-addin.ps1:79-80 Copy-Item … $dst -Force ;  Copy-Item … -Recurse -Force        # ← үр дүн ШАЛГАГДДАГГҮЙ
package-addin.ps1:84    Get-ChildItem $dst -Recurse -File | Unblock-File               # ← БҮХ Addins\<он> фолдер
package-addin.ps1:87    Write-Host "" ; Write-Host "Дууслаа. …" -ForegroundColor Green # ← БОЛЗОЛГҮЙ
```

| # | Согог | Бодит үр дагавар |
|---|---|---|
| a | `$ErrorActionPreference` тавиагүй | Non-terminating алдаа скриптийг зогсоохгүй |
| b | Revit ажиллаж байгаа эсэхийг шалгадаггүй | Нээлттэй Revit дээр DLL түгжигдсэн; `Remove-Item` эсвэл `Copy-Item` унана |
| c | Хуулахаас **ӨМНӨ** устгадаг (`:77`) | (b) биелбэл машин дээр **НЭМЭЛТ ОГТ БАЙХГҮЙ** үлдэнэ — өмнөхөөсөө МУУ |
| d | «Дууслаа» болзолгүй (`:87`) | Оператор бүтэлгүйтлийг **амжилт гэж уншина**. ~20 дараалсан гар суулгалт дээрх ХАМГИЙН ӨНДӨР магадлалтай алдаа |
| e | `Unblock-File` нь `$dst` (бүхэл `Addins\<он>`) дээр | **Өөр борлуулагчийн** нэмэлтүүдийн Mark-of-the-Web төлөвийг чимээгүй өөрчилнө |

⚠️ Мөн `install.ps1` нь тухайн Revit он тэр ПК дээр суусан эсэхийг **шалгадаггүй** (`:73` нь `-Force`-оор фолдер үүсгэнэ) — буруу оны zip суулгах нь **бүрэн чимээгүй no-op**.

### 2.5 SELF-CHECK — Revit 2024 дээр БҮТЭЦИЙН ХУВЬД баталгаатай унана

```
test-bridge.ps1:75    $hsPath = Join-Path $env:APPDATA 'RevitMcpAddin\bridge.json'
test-bridge.ps1:76-86 if (-not (Test-Path $hsPath)) { NO "bridge.json олдсонгүй…" ; … ; exit 1 }
App.cs:77             #if MCP_EXECUTOR
App.cs:86                 BridgeAuth.Issue(port);          // ← bridge.json-ыг бичдэг ЦОРЫН ГАНЦ дуудлага
App.cs:101            #endif
csproj:99-102         <PropertyGroup Condition="'$(TargetFramework)' != 'net48'">
                        <DefineConstants>$(DefineConstants);MCP_EXECUTOR</DefineConstants>
csproj:157-162        <ItemGroup Condition="'$(TargetFramework)' == 'net48'">
                        <Compile Remove="HttpServer.cs" /> … (4 файл)
```

⇒ `net48` = Revit 2024 ⇒ `MCP_EXECUTOR` тодорхойлогдохгүй ⇒ `BridgeAuth.Issue` дуудагдахгүй ⇒ `bridge.json` **хэзээ ч үүсэхгүй** ⇒ `Test.bat` эхний алхамдаа `exit 1`. Гэтэл савласан README ажилтанд түүнийг ажиллуулж, улаан гаралтыг илгээхийг **зөвлөдөг** (`package-addin.ps1:134-142`).

Түүнчлэн `test-bridge.ps1` нь 220 мөрийн турш **дараахыг огт шалгадаггүй**: add-in-ы хувилбар, загварын хувилбар, дүрмийн багцын хувилбар, тохиргооны хувилбар, серверийн хүртээмж, өгөгдөл цуглуулалт ажиллаж байгаа эсэх.

### 2.6 Савласан README-ийн панелын нэр буруу

```
package-addin.ps1:129-132   Revit-ийн туузан цэсэнд "MGL" таб гарч ирэх ёстой.
                            Тэр таб дээр дөрвөн бүлэг байна:
                                Тоо хэмжээ | Хуудас | Явц
                            "Явц" бүлэгт хоёр товч:  "Зураг холбох"  ба  "MGL туслах"
```

Бодит панелууд:

```
App.cs:376   RibbonPanel dailyPanel  = application.CreateRibbonPanel(tabName, "Ажлын явц");
App.cs:413   RibbonPanel exportPanel = application.CreateRibbonPanel(tabName, "Сайт руу илгээх");
App.cs:458   RibbonPanel modelPanel  = application.CreateRibbonPanel(tabName, "Загвар");
App.cs:476   RibbonPanel setupPanel  = application.CreateRibbonPanel(tabName, "Тохиргоо");
App.cs:333   string tabEnv = Environment.GetEnvironmentVariable("MGL_RIBBON_TAB");   // таб нэр ч тохируулагддаг
```

⚠️ Гурван нэрлэсэн бүлгийн **нэг нь ч байхгүй**, тоо нь ч таарахгүй («дөрвөн бүлэг» гээд гурвыг нэрлэсэн). Зөв суусан нэмэлт хэрэглэгчид буруу харагдана — §74-ийн SELF-CHECK-ийн хамгийн энгийн хэлбэр (нүдээр шалгах) **өөрөө худал**.

### 2.7 MANIFEST / HASH — өнчин, шалгагдашгүй

```
package-addin.ps1:238-241   $zip = Join-Path $distDir "RevitMcpAddin-Revit$year.zip"
                            Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
                            Remove-Item -Recurse -Force $stage
package-addin.ps1:250       $hash = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower()
package-addin.ps1:251-259   $mf = [ordered]@{ version; revit; zip; sha256; bytes; built_at; git_sha }
package-addin.ps1:260-261   $relManifest = Join-Path $distDir ("RevitMcpAddin-Revit{0}.manifest.json" -f $year)
package-addin.ps1:247       # ⚠️ zip-ийн ХАЖУУД, `dist/`-д (git-д ороогүй) — репод commit ХИЙХГҮЙ.
```

⇒ Хэш нь **zip үүссэний ДАРАА**, **zip-ийн ГАДНА** тооцоологдоно. `revit-mcp/.gitignore:13` нь `dist/`-ыг хаадаг тул манифест хэзээ ч commit хийгддэггүй, R2 руу байршуулагддаггүй, `install.ps1` уншдаггүй. §74-ийн HASH шат **утга агуулаагүй**.

### 2.8 PACKAGE — хэсэгчилсэн релизийг exit 0-оор гаргана

```
package-addin.ps1:29        $ErrorActionPreference = 'Stop'
package-addin.ps1:188-191   if (-not (Test-Path (Join-Path $binDir 'RevitMcpAddin.dll'))) {
                                Write-Warning "$year : build гаралт алга ($binDir). …  Алгасав."
                                continue
                            }
```

`Write-Warning` нь terminating БИШ тул `$ErrorActionPreference = 'Stop'` түүнийг **барихгүй**. 4 оноос 3 нь савлагдаад скрипт `exit 0` буцаана, эцэст нь ямар он савлагдсаныг тоолсон дүн ч хэвлэгддэггүй (`:265-266` зөвхөн фолдерын замыг хэлнэ).

### 2.9 REPORT HEALTH — гадагш суваг ТЭГ

**Хэмжсэн гаралт (2026-08-30):**

```
$ grep -rn "User-Agent\|user-agent" backend/src/routes/*.ts backend/src/middleware/*.ts
backend/src/routes/attendance.ts:672:    if (isPhoneUserAgent(c.req.header('user-agent'))) {
backend/src/routes/attendance.ts:697:        .bind(deviceId, c.req.header('user-agent') ?? null, nowInUBIso(), user.sub)
backend/src/routes/push.ts:109:  const userAgent = (c.req.header('User-Agent') ?? '').slice(0, 256) || null;
```

⇒ `/api/revit/*` ба `/api/qto/*`-д User-Agent уншигч **нэг ч байхгүй**. Хувилбарын мэдээлэл зөвхөн дараах гурван хаягаар явдаг:

```
ApiClient.cs:84            c.DefaultRequestHeaders.UserAgent.ParseAdd("MglRevitAddin/" + BuildInfo.Version);   // хадгалагддаггүй
AssistantLog.cs:251        AddinVersion = BuildInfo.Version,                                                    // → assistant_logs
Percentiles.cs (timing.log) локал файл, 512 KB, нэг ротаци                                                       // → машинаас гардаггүй
```

`assistant_logs.addin_version` нь `0212_assistant_log_provenance.sql:46`-д нэмэгдсэн, `backend/src/routes/revit.ts:1774` дээр map, `:1816` дээр insert, `:1841` дээр `COALESCE(assistant_logs.addin_version, excluded.addin_version)` (эхний бичилт ялна) — **гэхдээ зөвхөн туслах самбар нээж, flush амжсан хүнд**.

### 2.10 QTO push — хамгийн их урсгалтай зам, хувилбар ТЭГ

```
QtoDtos.cs:78-98    class QtoPayload { project_id, file_name, revit_version, push_id, rows, rooms }   // ← addin_version БАЙХГҮЙ
qto.ts:678          qto.post('/revit-runs', requireAdmin(), async (c) => {
qto.ts:680-694      body: { project_id, file_name, revit_version, push_id, rows, rooms, totals }
qto.ts:885          'revit-2027',                                                                       // ← ХАТУУ БИЧСЭН schema_version
```

⚠️ Клиент ямар ч хувилбартай байсан сервер `schema_version = 'revit-2027'` гэж бичнэ. Зөвхөн «Тоо хэмжээ» ажиллуулдаг инженер **бүрэн үл үзэгдэнэ**.

⚠️ Мөн `qto.ts:678` нь `requireAdmin()` — энгийн инженерийн add-in QTO push хийж **ЧАДАХГҮЙ**. Энэ нь энэ баримтын хамрах хүрээнээс гадуур, §9-д тэмдэглэв.

### 2.11 Тараалтын gate — гурван газарт давхардсан, зөвхөн id 1

```
revitAddin.ts:9        const OWNER_ID = 1;
revitAddin.ts:19-25    revitAddin.use('*', … if (!user || user.sub !== OWNER_ID) return c.json({ error: 'Forbidden' }, 403); )
revitAddin.ts:14       const r2Key = (year: Year) => `revit-addin/RevitMcpAddin-Revit${year}.zip`;
revitAddin.ts:30-50    GET /download/:year → MEDIA_BUCKET.get(r2Key) → attachment
RevitAddinPage.tsx:32  const OWNER_ID = 1;
RevitAddinPage.tsx:48  if (!user || user.id !== OWNER_ID) {
Layout.tsx:606         if (item.to === '/app/revit-addin' && user.id !== 1) return false;
index.ts:234           app.route('/api/revit-addin', revitAddin);
```

⚠️ `revitAddin.ts:36` нь `MEDIA_BUCKET`-аас уншина. `MEDIA_BUCKET` нь `/media/:key`-ээр **нээлттэй уншигдана**; энэ route зориудаар gated хувилбарыг өгдөг (`:28-29` тайлбар), гэхдээ **обьект нь өөрөө нийтийн bucket-д хэвээр** байна.

### 2.12 `/api/revit` router-ийн эрх — шинэ health route үүнийг ӨВЛӨНӨ

```
revit.ts:59    const REVIT_ROLES: UserRole[] = ['engineer', 'architect', 'senior', 'admin'];
revit.ts:95    revit.use('*', requireRole(...REVIT_ROLES));
revit.ts:120   function isManager(role: string): boolean {   // admin | senior
index.ts:232   app.route('/api/revit', revit);
```

⇒ `POST /api/revit/health` нь энэ gate-ийг **үнэгүй өвлөнө**: `client` ба `worker` хүрэхгүй (`workerScope.ts` нь хаалттай-анхдагч зөвшөөрлийн жагсаалт, `/api/revit` түүнд байхгүй), шинэ prefix, шинэ middleware, `lib/modules.ts`-ийн шинэ бүртгэл **шаардлагагүй**.

### 2.13 Устгагч — локал өгөгдлийг бүхэлд нь арчина

```
package-addin.ps1:104-109   $appdata = Join-Path $env:APPDATA 'RevitMcpAddin'
                            if (Test-Path $appdata) {
                                Remove-Item -Recurse -Force $appdata
                                Write-Host "Локал тохиргоо, токен, snapshot цэвэрлэгдэв."
                            }
SettingsStore.cs:18         internal static string Dir =>                       // %APPDATA%\RevitMcpAddin
SettingsStore.cs:23         private static string SettingsPath => Path.Combine(Dir, "settings.json");
AssistantLog.cs:144         private static string LogPath => Path.Combine(Dir, "assistant-log.jsonl");
```

⇒ Тэр нэг мөр (`:107`) нь ≈1 жилийн API токен, **илгээгдээгүй сургалтын мөрүүдийн цорын ганц хуулбар**, хугацааны бүртгэл, өөрчлөлтийн snapshot-уудыг зэрэг устгана.

### 2.14 Буурааж суулгах нь өгөгдлийг БУЦААШГҮЙ гэмтээнэ

```
AssistantLog.cs:108   [JsonIgnore] public bool Sent { get; set; }
AssistantLog.cs:163   foreach (string line in File.ReadAllLines(LogPath, Encoding.UTF8))     // анхдагч сонголт → танихгүй талбар ХАЯГДАНА
AssistantLog.cs:211   private static void Save()
AssistantLog.cs:217-220   foreach (AssistantLogEntry e in _entries) sb.AppendLine(JsonSerializer.Serialize(e));
                          File.WriteAllText(LogPath, sb.ToString(), new UTF8Encoding(false));   // ← БҮТЭН ДАХИН БИЧИЛТ
AssistantLog.cs:258   … RemoveRange(…); Save();      // тайралт
AssistantLog.cs:319   … Save();                      // 👍 / 👎
AssistantLog.cs:479   … Save();                      // амжилттай flush тутамд
```

⇒ Хуучин add-in уншаад дахин бичихэд `timing_json`, `t_*_ms`, ирээдүйн Track 2 event талбарууд **тухайн машин дээр устана**. Буулгах бүрд §8-ийн хуулбарлалт **ЗААВАЛ**.

### 2.15 Гурван шатлалт нөөц ачаалалт — §75-ийн шаардлагыг АЛЬ ХЭДИЙН хангасан загвар

```
IntentModel.cs:83     private static string LocalModelPath =>        // %APPDATA%\RevitMcpAddin\intent-model.json
IntentModel.cs:98     public static string LoadedVersion => _model?.Version;
IntentModel.cs:149    public static string LastLoadSource => _lastLoadSource;   // local | embedded | none
IntentModel.cs:249-251    if (File.Exists(LocalModelPath)) { _model = Parse(File.ReadAllText(LocalModelPath, …)); }
csproj:134-137        <EmbeddedResource Include="Resources\intent-model.json" Condition="Exists(…)" />
```

⇒ татсан → шигтгэсэн → түлхүүр үгийн зам. Дүрмийн багц — `RulePack.cs`, **`2-2-rule-model`**-ынх — **ЯГ ЭНЭ хэлбэрийг** давтана; энэ баримт нь зөвхөн `LoadedVersion` / `LastLoadSource`-ыг эрүүл мэндийн тайланд гаргана.

### 2.16 Миграцийн сүүл — 2026-08-30-нд шалгасан

**Хэмжсэн гаралт:**

```
$ ls backend/migrations | tail -5
0212_assistant_log_provenance.sql
0213_assistant_model_eval.sql
0214_assistant_review.sql
0215_assistant_trust_taxonomy.sql
0216_assistant_log_timing.sql
$ ls backend/migrations | wc -l
     206
```

⚠️ Track 2-ийн нөөцлөгдсөн блок нь **0217–0245**. Энэ баримт **0241 ба 0242**-ыг эзэмшинэ (§3.0 дахь тэмдэглэлийг үз).

---

## 3. ХИЙХ АЖИЛ

### 3.0 Дугаар авах

**Бичихийн ЯГ ӨМНӨ ажиллуул:**

```bash
ls backend/migrations | tail -5
```

Хүлээгдэх: хамгийн өндөр нь `0216_assistant_log_timing.sql`. Хэрэв өөр бол **зэрэгцээ сесс дугаар авсан байна** — доорх дугааруудыг тохируулж, энэ хэсэгт тэмдэглэ.

**Нөөцлөгдсөн:** `0241_addin_releases.sql`, `0242_addin_installs.sql`.

⚠️ **Даалгаврын товчоонд `0232` / `0233` гэж бичигдсэн нь REVISION 1-ийн үлдэгдэл.** REVISION 2-ийн нөөцлөлтөөр энэ баримт **0241/0242**-ыг авсан, `0217`–`0240`-ийн блокийг `2-1`…`2-6` эзэмшинэ. Зэрэгцээ сессүүд бичсэн ЖИНХЭНЭ дугаарууд (2026-08-30-нд `docs/bim-ai/`-аас шалгасан): `2-1` = 0217–0219 · `2-2` = 0220–0223 · `2-3` = 0224, 0225, 0229 · `2-4` = 0226 `perf_scalars`, 0227 `compliance_notice_state`, 0228 `compliance_settings`, 0230 `compliance_authority` · `2-5` = 0237 · `2-6` = 0238–0240. Өөрөөр хэлбэл REVISION 1-ийн `bim_session_meta` / `bim_session_identity` / `compliance_settings_a/b` гэсэн НЭРС аль ч баримтад БАЙХГҮЙ. Хуучин дугаар руу буцвал хоёр файл нэг дугаартай болно — репод аль хэдийн найман давхардсан дугаар байгаа (0002, 0060, 0080, 0110, 0120, 0121, 0173, 0176). Тиймээс **0241/0242-ыг хэрэглэнэ**.

✅ **Зэрэгцээ сессийн ЖИНХЭНЭ давхардал ажиглагдсан БА ШИЙДЭГДСЭН:** `2-3-compliance-engine` нь `0229_rule_run_ledger.sql`, `2-4-nonblocking-runtime` нь `0229_compliance_authority.sql` гэж ХОЁУЛАА 0229-ыг зарласан байв. `2-0-OWNER-BRIEF` §3.5-ын шийдвэрээр **0229 нь `2-3`-ынх, `2-4` нь `0230_compliance_authority.sql` руу шилжсэн**. 0241/0242-т нөлөөлөөгүй (§9 №16).

**Транспортын дүрэм (0209/0210-ийн толгойд хэмжигдсэн):** `migrations apply` нь файлыг `d1_migrations`-ийн INSERT-тэй **НЭГ `--command`** болгон нийлүүлдэг; салгагч нь `/* */` блок тайлбарыг задалж чадахгүй, мөрөн доторх дурын `;` дээр хуваадаг, нэг дуудлагад хэт олон statement байвал унадаг. Тиймээс: **файл бүр ≤ 7 өөрийн statement**, зөвхөн `--` тайлбар, мөрөн дотор `;` байхгүй, statement бүр `IF NOT EXISTS`.

### 3.1 `0241_addin_releases.sql` — нийтлэгдсэн багц бүрийн бүртгэл (4 statement)

```sql
-- =====================================================================
-- 0241_addin_releases.sql
--
-- ЗОРИЛГО: Тараагдсан add-in багц БҮРИЙН таних тэмдэг — хувилбар, Revit он,
-- zip нэр, sha256, хэмжээ, git sha, build-ийн цаг.  v2 §74-ийн MANIFEST ба
-- HASH шатны СЕРВЕР ТАЛЫН тогтоол.
--
-- ⚠️ ЯАГААД ХЭРЭГТЭЙ ВЭ: өнөөдөр манифест нь `revit-mcp/dist/`-д бичигдээд
-- (package-addin.ps1:246-262) тэр фолдер git-д ороогүй (revit-mcp/.gitignore:13).
-- Тараасны дараа «энэ машин дээрх zip яг тэр нийтэлсэн zip мөн үү» гэсэн
-- асуултад хариулах ЮМ БАЙХГҮЙ.  Энэ хүснэгт нь тэр цорын ганц баримт.
--
-- ⚠️ REFERENCES ЗӨВШӨӨРӨГДӨНӨ: энэ хүснэгтийг 0206-ийн append-only trigger
-- ХАМГААЛДАГГҮЙ (тэр нь bim_artifacts / revit_transactions /
-- revit_element_touches / learning_events дөрвийг л нэрлэдэг).  Тиймээс
-- `users(id) ON DELETE SET NULL` нь энд аюулгүй.
--
-- ⚠️ users / projects-ыг ХӨНДӨХГҮЙ.  Зөвхөн шинэ хүснэгт.
-- =====================================================================

CREATE TABLE IF NOT EXISTS addin_releases (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,

  -- csproj-ийн <Version> (package-addin.ps1:43-50 уншина).  ж: '1.2.0'
  version        TEXT    NOT NULL,
  revit_year     TEXT    NOT NULL,                      -- '2024'|'2025'|'2026'|'2027'
  channel        TEXT    NOT NULL DEFAULT 'prod',       -- prod | canary

  zip_name       TEXT    NOT NULL,                      -- RevitMcpAddin-Revit2027.zip
  sha256         TEXT    NOT NULL CHECK (length(sha256) = 64),
  bytes          INTEGER NOT NULL CHECK (bytes > 0),
  git_sha        TEXT,
  built_at       TEXT    NOT NULL,                      -- ISO-8601 UTC, build машины цаг

  -- Хамгийн бага дэмжигдэх КЛИЕНТ хувилбар.  Сервер энэ утгаас доош
  -- клиентэд `POST /api/revit/health`-ийн хариунд upgrade_required=1 өгнө.
  min_client     TEXT,

  status         TEXT    NOT NULL DEFAULT 'published',  -- published | superseded | revoked
  notes          TEXT,

  published_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published_at   TEXT    NOT NULL DEFAULT (datetime('now'))
)

-- Нэг хувилбар × нэг Revit он × нэг суваг = НЭГ мөр.  Дахин нийтлэхэд
-- upsert хийгдэнэ (sha256 өөрчлөгдвөл тэр нь ЖИНХЭНЭ асуудал — 3.7-г үз).
CREATE UNIQUE INDEX IF NOT EXISTS idx_addin_rel_uniq
  ON addin_releases (version, revit_year, channel)

-- «Revit 2027-ийн хамгийн сүүлийн prod багц юу вэ»
CREATE INDEX IF NOT EXISTS idx_addin_rel_year
  ON addin_releases (revit_year, channel, published_at DESC)

-- «Энэ клиентийн мэдээлсэн хэш нийтлэгдсэн багцын мөн үү» — §3.7-ийн шалгалт
CREATE INDEX IF NOT EXISTS idx_addin_rel_sha
  ON addin_releases (sha256)
```

### 3.2 `0242_addin_installs.sql` — суулгац бүрийн эрүүл мэнд (4 statement)

```sql
-- =====================================================================
-- 0242_addin_installs.sql
--
-- ЗОРИЛГО: v2 §74-ийн «Each installed client should expose: add-in version,
-- model version, rules version, configuration version, installation health».
-- Таван утга + өөрийн шалгалтын үр дүн энд буудаг.
--
-- ⚠️ ГРЭЙН: НЭГ мөр = (хэрэглэгч, машин, Revit он).  Нэг ажилтан 2024 ба 2027
-- хоёуланг ажиллуулж болно — тэр нь ХОЁР суулгац.  Нэг машин дээр хоёр хүн
-- нэвтэрч болно — тэр нь ХОЁР мөр (identity нь `2-1`-ийн асуудал, энд БИШ).
--
-- ⚠️ machine_hash нь sha256 — МАШИНЫ НЭР БИШ, ЗАМ БИШ.  0202_bim_sessions.sql:63
-- дэх ижил дүрэм.  Add-in түүнийг ӨӨРӨӨ хэшлэж илгээнэ.
--
-- ⚠️ ӨӨРИЙН ХАРАХ ДҮРЭМ (0201:23-32 ба гурван migration толгойд давтагдсан):
-- энэ хүснэгтийн УНШИХ route бүр нь эсвэл `user_id = viewer.sub`, эсвэл
-- ЗӨВХӨН НЭГТГЭСЭН тоо буцаана.  «Хэн хамгийн олон алдаатай суулгацтай вэ»
-- гэсэн хүн нэрлэсэн жагсаалт ХЭЗЭЭ Ч гарахгүй.
--
-- ⚠️ `health_json` нь JSON-ийн БЛОБ + GENERATED VIRTUAL скаляр — 0216-ийн
-- `timing_json` хэв маягийг ҮГ ҮСГЭЭР давтав.  Шинэ шалгалт нэмэхэд миграц
-- ШААРДЛАГАГҮЙ болгох нь зорилго.
--
-- ⚠️ GENERATED багана нь CREATE TABLE ДОТОР.  Нөөцлөлтийн тайлбар түүнийг
-- тусдаа ALTER гэж тоолсон боловч SQLite-ийн `ALTER TABLE ADD COLUMN` нь
-- `IF NOT EXISTS`-ыг дэмждэггүй тул тэр хувилбар нь ДАХИН АЖИЛЛУУЛАХАД
-- `duplicate column name` өгнө.  Statement 5 -> 4 болов, ≤ 7 хэвээр.
-- =====================================================================

CREATE TABLE IF NOT EXISTS addin_installs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,

  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  machine_hash     TEXT    NOT NULL,                    -- sha256
  revit_year       TEXT    NOT NULL,
  revit_build      TEXT,                                -- ж: '2027.1.2.345'

  -- §74-ийн ТАВАН заавал утга -----------------------------------------
  addin_version    TEXT    NOT NULL,                    -- BuildInfo.Version
  model_version    TEXT,                                -- IntentModel.LoadedVersion
  ruleset_version  TEXT,                                -- дүрмийн багц (2-2).  Түр null
  config_version   TEXT,                                -- app_settings-ийн notice/capture хувилбар
  health           TEXT    NOT NULL DEFAULT 'unknown'
                     CHECK (health IN ('ok','degraded','failed','unknown')),

  -- Нэмэлт нотолгоо ----------------------------------------------------
  pack_sha256      TEXT,                                -- ачаалагдсан дүрмийн багцын хэш (2-2)
  release_sha256   TEXT,                                -- суулгасан zip-ийн хэш (install.ps1 бичнэ)
  channel          TEXT    NOT NULL DEFAULT 'prod',
  model_source     TEXT,                                -- IntentModel.LastLoadSource: local|embedded|none
  authority_level  TEXT,                                -- §80.  Түр null

  -- Өөрийн шалгалтын БҮТЭН үр дүн.  { ok:[…], failed:[…], skipped:[…], ts }
  health_json      TEXT    NOT NULL DEFAULT '{}'
                     CHECK (json_valid(health_json) AND json_type(health_json) = 'object'),

  -- Унасан шалгалтын ТОО — индексжүүлэхийн тулд.  Bind зардал ТЭГ.
  sc_failed        INTEGER GENERATED ALWAYS AS
                     (COALESCE(json_array_length(json_extract(health_json, '$.failed')), 0)) VIRTUAL,

  first_seen_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen_at     TEXT    NOT NULL DEFAULT (datetime('now'))
)

-- Upsert-ийн түлхүүр.  Нэг машин × нэг хүн × нэг Revit он = НЭГ мөр.
CREATE UNIQUE INDEX IF NOT EXISTS idx_addin_inst_uniq
  ON addin_installs (user_id, machine_hash, revit_year)

-- «Парк даяар аль хувилбар хэдэн машин дээр байна» — §74-ийн ТООЛЛОГО.
CREATE INDEX IF NOT EXISTS idx_addin_inst_version
  ON addin_installs (addin_version, revit_year, last_seen_at DESC)

-- «Ямар суулгац эвдэрсэн байна» — ЗӨВХӨН НЭГТГЭСЭН тайланд.
CREATE INDEX IF NOT EXISTS idx_addin_inst_bad
  ON addin_installs (health, last_seen_at DESC) WHERE health <> 'ok'
```

### 3.3 PACKAGE / MANIFEST / HASH — манифестыг zip ДОТОР оруулах

⚠️ **Нэг мөрийн байрлалын өөрчлөлт нь §74-ийн HASH шатыг утга агуулсан болгоно.** Одоо манифест `Compress-Archive`-ийн ДАРАА (`package-addin.ps1:246-262`) бичигддэг; түүнийг `$stage`-д, **`:240`-ийн `Compress-Archive`-ийн ӨМНӨ** зөөнө.

`revit-mcp/scripts/package-addin.ps1`-д хийх засварууд:

| # | Файл:мөр | Өөрчлөлт |
|---|---|---|
| 1 | `package-addin.ps1:188-191` | `continue`-ийн өмнө `$script:missing += $year` тоолуур. Циклийн ДАРАА `if ($missing.Count -gt 0) { throw "Дутуу релиз: $($missing -join ', ')" }` — **хэсэгчилсэн релиз exit 0 гаргахаа болино** |
| 2 | `package-addin.ps1:246-262` | Энэ блокийг **`:238`-ийн ӨМНӨ** зөөж, `$hash`-ыг zip-ийн БИШ, `$stage`-ийн **payload-ын** хэшээс биш — ЭХЛЭЭД манифестыг (`sha256` талбаргүйгээр) `$stage\release.json`-д бичиж, дараа нь zip үүсгээд, zip-ийн sha256-г `dist\*.manifest.json`-д бичнэ. Өөрөөр хэлбэл **ХОЁР** артефакт: zip дотор `release.json` (юу савлагдсаныг тодорхойлно), zip хажууд `*.manifest.json` (zip өөрөө яг тэр эсэхийг тодорхойлно) |
| 3 | `package-addin.ps1:194-207`-ийн дараа | `$stage\payload.sha256.txt` — `RevitMcpAddin\` доторх файл БҮРИЙН sha256 (relative зам + хэш, нэг мөрөнд нэг). `install.ps1` суулгасны ДАРАА үүнийг шалгана (§3.4) |
| 4 | `package-addin.ps1:265-266` | Төгсгөлд савлагдсан оныг тоолсон дүн: `"Савлагдсан: $($done -join ', ')  ·  Дутуу: $($missing -join ', ')"` |

`$stage\release.json`-ийн БҮТЭН хэлбэр (энэ нь клиент болон `POST /api/revit/health`-ийн `release_sha256`-ийн эх сурвалж):

```json
{
  "schema": "mgl-addin-release-v1",
  "version": "1.2.0",
  "revit": "2027",
  "channel": "prod",
  "git_sha": "6a8e4f5…",
  "built_at": "2026-08-30T00:00:00.0000000Z",
  "files": 128,
  "payload_sha256": "<payload.sha256.txt-ийн өөрийнх нь sha256>"
}
```

⚠️ `zip`-ийн sha256-г `release.json` дотор бичих нь **боломжгүй** (тахир хамаарал: zip-ийн агуулга нь өөрийнхөө хэшийг агуулж чадахгүй). Тиймээс хоёр давхарга: **payload хэш** нь zip дотор, **zip хэш** нь хажууд ба `addin_releases.sha256`-д.

### 3.4 INSTALL — тэг-алдаатай суулгагч

`package-addin.ps1:61-89` дэх `$installPs1Template`-ыг БҮХЭЛД НЬ дараахаар солино:

```powershell
# MGL Revit нэмэлт суулгагч — Revit __YEAR__
# ⚠️ ЯАГААД ЭНЭ БҮХЭН ХЭРЭГТЭЙ ВЭ: ~20 машин дээр ГАРААР дараалан суулгадаг ба
#    алдаа гарвал оператор түүнийг МЭДЭХГҮЙ өнгөрдөг байв.  v2 §74: «A client with
#    an incompatible version must fail gracefully and not corrupt user work.»
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$ErrorActionPreference = 'Stop'          # ⚠️ 1-Р ЗАСВАР: чимээгүй үргэлжлэхийг зогсооно
$year = '__YEAR__'
$src  = $PSScriptRoot
$dst  = Join-Path $env:APPDATA "Autodesk\Revit\Addins\$year"

function Fail($m) { Write-Host "АЛДАА: $m" -ForegroundColor Red; exit 1 }

# --- 0. Багц бүрэн эсэх --------------------------------------------------
if (-not (Test-Path (Join-Path $src 'RevitMcpAddin.addin'))) {
    Fail "RevitMcpAddin.addin олдсонгүй. ZIP-ээ БҮРЭН задалсан эсэхээ шалгана уу."
}
if (-not (Test-Path (Join-Path $src 'release.json'))) {
    Fail "release.json олдсонгүй — энэ багц бүрэн бус эсвэл албан ёсны БИШ."
}

# --- 1. Revit ажиллаж байвал ЗОГСОНО (2-р ЗАСВАР) ------------------------
# ⚠️ Revit нээлттэй бол DLL түгжигдэнэ.  Урьд нь энэ үед хуучин фолдер
#    устаад шинэ нь хуулагдаж чаддаггүй байв — машин НЭМЭЛТГҮЙ үлддэг.
if (Get-Process -Name 'Revit' -ErrorAction SilentlyContinue) {
    Fail "Revit ажиллаж байна. Revit-ээ БҮГДИЙГ хаагаад дахин ажиллуулна уу."
}

# --- 2. Тухайн Revit он суусан эсэх --------------------------------------
# ⚠️ Урьд нь буруу оны zip суулгах нь БҮРЭН ЧИМЭЭГҮЙ no-op байв.
$revitRoot = Join-Path $env:ProgramFiles "Autodesk\Revit $year"
if (-not (Test-Path $revitRoot)) {
    Write-Host "АНХААР: Revit $year энэ компьютерт олдсонгүй ($revitRoot)." -ForegroundColor Yellow
    Write-Host "        Буруу оны багц суулгаж байж магадгүй." -ForegroundColor Yellow
    $ans = Read-Host "Үргэлжлүүлэх үү? (t/y = тийм)"
    if ($ans -notmatch '^[ty]') { Fail "Хэрэглэгч зогсоов." }
}

# --- 3. ХУУЛААД ДАРАА НЬ СОЛИНО (3-р ЗАСВАР) -----------------------------
# ⚠️ Урьд нь `Remove-Item $addin` нь хуулахаас ӨМНӨ ажилладаг байв.
#    Одоо: .new руу хуулж, БАТАЛГААЖУУЛААД, дараа нь атомарт ойр солино.
New-Item -ItemType Directory -Force -Path $dst | Out-Null
$addin = Join-Path $dst 'RevitMcpAddin'
$new   = "$addin.new"
$old   = "$addin.old"
if (Test-Path $new) { Remove-Item -Recurse -Force $new }
Copy-Item (Join-Path $src 'RevitMcpAddin') $new -Recurse -Force

# --- 4. ХЭШ БАТАЛГААЖУУЛАЛТ (4-р ЗАСВАР) ---------------------------------
# ⚠️ Урьд нь манифест `dist/`-д үлддэг байсан тул хүлээн авагч ПК хэзээ ч
#    шалгаж чаддаггүй байв.  Одоо payload.sha256.txt нь zip ДОТОР ирнэ.
$bad = 0
foreach ($line in Get-Content (Join-Path $src 'payload.sha256.txt')) {
    if (-not $line.Trim()) { continue }
    $parts = $line -split '\s+', 2
    $want  = $parts[0].ToLower()
    $rel   = $parts[1]
    $f     = Join-Path $new $rel
    if (-not (Test-Path $f)) { Write-Host "  ДУТУУ: $rel" -ForegroundColor Red; $bad++; continue }
    $got = (Get-FileHash -Algorithm SHA256 $f).Hash.ToLower()
    if ($got -ne $want) { Write-Host "  ЗӨРСӨН: $rel" -ForegroundColor Red; $bad++ }
}
if ($bad -gt 0) {
    Remove-Item -Recurse -Force $new
    Fail "$bad файл зөрлөө — суулгалт ЦУЦЛАГДЛАА. Хуучин суулгац ХЭВЭЭР байна. ZIP-ээ дахин тата."
}

# --- 5. Солилт -----------------------------------------------------------
if (Test-Path $old)   { Remove-Item -Recurse -Force $old }
if (Test-Path $addin) { Rename-Item $addin  $old }
Rename-Item $new $addin
if (Test-Path $old)   { Remove-Item -Recurse -Force $old }
Copy-Item (Join-Path $src 'RevitMcpAddin.addin') $dst -Force
Copy-Item (Join-Path $src 'release.json') (Join-Path $dst 'RevitMcpAddin\release.json') -Force

# --- 6. Unblock — ЗӨВХӨН БИДНИЙ ФОЛДЕР (5-р ЗАСВАР) ----------------------
# ⚠️ Урьд нь `$dst`-ыг бүхэлд нь Unblock хийдэг байсан — тэр нь ӨӨР
#    БОРЛУУЛАГЧИЙН нэмэлтүүдийн Mark-of-the-Web төлөвийг чимээгүй өөрчилдөг.
Get-ChildItem $addin -Recurse -File | Unblock-File
Unblock-File (Join-Path $dst 'RevitMcpAddin.addin')

Write-Host ""
Write-Host "Суулгалт АМЖИЛТТАЙ. Хувилбар:" ((Get-Content (Join-Path $src 'release.json') -Raw | ConvertFrom-Json).version) -ForegroundColor Green
Write-Host "Revit $year-г нээгээд, MGL таб дээрх 'Тохиргоо' > 'Шалгах'-ыг дар." -ForegroundColor Green
Write-Host "Эхний нээлтэд 'Add-In Security' анхааруулга гарвал 'Always Load' сонгоно."
exit 0
```

⚠️ **Суулгагч хэрэглэгчээс АСУУХГҮЙ зүйлс (R7 / v2 §53).** Ганц `Read-Host` нь §3.4-ийн 2-р алхам — Revit он таарахгүй үед л. Өөр АСУУЛТ БАЙХГҮЙ: нэвтрэх нэр, төсөл, **баг**, хэл, зам, сувгийн сонголт, телеметрийн зөвшөөрөл — **нэг ч биш**. Баг нь §48-ийн шатлалаар сервер талд шийдэгдэнэ (`2-1`), токен нь `Тохиргоо` цонхонд нэг л удаа орно. v2 §71-R2-ийн зөвшөөрөгдсөн таван харилцан үйлдэл (verification / correction / approval / dispute / override) — суулгалт тэдний **аль нь ч биш**.

### 3.5 SELF-CHECK — `BuildInfo.SelfCheck()` ба зассан `test-bridge.ps1`

#### 3.5a `revit-mcp/addin/BuildInfo.cs` — шинэ цэвэр метод

```csharp
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text.Json.Serialization;

namespace RevitMcpAddin
{
    /// <summary>
    /// Суулгалтын өөрийн шалгалтын нэг үр дүн.  v2 §74-ийн SELF-CHECK ба
    /// REPORT HEALTH хоёрын НЭГ өгөгдлийн бүтэц — тусад нь хоёр хэлбэр
    /// байвал тэд заавал зөрнө.
    /// </summary>
    internal sealed class SelfCheckResult
    {
        [JsonPropertyName("addin_version")]   public string AddinVersion   { get; set; }
        [JsonPropertyName("revit_year")]      public string RevitYear      { get; set; }
        [JsonPropertyName("revit_build")]     public string RevitBuild     { get; set; }
        [JsonPropertyName("model_version")]   public string ModelVersion   { get; set; }
        [JsonPropertyName("model_source")]    public string ModelSource    { get; set; }
        [JsonPropertyName("ruleset_version")] public string RulesetVersion { get; set; }
        [JsonPropertyName("pack_sha256")]     public string PackSha256     { get; set; }
        [JsonPropertyName("config_version")]  public string ConfigVersion  { get; set; }
        [JsonPropertyName("release_sha256")]  public string ReleaseSha256  { get; set; }
        [JsonPropertyName("channel")]         public string Channel        { get; set; }
        [JsonPropertyName("health")]          public string Health         { get; set; }  // ok|degraded|failed
        [JsonPropertyName("ok")]              public List<string> Ok      { get; set; } = new List<string>();
        [JsonPropertyName("failed")]          public List<string> Failed  { get; set; } = new List<string>();
        [JsonPropertyName("skipped")]         public List<string> Skipped { get; set; } = new List<string>();
        [JsonPropertyName("ts")]              public string Ts             { get; set; }
    }

    // BuildInfo-д нэмэгдэх хэсэг (одоо байгаа `Version` property-г ХЭВЭЭР ҮЛДЭЭНЭ).
    internal static class InstallCheck
    {
        /// <summary>
        /// Суулгалт бүрэн эсэхийг ЛОКАЛ шалгана.
        ///
        /// ⚠️ ЯАГААД ЦЭВЭР ВЭ: энэ метод нь `Autodesk.Revit`-ийн ямар ч төрөл
        /// ХЭРЭГЛЭХГҮЙ, сүлжээ рүү гарахгүй, дискэнд БИЧИХГҮЙ (зөвхөн уншина).
        /// Ингэснээр (а) net48 (Revit 2024) дээр эмхэтгэгдэнэ, (б)
        /// `check_nudge.py`-ийн загвараар Revit-гүйгээр `dotnet run`-ээр
        /// тест хийгдэнэ, (в) `DocumentChanged` ба tool-bus-ын ⛔ гэрээг
        /// зөрчихгүй.
        ///
        /// ⚠️ ЭНЭ МЕТОД ХЭЗЭЭ Ч ONSTARTUP-ЫГ УНАГААХГҮЙ — бүх алхам
        /// try/catch дотор, алдаа нь `Failed` жагсаалт руу текст болж орно.
        /// </summary>
        public static SelfCheckResult Run(string revitYear, string revitBuild)
        {
            var r = new SelfCheckResult
            {
                AddinVersion = BuildInfo.Version,
                RevitYear    = revitYear,
                RevitBuild   = revitBuild,
                Channel      = "prod",
                Ts           = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture),
            };

            // 1. DLL-ийн хувилбар танигдсан эсэх.  "0" бол InformationalVersion
            //    уншигдаагүй — тэр нь build тохиргооны алдаа.
            if (string.IsNullOrEmpty(r.AddinVersion) || r.AddinVersion == "0")
                r.Failed.Add("addin_version_unknown");
            else
                r.Ok.Add("addin_version");

            // 2. release.json — install.ps1 суулгасан багцын таних тэмдэг.
            //    ⚠️ Байхгүй бол «гараар хуулсан / албан ёсны бус суулгац».
            try
            {
                string dir  = Path.GetDirectoryName(typeof(InstallCheck).Assembly.Location);
                string path = Path.Combine(dir ?? ".", "release.json");
                if (File.Exists(path))
                {
                    r.ReleaseSha256 = ReadJsonString(path, "payload_sha256");
                    string relVer   = ReadJsonString(path, "version");
                    if (!string.IsNullOrEmpty(relVer) && relVer != r.AddinVersion)
                        r.Failed.Add("release_version_mismatch");   // DLL ба багц зөрсөн
                    else
                        r.Ok.Add("release_manifest");
                }
                else r.Failed.Add("release_manifest_missing");
            }
            catch { r.Failed.Add("release_manifest_unreadable"); }

            // 3. Санаа таних загвар — гурван шатлалт ачаалалт (IntentModel.cs:249-251).
            try
            {
                r.ModelVersion = IntentModel.LoadedVersion;
                r.ModelSource  = IntentModel.LastLoadSource;      // local | embedded | none
                if (r.ModelSource == "none") r.Failed.Add("model_not_loaded");
                else r.Ok.Add("model_" + r.ModelSource);
            }
            catch { r.Failed.Add("model_check_threw"); }

            // 4. Дүрмийн багц (2-4).  ⚠️ Тэр сесс хараахан нийлээгүй бол
            //    ЭНЭ ГУРВАН МӨРИЙГ null үлдээж, `skipped`-д бичнэ — блоклохгүй.
            try
            {
                r.RulesetVersion = RulePack.LoadedVersion;   // 2-2 нийлсэн үед
                r.PackSha256     = RulePack.LoadedSha256;
                if (string.IsNullOrEmpty(r.RulesetVersion)) r.Skipped.Add("ruleset_absent");
                else r.Ok.Add("ruleset");
            }
            catch { r.Skipped.Add("ruleset_absent"); }

            // 5. Тохиргоо — токен байгаа эсэх (утгыг НЬ БИШ, ЗӨВХӨН байгаа эсэхийг).
            //    ⚠️ Токеныг ХЭЗЭЭ Ч бүртгэлд, шалгалтын гаралтад БИЧИХГҮЙ.
            try
            {
                AddinSettings s = SettingsStore.Load();
                r.ConfigVersion = s?.ApiHost;                          // хаяг нь тохиргооны хувилбарын үүрэг гүйцэтгэнэ
                if (string.IsNullOrEmpty(s?.Token)) r.Failed.Add("not_signed_in");
                else r.Ok.Add("credentials");
                if (s == null || s.ProjectId <= 0) r.Skipped.Add("project_unset");
            }
            catch { r.Failed.Add("settings_unreadable"); }

            // 6. Бичих эрх — %APPDATA%\RevitMcpAddin.  Roaming profile дээр
            //    эрх хаагдвал бүх өгөгдөл цуглуулалт чимээгүй унана.
            try
            {
                string probe = Path.Combine(SettingsStore.Dir, ".writeprobe");
                Directory.CreateDirectory(SettingsStore.Dir);
                File.WriteAllText(probe, "1");
                File.Delete(probe);
                r.Ok.Add("appdata_writable");
            }
            catch { r.Failed.Add("appdata_not_writable"); }

            r.Health = r.Failed.Count == 0 ? "ok" : (r.Ok.Count > 0 ? "degraded" : "failed");
            return r;
        }

        private static string ReadJsonString(string path, string key)
        {
            using var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(path));
            return doc.RootElement.TryGetProperty(key, out var v) ? v.GetString() : null;
        }
    }
}
```

⚠️ `RulePack.LoadedVersion` / `LoadedSha256` нь `2-2-rule-model`-д үүснэ (`revit-mcp/addin/RulePack.cs` нь ТҮҮНИЙ хөндөх файл, `2-4`-ийнх БИШ). Тэр сесс хараахан нийлээгүй бол **4-р алхмыг `#if` БИШ, `try/catch`-аар алгасах**: багана `null` үлдэж, `skipped:["ruleset_absent"]` бичигдэнэ. Энэ баримт тэднийг **блоклохгүй**.

#### 3.5b `revit-mcp/scripts/test-bridge.ps1` — R24-д унахаа болино

| # | Файл:мөр | Өөрчлөлт |
|---|---|---|
| 1 | `test-bridge.ps1:75-86` | `bridge.json` шалгалтыг **Revit оноор нөхцөлт** болгоно. Скрипт `release.json`-оос `revit` талбарыг уншиж, `[int]$revit -lt 2025` бол `SK "bridge — Revit 2024-д MCP гүүр БАЙХГҮЙ (csproj:99-102, зориудаар)"` гээд 4–7-р алхмыг алгасаад **`exit 0`** буцаана |
| 2 | `test-bridge.ps1:20`-ийн дараа | Шинэ **0-р алхам**: суулгацын фолдероос `release.json` уншиж `version` / `revit` / `payload_sha256`-г ХЭВЛЭНЭ. Хэрэв байхгүй бол `NO "release.json алга — албан ёсны БИШ суулгац"` |
| 3 | `test-bridge.ps1:212-218` | Дүнгийн блокт `release.json`-ийн хувилбарыг мөн хэвлэнэ, ингэснээр ажилтны илгээсэн гаралтаас **аль build дээр байгааг** нь шууд харна |

#### 3.5c Савласан README-ийн засвар (`package-addin.ps1:127-142`)

```
ЗӨВ СУУСАН ЭСЭХИЙГ ШАЛГАХ
-------------------------
  Revit-ийн туузан цэсэнд "MGL" таб гарч ирнэ.
  Тэр таб дээр ДӨРВӨН бүлэг байна:
      Ажлын явц | Сайт руу илгээх | Загвар | Тохиргоо
  "Ажлын явц" бүлэгт хоёр товч: "Зураг холбох" ба "MGL туслах".

АВТОМАТ ШАЛГАЛТ
---------------
  Revit __YEAR__ НЭЭЛТТЭЙ байхад "Test.bat" дээр давхар дарна.
  Revit 2024 дээр зарим алхам ЗОРИУДААР алгасагдана — тэр нь алдаа БИШ.
  Гаралтыг БҮХЭЛД НЬ хуулж илгээнэ үү.
```

### 3.6 UNINSTALL — `-KeepData` анхдагчаар

`package-addin.ps1:91-113` дэх `$uninstallPs1Template`-д:

```powershell
param([switch]$PurgeData)     # ⚠️ АНХДАГЧ нь өгөгдлийг ХАДГАЛНА

# … manifest + folder устгал хэвээр …

# ⚠️ ЯАГААД АНХДАГЧААР УСТГАХГҮЙ ВЭ: %APPDATA%\RevitMcpAddin дотор
#    settings.json (≈1 жилийн API токен), assistant-log.jsonl (илгээгдээгүй
#    сургалтын мөрүүдийн ЦОРЫН ГАНЦ хуулбар), timing.log, changes\*.json
#    байдаг.  Устгагчийг «буцаалт»-ын алхам болгож ажиллуулах нь тэр бүхнийг
#    сэргээгдэшгүй арчина.
$appdata = Join-Path $env:APPDATA 'RevitMcpAddin'
if ($PurgeData) {
    if (Test-Path $appdata) { Remove-Item -Recurse -Force $appdata; Write-Host "Локал өгөгдөл УСТГАГДЛАА." }
} else {
    Write-Host "Локал тохиргоо, токен, бүртгэл ХЭВЭЭР үлдлээ ($appdata)."
    Write-Host "Бүрэн устгах бол:  powershell -File uninstall.ps1 -PurgeData"
}
```

`Uninstall.bat` (`:223-224`) хэвээр — параметргүй тул анхдагчаар өгөгдөл хадгална.

### 3.7 REPORT HEALTH — `POST /api/revit/health`

`backend/src/routes/revit.ts`-д нэмнэ. **Router-ийн gate (`revit.ts:95`) автоматаар үйлчилнэ** — шинэ prefix, шинэ middleware, `lib/modules.ts`-ийн шинэ бүртгэл ШААРДЛАГАГҮЙ.

```ts
/**
 * POST /api/revit/health — суулгалтын эрүүл мэндийн тайлан (v2 §74).
 *
 * ⚠️ ЯАГААД `/api/revit` ДООР ВЭ: энэ router нь `revit.ts:95`-д
 * `requireRole(...REVIT_ROLES)`-оор хаагдсан ба `/api/revit` нь
 * `lib/workerScope.ts`-ийн зөвшөөрлийн жагсаалтад БАЙХГҮЙ тул `worker`
 * автоматаар 403 авна.  Шинэ дээд түвшний prefix үүсгэвэл тэр бүх
 * шалгалтыг ДАХИН хийх шаардлагатай болно.
 *
 * ⚠️ АКТОР НЬ ТОКЕНООС.  `user.sub` — биеийн `user_id`-г ХЭЗЭЭ Ч
 * хүлээж авахгүй (`learning.ts:338-340`-ийн ижил дүрэм).
 *
 * ⚠️ ЭНЭ ROUTE `purpose === 'mcp'` токеныг ХҮЛЭЭЖ АВНА.  Add-in өөр
 * токенгүй; татгалзвал ~20 ПК алсаас сэргээгдэхгүй.
 *
 * ⚠️ ХУВИЛБАРЫН НИЙЦГҮЙ БАЙДАЛ: сервер ХЭЗЭЭ Ч 4xx буцаахгүй, зөвхөн
 * `upgrade_required` тугийг өгнө.  Хуучин клиентийг алдаагаар зогсоох нь
 * v2 §74-ийн «fail gracefully and not corrupt user work»-ыг зөрчинө.
 */
revit.post('/health', async (c) => {
  const user = c.get('user');
  // ⚠️ Бүх талбар нэмэлт string; `health_json` нь ганц обьект.
  type HealthBody = Partial<Record<
    'machine_hash' | 'revit_year' | 'revit_build' | 'addin_version' | 'model_version'
    | 'model_source' | 'ruleset_version' | 'pack_sha256' | 'config_version'
    | 'release_sha256' | 'channel' | 'authority_level' | 'health', string
  >> & { health_json?: unknown };
  const b = await c.req.json<HealthBody>();

  const machineHash = str(b.machine_hash, 64);
  const revitYear   = str(b.revit_year, 8);
  const addinVer    = str(b.addin_version, 32);
  if (!machineHash || !revitYear || !addinVer) {
    return c.json({ error: 'machine_hash, revit_year, addin_version шаардлагатай' }, 400);
  }

  const health = ['ok', 'degraded', 'failed'].includes(String(b.health))
    ? String(b.health)
    : 'unknown';

  // health_json нь ОБЬЕКТ байх ёстой (0242-ийн CHECK-тэй ижил дүрэм).
  const hj =
    b.health_json && typeof b.health_json === 'object' && !Array.isArray(b.health_json)
      ? JSON.stringify(b.health_json).slice(0, 8_000)
      : '{}';

  await c.env.DB.prepare(
    `INSERT INTO addin_installs
       (user_id, machine_hash, revit_year, revit_build, addin_version,
        model_version, ruleset_version, config_version, health,
        pack_sha256, release_sha256, channel, model_source, authority_level,
        health_json, last_seen_at)
     VALUES (?,?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?, datetime('now'))
     ON CONFLICT (user_id, machine_hash, revit_year) DO UPDATE SET
       revit_build     = excluded.revit_build,
       addin_version   = excluded.addin_version,
       model_version   = excluded.model_version,
       ruleset_version = excluded.ruleset_version,
       config_version  = excluded.config_version,
       health          = excluded.health,
       pack_sha256     = excluded.pack_sha256,
       release_sha256  = excluded.release_sha256,
       channel         = excluded.channel,
       model_source    = excluded.model_source,
       authority_level = excluded.authority_level,
       health_json     = excluded.health_json,
       last_seen_at    = datetime('now')`,
  ).bind(
    user.sub, machineHash, revitYear, str(b.revit_build, 32),
    addinVer, str(b.model_version, 64), str(b.ruleset_version, 64),
    str(b.config_version, 128), health,
    str(b.pack_sha256, 64), str(b.release_sha256, 64),
    str(b.channel, 16) || 'prod', str(b.model_source, 16),
    str(b.authority_level, 8), hj,
  ).run();

  // Нийтлэгдсэн багц уу?  Танихгүй хэш нь «албан ёсны бус build» гэсэн үг.
  const rel = str(b.release_sha256, 64)
    ? await c.env.DB.prepare(
        `SELECT version, min_client, status FROM addin_releases
          WHERE sha256 = ? AND revit_year = ? LIMIT 1`,
      ).bind(str(b.release_sha256, 64), revitYear).first<{
        version: string; min_client: string | null; status: string;
      }>()
    : null;

  const latest = await c.env.DB.prepare(
    `SELECT version, min_client FROM addin_releases
      WHERE revit_year = ? AND channel = ? AND status = 'published'
      ORDER BY published_at DESC LIMIT 1`,
  ).bind(revitYear, str(b.channel, 16) || 'prod').first<{
    version: string; min_client: string | null;
  }>();

  return c.json({
    ok: true,
    recognised: Boolean(rel),                       // false = албан ёсны бус багц
    revoked: rel?.status === 'revoked',
    latest_version: latest?.version ?? null,
    // ⚠️ ЗӨВЛӨМЖ, АЛБАДЛАГА БИШ.  Клиент энэ тугаас болж ажлаа зогсоохгүй.
    upgrade_required:
      Boolean(latest?.min_client) && cmpVersion(addinVer, latest!.min_client!) < 0,
  });
});
```

**Клиент тал (`revit-mcp/addin/ApiClient.cs`):**

```csharp
/// <summary>
/// POST /api/revit/health — Revit нээгдэхэд НЭГ УДАА, арын thread-ээс.
///
/// ⚠️ ХЭЗЭЭ Ч БҮҮ БЛОКЛО.  Ямар ч алдаа чимээгүй залгигдана — эрүүл мэндийн
/// тайлан илгээгдээгүй нь ажилтны ажлыг зогсоох ёсгүй (v2 §75).
///
/// ⚠️ ЭНЭ БОЛ ГАНЦ ХҮСЭЛТ.  Давтахгүй, тогтмол хугацаагаар илгээхгүй —
/// `last_seen_at` нь «энэ машин өнөөдөр Revit нээсэн» гэдгийг л хэлнэ.
/// </summary>
public static async Task PostHealthAsync(string host, string token, SelfCheckResult sc)
{
    try
    {
        using HttpRequestMessage req =
            new HttpRequestMessage(HttpMethod.Post, Url(host, "/api/revit/health"))
            { Content = JsonContent(new {
                machine_hash = MachineHash(),      // sha256(MachineGuid) — НЭР БИШ
                revit_year   = sc.RevitYear,       revit_build     = sc.RevitBuild,
                addin_version= sc.AddinVersion,    model_version   = sc.ModelVersion,
                model_source = sc.ModelSource,     ruleset_version = sc.RulesetVersion,
                pack_sha256  = sc.PackSha256,      config_version  = sc.ConfigVersion,
                release_sha256 = sc.ReleaseSha256, channel = sc.Channel, health = sc.Health,
                health_json  = new { ok = sc.Ok, failed = sc.Failed, skipped = sc.Skipped, ts = sc.Ts },
            }) };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using HttpResponseMessage res = await Http.SendAsync(req).ConfigureAwait(false);
        // Хариуг УНШИНА, гэхдээ ЮУ Ч ЗОГСООХГҮЙ: upgrade_required нь
        // зөвхөн самбарын толгойд нэг мөр текст болно.
    }
    catch { /* ⚠️ Офлайн / 403 / 500 — БҮГД чимээгүй. §75. */ }
}
```

Дуудлагын цэг: `AssistantPane`-ийн одоо байгаа `SyncIntentModelSoon()`-ийн загвараар (`Task.Run` + `await`), самбар анх ачаалагдахад **нэг удаа**. `App.OnStartup`-аас **ДУУДАХГҮЙ** — тэр нь Revit-ийн ачаалалтын замд байна.

### 3.8 QTO push-д `addin_version` нэмэх

| # | Файл:мөр | Өөрчлөлт |
|---|---|---|
| 1 | `revit-mcp/addin/QtoDtos.cs:78-98` | `QtoPayload`-д `[JsonPropertyName("addin_version")] public string AddinVersion { get; set; }` нэмнэ; илгээгч талд `BuildInfo.Version` тавина |
| 2 | `backend/src/routes/qto.ts:680-694` | body-ийн төрөлд `addin_version?: string` нэмнэ |
| 3 | `backend/src/routes/qto.ts:856-872` | `summary`-д `addin_version: str(body.addin_version) || null` нэмнэ. ⚠️ **`schema_version` баганыг ХӨНДӨХГҮЙ** — `qto.ts:885`-ийн `'revit-2027'` хатуу утга хэвээр (түүнийг өөрчлөх нь `qto_runs`-ийн түүхэн мөрүүдийн утгыг зөрүүлнэ) |

⚠️ Энэ гурав нь **зөвхөн ажиглалт** — QTO-ийн ямар ч логик өөрчлөгдөхгүй, `push_id` дедупликац хэвээр, bind тоо хэвээр (`summary_json` нь нэг bind).

### 3.9 Тараалтын нийтлэлт — `addin_releases`-ыг бөглөх

`backend/src/routes/revitAddin.ts`-д (эзний gate ХЭВЭЭР):

```ts
/**
 * POST /api/revit-addin/releases — нийтэлсэн zip-ийн манифестыг бүртгэнэ.
 *
 * ⚠️ ЯАГААД ЗӨВХӨН БҮРТГЭЛ ВЭ: R2 руу байршуулах нь `node scripts/r2.mjs put`
 * -ээр гарын авлагаар хийгддэг (`backend/scripts/r2.mjs:19-36`).  Энэ route
 * нь тэр байршуулалтын ДАРАА ажиллаж, «яг ямар байт нийтлэгдсэн» гэдгийг
 * тогтооно.  Байршуулалт өөрөө энд шилжихгүй — Worker-ийн хүсэлтийн
 * хэмжээний хязгаар ~20 MB zip-д тохирохгүй.
 */
revitAddin.post('/releases', async (c) => {
  const user = c.get('user');                       // gate нь `:19-25`-д аль хэдийн
  const b = await c.req.json<{ ... }>();            // release.json + zip sha256
  // sha256 нь 64 тэмдэгт, bytes > 0, revit_year ∈ YEARS — эс бол 400.
  // INSERT … ON CONFLICT (version, revit_year, channel) DO UPDATE SET
  //   sha256/bytes/git_sha/built_at/status/notes/published_at
  //
  // ⚠️ Хэрэв ижил (version, revit_year, channel)-д ӨӨР sha256 ирвэл тэр нь
  // «нэг хувилбарын дугаараар хоёр өөр байт тараагдсан» гэсэн үг —
  // хариунд `sha_changed: true` буцааж, оператор мэдэх ёстой.
});

/** GET /api/revit-addin/releases — эзний хуудсанд түүх (мөн буцаалтын бай). */
revitAddin.get('/releases', async (c) => { /* ORDER BY published_at DESC LIMIT 50 */ });

/**
 * GET /api/revit-addin/fleet — ПАРКИЙН НЭГТГЭСЭН зураг.
 *
 * ⚠️ ЗӨВХӨН НЭГТГЭЛ.  `SELECT addin_version, revit_year, health, COUNT(*)`
 * — хэрэглэгчийн нэр, id, machine_hash ХЭЗЭЭ Ч буцаахгүй.  Энэ нь
 * 0201:23-32-ийн «өөрөө харах» тогтмолын шууд үргэлжлэл: суулгацын
 * эрүүл мэнд нь МАШИНЫ шинж чанар, ХҮНИЙ гүйцэтгэлийн үзүүлэлт БИШ.
 */
revitAddin.get('/fleet', async (c) => { /* GROUP BY addin_version, revit_year, health */ });
```

### 3.10 TEST — C# харшийг релизийн gate болгох

**Одоо байгаа механизм** (`revit-mcp/training/check_parity.py:158-160`, `check_nudge.py:161-168`): түр `.csproj` (`net10.0`) үүсгээд **ганц Revit-гүй `.cs` файлыг** `dotnet run`-аар эмхэтгэж, батлагдсан хүлээлттэй харьцуулна.

`revit-mcp/scripts/`-д шинэ `check-addin-pure.ps1` (эсвэл одоо байгаа Python загварыг давтсан `revit-mcp/training/check_pure.py`) нь дараах **Revit-гүй** файлуудыг тус бүрд нь эмхэтгэж, релизийн ӨМНӨ ажиллана:

| Файл | Яагаад Revit-гүй вэ |
|---|---|
| `Nudges.cs` | Толгойдоо `Autodesk.Revit` хэрэглэхгүй гэж зарласан; `check_nudge.py` аль хэдийн ажиллуулдаг |
| `Timing.cs` | Ижил дүрэм |
| `Percentiles.cs` | Ижил дүрэм |
| `TextFold.cs` | `check_parity.py` аль хэдийн ажиллуулдаг |
| `BuildInfo.cs` + шинэ `InstallCheck` | §3.5a — зориудаар цэвэр |
| `ChangeSetCoalescer.cs` (`2-4`) | Цэвэр байхаар зохиогдоно |
| `FindingFeed.cs` (`2-5`) | Цэвэр |
| `RuleEngine.cs`, `RuleFacts.cs`, `Units.cs` (`2-2`/`2-3`) | Гэрээгээр `Autodesk.Revit` хэрэглэхийг ХОРИГЛОСОН |

⚠️ **Энэ бол §74-ийн TEST шатны БҮРЭН БИШ, ГЭХДЭЭ БОДИТ хувилбар.** Revit API-тай холбогдсон код (46 файлын дийлэнх) тестгүй хэвээр — тэр нь §9-ийн эзний шийдвэр (Revit-тэй CI машин).

### 3.11 SIGN / VERIFY — хүлээн зөвшөөрсөн цоорхой

**Энэ сессид хэрэгжүүлэхгүй.** Шалтгаан: гэрчилгээ репод байхгүй, худалдан авалт нь инженерийн БИШ.

Бүртгэх зүйлс:

- csproj-д `SignAssembly` / `AssemblyOriginatorKeyFile` **байхгүй**; `signtool` ямар ч скриптэд байхгүй.
- Гарын үсэггүй байдал хэрэглэгчийн зааварт **шингэсэн**: `RevitAddinPage.tsx:167-168` — «гарын үсэггүй тул … Always Load сонго».
- §3.3-ийн `payload.sha256.txt` + `addin_releases.sha256` нь **бүрэн бүтэн байдлыг** (integrity) шалгана, **гарал үүслийг** (authenticity) БИШ. Хортой этгээд zip-ийг сольж, дотоод хэшийг нь дахин тооцоолж чадна.
- Тиймээс `addin_releases.sha256`-ыг **серверээс** (`GET /api/revit-addin/releases`) шалгах нь цорын ганц бодит баталгаа — §3.7-ийн `recognised: false` тугийн үүрэг тэр.

§9-д эзний үйлдэл болгож бичив.

### 3.12 Баримтжуулалтын залруулга

| # | Файл:мөр | Өөрчлөлт |
|---|---|---|
| 1 | `revit-mcp/README.md:146-147` | «build нь DLL + .addin-ыг `%APPDATA%\Autodesk\Revit\Addins\<он>` руу АВТОМАТААР хуулна» гэсэн нь **2026-08-28-наас хойш ХУДАЛ** (`csproj:194-195`-ийн `DeployToRevit` gate). `-p:DeployToRevit=true` шаардлагатайг бич |
| 2 | `revit-mcp/docs/ASSISTANT.md:462` | Ижил алдаа: `-p:AddinDeployDir=C:\Temp\x` нь ганцаараа **идэвхгүй** болсон. `-p:DeployToRevit=true`-тэй хамт бичихийг зааж өг |
| 3 | `revit-mcp/docs/ASSISTANT.md` (§7-ийн эрүүл мэндийн жагсаалт) | R1-ийн хүлээн авах шалгуур болгож §3.5-ийн шинэ `Test.bat` гаралт + `POST /api/revit/health`-ийг нэм |

---

## 4. ХӨНДӨЖ БОЛОХГҮЙ (load-bearing)

| Юу | Хаана (баталгаажсан) | Яагаад эвдрэх вэ |
|---|---|---|
| `purpose === 'mcp'` токеныг `/api/*` хүлээж авах | `middleware/auth.ts:101-102`, `types.ts:209-212`, `lib/tokenValidity.ts:30-34` | Add-in-д refresh урсгал БАЙХГҮЙ. Татгалзвал ~20 ПК дээр бүх REST дуудлага үхнэ; засах ганц арга нь гар суулгалт. **Шинэ `POST /api/revit/health` ЧАНГА ижил токеныг хүлээж авна** |
| `users` / `projects`-ыг `migrations apply`-аар дахин байгуулахгүй | 19 / 33 cascade хүүхэд | Cascade delete нь бүх хүүхэд мөрийг арчина. 0242 зөвхөн `REFERENCES users(id)` тавина |
| `-p:DeployToRevit=true` gate | `csproj:167-173`, `:194-195` | 2026-08-28-нд энгийн `dotnet build` дөрвөн амьд суулгацыг WIP-ээр дарж бичсэн. Хамгаалалтыг сулруулах нь тэр ослыг эргүүлж авчирна |
| `Optimize=true` нь `Configuration.StartsWith('Release')`-д | `csproj:89-91` | Стандарт `'$(Configuration)'=='Release'`-д буцаавал бүх «Release Rxx» дахин оптимизацгүй болно; `2-4`-ийн латентын төсөв утгагүй болно |
| `ApiClient.cs`-ийн `MglRevitAddin/` UA угтвар | `ApiClient.cs:58-84` (2026-08-25 хэмжсэн) | UA байхгүй → Cloudflare 403/1010 Worker-т хүрэхээс өмнө. Бүх REST АЛСААС зогсоно, сэргээх ганц арга нь гар суулгалт |
| `package-addin.ps1:182-186` нь `bin\x64\<cfg>`-ээс савладаг | `csproj:181-183`-ын тайлбар үүнийг ил хэлсэн | Савлалтыг `DeployAddin` target руу холбовол савлах бүрд энэ машины амьд суулгац дарагдана |
| `%APPDATA%\RevitMcpAddin`-ыг устгахгүй | `package-addin.ps1:104-109`, `SettingsStore.cs:18,23`, `AssistantLog.cs:144` | ≈1 жилийн токен + илгээгдээгүй сургалтын мөрүүдийн цорын ганц хуулбар. §3.6-ийн `-KeepData` анхдагчийг буцаах нь R1-ийн «алдаагүй өгөгдөл цуглуулах»-ыг шууд зөрчинө |
| Буурааж суулгахаас өмнө `assistant-log.jsonl` хуулах | `AssistantLog.cs:163` (танихгүй талбар хаягдана), `:211-220` (бүтэн дахин бичилт), `:258`/`:319`/`:479` (дуудлагын цэгүүд) | Хугацааны болон event талбарууд тухайн машин дээр БУЦААШГҮЙ устана |
| `revit.ts:95`-ийн router gate | `REVIT_ROLES` = engineer/architect/senior/admin | Шинэ health route энэ gate-ийн ДООР байх ёстой. Дээд түвшний шинэ prefix үүсгэвэл `lib/modules.ts`-ийн `API_PREFIXES` + `MODULE_OF`-д бүртгэхгүй бол `entitlementGuard` түүнийг ангилалгүй нэвтрүүлнэ |
| `qto.ts:885`-ийн `'revit-2027'` хатуу утга | `qto_runs.schema_version` | Түүхэн мөрүүд бүгд тэр утгатай. Одоо өөрчилвөл шинэ ба хуучин run-ууд харьцуулагдахгүй болно. `addin_version` нь `summary_json`-д орно, багана БИШ |
| `test-bridge.ps1`-ийн 3-р алхмын аюулгүй байдлын шалгалт | `:108-117` (токенгүй → 401, буруу токен → 401, `/execute` → 403) | Энэ бол add-in-ийн локал гүүрний ганц регрессийн тор. Алхмуудыг дугаарлан өөрчлөхөд эдгээрийг ХАДГАЛНА |
| Өөрөө харах тогтмол | `0201_bim_artifacts.sql:23-32` ба гурван migration толгойд давтагдсан; `revitNoteAi.test.ts:262`-т түгжигдсэн | `addin_installs`-ийн УНШИХ route бүр өөрийн мөр эсвэл НЭГТГЭЛ. «Хэн муу суулгацтай вэ» гэсэн хүн нэрлэсэн жагсаалт нь дөрвөн газар баримтжуулсан дүрмийг зөрчинө |
| Trigger дотор `END;` том үсгээр өөрийн мөрөнд | wrangler splitter regex | 0241/0242-д trigger байхгүй; өөр агент энэ файлд trigger нэмвэл заавал мөрдөнө |

---

## 5. ДАРААЛАЛ БА ХАМААРАЛ

### Урьдчилсан нөхцөл

| # | Нөхцөл | Хэрхэн шалгах |
|---|---|---|
| 1 | Миграцийн сүүл `0216` хэвээр эсвэл дугаар тохируулагдсан | `ls backend/migrations \| tail -5` |
| 2 | 0212–0216 продакшнд ХЭРЭГЖСЭН эсэх | `SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 20` (§9.1) |
| 3 | Windows build машин: `dotnet` (net48/net8/net10 SDK) + `pwsh` | Тэр машин дээр `dotnet --list-sdks` |
| 4 | `2-2`-ийн `RulePack` нийлсэн эсэх | Нийлээгүй бол §3.5a-ийн 4-р алхам `skipped` бичнэ — **блоклохгүй** |

### Deploy дараалал

```
1.  backend/migrations/0241_addin_releases.sql   (шинэ файл)
2.  backend/migrations/0242_addin_installs.sql   (шинэ файл)
        ↓
3.  npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml
        ↓          ⚠️ ШИНЭ БАГАНА НЬ ТҮҮНИЙГ УНШДАГ КОДООС ХАТУУ ӨМНӨХ DEPLOY-Д ГАРНА
4.  npx wrangler deploy --config wrangler.toml        (POST /health, /releases, /fleet)
        ↓
5.  node backend/scripts/check-bim-events.mjs         (0241/0242 нь BIM хүснэгт хөндөөгүйг батал)
        ↓
─── эндээс ЦААШ нь Windows build машин дээр ───────────────────
6.  pwsh -File revit-mcp\scripts\package-addin.ps1 -Build      (BUILD ×4 → PACKAGE → MANIFEST → HASH)
        ↓
7.  ⚠️ АРХИВЛАЛТ (§8):  dist\*.zip + dist\*.manifest.json → РЕПОГИЙН ГАДНА
        ↓
8.  node backend/scripts/r2.mjs put media revit-addin/RevitMcpAddin-Revit2027.zip --file=… --remote   (×4)
        ↓
9.  POST /api/revit-addin/releases  (×4 — манифест бүрээр)
        ↓
10. ⚠️ НЭГ МАШИН ДЭЭР УА ТУРШИЛТ: 401 (403 БИШ) ирж байгааг батал
        ↓
11. ~20 ПК × Install.bat (Revit ХААЛТТАЙ) → Test.bat → POST /api/revit/health
```

### Зэрэг хэрэгжүүлж БОЛОХ Track 2 баримтууд

**Энэ баримт нь схемийн түвшинд ямар ч Track 2 баримтаас ХАМААРАХГҮЙ.** 0241/0242 нь `bim_sessions`, `learning_events`, `compliance_findings`, `rules` — аль нь ч хөндөхгүй, тэдгээрээс уншихгүй.

| Баримт | Зэрэг хэрэгжүүлж болох уу | Тайлбар |
|---|---|---|
| `2-1-team-context` (0217–0219) | ✅ ТИЙМ | Огт огтлолцохгүй |
| `2-2-rule-model` (0220–0223) | ✅ ТИЙМ, ГЭХДЭЭ | `BuildInfo.SelfCheck()`-ийн 4-р алхам `RulePack.LoadedVersion` / `LoadedSha256` гэсэн ХОЁР НЭРИЙГ түүнээс авна (`RulePack.cs` нь `2-2`-ийн хөндөх файл). Нэр өөр болвол §3.5a-ийн try/catch блокийг тохируулна — **дараалал шаардахгүй** |
| `2-3-compliance-engine` (0224, 0225, 0229) | ✅ ТИЙМ | Огт огтлолцохгүй |
| `2-4-nonblocking-runtime` (0226–0228, 0230) | ✅ ТИЙМ, ГЭХДЭЭ | `addin_installs.authority_level` нь түүний `0230_compliance_authority.sql`-ийн `app_settings` түлхүүрээс гаралтай. Байхгүй үед багана `null` үлдэнэ — **дараалал шаардахгүй** |
| `2-5-finding-surface` (0237) | ✅ ТИЙМ | Огт огтлолцохгүй |
| `2-6-team-training` (0238–0240) | ✅ ТИЙМ | Огт огтлолцохгүй |
| `2-7-readiness-and-quality` (миграцгүй) | ✅ ТИЙМ | Огт огтлолцохгүй |

⚠️ **Зөвхөн ГАРАЛТЫН цэг нь дараалалтай:** дээрх бүх баримтын **C# нь энэ баримтын суулгагчаар л ажилтанд хүрнэ**. Хэрэгжүүлэлт нь зэрэг, тараалт нь нэг.

### 5.3 НЭГ РЕЛИЗЭД заавал багтах Track 2-ийн C# өөрчлөлтүүд

`1C-addin-release.md:11-14`-ийн дүрэм: аль нэгийг нь хойшлуулбал ~20 ПК-ийн өртөг **хоёр дахин** гарна. Track 2-ийн жагсаалт (1C-ийн §3.1–§3.12-ийн ҮРГЭЛЖЛЭЛ):

| # | Өөрчлөлт | Эзэн | Файл |
|---|---|---|---|
| 13 | `RawRing.Append` — `OnDocumentChanged`-ийн одоо байгаа `lock (Gate)` дотор НЭГ бичилт | `2-4` | `ChangeTracker.cs` |
| 14 | `_flushTimer`-ыг өөрөө-дахин-зэвсэглэдэг нэг цохилт + re-entrancy хамгаалалт + pid-суффикстэй tmp | `2-4` | `ChangeTracker.cs` |
| 15 | `ComplianceScheduler` — өөрийн `IsBackground` thread, хязгаартай дараалал | `2-4` | ШИНЭ |
| 16 | `BimEmitter` — өөрийн thread, `BlockingCollection(4096)`, backoff, circuit breaker | `2-4` | ШИНЭ |
| 17 | `RevitToolBus.TryCall` (`Gate.Wait(0)`) + `UserBusy` + `CancelAll()` | `2-4` | `RevitToolBus.cs` |
| 18 | `collect_rule_inputs` хэрэгсэл (≤150 элемент, 1500 мс дотоод төсөв, `more`/`cursor`) | `2-3` | `RevitTools.cs` |
| 19 | `set_compliance_badge` хэрэгсэл + ribbon товчны caption-ыг статикт хадгалах | `2-5` | `RevitTools.cs`, `App.cs` |
| 20 | `RuleEngine` / `RuleFacts` / `Units` / `RuleFactExtractor` / `RulePack` | `2-2`,`2-3` | ШИНЭ |
| 21 | `ChangeSetCoalescer` | `2-4` | ШИНЭ |
| 22 | `FindingFeed` (dedup → snooze → ack → root-collapse → budget) | `2-5` | ШИНЭ |
| 23 | Session handshake — актор нэр, хэшлэсэн SID, `pack_sha256` | `2-1` | `ApiClient.cs` |
| **24** | **`InstallCheck.Run()` + `ApiClient.PostHealthAsync()`** | **энэ баримт** | `BuildInfo.cs`, `ApiClient.cs` |
| **25** | **`QtoPayload.AddinVersion`** | **энэ баримт** | `QtoDtos.cs` |
| 26 | `App.OnShutdown`-ийн шинэ дараалал (`ComplianceCts.Cancel` → `CancelAll` → …) | `2-4` | `App.cs` |

⚠️ **Аль нэг нь бэлэн биш бол релизийг БҮХЭЛД НЬ хойшлуул.** Хагасыг нь гаргах нь §8-ийн буцаалтын өртгийг хоёр дахин нэмнэ.

---

## 6. ХҮЛЭЭН АВАХ ШАЛГУУР

### Схем ба сервер

- [ ] `ls backend/migrations | tail -5` → `0242_addin_installs.sql` хамгийн сүүлд
- [ ] `d1 migrations apply` → `0241`, `0242` хоёулаа `d1_migrations`-д мөртэй
- [ ] `PRAGMA table_info(addin_releases)` → **14** багана, `sha256` нь `CHECK (length(sha256) = 64)`-тай
- [ ] `PRAGMA table_info(addin_installs)` → `sc_failed` багана `GENERATED` төлөвтэй
- [ ] `SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND tbl_name='addin_installs'` → **3** (uniq, version, bad)
- [ ] `node backend/scripts/check-bim-events.mjs` → **exit 0** (0241/0242 нь BIM хүснэгтийн bind тоог хөндөөгүй)
- [ ] `cd backend && npx tsc --noEmit` → өөрийн файлуудад алдаа **0**
- [ ] `cd backend && npm test` → суурьтай ижил (44/44 эсвэл түүнээс дээш)
- [ ] `POST /api/revit/health` `engineer` токеноор → **200**, биед `{ ok: true, recognised, latest_version, upgrade_required }`
- [ ] Ижил `(user_id, machine_hash, revit_year)`-оор ХОЁР УДАА илгээх → `addin_installs`-д **1 мөр**, `last_seen_at` шинэчлэгдсэн
- [ ] `POST /api/revit/health` `client` эсвэл `worker` токеноор → **403** (`revit.ts:95` gate)
- [ ] `machine_hash` дутуу биетэй → **400**
- [ ] Танихгүй `release_sha256`-тай → **200** ба `recognised: false` (алдаа БИШ)
- [ ] `GET /api/revit-addin/fleet` → биед `user_id`, `username`, `machine_hash` **нэг ч удаа гарахгүй** (`grep`-ээр батал)
- [ ] `GET /api/revit-addin/releases` эзэн бус токеноор → **403** (`revitAddin.ts:19-25`)

### Савлалт (Windows build машин)

- [ ] `pwsh -File scripts\package-addin.ps1 -Build` → `dist\` дотор **4 zip + 4 manifest.json**
- [ ] Zip нэг нь задлагдахад дотроос `release.json` **БА** `payload.sha256.txt` гарна
- [ ] `payload.sha256.txt`-ийн мөрийн тоо = `RevitMcpAddin\` доторх файлын тоо
- [ ] Санаатай нэг `bin\x64\Release R25` фолдер устгаад дахин ажиллуулах → скрипт **exit ≠ 0**, «Дутуу релиз: 2025» гэж хэлнэ
- [ ] `Get-FileHash` zip → `dist\*.manifest.json`-ийн `sha256`-тай яг таарна

### Суулгагч (жинхэнэ Revit-тэй ПК)

- [ ] **Гараар:** Revit НЭЭЛТТЭЙ байхад `Install.bat` → «АЛДАА: Revit ажиллаж байна», **exit 1**, суулгац ХЭВЭЭР
- [ ] **Гараар:** `payload.sha256.txt`-ийн нэг мөрийг санаатай гуйвуулаад суулгах → «ЗӨРСӨН: …», суулгалт ЦУЦЛАГДАНА, **хуучин суулгац ажилласаар байна**
- [ ] **Гараар:** Revit хаалттай, зөв багц → «Суулгалт АМЖИЛТТАЙ. Хувилбар: 1.x.y», **exit 0**
- [ ] **Гараар:** Revit 2027 суугаагүй машин дээр 2027-ийн багц → анхааруулга + асуулт (энэ бол суулгагчийн ЦОРЫН ГАНЦ асуулт)
- [ ] `%APPDATA%\Autodesk\Revit\Addins\<он>\RevitMcpAddin\release.json` үүссэн
- [ ] `Addins\<он>` доторх **ӨӨР борлуулагчийн** файлын Mark-of-the-Web төлөв өөрчлөгдөөгүй
- [ ] `uninstall.ps1` параметргүй → `%APPDATA%\RevitMcpAddin` ХЭВЭЭР, `settings.json` байсаар
- [ ] `uninstall.ps1 -PurgeData` → тэр фолдер устсан

### Өөрийн шалгалт ба эрүүл мэнд

- [ ] **Гараар:** Revit 2027 дээр `Test.bat` → бүх алхам, төгсгөлд `release.json`-ийн хувилбар хэвлэгдэнэ
- [ ] **Гараар:** Revit **2024** дээр `Test.bat` → «bridge — Revit 2024-д MCP гүүр БАЙХГҮЙ (зориудаар)» гэж **АЛГАСна**, **exit 0** (өмнө нь exit 1 байсан)
- [ ] Самбар нээгдсэний дараа `addin_installs`-д тухайн машины мөр үүссэн, `health = 'ok'`
- [ ] Токен арилгаад Revit дахин нээх → `health = 'degraded'`, `health_json.failed` дотор `not_signed_in`
- [ ] `2-2` нийлээгүй үед → `ruleset_version IS NULL` **БА** `health_json.skipped` дотор `ruleset_absent`, `health` нь `'ok'` ХЭВЭЭР
- [ ] Сүлжээгүй үед Revit нээх → нэмэлт **ХЭВИЙН ажиллана**, ямар ч алдааны цонх гарахгүй (`PostHealthAsync`-ийн чимээгүй catch)
- [ ] QTO push хийсний дараа `qto_runs.summary_json` дотор `addin_version` талбар байна; `schema_version` нь `'revit-2027'` **ХЭВЭЭР**

### Хамрах хүрээ

- [ ] `git status --short` → зөвхөн §0-д жагсаасан 11 файл
- [ ] Бусад агентын дуусаагүй файл **ХӨНДӨГДӨӨГҮЙ**
- [ ] `npm run build` унавал алдаа зөвхөн хамааралгүй файлд байгааг батал

---

## 7. ШАЛГАХ КОМАНД

```bash
# --- 1. МИГРАЦИЙН ДУГААР ---
ls backend/migrations | tail -5
# Хүлээгдэх: 0216_assistant_log_timing.sql хамгийн сүүлд.
# Өөр бол зэрэгцээ сесс дугаар авсан — §3.0-г шинэчил.

ls backend/migrations | wc -l
# Хүлээгдэх: 206 (0241/0242 нэмэхийн ӨМНӨ)

# --- 2. СХЕМИЙН ГВАРД (ALTER-ийн ӨМНӨ) ---
# ⚠️ `cd backend` нь ЭНЭ БЛОКОД ЗӨВХӨН НЭГ УДАА.  Доорх 2–8-р хэсгийн бүх
#    команд `backend/`-ээс ажиллана; давтан `cd backend` бичвэл хоёр дахь
#    удаадаа «cd: no such file or directory: backend» өгөөд араас нь ирэх
#    шалгалтууд ОГТ АЖИЛЛАХГҮЙ өнгөрнө.
cd backend
node --test src/lib/migrationSchema.test.ts
# Хүлээгдэх: pass.  Энэ гвард 0214/0215 хоёулаа `reviewed_at` нэмэх шахсаны дараа үүссэн.

# --- 3. МИГРАЦ ХЭРЭГЖҮҮЛЭХ (WORKER DEPLOY-ЫН ӨМНӨ) ---
# (аль хэдийн `backend/` дотор байгаа — 2-р хэсгийг үз)
npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml
# Хүлээгдэх: 0241_addin_releases.sql, 0242_addin_installs.sql — хоёулаа applied.
# ⚠️ --config wrangler.toml ЗААВАЛ: репогийн үндэст байгаа wrangler.jsonc нь
#    ӨӨР worker (`name: "mgl"`) зарладаг ба wrangler түүнийг сонгож болзошгүй.

npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 4"
# Хүлээгдэх: 0242, 0241, 0216, 0215

# --- 4. СХЕМИЙН БАТАЛГАА ---
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "PRAGMA table_info(addin_installs)"
# Хүлээгдэх: 20 мөр; sc_failed нь GENERATED (dflt_value NULL, hidden=2 буюу VIRTUAL)

npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('addin_releases','addin_installs') ORDER BY name"
# Хүлээгдэх: idx_addin_inst_bad, idx_addin_inst_uniq, idx_addin_inst_version,
#            idx_addin_rel_sha, idx_addin_rel_uniq, idx_addin_rel_year

# --- 5. BIM BIND АРИФМЕТИК ХӨНДӨГДӨӨГҮЙ ---
node scripts/check-bim-events.mjs
# Хүлээгдэх: exit 0.  0241/0242 нь bim_sessions / learning_events хөндөөгүй.

# --- 6. ТИП + ТЕСТ ---
npx tsc --noEmit
# Хүлээгдэх: өөрийн файлуудад алдаа 0 (өөр агентын файлд байвал ЧИНИЙХ БИШ)
npm test
# Хүлээгдэх: суурьтай ижил

# --- 7. WORKER DEPLOY (МИГРАЦИЙН ДАРАА) ---
npx wrangler deploy --config wrangler.toml

# --- 8. ROUTE-ЫН ДАМЖУУЛАЛТ (deploy-ийн дараа) ---
# ӨМНӨ: 404 (route байхгүй) ;  ДАРАА: 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H "Authorization: Bearer $ENGINEER_TOKEN" -H 'Content-Type: application/json' \
  -H 'User-Agent: MglRevitAddin/1.2.0' \
  -d '{"machine_hash":"'"$(printf 'test' | shasum -a 256 | cut -c1-64)"'","revit_year":"2027","addin_version":"1.2.0","health":"ok","health_json":{"ok":["addin_version"],"failed":[],"skipped":[]}}' \
  "$API/api/revit/health"
# Хүлээгдэх: 200

# Давхардал: ижил биеэр ХОЁР дахь удаа → мөр НЭГ хэвээр
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT COUNT(*) AS n, MAX(last_seen_at) AS seen FROM addin_installs"
# Хүлээгдэх: n = 1

# Эрхийн шалгалт
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $CLIENT_TOKEN" \
  -H 'User-Agent: MglRevitAddin/1.2.0' -H 'Content-Type: application/json' -d '{}' \
  "$API/api/revit/health"
# Хүлээгдэх: 403

# --- 9. ӨӨРӨӨ ХАРАХ ТОГТМОЛЫГ БАТЛАХ ---
curl -s -H "Authorization: Bearer $OWNER_TOKEN" "$API/api/revit-addin/fleet" \
  | grep -c -E '"user_id"|"username"|"machine_hash"'
# Хүлээгдэх: 0

# --- 10. САВЛАЛТ (WINDOWS BUILD МАШИН) ---
# pwsh -File revit-mcp\scripts\package-addin.ps1 -Build
# Хүлээгдэх: dist\ дотор 4 zip + 4 manifest.json, төгсгөлд «Дутуу: (хоосон)»
# pwsh -Command "Expand-Archive dist\RevitMcpAddin-Revit2027.zip -DestinationPath $env:TEMP\chk -Force; Get-ChildItem $env:TEMP\chk"
# Хүлээгдэх: release.json ба payload.sha256.txt хоёулаа байна

# --- 11. UA РЕГРЕССИЙН ТУРШИЛТ (ТАРААХААС ӨМНӨ, НЭГ МАШИН ДЭЭР) ---
curl -s -o /dev/null -w '%{http_code}\n' -H 'User-Agent: MglRevitAddin/1.2.0' \
  -H 'Authorization: Bearer INVALID' "$API/api/revit/context?doc_uid=x"
# Хүлээгдэх: 401  (403 БИШ.  403 ирвэл Cloudflare BIC хаасан — ТАРААХГҮЙ)
curl -s -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer INVALID' \
  "$API/api/revit/context?doc_uid=x"
# Хүлээгдэх: 403  (UA-гүй хүсэлт хаагдана — ApiClient.cs:58-84-ийн 2026-08-25 хэмжилтийн давталт)

# --- 12. ХАМРАХ ХҮРЭЭ ---
git status --short
git diff --stat
# Зөвшөөрөгдсөн ЗӨВХӨН:
#   backend/migrations/0241_addin_releases.sql
#   backend/migrations/0242_addin_installs.sql
#   backend/src/routes/revit.ts
#   backend/src/routes/revitAddin.ts
#   revit-mcp/addin/BuildInfo.cs
#   revit-mcp/addin/ApiClient.cs
#   revit-mcp/addin/QtoDtos.cs
#   revit-mcp/scripts/package-addin.ps1
#   revit-mcp/scripts/test-bridge.ps1
#   revit-mcp/README.md
#   revit-mcp/docs/ASSISTANT.md
# git add -A БҮҮ хэрэглэ — файл бүрийг нэрээр нь нэм.
```

**Гар туршилт (Revit нээлттэй / жинхэнэ ПК шаардана, автоматжуулах боломжгүй):**

1. Revit 2027 НЭЭЛТТЭЙ байхад `Install.bat` → «АЛДАА: Revit ажиллаж байна», exit 1, хуучин суулгац ХЭВЭЭР ажиллана.
2. `payload.sha256.txt`-ийн нэг хэшийг гуйвуулаад суулгах → «ЗӨРСӨН», цуцлагдана, `RevitMcpAddin.new` үлдэхгүй.
3. Revit 2024 дээр `Test.bat` → bridge алхам АЛГАСагдана, дүн ногоон, exit 0.
4. Revit 2027 дээр `Test.bat` → бүх алхам, төгсгөлд хувилбар хэвлэгдэнэ.
5. Самбар нээгээд `addin_installs`-д мөр үүссэнийг сервер талаас батал.
6. Сүлжээ салгаад Revit дахин нээх → ямар ч алдааны цонх гарахгүй, нэмэлт хэвийн.
7. `uninstall.ps1` (параметргүй) → `settings.json` ба `assistant-log.jsonl` ХЭВЭЭР.

---

## 8. ROLLBACK

⚠️ **ЭНЭ БОЛ ЭНЭ БАРИМТЫН ХАМГИЙН ЧУХАЛ ХЭСЭГ. ӨНӨӨДӨР БУЦААХ АРТЕФАКТ ОГТ БАЙХГҮЙ.**

### 8.0 Тараахаас ӨМНӨ заавал биелэх нөхцөл

`1C-addin-release.md:1394` нь буцаалтын байг ингэж нэрлэсэн:

> «`revit-mcp/dist/`-ийн 2026-08-24-ний zip-үүд … ⚠️ `dist/` git-д ороогүй тул **тэдгээр нь ЗӨВХӨН энэ машин дээр** байна»

**Хэмжсэн гаралт (2026-08-30):**

```
$ ls revit-mcp/dist
ls: revit-mcp/dist: No such file or directory
$ ls revit-mcp/addin/bin
ls: revit-mcp/addin/bin: No such file or directory
$ sed -n '8,13p' revit-mcp/.gitignore
# .NET build output
addin/bin/
addin/obj/

# Packaged distribution zips (produced by scripts/package-addin.ps1)
dist/
```

⇒ **Нэрлэсэн буцаалтын бай БАЙХГҮЙ.** Эхний муу релиз одоогийн байдлаар **сэргээгдэшгүй**.

**Тиймээс, эхний тараалтаас ӨМНӨ ЗААВАЛ:**

- [ ] `dist\*.zip` (4 ширхэг) **БА** `dist\*.manifest.json` (4 ширхэг) — **РЕПОГИЙН ГАДНА** архивлагдсан (R2-ийн `revit-addin/archive/<version>/` эсвэл компанийн файл сервер). ⚠️ Репод commit хийхгүй: zip нь ~10-20 MB, git-ийн түүх нь тараалтын архив БИШ.
- [ ] Тэдгээр zip-ийн манифест `POST /api/revit-addin/releases`-ээр `addin_releases`-д бүртгэгдсэн (энэ нь sha256-ийн **давхардаагүй** бүртгэл).
- [ ] Одоо суусан (өмнөх) хувилбарын дугаар нь `addin_releases`-д мөртэй эсвэл `status='superseded'` гэж тэмдэглэгдсэн.
- [ ] Хамгийн багадаа **НЭГ** ПК дээр шинэ багц суугаад `Test.bat` ногоон, `POST /api/revit/health` ирсэн.

### 8.1 Миграцийг буцаах

**⚠️ ШИНЭ ДУГААР ЗААВАЛ** — хэрэгжсэн файлыг засах нь продакшн дээр **ЧИМЭЭГҮЙ NO-OP** (`d1_migrations`-д мөр байгаа тул дахин ажиллахгүй).

| Алхам | Буцаах арга |
|---|---|
| `apply`-ийн ӨМНӨ | Файлыг устгаад commit-ыг revert. **Өгөгдлийн эрсдэл: ТЭГ** |
| `apply`-ийн ДАРАА | `DROP TABLE addin_installs` / `addin_releases` — **ШИНЭ дугаартай** миграцаар. **Өгөгдлийн эрсдэл: ЗӨВХӨН эрүүл мэндийн телеметр** — хоёр хүснэгт нь өөр ямар ч хүснэгтийн эцэг БИШ, ямар ч FK тэднийг заадаггүй |
| Хагас хэрэгжсэн файл | 0241/0242 нь тус бүр 4 statement, бүгд `IF NOT EXISTS` — **дахин ажиллуулж болно**. Гэвч `d1_migrations`-д мөр байхгүй бол засах цорын ганц хууль ёсны арга нь **ШИНЭ ДУГААР** |
| Worker код | `git revert <commit>` → `npx wrangler deploy --config wrangler.toml`. Багануудыг **D1-д ХЭВЭЭР ҮЛДЭЭ** — хоосон хүснэгт хор хоргүй, харин DROP хийх нь дахин apply хийхэд төөрөгдөл үүсгэнэ |

### 8.2 Add-in-ыг буцаах — ХАМГИЙН ҮНЭТЭЙ АЛХАМ

| Юу | Хэрхэн буцаах |
|---|---|
| **Ажилтны компьютер** | ⚠️ Автомат буцаалт **БАЙХГҮЙ**. §8.0-ийн архиваас өмнөх zip-ийг гаргаж, ~20 машин дээр `Install.bat`-ыг **Revit ХААЛТТАЙ** үед ажиллуулна. **Ийм учраас энэ бол НЭГ релиз** |
| **Буцаахын ӨМНӨ (1)** | ⚠️ **`%APPDATA%\RevitMcpAddin\assistant-log.jsonl`-ыг машинаас ХУУЛЖ АВ.** Хуучин add-in JSON-ыг анхдагч тохиргоогоор задалж танихгүй талбарыг хаядаг (`AssistantLog.cs:163`), дараа нь `Save()` файлыг санах ойн мөрүүдээс **бүтнээр дахин бичдэг** (`:211-220`) — амжилттай flush тутамд (`:479`), 👍/👎-д (`:319`), тайралтад (`:258`). Хугацааны ба event талбарууд **БУЦААШГҮЙ** устана |
| **Буцаахын ӨМНӨ (2)** | ⚠️ `Uninstall.bat`-ыг **буцаалтын алхам болгож БҮҮ АЖИЛЛУУЛ.** `-PurgeData`-гүй ч гэсэн шинэ суулгагч нь `Install.bat`-аар дээрээс нь бичих ба тэр нь илүү аюулгүй. `-PurgeData` нь ≈1 жилийн токеныг устгаж, ажилтан бүрийг дахин нэвтрүүлнэ |
| **Буцаахын ӨМНӨ (3)** | `%APPDATA%\RevitMcpAddin\events\*.jsonl` (`2-4`-ийн офлайн дараалал) мөн хуулагдана — тэр нь илгээгдээгүй нийцлийн event-үүдийн ганц хуулбар |
| **`release.json`** | Хуучин add-in түүнийг уншдаггүй — нийцтэй, буцаалт шаардахгүй |
| **`settings.json`** | Формат өөрчлөгдөөгүй тул хуучин add-in уншина (1C §3.9a-ийн ижил дүгнэлт) |
| **`0241`/`0242` багана** | Add-in буцаавал `POST /api/revit/health` илгээгдэхээ болино. **Хүснэгтүүдийг ХЭВЭЭР ҮЛДЭЭ** — хоосон бүртгэл хор хоргүй |
| **Тараалтын R2 обьект** | `revit-addin/RevitMcpAddin-Revit<он>.zip`-ыг архивын хуучин байтаар дарж бич, дараа нь `POST /api/revit-addin/releases`-ээр `status='revoked'` тэмдэглэ |

### 8.3 Rollback-ийн шалгуур

Дараах шинж тэмдгүүдийн **аль нэг** нь бүрэн буцаалтыг зөвтгөнө:

- Аль нэг ПК дээр Revit **нээгдэхгүй** болсон эсвэл MGL таб гарахаа больсон.
- Аль нэг ПК дээр `Install.bat` дараа `RevitMcpAddin` фолдер байхгүй үлдсэн (энэ нь §3.4-ийн засварыг ажиллаагүй гэсэн үг — суулгагчийг **эхлээд** зас, бүх парк руу бүү тарааж бай).
- `POST /api/revit/health`-ийн `recognised: false` **олон** машинаас ирж байгаа (албан ёсны бус эсвэл гэмтсэн багц тархсан).
- REST дуудлагууд **403 / error 1010** буцааж эхэлсэн — UA регресс. Энэ тохиолдолд буцаалт нь мөн гар суулгалт; §7-ийн 11-р туршилт үүнээс сэргийлэх зорилготой.
- Revit нээгдэхэд мэдэгдэхүйц удаашрал гарсан (`PostHealthAsync` нь арын thread дээр байх ёстой; ачаалалтын замд орсон бол буцаа).

### 8.4 ХЭСЭГЧИЛСЭН тараалт

⚠️ Хэрэв 20 машины 8-д нь шинэ багц суугаад асуудал илэрвэл: **үлдсэн 12-т нь БҮҮ ТАРАА**, суусан 8-ыг архиваас буцаа. `addin_installs.addin_version`-ийн нэгтгэлээр (`GET /api/revit-addin/fleet`) аль машин аль хувилбартайг мэдэх боломжтой — энэ нь тараалтын түүхэнд **анх удаа** боломжтой болж буй зүйл.

---

## 9. ЭХЛЭХИЙН ӨМНӨ ТОДРУУЛАХ

> Эдгээрийг репогоос **ХАРИУЛАХ БОЛОМЖГҮЙ** — эзэн эсвэл продакшны асуулга шаардана.

### 9.1 Продакшны асуулга шаардлагатай (эхлэхээс өмнө нэг удаа)

```bash
cd backend

# a) 0212-0216 продакшнд ХЭРЭГЖСЭН ҮҮ?  Хэрэв үгүй бол add-in аль хэдийн
#    БАЙХГҮЙ багана руу addin_version, timing_json бичиж байна.
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 20"

# b) Одоо талбар дээр АЛЬ хувилбарууд явж байна вэ?  (Одоогийн ЦОРЫН ГАНЦ эх сурвалж.)
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT addin_version, COUNT(DISTINCT user_id) AS people, MAX(created_at) AS seen FROM assistant_logs WHERE addin_version IS NOT NULL GROUP BY addin_version ORDER BY seen DESC"

# c) Хэдэн ажилтан add-in-ыг ЕРӨӨСӨӨ ашигласан бэ (парк хэр том вэ)?
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT COUNT(DISTINCT user_id) FROM assistant_logs"

# d) QTO-оор л ирдэг (өөрөөр хэлбэл b)-д ҮЛ ҮЗЭГДЭХ) хэдэн хүн байна вэ?
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT COUNT(DISTINCT created_by) FROM qto_runs WHERE source = 'revit'"

# e) R2-д ЯМАР багц одоо байгаа вэ (тараалтын одоогийн байдал)?
npx wrangler r2 object get mgl-media/revit-addin/RevitMcpAddin-Revit2027.zip --remote --file=/dev/null
```

### 9.2 Эзэн / гадаад тал шаардлагатай — инженерийн БИШ

| # | Асуулт | Яагаад чухал | Юуг өөрчилнө |
|---|---|---|---|
| 1 | **Гэрчилгээ (code signing) худалдаж авах уу?** | §74-ийн SIGN/VERIFY шат гэрчилгээгүйгээр биелэхгүй. Гарын үсэггүй байдал хэрэглэгчийн зааварт шингэсэн (`RevitAddinPage.tsx:167-168`) | Тийм бол csproj + `package-addin.ps1`-д `signtool` шат нэмэгдэнэ. Үгүй бол **ХҮЛЭЭН ЗӨВШӨӨРСӨН БАЙНГЫН ЦООРХОЙ** гэж бүртгэнэ |
| 2 | **Ажилтан суулгагчаа өөрөө татаж болох уу?** | `revitAddin.ts:9` `OWNER_ID = 1` + `RevitAddinPage.tsx:32,48` + `Layout.tsx:606` — гурван файлын өөрчлөлт | Тийм бол R1 нь өөрөө-үйлчлэх; үгүй бол ~20 гар тараалт хэвээр |
| 3 | **Windows build машин хаана байх вэ?** | Энэ ажлын машинд `dotnet`, `pwsh` **БАЙХГҮЙ**. BUILD/PACKAGE/TEST шат гүйцэтгэгдэх газаргүй | Тогтмол машин байвал CI боломжтой; үгүй бол нэг хүний ноутбук — §74-ийн BUILD дахин давтагдахгүй |
| 4 | **Архивын байршил хаана вэ?** | §8.0 — репогийн ГАДНА, zip ~10-20 MB × 4 × хувилбар бүр | R2-ийн `revit-addin/archive/`, компанийн файл сервер, эсвэл гадаад диск |
| 5 | **`revit-mcp/dist/`-ийн 2026-08-24-ний zip-үүд ХААНА НЭГТЭЭ байгаа юу?** | `1C-addin-release.md:1394` тэднийг буцаалтын бай гэж нэрлэсэн; энэ машин дээр **БАЙХГҮЙ** | Байвал шууд архивла. Байхгүй бол **өмнөх хувилбар руу буцах боломж алдагдсан** — дараагийн релиз нь эхний архивлагдсан бай болно |
| 6 | **QTO push нь `requireAdmin()` хэвээр байх уу?** | `qto.ts:678` — энгийн инженерийн add-in QTO push хийж ЧАДАХГҮЙ. R1-ийн «алдаагүй өгөгдөл цуглуулах»-д шууд нөлөөтэй | Энэ баримтын хамрах хүрээнээс ГАДУУР, гэхдээ R1-ийн блокер. Тусдаа шийдвэр |
| 7 | **Ажилтны мэдэгдэл, гэрээ шинэчлэгдсэн үү?** | Commit `9fe82a0`-д «Ажилтны мэдэгдэл, гэрээ ЗААВАЛ шинэчлэгдэнэ» гэж бичсэн; `bim.capture.notice_version` нь **ирээдүйн** огноо (`0208:37`). `addin_installs` нь `machine_hash`-ыг нэмж хадгална | Шинэчлэгдээгүй бол тараалт **эхлэхгүй** |

### 9.3 Хэмжигдээгүй — ХЭН Ч ТООЛООГҮЙ

| # | Асуулт | Одоогийн байдал |
|---|---|---|
| 8 | **Парк яг хэдэн машин вэ?** «~20 ПК» гэдэг нь бүх баримтад давтагдсан ГЭХДЭЭ хэмжигдээгүй тоо | `assistant_logs`-оос доод хязгаар нь гарна (§9.1 c), гэхдээ QTO-оор л ирдэг хүн тэнд харагдахгүй. `addin_installs` нь энэ асуултад **анх удаа** хариулах хүснэгт |
| 9 | **Нэг машин дээр хэдэн Revit он зэрэг суусан байна вэ?** | 0242-ийн грэйн `(user_id, machine_hash, revit_year)` нь олон оныг зөвшөөрдөг; бодит тархалт тодорхойгүй |
| 10 | **Roaming profile ашиглагддаг уу?** | Ашиглагддаг бол `%APPDATA%` нь СҮЛЖЭЭНИЙ I/O болно — `InstallCheck`-ийн `appdata_writable` шалгалт тэрхүү нөхцөлд удаан ажиллаж болзошгүй. **ТААМАГ** — шалгагдаагүй |
| 11 | **`Get-Process -Name 'Revit'` нь бүх Revit хувилбарт нэг нэртэй юу?** | Autodesk-ийн процессын нэр 2024–2027 хооронд `Revit` хэвээр гэж ТААМАГЛАВ. Windows машин дээр `Get-Process | Where-Object Name -like '*evit*'`-ээр батлах шаардлагатай |
| 12 | **`$env:ProgramFiles\Autodesk\Revit <он>` нь суулгалтын байршлыг найдвартай илэрхийлэх үү?** | Стандарт суулгалтад тийм; сүлжээний/өөрчилсөн суулгалтад **ТААМАГ**. §3.4-ийн 2-р алхам түүнийг **зөвлөмж** болгосон (`Read-Host`-оор үргэлжлүүлэх боломжтой) яг энэ шалтгаанаар |

### 9.4 Track 2-ийн бусад баримтаас хамаарах цэг

| # | Асуулт | Хэн хариулах |
|---|---|---|
| 13 | `RulePack.LoadedVersion` / `LoadedSha256` гэсэн НЭР эцсийн эсэх | `2-2-rule-model` (`RulePack.cs` түүний хөндөх файл). Өөр бол §3.5a-ийн 4-р алхмын try/catch блокийн дуудлагыг л солино — **бүтэц өөрчлөгдөхгүй** |
| 14 | `authority_level` нь `app_settings['bim.compliance.authority_level']`-ээс клиент рүү ЯМАР сувгаар очих вэ | `2-4`. Хүртэл `addin_installs.authority_level` нь `null` |
| 15 | `machine_hash`-ыг ЯГ юунаас тооцох вэ (MachineGuid уу, өөр үү) | `2-1-team-context` нь session handshake-д ижил утга хэрэглэнэ — **хоёр газар ижил функц** байх ёстой, эс бол нэг машин хоёр өөр хэшээр харагдана |
| 16 | ✅ **ШИЙДЭГДСЭН — 0229 дугаар ХОЁР баримтад зарлагдсан байв** — `2-3`-ын `0229_rule_run_ledger.sql` ба `2-4`-ийн `0229_compliance_authority.sql` (2026-08-30-нд `docs/bim-ai/`-аас шалгасан) | `2-3` ба `2-4`. Файлын НЭР өөр тул хоёул хэрэгжинэ, гэвч дараалал нь зөвхөн үсгийн эрэмбээр тодорхойлогдох ба **репод аль хэдийн 0080 дээр яг ийм эмзэг байдал бүртгэгдсэн**. 0241/0242-т нөлөөлөөгүй. **`2-0-OWNER-BRIEF` §3.5 шийдвэрлэв: 0229 нь `2-3`-ынх, `2-4`-ийн `compliance_authority` нь 0230 руу шилжсэн** (§3.0) |

---

### Хавсралт — энэ сессид БАТЛАГДААГҮЙ зүйлс

| Мэдэгдэл | Төлөв |
|---|---|
| 0212–0216 продакшнд хэрэгжсэн эсэх | **ТААМАГ** — продакшны D1 энэ машинаас хүрэхгүй (Cloudflare API 7403). §9.1 a) |
| Парк «~20 ПК» | **ТААМАГ** — репогийн баримтуудад давтагдсан тоо, хэмжигдээгүй |
| `Get-Process -Name 'Revit'` бүх хувилбарт таарна | **ТААМАГ** — Windows машингүй тул шалгаагүй |
| `$env:ProgramFiles\Autodesk\Revit <он>` замын найдвартай байдал | **ТААМАГ** — тиймээс §3.4-д зогсоолт БИШ, анхааруулга болгосон |
| `package-addin.ps1` / `install.ps1` / `test-bridge.ps1`-ийн бодит ажиллагаа | **ТААМАГ** — `pwsh` энэ машинд байхгүй; бүх дүгнэлт эх кодыг УНШСАН баталгаа |
| Revit 2024 дээр `Test.bat` баталгаатай унана | **КОДООС ГАРГАСАН ДҮГНЭЛТ** — `test-bridge.ps1:76-86` + `App.cs:77-101` + `csproj:99-102` гурвын нийлбэр. Бодит Revit 2024 дээр ажиллуулж баталгаажуулаагүй |
| `revit-mcp/dist/`-ийн 2026-08-24-ний zip-үүдийн байршил | **ОЛДООГҮЙ** — энэ машин дээр `dist/` фолдер огт байхгүй |
