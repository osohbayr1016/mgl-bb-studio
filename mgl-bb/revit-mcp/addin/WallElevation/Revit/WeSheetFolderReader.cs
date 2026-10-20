using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using Autodesk.Revit.DB;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// Ажлын зургийн бүрдэл (2026-10-14): Project Browser → Sheets-ийн бүлэглэлтийг уншина, шинэ хуудсанд бичнэ.
    ///   • Бүлэг/хэсэг — <see cref="BrowserOrganization"/>-ийн «Folders»: Revit хуудсыг ПАРАМЕТРИЙН утгаар бүлэглэдэг, «бүлэгт оруулах» = тэр
    ///     параметрт утга бичих.  <c>GetFolderItems(sheetId)</c> → түвшин бүрд {параметрийн id, бүлгийн нэр}.
    ///   • Бүрдэл — Revit 2025+ «Sheet Collection» (<c>ViewSheet.SheetCollectionId</c>); Revit 2024-д байхгүй.
    /// Revit 2026+ бүлгийг холбоотой элементийн параметрээр ч (id-ийн ЗАМ) хийж болно — тийм түвшинг хуудсаар тохируулахгүй.
    /// </summary>
    internal static class WeSheetFolderReader
    {
        public static WeSheetFolders Read(Document doc, WeResources res)
        {
            var f = new WeSheetFolders();
            try { ReadCore(doc, res, f); }
            catch (Exception ex)
            {
                WeLog.Error("folders", "Project Browser-ийн хуудасны бүлэглэлт", ex);
                f.Levels.Clear();
                f.Paths.Clear();
                f.Problem = "Project Browser-ийн хуудасны бүлэглэлтийг уншиж чадсангүй: " + ex.Message;
            }
            return f;
        }

        private static void ReadCore(Document doc, WeResources res, WeSheetFolders f)
        {
            BrowserOrganization org = BrowserOrganization.GetCurrentBrowserOrganizationForSheets(doc);
            f.Organization = org != null ? org.Name : null;
            List<ViewSheet> sheets = new FilteredElementCollector(doc).OfClass(typeof(ViewSheet)).Cast<ViewSheet>()
                .Where(s => !s.IsTemplate && !s.IsPlaceholder).OrderBy(s => s.SheetNumber, StringComparer.Ordinal).ToList();
            Dictionary<long, string> collections = Collections(doc);
            if (sheets.Count == 0 && collections.Count == 0)
            {
                f.Problem = "Төсөлд хуудас алга — Project Browser-ийн бүлгийг анхны хуудаснаас хойш сонгоно.";
                return;
            }

            // Бүлгийн түвшин: хамгийн олон түвшинтэй хуудсаас (хуудас бүр бүх түвшинд нэг бүлэгтэй — хоосон нь «???»).
            var items = new Dictionary<long, IList<FolderItemInfo>>();
            List<string> levelKeys = new List<string>();
            List<FolderItemInfo> levelSample = new List<FolderItemInfo>();
            if (org != null)
                foreach (ViewSheet sh in sheets)
                {
                    IList<FolderItemInfo> fi;
                    try { fi = org.GetFolderItems(sh.Id); } catch { continue; }
                    if (fi == null) continue;
                    items[sh.Id.Value] = fi;
                    if (fi.Count > levelKeys.Count) { levelKeys = fi.Select(LevelKey).ToList(); levelSample = fi.ToList(); }
                }
            if (levelKeys.Count == 0 && collections.Count == 0)
            {
                f.Problem = "Project Browser-т хуудсыг бүлэглээгүй" + (f.Organization != null ? " (Browser Organization «" + f.Organization + "»)" : string.Empty)
                            + " — хуудас дугаараараа жагсана.";
                return;
            }

            int offset = 0;
            if (collections.Count > 0)
            {
                var c = new WeFolderLevel { Key = WeSheetFolders.CollectionKey, Name = "Бүрдэл (Sheet Collection)", Settable = true, IsCollection = true };
                c.Known.AddRange(collections.Values);
                f.Levels.Add(c);
                offset = 1;
            }

            // Хуудас бүрийн бүлгийн нэр (түвшний дарааллаар).
            var namesOf = new Dictionary<long, List<string>>();
            foreach (ViewSheet sh in sheets)
            {
                var names = new List<string>();
                if (offset == 1) { string cn; names.Add(collections.TryGetValue(CollectionOf(sh), out cn) ? cn : string.Empty); }
                IList<FolderItemInfo> fi;
                items.TryGetValue(sh.Id.Value, out fi);
                foreach (string key in levelKeys)
                {
                    FolderItemInfo m = fi != null ? fi.FirstOrDefault(x => LevelKey(x) == key) : null;
                    names.Add(m != null ? m.Name : string.Empty);
                }
                namesOf[sh.Id.Value] = names;
            }

            for (int i = 0; i < levelKeys.Count; i++)
            {
                List<ElementId> path = IdPath(levelSample[i]);
                var lvl = new WeFolderLevel { Key = levelKeys[i], Name = ParamName(doc, path[path.Count - 1]) };
                if (path.Count > 1) lvl.Why = "холбоотой элементийн параметр — хуудсаас автоматаар";
                else Decide(lvl, path[0], offset + i, sheets, namesOf);
                f.Levels.Add(lvl);
            }
            foreach (ViewSheet sh in sheets) f.AddPath(namesOf[sh.Id.Value]);

            // Анхны утга: (1) энэ хэрэгслийн хамгийн сүүлд үүсгэсэн хуудас, (2) оффисын өрөөний дэлгээсийн хуудсуудын түгээмэл бүлэг.
            ViewSheet ours = res.Generated.Where(kv => kv.Key.IsValidObject && kv.Value.Kind == GeneratedElevationRepository.KindSheet)
                                          .Select(kv => kv.Key as ViewSheet).Where(s => s != null && namesOf.ContainsKey(s.Id.Value))
                                          .OrderByDescending(s => s.Id.Value).FirstOrDefault();
            if (ours != null)
            {
                f.Default = Normalized(namesOf[ours.Id.Value]);
                f.DefaultSource = "өмнө үүсгэсэн хуудас «" + ours.SheetNumber + "»";
                return;
            }
            var office = res.Standards.RoomSheetIds.Where(namesOf.ContainsKey).ToList();
            List<string> common = WeSheetFolders.CommonPath(office.Select(id => (IList<string>)Normalized(namesOf[id])));
            if (common != null)
            {
                f.Default = common;
                var nums = office.Select(id => doc.GetElement(new ElementId(id)) as ViewSheet).Where(s => s != null)
                                 .Select(s => s.SheetNumber).OrderBy(s => s, StringComparer.Ordinal).ToList();
                f.DefaultSource = "оффисын дэлгээсийн хуудас (" + (nums.Count <= 3 ? string.Join(", ", nums) : nums[0] + " … " + nums[nums.Count - 1]) + ")";
                return;
            }
            f.Default = f.Levels.Select(x => string.Empty).ToList();
        }

        private static List<string> Normalized(List<string> names)
        {
            return names.Select(WeSheetFolders.Normalize).ToList();
        }

        private static void Decide(WeFolderLevel lvl, ElementId id, int index, List<ViewSheet> sheets, Dictionary<long, List<string>> namesOf)
        {
            if (id.Value == (long)BuiltInParameter.SHEET_NUMBER || id.Value == (long)BuiltInParameter.SHEET_NAME)
            {
                lvl.Why = "хуудасны дугаар / нэрээс автоматаар";
                return;
            }
            bool found = false, text = true, readOnly = false;
            var pairs = new List<KeyValuePair<string, string>>();
            foreach (ViewSheet sh in sheets)
            {
                Parameter p = Param(sh, id);
                if (p == null) continue;
                if (!found && p.Definition != null && !string.IsNullOrEmpty(p.Definition.Name)) lvl.Name = p.Definition.Name;
                found = true;
                if (p.StorageType != StorageType.String) { text = false; break; }
                if (p.IsReadOnly) readOnly = true;
                pairs.Add(new KeyValuePair<string, string>(namesOf[sh.Id.Value][index], p.AsString()));
            }
            if (!found) lvl.Why = "хуудсанд энэ параметр алга";
            else if (!text) lvl.Why = "бичвэр биш параметр — хуудсаас автоматаар";
            else if (readOnly) lvl.Why = "зөвхөн унших параметр — хуудсаас автоматаар";
            else if (!WeSheetFolders.ValueDrivesFolder(pairs)) lvl.Why = "бүлгийн нэрийг утгын хэсгээс авдаг (Browser Organization) — гараар тохируулна";
            else lvl.Settable = true;
        }

        // ── Revit оны ялгаа ─────────────────────────────────────────

        private static readonly MethodInfo PathMethod = typeof(FolderItemInfo).GetMethod("GetGroupingParameterIdPath", Type.EmptyTypes);

        /// <summary>
        /// Бүлгийн параметрийн id-ийн зам: Revit 2026+ <c>GetGroupingParameterIdPath()</c> (холбоотой элементээр дамжиж болно), өмнөх хувилбарт
        /// ганц <c>ElementId</c>.  Reflection — нэг эх кодыг Revit 2024–2027 бүгдэд эмхэтгэнэ.
        /// </summary>
        private static List<ElementId> IdPath(FolderItemInfo fi)
        {
            if (PathMethod != null)
            {
                try
                {
                    var ids = PathMethod.Invoke(fi, null) as IEnumerable<ElementId>;
                    List<ElementId> list = ids != null ? ids.Where(x => x != null).ToList() : null;
                    if (list != null && list.Count > 0) return list;
                }
                catch { /* хуучин зам */ }
            }
#pragma warning disable CS0618   // FolderItemInfo.ElementId: Revit 2026-д хуучирсан, 2024/2025-д цорын ганц зам
            return new List<ElementId> { fi.ElementId };
#pragma warning restore CS0618
        }

        private static string LevelKey(FolderItemInfo fi)
        {
            return string.Join("/", IdPath(fi).Select(Key));
        }

        private static Dictionary<long, string> Collections(Document doc)
        {
            var d = new Dictionary<long, string>();
#if NET8_0_OR_GREATER
            foreach (Element e in new FilteredElementCollector(doc).OfClass(typeof(SheetCollection)))
                if (!string.IsNullOrWhiteSpace(e.Name)) d[e.Id.Value] = e.Name.Trim();
#endif
            return d;
        }

        private static long CollectionOf(ViewSheet sh)
        {
#if NET8_0_OR_GREATER
            ElementId id = sh.SheetCollectionId;
            return id == null || id == ElementId.InvalidElementId ? 0 : id.Value;
#else
            return 0;
#endif
        }

        public static string Key(ElementId id)
        {
            return id == null ? string.Empty : id.Value.ToString(CultureInfo.InvariantCulture);
        }

        private static string ParamName(Document doc, ElementId id)
        {
            if (id.Value < 0)
            {
                try { return LabelUtils.GetLabelFor((BuiltInParameter)(int)id.Value); } catch { return "Параметр " + Key(id); }
            }
            Element e = doc.GetElement(id);
            return e != null && !string.IsNullOrEmpty(e.Name) ? e.Name : "Параметр " + Key(id);
        }

        /// <summary>Хуудасны параметр id-аар (built-in нь сөрөг; project/shared нь ParameterElement).</summary>
        public static Parameter Param(Element e, ElementId id)
        {
            if (e == null || id == null || id == ElementId.InvalidElementId) return null;
            if (id.Value < 0)
            {
                try { return e.get_Parameter((BuiltInParameter)(int)id.Value); } catch { return null; }
            }
            var pe = e.Document.GetElement(id) as ParameterElement;
            if (pe != null)
            {
                try { Parameter p = e.get_Parameter(pe.GetDefinition()); if (p != null) return p; } catch { }
            }
            foreach (Parameter p in e.Parameters)
                if (p.Id == id) return p;
            return null;
        }

        // ── Бичих ───────────────────────────────────────────────────

        /// <summary>Хуудасны одоогийн утга <paramref name="want"/>-аас ялгаатай юу (бүрдэл эсвэл бүлгийн параметр).  Уншиж чадахгүй бол false.</summary>
        public static bool Differs(ViewSheet sh, string key, string want)
        {
            want = want ?? string.Empty;
            if (key == WeSheetFolders.CollectionKey)
            {
                string cur = CollectionName(sh);
                return cur != null && !string.Equals(cur, want, StringComparison.OrdinalIgnoreCase);
            }
            long v;
            if (!long.TryParse(key, NumberStyles.Integer, CultureInfo.InvariantCulture, out v)) return false;
            Parameter p = Param(sh, new ElementId(v));
            return p != null && !string.Equals(p.AsString() ?? string.Empty, want, StringComparison.Ordinal);
        }

        /// <summary>
        /// Хуудсанд бүлгийн утгыг бичнэ (<paramref name="onlyKeys"/> null = бүгд).  Бичиж чадаагүй түлхүүрийг <paramref name="failed"/>-д.
        /// true = ядаж нэг утга өөрчлөгдсөн.
        /// </summary>
        public static bool Apply(ViewSheet sh, IDictionary<string, string> values, ICollection<string> onlyKeys, ICollection<string> failed)
        {
            bool changed = false;
            if (sh == null || values == null) return false;
            foreach (KeyValuePair<string, string> kv in values)
            {
                if (onlyKeys != null && !onlyKeys.Contains(kv.Key)) continue;
                string want = kv.Value ?? string.Empty;
                bool ok;
                if (kv.Key == WeSheetFolders.CollectionKey)
                {
                    if (!Differs(sh, kv.Key, want)) continue;
                    ok = SetCollection(sh, want);
                }
                else
                {
                    long v;
                    if (!long.TryParse(kv.Key, NumberStyles.Integer, CultureInfo.InvariantCulture, out v)) continue;
                    Parameter p = Param(sh, new ElementId(v));
                    if (p == null || p.IsReadOnly || p.StorageType != StorageType.String) { if (failed != null) failed.Add(kv.Key); continue; }
                    if (string.Equals(p.AsString() ?? string.Empty, want, StringComparison.Ordinal)) continue;
                    try { ok = p.Set(want); } catch { ok = false; }
                }
                if (ok) changed = true;
                else if (failed != null) failed.Add(kv.Key);
            }
            return changed;
        }

        /// <summary>Хуудасны бүрдлийн нэр ("" = бүрдэлгүй); энэ Revit-д бүрдэл байхгүй бол null.</summary>
        private static string CollectionName(ViewSheet sh)
        {
#if NET8_0_OR_GREATER
            ElementId id = sh.SheetCollectionId;
            if (id == null || id == ElementId.InvalidElementId) return string.Empty;
            Element c = sh.Document.GetElement(id);
            return c != null ? (c.Name ?? string.Empty).Trim() : string.Empty;
#else
            return null;
#endif
        }

        /// <summary>Бүрдэлд оруулна (нэрээр; байхгүй бол үүсгэнэ); "" = бүрдлээс гаргана.</summary>
        private static bool SetCollection(ViewSheet sh, string name)
        {
#if NET8_0_OR_GREATER
            try
            {
                Document doc = sh.Document;
                ElementId want = ElementId.InvalidElementId;
                if (name.Length > 0)
                {
                    SheetCollection c = new FilteredElementCollector(doc).OfClass(typeof(SheetCollection)).Cast<SheetCollection>()
                        .FirstOrDefault(x => string.Equals((x.Name ?? string.Empty).Trim(), name, StringComparison.OrdinalIgnoreCase))
                        ?? SheetCollection.Create(doc, name);
                    want = c.Id;
                }
                sh.SheetCollectionId = want;
                return true;
            }
            catch (Exception ex)
            {
                WeLog.Error("folders", "бүрдэл «" + name + "»", ex);
                return false;
            }
#else
            return false;
#endif
        }

        /// <summary>Хуудас Project Browser-т хаана харагдана («Sheets › Бүрдэл › Бүлэг › Хэсэг»); шүүлтэд орохгүй бол <paramref name="hidden"/>.</summary>
        public static string Where(Document doc, ViewSheet sh, out bool hidden)
        {
            hidden = false;
            try
            {
                var parts = new List<string> { "Sheets" };
                string coll = CollectionName(sh);
                if (!string.IsNullOrEmpty(coll)) parts.Add(coll);
                BrowserOrganization org = BrowserOrganization.GetCurrentBrowserOrganizationForSheets(doc);
                if (org != null)
                {
                    hidden = !org.AreFiltersSatisfied(sh.Id);
                    IList<FolderItemInfo> fi = org.GetFolderItems(sh.Id);
                    if (fi != null) parts.AddRange(fi.Select(x => string.IsNullOrWhiteSpace(x.Name) ? WeSheetFolders.Unset : x.Name.Trim()));
                }
                return string.Join(" › ", parts);
            }
            catch { return null; }
        }
    }
}
