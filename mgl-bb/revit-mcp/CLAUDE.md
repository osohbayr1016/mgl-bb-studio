# CLAUDE.md — Revit MCP project guide & Mongolian building-code rules

This file gives Claude the context and the **Mongolian construction norms (БНбД —
Барилгын норм ба дүрэм)** to follow when generating Revit geometry for this
project. Read it before writing `run_revit_code` C#.

> ⚠️ The figures below are **design-guidance values** distilled from public
> sources (see *Sources*). They are good enough for schematic modeling and demos.
> For a real permit set, verify each number against the current official БНбД /
> MNS document — codes are revised often (most were renumbered to the `-21`/`-22`/
> `-23` editions).

---

> **⚠️ AI ТУСЛАХ ДЭЭР АЖИЛЛАХААР БОЛ ЭХЛЭЭД `docs/ASSISTANT.md`-Г УНШ.**
> Тэнд бүх шийдвэр, олдсон урхи, одоогийн байдал, барих/ажиллуулах командууд
> нэг дор бий.  Энэ файл (CLAUDE.md) нь ЗӨВХӨН БНбД-ийн норм ба геометр
> үүсгэх дүрмийн тухай.

## 1. Project context

Revit MCP bridge: Claude writes C# Revit-API snippets → Python MCP server →
localhost HTTP → C# add-in runs them inside Revit 2027 on the live model.

- Demo model: **tennis hall (Теннисний ордон)**, single floor (L1), ~64×64 m
  square footprint, 8 m grid, 2 courts, 2 stands (150 seats), 77 named rooms.
- Specs/plan live in `docs/superpowers/` (written in Mongolian).
- Saved C# build steps in `scripts/revit/`.

### Modeling conventions (must follow)
- A transaction **"MCP Script" is already open** — never start/commit your own.
- Input dimensions in **metric (m / mm)**; convert to Revit feet:
  `UnitUtils.ConvertToInternalUnits(8000, UnitTypeId.Millimeters)`.
  Keep a `double FT(double m) => UnitUtils.ConvertToInternalUnits(m, UnitTypeId.Meters);`
  helper at the top of geometry scripts.
- Origin `(0,0)` = SW corner; X→east, Y→north.
- After each build step, run a **verify query** (FilteredElementCollector counts /
  coordinates) and `Print` PASS/FAIL. Errors auto-rollback — fix and re-run.

---

## 2. Which Mongolian codes apply here

| Code | Title (MN) | Use it for |
|------|------------|------------|
| **БНбД 31-03** (…-03 / current ed.) | Олон нийт, иргэний барилга — Public & civil buildings | Core rule set for a sports/public hall: rooms, corridors, stairs, evacuation |
| **БНбД 30-01-04** | Хот, суурины төлөвлөлт, барилгажилт — Town planning & development | Site layout, setbacks, plot dimensions, sunlight |
| **БНбД 22-01-21** | Газар хөдлөлтийн бүс нутагт барилга төлөвлөх — Seismic design | UB is a seismic zone — structural layout, regularity |
| **БНбД 21-01 / Галын аюулгүйн дүрэм** | Гал түймрийн аюулгүй байдал — Fire safety | Egress, fire-resistance, travel distance |
| **БНбД 31-23-22 / БД 31-112** | Барилгад хөгжлийн бэрхшээлтэй иргэний хүртээмж — Accessibility | Ramps, accessible WCs, door clear widths |
| **MNS 6056-2009** | Явган хүн, ХБИ-д зориулсан замыг төлөвлөх — Accessible routes | Ramp slope/width, external paths |
| Sport facility norms | Спортын барилга байгууламжийн норм | Hall finishes, equipment-store access |

Sports halls are designed to the **sports-facility norms _plus_ БНбД 31-03**
(public buildings) and the cross-referenced fire/accessibility/seismic codes.

---

## 3. Dimensional rules to bake into geometry

All values metric; treat as **minimums** unless noted. Convert in C# with `FT()`.

