using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using RevitMcpAddin.AutoAnnotate.Core;
using RevitMcpAddin.Reinforcement;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.AutoAnnotate
{
    /// <summary>
    /// АРМАТУРЫН горим (2026-10-05): «Хэмжээс, тэмдэглэгээ» хэрэгсэлд «Огтлолын арматурын тэмдэглэгээ»-ний бүх ажил (хомутын гинжин хэмжээс +
    /// ажлын/хомутын шошго) ба арматурын ДЭЛГЭЭС (ажлын арматурын шошго, хомутын MRA, давхцлын хэмжээс, тэнхлэгийн гинж) орсон.
    /// «Загвар харагдацаас хуулах» орохгүй (тэр нь «Огтлолын тэмдэглэгээ» хэрэгсэлд хэвээр).
    ///
    /// Шошгоны зай: ЗӨВХӨН энд хэрэглэгчийн оруулсан мм (<see cref="TagGapMm"/>, <see cref="TagOffsetMm"/>) — хэрэгсэл өөрөөсөө зай нэмэхгүй.
    /// </summary>
    public sealed class AaRebarOptions
    {
        /// <summary>Харагдацад арматурын дам нуруу олдвол арматурын горимоор ажиллах.</summary>
        public bool Enabled { get; set; } = true;

        /// <summary>Арматурын зураг дээр ерөнхий (тэнхлэг, түвшин, tag) хэмжээсийг ч тавих (анхдагч үгүй — давхардуулахгүй).</summary>
        public bool AlsoGeneral { get; set; } = false;

        // ── Огтлол
        public bool SecDims { get; set; } = true;
        public bool SecTagLong { get; set; } = true;
        public bool SecTagStirrups { get; set; } = true;
        public bool SecGroupTags { get; set; } = true;

        /// <summary>outer | inner | center — инженерийн «30 | 240 | 30» нь хомутын ДОТОР ирмэг.</summary>
        public string StirrupRef { get; set; } = "inner";

        public bool Left { get; set; } = true;
        public bool Right { get; set; } = true;
        public bool Top { get; set; } = true;
        public bool Bottom { get; set; } = true;
        public double SecDimOffsetMm { get; set; } = 10;

        /// <summary>
        /// Огтлолын «Байрлал» (2026-10-09, R2.pdf — ерөнхий хэмжээсийн «Байрлал»-тай ИЖИЛ): true = 4 талд (хэвтээ гинж дээр+доор, босоо зүүн+баруун),
        /// false = зөвхөн зүүн ба доод талд.  Хомутын гинж + гишүүний гадна гинж хоёулаа.
        /// </summary>
        public bool SecAllSides { get; set; } = false;
        /// <summary>«Зөвхөн баруун ба доод талд» (2026-10-12): <see cref="SecAllSides"/> = false үед босоо гинж баруун талд.</summary>
        public bool SecRightSide { get; set; } = false;

        /// <summary>
        /// Дэлгээс: хэмжээсийн шугам гишүүнээс үүнээс ойр биш (цаасан мм; 0 = хязгааргүй).  Ерөнхий «Байрлал»-ын «эхний гинж»-ээс
        /// <see cref="AaOptions.ApplyPlacement"/> бичнэ (2026-10-12, t1.pdf).
        /// </summary>
        public double ElevDimFirstMm { get; set; } = 0;

        /// <summary>Баганын дэлгээс: хэмжээс харагдацын ЗҮҮН талд («Зөвхөн зүүн ба доод талд»).  false = баруун.  <see cref="AaOptions.ApplyPlacement"/> бичнэ.</summary>
        public bool ElevColumnLeft { get; set; } = false;

        /// <summary>Огтлолын «гинж хооронд» (цаасан мм): хомутын гинжээс гадна гинж хүртэл.  Өмнө нь дэлгээсийн «эгнээ хоорондын зай»-г хуваалцдаг байв.</summary>
        public double SecStepMm { get; set; } = 8;

        /// <summary>ХУУЧИРСАН (зөвхөн 1.33.0-ийн JSON нийцэл): тал тус бүр сонгох радио «Байрлал»-аар солигдсон — хэн ч уншихгүй.</summary>
        public string SecHDimSide { get; set; } = "bottom";
        public string SecVDimSide { get; set; } = "left";

        // ── Дэлгээс
        public bool ElevTagBars { get; set; } = true;
        public bool ElevMra { get; set; } = true;
        public bool ElevLaps { get; set; } = true;
        public bool ElevSpans { get; set; } = true;

        /// <summary>
        /// ХАСАГДСАН (2026-10-09, эзэн: «дам нурууны дэлгээс дээр давхцсан хэсэгт үргэлжилсэн уртаар хэмжээс тавихаа болъё»).
        /// Дэлгээсийн «A | давхцал | B» гинж ҮРГЭЛЖ унтраалттай — чагт хасагдсан, энэ утгыг хэн ч уншихгүй.  Хуучин auto-annotate.json-д
        /// <c>true</c> хадгалагдсан ч нөлөөгүй; шинж нь зөвхөн JSON нийцлийн төлөө үлдсэн.  Хана/хучилтын гинж (<c>AaWallSlab.LapChain</c>) ХЭВЭЭР.
        /// </summary>
        public bool ElevLapChain { get; set; } = false;

        /// <summary>
        /// Огтлол: дам нуруу/баганын ХЭМЖЭЭГ тэнхлэг, хучилт (шал), ханатай уялдуулсан гадна гинж — «150 | 150» (нүүр | тэнхлэг | нүүр), «170 | 330»
        /// (дээд нүүр | хучилтын доод | доод нүүр).  Хомутын «30 | 240 | 30» гинжний ГАДНА эгнээнд (2026-10-08, эзний хүсэлт — «Түргэн» табд чагт).
        /// </summary>
        public bool SecMemberDims { get; set; } = true;

        /// <summary>
        /// Арматурын олонлог (Rebar set — олон ширхэгтэй НЭГ элемент) бүрд ЯГ НЭГ шошго (ширхэг бүрд биш).  Огтлолд олонлогийн захын ширхгүүд өөр талд ойр
        /// харагдаж ИЖИЛ олонлогийг 2–3 шошго болгодог байсныг засна; дэлгээсэд олонлог аль хэдийн нэг шошготой.  Унтраавал өмнөх зан төлөв.
        /// </summary>
        public bool SingleTagPerSet { get; set; } = true;

        /// <summary>
        /// «Багцыг нэг шошгоор» үед нэг шошго багцын БҮХ харагдаж буй ширхэг рүү leader татна (multi-leader).  Унтраавал нэг шошго нэг ширхэг рүү л заана.
        /// </summary>
        public bool MultiLeaderPerSet { get; set; } = true;

        /// <summary>Multi-leader-ийн leader-үүдийг нэг шугам болгон нэгтгэх (Revit-ийн «Merge Elbows»).</summary>
        public bool MergeLeaders { get; set; } = false;

        /// <summary>
        /// ХУУЧИН (2026-10-05 өмнөх): Арматур табын тусдаа «Хэмжээсийн төрөл».  Одоо НЭГ сонголт — <see cref="AaOptions.DimensionTypeUid"/>.  Зөвхөн хуучин
        /// auto-annotate.json-оос шилжүүлэхэд уншина (<see cref="AaPrefs.Load"/>); ХЭЗЭЭ Ч хэрэглэхгүй.
        /// </summary>
        public string DimTypeUid { get; set; } = "";

        // ── Хуваалцсан (ElementId биш — UniqueId: файл бүрд өөр)
        public string BarTagTypeUid { get; set; } = "";
        public string StirrupTagTypeUid { get; set; } = "";
        public string MraTypeUid { get; set; } = "";

        /// <summary>Гишүүнээс (дам нуруу ЭСВЭЛ багана) шошгоны эхний эгнээ хүртэл, цаасан мм.</summary>
        public double TagOffsetMm { get; set; } = 8;

        /// <summary>Хөрш шошгоны ХАРАГДАХ зай, цаасан мм.</summary>
        public double TagGapMm { get; set; } = 4;

        /// <summary>Хэмжээсийн эгнээ хоорондын зай, цаасан мм.</summary>
        public double DimPitchMm { get; set; } = 8;

        /// <summary>Гишүүнээс хомутын MRA-ийн хэмжээсийн шугам хүртэл, цаасан мм.  0 = автомат (бусад эгнээний ард).</summary>
        public double StirrupDimOffsetMm { get; set; } = 0;

        /// <summary>
        /// Шошгоны leader-ийн ГУРВАН цэг (1 = арматур, 2 = elbow, 3 = шошго): <see cref="LeaderLandingMm"/> = 3→2 (шошгоны ирмэгээс elbow хүртэл хэвтээ),
        /// <see cref="LeaderRunMm"/> = 2→1 (elbow-оос арматур хүртэлх налуу хэсгийн хэвтээ зай), цаасан мм.  0 = Revit-ийн автомат.  Хоёулаа заасан үед
        /// шошго хэвтээ чиглэлд зөөгдөнө (<see cref="RfLeaderElbow"/>).
        /// </summary>
        public double LeaderLandingMm { get; set; } = 0;
        public double LeaderRunMm { get; set; } = 0;

        /// <summary>Зөвхөн сонгосон дам нуруу/багана дээр (хадгалагдахгүй — ээлж бүрд).</summary>
        public bool OnlySelectedHosts { get; set; } = false;

        public AaRebarOptions Clone() { return (AaRebarOptions)MemberwiseClone(); }

        /// <summary>Байрлалын тохиргоо (цэвэр, шалгалттай) — цонх ба ажиллуулагч ХОЁУЛАА энэ нэгийг ашиглана.</summary>
        public AaPlacement Placement()
        {
            return new AaPlacement
            {
                HostOffsetMm = TagOffsetMm,
                TagGapMm = TagGapMm,
                DimPitchMm = DimPitchMm,
                SectionDimOffsetMm = SecDimOffsetMm,
                StirrupDimOffsetMm = StirrupDimOffsetMm,
                LeaderLandingMm = LeaderLandingMm,
                LeaderRunMm = LeaderRunMm,
            };
        }
    }

    /// <summary>Цонхонд: энэ харагдацад арматурын юу олдсон, ямар төрлүүд байгаа.</summary>
    public sealed class AaRebarInfo
    {
        public int Rebars;
        public int SectionHosts, ElevationHosts, OtherHosts;

        /// <summary>Огтлол/дэлгээсээр таньсан гишүүдийн төрлөөр: дам нуруу, багана (шошгоны «Дам нуруунаас / Баганаас» үгэнд).</summary>
        public int BeamHosts, ColumnHosts;

        /// <summary>Сонголтын дүн: хүчинтэй (арматур агуулах дам нуруу/багана, энэ харагдацад таньсан), хүчингүй, холбосон файлын (link) элемент.</summary>
        public int SelectedValid, SelectedInvalid, SelectedLinked, SelectedNotInView;

        public readonly List<KeyValuePair<string, string>> BarTagTypes = new List<KeyValuePair<string, string>>();
        public readonly List<KeyValuePair<string, string>> MraTypes = new List<KeyValuePair<string, string>>();
        public string DefaultBarTagUid = "", DefaultMraUid = "";

        /// <summary>Арматурын горимоор ажиллах гишүүн олдсон.</summary>
        public bool HasWork { get { return SectionHosts + ElevationHosts > 0; } }
    }

    internal sealed class AaRebarHost
    {
        public Element Element;

        /// <summary>true = дэлгээс (уртаашаа харагдсан), false = огтлол (план/зүсэлтээр огтлогдсон).</summary>
        public bool Elevation;
        public RfHostKind Kind = RfHostKind.Auto;
    }

    internal static class AaRebar
    {
        /// <summary>Нэг ажиллагаанд боловсруулах гишүүний дээд тоо (план дээр олон мянган багана байж болно).</summary>
        private const int MaxHosts = 60;

        /// <summary>Шалгах гишүүний дээд тоо (арматурын өгөгдөл унших нь удаан).</summary>
        private const int MaxScan = 400;

        // ── Таних ───────────────────────────────────────────────────────

        /// <summary>Харагдацад арматур байна уу (хурдан: ангиллын collector).</summary>
        public static bool ViewHasRebar(Document doc, View view)
        {
            try { return new FilteredElementCollector(doc, view.Id).OfClass(typeof(Rebar)).GetElementCount() > 0; }
            catch { return false; }
        }

        /// <summary>
        /// Харагдацын арматурын гишүүдийг (дам нуруу, багана) таньна.  <paramref name="selection"/> = хэрэглэгчийн сонголт (null байж болно): хүчинтэй/хүчингүй/link-ийн
        /// тоог <see cref="AaRebarInfo"/>-д бичнэ.  <paramref name="onlySelected"/> = зөвхөн сонгосон гишүүд (хүчинтэй сонголт байхгүй бол хоосон).
        /// </summary>
        public static AaRebarInfo Detect(Document doc, View view, ICollection<ElementId> selection, out List<AaRebarHost> hosts, bool onlySelected = false)
        {
            hosts = new List<AaRebarHost>();
            var info = new AaRebarInfo();
            try { info.Rebars = new FilteredElementCollector(doc, view.Id).OfClass(typeof(Rebar)).GetElementCount(); }
            catch { info.Rebars = 0; }
            if (info.Rebars == 0)
            {
                CountSelection(doc, selection, info, null);
                return info;
            }

            hosts = FindHosts(doc, view, info);
            HashSet<long> selectedHostIds = CountSelection(doc, selection, info, hosts);
            if (onlySelected)
            {
                hosts = hosts.Where(h => selectedHostIds.Contains(h.Element.Id.Value)).ToList();
                info.SectionHosts = hosts.Count(h => !h.Elevation);
                info.ElevationHosts = hosts.Count(h => h.Elevation);
                info.BeamHosts = hosts.Count(h => h.Kind == RfHostKind.Beam);
                info.ColumnHosts = hosts.Count(h => h.Kind == RfHostKind.Column);
            }
            FillTypes(doc, info);
            return info;
        }

        /// <summary>
        /// Сонголтын дүн.  Хүчингүй (хана, шал, generic г.м.), холбосон файлын (link) элемент, энэ харагдацад таньагдаагүй гишүүнийг тус тусад нь тоолно —
        /// дуудагч ойлгомжтой Монгол мессеж гаргана; ЯМАР Ч тохиолдолд унахгүй.  Буцаах: таньсан хүчинтэй гишүүдийн id.
        /// </summary>
        private static HashSet<long> CountSelection(Document doc, ICollection<ElementId> selection, AaRebarInfo info, List<AaRebarHost> hosts)
        {
            var valid = new HashSet<long>();
            if (selection == null || selection.Count == 0) return valid;
            var known = new HashSet<long>();
            if (hosts != null) foreach (AaRebarHost h in hosts) known.Add(h.Element.Id.Value);
            foreach (ElementId id in selection)
            {
                Element e = null;
                try { e = doc.GetElement(id); }
                catch { e = null; }
                if (e == null) { info.SelectedInvalid++; continue; }
                if (e is RevitLinkInstance) { info.SelectedLinked++; continue; }
                if (!RfSectionAnalyzer.IsAcceptableHost(e)) { info.SelectedInvalid++; continue; }
                if (known.Contains(e.Id.Value)) { valid.Add(e.Id.Value); info.SelectedValid++; }
                else info.SelectedNotInView++;
            }
            return valid;
        }

        private static List<AaRebarHost> FindHosts(Document doc, View view, AaRebarInfo info)
        {
            var res = new List<AaRebarHost>();
            RfViewFrame annot, cut;
            RfSectionAnalyzer.Frames(view, out annot, out cut);
            int scanned = 0;
            foreach (BuiltInCategory cat in new[] { BuiltInCategory.OST_StructuralFraming, BuiltInCategory.OST_StructuralColumns })
            {
                foreach (Element e in new FilteredElementCollector(doc, view.Id).OfCategory(cat).WhereElementIsNotElementType())
                {
                    if (++scanned > MaxScan) return res;
                    if (!RfSectionAnalyzer.IsAcceptableHost(e)) continue;
                    if (!HasRebar(e)) continue;
                    RfHostKind kind = RfSectionAnalyzer.KindOf(e);
                    if (RfElevationService.IsElevationHost(view, e))
                    {
                        res.Add(new AaRebarHost { Element = e, Elevation = true, Kind = kind });
                        info.ElevationHosts++;
                    }
                    else if (IsCutByView(e, cut))
                    {
                        res.Add(new AaRebarHost { Element = e, Elevation = false, Kind = kind });
                        info.SectionHosts++;
                    }
                    else
                    {
                        info.OtherHosts++;
                        continue;
                    }
                    if (kind == RfHostKind.Column) info.ColumnHosts++;
                    else if (kind == RfHostKind.Beam) info.BeamHosts++;
                }
            }
            return res;
        }

        private static bool HasRebar(Element e)
        {
            try
            {
                if (!RebarHostData.IsValidHost(e)) return false;
                RebarHostData hd = RebarHostData.GetRebarHostData(e);
                return hd != null && hd.GetRebarsInHost().Count > 0;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Огтлол/план: гишүүний тэнхлэг огтлолын нормальтай параллель (≥ cos 25°) БА гишүүн огтлолын хавтгайг дайрсан (хавтгайн ард харагдаж буй биш).
        /// Багана (босоо) → тэнхлэг (0,0,1).
        /// </summary>
        private static bool IsCutByView(Element e, RfViewFrame cut)
        {
            RfV3 axis;
            if (!RfElevationService.AxisOf(e, out axis))
            {
                if (RfSectionAnalyzer.KindOf(e) != RfHostKind.Column) return false;
                axis = new RfV3(0, 0, 1);
            }
            if (Math.Abs(axis.Dot(cut.Normal)) < 0.9) return false;
            BoundingBoxXYZ bb;
            try { bb = e.get_BoundingBox(null); }
            catch { return false; }
            if (bb == null) return false;
            double lo = double.MaxValue, hi = double.MinValue;
            foreach (double x in new[] { bb.Min.X, bb.Max.X })
                foreach (double y in new[] { bb.Min.Y, bb.Max.Y })
                    foreach (double z in new[] { bb.Min.Z, bb.Max.Z })
                    {
                        double d = cut.DepthOf(new RfV3(x, y, z));
                        if (d < lo) lo = d;
                        if (d > hi) hi = d;
                    }
            double tol = RfTol.MmToFt(2);
            return lo <= tol && hi >= -tol;
        }

        private static void FillTypes(Document doc, AaRebarInfo info)
        {
            foreach (FamilySymbol fs in RfSectionService.RebarTagTypes(doc))
                info.BarTagTypes.Add(new KeyValuePair<string, string>(fs.UniqueId, fs.FamilyName + " : " + fs.Name));
            ElementId defTag = RfSectionService.DefaultRebarTagType(doc, RfSectionService.RebarTagTypes(doc));
            Element dt = defTag == null || defTag == ElementId.InvalidElementId ? null : doc.GetElement(defTag);
            if (dt != null) info.DefaultBarTagUid = dt.UniqueId;

            var mras = new List<MultiReferenceAnnotationType>();
            try
            {
                mras = new FilteredElementCollector(doc).OfClass(typeof(MultiReferenceAnnotationType)).Cast<MultiReferenceAnnotationType>().ToList();
            }
            catch
            {
                mras = new List<MultiReferenceAnnotationType>();
            }
            mras.Sort((a, b) => string.Compare(a.Name, b.Name, StringComparison.CurrentCultureIgnoreCase));

            // Анхдагч = энэ ФАЙЛД хамгийн их хэрэглэгдсэн MRA төрөл (инженер өөрөө гараар тавьдаг төрөл), үгүй бол шошготой + алхамтай төрөл.
            var mraUse = new Dictionary<long, int>();
            var mraTagIds = new HashSet<long>();
            try
            {
                foreach (MultiReferenceAnnotation m in new FilteredElementCollector(doc).OfClass(typeof(MultiReferenceAnnotation)).Cast<MultiReferenceAnnotation>())
                {
                    long k = m.GetTypeId().Value;
                    int c;
                    mraUse[k] = mraUse.TryGetValue(k, out c) ? c + 1 : 1;
                    if (m.TagId != ElementId.InvalidElementId) mraTagIds.Add(m.TagId.Value);
                }
            }
            catch
            {
                // Хэрэглээг тоолж чадсангүй — дараах дүрмээр.
            }
            long bestUse = 0;
            foreach (MultiReferenceAnnotationType t in mras)
            {
                info.MraTypes.Add(new KeyValuePair<string, string>(t.UniqueId, t.Name));
                int used;
                if (mraUse.TryGetValue(t.Id.Value, out used) && used > bestUse)
                {
                    bestUse = used;
                    info.DefaultMraUid = t.UniqueId;
                }
            }
            if (info.DefaultMraUid.Length == 0)
            {
                int bestScore = -1;
                foreach (MultiReferenceAnnotationType t in mras)
                {
                    int score = (t.TagTypeId != ElementId.InvalidElementId ? 1 : 0) + (t.ShowDimensionText ? 1 : 0)
                        + (t.Name.IndexOf("Алхам", StringComparison.CurrentCultureIgnoreCase) >= 0 ? 2 : 0);
                    if (score > bestScore)
                    {
                        bestScore = score;
                        info.DefaultMraUid = t.UniqueId;
                    }
                }
            }

            // Ажлын арматурын шошгоны анхдагч: хамгийн их хэрэглэгдсэн (MRA-ийн шошгыг тооцохгүй).
            try
            {
                var tagUse = new Dictionary<long, int>();
                foreach (IndependentTag t in new FilteredElementCollector(doc).OfClass(typeof(IndependentTag)).OfCategory(BuiltInCategory.OST_RebarTags).Cast<IndependentTag>())
                {
                    if (mraTagIds.Contains(t.Id.Value)) continue;
                    long k = t.GetTypeId().Value;
                    int c;
                    tagUse[k] = tagUse.TryGetValue(k, out c) ? c + 1 : 1;
                }
                if (tagUse.Count > 0)
                {
                    long best = tagUse.OrderByDescending(kv => kv.Value).First().Key;
                    Element be = doc.GetElement(new ElementId(best));
                    if (be != null) info.DefaultBarTagUid = be.UniqueId;
                }
            }
            catch
            {
                // Хэрэглээг тоолж чадсангүй — төслийн өгөгдмөл.
            }
        }

        // ── Тохиргоо → Revit талын ───────────────────────────────────────

        private static ElementId IdOf(Document doc, string uid)
        {
            if (string.IsNullOrEmpty(uid)) return ElementId.InvalidElementId;
            Element e = doc.GetElement(uid);
            return e == null ? ElementId.InvalidElementId : e.Id;
        }

        private static RfSectionUi SectionUi(Document doc, AaRebarOptions o, DimensionType dimType)
        {
            return new RfSectionUi
            {
                Ref = o.StirrupRef == "outer" ? RfStirrupRef.Outer : o.StirrupRef == "center" ? RfStirrupRef.Center : RfStirrupRef.Inner,
                Left = o.Left, Right = o.Right, Top = o.Top, Bottom = o.Bottom,
                DoDims = o.SecDims, TagLong = o.SecTagLong, TagStirrups = o.SecTagStirrups,
                MemberDims = o.SecMemberDims, MemberPitchMm = Math.Max(2, o.SecStepMm),
                GroupTags = o.SecGroupTags,
                SingleTagPerSet = o.SingleTagPerSet,
                MultiLeaderPerSet = o.SingleTagPerSet && o.MultiLeaderPerSet,
                MergeLeaders = o.SingleTagPerSet && o.MultiLeaderPerSet && o.MergeLeaders,
                ReplacePrevious = true,
                DimTypeId = dimType == null ? ElementId.InvalidElementId : dimType.Id,
                MainTagTypeId = IdOf(doc, o.BarTagTypeUid),
                StirrupTagTypeId = IdOf(doc, o.StirrupTagTypeUid.Length > 0 ? o.StirrupTagTypeUid : o.BarTagTypeUid),
                DimOffsetMm = o.SecDimOffsetMm,
                // «Байрлал»: үндсэн тал = зүүн (эсвэл баруун) ба доод; «4 талд» бол эсрэг тал ч.
                HDimSide = RfSide.Bottom,
                VDimSide = o.SecRightSide && !o.SecAllSides ? RfSide.Right : RfSide.Left,
                AllSides = o.SecAllSides,
                // Хэрэглэгчийн утга л — хэрэгсэл өөрөөсөө зай нэмэхгүй.
                TagGapMm = Math.Max(1, o.TagGapMm),
                TagOutMm = Math.Max(1, o.TagOffsetMm),
                LeaderLandingMm = Math.Max(0, o.LeaderLandingMm),
                LeaderRunMm = Math.Max(0, o.LeaderRunMm),
            };
        }

        private static RfElevUi ElevationUi(Document doc, AaRebarOptions o, DimensionType dimType)
        {
            return new RfElevUi
            {
                TagBars = o.ElevTagBars, StirrupMra = o.ElevMra, LapDims = o.ElevLaps, SpanDims = o.ElevSpans, LapChain = false,   // дэлгээсийн үргэлжилсэн гинж хасагдсан (2026-10-09)
                DimTypeId = dimType == null ? ElementId.InvalidElementId : dimType.Id,
                BarTagTypeId = IdOf(doc, o.BarTagTypeUid),
                MraTypeId = IdOf(doc, o.MraTypeUid),
                TagOffsetMm = Math.Max(0, o.TagOffsetMm),
                TagGapMm = Math.Max(0, o.TagGapMm),
                DimPitchMm = Math.Max(2, o.DimPitchMm),
                StirrupDimOffsetMm = Math.Max(0, o.StirrupDimOffsetMm),
                DimFirstMm = Math.Max(0, o.ElevDimFirstMm),
                ColumnDimsLeft = o.ElevColumnLeft,
                LeaderLandingMm = Math.Max(0, o.LeaderLandingMm),
                LeaderRunMm = Math.Max(0, o.LeaderRunMm),
            };
        }

        // ── Ажиллуулах ────────────────────────────────────────────────

        /// <summary>
        /// ⚠️ Нээлттэй Transaction-гүй үед л дуудна (огтлолын үйлчилгээ өөрийн TransactionGroup эзэмшинэ).  Дэлгээсийг НЭГ Transaction-д.
        /// Буцаах: ямар нэг зүйл өөрчлөгдсөн (дуудагч TransactionGroup-ыг assimilate хийнэ).
        /// </summary>
        public static bool Run(Document doc, View view, AaRebarOptions o, DimensionType dimType, AaReport rep, List<AaRebarHost> hosts)
        {
            // Байрлалын тохиргооны ЭЦСИЙН шалгалт (цонх шалгасан ч команд шууд дуудагдаж болно) — буруу утгаар Revit-д юу ч бичихгүй.
            string badPlacement = o.Placement().Validate(null, hosts.Any(h => !h.Elevation));
            if (badPlacement != null)
            {
                rep.Error(badPlacement);
                return false;
            }
            bool changed = false;
            if (hosts.Count == 0) return false;
            var sections = hosts.Where(h => !h.Elevation).Take(MaxHosts).ToList();
            var elevations = hosts.Where(h => h.Elevation).Take(MaxHosts).ToList();
            if (hosts.Count(h => !h.Elevation) > MaxHosts || hosts.Count(h => h.Elevation) > MaxHosts)
                rep.Note("Нэг ажиллагаанд " + MaxHosts + " гишүүн хүртэл боловсруулна — үлдсэнийг дахин дарж тавина.");

            // ── Огтлол (одоо байгаа «Огтлолын арматурын тэмдэглэгээ»-ний үйлчилгээ, өөрчлөлтгүй)
            if (sections.Count > 0)
            {
                RfSectionUi ui = SectionUi(doc, o, dimType);
                foreach (AaRebarHost h in sections)
                {
                    try
                    {
                        RfSectionContext ctx = RfSectionService.Analyze(doc, view, h.Element);
                        RfSectionPlan plan = RfSectionService.Plan(ctx, ui);
                        if (plan.Dims.Count + plan.Chains.Count + plan.MemberChains.Count + plan.Tags.Count == 0)
                        {
                            foreach (RfSectionWarning w in plan.Warnings.Take(2))
                                rep.Note(RfSectionAnalyzer.Describe(doc, h.Element) + ": " + RfText.SectionWarn(w));
                            continue;
                        }
                        RfSectionReport r = RfSectionService.Render(doc, view, ctx, plan, ui);
                        rep.RebarSections++;
                        rep.RebarSecDims += r.DimsMade;
                        rep.RebarSecDimSegments += r.DimSegments;
                        rep.RebarSecMemberDims += r.MemberMade;
                        rep.RebarSecTags += r.Tags;
                        rep.DimsFailed += r.DimsFailed + r.MemberFailed;
                        rep.TagsFailed += Math.Max(0, r.TagsPlanned - r.Tags);
                        string who = RfSectionAnalyzer.Describe(doc, h.Element);
                        foreach (string f in r.Failures.Take(3)) rep.Error(who + ": " + f);
                        foreach (string n in r.Notes.Take(2)) rep.Note(who + ": " + n);
                        foreach (RfSectionWarning w in plan.Warnings.Take(2)) rep.Note(who + ": " + RfText.SectionWarn(w));
                        if (r.DimsMade + r.MemberMade + r.Tags > 0) changed = true;
                    }
                    catch (Exception ex)
                    {
                        rep.Error(RfSectionAnalyzer.Describe(doc, h.Element) + ": " + ex.Message);
                    }
                }
            }

            // ── Дэлгээс (шинэ)
            if (elevations.Count > 0)
            {
                RfElevUi ui = ElevationUi(doc, o, dimType);
                using (var t = new Transaction(doc, "MGL: Арматурын дэлгээс"))
                {
                    t.Start();
                    FailureHandlingOptions fho = t.GetFailureHandlingOptions();
                    fho.SetFailuresPreprocessor(new AaFailureHandler(rep));
                    fho.SetClearAfterRollback(true);
                    t.SetFailureHandlingOptions(fho);
                    bool any = false;
                    try
                    {
                        foreach (AaRebarHost h in elevations)
                        {
                            string who = RfSectionAnalyzer.Describe(doc, h.Element);
                            try
                            {
                                RfElevContext ctx = RfElevationService.Analyze(doc, view, h.Element, ui);
                                RfElevReport r = RfElevationService.Render(ctx, ui);
                                rep.ElevHosts++;
                                rep.ElevTags += r.Tags;
                                rep.ElevMras += r.Mras;
                                rep.ElevLaps += r.Laps;
                                rep.ElevLapChains += r.LapChains;
                                rep.ElevSpans += r.Spans;
                                rep.TagsFailed += Math.Max(0, r.TagsPlanned - r.Tags) + Math.Max(0, r.MrasPlanned - r.Mras);
                                rep.DimsFailed += Math.Max(0, r.LapsPlanned - r.Laps) + Math.Max(0, r.LapChainsPlanned - r.LapChains) + Math.Max(0, r.SpansPlanned - r.Spans);
                                if (r.Plan != null && r.Plan.MraFirst)
                                    rep.Note(who + ": хомутын MRA таны заасан зайд (гишүүнд хамгийн ойр) тавигдсан тул доод талын шошго/давхцлын хэмжээсийг түүний гадна зөөлөө.");
                                rep.Created.AddRange(r.Created);
                                foreach (string f in r.Failures.Take(4)) rep.Error(who + ": " + f);
                                foreach (string n in r.Notes.Take(3)) rep.Note(who + ": " + n);
                                if (r.Created.Count > 0) any = true;
                            }
                            catch (Exception ex)
                            {
                                rep.Error(who + ": " + ex.Message);
                            }
                        }
                        if (any)
                        {
                            TransactionStatus st = t.Commit();
                            if (st != TransactionStatus.Committed)
                            {
                                rep.Error("Revit дэлгээсийн өөрчлөлтийг буцаасан (" + st + ").");
                                rep.ElevTags = rep.ElevMras = rep.ElevLaps = rep.ElevLapChains = rep.ElevSpans = 0;
                            }
                            else
                            {
                                changed = true;
                            }
                        }
                        else
                        {
                            t.RollBack();
                        }
                    }
                    catch (Exception ex)
                    {
                        if (t.HasStarted() && !t.HasEnded()) t.RollBack();
                        rep.Error(ex.Message);
                    }
                }
            }
            if (changed) rep.RebarChanged = true;
            return changed;
        }
    }
}
