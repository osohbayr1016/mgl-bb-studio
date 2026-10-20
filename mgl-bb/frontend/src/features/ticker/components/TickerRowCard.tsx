import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Loader2, RotateCcw, Trash2 } from 'lucide-react';

import { pickLocalized, useLanguage } from '@/shared/i18n';
import { TICKER_TONE_TAG } from '@/shared/components/HeaderTicker';
import { cn } from '@/shared/lib/utils';
import { Announcement, AnnouncementTag, AnnouncementTitle } from '@/ui/announcement';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Switch } from '@/ui/switch';

import { TICKER_TONES, type TickerFieldPatch, type TickerRow, type TickerTone } from '../api';

/**
 * Гүйдэг мэдээний НЭГ мөрийн засварлагч.
 *
 * Хоёр төрөл (`builtin` / `message`) НЭГ картаар засагдана — ялгаа нь
 * зөвхөн: суурин мөр нь холбоос/огноогүй, текстээ хоосон үлдээвэл
 * ӨГӨГДМӨЛ орчуулга руугаа буцдаг; гараар бичсэн мэдээ нь текстгүй
 * байж болохгүй.
 *
 * ⚠️ Урьдчилсан харагдац дээр `{placeholder}`-уудыг ЗОРИУД орлуулахгүй —
 *    админ загварыг нь засаж байгаа тул `{present}/{total}` гэж яг
 *    бичигдсэнээрээ харагдах ёстой.  Утга нь толгой дээр бөглөгдөнө.
 */

/** Суурин мөрийн өнгийг «өгөгдмөлөөр» үлдээх сентинел (Radix хоосон утга зөвшөөрдөггүй). */
const INHERIT = 'inherit';

interface Draft {
  text_mn: string;
  text_en: string;
  tag_mn: string;
  tag_en: string;
  tone: TickerTone | typeof INHERIT;
  href: string;
  starts_on: string;
  ends_on: string;
}

function draftOf(row: TickerRow): Draft {
  if (row.kind === 'builtin') {
    const b = row.builtin;
    return {
      text_mn: b.text_mn ?? '',
      text_en: b.text_en ?? '',
      tag_mn: b.tag_mn ?? '',
      tag_en: b.tag_en ?? '',
      tone: b.tone ?? INHERIT,
      href: '',
      starts_on: '',
      ends_on: '',
    };
  }
  const m = row.message;
  return {
    text_mn: m.text_mn,
    text_en: m.text_en ?? '',
    tag_mn: m.tag_mn ?? '',
    tag_en: m.tag_en ?? '',
    tone: m.tone,
    href: m.href ?? '',
    starts_on: m.starts_on ?? '',
    ends_on: m.ends_on ?? '',
  };
}

const nullIfBlank = (v: string): string | null => (v.trim() ? v.trim() : null);

function patchOf(row: TickerRow, d: Draft): TickerFieldPatch {
  const base: TickerFieldPatch = {
    text_mn: nullIfBlank(d.text_mn),
    text_en: nullIfBlank(d.text_en),
    tag_mn: nullIfBlank(d.tag_mn),
    tag_en: nullIfBlank(d.tag_en),
    tone: d.tone === INHERIT ? null : d.tone,
  };
  if (row.kind === 'builtin') return base;
  return {
    ...base,
    href: nullIfBlank(d.href),
    starts_on: nullIfBlank(d.starts_on),
    ends_on: nullIfBlank(d.ends_on),
  };
}

interface Props {
  row: TickerRow;
  /** Шинээр нэмж буй (хараахан хадгалагдаагүй) мөр үү. */
  isNew?: boolean;
  first?: boolean;
  last?: boolean;
  busy?: boolean;
  onMove?: (dir: -1 | 1) => void;
  onToggleActive?: (active: boolean) => void;
  onSave: (patch: TickerFieldPatch) => void;
  onDelete?: () => void;
  onReset?: () => void;
  onCancel?: () => void;
}