### Horizontal circulation
- **Corridor / хонгил width:** ≥ **1.2 m** if length ≤ 10 m; ≥ **1.5 m** if
  length > 10 m. For a public hall with crowd flow, prefer ≥ 1.8–2.0 m on main
  routes.
- **Evacuation door (нүүлгэн шилжүүлэх хаалга) clear width:** ≥ **1.2 m** on
  egress routes. Main entrance leaves wider.
- **Internal door clear opening:** ≥ **0.9 m** (accessible rooms / WCs);
  standard rooms ≥ 0.8 m.
- **Service passage to sports equipment store:** open passage ≥ **2.0 m wide**
  and ≥ **2.2 m high**, or via the hall door. Gymnastics-equipment store
  length ≥ **5 m**.

### Vertical circulation & heights
- **Ceiling height (clear), rooms:** ≥ **2.4 m**; corridors ≥ **2.2 m**; service/
  technical passages to lowest projection ≥ **1.8 m**. (A tennis hall playing
  volume needs far more — see §5.)
- **Stairs:** model code-compliant runs; egress stair flights/landings sized to
  occupant load. Keep landing depth ≥ stair width; no heating gear within 2.2 m
  above a landing. Use riser ≤ ~0.15 m / tread ≥ ~0.30 m for public stairs as a
  schematic default (verify against current edition).

### Accessibility (ХБИ)
- **Ramp slope ≤ 5 % (1:20)**, clear width ≥ **0.9 m**, non-slip surface,
  handrails both sides ≥ **0.9 m** high.
- Provide a ramp (or stair) wherever a floor-to-path level difference > **4 cm**.
- Accessible provision: ≥ **2 %** of building capacity for public buildings
  (≥ **3 %** for recreation/tourism facilities) must be designed for people with
  disabilities.
- External accessible paths: longitudinal slope ≤ 5 %, cross slope ≤ 1 %.

### Daylight / siting
- **Direct sunlight (insolation):** habitable rooms of residential & public
  buildings normalized to **3–4 h/day** continuous — keep glazing on
  south/relevant facades and avoid self-shading wings.
- Plot dimensions, setbacks and parking follow БНбД 30-01-04 and the approved
  urban-planning document for the site.

### Fire safety (галын аюулгүй байдал)
- Maintain ≥ 2 means of egress where occupant load requires; keep travel
  distance to an exit within code limits for the occupancy.
- Egress doors swing in the direction of travel and stay ≥ 1.2 m clear.
- Fire extinguishers near exits, visible, mounted ≤ **1.5 m** above floor, not
  obstructing egress.
- Ramps/stairs on egress routes: fire-resistant construction, ≥ **2 h** rating.

### Seismic (газар хөдлөлт) — Ulaanbaatar
- UB sits in a seismic region; БНбД 22-01-21 applies. MSK intensities 5/6/7/8/9
  ≈ ground accelerations 25/50/100/200/400 cm/s².
- Favor a **regular, symmetric plan** (this square footprint is good), continuous
  load paths, and avoid large re-entrant corners / abrupt mass changes. Long
  spans over the courts need engineered structure (out of schematic scope).

---

## 4. How to apply this when modeling (checklist)

When generating the tennis-hall (or any public-building) geometry:

1. Footprint & grid metric, regular and symmetric (seismic-friendly).
2. Every room reachable via a corridor ≥ 1.5 m (≥ 1.8–2.0 m main routes).
3. At least two egress doors from the main hall, each ≥ 1.2 m clear, swinging out.
4. Place an accessible ramp at any entrance with a level change > 4 cm (≤ 5 %).
5. Door clear widths ≥ 0.9 m for WC/accessible rooms, ≥ 0.8 m elsewhere.
6. Room clear height ≥ 2.4 m (model walls/levels accordingly); corridors ≥ 2.2 m.
7. Keep south-facing glazing for the 3–4 h insolation rule.
8. After modeling, run a verify query that asserts these minimums where feasible
   (e.g. compute corridor width from wall coordinates and `Print` PASS/FAIL).

