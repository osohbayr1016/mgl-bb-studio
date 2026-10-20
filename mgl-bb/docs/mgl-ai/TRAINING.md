# MGL AI — Сургалт (QLoRA) — 0.6 «анхны хяналттай Qwen3-8B fine-tune»

> Энэ баримт нь `ai/training/` ба `ai/evaluation/`-ийн **бодит** урсгалыг тайлбарлана.
> Тоо бүр хэмжсэн файлаас (reports/, benchmarks/, baselines/); хэмжээгүй тоо энд байхгүй.

## 1. Зарчим (§41)

Runtime нь үнэнийг хянадаг (trusted-fact contract `tfc-1`, нормын шийдвэр, хэрэгслийн хайрцаг).
Fine-tune нь **монгол хэл · зааврын дагалт · итгэмжлэгдсэн үр дүнд захирагдах · эшлэлийн зан
төлөв · ярианы зан төлөв · хэв маяг**-ийг сайжруулна; эрх бүхий баримтын эх сурвалж **болохгүй**.
Динамик тоо (ажилтан, төсөл, deadline), бодит нормын код, бодит нэр жинд орохгүй — угсрагч
тэдгээрийг seed-тэй санамсаргүй болгодог, `dataset_lint.py` барина.

## 2. Суурь = serving суурь

| | |
|---|---|
| Suurь | `Qwen/Qwen3-8B` @ `b968826d9c46dd6066d109eabc6255188de91218` (Apache-2.0) |
| Serving артефакт | `unsloth/Qwen3-8B-GGUF` @ `a6adef13…` → `Qwen3-8B-Q4_K_M.gguf`, sha256 `120307ba…` (локал файл = HF LFS) |
| Registry | `ai/registry/models.json` → `employee-8b-q4`; лиценз `ai/registry/LICENSES.md` §2a |

**4B руу шилжихгүй.** `train_lora.py` нь `--base-model` registry-ийн serving суурьтай зөрвөл зогсоно
(`--allow-base-mismatch` зөвхөн туршилтад, тэмдэглэгээтэй). Санах ойн асуудлыг дараалал/зорилтот
модуль/offload-оор шийднэ, суурь солих замаар биш.

Лицензийн гурван түвшин **холихгүй**: `license_detected` + `license_metadata_complete` (баримт — smoke-д
хангалттай, readiness P1) ба `license_cleared` (ЭЗНИЙ шийдвэр — ТҮГЭЭЛТИЙН хаалга, readiness R1).

## 3. Урсгал

```
npm run ai:build:sft          # training/out/behavior-sft-{train,val,test}.jsonl + manifest (serving-v2)
npm run ai:eval:conv -- --gen # алтан A–O, бодит Qwen — identity бүхий тайлан
npm run ai:eval:heldout       # өргөн held-out (38 кейс), raw/final тусдаа
npm run ai:baseline:freeze -- --gen <conv file> --heldout <heldout file>   # evaluation/baselines/base-…json
npm run ai:train:readiness    # SMOKE / RELEASE хаалга
npm run ai:stop && npm run ai:train:probe   # 8B QLoRA санах ойн ХЭМЖИЛТ (llama-server зогссон байх ёстой)
.venv python train_lora.py --dataset behavior --run-name mgl-adapter-0.1-smoke --max-seq-len <хэмжсэн> --reason "…"
.venv python export_adapter.py --run mgl-adapter-0.1-smoke        # GGUF LoRA (llama.cpp b10850 хөрвүүлэгч)
MGLAI_PORT=39227 MGLAI_ENGINE_PORT=39228 MGLAI_DATA_DIR=<хуулбар> MGLAI_MODEL_PATH=<gguf> MGLAI_LORA_PATH=<lora.gguf> node runtime/src/server.ts
npm run ai:eval:heldout -- --rt http://127.0.0.1:39227 --label candidate:mgl-adapter-0.1-smoke
npm run ai:compare -- --candidate mgl-adapter-0.1-smoke --base-heldout <ref> --cand-heldout <file> [--base-conv … --cand-conv …]
```

