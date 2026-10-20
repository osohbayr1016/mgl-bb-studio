# §13 · Үхсэн / leftover код — «Гар хүрэхгүй» газрын зураг

Кодод үлдэц/орхигдсон зүйл олон. Эдгээрийг «одоо ажиллаж байгаа» гэж андуурч **цаг бүү үр**.

| Зүйл | Статус | Тайлбар |
|------|--------|---------|
| `users.accent_color` | 💀 DEAD | Багана байгаа ч хэн ч уншдаг/бичдэггүй (per-user theme 2026-06-д устсан) |
| `model_xkt_url` · `model_conversion_status` | 💀 DEAD | Устсан xeokit/IFC зам-ын үлдэц багана |
| `material_catalog` · `material_alias` · `quantity_line` (0110) | 💀 DEAD | Одоо writer байхгүй; append-only үлдэц (шинэ нь `resources`/`qto_facts`) |
| `routes/companyDailyReport.ts` | 💀 MOUNT ҮГҮЙ | Router export хийдэг ч `index.ts`-д import хийгээгүй → route амьд биш |
| `features/daily-report/DailyReportPage.tsx` | 💀 ROUTE ҮГҮЙ | `routes.tsx`-д холбоогүй orphan хуудас |
| root & `revit-mcp/.mcp.json` | 💀 STALE | Өөр машины буруу зам (`C:\Users\User\...`) — leftover config |
| `_tmp_pages/` · `Untitled` · `mcis_une_2021_2022.csv` (0 байт) | 💀 LEFTOVER | Scratch зураг, хоосон файл — runtime биш |
| root дахь sample файлууд (`.ifc`, `.pdf`, `.xlsx`) | 💀 LEFTOVER | Тест дата, эх код биш |
| `routes/revitAddin.ts` `OWNER_ID=1` | 🟡 GATE | Add-in татах нь одоохондоо зөвхөн 1 хэрэглэгч (Anand); дараа өргөтгөнө |
| `ifc-convert/` | 🟡 STAGED | Код бэлэн ч backend-д binding холбоогүй ([§10](10-containers.md)) |
| Migration давхардсан дугаар | 🟡 АНХААР | `0110` (×3!), `0120` (×2), `0121` (×2) — файлын нэр давхардсан |
| `resources_catalog.json` (2 хувь) | 🟡 АНХААР | root + `qto/seeds/` — sync-д байлга |
| COOP/COEP header | ✅ ЗОРИУДААР ҮЛДСЭН | `web-ifc` устсан ч email OAuth + APS-д хэрэгтэй тул хэвээр |
| DO migration v1–v5 (ChatRoom, IfcConverter) | ✅ ТҮҮХ | Append-only — устгаж болохгүй ч class-ууд идэвхгүй |

## Дүгнэлт

Аль нэг зүйлийг устгах/сэргээхээсээ өмнө:

1. энэ зүйлийг хэн бэ, хаана уншдаг вэ гэдгийг `grep`-ээр батал,
2. энэ авлагын статустай тулга,
3. итгэлгүй бол хэрэглэгчээс асуу.

**«Compile болдоггүй» гэдэг нь чиний bug гэсэн үг биш** — бусдын WIP байж болно ([§00](00-overview.md#олон-агент-зэрэг-ажилладаг)).

---

> Энэ авлага 2026-07-22-ны кодын төлөвөөр бичигдсэн. Гол баримтуудыг (route prefix, cron, binding, deploy дараалал, data model) бодит `index.ts` / `wrangler.toml` / `routes.tsx`-ээс шалгаж баталсан. Хэрэв энд бичсэнтэй код зөрж байвал — **код нь үнэн**, авлагыг шинэчил.
