## ХИЛИЙН АУДИТ — 430 англи мөр → 19 ХАС, 52 НЭМ

Дүгнэлтийг таамгаар биш, **бодит сургалтын хоолойгоор** хийв: `training/textfold.py`-ийн `fold_text` + `train_intent.py`-ийн `preprocess` (qmark залгалт) дуудаж, дараа нь тэмдэгтийн **3-5 n-gram косинус** тооцоод шинэ мөр бүрийн хамгийн ойрын ӨӨР САНААНЫ хөршийг олов. Загвар нь `TfidfVectorizer(analyzer="char", ngram_range=(3,5), min_df=2)` + `LogisticRegression(C=8)` учраас энэ хэмжүүр нь ангилагчийн бодитоор хардаг зайтай яг таарна.

### 1. НЭГ МӨР СУРГАЛТЫГ ОГТ ЗОГСООНО (яаралтай)

`"?" → help` мөр нь **seed.json-ы `"?" → unknown`-той зөрчилдөж байна.** `train_intent.py:193-200` нь эвхсэн текст хоёр өөр шошготой байвал `SystemExit("...зөрчилтэй мөр. Эхлээд зас.")` хийдэг. Энэ мөр багцад орвол `pull_and_retrain.py` унана — нарийвчлал буурахгүй, огт сургагдахгүй.

### 2. ХЭМЖСЭН ХОЁРДМОЛ ХОСУУД (илгээх ↔ шалгах)

Даалгаврын 1-р асуултын хариу. 80 хосын **77 нь ЦЭВЭР** — үйл үгийн ялгаа тод (send/check, log/how much, record/show, submit/tell me). Гурав нь ангилагчийн хувьд **сурч БОЛОМЖГҮЙ**:

| cos | submit | progress_status | шалтгаан |
|---|---|---|---|
| 0.929 | `A-101 finished today` | `is A-101 finished today` | цэвэр дэд мөр, «is» л нэмэгдсэн |
| 0.899 | `done with the sections` | `am i done with the sections` | цэвэр дэд мөр |
| 0.750 | `BA-03 is complete` | `is BA-03 complete` | **үгийн байрлал сольсон** — үгсийн сан 100% ижил |

Гурвуулаа асуултын тэмдэггүй тул `preprocess`-ийн `qmark` онцлог ч аврахгүй. Ялангуяа `is A-101 finished today` нь корпуст аль хэдийн байгаа `A-101 finished` → submit_progress мөрийг шууд эсэргүүцэж, **оношилгоонд нэрлэсэн яг тэр алдааг өөрөө үйлдвэрлэнэ**. Гурвуулаа ХАСААД, «check if …» тэргүүлэгчтэй ялгарах орлуулга нэмэв.

⚠️ `qmark`-д найдаж болохгүй: одоогийн корпуст «?» бүх санаанд бараг тэнцүү тархсан (status 11, set_baseline 11, reset_view 10, submit 8) тул мэдээллийн ачаалал нь бараг тэг.

### 3. ХӨНДЛӨН МӨРГӨЛДӨӨН + ДАВХАРДАЛ

- `teach me how to use excel` (unknown) ↔ multilang.json-ы `teach me how to use you` (help), **cos 0.783**. help→unknown бол ХЭМЖСЭН 4 алдаа — энэ мөр яг тэр хилийг эвдэнэ. ХАСав.
- 5 мөр эвхсэн хэлбэрээр аль хэдийн байгаа мөртэй **яг давхардаж** байна: `commands`, `help`, `hlep`, `progres?` (=`progress?`), `CHECK MY PROGRES` (=`check my progress`). Ачаалахад чимээгүй хасагдана.
- ⚠️ **ТОМ ҮСГИЙН МӨРҮҮД АШИГГҮЙ.** `fold_text` бүгдийг жижиг үсэг болгодог тул `SUBMIT PROGRES NOW`, `LIST ALL SHETS`, `RESET VIEW PLS` зэрэг нь зөвхөн үг нь ялгаатай учраас л үлдэж байна. Өмнөх аудитын «том үсэг = кирилл гэсэн хуурамч холбоо» гэсэн үндэслэл нь **буруу байсан** — эвхэлт тэр холбоог биет байдлаар үүсгэх боломжгүй.

### 4. ДҮРМИЙН ШАЛГАЛТ

