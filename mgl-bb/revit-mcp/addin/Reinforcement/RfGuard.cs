using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitMcpAddin.Reinforcement
{
    /// <summary>
    /// Команд бүрийн НИЙТЛЭГ эхлэл: лиценз → нээлттэй project → family биш.
    ///
    /// ⚠️ ЛИЦЕНЗ (1.9.0): add-in-ий БҮХ команд эхлээд `LicenseGate.Ensure()`-ийг дуудах ЁСТОЙ — энэ нь шинэ
    /// команд бүрийн гүн хамгаалалт (`Licensing/LicenseGate.cs`).
    /// </summary>
    internal static class RfGuard
    {
        public static bool Begin(ExternalCommandData data, string title, out UIDocument uidoc, out Document doc)
        {
            uidoc = null;
            doc = null;
            if (!global::RevitMcpAddin.Licensing.LicenseGate.Ensure()) return false;
            uidoc = data.Application.ActiveUIDocument;
            if (uidoc == null || uidoc.Document == null) return false;
            doc = uidoc.Document;
            if (doc.IsFamilyDocument)
            {
                TaskDialog.Show(title, RfText.NoProject);
                return false;
            }
            return true;
        }

        /// <summary>Нэг мөр ТАЙЛАН — гол дүн + (дэлгэрэнгүйд) алдаа, тэмдэглэл.</summary>
        public static void ShowReport(string title, string instruction, string content, IEnumerable<string> details)
        {
            var td = new TaskDialog(title) { MainInstruction = instruction, MainContent = content };
            List<string> lines = details == null ? new List<string>() : details.Where(s => !string.IsNullOrEmpty(s)).Take(25).ToList();
            if (lines.Count > 0)
                td.ExpandedContent = string.Join("\n", lines.Select(s => "• " + s));
            td.Show();
        }
    }
}
