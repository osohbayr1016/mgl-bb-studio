import type { BehaviorBand } from '../lib/behaviorScale';
import type { AssessmentLevelBand } from '../types';

/** Level-ийн өнгөт цэг + нэр. Текст нь өнгө зүүхгүй — өнгө нь цэг дээр. */
export function LevelTag({ level }: { level: AssessmentLevelBand | null }) {
  if (!level) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        className="inline-block size-2 shrink-0 rounded-full"
        style={{ backgroundColor: level.color }}
        aria-hidden
      />
      {level.label}
    </span>
  );
}

/** `LevelTag`-тэй ижил дүрслэл, гэхдээ зан чанарын (1.0–5.0) band-д зориулсан. */
export function BehaviorBandTag({ band }: { band: BehaviorBand | null }) {
  if (!band) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        className="inline-block size-2 shrink-0 rounded-full"
        style={{ backgroundColor: band.color }}
        aria-hidden
      />
      {band.label}
    </span>
  );
}

export default LevelTag;
