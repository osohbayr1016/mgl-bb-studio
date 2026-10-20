import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { AdminFeedback } from '@/features/attendance/admin/hooks/useAdminFeedback';

/** Хуудсын дээд талын алдаа / амжилтын мэдэгдэл. */
export default function StatusAlerts({ feedback }: { feedback: AdminFeedback }) {
  const { error, setError, success, setSuccess } = feedback;
  return (
    <>
      {error && (
        <div className="flex items-center gap-3 bg-destructive/10 border border-destructive/30 text-destructive rounded-xl px-4 py-3 text-sm">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto">
            ✕
          </button>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 rounded-xl px-4 py-3 text-sm">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          <span>{success}</span>
          <button onClick={() => setSuccess(null)} className="ml-auto">
            ✕
          </button>
        </div>
      )}
    </>
  );
}