---

## 5. Tennis-specific (reference, not BNbD)

- ITF court playing lines: **23.77 m × 10.97 m** (doubles); with run-off a single
  court occupies ~**36 m × 18 m**. Two parallel courts ≈ 36 m × 37 m hall.
- Real indoor tennis needs ~**9 m+ clear height** over the court and generous
  run-off — model the hall volume tall even though BNbD room minimums are lower.
- Spectator stands: 2 × 75 = 150 seats, opposite long sides; schematic stepped
  platform + seat marks.

---

## 6. Caveats

- Numbers here are indicative minimums gathered from public/secondary sources and
  several BNbD editions; **confirm against the exact current document** before any
  real submission.
- The Mongolian code system was re-issued (`-21`/`-22`/`-23` editions). When a
  precise clause matters, fetch the specific PDF from `mcis.gov.mn/mn/norm` or
  `legalinfo.mn`.
- This is a schematic/demo model — structural, MEP, fire-engineering and exact
  area parity with any reference drawing are out of scope.

---

## Sources

- [Барилгын салбарын нэгдсэн систем — норм ба дүрэм (official portal)](https://mcis.gov.mn/mn/norm)
- [Монгол улсын барилгын норм ба дүрэм (catalog PDF)](https://eco.buildersasso.mn/files/1656056423_62b56a679d113.pdf)
- [Захиргааны зориулалттай олон нийтийн барилга — БНбД 31-04 (legalinfo)](https://legalinfo.mn/mn/detail?lawId=206060)
- [Олон нийт/иргэний барилга норм (mcis PDF)](https://mcis.gov.mn/storage/uploads/process/file_1634171095339127_162364495749810.pdf)
- [Хот, суурины төлөвлөлт, барилгажилт — БНбД 30-01 (mcis PDF)](https://mcis.gov.mn/storage/uploads/process/202403/file_1710112307903138_162364495749810.pdf)
- [Газар хөдлөлтийн бүс нутагт барилга төлөвлөх — БНбД 22-01-21 (ulsturch.mn)](https://www.ulsturch.mn/a/55088)
- [Галын аюулгүй байдлын үндсэн дүрэм (legalinfo)](https://legalinfo.mn/mn/detail?lawId=207780)
- [Барилга, байгууламжид ХБИ-ний хүртээмжийг төлөвлөх — БНбД 31-23-22 (legalinfo)](https://legalinfo.mn/mn/detail?lawId=16530828571291)
- [MNS 6056-2009 — Явган хүн, ХБИ-д зориулсан замыг төлөвлөх заавар (gadpwd.gov.mn)](http://www.gadpwd.gov.mn/uploads/files/MNS%206056-2009%20%D0%AF%D0%B2%D0%B3%D0%B0%D0%BD%20%D1%85%D2%AF%D0%BD,%20%D1%85%D3%A9%D0%B3%D0%B6%D0%BB%D0%B8%D0%B9%D0%BD%20%D0%B1%D1%8D%D1%80%D1%85%D1%88%D1%8D%D1%8D%D0%BB%D1%82%D1%8D%D0%B9%20%D0%B8%D1%80%D0%B3%D1%8D%D0%B4%D1%8D%D0%B4%20%D0%B7%D0%BE%D1%80%D0%B8%D1%83%D0%BB%D1%81%D0%B0%D0%BD%20%D0%B7%D0%B0%D0%BC%D1%8B%D0%B3%20%D1%82%D3%A9%D0%BB%D3%A9%D0%B2%D0%BB%D3%A9%D1%85%20%D0%B7%D0%B0%D0%B0%D0%B2%D0%B0%D1%80.pdf)
- [Ерөнхий боловсролын сургуулийн барилгын төлөвлөлт — БНбД 31-25-22 (legalinfo)](https://legalinfo.mn/mn/detail?lawId=16531723968611)
- [ICC Global Building Codes Tool: Mongolia](https://global.iccsafe.org/uncategorized/mongolia/)
