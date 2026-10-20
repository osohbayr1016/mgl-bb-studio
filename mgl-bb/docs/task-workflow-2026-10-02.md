# Таскийн ХУВААРИЛАЛТ — 2026-10-02 (handoff + дизайн + явц)

> Суурь commit `a1b21991` (main). Эзний батлагдсан дүрэм нь CLAUDE.md-ийн хуучин «Таск хуваах»
> (`POST /:id/split`, жин хуваах, «(i/N)» хуулбар) хэсгийг **орлоно** — хуучин урсгал БҮХ таскт `410 SPLIT_RETIRED`
> болсон. Энэ файл нь дараагийн сесс/хянагч хоёрын ГАНЦ эхлэх цэг:
> шийдвэр, файлын зураг, хийгдсэн/үлдсэн ажил, шалгасан зүйл.
>
> ⚠️ **Prompt 50 000 тэмдэгтээр таслагдсан** (8-р бүлгийн дундаас: «…хэмжсэн цаггүй хуучин явц…»).
> 9+ бүлгийн (UI, дэд хугацаа, дугаарлалт, тест, runbook) нарийвчлал дутуу — эзний дүрмийн
> хүснэгтээс (Хадгалалт, Дуусгах асуулт, Нэр, Хувь нэмэрч, Цаг, Ил тод байдал, Ажилтны жин, Дэд
> хугацаа, Дугаар) сэргээн хэрэгжүүлсэн. Тайлбарын зөрүү гарвал эзнээс асуух жагсаалт доор.

> **Төлөв (2026-10-02, сессийн төгсгөл):** backend + frontend БҮХЭЛДЭЭ хэрэгжсэн, локал дээр шалгасан (§10).
> **Deploy · прод миграц · прод backfill · глобал оноо дахин бодолт · commit ХИЙГДЭЭГҮЙ** (prompt зөвшөөрөөгүй).
> **⛔ Deploy хийхээс ӨМНӨ §11-ийн «0. Deploy-ийн саад»-ыг заавал уншина:** прод нь main-д ОРООГҮЙ «ROOT бүлэг + дэд таск»
> (`94df1fc1`, migration 0372) ба «нэр – цаг» (`e1d55087`, 0373) кодтой — энэ ажилтай ойлголтоор зөрчилдөж, файлаар давхцана.

## 1. Нэг догол мөрөөр

Нэг таск = НЭГ «үндсэн ажил» (root, `tasks.id`, дотоод жин `W` **хэзээ ч өөрчлөгдөхгүй**). Хуваахад шинэ
таск ҮҮСЭХГҮЙ — оролцогч бүрт хуваарилалт (`task_allocations`) үүснэ. Бүх хийсэн/зорилт ҮНДСЭН АЖЛЫН хувиар
(1 пункт = 10 000 нэгж, бүтэн = 1 000 000, `lib/taskUnits.ts`). Хүн `D_i` (хийсэн) / `T_i` (нийт зорилт)-ыг
харна; ердийн − / + нь `T_i`-ийн 10% эсвэл 1%; «Үлдсэн ажлаа дуусгах» тусдаа. Оноо журналаас (`task_contributions`)
гарч, өөрийн бодит залруулга оноог **буцаана** (сөрөг мөр, анхны өдөрт). Хуучин төлөгдсөн атлаа хүчингүй
нэгж (`slack`) дахин төлөгдөхгүй.

Инвариант (`lib/taskAllocation.ts` `checkRootInvariants`): `0 ≤ L_i ≤ D_i ≤ T_i ≤ 100`, `Σ T_i + B + U = 100`,
`root_done = Σ D_i + B`. `B` = эзэнгүй хуучин хийсэн (түгжигдсэн), `U` = хуваарилагдаагүй ирээдүйн ажил.

## 2. Эзний шийдвэр ↔ хэрэгжилт (хүснэгт)

| Шийдвэр | Хэрэгжилт |
|---|---|
| Duplicate биш, нэг ажил | `task_roots` + `task_allocations`; хуучин `planSplit` хуулбар үүсгэх зам managed таскт хаалттай |
| Үндсэн ажил 100%, `W` хөдөлгөхгүй | root-ийн `weight_percent` нь split/edit-д ХӨНДӨГДӨХГҮЙ |
| Хийсэн ажил түгжигдэнэ | `floor_units` (L) — хуваалт засах бүрд `L := D`; ердийн «−» L-ээс доош орохгүй |
| 80% хийсэн үргэлжлүүлбэл 80/90 | `planAllocation` 'remainder' горим, `applyFinalTargets` |
| − / + = нийт зорилтын 10%/1% | `taskUnits.stepUnits` (5 → 0.5/0.05; 45 → 4.5/0.45; 90 → 9) |
| «Үлдсэн ажлаа дуусгах» | `finishRemaining` (0/5 → +5; 80/90 → +10) — энгийн алхамтай ТУСДАА |
| Тоо бичих | `parseUnits` (хатуу); 5-ын хэсэгт 2.5 → 2.5/5 |
| Автомат хуваалт 40→60; 60→20/20 | `planAllocation` 'total'/'remainder', soft/fixed мөр |
| Засах эрх | оролцогч + senior/admin, СЕРВЕР шалгана; түүх `task_ops` |
| Pause = хуваарилалт хэвээр | `pauseOfficialTimer` хуваарилалтыг хөндөхгүй |
| Үлдсэн ажил буцаах/шилжүүлэх | `planRelease`; `D_i` хэзээ ч бусдад шилжихгүй |
| Өөрийн бүртгэл буцаах/засах | `planReversal` (LIFO) + сөрөг `user_points` мөр (`source='progress'`, анхны `awarded_at`) |
| Хассан бүртгэл аудитад, тооцоонд үгүй | `task_timer_voids` (цаг), `units_open=0` слайс (явц) |
| Дахин авах = хүчинтэй хийсэн хэмжээнээс | `planRetake` (`D_i` хэвээр), `released_units` санагдана |
| Сэргээж үргэлжлүүлэх | restore = reversal-ыг буцаах (давхар оноогүй), `checkRestore` slack шалгана |
| Үндсэн таск устгахгүй | `DELETE /tasks/:id` managed таскт 409 `ROOT_PROTECTED` (аливаа цэвэрлэгээнээс ӨМНӨ) |
| Хадгалалт 5 сек | frontend write queue (`features/task-allocation/`) |
| Нэр `Б.Бат` | `shared/lib/staffName.ts` (DB-ийн full_name хөндөгдөхгүй) |
| Хувь нэмэрч | contributors endpoint: хүчинтэй `D_i > 0` эсвэл тоологдсон цаг; bookmark нотолгоо БИШ |
| Цаг нэр + цаг | official counted time (цайны цаг хассан) ЭСВЭЛ засварын цаг; хоёрыг НЭГТГЭХГҮЙ |
| Ажилтны жин хасна | project дэлгэцийн «Зураг %/Төсөлд %» багана зөвхөн admin/senior-д |
| Дэд хугацаа | task checkpoint (`task_deadlines`) бичих зам хаагдана, түүх үлдэнэ; milestone хэвээр |
| Дугаар 17 → 17.1, 17.10 | `childLabel`, `compareLabels`; үндсэн дугаар шүүлтүүрээс хамаарахгүй |

## 3. Өгөгдлийн загвар (migration 0376–0380)

`task_roots(task_id PK, revision, unattributed_units B, unallocated_units U, slack_units, next_ordinal,
seed_attribution, seed_json, completed_at …)`
`task_allocations(id, task_id, user_id, ordinal, target_units T, done_units D, floor_units L, released_units,
revision …, UNIQUE(task_id,user_id), UNIQUE(task_id,ordinal))`
`task_contributions` — слайс (work/seed: `units_open`, `free_open`, `credit_open_*`) ба үйл явдал
(correction/restore: `ref_id`, сөрөг units, `points_id`); `UNIQUE(request_id, seq)`.
`task_ops(request_id PK, task_id, user_id, kind, root_revision_before/after, before_json, after_json,
result_json, post_status)` — идемпотент + өөрчлөлтийн түүх.
`user_points` + `contribution_id`, `reverses_points_id`, `recorded_at` (ALTER, FK-гүй).
`progress_entries` дээр `source='alloc'` (ажлын хадгалалт = actor-ын тайлан + root projection),
`source='alloc_adj'` (залруулга/сэргээлтийн projection — ажлын үйл явдал БИШ).
`projects.auto_archived_at` — хувь дүүрч АВТОМАТААР архивлагдсаныг батлах (гараар архивлавал NULL).
`task_timer_voids` — өөрийн сэшнийг хүчингүй болгох (аудит, дахин сэргээх).

FK-гүй (сүүлийн миграцуудын жишгээр); устгалыг гараар (`routes/projects.ts`, `routes/users.ts`).
`0380` — `idx_tts_task ON task_timer_sessions (task_id, user_id)` (1 statement): contributors / working / авах асуулга task_id-аар шүүдэг.
⚠️ Энэ индекс deploy салааны `0373_task_timer_task_index.sql`-тэй ЯГ ИЖИЛ (нэр + баганууд) — аль нь ч түрүүлж ажиллавал `IF NOT EXISTS`
нөгөөг алгасна.  Өөр баганатай ижил нэртэй индекс БҮҮ нэм (нэр давхцаж чимээгүй алгасагдана).

## 4. Яагаад ингэж — аудитаас гарсан баримтууд (2026-10-02, 5 уншигч)

* `progress_entries.source` CHECK-гүй → шинэ утга аюулгүй. `award_points` багана БАЙХГҮЙ (зөвхөн `repair_marks`-д).
* `created_at` нь `datetime('now')` — **секундын** нарийвчлал. Хоёр бичлэг ижил секундэд бол `latestApprovedPctByCreatedAt`
  хамгийн БАГА хувийг буцаадаг. Шийдэл: managed projection-д `created_at`-ыг таск тутамд ХАТУУ өсөх болгож (JS-ээр
  `max(now, сүүлийн+1с)`), мөн helper-т `id DESC` tie-break + бүрхэх индекс (0378).
