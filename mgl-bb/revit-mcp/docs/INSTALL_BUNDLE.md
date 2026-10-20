# Нэгдсэн суулгах багц — `MGL-Revit-Addin-<хувилбар>.zip` (2026-09-30, 1.7.0-оос)

> **Нэршил / ribbon (2026-10-03, add-in UI/UX шинэчлэл):** ribbon-ы самбарууд **Ажил · Зураг · Арматур · Түүвэр · Шалгалт · Экспорт · Сан ба тохиргоо** болсон, товч бүр хоёр мөрт богино нэртэй, дэлгэрэнгүй тайлбар нь «Хэрэгсэл хайх» цонхонд.
> Энэ баримтад хуучин нэр гарвал: Smart Count → **Элемент тоолох**, Clash шалгах → **Давхцал шалгах**, Smart Publish → **Файл гаргах**, Зураг клонлох → **Зураг хувилах**,
> Автомат хэмжээс → **Хэмжээс, тэмдэглэгээ**, Хуулж тавих → **Элемент хуулах**, Preflight → **Гаргахын өмнөх шалгалт**, «Загвар»/«Smart» самбар → **Зураг** / **Шалгалт**/**Түүвэр**/**Экспорт**.
> Команд, класс, `PushButtonData.Name`, AddInId, тохиргооны түлхүүр **өөрчлөгдөөгүй**. Бүрэн зураглал: [`MGL_UI_UX_REDESIGN.md`](MGL_UI_UX_REDESIGN.md) §5.2.

Ажилтанд тараах ЦОРЫН ГАНЦ файл.  Задлаад `Install.bat` дарахад суусан Revit (2024–2027) бүрд
MGL нэмэлтийг **шинэчилнэ** (1.5, 1.6, хөгжүүлэгчийн build — ямар ч аргаар суусан байсан), байхгүй
бол **шинээр суулгана**.  Өмнө нь тараалт 5+ файлтай хавтас байсан (зөвхөн 2027-ийн Setup exe +
он бүрийн zip тус бүрдээ Install.bat) — хүн аль нэгийг нь сонгох ёстой байв.

```
MGL-Revit-Addin-1.7.0\
  Install.bat            → setup\install-all.ps1   (Install.bat -DryRun = юу хийхийг л харуулна)
  Uninstall.bat          → setup\install-all.ps1 -Uninstall   (локал өгөгдөл хадгалагдана)
  README.txt             ← installer\bundle-README.txt (хувилбар бүрт хэрэгслийн жагсаалтыг шинэчил)
  ТУРШИХ-*.txt           ← dist\<хувилбар>\*.txt автоматаар
  demo\                  ← -Include-ээр
  setup\install-all.ps1  (BOM)   он бүрийг илрүүлж install.ps1-ийг ТУСДАА процесст дуудна, нэг тайлан
  setup\install.ps1      (BOM)   Setup exe-ийнхтэй ЯГ ижил суулгагч, -Year <он> -Source setup\<он>
  setup\<он>\payload.zip + release.json
```

## Барих, турших

```
powershell -NoProfile -ExecutionPolicy Bypass -File revit-mcp\installer\build-bundle.ps1 -Build -Isolated -Include 'revit-mcp\dist\1.6.0\demo'
powershell -NoProfile -ExecutionPolicy Bypass -File revit-mcp\installer\test-bundle.ps1       # 53 шалгалт
powershell -NoProfile -ExecutionPolicy Bypass -File revit-mcp\installer\test-installer.ps1    # 2027 Setup exe, 43
```

