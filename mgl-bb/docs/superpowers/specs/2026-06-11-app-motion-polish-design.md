# Ажилчдын app — Motion polish (animation/hover micro-interaction систем)

**Огноо:** 2026-06-11
**Хамрах хүрээ:** Operational app (`/app/*`) — ажилчдын ашигладаг, функц ихтэй тал. Public marketing site (landing) энэ ажилд **хамаарахгүй**.

---

## 1. Зорилго

Operational app даяар **жигд, дахин ашиглагдах motion систем** нэвтрүүлж, интерфэйсийг "амьд" мэдрэгдүүлэх. Одоогийн motion language нь Apple-Health маягийн нам гүм (Tailwind + `tailwindcss-animate` + Radix data-state, 200–700ms ease-out). Энэ ажил түүн дээр **зориудаар илүү тод, амьд** давхарга нэмнэ: spring physics, hover-lift, count-up, stagger reveal, layout animation, celebration.

### Баталгаажсан шийдвэрүүд (brainstorming-аас)
| Асуулт | Сонголт |
|--------|---------|
| Хамрах хүрээ | **Бүх operational app даяар жигд** (нэг хуудас биш) |
| Эрчим | **Тод, амьд** (spring bounce, spotlight, count-up, celebration, stagger) |
| Технологи | **`motion`** (framer-motion-ийн залгамжлагч) + `LazyMotion` |

---

## 2. Архитектур — Motion foundation давхарга

Бүх motion **нэг эх үүсвэртэй**. Аппын аяыг дараа нэг газраас тааруулна.

### 2.1 Package & bundle
- **`motion`** package суулгана (одоо суугаагүй). `framer-motion`-ийн шинэ нэр; React 19.2 бүрэн дэмждэг.
- Import: `motion/react` (provider/hook), `motion/react-m` (`m` компонент).
- **`LazyMotion features={domAnimation}`** + `m.*` компонент → эхний bundle 34kb-аас **~4.6kb** болж буурна. `domAnimation` нь animation, variants, exit, tap/hover/focus gesture-ийг хангана.
  - `domMax` (layout animation, drag) хэрэгтэй газар (Бүлэг B: leaderboard layout, tab `layoutId`) тусдаа авч үзнэ — эсвэл эхнээс `domMax` (~+15kb) ашиглаж нэг feature set барина. **Шийдвэр:** эхлээд `domAnimation`, layout animation хэрэгтэй болсон Бүлэг B үе шатанд `domMax` руу шилжих эсэхийг тэр үед хэмжинэ.
- CLAUDE.md-ийн lazy-load + per-asset bundle discipline-ийг зөрчихгүй: motion-ийг manual chunk болгож [vite.config.ts](frontend/vite.config.ts)-д тусгаарлахыг шалгана (recharts/maplibre/exceljs-тэй адил).

### 2.2 Provider байршил
- `<LazyMotion features={domAnimation} strict>` + `<MotionConfig reducedMotion="user">`-ийг [providers.tsx](frontend/src/app/providers.tsx)-д `children`-ийг тойруулж байрлуулна (TooltipProvider дотор).
- `strict` flag → `motion.*` (lazy биш) санамсаргүй ашиглавал build-д алдаа өгч, bundle хариуцлагыг хадгална. Бүх компонент `m.*` ашиглах ёстой.

### 2.3 Motion tokens — `frontend/src/shared/lib/motion.ts` (шинэ)
Нэг эх үүсвэрт spring/transition preset:
```ts
export const SPRING = {
  snappy:  { type: 'spring', stiffness: 400, damping: 30 },   // товч, tab
  bouncy:  { type: 'spring', stiffness: 500, damping: 18 },   // celebration, badge
  smooth:  { type: 'spring', stiffness: 250, damping: 32 },   // card, layout
} as const;
export const DURATION = { fast: 0.15, base: 0.2, slow: 0.5 } as const;
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;          // одоогийн аястай нийц
```
Variants-ийн стандарт багц (fade-up, pop-in, stagger container/item) мөн энд экспортлоно.

