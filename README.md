# MGL ББ Студи — бүтээцийн ажлын зургийн Revit нэмэлт

> *Revit 2024–2027 add-in that learns MGL's structural working-drawing standard from a finished project and generates annotated beam,
> column, wall and slab drawings, sheets and schedules from modelled rebar. Docs are in Mongolian.*
>
> Хамтран хөгжүүлэх: [CONTRIBUTING.md](CONTRIBUTING.md) · хийх ажил: [Issues](https://github.com/osohbayr1016/mgl-bb-studio/issues)

Барилга бүтээцийн (ББ) инженерт зориулсан **тусдаа** Revit нэмэлт. Дууссан төслөөс (ЖИШЭЭ-1) компанийн ажлын зургийн
стандартыг сурч, загварчилсан арматураас дамнуруу, багана, цутгамал хана, хучилтын дэлгээс / огтлол / төлөвлөгөөг тэр
стандартаар үүсгэж тэмдэглэнэ, хуудсанд байрлуулж түүврийг хувилна, асуудлыг «Асуудал – Шийдэл» Excel-ээр солилцоно.

Эх даалгавар: «САЙЖРУУЛАЛТ ББ.pdf» (2026-10-19). Жишээ загвар:
`\\192.168.0.157\Public new\73. Өсөхбаяр.О\MGL Plugin\Ажлын зураг хийх\ЖИШЭЭ-1.rvt`.

Одоогийн хувилбар **0.2.0** — Revit 2024–2027.

## Яагаад тусдаа репо

Энэ код өмнө нь `mgl-e-c` репогийн `revit-mcp/bbstudio` хавтсанд, үндсэн MGL plugin-ий хөдөлгүүрийг **линкээр** эмхэтгэж байсан.
Одоо бие даасан: хөдөлгүүрийн хэрэгтэй 52 файл `src/Engine`-д хуулагдсан тул энэ хавтсаас л бүтээгдэнэ, `mgl-e-c` шаардлагагүй.

- Өөр assembly (`MglBbStudio.dll`), AddInId (`b6d2f1a4-3c8e-4e7b-9a51-0f2c7d8e9a13`), манифест (`MglBbStudio.addin`), ribbon таб «MGL ББ».
- Үндсэн MGL plugin-ий файл, тохиргоог хөндөхгүй. Өгөгдөл `%APPDATA%\MGL\BbStudio`, DLL `%LOCALAPPDATA%\MGL\BbStudio`.
- Үндсэн plugin-тэй холбоо ганцхан: **лиценз** (`Infra/MainPlugin.cs` → reflection-оор `RevitMcpAddin.Licensing.LicenseGate.Ensure`).
  Тиймээс Revit-д үндсэн MGL plugin суусан, нэвтэрсэн байх ёстой.

## Бүтэц

| Хавтас | Агуулга |
|---|---|
| `src/MglBbStudio/` | Нэмэлт өөрөө — дэлгэрэнгүй [src/MglBbStudio/README.md](src/MglBbStudio/README.md) |
| `src/MglBbStudio/Core/` | Revit-гүй цэвэр код: стандарт, сурах статистик, байрлалын математик, JSON, XLSX, «Асуудал – Шийдэл» |
| `src/MglBbStudio/Revit/` | Стандарт сурах, харагдац/хуудас/түүвэр үүсгэх, тэмдэглэх |
| `src/MglBbStudio/Flows/`, `Commands/` | 4 командын урсгал (Стандарт сурах · Зураг үүсгэх · Тэмдэглэх · Асуудал) |
| `src/MglBbStudio/Gate/` | Хөгжүүлэгчийн тусгаар Revit-ийн шалгалтын оролт (`MglBb.Gate.Entry.Run`) |
| `src/MglBbStudio/installer/`, `package.ps1` | Ажилтанд тараах zip (Install.bat / Uninstall.bat) |
| `src/Engine/` | Үндсэн MGL plugin-ий арматурын хөдөлгүүрийн **хуулбар** (жагсаалт `engine-files.txt`) |
| `tests/BbStudio.Tests/` | `Core`-ийн тест (Revit хэрэггүй) |
| `tools/revit-harness/` | Хувийн тусгаар Revit-д шалгах хэрэгсэл — [README](tools/revit-harness/README.md) |
| `tools/sync-engine.ps1` | Хөдөлгүүрийг `mgl-e-c`-ээс шинэчлэх |
| `docs/ROADMAP.md` | Дараагийн ажлууд (эрэмбээрээ) |
| `mgl-bb/` | ЛАВЛАГАА: ББ Студи анх хөгжсөн `mgl-e-c` репогийн хуулбар (салаа `feat/bb-drawing-studio` @ `1f88d505`, 2026-10-20) — үндсэн MGL plugin (`mgl-bb/revit-mcp/addin`), ERP, бүх баримт. `build.ps1` үүнийг БҮТЭЭХГҮЙ. `.claude/` (нууц токентой) хасагдсан |

## Шаардлага

- Windows, **.NET SDK 10** (`dotnet --version` ≥ 10.0). Revit API багцыг NuGet-ээс (Nice3point.Revit.Api) татна — Revit суулгаагүй ч бүтээгдэнэ.
- Ажиллуулж шалгахад Revit 2024 / 2025 / 2026 / 2027 + үндсэн MGL plugin.

## Бүтээх, шалгах

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1                 # R24–R27 бүгд + тест
powershell -ExecutionPolicy Bypass -File build.ps1 -Years 2024     # нэг он
dotnet build src\MglBbStudio\MglBbStudio.csproj -c "Release R24" -p:Platform=x64
cd tests\BbStudio.Tests; dotnet run                                 # цэвэр тест (20)
powershell -ExecutionPolicy Bypass -File src\MglBbStudio\package.ps1   # dist\<v>\MGL-BB-Studio-<v>.zip
```

Visual Studio / Rider: `MglBbStudio.sln` — тохиргоо «Release R24 … R27» (x64).
Хувилбар өсгөх: `src/MglBbStudio/MglBbStudio.csproj`-ийн `<Version>` ба `<FileVersion>`.

Суулгах: zip-ийг задлаад `Install.bat`. Revit нээлттэй байсан ч болно — шинэ хувилбар хажууд нь суугаад дараагийн нээлтэд ачаалагдана.

## Хөгжүүлэлтийн дүрэм

1. **Хэрэглэгчийн / хуваалцсан Revit дээр ХЭЗЭЭ Ч туршихгүй.** Зөвхөн `tools/revit-harness`-ийн хувийн Revit, загварын **хуулбар** дээр,
   хадгалахгүй. Хуваалцсан Revit-д API-аар загвар нээх (`OpenDocumentFile`) нь Revit-ийг унагаж байсан.
2. Өөрийн асаасан Revit процессоо л хаана — бусдынхыг хэзээ ч.
3. `src/Engine`-ийг энд засахаас зайлсхий. Засвал үндсэн plugin-ээс салж, дараагийн `sync-engine.ps1` таны засварыг дарна.
   Сайжруулалтыг хөдөлгүүрийн оролт/гаралт дээр (`src/MglBbStudio`) хий.
4. Кирилл бичвэртэй `.ps1` файл **UTF-8 BOM**-той байх ёстой (Windows PowerShell 5.1). `Get-Content | Set-Content`-ээр репогийн файлыг бүү дамжуул.
5. `Core/` дотор `Autodesk.Revit` бүү ашигла — тест эмхэтгэгдэхгүй болно.

## Хөдөлгүүрийн хуулбар

`src/Engine` = `mgl-e-c` репогийн `revit-mcp/addin`-аас `engine-files.txt`-д жагсаасан файлууд, эх commit нь `src/Engine/SOURCE.txt`-д.
Үндсэн plugin-д засвар орсны дараа:

```powershell
powershell -ExecutionPolicy Bypass -File tools\sync-engine.ps1 -From C:\Users\User\project\mgl-e-c          # юу өөрчлөгдөхийг харуулна
powershell -ExecutionPolicy Bypass -File tools\sync-engine.ps1 -From C:\Users\User\project\mgl-e-c -Apply   # хуулна
```

Дараа нь бүтээж, тестлээд, хувийн Revit-д шалгана.

## Одоогийн төлөв (0.2.0)

Ажилладаг (хувийн Revit 2024, ЖИШЭЭ-1-ийн хуулбар дээр шалгасан): дамнуруу, туслах дамнуруу, багана, цутгамал хана, хучилтын харагдац,
хэмжээс, MRA шошго, хуудас (цувралын дугаар, параметр), түүвэр хувилах, «Асуудал – Шийдэл» Excel (харагдац руу очих, шийдсэн тэмдэглэх).
Revit 2027.2-д таб ачаалагдана. Тест 20/20.

**Арматур үүсгэх** («Арматур» самбар): «Дамнурууны арматур» ба «Баганын арматур» — ЖИШЭЭ-1-ээс хэмжсэн компанийн хэв маяг эсвэл
СП 52-101, марк бүрийн мөртэй цонх, LIRA CSV-ээс санал, өмнө үүсгэснийг солино.  ЖИШЭЭ-1-ийн хуулбар дээр (Revit 2024): ДН-2 6 алгасал —
142–149 элемент, Б-5-1 28 давхар — 740 элемент, алдаагүй; бүх загварыг уншихад дамнуруу 3 с, багана 1.6 с.  Дэлгэрэнгүй
[src/MglBbStudio/README.md](src/MglBbStudio/README.md#дамнурууны-арматур-үүсгэх-арматур--дамнурууны-арматур).

Мэдэгдэж буй дутуу: хучилтын 1:20 огтлол ба түүвэр, «800» давхцлын хэмжээс, суурь / шат / рамын огтлол, хэт өндөр түүврийг хуудсанд
багтаах, ханын төлөвлөгөөний огтлолд MRA шошго давхцах. Дэлгэрэнгүй [docs/ROADMAP.md](docs/ROADMAP.md).
