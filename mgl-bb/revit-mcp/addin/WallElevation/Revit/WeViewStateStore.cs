using System;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.ExtensibleStorage;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// Үүсгэсэн харагдацын ТӨЛӨВ (<see cref="WeViewState"/>: хэрэгслийн тавьсан масштаб, босоо хүрээний доод/дээд хил) — 2026-10-16-ны ШИНЭ схем.
    /// ⚠️ <see cref="GeneratedElevationRepository"/> ба <see cref="WeOverrideStore"/>-ийн схемд талбар нэмэх боломжгүй (тогтсон GUID, Revit өөр
    /// бүтэцтэй ижил GUID-ийг хориглодог) — тиймээс шинэ GUID.  Энэ GUID-ийг ч бүү өөрчил, талбар бүү нэм: шинэ утга нь <c>Data</c> мөрийн шинэ
    /// түлхүүр (<see cref="WeViewState"/> танихгүй түлхүүрийг хадгалдаг тул хуучин хувилбар устгахгүй).  Бичлэггүй харагдац = өгөгдмөл төлөв.
    /// </summary>
    internal static class WeViewStateStore
    {
        private static readonly Guid SchemaGuid = new Guid("c4a7e2d9-6b1f-4f83-a5d0-3e9b7c2f1a58");

        private static Schema GetOrCreate()
        {
            Schema s = Schema.Lookup(SchemaGuid);
            if (s != null) return s;
            var b = new SchemaBuilder(SchemaGuid);
            b.SetSchemaName("MglWallElevationState");
            b.SetReadAccessLevel(AccessLevel.Public);
            b.SetWriteAccessLevel(AccessLevel.Public);
            b.SetVendorId("com.revitmcp");
            b.SetDocumentation("MGL «Ханын дэлгээс»: үүсгэсэн харагдацын төлөв (v=1;scale=…;lo=…;up=… — масштаб, босоо хүрээний мм).");
            b.AddSimpleField("Data", typeof(string));
            return b.Finish();
        }

        /// <summary>Харагдацын төлөв; бичлэггүй/уншигдахгүй бол өгөгдмөл (хэзээ ч null биш).</summary>
        public static WeViewState Read(Element e)
        {
            try
            {
                Schema s = Schema.Lookup(SchemaGuid);
                if (s == null || e == null) return new WeViewState();
                Entity ent = e.GetEntity(s);
                return ent != null && ent.IsValid() ? WeViewState.Parse(ent.Get<string>("Data")) : new WeViewState();
            }
            catch { return new WeViewState(); }
        }

        /// <summary>Нээлттэй Transaction дотор.  Утга өөрчлөгдөөгүй бол бичихгүй (Revit-д өөрчлөлт бүртгэгдэхгүй).</summary>
        public static void Write(Element e, WeViewState state)
        {
            if (e == null || state == null) return;
            string data = state.Serialize();
            try
            {
                Schema s0 = Schema.Lookup(SchemaGuid);
                if (s0 != null)
                {
                    Entity cur = e.GetEntity(s0);
                    if (cur != null && cur.IsValid() && string.Equals(cur.Get<string>("Data"), data, StringComparison.Ordinal)) return;
                }
            }
            catch { }
            Schema s = GetOrCreate();
            var ent = new Entity(s);
            ent.Set("Data", data);
            e.SetEntity(ent);
        }
    }
}