* Өмнөх огнооны мөр BD (`date DESC…`) уншигчдад харагдахгүй → projection `date = max(өнөөдөр, хамгийн сүүлийн date)`.
* `user_points`: CHECK `source`-д БАЙХГҮЙ, сөрөг дүн орно. SUM(amount) бүх уншигчид цэвэр нэтлэнэ. Харин:
  `recalculateProjectPoints` `source='progress'`-ийг устгана → managed таскийн мөрийг хамгаалах предикат нэмсэн.
  COUNT(*) / `award_count` уншигчид буцаалтын мөрийг нэмж тоолно (мэдэгдэж буй үлдэгдэл).
  `leaderboard.ts /me recent` буцаалтыг «+-0.35%» гэж харуулна (frontend тэмдэг засна).
* `hasReportedWorkToday` (attendance.ts:175) ба `repairDayStore.ts:152` нь source шүүдэггүй → `alloc_adj`-ийг хасна.
* Таймерын уншигчид (`taskTimerStore.ts`): state(2), live(2), sessions overlapping, report(2) — бүгдэд voided сэшнийг хасна.
  `has_taken` (TAKE_REQUIRED) → хүчинтэй (void-гүй) сэшнтэй байх.
* Устгалын зам: `DELETE /tasks/:id` ба components/drawings/blocks/projects, `copy-structure` replace. Task-ийн
  устгах товч ЗӨВХӨН setup хуудсанд (admin+senior); төслийн хуудас, My Tasks-д байхгүй.
* FK хэрэгжилтийн тухай баримтууд өөрөө зөрчилддөг → FK-гүй хүснэгт + гараар цэвэрлэгээ.

## 5. Файлын зураг

Backend (бүгд `backend/src/` — migration нь `backend/migrations/0376–0380`):
* `lib/taskUnits.ts` — нэгж, парс/формат, алхам, хуваалт ✅ (+test 19)
* `lib/taskAllocation.ts` — төлөвлөгч, `applyFinalTargets`, `planOwnProgress`, `planRelease`, `planRetake`, дугаар ✅ (+test 46)
* `lib/taskCredit.ts` — `taskProjectCoef`, `planWorkCredit`, `planReversal`, `checkRestore` ✅ (+test 15)
* `lib/taskSeed.ts` — хуучин түүхийг managed болгох seed (нотолгоотой атрибуци) ✅ (+test 13)
* `lib/taskRootStore.ts` — D1 уншилт, `ParamBag`, marker-тэй `runGuardedBatch`, `rootView`, цаг (`nextEntryTs`) ✅
* `lib/taskRootOps.ts` — мутаци: `applyAllocation` (хуваах/засах/seed), `setOwnProgress`, `releaseOwn`, `retakeAllocation`,
  `correctOwnProgress`, `restoreOwnProgress`, `loadOwnRecords`, `loadAllocationOverview` ✅ (+test 41, бодит SQLite)
* `lib/taskContributors.ts` — төслийн хувь нэмэрч + хүн×цаг нэгтгэл (асуулга 6) ✅
* `lib/taskRootGuard.ts` — устгалын хамгаалалт, цэвэрлэгээ, `detachUserFromRoots` ✅
* `lib/taskTimerLunch.ts` — цайны цонхны хуваалцсан туслах ✅
* `routes/taskAllocations.ts` — HTTP (`/api/tasks`-ийн 2 дахь mount, `index.ts` дээр `tasks`-ээс ӨМНӨ) ✅ (+test 14)
* Өөрчилсөн: `routes/progress.ts` (managed татгалзах, recalc хамгаалалт, `auto_archived_at`, my-tasks `allocation`,
  `archiveProjectIfComplete` экспорт, `normalizeAttachmentsInput` экспорт), `routes/tasks.ts` (DELETE/baseline/split guard),
  `routes/taskTimer.ts` (void/restore, `NOT_ALLOCATED`), `lib/taskTimerStore.ts` (`notVoidSql` бүх уншигчид, void/restore,
  managed facts), `lib/taskTakeService.ts`, `lib/taskTake.ts`, `lib/myTaskList.ts` (хуваарилагдсан таск «Миний ажлууд»-д),
  `routes/{components,drawings,blocks,projects,users}.ts` (устгал), `routes/deadlines.ts` (таскийн дэд хугацаа бичих = 410),
  `lib/progressLatest.ts` (+`id DESC`), attendance/repair/snapshot/leaderboard/reports (alloc_adj-ийг ажлын үйл явдлаас хасав).
* Тест харнесс: `backend/test-support/allocHarness.ts` (бодит SQLite + миграц). Хуучин 5 харнесс миграцын жагсаалтаа шинэчилсэн.
* `routes/deadlines.ts`: таскийн дэд хугацааны 4 бичих зам → `410 SUB_DEADLINE_RETIRED`; `GET /tasks/:id` (түүх) хэвээр, `can_edit` үргэлж false;
  төслийн «Хугацаа»-ийн `sub` мөрийн `can_edit` бас false.  **Нээлттэй (биелээгүй) хуучин шалгах цэг `/upcoming`, `/calendar`, төслийн «Хугацаа»-д ГАРАХГҮЙ**
  (хэзээ ч хаагдахгүй «хоцорсон» дохио болох тул); биелсэн нь түүх болж үлдэнэ (`include_done`, төслийн «Хугацаа»).  Өгөгдөл устаагүй — `GET /deadlines/tasks/:id` бүгдийг буцаана.
  Сануулах (remind) зам хуучин код дээр ч байгаагүй (`deadlineSweep` `task_deadlines`-ийг уншдаггүй).  `routes/tasks.ts`: `POST /:id/split` → `410 SPLIT_RETIRED` (бүх таск).

Frontend (`frontend/src/` — бүгд ✅):
* **`features/task-allocation/`** (шинэ, 20 файл ≈ 4 600 мөр): `units.ts`, `allocation.ts` (backend-ийн БАЙТ-ИЖИЛ ихэр — `check-task-units.mjs` transpile хийж тулгана),
  `types.ts`, `api.ts` (query key, `request_id`, `attempts: 3`), `ownProgress.ts` (цэвэр ноорог загвар), `ownProgressStore.ts` (module-level store, 5 сек debounce,
  STALE автомат rebase + 1 дахин, QA хаалга, visibilitychange flush, beforeunload), `useOwnProgress.ts`, `stepMode.ts`, `OwnProgressControl.tsx`, `CompletionQaDialog.tsx`,
  `allocationEditor.ts` (цэвэр: авто-тэнцвэржилт, 'total'|'remainder' горим), `AllocationEditorDialog.tsx`, `contributors.ts`, `ContributorsList.tsx`, `hooks.ts`
  (`CONTRIBUTORS_POLL_MS = 30_000`), `useAttempt.ts`, `TakeFlowDialogs.tsx` (+`NotAllocatedDialog`), `ReleaseDialog.tsx`, `OwnRecordsDialog.tsx`, `ManagedRowActions.tsx`.
* `shared/lib/staffName.ts` («Б.Бат»; давхцвал бүтэн нэр) · `scripts/check-task-units.mjs` (48 шалгалт; `package.json` → `check:task-units`, `verify`-д).
* Өөрчилсөн: `features/projects/detail/{types.ts (FlatTask.number), useProjectTasks.ts, taskLiveContext.ts, taskLive.tsx, TaskLiveCell.tsx (дахин бичсэн),
  GroupedTaskRow, FlatTaskRow, GroupedTasksHeader, GroupedSectionRows, GroupedTasksTable, FlatTasksGrid, BlockCard, BlockDetailDialog, DrawingRow, useTakeTask}`;
  `features/task-timer/{officialTimer.ts, useOfficialTimer.ts, TaskTimerControl.tsx, OfficialTimerDaysCard.tsx}`; `features/tasks/MyTasksPage.tsx`;
  `features/leaderboard/components/MyScoreSection.tsx` (сөрөг оноо «−», улаан); `features/deadlines/{api,index,types}.ts` (дэд хугацааны hook/төрөл хасав);
  `shared/i18n/{mn,en}.json` (+163 түлхүүр тус бүр, BOM + CRLF хэвээр).
* **Устгасан:** `projects/detail/TaskSplitDialog.tsx`, `projects/detail/taskSplit.ts`, `deadlines/SubDeadlineEditor.tsx`.

## 6. API (бүгд `/api/tasks`, ажилтны үүрэг: admin|senior|engineer|architect)

Бүх тоо БҮТЭН НЭГЖ (1% = 10 000). Бичих бүр `request_id` (8–80, `[A-Za-z0-9._:-]`) + `expected_revision`.
`409 STALE_REVISION` → `{current: RootView}`; ижил `request_id` → `replayed:true`.