## 4. Readiness хаалга (2026-09-10 өөрчлөлт)

- **Хасагдсан:** «нийт жишээ ≥ 500». Тоо нь чанарын орлуулагч биш; 500 хүрэхийн тулд утгагүй хувилбар
  үүсгэх нь багцыг муутгана. 500 нь **RELEASE R2 зөвлөмж** хэвээр (үйлдвэрлэлийн адаптерт).
- **Оронд нь:** S1 кернелийн snapshot = одоогийн систем заавар (sys-4 багцаар sys-5 системд сургахгүй) ·
  S2/S3 хамралт · S4 чухал зан төлөв бүрд доод тоо (train дээр: norm-refusal, historical, permission-denied,
  revit-write-denied, trusted-count, category-discipline, concise, structured-long, …) · S5 гэрээгээр
  шалгасан зорилт · S6 хэв маягийн lint · S7 динамик баримт/бодит нэр/код 0 · S8 давхардал (файлаас
  дахин) · S9 тусгаарлалт (train∩val/test = ∅, алтан+held-out → test) · S10 serving-v2 формат мөр бүр ·
  S11 хэлний тэнцвэр · S12 дарааллын урт (tokenizer-оор, `reports/token-lengths.json`).
- **Засагдсан:** E2/E4 нь хатуу бичсэн sys-4 тайлангаас (case J-ийн гогцоо) уншдаг байсан — одоо
  `identity.system_prompt_version` таарсан тайлан эсвэл хөлдөөсөн суурийн `outputs` л тоологдоно.
  Хуучин тайлангууд файлаараа үлдэнэ (түүхэн харьцуулалт).
- **Таамаг хасагдсан:** «8B QLoRA-д ≥12 GB» → H4 нь `memory_probe.py`-ийн хэмжсэн дүгнэлт
  (FITS_STABLY / FITS_WITH_OFFLOAD_OR_REDUCED_SEQ / DOES_NOT_FIT_CURRENT_STACK).

## 5. Давталтын хэмжүүр (§11)

`evaluation/lib/repetition.mjs`: 4-грамын хувь **мэдээлэл, хаалга биш** (хууль ёсны хэллэг урт
техникийн хариултад давтагддаг). Хаалга = `severe`: ижил өгүүлбэр ≥2 · ижил догол ≥1 · ≥8 үгийн залгаа
давтагдсан блок · гогцоо суффикс · зэргэлдээ хувилбар (Jaccard ≥ .8) ≥2 · ≥6 үгийн цонх ≥3×.
Хэмжсэн: sys-4 J гогцоо ✓ баригдана, sys-5 J (4-грам 25%, цонх 2×) ✗ баригдахгүй, БД-ийн хүснэгтийн
хууль ёсны давталт ✗ баригдахгүй. Кейс бүр `.cases.md`-д бүтнээрээ.

## 6. Суурь vs нэр дэвшигч (§31–34)

`compare-candidate.mjs`: ТҮҮХИЙ (загвар өөрөө) ба ЭЦСИЙН (гэрээний дараа) тусдаа; ангилал бүрээр;
аюулгүй байдлын регресс = суурь дээр тэнцсэн аюулгүй байдлын шалгалт нэр дэвшигч дээр унасан (эцсийн);
гамшигт = давталт/хэл/тэнцэлт эрс муудсан. Дүгнэлт `CANDIDATE_APPROVED_FOR_REVIEW` /
`CANDIDATE_NO_MEASURABLE_GAIN` / `CANDIDATE_REJECTED` — **deploy хийхгүй**, эзэн шийднэ.
Сохор үнэлгээний хувь `…blind-review.md` (A/B seed-тэй санамсаргүй; түлхүүр тусдаа файлд).

## 7. 0.2 давталт — ХАРИУЛТЫН ГҮН ба утгын тайралт (2026-09-10)

**0.1-ийн сургамж:** багцын assistant зорилт дунджаар 48 токен байсан тул адаптер «үргэлж богино»
гэж сурсан (дундаж 233 → 91 тэмдэгт; H26/H27 2 өгүүлбэр болсон).  Засвар нь ӨГӨГДӨЛ + ДЕТЕРМИНИСТ
дохио, «H26 бол урт» гэсэн хатуу тохиолдол биш.

