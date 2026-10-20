using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;

namespace RevitMcpAddin.FamilyHub.Tests
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
        public static void NotNull(object o, string msg = null) { if (o == null) throw new AssertFailed(msg ?? "expected not null"); }
        public static void Contains(string hay, string needle, string msg = null)
        {
            if (hay == null || hay.IndexOf(needle, StringComparison.Ordinal) < 0)
                throw new AssertFailed((msg ?? "") + " expected to contain " + Fmt(needle) + " in " + Fmt(hay));
        }
        private static string Fmt(object o) => o == null ? "null" : o is string ? "\"" + o + "\"" : o.ToString();
    }

    public static class Program
    {
        public static int Main(string[] args)
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8;
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
                    object r = m.Invoke(null, null);
                    if (r is Task t) t.GetAwaiter().GetResult();
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
                catch (Exception ex)
                {
                    fail++;
                    Exception inner = ex is AggregateException ae ? ae.InnerException ?? ae : ex;
                    Console.WriteLine("  FAIL " + name + "\n       " + inner.GetType().Name + ": " + inner.Message);
                    if (!(inner is AssertFailed)) Console.WriteLine(inner.StackTrace);
                }
            }
            Console.WriteLine();
            Console.WriteLine("FamilyHub.Tests: " + pass + " passed, " + fail + " failed (" + sw.ElapsedMilliseconds + " ms)");
            return fail == 0 ? 0 : 1;
        }
    }
}
