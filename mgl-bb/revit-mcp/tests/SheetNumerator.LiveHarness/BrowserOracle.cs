using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.SheetNumerator.Core;
using RevitMcpAddin.SheetNumerator.Revit;

namespace SnLive
{
    /// <summary>
    /// Project Browser-ийн БОДИТ дарааллыг (UI Automation-аар Chromium-ийн accessibility tree-ээс) манай
    /// <see cref="SheetGroupingService.OrderByBrowser"/>-тай харьцуулах туслах.  Revit API Browser-ийн эрэмбийг өгдөггүй
    /// тул «зөв» эрэмбийг зөвхөн UI-аас л авч болно (<c>docs/SHEET_NUMERATOR.md</c> «Browser-ийн эрэмбэ»).
    ///
    /// Урсгал (идэвхтэй document дээр, `run_revit_code` дотор — нээлттэй Transaction-тай):
    ///   1. <see cref="SeedFromSample"/> — жишээ төслөөс (дугаар, нэр)-ийг уншиж, идэвхтэй document-д scratch хуудас үүсгэнэ.
    ///   2. <see cref="WriteOrder"/> — манай эрэмбийг файлд бичнэ.
    ///   3. UI Automation: Project Browser-ийн «Sheets (all)»-ийг дэлгэж, дарааллыг унших (PowerShell, жишээ нь docs-д).
    ///   4. Хоёр файлыг харьцуулна.
    /// </summary>
    public static class BrowserOracle
    {
        /// <summary>Жишээ төслийг дэвсгэрт нээж (дугаар, нэр)-ийн жагсаалтыг авна; document-ийг хадгалалгүй хаана.</summary>
        public static List<KeyValuePair<string, string>> ReadSheets(UIApplication app, string samplePath)
        {
            Document doc = app.Application.OpenDocumentFile(ModelPathUtils.ConvertUserVisiblePathToModelPath(samplePath), new OpenOptions { Audit = false });
            try
            {
                return new FilteredElementCollector(doc).OfClass(typeof(ViewSheet)).Cast<ViewSheet>()
                    .Select(s => new KeyValuePair<string, string>(s.SheetNumber, s.Name)).ToList();
            }
            finally
            {
                doc.Close(false);
            }
        }

        /// <summary>
        /// Идэвхтэй document-ийн БҮХ хуудсыг устгаад (scratch), өгөгдсөн (дугаар, нэр)-ээр шинээр үүсгэнэ.  Давхардсан
        /// дугаар (өөр цуглуулгад байсан) алгасагдана.  ⚠️ Зөвхөн scratch document дээр.
        /// </summary>
        public static string SeedFromSample(UIApplication app, string samplePath)
        {
            Document doc = app.ActiveUIDocument.Document;
            foreach (ElementId id in new FilteredElementCollector(doc).OfClass(typeof(ViewSheet)).Select(s => s.Id).ToList())
                doc.Delete(id);

            List<KeyValuePair<string, string>> pairs = ReadSheets(app, samplePath);
            int created = 0, skipped = 0;
            foreach (KeyValuePair<string, string> p in pairs)
            {
                ViewSheet sheet = ViewSheet.Create(doc, ElementId.InvalidElementId);
                try
                {
                    sheet.SheetNumber = p.Key;
                    sheet.Name = p.Value;
                    created++;
                }
                catch (Exception)
                {
                    doc.Delete(sheet.Id);
                    skipped++;
                }
            }
            return "sample хуудас=" + pairs.Count + " · үүсгэсэн=" + created + " · алгассан (давхардсан/хүчингүй)=" + skipped;
        }

        /// <summary>Идэвхтэй document-ийн хуудсыг манай Browser-ийн эрэмбээр «Дугаар - Нэр» мөрөөр файлд бичнэ.</summary>
        public static string WriteOrder(UIApplication app, string path)
        {
            SnapshotResult r = SheetSnapshotService.Capture(app.ActiveUIDocument.Document, app.Application.VersionNumber, 0);
            if (!r.Success)
                return "Capture амжилтгүй: " + r.Error;
            GroupingResult g = SheetGroupingService.Build(r.Snapshot, DisplayMode.AllInOne, false);
            string[] lines = g.Groups[0].Sheets.Select(s => s.Number + " - " + s.Name).ToArray();
            File.WriteAllLines(path, lines, new UTF8Encoding(false));
            return "бичлээ: " + lines.Length + " мөр → " + path;
        }
    }
}
