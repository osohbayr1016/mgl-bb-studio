using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

namespace MglBb.Core
{
    public enum BbMemberKind { Beam = 0, BeamAux = 1, Column = 2, Wall = 3, Slab = 4 }

    /// <summary>
    /// Компанийн ББ ажлын зургийн СТАНДАРТ — «Стандарт сурах» нь инженерийн аль хэдийн зурсан дамнуруу/баганын зургаас (харагдацын төрөл,
    /// загвар, масштаб, crop, огтлолын байрлал, хэмжээс/шошго/MRA-ийн төрөл, зай, тал, хуудасны зохиомж) статистикаар бөглөнө.  Plugin-д
    /// «ЖИШЭЭ-1»-ээс сурсан өгөгдмөл шигтгэгдсэн (Resources/standard-jishee1.json).
    /// Нэгж: crop/зай = ЗАГВАРЫН мм (… Mm), шошго/хэмжээсийн зай = ЦААСАН мм (… PaperMm).
    /// </summary>
    public sealed class BbStandard
    {
        public const int CurrentVersion = 1;

        public int Version = CurrentVersion;
        public string Name = "MGL ББ стандарт";
        public string Source = "";            // аль файлаас сурсан
        public string LearnedAt = "";         // ISO огноо
        public BbMemberStandard Beam = BbMemberStandard.DefaultBeam();
        public BbMemberStandard BeamAux = BbMemberStandard.DefaultBeamAux();
        public BbMemberStandard Column = BbMemberStandard.DefaultColumn();
        public BbSheetStandard Sheet = new BbSheetStandard();
        public BbPlateStandard Plate = new BbPlateStandard();

        /// <summary>Аль утгыг хэдэн жишээнээс сурсан (түлхүүр = "beam.ElevScale" г.м.).</summary>
        public Dictionary<string, int> Evidence = new Dictionary<string, int>(StringComparer.Ordinal);

        public BbMemberStandard For(BbMemberKind k)
        {
            switch (k)
            {
                case BbMemberKind.Column: return Column;
                case BbMemberKind.BeamAux: return BeamAux;
                default: return Beam;
            }
        }

        public static string KindKey(BbMemberKind k)
        {
            switch (k)
            {
                case BbMemberKind.Column: return "column";
                case BbMemberKind.BeamAux: return "beamAux";
                case BbMemberKind.Wall: return "wall";
                case BbMemberKind.Slab: return "slab";
                default: return "beam";
            }
        }

        public static string KindName(BbMemberKind k)
        {
            switch (k)
            {
                case BbMemberKind.Column: return "Багана";
                case BbMemberKind.BeamAux: return "Туслах дамнуруу";
                case BbMemberKind.Wall: return "Хана";
                case BbMemberKind.Slab: return "Хучилт";
                default: return "Дамнуруу";
            }
        }

        public int EvidenceOf(BbMemberKind k, string field)
        {
            return Evidence.TryGetValue(KindKey(k) + "." + field, out int n) ? n : 0;
        }

        // ── JSON ─────────────────────────────────────────────────────────

        public Dictionary<string, object> ToJson()
        {
            return new Dictionary<string, object>
            {
                ["version"] = (double)Version,
                ["name"] = Name,
                ["source"] = Source,
                ["learnedAt"] = LearnedAt,
                ["beam"] = Beam.ToJson(),
                ["beamAux"] = BeamAux.ToJson(),
                ["column"] = Column.ToJson(),
                ["sheet"] = Sheet.ToJson(),
                ["plate"] = BbFieldJson.ToJson(Plate),
                ["evidence"] = Evidence.OrderBy(k => k.Key, StringComparer.Ordinal).ToDictionary(k => k.Key, k => (object)(double)k.Value),
            };
        }

