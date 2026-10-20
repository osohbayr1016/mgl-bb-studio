using System;
using System.Collections.Generic;
using System.Data;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Windows.Forms;
using FEModel;
using LiraAPI;

namespace MglLiraReport
{
    /// <summary>
    /// Оношилгоо: тайланд хэрэгтэй LIRA-ийн хүснэгт бүрийг уншиж,
    /// багана, мөрийн тоо, эхний мөрүүдийг текст файлд бичнэ.  Загварт юу ч бичихгүй.
    ///
    /// get_TableResult-ийн буруу хослол native талд унах магадлалтай тул мөр бүрийг
    /// дуудлагаас ӨМНӨ файлд бичиж flush хийнэ — LIRA унавал аль хүснэгт дээр унасныг харна.
    /// Засварлагчийн «LIRA → Оношилгоо» цэснээс (LiraEntry → LiraSource) дуудагдана.
    /// </summary>
    public static class LiraDiagnostics
    {
        const int ObjectCap = 300;
        const int SampleRows = 3;

        static readonly string[] Tables =
        {
            "RTT_LOADINGS_INFO", "RTT_MATERIALS_INFO", "RTT_SECTIONS_INFO", "RTT_DESIGNEDS_INFO",
            "RTT_LOADING_PERIODS_VIBRATION", "RTT_LOADING_STABILITY_KOEF", "RTT_LOADING_STABILITY_KOEF_RSN",
            "RTT_LOADING_RSU_KOEF", "RTT_LOADING_RSN_KOEF",
            "RTT_NODES", "RTT_ELEMENTS",
            "RTT_NODES_MOVE_DEKART", "RTT_NODES_MASS_DYNAMIC", "RTT_NODES_INERTIA_DYNAMIC",
            "RTT_NODES_REACTION_DEKART", "RTT_NODES_MOVE_DEKART_RSN_C", "RTT_NODES_REACTION_DEKART_RSN_C",
            "RTT_ELEMENTS_BAR", "RTT_ELEMENTS_PLATE", "RTT_ELEMENTS_BAR_RSN_C", "RTT_ELEMENTS_PLATE_RSN_C",
            "RTT_BAR_REINFORCED_CONCRETE", "RTT_PLATE_REINFORCED_CONCRETE",
            "RTT_BAR_REINFORCED_CONCRETE_RSU", "RTT_PLATE_REINFORCED_CONCRETE_RSU",
            "RTT_BAR_REINFORCED_CONCRETE_RSN", "RTT_PLATE_REINFORCED_CONCRETE_RSN",
            "RTT_BAR_GENERAL_SUMMARY_CHECK_STEEL_RESULTS", "RTT_BAR_GENERAL_SUMMARY_CHECK_STEEL_RESULTS_RSN",
            "RTT_GROUND_CHARS", "RTT_GROUND_WELL",
        };

        /// <returns>Бичсэн файлын зам.</returns>
        public static string Run(IResultLiraAPI api, int nodesNumber, int elementsNumber,
            List<List<Results_Key>> allCases, Results_Key currentCase, out string summary)
        {
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "MGL-LIRA");
            Directory.CreateDirectory(dir);
            string path = Path.Combine(dir, "diag-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".txt");

            int ok = 0, empty = 0, failed = 0;
            using (var w = new StreamWriter(path, false, new UTF8Encoding(true)) { AutoFlush = true })
            {
                try
                {
                    w.WriteLine("MGL LIRA diagnostic  " + DateTime.Now.ToString("s"));
                    w.WriteLine("LiraApiVersion=" + api.getLiraApiVersion() + "  nodes=" + nodesNumber + "  elements=" + elementsNumber);
                    w.WriteLine("currentCase=" + Key(currentCase));
                    for (int i = 0; i < (allCases?.Count ?? 0); i++)
                    {
                        var list = allCases[i] ?? new List<Results_Key>();
                        w.WriteLine("allCases[" + i + "] count=" + list.Count + " : " +
                                    string.Join(" ", list.Take(40).Select(Key)) + (list.Count > 40 ? " …" : ""));
                    }
                    w.WriteLine();

                    // Нэмэлтэд ороогүй ч хэрэгтэй байж болох хүснэгтүүд (суурь, ГУНТ г.м.) — нэрээр нь.
                    var extra = Enum.GetNames(typeof(e_Results_TableType))
                        .Where(n => n.Contains("GROUND_FUND") || n.Contains("DRIFT") || n.Contains("STOREY") || n.Contains("FLOOR"))
                        .Except(Tables);

                    foreach (string name in Tables.Concat(extra))
                    {
                        if (!Enum.TryParse(name, out e_Results_TableType rtt))
                        {
                            w.WriteLine("## " + name + "  — энэ хувилбарт байхгүй");
                            continue;
                        }
                        switch (Probe(w, api, rtt, nodesNumber, elementsNumber, allCases, currentCase))
                        {
                            case 1: ok++; break;
                            case 0: empty++; break;
                            default: failed++; break;
                        }
                    }
                    w.WriteLine();
                    w.WriteLine("SUMMARY ok=" + ok + " empty=" + empty + " failed=" + failed);
                }
                catch (Exception ex)
                {
                    w.WriteLine("FATAL " + ex);
                }
            }

            summary = "Өгөгдөлтэй хүснэгт: " + ok + "\nХоосон: " + empty + "\nАлдаатай: " + failed;
            return path;
        }

