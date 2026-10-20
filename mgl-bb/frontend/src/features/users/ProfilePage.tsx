import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/shared/context/AuthContext';
import { apiFetch, uploadFile, MEDIA_BASE_URL } from '@/shared/api/client';
import { SignatureCapture } from '@/shared/components/SignatureCapture';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import { PageContainer } from '@/shared/components/PageContainer';
import { useApiQuery } from '@/shared/api/useApi';
import { isWorkerRole, canTakeAssessments, roleLabelKey } from '@/shared/lib/roles';
import { seniorityFullLabel, type UserProfile, type MyProgressEntry } from '@/shared/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { Field } from '@/ui/field';
import { Badge } from '@/ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@/ui/avatar';
import { KeepAliveTabs, KeepAliveTabsPanel } from '@/ui/keep-alive-tabs';
import { SectionRail, type SectionRailItem } from '@/shared/components/SectionRail';
import {
  User,
  Shield,
  Lock,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Camera,
  TrendingUp,
  CalendarDays,
  Save,
  ImageIcon,
  Users as UsersIcon,
  Trophy,
  Sparkles,
  ClipboardCheck,
  NotebookPen,
} from 'lucide-react';
import { MyScoreSection } from '@/features/leaderboard';
import { MyPgpSection } from '@/features/pgp';
import { MyAssessmentsSection, AssessmentProfilePrompt } from '@/features/assessments';
import { usePendingAssessmentCount } from '@/features/assessments/hooks/usePendingAssessmentCount';
import { ContributionStatsCard } from './components/ContributionStatsCard';
import { ImageCropDialog, type CropShape } from '@/shared/components/ImageCropDialog';
import { brand } from '@/shared/config/brand';

import { cn } from '@/shared/lib/utils';
import { toast } from '@/shared/components/Toast';
import { roleBadgeTone, APPROVAL_STATUS_TONE } from '@/shared/lib/status-colors';

import { formatDate } from '@/shared/lib/time';

// «Өдрийн тайлан» (0345) — зөвхөн админд; бусдад chunk огт ачаалагдахгүй.
const DailyWorkLogSection = lazy(() => import('@/features/daily-log/DailyWorkLogSection'));
function StatusPill({ status }: { status: 'pending' | 'approved' | 'rejected' }) {
  const { t } = useLanguage();
  const cls = APPROVAL_STATUS_TONE[status];
  const label =
    status === 'approved'
      ? t('profilePage.statusApproved')
      : status === 'pending'
        ? t('profilePage.statusPendingReview')
        : t('profilePage.statusRejected');
  return (
    <span className={cn('text-label font-semibold px-1.5 py-0.5 rounded border shrink-0', cls)}>
      {label}
    </span>
  );
}

