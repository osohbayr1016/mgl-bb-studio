using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.ChangeImpact.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// Хаалга MVP-д дэмжигдэх эсэхийн дүн.  ⚠️ `Door`, `Host` амьд обьект — ЗӨВХӨН нэг Step/ExternalEvent дотор ашиглана.
    /// `Refused` = Revit энэ хөдөлгөөнийг ХИЙЛГЭХГҮЙ нь тодорхой (Pin, өөр хэрэглэгчийн эзэмшил, зөвхөн унших файл) → «ЗӨӨХГҮЙ» (🔴);
    /// false = зүгээр л шалгах чадваргүй (линк, груп, curtain...) → «ДҮГНЭХ БОЛОМЖГҮЙ» (⚪).
    /// </summary>
    internal sealed class DoorCheck
    {
        public bool Ok;
        public string Problem;
        public bool Refused;
        public bool NeedsCheckoutAck;
        public FamilyInstance Door;
        public Wall Host;
        public Line HostLine;
        public double HostThicknessFt;
        public List<string> Warnings = new List<string>();
    }

    /// <summary>
    /// «Хаалга зөөх» MVP-ийн ДЭМЖЛЭГ.
    ///
    /// ДЭМЖИГДЭХ: ердийн (Basic) шулуун босоо хананд хостлогдсон НЭГ архитектурын хаалга (FamilyInstance, Doors) — түгжигдээгүй, группгүй, nested биш,
    /// design option-гүй, байрлалын цэгтэй, линк биш.
    /// ТАТГАЛЗАХ (ЯАГААД-тай, Монголоор): линк загварын хаалга, Curtain Wall самбар/хаалга, Stacked/нумант/налуу хост, хостгүй/буруу хост, группийн гишүүн, nested,
    /// design option, байрлалгүй, Pin, зөвхөн унших файл, өөр хэрэглэгчид эзэмшигдсэн (хаалга эсвэл хост хана).
    /// «Буруу байж болох simulation» хийхээсээ илүү ил татгалзана.
    /// </summary>
    internal static class PreChangeDoorRules
    {
        internal static DoorCheck Check(Document doc, Element e)
        {
            var res = new DoorCheck();
            if (doc == null) { res.Problem = "Идэвхтэй баримт алга."; return res; }
            if (doc.IsFamilyDocument) { res.Problem = "Family файлд ажиллахгүй — зөвхөн төслийн (project) файлд."; return res; }
            if (e == null || !e.IsValidObject) { res.Problem = "Хаалга олдсонгүй (устсан байж болзошгүй)."; return res; }
            if (e is RevitLinkInstance) { res.Problem = "Линк загварын доторх хаалгыг энд зөөх боломжгүй — линк файлаа нээж шалгана уу."; return res; }
            if (e is Panel) { res.Problem = "Curtain Wall-ийн самбар/хаалга MVP-д дэмжигдээгүй."; return res; }

            var door = e as FamilyInstance;
            if (door == null || door.Category == null || door.Category.Id.Value != (long)BuiltInCategory.OST_Doors)
            {
                res.Problem = "Зөвхөн хаалга (Doors) дэмжигдэнэ — «" + SafeCategory(e) + "» биш.";
                return res;
            }

            try
            {
                if (doc.IsReadOnly) { res.Problem = "Файл зөвхөн унших горимд байна (read-only) — хөдөлгөөнийг шалгах боломжгүй."; res.Refused = true; return res; }

                if (door.SuperComponent != null) { res.Problem = "Өөр family-ийн дотор nested байгаа хаалга — MVP-д дэмжигдээгүй."; return res; }
                if (door.GroupId != null && door.GroupId != ElementId.InvalidElementId) { res.Problem = "Группийн гишүүн хаалга — группээ засварлах горимд нээж шалгана уу (MVP-д дэмжигдээгүй)."; return res; }
                if (door.DesignOption != null) { res.Problem = "Design option доторх хаалга — MVP-д дэмжигдээгүй (өрөө, харагдац сонгосон option-оос хамаарна)."; return res; }
                if (door.Pinned) { res.Problem = "Хаалга түгжигдсэн (Pin) байна — эхлээд Unpin хийнэ үү."; res.Refused = true; return res; }

                var lp = door.Location as LocationPoint;
                if (lp == null || lp.Point == null) { res.Problem = "Хаалганы байрлал (location point) олдсонгүй — энэ төрлийн хаалгыг зөөх боломжгүй."; return res; }

                Element hostEl = null;
                try { hostEl = door.Host; } catch (Exception) { }
                if (hostEl == null) { res.Problem = "Хаалганы хост (хана) уншигдсангүй — хостгүй/чөлөөт хаалгыг MVP-д дэмжихгүй."; return res; }
                var host = hostEl as Wall;
                if (host == null) { res.Problem = "Хаалганы хост нь хана биш («" + SafeCategory(hostEl) + "») — MVP-д зөвхөн хананы хаалга."; return res; }

                WallType wt = host.WallType;
                if (wt != null)
                {
                    if (wt.Kind == WallKind.Curtain) { res.Problem = "Curtain Wall дээрх хаалганы нөлөөллийн шалгалт MVP-д хараахан дэмжигдээгүй."; return res; }
                    if (wt.Kind == WallKind.Stacked) { res.Problem = "Stacked Wall дээрх хаалга — MVP-д дэмжигдээгүй."; return res; }
                }
                if (host.IsStackedWallMember) { res.Problem = "Stacked Wall-ийн гишүүн хана дээрх хаалга — MVP-д дэмжигдээгүй."; return res; }

                var lc = host.Location as LocationCurve;
                var line = lc != null ? lc.Curve as Line : null;
                if (line == null) { res.Problem = "Хост хана нумант (муруй) — MVP-д зөвхөн шулуун хананы хаалга."; return res; }
                if (line.Length <= 1e-6) { res.Problem = "Хост ханын урт 0 байна."; return res; }
                if (Math.Abs(line.Direction.Z) > 1e-6) { res.Problem = "Хост хана налуу — MVP-д зөвхөн босоо хананы хаалга."; return res; }

                if (doc.IsWorkshared)
                {
                    foreach (Element el in new[] { (Element)door, host })
                    {
                        CheckoutStatus st = WorksharingUtils.GetCheckoutStatus(doc, el.Id);
                        string who = el == (Element)door ? "Хаалга" : "Хост хана";
                        if (st == CheckoutStatus.OwnedByOtherUser)
                        {
                            string owner = null;
                            try { owner = WorksharingUtils.GetWorksharingTooltipInfo(doc, el.Id).Owner; } catch (Exception) { }
                            res.Problem = who + " өөр хэрэглэгчид эзэмшигдсэн" + (string.IsNullOrEmpty(owner) ? "" : " (" + owner + ")") + " — засах боломжгүй.";
                            res.Refused = true;
                            return res;
                        }
                        // «Эзэмшигдээгүй»: preview нь түр транзакц нээдэг тул Revit автоматаар checkout хийж болзошгүй, rollback нь эзэмшлийг ЧӨЛӨӨЛДӨГГҮЙ.
                        // Чимээгүй авахгүй — UI эхлээд асууна.  ⚠️ `GetCheckoutStatus` нь кэштэй төлөв — «засах боломжтой» гэдгийн баталгаа БИШ.
                        if (st == CheckoutStatus.NotOwned) res.NeedsCheckoutAck = true;
                    }
                }

                res.Door = door;
                res.Host = host;
                res.HostLine = line;
                res.HostThicknessFt = host.Width;
                res.Ok = true;
                return res;
            }
            catch (Exception ex)
            {
                res.Ok = false;
                res.Problem = "Хаалгыг шалгаж чадсангүй (" + ex.GetType().Name + ").";
                return res;
            }
        }

        /* ============================== УНШИХ (хэмжээ, нэр) ================= */

        internal static string SafeCategory(Element e)
        {
            try { return e.Category != null ? e.Category.Name : e.GetType().Name; }
            catch (Exception) { return "элемент"; }
        }

        /// <summary>Хаалганы Mark (тэмдэглэгээ): «D-120».  Хоосон бол null.</summary>
        internal static string MarkOf(Element e)
        {
            try
            {
                Parameter p = e.get_Parameter(BuiltInParameter.ALL_MODEL_MARK);
                string s = p != null ? p.AsString() : null;
                return string.IsNullOrWhiteSpace(s) ? null : s.Trim();
            }
            catch (Exception) { return null; }
        }

        internal static string TypeNameOf(FamilyInstance fi)
        {
            try { return fi.Symbol != null ? fi.Symbol.FamilyName + " : " + fi.Symbol.Name : fi.Name; }
            catch (Exception) { return null; }
        }

        /// <summary>Хаалганы товч нэр: Mark байвал «D-120», үгүй бол төрлийн нэр + #id.</summary>
        internal static string LabelOf(FamilyInstance fi)
        {
            string mark = MarkOf(fi);
            if (mark != null) return mark;
            string t = null;
            try { t = fi.Symbol != null ? fi.Symbol.Name : null; } catch (Exception) { }
            return (string.IsNullOrEmpty(t) ? "Хаалга" : t) + " · #" + fi.Id.Value;
        }

        /// <summary>
        /// Параметрийн утга (мм) — эхлээд ЭЛЕМЕНТ (instance), дараа нь ТӨРӨЛ (type).  Тоон, утгатай, &gt; 0 л.  Олдохгүй бол null.
        /// </summary>
        internal static double? ParamMm(FamilyInstance fi, params BuiltInParameter[] bips)
        {
            foreach (BuiltInParameter bip in bips)
            {
                double? v = ReadMm(fi, bip);
                if (v.HasValue) return v;
                try
                {
                    Element type = fi.Document.GetElement(fi.GetTypeId());
                    if (type != null)
                    {
                        v = ReadMm(type, bip);
                        if (v.HasValue) return v;
                    }
                }
                catch (Exception) { }
            }
            return null;
        }

        private static double? ReadMm(Element e, BuiltInParameter bip)
        {
            try
            {
                Parameter p = e.get_Parameter(bip);
                if (p == null || !p.HasValue || p.StorageType != StorageType.Double) return null;
                double v = p.AsDouble();
                if (v <= 1e-9 || double.IsNaN(v) || double.IsInfinity(v)) return null;
                return PcUnits.Mm(v);
            }
            catch (Exception) { return null; }
        }

        /// <summary>
        /// Нүхний өргөн (мм).  ЭХЭНД «Rough Width» (хананд хийгдэх нүхний бодит хэмжээ), дараа нь «Width».  Параметр олдохгүй бол bbox-ийн ХОСТЫН дагуух өргөн
        /// (хүрээ орно — ОЙРОЛЦООЛОН, `WidthSource.BBox`).  Юу ч олдохгүй бол `Unknown` — 0 БИШ.
        /// </summary>
        internal static double ReadWidthMm(FamilyInstance fi, HostGeometry host, out WidthSource source)
        {
            double? w = ParamMm(fi, BuiltInParameter.FAMILY_ROUGH_WIDTH_PARAM, BuiltInParameter.DOOR_WIDTH, BuiltInParameter.FAMILY_WIDTH_PARAM);
            if (w.HasValue) { source = WidthSource.Parameter; return w.Value; }
            double[] b = ReadBoxMm(fi);
            if (b != null && host != null)
            {
                double[] lb = DoorSweep.LocalBox(host, b);
                if (lb != null && lb[3] - lb[0] > 1) { source = WidthSource.BBox; return lb[3] - lb[0]; }
            }
            source = WidthSource.Unknown;
            return 0;
        }

        internal static double ReadHeightMm(FamilyInstance fi)
        {
            double? h = ParamMm(fi, BuiltInParameter.FAMILY_ROUGH_HEIGHT_PARAM, BuiltInParameter.DOOR_HEIGHT, BuiltInParameter.FAMILY_HEIGHT_PARAM);
            if (h.HasValue) return h.Value;
            double[] b = ReadBoxMm(fi);
            return b != null ? Math.Abs(b[5] - b[2]) : 0;
        }

        /// <summary>Элементийн bounding box (мм, AABB, загварын координат): [minX,minY,minZ,maxX,maxY,maxZ].  Уншигдахгүй бол null.</summary>
        internal static double[] ReadBoxMm(Element e)
        {
            try
            {
                BoundingBoxXYZ bb = e.get_BoundingBox(null);
                if (bb == null) return null;
                return new[] { PcUnits.Mm(bb.Min.X), PcUnits.Mm(bb.Min.Y), PcUnits.Mm(bb.Min.Z), PcUnits.Mm(bb.Max.X), PcUnits.Mm(bb.Max.Y), PcUnits.Mm(bb.Max.Z) };
            }
            catch (Exception) { return null; }
        }

        /// <summary>Хаалганы хоёр талын өрөө (уншигдсан л бол).  Фазаас хамаарна — Revit-ийн `FromRoom/ToRoom`.</summary>
        internal static void ReadRooms(FamilyInstance fi, out long fromId, out long toId, out string fromName, out string toName, out bool readable)
        {
            fromId = toId = 0;
            fromName = toName = null;
            try
            {
                Autodesk.Revit.DB.Architecture.Room from = fi.FromRoom, to = fi.ToRoom;
                fromId = from != null ? from.Id.Value : 0;
                toId = to != null ? to.Id.Value : 0;
                fromName = from != null ? PreChangeWallRules.RoomLabel(from) : null;
                toName = to != null ? PreChangeWallRules.RoomLabel(to) : null;
                readable = true;
            }
            catch (Exception) { readable = false; }
        }
    }
}
