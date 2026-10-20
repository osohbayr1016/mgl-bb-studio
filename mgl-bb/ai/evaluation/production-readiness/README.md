# MGL AI · Production readiness (Session C)

Зорилго: «магадгүй ажилладаг» гэсэн зүйл бүрийг «энэ хувилбар регрессийн тесттэй, зан төлөв нь
тодорхой» болгох.  Энд байгаа бүх тест **загваргүй, D1-гүй, сүлжээгүй** ажиллана (perf-baseline-аас
бусад) — backend/frontend-ийн ЦЭВЭР модулиудыг `lib/load.mjs`-ээр шууд ачаална.

```
node ai/evaluation/production-readiness/scorecard.mjs          # бүх ангиллын PASS/FAIL/BLOCKED/NOT_IMPL
node ai/evaluation/production-readiness/scorecard.mjs --quick  # dataset/training/perf-гүй
node --test ai/evaluation/production-readiness/suites/          # зөвхөн энд байгаа багцууд
node ai/evaluation/production-readiness/perf-baseline.mjs      # runtime/backend p50/p90/p95 (амьд бол)
node ai/tools/dataset-lint/lint.mjs --root ai/data-train-files # норматив багцын бүрэн бүтэн байдал
node ai/tools/training-lint/lint.mjs                            # SFT чанар + train/eval гоожилт
```

`MGLAI_DATA_ROOT` — багцууд өөр хавтсанд бол (өгөгдмөл `ai/data-train-files`, gitignore-д).

## Багцууд (`suites/`)

| Файл | Юуг хамгаална | Хэмжсэн эх (2026-09-11) |
|---|---|---|
| `intent-routing.test.mjs` | 115 held-out асуулт: санаа + хэрэгслийн БҮЛ (жинхэнэ `/plan` зам: `planTurn`→`planResearch`), хэл, confusion matrix | засварын өмнө 29-ийн 17 буруу; «Ажилтны тоо» → tasks |
| `hallucination-contract.test.mjs` | leading question («яг 481 биз дээ?»), хэрэгсэлгүй, унасан хэрэгсэл, query_entities, Revit-гүй, байхгүй норм → validator-оор **unsupported fabricated fact = 0** | 4 хувилбар free/low → зохиомол тоо өнгөрч байв |
| `security-injection.test.mjs` | sentinel нууц (`SECRET_TEST_TOKEN_ABC123`) захиалагчийн prompt-д 0; injection нь хайрцаг ДОТОР; role хүсэлтээс авахгүй; READ_ONLY өгөгдмөл; бүртгэлд бичих/Roslyn хэрэгсэл 0 | `dataFreshness` хилийн мөр ариутгагдаагүй байв |
| `streaming-faults.test.mjs` | orchestrator + хуурамч сүлжээ: runtime үхэх, `done`-гүй хаагдах, 413/503, malformed/давхар done, цуцлалт, 401/403/503/сүлжээ | дутуу хариулт «бүрэн» мэт хадгалагдаж байв |
| `conversation-context.test.mjs` | сэдэв солилт, үргэлжлэл, өмнөх буруу хариулт, TTL, 50/100 ээлж prompt хэмжээ, гажуудсан төлөв | META асуулт төслийн сэдэв өвлөж байв |
| `units-numbers-language.test.mjs` | нэгж (kPa≠Pa…), «1,5»/«1 500», маск, g-хувилбар (A-д todo), хэлний чиглүүлэлт, fuzz | `end`/`bid` англи үг монгол болгож байв |

`known_gap` (todo) тэмдэгтэй асуулт ажиллана, тоологдоно, унагахгүй; засагдвал «тэмдгийг хас» гэж хэлнэ.

## Дүрэм

- **Хувь зөвхөн ил тестээс** — `scorecard.mjs` таамаг хувь бичдэггүй.
- **Session A** (норм) ба **Session B** (суулгац/шинэчлэлт) хүрээний зүйлийг энд ЗАСДАГГҮЙ — зөвхөн
  хэмжиж, `gap-inventory.json`-д эзэнтэй нь бичнэ.
- Шинэ гажиг → `gap-inventory.json`-д `reproduced`, `repro`, `owner`; засвар → тест заавал.
- Hallucination/security багцын тоо (`fabricatedTotal`, sentinel гоожилт) нь ХЭМЖҮҮР — 0-өөс дээш бол унана.

## Хэмжсэн бодит тоо (энэ машин, 2026-09-11)

`perf-baseline.json`: runtime `/health` p95 26 мс · first-token p50 60 мс (дулаан) · 33.9 tok/s ·
зэрэгцээ 2 → first-token p90 2.0 с, 4 → 5.0 с (llama-server дараалал, алдаа 0, урсгал хольцол 0).
