using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.SmartCount.Core
{
    /// <summary>
    /// Үр дүнг бүлэглэж, тоолно (ЦЭВЭР).  Элемент бүрийг ГАНЦ удаа `Add`-даж, `Build`-ээр мод гаргана.
    ///
    /// ⚠️ Мөрийн хязгаар (`maxRows`) нь ЗӨВХӨН drill-down жагсаалтыг хязгаарлана — `Total` ба бүлэг бүрийн
    /// тоо ТОВЧГҮЙ, ЯГ (хязгаараас хэтэрсэн ч).  Хязгаарт хүрсэн бол `RowsTruncated = true`.
    /// </summary>
    public sealed class CountAggregator
    {
        public const string EmptyLabel = "(хоосон)";
        public const string MissingLabel = "(параметр байхгүй)";

        private sealed class Node
        {
            public string Label;
            public string FieldLabel;
            public int Count;
            public Dictionary<string, Node> Kids = new Dictionary<string, Node>(StringComparer.Ordinal);
            public List<int> Rows = new List<int>();
        }

        private readonly List<GroupSpec> _specs;
        private readonly int _maxRows;
        private readonly CountResult _result = new CountResult();
        private readonly Node _root = new Node { Label = "Нийт" };

        public CountAggregator(IEnumerable<GroupSpec> specs, int maxRows = 200000)
        {
            _specs = (specs ?? new GroupSpec[0]).Where(s => s != null && s.Field != GroupField.Unknown).ToList();
            _maxRows = Math.Max(1, maxRows);
        }

        public int Total { get { return _result.Total; } }

        public void Add(ElementRecord r)
        {
            _result.Total++;
            int rowIndex = -1;
            if (_result.Rows.Count < _maxRows)
            {
                rowIndex = _result.Rows.Count;
                _result.Rows.Add(r);
            }
            else _result.RowsTruncated = true;

            Node cur = _root;
            cur.Count++;
            foreach (GroupSpec spec in _specs)
            {
                string label = LabelOf(spec, r);
                Node child;
                if (!cur.Kids.TryGetValue(label, out child))
                {
                    child = new Node { Label = label, FieldLabel = spec.Label };
                    cur.Kids[label] = child;
                }
                child.Count++;
                cur = child;
            }
            if (rowIndex >= 0) cur.Rows.Add(rowIndex);
        }

        internal static string LabelOf(GroupSpec spec, ElementRecord r)
        {
            string v;
            switch (spec.Field)
            {
                case GroupField.Category: v = r.Category; break;
                case GroupField.Family: v = r.Family; break;
                case GroupField.Type: v = r.Type; break;
                case GroupField.Level: v = r.Level; break;
                case GroupField.Parameter:
                    ParamValue p = r.Param(spec.ParameterName);
                    if (!p.Exists) return MissingLabel;
                    v = p.HasValue ? p.Text : null;
                    break;
                default: v = null; break;
            }
            return string.IsNullOrWhiteSpace(v) ? EmptyLabel : v.Trim();
        }

        public CountResult Build()
        {
            _result.Root = ToGroup(_root);
            return _result;
        }

        private static CountGroup ToGroup(Node n)
        {
            var g = new CountGroup { Label = n.Label, FieldLabel = n.FieldLabel, Count = n.Count, RowIndexes = n.Rows };
            g.Children = n.Kids.Values
                .OrderByDescending(k => k.Count)
                .ThenBy(k => k.Label, NaturalComparer.Instance)
                .Select(ToGroup)
                .ToList();
            return g;
        }
    }

    /// <summary>Хэт том сонголт/харуулалтаас хамгаална — Revit-ийн UI хэдэн мянган элементийг сонгоход гацдаг.</summary>
    public static class CountGuards
    {
        public const int ConfirmSelectOver = 2000;
        public const int MaxSelect = 20000;
        public const int MaxShow = 500;

        public sealed class Verdict
        {
            public bool Allowed;
            public bool NeedsConfirm;
            public string Message;
        }

        public static Verdict ForSelect(int count)
        {
            if (count <= 0) return new Verdict { Allowed = false, Message = "Сонгох элемент алга." };
            if (count > MaxSelect)
                return new Verdict { Allowed = false, Message = count + " элемент — нэг дор " + MaxSelect + "-аас олныг сонгохыг хориглоно (Revit гацна). Бүлгээр нарийсгана уу." };
            if (count > ConfirmSelectOver)
                return new Verdict { Allowed = true, NeedsConfirm = true, Message = count + " элементийг сонгох уу? Revit хэдэн секунд завгүй байж болно." };
            return new Verdict { Allowed = true };
        }

        public static Verdict ForShow(int count)
        {
            if (count <= 0) return new Verdict { Allowed = false, Message = "Харуулах элемент алга." };
            if (count > MaxShow)
                return new Verdict { Allowed = false, Message = count + " элементийг нэг дор харуулах боломжгүй (дээд " + MaxShow + "). Бүлгийг нарийсгана уу." };
            return new Verdict { Allowed = true };
        }
    }

    /// <summary>
    /// Smart Count цонхны Revit-тэй харилцах ГЭРЭЭ (modeless цонх → `SmartExecutor`).  Цонх Revit-ийн
    /// төрлийг мэдэхгүй; Revit-гүй smoke тестэд хуурамч хэрэгжүүлэлтээр.
    /// </summary>
    public interface ICountSession
    {
        string DocumentTitle { get; }
        SavedQueriesFile Queries { get; }
        void SaveQueries();
        Task<IReadOnlyList<CategoryInfo>> GetCategoriesAsync(CancellationToken ct);
        Task<IReadOnlyList<string>> GetLevelsAsync(CancellationToken ct);
        /// <summary>Сонгосон ангилалуудын элементүүдээс (жишээ авч) параметрийн нэрсийг санал болгоно.</summary>
        Task<IReadOnlyList<string>> GetParameterNamesAsync(IReadOnlyList<string> categoryIds, CancellationToken ct);
        Task<CountResult> RunAsync(QueryDefinition query, IProgress<JobProgress> progress, CancellationToken ct);
        Task<SelectOutcome> SelectAsync(IReadOnlyList<ElementRecord> rows, CancellationToken ct);
        Task<SelectOutcome> ShowAsync(IReadOnlyList<ElementRecord> rows, CancellationToken ct);
        /// <summary>Үр дүн гарснаас хойш загвар өөрчлөгдсөн эсвэл өөр файл руу шилжсэн.</summary>
        bool IsStale(CountResult result);
    }

    public static class SavedQueryStore
    {
        public const int Schema = 1;
        public const string FileName = "queries.json";

        public static SavedQueriesFile Load(SmartStore store = null)
        {
            store = store ?? SmartStore.Default;
            LoadResult<SavedQueriesFile> r = store.Load<SavedQueriesFile>(FileName, Schema, () => new SavedQueriesFile());
            SavedQueriesFile f = r.Value ?? new SavedQueriesFile();
            if (f.Queries == null) f.Queries = new List<QueryDefinition>();
            foreach (QueryDefinition q in f.Queries) Normalize(q);

            if (r.Status == LoadStatus.Missing && f.Queries.Count == 0)
            {
                f.Queries.AddRange(Starters());
                Save(f, store);
            }
            return f;
        }

        public static bool Save(SavedQueriesFile f, SmartStore store = null)
        {
            store = store ?? SmartStore.Default;
            return store.Save(FileName, Schema, f);
        }

        /// <summary>Нэмнэ/солино.  Нөхцөл өөрчлөгдвөл `Version` +1 (тоололтын үр дүнд «аль хувилбарын хайлт» тэмдэглэхэд).</summary>
        public static QueryDefinition Upsert(SavedQueriesFile f, QueryDefinition q)
        {
            Normalize(q);
            int idx = f.Queries.FindIndex(x => x.Id == q.Id);
            if (idx < 0)
            {
                f.Queries.Add(q);
                return q;
            }
            QueryDefinition old = f.Queries[idx];
            q.Version = Content(old) == Content(q) ? old.Version : old.Version + 1;
            f.Queries[idx] = q;
            return q;
        }

        public static bool Delete(SavedQueriesFile f, string id)
        {
            return f.Queries.RemoveAll(q => q.Id == id) > 0;
        }

        private static string Content(QueryDefinition q)
        {
            QueryDefinition c = q.Clone();
            c.Version = 0;
            c.Name = null;
            return SmartJson.Serialize(c);
        }

        public static void Normalize(QueryDefinition q)
        {
            if (q == null) return;
            if (string.IsNullOrWhiteSpace(q.Id)) q.Id = SmartHash.NewId();
            if (q.Categories == null) q.Categories = new List<string>();
            if (q.GroupBy == null) q.GroupBy = new List<GroupSpec>();
            if (q.Where == null) q.Where = QueryNode.Group(LogicOp.And);
            NormalizeNode(q.Where);
            if (q.Version < 1) q.Version = 1;
        }

        private static void NormalizeNode(QueryNode n)
        {
            if (n.Children == null) n.Children = new List<QueryNode>();
            foreach (QueryNode k in n.Children) if (k != null) NormalizeNode(k);
            n.Children.RemoveAll(k => k == null);
        }

        /// <summary>Эхний суулгацад ЗАСАХ/УСТГАХ боломжтой жишээ хайлтууд.</summary>
        public static List<QueryDefinition> Starters()
        {
            var list = new List<QueryDefinition>();
            list.Add(new QueryDefinition
            {
                Name = "Хана — төрлөөр",
                Categories = new List<string> { "OST_Walls" },
                GroupBy = new List<GroupSpec> { new GroupSpec { Field = GroupField.Type } },
            });
            list.Add(new QueryDefinition
            {
                Name = "Хаалга, цонх — давхараар",
                Categories = new List<string> { "OST_Doors", "OST_Windows" },
                GroupBy = new List<GroupSpec> { new GroupSpec { Field = GroupField.Category }, new GroupSpec { Field = GroupField.Level } },
            });
            list.Add(new QueryDefinition
            {
                Name = "Тулгуур, дам нуруу — гэр бүлээр",
                Categories = new List<string> { "OST_StructuralColumns", "OST_StructuralFraming" },
                GroupBy = new List<GroupSpec> { new GroupSpec { Field = GroupField.Category }, new GroupSpec { Field = GroupField.Family }, new GroupSpec { Field = GroupField.Type } },
            });
            return list;
        }
    }
}

