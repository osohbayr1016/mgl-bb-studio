using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace RevitMcpAddin
{
    internal sealed class RuleTrigger
    {
        /// <summary>Revit-ийн категорийн ЭХ нэр — ОРЧУУЛАХГҮЙ (0204:110-ийн дүрэм).</summary>
        public string Category;
        /// <summary>"add" | "modify" | "delete"</summary>
        public string Change;
    }

    internal sealed class RuleRequires
    {
        /// <summary>УГТВАРГҮЙ, element scope (Хавсралт §1.1).</summary>
        public string[] Params;
        /// <summary>ХООСОН = дүрэм зөвхөн БҮТЭН СКАН дээр ажиллана.</summary>
        public RuleTrigger[] TriggeredBy;
    }

    internal sealed class RuleException
    {
        public string Code;
        /// <summary>
        /// ХАМААРЛЫН фазад үнэлэгдэнэ.  True бол дүрэм NOT_APPLICABLE.
        /// ⚠️ ЗААВАЛ, СОНГОЛТ БИШ (Хавсралт §2.2: `when: PredicateNode`).
        /// `null` үлдээх нь `RuleEngine`-ийг FAIL-OPEN болгоно, тиймээс
        /// `ParseRule` нь `when`-гүй үл хамаарах зүйлтэй БАГЦЫГ ТАТГАЛЗАНА.
        /// </summary>
        public CheckNode When;
        public string NoteMn;
    }

    /// <summary>
    /// БАГЦААР ЯВДАГ ДҮРЭМ.  ⚠️ `record`, `init`, nullable reference type
    /// ХЭРЭГЛЭХГҮЙ (net48 = Revit 2024).  Revit-ийн API-гийн ямар ч төрөл
    /// БАЙХГҮЙ — `RuleDef` нь ЦЭВЭР ӨГӨГДӨЛ.
    ///
    /// ⚠️ `authored_by` / `reviewed_by` / `status` / `created_at` нь БАГЦАД
    /// ХЭЗЭЭ Ч ОРОХГҮЙ (Хавсралт §2.1) — тиймээс энд ч талбар БАЙХГҮЙ.
    /// </summary>
    internal sealed class RuleDef
    {
        public string RuleUid;
        public int Version;
        public string SemanticHash;
        /// <summary>null = компани даяар.</summary>
        public string TeamCode;

        public string TitleMn;
        public string TitleEn;

        public string DocumentUid;
        public string ClauseUid;
        public string EditionRef;
        public string EffectiveFrom;

        /// <summary>UNVERIFIED | CLAUSE_CITED | HUMAN_VERIFIED</summary>
        public string VerificationState;
        public string IssueClass;
        public string Severity;

        public string Unit;
        /// <summary>Релиз N-д ҮРГЭЛЖ "none" — нийтлэх хаалга.</summary>
        public string CoordinateSystem;

        public bool ExpectApplicable;
        public string[] RequiresContext;

        /// <summary>null = үргэлж хамаарна (Хавсралт §5.6).</summary>
        public CheckNode Applicability;
        /// <summary>null = шалгах юмгүй (Хавсралт §5.6).</summary>
        public CheckNode Check;

        public RuleRequires Requires;
        public RuleException[] Exceptions;
        public string RecommendationMn;
    }

    internal sealed class ConflictEntry
    {
        public string RuleUidA;
        public string RuleUidB;
        public string ConflictKind;
        public string Scope;
        public string Precedence;
        public string NoteMn;
    }

    /// <summary>
    /// ⚠️ Түлхүүр нь НОРМЧИЛСОН хос: OrdinalCompare-ээр эрэмбэлээд '\0'-ээр
    /// залгасан мөр.  `(a,b)` ба `(b,a)` НЭГ л мөр — эс бөгөөс серверийн
    /// `idx_rule_conflicts_pair` UNIQUE индекстэй утга зөрнө.
    /// </summary>
    internal sealed class ConflictTable
    {
        private readonly Dictionary<string, ConflictEntry> _byPair =
            new Dictionary<string, ConflictEntry>(StringComparer.Ordinal);
        private readonly Dictionary<string, List<string>> _partners =
            new Dictionary<string, List<string>>(StringComparer.Ordinal);

        internal static string Key(string a, string b)
        {
            return string.CompareOrdinal(a, b) <= 0 ? a + "\0" + b : b + "\0" + a;
        }

        internal static ConflictTable Build(ConflictEntry[] entries)
        {
            ConflictTable t = new ConflictTable();
            if (entries == null) return t;
            for (int i = 0; i < entries.Length; i++)
            {
                ConflictEntry e = entries[i];
                if (e == null || string.IsNullOrEmpty(e.RuleUidA) || string.IsNullOrEmpty(e.RuleUidB)) continue;
                t._byPair[Key(e.RuleUidA, e.RuleUidB)] = e;
                t.AddPartner(e.RuleUidA, e.RuleUidB);
                t.AddPartner(e.RuleUidB, e.RuleUidA);
            }
            return t;
        }

        private void AddPartner(string from, string to)
        {
            List<string> list;
            if (!_partners.TryGetValue(from, out list))
            {
                list = new List<string>();
                _partners[from] = list;
            }
            if (!list.Contains(to)) list.Add(to);
        }

        internal bool Has(string a, string b) { return _byPair.ContainsKey(Key(a, b)); }

        internal ConflictEntry Get(string a, string b)
        {
            ConflictEntry e;
            return _byPair.TryGetValue(Key(a, b), out e) ? e : null;
        }

        internal IList<string> PartnersOf(string ruleUid)
        {
            List<string> list;
            if (!_partners.TryGetValue(ruleUid, out list)) return new List<string>();
            List<string> copy = new List<string>(list);
            copy.Sort(StringComparer.Ordinal);
            return copy;
        }

        internal int Count { get { return _byPair.Count; } }
    }

    /// <summary>
    /// ДҮРМИЙН БАГЦЫН АЧААЛАГЧ — `IntentModel.cs`-ийн бараг хуулбар.
    ///
    /// ⚠️ ГЭРЭЭ ЗӨРВӨЛ ТАТГАЛЗАНА (`IntentModel.cs:311-312`-ийн хэв маяг).
    ///    «Ойролцоо таарвал ачаална» гэсэн хувилбар нь БУРУУ ДҮРМЭЭР ЧИМЭЭГҮЙ
    ///    ажиллана — тэр нь энэ хөдөлгүүрийн хамгийн муу уналт.
    ///
    /// ⚠️ ГУРВАН ТҮВШНИЙ УНАЛТ: татсан → шигтгээстэй canary → байхгүй.
    ///    Офлайн үед ЧИМЭЭГҮЙ (v2 §75) — `catch { return null; }`.
    ///
    /// ⚠️ КЭШИЙН ФАЙЛЫН НЭР НЬ ХЭШ АГУУЛНА:
    ///      %APPDATA%\RevitMcpAddin\rulepack-&lt;TEAM&gt;-&lt;sha[:16]&gt;-&lt;pid&gt;.json
    ///    `%APPDATA%` нь хэрэглэгчийн бичих эрхтэй — инженер 1500-ыг 1000 болгож
    ///    засвал `ruleset_version` хэвээр үлдэж, сервер багц хэрэгжсэн гэж
    ///    итгэнэ.  Тиймээс клиент өөрийн уншсан байтыг hash хийж, ДОТООД
    ///    `pack_sha256`-тай БАС ФАЙЛЫН НЭРТЭЙ тулгана; аль нэг нь зөрвөл
    ///    БҮХ БАГЦЫГ ТАТГАЛЗАНА.
    /// </summary>
    internal static class RulePack
    {
        internal const string PackContract = "rulepack-v1";

        internal sealed class Loaded
        {
            public string TeamCode;
            public string RulesetVersion;
            public string PackSha256;
            public ProjectBuildContext Context;
            public RuleDef[] Rules;
            public ConflictTable Conflicts;
            /// <summary>"local" | "embedded" | "none"</summary>
            public string Source;
        }

        private static string CacheDir
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "RevitMcpAddin");
            }
        }

        internal static string CachePath(string teamCode, string sha256)
        {
            string shortSha = string.IsNullOrEmpty(sha256) || sha256.Length < 16
                ? "0000000000000000"
                : sha256.Substring(0, 16);
            int pid = System.Diagnostics.Process.GetCurrentProcess().Id;
            return Path.Combine(
                CacheDir,
                "rulepack-" + (teamCode ?? "NONE") + "-" + shortSha + "-" + pid + ".json");
        }

        /// <summary>
        /// Гурван түвшний уналт.  ХЭЗЭЭ Ч ШИДЭХГҮЙ.
        /// </summary>
        internal static Loaded Load(string teamCode)
        {
            try
            {
                string dir = CacheDir;
                if (Directory.Exists(dir))
                {
                    string prefix = "rulepack-" + (teamCode ?? "NONE") + "-";
                    string[] files = Directory.GetFiles(dir, prefix + "*.json");
                    Array.Sort(files, StringComparer.Ordinal);
                    for (int i = files.Length - 1; i >= 0; i--)
                    {
                        Loaded local = ParseVerified(File.ReadAllText(files[i], Encoding.UTF8), files[i]);
                        if (local != null)
                        {
                            local.Source = "local";
                            return local;
                        }
                    }
                }
            }
            catch
            {
                // Диск уншиж чадахгүй нь ЧИМЭЭГҮЙ уналт — шигтгээстэй руу.
            }

            try
            {
                string embedded = LoadEmbedded();
                if (embedded != null)
                {
                    Loaded pack = ParseVerified(embedded, null);
                    if (pack != null)
                    {
                        pack.Source = "embedded";
                        return pack;
                    }
                }
            }
            catch
            {
            }
            return null;
        }

        /// <summary>Серверээс татсан багцыг хадгална.  Амжилттай бол true.</summary>
        internal static bool SaveDownloaded(string teamCode, string json)
        {
            try
            {
                Loaded pack = ParseVerified(json, null);
                if (pack == null) return false;
                Directory.CreateDirectory(CacheDir);
                string path = CachePath(teamCode, pack.PackSha256);
                // ⚠️ BOM-гүй — бусад хэрэгсэл (Python) уншиж болзошгүй.
                File.WriteAllText(path, json, new UTF8Encoding(false));
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static string LoadEmbedded()
        {
            Assembly asm = Assembly.GetExecutingAssembly();
            string[] names = asm.GetManifestResourceNames();
            for (int i = 0; i < names.Length; i++)
            {
                if (!names[i].EndsWith("rulepack-canary.json", StringComparison.OrdinalIgnoreCase)) continue;
                using (Stream s = asm.GetManifestResourceStream(names[i]))
                {
                    if (s == null) continue;
                    using (StreamReader r = new StreamReader(s, Encoding.UTF8))
                    {
                        return r.ReadToEnd();
                    }
                }
            }
            return null;
        }

        /// <summary>
        /// Задлаад БҮХ ШАЛГУУРЫГ ажиллуулна.  Аль нэг нь унавал `null` —
        /// ХАГАС АЧААЛАХГҮЙ.
        /// </summary>
        internal static Loaded ParseVerified(string json, string filePathOrNull)
        {
            if (string.IsNullOrEmpty(json)) return null;
            JsonDocument doc;
            try
            {
                doc = JsonDocument.Parse(json);
            }
            catch
            {
                return null;
            }
            using (doc)
            {
                JsonElement root = doc.RootElement;
                if (root.ValueKind != JsonValueKind.Object) return null;

                string contract = Str(root, "pack_contract");
                if (!string.Equals(contract, PackContract, StringComparison.Ordinal)) return null;

                string declared = Str(root, "pack_sha256");
                string computed = ComputePackSha256(root);
                if (computed == null) return null;
                if (!string.Equals(declared, computed, StringComparison.Ordinal)) return null;

                if (!string.IsNullOrEmpty(filePathOrNull))
                {
                    // Файлын нэрэн дэх богино хэш нь ЗӨРВӨЛ ТАТГАЛЗАНА.
                    string name = Path.GetFileNameWithoutExtension(filePathOrNull);
                    if (name == null || name.IndexOf(computed.Substring(0, 16), StringComparison.Ordinal) < 0)
                    {
                        return null;
                    }
                }

                Loaded pack = new Loaded();
                pack.TeamCode = Str(root, "team_code");
                pack.RulesetVersion = Str(root, "ruleset_version");
                pack.PackSha256 = computed;
                pack.Context = ParseContext(root);

                List<RuleDef> rules = new List<RuleDef>();
                JsonElement rulesEl;
                if (root.TryGetProperty("rules", out rulesEl) && rulesEl.ValueKind == JsonValueKind.Array)
                {
                    foreach (JsonElement r in rulesEl.EnumerateArray())
                    {
                        RuleDef def = ParseRule(r);
                        if (def == null) return null;   // ⚠️ ХАГАС АЧААЛАХГҮЙ
                        rules.Add(def);
                    }
                }
                pack.Rules = rules.ToArray();

                List<ConflictEntry> conflicts = new List<ConflictEntry>();
                JsonElement confEl;
                if (root.TryGetProperty("conflicts", out confEl) && confEl.ValueKind == JsonValueKind.Array)
                {
                    foreach (JsonElement ce in confEl.EnumerateArray())
                    {
                        string scope = Str(ce, "scope");
                        // ⚠️ `cross_discipline` нь клиент дээр илрэх БҮТЭЦИЙН
                        //    ХУВЬД БОЛОМЖГҮЙ — багцад ч орох ёсгүй.
                        if (!string.Equals(scope, "intra_pack", StringComparison.Ordinal)) continue;
                        ConflictEntry e = new ConflictEntry();
                        e.RuleUidA = Str(ce, "rule_uid_a");
                        e.RuleUidB = Str(ce, "rule_uid_b");
                        e.ConflictKind = Str(ce, "conflict_kind");
                        e.Scope = scope;
                        e.Precedence = Str(ce, "precedence");
                        e.NoteMn = Str(ce, "note_mn");
                        conflicts.Add(e);
                    }
                }
                pack.Conflicts = ConflictTable.Build(conflicts.ToArray());
                return pack;
            }
        }

        private static ProjectBuildContext ParseContext(JsonElement root)
        {
            ProjectBuildContext c = ProjectBuildContext.Empty();
            JsonElement el;
            if (!root.TryGetProperty("project_context", out el) || el.ValueKind != JsonValueKind.Object)
            {
                return c;
            }
            c.ProjectId = (int)(Dbl(el, "project_id") ?? 0);
            c.DocUid = Str(el, "doc_uid") ?? "";
            c.HeightM = Dbl(el, "height_m");
            c.StoriesAboveGrade = Dbl(el, "stories_above_grade");
            c.StoriesBelowGrade = Dbl(el, "stories_below_grade");
            c.GrossAreaM2 = Dbl(el, "gross_area_m2");
            c.OccupantLoad = Dbl(el, "occupant_load");
            c.BuildingType = Str(el, "building_type");
            c.OccupancyClass = Str(el, "occupancy_class");
            c.GradeLevelName = Str(el, "grade_level_name");
            c.TopLevelName = Str(el, "top_level_name");
            c.RoomBoundaryLocation = Str(el, "room_boundary_location");
            c.FireSafetyClass = Str(el, "fire_safety_class");
            c.SeismicIntensity = Str(el, "seismic_intensity");
            c.ProjectPhase = Str(el, "project_phase");
            c.Jurisdiction = Str(el, "jurisdiction") ?? "MN";
            return c;
        }

        private static RuleDef ParseRule(JsonElement r)
        {
            if (r.ValueKind != JsonValueKind.Object) return null;
            RuleDef d = new RuleDef();
            d.RuleUid = Str(r, "rule_uid");
            if (string.IsNullOrEmpty(d.RuleUid)) return null;
            d.Version = (int)(Dbl(r, "version") ?? 1);
            d.SemanticHash = Str(r, "semantic_hash");
            d.TeamCode = Str(r, "team_code");
            d.TitleMn = Str(r, "title_mn");
            d.TitleEn = Str(r, "title_en");
            d.DocumentUid = Str(r, "document_uid");
            d.ClauseUid = Str(r, "clause_uid");
            d.EditionRef = Str(r, "edition_ref");
            d.EffectiveFrom = Str(r, "effective_from");
            d.VerificationState = Str(r, "verification_state") ?? "UNVERIFIED";

            // ⚠️ ЭШЛЭЛИЙН ХАВЧААР — КЛИЕНТ ДЭЭР ДАХИН.  Сервер нь
            //    `rulePack.ts:ruleDefToWire`-д аль хэдийн хоослодог; энэ нь
            //    ГАРААР засагдсан `%APPDATA%` багц, эсвэл хуучин серверийн
            //    багцын эсрэг ХОЁР ДАХЬ ДАВХАРГА.  Эзний шийдвэр: UNVERIFIED
            //    нь ЭШЛЭЛИЙГ дарна, зөвхөн ноцтой байдлыг БИШ.
            //    ⚠️ ТАТГАЛЗАХГҮЙ, ХООСЛОНО: эшлэл нь дүрмийн ГАНЦ БУРУУ
            //    ТАЛБАР бөгөөд дүрмийг бүхэлд нь хаях нь шалгалтыг ЧИМЭЭГҮЙ
            //    унтраана — тэр нь энэ давхаргын эмчлэх гэж буй уналт мөн.
            if (string.Equals(d.VerificationState, "UNVERIFIED", StringComparison.Ordinal))
            {
                d.DocumentUid = null;
                d.ClauseUid = null;
                d.EditionRef = null;
            }
            d.IssueClass = Str(r, "issue_class") ?? "REGULATORY_VIOLATION";
            d.Severity = Str(r, "severity") ?? "MEDIUM";
            d.Unit = Str(r, "unit") ?? Units.None;
            d.CoordinateSystem = Str(r, "coordinate_system") ?? "none";
            if (!Units.IsKnown(d.Unit)) return null;

            // ⚠️ КООРДИНАТЫН ХААЛГА нь КЛИЕНТ ДЭЭР ДАВХАР: серверийн
            //    `rulePack.ts` гараар тойрогдсон ч энд зогсоно.
            if (!string.Equals(d.CoordinateSystem, "none", StringComparison.Ordinal)) return null;

            JsonElement b;
            d.ExpectApplicable = r.TryGetProperty("expect_applicable", out b) && b.ValueKind == JsonValueKind.True;
            d.RequiresContext = StrArray(r, "requires_context");
            d.RecommendationMn = Str(r, "recommendation_mn");

            string err;
            JsonElement app;
            if (r.TryGetProperty("applicability", out app) && !RuleEngine.IsEmptyObject(app))
            {
                CheckNode node;
                if (!RuleEngine.TryParsePredicate(app, out node, out err)) return null;
                d.Applicability = node;
            }
            JsonElement chk;
            if (r.TryGetProperty("check", out chk) && !RuleEngine.IsEmptyObject(chk))
            {
                CheckNode node;
                if (!RuleEngine.TryParseCheck(chk, out node, out err)) return null;
                d.Check = node;
            }

            int nodes = RuleEngine.CountNodes(d.Applicability) + RuleEngine.CountNodes(d.Check);

            d.Requires = new RuleRequires();
            d.Requires.Params = new string[0];
            d.Requires.TriggeredBy = new RuleTrigger[0];
            JsonElement req;
            if (r.TryGetProperty("requires", out req) && req.ValueKind == JsonValueKind.Object)
            {
                d.Requires.Params = StrArray(req, "params");
                List<RuleTrigger> trg = new List<RuleTrigger>();
                JsonElement tb;
                if (req.TryGetProperty("triggered_by", out tb) && tb.ValueKind == JsonValueKind.Array)
                {
                    foreach (JsonElement t in tb.EnumerateArray())
                    {
                        RuleTrigger one = new RuleTrigger();
                        one.Category = Str(t, "category");
                        one.Change = Str(t, "change");
                        if (string.IsNullOrEmpty(one.Category)) return null;
                        if (one.Change != "add" && one.Change != "modify" && one.Change != "delete") return null;
                        trg.Add(one);
                    }
                }
                d.Requires.TriggeredBy = trg.ToArray();
            }

            List<RuleException> exs = new List<RuleException>();
            JsonElement exEl;
            if (r.TryGetProperty("exceptions", out exEl) && exEl.ValueKind == JsonValueKind.Array)
            {
                foreach (JsonElement x in exEl.EnumerateArray())
                {
                    RuleException one = new RuleException();
                    one.Code = Str(x, "code");
                    one.NoteMn = Str(x, "note_mn");
                    if (string.IsNullOrEmpty(one.Code)) return null;
                    // ⚠️ `when` нь ЗААВАЛ бөгөөд ХООСОН `{}` БАЙЖ БОЛОХГҮЙ.
                    //    Серверийн `exceptionArray` (`rulePack.ts`) нь
                    //    `parsePredicate`-гүй үл хамаарах зүйлийг хадгалахыг
                    //    зөвшөөрдөггүй, `parsePredicate({})` нь «хоосон
                    //    зангилаа» гэж унадаг — тиймээс энд ирж болох ГАНЦ зам
                    //    нь ЭВДЭРСЭН эсвэл ГАРААР ЗАССАН багц.
                    //    ТАТГАЛЗАНА, АЛГАСАХГҮЙ: алгасах нь дүрэм ИЛ зөвшөөрсөн
                    //    тохиолдлыг зөрчил болгож инженерийн нүүр рүү гаргана
                    //    (fail-open), харин татгалзал нь `Parse` -ийн
                    //    «ХАГАС АЧААЛАХГҮЙ» дүрмээр БҮХ БАГЦЫГ буцаана.
                    JsonElement when;
                    if (!x.TryGetProperty("when", out when)) return null;
                    if (RuleEngine.IsEmptyObject(when)) return null;
                    {
                        CheckNode node;
                        if (!RuleEngine.TryParsePredicate(when, out node, out err)) return null;
                        one.When = node;
                        nodes += RuleEngine.CountNodes(node);
                    }
                    exs.Add(one);
                }
            }
            d.Exceptions = exs.ToArray();

            if (nodes > RuleEngine.MAX_NODES_PER_RULE) return null;
            return d;
        }

        /* ============================================================== */
        /*  MGL-CANON-1 ба SHA-256 — Хавсралт §6, §7                       */
        /* ============================================================== */

        /// <summary>
        /// §7.2 — `pack_sha256` ба `generated_at` ХОЁРЫГ ХООСОН МӨР болгож
        /// солиод канончилно.  Гишүүнийг УСТГАХГҮЙ — түлхүүрийн олонлог ХЭВЭЭР.
        /// `generated_at` хасагдах нь `2-3`-ын `stale_reason='ruleset'`
        /// хуучруулалтыг ажиллах чадвартай байлгах ШААРДЛАГА (§7.3).
        /// </summary>
        internal static string ComputePackSha256(JsonElement root)
        {
            try
            {
                StringBuilder sb = new StringBuilder();
                CanonObject(root, sb, new string[] { "pack_sha256", "generated_at" });
                return Sha256Hex(sb.ToString());
            }
            catch
            {
                return null;
            }
        }

        internal static string Sha256Hex(string utf8Text)
        {
            byte[] bytes = new UTF8Encoding(false).GetBytes(utf8Text);
            using (SHA256 sha = SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(bytes);
                StringBuilder sb = new StringBuilder(64);
                for (int i = 0; i < hash.Length; i++) sb.Append(hash[i].ToString("x2", CultureInfo.InvariantCulture));
                return sb.ToString();
            }
        }

        /// <summary>MGL-CANON-1 — C1 зайгүй, C2 ordinal түлхүүрийн эрэмбэ,
        /// C3 цувааны дараалал ХЭВЭЭР, C4 хамгийн богино escape, C6 тооны профайл.</summary>
        internal static void Canon(JsonElement e, StringBuilder sb)
        {
            switch (e.ValueKind)
            {
                case JsonValueKind.Object:
                    CanonObject(e, sb, null);
                    return;
                case JsonValueKind.Array:
                {
                    sb.Append('[');
                    bool first = true;
                    foreach (JsonElement x in e.EnumerateArray())
                    {
                        if (!first) sb.Append(',');
                        Canon(x, sb);
                        first = false;
                    }
                    sb.Append(']');
                    return;
                }
                case JsonValueKind.String:
                    CanonString(e.GetString(), sb);
                    return;
                case JsonValueKind.Number:
                {
                    // ⚠️ ТҮҮХИЙ БИЧВЭРИЙГ канончилно — double руу хөрвүүлэхгүй.
                    //    net48-ийн `double.ToString("R")` давхар-хөрвүүлэлтийн
                    //    алдаа, `G17`-ийн `0.05 → 0.050000000000000003` зөрүү
                    //    хоёул ЭНЭ ЗАМААР тойрогдоно.
                    string raw = e.GetRawText();
                    string canon = CanonNumber(raw);
                    if (canon == null) throw new FormatException("тоо профайлаас гадуур: " + raw);
                    sb.Append(canon);
                    return;
                }
                case JsonValueKind.True: sb.Append("true"); return;
                case JsonValueKind.False: sb.Append("false"); return;
                default: sb.Append("null"); return;
            }
        }

        private static void CanonObject(JsonElement e, StringBuilder sb, string[] blankKeys)
        {
            List<string> keys = new List<string>();
            foreach (JsonProperty p in e.EnumerateObject()) keys.Add(p.Name);
            keys.Sort(StringComparer.Ordinal);

            sb.Append('{');
            for (int i = 0; i < keys.Count; i++)
            {
                if (i > 0) sb.Append(',');
                CanonString(keys[i], sb);
                sb.Append(':');
                if (blankKeys != null && Array.IndexOf(blankKeys, keys[i]) >= 0)
                {
                    sb.Append("\"\"");
                    continue;
                }
                Canon(e.GetProperty(keys[i]), sb);
            }
            sb.Append('}');
        }

        internal static string CanonNumber(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return null;
            if (raw.IndexOf('e') >= 0 || raw.IndexOf('E') >= 0) return null;
            int dot = raw.IndexOf('.');
            if (dot >= 0 && raw.Length - dot - 1 > 6) return null;
            double v;
            if (!double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out v)) return null;
            if (double.IsNaN(v) || double.IsInfinity(v)) return null;
            if (Math.Abs(v) >= 1e9) return null;

            bool neg = raw.StartsWith("-", StringComparison.Ordinal);
            string body = neg ? raw.Substring(1) : raw;
            int d = body.IndexOf('.');
            string intPart = d < 0 ? body : body.Substring(0, d);
            string frac = d < 0 ? "" : body.Substring(d + 1);
            intPart = intPart.TrimStart('0');
            if (intPart.Length == 0) intPart = "0";
            frac = frac.TrimEnd('0');
            string outText = frac.Length == 0 ? intPart : intPart + "." + frac;
            if (outText == "0") return "0";     // -0 → 0
            return neg ? "-" + outText : outText;
        }

        private static void CanonString(string s, StringBuilder sb)
        {
            sb.Append('"');
            if (s != null)
            {
                for (int i = 0; i < s.Length; i++)
                {
                    char c = s[i];
                    switch (c)
                    {
                        case '"': sb.Append("\\\""); continue;
                        case '\\': sb.Append("\\\\"); continue;
                        case '\b': sb.Append("\\b"); continue;
                        case '\f': sb.Append("\\f"); continue;
                        case '\n': sb.Append("\\n"); continue;
                        case '\r': sb.Append("\\r"); continue;
                        case '\t': sb.Append("\\t"); continue;
                    }
                    if (c < 0x20)
                    {
                        sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        continue;
                    }
                    sb.Append(c);
                }
            }
            sb.Append('"');
        }

        /* ============================================================== */
        /*  Туслахууд                                                      */
        /* ============================================================== */

        private static string Str(JsonElement e, string name)
        {
            JsonElement v;
            if (e.ValueKind != JsonValueKind.Object) return null;
            if (!e.TryGetProperty(name, out v)) return null;
            return v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        }

        private static double? Dbl(JsonElement e, string name)
        {
            JsonElement v;
            if (e.ValueKind != JsonValueKind.Object) return null;
            if (!e.TryGetProperty(name, out v)) return null;
            if (v.ValueKind != JsonValueKind.Number) return null;
            double d;
            return v.TryGetDouble(out d) ? (double?)d : null;
        }

        private static string[] StrArray(JsonElement e, string name)
        {
            JsonElement v;
            if (e.ValueKind != JsonValueKind.Object) return new string[0];
            if (!e.TryGetProperty(name, out v) || v.ValueKind != JsonValueKind.Array) return new string[0];
            List<string> list = new List<string>();
            foreach (JsonElement x in v.EnumerateArray())
            {
                if (x.ValueKind == JsonValueKind.String) list.Add(x.GetString());
            }
            return list.ToArray();
        }
    }
}
