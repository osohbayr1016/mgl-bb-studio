using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>
    /// «Ханын дэлгээс»-ийн тохиргоо.  Хэрэглэгчид харагдах утга (мм, масштаб) — дотоод нэгж рүү Revit давхарга
    /// `UnitUtils`-аар хөрвүүлнэ.  `%APPDATA%\RevitMcpAddin\wall-elevations.json`-д хадгалагдана (компьютер тус бүр;
    /// загварт бичихгүй).  Сериализаци нь энгийн «түлхүүр=утга» мөр — танихгүй түлхүүрийг үл тооно, буруу утга
    /// өгөгдмөл рүү буцна (хуучин/шинэ хувилбар хоорондоо эвдрэхгүй).
    /// </summary>
    public sealed class WeSettings
    {
        public const int FormatVersion = 1;

        /// <summary>Загварыг (view template) хөндөхгүй — харагдацын төрлийн өгөгдмөл хэвээр.</summary>
        public const string TemplateTypeDefault = "";
        /// <summary>Загвар ОГТ хэрэглэхгүй (InvalidElementId).</summary>
        public const string TemplateNone = "<none>";

        /// <summary>Elevation (маркер, өгөгдмөл) эсвэл Section (зүсэлт).  <see cref="ViewTypeName"/> нь энэ төрлийн ViewFamilyType.</summary>
        public WeViewKind ViewKind = WeViewKind.Elevation;
        public string ViewTypeName = string.Empty;
        /// <summary>Өмнөх хувилбарын файлаас уншсан (шинэ түлхүүргүй) — хадгалагдахгүй; урьдчилсан дүнд сануулга.</summary>
        public bool FromOlderFile;
        public string TemplateName = TemplateTypeDefault;
        public int Scale = 50;
        public double PaddingMm = 300;
        public double NearOffsetMm = 600;
        public double FarDepthMm = 300;
        public string NamePattern = WeNaming.DefaultViewPattern;
        public WeWallSidePick WallSide = WeWallSidePick.Exterior;
        public WeOutputMode Output = WeOutputMode.ViewsOnly;
        public string TitleBlockName = string.Empty;
        public string SheetNumberPattern = WeNaming.DefaultSheetPattern;
        /// <summary>
        /// 2026-10-08: 15 → 5 — жишиг хуудсууд (MITIC ИЗД1_A2_41/42/47/50) viewport-ыг хүрээнээс 0–5 мм-т тавьдаг; 15 мм нь 9 дэлгээстэй
        /// өрөөг хоёр хуудас болгосон.  Хуучин өгөгдмөл (15) хадгалсан файл шинэ рүү шилжинэ (<see cref="Deserialize"/>).
        /// </summary>
        public double SheetMarginMm = 5;
        public const double PreviousSheetMarginMm = 15;
        /// <summary>Хуудасны ДООД зурвас (title block-ийн мэдээлэл, тэмдэглэл, материалын самбар) — блок байрлуулахгүй (мм, цаас).</summary>
        public double SheetBottomBandMm;
        public bool UpdateExisting = true;
        /// <summary>Үүсгэсэн дэлгээсүүд дээр БУСАД дэлгээсийн зүсэлтийн тэмдгийг нуух (хэмжсэн: огтлолцох өрөөний тэмдэг зургийг бохирдуулдаг).</summary>
        public bool HideOtherMarkers = true;
        /// <summary>
        /// Манай дэлгээсийн тэмдгийг ОФФИСЫН ХУУДСАН ДЭЭРХ планд нуух (2026-10-14; хуудсанд байрлаагүй ажлын планд харагдсаар).
        /// </summary>
        public bool HideOwnMarkersOnSheets = true;
        /// <summary>Ажил дууссаны дараа хуудсуудыг нэг нэгээр шалгах самбар (2026-10-14).</summary>
        public bool ReviewPanel = true;
        /// <summary>Цонхны доод талын урьдчилсан ЗУРАГ — сонгосон дэлгээсийг Revit-ээр түр үүсгэж буцаана (2026-10-14).  Хэрэглэгчийн сонголт.</summary>
        public bool LivePreview = true;

        // ── Тэмдэглэгээ ───────────────────────────────────────────────
        /// <summary>Сонгосон нүднүүд «мөр:багана» (<see cref="WeAnno"/>).  Хоосон = тэмдэглэгээгүй.</summary>
        public string Annotations = WeAnno.DefaultSet;
        /// <summary>Хэмжээсийн төрлийн нэр ("" = төслийн өгөгдмөл).</summary>
        public string DimTypeName = string.Empty;
        /// <summary>Spot level-ийн төрлийн нэр ("" = өгөгдмөл).</summary>
        public string SpotTypeName = string.Empty;
        /// <summary>Keynote шошгоны төрлийн нэр ("" = өгөгдмөл).</summary>
        public string KeynoteTypeName = string.Empty;
        /// <summary>
        /// Хүрээнээс ЭХНИЙ хэмжээсийн эгнээ хүртэлх зай — ЗАГВАРЫН мм (2026-10-14, интерьерийн баг: «эхнийх нь 300, дараагийнх нь өмнөхөөсөө
        /// +300»; 1:50-д 300 мм = цаасан дээр 6 мм).  Өмнө нь цаасны мм (4 / 5) байсан — хуучин түлхүүр («annoOffsetMm», «annoStepMm») үл тоогдоно.
        /// Spot level-ийн leader, keynote-ийн эгнээ мөн энэ зайгаар.
        /// </summary>
        public double DimOffsetMm = 300;
        /// <summary>Хэмжээсийн эгнээ хоорондын зай — ЗАГВАРЫН мм (өмнөх эгнээнээс дараагийнх хүртэл).</summary>
        public double DimStepMm = 300;
        /// <summary>Хэвтээ хэмжээс: ангиллаар тусдаа эгнээ (өгөгдмөл) эсвэл нэг холимог гинж.</summary>
        public WeDimGrouping DimGrouping = WeDimGrouping.Separated;
        /// <summary>Хамгийн гадна эгнээнд ханын нийт урт (хана → хана).</summary>
        public bool OverallRow = true;
        /// <summary>Материалын тэмдэглэл (жишээ хуудас): өрөө рүү харсан өнгөлгөөний материалын нэр, leader-тэй, хүрээний дээр.</summary>
        public bool MaterialNotes = true;

        // ── Тод / бүдэг хэсэг, улаан хүрээ (2026-10-14, интерьерийн баг 3-р тойрог) ──
        /// <summary>Аль хэсэг ТОД, аль нь БҮДЭГ (жишээ хуудас 232: таазнаас дээд хучилт хүртэл бүдэг).</summary>
        public WeFadeMode FadeMode = WeFadeMode.AboveCeiling;
        /// <summary><see cref="WeFadeMode.AboveHeight"/>: тод хэсгийн өндөр — шалны дээд нүүрнээс, ЗАГВАРЫН мм.</summary>
        public double FadeHeightMm = 2700;
        /// <summary>
        /// Бүдэг хэсэг хэдэн хувь ХАРАГДАХ вэ (opacity, %): 20 = зураг 20 % (интерьерийн багийн хүсэлт).  ХЭМЖСЭН (Revit 2024, gate DIAG-SPOT-FADE-FRAME):
        /// masking region-ийн «Transparency» T үед доорх шугам, гадаргуу T % харагдана (хар шугам → 0.8·цаас + 0.2·шугам).
        /// </summary>
        public int FadeOpacity = 20;
        /// <summary>Дэлгээс бүр, түлхүүр планыг бөөрөнхий өнцөгтэй УЛААН ТАСАРХАЙ хүрээгээр хүрээлэх (жишээ хуудас 232/236/238).</summary>
        public bool RedFrame = true;
        /// <summary>Перспектив / рендерийн байрыг хаана — сүүлийн (эсвэл өмнөх) хуудсанд, эсвэл хуудас бүрт.</summary>
        public WeRenderPlacement RenderPlacement = WeRenderPlacement.LastSheet;

        // ── Тал, гүн ──────────────────────────────────────────────────
        /// <summary>Өрөөний нэг шулуун дээрх хил (хэд хэдэн хана, багана, гүехэн нүх/цухуйлт) НЭГ дэлгээс болно.</summary>
        public bool MergeCollinear = true;
        /// <summary>Харах гүн: өрөөний дунд хүртэл (өгөгдмөл) эсвэл тогтмол <see cref="NearOffsetMm"/>.</summary>
        public WeDepthMode DepthMode = WeDepthMode.HalfRoom;
        /// <summary>«Өрөөний дунд хүртэл» горимын дээд хязгаар (мм).</summary>
        public double MaxDepthMm = 8000;

        // ── Нэр, тэмдэг ───────────────────────────────────────────────
        /// <summary>Хуудас / түлхүүр план дээрх тэмдэг («205A»).</summary>
        public string LabelPattern = WeNaming.DefaultLabelPattern;
        /// <summary>Viewport-ийн гарчиг («Title on Sheet»).  Хоосон = тавихгүй.  Зөвхөн хоосон гарчигт бичнэ (хэрэглэгчийнхийг дарахгүй).</summary>
        public string TitlePattern = WeNaming.DefaultTitlePattern;
        /// <summary>Хуудасны нэр (өрөө горимд).</summary>
        public string SheetNamePattern = WeNaming.DefaultSheetNamePattern;

        // ── Дугаарлалт (W05, 2026-10-16) ─────────────────────────────
        /// <summary>Тэмдгийн {Side}: үсэг (A, B …, өгөгдмөл) эсвэл тоо (1, 2 …).</summary>
        public WeLabelMode LabelMode = WeLabelMode.Letters;
        /// <summary>Тоон тэмдгийн эхлэх утга.</summary>
        public int LabelStart = 1;
        /// <summary>Тоон тэмдгийн ДУУСАХ хязгаар (0 = хязгааргүй) — хүрэлцэхгүй бол үүсгэхээс өмнө засуулна.</summary>
        public int LabelEnd;
        /// <summary>Тоон тэмдгийн оронгийн тоо (2 → «01»; 0 = нэмэлт тэггүй).</summary>
        public int LabelDigits;
        /// <summary>Багц даяар тасралтгүй (өгөгдмөл: өрөө тус бүр дахин эхэлнэ — өрөөний дугаар тэмдэгт орно).</summary>
        public bool LabelContinuous;
        /// <summary>Шинэ хуудасны дугаар: загвараар (өгөгдмөл) эсвэл мужаар.</summary>
        public WeSheetNumberMode SheetNumberMode = WeSheetNumberMode.Pattern;
        /// <summary>Мужийн угтвар («ИЗД1-»).</summary>
        public string SheetRangePrefix = string.Empty;
        public int SheetRangeStart = 1;
        /// <summary>Мужийн ДУУСАХ дугаар — хязгаар; хүрэлцэхгүй бол үүсгэхээс өмнө засуулна, хэзээ ч хэтрэхгүй.</summary>
        public int SheetRangeEnd = 99;
        /// <summary>Мужийн дугаарын оронгийн тоо (2 → «ИЗД1-07»).</summary>
        public int SheetRangeDigits = 2;

        // ── Хуудасны нэмэлт блок (зөвхөн «Харагдац + хуудас», өрөө горим) ──
        /// <summary>Түлхүүр байгуулалт: өрөөний план, хил тодруулсан, тал бүрийн тэмдэг.</summary>
        public bool KeyPlan = true;
        /// <summary>Жишээ хуудас (206A-G, 205G-N): түлхүүр план дэлгээстэй ИЖИЛ 1:50 — өрөөний хэмжээ, тавилга уншигдана.</summary>
        public int KeyPlanScale = 50;
        /// <summary>Түлхүүр планы хүрээ өрөөнөөс хэр гадагш (мм, загварт).</summary>
        /// <summary>2026-10-08: 900 → 450 — MITIC жишиг түлхүүр план өрөөний эргэн тойронд ≈ 300 мм; 900 нь зүүн баганыг өргөсгөж 4 дэлгээс нэг хуудсанд багтаагүй.</summary>
        public double KeyPlanMarginMm = 450;
        /// <summary>3D харагдах байдал (axon): өрөөг тааз доогуур тайрсан тэнхлэгэн зураг.</summary>
        public bool Axon = true;
        public int AxonScale = 50;
        /// <summary>Перспектив / рендер зургийн БАЙР (тэгш өнцөгт + бичвэр), 0–4.  Зөвхөн шинэ хуудсанд.</summary>
        public int Perspectives = 3;
        /// <summary>
        /// Хуудсанд байрлуулах legend харагдацууд (материал, тэмдэглэгээ) — хоосон = үгүй, хэдийг ч сонгоно (2026-10-14, интерьерийн баг: «олон
        /// legend чагтаар»).  Сонгосон дарааллаар.  Зөвхөн шинэ хуудсанд.  Хуучин файлын ганц «legend» түлхүүр энд орж ирнэ.
        /// </summary>
        public List<string> LegendNames = new List<string>();
        /// <summary>Legend-ийн нэрсийг хадгалах тусгаарлагч — Revit харагдацын нэрэнд «|» хориотой тул найдвартай.</summary>
        public const char LegendSeparator = '|';

        /// <summary>Хуудасны нэмэлт блок үүсэх эсэх.</summary>
        public bool SheetExtras { get { return Output == WeOutputMode.ViewsAndSheets && (KeyPlan || Axon); } }

        // ── Нэг хуудасны байрлуулалт (W02, 2026-10-16) ────────────────
        /// <summary>
        /// Хэрэглэгчийн ИЛ сонгосон БЭЛЭН хуудасны дугаар — бүх өрөөний шинэ зургийг ТЭР хуудасны сул зайд (эсвэл хуудасны баруун талд) тавина.
        /// Хоосон (өгөгдмөл) = өрөө тус бүр нэг шинэ хуудас.  Файлд ХАДГАЛАГДАХГҮЙ (төсөл, удаа бүрийн шийдвэр) — багтахгүй гэж хэзээ ч автоматаар
        /// солигдохгүй.
        /// </summary>
        public string TargetSheetNumber = string.Empty;
        /// <summary>
        /// «Дахин байрлуулах» — өмнө үүсгэсэн өрөөний хуудсан дээрх энэ хэрэгслийн viewport-уудыг шинэ хуудасны дүрмээр (дөрвөн бүс) дахин
        /// зохиомжилно.  Хэрэглэгч ИЛ сонгоход л; файлд ХАДГАЛАГДАХГҮЙ.  Өгөгдмөл (false): өмнөх хуудсанд зөвхөн ШИНЭ зургийг сул зайд нэмнэ,
        /// гараар зөөсөн байрлалыг хэзээ ч хөдөлгөхгүй.
        /// </summary>
        public bool ResetPlacement;

        public bool Annotate(string row, string col)
        {
            return WeAnno.Parse(Annotations).Contains(WeAnno.Cell(row, col));
        }

        /// <summary>
        /// Дэлгээс тус бүрийн ТОХИРУУЛСАН байрлал (урьдчилсан планаас чирж) — файлд ХАДГАЛАГДАХГҮЙ (өрөө тус бүрийнх); үүсгэсэн харагдац дээр
        /// хадгалагдаж дахин ажиллуулахад тэндээс уншигдана (<see cref="WeExistingView.Override"/>).
        /// </summary>
        public WeOverrides Overrides = new WeOverrides();

        /// <summary>
        /// W07: дэлгээс тус бүрийн БОСОО ХҮРЭЭ (доод/дээд хил, мм) — цонхонд энэ удаа өгсөн (<see cref="WeVerticalCrop"/>).  Файлд ХАДГАЛАГДАХГҮЙ:
        /// үүсгэсэн харагдац дээр хадгалагдаж (<see cref="WeViewState"/>) дахин ажиллуулахад тэндээс уншигдана.  Хоёр тал NaN = «Авто».
        /// </summary>
        public WeCropOverrides Crops = new WeCropOverrides();

        // ── Зориулалт (W09, 2026-10-16) ───────────────────────────────
        /// <summary>
        /// Суурилагдсан зориулалтын (интерьер, архитектур, ариун цэврийн өрөө) хэрэглэгчийн тохиргоо — файлд «preset.&lt;id&gt;=…».  Байхгүй бол
        /// <see cref="WePresetCatalog.BuiltIn"/>.  «Тусгай» = энэ ангийн ерөнхий утгууд (<see cref="Annotations"/>, <see cref="FadeMode"/> …).
        /// </summary>
        public Dictionary<string, WePreset> Presets = new Dictionary<string, WePreset>(StringComparer.Ordinal);
        /// <summary>
        /// Энэ ажиллуулалтын ӨГӨГДМӨЛ зориулалт: «Тусгай» (өмнөх зан төлөв — таны тохиргоо бүх өрөөнд), «Интерьер» товч → Интерьер.  «Тусгай» үед
        /// санал (ариун цэврийн өрөө) АВТОМАТААР хэрэглэгдэхгүй, зөвхөн харагдана.  Файлд ХАДГАЛАГДАХГҮЙ.
        /// </summary>
        public string DefaultPreset = WePresetId.Custom;
        /// <summary>Өрөө тус бүрд цонхонд сонгосон зориулалт (өрөөний UniqueId → id).  Файлд ХАДГАЛАГДАХГҮЙ — үүсгэсэн харагдац дээр хадгалагдана.</summary>
        public Dictionary<string, string> RoomPresets = new Dictionary<string, string>(StringComparer.Ordinal);

        /// <summary>Зориулалтын одоогийн утгууд (хуулбар).  «Тусгай» / танихгүй → ерөнхий утгууд.</summary>
        public WePreset PresetOf(string id)
        {
            if (id == WePresetId.Custom || !WePresetId.IsKnown(id))
                return new WePreset { Id = WePresetId.Custom, Annotations = Annotations, FadeMode = FadeMode, KeyPlan = KeyPlan, Axon = Axon,
                                      Perspectives = Perspectives, TemplateName = TemplateName ?? TemplateTypeDefault };
            WePreset p;
            return Presets != null && Presets.TryGetValue(id, out p) && p != null ? p.Clone() : WePresetCatalog.BuiltIn(id);
        }

        /// <summary>Зориулалтыг хадгална («Тусгай» → ерөнхий утгууд).</summary>
        public void SetPreset(WePreset p)
        {
            if (p == null) return;
            if (p.Id == WePresetId.Custom || !WePresetId.IsKnown(p.Id))
            {
                Annotations = WeAnno.Format(WeAnno.Parse(p.Annotations));
                FadeMode = p.FadeMode;
                KeyPlan = p.KeyPlan;
                Axon = p.Axon;
                Perspectives = Math.Max(0, Math.Min(4, p.Perspectives));
                TemplateName = p.TemplateName ?? TemplateTypeDefault;
                return;
            }
            if (Presets == null) Presets = new Dictionary<string, WePreset>(StringComparer.Ordinal);
            Presets[p.Id] = p.Clone();
        }

        /// <summary>
        /// Зориулалтыг хэрэглэсэн хуулбар (өрөөний төлөвлөгөө, хуудас, загвар): тэмдэглэгээ, бүдэг хэсэг, түлхүүр план, 3D, рендерийн байр, загвар,
        /// хуудасны тогтмол параметр.  «Тусгай» — өөрчлөлтгүй хуулбар.
        /// </summary>
        public WeSettings ForPreset(string id)
        {
            WeSettings c = Clone();
            if (id == WePresetId.Custom || !WePresetId.IsKnown(id)) return c;
            WePreset p = PresetOf(id);
            c.Annotations = WeAnno.Format(WeAnno.Parse(p.Annotations));
            c.FadeMode = p.FadeMode;
            c.KeyPlan = p.KeyPlan;
            c.Axon = p.Axon;
            c.Perspectives = Math.Max(0, Math.Min(4, p.Perspectives));
            c.TemplateName = p.TemplateName ?? TemplateTypeDefault;
            c.FixedSheetParams = new Dictionary<string, string>(p.SheetParams ?? new Dictionary<string, string>(), StringComparer.Ordinal);
            return c;
        }

        /// <summary>Өрөөний зориулалт: цонхонд сонгосон, үгүй бол өгөгдмөл (төлөвлөгч харагдац дээрх / саналыг өөрөө шийднэ).</summary>
        public string ChosenPresetFor(string roomUid)
        {
            string id;
            return RoomPresets != null && !string.IsNullOrEmpty(roomUid) && RoomPresets.TryGetValue(roomUid, out id) && WePresetId.IsKnown(id) ? id : null;
        }

        /// <summary>
        /// Ажлын зургийн бүрдэл (2026-10-14): Project Browser-ийн бүлэглэлтийн параметр (id) → утга — ШИНЭ хуудсанд бичнэ («Бүлэг» = «4. ИНТЕРЬЕР»).
        /// Файлд ХАДГАЛАГДАХГҮЙ (төсөл бүр өөр бүлэгтэй) — цонх анхны утгыг төслөөс (өмнө үүсгэсэн хуудас, оффисын дэлгээсийн хуудас) уншина.
        /// </summary>
        public Dictionary<string, string> SheetFolders = new Dictionary<string, string>(StringComparer.Ordinal);
        /// <summary>Цонхонд ӨӨРЧИЛСӨН түвшин — энэ удаагийн өрөөний өмнө үүсгэсэн хуудсыг ч шилжүүлнэ.</summary>
        public HashSet<string> SheetFoldersMove = new HashSet<string>(StringComparer.Ordinal);
        /// <summary>Тайланд: «Sheets › 4. ИНТЕРЬЕР › 4.2. Дотор дэлгээс».</summary>
        public string SheetFoldersPath;

        /// <summary>
        /// Хэрэгсэл автоматаар ҮҮСГЭХГҮЙ («шалгах», «дэмжигдэхгүй») гэсэн дэлгээсийг хэрэглэгч чагтлаж ХҮЧЭЭР үүсгэх (2026-10-14, интерьерийн
        /// баг).  Түлхүүр → <see cref="WePlannedElevation.Key"/>.  Файлд ХАДГАЛАГДАХГҮЙ (өрөө тус бүрийн сонголт).
        /// </summary>
        public HashSet<string> Forced = new HashSet<string>(StringComparer.Ordinal);

        /// <summary>
        /// Салбарын хэрэгсэл (2026-10-14): «Интерьер» туузан цэсний товчоор ажиллуулсан — хуудсанд <see cref="FixedSheetParams"/> ҮРГЭЛЖ.
        /// Файлд ХАДГАЛАГДАХГҮЙ (товч бүр өөрийн).
        /// </summary>
        public bool InteriorTool;
        /// <summary>Хуудасны тогтмол параметр (харагдах нэр → утга, <see cref="WeSheetDiscipline"/>) — шинэ болон энэ удаагийн хуудсанд бичнэ.</summary>
        public Dictionary<string, string> FixedSheetParams = new Dictionary<string, string>(StringComparer.Ordinal);
        /// <summary>
        /// Цонхонд СОНГОСОН хуудасны параметр (2026-10-14, интерьерийн баг 3-р тойрог: «* Type Designator»-ийг цонхноос сонгоно) — харагдах
        /// нэр → утга.  <see cref="FixedSheetParams"/>-ийн адил шинэ болон энэ удаагийн өрөөний хуудсанд бичигдэнэ.  Файлд ХАДГАЛАГДАХГҮЙ
        /// (төсөл бүрийн утга өөр — цонх анхны утгыг төслөөс уншина).
        /// </summary>
        public Dictionary<string, string> SheetParams = new Dictionary<string, string>(StringComparer.Ordinal);

        /// <summary>
        /// Өрөөний НЭМЭЛТ тал (2026-10-14, интерьерийн баг: «хана нэмэх дээр дарахад цонхон дотроо шинэ үсэг гарч ирээд хэмжээгээ өөрсдөө
        /// тохируулна») — өрөөний UniqueId → нэмэлт талын дугаар (<see cref="WeExtraSides"/>), нэмсэн дарааллаар.  Шугам нь <see cref="Overrides"/>-д
        /// (түлхүүр <see cref="WeExtraSides.Key"/>).  Файлд ХАДГАЛАГДАХГҮЙ: үүссэн дэлгээс (түлхүүр + шугам харагдац дээр) дахин ажиллуулахад санагдана.
        /// </summary>
        public Dictionary<string, List<string>> ExtraSides = new Dictionary<string, List<string>>(StringComparer.Ordinal);

        public void AddExtraSide(string roomUid, string id)
        {
            if (string.IsNullOrEmpty(roomUid) || string.IsNullOrEmpty(id)) return;
            if (ExtraSides == null) ExtraSides = new Dictionary<string, List<string>>(StringComparer.Ordinal);
            List<string> list;
            if (!ExtraSides.TryGetValue(roomUid, out list)) { list = new List<string>(); ExtraSides[roomUid] = list; }
            if (!list.Contains(id)) list.Add(id);
        }

        public bool RemoveExtraSide(string roomUid, string id)
        {
            List<string> list;
            if (ExtraSides == null || string.IsNullOrEmpty(roomUid) || !ExtraSides.TryGetValue(roomUid, out list)) return false;
            bool removed = list.Remove(id);
            if (list.Count == 0) ExtraSides.Remove(roomUid);
            return removed;
        }

        public bool HasExtraSide(string roomUid, string id)
        {
            List<string> list;
            return ExtraSides != null && !string.IsNullOrEmpty(roomUid) && ExtraSides.TryGetValue(roomUid, out list) && list.Contains(id);
        }

        /// <summary>Өрөөний цонхонд нэмсэн нэмэлт талын дугаарууд (дарааллаар); байхгүй бол хоосон.</summary>
        public IList<string> ExtraSidesOf(string roomUid)
        {
            List<string> list;
            return ExtraSides != null && !string.IsNullOrEmpty(roomUid) && ExtraSides.TryGetValue(roomUid, out list) ? (IList<string>)list : new string[0];
        }

        /// <summary>Хуудсанд бичих бүх параметр: тогтмол (интерьер) + цонхонд сонгосон.  Ижил нэр бол тогтмол нь давуу.</summary>
        public Dictionary<string, string> AllSheetParams()
        {
            var all = new Dictionary<string, string>(StringComparer.Ordinal);
            if (SheetParams != null)
                foreach (KeyValuePair<string, string> kv in SheetParams)
                    if (!string.IsNullOrWhiteSpace(kv.Key) && kv.Value != null) all[kv.Key] = kv.Value;
            if (FixedSheetParams != null)
                foreach (KeyValuePair<string, string> kv in FixedSheetParams)
                {
                    foreach (string k in new List<string>(all.Keys))
                        if (WeSheetDiscipline.NormalizeName(k) == WeSheetDiscipline.NormalizeName(kv.Key)) all.Remove(k);
                    all[kv.Key] = kv.Value;
                }
            return all;
        }

        public WeSettings Clone()
        {
            var c = (WeSettings)MemberwiseClone();
            c.Overrides = Overrides != null ? Overrides.Copy() : new WeOverrides();
            c.Crops = Crops != null ? Crops.Copy() : new WeCropOverrides();
            c.Presets = new Dictionary<string, WePreset>(StringComparer.Ordinal);
            if (Presets != null) foreach (KeyValuePair<string, WePreset> kv in Presets) if (kv.Value != null) c.Presets[kv.Key] = kv.Value.Clone();
            c.RoomPresets = RoomPresets != null ? new Dictionary<string, string>(RoomPresets, StringComparer.Ordinal) : new Dictionary<string, string>(StringComparer.Ordinal);
            c.SheetFolders = SheetFolders != null ? new Dictionary<string, string>(SheetFolders, StringComparer.Ordinal) : new Dictionary<string, string>(StringComparer.Ordinal);
            c.SheetFoldersMove = SheetFoldersMove != null ? new HashSet<string>(SheetFoldersMove, StringComparer.Ordinal) : new HashSet<string>(StringComparer.Ordinal);
            c.LegendNames = LegendNames != null ? new List<string>(LegendNames) : new List<string>();
            c.Forced = Forced != null ? new HashSet<string>(Forced, StringComparer.Ordinal) : new HashSet<string>(StringComparer.Ordinal);
            c.FixedSheetParams = FixedSheetParams != null ? new Dictionary<string, string>(FixedSheetParams, StringComparer.Ordinal) : new Dictionary<string, string>(StringComparer.Ordinal);
            c.SheetParams = SheetParams != null ? new Dictionary<string, string>(SheetParams, StringComparer.Ordinal) : new Dictionary<string, string>(StringComparer.Ordinal);
            c.ExtraSides = new Dictionary<string, List<string>>(StringComparer.Ordinal);
            if (ExtraSides != null)
                foreach (KeyValuePair<string, List<string>> kv in ExtraSides)
                    if (kv.Value != null && kv.Value.Count > 0) c.ExtraSides[kv.Key] = new List<string>(kv.Value);
            return c;
        }

        /// <summary>Хүчингүй утгын жагсаалт (хоосон = зөв).</summary>
        public List<string> Validate()
        {
            var errors = new List<string>();
            if (Scale < 1 || Scale > 5000) errors.Add("Масштаб 1–5000 хооронд байна.");
            if (!InRange(PaddingMm, 0, 10000)) errors.Add("Хүрээний зай 0–10000 мм.");
            if (!InRange(NearOffsetMm, 0, 20000)) errors.Add("Ханаас өмнөх харах зай 0–20000 мм.");
            if (!InRange(FarDepthMm, 0, 20000)) errors.Add("Ханын ард харах гүн 0–20000 мм.");
            if (!InRange(SheetMarginMm, 0, 200)) errors.Add("Хуудасны дотор зай 0–200 мм.");
            if (!InRange(SheetBottomBandMm, 0, 400)) errors.Add("Хуудасны доод зурвас 0–400 мм.");
            if (!InRange(DimOffsetMm, 20, 5000)) errors.Add("Хэмжээсийн эхний эгнээний зай 20–5000 мм.");
            if (!InRange(DimStepMm, 50, 5000)) errors.Add("Хэмжээсийн эгнээ хоорондын зай 50–5000 мм.");
            if (!InRange(MaxDepthMm, 300, 50000)) errors.Add("Харах гүний дээд хязгаар 300–50000 мм.");
            if (KeyPlanScale < 1 || KeyPlanScale > 5000) errors.Add("Түлхүүр планы масштаб 1–5000.");
            if (AxonScale < 1 || AxonScale > 5000) errors.Add("3D зургийн масштаб 1–5000.");
            if (!InRange(KeyPlanMarginMm, 0, 20000)) errors.Add("Түлхүүр планы хүрээ 0–20000 мм.");
            if (Perspectives < 0 || Perspectives > 4) errors.Add("Перспективын байр 0–4.");
            if (FadeMode == WeFadeMode.AboveHeight && !InRange(FadeHeightMm, 300, 20000)) errors.Add("Тод хэсгийн өндөр 300–20000 мм.");
            if (FadeOpacity < 0 || FadeOpacity > 100) errors.Add("Бүдэг хэсгийн харагдах байдал 0–100 %.");
            foreach (KeyValuePair<string, string> kv in new[]
            {
                new KeyValuePair<string, string>("Тэмдгийн загвар", LabelPattern),
                new KeyValuePair<string, string>("Гарчгийн загвар", TitlePattern),
                new KeyValuePair<string, string>("Хуудасны нэрийн загвар", SheetNamePattern),
            })
            {
                List<string> unknown = WeNaming.UnknownTokens(kv.Value);
                if (unknown.Count > 0) errors.Add(kv.Key + "т танихгүй хэсэг: " + string.Join(", ", unknown));
            }
            if (string.IsNullOrWhiteSpace(LabelPattern)) errors.Add("Тэмдгийн загвар хоосон байна.");
            if (string.IsNullOrWhiteSpace(NamePattern)) errors.Add("Нэрийн загвар хоосон байна.");
            else
            {
                List<string> unknown = WeNaming.UnknownTokens(NamePattern);
                if (unknown.Count > 0) errors.Add("Нэрийн загварт танихгүй хэсэг: " + string.Join(", ", unknown));
            }
            if (LabelMode == WeLabelMode.Numbers)
            {
                if (LabelStart < 0 || LabelStart > 99999) errors.Add("Тэмдгийн эхлэх дугаар 0–99999.");
                if (LabelEnd != 0 && LabelEnd < LabelStart) errors.Add("Тэмдгийн дуусах дугаар эхлэхээс бага байна (0 = хязгааргүй).");
                if (LabelDigits < 0 || LabelDigits > 6) errors.Add("Тэмдгийн оронгийн тоо 0–6.");
            }
            if (Output == WeOutputMode.ViewsAndSheets && SheetNumberMode == WeSheetNumberMode.Range)
            {
                if (SheetRangeStart < 0 || SheetRangeStart > 999999) errors.Add("Хуудасны мужийн эхлэх дугаар 0–999999.");
                if (SheetRangeEnd < SheetRangeStart) errors.Add("Хуудасны мужийн дуусах дугаар эхлэхээс бага байна.");
                if (SheetRangeDigits < 0 || SheetRangeDigits > 6) errors.Add("Хуудасны дугаарын оронгийн тоо 0–6.");
                if (!string.Equals(WeNaming.Clean(SheetRangePrefix ?? string.Empty), SheetRangePrefix ?? string.Empty, StringComparison.Ordinal))
                    errors.Add("Хуудасны угтварт хориотой тэмдэгт байна (\\ : { } [ ] | ; < > ? ` ~).");
            }
            if (Output == WeOutputMode.ViewsAndSheets)
            {
                if (string.IsNullOrWhiteSpace(SheetNumberPattern)) errors.Add("Хуудасны дугаарын загвар хоосон байна.");
                else
                {
                    List<string> unknown = WeNaming.UnknownTokens(SheetNumberPattern);
                    if (unknown.Count > 0) errors.Add("Хуудасны дугаарын загварт танихгүй хэсэг: " + string.Join(", ", unknown));
                }
            }
            return errors;
        }

        private static bool InRange(double v, double lo, double hi)
        {
            return !double.IsNaN(v) && v >= lo && v <= hi;
        }

        // ── Сериализаци ───────────────────────────────────────────────

        public string Serialize()
        {
            var sb = new StringBuilder();
            Line(sb, "version", FormatVersion.ToString(CultureInfo.InvariantCulture));
            Line(sb, "viewKind", ViewKind.ToString());
            Line(sb, "viewType", ViewTypeName);
            Line(sb, "template", TemplateName);
            Line(sb, "scale", Scale.ToString(CultureInfo.InvariantCulture));
            Line(sb, "paddingMm", PaddingMm.ToString("R", CultureInfo.InvariantCulture));
            Line(sb, "nearOffsetMm", NearOffsetMm.ToString("R", CultureInfo.InvariantCulture));
            Line(sb, "farDepthMm", FarDepthMm.ToString("R", CultureInfo.InvariantCulture));
            Line(sb, "namePattern", NamePattern);
            Line(sb, "wallSide", WallSide.ToString());
            Line(sb, "output", Output.ToString());
            Line(sb, "titleBlock", TitleBlockName);
            Line(sb, "sheetNumberPattern", SheetNumberPattern);
            Line(sb, "sheetMarginMm", SheetMarginMm.ToString("R", CultureInfo.InvariantCulture));
            Line(sb, "materialNotes", MaterialNotes ? "1" : "0");
            Line(sb, "sheetBottomBandMm", SheetBottomBandMm.ToString("R", CultureInfo.InvariantCulture));
            Line(sb, "updateExisting", UpdateExisting ? "1" : "0");
            Line(sb, "hideMarkers", HideOtherMarkers ? "1" : "0");
            Line(sb, "hideOwnOnSheets", HideOwnMarkersOnSheets ? "1" : "0");
            Line(sb, "reviewPanel", ReviewPanel ? "1" : "0");
            Line(sb, "livePreview", LivePreview ? "1" : "0");
            Line(sb, "annotations", WeAnno.Format(WeAnno.Parse(Annotations)));
            Line(sb, "dimType", DimTypeName);
            Line(sb, "spotType", SpotTypeName);
            Line(sb, "keynoteType", KeynoteTypeName);
            Line(sb, "dimOffsetMm", DimOffsetMm.ToString("R", CultureInfo.InvariantCulture));
            Line(sb, "dimStepMm", DimStepMm.ToString("R", CultureInfo.InvariantCulture));
            Line(sb, "dimGrouping", DimGrouping.ToString());
            Line(sb, "overallRow", OverallRow ? "1" : "0");
            Line(sb, "mergeSides", MergeCollinear ? "1" : "0");
            Line(sb, "depthMode", DepthMode.ToString());
            Line(sb, "maxDepthMm", MaxDepthMm.ToString("R", CultureInfo.InvariantCulture));
            Line(sb, "labelPattern", LabelPattern);
            Line(sb, "titlePattern", TitlePattern);
            Line(sb, "sheetNamePattern", SheetNamePattern);
            Line(sb, "labelMode", LabelMode.ToString());
            Line(sb, "labelStart", LabelStart.ToString(CultureInfo.InvariantCulture));
            Line(sb, "labelEnd", LabelEnd.ToString(CultureInfo.InvariantCulture));
            Line(sb, "labelDigits", LabelDigits.ToString(CultureInfo.InvariantCulture));
            Line(sb, "labelContinuous", LabelContinuous ? "1" : "0");
            Line(sb, "sheetNumberMode", SheetNumberMode.ToString());
            Line(sb, "sheetRangePrefix", SheetRangePrefix);
            Line(sb, "sheetRangeStart", SheetRangeStart.ToString(CultureInfo.InvariantCulture));
            Line(sb, "sheetRangeEnd", SheetRangeEnd.ToString(CultureInfo.InvariantCulture));
            Line(sb, "sheetRangeDigits", SheetRangeDigits.ToString(CultureInfo.InvariantCulture));
            Line(sb, "keyPlan", KeyPlan ? "1" : "0");
            Line(sb, "keyPlanScale", KeyPlanScale.ToString(CultureInfo.InvariantCulture));
            Line(sb, "keyPlanMarginMm", KeyPlanMarginMm.ToString("R", CultureInfo.InvariantCulture));
            Line(sb, "axon", Axon ? "1" : "0");
            Line(sb, "axonScale", AxonScale.ToString(CultureInfo.InvariantCulture));
            Line(sb, "perspectives", Perspectives.ToString(CultureInfo.InvariantCulture));
            Line(sb, "legends", string.Join(LegendSeparator.ToString(), CleanLegends(LegendNames)));
            Line(sb, "fadeMode", FadeMode.ToString());
            Line(sb, "fadeHeightMm", FadeHeightMm.ToString("R", CultureInfo.InvariantCulture));
            Line(sb, "fadeOpacity", FadeOpacity.ToString(CultureInfo.InvariantCulture));
            Line(sb, "redFrame", RedFrame ? "1" : "0");
            Line(sb, "renderPlacement", RenderPlacement.ToString());
            foreach (string id in new[] { WePresetId.Interior, WePresetId.Architecture, WePresetId.Bathroom })
                Line(sb, "preset." + id, PresetOf(id).Serialize());
            return sb.ToString();
        }

        private static void Line(StringBuilder sb, string key, string value)
        {
            // Мөр таслал утгад орохгүй (нэрийн загвар нэг мөр).
            string v = (value ?? string.Empty).Replace("\r", " ").Replace("\n", " ");
            sb.Append(key).Append('=').Append(v).Append('\n');
        }

        /// <summary>Хэзээ ч throw хийхгүй: буруу мөр/утга → өгөгдмөл.</summary>
        public static WeSettings Deserialize(string text)
        {
            var s = new WeSettings();
            if (string.IsNullOrEmpty(text)) return s;
            bool kindSeen = false, legendsSeen = false, presetsSeen = false;
            foreach (string raw in text.Split('\n'))
            {
                string line = raw.TrimEnd('\r');
                int eq = line.IndexOf('=');
                if (eq <= 0) continue;
                string key = line.Substring(0, eq).Trim();
                string val = line.Substring(eq + 1);
                switch (key)
                {
                    case "viewKind": s.ViewKind = ParseEnum(val, s.ViewKind); kindSeen = true; break;
                    case "viewType": s.ViewTypeName = val.Trim(); break;
                    case "template": s.TemplateName = val.Trim(); break;
                    case "scale": s.Scale = ParseInt(val, s.Scale, 1, 5000); break;
                    case "paddingMm": s.PaddingMm = ParseDouble(val, s.PaddingMm, 0, 10000); break;
                    case "nearOffsetMm": s.NearOffsetMm = ParseDouble(val, s.NearOffsetMm, 0, 20000); break;
                    case "farDepthMm": s.FarDepthMm = ParseDouble(val, s.FarDepthMm, 0, 20000); break;
                    case "namePattern": if (!string.IsNullOrWhiteSpace(val)) s.NamePattern = val.Trim(); break;
                    case "wallSide": s.WallSide = ParseEnum(val, s.WallSide); break;
                    case "output": s.Output = ParseEnum(val, s.Output); break;
                    case "titleBlock": s.TitleBlockName = val.Trim(); break;
                    case "sheetNumberPattern": if (!string.IsNullOrWhiteSpace(val)) s.SheetNumberPattern = val.Trim(); break;
                    case "sheetMarginMm":
                        s.SheetMarginMm = ParseDouble(val, s.SheetMarginMm, 0, 200);
                        if (s.SheetMarginMm == PreviousSheetMarginMm) s.SheetMarginMm = new WeSettings().SheetMarginMm;   // хуучин өгөгдмөл
                        break;
                    case "materialNotes": s.MaterialNotes = val.Trim() != "0"; break;
                    case "sheetBottomBandMm": s.SheetBottomBandMm = ParseDouble(val, s.SheetBottomBandMm, 0, 400); break;
                    case "updateExisting": s.UpdateExisting = val.Trim() != "0"; break;
                    case "hideMarkers": s.HideOtherMarkers = val.Trim() != "0"; break;
                    case "hideOwnOnSheets": s.HideOwnMarkersOnSheets = val.Trim() != "0"; break;
                    case "reviewPanel": s.ReviewPanel = val.Trim() != "0"; break;
                    case "livePreview": s.LivePreview = val.Trim() != "0"; break;
                    case "annotations":
                        s.Annotations = WeAnno.Format(WeAnno.Parse(val));
                        // Хэрэглэгч хүснэгтийг өөрчлөөгүй (аль нэг хуучин өгөгдмөл) бол шинэ өгөгдмөл (шалны spot, интерьерийн мөрүүд).
                        foreach (string old in WeAnno.PreviousDefaultSets)
                            if (s.Annotations == WeAnno.Format(WeAnno.Parse(old))) { s.Annotations = WeAnno.Format(WeAnno.Parse(WeAnno.DefaultSet)); break; }
                        break;
                    case "dimType": s.DimTypeName = val.Trim(); break;
                    case "spotType": s.SpotTypeName = val.Trim(); break;
                    case "keynoteType": s.KeynoteTypeName = val.Trim(); break;
                    // «annoOffsetMm»/«annoStepMm» (цаасны мм, 2026-10-14 хүртэл) — зориуд үл тоогдоно: загварын 300/300 руу шилжинэ.
                    case "dimOffsetMm": s.DimOffsetMm = ParseDouble(val, s.DimOffsetMm, 20, 5000); break;
                    case "dimStepMm": s.DimStepMm = ParseDouble(val, s.DimStepMm, 50, 5000); break;
                    case "dimGrouping": s.DimGrouping = ParseEnum(val, s.DimGrouping); break;
                    case "overallRow": s.OverallRow = val.Trim() != "0"; break;
                    case "mergeSides": s.MergeCollinear = val.Trim() != "0"; break;
                    case "depthMode": s.DepthMode = ParseEnum(val, s.DepthMode); break;
                    case "maxDepthMm": s.MaxDepthMm = ParseDouble(val, s.MaxDepthMm, 300, 50000); break;
                    case "labelPattern": if (!string.IsNullOrWhiteSpace(val)) s.LabelPattern = val.Trim(); break;
                    case "titlePattern": s.TitlePattern = val.Trim(); break;
                    case "sheetNamePattern": if (!string.IsNullOrWhiteSpace(val)) s.SheetNamePattern = val.Trim(); break;
                    case "labelMode": s.LabelMode = ParseEnum(val, s.LabelMode); break;
                    case "labelStart": s.LabelStart = ParseInt(val, s.LabelStart, 0, 99999); break;
                    case "labelEnd": s.LabelEnd = ParseInt(val, s.LabelEnd, 0, 99999); break;
                    case "labelDigits": s.LabelDigits = ParseInt(val, s.LabelDigits, 0, 6); break;
                    case "labelContinuous": s.LabelContinuous = val.Trim() == "1"; break;
                    case "sheetNumberMode": s.SheetNumberMode = ParseEnum(val, s.SheetNumberMode); break;
                    case "sheetRangePrefix": s.SheetRangePrefix = WeNaming.Clean(val); break;
                    case "sheetRangeStart": s.SheetRangeStart = ParseInt(val, s.SheetRangeStart, 0, 999999); break;
                    case "sheetRangeEnd": s.SheetRangeEnd = ParseInt(val, s.SheetRangeEnd, 0, 999999); break;
                    case "sheetRangeDigits": s.SheetRangeDigits = ParseInt(val, s.SheetRangeDigits, 0, 6); break;
                    case "keyPlan": s.KeyPlan = val.Trim() != "0"; break;
                    case "keyPlanScale": s.KeyPlanScale = ParseInt(val, s.KeyPlanScale, 1, 5000); break;
                    case "keyPlanMarginMm": s.KeyPlanMarginMm = ParseDouble(val, s.KeyPlanMarginMm, 0, 20000); break;
                    case "axon": s.Axon = val.Trim() != "0"; break;
                    case "axonScale": s.AxonScale = ParseInt(val, s.AxonScale, 1, 5000); break;
                    case "perspectives": s.Perspectives = ParseInt(val, s.Perspectives, 0, 4); break;
                    case "legend": if (!legendsSeen) s.LegendNames = CleanLegends(new[] { val }); break;   // хуучин файл — ганц legend
                    case "legends": s.LegendNames = CleanLegends(val.Split(LegendSeparator)); legendsSeen = true; break;
                    case "fadeMode": s.FadeMode = ParseEnum(val, s.FadeMode); break;
                    case "fadeHeightMm": s.FadeHeightMm = ParseDouble(val, s.FadeHeightMm, 300, 20000); break;
                    case "fadeOpacity": s.FadeOpacity = ParseInt(val, s.FadeOpacity, 0, 100); break;
                    case "redFrame": s.RedFrame = val.Trim() != "0"; break;
                    case "renderPlacement": s.RenderPlacement = ParseEnum(val, s.RenderPlacement); break;
                    default:
                        if (key.StartsWith("preset.", StringComparison.Ordinal))
                        {
                            string id = key.Substring("preset.".Length);
                            if (WePresetId.IsKnown(id) && id != WePresetId.Custom) { s.Presets[id] = WePreset.Parse(id, val, WePresetCatalog.BuiltIn(id)); presetsSeen = true; }
                        }
                        break;
                }
            }
            if (!presetsSeen) MigratePresets(s);
            // Хуучин файл (харагдацын төрлийн сонголтгүй үеийнх): нэр нь ЗҮСЭЛТИЙН төрөл байсан тул Elevation-ий төрөлд хэрэглэхгүй —
            // хоосолно (өөрийн «Ханын дэлгээс» төрөл).  Урьдчилсан дүнд шинэ өгөгдмөлийг сануулна.
            if (!kindSeen && text.IndexOf('=') > 0)
            {
                s.FromOlderFile = true;
                s.ViewTypeName = string.Empty;
            }
            return s;
        }

        /// <summary>
        /// W09: зориулалтгүй (өмнөх хувилбарын) файл — хэрэглэгчийн ӨӨРЧИЛСӨН ерөнхий утгыг (өгөгдмөлөөс ялгаатай талбар бүр) «Интерьер», «Архитектур»
        /// зориулалтад хуулна: хоёр товчийн аль нь ч өмнөх тохиргоогоороо үргэлжилнэ.  Өөрчлөөгүй талбар — тухайн зориулалтын суурь утга.  «Ариун цэврийн
        /// өрөө» шинэ тул суурь утгаараа.
        /// </summary>
        private static void MigratePresets(WeSettings s)
        {
            var d = new WeSettings();
            foreach (string id in new[] { WePresetId.Interior, WePresetId.Architecture })
            {
                WePreset p = WePresetCatalog.BuiltIn(id);
                if (WeAnno.Format(WeAnno.Parse(s.Annotations)) != WeAnno.Format(WeAnno.Parse(d.Annotations))) p.Annotations = s.Annotations;
                if (s.FadeMode != d.FadeMode) p.FadeMode = s.FadeMode;
                if (s.KeyPlan != d.KeyPlan) p.KeyPlan = s.KeyPlan;
                if (s.Axon != d.Axon) p.Axon = s.Axon;
                if (s.Perspectives != d.Perspectives) p.Perspectives = s.Perspectives;
                if (!string.Equals(s.TemplateName ?? string.Empty, d.TemplateName ?? string.Empty, StringComparison.Ordinal)) p.TemplateName = s.TemplateName;
                s.Presets[id] = p;
            }
        }

        /// <summary>Хоосон, давхардсан нэрийг хасна (дарааллыг хадгална).</summary>
        public static List<string> CleanLegends(IEnumerable<string> names)
        {
            var r = new List<string>();
            if (names == null) return r;
            foreach (string n in names)
            {
                string t = (n ?? string.Empty).Trim();
                if (t.Length > 0 && !r.Contains(t)) r.Add(t);
            }
            return r;
        }

        private static int ParseInt(string v, int fallback, int lo, int hi)
        {
            int r;
            return int.TryParse(v.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out r) && r >= lo && r <= hi ? r : fallback;
        }

        private static double ParseDouble(string v, double fallback, double lo, double hi)
        {
            double r;
            return double.TryParse(v.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out r) && r >= lo && r <= hi ? r : fallback;
        }

        private static T ParseEnum<T>(string v, T fallback) where T : struct
        {
            T r;
            return Enum.TryParse(v.Trim(), false, out r) && Enum.IsDefined(typeof(T), r) ? r : fallback;
        }
    }
}
