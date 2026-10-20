using System;
using System.Collections.Generic;
using System.Globalization;

namespace RevitMcpAddin.CloneDrawings.Core
{
    // ══════════════════════════════════════════════════════════════════════
    //  «Зураг клонлох» 1.9.1 — харагдацын ШҮҮЛТ ба АНГИЛАЛ (Revit-гүй, тесттэй).
    //
    //  Эзний гомдол (2026-10-01): «хэт олон харагдац дууддаг — дам нуруу хийж байхад
    //  зөвхөн дам нурууны харагдацыг».  Хэмжсэн шалтгаан: загвар B1 нь ӨМНӨ клонлосон
    //  B2…B9-ийн харагдацад хөрш болж tag-лагддаг (тусгай харагдацын БҮХ tag клонлогддог)
    //  тул дахин клонлоход тэдгээр нь «B1-ийн зураг» болж ирээд зорилт бүрд ДАХИН
    //  хуулагддаг байв; багана, хавтангийн зургийн B1 tag ч мөн адил.  Одоо харагдац бүр
    //  гурван бүлгийн аль нэгэнд орно — зөвхөн «өөрийн зураг» өгөгдмөлөөр сонгогдоно.
    // ══════════════════════════════════════════════════════════════════════

    /// <summary>Харагдац загвар элементтэй хэрхэн холбогдсон бэ.</summary>
    public enum ViewRelevance
    {
        /// <summary>Загварын ӨӨРИЙН зураг (түүнд зориулсан зүсэлт, callout, нэрээр, гараар холбосон).</summary>
        Own = 0,
        /// <summary>Ерөнхий харагдац (план, 3D, ерөнхий зүсэлт) — tag/хэмжээсийг байранд нь нэмнэ.</summary>
        General = 1,
        /// <summary>ӨӨР элементийн зураг (баганы зүсэлт, B2-д клонлосон харагдац) — загвар зүгээр л харагддаг.</summary>
        Other = 2,
    }

    /// <summary>Нэг харагдацын тухай хэмжилтүүд — <see cref="ViewRelevanceRule.Classify"/>-ийн оролт.</summary>
    public sealed class ViewFacts
    {
        /// <summary>Хэрэглэгч гараар холбосон (эсвэл «Бусад харагдац хайх»-аар олдсон).</summary>
        public bool Manual;
        /// <summary>Энэ харагдацыг өмнө нь ЗАГВАРТ (зорилт байхад нь) клонлосон.</summary>
        public bool CloneOfTemplate;
        /// <summary>Энэ харагдацыг ӨӨР элементэд клонлосон (B2-ийн харагдац).</summary>
        public bool CloneOfOther;
        /// <summary>Нэрэнд нь (эсвэл хуудасных нь нэр/дугаарт) загварын тэмдэг бүтэн үгээр орсон.</summary>
        public bool ByName;
        /// <summary>Нэрэнд нь ӨӨР tag-лагдсан элементийн тэмдэг байгаа ч загварынх алга («C1 - зүсэлт»).</summary>
        public bool NamedForOther;
        /// <summary>Тайрах хүрээ загварын хэмжээнд ойр (<see cref="DedicatedRule"/>).</summary>
        public bool Dedicated;
        /// <summary>Тайрах хүрээний ТӨВ загвар элемент дээр (хүрээний 25%-ийн хүлцэлтэй).</summary>
        public bool TemplateCentered;
        /// <summary>Загвар (ба арматур)-ын tag/хэмжээсийн лавлагааны тоо.</summary>
        public int TemplateRefs;
        /// <summary>Тайрах хүрээний төв дээр байгаа, хамгийн их лавлагаатай ӨӨР элемент бий эсэх.</summary>
        public bool OtherCentered;
        public int OtherCenteredRefs;
        /// <summary>Callout бөгөөд эх харагдац нь загварын өөрийн зураг.</summary>
        public bool ParentIsOwn;
    }

