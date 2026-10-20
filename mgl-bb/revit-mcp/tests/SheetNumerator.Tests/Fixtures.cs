using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.SheetNumerator.Core;

namespace RevitMcpAddin.SheetNumerator.Tests
{
    /// <summary>Тестийн туслах: snapshot, бүлэг, оролт, тохиргоо.  (Нэр нь «Tests»-ээр төгсөхгүй — тест биш.)</summary>
    internal static class Fx
    {
        private static int _index;

        public static SheetSnapshot Sheet(long id, string number, string name = null, long collection = 0,
            bool assembly = false, long assemblyId = 0, bool placeholder = false, bool visible = true,
            params FolderSegment[] path)
        {
            return new SheetSnapshot
            {
                SheetId = id,
                UniqueId = "uid-" + id,
                Number = number,
                Name = name ?? ("Sheet " + id),
                IsPlaceholder = placeholder,
                IsAssemblySheet = assembly,
                AssemblyId = assemblyId,
                AssemblyName = assembly ? "ASM" + assemblyId : null,
                CollectionId = collection,
                CollectionName = collection != 0 ? "COLL" + collection : null,
                BrowserPath = path ?? new FolderSegment[0],
                SatisfiesBrowserFilter = visible,
                SortKey = number,
                DocumentIndex = _index++,
            };
        }

        public static SheetSnapshot WithParams(SheetSnapshot s, params KeyValuePair<string, SheetParameterValue>[] values)
        {
            var d = new Dictionary<string, SheetParameterValue>();
            foreach (var kv in values)
                d[kv.Key] = kv.Value;
            s.Parameters = d;
            return s;
        }

        public static KeyValuePair<string, SheetParameterValue> P(ParameterKey key, string text, bool hasValue = true)
        {
            return new KeyValuePair<string, SheetParameterValue>(key.Stable, new SheetParameterValue(hasValue, text));
        }

        public static FolderSegment Seg(string name, long paramId = -1007404)
        {
            return new FolderSegment(name, paramId);
        }

        public static DocumentSnapshot Doc(IEnumerable<SheetSnapshot> sheets, UniquenessMode mode = UniquenessMode.PerSheetCollection,
            params SheetParameterInfo[] catalog)
        {
            return new DocumentSnapshot
            {
                DocumentKey = "doc-1",
                DocumentTitle = "Test",
                RevitVersion = "2027",
                RevitVersionNumber = 2027,
                Uniqueness = mode,
                Sheets = sheets.ToList(),
                ParameterCatalog = catalog.ToList(),
                Browser = new BrowserInfo { OrganizationName = "all" },
            };
        }

        public static SheetParameterInfo Param(ParameterKey key, string name, ParamValueKind kind, bool readOnly = false)
        {
            return new SheetParameterInfo { Key = key, DisplayName = name, ValueKind = kind, IsReadOnly = readOnly, PresentOnSheets = 1 };
        }

        public static SheetGroup GroupOf(IEnumerable<SheetSnapshot> sheets)
        {
            return new SheetGroup(GroupKey.All(), "group", sheets.ToList());
        }

        /// <summary>Нэг бүлэг (бүх хуудас) — Simple горим, анхдагч тохиргоо.</summary>
        public static RenumberPlan Plan(IList<SheetSnapshot> sheets, RenumberSettings s, int selected = -1,
            IList<SheetSnapshot> working = null, DocumentSnapshot doc = null, MarkerCapabilities markers = null)
        {
            doc = doc ?? Doc(sheets);
            SheetGroup g = GroupOf(sheets);
            return NumberingEngine.Compute(new NumberingInput
            {
                Document = doc,
                Group = g,
                WorkingOrder = (working ?? sheets).ToList(),
                SelectedIndex = selected,
                Settings = s,
                Markers = markers,
            });
        }

        public static RenumberSettings SimpleSettings(string prefix = "", long start = 1, int width = 1, string suffix = "", bool useStart = true)
        {
            var s = new RenumberSettings { Mode = NumberingMode.Simple };
            s.Simple.Prefix = prefix;
            s.Simple.Suffix = suffix;
            s.Simple.Start = start;
            s.Simple.Width = width;
            s.Simple.UseStartNumber = useStart;
            return s;
        }

        public static string[] Numbers(RenumberPlan plan)
        {
            return plan.Rows.Select(r => r.NewNumber).ToArray();
        }

        public static string[] Numbers(IEnumerable<SheetSnapshot> sheets)
        {
            return sheets.Select(s => s.Number).ToArray();
        }

        public static List<SheetSnapshot> Sheets(params string[] numbers)
        {
            var list = new List<SheetSnapshot>();
            for (int i = 0; i < numbers.Length; i++)
                list.Add(Sheet(i + 1, numbers[i]));
            return list;
        }

        public static MarkerCapabilities Markers(params char[] accepted)
        {
            var m = new MarkerCapabilities { IsProbed = true };
            foreach (char c in accepted)
                m.Accept(c);
            return m;
        }
    }
}
