using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Selection;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.ChangeImpact.Ui;
using RevitMcpAddin.Smart;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// «Өөрчлөхөөс өмнө» ribbon команд — ЯМАР Ч ЦЭС, СОНГОЛТГҮЙ.
    ///
    ///   • Revit-д элемент (хана, хаалга, багана, шал, суваг, тавилга… ЯМАР Ч төрөл) СОНГООД дарвал шууд simulation цонх нээгдэнэ.
    ///   • Юу ч сонгоогүй бол Revit-ийн статус мөрөнд «Зөөх элементээ сонгоно уу» гэж асууж зураг дээр дарууд сонгуулна (диалог БИШ), дараа нь цонх нээгдэнэ.
    ///   • Цонх нээгдсэн бол (хаалга, хана гэж ялгахгүй) элементийг ХУЛГАНААР БАРЬЖ чирнэ — тоо бичих, товч дарах шаардлагагүй (`SimWindow`).
    /// Командын өөрөө загварыг ӨӨРЧИЛӨХГҮЙ — зөвхөн цонхны «Зөвшөөрөх» товч (хэрэглэгч шууд баталсны дараа, нэг Undo).
    ///
    /// Хуучин хана, хаалганы БҮТЭН шалгалтын цонхнууд (хуудас, хүснэгт, гарц…) цонхны «…» цэснээс хүрэгдэнэ (`OpenFullCheck`).
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class PreChangeCommand : IExternalCommand
    {
        private const string DialogTitle = "MGL — Өөрчлөхөөс өмнө";

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            // ⚠️ ЛИЦЕНЗ: зөвхөн компанийн бүртгэлээр, ажлын компьютер дээр — Licensing/LicenseGate.cs (хөндөгдөөгүй).
            if (!global::RevitMcpAddin.Licensing.LicenseGate.Ensure()) return Result.Cancelled;
            UIDocument uidoc = commandData.Application.ActiveUIDocument;
            if (uidoc == null || uidoc.Document == null) return Result.Cancelled;
            Document doc = uidoc.Document;
            if (doc.IsFamilyDocument)
            {
                TaskDialog.Show(DialogTitle, "Нөлөөллийн шалгалт нь зөвхөн төслийн (project) файлд ажиллана — Family биш.");
                return Result.Cancelled;
            }
            if (!SmartExecutor.IsReady)
            {
                TaskDialog.Show(DialogTitle, "MGL Smart гарц эхлээгүй байна — Revit-ийг дахин асаана уу.");
                return Result.Failed;
            }

            try
            {
                IList<long> ids = uidoc.Selection.GetElementIds().Select(i => i.Value).ToList();
                if (ids.Count == 0)
                {
                    // Диалог БИШ: Revit-ийн статус мөрөнд заавартай, зураг дээр дарж сонгоно (Esc = цуцлах).
                    try
                    {
                        Reference r = uidoc.Selection.PickObject(ObjectType.Element, new PickFilter(), "Зөөх элементээ сонгоно уу — ямар ч элемент (Esc = цуцлах)");
                        if (r == null) return Result.Cancelled;
                        ids = new List<long> { r.ElementId.Value };
                    }
                    catch (Autodesk.Revit.Exceptions.OperationCanceledException) { return Result.Cancelled; }
                }

                var session = new RevitSimSession(doc, ids);
                bool created = false;
                SimWindow w = SmartWindows.ShowModeless(SmartWindows.IdentityOf(doc), () => { created = true; return new SimWindow(session, OpenFullCheck); });
                if (!created) w.SwitchTo(ids);          // цонх аль хэдийн нээлттэй — шинэ сонголтыг ачаална
                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                SmartLog.Error("sim", "open_failed", ex);
                TaskDialog.Show(DialogTitle, "Цонхыг нээж чадсангүй (" + ex.GetType().Name + ").");
                return Result.Failed;
            }
        }

        /// <summary>Зөөж болох 3D элементийг л сонгуулна (тайлбар, түвшин, тор, өрөө, линк instance биш).</summary>
        private sealed class PickFilter : ISelectionFilter
        {
            public bool AllowElement(Element e) { return !(e is RevitLinkInstance) && SimKinds.IsModelBody(e); }
            public bool AllowReference(Reference reference, XYZ position) { return false; }
        }

        /// <summary>Revit thread-ээс UI thread руу дамжих бага зэргийн үр дүн (identity + хуучин session).</summary>
        private sealed class FullCheckHandle
        {
            public string Identity;
            public RevitPreChangeSession Session;
        }

        /// <summary>
        /// Хуучин БҮТЭН шалгалтын цонх (хана / хаалга: өрөө, хэмжээс, хуудас, гарц, MEP, нормын тэмдэглэл) — simulation цонхны «…» цэснээс.
        /// Revit API-д `SmartExecutor`-оор л хүрнэ; цонхыг UI thread-д нээнэ.
        /// </summary>
        internal static async void OpenFullCheck(PreChangeOperationKind kind)
        {
            try
            {
                FullCheckHandle opened = await SmartExecutor.Run(app =>
                {
                    UIDocument ui = app.ActiveUIDocument;
                    Document doc = ui != null ? ui.Document : null;
                    if (doc == null || doc.IsFamilyDocument) return (FullCheckHandle)null;
                    return new FullCheckHandle { Identity = SmartWindows.IdentityOf(doc), Session = new RevitPreChangeSession(doc) };
                }, default(System.Threading.CancellationToken), "prechange.open.full");
                if (opened == null) return;
                RevitPreChangeSession s = opened.Session;
                if (kind == PreChangeOperationKind.DoorMove)
                    SmartWindows.ShowModeless(opened.Identity, () => new DoorMoveWindow(s, s));
                else
                    SmartWindows.ShowModeless(opened.Identity, () => new PreChangeWindow(s));
            }
            catch (Exception ex)
            {
                SmartLog.Error("sim", "open_full_failed", ex);
            }
        }
    }
}
