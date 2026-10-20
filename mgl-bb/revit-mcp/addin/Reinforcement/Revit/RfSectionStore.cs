using System;
using System.Collections.Generic;
using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.ExtensibleStorage;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement
{
    /// <summary>Нэг эзэн элемент дээр тавьсан тэмдэглэгээний багц + тавих үеийн сонголт (дахин тооцоход).</summary>
    public sealed class RfSectionSaved
    {
        public string Host { get; set; } = "";
        public string Ref { get; set; } = "outer";
        public bool Left { get; set; } = true;
        public bool Right { get; set; } = true;
        public bool Top { get; set; } = true;
        public bool Bottom { get; set; } = true;
        public bool Dims { get; set; } = true;
        public bool TagLong { get; set; } = true;
        public bool TagStirrups { get; set; } = true;
        public bool GroupTags { get; set; } = true;

        /// <summary>Гишүүний хэмжээсийн гадна гинж (тэнхлэг, хучилт, хана).  Хуучин бүртгэлд байхгүй ⇒ false («Шинэчлэх» хуучин зан төлөвөөр).</summary>
        public bool MemberDims { get; set; } = false;
        public double MemberPitchMm { get; set; } = 8;

        /// <summary>Олонлог бүрд нэг tag.  Хуучин бүртгэлд байхгүй ⇒ false (тэр үеийн зан төлөв хэвээр).</summary>
        public bool SingleTagPerSet { get; set; } = false;
        public bool MultiLeaderPerSet { get; set; } = false;
        public bool MergeLeaders { get; set; } = false;
        public bool ReplacePrevious { get; set; } = true;
        public double DimOffsetMm { get; set; } = 10;

        /// <summary>Хэмжээсийн тал (2026-10-09): «top»|«bottom», «right»|«left».  Хуучин бүртгэлд байхгүй ⇒ дээд/баруун (тэр үеийн зан төлөв).</summary>
        public string HDimSide { get; set; } = "top";
        public string VDimSide { get; set; } = "right";

        /// <summary>«Байрлал — 4 талд».  Хуучин бүртгэлд байхгүй ⇒ false.</summary>
        public bool DimAllSides { get; set; } = false;
        public double TagGapMm { get; set; } = 6;

        /// <summary>Leader-ийн 3→2 / 2→1 зай (цаасан мм, 0 = автомат).  Хуучин бүртгэлд байхгүй ⇒ 0.</summary>
        public double LeaderLandingMm { get; set; } = 0;
        public double LeaderRunMm { get; set; } = 0;
        public string DimTypeUid { get; set; } = "";
        public string MainTagUid { get; set; } = "";
        public string StirrupTagUid { get; set; } = "";

        /// <summary>Энэ багцад үүсгэсэн БҮХ элементийн UniqueId (хэмжээс, шугам, бичвэр, tag).</summary>
        public List<string> Ids { get; set; } = new List<string>();
    }

    public sealed class RfSectionStoreData
    {
        public int V { get; set; } = 1;

        /// <summary>Бүртгэлийг бичсэн харагдацын UniqueId (schema хөдөлгөхгүйн тулд JSON дотор).  Өөр харагдацад хуулагдсан бол таарахгүй.</summary>
        public string ViewUid { get; set; } = "";

        public List<RfSectionSaved> Sets { get; set; } = new List<RfSectionSaved>();

        /// <summary>Бүртгэл ӨӨР харагдацаас хуулагдсан (Duplicate View) — энэ харагдацынх биш; хоосон гэж үзнэ.</summary>
        [System.Text.Json.Serialization.JsonIgnore]
        public bool Foreign { get; set; }
    }

    /// <summary>
    /// «Энэ харагдацад энэ эзэн дээр автоматаар тавьсан»-ыг ХАРАГДАЦ дээр (Extensible Storage) JSON-оор хадгална.
    /// Дахин ажиллуулахад ЗӨВХӨН эдгээрийг (ЭНЭ харагдацынх гэдгийг шалгаад) солино — хэрэглэгчийн гараар тавьсан
    /// хэмжээс, tag ХЭЗЭЭ Ч хөндөгдөхгүй.
    ///
    /// ⚠️ SchemaGuid, талбарыг ХЭЗЭЭ Ч бүү өөрчил.  Харагдацыг «Duplicate with Detailing»-оор хуулбарласан үед бичлэг
    /// ч хуулагддаг — тиймээс устгахдаа элементийн OwnerViewId == энэ харагдац гэдгийг ЗААВАЛ шалгана (эс бөгөөс хуулбар
    /// дээр ажиллуулахад ЭХ харагдацын тэмдэглэгээ устна).
    /// </summary>
    internal static class RfSectionStore
    {
        private static readonly Guid SchemaGuid = new Guid("c3e1a7d4-8f20-4b6e-a9d1-2f4b6c8e0a53");
        private const string SchemaName = "MglRfSectionAnn";

        private static Schema Schema()
        {
            Schema s = Autodesk.Revit.DB.ExtensibleStorage.Schema.Lookup(SchemaGuid);
            if (s != null) return s;
            var b = new SchemaBuilder(SchemaGuid);
            b.SetSchemaName(SchemaName);
            b.SetReadAccessLevel(AccessLevel.Public);
            b.SetWriteAccessLevel(AccessLevel.Public);
            b.SetVendorId("com.revitmcp");
            b.SetDocumentation("MGL «Огтлолын арматурын тэмдэглэгээ»: энэ харагдацад эзэн тус бүр дээр тавьсан элементүүд ба сонголт.");
            b.AddSimpleField("Json", typeof(string));
            b.AddSimpleField("Stamp", typeof(string));
            return b.Finish();
        }

        public static RfSectionStoreData Read(View view)
        {
            var data = new RfSectionStoreData();
            Schema s = Autodesk.Revit.DB.ExtensibleStorage.Schema.Lookup(SchemaGuid);
            if (s == null || view == null) return data;
            try
            {
                Entity ent = view.GetEntity(s);
                if (ent == null || !ent.IsValid()) return data;
                string json = ent.Get<string>("Json");
                if (string.IsNullOrEmpty(json)) return data;
                RfSectionStoreData parsed = JsonSerializer.Deserialize<RfSectionStoreData>(json);
                if (parsed != null && parsed.Sets != null)
                {
                    // Харагдацыг «Duplicate with Detailing»-оор хуулбарлахад Entity хамт хуулагддаг (Revit-ийн баримт).  Хуулбар дахь элементүүд
                    // ШИНЭ UniqueId-тай тул бүртгэлд байхгүй — тэр бүртгэлээр «шинэчлэх/солих» нь хуулбар дээр юу ч олохгүй, эсвэл (өөр зүйл
                    // таарвал) буруу зүйлд хүрнэ.  Тиймээс өөр харагдацын бүртгэлийг ХООСОН гэж үзнэ.
                    if (!string.IsNullOrEmpty(parsed.ViewUid) && !string.Equals(parsed.ViewUid, view.UniqueId, StringComparison.Ordinal))
                        return new RfSectionStoreData { Foreign = true };
                    return parsed;
                }
            }
            catch
            {
                // Эвдэрсэн бичлэг — «өмнөх байхгүй» (хамгийн аюулгүй).
            }
            return data;
        }

        /// <summary>Харагдац дээр бүртгэл бичиж болох уу (workshared бол өөр хэрэглэгч эзэмшээгүй).</summary>
        public static bool CanWrite(Document doc, View view)
        {
            try
            {
                if (!doc.IsWorkshared) return true;
                return WorksharingUtils.GetCheckoutStatus(doc, view.Id) != CheckoutStatus.OwnedByOtherUser;
            }
            catch
            {
                return true;
            }
        }

        /// <summary>Нээлттэй Transaction дотор.  Засах эрхгүй (өөр хүн эзэмшсэн) бол false.</summary>
        public static bool Write(Document doc, View view, RfSectionStoreData data)
        {
            try
            {
                if (doc.IsWorkshared)
                {
                    CheckoutStatus st = WorksharingUtils.GetCheckoutStatus(doc, view.Id);
                    if (st == CheckoutStatus.OwnedByOtherUser) return false;
                }
                data.ViewUid = view.UniqueId ?? string.Empty;
                var ent = new Entity(Schema());
                ent.Set("Json", JsonSerializer.Serialize(data));
                ent.Set("Stamp", DateTime.UtcNow.ToString("o"));
                view.SetEntity(ent);
                return true;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>Багцын одоо ч байгаа, ЭНЭ харагдацын өмчлөлийн элементүүд.</summary>
        public static List<ElementId> Alive(Document doc, View view, RfSectionSaved set)
        {
            var ids = new List<ElementId>();
            foreach (string uid in set.Ids)
            {
                Element e = string.IsNullOrEmpty(uid) ? null : doc.GetElement(uid);
                if (e != null && e.OwnerViewId == view.Id) ids.Add(e.Id);
            }
            return ids;
        }
    }
}