| Метод, зам | Хэрэг |
|---|---|
| `GET /allocation-candidates` | ирээдүйн ажил эзэлж болох ажилтнууд |
| `GET /contributors?project_id=` | төслийн таск бүрийн хувь нэмэрч + `people` (хүн×албан цаг) + `managed` тойм + `server_now`/`lunch` |
| `GET /:id/allocation` | `managed`, `root`, `preview` (seed-ийн урьдчилсан), `me`, `allowed` |
| `GET /:id/allocation/records` | миний хүчинтэй хэсгүүд (`slices`) + сэргээж болох залруулгууд (`corrections`) |
| `POST /:id/allocation/split` | `{mode, targets:[{user_id,target_units}]}` — ЭЦСИЙН зорилтууд (сервер инвариант л шалгана) |
| `POST /:id/allocation/progress` | `{done_units (абсолют), notes?, attachments?, image_url?, completion_qa?, owner_user_id?(admin)}` |
| `POST /:id/allocation/release` | `{to_user_id?}` |
| `POST /:id/allocation/retake` | `{units?}` |
| `POST /:id/allocation/correct` | `{items:[{slice_id, units?}], owner_user_id?(admin)}` |
| `POST /:id/allocation/restore` | `{correction_request_id, completion_qa?}` |
| `POST /api/task-timer/sessions/:id/void` · `/restore` | өөрийн сэшн (явж буйг эхлээд зогсооно) |
| `POST /api/task-timer/start` | managed: олон хүн зэрэг; ирээдүйн ажилгүй → `409 NOT_ALLOCATED {allocation:{available_units,my_done_units,released_units,has_row}}` |
| `GET /api/task-timer/users/:id/days` | сэшн бүр `voided` тугтай, `official_ms`-д тоологдохгүй |
| `DELETE /api/tasks/:id` (ба component/drawing/block) | түүхтэй managed root → `409 ROOT_PROTECTED {task_ids}` |
| хуучин `POST /api/progress` | managed таскт `409 MANAGED_ROOT` |
| хуучин `POST /api/tasks/:id/split` | БҮХ таскт `410 SPLIT_RETIRED` (хуулбар үүсгэх урсгал хасагдсан; кэштэй хуучин клиентэд ойлгомжтой алдаа, юу ч бичигдэхгүй) |
| таскийн дэд хугацаа: `POST /api/deadlines/tasks/:id`, `PUT /api/deadlines/:id`, `PATCH /api/deadlines/:id/done`, `DELETE /api/deadlines/:id` | `410 SUB_DEADLINE_RETIRED`; `GET /deadlines/tasks/:id` (бүх түүх) хэвээр, `can_edit` үргэлж false; нээлттэй мөр «Удахгүй»/хуанли/төслийн «Хугацаа»-д гарахгүй; `/deadlines/milestones/*` ХЭВЭЭР |

Алдааны кодууд: `STALE_REVISION, TAKE_REQUIRED, BELOW_FLOOR, OVER_TARGET, NO_ALLOCATION, NOT_PARTICIPANT, NOT_OWNER,
USER_NOT_ELIGIBLE, SUM_MISMATCH, BELOW_DONE, PRECISION, DUPLICATE_USER, TOO_MANY, NOT_SPLITTABLE, HOURS_MODE,
PROJECT_INACTIVE, TASK_COMPLETED, completion_qa required {questions,missing,scopes}, LEDGER_MISMATCH, SLICE_NOT_FOUND,
BAD_UNITS, NOTHING_TO_RESTORE, RESTORE_OVER_TARGET, RESTORE_OVER_ROOT, SLACK_CONSUMED, NOTHING_FREE/BAD_VALUE (retake)`.

## 7. Явц (чеклист) — ШИНЭЧЛЭХ

- [x] Аудит (5 уншигч) — §4
- [x] Цэвэр цөм: units, allocation, credit, seed (тест 93)
- [x] Migration 0376–0380
- [x] Store + мутацууд (split/progress/release/retake/correct/restore) + бодит SQLite тест (41)
- [x] Routes (14 тест) + устгалын хамгаалалт + recalc хамгаалалт + managed татгалзалт
- [x] Таймер: allocation-aware авах, void/restore, `notVoidSql`, contributors/time endpoint
- [x] Дэд хугацааны БИЧИХ замууд 410 (таскийн checkpoint)
- [x] Backend `npm test`: 2566 тест, 2563 ✓, 3 ✗ (урьд нь мэдэгдэж байсан: миграцын дугаар давхардал, 0214/0245 statement, templateNote) —
  шинэ алдаа ҮГҮЙ; `tsc --noEmit` цэвэр (§10)
- [x] Frontend: units twin, own-progress control + 5 сек queue, засварлагч dialog, contributors/цаг, нэр (Б.Бат), жин нуух, дугаар (17.1),
  дэд хугацааны UI хасах, i18n (mn+en), My Tasks, task row, QA, буцаах/дахин авах, бүртгэл/сэргээх
- [x] Хуучин `POST /api/tasks/:id/split` ТЭТГЭСЭН (бүх таскт 410) + тест шинэчилсэн; таскийн дэд хугацааны бичих замууд 410 + тест
- [x] Verify (frontend `npm run verify` exit 0) + бодит-браузер E2E 106/106 + визуал (desktop 1440, mobile 390)
- [x] Contributors endpoint-ын D1 зардал: `up.project_id` predicate, `idx_tts_task` (0380), polling 10 → 30 сек
- [x] CLAUDE.md товч тэмдэглэл («Таскийн ХУВААРИЛАЛТ» хэсэг + хуучин «Таск хуваах»/«Таск авах» хэсэгт ⚠️ мөр)
- [ ] **Deploy · прод миграц · ROOT-бүлэгтэй (0372/0373) нэгтгэл — ЭЗНИЙ ШИЙДВЭР, §11**

## 8. Мэдэгдэж буй үлдэгдэл / шийдвэр хэрэгтэй

* ~~Managed credit-ийн жин өөрчлөлтийн дараах дахин тооцоо БАЙХГҮЙ.~~ **2026-10-05-нд хэрэгжсэн** — §13.6 (`lib/taskCreditReweight.ts`,
  `PUT /tasks/:id` жин засахад автомат, админы preview/apply).  `recalculateProjectPoints` managed таскийн оноог хэвээр ХӨНДӨХГҮЙ.
* **COUNT(*) / `award_count` уншигчид** (leaderboard, reports) буцаалтын мөрийг нэмж тоолно (SUM нь цэвэр). `/me recent`
  буцаалтыг «+-0.35%» гэж харуулдаг байсан — frontend тэмдэг ЗАСАГДСАН (`MyScoreSection.tsx`: «−0.35%», улаан).
* Эргэлзээтэй seed (`seed_attribution='uncertain'`): хүчинтэй хийсэн нь эзэнгүй (B) — ажилтан засаж чадахгүй; зөвхөн
  удирдлагын тусгай урсгал (хараахан БАЙХГҮЙ).
* ~~Хуучин хуваалтын бүлгийг managed болгох converter ХИЙГДЭЭГҮЙ.~~ **2026-10-05-нд хэрэгжсэн** — §13.5 (preview + apply + revert + журнал, migration 0385).
  ⚠️ Прод дээр `94df1fc1`-ийн `task_groups` бүлэг, хуулбар «(i/N)» таскууд аль хэдийн байж болно — §11 ⛔ ба §13.5-ийн «production schema» саадыг үз.
* `GET /projects/:id` бүх `weight_percent`-ийг бүх ролид буцаасаар (UI л нууна).
* Revit add-in: managed таск дээр хувь илгээвэл 409 `MANAGED_ROOT`, нэгтгэгдсэн хэсэгт 409 `CONVERTED_PART` (вэбээс бөглөнө) — §13.7.

## 9. Эзнээс асуух (ямар ч бол ажил зогсоохгүй — миний сонголт тус бүрд бичив)

1. «Дэд хугацаа»: хоёр өөр боломж ижил нэртэй — (A) таскийн checkpoint (`task_deadlines`) ба (B) milestone-ийн дэд хугацаа
   (`project_milestones.parent_id`, admin+senior). **A-г бүрэн хаасан, B хэвээр** («milestone хэвээр» гэснийг ёсоор).
2. Ажилтны жин: «Зураг %/Төсөлд %» багана **admin/senior-д** хэвээр, engineer/architect-аас нуусан.
3. Бүх үлдсэн ажил хэн нэгэнд хуваарилагдсан, тэр хүн ажиллахгүй байвал ХЭН Ч авч чадахгүй (зөвхөн тэр хүн/senior/admin
   «буцаах/шилжүүлэх» эсвэл хуваалтыг засна) — «pause = хуваарилалт хэвээр» дүрмийн шууд үр дагавар.
4. Managed таск дээр хуучин `POST /progress` (Revit add-in, хуучин хуудас) → 409 `MANAGED_ROOT`.
5. **ROOT бүлэг (`task_groups`, 0372) vs энэ загвар** — §11 ⛔: аль нь үлдэх вэ? Миний санал: энэ загвар (нэг root + хуваарилалт) ҮЛДЭНЭ, `task_groups`
   нь зөвхөн ХАРАГДАЦЫН бүлэглэлт болж хадгалагдах эсвэл хуучин физик хуваалтыг хөрвүүлж татагдана.  Шийдвэргүй бол deploy хийхгүй.
6. `POST /api/leaderboard/recalc-all`-г ажиллуулах уу? Энэ release-д ХЭРЭГГҮЙ (lazy seed, шинэ оноо үгүй).  Ажиллуулбал managed мөр хамгаалагдсан, хуучин
   таскууд CLAUDE.md-ийн «хамгийн өндөр хувь» (HWM) дүрмээр дахин бодогдоно — глобал дахин бодолт тул ЭЗНИЙ тусдаа зөвшөөрөл.
7. Админ жин/complexity засахад managed таскийн оноо дахин бодогдох ёстой юу? Одоо хуучин жингээр хэвээр (§8) — журналаас дахин бодох нь ирээдүйн ажил.
8. Эргэлзээтэй seed-ийн эзэнгүй (B) хэсгийг менежер хэрхэн хэнд оноох вэ? Одоо зөвхөн эзэнгүй үлдэнэ — тусгай урсгал хэрэгтэй юу?
9. Revit add-in: managed таск дээр хувь илгээхэд 409 `MANAGED_ROOT` — add-in-д `allocation/progress` дэмжлэг нэмэх үү, эсвэл вэбээс л бөглөх үү?

## 10. Шалгасан зүйл — ажиллуулсан / ажиллуулаагүй

**Ажиллуулсан (2026-10-02, бодит гаралтаар):**

