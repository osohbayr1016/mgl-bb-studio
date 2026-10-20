using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Autodesk.Revit.DB;

namespace RevitMcpAddin
{
    /// <summary>
    /// Дүрмийн ОРОЛТЫГ Revit-ээс уншина.  ЦОРЫН ГАНЦ Revit-д хүрэх хэсэг.
    ///
    /// ⚠️ ХАРАГДАЦЫН ХАМРАХ ХҮРЭЭТЭЙ COLLECTOR ХОРИОТОЙ.  `ChangeReport.cs:31-38`
    /// нь Revit-д «энэ элемент энэ харагдацад харагдаж байна уу» гэж хямдхан
    /// асуух API БАЙХГҮЙ гэдгийг реф ассемблиэс шалгаж тэмдэглэсэн ба тэр нь
    /// 2026-08-25-ны 120 секундын гацааны шалтгаан.  Энд ЗӨВХӨН
    /// `doc.GetElement(id)` — collector ЕРӨӨСӨӨ БАЙХГҮЙ.
    ///
    /// ⚠️ ДОТООД ТӨСӨВ ЗААВАЛ.  `RevitToolBus.cs:474`-ийн `Abandoned` шалгалт
    /// нь ГҮЙЦЭТГЭХИЙН ӨМНӨ л ажилладаг — `RevitTools.Run` эхэлмэгц цуцлалт
    /// БАЙХГҮЙ.  Дуудагчийн timeout нь ДУУДАГЧИЙГ хамгаална, Revit-ийг БИШ.
    /// Иймд `change_digest` (4 с) ба `goto_element` (2.5 с)-ийн заншлаар
    /// ДОТООД `Stopwatch` deadline тавина.
    ///
    /// ⚠️ ЭНЭ ХЭРЭГСЭЛ LLM-Д НЭЭГДЭХГҮЙ.  `AgentChat.ToolSpecs()` /
    /// `ClientAllowedTools` / `lib/revitAgent.ts ALLOWED_TOOLS` /
    /// `mgl_agent.py ALLOWED` — ДӨРВҮҮЛЭЭ ХӨНДӨГДӨӨГҮЙ.  Энэ бол дотоод,
    /// машины хэрэгсэл; чатад нээвэл хэрэглэгчийн нэрийн өмнөөс ДУРЫН элемент
    /// уншина.
    /// </summary>
    internal static class RuleFactExtractor
    {
        /// <summary>Нэг дуудлагад уншиж болох элементийн ХАТУУ дээд тоо.</summary>
        private const int MaxElementsPerCall = 150;

        /// <summary>Дотоод deadline (мс).  Хэтэрвэл ХЭСЭГЧИЛСЭН үр дүн + курсор.</summary>
        private const int InternalBudgetMs = 1500;

        /* ============================================================== */
        /*  БАРИМТЫН БҮРТГЭЛ — ХААЛТТАЙ ЖАГСААЛТ                          */
        /* ============================================================== */

        /// <summary>
        /// Хавсралт §1.3-ын бүртгэлийн ЭЛЕМЕНТИЙН хэсэг.
        ///
        /// ⚠️ ХААЛТТАЙ.  Бүртгэлд БАЙХГҮЙ нэр нь багц угсрах үед татгалзагддаг
        /// (§10-ийн V3) тул экстрактор нь дурын параметрийн нэр ХАЙХГҮЙ.
        /// Танихгүй нэр нь `missing = true` болж буцна — ТААМАГЛАХГҮЙ.
        ///
        /// ⚠️ ЭНЭ НЬ БҮРЭН БИШ бөгөөд бүрэн байх ч ЁСГҮЙ (эзний шийдвэр Ш4:
        /// БНбД баримтыг эзэн өөрөө нийлүүлнэ тул дүрмийн корпус энэ релизэд
        /// ЗОХИОГДОХГҮЙ).  Шинэ дүрэм бичих бүрд ЭНД мөр НЭМНЭ.
        /// </summary>
        private static readonly string[] KnownElementFacts =
        {
            "category",        // dirty — гэхдээ `resolve` горим Ч буцаана
            "name_folded",     // param, fold-v1
            "length_m",        // builtin
            "clear_width_mm",  // computed — ЭХ СУРВАЛЖ ЗАРЛАГДААГҮЙ, доороос үз
            "ceiling_h_mm",    // computed — ЭХ СУРВАЛЖ ЗАРЛАГДААГҮЙ, доороос үз
        };

