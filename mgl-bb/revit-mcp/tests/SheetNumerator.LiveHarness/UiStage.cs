using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Autodesk.Revit.UI;
using RevitMcpAddin.SheetNumerator.Core;
using RevitMcpAddin.SheetNumerator.Revit;
using RevitMcpAddin.SheetNumerator.Ui;

namespace SnLive
{
    /// <summary>Баталгаа/алдааны цонхыг ХЭЗЭЭ Ч нээхгүй (Revit-ийг гацаахгүй), бүх дуудлагыг бүртгэнэ.</summary>
    internal sealed class AutoPrompts : IUserPrompts
    {
        public readonly List<string> Log = new List<string>();
        public string TextAnswer;

        public bool Confirm(string title, string message, bool destructive)
        {
            Log.Add("confirm: " + message.Replace("\n", " / "));
            return true;
        }

        public string AskText(string title, string prompt, string initial)
        {
            Log.Add("asktext: " + prompt + " (" + initial + ") → " + TextAnswer);
            return TextAnswer;
        }

        public void ShowError(string title, string message, string detail)
        {
            Log.Add("ERROR: " + message.Replace("\n", " / ") + (string.IsNullOrEmpty(detail) ? string.Empty : " || " + detail.Replace("\n", " / ")));
        }

        public void ShowInfo(string title, string message)
        {
            Log.Add("info: " + message.Replace("\n", " / "));
        }
    }

    /// <summary>
    /// ИДЭВХТЭЙ БИШ (арай дэвсгэрт нээсэн) document дээр шууд (ExternalEvent-гүй, синхрон) ажиллах gateway —
    /// жишээ төслийг идэвхжүүлэлгүй БОДИТ цонхоор шалгахад.  Revit давхаргын сервисүүд (Capture/Apply/Rename/Delete/Probe)
    /// нь үйлдвэрлэлийн кодтой ЯГ ИЖИЛ.
    /// </summary>
    internal sealed class DocGateway : ISheetNumeratorGateway
    {
        private readonly Autodesk.Revit.DB.Document _doc;
        private readonly string _version;

        public DocGateway(Autodesk.Revit.DB.Document doc, string version)
        {
            _doc = doc;
            _version = version;
        }

        public System.Threading.Tasks.Task<SnapshotResult> LoadAsync()
        {
            return System.Threading.Tasks.Task.FromResult(SheetSnapshotService.Capture(_doc, _version, 0));
        }

        public System.Threading.Tasks.Task<ApplyResult> ApplyAsync(ApplyRequest request)
        {
            return System.Threading.Tasks.Task.FromResult(RenumberApplyService.Apply(_doc, request));
        }

        public System.Threading.Tasks.Task<OperationResult> RenameAsync(RenameRequest request)
        {
            return System.Threading.Tasks.Task.FromResult(SheetEditService.Rename(_doc, request));
        }

        public System.Threading.Tasks.Task<OperationResult> DeleteAsync(DeleteRequest request)
        {
            return System.Threading.Tasks.Task.FromResult(SheetEditService.Delete(_doc, null, request));
        }

        public System.Threading.Tasks.Task<DocumentStamp> ReadStampAsync()
        {
            return System.Threading.Tasks.Task.FromResult(SheetSnapshotService.ReadStamp(_doc));
        }

        public System.Threading.Tasks.Task<MarkerCapabilities> ProbeMarkersAsync()
        {
            return System.Threading.Tasks.Task.FromResult(UnicodeProbe.Probe(_doc));
        }

        public string LogPath
        {
            get { return SheetNumeratorLog.LogPath; }
        }
    }

    /// <summary>
    /// БОДИТ цонх + БОДИТ ExternalEvent bridge-ийг Revit дотор шалгах шат дамжлагат хэрэгсэл.  Тус бүр тусдаа
    /// `run_revit_code`-оос дуудагдана: Revit-ийн ExternalEvent нь одоогийн handler дуусмагц л ажилладаг тул
    /// ЭНД хүлээж БОЛОХГҮЙ.
    ///
    /// Гурван горим:
    ///   • `Open` — идэвхтэй document + БОДИТ ExternalEvent bridge (үйлдвэрлэлийн зам).
    ///   • `OpenOnDoc` — дэвсгэрт нээсэн (идэвхгүй) жишээ төсөл + синхрон <see cref="DocGateway"/>.
    ///   • `CommandExecute` — ribbon-ы `SheetNumeratorCommand.Execute`-ийг БОДИТООР дуудна.
    /// </summary>
    public static class UiStage
    {
        private static SheetNumeratorBridge _bridge;
        private static SheetNumeratorWindow _window;
        private static SheetNumeratorViewModel _vm;
        private static AutoPrompts _prompts;
        private static string _outDir;
        private static Autodesk.Revit.DB.Document _doc;

