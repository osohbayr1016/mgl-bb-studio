/**
 * «Багтаа илгээх» — засварлагчийн СҮҮЛЧИЙН алхам.
 *
 * Энэ нэг диалогоос раунд (ээлж) үүсч, оролцогчид бүрдэж, мэдэгдэл (апп
 * доторх + web push, `pushSweep`-ээр) явна.  Өмнө нь энэ нь админы хуудсан
 * дээрх тусдаа «Шинэ раунд» диалог байсан — асуулга зохиох ба түүнийг явуулах
 * хоёр тусдаа газар байснаас админ асуулгаа хадгалаад «одоо яах вэ?» гэж
 * гацдаг байв.
 *
 * Үнэлэгч (senior) нь РАУНД ДАЯАР: сонгосон хүн бүр бүх оролцогчийг үнэлнэ
 * (өөрийгөө үнэлэхээс бусад).  Сонгохгүй бол сервер хуучин зам руу шилжиж
 * хүн тус бүрийн үндсэн багийн ахлагчийг оноодог.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Send } from 'lucide-react';

import { useApiQuery } from '@/shared/api/useApi';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import type { Team, User } from '@/shared/types';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogScrollableBody,
  DialogTitle,
} from '@/ui/dialog';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';

import { assessmentKeys, createRound } from '../../api';
import type { AssessmentRoundDetail } from '../../types';

/**
 * Судалгаанд ОРОЛЦОГЧ болох role-ууд (admin/client/worker хэзээ ч биш).
 *
 * ⚠️ ТВИН: `backend/src/lib/assessmentRoster.ts` → `PARTICIPANT_ROLES`
 *          `frontend/src/shared/lib/roles.ts`    → `ASSESSMENT_ROLES`
 *
 * Энэ жагсаалт нь ЗӨВХӨН «role-оор сонгох» горимд хэрэглэгддэг — доорх
 * «багаар сонгох» горим (анхдагч) баг бүрийг шүүлтгүй харуулдаг тул MGMT
 * шиг админ дүүрэн багийг сонгоход бүх админ орж ирдэг байсан.  2026-08-19-
 * ээс хойш сервер тал (`resolveCohortIds`) БҮХ замд ижил цагаан жагсаалт
 * хэрэглэдэг болсон тул тэр нүх хаагдсан — энэ тогтмол нь зөвхөн UI-ийн
 * харагдац болж үлдэв.
 */
const CREATE_ROLES = ['engineer', 'architect', 'senior'] as const;

type CreateMode = 'team' | 'role';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: number;
  templateTitle: string;
  /** Загварын анхдагч баг — урьдчилан тэмдэглэгдэж ирнэ. */
  defaultTeamCodes: string[];
  /** Загвар дээр сонгосон анхдагч үнэлэгчид — мөн урьдчилан тэмдэглэгдэнэ. */
  defaultSeniorUserIds: number[];
  teams: Team[];
  /** Хадгалагдаагүй засвар үлдсэн бол илгээхийн ӨМНӨ flush хийнэ. */
  onBeforeCreate: () => Promise<boolean>;
  onCreated: (round: AssessmentRoundDetail) => void;
}

/** Сонгосон багуудын ахлагчид (`teams.lead_user_id`) — үнэлэгчийн анхдагч сонголт. */
function leadsOf(teams: Team[], codes: string[]): number[] {
  return teams
    .filter((team) => codes.includes(team.code))
    .map((team) => team.lead_user_id)
    .filter((id): id is number => typeof id === 'number');
}