        public static BbStandard FromJson(object o)
        {
            var s = new BbStandard
            {
                Version = (int)BbJson.Num(o, "version", CurrentVersion),
                Name = BbJson.Str(o, "name", "MGL ББ стандарт"),
                Source = BbJson.Str(o, "source", ""),
                LearnedAt = BbJson.Str(o, "learnedAt", ""),
            };
            s.Beam = BbMemberStandard.FromJson(BbJson.Obj(o, "beam"), BbMemberStandard.DefaultBeam());
            s.BeamAux = BbMemberStandard.FromJson(BbJson.Obj(o, "beamAux"), BbMemberStandard.DefaultBeamAux());
            s.Column = BbMemberStandard.FromJson(BbJson.Obj(o, "column"), BbMemberStandard.DefaultColumn());
            s.Sheet = BbSheetStandard.FromJson(BbJson.Obj(o, "sheet"));
            s.Plate = BbFieldJson.FromJson(BbJson.Obj(o, "plate"), new BbPlateStandard());
            Dictionary<string, object> ev = BbJson.Obj(o, "evidence");
            if (ev != null) foreach (var kv in ev) if (kv.Value is double d) s.Evidence[kv.Key] = (int)d;
            return s;
        }

        public string Save(string path)
        {
            string dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            File.WriteAllText(path, BbJson.Write(ToJson()), new System.Text.UTF8Encoding(false));
            return path;
        }

        public static BbStandard Load(string path)
        {
            return FromJson(BbJson.Parse(File.ReadAllText(path)));
        }
    }

    /// <summary>Нэг төрлийн гишүүний (дамнуруу / туслах дамнуруу / багана) дэлгээс + огтлол + тэмдэглэгээний стандарт.</summary>
    public sealed class BbMemberStandard
    {
        // ── Дэлгээс (уртаашаа харагдац)
        public string ElevViewType = "";        // ViewFamilyType-ийн нэр
        public string ElevTemplate = "";        // харагдацын загвар (хоосон = загваргүй)
        public int ElevScale = 50;
        public string ElevNamePattern = "ДАМНУРУУ {mark} АРМАТУРЧЛАЛ";
        /// <summary>2 дахь хэсгээс эхлэн нэрийн ард (жишээнд «… Copy 1»).</summary>
        public string ElevPartSuffix = " Copy {n}";
        /// <summary>Гишүүний захаас (тэнхлэгийн дагуу) crop-ын нэмэлт.</summary>
        public double ElevCropAlongMm = 600;
        /// <summary>Дамнуруу: доод/дээд нүүрнээс.  Багана: зүүн/баруун нүүрнээс.</summary>
        public double ElevCropBelowMm = 285, ElevCropAboveMm = 290;
        /// <summary>Харагдацын хавтгай гишүүний ойрын нүүрнээс ДОТОГШ (мм) ба far clip хойд нүүрнээс ЦААШ (мм).</summary>
        public double ElevPlaneInsideMm = 11, ElevFarBeyondMm = 24;
        /// <summary>Нэг хэсгийн дээд урт (цаасан мм) — илүү бол хэд хэдэн хэсэг; хэсгүүд <see cref="ElevOverlapMm"/>-ээр давхцана (тулгуур хоёуланд харагдана).</summary>
        public double ElevMaxPartPaperMm = 560, ElevOverlapMm = 2000;

        // ── Огтлол (хөндлөн)
        public string SecViewType = "";
        public string SecTemplate = "";
        public int SecScale = 20;
        public string SecNamePattern = "{mark} S{n}";
        public double SecCropSideMm = 145, SecCropBelowMm = 45, SecCropAboveMm = 75;
        /// <summary>Огтлолын ажлын арматурын шошгыг ҮРГЭЛЖ зүүн талд (хөдөлгүүр хамгийн ойр талд тавьдаг).</summary>
        public bool SecTagsLeft = true;
        public double SecFarMm = 330;
        /// <summary>Тулгуурын нүүрнээс огтлол хүртэл (мм); 0 бол алгасал × <see cref="SecSupportRatio"/>.</summary>
        public double SecSupportOffsetMm = 830, SecSupportRatio = 0.12;
        public bool SecAtSupports = true, SecAtMidspan = true;
        /// <summary>Арматурын тохиргоо (дээд/доод ширхэг, голч, хомутын алхам) нь өмнөх огтлолтой ижил бол алгасна (инженерийн 911 огтлолын 895 нь давтагдашгүй).</summary>
        public bool SecSkipDuplicates = true;
        public double SecMinGapMm = 400;

