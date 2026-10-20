using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// «Түлхүүр байгуулалт» — өрөөний ДАВХРЫН план (ViewPlan): өрөөг хүрээлсэн crop, өрөөний хил тодруулга (налуу штрих + улаан тасархай
    /// шугам), тал бүрийн «205A» тэмдэг (хайрцагтай бичвэр, хана руу leader), өрөөний шошго.  Харагдацыг Extensible Storage-оор (өрөөний
    /// түлхүүр) таньж дахин ажиллуулахад ШИНЭЧИЛНЭ — өмнө ӨӨРӨӨ зурсныг (<see cref="WeAnnoStore"/>) устгаж дахин зурна, хэрэглэгчийн
    /// нэмснийг хөндөхгүй.  Бусад зүсэлт/дэлгээсийн тэмдгийг энэ планд нууна (зөвхөн манай тэмдэг уншигдана).
    /// Нээлттэй Transaction дотор; дуудагч SubTransaction-оор хамгаална.
    /// </summary>
    internal sealed class WeKeyPlanService
    {
        public const string LineStyleName = "MGL — Түлхүүр байгуулалт";
        public const string TextTypeName = "MGL — Түлхүүр тэмдэг";
        public const string FillTypeName = "MGL — Түлхүүр өрөө";

        private readonly Document _doc;
        private readonly WeResources _res;
        private readonly WeSettings _s;
        private readonly IWeUnits _u;
        private readonly HashSet<string> _names;
        private GraphicsStyle _line;
        private ElementId _text = ElementId.InvalidElementId;
        private ElementId _fill = ElementId.InvalidElementId;
        private bool _stylesResolved;
        // Энэ Ensure-ийн өрөө (host эсвэл link) — хил, шошго, хэмжээс host координатаар.
        private Room _room;
        private RevitLinkInstance _roomLink;
        private Transform _roomTf = Transform.Identity;

        /// <summary>Өрөөний хилийн сегментүүд HOST координатад (link-ийн өрөөнд хувиргасан).  Уншиж чадаагүй бол null.</summary>
        private List<List<KeyValuePair<Curve, BoundarySegment>>> HostLoops(Room room)
        {
            IList<IList<BoundarySegment>> segs;
            try { segs = room.GetBoundarySegments(new SpatialElementBoundaryOptions { SpatialElementBoundaryLocation = SpatialElementBoundaryLocation.Finish }); }
            catch { return null; }
            if (segs == null) return null;
            bool ident = _roomTf.IsIdentity;
            var list = new List<List<KeyValuePair<Curve, BoundarySegment>>>();
            foreach (IList<BoundarySegment> loop in segs)
            {
                var l = new List<KeyValuePair<Curve, BoundarySegment>>();
                foreach (BoundarySegment b in loop)
                {
                    Curve c = b.GetCurve();
                    if (c == null) continue;
                    l.Add(new KeyValuePair<Curve, BoundarySegment>(ident ? c : c.CreateTransformed(_roomTf), b));
                }
                list.Add(l);
            }
            return list;
        }

        public WeKeyPlanService(Document doc, WeResources res, WeSettings s, IWeUnits u, HashSet<string> viewNames)
        {
            _doc = doc; _res = res; _s = s; _u = u; _names = viewNames;
        }

        /// <summary>
        /// W07: дэлгээсийн түлхүүр → хүлээгдэж буй хуудасны дугаар (null = хуудасгүй / мэдэгдэхгүй) — БИЧВЭР тэмдгийн хоёр дахь мөр.  Хуудас
        /// байршуулсны дараа <see cref="RefreshReferences"/> бодит дугаартай тулгана.
        /// </summary>
        public Func<string, string> SheetRefOf;

        /// <summary>
        /// W07: түлхүүр план дээрх МАНАЙ бичвэр тэмдэг («205A» эсвэл «205A / A-301») — эхний мөр нь тэмдэг; хүссэн бичвэр <see cref="WeKeyPlanRef.Desired"/>.
        /// Хэрэглэгч харагдацыг гараар өөр хуудас руу зөөсөн, дугаар сольсон бол дахин ажиллуулахад энд засагдана.  Нээлттэй Transaction дотор.
        /// Revit-ийн Elevation маркер өөрөө шинэчлэгддэг — хөндөхгүй.
        /// </summary>
        /// <param name="labelToSheet">тэмдэг («205A») → харагдацын одоогийн хуудасны дугаар (null = хуудсанд байршаагүй).</param>
        /// <returns>Өөрчилсөн бичвэрийн тоо.</returns>
        public int RefreshReferences(View keyPlan, IDictionary<string, string> labelToSheet)
        {
            if (keyPlan == null || labelToSheet == null || labelToSheet.Count == 0) return 0;
            int changed = 0;
            foreach (TextNote tn in new FilteredElementCollector(_doc, keyPlan.Id).OfClass(typeof(TextNote)).Cast<TextNote>().ToList())
            {
                if (tn.OwnerViewId != keyPlan.Id) continue;
                Element t = _doc.GetElement(tn.GetTypeId());
                if (t == null || t.Name != TextTypeName) continue;
                string cur = tn.Text ?? string.Empty;
                string label = WeKeyPlanRef.LabelOf(cur), sheet;
                if (label.Length == 0 || !labelToSheet.TryGetValue(label, out sheet)) continue;
                string want = WeKeyPlanRef.Desired(label, sheet);
                if (WeKeyPlanRef.Same(cur, want)) continue;
                try { tn.Text = want; changed++; }
                catch (Exception ex) { WeLog.Info("keyplan", keyPlan.Name + ": лавлагаа «" + label + "» — " + ex.Message); }
            }
            return changed;
        }

        /// <param name="drawnKeys">Бодитоор үүссэн/байгаа дэлгээсийн түлхүүр — зөвхөн эдгээрийн тэмдгийг зурна.</param>
        /// <param name="nativeKeys">
        /// Elevation харагдацтай дэлгээс — Revit-ийн өөрийн маркер (viewport-ийн дугаар, хуудсыг харуулдаг) план дээр харагдах тул бичвэр
        /// тэмдэг ЗУРАХГҮЙ.  Үлдсэн (зүсэлтээр үүссэн) дэлгээст л бичвэр тэмдэг.
        /// </param>
        /// <returns>Түлхүүр план; үүсгэх боломжгүй бол null (шалтгааныг <paramref name="notes"/>-д).</returns>
        public ViewPlan Ensure(WeGroupInfo g, ICollection<string> drawnKeys, ICollection<string> nativeKeys, List<string> notes, out bool created)
        {
            created = false;
            WeKeyPlan kp = g.KeyPlan;
            if (kp == null || kp.Width <= 0 || kp.Height <= 0) return null;
            List<View> found = _res.FindAllGenerated(GeneratedElevationRepository.KindKeyPlan, kp.Key);
            if (found.Count > 1)
            {
                // Хэрэглэгч хуулсан (Duplicate with Detailing хуулбарт бичлэг дагаж ирдэг) — аль нь «манай» болохыг тааж дарахгүй (аудит).
                notes.Add(g.GroupLabel + ": түлхүүр план " + found.Count + " удаа давхардсан («" + string.Join("», «", found.Select(x => x.Name)) + "») — шинэчлээгүй; илүүг устгаад дахин ажиллуулна уу.");
                return null;
            }
            var v = found.FirstOrDefault() as ViewPlan;
            // Өрөө host-д эсвэл link-д (интерьерийн файл — өрөө архитектурын link-д).  Хил, шошгоны цэг бүгд host координат руу.
            RevitLinkInstance roomLink;
            Room room = WeRoomRef.Resolve(_doc, g.RoomUid, out roomLink);
            if (room == null && roomLink == null && g.RoomId > 0) room = _doc.GetElement(new ElementId(g.RoomId)) as Room;
            _room = room;
            _roomLink = roomLink;
            _roomTf = WeRoomRef.TransformOf(roomLink);
            if (v == null)
            {
                var lvl = _doc.GetElement(new ElementId(g.LevelId)) as Level;
                if (lvl == null && room != null && roomLink == null) lvl = room.Level;
                if (_res.FloorPlanType == null || lvl == null)
                {
                    notes.Add(g.GroupLabel + ": түлхүүр план үүсгэсэнгүй — " + (lvl == null ? "өрөөний түвшин олдсонгүй" : "загварт «Floor Plan» харагдацын төрөл алга") + ".");
                    return null;
                }
                v = ViewPlan.Create(_doc, _res.FloorPlanType.Id, lvl.Id);
                created = true;
                // Төслийн дотор дэлгээсийн хуудасны план template (оффисын шугамын жин, штрих) — масштаб нь түлхүүр плантай ижил бол.
                // Үгүй бол загваргүй (template масштаб, crop, ангиллыг түгжвэл түлхүүр план бүтэхгүй).
                bool tpl = false, copied = false;
                if (_res.KeyPlanTemplate != null && _res.KeyPlanTemplate.IsValidObject)
                {
                    try
                    {
                        v.ViewTemplateId = _res.KeyPlanTemplate.Id;
                        tpl = v.ViewTemplateId == _res.KeyPlanTemplate.Id;
                        if (tpl && v.Scale != kp.Scale)
                        {
                            // Template масштабыг түгжинэ — холбоогүйгээр ТОХИРГООГ нь нэг удаа хуулна (ангиллын харагдац, шугамын жин, шүүлтүүр —
                            // MITIC «И.З - 2.1»: жишиг түлхүүр планы өнгө, өрөөний шошго), дараа нь масштабаа өөрөө тавина.
                            v.ViewTemplateId = ElementId.InvalidElementId;
                            tpl = false;
                            try { v.ApplyViewTemplateParameters(_res.KeyPlanTemplate); copied = true; }
                            catch (Exception ex) { WeLog.Info("keyplan", "template-ийн тохиргоо хуулах — " + ex.Message); }
                        }
                    }
                    catch (Exception ex) { WeLog.Info("keyplan", "template — " + ex.Message); tpl = false; }
                }
                if (!tpl)
                {
                    try { v.ViewTemplateId = ElementId.InvalidElementId; } catch { }
                    if (!copied) try { v.Discipline = ViewDiscipline.Coordination; } catch { }   // Structural төрөлд архитектурын хана нуугдана
                }
                string name = WeNaming.Clean("Түлхүүр байгуулалт — " + (string.IsNullOrEmpty(g.Label) ? g.RoomNumber : g.Label));
                name = SetName(v, name);
                // Давхрын нэр хуудасны нэрэнд байгаа — гарчиг богино (оффисын том гарчгийн фонтод зүүн багана хэт өргөн болдог).
                SetTitle(v, "ХАНЫН ДЭЛГЭЭСИЙН ТҮЛХҮҮР БАЙГУУЛАЛТ " + g.Label,
                         t => t.StartsWith("Ханын дэлгээсийн түлхүүр байгуулалт", StringComparison.OrdinalIgnoreCase));
                GeneratedElevationRepository.Write(v, new WeRecord
                {
                    Kind = GeneratedElevationRepository.KindKeyPlan, Key = kp.Key, RoomUid = g.RoomUid,
                    GeneratedName = name, GeneratorVersion = WeIdentity.GeneratorVersion,
                });
            }
            else Rerange(v, g, kp);

            // Масштаб (W03, 2026-10-16): тохиргооны «Түлхүүр планы масштаб» ЯГ (<see cref="WeKeyPlanner.ExpectedScale"/>) — өрөөний хэмжээ, хуудсанд
            // багтаахаар хэзээ ч томруулахгүй (өмнө нь GATEWAY 310-д 1:125 болгодог байсан).  Дахин ажиллуулахад: хэрэглэгч гараар сольсон (эсвэл өмнөх
            // хувилбарын тохируулсан, төлөвгүй) масштабыг хадгална — тохиргоо өөрчлөгдсөн үед л шинэ утга (хуудсан дээрх байрлалыг хэрэглэгч цэгцэлнэ).
            {
                WeViewState st = WeViewStateStore.Read(v);
                WeScaleRule.Decision dec = WeScaleRule.Decide(v.Scale, st.Scale, kp.Scale, created, false);
                try { if (v.Scale != dec.Apply) v.Scale = dec.Apply; } catch (Exception ex) { WeLog.Info("keyplan", v.Name + ": масштаб — " + ex.Message); }
                if (dec.KeptManual) WeLog.Info("keyplan", v.Name + ": гараар тавьсан масштаб 1:" + v.Scale + " хэвээр (тохиргоо 1:" + kp.Scale + ")");
                st.Scale = dec.Record;
                WeViewStateStore.Write(v, st);
            }
            if (created) RotateLikeOffice(v);
            SetCrop(v, kp);
            // Зүсэлтийн шугам, callout — үргэлж нуух (өрөөг дайрсан урт шугам).  Elevation маркер — Elevation дэлгээс байвал ХАРАГДАНА
            // (жишээ хуудасны 206A… тэмдэг нь яг энэ), үгүй бол нуух.
            bool native = nativeKeys != null && nativeKeys.Count > 0;
            foreach (BuiltInCategory bic in new[] { BuiltInCategory.OST_Sections, BuiltInCategory.OST_Elev, BuiltInCategory.OST_Callouts })
            {
                try
                {
                    var cid = new ElementId(bic);
                    bool hide = bic != BuiltInCategory.OST_Elev || !native;
                    if (v.CanCategoryBeHidden(cid) && v.GetCategoryHidden(cid) != hide) v.SetCategoryHidden(cid, hide);
                }
                catch { }
            }

            // Өмнөх зураг + хуулбарт дагаж ирсэн «манай» хэлбэрийн элемент (хуулсан харагдацыг хэрэгсэл үргэлжлүүлж авсан бол).
            var old = new HashSet<ElementId>(WeAnnoStore.Previous(_doc, v));
            foreach (ElementId id in OwnStyledElements(v)) old.Add(id);
            if (old.Count > 0) _doc.Delete(old.ToList());
            ResolveStyles();
            var ids = new List<ElementId>();
            DrawRoom(v, room, ids, notes);
            DrawMarkers(v, kp, native ? drawnKeys.Where(k => !nativeKeys.Contains(k)).ToList() : drawnKeys, ids);
            TagRoom(v, room, kp, ids, notes);
            DimRoom(v, room, ids);
            FillRoom(v, ids, notes);
            if (_s.RedFrame) DrawFrame(v, ids, notes);
            WeAnnoStore.Write(_doc, v, ids);
            HideForeignMarkers(v, room);
            HideLinkGrids(v);
            // Тэнхлэгийг хүрээнд тайрч, annotation crop (бодит загварт 25 тэнхлэг барилгын бүтэн өргөнөөр сунаж viewport-ийг аварга болгосон).
            try { _doc.Regenerate(); WeViewTidy.TidyPlan(_doc, v, 5); }
            catch (Exception ex) { WeLog.Info("keyplan", v.Name + ": цэгцлэх — " + ex.Message); }
            return v;
        }

        /// <summary>
        /// Өмнөх түлхүүр план — үсгийн муж өөрчлөгдсөн бол (2026-10-14, «+ Хана нэмэх»: E нэмэгдсэн) хэрэгслийн өгсөн нэр, «Title on Sheet»-ийг
        /// шинэчилнэ («Түлхүүр байгуулалт — 101A-D» → «…101A-E»).  Хэрэглэгч өөрчилсөнийг хөндөхгүй (<see cref="WeNaming.Rerange"/>).
        /// </summary>
        private void Rerange(View v, WeGroupInfo g, WeKeyPlan kp)
        {
            if (string.IsNullOrEmpty(g.Label) || string.IsNullOrEmpty(g.SideRange)) return;
            string next = WeNaming.Rerange(v.Name, WeNaming.Clean("Түлхүүр байгуулалт — " + g.Label), g.SideRange);
            if (next != null && !_names.Contains(next))
            {
                string was = v.Name;
                try
                {
                    v.Name = next;
                    _names.Add(next);
                    GeneratedElevationRepository.Write(v, new WeRecord
                    {
                        Kind = GeneratedElevationRepository.KindKeyPlan, Key = kp.Key, RoomUid = g.RoomUid,
                        GeneratedName = next, GeneratorVersion = WeIdentity.GeneratorVersion,
                    });
                    WeLog.Info("keyplan", "«" + was + "» → «" + next + "» (үсгийн муж)");
                }
                catch (Exception ex) { WeLog.Info("keyplan", was + ": мужийг шинэчилсэнгүй — " + ex.Message); }
            }
            string title = "ХАНЫН ДЭЛГЭЭСИЙН ТҮЛХҮҮР БАЙГУУЛАЛТ " + g.Label;
            SetTitle(v, title, t => WeNaming.Rerange(t.Trim(), title, g.SideRange) != null);
        }

        // ── Харагдац ────────────────────────────────────────────────

        private string SetName(View v, string desired)
        {
            string n = WeNaming.Unique(desired, _names);
            for (int i = 0; i < 20; i++)
            {
                try { v.Name = n; _names.Add(n); return n; }
                catch (Autodesk.Revit.Exceptions.ArgumentException) { _names.Add(n); n = WeNaming.Unique(desired, _names); }
            }
            return v.Name;
        }

        /// <summary>«Title on Sheet» — зөвхөн хоосон бол (хэрэглэгчийн бичсэнийг дарахгүй).</summary>
        internal static void SetTitle(View v, string title, Func<string, bool> ours = null)
        {
            if (string.IsNullOrWhiteSpace(title)) return;
            try
            {
                Parameter p = v.get_Parameter(BuiltInParameter.VIEW_DESCRIPTION);
                if (p == null || p.IsReadOnly) return;
                string cur = p.AsString();
                // Хоосон — бичнэ; хэрэгслийн өмнө бичсэн гарчиг (загвартаа таарсан) өөрчлөгдсөн бол шинэчилнэ; хэрэглэгчийнхийг хөндөхгүй.
                if (string.IsNullOrWhiteSpace(cur) || (ours != null && !string.Equals(cur.Trim(), title.Trim(), StringComparison.Ordinal) && ours(cur)))
                    p.Set(title.Trim());
            }
            catch { }
        }

        /// <summary>
        /// Оффисын түлхүүр план шиг crop-ыг эргүүлнэ (<see cref="WeProjectStandards.KeyPlanRight"/>).  ХЭМЖСЭН (Revit 2024, 2026-10-08): ViewPlan-ийн
        /// <c>CropBox</c>-д эргүүлсэн Transform өгвөл ҮЛ ТООНО, <c>GetDependentElements(OST_Viewers)</c> хоосон — crop-ын элемент нь
        /// CropBoxVisible-ийг асаахад харагдацын collector-т НЭМЭГДДЭГ элемент; түүнийг эргүүлэхэд RightDirection = (0,1,0), дараа нь
        /// <see cref="SetCrop"/> хүрээг шинэ (эргүүлсэн) координатаар тавина.
        /// </summary>
        private void RotateLikeOffice(View v)
        {
            XYZ want = _res.Standards != null && _res.Standards.Found ? _res.Standards.KeyPlanRight : null;
            if (want == null) return;
            try
            {
                XYZ cur = v.RightDirection;
                double ang = Math.Atan2(cur.X * want.Y - cur.Y * want.X, cur.X * want.X + cur.Y * want.Y);
                if (Math.Abs(ang) < 1e-6) return;
                v.CropBoxActive = true;
                bool vis = v.CropBoxVisible;
                v.CropBoxVisible = false; _doc.Regenerate();
                var off = new HashSet<ElementId>(new FilteredElementCollector(_doc, v.Id).ToElementIds());
                v.CropBoxVisible = true; _doc.Regenerate();
                ElementId crop = new FilteredElementCollector(_doc, v.Id).ToElementIds().FirstOrDefault(id => !off.Contains(id));
                if (crop != null)
                {
                    BoundingBoxXYZ cb = v.CropBox;
                    XYZ c = cb.Transform.OfPoint((cb.Min + cb.Max) / 2);
                    ElementTransformUtils.RotateElement(_doc, crop, Line.CreateBound(c, c + XYZ.BasisZ), ang);
                }
                v.CropBoxVisible = vis;
                WeLog.Info("keyplan", v.Name + ": оффисын түлхүүр план шиг " + Math.Round(ang * 180 / Math.PI) + "° эргүүлэв" + (crop == null ? " — crop элемент олдсонгүй" : ""));
            }
            catch (Exception ex) { WeLog.Info("keyplan", v.Name + ": эргүүлэх — " + ex.Message); }
        }

        private static void SetCrop(View v, WeKeyPlan kp)
        {
            v.CropBoxActive = true;
            try { v.CropBoxVisible = false; } catch { }
            BoundingBoxXYZ cb = v.CropBox;
            Transform inv = cb.Transform.Inverse;
            double z = cb.Transform.Origin.Z;
            double x0 = double.MaxValue, y0 = double.MaxValue, x1 = double.MinValue, y1 = double.MinValue;
            foreach (XYZ p in new[] { new XYZ(kp.MinX, kp.MinY, z), new XYZ(kp.MaxX, kp.MinY, z), new XYZ(kp.MaxX, kp.MaxY, z), new XYZ(kp.MinX, kp.MaxY, z) })
            {
                XYZ l = inv.OfPoint(p);
                x0 = Math.Min(x0, l.X); y0 = Math.Min(y0, l.Y);
                x1 = Math.Max(x1, l.X); y1 = Math.Max(y1, l.Y);
            }
            v.CropBox = new BoundingBoxXYZ { Transform = cb.Transform, Min = new XYZ(x0, y0, cb.Min.Z), Max = new XYZ(x1, y1, cb.Max.Z) };
        }

        // ── Хэв маяг (нэг удаа, загварт байхгүй бол үүсгэнэ) ────────

        private void ResolveStyles()
        {
            if (_stylesResolved) return;
            _stylesResolved = true;
            try { _line = LineStyle(); } catch (Exception ex) { WeLog.Error("keyplan", "шугамын хэв маяг", ex); }
            try { _text = TextType(); } catch (Exception ex) { WeLog.Error("keyplan", "бичвэрийн төрөл", ex); }
            try { _fill = FillType(); } catch (Exception ex) { WeLog.Error("keyplan", "штрихийн төрөл", ex); }
        }

        private GraphicsStyle LineStyle()
        {
            Category lines = _doc.Settings.Categories.get_Item(BuiltInCategory.OST_Lines);
            if (lines == null) return null;
            Category sub = lines.SubCategories.Contains(LineStyleName) ? lines.SubCategories.get_Item(LineStyleName) : null;
            if (sub == null)
            {
                sub = _doc.Settings.Categories.NewSubcategory(lines, LineStyleName);
                sub.LineColor = new Color(200, 40, 40);
                sub.SetLineWeight(5, GraphicsStyleType.Projection);
                LinePatternElement dash = LinePatternElement.GetLinePatternElementByName(_doc, "Dash")
                                          ?? new FilteredElementCollector(_doc).OfClass(typeof(LinePatternElement)).Cast<LinePatternElement>()
                                                 .FirstOrDefault(l => l.Name.IndexOf("Dash", StringComparison.OrdinalIgnoreCase) >= 0);
                if (dash != null) sub.SetLinePatternId(dash.Id, GraphicsStyleType.Projection);
            }
            return sub.GetGraphicsStyle(GraphicsStyleType.Projection);
        }

        private ElementId TextType()
        {
            TextNoteType t = new FilteredElementCollector(_doc).OfClass(typeof(TextNoteType)).Cast<TextNoteType>().FirstOrDefault(x => x.Name == TextTypeName);
            if (t != null) return t.Id;
            var baseType = _doc.GetElement(_doc.GetDefaultElementTypeId(ElementTypeGroup.TextNoteType)) as TextNoteType
                           ?? new FilteredElementCollector(_doc).OfClass(typeof(TextNoteType)).Cast<TextNoteType>().FirstOrDefault();
            if (baseType == null) return ElementId.InvalidElementId;
            t = (TextNoteType)baseType.Duplicate(TextTypeName);
            Set(t, BuiltInParameter.TEXT_SIZE, _u.MmToInternal(2.5));
            Set(t, BuiltInParameter.TEXT_BOX_VISIBILITY, 1);
            Set(t, BuiltInParameter.TEXT_BACKGROUND, 0);   // тунгалаг биш — штрих бичвэрийг дарахгүй
            Set(t, BuiltInParameter.TEXT_STYLE_BOLD, 1);
            Parameter arrow = t.get_Parameter(BuiltInParameter.LEADER_ARROWHEAD);
            if (arrow != null && !arrow.IsReadOnly && arrow.AsElementId() == ElementId.InvalidElementId)
            {
                ElementType a = new FilteredElementCollector(_doc).OfClass(typeof(ElementType)).Cast<ElementType>()
                    .Where(x => x.FamilyName == "Arrowhead").OrderBy(x => x.Name.IndexOf("Filled", StringComparison.OrdinalIgnoreCase) >= 0 ? 0 : 1).FirstOrDefault();
                if (a != null) arrow.Set(a.Id);
            }
            return t.Id;
        }

        /// <summary>
        /// Өрөөний тодруулга = ЦАЙВАР ЯГААН ХАТУУ дүүргэлт (харагдацад 55 % тунгалаг болгоно — <see cref="Transparent"/>), жишээ зургийнх шиг.
        /// ⚠️ ХЭМЖСЭН (Revit 2027): налуу штрихийн төрлийг хувилж өнгийг нь сольход хар, улаан хоёр багц зураас зурагдсан (шалтгаан
        /// тодорхойгүй) — хатуу дүүргэлт + тунгалаг байдал цэвэр гарсан.
        /// </summary>
        private ElementId FillType()
        {
            List<FilledRegionType> all = new FilteredElementCollector(_doc).OfClass(typeof(FilledRegionType)).Cast<FilledRegionType>().ToList();
            FilledRegionType t = all.FirstOrDefault(x => x.Name == FillTypeName);
            if (t != null) return t.Id;
            Func<ElementId, bool> solid = id =>
            {
                var fe = _doc.GetElement(id) as FillPatternElement;
                FillPattern fp = fe != null ? fe.GetFillPattern() : null;
                return fp != null && fp.IsSolidFill;
            };
            FilledRegionType baseType = all.FirstOrDefault(x => solid(x.ForegroundPatternId)) ?? all.FirstOrDefault();
            if (baseType == null) return ElementId.InvalidElementId;
            t = (FilledRegionType)baseType.Duplicate(FillTypeName);
            if (!solid(t.ForegroundPatternId))
            {
                FillPatternElement sf = new FilteredElementCollector(_doc).OfClass(typeof(FillPatternElement)).Cast<FillPatternElement>()
                    .FirstOrDefault(f => { FillPattern fp = f.GetFillPattern(); return fp != null && fp.IsSolidFill; });
                if (sf == null) return ElementId.InvalidElementId;
                t.ForegroundPatternId = sf.Id;
            }
            t.ForegroundPatternColor = new Color(248, 200, 200);
            try { t.BackgroundPatternId = ElementId.InvalidElementId; } catch { }
            t.IsMasking = false;
            _doc.Regenerate();
            return t.Id;
        }

        /// <summary>Дүүргэлтийг энэ харагдацад тунгалаг болгоно; чадахгүй бол (хуучин Revit) дүүргэлтийг устгана — загвар далдлахгүйн тулд.</summary>
        private bool Transparent(View v, ElementId region)
        {
            try
            {
                var ogs = new OverrideGraphicSettings();
                ogs.SetSurfaceTransparency(55);
                v.SetElementOverrides(region, ogs);
                return v.GetElementOverrides(region).Transparency == 55;
            }
            catch (Exception ex)
            {
                WeLog.Info("keyplan", v.Name + ": тунгалаг байдал — " + ex.Message);
                return false;
            }
        }

        private static void Set(Element e, BuiltInParameter bip, double v)
        {
            try { Parameter p = e.get_Parameter(bip); if (p != null && !p.IsReadOnly) p.Set(v); } catch { }
        }

        private static void Set(Element e, BuiltInParameter bip, int v)
        {
            try { Parameter p = e.get_Parameter(bip); if (p != null && !p.IsReadOnly) p.Set(v); } catch { }
        }

        // ── Зураг ──────────────────────────────────────────────────

        /// <summary>Өрөөний бодит хил (муруй сегменттэй ч) — штрих + тасархай улаан хүрээ.  Чадахгүй бол алгасаад тэмдэглэнэ.</summary>
        private void DrawRoom(View v, Room room, List<ElementId> ids, List<string> notes)
        {
            if (room == null) return;
            List<List<KeyValuePair<Curve, BoundarySegment>>> segs = HostLoops(room);
            if (segs == null || segs.Count == 0) return;
            // Харагдацын хавтгай (түвшний өндөр) дээр — хилийн муруй өрөөний суурийн шилжилттэй байж болно.
            double z = v.GenLevel != null ? v.GenLevel.ProjectElevation : 0;
            var loops = new List<CurveLoop>();
            bool outerFailed = false;
            for (int li = 0; li < segs.Count; li++)
            {
                List<KeyValuePair<Curve, BoundarySegment>> loop = segs[li];
                var curves = new List<Curve>();
                foreach (KeyValuePair<Curve, BoundarySegment> kvb in loop)
                {
                    Curve c = kvb.Key;
                    if (c == null || !c.IsBound || c.Length < 1e-4) continue;
                    double dz = z - c.GetEndPoint(0).Z;
                    curves.Add(Math.Abs(dz) > 1e-9 ? c.CreateTransformed(Transform.CreateTranslation(new XYZ(0, 0, dz))) : c);
                }
                if (curves.Count < 2) continue;
                // 2026-10-14 (интерьерийн баг 3-р тойрог, жишээ хуудас 238): улаан тасархай хүрээ асаалттай бол өрөөний хилээр БИШ — бүх өрөөг
                // (хана орсон) crop-ын дотор бөөрөнхий хүрээгээр (<see cref="DrawFrame"/>); өрөөний ягаан тодруулга хэвээр.
                if (!_s.RedFrame)
                    foreach (Curve c in curves)
                    {
                        try
                        {
                            DetailCurve dc = _doc.Create.NewDetailCurve(v, c);
                            if (_line != null) dc.LineStyle = _line;
                            ids.Add(dc.Id);
                        }
                        catch (Exception ex) { WeLog.Info("keyplan", v.Name + ": хилийн шугам — " + ex.Message); }
                    }
                try { loops.Add(CurveLoop.Create(curves)); }
                catch { if (li == 0) outerFailed = true; /* хаалттай биш — штрихгүй */ }
            }
            // Гадна хил бүтэхгүй бол дотор арлын (багана) хилээр дүүргэвэл өрөө биш БАГАНА тодорно (аудит) — дүүргэлтгүй.
            _fillLoops = _fill == ElementId.InvalidElementId || loops.Count == 0 || outerFailed ? null : loops;
            _fillZ = z;
        }

        private List<CurveLoop> _fillLoops;
        private double _fillZ;

        /// <summary>
        /// Түлхүүр план бүрийн дүүргэлтийн ЭХ (анхны өрөөний хил, хавтгай, хассан хайрцгийн тэмдэг) — <see cref="RefillAfterMarkers"/> дүүргэлтийг
        /// ЭНЭ хилээс нэг алхмаар дахин бодно (<see cref="WeFillHoles"/>: эхний ба дахин ажиллуулалтын хил сегмент бүрээр ижил).
        /// </summary>
        private sealed class FillSource
        {
            public List<CurveLoop> Loops;
            public double Z;
            public string Signature;
        }

        private readonly Dictionary<long, FillSource> _fillSrc = new Dictionary<long, FillSource>();

        /// <summary>
        /// Түлхүүр планы crop-ын ДОТОР бөөрөнхий улаан тасархай хүрээ — өрөө, ханыг бүхэлд нь хүрээлнэ (жишээ хуудас 238; <see cref="WeRedFrame"/>).
        /// Crop-ын тэнхлэгээр (оффисын шиг эргүүлсэн планд ч), түвшний хавтгай дээр.
        /// </summary>
        private void DrawFrame(View v, List<ElementId> ids, List<string> notes)
        {
            try
            {
                if (!v.CropBoxActive) return;
                BoundingBoxXYZ cb = v.CropBox;
                Transform tf = cb.Transform;
                double z = v.GenLevel != null ? v.GenLevel.ProjectElevation : tf.Origin.Z;
                Func<double, double, XYZ> pt = (lx, ly) => { XYZ w = tf.OfPoint(new XYZ(lx, ly, 0)); return new XYZ(w.X, w.Y, z); };
                XYZ xa = new XYZ(tf.BasisX.X, tf.BasisX.Y, 0).Normalize(), ya = new XYZ(tf.BasisY.X, tf.BasisY.Y, 0).Normalize();
                double paper = _u.MmToInternal(Math.Max(1, v.Scale));
                ids.AddRange(WeRedFrame.Draw(_doc, v, pt, xa, ya, cb.Min.X, cb.Min.Y, cb.Max.X, cb.Max.Y, paper, notes));
            }
            catch (Exception ex) { WeLog.Info("keyplan", v.Name + ": улаан хүрээ — " + ex.Message); }
        }

        /// <summary>
        /// Өрөөний цайвар дүүргэлт — шошго, тэмдэг ЗУРАГДСАНЫ ДАРАА.  ХЭМЖСЭН (live gate 2024, 2026-10-14): интерьерийн баг «түлхүүр план дээрх
        /// нэр, шошгыг огт сонгож болохгүй» — хатуу дүүргэлтийн ДОТОР тал бүхэлдээ сонгогдох бүс (Revit: «Detail Items : Filled region»), шошгоны
        /// дээр дарахад дүүргэлт сонгогдсон (draw order-оор ард шилжүүлсэн ч).  Тиймээс дүүргэлтийг шошго, бичвэр тэмдэг, дэлгээсийн маркер
        /// бүрийн доороос (цаасан дээр 1.5 мм зайтай) НҮХЭЛНЭ — тэнд зөвхөн шошго байх тул ЯГ тэр сонгогдож, чирж зөөгдөнө.  Нүхлэх
        /// боломжгүй бол (Boolean алдаа) бүтэн дүүргэлт + хамгийн ард.
        /// </summary>
        private void FillRoom(View v, List<ElementId> ids, List<string> notes)
        {
            List<CurveLoop> loops = _fillLoops;
            _fillLoops = null;
            if (loops == null) return;
            List<CurveLoop> shape = loops;
            string sig = string.Empty;
            try
            {
                _doc.Regenerate();
                List<double[]> rects = WeFillHoles.Sorted(LabelBoxes(v, ids).Select(PlanRect));
                sig = WeFillHoles.Signature(rects);
                List<CurveLoop> holed = Holed(v, loops, rects);
                if (holed != null && holed.Count > 0) shape = holed;
            }
            catch (Exception ex) { WeLog.Info("keyplan", v.Name + ": дүүргэлтийг нүхлэх — " + ex.Message); }
            _fillSrc[v.Id.Value] = new FillSource { Loops = loops, Z = _fillZ, Signature = sig };
            FilledRegion fr = null;
            try { fr = FilledRegion.Create(_doc, _fill, v.Id, shape); }
            catch (Exception ex)
            {
                if (shape != loops)
                {
                    WeLog.Info("keyplan", v.Name + ": нүхтэй дүүргэлт — " + ex.Message + " (бүтнээр)");
                    try { fr = FilledRegion.Create(_doc, _fill, v.Id, loops); } catch (Exception ex2) { ex = ex2; }
                }
                if (fr == null)
                {
                    WeLog.Info("keyplan", v.Name + ": штрих — " + ex.Message);
                    notes.Add("Түлхүүр план: өрөөний штрих зурж чадсангүй (хүрээ нь хэвээр) — " + ex.Message);
                    return;
                }
            }
            try
            {
                if (!Transparent(v, fr.Id)) { _doc.Delete(fr.Id); return; }
                ids.Add(fr.Id);
                try { DetailElementOrderUtils.SendToBack(_doc, v, new List<ElementId> { fr.Id }); }
                catch (Exception ex) { WeLog.Info("keyplan", v.Name + ": дүүргэлтийг ард — " + ex.Message); }
            }
            catch (Exception ex) { WeLog.Info("keyplan", v.Name + ": штрих — " + ex.Message); }
        }

        /// <summary>
        /// Elevation горимд түлхүүр план дэлгээсээс ӨМНӨ үүсдэг (маркерын хост) — дүүргэлт зурагдах үед маркер байгаагүй.  Маркер үүссэний
        /// ДАРАА манай дүүргэлтийг маркерын доороос нүхэлж шинэчилнэ (одоо байгаа хил − маркерын хайрцаг) — эс бөгөөс анхны ажиллуулалт ба
        /// дахин ажиллуулалтын зураг зөрнө (gate RERUN-101, 2026-10-14: sketch 8 → 12) ба маркер дүүргэлтийн доор сонгогдохгүй.
        /// Хасах зүйлгүй бол юу ч хийхгүй.  Transaction дотор дуудна.
        /// 2026-10-16 (live gate PRESET-KEEP-B102): одоогийн (аль хэдийн нүхэлсэн) хил дээр маркерыг НЭМЖ хасахад хоёр алхмын Boolean-ийн хил
        /// дахин ажиллуулалтын нэг алхмынхаас сегментээр зөрдөг байв (sketch 12 ↔ 13).  Одоо энэ ажиллуулалтын <see cref="FillRoom"/>-ын анхны
        /// өрөөний хилээс бүх хайрцгийг (шошго + маркер) тогтмол эрэмбээр нэг алхмаар — дахин ажиллуулалтын <see cref="FillRoom"/>-той ЯГ ижил;
        /// хайрцгийн тэмдэг өөрчлөгдөөгүй бол хөндөхгүй.
        /// </summary>
        /// <param name="finalPass">
        /// Хуудас, лавлагааны ДАРАА (ажлын төгсгөл): энэ ажиллуулалтад зураагүй (эх хил мэдэгдэхгүй) түлхүүр планыг ХӨНДӨХГҮЙ — хоёр алхмын хуучин
        /// замаар тайрвал дахин ажиллуулалтын хилээс зөрнө.
        /// </param>
        /// <returns>Дүүргэлтийг дахин зурсан эсэх.</returns>
        public bool RefillAfterMarkers(ViewPlan v, bool finalPass = false)
        {
            if (v == null || !v.IsValidObject) return false;
            try
            {
                List<ElementId> own = WeAnnoStore.Previous(_doc, v);
                FilledRegion fr = own.Select(id => _doc.GetElement(id) as FilledRegion).FirstOrDefault(x => x != null && x.OwnerViewId == v.Id);
                if (fr == null) return false;
                FillSource src;
                if (_fillSrc.TryGetValue(v.Id.Value, out src) && src.Loops != null && src.Loops.Count > 0)
                {
                    _doc.Regenerate();
                    List<double[]> rects = WeFillHoles.Sorted(LabelBoxes(v, own).Select(PlanRect));
                    string sig = WeFillHoles.Signature(rects);
                    if (sig == src.Signature) return false;
                    _fillZ = src.Z;
                    List<CurveLoop> shape = Holed(v, src.Loops, rects);
                    if (shape == null || shape.Count == 0) shape = src.Loops;
                    FilledRegion rf = FilledRegion.Create(_doc, fr.GetTypeId(), v.Id, shape);
                    if (!Transparent(v, rf.Id)) { _doc.Delete(rf.Id); return false; }
                    try { DetailElementOrderUtils.SendToBack(_doc, v, new List<ElementId> { rf.Id }); } catch { }
                    ElementId was = fr.Id;
                    _doc.Delete(was);
                    WeAnnoStore.Write(_doc, v, own.Where(id => id != was).Concat(new[] { rf.Id }).ToList());
                    src.Signature = sig;
                    if (finalPass) WeLog.Info("keyplan", v.Name + ": дүүргэлтийг эцсийн шошго/маркераар дахин тулгав (" + rects.Count + " хайрцаг)");
                    return true;
                }
                if (finalPass) return false;
                IList<CurveLoop> cur = fr.GetBoundaries();
                if (cur == null || cur.Count == 0) return false;
                var markers = new List<BoundingBoxXYZ>();
                foreach (Element e in new FilteredElementCollector(_doc, v.Id).OfClass(typeof(ElevationMarker)))
                {
                    BoundingBoxXYZ bb = null;
                    try { bb = e.get_BoundingBox(v); } catch { }
                    if (bb != null && bb.Max.X > bb.Min.X && bb.Max.Y > bb.Min.Y) markers.Add(bb);
                }
                if (markers.Count == 0) return false;
                _fillZ = cur[0].First().GetEndPoint(0).Z;
                List<CurveLoop> holed = Holed(v, cur.ToList(), WeFillHoles.Sorted(markers.Select(PlanRect)));
                if (holed == null || holed.Count == 0) return false;
                FilledRegion nf = FilledRegion.Create(_doc, fr.GetTypeId(), v.Id, holed);
                if (!Transparent(v, nf.Id)) { _doc.Delete(nf.Id); return false; }
                try { DetailElementOrderUtils.SendToBack(_doc, v, new List<ElementId> { nf.Id }); } catch { }
                ElementId old = fr.Id;
                _doc.Delete(old);
                WeAnnoStore.Write(_doc, v, own.Where(id => id != old).Concat(new[] { nf.Id }).ToList());
                return true;
            }
            catch (Exception ex) { WeLog.Info("keyplan", v.Name + ": маркерын доороос нүхлэх — " + ex.Message); return false; }
        }

        /// <summary>Сонгогдох ёстой бичвэрийн хайрцгууд (план XY): манай бичвэр тэмдэг, өрөөний шошго, энэ харагдацын дэлгээсийн маркер.</summary>
        private List<BoundingBoxXYZ> LabelBoxes(View v, List<ElementId> ids)
        {
            var boxes = new List<BoundingBoxXYZ>();
            var seen = new HashSet<long>();
            Action<Element> add = e =>
            {
                if (e == null || !seen.Add(e.Id.Value)) return;
                BoundingBoxXYZ bb = null;
                // Бичвэр тэмдэг: хайрцаг нь leader-ийг (хана хүртэл) агуулдаг — зөвхөн бичвэрийн хэсгийг.
                var tn = e as TextNote;
                if (tn != null) bb = TextBox(v, tn);
                if (bb == null) { try { bb = e.get_BoundingBox(v); } catch { } }
                if (bb != null && bb.Max.X > bb.Min.X && bb.Max.Y > bb.Min.Y) boxes.Add(bb);
            };
            foreach (ElementId id in ids)
            {
                Element e = _doc.GetElement(id);
                if (e is TextNote || e is SpatialElementTag || e is IndependentTag) add(e);
            }
            try
            {
                foreach (Element e in new FilteredElementCollector(_doc, v.Id).OfClass(typeof(ElevationMarker))) add(e);
                foreach (Element e in new FilteredElementCollector(_doc, v.Id).OfCategory(BuiltInCategory.OST_RoomTags).WhereElementIsNotElementType()) add(e);
            }
            catch { }
            return boxes;
        }

        /// <summary>Төв/дунд тэгшилсэн бичвэрийн (DrawMarkers) хайрцаг — байрлал, өргөн, мөрийн тоо × үсгийн өндрөөр (leader-гүй).</summary>
        private BoundingBoxXYZ TextBox(View v, TextNote tn)
        {
            try
            {
                double scale = Math.Max(1, v.Scale);
                double size = 2.5 / 304.8;
                Element type = _doc.GetElement(tn.GetTypeId());
                Parameter sp = type != null ? type.get_Parameter(BuiltInParameter.TEXT_SIZE) : null;
                if (sp != null && sp.AsDouble() > 0) size = sp.AsDouble();
                string[] rows = (tn.Text ?? string.Empty).TrimEnd('\r', '\n').Split('\r');
                int lines = Math.Max(1, rows.Length), chars = Math.Max(1, rows.Max(x => x.Length));
                // Өргөн: бичвэрийн уртаар (≈ 0.8 × өндөр нэг тэмдэгтэд), хайрцгийн өргөнөөс хэтрэхгүй (TextNote.Width — цаасан дээр).
                double hw = Math.Min(Math.Max(tn.Width, size), chars * size * 0.8) * scale / 2, hh = lines * size * 1.6 * scale / 2;
                XYZ c = tn.Coord, r = v.RightDirection, u = v.UpDirection;
                var pts = new[] { c - r * hw - u * hh, c + r * hw - u * hh, c + r * hw + u * hh, c - r * hw + u * hh };
                return new BoundingBoxXYZ
                {
                    Min = new XYZ(pts.Min(q => q.X), pts.Min(q => q.Y), c.Z),
                    Max = new XYZ(pts.Max(q => q.X), pts.Max(q => q.Y), c.Z),
                };
            }
            catch { return null; }
        }

        /// <summary>План дээрх тэгш өнцөгт {x0, y0, x1, y1} (bounding box-ийн хувиргалттай, зайгүй).</summary>
        private static double[] PlanRect(BoundingBoxXYZ bb)
        {
            Transform t = bb.Transform ?? Transform.Identity;
            XYZ a = t.OfPoint(bb.Min), b = t.OfPoint(bb.Max);
            return new[] { Math.Min(a.X, b.X), Math.Min(a.Y, b.Y), Math.Max(a.X, b.X), Math.Max(a.Y, b.Y) };
        }

        /// <summary>
        /// Дүүргэлтийн хил − (хайрцаг бүр + цаасан дээр 1.5 мм) — нимгэн биеийн Boolean хасалт, доод нүүрний хилээр.  Хайрцгийг
        /// <see cref="WeFillHoles.Sorted"/>-ийн эрэмбээр өгнө (ижил оролт → ижил хил).  Алдаа → null.
        /// </summary>
        private List<CurveLoop> Holed(View v, List<CurveLoop> loops, List<double[]> rects)
        {
            if (rects.Count == 0) return null;
            double z = _fillZ, h = 1.0;
            double pad = 1.5 / 304.8 * Math.Max(1, v.Scale);
            Solid body = GeometryCreationUtilities.CreateExtrusionGeometry(loops, XYZ.BasisZ, h);
            int cut = 0;
            foreach (double[] r in rects)
            {
                double x0 = r[0] - pad, x1 = r[2] + pad, y0 = r[1] - pad, y1 = r[3] + pad;
                var rect = new CurveLoop();
                var c = new[] { new XYZ(x0, y0, z - 0.5), new XYZ(x1, y0, z - 0.5), new XYZ(x1, y1, z - 0.5), new XYZ(x0, y1, z - 0.5) };
                for (int i = 0; i < 4; i++) rect.Append(Line.CreateBound(c[i], c[(i + 1) % 4]));
                Solid box = GeometryCreationUtilities.CreateExtrusionGeometry(new List<CurveLoop> { rect }, XYZ.BasisZ, h + 1.0);
                Solid next = BooleanOperationsUtils.ExecuteBooleanOperation(body, box, BooleanOperationsType.Difference);
                if (next == null || next.Volume <= 1e-9) continue;   // бүх өрөөг хамарсан (жижиг өрөөнд том шошго) — энэ нүхгүй
                if (Math.Abs(next.Volume - body.Volume) > 1e-9) cut++;
                body = next;
            }
            if (cut == 0) return null;
            var result = new List<CurveLoop>();
            foreach (Face f in body.Faces)
            {
                var pf = f as PlanarFace;
                if (pf == null || pf.FaceNormal.Z > -0.999 || Math.Abs(pf.Origin.Z - z) > 1e-6) continue;
                result.AddRange(pf.GetEdgesAsCurveLoops());
            }
            WeLog.Info("keyplan", v.Name + ": дүүргэлтийг " + cut + " шошгоны доороос нүхлэв");
            return result;
        }

        /// <summary>Энэ харагдацын «манай» хэлбэртэй (шугамын хэв маяг, бичвэр, дүүргэлт) элемент — хуулбарт дагаж ирсэн хуучин зураг.</summary>
        private List<ElementId> OwnStyledElements(View v)
        {
            var list = new List<ElementId>();
            try
            {
                foreach (Element e in new FilteredElementCollector(_doc, v.Id).WhereElementIsNotElementType())
                {
                    if (e.OwnerViewId != v.Id) continue;
                    Element t = _doc.GetElement(e.GetTypeId());
                    if ((e is TextNote && t != null && t.Name == TextTypeName)
                        || (e is FilledRegion && t != null && t.Name == FillTypeName)
                        || (e is DetailCurve && ((DetailCurve)e).LineStyle != null
                            && (((DetailCurve)e).LineStyle.Name == LineStyleName || ((DetailCurve)e).LineStyle.Name == WeRedFrame.StyleName)))
                        list.Add(e.Id);
                }
            }
            catch (Exception ex) { WeLog.Info("keyplan", v.Name + ": хуучин зураг хайх — " + ex.Message); }
            return list;
        }

        private void DrawMarkers(View v, WeKeyPlan kp, ICollection<string> drawnKeys, List<ElementId> ids)
        {
            if (_text == ElementId.InvalidElementId) return;
            double z = v.GenLevel != null ? v.GenLevel.ProjectElevation : 0;
            foreach (WeKeyMarker m in kp.Markers)
            {
                if (drawnKeys != null && !drawnKeys.Contains(m.ElevationKey)) continue;
                try
                {
                    var opts = new TextNoteOptions(_text) { HorizontalAlignment = HorizontalTextAlignment.Center, VerticalAlignment = VerticalTextAlignment.Middle };
                    // W07: хуудасны горимд доор нь хуудасны дугаар («205A / A-301») — хуудасны дараа бодит дугаараар тулгагдана.
                    string sheet = m.Lines > 1 && SheetRefOf != null ? SheetRefOf(m.ElevationKey) : null;
                    TextNote tn = TextNote.Create(_doc, v.Id, new XYZ(m.LabelAt.X, m.LabelAt.Y, z), WeKeyPlanRef.Desired(m.Label ?? "?", sheet), opts);
                    ids.Add(tn.Id);
                    // Leader: бичвэрийн хана руу харсан талаас.
                    XYZ right = v.RightDirection;
                    double side = new XYZ(m.Target.X - m.LabelAt.X, m.Target.Y - m.LabelAt.Y, 0).DotProduct(right);
                    try
                    {
                        Leader l = tn.AddLeader(side >= 0 ? TextNoteLeaderTypes.TNLT_STRAIGHT_R : TextNoteLeaderTypes.TNLT_STRAIGHT_L);
                        l.End = new XYZ(m.Target.X, m.Target.Y, z);
                    }
                    catch (Exception ex) { WeLog.Info("keyplan", v.Name + ": leader " + m.Label + " — " + ex.Message); }
                }
                catch (Exception ex) { WeLog.Info("keyplan", v.Name + ": тэмдэг " + m.Label + " — " + ex.Message); }
            }
        }

        /// <summary>
        /// Өрөөний хэмжээс — жишээ хуудас 206A-G-ийн түлхүүр план (доор «3290 | 2200», зүүн талд «3605»): хилийн сегментүүдийн хананы
        /// НҮҮРЭЭР — Y-тэй зэрэгцээ сегментүүд (X байрлал) доод талд, X-тэй зэрэгцээ (Y байрлал) зүүн талд гинж; хонхойлт бүр гинжийн
        /// цэг.  Ташуу, муруй сегмент алгасна; link-ийн хана → CreateLinkReference.  Хоёроос цөөн нүүр бол тэр чиглэлд хэмжээсгүй.
        /// </summary>
        private static List<KeyValuePair<double, Reference>> DropShort(List<KeyValuePair<double, Reference>> list, double minSeg)
        {
            List<KeyValuePair<double, Reference>> sorted = list.OrderBy(q => q.Key).ToList();
            if (sorted.Count <= 2) return sorted;
            var kept = new List<KeyValuePair<double, Reference>> { sorted[0] };
            for (int i = 1; i < sorted.Count; i++)
            {
                bool last = i == sorted.Count - 1;
                if (sorted[i].Key - kept[kept.Count - 1].Key >= minSeg) { kept.Add(sorted[i]); continue; }
                // Сүүлийн (зах) нүүр — өмнөх дунд нүүрийг солино.
                if (last && kept.Count > 1) kept[kept.Count - 1] = sorted[i];
                else if (last) kept.Add(sorted[i]);
            }
            return kept;
        }

        private void DimRoom(View v, Room room, List<ElementId> ids)
        {
            if (room == null) return;
            List<List<KeyValuePair<Curve, BoundarySegment>>> segs = HostLoops(room);
            if (segs == null || segs.Count == 0) return;
            _finishWalls = null;   // харагдац бүрд дахин (collector нь харагдацынх)
            double z = v.GenLevel != null ? v.GenLevel.ProjectElevation : 0;
            var xs = new List<KeyValuePair<double, Reference>>();
            var ys = new List<KeyValuePair<double, Reference>>();
            double minX = double.MaxValue, minY = double.MaxValue, maxX = double.MinValue, maxY = double.MinValue;
            var lines = new List<KeyValuePair<Line, BoundarySegment>>();
            foreach (List<KeyValuePair<Curve, BoundarySegment>> loop in segs)
                foreach (KeyValuePair<Curve, BoundarySegment> kvb in loop)
                {
                    var c = kvb.Key as Line;
                    if (c == null || c.Length < 0.05) continue;
                    XYZ p0 = c.GetEndPoint(0), p1 = c.GetEndPoint(1);
                    minX = Math.Min(minX, Math.Min(p0.X, p1.X)); maxX = Math.Max(maxX, Math.Max(p0.X, p1.X));
                    minY = Math.Min(minY, Math.Min(p0.Y, p1.Y)); maxY = Math.Max(maxY, Math.Max(p0.Y, p1.Y));
                    lines.Add(new KeyValuePair<Line, BoundarySegment>(c, kvb.Value));
                }
            if (minX > maxX) return;
            // Интерьер: дотоод өнгөлгөөний (host) нимгэн хананы нүүр түрүүлнэ — жишиг «6745» = 6750 − хоёр талын 3 мм хавтан; үгүй бол хилийн
            // элементийн (link-ийн ч) нүүр.
            double cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
            foreach (KeyValuePair<Line, BoundarySegment> lb in lines)
            {
                Line c = lb.Key;
                XYZ p0 = c.GetEndPoint(0), p1 = c.GetEndPoint(1), d = (p1 - p0).Normalize();
                if (Math.Abs(d.X) < 0.01)
                {
                    double x = (p0.X + p1.X) / 2;
                    KeyValuePair<double, Reference>? ff = FinishFace(v, true, x, x < cx ? 1 : -1, Math.Min(p0.Y, p1.Y), Math.Max(p0.Y, p1.Y));
                    Reference r = ff.HasValue ? ff.Value.Value : SegmentFace(lb.Value, true, x);
                    double at = ff.HasValue ? ff.Value.Key : x;
                    if (r != null && !xs.Any(q => Math.Abs(q.Key - at) < 0.02)) xs.Add(new KeyValuePair<double, Reference>(at, r));
                }
                else if (Math.Abs(d.Y) < 0.01)
                {
                    double y = (p0.Y + p1.Y) / 2;
                    KeyValuePair<double, Reference>? ff = FinishFace(v, false, y, y < cy ? 1 : -1, Math.Min(p0.X, p1.X), Math.Max(p0.X, p1.X));
                    Reference r = ff.HasValue ? ff.Value.Value : SegmentFace(lb.Value, false, y);
                    double at = ff.HasValue ? ff.Value.Key : y;
                    if (r != null && !ys.Any(q => Math.Abs(q.Key - at) < 0.02)) ys.Add(new KeyValuePair<double, Reference>(at, r));
                }
            }
            // Цаасан дээр 0.7 мм-ээс богино сегмент (1:50-д 35 мм — 20 мм-ийн хаалт хавтан, хонхор) уншигдахгүй, бичвэр давхцана
            // (ХЭМЖСЭН MITIC 219: «460 20 540», «900 20 920») — захын хоёр нүүр үргэлж үлдэнэ.
            double minSeg = _u.MmToInternal(Core.WeAnnotationPlanner.MinChainSegPaperMm * Math.Max(1, v.Scale));
            xs = DropShort(xs, minSeg);
            ys = DropShort(ys, minSeg);
            WeLog.Info("keyplan", v.Name + ": өрөөний хэмжээсний нүүр X " + xs.Count + ", Y " + ys.Count);
            double off = _u.MmToInternal(9 * Math.Max(1, v.Scale));
            DimensionType dt = string.IsNullOrEmpty(_s.DimTypeName) ? null : _res.DimTypes.FirstOrDefault(t => t.Name == _s.DimTypeName);
            Func<IList<Reference>, Line, Dimension> create = (refs, line) =>
            {
                var ra = new ReferenceArray();
                foreach (Reference r in refs) ra.Append(r);
                return dt != null ? _doc.Create.NewDimension(v, line, ra, dt) : _doc.Create.NewDimension(v, line, ra);
            };
            Action<List<KeyValuePair<double, Reference>>, Line> make = (list, line) =>
            {
                if (list.Count < 2) return;
                List<Reference> ordered = list.OrderBy(q => q.Key).Select(q => q.Value).ToList();
                try
                {
                    Dimension dim = create(ordered, line);
                    if (dim != null) ids.Add(dim.Id);
                    return;
                }
                catch (Exception ex) { WeLog.Info("keyplan", v.Name + ": өрөөний хэмжээс — " + ex.Message + " → хүчинтэй лавлагааг шүүнэ"); }
                // ХЭМЖСЭН (MITIC 2F, link-ийн өрөө): нэг хүчингүй лавлагаа (link-ийн нүүр) бүх гинжийг унагадаг — sub-transaction-д туршиж
                // хүчинтэйг нь л үлдээнэ.
                List<Reference> good = ValidRefs(ordered, line, create);
                if (good.Count == ordered.Count)
                {
                    try { Dimension dim = create(good, line); if (dim != null) { ids.Add(dim.Id); return; } }
                    catch (Exception ex) { WeLog.Info("keyplan", v.Name + ": өрөөний хэмжээс (шүүсэн) — " + ex.Message); }
                }
                // Хүчингүй лавлагааны оронд тэр байрлалд ҮЛ ХАРАГДАХ богино detail шугам (дэлгээсийн EdgeAnchor-ын ижил арга) — link-ийн
                // ханын нүүр планд «Invalid number of references» өгсөн (ХЭМЖСЭН MITIC 218).  Хэмжээс нь тооцсон нүүрийн байрлалыг хэмжинэ.
                var mixed = new List<Reference>();
                var goodSet = new HashSet<Reference>(good);
                XYZ dir = (line.GetEndPoint(1) - line.GetEndPoint(0)).Normalize();
                XYZ perp = new XYZ(-dir.Y, dir.X, 0);
                XYZ origin = line.GetEndPoint(0);
                foreach (KeyValuePair<double, Reference> kv in list.OrderBy(q => q.Key))
                {
                    if (goodSet.Contains(kv.Value)) { mixed.Add(kv.Value); continue; }
                    XYZ at = origin + dir * ((Math.Abs(dir.X) > 0.5 ? kv.Key - origin.X : kv.Key - origin.Y) * Math.Sign(Math.Abs(dir.X) > 0.5 ? dir.X : dir.Y));
                    Reference a = Anchor(v, at, perp, ids);
                    if (a != null) mixed.Add(a);
                }
                if (mixed.Count < 2) return;
                try
                {
                    Dimension dim = create(mixed, line);
                    if (dim != null) ids.Add(dim.Id);
                }
                catch (Exception ex) { WeLog.Info("keyplan", v.Name + ": өрөөний хэмжээс (туслах шугамтай) — " + ex.Message); }
            };
            make(xs, Line.CreateBound(new XYZ(minX - 1, minY - off, z), new XYZ(maxX + 1, minY - off, z)));
            make(ys, Line.CreateBound(new XYZ(minX - off, minY - 1, z), new XYZ(minX - off, maxY + 1, z)));
            // Жишээ хуудас 205A-F: гинжийн гадна НИЙТ хэмжээ («7000», «8000») — хонхойлттой (3+ нүүр) үед л (2 нүүр бол гинж нь өөрөө нийт).
            double step = _u.MmToInternal(7 * Math.Max(1, v.Scale));
            Func<List<KeyValuePair<double, Reference>>, List<KeyValuePair<double, Reference>>> ends = list =>
            {
                List<KeyValuePair<double, Reference>> o = list.OrderBy(q => q.Key).ToList();
                return o.Count > 2 ? new List<KeyValuePair<double, Reference>> { o[0], o[o.Count - 1] } : new List<KeyValuePair<double, Reference>>();
            };
            make(ends(xs), Line.CreateBound(new XYZ(minX - 1, minY - off - step, z), new XYZ(maxX + 1, minY - off - step, z)));
            make(ends(ys), Line.CreateBound(new XYZ(minX - off - step, minY - 1, z), new XYZ(minX - off - step, maxY + 1, z)));
        }

        /// <summary>Лавлагаа бүрийг өмнөх хүчинтэй лавлагаатай хос хэмжээсээр (буцаах sub-transaction) туршина.</summary>
        private List<Reference> ValidRefs(List<Reference> refs, Line line, Func<IList<Reference>, Line, Dimension> create)
        {
            Func<Reference, Reference, bool> pair = (a, b) =>
            {
                using (var st = new SubTransaction(_doc))
                {
                    st.Start();
                    try { return create(new[] { a, b }, line) != null; }
                    catch (Exception ex)
                    {
                        if (!_pairLogged) { _pairLogged = true; WeLog.Info("keyplan", "хос лавлагаа: " + Ref(a) + " | " + Ref(b) + " — " + ex.Message); }
                        return false;
                    }
                    finally { st.RollBack(); }
                }
            };
            for (int start = 0; start < refs.Count - 1; start++)
            {
                var good = new List<Reference> { refs[start] };
                for (int i = start + 1; i < refs.Count; i++)
                    if (pair(good[good.Count - 1], refs[i])) good.Add(refs[i]);
                if (good.Count >= 2) return good;
            }
            return new List<Reference>();
        }

        private bool _pairLogged;

        /// <summary>Хэмжээсний шугамын дагуух <paramref name="at"/> цэгт перпендикуляр богино үл харагдах detail шугам — лавлагаа.</summary>
        private Reference Anchor(View v, XYZ at, XYZ perp, List<ElementId> ids)
        {
            try
            {
                double len = _u.MmToInternal(3 * Math.Max(1, v.Scale));
                DetailCurve dc = _doc.Create.NewDetailCurve(v, Line.CreateBound(at, at + perp * len));
                try
                {
                    Category c = Category.GetCategory(_doc, BuiltInCategory.OST_InvisibleLines);
                    GraphicsStyle gs = c != null ? c.GetGraphicsStyle(GraphicsStyleType.Projection) : null;
                    if (gs != null) dc.LineStyle = gs;
                }
                catch { }
                ids.Add(dc.Id);
                return dc.GeometryCurve.Reference;
            }
            catch (Exception ex) { WeLog.Info("keyplan", v.Name + ": туслах шугам — " + ex.Message); return null; }
        }

        private string Ref(Reference r)
        {
            try { return r.ElementId.Value + (r.LinkedElementId != ElementId.InvalidElementId ? "/link " + r.LinkedElementId.Value : "") + " " + r.ElementReferenceType + " «" + r.ConvertToStableRepresentation(_doc) + "»"; }
            catch { return "?"; }
        }

        private List<Wall> _finishWalls;

        /// <summary>Хилийн шугамын (<paramref name="coord"/>) өрөөний дотор талд ≤ 40 мм-т байгаа host нимгэн хананы өрөө рүү харсан нүүр.</summary>
        private KeyValuePair<double, Reference>? FinishFace(View v, bool normalX, double coord, int inward, double spanLo, double spanHi)
        {
            try
            {
                if (_finishWalls == null)
                    _finishWalls = new FilteredElementCollector(_doc, v.Id).OfClass(typeof(Wall)).Cast<Wall>()
                        .Where(w => { try { return w.Width <= _u.MmToInternal(120) && w.WallType.Kind != WallKind.Curtain; } catch { return false; } }).ToList();
                double tol = _u.MmToInternal(40), eps = _u.MmToInternal(1);
                Reference best = null;
                double bestPos = double.NaN, bestD = double.MaxValue;
                foreach (Wall w in _finishWalls)
                {
                    BoundingBoxXYZ bb = w.get_BoundingBox(null);
                    if (bb == null) continue;
                    double lo = normalX ? bb.Min.Y : bb.Min.X, hi = normalX ? bb.Max.Y : bb.Max.X;
                    if (Math.Min(hi, spanHi) - Math.Max(lo, spanLo) < _u.MmToInternal(300)) continue;
                    double a = normalX ? bb.Min.X : bb.Min.Y, b = normalX ? bb.Max.X : bb.Max.Y;
                    if (b < coord - tol || a > coord + tol) continue;
                    GeometryElement ge = w.get_Geometry(new Options { ComputeReferences = true });
                    if (ge == null) continue;
                    foreach (Solid sol in Solids(ge, Transform.Identity))
                        foreach (Face f in sol.Faces)
                        {
                            var pf = f as PlanarFace;
                            if (pf == null || pf.Reference == null) continue;
                            double nn = normalX ? pf.FaceNormal.X : pf.FaceNormal.Y;
                            if (nn * inward < 0.999) continue;   // өрөө рүү харсан нүүр
                            double o = normalX ? pf.Origin.X : pf.Origin.Y;
                            double d = (o - coord) * inward;     // дотогш эерэг
                            if (d < -eps || d > tol || d >= bestD) continue;
                            bestD = d; best = pf.Reference; bestPos = o;
                        }
                }
                return best != null ? new KeyValuePair<double, Reference>(bestPos, best) : (KeyValuePair<double, Reference>?)null;
            }
            catch { return null; }
        }

        public const string LinkGridFilterName = "MGL — Түлхүүр план — link тэнхлэг";

        /// <summary>
        /// Link загварын тэнхлэгийг энэ планд нууна.  ХЭМЖСЭН (GATEWAY 310): бүтцийн link-ийн «AX4/AX5/AY3/AY4» тэнхлэг төслийн «X4/X5»-тай
        /// ЯГ давхцаж, том толгойтойгоор crop-оос хол гарч viewport-ийг 1:125 хүртэл томруулсан.  Revit API link доторх АНГИЛЛЫГ харагдацаар
        /// нуух боломжгүй (RevitLinkGraphicsSettings-д алга) — тиймээс тэнхлэгийн шүүлтүүр: «нэр нь төслийн аль ч тэнхлэгтэй ТЭНЦҮҮ БИШ» (link
        /// нь «By host view» үед шүүлтүүр linked элементэд үйлчилнэ).  Төслийн тэнхлэг хэвээр харагдана.  Төсөлд тэнхлэг байхгүй эсвэл
        /// харагдацад template оноосон бол хөндөхгүй.
        /// </summary>
        private void HideLinkGrids(View v)
        {
            try
            {
                if (v.ViewTemplateId != ElementId.InvalidElementId) return;
                bool linkGrids = false;
                foreach (RevitLinkInstance li in new FilteredElementCollector(_doc).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>())
                {
                    Document ld;
                    try { ld = li.GetLinkDocument(); } catch { ld = null; }
                    if (ld != null && new FilteredElementCollector(ld).OfClass(typeof(Grid)).GetElementCount() > 0) { linkGrids = true; break; }
                }
                if (!linkGrids) return;
                List<string> names = new FilteredElementCollector(_doc).OfClass(typeof(Grid)).Cast<Grid>().Select(g => g.Name)
                                         .Where(n => !string.IsNullOrEmpty(n)).Distinct(StringComparer.Ordinal).OrderBy(n => n, StringComparer.Ordinal).ToList();
                if (names.Count == 0) return;
                var cats = new List<ElementId> { new ElementId(BuiltInCategory.OST_Grids) };
                var pid = new ElementId(BuiltInParameter.DATUM_TEXT);
                if (!ParameterFilterUtilities.GetFilterableParametersInCommon(_doc, cats).Contains(pid))
                {
                    WeLog.Info("keyplan", "тэнхлэгийн нэрээр шүүх боломжгүй — link тэнхлэг харагдана");
                    return;
                }
                var rules = names.Select(n => ParameterFilterRuleFactory.CreateNotEqualsRule(pid, n)).ToList();
                ElementFilter f = new ElementParameterFilter(rules);
                ParameterFilterElement pfe = new FilteredElementCollector(_doc).OfClass(typeof(ParameterFilterElement)).Cast<ParameterFilterElement>()
                                                 .FirstOrDefault(x => x.Name == LinkGridFilterName);
                if (pfe == null) pfe = ParameterFilterElement.Create(_doc, LinkGridFilterName, cats, f);
                else pfe.SetElementFilter(f);
                if (!v.GetFilters().Contains(pfe.Id)) v.AddFilter(pfe.Id);
                if (v.GetFilterVisibility(pfe.Id)) v.SetFilterVisibility(pfe.Id, false);
            }
            catch (Exception ex) { WeLog.Info("keyplan", v.Name + ": link тэнхлэг нуух — " + ex.Message); }
        }

        /// <summary>Хилийн сегментийн элементийн (хана, багана; link-д ч) X эсвэл Y-тэй перпендикуляр нүүр — байрлал нь <paramref name="coord"/>.</summary>
        private Reference SegmentFace(BoundarySegment b, bool normalX, double coord)
        {
            try
            {
                Element e;
                RevitLinkInstance li = null;
                Transform tf = Transform.Identity;
                if (_roomLink != null)
                {
                    // Link-ийн өрөө: хилийн элемент нь тэр link-ийн баримтад (давхар link — алгасна).
                    if (b.LinkElementId != null && b.LinkElementId != ElementId.InvalidElementId) return null;
                    li = _roomLink;
                    Document rd = li.GetLinkDocument();
                    if (rd == null) return null;
                    e = rd.GetElement(b.ElementId);
                    tf = _roomTf;
                }
                else if (b.LinkElementId != null && b.LinkElementId != ElementId.InvalidElementId)
                {
                    li = _doc.GetElement(b.ElementId) as RevitLinkInstance;
                    Document ld = li != null ? li.GetLinkDocument() : null;
                    if (ld == null) return null;
                    e = ld.GetElement(b.LinkElementId);
                    tf = li.GetTotalTransform();
                }
                else e = _doc.GetElement(b.ElementId);
                if (e == null) return null;
                GeometryElement ge = e.get_Geometry(new Options { ComputeReferences = true });
                if (ge == null) return null;
                Reference best = null;
                double bestD = _u.MmToInternal(8);
                foreach (Solid sol in Solids(ge, Transform.Identity))
                    foreach (Face f in sol.Faces)
                    {
                        var pf = f as PlanarFace;
                        if (pf == null || pf.Reference == null) continue;
                        XYZ n = tf.OfVector(pf.FaceNormal), o = tf.OfPoint(pf.Origin);
                        if ((normalX ? Math.Abs(n.X) : Math.Abs(n.Y)) < 0.999) continue;
                        double dd = Math.Abs((normalX ? o.X : o.Y) - coord);
                        if (dd < bestD) { bestD = dd; best = pf.Reference; }
                    }
                if (best == null) return null;
                return li != null ? WeLinkRef.ForDimension(_doc, best, li) : best;
            }
            catch { return null; }
        }

        /// <summary>Геометрийн хатуу биеүд (family instance — дэлхийн координатад, лавлагаатай).</summary>
        private static IEnumerable<Solid> Solids(GeometryElement ge, Transform t)
        {
            foreach (GeometryObject go in ge)
            {
                var s = go as Solid;
                if (s != null && s.Faces.Size > 0) { yield return s; continue; }
                var gi = go as GeometryInstance;
                if (gi == null) continue;
                GeometryElement inst;
                try { inst = gi.GetInstanceGeometry(); } catch { continue; }
                if (inst == null) continue;
                foreach (GeometryObject g2 in inst)
                {
                    var s2 = g2 as Solid;
                    if (s2 != null && s2.Faces.Size > 0) yield return s2;
                }
            }
        }

        /// <summary>
        /// Өрөөний шошго — Elevation маркерын тэмдгээс зайдуу (ХЭМЖСЭН GATEWAY 310: өрөөний цэг дээрх «310» тойрог 310A маркерыг дарсан).
        /// Өрөөн доторх тор цэгүүдээс: маркеруудаас хамгийн хол (тэмдгийн 1.5 дахин хүрээд хангалттай), хананаас ≥ шошгоны хагас, тэнцвэл
        /// өрөөний цэгт хамгийн ойр.  Маркер = төлөвлөсөн шинэ маркер + энэ планд аль хэдийн байгаа маркер.
        /// </summary>
        private XYZ TagPoint(View v, Room room, WeKeyPlan kp, XYZ prefer)
        {
            try
            {
                double scale = Math.Max(1, v.Scale);
                double z = prefer.Z;
                var avoid = new List<XYZ>();
                if (kp != null) foreach (WeV3 a in kp.Avoid) avoid.Add(new XYZ(a.X, a.Y, z));
                foreach (ElevationMarker mk in new FilteredElementCollector(_doc, v.Id).OfClass(typeof(ElevationMarker)).Cast<ElevationMarker>())
                {
                    BoundingBoxXYZ bb = mk.get_BoundingBox(v);
                    if (bb != null) avoid.Add(new XYZ((bb.Min.X + bb.Max.X) / 2, (bb.Min.Y + bb.Max.Y) / 2, z));
                }
                if (avoid.Count == 0) return prefer;
                double want = _u.MmToInternal(WeKeyPlanner.MarkerPaperMm * 1.5 * scale);
                double wall = _u.MmToInternal(7 * scale);
                List<List<KeyValuePair<Curve, BoundarySegment>>> segs = HostLoops(room);
                var lines = new List<Curve>();
                if (segs != null) foreach (List<KeyValuePair<Curve, BoundarySegment>> l in segs) foreach (KeyValuePair<Curve, BoundarySegment> b in l) lines.Add(b.Key);
                if (lines.Count == 0) return prefer;
                double x0 = lines.Min(c => Math.Min(c.GetEndPoint(0).X, c.GetEndPoint(1).X)), x1 = lines.Max(c => Math.Max(c.GetEndPoint(0).X, c.GetEndPoint(1).X));
                double y0 = lines.Min(c => Math.Min(c.GetEndPoint(0).Y, c.GetEndPoint(1).Y)), y1 = lines.Max(c => Math.Max(c.GetEndPoint(0).Y, c.GetEndPoint(1).Y));
                double probeZ = (v.GenLevel != null ? v.GenLevel.ProjectElevation : room.Level != null ? room.Level.ProjectElevation + _roomTf.Origin.Z : z) + 1.0;
                Func<XYZ, double> clear = q => avoid.Min(a => new XYZ(a.X - q.X, a.Y - q.Y, 0).GetLength());
                XYZ best = prefer;
                double bestScore = Math.Min(clear(prefer), want), bestDist = 0;
                const int N = 20;
                for (int i = 0; i <= N; i++)
                    for (int j = 0; j <= N; j++)
                    {
                        var q = new XYZ(x0 + (x1 - x0) * i / N, y0 + (y1 - y0) * j / N, z);
                        if (!WeRoomRef.IsPointInRoom(room, _roomTf, new XYZ(q.X, q.Y, probeZ))) continue;
                        if (lines.Any(c => { try { return c.Project(new XYZ(q.X, q.Y, c.GetEndPoint(0).Z)).Distance < wall; } catch { return false; } })) continue;
                        double sc = Math.Min(clear(q), want), d = new XYZ(q.X - prefer.X, q.Y - prefer.Y, 0).GetLength();
                        if (sc > bestScore + 1e-6 || Math.Abs(sc - bestScore) <= 1e-6 && d < bestDist - 1e-9) { bestScore = sc; bestDist = d; best = q; }
                    }
                return best;
            }
            catch (Exception ex)
            {
                WeLog.Info("keyplan", v.Name + ": шошгоны байр — " + ex.Message);
                return prefer;
            }
        }

        /// <summary>
        /// Бүх дэлгээс үүссэний ДАРАА дахин нууна — түлхүүр план эхэлж үүсдэг (маркер түүн дээр суудаг) тул тэр үед хөрш өрөөний маркер
        /// хараахан байгаагүй (ХЭМЖСЭН, MITIC 218/219 нэг ажиллагаанд: 218-ийн түлхүүр план дээр 219A/C/E/H маркер харагдсан).
        /// </summary>
        public void HideForeignMarkersLate(ViewPlan v, WeGroupInfo g, ISet<long> ownViews)
        {
            if (v == null || g == null) return;
            RevitLinkInstance link;
            Room room = WeRoomRef.Resolve(_doc, g.RoomUid, out link);
            if (room == null && link == null && g.RoomId > 0) room = _doc.GetElement(new ElementId(g.RoomId)) as Room;
            if (room == null) return;
            Room keepRoom = _room; RevitLinkInstance keepLink = _roomLink; Transform keepTf = _roomTf;
            _room = room; _roomLink = link; _roomTf = WeRoomRef.TransformOf(link);
            try { HideForeignMarkers(v, room, ownViews ?? new HashSet<long>()); }
            finally { _room = keepRoom; _roomLink = keepLink; _roomTf = keepTf; }
        }

        /// <summary>
        /// Бусад өрөөний elevation маркер (жишээ: коридорт 218B, 219H) — түлхүүр планд илүүдэл (жишиг: зөвхөн энэ өрөөний тэмдэг).  Өрөөний
        /// ГАДНА байрлах маркерыг энэ харагдацад нууна (элементийг өөрчлөхгүй).
        /// </summary>
        private void HideForeignMarkers(View v, Room room, ISet<long> ownViews = null)
        {
            if (room == null) return;
            try
            {
                var hide = new List<ElementId>();
                int seen = 0;
                var cats = new ElementMulticategoryFilter(new List<BuiltInCategory> { BuiltInCategory.OST_Elev, BuiltInCategory.OST_Viewers });
                var cands = new Dictionary<long, Element>();
                foreach (Element m in new FilteredElementCollector(_doc, v.Id).WherePasses(cats).WhereElementIsNotElementType()) cands[m.Id.Value] = m;
                // Бүх дэлгээс үүссэний дараа (ownViews өгсөн): баримтын БҮХ elevation маркер — ЭЗЭМШЛЭЭР.  ХЭМЖСЭН (MITIC 215, 2026-10-08):
                // хуудсанд багтаахаар масштаб солиход annotation crop томорч, өмнө нь харагдахгүй (хүрээ нь null) байсан хөрш өрөөний маркер
                // (218A-D) гарч ирсэн; өрөөний төвд оффисын өөрийн хуучин «215A-D» маркер манайхтай давхцсан.
                if (ownViews != null)
                    foreach (Element m in new FilteredElementCollector(_doc).OfClass(typeof(ElevationMarker))) if (!cands.ContainsKey(m.Id.Value)) cands[m.Id.Value] = m;
                // Харагдац бүрийн VIEWER (сум + шошго, OST_Viewers) — маркерыг нуусан ч тусдаа үлддэг.  ХЭМЖСЭН (MAX ӨРГӨӨ 153, 2026-10-13):
                // оффисын гар «ДЭЛГЭЭС 153A–F», өмнөх ажиллуулалтын «153A–D» viewer өрөөн ДОТОР байсан тул «өрөөнд байна» шалгалтыг давж
                // манай тэмдэгтэй давхцсан.  Эзэмшлээр: viewer-ийн нэр = харагдацын нэр (id нь ихэвчлэн харагдацынхаас 1 бага).
                HashSet<string> ownNames = null;
                if (ownViews != null)
                {
                    ownNames = new HashSet<string>(StringComparer.Ordinal);
                    foreach (long id in ownViews)
                    {
                        try { View ov = _doc.GetElement(new ElementId(id)) as View; if (ov != null) ownNames.Add(ov.Name); } catch { }
                    }
                }
                foreach (Element m in cands.Values)
                {
                    seen++;
                    if (m.IsHidden(v) || !m.CanBeHidden(v)) continue;
                    var em = m as ElevationMarker;
                    if (ownViews != null && em != null)
                    {
                        bool own = false;
                        for (int i = 0; i < em.MaximumViewCount && !own; i++)
                        {
                            try { ElementId id = em.GetViewId(i); own = id != ElementId.InvalidElementId && ownViews.Contains(id.Value); } catch { }
                        }
                        if (!own) hide.Add(m.Id);
                        continue;
                    }
                    if (ownNames != null && m.Category != null && m.Category.Id.Value == (long)BuiltInCategory.OST_Viewers)
                    {
                        bool own = ownViews.Contains(m.Id.Value + 1) || ownNames.Contains(m.Name ?? string.Empty);
                        if (!own) hide.Add(m.Id);
                        continue;
                    }
                    BoundingBoxXYZ bb = null;
                    try { bb = m.get_BoundingBox(v); } catch { }
                    if (bb == null) continue;
                    XYZ c = (bb.Min + bb.Max) * 0.5;
                    double z = v.GenLevel != null ? v.GenLevel.ProjectElevation + 1.0 : c.Z;
                    if (!WeRoomRef.IsPointInRoom(room, _roomTf, new XYZ(c.X, c.Y, z))) hide.Add(m.Id);
                }
                if (hide.Count > 0)
                {
                    try { v.HideElements(hide); }
                    catch
                    {
                        // Харагдацад огт байхгүй элемент — нэг нэгээр (алгасаад үргэлжилнэ).
                        int ok = 0;
                        foreach (ElementId id in hide) { try { v.HideElements(new List<ElementId> { id }); ok++; } catch { } }
                        hide = hide.Take(ok).ToList();
                    }
                }
                WeLog.Info("keyplan", v.Name + ": тэмдэг " + seen + ", " + (ownViews != null ? "бусад (хөрш өрөө, хуучин)" : "өрөөнөөс гадна") + " нуусан " + hide.Count);
            }
            catch (Exception ex) { WeLog.Info("keyplan", v.Name + ": бусад маркер нуух — " + ex.Message); }
        }

        /// <summary>Түлхүүр планы өрөөний шошгоны төрөл: оффисын түлхүүр планы template-тэй харагдацуудад хамгийн их хэрэглэгдсэн (MITIC: «215» дугаар л).</summary>
        private ElementId KeyPlanRoomTagType()
        {
            if (_roomTagTypeResolved) return _roomTagType;
            _roomTagTypeResolved = true;
            try
            {
                if (_res.KeyPlanTemplate == null || !_res.KeyPlanTemplate.IsValidObject) return _roomTagType;
                ElementId tplId = _res.KeyPlanTemplate.Id;
                var views = new HashSet<long>(new FilteredElementCollector(_doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
                                                  .Where(x => !x.IsTemplate && x.ViewTemplateId == tplId).Select(x => x.Id.Value));
                if (views.Count == 0) return _roomTagType;
                var best = new FilteredElementCollector(_doc).OfCategory(BuiltInCategory.OST_RoomTags).WhereElementIsNotElementType()
                    .Where(t => views.Contains(t.OwnerViewId.Value)).GroupBy(t => t.GetTypeId().Value)
                    .OrderByDescending(g => g.Count()).ThenBy(g => g.Key).FirstOrDefault();
                if (best != null) _roomTagType = new ElementId(best.Key);
            }
            catch (Exception ex) { WeLog.Info("keyplan", "өрөөний шошгоны төрөл — " + ex.Message); }
            return _roomTagType;
        }

        private ElementId _roomTagType = ElementId.InvalidElementId;
        private bool _roomTagTypeResolved;

        private void TagRoom(View v, Room room, WeKeyPlan kp, List<ElementId> ids, List<string> notes)
        {
            var lp = room != null ? room.Location as LocationPoint : null;
            if (lp == null) return;
            try
            {
                XYZ at = TagPoint(v, room, kp, _roomTf.OfPoint(lp.Point));
                RoomTag t = _doc.Create.NewRoomTag(WeRoomRef.TagTarget(room, _roomLink), new UV(at.X, at.Y), v.Id);
                if (t != null)
                {
                    ElementId tt = KeyPlanRoomTagType();
                    if (tt != ElementId.InvalidElementId && t.GetTypeId() != tt) try { t.ChangeTypeId(tt); } catch { }
                    ids.Add(t.Id);
                }
            }
            catch (Exception ex)
            {
                WeLog.Info("keyplan", v.Name + ": өрөөний шошго — " + ex.Message);
                notes.Add("Түлхүүр план: өрөөний шошго тавьсангүй (Room Tag family ачаалаагүй байж магадгүй).");
            }
        }
    }
}
