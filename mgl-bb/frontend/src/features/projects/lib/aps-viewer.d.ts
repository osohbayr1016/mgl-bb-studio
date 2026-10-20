/* Minimal ambient types for the Autodesk APS Viewer SDK, which is loaded from
 * Autodesk's CDN at runtime (see useApsViewerScript.ts) rather than bundled.
 * Only the members ApsViewer.tsx actually uses are declared — no @types dep. */
export {};

declare global {
  namespace Autodesk {
    namespace Viewing {
      type AccessTokenCallback = (token: string, expiresInSeconds: number) => void;

      interface InitializerOptions {
        env?: string;
        api?: string;
        getAccessToken?: (callback: AccessTokenCallback) => void;
        accessToken?: string;
      }

      function Initializer(options: InitializerOptions, onInitialized: () => void): void;
      function shutdown(): void;

      interface BubbleNode {
        getDefaultGeometry(): BubbleNode;
      }

      class Document {
        static load(
          documentId: string,
          onSuccess: (doc: Document) => void,
          onError: (errorCode: number, errorMsg: string, ...rest: unknown[]) => void,
        ): void;
        getRoot(): BubbleNode;
      }

      class Viewer3D {
        constructor(container: HTMLElement, config?: object);
        start(): number;
        finish(): void;
        setTheme(theme: string): void;
        loadDocumentNode(doc: Document, node: BubbleNode): Promise<unknown>;
      }

      class GuiViewer3D extends Viewer3D {}
    }
  }

  interface Window {
    Autodesk: typeof Autodesk;
  }
}
