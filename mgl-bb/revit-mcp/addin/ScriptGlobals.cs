using System.Text;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitMcpAddin
{
    /// <summary>
    /// The object exposed to executed C# scripts as their globals. Anything that
    /// is a public member here is directly accessible (unqualified) inside the
    /// script, e.g. <c>Doc</c>, <c>UiApp</c>, <c>Print(...)</c>.
    /// </summary>
    public class ScriptGlobals
    {
        public Document Doc { get; set; }
        public UIDocument UiDoc { get; set; }
        public UIApplication UiApp { get; set; }

        private readonly StringBuilder _output = new StringBuilder();

        /// <summary>Append a line to the text output returned to the caller.</summary>
        public void Print(object message)
        {
            _output.AppendLine(message == null ? "null" : message.ToString());
        }

        public string GetOutput() => _output.ToString();
    }
}