- **`backend/src/lib/mglai/depth.ts` (sys-6):** `decideDepth` → `short | normal | detailed`.
  Дараалал: энэ ээлжийн ил хүсэлт («товчхон» / «дэлгэрэнгүй») > хадгалсан `answer_length` санамж >
  санаа/бүтэц (CASUAL/META → short; ERP_ANALYSIS, ялгаа/шалтгаан/дараалал/эрсдэл → detailed; олон
  санаа, тооцоо, норм, ойлголт → normal; хэд/хэзээ/аль → short).  Систем зааварт НЭГ мөр
  («ГҮН: ТОВЧ/ЭНГИЙН/ДЭЛГЭРЭНГҮЙ …»), `/plan` ба `/context` `answer_depth` буцаана.  Сургалтын зорилт
  ч тэр мөрөнд захирагдана → загвар «ХЭЗЭЭ товч, ХЭЗЭЭ тайлбарлах» гэдгийг сурна.
- **Багц v.4** (`behav-2026-09-10.4`, 550): `sft_depth_content.mjs` — 8 сэдэв × normal/short/detailed
  (ил «товчхон хэлээч» / «дэлгэрэнгүй тайлбарла» харьцуулсан хос), ERP шинжилгээ (нэр эхний
  өгүүлбэрт, тоо зөвхөн хайрцгаас, «14+»/«100%» гэх мэт гэрээнд байхгүй тоо бичихгүй), хэлний ил
  хүсэлт, эшлэл+хүчин төгөлдөр байдлын 2 шинэ сэдэв, В2/В3 харьцуулсан дэлгэрэнгүй.
  Зорилтын урт: ≥128 ток 9 → 64 мөр; гүнээр short 150 / normal 222 / detailed 47 (дундаж 45/62/263 ток).
- **Тайрагдлын аудит** (`audit_lengths.py`): v.3-д 1536-д 124/419 мөрийн SYSTEM зааврын дунд
  тайрагдаж байсан — хайрцаг, асуулт, зорилт бүтэн байсан ч гүн/гэрээ/нормын дүрэм алдагдаж байв.
  Одоо `train_lora.py --seq-buckets 1536,1792,2048`: мөр бүр хамгийн бага багтах шат руу ТОГТМОЛ
  дүүргэгдэнэ (fixed shape → хуваарилагч хуваагдахгүй; probe-ийн 3-алхамт хэмжилт бодит
  сургалтад давтагдана), system хөндөгдөх мөр 7/419 (1.7%) л — `critical_truncated` тайланд.
  ⚠️ Урт БУУРУУЛЖ (1280–1408) тайрагдлыг «шийдэх» нь p95 1985-тай багцад system-ийг илүү их
  тайрна — тиймээс шатлан дүүргэлт, буурууулалт биш.
- **Held-out §30:** ээлж бүрд хүлээгдэх `depth` (сервер 43/43 таарна), гүн бүрээр урт/өгүүлбэр;
  `ai:compare` гүнээр харьцуулна.  Суурь sys-6: short 74 тэмдэгт / normal 203 / detailed 906 (14 өгүүлбэр,
  J гогцоо 1/17 — stop=length, runtime-ийн мөчлөгийн хамгаалагч «N дахь үе шат: **ижил**» хэлбэрийг
  барьдаггүй → E4 smoke-д ≤ 1, R4 = 0).

## 8. 0.3 давталт — train/serve ЗӨРҮҮ, арын сургалт, GPU-ийн хамгаалалт (2026-09-11)

