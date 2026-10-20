using System;
using System.Collections.Generic;
using System.Data;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using FEModel;
using LiraAPI;

namespace MglLiraReport.Results
{
    /// <summary>
    /// LIRA-ийн IResultLiraAPI-аас тор ба шилжилт уншина.  Баганыг ТӨРЛӨӨР нь (e_Results_ColumnType) олно —
    /// дараалал, нэрэнд найдахгүй.  Хүлээсэн багана олдохгүй бол олдсон багануудыг нэрлэсэн алдаа шиднэ,
    /// энэ нь оношилгооны файлтай хамт асуудлыг шууд харуулна.
    /// Баганын төрлүүд: LiraAPIHelp.pdf (RTT_NODES: RCT_NUMBER Int32, RCT_COORDINATE_X/Y/Z Double;
    /// RTT_ELEMENTS: RCT_NUMBER_NODE «№№ узлов» String; RTT_NODES_MOVE_DEKART*: RCT_MOVE_X/Y/Z Double).
    /// </summary>
    public sealed class LiraReader
    {
        readonly IResultLiraAPI _api;
        readonly int _nodes, _elements;
        readonly List<List<Results_Key>> _cases;
        LiraMesh _mesh;
        Dictionary<int, int> _nodeIndexByNumber;

        public LiraReader(IResultLiraAPI api, int nodes, int elements, List<List<Results_Key>> cases)
        {
            _api = api; _nodes = nodes; _elements = elements; _cases = cases ?? new List<List<Results_Key>>();
        }

        // ───────────────────────────── хослол ─────────────────────────────

        public List<LiraCase> ListCases(CaseSource source)
        {
            var keys = KeysFor(source);
            var names = source == CaseSource.Loading ? LoadingNames() : RsnNames();
            var list = new List<LiraCase>();
            foreach (var k in keys)
            {
                int n = k.m_IndexLoadingCase + 1;
                string label = source == CaseSource.Loading ? "Ачаалал " + n : "РСН " + n;
                if (k.m_SubIndexLoadingCase > 0) label += " / " + (k.m_SubIndexLoadingCase + 1);
                if (names.TryGetValue(n, out var name) && !string.IsNullOrWhiteSpace(name)) label += " — " + name.Trim();
                list.Add(new LiraCase { Source = source, Index = k.m_IndexLoadingCase, Sub = k.m_SubIndexLoadingCase, Form = k.m_IndexForm, Label = label });
            }
            return list;
        }

        List<Results_Key> KeysFor(CaseSource s)
        {
            int i = s == CaseSource.Loading ? 0 : 3;
            return i < _cases.Count && _cases[i] != null ? _cases[i] : new List<Results_Key>();
        }

        Dictionary<int, string> LoadingNames()
        {
            var map = new Dictionary<int, string>();
            var t = TryTable(e_Results_TableType.RTT_LOADINGS_INFO, new List<int>(), new List<Results_Key>(), out var types, out _);
            if (t == null) return map;
            int iCase = Array.IndexOf(types, e_Results_ColumnType.RCT_LOADING_CASE);
            int iName = Array.IndexOf(types, e_Results_ColumnType.RCT_NAME);
            if (iCase < 0 || iName < 0) return map;
            foreach (DataRow r in t.Rows)
                if (TryInt(r[iCase], out int n)) map[n] = Convert.ToString(r[iName], CultureInfo.InvariantCulture);
            return map;
        }

        /// <summary>РСН-ийн нэр («ХОСЛОЛ-2 (SE+X)») — коэффициентийн хүснэгтийн тайлбар баганаас; олдохгүй бол хоосон.</summary>
        Dictionary<int, string> RsnNames()
        {
            var map = new Dictionary<int, string>();
            var t = TryTable(e_Results_TableType.RTT_LOADING_RSN_KOEF, new List<int>(), new List<Results_Key>(), out var types, out _);
            if (t == null) return map;
            int iRsn = Array.IndexOf(types, e_Results_ColumnType.RCT_RSN_CASE);
            if (iRsn < 0) return map;
            int iName = Array.IndexOf(types, e_Results_ColumnType.RCT_COMMENT);
            if (iName < 0) iName = Array.IndexOf(types, e_Results_ColumnType.RCT_NAME);
            if (iName < 0) return map;
            foreach (DataRow r in t.Rows)
                if (TryInt(r[iRsn], out int n) && !map.ContainsKey(n))
                {
                    string s = Convert.ToString(r[iName], CultureInfo.InvariantCulture);
                    if (!string.IsNullOrWhiteSpace(s)) map[n] = s;
                }
            return map;
        }