        private static bool IsKnown(string local)
        {
            for (int i = 0; i < KnownElementFacts.Length; i++)
            {
                if (string.Equals(KnownElementFacts[i], local, StringComparison.Ordinal)) return true;
            }
            return false;
        }

        /* ============================================================== */
        /*  ХЭРЭГСЛИЙН БИЕ                                                 */
        /* ============================================================== */

        /// <summary>
        /// ХОЁР ГОРИМ, НЭГ ХЭРЭГСЭЛ.
        ///
        /// `{"mode":"resolve","ids":[1,2,3],"cursor":0}`
        ///   → `{"mode":"resolve","resolved":[{"id":1,"uid":"…","cat":"Walls",
        ///        "exists":true}],"doc":{…},"more":false,"cursor":3,"checked":3}`
        ///
        ///   ⚠️ ЯАГААД ЭНЭ ГОРИМ ХЭРЭГТЭЙ ВЭ: `ChangeTracker` нь `long` id Л
        ///   хадгалдаг ба `LogicalChangeSet.ElementIds` нь `long[]`.  Дүрмийн
        ///   гохны индекс нь КАТЕГОРИ шаарддаг, олдвор нь ТОГТВОРТОЙ
        ///   `UniqueId` шаарддаг.  Хоёулаа Revit-ээс Л ирнэ.  Хуваарилагч
        ///   үр дүнг КЭШЛЭДЭГ тул нэг элементийн хувьд энэ горим БАРАГ
        ///   ХЭЗЭЭ Ч хоёр дахь удаагаа ажиллахгүй.
        ///
        /// `{"items":[{"uid":"…","facts":["length_m"]}],"cursor":0}`
        ///   → Хавсралт §4.3-ын хэлбэр.
        /// </summary>
        internal static string Collect(Document doc, JsonElement args)
        {
            System.Diagnostics.Stopwatch sw = System.Diagnostics.Stopwatch.StartNew();
            string mode = GetStr(args, "mode") ?? "facts";
            int cursor = (int)GetLong(args, "cursor", 0);
            if (cursor < 0) cursor = 0;

            return string.Equals(mode, "resolve", StringComparison.Ordinal)
                ? Resolve(doc, args, cursor, sw)
                : Facts(doc, args, cursor, sw);
        }

        /* ============================================================== */
        /*  ГОРИМ 1 — id → (uid, категори)                                */
        /* ============================================================== */

        private static string Resolve(
            Document doc, JsonElement args, int cursor, System.Diagnostics.Stopwatch sw)
        {
            List<long> ids = GetLongArray(args, "ids");
            StringBuilder sb = new StringBuilder(256 + ids.Count * 96);
            sb.Append("{\"mode\":\"resolve\",\"resolved\":[");

            int i = cursor;
            int done = 0;
            bool first = true;
            for (; i < ids.Count; i++)
            {
                if (done >= MaxElementsPerCall) break;
                // ⚠️ Давталт бүрийн ЭХЭНД — Revit-ийн үндсэн урсгалыг
                //    хязгааргүй барих нь энэ хэрэгслийн ганц бодит эрсдэл.
                if (sw.ElapsedMilliseconds > InternalBudgetMs) break;

                long id = ids[i];
                Element el = null;
                try { el = doc.GetElement(new ElementId(id)); }
                catch { el = null; }

                string uid = null;
                string cat = null;
                if (el != null)
                {
                    try { uid = el.UniqueId; } catch { }
                    try { Category c = el.Category; if (c != null) cat = c.Name; }
                    catch { }
                }

                if (!first) sb.Append(',');
                first = false;
                sb.Append("{\"id\":").Append(id.ToString(CultureInfo.InvariantCulture));
                sb.Append(',');
                CJson.Str(sb, "uid", uid);
                sb.Append(',');
                // ⚠️ Категорийн нэрийг ОРЧУУЛАХГҮЙ — Revit-ийн ЭХ хэлбэрээр
                //    (`0204:110`-ийн дүрэм).  Хэрэглэгчийн хэлнээс хамаарна
                //    гэдгийг pack-ийн зохиогч МЭДЭХ ёстой.
                CJson.Str(sb, "cat", cat);
                sb.Append(",\"exists\":").Append(el != null ? "true" : "false");
                sb.Append('}');
                done++;
            }

            sb.Append("],");
            AppendDocBlock(doc, sb);
            sb.Append(",\"more\":").Append(i < ids.Count ? "true" : "false");
            sb.Append(",\"cursor\":").Append(i.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"checked\":").Append(done.ToString(CultureInfo.InvariantCulture));
            sb.Append('}');
            return sb.ToString();
        }

