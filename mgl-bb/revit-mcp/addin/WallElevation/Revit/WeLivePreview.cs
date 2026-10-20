using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// Цонхны доод талын урьдчилсан ЗУРАГ (2026-10-14, эзэн: «чагт, ханын үсгийг өөрчлөхөд доорх дэлгээс өөрчлөгдөж миний хүссэн зүйл
    /// мөн эсэхийг үүсгэхээс өмнө шалгана»).  Хуурамч зураг БИШ — ЖИНХЭНЭ үүсгэх замыг (<see cref="ElevationGenerationCoordinator"/>:
    /// харагдац, тэмдэглэгээ, цэгцлэх) нэг дэлгээсэд ажиллуулж PNG болгоод бүх өөрчлөлтийг БУЦААНА (гадна <see cref="TransactionGroup"/>
    /// .RollBack — Undo жагсаалтад юу ч үлдэхгүй).  ХЭМЖСЭН (gate DIAG-CROP-AT-LEVEL, Revit 2024): нээлттэй TransactionGroup дотор
    /// <c>ExportImage</c> ажилладаг.  Хуудас, түлхүүр план, 3D, тэмдэг нуух — ҮГҮЙ (зөвхөн тэр дэлгээс).  Шинэчлэх шаардлагагүй (Keep)
    /// дэлгээсийг үүсгэхгүйгээр шууд экспортлоно.
    /// 2026-10-14 (интерьерийн баг, 2-р тойрог): «preview бэлдэх нь арын дэвсгэрт, цонх огт гацахгүй» — ажил АЛХАМ АЛХМААР
    /// (<see cref="Start"/>, <see cref="IWePreviewJob"/>): цонх алхам бүрийн хооронд хэрэглэгчийн оролтыг боловсруулна, сонголт солигдвол
    /// дуусаагүй ажлыг шууд цуцалж буцаана.
    /// </summary>
    internal sealed class WeLivePreview
    {
        private readonly Document _doc;
        private readonly WeRequest _req;
        private readonly IWeUnits _units;
        private readonly string _dir;
        private int _n;
        private Job _active;

        public WeLivePreview(Document doc, WeRequest req, IWeUnits units)
        {
            _doc = doc;
            _req = req;
            _units = units;
            _dir = Path.Combine(Path.GetTempPath(), "MGL", "we-preview", Process.GetCurrentProcess().Id.ToString(System.Globalization.CultureInfo.InvariantCulture));
            try { if (Directory.Exists(_dir)) foreach (string f in Directory.GetFiles(_dir, "*.png")) TryDelete(f); } catch { }
        }

        /// <summary>СИНХРОН (шалгалт, хуучин дуудагч): бүх алхмыг дараалан.</summary>
        public WePreviewResult Render(WePlannedElevation item, WeSettings settings)
        {
            using (IWePreviewJob j = Start(item, settings))
            {
                for (int guard = 0; guard < 100000 && !j.Done; guard++) j.Step();
                return j.Result;
            }
        }

        /// <summary>
        /// Алхам алхмаар: гадна <see cref="TransactionGroup"/> ажил дуусах эсвэл цуцлагдах хүртэл нээлттэй, төгсгөлд ҮРГЭЛЖ RollBack.
        /// Нэг зэрэг ГАНЦ ажил — шинэ ажил эхлэхэд өмнөх дуусаагүй нь цуцлагдана (нээлттэй бүлэг давхардахгүй).
        /// </summary>
        public IWePreviewJob Start(WePlannedElevation item, WeSettings settings)
        {
            CancelAll();
            _active = new Job(this, item, settings);
            return _active;
        }

        /// <summary>Цонх хаагдсаны дараа (workflow): дуусаагүй ажил үлдсэн бол буцаана — загварт юу ч үлдэхгүй.</summary>
        public void CancelAll()
        {
            Job j = _active;
            _active = null;
            if (j != null) j.Dispose();
        }

        private sealed class Job : IWePreviewJob
        {
            private readonly WeLivePreview _o;
            private readonly WePlannedElevation _item;
            private readonly WeSettings _settings;
            private readonly Stopwatch _sw = Stopwatch.StartNew();
            private TransactionGroup _tg;
            private ElevationGenerationCoordinator _coord;
            private WeRunResult _run;
            private int _state;   // 0 бэлтгэл · 1 үүсгэх алхмууд · 2 экспорт
            private int _steps;

            public Job(WeLivePreview o, WePlannedElevation item, WeSettings settings)
            {
                _o = o;
                _item = item;
                _settings = settings;
                Status = "бэлтгэж байна";
            }

            public bool Done { get; private set; }
            public string Status { get; private set; }
            public WePreviewResult Result { get; private set; }

            public double Fraction
            {
                get
                {
                    if (Done) return 1;
                    if (_state == 0) return 0.02;
                    if (_state == 2) return 0.95;
                    return _coord != null ? 0.05 + 0.85 * _coord.Fraction : 0.05;
                }
            }

            public void Step()
            {
                if (Done) return;
                try
                {
                    switch (_state)
                    {
                        case 0:
                            Begin();
                            break;
                        case 1:
                            _coord.Step();
                            _steps++;
                            if (!string.IsNullOrEmpty(_coord.Status)) Status = _coord.Status;
                            if (_coord.Done)
                            {
                                _state = 2;
                                Status = "зураг экспортлож байна";
                            }
                            break;
                        default:
                            ExportAndFinish();
                            break;
                    }
                }
                catch (Exception ex)
                {
                    WeLog.Error("preview", _item != null ? _item.Name : "?", ex);
                    Finish(null, ex.Message);
                }
            }

            private void Begin()
            {
                Document doc = _o._doc;
                if (_item == null) { Finish(null, "дэлгээс сонгоогүй"); return; }
                if (doc.IsReadOnly || doc.IsModifiable) { Finish(null, "баримт одоо засварлах боломжгүй"); return; }
                Directory.CreateDirectory(_o._dir);

                if (_item.Action == WeAction.Keep && _item.ExistingViewId != 0)
                {
                    string kept = _o.Export(new ElementId(_item.ExistingViewId));
                    Finish(kept, kept == null ? "одоо байгаа дэлгээсийг экспортлож чадсангүй" : null);
                    return;
                }

                WeSettings ps = _settings.Clone();
                ps.Output = WeOutputMode.ViewsOnly;
                ps.KeyPlan = false;
                ps.Axon = false;
                ps.HideOtherMarkers = false;
                ps.HideOwnMarkersOnSheets = false;
                ps.ReviewPanel = false;
                _tg = new TransactionGroup(doc, "MGL — Ханын дэлгээс (урьдчилсан зураг)");
                _tg.Start();
                // Нөөц (төрөл, загвар) ДАХИН — өмнөх урьдчилсан зургийн буцаагдсан элементийн id-г барихгүйн тулд.
                WeResources res = WeResources.Collect(doc);
                WePlan plan = WallElevationPlanner.Plan(_o._req, new WePlanContext { Settings = ps, Units = _o._units, ViewSetupToken = res.SetupToken(ps) });
                WePlannedElevation mine = plan.Items.FirstOrDefault(i => i.Key == _item.Key);
                if (mine == null) { Finish(null, "энэ дэлгээс төлөвлөгөөнд алга"); return; }
                WallElevationPlanner.ApplyExclusions(plan, plan.Items.Where(i => i.Key != _item.Key).Select(i => i.Key).ToList());
                _coord = new ElevationGenerationCoordinator(doc, new SectionElevationViewFactory(), res, ps, _o._units);
                _run = _coord.Begin(plan, new WeTimings());
                _state = _coord.Done ? 2 : 1;
                Status = !string.IsNullOrEmpty(_coord.Status) ? _coord.Status : "харагдац үүсгэж байна";
            }

            private void ExportAndFinish()
            {
                WeRunItem done = _run != null ? _run.Items.FirstOrDefault(i => i.Plan.Key == _item.Key) : null;
                ElementId vid = done != null ? done.ViewId : null;
                if (vid == null || vid == ElementId.InvalidElementId || !(_o._doc.GetElement(vid) is View))
                {
                    Finish(null, done != null && !string.IsNullOrEmpty(done.Message) ? done.Message : "дэлгээс үүссэнгүй");
                    return;
                }
                string path = _o.Export(vid);
                Finish(path, path == null ? "зургийг экспортлож чадсангүй" : null);
            }

            /// <summary>ТӨГСГӨЛ: түр өөрчлөлтийг БУЦААНА (амжилттай, алдаа — хоёуланд).</summary>
            private void Finish(string path, string error)
            {
                if (Done) return;
                Done = true;
                RollBack();
                Result = new WePreviewResult { Path = error == null ? path : null, Error = error, Ms = _sw.ElapsedMilliseconds };
                Status = error ?? "бэлэн";
                if (ReferenceEquals(_o._active, this)) _o._active = null;
                WeLog.Info("preview", (_item != null ? _item.Name : "?") + " · " + Result.Ms + " мс · " + _steps + " алхам" + (error != null ? " · " + error : string.Empty));
            }

            private void RollBack()
            {
                TransactionGroup tg = _tg;
                _tg = null;
                if (tg == null) return;
                try { if (tg.HasStarted() && !tg.HasEnded()) tg.RollBack(); }
                catch (Exception ex) { WeLog.Error("preview", "буцаах", ex); }
                try { tg.Dispose(); } catch { }
            }

            /// <summary>Цуцлах (сонголт/тохиргоо солигдсон, цонх хаагдсан): дуусаагүй бол буцаана.</summary>
            public void Dispose()
            {
                if (ReferenceEquals(_o._active, this)) _o._active = null;
                if (Done)
                {
                    RollBack();
                    return;
                }
                Done = true;
                RollBack();
                Result = new WePreviewResult { Error = "цуцалсан", Ms = _sw.ElapsedMilliseconds };
                Status = "цуцалсан";
                WeLog.Info("preview", (_item != null ? _item.Name : "?") + " · цуцалсан (" + _steps + " алхмын дараа)");
            }
        }

        private string Export(ElementId viewId)
        {
            string stem = "p" + (++_n).ToString(System.Globalization.CultureInfo.InvariantCulture);
            var o = new ImageExportOptions
            {
                ExportRange = ExportRange.SetOfViews,
                FilePath = Path.Combine(_dir, stem),
                ZoomType = ZoomFitType.FitToPage,
                PixelSize = 1600,
                ImageResolution = ImageResolution.DPI_150,
                HLRandWFViewsFileType = ImageFileType.PNG,
                ShadowViewsFileType = ImageFileType.PNG,
                FitDirection = FitDirectionType.Horizontal,
            };
            o.SetViewsAndSheets(new List<ElementId> { viewId });
            _doc.ExportImage(o);
            return Directory.GetFiles(_dir, stem + "*.png").Select(f => new FileInfo(f)).OrderByDescending(f => f.LastWriteTimeUtc).Select(f => f.FullName).FirstOrDefault();
        }

        private static void TryDelete(string f)
        {
            try { File.Delete(f); } catch { }
        }
    }
}
