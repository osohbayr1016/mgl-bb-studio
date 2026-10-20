# Дизайн: Төслийн интерактив Forecast график

**Огноо:** 2026-06-11
**Хамрах хүрээ:** Frontend (`frontend/src/features/projects/components/ProjectChartsTab.tsx` + туслах файлууд). Backend өөрчлөлтгүй.
**Статус:** Брэйнсторм батлагдсан, хэрэгжүүлэлтийн plan хүлээгдэж байна.

---

## 1. Зорилго ба үзэгч

Төслийн дэлгэрэнгүйн «Графикууд» tab дээрх график нь **удирдлагад** дараах нэг асуултад нэг харахад хариулна:

> **«Энэ төсөл хугацаандаа дуусах уу? Үгүй бол хэзээ дуусах вэ, яавал хугацаандаа дуусах вэ?»**

Одоогийн TradingView-style candle + trading индикаторууд (SMA, regression channel г.м.) нь монотон явцын өгөгдөлд бодит утга үүсгэдэггүй тул удирдлагад «хог». Тэдгээрийг **forecast (урьдчилан таамаглал) хэрэгслээр** солино.

## 2. Брэйнстормоор гарсан шийдвэрүүд

- **Candle хэвээр үлдэнэ** — суурь давхарга болгон.
- **Forecast тооцоо client-side** — одоо байгаа `ProjectChartsTimeseries` payload-аас бүгд гарна, **backend өөрчлөлтгүй** (зөвхөн frontend deploy).
- **Хүний тоо (N) слайдераар гараар** удирдана — тогтмол дээд хязгааргүй (default муж 1–50).
- 3 чадварыг бүгдийг хийнэ: (#1) forecast overlay, (#2) чирдэг scenario cursor, (#3) хүний тоо слайдер.
- «Бүх хүн → хурд шугаман өснө» нь **бүдүүн тооцоо** (Brooks's law) — UI дээр «ойролцоо» гэж тэмдэглэнэ.

## 3. Forecast загвар (математик)

Бүх тооцоо `frontend/src/features/projects/lib/forecast.ts` дотор **цэвэр функцээр** (side-effect-гүй, тусдаа ойлгогдоно).

Тэмдэглэгээ:
- `P` — одоогийн явц % (`overall`-ийн сүүлийн цэг).
- `remaining = 100 − P`.
- `avgGain` — **ажлын өдрийн** дундаж өдрийн өсөлт (цонхны сонгосон range-аар; weekend/баяр болон synthetic baseline бар-ыг хасна — одоо байгаа `buildCandles`-ийн `avgGain` логиктой нэг эх сурвалж).
- `currentPeople` — сүүлийн ~14 хоногийн `headcount`-ийн (0-оос их өдрүүдийн) дундаж; `0` бол `1`.
- `perPersonGain = avgGain / max(currentPeople, 1)`.

Forecast:
```
gain(N)              = perPersonGain × N
daysToFinish(N)      = ceil( remaining / gain(N) )          // ажлын өдрөөр
forecastFinish(N)    = today + daysToFinish(N) ажлын өдөр   // working-day mapping
```
- **Одоогийн хурд** = `forecastFinish(currentPeople)`  (≡ `today + remaining/avgGain`).
- **Scenario(N)** = `forecastFinish(N)` (слайдер N).
- **Зөрүү** = `workingDaysBetween(forecastFinish, deadline)` → хоцрох (+) / эрт (−).

Урвуу (чирдэг cursor нь огноо T дээр):
```
daysAvail   = workingDaysBetween(today, T)          // T > today байх ёстой
requiredGain= remaining / daysAvail                 // хоногт хэдэн %
requiredN   = ceil( requiredGain / perPersonGain )  // хэдэн хүн
```

**Хязгаар тохиолдол:**
| Нөхцөл | Үр дүн |
|---|---|
| `avgGain ≤ 0` (явц зогссон) | Forecast боломжгүй → «Тооцох боломжгүй (явц зогссон)» |
| `currentPeople = 0` | `1` болгож хамгаална |
| `P ≥ 100` | «Дууссан», forecast харуулахгүй |
| `deadline` (schedule.finish) байхгүй | Forecast гарна, зөрүү/deadline босоо шугам нуугдана |
| `forecastFinish` хэт хол | Тэнхлэгийн ирээдүй сунгалтыг дээд хязгаарт (төлөвлөсөн хугацааны 2×) тогтооно |
| cursor `T ≤ today` | Урвуу тооцоо хүчингүй → readout «—» |

## 4. Өгөгдлийн эх сурвалж (одоо байгаа payload-аас)

| Хэрэгцээ | Эх сурвалж |
|---|---|
| `P`, `avgGain`, бодит явцын шугам | `overall: ProgressTimeseriesPoint[]` |
| `deadline` | `schedule.finish_date` |
| `currentPeople` | `headcount: ProjectHeadcountPoint[]` |
| `today` | `to` (payload-ийн сүүлийн огноо) |

Backend-д шинэ талбар нэмэхгүй.

## 5. График давхаргууд (lightweight-charts v5)

Одоогийн `LwProgressChart`-ийг өргөтгөнө (эсвэл `ProjectForecastChart` болгон салгана — §7 үз).

1. **Candle** (хэвээр) — суурь.
2. **Бодит явцын шугам** — `overall`-ийн цэвэр LineSeries; toggle.
3. **Ирээдүйн тэнхлэг сунгалт** — `today → forecastFinish` (capped) хооронд **whitespace** цэгүүд (`{ time }`) candle series-д нэмж тэнхлэгийг ирээдүй рүү нээнэ; `timeScale.fixRightEdge` сулруулна.
4. **Forecast шугамууд** (ирээдүй, тасархай LineSeries, `autoscaleInfoProvider: () => null`):
   - **Одоогийн хурд**: `(today, P) → (forecastFinish(currentPeople), 100)` — өнгө A.
   - **Scenario(N)**: `(today, P) → (forecastFinish(N), 100)` — өнгө B, слайдераар амьд.
5. **Босоо маркууд** — custom primitive (§6): Өнөөдөр · Deadline · Forecast-дуусах.
6. **Чирдэг cursor** — custom interactive primitive (§6).

## 6. Custom primitive-үүд (хамгийн хүнд хэсэг)

lightweight-charts-д vertical line / drawing tool **native байхгүй** тул `ISeriesPrimitive` (эсвэл `IPanePrimitive`)-ээр өөрсдөө хийнэ. Community «VertLine» primitive жишээг суурь болгоно.

- **`VertLinePrimitive`** (статик) — өгсөн `time`-д босоо шугам зурна (өнгө/label-тай). Өнөөдөр/Deadline/Forecast-д ашиглана.
- **`DraggableCursorPrimitive`** (#2) — босоо шугам + canvas hit-test + pointer drag. Чирэхэд `onMove(time)` callback дуудаж, React тал урвуу тооцоог (requiredN/requiredGain) readout-д шинэчилнэ. Чирэлт нь chart-ийн өөрийн scroll/scale-тэй мөргөлдөхгүй байх (drag эхлэхэд `handleScroll` түр унтраах).

> **Эрсдэл/тэмдэглэл:** Drag primitive нь энэ дизайны хамгийн өндөр эрсдэл/ажилтай хэсэг. Үе шат C-д тусд нь хийж, A/B-г эхэлж баталгаажуулна (§8).

## 7. Компонент / файл бүтэц

| Файл | Үүрэг |
|---|---|
| `frontend/src/features/projects/lib/forecast.ts` | **Шинэ.** Цэвэр forecast математик (§3): `computeForecast`, `forecastFinish(N)`, `requiredResource(T)`, working-day helpers. |
| `frontend/src/features/projects/components/chart/VertLinePrimitive.ts` | **Шинэ.** Статик босоо шугам primitive. |
| `frontend/src/features/projects/components/chart/DraggableCursorPrimitive.ts` | **Шинэ.** Чирдэг cursor primitive (#2, үе шат C). |
| `frontend/src/features/projects/components/ForecastControls.tsx` | **Шинэ.** Слайдер + scenario toggle + readout карт (#3 + readout). |
| `frontend/src/features/projects/components/ProjectChartsTab.tsx` | **Засвар.** Forecast давхарга/whitespace/primitive-үүдийг `LwProgressChart`-д залгана; `ForecastControls`-ийг `OverallProgressCard`-д нэмнэ. |
| `frontend/src/shared/i18n/{mn,en}.json` | **Засвар.** `projectChartsTab.fc*` түлхүүрүүд (хоёуланд). |

`LwProgressChart` хэт том болж байвал forecast-ийн логикийг `useForecastChart` hook эсвэл `ProjectForecastChart` дэд компонент болгон салгана (одоогийн файл аль хэдийн ~1500 мөр — салгах нь зүйтэй).

## 8. Хэрэгжүүлэлтийн үе шат

- **Үе шат A — Forecast overlay (#1):** `forecast.ts` + бодит явцын шугам + 2 forecast шугам (Одоогийн хурд, default N) + whitespace ирээдүй сунгалт + статик `VertLinePrimitive` (Өнөөдөр/Deadline/Forecast) + readout карт. *Энд удирдлагын гол асуулт аль хэдийн хариулагдана.*
- **Үе шат B — Хүний тоо слайдер (#3):** `ForecastControls`-ийн слайдер N-ийг scenario forecast шугам + readout-той амьд холбоно.
- **Үе шат C — Чирдэг cursor (#2):** `DraggableCursorPrimitive` + урвуу тооцоо («T-д дуусахын тулд N хүн / X%/өдөр»).

Үе шат бүр build + lint + adversarial review (өмнөх график засваруудтай ижил) дамжина.

## 9. UI / харагдац

- Графикийн дээр **toggle chip мөр** (одоогийн индикатор chip хэв маягтай): Бодит явц · Одоогийн хурд · Scenario · Cursor.
- Доор нь жижиг **readout карт**: Одоогийн явц % · Deadline · Одоогийн хурд→огноо (зөрүү, ногоон/улаан) · Scenario(N)→огноо · Cursor→шаардлагатай нөөц.
- **Хүний тоо слайдер**: N (1–50), label «N хүн». Default = `currentPeople` (≥1).
- Forecast шугам/огноонд **«ойролцоо»** тэмдэг (Brooks's law caveat).
- Өнгө: Одоогийн хурд / Scenario / Cursor бүр ялгаатай; deadline босоо = улаан, forecast босоо = өнгө A, өнөөдөр = саарал.

## 10. Хязгаарлалт ба non-goal

- **Тест байхгүй** (repo-д test suite байхгүй) — `forecast.ts`-ийг цэвэр функц болгож гараар/console-оор шалгана; adversarial review workflow-аар баталгаажуулна.
- Forecast нь **шугаман экстраполяци** — урт хугацааны нарийвчлал баталгаагүй; «ойролцоо» гэж тэмдэглэнэ.
- Гар зурлагын бусад хэрэгсэл (Fib/Gann/trend line drawing) **нэмэхгүй** — өгөгдөлд таарахгүй (өмнө тохиролцсон).
- Backend/migration **өөрчлөлтгүй** — зөвхөн frontend deploy.

## 11. i18n түлхүүрүүд (mn + en хоёуланд)

`projectChartsTab.fcActual`, `fcCurrentPace`, `fcScenario`, `fcCursor`, `fcPeople`, `fcForecastFinish`, `fcDeadline`, `fcToday`, `fcVarianceLate`, `fcVarianceEarly`, `fcRequired`, `fcApprox`, `fcNoForecast`, `fcDone`.
