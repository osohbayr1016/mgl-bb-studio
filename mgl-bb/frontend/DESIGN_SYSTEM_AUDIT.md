# Design System Audit — MGL frontend

**Огноо:** 2026-06-08 · **Хамрах хүрээ:** `frontend/src` (170 `.tsx`, 28 ui primitive) · Tailwind v4 + shadcn (new-york) + CSS variable theming

---

## Summary

**Components reviewed:** 28 ui primitives + 19 feature модуль | **Issues found:** 7 | **Score: 72 / 100**

Token-ийн суурь хүчтэй (semantic HSL token, brand палитр, chart/sidebar/shadow token, light/dark + accent_color theming). Гол асуудал нь **token-уудыг тууштай хэрэглээгүй**: маркетинг бус апп хэсэгт raw Tailwind палитрын өнгө (`text-slate-100`, `bg-blue-600`) маш олон газар шууд бичигдсэн нь light/dark болон хэрэглэгчийн accent өнгөнд дасан зохицдоггүй. Баримтжуулалт огт алга.

---

## Token Coverage

| Category | Defined (token) | Hardcoded / off-token олдсон |
|---|---|---|
| Colors (semantic) | 25+ semantic HSL token (`--primary`, `--muted`, `--card`, sidebar, chart-1..5, brand-*) | **1,984** raw палитр класс (`bg-slate-…`, `text-blue-…`); **233** hardcoded hex `.tsx`-д; зөвхөн **4** arbitrary `-[#hex]` (энэ нь сайн) |
| Status colors | **0** (success/warning/info/danger token алга) | on_time/late/absent/… статусын өнгө 3+ файлд hex-ээр давхардаж, утга нь зөрүүтэй |
| Spacing | Tailwind үндсэн scale | **180** arbitrary `p-[12px]`/`gap-[…]` маягийн scale-аас гарсан утга |
| Typography | 4 фонт token (`Inter`, `Manrope`, `Cormorant`, `Space Grotesk`) — index.html-д зөв ачаалсан | Цэвэрхэн — фонт зөрчил алга |
| Radius / Shadow / Motion | `--radius`, `--shadow-apple`, accordion/shake animation | Цэвэр |
| Inline `style={{}}` | — | **169** удаа (зарим нь динамик chart/width-д зөв, гэхдээ ихэнх нь TV/client dashboard-д) |

**Гол эрсдэл:** өнгөний ~31% (1984 / (1984+4372)) semantic token-ийг тойрч raw палитр хэрэглэж байна. Энэ нь light горимд эсвэл accent_color солихд **dark-on-dark / зөрүүтэй өнгө** үүсгэх эх үүсвэр.

Хамгийн их зөрчилтэй файлууд: `DashboardPage.tsx` (191), `AttendanceAdminPage.tsx` (182), `AdminProjectSetupPage.tsx` (92), `ProjectDetailPage.tsx` (91).

---

## Naming Consistency

| Issue | Components | Recommendation |
|---|---|---|
| ui/ дотор нэршил холимог | 27 kebab-case (`button.tsx`, `apple-card.tsx`) + 1 PascalCase `PolishableTextarea.tsx` | shadcn конвенцоор бүгдийг kebab-case болгох: `polishable-textarea.tsx` |
| Статусын өнгөний нэр стандартгүй | `on_time`/`late`/`absent` (DailyReport) vs баг кодын өнгө (Dashboard) | Нэг `--color-status-*` багц token гаргаж бүгдийг түүн рүү заах |

---

## Component Completeness (түүвэр)

| Component | States | Variants | Sizes | Docs | Score |
|---|---|---|---|---|---|
| Button | ✅ hover/focus-visible/disabled/aria-invalid | ✅ 6 (default…link) | ✅ 8 | ❌ | 9/10 |
| Badge | ⚠️ focus/invalid (disabled алга — span) | ✅ 6 | — | ❌ | 8/10 |
| Input | ✅ focus/disabled/invalid | — | ⚠️ size variant алга | ❌ | 7/10 |
| (бусад 25 primitive) | ихэвчлэн shadcn чанартай | — | — | ❌ бүгд | — |

Primitive-ууд өндөр чанартай (CVA variant, semantic token, `focus-visible` ring, `aria-invalid`, `data-slot`). Гол дутагдал — **баримтжуулалт огт байхгүй** (Storybook / stories / mdx алга).

---

## Maintainability — token scope давхардал

`index.css`-д бүтэн token багц **4 удаа** давтагдсан (`:root`, `.dark`, `.light`, `html.dark .client-dashboard-root`). Аль хэдийн drift үүссэн — ж: `--muted-foreground` нь `.light`-д `215 16% 35%`, client-dashboard scope-д `0 0% 30%`. Шинэ token нэмэх бүрт 4 газар засах шаардлагатай → алдааны эрсдэл.

---

## Priority Actions

1. **Status/semantic өнгөний token гаргах** (`--color-success/warning/info/danger` + `--color-status-on-time/late/absent/leave`). Дараа нь 233 hardcoded hex болон давхардсан статусын массивыг түүн рүү шилжүүлэх. → Хамгийн өндөр нөлөө, drift-ийг таслана.
2. **Raw палитр → semantic token migration** (эхлээд хамгийн зөрчилтэй 4 файл). `text-slate-100`→`text-foreground`, `bg-blue-600`→`bg-primary` гэх мэт. → light/dark + accent theming жинхэнэ ажиллана.
3. **Primitive-уудыг баримтжуулах** (Storybook эсвэл энгийн MDX). Эхлээд хамгийн их ашиглагддаг 8: Button, Input, Badge, Card, Dialog, Select, Table, Tabs.
4. **Token scope давхардлыг багасгах** — нийтлэг утгуудыг `:root`-д үлдээж, scope-ууд зөвхөн ялгаатайг нь override хийдэг болгох.
5. **Нэршил цэгцлэх** — `PolishableTextarea.tsx`→kebab-case; eslint дүрмээр шинэ ui файлд таниулах.
6. **Arbitrary spacing & inline style цэгцлэх** — `p-[12px]` маягийн 180 утгыг scale рүү, динамик бус inline style-уудыг класс рүү.

---

## Дараагийн алхам (сонголт)

- `/design-system document Button` — primitive нэг бүрийг энэ форматаар баримтжуулах
- Token migration-ийг автоматжуулах codemod бичих (raw палитр → semantic)
- `--color-status-*` token-ийг index.css-д нэмж, эхний migration хийх

*Тоон үзүүлэлтүүд: `grep` скан (`frontend/src`, node_modules хасав), 2026-06-08.*