### 2.4 Reduced-motion (заавал — одоо огт байхгүй accessibility цоорхой)
- `MotionConfig reducedMotion="user"` → OS-ийн `prefers-reduced-motion: reduce` асаалттай үед бүх transform/scale/layout унтарч **зөвхөн opacity** үлдэнэ. Энэ нь WCAG 2.1 (Animation from Interactions) цоорхойг хаана.
- Шинэ CSS keyframe нэмбэл (хэрэв байгаа бол) `@media (prefers-reduced-motion: reduce)` wrapper-тэй байна.

### 2.5 Reusable primitives — `frontend/src/shared/components/motion/` (шинэ)
| Primitive | Үүрэг | Хэрэгжүүлэлт |
|-----------|-------|--------------|
| `<MotionCard>` | hover-lift (y −4px + `shadow-lift`), tap scale 0.97 | `m.div` + `whileHover`/`whileTap`, `SPRING.smooth`. **Opt-in** — `Card`-ийг бүхэлд нь солихгүй; интерактив card-д сонгож ашиглах эсвэл `Card`-д `interactive?: boolean` prop нэмэх. |
| `<AnimatedNumber value>` | тоо 0→утга count-up | `useMotionValue` + `animate` + `useTransform`; reduced-motion үед шууд эцсийн утга. |
| `<Stagger>` / `<StaggerItem>` | жагсаалт/grid дараалсан reveal | variants container `staggerChildren`, эсвэл `whileInView` + IntersectionObserver. |
| `<RevealOnView>` | viewport-д орвол fade-up (нэг удаа) | `whileInView` + `viewport={{ once: true }}`. Одоогийн landing `useReveal`-ийн app-side эквивалент. |
| `<PageTransition>` | route солилт fade + бага slide | `AnimatePresence` + `key={pathname}`, [routes.tsx](frontend/src/app/routes.tsx)-ийн `/app` Outlet-ийг тойруулна. |
| `useSpotlight()` | pointer-tracking radial glow | pointer event → CSS custom property (`--mx/--my`); card дээр radial-gradient. Reduced-motion үед идэвхгүй. |

### 2.6 `shadow-lift` token
- [index.css](frontend/src/index.css)-д `--shadow-lift` нэмнэ — `--shadow-apple`-аас нэг шат өндөр elevation (hover-д). Light/dark хувилбартай, одоогийн `shadow-apple` конвенцтэй адил.

---

## 3. Хаана юу хэрэглэх

### Бүлэг A — Глобал primitive (бүх апп даяар нэг удаа)
"Жигд polish"-ийн гол биелэл. Нэг газар тохируулахад бүх хуудсанд тархана:

1. **Button press feedback** — [button.tsx](frontend/src/ui/button.tsx). Бүх товч `whileTap={{ scale: 0.97 }}`.
   - **Болгоомж:** `asChild` (Slot) тохиолдол. Шийдвэр: `m.button`-ийг үндсэн (non-asChild) замд хэрэглэх; `asChild` үед одоогийн Slot хэвээр (motion-гүй) эсвэл `m.create(Slot)` ашиглах — хэрэгжүүлэх үед тестээр шийднэ. Destructive variant-д press feedback хэвээр (зөвхөн scale, өнгө биш).
2. **Card hover-lift** — `<MotionCard>` primitive. Интерактив card (жагсаалтын мөр, KPI tile, төслийн card) сонгож ашиглана. Статик мэдээллийн card хэвээр.
3. **Page transition** — `<PageTransition>` [routes.tsx](frontend/src/app/routes.tsx)-ийн `/app/*` Outlet-д.
4. **List/grid stagger reveal** — `<Stagger>` гол жагсаалтуудад ([ProjectsPage](frontend/src/features/projects/ProjectsPage.tsx), dashboard жагсаалтууд).

### Бүлэг B — Signature моментууд (хамгийн их үздэг 4 хуудас)
| Хуудас | Момент | Файл |
|--------|--------|------|
| **Dashboard** | KPI тоо count-up (`<AnimatedNumber>`) + card spotlight glow | [CompanyDashboardPage.tsx](frontend/src/features/dashboard/CompanyDashboardPage.tsx) (KpiHero аль хэдийн corner-glow-той) |
| **Leaderboard** | Top-3 rank badge spring bounce + ранк солигдоход `layout` animation | [LeaderboardPage.tsx](frontend/src/features/leaderboard/LeaderboardPage.tsx) |
| **Projects** | Filter дарахад үр дүн stagger reveal | [ProjectsPage.tsx](frontend/src/features/projects/ProjectsPage.tsx) |
| **ProjectDetail** | Team tab indicator slide (`layoutId`) | [ProjectDetailPage.tsx](frontend/src/features/projects/ProjectDetailPage.tsx) |

