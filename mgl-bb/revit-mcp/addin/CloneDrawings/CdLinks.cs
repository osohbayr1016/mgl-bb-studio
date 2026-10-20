using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.ExtensibleStorage;

namespace RevitMcpAddin.CloneDrawings
{
    /// <summary>
    /// «Загвар элементтэй холбоо» — Revit-ийн файл ДОТОР (Extensible Storage)
    /// хадгалагдана, тиймээс файлыг хэн нээсэн ч, хэдэн жилийн дараа ч холбоо үлдэнэ:
    ///
    ///   • Клон харагдац / хуудас: {эх харагдац/хуудас, загвар, зорилт}.  Дахин
    ///     ажиллуулахад ижил хосод ШИНЭЭР үүсгэхгүй — өмнөхийг нь ашиглаж, дутуу
    ///     tag/хэмжээсийг л нэмнэ (давхардалгүй).
    ///   • Загвар элемент: хэрэглэгчийн ГАРААР холбосон харагдацууд (tag-гүй зүсэлт г.м.).
    ///   • Зорилт элемент: аль загвараас зурсан.
    ///
    /// ⚠️ SchemaGuid-ийг ХЭЗЭЭ Ч бүү өөрчил, талбар бүү нэм/хас: Revit нэг GUID-ийн
    /// бүтцийг өөрчлөхийг хориглодог — өөрчлөх шаардлага гарвал ШИНЭ GUID + уншихдаа
    /// хоёуланг нь дэмжинэ.
    /// </summary>
    public static class CdLinks
    {
        private static readonly Guid SchemaGuid = new Guid("5b8f2c1e-7d4a-4e9b-9a61-3c2d8e7f1a04");
        private const string SchemaName = "MglCloneDrawingsLink";

        public const string KindView = "view";
        public const string KindSheet = "sheet";
        public const string KindTemplate = "template";
        public const string KindTarget = "target";

        private static Schema Schema()
        {
            Schema s = Autodesk.Revit.DB.ExtensibleStorage.Schema.Lookup(SchemaGuid);
            if (s != null)
                return s;
            var b = new SchemaBuilder(SchemaGuid);
            b.SetSchemaName(SchemaName);
            b.SetReadAccessLevel(AccessLevel.Public);
            b.SetWriteAccessLevel(AccessLevel.Public);
            b.SetVendorId("com.revitmcp");
            b.SetDocumentation("MGL «Зураг клонлох»: загвар элемент ↔ клон харагдац/хуудасны холбоо.");
            b.AddSimpleField("Kind", typeof(string));
            b.AddSimpleField("TemplateUid", typeof(string));
            b.AddSimpleField("TargetUid", typeof(string));
            b.AddSimpleField("SourceUid", typeof(string));
            b.AddArrayField("Views", typeof(string));
            b.AddSimpleField("Stamp", typeof(string));
            return b.Finish();
        }

        private static Schema Existing() => Autodesk.Revit.DB.ExtensibleStorage.Schema.Lookup(SchemaGuid);

        public sealed class Record
        {
            public string Kind, TemplateUid, TargetUid, SourceUid, Stamp;
            public List<string> Views = new List<string>();
        }

        public static Record Read(Element e)
        {
            Schema s = Existing();
            if (s == null || e == null)
                return null;
            try
            {
                Entity ent = e.GetEntity(s);
                if (ent == null || !ent.IsValid())
                    return null;
                return new Record
                {
                    Kind = ent.Get<string>("Kind"),
                    TemplateUid = ent.Get<string>("TemplateUid"),
                    TargetUid = ent.Get<string>("TargetUid"),
                    SourceUid = ent.Get<string>("SourceUid"),
                    Stamp = ent.Get<string>("Stamp"),
                    Views = (ent.Get<IList<string>>("Views") ?? new List<string>()).ToList(),
                };
            }
            catch
            {
                return null;
            }
        }

        /// <summary>Нээлттэй Transaction дотор.  Засах эрхгүй (өөр хүн эзэмшсэн) элементэд бичихгүй.</summary>
        public static bool Write(Element e, Record r)
        {
            if (e == null || r == null || !CanEdit(e))
                return false;
            try
            {
                Schema s = Schema();
                var ent = new Entity(s);
                ent.Set("Kind", r.Kind ?? "");
                ent.Set("TemplateUid", r.TemplateUid ?? "");
                ent.Set("TargetUid", r.TargetUid ?? "");
                ent.Set("SourceUid", r.SourceUid ?? "");
                ent.Set("Stamp", r.Stamp ?? DateTime.UtcNow.ToString("o"));
                ent.Set<IList<string>>("Views", (r.Views ?? new List<string>()).Distinct().ToList());
                e.SetEntity(ent);
                return true;
            }
            catch
            {
                return false;
            }
        }