        public static string Open(UIApplication app, string outDir)
        {
            _outDir = outDir;
            Directory.CreateDirectory(outDir);
            SheetNumeratorLog.PathOverride = Path.Combine(outDir, "ui-sheet-numerator.log");
            RevitInfo.Set(app.Application.VersionNumber);
            if (_window != null)
                return "аль хэдийн нээлттэй";

            _bridge = SheetNumeratorBridge.Create();
            _prompts = new AutoPrompts();
            _vm = new SheetNumeratorViewModel(_bridge, _prompts, new SheetNumeratorPrefs())
            {
                ErrorLogger = (op, ex) => File.AppendAllText(Path.Combine(outDir, "ui-errors.log"), op + ": " + ex + Environment.NewLine),
            };
            _window = new SheetNumeratorWindow(_vm);
            try
            {
                new WindowInteropHelper(_window).Owner = app.MainWindowHandle;
            }
            catch (Exception ex)
            {
                File.AppendAllText(Path.Combine(outDir, "ui-errors.log"), "owner: " + ex + Environment.NewLine);
            }
            _window.Closed += (s, e) =>
            {
                try { if (_bridge != null) _bridge.Dispose(); } catch (Exception) { }
                _bridge = null;
                _window = null;
                _vm = null;
            };
            _window.Show();
            return "нээгдлээ (async ачаалалт ExternalEvent-ээр дараа нь)";
        }

        /// <summary>Жишээ төслийг ДЭВСГЭРТ нээж (идэвхжүүлэхгүй), түүн дээр шууд ажиллах БОДИТ цонх нээнэ.</summary>
        public static string OpenOnDoc(UIApplication app, string outDir, string samplePath)
        {
            _outDir = outDir;
            Directory.CreateDirectory(outDir);
            SheetNumeratorLog.PathOverride = Path.Combine(outDir, "ui-doc-sheet-numerator.log");
            RevitInfo.Set(app.Application.VersionNumber);
            if (_window != null)
                return "аль хэдийн нээлттэй";

            var dialogs = new List<string>();
            EventHandler<Autodesk.Revit.UI.Events.DialogBoxShowingEventArgs> onDlg = (s, e) =>
            {
                dialogs.Add(e.GetType().Name + " id=" + e.DialogId);
                var t = e as Autodesk.Revit.UI.Events.TaskDialogShowingEventArgs;
                if (t != null)
                    t.OverrideResult((int)TaskDialogResult.Close);
            };
            app.DialogBoxShowing += onDlg;
            try
            {
                _doc = app.Application.OpenDocumentFile(Autodesk.Revit.DB.ModelPathUtils.ConvertUserVisiblePathToModelPath(samplePath),
                    new Autodesk.Revit.DB.OpenOptions { Audit = false });
            }
            finally
            {
                app.DialogBoxShowing -= onDlg;
            }

            _prompts = new AutoPrompts();
            _vm = new SheetNumeratorViewModel(new DocGateway(_doc, app.Application.VersionNumber), _prompts, new SheetNumeratorPrefs())
            {
                ErrorLogger = (op, ex) => File.AppendAllText(Path.Combine(outDir, "ui-errors.log"), op + ": " + ex + Environment.NewLine),
            };
            _window = new SheetNumeratorWindow(_vm);
            try
            {
                new WindowInteropHelper(_window).Owner = app.MainWindowHandle;
            }
            catch (Exception ex)
            {
                File.AppendAllText(Path.Combine(outDir, "ui-errors.log"), "owner: " + ex + Environment.NewLine);
            }
            _window.Closed += (s, e) =>
            {
                _window = null;
                _vm = null;
            };
            _window.Show();
            return "нээгдлээ: " + _doc.Title + (dialogs.Count > 0 ? " · dialog: " + string.Join("; ", dialogs) : string.Empty);
        }

