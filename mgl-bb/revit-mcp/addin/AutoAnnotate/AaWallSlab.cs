using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using RevitMcpAddin.Reinforcement;

namespace RevitMcpAddin.AutoAnnotate
{
    /// <summary>
    /// ХАНА, ХУЧИЛТ (шал/хавтан) дээрх арматурын ОЛОНЛОГИЙН тэмдэглэгээ (2026-10-05) — тусдаа цэс.
    /// Олонлог бүрд НЭГ MRA (multi rebar tag: шошго + алхамын хэмжээс).  Байрлал нь хана/хучилтаас БИШ, харагдаж буй АРМАТУРААС тооцогдоно:
    /// хэмжээсийн шугам олонлогийн хамгийн гадна арматураас хэрэглэгчийн мм-ээр (<see cref="RfSetMraPlanner"/>).
    /// </summary>
    public sealed class AaWallSlabOptions
    {
        public bool Enabled { get; set; } = true;
        public bool Walls { get; set; } = true;
        public bool Floors { get; set; } = true;

        /// <summary>MRA (Multi-Rebar Annotation) төрөл — UniqueId.  Хоосон = «Арматур» табын сонголт, үгүй бол файлын анхдагч.</summary>
        public string MraTypeUid { get; set; } = "";

        /// <summary>Олонлогийн хамгийн гадна арматураас хэмжээсийн шугам хүртэл, цаасан мм.</summary>
        public double OffsetMm { get; set; } = 10;

        /// <summary>Хэмжээсийн шугамаас шошго хүртэл, цаасан мм.</summary>
        public double TagGapMm { get; set; } = 4;

        /// <summary>true = эсрэг талд.</summary>
        public bool Flip { get; set; } = false;

        /// <summary>Зөвхөн сонгосон хана/хучилт дээр (хадгалагдахгүй — ээлж бүрд).</summary>
        public bool OnlySelectedHosts { get; set; } = false;

        // ── 2026-10-08 (эзний хүсэлт №3): шошго ба MRT ТУСДАА, ерөнхий хэмжээс, давхцалтай арматурын үргэлжилсэн хэмжээс — хэрэглэгч чагтаар шийднэ.

        /// <summary>MRT / MRA (multi rebar tag: алхамын хэмжээс + шошго) тавих.  Хуучин json-д байхгүй ⇒ true (өмнөх зан төлөв).</summary>
        public bool Mra { get; set; } = true;

        /// <summary>Олонлог бүрд тусдаа арматурын шошго (rebar tag).  MRT-тэй хамт бол MRT-ийн эсрэг талд.</summary>
        public bool Tags { get; set; } = false;

        /// <summary>Тусдаа шошгоны төрөл — UniqueId.  Хоосон = «Дам нурууны арматурын хэмжээс» табын ажлын арматурын шошго.</summary>
        public string TagTypeUid { get; set; } = "";

        /// <summary>Хана/хучилтын ерөнхий (нийт) хэмжээс — урт, өндөр/өргөн.</summary>
        public bool Overall { get; set; } = false;

        /// <summary>Ерөнхий хэмжээсийн шугам хана/хучилтын ирмэгээс, цаасан мм.</summary>
        public double OverallOffsetMm { get; set; } = 10;

        /// <summary>«Байрлал» (2026-10-09, ерөнхий хэмжээстэй ИЖИЛ): true = 4 талд, false = зөвхөн зүүн ба доод талд.  Өмнө нь «Эсрэг талд»-аар дээд/баруун руу шилждэг байв.</summary>
        public bool OverallAllSides { get; set; } = false;
        /// <summary>«Зөвхөн баруун ба доод талд» (2026-10-12): <see cref="OverallAllSides"/> = false үед босоо ерөнхий хэмжээс баруун талд.</summary>
        public bool OverallRightSide { get; set; } = false;

        /// <summary>«Гинж хооронд» — тэр талд MRT/шошго байвал тэдгээрээс цааш (цаасан мм).</summary>
        public double OverallStepMm { get; set; } = 8;

