# Team SVG Icon System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Баг (discipline) бүрд lucide хэв маягийн SVG icon өгч, TeamChip (апп даяарх бүх strip) болон TeamDetailPage-ийн толгойд харуулах.

**Architecture:** Нэг шинэ файл `frontend/src/shared/components/TeamIcon.tsx` — 11 багийн 24×24 stroke icon + fallback, `currentColor`-оор өнгө авдаг. Интеграц 2 цэгт: `TeamChip` (TeamTabsStrip.tsx — Badge-ийн `[&>svg]:size-3` дүрэм 12px болгож автоматаар тааруулна) ба `TeamDetailPage` толгойн tile (28px, `teamTone(code).text` өнгөөр).

**Tech Stack:** React 19 + TypeScript (strict), Tailwind, inline SVG (шинэ dependency байхгүй).

**Verification:** Repo-д тест suite байхгүй (CLAUDE.md). Шалгалт = targeted typecheck + eslint + нүдээр. Working tree-д бусад агентын дуусаагүй өөрчлөлтүүд байгаа тул `tsc -b`-ийн алдааг зөвхөн энэ ажлын 3 файлаар шүүж харна; өөр файлын алдаа бол хамаагүй — бүү хөөцөлд.

**Spec:** `docs/superpowers/specs/2026-06-12-team-svg-icons-design.md`

---

### Task 1: TeamIcon компонент (12 icon)

**Files:**
- Create: `frontend/src/shared/components/TeamIcon.tsx`

- [ ] **Step 1: Файлыг бүтнээр нь бичих**

```tsx
import type { ReactNode } from 'react';

/* =============================================================
 * Баг (discipline) бүрийн SVG icon — lucide хэв маяг: 24×24
 * viewBox, fill=none, stroke=currentColor, 2px, round cap/join.
 * Өнгийг icon өөрөө тогтоохгүй — эцэг элементийн text color
 * (ихэвчлэн teamTone(code).text эсвэл teamChipClass) дагана.
 * Кодын багц нь shared/lib/team-colors.ts-ийн PALETTE-тай ижил;
 * бүртгэлгүй код → хүмүүс (users) fallback, хэзээ ч throw хийхгүй.
 * ============================================================= */

/** HAS сэнсний нэг далавч — 120°-аар эргүүлж 3 хувь хэрэглэнэ. */
const FAN_BLADE = 'M12 9.75C12 6 14.25 3.25 18 3.25 18 7 15.75 9.75 12 9.75Z';

const ICONS: Record<string, ReactNode> = {
  /* Барилга архитектур — фасад: контур + цонхны цэгүүд + хаалга */
  BA: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="1" />
      <path d="M10 21v-4h4v4" />
      <path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01" />
    </>
  ),
  /* Барилга бүтээц — дээвэр ферм: суурь + гурвалжин + төв тулгуур */
  BB: (
    <>
      <path d="M3 17h18" />
      <path d="M3 17 12 7l9 10" />
      <path d="M12 7v10" />
      <path d="M6 21v-4" />
      <path d="M18 21v-4" />
    </>
  ),
  /* Халаалт агаар сэлгэлт — 3 далавчтай сэнс */
  HAS: (
    <>
      <circle cx="12" cy="12" r="2.25" />
      <path d={FAN_BLADE} />
      <g transform="rotate(120 12 12)">
        <path d={FAN_BLADE} />
      </g>
      <g transform="rotate(240 12 12)">
        <path d={FAN_BLADE} />
      </g>
    </>
  ),
  /* Цэвэр бохир ус — хоолойн өвдөг (elbow) + доош дусал */
  TSBU: (
    <>
      <path d="M3 4h7a7 7 0 0 1 7 7v3" />
      <path d="M3 8h7a3 3 0 0 1 3 3v3" />
      <path d="M3 4v4" />
      <path d="M13 14h4" />
      <path d="M15 16l1.77 1.77a2.5 2.5 0 1 1-3.54 0Z" />
    </>
  ),
  /* Цахилгаан — аянгын оч (lucide zap) */
  TSAH: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />,
  /* Холбоо дохиолол — радио цамхаг: оройн цэг + долгион + хөл */
  HD: (
    <>
      <circle cx="12" cy="7" r="2" />
      <path d="M12 9v3" />
      <path d="M7.5 21 12 12l4.5 9" />
      <path d="M8.5 10.5c-2-1.9-2-5.1 0-7" />
      <path d="M15.5 3.5c2 1.9 2 5.1 0 7" />
    </>
  ),
  /* Автомат удирдлага — CPU чип: гадна rect + цөм + хөлүүд */
  AU: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <rect x="10" y="10" width="4" height="4" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </>
  ),
  /* Эскиз зураг — харандаа + татаж буй зураас */
  EZ: (
    <>
      <path d="M17 3l4 4L8 20l-5 1 1-5Z" />
      <path d="M15 5l4 4" />
      <path d="M13 21h8" />
    </>
  ),
  /* Интерьер зураг — түшлэгтэй сандал (armchair) */
  IZ: (
    <>
      <path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3" />
      <path d="M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4a2 2 0 0 0-4 0v1H7v-1a2 2 0 0 0-4 0Z" />
      <path d="M5 18v2" />
      <path d="M19 18v2" />
    </>
  ),
  /* Гадна тохижилт — шилмүүст мод */
  GT: (
    <>
      <path d="M12 2l5 7h-2.5l4.5 6H5l4.5-6H7l5-7Z" />
      <path d="M12 22v-7" />
    </>
  ),
  /* Менежмент — цүнх (briefcase) */
  MGMT: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </>
  ),
};

/* Бүртгэлгүй / хоосон код — хүмүүс (lucide users) */
const FALLBACK_ICON: ReactNode = (
  <>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </>
);

export function TeamIcon({
  code,
  size = 16,
  className,
}: {
  /** Багийн код (BA, TSAH, …). null/үл мэдэх → fallback. */
  code?: string | null;
  /** width/height px. Badge доторх [&>svg]:size-3 зэрэг CSS дүрэм
   *  үүнийг дарж болно — тэр нь зориудынх. */
  size?: number;
  className?: string;
}) {
  const glyph = (code ? ICONS[code.toUpperCase()] : undefined) ?? FALLBACK_ICON;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {glyph}
    </svg>
  );
}
```

