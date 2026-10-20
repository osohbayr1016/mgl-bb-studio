import type { LucideIcon } from 'lucide-react';
import { Building2, HardHat, PencilRuler, Video } from 'lucide-react';
import type { AsrReportType } from '@/features/projects/asr/types';

/** Тайлангийн 4 төрлийн дүрс — «Төрлөөр» самбар (`AsrOverview`), шүүлтийн товч, үр дүнгийн гарчиг хуваалцана. */
export const ASR_TYPE_ICON: Record<AsrReportType, LucideIcon> = {
  site: HardHat,
  online: Video,
  drawing_change: PencilRuler,
  office: Building2,
};