        /* ============================================================== */
        /*  ГОРИМ 2 — uid → баримтууд                                     */
        /* ============================================================== */

        private static string Facts(
            Document doc, JsonElement args, int cursor, System.Diagnostics.Stopwatch sw)
        {
            List<Item> items = ParseItems(args);
            StringBuilder sb = new StringBuilder(512 + items.Count * 160);
            sb.Append("{\"facts\":{");

            int i = cursor;
            int done = 0;
            bool first = true;
            for (; i < items.Count; i++)
            {
                if (done >= MaxElementsPerCall) break;
                if (sw.ElapsedMilliseconds > InternalBudgetMs) break;

                Item it = items[i];
                if (string.IsNullOrEmpty(it.Uid)) { done++; continue; }

                Element el = null;
                try { el = doc.GetElement(it.Uid); }
                catch { el = null; }

                if (!first) sb.Append(',');
                first = false;
                CJson.Quoted(sb, it.Uid);              // түлхүүр = element_uid
                sb.Append(":{");

                bool firstFact = true;
                for (int k = 0; k < it.Facts.Count; k++)
                {
                    string local = it.Facts[k];
                    if (string.IsNullOrEmpty(local)) continue;
                    if (!firstFact) sb.Append(',');
                    firstFact = false;
                    CJson.Quoted(sb, local);
                    sb.Append(':');
                    WriteFact(sb, ReadElementFact(el, local));
                }
                sb.Append('}');
                done++;
            }

            sb.Append("},");
            AppendDocBlock(doc, sb);
            sb.Append(",\"more\":").Append(i < items.Count ? "true" : "false");
            sb.Append(",\"cursor\":").Append(i.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"checked\":").Append(done.ToString(CultureInfo.InvariantCulture));
            sb.Append('}');
            return sb.ToString();
        }

        /* ============================================================== */
        /*  БАРИМТЫН УТГА                                                  */
        /* ============================================================== */

        private struct Raw
        {
            public bool Missing;
            public bool IsText;
            public string Text;
            public double Num;
            public string Unit;
            public string Src;
            public string Spec;
        }

        private static Raw Absent()
        {
            Raw r = new Raw();
            r.Missing = true;
            r.Unit = Units.None;
            r.Src = "computed";
            return r;
        }

        private static Raw Text(string value, string src)
        {
            if (string.IsNullOrEmpty(value)) return Absent();
            Raw r = new Raw();
            r.IsText = true;
            r.Text = value;
            r.Unit = Units.None;
            r.Src = src;
            return r;
        }

        private static Raw Number(double v, string unit, string src, string spec)
        {
            // ⚠️ NaN / ∞ нь `invalid_input` — тэдгээрийг УТГА гэж дамжуулбал
            //    `RuleEngine` нь тоон харьцуулалт хийж БУРУУ `PASS` гаргаж
            //    болно.  Тиймээс МӨР ҮҮСГЭХГҮЙ, `missing` болгоно.
            if (double.IsNaN(v) || double.IsInfinity(v)) return Absent();
            Raw r = new Raw();
            r.Num = v;                 // ⚠️ БОДИТ ТЭГ нь ТЭГ хэвээр (v2 §63).
            r.Unit = unit;
            r.Src = src;
            r.Spec = spec;
            return r;
        }

