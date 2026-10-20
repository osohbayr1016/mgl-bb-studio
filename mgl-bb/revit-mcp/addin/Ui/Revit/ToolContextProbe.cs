using System;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin.Ui.Revit
{
    /// <summary>
    /// Каталог нээгдэх агшинд НЭГ удаа, ХЯМДААР уншигдах контекст: баримт, идэвхтэй харагдац, лиценз, ERP төсөл.
    /// ⚠️ Collector ХЭЗЭЭ Ч үүсгэхгүй; сүлжээ ХЭЗЭЭ Ч дуудахгүй; model скан хийхгүй.  Уншиж чадаагүй зүйлийг
    /// ТААХГҮЙ (`Unknown`) — каталог «үл мэдэгдэх»-ийг саад гэж үзэхгүй.
    /// </summary>
    internal static class ToolContextProbe
    {
        internal static ToolContext Read(UIApplication uiApp)
        {
            var ctx = new ToolContext { RunningBuild = RibbonBuilder.Running, License = ToolLicenseState.Unknown };
            try
            {
                UIDocument uidoc = uiApp == null ? null : uiApp.ActiveUIDocument;
                Document doc = uidoc == null ? null : uidoc.Document;
                if (doc != null)
                {
                    ctx.HasDocument = true;
                    ctx.IsFamilyDocument = doc.IsFamilyDocument;
                    View v = null;
                    try { v = uidoc.ActiveView; } catch { /* харагдац байхгүй */ }
                    ctx.ViewKind = Classify(v);
                    ctx.ViewIsTemplate = v != null && v.IsTemplate;
                }
            }
            catch
            {
                // Баримтын төлөв уншигдсангүй — `HasDocument=false` үлдэнэ.
            }

            ctx.License = ReadLicense();
            ctx.ErpProjectSelected = ReadErpProject();
            return ctx;
        }

        internal static ToolViewKind Classify(View v)
        {
            if (v == null) return ToolViewKind.None;
            try
            {
                switch (v.ViewType)
                {
                    case ViewType.FloorPlan:
                    case ViewType.CeilingPlan:
                    case ViewType.EngineeringPlan:
                    case ViewType.AreaPlan:
                        return ToolViewKind.Plan;
                    case ViewType.Section: return ToolViewKind.Section;
                    case ViewType.Elevation: return ToolViewKind.Elevation;
                    case ViewType.Detail: return ToolViewKind.Detail;
                    case ViewType.ThreeD: return ToolViewKind.ThreeD;
                    case ViewType.DrawingSheet: return ToolViewKind.Sheet;
                    case ViewType.Schedule:
                    case ViewType.PanelSchedule:
                    case ViewType.ColumnSchedule:
                        return ToolViewKind.Schedule;
                    case ViewType.DraftingView: return ToolViewKind.Drafting;
                    default: return ToolViewKind.Other;
                }
            }
            catch
            {
                return ToolViewKind.Other;
            }
        }

        /// <summary>Лиценз: сүлжээгүй, хямд.  Хүчинтэй бол Valid; үгүй бол Snapshot-оос «админ хүлээж байна» эсэхийг ялгана.</summary>
        private static ToolLicenseState ReadLicense()
        {
            try
            {
                if (Licensing.LicenseGate.IsLicensedNow()) return ToolLicenseState.Valid;
                Licensing.LicenseSnapshot snap = Licensing.LicenseGate.Snapshot();
                if (snap != null && string.Equals(snap.LastCode, "DEVICE_PENDING", StringComparison.Ordinal))
                    return ToolLicenseState.Pending;
                return ToolLicenseState.SignInRequired;
            }
            catch
            {
                return ToolLicenseState.Unknown;
            }
        }

        private static bool ReadErpProject()
        {
            try
            {
                AddinSettings s = SettingsStore.Load();
                return s != null && s.ProjectId != null;
            }
            catch
            {
                return false;
            }
        }
    }
}
