using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.SmartPublish.Core;

namespace RevitMcpAddin.SmartPublish
{
    internal sealed class ExportRequest
    {
        public Document Doc { get; set; }
        public PublishProfile Profile { get; set; }
        public PlannedArtifact Artifact { get; set; }
        /// <summary>Экспортлох харагдац/хуудсууд (дарааллаар).  IFC-д хоосон.</summary>
        public List<ElementId> ViewIds { get; set; } = new List<ElementId>();
    }

    internal interface IExportAdapter
    {
        PublishFormat Format { get; }
        ExportOutcome Export(ExportRequest req);
    }

    /// <summary>
    /// Revit-ийн экспортын АЛДААГ тогтсон код руу хөрвүүлнэ.  Нэг файлын алдаа бүхэл гаргалтыг
    /// унагаах ёсгүй тул бүгдийг энд барьж `ExportOutcome` болгоно.
    /// ⚠️ `OperationCanceledException`-г БАРИХГҮЙ (цуцлалт өөр замаар).
    /// </summary>
    internal static class ExportErrors
    {
        internal static ExportOutcome From(Exception ex)
        {
            if (ex is Autodesk.Revit.Exceptions.FileAccessException)
                return ExportOutcome.Fail(PublishFailureCode.OutputLocked, "Файл өөр програмд нээлттэй эсвэл түгжигдсэн байна.", ex, retryable: true, called: true);
            if (ex is Autodesk.Revit.Exceptions.InvalidPathArgumentException || ex is Autodesk.Revit.Exceptions.DirectoryNotFoundException)
                return ExportOutcome.Fail(PublishFailureCode.DestinationMissing, "Гаргах хавтас олдсонгүй.", ex, retryable: true, called: true);
            if (ex is Autodesk.Revit.Exceptions.OptionalFunctionalityNotAvailableException)
                return ExportOutcome.Fail(PublishFailureCode.FormatModuleUnavailable, "Энэ форматын экспортын модуль Revit-д суугаагүй байна.", ex, called: true);
            if (ex is Autodesk.Revit.Exceptions.ModificationOutsideTransactionException || ex is Autodesk.Revit.Exceptions.ModificationForbiddenException)
                return ExportOutcome.Fail(PublishFailureCode.ModelNotEditable, "Загвар одоо өөрчлөгдөх боломжгүй байна (failure mode эсвэл ачаалж байна).", ex, retryable: true, called: true);
            if (ex is Autodesk.Revit.Exceptions.InvalidOperationException)
                return ExportOutcome.Fail(PublishFailureCode.ExportException, "Revit одоо экспорт хийх боломжгүй байна (background process, edit mode г.м.).", ex, retryable: true, called: true);
            if (ex is Autodesk.Revit.Exceptions.ArgumentException)
                return ExportOutcome.Fail(PublishFailureCode.ExportRejected, "Revit экспортын тохиргоо/харагдацыг хүлээж авсангүй.", ex, called: true);
            if (ex is System.UnauthorizedAccessException || ex is System.IO.IOException)
                return ExportOutcome.Fail(PublishFailureCode.DestinationNotWritable, "Гаргах хавтсанд бичих боломжгүй байна.", ex, retryable: true, called: true);
            return ExportOutcome.Fail(PublishFailureCode.ExportException, "Экспортын үеэр алдаа гарлаа.", ex, retryable: true, called: true);
        }
    }

    /* ====================================================================== */
    /*  PDF                                                                   */
    /* ====================================================================== */

    /// <summary>
    /// `PdfSettings` → `PDFExportOptions`.  Enum-ууд нь Revit-ийн enum-ын НЭРЭЭР (мөр) хадгалагдсан
    /// тул танигдаагүй нэр → Revit-ийн анхдагч + `invalid` жагсаалтад нэмж preflight сануулга.
    /// </summary>
    internal static class PdfOptionsBuilder
    {
        internal static void Validate(PdfSettings s, List<string> invalid)
        {
            Apply(new PDFExportOptions(), s, invalid);
        }