        // ── Тэмдэглэгээ (үндсэн plugin-ий хөдөлгүүрийн тохиргоонд буулгана)
        public string DimType = "";            // хэмжээсийн төрлийн нэр
        public string BarTagType = "";         // «family : type»
        public string StirrupTagType = "";
        public string MraType = "";

        public double TagOffsetPaperMm = 4, TagGapPaperMm = 4, DimPitchPaperMm = 7.5, StirrupDimOffsetPaperMm = 23, ElevDimFirstPaperMm = 8.5;
        public bool ElevTagBars = true, ElevMra = true, ElevLaps = true, ElevSpans = true;
        /// <summary>Дэлгээс: давхцлын хэмжээсийг зөвхөн ДЭЭД үеийн арматурт (бөөр, доод үеийнхийг тавихгүй) — инженерийн дэлгээсээс сурна.</summary>
        public bool ElevLapsTopOnly = false;
        /// <summary>Дэлгээс: тэнхлэгийн гинжийн доор НИЙТ урт (эхний — сүүлийн тэнхлэг) — инженерийн дэлгээсээс сурна.</summary>
        public bool ElevSpanTotal = true;
        /// <summary>Дэлгээс: хомутын эгнээнд бүс хоорондын «хомут | хомут» ба тулгуурт «хомут | баганын нүүр | нүүр | хомут» хэмжээс — сурна.</summary>
        public bool ElevStirrupGaps = false;
        /// <summary>Дэлгээс: дээд үеийн гинж «дамнурууны төгсгөл | тэнхлэгүүд | дээд ажлын арматурын таслах цэгүүд | төгсгөл» — сурна.</summary>
        public bool ElevTopChain = false;
        /// <summary>
        /// Дэлгээсийн арматурын шошгоны leader (сурна; ЖИШЭЭ-2 ДДН-10): бичвэр хугарлын <see cref="ElevLeaderSide"/> талд, хугарлаас шошгоны ТОЛГОЙН цэг
        /// хүртэл <see cref="ElevLeaderHeadPaperMm"/>, хугарлаас арматур хүртэл <see cref="ElevLeaderRunPaperMm"/> — хэвтээ, цаасан мм.  Side хоосон = хөдөлгүүрийн
        /// автомат (бичвэр арматурын дээр).  Толгойноос хэмжинэ: шошгоны bbox leader-ийг хамардаг тул бичвэрийн ирмэгээс хэмжиж болохгүй.
        /// </summary>
        public string ElevLeaderSide = "";
        public double ElevLeaderHeadPaperMm = 0, ElevLeaderRunPaperMm = 0;
        public bool SecDims = true, SecTagLong = true, SecTagStirrups = true, SecMemberDims = true, SecGroupTags = true;
        /// <summary>«нүүр | хомут | АЖЛЫН АРМАТУР БҮРИЙН ТӨВ | хомут | нүүр» (ЖИШЭЭ-1-ийн огтлол бүрд) — хөдөлгүүрийн «нүүр | хомут | хомут | нүүр» гинжийг өргөтгөнө.</summary>
        public bool SecBarChain = true;
        public string StirrupRef = "outer";    // outer | inner | center
        public double SecDimOffsetPaperMm = 9, SecStepPaperMm = 7, SecTagOutPaperMm = 8;
        public bool SecAllSides = false;
        /// <summary>Босоо гинж баруун талд (дамнуруу) — баганын огтлолд зүүн талд.</summary>
        public bool SecRightSide = true;
        public bool ElevColumnLeft = true;
        public bool SingleTagPerSet = true, MultiLeaderPerSet = true;
        /// <summary>Огтлол: multi-leader-ийн leader-үүдийг нэгтгэх (хөдөлгүүрийн «Merge leader»).</summary>
        public bool SecMergeLeaders = false;
        /// <summary>Огтлолын leader: 3→2 шошгоноос хугарал хүртэл, 2→1 хугарлаас арматур хүртэл — хэвтээ, цаасан мм (0 = хөдөлгүүрийн автомат).</summary>
        public double SecLeaderLandingPaperMm = 0, SecLeaderRunPaperMm = 0;

