using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// Өрөөний «Харагдах байдал» — 3D изометр (View3D): өрөөний гол чиглэлд эргүүлсэн тайрах хайрцаг (харагч талын хана, тааз тайрагдсан),
    /// хайрцгийн оройнуудаар crop (viewport өрөөний хэмжээтэй — бүх загварын хэмжээ биш).  Extensible Storage-оор (өрөөний түлхүүр) таньж
    /// дахин ажиллуулахад хайрцаг, чиглэл, crop-ийг шинэчилнэ; хэрэглэгчийн нэр, гарчгийг хөндөхгүй.
    /// Нээлттэй Transaction дотор; дуудагч SubTransaction-оор хамгаална.
    /// </summary>
    internal sealed class WeAxonService
    {
        private readonly Document _doc;
        private readonly WeResources _res;
        private readonly HashSet<string> _names;
        /// <summary>Хэмжилт (мс): үүсгэх, хайрцаг+чиглэл, regenerate, crop — нэг ажиллагааны нийлбэр (логт).</summary>
        public long MsCreate, MsBox, MsRegen, MsCrop;
        /// <summary>
        /// Энэ ажиллагаанд ШИНЭЭР үүсгэсэн эхний 3D — бусад өрөөний 3D-г үүнээс хувилна.  ⚠️ ХЭМЖСЭН (Revit 2027): CreateIsometric ≈ 320 мс,
        /// анхны SetSectionBox ≈ 460 мс; Duplicate ≈ 21 мс, хувилсны хайрцаг солих ≈ 0 мс (12 өрөөнд 9.8 с → ~1 с).
        /// </summary>
        private View3D _prototype;

        public WeAxonService(Document doc, WeResources res, HashSet<string> viewNames)
        {
            _doc = doc; _res = res; _names = viewNames;
        }

        public View3D Ensure(WeGroupInfo g, List<string> notes, out bool created)
        {
            created = false;
            WeAxonPlan ap = g.Axon;
            if (ap == null || !(ap.MaxX > ap.MinX) || !(ap.MaxY > ap.MinY) || !(ap.MaxZ > ap.MinZ)) return null;
            var sw = System.Diagnostics.Stopwatch.StartNew();
            List<View> found = _res.FindAllGenerated(GeneratedElevationRepository.KindAxon, ap.Key);
            if (found.Count > 1)
            {
                // Хэрэглэгч хуулсан 3D-г (хайрцаг, чиглэлийг нь) дарахгүй — аль нь «манай» болохыг таахгүй (аудит).
                notes.Add(g.GroupLabel + ": 3D харагдах байдал " + found.Count + " удаа давхардсан («" + string.Join("», «", found.Select(x => x.Name)) + "») — шинэчлээгүй.");
                return null;
            }
            var v = found.FirstOrDefault() as View3D;
            if (v == null)
            {
                if (_res.ThreeDType == null)
                {
                    notes.Add(g.GroupLabel + ": 3D харагдах байдал үүсгэсэнгүй — загварт 3D харагдацын төрөл алга.");
                    return null;
                }
                bool fromPrototype = false;
                if (_prototype != null && _prototype.IsValidObject)
                {
                    try
                    {
                        v = _doc.GetElement(_prototype.Duplicate(ViewDuplicateOption.Duplicate)) as View3D;
                        fromPrototype = v != null;
                    }
                    catch (Exception ex) { WeLog.Info("axon", "хувилж чадсангүй — шинээр үүсгэнэ: " + ex.Message); v = null; }
                }
                if (v == null) v = View3D.CreateIsometric(_doc, _res.ThreeDType.Id);
                created = true;
                // 3D төрлийн өгөгдмөл загвар чиглэл/хайрцаг/харагдах байдлыг түгжиж болно — энэ харагдацад загваргүй.
                try { v.ViewTemplateId = ElementId.InvalidElementId; } catch { }
                string name = WeNaming.Unique(WeNaming.Clean("3D — " + (string.IsNullOrEmpty(g.Label) ? g.RoomNumber : g.Label)), _names);
                try { v.Name = name; } catch (Autodesk.Revit.Exceptions.ArgumentException) { name = WeNaming.Unique(name, _names); v.Name = name; }
                _names.Add(name);
                if (fromPrototype)
                {
                    // Хувилбар нь эх 3D-гийн гарчгийг (Title on Sheet) авсан — энэ өрөөнийхөөр солино.
                    try { Parameter d = v.get_Parameter(BuiltInParameter.VIEW_DESCRIPTION); if (d != null && !d.IsReadOnly) d.Set(string.Empty); } catch { }
                }
                WeKeyPlanService.SetTitle(v, "ХАРАГДАХ БАЙДАЛ", t => t.StartsWith("Харагдах байдал", StringComparison.OrdinalIgnoreCase));
                GeneratedElevationRepository.Write(v, new WeRecord
                {
                    Kind = GeneratedElevationRepository.KindAxon, Key = ap.Key, RoomUid = g.RoomUid,
                    GeneratedName = name, GeneratorVersion = WeIdentity.GeneratorVersion,
                });
                // ⚠️ ХЭМЖСЭН (Revit 2027, Snowdon загвар): 3D төрлийн өгөгдмөл discipline = Structural → архитектурын хана огт
                // зурагдахгүй (хоосон 3D).  Coordination — бүх discipline.
                try { v.Discipline = ViewDiscipline.Coordination; } catch { }
                if (!fromPrototype) try { v.DetailLevel = ViewDetailLevel.Fine; } catch { }
                try { v.DisplayStyle = DisplayStyle.ShadingWithEdges; } catch { }
                foreach (BuiltInCategory bic in new[] { BuiltInCategory.OST_SectionBox, BuiltInCategory.OST_Levels, BuiltInCategory.OST_Grids })
                {
                    try
                    {
                        var cid = new ElementId(bic);
                        if (v.CanCategoryBeHidden(cid)) v.SetCategoryHidden(cid, true);
                    }
                    catch { }
                }
                // Төслийн дотор дэлгээсийн хуудасны 3D template (оффисын «3D АЦӨ» г.м.) — тэдний харагдах хэв маягаар.
                if (_res.AxonTemplate != null && _res.AxonTemplate.IsValidObject)
                {
                    try { v.ViewTemplateId = _res.AxonTemplate.Id; }
                    catch (Exception ex) { WeLog.Info("axon", "template — " + ex.Message); }
                }
            }
            else if (!string.IsNullOrEmpty(g.Label) && !string.IsNullOrEmpty(g.SideRange))
            {
                // Үсгийн муж өөрчлөгдсөн (2026-10-14, «+ Хана нэмэх»: E) — хэрэгслийн өгсөн «3D — 101A-D» нэрийг шинэчилнэ; хэрэглэгчийнхийг хөндөхгүй.
                string next = WeNaming.Rerange(v.Name, WeNaming.Clean("3D — " + g.Label), g.SideRange);
                if (next != null && !_names.Contains(next))
                {
                    string was = v.Name;
                    try
                    {
                        v.Name = next;
                        _names.Add(next);
                        GeneratedElevationRepository.Write(v, new WeRecord
                        {
                            Kind = GeneratedElevationRepository.KindAxon, Key = ap.Key, RoomUid = g.RoomUid,
                            GeneratedName = next, GeneratorVersion = WeIdentity.GeneratorVersion,
                        });
                        WeLog.Info("axon", "«" + was + "» → «" + next + "» (үсгийн муж)");
                    }
                    catch (Exception ex) { WeLog.Info("axon", was + ": мужийг шинэчилсэнгүй — " + ex.Message); }
                }
            }

            MsCreate += sw.ElapsedMilliseconds;
            sw.Restart();
            try { if (v.IsLocked) v.Unlock(); } catch { }
            Transform t = Transform.Identity;
            t.Origin = ap.Origin.ToXyz();
            t.BasisX = ap.AxisX.ToXyz();
            t.BasisY = ap.AxisY.ToXyz();
            t.BasisZ = XYZ.BasisZ;
            v.SetSectionBox(new BoundingBoxXYZ { Transform = t, Min = new XYZ(ap.MinX, ap.MinY, ap.MinZ), Max = new XYZ(ap.MaxX, ap.MaxY, ap.MaxZ) });
            v.SetOrientation(new ViewOrientation3D(ap.Eye.ToXyz(), ap.Up.ToXyz(), ap.Forward.ToXyz()));
            // Масштаб (W03, 2026-10-16): тохиргооны «3D масштаб» ЯГ — хуудсанд багтаахаар хэзээ ч өөрчлөхгүй.  Дахин ажиллуулахад: хэрэглэгч гараар
            // сольсон (эсвэл өмнөх хувилбарын тохируулсан, төлөвгүй) масштабыг хадгална; тохиргоо өөрчлөгдсөн үед л шинэ утга.
            {
                WeViewState st = WeViewStateStore.Read(v);
                WeScaleRule.Decision dec = WeScaleRule.Decide(v.Scale, st.Scale, ap.Scale, created, false);
                try { if (v.Scale != dec.Apply) v.Scale = dec.Apply; } catch (Exception ex) { WeLog.Info("axon", v.Name + ": масштаб — " + ex.Message); }
                if (dec.KeptManual) WeLog.Info("axon", v.Name + ": гараар тавьсан масштаб 1:" + v.Scale + " хэвээр (тохиргоо 1:" + ap.Scale + ")");
                st.Scale = dec.Record;
                WeViewStateStore.Write(v, st);
            }
            MsBox += sw.ElapsedMilliseconds;
            sw.Restart();
            _doc.Regenerate();   // чиглэл солигдсоны дараа crop-ийн тэнхлэг шинэчлэгдэнэ (ховор — өрөө тус бүр нэг)
            MsRegen += sw.ElapsedMilliseconds;
            sw.Restart();
            FitCrop(v, ap);
            MsCrop += sw.ElapsedMilliseconds;
            if (created && (_prototype == null || !_prototype.IsValidObject)) _prototype = v;
            return v;
        }

        /// <summary>Crop = хайрцгийн 8 оройн харагдацын хавтгай дээрх тусгал (+3 %).</summary>
        private static void FitCrop(View3D v, WeAxonPlan ap)
        {
            try
            {
                v.CropBoxActive = true;
                try { v.CropBoxVisible = false; } catch { }
                BoundingBoxXYZ cb = v.CropBox;
                Transform inv = cb.Transform.Inverse;
                double x0 = double.MaxValue, y0 = double.MaxValue, x1 = double.MinValue, y1 = double.MinValue;
                foreach (WeV3 c in ap.Corners())
                {
                    XYZ l = inv.OfPoint(c.ToXyz());
                    x0 = Math.Min(x0, l.X); y0 = Math.Min(y0, l.Y);
                    x1 = Math.Max(x1, l.X); y1 = Math.Max(y1, l.Y);
                }
                double mx = (x1 - x0) * 0.03, my = (y1 - y0) * 0.03;
                v.CropBox = new BoundingBoxXYZ { Transform = cb.Transform, Min = new XYZ(x0 - mx, y0 - my, cb.Min.Z), Max = new XYZ(x1 + mx, y1 + my, cb.Max.Z) };
            }
            catch (Exception ex)
            {
                WeLog.Info("axon", v.Name + ": crop — " + ex.Message);
            }
        }
    }
}
