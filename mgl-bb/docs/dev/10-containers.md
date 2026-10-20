# §10 · Контейнер-сервисүүд

3 фолдер тус бүр өөрийн Worker + Docker контейнер. Backend-ээс тус бүрд **service binding**-ээр (дотоод, public hop үгүй) дууддаг. Тус тусад нь deploy хийдэг — ингэснээр MGL-ийн Durable Object migration жагсаалт цэвэр байна.

| Сервис | Статус | Тухай |
|--------|--------|-------|
| `weasyprint/` | ✅ **LIVE** | HTML→PDF (Pango/Cairo, JS үгүй). `WEASYPRINT_SVC`-ээр холбогдсон. Client design-progress тайлангийн PDF. Cyrillic Noto фонт баттай. |
| `stirling/` | ✅ **LIVE** | Stirling-PDF toolbox (compress/watermark/page-number/merge/нууц үг). `STIRLING_SVC`-ээр. `/api/pdf-tools`-г тэжээнэ. Нийтийн UI ч бий (`STIRLING_PUBLIC_URL`). |
| `ifc-convert/` | 🟡 **STAGED** | IFC→xeokit `.xkt`. Код бэлэн ч **backend-д `IFC_CONVERT_SVC` binding ХОЛБООГҮЙ** — интеграцлаагүй. Гар хүрэхээсээ өмнө энэ status-ыг сана. |

## Deploy

Контейнер-Worker тус бүрийг **тусдаа**:

```bash
cd weasyprint && npx wrangler deploy
cd stirling   && npx wrangler deploy
```

Deploy хийсэн жишээ хостууд: `mgl-weasyprint`, `mgl-stirling` (`*.anandoctane4.workers.dev`).

## Кодоос дуудах

- `lib/weasyprint.ts` → `WEASYPRINT_SVC.fetch('https://weasyprint-svc/render', { html })` → PDF.
- `lib/stirling.ts` → op pipeline (page-number/watermark/compress) sequential multipart POST, гаралт бүрийг дараагийнх руу дамжуулна.

Хэрэв binding байхгүй / URL хоосон бол холбогдох UI товч **нуугдана** (feature dormant).