        private static void WriteFact(StringBuilder sb, Raw f)
        {
            sb.Append("{\"v\":");
            if (f.Missing) sb.Append("null");
            else if (f.IsText) CJson.Quoted(sb, f.Text);
            else sb.Append(f.Num.ToString("R", CultureInfo.InvariantCulture));
            sb.Append(',');
            CJson.Str(sb, "unit", f.Unit ?? Units.None); sb.Append(',');
            CJson.Str(sb, "src", f.Src ?? "computed"); sb.Append(',');
            CJson.Str(sb, "spec", f.Spec); sb.Append(',');
            sb.Append("\"missing\":").Append(f.Missing ? "true" : "false");
            sb.Append('}');
        }

        /// <summary>
        /// ⚠️ ХААЛТТАЙ `switch`.  Танихгүй нэр = `missing`, ТААМАГЛАХГҮЙ.
        ///
        /// ⚠️ Уншиж ЧАДААГҮЙ баримт нь `missing = true` гэж БУЦНА.  Хөдөлгүүр
        /// түүнийг `UNCERTAIN(missing_input)` болгоно, `PASS` БИШ, `VIOLATION`
        /// БИШ (§3.8-ийн эхний мөр).
        ///
        /// ⚠️ `QtoExtractor.Round3OrNull` (`:528-534`) ДАХИН АШИГЛАХГҮЙ — тэр
        /// нь бодит ТЭГИЙГ NULL болгодог ба v2 §63 нь `zero` ба `missing_input`
        /// -ыг ТУСДАА заавал ёстой тестийн тохиолдол гэж жагсаадаг.
        /// </summary>
        private static Raw ReadElementFact(Element el, string local)
        {
            if (el == null || !IsKnown(local)) return Absent();
            try
            {
                switch (local)
                {
                    case "category":
                    {
                        Category c = el.Category;
                        return Text(c != null ? c.Name : null, "computed");
                    }
                    case "name_folded":
                    {
                        // ⚠️ `TextFold.Fold` — гэрээний тэмдэг `fold-v1`.  Дүрэм
                        //    дэх needle нь БАГЦАД АЛЬ ХЭДИЙН ХУРААГДСАН
                        //    байдлаар ирдэг тул `RuleEngine` нь `TextFold`-д
                        //    ХҮРЭХГҮЙ; хураалт ЭНД, НЭГ УДАА болно.
                        string name = null;
                        try { name = el.Name; } catch { }
                        return Text(TextFold.Fold(name), "typed_param");
                    }
                    case "length_m":
                        return LengthM(el);
                    case "clear_width_mm":
                    case "ceiling_h_mm":
                        // ⚠️ ЭХ СУРВАЛЖ ЗАРЛАГДААГҮЙ — ЗОРИУД `missing`.
                        //
                        //    Эзний шийдвэр Ш4-ээр `rules` хүснэгт ХООСОН
                        //    шипдэг тул эдгээр хэмжигдэхүүнийг ЯГ ЯАЖ авахыг
                        //    зааж өгсөн БНбД заалт байхгүй.  Хаалганы нэрлэсэн
                        //    өргөнийг «цэвэр өргөн» гэж, өрөөний хязгаарлагдсан
                        //    өндрийг «таазны өндөр» гэж дамжуулах нь ЧИМЭЭГҮЙ
                        //    ХУДАЛ ӨГӨГДӨЛ бөгөөд ХУДАЛ `PASS` үйлдвэрлэнэ —
                        //    тэр нь §58-ын хуучирсан олдвортой ЯГ ижил байдлаар
                        //    инженерийн итгэлийг устгана.
                        //
                        //    `missing` нь `UNCERTAIN(missing_input)` болно —
                        //    хүн харна, машин таамаглахгүй.  Заалт ирмэгц ЭНЭ
                        //    ГАНЦ `case`-ийг дүүргэнэ, өөр ЮУ Ч хөндөхгүй.
                        return Absent();
                    default:
                        return Absent();
                }
            }
            catch
            {
                return Absent();
            }
        }

