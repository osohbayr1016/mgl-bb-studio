# §03 · Data model — 5 түвшний жинтэй мод

Энэ бол progress код руу орохоос өмнө **заавал** толгойдоо суулгах ганц хамгийн чухал зүйл.

## Мод

```
Project
 └─ Block        team_id, weight_percent (block-ийн дотор 100 болно)
    └─ Drawing   weight_percent (block доторх)
       └─ Component  weight_percent (drawing доторх)
          └─ Task    weight_percent (component доторх), assigned_to / assignees

─────────────────────────────────────────────
project_team_shares.share_percent
  "баг T нь төслийн N%-ийг эзэлнэ" — төслийн хэмжээнд 100 болно
```

Түвшин бүрийн `weight_percent` нь **parent-ийнхаа дотор** 100 болно. Нэмээд `share_percent` нь багуудын хооронд 100 болно. Төслийн нийт progress бол давхарласан жинтэй нийлбэр:

```sql
-- PROJECT_LIST_SQL (backend/src/routes/projects.ts) — нэг query-ийн rollup
block.weight_percent
  × Σ(drawing.weight_percent × Σ(task.weight_percent × task.progress/100))
  × team_share.share_percent / 100
```

Нэг query-д хийдэг CTE-г `PROJECT_LIST_SQL` дотор хар. Хуучин хувилбар nested N+1 loop хийдэг байсан — **тийш бүү буц**.

## ⚠️ Хамгийн ноцтой хавх — 348% bug

Олон багтай төсөлд `× share_percent/100`-г мартвал progress хэдэн зуун хувь болж хөөрдөг. Progress тооцдог **бүх surface** ижилхэн жинтэй CTE-г давтдаг тул **заавал таарах ёстой**:

- projects list (`routes/projects.ts`)
- dashboard (`routes/dashboard.ts`)
- company overview (`routes/company.ts`)
- daily report
- performance-report snapshot (`snapshotTeamProgress` — нормчилсан жигнэсэн дундаж, drawing нэрийн prefix-ээр бүлэглэсэн)

## Нийлбэрийг DB хэзээ ч албаддаггүй

100 болоогүй байсан ч хагас засварласан roster-ыг хадгалж болно. UI нь «100 болохгүй байна» гэдгийг зөөлөн **amber warning**-оор л харуулна. Server талын sanitiser-ууд (`sanitizeClients`, `sanitizeTeamShares`) утгыг `[0,100]`-д clamp хийдэг ч 100 болоогүй гэж reject хийдэггүй.
