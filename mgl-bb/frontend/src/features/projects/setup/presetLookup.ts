/* Maps a free-text drawing name onto its discipline preset list.
 *
 * Moved verbatim out of `AdminProjectSetupPage.tsx` when that ~5 700-line
 * module was split up. Data only — no behavioural change. */

import {
  AU_COMPONENT_PRESETS,
  BA_COMPONENT_PRESETS,
  BB_COMPONENT_PRESETS,
  EZ_COMPONENT_PRESETS,
  GT_COMPONENT_PRESETS,
  HAS_COMPONENT_PRESETS,
  HD_COMPONENT_PRESETS,
  IZ_COMPONENT_PRESETS,
  TSAH_COMPONENT_PRESETS,
  TSBU_COMPONENT_PRESETS,
} from './componentPresets';

export const getPresetsForDrawing = (name: string): { type: string; presets: string[] } | null => {
  const n = name.toLowerCase();
  if (n.startsWith('ba') || n.includes('барилга архитектур'))
    return { type: 'BA', presets: BA_COMPONENT_PRESETS };
  if (n.startsWith('bb') || n.includes('барилга бүтээц'))
    return { type: 'BB', presets: BB_COMPONENT_PRESETS };
  if (n.startsWith('has') || n.includes('халаалт'))
    return { type: 'ХАС', presets: HAS_COMPONENT_PRESETS };
  if (
    n.startsWith('tsbu') ||
    n.includes('цбу') ||
    n.includes('цэвэр бохир') ||
    n.includes('цэвэр ус')
  )
    return { type: 'ЦБУ', presets: TSBU_COMPONENT_PRESETS };
  if (n.startsWith('tsah') || n.includes('цахилгаан'))
    return { type: 'Цахилгаан', presets: TSAH_COMPONENT_PRESETS };
  if (n.startsWith('hd') || n.includes('холбоо') || n.includes('дохиолол'))
    return { type: 'Холбоо', presets: HD_COMPONENT_PRESETS };
  if (n.startsWith('au') || n.includes('автомат удирдлага'))
    return { type: 'АУ', presets: AU_COMPONENT_PRESETS };
  if (n.startsWith('ez') || n.includes('эскиз'))
    return { type: 'Эскиз', presets: EZ_COMPONENT_PRESETS };
  if (n.startsWith('iz') || n.includes('интерьер'))
    return { type: 'Интерьер', presets: IZ_COMPONENT_PRESETS };
  if (n.startsWith('gt') || n.includes('гадна тохижилт'))
    return { type: 'Гадна тохижилт', presets: GT_COMPONENT_PRESETS };
  return null;
};
