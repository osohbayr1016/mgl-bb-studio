# Хувийн тусгаар Revit-д шалгах хэрэгсэл

Хөгжүүлэгчийн машинд **өөрийн** асаасан Revit-д, загварын **хуулбар** дээр нэмэлтийг шалгана. Хэрэглэгчийн / хуваалцсан Revit-д
хэзээ ч ашиглахгүй. Хадгалахгүй.

| Файл | Үүрэг |
|---|---|
| `BbHarness.csproj`, `App.cs` | Туршилтын жижиг нэмэлт: `MGL_BB_HARNESS_DIR` орчны хувьсагчгүй бол юу ч хийхгүй. `<run>\cmd\*.cmd` командыг уншиж, нэрлэсэн DLL-ийг байтаар ачаалж (дахин бүтээж болно) `static string Run(UIApplication, string outDir, string args)`-ыг дуудна. Үр дүн `<run>\out\<id>.result.txt`. Сануулах цонхыг өөрөө хаана (`<run>\dialogs.manual` байвал хаахгүй). |
| `start.ps1` | Тухайн оны Revit ажиллаж байвал татгалзана. Түр манифестаар harness-ийг ачаалж Revit-ийг (сонголтоор загвартай) асаана, ачаалагдмагц манифестыг устгана. |
| `gate.ps1` | `MglBb.Gate.Entry.Run`-ийг дуудна. DLL өгөгдмөлөөр `src\MglBbStudio\bin\x64\Release R24\MglBbStudio.dll`. |
| `send.ps1` | Ерөнхий команд (`op=open`, эсвэл өөр DLL). |
| `dialog-watch.ps1` | Тэр Revit-ийн сануулах цонхыг бүртгэнэ. |
| `load-test.ps1` | Шинэ DLL-ийг түр манифестаар ачаалж «MGL ББ» таб гарч ирэхийг шалгаад тэр Revit-ийг хаана. |
| `ui-drive.ps1`, `offscreen.ps1`, `winshot.ps1` | Цонхыг UIA-аар удирдах, Revit-ийг дэлгэцнээс гадуур харуулах, зураг авах. |

## Жишээ

```powershell
# 1) harness бүтээх (Revit 2024 суусан байх)
dotnet build tools\revit-harness\BbHarness.csproj -p:RevitYear=2024
# 2) нэмэлтийг бүтээх
dotnet build src\MglBbStudio\MglBbStudio.csproj -c "Release R24" -p:Platform=x64
# 3) загварын ХУУЛБАРыг бэлдэх (эх файлыг хэзээ ч биш)
$run = "$env:TEMP\bb-run1"; New-Item -ItemType Directory -Force "$run\model" | Out-Null
Copy-Item '<ЖИШЭЭ-1.rvt>' "$run\model\example1.rvt"
# 4) хувийн Revit асаах
powershell -ExecutionPolicy Bypass -File tools\revit-harness\start.ps1 -Year 2024 -Run $run -Model "$run\model\example1.rvt"
# 5) шалгалт ажиллуулах — args = "learn" | "generate:<elementId>[;opts]" | "annotate:<viewId>" … (src\MglBbStudio\Gate\GateEntry.cs, GateOps.cs)
powershell -ExecutionPolicy Bypass -File tools\revit-harness\gate.ps1 -Run $run -Id t1 -GateArgs "learn"
# 6) дуусмагц pids.txt-ийн Revit-ийг (зөвхөн өөрийнхөө) хаана
```

Анхаар: эзэмшигч Revit цонх жижигрүүлсэн үед түүний WPF цонх харагдахгүй — `offscreen.ps1`-ээр дэлгэцнээс гадуур сэргээнэ.
TaskDialog-ийн command link-д UIA pattern байхгүй — `ui-drive.ps1` нь `TDM_CLICK_BUTTON` илгээнэ.
