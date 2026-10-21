using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using MglBb.Core;
using MglBb.Infra;

namespace MglBb.Settings
{
    /// <summary>«Тохиргоо»: шошго / MRA-ийн option-ууд ба энэ төсөлд идэвхтэй option.  Загварт юу ч бичихгүй.</summary>
    internal static class SettingsFlow
    {
        public static Result Run(UIDocument uidoc)
        {
            Document doc = uidoc.Document;
            BbStandard learned = BbStore.LoadStandard(out string src);
            BbOptionBook book = BbStore.LoadOptions();
            var win = new BbSettingsWindow(book, learned, BbStore.ProjectKey(doc), doc.Title, TagTypes(doc), MraTypes(doc));
            if (!win.Show(uidoc.Application.MainWindowHandle) || win.Result == null) return Result.Cancelled;
            try { BbStore.SaveOptions(win.Result); }
            catch (Exception ex)
            {
                TaskDialog.Show("MGL ББ — Тохиргоо", "Хадгалж чадсангүй: " + ex.Message + Environment.NewLine + BbStore.OptionsPath);
                return Result.Failed;
            }
            return Result.Succeeded;
        }

        /// <summary>Арматурын шошгоны төрөл «family : type» (<c>BbAnnotate.TagTypeId</c>-ийн хайдаг хэлбэр).</summary>
        public static List<string> TagTypes(Document doc)
        {
            return new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_RebarTags).WhereElementIsElementType().OfType<FamilySymbol>()
                .Select(fs => fs.FamilyName + " : " + fs.Name).Distinct().OrderBy(s => s, StringComparer.CurrentCulture).ToList();
        }

        public static List<string> MraTypes(Document doc)
        {
            return new FilteredElementCollector(doc).OfClass(typeof(MultiReferenceAnnotationType)).Cast<MultiReferenceAnnotationType>()
                .Select(m => m.Name).Distinct().OrderBy(s => s, StringComparer.CurrentCulture).ToList();
        }
    }
}