export function TickerRowCard({
  row,
  isNew = false,
  first = false,
  last = false,
  busy = false,
  onMove,
  onToggleActive,
  onSave,
  onDelete,
  onReset,
  onCancel,
}: Props) {
  const { t, lang } = useLanguage();
  const [open, setOpen] = useState(isNew);
  /** Шинэ мөр нээгдэнгүүтээ улаан «заавал» бичиг гаргах нь ЗҮГЭЭР Л ЗАНДАРСАН
   *  харагдана — хэрэглэгч бичиж эхэлсний дараа л шалгана. */
  const [touched, setTouched] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(row));

  /* Сервер талын утга солигдвол (хадгалсны дараах refetch) ноорогийг
   * шинэчилнэ.  Гарын үсэг нь утгуудаас гардаг тул ӨӨРЧЛӨГДӨӨГҮЙ
   * refetch хэрэглэгчийн бичиж байгаа зүйлийг цохихгүй. */
  const signature = JSON.stringify(draftOf(row));
  useEffect(() => {
    if (isNew) return;
    setDraft(JSON.parse(signature) as Draft);
  }, [signature, isNew]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const isBuiltin = row.kind === 'builtin';
  const active = isBuiltin ? row.builtin.is_active === 1 : row.message.is_active === 1;
  const dirty = JSON.stringify(draft) !== signature;
  const textMissing = !isBuiltin && !draft.text_mn.trim();

  /** Дарж бичсэн зүйл байгаа эсэх — «анхны хэвэнд нь» товч зөвхөн тэгэхэд. */
  const overridden =
    isBuiltin &&
    (row.builtin.text_mn !== null ||
      row.builtin.text_en !== null ||
      row.builtin.tag_mn !== null ||
      row.builtin.tag_en !== null ||
      row.builtin.tone !== null);

  /* ── Урьдчилсан харагдац — толгой дээрх капсулын яг хуулбар ─────── */
  const defaultText = isBuiltin ? t(row.builtin.default_text_key) : '';
  const defaultTag = isBuiltin ? t(row.builtin.default_tag_key) : t('ticker.tagNews');
  const previewTone: TickerTone =
    draft.tone === INHERIT ? (isBuiltin ? row.builtin.default_tone : 'default') : draft.tone;
  const previewTag = pickLocalized(lang, draft.tag_mn, draft.tag_en) || defaultTag;
  const previewText =
    pickLocalized(lang, draft.text_mn, draft.text_en) || defaultText || t('tickerAdmin.emptyText');

  /** Загварт ямар орлуулагч байдгийг өгөгдмөл текстээс нь ӨӨРӨӨ олно. */
  const tokens = useMemo(
    () => Array.from(new Set(defaultText.match(/\{\w+\}/g) ?? [])),
    [defaultText],
  );

  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card p-3 transition-opacity md:p-4',
        !active && !isNew && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-2">
        {!isNew && (
          <div className="flex flex-col">
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              disabled={first || busy}
              aria-label={t('tickerAdmin.moveUp')}
              onClick={() => onMove?.(-1)}
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              disabled={last || busy}
              aria-label={t('tickerAdmin.moveDown')}
              onClick={() => onMove?.(1)}
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-micro">
              {isBuiltin ? t('tickerAdmin.kindAuto') : t('tickerAdmin.kindManual')}
            </Badge>
            {isBuiltin && (
              <span className="text-micro text-muted-foreground">
                {t(`tickerAdmin.builtin.${row.builtin.key}`)}
              </span>
            )}
            {overridden && (
              <Badge variant="secondary" className="text-micro">
                {t('tickerAdmin.overridden')}
              </Badge>
            )}
          </div>

          <Announcement className="max-w-full border-border bg-muted/40 shadow-none">
            <AnnouncementTag className={TICKER_TONE_TAG[previewTone]}>{previewTag}</AnnouncementTag>
            <AnnouncementTitle className="text-micro text-foreground">
              {previewText}
            </AnnouncementTitle>
          </Announcement>
        </div>

        <div className="flex items-center gap-2">
          {!isNew && (
            <Switch
              checked={active}
              disabled={busy}
              onCheckedChange={(v) => onToggleActive?.(v)}
              aria-label={t('tickerAdmin.visible')}
            />
          )}
          {!isNew && (
            <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
              {open ? t('common.close') : t('common.edit')}
            </Button>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('tickerAdmin.textMn')}</Label>
              <Input
                value={draft.text_mn}
                placeholder={isBuiltin ? defaultText : ''}
                maxLength={200}
                onChange={(e) => {
                  setTouched(true);
                  set('text_mn', e.target.value);
                }}
              />
              {textMissing && touched && (
                <p className="text-micro text-danger">{t('tickerAdmin.textRequired')}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('tickerAdmin.textEn')}</Label>
              <Input
                value={draft.text_en}
                placeholder={t('tickerAdmin.fallbackMn')}
                maxLength={200}
                onChange={(e) => set('text_en', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('tickerAdmin.tagMn')}</Label>
              <Input
                value={draft.tag_mn}
                placeholder={defaultTag}
                maxLength={24}
                onChange={(e) => set('tag_mn', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('tickerAdmin.tagEn')}</Label>
              <Input
                value={draft.tag_en}
                placeholder={t('tickerAdmin.fallbackMn')}
                maxLength={24}
                onChange={(e) => set('tag_en', e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('tickerAdmin.tone')}</Label>
              <Select
                value={draft.tone}
                onValueChange={(v) => set('tone', v as Draft['tone'])}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {isBuiltin && (
                    <SelectItem value={INHERIT}>{t('tickerAdmin.toneInherit')}</SelectItem>
                  )}
                  {TICKER_TONES.map((tone) => (
                    <SelectItem key={tone} value={tone}>
                      {t(`tickerAdmin.tone.${tone}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!isBuiltin && (
              <div className="space-y-1.5">
                <Label className="text-xs">{t('tickerAdmin.href')}</Label>
                <Input
                  value={draft.href}
                  placeholder="/app/projects"
                  maxLength={200}
                  onChange={(e) => set('href', e.target.value)}
                />
                <p className="text-micro text-muted-foreground">{t('tickerAdmin.hrefHint')}</p>
              </div>
            )}
          </div>

          {!isBuiltin && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('tickerAdmin.startsOn')}</Label>
                <Input
                  type="date"
                  value={draft.starts_on}
                  onChange={(e) => set('starts_on', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('tickerAdmin.endsOn')}</Label>
                <Input
                  type="date"
                  value={draft.ends_on}
                  onChange={(e) => set('ends_on', e.target.value)}
                />
              </div>
            </div>
          )}

          {tokens.length > 0 && (
            <p className="text-micro text-muted-foreground">
              {t('tickerAdmin.tokensHint', { tokens: tokens.join(' ') })}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={busy || textMissing || (!dirty && !isNew)}
              onClick={() => onSave(patchOf(row, draft))}
            >
              {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {isNew ? t('tickerAdmin.create') : t('common.save')}
            </Button>
            {isNew && (
              <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
                {t('common.cancel')}
              </Button>
            )}
            {overridden && onReset && (
              <Button size="sm" variant="ghost" onClick={onReset} disabled={busy}>
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                {t('tickerAdmin.reset')}
              </Button>
            )}
            {!isBuiltin && !isNew && onDelete && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto text-danger hover:text-danger"
                onClick={onDelete}
                disabled={busy}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                {t('common.delete')}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default TickerRowCard;
