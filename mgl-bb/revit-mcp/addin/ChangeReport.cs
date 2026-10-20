using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitMcpAddin
{
    /// <summary>
    /// ӨӨРЧЛӨЛТИЙГ ХҮНИЙ УНШИХ ЖАГСААЛТ БОЛГОХ + тэр зүйл рүү нь үсрэх.
    ///
    /// ⚠️ ЯАГААД ЭНЭ ГАРСАН БЭ (2026-08-26, архитекторын хүсэлт):
    /// «Өөрчлөлтүүд хэсэг нь нэмсэн/өөрчилсөн гэсэн хоёрхон тоо гаргадаг.
    ///  Аль хуудсанд ямар хана, багана, шал, дээвэр, тааз дээр яг юу хийснийг
    ///  харуулж, дээр нь дарахад тэр рүү нь шууд үсэрч тодруулдаг болгомоор
    ///  байна.»
    ///
    /// `ChangeTracker` нь элементийн id-г АЛЬ ХЭДИЙН бүрэн хадгалдаг байсан —
    /// `RevitTools.DiffSinceBaseline` тэднийг зориудаар нуудаг байв
    /// («ХЭРЭГЦЭЭ гарах хүртэл нэмэхгүй»).  Тиймээс энэ ангид ШИНЭ СКАННЕР
    /// БАЙХГҮЙ: аль хэдийн байгаа id-нуудыг ЛАВЛАХ л хийнэ.
    ///
    /// ⚠️ ГУРВАН ЗАРЧИМ, гурвуулаа өмнөх гацааны сургамжаас гарсан:
    ///
    ///   1. СУУРЬ ЖАГСААЛТ НЬ ХАРАГДАЦЫГ ХӨНДӨХГҮЙ.  `doc.GetElement(id)` нь
    ///      индексийн лавлагаа — regenerate үүсгэхгүй.  200 өөрчлөлтийг
    ///      тайлбарлах нь миллисекундын ажил.
    ///
    ///   2. «АЛЬ ХУУДСАНД» ГЭДГИЙГ ЗӨВХӨН ДАРАХАД тооцно.  Хана бол загварын
    ///      элемент — олон хуудсанд зэрэг харагдана, Revit-д «энэ элемент энэ
    ///      хуудсанд харагдаж байна уу» гэж хямдхан асуух API БАЙХГҮЙ
    ///      (`IsElementVisibleInView` гэж байхгүйг реф ассемблиэс шалгасан).
    ///      Мэдэх цорын ганц зам нь харагдацыг дахин тооцуулах — яг тэр нь
    ///      2026-08-25-ны 120 секундын гацааг үүсгэсэн.  Тиймээс өртгийг
    ///      ЗӨВХӨН хэрэглэгч нэг мөр дээр дарах үед, ЦАГИЙН ТӨСӨВТЭЙ төлнө.
    ///
    ///   3. `ShowElements` ХЭЗЭЭ Ч ДУУДАХГҮЙ.  Элемент нээлттэй харагдацаас
    ///      олдохгүй бол тэр нь модаль TaskDialog гаргаж, ExternalEvent-ийн
    ///      боловсруулагч дотор Revit-ийн үндсэн thread-ийг хүн товч дарах
    ///      хүртэл бүхэлд нь блоклодог (`RevitTools.IsolateSheetElements`-ийн
    ///      тайлбарыг үз — тэндээс яг үүний улмаас устгасан).  Оронд нь
    ///      харагдацыг сольж → сонгож → хүрээ рүү нь ойртуулна.  Гурвуулаа
    ///      цонх гаргадаггүй.
    /// </summary>
    internal static class ChangeReport
    {
        private static readonly JsonSerializerOptions Json = new JsonSerializerOptions
        {
            WriteIndented = false,
        };

        /// <summary>
        /// Тайлбарлах элементийн ХАТУУ дээд хязгаар — зөвхөн эмгэг тохиолдлын
        /// хамгаалалт (скрипт хэдэн мянган элемент үүсгэсэн).
        ///
        /// ⚠️ ЭНЭ НЬ ДЭЛГЭЦИЙН ХЯЗГААР БИШ.  Урьд нь 400 байсан ба `HashSet`-ийг
        /// дунд нь таслдаг байв — HashSet-ийн дараалал дурын учир хэрэглэгч
        /// «сүүлийн 400» БИШ, «санамсаргүй 400»-г хардаг байсан бөгөөд мөр бүр
        /// цагтай тул үнэн шиг харагддаг байв.  Тайлбарлах нь индексийн лавлагаа
        /// тул хямд — БҮГДИЙГ тайлбарлаад, ЭРЭМБЭЛСНИЙ ДАРАА л таслана.
        /// </summary>
        private const int MaxItems = 5000;

        /// <summary>Нэг категорид харуулах дээд мөр; үлдсэнийг «+N» гэж хэлнэ.</summary>
        private const int MaxItemsPerGroup = 60;

        /// <summary>Хуудас хайхад зарцуулах цагийн ДЭЭД төсөв (мс).</summary>
        private const int SearchBudgetMs = 2500;

        /// <summary>Хуудас хайхад шалгах харагдацын дээд тоо.</summary>
        private const int MaxViewsChecked = 60;

        /// <summary>
        /// `change_digest`-ийн хуудас хайлтад зарцуулах НИЙТ цагийн төсөв (мс).
        ///
        /// ⚠️ Бүлэг тутамд БИШ, БҮГДЭД нь.  Ноорог бэлдэх нь өдөрт нэг удаагийн
        /// үйлдэл тул хэдэн секунд төлж болно; гэхдээ хязгааргүй байвал 20
        /// бүлэгтэй өдөр 50 секунд болж, хэрэглэгч гацсан гэж бодно.
        /// </summary>
        private const int DigestBudgetMs = 4000;

        /// <summary>Тайланд оруулах бүлгийн дээд тоо — үлдсэнийг «бусад» гэж хэлнэ.</summary>
        private const int MaxDigestGroups = 10;

        /// <summary>Бүлгийн хуудсыг тогтооход хэдэн элемент дээжлэх вэ.</summary>
        private const int SheetSamplesPerGroup = 3;

        /* ============================================================== */
        /*  Нэрийн орчуулга                                                */
        /* ============================================================== */

        /// <summary>
        /// Revit-ийн категорийн нэр → монгол.
        ///
        /// ⚠️ Танихгүй нэрийг ЯГ ТЭР ХЭВЭЭР нь харуулна.  Revit-ийн категорийн
        /// нэр нь суулгацын хэлнээс хамаардаг тул бүрэн жагсаалт гаргах гэж
        /// оролдох нь худал орчуулга төрүүлнэ — «мэдэхгүй» гэдгээ шударгаар
        /// хэлэх нь дээр.
        /// </summary>
        private static readonly Dictionary<string, string> CatMn =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                { "Walls", "Хана" },
                { "Structural Columns", "Багана /бүтээц/" },
                { "Columns", "Багана" },
                { "Floors", "Шал" },
                { "Roofs", "Дээвэр" },
                { "Ceilings", "Тааз" },
                { "Doors", "Хаалга" },
                { "Windows", "Цонх" },
                { "Stairs", "Шат" },
                { "Ramps", "Налуу зам" },
                { "Railings", "Хашлага" },
                { "Curtain Panels", "Хөшигт хана — хавтан" },
                { "Curtain Wall Mullions", "Хөшигт хана — хөндлөвч" },
                { "Curtain Systems", "Хөшигт систем" },
                { "Structural Framing", "Дам нуруу" },
                { "Structural Foundations", "Суурь" },
                { "Structural Rebar", "Арматур" },
                { "Rooms", "Өрөө" },
                { "Areas", "Талбай" },
                { "Furniture", "Тавилга" },
                { "Furniture Systems", "Тавилгын систем" },
                { "Casework", "Шүүгээ" },
                { "Plumbing Fixtures", "Ариун цэврийн хэрэгсэл" },
                { "Lighting Fixtures", "Гэрэлтүүлэг" },
                { "Electrical Equipment", "Цахилгаан тоноглол" },
                { "Electrical Fixtures", "Цахилгаан хэрэгсэл" },
                { "Mechanical Equipment", "Механик тоноглол" },
                { "Ducts", "Агаарын суваг" },
                { "Pipes", "Хоолой" },
                { "Generic Models", "Ерөнхий загвар" },
                { "Site", "Гадна талбай" },
                { "Topography", "Гадаргуу" },
                { "Parking", "Зогсоол" },
                { "Planting", "Ногоон байгууламж" },
                { "Grids", "Тэнхлэг" },
                { "Levels", "Түвшин" },
                { "Dimensions", "Хэмжээс" },
                { "Text Notes", "Тэмдэглэл" },
                { "Detail Items", "Дэлгэрэнгүй эд анги" },
                { "Lines", "Шугам" },
                { "Filled region", "Дүүргэлт" },
                { "Model Groups", "Загварын бүлэг" },
                { "Parts", "Хэсэг" },
                { "Assemblies", "Угсрамж" },
                { "Sheets", "Хуудас" },
                { "Views", "Харагдац" },
                { "Viewports", "Харагдацын хүрээ" },
                { "Raster Images", "Зураг" },
                { "Materials", "Материал" },
            };

        /// <summary>
        /// Хэрэглэгчийн ӨӨРИЙНХ нь нэрлэсэн дараалал.  «хана, багана, шал,
        /// дээвэр, тааз» — эдгээр нь жагсаалтын ТЭРГҮҮНД гарна, үлдсэн нь
        /// тооны дарааллаар.
        /// </summary>
        private static readonly string[] Priority =
        {
            "Walls",
            "Structural Columns",
            "Columns",
            "Floors",
            "Roofs",
            "Ceilings",
        };

        /// <summary>Revit-ийн гүйлгээний нэр → монгол.  Танихгүйг хэвээр нь.</summary>
        private static readonly Dictionary<string, string> OpMn =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                { "Move", "зөөсөн" },
                // Хулганаар чирэхэд Revit «Drag» гэж нэрлэдэг — «Move» БИШ.
                { "Drag", "чирсэн" },
                { "Drag Element", "чирсэн" },
                { "Delete", "устгасан" },
                { "Copy", "хуулсан" },
                { "Paste", "буулгасан" },
                { "Rotate", "эргүүлсэн" },
                { "Mirror", "толин тусгал" },
                { "Array", "олшруулсан" },
                { "Align", "тэгшилсэн" },
                { "Trim", "тайрсан" },
                { "Extend", "уртасгасан" },
                { "Offset", "зөрүүлсэн" },
                { "Split Element", "хуваасан" },
                { "Pin", "бэхэлсэн" },
                { "Unpin", "бэхэлгээ авсан" },
                { "Change Type", "төрөл сольсон" },
                { "Change Element Type", "төрөл сольсон" },
                { "Modify element attributes", "шинж чанар зассан" },
                { "Modify Element", "зассан" },
                { "Edit Sketch", "эскиз зассан" },
                { "Finish Sketch", "эскиз дуусгасан" },
                { "Change Instance Parameter", "параметр зассан" },
                { "Change Type Parameter", "төрлийн параметр зассан" },
            };

        private static string CategoryLabel(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return "Бусад";
            string mn;
            return CatMn.TryGetValue(raw, out mn) ? mn : raw;
        }

        /// <summary>
        /// Үйлдлийн товч тайлбар.  `undo:` / `redo:` угтварыг ЯЛГАНА — тэдгээрийн
        /// гүйлгээний нэр нь ҮНДСЭН үйлдлийнх байдаг тул ялгахгүй бол буцаасан
        /// зүйлийг «зөөсөн» гэж ХУДАЛ харагдуулна.
        /// </summary>
        private static string OpLabel(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw) || raw == "?") return null;

            string prefix = null;
            string name = raw;
            if (raw.StartsWith("undo:", StringComparison.Ordinal))
            {
                prefix = "буцаасан";
                name = raw.Substring(5);
            }
            else if (raw.StartsWith("redo:", StringComparison.Ordinal))
            {
                prefix = "сэргээсэн";
                name = raw.Substring(5);
            }

            string mn;
            string body = OpMn.TryGetValue(name, out mn) ? mn : name;
            if (string.IsNullOrWhiteSpace(body) || body == "?") body = null;

            if (prefix == null) return body;
            return body == null ? prefix : prefix + " (" + body + ")";
        }

        private static string KindLabel(string kind)
        {
            switch (kind)
            {
                case "added": return "нэмсэн";
                case "deleted": return "устгасан";
                default: return "зассан";
            }
        }

        /* ============================================================== */
        /*  1. list_changes — жагсаалт (ХАРАГДАЦ ХӨНДӨХГҮЙ)               */
        /* ============================================================== */

        private sealed class Row
        {
            public long id { get; set; }
            public string category { get; set; }
            public string category_label { get; set; }
            public string type_name { get; set; }
            public string level { get; set; }
            public string kind { get; set; }
            public string kind_label { get; set; }
            public string op { get; set; }
            public string op_label { get; set; }
            public string at { get; set; }
            public long at_sec { get; set; }
            public bool view_specific { get; set; }
            /// <summary>Хэдэн удаа хөндсөн — ЗӨВХӨН инженерийн самбарт.</summary>
            public int hits { get; set; }
        }

        public static string ListChanges(Document doc, JsonElement args)
        {
            ChangeTracker.Change ch;
            if (!ChangeTracker.TryGet(doc, out ch))
            {
                return JsonSerializer.Serialize(new
                {
                    baseline_at = (string)null,
                    groups = new object[0],
                    visible_total = 0,
                    raw_total = 0,
                    hidden_total = 0,
                    gone_total = 0,
                    truncated = false,
                    meta_truncated = false,
                    warnings = new[] { "no_baseline" },
                }, Json);
            }

            var rows = new List<Row>();
            int hidden = 0;
            int gone = 0;
            bool capped = false;

            Describe(doc, ch, ch.Added, "added", rows, ref hidden, ref gone, ref capped);
            Describe(doc, ch, ch.Modified, "modified", rows, ref hidden, ref gone, ref capped);
            // ⚠️ Устгасан элементийг ДАРАА НЬ тайлбарлах БОЛОМЖГҮЙ: `DocumentChanged`
            // нь устгал БОЛСНЫ ДАРАА дуудагддаг тул тэр агшинд ч элемент аль
            // хэдийн алга болсон байдаг.  Ямар нэг шалтгаанаар одоо ч байвал
            // (sync буцааж авчирсан) тайлбарлана, эс бөгөөс зөвхөн ТООЛНО.
            Describe(doc, ch, ch.Deleted, "deleted", rows, ref hidden, ref gone, ref capped);

            // Категориор бүлэглэнэ.
            var byCat = new Dictionary<string, List<Row>>(StringComparer.Ordinal);
            foreach (Row r in rows)
            {
                List<Row> list;
                if (!byCat.TryGetValue(r.category, out list))
                {
                    list = new List<Row>();
                    byCat[r.category] = list;
                }
                list.Add(r);
            }

            var groups = new List<object>();
            foreach (KeyValuePair<string, List<Row>> kv in Sorted(byCat))
            {
                List<Row> list = kv.Value;
                // Сүүлд хөндсөн нь ДЭЭР — хүн юун дээр дөнгөж сая ажилласнаа хайдаг.
                list.Sort((a, b) => b.at_sec.CompareTo(a.at_sec));

                int shown = Math.Min(list.Count, MaxItemsPerGroup);
                var items = new List<Row>(shown);
                for (int i = 0; i < shown; i++) items.Add(list[i]);

                groups.Add(new
                {
                    key = kv.Key,
                    label = CategoryLabel(kv.Key),
                    count = list.Count,
                    more = list.Count - shown,
                    items,
                });
            }

            var warnings = new List<string>();
            if (!ChangeTracker.Started) warnings.Add("tracking_unavailable");
            if (ch.Truncated) warnings.Add("truncated");
            if (ch.MetaTruncated) warnings.Add("meta_truncated");
            if (capped) warnings.Add("items_capped");
            if ((DateTime.UtcNow - ch.BaselineAtUtc).TotalHours > 24) warnings.Add("stale_baseline");

            int touches = 0;
            foreach (Row r in rows) touches += Math.Max(1, r.hits);

            return JsonSerializer.Serialize(new
            {
                baseline_at = ch.BaselineAtUtc.ToString("o", CultureInfo.InvariantCulture),
                groups,
                visible_total = rows.Count,
                raw_total = ch.Total,
                // ⚠️ ЗӨВХӨН САМБАРТ.  `change_digest` (тайлангийн баримт) энэ
                // тоог ОГТ буцаадаггүй — тайланд орох ёсгүй тул тэнд байх ч
                // шаардлагагүй.
                total_touches = touches,
                // ⚠️ ЭНЭ ТООГ ЗААВАЛ ХАРУУЛНА.  Revit нэг хана зөөхөд түүнтэй
                // холбогдсон эскиз, өрөөний зааг, залгаа хана зэргийг ч
                // «өөрчлөгдсөн» гэж мэдэгддэг.  Тэднийг чимээгүй хаявал
                // «47 өөрчлөлт» гэж хэлээд 12 мөр харуулах болно — хэрэглэгч
                // системд итгэхээ болино.
                hidden_total = hidden,
                gone_total = gone,
                truncated = ch.Truncated,
                meta_truncated = ch.MetaTruncated,
                warnings = warnings.ToArray(),
            }, Json);
        }

        /// <summary>Бүлгүүдийг дараалалд оруулна: нэрлэсэн категори эхэлж, дараа нь тоогоор.</summary>
        private static List<KeyValuePair<string, List<Row>>> Sorted(Dictionary<string, List<Row>> byCat)
        {
            var list = new List<KeyValuePair<string, List<Row>>>(byCat);
            list.Sort((a, b) =>
            {
                int pa = PriorityOf(a.Key);
                int pb = PriorityOf(b.Key);
                if (pa != pb) return pa.CompareTo(pb);
                int c = b.Value.Count.CompareTo(a.Value.Count);
                if (c != 0) return c;
                return string.Compare(a.Key, b.Key, StringComparison.OrdinalIgnoreCase);
            });
            return list;
        }

        private static int PriorityOf(string category)
        {
            for (int i = 0; i < Priority.Length; i++)
            {
                if (string.Equals(Priority[i], category, StringComparison.OrdinalIgnoreCase)) return i;
            }
            return Priority.Length;
        }

        private static void Describe(
            Document doc,
            ChangeTracker.Change ch,
            HashSet<long> ids,
            string kind,
            List<Row> rows,
            ref int hidden,
            ref int gone,
            ref bool capped)
        {
            foreach (long idValue in ids)
            {
                if (rows.Count >= MaxItems) { capped = true; return; }

                Element el = null;
                try { el = doc.GetElement(new ElementId(idValue)); }
                catch { }

                if (el == null) { gone++; continue; }
                if (el is ElementType) { hidden++; continue; }

                Category cat = null;
                try { cat = el.Category; } catch { }
                if (cat == null) { hidden++; continue; }

                CategoryType ct;
                try { ct = cat.CategoryType; }
                catch { hidden++; continue; }

                // ⚠️ Internal / AnalyticalModel нь хэрэглэгчийн ЗУРСАН зүйл БИШ —
                // эскиз, тусламжийн хавтгай, дүн шинжилгээний загвар.  Тэднийг
                // харуулах нь жагсаалтыг ашиггүй болгоно.
                if (ct != CategoryType.Model && ct != CategoryType.Annotation)
                {
                    hidden++;
                    continue;
                }

                string op = ch.OpOf(idValue);
                DateTime? at = ch.AtOf(idValue);
                bool viewSpecific = false;
                try { viewSpecific = el.ViewSpecific; } catch { }

                rows.Add(new Row
                {
                    id = idValue,
                    category = cat.Name ?? "?",
                    category_label = CategoryLabel(cat.Name),
                    type_name = TypeLabelOf(doc, el),
                    level = LevelNameOf(doc, el),
                    kind = kind,
                    kind_label = KindLabel(kind),
                    op = op,
                    op_label = OpLabel(op),
                    at = at.HasValue
                        ? at.Value.ToLocalTime().ToString("HH:mm", CultureInfo.InvariantCulture)
                        : null,
                    at_sec = at.HasValue
                        ? (long)(at.Value - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds
                        : 0,
                    view_specific = viewSpecific,
                    hits = ch.HitsOf(idValue),
                });
            }
        }

        /// <summary>«Basic Wall · Хана 200мм» маягийн нэр.  Аль нь ч байхгүй бол null.</summary>
        private static string TypeLabelOf(Document doc, Element el)
        {
            try
            {
                ElementId tid = el.GetTypeId();
                if (tid != null && tid != ElementId.InvalidElementId)
                {
                    var et = doc.GetElement(tid) as ElementType;
                    if (et != null)
                    {
                        string fam = null;
                        try { fam = et.FamilyName; } catch { }
                        string nm = null;
                        try { nm = et.Name; } catch { }

                        if (!string.IsNullOrWhiteSpace(fam) && !string.IsNullOrWhiteSpace(nm))
                        {
                            // Гэр бүлийн нэр төрлийн нэрэнд аль хэдийн орсон бол
                            // хоёр удаа бичихгүй («Basic Wall · Basic Wall 200»).
                            return nm.IndexOf(fam, StringComparison.OrdinalIgnoreCase) >= 0
                                ? nm
                                : fam + " · " + nm;
                        }
                        if (!string.IsNullOrWhiteSpace(nm)) return nm;
                        if (!string.IsNullOrWhiteSpace(fam)) return fam;
                    }
                }
            }
            catch { }

            try
            {
                string n = el.Name;
                return string.IsNullOrWhiteSpace(n) ? null : n;
            }
            catch { return null; }
        }

        private static readonly BuiltInParameter[] LevelParams =
        {
            BuiltInParameter.LEVEL_PARAM,
            BuiltInParameter.WALL_BASE_CONSTRAINT,
            BuiltInParameter.SCHEDULE_LEVEL_PARAM,
            BuiltInParameter.FAMILY_LEVEL_PARAM,
            BuiltInParameter.ROOF_BASE_LEVEL_PARAM,
        };

        /// <summary>
        /// Аль давхарт вэ.  Элемент бүр `LevelId`-тай БАЙДАГГҮЙ тул параметрийн
        /// нөөц замуудыг дараалан оролдоно; харагдацад харьяалагдах зүйлд
        /// давхрын оронд ХАРАГДАЦЫН нэрийг хэлнэ — тэр нь илүү хэрэгтэй.
        /// </summary>
        private static string LevelNameOf(Document doc, Element el)
        {
            try
            {
                ElementId lid = el.LevelId;
                if (lid != null && lid != ElementId.InvalidElementId)
                {
                    Element lv = doc.GetElement(lid);
                    if (lv != null && !string.IsNullOrWhiteSpace(lv.Name)) return lv.Name;
                }
            }
            catch { }

            foreach (BuiltInParameter bip in LevelParams)
            {
                try
                {
                    Parameter p = el.get_Parameter(bip);
                    if (p == null || p.StorageType != StorageType.ElementId) continue;
                    ElementId v = p.AsElementId();
                    if (v == null || v == ElementId.InvalidElementId) continue;
                    Element lv = doc.GetElement(v);
                    if (lv != null && !string.IsNullOrWhiteSpace(lv.Name)) return lv.Name;
                }
                catch { }
            }

            try
            {
                if (el.ViewSpecific && el.OwnerViewId != ElementId.InvalidElementId)
                {
                    Element v = doc.GetElement(el.OwnerViewId);
                    if (v != null && !string.IsNullOrWhiteSpace(v.Name)) return v.Name;
                }
            }
            catch { }

            return null;
        }

        /* ============================================================== */
        /*  2. goto_element — тэр зүйл рүү нь үсрэх                        */
        /* ============================================================== */

        public static string GotoElement(UIDocument uidoc, Document doc, JsonElement args)
        {
            long idValue = GetLong(args, "element_id");
            if (idValue <= 0) throw new ArgumentException("element_id шаардлагатай.");

            var eid = new ElementId(idValue);
            Element el = doc.GetElement(eid);
            if (el == null)
            {
                throw new InvalidOperationException(
                    "Энэ элемент загварт байхгүй болжээ — устгагдсан эсвэл буцаагдсан байна.");
            }

            View target = null;
            string how = "none";
            int viewsChecked = 0;
            bool partial = false;

            // 1. Харагдацад харьяалагдах зүйл (хэмжээс, тэмдэглэл, дэлгэрэнгүй)
            //    нь ЯГ НЭГ харагдацынх — хайх шаардлагагүй, ҮНЭГҮЙ мэднэ.
            try
            {
                if (el.ViewSpecific && el.OwnerViewId != ElementId.InvalidElementId)
                {
                    target = doc.GetElement(el.OwnerViewId) as View;
                    if (target != null) how = "owner";
                }
            }
            catch { }

            // 2. Загварын элемент — хуудсанд байрласан харагдацуудаас хайна.
            if (target == null)
            {
                target = FindViewShowing(doc, el, SheetViews(doc), Stopwatch.StartNew(),
                    SearchBudgetMs, out how, out viewsChecked, out partial);
            }

            // 3. Юу ч олдоогүй бол идэвхтэй харагдац дээр л сонгоно.  Сонгох нь
            //    цонх гаргадаггүй тул энэ нь ямар ч тохиолдолд аюулгүй.
            bool switched = false;
            View active = null;
            try { active = doc.ActiveView; } catch { }

            if (target != null && active != null && target.Id != active.Id)
            {
                try
                {
                    uidoc.ActiveView = target;
                    switched = true;
                }
                catch
                {
                    // Зарим харагдацыг идэвхжүүлэх боломжгүй (загвар, хуудасны
                    // онцгой төрөл).  Алдаа биш — байгаа харагдац дээрээ үлдэнэ.
                    target = active;
                    how = "active_fallback";
                }
            }
            else if (target == null)
            {
                target = active;
                how = "active_fallback";
            }

            try { uidoc.Selection.SetElementIds(new List<ElementId> { eid }); }
            catch { }

            bool zoomed = ZoomTo(uidoc, el, target);

            ViewSheet sheet = target == null ? null : SheetOfView(doc, target.Id);

            return JsonSerializer.Serialize(new
            {
                ok = true,
                element_id = idValue,
                view_name = target == null ? null : target.Name,
                sheet_number = sheet == null ? null : sheet.SheetNumber,
                sheet_name = sheet == null ? null : sheet.Name,
                switched,
                zoomed,
                how,
                views_checked = viewsChecked,
                // Цагийн төсөв дуусч бүх харагдацыг шалгаж амжаагүй.  Хуудас
                // олдоогүй нь «энэ элемент хаана ч байхгүй» ГЭСЭН ҮГ БИШ.
                partial,
            }, Json);
        }

        /// <summary>
        /// Элементийг ХАРУУЛЖ БУЙ, хуудсанд байрласан харагдацыг олно.
        ///
        /// ⚠️ ЭНЭ БОЛ ЦОРЫН ГАНЦ ҮНЭТЭЙ ХЭСЭГ.  Харагдацын хамрах хүрээтэй
        /// collector нь тухайн харагдацыг regenerate хийлгэдэг тул төсөв
        /// ЗААВАЛ хэрэгтэй.  Хоёр зүйл өртгийг барина:
        ///   • Түвшин таарсан план ЭХЭЛЖ шалгагдана — 100 харагдацтай төсөлд
        ///     ихэвчлэн эхний 1-2 оролдлогод олдоно.
        ///   • Цаг/тооны хатуу хязгаар — олдохгүй бол ШУДАРГААР «дутуу
        ///     шалгалаа» гэж хэлнэ, хязгааргүй хайхгүй.
        /// </summary>
        /// <param name="candidates">
        /// Хуудсанд байрласан харагдацууд.  ⚠️ ГАДНААС өгөх нь ЧУХАЛ: `SheetViews`
        /// нь бүх хуудсыг тойрдог тул элемент тутам дуудвал `change_digest` дээр
        /// 30 удаа давтагдана.  Нэг удаа барьж, дахин ашиглана.
        /// </param>
        /// <param name="sw">Хуваалцсан цаг хэмжигч — олон дуудлагад НИЙТ төсөв барина.</param>
        private static View FindViewShowing(
            Document doc, Element el, List<View> candidates, Stopwatch sw, int budgetMs,
            out string how, out int viewsChecked, out bool partial)
        {
            how = "none";
            viewsChecked = 0;
            partial = false;

            var ids = new List<ElementId> { el.Id };

            ElementId levelId = ElementId.InvalidElementId;
            try { levelId = el.LevelId; } catch { }

            // ⚠️ Эрэмбийг элемент тутамд ДАХИН тооцно (түвшин нь өөр өөр), гэхдээ
            // жагсаалтыг ӨӨРИЙГ нь хуулж авна — дуудагчийн жагсаалтыг эвдэхгүй.
            var ordered = new List<View>(candidates);
            ordered.Sort((a, b) => RankOf(b, levelId).CompareTo(RankOf(a, levelId)));

            foreach (View v in ordered)
            {
                if (viewsChecked >= MaxViewsChecked || sw.ElapsedMilliseconds > budgetMs)
                {
                    partial = viewsChecked < ordered.Count;
                    break;
                }
                viewsChecked++;
                try
                {
                    int n = new FilteredElementCollector(doc, v.Id)
                        .WherePasses(new ElementIdSetFilter(ids))
                        .GetElementCount();
                    if (n > 0)
                    {
                        how = "sheet_view";
                        return v;
                    }
                }
                catch
                {
                    // Зарим харагдац (schedule, legend) элемент агуулж чадахгүй.
                }
            }
            return null;
        }

        /* ============================================================== */
        /*  3. change_digest — ТАЙЛАНГИЙН баримт                          */
        /* ============================================================== */

        /// <summary>
        /// Тайлангийн бичвэр бэлдэхэд хэрэгтэй БҮТЭЦТЭЙ баримтууд.
        ///
        /// ⚠️ `list_changes`-ЭЭС ЯЛГААТАЙ.  Тэр нь хүн дэлгэц дээр гүйлгэж
        /// харах МӨРҮҮД; энэ нь өгүүлбэр угсрахад тохирсон НЭГТГЭЛ:
        /// (категори × төрөл × давхар × үйлдэл) → тоо, дээр нь ХУУДАС.
        ///
        /// ⚠️ Хуудсыг БҮЛЭГ тутамд, ДЭЭЖЭЭР тогтооно.  Элемент бүрээр хайвал
        /// 18 элемент = 18 удаагийн харагдацын хайлт болно.  Нэг бүлгийн
        /// элементүүд (ижил давхрын ижил төрлийн хана) бараг үргэлж ижил
        /// хуудсанд харагддаг тул 3 дээж хангалттай — санал нийлэхгүй бол
        /// хоёуланг нь хэлнэ, олдохгүй бол хуудсыг ОРХИЖ давхраар нь бичнэ.
        /// Худал хуудас бичихээс дутуу бичих нь ДЭЭР.
        /// </summary>
        public static string ChangeDigest(Document doc, JsonElement args)
        {
            ChangeTracker.Change ch;
            if (!ChangeTracker.TryGet(doc, out ch))
            {
                return JsonSerializer.Serialize(new
                {
                    baseline_at = (string)null,
                    groups = new object[0],
                    visible_total = 0,
                    hidden_total = 0,
                    gone_total = 0,
                    more_groups = 0,
                    sheets_partial = false,
                    warnings = new[] { "no_baseline" },
                }, Json);
            }

            var rows = new List<Row>();
            int hidden = 0, gone = 0;
            bool capped = false;
            Describe(doc, ch, ch.Added, "added", rows, ref hidden, ref gone, ref capped);
            Describe(doc, ch, ch.Modified, "modified", rows, ref hidden, ref gone, ref capped);
            Describe(doc, ch, ch.Deleted, "deleted", rows, ref hidden, ref gone, ref capped);

            // --- Нэгтгэл: категори × төрөл × давхар × үйлдэл ------------------
            var buckets = new Dictionary<string, Bucket>(StringComparer.Ordinal);
            foreach (Row r in rows)
            {
                string key = string.Join("\u0001",
                    r.category ?? "", r.type_name ?? "", r.level ?? "", r.kind ?? "");
                Bucket b;
                if (!buckets.TryGetValue(key, out b))
                {
                    b = new Bucket
                    {
                        CategoryLabel = r.category_label,
                        TypeName = r.type_name,
                        Level = r.level,
                        Kind = r.kind,
                        KindLabel = r.kind_label,
                    };
                    buckets[key] = b;
                }
                b.Count++;
                if (r.id > 0 && b.Ids.Count < SheetSamplesPerGroup) b.Ids.Add(r.id);
                if (!string.IsNullOrWhiteSpace(r.op_label) && !b.Ops.Contains(r.op_label))
                {
                    if (b.Ops.Count < 2) b.Ops.Add(r.op_label);
                }
            }

            var ordered = new List<Bucket>(buckets.Values);
            ordered.Sort((a, b) =>
            {
                int c = b.Count.CompareTo(a.Count);
                if (c != 0) return c;
                return string.Compare(a.CategoryLabel, b.CategoryLabel,
                    StringComparison.OrdinalIgnoreCase);
            });

            int moreGroups = Math.Max(0, ordered.Count - MaxDigestGroups);
            if (ordered.Count > MaxDigestGroups) ordered.RemoveRange(MaxDigestGroups,
                ordered.Count - MaxDigestGroups);

            // --- Хуудсыг ХУВААЛЦСАН төсөвтэйгээр тогтооно ---------------------
            List<View> candidates = SheetViews(doc);
            var sw = Stopwatch.StartNew();
            bool sheetsPartial = false;

            foreach (Bucket b in ordered)
            {
                if (sw.ElapsedMilliseconds > DigestBudgetMs) { sheetsPartial = true; break; }

                foreach (long id in b.Ids)
                {
                    if (sw.ElapsedMilliseconds > DigestBudgetMs) { sheetsPartial = true; break; }

                    Element el = null;
                    try { el = doc.GetElement(new ElementId(id)); }
                    catch { }
                    if (el == null) continue;

                    View v = null;
                    try
                    {
                        if (el.ViewSpecific && el.OwnerViewId != ElementId.InvalidElementId)
                            v = doc.GetElement(el.OwnerViewId) as View;
                    }
                    catch { }

                    if (v == null)
                    {
                        string how;
                        int checkedViews;
                        bool partial;
                        v = FindViewShowing(doc, el, candidates, sw, DigestBudgetMs,
                            out how, out checkedViews, out partial);
                        if (partial) sheetsPartial = true;
                    }
                    if (v == null) continue;

                    ViewSheet sheet = SheetOfView(doc, v.Id);
                    if (sheet == null) continue;

                    string num = sheet.SheetNumber;
                    if (string.IsNullOrWhiteSpace(num)) continue;
                    if (!b.Sheets.Contains(num) && b.Sheets.Count < 2) b.Sheets.Add(num);
                }
            }

            var outGroups = new List<object>(ordered.Count);
            foreach (Bucket b in ordered)
            {
                outGroups.Add(new
                {
                    category_label = b.CategoryLabel,
                    type_name = b.TypeName,
                    level = b.Level,
                    kind = b.Kind,
                    kind_label = b.KindLabel,
                    ops = b.Ops,
                    count = b.Count,
                    sheets = b.Sheets,
                });
            }

            var warnings = new List<string>();
            if (!ChangeTracker.Started) warnings.Add("tracking_unavailable");
            if (ch.Truncated) warnings.Add("truncated");
            if (ch.MetaTruncated) warnings.Add("meta_truncated");
            if (capped) warnings.Add("items_capped");

            return JsonSerializer.Serialize(new
            {
                baseline_at = ch.BaselineAtUtc.ToString("o", CultureInfo.InvariantCulture),
                groups = outGroups,
                visible_total = rows.Count,
                hidden_total = hidden,
                gone_total = gone,
                more_groups = moreGroups,
                sheets_partial = sheetsPartial,
                warnings = warnings.ToArray(),
            }, Json);
        }

        private sealed class Bucket
        {
            public string CategoryLabel;
            public string TypeName;
            public string Level;
            public string Kind;
            public string KindLabel;
            public int Count;
            public readonly List<string> Ops = new List<string>();
            public readonly List<string> Sheets = new List<string>();
            /// <summary>Хуудас тогтоох ДЭЭЖ — бүх id БИШ.</summary>
            public readonly List<long> Ids = new List<long>();
        }

        /// <summary>Хуудсанд байрласан, загвар БИШ харагдацууд — давхардалгүй.</summary>
        private static List<View> SheetViews(Document doc)
        {
            var seen = new HashSet<long>();
            var list = new List<View>();
            foreach (ViewSheet s in RevitTools.CollectSheets(doc))
            {
                ICollection<ElementId> vids = null;
                try { vids = s.GetAllPlacedViews(); }
                catch { }
                if (vids == null) continue;

                foreach (ElementId vid in vids)
                {
                    if (!seen.Add(vid.Value)) continue;
                    View v = null;
                    try { v = doc.GetElement(vid) as View; }
                    catch { }
                    if (v == null) continue;
                    try { if (v.IsTemplate) continue; }
                    catch { continue; }
                    list.Add(v);
                }
            }
            return list;
        }

        /// <summary>Түвшин таарсан план хамгийн үнэтэй; дараа нь 3D, дараа нь бусад план.</summary>
        private static int RankOf(View v, ElementId levelId)
        {
            try
            {
                var vp = v as ViewPlan;
                if (vp != null && levelId != ElementId.InvalidElementId)
                {
                    Level gen = vp.GenLevel;
                    if (gen != null && gen.Id == levelId) return 3;
                }
                if (v is View3D) return 2;
                if (vp != null) return 1;
            }
            catch { }
            return 0;
        }

        /// <summary>
        /// Элементийн хүрээ рүү ойртуулна.
        ///
        /// ⚠️ `ShowElements`-ийн ОРЛУУЛАГЧ.  Тэр нь элемент олдохгүй үед модаль
        /// цонх гаргаад Revit-ийг блокладаг; энэ нь юу ч олдохгүй бол зүгээр л
        /// `false` буцаана.
        /// </summary>
        private static bool ZoomTo(UIDocument uidoc, Element el, View target)
        {
            if (target == null) return false;
            try
            {
                BoundingBoxXYZ bb = null;
                try { bb = el.get_BoundingBox(target); }
                catch { }
                if (bb == null)
                {
                    try { bb = el.get_BoundingBox(null); }
                    catch { }
                }
                if (bb == null) return false;

                // Багахан зай үлдээнэ, эс тэгвээс элемент дэлгэцийн ирмэгт наалдана.
                var pad = new XYZ(2, 2, 2);
                foreach (UIView uv in uidoc.GetOpenUIViews())
                {
                    if (uv.ViewId != target.Id) continue;
                    uv.ZoomAndCenterRectangle(bb.Min - pad, bb.Max + pad);
                    return true;
                }
            }
            catch { }
            return false;
        }

        /// <summary>Тухайн харагдац АЛЬ хуудсанд байрлаж байна вэ.</summary>
        private static ViewSheet SheetOfView(Document doc, ElementId viewId)
        {
            try
            {
                // ⚠️ Баримтын хэмжээст collector — Viewport бол цөөхөн (хуудасны
                // тоотой ойролцоо) тул regenerate үүсгэхгүй, хямд.
                foreach (Element e in new FilteredElementCollector(doc).OfClass(typeof(Viewport)))
                {
                    var vp = e as Viewport;
                    if (vp == null || vp.ViewId != viewId) continue;
                    return doc.GetElement(vp.SheetId) as ViewSheet;
                }
            }
            catch { }
            return null;
        }

        private static long GetLong(JsonElement args, string name)
        {
            try
            {
                JsonElement v;
                if (args.ValueKind != JsonValueKind.Object) return 0;
                if (!args.TryGetProperty(name, out v)) return 0;
                if (v.ValueKind == JsonValueKind.Number)
                {
                    long l;
                    return v.TryGetInt64(out l) ? l : 0;
                }
                if (v.ValueKind == JsonValueKind.String)
                {
                    long l;
                    return long.TryParse(v.GetString(), NumberStyles.Integer,
                        CultureInfo.InvariantCulture, out l) ? l : 0;
                }
            }
            catch { }
            return 0;
        }
    }
}
