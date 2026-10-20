/* Per-component default task lists, composed from the discipline slices.
 *
 * Moved verbatim out of `AdminProjectSetupPage.tsx` when that ~5 700-line
 * module was split up. Data only — no behavioural change. */

import { COMPONENT_TASK_PRESETS_BA_HAS } from './componentTaskPresets.ba-has';
import { COMPONENT_TASK_PRESETS_TSBU_HD } from './componentTaskPresets.tsbu-hd';
import { COMPONENT_TASK_PRESETS_AU_GT } from './componentTaskPresets.au-gt';

export const COMPONENT_TASK_PRESETS: Record<string, string[]> = {
  ...COMPONENT_TASK_PRESETS_BA_HAS,
  ...COMPONENT_TASK_PRESETS_TSBU_HD,
  ...COMPONENT_TASK_PRESETS_AU_GT,
};
