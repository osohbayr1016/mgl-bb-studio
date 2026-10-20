using System.Collections.Generic;
using MglLiraReport.Results;

namespace MglLiraReport
{
    /// <summary>
    /// Засварлагч LIRA-ийн өгөгдөлд хүрэх цорын ганц зам.  Энд LIRA-ийн төрөл байхгүй тул
    /// засварлагчийг LIRA-гүйгээр (MglReportEditor.exe) ажиллуулахад LiraAPI.dll ачаалагдахгүй.
    /// </summary>
    public interface ILiraSource
    {
        string Describe();
        /// <summary>LIRA-д нээлттэй загварын нэр (цонхны гарчгаас), олдохгүй бол "".</summary>
        string ModelName { get; }
        /// <returns>Оношилгооны файлын зам.</returns>
        string RunDiagnostics(out string summary);
        List<LiraCase> ListCases(CaseSource source);
        LiraMesh GetMesh();
        NodeField GetDisplacement(LiraCase c, MoveComponent component);
    }
}
