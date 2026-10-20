using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace RevitMcpAddin.SheetNumerator.Core
{
    /// <summary>Цонхны байрлал/хэмжээ.</summary>
    public sealed class WindowPrefs
    {
        public double Left { get; set; } = double.NaN;
        public double Top { get; set; } = double.NaN;
        public double Width { get; set; } = double.NaN;
        public double Height { get; set; } = double.NaN;
        public bool Maximized { get; set; }

        public bool HasBounds => !double.IsNaN(Left) && !double.IsNaN(Top) && !double.IsNaN(Width) && !double.IsNaN(Height);
    }

    /// <summary>Хэрэглэгчийн хадгалагдах тохиргоо (session хооронд).</summary>
    public sealed class SheetNumeratorPrefs
    {
        /// <summary>Одоогийн схемийн хувилбар.  Талбар нэмэх/өөрчлөхдөө өсгөж, <see cref="PrefsSerializer"/>-т шилжилт нэм.</summary>
        public const int CurrentVersion = 1;

        public int SchemaVersion { get; set; } = CurrentVersion;
        public WindowPrefs Window { get; set; } = new WindowPrefs();
        public DisplayMode DisplayMode { get; set; } = DisplayMode.Grouped;
        public bool SortByName { get; set; }
        public bool HidePreview { get; set; }

        /// <summary>Үл үзэгдэх тэмдгийн ЭХНИЙ ХЭРЭГЛЭЭНИЙ анхааруулгыг зөвшөөрсөн.</summary>
        public bool UnicodeWarningAccepted { get; set; }

        /// <summary>
        /// Хадгалагдах тохиргоо.  ⚠️ Сессийн ТӨЛӨВ (Зөөхөд дугаар дагуулах, Сонгосон хуудаснаас эхлэх,
        /// Өсгөх/Бууруулах идэвхтэй, Тэмдэг цэвэрлэх) ХАДГАЛАГДАХГҮЙ — дараагийн удаа санамсаргүй идэвхтэй эхлэх нь аюултай.
        /// </summary>
        public RenumberSettings Settings { get; set; } = new RenumberSettings();
    }

    /// <summary>
    /// Тохиргооны JSON (`%APPDATA%\RevitMcpAddin\sheet-numerator.json`) уншигч/бичигч ба ХУВИЛБАРЛАГДСАН шилжилт.
    ///
    /// ⚠️ Хэзээ ч throw хийхгүй: эвдэрсэн/хоосон/ирээдүйн хувилбартай файл → унших боломжтой хэсгийг авч,
    /// үлдсэнийг өгөгдмөлөөр.  Add-in эхлэхэд тохиргооны алдаа саад болох ёсгүй.
    /// ⚠️ Параметрийг `ElementId`-аар БИШ, тогтвортой түлхүүрээр (<see cref="ParameterKey.Stable"/>) хадгална.
    /// </summary>
    public static class PrefsSerializer
    {
        // ── Бичих ───────────────────────────────────────────────────
        public static string Serialize(SheetNumeratorPrefs p)
        {
            var root = new JsonObject();
            root["schema_version"] = SheetNumeratorPrefs.CurrentVersion;

            var w = new JsonObject();
            if (p.Window != null && p.Window.HasBounds)
            {
                w["left"] = p.Window.Left;
                w["top"] = p.Window.Top;
                w["width"] = p.Window.Width;
                w["height"] = p.Window.Height;
            }
            w["maximized"] = p.Window != null && p.Window.Maximized;
            root["window"] = w;

            root["grouped_mode"] = p.DisplayMode == DisplayMode.Grouped;
            root["sort_by_name"] = p.SortByName;
            root["hide_preview"] = p.HidePreview;
            root["unicode_warning_accepted"] = p.UnicodeWarningAccepted;

            RenumberSettings s = p.Settings ?? new RenumberSettings();
            root["mode"] = s.Mode == NumberingMode.Advanced ? "advanced" : "simple";

            root["simple"] = new JsonObject
            {
                ["prefix"] = s.Simple.Prefix,
                ["suffix"] = s.Simple.Suffix,
                ["use_start"] = s.Simple.UseStartNumber,
                ["start"] = s.Simple.Start,
                ["width"] = s.Simple.Width,
            };

            var parts = new JsonArray();
            for (int i = 0; i < AdvancedNumberingSettings.PartCount; i++)
            {
                NumberPartSettings part = s.Advanced.Parts[i];
                var po = new JsonObject
                {
                    ["enabled"] = part.Enabled,
                    ["prefix"] = part.Prefix,
                    ["suffix"] = part.Suffix,
                    ["value_mode"] = part.ValueMode.ToString(),
                    ["start"] = part.Start,
                    ["step"] = part.Step,
                    ["width"] = part.Width,
                    ["wrap"] = part.WrapAtLimit,
                };
                if (part.Limit.HasValue)
                    po["limit"] = part.Limit.Value;
                parts.Add(po);
            }
            root["advanced"] = new JsonObject
            {
                ["parts"] = parts,
                ["separators"] = new JsonArray(s.Advanced.Separators[0], s.Advanced.Separators[1]),
            };

            root["param_prefix"] = KeyObject(s.UseParameterPrefix, s.PrefixParameter);
            root["param_suffix"] = KeyObject(s.UseParameterSuffix, s.SuffixParameter);

            JsonObject wr = KeyObject(s.WriteResultToParameter, s.ResultParameter);
            wr["source"] = s.ResultSource.ToString();
            root["write_result"] = wr;

            JsonObject gc = KeyObject(s.WriteGroupCount, s.CountParameter);
            gc["scope"] = s.CountScope.ToString();
            root["group_count"] = gc;

            root["name_numbering"] = new JsonObject
            {
                ["at_start"] = s.NameAtStart,
                ["at_end"] = s.NameAtEnd,
                ["source"] = s.NameSource.ToString(),
                ["separator"] = s.NameSeparator,
            };

            root["shift"] = new JsonObject
            {
                ["amount"] = s.ShiftAmount,
                ["token_index"] = s.ShiftTokenIndex,
            };

            root["marker"] = new JsonObject
            {
                ["enabled"] = s.UseUnicodeMarkers,
                ["char"] = "U+" + ((int)s.MarkerChar).ToString("X4"),
            };

            return root.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
        }

        private static JsonObject KeyObject(bool enabled, ParameterKey key)
        {
            var o = new JsonObject { ["enabled"] = enabled };
            if (key != null)
                o["key"] = key.Stable;
            return o;
        }

        // ── Унших ───────────────────────────────────────────────────
        public static SheetNumeratorPrefs Deserialize(string json)
        {
            var prefs = new SheetNumeratorPrefs();
            if (string.IsNullOrWhiteSpace(json))
                return prefs;

            JsonObject root;
            try
            {
                root = JsonNode.Parse(json) as JsonObject;
            }
            catch (Exception)
            {
                return prefs;
            }
            if (root == null)
                return prefs;

            try
            {
                Migrate(root);
                Read(root, prefs);
            }
            catch (Exception)
            {
                // Ямар нэг гэнэтийн хэлбэр — одоогоор уншсанаар үргэлжилнэ (үлдсэн нь өгөгдмөл).
            }
            Sanitize(prefs);
            return prefs;
        }

        /// <summary>
        /// Хувилбарын шилжилтүүд.  Хувилбар бүрийн алхам тусдаа — дараагийн өөрчлөлт нэг алхам нэмнэ.
        ///   v0 → v1: хөгжүүлэлтийн (pre-release) хувилбарын хавтгай түлхүүрүүд
        ///            (`prefix`, `suffix`, `start_number`, `number_width`) → `simple` объект.
        /// Ирээдүйн (CurrentVersion-оос их) хувилбарыг ТАНИХ ТАЛБАРААР нь уншина, унахгүй.
        /// </summary>
        internal static void Migrate(JsonObject root)
        {
            int version = GetInt(root, "schema_version", 0);
            if (version < 1)
            {
                var simple = new JsonObject();
                CopyIfPresent(root, "prefix", simple, "prefix");
                CopyIfPresent(root, "suffix", simple, "suffix");
                CopyIfPresent(root, "start_number", simple, "start");
                CopyIfPresent(root, "number_width", simple, "width");
                if (simple.Count > 0 && root["simple"] == null)
                    root["simple"] = simple;
                root["schema_version"] = 1;
            }
            // v1 → v2 …  (ирээдүйд энд)
        }

        private static void CopyIfPresent(JsonObject from, string fromKey, JsonObject to, string toKey)
        {
            JsonNode n = from[fromKey];
            if (n == null)
                return;
            to[toKey] = JsonNode.Parse(n.ToJsonString());
            from.Remove(fromKey);
        }

        private static void Read(JsonObject root, SheetNumeratorPrefs prefs)
        {
            prefs.SchemaVersion = SheetNumeratorPrefs.CurrentVersion;

            JsonObject w = GetObj(root, "window");
            if (w != null)
            {
                prefs.Window.Left = GetDouble(w, "left", double.NaN);
                prefs.Window.Top = GetDouble(w, "top", double.NaN);
                prefs.Window.Width = GetDouble(w, "width", double.NaN);
                prefs.Window.Height = GetDouble(w, "height", double.NaN);
                prefs.Window.Maximized = GetBool(w, "maximized", false);
            }

            prefs.DisplayMode = GetBool(root, "grouped_mode", true) ? DisplayMode.Grouped : DisplayMode.AllInOne;
            prefs.SortByName = GetBool(root, "sort_by_name", false);
            prefs.HidePreview = GetBool(root, "hide_preview", false);
            prefs.UnicodeWarningAccepted = GetBool(root, "unicode_warning_accepted", false);

            RenumberSettings s = prefs.Settings;
            s.Mode = string.Equals(GetString(root, "mode", "simple"), "advanced", StringComparison.OrdinalIgnoreCase)
                ? NumberingMode.Advanced : NumberingMode.Simple;

            JsonObject simple = GetObj(root, "simple");
            if (simple != null)
            {
                s.Simple.Prefix = GetString(simple, "prefix", s.Simple.Prefix);
                s.Simple.Suffix = GetString(simple, "suffix", s.Simple.Suffix);
                s.Simple.UseStartNumber = GetBool(simple, "use_start", s.Simple.UseStartNumber);
                s.Simple.Start = GetLong(simple, "start", s.Simple.Start);
                s.Simple.Width = (int)GetLong(simple, "width", s.Simple.Width);
            }

            JsonObject adv = GetObj(root, "advanced");
            if (adv != null)
            {
                JsonArray parts = adv["parts"] as JsonArray;
                if (parts != null)
                {
                    for (int i = 0; i < AdvancedNumberingSettings.PartCount && i < parts.Count; i++)
                    {
                        JsonObject po = parts[i] as JsonObject;
                        if (po == null)
                            continue;
                        NumberPartSettings part = s.Advanced.Parts[i];
                        part.Enabled = GetBool(po, "enabled", part.Enabled);
                        part.Prefix = GetString(po, "prefix", part.Prefix);
                        part.Suffix = GetString(po, "suffix", part.Suffix);
                        PartValueMode vm;
                        if (Enum.TryParse(GetString(po, "value_mode", ""), true, out vm) && Enum.IsDefined(typeof(PartValueMode), vm))
                            part.ValueMode = vm;
                        part.Start = GetLong(po, "start", part.Start);
                        part.Step = GetLong(po, "step", part.Step);
                        part.Width = (int)GetLong(po, "width", part.Width);
                        part.WrapAtLimit = GetBool(po, "wrap", part.WrapAtLimit);
                        part.Limit = po["limit"] != null ? (long?)GetLong(po, "limit", 0) : null;
                    }
                }
                JsonArray seps = adv["separators"] as JsonArray;
                if (seps != null)
                {
                    for (int i = 0; i < s.Advanced.Separators.Length && i < seps.Count; i++)
                        s.Advanced.Separators[i] = NodeString(seps[i], s.Advanced.Separators[i]);
                }
            }

            ReadKey(GetObj(root, "param_prefix"), out bool pe, out ParameterKey pk);
            s.UseParameterPrefix = pe;
            s.PrefixParameter = pk;
            ReadKey(GetObj(root, "param_suffix"), out pe, out pk);
            s.UseParameterSuffix = pe;
            s.SuffixParameter = pk;

            JsonObject wr = GetObj(root, "write_result");
            ReadKey(wr, out pe, out pk);
            s.WriteResultToParameter = pe;
            s.ResultParameter = pk;
            s.ResultSource = GetEnum(wr, "source", GeneratedValueSource.FullNumber);

            JsonObject gc = GetObj(root, "group_count");
            ReadKey(gc, out pe, out pk);
            s.WriteGroupCount = pe;
            s.CountParameter = pk;
            s.CountScope = GetEnum(gc, "scope", CountWriteScope.FirstSheet);

            JsonObject nn = GetObj(root, "name_numbering");
            if (nn != null)
            {
                s.NameAtStart = GetBool(nn, "at_start", false);
                s.NameAtEnd = GetBool(nn, "at_end", false);
                s.NameSource = GetEnum(nn, "source", GeneratedValueSource.FullNumber);
                s.NameSeparator = GetString(nn, "separator", s.NameSeparator);
            }

            JsonObject sh = GetObj(root, "shift");
            if (sh != null)
            {
                s.ShiftAmount = GetLong(sh, "amount", s.ShiftAmount);
                s.ShiftTokenIndex = (int)GetLong(sh, "token_index", s.ShiftTokenIndex);
            }

            JsonObject mk = GetObj(root, "marker");
            if (mk != null)
            {
                s.UseUnicodeMarkers = GetBool(mk, "enabled", false);
                char c;
                if (TryParseCodePoint(GetString(mk, "char", ""), out c))
                    s.MarkerChar = c;
            }
        }

        /// <summary>Утгыг зөвшөөрөгдөх хүрээнд аваачна — эвдэрсэн файл буруу төлөв үүсгэхгүй.</summary>
        private static void Sanitize(SheetNumeratorPrefs prefs)
        {
            RenumberSettings s = prefs.Settings;

            s.Simple.Prefix = s.Simple.Prefix ?? string.Empty;
            s.Simple.Suffix = s.Simple.Suffix ?? string.Empty;
            s.Simple.Width = NumberFormatting.ClampWidth(s.Simple.Width);
            if (!NumberFormatting.InRange(s.Simple.Start))
                s.Simple.Start = 1;

            for (int i = 0; i < AdvancedNumberingSettings.PartCount; i++)
            {
                NumberPartSettings p = s.Advanced.Parts[i];
                p.Prefix = p.Prefix ?? string.Empty;
                p.Suffix = p.Suffix ?? string.Empty;
                p.Width = NumberFormatting.ClampWidth(p.Width);
                if (!NumberFormatting.InRange(p.Start))
                    p.Start = 1;
                if (p.Step < 1 || p.Step > NumberFormatting.MaxAbsValue)
                    p.Step = 1;
                if (p.Limit.HasValue && !NumberFormatting.InRange(p.Limit.Value))
                    p.Limit = null;
                if (!Enum.IsDefined(typeof(PartValueMode), p.ValueMode))
                    p.ValueMode = PartValueMode.Increment;
            }
            for (int i = 0; i < s.Advanced.Separators.Length; i++)
                s.Advanced.Separators[i] = s.Advanced.Separators[i] ?? string.Empty;

            if (s.ShiftAmount < 0 || s.ShiftAmount > NumberFormatting.MaxAbsValue)
                s.ShiftAmount = 1;
            if (s.ShiftTokenIndex < ExistingNumberShift.LastToken || s.ShiftTokenIndex > 50)
                s.ShiftTokenIndex = ExistingNumberShift.LastToken;

            s.NameSeparator = s.NameSeparator ?? " ";
            if (!UnicodeMarkerCatalog.IsKnownMarker(s.MarkerChar))
                s.MarkerChar = '\u200B';

            // Сессийн төлөв ХЭЗЭЭ Ч сэргээгдэхгүй.
            s.MoveRenumber = false;
            s.StartFromSelected = false;
            s.ShiftActive = false;
            s.CleanMarkers = false;

            WindowPrefs w = prefs.Window;
            if (w.HasBounds && (w.Width < 200 || w.Height < 150 || w.Width > 20000 || w.Height > 20000))
                prefs.Window = new WindowPrefs { Maximized = w.Maximized };
        }

        // ── JSON туслахууд (төрөл буруу бол өгөгдмөл) ───────────────
        private static JsonObject GetObj(JsonObject o, string key)
        {
            return o != null ? o[key] as JsonObject : null;
        }

        private static bool GetBool(JsonObject o, string key, bool def)
        {
            try
            {
                JsonNode n = o != null ? o[key] : null;
                if (n == null)
                    return def;
                JsonValue v = n as JsonValue;
                bool b;
                if (v != null && v.TryGetValue(out b))
                    return b;
            }
            catch (Exception) { }
            return def;
        }

        private static string GetString(JsonObject o, string key, string def)
        {
            return NodeString(o != null ? o[key] : null, def);
        }

        private static string NodeString(JsonNode n, string def)
        {
            try
            {
                JsonValue v = n as JsonValue;
                string s;
                if (v != null && v.TryGetValue(out s))
                    return s;
            }
            catch (Exception) { }
            return def;
        }

        private static long GetLong(JsonObject o, string key, long def)
        {
            try
            {
                JsonNode n = o != null ? o[key] : null;
                if (n == null)
                    return def;
                JsonValue v = n as JsonValue;
                if (v == null)
                    return def;
                long l;
                if (v.TryGetValue(out l))
                    return l;
                int i;
                if (v.TryGetValue(out i))
                    return i;
                double d;
                if (v.TryGetValue(out d))
                    return (long)d;
                string s;
                if (v.TryGetValue(out s) && long.TryParse(s, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out l))
                    return l;
            }
            catch (Exception) { }
            return def;
        }

        private static int GetInt(JsonObject o, string key, int def)
        {
            long l = GetLong(o, key, def);
            return l < int.MinValue || l > int.MaxValue ? def : (int)l;
        }

        private static double GetDouble(JsonObject o, string key, double def)
        {
            try
            {
                JsonNode n = o != null ? o[key] : null;
                JsonValue v = n as JsonValue;
                double d;
                if (v != null && v.TryGetValue(out d))
                    return d;
            }
            catch (Exception) { }
            return def;
        }

        private static T GetEnum<T>(JsonObject o, string key, T def) where T : struct
        {
            T r;
            if (Enum.TryParse(GetString(o, key, ""), true, out r) && Enum.IsDefined(typeof(T), r))
                return r;
            return def;
        }

        private static void ReadKey(JsonObject o, out bool enabled, out ParameterKey key)
        {
            enabled = GetBool(o, "enabled", false);
            key = null;
            string stable = GetString(o, "key", null);
            ParameterKey k;
            if (stable != null && ParameterKey.TryParse(stable, out k))
                key = k;
        }

        private static bool TryParseCodePoint(string text, out char c)
        {
            c = '\0';
            if (string.IsNullOrEmpty(text))
                return false;
            string t = text.Trim();
            if (t.StartsWith("U+", StringComparison.OrdinalIgnoreCase))
                t = t.Substring(2);
            int cp;
            if (!int.TryParse(t, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out cp) || cp < 0 || cp > 0xFFFF)
                return false;
            c = (char)cp;
            return true;
        }
    }
}
