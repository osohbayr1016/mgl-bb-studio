using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Reflection;

namespace RevitMcpAddin.WallElevation.Tests
{
    [AttributeUsage(AttributeTargets.Method)]
    public sealed class TestAttribute : Attribute { }

    /// <summary>
    /// Мэдэгдэж буй, ХАРААХАН ЗАСАГДААГҮЙ алдааг барьдаг тест (`release-gate/wall-elevation/known-issues.json`-ийн id).  Унавал «KNOWN»
    /// (exit code-д нөлөөлөхгүй), ДАВБАЛ «FIXED?» — алдаа засагдсан бол атрибутыг авч, known-issues-ээс хаана.
    /// </summary>
    [AttributeUsage(AttributeTargets.Method)]
    public sealed class KnownBugAttribute : Attribute
    {
        public readonly string Id;
        public KnownBugAttribute(string id) { Id = id; }
    }

    public sealed class AssertFailed : Exception
    {
        public AssertFailed(string m) : base(m) { }
    }

    public static class Assert
    {
        public static void True(bool c, string msg = null) { if (!c) throw new AssertFailed(msg ?? "expected true"); }
        public static void False(bool c, string msg = null) { if (c) throw new AssertFailed(msg ?? "expected false"); }

        public static void Eq<T>(T expected, T actual, string msg = null)
        {
            if (!EqualityComparer<T>.Default.Equals(expected, actual))
                throw new AssertFailed((msg ?? "") + " expected=" + Fmt(expected) + " actual=" + Fmt(actual));
        }

        public static void SeqEq<T>(IEnumerable<T> expected, IEnumerable<T> actual, string msg = null)
        {
            List<T> e = expected.ToList();
            List<T> a = actual.ToList();
            bool same = e.Count == a.Count;
            for (int i = 0; same && i < e.Count; i++)
                same = EqualityComparer<T>.Default.Equals(e[i], a[i]);
            if (!same)
                throw new AssertFailed((msg ?? "") + " expected=[" + string.Join(", ", e.Select(x => Fmt(x))) + "] actual=[" + string.Join(", ", a.Select(x => Fmt(x))) + "]");
        }

        public static void Null(object o, string msg = null) { if (o != null) throw new AssertFailed(msg ?? "expected null, got " + Fmt(o)); }
        public static void NotNull(object o, string msg = null) { if (o == null) throw new AssertFailed(msg ?? "expected not null"); }

        public static void Contains<T>(IEnumerable<T> seq, T item, string msg = null)
        {
            if (!seq.Contains(item)) throw new AssertFailed((msg ?? "") + " missing " + Fmt(item));
        }

        public static void Throws<TEx>(Action a, string msg = null) where TEx : Exception
        {
            try { a(); }
            catch (TEx) { return; }
            catch (Exception ex) { throw new AssertFailed((msg ?? "") + " wrong exception " + ex.GetType().Name + ": " + ex.Message); }
            throw new AssertFailed((msg ?? "") + " expected " + typeof(TEx).Name);
        }

        private static string Fmt(object o)
        {
            if (o == null) return "null";
            if (o is string s) return "\"" + Escape(s) + "\"";
            return o.ToString();
        }

        /// <summary>Үл үзэгдэх тэмдгийг \uXXXX болгож харуулна — тест унахад юу ялгаатайг харахад.</summary>
        public static string Escape(string s)
        {
            var sb = new System.Text.StringBuilder();
            foreach (char c in s)
            {
                if (c < 32 || c > 126) sb.Append("\\u" + ((int)c).ToString("X4"));
                else sb.Append(c);
            }
            return sb.ToString();
        }
    }

