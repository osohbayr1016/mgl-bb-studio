# §00 · Танилцуулга

Энэ бол **MGL**-ийн дотоод систем. Барилгын гүйцэтгэл хянадаг + HR хийдэг, монгол инженерийн фирмд зориулсан tool. Кодыг нь хэн ч бүтнээр нь толгойдоо барихад амаргүй болсон болохоор энэ авлагыг бичлээ.

## Систем нь 2 нүүртэй

- **Ажлын апп** (staff / admin / client) — гүйцэтгэл, ирц, leaderboard, чөлөө/илүү цаг, төслийн баримт, Revit-ээс Тоо хэмжээ (QTO), үнийн санал, хурлын тэмдэглэл гэх мэт. URL нь `/app/*` дор.
- **Нийтийн маркетинг сайт** — `/` болон `/work/:id`. mglenc.com-ыг орлуулах CMS-тэй landing.

UI default нь монгол (`mn`); англи нь хэлний сэлгэгчээр opt-in.

## Монорепогийн бүтэц

| Фолдер | Юу вэ | Стек |
|--------|-------|------|
| `backend/` | Cloudflare Worker — бүх API, cron, MCP server | Hono · D1 · R2 · Durable Objects · Workers AI |
| `frontend/` | React SPA — staff апп + нийтийн landing | Vite · React 19 · TanStack Query · Router v7 |
| `revit-mcp/` | C# Revit add-in (QTO push) + туршилтын Python MCP | .NET (Revit API) · Python |
| `weasyprint/` · `stirling/` · `ifc-convert/` | Тусдаа deploy хийгддэг контейнер-Worker-ууд (PDF, IFC) | Docker · Cloudflare Containers |
| `qto/` · `ds-bundle/` · `scripts/` · `docs/` | Төлөвлөлт/дизайн/reference — runtime биш | — |

## Хамгийн эхэнд ойлгох 3 зүйл

1. **Backend** бол ганцхан Cloudflare **Worker** (Hono дээр).
2. **Frontend** бол Vite + React 19 SPA, Cloudflare Pages дээр.
3. **[Data model](03-data-model.md)-оо мэдэхээс өмнө progress код руу бүү ор** — 5 түвшний жинтэй мод, тэрийг ойлгохгүй бол хаа сайгүй андуурна.

## Олон агент зэрэг ажилладаг

Working tree дотор өөр хүн/агентын дуусаагүй, **compile хүртэл болдоггүй** WIP байж болно. Иймд:

- Өөрийн taskтай хамаагүй файлд **гар бүү хүр** — засах гэж оролдвол тэр хүний ажлыг устгана.
- Бусдын хадгалаагүй өөрчлөлтийг `git restore` / `checkout --` / устгах / stage хийхгүй.
- Full build (`npm run build` / `tsc -b`) унавал бүхэл аппыг compile хийдэг тул чиний хүрээгүй файлд ч унаж болно. Эхлээд алдаа зөвхөн хамаагүй файлд байгаа эсэхийг шалга (ж: `npx tsc -b 2>&1 | grep -v <файл>` хоосон бол), дараа нь хамаагүй blocker-ыг хэрэглэгчид хэл.
- Backend deploy (`wrangler deploy`, esbuild, full typecheck хийдэггүй) нь хамаагүй frontend/`tsc` алдаанд нөлөөлдөггүй — backend ship хийж болно.