**`-Isolated` (1.8.0, 2026-10-01):** `addin\`-ийг `%TEMP%\mgl-addin-iso-<хувилбар>\` руу хуулж (obj, bin-гүй)
тэндээс 4 Release тохиргоог барина.  Шалтгаан: хуваалцсан `addin\obj` дахь WPF-ийн хоёр дамжлагатай
markup compile хагас дутуу төлөвт орвол `error BG1002: ...\obj\x64\Release R24\<Цонх>.baml cannot be found`
гэж унадаг (хэд хэдэн агент зэрэг build хийхэд, эсвэл өмнөх build тасрахад) — `-p:IntermediateOutputPath`
өөрчлөхөд ч мөн унана.  Хувилбар гаргахдаа ҮРГЭЛЖ `-Isolated`-тэй бар: хуулбар нь script эхлэх агшинд авагддаг
тул build явж байхад `addin\`-д хийсэн засвар орохгүй, харин бусад агентын дутуу (commit хийгээгүй) засвар
багтана — тиймээс `release.json` `git_dirty=true` гэж тэмдэглэнэ.

## Хувилбар бүрт юу байх ёстой

| Хэрэгсэл | Revit 2024 (net48) | 2025–2027 |
|---|---|---|
| MGL ажил / туслах, Зураг холбох, Тоо хэмжээ, PDF, Хүснэгт | ✔ | ✔ |
| Хуудас үүсгэх, **Хуудас дугаарлах**, Хуулж тавих, Зураг клонлох, Автомат хэмжээс | ✔ | ✔ |
| **Smart** (Өөрчлөлтийн нөлөө, Smart Count, Clash шалгах, Smart Publish), MGL ажлын самбар, Family Hub | — (`#if MGL_SMART` + `Compile Remove`) | ✔ |

Smart нь Revit 2024-д ОРООГҮЙ нь алдаа биш — net48 дээр `MGL_INTELLIGENCE/MGL_FAMILYHUB/MGL_WORK_TRACKING/
MGL_SMART` тэмдэг тодорхойлогддоггүй.  `installer\verify-bundle.ps1` нь бодит zip-ийг задалж (суулгахгүй)
он бүрийн хэш, FileVersion, `release.json`-г шалгаад DLL-д ямар команд БАЙГААГ тулгана (2024:
`SmartPublishCommand` г.м. АЛГА; 2025–2027: БАЙНА; бүх онд `SheetNumeratorCommand` БАЙНА) — 1.8.0: 89/89.
Шинэ ribbon команд нэмбэл түүний класс нэрийг тэр скриптийн `$common` / `$newer` жагсаалтад нэм.

`test-bundle.ps1` нь бодит zip-ийг задлаад Install.bat-ыг тусгаарлагдсан APPDATA/LOCALAPPDATA руу
(`MGL_ADDIN_TEST_*`, `MGL_ADDIN_TEST_YEARS` — аль Revit он «суусан» гэж дуурайх) ажиллуулна: шинэ ПК;
1.5.1 Setup exe-ээр суусан 2027 + 1.5.1 zip Install.bat-аар суусан 2025-ийг шинэчлэх; дахин
ажиллуулах; Revit нээлттэй; гэмтсэн payload (хуучин нь хэвээр); устгах; Revit огт алга.  Энэ ПК-ийн
жинхэнэ нэмэлт, registry хөндөгдөхгүй.  IExpress exe ажиллуулдаг тул агентын Bash/PowerShell sandbox-оос
гадуур ажиллуулна.

## Дүрмүүд

- **Нэг суулгагч, олон он.** `installer\install.ps1` одоо `-Year`, `-Source`, `-ResultFile` авна;
  параметргүй бол 2027 + скриптийн хавтас — Setup exe-ийн зан төлөв ӨӨРЧЛӨГДӨӨГҮЙ (43/43).  Он бүр
  өөрийн хувилбарын хавтас (`%LOCALAPPDATA%\MGL\RevitAddin\<он>\versions\<хувилбар>`), манифест,
  «Apps & features» мөр (`MGL.RevitAddin.<он>`).