**0.2a-ийн үнэлгээ** (`candidate-vs-baseline-2026-09-11T00-42-03-399Z.json`, sys-6 суурьтай, 43 ээлж):
raw 48.8 → **67.4 %**, final 76.7 → 86 %, эшлэл 1/3 → 2/3, баримт 8/18 → 11/18, хэв маягийн гажиг 2 → 1,
давталт 0/0, хэл 41 → 43; **9 кейс засарч, 1 регресс** (H31 «В2 өрөөний хамгийн бага талбай» → «1401 м²» —
галын ачааллын мужийг ТАЛБАЙ гэж уншсан) ба алтан **C2 «yagaad udaad bna» унав** (бодит `analyze_project`
хайрцагт «түргэцээнд оноорсон» гэсэн утгагүй монгол, төслийн нэр алга — суурь ЗӨВ хийж байсан).
→ `CANDIDATE_REJECTED`.  0.2a нь 1536 ганц шатаар сурсан тул 135/419 мөрийн system дундаас тайрагдсан.

**Эх шалтгаан нь ХОЁР train/serve зөрүү**, хоёулаа `build_behavior_sft.mjs`-д (багц **v.5**, 619 жишээ):

1. **Зохиомол хэрэгслийн үр дүн ≠ бодит хэлбэр.**  `analyze_project` 4 талбартай байсан — бодит нь
   `signals[]`, `days_since_last_progress`, `days_remaining`, `overdue_by_team`, `tasks_total/done` …
   (`tools/analytics.ts`); даалгаврын мөр `title/percent` — бодит нь `task/progress_percent`;
   `get_active_employees`-д `by_role` алга.  Загвар СУРГАЛТЫН хайрцгийг л мэднэ — бодит баялаг хайрцагт төөрнө.
   Одоо `synth` нь `tools/{erp,analytics}.ts`-ийн `data`-тай ИЖИЛ; `checkSynthShape()` зөрвөл угсрагчийг ЗОГСООНО.
   `analysisDetailed` 4 дэх аргументаар бүтэн хайрцгийг уншиж `days_since_last_progress`/`days_remaining`/баг-ийн мөр нэмнэ.
2. **Хайрцгийн багц ≠ planner-ийн багц.**  «Хамгийн ойр deadline?» гэхэд `turnPlan` нь `list_projects` +
   `get_upcoming_deadlines` ХОЁУЛАНГ дууддаг (хэмжсэн), гэрээ `active_projects`-ыг mustMention болгодог;
   сургалт ганц хайрцаг үзүүлж байсан → held-out H02/H08/H09/H11 «facts-in-answer: active_projects».
   Одоо `build()` нь planner-ийн төлөвлөсөн энгийн хэрэгсэл бүрд зохиомол үр дүн НЭМЖ (82 хайрцаг), дарааллыг
   planner-ийнхаар; grounded горимд зорилтод байхгүй mustMention баримтыг нэг байгалийн өгүүлбэрээр
   төгсгөлд нэмнэ (67 мөр; тоог ҮГИЙН ХИЛЭЭР шалгана — «26» нь «2026-10-20»-д «байгаа» гэж тооцогдож
   11 мөр гээгдэж байв, «72.»-ийн цэг аравтын биш).

**Шинэ гэр бүлүүд** (held-out-ийн ТОДОРХОЙ уналтаас, өөр үгээр — яг тэр өгүүлбэр test-д): `norm-quantity-mismatch`
(H31: асуусан хэмжигдэхүүн нотолгоонд алга → мужийг хэлээд «тэр утга байхгүй тул тоо хэлэхгүй»),
`trusted-contradiction` (H33: «60 гаруй биз дээ?» → «Үгүй — 23», буруу тоог давтахгүй), `clarification#guess`
(H36: сэдэвгүй «энэ төслийн deadline» → аль төсөл вэ + хамгийн ойрхоныг таамаг, огноогүй), англи нормын
лавлагаа ×3 хэлбэр (H38), латин «yagaad udaan bna» follow-up бүтэн хайрцагтай (C2).  `rangePhrase` нь
«>1095 ба түүнээс дээш МДж/м²» гэсэн гажгийг арилгав.

**`dataset_lint.py` §12 бүтцийн шалгалт нэмэгдэв** (invalid JSON, роль, хоосон, давхар id, урт, давталт —
ижил өгүүлбэр/4-грам, кирилл асуулт → латин хариулт, identity — «таны эрх», «таны нэр дээр эзэмшүүлнэ»
нь худал эерэг байсан тул зөвхөн нэр/тушаалыг ТОДОРХОЙЛОН хэлэхийг барина), `--json` гаралт.

