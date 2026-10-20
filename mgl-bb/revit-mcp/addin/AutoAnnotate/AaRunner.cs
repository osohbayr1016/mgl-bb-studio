using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.Reinforcement;

namespace RevitMcpAddin.AutoAnnotate
{
    /// <summary>
    /// Гүйцэтгэл — UI-гүй.  Команд ч, Revit доторх тест харness ч (reflection-оор) ЯГ энийг дууддаг.
    /// Бүгд нэг TransactionGroup → нэг Ctrl+Z.
    /// </summary>
    public static class AaRunner
    {
        /// <summary>Цонхонд харуулах шинжилгээ — юу ч өөрчлөхгүй.</summary>
        public static AaViewInfo Analyze(Document doc, View view, ICollection<ElementId> selection)
        {
            var info = new AaViewInfo
            {
                Kind = AaScan.KindOf(view),
                ViewName = view?.Name ?? "",
                Scale = view != null && view.Scale > 0 ? view.Scale : 100,
                SelectionCount = selection?.Count ?? 0,
            };
            if (info.Kind == AaViewKind.Unsupported)
                return info;
            // «Солих» нь өгөгдмөл тул өмнөх автомат tag-ийг «аль хэдийн tag-тай»-д тоолохгүй — эс бөгөөс
            // дахин дарахад бүх ангилал «бүгд tag-тай» гэж идэвхгүй харагдана.
            List<ElementId> prevIds = AaStore.Previous(doc, view);
            ViewData d = AaScan.Read(doc, view, selection, false, prevIds);
            info.Structural = d.Structural;
            info.Walls = d.Walls.Count;
            info.WallsExterior = d.Walls.Count(w => w.Exp != Core.Exposure.None);
            info.Doors = d.Kind == AaViewKind.Plan ? d.Openings.Count(o => o.Door) : AaTags.Candidates(d, "doors").Count;
            info.Windows = d.Kind == AaViewKind.Plan ? d.Openings.Count(o => !o.Door) : AaTags.Candidates(d, "windows").Count;
            info.Columns = d.Columns.Count;
            info.Beams = d.Framing.Count;
            info.Rooms = d.Rooms.Count;
            info.Grids = d.Grids.Count;
            info.Levels = d.Levels.Count;
            info.CurtainWalls = d.CurtainWalls;
            info.CurvedWalls = d.CurvedWalls;
            info.PreviousCount = prevIds.Count;
            info.Links = d.Links.Count;
            info.LinkNames.AddRange(d.Links.Select(l => l.Name).Distinct());
            info.LinksUnloaded.AddRange(d.LinksUnloaded.Distinct());
            info.LinkedElements = d.LinkedElements;
            info.RawWalls = d.RawWalls;
            info.CutFallback = d.CutFallback;
            List<AaRebarHost> rebarHosts;
            info.Rebar = AaRebar.Detect(doc, view, selection, out rebarHosts);
            List<Element> wsHosts;
            info.WallSlab = AaWallSlab.Detect(doc, view, selection, out wsHosts);
            // Арматурын дам нуруу/хана/хучилт олдсон бол «хэмжих юм алга» гэж сэтгэл дундуур мэдэгдэхгүй — арматурын горим ажиллана.
            info.EmptyReason = info.Rebar.HasWork || info.WallSlab.HasWork ? null : EmptyReason(d);

            foreach (string key in AaTags.Keys)
            {
                List<TagCand> els = AaTags.Candidates(d, key);
                ElementId tid = AaTags.TagType(doc, AaTags.TagCategory(key));
                string name = null;
                if (tid != ElementId.InvalidElementId && doc.GetElement(tid) is FamilySymbol fs)
                    name = fs.FamilyName + ": " + fs.Name;
                info.Tags.Add(new AaTagInfo
                {
                    Key = key,
                    Label = AaTags.Label(key),
                    Count = els.Count,
                    AlreadyTagged = els.Count(e => AaTags.IsTagged(d, key, e)),
                    TagTypeId = tid,
                    TagTypeName = name,
                });
            }

            ElementId def = ElementId.InvalidElementId;
            try { def = doc.GetDefaultElementTypeId(ElementTypeGroup.LinearDimensionType); }
            catch { }
            Element defEl = def == ElementId.InvalidElementId ? null : doc.GetElement(def);
            info.DefaultDimensionUid = defEl == null ? "" : defEl.UniqueId;
            foreach (DimensionType dt in RfSectionService.DimensionTypes(doc))
                info.DimensionTypes.Add(new KeyValuePair<string, string>(dt.UniqueId, dt.Name));
            return info;
        }