namespace RevitMcpAddin.SmartCount.Core
{
    /// <summary>Үр дүнг хүснэгт (TSV) болгоно — Excel руу шууд буулгахад.  ЦЭВЭР.</summary>
    public static class CountExport
    {
        public static string ToTsv(CountResult r, IReadOnlyList<GroupSpec> specs)
        {
            var sb = new System.Text.StringBuilder();
            var active = (specs ?? new GroupSpec[0]).Where(s => s != null && s.Field != GroupField.Unknown).ToList();
            foreach (GroupSpec s in active) sb.Append(Cell(s.Label)).Append('\t');
            sb.Append("Тоо").Append('\n');

            if (active.Count == 0)
            {
                sb.Append(r.Total).Append('\n');
                return sb.ToString();
            }
            Walk(r.Root, new List<string>(), sb);
            sb.Append(string.Concat(Enumerable.Repeat("\t", active.Count - 1))).Append("Нийт").Append('\t').Append(r.Total).Append('\n');
            return sb.ToString();
        }

        private static void Walk(CountGroup g, List<string> path, System.Text.StringBuilder sb)
        {
            foreach (CountGroup c in g.Children)
            {
                path.Add(c.Label);
                if (c.Children.Count == 0)
                {
                    foreach (string p in path) sb.Append(Cell(p)).Append('\t');
                    sb.Append(c.Count).Append('\n');
                }
                else Walk(c, path, sb);
                path.RemoveAt(path.Count - 1);
            }
        }

        private static string Cell(string s)
        {
            return (s ?? "").Replace('\t', ' ').Replace('\r', ' ').Replace('\n', ' ');
        }
    }
}
