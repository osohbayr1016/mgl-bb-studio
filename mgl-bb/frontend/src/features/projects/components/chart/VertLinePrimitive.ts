import type {
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  IChartApi,
  ISeriesApi,
  SeriesType,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';

export interface VertLineOptions {
  color: string;
  width: number;
  labelText?: string;
  labelColor?: string;
  dashed?: boolean;
}

class VertLineRenderer implements IPrimitivePaneRenderer {
  constructor(
    private x: number | null,
    private options: VertLineOptions,
  ) {}
  draw(target: CanvasRenderingTarget2D): void {
    if (this.x === null) return;
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const px = Math.round(this.x! * scope.horizontalPixelRatio);
      ctx.save();
      ctx.strokeStyle = this.options.color;
      ctx.lineWidth = this.options.width * scope.horizontalPixelRatio;
      if (this.options.dashed) ctx.setLineDash([4 * scope.horizontalPixelRatio, 4 * scope.horizontalPixelRatio]);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, scope.bitmapSize.height);
      ctx.stroke();
      if (this.options.labelText) {
        ctx.setLineDash([]);
        ctx.fillStyle = this.options.labelColor ?? this.options.color;
        ctx.font = `${10 * scope.horizontalPixelRatio}px sans-serif`;
        ctx.fillText(this.options.labelText, px + 3 * scope.horizontalPixelRatio, 12 * scope.horizontalPixelRatio);
      }
      ctx.restore();
    });
  }
}

class VertLinePaneView implements IPrimitivePaneView {
  private x: number | null = null;
  constructor(
    private chart: IChartApi,
    private getTime: () => Time | null,
    private options: VertLineOptions,
  ) {}
  update(): void {
    const t = this.getTime();
    this.x = t === null ? null : this.chart.timeScale().timeToCoordinate(t);
  }
  renderer(): IPrimitivePaneRenderer {
    return new VertLineRenderer(this.x, this.options);
  }
}

/** A draggable-free vertical line pinned to a `Time`. `getTime` is read on
 *  every frame so the caller can move it by changing the returned value. */
export class VertLine implements ISeriesPrimitive<Time> {
  private paneView: VertLinePaneView;
  constructor(chart: IChartApi, getTime: () => Time | null, options: VertLineOptions) {
    this.paneView = new VertLinePaneView(chart, getTime, options);
  }
  updateAllViews(): void {
    this.paneView.update();
  }
  paneViews(): readonly IPrimitivePaneView[] {
    return [this.paneView];
  }
}

export type AttachableSeries = ISeriesApi<SeriesType>;
