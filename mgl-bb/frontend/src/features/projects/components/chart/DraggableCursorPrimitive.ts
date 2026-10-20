import type {
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  IChartApi,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

export interface DraggableCursorCallbacks {
  getTime: () => Time | null;
  setTime: (t: Time) => void;
  color: string;
}

class DraggableCursorRenderer implements IPrimitivePaneRenderer {
  constructor(
    private x: number | null,
    private color: string,
  ) {}
  draw(target: CanvasRenderingTarget2D): void {
    if (this.x === null) return;
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const ratio = scope.horizontalPixelRatio;
      const px = Math.round(this.x! * ratio);
      ctx.save();
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 2 * ratio;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, scope.bitmapSize.height);
      ctx.stroke();
      // grip handle near the top
      ctx.fillStyle = this.color;
      ctx.fillRect(px - 3 * ratio, 4 * ratio, 6 * ratio, 14 * ratio);
      ctx.restore();
    });
  }
}

class DraggableCursorPaneView implements IPrimitivePaneView {
  x: number | null = null;
  constructor(
    private chart: IChartApi,
    private cb: DraggableCursorCallbacks,
  ) {}
  update(): void {
    const t = this.cb.getTime();
    this.x = t === null ? null : this.chart.timeScale().timeToCoordinate(t);
  }
  renderer(): IPrimitivePaneRenderer {
    return new DraggableCursorRenderer(this.x, this.cb.color);
  }
}

/** A vertical cursor line the user can drag along the time axis.
 *  Reports position changes via `cb.setTime`. Not yet attached to any series. */
export class DraggableCursor implements ISeriesPrimitive<Time> {
  private paneView: DraggableCursorPaneView;
  private dragging = false;
  private container: HTMLElement | null;

  private readonly onDown: (e: PointerEvent) => void = (e) => this.handleDown(e);
  private readonly onMove: (e: PointerEvent) => void = (e) => this.handleMove(e);
  private readonly onUp: (e: PointerEvent) => void = () => this.handleUp();

  constructor(
    private chart: IChartApi,
    private cb: DraggableCursorCallbacks,
    container: HTMLElement,
  ) {
    this.container = container;
    this.paneView = new DraggableCursorPaneView(chart, cb);
    container.addEventListener('pointerdown', this.onDown);
    container.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
  }

  private handleDown(e: PointerEvent): void {
    const t = this.cb.getTime();
    if (t === null) return;
    const x = this.chart.timeScale().timeToCoordinate(t);
    if (x === null) return;
    const rect = this.container!.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    if (Math.abs(localX - x) <= 6) {
      this.dragging = true;
      this.chart.applyOptions({ handleScroll: false, handleScale: false });
    }
  }

  private handleMove(e: PointerEvent): void {
    if (!this.dragging || this.container === null) return;
    const rect = this.container.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const t = this.chart.timeScale().coordinateToTime(localX);
    if (t !== null) {
      this.cb.setTime(t);
    }
  }

  private handleUp(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.chart.applyOptions({ handleScroll: true, handleScale: true });
  }

  destroy(): void {
    // Drag дунд устгагдвал chart-ийн scroll/scale-ийг сэргээж үлдээнэ
    // (handleUp нь dragging биш үед шууд буцдаг тул дуудахад аюулгүй).
    this.handleUp();
    if (this.container !== null) {
      this.container.removeEventListener('pointerdown', this.onDown);
      this.container.removeEventListener('pointermove', this.onMove);
    }
    window.removeEventListener('pointerup', this.onUp);
    this.container = null;
  }

  updateAllViews(): void {
    this.paneView.update();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.paneView];
  }
}
