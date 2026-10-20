using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.SheetNumerator.Core;

namespace RevitMcpAddin.SheetNumerator.Revit
{
    /// <summary>
    /// Revit-ийн document-оос ЦАГИЙН ЗУРАГ (<see cref="DocumentSnapshot"/>) авна.  Зөвхөн Revit API-ийн ХҮЧИНТЭЙ
    /// контекстэд (ExternalEvent handler) дуудагдана.
    ///
    /// ⚠️ Буцаах утга нь ЭНГИЙН DTO — `ViewSheet`, `Parameter` зэрэг амьд Revit объектыг WPF-ийн ViewModel-д
    /// ХЭЗЭЭ Ч дамжуулахгүй (document өөрчлөгдсөн үед хүчингүй болдог).
    ///
    /// ⚠️ БҮХ хуудсыг авна — Browser-ийн шүүлтээр нуугдсан, placeholder, assembly хуудсыг ч: давхардлын шалгалт
    /// эдгээрийг ЗААВАЛ харах ёстой.  Жагсаалтад юу харагдахыг `SheetGroupingService` шийднэ.
    /// </summary>
    internal static class SheetSnapshotService
    {
        /// <summary>Document-ийн таних тэмдэг: төслийн UniqueId + гарчиг + зам.  Идэвхтэй document солигдсоныг барина.</summary>
        public static string DocumentKeyOf(Document doc)
        {
            string uid = string.Empty;
            try { uid = doc.ProjectInformation != null ? doc.ProjectInformation.UniqueId : string.Empty; }
            catch (Exception) { }
            return uid + "|" + (doc.Title ?? string.Empty) + "|" + (doc.PathName ?? string.Empty);
        }

        public static SnapshotResult Capture(UIApplication uiapp)
        {
            UIDocument uidoc = uiapp.ActiveUIDocument;
            if (uidoc == null || uidoc.Document == null)
                return new SnapshotResult { Success = false, Error = Msg.NoDocumentNotice };

            long active = 0;
            try
            {
                ViewSheet av = uidoc.ActiveView as ViewSheet;
                if (av != null)
                    active = av.Id.Value;
            }
            catch (Exception) { }
            return Capture(uidoc.Document, uiapp.Application.VersionNumber, active);
        }