- [ ] **Step 2: Targeted typecheck + lint**

Run (Bash, `frontend/`-ээс):
```bash
cd frontend && npx tsc -b 2>&1 | grep -E 'TeamIcon' ; npx eslint src/shared/components/TeamIcon.tsx
```
Expected: grep юу ч олохгүй (TeamIcon-д алдаагүй), eslint цэвэр. `tsc -b` бусад агентын файлд алдаа заавал — хамаагүй, орхи.

- [ ] **Step 3: Commit (зөвхөн энэ файл)**

```bash
git add frontend/src/shared/components/TeamIcon.tsx
git commit -m "feat(teams): TeamIcon — discipline SVG icon set (lucide-style, currentColor)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: TeamChip интеграц (апп даяар тарна)

**Files:**
- Modify: `frontend/src/shared/components/TeamTabsStrip.tsx:48-60` (TeamChip)

- [ ] **Step 1: Import нэмэх**

`TeamTabsStrip.tsx`-ийн import блокт (мөр 8 орчим, бусад import-уудын дараа):

```tsx
import { TeamIcon } from '@/shared/components/TeamIcon';
```

- [ ] **Step 2: Badge дотор icon оруулах**

TeamChip-ийн Badge (мөр 51-60). Badge нь өөрөө `inline-flex items-center gap-1 [&>svg]:size-3` тул icon автоматаар 12px болж, кодны өмнө зайтай суана — өөр class нэмэх шаардлагагүй:

```tsx
      <Badge
        variant="outline"
        className={cn(
          teamChipClass(item.code),
          'text-[11px] font-semibold px-2 py-0.5',
          active && 'ring-1 ring-offset-1 ring-offset-background ring-primary/30',
        )}
      >
        <TeamIcon code={item.code} />
        {item.code}
      </Badge>