        // ── Дэлгээсийн компанийн загвар (ЖИШЭЭ-1-ийн 235 дэлгээсээс хэмжсэн; <see cref="MglBb.Core.BbMraLayout"/>)
        /// <summary>Хомутын MRA-г компанийн хоёр эгнээний загвараар дахин байрлуулна (false = хөдөлгүүрийн нэг эгнээ).</summary>
        public bool ElevMraLayout = true;
        public int MraShortMaxBars = 3;
        public double MraNearHeadPaperMm = 5.4, MraFarHeadPaperMm = 4.0, MraShortGapPaperMm = 1.5, MraPairPaperMm = 30;
        public int MraMidMaxBars = 7;
        public double MraMidHeadPaperMm = 6.7, MraLongRel = 0.7, MraMidRel = 0.4;
        /// <summary>Ижил дугаартай ч өөр байрлалын арматур бүр өөрийн шошготой.</summary>
        public bool ElevTagEachBar = true;
        /// <summary>Хажуугийн (дунд өндрийн) арматурын шошго гишүүний дунд өндөрт.</summary>
        public bool ElevSideTags = true;
        /// <summary>Хөдөлгүүрийн ангилж чадаагүй (нугалсан г.м.) харагдаж буй арматурт шошго нэмнэ.</summary>
        public bool ElevTagOtherBars = true;
        public double SideTagRunPaperMm = 5;

        // ── Огтлолын break line (ЖИШЭЭ-2 «ДН-1 S1…S9», «ДДН-2 S10»-оос хэмжсэн): crop-ын зүүн/баруун ирмэгийг дайрсан хучилт бүрд
        // «DET-Symbol_Break_Line»-ыг ирмэгээс дотогш, хучилтын зузааны голд; left/right = зузааны хагас, masking = ирмэг хүртэл.
        // ── Огтлолын шошго ҮҮРГЭЭР (<see cref="BbTagRoles"/>): тал «left»/«right» (хоосон = сураагүй → хөдөлгүүрийн байрлал хэвээр),
        // Dx = гишүүний хажуу нүүрнээс гадагш, Dy = ӨӨРИЙН арматурын өндрөөс (огтлолын хавтгай дээр) дээш — цаасан мм.
        public string SecTopTagSide = "", SecBottomTagSide = "", SecSideTagSide = "", SecStirrupTagSide = "";
        public double SecTopTagDxPaperMm = 0, SecTopTagDyFromBarPaperMm = 0;
        public double SecBottomTagDxPaperMm = 0, SecBottomTagDyFromBarPaperMm = 0;
        public double SecSideTagDxPaperMm = 0, SecSideTagDyFromBarPaperMm = 0;
        public double SecStirrupTagDxPaperMm = 0, SecStirrupTagDyFromBarPaperMm = 0;
        /// <summary>
        /// Leader-ийн хугарал (elbow) үүргээр: Ref «axis» = гишүүний тэнхлэгээс, «end» = leader-ийн төгсгөлөөс (хомутын хөл) шошгоны тал руу Elbow
        /// цаасан мм; Ref хоосон = сураагүй → <see cref="SecLeaderLandingPaperMm"/> (толгойноос тогтмол зай).
        /// </summary>
        public string SecTopTagElbowRef = "", SecBottomTagElbowRef = "", SecSideTagElbowRef = "", SecStirrupTagElbowRef = "";
        public double SecTopTagElbowPaperMm = 0, SecBottomTagElbowPaperMm = 0, SecSideTagElbowPaperMm = 0, SecStirrupTagElbowPaperMm = 0;
        /// <summary>Нэг талын шошгоны толгой хоорондын ХАМГИЙН БАГА босоо зай (цаасан мм) — давхцвал доош түлхэнэ.</summary>
        public double SecRoleTagPitchPaperMm = 4.5;

