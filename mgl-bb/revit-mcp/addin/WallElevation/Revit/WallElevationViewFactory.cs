using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// Дэлгээсний харагдац үүсгэх / байрлуулах стратеги.  Хэрэгслийн бусад хэсэг зөвхөн энэ интерфейсийг мэднэ —
    /// дараа нь ElevationMarker-т шилжих бол зөвхөн шинэ хэрэгжүүлэлт нэмнэ.
    /// </summary>
    internal interface IWallElevationViewFactory
    {
        string StrategyName { get; }

        /// <summary>Нээлттэй Transaction дотор.  Буцаасан харагдац нь хүрээ идэвхтэй, төлөвлөсөн чиглэлтэй.</summary>
        View Create(Document doc, ElementId viewFamilyTypeId, WePlannedElevation p);

        /// <summary>
        /// Байгаа харагдацыг шинэ хүрээнд оруулна (эргүүлэх / зөөх / crop).  Нээлттэй (Sub)Transaction дотор; амжилтгүй бол
        /// false — дуудагч SubTransaction-ийг буцаана.  Үр дүнг дуудагч <see cref="WallElevationValidator"/>-оор ДАХИН шалгана.
        /// </summary>
        bool Reposition(Document doc, View view, WeFrame frame, WeBox box, out string detail);
    }

    /// <summary>
    /// <c>ViewSection.CreateSection</c> — «ханын дэлгээс» = ханын урд зүсэлт (Revit-ийн interior elevation-тай ижил үр дүн).
    ///
    /// ЯАГААД ElevationMarker БИШ: маркер нь 4 талын нэг индекс + маркерын байрлалаар чиглэлээ тогтоодог; дурын өнцгийн
    /// ханад маркерыг эргүүлэх, гүн (far clip), хүрээг тусад нь тохируулах шаардлагатай бөгөөд маркер ↔ харагдацын
    /// хоёр элемент шинэчлэлтэд зөрж болно.  Зүсэлт нь чиглэл, хүрээ, гүнийг НЭГ <see cref="BoundingBoxXYZ"/>-ээр,
    /// нэг элементээр тодорхойлдог — тодорхой (deterministic) ба шинэчлэхэд хялбар.
    ///
    /// ⚠️ Оролтын тэнхлэг = (−Right, Up, −ViewDirection), хайрцаг ТӨВТЭЙ тэгш хэмтэй — CopyToOther/CloneDrawings-д
    ///    Revit 2027 дээр хэмжиж баталсан дүрэм (CropBox-ийн тэнхлэгийг шууд өгвөл харах чиг урвуу гардаг).
    /// </summary>
    internal sealed class SectionElevationViewFactory : IWallElevationViewFactory
    {
        public string StrategyName { get { return "ViewSection.CreateSection"; } }

        public View Create(Document doc, ElementId viewFamilyTypeId, WePlannedElevation p)
        {
            WeFrame frame = p.Frame;
            WeBox box = p.Box;
            WeV3 lc = box.LocalCenter;
            WeV3 c = frame.ToWorld(lc.X, lc.Y, lc.Z);
            WeV3 h = box.Half;
            Transform t = Transform.Identity;
            t.Origin = c.ToXyz();
            t.BasisX = (-frame.Right).ToXyz();
            t.BasisY = frame.Up.ToXyz();
            t.BasisZ = frame.Look.ToXyz();
            var bb = new BoundingBoxXYZ { Transform = t, Min = new XYZ(-h.X, -h.Y, -h.Z), Max = new XYZ(h.X, h.Y, h.Z) };
            ViewSection vs = ViewSection.CreateSection(doc, viewFamilyTypeId, bb);
            vs.CropBoxActive = true;
            // ⚠️ ХЭМЖСЭН (Revit 2027, 2026-10-06): CreateSection-ийн дараа crop-ийн Z нь зөв (гүн = box) боловч far clip offset
            // параметр 1100 фут (335 м) хэвээр үлддэг — ханын нүхээр (хаалга, цонх) цаадах бүх юм харагдана.  Шууд тавина.
            SetFarClip(vs, box.Depth);
            return vs;
        }

        /// <summary>Far clip = гүн, «шугамгүй хайчлах» (хайчлахгүй байсан бол).</summary>
        internal static void SetFarClip(View v, double depth)
        {
            Parameter mode = v.get_Parameter(BuiltInParameter.VIEWER_BOUND_FAR_CLIPPING);
            if (mode != null && !mode.IsReadOnly && mode.AsInteger() == 0) mode.Set(2);
            Parameter far = v.get_Parameter(BuiltInParameter.VIEWER_BOUND_OFFSET_FAR);
            if (far != null && !far.IsReadOnly && Math.Abs(far.AsDouble() - depth) > WeTol.Length) far.Set(depth);
        }

        /// <summary>
        /// Зүсэлтийн тэмдэг (viewer, OST_Viewers) — харагдацыг эргүүлэх/зөөх нь ЭНЭ элементээр.
        /// ⚠️ ХЭМЖСЭН (Revit 2027): <c>RotateElement(view.Id)</c> алдаагүйгээр ЮУ Ч хийдэггүй; viewer-ийг эргүүлэх/зөөх нь ажилладаг.
        /// </summary>
        internal static Element FindViewer(Document doc, View view)
        {
            foreach (ElementId id in view.GetDependentElements(new ElementCategoryFilter(BuiltInCategory.OST_Viewers)))
                if (id != view.Id) return doc.GetElement(id);
            return null;
        }

        public bool Reposition(Document doc, View view, WeFrame frame, WeBox box, out string detail)
        {
            detail = null;
            WeV3 wantDir = frame.ViewDirection;
            Element viewer = FindViewer(doc, view);

            // 1) Чиглэл өөрчлөгдсөн бол viewer-ийг босоо тэнхлэгээр эргүүлнэ (ховор — хана эргэсэн).
            WeV3 cur = view.ViewDirection.ToWe().Flat().Normalized();
            if (cur.IsZero) { detail = "Харагдацын чиглэл уншигдсангүй"; return false; }
            bool moved = false;
            if (cur.Dot(wantDir) < 1 - WeTol.Direction)
            {
                if (viewer == null) { detail = "Зүсэлтийн тэмдэг (viewer) олдсонгүй — эргүүлж чадсангүй"; return false; }
                double angle = Math.Atan2(cur.Cross(wantDir).Z, cur.Dot(wantDir));
                WeV3 pivot = CropCenter(view);
                ElementTransformUtils.RotateElement(doc, viewer.Id, Line.CreateBound(pivot.ToXyz(), (pivot + WeV3.UnitZ).ToXyz()), angle);
                moved = true;
                doc.Regenerate();   // зөвхөн эргүүлсэн/зөөсөн харагдацад — эргэсэн чиглэлийг уншихад шаардлагатай
            }

            // 2) Зүсэх хавтгайг төлөвлөсөн байрлалд (хана зөөгдсөн): харах тэнхлэгийн дагуу viewer-ийг зөөнө.
            XYZ vd = view.ViewDirection;
            double along = (frame.ToWorld(0, 0, box.Near).ToXyz() - CutPoint(view)).DotProduct(vd);
            if (Math.Abs(along) > WeTol.Length)
            {
                if (viewer == null) { detail = "Зүсэлтийн тэмдэг (viewer) олдсонгүй — зөөж чадсангүй"; return false; }
                ElementTransformUtils.MoveElement(doc, viewer.Id, vd * along);
                moved = true;
                doc.Regenerate();
            }

            // 3) Хүрээ (X/Y): ОДООГИЙН crop тэнхлэгээр төлөвлөсөн хайрцгийн оройнуудыг илэрхийлнэ.  Гүн (Z): зүсэх хавтгайгаас
            //    box.Depth — far clip параметрийг ч шууд (crop-ийн Z ганцаараа far clip-ийг удирддаггүй).
            BoundingBoxXYZ cb = view.CropBox;
            Transform inv = cb.Transform.Inverse;
            double loX = double.MaxValue, loY = double.MaxValue, hiX = double.MinValue, hiY = double.MinValue;
            foreach (double x in new[] { box.MinX, box.MaxX })
                foreach (double y in new[] { box.MinY, box.MaxY })
                {
                    XYZ p = inv.OfPoint(frame.ToWorld(x, y, box.Near).ToXyz());
                    loX = Math.Min(loX, p.X); hiX = Math.Max(hiX, p.X);
                    loY = Math.Min(loY, p.Y); hiY = Math.Max(hiY, p.Y);
                }
            bool cutAtMax = cb.Transform.BasisZ.DotProduct(vd) > 0;
            double minZ = cutAtMax ? cb.Max.Z - box.Depth : cb.Min.Z;
            double maxZ = cutAtMax ? cb.Max.Z : cb.Min.Z + box.Depth;
            view.CropBox = new BoundingBoxXYZ { Transform = cb.Transform, Min = new XYZ(loX, loY, minZ), Max = new XYZ(hiX, hiY, maxZ) };
            view.CropBoxActive = true;
            SetFarClip(view, box.Depth);
            detail = moved ? "харагдацыг эргүүлж/зөөж, хүрээг шинэчлэв" : "хүрээ/гүнийг шинэчлэв";
            return true;
        }

        /// <summary>Зүсэх хавтгай дээрх нэг цэг (дэлхийн) — crop-ийн харагч руу харсан Z нүүр.</summary>
        internal static XYZ CutPoint(View view)
        {
            BoundingBoxXYZ cb = view.CropBox;
            bool cutAtMax = cb.Transform.BasisZ.DotProduct(view.ViewDirection) > 0;
            return cb.Transform.OfPoint(new XYZ((cb.Min.X + cb.Max.X) / 2, (cb.Min.Y + cb.Max.Y) / 2, cutAtMax ? cb.Max.Z : cb.Min.Z));
        }

        /// <summary>Crop хайрцгийн төв (дэлхийн).</summary>
        internal static WeV3 CropCenter(View view)
        {
            BoundingBoxXYZ cb = view.CropBox;
            return cb.Transform.OfPoint((cb.Min + cb.Max) * 0.5).ToWe();
        }

        /// <summary>
        /// Crop-ийг төлөвлөсөн хайрцагт: хүрээ (X/Y) — одоогийн crop тэнхлэгээр оройнуудыг илэрхийлнэ; хавтгай (Z) — <paramref name="planeZ"/>
        /// (null = одоогийн зүсэх хавтгай хэвээр); гүн — box.Depth + far clip параметр.
        /// </summary>
        internal static void ApplyCrop(View view, WeFrame frame, WeBox box, bool movePlane)
        {
            BoundingBoxXYZ cb = view.CropBox;
            Transform inv = cb.Transform.Inverse;
            double loX = double.MaxValue, loY = double.MaxValue, hiX = double.MinValue, hiY = double.MinValue;
            foreach (double x in new[] { box.MinX, box.MaxX })
                foreach (double y in new[] { box.MinY, box.MaxY })
                {
                    XYZ q = inv.OfPoint(frame.ToWorld(x, y, box.Near).ToXyz());
                    loX = Math.Min(loX, q.X); hiX = Math.Max(hiX, q.X);
                    loY = Math.Min(loY, q.Y); hiY = Math.Max(hiY, q.Y);
                }
            bool cutAtMax = cb.Transform.BasisZ.DotProduct(view.ViewDirection) > 0;
            double plane = movePlane ? inv.OfPoint(frame.ToWorld(0, 0, box.Near).ToXyz()).Z : (cutAtMax ? cb.Max.Z : cb.Min.Z);
            double minZ = cutAtMax ? plane - box.Depth : plane;
            double maxZ = cutAtMax ? plane : plane + box.Depth;
            // ⚠️ ХЭМЖСЭН (MITIC 218D/218I, Revit 2024, 2026-10-08): far clip нь харагдацын АНХНЫ хавтгайгаас (маркерын шугам) хэмжигдэнэ, зөөсөн
            // зүсэх хавтгайгаас биш.  Маркер нь хэд хэдэн дэлгээсэд хуваалцагдаж зүсэх хавтгайн ар талд (430–725 мм) байхад гүн тэр хэмжээгээр
            // богиносож хана хүрээнээс гарч дэлгээс устгагдаж байв.  Анхны хавтгайгаас алс хавтгай хүртэлх зайг өгнө.
            double origPlane = cutAtMax ? cb.Max.Z : cb.Min.Z;
            double farDist = cutAtMax ? origPlane - minZ : maxZ - origPlane;
            view.CropBox = new BoundingBoxXYZ { Transform = cb.Transform, Min = new XYZ(loX, loY, minZ), Max = new XYZ(hiX, hiY, maxZ) };
            view.CropBoxActive = true;
            SetFarClip(view, Math.Max(box.Depth, farDist));
        }
    }

    /// <summary>
    /// Revit-ийн Elevation (View → Elevation): <c>ElevationMarker.CreateElevationMarker</c> + <c>CreateElevation(index)</c>.
    /// Жишээ хуудасны (206A-G, 205G-N) түлхүүр план дээрх тэмдэг нь яг энэ маркер — viewport-ийн дугаар (206A), хуудасны дугаарыг
    /// Revit өөрөө харуулж, хуудас солигдоход дагана.  Зүсэлтээс ялгаатай нь огтлохгүй (өрөөний дундах тавилга зүсэгдэхгүй).
    ///
    /// ХЭМЖСЭН (Revit 2027, 2026-10-06): индекс 0 = −X, 1 = +Y, 2 = +X, 3 = −Y; маркерыг эргүүлэхэд харагдацууд хамт эргэнэ;
    /// харагдацын хавтгай маркерын төвийг дайрах ч crop-ийн Max.Z-ээр зөөгдөнө; far clip = параметр; маркерыг ЗӨӨХӨД үүссэн
    /// харагдац дагадаггүй; маркерын bounding box / LocationPoint уншигддаггүй (null) — тиймээс байрлалыг төлөвлөгч
    /// (<see cref="WeMarkerPlanner"/>) урьдчилж тооцно, харагдацыг crop-оор байрлуулна.  Хоёр Elevation төрөлд хоёуланд нь
    /// «Structural Framing Elevation» загвар автоматаар наалддаг — өөрийн төрлөөс арилгана (coordinator).
    /// </summary>
    internal sealed class ElevationViewFactory : IWallElevationViewFactory
    {
        private readonly Document _doc;
        private readonly WeResources _res;
        private readonly int _scale;
        /// <summary>Маркерын бүлэг → (маркер, план).  SubTransaction буцаагдвал id хүчингүй болно — дахин үүсгэнэ.</summary>
        private readonly Dictionary<string, KeyValuePair<ElementId, ElementId>> _markers = new Dictionary<string, KeyValuePair<ElementId, ElementId>>(StringComparer.Ordinal);
        /// <summary>Харагдац → маркер (энэ ажиллагаанд нэг удаа уншина, үүсгэх бүрт нэмнэ).</summary>
        private Dictionary<long, ElementId> _markerOfView;

        public ElevationViewFactory(Document doc, WeResources res, int scale)
        {
            _doc = doc; _res = res; _scale = scale;
        }

        /// <summary>
        /// Бүлэг (өрөө) → маркерыг үүсгэх суурь план (өрөөгөөр тайрсан түлхүүр план).  ХЭМЖСЭН (GATEWAY, 2026-10-07): давхрын бүтэн план дээр
        /// <c>CreateElevation</c> = 0.79 с (Revit барилгын бүх хүрээг тооцно), тайрсан план дээр 0.19 с.  Маркер бүх планд ижил харагдана.
        /// Олдохгүй / өөр түвшин бол давхрын план.
        /// </summary>
        public readonly Dictionary<string, ElementId> HostPlans = new Dictionary<string, ElementId>(StringComparer.Ordinal);

        public string StrategyName { get { return "ElevationMarker.CreateElevation"; } }

        public View Create(Document doc, ElementId viewFamilyTypeId, WePlannedElevation p)
        {
            WeMarkerPlacement m = p.Marker;
            if (m == null)
            {
                // Төлөвлөгч оноогоогүй (хана горим г.м.) — ганц маркер хавтгайн төвд.
                int slot; double rot;
                WeMarkerPlanner.ChooseSlot(p.Frame.Look, out slot, out rot);
                m = new WeMarkerPlacement { Group = "m:" + p.Key, Slot = slot, Rotation = rot, Position = p.Frame.ToWorld(0, 0, p.Box.Near) };
            }
            ElevationMarker marker;
            ElementId planId;
            KeyValuePair<ElementId, ElementId> known;
            XYZ rotateAt = null;
            if (_markers.TryGetValue(m.Group, out known) && doc.GetElement(known.Key) is ElevationMarker)
            {
                marker = (ElevationMarker)doc.GetElement(known.Key);
                planId = known.Value;
            }
            else
            {
                ViewPlan plan = null;
                ElementId host;
                if (p.GroupKey != null && HostPlans.TryGetValue(p.GroupKey, out host))
                {
                    plan = doc.GetElement(host) as ViewPlan;
                    if (plan != null && (plan.GenLevel == null || !string.Equals(plan.GenLevel.Name, p.LevelName, StringComparison.Ordinal))) plan = null;
                }
                if (plan == null) plan = _res.PlanForLevel(p.LevelName);
                if (plan == null) throw new InvalidOperationException("Загварт давхрын план алга — Elevation маркер үүсгэх план хэрэгтэй");
                double z = plan.GenLevel != null ? plan.GenLevel.Elevation : m.Position.Z;
                var origin = new XYZ(m.Position.X, m.Position.Y, z);
                using (WeProf.T("elev.marker")) marker = ElevationMarker.CreateElevationMarker(doc, viewFamilyTypeId, origin, _scale);
                if (Math.Abs(m.Rotation) > 1e-9) rotateAt = origin;
                planId = plan.Id;
                _markers[m.Group] = new KeyValuePair<ElementId, ElementId>(marker.Id, planId);
            }
            if (!marker.IsAvailableIndex(m.Slot)) throw new InvalidOperationException("Маркерын " + m.Slot + "-р сум аль хэдийн эзэлсэн");
            ViewSection v;
            try
            {
                using (WeProf.T("elev.createElevation")) v = marker.CreateElevation(doc, planId, m.Slot);
            }
            catch (Exception ex)
            {
                // Тайрсан суурь план татгалзвал (ховор) давхрын бүтэн планаар дахин.
                ViewPlan level = _res.PlanForLevel(p.LevelName);
                if (level == null || level.Id == planId) throw;
                WeLog.Info("create", "суурь план «" + (doc.GetElement(planId) as View)?.Name + "» — " + ex.Message + " → давхрын план");
                planId = level.Id;
                _markers[m.Group] = new KeyValuePair<ElementId, ElementId>(marker.Id, planId);
                using (WeProf.T("elev.createElevation")) v = marker.CreateElevation(doc, planId, m.Slot);
            }
            MarkerMap()[v.Id.Value] = marker.Id;
            if (rotateAt != null)
            {
                // ХЭМЖСЭН (Revit 2027, 2026-10-07): ХООСОН маркерыг эргүүлэх нь юу ч хийдэггүй — эхний харагдацыг үүсгэсний ДАРАА эргүүлнэ
                // (харагдац хамт эргэнэ); дараагийн индексүүд эргэсэн маркерын чиглэлээр үүснэ.
                using (WeProf.T("elev.rotate")) ElementTransformUtils.RotateElement(doc, marker.Id, Line.CreateBound(rotateAt, rotateAt + XYZ.BasisZ), m.Rotation);
                using (WeProf.T("elev.rotateRegen")) doc.Regenerate();
            }

            WeV3 cur = v.ViewDirection.ToWe().Flat().Normalized();
            if (cur.Dot(p.Frame.ViewDirection) < 1 - WeTol.Direction)
                throw new InvalidOperationException("Маркерын чиглэл төлөвлөсөнтэй таарсангүй");
            using (WeProf.T("elev.crop")) SectionElevationViewFactory.ApplyCrop(v, p.Frame, p.Box, true);
            return v;
        }

        public bool Reposition(Document doc, View view, WeFrame frame, WeBox box, out string detail)
        {
            detail = null;
            WeV3 want = frame.ViewDirection;
            WeV3 cur = view.ViewDirection.ToWe().Flat().Normalized();
            if (cur.IsZero) { detail = "Харагдацын чиглэл уншигдсангүй"; return false; }
            bool rotated = false;
            if (cur.Dot(want) < 1 - WeTol.Direction)
            {
                ElementId mid;
                ElevationMarker marker = MarkerMap().TryGetValue(view.Id.Value, out mid) ? doc.GetElement(mid) as ElevationMarker : null;
                if (marker == null) { detail = "Elevation маркер олдсонгүй — эргүүлж чадсангүй"; return false; }
                if (marker.CurrentViewCount > 1)
                {
                    detail = "Хана эргэсэн боловч маркерыг өөр " + (marker.CurrentViewCount - 1) + " дэлгээс хуваалцсан — эргүүлэхгүй; энэ дэлгээсийг устгаад дахин ажиллуулна уу";
                    return false;
                }
                double angle = Math.Atan2(cur.Cross(want).Z, cur.Dot(want));
                WeV3 pivot = SectionElevationViewFactory.CropCenter(view);
                ElementTransformUtils.RotateElement(doc, marker.Id, Line.CreateBound(pivot.ToXyz(), (pivot + WeV3.UnitZ).ToXyz()), angle);
                doc.Regenerate();
                rotated = true;
            }
            // Хавтгай (хана зөөгдсөн) + хүрээ + гүн — crop-оор (маркер план дээрх тэмдэг хэвээр).
            SectionElevationViewFactory.ApplyCrop(view, frame, box, true);
            detail = rotated ? "маркерыг эргүүлж, хүрээг шинэчлэв" : "хүрээ/хавтгай/гүнийг шинэчлэв";
            return true;
        }

        /// <summary>Энэ ажиллагаанд үүсгэсэн харагдац устгагдсан бол хоосорсон маркерыг цэвэрлэнэ (хэрэглэгчийн маркер биш — зөвхөн манай).</summary>
        public void DeleteMarkerIfEmpty(Document doc, ElementId viewId)
        {
            ElementId mid;
            if (!MarkerMap().TryGetValue(viewId.Value, out mid)) return;
            var marker = doc.GetElement(mid) as ElevationMarker;
            if (marker != null && marker.IsValidObject && !marker.HasElevations()) doc.Delete(mid);
        }

        private Dictionary<long, ElementId> MarkerMap()
        {
            if (_markerOfView != null) return _markerOfView;
            _markerOfView = new Dictionary<long, ElementId>();
            foreach (ElevationMarker mk in new FilteredElementCollector(_doc).OfClass(typeof(ElevationMarker)).Cast<ElevationMarker>())
                for (int i = 0; i < 4; i++)
                {
                    ElementId vid = mk.GetViewId(i);
                    if (vid != null && vid != ElementId.InvalidElementId) _markerOfView[vid.Value] = mk.Id;
                }
            return _markerOfView;
        }
    }
}
