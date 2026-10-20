using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.AutoAnnotate.Core;
using RevitMcpAddin.Reinforcement;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.AutoAnnotate
{
    /// <summary>Шинжилгээ (цонхонд): энэ харагдацад юу олдсон.</summary>
    internal sealed class AaDatumCropInfo
    {
        public string ViewName = "";
        public int Scale = 100;
        public bool CropActive;
        public bool AnnotationCropActive;
        public int Grids, Levels;

        /// <summary>Сонголтод тэнхлэг/түвшин байвал зөвхөн тэдгээр (тоо), үгүй бол 0.</summary>
        public int SelectedDatums;
    }

    internal sealed class AaDatumCropReport
    {
        public int Grids, Levels;
        public readonly List<string> Skipped = new List<string>();
        public readonly List<string> Errors = new List<string>();
        public readonly List<string> Notes = new List<string>();
        public int Changed { get { return Grids + Levels; } }
    }

    /// <summary>
    /// «Тэнхлэг, түвшин — crop-оос» (2026-10-08): огтлол/дэлгээсийн тэнхлэг (босоо), түвшин (хэвтээ)-ний 2D үзүүрийг crop region-ы хилээс хэрэглэгчийн
    /// цаасан мм-ээр тавина.  ⚠️ ЗӨВХӨН ЭНЭ харагдацад: үзүүр бүрийг <c>DatumExtentType.ViewSpecific</c> болгоод <c>SetCurveInView</c> — 3D (Model) үзүүр,
    /// бусад харагдац ХӨНДӨГДӨХГҮЙ.  Шинэ цэг ХУУЧИН 3D шугам дээр (Revit-ийн «coplanar, parallel» шаардлага).  Бөмбөлгийн тал (End0/End1) хадгалагдана.
    /// Цэвэр тооцоо: <see cref="AaDatumCrop"/>.  Нэг Transaction = нэг Ctrl+Z; datum бүр өөрийн SubTransaction (нэг нь унавал бусад үлдэнэ).
    /// </summary>
    internal static class AaDatumCropService
    {
        public static bool IsSupportedView(View v)
        {
            if (v == null || v.IsTemplate || !(v is ViewSection)) return false;
            try
            {
                return v.ViewType == ViewType.Section || v.ViewType == ViewType.Elevation || v.ViewType == ViewType.Detail;
            }
            catch
            {
                return false;
            }
        }

        public static AaDatumCropInfo Analyze(Document doc, View v, ICollection<ElementId> selection)
        {
            var i = new AaDatumCropInfo { ViewName = v.Name, Scale = v.Scale > 0 ? v.Scale : 100 };
            try { i.CropActive = v.CropBoxActive; } catch { i.CropActive = false; }
            i.AnnotationCropActive = AnnotationCropActive(v);
            List<DatumPlane> all = Candidates(doc, v, selection, out int selected);
            i.SelectedDatums = selected;
            i.Grids = all.Count(d => d is Grid);
            i.Levels = all.Count(d => d is Level);
            return i;
        }

        private static bool AnnotationCropActive(View v)
        {
            try
            {
                Parameter p = v.get_Parameter(BuiltInParameter.VIEWER_ANNOTATION_CROP_ACTIVE);
                return p != null && p.AsInteger() == 1;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>Харагдацад харагдаж буй тэнхлэг, түвшин.  Сонголтод тэнхлэг/түвшин байвал ЗӨВХӨН тэдгээр.</summary>
        public static List<DatumPlane> Candidates(Document doc, View v, ICollection<ElementId> selection, out int selectedDatums)
        {
            selectedDatums = 0;
            var visible = new List<DatumPlane>();
            try
            {
                foreach (Element e in new FilteredElementCollector(doc, v.Id).OfClass(typeof(Grid))) if (e is Grid g) visible.Add(g);
                foreach (Element e in new FilteredElementCollector(doc, v.Id).OfClass(typeof(Level))) if (e is Level l) visible.Add(l);
            }
            catch
            {
                // Уншигдахгүй — хоосон.
            }
            if (selection == null || selection.Count == 0) return visible;
            var sel = new HashSet<long>(selection.Select(id => id.Value));
            List<DatumPlane> picked = visible.Where(d => sel.Contains(d.Id.Value)).ToList();
            selectedDatums = picked.Count;
            return picked.Count > 0 ? picked : visible;
        }

        /// <summary>Crop region-ы хүрээ харагдацын (u, v)-д.  <c>View.CropBox</c>-ийн Min/Max нь өөрийн Transform-ийн координатад (BasisX = баруун, BasisY = дээш).</summary>
        public static AaCropRect CropRect(View v, RfViewFrame frame)
        {
            BoundingBoxXYZ bb = v.CropBox;
            Transform t = bb.Transform ?? Transform.Identity;
            double minU = double.MaxValue, maxU = double.MinValue, minV = double.MaxValue, maxV = double.MinValue;
            foreach (double x in new[] { bb.Min.X, bb.Max.X })
                foreach (double y in new[] { bb.Min.Y, bb.Max.Y })
                {
                    RfV2 q = frame.ToView(RfConv.V(t.OfPoint(new XYZ(x, y, bb.Min.Z))));
                    minU = Math.Min(minU, q.X);
                    maxU = Math.Max(maxU, q.X);
                    minV = Math.Min(minV, q.Y);
                    maxV = Math.Max(maxV, q.Y);
                }
            return new AaCropRect(minU, maxU, minV, maxV);
        }

        /// <summary>⚠️ Нээлттэй Transaction-гүй үед дуудна.</summary>
        public static AaDatumCropReport Apply(Document doc, View v, AaDatumCropOptions o, ICollection<ElementId> selection)
        {
            var rep = new AaDatumCropReport();
            string bad = o.Validate();
            if (bad != null) { rep.Errors.Add(bad); return rep; }
            if (!IsSupportedView(v)) { rep.Errors.Add("Огтлол, дэлгээс (фасад) эсвэл detail харагдац нээнэ үү."); return rep; }
            bool cropOn;
            try { cropOn = v.CropBoxActive; } catch { cropOn = false; }
            if (!cropOn)
            {
                rep.Errors.Add("Энэ харагдацын Crop region идэвхгүй — View Control Bar-аас «Crop View» асаагаад дахин дарна уу (зай нь crop-ийн хилээс хэмжигдэнэ).");
                return rep;
            }

            RfViewFrame frame = RfView.Frame(v);
            AaCropRect crop = CropRect(v, frame);
            if (!crop.Valid) { rep.Errors.Add("Crop region-ы хэмжээг уншиж чадсангүй."); return rep; }
            int scale = v.Scale > 0 ? v.Scale : 100;
            Func<double, double> ft = mm => AaPlacement.ToFt(mm, scale);

            List<DatumPlane> datums = Candidates(doc, v, selection, out _);
            if (datums.Count == 0) { rep.Errors.Add("Энэ харагдацад харагдаж буй тэнхлэг, түвшин олдсонгүй."); return rep; }

            using (var t = new Transaction(doc, "MGL: Тэнхлэг, түвшний үзүүр (crop-оос)"))
            {
                t.Start();
                FailureHandlingOptions fho = t.GetFailureHandlingOptions();
                fho.SetFailuresPreprocessor(new RfWarningSwallower());
                t.SetFailureHandlingOptions(fho);
                foreach (DatumPlane d in datums)
                {
                    bool isGrid = d is Grid;
                    if (isGrid ? !o.Grids : !o.Levels) continue;
                    string who = (isGrid ? "Тэнхлэг «" : "Түвшин «") + SafeName(d) + "»";
                    try
                    {
                        string why = One(doc, v, frame, crop, d, isGrid,
                            isGrid ? ft(o.GridBottomMm) : ft(o.LevelLeftMm),
                            isGrid ? ft(o.GridTopMm) : ft(o.LevelRightMm));
                        if (why == null)
                        {
                            if (isGrid) rep.Grids++; else rep.Levels++;
                        }
                        else
                        {
                            rep.Skipped.Add(who + ": " + why);
                        }
                    }
                    catch (Exception ex)
                    {
                        rep.Skipped.Add(who + ": " + First(ex.Message));
                    }
                }
                if (rep.Changed > 0)
                {
                    TransactionStatus st = t.Commit();
                    if (st != TransactionStatus.Committed)
                    {
                        rep.Errors.Add("Revit өөрчлөлтийг буцаасан (" + st + ").");
                        rep.Grids = rep.Levels = 0;
                    }
                }
                else
                {
                    t.RollBack();
                }
            }
            if (AnnotationCropActive(v) && rep.Changed > 0 && (o.GridBottomMm > 0 || o.GridTopMm > 0 || o.LevelLeftMm > 0 || o.LevelRightMm > 0))
                rep.Notes.Add("Annotation crop асаалттай: crop-оос гадагш гаргасан үзүүр (бөмбөлөг, түвшний тэмдэг) annotation crop-ийн хилээс хэтэрвэл харагдахгүй — "
                    + "Crop Region-ы «Annotation Crop» зайг нэмэх эсвэл annotation crop-ийг унтраана уу.");
            return rep;
        }

        /// <summary>Нэг datum.  null = амжилттай, үгүй бол алгассан шалтгаан (Монгол).  ⚠️ Нээлттэй Transaction дотор.</summary>
        private static string One(Document doc, View v, RfViewFrame frame, AaCropRect crop, DatumPlane d, bool isGrid, double lowFt, double highFt)
        {
            IList<Curve> curves = d.GetCurvesInView(DatumExtentType.ViewSpecific, v);
            if (curves == null || curves.Count != 1) return "харагдацад нэг шугам болж харагдахгүй байна (" + (curves == null ? 0 : curves.Count) + " муруй).";
            Line ln = curves[0] as Line;
            if (ln == null) return "муруй (нуман) тэнхлэг — хөндөөгүй.";
            XYZ p0 = ln.GetEndPoint(0), p1 = ln.GetEndPoint(1);
            RfV2 a = frame.ToView(RfConv.V(p0)), b = frame.ToView(RfConv.V(p1));
            AaDatumPlan plan = AaDatumCrop.Plan(a.X, a.Y, b.X, b.Y, crop, isGrid, lowFt, highFt);
            if (!plan.Ok) return SkipText(plan.Skip, isGrid);

            // Шинэ цэгийг ХУУЧИН 3D шугам дээр: P(s) = P0 + (P1−P0)·s, харагдацын тэнхлэгийн координат шугаман.
            XYZ dir = p1 - p0;
            double rate = isGrid ? b.Y - a.Y : b.X - a.X;
            double s0 = AaDatumCrop.ParamFor(isGrid ? a.Y : a.X, rate, isGrid ? plan.NewStartV : plan.NewStartU);
            double s1 = AaDatumCrop.ParamFor(isGrid ? a.Y : a.X, rate, isGrid ? plan.NewEndV : plan.NewEndU);
            if (!RfTol.IsFiniteNumber(s0) || !RfTol.IsFiniteNumber(s1)) return "шугамын чиглэлийг уншиж чадсангүй.";
            XYZ n0 = p0 + dir.Multiply(s0), n1 = p0 + dir.Multiply(s1);
            if (n0.DistanceTo(p0) < 1e-6 && n1.DistanceTo(p1) < 1e-6) return null; // аль хэдийн байрандаа

            using (var st = new SubTransaction(doc))
            {
                st.Start();
                try
                {
                    if (d.GetDatumExtentTypeInView(DatumEnds.End0, v) != DatumExtentType.ViewSpecific)
                        d.SetDatumExtentType(DatumEnds.End0, v, DatumExtentType.ViewSpecific);
                    if (d.GetDatumExtentTypeInView(DatumEnds.End1, v) != DatumExtentType.ViewSpecific)
                        d.SetDatumExtentType(DatumEnds.End1, v, DatumExtentType.ViewSpecific);
                    d.SetCurveInView(DatumExtentType.ViewSpecific, v, Line.CreateBound(n0, n1));
                    st.Commit();
                    return null;
                }
                catch (Exception ex)
                {
                    if (st.HasStarted() && !st.HasEnded()) st.RollBack();
                    string m = First(ex.Message);
                    if (HasScopeBox(d)) return "Scope Box-оор удирдагддаг тул үзүүрийг өөрчлөх боломжгүй (" + m + ").";
                    return m;
                }
            }
        }

        private static bool HasScopeBox(DatumPlane d)
        {
            try
            {
                Parameter p = d.get_Parameter(BuiltInParameter.DATUM_VOLUME_OF_INTEREST);
                return p != null && p.AsElementId() != ElementId.InvalidElementId;
            }
            catch
            {
                return false;
            }
        }

        private static string SkipText(AaDatumSkip s, bool isGrid)
        {
            switch (s)
            {
                case AaDatumSkip.WrongOrientation: return isGrid ? "энэ харагдацад босоо биш (налуу) — хөндөөгүй." : "энэ харагдацад хэвтээ биш (налуу) — хөндөөгүй.";
                case AaDatumSkip.OutsideCrop: return "crop region-ы хүрээнээс гадна (харагдахгүй) — хөндөөгүй.";
                case AaDatumSkip.TooShort: return "дотогш зай хэт их — хоёр үзүүр давхцах тул хөндөөгүй.";
                default: return "шугамын урт ≈ 0 — хөндөөгүй.";
            }
        }

        private static string SafeName(Element e)
        {
            try { return e.Name; }
            catch { return e.Id.Value.ToString(); }
        }

        private static string First(string m)
        {
            return (m ?? string.Empty).Split('\n')[0].Trim().TrimEnd('.') + ".";
        }
    }

    /// <summary>Сүүлийн утга — %APPDATA%\RevitMcpAddin\datum-crop.json (хэрэглэгч тус бүр).</summary>
    internal static class AaDatumCropPrefs
    {
        private static string PathOf => Path.Combine(SettingsStore.Dir, "datum-crop.json");

        public static AaDatumCropOptions Load()
        {
            try
            {
                if (File.Exists(PathOf))
                {
                    AaDatumCropOptions o = JsonSerializer.Deserialize<AaDatumCropOptions>(File.ReadAllText(PathOf));
                    if (o != null && o.Validate() == null) return o;
                }
            }
            catch
            {
                // Эвдэрсэн файл — өгөгдмөл.
            }
            return new AaDatumCropOptions();
        }

        public static void Save(AaDatumCropOptions o)
        {
            try
            {
                Directory.CreateDirectory(SettingsStore.Dir);
                File.WriteAllText(PathOf, JsonSerializer.Serialize(o, new JsonSerializerOptions { WriteIndented = true }));
            }
            catch
            {
                // Хадгалж чадаагүй нь ажиллагаанд саад биш.
            }
        }
    }

    /// <summary>Ribbon команд «Тэнхлэг, түвшин — crop-оос».</summary>
    [Transaction(TransactionMode.Manual)]
    [Regeneration(RegenerationOption.Manual)]
    public class DatumCropCommand : IExternalCommand
    {
        internal const string Title = "MGL — Тэнхлэг, түвшин (crop-оос)";

        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            // ⚠️ ЛИЦЕНЗ (1.9.0): Ribbon-ы бүх команд — Licensing/LicenseGate.cs.
            if (!global::RevitMcpAddin.Licensing.LicenseGate.Ensure()) return Result.Cancelled;
            UIDocument uidoc = commandData.Application.ActiveUIDocument;
            if (uidoc == null || uidoc.Document == null || uidoc.Document.IsFamilyDocument) return Result.Cancelled;
            Document doc = uidoc.Document;
            View view = doc.ActiveView;
            if (!AaDatumCropService.IsSupportedView(view))
            {
                TaskDialog.Show(Title, "Огтлол, дэлгээс (фасад) эсвэл detail харагдац нээгээд дахин дарна уу.\n\nТэнхлэг (босоо) ба түвшний (хэвтээ) үзүүрийг crop region-оос заасан зайд тавина.");
                return Result.Cancelled;
            }
            ICollection<ElementId> selection = uidoc.Selection.GetElementIds();
            AaDatumCropInfo info = AaDatumCropService.Analyze(doc, view, selection);
            if (!info.CropActive)
            {
                TaskDialog.Show(Title, "Энэ харагдацын Crop region идэвхгүй байна.\n\nView Control Bar-аас «Crop View» асаагаад дахин дарна уу — зай нь crop-ийн хилээс хэмжигдэнэ.");
                return Result.Cancelled;
            }
            if (info.Grids + info.Levels == 0)
            {
                TaskDialog.Show(Title, "Энэ харагдацад харагдаж буй тэнхлэг, түвшин олдсонгүй.");
                return Result.Cancelled;
            }

            var dlg = new AaDatumCropDialog(info, AaDatumCropPrefs.Load());
            if (App.ShowOwned(dlg, commandData.Application.MainWindowHandle) != true) return Result.Cancelled;
            AaDatumCropOptions o = dlg.Result;
            AaDatumCropPrefs.Save(o);

            AaDatumCropReport rep;
            try
            {
                rep = AaDatumCropService.Apply(doc, view, o, selection);
            }
            catch (Exception ex)
            {
                message = ex.Message;
                TaskDialog.Show(Title, "Алдаа: " + ex.Message);
                return Result.Failed;
            }

            var td = new TaskDialog(Title)
            {
                MainInstruction = rep.Changed > 0 ? "Тэнхлэг, түвшний үзүүрийг тавилаа" : "Өөрчлөгдсөнгүй",
                MainContent = (rep.Errors.Count > 0 ? string.Join("\n", rep.Errors) + "\n\n" : "")
                    + "Тэнхлэг: " + rep.Grids + " · түвшин: " + rep.Levels + (rep.Skipped.Count > 0 ? " · алгассан: " + rep.Skipped.Count : "")
                    + "\n\nЗөвхөн энэ харагдацад (2D) өөрчлөгдсөн.  Ctrl+Z-ээр нэг дор буцаана.",
            };
            List<string> more = rep.Notes.Concat(rep.Skipped).Take(20).ToList();
            if (more.Count > 0) td.ExpandedContent = string.Join("\n", more.Select(s => "• " + s));
            td.Show();
            if (rep.Changed == 0) return rep.Errors.Count > 0 ? Result.Failed : Result.Cancelled;
            return Result.Succeeded;
        }
    }

    /// <summary>Товч идэвхтэй: project файлд, огтлол/дэлгээс/detail харагдац идэвхтэй үед.</summary>
    public class DatumCropAvailability : IExternalCommandAvailability
    {
        public bool IsCommandAvailable(UIApplication applicationData, CategorySet selectedCategories)
        {
            try
            {
                UIDocument uidoc = applicationData?.ActiveUIDocument;
                if (uidoc == null || uidoc.Document == null || uidoc.Document.IsFamilyDocument) return false;
                return AaDatumCropService.IsSupportedView(uidoc.ActiveView);
            }
            catch
            {
                return false;
            }
        }
    }
}