        /// <summary>
        /// Document-оор (UIApplication-гүй) — scratch document дээрх автомат шалгалтад ч адил.
        /// <paramref name="activeSheetId"/>: хэрэглэгчийн идэвхтэй харагдац хуудас бол түүний id, үгүй бол 0.
        /// </summary>
        public static SnapshotResult Capture(Document doc, string versionNumber, long activeSheetId)
        {
            if (doc == null)
                return new SnapshotResult { Success = false, Error = Msg.NoDocumentNotice };
            if (doc.IsFamilyDocument)
                return new SnapshotResult { Success = false, Error = "Зөвхөн төслийн файл дээр ажиллана (family биш)." };

            RevitInfo.Set(versionNumber);

            var sheets = new FilteredElementCollector(doc).OfClass(typeof(ViewSheet)).Cast<ViewSheet>().ToList();

            // ── Browser Organization (хуудас байхгүй бол null) ─────────
            BrowserOrganization org = null;
            try { org = BrowserOrganization.GetCurrentBrowserOrganizationForSheets(doc); }
            catch (Exception ex) { SheetNumeratorLog.Error("snapshot", "BrowserOrganization уншиж чадсангүй — бүлэглэлтгүй", ex); }

            IReadOnlyList<ElementId> sortPath = SortPathOf(org);
            var browser = new BrowserInfo { OrganizationName = org != null ? org.Name : null };
            if (org != null)
            {
                try { browser.SortDescending = org.SortingOrder == SortingOrder.Descending; } catch (Exception) { }
                browser.SortParameterName = sortPath.Count > 0 ? ParameterLabel(sheets, sortPath[sortPath.Count - 1].Value) : null;
            }

            // ── Цуглуулга, assembly-ийн нэр ───────────────────────────
            IReadOnlyList<CollectionInfo> collections = SheetCollectionApi.List(doc);
            var collectionNames = collections.ToDictionary(c => c.Id, c => c.Name);
            var assemblyNames = new Dictionary<long, string>();

            // ── Хуудас бүр ─────────────────────────────────────────────
            var snapshots = new List<SheetSnapshot>(sheets.Count);
            var catalog = new Dictionary<string, SheetParameterInfo>(StringComparer.Ordinal);
            bool anyGrouping = false;
            int index = 0;

            foreach (ViewSheet sheet in sheets)
            {
                long collId = SheetCollectionApi.CollectionIdOf(sheet);
                long asmId = 0;
                string asmName = null;
                bool isAsm = false;
                try
                {
                    isAsm = sheet.IsAssemblyView;
                    if (isAsm)
                    {
                        ElementId aid = sheet.AssociatedAssemblyInstanceId;
                        asmId = aid != null && aid != ElementId.InvalidElementId ? aid.Value : 0;
                        if (asmId != 0 && !assemblyNames.TryGetValue(asmId, out asmName))
                        {
                            Element asm = doc.GetElement(aid);
                            asmName = asm != null ? asm.Name : null;
                            assemblyNames[asmId] = asmName;
                        }
                    }
                }
                catch (Exception ex)
                {
                    SheetNumeratorLog.Error("snapshot", "Assembly мэдээлэл уншиж чадсангүй: " + sheet.Id.Value, ex);
                }

                var snap = new SheetSnapshot
                {
                    SheetId = sheet.Id.Value,
                    UniqueId = sheet.UniqueId,
                    Number = sheet.SheetNumber ?? string.Empty,
                    Name = sheet.Name ?? string.Empty,
                    IsPlaceholder = SafeIsPlaceholder(sheet),
                    IsAssemblySheet = isAsm,
                    AssemblyId = asmId,
                    AssemblyName = asmName,
                    CollectionId = collId,
                    CollectionName = collId != 0 && collectionNames.ContainsKey(collId) ? collectionNames[collId] : null,
                    DocumentIndex = index++,
                };

                // Browser-ийн folder-ийн зам, шүүлт, эрэмбийн утга.
                if (org != null)
                {
                    snap.BrowserPath = FolderPathOf(org, sheet);
                    if (snap.BrowserPath.Count > 0)
                        anyGrouping = true;
                    snap.SatisfiesBrowserFilter = SatisfiesFilter(org, sheet);
                    snap.SortKey = SortKeyOf(sheet, sortPath);
                }
                if (snap.SortKey == null)
                    snap.SortKey = snap.Number;

                snap.Parameters = ReadParameters(sheet, catalog);
                snapshots.Add(snap);
            }
            browser.HasGrouping = anyGrouping;

            // Каталогийн «хэдэн хуудсанд байгаа» ба шошго.
            var cat = catalog.Values.ToList();
            SheetParameterService.FinalizeCatalog(cat);

            var snapshot = new DocumentSnapshot
            {
                DocumentKey = DocumentKeyOf(doc),
                DocumentTitle = doc.Title,
                RevitVersion = versionNumber,
                RevitVersionNumber = RevitInfo.VersionNumber,
                IsWorkshared = doc.IsWorkshared,
                Uniqueness = SheetCollectionApi.Uniqueness,
                Sheets = snapshots,
                ParameterCatalog = cat,
                ActiveSheetId = activeSheetId,
                Browser = browser,
                Collections = collections,
                CapturedUtc = DateTime.UtcNow,
            };
            return new SnapshotResult { Success = true, Snapshot = snapshot };
        }

        /// <summary>Хөнгөн тамга: БҮХ хуудасны дугаар/нэр/хүрээ — хуучирсан эсэхийг шалгахад (параметр уншихгүй).</summary>
        public static DocumentStamp ReadStamp(UIApplication uiapp)
        {
            UIDocument uidoc = uiapp.ActiveUIDocument;
            if (uidoc == null || uidoc.Document == null || uidoc.Document.IsFamilyDocument)
                return new DocumentStamp { HasDocument = false };
            return ReadStamp(uidoc.Document);
        }

        public static DocumentStamp ReadStamp(Document doc)
        {
            var stamp = new DocumentStamp { HasDocument = true, DocumentKey = DocumentKeyOf(doc) };
            foreach (ViewSheet s in new FilteredElementCollector(doc).OfClass(typeof(ViewSheet)).Cast<ViewSheet>())
            {
                bool isAsm = false;
                long asm = 0;
                try
                {
                    isAsm = s.IsAssemblyView;
                    if (isAsm)
                    {
                        ElementId aid = s.AssociatedAssemblyInstanceId;
                        asm = aid != null && aid != ElementId.InvalidElementId ? aid.Value : 0;
                    }
                }
                catch (Exception) { }
                stamp.Sheets.Add(new SheetStamp
                {
                    SheetId = s.Id.Value,
                    UniqueId = s.UniqueId,
                    Number = s.SheetNumber ?? string.Empty,
                    Name = s.Name ?? string.Empty,
                    CollectionId = SheetCollectionApi.CollectionIdOf(s),
                    IsAssemblySheet = isAsm,
                    AssemblyId = asm,
                });
            }
            return stamp;
        }

        // ══════════════════════════════════════════════════════════════
        //  Туслахууд
        // ══════════════════════════════════════════════════════════════

