# 2-2-APPENDIX — ХУВААЛЦСАН ТӨРЛҮҮДИЙН ХӨЛДӨӨЛТ (shared types freeze)

> **Track:** 2 · REGULATORY INTELLIGENCE
> **Төрөл:** ГЭРЭЭ (contract), сессийн даалгавар БИШ. Энэ баримт нь **код гаргахгүй**, **migration авахгүй**, **deploy хийхгүй**.
> **Эцэг баримт:** `2-2-rule-model.md` (1874 мөр) — тоо, хүснэгт, шалтгаан бүр ТЭНД. Энэ хавсралт нь тэр баримтын §3.5–§3.9-ийн **гарын үсгүүдийг** бүрэн бичих л ажилтай.
> **Хэн уншина:** `2-2` (`complianceModel.ts`, `ruleApplicability.ts`, `rulePack.ts`, `Units.cs`, `RuleEngine.cs`, `RulePack.cs`), `2-3` (`ComplianceScheduler.cs`, `RuleFactExtractor.cs`, `ComplianceState.cs`), `2-4` (дараалал), `2-5` (олдворын гадаргуу), `2-7` (бэлэн байдлын тоолуур). **Тав нь ч эдгээр төрлийг ИМПОРТЛОНО, ЗОХИОХГҮЙ.**
> **Яагаад байна вэ:** Track 2-ын **таван** спек нь ямар ч баримтад тодорхойлогдоогүй хуваалцсан төрлүүдийг импортолж байна (`RuleDef`, `BuildContext`, `FactBag`, `ConflictTable`, check-ийн грамматик). Хэрэгжүүлэлтийн сесс бүр өөрөө зохиовол таван өөр хэлбэр гарах ба **тавуулангийнх нь дахин бичихээс өөр засвар байхгүй** болно. Тиймээс кодоос ӨМНӨ хөлдөөв.
> **Хамрах хүрээний хязгаар (ЭЗЭН БАТАЛСАН, Ш4 · 2026-08-31):** **ДҮРМИЙН АГУУЛГА ЗОХИОХ НЬ ЗОГССОН.** Энэ баримт нь дүрмийн ЗАГВАРЫГ (төрөл, грамматик, канон хэлбэр, хавчаар) бүрэн тогтооно; дүрмийн КОРПУС бичихгүй. `2-2` §3.7-ийн ХОЁР ажлын жишээ (`BA-HR-CORRIDOR-W-001`, `IZ-HR-CEIL-H-001`) нь энд ЗӨВХӨН **бүтэцийн темплейт** болж иш татагдана. Албан ёсны БНбД/MNS ирэхэд `rule_clauses` дүүргэх нь бүх дүрмийг **код өөрчлөхгүйгээр** ахиулна.
> **Ш3-той зөрчилдөхгүй:** `bim_sessions.company_id` (0217, `2-1`-ийн файл) нь энэ хавсралтын аль ч төрөлд ОРОХГҮЙ — дүрмийн багц нь сессийн биш, **(баг, хувилбар)**-ын функц.

---

## 0. ЭНЭ БАРИМТЫН ДҮРЭМ

| # | Дүрэм |
|---|---|
| 1 | **Энэ бол ГЭРЭЭ.** Доорх төрлийг нэг сесс өөрчилвөл, түүнийг импортолж буй БҮХ сесс дахин уншина. Талбар нэмэх нь энэ файлыг засах, дараа нь хэрэглэгчдийг нь тоолох гэсэн үг |
| 2 | **Утас дамжих (wire-crossing) төрөл бүр ХОЁР хэлбэртэй** — TypeScript (сервер) ба C# (add-in). Хоёул ЯГ ижил JSON-д цуваарилагдана. Ганц хэлбэртэй нь зөвхөн серверийн дотоод төрөл |
| 3 | **C# тал нь net48-ийг (Revit 2024) босго болгоно.** `record`, `init`, nullable reference type ХЭРЭГЛЭХГҮЙ (`csproj:16` `<Nullable>disable</Nullable>`). `System.Text.Json` нь net48-д NuGet 8.0.5-аар ирнэ (`csproj:145-146`) |
| 4 | **TS тал нь `noUncheckedIndexedAccess`-тэй.** `Record<string, T>`-ийн уншилт нь `T \| undefined`. Тиймээс бүх бүртгэлд ил `lookup*()` функц өгөв — индексийг шууд задлахгүй |
| 5 | **Хаалттай толь (frozen vocabulary) нь `as const` цуваа + `(typeof X)[number]`.** `bimEvents.ts:71-80`-ийн `SATELLITE_PARTS` хэв маяг. Шинэ утга нэмэх нь компайлын алдаа болох ёстой |
| 6 | **Спек нээлттэй орхисон зүйлийг ЭНД ЧИМЭЭГҮЙ СОНГОХГҮЙ** — §12 «НЭЭЛТТЭЙ» рүү бичнэ. Гурван үл хамаарах зүйл: §5 (грамматик), §6 (`semantic_hash`), §7 (`pack_sha256`) — гурвуулан дээр хэрэгжүүлэлт БЛОКЛОГДСОН тул ЗААВАЛ шийдэв |

---

## 1. НЭРШЛИЙН ХОЁР ҮНДСЭН ДҮРЭМ

Доорх бүх зүйл эдгээр хоёр дүрэм дээр зогсоно. `2-3`-ын `RuleFactExtractor.Collect` нь бие нь БАЙХГҮЙ бөгөөд эдгээргүйгээр бичигдэх БОЛОМЖГҮЙ.

### 1.1 Баримтын нэр = `<scope>.<local_name>`

```
project.height_m          project.stories_above_grade      doc.room_boundary_location
element.category          element.name_folded              element.clear_width_mm
```

| Scope | Хаанаас ирдэг | Хэдэн удаа шийдэгддэг |
|---|---|---|
| `project` | `project_build_context` (0223) → `BuildContext`. Багцтай хамт ирнэ | НЭГ мөчлөгт НЭГ удаа |
| `doc` | АМЬД Revit баримт (`collect_rule_inputs`-ийн хариултын `doc` блок, `2-3` §3.7) | Баримт тутам НЭГ удаа |
| `element` | `collect_rule_inputs`-ийн `facts` блок | Элемент тутам |

**Регуляр илэрхийлэл (ХОЁР ТАЛД ижил):**

```
^(project|doc|element)\.[a-z][a-z0-9_]{0,47}$
```

⚠️ `all`, `any`, `not`, `if`, `then`, `else` нь ХАСАГДСАН ҮГС. Баримтын нэр цэг агуулдаг тул мөргөлдөх БОЛОМЖГҮЙ — грамматикийн задлагч нь түлхүүрт цэг байгаа эсэхээр л навч ба хослуулагчийг ялгана.

⚠️ **УТАСНЫ ХЭЛБЭР НЬ SCOPE-ЫГ БҮТЦЭЭР, ИЛЭРХИЙЛЛИЙН ХЭЛБЭР НЬ УГТВАРААР АГУУЛНА.** `2-3` §3.7-ийн хариулт нь `{ "facts": { "<uid>": { "clear_width_mm": … } }, "doc": { "room_boundary_location": … } }` — угтваргүй. Дүрмийн илэрхийлэлд `element.clear_width_mm`, `doc.room_boundary_location`. **Энэ хоёрын хооронд ЯГ НЭГ хөрвүүлэгч байна: `FactBag.Resolve(name)` (§4.4).** Өөр газар угтвар нэмэх/хасах нь ХОРИОТОЙ.

⚠️ **`requires.params` нь угтваргүй, `requires_context` нь угтвартай** — `2-2` §3.7-ийн жишээ хоёулаа ингэж бичсэн (`"params": ["clear_width_mm","length_m"]` ба `"requires_context": ["project.height_m","doc.room_boundary_location"]`). Энэ тэгш бус байдал нь ЗОРИУД: `params` нь `collect_rule_inputs`-ийн хүсэлтийн бие рүү **шууд** очдог (тэр хэрэгсэл зөвхөн element scope-той ажилладаг), `requires_context` нь хоёр scope-ыг заана. Хөрвүүлэлт: `params`-ын элемент бүрд `"element."` угтвар нэмэхэд илэрхийллийн нэр гарна.

### 1.2 Тоон баримтын НЭГЖ нь нэрнийхээ ТӨГСГӨЛӨӨС уншигдана

| Суффикс | `rules.unit` | Тайлбар |
|---|---|---|
| `_mm` | `MM` | миллиметр |
| `_m` | `M` | метр |
| `_m2` | `M2` | м² |
| `_m3` | `M3` | м³ |
| `_deg` | `DEG` | ГРАДУС. ⚠️ Revit-ийн дотоод өнцөг нь РАДИАН (`2-2` §2.9) — экстрактор `UnitTypeId.Degrees`-ээр ил хөрвүүлнэ. Радиан эх сурвалж = `mixed_units` |
| `_pct` | `PCT` | хувь (0–100) |
| `_count` | `COUNT` | тоо ширхэг |
| `_kgm3` | `KG_M3` | кг/м³ |
| `_h` | `H` | цаг (галд тэсвэрлэлт) |
| *(таарахгүй)* | `NONE` | хэмжээсгүй: мөр, буль, эсвэл нэгжгүй тоо |

**Шийдэх алгоритм (ХОЁР ТАЛД ижил):** нэрийн `local_name` хэсгийн ХАМГИЙН УРТ таарах суффиксийг ав; аль нь ч таарахгүй бол `NONE`. Дээрх есөн суффикс нь харилцан суффикс-БИШ (аль нь ч нөгөөгөөрөө төгсдөггүй) тул «хамгийн урт» нь зөвхөн ирээдүйн хамгаалалт.

**Хяналтын жишээ (тест болгон хөлдөөв):**

| Нэр | Нэгж | Тэмдэглэл |
|---|---|---|
| `element.clear_width_mm` | `MM` | |
| `element.length_m` | `M` | |
| `element.ceiling_h_mm` | `MM` | ⚠️ `_h` БИШ — терминал суффикс нь `_mm` |
| `project.height_m` | `M` | |
| `project.stories_above_grade` | `NONE` | суффиксгүй тоо — хэмжээсгүй тоолол |
| `element.category` | `NONE` | мөр |
| `element.name_folded` | `NONE` | мөр, fold-v1 |
| `doc.room_boundary_location` | `NONE` | мөр |

⚠️ **`project.stories_above_grade` нь `_count`-гүй.** Энэ бол `2-2` §3.6-ийн ажиллаж буй нэр (`opensHighRiseDocumentSet`, P1/P2/P4 паритетын fixture) — түүнийг өөрчлөх нь хос файлын тулгалтыг эвдэнэ. Тиймээс **суффиксгүй = `NONE` = хэмжээсгүй тоо** гэдэг нь дүрэм, үл хамаарах зүйл БИШ. `COUNT` нь зөвхөн `_count`-оор ил зарласан баримтад.

⚠️ **`rules.unit` нь дүрмийн ТАЙЛАГНАХ нэгж** — `RuleOutcome.ObservedValue` / `ThresholdValue` ямар нэгжээр хэвлэгдэхийг заана. Дүрэм өөр нэгжтэй баримтуудыг зэрэг ХАРЬЦУУЛЖ БОЛНО (`BA-HR-CORRIDOR-W-001` нь `length_m` дээр салаалж, `clear_width_mm`-ыг шалгана — `unit = 'MM'`). Багц угсрах шалгуур (§10-ийн V7): `unit <> 'NONE'` бол `check`-д тэр нэгжтэй ЯДАЖ НЭГ навч байх ёстой.

### 1.3 БАРИМТЫН БҮРТГЭЛ (fact registry)

`RuleFactExtractor.Collect`-ийг бичих боломжтой болгодог цорын ганц зүйл. Бүртгэлд БАЙХГҮЙ нэр нь **багц угсрах үед татгалзагдана** (§10-ийн V3) — тиймээс экстрактор нь ХААЛТТАЙ жагсаалт хэрэгжүүлнэ, дурын параметрийн нэр хайхгүй.

```ts
// backend/src/lib/complianceModel.ts

export const FACT_KINDS = ['number', 'text'] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export interface FactSpec {
  /** Бүтэн нэр — `<scope>.<local>`. */
  readonly name: string;
  readonly scope: 'project' | 'doc' | 'element';
  readonly kind: FactKind;
  /** §1.2-ын алгоритмаас ГАРГАСАН — гараар бичихгүй. */
  readonly unit: Unit;
  /**
   * Экстрактор энэ баримтыг ХААНААС авах вэ.  `2-3`-ын Collect-ийн switch.
   * `dirty` — `DirtyElement`-ээс, Revit-д ХҮРЭХГҮЙ (§4.5-ийн урьдчилсан шүүлт).
   */
  readonly origin: 'context' | 'doc_settings' | 'dirty' | 'builtin' | 'param' | 'computed';
  /** `text` төрлийн баримт fold-v1-ээр хураагдсан эсэх. */
  readonly folded: boolean;
}
```

**Релиз N-ийн бүртгэл — ХОЁР ажлын жишээ хангах ХАМГИЙН БАГА олонлог.** Дүрмийн корпус зогссон тул (Ш4) энэ бүртгэл нь БҮРЭН БИШ бөгөөд бүрэн байх ч ёсгүй; шинэ дүрэм бичих бүрд мөр НЭМНЭ.

| Нэр | kind | unit | origin | folded |
|---|---|---|---|---|
| `project.height_m` | number | `M` | context | — |
| `project.stories_above_grade` | number | `NONE` | context | — |
| `project.stories_below_grade` | number | `NONE` | context | — |
| `project.gross_area_m2` | number | `M2` | context | — |
| `project.occupant_load` | number | `NONE` | context | — |
| `project.building_type` | text | `NONE` | context | үгүй |
| `project.occupancy_class` | text | `NONE` | context | үгүй |
| `project.project_phase` | text | `NONE` | context | үгүй |
| `project.jurisdiction` | text | `NONE` | context | үгүй |
| `project.fire_safety_class` | text | `NONE` | context | үгүй |
| `project.seismic_intensity` | text | `NONE` | context | үгүй |
| `doc.room_boundary_location` | text | `NONE` | doc_settings | үгүй |
| `element.category` | text | `NONE` | **dirty** | үгүй |
| `element.name_folded` | text | `NONE` | param | **тийм** |
| `element.length_m` | number | `M` | builtin | — |
| `element.clear_width_mm` | number | `MM` | computed | — |
| `element.ceiling_h_mm` | number | `MM` | computed | — |

