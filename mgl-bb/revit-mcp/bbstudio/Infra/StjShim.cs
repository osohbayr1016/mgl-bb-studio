#if NETFRAMEWORK
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using MglBb.Core;

// ══════════════════════════════════════════════════════════════════════
// Revit 2024 (net48) ДЭЭР л: линкээр эмхэтгэсэн үндсэн plugin-ий хөдөлгүүр (RfSectionStore, RfPrefs, RfShowService) нь
// System.Text.Json-ийн JsonSerializer-ийг хэрэглэдэг.  net48-д тэр нь NuGet DLL (+ System.Memory, Unsafe …) бөгөөд ҮНДСЭН MGL plugin
// өөрийн хувилбарыг НЭГ процесст ачаалдаг — тусдаа plugin өөр/ижил хувилбарыг түрүүлж ачаалбал үндсэн plugin-ий assembly binding-д
// нөлөөлөх эрсдэлтэй.  Тиймээс ЭНЭ assembly дотор (internal) ижил нэртэй хамгийн бага орлуулагч: зөвхөн хэрэглэгдэж буй гадаргуу
// (Serialize/Deserialize, WriteIndented, JsonIgnore), STJ-ийн өгөгдмөл хэлбэр (PascalCase нэр, case-sensitive) — үндсэн plugin-ий
// бичсэн Extensible Storage-ийн JSON-ыг уншиж, түүнд уншигдахуйц бичнэ.  net8/net10 (Revit 2025+) дээр runtime-ийн жинхэнэ STJ.
// ══════════════════════════════════════════════════════════════════════
namespace System.Text.Json.Serialization
{
    [AttributeUsage(AttributeTargets.Property | AttributeTargets.Field)]
    internal sealed class JsonIgnoreAttribute : Attribute { }
}

namespace System.Text.Json
{
    internal sealed class JsonSerializerOptions
    {
        public bool WriteIndented { get; set; }
    }

    internal static class JsonSerializer
    {
        public static string Serialize<T>(T value, JsonSerializerOptions options = null)
        {
            return BbJson.Write(ToTree(value), options != null && options.WriteIndented);
        }

        public static T Deserialize<T>(string json, JsonSerializerOptions options = null)
        {
            object tree = BbJson.Parse(json);
            return (T)FromTree(tree, typeof(T));
        }

        private static IEnumerable<PropertyInfo> Props(Type t)
        {
            foreach (PropertyInfo p in t.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                if (p.GetIndexParameters().Length > 0) continue;
                if (p.GetCustomAttribute(typeof(System.Text.Json.Serialization.JsonIgnoreAttribute)) != null) continue;
                yield return p;
            }
        }

        private static object ToTree(object v)
        {
            if (v == null) return null;
            Type t = v.GetType();
            if (v is string || v is bool) return v;
            if (v is double || v is float || v is int || v is long || v is decimal || v is short) return Convert.ToDouble(v, CultureInfo.InvariantCulture);
            if (t.IsEnum) return Convert.ToDouble(v, CultureInfo.InvariantCulture);
            if (v is IDictionary dict)
            {
                var d = new Dictionary<string, object>(StringComparer.Ordinal);
                foreach (DictionaryEntry e in dict) d[Convert.ToString(e.Key, CultureInfo.InvariantCulture)] = ToTree(e.Value);
                return d;
            }
            if (v is IEnumerable en)
            {
                var l = new List<object>();
                foreach (object x in en) l.Add(ToTree(x));
                return l;
            }
            var o = new Dictionary<string, object>(StringComparer.Ordinal);
            foreach (PropertyInfo p in Props(t))
            {
                if (!p.CanRead) continue;
                o[p.Name] = ToTree(p.GetValue(v));
            }
            return o;
        }

        private static object FromTree(object node, Type t)
        {
            Type u = Nullable.GetUnderlyingType(t);
            if (node == null) return t.IsValueType && u == null ? Activator.CreateInstance(t) : null;
            if (u != null) t = u;
            if (t == typeof(string)) return node as string ?? Convert.ToString(node, CultureInfo.InvariantCulture);
            if (t == typeof(bool)) return node is bool b ? b : false;
            if (t == typeof(double)) return node is double d ? d : 0.0;
            if (t == typeof(float)) return node is double f ? (float)f : 0f;
            if (t == typeof(int)) return node is double i ? (int)Math.Round(i) : 0;
            if (t == typeof(long)) return node is double l ? (long)Math.Round(l) : 0L;
            if (t.IsEnum) return node is double e ? Enum.ToObject(t, (int)e) : Activator.CreateInstance(t);
            if (t.IsGenericType && t.GetGenericTypeDefinition() == typeof(List<>))
            {
                var list = (IList)Activator.CreateInstance(t);
                Type it = t.GetGenericArguments()[0];
                if (node is List<object> arr) foreach (object x in arr) list.Add(FromTree(x, it));
                return list;
            }
            if (t.IsGenericType && t.GetGenericTypeDefinition() == typeof(Dictionary<,>))
            {
                var dict = (IDictionary)Activator.CreateInstance(t);
                Type vt = t.GetGenericArguments()[1];
                if (node is Dictionary<string, object> m) foreach (var kv in m) dict[kv.Key] = FromTree(kv.Value, vt);
                return dict;
            }
            object obj = Activator.CreateInstance(t);
            if (node is Dictionary<string, object> map)
            {
                foreach (PropertyInfo p in Props(t))
                {
                    if (!p.CanWrite) continue;
                    if (!map.TryGetValue(p.Name, out object pv)) continue;
                    try { p.SetValue(obj, FromTree(pv, p.PropertyType)); }
                    catch { /* STJ шиг: тохирохгүй утгыг алгасна */ }
                }
            }
            return obj;
        }
    }
}
#endif