        /// <summary>`OpenOnDoc`-ийн document-ийг ХАДГАЛАЛГҮЙ хаана (цонх хаагдсаны дараа).</summary>
        public static string CloseDoc()
        {
            if (_window != null)
                return "эхлээд цонхыг хаа";
            if (_doc == null)
                return "document нээгээгүй";
            try
            {
                if (_doc.IsValidObject)
                    _doc.Close(false);
                _doc = null;
                return "document хаагдлаа (хадгалаагүй)";
            }
            catch (Exception ex)
            {
                return "document хаахад алдаа: " + ex.Message;
            }
        }

        /// <summary>`OpenOnDoc`-ийн document-ийн хуудасны дугаарууд.</summary>
        public static string DocNumbers()
        {
            if (_doc == null)
                return "document нээгээгүй";
            return string.Join(" | ", new Autodesk.Revit.DB.FilteredElementCollector(_doc).OfClass(typeof(Autodesk.Revit.DB.ViewSheet))
                .Cast<Autodesk.Revit.DB.ViewSheet>().OrderBy(s => s.SheetNumber, StringComparer.Ordinal).Select(s => s.SheetNumber + "=" + s.Name));
        }

        public static string State()
        {
            if (_vm == null)
                return "цонх нээгдээгүй";
            var sb = new StringBuilder();
            sb.AppendLine("HasDocument=" + _vm.HasDocument + " title=" + _vm.DocumentTitle + " busy=" + _vm.IsBusy + " stale=" + _vm.IsStale
                + " CanApply=" + _vm.CanApply + " dirty=" + _vm.IsOrderDirty);
            sb.AppendLine("group: " + _vm.GroupHeader + " · ShowTree=" + _vm.ShowTree);
            sb.AppendLine("status [" + _vm.StatusState + "]: " + _vm.StatusText);
            if (_vm.HasBanner)
                sb.AppendLine("banner: " + _vm.BannerText.Replace("\n", " / "));
            sb.AppendLine("selected: " + string.Join(",", _vm.SelectedIds));
            sb.AppendLine("tree: " + string.Join("; ", _vm.TreeRoots.SelectMany(r => r.Flatten()).Select(n => n.Title + (n.IsSelected ? "*" : ""))));
            foreach (SheetRowViewModel r in _vm.Rows)
                sb.AppendLine("  row " + r.SheetId + ": " + r.CurrentNumber + " → " + (r.NumberWillChange ? r.NewNumberDisplay : "(өөрчлөлтгүй)")
                    + " | " + r.NameDisplay + " | " + r.State + " " + r.StatusText);
            sb.AppendLine("window: visible=" + (_window != null && _window.IsVisible) + " " + (_window != null ? _window.ActualWidth + "x" + _window.ActualHeight : ""));
            foreach (string p in _prompts.Log)
                sb.AppendLine("  prompt: " + p);
            return sb.ToString();
        }