```

(Өөрчлөлт нь зөвхөн `<TeamIcon code={item.code} />` мөр нэмэгдэж байгаа.)

- [ ] **Step 3: Targeted typecheck + lint**

```bash
cd frontend && npx tsc -b 2>&1 | grep -E 'TeamTabsStrip|TeamIcon' ; npx eslint src/shared/components/TeamTabsStrip.tsx
```
Expected: grep хоосон, eslint цэвэр.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/shared/components/TeamTabsStrip.tsx
git commit -m "feat(teams): show discipline icon inside TeamChip badges

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: TeamDetailPage толгойн tile

**Files:**
- Modify: `frontend/src/features/teams/TeamDetailPage.tsx:394-405`

- [ ] **Step 1: Import нэмэх**

Файлын import блокт:

```tsx
import { TeamIcon } from '@/shared/components/TeamIcon';
import { teamTone } from '@/shared/lib/team-colors';
```

- [ ] **Step 2: Tile-ийн mono кодыг icon-оор солих, кодыг дэд мөрөнд шилжүүлэх**

Одоогийн (мөр 394-405):

```tsx
<div className="w-14 h-14 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
  <span className="font-mono font-bold text-primary text-lg">{data.team.code}</span>
</div>
<div className="min-w-0 flex-1">
  <h1 className="text-xl lg:text-2xl font-bold tracking-tight truncate">
    {data.team.name_mn}
  </h1>
  <div className="flex items-center gap-2 text-sm text-muted-foreground mt-0.5">
    {data.team.name_en && <span>{data.team.name_en}</span>}
    {data.team.name_en && data.team.description && <span className="opacity-50">·</span>}
    {data.team.description && <span className="truncate">{data.team.description}</span>}
  </div>
</div>
```

Шинэ — tile-д icon (28px, багийн brand өнгөөр), код нь нэрийн дэд мөрөнд үлдэнэ (мэдээлэл алдагдахгүй):

```tsx
<div className="w-14 h-14 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
  <TeamIcon code={data.team.code} size={28} className={teamTone(data.team.code).text} />
</div>
<div className="min-w-0 flex-1">
  <h1 className="text-xl lg:text-2xl font-bold tracking-tight truncate">
    {data.team.name_mn}
  </h1>
  <div className="flex items-center gap-2 text-sm text-muted-foreground mt-0.5">
    <span className="font-mono font-semibold text-foreground/80">{data.team.code}</span>
    {data.team.name_en && <span className="opacity-50">·</span>}
    {data.team.name_en && <span>{data.team.name_en}</span>}
    {data.team.description && <span className="opacity-50">·</span>}
    {data.team.description && <span className="truncate">{data.team.description}</span>}
  </div>
</div>
```

- [ ] **Step 3: Targeted typecheck + lint**

```bash
cd frontend && npx tsc -b 2>&1 | grep -E 'TeamDetailPage|TeamIcon' ; npx eslint src/features/teams/TeamDetailPage.tsx
```
Expected: grep хоосон, eslint цэвэр.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/teams/TeamDetailPage.tsx
git commit -m "feat(teams): discipline icon in team detail header tile

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Нүдээр шалгах

**Files:** өөрчлөлтгүй (зөвхөн шалгалт)

- [ ] **Step 1: Dev сервер асаах**

```bash
cd frontend && npm run dev
```
(`frontend/.env.local`-д `VITE_API_HOST=http://localhost:3000` хэрэгтэй; backend-гүй бол login хийгдэхгүй ч icon-ы render-ийг login хуудасны өмнөх strip-гүйгээр шалгаж чадахгүй — энэ тохиолдолд Step 2-ыг хэрэглэгч өөрөө prod/staging дээр шалгана гэж тэмдэглэ.)

- [ ] **Step 2: Шалгах хуудсууд (light + dark хоёуланд)**

1. `/app/teams` → аль нэг баг → TeamDetailPage толгой: 28px icon багийн өнгөөр, дэд мөрөнд код харагдана.
2. Төслийн дэлгэрэнгүй → block filter strip: chip бүрд 12px icon + код.
3. Approvals (`/app/progress`) эсвэл Тайлан: TeamChip-үүд icon-той.
4. Үл мэдэх кодтой баг байвал (шинээр үүсгэсэн) — fallback хүмүүс icon, crash байхгүй.

- [ ] **Step 3: Эцсийн бүрэн build (мэдээлэл болгож)**

```bash
cd frontend && npx tsc -b 2>&1 | grep -E 'TeamIcon|TeamTabsStrip|TeamDetailPage' || echo CLEAN
```
Expected: `CLEAN`. Бусад файлын алдаа гарвал — өөр агентын WIP, бүү засварла, хэрэглэгчид мэдэгд.