        internal static void Apply(PDFExportOptions o, PdfSettings s, List<string> invalid)
        {
            invalid = invalid ?? new List<string>();

            o.AlwaysUseRaster = s.AlwaysUseRaster;
            o.StopOnError = s.StopOnError;
            o.HideScopeBoxes = s.HideScopeBoxes;
            o.HideCropBoundaries = s.HideCropBoundaries;
            o.HideReferencePlane = s.HideReferencePlanes;
            o.HideUnreferencedViewTags = s.HideUnreferencedViewTags;
            o.ViewLinksInBlue = s.ViewLinksInBlue;
            o.ReplaceHalftoneWithThinLines = s.ReplaceHalftoneWithThinLines;
            o.MaskCoincidentLines = s.MaskCoincidentLines;

            ExportPaperFormat pf;
            if (TryEnum("PaperFormat", s.PaperFormat, invalid, out pf)) o.PaperFormat = pf;
            PageOrientationType po;
            if (TryEnum("Orientation", s.Orientation, invalid, out po)) o.PaperOrientation = po;
            PaperPlacementType pp;
            if (TryEnum("Placement", s.Placement, invalid, out pp)) o.PaperPlacement = pp;
            ZoomType zt;
            if (TryEnum("ZoomType", s.ZoomType, invalid, out zt)) o.ZoomType = zt;
            ColorDepthType cd;
            if (TryEnum("ColorDepth", s.ColorDepth, invalid, out cd)) o.ColorDepth = cd;
            RasterQualityType rq;
            if (TryEnum("RasterQuality", s.RasterQuality, invalid, out rq)) o.RasterQuality = rq;
            PDFExportQualityType eq;
            if (!string.IsNullOrWhiteSpace(s.ExportQuality) && TryEnum("ExportQuality", s.ExportQuality, invalid, out eq)) o.ExportQuality = eq;

            if (s.ZoomPercent >= 10 && s.ZoomPercent <= 3200) o.ZoomPercentage = s.ZoomPercent;
            else invalid.Add("ZoomPercent=" + s.ZoomPercent + " (10–3200 байх ёстой)");
        }

        private static bool TryEnum<T>(string label, string value, List<string> invalid, out T result) where T : struct
        {
            result = default(T);
            if (string.IsNullOrWhiteSpace(value)) return false;   // тохируулаагүй = Revit-ийн анхдагч
            if (Enum.TryParse(value.Trim(), true, out result) && Enum.IsDefined(typeof(T), result)) return true;
            invalid.Add(label + "=" + value);
            return false;
        }
    }

    /// <summary>
    /// PDF: ХУУДАС ТУТМЫГ тусад нь `Combine = true` + `FileName = манай нэр`-ээр экспортлоно.
    ///
    /// ЯАГААД: Revit-ийн өөрийн нэрлэлт (`SetNamingRule`) нь параметрийн ЗӨВХӨН жагсаалт —
    /// манай нэршлийн загвар (`[...]`, засагч, огноо, Монгол) түүгээр илэрхийлэгдэхгүй.  Нэг
    /// харагдацтай нэгтгэсэн экспорт нь нэрийг ЯГ тодорхойлж, хуудас тутмын алдааг тусгаарлаж,
    /// прогресс (14/87) өгдөг.  `Combine = false` профайл нь олон хуудсыг НЭГ PDF-д (`MemberIds`) гаргана.
    ///
    /// ⚠️ `Document.Export` нь ЯМАР НЭГ харагдац бүтэлгүйтвэл `false` буцаадаг ч зарим файл
    /// аль хэдийн үүссэн байж болно — `ExportOutcome.RevitSaidTrue` ба файлын шалгалтыг ХОЁУЛАНГ нь
    /// дараа нь `PublishRunner` үнэлнэ.
    /// ⚠️ `SetExportInBackground(false)` — background экспорт бол `Export` буцахад файл БАЙХГҮЙ байж
    /// болох тул ДАРААХ файлын шалгалт худал «алга» гэж гарна.
    /// </summary>
    internal sealed class PdfExportAdapter : IExportAdapter
    {
        public PublishFormat Format { get { return PublishFormat.Pdf; } }

        public ExportOutcome Export(ExportRequest req)
        {
            if (req.ViewIds.Count == 0)
                return ExportOutcome.Fail(PublishFailureCode.ItemNotFound, "Экспортлох харагдац олдсонгүй.");
            try
            {
                var opts = new PDFExportOptions { Combine = true, FileName = req.Artifact.FileBaseName };
                var invalid = new List<string>();
                PdfOptionsBuilder.Apply(opts, req.Profile.Pdf ?? new PdfSettings(), invalid);
                try { opts.SetExportInBackground(false); }
                catch (Autodesk.Revit.Exceptions.InvalidOperationException) { /* background тохиргоо хориотой горим — синхрон хэвээр */ }

                bool ok = req.Doc.Export(req.Artifact.Folder, new List<ElementId>(req.ViewIds), opts);
                return new ExportOutcome { Called = true, RevitSaidTrue = ok };
            }
            catch (Exception ex) when (!(ex is OperationCanceledException))
            {
                return ExportErrors.From(ex);
            }
        }
    }

    /* ====================================================================== */
    /*  DWG                                                                   */
    /* ====================================================================== */

    /// <summary>
    /// DWG: компанийн ӨМНӨ ТОДОРХОЙЛОГДСОН setup-ыг (`GetPredefinedOptions`) ЯГ хэвээр хэрэглэнэ —
    /// ЧИМЭЭГҮЙ ӨӨРЧЛӨХГҮЙ.  Зөвхөн профайл «харагдацуудыг нэгтгэх»-ийг ил асаасан үед л
    /// `MergedViews` тавина.
    /// </summary>
    internal sealed class DwgExportAdapter : IExportAdapter
    {
        public PublishFormat Format { get { return PublishFormat.Dwg; } }

