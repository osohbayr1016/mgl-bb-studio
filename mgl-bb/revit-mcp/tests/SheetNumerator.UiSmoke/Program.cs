using System;
using System.Diagnostics;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Windows;
using System.Windows.Threading;

namespace RevitMcpAddin.SheetNumerator.UiSmoke
{
    public static class Program
    {
        [STAThread]
        public static int Main(string[] args)
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8;
            string filter = args.Length > 0 && !args[0].StartsWith("-") ? args[0] : null;

            var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            // await-ийн үргэлжлэл UI thread дээр буцахын тулд (бодит Revit-д ч ингэж ажиллана).
            SynchronizationContext.SetSynchronizationContext(new DispatcherSynchronizationContext(Dispatcher.CurrentDispatcher));

            var methods = Assembly.GetExecutingAssembly().GetTypes()
                .Where(t => t.Name.EndsWith("Smoke", StringComparison.Ordinal) && t.IsAbstract && t.IsSealed)
                .SelectMany(t => t.GetMethods(BindingFlags.Public | BindingFlags.Static))
                .Where(m => m.GetParameters().Length == 0 && m.ReturnType == typeof(void) && m.DeclaringType.IsPublic)
                .OrderBy(m => m.DeclaringType.Name).ThenBy(m => m.MetadataToken)
                .ToList();

            int pass = 0, fail = 0;
            var sw = Stopwatch.StartNew();
            foreach (MethodInfo m in methods)
            {
                string name = m.DeclaringType.Name + "." + m.Name;
                if (filter != null && name.IndexOf(filter, StringComparison.OrdinalIgnoreCase) < 0)
                    continue;
                var one = Stopwatch.StartNew();
                try
                {
                    m.Invoke(null, null);
                    pass++;
                    Console.WriteLine("  ok   " + name + "  (" + one.ElapsedMilliseconds + " ms)");
                }
                catch (TargetInvocationException tie)
                {
                    fail++;
                    Exception ex = tie.InnerException ?? tie;
                    Console.WriteLine("  FAIL " + name + "\n       " + ex.GetType().Name + ": " + ex.Message);
                    if (!(ex is SmokeFailed))
                        Console.WriteLine(ex.StackTrace);
                }
                foreach (Window w in app.Windows.Cast<Window>().ToList())
                {
                    try { w.Close(); } catch (Exception) { }
                }
                Ui.Pump(20);
            }

            Console.WriteLine();
            Console.WriteLine((fail == 0 ? "PASS " : "FAIL ") + pass + "/" + (pass + fail) + " in " + sw.ElapsedMilliseconds + " ms");
            Console.WriteLine("Зураг: " + Ui.OutDir);
            app.Shutdown();
            return fail == 0 ? 0 : 1;
        }
    }
}
