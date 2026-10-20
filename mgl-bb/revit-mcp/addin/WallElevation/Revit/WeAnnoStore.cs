using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.ExtensibleStorage;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// «Энэ дэлгээст ХЭРЭГСЛИЙН тавьсан тэмдэглэгээ» — харагдац дээр (Extensible Storage) UniqueId-ийн жагсаалт.
    /// Шинэчлэхэд ЗӨВХӨН эдгээрийг устгаж шинээр тавина — хэрэглэгчийн гараар тавьсан хэмжээс, шошго хэзээ ч хөндөгдөхгүй.
    /// ⚠️ «Duplicate with Detailing»-оор хуулбарласан харагдацад бичлэг хуулагдана — тиймээс OwnerViewId-ийг ЗААВАЛ шалгана.
    /// ⚠️ SchemaGuid-ийг бүү өөрчил, талбар бүү нэм/хас (Revit хориглодог) — шинэ талбар хэрэгтэй бол шинэ схем.
    /// </summary>
    internal static class WeAnnoStore
    {
        private static readonly Guid SchemaGuid = new Guid("2f6e7c91-8a4b-4d1e-9c3a-6b0d5e1f7a24");

        private static Schema GetOrCreate()
        {
            Schema s = Schema.Lookup(SchemaGuid);
            if (s != null) return s;
            var b = new SchemaBuilder(SchemaGuid);
            b.SetSchemaName("MglWallElevationAnno");
            b.SetReadAccessLevel(AccessLevel.Public);
            b.SetWriteAccessLevel(AccessLevel.Public);
            b.SetVendorId("com.revitmcp");
            b.SetDocumentation("MGL «Ханын дэлгээс»: энэ харагдацад хэрэгслийн тавьсан хэмжээс, spot level, шошгоны UniqueId.");
            b.AddArrayField("Created", typeof(string));
            b.AddSimpleField("Stamp", typeof(string));
            return b.Finish();
        }

        /// <summary>Өмнө тавьсан (одоо ч байгаа, ЭНЭ харагдацынх) элементүүд.</summary>
        public static List<ElementId> Previous(Document doc, View view)
        {
            var r = new List<ElementId>();
            Schema s = Schema.Lookup(SchemaGuid);
            if (s == null || view == null) return r;
            try
            {
                Entity ent = view.GetEntity(s);
                if (ent == null || !ent.IsValid()) return r;
                IList<string> uids = ent.Get<IList<string>>("Created");
                if (uids == null) return r;
                foreach (string uid in uids)
                {
                    Element e = string.IsNullOrEmpty(uid) ? null : doc.GetElement(uid);
                    if (e != null && e.OwnerViewId == view.Id) r.Add(e.Id);
                }
            }
            catch
            {
                // Уншиж чадахгүй бол «өмнөх байхгүй» — хамгийн аюулгүй (хэрэглэгчийнхийг устгахгүй).
            }
            return r;
        }

        /// <summary>Нээлттэй Transaction дотор.</summary>
        public static void Write(Document doc, View view, IEnumerable<ElementId> ids)
        {
            var ent = new Entity(GetOrCreate());
            IList<string> uids = ids.Select(id => doc.GetElement(id)).Where(e => e != null).Select(e => e.UniqueId).Distinct().ToList();
            ent.Set<IList<string>>("Created", uids);
            ent.Set("Stamp", DateTime.UtcNow.ToString("o"));
            view.SetEntity(ent);
        }
    }
}
