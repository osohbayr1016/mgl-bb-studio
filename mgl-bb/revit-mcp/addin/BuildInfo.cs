using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RevitMcpAddin
{
    /// <summary>
    /// Энэ build-ийн таних тэмдэг.  Бүртгэл ба User-Agent-д ордог.
    ///
    /// ⚠️ `Autodesk.Revit`-ийн ямар ч төрөл ХЭРЭГЛЭХГҮЙ — энэ файл net48
    /// (Revit 2024) build дээр ч эмхэтгэгдэх ЁСТОЙ.
    ///
    /// ⚠️ ЯАГААД ХЭРЭГТЭЙ ВЭ: хувилбаргүй үед бүх DLL `1.0.0.0` тамгатай
    /// гардаг тул аль ажилтан аль build-тай явж байгааг МЭДЭХ АРГАГҮЙ
    /// (`revit-mcp/dist/` нь git-д ороогүй — `revit-mcp/.gitignore:13`).
    /// </summary>
    internal static class BuildInfo
    {
        private static string _v;

        /// <summary>ж: "1.1.0".  Тодорхойлох боломжгүй бол "0".</summary>
        public static string Version
        {
            get
            {
                if (_v != null) return _v;
                try
                {
                    Assembly a = typeof(BuildInfo).Assembly;
                    string s = a.GetCustomAttribute<AssemblyInformationalVersionAttribute>()
                                ?.InformationalVersion
                               ?? a.GetName().Version?.ToString();
                    // SourceLink нь "+<sha>" залгадаг — тэрийг таслана.
                    int plus = s?.IndexOf('+') ?? -1;
                    _v = plus > 0 ? s.Substring(0, plus) : (s ?? "0");
                }
                catch { _v = "0"; }
                return _v;
            }
        }
    }

    /// <summary>
    /// Суулгалтын өөрийн шалгалтын НЭГ үр дүн.  v2 §74-ийн SELF-CHECK ба
    /// REPORT HEALTH хоёрын НЭГ өгөгдлийн бүтэц — тусад нь хоёр хэлбэр
    /// байвал тэд заавал зөрнө.
    ///
    /// ⚠️ ТОКЕН, ХЭРЭГЛЭГЧИЙН НЭР, МАШИНЫ НЭР, ЗАМ — НЭГ Ч ТАЛБАРТ
    /// ОРОХГҮЙ.  Энэ объект бүхэлдээ сервер рүү явдаг (`health_json`).
    /// </summary>
    internal sealed class SelfCheckResult
    {
        [JsonPropertyName("addin_version")]   public string AddinVersion   { get; set; }
        [JsonPropertyName("revit_year")]      public string RevitYear      { get; set; }
        [JsonPropertyName("revit_build")]     public string RevitBuild     { get; set; }
        [JsonPropertyName("model_version")]   public string ModelVersion   { get; set; }
        [JsonPropertyName("model_source")]    public string ModelSource    { get; set; }
        [JsonPropertyName("ruleset_version")] public string RulesetVersion { get; set; }
        [JsonPropertyName("pack_sha256")]     public string PackSha256     { get; set; }
        [JsonPropertyName("config_version")]  public string ConfigVersion  { get; set; }
        [JsonPropertyName("release_sha256")]  public string ReleaseSha256  { get; set; }
        [JsonPropertyName("channel")]         public string Channel        { get; set; }
        [JsonPropertyName("health")]          public string Health         { get; set; }
        [JsonPropertyName("ok")]              public List<string> Ok      { get; set; } = new List<string>();
        [JsonPropertyName("failed")]          public List<string> Failed  { get; set; } = new List<string>();
        [JsonPropertyName("skipped")]         public List<string> Skipped { get; set; } = new List<string>();
        [JsonPropertyName("ts")]              public string Ts             { get; set; }
    }

    /// <summary>
    /// Суулгалт бүрэн эсэхийг ЛОКАЛ шалгана — v2 §74-ийн SELF-CHECK шат.
    ///
    /// ⚠️ ЯАГААД ЦЭВЭР ВЭ: энэ төрөл нь `Autodesk.Revit`-ийн ямар ч төрөл
    /// ХЭРЭГЛЭХГҮЙ, сүлжээ рүү ГАРАХГҮЙ, дискэнд ЗӨВХӨН нэг байтын
    /// туршилтын файл бичээд шууд устгана.  Ингэснээр (а) net48 (Revit
    /// 2024) дээр эмхэтгэгдэнэ, (б) Revit-гүйгээр тест хийгдэнэ, (в)
    /// `RevitToolBus`-ийн handler ба `ChangeTracker.DocumentChanged`-ийн
    /// ⛔ гэрээг зөрчихгүй (тэнд инференс ч, дискний ажил ч ХОРИОТОЙ).
    ///
    /// ⚠️ ЭНЭ МЕТОД ХЭЗЭЭ Ч ONSTARTUP-ЫГ УНАГААХГҮЙ — алхам бүр try/catch
    /// дотор, алдаа нь `Failed` жагсаалт руу ТЕКСТ болж орно.  Гадагш
    /// шидэгдэх exception БАЙХГҮЙ.
    ///
    /// ⚠️ `Run` нь `App.OnStartup`-аас ДУУДАГДАХГҮЙ — тэр нь Revit-ийн
    /// ачаалалтын замд байна.  Дуудлагын цэг нь `AssistantPane` самбар
    /// нээгдэж, эхний ачаалалт дууссаны ДАРАА, арын thread дээр.
    /// </summary>
    internal static class InstallCheck
    {
        /// <summary>Суулгасан фолдер — `release.json` ба `payload.sha256.txt` энд.</summary>
        internal static string InstalledDir
        {
            get
            {
                try
                {
                    string dir = Path.GetDirectoryName(typeof(InstallCheck).Assembly.Location);
                    return string.IsNullOrEmpty(dir) ? "." : dir;
                }
                catch { return "."; }
            }
        }

        public static SelfCheckResult Run(string revitYear, string revitBuild)
        {
            var r = new SelfCheckResult
            {
                AddinVersion = BuildInfo.Version,
                RevitYear    = revitYear,
                RevitBuild   = revitBuild,
                Channel      = "prod",
                Ts           = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture),
            };

            // 1. DLL-ийн хувилбар танигдсан эсэх.  "0" бол
            //    `AssemblyInformationalVersionAttribute` уншигдаагүй — тэр нь
            //    build тохиргооны алдаа, бүх парк даяар «хэн ямар хувилбартай
            //    вэ» гэсэн асуултыг ХАРИУЛАХГҮЙ болгоно.
            if (string.IsNullOrEmpty(r.AddinVersion) || r.AddinVersion == "0")
                r.Failed.Add("addin_version_unknown");
            else
                r.Ok.Add("addin_version");

            // 2. release.json — `install.ps1` суулгасан багцын таних тэмдэг.
            //    ⚠️ Байхгүй бол «гараар хуулсан / албан ёсны БУС суулгац».
            //    Тэр тохиолдолд сервер `recognised: false` буцаана.
            string relPath = Path.Combine(InstalledDir, "release.json");
            try
            {
                if (File.Exists(relPath))
                {
                    r.ReleaseSha256 = ReadJsonString(relPath, "payload_sha256");
                    string relVer = ReadJsonString(relPath, "version");
                    string relChan = ReadJsonString(relPath, "channel");
                    if (!string.IsNullOrEmpty(relChan)) r.Channel = relChan;

                    // Он нь дуудагчаас ирээгүй бол багцаас авна — энэ бол
                    // Revit API-гүйгээр мэдэх ЦОРЫН ГАНЦ найдвартай эх сурвалж.
                    if (string.IsNullOrEmpty(r.RevitYear))
                        r.RevitYear = ReadJsonString(relPath, "revit");

                    if (!string.IsNullOrEmpty(relVer) && relVer != r.AddinVersion)
                        r.Failed.Add("release_version_mismatch");   // DLL ба багц ЗӨРСӨН
                    else
                        r.Ok.Add("release_manifest");
                }
                else r.Failed.Add("release_manifest_missing");
            }
            catch { r.Failed.Add("release_manifest_unreadable"); }

            // 2b. БҮРЭН БҮТЭН БАЙДЛЫН нотолгоо.  `install.ps1` нь файл БҮРИЙН
            //     хэшийг суулгах үедээ шалгасан; энэ нь ТЭР ЖАГСААЛТ өөрөө
            //     хэвээр байгаа эсэхийг батална (нэг жижиг файлын хэш,
            //     зардал ~0).  ⚠️ Энэ нь ГАРАЛ ҮҮСЛИЙГ (authenticity)
            //     батлахгүй — код гарын үсэг репод БАЙХГҮЙ.  Сольсон багцыг
            //     илрүүлэх цорын ганц бодит арга нь серверийн бүртгэл
            //     (`recognised` туг).
            try
            {
                string listPath = Path.Combine(InstalledDir, "payload.sha256.txt");
                if (!File.Exists(listPath)) r.Skipped.Add("payload_list_absent");
                else if (string.IsNullOrEmpty(r.ReleaseSha256)) r.Skipped.Add("payload_hash_absent");
                else if (string.Equals(Sha256File(listPath), r.ReleaseSha256,
                                       StringComparison.OrdinalIgnoreCase))
                    r.Ok.Add("payload_hash");
                else r.Failed.Add("payload_hash_mismatch");
            }
            catch { r.Failed.Add("payload_hash_unreadable"); }

            // 3. Санаа таних загвар — гурван шатлалт ачаалалт
            //    (татсан → шигтгэсэн → түлхүүр үг).
            try
            {
                r.ModelVersion = IntentModel.LoadedVersion;
                r.ModelSource  = IntentModel.LastLoadSource;      // local | embedded | none
                if (string.IsNullOrEmpty(r.ModelSource)) r.Skipped.Add("model_load_pending");
                else if (r.ModelSource == "none") r.Failed.Add("model_not_loaded");
                else r.Ok.Add("model_" + r.ModelSource);
            }
            catch { r.Failed.Add("model_check_threw"); }

            // 4. Дүрмийн багц (`2-2-rule-model`).
            //    ⚠️ `RulePack`-д «одоо ачаалагдсан багц» гэсэн СТАТИК
            //    хандалт БАЙХГҮЙ (2026-08-31-нд шалгасан: репо даяар нэг ч
            //    дуудагчгүй) тул энд кэшийн фолдерыг ШУУД уншиж, ЯГ ТЭР
            //    шалгагдсан задлагчаар (`RulePack.ParseVerified`) баталгаажуулна.
            //    Багц огт байхгүй бол `skipped` — ЭНЭ НЬ АЛДАА БИШ, дүрмийн
            //    давхарга хараахан тарааагүй байхад суулгац эрүүл ХЭВЭЭР.
            try
            {
                string packJson = NewestRulePackJson();
                if (packJson == null) r.Skipped.Add("ruleset_absent");
                else
                {
                    RulePack.Loaded pack = RulePack.ParseVerified(packJson, null);
                    if (pack == null) r.Failed.Add("ruleset_invalid");
                    else
                    {
                        r.RulesetVersion = pack.RulesetVersion;
                        r.PackSha256     = pack.PackSha256;
                        r.Ok.Add("ruleset");
                    }
                }
            }
            catch { r.Skipped.Add("ruleset_absent"); }

            // 5. Тохиргоо — токен БАЙГАА ЭСЭХ (утгыг НЬ БИШ).
            //    ⚠️ Токеныг ХЭЗЭЭ Ч бүртгэлд, шалгалтын гаралтад БИЧИХГҮЙ.
            //    `ApiHost` нь тохиргооны «хувилбар»-ын үүрэг гүйцэтгэнэ:
            //    буруу хаяг руу заасан суулгац бол чимээгүй үхсэн суулгац.
            try
            {
                AddinSettings s = SettingsStore.Load();
                r.ConfigVersion = s != null ? s.ApiHost : null;
                if (s == null || string.IsNullOrEmpty(s.Token)) r.Failed.Add("not_signed_in");
                else r.Ok.Add("credentials");
                if (s == null || (s.ProjectId ?? 0) <= 0) r.Skipped.Add("project_unset");
            }
            catch { r.Failed.Add("settings_unreadable"); }

            // 6. Бичих эрх — %APPDATA%\RevitMcpAddin.  Roaming profile дээр
            //    эрх хаагдвал БҮХ өгөгдөл цуглуулалт (сургалтын дэвтэр,
            //    офлайн дараалал, хугацааны бүртгэл) ЧИМЭЭГҮЙ унана.
            try
            {
                Directory.CreateDirectory(SettingsStore.Dir);
                string probe = Path.Combine(SettingsStore.Dir, ".writeprobe");
                File.WriteAllText(probe, "1");
                File.Delete(probe);
                r.Ok.Add("appdata_writable");
            }
            catch { r.Failed.Add("appdata_not_writable"); }

            // 7. Revit он — release.json байхгүй (албан ёсны БУС суулгац) үед
            //    ЗАМААС гаргана: ...\Addins\<он>\RevitMcpAddin\*.dll
            //    ⚠️ ЯАГААД ЧУХАЛ ВЭ: `POST /api/revit/health` нь `revit_year`-гүй
            //    биеийг 400-аар татгалздаг.  Тэгвэл ЯГ ТЭР — албан ёсны бус,
            //    таних тэмдэггүй — суулгацууд сервер талд ҮЛ ҮЗЭГДЭХ болно,
            //    гэтэл тэдгээр нь бидний хамгийн их харах ёстой машинууд.
            if (string.IsNullOrEmpty(r.RevitYear)) r.RevitYear = YearFromPath();
            if (string.IsNullOrEmpty(r.RevitYear)) r.Skipped.Add("revit_year_unknown");

            r.Health = r.Failed.Count == 0 ? "ok" : (r.Ok.Count > 0 ? "degraded" : "failed");
            return r;
        }

        /// <summary>
        /// Хүнд уншигдах нэг мөрийн дүн — `Test.bat` ба самбарын толгойд.
        /// ⚠️ Зөвхөн ТООГ хэлнэ; унасан шалгалтын НЭРС нь тусдаа мөрөөр.
        /// </summary>
        public static string Summary(SelfCheckResult r)
        {
            if (r == null) return "shalgalt: null";
            return "health=" + r.Health
                 + " ok=" + r.Ok.Count
                 + " failed=" + r.Failed.Count
                 + " skipped=" + r.Skipped.Count
                 + " version=" + (r.AddinVersion ?? "?");
        }

        /// <summary>
        /// Кэшлэгдсэн дүрмийн багцаас ХАМГИЙН СҮҮЛИЙНХИЙГ уншина.
        /// ⚠️ Багийн код ЭНД мэдэгдэхгүй тул бүх багцыг хардаг —
        /// `RulePack.CachePath` нь `rulepack-&lt;team&gt;-&lt;sha16&gt;-&lt;pid&gt;.json`
        /// хэлбэртэй.  Ordinal эрэмбийн СҮҮЛИЙНХ нь энэ процессын
        /// хамгийн сүүлд бичсэн багцад хамгийн ойр.
        /// </summary>
        private static string NewestRulePackJson()
        {
            try
            {
                string dir = SettingsStore.Dir;
                if (!Directory.Exists(dir)) return null;
                string[] files = Directory.GetFiles(dir, "rulepack-*.json");
                if (files == null || files.Length == 0) return null;
                Array.Sort(files, StringComparer.Ordinal);
                return File.ReadAllText(files[files.Length - 1], Encoding.UTF8);
            }
            catch { return null; }
        }

        /// <summary>
        /// Суулгасан замаас Revit оныг гаргана:
        /// <c>%APPDATA%\Autodesk\Revit\Addins\2027\RevitMcpAddin</c> -> "2027".
        /// ⚠️ Revit API-гийн ямар ч төрөл хэрэглэхгүй — энэ төрөл ЦЭВЭР хэвээр.
        /// Таарахгүй бол <c>null</c> (ж: build фолдероос шууд ачаалсан).
        /// </summary>
        private static string YearFromPath()
        {
            try
            {
                string parent = Path.GetFileName(
                    Path.GetDirectoryName(InstalledDir) ?? string.Empty);
                if (parent != null && parent.Length == 4)
                {
                    int n;
                    if (int.TryParse(parent, NumberStyles.None, CultureInfo.InvariantCulture, out n)
                        && n >= 2000 && n <= 2100)
                        return parent;
                }
            }
            catch { }
            return null;
        }

        /// <summary>Файлын БАЙТУУДЫН sha256 — 64 hex, жижиг үсгээр.</summary>
        private static string Sha256File(string path)
        {
            try
            {
                using (var sha = System.Security.Cryptography.SHA256.Create())
                using (FileStream fs = File.OpenRead(path))
                {
                    byte[] h = sha.ComputeHash(fs);
                    var sb = new StringBuilder(64);
                    for (int i = 0; i < h.Length; i++) sb.Append(h[i].ToString("x2"));
                    return sb.ToString();
                }
            }
            catch { return null; }
        }

        private static string ReadJsonString(string path, string key)
        {
            try
            {
                using (JsonDocument doc = JsonDocument.Parse(File.ReadAllText(path, Encoding.UTF8)))
                {
                    JsonElement v;
                    if (!doc.RootElement.TryGetProperty(key, out v)) return null;
                    return v.ValueKind == JsonValueKind.String ? v.GetString() : null;
                }
            }
            catch { return null; }
        }
    }

}
