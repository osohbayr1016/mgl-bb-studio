using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ClashCheck.Core
{
    public sealed class RuleIssue
    {
        public bool IsError { get; set; }
        public string Message { get; set; }
    }

    public static class ClashRuleLogic
    {
        /* ======================== СОНГОГЧИЙН ТЭНЦЭЛ ======================== */

        private static string NormName(string s)
        {
            return (s ?? "").Trim().ToUpperInvariant();
        }

        private static List<string> NormCats(ClashSelector s)
        {
            return (s.Categories ?? new List<string>()).Where(c => !string.IsNullOrWhiteSpace(c))
                .Select(c => c.Trim().ToUpperInvariant()).Distinct().OrderBy(c => c, StringComparer.Ordinal).ToList();
        }

        public static bool SelectorsEqual(ClashSelector a, ClashSelector b)
        {
            if (a == null || b == null) return false;
            return a.Source == b.Source
                && NormName(a.NameContains) == NormName(b.NameContains)
                && NormName(a.LinkContains) == NormName(b.LinkContains)
                && NormCats(a).SequenceEqual(NormCats(b));
        }

        /* ============================ ТОХИРГООНЫ ХЭШ ======================== */

        /// <summary>
        /// Дүрмийн ҮР ДҮНД нөлөөлөх тохиргооны хэш: сонгогчид, горим, эзлэхүүний босго, зориудын давхцлыг алгасах
        /// туг.  Нэр, идэвхтэй эсэх, ноцтой байдал ОРООГҮЙ (үр дүнг өөрчлөхгүй).
        ///
        /// ⚠️ ЯАГААД ЭНЭ: дүрмийн агуулга өөрчлөгдсөн (нэмэлт ангилал, хатуу босго) үед хуучин
        /// «зөвшөөрсөн» шийдвэр чимээгүй шинэ тохиргоонд хамаарах ёсгүй.  Хэш өөрчлөгдвөл хуучин issue-ууд
        /// «өөр хувилбарын дүрмийнх» болж түүхэд үлдэж (`ClashReconciler`), одоогийн жагсаалтад орохгүй.
        /// </summary>
        public static string SemanticHash(ClashRule r)
        {
            Func<ClashSelector, string> sel = s =>
                string.Join("|", NormCats(s)) + ";" + s.Source + ";" + NormName(s.NameContains) + ";" + NormName(s.LinkContains);
            return SmartHash.Of(
                "clash-rule-v1",
                sel(r.A), sel(r.B),
                r.Mode.ToString(),
                r.MinVolumeCm3.ToString("R", CultureInfo.InvariantCulture),
                r.ClearanceMm.ToString("R", CultureInfo.InvariantCulture),
                r.IgnoreJoined ? "j1" : "j0", r.IgnoreHosted ? "h1" : "h0", r.IgnoreConnected ? "c1" : "c0");
        }

        /* =============================== FINGERPRINT ======================== */

        /// <summary>
        /// ТОГТВОРТОЙ таних тэмдэг: дүрмийн id + тохиргооны хэш + хос элементийн түлхүүр (ЭРЭМБЭЛЭЛТГҮЙ —
        /// A/B дараалал солигдсон ч ижил).
        ///
        /// ⚠️ ХЭЗЭЭ Ч огтлолцлын XYZ координат ОРООХГҮЙ: геометр бага зэрэг хөдлөхөд (хоолойг 20 мм
        /// шилжүүлэхэд) ижил хос нь ШИНЭ clash болж «зөвшөөрсөн» шийдвэр алдагдах ёсгүй.
        /// Сэргээн үүсгэсэн элемент (UniqueId өөр) = ӨӨР таних тэмдэг — зориудаар.
        /// </summary>
        public static string Fingerprint(string ruleId, string ruleHash, ElementKey a, ElementKey b)
        {
            string ka = a.ToString(), kb = b.ToString();
            if (string.CompareOrdinal(ka, kb) > 0) { string t = ka; ka = kb; kb = t; }
            return SmartHash.Of("clash-fp-v1", ruleId ?? "", ruleHash ?? "", ka, kb);
        }

        /* =============================== БАТАЛГААЖУУЛАЛТ ==================== */

        public static List<RuleIssue> Validate(ClashRule r)
        {
            var l = new List<RuleIssue>();
            if (r == null) { l.Add(new RuleIssue { IsError = true, Message = "Дүрэм байхгүй." }); return l; }

            if (string.IsNullOrWhiteSpace(r.Name)) l.Add(new RuleIssue { IsError = true, Message = "Дүрмийн нэр хоосон." });

            if (r.Mode == ClashMode.Unknown)
                l.Add(new RuleIssue { IsError = true, Message = "Дүрмийн горим танигдсангүй." });
            if (r.Mode == ClashMode.Clearance)
                l.Add(new RuleIssue { IsError = true, Message = "«Зай (clearance)» горим одоогоор ДЭМЖИГДЭХГҮЙ — геометрийн шалгагч байхгүй тул ажиллуулахгүй. «Хатуу огтлолцол»-ыг ашиглана уу." });

            CheckSelector(l, r.A, "A");
            CheckSelector(l, r.B, "B");

            if (r.MinVolumeCm3 < 0 || double.IsNaN(r.MinVolumeCm3) || double.IsInfinity(r.MinVolumeCm3))
                l.Add(new RuleIssue { IsError = true, Message = "Эзлэхүүний босго сөрөг/буруу байна." });
            if (r.MinVolumeCm3 > 1e6)
                l.Add(new RuleIssue { IsError = false, Message = "Эзлэхүүний босго хэт өндөр (> 1 м³) — бараг бүх clash алгасагдана." });
            return l;
        }

        private static void CheckSelector(List<RuleIssue> l, ClashSelector s, string side)
        {
            if (s == null) { l.Add(new RuleIssue { IsError = true, Message = side + " сонгогч байхгүй." }); return; }
            if (!(s.Categories ?? new List<string>()).Any(c => !string.IsNullOrWhiteSpace(c)))
                l.Add(new RuleIssue { IsError = true, Message = side + " талд ядаж нэг ангилал сонгоно уу (бүх элементийг шалгах нь хэт удаан)." });
            if (s.Source == ClashSource.Host && !string.IsNullOrWhiteSpace(s.LinkContains))
                l.Add(new RuleIssue { IsError = false, Message = side + " талын «линкийн нэр» шүүлтүүр зөвхөн линк эх үүсвэрт хамаарна." });
        }

        public static bool IsRunnable(List<RuleIssue> issues) { return !issues.Any(i => i.IsError); }

        /* ================================ СТАРТЕР ============================ */

        public static List<ClashRule> Starters()
        {
            Func<string[], ClashSelector> sel = cats => new ClashSelector { Categories = cats.ToList(), Source = ClashSource.Host };
            var list = new List<ClashRule>
            {
                new ClashRule { Name = "Хоолой ↔ Дам нуруу", A = sel(new[] { "OST_PipeCurves" }), B = sel(new[] { "OST_StructuralFraming" }), Severity = ClashSeverity.Critical },
                new ClashRule { Name = "Агааржуулалтын хоолой ↔ Дам нуруу", A = sel(new[] { "OST_DuctCurves" }), B = sel(new[] { "OST_StructuralFraming" }), Severity = ClashSeverity.Critical },
                new ClashRule { Name = "Хоолой ↔ Агааржуулалтын хоолой", A = sel(new[] { "OST_PipeCurves" }), B = sel(new[] { "OST_DuctCurves" }) },
                new ClashRule
                {
                    Name = "MEP ↔ Бүтэц",
                    A = sel(new[] { "OST_PipeCurves", "OST_DuctCurves", "OST_CableTray", "OST_Conduit" }),
                    B = sel(new[] { "OST_StructuralFraming", "OST_StructuralColumns", "OST_Floors", "OST_Walls" }),
                },
                new ClashRule
                {
                    Name = "Архитектур ↔ Бүтэц",
                    A = sel(new[] { "OST_Walls", "OST_Doors", "OST_Windows" }),
                    B = sel(new[] { "OST_StructuralColumns", "OST_StructuralFraming" }),
                    IgnoreHosted = true,
                },
            };
            return list;
        }
    }

    public static class ClashRuleStore
    {
        public const int Schema = 1;
        public const string FileName = "clash-rules.json";

        public static ClashRulesFile Load(SmartStore store = null)
        {
            store = store ?? SmartStore.Default;
            LoadResult<ClashRulesFile> r = store.Load<ClashRulesFile>(FileName, Schema, () => new ClashRulesFile());
            ClashRulesFile f = r.Value ?? new ClashRulesFile();
            if (f.Rules == null) f.Rules = new List<ClashRule>();
            foreach (ClashRule rule in f.Rules) Normalize(rule);

            if (!f.StartersSeeded && f.Rules.Count == 0)
            {
                f.Rules.AddRange(ClashRuleLogic.Starters());
                f.StartersSeeded = true;
                Save(f, store);
            }
            return f;
        }

        public static bool Save(ClashRulesFile f, SmartStore store = null)
        {
            store = store ?? SmartStore.Default;
            return store.Save(FileName, Schema, f);
        }

        public static ClashRule Upsert(ClashRulesFile f, ClashRule rule)
        {
            Normalize(rule);
            int idx = f.Rules.FindIndex(x => x.Id == rule.Id);
            if (idx < 0) f.Rules.Add(rule); else f.Rules[idx] = rule;
            return rule;
        }

        public static bool Delete(ClashRulesFile f, string id)
        {
            return f.Rules.RemoveAll(x => x.Id == id) > 0;
        }

        public static void Normalize(ClashRule r)
        {
            if (r == null) return;
            if (string.IsNullOrWhiteSpace(r.Id)) r.Id = SmartHash.NewId();
            if (r.A == null) r.A = new ClashSelector();
            if (r.B == null) r.B = new ClashSelector();
            if (r.A.Categories == null) r.A.Categories = new List<string>();
            if (r.B.Categories == null) r.B.Categories = new List<string>();
        }
    }
}
