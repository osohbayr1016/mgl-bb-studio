import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { cn } from '@/shared/lib/utils';
import {
  DEFAULT_FILE_NAMING_NOTE,
  DEFAULT_TIMELINE,
  DISCIPLINE_LABEL,
  DISCIPLINE_MN,
  INTRO_DISCIPLINES,
  rowId,
  type IntroDocRow,
  type IntroFileNamingNote,
  type IntroMeetingRow,
  type IntroModel,
  type IntroOverride,
  type IntroScopeRow,
  type IntroTimelineRow,
} from '@/features/performance-reports/types/introOverride';

/* =============================================================
 * «1. Төслийн танилцуулга» блокийн зүүн талын засварлах форм.
 * -------------------------------------------------------------
 * Урьд нь энэ блок бүрэн авто байсан тул редактор дээр захиалагч,
 * зургийн шифр гэх мэтийг өөрчлөх газар ОГТ БАЙХГҮЙ байв.  Энд
 * бичсэн бүх утга блокийн override руу л очно — `project_passport`
 * руу БИЧИХГҮЙ.
 *
 * ГОЛ ДҮРЭМ: `undefined` = «авто утга ялна», '' = «хэрэглэгч
 * цэвэрлэсэн».  Тиймээс «Авто» товч ЗААВАЛ `undefined` илгээнэ
 * (`resolveIntroModel` нь `=== undefined` шалгадаг).
 *
 * Массивуудыг ҮРГЭЛЖ `model`-оос (авто ⊕ override) хуулбарлаж
 * эхэлнэ — `override` хоосон байж болох тул түүнээс эхэлбэл
 * анхны засвар л гэхэд авто мөрүүдийг бүгдийг нь устгах байлаа.
 * ============================================================= */

export interface IntroBlockEditorProps {
  /** resolve хийгдсэн загвар (авто ⊕ override) — placeholder ба мөрүүдийн эх. */
  model: IntroModel;
  /** Зөвхөн хэрэглэгчийн бичсэн — талбар «авто» эсэхийг мэдэхэд. */
  override: IntroOverride;
  onChange: (patch: Partial<IntroOverride>) => void;
  disabled?: boolean;
}

/** 1.1-ийн энгийн текст талбарууд. */
type TextField =
  | 'projectTitle'
  | 'clientName'
  | 'drawingNo'
  | 'scope'
  | 'location'
  | 'director'
  | 'ceo';

const TEXT_FIELDS: ReadonlyArray<{ key: TextField; label: string; multiline?: boolean }> = [
  { key: 'projectTitle', label: 'Төслийн нэр' },
  { key: 'clientName', label: 'Захиалагч' },
  { key: 'drawingNo', label: 'Зургийн шифр' },
  { key: 'scope', label: 'Ажлын цар хүрээ', multiline: true },
  { key: 'location', label: 'Байршил' },
  { key: 'director', label: 'Захирал' },
  { key: 'ceo', label: 'Гүйцэтгэх захирал' },
];

/** Дисциплины «жинхэнэ» дараалал — chip дарахад жишиг тайлангийн
 *  дарааллаар эрэмбэлж хадгална (1.1-ийн ■ мөр ба 1.2 хүснэгт
 *  хоёулаа INTRO_DISCIPLINES-ээс уншдаг). */
const DISCIPLINE_ORDER = new Map(INTRO_DISCIPLINES.map((d, i) => [d.code, i]));
const orderOf = (code: string): number => DISCIPLINE_ORDER.get(code) ?? 999;

/** «Бүгдийг авто» товчинд — override-д ямар нэг утга байгаа эсэх. */
const OVERRIDE_KEYS: ReadonlyArray<keyof IntroOverride> = [
  'projectTitle',
  'clientName',
  'drawingNo',
  'docNo',
  'scope',
  'location',
  'director',
  'ceo',
  'disciplines',
  'documents',
  'scopeRows',
  'timeline',
  'meetings',
  'fileNamingNote',
  'hideFileNamingNote',
];