    public static class ViewRelevanceRule
    {
        /// <summary>
        /// Дараалал нь чухал — хүчтэй дохио эхэнд:
        ///   1. Гараар холбосон / загварт клонлосон → өөрийн.   2. Өөр элементэд клонлосон → бусад.
        ///   3. Нэрэнд загварын тэмдэг → (тусгай бол) өөрийн, үгүй бол ерөнхий.
        ///   4. Нэрэнд өөр элементийн тэмдэг → бусад.            5. Тусгай биш (том) → ерөнхий.
        ///   6. Өөрийн зургийн callout → өөрийн.
        ///   7. Төвд нь өөр элемент, загвар төвд биш (эсвэл тэр элемент илүү тэмдэглэгээтэй) → бусад.
        /// </summary>
        public static ViewRelevance Classify(ViewFacts f)
        {
            if (f == null)
                return ViewRelevance.Own;
            if (f.Manual || f.CloneOfTemplate)
                return ViewRelevance.Own;
            if (f.CloneOfOther)
                return ViewRelevance.Other;
            if (f.ByName)
                return f.Dedicated ? ViewRelevance.Own : ViewRelevance.General;
            if (f.NamedForOther)
                return ViewRelevance.Other;
            if (!f.Dedicated)
                return ViewRelevance.General;
            if (f.ParentIsOwn)
                return ViewRelevance.Own;
            if (f.OtherCentered && (!f.TemplateCentered || f.OtherCenteredRefs > f.TemplateRefs))
                return ViewRelevance.Other;
            return ViewRelevance.Own;
        }

        /// <summary>Цонх нээгдэхэд өгөгдмөлөөр сонгогдох уу (хэрэглэгчийн санасан сонголтоос өмнө).</summary>
        public static bool DefaultSelected(ViewRelevance r) => r == ViewRelevance.Own;

        public static string GroupTitle(ViewRelevance r, string templateLabel)
        {
            switch (r)
            {
                case ViewRelevance.Own:
                    return "«" + templateLabel + "»-ийн өөрийн зураг";
                case ViewRelevance.General:
                    return "Ерөнхий харагдац — tag/хэмжээсийг байранд нь нэмнэ";
                default:
                    return "Бусад элементийн зураг — «" + templateLabel + "» зөвхөн харагддаг";
            }
        }
    }

    /// <summary>Шүүлтийн «харагдацын төрөл» бүлэг (товчлуурууд).</summary>
    public static class ViewTypeGroups
    {
        public const string Plan = "План";
        public const string Section = "Зүсэлт";
        public const string Elevation = "Фасад";
        public const string Detail = "Callout";
        public const string ThreeD = "3D";
        public const string Other = "Бусад";

        public static readonly string[] Order = { Plan, Section, Elevation, Detail, ThreeD, Other };

        /// <param name="viewType">Revit-ийн <c>ViewType</c> нэр («FloorPlan», «Section» …).</param>
        public static string Of(string viewType, bool isCallout)
        {
            switch (viewType)
            {
                case "FloorPlan":
                case "CeilingPlan":
                case "EngineeringPlan":
                case "AreaPlan":
                    return isCallout ? Detail : Plan;
                case "Section":
                    return isCallout ? Detail : Section;
                case "Elevation":
                    return isCallout ? Detail : Elevation;
                case "Detail":
                    return Detail;
                case "ThreeD":
                    return ThreeD;
                default:
                    return Other;
            }
        }
    }

