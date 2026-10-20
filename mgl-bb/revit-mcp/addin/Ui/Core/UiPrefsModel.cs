using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RevitMcpAddin.Ui.Core
{
    // ══════════════════════════════════════════════════════════════════════════
    //  UI-ийн ХУВИЙН сонголт (цонхны хэмжээ, нэг удаагийн зөвлөмжийг хаасан эсэх).
    //
    //  Хадгалах газар: %APPDATA%\RevitMcpAddin\ui-prefs.json (`Ui/MglUiPrefs.cs`).
    //  ⚠️ `settings.json`-д БИЧИХГҮЙ — тэнд токен/сессийн зохицуулалт байдаг ба «UI-ийн
    //  тохиргоо хэзээ ч эрх нээхгүй» гэж QtoDtos.cs:352-367 хэлсэн.  RVT баримтад ч БИЧИХГҮЙ
    //  (цонх зөөх нь загварыг «өөрчлөгдсөн» болгож болохгүй).
    //
    //  Эвдэрсэн/хоосон файл ХЭЗЭЭ Ч throw хийхгүй — анхдагч руу унана.
    // ══════════════════════════════════════════════════════════════════════════

    public sealed class UiWindowPrefs
    {
        [JsonPropertyName("left")] public double Left { get; set; }
        [JsonPropertyName("top")] public double Top { get; set; }
        [JsonPropertyName("width")] public double Width { get; set; }
        [JsonPropertyName("height")] public double Height { get; set; }
    }

    /// <summary>
    /// Туузан цэсний салбарын шүүлт (2026-10-13, `ToolDiscipline.cs`).  `erp_teams` нь ERP-ийн багийн КЭШ —
    /// дараагийн асаалтад сүлжээ хүлээлгүй шууд шүүнэ.  Токен, нэр, ямар ч нууц энд БИЧИГДЭХГҮЙ.
    /// </summary>
    public sealed class RibbonPrefs
    {
        public const int MaxTeams = 16;

        [JsonPropertyName("mode")] public string Mode { get; set; } = "auto";
        [JsonPropertyName("manual")] public string[] Manual { get; set; } = new string[0];
        [JsonPropertyName("erp_teams")] public string[] ErpTeams { get; set; } = new string[0];
        [JsonPropertyName("erp_fetched_at")] public long ErpFetchedAtUnix { get; set; }

        [JsonIgnore] public RibbonFilterMode FilterMode { get { return ToolDisciplines.ParseMode(Mode); } }
        [JsonIgnore] public ToolDiscipline ManualSet { get { return ToolDisciplines.FromKeys(Manual); } }
        [JsonIgnore] public ToolDiscipline ErpSet { get { return ToolDisciplines.FromTeamCodes(ErpTeams); } }
        [JsonIgnore] public ToolDiscipline Active { get { return ToolDisciplines.Resolve(FilterMode, ManualSet, ErpSet); } }

        public static RibbonPrefs Sanitize(RibbonPrefs r)
        {
            var clean = new RibbonPrefs();
            if (r == null) return clean;
            clean.Mode = ToolDisciplines.ModeKey(ToolDisciplines.ParseMode(r.Mode));
            clean.Manual = ToolDisciplines.ToKeys(ToolDisciplines.FromKeys(r.Manual));
            var teams = new List<string>();
            if (r.ErpTeams != null)
            {
                foreach (string t in r.ErpTeams)
                {
                    if (string.IsNullOrWhiteSpace(t)) continue;
                    string code = t.Trim().ToUpperInvariant();
                    if (code.Length > 16 || teams.Contains(code)) continue;
                    teams.Add(code);
                    if (teams.Count >= MaxTeams) break;
                }
            }
            clean.ErpTeams = teams.ToArray();
            clean.ErpFetchedAtUnix = r.ErpFetchedAtUnix > 0 ? r.ErpFetchedAtUnix : 0;
            return clean;
        }
    }

    public sealed class UiPrefs
    {
        public const int CurrentSchema = 1;
        public const int MaxEntries = 64;
        public const int MaxKeyLength = 80;

        [JsonPropertyName("schema_version")] public int SchemaVersion { get; set; } = CurrentSchema;
        [JsonPropertyName("windows")] public Dictionary<string, UiWindowPrefs> Windows { get; set; } = new Dictionary<string, UiWindowPrefs>();
        [JsonPropertyName("flags")] public Dictionary<string, bool> Flags { get; set; } = new Dictionary<string, bool>();
        [JsonPropertyName("ribbon")] public RibbonPrefs Ribbon { get; set; } = new RibbonPrefs();

        public bool TryGetWindow(string key, out UiRect rect)
        {
            rect = default(UiRect);
            UiWindowPrefs w;
            if (string.IsNullOrEmpty(key) || Windows == null || !Windows.TryGetValue(key, out w) || w == null) return false;
            rect = new UiRect(w.Left, w.Top, w.Width, w.Height);
            return true;
        }

        public void SetWindow(string key, UiRect rect)
        {
            if (!ValidKey(key)) return;
            if (Windows == null) Windows = new Dictionary<string, UiWindowPrefs>();
            if (!IsFinite(rect.Left) || !IsFinite(rect.Top) || !IsFinite(rect.Width) || !IsFinite(rect.Height)) return;
            if (rect.Width < 100 || rect.Height < 60) return;
            if (!Windows.ContainsKey(key) && Windows.Count >= MaxEntries) return;
            Windows[key] = new UiWindowPrefs { Left = rect.Left, Top = rect.Top, Width = rect.Width, Height = rect.Height };
        }

        public bool GetFlag(string key)
        {
            bool v;
            return !string.IsNullOrEmpty(key) && Flags != null && Flags.TryGetValue(key, out v) && v;
        }

        public void SetFlag(string key, bool value)
        {
            if (!ValidKey(key)) return;
            if (Flags == null) Flags = new Dictionary<string, bool>();
            if (!Flags.ContainsKey(key) && Flags.Count >= MaxEntries) return;
            Flags[key] = value;
        }

        private static bool ValidKey(string key)
        {
            return !string.IsNullOrWhiteSpace(key) && key.Length <= MaxKeyLength;
        }

        private static bool IsFinite(double v)
        {
            return !double.IsNaN(v) && !double.IsInfinity(v);
        }
    }

    public static class UiPrefsJson
    {
        private static readonly JsonSerializerOptions WriteOptions = new JsonSerializerOptions { WriteIndented = true };

        /// <summary>Хэзээ ч throw хийхгүй. Эвдэрсэн/хоосон бол шинэ (хоосон) сонголт.</summary>
        public static UiPrefs Parse(string json)
        {
            if (string.IsNullOrWhiteSpace(json)) return new UiPrefs();
            try
            {
                UiPrefs p = JsonSerializer.Deserialize<UiPrefs>(json);
                return Sanitize(p);
            }
            catch (Exception)
            {
                return new UiPrefs();
            }
        }

        public static string Serialize(UiPrefs prefs)
        {
            return JsonSerializer.Serialize(Sanitize(prefs), WriteOptions);
        }

        /// <summary>Хязгааргүй өсөх, NaN/сөрөг, дэндүү урт түлхүүрийг цэвэрлэнэ.</summary>
        public static UiPrefs Sanitize(UiPrefs p)
        {
            var clean = new UiPrefs();
            if (p == null) return clean;
            if (p.Windows != null)
            {
                foreach (KeyValuePair<string, UiWindowPrefs> kv in p.Windows)
                {
                    if (kv.Value == null) continue;
                    clean.SetWindow(kv.Key, new UiRect(kv.Value.Left, kv.Value.Top, kv.Value.Width, kv.Value.Height));
                }
            }
            if (p.Flags != null)
            {
                foreach (KeyValuePair<string, bool> kv in p.Flags) clean.SetFlag(kv.Key, kv.Value);
            }
            clean.Ribbon = RibbonPrefs.Sanitize(p.Ribbon);
            return clean;
        }
    }
}