| Шалгалт | Үр дүн |
|---|---|
| backend `npx tsc --noEmit` | цэвэр |
| backend `npm test` (`node --test "src/**/*.test.ts"`) | 2566 тест · 2563 ✓ · **3 ✗ — бүгд урьд нь мэдэгдэж байсан, энэ ажлын файлыг хөндөөгүй** (доор) |
| шинэ/өөрчилсөн backend suite | taskUnits 19 · taskAllocation 46 · taskCredit 15 · taskSeed 13 · taskRootOps 41 (бодит SQLite + бодит миграц) · routes/taskAllocations 14 · taskSplit 3 · taskTake 13 · taskTimer 18 · myTaskList 6 · deadlinesRetired 4 — бүгд ✓ |
| frontend `npm run verify` | exit 0: `tsc -b --force`, contrast, quote-notes, …, `check:task-units` (48 шалгалт, i18n 163 түлхүүр mn=en), vite build |
| frontend eslint (миний шинэ файлууд) | `features/task-allocation/`, `shared/lib/staffName.ts`: 0 олдвор (өөрчилсөн файлуудын үлдсэн олдвор нь өмнөх: `FlatTasksGrid` static-components, `FlatTaskRow` `_showDiscipline`, `MyTasksPage` exhaustive-deps) |
| headless-Chrome E2E (CDP, хамааралгүй) — бодит Hono router + бодит миграц (harness SQLite) + vite-ээр бодит frontend | project 33/33 · editor 24/24 · My Tasks 32/32 · edge 17/17 = **106/106** (§12) |
| визуал | desktop 1440 + mobile 390 дэлгэцийн зургийг шалгав: төслийн мөр, засварлагч, My Tasks, QA, бүртгэл цонх |
| D1 зардал (`EXPLAIN QUERY PLAN`) | contributors: `user_points` — `up.project_id = ?1`-ийн дараа прод индекс `idx_user_points_project`-оор SEARCH (өмнө бүтэн SCAN); `task_timer_sessions` — covering `idx_tts_task (task_id=?)` |

**3 уналт — урьд нь байсан**: НЭМЭЛТ ЗАСВАРГҮЙ цэвэр baseline `3f0350f6` checkout (түр git worktree, шалгаад устгасан) дээр `migrationSchema.test.ts` + `revitNoteAi.test.ts`-ийг ажиллуулахад ЯГ ИЖИЛ 3 тест унасан.  Миний 0376–0380 хоёр миграцын тестийн алдааны жагсаалтад ороогүй:
1. `миграц бүр D1-ийн ТЭЭВРИЙН ДҮРМИЙГ дагана` — `0214_assistant_review.sql`, `0245_document_folders.sql` 10 statement (>9).
2. `миграцын дугаар давхардвал ЗӨВХӨН мэдэгдэж буй түүхэн жагсаалтад байна` — 0200 / 0243 / 0244 / 0245 давхардал.
3. `templateNote: бүх баримтыг агуулсан монгол өгүүлбэр` (`lib/revitNoteAi.test.ts`).

**Ажиллуулаагүй / баталгаажаагүй (нууж болохгүй):**
* Бодит Cloudflare D1 / Workers дээр юу ч ажиллуулаагүй. Harness = `node:sqlite` + D1 shim; `db.batch`-ийн атомар байдлыг SQLite транзакцаар дуурайсан —
  бодит D1-ийн batch, 100-bind / statement-урт хязгаар, `rows_read` тоолуур энд баталгаажаагүй.
* `wrangler deploy`, `d1 migrations apply --remote`, прод backfill, `recalc-all`, commit, push — **юу ч хийгээгүй**.
* Revit add-in-тэй (`409 MANAGED_ROOT`-ийн зан) туршаагүй; Safari / Firefox / бодит утас туршаагүй (Chrome headless: 1440 ба 390px).
* Олон isolate дахь жинхэнэ зэрэгцээ ачаалал: CAS-ийг дараалсан/хуучирсан revision ба unit тестийн хоёр actor-оор шалгасан; ачааллын тест хийгээгүй.
* D1 зардлыг EXPLAIN-аар л үнэлсэн — прод хэмжээний өгөгдөл дээр хэмжээгүй.
* `npm run lint`-ийн бүтэн ажиллуулалт (өмнөх ~139 react-hooks алдаатай) — зөвхөн миний файлуудыг шалгасан.

## 11. Deploy / сэргээх runbook — ⚠️ ХИЙГДЭЭГҮЙ, зөвхөн төлөвлөгөө (эзний тусдаа зөвшөөрөл хэрэгтэй)

### 0. ⛔ Deploy-ийн саад (эхлээд шийд)

CLAUDE.md-д бичигдсэн ба git-ээс (прод-той шууд тулгаагүй — deploy-ийн өмнө `wrangler deployments list`, `pages deployment list`-ээр ШИНЭЭР баталгаажуул):
прод нь **main-д ОРООГҮЙ** commit-уудыг ажиллуулж байна:

| Commit | Агуулга | Хаана |
|---|---|---|
| `94df1fc1` | «ROOT бүлэг + дэд таск»: migration `0372_task_groups.sql` (`task_groups`, `tasks.group_id`, `idx_tts_project_task`), `/split` хуулбар таск үүсгэж бүлэглэнэ, Start/Stop, `NOT_YOUR_TEAM`, rename | `deploy/live-2026-10-01-task-groups` |
| `e1d55087` | «нэр – цаг» жагсаалт, migration `0373_task_timer_task_index.sql` (`idx_tts_task (task_id, user_id)`) | дээрхтэй ижил, мөн `deploy/live-2026-10-02-revit-license` (`e264ba75`, прод worker `ed830b02`) |
| `24469ac3`, `fdf12a6d` | «нэр – цаг»-ыг inline болгох, «Дэд хугацаа»-ны мөрөнд зөөх (frontend; прод Pages `fdf12a6d`) | `deploy/live-2026-10-01-task-groups` |

Үр дагавар:
1. **Main (+ энэ ажил)-аас шууд worker/Pages deploy хийвэл «newest deploy wins» — дээрх код ПРОДООС БУЦНА** (CLAUDE.md-д тэмдэглэсэн 2026-08-12-ны явдалтай ижил).
   `task_groups` / `tasks.group_id` өгөгдөл D1-д үлдэх боловч main-ийн код үүнийг мэдэхгүй.
2. **Ойлголтын зөрчил:** тэдний `/split` = хуулбар таск үүсгээд `group_id`-аар бүлэглэнэ; энэ ажил = нэг root + хуваарилалт, `/split` 410. Эзний 2026.10.02 дүрэм
   (duplicate БИШ) тэднийг орлоно — гэвч **прод дээр аль хэдийн үүссэн бүлэг/хуулбар таскуудыг хөрвүүлэх converter БАЙХГҮЙ** (§8).
3. **Файлын давхцал** (миний working tree ∩ `fdf12a6d`): `FlatTaskRow.tsx`, `FlatTasksGrid.tsx`, `GroupedTaskRow.tsx`, `GroupedTasksHeader.tsx`, `TaskLiveCell.tsx` (+ CLAUDE.md).
   `94df1fc1` нь мөн `routes/tasks.ts`, `lib/taskTakeService.ts`, `lib/taskTimerStore.ts`, `lib/taskTake.ts`, `routes/taskTimer.ts`, `routes/progress.ts`, `routes/projects.ts`,
   `TaskSplitDialog.tsx` (миний ажил УСТГАСАН), `useTakeTask.ts`, `taskLive.tsx`, `GroupedTasksTable.tsx`, `useProjectTasks.ts`, `types.ts`-ийг хөндсөн — гар merge хэрэгтэй.
   `taskWorkTime.ts`, `WorkPeopleList.tsx`, `TaskGroupHeaderRow.tsx` нь main-д байхгүй (миний `ContributorsList` нь «нэр – цаг»-ыг шинэ загвараар хангана).
4. Миграцын дугаар: main-д 0372/0373 файл БАЙХГҮЙ (прод-д хэрэгжсэн байж болно). Миний 0376–0380 тэдэнтэй мөргөлдөхгүй; 0380 нь 0373-тай ижил индекс (§3).

**Шийдэх хүн — эзэн.** Сонголтууд: (A) `94df1fc1`/`e1d55087`/`24469ac3`/`fdf12a6d`-ийг main-д оруулж, энэ ажлыг тэр дээр rebase хийх; (B) энэ ажлыг ТЭДНИЙ суурь
(`e264ba75` / live) дээр overlay хийж deploy хийх; (C) тэднийг орхих (бүлэглэлт, Start/Stop, rename алга болно).  Миний санал: (B) — live дээр overlay, `task_groups`-ийг
харагдацын бүлэглэлт болгон хадгалах эсэхийг эзэн шийдэнэ.  Үүнийг шийдэхгүй бол **deploy хийхгүй**.

### 1. Deploy-ийн өмнө (зөвхөн уншина)

```
cd backend
npx tsc --noEmit                                  # wrangler deploy typecheck хийдэггүй
npx wrangler deployments list --config wrangler.toml          # ТУСАД НЬ унш — peer-тэй «ping-pong»-оос сэргийлнэ
npx wrangler d1 migrations list mgl-progress-db-v3 --remote --config wrangler.toml
npx wrangler d1 time-travel info mgl-progress-db-v3 --config wrangler.toml   # bookmark-ыг тэмдэглэ (D1 сэргээх цэг)
```
* Цэвэр worktree-ээс deploy хий (бусад агентын дутуу өөрчлөлт орохгүй); суурь = ПРОД-д ажиллаж буй commit (§0).
* Өмнөх тоог аваад хадгал (дараа нь харьцуулна): `SELECT COUNT(*) FROM tasks`, `SELECT COUNT(*), SUM(amount) FROM user_points`, `SELECT COUNT(*) FROM progress_entries`.

### 2. Дараалал (хатуу)