        /// <summary>
        /// Уртын ХААЛТТАЙ гинж: builtin параметр → `LocationCurve`.
        ///
        /// ⚠️ `UnitUtils.ConvertFromInternalUnits` нь Revit-ийн дотоод ФУТ-ыг
        /// метр болгоно.  Хөрвүүлэлтгүй тоо нь 3.28 дахин алдаатай — тэр нь
        /// «бүх зүйл PASS» эсвэл «бүх зүйл VIOLATION» гэсэн хоёр гарцын аль
        /// нэгийг өгнө (`Units.cs`-ийн ангийн тайлбарын жишээ).
        /// </summary>
        private static Raw LengthM(Element el)
        {
            BuiltInParameter[] chain =
            {
                BuiltInParameter.CURVE_ELEM_LENGTH,
                BuiltInParameter.STRUCTURAL_FRAME_CUT_LENGTH,
                BuiltInParameter.INSTANCE_LENGTH_PARAM,
            };
            for (int i = 0; i < chain.Length; i++)
            {
                Parameter p = null;
                try { p = el.get_Parameter(chain[i]); }
                catch { }
                if (p == null || !p.HasValue) continue;
                if (p.StorageType != StorageType.Double) continue;
                double m;
                try { m = UnitUtils.ConvertFromInternalUnits(p.AsDouble(), UnitTypeId.Meters); }
                catch { continue; }
                return Number(m, Units.M, "builtin_geometry", SpecOf(p));
            }

            try
            {
                LocationCurve lc = el.Location as LocationCurve;
                if (lc != null && lc.Curve != null)
                {
                    double m = UnitUtils.ConvertFromInternalUnits(lc.Curve.Length, UnitTypeId.Meters);
                    return Number(m, Units.M, "builtin_geometry", null);
                }
            }
            catch { }
            return Absent();
        }

        /// <summary>
        /// Параметрийн SPEC (`autodesk.spec.aec:length-2.0.0` г.м.).
        ///
        /// ⚠️ `Quantity.ConversionAllowed`-ийн оролт.  `TypedParam` нь spec-гүй
        /// бол хөрвүүлэх ЭРХГҮЙ (`mixed_provenance`) — Монгол темплейт дээр
        /// «Өргөн» нэртэй параметр нэг family дээр LENGTH, өөр дээр NUMBER
        /// байдгийн ганц хамгаалалт.
        /// </summary>
        private static string SpecOf(Parameter p)
        {
            try
            {
                Definition d = p.Definition;
                if (d == null) return null;
                ForgeTypeId spec = d.GetDataType();
                if (spec == null) return null;
                string id = spec.TypeId;
                return string.IsNullOrEmpty(id) ? null : id;
            }
            catch { return null; }
        }

        /* ============================================================== */
        /*  `doc` БЛОК — БАРИМТ ТУТАМД НЭГ УДАА                           */
        /* ============================================================== */

        /// <summary>
        /// ⚠️ Өрөөний хилийн байрлал.  «Finish» биш бол өрөөний геометрийн
        /// дүрэм ХАМААРАХГҮЙ (2-2-ийн applicability) — ХУДАЛ PASS гаргахаас
        /// хамаагүй дээр.  `project_build_context.room_boundary_location` нь
        /// ХҮН БИЧСЭН хүлээлт; ЭНЭ нь ХЭМЖСЭН үнэн, ба Хавсралт §4.4-ийн
        /// 3 > 4 дарааллаар түүнийг ДАРНА.
        /// </summary>
        private static void AppendDocBlock(Document doc, StringBuilder sb)
        {
            sb.Append("\"doc\":{\"room_boundary_location\":");
            Raw r = Absent();
            try
            {
                AreaVolumeSettings avs = AreaVolumeSettings.GetAreaVolumeSettings(doc);
                if (avs != null)
                {
                    SpatialElementBoundaryLocation loc =
                        avs.GetSpatialElementBoundaryLocation(SpatialElementType.Room);
                    r = Text(loc.ToString(), "computed");
                }
            }
            catch
            {
                // Загварт өрөөний тохиргоо байхгүй / API зөрчилдөв — `missing`.
            }
            WriteFact(sb, r);
            sb.Append('}');
        }

        /* ============================================================== */
        /*  АРГУМЕНТ ЗАДЛАХ                                                */
        /* ============================================================== */

        private sealed class Item
        {
            public string Uid;
            public readonly List<string> Facts = new List<string>();
        }

