using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.ExtensibleStorage;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>Нэг үүсгэсэн харагдац/хуудасны бичлэг (Extensible Storage).</summary>
    internal sealed class WeRecord
    {
        /// <summary>«view» эсвэл «sheet».</summary>
        public string Kind;
        public string Key;
        public string WallUid;
        public string RoomUid;
        public string Side;
        public string Signature;
        public string GeneratedName;
        public int GeneratorVersion;
    }

    /// <summary>
    /// Үүсгэсэн харагдацын ТАНИЛТ — нэрээр БИШ, харагдац дээр бичсэн Extensible Storage-оор.
    /// Ингэснээр дахин ажиллуулахад давхардал үүсэхгүй, хэрэглэгч нэрийг солиход ч хэрэгсэл танина.
    ///
    /// ⚠️ <see cref="SchemaGuid"/>-ийг ХЭЗЭЭ Ч бүү өөрчил, талбар бүү нэм/хас — Revit хуучин схемтэй загварт
    ///    өөр бүтэцтэй ижил GUID-ийг хориглодог.  Шинэ талбар хэрэгтэй бол ШИНЭ GUID + шилжилт.
    /// ⚠️ «Duplicate» хийсэн харагдацад бичлэг ХУУЛАГДАНА — тиймээс нэг түлхүүрт хоёр харагдац байж болно;
    ///    төлөвлөгч үүнийг «давхардал» гэж илрүүлж хоёуланд нь хүрэхгүй.
    /// </summary>
    internal static class GeneratedElevationRepository
    {
        internal static readonly Guid SchemaGuid = new Guid("5b8d6c1e-3f7a-4e29-9a61-0c2d7f4e8b13");
        private const string SchemaName = "MglWallElevation";
        public const string KindView = "view";
        public const string KindSheet = "sheet";
        /// <summary>Өрөөний түлхүүр план (ViewPlan).</summary>
        public const string KindKeyPlan = "keyplan";
        /// <summary>Өрөөний 3D харагдах байдал (View3D).</summary>
        public const string KindAxon = "axon";

        private static Schema GetOrCreate()
        {
            Schema s = Schema.Lookup(SchemaGuid);
            if (s != null) return s;
            var b = new SchemaBuilder(SchemaGuid);
            b.SetSchemaName(SchemaName);
            b.SetReadAccessLevel(AccessLevel.Public);
            b.SetWriteAccessLevel(AccessLevel.Public);
            b.SetVendorId("com.revitmcp");
            b.SetDocumentation("MGL «Ханын дэлгээс»: үүсгэсэн харагдац/хуудасны эх хана, өрөө, тал, геометрийн тэмдэг.");
            b.AddSimpleField("Kind", typeof(string));
            b.AddSimpleField("Key", typeof(string));
            b.AddSimpleField("WallUid", typeof(string));
            b.AddSimpleField("RoomUid", typeof(string));
            b.AddSimpleField("Side", typeof(string));
            b.AddSimpleField("Signature", typeof(string));
            b.AddSimpleField("GeneratedName", typeof(string));
            b.AddSimpleField("GeneratorVersion", typeof(int));
            b.AddSimpleField("Stamp", typeof(string));
            return b.Finish();
        }

        /// <summary>Нэг элементийн бичлэг; байхгүй/уншигдахгүй бол null.</summary>
        public static WeRecord Read(Element e)
        {
            Schema s = Schema.Lookup(SchemaGuid);
            return s == null ? null : Read(e, s);
        }

        internal static WeRecord Read(Element e, Schema s)
        {
            if (e == null) return null;
            try
            {
                Entity ent = e.GetEntity(s);
                if (ent == null || !ent.IsValid()) return null;
                // Link-ийг устгаж/дахин холбосон бол хуучин instance-ийн түлхүүрийг ИЖИЛ өрөө/ханатай шинэ instance руу (WeLinkRef.Rebind) —
                // төлөвлөгч хуучин дэлгээсийг «шинэчилнэ», «(2)» давхардал үүсгэхгүй.  Дараагийн бичилтэд шинэ түлхүүр хадгалагдана.
                Document doc = e.Document;
                string key = ent.Get<string>("Key"), wall = ent.Get<string>("WallUid"), room = ent.Get<string>("RoomUid");
                if ((key ?? string.Empty).IndexOf(WeLinkRef.Prefix, StringComparison.Ordinal) >= 0)
                {
                    // Төвийг зөвхөн хэрэгтэй үед (хуучин instance ачаалагдаагүй + хэд хэдэн тохирох instance) — нэг удаа.
                    XYZ cached = null;
                    bool done = false;
                    Func<XYZ> near = () => { if (!done) { cached = WeLinkRef.CenterOf(e as View); done = true; } return cached; };
                    key = WeLinkRef.Rebind(doc, key, near);
                    wall = WeLinkRef.Rebind(doc, wall, near);
                    room = WeLinkRef.Rebind(doc, room, near);
                }
                return new WeRecord
                {
                    Kind = ent.Get<string>("Kind"),
                    Key = key,
                    WallUid = wall,
                    RoomUid = room,
                    Side = ent.Get<string>("Side"),
                    Signature = ent.Get<string>("Signature"),
                    GeneratedName = ent.Get<string>("GeneratedName"),
                    GeneratorVersion = ent.Get<int>("GeneratorVersion"),
                };
            }
            catch
            {
                return null;   // уншигдахгүй бичлэг = «манайх биш» (хамгийн аюулгүй)
            }
        }

        /// <summary>Баримтын бүх бичлэгтэй харагдац + хуудас — НЭГ collector.</summary>
        public static List<KeyValuePair<View, WeRecord>> ReadAll(Document doc)
        {
            var r = new List<KeyValuePair<View, WeRecord>>();
            Schema s = Schema.Lookup(SchemaGuid);
            if (s == null) return r;
            foreach (View v in new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>())
            {
                if (v.IsTemplate) continue;
                WeRecord rec = Read(v, s);
                if (rec != null && !string.IsNullOrEmpty(rec.Key)) r.Add(new KeyValuePair<View, WeRecord>(v, rec));
            }
            return r;
        }

        /// <summary>Нээлттэй Transaction дотор.</summary>
        public static void Write(Element e, WeRecord rec)
        {
            Schema s = GetOrCreate();
            var ent = new Entity(s);
            ent.Set("Kind", rec.Kind ?? KindView);
            ent.Set("Key", rec.Key ?? string.Empty);
            ent.Set("WallUid", rec.WallUid ?? string.Empty);
            ent.Set("RoomUid", rec.RoomUid ?? string.Empty);
            ent.Set("Side", rec.Side ?? string.Empty);
            ent.Set("Signature", rec.Signature ?? string.Empty);
            ent.Set("GeneratedName", rec.GeneratedName ?? string.Empty);
            ent.Set("GeneratorVersion", rec.GeneratorVersion);
            ent.Set("Stamp", DateTime.UtcNow.ToString("o"));
            e.SetEntity(ent);
        }

        /// <summary>
        /// W01: бичлэгийн тэмдгийг солино (нээлттэй Transaction дотор) — тэмдэглэгээ амжилттай тавигдсаны дараа бүтэн тэмдэг
        /// (<see cref="WeIdentity.Pending"/>).  Бичлэггүй/ижил бол юу ч хийхгүй.  true = бичсэн.
        /// </summary>
        public static bool SetSignature(Element e, string signature)
        {
            WeRecord rec = Read(e);
            if (rec == null || string.Equals(rec.Signature ?? string.Empty, signature ?? string.Empty, StringComparison.Ordinal)) return false;
            rec.Signature = signature ?? string.Empty;
            Write(e, rec);
            return true;
        }

        /// <summary>Төлөвлөгчийн оролт: зөвхөн «view» бичлэг, эх элемент байгаа эсэхийг шалгасан.</summary>
        public static List<WeExistingView> ExistingViews(Document doc, List<KeyValuePair<View, WeRecord>> all)
        {
            var list = new List<WeExistingView>();
            bool shared = doc.IsWorkshared;
            foreach (KeyValuePair<View, WeRecord> kv in all)
            {
                if (kv.Value.Kind != KindView) continue;
                bool other = false;
                if (shared)
                {
                    try { other = WorksharingUtils.GetCheckoutStatus(doc, kv.Key.Id) == CheckoutStatus.OwnedByOtherUser; }
                    catch { other = false; }
                }
                // W07: босоо хүрээний тохируулга — ШИНЭ схемээс (MglWallElevationState); бичлэггүй хуучин харагдац = авто.
                WeViewState state = WeViewStateStore.Read(kv.Key);
                list.Add(new WeExistingView
                {
                    ViewId = kv.Key.Id.Value,
                    Key = kv.Value.Key,
                    Signature = kv.Value.Signature,
                    Name = kv.Key.Name,
                    GeneratedName = kv.Value.GeneratedName,
                    WallUid = kv.Value.WallUid,
                    RoomUid = kv.Value.RoomUid,
                    GeneratorVersion = kv.Value.GeneratorVersion,
                    SourceWallExists = WeLinkRef.Exists(doc, kv.Value.WallUid),
                    SourceRoomExists = string.IsNullOrEmpty(kv.Value.RoomUid) || WeLinkRef.Exists(doc, kv.Value.RoomUid),
                    OwnedByOtherUser = other,
                    IsSection = kv.Key.ViewType == ViewType.Section,
                    Override = WeOverrideStore.Read(kv.Key),
                    CropLowerMm = state.CropLowerMm,
                    CropUpperMm = state.CropUpperMm,
                    Preset = state.Preset,
                });
            }
            return list;
        }

        /// <summary>
        /// Харагдацыг үүсгэх/шинэчлэх үеийн бичлэг — тэмдэг нь ТЭМДЭГЛЭГЭЭ ХҮЛЭЭГДЭЖ БАЙГАА хэлбэрээр (<see cref="WeIdentity.Pending"/>):
        /// бүтэн тэмдгийг тэмдэглэгээ commit болсны дараа <see cref="SetSignature"/> бичнэ (W01 — дундаас зогссон ажил тэмдэглэгээгүй
        /// харагдацыг «өөрчлөлтгүй» гэж үлдээхгүй).
        /// </summary>
        public static WeRecord RecordFor(WePlannedElevation p, string name)
        {
            return new WeRecord
            {
                Kind = KindView,
                Key = p.Key,
                WallUid = p.WallUid,
                RoomUid = p.RoomUid,
                Side = p.Side,
                Signature = WeIdentity.Pending(p.Signature),
                GeneratedName = name,
                GeneratorVersion = WeIdentity.GeneratorVersion,
            };
        }
    }
}