1. **D1 миграц ЭХЛЭЭД:** `npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml` — 0376 → 0377 → 0378 → 0379 → 0380.
   Бүгд нэмэлт (`CREATE TABLE/INDEX IF NOT EXISTS`, `ALTER TABLE ADD COLUMN`; users/projects-ийн rebuild БИШ); файл бүр ≤9 statement, `/* */` ба мөр доторх `;` байхгүй
   (repo-ийн «ТЭЭВРИЙН ДҮРЭМ» тест 0376–0380-д алдаа өгөөгүй).  `d1 execute --file` bypass БҮҮ ашигла.  Дараа нь `d1 migrations list --remote` — хүлээгдэж буй 0 байх ёстой.
   Шалга: `SELECT name FROM sqlite_master WHERE name IN ('task_roots','task_allocations','task_contributions','task_ops','task_timer_voids')` — 5 мөр;
   `PRAGMA table_info(user_points)` — `contribution_id`, `reverses_points_id`, `recorded_at`; `PRAGMA table_info(projects)` — `auto_archived_at`.
2. **Worker:** `npx wrangler deploy --config wrangler.toml` (эзний 2026-09-28-ны шийдвэр: 100% нэг дор; `NODE_OPTIONS=--dns-result-order=ipv4first`; сүлжээ тасалдвал дахин оролд).
   ⚠️ Worker миграцаас ӨМНӨ гарвал `/progress/my-tasks`, `/tasks/contributors` зэрэг шинэ хүснэгт/баганыг уншаад 500 өгнө.
3. **Pages ШУУД дараа нь:** `cd ../frontend && npm run verify && npx -y wrangler@latest pages deploy dist --project-name mgl-design-system --branch main`, дараа нь
   local `dist/index.html`-ийн hash-ийг `https://mgl-design-system.pages.dev/`-тэй тулга, `pages deployment list`-ийн дээд мөр = таны commit эсэхийг шалга.
   Worker-ийн дараа Pages хоцорвол хуучин frontend `POST /tasks/:id/split` дуудаад 410 авна («хуваах» ажиллахгүй) — ашиглагчид эвдрэхгүй, гэхдээ хуваах боломжгүй.

### 3. Deploy-ийн дараах шалгалт (эхлээд зөвхөн уншилт)

* `GET /api/tasks/contributors?project_id=<id>` → 200; `GET /api/tasks/<хуучин таск>/allocation` → `managed:false` + `preview` (юу ч бичигдэхгүй);
  engineer-ээр «Миний ажлууд» ачаалагдах; `wrangler tail`-д `[d1]` мөр: contributors хүсэлтийн `rows_read` бага байх.
* Дараа нь ЭЗНИЙ ЗӨВШӨӨРСӨН НЭГ бичилт — туршилтын төсөл дээр хуваах → хувь оруулах → буцаах → сэргээх.  Бодит төсөл дээр эхлээд биш.
* Ажиглах: `STALE_REVISION`-ийн давтамж, `LEDGER_MISMATCH` (инвариант зөрчил — 500 шиг), `NOT_ALLOCATED` (хэрэглэгч андуурч байна уу).

### 4. Сэргээх (rollback) — ⚠️ feature flag БАЙХГҮЙ

* Схем нэмэлт тул worker/Pages-ийг өмнөх хувилбар руу буцаахад **схем талаас аюулгүй**.
* **ГЭХДЭЭ ямар нэг таск managed болсны ДАРАА хуучин код руу буцаавал:** хуучин код `source='alloc'` мөрийг ердийн явц гэж уншина; хуучин `/split` managed root-оос хуулбар
  үүсгэж болно; `DELETE /tasks/:id`-ийн хамгаалалт алга; **`recalculateProjectPoints` managed `source='progress'` оноог УСТГАНА**.  Тиймээс «буцаах цонх» = эхний
  managed хуваалтаас ӨМНӨ.  Дараа нь зөвхөн урагш засвар (forward fix) эсвэл эзний батлсан өгөгдлийн төлөвлөгөө.
* Эхний бодит хэрэглээг туршилтын төсөл дээр, эзнийг байлцуулж хий.

### 5. Прод өгөгдөл

* **Backfill ХЭРЭГГҮЙ.** Хуучин таск анх хуваагдахад л lazy seed (`task_roots`-д хуучин түүх, **шинэ оноо үгүй**).  Глобал `recalc-all` энэ release-д ороогүй (§9.6).
* Устгал, цэвэрлэгээ байхгүй; `task_*` хүснэгтүүд нэмэлт.

## 12. E2E-г давтах (сессийн scratchpad — репод БИШ)

Скриптүүд репод ороогүй (abs зам, харness нь `backend/src` router-уудыг импортолно); энэ нь CLAUDE.md-ийн бусад harness-ийн жишиг.  Дахин байгуулах бол:
1. **Сервер:** Node нэг процесс — `backend/test-support/allocHarness.ts`-ийн `makeDb()` (бодит миграц: 0361, 0368, 0370, 0376–0380) дээр бодит `routes/{taskAllocations,tasks,progress,taskTimer,projects,users…}`
   router-уудыг Hono-д mount хийж, `Authorization: Bearer u<id>` → `{sub:id, role}` middleware + `POST /__sql` (туршилтын SELECT/INSERT) нээнэ; порт 3188.
2. **Frontend:** `VITE_API_HOST=http://127.0.0.1:3188 npx vite --port 5199 --strictPort` (`apiHost.ts` нь loopback host-ыг ЗӨВХӨН loopback origin дээр хүндэтгэнэ), нэвтрэлт: `localStorage.auth_token = 'u3'` + `i18n_lang = 'mn'`.
3. **Хөтөч:** Chrome headless + CDP (`--remote-debugging-port`, сангүй WebSocket клиент); товшилт нь бодит `Input.dispatchMouseEvent` (isTrusted), ХАРАГДАХ (хэмжээтэй) элементээс.
4. **Хамарсан шалгалтууд (106):** хуваалт 40/60 · хийсэн ажилтай 90/5/5 · − / + 10%/1% · тоо бичих (5 орон, давсан) · «Үлдсэн ажлаа дуусгах» + QA (хоёр хүрээ) · 5 сек autosave,
   «Одоо хадгалах / Буцаах» · STALE автомат дахин · SPA-аар гарахад flush · 5 дарсан → НЭГ бичлэг · буцаах / дахин авах (`NOT_ALLOCATED`) · бүртгэл хүчингүй болгох / сэргээх (оноо −/+) ·
   цагийн сэшн void/restore · хувь нэмэрч (1.1 / 1.2 дугаар, засварын цаг тусдаа, bookmark нотолгоо биш) · жин нуух (engineer) / харуулах (admin) · консолын алдаа 0.
5. **Анхаарах зарим урхи:** headless-д ноорог (dirty) үед бүтэн хуудас навигаци `beforeunload` цонх гаргаж гацаана — хадгалагдтал (≥6.5 сек) хүлээ; `lg:hidden` давхар DOM-той тул
   товшихдоо харагдах элементийг сонго; Windows дээр Chrome-ын debug порт давхцахгүйг шалга (өөр агентын Chrome-ыг БҮҮ зогсоо).


## 13. Production-hardening pass (2026-10-05) — гол өөрчлөлт, шалгалт, runbook

> Салбар `claude/mgl-erp-task-allocation-prod-7s8clf`.  **Deploy · прод миграц · staging D1 · Worker provenance ХИЙГДЭЭГҮЙ** (доорх «Хаагдсан хаалга»).
> Энэ хэсэг §2–§12-ыг ОРЛОХГҮЙ — тэдгээрийн дээр нэмэгдсэн зүйлс.  Дүрмийн хүснэгт, өгөгдлийн загвар, UI-ийн үндсэн урсгал хэвээр.

### 13.1 Хаагдсан хаалга (нууж болохгүй)

