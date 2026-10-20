import { useSyncExternalStore } from 'react';
import {
  subscribeModules,
  getModulesSnapshot,
  moduleEnabled,
  type ModuleId,
} from './modules';

/**
 * Идэвхтэй модулиудыг React дотор захиалах.  Админ модуль асаах/унтраахад
 * цэс шууд шинэчлэгдэнэ.
 *
 * Компонентоос ГАДУУР (утилит, guard) `moduleEnabled()`-ийг шууд дууд.
 */
export function useEnabledModules(): ReadonlySet<ModuleId> | null {
  return useSyncExternalStore(subscribeModules, getModulesSnapshot, getModulesSnapshot);
}

/** Тухайн модуль нээлттэй эсэх — өөрчлөгдөхөд дахин зурагдана. */
export function useModuleEnabled(id: ModuleId): boolean {
  useEnabledModules();
  return moduleEnabled(id);
}

export { moduleEnabled };
export type { ModuleId };