        public bool SecBreakLines = true;
        public string BreakFamily = "DET-Symbol_Break_Line";
        /// <summary>Crop-ын ирмэгээс break line хүртэл (цаасан мм; 1:20-д 45 мм загвар = 2.25).</summary>
        public double BreakInsetPaperMm = 2.25;
        /// <summary>«masking depth extension» (цаасан мм; 1:20-д 48.6 мм загвар = 2.43).</summary>
        public double BreakMaskPaperMm = 2.43;

        public static BbMemberStandard DefaultBeam() { return new BbMemberStandard(); }

        public static BbMemberStandard DefaultBeamAux()
        {
            return new BbMemberStandard
            {
                ElevNamePattern = "ТУСЛАХ ДАМНУРУУ {mark} АРМАТУРЧЛАЛ",
                ElevCropAlongMm = 400,
                ElevCropBelowMm = 470,
                ElevCropAboveMm = 300,
                ElevPlaneInsideMm = 3,
                ElevFarBeyondMm = 17,
                SecCropSideMm = 140,
                SecCropBelowMm = 34,
                SecCropAboveMm = 76,
                SecFarMm = 335,
            };
        }

        public static BbMemberStandard DefaultColumn()
        {
            return new BbMemberStandard
            {
                ElevNamePattern = "БАГАНА {mark} АРМАТУРЧЛАЛ",
                SecNamePattern = "{mark} S{n}",
                SecScale = 25,
                SecAtMidspan = false,
                SecRightSide = false,
                // ЖИШЭЭ-1 «БАГАНА Б-5 АРМАТУРЧЛАЛ /+4.93-+21.43/»: хэсэг ≈ 17–20 м (1:50-д ≈ 380 мм), огтлол «Б-5 S1» баганаас ≈ 230 мм зай.
                ElevMaxPartPaperMm = 380,
                ElevCropAlongMm = 800,
                SecCropSideMm = 230,
                SecCropBelowMm = 230,
                SecCropAboveMm = 230,
                SecDimOffsetPaperMm = 8,
                SecStepPaperMm = 7,
                StirrupDimOffsetPaperMm = 18,
                TagOffsetPaperMm = 6.5,
            };
        }

        public Dictionary<string, object> ToJson()
        {
            var d = new Dictionary<string, object>(StringComparer.Ordinal);
            foreach (var f in typeof(BbMemberStandard).GetFields())
            {
                object v = f.GetValue(this);
                d[f.Name] = v is int i ? (object)(double)i : v;
            }
            return d;
        }

        public static BbMemberStandard FromJson(Dictionary<string, object> o, BbMemberStandard def)
        {
            if (o == null) return def;
            foreach (var f in typeof(BbMemberStandard).GetFields())
            {
                if (!o.TryGetValue(f.Name, out object v) || v == null) continue;
                try
                {
                    if (f.FieldType == typeof(string) && v is string s) f.SetValue(def, s);
                    else if (f.FieldType == typeof(double) && v is double d) f.SetValue(def, d);
                    else if (f.FieldType == typeof(int) && v is double di) f.SetValue(def, (int)Math.Round(di));
                    else if (f.FieldType == typeof(bool) && v is bool b) f.SetValue(def, b);
                }
                catch { }
            }
            return def;
        }

