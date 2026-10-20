using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.ExtensibleStorage;

namespace RevitMcpAddin.AutoAnnotate
{
    /// <summary>
    /// «Энэ харагдацад автоматаар тавьсан хэмжээс/tag» — ХАРАГДАЦ дээр (Extensible Storage)
    /// UniqueId-ийн жагсаалт.  Дахин ажиллуулахад ЗӨВХӨН эдгээрийг устгаж шинээр тавина:
    /// хэрэглэгчийн гараар тавьсан хэмжээс, tag хэзээ ч хөндөгдөхгүй.
    ///
    /// ⚠️ Харагдацыг «Duplicate with Detailing»-оор хуулбарлавал энэ бичлэг ч хуулагдана —
    /// тиймээс устгахдаа элементийн OwnerViewId == энэ харагдац гэдгийг ЗААВАЛ шалгана,
    /// эс бөгөөс хуулбар дээр ажиллуулахад эх харагдацын хэмжээс устана.
    ///
    /// ⚠️ SchemaGuid-ийг ХЭЗЭЭ Ч бүү өөрчил, талбар бүү нэм/хас (Revit хориглодог).
    /// </summary>
    public static class AaStore
    {
        private static readonly Guid SchemaGuid = new Guid("703fd5e6-e20d-4ba2-9edc-7752e0181c43");
        private const string SchemaName = "MglAutoAnnotate";

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
            b.SetDocumentation("MGL «Автомат хэмжээс»: энэ харагдацад автоматаар тавьсан хэмжээс, tag-ийн UniqueId.");
            b.AddArrayField("Created", typeof(string));
            b.AddSimpleField("Stamp", typeof(string));
            return b.Finish();
        }

        /// <summary>Энэ харагдацад өмнө тавьсан (одоо ч байгаа, ЭНЭ харагдацынх) элементүүд.</summary>
        public static List<ElementId> Previous(Document doc, View view)
        {
            var r = new List<ElementId>();
            Schema s = Autodesk.Revit.DB.ExtensibleStorage.Schema.Lookup(SchemaGuid);
            if (s == null || view == null)
                return r;
            try
            {
                Entity ent = view.GetEntity(s);
                if (ent == null || !ent.IsValid())
                    return r;
                IList<string> uids = ent.Get<IList<string>>("Created");
                if (uids == null)
                    return r;
                foreach (string uid in uids)
                {
                    Element e = string.IsNullOrEmpty(uid) ? null : doc.GetElement(uid);
                    if (e != null && e.OwnerViewId == view.Id)
                        r.Add(e.Id);
                }
            }
            catch
            {
                // Уншиж чадахгүй бол «өмнөх байхгүй» — хамгийн аюулгүй.
            }
            return r;
        }

        /// <summary>Нээлттэй Transaction дотор.  Засах эрхгүй бол (өөр хүн эзэмшсэн) false.</summary>
        public static bool Write(Document doc, View view, IEnumerable<ElementId> ids)
        {
            try
            {
                if (doc.IsWorkshared)
                {
                    CheckoutStatus st = WorksharingUtils.GetCheckoutStatus(doc, view.Id);
                    if (st == CheckoutStatus.OwnedByOtherUser)
                        return false;
                }
                Schema s = Schema();
                var ent = new Entity(s);
                IList<string> uids = ids
                    .Select(id => doc.GetElement(id))
                    .Where(e => e != null)
                    .Select(e => e.UniqueId)
                    .Distinct()
                    .ToList();
                ent.Set<IList<string>>("Created", uids);
                ent.Set("Stamp", DateTime.UtcNow.ToString("o"));
                view.SetEntity(ent);
                return true;
            }
            catch
            {
                return false;
            }
        }
    }
}