        /// <summary>Харагдацад зөрүүлэг (давхцал) харагдвал олонлогуудын үргэлжилсэн (гинжин) хэмжээс.</summary>
        public bool LapChain { get; set; } = true;

        public AaWallSlabOptions Clone() { return (AaWallSlabOptions)MemberwiseClone(); }

        /// <summary>Цонх ба ажиллуулагч ХОЁУЛАА энэ нэгийг ашиглана.  Алдаа байвал Монгол мессеж, үгүй бол null.</summary>
        public string Validate()
        {
            if (double.IsNaN(OffsetMm) || OffsetMm < 2 || OffsetMm > 60)
                return "Хана/хучилтын MRA: арматураас хэмжээсийн шугам хүртэлх зай 2–60 мм байна.";
            if (double.IsNaN(TagGapMm) || TagGapMm < 0 || TagGapMm > 40)
                return "Хана/хучилтын MRA: шошгоны зай 0–40 мм байна.";
            if (double.IsNaN(OverallOffsetMm) || OverallOffsetMm < 2 || OverallOffsetMm > 60)
                return "Хана/хучилтын ерөнхий хэмжээс: ирмэгээс шугам хүртэлх зай 2–60 мм байна.";
            if (double.IsNaN(OverallStepMm) || OverallStepMm < 2 || OverallStepMm > 40)
                return "Хана/хучилтын ерөнхий хэмжээс: гинж хоорондын зай 2–40 мм байна.";
            if (!Mra && !Tags && !Overall && !LapChain)
                return "Хана/хучилт: MRT, шошго, ерөнхий хэмжээс, үргэлжилсэн хэмжээсийн ядаж нэгийг сонгоно уу.";
            return null;
        }
    }

    /// <summary>Цонхонд: энэ харагдацад хана/хучилтын ямар арматур олдсон.</summary>
    public sealed class AaWallSlabInfo
    {
        public int Walls, Floors;

        /// <summary>Харагдацад харагдаж буй, ≥ 2 ширхэгтэй арматурын олонлог.</summary>
        public int Sets;

        /// <summary>Сонгосон (хүчинтэй хана/хучилт, энэ харагдацад арматуртай).</summary>
        public int SelectedValid;

        public bool HasWork { get { return Sets > 0; } }

        /// <summary>Харагдацад харагдаж буй арматур (бүгд), хана/хучилтад суусан арматуртай хана/хучилтын тоо, тэдгээрийн дундаас ≥ 2 ширхэгтэй багц олдоогүй (ганц ширхэг) тоо.</summary>
        public int VisibleRebars, HostsWithRebar, HostsOnlySingleBars;

        /// <summary>Табыг ХЭЗЭЭ Ч нуухгүй — багц олдоогүй бол ШАЛТГААНЫГ хэлнэ (өмнө нь таб чимээгүй алга болдог байв).</summary>
        public string NoWorkReason
        {
            get
            {
                if (HasWork) return null;
                if (VisibleRebars == 0) return "Энэ харагдацад харагдаж буй арматур алга (арматур нуугдсан, эсвэл харагдацын хүрээнээс гадуур).";
                if (Walls + Floors == 0 && HostsWithRebar == 0) return "Харагдаж буй арматур байна, гэхдээ хана/хучилтад суусан арматур олдсонгүй (дам нуруу, багана, суурийнх байж болно).";
                return "Хана/хучилтын арматур байна, гэхдээ ≥ 2 ширхэгтэй багц (Rebar set) олдсонгүй — ганц ширхэгт MRA тавигдахгүй.";
            }
        }
    }

    internal static class AaWallSlab
    {
        private const int MaxScan = 300;
        private const int MaxHosts = 60;