        // ───────────────────────────── тор ─────────────────────────────

        public LiraMesh GetMesh()
        {
            if (_mesh != null) return _mesh;
            var all = Enumerable.Range(0, _nodes).ToList();
            var t = Table(e_Results_TableType.RTT_NODES, all, new List<Results_Key>(), out var types, out var names);
            int iNum = Col(types, names, e_Results_ColumnType.RCT_NUMBER, "RTT_NODES", required: false);
            int iX = Col(types, names, e_Results_ColumnType.RCT_COORDINATE_X, "RTT_NODES");
            int iY = Col(types, names, e_Results_ColumnType.RCT_COORDINATE_Y, "RTT_NODES");
            int iZ = Col(types, names, e_Results_ColumnType.RCT_COORDINATE_Z, "RTT_NODES");

            int n = t.Rows.Count;
            var mesh = new LiraMesh { NodeNumbers = new int[n], X = new double[n], Y = new double[n], Z = new double[n] };
            _nodeIndexByNumber = new Dictionary<int, int>(n);
            for (int i = 0; i < n; i++)
            {
                var r = t.Rows[i];
                int num = iNum >= 0 && TryInt(r[iNum], out int v) ? v : i + 1;
                mesh.NodeNumbers[i] = num;
                mesh.X[i] = Dbl(r[iX]); mesh.Y[i] = Dbl(r[iY]); mesh.Z[i] = Dbl(r[iZ]);
                _nodeIndexByNumber[num] = i;
            }

            var allE = Enumerable.Range(0, _elements).ToList();
            var te = Table(e_Results_TableType.RTT_ELEMENTS, allE, new List<Results_Key>(), out var etypes, out var enames);
            int iNodes = Col(etypes, enames, e_Results_ColumnType.RCT_NUMBER_NODE, "RTT_ELEMENTS");
            foreach (DataRow r in te.Rows)
            {
                var idx = ParseNodeList(r[iNodes])
                    .Select(num => _nodeIndexByNumber.TryGetValue(num, out int k) ? k : -1)
                    .ToArray();
                if (idx.Length >= 2 && idx.All(k => k >= 0)) mesh.Elements.Add(idx);
            }
            mesh.FixQuadOrder();
            _mesh = mesh;
            return mesh;
        }

        /// <summary>«№№ узлов» нь «12 13 45 46» шиг мөр; массив ирвэл түүнийг ч уншина.</summary>
        static IEnumerable<int> ParseNodeList(object v)
        {
            if (v == null || v is DBNull) yield break;
            if (v is string s)
            {
                foreach (Match m in Regex.Matches(s, @"\d+")) yield return int.Parse(m.Value, CultureInfo.InvariantCulture);
                yield break;
            }
            if (v is System.Collections.IEnumerable e)
            {
                foreach (var o in e) if (TryInt(o, out int k)) yield return k;
                yield break;
            }
            if (TryInt(v, out int one)) yield return one;
        }

        // ───────────────────────────── шилжилт ─────────────────────────────

