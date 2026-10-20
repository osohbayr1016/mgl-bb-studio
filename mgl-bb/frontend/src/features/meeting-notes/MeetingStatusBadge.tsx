import { Badge } from '@/ui/badge';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';

type Variant = 'default' | 'secondary' | 'destructive' | 'outline';

/** Map a meeting lifecycle status → an i18n label key + a theme-tokenised Badge
 *  variant (no raw palette classes — see status-color convention). */
function meta(status: string): { key: string; variant: Variant; spin: boolean } {
  switch (status) {
    case 'draft':
      return { key: 'meetingNotes.status.draft', variant: 'outline', spin: false };
    case 'uploaded':
      return { key: 'meetingNotes.status.uploaded', variant: 'outline', spin: false };
    case 'transcribing':
      return { key: 'meetingNotes.status.transcribing', variant: 'secondary', spin: true };
    case 'transcribed':
      return { key: 'meetingNotes.status.transcribed', variant: 'secondary', spin: false };
    case 'analyzing':
      return { key: 'meetingNotes.status.analyzing', variant: 'secondary', spin: true };
    case 'analyzed':
      return { key: 'meetingNotes.status.analyzed', variant: 'default', spin: false };
    case 'transcribe_failed':
    case 'analyze_failed':
      return { key: 'meetingNotes.status.failed', variant: 'destructive', spin: false };
    default:
      return { key: 'meetingNotes.status.uploaded', variant: 'outline', spin: false };
  }
}

export function MeetingStatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  const m = meta(status);
  return (
    <Badge variant={m.variant} className="gap-1">
      {m.spin && <Loader2 className="h-3 w-3 animate-spin" />}
      {t(m.key)}
    </Badge>
  );
}

/** Statuses where the backend is still working → poll for updates. */
export function isMeetingBusy(status: string | undefined): boolean {
  return status === 'transcribing' || status === 'analyzing' || status === 'uploaded';
}
