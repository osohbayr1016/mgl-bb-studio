using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// ТӨСЛИЙН өөрийн дотор дэлгээсийн стандарт — оффисын аль хэдийн гараар хийсэн «өрөөний дэлгээсийн хуудас»-аас суралцана.
    /// ХЭМЖСЭН (GATEWAY, 2026-10-07): өрөөний хуудас БА413–БА423 = 1 план + 1 3D + 4–8 дэлгээс («4.2. Дотор Дэлгээс + Нүүр тал»,
    /// template «А.З - 4.2 … дэлгээс», 1:50, viewport «Гарчиг - Доогуур зураас», A2 «Булангын_хүснэгт…:Стандарт»).  Шилэн ханын хуудас
    /// (БА606–БА618, мөн план + дэлгээс) нь ялгаатай — тэдний дэлгээс 3+ ӨӨР чиглэлд хардаггүй.  Тиймээс «өрөөний хуудас» = ≤ 15 м өргөн
    /// дэлгээс ≥ 3, тэд ≥ 3 өөр чиглэлд, ≥ 1 давхрын план.  Олдохгүй бол <see cref="Found"/> = false — хэрэгслийн өөрийн өгөгдмөл.
    /// </summary>
    internal sealed class WeProjectStandards
    {
        public bool Found;
        public ViewFamilyType ElevationType;
        public View ElevationTemplate;
        public ViewFamilyType PlanType;
        public View PlanTemplate;
        public ViewFamilyType ThreeDType;
        public View ThreeDTemplate;
        public ElementId ViewportType = ElementId.InvalidElementId;
        public string ViewportTypeName;
        public FamilySymbol TitleBlock;
        public int Scale;
        /// <summary>Оффисын түлхүүр планы баруун чиглэл (crop эргүүлсэн бол); null = хойд дээш (эргэлтгүй).</summary>
        public XYZ KeyPlanRight;
        /// <summary>
        /// Viewport-ийн гарчиг зургийн ДЭЭР (оффисын хуудас БА414: LabelOffset.Y = хүрээний өндөр + 3–35 мм; жишээ хуудас 206A ч дээр).
        /// Гарчгийн доод талын (өгөгдмөл) байрлал = LabelOffset.Y ≈ 0 эсвэл сөрөг.
        /// ⚠️ ХЭМЖСЭН (GATEWAY, 2026-10-07): <c>Viewport.LabelOffset</c>-ийг унших нь тэр хуудсыг БҮХЭЛД нь дахин тооцуулдаг — 33 хуудасны
        /// 285 viewport = 33 с (хуудас тутам ≈ 1 с), цонх гарахаас өмнөх «нөөц» 11.5 с-ийн бараг бүгд.  Тиймээс суралцахдаа уншихгүй;
        /// хуудас байрлуулах үед (<see cref="LabelAboveFor"/>) ЗӨВХӨН хамгийн сүүлийн нэг өрөөний хуудсыг түүвэрлэж, Revit-ийн сессийн
        /// турш кэшилнэ.
        /// </summary>
        public bool LabelAboveFor(Document doc)
        {
            if (_labelAbove.HasValue) return _labelAbove.Value;
            _labelAbove = false;
            if (!Found || _labelSample == ElementId.InvalidElementId) return false;
            string key;
            try { key = (doc.PathName ?? string.Empty) + "|" + doc.Title + "|" + _labelSample.Value.ToString(CultureInfo.InvariantCulture); }
            catch { key = null; }
            bool cached;
            lock (LabelCache)
            {
                if (key != null && LabelCache.TryGetValue(key, out cached)) return (_labelAbove = cached).Value;
            }
            int above = 0, labels = 0;
            using (WeProf.T("standards.labelSample"))
            try
            {
                var sheet = doc.GetElement(_labelSample) as ViewSheet;
                if (sheet != null)
                    foreach (ElementId id in sheet.GetAllViewports())
                    {
                        var vp = doc.GetElement(id) as Viewport;
                        if (vp == null) continue;
                        try { labels++; if (vp.LabelOffset.Y > 30 / 304.8) above++; } catch { }
                    }
            }
            catch (Exception ex) { WeLog.Error("standards", "гарчгийн байрлал", ex); }
            _labelAbove = labels > 0 && above * 2 > labels;
            if (key != null) lock (LabelCache) LabelCache[key] = _labelAbove.Value;
            return _labelAbove.Value;
        }

        private bool? _labelAbove;
        /// <summary>Гарчгийн байрлалын түүвэр — хамгийн их дугаартай (хамгийн сүүлд хийсэн) өрөөний хуудас.</summary>
        private ElementId _labelSample = ElementId.InvalidElementId;
        private static readonly Dictionary<string, bool> LabelCache = new Dictionary<string, bool>(StringComparer.Ordinal);
        /// <summary>Хуудасны дугаарын угтвар («БА»), цувааны дараагийн тоо (дугаарыг ашиглахдаа <see cref="NextSheetNumber"/>).</summary>
        public string SheetPrefix;
        public int SheetSeriesMax;
        public int SheetDigits;
        public readonly List<string> SourceSheets = new List<string>();
        /// <summary>Оффисын өрөөний дэлгээсийн хуудсууд (id) — шинэ хуудсыг тэдний Project Browser-ийн бүлэгт оруулах анхны утга.</summary>
        public readonly List<long> RoomSheetIds = new List<long>();

        private const double MaxElevationWidthFt = 15000 / 304.8;

        public static WeProjectStandards Learn(Document doc)
        {
            var r = new WeProjectStandards();
            try { LearnCore(doc, r); }
            catch (Exception ex) { WeLog.Error("standards", "Төслийн стандартыг уншиж чадсангүй", ex); r.Found = false; }
            return r;
        }

        private static void LearnCore(Document doc, WeProjectStandards r)
        {
            var bySheet = new Dictionary<long, List<Viewport>>();
            foreach (Viewport vp in new FilteredElementCollector(doc).OfClass(typeof(Viewport)).Cast<Viewport>())
            {
                List<Viewport> l;
                if (!bySheet.TryGetValue(vp.SheetId.Value, out l)) bySheet[vp.SheetId.Value] = l = new List<Viewport>();
                l.Add(vp);
            }
            // Маркер → харагдац (өрөөний хуудсанд нэг маркер 2+ дэлгээстэй; шилэн ханын хуудсанд дэлгээс бүр өөрийн маркертай).
            var markerOf = new Dictionary<long, long>();
            foreach (ElevationMarker mk in new FilteredElementCollector(doc).OfClass(typeof(ElevationMarker)).Cast<ElevationMarker>())
                for (int i = 0; i < 4; i++)
                {
                    ElementId vid;
                    try { vid = mk.GetViewId(i); } catch { continue; }
                    if (vid != ElementId.InvalidElementId) markerOf[vid.Value] = mk.Id.Value;
                }
            var roomSheets = new List<long>();
            var elevs = new List<View>();
            var plans = new List<View>();
            var threeDs = new List<View>();
            var vpTypes = new List<long>();
            foreach (KeyValuePair<long, List<Viewport>> kv in bySheet)
            {
                var views = kv.Value.Select(v => doc.GetElement(v.ViewId) as View).Where(v => v != null && !v.IsTemplate).ToList();
                List<View> e = views.Where(v => v.ViewType == ViewType.Elevation && CropWidth(v) <= MaxElevationWidthFt).ToList();
                if (e.Count < 3 || !views.Any(v => v.ViewType == ViewType.FloorPlan)) continue;
                int dirs = e.Select(v => DirKey(v.ViewDirection)).Distinct().Count();
                if (dirs < 3) continue;
                // ХЭМЖСЭН (GATEWAY): өрөөний хуудас — маркер < дэлгээс, дэлгээсүүд ≤ 8.3 м дотор; шилэн ханын хуудас — маркер = дэлгээс
                // эсвэл 15–41 м тархсан.
                bool shared = e.Select(v => { long m; return markerOf.TryGetValue(v.Id.Value, out m) ? m : -v.Id.Value; }).Distinct().Count() < e.Count;
                if (!shared || Spread(e) > MaxRoomSpreadFt) continue;
                roomSheets.Add(kv.Key);
                elevs.AddRange(e);
                plans.AddRange(views.Where(v => v.ViewType == ViewType.FloorPlan));
                threeDs.AddRange(views.Where(v => v.ViewType == ViewType.ThreeD));
                vpTypes.AddRange(kv.Value.Select(v => v.GetTypeId().Value));
            }
            if (roomSheets.Count == 0) return;
            r.Found = true;
            r.RoomSheetIds.AddRange(roomSheets);

            r.ElevationType = doc.GetElement(new ElementId(Mode(elevs.Select(v => v.GetTypeId().Value)))) as ViewFamilyType;
            List<View> ofType = elevs.Where(v => r.ElevationType != null && v.GetTypeId() == r.ElevationType.Id).ToList();
            r.ElevationTemplate = TemplateMode(doc, ofType);
            r.Scale = (int)Mode(ofType.Select(v => (long)v.Scale));
            if (plans.Count > 0)
            {
                r.PlanType = doc.GetElement(new ElementId(Mode(plans.Select(v => v.GetTypeId().Value)))) as ViewFamilyType;
                r.PlanTemplate = TemplateMode(doc, plans);
                // Түлхүүр планы эргэлт — ХЭМЖСЭН (MITIC 2F, 2026-10-08): ИЗД1_A2_28…64-ийн 41 түлхүүр план бүгд right = (0,1,0) (crop 90° эргүүлсэн,
                // тэнхлэг Y босоо); олонх нь эргүүлсэн бол манай түлхүүр план ч ижил.
                var rights = plans.Select(v => { try { return v.RightDirection; } catch { return null; } }).Where(d => d != null).ToList();
                if (rights.Count > 0)
                {
                    string key = rights.GroupBy(d => DirKey(d)).OrderByDescending(g => g.Count()).ThenBy(g => g.Key, StringComparer.Ordinal).First().Key;
                    XYZ right = rights.First(d => DirKey(d) == key);
                    if (right.IsAlmostEqualTo(XYZ.BasisX, 1e-3) == false) r.KeyPlanRight = new XYZ(right.X, right.Y, 0).Normalize();
                }
            }
            if (threeDs.Count > 0)
            {
                r.ThreeDType = doc.GetElement(new ElementId(Mode(threeDs.Select(v => v.GetTypeId().Value)))) as ViewFamilyType;
                r.ThreeDTemplate = TemplateMode(doc, threeDs);
            }
            if (vpTypes.Count > 0)
            {
                r.ViewportType = new ElementId(Mode(vpTypes));
                Element vt = doc.GetElement(r.ViewportType);
                r.ViewportTypeName = vt != null ? vt.Name : null;
                if (vt == null) r.ViewportType = ElementId.InvalidElementId;
            }

            var sheetSet = new HashSet<long>(roomSheets);
            var tbs = new List<long>();
            foreach (FamilyInstance fi in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_TitleBlocks).WhereElementIsNotElementType().OfType<FamilyInstance>())
                if (sheetSet.Contains(fi.OwnerViewId.Value)) tbs.Add(fi.Symbol.Id.Value);
            if (tbs.Count > 0) r.TitleBlock = doc.GetElement(new ElementId(Mode(tbs))) as FamilySymbol;

            // Хуудасны дугаар: «БА413» → угтвар «БА», тоо 413.  Цуваа = ижил угтвар, ижил зуут (4xx).
            var parsed = new List<KeyValuePair<string, int>>();
            int digits = 0;
            foreach (long id in roomSheets)
            {
                var sh = doc.GetElement(new ElementId(id)) as ViewSheet;
                if (sh == null) continue;
                r.SourceSheets.Add(sh.SheetNumber);
                string prefix; int n, d;
                if (SplitNumber(sh.SheetNumber, out prefix, out n, out d)) { parsed.Add(new KeyValuePair<string, int>(prefix, n)); digits = Math.Max(digits, d); }
            }
            r.SourceSheets.Sort(StringComparer.Ordinal);
            // Гарчгийн байрлалын түүвэр: хамгийн сүүлийн (их дугаартай) өрөөний хуудас.
            long sample = roomSheets.Select(id => doc.GetElement(new ElementId(id)) as ViewSheet).Where(s => s != null)
                .OrderByDescending(s => s.SheetNumber, StringComparer.Ordinal).Select(s => s.Id.Value).FirstOrDefault();
            if (sample != 0) r._labelSample = new ElementId(sample);
            try { LearnNames(doc, roomSheets, r); }
            catch (Exception ex) { WeLog.Error("standards", "хуудасны нэрийн загвар", ex); }
            if (parsed.Count > 0)
            {
                string prefix = parsed.GroupBy(p => p.Key).OrderByDescending(g => g.Count()).ThenBy(g => g.Key, StringComparer.Ordinal).First().Key;
                int maxN = parsed.Where(p => p.Key == prefix).Max(p => p.Value);
                int hundred = maxN / 100;
                // Тухайн цувааны (4xx) ХАМГИЙН их дугаар — бүх хуудсаас (өрөөний хуудасны дараа өөр төрлийн хуудас байж болно).
                foreach (ViewSheet sh in new FilteredElementCollector(doc).OfClass(typeof(ViewSheet)).Cast<ViewSheet>())
                {
                    string pf; int n, d;
                    if (SplitNumber(sh.SheetNumber, out pf, out n, out d) && pf == prefix && n / 100 == hundred) maxN = Math.Max(maxN, n);
                }
                r.SheetPrefix = prefix;
                r.SheetSeriesMax = maxN;
                r.SheetDigits = digits;
            }
        }

        /// <summary>Дараагийн чөлөөт дугаар («БА428») — <paramref name="taken"/>-д нэмнэ.  Цувааны угтвар олдоогүй бол null.</summary>
        public string NextSheetNumber(ISet<string> taken)
        {
            if (string.IsNullOrEmpty(SheetPrefix)) return null;
            for (int n = SheetSeriesMax + 1; n < SheetSeriesMax + 1000; n++)
            {
                string s = SheetPrefix + n.ToString(CultureInfo.InvariantCulture).PadLeft(SheetDigits, '0');
                if (taken.Contains(s)) continue;
                SheetSeriesMax = n;   // дуудагч taken-д нэмнэ (хуудсанд онооход)
                return s;
            }
            return null;
        }

        /// <summary>Тайлан, цонхонд: «БА413, БА414 … хуудаснаас: 4.2. Дотор Дэлгээс + Нүүр тал, …».</summary>
        public string Summary()
        {
            if (!Found) return string.Empty;
            var parts = new List<string>();
            if (ElevationType != null) parts.Add("төрөл «" + ElevationType.Name + "»");
            if (ElevationTemplate != null) parts.Add("template «" + ElevationTemplate.Name + "»");
            if (Scale > 0) parts.Add("1:" + Scale.ToString(CultureInfo.InvariantCulture));
            if (TitleBlock != null) parts.Add("хүрээ «" + TitleBlock.FamilyName + " : " + TitleBlock.Name + "»");
            if (!string.IsNullOrEmpty(ViewportTypeName)) parts.Add("гарчиг «" + ViewportTypeName + "»");
            string src = SourceSheets.Count <= 4 ? string.Join(", ", SourceSheets) : string.Join(", ", SourceSheets.Take(3)) + " … " + SourceSheets.Last();
            return "Төслийн дотор дэлгээсийн хуудаснаас (" + src + ") суралцсан: " + string.Join(", ", parts) + ".";
        }

        internal static bool SplitNumber(string s, out string prefix, out int n, out int digits)
        {
            return Core.WeNaming.SplitSheetNumber(s, out prefix, out n, out digits);
        }

        /// <summary>Энэ давхрын (host түвшин) өрөөний хуудасны бүсийн бичвэр («A BLOCK 2-Р ДАВХАР»); суралцаагүй бол null.</summary>
        public string ZoneFor(long hostLevelId)
        {
            string z;
            return ZoneByLevel.TryGetValue(hostLevelId, out z) ? z : null;
        }

        /// <summary>Хуудасны нэрийн бүс — давхар тус бүрд (өрөөний хуудсан дээрх планы түвшнээр), олонх нь.</summary>
        public readonly Dictionary<long, string> ZoneByLevel = new Dictionary<long, string>();
        /// <summary>Өрөөний дугаарын дараах тусгаарлагч — хамгийн сүүлийн хуудсуудын олонх («218 АЦӨ …» → зай).</summary>
        public string RoomSeparator = " ";

        /// <summary>Хуудасны нэрнээс бүс, тусгаарлагчийг сурна (нэр задлагдахгүй хуудсыг алгасна).</summary>
        private static void LearnNames(Document doc, List<long> roomSheets, WeProjectStandards r)
        {
            var zones = new Dictionary<long, List<string>>();
            var seps = new List<KeyValuePair<int, string>>();
            foreach (long id in roomSheets)
            {
                var sh = doc.GetElement(new ElementId(id)) as ViewSheet;
                if (sh == null) continue;
                string sep, zone;
                if (!Core.WeNaming.TryParseRoomSheetName(sh.Name, out sep, out zone)) continue;
                string pf; int n, d;
                seps.Add(new KeyValuePair<int, string>(SplitNumber(sh.SheetNumber, out pf, out n, out d) ? n : 0, sep));
                foreach (ElementId vid in sh.GetAllPlacedViews())
                {
                    var plan = doc.GetElement(vid) as ViewPlan;
                    if (plan == null || plan.IsTemplate || plan.ViewType != ViewType.FloorPlan || plan.GenLevel == null) continue;
                    List<string> l;
                    if (!zones.TryGetValue(plan.GenLevel.Id.Value, out l)) zones[plan.GenLevel.Id.Value] = l = new List<string>();
                    l.Add(zone.ToUpper(CultureInfo.InvariantCulture));
                }
            }
            foreach (KeyValuePair<long, List<string>> kv in zones)
                r.ZoneByLevel[kv.Key] = kv.Value.GroupBy(z => z).OrderByDescending(g => g.Count()).ThenBy(g => g.Key, StringComparer.Ordinal).First().Key;
            if (seps.Count > 0)
                r.RoomSeparator = seps.OrderByDescending(p => p.Key).Take(10).GroupBy(p => p.Value)
                                      .OrderByDescending(g => g.Count()).ThenBy(g => g.Key, StringComparer.Ordinal).First().Key;
        }

        private const double MaxRoomSpreadFt = 12000 / 304.8;

        private static double Spread(List<View> views)
        {
            var pts = new List<XYZ>();
            foreach (View v in views)
            {
                try { BoundingBoxXYZ cb = v.CropBox; XYZ c = cb.Transform.OfPoint((cb.Min + cb.Max) * 0.5); pts.Add(new XYZ(c.X, c.Y, 0)); } catch { }
            }
            double d = 0;
            for (int i = 0; i < pts.Count; i++) for (int j = i + 1; j < pts.Count; j++) d = Math.Max(d, pts[i].DistanceTo(pts[j]));
            return d;
        }

        private static double CropWidth(View v)
        {
            try { BoundingBoxXYZ cb = v.CropBox; return cb == null ? double.MaxValue : Math.Abs(cb.Max.X - cb.Min.X); }
            catch { return double.MaxValue; }
        }

        private static string DirKey(XYZ d)
        {
            return Math.Round(d.X, 2).ToString(CultureInfo.InvariantCulture) + "," + Math.Round(d.Y, 2).ToString(CultureInfo.InvariantCulture);
        }

        private static long Mode(IEnumerable<long> xs)
        {
            return xs.GroupBy(x => x).OrderByDescending(g => g.Count()).ThenBy(g => g.Key).Select(g => g.Key).FirstOrDefault();
        }

        private static View TemplateMode(Document doc, List<View> views)
        {
            List<long> t = views.Where(v => v.ViewTemplateId != ElementId.InvalidElementId).Select(v => v.ViewTemplateId.Value).ToList();
            if (t.Count == 0) return null;
            return doc.GetElement(new ElementId(Mode(t))) as View;
        }
    }
}