        public NodeField GetDisplacement(LiraCase c, MoveComponent comp)
        {
            var mesh = GetMesh();
            var rtt = c.Source == CaseSource.Loading ? e_Results_TableType.RTT_NODES_MOVE_DEKART
                    : c.Source == CaseSource.RsnNorm ? e_Results_TableType.RTT_NODES_MOVE_DEKART_RSN_N
                    : e_Results_TableType.RTT_NODES_MOVE_DEKART_RSN_C;
            var key = new Results_Key(c.Index, c.Sub, c.Form);
            var all = Enumerable.Range(0, _nodes).ToList();
            var t = Table(rtt, all, new List<Results_Key> { key }, out var types, out var names);

            int iNum = Col(types, names, e_Results_ColumnType.RCT_NUMBER, rtt.ToString(), required: false);
            int iX = Col(types, names, e_Results_ColumnType.RCT_MOVE_X, rtt.ToString());
            int iY = Col(types, names, e_Results_ColumnType.RCT_MOVE_Y, rtt.ToString());
            int iZ = Col(types, names, e_Results_ColumnType.RCT_MOVE_Z, rtt.ToString());
            int iUnit = comp == MoveComponent.Y ? iY : comp == MoveComponent.Z ? iZ : iX;

            var values = Enumerable.Repeat(double.NaN, mesh.NodeCount).ToArray();
            for (int r = 0; r < t.Rows.Count; r++)
            {
                var row = t.Rows[r];
                int idx;
                if (iNum >= 0 && TryInt(row[iNum], out int num)) { if (!_nodeIndexByNumber.TryGetValue(num, out idx)) continue; }
                else idx = r < mesh.NodeCount ? r : -1;
                if (idx < 0) continue;

                double x = Dbl(row[iX]), y = Dbl(row[iY]), z = Dbl(row[iZ]);
                double val = comp == MoveComponent.X ? x : comp == MoveComponent.Y ? y : comp == MoveComponent.Z ? z : Math.Sqrt(x * x + y * y);
                // РСН нэг зангилаанд хэд хэдэн мөр (хувилбар) өгвөл абсолют хамгийн их нь.
                if (double.IsNaN(values[idx]) || Math.Abs(val) > Math.Abs(values[idx])) values[idx] = val;
            }

            string colName = names != null && iUnit < names.Length ? names[iUnit] : null;
            return new NodeField { Values = values, ColumnName = colName, UnitHint = UnitOf(colName) };
        }

        static string UnitOf(string colName)
        {
            if (string.IsNullOrEmpty(colName)) return null;
            var m = Regex.Match(colName, @"\(([^()]+)\)\s*$");
            return m.Success ? m.Groups[1].Value.Trim() : null;
        }

        // ───────────────────────────── туслах ─────────────────────────────

        DataTable Table(e_Results_TableType rtt, List<int> objs, List<Results_Key> keys, out e_Results_ColumnType[] types, out string[] names)
        {
            var t = TryTable(rtt, objs, keys, out types, out names);
            if (t == null || t.Rows.Count == 0)
                throw new LiraReadException(rtt + " хүснэгт хоосон буюу уншигдсангүй (объект " + objs.Count + ", хослол " + keys.Count + ").");
            return t;
        }

        DataTable TryTable(e_Results_TableType rtt, List<int> objs, List<Results_Key> keys, out e_Results_ColumnType[] types, out string[] names)
        {
            types = null; names = null;
            try
            {
                var sw = Stopwatch.StartNew();
                var t = _api.get_TableResult(rtt, objs, keys, ref types, ref names);
                Trace.WriteLine("[MGL] " + rtt + " rows=" + (t?.Rows.Count ?? 0) + " " + sw.ElapsedMilliseconds + "ms");
                if (types == null && t != null) types = new e_Results_ColumnType[t.Columns.Count];
                return t;
            }
            catch (Exception ex)
            {
                Trace.WriteLine("[MGL] " + rtt + " failed: " + ex.Message);
                types = types ?? new e_Results_ColumnType[0];
                return null;
            }
        }

        static int Col(e_Results_ColumnType[] types, string[] names, e_Results_ColumnType want, string table, bool required = true)
        {
            int i = types == null ? -1 : Array.IndexOf(types, want);
            if (i < 0 && required)
            {
                string found = types == null ? "(байхгүй)" : string.Join(", ", types.Select((t, k) => t + (names != null && k < names.Length ? "=" + names[k] : "")));
                throw new LiraReadException(table + " хүснэгтэд " + want + " багана олдсонгүй.\nОлдсон баганууд: " + found);
            }
            return i;
        }

        static bool TryInt(object v, out int n)
        {
            n = 0;
            if (v == null || v is DBNull) return false;
            try { n = Convert.ToInt32(v, CultureInfo.InvariantCulture); return true; } catch { return false; }
        }

        static double Dbl(object v)
        {
            if (v == null || v is DBNull) return double.NaN;
            try { return Convert.ToDouble(v, CultureInfo.InvariantCulture); } catch { return double.NaN; }
        }
    }

    public sealed class LiraReadException : Exception
    {
        public LiraReadException(string message) : base(message) { }
    }
}