        /// <summary>
        /// Хэмжих юм огт олдоогүй бол хэрэглэгчид ойлгомжтой шалтгаан (эс бөгөөс null).  1.7.0 нь энэ үед
        /// цонхны бүх сонголтыг тайлбаргүй идэвхгүй болгодог байсан — «ажиллахгүй байна» гэж ойлгогдсон.
        /// </summary>
        internal static string EmptyReason(ViewData d)
        {
            bool empty = d.Kind == AaViewKind.Plan
                ? d.Walls.Count == 0 && d.Grids.Count == 0 && d.Columns.Count == 0 && d.Rooms.Count == 0
                : d.Levels.Count < 2 && d.Grids.Count < 2 && d.SectionOpenings.Count == 0;
            if (!empty)
                return null;
            if (d.Links.Count == 0 && d.LinksUnloaded.Count > 0)
                return "Энэ харагдацад загвар нь зөвхөн ачаалагдаагүй link-д байна (" + string.Join(", ", d.LinksUnloaded.Distinct())
                    + ").  Manage → Manage Links → Reload хийгээд дахин дарна уу.";
            if (d.Kind == AaViewKind.Plan)
                return "Энэ харагдацад хана, тэнхлэг, багана харагдахгүй байна.  Visibility/Graphics (VG)-д Walls, Grids "
                    + "ангилал болон Revit Links асаалттай эсэх, View Range, Crop Region-ийг шалгана уу.  "
                    + "Link доторх link (nested) -ийн элементийг хэмжихгүй.";
            return "Энэ харагдацад түвшин, тэнхлэг, цонх/хаалга харагдахгүй байна.  Visibility/Graphics (VG)-д Levels, Grids, "
                + "Revit Links асаалттай эсэх, Far Clip, Crop Region-ийг шалгана уу.";
        }

        /// <summary>
        /// Commit-ийн үед Revit алдаатай гэж хассан хэмжээсийг (жишээ нь «References are no longer parallel»)
        /// төрлийн тоолуураас хасаж, тайланд аль гинж байсныг хэлнэ — тайлан бодит үр дүнтэй таарна.
        /// </summary>
        private static void Reconcile(Document doc, AaReport rep)
        {
            var gone = new Dictionary<string, int>();
            foreach (ElementId id in rep.DimIds)
            {
                if (doc.GetElement(id) != null)
                    continue;
                string what = rep.DimWhat.TryGetValue(id.Value, out string w) ? w : "Хэмжээс";
                if (what.StartsWith("Фасад", StringComparison.Ordinal)) rep.DimsFacade--;
                else if (what.StartsWith("Нийт", StringComparison.Ordinal) || what.EndsWith("(нийт)", StringComparison.Ordinal))
                {
                    if (what.StartsWith("Түвшн", StringComparison.Ordinal)) rep.DimsLevel--;
                    else if (what.StartsWith("Тэнхлэг", StringComparison.Ordinal)) rep.DimsGrid--;
                    else rep.DimsOverall--;
                }
                else if (what.StartsWith("Тэнхлэг", StringComparison.Ordinal)) rep.DimsGrid--;
                else if (what.StartsWith("Дотор", StringComparison.Ordinal)) rep.DimsInterior--;
                else if (what.StartsWith("Хаалга", StringComparison.Ordinal)) rep.DimsDoor--;
                else if (what.StartsWith("Баган", StringComparison.Ordinal)) rep.DimsColumn--;
                else if (what.StartsWith("Түвшн", StringComparison.Ordinal)) rep.DimsLevel--;
                else if (what.StartsWith("Цонх", StringComparison.Ordinal)) rep.DimsOpening--;
                string key = what.Split('(')[0].Trim();
                gone[key] = gone.TryGetValue(key, out int c) ? c + 1 : 1;
            }
            if (gone.Count > 0)
                rep.Note("Revit " + gone.Values.Sum() + " хэмжээсийг хүлээж аваагүй (лавлагаа нь хэмжигдэхгүй) тул хаслаа: "
                    + string.Join(", ", gone.Select(kv => kv.Key + " ×" + kv.Value)) + ".");
            rep.DimIds.RemoveAll(id => doc.GetElement(id) == null);
        }

