using System;
using System.Collections.Concurrent;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Microsoft.CodeAnalysis.CSharp.Scripting;
using Microsoft.CodeAnalysis.Scripting;

namespace RevitMcpAddin
{
    /// <summary>
    /// Runs on Revit's main thread (via ExternalEvent). Dequeues pending requests,
    /// compiles + runs the supplied C# with Roslyn inside a host-owned Transaction,
    /// and captures the return value / printed output / errors.
    /// </summary>
    public class CodeExecutorEventHandler : IExternalEventHandler
    {
        private readonly ConcurrentQueue<ExecuteRequest> _queue = new ConcurrentQueue<ExecuteRequest>();

        public void Enqueue(ExecuteRequest request) => _queue.Enqueue(request);

        public string GetName() => "RevitMcpCodeExecutor";

        public void Execute(UIApplication app)
        {
            while (_queue.TryDequeue(out ExecuteRequest req))
            {
                ProcessOne(app, req);
            }
        }

        private void ProcessOne(UIApplication app, ExecuteRequest req)
        {
            var globals = new ScriptGlobals { UiApp = app };
            Transaction tx = null;

            try
            {
                UIDocument uidoc = app.ActiveUIDocument;
                if (uidoc == null)
                    throw new InvalidOperationException(
                        "No active document is open in Revit. Open a project first.");

                Document doc = uidoc.Document;
                globals.Doc = doc;
                globals.UiDoc = uidoc;

                ScriptOptions options = ScriptOptions.Default
                    .WithReferences(
                        typeof(Document).Assembly,                 // RevitAPI.dll
                        typeof(UIApplication).Assembly,            // RevitAPIUI.dll
                        typeof(System.Linq.Enumerable).Assembly)   // System.Linq
                    .WithImports(
                        "System",
                        "System.Linq",
                        "System.Collections.Generic",
                        "Autodesk.Revit.DB",
                        "Autodesk.Revit.UI");

                tx = new Transaction(doc, "MCP Script");
                tx.Start();

                object ret = CSharpScript
                    .EvaluateAsync<object>(req.Code, options, globals)
                    .GetAwaiter()
                    .GetResult();

                tx.Commit();

                req.Success = true;
                req.Result = ret == null ? "null" : ret.ToString();
                req.Output = globals.GetOutput();
            }
            catch (CompilationErrorException cex)
            {
                SafeRollback(tx);
                req.Success = false;
                req.Output = globals.GetOutput();
                req.Error = "Compilation error:\n" +
                            string.Join("\n", cex.Diagnostics.Select(d => d.ToString()));
            }
            catch (Exception ex)
            {
                SafeRollback(tx);
                req.Success = false;
                req.Output = globals.GetOutput();
                string inner = ex.InnerException != null
                    ? "\nInner: " + ex.InnerException.Message
                    : string.Empty;
                req.Error = ex.GetType().Name + ": " + ex.Message + inner + "\n" + ex.StackTrace;
            }
            finally
            {
                tx?.Dispose();
                req.Done.Set();
            }
        }

        private static void SafeRollback(Transaction tx)
        {
            try
            {
                if (tx != null && tx.HasStarted() && !tx.HasEnded())
                    tx.RollBack();
            }
            catch { /* nothing useful to do */ }
        }
    }
}