        public static string Set(string key, string value)
        {
            if (_vm == null)
                return "цонх нээгдээгүй";
            switch (key)
            {
                case "prefix": _vm.SimplePrefix = value; break;
                case "suffix": _vm.SimpleSuffix = value; break;
                case "start": _vm.SimpleStartText = value; break;
                case "width": _vm.SimpleWidthText = value; break;
                case "tab": _vm.NumberingTabIndex = int.Parse(value); break;
                case "move": _vm.MoveRenumber = value == "1"; break;
                case "allinone": _vm.IsAllInOneMode = value == "1"; break;
                case "nameend": _vm.NameAtEnd = value == "1"; break;
                case "namestart": _vm.NameAtStart = value == "1"; break;
                case "namesep": _vm.NameSeparator = value; break;
                case "moveup": _vm.MoveUpCommand.Execute(null); break;
                case "movedown": _vm.MoveDownCommand.Execute(null); break;
                case "movetop": _vm.MoveTopCommand.Execute(null); break;
                case "reset": _vm.ResetOrderCommand.Execute(null); break;
                case "select": _vm.SetSelection(value.Split(',').Select(long.Parse)); break;
                case "recompute": _vm.Recompute(); break;
                case "group":
                {
                    // «Эцэг/Хүүхэд» зам (мод дахь гүн-түрүүлэх дараалал: эцэг түүний хүүхдүүдийн ЯГ өмнө).
                    var flat = _vm.TreeRoots.SelectMany(r => r.Flatten()).ToList();
                    string[] path = value.Split('/');
                    int from = 0;
                    GroupNodeViewModel node = null;
                    foreach (string seg in path)
                    {
                        int idx = -1;
                        for (int i = from; i < flat.Count; i++)
                        {
                            if (flat[i].Title == seg)
                            {
                                idx = i;
                                break;
                            }
                        }
                        if (idx < 0)
                            return "бүлэг олдсонгүй: " + value + " (" + seg + ")";
                        node = flat[idx];
                        from = idx + 1;
                    }
                    node.IsSelected = true;
                    break;
                }
                case "listparams":
                    return "target: " + string.Join(" | ", _vm.TargetParameterOptions.Select(o => o.Label))
                        + "\nsource: " + string.Join(" | ", _vm.SourceParameterOptions.Select(o => o.Label));
                case "writeresult":
                {
                    ParameterOption o = _vm.TargetParameterOptions.FirstOrDefault(x => x.Label == value) ?? _vm.TargetParameterOptions.FirstOrDefault(x => x.Label.Contains(value));
                    if (o == null)
                        return "параметр олдсонгүй: " + value;
                    _vm.WriteResult = true;
                    _vm.ResultParameter = o;
                    break;
                }
                case "writecount":
                {
                    ParameterOption o = _vm.TargetParameterOptions.FirstOrDefault(x => x.Label == value) ?? _vm.TargetParameterOptions.FirstOrDefault(x => x.Label.Contains(value));
                    if (o == null)
                        return "параметр олдсонгүй: " + value;
                    _vm.WriteGroupCount = true;
                    _vm.CountParameter = o;
                    break;
                }
                case "countall": _vm.CountToAll = value == "1"; break;
                case "tooltip": return _vm.Rows.Count > 0 ? _vm.Rows[0].Tooltip : "(мөргүй)";
                default: return "танигдаагүй түлхүүр: " + key;
            }
            return "ok";
        }

        public static string Apply()
        {
            if (_vm == null)
                return "цонх нээгдээгүй";
            if (!_vm.CanApply)
                return "CanApply=false: " + _vm.StatusText;
            _vm.ApplyCommand.Execute(null);
            return "Apply эхэллээ (async)";
        }

        public static string Refresh()
        {
            if (_vm == null)
                return "цонх нээгдээгүй";
            _vm.RefreshCommand.Execute(null);
            return "refresh";
        }

        public static string Freshness()
        {
            if (_vm == null)
                return "цонх нээгдээгүй";
            var t = _vm.CheckFreshnessAsync();
            return "freshness шалгаж байна (async)";
        }

        public static string Shot(string name)
        {
            if (_window == null)
                return "цонх нээгдээгүй";
            _window.UpdateLayout();
            int w = (int)Math.Ceiling(_window.ActualWidth);
            int h = (int)Math.Ceiling(_window.ActualHeight);
            var bmp = new RenderTargetBitmap(w, h, 96, 96, PixelFormats.Pbgra32);
            bmp.Render(_window);
            var enc = new PngBitmapEncoder();
            enc.Frames.Add(BitmapFrame.Create(bmp));
            string path = Path.Combine(_outDir, name + ".png");
            using (FileStream fs = File.Create(path))
                enc.Save(fs);
            return path + " (" + w + "x" + h + ")";
        }

        public static string Close()
        {
            if (_window == null)
                return "аль хэдийн хаагдсан";
            _window.Close();
            return "хаагдлаа (bridge Dispose → Closed handler)";
        }