        private static List<Item> ParseItems(JsonElement args)
        {
            List<Item> outp = new List<Item>();
            JsonElement arr;
            if (args.ValueKind != JsonValueKind.Object ||
                !args.TryGetProperty("items", out arr) ||
                arr.ValueKind != JsonValueKind.Array)
            {
                return outp;
            }
            foreach (JsonElement e in arr.EnumerateArray())
            {
                if (e.ValueKind != JsonValueKind.Object) continue;
                Item it = new Item();
                JsonElement uid;
                if (e.TryGetProperty("uid", out uid) && uid.ValueKind == JsonValueKind.String)
                    it.Uid = uid.GetString();
                JsonElement facts;
                if (e.TryGetProperty("facts", out facts) && facts.ValueKind == JsonValueKind.Array)
                {
                    foreach (JsonElement f in facts.EnumerateArray())
                    {
                        if (f.ValueKind == JsonValueKind.String) it.Facts.Add(f.GetString());
                    }
                }
                outp.Add(it);
            }
            return outp;
        }

        private static List<long> GetLongArray(JsonElement args, string name)
        {
            List<long> outp = new List<long>();
            JsonElement arr;
            if (args.ValueKind != JsonValueKind.Object ||
                !args.TryGetProperty(name, out arr) ||
                arr.ValueKind != JsonValueKind.Array)
            {
                return outp;
            }
            foreach (JsonElement e in arr.EnumerateArray())
            {
                long v;
                if (e.ValueKind == JsonValueKind.Number && e.TryGetInt64(out v)) outp.Add(v);
            }
            return outp;
        }

        private static string GetStr(JsonElement args, string name)
        {
            JsonElement v;
            if (args.ValueKind == JsonValueKind.Object &&
                args.TryGetProperty(name, out v) && v.ValueKind == JsonValueKind.String)
            {
                return v.GetString();
            }
            return null;
        }

