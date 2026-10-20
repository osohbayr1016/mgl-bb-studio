# Cloudflare нөөцийн аудит / цэвэрлэгээний хэрэгсэл

Бүх скрипт **өгөгдмөлөөр DRY RUN** — юу ч устгахгүй, юу ч бичихгүй.  Устгал
`--execute --i-have-a-backup` ХОЁР тугийг зэрэг шаардана, зөвхөн эзэн гараар.

| Команд | Юу хийдэг | Prod-д хүрэх үү |
|---|---|---|
| `npm run audit:d1 [-- --db=export.sql]` | D1 хүснэгтийн инвентор, хоосон хүснэгт, хуучирсан мөрийн нэр дэвшигч (SAFE_CANDIDATE / NEEDS_REVIEW) | ҮГҮЙ — оффлайн хуулбар |
| `MGL_TOKEN=… npm run audit:r2:fetch [-- --host=…]` | R2 инвентор (`GET /api/storage/inventory`, admin) → `cleanup-out/r2-inventory-*.json` | ЗӨВХӨН УНШИНА (R2 list, ~15 Class A) |
| `npm run audit:storage` | Инвенторыг ангилал/сараар нэгтгэсэн тайлан | ҮГҮЙ |
| `npm run audit:r2:orphans [-- --db=… --min-age-days=7]` | Инвентор × D1 ишлэл → `cleanup-out/orphan-manifest.json` (HIGH/MEDIUM/LOW) | ҮГҮЙ |
| `npm run cleanup:preview` | Дээрх бүгдийг DRY RUN-аар нэг дор | ҮГҮЙ |
| `npm run cleanup:r2 [-- --category=…] [-- --execute --i-have-a-backup]` | Манифестын HIGH объектуудыг устгана (`wrangler r2 object delete`) | ЗӨВХӨН --execute үед |
| `npm run cleanup:db [-- --execute --i-have-a-backup] [-- --local]` | SAFE_CANDIDATE мөрүүдийг `wrangler d1 execute --file` | ЗӨВХӨН --execute үед |

## Дараалал

1. `node scripts/d1.mjs export --remote --output=d1-backup.sql` (уншина; энэ нь мөн backup)
2. `MGL_TOKEN=<admin JWT> npm run audit:r2:fetch`
3. `npm run cleanup:preview -- --db=d1-backup.sql` → тайланг хүн уншина
4. `cleanup-out/orphan-manifest.json`-ийн MEDIUM мөрийг шалгаж, шаардлагатай бол HIGH болгоно
5. `npm run cleanup:r2 -- --execute --i-have-a-backup` (эзэн)
6. `npm run cleanup:db -- --execute --i-have-a-backup` (эзэн)

`r2-lifecycle.proposed.json` — bucket-ийн lifecycle дүрмийн санал (`docpreview/`,
`client-reports/`, multipart).  Хэрэгжүүлээгүй; `wrangler r2 bucket lifecycle set`.

⚠️ D1 хуулбар нь инвентороос хуучин байвал шинэ файлууд «ишлэлгүй» харагдана —
`--min-age-days` нь хуулбарын огнооноос хойш байх ёстой.