⚠️ **`element.category` нь ЦОРЫН ГАНЦ `origin = 'dirty'` баримт, БАС ЭНЭ ЛАВЛАХЫН ХАМГИЙН АЧААЛАЛТАЙ мөр.** Тэр нь `DirtyElement.Category`-оос (`2-3` §3.6, коалесцерийн хуулбар) ирдэг тул **Revit уншихаас ӨМНӨ мэдэгдэнэ**. Яг энэ л `RuleApplicability.MayApply`-ийн хямд урьдчилсан шүүлтийг (§4.5) боломжтой болгодог. Түүнийг `param`/`computed` болгож зөөвөл бүх дүрэм элемент болгон дээр `collect_rule_inputs` дуудуулж, §51-R3-ын шууд зөрчил болно.

⚠️ **Категорийн нэрийг ОРЧУУЛАХГҮЙ.** Revit-ийн категорийн нэр нь хэрэглэгчийн хэлнээс хамаарна (0204:110-ийн дүрэм, `2-3` §3.5-д давтагдсан). `element.category` нь ЭХ хэлбэрээрээ (`"Rooms"`, `"Walls"`) харьцуулагдана — `contains_any` энд ХЭРЭГЛЭХГҮЙ, зөвхөн `eq` / `in`.

⚠️ **`element.name_folded` нь `TextFold.Fold()`-ын гаралт** (`revit-mcp/addin/TextFold.cs`, гэрээний тэмдэг `fold-v1`). Дөрвөн хослол ЗЭРЭГ хөдөлнө: `backend/src/lib/textFold.ts`, `frontend/.../search/normalize.ts`, `revit-mcp/training/textfold.py`, `TextFold.cs`. **`RuleEngine` нь `TextFold`-д ХҮРЭХГҮЙ** — экстрактор нь хураасан утгыг өгнө, дүрэм дэх needle нь БАГЦАД АЛЬ ХЭДИЙН ХУРААГДСАН байдлаар очно (§5.4-ийн `contains_any`).

---

## 2. `RuleDef` — багцаар явдаг дүрэм

### 2.1 ХОЁР ХЭЛБЭР, НЭГ УТАС

| Хэлбэр | Хаана | Юу агуулах |
|---|---|---|
| **`RuleRow`** | Зөвхөн СЕРВЕР. `rules` (0221)-ийн мөр | 0221-ийн БҮХ багана — `status`, `authored_by`, `reviewed_by`, `reviewed_at`, `created_at` орно |
| **`RuleDef`** | Багц (`rulepack-v1`) → ~20 компьютер → `RuleEngine` | Зөвхөн ГҮЙЦЭТГЭХЭД хэрэгтэй нь |

⚠️ **`authored_by` / `reviewed_by` / `status` / `created_at` нь БАГЦАД ХЭЗЭЭ Ч ОРОХГҮЙ.** Хэрэглэгчийн id-г 20 компьютерийн `%APPDATA%`-д тавих нь ЯМАР Ч ашиггүй мэдээллийн задрал; `status` нь багцад орсноороо утгагүй (нийтлэгдээгүй дүрэм багцад ОРДОГГҮЙ, `rulePack.ts`-ийн `WHERE status='published'` — `2-2` §3.11).

### 2.2 DB багана → багцын гишүүн (ЯГ ЗУРАГЛАЛ)

| `rules` багана (0221) | `RuleDef` гишүүн (JSON) | TS талбар |
|---|---|---|
| `rule_uid` | `rule_uid` | `ruleUid` |
| `version` | `version` | `version` |
| `semantic_hash` | `semantic_hash` | `semanticHash` |
| `team_code` | `team_code` | `teamCode` |
| `title_mn` | `title_mn` | `titleMn` |
| `title_en` | `title_en` | `titleEn` |
| `document_uid` | `document_uid` | `documentUid` |
| `clause_uid` | `clause_uid` | `clauseUid` |
| `edition_ref` | `edition_ref` | `editionRef` |
| `effective_from` | `effective_from` | `effectiveFrom` |
| `verification_state` | `verification_state` | `verificationState` |
| `issue_class` | `issue_class` | `issueClass` |
| `severity` | `severity` | `severity` |
| `unit` | `unit` | `unit` |
| `coordinate_system` | `coordinate_system` | `coordinateSystem` |
| `expect_applicable` | `expect_applicable` | `expectApplicable` |
| `requires_context_json` | `requires_context` | `requiresContext` |
| `applicability_json` | `applicability` | `applicability` |
| `check_json` | `check` | `check` |
| `requires_params_json` | `requires.params` | `requires.params` |
| `requires_triggered_json` | `requires.triggered_by` | `requires.triggeredBy` |
| `exceptions_json` | `exceptions` | `exceptions` |
| `recommendation_mn` | `recommendation_mn` | `recommendationMn` |
| `status`, `authored_by`, `reviewed_by`, `reviewed_at`, `created_at` | — | **ЯВАХГҮЙ** |

⚠️ **`requires_params_json` ба `requires_triggered_json` нь ХОЁР БАГАНА, гэхдээ багцад НЭГ `requires` объект болно** (`2-2` §3.7-ийн жишээ). Тэднийг багцад тусад нь тавих нь жишээ дүрмүүдийг хүчингүй болгоно.

### 2.3 TypeScript

```ts
// backend/src/lib/complianceModel.ts
//
// ⚠️ `VERDICTS` / `ISSUE_CLASSES` / `EVIDENCE_LEVELS` / `SEVERITIES` /
//    `VERIFICATION_STATES` / `SEVERITY_RANK` / `clampByVerification` нь ЭНЭ
//    файлд `2-2` §3.5-аар аль хэдийн зарлагдсан.  ДАВХАР ЗАРЛАХГҮЙ — `2-3`-ын
//    §3.1 блок мөн энэ файлын ТӨГСГӨЛД нэмэгдэнэ (`2-3` §5-ын анхааруулга).

export const UNITS = [
  'MM', 'M', 'M2', 'M3', 'DEG', 'PCT', 'COUNT', 'KG_M3', 'H', 'NONE',
] as const;
export type Unit = (typeof UNITS)[number];

export const COORDINATE_SYSTEMS = ['none', 'project', 'shared', 'survey'] as const;
export type CoordinateSystem = (typeof COORDINATE_SYSTEMS)[number];

/** `revit_element_touches.change`-тэй ИЖИЛ олонлог — `bimEvents.ts:290` `TOUCH_CHANGES`. */
export const TRIGGER_CHANGES = ['add', 'modify', 'delete'] as const;
export type TriggerChange = (typeof TRIGGER_CHANGES)[number];

export interface RuleTrigger {
  /** Revit-ийн категорийн ЭХ нэр — орчуулахгүй. */
  readonly category: string;
  readonly change: TriggerChange;
}

export interface RuleRequires {
  /** element scope-ын ЛОКАЛ нэрс (угтваргүй) — §1.1. */
  readonly params: readonly string[];
  /** ХООСОН бол дүрэм зөвхөн БҮТЭН СКАН дээр ажиллана (`RuleTriggerIndex._fullScanOnly`). */
  readonly triggeredBy: readonly RuleTrigger[];
}

export interface RuleException {
  /** `^[a-z0-9_]{1,32}$` — `skipped_reason = 'exception:' + code`. */
  readonly code: string;
  /** ХАМААРЛЫН фазад үнэлэгдэнэ.  TRUE бол дүрэм NOT_APPLICABLE. */
  readonly when: PredicateNode;
  readonly noteMn: string | null;
}

export interface RuleDef {
  readonly ruleUid: string;
  readonly version: number;
  readonly semanticHash: string;          // 64 тэмдэгт, доод регистр hex
  /** `null` = БҮХ КОМПАНИД (global scope) — `2-2` §3.2. */
  readonly teamCode: string | null;

  readonly titleMn: string;
  readonly titleEn: string | null;

  readonly documentUid: string | null;
  readonly clauseUid: string | null;
  readonly editionRef: string | null;
  readonly effectiveFrom: string | null;   // ISO огноо, `YYYY-MM-DD`

  readonly verificationState: VerificationState;
  readonly issueClass: IssueClass;
  readonly severity: Severity;

  readonly unit: Unit;
  /** Релиз N-д ҮРГЭЛЖ `'none'` — `2-2` §3.11-ийн нийтлэх хаалга. */
  readonly coordinateSystem: CoordinateSystem;

  readonly expectApplicable: boolean;
  /** `project.*` / `doc.*` БҮТЭН нэрс — §10-ийн V4 бүрэн байдлыг албадана. */
  readonly requiresContext: readonly string[];

  /** ХООСОН `{}` = «үргэлж хамаарна» (§5.6). */
  readonly applicability: PredicateNode | null;
  /** ХООСОН `{}` = «шалгах юмгүй» → дүрэм зөвхөн хамаарлын тэмдэглэгээ (§5.6). */
  readonly check: CheckNode | null;

  readonly requires: RuleRequires;
  readonly exceptions: readonly RuleException[];
  readonly recommendationMn: string | null;
}

/** ЗӨВХӨН СЕРВЕР.  Багцад ХЭЗЭЭ Ч ЯВАХГҮЙ гишүүд. */
export interface RuleRow extends RuleDef {
  readonly id: number;
  readonly status: 'draft' | 'review' | 'published' | 'retired';
  readonly authoredBy: number | null;
  readonly reviewedBy: number | null;
  readonly reviewedAt: string | null;
  readonly createdAt: string;
}
```

⚠️ **NULL БАЙЖ БОЛОХ талбар бүр яагаад:**

| Талбар | `null` гэдэг нь юу гэсэн үг вэ |
|---|---|
| `teamCode` | Компани даяарын дүрэм. Сонголтын предикат: `team_code = ?1 OR team_code IS NULL` (`2-2` §3.2) |
| `documentUid` | **Норм БИШ.** `issueClass = 'TEAM_STANDARD'` — жишээ нь `bb/template.ts:173`-ын «21 давхар» нь хурлын зөвлөмж (`2-2` §3.6, §9.1-ийн 5) |
| `clauseUid` / `editionRef` / `effectiveFrom` | `verificationState = 'UNVERIFIED'`-д Л зөвшөөрөгдөнө. 0221-ийн CHECK үүнийг ӨГӨГДЛИЙН САНГИЙН түвшинд албадана |
| `titleEn`, `recommendationMn` | Орчуулга/зөвлөмж хараахан бичигдээгүй |
| `applicability` / `check` | §5.6-ийн хоосон-объект семантик |

### 2.4 C# (net48-safe)

```csharp
// revit-mcp/addin/RulePack.cs
//
// ⚠️ `record`, `init`, nullable reference type ХЭРЭГЛЭХГҮЙ (net48 = Revit 2024).
// ⚠️ Autodesk.Revit-ийн ямар ч төрөл БАЙХГҮЙ — `RuleDef` нь ЦЭВЭР ӨГӨГДӨЛ
//    (`2-3` §3.5-ын `RuleTriggerIndex` үүнд найддаг: индекс барих нь Revit-д
//    хүрэхгүй).

internal sealed class RuleTrigger
{
    public string Category;      // Revit-ийн ЭХ нэр
    public string Change;        // "add" | "modify" | "delete"
}

internal sealed class RuleRequires
{
    public string[] Params;              // угтваргүй, element scope
    public RuleTrigger[] TriggeredBy;    // ХООСОН = зөвхөн бүтэн скан
}

internal sealed class RuleException
{
    public string Code;
    public PredicateNode When;
    public string NoteMn;
}

internal sealed class RuleDef
{
    public string RuleUid;
    public int    Version;
    public string SemanticHash;
    public string TeamCode;              // null = компани даяар

    public string TitleMn;
    public string TitleEn;

    public string DocumentUid;
    public string ClauseUid;
    public string EditionRef;
    public string EffectiveFrom;

    public string VerificationState;     // UNVERIFIED | CLAUSE_CITED | HUMAN_VERIFIED
    public string IssueClass;
    public string Severity;

    public string Unit;                  // MM … NONE
    public string CoordinateSystem;      // релиз N-д ҮРГЭЛЖ "none"

    public bool     ExpectApplicable;
    public string[] RequiresContext;

    public PredicateNode Applicability;  // null = үргэлж хамаарна
    public CheckNode     Check;          // null = шалгах юмгүй

    public RuleRequires   Requires;
    public RuleException[] Exceptions;
    public string          RecommendationMn;
}
```

---

## 3. `BuildContext` — хамаарал үнэлэгдэх ТӨСЛИЙН баримтууд

`project_build_context` (0223)-ийн НЭГ мөрийн POCO төлөөлөл. **Багцтай хамт клиент рүү явна** (`2-2` §3.7-ийн `project_context` блок) — учир нь `rule_pack_versions` нь `(team_code, ruleset_version)`-оор түлхүүрлэгдсэн бөгөөд контекст АГУУЛДАГГҮЙ, тиймээс сервер хамаарлыг урьдчилж хэрэгжүүлж ЧАДАХГҮЙ (`2-2` §3.13.1).