export default function ProfilePage() {
  const { user, setUser, checkAuth } = useAuth();
  // `lang` нь зэргийн шошгонд хэрэгтэй — `seniorityFullLabel` нь англи
  // салбартай тул хэл дамжуулахгүй бол англи UI дээр ч монголоор гарна.
  const { t, lang } = useLanguage();
  // ?tab=pgp deep-link (ирцийн гарах хаалт эндээс чиглүүлдэг) —
  // UserProfileViewPage-ийн ?tab= хэв маягийг давтав.
  const [searchParams, setSearchParams] = useSearchParams();
  const showAssessments = canTakeAssessments(user?.role);
  // Өдрийн тайлан — админ (= Менежмент баг) л бичнэ; сервер ч `requireRole('admin')`.
  const showDailyLog = user?.role === 'admin';
  const { pendingCount } = usePendingAssessmentCount(showAssessments);

  const tabFromUrl = searchParams.get('tab');
  const resolveTab = (tab: string | null) => {
    // «Ур чадварын тодорхойлолт» — үнэлгээнд оролцдоггүй role-д байхгүй.
    // ⚠️ `?tab=level` нь 2026-08-12 хүртэл байсан тусдаа «Түвшин» таб —
    //    тэр таб энэ рүү НЭГТГЭГДСЭН тул хуучин холбоос (мэдэгдэл, хавчуурга,
    //    ирцийн гарах хаалт) 404 биш, зөв хэсэг рүү унана.
    if ((tab === 'assessment' || tab === 'level') && showAssessments) return 'assessment';
    if (tab === 'pgp' && !isWorkerRole(user?.role)) return 'pgp';
    if (tab === 'score' && !isWorkerRole(user?.role)) return 'score';
    if (tab === 'activity' && !isWorkerRole(user?.role)) return 'activity';
    if (tab === 'worklog' && showDailyLog) return 'worklog';
    if (tab === 'security') return 'security';
    return 'profile';
  };
  // URL нь идэвхтэй хэсгийн ЦОРЫН ГАНЦ эх сурвалж — локал mirror state
  // байхгүй тул «хоёр талын sync» гэсэн алдааны анги бүтцээрээ үүсэхгүй
  // (өмнө нь useState + useEffect хосоор толидож байсан).
  const activeTab = resolveTab(tabFromUrl);

  const selectTab = useCallback(
    (next: string) => {
      // `replace: true` — ирцийн гарах хаалт хэрэглэгчийг урсгал дундаас энэ
      // хуудсанд авчирдаг тул Back нь хуудсыг ОРХИХ ёстой, 7 хэсгээр ухарч
      // алхах ёсгүй.
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set('tab', next);
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Profile data — `useAuth()` is already populated from /auth/me by
  // AuthContext, so re-fetching it here would be a duplicate
  // round-trip. We just mirror the context user into a local
  // `UserProfile` shape for the editing form below.
  const profile: UserProfile | null = (user as UserProfile | null) ?? null;
  const loadingProfile = !user;

  // Edit profile form
  const [bio, setBio] = useState('');
  const [description, setDescription] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null,
  );

  // Image upload — picking a file opens the cropper instead of
  // immediately POSTing the raw file.  We track which slot is being
  // edited so one dialog component can serve both avatar and cover.
  const [uploadingProfile, setUploadingProfile] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const profileImgRef = useRef<HTMLInputElement>(null);
  const coverImgRef = useRef<HTMLInputElement>(null);
  const [cropTarget, setCropTarget] = useState<{
    file: File;
    field: 'profile_image' | 'cover_image';
    shape: CropShape;
    aspect: number;
    outputWidth: number;
  } | null>(null);

  // Password change
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [changingPw, setChangingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Activity — цэвэрлэгч (`worker`) task/явц бүртгэдэггүй бөгөөд `/progress/*`
  // нь түүнд серверийн зүгээс хаалттай (403) тул огт дуудахгүй.
  const activityQuery = useApiQuery<{ entries: MyProgressEntry[] }>(
    ['/progress/my'],
    '/progress/my?limit=10',
    { retry: false, enabled: !isWorkerRole(user?.role) },
  );
  const myActivity: MyProgressEntry[] = activityQuery.data?.entries ?? [];
  const loadingActivity = activityQuery.isLoading;

  // Seed the editable form fields from the authed user once available.
  // We do this on every change so saving in AuthContext flows back into
  // the form mirrors.
  useEffect(() => {
    if (!user) return;
    setBio((user as UserProfile).bio ?? '');
    setDescription((user as UserProfile).description ?? '');
  }, [user]);

  const displayUser = profile ?? user;
  const displayName = formatDisplayName(displayUser?.full_name);
  const initials = displayName ? displayName.substring(0, 2).toUpperCase() : '??';
  const avatarSrc = displayUser?.profile_image
    ? `${MEDIA_BASE_URL}${displayUser.profile_image}`
    : undefined;
  const coverSrc = displayUser?.cover_image
    ? `${MEDIA_BASE_URL}${displayUser.cover_image}`
    : undefined;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg(null);
    setSavingProfile(true);
    try {
      await apiFetch('/auth/profile', {
        method: 'PATCH',
        data: {
          bio: bio || null,
          description: description || null,
        },
      });
      setProfileMsg({ type: 'success', text: t('profilePage.profileUpdated') });
      await checkAuth();
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : undefined;
      setProfileMsg({ type: 'error', text: t('profilePage.profileUpdateFailed') });
      toast.error(t('profilePage.profileUpdateFailed'), detail);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleImageUpload = async (file: File, field: 'profile_image' | 'cover_image') => {
    const setLoading = field === 'profile_image' ? setUploadingProfile : setUploadingCover;
    setLoading(true);
    try {
      const url = await uploadFile(file);
      await apiFetch('/auth/profile', {
        method: 'PATCH',
        data: { [field]: url },
      });
      setUser(user ? { ...user, [field]: url } : null);
    } catch (err: unknown) {
      console.error('Upload failed', err);
      toast.error(t('common.saveFailed'), err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  /** Тамга — гарын үсэгтэй ЯГ ижил зам (`/auth/profile` PATCH → users.stamp_url). */
  const handleSaveStamp = async (url: string | null) => {
    try {
      await apiFetch('/auth/profile', { method: 'PATCH', data: { stamp_url: url } });
      await checkAuth();
    } catch (err) {
      console.error('stamp save failed', err);
      toast.error(t('common.saveFailed'), err instanceof Error ? err.message : undefined);
    }
  };

  const handleSaveSignature = async (url: string | null) => {
    try {
      await apiFetch('/auth/profile', { method: 'PATCH', data: { signature_url: url } });
      await checkAuth();
    } catch (err) {
      console.error('signature save failed', err);
      toast.error(t('common.saveFailed'), err instanceof Error ? err.message : undefined);
    }
  };

  /** Open the cropper for a freshly-picked file.  We store the chosen
   *  crop config (shape + aspect + output size) alongside the file so
   *  the dialog can be generic. */
  const startCrop = (file: File, field: 'profile_image' | 'cover_image') => {
    setCropTarget(
      field === 'profile_image'
        ? { file, field, shape: 'circle', aspect: 1, outputWidth: 512 }
        : { file, field, shape: 'rectangle', aspect: 16 / 9, outputWidth: 1280 },
    );
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg(null);

    if (newPw.length < 6) {
      setPwMsg({ type: 'error', text: t('profilePage.passwordTooShort') });
      return;
    }
    if (newPw !== confirmPw) {
      setPwMsg({ type: 'error', text: t('profilePage.passwordsMismatch') });
      return;
    }

    setChangingPw(true);
    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        data: { current_password: currentPw, new_password: newPw },
      });
      setPwMsg({ type: 'success', text: t('profilePage.passwordChanged') });
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : undefined;
      setPwMsg({ type: 'error', text: t('profilePage.passwordChangeFailed') });
      toast.error(t('profilePage.passwordChangeFailed'), detail);
    } finally {
      setChangingPw(false);
    }
  };

  if (!displayUser) return null;

  // ⚠️ Хажуугийн «статистик» нүднүүд урьд нь сүүлийн 10 явцын бичлэгээс энд
  //    бодогддог байсан — «Дууссан» гэдэг нь дууссан ДААЛГАВАР биш, 100%
  //    гэсэн БИЧЛЭГ-ийг тоолдог тул төөрөгдүүлж байв.  Одоо серверийн
  //    `/profiles/:id/stats` дээр суурилсан <ContributionStatsCard/> харуулна.

  // Team onboarding helpers
  const teamName = displayUser.team_name_mn || displayUser.team_name_en;
  const teamCode = displayUser.team_code;
  const position = displayUser.position;

  // ---- Хэсгийн зам ----------------------------------------------------
  // Гурван бүлэг: юу нь МИНИЙ бүртгэл, юу нь миний ГАРГАСАН үр дүн, юу нь
  // миний ХӨГЖИЛ.  Бүлгийн гарчиг нь богиносгосон шошгын утгыг нөхнө:
  // «Хөгжил → Төлөвлөгөө» = «Хөгжлийн төлөвлөгөө».
  //
  // `useMemo` ХЭРЭГГҮЙ: нууц үгийн талбарт үсэг бичих болгонд бүх хуудас
  // дахин рендэрлэгддэг тул массив аль ч тохиолдолд шинээр үүснэ
  // (SettingsPage-ийн `sections` ижил үндэслэлээр memo-гүй).
  const isWorker = isWorkerRole(user?.role);
  const groupAccount = t('profilePage.navGroupAccount');
  const groupOutput = t('profilePage.navGroupOutput');
  const groupGrowth = t('profilePage.navGroupGrowth');

  // Буцаагдсан бичлэгийн тоо — ШИНЭ хүсэлт ҮҮСГЭХГҮЙ, дээрх `activityQuery`-г
  // дахин ашиглаж байна.
  const rejectedCount = myActivity.filter((e) => e.status === 'rejected').length;

  // ⚠️ ДАРААЛАЛ чухал: нэг бүлгийн элементүүд ЗААВАЛ зэрэгцээ байрлана —
  //    SectionRail нь гарчгийг «өмнөхөөс өөр бүлэг» гэдгээр л гаргадаг.
  const railItems: SectionRailItem[] = [
    {
      value: 'profile',
      label: t('profilePage.navProfile'),
      shortLabel: t('profilePage.navProfileShort'),
      icon: User,
      group: groupAccount,
    },
    {
      value: 'security',
      label: t('profilePage.navPassword'),
      icon: Lock,
      group: groupAccount,
    },
    ...(!isWorker
      ? [
          {
            value: 'activity',
            label: t('profilePage.navActivity'),
            shortLabel: t('profilePage.navActivityShort'),
            icon: TrendingUp,
            group: groupOutput,
            badge:
              rejectedCount > 0 ? (
                <Badge
                  variant="outline"
                  className="bg-destructive/10 text-destructive-ink border-destructive/30"
                >
                  {rejectedCount}
                  <span className="sr-only"> {t('profilePage.navRejectedEntries')}</span>
                </Badge>
              ) : undefined,
          },
          {
            value: 'score',
            label: t('profilePage.navScore'),
            icon: Trophy,
            group: groupOutput,
          },
        ]
      : []),
    ...(showDailyLog
      ? [
          {
            value: 'worklog',
            label: t('profilePage.navDailyLog'),
            icon: NotebookPen,
            group: groupOutput,
          },
        ]
      : []),
    ...(showAssessments
      ? [
          {
            value: 'assessment',
            label: t('profilePage.navAssessment'),
            shortLabel: t('profilePage.navAssessmentShort'),
            icon: ClipboardCheck,
            group: groupGrowth,
            // Өмнөх 1.5px-ийн шар цэгийг сольсон — тоо нь «хэдэн маягт
            // хүлээгдэж байна»-г шууд хэлнэ.
            badge:
              pendingCount > 0 ? (
                <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">
                  {pendingCount}
                  <span className="sr-only"> {t('assessments.tabPending')}</span>
                </Badge>
              ) : undefined,
          },
        ]
      : []),
    ...(!isWorker
      ? [
          {
            value: 'pgp',
            label: t('profilePage.navGrowthPlan'),
            icon: Sparkles,
            group: groupGrowth,
          },
        ]
      : []),
  ];

  // Багийн карт — урьд нь зүүн `<aside>`-д сууж, утсан дээр табын мөрийг
  // ~1400px доош түлхэж байсан.  Одоо «Хувийн мэдээлэл» хэсгийн доод талд
  // очно (энэ нь мөн л хувийн/HR мэдээлэл).  Дотор нь байсан ажилтны код /
  // албан тушаал / эрхийн `InfoRow`-ууд УСТСАН: гурвуулаа дээрх hero-д
  // ЯГ ижилхэн харагддаг давхардал байв.
  const teamCard = (
    <Card className="border-border bg-card/60 backdrop-blur overflow-hidden">
      <div className="px-5 py-4 border-b border-border/60 bg-gradient-to-r from-primary/10 to-transparent flex items-center gap-2">
        <UsersIcon className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">
          {(displayUser.teams?.length ?? 0) > 1
            ? t('profilePage.myTeams')
            : t('profilePage.myTeam')}
        </h3>
      </div>
      <CardContent className="pt-5 space-y-4">
        {displayUser.teams?.length ? (
          <div className="space-y-3">
            {displayUser.teams
              .slice()
              .sort((a, b) => b.is_primary - a.is_primary)
              .map((team) => (
                <div key={team.id} className="flex items-center gap-3">
                  <div
                    className={cn(
                      'h-12 w-12 rounded-xl flex items-center justify-center shadow-md shrink-0',
                      team.is_primary
                        ? 'bg-gradient-to-br from-primary to-primary/60 shadow-primary/20'
                        : 'bg-gradient-to-br from-muted-foreground/40 to-muted-foreground/20 shadow-muted-foreground/10',
                    )}
                  >
                    <span className="font-mono text-xs font-bold text-primary-foreground">
                      {team.code}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="font-semibold text-foreground truncate">{team.name_mn}</p>
                      {team.is_primary === 1 && (
                        <Badge
                          variant="outline"
                          className="text-micro px-1 py-0 h-4 bg-primary/10 text-primary border-primary/30 shrink-0"
                        >
                          {t('profilePage.primary')}
                        </Badge>
                      )}
                    </div>
                    {team.name_en && (
                      <p className="text-xs text-muted-foreground truncate">{team.name_en}</p>
                    )}
                  </div>
                </div>
              ))}
          </div>
        ) : teamName ? (
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-md shadow-primary/20 shrink-0">
              <span className="font-mono text-xs font-bold text-primary-foreground">
                {teamCode ?? brand().nameShort}
              </span>
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-foreground truncate">{teamName}</p>
              {position && <p className="text-xs text-muted-foreground truncate">{position}</p>}
            </div>
          </div>
        ) : (
          <div className="text-center py-6">
            <UsersIcon className="h-8 w-8 mx-auto mb-2 text-muted-subtle" />
            <p className="text-sm font-medium text-foreground">{t('profilePage.noTeamAssigned')}</p>
            <p className="text-xs text-muted-foreground mt-1">{t('profilePage.contactAdmin')}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <PageContainer>
      {/* Visual Header Card — full width, uses the whole available canvas. */}
      <Card className="border-border bg-card/60 backdrop-blur overflow-hidden">
        {/* Cover Image */}
        <div className="relative h-36 group">
          {coverSrc ? (
            <img src={coverSrc} alt="Cover" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-primary/30 via-primary/10 to-transparent" />
          )}
          <button
            type="button"
            onClick={() => coverImgRef.current?.click()}
            disabled={uploadingCover}
            className="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-background/80 backdrop-blur text-xs font-medium text-foreground hover:bg-background transition-all opacity-0 group-hover:opacity-100"
          >
            {uploadingCover ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ImageIcon className="h-3.5 w-3.5" />
            )}
            {t('profilePage.changeCover')}
          </button>
          <input
            ref={coverImgRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) startCrop(file, 'cover_image');
              e.target.value = '';
            }}
          />
        </div>

        <CardContent className="relative px-6 pb-6">
          {/* Profile Avatar */}
          <div className="flex items-end gap-4 -mt-12">
            <div className="relative group/avatar flex-shrink-0">
              <Avatar className="h-24 w-24 border-4 border-background shadow-xl">
                {avatarSrc && <AvatarImage src={avatarSrc} alt={displayName} />}
                <AvatarFallback className="bg-primary/20 text-primary text-2xl font-bold">
                  {loadingProfile ? <Loader2 className="h-6 w-6 animate-spin" /> : initials}
                </AvatarFallback>
              </Avatar>
              <button
                type="button"
                onClick={() => profileImgRef.current?.click()}
                disabled={uploadingProfile}
                className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover/avatar:opacity-100 transition-opacity cursor-pointer"
              >
                {uploadingProfile ? (
                  <Loader2 className="h-5 w-5 text-white animate-spin" />
                ) : (
                  <Camera className="h-5 w-5 text-white" />
                )}
              </button>
              <input
                ref={profileImgRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) startCrop(file, 'profile_image');
                  e.target.value = '';
                }}
              />
            </div>

            <div className="pb-1 min-w-0">
              <h2 className="text-xl font-bold text-foreground truncate">{displayName}</h2>
              <p className="text-sm text-muted-foreground">@{displayUser.username}</p>
            </div>
          </div>

          {/* Info Row — richer, now includes Team + Position + Seniority + Employee ID.
              7 нүд болсон тул lg дээр 4-өөр, xl дээр 7-оор эгнүүлнэ (6 багана
              үлдээвэл сүүлийн нүд ганцаараа доош унана). */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4 mt-5">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('profilePage.employeeId')}</p>
              <p className="font-mono font-semibold text-sm text-foreground">
                {displayUser.employee_id ?? `#${displayUser.id.toString().padStart(4, '0')}`}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('profilePage.role')}</p>
              <Badge
                variant="outline"
                className={cn('capitalize font-medium', roleBadgeTone(displayUser.role))}
              >
                <Shield className="h-3 w-3 mr-1" />
                {t(roleLabelKey(displayUser.role))}
              </Badge>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('profilePage.team')}</p>
              {displayUser.teams?.length ? (
                <div className="flex flex-wrap gap-1">
                  {displayUser.teams
                    .slice()
                    .sort((a, b) => b.is_primary - a.is_primary)
                    .map((t) => (
                      <Badge
                        key={t.id}
                        variant="outline"
                        className={cn(
                          'font-medium',
                          t.is_primary
                            ? 'bg-primary/10 text-primary border-primary/30'
                            : 'bg-muted text-muted-foreground border-border',
                        )}
                      >
                        <code className="font-mono text-micro mr-1 opacity-70">{t.code}</code>
                        <span className="truncate max-w-[100px]">{t.name_mn}</span>
                      </Badge>
                    ))}
                </div>
              ) : teamName ? (
                <Badge
                  variant="outline"
                  className="bg-primary/10 text-primary border-primary/30 font-medium"
                >
                  {teamCode && (
                    <code className="font-mono text-micro mr-1 opacity-70">{teamCode}</code>
                  )}
                  <span className="truncate max-w-[140px]">{teamName}</span>
                </Badge>
              ) : (
                <span className="text-xs italic text-muted-foreground">
                  {t('profilePage.unassigned')}
                </span>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('profilePage.position')}</p>
              <p className="text-sm font-medium truncate">{position ?? '—'}</p>
            </div>
            {/* Албан тушаалын хажууд — ажил мэргэшлийн ЗЭРЭГ (Ахлах инженер гэх мэт).
                Хоёулаа зөвхөн ХАРУУЛАХ: админ л өөрчилнө (UsersPage). */}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('profilePage.seniority')}</p>
              <p className="text-sm font-medium truncate">
                {seniorityFullLabel(displayUser.seniority, displayUser.team_code ?? null, lang)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('profilePage.status')}</p>
              <div className="flex items-center gap-1.5">
                <div
                  className={cn(
                    'h-2 w-2 rounded-full',
                    displayUser.status === 'active' ? 'bg-success' : 'bg-destructive',
                  )}
                />
                <span className="text-sm font-medium">
                  {displayUser.status === 'active'
                    ? t('profilePage.statusActive')
                    : t('profilePage.statusInactive')}
                </span>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('profilePage.memberSince')}</p>
              <p className="text-sm font-medium">{formatDate(new Date(displayUser.created_at))}</p>
            </div>
          </div>

          {/* Bio preview */}
          {displayUser.bio && (
            <p className="mt-4 text-sm text-muted-foreground leading-relaxed">{displayUser.bio}</p>
          )}
        </CardContent>
      </Card>

      {/* ============================================================
       * Хэсгийн зам (зүүн) + идэвхтэй хэсгийн агуулга (баруун).
       *
       * Урьд нь энд "grid-cols-[340px_1fr]" байсан: зүүнд багийн карт ба
       * хувь нэмрийн статистик, баруунд 7 табын ХЭВТЭЭ ГҮЙЛГЭДЭГ мөр.
       * Хоёулаа асуудалтай байв — таб нь аль хэдийн нарийссан баганад
       * багтахаа больсон бол, утсан дээр "aside" нь ЭХНИЙ хүүхэд тул
       * табын мөр ~1400px доогуур булагдаж байлаа.
       *
       * Одоо "flex": дараалал = DOM-ын дараалал (grid-ийн auto-placement
       * занга бүтцээрээ устав), зам нь lg дээр босоо багана, утсан дээр
       * мөр дамждаг чипүүд — "overflow-x" ХААНА Ч БАЙХГҮЙ.
       * ============================================================ */}
      <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
        <SectionRail
          items={railItems}
          value={activeTab}
          onValueChange={selectTab}
          ariaLabel={t('profilePage.navAriaLabel')}
        />

        <div className="min-w-0 flex-1">
          {/* "?tab=…"-аар шууд нээх — мэдэгдэл / үнэлгээний маягтаас ирнэ. */}
          {showAssessments && pendingCount > 0 && (
            <div className="mb-4">
              <AssessmentProfilePrompt />
            </div>
          )}
          <KeepAliveTabs value={activeTab} onValueChange={selectTab}>
            {/* Edit Profile Tab */}
            <KeepAliveTabsPanel
              value="profile"
              role="region"
              aria-label={t('profilePage.navProfile')}
              className="mt-0"
            >
              <Card className="border-border bg-card/60 backdrop-blur">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <User className="h-5 w-5 text-primary" />
                    {t('profilePage.profileInformation')}
                  </CardTitle>
                  <CardDescription>{t('profilePage.profileInfoDesc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSaveProfile} className="space-y-5">
                    {profileMsg && (
                      <div
                        className={cn(
                          'rounded-md p-3 flex items-center text-sm border',
                          profileMsg.type === 'success'
                            ? 'bg-success/15 text-success border-success/20'
                            : 'bg-destructive/15 text-destructive border-destructive/20',
                        )}
                      >
                        {profileMsg.type === 'success' ? (
                          <CheckCircle2 className="h-4 w-4 mr-2 shrink-0" />
                        ) : (
                          <AlertCircle className="h-4 w-4 mr-2 shrink-0" />
                        )}
                        {profileMsg.text}
                      </div>
                    )}

                    <Field label={t('profilePage.bioLabel')} htmlFor="bio" className="space-y-2">
                      <Textarea
                        id="bio"
                        rows={2}
                        value={bio}
                        onChange={(e) => setBio(e.target.value)}
                        placeholder={t('profilePage.bioPlaceholder')}
                        className="resize-none"
                      />
                    </Field>

                    <Field
                      label={t('profilePage.descriptionLabel')}
                      htmlFor="description"
                      className="space-y-2"
                    >
                      <Textarea
                        id="description"
                        rows={4}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder={t('profilePage.descriptionPlaceholder')}
                        className="resize-none"
                      />
                    </Field>

                    <div className="flex justify-end">
                      <Button type="submit" disabled={savingProfile}>
                        {savingProfile ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="mr-2 h-4 w-4" />
                        )}
                        {t('profilePage.saveProfile')}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>

              <Card className="border-border bg-card/60 backdrop-blur mt-4">
                <CardHeader>
                  <CardTitle className="text-lg">{t('signature.title')}</CardTitle>
                  <CardDescription>{t('signature.desc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <SignatureCapture
                    value={(displayUser as { signature_url?: string | null }).signature_url ?? null}
                    onChange={handleSaveSignature}
                  />
                </CardContent>
              </Card>

              {/* ТАМГА — гарын үсгийн хажууд. Зурдаг зүйл биш тул зөвхөн файл. */}
              <Card className="border-border bg-card/60 backdrop-blur mt-4">
                <CardHeader>
                  <CardTitle className="text-lg">{t('stamp.title')}</CardTitle>
                  <CardDescription>{t('stamp.desc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <SignatureCapture
                    value={(displayUser as { stamp_url?: string | null }).stamp_url ?? null}
                    onChange={handleSaveStamp}
                    allowDraw={false}
                    alt="stamp"
                  />
                </CardContent>
              </Card>

              {/* Багийн карт — урьд нь зүүн `<aside>`-д байсан. */}
              <div className="mt-4">{teamCard}</div>
            </KeepAliveTabsPanel>

            {/* ⚠️ Энд «Түвшин» (`?tab=level`) гэсэн тусдаа таб байсан —
              2026-08-12-нд «Ур чадварын тодорхойлолт» таб руу НЭГТГЭГДСЭН.
              Нийт хувь/түвшин хасагдсаны дараа хоёр таб ижил агуулгатай
              болсон тул давхардлыг арилгав (`MyAssessmentsSection`-ийн
              толгойн тайлбарыг үз). */}

            {/* Security Tab */}
            <KeepAliveTabsPanel
              value="security"
              role="region"
              aria-label={t('profilePage.navPassword')}
              className="mt-0"
            >
              <Card className="border-border bg-card/60 backdrop-blur">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Lock className="w-5 h-5 text-primary" />
                    {t('profilePage.changePassword')}
                  </CardTitle>
                  <CardDescription>{t('profilePage.changePasswordDesc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleChangePassword} className="space-y-4">
                    {pwMsg && (
                      <div
                        className={cn(
                          'rounded-md p-3 flex items-center text-sm border',
                          pwMsg.type === 'success'
                            ? 'bg-success/15 text-success border-success/20'
                            : 'bg-destructive/15 text-destructive border-destructive/20',
                        )}
                      >
                        {pwMsg.type === 'success' ? (
                          <CheckCircle2 className="w-4 h-4 mr-2 shrink-0" />
                        ) : (
                          <AlertCircle className="w-4 h-4 mr-2 shrink-0" />
                        )}
                        {pwMsg.text}
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label>{t('profilePage.currentPassword')}</Label>
                      <Input
                        type="password"
                        value={currentPw}
                        onChange={(e) => setCurrentPw(e.target.value)}
                        required
                        autoComplete="current-password"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>{t('profilePage.newPassword')}</Label>
                        <Input
                          type="password"
                          value={newPw}
                          onChange={(e) => setNewPw(e.target.value)}
                          required
                          autoComplete="new-password"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{t('profilePage.confirmNewPassword')}</Label>
                        <Input
                          type="password"
                          value={confirmPw}
                          onChange={(e) => setConfirmPw(e.target.value)}
                          required
                          autoComplete="new-password"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button type="submit" disabled={changingPw}>
                        {changingPw && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {t('profilePage.updatePassword')}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </KeepAliveTabsPanel>

            {/* Activity Tab */}
            {!isWorkerRole(user?.role) && (
              <KeepAliveTabsPanel
                value="activity"
                role="region"
                aria-label={t('profilePage.navActivity')}
                className="mt-0"
              >
                <Card className="border-border bg-card/60 backdrop-blur">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <TrendingUp className="w-5 h-5 text-primary" />
                      {t('profilePage.progressHistory')}
                    </CardTitle>
                    <CardDescription>{t('profilePage.progressHistoryDesc')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {loadingActivity ? (
                      <div className="space-y-3">
                        {[1, 2, 3, 4, 5].map((i) => (
                          <div key={i} className="flex gap-3 animate-pulse">
                            <div className="h-8 w-8 rounded-full bg-muted flex-shrink-0" />
                            <div className="flex-1 space-y-1.5">
                              <div className="h-3 bg-muted rounded w-3/4" />
                              <div className="h-3 bg-muted rounded w-1/2" />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : myActivity.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        <TrendingUp className="h-10 w-10 mx-auto mb-3 opacity-20" />
                        <p className="text-sm font-medium">{t('profilePage.noProgressEntries')}</p>
                        <p className="text-xs mt-1">{t('profilePage.noProgressEntriesHint')}</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {myActivity.map((entry) => {
                          const isRest = entry.is_rest_day === 1;
                          return (
                            <div
                              key={entry.id}
                              className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                            >
                              <div
                                className={cn(
                                  'h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold',
                                  isRest
                                    ? 'bg-info/20 text-info'
                                    : entry.percentage >= 100
                                      ? 'bg-success/20 text-success'
                                      : entry.percentage > 0
                                        ? 'bg-warning/20 text-warning'
                                        : 'bg-muted text-muted-foreground',
                                )}
                              >
                                {isRest ? 'Z' : entry.percentage}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-medium text-foreground truncate flex-1">
                                    {entry.task_name || t('profilePage.unnamedItem')}
                                  </p>
                                  {isRest && (
                                    <span className="text-micro font-semibold px-1.5 py-0.5 rounded bg-info/10 text-info border border-info/30">
                                      {t('profilePage.restDay')}
                                    </span>
                                  )}
                                  <StatusPill status={entry.status} />
                                </div>
                                {entry.notes && (
                                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                    {entry.notes}
                                  </p>
                                )}
                                {entry.status === 'rejected' && entry.review_note && (
                                  <p className="text-xs text-destructive/90 mt-0.5 truncate">
                                    {t('profilePage.reviewerNote', { note: entry.review_note })}
                                  </p>
                                )}
                                {entry.image_url && (
                                  <a
                                    href={`${MEDIA_BASE_URL}${entry.image_url}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-block mt-1.5 rounded overflow-hidden border border-border hover:ring-2 hover:ring-primary transition"
                                  >
                                    <img
                                      src={`${MEDIA_BASE_URL}${entry.image_url}`}
                                      alt="attachment"
                                      className="h-16 w-24 object-cover"
                                    />
                                  </a>
                                )}
                                <div className="flex items-center gap-1.5 mt-1">
                                  <CalendarDays className="h-3 w-3 text-muted-foreground" />
                                  <span className="text-xs text-muted-foreground">
                                    {formatDate(new Date(entry.date))}
                                  </span>
                                </div>
                              </div>
                              <div
                                className={cn(
                                  'text-xs font-semibold px-2 py-1 rounded flex-shrink-0',
                                  isRest
                                    ? 'bg-info/10 text-info'
                                    : entry.percentage >= 100
                                      ? 'bg-success/10 text-success'
                                      : entry.percentage > 0
                                        ? 'bg-warning/10 text-warning'
                                        : 'bg-muted text-muted-foreground',
                                )}
                              >
                                {isRest ? '— ' : `${entry.percentage}%`}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </KeepAliveTabsPanel>
            )}

            {!isWorkerRole(user?.role) && (
              <>
                <KeepAliveTabsPanel
                  value="score"
                  role="region"
                  aria-label={t('profilePage.navScore')}
                  className="mt-0 space-y-4"
                >
                  {/* Хувь нэмэр — серверээс тоологдсон ЖИНХЭНЭ тоонууд (даалгавар,
                    оноо, засварын хувь, төслийн нөлөөлөл).  Урьд нь зүүн
                    `<aside>`-д байнга зурагдаж, `/profiles/:id/stats`-ыг хуудас
                    нээх бүрд дууддаг байсан; одоо энэ хэсгийг нээхэд л татна. */}
                  <ContributionStatsCard />
                  <MyScoreSection />
                </KeepAliveTabsPanel>
                <KeepAliveTabsPanel
                  value="pgp"
                  role="region"
                  aria-label={t('profilePage.navGrowthPlan')}
                  className="mt-0"
                >
                  <MyPgpSection />
                </KeepAliveTabsPanel>
              </>
            )}

            {showDailyLog && (
              <KeepAliveTabsPanel
                value="worklog"
                role="region"
                aria-label={t('profilePage.navDailyLog')}
                className="mt-0"
              >
                <Suspense
                  fallback={
                    <div className="flex justify-center py-12">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  }
                >
                  <DailyWorkLogSection />
                </Suspense>
              </KeepAliveTabsPanel>
            )}

            {showAssessments && (
              <KeepAliveTabsPanel
                value="assessment"
                role="region"
                aria-label={t('profilePage.navAssessment')}
                className="mt-0"
              >
                <MyAssessmentsSection />
              </KeepAliveTabsPanel>
            )}
          </KeepAliveTabs>
        </div>
      </div>

      {/* Crop dialog — opens whenever the user picks a file from the
          avatar / cover input, then submits a cropped PNG via the
          existing handleImageUpload pipeline. */}
      <ImageCropDialog
        open={cropTarget !== null}
        file={cropTarget?.file ?? null}
        shape={cropTarget?.shape ?? 'circle'}
        aspect={cropTarget?.aspect ?? 1}
        outputWidth={cropTarget?.outputWidth ?? 512}
        title={
          cropTarget?.field === 'cover_image'
            ? t('profilePage.cropCoverTitle')
            : t('profilePage.cropProfileTitle')
        }
        uploading={cropTarget?.field === 'cover_image' ? uploadingCover : uploadingProfile}
        onCancel={() => setCropTarget(null)}
        onConfirm={async (cropped) => {
          const target = cropTarget;
          if (!target) return;
          setCropTarget(null);
          await handleImageUpload(cropped, target.field);
        }}
      />
    </PageContainer>
  );
}