| Хаалга | Төлөв | Яагаад / яаж хаах |
|---|---|---|
| **Staging D1 дээр 0383 / 0384 / 0385 шалгах** | **NOT RUN** | Cloudflare эрх энэ сессэд байхгүй (репод шигтгэсэн токеныг ЗОРИУДААР ашиглаагүй — CLAUDE.md «Security posture» #1).  Локал `node:sqlite` шалгалт (§13.3) нь staging-ийг ОРЛОХГҮЙ.  Хаах: §13.9 алхам 1. |
| **Worker deployment provenance** | **NOT RUN** | Прод worker аль commit-оос гарсныг `wrangler deployments list` + `workers/scripts/<name>/content/v2`-оос маркер тулгаж батлах эрх байхгүй.  Хаах: §13.9 алхам 0. |
| **Прод `task_groups` (0372) схем** | **НЭЭЛТТЭЙ** | `94df1fc1`-ийн код энэ салбарт ороогүй (§11 ⛔).  Хөрвүүлэлт нь `tasks.group_id` баганыг ИЛРҮҮЛЖ (`PRAGMA table_info`) байвал л «зарласан бүлэг» (proven_split) санал болгоно; үгүй бол ЗӨВХӨН нэр/гараар (ambiguous, ил баталгаа).  Прод-ын бодит өгөгдөл дээр хөрвүүлэлтийн preview-г ХЭЗЭЭ Ч ажиллуулаагүй. |
| **Revit add-in C# өөрчлөлт** | **КОМПАЙЛГҮЙ** | Энэ орчинд `dotnet` байхгүй: `CONVERTED_PART` боловсруулалт (2 жижиг мөр) компайл, Revit-д ачаалалгүй.  Сервер тал тестлэгдсэн (§13.7). |
| **Employee-ийн мөрийн түгжээ (paused) browser** | **ТУРШААГҮЙ** | `OwnProgressControl`/`ManagedRowActions`-ийн `gate.writable` түгжээ — логик нь 3 мөр, store нь `check:task-alloc-admin`-аар шалгагдсан; бодит хуудас дээр mock-оор хараахан давтаагүй. |

**Вердикт: NOT PRODUCTION-READY** — дээрх хаалгууд хаагдтал.  Код, тест, баримт талаас «approval-д бэлэн» (§13.8-ийн тоо).

### 13.2 Идэвхжүүлэлтийн хаалга (migration 0384)

* `app_settings['task_alloc.state']` = `disabled | enabled | paused`.  Мөр байхгүй / буруу утга = **paused** (fail-safe, `lib/taskAllocGate.ts`).
  0384 нь анхны утгыг бичнэ: managed root аль хэдийн байвал `paused`, үгүй бол `disabled`.  Төлөв солилт бүр `task_alloc_state_log`-д (хэн, хэзээ, яагаад, гэрээ).
* **Клиентийн гэрээ** `X-Task-Alloc-Contract` (одоо `1`, `TASK_ALLOC_CONTRACT`; frontend `shared/api/taskAllocContract.ts` ИХЭР — `check:task-alloc-admin` тулгана).
  `apiFetch` толгойг **ЗӨВХӨН managed мутацид** явуулна (`needsAllocContractHeader`: POST/PUT/PATCH/DELETE `/tasks/:id/allocation…`, `/tasks/:id/claim`, `/tasks/alloc-admin/…`, `/task-timer/…`).
  ⚠️ БҮХ хүсэлтэд явуулбал cross-origin preflight дээр хуучин Worker-ийн CORS жагсаалтад байхгүй толгойгоор **апп бүхэлдээ** унана (шинэ Pages + хуучин Worker: rollback, deploy-ийн завсар) — ревьюгээр илэрч зассан.
  Үлдсэн эрсдэл: Worker-ийг ТҮРГЭН буцаавал (Pages биш) timer start / claim / allocation / alloc-admin бичилт preflight-д унана → Worker rollback-ийг Pages-тэй ХАМТ хий (§13.9).  Шийдвэр (`decideManagedWrite`, цэвэр): толгойгүй / буруу / хуучин → **426** `CONTRACT_UPGRADE_REQUIRED` (+ `Upgrade: MGL-Task-Alloc/1`,
  `no-store`); клиент сервер-ээс ШИНЭ → 426 `direction: server_older`; төлөв `disabled`/`paused`/тохируулаагүй → **423** `TASK_ALLOC_DISABLED|PAUSED|UNCONFIGURED`.  426 нь ҮРГЭЛЖ 423-аас түрүүнд.
* Хаалга ЗӨВХӨН managed мутацид: allocation ×6 (split, progress, release, retake, correct, restore), managed таск дээр timer start / claim / сэшн void-restore, нэгтгэгдсэн хэсэг (409 `CONVERTED_PART`, төлвөөс үл хамаарна).
  Managed БИШ таск хуучнаараа.  `admin` ч энгийн managed мутацид адил хаагдана (paused нь админыг хүртэл зогсооно); төлөв солих `PUT /api/tasks/alloc-admin/state` хаалганаас ЧӨЛӨӨТЭЙ.
* Хариу бүрд `X-Task-Alloc-Contract`, `X-Task-Alloc-State`, `X-Request-Id` (клиентийнх `[A-Za-z0-9._-]{8,64}` бол хэвээр, үгүй бол UUID).  CORS аль хэдийн зөвшөөрч/ил гаргана.
* Бүтэцтэй лог `lib/taskAllocLog.ts` — `wrangler tail`-д НЭГ JSON мөр: `evt` (op | gate_block | state_change | conversion | reweight | audit | post_commit), `correlation_id`, `task_id`, `actor_id`, `rev_before/after`,
  `request_id`, `result`, `code`, `status`, `ms`.  Зөвхөн ИДЕНТИФАЙЕР (нэр, тайлбар, асуултын хариулт, токен ЗОРИУД орохгүй — `sanitizeLogFields` цагаан жагсаалт).
* **Frontend:** 426/423 → `TaskAllocGateBanner` (Layout-д): хуучирсан хуудас → «Шинэчлэх» (SW шинэчлэл + дахин ачаалал), түр түгжээ → тайлбар; `OwnProgressControl`, `ManagedRowActions` түгжигдэнэ.
  Хариуны толгойноос төлөв `enabled` болмогц түр түгжээ автоматаар арилна (426 баннер хэвээр).  `SW_VERSION = 2026-10-05.1`.

### 13.3 Миграц 0383 / 0384 / 0385 (0376, 0377 ХЭЗЭЭ Ч засагдаагүй)

| Файл | Агуулга |
|---|---|
| `0383_task_alloc_hardening.sql` | `task_ops` + `request_hash` (ижил `request_id` өөр агуулгатай → 409 `REQUEST_REUSED`), `post_json`, `post_attempts`, `post_error`; `idx_task_ops_post` (partial); `task_credit_adjustments` (жингийн дараах оноо тулгалтын нөхөн мөр, `UNIQUE (run_id, contribution_id)`); `idx_task_contrib_ref`. |
| `0384_task_alloc_gate.sql` | `task_alloc_state_log` + анхны төлөв (§13.2). |
| `0385_task_conversions.sql` | `task_conversions`, `task_conversion_members` (§13.5). |

**0382** нь өөр салбарт (`0382_guardian_audit_runs.sql`) нөөцлөгдсөн — энд ашиглаагүй, дахин ашиглахгүй.  Бүгд нэмэлт (`ADD COLUMN`, `CREATE … IF NOT EXISTS`), users/projects/task_* rebuild БИШ, ≤9 statement, `/* */`-гүй.
**Локал шалгалт** `lib/taskAllocMigrations.test.ts` (9): clean суулгалт (БҮХ миграц) ↔ upgrade (прод-ын одоогийн төлөв 0376–0380 + өгөгдөл → 0383 → 0384 → 0385) — хуучин өгөгдөл байт-ижил, шинэ баганы анхны утга,
0384 `paused`/`disabled` сонголт, дахин ажиллуулахад админы төлөв дарагдахгүй, **clean ↔ upgrade схемийн хурууны хээ тэнцүү** (10 хүснэгт), тээврийн дүрэм, 0385-гүй орчинд `retiredIntoRoot` унахгүй.
⚠️ **Холбоо:** одоо хуучин «Миний ажлууд», `/progress` (`POST /progress`, `/bulk`, Revit submit — managed БИШ таск ч), `users/monthly-stats`, төслийн шатлал, Revit work-context, MCP `list_my_tasks` нь `task_conversion_members`-ийг уншина →
**0385 worker-ээс ӨМНӨ** (`d1 migrations apply` → worker → Pages).  Worker түрүүлбэл эдгээр **500** (ревьюгээр `POST /progress` ч унахыг батлав).  Зөвхөн `retiredIntoRoot` ба аудитор «хүснэгт байхгүй»-г тэсвэрлэнэ.
Deploy-ийн ӨМНӨ заавал: `SELECT name FROM sqlite_master WHERE name IN ('task_conversion_members','task_conversions','task_alloc_state_log')` → 3 мөр (`wrangler d1 execute --remote --command`).
Гэхдээ устгалын хамгаалалт (`protectedRootsIn`) 0385-аас ХАМААРАХГҮЙ болгов — хуваарилагдсан таскийн түүх миграцын дарааллаас үл хамааран cascade-аар устахгүй (ревьюгээр илэрсэн fail-open, зассан).

### 13.4 Идемпотент, нэг ёсны мутаци

* `task_ops` marker мөр = идемпотент + CAS + түүх: `request_id` ижил + агуулга ижил → анхны үр дүн (`replayed`), агуулга өөр → 409 `REQUEST_REUSED`.  Commit-ийн дараах үр дагавар (архив, AI хураангуй,
  snapshot, засварын цаг) `post_status: pending → done`, алдаа → `post_attempts`/`post_error`, аудитор `POST_COMMIT_FAILED/STUCK` харуулна.
* Эзнээ тодорхойгүй хуучин хийсэн нь **B**-д, хэзээ ч нэр зохиохгүй.  Бүтцийн үйлдэл (хуваах, буцаах, дахин авах) оноо ҮҮСГЭХГҮЙ (credit-neutral); оноо зөвхөн хувь оруулахад.

### 13.5 Хуучин бүлгийн хөрвүүлэлт (`lib/taskConversionPlan.ts` цэвэр · `lib/taskConversion.ts` D1 · `routes/taskAllocAdmin.ts`)

**Ангилал (нотолгооны түвшин; нэр/зэргэлдээ байрлал нотолгоо БИШ):** `already_managed` · `organizational` (нэгтгэх боломжгүй бүтэц: нэг гишүүн, өөр зураг, жингүй гишүүн, давхардал, >12 гишүүн) ·
`proven_split` (системийн бичсэн бүлэг `tasks.group_id` + бүтэц зөв) · `ambiguous` (зөвхөн нэрийн хэв маяг «(i/N)» эсвэл гараар — админ ИЛ баталгаа + шалтгаан).  Саад: төсөл идэвхгүй, цагийн горим, бүтцийн жин 0,
явж буй таймер, бүгд 100%.
**Загвар:** root = бүлгийн нэг таск, жин `W = Σ wⱼ`; бусад гишүүн «нэгтгэгдсэн хэсэг» (жин 0, due/start NULL, түүх хэвээр, бичилт 409 `CONVERTED_PART`).  Хэвийн болголт: `Tⱼ = 100·(wⱼ/W)` (хамгийн их үлдэгдлийн
арга, Σ ЯГ 100), `Dⱼ = Tⱼ·pⱼ/100` ⇒ root-ийн явц = `Σ wⱼpⱼ / W` — **төслийн явц ЯГ хэвээр** (`ROLLUP_DRIFT` хамгаалалт: хэвээр биш бол төлөвлөгөө бүтэлгүйтнэ).  Хийсэн хэсэг ЗӨВХӨН нотолгоотой хүнд
(тэр хэсгийн оноо авсан хүн); үгүй бол **B**; ирээдүйн ажил U нь менежерийн ИЛ заасан хүнд (`future_owners`), үгүй бол чөлөөт.  Шинэ оноо ҮҮСЭХГҮЙ — хуучин `user_points` мөр бүр seed слайс болж ЛАВЛАГДАНА.
Түүх: огноо бүрд «бүлгийн жигнэсэн явц»-ыг `alloc_adj` backfill мөрөөр root дээр бичнэ (явцын график өмнөхтэй ижил).
**API** (`/api/tasks/alloc-admin/…`, хаалганаас чөлөөтэй):
`GET conversion/candidates` (manager) · `POST conversion/preview` (manager, юу ч бичихгүй, `plan_hash`) · `POST conversion/apply` (**admin**; `request_id`, `plan_hash`, `reason`, `confirm_ambiguous`; PLAN_STALE бол preview-ээс хойш
өөрчлөгдсөн → дахин preview; REQUEST_REUSED; CONFIRMATION_REQUIRED) · `POST conversion/:id/revert` (**admin**; root дээр юу ч хийгдээгүй бол л — `REVERT_UNSAFE`: ажил/цаг/үйлдэл орсон) · `GET conversion/history`.
**Атом, дахин оролдох боломжтой:** apply нь НЭГ `db.batch` (marker, журнал, root, хуваарилалт, seed, backfill, retire); ижил `request_id` → анхны үр дүн; хагас хэрэгжсэн төлөв үүсэхгүй.
**Хамгаалалт:** root устгах (`ROOT_PROTECTED`, fail-closed), нэгтгэгдсэн хэсэг `PUT /tasks/:id`, `/baseline`, хуулбарлах, timer, `/progress` — бүгд хаалттай; «Миний ажлууд», төслийн хуудас, MCP `list_my_tasks`, `/users/monthly-stats`,
Revit work-context нэгтгэгдсэн хэсгийг зөв (хас/тэмдэглэ) боловсруулна.

**Production schema саад:** хөрвүүлэлт `tasks.group_id` баганыг `PRAGMA table_info`-оор ИЛРҮҮЛЖ ашиглана.  Энэ багана 0372-ийн (main-д ороогүй) бүтээгдэхүүн — прод-д бодит байгаа эсэх, бүлгийн утга зөв эсэхийг
**staging/прод-ын хуулбар дээр** `GET conversion/candidates`-ээр ЭХЛЭЭД харна.  Байхгүй бол «declared» ангилал хоосон, нэрийн хэв маягаар зөвхөн ил баталгаатай.

### 13.6 Оноо ба аудит

* **Жингийн дараах дахин тооцоо** (`lib/taskCreditReweight.ts`): `PUT /tasks/:id` жин засахад managed таскийн оноог ЖУРНАЛААС шинэ коэффициентээр тулгана — анхны мөрийг ХЭЗЭЭ Ч дарахгүй, нөхөн мөр
  `task_credit_adjustments` (анхны өдөр, анхны эзэн, `UNIQUE (run_id, contribution_id)`).  Админы `GET|POST credit/reweight` (preview/apply, task эсвэл project хүрээ).  Алдаа жин засварыг унагахгүй;
  аудитор `CREDIT_DRIFT` харуулна.  **`paused`/`disabled` үед автомат тулгалт (жин засах, recalc) юу ч бичихгүй** (`GATE_NOT_ENABLED`; «paused = бүх managed бичилт зогсоно») — админы тусгай `credit/reweight`
  (`force`) болон хаалтыг давсан мутацийн commit-ийн үр дагавар л ажиллана.  «Зөрсөн» босго `REWEIGHT_NOISE = 1e-4` (seed дугуйлалт ~1e-5 тул хөрвүүлсэн таск бүр «зөрсөн» болж шуугиан бичихгүй).  Төслийн структур өөрчлөхөд ч ижил зам: зургийн жин (`PUT /drawings/:id`) шууд `reconcileProjectCredit`; блокийн жин, багийн хувь, төслийн `complexity_pct` нь `recalculateProjectPoints` → `reconcileProjectCredit` (managed `source='progress'` мөрийг ХӨНДӨХГҮЙ хэвээр, зөвхөн нөхөн мөр нэмнэ).
* **Инвариант аудитор** (`lib/taskAllocAudit.ts`, `GET alloc-admin/audit?deep=1&project_id=`; manager, юу ч бичихгүй): `ROOT_SUM_NOT_100`, `ALLOC_BOUNDS`, `COMPLETED_FLAG(_MISSING)`, `PROJECTION_MISMATCH`, `DONE_JOURNAL_MISMATCH`,
  `ORPHAN_SLICES_EXCEED_B`, `CREDIT_LEDGER_MISMATCH`, `ORPHAN_ALLOCATION`, `POST_COMMIT_FAILED/STUCK`, `FUTURE_WORK_INACTIVE`, `CREDIT_DRIFT`, `CONVERSION_*`, `ROOT_TASK_MISSING` (16 код, bounded: `limit`, `truncated`).
  **Идэвхжүүлэхээс өмнө алдаа 0** байх ёстой (UI-д ил баталгаа шаардана).
* `alloc_adj` дүрэм: ажлын үйл явдал БИШ (attendance/repair/snapshot/leaderboard/reports хасна); «сүүлийн явц» сонголтод ОРНО (id tie-break).  `users/monthly` managed таскийн оноог журналаас.

### 13.7 Revit add-in / MCP / хуучин endpoint-ууд

* **Revit:** managed таск → `/submissions` 409 `MANAGED_ROOT`, нэгтгэгдсэн хэсэг → 409 `CONVERTED_PART` (хоёулаа `retryable:false`, `claimed` мөр үлдэхгүй, төлөв ямар ч байсан — хуучин add-in managed таскт ХЭЗЭЭ Ч бичихгүй).
  `/work-context` нь root БА нэгтгэгдсэн хэсгийг `managed:true` тэмдэглэнэ (add-in урьдчилан мэднэ).  Add-in: `RevitApi.IsManagedRoot`, `TrackingHttpTransport.Friendly` `CONVERTED_PART`-ийг танина (⚠️ компайлгүй, §13.1).
  Add-in `X-Task-Alloc-Contract` ИЛГЭЭДЭГГҮЙ — шаардлагагүй: Revit-ийн зам managed таскт ҮРГЭЛЖ 409 (гэрээнээс үл хамаарна).
* **MCP:** tools нь tasks/progress-д ЗӨВХӨН уншдаг (бичих нь хурлын даалгавар — жин 0, managed биш); `list_my_tasks` нэгтгэгдсэн хэсгийг хасна.
* **Хуучин endpoint-ууд** (`routes/legacyEndpointsManaged.test.ts`, 10): `/progress`, `/progress/bulk`, `/:id/baseline`, `/:id/split` (410), `/:id/share`·`/unassign` (410), `DELETE /:id` (ROOT_PROTECTED / түүхгүй бол цэвэрлэж устгана),
  `PUT /:id` — managed таск дээр хуваарилалт/журнал/оноо/явц/`task_ops`/таймерыг БАЙТ-ИЖИЛ хадгална; `paused`/`disabled`/гэрээгүй клиентэд ч.  Frontend-д дуудагч үлдээгүй (`TaskSharesDialog.tsx` нь дуудагчгүй үлдэгдэл — P3 цэвэрлэгээ).

### 13.8 Шалгалтын тоо (бодит гаралт; §10-ийг орлоно)

| Шалгалт | Үр дүн |
|---|---|
| backend `npx tsc --noEmit` | цэвэр |
| backend `npm test` | `node --test "src/**/*.test.ts"` → **2851 тест · 2848 ✓ · 3 ✗** (3 нь доор «мэдэгдэж буй уналт»; энэ салбарын эхэн дэх baseline 2718 тест / 3 ✗ — шинээр ~133 тест нэмэгдсэн, шинэ уналт 0) |
| frontend `npm run verify` | exit 0: `tsc -b --force`, бүх `check:*` (`check:task-units` 48 · i18n 170 түлхүүр mn=en, `check:task-alloc-admin` 23), `vite build` |
| frontend `npm run check:task-alloc-admin` | 23 (store 426/423 + TTL + dismiss, гэрээний толгойн зам, хувилбар ↔ backend, i18n: статик + backend-ийн аудит/хөрвүүлэлт/буцаалтын код бүр орчуулгатай) |
| frontend eslint (`features/task-allocation`, `shared/api`) | 0 олдвор |
| `lint:tokens` (миний ШИНЭ файлууд) | 0 олдвор (хуучин файлуудын өмнөх олдвор хэвээр — «1358 known») |
| headless-Chrome (mock API, бодит `vite preview` build) | **43/43** — менежерийн хуудас (төлөв/аудит+хүрээ/хөрвүүлэлт+төлөвлөгөөний цонх/оноо: preview хүрээ солигдвол нуугдана, confirm) desktop 1280 ба 390px, түүхий i18n түлхүүр 0, хэвтээ overflow 0, толгой унших хүсэлтэд ЯВАХГҮЙ / managed мутацид явна, 426 баннер + «Шинэчлэх» |
| мутаци шалгалт | revit work-context засвар болиулахад шинэ тест унана; i18n түлхүүр устгахад check унана |

3 мэдэгдэж буй уналт (`миграцын дугаар давхардал`, `D1 тээврийн дүрэм` — 0214/0245, `templateNote`) — баseline-тай ижил, энэ ажлын файл хөндөгдөөгүй.

### 13.9 Release runbook (staged) ба containment

**Хатуу дараалал:** (0) provenance → (1) staging → (2) прод D1 → (3) worker → (4) Pages → (5) `paused`-д шалгах → (6) хөрвүүлэлт → (7) аудит цэвэр → (8) `enabled`.

0. **Provenance (заавал, deploy-ийн ӨМНӨ):** `npx wrangler deployments list --config wrangler.toml` (ТУСАД НЬ унш), прод worker-ийн кодыг маркер мөрөөр тулга (`TASK_ALLOC_PAUSED`, `SPLIT_RETIRED`, `extra_days`), `pages deployment list`.
   §11 ⛔-ийн (main-д ороогүй `94df1fc1`/`e1d55087`) шийдвэрийг эзнээс аваагүй бол ЭНД ЗОГС.
1. **Staging D1** (прод-ын хуулбар/export-оор): 0376→0380 хэрэгжсэн төлөвт `d1 migrations apply` 0383→0385; `PRAGMA table_info(task_ops)` (+4 багана), `task_alloc_state_log` 1 мөр, `app_settings['task_alloc.state']`;
   `GET alloc-admin/audit?deep=1` → `errors:0`; `GET conversion/candidates`; нэг бүлгийн `preview` (юу ч бичихгүй) → `rollup.delta = 0`.  **Үр дүнг тэмдэглэхээс өмнө «production-ready» гэж БҮҮ хэл.**
2. **Прод D1:** `d1 time-travel info` (bookmark тэмдэглэ) → `d1 migrations apply --remote` (`d1 execute --file` БҮҮ) → `migrations list --remote` хүлээгдэж буй 0.
3. **Worker** (`wrangler deploy`, цэвэр worktree-ээс, `deployments list`-ийг ТУСАД НЬ уншсаны дараа).  Төлөв: 0384 анхны утга (managed root байвал `paused`, үгүй бол `disabled`) — **бичих хаалттай**, унших хэвээр.
4. **Pages** шууд дараа нь, hash тулга.  Хуучин PWA нээлттэй бол 426 → «Шинэчлэх».
5. **`paused` дээр** унших шалгалт (contributors, my-tasks, allocation GET), аудит.  Хуучин клиент managed таскт бичиж чадахгүйг батал (426/423).
6. **Хөрвүүлэлт** — нэг бүлгээр, `preview` → ажилтан хянана → `apply` (шалтгаантай).  Бүлэг бүрийн дараа аудит.  Буруу бол `revert` (root дээр юу ч хийгдээгүй үед л).
7. **Аудит `errors:0`** + `pending_post_commit = 0`.
8. **`enabled`** (UI-д аудит цэвэр гэсэн ил баталгаа).  Эхний бодит хэрэглээг туршилтын төсөл дээр.

**Containment (яаралтай):** `PUT /api/tasks/alloc-admin/state {state:'paused', reason}` — НЭГ үйлдлээр БҮХ managed мутаци 423, унших хэвээр, **түүх/оноо/цаг УСТАХГҮЙ**, хариу бүрд `X-Task-Alloc-State: paused`, UI баннер.  Дараа нь аудит →
шалтгааныг засаад `enabled`.  Rollback нь code-level биш: схем нэмэлт тул worker өмнөх хувилбар руу буцахад схем аюулгүй — **ГЭХДЭЭ** managed таск үүссэний ДАРАА хуучин код руу буцаавал `recalculateProjectPoints` managed оноог УСТГАНА
(§11 алхам 4).  Тиймээс эхлээд `paused`, дараа нь forward-fix.  Нэгтгэгдсэн (хөрвүүлсэн) өгөгдлийг `revert`-ээр л буцаана (хязгаартай — §13.5).

### 13.10 Үлдсэн эрсдэл (ноцтойгоор)

* **P2** — **Дашбоардын таскийн ТОО** (`routes/teams.ts` `cell_tasks`/`done_tasks`/`avg_progress`, `company.ts` `tasks_total`, MCP `list_overdue_tasks`) нэгтгэгдсэн хэсгийг (жин 0, 100% хэвээр) ЭНГИЙН таск гэж тоолсоор — жигнэсэн явц нөлөөлөхгүй, тоо л өснө.
  Төслийн шатлал (`getProjectHierarchyFast`), «Миний ажлууд», MCP `list_my_tasks`, Revit-ийн жагсаалтаас шүүсэн.  EXPLAIN-аар тааруулсан `teams.ts` `scope` CTE-г хараахан хөндөөгүй.
* **P3** — `applyTaskReweight`-ийн тодорхойлогч `request_id = rw-<task>-r<revision>`: хэрэглэгч яг ижил id-г ирүүлбэл тэр revision-д reweight `noop` болно.  Reweight нь `refreshSnapshotsAfter`-ийг ≤30 өдрөөр inline ажиллуулдаг (`{db}` ctx-ээр) — олон зөрсөн root-той төсөлд удаан байж болно.
* **P3** — `discoverGroups` хязгааргүй (UI `limit=100`); project-scope reweight POST >200 managed таскт 400 `TOO_MANY_TASKS` (таскаар нэг нэгээр).

* **P1** — Staging D1 + Worker provenance + прод `task_groups` схем (§13.1) хаагдаагүй.
* **P2** — Худал хөрвүүлэлтийн эрсдэл: `ambiguous` бүлгийг админ ил баталгаатай хөрвүүлж болно; seed «uncertain» хэсэг нь B (эзэнгүй) болдог.  Бүлэг бүр нэгээр, preview-г хүн хянаж хийнэ.
* **P2** — 0385-ийн холбоо (§13.3): deploy дараалал алдвал «Миний ажлууд» 500.
* **P2** — Revit add-in C# компайлгүй; employee мөрийн paused-түгжээ browser-д давтаагүй.
* **P3** — `TaskSharesDialog.tsx` (дуудагчгүй), `GET /projects/:id` бүх жинг ролиос үл хамааран буцаасаар (UI л нууна).
* **P3** — Аудитор нь прод хэмжээнд (олон мянган root) `deep` горимд удаан байж болно: `limit`/`truncated`, төслөөр нарийчилж ажиллуулна.

### 13.11 Хараат шинжилгээ (2 агент, read-only) ба хариу

Backend (`taskConversion*`, gate, readers, migrations) ба frontend/C# хоёрыг тусад нь, дайсагнасан байдлаар хянуулав.  **Баталсан алдаа бүрт regression тест нэмж, засваргүй кодод унахыг нь шалгав (mutation).**

| # | Эрэмбэ | Олдвор | Төлөв |
|---|---|---|---|
| 1 | P1 | `POST /blocks/:id/scaffold` нэгтгэгдсэн хэсгийн жинг сэргээж давхар тоолно; жин-д мөр бичигдэнэ | **Зассан** (409 `CONVERTED_PART`, 400 `BAD_WEIGHT`) · `taskConversionRoutes.test.ts` |
| 2 | P1 | `protectedRootsIn` 0385-гүй орчинд fail-open (түүхтэй таск cascade-аар устна) | **Зассан** (хоёр тусдаа асуулга) · `taskRootGuard.test.ts` |
| 3 | P1 | Шинэ Pages + хуучин Worker → гэрээний толгой БҮХ хүсэлтэд → CORS preflight-ээр апп бүхэлдээ унана | **Зассан** (толгой зөвхөн managed мутацид) · `check:task-alloc-admin` |
| 4 | P1/P2 | 0385-гүй орчинд `POST /progress` г.м. 500 | **Баримтжуулж, preflight нэмсэн** (§13.3); бүх уншигчийг тэсвэртэй болгоогүй |
| 5 | P2 | `applyConversion` TOCTOU: төлөвлөгөөний дараа орсон явц guard-аас гулсаж 12 пункт алдагдана | **Зассан** (guard нь төлөвлөгөө задарсан ЯГ тэр уншилтаас) · `taskConversion.test.ts` |
| 6 | P2 | convert→revert→convert→revert: хоёр дахь буцаалт үргэлж `OPS_AFTER_CONVERSION` | **Зассан** |
| 7 | P2 | `paused` үед жин засахад оноо бичигдэж root revision өснө | **Зассан** (автомат тулгалт хаалгыг мөрдөнө) |
| 8 | P2 | Seed дугуйлалтаас бүх хөрвүүлсэн таск «CREDIT_DRIFT», анхны тулгалт шуугиан мөр бичнэ | **Зассан** (`REWEIGHT_NOISE`) |
| 9 | P2 | Клиент талын түгжээ `enabled` болсны дараа үлдэнэ; 423 дараа Retry байхгүй | **Зассан** (TTL 60 с, dismiss, `server_older` цэвэрлэгдэнэ, 423/426 ноорог retryable) |
| 10 | P2 | CreditTab: preview хүрээнээс өөр хүрээг apply хийж болно; confirm байхгүй | **Зассан** |
| 11 | P2 | Нэгтгэгдсэн хэсэг блок/зургийн карт, график, багийн статистикт тоологдоно | **Хэсэгчлэн** — шатлалын эх сурвалжид шүүсэн; дашбоардын тоо үлдсэн (§13.10) |
| 12 | P3 | revert replay өөр conversionId-д; revert нэр/хугацааг дарж бичнэ; gate-state буруу утга; baseline fail-open; жин/нэрний хязгаар; project reweight хязгааргүй; first-split ↔ conversion уралдаан | **Зассан** |
| 13 | P3 | i18n/a11y/copy (placeholder 5↔3, revert кодын орчуулга, aria, `confirmed` reset, audit хүрээ, баннер ↔ UpdatePrompt, кэш invalidate) | **Зассан** |
| 14 | P3 | C# `Friendly` `MANAGED_ROOT`/`CONVERTED_PART` салбар хүрэгдэхгүй (сервер `message` илгээнэ) | **Зөвшөөрсөн** — зан төлөв зөв (409 → Rejected, retry үгүй), үлдээв |

Эдгээрийн дараа дахин ажиллуулсан: backend `tsc` + 2851 тест, frontend `verify`, browser 43/43 (§13.8).