**Пайплайн (§15, §29):**
- `train_lora.py`: `--resume` (өмнө нь `cfg.resume` талбар байсан ч CLI-д БАЙГААГҮЙ), `--save-steps N`
  (epoch хүлээхгүй checkpoint, `save_total_limit 3`), `state.json` алхам бүрд (алхам/ETA/loss/VRAM/GPU °C·W·throttle),
  `run_dir/STOP` sentinel → checkpoint хадгалаад эмх цэгцтэй зогсоно, 84 °C анхааруулга / 88 °C эсвэл
  драйверийн дулааны throttle → зогсоно (INTERRUPTED/FAILED/STOPPED/THERMAL_STOPPED-д ч тайлан бичигдэнэ),
  `--resume` нь `config.json`-тай зөрвөл татгалзана.
- `training/train.ps1` + `ai:train:bg|status|stop|resume|log`: `Start-Process`-оор цонхгүй, терминалаас
  хамааралгүй; PID `training/runs/<нэр>.pid`, лог `.log`.  `-Stop` = sentinel, `-Stop -Force` = kill.
- **GPU хамгаалалт (§2):** `training/gpu_guard.py` — инференс (39217 /health эсвэл nvidia-smi дахь llama-server)
  илэрвэл сургалт ЭХЛЭХГҮЙ (`--allow-shared-gpu` зөвхөн туршилт, тайланд); сургалт `<dataDir>/training.lock`
  бичиж, runtime (`runtime/src/trainingLock.ts` → `LlamaCppEngine.#start`) амьд pid-тэй түгжээ хараад
  llama-server-ийг АЧААЛАХГҮЙ (`TRAINING_IN_PROGRESS`) — автомат эхлүүлэлт сургалтын дундуур 5.7 GB
  нэмж халиахгүй.  Хэмжсэн: QLoRA оргил 7.6 GB + инференс 5.7 GB нь 8 GB-д багтахгүй, Windows sysmem
  fallback-д хоёулаа удаашрана.
- `ai:train:eval -- --run <нэр>`: экспорт → тусдаа runtime (39227, `MglAi-candidate`) → held-out + алтан A–O →
  compare (сүүлийн `*-sys6-base8b-reference.json`-той) → зогсоох, нэг тушаалаар.
- `ai:model -- adapter-install <run> | adapter-activate <uid> | adapter-rollback | adapter-deactivate | adapter-list`:
  ЭНЭ машины runtime-д `ModelManager`-ийн `candidateAdapter → activeAdapter → previousAdapter` төлөвөөр
  (updater.ts-ийн манифестийн замтай ижил хэлбэр).  `adapter-install` нь compare тайлангүй адаптерыг суулгахгүй;
  идэвхжүүлэх нь ЭЗНИЙ шийдвэр; буцаалт ганц тушаал.  Бусад ажилтан руу тараах = D1 `ai_model_releases` + R2.
- Readiness E5: «алтан 100 %» нь мэдлэгийн давхаргын RELEASE R5 болов (8 мэдэгдэж буй кейс — CLAUDE.md);
  smoke-д гоожилт 0 + алтан ≥ 85 % (хэмжсэн суурь 88.4 %) — retrieval ба адаптер ТУСДАА урсгал (§21).