| Дүрэм | Үр дүн |
|---|---|
| 3. Объектгүй reset_view | **Зөрчилгүй.** 44 мөр бүрд объект бий (isolation / the view / all elements / the model). |
| 4. help дотор «list»/«show all» | **Зөрчилгүй.** `show commands` эргэлзүүлсэн ч ХЭМЖИЛТЭЭР цэвэр: эвхэхэд `show comands` vs `show shec` (sheets→shec) болж, `comand` тэмдэгт **15/15 help** талд байна. ҮЛДЭЭВ. |
| 5. Хиймэл англи | **7 зөрчил.** `kindly …` ×4 ба `walk me through this tool` нь өмнөх аудитад аль хэдийн хасагдсан ЯГ ТЭР хэв маягийн давталт (multilang-audit.md, 7-р хэсэг). Мөн `narrow the view …` (уугуул хэлц) ба `i would like to … please` (давхар эелдэг). |

### 5. ЦООРХОЙ — 52 мөр нэмэв (шаардлагатай 40-өөс дээш)

submit 11 · status 15 · help 7 · reset_view 6 · set_baseline 5 · isolate 3 · whats_changed 3 · list_sheets 2. Хэмжсэн алдаа бүрд шууд чиглүүлэв:

- **submit↔status 11 алдаа** → «see / view / how far / what percent» гэсэн ШАЛГАХ үйл үгс англи талд бараг байхгүй байсныг нөхөв (`see percentage` ганцхан мөр байсан). Мөн үйл үггүй дуусгалын мэдэгдэл (`A-301 is ready now`, `i completed BB-11`) — өмнөх аудит үүнийг «ХАМГИЙН ТОМ ЦООРХОЙ» гэж нэрлээд зөвхөн монгол талыг нөхсөн байсан.
- **help→unknown 4** → help-ийн түлхүүр үггүй хэлбэрүүд (`what words do you understand`, `how do i talk to you`).
- **progress_status→unknown 3** → «progress» гэдэг үггүй шалгах мөрүүд (`BA-07 how many percent done`).
- **reset_view→isolate_sheet 2** → ШИФР агуулсан ч буцаах зорилготой 4 мөр, бүгд объекттой.
- **set_baseline→unknown 2** → «baseline» гэдэг үг огт агуулаагүй суурь авах мөрүүд.

**Нэмсэн 52 мөрийг шалгав:** эвхсэн зөрчил **0**, эвхсэн давхардал **0**. 0.62-оос дээш хөрштэй ердөө 4 мөр, бүгд нь ялгах үйл үгтэй зориудын хос (record↔tell me = 0.815, check if↔мэдэгдэл = 0.800).

### 6. ТҮҮХИЙН ДАРААХ ТЭНЦВЭР (англи)

unknown 84 · help 61 · submit 56 · status 54 · reset_view 49 · set_baseline 45 · list_sheets 42 · isolate 36 · whats_changed 36. Нийт **463 англи мөр** (өмнө нь 355).

⚠️ **Дараагийн сургалтын дараа хамгийн түрүүнд шалгах зүйл:** `unknown` нь одоо ч хамгийн сул (0.868) БӨГӨӨД хамгийн том анги. Энэ багц түүнд бас 84 мөр нэмж байгаа тул unknown бусад санааг залгих эрсдэлтэй. `report.json`-ы `per_intent.unknown` буурсан бол дараагийн ээлжинд unknown-оос МГЛ-модулийн давхардсан сөрөг жишээнүүдийг цөөл (`submit my timesheet` / `send the attendance report to HR` / `log my hours …` гурав нэг санааг гурван удаа сургаж байна).

⚠️ Бас ажиглав: `help`/`halp` тэмдэгт агуулсан мөр одоо **help 16 : unknown 8** харьцаатай. `help me <ажил>` → unknown хэлбэрүүд үнэ цэнэтэй домэйн сөрөг жишээ учраас үлдээв, гэхдээ энэ харьцаа 60:40 болж унавал бүдүүн `help me` мөр unknown руу орох тул хянах хэрэгтэй.

---

## Хасагдсан (19)

