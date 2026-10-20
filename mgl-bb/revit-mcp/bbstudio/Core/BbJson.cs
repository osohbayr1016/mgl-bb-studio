using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace MglBb.Core
{
    /// <summary>
    /// Гадны санггүй JSON (System.Text.Json-ийг ЗОРИУД хэрэглэхгүй: Revit 2024 (net48)-д үндсэн MGL plugin өөрийн хувилбарыг ачаалдаг тул
    /// нэг процесст хоёр хувилбар зөрчилдөж болзошгүй — тусдаа plugin үндсэн plugin-д ямар ч эрсдэл үүсгэх ёсгүй).
    /// Parse → Dictionary&lt;string,object&gt; / List&lt;object&gt; / string / double / bool / null.
    /// </summary>
    public static class BbJson
    {
        public static string Write(object o, bool indent = true)
        {
            var sb = new StringBuilder();
            W(sb, o, indent ? 0 : -1);
            return sb.ToString();
        }

        private static void W(StringBuilder sb, object o, int depth)
        {
            switch (o)
            {
                case null: sb.Append("null"); return;
                case string s: Str(sb, s); return;
                case bool b: sb.Append(b ? "true" : "false"); return;
                case double d: Num(sb, d); return;
                case float f: Num(sb, f); return;
                case int i: sb.Append(i.ToString(CultureInfo.InvariantCulture)); return;
                case long l: sb.Append(l.ToString(CultureInfo.InvariantCulture)); return;
                case IDictionary dict:
                    {
                        sb.Append('{');
                        bool first = true;
                        foreach (DictionaryEntry e in dict)
                        {
                            if (!first) sb.Append(',');
                            first = false;
                            Nl(sb, depth >= 0 ? depth + 1 : -1);
                            Str(sb, Convert.ToString(e.Key, CultureInfo.InvariantCulture));
                            sb.Append(depth >= 0 ? ": " : ":");
                            W(sb, e.Value, depth >= 0 ? depth + 1 : -1);
                        }
                        if (!first) Nl(sb, depth);
                        sb.Append('}');
                        return;
                    }
                case IEnumerable en:
                    {
                        sb.Append('[');
                        bool first = true;
                        bool simple = true;
                        foreach (object x in en) if (x is IDictionary || (x is IEnumerable && !(x is string))) { simple = false; break; }
                        foreach (object x in en)
                        {
                            if (!first) sb.Append(simple ? ", " : ",");
                            first = false;
                            if (!simple) Nl(sb, depth >= 0 ? depth + 1 : -1);
                            W(sb, x, depth >= 0 ? depth + 1 : -1);
                        }
                        if (!first && !simple) Nl(sb, depth);
                        sb.Append(']');
                        return;
                    }
                default:
                    if (o is Enum) { Str(sb, o.ToString()); return; }
                    if (o is IConvertible c)
                    {
                        try { Num(sb, Convert.ToDouble(c, CultureInfo.InvariantCulture)); return; }
                        catch { }
                    }
                    Str(sb, o.ToString());
                    return;
            }
        }

        private static void Nl(StringBuilder sb, int depth)
        {
            if (depth < 0) return;
            sb.Append('\n');
            sb.Append(' ', depth * 2);
        }

        private static void Num(StringBuilder sb, double d)
        {
            if (double.IsNaN(d) || double.IsInfinity(d)) { sb.Append("null"); return; }
            sb.Append(Math.Round(d, 6).ToString("R", CultureInfo.InvariantCulture));
        }

        private static void Str(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (char ch in s)
            {
                switch (ch)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (ch < 0x20) sb.Append("\\u").Append(((int)ch).ToString("x4", CultureInfo.InvariantCulture));
                        else sb.Append(ch);
                        break;
                }
            }
            sb.Append('"');
        }

        // ── Parse ────────────────────────────────────────────────────────

        public static object Parse(string text)
        {
            if (text == null) throw new ArgumentNullException(nameof(text));
            int i = 0;
            object v = Value(text, ref i);
            Ws(text, ref i);
            if (i != text.Length) throw new FormatException("JSON: илүү тэмдэгт " + i);
            return v;
        }

        private static object Value(string s, ref int i)
        {
            Ws(s, ref i);
            if (i >= s.Length) throw new FormatException("JSON: дутуу");
            char c = s[i];
            if (c == '{')
            {
                i++;
                var d = new Dictionary<string, object>(StringComparer.Ordinal);
                Ws(s, ref i);
                if (i < s.Length && s[i] == '}') { i++; return d; }
                while (true)
                {
                    Ws(s, ref i);
                    string k = StrVal(s, ref i);
                    Ws(s, ref i);
                    Expect(s, ref i, ':');
                    d[k] = Value(s, ref i);
                    Ws(s, ref i);
                    if (i < s.Length && s[i] == ',') { i++; continue; }
                    Expect(s, ref i, '}');
                    return d;
                }
            }
            if (c == '[')
            {
                i++;
                var l = new List<object>();
                Ws(s, ref i);
                if (i < s.Length && s[i] == ']') { i++; return l; }
                while (true)
                {
                    l.Add(Value(s, ref i));
                    Ws(s, ref i);
                    if (i < s.Length && s[i] == ',') { i++; continue; }
                    Expect(s, ref i, ']');
                    return l;
                }
            }
            if (c == '"') return StrVal(s, ref i);
            if (s.Length - i >= 4 && string.CompareOrdinal(s, i, "true", 0, 4) == 0) { i += 4; return true; }
            if (s.Length - i >= 5 && string.CompareOrdinal(s, i, "false", 0, 5) == 0) { i += 5; return false; }
            if (s.Length - i >= 4 && string.CompareOrdinal(s, i, "null", 0, 4) == 0) { i += 4; return null; }
            int st = i;
            while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0) i++;
            if (st == i) throw new FormatException("JSON: үл таних тэмдэгт '" + c + "' @" + i);
            return double.Parse(s.Substring(st, i - st), NumberStyles.Float, CultureInfo.InvariantCulture);
        }

        private static string StrVal(string s, ref int i)
        {
            Expect(s, ref i, '"');
            var sb = new StringBuilder();
            while (i < s.Length)
            {
                char c = s[i++];
                if (c == '"') return sb.ToString();
                if (c != '\\') { sb.Append(c); continue; }
                if (i >= s.Length) break;
                char e = s[i++];
                switch (e)
                {
                    case 'n': sb.Append('\n'); break;
                    case 'r': sb.Append('\r'); break;
                    case 't': sb.Append('\t'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    case 'u':
                        sb.Append((char)int.Parse(s.Substring(i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                        i += 4;
                        break;
                    default: sb.Append(e); break;
                }
            }
            throw new FormatException("JSON: мөр хаагдаагүй");
        }

        private static void Ws(string s, ref int i)
        {
            while (i < s.Length && char.IsWhiteSpace(s[i])) i++;
        }

        private static void Expect(string s, ref int i, char c)
        {
            if (i >= s.Length || s[i] != c) throw new FormatException("JSON: '" + c + "' хүлээсэн @" + i);
            i++;
        }

        // ── Уншихад туслах ───────────────────────────────────────────────

        public static Dictionary<string, object> Obj(object o, string key)
        {
            return o is Dictionary<string, object> d && d.TryGetValue(key, out object v) ? v as Dictionary<string, object> : null;
        }

        public static List<object> Arr(object o, string key)
        {
            return o is Dictionary<string, object> d && d.TryGetValue(key, out object v) ? v as List<object> : null;
        }

        public static string Str(object o, string key, string def = null)
        {
            return o is Dictionary<string, object> d && d.TryGetValue(key, out object v) && v is string s ? s : def;
        }

        public static double Num(object o, string key, double def)
        {
            return o is Dictionary<string, object> d && d.TryGetValue(key, out object v) && v is double x ? x : def;
        }

        public static bool Bool(object o, string key, bool def)
        {
            return o is Dictionary<string, object> d && d.TryGetValue(key, out object v) && v is bool b ? b : def;
        }
    }
}
