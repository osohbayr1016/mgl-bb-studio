# §11 · Deploy дараалал

## ⚠️ CI-аар deploy хийдэггүй

Deploy бүгд **локал wrangler**-ээр (2026-07-06 конвенц). `.github/workflows/deploy-*.yml` байгаа ч найдаж болохгүй — backend CI 2026-06-д чимээгүй унтарсан. Мөн CI-ийн `CLOUDFLARE_API_TOKEN` secret хоосон.

## Backend (`backend/`-оос) — migration ЭХЛЭЭД

```bash
# 1) migration ЭХЛЭЭД
npx wrangler d1 migrations apply mgl-progress-db --remote --config wrangler.toml
# 2) дараа нь worker
npx wrangler deploy --config wrangler.toml
```

## Frontend (`frontend/`-оос)

```bash
npm run build
npx wrangler pages deploy dist --project-name mgl-progress-frontend --branch main
```

## Гол дүрмүүд

- Дев PC дээр `--config wrangler.toml` flag **заавал** (wrangler 4.83-ийн config-discovery quirk).
- `migrations apply` нь **idempotent**, аюулгүй. `d1_migrations` bookkeeping 2026-07-03-д reconcile хийсэн.
- Remote migration-ыг **хэзээ ч `d1 execute --file`-аар бүү тавь** — bookkeeping-ыг алгасаж drift үүсгэдэг (анхны drift-ийн шалтгаан).
- Remote D1 schema нь `d1_migrations` tracker-ээс урдуур гүйдэг. «duplicate column» алдаа гарвал **re-run биш, reconcile** хий.
- Frontend build-ийг ихэвчлэн хэрэглэгч гараар deploy хийдэг. Хэрэв tree-д бусдын WIP байвал **цэвэр HEAD worktree-оос** build хий.
- Контейнер-сервисүүд ([§10](10-containers.md)) тус тусад нь `cd <folder> && npx wrangler deploy`.

## Migration нэмэх

`backend/migrations/` дор `NNNN_name.sql`. **Хамгийн өндөр дугаар нь дийлдэг**; applied migration-ыг **хэзээ ч бүү зас**, шинийг нэм. (Анхаар: `0110`, `0120`, `0121` дугаар давхардсан файлтай — [§13](13-dead-code.md).) Одоо `0125` хүртэл.
