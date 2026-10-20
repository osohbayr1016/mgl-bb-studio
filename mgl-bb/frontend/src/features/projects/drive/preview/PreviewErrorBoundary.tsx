/**
 * Office preview (docx-preview / exceljs) доторх render алдааг ЦОНХ ДОТОР нь
 * барина.  Үгүй бол гадны сангийн таамаглаагүй өгөгдөл (2026-09-28: холбоостой
 * rich text нүд) route-ийн boundary хүртэл хөөрч БҮХ хуудсыг «алдаа гарлаа»
 * дэлгэцээр солидог байв.  `resetKey` (blob) солигдоход дахин оролдоно.
 *
 * ⚠️ Lazy chunk ачаалах алдааг (deploy-ийн дараах хуучин hash) ЗАЛГИХГҮЙ —
 * дахин шидэж `AppErrorBoundary`-ийн нэг удаагийн reload руу дамжуулна.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isChunkLoadError } from '@/shared/lib/chunkLoadError';

interface Props {
  resetKey: unknown;
  fallback: ReactNode;
  children: ReactNode;
}

interface State {
  key: unknown;
  error: unknown;
  failed: boolean;
}

export class PreviewErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { key: props.resetKey, error: null, failed: false };
  }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { failed: true, error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // Өөр файл ирвэл өмнөх алдааг мартана.
    return props.resetKey !== state.key ? { key: props.resetKey, error: null, failed: false } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (!isChunkLoadError(error)) console.error('[drive-preview] render failed', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (isChunkLoadError(this.state.error)) throw this.state.error;
    return this.props.fallback;
  }
}