**0.3 үр дүн** (`train-mgl-adapter-0.3.json`, `candidate-vs-baseline-2026-09-11T02-49-18-190Z.json`): r16/α32 бүх модуль,
LR 1e-4 cosine, 2 epoch = 118 алхам (accum 8), шат 1536/1792/2048, **lm_head NF4** (`--quantize-lm-head`: probe-д 2048 нь
61 с → 12 с/дараалал, reserved 7674 < 8192; serving GGUF ч output.weight-ийг квантчилдаг), 47 мин, 25.7 с/алхам, VRAM оргил
7457 MB, GPU оргил 64 °C / 219 W, NaN 0, түүх хаясан 27, system тайрагдсан 9/466.  Loss 2.45 → 0.59, eval_loss 0.669 (epoch 1)
→ **0.567** (0.2a: 0.928).  STOP/resume нь ЭНЭ run дээр шалгагдсан (12-р алхамд зогсоож checkpoint-12-оос үргэлжлүүлсэн).
Суурьтай (43 ээлж): raw **48.8 → 79.1 %** (0.2a 67.4), final 76.7 → 88.4 %, эшлэл 1/3 → 3/3, баримт 8/18 → 14/18, хэл 41 → 43,
хэв маягийн гажиг 2 → 1, хүчтэй давталт 0/0, аюулгүй байдлын регресс 0 (raw ч, final ч), гүнээр short 12→20/26 · normal 7→11/14 ·
detailed 2→3/3; C2 (0.2a-ийн регресс) засарсан.  ⚠️ **ГЭВЧ алтан G унав → `CANDIDATE_REJECTED`**: засварын ээлж
(«үгүй ээ, MGL-260804 …-г хэлсэн юм») + бодит `get_project_progress` хайрцаг явц 0 % атлаа баг 100 % — адаптер зөрчлийг
ТАЙЛБАРЛАХ гэж утгагүй монгол («голложин»), зохиомол тоо гаргаж, validator бүгдийг хасаад «Явц: **0%**» үлдээв (нэргүй).
Суурь ч тэр кейст утгагүй бичсэн боловч нэрийг агуулж байсан.  Багц **v.6** (634): `correction#real0..2` — засварын ээлж ×
кодтой нэр × явц 0 %/зөрчилтэй баг/энгийн, зорилт нь нэр ЭХЭНД, зөрчлийг нэг өгүүлбэрээр хэлээд тайлбарлахгүй → `mgl-adapter-0.4`
(ижил тохиргоо).  0.3-ын адаптер `ai/models/adapters/mgl-adapter-0.3/` (GGUF LoRA хамт) хяналтад үлдэнэ; юу ч идэвхжүүлээгүй.

**0.4 үр дүн** (`train-mgl-adapter-0.4.json`, `candidate-vs-baseline-2026-09-11T03-56-21-329Z.json`): багц v.6 (634, train 477),
0.3-тэй ижил тохиргоо, 120 алхам; 115-р алхамд CUDA *драйверийн* OOM (reserved 7714 MB тогтмол байсан — гадны процесс VRAM
авсан; ажлын ширээнд Chrome/Word/Copilot нээлттэй) → `checkpoint-110`-аас `-Resume` 5 минутад дуусгав.  eval_loss 0.659 (epoch 1)
→ **0.557**.  ⚠️ Тайлангийн `train.loss_final`/`duration_s` нь зөвхөн ҮРГЭЛЖЛҮҮЛСЭН хэсгийнх (10 алхам); эхний хэсгийн лог
train.ps1-ийн дарж бичилтээр алдагдсан — одоо хуучин лог `<нэр>.<огноо>.log` болж хадгалагдана.
Суурьтай (43 ээлж): raw **48.8 → 72.1 %** (0.3: 79.1), final 76.7 → **88.4 %**, эшлэл 3/3, баримт 11/18, хэл 43/43, хэв маяг 2→1,
давталт 0, **алтан A–O 35/35 (суурь 33/35), регресс 0, аюулгүй байдлын регресс 0** → **`CANDIDATE_APPROVED_FOR_REVIEW`** —
анхны хаалга бүрийг давсан нэр дэвшигч.  0.3-аас raw доогуур (english 1→0/2, long 2→1/2, erp 1/3) — temp 0.7 түүвэрлэлтийн
хэлбэлзэл ба бодит ялгаа хоёулаа байж болно; blind-review.md-ээр хүн үнэлнэ.  Идэвхжүүлэх нь ЭЗНИЙ шийдвэр:
`npm run ai:model -- adapter-install mgl-adapter-0.4` → `adapter-activate local:mgl-adapter-0.4` → `ai:stop && ai:start`;
буцаах `adapter-rollback`.  R1 (license_cleared), R4 (суурийн J гогцоо), R5 (нормын алтан 100 %) нээлттэй хэвээр.
