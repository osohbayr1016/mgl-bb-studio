using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Reflection;

namespace RevitMcpAddin.Smart.Tests
{
    [AttributeUsage(AttributeTargets.Method)]
    public sealed class TestAttribute : Attribute { }

    /// <summary>
    /// Тест нь ЗӨВХӨН Windows-ийн файл/замын семантикт утгатай (`D:\\Out` бүтэн зам, `\\` тусгаарлагч, FileShare түгжээ) — Revit бол Windows-ийн програм.
    /// Windows бус ОС дээр «унасан» биш «алгассан» (шалтгаантайгаар) гэж ИЛ тайлагнана; Windows дээр ердийнхөөр ажиллана.
    /// `SMART_TESTS_STRICT=1` бол алгасалтыг АЛДАА гэж тооцно.  Баталгаажуулалт: docs/CHANGE_IMPACT_RADAR_MVP.md «Үндсэн заллуурын 27 тест».
    /// </summary>
    [AttributeUsage(AttributeTargets.Method)]
    public sealed class WindowsOnlyAttribute : Attribute
    {
        public string Reason { get; private set; }
        public WindowsOnlyAttribute(string reason) { Reason = reason; }
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
        public static void Near(double expected, double actual, double eps, string msg = null)
        {
            if (Math.Abs(expected - actual) > eps)
                throw new AssertFailed((msg ?? "") + " expected≈" + expected + " actual=" + actual + " eps=" + eps);
        }
        public static void Null(object o, string msg = null) { if (o != null) throw new AssertFailed(msg ?? "expected null, got " + Fmt(o)); }
        public static void NotNull(object o, string msg = null) { if (o == null) throw new AssertFailed(msg ?? "expected not null"); }
        public static void Contains<T>(IEnumerable<T> seq, T item, string msg = null)
        {
            if (!seq.Contains(item)) throw new AssertFailed((msg ?? "") + " missing " + Fmt(item));
        }
        public static void NotContains<T>(IEnumerable<T> seq, T item, string msg = null)
        {
            if (seq.Contains(item)) throw new AssertFailed((msg ?? "") + " unexpected " + Fmt(item));
        }
        public static void SeqEq<T>(IEnumerable<T> expected, IEnumerable<T> actual, string msg = null)
        {
            List<T> e = expected.ToList(), a = actual.ToList();
            if (!e.SequenceEqual(a))
                throw new AssertFailed((msg ?? "") + " expected=[" + string.Join(", ", e.Select(x => Fmt(x))) + "] actual=[" + string.Join(", ", a.Select(x => Fmt(x))) + "]");
        }
        public static void Throws<TEx>(Action a, string msg = null) where TEx : Exception
        {
            try { a(); }
            catch (TEx) { return; }
            catch (Exception ex) { throw new AssertFailed((msg ?? "") + " wrong exception " + ex.GetType().Name + ": " + ex.Message); }
            throw new AssertFailed((msg ?? "") + " expected " + typeof(TEx).Name);
        }
        private static string Fmt(object o) => o == null ? "null" : o is string ? "\"" + o + "\"" : o.ToString();
    }

    public static class Program
    {
        public static int Main(string[] args)
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8;
            // ⚠️ `dotnet run`-д `--nologo` БАЙХГҮЙ — тэр нь ЭНД args болж ирдэг (урхи №17).
            string filter = args.Length > 0 && !args[0].StartsWith("-") ? args[0] : null;
            var methods = Assembly.GetExecutingAssembly().GetTypes()
                .Where(t => t.Name.EndsWith("Tests", StringComparison.Ordinal))
                .SelectMany(t => t.GetMethods(BindingFlags.Public | BindingFlags.Static))
                .Where(m => m.GetCustomAttribute<TestAttribute>() != null)
                .OrderBy(m => m.DeclaringType.Name).ThenBy(m => m.Name)
                .ToList();
            int pass = 0, fail = 0, skip = 0;
            bool strict = Environment.GetEnvironmentVariable("SMART_TESTS_STRICT") == "1";
            var sw = Stopwatch.StartNew();
            foreach (MethodInfo m in methods)
            {
                string name = m.DeclaringType.Name + "." + m.Name;
                if (filter != null && name.IndexOf(filter, StringComparison.OrdinalIgnoreCase) < 0) continue;
                WindowsOnlyAttribute wo = m.GetCustomAttribute<WindowsOnlyAttribute>();
                if (wo != null && !OperatingSystem.IsWindows() && !strict)
                {
                    skip++;
                    Console.WriteLine("  skip " + name + "  [Windows-only: " + wo.Reason + "]");
                    continue;
                }
                try
                {
                    m.Invoke(null, null);
                    pass++;
                    Console.WriteLine("  ok   " + name);
                }
                catch (TargetInvocationException tie)
                {
                    fail++;
                    Exception ex = tie.InnerException ?? tie;
                    Console.WriteLine("  FAIL " + name + "\n       " + ex.GetType().Name + ": " + ex.Message);
                    if (!(ex is AssertFailed)) Console.WriteLine(ex.StackTrace);
                }
            }
            Console.WriteLine();
            Console.WriteLine((fail == 0 ? "PASS " : "FAIL ") + pass + "/" + (pass + fail) + (skip > 0 ? " (+" + skip + " Windows-only skipped)" : "") + " in " + sw.ElapsedMilliseconds + " ms");
            return fail == 0 ? 0 : 1;
        }
    }
}
