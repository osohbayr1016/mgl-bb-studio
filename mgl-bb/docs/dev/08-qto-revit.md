# §08 · QTO + Revit add-in

Тоо хэмжээ (QTO / quantity take-off)-ийн source of truth нь **Revit add-in** (`revit-mcp/addin/`), C#. Хуучин browser доторх `web-ifc` pipeline 2026-07-д бүрэн устсан.

## C# add-in

Revit-д «MGL» ribbon tab нэмнэ. Товчнууд:

- **«Тоо хэмжээ илгээх»** (Экспорт самбар → «ERP-д илгээх» цэс; `QtoExportCommand`) — **read-only** (transaction нээхгүй) бүх element-ийг уншиж, `(category, family, type, level, material)`-аар нэгтгээд `POST /api/qto/revit-runs` руу илгээнэ.
- **«PDF илгээх»** (Экспорт самбар) — идэвхтэй харагдацыг PDF болгож сайт руу upload; план/огтлол дээр grid-ийг авто-хэмжинэ.
- **«Түүвэр илгээх»** (Экспорт самбар; өмнө нь «Хүснэгт илгээх») — сонгосон Revit Schedule/Quantities хүснэгтийг push.
- **«Хуудас үүсгэх»** (Зураг самбар) — параметрээр bulk sheet (зөвхөн локал, серверт хамаагүй).
- **«Тохиргоо»** (Сан ба тохиргоо самбар) — бүртгэл, ERP төсөл.
- **«Хэрэгсэл хайх»** (Ажил самбар) — бүх MGL хэрэгслийг нэрээр хайж, юу өөрчилдөг/ERP руу юм илгээдэг эсэх, одоо яагаад нээгдэхгүй байгааг харна.

Ribbon-ы бүтэц, нэршлийн бүрэн зураглал: `revit-mcp/docs/MGL_UI_UX_REDESIGN.md`.

### Auth

Тохиргоо дотор нэг удаа login (`POST /api/auth/login`, username+password) → `POST /api/auth/mcp-token`-оор **~1 жилийн token** авч `%APPDATA%\RevitMcpAddin\settings.json`-д хадгална. Нууц үг хадгалдаггүй. Server талд `requireAdmin` бол жинхэнэ gate.

### Multi-version build

Нэг project, 4 Configuration (Revit жил бүр өөр .NET runtime):

| Config | Revit | TFM |
|--------|-------|-----|
| `Release R24` | 2024 | `net48` |
| `Release R25` | 2025 | `net8.0-windows` |
| `Release R26` | 2026 | `net8.0-windows` |
| `Release R27` | 2027 | `net10.0-windows` |

Revit API-г **Nice3point** NuGet-ээр (`ExcludeAssets="runtime"` — build машинд Revit суулгах албагүй). MCP Roslyn code-executor нь net48/2024 build-аас хассан. 24/7 batch mode: Revit эхлэхэд `batch-queue.json` байвал `.rvt` бүрийг detached нээж, extract → push → Revit-ээ хаана (headless, dialog үгүй).

## Intake + шифр каталог

`POST /api/qto/revit-runs` (**admin-only**; бусад `/api/qto/*` нь admin+senior) нь:

1. validate (≤20k мөр, ≤256 тэмдэгт),
2. `(project_id, push_id)`-оор dedupe → 409,
3. нэг `qto_runs` мөр (`source='revit'`) + мөр бүрийн `qto_facts` (migration 0117) chunked `db.batch()`-оор. Fact мөрүүд D1-д, `summary_json`-д БИШ.

Мөн `resources` (mcis.gov.mn шифр каталог, 1859 мөр, migration 0118 seed) + `resource_alias` (суралцах map). Intake нь **confirmed** alias-аар автоматаар mapping хийж, бусад нь `resource_code=NULL` (ангилаагүй) болно.

> **Phase 2** (шифр ангилалын review queue UI + Claude-MCP санал болгох tool) **санаатай хойшилсон** — spec-ийг дага, хагас хувилбар ad hoc бүү барь. Хуучин 0110-ын `material_catalog`/`material_alias`/`quantity_line` нь одоо writer байхгүй үлдэц.

## ⚠️ 2 өөр «revit-mcp»-ийг бүү андуур

- `revit-mcp/server/` нь тусдаа **Python MCP** («Claude Revit дотор C# бич», FastMCP → localhost:5005) — зөвхөн туршилт.
- Backend-ийн MCP server ([§09](09-mcp.md)) бол огт өөр зүйл — компанийн өгөгдлийг үйлчилдэг `mgl-progress` connector.

Хоёул зөвхөн QTO домэйн дээр л давхцдаг, өөр холбоогүй. (`.mcp.json` файлууд өөр машины буруу зам заадаг — leftover, [§13](13-dead-code.md).)

## Frontend

`features/qto/QtoPage.tsx` (`/app/qto`, admin+senior). Тойм / Ангилал pivot (Category→Family→Type, Материал, Давхар) / Түүх + run diff + Excel export (lazy `exceljs`). Reads: `/api/qto/projects-overview`, `/runs`, `/runs/:id`, `/runs/:id/facts`.