```ts
export const HEIGHT_BASES = ['unknown', 'levels_diff', 'manual', 'proposed'] as const;
export type HeightBasis = (typeof HEIGHT_BASES)[number];

export const PROJECT_PHASES = ['concept', 'sketch', 'permit', 'working', 'asbuilt'] as const;
export type ProjectPhase = (typeof PROJECT_PHASES)[number];

export const BOUNDARY_LOCATIONS = ['Center', 'Finish', 'CoreCenter', 'CoreBoundary'] as const;
export type BoundaryLocation = (typeof BOUNDARY_LOCATIONS)[number];

/**
 * §61-ийн 12 оролт.  ⚠️ NULL нь «мэдэхгүй», «үгүй» БИШ — тэр ялгаа нь
 * `opensHighRiseDocumentSet` нь `false` биш `null` буцаадгийн БҮХ шалтгаан
 * (`2-2` §6-ийн шалгуур).  NULL → UNCERTAIN → `2-5`-ийн
 * PROJECT_INCOMPLETENESS баннер, ЧИМЭЭГҮЙ PASS БИШ.
 */
export interface BuildContext {
  readonly projectId: number;
  /** `''` = «энэ төслийн БҮХ баримтад хамаарах анхдагч» (0223-ийн DEFAULT ''). */
  readonly docUid: string;

  readonly buildingType: string | null;
  readonly occupancyClass: string | null;
  readonly occupantLoad: number | null;
  readonly grossAreaM2: number | null;

  /** ⚠️ ЯЛГАВАР (дээд давхрын түвшин − газрын түвшний давхар), ҮНЭМЛЭХҮЙ БИШ. */
  readonly heightM: number | null;
  readonly heightBasis: HeightBasis;
  readonly gradeLevelName: string | null;
  readonly topLevelName: string | null;

  readonly storiesAboveGrade: number | null;
  readonly storiesBelowGrade: number | null;

  readonly jurisdiction: string;          // NOT NULL, анхдагч 'MN'
  readonly projectPhase: ProjectPhase | null;
  readonly fireSafetyClass: string | null;
  readonly seismicIntensity: string | null;

  /** АВТОРЛОСОН утга.  ⚠️ АМЬД баримтын утга нь `doc.room_boundary_location`
   *  баримтаас ирнэ ба §4.4-ийн давуу эрхээр ҮҮНИЙГ ДАРНА. */
  readonly roomBoundaryLocation: BoundaryLocation | null;

  /** ⚠️ v1-д ИЛЭРХИЙЛЛЭЭС ХАНДАХ БОЛОМЖГҮЙ — жагсаалтын оператор байхгүй (§12-3). */
  readonly specialRequirements: readonly string[];
}
```

```csharp
// revit-mcp/addin/RuleFacts.cs
internal sealed class ProjectBuildContext
{
    public int    ProjectId;
    public string DocUid;

    public string  BuildingType;
    public string  OccupancyClass;
    public double? OccupantLoad;
    public double? GrossAreaM2;

    public double? HeightM;
    public string  HeightBasis;
    public string  GradeLevelName;
    public string  TopLevelName;

    public double? StoriesAboveGrade;
    public double? StoriesBelowGrade;

    public string Jurisdiction;
    public string ProjectPhase;
    public string FireSafetyClass;
    public string SeismicIntensity;
    public string RoomBoundaryLocation;

    public string[] SpecialRequirements;
}
```

⚠️ **`StoriesAboveGrade` нь C# талд `double?`, `int?` БИШ.** Шалтгаан: `FactValue` нь бүх тоог `double`-аар авдаг тул `int` рүү хөрвүүлэх цэг бүр нь `2-2` §3.13.1-ийн паритетын зөрүү үүсгэх боломж (`16.0 > 16` ба `16 > 16` хоёр өөр дугуйруулалт дээр өөр хариулт өгч болно). Хэзээ Ч бүхэл болгож дугуйруулахгүй — харьцуулалт нь `double` дээр (§5.4).

⚠️ **`2-3` нь энэ төрлийг `ProjectBuildContext` гэж нэрлэдэг** (`RunPass(..., ProjectBuildContext ctx)`), TS тал нь `BuildContext`. **Хоёр нэр, НЭГ хэлбэр** — энэ нь мэдэгдэж буй, зөвшөөрөгдсөн нэршлийн зөрүү. Гурав дахь нэр ЗОХИОХГҮЙ.

---

## 4. `FactBag` — шалгалт үнэлэгдэх ЭЛЕМЕНТИЙН баримтууд

### 4.1 `Quantity` ГАНЦААРАА ХҮРЭЛЦЭХГҮЙ — тогтоосон цоорхой

`2-2` §3.8 нь зөвхөн `Quantity`-г (`double Value`) тодорхойлсон. Гэтэл ХОЁУЛАА ажлын жишээ нь МӨР баримт харьцуулдаг: `element.category eq "Rooms"`, `element.name_folded contains_any [...]`, `doc.room_boundary_location eq "Finish"`. **`Quantity` тэднийг агуулж ЧАДАХГҮЙ.**

Шийдэл: `Quantity`-г БҮРЭН ХЭВЭЭР үлдээж (§3.8-д хүрэхгүй), түүнийг агуулах `FactValue` нэмнэ. `FactBag` нь `FactValue` хадгална.

### 4.2 `FactValue`

```ts
export type FactValue =
  | { readonly kind: 'number'; readonly value: number; readonly unit: Unit;
      readonly source: QuantitySource; readonly specId: string | null }
  | { readonly kind: 'text';   readonly value: string }
  | { readonly kind: 'missing' };

export const QUANTITY_SOURCES = [
  'builtin_geometry', 'typed_param', 'untyped_param', 'computed',
] as const;
export type QuantitySource = (typeof QUANTITY_SOURCES)[number];
```

```csharp
internal enum FactKind { Missing = 0, Number = 1, Text = 2 }

internal struct FactValue
{
    public FactKind Kind;
    public Quantity Num;    // Kind == Number үед  (2-2 §3.8-ийн бүтэц)
    public string   Text;   // Kind == Text үед
}
```

⚠️ **`QuantitySource`-ын УТАСНЫ ТОКЕН нь C# enum-ийн нэрний snake_case хувилбар** — `BuiltinGeometry → "builtin_geometry"`, `TypedParam → "typed_param"`, `UntypedParam → "untyped_param"`, `Computed → "computed"`. `2-2` §3.8 ч, `2-3` §3.7 ч токен нэрлээгүй; энд хөлдөөв. Enum-ийн ТООН утгыг утсаар ХЭЗЭЭ Ч илгээхгүй (дараалал өөрчлөгдвөл чимээгүй буруу).

### 4.3 УТАСНЫ ХЭЛБЭР — `collect_rule_inputs`-ийн хариулт

`2-3` §3.7-ийн гарын үсэг, талбар нь энд БҮРЭН зарлагдав:

```jsonc
{
  "facts": {
    "<element_uid>": {
      "clear_width_mm": { "v": 1420.5, "unit": "MM", "src": "computed",
                          "spec": "autodesk.spec.aec:length-2.0.0", "missing": false },
      "length_m":       { "v": 12.4,   "unit": "M",  "src": "builtin_geometry",
                          "spec": null, "missing": false },
      "name_folded":    { "v": "hongil 3", "unit": "NONE", "src": "typed_param",
                          "spec": null, "missing": false }
    }
  },
  "doc":  { "room_boundary_location": { "v": "Finish", "unit": "NONE",
                                        "src": "computed", "spec": null, "missing": false } },
  "more": false, "cursor": 150, "checked": 150
}
```

| Талбар | Дүрэм |
|---|---|
| `v` | JSON тоо ЭСВЭЛ мөр. `missing: true` бол `null`. Тоо нь §6.3-ын тооны хязгаарт багтана |
| `unit` | 10 токены нэг. Мөр баримтад `"NONE"` |
| `src` | §4.2-ын дөрвөн токены нэг |
| `spec` | Revit-ийн `GetUnitTypeId()/GetTypeId()` мөр эсвэл `null`. `Quantity.ConversionAllowed`-ын оролт |
| `missing` | **ЗААВАЛ.** `false` бол `v` нь NULL БАЙЖ БОЛОХГҮЙ |

⚠️ **`missing: true` ба `v: 0` нь ХОЁР ӨӨР ЗҮЙЛ.** `QtoExtractor.Round3OrNull` (`:528-534`) нь бодит тэгийг NULL болгодог — тэр функцийг ЭНЭ ЗАМ ДЭЭР ДАХИН АШИГЛАХГҮЙ (`2-2` §3.8-ийн 3-р дүрэм, §63-ын `zero` ба `missing_input` тусдаа кейс).

### 4.4 `FactBag` ба ЦОРЫН ГАНЦ ШИЙДЭГЧ

```ts
export interface FactBag {
  /**
   * `<scope>.<local>` → утга.  БАЙХГҮЙ нэр нь `{kind:'missing'}` буцаана —
   * `undefined` ХЭЗЭЭ Ч буцахгүй (`noUncheckedIndexedAccess`).
   */
  resolve(name: string): FactValue;
}

export const FACT_MISSING: FactValue = { kind: 'missing' };
```

**Шийдэх ДАРААЛАЛ (ХОЁР ТАЛД ИЖИЛ, өөрчилж БОЛОХГҮЙ):**

| # | Угтвар | Эх сурвалж | Тайлбар |
|---|---|---|---|
| 1 | `element.category` | `DirtyElement.Category` | ЦОРЫН ГАНЦ `origin='dirty'` — Revit уншихаас ӨМНӨ бэлэн (§1.3) |
| 2 | `element.*` | хариултын `facts[<uid>][<local>]` | |
| 3 | `doc.*` | хариултын `doc[<local>]` | **АМЬД баримтын утга** |
| 4 | `doc.*` (2, 3-т олдоогүй) | `BuildContext`-ийн толин тусгал (одоогоор зөвхөн `roomBoundaryLocation`) | Зөвхөн баримт нээгдээгүй үеийн сервер талын дахин үнэлгээнд |
| 5 | `project.*` | `BuildContext` | |
| — | Аль нь ч биш | `FACT_MISSING` | |

⚠️ **АМЬД `doc.*` нь АВТОРЛОСОН толин тусгалыг ДАРНА (3 > 4).** `doc.room_boundary_location` бол хэмжсэн үнэн; `project_build_context.room_boundary_location` бол хүн бичсэн хүлээлт. Хоёр нь зөрөх нь бодит боловч ЭНЭ РЕЛИЗЭД ХЭМЖИГДЭХГҮЙ (§12-1).

**НЭГЖИЙН ТУЛГАЛТ — `resolve`-ийн ДОТОР:** `kind = 'number'` баримтын `unit` нь §1.2-оор нэрнээс гарсан нэгжтэй ЯГ таарах ёстой. Зөрвөл:

- TS: `resolve` нь `{ kind: 'missing' }` БУЦААХГҮЙ — `UnitMismatchError` шидэж, дуудагч нь `UNCERTAIN` + `uncertainReason = 'mixed_units'` болгоно.
- C#: `Quantity.RequireSame` шидэж, `RuleEngine.Evaluate` барьж авна.

Энэ бол §63-ын `mixed_units` кейсийн ЦОРЫН ГАНЦ гарц (`2-2` §3.13-ын 6-р тест). **Чимээгүй хөрвүүлэлт БАЙХГҮЙ.**

**ЭХ ҮҮСВЭРИЙН ШАЛГУУР:** `source = 'untyped_param'` (Integer / Number / Text spec) бол `Quantity.ConversionAllowed` нь `false` буцаана → `resolve` нь **`FACT_MISSING`-тэй адилтгах** утга буцаана, ГЭХДЭЭ дуудагч нь ялгааг мэдэх ёстой: `uncertainReason = 'mixed_provenance'`, `issueClass = 'MODEL_QUALITY'` (`2-3` §3.8). Тиймээс:

```ts
export interface FactResolution {
  readonly value: FactValue;
  /** `null` = хэвийн.  Бусад тохиолдолд дүгнэлт UNCERTAIN болно. */
  readonly problem: 'mixed_units' | 'mixed_provenance' | null;
}
```

`resolve` нь `FactResolution` буцаана; `FactBag.value(name)` нь товчлол (`resolve(name).value`).

### 4.5 `MayApply` — ХЯМД УРЬДЧИЛСАН ШҮҮЛТ, БАС ТҮҮНИЙ АЮУЛ

`2-3` §3.6 нь `RuleApplicability.MayApply(r, d, ctx, out string skip)` дуудна — **`FactBag`-ГҮЙГЭЭР**, Revit уншихаас ӨМНӨ. `2-2` §3.6-ийн `evaluateApplicability(rule, ctx, facts)` нь БҮТЭН FactBag-тай. **Тэдгээр нь хоёр өөр функц, гэхдээ НЭГ предикат.**

⚠️ **`MayApply` нь МОНОТОН УРЬДЧИЛСАН ШҮҮЛТ БАЙХ ЁСТОЙ.** Тодорхойлолт:

```
MayApply(rule, dirty, ctx) :=
    Kleene(applicability, FactBag-аар: element.category = dirty.Category,
                                       project.* = ctx-ээс,
                                       doc.* = кэшлэгдсэн байвал,
                                       БУСАД БҮГД = Missing)
      != False
```

Өөрөөр хэлбэл **`False` үед Л `false` буцаана; `Unknown` үед `true` буцаана.** `skip` шалтгааныг зөвхөн тодорхой `False` тохиолдолд бичнэ.

⚠️ **`Unknown → false` гэж бичих нь энэ хөдөлгүүрийн ХАМГИЙН ХЯЛБАР, ХАМГИЙН ХОР ХӨНӨӨЛТЭЙ АЛДАА.** `element.name_folded` нь `collect_rule_inputs`-ээс Л ирдэг тул урьдчилсан шүүлтийн үед ҮРГЭЛЖ `Missing`. `Unknown`-ыг «хамаарахгүй» гэж уншвал `BA-HR-CORRIDOR-W-001` НЭГ Ч УДАА ажиллахгүй, `rule_run_ledger` цэвэр харагдана, `2-7`-ийн хаалга НОГООН болно, шалгалт нь ХИЙГДЭЭГҮЙ. Тэсвэрлэх боломжгүй.

---

## 5. ШАЛГАЛТЫН ГРАММАТИК — **ШИЙДВЭР**

### 5.1 ЗӨРЧИЛ

`2-2` §3.9 нь ХААЛТТАЙ операторын олонлог зарласан — `eq, ne, gt, gte, lt, lte, between, in, contains_any, exists` + `all, any, not` — ба «**Дурын илэрхийлэл (eval, formula string) БАЙХГҮЙ**» гэж бичсэн. Гэтэл §3.7-ийн ХОЁУЛАА ажлын жишээ `if` / `then` / `else` хэрэглэдэг, тэр нь ХОЁР жагсаалтын аль нь ч БАЙХГҮЙ.