---

## 4. Хэрэгжүүлэх дараалал

- **Phase 0 — Foundation:** `motion` суулгах, vite manual chunk, `providers.tsx` LazyMotion/MotionConfig, `motion.ts` token, `shadow-lift`, primitive бүрхүүлүүд (`MotionCard`, `AnimatedNumber`, `Stagger`, `RevealOnView`, `PageTransition`, `useSpotlight`). Нэг demo газар утга шалгана.
- **Phase 1 — Бүлэг A (глобал):** button press, card hover-lift, page transition, list stagger. → Энэ үед бүхэл апп нэн даруй "амьд" мэдрэгдэнэ. (Хэрэглэгчийн сонгосон "жигд polish"-ийн гол үр дүн.)
- **Phase 2 — Бүлэг B (signature):** Dashboard → Leaderboard → Projects → ProjectDetail дарааллаар нэг нэгээр. `domMax` (layout) хэрэгтэй эсэхийг энд хэмжинэ.

Phase 0 + Phase 1 нь эхний хэрэгжүүлэлтийн гол цар хүрээ. Phase 2-ийг дараа аажмаар.

---

## 5. Accessibility
- `reducedMotion="user"` → motion-sensitive хэрэглэгчдэд бүх kinetic эффект унтарна (зөвхөн opacity).
- Hover-only эффект (`whileHover`, spotlight) нь touch/keyboard-д саад болохгүй; focus-visible ring одоогийн конвенц хэвээр.
- Count-up нь screen-reader-д эцсийн утгыг шууд өгнө (`aria-label` эсвэл reduced-motion шууд утга).

## 6. Bundle / performance discipline
- `LazyMotion` + `m.*` + `strict` → эхний payload ~4.6kb.
- Motion-ийг [vite.config.ts](frontend/vite.config.ts) manual chunk-д тусгаарлах (recharts/maplibre/exceljs-тэй адил).
- `transform`/`opacity`-д л animate хийнэ (layout-thrash-гүй). Том жагсаалтад stagger-ийг `whileInView once` болгож зөвхөн нэг удаа.
- `ANALYZE=1 npm run build`-аар bundle нөлөөг хэмжинэ.

## 7. Out of scope (YAGNI)
- Public marketing site (landing) — хөндөхгүй.
- Одоогийн `tailwindcss-animate` / Radix data-state animation-ийг дахин бичихгүй — энэ нь дээр нь нэмэгдэнэ.
- Drag-reorder (dnd-kit) одоогийн хэвээр.
- Chart (lightweight-charts) дотоод interaction хэвээр.

## 8. Эрсдэл / нээлттэй асуудал
- **`asChild`/Slot + motion** — button дээр хамгийн нарийн. Хэрэгжүүлэх үед тестээр баталгаажуулна (motion-гүй fallback зам байх).
- **`domAnimation` vs `domMax`** — layout animation (leaderboard, tab) `domMax` шаардана. Эхлээд `domAnimation`, Phase 2-д хэмжинэ.
- **lucide-react ^1.14.0 / tailwind v4 / motion@^12 нийцэл** — суулгасны дараа `tsc -b` + dev smoke-test.
- **Bundle өсөлт** — LazyMotion-аар хязгаарлана; ANALYZE-аар батална.

## 9. Амжилтын шалгуур
1. `motion` + `LazyMotion` суусан, `providers.tsx`-д идэвхтэй, эхний bundle өсөлт <6kb.
2. Бүх товч tap feedback-тэй; интерактив card hover-lift-тэй; хуудас солилт жигд.
3. `prefers-reduced-motion: reduce` үед бүх kinetic эффект унтарч opacity л үлдэнэ.
4. `npm run build` (`tsc -b`) цэвэр; ESLint цэвэр.
5. Бүлэг B-ийн 4 signature момент ажиллана.