        /// <returns>1 = өгөгдөлтэй, 0 = хоосон, -1 = алдаа</returns>
        static int Probe(StreamWriter w, IResultLiraAPI api, e_Results_TableType rtt, int nodes, int elements,
            List<List<Results_Key>> allCases, Results_Key current)
        {
            string name = rtt.ToString();
            w.WriteLine("## " + name);

            List<int> objs = ObjectsFor(name, nodes, elements);
            bool sawError = false;
            foreach (var (label, keys) in KeyStrategies(name, allCases, current))
            {
                var objVariants = objs.Count > 0 ? new[] { objs, new List<int>() } : new[] { objs };
                foreach (var objList in objVariants)
                {
                    string attempt = "   try keys=" + label + "(" + keys.Count + ") objs=" + objList.Count;
                    w.WriteLine(attempt + " …");
                    var sw = Stopwatch.StartNew();
                    try
                    {
                        e_Results_ColumnType[] colTypes = null;
                        string[] colNames = null;
                        DataTable t = api.get_TableResult(rtt, new List<int>(objList), new List<Results_Key>(keys), ref colTypes, ref colNames);
                        long ms = sw.ElapsedMilliseconds;
                        int rows = t?.Rows.Count ?? 0;
                        w.WriteLine("      -> rows=" + rows + " cols=" + (t?.Columns.Count ?? 0) + " " + ms + "ms");
                        if (t == null || rows == 0) continue;

                        for (int c = 0; c < t.Columns.Count; c++)
                        {
                            string ct = colTypes != null && c < colTypes.Length ? colTypes[c].ToString() : "?";
                            string cn = colNames != null && c < colNames.Length ? colNames[c] : t.Columns[c].ColumnName;
                            w.WriteLine("      col[" + c + "] " + ct + " | " + Clean(cn) + " | " + t.Columns[c].DataType.Name);
                        }
                        for (int r = 0; r < Math.Min(SampleRows, rows); r++)
                            w.WriteLine("      row[" + r + "] " + string.Join(" ; ", t.Rows[r].ItemArray.Select(Fmt)));
                        return 1;
                    }
                    catch (Exception ex)
                    {
                        sawError = true;
                        w.WriteLine("      !! " + ex.GetType().Name + ": " + Clean(ex.Message));
                    }
                }
            }
            return sawError ? -1 : 0;
        }

        static List<int> ObjectsFor(string name, int nodes, int elements)
        {
            bool nodeTable = name.StartsWith("RTT_NODES");
            bool elemTable = name.StartsWith("RTT_ELEMENTS") || name.StartsWith("RTT_BAR") || name.StartsWith("RTT_PLATE");
            int n = nodeTable ? nodes : elemTable ? elements : Math.Max(nodes, 1);
            if (!nodeTable && !elemTable && (name.Contains("INFO") || name.Contains("KOEF") || name.Contains("PERIODS") || name.Contains("GROUND")))
                return new List<int>();
            return Enumerable.Range(0, Math.Min(ObjectCap, Math.Max(n, 0))).ToList();
        }

        static IEnumerable<(string, List<Results_Key>)> KeyStrategies(string name, List<List<Results_Key>> all, Results_Key current)
        {
            List<Results_Key> Get(int i) => all != null && i < all.Count && all[i] != null ? all[i] : new List<Results_Key>();
            var cur = current != null ? new List<Results_Key> { current } : new List<Results_Key>();
            var none = new List<Results_Key>();

            var order = new List<(string, List<Results_Key>)>();
            if (name.Contains("PERIODS") || name.Contains("MASS_DYNAMIC") || name.Contains("INERTIA") || name.Contains("MODES"))
                order.Add(("modes", Get(1)));
            if (name.Contains("RSN"))
                order.Add(("rsn", Get(3)));
            if (name.Contains("STABIL"))
                order.Add(("stab", name.Contains("RSN") ? Get(4) : Get(2)));
            if (name.Contains("INFO") || name.Contains("KOEF") || name.Contains("GROUND") || name == "RTT_NODES" || name == "RTT_ELEMENTS")
                order.Add(("none", none));
            order.Add(("cur", cur));
            order.Add(("all0", Get(0)));
            if (!order.Any(o => o.Item1 == "none")) order.Add(("none", none));

            var seen = new HashSet<string>();
            foreach (var o in order)
                if (seen.Add(o.Item1)) yield return o;
        }

        static string Key(Results_Key k) =>
            k == null ? "null" : "(" + k.m_IndexLoadingCase + "," + k.m_SubIndexLoadingCase + "," + k.m_IndexForm + ")";

        static string Fmt(object v) =>
            v == null || v is DBNull ? "∅" : Clean(Convert.ToString(v, CultureInfo.InvariantCulture));

        static string Clean(string s) => (s ?? "").Replace("\r", " ").Replace("\n", " ");
    }
}