export function IntroBlockEditor({ model, override, onChange, disabled }: IntroBlockEditorProps) {
  /* ---------- 1.1 текст талбарууд ---------- */

  // Компьютерлэсэн түлхүүр (`{ [field]: value }`) нь `{ [x: string]: … }`
  // болж хувирдаг тул typed patch объект дээр бичив.
  const setText = (field: TextField, value: string | undefined) => {
    const patch: Partial<IntroOverride> = {};
    patch[field] = value;
    onChange(patch);
  };

  /* ---------- дисциплин ---------- */

  const activeCodes = new Set(model.disciplines);
  const toggleDiscipline = (code: string) => {
    const next = activeCodes.has(code)
      ? model.disciplines.filter((c) => c !== code)
      : [...model.disciplines, code].sort((a, b) => orderOf(a) - orderOf(b));
    onChange({ disciplines: next });
  };
  // INTRO_DISCIPLINES-д байхгүй код override-д орчихсон бол түүнийг ч
  // харуулна — эс бөгөөс дарж унтраах арга байхгүй болно.
  const extraCodes = model.disciplines.filter((c) => !DISCIPLINE_LABEL[c]);

  /* ---------- бичиг баримт ---------- */

  const docs = model.documents;
  const setDocs = (next: IntroDocRow[]) => onChange({ documents: next });
  const patchDoc = (i: number, patch: Partial<IntroDocRow>) =>
    setDocs(docs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  /* ---------- 1.2 хамрах хүрээ ---------- */

  const scopeRows = model.scopeRows;
  const setScopeRows = (next: IntroScopeRow[]) => onChange({ scopeRows: next });
  const patchScopeRow = (i: number, patch: Partial<IntroScopeRow>) =>
    setScopeRows(scopeRows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const moveScopeRow = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= scopeRows.length) return;
    const next = scopeRows.slice();
    const a = next[i];
    next[i] = next[j];
    next[j] = a;
    setScopeRows(next);
  };
  // Код сонгоход шошго ба тодорхойлолтыг урьдчилан дүүргэнэ —
  // хэрэглэгч дараа нь дарж бичиж болно.
  const pickScopeCode = (i: number, code: string) =>
    patchScopeRow(i, {
      code,
      codeLabel: DISCIPLINE_LABEL[code] ?? code,
      identification: DISCIPLINE_MN[code] ?? '',
    });

  /* ---------- 1.3 хугацаа / уулзалт ---------- */

  const timeline = model.timeline.length > 0 ? model.timeline : DEFAULT_TIMELINE;
  const patchTimeline = (i: number, patch: Partial<IntroTimelineRow>) =>
    onChange({ timeline: timeline.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) });

  const meetings = model.meetings;
  const setMeetings = (next: IntroMeetingRow[]) => onChange({ meetings: next });
  const patchMeeting = (i: number, patch: Partial<IntroMeetingRow>) =>
    setMeetings(meetings.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  /* ---------- файлын нэрийн тайлбар ---------- */

  const note = model.fileNamingNote;
  const patchNote = (patch: Partial<IntroFileNamingNote>) =>
    onChange({ fileNamingNote: { ...note, ...patch } });
  const setNoteLine = (i: number, value: string) =>
    patchNote({ lines: note.lines.map((l, idx) => (idx === i ? value : l)) });

  /* ---------- бүгдийг авто болгох ---------- */

  /* ⚠️ `!== undefined` — `''` нь «хэрэглэгч зориуд цэвэрлэсэн» гэсэн
   * ЖИНХЭНЭ override тул тоологдох ёстой. */
  const manualCount = OVERRIDE_KEYS.filter((k) => override[k] !== undefined).length;
  const hasAnyOverride = manualCount > 0;
  const resetAll = () => {
    // ⚠️ `undefined` оноох нь `applyIntroPatch` дотор ТҮЛХҮҮР УСТГАХ
    // болж хувирна (`Object.entries` нь зориуд оноосон `undefined`-ийг
    // тоолдог).  Тэр устгалгүйгээр `JSON.stringify` талбарыг хаяж,
    // сервер дээр хуучин гар утга хэвээр үлдэнэ.
    const patch: Partial<IntroOverride> = {};
    for (const k of OVERRIDE_KEYS) patch[k] = undefined;
    onChange(patch);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Хоосон орхивол авто утга (төслийн паспорт, багууд) хэвээр үлдэнэ.
          {hasAnyOverride && (
            <>
              {' '}
              <span className="font-medium text-amber-600 dark:text-amber-400">
                {manualCount} талбар гараар бичигдсэн — паспорт өөрчлөгдөхөд шинэчлэгдэхгүй.
              </span>
            </>
          )}
        </p>
        {hasAnyOverride && !disabled && (
          <button
            type="button"
            title="Бүх талбарын гар утгыг хаяж паспортын утгыг дахин татна"
            className="shrink-0 text-xs text-primary hover:underline"
            onClick={resetAll}
          >
            Бүгдийг паспортоос дахин татах
          </button>
        )}
      </div>

      {/* ---------------- 1.1 Ерөнхий мэдээлэл ---------------- */}
      <Section title="1.1 Төслийн ерөнхий мэдээлэл" defaultOpen>
        {TEXT_FIELDS.map((f) => (
          <AutoField
            key={f.key}
            label={f.label}
            value={override[f.key]}
            auto={model[f.key]}
            multiline={f.multiline}
            disabled={disabled}
            onSet={(v) => setText(f.key, v)}
            onReset={() => setText(f.key, undefined)}
          />
        ))}
      </Section>

      {/* ---------------- Дисциплин ---------------- */}
      <Section title="Ажлын хэсэг (дисциплин)">
        <RowsHeader
          hint="Тайлангийн 1.1 мөрөнд ■-ээр тэмдэглэгдэнэ."
          dirty={override.disciplines !== undefined}
          disabled={disabled}
          onReset={() => onChange({ disciplines: undefined })}
        />
        <div className="flex flex-wrap gap-1">
          {[...INTRO_DISCIPLINES.map((d) => d.code), ...extraCodes].map((code) => {
            const on = activeCodes.has(code);
            return (
              <button
                key={code}
                type="button"
                disabled={disabled}
                onClick={() => toggleDiscipline(code)}
                title={DISCIPLINE_MN[code] ?? code}
                className={cn(
                  'rounded-md border px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  on
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {DISCIPLINE_LABEL[code] ?? code}
              </button>
            );
          })}
        </div>
      </Section>

      {/* ---------------- Бичиг баримт ---------------- */}
      <Section title="Бичиг баримт">
        <RowsHeader
          hint="Геологи, геодези, гэрчилгээ гэх мэт."
          dirty={override.documents !== undefined}
          disabled={disabled}
          onReset={() => onChange({ documents: undefined })}
        />
        {docs.map((row, i) => (
          <RowBox
            key={row.id}
            index={i}
            disabled={disabled}
            onDelete={() => setDocs(docs.filter((_, idx) => idx !== i))}
          >
            <Input
              className="h-8"
              placeholder="Бичиг баримтын нэр"
              value={row.name}
              disabled={disabled}
              onChange={(e) => patchDoc(i, { name: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-1.5">
              <Input
                className="h-8"
                placeholder="Дугаар"
                value={row.no}
                disabled={disabled}
                onChange={(e) => patchDoc(i, { no: e.target.value })}
              />
              <Input
                className="h-8"
                placeholder="2025.08 сар"
                value={row.date}
                disabled={disabled}
                onChange={(e) => patchDoc(i, { date: e.target.value })}
              />
            </div>
            <Input
              className="h-8"
              placeholder="Тайлбар («Сойл Трейд» ХХК)"
              value={row.description}
              disabled={disabled}
              onChange={(e) => patchDoc(i, { description: e.target.value })}
            />
          </RowBox>
        ))}
        <AddRowButton
          label="Мөр нэмэх"
          disabled={disabled}
          onClick={() =>
            setDocs([...docs, { id: rowId('doc'), name: '', no: '', date: '', description: '' }])
          }
        />
      </Section>

      {/* ---------------- 1.2 Хамрах хүрээ ---------------- */}
      <Section title="1.2 Хамрах хүрээ">
        <RowsHeader
          hint="Дис / Тодорхойлолт / Хариуцсан ахлах / Файлын нэр."
          dirty={override.scopeRows !== undefined}
          disabled={disabled}
          resetLabel="Багаас автоматаар дүүргэх"
          onReset={() => onChange({ scopeRows: undefined })}
        />
        {scopeRows.map((row, i) => (
          <RowBox
            key={row.id}
            index={i}
            disabled={disabled}
            onDelete={() => setScopeRows(scopeRows.filter((_, idx) => idx !== i))}
            onMoveUp={i > 0 ? () => moveScopeRow(i, -1) : undefined}
            onMoveDown={i < scopeRows.length - 1 ? () => moveScopeRow(i, 1) : undefined}
            lead={
              <select
                aria-label="Дисциплин"
                className="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs disabled:opacity-50"
                value={row.code}
                disabled={disabled}
                onChange={(e) => pickScopeCode(i, e.target.value)}
              >
                <option value="">— сонгох —</option>
                {INTRO_DISCIPLINES.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.label}
                  </option>
                ))}
                {/* Каталогт байхгүй код өмнө нь хадгалагдсан бол алга болгохгүй. */}
                {row.code && !DISCIPLINE_LABEL[row.code] && (
                  <option value={row.code}>{row.codeLabel || row.code}</option>
                )}
              </select>
            }
          >
            <div className="grid grid-cols-[4.5rem_1fr] gap-1.5">
              <Input
                className="h-8"
                placeholder="Шошго"
                value={row.codeLabel}
                disabled={disabled}
                onChange={(e) => patchScopeRow(i, { codeLabel: e.target.value })}
              />
              <Input
                className="h-8"
                placeholder="Тодорхойлолт"
                value={row.identification}
                disabled={disabled}
                onChange={(e) => patchScopeRow(i, { identification: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <Input
                className="h-8"
                placeholder="Хариуцсан ахлах"
                value={row.leader}
                disabled={disabled}
                onChange={(e) => patchScopeRow(i, { leader: e.target.value })}
              />
              {/* «Хариуцсан мэргэжилтэн» — жишиг Word баримтын 2 дахь нэр.
                  Хэвлэлд багана нь ЗӨВХӨН аль нэг мөр дүүрсэн үед гарна. */}
              <Input
                className="h-8"
                placeholder="Хариуцсан мэргэжилтэн"
                value={row.specialist}
                disabled={disabled}
                onChange={(e) => patchScopeRow(i, { specialist: e.target.value })}
              />
              <Input
                className="h-8"
                placeholder="240918_MAX_URGUU_BA_B"
                value={row.fileName}
                disabled={disabled}
                onChange={(e) => patchScopeRow(i, { fileName: e.target.value })}
              />
            </div>
          </RowBox>
        ))}
        <AddRowButton
          label="Мөр нэмэх"
          disabled={disabled}
          onClick={() =>
            setScopeRows([
              ...scopeRows,
              {
                id: rowId('sc'),
                code: '',
                codeLabel: '',
                identification: '',
                leader: '',
                specialist: '',
                fileName: '',
              },
            ])
          }
        />
      </Section>

      {/* ---------------- 1.3 Хугацаа ---------------- */}
      <Section title="1.3 Төслийн хугацаа">
        <RowsHeader
          hint="Эхлэх / Дуусах / Сунгалт."
          dirty={override.timeline !== undefined}
          disabled={disabled}
          onReset={() => onChange({ timeline: undefined })}
        />
        {timeline.map((row, i) => (
          <div key={row.id} className="grid grid-cols-2 items-center gap-1.5">
            <Label className="text-xs text-muted-foreground">{row.labelMn || row.labelEn}</Label>
            <Input
              className="h-8"
              placeholder="2025.06.23"
              value={row.date}
              disabled={disabled}
              onChange={(e) => patchTimeline(i, { date: e.target.value })}
            />
          </div>
        ))}

        <div className="space-y-1.5 border-t pt-2">
          <RowsHeader
            hint="Хэлэлцүүлгийн хуваарь (30% / 50% / 100%)."
            dirty={override.meetings !== undefined}
            disabled={disabled}
            onReset={() => onChange({ meetings: undefined })}
          />
          {meetings.map((row, i) => (
            <div key={row.id} className="flex items-center gap-1.5">
              <Input
                className="h-8 w-20"
                placeholder="30%"
                value={row.label}
                disabled={disabled}
                onChange={(e) => patchMeeting(i, { label: e.target.value })}
              />
              <Input
                className="h-8 flex-1"
                placeholder="2025.07.31"
                value={row.date}
                disabled={disabled}
                onChange={(e) => patchMeeting(i, { date: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={disabled}
                title="Устгах"
                onClick={() => setMeetings(meetings.filter((_, idx) => idx !== i))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <AddRowButton
            label="Уулзалт нэмэх"
            disabled={disabled}
            onClick={() => setMeetings([...meetings, { id: rowId('mt'), label: '', date: '' }])}
          />
        </div>
      </Section>

      {/* ---------------- Файлын нэрийн тайлбар ---------------- */}
      <Section title="Файлын нэрийн тайлбар">
        <RowsHeader
          hint="1.2 хүснэгтийн доорх хүрээтэй хайрцаг."
          dirty={override.fileNamingNote !== undefined}
          disabled={disabled}
          onReset={() => onChange({ fileNamingNote: undefined })}
        />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={model.hideFileNamingNote}
            disabled={disabled}
            onChange={(e) => onChange({ hideFileNamingNote: e.target.checked ? true : undefined })}
          />
          Хайрцгийг нуух
        </label>
        {!model.hideFileNamingNote && (
          <>
            <Input
              className="h-8"
              placeholder={DEFAULT_FILE_NAMING_NOTE.title}
              value={note.title}
              disabled={disabled}
              onChange={(e) => patchNote({ title: e.target.value })}
            />
            <Input
              className="h-8 font-mono text-xs"
              placeholder={DEFAULT_FILE_NAMING_NOTE.pattern}
              value={note.pattern}
              disabled={disabled}
              onChange={(e) => patchNote({ pattern: e.target.value })}
            />
            {note.lines.map((line, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Input
                  className="h-8 text-xs"
                  placeholder="*A,B,C… -Revision for review-Ажлын явцын өөрчлөлт"
                  value={line}
                  disabled={disabled}
                  onChange={(e) => setNoteLine(i, e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={disabled}
                  title="Устгах"
                  onClick={() => patchNote({ lines: note.lines.filter((_, idx) => idx !== i) })}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <AddRowButton
              label="Мөр нэмэх"
              disabled={disabled}
              onClick={() => patchNote({ lines: [...note.lines, ''] })}
            />
          </>
        )}
      </Section>
    </div>
  );
}

/* =============================================================
 * Дэд бүрэлдэхүүнүүд — бүгд модулийн ТҮВШИНД зарлагдсан.
 * (IntroBlockEditor дотор зарлавал render бүрд шинэ бүрэлдэхүүн
 *  үүсч, React бүх input-ыг unmount хийж бичиж байхад фокус алдана.)
 * ============================================================= */

/** Хумидаг хэсэг — форм урт учир 1.1-ээс өөр нь хумигдсан байна. */
function Section({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="rounded-md border bg-card/50">
      <summary className="cursor-pointer px-2.5 py-2 text-sm font-medium select-none hover:text-primary">
        {title}
      </summary>
      <div className="space-y-2 border-t p-2.5">{children}</div>
    </details>
  );
}

/** «ГАРААР» тэмдэг — талбар паспортоос ТАСАРСАН гэдгийг харуулна.
 *  ⚠️ Энэ тэмдэг байхгүй байсан нь бодит алдааны эх сурвалж: хэрэглэгч
 *  нэг удаа бичсэн утга нь override-д ҮҮРД үлдэж, паспорт дараа нь
 *  засагдсан ч тайлан ХУУЧИН утгыг чимээгүй хэвлэсээр байдаг. */
function ManualBadge() {
  return (
    <span
      title="Энэ талбар гараар бичигдсэн — паспорт өөрчлөгдөхөд ШИНЭЧЛЭГДЭХГҮЙ."
      className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-1 py-px text-[10px] leading-none font-medium text-amber-600 dark:text-amber-400"
    >
      Гараар
    </span>
  );
}

/** «Паспортоос дахин татах» холбоос.
 *  ⚠️ `onReset` нь override объектоос ТҮЛХҮҮРИЙГ УСТГАХ ёстой (дуудагч
 *  `PerformanceReportEditorPage.applyIntroPatch` үүнийг хийдэг).  `''`
 *  оноох нь «хэрэглэгч зориуд цэвэрлэсэн» гэсэн ӨӨР утга, харин
 *  `undefined`-ээр ҮЛДЭЭХ нь `JSON.stringify` дээр алга болж хадгалахад
 *  хуучин утга буцаж амилна. */
function RepullLink({
  disabled,
  label = 'Паспортоос дахин татах',
  onReset,
}: {
  disabled?: boolean;
  label?: string;
  onReset: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onReset}
      title="Гараар бичсэнийг хаяж, паспортын (авто) утгыг дахин татна"
      className="shrink-0 text-[11px] text-primary hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline disabled:opacity-40"
    >
      {label}
    </button>
  );
}

/** Нэг override талбар: шошго + «Гараар» тэмдэг + дахин татах + input.
 *  Placeholder нь ҮРГЭЛЖ авто утга — хоосон талбар юу гарахыг харуулна. */
function AutoField({
  label,
  value,
  auto,
  multiline,
  disabled,
  onSet,
  onReset,
}: {
  label: string;
  /** `undefined` = авто; '' = хэрэглэгч зориуд цэвэрлэсэн. */
  value: string | undefined;
  auto: string;
  multiline?: boolean;
  disabled?: boolean;
  onSet: (v: string) => void;
  onReset: () => void;
}) {
  const dirty = value !== undefined;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <Label className="flex items-center gap-1.5 text-xs">
          {label}
          {dirty && <ManualBadge />}
        </Label>
        {dirty && <RepullLink disabled={disabled} onReset={onReset} />}
      </div>
      {multiline ? (
        <Textarea
          rows={2}
          value={value ?? ''}
          placeholder={auto}
          disabled={disabled}
          onChange={(e) => onSet(e.target.value)}
        />
      ) : (
        <Input
          className="h-8"
          value={value ?? ''}
          placeholder={auto}
          disabled={disabled}
          onChange={(e) => onSet(e.target.value)}
        />
      )}
    </div>
  );
}

/** Массив хэсгийн толгой: тайлбар + «Гараар» тэмдэг + дахин татах. */
function RowsHeader({
  hint,
  dirty,
  disabled,
  resetLabel = 'Паспортоос дахин татах',
  onReset,
}: {
  hint: string;
  dirty: boolean;
  disabled?: boolean;
  resetLabel?: string;
  onReset: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {hint}
        {dirty && <ManualBadge />}
      </p>
      {dirty && <RepullLink disabled={disabled} label={resetLabel} onReset={onReset} />}
    </div>
  );
}

/** Нэг мөрийн хайрцаг: дугаар + (сонгох талбар) + дээш/доош/устгах. */
function RowBox({
  index,
  disabled,
  lead,
  onDelete,
  onMoveUp,
  onMoveDown,
  children,
}: {
  index: number;
  disabled?: boolean;
  lead?: ReactNode;
  onDelete: () => void;
  onMoveUp?: (() => void) | undefined;
  onMoveDown?: (() => void) | undefined;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5 rounded-md border p-2">
      <div className="flex items-center gap-1.5">
        <span className="w-4 shrink-0 text-[11px] text-muted-foreground">{index + 1}.</span>
        {lead}
        <div className="ml-auto flex items-center gap-0.5">
          {onMoveUp && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={disabled}
              title="Дээш"
              onClick={onMoveUp}
            >
              <ChevronUp />
            </Button>
          )}
          {onMoveDown && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={disabled}
              title="Доош"
              onClick={onMoveDown}
            >
              <ChevronDown />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={disabled}
            title="Мөр устгах"
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      {children}
    </div>
  );
}

function AddRowButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button type="button" variant="outline" size="xs" disabled={disabled} onClick={onClick}>
      <Plus />
      {label}
    </Button>
  );
}
