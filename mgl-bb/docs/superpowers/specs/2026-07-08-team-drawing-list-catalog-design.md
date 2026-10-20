# Зургийн жагсаалт — нийтлэг нэмэлт мөр + PDF интеграц

**Огноо:** 2026-07-08 · **Хамрах хүрээ:** backend (migration 0121 + шинэ route + bulk overrides GET) + frontend (8 Document, 4 render surface, Загвар засах UI)

## Асуудал

Баг бүрийн тайлбар бичгийн «Зургийн жагсаалт» хэсэг (8 багт, бүгд checkbox) кодод хатуу бичигдсэн. Хоёр дутагдал:

1. **Мөр нэмэх боломжгүй** — хэрэглэгч бүх багийн жагсаалтад admin/senior шинэ мөр нэмдэг болгохыг хүссэн, **бүх төсөлд нэгэн зэрэг** үйлчилдэг (баталгаажсан сонголт).
2. **PDF-тэй интеграцгүй** — «Загвар засах» (per-project override)-аар нэр зассан ч, хэвлэх Document-ууд (`XxDocument.tsx` × 8) өөрсдийн хатуу `DRAWING_LIST_ROWS`-оо хэрэглэдэг тул **форм дээр харагдаад PDF-д гардаггүй** (хэрэглэгчийн гомдол). Шинэ нэмэлт мөр ч мөн адил гарахгүй байх байсан.

## Шийдэл

### 1. Нийтлэг каталог (нэмэлт мөр) — DB
- Migration `0121_team_drawing_items.sql`: `team_drawing_items` (id PK, team_code TEXT, key TEXT UNIQUE — `dl_custom_<uuid8>`, label TEXT, position INTEGER, created_at). Үндсэн жагсаалтууд кодод хэвээр (seed хийхгүй); DB-д зөвхөн нэмэлтүүд.
- Шинэ route `backend/src/routes/teamDrawingItems.ts` → `/api/team-drawing-items`: `GET /` (бүх ажилтан, багаар бүлэглэсэн), `POST` + `PATCH /:id` (**requireManager** = admin+senior; label + team_code, key immutable), `DELETE /:id` (**requireAdmin**). index.ts-д mount.
- `teamFormTemplates.ts`-д bulk `GET /:id/team-form-templates` (бүх багийн overrides нэг дор) — Гүйцэтгэлийн тайлангийн PDF хуудсанд хэрэгтэй.

### 2. Documents — жагсаалтыг data-driven болгох (PDF интеграцийн гол хэсэг)
- Шинэ модуль `team-reports/drawingList.tsx`: `DrawingRow {no,key,label}`, `DrawingListContext` (resolver context), `resolveDrawingRows(teamCode, baseRows, overrides, extras)` — (а) base мөрүүдэд override label-ийг тусгана (одоо PDF-д гардаггүй байсан нэр засвар гарна), (б) нэмэлт мөрүүдийг үргэлжилсэн дугаартай залгана.
- 8 `XxDocument.tsx`: хатуу `DRAWING_LIST_ROWS`-ийг context resolver-ээр дамжуулж авна (`useContext` + fallback = хуучин зан); answers-ийг `Record<string, unknown>`-оор индекслэнэ (нэмэлт түлхүүр).
- Provider-ууд (context өгөх 4 газар):
  - `TeamReportShell` — catalog query (staleTime ∞) + өөрийн overrides; мөн нэмэлт мөрүүдийг resolvedSections-ийн drawing-list хэсэгт checkbox болгож залгана (форм автоматаар рендэрлэнэ).
  - `TeamReportPrintPage` — catalog + тухайн багийн overrides-ийг Promise.all-д татаж provider-ээр өгнө (print-readiness автоматаар хамгаална).
  - `PerformanceReportPrintPage` — catalog + bulk overrides Promise.all-д (readiness-гэйд); ctx биш context-оор.
  - `PerformanceReportPreview` — react-query fetch + provider (in-app тул race байхгүй).
- `TemplatePreview` (projectId 0) — provider-гүй fallback (cosmetic, зүгээр).

### 3. Удирдах UI — «Загвар засах» горимд
`TeamFormTemplateEditor`-ийн drawing-list хэсэгт «Нийтлэг мөр (бүх төсөлд)» блок: жагсаалт + нэмэх/засах (admin+senior), устгах (admin). `/api/team-drawing-items` руу шууд; амжилтад catalog query invalidate. Хэрэглэгчийн одоогийн ажлын урсгалд (Загвар засах) байрлана.

## Verification
- Build: frontend `tsc -b --force` + vite цэвэр; backend dry-run.
- Local: migration локал D1-д; мөр нэмээд (а) бүх төслийн тухайн багийн формд гарах, (б) check хийгээд багийн тайлан PDF + Гүйцэтгэлийн тайлан PDF-д гарах, (в) override нэр засвар PDF-д гарах болсон эсэх.
- Deploy: remote migration 0121 → backend deploy → frontend deploy; PDF-ийг API-аар татаж текст шалгах.
