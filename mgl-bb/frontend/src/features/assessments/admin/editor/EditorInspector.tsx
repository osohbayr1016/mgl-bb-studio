/**
 * Баруун талын тохиргооны панель.
 *
 * Голын хуудсанд ТЕКСТ засагдана; тоон/бүтцийн тохиргоо (жин, код, шатлал,
 * график, хуудаслалт) энд байрлана — эс бөгөөс ажилтны харагдацыг тольдох
 * зорилго эвдэрнэ.  Дээд хэсэгт сонгосон зүйл, доор нь асуулгын мета.
 */
import { useMemo, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';

import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import type { Team, User } from '@/shared/types';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Switch } from '@/ui/switch';
import { Textarea } from '@/ui/textarea';

import type { EditorSelection } from '../../lib/editorPages';
import {
  codeFromTitle,
  locate,
  scaleOf,
  sectionItemCount,
  updateItem,
  updateMeta,
  updatePart,
  updateSection,
  updateSeniorUserIds,
  updateTeamCodes,
} from '../../lib/schemaDraft';
import type { SchemaDraft } from '../../lib/schemaDraft';
import { ScalesDialog } from './ScalesDialog';

interface Props {
  draft: SchemaDraft;
  selected: EditorSelection | null;
  teams: Team[];
  onChange: (next: SchemaDraft) => void;
  onCommit: () => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export function EditorInspector({ draft, selected, teams, onChange, onCommit }: Props) {
  const { t } = useLanguage();
  const [scalesOpen, setScalesOpen] = useState(false);

  // Үнэлэгчээр зөвхөн идэвхтэй `senior` эрхтэй хүн сонгогдоно.  `PublishDialog`
  // мөн ижил түлхүүрээр татдаг тул TanStack хоёр дахь хүсэлт явуулахгүй.
  const usersQuery = useApiQuery<{ users: User[] }>('/users', { retry: false });
  const seniors = useMemo(
    () =>
      (usersQuery.data?.users ?? []).filter((u) => u.role === 'senior' && u.status === 'active'),
    [usersQuery.data],
  );

  const found =
    selected && selected.kind !== 'intro' ? locate(draft, selected) : null;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      {/* ------------------------- Сонгосон зүйл ------------------------- */}
      <section className="space-y-3 rounded-lg border p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('assessments.editor.inspectorSelected')}
        </h3>

        {!selected || (selected.kind !== 'intro' && !found) ? (
          <p className="text-sm text-muted-foreground">{t('assessments.builder.selectNode')}</p>
        ) : selected.kind === 'intro' ? (
          <p className="text-sm text-muted-foreground">
            {t('assessments.editor.introNoSettings')}
          </p>
        ) : selected.kind === 'part' && found ? (
          <div className="space-y-3">
            <Field label={t('assessments.builder.fieldScale')}>
              <Select
                value={found.part.scaleId}
                onValueChange={(v) => {
                  onChange(updatePart(draft, found.part.key, { scaleId: v }));
                  onCommit();
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {draft.scales.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label || s.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('assessments.builder.fieldChart')}>
              <Select
                value={found.part.chart}
                onValueChange={(v) => {
                  onChange(
                    updatePart(draft, found.part.key, { chart: v as 'scatter' | 'radar' }),
                  );
                  onCommit();
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="scatter">{t('assessments.builder.chartScatter')}</SelectItem>
                  <SelectItem value="radar">{t('assessments.builder.chartRadar')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('assessments.builder.fieldPaging')}>
              <Select
                value={found.part.paging}
                onValueChange={(v) => {
                  onChange(
                    updatePart(draft, found.part.key, { paging: v as 'section' | 'part' }),
                  );
                  onCommit();
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="section">{t('assessments.builder.pagingSection')}</SelectItem>
                  <SelectItem value="part">{t('assessments.builder.pagingPart')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={found.part.weighted}
                onCheckedChange={(v) => {
                  onChange(updatePart(draft, found.part.key, { weighted: v }));
                  onCommit();
                }}
              />
              {t('assessments.builder.fieldWeighted')}
            </label>
          </div>
        ) : selected.kind === 'section' && found?.section ? (
          <div className="space-y-3">
            <Field label={t('assessments.builder.fieldCode')}>
              <div className="flex gap-1">
                <Input
                  value={found.section.code}
                  onChange={(e) =>
                    onChange(updateSection(draft, selected.key, { code: e.target.value }))
                  }
                  onBlur={onCommit}
                />
                <Button
                  variant="outline"
                  size="sm"
                  title={t('assessments.builder.codeFromTitle')}
                  onClick={() => {
                    const section = found.section;
                    if (!section) return;
                    onChange(
                      updateSection(draft, selected.key, { code: codeFromTitle(section.title) }),
                    );
                    onCommit();
                  }}
                >
                  A→Z
                </Button>
              </div>
            </Field>
            {found.part.weighted && (
              <Field label={t('assessments.builder.fieldWeight')}>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={found.section.weight}
                  onChange={(e) =>
                    onChange(
                      updateSection(draft, selected.key, {
                        weight: Number(e.target.value) || 0,
                      }),
                    )
                  }
                  onBlur={onCommit}
                />
              </Field>
            )}
            <p className="text-xs text-muted-foreground">
              {t('assessments.builder.rowsMust', {
                rows: sectionItemCount(found.section),
                must: sectionItemCount(found.section) * scaleOf(draft, found.part).max,
              })}
            </p>
          </div>
        ) : selected.kind === 'item' && found?.item ? (
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={Boolean(found.item.reverse)}
              onCheckedChange={(v) => {
                onChange(updateItem(draft, selected.key, { reverse: v }));
                onCommit();
              }}
            />
            {t('assessments.builder.fieldReverse')}
          </label>
        ) : (
          <p className="text-sm text-muted-foreground">{t('assessments.editor.groupNoSettings')}</p>
        )}
      </section>

      {/* --------------------------- Асуулгын мета --------------------------- */}
      <section className="space-y-3 rounded-lg border p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('assessments.editor.inspectorTemplate')}
        </h3>

        <Field label={t('assessments.builder.metaCode')}>
          <Input
            value={draft.code}
            placeholder="architect-v1"
            onChange={(e) => onChange(updateMeta(draft, { code: e.target.value }))}
            onBlur={onCommit}
          />
        </Field>
        <Field label={t('assessments.builder.metaTitleMn')}>
          <Input
            value={draft.titleMn}
            onChange={(e) => onChange(updateMeta(draft, { titleMn: e.target.value }))}
            onBlur={onCommit}
          />
        </Field>
        <Field label={t('assessments.builder.metaTitleEn')}>
          <Input
            value={draft.titleEn}
            onChange={(e) => onChange(updateMeta(draft, { titleEn: e.target.value }))}
            onBlur={onCommit}
          />
        </Field>
        <Field label={t('assessments.builder.metaDescription')}>
          <Textarea
            rows={3}
            value={draft.description}
            onChange={(e) => onChange(updateMeta(draft, { description: e.target.value }))}
            onBlur={onCommit}
          />
        </Field>

        {/* Баг — раунд үүсгэх алхамд урьдчилан бөглөгдөх АНХДАГЧ утга. */}
        <Field label={t('assessments.editor.fieldTeams')}>
          <div className="space-y-1.5 rounded-md border p-2">
            {teams.length === 0 && (
              <p className="text-xs text-muted-foreground">{t('assessments.noTeams')}</p>
            )}
            {teams.map((team) => (
              <label key={team.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={draft.teamCodes.includes(team.code)}
                  onCheckedChange={() => {
                    const next = draft.teamCodes.includes(team.code)
                      ? draft.teamCodes.filter((c) => c !== team.code)
                      : [...draft.teamCodes, team.code];
                    onChange(updateTeamCodes(draft, next));
                    onCommit();
                  }}
                />
                <span className="truncate">
                  {team.code} — {team.name_mn}
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t('assessments.editor.teamsHint')}</p>
        </Field>

        {/* Үнэлэгч (senior) — раунд явуулахад урьдчилан сонгогдох АНХДАГЧ жагсаалт.
            Сонгосон хүн бүр бүх оролцогчийг үнэлж, өөрийн senior талын маягтыг
            бөглөнө (`/api/assessments/my/reviews`). */}
        <Field label={t('assessments.editor.fieldSeniors')}>
          <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-md border p-2">
            {usersQuery.isLoading && (
              <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
            )}
            {!usersQuery.isLoading && seniors.length === 0 && (
              <p className="text-xs text-muted-foreground">{t('assessments.editor.noSeniors')}</p>
            )}
            {seniors.map((senior) => (
              <label key={senior.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={draft.seniorUserIds.includes(senior.id)}
                  onCheckedChange={() => {
                    const next = draft.seniorUserIds.includes(senior.id)
                      ? draft.seniorUserIds.filter((id) => id !== senior.id)
                      : [...draft.seniorUserIds, senior.id];
                    onChange(updateSeniorUserIds(draft, next));
                    onCommit();
                  }}
                />
                <span className="truncate">
                  {formatDisplayName(senior.full_name)}
                  {senior.team_code && (
                    <span className="text-muted-foreground"> · {senior.team_code}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {draft.seniorUserIds.length
              ? t('assessments.editor.seniorsHint', { count: draft.seniorUserIds.length })
              : t('assessments.editor.seniorsFallbackHint')}
          </p>
        </Field>

        <Button variant="outline" size="sm" className="w-full" onClick={() => setScalesOpen(true)}>
          <SlidersHorizontal /> {t('assessments.builder.tabScales')}
          <Badge variant="secondary" className="ml-auto">
            {draft.scales.length}
          </Badge>
        </Button>
      </section>

      <ScalesDialog
        open={scalesOpen}
        onOpenChange={setScalesOpen}
        draft={draft}
        onChange={onChange}
        onCommit={onCommit}
      />
    </div>
  );
}

export default EditorInspector;
