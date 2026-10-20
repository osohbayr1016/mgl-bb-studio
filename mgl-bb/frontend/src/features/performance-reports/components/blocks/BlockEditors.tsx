import type { ReactNode } from 'react';
import { useLanguage } from '@/shared/i18n';
import { Label } from '@/ui/label';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import {
  type BlockType,
  type BlockContentMap,
  type BlockContent,
  type CoverOverride,
} from '@/features/performance-reports/types/performanceReportBlocks';
import type { PerformanceReport } from '@/features/performance-reports/types/performanceReport';
import type { CoverModel } from '@/features/performance-reports/lib/blockContentResolve';

/* =============================================================
 * Per-block editor forms.
 * -------------------------------------------------------------
 * Each function takes the block's typed content + an onChange
 * callback and returns the form JSX rendered inside the block's
 * accordion. Parameter-less blocks (cover, toc, project-intro,
 * summary-notes, all-team-stats) render a read-only message —
 * their data lives on the report row itself, not on the block.
 * ============================================================= */

export interface BlockEditorProps<T extends BlockType> {
  content: BlockContentMap[T];
  onChange: (next: BlockContentMap[T]) => void;
  /** The parent report — gives team-narrative / team-stats editors
   *  the list of valid team codes to pick from. */
  report: PerformanceReport;
  /** Блокийн авто render model (editor page-аас). Override талбаруудыг
   *  урьдчилан дүүргэх/placeholder-д ашиглана. Дэмжигдээгүй блокт null. */
  autoModel: unknown;
}

/** Non-generic view of BlockEditor's props: the `type` discriminant
 *  correlated with its content shape (and the cover block's auto
 *  model) as a discriminated union, so the `switch` below can narrow
 *  per block kind. TS can't narrow an unresolved generic `T`, hence
 *  the overload pair on `BlockEditor` — callers build
 *  `type`/`content`/`onChange` from the same block, so the pairing
 *  holds at runtime (`autoModelFor` returns a `CoverModel` for cover
 *  blocks and `null` otherwise). */
type NarrowedBlockEditorProps = {
  [K in BlockType]: {
    type: K;
    content: BlockContentMap[K];
    onChange: (next: BlockContentMap[K]) => void;
    report: PerformanceReport;
    autoModel: K extends 'cover' ? CoverModel | null : unknown;
  };
}[BlockType];

export function BlockEditor<T extends BlockType>(
  props: { type: T } & BlockEditorProps<T>,
): ReactNode;
export function BlockEditor(props: NarrowedBlockEditorProps): ReactNode {
  switch (props.type) {
    case 'cover':
      return (
        <CoverOverrideEditor
          content={props.content}
          onChange={props.onChange}
          autoModel={props.autoModel}
        />
      );
    case 'project-intro':
      // Танилцуулгын бүх талбар нь энэ жижиг хайрцагт багтахааргүй том тул
      // тусдаа `IntroBlockEditor` форм зүүн баганын ДЭЭД талд (энэ
      // жагсаалтаас гадна) сууна — мөн хуудсан дээр нь шууд засагдана.
      return <IntroHintMessage />;
    case 'toc':
    case 'all-team-stats':
    case 'project-sections':
      return <NoParamsMessage type={props.type} />;
    case 'team-narrative':
    case 'team-stats':
      return (
        <TeamSelectEditor content={props.content} onChange={props.onChange} report={props.report} />
      );
    case 'rich-text':
      return <RichTextEditor content={props.content} onChange={props.onChange} />;
    case 'divider':
      return <DividerEditor content={props.content} onChange={props.onChange} />;
    default:
      return null;
  }
}

/** «Төслийн танилцуулга» блокийн зааварчилгаа — жинхэнэ форм нь
 *  дээрх `IntroBlockEditor` карт, эсвэл урьдчилан харах хуудас өөрөө. */
function IntroHintMessage() {
  return (
    <p className="text-xs text-muted-foreground italic">
      Энэ блокийн агуулгыг зүүн талын «Төслийн танилцуулга» хэсгээс, эсвэл урьдчилан харах хуудсан
      дээр шууд дарж засна уу.
    </p>
  );
}

function NoParamsMessage({ type }: { type: BlockType }) {
  const { t } = useLanguage();
  return (
    <p className="text-xs text-muted-foreground italic">
      {t('blockEditors.noParams')}
      <br />
      <span className="font-mono opacity-60">[{type}]</span>
    </p>
  );
}