        /// <summary>⚠️ Нээлттэй Transaction-гүй үед л дуудна.</summary>
        public static AaReport Run(Document doc, View view, ICollection<ElementId> selection, AaOptions o)
        {
            var rep = new AaReport();
            if (AaScan.KindOf(view) == AaViewKind.Unsupported)
            {
                rep.Error("Энэ төрлийн харагдац дэмжигдэхгүй — план, зүсэлт эсвэл фасад нээнэ үү.");
                return rep;
            }
            // Хэмжээсийн төрөл: НЭГ сонголт, ЭХЛЭЭД шалгана.  Сонгосон төрөл олдохгүй/буруу бол ЮУ Ч үүсгэхгүй зогсоно — өөр (өгөгдмөл) төрлөөр чимээгүй
            // хэмжээс тавихгүй.
            DimensionType dimType;
            string dimTypeError;
            if (!AaDimType.Resolve(doc, o.DimensionTypeUid, out dimType, out dimTypeError))
            {
                rep.Error(dimTypeError);
                return rep;
            }

            // НЭГ «Байрлал» (тал, эхний гинж, гинж хооронд) — арматурын огтлол/дэлгээс, хана-хучилтын хэмжээсэд ч (команд шууд дуудагдсан ч).
            o = o.Clone();
            o.ApplyPlacement();

            // Арматурын горим: дам нуруу (огтлол/дэлгээс) олдвол арматурын замаар; ерөнхий хэмжээс зөвхөн «Бас ерөнхий» үед.
            List<AaRebarHost> rebarHosts = new List<AaRebarHost>();
            bool rebarMode = false;
            if (o.Rebar != null && o.Rebar.Enabled)
                rebarMode = AaRebar.Detect(doc, view, selection, out rebarHosts, o.Rebar.OnlySelectedHosts).HasWork;
            // Хана/хучилтын арматурын MRA — тусдаа цэс; дам нуруу/баганаас үл хамаарна.
            List<Element> wsHosts = new List<Element>();
            bool wsMode = false;
            if (o.WallSlab != null && o.WallSlab.Enabled && (o.WallSlab.Walls || o.WallSlab.Floors))
            {
                AaWallSlabInfo wsInfo = AaWallSlab.Detect(doc, view, selection, out wsHosts, o.WallSlab.OnlySelectedHosts, o.WallSlab.Walls, o.WallSlab.Floors);
                wsMode = wsInfo.HasWork;
            }
            bool general = !(rebarMode || wsMode) || (o.Rebar != null && o.Rebar.AlsoGeneral);
            using (var tg = new TransactionGroup(doc, "MGL: Автомат хэмжээс"))
            {
                tg.Start();
                List<ElementId> kept = new List<ElementId>();

                // ── 1. Өмнөх автомат хэмжээс/tag
                List<ElementId> prev = AaStore.Previous(doc, view);
                // «Зөвхөн сонгосон гишүүд» үед өмнөх автомат тэмдэглэгээг УСТГАХГҮЙ: бүртгэл нь гишүүн тус бүрээр биш харагдац бүхэлдээр тул устгавал
                // СОНГООГҮЙ гишүүдийн тэмдэглэгээ ч алга болно.  (Огтлол нь гишүүн тус бүрээр өөрийн бүртгэлтэй — тэр нь нарийн солигдоно.)
                bool onlySelectedRebar = (rebarMode && o.Rebar.OnlySelectedHosts) || (wsMode && o.WallSlab.OnlySelectedHosts);
                if (prev.Count > 0 && onlySelectedRebar && o.ReplacePrevious)
                    rep.Note("Зөвхөн сонгосон гишүүн дээр тавьсан тул өмнөх автомат хэмжээс/tag (" + prev.Count + ")-ийг устгаагүй — давхардвал «Зөвхөн сонгосон»-г унтрааж бүгдийг дахин тавина уу.");
                if (prev.Count > 0)
                {
                    if (o.ReplacePrevious && !onlySelectedRebar)
                    {
                        using (var t = new Transaction(doc, "MGL: Өмнөх автомат хэмжээсийг устгах"))
                        {
                            t.Start();
                            try
                            {
                                ICollection<ElementId> gone = doc.Delete(prev);
                                rep.PreviousRemoved = prev.Count;
                                t.Commit();
                            }
                            catch (Exception ex)
                            {
                                t.RollBack();
                                rep.Error("Өмнөх автомат хэмжээсийг устгаж чадсангүй: " + ex.Message);
                                kept.AddRange(prev);
                            }
                        }
                    }
                    else
                    {
                        kept.AddRange(prev);
                    }
                }

                // ── 2. Хэмжээс ба tag (устгалтын ДАРАА уншина — «аль хэдийн tag-тай» зөв гарна)
                if (general)
                {
                using (var t = new Transaction(doc, "MGL: Автомат хэмжээс ба tag"))
                {
                    t.Start();
                    FailureHandlingOptions fho = t.GetFailureHandlingOptions();
                    fho.SetFailuresPreprocessor(new AaFailureHandler(rep));
                    fho.SetClearAfterRollback(true);
                    t.SetFailureHandlingOptions(fho);
                    try
                    {
                        ViewData d = AaScan.Read(doc, view, selection, o.OnlySelection);
                        DimensionType type = dimType;
                        if (d.LinkedElements > 0)
                            rep.Note(d.LinkedElements + " элементийг холбосон файлаас (link: " + string.Join(", ", d.Links.Select(l => l.Name).Distinct()) + ") уншиж хэмжлээ.");
                        if (d.LinksUnloaded.Count > 0)
                            rep.Note("Ачаалагдаагүй link: " + string.Join(", ", d.LinksUnloaded.Distinct()) + " — Manage Links → Reload хийвэл тэдгээрийг ч хэмжинэ.");
                        string empty = EmptyReason(d);
                        if (empty != null)
                            rep.Note(empty);
                        if (d.CutFallback)
                            rep.Note("Харагдацын огтлолын хавтгайд (View Range → Cut Plane) хана таараагүй тул ханыг өөр өндрөөр огтолж уншлаа.");
                        if (d.Kind == AaViewKind.Plan)
                        {
                            AaPlanDims.Run(d, o, rep, type);
                            if (d.CurtainWalls > 0 && o.FacadeDims)
                                rep.Note(d.CurtainWalls + " шилэн (curtain) ханыг хэмжээгүй — булан нь хөрш ханаар хэмжигдэнэ.");
                            if (d.CurvedWalls > 0)
                                rep.Note(d.CurvedWalls + " муруй ханыг хэмжээгүй (зөвхөн шулуун хана).");
                        }
                        else
                        {
                            AaSectionDims.Run(d, o, rep, type);
                        }
                        AaTags.Run(d, o, rep);
                        AaDim.NudgeTexts(d, rep);
                        TransactionStatus st = t.Commit();
                        if (st != TransactionStatus.Committed)
                        {
                            rep.Error("Revit өөрчлөлтийг буцаасан (" + st + ").");
                            rep.Created.Clear();
                        }
                        else
                        {
                            Reconcile(doc, rep);
                        }
                    }
                    catch (Exception ex)
                    {
                        if (t.HasStarted() && !t.HasEnded())
                            t.RollBack();
                        rep.Error(ex.Message);
                        rep.Created.Clear();
                    }
                }

                }
                // ── 2b. Арматур: огтлол (хомутын гинжин хэмжээс + шошго) ба дэлгээс (шошго, MRA, давхцал, тэнхлэгийн гинж)
                if (rebarMode)
                    AaRebar.Run(doc, view, o.Rebar, dimType, rep, rebarHosts);

                // ── 2c. Хана/хучилт: арматурын олонлог бүрд MRA (хэмжээсийн шугам хамгийн гадна арматураас хэрэглэгчийн зайд)
                if (wsMode)
                    AaWallSlab.Run(doc, view, o.WallSlab, o.Rebar?.MraTypeUid, o.Rebar?.BarTagTypeUid, dimType, rep, wsHosts);

                // ── 3. Бүртгэл — дараагийн удаа «солих» боломжтой болгоно
                List<ElementId> all = kept.Concat(rep.Created).Where(id => doc.GetElement(id) != null).ToList();
                if (rep.Created.Count > 0 || rep.PreviousRemoved > 0)
                {
                    using (var t = new Transaction(doc, "MGL: Автомат хэмжээсийн бүртгэл"))
                    {
                        t.Start();
                        if (!AaStore.Write(doc, view, all))
                            rep.Note("Бүртгэлийг харагдацад хадгалж чадсангүй (өөр хүн эзэмшиж байна уу?) — дахин ажиллуулахад өмнөхийг солихгүй.");
                        t.Commit();
                    }
                }
                rep.Created.RemoveAll(id => doc.GetElement(id) == null);

                if (rep.Created.Count > 0 || rep.PreviousRemoved > 0 || rep.GridsExtended > 0 || rep.RebarChanged)
                    tg.Assimilate();
                else
                    tg.RollBack();
            }
            return rep;
        }
    }
}
