using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.ChangeImpact.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>Хана MVP-д дэмжигдэх эсэхийн дүн.  ⚠️ `Wall` амьд обьект — ЗӨВХӨН нэг Step дотор ашиглана.</summary>
    internal sealed class WallCheck
    {
        public bool Ok;
        public string Problem;
        /// <summary>Revit энэ хөдөлгөөнийг ХИЙЛГЭХГҮЙ нь тодорхой (Pin, өөр хэрэглэгчийн эзэмшил, зөвхөн унших) → шийдвэр «ЗӨӨХГҮЙ».  false = зүгээр л шалгах чадваргүй → «ДҮГНЭХ БОЛОМЖГҮЙ».</summary>
        public bool Refused;
        /// <summary>Ажлын багийн загварт хана хэнд ч эзэмшигдээгүй: preview нь түр эзэмшил (checkout) үүсгэж болзошгүй — эхлэхээс ӨМНӨ хэрэглэгчээс асууна.</summary>
        public bool NeedsCheckoutAck;
        public Wall Wall;
        public Line Line;
        public double ThicknessFt;
        public List<string> Warnings = new List<string>();
    }

    /// <summary>
    /// «Өөрчлөхөөс өмнө шалгах» MVP-ийн ХАНЫН дэмжлэг ба талын шалгалт.
    ///
    /// ДЭМЖИГДЭХ: шулуун, ердийн (Basic) хана — байрлалын шугам нь `Line`, хэвтээ, түгжигдээгүй, группгүй, design option-гүй.
    /// ТАТГАЛЗАХ (ЯАГААД-тай, Монголоор): нумант/муруй, Curtain, Stacked, түгжигдсэн (Pin), группийн гишүүн, design option, линк загварын
    /// хана, зөвхөн унших файл, өөр хэрэглэгчид эзэмшигдсэн (workshare).  «Буруу байж болох simulation» хийхээсээ илүү ил татгалзана.
    /// </summary>
    internal static class PreChangeWallRules
    {
        /// <summary>Нүх, хаалга, нэмэлт ханыг (`FindInserts`) олох гарц — Revit-ийн баримтжуулсан API.</summary>
        internal const int MaxInserts = 200;

        internal static WallCheck Check(Document doc, Element e)
        {
            var res = new WallCheck();
            if (doc == null) { res.Problem = "Идэвхтэй баримт алга."; return res; }
            if (doc.IsFamilyDocument) { res.Problem = "Family файлд ажиллахгүй — зөвхөн төслийн (project) файлд."; return res; }
            if (e == null || !e.IsValidObject) { res.Problem = "Хана олдсонгүй (устсан байж болзошгүй)."; return res; }
            if (e is RevitLinkInstance) { res.Problem = "Линк загварын ханыг энд зөөх боломжгүй — линк файлаа нээж шалгана уу."; return res; }

            var wall = e as Wall;
            if (wall == null) { res.Problem = "Зөвхөн хана (Wall) дэмжигдэнэ — «" + SafeCategory(e) + "» биш."; return res; }

            try
            {
                if (doc.IsReadOnly) { res.Problem = "Файл зөвхөн унших горимд байна (read-only) — хөдөлгөөнийг шалгах боломжгүй."; res.Refused = true; return res; }

                WallType type = wall.WallType;
                if (type != null)
                {
                    if (type.Kind == WallKind.Curtain) { res.Problem = "Curtain Wall-ийн нөлөөллийн шалгалт MVP-д хараахан дэмжигдээгүй."; return res; }
                    if (type.Kind == WallKind.Stacked) { res.Problem = "Stacked Wall-ийн нөлөөллийн шалгалт MVP-д хараахан дэмжигдээгүй."; return res; }
                }
                if (wall.IsStackedWallMember) { res.Problem = "Stacked Wall-ийн гишүүн хана — MVP-д дэмжигдээгүй."; return res; }

                var lc = wall.Location as LocationCurve;
                if (lc == null || lc.Curve == null) { res.Problem = "Хананы байрлалын шугам олдсонгүй."; return res; }
                var line = lc.Curve as Line;
                if (line == null) { res.Problem = "Нумант (муруй) хананы нөлөөллийн шалгалт MVP-д хараахан дэмжигдээгүй."; return res; }
                if (line.Length <= 1e-6) { res.Problem = "Хананы урт 0 байна."; return res; }
                XYZ d = line.Direction;
                if (Math.Abs(d.Z) > 1e-6) { res.Problem = "Налуу хананы нөлөөллийн шалгалт MVP-д хараахан дэмжигдээгүй."; return res; }

                if (wall.Pinned) { res.Problem = "Хана түгжигдсэн (Pin) байна — эхлээд Unpin хийнэ үү."; res.Refused = true; return res; }
                if (wall.GroupId != null && wall.GroupId != ElementId.InvalidElementId) { res.Problem = "Группийн гишүүн хана — группээ засварлах горимд нээж шалгана уу (MVP-д дэмжигдээгүй)."; return res; }
                if (wall.DesignOption != null) { res.Problem = "Design option доторх хана — MVP-д дэмжигдээгүй (өрөө, харагдац сонгосон option-оос хамаарна)."; return res; }

                if (doc.IsWorkshared)
                {
                    CheckoutStatus st = WorksharingUtils.GetCheckoutStatus(doc, wall.Id);
                    if (st == CheckoutStatus.OwnedByOtherUser)
                    {
                        string owner = null;
                        try { owner = WorksharingUtils.GetWorksharingTooltipInfo(doc, wall.Id).Owner; } catch (Exception) { }
                        res.Problem = "Хана өөр хэрэглэгчид эзэмшигдсэн" + (string.IsNullOrEmpty(owner) ? "" : " (" + owner + ")") + " — засах боломжгүй.";
                        res.Refused = true;
                        return res;
                    }
                    // «Эзэмшигдээгүй»: preview нь Revit-д ханыг түр засах транзакц нээдэг тул Revit автоматаар checkout хийж болзошгүй, rollback нь
                    // эзэмшлийг ЧӨЛӨӨЛДӨГГҮЙ.  Чимээгүй авахгүй — UI эхлээд асууна (`NeedsCheckoutAck`).
                    // ⚠️ `GetCheckoutStatus` нь кэштэй төлөв — «засах боломжтой» гэдгийн баталгаа БИШ, зөвхөн сануулга.
                    if (st == CheckoutStatus.NotOwned) res.NeedsCheckoutAck = true;
                }

                res.Wall = wall;
                res.Line = line;
                res.ThicknessFt = wall.Width;
                res.Ok = true;
                return res;
            }
            catch (Exception ex)
            {
                res.Ok = false;
                res.Problem = "Ханыг шалгаж чадсангүй (" + ex.GetType().Name + ").";
                return res;
            }
        }

        private static string SafeCategory(Element e)
        {
            try { return e.Category != null ? e.Category.Name : e.GetType().Name; }
            catch (Exception) { return "элемент"; }
        }

        /// <summary>Хананд хостлогдсон (хаалга, цонх, нүх...) элементүүд — амьд, FamilyInstance л.  Нийт тоо `total`-д.</summary>
        internal static List<long> InsertIds(Wall wall, out int total, out bool truncated)
        {
            truncated = false;
            total = 0;
            var ids = new List<long>();
            try
            {
                IList<ElementId> found = wall.FindInserts(true, true, true, true);
                total = found != null ? found.Count : 0;
                if (found == null) return ids;
                foreach (ElementId id in found)
                {
                    Element el = wall.Document.GetElement(id);
                    if (el is FamilyInstance) ids.Add(id.Value);
                    if (ids.Count >= MaxInserts) { truncated = found.Count > MaxInserts; break; }
                }
            }
            catch (Exception) { /* дээр хариуцна — `total = 0` + дуудагч «хост уншигдсангүй» гэж тэмдэглэнэ */ total = -1; }
            return ids;
        }

        /// <summary>
        /// Хананы хоёр тал.  `Index` 0 = байрлалын шугамын зүүн нормаль (−dy, dx), 1 = баруун.  Талын өрөөг ТААМАГЛАХГҮЙ:
        /// хананы 25/50/75% цэгийн хажууд `GetRoomAtPoint`-оор олдсон өрөө л — олдоогүй бол саармаг «A»/«B».
        /// </summary>
        internal static List<WallSideInfo> Sides(Document doc, Wall wall, Line line, double thicknessFt)
        {
            XYZ d = line.Direction;
            var dir0 = new XYZ(-d.Y, d.X, 0).Normalize();
            var sides = new List<WallSideInfo>();
            Phase phase = null;
            try { phase = doc.GetElement(wall.CreatedPhaseId) as Phase; } catch (Exception) { }
            double z = 0;
            try
            {
                Level lv = doc.GetElement(wall.LevelId) as Level;
                if (lv != null) z = lv.Elevation;
                z += PcUnits.ToInternalMm(1000);
            }
            catch (Exception) { }
            double off = thicknessFt / 2 + PcUnits.ToInternalMm(200);

            for (int i = 0; i < 2; i++)
            {
                XYZ n = i == 0 ? dir0 : dir0.Negate();
                var rooms = new List<Autodesk.Revit.DB.Architecture.Room>();
                foreach (double t in new[] { 0.5, 0.25, 0.75 })
                {
                    try
                    {
                        XYZ p = line.Evaluate(t, true);
                        var probe = new XYZ(p.X + n.X * off, p.Y + n.Y * off, z);
                        Autodesk.Revit.DB.Architecture.Room r = phase != null ? doc.GetRoomAtPoint(probe, phase) : doc.GetRoomAtPoint(probe);
                        if (r != null && !rooms.Any(x => x.Id == r.Id)) rooms.Add(r);
                    }
                    catch (Exception) { /* энэ цэг дээр өрөө тодорхойлогдсонгүй — доорх саармаг нэр */ }
                }

                var side = new WallSideInfo { Index = i, DirX = n.X, DirY = n.Y };
                if (rooms.Count > 0)
                {
                    side.RoomId = rooms[0].Id.Value;
                    side.RoomName = RoomLabel(rooms[0]);
                    side.Label = side.RoomName + (rooms.Count > 1 ? " ба бусад" : "") + " тал руу";
                }
                else
                {
                    side.Label = (i == 0 ? "A" : "B") + " тал руу";
                }
                sides.Add(side);
            }
            return sides;
        }

        /// <summary>
        /// Ханатай хамт ӨӨРЧЛӨГДӨХ (хост хаалга/цонх, холбогдсон хөрш хана) элементүүдийн эзэмшил.  Өөр хэрэглэгчид эзэмшигдсэн нь Revit-ийн хөдөлгөөнийг
        /// ТАТГАЛЗАХ нь тодорхой (commit-д алдаа) — preview-д хүлээхгүй, шууд хэлнэ.  `notOwned` = хэнд ч эзэмшигдээгүй (түр эзэмшил үүсч болзошгүй) тоо.
        /// Ажлын багийн биш загварт (0, null).
        /// </summary>
        internal static string DependentOwnership(Document doc, IEnumerable<long> ids, out int notOwned)
        {
            notOwned = 0;
            try
            {
                if (doc == null || !doc.IsWorkshared) return null;
                var foreign = new List<string>();
                foreach (long id in ids)
                {
                    CheckoutStatus st;
                    try { st = WorksharingUtils.GetCheckoutStatus(doc, new ElementId(id)); }
                    catch (Exception) { continue; }
                    if (st == CheckoutStatus.OwnedByOtherUser)
                    {
                        string name = "#" + id;
                        try { Element e = doc.GetElement(new ElementId(id)); if (e != null) name = (e.Category != null ? e.Category.Name : "Элемент") + " #" + id; } catch (Exception) { }
                        foreign.Add(name);
                    }
                    else if (st == CheckoutStatus.NotOwned) notOwned++;
                }
                if (foreign.Count == 0) return null;
                return "Ханатай хамт өөрчлөгдөх " + foreign.Count + " элемент өөр хэрэглэгчид эзэмшигдсэн (" + string.Join(", ", foreign.Take(3)) + (foreign.Count > 3 ? " …" : "") + ") — зөөх боломжгүй.";
            }
            catch (Exception) { return null; }
        }

        internal const string CheckoutAckText = PreChangeText.OwnershipAck;

        internal static string RoomLabel(Autodesk.Revit.DB.Architecture.Room r)
        {
            string name = null, num = null;
            try { Parameter p = r.get_Parameter(BuiltInParameter.ROOM_NAME); if (p != null) name = p.AsString(); } catch (Exception) { }
            try { Parameter p = r.get_Parameter(BuiltInParameter.ROOM_NUMBER); if (p != null) num = p.AsString(); } catch (Exception) { }
            string s = ((name ?? "") + " " + (num ?? "")).Trim();
            return string.IsNullOrEmpty(s) ? "Өрөө #" + r.Id.Value : s;
        }
    }
}