        // ── БОДИТ ribbon КОМАНД (IExternalCommand) ──────────────────────
        private static System.Reflection.FieldInfo CommandField(string name)
        {
            return typeof(RevitMcpAddin.SheetNumerator.SheetNumeratorCommand)
                .GetField(name, System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
        }

        /// <summary>
        /// `SheetNumeratorCommand.Execute`-ийг ribbon товч дарсантай ИЖИЛ байдлаар дууддаг (ExternalCommandData-г reflection-оор
        /// үүсгэнэ — Revit API-ийн контекстод).  Цонх нээгдэх, хоёр дахь дуудлага ШИНЭ цонх нээхгүй, хаагдахад bridge суллагдах.
        /// </summary>
        public static string CommandExecute(UIApplication app)
        {
            var data = (ExternalCommandData)Activator.CreateInstance(typeof(ExternalCommandData), true);
            data.Application = app;
            string message = string.Empty;
            var command = new RevitMcpAddin.SheetNumerator.SheetNumeratorCommand();
            Result result = command.Execute(data, ref message, new Autodesk.Revit.DB.ElementSet());
            return "Result=" + result + " message=«" + message + "» · " + CommandInfo();
        }

        /// <summary>Командын статик төлөв: цонх (instance id, харагдах эсэх), bridge.</summary>
        public static string CommandInfo()
        {
            var window = CommandField("_window").GetValue(null) as Window;
            object bridge = CommandField("_bridge").GetValue(null);
            return "window=" + (window == null ? "null" : "#" + System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(window)
                + " loaded=" + window.IsLoaded + " visible=" + window.IsVisible + " state=" + window.WindowState)
                + " · bridge=" + (bridge == null ? "null" : "alive");
        }

        /// <summary>Командын нээсэн цонхыг хаана (Closed handler → bridge Dispose).</summary>
        public static string CommandClose()
        {
            var window = CommandField("_window").GetValue(null) as Window;
            if (window == null)
                return "цонх нээгдээгүй";
            window.Close();
            return "хаагдлаа · " + CommandInfo();
        }

        /// <summary>Командын цонхонд (bridge-ээр БОДИТ) ачаалагдсан төлөв: ViewModel-ийг DataContext-оос авна.</summary>
        public static string CommandWindowState()
        {
            var window = CommandField("_window").GetValue(null) as Window;
            if (window == null)
                return "цонх нээгдээгүй";
            var vm = window.DataContext as SheetNumeratorViewModel;
            if (vm == null)
                return "DataContext ViewModel биш";
            return "HasDocument=" + vm.HasDocument + " title=" + vm.DocumentTitle + " rows=" + vm.Rows.Count + " groupHeader=" + vm.GroupHeader
                + " status=[" + vm.StatusState + "] " + vm.StatusText + " empty=«" + vm.EmptyHint + "»";
        }

        // ── Идэвхтэй document солих (ExternalEvent-ээр: `run_revit_code`-ын нээлттэй Transaction-оос ГАДУУР) ──
        private sealed class SwitchHandler : IExternalEventHandler
        {
            public string Path;
            public string Result = "(хараахан үгүй)";

            public void Execute(UIApplication app)
            {
                try
                {
                    app.OpenAndActivateDocument(Path);
                    Result = "ok: " + app.ActiveUIDocument.Document.Title;
                }
                catch (Exception ex)
                {
                    Result = "ERROR: " + ex.Message;
                }
            }

            public string GetName()
            {
                return "SnLive document switch";
            }
        }

        private static SwitchHandler _switchHandler;
        private static ExternalEvent _switchEvent;

        /// <summary>Document-ийг нээж (нээлттэй бол) идэвхжүүлэхийг хойшлуулна — үр дүн `SwitchResult()`-д.  Цонхны «document солигдсон» шалгалтад.</summary>
        public static string ActivateLater(UIApplication app, string path)
        {
            if (_switchHandler == null)
            {
                _switchHandler = new SwitchHandler();
                _switchEvent = ExternalEvent.Create(_switchHandler);
            }
            _switchHandler.Path = path;
            _switchHandler.Result = "pending";
            _switchEvent.Raise();
            return "raised";
        }

        public static string SwitchResult()
        {
            return _switchHandler == null ? "(үгүй)" : _switchHandler.Result;
        }

        /// <summary>Идэвхтэй document-ийн хуудасны дугаарууд (шалгалтад).</summary>
        public static string ActiveNumbers(UIApplication app)
        {
            var doc = app.ActiveUIDocument.Document;
            return string.Join(" | ", new Autodesk.Revit.DB.FilteredElementCollector(doc).OfClass(typeof(Autodesk.Revit.DB.ViewSheet))
                .Cast<Autodesk.Revit.DB.ViewSheet>().OrderBy(s => s.SheetNumber, StringComparer.Ordinal).Select(s => s.SheetNumber + "=" + s.Name));
        }
    }
}
