using System;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.ExtensibleStorage;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// Хэрэглэгчийн ТОХИРУУЛСАН дэлгээсийн байрлал (<see cref="Core.WeSideOverride"/>) — дэлгээсийн харагдац дээр ТУСДАА схемд.
    /// ⚠️ <see cref="GeneratedElevationRepository"/>-ийн схемд талбар нэмэх боломжгүй (тогтсон GUID) — тиймээс шинэ схем.  Энэ GUID-ийг ч
    /// хэзээ ч бүү өөрчил, талбар бүү нэм.
    /// </summary>
    internal static class WeOverrideStore
    {
        private static readonly Guid SchemaGuid = new Guid("8e2f4c7a-1b3d-4a59-9c06-7d5e2b8f1a63");

        private static Schema GetOrCreate()
        {
            Schema s = Schema.Lookup(SchemaGuid);
            if (s != null) return s;
            var b = new SchemaBuilder(SchemaGuid);
            b.SetSchemaName("MglWallElevationOverride");
            b.SetReadAccessLevel(AccessLevel.Public);
            b.SetWriteAccessLevel(AccessLevel.Public);
            b.SetVendorId("com.revitmcp");
            b.SetDocumentation("MGL «Ханын дэлгээс»: хэрэглэгчийн тохируулсан зүсэх шугам (v1;ax;ay;bx;by;lx;ly).");
            b.AddSimpleField("Data", typeof(string));
            return b.Finish();
        }

        public static string Read(Element e)
        {
            try
            {
                Schema s = Schema.Lookup(SchemaGuid);
                if (s == null || e == null) return null;
                Entity ent = e.GetEntity(s);
                return ent != null && ent.IsValid() ? ent.Get<string>("Data") : null;
            }
            catch { return null; }
        }

        /// <summary>Нээлттэй Transaction дотор.  Хоосон = арилгана.</summary>
        public static void Write(Element e, string data)
        {
            if (e == null) return;
            if (string.IsNullOrEmpty(data))
            {
                Schema s0 = Schema.Lookup(SchemaGuid);
                if (s0 != null) { try { e.DeleteEntity(s0); } catch { } }
                return;
            }
            Schema s = GetOrCreate();
            var ent = new Entity(s);
            ent.Set("Data", data);
            e.SetEntity(ent);
        }
    }
}