        public ExportOutcome Export(ExportRequest req)
        {
            if (req.ViewIds.Count == 0)
                return ExportOutcome.Fail(PublishFailureCode.ItemNotFound, "Экспортлох харагдац олдсонгүй.");
            try
            {
                DwgSettings s = req.Profile.Dwg ?? new DwgSettings();
                DWGExportOptions opts;
                if (string.IsNullOrWhiteSpace(s.SetupName))
                {
                    opts = new DWGExportOptions();
                }
                else
                {
                    opts = DWGExportOptions.GetPredefinedOptions(req.Doc, s.SetupName.Trim());
                    if (opts == null)
                        return ExportOutcome.Fail(PublishFailureCode.DwgSetupInvalid, "DWG тохиргоо «" + s.SetupName + "» олдсонгүй.");
                }
                if (s.MergedViews) opts.MergedViews = true;

                bool ok = req.Doc.Export(req.Artifact.Folder, req.Artifact.FileBaseName, new List<ElementId>(req.ViewIds), opts);
                return new ExportOutcome { Called = true, RevitSaidTrue = ok };
            }
            catch (Exception ex) when (!(ex is OperationCanceledException))
            {
                return ExportErrors.From(ex);
            }
        }
    }

    /* ====================================================================== */
    /*  IFC                                                                   */
    /* ====================================================================== */

    /// <summary>
    /// IFC: ЗАГВАРЫН түвшний экспорт (хуудас биш).  Revit нь IFC экспортод НЭЭЛТТЭЙ ТРАНЗАКЦ
    /// ШААРДДАГ (`Document.Export(IFC)`: «there must be a transaction already open»), иймд түр
    /// транзакц нээгээд ЗААВАЛ ROLLBACK хийнэ — загвар өөрчлөгдөхгүй, undo-н түүх бохирдохгүй
    /// (`PdfViewExportCommand`-ийн өмнөх жишээтэй ижил).
    /// </summary>
    internal sealed class IfcExportAdapter : IExportAdapter
    {
        public PublishFormat Format { get { return PublishFormat.Ifc; } }

        public ExportOutcome Export(ExportRequest req)
        {
            IfcSettings s = req.Profile.Ifc ?? new IfcSettings();
            try
            {
                var opts = new IFCExportOptions
                {
                    ExportBaseQuantities = s.ExportBaseQuantities,
                    WallAndColumnSplitting = s.SplitWallsAndColumns,
                    SpaceBoundaryLevel = Math.Max(0, Math.Min(2, s.SpaceBoundaryLevel)),
                };

                IFCVersion ver;
                if (!string.IsNullOrWhiteSpace(s.Version) && Enum.TryParse(s.Version.Trim(), true, out ver) && Enum.IsDefined(typeof(IFCVersion), ver))
                    opts.FileVersion = ver;

                if (!string.IsNullOrWhiteSpace(s.FilterViewName))
                {
                    View3D view = new FilteredElementCollector(req.Doc).OfClass(typeof(View3D)).Cast<View3D>()
                        .FirstOrDefault(v => !v.IsTemplate && string.Equals(v.Name, s.FilterViewName.Trim(), StringComparison.OrdinalIgnoreCase));
                    if (view == null)
                        return ExportOutcome.Fail(PublishFailureCode.ItemNotFound, "IFC-ийн шүүлтүүр харагдац олдсонгүй.");
                    opts.FilterViewId = view.Id;
                }

                foreach (KeyValuePair<string, string> kv in s.ExtraOptions ?? new Dictionary<string, string>())
                    if (!string.IsNullOrWhiteSpace(kv.Key)) opts.AddOption(kv.Key.Trim(), kv.Value ?? "");

                bool ok;
                // IFC-ийн түр (rollback хийгдэх) транзакцийн DocumentChanged-г «Өөрчлөлтийн нөлөө» бүртгэлд ОРУУЛАХГҮЙ —
                // загвар өөрчлөгдөөгүй тул хуурамч өөрчлөлт («нөлөөлөл») үүсгэх ёсгүй.
                using (ChangeImpact.ImpactCapture.Suppress())
                using (var tx = new Transaction(req.Doc, "MGL Smart Publish — IFC"))
                {
                    tx.Start();
                    try
                    {
                        ok = req.Doc.Export(req.Artifact.Folder, req.Artifact.FileBaseName, opts);
                    }
                    finally
                    {
                        // ⚠️ ҮРГЭЛЖ rollback: экспорт амжилттай ч, алдаатай ч загварыг өөрчлөхгүй.
                        if (tx.GetStatus() == TransactionStatus.Started) tx.RollBack();
                    }
                }
                return new ExportOutcome { Called = true, RevitSaidTrue = ok };
            }
            catch (Exception ex) when (!(ex is OperationCanceledException))
            {
                return ExportErrors.From(ex);
            }
        }
    }
}
