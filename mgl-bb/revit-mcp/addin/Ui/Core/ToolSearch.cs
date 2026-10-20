using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.Ui.Core
{
    /// <summary>
    /// Каталогийн ЛОКАЛ хайлт (сүлжээ, AI хэрэггүй).  `TextFold`-оор кирилл↔латин нэг хэлбэрт
    /// буулгадаг тул «huudas dugaar», «хуудас дугаар», «Clash», «Хуулж тавих» (хуучин шошго)
    /// бүгд ижил хэрэгсэлд хүргэнэ.  Токен бүр заавал таарна (AND).
    /// </summary>
    public static class ToolSearch
    {
        public static IReadOnlyList<ToolMeta> Filter(IEnumerable<ToolMeta> tools, string query)
        {
            if (tools == null) return new List<ToolMeta>();
            List<ToolMeta> all = tools.Where(t => t != null).ToList();
            foreach (ToolMeta t in all) Prepare(t);

            string folded = TextFold.Fold(query);
            if (folded.Length == 0)
                return all.OrderBy(t => (int)t.Panel).ThenBy(t => t.Order).ToList();

            string[] tokens = folded.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            var scored = new List<KeyValuePair<ToolMeta, int>>();
            foreach (ToolMeta t in all)
            {
                int total = 0;
                bool ok = true;
                foreach (string tok in tokens)
                {
                    int s = ScoreToken(t, tok);
                    if (s <= 0) { ok = false; break; }
                    total += s;
                }
                if (ok) scored.Add(new KeyValuePair<ToolMeta, int>(t, total));
            }
            return scored
                .OrderByDescending(kv => kv.Value)
                .ThenBy(kv => (int)kv.Key.Panel)
                .ThenBy(kv => kv.Key.Order)
                .Select(kv => kv.Key)
                .ToList();
        }

        private static int ScoreToken(ToolMeta t, string tok)
        {
            int best = 0;
            foreach (string a in t.FoldedAliases)
            {
                if (a == tok) best = Math.Max(best, 60);
                else if (a.StartsWith(tok, StringComparison.Ordinal)) best = Math.Max(best, 45);
                else if (a.IndexOf(tok, StringComparison.Ordinal) >= 0) best = Math.Max(best, 30);
            }
            if (t.FoldedLabel.StartsWith(tok, StringComparison.Ordinal)) best = Math.Max(best, 40);
            else if (t.FoldedLabel.IndexOf(tok, StringComparison.Ordinal) >= 0) best = Math.Max(best, 25);
            if (best == 0 && t.FoldedHaystack.IndexOf(tok, StringComparison.Ordinal) >= 0) best = 10;
            return best;
        }

        internal static void Prepare(ToolMeta t)
        {
            if (t.FoldedHaystack != null) return;
            var aliases = new List<string>();
            if (t.Aliases != null)
                foreach (string a in t.Aliases)
                {
                    string f = TextFold.Fold(a);
                    if (f.Length > 0) aliases.Add(f);
                }
            aliases.Add(TextFold.Fold(t.Name));
            t.FoldedAliases = aliases.ToArray();
            t.FoldedLabel = TextFold.Fold((t.LabelOneLine ?? string.Empty) + " " + (t.FullName ?? string.Empty));
            string hay = string.Join(" ", new[]
            {
                t.LabelOneLine, t.FullName, t.Purpose, t.Confusable,
                RibbonPlan.WhereTitles(t), string.Join(" ", t.Aliases ?? new string[0]),
            }.Where(s => !string.IsNullOrEmpty(s)));
            t.FoldedHaystack = TextFold.Fold(hay);
        }
    }

    public static class PanelTitles
    {
        public static string Of(ToolPanelId id)
        {
            switch (id)
            {
                case ToolPanelId.Work: return "Ажил";
                case ToolPanelId.Drawing: return "Зураг";
                case ToolPanelId.Rebar: return "Арматур";
                case ToolPanelId.Schedule: return "Түүвэр";
                case ToolPanelId.Check: return "Шалгалт";
                case ToolPanelId.Export: return "Экспорт";
                case ToolPanelId.Library: return "Сан ба тохиргоо";
                case ToolPanelId.Architecture: return "Архитектур";
                case ToolPanelId.Interior: return "Интерьер";
                case ToolPanelId.Structure: return "Бүтээц";
                case ToolPanelId.Mep: return "Инженерийн шугам";
                default: return id.ToString();
            }
        }
    }
}
