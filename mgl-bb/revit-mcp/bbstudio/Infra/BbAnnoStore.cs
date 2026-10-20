using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.ExtensibleStorage;

namespace MglBb.RevitSide
{
    /// <summary>
    /// «MGL ББ Студи»-ийн ДЭЛГЭЭС дээр тавьсан тэмдэглэгээний бүртгэл (харагдац бүр дээр, өөрийн schema).  Хөдөлгүүрийн огтлолын бүртгэл
    /// (<c>RfSectionStore</c>) огтлолыг дахин тэмдэглэхэд хуучныг солидог ч дэлгээсийн замд ийм бүртгэл байхгүй — дахин ажиллуулахад шошго/MRA
    /// ДАВХАРДДАГ байв.  Бүртгэл = тэмдэглэхээс өмнө/дараа харагдацын өмчлөлийн тэмдэглэгээний ялгавар, тиймээс хөдөлгүүр, MRA-ийн дахин байрлал,
    /// хажуугийн шошго бүгд орно.  Хэрэглэгчийн гараар тавьсан зүйл бүртгэлд ХЭЗЭЭ Ч орохгүй.
    ///
    /// ⚠️ SchemaGuid, талбарыг ХЭЗЭЭ Ч бүү өөрчил.  «Duplicate with Detailing» бүртгэлийг хуулдаг — ViewUid таарахгүй бол хоосон гэж үзнэ,
    /// устгахдаа OwnerViewId == энэ харагдац гэдгийг заавал шалгана.
    /// </summary>
    internal static class BbAnnoStore
    {
        private static readonly Guid SchemaGuid = new Guid("5e0b9c37-6a2d-4f18-b4e3-91c7d2a8f640");
        private const string SchemaName = "MglBbStudioAnn";

        private static Schema Get(bool create)
        {
            Schema s = Schema.Lookup(SchemaGuid);
            if (s != null || !create) return s;
            var b = new SchemaBuilder(SchemaGuid);
            b.SetSchemaName(SchemaName);
            b.SetReadAccessLevel(AccessLevel.Public);
            b.SetWriteAccessLevel(AccessLevel.Public);
            b.SetVendorId("MGLE");
            b.SetDocumentation("MGL ББ Студи: энэ харагдацад автоматаар тавьсан тэмдэглэгээ (дахин ажиллуулахад солигдоно).");
            b.AddSimpleField("ViewUid", typeof(string));
            b.AddSimpleField("Ids", typeof(string));
            b.AddSimpleField("Stamp", typeof(string));
            return b.Finish();
        }

        public static List<string> Read(View view)
        {
            var res = new List<string>();
            Schema s = Get(false);
            if (s == null || view == null) return res;
            try
            {
                Entity e = view.GetEntity(s);
                if (e == null || !e.IsValid()) return res;
                if (!string.Equals(e.Get<string>("ViewUid"), view.UniqueId, StringComparison.Ordinal)) return res;
                string ids = e.Get<string>("Ids") ?? "";
                res.AddRange(ids.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries));
            }
            catch { }
            return res;
        }

        /// <summary>
        /// Энэ хэрэгслээр ҮҮСГЭСЭН харагдац уу (бүртгэл байгаа = тийм).  «Стандарт сурах» тэднийг алгасна — эс бөгөөс хэрэгсэл өөрийн гаргасан
        /// зургаас сурч, инженерийн стандартаас холдоно (ЖИШЭЭ-1-ийн туршилтын хуулбар дээр хэмжсэн: огтлолын хэмжээсийн зай 10 → 29 мм).
        /// </summary>
        public static bool IsGenerated(View view)
        {
            Schema s = Get(false);
            if (s == null || view == null) return false;
            try
            {
                Entity e = view.GetEntity(s);
                return e != null && e.IsValid() && string.Equals(e.Get<string>("ViewUid"), view.UniqueId, StringComparison.Ordinal);
            }
            catch { return false; }
        }

        /// <summary>Нээлттэй Transaction дотор: шинэ харагдацыг «энэ хэрэгслийнх» гэж тэмдэглэнэ (тэмдэглэгээний бүртгэл хоосон).</summary>
        public static void MarkGenerated(View view)
        {
            try
            {
                if (view == null || IsGenerated(view)) return;
                var ent = new Entity(Get(true));
                ent.Set("ViewUid", view.UniqueId ?? "");
                ent.Set("Ids", "");
                ent.Set("Stamp", DateTime.UtcNow.ToString("o"));
                view.SetEntity(ent);
            }
            catch { }
        }

        /// <summary>Нээлттэй Transaction дотор.  Өмнөх бүртгэлийн ЭНЭ харагдацынх хэвээр байгаа элементүүдийг устгана.  Устгасан тоо.</summary>
        public static int DeletePrevious(Document doc, View view)
        {
            int n = 0;
            foreach (string uid in Read(view))
            {
                Element e;
                try { e = doc.GetElement(uid); } catch { e = null; }
                if (e == null || e.OwnerViewId != view.Id) continue;
                try { doc.Delete(e.Id); n++; } catch { }
            }
            return n;
        }

        /// <summary>Харагдацын одоогийн өмчлөлийн тэмдэглэгээний элементүүд (хэмжээс, шошго, MRA, бичвэр).</summary>
        public static HashSet<long> Owned(Document doc, View view)
        {
            var res = new HashSet<long>();
            var filter = new LogicalOrFilter(new List<ElementFilter>
            {
                new ElementClassFilter(typeof(Dimension)),
                new ElementClassFilter(typeof(IndependentTag)),
                new ElementClassFilter(typeof(MultiReferenceAnnotation)),
                new ElementClassFilter(typeof(TextNote)),
            });
            foreach (ElementId id in new FilteredElementCollector(doc, view.Id).WherePasses(filter).ToElementIds()) res.Add(id.Value);
            return res;
        }

        /// <summary>Нээлттэй Transaction дотор: <paramref name="before"/>-оос хойш шинээр үүссэнийг бүртгэнэ.  Workshared + өөр хүн эзэмшсэн бол бичихгүй.</summary>
        public static void Record(Document doc, View view, HashSet<long> before)
        {
            try
            {
                if (doc.IsWorkshared && WorksharingUtils.GetCheckoutStatus(doc, view.Id) == CheckoutStatus.OwnedByOtherUser) return;
                var ids = new List<string>();
                foreach (long id in Owned(doc, view))
                {
                    if (before.Contains(id)) continue;
                    Element e = doc.GetElement(new ElementId(id));
                    if (e != null) ids.Add(e.UniqueId);
                }
                var ent = new Entity(Get(true));
                ent.Set("ViewUid", view.UniqueId ?? "");
                ent.Set("Ids", string.Join(";", ids));
                ent.Set("Stamp", DateTime.UtcNow.ToString("o"));
                view.SetEntity(ent);
            }
            catch { }
        }
    }
}