### 5.2 ШИЙДВЭР — НЭГ нөхцөлт ЗАНГИЛАА нэмнэ, операторын олонлог ХЭВЭЭР

**Хаалттай олонлогт ЯГ НЭГ зангилааны төрөл нэмэв: `cond` (утсан дээр `{ "if": …, "then": …, "else": … }`).** Арван оператор ХЭВЭЭР. Хоёр ажлын жишээ **үсэг үсгээрээ хүчинтэй хэвээр**.

**Яагаад дахин бичихийг сонгоогүй вэ.** Хонгилын дүрмийг `all/any/not`-оор бичвэл:

```jsonc
{ "any": [ { "all": [ { "element.length_m": { "gt":  10 } },
                      { "element.clear_width_mm": { "gte": 1500 } } ] },
           { "all": [ { "element.length_m": { "lte": 10 } },
                      { "element.clear_width_mm": { "gte": 1200 } } ] } ] }
```

Гурван бодит алдагдал:

1. **БОСГО АЛДАГДАНА.** `RuleOutcome.ThresholdValue` (`2-2` §3.9) ба `2-5`-ийн олдворын бичвэр нь «шаардлага 1500, хэмжсэн 1420» гэж хэлэх ёстой. `any[all,all]` нь ХУДАЛ болохдоо ХОЁР унасан харьцуулалттай — аль нь босго вэ гэдэг нь ТААМАГ болно. `cond` дээр салаа мэдэгдэж байгаа тул босго тодорхой (§5.7).
2. **НӨХЦӨЛИЙГ ГАРААР ҮГҮЙСГЭХ = ЧИМЭЭГҮЙ ЦООРХОЙ.** Зохиогч `lte 10`-ыг `lt 10` гэж бичвэл урт нь ЯГ 10 м хонгил хоёр салаанаас Ч гарч, дүрэм `VIOLATION` буцаана — босгогүйгээр. §63-ын `threshold` кейс яг тэр цэг дээр байдаг. `cond` нь үгүйсгэлийг ХӨДӨЛГҮҮРТ өгнө: `if` худал бол `else` — цоорхой БАЙХ БОЛОМЖГҮЙ.
3. **ХОЁР ДАХИН ИХ ЗОХИОХ ГАДАРГУУ.** БНбД-ийн заалт бүр «нөхцөл → босго» хүснэгт. Долоон салбар BA-ийн бүтцийг хуулна (`2-2` §3.7) — үгүйсгэлийг гараар бичих алдааг долоон дахин үржүүлнэ.

**Хөдөлгүүрийн зардал: ЯГ +1 `switch` салаа.** Рекурс нь `all/any/not`-оор аль хэдийн байгаа (жишээ бүрийн `applicability` нь `all → any → навч`), тиймээс `cond` нь рекурсийн шинэ ангилал НЭЭХГҮЙ. Гүн ба зангилааны тоо хоёулаа §5.5-аар хаалттай, тиймээс гүйцэтгэгч нь **бүрэн (total)** хэвээр: eval байхгүй, томьёоны мөр байхгүй, хязгааргүй рекурс байхгүй.

### 5.3 ХОЁР ЗАНГИЛААНЫ ТӨРӨЛ

| Төрөл | Хаана | Зөвшөөрөгдөх |
|---|---|---|
| `PredicateNode` | `applicability`, `exceptions[].when`, `cond.if` | навч · `all` · `any` · `not` |
| `CheckNode` | `check`, `cond.then`, `cond.else` | `PredicateNode`-ын БҮГД **+ `cond`** |

⚠️ **`applicability`-д `cond` ЗӨВШӨӨРӨГДӨХГҮЙ.** Хоёр шалтгаан. (а) `all/any/not`-оор БҮРЭН илэрхийлэгдэнэ — босго тайлагнах хэрэггүй тул §5.2-ын 1-р алдагдал үүсэхгүй. (б) §4.5-ийн `MayApply`-ийн монотон байдлыг ЭНГИЙН болгоно: салаа сонголтгүй бол «`False` бол зогс, эс бөгөөс үргэлжил» гэсэн нотолгоо нэг мөр. Хоёулаа ажлын жишээ энэ хязгаарлалтад НИЙЦНЭ.

### 5.4 ОПЕРАТОРУУД — БҮРЭН УТГА

Навчны утсан хэлбэр: **яг нэг түлхүүртэй** объект, түлхүүр нь баримтын нэр, утга нь **яг нэг түлхүүртэй** объект, түлхүүр нь оператор.

```jsonc
{ "element.clear_width_mm": { "gte": 1500 } }
```

| Оператор | Операнд | Утга | `Missing` үед |
|---|---|---|---|
| `eq` | тоо ЭСВЭЛ мөр | тоо: \|a−b\| ≤ `EPS`. мөр: ordinal тэнцүү | `Unknown` |
| `ne` | тоо ЭСВЭЛ мөр | `eq`-ийн үгүйсгэл | `Unknown` |
| `gt` | тоо | `a > b` (EPS БАЙХГҮЙ) | `Unknown` |
| `gte` | тоо | `a >= b` (EPS БАЙХГҮЙ) | `Unknown` |
| `lt` | тоо | `a < b` | `Unknown` |
| `lte` | тоо | `a <= b` | `Unknown` |
| `between` | ЯГ 2 тооны цуваа `[lo, hi]`, `lo <= hi` | `a >= lo && a <= hi` (хоёр тал ОРНО) | `Unknown` |
| `in` | ХООСОН БИШ, НЭГ ТӨРЛИЙН цуваа (бүгд тоо ЭСВЭЛ бүгд мөр) | гишүүнчлэл (`eq`-ийн дүрмээр) | `Unknown` |
| `contains_any` | ХООСОН БИШ МӨРИЙН цуваа, гишүүн бүр АЛЬ ХЭДИЙН fold-v1-ээр хураагдсан | баримт нь `text`, ямар нэг гишүүн нь **ordinal дэд мөр** байвал TRUE | `Unknown` |
| `exists` | `true` ЭСВЭЛ `false` | `exists:true` → баримт байгаа бол TRUE. `exists:false` → эсрэгээр | **ХЭЗЭЭ Ч `Unknown` БИШ** |

⚠️ **`EPS = 1e-9`, ЗӨВХӨН `eq` / `ne` / `in` / `between`-ийн гишүүнчлэлд.** Эрэмбийн операторууд (`gt/gte/lt/lte`) НЯГТ. Шалтгаан: `2-2` §3.13.1-ийн P2 fixture (`height_m = 51` ЯГ → `NOT_APPLICABLE`) нь `gt`-ийн нягт байдлаас хамаарна; тэнд EPS оруулах нь паритетыг чимээгүй эвдэнэ.

⚠️ **`contains_any` нь `TextFold`-д ХҮРЭХГҮЙ.** Needle-ууд багцад аль хэдийн хураагдсан (`["hongil","koridor"]`), баримтын тал нь `element.name_folded` (§1.3). Хөдөлгүүрт хураах кодыг оруулах нь `TextFold`-ын дөрвөн хослолыг ТАВ болгож, `check_fold_parity.py` / `check_parity.py`-ийн хамрах хүрээнээс гадуур тав дахь хуулбар үүсгэнэ. Багц угсрах шалгуур V6 нь needle бүрийг `foldText()`-ээр дамжуулж, өөрчлөгдвөл ТАТГАЛЗАНА.

⚠️ **`exists` нь `Missing`-ийг ТОДОРХОЙ буль болгодог ЦОРЫН ГАНЦ оператор.** Түүнийг `not`-той хамт хэрэглэвэл «энэ параметр байхгүй бол» гэсэн дүрэм бичих боломжтой — `MODEL_QUALITY` ангиллын дүрмийн үндэс.

⚠️ **Операнд нь ҮРГЭЛЖ ЛИТЕРАЛ.** Ямар ч оператор нөгөө талдаа баримтын НЭР авахгүй. Баримт-баримтын харьцуулалт грамматикт БАЙХГҮЙ. Үр дүн: `Quantity.RequireSame` нь ЗӨВХӨН §4.4-ийн нэр↔нэгж тулгалтад ажиллана, харьцуулалтын дотор ХЭЗЭЭ Ч биш. Энэ нь нэгжийн алдааны бүхэл ангиллыг арилгана.

### 5.5 ГУРВАН УТГАТ ЛОГИК — паритет нь АРИФМЕТИКААР батлагдана

```
Tri: False = 0 · Unknown = 1 · True = 2

all(children)  = min(children)          // хоосон цуваа → True (2)
any(children)  = max(children)          // хоосон цуваа → False (0)
not(x)         = 2 - x
cond(i, t, e)  = i == True  ? eval(t)
               : i == False ? eval(e)
               : Unknown                // ⚠️ САЛАА СОНГОГДООГҮЙ → ХОЁУЛАНГ НЬ ҮНЭЛЭХГҮЙ
```

⚠️ **`min`/`max`/`2−x` нь Kleene-ийн логиктой ЯГ ТЭНЦҮҮ**, бөгөөд TS (`Math.min`) ба C# (`Math.Min`) дээр НЭГ АРИФМЕТИК. `2-2` §3.13.1-ийн паритетын харуул нь энэ шалтгаанаар зөвхөн **fixture**-ийг тулгах хэрэгтэй болно — логикийн хэрэгжилт нь бүтцээрээ ижил.

⚠️ **`cond` нь `Unknown` нөхцөл дээр ХОЁУЛАНГ НЬ ҮНЭЛЭХГҮЙ.** Хонгилын урт мэдэгдэхгүй бол АЛЬ босго хамаарахыг мэдэхгүй. Хатуу нь (1500) сонговол хэн ч тавиагүй шаардлага зохионо; зөөлөн нь (1200) сонговол ХУДАЛ PASS — R2-ийн хамгийн муу уналт (`2-2` §3.7-ийн boundary-location анхааруулга). **ТАТГАЛЗСАН хувилбар:** «хоёр салаа ижил хариулт өгвөл түүнийг ав». Тэр нь тодорхой тохиолдолд илүү сайн хариулт өгөх боловч тусгай тохиолдол нэмж, `2-3` §3.8-ийн «оролт байхгүй → UNCERTAIN/`missing_input`» мөртэй зөрчилдөнө.

⚠️ **`all` дээр `False` ноёрхоно** (`min`): нэг оролт дутуу байсан ч ӨӨР оролт нь тодорхой зөрчиж байвал дүгнэлт нь `False`. Энэ нь ЗӨВ — «өргөн нь 1000 мм» гэдэг нь бусад юу ч байсан зөрчил.

### 5.6 ХООСОН ОБЪЕКТЫН СЕМАНТИК

0221-ийн `applicability_json` ба `check_json` нь `DEFAULT '{}'`. Тиймээс:

| Утга | `applicability` | `check` |
|---|---|---|
| `{}` | **ҮРГЭЛЖ ХАМААРНА** (`True`) | **ШАЛГАХ ЮМГҮЙ** — `RuleOutcome` ҮҮСГЭХГҮЙ, олдвор БАЙХГҮЙ; бүртгэлд `considered` + `applicable` гэж тоологдоно |
| бусад | грамматикаар задлагдана | грамматикаар задлагдана |

⚠️ `check = {}` дүрэм нь **хамаарлын хэмжигдэхүүн** (§59-ийн бүрхэлтийн тоолуур) болж л оршино. `SELECT COUNT(*) FROM rules WHERE unit='NONE' AND check_json <> '{}'` → 0 гэсэн `2-2` §6-ийн шалгуур энэ семантикаас хамаарна.

### 5.7 ШИЙДСЭН НАВЧ — босго яаж олдох вэ

Үнэлгээ нь Kleene утгаас гадна **`decidingLeaf`** буцаана — `RuleOutcome.ObservedValue` / `ThresholdValue`-ыг бөглөх ЦОРЫН ГАНЦ эх сурвалж.

| Зангилаа | Үр дүн | `decidingLeaf` |
|---|---|---|
| навч | ямар ч | тэр навч өөрөө |
| `all` | `False` | **баримт бичгийн дарааллаар ЭХНИЙ** `False` хүүхдийн `decidingLeaf` |
| `all` | `True` / `Unknown` | `null` |
| `any` | `True` | ЭХНИЙ `True` хүүхдийн `decidingLeaf` |
| `any` | `False` / `Unknown` | `null` |
| `not` | ямар ч | `null` (үгүйсгэл нь босгын утгыг эсрэгээр уншуулна) |
| `cond` | ямар ч | СОНГОГДСОН салааны `decidingLeaf` |

**Тайлагнах дүрэм:** `decidingLeaf` нь ЭНЭ ГУРВЫГ хангавал Л `ObservedValue`/`ThresholdValue` бөглөгдөнө — (1) навч нь тоон, (2) операторыг нь `gt/gte/lt/lte/between/eq/ne` (нэг тоон операнд; `between` дээр зөрчсөн тал нь), (3) баримтын нэгж нь `rule.unit`-тай ЯГ тэнцүү. Эс бөгөөс ХОЁУЛАА `null`. **ТААМАГЛАХГҮЙ.**

Хонгилын жишээ, урт 12 м, өргөн 1420.5 мм: `cond.if` = `True` → `then` салаа → навч `clear_width_mm gte 1500` = `False` → `Observed = 1420.5`, `Threshold = 1500`, `Unit = "MM"`. ✅

### 5.8 БҮРЭН ГРАММАТИК — TypeScript (ялгаварласан нэгдэл)

