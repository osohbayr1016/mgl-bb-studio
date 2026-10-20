# §07 · Frontend архитектур

Vite + React 19 + TanStack Query + React Router v7. Entry нь `frontend/src/app/main.tsx` (CLAUDE.md «main.tsx» гэдэг ч бодит нь `app/` дор), routing нь `app/routes.tsx`, provider stack нь `app/providers.tsx`.

## ⚠️ Бүх page LAZY — тэгээд байлга

Бүх page chunk `React.lazy`-аар ачаалагдана. `vite.config.ts`-ийн manual chunking + `main.tsx`-ийн lazy boundary нь Cloudflare Pages-ийн per-asset upload лимитээс доогуур байхын гол механизм. Шинэ хүнд dep (maplibre, recharts, exceljs, motion) тусдаа chunk-д хуваа.

## Routing tree

| Хэсэг | Жишээ route | Хамгаалалт |
|-------|-------------|------------|
| Нийтийн | `/` · `/work/:id` · `/q/:token` · `/login` | Auth үгүй |
| Print | `/reports/project/:id/print` · `/quotes/:id/print` · `/meetings/:id/print` | `?t=<jwt>` |
| Client | `/client` | зөвхөн `client` role |
| Staff апп | `/app/*` (`<Layout>` дотор) | `ProtectedRoute` |
| Full-viewport | `/app/admin/landing` · `/app/tv` · editor-ууд | Protected, гэхдээ Layout-аас гадуур |

`ProtectedRoute` нь client/staff-ыг тусгаарлана: client-ийг `/client` дотор хааж, staff-ыг гаднаа байлгана. **Staff route-ыг `/client` дор бүү нэм.** Хуучин URL (`/projects`, `/teams/3`) нь `/app/*` руу `<Navigate replace>`-ээр redirect.

## Давхаргууд

- `features/` — ~23 домэйн фолдер (approvals, attendance, projects, qto, quotes, meeting-notes...). Тус бүр page + component + lib + types.
- `shared/` — `api/` (`apiFetch`, `ApiError`, `useApi`, `queryClient`), `components/` (Layout, sidebar, NotificationBell...), `context/` (Auth, Theme), `i18n/`, `lib/`, `hooks/`.
- `ui/` — shadcn (new-york) primitive-ууд (button, card, dialog, table...).

## Нэлээд чухал

- **API давхарга** — `apiFetch<T>(endpoint, opts)`, host нь `VITE_API_HOST`. TanStack default: `staleTime 30s`, `refetchOnWindowFocus: true`, **4xx `ApiError` дээр retry үгүй**. Токен `localStorage.auth_token` + cookie (`credentials: 'include'`) хоёул.
- **i18n** — `en.json` / `mn.json` хоёр flat dict + `LanguageProvider`; `mn` default. Шинэ string-ийг **хоёуланд** нэм.
- **Theme** — `ThemeContext` зөвхөн dark/light/system (`localStorage.theme`). Хуучин per-user accent (`users.accent_color`) устсан.
- **Статус өнгө нэг эх сурвалж** — `shared/lib/status-colors.ts` + `index.css`-ийн `--success/--warning/--info/--danger`. Түүхий palette class бүү сэргээ. `*_HEX` map нь canvas/SVG/PDF-д (CSS var тэнд resolve хийгддэггүй).
- **team-reports дисциплин систем** — `features/projects/team-reports/` дор багийн код бүрд (`ba/bb/has/tsah/au/hd/iz` + `cbu`=TSBU) `<Code>Panel.tsx` (асуулга) + `<Code>Document.tsx` (print) + `template.ts`. `norm/` ба `project-sections/` нь төслийн түвшний (баг биш).
- **COOP/COEP** — `web-ifc` устсан ч header-ууд **үлдсэн**: email OAuth popup + APS viewer нь cross-origin-isolated origin дээр бичигдсэн. `vite.config.ts` ↔ `public/_headers` толь адил байлга.