- **Хуучин хувилбарыг манифестаас уншина** (`Installed-Version`): `Addins\<он>\RevitMcpAddin.addin`
  → AddInId таарвал Assembly зам (харьцангуй бол Addins хавтаснаас) → хажуугийн `release.json`, эсвэл
  DLL FileVersion.  Тиймээс Setup exe, zip Install.bat, dev build гурвуулаа танигдана.
- AddInId ба манифестын нэр бүх хуучин суулгацтай ИЖИЛ → давхар нэмэлт үүсэхгүй; хуучин
  `Addins\<он>\RevitMcpAddin` хавтас болон бусад `versions\*` устгагдана (Revit түгжсэн бол дараа нь).
- Revit нээлттэй байсан ч суулгана (хажуу хавтсанд), тайланд «хааж дахин нээ» гэнэ.
- Хэш зөрвөл тухайн он унана, хуучин суулгац бүрэн хэвээр, бусад он үргэлжилнэ, exit 1.
- `%APPDATA%\RevitMcpAddin` (токен, илгээгдээгүй ажлын цаг) хэзээ ч хөндөгдөхгүй.
- Zip-ийг `[IO.Compression.ZipFile]::CreateFromDirectory`-аар (Compress-Archive биш) — Explorer-ийн
  «Extract All» кирилл нэр, хавтсыг зөв задалсныг шалгасан.
- `.bat` нь ASCII (cmd OEM код хуудсаар уншдаг); zip-ийн дотроос шууд ажиллуулбал «бүрэн задал» гэнэ.
- Гарын үсэггүй: SmartScreen («More info → Run anyway») ба Revit-ийн «Always Load» нэг удаа.

Хэмжсэн (энэ ПК, `Install.bat -DryRun`, 1.8.0): Revit 2024 (MGL 1.1.0) → 1.8.0, Revit 2027 (MGL 1.2.2 dev)
→ 1.8.0 шинэчлэхээр; 2025/2026 Revit алга тул алгасна.  Энэ ПК-ийн бодит `Addins\2024`, `Addins\2027`
(манифестын нэр «Revit MCP», харьцангуй зам, хөгжүүлэгчийн хавтас) хуулбарыг тусгаарлагдсан root-д
шинэчилж үзэхэд: хоёулаа 1.8.0 болно, давхар манифест үүсэхгүй, хуучин `RevitMcpAddin` хавтас арилна,
өөр нэмэлт (`pyRevit.addin`) хөндөгдөхгүй, `%APPDATA%\RevitMcpAddin` хэвээр (14/14).

## Шинэчлэлт хэрхэн ирдэг (одоогийн байдал)

**Гар тараалт.** Ажилтан хамгийн сүүлийн zip-ийг авч (хавтас/мессенжер) задлаад `Install.bat` дахин дарна —
суусан хувилбарыг нь манифестаас уншиж ЗӨВХӨН түүн дээр нь шинэчилнэ.  Сервер дээрээс өөрөө татаж
шинэчлэх (auto-update) механизм БАЙХГҮЙ: `POST /api/revit/health` нь `latest_version` / `upgrade_required`
буцаадаг, add-in зөвхөн «Шинэ хувилбар гарсан байна (x). IT-д хандана уу» гэж хэлнэ
(`AssistantPane.xaml.cs` `ReportHealthSoon`).  Auto-update нэмэх бол: (1) zip-ийг R2 + `addin_releases`-д
бүртгэх, (2) бүх ажилтанд нээлттэй (одоогийн `/api/revit-addin/download` зөвхөн эзэнд) эрхтэй татах зам,
(3) add-in дотор татах + SHA-256 шалгах + `Install.bat`-ийг дуудах код, (4) worker deploy, (5) гарын
үсэггүй кодыг серверээс татаж ажиллуулах нь аюулгүй байдлын шийдвэр (код гарын үсгийн гэрчилгээ байхгүй,
зөвхөн SHA-256).  Эзэнтэй зөвшилцөөгүй тул хийгээгүй.