        /// <summary>Огтлолын шошгоны сурсан байрлал үүргээр (<paramref name="side"/> хоосон = сураагүй).</summary>
        public void RoleTag(BbBarRole r, out string side, out double dx, out double dy)
        {
            switch (r)
            {
                case BbBarRole.Top: side = SecTopTagSide; dx = SecTopTagDxPaperMm; dy = SecTopTagDyFromBarPaperMm; break;
                case BbBarRole.Bottom: side = SecBottomTagSide; dx = SecBottomTagDxPaperMm; dy = SecBottomTagDyFromBarPaperMm; break;
                case BbBarRole.Side: side = SecSideTagSide; dx = SecSideTagDxPaperMm; dy = SecSideTagDyFromBarPaperMm; break;
                default: side = SecStirrupTagSide; dx = SecStirrupTagDxPaperMm; dy = SecStirrupTagDyFromBarPaperMm; break;
            }
        }

        /// <summary>Огтлолын шошгоны хугарлын сурсан лавлах цэг ба зай үүргээр (<paramref name="elbowRef"/> хоосон = сураагүй).</summary>
        public void RoleElbow(BbBarRole r, out string elbowRef, out double paperMm)
        {
            switch (r)
            {
                case BbBarRole.Top: elbowRef = SecTopTagElbowRef; paperMm = SecTopTagElbowPaperMm; break;
                case BbBarRole.Bottom: elbowRef = SecBottomTagElbowRef; paperMm = SecBottomTagElbowPaperMm; break;
                case BbBarRole.Side: elbowRef = SecSideTagElbowRef; paperMm = SecSideTagElbowPaperMm; break;
                default: elbowRef = SecStirrupTagElbowRef; paperMm = SecStirrupTagElbowPaperMm; break;
            }
        }

        public string ElevName(string mark, int part)
        {
            string n = ElevNamePattern.Replace("{mark}", mark ?? "");
            if (part > 1) n += ElevPartSuffix.Replace("{n}", (part - 1).ToString(CultureInfo.InvariantCulture));
            return n;
        }

        public string SecName(string mark, int n)
        {
            return SecNamePattern.Replace("{mark}", mark ?? "").Replace("{n}", n.ToString(CultureInfo.InvariantCulture));
        }
    }

    /// <summary>Хуудасны зохиомж (ЦААСАН мм).</summary>
    public sealed class BbSheetStandard
    {
        public string TitleBlock = "";            // «family : type»
        public string ElevViewportType = "";      // эхний хэсэг (гарчигтай)
        public string ElevPartViewportType = "";  // дараагийн хэсгүүд («Хоосон»)
        public string SecViewportType = "";
        public string BeamSheetNamePattern = "ДАМНУРУУ {mark} АРМАТУРЧЛАЛ, ОГТЛОЛ, ТҮҮВЭР";
        public string ColumnSheetNamePattern = "БАГАНА {mark} АРМАТУРЧЛАЛ, ОГТЛОЛ";
        // ЖИШЭЭ-1: хуудасны дугаарын ЦУВРАЛ төрөл бүрд (4- багана 87, 5- дамнуруу 124, 6- хана 57, 7- хучилт 67) ба Project Browser-ийн
        // бүлэглэлтийн параметр («* Type Designator» = «5 - ДАМНУРУУ» г.м.).  Параметр = «нэр=утга|нэр=утга».
        public string BeamSheetPrefix = "5-";
        public string ColumnSheetPrefix = "4-";
        public string WallSheetPrefix = "6-";
        public string SlabSheetPrefix = "7-";
        public string BeamSheetParams = "* Classification=Ажлын зураг|* Sub-Discipline=Барилга бүтээц|* Type Designator=5 - ДАМНУРУУ";
        public string ColumnSheetParams = "* Classification=Ажлын зураг|* Sub-Discipline=Барилга бүтээц|* Type Designator=4 - БАГАНА";
        public string WallSheetParams = "* Classification=Ажлын зураг|* Sub-Discipline=Барилга бүтээц|* Type Designator=6 - ХАНА";
        public string SlabSheetParams = "* Classification=Ажлын зураг|* Sub-Discipline=Барилга бүтээц|* Type Designator=7 - ХУЧИЛТ";
        public string WallSheetNamePattern = "ЦУТГАМАЛ ХАНА {mark} ХЭВ, АРМАТУРЧЛАЛ, ТҮҮВЭР";
        public string SlabSheetNamePattern = "{level} ТҮВШНИЙ ХУЧИЛТЫН {part}";
        public int SectionsPerRow = 3;
        public double SectionPitchMm = 106;
        public double LeftMarginMm = 20;
        public double GapMm = 4;