    /// <summary>Хайлтын мөр — үг бүр (зайгаар) аль нэг талбарт агуулагдана; том/жижиг, кирилл/латин ижил дүрс ялгахгүй.</summary>
    public static class ViewSearch
    {
        public static bool Matches(string query, params string[] fields)
        {
            if (string.IsNullOrWhiteSpace(query))
                return true;
            var parts = new List<string>();
            if (fields != null)
            {
                foreach (string f in fields)
                {
                    if (!string.IsNullOrEmpty(f))
                        parts.Add(f);
                }
            }
            string hay = NameMatch.Fold(string.Join(" ", parts));
            foreach (string tok in query.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries))
            {
                if (hay.IndexOf(NameMatch.Fold(tok), StringComparison.Ordinal) < 0)
                    return false;
            }
            return true;
        }
    }

    /// <summary>Хэрэглэгчийн өмнөх сонголтыг санах — дараалал (хамгийн сүүлийнх ард), дээд хязгаартай.</summary>
    public static class RecentSet
    {
        public const int Limit = 400;

        /// <summary><paramref name="list"/>-ээс <paramref name="key"/>-г хасаад (байвал), <paramref name="add"/> бол ард нь нэмнэ.</summary>
        public static void Set(List<string> list, string key, bool add, int limit = Limit)
        {
            if (list == null || string.IsNullOrEmpty(key))
                return;
            list.RemoveAll(x => string.Equals(x, key, StringComparison.Ordinal));
            if (add)
            {
                list.Add(key);
                if (list.Count > limit)
                    list.RemoveRange(0, list.Count - limit);
            }
        }
    }

    /// <summary>Явцын тооцоо (самбар).</summary>
    public static class JobProgress
    {
        /// <summary>Дууссан нэгж + одоогийн нэгжийн хэсэг → 0..1.</summary>
        public static double Fraction(double doneUnits, int totalUnits)
        {
            if (totalUnits <= 0)
                return 0;
            double f = doneUnits / totalUnits;
            if (double.IsNaN(f) || f < 0)
                return 0;
            return f > 1 ? 1 : f;
        }

        public static int Percent(double fraction)
        {
            int p = (int)Math.Floor(fraction * 100 + 1e-9);
            return p < 0 ? 0 : p > 100 ? 100 : p;
        }

        /// <summary>Үлдсэн хугацааны таамаг — хэт эрт (2%-иас бага, 1.5 сек-ээс бага) бол null.</summary>
        public static TimeSpan? Remaining(long activeMs, double fraction)
        {
            if (fraction < 0.02 || fraction >= 1 || activeMs < 1500)
                return null;
            double total = activeMs / fraction;
            return TimeSpan.FromMilliseconds(Math.Max(0, total - activeMs));
        }

        /// <summary>«12 сек», «3:05», «1:02:07».</summary>
        public static string Duration(TimeSpan t)
        {
            if (t.TotalSeconds < 60)
                return Math.Max(0, (int)Math.Round(t.TotalSeconds)).ToString(CultureInfo.InvariantCulture) + " сек";
            if (t.TotalHours < 1)
                return ((int)t.TotalMinutes).ToString(CultureInfo.InvariantCulture) + ":" + t.Seconds.ToString("00", CultureInfo.InvariantCulture);
            return ((int)t.TotalHours).ToString(CultureInfo.InvariantCulture) + ":" + t.Minutes.ToString("00", CultureInfo.InvariantCulture)
                   + ":" + t.Seconds.ToString("00", CultureInfo.InvariantCulture);
        }

        /// <summary>Зорилт тутмын нэгж: эхлэл + шинэ харагдац + тэмдэглэгээтэй харагдац + хуудас + төгсгөл.</summary>
        public static int UnitsPerTarget(int newViews, int annotatedViews, int sheets) =>
            2 + Math.Max(0, newViews) + Math.Max(0, annotatedViews) + Math.Max(0, sheets);
    }

    /// <summary>
    /// Арын горимын transaction нэр.  ⚠️ Бүгд <see cref="Prefix"/>-ээр эхэлнэ: DocumentChanged нь
    /// энэ угтвараар «манай алхам уу, хэрэглэгчийнх үү»-г ялгаж, Ctrl+Z аль зорилтыг буцаасныг
    /// «i/N» хэсгээр нь олно.  Revit-ийн Undo жагсаалтад хүн уншихаар бичигдэнэ.
    /// </summary>
    public static class JobNames
    {
        public const string Prefix = "MGL клон";

        public static bool IsOurs(string transactionName) =>
            transactionName != null && transactionName.StartsWith(Prefix, StringComparison.Ordinal);

        /// <summary>
        /// «MGL клон 3/8 · B4 · харагдац «Зүсэлт 1-1»»; <paramref name="job"/> &gt; 0 бол «MGL клон #2 · 3/8 · …» — ижил загварыг
        /// ижил зорилтууд руу дахин клонлоход хоёр ажлын алхмын нэр давхцахгүй (Ctrl+Z/Y аль ажлынх болохыг нэрээр нь ялгадаг).
        /// </summary>
        public static string Step(int position, int count, string targetLabel, string what, int job = 0)
        {
            string s = Prefix + " " + (job > 0 ? "#" + job.ToString(CultureInfo.InvariantCulture) + " · " : "")
                       + position.ToString(CultureInfo.InvariantCulture) + "/" + count.ToString(CultureInfo.InvariantCulture)
                       + " · " + (targetLabel ?? "?");
            if (!string.IsNullOrEmpty(what))
                s += " · " + what;
            return Clip(s, 120);
        }

        public static string Job(string what) => Clip(Prefix + " · " + what, 120);

        /// <summary>Урт нэрийг «…»-ээр таслана.</summary>
        public static string Clip(string s, int max)
        {
            if (string.IsNullOrEmpty(s) || s.Length <= max)
                return s;
            return s.Substring(0, Math.Max(1, max - 1)) + "…";
        }

        /// <summary>«Зүсэлт 1-1» — харагдацын нэрийг богиносгож хашилтанд.</summary>
        public static string Quote(string name) => "«" + Clip(name ?? "?", 40) + "»";
    }
}
