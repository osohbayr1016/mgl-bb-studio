# Дизайн: Forecast scenario-г "хүний тоо" → "%/өдөр"-өөр хөтлөх

**Огноо:** 2026-06-12
**Хамрах хүрээ:** Frontend (`ProjectChartsTab.tsx`, `ForecastControls.tsx`, `forecast.ts`, i18n). Backend өөрчлөлтгүй.
**Статус:** Брэйнсторм батлагдсан, хэрэгжүүлэлтийн plan хүлээгдэж байна.
**Суурь:** [2026-06-11-project-forecast-chart-design.md](2026-06-11-project-forecast-chart-design.md)-ийн §3 (forecast загвар) ба §7 (файл бүтэц)-ийг өөрчилнө.

---

## 1. Зорилго

Одоогийн «Графикууд» tab-ийн forecast scenario нь **хүний тоо (N)** слайдераар хөтлөгддөг:
`gain(N) = perPersonGain × N`. Энэ «хүн → хурд» хөрвүүлэлт нь Brooks's law-д тулгуурласан **бүдүүн таамаг** (суурь spec-д «ойролцоо» гэж тэмдэглэсэн).

Үүний оронд scenario-г **өдрийн гүйцэтгэлийн хувь (%/өдөр)**-өөр шууд хөтлүүлнэ. Удирдлага «өдөрт X% хийвэл хэзээ дуусах вэ?» гэдгийг шууд хардаг болно. Үр дүнд:

- Ягаан **слайдер** (урагшаа: хурд → дуусах огноо) ба
- Шар **чирдэг заагч** (урвуу: огноо → шаардлагатай хурд)

хоёр одоо **ижил нэгжээр (%/өдөр)** ярьж, тэгшхэн хосолно.

## 2. Брэйнстормоор гарсан шийдвэрүүд

- **Бүрэн орлуулах** — «Хүний тоо» слайдерыг хасаж, «%/өдөр» слайдераар солино (зэрэг 2 горим биш).
- **Заагч (cursor) readout зөвхөн %/өдөр** — хүний тоог хасна.
- **Слайдерын муж 0–5%/өдөр, анхны утга = одоогийн бодит хурд** (`avgGain`). Доод хязгаарыг **0.05** болгож, слайдер 0 дээр scenario шугам алга болохоос сэргийлнэ (алхам 0.05).
- «Одоогийн хурд» (cyan) шугам, candle, measure заагч **хэвээр** — зөвхөн scenario-ийн хөтлөгч өөрчлөгдөнө.

## 3. Forecast загвар (өөрчлөлт)

`frontend/src/features/projects/lib/forecast.ts`-д **нэг шинэ цэвэр функц** нэмнэ:

```
forecastFinishFromGain(input, gainPerDay) -> ScenarioForecast
  progress >= 100      -> { done: true, ... }
  gainPerDay <= 0      -> { finishDate: null, ... }       // тооцох боломжгүй
  remaining = 100 - progress
  days       = ceil(remaining / gainPerDay)               // ажлын өдрөөр
  finishDate = addWorkingDays(today, days)
  varianceDays = deadline ? workingDaysBetween(deadline, finishDate) : null
```

`forecastFinish(input, n)` (хүн), `perPersonGain`, `recentAvgHeadcount`, `requiredResource`
**хэвээр үлдэнэ** — «Одоогийн хурд» шугам `forecastFinish(input, currentPeople)`-ийг хэрэглэсээр,
заагч `requiredResource(...).requiredGain`-ийг (хүнгүйгээр) хэрэглэнэ. forecast.ts-ийн
interface-үүд (`ScenarioForecast`, `RequiredResource`) **өөрчлөгдөхгүй**.

## 4. UI / компонентийн өөрчлөлт

| Файл | Өөрчлөлт |
|---|---|
| `forecast.ts` | **Нэмэх:** `forecastFinishFromGain`. Бусад нь хэвээр. |
| `ForecastControls.tsx` | `HeadcountSlider` → `PaceSlider` (`min=0.05, max=5, step=0.05`; label «Өдрийн хурд»; утга `2.00%/өдөр`). |
| `ProjectChartsTab.tsx` | `scenarioN` → `scenarioGain` (default = `avgGain`, 0.05-д snap, [0.05, 5] clamp). `scenarioFinish` → `forecastFinishFromGain`. Scenario row болон заагч row-ийн текстийг %/өдөр болгоно. Slider render-ийг `PaceSlider` болгоно. |
| `mn.json` + `en.json` | **Нэмэх:** `fcPaceLabel`, `fcPaceValue`. **Засвар:** `fcRequired` (хүн хасна). **Устгах:** `fcPeopleLabel`. `fcPeople` хэвээр (`hcToday` хэрэглэдэг). |

## 5. i18n түлхүүрүүд (mn + en хоёуланд)

- `fcPaceLabel`: «Өдрийн хурд» / «Daily pace»
- `fcPaceValue`: «{gain}%/өдөр» / «{gain}%/day»
- `fcRequired` (засвар): «{date}-д дуусгахад: {gain}%/өдөр» / «To finish by {date}: {gain}%/day»
- `fcPeopleLabel` устгана (хоёуланд).

## 6. Хязгаар тохиолдол

| Нөхцөл | Үр дүн |
|---|---|
| `scenarioGain <= 0` | Scenario шугам/row нуугдана (слайдер min=0.05 тул бараг тохиолдохгүй) |
| `progress >= 100` | «Дууссан» (`done`) |
| `avgGain = 0` (зогссон) | Default scenarioGain = 0.05-д унана; «Одоогийн хурд» шугам аль хэдийн «Тооцох боломжгүй» гэж харуулна |
| `deadline` байхгүй | Scenario гарна, зөрүү/босоо шугам нуугдана (хэвээрх зан төлөв) |

## 7. Батлах гарц ба хязгаарлалт

- **Тест байхгүй** (repo-д test suite байхгүй): `npm run build` (tsc -b) + `npx eslint <changed files>` + browser шалгалт + adversarial review.
- `forecastFinishFromGain` нь цэвэр функц — `// EXPECT:` тайлбараар гараар шалгана.
- **Backend deploy / migration байхгүй** — зөвхөн frontend dist deploy.
- Forecast нь шугаман экстраполяци хэвээр — «ойролцоо» тэмдэг хэвээр.