export function PublishDialog(props: Props) {
  const { open, onOpenChange } = props;
  const { t } = useLanguage();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('assessments.editor.publishTitle')}</DialogTitle>
          <DialogDescription>{t('assessments.editor.publishDescription')}</DialogDescription>
        </DialogHeader>
        {/* Нээгдэх бүрд ШИНЭ instance — өмнөх удаагийн сонголт үлдэж
            санамсаргүй буруу багт явуулахаас сэргийлнэ.  (Effect дотор
            setState хийж «шинэчлэх» нь каскад render үүсгэдэг тул хийхгүй.) */}
        {open && <PublishForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function PublishForm({
  onOpenChange,
  templateId,
  templateTitle,
  defaultTeamCodes,
  defaultSeniorUserIds,
  teams,
  onBeforeCreate,
  onCreated,
}: Props) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const usersQuery = useApiQuery<{ users: User[] }>('/users', { retry: false });
  const seniors = useMemo(
    () =>
      (usersQuery.data?.users ?? []).filter(
        (u) => u.role === 'senior' && u.status === 'active',
      ),
    [usersQuery.data],
  );

  const year = String(new Date().getFullYear());
  const [name, setName] = useState(`${templateTitle} — ${year}`);
  const [period, setPeriod] = useState(year);
  const [mode, setMode] = useState<CreateMode>('team');
  const [pickedTeams, setPickedTeams] = useState<string[]>(() => [...defaultTeamCodes]);
  const [pickedRoles, setPickedRoles] = useState<string[]>([...CREATE_ROLES]);
  // Загвар дээр үнэлэгч сонгосон бол ТҮҮНИЙГ хүндэтгэнэ; сонгоогүй бол
  // сонгосон багийн ахлагчдыг санал болгоно.
  const [pickedSeniors, setPickedSeniors] = useState<number[]>(() =>
    defaultSeniorUserIds.length
      ? [...defaultSeniorUserIds]
      : leadsOf(teams, defaultTeamCodes),
  );
  const [openNow, setOpenNow] = useState(true);

  /** Баг асаахад тухайн багийн ахлагчийг үнэлэгчид ЧИМЭЭГҮЙ нэмнэ (унтраахад хасахгүй —
   *  админ гараар нэмсэн хүнийг санамсаргүй устгахгүйн тулд). */
  const toggleTeam = (code: string) => {
    const turningOn = !pickedTeams.includes(code);
    setPickedTeams((prev) => (turningOn ? [...prev, code] : prev.filter((c) => c !== code)));
    if (turningOn) {
      setPickedSeniors((prev) => [...new Set([...prev, ...leadsOf(teams, [code])])]);
    }
  };

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const mutation = useMutation<{ round: AssessmentRoundDetail }, Error>({
    mutationFn: async () => {
      // Хадгалагдаагүй засвар үлдсэн бол раунд ХУУЧИН схемийн snapshot авна —
      // тиймээс эхлээд autosave-ийг дуустал хүлээнэ.
      const saved = await onBeforeCreate();
      if (!saved) throw new Error(t('assessments.editor.publishUnsaved'));
      return createRound({
        template_id: templateId,
        name: name.trim(),
        period: period.trim(),
        status: openNow ? 'open' : 'draft',
        ...(mode === 'team' ? { team_codes: pickedTeams } : { roles: pickedRoles }),
        ...(pickedSeniors.length ? { senior_user_ids: pickedSeniors } : {}),
      });
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: assessmentKeys.rounds });
      toast.success(t('assessments.roundCreated'));
      onOpenChange(false);
      onCreated(res.round);
    },
    onError: (err) =>
      toast.error(t('assessments.roundCreateFailed'), err?.message || undefined),
  });

  const valid =
    name.trim().length > 0 &&
    period.trim().length > 0 &&
    (mode === 'team' ? pickedTeams.length > 0 : pickedRoles.length > 0);

  return (
    <>
      <DialogScrollableBody className="space-y-4 sm:max-h-[60vh] sm:overflow-y-auto">
          <div className="space-y-1.5">
            <Label htmlFor="publish-name">{t('assessments.fieldRoundName')}</Label>
            <Input id="publish-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="publish-period">{t('assessments.fieldPeriod')}</Label>
            <Input
              id="publish-period"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              inputMode="numeric"
              className="w-32"
            />
          </div>

          {/* ---------------------------- Оролцогчид ---------------------------- */}
          <div className="space-y-2">
            <Label>{t('assessments.fieldParticipants')}</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as CreateMode)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="team">{t('assessments.pickByTeam')}</SelectItem>
                <SelectItem value="role">{t('assessments.pickByRole')}</SelectItem>
              </SelectContent>
            </Select>

            {mode === 'team' ? (
              <div className="grid max-h-44 grid-cols-2 gap-2 overflow-y-auto rounded-md border p-3">
                {teams.map((team) => (
                  <label key={team.id} className="flex items-center gap-2 text-body">
                    <Checkbox
                      checked={pickedTeams.includes(team.code)}
                      onCheckedChange={() => toggleTeam(team.code)}
                    />
                    <span className="truncate">
                      {team.code} — {team.name_mn}
                    </span>
                  </label>
                ))}
                {!teams.length && (
                  <span className="text-micro text-muted-foreground">
                    {t('assessments.noTeams')}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap gap-4 rounded-md border p-3">
                {CREATE_ROLES.map((role) => (
                  <label key={role} className="flex items-center gap-2 text-body">
                    <Checkbox
                      checked={pickedRoles.includes(role)}
                      onCheckedChange={() => setPickedRoles((prev) => toggle(prev, role))}
                    />
                    <span>
                      {t(
                        role === 'engineer'
                          ? 'assessments.roleEngineer'
                          : role === 'architect'
                            ? 'assessments.roleArchitect'
                            : 'assessments.roleSenior',
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* ----------------------------- Үнэлэгчид ----------------------------- */}
          <div className="space-y-2">
            <Label>{t('assessments.editor.fieldSeniors')}</Label>
            <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-md border p-3">
              {usersQuery.isLoading && (
                <span className="text-micro text-muted-foreground">{t('common.loading')}</span>
              )}
              {!usersQuery.isLoading && !seniors.length && (
                <span className="text-micro text-muted-foreground">
                  {t('assessments.editor.noSeniors')}
                </span>
              )}
              {seniors.map((senior) => (
                <label key={senior.id} className="flex items-center gap-2 text-body">
                  <Checkbox
                    checked={pickedSeniors.includes(senior.id)}
                    onCheckedChange={() => setPickedSeniors((prev) => toggle(prev, senior.id))}
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
            <p className="text-micro text-muted-foreground">
              {pickedSeniors.length
                ? t('assessments.editor.seniorsHint', { count: pickedSeniors.length })
                : t('assessments.editor.seniorsFallbackHint')}
            </p>
          </div>

          <label className="flex items-start gap-2 rounded-md border p-3 text-body">
            <Checkbox checked={openNow} onCheckedChange={(v) => setOpenNow(v === true)} />
            <span>
              <span className="block font-medium">{t('assessments.editor.openNow')}</span>
              <span className="block text-micro text-muted-foreground">
                {t('assessments.editor.openNowHint')}
              </span>
            </span>
          </label>
        </DialogScrollableBody>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          {t('assessments.cancel')}
        </Button>
        <Button onClick={() => mutation.mutate()} disabled={!valid || mutation.isPending}>
          {mutation.isPending ? <Loader2 className="animate-spin" /> : <Send />}
          {t('assessments.editor.publishAction')}
        </Button>
      </DialogFooter>
    </>
  );
}

export default PublishDialog;
