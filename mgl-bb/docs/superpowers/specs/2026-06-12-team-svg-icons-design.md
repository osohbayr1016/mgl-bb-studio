# Багийн SVG icon систем — дизайн

**Огноо:** 2026-06-12
**Хамрах файл:** `frontend/src/shared/components/TeamIcon.tsx` (шинэ), `frontend/src/shared/components/TeamTabsStrip.tsx`, `frontend/src/features/teams/TeamDetailPage.tsx`.

## 1. Зорилго

Баг (discipline) бүрд мэргэжлийн онцлогийг илэрхийлсэн SVG icon өгч, баг гарч ирдэг газруудад кодын хажууд харуулах. Одоо багууд зөвхөн өнгөт код (`BA`, `TSAH`, …)-оор ялгардаг — icon нэмснээр өнгө + дүрс хосолж, уншихгүйгээр таних боломж нэмэгдэнэ.

## 2. Бус-зорилго (Non-goals)

- Статик `.svg` asset файл үүсгэхгүй — бүгд inline React компонент (`currentColor` ажиллуулахын тулд).
- Dashboard, approvals, attendance, print гэх мэт бусад surface-ийг энэ удаад шинэчлэхгүй — TeamChip-ээр дамжиж автоматаар гарч ирэхээс бусдыг дараагийн ажил болгоно.
- DB, backend, i18n өөрчлөлт байхгүй.
- Шинэ dependency нэмэхгүй.

## 3. Icon-уудын утга санаа

Бүгд lucide хэв маяг: `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth={2}`, `strokeLinecap="round"`, `strokeLinejoin="round"`. Өнгийг icon өөрөө тогтоохгүй — эцэг элементийн text color (ихэвчлэн `teamTone(code)`-оос) дагана.

| Код | Баг | Дүрс (метафор) |
|---|---|---|
| BA | Барилга архитектур | Барилгын фасад — контур + цонхнууд |
| BB | Барилга бүтээц | Багана-дам нуруу + диагональ бэхэлгээ (frame/truss) |
| HAS | Халаалт агаар сэлгэлт | Сэнс (fan) |
| TSBU | Цэвэр бохир ус | Дусал + хоолойн өвдөг (elbow) |
| TSAH | Цахилгаан | Аянгын оч (bolt) |
| HD | Холбоо дохиолол | Антен + долгионы нумууд |
| AU | Автомат удирдлага | Чип/CPU — дөрвөлжин + хөлүүд |
| EZ | Эскиз зураг | Харандаа зураас татаж буй |
| IZ | Интерьер зураг | Сандал/sofa |
| GT | Гадна тохижилт | Мод |
| MGMT | Менежмент | Цүнх (briefcase) |
| *(үл мэдэх)* | fallback | Хүмүүс (users) дүрс |

## 4. Компонент

Шинэ файл `frontend/src/shared/components/TeamIcon.tsx`:

```tsx
export function TeamIcon({
  code,
  size = 16,
  className,
}: {
  code?: string | null;
  size?: number;
  className?: string;
}): JSX.Element;
```

- Дотроо `Record<string, ReactNode>` — баг бүрийн 24×24 path-ууд.
- Код нь `toUpperCase()`-ээр normalize хийгдэнэ (`teamTone`-той ижил зарчим).
- Үл мэдэх/`null`/хоосон код → fallback (users) icon, хэзээ ч throw хийхгүй.
- `aria-hidden="true"` — багийн нэр/код хажууд нь текстээр байдаг тул дэлгэц уншигчид давхардуулахгүй.

## 5. Интеграцийн цэгүүд

1. **`TeamChip`** (`TeamTabsStrip.tsx`) — Badge доторх кодны өмнө `size={12}` icon. TeamChip нь Тайлан, Тэмдэглэл, block filter, approvals queue, admin setup, client dashboard, чатын thread strip гээд бүх газар хэрэглэгддэг тул энэ нэг өөрчлөлт апп даяар тарна. Icon нь Badge-ийн text color (`teamChipClass`)-ийг өвлөнө.
2. **Багийн дэлгэрэнгүй хуудас** (`TeamDetailPage.tsx`) — толгойн хэсэгт багийн нэрийн хажууд том (`size={28}`) icon, `teamTone(code).text` өнгөөр.

## 6. Алдааны зохицуулалт

- Бүртгэлгүй team code (шинээр үүсгэсэн баг) → slate fallback icon; UI эвдрэхгүй, console warning ч хэрэггүй (одоогийн `teamTone` FALLBACK-тай ижил зан төлөв).
- `size` нь зөвхөн width/height attribute — layout-д нөлөөлөхгүй (flex-shrink-0 хэрэглэгч талд).

## 7. Шалгалт

Repo-д тест suite байхгүй тул:

- `npm run build` (tsc -b + vite) — type алдаагүй.
- `npm run lint` — eslint цэвэр.
- Dev сервер дээр нүдээр: TeamTabsStrip гардаг 2–3 хуудас (Тайлан, approvals, багийн хуудас) + TeamDetailPage толгой, light/dark хоёр горимд.
