# Revit ↔ MGL

Revit 2024–2027-д зориулсан MGL-ийн add-in. Хоёр зүйл хийдэг:

1. **Явцын бүртгэл** — инженер Revit дотроос өдрийн ажлаа монголоор бичиж
   MGL сайт руу илгээнэ. Хувийг дэд жагсаалтаас тооцож, тэмдэглэлийг AI
   бэлдэнэ; хүн уншиж баталгаажуулна.
2. **MCP гүүр** — Claude (Desktop / Code) амьд Revit session-той typed
   хэрэгслээр ярилцана.

> ⚠️ **2026-08-24 — аюулгүй байдлын өөрчлөлт.** Локал bridge одоо **токен
> шаардана**, дурын C# гүйцэтгэх нь **анхдагчаар унтраалттай**. Дэлгэрэнгүйг
> [Аюулгүй байдал](#аюулгүй-байдал) хэсгээс.

---

## Явцын бүртгэл (өдөр тутам)

```
Revit доторх «MGL туслах» самбар
   │  «хийснээ илгээ»
   ▼
POST /api/revit/draft        ← сервер хувийг тооцож, монгол тэмдэглэл бичнэ
   │                            (Cloudflare Workers AI — add-in дотор LLM түлхүүр БАЙХГҮЙ)
   ▼  хүн уншиж, засаж, баталгаажуулна
POST /api/revit/submissions  ← ЦОРЫН ГАНЦ бичих гарц
   ▼
progress_entries → оноо → тайлан
```

### Нэг удаагийн тохиргоо: «Зураг холбох»

Revit-ийн хуудас бүрийг MGL дээрх ажилтай холбоно (~2 минут). Систем
таамаглаж бөглөнө — та зөвхөн шалгана. Холбоос нь `ViewSheet.UniqueId`-д
тулгуурладаг тул **хуудасны дугаар/нэр солих, файлын нэр солих, worksharing
sync бүгдийг даван гарна**.

Батлахад **ажлын дэд жагсаалт автоматаар үүснэ** (хуудас тутам нэг мөр) —
явцын хувь эндээс гарна: 8/13 тэмдэглэсэн → 62%.

### Хоёр хатуу дүрэм

- **Revit-ээс 100% илгээх боломжгүй** (дээд хязгаар 99%). Ажил хаах нь
  вэб дээр, дуусгалтын асуултуудтай — тэр үед ахлагч бүх ажлыг шалгадаг.
- **Тэмдэглэлийн тоо AI-аас гардаггүй.** Хувь нь эхлээд серверт тооцогдож,
  дараа нь AI зөвхөн үг бичнэ. AI бодит хувиас өөр тоо бичвэл бүхэлд нь
  хаягдаж, загварын текст очно.

---

## MCP хэрэгслүүд

| Хэрэгсэл | Юу хийдэг |
|---|---|
| `get_document_context` | Баримтын таних тэмдэг, нэр, хувилбар, хуудасны тоо |
| `list_sheets` | Бүх хуудас (uid, дугаар, нэр) |
| `capture_baseline` | Загварын өнөөгийн төлөвийг суурь болгож хадгална |
| `diff_since_baseline` | Ямар **хуудас** өөрчлөгдсөнийг харуулна |
| `isolate_sheet_elements` | Хуудасны элементийг идэвхтэй харагдацад тусгаарлана |
| `reset_isolation` | Тусгаарлалтыг цуцална |
| `get_model_info` · `get_selection` · `ping_revit` | Хуучин туслахууд |
| `run_revit_code` | Дурын C# — **анхдагчаар унтраалттай** (доор үз) |

> `diff_since_baseline`-ийн **шударга хязгаар**: элементийн id-г харьцуулдаг
> тул аль хэдийн байсан элементийн параметр/геометрийн засварыг **харахгүй**.
> Бүтэн өдөр зохицуулалт, тэмдэглэгээ, хэмжээс тавьсан нь бараг тэг ялгавар
> өгнө. Тиймээс энэ тоо нь дэд жагсаалтыг **урьдчилан тэмдэглэхэд** л
> хэрэглэгддэг, хувийг ХЭЗЭЭ Ч тогтоодоггүй.

---

## Аюулгүй байдал

**Юу засагдсан бэ.** Өмнө нь `POST http://localhost:5005/execute` нь
**токенгүйгээр** дурын C#-ыг хүлээж авч, Roslyn-оор эмхэтгэж, амьд Revit
`Transaction` дотор ажиллуулдаг байсан — тэр компьютер дээр MGL-ийн ~1
жилийн хугацаатай API токен сууж байхад. Ямар ч локал процесс (эсвэл хортой
вэб хуудас) Revit болон MGL-ийн API-г бүрэн эзэмшиж чадна байсан.

**Одоо:**

- Revit асах бүрт шинэ токен үүсч `%APPDATA%\RevitMcpAddin\bridge.json`-д
  бичигдэнэ. Python клиент түүнийг уншина. `/health`-ээс бусад бүх зам
  токен шаардана.
- `run_revit_code` нь **403** буцаана — `MGL_ALLOW_EXEC=1` тавьсан үед л
  ажиллана. Ердийн ажилд typed `/tool` хэрэглэ.
- API токеныг `settings.json`-д **DPAPI-аар шифрлэж** хадгална
  (`token_enc`). Хуучин ил токен нэг удаа хөрвөнө.

**Энэ нь ХҮЧТЭЙ ХИЛ БИШ.** Тухайн Windows хэрэглэгчээр ажиллаж буй процесс
`bridge.json`-ыг уншиж, DPAPI-г мөн дуудаж чадна. Энэ бол гүн хамгаалалт —
өөр хэрэглэгч хүрэхгүй, хөтчийн drive-by ажиллахгүй, дурын код анхдагчаар
унтраалттай. Хэн асуусан ч ингэж шударгаар хэл.

### Локал агент (`agent/mgl_agent.py`, порт `5099`)

`agent/` доторх процесс нь `claude-agent-sdk`-ээр тухайн инженерийн ӨӨРИЙН
Claude захиалгаар ажилладаг ба `127.0.0.1:5099` дээр сонсдог. Add-in-ий
«MGL туслах» самбар түүн рүү `POST /chat` (NDJSON урсгал) илгээнэ.

- Процесс асах бүрт **64 hex тэмдэгтийн** шинэ токен үүсч
  `%APPDATA%\RevitMcpAddin\agent.json`-д (`{port, token, pid, issued_at}`,
  **BOM-гүй** UTF-8) бичигдэнэ; процесс гарахдаа файлыг **устгана**.
- `POST /chat` нь `Authorization: Bearer <token>` шаардана — эс бөгөөс **401**.
- **`Host` цагаан жагсаалт** нь routing-аас ӨМНӨ ажиллана: зөвхөн
  `127.0.0.1` / `localhost` / `[::1]` (порттой ба портгүй) зөвшөөрөгдөх ба
  бусад нь **400 `bad host`**. Энэ нь DNS rebinding-ийг зогсооно —
  Python-ий `BaseHTTPRequestHandler` нь `:5005`-ын `http.sys`-ээс ЯЛГААТАЙ,
  виртуал хостыг өөрөө шалгадаггүй.
- `GET /health` нь **токенгүй** хэвээр (самбарын probe), гэхдээ `Host`
  шалгалтад орно.
- `OPTIONS` нь **405** буцаана, `Access-Control-*` толгой ХЭЗЭЭ Ч бичигдэхгүй
  — CORS санаатайгаар нээгдээгүй.
- `run_revit_code` нь агентын `disallowed_tools`-д **ил хориглогдсон** —
  `MGL_ALLOW_EXEC=1` тавьсан машин дээр ч агент дурын C# ажиллуулж чадахгүй.

`agent.json` нь `bridge.json`-той ЯГ ижил хязгаартай: тухайн Windows
хэрэглэгчээр ажиллаж буй процесс түүнийг уншиж чадна. Энэ бол ХӨТЧИЙН
drive-by-г зогсоох гүн хамгаалалт, локал халдагчийн эсрэг хил БИШ.

**Засагдаагүй хэвээр:** токеныг тус тусад нь цуцлах арга байхгүй — ганц
хөшүүрэг нь `JWT_SECRET` сэлгэх, тэр нь бүх session, бүх суулгац, бүх
хэвлэлтийн ажлыг зэрэг унагана. Мөн `bridge.json` / `agent.json`-д ACL,
эзэмшигч, PID шалгалт байхгүй.

---

## Суулгах

### Шаардлага
- Revit 2024 / 2025 / 2026 / 2027
- .NET 10 SDK (`winget install -e --id Microsoft.DotNet.SDK.10`)
- Python 3.12 — зөвхөн MCP гүүрэнд

### Add-in build

⚠️ **Revit хувилбар бүр өөр .NET runtime-тай** тул Configuration заавал сонгоно:

```powershell
dotnet build addin\RevitMcpAddin.csproj -c "Release R27" -p:Platform=x64   # Revit 2027 (net10)
dotnet build addin\RevitMcpAddin.csproj -c "Release R26" -p:Platform=x64   # Revit 2026 (net8)
dotnet build addin\RevitMcpAddin.csproj -c "Release R25" -p:Platform=x64   # Revit 2025 (net8)
dotnet build addin\RevitMcpAddin.csproj -c "Release R24" -p:Platform=x64   # Revit 2024 (net48)
```

> ⚠️ **Build нь ӨӨРӨӨ ХУУЛАХАА БОЛЬСОН** (2026-08-28).  Дээрх командууд зөвхөн
> `addin\bin\x64\<Configuration>\` руу л бичнэ.  Урьд нь `DeployAddin` target
> нь БОЛЗОЛГҮЙ байсан тул `dotnet build` БҮР энэ машины АМЬД Revit нэмэлтийг
> чимээгүйхэн дарж бичдэг байв — 2026-08-28-нд энгийн build нэг дор
> 2024/2025/2026/2027 дөрвүүлэн суулгацыг commit хийгээгүй WIP кодоор дарсан.
> Одоо суулгах нь **ил зөвшөөрөлтэй**:
>
> ```powershell
> dotnet build addin\RevitMcpAddin.csproj -c "Release R27" -p:Platform=x64 -p:DeployToRevit=true
> ```
>
> Revit нээлттэй (DLL түгжигдсэн) үед өөр фолдер руу:
> `-p:DeployToRevit=true -p:AddinDeployDir=C:\Temp\mgl`.
> `-p:AddinDeployDir` нь **ганцаараа ИДЭВХГҮЙ** — `DeployToRevit` -гүйгээр
> юу ч хуулагдахгүй.

> Revit нээлттэй байхад build хийвэл DLL түгжигдэж унана — эхлээд хаа.

### Тараах багц болгож савлах (релиз)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\package-addin.ps1 -Build
```

Дөрвүүлэн Revit оныг барьж, `dist\<хувилбар>\` дотор **4 zip + 4 manifest.json**
гаргана.  Скрипт нь:

- Дутуу build байвал **exit ≠ 0** — хэсэгчилсэн релиз гарахгүй.
- DLL-ийн `FileVersion` нь csproj-ийн `<Version>`-той таарахгүй бол
  **ХУУЧИРСАН** гэж зогсоно (худал манифест гаргахгүй).
- Zip ДОТОР `payload.sha256.txt` (файл бүрийн хэш) + `release.json` тавина —
  хүлээн авагч ПК суулгахын ӨМНӨ бүгдийг шалгана.
- Zip-ийн ХАЖУУД `*.manifest.json` бичнэ — тэр нь шууд
  `POST /api/revit-addin/releases`-ийн бие.

⚠️ **Хувилбар бүр өөрийн фолдертой** — өмнөх релизийн zip дарагдахгүй.
Тараахаас ӨМНӨ тэр фолдерыг **репогийн ГАДНА** архивла: `dist/` нь git-д
ороогүй бөгөөд буцаах цорын ганц бай тэр юм.

⚠️ **Код гарын үсэг (code signing) БАЙХГҮЙ.**  `payload.sha256.txt` ба
`addin_releases.sha256` нь **бүрэн бүтэн байдлыг** (integrity) шалгана,
**гарал үүслийг** (authenticity) БИШ.  Тиймээс хэрэглэгчийн зааварт
«гарын үсэггүй тул Always Load» гэсэн алхам ХЭВЭЭР байна.

### MCP сервер

```powershell
cd server
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e .
```

- **Claude Code** — repo дахь `.mcp.json` бэлэн.
- **Claude Desktop** — `.mcp.json`-ы `revit` бичлэгийг
  `%APPDATA%\Claude\claude_desktop_config.json`-ы `mcpServers` дотор хуулж,
  дахин эхлүүл.

### Шалгах

```powershell
curl http://localhost:5005/health           # токенгүй ажиллана
curl -X POST http://localhost:5005/tool     # токенгүй бол 401
```

---

## Тохиргоо

| Хувьсагч | Тал | Өгөгдмөл |
|---|---|---|
| `MGL_API_HOST` | add-in | production worker |
| `MGL_RIBBON_TAB` | add-in | `MGL` |
| `REVIT_MCP_PORT` | add-in | `5005` |
| `MGL_ALLOW_EXEC` | add-in | *(унтраалттай)* — `1` бол дурын C# нээгдэнэ |
| `REVIT_MCP_URL` | сервер | `bridge.json`-оос уншина |
| `REVIT_MCP_TIMEOUT` | сервер | `75` секунд |
| `MGL_AGENT_PORT` | локал агент | `5099` |
| `MGL_AGENT_TOKEN` | локал агент | *(санамсаргүй 64 hex)* — зөвхөн дибагт тогтооно |
| `MGL_AGENT_ALLOW_ANON` | локал агент | *(унтраалттай)* — `1` бол токен шаардахгүй. **ЗӨВХӨН ДИБАГТ**, продакшнд хэзээ ч бүү үлдээ |
| `MGL_AGENT_URL` | add-in | `http://127.0.0.1:5099` |
| `REVIT_MCP_PYTHON` | локал агент | `server/.venv`-ийн python |

## Файлын бүтэц

```
addin/
  App.cs                      ribbon + lifecycle + самбарын бүртгэл
  RevitToolBus.cs             ExternalEvent гарц (typed хэрэгсэл → Revit thread)
  RevitTools.cs               7 хэрэгслийн хэрэгжилт
  BridgeAuth.cs               локал bridge-ийн session токен
  HttpServer.cs               localhost сонсогч (/health · /tool · /execute)
  RevitApi.cs                 /api/revit-ийн клиент + DTO
  BindingCommand.cs           «Зураг холбох» команд
  BindingDialog.xaml(.cs)     хуудас ↔ ажлын холбоосын цонх
  AssistantPane.xaml(.cs)     «MGL туслах» самбар
  AssistantPaneProvider.cs    IDockablePaneProvider + команд
  IntentParser.cs             монгол түлхүүр үгийн таних (LLM БИШ)
  CodeExecutorEventHandler.cs Roslyn (зөвхөн MGL_ALLOW_EXEC=1 үед)
server/revit_mcp/             Python MCP гүүр
agent/
  mgl_agent.py                локал агент — :5099, токен + Host шалгалттай
  start-agent.bat             асаах скрипт
```
