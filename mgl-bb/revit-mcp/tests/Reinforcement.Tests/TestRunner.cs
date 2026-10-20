using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

namespace RevitMcpAddin.Reinforcement.Tests
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
                throw new AssertFailed((msg ?? "") + " expected=" + expected + " actual=" + actual);
        }
        public static void Near(double expected, double actual, double eps, string msg = null)
        {
            if (double.IsNaN(expected) || double.IsNaN(actual) || !(Math.Abs(expected - actual) <= eps))
                throw new AssertFailed((msg ?? "") + " expected~" + expected + " actual=" + actual);
        }
        public static void SeqEq<T>(IEnumerable<T> expected, IEnumerable<T> actual, string msg = null)
        {
            string e = string.Join(" | ", expected);
            string a = string.Join(" | ", actual);
            if (e != a)
                throw new AssertFailed((msg ?? "") + "\n  expected: " + e + "\n  actual:   " + a);
        }
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
                .Where(m => filter == null || m.Name.Contains(filter))
                .OrderBy(m => m.DeclaringType.Name).ThenBy(m => m.Name)
                .ToList();
            int pass = 0, fail = 0;
            foreach (MethodInfo m in methods)
            {
                try
                {
                    m.Invoke(null, null);
                    pass++;
                    Console.WriteLine("  ok   " + m.DeclaringType.Name + "." + m.Name);
                }
                catch (TargetInvocationException ex)
                {
                    fail++;
                    Console.WriteLine("  FAIL " + m.DeclaringType.Name + "." + m.Name + ": " + ex.InnerException?.Message);
                }
            }
            Console.WriteLine(pass + "/" + (pass + fail) + " passed");
            if (pass + fail == 0) { Console.WriteLine("0 тест олдсонгүй — шүүлтүүр эсвэл discovery буруу"); return 2; }
            return fail == 0 ? 0 : 1;
        }
    }
}
