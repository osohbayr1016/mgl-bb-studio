using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.ExtensibleStorage;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement
{
    /// <summary>Нэг тавигдсан төгсгөлийн тэмдгийн метадата.</summary>
    internal sealed class RfPlacedEnd
    {
        /// <summary>family тэмдэг бол FamilyInstance, код-оор зурсан бол null.</summary>
        public FamilyInstance Instance;

        /// <summary>Тэмдгийн БҮХ элемент: family бол [Instance], код-оор зурсан бол detail шугам/нумууд.</summary>
        public readonly List<Element> Parts = new List<Element>();

        /// <summary>Код-оор зурсан тэмдэг (SymbolUid нь «mk:…»).</summary>
        public bool IsMarker { get { return RfMarkerGeometry.IsTag(SymbolUid); } }

        /// <summary>
        /// Код-оор зурсан тэмдэг: ЭНЭ түлхүүртэй БУСАД (Copy/Paste-ийн хуулбар г.м. — байрлалаар салсан) бүлгийн тоо.  Хуулбарыг ХӨНДӨХГҮЙ.
        /// </summary>
        public int Copies;

        /// <summary>Код-оор зурсан тэмдэг: элементийн тоо хэлбэрийнхээ бүрэн тоотой тэнцэхгүй (нэг хагасыг нь устгасан / давхцуулж paste хийсэн).</summary>
        public bool Damaged;

        public string RebarUid;
        public RfEndKind Kind;
        public int BarIndex;
        public string SymbolUid;
        /// <summary>Family-д ХЭРЭГЛЭСЭН эргэлт (радиан).</summary>
        public double Rot;
        /// <summary>Family-ийн өөрийн «заах» чиглэл (радиан).</summary>
        public double Natural;
        /// <summary>Тавих үеийн оффсет (фут).</summary>
        public double OffsetFt;
        public bool Hooks;
        /// <summary>true = арматурын чиглэлээр эргүүлсэн (дахин тооцож шинэчилнэ); false = тогтмол өнцөг.</summary>
        public bool Auto;

        public string Key { get { return RfEndSymbolMath.DupKey(RebarUid, Kind, BarIndex, Hooks); } }
    }

    /// <summary>
    /// «Энэ тэмдгийг энэ арматурын энэ төгсгөлд тавьсан»-ыг тэмдэгт ДЭЭР (Extensible Storage) хадгална.
    /// Үүгээр (1) давхар тавилтаас хамгаална, (2) «Тэмдэглэгээ шинэчлэх» геометр өөрчлөгдсөний дараа
    /// байрлал/чиглэлийг дахин тооцно.  Хэрэглэгчийн гараар тавьсан тэмдэгт ХЭЗЭЭ Ч хөндөгдөхгүй.
    ///
    /// ⚠️ SchemaGuid, талбарыг ХЭЗЭЭ Ч бүү өөрчил (Revit хориглодог).  Тоон утгыг мөрөөр (invariant) хадгална —
    /// Extensible Storage-ийн double талбар нэгж (spec) шаарддаг тул.
    /// </summary>
    internal static class RfEndSymbolStore
    {
        private static readonly Guid SchemaGuid = new Guid("5d8f4e1b-2b67-4c7a-b1f3-9e6a0c52d713");
        private const string SchemaName = "MglRfEndSymbol";
        private const string ToolVersion = "rf-1";

        private static Schema Schema()
        {
            Schema s = Autodesk.Revit.DB.ExtensibleStorage.Schema.Lookup(SchemaGuid);
            if (s != null) return s;
            var b = new SchemaBuilder(SchemaGuid);
            b.SetSchemaName(SchemaName);
            b.SetReadAccessLevel(AccessLevel.Public);
            b.SetWriteAccessLevel(AccessLevel.Public);
            b.SetVendorId("com.revitmcp");
            b.SetDocumentation("MGL «Арматурын төгсгөлийн тэмдэг»: энэ тэмдэг аль арматурын аль төгсгөлд тавигдсан.");
            b.AddSimpleField("RebarUid", typeof(string));
            b.AddSimpleField("Kind", typeof(string));
            b.AddSimpleField("BarIndex", typeof(int));
            b.AddSimpleField("SymbolUid", typeof(string));
            b.AddSimpleField("Rot", typeof(string));
            b.AddSimpleField("Natural", typeof(string));
            b.AddSimpleField("Offset", typeof(string));
            b.AddSimpleField("Hooks", typeof(bool));
            b.AddSimpleField("Auto", typeof(bool));
            b.AddSimpleField("Tool", typeof(string));
            b.AddSimpleField("Stamp", typeof(string));
            return b.Finish();
        }

        private static string D(double v) { return v.ToString("R", CultureInfo.InvariantCulture); }

        private static double P(string s)
        {
            double v;
            return double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out v) ? v : 0;
        }

        /// <summary>Нээлттэй Transaction дотор.</summary>
        public static bool Write(Element e, RfPlacedEnd d)
        {
            try
            {
                var ent = new Entity(Schema());
                ent.Set("RebarUid", d.RebarUid ?? string.Empty);
                ent.Set("Kind", d.Kind == RfEndKind.Start ? "S" : "E");
                ent.Set("BarIndex", d.BarIndex);
                ent.Set("SymbolUid", d.SymbolUid ?? string.Empty);
                ent.Set("Rot", D(d.Rot));
                ent.Set("Natural", D(d.Natural));
                ent.Set("Offset", D(d.OffsetFt));
                ent.Set("Hooks", d.Hooks);
                ent.Set("Auto", d.Auto);
                ent.Set("Tool", ToolVersion);
                ent.Set("Stamp", DateTime.UtcNow.ToString("o"));
                e.SetEntity(ent);
                return true;
            }
            catch
            {
                return false;
            }
        }

        public static RfPlacedEnd Read(Element e)
        {
            Schema s = Autodesk.Revit.DB.ExtensibleStorage.Schema.Lookup(SchemaGuid);
            if (s == null || e == null) return null;
            try
            {
                Entity ent = e.GetEntity(s);
                if (ent == null || !ent.IsValid()) return null;
                var p = new RfPlacedEnd
                {
                    Instance = e as FamilyInstance,
                    RebarUid = ent.Get<string>("RebarUid"),
                    Kind = ent.Get<string>("Kind") == "E" ? RfEndKind.End : RfEndKind.Start,
                    BarIndex = ent.Get<int>("BarIndex"),
                    SymbolUid = ent.Get<string>("SymbolUid"),
                    Rot = P(ent.Get<string>("Rot")),
                    Natural = P(ent.Get<string>("Natural")),
                    OffsetFt = P(ent.Get<string>("Offset")),
                    Hooks = ent.Get<bool>("Hooks"),
                    Auto = ent.Get<bool>("Auto"),
                };
                p.Parts.Add(e);
                return p;
            }
            catch
            {
                return null;
            }
        }

        private sealed class MarkerItem
        {
            public RfPlacedEnd Record;
            public CurveElement Element;
            public RfMarkerPart Part;
        }

        /// <summary>
        /// Харагдацад (ЭНЭ харагдацын өмчлөлд) байгаа БҮХ detail муруй — код-оор зурсан тэмдгийн нэр дэвшигч.
        /// ⚠️ Revit-ийн баримт: <c>ElementClassFilter</c> нь «яг тэр класс ЭСВЭЛ түүнээс удамшсан»-ыг татна, харин <c>CurveElement</c>-ийн
        /// ДЭД класс (DetailLine, DetailArc…)-ыг шууд шүүж БОЛОХГҮЙ — тиймээс бүх CurveElement-ийг татаад ДЭЭРЭЭС нь <see cref="DetailCurve"/>-ийг тусгаарлана.
        /// </summary>
        public static IEnumerable<CurveElement> MarkerCandidates(Document doc, View view)
        {
            foreach (Element e in new FilteredElementCollector(doc).OwnedByView(view.Id).OfClass(typeof(CurveElement)))
            {
                DetailCurve dc = e as DetailCurve;
                if (dc != null) yield return dc;
            }
        }

        /// <summary>
        /// Дөнгөж үүсгэсэн тэмдгийн элемент «давхардлын хайлт»-аар (<see cref="Previous"/>-ийн ЯГ ИЖИЛ асуулга) олдож байгаа эсэх.
        /// Олдохгүй бол энэ Revit/харагдац дээр тэмдгийг дахин таних боломжгүй (давхардал хамгаалалт, «шинэчлэх» ажиллахгүй) — дуудагч тэмдэг тавихгүй.
        /// Нээлттэй Transaction дотор дуудаж болно (FilteredElementCollector нь хийгдэж буй өөрчлөлтийг харна).
        /// </summary>
        public static bool IsDetectable(Document doc, View view, ElementId id)
        {
            try
            {
                foreach (CurveElement ce in MarkerCandidates(doc, view))
                {
                    if (ce.Id == id) return true;
                }
            }
            catch
            {
                // Асуулга унавал «танигдахгүй» (хамгийн аюулгүй).
            }
            return false;
        }

        /// <summary>
        /// Энэ харагдацад (ЭНЭ харагдацын өмчлөлд) энэ хэрэгслийн тавьсан бүх тэмдэг.  Түлхүүр = <see cref="RfPlacedEnd.Key"/>.
        /// ⚠️ Харагдацыг «Duplicate with Detailing»-оор хуулбарласан үед бичлэг ч хуулагдана — харагдац тус бүрд
        /// тусдаа тоолдог (OwnedByView) тул хуулбар дээр дахин ажиллуулахад давхардахгүй, эх зураг ч хөндөгдөхгүй.
        /// </summary>
        public static Dictionary<string, RfPlacedEnd> Previous(Document doc, View view)
        {
            var map = new Dictionary<string, RfPlacedEnd>(StringComparer.Ordinal);
            if (Autodesk.Revit.DB.ExtensibleStorage.Schema.Lookup(SchemaGuid) == null) return map;
            try
            {
                foreach (FamilyInstance fi in new FilteredElementCollector(doc).OwnedByView(view.Id).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>())
                {
                    RfPlacedEnd p = Read(fi);
                    if (p == null || string.IsNullOrEmpty(p.RebarUid)) continue;
                    RfPlacedEnd cur;
                    if (!map.TryGetValue(p.Key, out cur))
                    {
                        map[p.Key] = p;
                    }
                    else
                    {
                        // Ижил түлхүүртэй хоёр дахь family тэмдэг = хэрэглэгчийн Copy/Paste хуулбар (Entity хамт хуулагддаг).  ХӨНДӨХГҮЙ.
                        // «Манай» нь ХАМГИЙН ЭХ (бага ElementId) — collector-ын дараалалд биш (Refresh хуулбарыг биш эхийг зөөнө).
                        int copies = cur.Copies + 1;
                        if (p.Instance != null && cur.Instance != null && p.Instance.Id.Value < cur.Instance.Id.Value)
                        {
                            map[p.Key] = p;
                            cur = p;
                        }
                        cur.Copies = copies;
                    }
                }

                // Код-оор зурсан тэмдэг: нэг тэмдэг = хэд хэдэн detail шугам/нум.  Түлхүүр тус бүрийн элементүүдийг БАЙРЛАЛААР нь салгана
                // (RfMarkerCluster): хамгийн ЭХ (бага id) бүлэг = манай тэмдэг, бусад бүлэг = хэрэглэгчийн Copy/Paste-ийн хуулбар (ХӨНДӨХГҮЙ).
                RfViewFrame frame = RfView.Frame(view);
                var byKey = new Dictionary<string, List<MarkerItem>>(StringComparer.Ordinal);
                foreach (CurveElement ce in MarkerCandidates(doc, view))
                {
                    RfPlacedEnd p = Read(ce);
                    if (p == null || !p.IsMarker || string.IsNullOrEmpty(p.RebarUid)) continue;
                    Curve cv = ce.GeometryCurve;
                    if (cv == null) continue;
                    var item = new MarkerItem
                    {
                        Record = p,
                        Element = ce,
                        Part = new RfMarkerPart
                        {
                            Id = ce.Id.Value,
                            Mid = frame.ToView(RfConv.V(cv.Evaluate(0.5, true))),
                            Length = cv.ApproximateLength,
                        },
                    };
                    List<MarkerItem> list;
                    if (!byKey.TryGetValue(p.Key, out list)) byKey[p.Key] = list = new List<MarkerItem>();
                    list.Add(item);
                }

                foreach (KeyValuePair<string, List<MarkerItem>> kv in byKey)
                {
                    if (map.ContainsKey(kv.Key)) continue; // энэ төгсгөлд family тэмдэг аль хэдийн бий
                    List<MarkerItem> items = kv.Value;
                    List<List<int>> groups = RfMarkerCluster.Split(items.Select(i => i.Part).ToList());
                    if (groups.Count == 0) continue;

                    List<int> primary = groups[0];
                    RfPlacedEnd rec = items[primary[0]].Record;
                    rec.Parts.Clear();
                    foreach (int idx in primary) rec.Parts.Add(items[idx].Element);
                    rec.Copies = groups.Count - 1;
                    RfMarkerStyle style;
                    rec.Damaged = !RfMarkerGeometry.TryParseTag(rec.SymbolUid, out style)
                        || rec.Parts.Count != RfMarkerCluster.ExpectedParts(style);
                    map[kv.Key] = rec;
                }
            }
            catch
            {
                // Уншиж чадахгүй бол «өмнөх байхгүй» — давхардал үүсэж магадгүй ч юу ч устахгүй.
            }
            return map;
        }
    }
}