        public Dictionary<string, object> ToJson()
        {
            var d = new Dictionary<string, object>(StringComparer.Ordinal);
            foreach (var f in typeof(BbSheetStandard).GetFields())
            {
                object v = f.GetValue(this);
                d[f.Name] = v is int i ? (object)(double)i : v;
            }
            return d;
        }

        public static BbSheetStandard FromJson(Dictionary<string, object> o)
        {
            var s = new BbSheetStandard();
            if (o == null) return s;
            foreach (var f in typeof(BbSheetStandard).GetFields())
            {
                if (!o.TryGetValue(f.Name, out object v) || v == null) continue;
                if (f.FieldType == typeof(string) && v is string str) f.SetValue(s, str);
                else if (f.FieldType == typeof(double) && v is double d) f.SetValue(s, d);
                else if (f.FieldType == typeof(int) && v is double di) f.SetValue(s, (int)Math.Round(di));
            }
            return s;
        }
    }

    /// <summary>
    /// ХАНА (цутгамал хана ЦХ-n) ба ХУЧИЛТЫН (түвшин бүр) ажлын зургийн стандарт.  Өгөгдмөл нь ЖИШЭЭ-1-д хэмжсэн утга (6-8 «ЦУТГАМАЛ ХАНА ЦХ-1 ХЭВ,
    /// АРМАТУРЧЛАЛ, ТҮҮВЭР»: хэв + арматурчлалын дэлгээс 1:100 (богино хана 1:50), хэвний босоо огтлол 1:100, хэвний хэвтээ огтлол 1:50, арматурын
    /// хэвтээ огтлол 1:25; 7-10…7-12 «4.93 ТҮВШНИЙ ХУЧИЛТЫН ХЭВНИЙ БАЙГУУЛАЛТ / ДООД / ДЭЭД ҮЕИЙН АРМАТУРЧЛАЛ» 1:120).
    /// </summary>
    public sealed class BbPlateStandard
    {
        public string WallFormViewType = "4.3. Диафрагм ханын хэв - Огтлол";
        public string WallFormTemplate = "Огтлол ББ - Диафрагм ханын хэв - Огтлол";
        public string WallRebarViewType = "4.4. Диафрагм ханын арматурчлал";
        public string WallRebarTemplate = "Огтлол ББ - Диафрагм ханын арматурчлал";
        public string WallCutRebarTemplate = "Огтлол ББ - Диафрагм ханын арматурчлал+ Огтлол";
        public string WallFormName = "ЦУТГАМАЛ ХАНА {mark} ХЭВ";
        public string WallRebarName = "ЦУТГАМАЛ ХАНА {mark} АРМАТУРЧЛАЛ";
        public string WallSecName = "ЦУТГАМАЛ ХАНА {mark} ОГТЛОЛ {n}";
        public int WallElevScaleLong = 100;
        public int WallElevScaleShort = 50;
        /// <summary>Дэлгээсийг богино масштабаар (1:50) зурах цаасны дээд урт; давбал 1:100 (ЦХ-7 7.9 м → 1:50, ЦХ-4 28.5 м → 1:100).</summary>
        public double WallElevMaxPaperMm = 330;
        public int WallCrossScale = 100;
        public int WallCutFormScale = 50;
        public int WallCutRebarScale = 25;
        public double WallCropMm = 600;
        public double WallCrossSideMm = 650;
        public double WallCutLengthMm = 3500;
        public double WallCutSideMm = 600;
        public double WallPlaneOutMm = 300;
        public double WallFarBeyondMm = 300;
        public string WallMraType = "(Поз)⌀Диаметр-Алхам";
        public string WallMraDimType = "Шулуун 2.5 - Ташуу зураас_BIMon";
        public string WallDimType = "Арматур хэмжээ - 2.5 / Алхам";

