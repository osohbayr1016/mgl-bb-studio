/**
 * Серверийн `code` → хэрэглэгчид харагдах орчуулгын түлхүүр (§10).
 * Техникийн шалтгаан хөтөчид огт ирдэггүй — сервер логт л бичдэг.
 */
import { ApiError, ApiNetworkError } from '@/shared/api/client';
import type { DriveErrorCode } from './types';

export interface DriveErrorView {
  /** i18n түлхүүр. */
  key: string;
  /** Дахин оролдох утгатай юу (сүлжээ/Drive унасан) — тохиргооны алдаанд үгүй. */
  retryable: boolean;
  /** Админд харуулах тохиргооны зөвлөмж бий эсэх. */
  configuration: boolean;
  code: DriveErrorCode | 'NETWORK' | 'UNKNOWN';
}

const BY_CODE: Record<DriveErrorCode, Omit<DriveErrorView, 'code'>> = {
  NOT_CONFIGURED: { key: 'projectDrive.errNotConfigured', retryable: false, configuration: true },
  AUTH_CONFIG: { key: 'projectDrive.errAuthConfig', retryable: false, configuration: true },
  NOT_FOUND: { key: 'projectDrive.errNotFound', retryable: true, configuration: false },
  PERMISSION_DENIED: { key: 'projectDrive.errPermission', retryable: false, configuration: true },
  RATE_LIMITED: { key: 'projectDrive.errRateLimited', retryable: true, configuration: false },
  EXPORT_TOO_LARGE: { key: 'projectDrive.errExportTooLarge', retryable: false, configuration: false },
  UNAVAILABLE: { key: 'projectDrive.errUnavailable', retryable: true, configuration: false },
  NOT_LINKED: { key: 'projectDrive.errNotLinked', retryable: false, configuration: true },
  OUTSIDE_PROJECT: { key: 'projectDrive.errOutside', retryable: false, configuration: false },
  INVALID_FOLDER: { key: 'projectDrive.errInvalidFolder', retryable: false, configuration: false },
  NOT_A_FOLDER: { key: 'projectDrive.errNotAFolder', retryable: false, configuration: false },
  TRASHED: { key: 'projectDrive.errTrashed', retryable: false, configuration: false },
  NO_PREVIEW: { key: 'projectDrive.errNoPreview', retryable: false, configuration: false },
  THUMBNAIL_ONLY: { key: 'projectDrive.errNoPreview', retryable: false, configuration: false },
  FORBIDDEN: { key: 'projectDrive.errForbidden', retryable: false, configuration: false },
  PROJECT_NOT_FOUND: { key: 'projectDrive.errNotFound', retryable: false, configuration: false },
  VERSION_NOT_FOUND: { key: 'projectDrive.errVersionNotFound', retryable: false, configuration: false },
  NO_SNAPSHOT: { key: 'projectDrive.errNoSnapshot', retryable: false, configuration: false },
  SNAPSHOT_MISSING: { key: 'projectDrive.errNoSnapshot', retryable: false, configuration: false },
  NOT_RESTORABLE: { key: 'projectDrive.errNotRestorable', retryable: false, configuration: false },
  NO_PARENT: { key: 'projectDrive.errNoParent', retryable: false, configuration: false },
  SA_NO_QUOTA: { key: 'projectDrive.errSaNoQuota', retryable: false, configuration: true },
  DELEGATION_REQUIRED: { key: 'projectDrive.errDelegation', retryable: false, configuration: true },
  INVALID_NAME: { key: 'projectDrive.errInvalidName', retryable: false, configuration: false },
  EMPTY_FILE: { key: 'projectDrive.errEmptyFile', retryable: false, configuration: false },
  UPLOAD_TOO_LARGE: { key: 'projectDrive.errUploadTooLarge', retryable: false, configuration: false },
  UPLOAD_TOKEN_INVALID: { key: 'projectDrive.errUploadRestart', retryable: true, configuration: false },
  UPLOAD_SESSION_GONE: { key: 'projectDrive.errUploadRestart', retryable: true, configuration: false },
  BAD_OFFSET: { key: 'projectDrive.errUploadRestart', retryable: true, configuration: false },
  BAD_LENGTH: { key: 'projectDrive.errUploadRestart', retryable: true, configuration: false },
  IS_ROOT: { key: 'projectDrive.errIsRoot', retryable: false, configuration: false },
  MOVE_INTO_SELF: { key: 'projectDrive.errMoveIntoSelf', retryable: false, configuration: false },
  UPLOAD_NOT_ALLOWED: { key: 'projectDrive.errUploadNotAllowed', retryable: false, configuration: false },
  UPLOAD_FOLDER_MISSING: { key: 'projectDrive.errUploadFolderMissing', retryable: false, configuration: true },
  ROOT_IS_PROJECT_FOLDER: { key: 'driveRoot.errIsProjectFolder', retryable: false, configuration: false },
  STALE_FILE: { key: 'projectDrive.errStaleFile', retryable: true, configuration: false },
  NOT_REVISABLE: { key: 'projectDrive.errUnavailable', retryable: false, configuration: false },
  REVISION_TOO_LARGE: { key: 'projectDrive.errUploadTooLarge', retryable: false, configuration: false },
  BASE_REQUIRED: { key: 'projectDrive.errUnavailable', retryable: false, configuration: false },
};

export function describeDriveError(err: unknown): DriveErrorView {
  if (err instanceof ApiNetworkError) {
    return { key: 'projectDrive.errNetwork', retryable: true, configuration: false, code: 'NETWORK' };
  }
  if (err instanceof ApiError) {
    const code = err.code as DriveErrorCode | undefined;
    if (code && code in BY_CODE) return { ...BY_CODE[code], code };
    if (err.status === 403) return { ...BY_CODE.FORBIDDEN, code: 'FORBIDDEN' };
    if (err.status === 404) return { ...BY_CODE.NOT_FOUND, code: 'NOT_FOUND' };
  }
  return { key: 'projectDrive.errUnavailable', retryable: true, configuration: false, code: 'UNKNOWN' };
}
