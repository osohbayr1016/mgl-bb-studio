using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// «Буцаах» — Revit-д шууд зөөсөн элементүүдийг ЯГ −шилжилтээр буцааж зөөнө.  НЭГ гүйлгээ «MGL — Зөөлтийг буцаах» (Undo жагсаалтад нэг алхам);
    /// нэр нь «MGL»-ээр эхэлдэг тул `PostMoveWatch` өөрийн гүйлгээг дахин шалгахгүй.  Загварт бичих ГАНЦ газар энэ (зөвхөн хэрэглэгч товч дарахад).
    /// </summary>
    internal static class PostMoveRevert
    {
        internal const string UndoName = "MGL — Зөөлтийг буцаах";

        /// <summary>null = амжилттай; эс бөгөөс хэрэглэгчид харуулах шалтгаан.</summary>
        internal static string Run(Document doc, IList<ElementId> ids, SimVec deltaMm)
        {
            if (doc.IsModifiable) return "Revit өөр ажил гүйцэтгэж байна — дахин оролдоно уу.";
            XYZ back = new XYZ(-PcUnits.ToInternalMm(deltaMm.X), -PcUnits.ToInternalMm(deltaMm.Y), -PcUnits.ToInternalMm(deltaMm.Z));
            using (var t = new Transaction(doc, UndoName))
            {
                try
                {
                    if (t.Start() != TransactionStatus.Started) return "Revit гүйлгээ нээхийг зөвшөөрсөнгүй.";
                    if (ids.Count == 1) ElementTransformUtils.MoveElement(doc, ids[0], back);
                    else ElementTransformUtils.MoveElements(doc, ids, back);
                    if (t.Commit() != TransactionStatus.Committed) return "Revit буцаахыг зөвшөөрсөнгүй — Ctrl+Z ашиглана уу.";
                }
                catch (Exception ex)
                {
                    if (t.HasStarted() && !t.HasEnded()) { try { t.RollBack(); } catch (Exception) { } }
                    SmartLog.Error("native", "revert_failed", ex);
                    return "Буцааж чадсангүй (" + ex.GetType().Name + ") — Ctrl+Z ашиглана уу.";
                }
            }
            foreach (ElementId id in ids)
            {
                Element e = doc.GetElement(id);
                if (e != null) PostMoveWatch.Remember(id.Value, SimExactAnalyzer.LocOrBox(e));
            }
            return null;
        }
    }
}
