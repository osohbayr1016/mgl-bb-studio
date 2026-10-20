# Revit → Вэбсайт QTO холболт (Тоо хэмжээ v2 — шифр ангилалтай)

**Огноо:** 2026-07-03 · **Статус:** Батлагдсан

## 1. Зорилго

Тоо хэмжээ (QTO)-ний эх үүсвэрийг браузер доторх `.ifc`/`web-ifc` задаргаанаас **Revit 2027 add-in-ий шууд түүвэрлэлт** рүү шилжүүлж, мөр бүрийг төсвийн **шифр кодоор** (mcis.gov.mn-ийн 1859 нэр төрөл, `resources_catalog.json`) ангилдаг болгох. Ангилал нь Claude MCP + admin баталгаажуулалтаар "сурдаг" — баталгаажсан mapping байнгын alias болж, дараагийн run-ууд автоматаар ангилагдана.

## 2. Шийдвэрүүд

| # | Шийдвэр | Сонголт |
|---|---------|---------|
| 1 | Trigger | Revit ribbon товч «Тоо хэмжээ илгээх» (хадгалах бүрт автоматыг хожим нэмж болно) |
| 2 | Ангиллын тэнхлэг | Category→Family→Type + Материал + Давхар (Level) + Шифр код — бүгд |
| 3 | Шифр каталог | `resources_catalog.json` → шинэ `resources` хүснэгт (seed migration) |
| 4 | AI ангилал | Claude **MCP-ээр** (worker-т API key хэрэггүй; scheduled routine = автомат) |
| 5 | Эрх | Илгээх/батлах зөвхөн admin; үзэх admin+senior хэвээр |
| 6 | IFC зам | Бүрэн устана (web-ifc, worker, wasm, ProjectQtoTab, .ifc upload); хуучин run түүх уншигдана |
| 7 | 0110 хүснэгтүүд | `material_catalog`/`material_alias`/`quantity_line`-д бичихээ болино; хүснэгтүүд үлдэнэ |

## 3. Архитектур

```
Revit 2027 (ганц PC, central file)
  └─ RevitMcpAddin: «Тоо хэмжээ илгээх» товч (IExternalCommand, read-only, transaction-гүй)
       QtoExtractor → fact rows (category, family, type, level, material, count, m, m², m³, kg)
       └─ POST /api/qto/revit-runs  (Bearer: /api/auth/mcp-token-ий 1 жилийн токен)
            └─ D1: qto_runs(source='revit') + qto_facts  (confirmed resource_alias-аар auto-map)
                 ├─ Claude MCP: list_unmapped_quantities → submit_quantity_mappings (pending санал)
                 ├─ Admin UI /app/qto: Ангилаагүй queue → Батлах → байнгын alias + бүх run backfill
                 └─ Pivot: Category·Материал·Давхар·Шифр + Run diff + Excel export
```

### Ангиллын гурван давхарга

1. **Intake auto-map:** run орж ирэхэд `resource_alias`(status='confirmed')-аас lookup — combo/project → combo/global → material/project → material/global дарааллаар.
2. **Claude MCP:** ангилаагүй түлхүүрүүдийг сервер талд prefilter хийсэн кандидатуудтай нь Claude-д өгч, pending санал (confidence-тэй) бичүүлнэ. claude.ai scheduled routine болговол өдөр бүр автомат.
3. **Admin баталгаажуулалт:** вэб дээр Батлах/Засах/Татгалзах → confirmed alias → өнгөрсөн ба ирээдүйн run-уудын fact backfill.

Хожим бүрэн синхрон хэрэгтэй бол worker-т `ANTHROPIC_API_KEY` нэмээд ижил логикоо сервер талд дуудна — өгөгдлийн бүтэц өөрчлөгдөхгүй.

## 4. Өгөгдлийн бүтэц (migration 0117 + 0118)

- **`resources`** — `code TEXT PK`, `code_format ('digit8'|'dashed')`, `group_code` (3 оронтой бүлэг), `name`, `unit`, `unit_raw`, `flags_json`, `active`. Seed: `backend/scripts/gen-resources-seed.mjs` → `0118_resources_seed.sql` (INSERT OR IGNORE, 50 мөр/statement).
- **`resource_alias`** — сурдаг map + AI саналууд нэг хүснэгтэд: `raw_name`, `raw_norm`, `key_kind ('combo'|'material')`, `resource_code`, `project_id (NULL=глобал)`, `source ('manual'|'ai')`, `status ('pending'|'confirmed'|'rejected')`, `confidence`, `created_by`. UNIQUE `(key_kind, raw_norm, IFNULL(project_id,-1))`. Санал түлхүүр дээр (fact мөр дээр биш); confirm = status flip.
- **`qto_facts`** — run бүрийн мөрүүд: identity 5 багана + 5 хэмжигдэхүүн + `combo_key`/`material_key` + `resource_code (NULL=ангилаагүй)` + `mapped_via`.
- **`qto_runs`** — дахин ашиглана: `+source ('ifc'|'revit')`, `+push_id` (idempotency). Revit run: `model_url='revit://'||file_name`, `schema_version='revit-2027'`.
- Түлхүүрийн норм: `normalizeFactKey(category,type,material)` = хэсэг бүрийг `normalizeRawName`-аар норчилж `|`-ээр залгана (`backend/src/lib/resourceMap.ts`).