        public static bool CanEdit(Element e)
        {
            try
            {
                Document doc = e.Document;
                if (!doc.IsWorkshared)
                    return true;
                CheckoutStatus st = WorksharingUtils.GetCheckoutStatus(doc, e.Id);
                return st != CheckoutStatus.OwnedByOtherUser;
            }
            catch
            {
                return true;
            }
        }

        /// <summary>Холбоостой бүх элемент (клон харагдац, хуудас, загвар, зорилт).</summary>
        public static List<Element> AllLinked(Document doc)
        {
            if (Existing() == null)
                return new List<Element>();
            try
            {
                return new FilteredElementCollector(doc).WherePasses(new ExtensibleStorageFilter(SchemaGuid)).ToList();
            }
            catch
            {
                return new List<Element>();
            }
        }

        /// <summary>(эх харагдац/хуудасны uid, зорилтын uid) → клон.  Загвар хамаарахгүй — нэг зорилтод нэг эхээс нэг клон.</summary>
        public sealed class CloneIndex
        {
            private readonly Dictionary<string, ElementId> _map = new Dictionary<string, ElementId>();
            private readonly Dictionary<string, List<ElementId>> _byTarget = new Dictionary<string, List<ElementId>>();

            public static CloneIndex Build(Document doc)
            {
                var idx = new CloneIndex();
                foreach (Element e in AllLinked(doc))
                {
                    Record r = Read(e);
                    if (r == null || (r.Kind != KindView && r.Kind != KindSheet) || string.IsNullOrEmpty(r.SourceUid))
                        continue;
                    idx.Add(r.SourceUid, r.TargetUid, e.Id);
                }
                return idx;
            }

            public void Add(string sourceUid, string targetUid, ElementId id)
            {
                _map[Key(sourceUid, targetUid)] = id;
                if (!_byTarget.TryGetValue(targetUid ?? "", out List<ElementId> list))
                    _byTarget[targetUid ?? ""] = list = new List<ElementId>();
                if (!list.Contains(id))
                    list.Add(id);
            }

            public ElementId Find(string sourceUid, string targetUid) =>
                _map.TryGetValue(Key(sourceUid, targetUid), out ElementId id) ? id : null;

            public IReadOnlyList<ElementId> ForTarget(string targetUid) =>
                _byTarget.TryGetValue(targetUid ?? "", out List<ElementId> list) ? list : (IReadOnlyList<ElementId>)Array.Empty<ElementId>();

            public void Remove(string targetUid)
            {
                foreach (string k in _map.Where(kv => kv.Key.EndsWith("|" + targetUid, StringComparison.Ordinal)).Select(kv => kv.Key).ToList())
                    _map.Remove(k);
                _byTarget.Remove(targetUid ?? "");
            }

            private static string Key(string s, string t) => (s ?? "") + "|" + (t ?? "");
        }

        /// <summary>Загвар элементэд ГАРААР холбосон харагдацын uid-ууд.</summary>
        public static List<string> ManualViews(Element template)
        {
            Record r = Read(template);
            return r?.Views ?? new List<string>();
        }

        /// <summary>
        /// Загвар дээрх гарын холбоосыг шинэчилнэ.  Хэрэв энэ элемент өөрөө өөр загвараас
        /// зурагдсан зорилт байсан бол тэр холбоог нь ХАДГАЛНА (нэг entity-д хоёр үүрэг).
        /// </summary>
        public static bool SetManualViews(Element template, IEnumerable<string> viewUids)
        {
            Record old = Read(template) ?? new Record();
            var list = viewUids.Where(u => !string.IsNullOrEmpty(u)).Distinct().ToList();
            if (old.Views.OrderBy(x => x).SequenceEqual(list.OrderBy(x => x)))
                return true;
            old.Kind = string.IsNullOrEmpty(old.TemplateUid) ? KindTemplate : old.Kind;
            old.Views = list;
            old.Stamp = null;
            return Write(template, old);
        }

        public static void MarkTarget(Element target, Element template)
        {
            Record old = Read(target) ?? new Record { Kind = KindTarget };
            if (old.TemplateUid == template.UniqueId)
                return;
            old.TemplateUid = template.UniqueId;
            if (string.IsNullOrEmpty(old.Kind))
                old.Kind = KindTarget;
            old.Stamp = null;
            Write(target, old);
        }
    }
}
