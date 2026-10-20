/* Default task weights, composed from the discipline slices.
 *
 * Moved verbatim out of `AdminProjectSetupPage.tsx` when that ~5 700-line
 * module was split up. Data only — no behavioural change. */

import { PRESET_TASK_WEIGHTS_BA_BB } from './taskWeights.ba-bb';
import { PRESET_TASK_WEIGHTS_HAS_TSAH } from './taskWeights.has-tsah';
import { PRESET_TASK_WEIGHTS_HD_AU } from './taskWeights.hd-au';
import { PRESET_TASK_WEIGHTS_EZ_GT } from './taskWeights.ez-gt';

export const PRESET_TASK_WEIGHTS: Record<string, Record<string, Record<string, number>>> = {
  ...PRESET_TASK_WEIGHTS_BA_BB,
  ...PRESET_TASK_WEIGHTS_HAS_TSAH,
  ...PRESET_TASK_WEIGHTS_HD_AU,
  ...PRESET_TASK_WEIGHTS_EZ_GT,
};