    public static class Program
    {
        public static int Main(string[] args)
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8;
            // `dotnet run`-д `--nologo` БАЙХГҮЙ — тэр нь ЭНД args болж ирдэг.  `--json <файл>` = release gate-ийн машин уншигдах үр дүн.
            string filter = null, jsonPath = null;
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--json" && i + 1 < args.Length) { jsonPath = args[++i]; continue; }
                if (!args[i].StartsWith("-") && filter == null) filter = args[i];
            }
            var methods = Assembly.GetExecutingAssembly().GetTypes()
                .Where(t => t.Name.EndsWith("Tests", StringComparison.Ordinal))
                .SelectMany(t => t.GetMethods(BindingFlags.Public | BindingFlags.Static))
                .Where(m => m.GetCustomAttribute<TestAttribute>() != null)
                .OrderBy(m => m.DeclaringType.Name).ThenBy(m => m.Name)
                .ToList();
            int pass = 0, fail = 0, known = 0, fixedKnown = 0;
            var rows = new List<string>();
            var sw = Stopwatch.StartNew();
            foreach (MethodInfo m in methods)
            {
                string name = m.DeclaringType.Name + "." + m.Name;
                if (filter != null && name.IndexOf(filter, StringComparison.OrdinalIgnoreCase) < 0) continue;
                KnownBugAttribute kb = m.GetCustomAttribute<KnownBugAttribute>();
                try
                {
                    m.Invoke(null, null);
                    if (kb != null)
                    {
                        fixedKnown++;
                        Console.WriteLine("  FIXED? " + kb.Id + " " + name + "  — алдаа засагдсан бол [KnownBug]-ийг авч known-issues.json-оос хаа");
                        rows.Add(Row(name, "fixed", kb.Id, null));
                    }
                    else
                    {
                        pass++;
                        Console.WriteLine("  ok   " + name);
                        rows.Add(Row(name, "pass", null, null));
                    }
                }
                catch (TargetInvocationException tie)
                {
                    Exception ex = tie.InnerException ?? tie;
                    if (kb != null)
                    {
                        known++;
                        Console.WriteLine("  KNOWN " + kb.Id + " " + name + "\n       " + ex.GetType().Name + ": " + ex.Message);
                        rows.Add(Row(name, "known", kb.Id, ex.Message));
                        continue;
                    }
                    fail++;
                    Console.WriteLine("  FAIL " + name + "\n       " + ex.GetType().Name + ": " + ex.Message);
                    if (!(ex is AssertFailed)) Console.WriteLine(ex.StackTrace);
                    rows.Add(Row(name, "fail", null, ex.GetType().Name + ": " + ex.Message));
                }
            }
            Console.WriteLine();
            string tail = (known > 0 ? " · KNOWN " + known : "") + (fixedKnown > 0 ? " · FIXED? " + fixedKnown : "");
            Console.WriteLine((fail == 0 ? "PASS " : "FAIL ") + pass + "/" + (pass + fail) + tail + " in " + sw.ElapsedMilliseconds + " ms");
            if (jsonPath != null)
            {
                string json = "{\"schema\":\"mgl-we-unit-v1\",\"runtime\":\"" + Esc(System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription)
                              + "\",\"pass\":" + pass + ",\"fail\":" + fail + ",\"known\":" + known + ",\"fixed\":" + fixedKnown
                              + ",\"tests\":[" + string.Join(",", rows) + "]}";
                System.IO.File.WriteAllText(jsonPath, json, new System.Text.UTF8Encoding(false));
            }
            return fail == 0 ? 0 : 1;
        }

        private static string Row(string name, string status, string id, string message)
        {
            return "{\"name\":\"" + Esc(name) + "\",\"status\":\"" + status + "\",\"known_id\":" + (id == null ? "null" : "\"" + Esc(id) + "\"")
                   + ",\"message\":" + (message == null ? "null" : "\"" + Esc(message) + "\"") + "}";
        }

        private static string Esc(string s)
        {
            var sb = new System.Text.StringBuilder();
            foreach (char c in s ?? string.Empty)
            {
                if (c == '"' || c == '\\') sb.Append('\\').Append(c);
                else if (c < 32) sb.Append("\\u" + ((int)c).ToString("X4"));
                else sb.Append(c);
            }
            return sb.ToString();
        }
    }
}
