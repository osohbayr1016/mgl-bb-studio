using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace RevitMcpAddin.SheetNumerator.Core
{
    /// <summary>
    /// Project Browser-ийн ЭРЭМБИЙН харьцуулагч.  Revit өөрийн эрэмбийг API-аар өгдөггүй тул БОДИТ Project Browser-ийг
    /// (Revit 2027.2, 2026-10-01) UI Automation-аар уншиж, scratch хуудсаар хэмжин ЯГ ТАЙЛСАН дүрэм:
    ///
    ///  1. Мөрийг «бичвэр» ба «тоо» (ASCII цифрийн залгаа) хэсгүүдэд хуваагаад хэсэг тус бүрээр харьцуулна.
    ///  2. Тоо ба тоо: УТГААР, ямар ч урттай (20+ орон ч яг) — тэргүүлэх тэг тооцогдохгүй (A-2 = A-02 = A-002).
    ///  3. Бичвэр ба бичвэр: хэсгийн БҮТЭН бичвэрийг харьцуулна — угтвар болох богино нь түрүүлнэ, ард нь юу ч байсан
    ///     («A1» &lt; «A 1» &lt; «A-1»: «A» нь «A »-ийн угтвар).  Тэмдэгтийг код байрлалаар; ЗӨВХӨН ASCII үсэг
    ///     жижигрүүлэгдэнэ («_» нь «a»-аас өмнө; кирилл, латин-1 нь том/жижгийг ЯЛГАНА: «Б» &lt; «б»).
    ///  3'. Тоо ба бичвэр: эхний тэмдэгтүүдийг код байрлалаар (цифр нь «/»-ээс хойш, «=»-ээс өмнө).
    ///  4. Бүх хэсэг тэнцүү бол хэсгийн тоо цөөн нь түрүүлнэ.
    ///
    /// Тэнцүү (0) үед дуудагч нь нэр, дараа нь document-ийн дарааллаар шийднэ (<see cref="SheetGroupingService.OrderByBrowser"/>).
    /// ⚠️ Хэмжигдээгүй: цифр шиг боловч ASCII БИШ тэмдэгт (², ٣, １) дотор байх үед Revit-ийн үр дүн тогтворгүй
    /// харагдсан (харьцуулагч нь тэнд ийм дүрэмгүй) — бодит дугаарт ийм тэмдэгт ховор.
    /// </summary>
    public sealed class NaturalComparer : IComparer<string>
    {
        public static readonly NaturalComparer Instance = new NaturalComparer();

        public int Compare(string x, string y)
        {
            if (ReferenceEquals(x, y))
                return 0;
            if (x == null)
                return -1;
            if (y == null)
                return 1;

            int i = 0, j = 0;
            while (i < x.Length && j < y.Length)
            {
                bool dx = IsDigit(x[i]);
                bool dy = IsDigit(y[j]);

                if (dx && dy)
                {
                    int si = i, sj = j;
                    while (i < x.Length && IsDigit(x[i]))
                        i++;
                    while (j < y.Length && IsDigit(y[j]))
                        j++;
                    int c = CompareDigitRuns(x, si, i, y, sj, j);
                    if (c != 0)
                        return c;
                    continue;
                }

                if (dx != dy)
                {
                    // Тоо ба бичвэр: эхний тэмдэгтүүд ЯГ ялгаатай (нэг нь цифр) — код байрлалаар.
                    return Fold(x[i]) < Fold(y[j]) ? -1 : 1;
                }

                // Бичвэр ба бичвэр: дараагийн тоо хүртэлх БҮТЭН бичвэр — угтвар болох богино нь түрүүлнэ.
                int ei = i;
                while (ei < x.Length && !IsDigit(x[ei]))
                    ei++;
                int ej = j;
                while (ej < y.Length && !IsDigit(y[ej]))
                    ej++;
                int lenX = ei - i;
                int lenY = ej - j;
                int common = lenX < lenY ? lenX : lenY;
                for (int k = 0; k < common; k++)
                {
                    char a = Fold(x[i + k]);
                    char b = Fold(y[j + k]);
                    if (a != b)
                        return a < b ? -1 : 1;
                }
                if (lenX != lenY)
                    return lenX < lenY ? -1 : 1;
                i = ei;
                j = ej;
            }
            if (i < x.Length)
                return 1;
            if (j < y.Length)
                return -1;
            return 0;
        }

        /// <summary>Тэргүүлэх тэгийг алгасаад утгаар (урт, дараа нь цифрээр) — халихгүй, ямар ч урттай.</summary>
        private static int CompareDigitRuns(string x, int xs, int xe, string y, int ys, int ye)
        {
            while (xs < xe - 1 && x[xs] == '0')
                xs++;
            while (ys < ye - 1 && y[ys] == '0')
                ys++;
            int lenX = xe - xs;
            int lenY = ye - ys;
            if (lenX != lenY)
                return lenX < lenY ? -1 : 1;
            for (int k = 0; k < lenX; k++)
            {
                if (x[xs + k] != y[ys + k])
                    return x[xs + k] < y[ys + k] ? -1 : 1;
            }
            return 0;
        }

        /// <summary>ЗӨВХӨН ASCII үсгийг жижигрүүлнэ (Revit хэмжсэн: «_» &lt; «a», харин «Б» &lt; «б» — кирилл нь ялгагдана).</summary>
        private static char Fold(char c)
        {
            return c >= 'A' && c <= 'Z' ? (char)(c + 32) : c;
        }

        private static bool IsDigit(char c)
        {
            return c >= '0' && c <= '9';
        }
    }

    public sealed class GroupingResult
    {
        public GroupingResult(GroupNode root, IReadOnlyList<SheetGroup> groups)
        {
            Root = root;
            Groups = groups;
        }

        public GroupNode Root { get; }

        /// <summary>Бүх бүлэг — модны дарааллаар.</summary>
        public IReadOnlyList<SheetGroup> Groups { get; }

        public SheetGroup Find(GroupKey key)
        {
            if (key == null)
                return null;
            foreach (SheetGroup g in Groups)
            {
                if (g.Key.Equals(key))
                    return g;
            }
            return null;
        }

        public SheetGroup FindContaining(long sheetId)
        {
            foreach (SheetGroup g in Groups)
            {
                foreach (SheetSnapshot s in g.Sheets)
                {
                    if (s.SheetId == sheetId)
                        return g;
                }
            }
            return null;
        }
    }

    /// <summary>
    /// Хуудсуудыг бүлэглэж, Browser-ийн эрэмбээр дарааллуулна.
    ///
    /// «Бүлэглэж харах»: одоогийн Browser Organization-ий folder-ийн зам БОДИТ API-аас (snapshot-д) —
    /// дугаарын мөрөөс таамаглахгүй.  Түвшний тоо хязгааргүй.  Бүлэг бүр <see cref="GroupKey"/>-ээр (төрөл +
    /// зам + цуглуулга + assembly) танигдана — нэр давхцсан ч ТУСДАА.
    ///
    /// «Бүгдийг нэг бүлэгт»: БҮХ хуудас (assembly, placeholder-ийг оруулаад) НЭГ бүлэгт.
    /// </summary>
    public static class SheetGroupingService
    {
        public static GroupingResult Build(DocumentSnapshot doc, DisplayMode mode, bool sortAllByName)
        {
            bool desc = doc.Browser != null && doc.Browser.SortDescending;
            return mode == DisplayMode.AllInOne ? BuildAll(doc, desc, sortAllByName) : BuildGrouped(doc, desc);
        }

        // ── Бүгдийг нэг бүлэгт ──────────────────────────────────────
        private static GroupingResult BuildAll(DocumentSnapshot doc, bool desc, bool byName)
        {
            IEnumerable<SheetSnapshot> ordered = OrderByBrowser(doc.Sheets, desc);
            if (byName)
            {
                // Тогтвортой: ижил нэртэй хуудсууд Browser-ийн эрэмбээрээ үлдэнэ (LINQ OrderBy тогтвортой).
                ordered = ordered.OrderBy(s => s.Name ?? string.Empty, NaturalComparer.Instance);
            }
            List<SheetSnapshot> list = ordered.ToList();

            var group = new SheetGroup(GroupKey.All(), Msg.AllSheetsTitle, list);
            var root = new GroupNode("root", Msg.AllSheetsTitle, GroupNodeKind.Root) { Group = group };
            return new GroupingResult(root, new[] { group });
        }

        // ── Бүлэглэж харах ──────────────────────────────────────────
        private static GroupingResult BuildGrouped(DocumentSnapshot doc, bool desc)
        {
            var map = new Dictionary<GroupKey, List<SheetSnapshot>>();
            var firstSeen = new List<GroupKey>();
            // Нуугдсан (шүүлтэнд таарахгүй) хуудас жагсаалтад БАЙХГҮЙ, харин давхардлын шалгалтад snapshot-оор оролцоно.
            foreach (SheetSnapshot s in doc.Sheets)
            {
                if (!s.SatisfiesBrowserFilter)
                    continue;
                GroupKey key = KeyFor(s);
                List<SheetSnapshot> list;
                if (!map.TryGetValue(key, out list))
                {
                    list = new List<SheetSnapshot>();
                    map[key] = list;
                    firstSeen.Add(key);
                }
                list.Add(s);
            }

            var root = new GroupNode("root", Msg.SheetsRootTitle, GroupNodeKind.Root);
            var groups = new List<SheetGroup>();

            GroupNode collectionsSection = null;
            GroupNode assembliesSection = null;

            // Цуглуулга/assembly-ийн нэрийг эрэмбэлэхэд.
            IEnumerable<GroupKey> keys = firstSeen
                .OrderBy(k => k.Kind == GroupKind.BrowserFolder ? 0 : (k.Kind == GroupKind.SheetCollection ? 1 : 2))
                .ThenBy(k => TitleOf(k, map[k][0]), NaturalComparer.Instance);

            foreach (GroupKey key in keys)
            {
                List<SheetSnapshot> members = OrderByBrowser(map[key], desc).ToList();
                SheetSnapshot sample = members[0];
                var group = new SheetGroup(key, TitleOf(key, sample), members);

                GroupNode parent;
                string idPrefix;
                switch (key.Kind)
                {
                    case GroupKind.SheetCollection:
                    {
                        if (collectionsSection == null)
                        {
                            collectionsSection = new GroupNode("sec:collections", Msg.CollectionsSectionTitle, GroupNodeKind.Section);
                        }
                        string cid = "sec:coll:" + key.CollectionElementId;
                        GroupNode coll = collectionsSection.Children.FirstOrDefault(c => c.Id == cid);
                        if (coll == null)
                        {
                            coll = new GroupNode(cid, Msg.CollectionTitle(sample.CollectionName), GroupNodeKind.Section);
                            collectionsSection.Children.Add(coll);
                        }
                        parent = coll;
                        idPrefix = cid;
                        break;
                    }
                    case GroupKind.Assembly:
                    {
                        if (assembliesSection == null)
                        {
                            assembliesSection = new GroupNode("sec:assemblies", Msg.AssembliesSectionTitle, GroupNodeKind.Section);
                        }
                        GroupNode leaf = new GroupNode("asm:" + key.AssemblyElementId, Msg.AssemblyTitle(sample.AssemblyName), GroupNodeKind.Group) { Group = group };
                        assembliesSection.Children.Add(leaf);
                        groups.Add(group);
                        continue;
                    }
                    default:
                        parent = root;
                        idPrefix = "root";
                        break;
                }

                GroupNode deepest = EnsurePath(parent, key.BrowserPath, idPrefix);
                deepest.Group = group;
                if (deepest.Kind == GroupNodeKind.Folder)
                    deepest.Kind = GroupNodeKind.Group;
                groups.Add(group);
            }

            if (collectionsSection != null)
            {
                SortChildren(collectionsSection);
                root.Children.Add(collectionsSection);
            }
            if (assembliesSection != null)
            {
                assembliesSection.Children.Sort((a, b) => NaturalComparer.Instance.Compare(a.Title, b.Title));
                root.Children.Add(assembliesSection);
            }
            SortChildren(root, keepSections: true);

            // Бүлгүүдийг модны дарааллаар жагсаана.
            var ordered = new List<SheetGroup>();
            Flatten(root, ordered);
            return new GroupingResult(root, ordered);
        }

        private static GroupKey KeyFor(SheetSnapshot s)
        {
            if (s.IsAssemblySheet)
                return GroupKey.Assembly(s.AssemblyId);
            if (s.CollectionId != 0)
                return GroupKey.Collection(s.CollectionId, s.BrowserPath);
            return GroupKey.Folder(s.BrowserPath);
        }

        private static string TitleOf(GroupKey key, SheetSnapshot sample)
        {
            switch (key.Kind)
            {
                case GroupKind.Assembly:
                    return Msg.AssemblyTitle(sample.AssemblyName);
                case GroupKind.SheetCollection:
                    return Msg.CollectionTitle(sample.CollectionName) + PathSuffix(key);
                default:
                    return key.BrowserPath.Count == 0 ? Msg.SheetsRootTitle : PathText(key);
            }
        }

        private static string PathText(GroupKey key)
        {
            return string.Join(" › ", key.BrowserPath.Select(p => p.Name));
        }

        private static string PathSuffix(GroupKey key)
        {
            return key.BrowserPath.Count == 0 ? string.Empty : " › " + PathText(key);
        }

        private static GroupNode EnsurePath(GroupNode parent, IReadOnlyList<FolderSegment> path, string idPrefix)
        {
            GroupNode cur = parent;
            var id = new StringBuilder(idPrefix);
            foreach (FolderSegment seg in path)
            {
                id.Append('/').Append(seg.ParameterId).Append(':').Append(seg.Name.Length).Append(':').Append(seg.Name);
                string nodeId = id.ToString();
                GroupNode next = cur.Children.FirstOrDefault(c => c.Id == nodeId);
                if (next == null)
                {
                    next = new GroupNode(nodeId, seg.Name, GroupNodeKind.Folder);
                    cur.Children.Add(next);
                }
                cur = next;
            }
            return cur;
        }

        private static void SortChildren(GroupNode node, bool keepSections = false)
        {
            // Sections (цуглуулга, assembly) хамгийн ДООР, folder-ууд нэрээр.
            node.Children.Sort((a, b) =>
            {
                int ra = a.Kind == GroupNodeKind.Section ? 1 : 0;
                int rb = b.Kind == GroupNodeKind.Section ? 1 : 0;
                if (ra != rb)
                    return ra.CompareTo(rb);
                if (ra == 1 && keepSections)
                {
                    // «Цуглуулга» section нь «Assembly»-аас өмнө.
                    int sa = a.Id == "sec:collections" ? 0 : 1;
                    int sb = b.Id == "sec:collections" ? 0 : 1;
                    if (sa != sb)
                        return sa.CompareTo(sb);
                }
                return NaturalComparer.Instance.Compare(a.Title, b.Title);
            });
            foreach (GroupNode c in node.Children)
            {
                if (c.Kind != GroupNodeKind.Section || !keepSections)
                    SortChildren(c, keepSections);
            }
        }

        private static void Flatten(GroupNode node, List<SheetGroup> into)
        {
            if (node.Group != null)
                into.Add(node.Group);
            foreach (GroupNode c in node.Children)
                Flatten(c, into);
        }

        /// <summary>
        /// Browser-ийн эрэмбэ (Revit 2027.2-ийн Project Browser-ийг УНШИЖ хэмжсэн — <see cref="NaturalComparer"/>):
        /// эрэмбэлэх параметрийн утга, чиглэл; утга тэнцүү (A-2 = A-02) үед ХУУДАСНЫ НЭР (Browser мөрийн «Дугаар - Нэр»
        /// бичвэр шиг), эцэст нь document-ийн дараалал (ElementId).  Тогтвортой.
        /// ⚠️ Нэрээр тэнцүүг шийдэх нь Sheet Number-аар эрэмбэлсэн үед БОДИТООР баталгаажсан; өөр параметрээр эрэмбэлсэн
        /// (жишээ «Drawn By») Browser-ийн тэнцүү утгын дарааллыг хэмжээгүй — «дугаар, нэр» гэж таамагласан.
        /// </summary>
        public static IEnumerable<SheetSnapshot> OrderByBrowser(IEnumerable<SheetSnapshot> sheets, bool descending)
        {
            IOrderedEnumerable<SheetSnapshot> o = descending
                ? sheets.OrderByDescending(s => SortValue(s), NaturalComparer.Instance)
                : sheets.OrderBy(s => SortValue(s), NaturalComparer.Instance);
            return o.ThenBy(s => s.Number ?? string.Empty, NaturalComparer.Instance)
                .ThenBy(s => s.Name ?? string.Empty, NaturalComparer.Instance)
                .ThenBy(s => s.DocumentIndex)
                .ThenBy(s => s.SheetId);
        }

        private static string SortValue(SheetSnapshot s)
        {
            return s.SortKey ?? s.Number ?? string.Empty;
        }
    }
}
