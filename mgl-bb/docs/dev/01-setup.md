# §01 · Локал орчин босгох

Backend болон frontend нь тусдаа ажилладаг. Ихэвчлэн frontend-ээ **амьд (production) API-руу** шууд хатгаад хөгжүүлэхэд хангалттай — заавал локал worker босгох албагүй.

## Backend (`backend/`-оос)

```bash
npm run dev              # wrangler dev :3000 (локал D1 + R2)
npm run db:migrate:local # зөвхөн 0001_init.sql-ийг локал D1-д
npm run db:seed:local    # зөвхөн 0002_seed.sql
```

Шинэ migration-ыг локалд тавихдаа `db:*` script биш (тэр 2 файлд pin хийсэн, generic биш), шууд:

```bash
npx wrangler d1 execute mgl-progress-db --local --file=./migrations/NNNN_name.sql
```

## Frontend (`frontend/`-оос)

```bash
npm run dev      # vite dev :5173 (COOP/COEP header prod-той адил)
npm run build    # tsc -b && vite build
npm run lint     # eslint .
npm run preview  # vite preview
ANALYZE=1 npm run build  # dist/stats.html bundle шинжилгээ (rollup-plugin-visualizer)
```

Локал frontend-ийг локал backend руу заахын тулд `frontend/.env.local`-д:

```
VITE_API_HOST=http://localhost:3000
```

Байхгүй бол production worker URL руу default-оор фолбэк хийдэг. Санамсаргүй `http://localhost:5173` нь production `ALLOWED_ORIGINS`-д мөн орсон болохоор локал vite-аа шууд амьд API-руу хатгаад хөгжүүлж болно.

## ⛔ Тест байхгүй

Энэ репод **тест suite байхгүй**. `npm test` гэж зохиож болохгүй — байхгүй зүйл. (Ганц `qtoNormalize.test.ts` байгаа ч runner холбоогүй.) Батлахдаа `tsc -b --force` + бодит апп дээр гараар шалга.

## Хэрэгтэй secrets (production worker дээр)

wrangler `[vars]`-д **БИШ**, secret-ээр орсон:

- `JWT_SECRET`
- `SPEECHMATICS_API_KEY` / `SPEECHMATICS_WEBHOOK_SECRET`
- `GOOGLE_SA_JSON`
- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`
- `EMAIL_ENCRYPTION_KEY` (256-bit key-ийн base64)
- `STIRLING_API_KEY`
- `APS_CLIENT_ID` / `APS_CLIENT_SECRET`

Локалд эдгээрийг `backend/.dev.vars`-д тавина (мөн энэ файл CORS-ыг localhost руу override хийдэг).