- `?` — ҮХЛИЙН ЗӨРЧИЛ. seed.json-д `?` → unknown байна. train_intent.py (мөр ~193-200) preprocess хийсэн текст хоёр өөр шошготой байвал `ЗӨРЧИЛ — нэг текст олон санаанд` гэж SystemExit хийдэг. Энэ мөр багцад орвол СУРГАЛТ ОГТ АЖИЛЛАХГҮЙ.
- `commands` — Эвхсэн хэлбэрээр bootstrap.json-ы `commands` (help)-тэй яг давхардаж байна. Ачаалахад чимээгүй хасагдана (dropped_dup) — дэмий орон зай.
- `help` — seed.json БОЛОН bootstrap.json-д `help` аль хэдийн байна. Эвхсэн давхардал, чимээгүй хасагдана.
- `hlep` — seed.json-д `hlep` яг байна. Эвхсэн давхардал.
- `progres?` — fold_text давхар үсэг хурааж, тэмдэг тайрдаг тул multilang.json-ы `progress?` (progress_status)-той ЯГ ижил эвхэгдэнэ. Дэмий мөр.
- `CHECK MY PROGRES` — fold нь жижиг үсэг болгож, `progres`→`progres` хураадаг тул multilang.json-ы `check my progress`-тэй ижил эвхэгдэнэ. ⚠️ Том үсгээр бичих нь ЯМАР Ч шинэ дохио өгөхгүй — fold бүгдийг жижиг үсэг болгодог.
- `is A-101 finished today` — Тэмдэгтийн 3-5-gram косинус 0.929, submit талын `A-101 finished today`-ийн ЦЭВЭР ДЭД МӨР (зөвхөн «is» нэмэгдсэн, асуултын тэмдэггүй тул qmark онцлог ч гарахгүй). Түүнчлэн корпуст `A-101 finished` → submit_progress байгааг шууд эсэргүүцэж, оношилгоонд нэрлэсэн submit→status алдааг ӨӨРӨӨ үйлдвэрлэнэ.
- `am i done with the sections` — Косинус 0.899. submit талын `done with the sections`-ийн дэд мөр — ялгаа нь ердөө «am i». Үйл үггүй дуусгалын мэдэгдэл (submit-ийн хамгийн үнэ цэнэтэй хэлбэр) сургахад шууд саад.
- `is BA-03 complete` — submit талын `BA-03 is complete`-ийн ҮГИЙН БАЙРЛАЛ СОЛИСОН хувилбар — үгсийн сан 100% ижил (jaccard 1.00, char-gram cos 0.750), асуултын тэмдэггүй. Ялгах ганц ч үйл үг байхгүй тул ангилагч ХЭЗЭЭ Ч сурч чадахгүй, зөвхөн хоёр ангийн жинг сарниулна.
- `what is in the system for TsBU-05` — Хоёрдмол. «what is in the system» дотор явц/хувь гэсэн объект байхгүй — list_sheets ч байж болно, ерөнхий асуулт ч байж болно. Хосолсон submit мөр («put 75% into the system») нь «the system»-ийг илгээх талд татах тул хил бүдгэрнэ.
- `kindly record the progress of the elevation sheets` — Дүрэм 5 — хиймэл/сурах бичгийн англи. Өмнөх аудит `kindly …` гэсэн 3 мөрийг «Сурах бичгийн/хэт эелдэг англи» гэж аль хэдийн ХАССАН (multilang-audit.md, 7-р хэсэг). Монгол инженер «kindly» гэж бичдэггүй.
- `kindly tell me the progress of the elevation sheets` — Дүрэм 5 — өмнөх аудитад хасагдсан `kindly …` хэв маягийн давталт.
- `kindly remove the isolation from the 3d view` — Дүрэм 5 — өмнөх аудитад хасагдсан `kindly …` хэв маягийн давталт.
- `kindly mark now as the start of tracking` — Дүрэм 5 — өмнөх аудитад хасагдсан `kindly …` хэв маягийн давталт.
- `walk me through this tool` — Дүрэм 5 — уугуул англи хэлц. Өмнөх аудит ЯГ ЭНЭ мөрийн ихрийг (`walk me through this panel`) «Уугуул англи хэлц» гэж хассан.
- `narrow the view to sheet HAS-08` — Дүрэм 5 — «narrow the view» бол уугуул хэлц, монгол инженер бичихгүй. Түүнчлэн «the view» гэдэг нь reset_view-ийн давамгай объект нэр байтал энэ мөр isolate_sheet шошготой — хилийг зориуд бүдгэрүүлж байна.
- `teach me how to use excel` — ХӨНДЛӨН МӨРГӨЛДӨӨН: multilang.json-д `teach me how to use you` → help байна. Тэмдэгтийн n-gram косинус 0.783, ялгаа нь ердөө `excel`/`you`. help→unknown бол ХЭМЖСЭН алдаа (4 тохиолдол) — энэ мөр «teach me how to use» хэллэгийг unknown руу татаж, тэр алдааг өсгөнө.
- `what now` — Хоёрдмол. «одоо яах вэ» гэдэг нь help ч байж болно, дараагийн алхмын асуулт ч, явцын асуулт ч байж болно. help-ийн ямар ч объект (command/guide/manual) агуулаагүй.
- `i would like to snapshot the model please` — Дүрэм 5 — «I would like to …» + «please» давхар эелдэг байдал нь өмнөх аудитад хасагдсан (`I would like to review …`, `shall we …`) сурах бичгийн хэв маягийн яг давталт.