        private static long GetLong(JsonElement args, string name, long fallback)
        {
            JsonElement v;
            long l;
            if (args.ValueKind == JsonValueKind.Object &&
                args.TryGetProperty(name, out v) &&
                v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out l))
            {
                return l;
            }
            return fallback;
        }
    }

    /* ================================================================== */
    /*  ХУВААРИЛАГЧИЙН REVIT ТАЛ                                          */
    /* ================================================================== */

    /// <summary>
    /// `IRuleInputSource`-ийн ЖИНХЭНЭ хэрэгжүүлэлт — tool bus-аар.
    ///
    /// ⚠️ ЭНЭ АНГИ НЬ `ComplianceScheduler.cs`-Д БАЙХ ЁСГҮЙ.  Тэр файл нь
    /// `Autodesk.Revit`-гүйгээр эмхэтгэгдэх ёстой (§6-ийн шалгуур) ба
    /// `RevitToolBus` / `ChangeTracker` нь Revit-ийн төрлүүдийг татна.
    ///
    /// ⚠️ `TryCall` — `Call` БИШ.  `Gate` нь чат, QTO ба энэ хөдөлгүүрийн
    /// ХАМТЫН семафор бөгөөд `CallCore` нь deadline-ыг `Gate.Wait`-ийн ӨМНӨ
    /// эхлүүлдэг (`RevitToolBus.cs:266`).  Арын мөчлөг энгийн `Call`
    /// хэрэглэвэл түгжээг бүтэн deadline-аараа барьж, хэрэглэгчийн дараагийн
    /// «Зураг холбох» нь «Хугацаа дууслаа … өмнөх үйлдэл дуусаагүй байна»
    /// гэсэн алдаа авна.  АЛГАСАЛТ нь ХЭВИЙН тохиолдол.
    /// </summary>
    internal sealed class RuleInputBusSource : IRuleInputSource
    {
        /// <summary>
        /// §3.11 — БҮТЭН СКАН-ы ЦОРЫН ГАНЦ `TryGetByKey` дуудагч.
        ///
        /// ⚠️ Тэр нь мөрдөгчийн түгжээний ДОР гурван `HashSet` × 500 000 ба
        /// `Meta` × 20 000-ыг ГҮНЗГИЙ хуулна (`ChangeTracker.cs:412-443`,
        /// `:63`, `:74`).  Иймд мөчлөг тутам ХЭЗЭЭ Ч дуудагдахгүй — зөвхөн
        /// хэрэглэгчийн санаачилсан бүтэн скан дээр.
        /// </summary>
        public long[] FullScanIds(string docKey, out bool truncated)
        {
            truncated = false;
            ChangeTracker.Change copy;
            if (string.IsNullOrEmpty(docKey) || !ChangeTracker.TryGetByKey(docKey, out copy) || copy == null)
            {
                return new long[0];
            }
            truncated = copy.Truncated || copy.MetaTruncated;

            HashSet<long> seen = new HashSet<long>();
            List<long> outp = new List<long>(copy.Total);
            foreach (long id in copy.Added) { if (seen.Add(id)) outp.Add(id); }
            foreach (long id in copy.Modified) { if (seen.Add(id)) outp.Add(id); }
            // ⚠️ `Deleted` нь ЗОРИУД ОРОХГҮЙ: устгагдсан элементээс баримт
            //    унших боломжгүй, ба түүний олдвор нь `edit` гохоор аль хэдийн
            //    хуучирсан байна.
            return outp.ToArray();
        }

        public bool TryResolve(long[] ids, IList<ResolvedElement> rows, out bool skipped, out bool more)
        {
            skipped = false;
            more = false;
            if (ids == null || ids.Length == 0 || rows == null) return true;

            StringBuilder sb = new StringBuilder(32 + ids.Length * 12);
            sb.Append("{\"mode\":\"resolve\",\"ids\":[");
            for (int i = 0; i < ids.Length; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(ids[i].ToString(CultureInfo.InvariantCulture));
            }
            sb.Append("],\"cursor\":0}");

            ToolCall call = RevitToolBus.TryCall(
                "collect_rule_inputs", sb.ToString(), ComplianceScheduler.CollectTimeoutSec);
            if (call == null || call.Skipped) { skipped = true; return false; }
            if (!call.Success || string.IsNullOrEmpty(call.ResultJson)) return false;

            try
            {
                using (JsonDocument jd = JsonDocument.Parse(call.ResultJson))
                {
                    JsonElement root = jd.RootElement;
                    JsonElement arr;
                    if (root.TryGetProperty("resolved", out arr) && arr.ValueKind == JsonValueKind.Array)
                    {
                        foreach (JsonElement e in arr.EnumerateArray())
                        {
                            ResolvedElement re = new ResolvedElement();
                            JsonElement v;
                            long id;
                            if (!e.TryGetProperty("id", out v) || !v.TryGetInt64(out id)) continue;
                            re.Id = id;
                            if (e.TryGetProperty("uid", out v) && v.ValueKind == JsonValueKind.String)
                                re.Uid = v.GetString();
                            if (e.TryGetProperty("cat", out v) && v.ValueKind == JsonValueKind.String)
                                re.Category = v.GetString();
                            re.Exists = e.TryGetProperty("exists", out v) &&
                                        v.ValueKind == JsonValueKind.True;
                            rows.Add(re);
                        }
                    }
                    JsonElement mm;
                    more = root.TryGetProperty("more", out mm) && mm.ValueKind == JsonValueKind.True;
                }
                return true;
            }
            catch
            {
                return false;
            }
        }

        public bool TryCollect(IList<FactRequest> items, FactSetStore store, out bool skipped, out bool more)
        {
            skipped = false;
            more = false;
            if (items == null || items.Count == 0 || store == null) return true;

            StringBuilder sb = new StringBuilder(64 + items.Count * 96);
            sb.Append("{\"items\":[");
            for (int i = 0; i < items.Count; i++)
            {
                FactRequest r = items[i];
                if (i > 0) sb.Append(',');
                sb.Append('{');
                CJson.Str(sb, "uid", r.Uid);
                sb.Append(",\"facts\":[");
                for (int k = 0; k < r.Facts.Count; k++)
                {
                    if (k > 0) sb.Append(',');
                    CJson.Quoted(sb, r.Facts[k]);
                }
                sb.Append("]}");
            }
            sb.Append("],\"cursor\":0}");

            ToolCall call = RevitToolBus.TryCall(
                "collect_rule_inputs", sb.ToString(), ComplianceScheduler.CollectTimeoutSec);
            if (call == null || call.Skipped) { skipped = true; return false; }
            if (!call.Success || string.IsNullOrEmpty(call.ResultJson)) return false;

            try
            {
                using (JsonDocument jd = JsonDocument.Parse(call.ResultJson))
                {
                    JsonElement root = jd.RootElement;
                    JsonElement facts;
                    if (root.TryGetProperty("facts", out facts) && facts.ValueKind == JsonValueKind.Object)
                    {
                        foreach (JsonProperty p in facts.EnumerateObject())
                        {
                            Dictionary<string, FactValue> map;
                            if (!store.Elements.TryGetValue(p.Name, out map))
                            {
                                map = new Dictionary<string, FactValue>(StringComparer.Ordinal);
                                store.Elements[p.Name] = map;
                            }
                            ReadFactMap(p.Value, map);
                        }
                    }
                    JsonElement docBlock;
                    if (root.TryGetProperty("doc", out docBlock) &&
                        docBlock.ValueKind == JsonValueKind.Object)
                    {
                        ReadFactMap(docBlock, store.Doc);
                    }
                    JsonElement mm;
                    more = root.TryGetProperty("more", out mm) && mm.ValueKind == JsonValueKind.True;
                }
                return true;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// ⚠️ `missing: true` ба `v: 0` нь ХОЁР ӨӨР ЗҮЙЛ (Хавсралт §4.3).
        /// `missing` тугийг уншихгүйгээр `v == 0`-ыг «байхгүй» гэж уншвал
        /// v2 §63-ын `zero` кейс нь `missing_input` болж ЧИМЭЭГҮЙ дарагдана.
        /// </summary>
        private static void ReadFactMap(JsonElement obj, Dictionary<string, FactValue> into)
        {
            foreach (JsonProperty p in obj.EnumerateObject())
            {
                JsonElement e = p.Value;
                if (e.ValueKind != JsonValueKind.Object) continue;

                JsonElement missing;
                if (e.TryGetProperty("missing", out missing) && missing.ValueKind == JsonValueKind.True)
                {
                    into[p.Name] = FactValue.Missing();
                    continue;
                }

                JsonElement v;
                if (!e.TryGetProperty("v", out v)) { into[p.Name] = FactValue.Missing(); continue; }

                if (v.ValueKind == JsonValueKind.String)
                {
                    into[p.Name] = FactValue.OfText(v.GetString());
                    continue;
                }
                if (v.ValueKind != JsonValueKind.Number)
                {
                    into[p.Name] = FactValue.Missing();
                    continue;
                }

                double num;
                if (!v.TryGetDouble(out num)) { into[p.Name] = FactValue.Missing(); continue; }

                string unit = Units.None;
                string spec = null;
                string src = "computed";
                JsonElement t;
                if (e.TryGetProperty("unit", out t) && t.ValueKind == JsonValueKind.String)
                    unit = t.GetString();
                if (e.TryGetProperty("spec", out t) && t.ValueKind == JsonValueKind.String)
                    spec = t.GetString();
                if (e.TryGetProperty("src", out t) && t.ValueKind == JsonValueKind.String)
                    src = t.GetString();

                into[p.Name] = FactValue.OfNumber(
                    Quantity.Of(num, unit, SourceOf(src), spec));
            }
        }

        /// <summary>
        /// ⚠️ УТАСНЫ ТОКЕН → enum.  Enum-ийн ТООН утгыг утсаар ХЭЗЭЭ Ч
        /// илгээхгүй (Хавсралт §4.2) — дараалал өөрчлөгдвөл чимээгүй буруу.
        ///
        /// ⚠️ Танихгүй токен нь `UntypedParam` — ХАМГИЙН БАГА ЭРХТЭЙ утга.
        /// `ConversionAllowed` түүнийг `false` гэж уншиж `mixed_provenance`
        /// болгоно; өгөгдмөл нь `Computed` байвал таних боломжгүй эх сурвалж
        /// БҮРЭН ИТГЭЛТЭЙ гэж уншигдана.
        /// </summary>
        private static QuantitySource SourceOf(string token)
        {
            switch (token)
            {
                case "builtin_geometry": return QuantitySource.BuiltinGeometry;
                case "typed_param": return QuantitySource.TypedParam;
                case "computed": return QuantitySource.Computed;
                default: return QuantitySource.UntypedParam;
            }
        }
    }
}
