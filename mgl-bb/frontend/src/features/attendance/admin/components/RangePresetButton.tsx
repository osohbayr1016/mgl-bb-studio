/** Огнооны муж товчлох жижиг pill товч (энэ 7 хоног / энэ сар / сүүлийн 30…). */
export default function RangePresetButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11px] px-2.5 py-1 rounded-full border border-border bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
    >
      {label}
    </button>
  );
}
