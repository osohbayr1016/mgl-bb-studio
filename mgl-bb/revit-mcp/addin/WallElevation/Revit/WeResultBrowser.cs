using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows.Interop;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.UI;
using RevitMcpAddin.Ui;
using RevitMcpAddin.Ui.Core;
using RevitMcpAddin.WallElevation.Core;
using RevitMcpAddin.WallElevation.Ui;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// ҮР ДҮНГИЙН ХӨТӨЧ-ийн Revit хост (W06, 2026-10-16) — цонх нь <see cref="WeResultView"/> (Revit-гүй, UI smoke-д шалгагдана), энд индекс уншиж
    /// (<see cref="WeResultReader"/>: ES таних тэмдэг + бодит viewport — гараар зөөсөн, нэрийг сольсон, устгасан, хуудаснаас авсан, Revit дахин асаасан
    /// ч зөв) үйлдлийг ExternalEvent-ээр гүйцэтгэнэ: хуудас / харагдац нээх, viewport сонгох, Project Browser-т олох (Revit-ийн дэмжсэн замаар —
    /// Browser Organization-ийг ӨӨРЧЛӨХГҮЙ, шүүлтүүрт нуугдвал тайлбарлаад эндээс нээнэ), планд харуулах.  2026-10-14-ний «хуудас шалгах» самбарыг
    /// орлоно.  Ажил дуусахад хэрэглэгч ӨӨР зураг дээр ажиллаж байвал НЭЭГДЭХГҮЙ (фокус булаахгүй) — ажлын самбарын «Үр дүн» товчоор.
    /// </summary>
    internal static class WeResultBrowser
    {
        public const string WindowTitle = WeResultView.WindowTitle;
        /// <summary>Байрлал — Revit-ийн цонхны баруун доод булангаас (dx, dy), <see cref="WeFloatPlacement"/>.  Абсолют хадгалалтыг байрлалд ашиглахгүй.</summary>
        private const string PlacementKey = "wall-elevation-results.relative";
        private static WeResultView _open;

        /// <summary>
        /// Нээнэ (Revit API контекстод).  <paramref name="onlyRooms"/> = эдгээр өрөө (null = баримтын бүх үүсгэсэн дэлгээс); <paramref name="run"/> =
        /// сүүлийн ажиллагааны мөрүүд (null = мэдэгдэхгүй); <paramref name="activate"/> = фокус авах (хэрэглэгч ИЛ хүссэн / эхэлсэн зураг дээрээ хүлээж
        /// байсан); <paramref name="openFirstSheet"/> = эхний хуудсыг нээх.  Өмнөх цонх нээлттэй бол солино.
        /// </summary>
        internal static void Open(UIApplication app, Document doc, ICollection<string> onlyRooms, List<WeResultRunInfo> run, ElementId planId,
                                  bool activate, bool openFirstSheet)
        {
            try
            {
                if (_open != null) { try { _open.Close(); } catch { } _open = null; }
                var host = new Host(doc, onlyRooms, run, planId);
                host.Reload();
                if (host.View.Rooms.Count == 0)
                {
                    if (activate) TaskDialog.Show("MGL — Ханын дэлгээс", "Энэ баримтад «Ханын дэлгээс»-ээр үүсгэсэн харагдац алга.");
                    host.Dispose();
                    return;
                }
                WeResultView w = host.View;
                w.ShowActivated = activate;
                try { new WindowInteropHelper(w).Owner = app.MainWindowHandle; } catch { }
                // Зургийг халхлахгүй: Revit-ийн цонхны БАРУУН ДООД булангаас харьцангуй (хэрэглэгч зөөсөн бол тэр зайгаар) — абсолют дэлгэцийн
                // байрлал Revit-ийн цонх жижиг байхад хадгалагдаж, бүтэн дэлгэц болоход зургийн голд гарч товшилтыг булааж байв (live gate 2026-10-16).
                IntPtr owner = app.MainWindowHandle;
                try
                {
                    MglNative.MonitorInfo mon = MglNative.ForOwner(owner);
                    if (mon != null && mon.OwnerDip.HasValue)
                    {
                        UiRect o = mon.OwnerDip.Value, wa = mon.WorkAreaDip, rel;
                        double[] at = MglUiPrefs.Load().TryGetWindow(PlacementKey, out rel)
                            ? WeFloatPlacement.FromRelative(o.Left, o.Top, o.Width, o.Height, rel.Left, rel.Top)
                            : WeFloatPlacement.Default(o.Left, o.Top, o.Width, o.Height, w.Width, w.Height);
                        at = WeFloatPlacement.Clamp(at[0], at[1], w.Width, w.Height, wa.Left, wa.Top, wa.Width, wa.Height);
                        w.Left = at[0];
                        w.Top = at[1];
                    }
                }
                catch { }
                w.Closing += (s, e) =>
                {
                    try
                    {
                        MglNative.MonitorInfo mon = MglNative.ForOwner(owner);
                        if (mon == null || !mon.OwnerDip.HasValue || w.WindowState != System.Windows.WindowState.Normal) return;
                        UiRect o = mon.OwnerDip.Value;
                        double[] rel = WeFloatPlacement.ToRelative(o.Left, o.Top, o.Width, o.Height, w.Left, w.Top);
                        MglUiPrefs.Update(p => p.SetWindow(PlacementKey, new UiRect(rel[0], rel[1], w.ActualWidth, w.ActualHeight)));
                    }
                    catch { }
                };
                _open = w;
                w.Closed += (s, e) => { if (ReferenceEquals(_open, w)) _open = null; };
                w.Show();
                WeLog.Info("review", "үр дүнгийн самбар нээгдэв: " + WeResultIndex.Summary(w.Rooms) + (activate ? string.Empty : " (фокусгүй)"));
                if (openFirstSheet) w.OpenCurrentReviewSheet();
            }
            catch (Exception ex) { WeLog.Error("review", "үр дүнгийн самбар нээх", ex); }
        }

        /// <summary>Цонх ↔ Revit: индекс уншиж, үйлдлийг ExternalEvent-ээр.</summary>
        private sealed class Host : IExternalEventHandler
        {
            public readonly WeResultView View = new WeResultView();
            private readonly Document _doc;
            private readonly ICollection<string> _onlyRooms;
            private readonly List<WeResultRunInfo> _run;
            private readonly ElementId _planId;
            private readonly ExternalEvent _event;
            private WeResultAction _pending;
            private WeResultTarget _target = new WeResultTarget();

            public Host(Document doc, ICollection<string> onlyRooms, List<WeResultRunInfo> run, ElementId planId)
            {
                _doc = doc;
                _onlyRooms = onlyRooms;
                _run = run ?? new List<WeResultRunInfo>();
                _planId = planId ?? ElementId.InvalidElementId;
                _event = ExternalEvent.Create(this);
                View.ActionRequested += (a, t) =>
                {
                    _pending = a;
                    _target = t ?? new WeResultTarget();
                    try { _event.Raise(); } catch (Exception ex) { WeLog.Info("review", "ExternalEvent — " + ex.Message); }
                };
            }

            public void Dispose()
            {
                try { View.Close(); } catch { }
            }

            /// <summary>Индексийг баримтаас дахин уншина (Revit API контекстод).</summary>
            public void Reload()
            {
                int skipped;
                List<WeResultViewInfo> views = WeResultReader.Read(_doc, _onlyRooms, out skipped);
                List<WeResultRoom> rooms = WeResultIndex.Build(views, _run, uid => WeResultReader.RoomLabel(_doc, uid), _onlyRooms);
                View.SetIndex(rooms, id => { var s = _doc.GetElement(new ElementId(id)) as ViewSheet; return s != null ? s.Name : null; }, skipped);
            }

            public string GetName() { return "MGL — Ханын дэлгээс: үр дүн"; }

            public void Execute(UIApplication app)
            {
                try
                {
                    UIDocument uidoc = app.ActiveUIDocument;
                    if (_pending == WeResultAction.Closed)
                    {
                        WeRoomOverlay.Hide();
                        WeRoomOverlay.Refresh(uidoc);
                        WeRoomOverlay.Shutdown();
                        return;
                    }
                    if (!_doc.IsValidObject) { View.Say("Файл хаагдсан."); return; }
                    if (_pending == WeResultAction.Refresh)
                    {
                        Reload();
                        View.Say("Баримтаас дахин уншив.");
                        return;
                    }
                    if (uidoc == null || !uidoc.Document.Equals(_doc)) { View.Say("«" + _doc.Title + "» файлыг идэвхтэй болгоод дахин дарна уу."); return; }
                    switch (_pending)
                    {
                        case WeResultAction.OpenSheet:
                        {
                            var sh = _doc.GetElement(new ElementId(_target.SheetId)) as ViewSheet;
                            if (sh == null) { View.Say("Хуудас олдсонгүй (устгасан байж магадгүй) — «Шинэчлэх»."); return; }
                            uidoc.RequestViewChange(sh);
                            View.Say("Хуудас «" + sh.SheetNumber + " — " + sh.Name + "».");
                            return;
                        }
                        case WeResultAction.OpenView:
                        {
                            var v = _doc.GetElement(new ElementId(_target.ViewId)) as global::Autodesk.Revit.DB.View;
                            if (v == null) { View.Say("Харагдац олдсонгүй (устгасан байж магадгүй) — «Шинэчлэх»."); return; }
                            uidoc.RequestViewChange(v);
                            View.Say("«" + v.Name + "».");
                            return;
                        }
                        case WeResultAction.SelectViewport:
                            SelectViewport(uidoc);
                            return;
                        case WeResultAction.Locate:
                            View.Say(Locate(app, uidoc));
                            return;
                        case WeResultAction.ShowInPlan:
                            ShowInPlan(uidoc);
                            return;
                    }
                }
                catch (Exception ex)
                {
                    WeLog.Error("review", "үйлдэл " + _pending, ex);
                    View.Say("Алдаа: " + ex.Message);
                }
            }

            private void SelectViewport(UIDocument uidoc)
            {
                var sh = _doc.GetElement(new ElementId(_target.SheetId)) as ViewSheet;
                var vp = _doc.GetElement(new ElementId(_target.ViewportId)) as Viewport;
                if (sh == null || vp == null || vp.SheetId != sh.Id) { View.Say("Viewport одоо тэр хуудсанд алга — «Шинэчлэх»."); return; }
                // Хэрэглэгчийн ИЛ үйлдэл — хуудсыг идэвхтэй болгоод (синхрон) viewport-ийг сонгож томруулна.
                if (uidoc.ActiveView == null || uidoc.ActiveView.Id != sh.Id) uidoc.ActiveView = sh;
                uidoc.Selection.SetElementIds(new List<ElementId> { vp.Id });
                try { uidoc.ShowElements(vp.Id); } catch { }
                View.Say("«" + sh.SheetNumber + "» хуудсан дээрх viewport сонгогдлоо.");
            }

            /// <summary>
            /// Project Browser-т олох — Revit-ийн ДЭМЖСЭН замаар: Project Browser-ийг харуулна (DockablePane), Browser Organization-ийн шүүлтүүрийг
            /// шалгана (<c>AreFiltersSatisfied</c>), харагдацыг сонголтод тавина (Revit Project Browser-т тэр мөрийг сонгосон харуулна — Revit-ийн
            /// хувилбар бүрт live шалгана) ба хавтасны замыг хэлнэ.  Шүүлтүүрт нуугдвал тайлбарлаад эндээс НЭЭНЭ.  Browser Organization-ийг өөрчлөхгүй.
            /// </summary>
            private string Locate(UIApplication app, UIDocument uidoc)
            {
                long id = _target.ViewId != 0 ? _target.ViewId : _target.SheetId;
                var v = _doc.GetElement(new ElementId(id)) as global::Autodesk.Revit.DB.View;
                if (v == null) return "Олдсонгүй (устгасан байж магадгүй) — «Шинэчлэх».";
                bool isSheet = v is ViewSheet;
                try
                {
                    DockablePane pb = app.GetDockablePane(DockablePanes.BuiltInDockablePanes.ProjectBrowser);
                    if (pb != null && !pb.IsShown()) pb.Show();
                }
                catch (Exception ex) { WeLog.Info("review", "Project Browser харуулах — " + ex.Message); }
                BrowserOrganization org = null;
                try { org = isSheet ? BrowserOrganization.GetCurrentBrowserOrganizationForSheets(_doc) : BrowserOrganization.GetCurrentBrowserOrganizationForViews(_doc); }
                catch { }
                bool shown = true;
                string path = null;
                if (org != null)
                {
                    try { shown = org.AreFiltersSatisfied(v.Id); } catch { shown = true; }
                    try
                    {
                        IList<FolderItemInfo> folders = org.GetFolderItems(v.Id);
                        if (folders != null && folders.Count > 0) path = string.Join(" › ", folders.Select(f => string.IsNullOrEmpty(f.Name) ? "???" : f.Name));
                    }
                    catch { }
                }
                string name = isSheet ? ((ViewSheet)v).SheetNumber + " — " + v.Name : v.Name;
                string where = (isSheet ? "Sheets" : "Views") + (string.IsNullOrEmpty(path) ? string.Empty : " › " + path) + " › " + name;
                if (!shown)
                {
                    uidoc.RequestViewChange(v);
                    WeLog.Info("review", "Project Browser: «" + name + "» шүүлтүүрт нуугдсан (" + (org != null ? org.Name : "-") + ")");
                    return "Project Browser-ийн «" + (org != null ? org.Name : "?") + "» зохион байгуулалтын шүүлтүүр энэ " + (isSheet ? "хуудсыг" : "харагдацыг")
                           + " нууж байна — тэнд харагдахгүй.  Эндээс нээв (Browser Organization-ийг өөрчлөөгүй).";
                }
                try { uidoc.Selection.SetElementIds(new List<ElementId> { v.Id }); }
                catch (Exception ex)
                {
                    WeLog.Info("review", "Project Browser сонголт — " + ex.Message);
                    return "Project Browser-т сонгож чадсангүй (" + ex.Message + ").  Байршил: " + where;
                }
                WeLog.Info("review", "Project Browser: «" + name + "» сонголтод · " + where);
                return "Сонголтод тавив — Project Browser-т тодорно.  Байршил: " + where;
            }

            private void ShowInPlan(UIDocument uidoc)
            {
                RevitLinkInstance link;
                Room room = WeRoomRef.Resolve(_doc, _target.RoomUid, out link);
                if (room == null) { View.Say("«" + _target.What + "» — өрөө олдсонгүй (link ачаалагдаагүй эсвэл устсан)."); return; }
                Transform tf = WeRoomRef.TransformOf(link);
                ViewPlan plan = _doc.GetElement(_planId) as ViewPlan;
                double roomZ = tf.OfPoint(new XYZ(0, 0, room.Level != null ? WeAnnoSourceReader.LevelZ(room.Level) : 0)).Z;
                if (plan == null || plan.GenLevel == null || Math.Abs(WeAnnoSourceReader.LevelZ(plan.GenLevel) - roomZ) > 600 / 304.8)
                    plan = new FilteredElementCollector(_doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
                        .Where(x => !x.IsTemplate && x.ViewType == ViewType.FloorPlan && x.GenLevel != null
                                    && Math.Abs(WeAnnoSourceReader.LevelZ(x.GenLevel) - roomZ) <= 600 / 304.8)
                        .OrderBy(x => x.Name, StringComparer.Ordinal).FirstOrDefault();
                if (plan == null) { View.Say("Өрөөний давхрын план олдсонгүй."); return; }
                if (uidoc.ActiveView == null || uidoc.ActiveView.Id != plan.Id) uidoc.ActiveView = plan;

                // Тодруулга: жагсаалтын бүх өрөө (цэнхэр) + одоогийнх (улбар шар).
                double z = WeAnnoSourceReader.LevelZ(plan.GenLevel) + 50 / 304.8, band = 1.2 / 304.8 * Math.Max(1, plan.Scale);
                var all = new WeOverlayLayer { R = 0x1E, G = 0x6F, B = 0xD9, Transparency = 0.82 };
                var allBand = new WeOverlayLayer { R = 0x1E, G = 0x6F, B = 0xD9, Transparency = 0.15 };
                var cur = new WeOverlayLayer { R = 0xF2, G = 0x7A, B = 0x1A, Transparency = 0.7 };
                var curBand = new WeOverlayLayer { R = 0xF2, G = 0x7A, B = 0x1A, Transparency = 0 };
                WeHoverRoom curRoom = null;
                foreach (string uid in View.Rooms.Select(r => r.RoomUid).Where(u => !string.IsNullOrEmpty(u)).Distinct())
                {
                    RevitLinkInstance li;
                    Room r = WeRoomRef.Resolve(_doc, uid, out li);
                    WeHoverRoom hr = r != null ? RoomOutline(r, WeRoomRef.TransformOf(li), z) : null;
                    if (hr == null) continue;
                    bool isCur = uid == _target.RoomUid;
                    if (isCur) curRoom = hr;
                    WeHoverGeometry.Fill(hr, isCur ? cur : all);
                    WeHoverGeometry.Band(hr, isCur ? band * 1.5 : band, isCur ? curBand : allBand);
                }
                WeRoomOverlay.Show(_doc, plan.Id, new List<WeOverlayLayer> { all, allBand, cur, curBand });
                UIView ui = uidoc.GetOpenUIViews().FirstOrDefault(u => u.ViewId == plan.Id);
                if (ui != null && curRoom != null)
                {
                    double m = Math.Max(curRoom.MaxX - curRoom.MinX, curRoom.MaxY - curRoom.MinY) * 0.6 + 2;
                    ui.ZoomAndCenterRectangle(new XYZ(curRoom.MinX - m, curRoom.MinY - m, z), new XYZ(curRoom.MaxX + m, curRoom.MaxY + m, z));
                }
                WeRoomOverlay.Refresh(uidoc);
                View.Say("«" + _target.What + "» план дээр тодорлоо.");
            }

            private static WeHoverRoom RoomOutline(Room r, Transform tf, double z)
            {
                try
                {
                    var hr = new WeHoverRoom();
                    foreach (IList<BoundarySegment> loop in r.GetBoundarySegments(new SpatialElementBoundaryOptions { SpatialElementBoundaryLocation = SpatialElementBoundaryLocation.Finish }) ?? new List<IList<BoundarySegment>>())
                    {
                        var pts = new List<WeV3>();
                        foreach (BoundarySegment s in loop)
                        {
                            IList<XYZ> t = s.GetCurve().Tessellate();
                            for (int i = 0; i + 1 < t.Count; i++) { XYZ p = tf.OfPoint(t[i]); pts.Add(new WeV3(p.X, p.Y, z)); }
                        }
                        if (pts.Count >= 3) hr.Loops.Add(pts);
                    }
                    if (hr.Loops.Count == 0) return null;
                    hr.Grow();
                    return hr;
                }
                catch { return null; }
            }
        }
    }
}