## 5. API гэрээ

### `POST /api/qto/revit-runs` (admin)

```jsonc
{ "project_id": 12, "file_name": "MGL_TOWER.rvt", "revit_version": "2027",
  "push_id": "uuid",   // давхардвал 409
  "rows": [{ "category": "Structural Framing", "family": "RHS", "type_name": "RHS200X200X5",
             "level": "L2", "material": "STEEL/Q235B",
             "count": 42, "length_m": 310.2, "area_m2": null, "volume_m3": 1.21, "mass_kg": 9497.0 }],
  "totals": { "count": 0, "length_m": 0, "area_m2": 0, "volume_m3": 0, "mass_kg": 0 } }  // optional
```

→ `201 { run_id, facts, mapped, unmapped, unmapped_keys: [...эхний 50] }`. Cap: 20k мөр, string 256 тэмдэгт.

### Бусад endpoint

`GET /runs/:id/facts` (resources JOIN, client pivot) · `GET /resources?q=&group=` · `GET /classification/queue?project_id=` · `POST /classification/confirm` (bulk, admin — alias upsert + бүх run backfill) · `POST /classification/reject` · `GET /projects-overview` (+source, +unmapped, −model_url). Устгах: хуучин `POST /runs`, `/normalize`, `PUT /projects/:id/model`.

### MCP tools (admin блок)

- `list_unmapped_quantities {project_id?, limit≤40, offset, candidates_per_key≤15, group?}` — түлхүүр + токен-хайлтаар шүүсэн кандидат (каталог бүхлээрээ модель руу явахгүй) + rejected кодууд.
- `submit_quantity_mappings {mappings[≤40], project_id?}` — зөвхөн pending бичнэ; admin queue = аюулгүйн хаалт.
- `get_project_quantities` — revit run-д qto_facts-аас category + шифр бүлгийн GROUP BY нэмнэ; хуучин run хэвээр.

## 6. Revit add-in

`revit-mcp/addin/`-д: `QtoExportCommand.cs`, `QtoExtractor.cs`, `QtoDtos.cs`, `ApiClient.cs`, `SettingsStore.cs`, `SettingsDialog.xaml(.cs)`; `App.cs`-д ribbon, csproj-д `UseWPF=true`.

- Collector: `WhereElementIsNotElementType().WhereElementIsViewIndependent()` + `CategoryType.Model && HasMaterialQuantities`. Level: `LevelId` → BuiltInParameter гинж → host fallback. Материал: `GetMaterialIds(false)`+`GetMaterialVolume/Area`; жин = `StructuralAsset.Density`×эзлэхүүн. Нэгж: `UnitUtils.ConvertFromInternalUnits`.
- Бүлэглэлт `(category,family,type,level,material)`: count/length зөвхөн үндсэн материалын мөрөнд — `SUM(count)` = элементийн тоо. Материалгүй = `"(материалгүй)"`.
- v1 зөвхөн host документ (link-үүд хожим). Read-only тул transaction/ExternalEvent хэрэггүй; POST synchronous + 30s timeout + TaskDialog баталгаажуулалт/үр дүн.
- Auth: login `{username, password}` → шууд `/api/auth/mcp-token`-оор 1 жилийн токен → `%APPDATA%\RevitMcpAddin\settings.json` (нууц үг хадгалахгүй). Сүлжээгүй бол payload `last-run.json`-д; 401 → re-login + 1 удаа автомат retry.

## 7. Frontend

`/app/qto` route/sidebar/эрх хэвээр; `features/qto/` дотор шинэ QtoPage: зүүн rail (source badge, ангилаагүй amber badge) + 4 таб — **Тойм** (totals, mapped progress, Excel), **Ангилал** (axis switcher pivot: Category мод·Материал·Давхар·Шифр), **Ангилаагүй** (AI саналын chip, Батлах/Засах/Татгалзах, ≥0.8 bulk, scope toggle; senior-т үйлдэл нуугдана), **Түүх/Diff** (ifc run = read-only карт; 2 revit run diff). Устгах: ProjectQtoTab, qto.worker, runQto, qtoExcel, qtoTypes, web-ifc.wasm, web-ifc dep. **COOP/COEP header хэвээр** (email OAuth popup + APS viewer тулгуурладаг). i18n хоёр толь бичигт.

## 8. Хамрахгүй зүйлс

- Үнэ/BOQ давхарга (0109 boq хүснэгтүүд) — дараагийн шат; `qto_facts.resource_code`-оор холбогдоно.
- Linked model-уудын түүвэрлэлт, хадгалах-бүрт автомат илгээлт, per-element мөр хадгалалт.
- resources каталогийн үнийн мэдээлэл (санаатайгаар ороогүй).

## 9. Verification

Локал: миграц apply → resources=1859; curl-ээр intake (давхар combo key, материалгүй мөр, alias-тай мөр) → mapped/unmapped зөв, push_id давхардал 409, confirm → дахин push mapped өснө + backfill; MCP tools локал worker дээр; frontend 4 таб + Excel + эрхийн шалгалт; add-in Revit 2027 дээр бодит push. `tsc -b --force` + lint.
