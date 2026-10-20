# MGL — Хөгжүүлэгчийн гарын авлага

> Дараагийн хөгжүүлэгчид (эсвэл 3 сарын дараах өөрсдөдөө) зориулсан онбординг.
> «Энэ юу вэ, хаанаас эхлэх вэ, юунд гар хүрч болохгүй вэ» — эндээс ол.
> Аяс нь хөнгөн ярианы монгол, technical нэр томьёо англиар хэвээр.

Энэ фолдер нь [нийтэлсэн Artifact хувилбар](https://claude.ai/code/artifact/88657cdd-b745-4a1b-8d42-dbf0502ddc50)-ын git-д хадгалагдах, PR review-д ордог хувилбар. Агуулга нь **2026-07-22-ны кодын төлөвөөр** бичигдсэн бөгөөд route prefix, cron, binding, deploy дараалал, data model зэрэг гол баримтуудыг бодит эх кодоос (`backend/src/index.ts`, `backend/wrangler.toml`, `frontend/src/app/routes.tsx`, `backend/src/routes/projects.ts`) шалгаж баталсан.

## 🚦 Хамгийн эхэнд ойлгох 3 зүйл

1. **Backend** бол ганцхан Cloudflare **Worker** (Hono дээр).
2. **Frontend** бол Vite + React 19 SPA, Cloudflare Pages дээр.
3. **[Data model](03-data-model.md)-оо мэдэхээс өмнө progress код руу бүү ор** — 5 түвшний жинтэй мод. Тэрийг ойлгохгүй бол хаа сайгүй андуурна.

## 📚 Гарчиг

| # | Файл | Тухай |
|---|------|-------|
| 00 | [Танилцуулга](00-overview.md) | Систем юу вэ, 2 нүүр, монорепогийн бүтэц |
| 01 | [Локал орчин](01-setup.md) | Backend/frontend ажиллуулах, secrets, «тест байхгүй» |
| 02 | [Backend архитектур](02-backend.md) | Worker, middleware, role, cron, binding |
| 03 | [Data model](03-data-model.md) | 5 түвшний жинтэй мод, 348% bug хавх |
| 04 | [Approval & оноо](04-approval-points.md) | Батлах урсгал, leaderboard оноо, notify |
| 05 | [Feature-by-feature](05-features.md) | Ирц, хурал, имэйл, calendar, quote гэх мэт |
| 06 | [PDF гаргах 3 зам](06-pdf.md) | Browser Rendering vs WeasyPrint vs Stirling |
| 07 | [Frontend архитектур](07-frontend.md) | Lazy chunks, routing, давхаргууд, i18n |
| 08 | [QTO + Revit add-in](08-qto-revit.md) | Тоо хэмжээ, C# add-in, multi-version build |
| 09 | [MCP server](09-mcp.md) | Remote MCP connector, tool-ууд |
| 10 | [Контейнер-сервисүүд](10-containers.md) | weasyprint / stirling / ifc-convert |
| 11 | [Deploy дараалал](11-deploy.md) | Migration эхэлж, дараа worker/pages |
| 12 | [Конвенц & gotcha](12-conventions-gotchas.md) | UB timezone, commit хавх, build батлах |
| 13 | [Үхсэн / leftover код](13-dead-code.md) | Гар хүрэхгүй зүйлсийн газрын зураг |

## ⚠️ Ганц том сэрэмжлүүлэг

Working tree дотор **өөр хүн/агентын дуусаагүй, compile хүртэл болдоггүй WIP** байж болно. Өөрийн taskтай хамаагүй файлд **гар бүү хүр**. Дэлгэрэнгүй [§00](00-overview.md#олон-агент-зэрэг-ажилладаг) ба [§12](12-conventions-gotchas.md)-д.
