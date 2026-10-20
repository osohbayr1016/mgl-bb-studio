using System.Threading;

namespace RevitMcpAddin
{
    /// <summary>
    /// One unit of work passed from the HTTP thread to the Revit main thread.
    /// The HTTP thread fills in <see cref="Code"/>, raises the ExternalEvent, then
    /// blocks on <see cref="Done"/> until the handler fills in the result fields.
    /// </summary>
    public class ExecuteRequest
    {
        public string Code { get; set; }

        public bool Success { get; set; }
        public string Result { get; set; }
        public string Output { get; set; }
        public string Error { get; set; }

        public readonly ManualResetEventSlim Done = new ManualResetEventSlim(false);
    }
}