        /// <summary>Хурдан: ангиллын collector + <c>NumberOfBarPositions</c> (арматурын геометр уншихгүй).</summary>
        public static AaWallSlabInfo Detect(Document doc, View view, ICollection<ElementId> selection, out List<Element> hosts, bool onlySelected = false,
            bool walls = true, bool floors = true)
        {
            hosts = new List<Element>();
            var info = new AaWallSlabInfo();
            HashSet<long> visible;
            try
            {
                visible = new HashSet<long>();
                foreach (ElementId id in new FilteredElementCollector(doc, view.Id).OfClass(typeof(Rebar)).ToElementIds()) visible.Add(id.Value);
            }
            catch
            {
                return info;
            }
            info.VisibleRebars = visible.Count;
            if (visible.Count == 0) return info;

            var selected = new HashSet<long>();
            if (selection != null) foreach (ElementId id in selection) selected.Add(id.Value);

            int scanned = 0;
            foreach (BuiltInCategory cat in new[] { BuiltInCategory.OST_Walls, BuiltInCategory.OST_Floors })
            {
                bool isWall = cat == BuiltInCategory.OST_Walls;
                if (isWall ? !walls : !floors) continue;
                foreach (Element e in new FilteredElementCollector(doc, view.Id).OfCategory(cat).WhereElementIsNotElementType())
                {
                    if (++scanned > MaxScan) return info;
                    int sets = 0;
                    bool anyRebar = false;
                    try
                    {
                        if (!RebarHostData.IsValidHost(e)) continue;
                        RebarHostData hd = RebarHostData.GetRebarHostData(e);
                        if (hd == null) continue;
                        foreach (Rebar r in hd.GetRebarsInHost())
                        {
                            if (r == null || !visible.Contains(r.Id.Value)) continue;
                            anyRebar = true;
                            int n = 1;
                            try { n = r.NumberOfBarPositions; } catch { }
                            if (n >= 2) sets++;
                        }
                    }
                    catch
                    {
                        continue;
                    }
                    if (anyRebar) info.HostsWithRebar++;
                    if (sets == 0)
                    {
                        if (anyRebar) info.HostsOnlySingleBars++;
                        continue;
                    }
                    if (selected.Contains(e.Id.Value)) info.SelectedValid++;
                    if (onlySelected && !selected.Contains(e.Id.Value)) continue;
                    hosts.Add(e);
                    info.Sets += sets;
                    if (isWall) info.Walls++; else info.Floors++;
                }
            }
            return info;
        }

        private static ElementId IdOf(Document doc, string uid)
        {
            if (string.IsNullOrEmpty(uid)) return ElementId.InvalidElementId;
            Element e = doc.GetElement(uid);
            return e == null ? ElementId.InvalidElementId : e.Id;
        }