function TeamSelectEditor({
  content,
  onChange,
  report,
}: {
  content: BlockContent<'team-narrative'>;
  onChange: (next: BlockContent<'team-narrative'>) => void;
  report: PerformanceReport;
}) {
  const { t } = useLanguage();
  const teams = report.team_progress;
  return (
    <div className="space-y-1.5">
      <Label htmlFor="team-code">{t('blockEditors.team')}</Label>
      <select
        id="team-code"
        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
        value={content.team_code}
        onChange={(e) => onChange({ team_code: e.target.value })}
      >
        <option value="">{t('blockEditors.selectPlaceholder')}</option>
        {teams.map((tp) => (
          <option key={tp.team_id} value={tp.team_code}>
            {tp.team_code} — {tp.team_name_mn}
          </option>
        ))}
        {/* If the block was pre-filled with a team that isn't in this report's
            team list, still surface it so it's visible and can be re-picked. */}
        {content.team_code && !teams.some((tp) => tp.team_code === content.team_code) && (
          <option value={content.team_code}>{content.team_code}</option>
        )}
      </select>
      {!content.team_code && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t('blockEditors.teamNotSelected')}
        </p>
      )}
    </div>
  );
}

function RichTextEditor({
  content,
  onChange,
}: {
  content: BlockContent<'rich-text'>;
  onChange: (next: BlockContent<'rich-text'>) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="space-y-2">
      <div>
        <Label htmlFor="rt-h">{t('blockEditors.heading')}</Label>
        <Input
          id="rt-h"
          value={content.heading}
          onChange={(e) => onChange({ ...content, heading: e.target.value })}
        />
      </div>
      <div>
        <Label htmlFor="rt-b">{t('blockEditors.body')}</Label>
        <Textarea
          id="rt-b"
          rows={6}
          value={content.body}
          onChange={(e) => onChange({ ...content, body: e.target.value })}
        />
      </div>
    </div>
  );
}

function DividerEditor({
  content,
  onChange,
}: {
  content: BlockContent<'divider'>;
  onChange: (next: BlockContent<'divider'>) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="space-y-1.5">
      <Label>{t('blockEditors.style')}</Label>
      <div className="flex gap-3 text-sm">
        <label className="inline-flex items-center gap-1.5">
          <input
            type="radio"
            checked={content.style === 'page-break'}
            onChange={() => onChange({ style: 'page-break' })}
          />
          {t('blockEditors.pageBreak')}
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input
            type="radio"
            checked={content.style === 'hairline'}
            onChange={() => onChange({ style: 'hairline' })}
          />
          {t('blockEditors.hairline')}
        </label>
      </div>
    </div>
  );
}

/** Cover блокийн override editor — талбаруудыг авто утгаар (placeholder)
 *  харуулж, засвал зөвхөн өөрчилсөн талбарыг override болгож хадгална. */
function CoverOverrideEditor({
  content,
  onChange,
  autoModel,
}: {
  content: { override?: CoverOverride | null };
  onChange: (next: { override?: CoverOverride | null }) => void;
  autoModel: CoverModel | null;
}) {
  const { t } = useLanguage();
  const ov = content.override ?? {};
  const auto = autoModel;

  const setField = (key: keyof CoverOverride, value: string) => {
    const nextOv: CoverOverride = { ...ov };
    if (value === '') {
      delete nextOv[key];
    } else if (key === 'reportNo') {
      const n = Number(value);
      if (Number.isFinite(n)) nextOv.reportNo = n;
      else delete nextOv.reportNo;
    } else {
      nextOv[key] = value;
    }
    const hasAny = Object.keys(nextOv).length > 0;
    onChange({ override: hasAny ? nextOv : null });
  };

  const dirty = Object.keys(ov).length > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{t('blockEditors.overrideHint')}</p>
        {dirty && (
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => onChange({ override: null })}
          >
            {t('blockEditors.resetToAuto')}
          </button>
        )}
      </div>
      <OverrideField
        label={t('blockEditors.coverFullTitle')}
        value={ov.projectFullTitle ?? ''}
        placeholder={auto?.projectFullTitle ?? ''}
        onChange={(v) => setField('projectFullTitle', v)}
      />
      <OverrideField
        label={t('blockEditors.coverClientName')}
        value={ov.clientName ?? ''}
        placeholder={auto?.clientName ?? ''}
        onChange={(v) => setField('clientName', v)}
      />
      <OverrideField
        label={t('blockEditors.coverDrawingNo')}
        value={ov.drawingNo ?? ''}
        placeholder={auto?.drawingNo ?? ''}
        onChange={(v) => setField('drawingNo', v)}
      />
      <OverrideField
        label={t('blockEditors.coverReportNo')}
        value={ov.reportNo != null ? String(ov.reportNo) : ''}
        placeholder={auto ? String(auto.reportNo) : ''}
        onChange={(v) => setField('reportNo', v)}
      />
    </div>
  );
}

/** Нэг override талбар: label + input. Placeholder нь авто утга. */
function OverrideField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
