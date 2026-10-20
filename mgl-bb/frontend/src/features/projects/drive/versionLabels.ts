/**
 * Хувилбарын түүхийн мөрийн шошго — `change_kind` → i18n түлхүүр + өнгө.
 * Серверийн `lib/projectDriveVersions.ts` DriveChangeKind-ийн ихэр.
 */
import type { DriveChangeKind, DriveVersion } from './types';

export function changeKindLabelKey(kind: DriveChangeKind): string {
  return `projectDrive.change_${kind}`;
}

/** Badge-ийн өнгө: устгал/хог улаан, сэргээлт ногоон, агуулга анхаарал, бусад саарал. */
export function changeKindTone(kind: DriveChangeKind): 'destructive' | 'success' | 'warning' | 'neutral' {
  switch (kind) {
    case 'deleted':
    case 'trashed':
      return 'destructive';
    case 'restored':
    case 'untrashed':
      return 'success';
    case 'modified':
    case 'created':
      return 'warning';
    default:
      return 'neutral';
  }
}

/** «Хэн» багана: ERP-ийн сэргээгч > ERP-ээс байршуулагч > Drive-ын засварлагч (баг) > холбоосоор орсон нэргүй. */
export function versionActorKey(v: DriveVersion): { key: string; params?: Record<string, string> } {
  if (v.restored_by) return { key: 'projectDrive.actorRestoredBy', params: { name: v.restored_by.name } };
  if (v.uploaded_by) return { key: 'projectDrive.actorUploadedBy', params: { name: v.uploaded_by.name } };
  if (v.modified_by?.name || v.modified_by?.email) {
    return { key: 'projectDrive.actorDrive', params: { name: v.modified_by.name ?? v.modified_by.email ?? '' } };
  }
  return { key: 'projectDrive.actorAnonymous' };
}
