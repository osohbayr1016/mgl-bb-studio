using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Events;
using RevitMcpAddin.SheetNumerator.Core;
using RevitMcpAddin.SheetNumerator.Revit;

namespace SnLive
{
    /// <summary>
    /// Revit-ийн ЖИШЭЭ төслийг (бодит хуудас, title block, viewport, schedule, Browser Organization-тай) ӨНГӨЛГӨН
    /// АРАЙД (UI-д идэвхжүүлэхгүй) нээж, snapshot + бүлэглэлт + (сонголтоор) Apply-г шалгана.  Document-ийг
    /// ХАДГАЛАХГҮЙ хаана (`Close(false)`) — жишээ файл ХЭЗЭЭ Ч өөрчлөгдөхгүй.
    /// Revit-ийн модаль цонхыг `DialogBoxShowing`-ээр програмчлан хаана (жагсаалтад бүртгэнэ).
    /// </summary>
    public static class SampleProbe
    {
        public static string Run(UIApplication uiapp, string path, string outDir, bool applyTest)
        {
            Directory.CreateDirectory(outDir);
            var sb = new StringBuilder();
            string report = Path.Combine(outDir, "sample-" + Path.GetFileNameWithoutExtension(path).Replace(' ', '_') + ".txt");
            Action<string> L = s => { sb.AppendLine(s); try { File.AppendAllText(report, s + Environment.NewLine, new UTF8Encoding(false)); } catch (Exception) { } };
            SheetNumeratorLog.PathOverride = Path.Combine(outDir, "sample-sheet-numerator.log");

            var dialogs = new List<string>();
            EventHandler<DialogBoxShowingEventArgs> onDlg = (s, e) =>
            {
                var t = e as TaskDialogShowingEventArgs;
                if (t != null)
                {
                    dialogs.Add("TaskDialog id=" + t.DialogId + " :: " + (t.Message ?? string.Empty).Replace("\n", " / "));
                    t.OverrideResult((int)TaskDialogResult.Close);
                    return;
                }
                var m = e as MessageBoxShowingEventArgs;
                if (m != null)
                {
                    dialogs.Add("MessageBox :: " + (m.Message ?? string.Empty).Replace("\n", " / "));
                    m.OverrideResult(2);
                    return;
                }
                dialogs.Add("Dialog id=" + e.DialogId);
            };

            L("═══ " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " · " + path);
            uiapp.DialogBoxShowing += onDlg;
            Document doc = null;
            try
            {
                BasicFileInfo bfi = BasicFileInfo.Extract(path);
                L("file: workshared=" + bfi.IsWorkshared + " central=" + bfi.IsCentral + " format=" + bfi.Format);

                var opts = new OpenOptions { Audit = false };
                if (bfi.IsWorkshared)
                    opts.DetachFromCentralOption = DetachFromCentralOption.DetachAndPreserveWorksets;

                var sw = Stopwatch.StartNew();
                doc = uiapp.Application.OpenDocumentFile(ModelPathUtils.ConvertUserVisiblePathToModelPath(path), opts);
                L("opened in " + sw.ElapsedMilliseconds + " ms · title=" + doc.Title + " · workshared=" + doc.IsWorkshared);

                // ── Browser Organization ─────────────────────────────
                try
                {
                    foreach (Element e in new FilteredElementCollector(doc).OfClass(typeof(BrowserOrganization)))
                        L("  BrowserOrganization element: «" + e.Name + "» id=" + e.Id.Value);
                }
                catch (Exception ex)
                {
                    L("  (BrowserOrganization element-ээр жагсаах боломжгүй: " + ex.GetType().Name + ")");
                }
                foreach (string kind in new[] { "Views", "Sheets", "Schedules" })
                {
                    try
                    {
                        BrowserOrganization org = kind == "Views" ? BrowserOrganization.GetCurrentBrowserOrganizationForViews(doc)
                            : kind == "Sheets" ? BrowserOrganization.GetCurrentBrowserOrganizationForSheets(doc)
                            : BrowserOrganization.GetCurrentBrowserOrganizationForSchedules(doc);
                        var sortPath = BrowserApi.SortingParameterPath(org);
                        L("  current org [" + kind + "]: «" + org.Name + "» sort=" + string.Join(">", sortPath.Select(x => x.Value)) + " order=" + org.SortingOrder);
                    }
                    catch (Exception ex)
                    {
                        L("  current org [" + kind + "]: " + ex.GetType().Name + " " + ex.Message);
                    }
                }

                // ── Snapshot ─────────────────────────────────────────
                sw.Restart();
                SnapshotResult sr = SheetSnapshotService.Capture(doc, uiapp.Application.VersionNumber, 0);
                long tCap = sw.ElapsedMilliseconds;
                if (!sr.Success)
                {
                    L("Capture АМЖИЛТГҮЙ: " + sr.Error);
                    return sb.ToString();
                }
                DocumentSnapshot snap = sr.Snapshot;
                L("Capture " + tCap + " мс · хуудас=" + snap.Sheets.Count + " · workshared=" + snap.IsWorkshared + " · uniqueness=" + snap.Uniqueness
                    + " · org=«" + snap.Browser.OrganizationName + "» grouping=" + snap.Browser.HasGrouping + " sort=" + snap.Browser.SortParameterName + " desc=" + snap.Browser.SortDescending);
                L("  цуглуулга=" + snap.Collections.Count + " · assembly хуудас=" + snap.Sheets.Count(s => s.IsAssemblySheet) + " · placeholder=" + snap.Sheets.Count(s => s.IsPlaceholder)
                    + " · шүүлтэнд нуугдсан=" + snap.Sheets.Count(s => !s.SatisfiesBrowserFilter));
                L("  параметрийн каталог: " + snap.ParameterCatalog.Count + " (бичих боломжтой текст: " + snap.ParameterCatalog.Count(p => !p.IsReadOnly && p.ValueKind == ParamValueKind.Text) + ")");

                foreach (SheetSnapshot s in snap.Sheets.Take(12))
                    L("  · " + s.Number + " | " + s.Name + " | path=[" + string.Join(" > ", s.BrowserPath.Select(p => p.Name + "#" + p.ParameterId)) + "] sortKey=" + s.SortKey);

                GroupingResult gr = SheetGroupingService.Build(snap, DisplayMode.Grouped, false);
                L("  бүлэглэж харах: " + gr.Groups.Count + " бүлэг");
                foreach (SheetGroup g in gr.Groups.Take(40))
                    L("    [" + g.Key.Kind + "] " + g.Title + " (" + g.Sheets.Count + ")");
                GroupingResult all = SheetGroupingService.Build(snap, DisplayMode.AllInOne, true);
                L("  бүгдийг нэг бүлэгт: " + all.Groups[0].Sheets.Count + " хуудас (нэрээр эрэмбэлсэн эхний 3: "
                    + string.Join(", ", all.Groups[0].Sheets.Take(3).Select(s => s.Name)) + ")");

                // ── Apply (санах ойд; хадгалахгүй) ───────────────────
                if (applyTest)
                {
                    SheetGroup big = gr.Groups.OrderByDescending(g => g.Sheets.Count).First();
                    L("Apply туршилт: бүлэг «" + big.Title + "» (" + big.Sheets.Count + " хуудас)");

                    // 1) Зөөхөд дугаар дагуулах: сүүлийн хуудсыг хамгийн дээш → бүлгийн дугаарууд эргэнэ.
                    var order = new WorkingOrderState(big);
                    order.MoveToTop(new HashSet<long> { big.Sheets[big.Sheets.Count - 1].SheetId });
                    RenumberPlan plan = NumberingEngine.Compute(new NumberingInput
                    {
                        Document = snap, Group = big, WorkingOrder = order.Working, SelectedIndex = -1,
                        Settings = new RenumberSettings { MoveRenumber = true },
                    });
                    L("  plan(Move): өөрчлөгдөх=" + plan.NumberChangedCount + " · блоклох алдаа=" + plan.HasBlockingErrors + " · нийт issue=" + plan.Rows.Sum(r => r.Issues.Count));
                    if (!plan.HasBlockingErrors && plan.NumberChangedCount > 0)
                    {
                        sw.Restart();
                        ApplyResult res = RenumberApplyService.Apply(doc, ApplyRequestBuilder.Build(plan, snap));
                        L("  Apply(Move): " + res.Outcome + " · " + sw.ElapsedMilliseconds + " мс · " + (res.Message ?? "").Replace("\n", " / ") + " " + (res.Detail ?? ""));

                        // Баталгаажуулалт: бодит дугаарууд төлөвлөгөөтэй таарна.
                        int mismatch = 0;
                        foreach (PlannedRow r in plan.Rows.Where(x => x.NumberChanged))
                        {
                            ViewSheet vs = doc.GetElement(new ElementId(r.Sheet.SheetId)) as ViewSheet;
                            if (vs == null || vs.SheetNumber != r.NewNumber)
                                mismatch++;
                        }
                        L("  дугаарын таарцгүй байдал: " + mismatch);

                        // Хоёр дахь Apply (одоо snapshot хуучирсан) → Stale байх ёстой.
                        ApplyResult again = RenumberApplyService.Apply(doc, ApplyRequestBuilder.Build(plan, snap));
                        L("  Apply(хуучирсан хүсэлт): " + again.Outcome);
                    }

                    // 2) Энгийн дугаарлалт + нэрэнд дугаар, ШИНЭ snapshot-оос.
                    SnapshotResult sr2 = SheetSnapshotService.Capture(doc, uiapp.Application.VersionNumber, 0);
                    DocumentSnapshot snap2 = sr2.Snapshot;
                    GroupingResult gr2 = SheetGroupingService.Build(snap2, DisplayMode.Grouped, false);
                    SheetGroup big2 = gr2.Find(big.Key) ?? gr2.Groups.OrderByDescending(g => g.Sheets.Count).First();
                    var s2 = new RenumberSettings { NameAtEnd = true, NameSeparator = " · " };
                    s2.Simple.Prefix = "ZZ-";
                    s2.Simple.Start = 1;
                    s2.Simple.Width = 3;
                    RenumberPlan plan2 = NumberingEngine.Compute(new NumberingInput { Document = snap2, Group = big2, WorkingOrder = big2.Sheets, SelectedIndex = -1, Settings = s2 });
                    L("  plan(Энгийн ZZ-001 + нэр): өөрчлөгдөх=" + plan2.NumberChangedCount + " · нэр=" + plan2.Rows.Count(r => r.NameChanged) + " · блоклох=" + plan2.HasBlockingErrors);
                    if (!plan2.HasBlockingErrors)
                    {
                        sw.Restart();
                        ApplyResult res2 = RenumberApplyService.Apply(doc, ApplyRequestBuilder.Build(plan2, snap2));
                        L("  Apply(Энгийн): " + res2.Outcome + " · " + sw.ElapsedMilliseconds + " мс · " + (res2.Message ?? "").Replace("\n", " / "));
                        PlannedRow first = plan2.Rows.First();
                        ViewSheet vs1 = doc.GetElement(new ElementId(first.Sheet.SheetId)) as ViewSheet;
                        L("  эхний хуудас одоо: " + (vs1 != null ? vs1.SheetNumber + " | " + vs1.Name : "(олдсонгүй)"));
                    }
                }
            }
            catch (Exception ex)
            {
                L("ALDAA: " + ex);
            }
            finally
            {
                foreach (string d in dialogs)
                    L("  [dialog хаагдсан] " + d);
                uiapp.DialogBoxShowing -= onDlg;
                try
                {
                    if (doc != null && doc.IsValidObject)
                    {
                        doc.Close(false);
                        L("document хаагдлаа (хадгалаагүй)");
                    }
                }
                catch (Exception ex)
                {
                    L("document хаахад алдаа: " + ex.Message);
                }
            }
            return sb.ToString();
        }
    }
}
