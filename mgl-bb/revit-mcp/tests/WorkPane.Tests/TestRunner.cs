using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Reflection;

namespace RevitMcpAddin.WorkPane.Tests
{
    [AttributeUsage(AttributeTargets.Method)]
    public sealed class TestAttribute : Attribute { }

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
        public static void Null(object o, string msg = null) { if (o != null) throw new AssertFailed(msg ?? "expected null, got " + Fmt(o)); }
        private static string Fmt(object o) => o == null ? "null" : o is string ? "\"" + o + "\"" : o.ToString();
    }

    public static class Program
    {
        public static int Main(string[] args)
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8;
            // ⚠️ `dotnet run`-д `--nologo` БАЙХГҮЙ — тэр нь ЭНД args болж ирдэг.
            string filter = args.Length > 0 && !args[0].StartsWith("-") ? args[0] : null;
            var methods = Assembly.GetExecutingAssembly().GetTypes()
                .Where(t => t.Name.EndsWith("Tests", StringComparison.Ordinal))
                .SelectMany(t => t.GetMethods(BindingFlags.Public | BindingFlags.Static))
                .Where(m => m.GetCustomAttribute<TestAttribute>() != null)
                .OrderBy(m => m.DeclaringType.Name).ThenBy(m => m.Name)
                .ToList();
            int pass = 0, fail = 0;
            var sw = Stopwatch.StartNew();
            foreach (MethodInfo m in methods)
            {
                string name = m.DeclaringType.Name + "." + m.Name;
                if (filter != null && name.IndexOf(filter, StringComparison.OrdinalIgnoreCase) < 0) continue;
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
            Console.WriteLine((fail == 0 ? "PASS " : "FAIL ") + pass + "/" + (pass + fail) + " in " + sw.ElapsedMilliseconds + " ms");
            return fail == 0 ? 0 : 1;
        }
    }
}
