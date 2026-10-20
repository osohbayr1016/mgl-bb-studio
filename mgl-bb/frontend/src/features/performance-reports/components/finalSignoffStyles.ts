/** Гарын үсгийн зураасны өндөр (mm) — үнийн саналтай ижил. */
export const SIGN_IMG_MM = 17;
/** Тамганы өндөр (mm). */
export const STAMP_MM = 40;
/** Тамганы доод хагас зурааснаас доош (mm). */
export const STAMP_BELOW_LINE_MM = STAMP_MM / 2;
/** Гадна контейнерийн бүтэн өндөр — overlap-д тохируулсан. */
export const STAMP_ROW_H_MM =
  Math.max(0, STAMP_BELOW_LINE_MM - SIGN_IMG_MM) + SIGN_IMG_MM + STAMP_BELOW_LINE_MM;

export const FINAL_SIGNOFF_STYLES = `
.perf-final__text {
  font-size: 10.5pt;
  line-height: 1.6;
  text-align: justify;
  margin: 0 0 5mm;
}
.perf-final__pct {
  background: #fff58a;
  padding: 0 4px;
  border-radius: 2px;
}
.perf-final__sign {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 14mm;
  row-gap: 0;
  align-items: start;
  margin-top: 8mm;
}
.perf-final__col-title {
  align-self: stretch;
  font-weight: 700;
  font-size: 10.5pt;
  color: #0F243E;
  margin-bottom: 5mm;
  border-bottom: 2px solid #0F243E;
  padding-bottom: 2mm;
  cursor: text;
}
.perf-final__col-title-mn .perf-txt {
  display: block;
  width: 100%;
  min-height: 5mm;
}
.perf-final__col-title-en {
  font-weight: 400;
  font-style: italic;
  color: #6b7785;
  font-size: 9pt;
  margin-top: 0.5mm;
}
.perf-final__col-title-en em { font-style: italic; }
.perf-final__field { margin-bottom: 5mm; min-width: 0; }
.perf-final__field--last { margin-bottom: 0; }
.perf-final__field-label {
  font-weight: 700;
  font-size: 9.5pt;
  color: #0F243E;
  margin-bottom: 2.5mm;
}
.perf-final__field-value {
  border-bottom: 1px solid #333;
  min-height: 6mm;
  padding-bottom: 1mm;
  margin-bottom: 2mm;
  font-size: 10pt;
  line-height: 1.35;
  color: #111;
  word-break: break-word;
}
.perf-final__field-value .perf-txt {
  display: block;
  width: 100%;
  min-height: 5mm;
}
/* Гарын үсэг + тамга — үнийн саналын overlap загвар. */
.perf-final__stamp {
  position: relative;
  height: ${STAMP_ROW_H_MM}mm;
  margin-bottom: 2mm;
  overflow: visible;
}
.perf-final__stamp-line {
  position: relative;
  width: 100%;
  height: ${SIGN_IMG_MM}mm;
  border-bottom: 1px solid #333;
  margin-top: ${Math.max(0, STAMP_BELOW_LINE_MM - SIGN_IMG_MM).toFixed(1)}mm;
}
/* Гарын үсэг + тамга хоёулаа зураасан ТӨВД — тамга дээр (z-index). */
.perf-final__stamp-sign {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: -1.8mm;
  max-height: ${SIGN_IMG_MM}mm;
  max-width: 45mm;
  width: auto;
  object-fit: contain;
  z-index: 1;
  mix-blend-mode: multiply;
}
.perf-final__stamp-seal {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: ${-STAMP_BELOW_LINE_MM}mm;
  height: ${STAMP_MM}mm;
  width: auto;
  object-fit: contain;
  z-index: 2;
  opacity: .95;
  mix-blend-mode: multiply;
  pointer-events: none;
}
.perf-final__field-en {
  font-style: italic;
  color: #888;
  font-size: 8.5pt;
}
`;
