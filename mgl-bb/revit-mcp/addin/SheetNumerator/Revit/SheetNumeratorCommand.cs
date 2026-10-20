using System;
using System.Windows;
using System.Windows.Interop;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.SheetNumerator.Core;
using RevitMcpAddin.SheetNumerator.Ui;

namespace RevitMcpAddin.SheetNumerator
{
    /// <summary>
    /// «Хуудас дугаарлах» ribbon команд (2026-10-01) — МОДАЛЬГҮЙ (modeless) цонхыг нээнэ.
    ///
    ///  • НЭГ instance: цонх нээлттэй байхад дахин дарвал шинээр нээхгүй, байгааг нь урд гаргана.
    ///  • Модельд хүрэх БҮХ зам `SheetNumeratorBridge` (ExternalEvent) — цонхны event handler нь Revit API-ийн
    ///    хүчинтэй контекст БИШ.  ExternalEvent-ийг ЭНД (команд = хүчинтэй контекст) үүсгэнэ.
    ///  • Цонх хаагдахад bridge (ExternalEvent) Dispose хийгдэнэ.
    ///
    /// Бүх логик `SheetNumerator/Core` (Revit-гүй, тесттэй), харагдац `Ui`, Revit-тэй харьцах нь `Revit`.
    /// </summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class SheetNumeratorCommand : IExternalCommand
    {
        private const string DialogTitle = "MGL — Хуудас дугаарлах";

        private static SheetNumeratorWindow _window;
        private static Revit.SheetNumeratorBridge _bridge;

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            // ⚠️ ЛИЦЕНЗ (1.9.0): зөвхөн компанийн бүртгэлээр, ажлын компьютер дээр — Licensing/LicenseGate.cs.
            if (!global::RevitMcpAddin.Licensing.LicenseGate.Ensure()) return Result.Cancelled;
            try
            {
                UIApplication uiapp = commandData.Application;
                App.RememberMainWindow(uiapp.MainWindowHandle);
                Revit.RevitInfo.Set(uiapp.Application.VersionNumber);

                // Нэг instance: байвал идэвхжүүлнэ.  ⚠️ `IsLoaded` БИШ `_window != null`-оор шалгана: `Show()`-ийн дараа `Loaded` нь
                // дараа нь (dispatcher) ирдэг тул хурдан давхар дуудлага (ribbon дээр хоёр товш) хоёр дахь цонх нээж, эхнийхийн
                // bridge-ийг Dispose хийх байсан.  `Closed` нь `_window`-ийг null болгодог тул хаагдсан цонх «байгаа» гэж тоологдохгүй.
                if (_window != null)
                {
                    try
                    {
                        if (_window.WindowState == WindowState.Minimized)
                            _window.WindowState = WindowState.Normal;
                        _window.Activate();
                        return Result.Succeeded;
                    }
                    catch (Exception ex)
                    {
                        // Эвдэрсэн (хаагдах үеийн) цонх — цэвэрлээд шинээр нээнэ.
                        Revit.SheetNumeratorLog.Error("open", "Байгаа цонхыг идэвхжүүлж чадсангүй — шинээр нээнэ", ex);
                        _window = null;
                        DisposeBridge();
                    }
                }

                UIDocument uidoc = uiapp.ActiveUIDocument;
                if (uidoc == null || uidoc.Document == null)
                    return Result.Cancelled;
                if (uidoc.Document.IsFamilyDocument)
                {
                    TaskDialog.Show(DialogTitle, "Хуудас зөвхөн төслийн файлд байдаг (family биш).");
                    return Result.Cancelled;
                }

                // Хуучин bridge үлдсэн бол (цонх хаагдахгүйгээр алдагдсан) цэвэрлэнэ.
                DisposeBridge();

                _bridge = Revit.SheetNumeratorBridge.Create();
                var prompts = new Revit.RevitUserPrompts();
                SheetNumeratorPrefs prefs = Revit.SheetNumeratorPrefsStore.Load();
                var vm = new SheetNumeratorViewModel(_bridge, prompts, prefs)
                {
                    ErrorLogger = (op, ex) => Revit.SheetNumeratorLog.Error(op, "Цонхны үйлдэл унав", ex),
                };

                var window = new SheetNumeratorWindow(vm);
                prompts.Owner = window;
                window.PersistRequested += Revit.SheetNumeratorPrefsStore.Save;

                // Эзэн = Revit-ийн үндсэн цонх: эзэнгүй цонх Revit-ийн ард орж алга болдог (App.ShowOwned-ийн тайлбар).
                try
                {
                    if (App.MainWindowHandle != IntPtr.Zero)
                        new WindowInteropHelper(window).Owner = App.MainWindowHandle;
                }
                catch (Exception ex)
                {
                    Revit.SheetNumeratorLog.Error("open", "Цонхны эзнийг тавьж чадсангүй — эзэнгүй нээнэ", ex);
                }

                window.Closed += (s, e) =>
                {
                    _window = null;
                    DisposeBridge();
                };

                _window = window;
                window.Show();
                Revit.SheetNumeratorLog.Info("open", "цонх нээгдлээ · " + uidoc.Document.Title);
                return Result.Succeeded;
            }
            catch (Exception ex)
            {
                Revit.SheetNumeratorLog.Error("open", "Команд эхлэхэд алдаа", ex);
                message = ex.Message;
                TaskDialog.Show(DialogTitle, "Цонхыг нээж чадсангүй.\n\nДэлгэрэнгүй мэдээллийг MGL Add-in log-оос шалгана уу:\n" + Revit.SheetNumeratorLog.LogPath);
                _window = null;
                DisposeBridge();
                return Result.Failed;
            }
        }

        private static void DisposeBridge()
        {
            try
            {
                if (_bridge != null)
                    _bridge.Dispose();
            }
            catch (Exception ex)
            {
                Revit.SheetNumeratorLog.Error("close", "Bridge-ийг суллахад алдаа", ex);
            }
            _bridge = null;
        }
    }
}