        /// <summary>
        /// ⚠️ Нээлттэй Transaction-гүй үед л дуудна.  Хана/хучилт бүр дээрх олонлог бүрд MRA; нэг Transaction (өмнөх арматурын дэлгээстэй ижил хэв маяг).
        /// Үүссэн MRA-ийн id-г <c>rep.Created</c>-д нэмнэ → дараагийн удаа «Өмнөхийг солих» устгана.
        /// </summary>
        public static bool Run(Document doc, View view, AaWallSlabOptions o, string fallbackMraUid, string fallbackTagUid, DimensionType dimType, AaReport rep, List<Element> hosts)
        {
            string bad = o.Validate();
            if (bad != null)
            {
                rep.Error(bad);
                return false;
            }
            if (hosts.Count == 0) return false;
            if (hosts.Count > MaxHosts)
                rep.Note("Нэг ажиллагаанд " + MaxHosts + " хана/хучилт хүртэл боловсруулна — үлдсэнийг дахин дарж тавина.");

            ElementId mraId = ElementId.InvalidElementId;
            if (o.Mra)
            {
                mraId = IdOf(doc, o.MraTypeUid);
                if (mraId == ElementId.InvalidElementId) mraId = IdOf(doc, fallbackMraUid);
                if (mraId == ElementId.InvalidElementId)
                {
                    MultiReferenceAnnotationType any = new FilteredElementCollector(doc).OfClass(typeof(MultiReferenceAnnotationType))
                        .Cast<MultiReferenceAnnotationType>().OrderBy(t => t.Name, StringComparer.CurrentCultureIgnoreCase).FirstOrDefault();
                    if (any != null) mraId = any.Id;
                }
                if (mraId == ElementId.InvalidElementId)
                {
                    rep.Error("Хана/хучилтын MRA: энэ файлд MRA (Multi-Rebar Annotation)-ийн төрөл алга.");
                    return false;
                }
            }
            ElementId tagId = ElementId.InvalidElementId;
            if (o.Tags)
            {
                tagId = IdOf(doc, o.TagTypeUid);
                if (tagId == ElementId.InvalidElementId) tagId = IdOf(doc, fallbackTagUid);
                if (tagId == ElementId.InvalidElementId) tagId = RfSectionService.DefaultRebarTagType(doc, RfSectionService.RebarTagTypes(doc));
            }

            var ui = new RfSetMraUi
            {
                MraTypeId = mraId,
                DimTypeId = dimType == null ? ElementId.InvalidElementId : dimType.Id,
                OffsetMm = o.OffsetMm,
                TagGapMm = o.TagGapMm,
                Flip = o.Flip,
                Mra = o.Mra,
                Tags = o.Tags,
                TagTypeId = tagId,
                LapChain = o.LapChain,
                Overall = o.Overall,
                OverallOffsetMm = o.OverallOffsetMm,
                OverallAllSides = o.OverallAllSides,
                OverallRightSide = o.OverallRightSide,
                OverallStepMm = o.OverallStepMm,
            };

            bool changed = false;
            using (var t = new Transaction(doc, "MGL: Хана/хучилтын арматурын MRA"))
            {
                t.Start();
                FailureHandlingOptions fho = t.GetFailureHandlingOptions();
                fho.SetFailuresPreprocessor(new AaFailureHandler(rep));
                fho.SetClearAfterRollback(true);
                t.SetFailureHandlingOptions(fho);
                try
                {
                    foreach (Element h in hosts.Take(MaxHosts))
                    {
                        string who = RfSectionAnalyzer.Describe(doc, h);
                        try
                        {
                            RfSetMraContext ctx = RfSetMraService.Analyze(doc, view, h);
                            RfSetMraReport r = RfSetMraService.Render(ctx, ui, dimType);
                            if (r.Planned + r.TagsPlanned + r.ChainsPlanned + r.OverallPlanned > 0 || r.Created.Count > 0) rep.WsHosts++;
                            rep.WsMras += r.Made;
                            rep.WsTags += r.TagsMade;
                            rep.WsLapChains += r.ChainsMade;
                            rep.WsOverall += r.OverallMade;
                            rep.WsMraExisting += r.MraExisting;
                            rep.WsMraDupRemoved += r.MraDuplicatesRemoved;
                            rep.WsFailed += Math.Max(0, r.Planned - r.Made - r.MraExisting) + Math.Max(0, r.TagsPlanned - r.TagsMade)
                                + Math.Max(0, r.ChainsPlanned - r.ChainsMade) + Math.Max(0, r.OverallPlanned - r.OverallMade);
                            rep.Created.AddRange(r.Created);
                            foreach (string f in r.Failures.Take(4)) rep.Error(who + ": " + f);
                            foreach (string n in r.Notes.Take(3)) rep.Note(who + ": " + n);
                            if (r.Created.Count == 0 && r.Failures.Count == 0 && ctx.Sets.Count == 0)
                                rep.Note(who + ": харагдаж буй олонлог (≥ 2 ширхэг) алга — MRA тавигдсангүй.");
                        }
                        catch (Exception ex)
                        {
                            rep.Error(who + ": " + ex.Message);
                        }
                    }
                    if (rep.WsMras + rep.WsTags + rep.WsLapChains + rep.WsOverall + rep.WsMraDupRemoved > 0)
                    {
                        TransactionStatus st = t.Commit();
                        if (st != TransactionStatus.Committed)
                        {
                            rep.Error("Revit хана/хучилтын өөрчлөлтийг буцаасан (" + st + ").");
                            rep.WsMras = rep.WsTags = rep.WsLapChains = rep.WsOverall = rep.WsMraDupRemoved = 0;
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
            if (changed) rep.RebarChanged = true;
            return changed;
        }
    }
}