```ts
// backend/src/lib/complianceModel.ts

export const LEAF_OPS = [
  'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'contains_any', 'exists',
] as const;
export type LeafOp = (typeof LEAF_OPS)[number];

/** Харьцуулалтын EPS — ЗӨВХӨН eq / ne / in / between-ийн гишүүнчлэлд. */
export const NUMERIC_EPSILON = 1e-9;

export type LeafNode =
  | { readonly kind: 'cmp'; readonly fact: string;
      readonly op: 'eq' | 'ne'; readonly num: number }
  | { readonly kind: 'cmp'; readonly fact: string;
      readonly op: 'gt' | 'gte' | 'lt' | 'lte'; readonly num: number }
  | { readonly kind: 'cmpText'; readonly fact: string;
      readonly op: 'eq' | 'ne'; readonly text: string }
  | { readonly kind: 'between'; readonly fact: string;
      readonly lo: number; readonly hi: number }
  | { readonly kind: 'inNum'; readonly fact: string; readonly nums: readonly number[] }
  | { readonly kind: 'inText'; readonly fact: string; readonly texts: readonly string[] }
  | { readonly kind: 'containsAny'; readonly fact: string; readonly needles: readonly string[] }
  | { readonly kind: 'exists'; readonly fact: string; readonly want: boolean };

export type PredicateNode =
  | LeafNode
  | { readonly kind: 'all'; readonly children: readonly PredicateNode[] }
  | { readonly kind: 'any'; readonly children: readonly PredicateNode[] }
  | { readonly kind: 'not'; readonly child: PredicateNode };

export type CheckNode =
  | LeafNode
  | { readonly kind: 'all'; readonly children: readonly CheckNode[] }
  | { readonly kind: 'any'; readonly children: readonly CheckNode[] }
  | { readonly kind: 'not'; readonly child: CheckNode }
  | { readonly kind: 'cond'; readonly cond: PredicateNode;
      readonly then: CheckNode; readonly otherwise: CheckNode };
```

⚠️ **TS талд `else` нь `otherwise` гэж нэрлэгдэнэ** (`else` нь түлхүүр үг). Утсан дээр `"else"` ХЭВЭЭР — жишээ дүрмүүд хүчинтэй хэвээр.

⚠️ **`otherwise` нь ЗААВАЛ, сонголт БИШ.** «Нөгөө тохиолдолд шаардлагагүй» гэдгийг илэрхийлэх «үнэн» литерал грамматикт БАЙХГҮЙ, БАС нэмэхгүй. Тэр санаа нь **хамаарлын давхаргад** харьяалагдана (§61: «Only after applicability is established should the rule be executed»). Салааг сонголттой болгох нь «`else` бичээгүй ⇒ чимээгүй PASS» гэсэн ангиллыг нээнэ — яг §5.2-ын 2-р алдагдал.

### 5.9 ХЯЗГААРУУД — БҮРЭН БАЙДЛЫГ (totality) БАТЛАХ ТООНУУД

```ts
export const MAX_NODE_DEPTH = 8;       // үндэс = 1
export const MAX_NODES_PER_RULE = 64;  // applicability + check + exceptions[].when НИЙЛЭЭД
export const MAX_ARRAY_OPERANDS = 32;  // in / contains_any-ийн гишүүдийн тоо
export const MAX_NEEDLE_LEN = 64;      // contains_any-ийн нэг гишүүний урт
```

- **Багц угсрахад** (`rulePack.ts`) хэтэрсэн дүрэм нь багцад ОРОХГҮЙ, нийтлэх нь 409.
- **Багц ачаалахад** (`RulePack.cs`) хэтэрсэн зангилаа илэрвэл **БҮХ БАГЦ ТАТГАЛЗАНА** — `IntentModel.cs:311-312`-ийн «гэрээ зөрвөл `null`» хэв маяг. Хагас ачаалахгүй.
- **Гүйцэтгэгч дотор** гүний тоолуур давхар байна: `MAX_NODE_DEPTH` давбал `Unknown` буцаана, шидэхгүй. `%APPDATA%`-д гараар засагдсан файл нь `StackOverflowException`-оор Revit-ийг унагах БОЛОМЖГҮЙ.

### 5.10 БҮРЭН ГРАММАТИК — C#

```csharp
// revit-mcp/addin/RuleEngine.cs

internal enum Tri { False = 0, Unknown = 1, True = 2 }

internal enum NodeKind { Cmp, CmpText, Between, InNum, InText, ContainsAny, Exists,
                         All, Any, Not, Cond }

/// <summary>
/// НЭГ зангилааны төрөл — `record` БАЙХГҮЙ (net48).  Талбарууд нь `Kind`-ээс
/// хамаарч Л утгатай; задлагч нь бусдыг хөндөхгүй.
/// ⚠️ `Cond` нь ЗӨВХӨН `check`-ийн модонд гарна (§5.3).  Задлагч нь
///    `applicability` задлахдаа `Cond` таарвал БҮХ БАГЦЫГ ТАТГАЛЗАНА.
/// </summary>
internal sealed class CheckNode
{
    public NodeKind Kind;

    public string   Fact;       // Cmp … Exists
    public string   Op;         // Cmp / CmpText: eq ne gt gte lt lte
    public double   Num;        // Cmp
    public string   Text;       // CmpText
    public double   Lo, Hi;     // Between
    public double[] Nums;       // InNum
    public string[] Texts;      // InText / ContainsAny
    public bool     Want;       // Exists

    public CheckNode[] Children; // All / Any
    public CheckNode   Child;    // Not
    public CheckNode   If;       // Cond
    public CheckNode   Then;     // Cond
    public CheckNode   Else;     // Cond
}

/// <summary>`PredicateNode` нь `CheckNode`-ын ДЭД ОЛОНЛОГ — тусдаа төрөл
/// зарлахгүй; ялгаа нь ЗАДЛАГЧИЙН хязгаарлалт (Cond хориотой).</summary>
internal static class Kleene
{
    internal static Tri All(Tri a, Tri b) { return (Tri)Math.Min((int)a, (int)b); }
    internal static Tri Any(Tri a, Tri b) { return (Tri)Math.Max((int)a, (int)b); }
    internal static Tri Not(Tri a)        { return (Tri)(2 - (int)a); }
}
```

### 5.11 ЗАДЛАГЧ НЬ ХЭЗЭЭ Ч ШИДЭХГҮЙ

```ts
export type ParseResult<T> =
  | { readonly ok: true;  readonly node: T }
  | { readonly ok: false; readonly error: string; readonly path: string };

export function parsePredicate(raw: unknown): ParseResult<PredicateNode>;
export function parseCheck(raw: unknown): ParseResult<CheckNode>;
```

C# талд `bool TryParse(JsonElement, out CheckNode, out string err)`. **Хоёр талд ч `throw` БАЙХГҮЙ** — `%APPDATA%`-д засагдсан багц нь Revit-ийг унагах ёсгүй, ТАТГАЛЗАХ ёстой.

---

## 6. `semantic_hash` — КАНОН ХЭЛБЭР **MGL-CANON-1**

### 6.1 АСУУДАЛ

`2-2` §3.7 нь `sha256(canonical(applicability) + canonical(check) + unit)` гэж бичсэн, `canonical()`-ыг ТОДОРХОЙЛООГҮЙ. Түлхүүрийн дараалал, зайны тэмдэг, тооны бичиглэл гурвын аль нэг нь зөрөхөд TS зохиогчийн тал ба C# клиентийн тал ӨӨР hash гаргана — дүрмийн ижил төстэй байдал (§64-ийн `authoring_check`, `2-3` §3.10-ийн `ruleset` хуучруулалт) чимээгүй ЭВДЭРНЭ.

### 6.2 ШИЙДВЭР — RFC 8785 (JCS) + ХАТУУ ПРОФАЙЛ

**Канон хэлбэр нь RFC 8785 JSON Canonicalization Scheme**, доорх профайлын хязгаарлалттай. Профайлын дотор MGL-CANON-1-ийн гаралт нь RFC 8785-ынхтай **байт байтаараа тэнцүү** — тиймээс аль ч талын хэрэгжүүлэлт бэлэн JCS сан авч хэрэглэж БОЛНО.

| # | Дүрэм |
|---|---|
| C1 | **Зай БАЙХГҮЙ.** `:` ба `,`-ийн дараа ч, өмнө ч. Мөр таслалт байхгүй, төгсгөлийн `\n` байхгүй |
| C2 | **Объектын гишүүд түлхүүрээрээ эрэмбэлэгдэнэ** — ordinal (UTF-16 code unit) өсөх дараалал, **задлагдаагүй** (unescaped) түлхүүрийн утга дээр. C#: `string.CompareOrdinal`. JS: `Array.prototype.sort()`-ийн анхдагч. Түлхүүр бүр цор ганц (JSON-ы давхардсан түлхүүр = задлах алдаа) |
| C3 | **Цувааны дараалал ХЭВЭЭР.** Эрэмбэлэхгүй — `all`/`any`-ийн хүүхдийн дараалал нь §5.7-ын «эхний» гэсэн семантикийг АЧААЛДАГ |
| C4 | **Мөр нь UTF-8-аар, хамгийн богино JSON escape-ээр.** `"` → `\"`, `\` → `\\`, U+0008 → `\b`, U+000C → `\f`, U+000A → `\n`, U+000D → `\r`, U+0009 → `\t`, бусад U+0000–U+001F → `\u00XX` **ДООД РЕГИСТР hex**. `/` escape ХИЙХГҮЙ. ASCII-аас гадуур тэмдэгт escape ХИЙХГҮЙ — түүхий UTF-8 |
| C5 | **`true` / `false` / `null` нь яг тэр гурван литерал.** `null` нь `applicability`/`check` дотор ХОРИОТОЙ (§10-ийн V2), гэхдээ багцын бусад хэсэгт ЗӨВШӨӨРӨГДӨНӨ (§7) |
| C6 | **Тоо** — §6.3 |
| C7 | Гаралт нь **UTF-8 байтын цуваа**. BOM БАЙХГҮЙ |

### 6.3 ТООНЫ ПРОФАЙЛ (C6) — ХАМГИЙН ХОРТОЙ ХЭСЭГ

**ЗӨВШӨӨРӨГДӨХ ТОО:** төгсгөлөг, `|x| < 1e9`, аравтын бутархайн ХАМГИЙН ИХ 6 орон, экспоненциал бичиглэлгүй.

Тэр туузан дотор тоо нь ХАМГИЙН ИХ 15 үлдэц оронтой ⇒ binary64-д **ЯГ давхар хөрвөнө**; ES `Number.prototype.toString`, .NET-ийн хамгийн богино дугуйруулалт, ба доорх аравтын дүрэм ГУРВУУЛАА ижил мөр гаргана.

**Каноник бичиглэл:**

1. `-0` → `0`. Тэмдгийн `+` БАЙХГҮЙ, сөрөг нь нэг `-`.
2. Бүхэл хэсэгт удирдах тэг БАЙХГҮЙ (ганц `0`-ээс бусад).
3. Бутархайн төгсгөлийн тэгүүд ХАСАГДАНА; бутархай бүхэлдээ хоосон болбол `.` ч ХАСАГДАНА.
4. Экспонент ХЭЗЭЭ Ч БИЧИГДЭХГҮЙ.

```
1500      → "1500"        1500.0  → "1500"     4.5    → "4.5"
0.05      → "0.05"        -0      → "0"        0.500  → "0.5"
51        → "51"          2.400   → "2.4"      1e3    → ЗАДЛАХ АЛДАА (экспонент)
1e9       → ХЯЗГААРААС ГАДУУР        0.0000001 → ХЯЗГААРААС ГАДУУР (7 орон)
```

⚠️ **ХЯЗГААРААС ГАДУУРХ тоо нь багц угсрахад ТАТГАЛЗАГДАНА** (V5), дугуйруулагдахгүй. `double.ToString("R")`-ийн net48 дээрх мэдэгдэж буй давхар-хөрвүүлэлтийн алдаа ба `G17`-ийн `0.05 → "0.050000000000000003"` зөрүү — хоёулаа энэ профайлын гадна үлдэнэ. Хамгийн найдвартай хэрэгжүүлэлт нь **эх JSON-ы тооны бичвэрийг** мөр хэвээр нь канончлох (double руу огт хөрвүүлэхгүй).

### 6.4 `semantic_hash`-ийн БҮРЭН ТОДОРХОЙЛОЛТ

```
bytes = UTF8( MGL_CANON_1(applicability_json_as_parsed) )
      ‖ UTF8( MGL_CANON_1(check_json_as_parsed) )
      ‖ ASCII( unit )

semantic_hash = LOWERHEX( SHA256(bytes) )        // 64 тэмдэгт
```

- Тусгаарлагч БАЙХГҮЙ. JSON объект нь өөрөө хаалттай тул `{...}{...}MM` нь ойлгомжтой.
- `applicability` / `check` нь ХООСОН бол `{}` гэж канончлогдоно (`""` БИШ).
- `unit` нь `UNITS`-ийн ЯГ НЭГ токен, том үсгээр.
- ХЭШИЙН **ГАДНА** үлдэх нь: `rule_uid`, `version`, `team_code`, гарчиг, `severity`, `issue_class`, `clause_uid`, `recommendation_mn`, `requires`, `exceptions`.

**ХӨЛДӨӨСӨН ХАРИЛЦАА:** `semantic_hash` нь **ЛОГИКИЙГ** нэрлэнэ; `(rule_uid, version)` нь **МӨРИЙГ** нэрлэнэ.

| Тохиолдол | `semantic_hash` |
|---|---|
| Босго 1500 → 1450 болов | **ӨӨРЧЛӨГДӨНӨ** (`check` дотор) |
| Гарчиг / зөвлөмж засагдав | ижил |
| `severity` HIGH → CRITICAL | ижил |
| `clause_uid` бөглөгдөв (UNVERIFIED → CLAUSE_CITED) | **ижил** — тиймээс `2-3` §3.10-ийн `ruleset` хуучруулалт нь `semantic_hash`-ЫГ ГАНЦААР нь БИШ, `pack_sha256`-тай ХАМТ шалгана |
| Хоёр баг ижил логикийг тус тусдаа зохиов | **ЯГ ижил** — `authoring_check` (§64) энэ давхардлыг ингэж олно |

⚠️ **`exceptions` хэшид ОРОХГҮЙ** — тэдгээр нь хамаарлын үл хамаарах зүйл, шалгалтын логик БИШ; тэднийг оруулах нь §3.7-ийн томьёог (`applicability + check + unit`) өөрчилнө. Энэ бол ил шийдвэр: **үл хамаарах зүйл нэмэх нь `semantic_hash`-ыг ХӨДӨЛГӨХГҮЙ** — тиймээс тэр нь `version` bump-ээр л мөшгигдөнө. Хязгаарлалт мөн, гэхдээ §3.7-ийн бичсэн гэрээг чимээгүй өргөтгөхөөс дээр.

---

## 7. `pack_sha256` — ХЭШЛЭГДЭХ БАЙТУУД

### 7.1 АСУУДАЛ

`pack_sha256` нь багцын **БИЕ ДОТОР** байгаа гишүүн бөгөөд тэр биеийг хэшлэдэг. Тодорхойлолтгүйгээр тойрог.

### 7.2 ШИЙДВЭР

```
p        = багцын биеийн задлагдсан JSON объект
p'       = p, ГЭХДЭЭ ЯГ ХОЁР гишүүн ХООСОН МӨР болгож солигдсон:
              p'.pack_sha256  = ""
              p'.generated_at = ""
           (гишүүнийг УСТГАХГҮЙ — түлхүүрийн олонлог ХЭВЭЭР)