        public string SlabFormViewType = "4.1.а. Хучилтын байгуулалт";
        public string SlabFormTemplate = "Байгуулалт-ББ Хучилтын Хэв хашмал";
        public string SlabBottomViewType = "4.1.б. Хучилтын Арматурчлалт + Доод үе";
        public string SlabBottomTemplate = "Байгуулалт-ББ Хучилтын арматурчлалт + Доод үе";
        public string SlabTopViewType = "4.1.в. Хучилтын Арматурчлалт + Дээд үе";
        public string SlabTopTemplate = "Байгуулалт-ББ Хучилтын арматурчлалт + Дээд үе";
        public string SlabFormName = "{level} ТҮВШНИЙ ХУЧИЛТЫН ХЭВНИЙ БАЙГУУЛАЛТ";
        public string SlabBottomName = "{level} ТҮВШНИЙ ХУЧИЛТЫН ДООД ҮЕИЙН АРМАТУРЧЛАЛ";
        public string SlabTopName = "{level} ТҮВШНИЙ ХУЧИЛТЫН ДЭЭД ҮЕИЙН АРМАТУРЧЛАЛ";
        public int SlabScale = 120;
        public double SlabCropMm = 2000;
        public string SlabMraType = "(Поз)Тоо/ш-⌀Диаметр-Алхам";
        public string SlabMraDimType = "Шулуун 2.5 - Ташуу зураас_BIMon";
        public string SlabGridDimType = "Арматур хэмжээ - 2.5 / Алхам Opaque";

        /// <summary>MRA-ийн хэмжээсийн шугам хамгийн гадна арматураас; шугамаас шошго хүртэл (цаасан мм).</summary>
        public double MraOffsetPaperMm = 10;
        public double MraTagGapPaperMm = 4;

        public string WallName(string pattern, string mark, int n = 0)
        {
            return (pattern ?? "").Replace("{mark}", mark ?? "").Replace("{n}", n.ToString(CultureInfo.InvariantCulture));
        }
    }

    /// <summary>Энгийн талбартай (string/double/int/bool) ангийг JSON руу/аас — тусгай кодгүй.</summary>
    public static class BbFieldJson
    {
        public static Dictionary<string, object> ToJson(object o)
        {
            var d = new Dictionary<string, object>(StringComparer.Ordinal);
            foreach (var f in o.GetType().GetFields())
            {
                object v = f.GetValue(o);
                d[f.Name] = v is int i ? (object)(double)i : v;
            }
            return d;
        }

        public static T FromJson<T>(Dictionary<string, object> o, T into)
        {
            if (o == null) return into;
            foreach (var f in typeof(T).GetFields())
            {
                if (!o.TryGetValue(f.Name, out object v) || v == null) continue;
                if (f.FieldType == typeof(string) && v is string str) f.SetValue(into, str);
                else if ((f.FieldType == typeof(double) || f.FieldType == typeof(double?)) && v is double d) f.SetValue(into, d);
                else if (f.FieldType == typeof(int) && v is double di) f.SetValue(into, (int)Math.Round(di));
                else if ((f.FieldType == typeof(bool) || f.FieldType == typeof(bool?)) && v is bool b) f.SetValue(into, b);
            }
            return into;
        }
    }
}