        private static bool SafeIsPlaceholder(ViewSheet s)
        {
            try { return s.IsPlaceholder; }
            catch (Exception) { return false; }
        }

        /// <summary>
        /// Хуудасны folder-ийн зам.  `GetFolderItems` нь Revit 2027.2 дээр хэмжсэнээр ДЭЭРЭЭС ДООШ folder-ийн
        /// гинж (leaf-ийн ӨӨРИЙГ оруулдаггүй): «Discipline» org → [Architectural][Floor Plans].
        /// </summary>
        private static IReadOnlyList<FolderSegment> FolderPathOf(BrowserOrganization org, ViewSheet sheet)
        {
            var path = new List<FolderSegment>();
            try
            {
                IList<FolderItemInfo> items = org.GetFolderItems(sheet.Id);
                if (items != null)
                {
                    foreach (FolderItemInfo fi in items)
                        path.Add(new FolderSegment(fi.Name, BrowserApi.GroupingParameterId(fi)));
                }
            }
            catch (Exception ex)
            {
                SheetNumeratorLog.Error("snapshot", "Folder-ийн зам уншиж чадсангүй: " + sheet.SheetNumber, ex);
            }
            return path;
        }

        private static bool SatisfiesFilter(BrowserOrganization org, ViewSheet sheet)
        {
            try { return org.AreFiltersSatisfied(sheet.Id); }
            catch (Exception) { return true; }
        }

        // ── Browser-ийн эрэмбэлэх параметр ──────────────────────────
        private static IReadOnlyList<ElementId> SortPathOf(BrowserOrganization org)
        {
            // Хувилбар-зөрчилтэй API (2026+ зам / 2024-25 ганц id) нь BrowserApi-д.
            return BrowserApi.SortingParameterPath(org);
        }

        /// <summary>
        /// Хуудасны эрэмбийн утга: замын сүүлчийн параметрийн текст.  Зам нь лавлах параметр агуулбал
        /// (ElementId-тай параметр) түүгээр дараагийн элемент рүү шилжинэ.
        /// </summary>
        private static string SortKeyOf(ViewSheet sheet, IReadOnlyList<ElementId> path)
        {
            if (path == null || path.Count == 0)
                return null;
            try
            {
                Element cur = sheet;
                for (int i = 0; i < path.Count; i++)
                {
                    Parameter p = SheetParameterService.ResolveById(cur, path[i].Value);
                    if (p == null)
                        return null;
                    if (i == path.Count - 1)
                        return SheetParameterService.Read(p).Text;
                    ElementId next = p.AsElementId();
                    if (next == null || next == ElementId.InvalidElementId)
                        return null;
                    cur = sheet.Document.GetElement(next);
                    if (cur == null)
                        return null;
                }
            }
            catch (Exception)
            {
                // Эрэмбийн утга уншигдсангүй — дугаараар (дуудагч нөөцлөнө).
            }
            return null;
        }

        private static string ParameterLabel(IList<ViewSheet> sheets, long id)
        {
            foreach (ViewSheet s in sheets)
            {
                Parameter p = SheetParameterService.ResolveById(s, id);
                if (p != null)
                    return p.Definition.Name;
                break;
            }
            return null;
        }

        // ── Хуудасны параметрүүд ────────────────────────────────────
        private static IReadOnlyDictionary<string, SheetParameterValue> ReadParameters(ViewSheet sheet, Dictionary<string, SheetParameterInfo> catalog)
        {
            var values = new Dictionary<string, SheetParameterValue>(StringComparer.Ordinal);
            foreach (Parameter p in sheet.Parameters)
            {
                try
                {
                    if (p.StorageType == StorageType.None || SheetParameterService.IsNoise(p))
                        continue;
                    ParameterKey key = SheetParameterService.KeyOf(p);
                    if (values.ContainsKey(key.Stable))
                        continue;   // нэр давхцсан төслийн параметр — эхнийхийг л

                    values[key.Stable] = SheetParameterService.Read(p);

                    SheetParameterInfo info;
                    if (!catalog.TryGetValue(key.Stable, out info))
                    {
                        info = new SheetParameterInfo
                        {
                            Key = key,
                            DisplayName = p.Definition.Name,
                            ValueKind = SheetParameterService.Classify(p),
                            IsReadOnly = p.IsReadOnly,
                        };
                        catalog[key.Stable] = info;
                    }
                    info.PresentOnSheets++;
                    if (p.IsReadOnly)
                        info.IsReadOnly = true;
                }
                catch (Exception ex)
                {
                    SheetNumeratorLog.Error("snapshot", "Параметр уншиж чадсангүй: " + sheet.SheetNumber, ex);
                }
            }
            return values;
        }
    }
}