pack_sha256 = LOWERHEX( SHA256( UTF8( MGL_CANON_1(p') ) ) )
```

**Гишүүнийг «хоосон мөр болгох», «устгах» БИШ гэсний шалтгаан:** MGL-CANON-1 нь түлхүүрийг эрэмбэлдэг тул устгах ба хоосон болгох хоёр ӨӨР байт гаргана; хоёр талын хэрэгжүүлэгч тус тусдаа сонговол чимээгүй зөрнө. Хоосон мөр нь хэлбэрийг ТОГТМОЛ байлгаж, «уншаад — солиод — хэшлээд — тулгах» гэсэн НЭГ л дараалал үлдээнэ.

### 7.3 `generated_at` ЯАГААД ХАСАГДАВ

`2-3` §3.10-ийн гурав дахь хуучруулах гох нь `pack_sha256`-ыг ОДООГИЙН нийтлэгдсэн багцынхтай тулгаж, зөрсөн олдвор бүрийг `stale_reason='ruleset'` болгодог. `generated_at` хэшид үлдвэл **агуулгын хувьд ИЖИЛ багцыг дахин үүсгэх бүрд** шинэ hash гарч, төсөл бүрийн БҮХ олдвор шалтгаангүйгээр хуучирна. Тиймээс хасалт нь чимээ шуугиан багасгах биш — `2-3`-ын хуучруулалтыг ажиллах чадвартай байлгах ШААРДЛАГА.

### 7.4 КЛИЕНТИЙН ТУЛГАЛТ (`RulePack.cs`)

```
1. Дискнээс/сүлжээнээс БАЙТ уншина          (нэр нь `rulepack-<TEAM>-<sha[:16]>-<pid>.json`)
2. Задална → p
3. `p.pack_contract == "rulepack-v1"` эсэхийг шалгана; эс бөгөөс → null   (IntentModel.cs:311-312)
4. §7.2-оор дахин тооцоолно → h
5. h == p.pack_sha256  БА  h.Substring(0,16) == файлын нэрний хэсэг
6. Аль нэг нь зөрвөл → БҮХ БАГЦ ТАТГАЛЗАНА → шигтгээстэй canary руу уналт
7. Ачаалсан h нь handshake-д БАС дүгнэлт бүрд (`learning_events.payload.pack_sha256`) явна
```

⚠️ Алхам 5-ын хоёр дахь тулгалт нь `2-2` §3.7-ийн бодит халдлагын загварыг хаана: `%APPDATA%` нь хэрэглэгчийн бичих эрхтэй, инженер 1500-ыг 1000 болгож засвал файлын нэр дэх hash хэвээр үлдэнэ. Дотоод `pack_sha256`-ыг Ч зассан тохиолдолд файлын нэр нь зөрнө.

### 7.5 ЯГ ЮУ ХЭШЛЭГДЭХ ВЭ

| Багцын гишүүн | Хэшид | Тэмдэглэл |
|---|---|---|
| `pack_contract` | ✅ | |
| `team_code` | ✅ | |
| `ruleset_version` | ✅ | |
| `pack_sha256` | ❌ | `""` болгож солигдоно |
| `generated_at` | ❌ | `""` болгож солигдоно (§7.3) |
| `project_context` | ✅ | ⚠️ Иймд төсөл бүрийн багц нь ӨӨР `pack_sha256`-тай. Энэ нь ЗӨВ: контекст өөрчлөгдөх нь хамаарал өөрчлөгдөх, тэр нь олдворыг үнэхээр хуучруулна |
| `rules[]` | ✅ | дараалал АЧААЛНА (C3) |
| `conflicts[]` | ✅ | §8.2 |

⚠️ `rule_pack_versions.body_json` (0223) нь **нийтлэгдсэн байтыг** ХАДГАЛНА. Сервер түүнийг дахин цуваарилахгүй — дахин цуваарилах бүр нь тоо/зайны зөрүү оруулах боломж. `rulePack.ts` нь **нэг удаа** канончилж, тэр мөрийг `body_json`-д бичиж, тэр мөрөөс `pack_sha256` тооцоолж, `GET /api/compliance/pack` нь тэр мөрийг ЯГ ТЭР ХЭВЭЭР буцаана.

---

## 8. `ConflictTable` — зөрчилдөөнийг ШИЙДЭХГҮЙ, ХАРУУЛАХ

### 8.1 ХИЛ

`rule_conflicts` (0222) нь ГУРВАН бичигчтэй. Клиент дээрх `ConflictTable` нь тэдгээрийн **зөвхөн `scope = 'intra_pack'`** мөрүүдийг агуулна.

| `scope` | Хаана илэрнэ | Багцад ордог уу |
|---|---|---|
| `intra_pack` | Клиент — `RuleEngine.Reconcile` | **ТИЙМ** |
| `cross_discipline` | Сервер — `2-3`-ын дүгнэлтийн урсгал | **ҮГҮЙ** |

⚠️ **`cross_discipline` нь клиент дээр илрэх БҮТЭЦИЙН ХУВЬД БОЛОМЖГҮЙ:** дүрэм сонгох предикат нь `team_code = ?1 OR team_code IS NULL`, тиймээс BA-ийн сесс BB-ийн дүрмийг ХЭЗЭЭ Ч барихгүй (`2-2` §3.10). Багцад тэдгээрийг тавих нь багцыг хоёр дахин том болгож, инженерийн засаж чадахгүй тугийг харуулна (§76-ийн ядаргаа).

### 8.2 УТАСНЫ ХЭЛБЭР — багц дотор

```jsonc
"conflicts": [
  { "rule_uid_a": "BA-HR-CORRIDOR-W-001",
    "rule_uid_b": "BA-HR-EXIT-W-004",
    "conflict_kind": "threshold",
    "scope": "intra_pack",
    "precedence": null,
    "note_mn": "Хоёулаа хонгилын өргөнд өөр босго заана." }
]
```

⚠️ **`rule_uid_a` < `rule_uid_b` ordinal дарааллаар.** Хос нь эрэмбэлэгдээгүй бол `(a,b)` ба `(b,a)` хоёр өөр түлхүүр болж, `idx_rule_conflicts_pair` UNIQUE индекс нь давхардлыг барихаа болино. Нормчлолыг **сервер** хийнэ (`POST /api/compliance/conflicts` бичихээсээ өмнө солино); клиент нь ирсэн дарааллыг найдваргүй гэж үзэж, өөрөө дахин эрэмбэлнэ.

### 8.3 Төрлүүд

```ts
export const CONFLICT_KINDS = [
  'threshold', 'applicability', 'unit', 'definition', 'cross_discipline',
] as const;
export type ConflictKind = (typeof CONFLICT_KINDS)[number];

export const CONFLICT_SCOPES = ['intra_pack', 'cross_discipline'] as const;
export type ConflictScope = (typeof CONFLICT_SCOPES)[number];

export const CONFLICT_PRECEDENCES = ['a_wins', 'b_wins', 'unknown'] as const;
export type ConflictPrecedence = (typeof CONFLICT_PRECEDENCES)[number];

export interface ConflictEntry {
  readonly ruleUidA: string;          // ordinal-аар ruleUidB-ээс БАГА
  readonly ruleUidB: string;
  readonly conflictKind: ConflictKind;
  readonly scope: ConflictScope;
  /** `null` = «мэдэгдэхгүй» — v2 §64-ийн «hierarchy/priority IF KNOWN». */
  readonly precedence: ConflictPrecedence | null;
  readonly noteMn: string | null;
}

/** Багцаас НЭГ УДАА баригдана — `RuleTriggerIndex`-ийн хэв маяг. */
export interface ConflictTable {
  /** Хос бүртгэгдсэн эсэх.  Дараалал хамаарахгүй — дотроо нормчилно. */
  has(ruleUidA: string, ruleUidB: string): boolean;
  /** Бүртгэгдээгүй бол `null`. */
  get(ruleUidA: string, ruleUidB: string): ConflictEntry | null;
  /** Нэг дүрэмтэй зөрчилдөж буй БҮХ дүрмийн uid. */
  partnersOf(ruleUid: string): readonly string[];
  readonly size: number;
}
```

```csharp
internal sealed class ConflictEntry
{
    public string RuleUidA, RuleUidB, ConflictKind, Scope, Precedence, NoteMn;
}

/// <summary>⚠️ Түлхүүр нь НОРМЧИЛСОН хос: OrdinalCompare-ээр эрэмбэлээд
/// '\0'-ээр залгасан мөр.  `(a,b)` ба `(b,a)` НЭГ л мөр.</summary>
internal sealed class ConflictTable
{
    private readonly Dictionary<string, ConflictEntry> _byPair =
        new Dictionary<string, ConflictEntry>(StringComparer.Ordinal);
    private readonly Dictionary<string, List<string>> _partners =
        new Dictionary<string, List<string>>(StringComparer.Ordinal);

    internal static ConflictTable Build(ConflictEntry[] entries);
    internal bool Has(string a, string b);
    internal ConflictEntry Get(string a, string b);
    internal IReadOnlyList<string> PartnersOf(string ruleUid);
    internal int Count { get; }
}
```

### 8.4 `Reconcile`-ийн СЕМАНТИК — ХӨЛДӨӨВ

`RuleEngine.Reconcile(RuleOutcome[] outcomes, ConflictTable table)` нь **НЭГ ЭЛЕМЕНТИЙН** дүгнэлтүүдийг авна.

```
1. ЗӨРЧИЛДӨХ ХОС гэдэг нь: outcomes дотор i, j хоёр байх ба
      table.Has(i.RuleUid, j.RuleUid)  БА  ЗӨРӨӨТЭЙ(i, j)

   ЗӨРӨӨТЭЙ(i, j) :=  i.Result != j.Result
                      БА  (i.Result ∈ {Violation, Warning} ЭСВЭЛ j.Result ∈ {Violation, Warning})

   ⚠️ ХОЁР PASS ХЭЗЭЭ Ч ЗӨРЧИЛДӨХГҮЙ.  Хоёулаа UNCERTAIN бол мөн үгүй
      (аль хэдийн UNCERTAIN, дахин шошголох зүйлгүй).

2. Зөрчилдөх хос БАЙХГҮЙ бол `outcomes` ЯГ ТЭР ХЭВЭЭР буцна.

3. Байвал, оролцсон БҮХ дүгнэлтийг ОРЛУУЛЖ ЯГ НЭГ дүгнэлт гарна:
      Result            = Uncertain
      IssueClass        = "UNKNOWN_NEEDS_REVIEW"
      UncertainReason   = "conflict"
      ConflictRuleUids  = оролцогчдын uid, ordinal эрэмбэлсэн, >= 2
      Severity          = SEVERITY_RANK-ийн ХАМГИЙН ӨНДӨР нь
      EvidenceLevel     = EVIDENCE_RANK-ийн ХАМГИЙН БАГА нь        (§9.4)
      ObservedValue     = null
      ThresholdValue    = null                  ⚠️ ЗААВАЛ null
      Unit              = оролцогчид БҮГД нэг нэгжтэй бол тэр, эс бөгөөс "NONE"
      RuleUid           = ordinal-аар ХАМГИЙН БАГА оролцогчийн uid   (тогтвортой dedup түлхүүр)
      RuleVersion       = тэр дүрмийн хувилбар

4. Зөрчилдөөнд ОРООГҮЙ дүгнэлтүүд ХЭВЭЭР үлдэнэ.
```

⚠️ **`precedence` нь ДҮГНЭЛТИЙГ ХЭЗЭЭ Ч ӨӨРЧИЛӨХГҮЙ.** `a_wins` бүртгэгдсэн ч үр дүн `UNCERTAIN` хэвээр; `precedence` нь `2-5`-ийн ХАРУУЛАХ бүрэлдэхүүнд Л очно (`GET /api/compliance/conflicts`-ээр). Шалтгаан нь `2-2` §3.10-ийн эхний өгүүлбэр: «нэгийг нь ХЭЗЭЭ Ч ЧИМЭЭГҮЙ СОНГОХГҮЙ». Хүн бүртгэсэн тэргүүлэх эрх нь ЗӨВЛӨМЖ, автомат шийдэл БИШ.

⚠️ **`ThresholdValue = null` ЗААВАЛ.** Зөрчилдөж буй хоёр босгын аль нэгийг сонгож харуулах нь яг тэр «чимээгүй сонголт».

⚠️ **`RuleUid`-ыг ordinal-аар хамгийн бага оролцогчоор авах нь dedup түлхүүрийн ТОГТВОРТОЙ БАЙДЛЫН шаардлага.** `ComplianceState.DedupKey(rule.RuleUid, elementUid)` (`2-3` §3.9) нь мөчлөг бүрд ижил түлхүүр гаргах ёстой; дүгнэлтийн массивын дараалал coalescer-ээс хамаарч хөвдөг тул «эхнийх» гэж авах нь мөчлөг тутам ӨӨР олдвор үүсгэнэ.

---

## 9. ДАГАЛДАХ ГЭРЭЭ (companion contracts)

Эдгээр нь §-үүдийн жагсаалтад байгаагүй боловч дээрх төрлүүд тэднийг ШУУД үйлдвэрлэдэг тул энд хөлдөөгүй бол тэр ялгаа гарц дээр гарна.

### 9.1 `Applicability` ба ШАЛТГААНЫ ТОЛЬ

```ts
export type Applicability =
  | { readonly kind: 'APPLICABLE' }
  | { readonly kind: 'NOT_APPLICABLE'; readonly reason: string }
  | { readonly kind: 'UNCERTAIN'; readonly missing: readonly string[] };
```

**`reason`-ийн ХААЛТТАЙ толь (хос файлын тулгалт үүн дээр зогсоно — `2-2` §4):**

| `reason` | Хэзээ |
|---|---|
| `high_rise_gate` | Өндөр барилгын хаалга нь тодорхой ХУДАЛ (`height_m <= 51` БА `stories <= 16`) |
| `boundary_location` | `doc.room_boundary_location` нь дүрмийн шаардсанаас өөр |
| `category` | `element.category` таарахгүй |
| `name` | Нэрний предикат (`contains_any` / `eq`) таарахгүй |
| `context` | `applicability` дотор `project.*` предикат тодорхой ХУДАЛ (өндрийн хаалгаас өөр) |
| `exception:<code>` | `exceptions[]`-ийн НЭГ нь `True` (`<code>` нь `^[a-z0-9_]{1,32}$`) |

⚠️ **Энэ бол ХАМААРЛЫН толь.** `rule_run_ledger.skipped_reason`-ийн толь нь ҮҮНИЙ НАДЛАГ ОЛОНЛОГ — `2-3` нь `no_category`, `missing_params`, `budget_abort`-ыг НЭМНЭ. **Тэдгээр гурав нь ХАМААРЛААС ГАРАХГҮЙ** (тэдгээр нь төлөвлөгчийн шалтгаан). Хос файлын тулгалт (`check_rules.py --parity`) нь ЗӨВХӨН дээрх зургаан утгыг тулгана.

⚠️ **`missing[]` нь ordinal-аар ЭРЭМБЭЛЭГДЭНЭ.** Тулгалт нь массивыг ЯГ тулгадаг (`2-2` §3.13.1-ийн 2-р алхам «эрэмбэлсэн») — эрэмбэлэхгүй бол хоёр талын давталтын дараалал зөрөх бүрд паритет улаан болно. Нэрс нь БҮТЭН (угтвартай): `["doc.room_boundary_location","project.height_m"]`.

**Хамаарлын ҮНЭЛГЭЭНИЙ ДАРААЛАЛ (ХОЁР ТАЛД ижил):**

```
1. exceptions[] — аль нэг нь True → NOT_APPLICABLE("exception:" + code)
                  (олон нь True бол ordinal-аар ХАМГИЙН БАГА code)
2. requiresContext — жагсаагдсан нэрийн аль нэг нь Missing → UNCERTAIN(эрэмбэлсэн нэрс)
3. applicability — Kleene:  True → APPLICABLE
                            False → NOT_APPLICABLE(шийдсэн навчаас гарсан reason)
                            Unknown → UNCERTAIN(шийдэгдээгүй навчнуудын баримтын нэрс)
```

⚠️ **Алхам 1 нь алхам 2-оос ӨМНӨ.** Үл хамаарах зүйл нь контекст дутуу байхад Ч хүчинтэй (жишээ нь «түр байгууламжид хамаарахгүй») — эсрэгээр байвал бүх үл хамаарах зүйл контекст бүрэн бөглөгдөх хүртэл унтарна.

⚠️ **Алхам 3-ын `reason` нь §5.7-ийн `decidingLeaf`-ээс гарна:** навчны баримтын нэрийг дээрх хүснэгтийн мөр рүү зурагладаг ХААЛТТАЙ зураглал. `project.height_m` / `project.stories_above_grade` → `high_rise_gate`; `doc.room_boundary_location` → `boundary_location`; `element.category` → `category`; `element.name_folded` → `name`; бусад `project.*` / `doc.*` → `context`; бусад `element.*` → `category`. Энэ зураглал нь ХОЁР ФАЙЛД БИЧИГДЭНЭ (`ruleApplicability.ts` ↔ `RuleEngine.cs`) ба P5–P8 fixture-ээр тулгагдана.

### 9.2 `RuleOutcome` — `2-3` §9-ийн 13-р нээлттэй асуултын ХАРИУ

`2-2` §3.9 нь `RuleOutcome`-ыг жагсаасан боловч `2-3` §3.9-ийн `state.Apply` нь тэнд БАЙХГҮЙ хоёр талбар шаарддаг (`UncertainReason`, `CalcJson`/`EvidenceJson`). Энд эвлэрүүлэв.

```csharp
internal sealed class RuleOutcome
{
    public string  RuleUid;
    public int     RuleVersion;
    public Verdict Result;            // Pass | Warning | Violation | Uncertain
    public string  Severity;          // ХАВЧААРЫН ДАРААХ утга
    public string  IssueClass;
    public string  EvidenceLevel;     // ХАВЧААРЫН ДАРААХ утга

    public double? ObservedValue;     // §5.7 — таамаглахгүй, эс бөгөөс null
    public double? ThresholdValue;    // §5.7
    public string  Unit;              // rule.Unit-ийн хуулбар

    public string[] MissingInputs;    // ordinal эрэмбэлсэн, БҮТЭН нэрс
    public string[] ConflictRuleUids; // >= 2 бол Result = Uncertain (§8.4)

    public string SkippedReason;      // NOT_APPLICABLE-ийн шалтгаан (§9.1) — мөр ҮҮСГЭХГҮЙ
    public string UncertainReason;    // §9.3-ын толь.  Result != Uncertain бол null
}
```

⚠️ **`CalcJson` / `EvidenceJson` нь ЭНЭ ТӨРӨЛД ОРОХГҮЙ.** Тэдгээрийг `2-3` нь `FindingRow.Create(...)` дотор `RuleOutcome` + `RuleDef`-ээс УГСАРНА — тэдгээр нь олдворын цуваарилалт, дүрмийн гүйцэтгэлийн үр дүн БИШ. `RuleEngine` нь JSON үүсгэхгүй (`2-4` §3.9: «JSON НЬ ЗӨВХӨН `_pump` ДЭЭР ҮҮСНЭ»-ийн ижил зарчим — цэвэр хөдөлгүүр цуваарилдаггүй).

⚠️ **`Severity` ба `EvidenceLevel` нь `clampByVerification` (§3.5)-ийн ДАРААХ утга.** Хавчаарыг `RuleEngine.Evaluate`-ийн ТӨГСГӨЛД НЭГ УДАА хэрэглэнэ. `2-3` §3.4 нь «clamp-ийг энд ДАХИН хэрэгжүүлэхгүй» гэж бичсэн — тэр өгүүлбэрийн нөгөө тал нь ЭНД хэрэгжинэ гэсэн үг.

### 9.3 `UncertainReason` — ХААЛТТАЙ ТОЛЬ

`2-3` §3.8-ийн хүснэгтээс, `complianceModel.ts`-д хөлдөөв:

```ts
export const UNCERTAIN_REASONS = [
  'missing_input',      // дүрмийн шаардсан element баримт олдсонгүй
  'zero_vs_missing',    // тэг ба байхгүйг ялгах боломжгүй эх сурвалж
  'mixed_provenance',   // untyped_param — хөрвүүлэлт зөвшөөрөгдөхгүй (§4.4)
  'mixed_units',        // нэр↔нэгж зөрөв, RequireSame шидэв (§4.4)
  'missing_context',    // project.* / doc.* баримт дутуу
  'conflict',           // §8.4
] as const;
export type UncertainReason = (typeof UNCERTAIN_REASONS)[number];
```

⚠️ **`missing_context` нь §10-ийн V4 шалгуурын ДАРАА ХҮРЭХГҮЙ болно** — V4 нь `check`/`applicability` дэх `project.*`/`doc.*` нэр бүрийг `requires_context`-д байхыг албаддаг тул контекстийн дутуу байдал ҮРГЭЛЖ хамаарлын фазад (`Applicability.UNCERTAIN`) баригдана. Утгыг толинд үлдээх шалтгаан: сервер талын дахин үнэлгээ ба хуучин багц. **Хэрэв релиз N-д `uncertain_reason='missing_context'` мөр гарвал энэ нь V4 хэрэгжээгүйн ДОХИО.**

### 9.4 `EVIDENCE_RANK` — ШИНЭ ТОГТМОЛ

`2-2` §3.10 нь зөрчилдөөнд «хамгийн бага итгэлтэй» нотолгоог авахыг шаардсан боловч **дараалал тодорхойлоогүй**. Хөлдөөв:

```ts
export const EVIDENCE_RANK: Record<EvidenceLevel, number> = {
  HUMAN_VERIFIED: 5,   // хүн загварыг харж баталсан
  RULE_BACKED:    4,   // эшлэсэн заалттай дүрэм
  MODEL_DERIVED:  3,   // загвараас гаргасан (UNVERIFIED хавчаарын албадсан утга)
  AI_INFERRED:    2,
  UNKNOWN:        1,
};
```

⚠️ `SEVERITY_RANK`-ийн (`2-2` §3.5) хажууд, ижил хэв маягаар. `Record<EvidenceLevel, number>` тэмдэглэгээ нь ЗОРИУД — 6 дахь түвшин нэмбэл файл компайл БОЛОХГҮЙ (`bimEvents.ts`-ийн `PART_BIT`, `pushSweep.ts`-ийн `CATEGORY_OF`-ын заль).

---

## 10. БАГЦ УГСРАХ ШАЛГУУРУУД — БҮРЭН БАЙДЛЫГ ХААНА АЛБАДАХ ВЭ

Дараах шалгууруудыг **`rulePack.ts` (сервер)** ба **`RulePack.cs` (клиент)** ХОЁУЛАА ажиллуулна. Сервер тал нь ЗОХИОГЧИЙГ хаана; клиент тал нь `%APPDATA%`-д ГАРААР засагдсан файлыг хаана. Давхардал биш — `2-2` §3.11-ийн «хоёр газар шалгах» яг тэр логик.

| # | Шалгуур | Унасан үед |
|---|---|---|
| V1 | Грамматик задлагдана; `applicability` дотор `cond` БАЙХГҮЙ (§5.3) | Дүрэм багцад ОРОХГҮЙ / бүх багц ТАТГАЛЗАНА |
| V2 | `applicability` / `check` дотор `null` операнд БАЙХГҮЙ (C5) | ижил |
| V3 | Илэрхийлэлд гарч буй баримтын нэр бүр §1.3-ын БҮРТГЭЛД байна | ижил |
| V4 | `applicability` + `check` + `exceptions[].when`-д гарах БҮХ `project.*` / `doc.*` нэр нь `requires_context`-д байна | ижил |
| V5 | Тоон литерал бүр §6.3-ын профайлд багтана | ижил |
| V6 | `contains_any`-ийн needle бүр нь `foldText(needle) === needle` | ижил |
| V7 | `unit <> 'NONE'` бол `check`-д тэр нэгжтэй ЯДАЖ НЭГ тоон навч байна | ижил |
| V8 | `MAX_NODE_DEPTH` / `MAX_NODES_PER_RULE` / `MAX_ARRAY_OPERANDS` / `MAX_NEEDLE_LEN` (§5.9) | ижил |
| V9 | `element.*` нэр бүр (`element.category`-оос БУСАД) нь `requires.params`-д байна | ижил |
| V10 | `semantic_hash` нь §6.4-өөр ДАХИН тооцоолоход мөрийнхтэй тэнцэнэ | ижил |
| V11 | `coordinate_system = 'none'` ЭСВЭЛ `LINK_TRANSFORM_CAPABILITY_SHIPPED` (`2-2` §3.11) | Дүрэм багцад ОРОХГҮЙ |
| V12 | `conflicts[]`-ийн хос бүр нормчлогдсон (`a < b` ordinal), `scope = 'intra_pack'` | Клиент дахин нормчилно; сервер 500 биш, засаад бичнэ |

⚠️ **V9-ийн `element.category` үл хамаарах зүйл нь ЗАРЧМЫН.** `element.category` нь `collect_rule_inputs`-ээс ИРДЭГГҮЙ (§1.3, §4.4-ийн 1-р мөр); түүнийг `params`-д бичих нь экстракторыг байхгүй параметр хайлгана.

⚠️ **Багц угсрахад шалгуур унавал ЯМАР ЧИМЭЭ ГАРАХ ВЭ.** Сервер тал: `POST /rules/:uid/publish` нь **409** + нэрлэсэн `reason` (`2-2` §3.11-ийн дөрвөн шалтгааны хажууд `invalid_expression` нэмэгдэнэ). `rulePack.ts` нь нийтлэгдсэн ч гэсэн V-шалгуур унасан дүрмийг багцаас ЧИМЭЭГҮЙ ХАСАХГҮЙ — багц угсралт БҮХЭЛДЭЭ АМЖИЛТГҮЙ болж, өмнөх `ruleset_version` үйлчилсээр байна. Чимээгүй хасалт нь «инженер шалгагдсан гэж бодож байхад дүрэм ажиллаагүй» гэсэн яг тэр төрлийн уналт.

---

## 11. УРЬДЧИЛСАН ЗАРЛАЛТ — ӨӨР БАРИМТЫН ЭЗЭМШДЭГ ТӨРЛҮҮД

⚠️ **Эдгээрийг ЭНЭ баримт ТОДОРХОЙЛОХГҮЙ, ӨӨР сесс ДАХИН ТОДОРХОЙЛОХГҮЙ.** Нэр ба эзнийг л хөлдөөв, ингэснээр хоёр сесс ижил нэрээр өөр хэлбэр зохиох боломжгүй болно.

| Төрөл | Эзэн | Нэг мөрийн тайлбар |
|---|---|---|
| `PassResult` | **`2-3` §3.6** | НЭГ өсөлтөт мөчлөгийн үр дүн — `ScanGeneration`, `Coverage`, `NoPack`, `Skipped`, `BadgeCount`, `Ledger` |
| `FindingRow` | **`2-3` §3.9** | `ComplianceState._live` дэх АМЬД олдворын мөр; `dedup_key` → төлөв, `2-5`-ийн `compliance_findings` руу цуваарилагдана |
| `RuleInputs` | **`2-3` §3.6/§3.7** | `collect_rule_inputs`-ыг ХҮЙТЭН эгнээгээр дуудаж `FactSet` угсардаг C# туслах (`CollectViaBus`) |
| `RuleApplicability` | **`2-3` §3.6** (класс) · **`2-2` §3.6** (предикатын СЕМАНТИК) | `MayApply` хямд урьдчилсан шүүлтийн статик класс. **Хэлбэр нь `2-3`-ынх, зан төлөв нь §4.5-ынх** — монотон байдал нь ГЭРЭЭ |
| `Iso` | **`2-3` §3.9** | ISO-8601 UTC цагийн тэмдэг үүсгэгч (`Iso.Now()`); `FindingRow`-ийн `LastEvaluatedAt` / `ResolvedAt` |
| `Session` | **`2-4` §3.9** | Нэг Revit баримтын нээлттэй сесс; `SESSION_START`/`SESSION_END`-ийн эзэн |
| `SessionOf` | **`2-4` §3.9** | `docKey` → `Session`; ШИНЭ сесс үүсгэх агшинд `SESSION_START` дараалалд орно |
| `TxnEnvelope` | **`2-4` §3.9** | Гүйлгээ тутам НЭГ дугтуй (`t:"txn"`, ≤24 touch); JSON нь ЗӨВХӨН `_pump` дээр үүснэ |
| `DegradeState` | **`2-4` §3.10** | `AiHttp`-ийн ажиглагдах доройтлын төлөв (§32-ын «observable status») |
| `LogicalChangeSet`, `DirtyElement` | **`2-4`** (коалесцер) | ⚠️ `DirtyElement.Category` / `.Change` / `.ElementUid` нь §1.3-ын `origin='dirty'` баримтын ЦОРЫН ГАНЦ эх сурвалж |
| `Quantity`, `QuantitySource`, `Units` | **`2-2` §3.8** | Энэ хавсралт тэднийг ХӨНДӨӨГҮЙ; `FactValue` нь тэднийг АГУУЛНА (§4.2) |
| `clampByVerification`, `SEVERITY_RANK`, `VERDICTS`, `ISSUE_CLASSES`, `EVIDENCE_LEVELS` | **`2-2` §3.5** | `complianceModel.ts`-д аль хэдийн зарлагдсан. ⚠️ `2-3` §3.1-ийн блок мөн ТЭР ФАЙЛД нэмэгдэнэ — ижил `export const`-ыг хоёр удаа зарлавал файл компайл БОЛОХГҮЙ |

---

## 12. НЭЭЛТТЭЙ — ЭНЭ ХАВСРАЛТ ЗОРИУД ШИЙДЭЭГҮЙ

> §5, §6, §7-ыг ЭНД шийдсэн (хэрэгжүүлэлт тэдгээр дээр блоклогдсон). Доорх нь спек үнэхээр нээлттэй орхисон, БАС хэрэгжүүлэлтийг блокЛОХГҮЙ зүйлс.

| # | Асуулт | Яагаад одоо шийдэхгүй байна вэ | Хэн шийднэ |
|---|---|---|---|
| 1 | **АВТОРЛОСОН `project_build_context.room_boundary_location` нь АМЬД `doc.room_boundary_location`-ээс зөрвөл юу болох вэ?** §4.4 нь амьд нь дардаг гэж шийдсэн (хэмжсэн үнэн давамгайлна), гэхДЭЭ зөрүү нь өөрөө **дохио** — «архитектор Finish гэж бичсэн, загвар Center дээр байна» гэдэг нь бодит загварын чанарын олдвор байж болно | Тийм олдвор гаргах эсэх нь `2-3`-ын олдворын амьдралын мөчлөгийн шийдвэр; энэ хавсралт төрөл зохиох эрхгүй. Мөн `2-2` §9.2-ийн 7-р асуулт (бодит MGL төслүүд дээр boundary location ЮУ БАЙНА) хэмжигдээгүй хэвээр | `2-3` + эзэн |
| 2 | **`2-3` §3.5-ын `requires_json.relations` (`host`, `boundary`) нь 0221-д БАГАНАГҮЙ.** `rules` хүснэгтэд `requires_relations_json` БАЙХГҮЙ, хоёр ажлын жишээний аль нь ч хэрэглээгүй | Тиймээс `RuleRequires` нь v1-д ЗӨВХӨН `params` + `triggeredBy`. `relations` нэвтрүүлэх нь ШИНЭ БАГАНА (шинэ migration) + `RuleFactExtractor`-ын шинэ уншилтын горим — хоёулаа энэ хавсралтын эрхээс гадуур. **`relations` талбарыг «ирээдүйд хэрэгтэй болно» гэж одоо нэмэх нь хамгийн муу хувилбар**: багцад хоосон талбар очиж, хэрэгжээгүй мөртлөө хэрэгжсэн мэт уншигдана | `2-3` (шаардлагыг батал) → шинэ migration |
| 3 | **Жагсаалт утгатай баримт** (`project.specialRequirements`, `special_requirements_json`) нь илэрхийллээс ХАНДАХ БОЛОМЖГҮЙ. `FactKind` нь `number \| text` хоёрхон | Жагсаалтын оператор (`any_of`, `all_of`) нэмэх нь хаалттай олонлогийг ӨРГӨТГӨНӨ ба Kleene-ийн min/max арифметикт шинэ тохиолдол оруулна. **Тэр багана ашигладаг НЭГ Ч дүрэм өнөөдөр БАЙХГҮЙ** (дүрмийн корпус зогссон, Ш4) — шаардлагагүй чадвар нэмэхийг §0-ийн 6-р дүрэм хориглоно | Эзний БНбД баримт ирж, жагсаалт шаардсан бодит заалт гарсны ДАРАА |
| 4 | **`exceptions` нь `semantic_hash`-д ОРОХГҮЙ** (§6.4). Тиймээс үл хамаарах зүйл нэмэх нь дүрмийн «логикийн ижил төстэй байдлыг» хөдөлгөхгүй | `2-2` §3.7-ийн томьёо (`applicability + check + unit`) нь ил бичигдсэн гэрээ; түүнийг өргөтгөх нь `2-3`-ын `ruleset` хуучруулалтын семантикийг өөрчилнө. Одоохондоо `version` bump л мөшгинө | Эзэн/`2-3` — зөвхөн бодит үл хамаарах зүйлтэй дүрэм гарсны дараа |
| 5 | **`FactBag` нь баримтыг КЭШЛЭХ үү?** Нэг мөчлөгт нэг элемент дээр 3 дүрэм ажиллавал `doc.*` / `project.*` дахин шийдэгдэнэ | Гүйцэтгэл нь ХЭМЖИГДЭЭГҮЙ (`2-2` §9.2-ийн 9-р асуулт — өдрийн үйл явдлын хурд ч хэмжигдээгүй). `EvalSoftBudgetMs = 250` / `EvalAbortMs = 2000` (`2-3` §3.6) нь бодит тоо гарах хүртэл хаалга болно. **Кэш нэмэх нь `Percentiles.RuleEval` хэмжсэний ДАРААХ оптимизаци** | `2-3` — `Metrics.RuleEval` тоо гарсны дараа |
| 6 | **`element.category` нь ЯГ НЭГ утгатай юу?** Revit-ийн зарим элемент (жишээ нь `RevitLinkInstance` доторх) хоёрдмол утгатай категоритой байж болох уу | 46 `.cs` файлд `GetTotalTransform()` БАЙХГҮЙ тул холбоос доторх геометрийн дүрэм ЯМАР Ч ТОХИОЛДОЛД `coordinate_system` хаалгаар (V11) хаагдсан. Тиймээс релиз N-д асуулт үйлчилдэггүй | `2-6` — `model_capabilities` (0239) координатын хаалгыг өргөх үед |

---

## 13. ХҮЛЭЭН АВАХ ШАЛГУУР — ЭНЭ ГЭРЭЭ БОДИТООР ХҮЧИНТЭЙ ЭСЭХ

Энэ баримт код гаргахгүй тул өөрийн гэсэн build шалгуургүй. Гэхдээ **түүнийг импортолсон сессүүд дараахыг хангаж байж энэ гэрээ ажилласан гэж тооцно:**

- [ ] `grep -c "interface RuleDef\|class RuleDef" backend/src/lib/*.ts revit-mcp/addin/*.cs` → **ХОЁУЛАА ЯГ 1** (нэг тодорхойлолт, нэг хэл)
- [ ] `grep -rn "FactBag\|BuildContext\|ProjectBuildContext" backend/src revit-mcp/addin` — тодорхойлолт нь `complianceModel.ts` ба `RuleFacts.cs`-д Л байна; бусад нь ИМПОРТ
- [ ] `parseCheck` / `TryParse` — хоёулаа `throw` БАЙХГҮЙ: `grep -c "throw" backend/src/lib/complianceModel.ts` дээрх задлагчийн блокт **0**
- [ ] Kleene: `node --test` дээр `all([]) === 2`, `any([]) === 0`, `not(1) === 1` — гурвуулаа
- [ ] `cond` нь `Unknown` нөхцөл дээр ХОЁУЛАНГ НЬ ҮНЭЛЭХГҮЙ: салаанд side-effect тавьсан тест (эсвэл `decidingLeaf === null`) баталгаажуулна
- [ ] `semantic_hash` — ижил дүрмийг TS ба C# талд тооцоолоод ЯГ ижил 64 тэмдэгт гарна (`check_rules.py --parity`-д нэмэх шалгуур)
- [ ] `pack_sha256` — багцыг ХОЁР ӨӨР `generated_at`-аар үүсгэхэд hash нь **ИЖИЛ** (§7.3)
- [ ] `%APPDATA%`-ийн багцын нэг тоог засаад Revit сэргээхэд `RulePack` ТАТГАЛЗАЖ canary руу унана (`2-2` §7-ийн гар туршилт 2)
- [ ] `MayApply` монотон: `element.name_folded` нь `Missing` байхад `BA-HR-CORRIDOR-W-001` нь `MayApply = true` буцаана (§4.5-ийн эсрэг-тест — энэ нэг тест нь бүх дүрэм чимээгүй унтрахаас хамгаална)
- [ ] `Reconcile` — хоёр `Pass` дүгнэлт ХЭЗЭЭ Ч `Uncertain` болохгүй (§8.4-ийн 1-р алхам)
- [ ] `Reconcile` — оролтын массивын дарааллыг ЭРГҮҮЛЭХЭД гаралтын `RuleUid` ба `ConflictRuleUids` ӨӨРЧЛӨГДӨХГҮЙ (dedup түлхүүрийн тогтвортой байдал)

---

### Хавсралтын хавсралт — энэ баримт хаана ЭЦЭГ СПЕКЭЭ ЗАСВАРЛАВ

| Юу | Эцэг баримт хэлсэн нь | Энд шийдсэн нь | Яагаад |
|---|---|---|---|
| `if/then/else` | §3.9-ийн хаалттай олонлогт БАЙХГҮЙ, гэтэл §3.7-ийн хоёр жишээ хэрэглэсэн | `cond` зангилаа НЭМЭГДЭВ; арван оператор ХЭВЭЭР; `applicability`-д ХОРИОТОЙ | §5.2 — босго алдагдах ба гараар үгүйсгэх цоорхойн эсрэг |
| `canonical()` | Нэрлэсэн, тодорхойлоогүй | **MGL-CANON-1** = RFC 8785 + тооны профайл | §6 — хоёр хэрэгжүүлэлт зөрөх нь дүрмийн ижил төстэй байдлыг эвдэнэ |
| `pack_sha256` | Тойрог тодорхойлолт | `pack_sha256` **ба** `generated_at` хоёрыг `""` болгож хэшлэнэ | §7.3 — `generated_at` хэшид үлдвэл `2-3`-ын хуучруулалт шалтгаангүй асна |
| `Quantity` ганцаараа | §3.8 нь зөвхөн тоон бүтэц өгсөн | `FactValue` (`number \| text \| missing`) НЭМЭГДЭВ, `Quantity` ХӨНДӨГДӨӨГҮЙ | §4.1 — хоёулаа жишээ дүрэм МӨР харьцуулдаг |
| «хамгийн бага итгэлтэй нотолгоо» (§3.10) | Дараалал БАЙХГҮЙ | `EVIDENCE_RANK` хөлдөөв | §9.4 |
| `RuleOutcome`-ийн талбарууд | `2-2` §3.9 ба `2-3` §3.9 ЗӨРСӨН | `UncertainReason` НЭМЭГДЭВ; `CalcJson`/`EvidenceJson` нь `2-3`-ынх | §9.2 — `2-3` §9-ийн 13-р нээлттэй асуултын хариу |
| `MayApply` vs `evaluateApplicability` | Хоёр өөр гарын үсэг, хамаарал нь тодорхойгүй | НЭГ предикат, ХОЁР функц; `MayApply` нь **монотон урьдчилсан шүүлт** (`Unknown → true`) | §4.5 — `Unknown → false` нь бүх дүрмийг чимээгүй унтраана |
| `requires.params` угтваргүй, `requires_context` угтвартай | Зөвхөн жишээгээр далд илэрхийлэгдсэн | Ил дүрэм болгов | §1.1 |
| `QuantitySource`-ын утасны токен | Нэрлээгүй | `builtin_geometry` / `typed_param` / `untyped_param` / `computed` | §4.2 |
| `conflicts` хосын дараалал | Нэрлээгүй | `a < b` ordinal нормчлол, хоёр талд | §8.2 — `idx_rule_conflicts_pair` UNIQUE ажиллах болзол |
