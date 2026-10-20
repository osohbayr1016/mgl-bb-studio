using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Selection;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>Нэг товшилтын сонголтын үр дүн.</summary>
    internal enum WePickOutcome
    {
        /// <summary>Өрөө (эсвэл хана) танигдсан — шууд урьдчилсан дүн рүү.</summary>
        Picked,
        /// <summary>Esc эсвэл «Бусад сонголт» — олон өрөө / бүх өрөө / элементээр сонгох цонх.</summary>
        Options,
        /// <summary>Болих.</summary>
        Cancelled,
    }

    /// <summary>Нэг товшилтын цэгт юу олдсон, олдоогүй бол яагаад.</summary>
    internal sealed class WePickHit
    {
        public WePickCandidate Best;
        /// <summary>Хэрэглэгчид харуулах шалтгаан (олдоогүй үед).</summary>
        public string Why;
        /// <summary>Лог-д: план, давхар, өндөр, шат, link бүрийн байдал, хамгийн ойр өрөө.</summary>
        public string Diagnostics;
        /// <summary>Нөөц замаар олдсон бол («давхрын хайлт»).</summary>
        public string Via;
        public Room Room;
        public RevitLinkInstance Link;
        public Wall Wall;
        public ViewPlan Plan;
        /// <summary>Хуудаснаас дарсан бол тэр viewport ба планы model→projection (тодруулгыг хуудсан дээр зурахад).</summary>
        public Viewport Viewport;
        public Transform ModelToProjection;
    }

    /// <summary>
    /// «Өрөөн дотор дарж сонгох».  Товшилт бүр = <see cref="Selection.PickPoint(ObjectSnapTypes, string)"/>-ийн цэг; тэр цэгт байгаа өрөөг
    /// host-оос ба ачаалагдсан link бүрээс хэрэгсэл өөрөө олно — өрөөний хоосон хэсэг, Room Reference X, tag ялгаагүй, interior fill /
    /// reference харагдах эсэх, өрөөний ШОШГО байгаа эсэхээс үл хамаарна.
    /// <para><b>НЭГ товшилт = шууд</b> (<see cref="PickOne"/>, 2026-10-13): эзэн «өрөөн дээр дармагц автоматаар таниад шууд дэлгээс гаргадаг
    /// болго» гэв.  ХЭМЖСЭН шалтгаан (тэр өдрийн лог, MAX ӨРГӨӨ INT_B): 1.37.0-ийн олон товшилтын горимд link-ийн өрөө ОЛДСОН ч дэлгэц дээр
    /// юу ч тодордоггүй (link-ийн өрөөг Revit сонгуулдаггүй, шошгогүй бол тодруулах зүйл алга) тул хэрэглэгч 40 секундэд 9 удаа дарж, дахин
    /// дарах бүр сонголтоос ХАСАГДАЖ байв («+153, −153, +153 …»).  Шошготой өрөөнд tag тодордог тул «шошготой бол ажилладаг, шошгогүй бол
    /// ажилладаггүй» мэт харагдсан.</para>
    /// <para>Олон өрөө (<see cref="PickMany"/>) — Esc → «Бусад сонголт»: сонгосон өрөө бүр ТҮР зураасаар (бүдүүн хүрээ + «✓ нэр») тодорно;
    /// тэр зураас нэг TransactionGroup-д, сонголт дуусмагц RollBack — загварт юу ч үлдэхгүй.</para>
    /// <para>Хуудас (sheet) идэвхтэй үед viewport-ыг ИДЭВХЖҮҮЛЭХГҮЙ: хуудасны цэгийг <c>Viewport.GetProjectionToSheetTransform</c> ба
    /// <c>View.GetModelToProjectionTransforms</c>-ийн урвуугаар планы загварын цэг болгоно.</para>
    /// </summary>
    internal static class WeRoomPicker
    {
        private const string Title = "MGL — Ханын дэлгээс";

        /// <summary>Өрөөг шалгах өндөр: түвшнээс 0.5 м дээш (өрөөний суурийн offset, шалны зузааныг давна).</summary>
        private const double ProbeAboveLevelFt = 500 / 304.8;

        /// <summary>Link-ийн давхрыг идэвхтэй планы давхартай тулгах хүлцэл.</summary>
        private const double LevelMatchTolFt = 600 / 304.8;

        /// <summary>«Битүү биш өрөө ойрхон байна» гэж хэлэх зай.</summary>
        private const double NearOpenRoomFt = 3000 / 304.8;

        /// <summary>Энэ харагдацад цэгээр сонгох боломжтой эсэх (план эсвэл план viewport-той хуудас).</summary>
        public static bool Supports(View v)
        {
            if (v == null || v.IsTemplate) return false;
            if (v is ViewPlan) return ((ViewPlan)v).GenLevel != null;
            var sheet = v as ViewSheet;
            if (sheet == null) return false;
            Document doc = v.Document;
            return sheet.GetAllViewports().Select(id => doc.GetElement(id) as Viewport).Any(vp => vp != null && doc.GetElement(vp.ViewId) is ViewPlan);
        }

        // ───────────────────────────── НЭГ товшилт ─────────────────────────────

        /// <summary>
        /// Өрөөн дотор НЭГ дармагц танина.  Олдоогүй бол шалтгааныг цонхоор хэлээд дахин дарах / бусад сонголт / болих.
        /// Esc = <see cref="WePickOutcome.Options"/> (олон өрөө, бүх өрөө, элементээр сонгох).
        /// </summary>
        public static WePickOutcome PickOne(UIDocument uidoc, out WeTargets targets)
        {
            targets = null;
            Document doc = uidoc.Document;
            View active = uidoc.ActiveView;
            string note = null;

            // Дарахаас ӨМНӨ: энэ планд өрөө огт хүрэхгүй бол (өрөөтэй link ачаалагдаагүй / олдоогүй, давхарт өрөө алга) — шалтгааныг
            // шууд.  ХЭМЖСЭН (MAX ӨРГӨӨ INT_B _ZYA хуулбар, 2026-10-13): өрөөтэй архитектурын link «Not Found» (харьцангуй зам, файлыг
            // Documents руу хуулсан) — хэрэглэгч олон удаа дарж «өрөө сонгогдохгүй» гэж үзсэн, шалтгааныг хэн ч хэлээгүй.
            string pre = Preflight(doc, active);
            if (pre != null)
            {
                WeLog.Info("pick", "урьдчилсан шалгалт — " + pre.Replace('\n', ' '));
                var pd = new TaskDialog(Title)
                {
                    MainInstruction = "Энэ планд сонгох өрөө алга",
                    MainContent = pre,
                    CommonButtons = TaskDialogCommonButtons.Cancel,
                    DefaultButton = TaskDialogResult.Cancel,
                };
                pd.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, "Ямар ч байсан дарж үзэх", "Хана дээр дарж ханаар нь дэлгээс гаргаж болно");
                pd.AddCommandLink(TaskDialogCommandLinkId.CommandLink2, "Бусад сонголт", "Олон хана, элементээр сонгох");
                TaskDialogResult pr = pd.Show();
                if (pr == TaskDialogResult.CommandLink2) return WePickOutcome.Options;
                if (pr != TaskDialogResult.CommandLink1) return WePickOutcome.Cancelled;
            }

            // Курсор доорх өрөөг бүтэн хилээр нь тодруулна (2026-10-14) — сонголтын дүрэм хэвээр (At).
            WePickHit seed = null;
            using (WeHoverSession hover = WeHoverSession.TryStart(uidoc))
            while (true)
            {
                XYZ p;
                try { p = uidoc.Selection.PickPoint(ObjectSnapTypes.None, WePickRules.PromptOne(note)); }
                catch (Autodesk.Revit.Exceptions.OperationCanceledException) { return WePickOutcome.Options; }

                WePickHit hit = At(doc, active, p);
                if (hit.Best != null && MultiModifier())
                {
                    // 2026-10-14 (интерьерийн баг: «олон өрөө сонгоход 1 л гардаг»): Ctrl/Shift + дарах = олон өрөөний горим, энэ өрөөнөөс эхэлнэ.
                    WeLog.Info("pick", "Ctrl+товшилт → олон өрөө: " + Describe(hit));
                    seed = hit;
                    break;
                }
                if (hit.Best != null)
                {
                    WeLog.Info("pick", "нэг товшилт → " + Describe(hit));
                    targets = ToTargets(doc, new[] { hit.Best });
                    return WePickOutcome.Picked;
                }

                WeLog.Info("pick", "олдсонгүй · " + hit.Diagnostics);
                var td = new TaskDialog(Title)
                {
                    MainInstruction = "Тэр цэгт өрөө олдсонгүй",
                    MainContent = Capital(hit.Why) + ".\n\nӨрөөний ДОТОР (хананаас зайтай) дахин дарна уу.",
                    CommonButtons = TaskDialogCommonButtons.Cancel,
                    DefaultButton = TaskDialogResult.CommandLink1,
                };
                td.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, "Дахин дарах");
                td.AddCommandLink(TaskDialogCommandLinkId.CommandLink2, "Бусад сонголт", "Энэ планы бүх өрөө · олон өрөө · ханаар сонгох");
                TaskDialogResult r = td.Show();
                if (r == TaskDialogResult.CommandLink1) { note = hit.Why; continue; }
                return r == TaskDialogResult.CommandLink2 ? WePickOutcome.Options : WePickOutcome.Cancelled;
            }
            // Ctrl/Shift-ээр олон өрөөний горим: эхний өрөө сонгогдсон, цааш Ctrl+дарж нэмнэ, энгийн дарах / Esc = дуусгах.
            targets = PickMany(uidoc, seed, true);
            return targets != null && targets.Count > 0 ? WePickOutcome.Picked : WePickOutcome.Cancelled;
        }

        /// <summary>Ctrl эсвэл Shift ЯГ ОДОО дарагдсан (товшилтын агшинд) — олон өрөөний горим.</summary>
        internal static bool MultiModifier()
        {
            return KeyDown(0x11) || KeyDown(0x10);   // VK_CONTROL, VK_SHIFT
        }

        private static bool KeyDown(int vk)
        {
            try { return (GetKeyState(vk) & 0x8000) != 0 || (GetAsyncKeyState(vk) & 0x8000) != 0; }
            catch { return false; }
        }

        [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern short GetKeyState(int vk);
        [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern short GetAsyncKeyState(int vk);

        // ───────────────────────────── ОЛОН өрөө ─────────────────────────────

        /// <summary>
        /// Олон өрөө: дарах бүрт нэмнэ, дахин дарвал хасна, Esc = дуусгах.  Сонгосон өрөө түр хүрээгээр тодорно (RollBack).
        /// null = юу ч сонгоогүй Esc (болих).
        /// </summary>
        public static WeTargets PickMany(UIDocument uidoc)
        {
            return PickMany(uidoc, null, false);
        }

        /// <param name="seed">Эхний сонгосон өрөө (нэг товшилтын горимоос Ctrl-оор орсон) — null бол хоосноос.</param>
        /// <param name="plainClickFinishes">true: Ctrl/Shift-гүй дарвал тэр өрөөг нэмээд ДУУСГАНА (Ctrl+дарах = нэмэх/хасах).</param>
        public static WeTargets PickMany(UIDocument uidoc, WePickHit seed, bool plainClickFinishes)
        {
            Document doc = uidoc.Document;
            View active = uidoc.ActiveView;
            ICollection<ElementId> before = uidoc.Selection.GetElementIds();
            var set = new WePickSet();
            var hits = new Dictionary<string, WePickHit>(StringComparer.Ordinal);
            string note = null;
            try
            {
                using (var hl = new WePickHighlight(uidoc))
                using (WeHoverSession hover = WeHoverSession.TryStart(uidoc, () => set.Items.Select(c => c.Key)))
                {
                    if (seed != null && seed.Best != null)
                    {
                        set.Toggle(seed.Best);
                        hits[seed.Best.Key] = seed;
                        if (!hl.Show(new List<WePickHit> { seed })) SelectionHighlight(uidoc, active, set);
                    }
                    while (true)
                    {
                        XYZ p;
                        try { p = uidoc.Selection.PickPoint(ObjectSnapTypes.None, plainClickFinishes ? WePickRules.PromptAdd(set, note) : WePickRules.Prompt(set, note)); }
                        catch (Autodesk.Revit.Exceptions.OperationCanceledException) { break; }
                        catch (Autodesk.Revit.Exceptions.InvalidOperationException ex)
                        {
                            // Түр зураасын TransactionGroup нээлттэй үед Revit сонгуулахгүй бол — тодруулгагүйгээр үргэлжилнэ.
                            if (!hl.Active) throw;
                            hl.Abandon("сонголт TransactionGroup-тэй ажиллахгүй — " + ex.Message);
                            continue;
                        }
                        WePickHit hit = At(doc, active, p);
                        if (hit.Best == null)
                        {
                            note = hit.Why;
                            WeLog.Info("pick", "олдсонгүй · " + hit.Diagnostics);
                            continue;
                        }
                        if (plainClickFinishes && !MultiModifier())
                        {
                            // Ctrl-гүй дарах = энэ өрөөг (сонгогдоогүй бол) нэмээд ДУУСГАХ.
                            if (!set.Contains(hit.Best)) { set.Toggle(hit.Best); hits[hit.Best.Key] = hit; }
                            WeLog.Info("pick", "дуусгах товшилт · " + Describe(hit) + " · нийт " + set.Count);
                            break;
                        }
                        bool added = set.Toggle(hit.Best);
                        if (added) hits[hit.Best.Key] = hit; else hits.Remove(hit.Best.Key);
                        note = added ? null : hit.Best.Label + " хасагдлаа";
                        List<WePickHit> shown = set.Items.Select(c => hits[c.Key]).ToList();
                        if (!hl.Show(shown)) SelectionHighlight(uidoc, active, set);
                        WeLog.Info("pick", (added ? "+ " : "− ") + Describe(hit));
                    }
                }
            }
            finally
            {
                // Сонголтыг командын өмнөх байдалд — дараагийн ажиллуулалт «урьдчилан сонгосон» гэж андуурахгүй.
                try { uidoc.Selection.SetElementIds(before ?? new List<ElementId>()); } catch { }
            }
            if (set.Count == 0) return null;
            return ToTargets(doc, set.Items);
        }

        // ───────────────────────────── «Энэ планы бүх өрөө» ─────────────────────────────

        /// <summary>
        /// Идэвхтэй планы бүх битүү өрөө: host-ын харагдах өрөө + link-ийн өрөө (tag-тай нь tag-аар, tag-ГҮЙ нь давхраар таарсан, crop дотор).
        /// Өмнө нь link-ийн өрөөг ЗӨВХӨН tag-аар олдог байсан тул шошгогүй өрөө жагсаалтад ордоггүй байв.
        /// </summary>
        public static WeTargets AllRooms(Document doc, ViewPlan plan)
        {
            var t = new WeTargets();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            try
            {
                foreach (Room r in new FilteredElementCollector(doc, plan.Id).OfCategory(BuiltInCategory.OST_Rooms)
                             .WhereElementIsNotElementType().OfType<Room>())
                {
                    if (!(r.Area > 1e-6)) continue;
                    if (seen.Add(WeRoomRef.Uid(r, null))) t.Ids.Add(r.Id);
                }
                foreach (ElementId tagId in ElevationTargetResolver.LinkedRoomTagsIn(doc, plan))
                {
                    var tag = doc.GetElement(tagId) as RoomTag;
                    RevitLinkInstance li;
                    Room r = WeRoomRef.FromTag(doc, tag, out li);
                    if (r == null || li == null) continue;
                    if (seen.Add(WeRoomRef.Uid(r, li))) t.Ids.Add(tagId);
                }
                Phase phase = PhaseOf(doc, plan);
                double planZ = WeAnnoSourceReader.LevelZ(plan.GenLevel);
                BoundingBoxXYZ crop = null;
                try { if (plan.CropBoxActive) crop = plan.CropBox; } catch { crop = null; }
                foreach (LinkCtx lc in Links(doc, plan, phase))
                {
                    if (!lc.Usable) continue;
                    ElementId lid = lc.MatchLevel(planZ);
                    if (lid == null) continue;
                    foreach (Room r in RoomsOnLevel(lc.Doc, lid, true))
                    {
                        if (lc.Phase != null && !PhaseIs(r, lc.Phase.Id)) continue;
                        var lp = r.Location as LocationPoint;
                        if (lp == null) continue;
                        if (crop != null && !InCrop(crop, lc.ToHost.OfPoint(lp.Point))) continue;
                        string uid = WeRoomRef.Uid(r, lc.Instance);
                        if (seen.Add(uid)) t.RoomUids.Add(uid);
                    }
                }
            }
            catch (Exception ex) { WeLog.Info("targets", "планы бүх өрөө — " + ex.Message); }
            return t;
        }

        // ───────────────────────────── цэг → өрөө ─────────────────────────────

        /// <summary>
        /// Цэгт байгаа өрөө (эсвэл өрөө биш бол host хана).  Гурван шат:
        /// (1) host — харагдацын шатаар (<c>GetRoomAtPoint(p, phase)</c>), link — link-ийн ИЖИЛ НЭРТЭЙ шатаар (байхгүй бол сүүлийн шат);
        /// (2) олдоогүй бол ДАВХРЫН ХАЙЛТ — тэр давхрын өрөө бүрийн эзлэхүүний дунд өндөрт <c>IsPointInRoom</c> (өндрийн тооллын суурь,
        /// өрөөний base offset, шатнаас үл хамаарна); (3) хана.  Олдоогүй бол <see cref="WePickHit.Why"/> + <see cref="WePickHit.Diagnostics"/>.
        /// </summary>
        internal static WePickHit At(Document doc, View active, XYZ picked)
        {
            var hit = new WePickHit();
            ViewPlan plan;
            XYZ model;
            Viewport vp;
            Transform m2p;
            if (!ToPlanPoint(doc, active, picked, out plan, out model, out vp, out m2p))
            {
                hit.Why = active is ViewSheet ? "тэр цэгт планы viewport алга" : "энэ харагдацад цэгээр сонгох боломжгүй";
                hit.Diagnostics = hit.Why + " (харагдац «" + (active != null ? active.Name : "-") + "»)";
                return hit;
            }
            hit.Plan = plan;
            hit.Viewport = vp;
            hit.ModelToProjection = m2p;
            Level lvl = plan.GenLevel;
            double planZ = WeAnnoSourceReader.LevelZ(lvl);
            var probe = new XYZ(model.X, model.Y, planZ + ProbeAboveLevelFt);
            Phase phase = PhaseOf(doc, plan);
            List<LinkCtx> links = Links(doc, plan, phase);
            HashSet<string> tagged = TaggedLinkRooms(doc, plan);

            var found = new List<Found>();
            int order = 0;

            // (1) host
            Room hostRoom = null;
            try { hostRoom = phase != null ? doc.GetRoomAtPoint(probe, phase) : doc.GetRoomAtPoint(probe); } catch { hostRoom = null; }
            if (hostRoom != null && hostRoom.Area > 1e-6) found.Add(Make(hostRoom, null, false, order++));

            // (1) link
            foreach (LinkCtx lc in links)
            {
                if (!lc.Usable) continue;
                XYZ lp = lc.ToLink.OfPoint(probe);
                Room r = null;
                try { if (lc.Phase != null) r = lc.Doc.GetRoomAtPoint(lp, lc.Phase); } catch { r = null; }
                if (r == null) { try { r = lc.Doc.GetRoomAtPoint(lp); } catch { r = null; } }
                if (r == null || !(r.Area > 1e-6)) continue;
                found.Add(Make(r, lc.Instance, tagged.Contains(lc.Instance.Id.Value + ":" + r.Id.Value), order++));
            }

            // (2) давхрын хайлт
            if (!found.Any(f => f.C.IsRoom))
            {
                var level = new List<Found>();
                foreach (Room r in RoomsOnLevel(doc, lvl.Id, true))
                    if (ContainsXY(r, model)) level.Add(Make(r, null, false, order++, phase == null || PhaseIs(r, phase.Id)));
                foreach (LinkCtx lc in links)
                {
                    if (!lc.Usable) continue;
                    ElementId lid = lc.MatchLevel(planZ);
                    if (lid == null) continue;
                    XYZ lm = lc.ToLink.OfPoint(model);
                    foreach (Room r in RoomsOnLevel(lc.Doc, lid, true))
                        if (ContainsXY(r, lm))
                            level.Add(Make(r, lc.Instance, tagged.Contains(lc.Instance.Id.Value + ":" + r.Id.Value), order++,
                                           lc.Phase == null || PhaseIs(r, lc.Phase.Id)));
                }
                // Нэг байрлалд өөр өөр шатны өрөө (одоо байгаа / шинэ) — харагдацын шаттай таарсан нь.
                if (level.Any(f => f.PhaseMatch)) level = level.Where(f => f.PhaseMatch).ToList();
                if (level.Count > 0) hit.Via = "давхрын хайлт";
                found.AddRange(level);
            }

            // (3) хана
            if (found.Count == 0)
            {
                Wall w = HostWallAt(doc, model, planZ + ProbeAboveLevelFt);
                if (w != null)
                    found.Add(new Found
                    {
                        C = new WePickCandidate { Key = w.UniqueId, Label = "хана " + WallLabel(w), IsRoom = false, IsHost = true, Order = order++ },
                        Wall = w,
                    });
            }

            WePickCandidate best = WePickRules.Choose(found.Select(f => f.C));
            if (best != null)
            {
                Found f = found.First(x => ReferenceEquals(x.C, best));
                hit.Best = best;
                hit.Room = f.Room;
                hit.Link = f.Link;
                hit.Wall = f.Wall;
                hit.Diagnostics = Context(plan, lvl, planZ, model, phase);
                return hit;
            }
            Explain(doc, hit, plan, lvl, planZ, model, phase, links);
            return hit;
        }

        private sealed class Found
        {
            public WePickCandidate C;
            public Room Room;
            public RevitLinkInstance Link;
            public Wall Wall;
            public bool PhaseMatch = true;
        }

        private static Found Make(Room r, RevitLinkInstance li, bool tagged, int order, bool phaseMatch = true)
        {
            return new Found
            {
                C = new WePickCandidate
                {
                    Key = li == null ? r.UniqueId : WeRoomRef.Uid(r, li),
                    Label = Label(r), IsRoom = true, IsHost = li == null, TaggedInView = tagged, Area = r.Area, Order = order,
                },
                Room = r,
                Link = li,
                PhaseMatch = phaseMatch,
            };
        }

        /// <summary>Цэг өрөөний хил дотор эсэх — өрөөний ӨӨРИЙН эзлэхүүний дунд өндөрт (өндрийн тооллын суурь, base offset-оос үл хамаарна).</summary>
        private static bool ContainsXY(Room r, XYZ p)
        {
            try
            {
                BoundingBoxXYZ bb = r.get_BoundingBox(null);
                if (bb == null) return false;
                const double eps = 1e-6;
                if (p.X < bb.Min.X - eps || p.X > bb.Max.X + eps || p.Y < bb.Min.Y - eps || p.Y > bb.Max.Y + eps) return false;
                return r.IsPointInRoom(new XYZ(p.X, p.Y, (bb.Min.Z + bb.Max.Z) / 2));
            }
            catch { return false; }
        }

        private static IEnumerable<Room> RoomsOnLevel(Document d, ElementId levelId, bool enclosedOnly)
        {
            List<Room> list;
            try
            {
                list = new FilteredElementCollector(d).OfCategory(BuiltInCategory.OST_Rooms).WhereElementIsNotElementType()
                    .OfType<Room>().Where(r => r.LevelId == levelId && (!enclosedOnly || r.Area > 1e-6)).ToList();
            }
            catch { list = new List<Room>(); }
            return list;
        }

        private static bool PhaseIs(Room r, ElementId phaseId)
        {
            try
            {
                Parameter p = r.get_Parameter(BuiltInParameter.ROOM_PHASE);
                return p == null || p.AsElementId() == phaseId;
            }
            catch { return true; }
        }

        private static bool InCrop(BoundingBoxXYZ crop, XYZ hostPoint)
        {
            try
            {
                XYZ l = crop.Transform.Inverse.OfPoint(hostPoint);
                return l.X >= crop.Min.X && l.X <= crop.Max.X && l.Y >= crop.Min.Y && l.Y <= crop.Max.Y;
            }
            catch { return true; }
        }

        // ───────────────────────────── link ─────────────────────────────

        private sealed class LinkCtx
        {
            public RevitLinkInstance Instance;
            public Document Doc;
            public Transform ToHost;
            public Transform ToLink;
            /// <summary>Host-ын харагдацын шаттай ИЖИЛ НЭРТЭЙ link-ийн шат (байхгүй бол null — link-ийн сүүлийн шат).</summary>
            public Phase Phase;
            public bool Hidden;
            public string Name;
            /// <summary>Link-ийн файлын нэр («X.rvt»), төлөв (Loaded / Unloaded / NotFound …), Revit-ийн хайсан бүтэн зам.</summary>
            public string FileName;
            public LinkedFileStatus Status = LinkedFileStatus.Loaded;
            public string Path;
            public int Nested;
            public bool Loaded { get { return Doc != null; } }
            public bool Usable { get { return Doc != null && !Hidden; } }

            private List<KeyValuePair<string, double>> _levels;
            private readonly Dictionary<string, ElementId> _byKey = new Dictionary<string, ElementId>(StringComparer.Ordinal);
            private readonly Dictionary<string, string> _names = new Dictionary<string, string>(StringComparer.Ordinal);

            /// <summary>Link-ийн давхруудын өндөр host-ын координатад.</summary>
            public List<KeyValuePair<string, double>> Levels
            {
                get
                {
                    if (_levels != null) return _levels;
                    _levels = new List<KeyValuePair<string, double>>();
                    try
                    {
                        foreach (Level l in new FilteredElementCollector(Doc).OfClass(typeof(Level)).Cast<Level>())
                        {
                            string k = l.Id.Value.ToString(CultureInfo.InvariantCulture);
                            _byKey[k] = l.Id;
                            _names[k] = l.Name;
                            _levels.Add(new KeyValuePair<string, double>(k, ToHost.OfPoint(new XYZ(0, 0, WeAnnoSourceReader.LevelZ(l))).Z));
                        }
                    }
                    catch { }
                    return _levels;
                }
            }

            public ElementId MatchLevel(double hostZ)
            {
                string k = WeLevelMatch.Nearest(Levels, hostZ, LevelMatchTolFt);
                return k != null ? _byKey[k] : null;
            }

            /// <summary>Хамгийн ойр давхар (хүлцэлгүй) — оношлогоонд.</summary>
            public string NearestLevelText(double hostZ)
            {
                string k = WeLevelMatch.Nearest(Levels, hostZ, double.MaxValue);
                if (k == null) return "давхаргүй";
                double z = Levels.First(l => l.Key == k).Value;
                return "«" + _names[k] + "» " + Mm(z - hostZ) + " мм";
            }
        }

        private static List<LinkCtx> Links(Document doc, View plan, Phase phase)
        {
            var list = new List<LinkCtx>();
            try
            {
                foreach (RevitLinkInstance li in new FilteredElementCollector(doc).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>())
                {
                    var lc = new LinkCtx { Instance = li, Name = SafeName(li) };
                    lc.FileName = lc.Name;
                    try { lc.Doc = li.GetLinkDocument(); } catch { lc.Doc = null; }
                    try
                    {
                        var lt = doc.GetElement(li.GetTypeId()) as RevitLinkType;
                        if (lt != null)
                        {
                            lc.FileName = lt.Name;
                            ExternalFileReference efr = lt.GetExternalFileReference();
                            if (efr != null)
                            {
                                lc.Status = efr.GetLinkedFileStatus();
                                lc.Path = ModelPathUtils.ConvertModelPathToUserVisiblePath(efr.GetAbsolutePath());
                            }
                        }
                    }
                    catch { }
                    lc.ToHost = WeRoomRef.TransformOf(li);
                    lc.ToLink = lc.ToHost.Inverse;
                    lc.Hidden = Hidden(li, plan);
                    if (lc.Doc != null)
                    {
                        if (phase != null)
                        {
                            try { lc.Phase = lc.Doc.Phases.Cast<Phase>().FirstOrDefault(p => string.Equals(p.Name, phase.Name, StringComparison.OrdinalIgnoreCase)); }
                            catch { lc.Phase = null; }
                        }
                        try { lc.Nested = new FilteredElementCollector(lc.Doc).OfClass(typeof(RevitLinkInstance)).GetElementCount(); } catch { }
                    }
                    list.Add(lc);
                }
            }
            catch (Exception ex) { WeLog.Info("pick", "link жагсаалт — " + ex.Message); }
            return list;
        }

        private static string SafeName(RevitLinkInstance li)
        {
            try { return li.Name; } catch { return "#" + li.Id.Value; }
        }

        // ───────────────────────────── урьдчилсан шалгалт ─────────────────────────────

        /// <summary>
        /// Идэвхтэй планд сонгож болох (битүү) өрөө ОГТ байхгүй бол хэрэглэгчид хэлэх шалтгаан; байвал null.  Зөвхөн план (хуудсанд товшилтын
        /// <see cref="Explain"/>).  Загварт хүрэхгүй.
        /// </summary>
        internal static string Preflight(Document doc, View active)
        {
            var plan = active as ViewPlan;
            if (plan == null || plan.IsTemplate || plan.GenLevel == null) return null;
            try
            {
                if (RoomsOnLevel(doc, plan.GenLevel.Id, true).Any()) return null;
                Phase phase = PhaseOf(doc, plan);
                double planZ = WeAnnoSourceReader.LevelZ(plan.GenLevel);
                List<LinkCtx> links = Links(doc, plan, phase);
                foreach (LinkCtx lc in links)
                {
                    if (!lc.Usable) continue;
                    ElementId lid = lc.MatchLevel(planZ);
                    if (lid != null && RoomsOnLevel(lc.Doc, lid, true).Any()) return null;
                }
                Dictionary<long, int> tags = RoomTagsByLink(doc, plan);
                Func<LinkCtx, int> tagCount = l => { int n; return tags.TryGetValue(l.Instance.Id.Value, out n) ? n : 0; };
                List<LinkCtx> dead = links.Where(l => !l.Loaded).OrderByDescending(tagCount).ToList();
                if (dead.Count > 0 && (tagCount(dead[0]) > 0 || links.All(l => !l.Usable)))
                {
                    string msg = LinkProblem(dead[0], tagCount(dead[0]));
                    List<string> others = dead.Skip(1).Select(l => l.FileName).Where(n => !string.Equals(n, dead[0].FileName, StringComparison.OrdinalIgnoreCase))
                                              .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                    if (others.Count > 0) msg += "\n\nАчаалагдаагүй бусад link: " + string.Join(", ", others.Select(n => "«" + n + "»"));
                    return msg;
                }
                if (links.Any(l => l.Usable && l.Hidden))
                    return "Энэ давхарт өрөө харагдахгүй: өрөөтэй link энэ харагдацад нуугдсан байж магадгүй (Visibility/Graphics → Revit Links).";
                return "Энэ давхарт («" + plan.GenLevel.Name + "») битүү өрөө (Room) алга — үндсэн файлд ч, ачаалагдсан link-д ч.  " +
                       "Өрөөгүй бол хана дээр дарж ханаар нь дэлгээс гаргана.";
            }
            catch (Exception ex)
            {
                WeLog.Info("pick", "урьдчилсан шалгалт — " + ex.Message);
                return null;
            }
        }

        /// <summary>«Өрөөнүүд «X.rvt» link-д байдаг ч тэр link ОЛДСОНГҮЙ — …  Засах: Manage Links → …».</summary>
        private static string LinkProblem(LinkCtx l, int tagCount)
        {
            bool notFound = l.Status == LinkedFileStatus.NotFound;
            var sb = new StringBuilder();
            sb.Append(tagCount > 0 ? "Энэ планы өрөөнүүд «" + l.FileName + "» link-д байдаг (" + tagCount + " өрөөний шошго түүн рүү заадаг), харин тэр link "
                                   : "Өрөөтэй байж болох «" + l.FileName + "» link ");
            if (notFound)
                sb.Append("ОЛДСОНГҮЙ — Revit файлыг " + (string.IsNullOrEmpty(l.Path) ? "хадгалсан замаас" : "«" + l.Path + "» замаас") + " хайсан.  " +
                          "Файлыг өөр хавтас руу хуулсан (link харьцангуй замтай) эсвэл серверийн зам өөрчлөгдсөн байж магадгүй.");
            else
                sb.Append("ачаалагдаагүй (Unloaded).");
            sb.Append("\n\nЗасах: Manage таб → Manage Links → Revit таб → «" + l.FileName + "» мөрийг сонгоод " +
                      (notFound ? "«Reload From…» (зөв файлыг заана)" : "«Reload»") + ".  Ачаалсны дараа «Ханын дэлгээс»-ийг дахин дарна уу.");
            return sb.ToString();
        }

        /// <summary>Энэ планд байрлуулсан өрөөний шошго — link instance бүрээр (ачаалагдаагүй link-ийнх ч; харагдацын collector тэднийг алгасдаг).</summary>
        private static Dictionary<long, int> RoomTagsByLink(Document doc, View plan)
        {
            var d = new Dictionary<long, int>();
            try
            {
                foreach (RoomTag t in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_RoomTags).WhereElementIsNotElementType().OfType<RoomTag>())
                {
                    if (t.OwnerViewId != plan.Id) continue;
                    LinkElementId lid;
                    try { lid = t.TaggedRoomId; } catch { continue; }
                    if (lid == null || lid.LinkInstanceId == ElementId.InvalidElementId) continue;
                    long k = lid.LinkInstanceId.Value;
                    int n;
                    d[k] = d.TryGetValue(k, out n) ? n + 1 : 1;
                }
            }
            catch { }
            return d;
        }

        // ───────────────────────────── оношлогоо ─────────────────────────────

        /// <summary>Олдоогүй шалтгаан (хэрэглэгчид) + бүрэн оношлогоо (лог-д) — бодит төслийн файлыг нээлгүйгээр шалтгааныг олохын тулд.</summary>
        private static void Explain(Document doc, WePickHit hit, ViewPlan plan, Level lvl, double planZ, XYZ model, Phase phase, List<LinkCtx> links)
        {
            var d = new StringBuilder(Context(plan, lvl, planZ, model, phase));
            int roomsHere = 0;
            bool unloaded = false, noLevel = false, nested = false;
            Room nearest = null;
            double nearestD = double.MaxValue;

            List<Room> host = RoomsOnLevel(doc, lvl.Id, false).ToList();
            int hostOpen = host.Count(r => !(r.Area > 1e-6));
            roomsHere += host.Count;
            d.Append(" · host: энэ давхарт өрөө ").Append(host.Count);
            if (hostOpen > 0) d.Append(" (битүү биш ").Append(hostOpen).Append(')');
            Nearest(host, model, ref nearest, ref nearestD);

            foreach (LinkCtx lc in links)
            {
                d.Append(" · link «").Append(lc.Name).Append("»: ");
                if (!lc.Loaded) { d.Append("ачаалагдаагүй (").Append(lc.Status).Append(", ").Append(lc.Path).Append(')'); unloaded = true; continue; }
                if (lc.Hidden) d.Append("харагдацад нуугдсан, ");
                d.Append("шат ").Append(lc.Phase != null ? "«" + lc.Phase.Name + "»" : "сүүлийнх");
                if (lc.Nested > 0) { d.Append(", дотроо ").Append(lc.Nested).Append(" link"); nested = true; }
                ElementId lid = lc.MatchLevel(planZ);
                if (lid == null)
                {
                    d.Append(", давхар таарсангүй (хамгийн ойр ").Append(lc.NearestLevelText(planZ)).Append(')');
                    noLevel = true;
                    continue;
                }
                List<Room> rooms = RoomsOnLevel(lc.Doc, lid, false).ToList();
                int open = rooms.Count(r => !(r.Area > 1e-6));
                if (!lc.Hidden) roomsHere += rooms.Count;
                d.Append(", давхар ").Append(lc.NearestLevelText(planZ)).Append(", өрөө ").Append(rooms.Count);
                if (open > 0) d.Append(" (битүү биш ").Append(open).Append(')');
                if (!lc.Hidden) Nearest(rooms, lc.ToLink.OfPoint(model), ref nearest, ref nearestD);
            }
            if (nearest != null) d.Append(" · хамгийн ойр «").Append(Label(nearest)).Append("» ").Append(Mm(nearestD)).Append(" мм")
                                  .Append(nearest.Area > 1e-6 ? string.Empty : " (битүү биш)");
            hit.Diagnostics = d.ToString();

            if (nearest != null && !(nearest.Area > 1e-6) && nearestD < NearOpenRoomFt)
                hit.Why = "«" + Label(nearest) + "» өрөө битүү биш (Not Enclosed) — хана эсвэл Room Separation-аар хилийг нь хааж, дахин оролдоно уу";
            else if (roomsHere == 0 && unloaded)
            {
                Dictionary<long, int> tags = RoomTagsByLink(doc, plan);
                Func<LinkCtx, int> tagCount = l => { int n; return tags.TryGetValue(l.Instance.Id.Value, out n) ? n : 0; };
                LinkCtx dead = links.Where(l => !l.Loaded).OrderByDescending(tagCount).First();
                hit.Why = "тэр цэгт өрөө олдсонгүй.  " + LinkProblem(dead, tagCount(dead));
            }
            else if (roomsHere == 0)
                hit.Why = noLevel ? "энэ давхарт («" + lvl.Name + "») link-ийн давхар таарсангүй — link-ийн давхрын өндөр өөр байна"
                        : "энэ давхарт («" + lvl.Name + "») өрөө байрлуулаагүй байна (Room)";
            else if (nearest != null)
                hit.Why = "тэр цэг ямар ч өрөөний хил дотор биш (хамгийн ойр: «" + Label(nearest) + "», " + (nearestD * 0.3048).ToString("0.0", CultureInfo.InvariantCulture) + " м)";
            else
                hit.Why = "тэр цэгт өрөө, хана олдсонгүй";
            if (nested && roomsHere == 0) hit.Why += " · link-ийн дотор өөр link бий — тэнд байгаа өрөөг одоогоор дэмжихгүй";
        }

        private static void Nearest(IEnumerable<Room> rooms, XYZ p, ref Room best, ref double bestD)
        {
            foreach (Room r in rooms)
            {
                var lp = r.Location as LocationPoint;
                if (lp == null) continue;
                double dx = lp.Point.X - p.X, dy = lp.Point.Y - p.Y;
                double dd = Math.Sqrt(dx * dx + dy * dy);
                if (dd < bestD) { best = r; bestD = dd; }
            }
        }

        private static string Context(ViewPlan plan, Level lvl, double planZ, XYZ model, Phase phase)
        {
            return "план «" + plan.Name + "» · давхар «" + lvl.Name + "» Z=" + Mm(planZ) + " мм · цэг (" + Mm(model.X) + ", " + Mm(model.Y)
                   + ") мм · шат «" + (phase != null ? phase.Name : "-") + "»";
        }

        private static string Describe(WePickHit hit)
        {
            return hit.Best.Label + " (" + (hit.Best.IsHost ? "host" : "link «" + SafeName(hit.Link) + "»") + (hit.Via != null ? ", " + hit.Via : string.Empty)
                   + ") · " + hit.Diagnostics;
        }

        private static string Mm(double ft)
        {
            return Math.Round(ft * 304.8).ToString("0", CultureInfo.InvariantCulture);
        }

        private static string Capital(string s)
        {
            return string.IsNullOrEmpty(s) ? s : char.ToUpper(s[0], CultureInfo.CurrentCulture) + s.Substring(1);
        }

        // ───────────────────────────── хуудас → план ─────────────────────────────

        internal static bool ToPlanPoint(Document doc, View active, XYZ picked, out ViewPlan plan, out XYZ model)
        {
            Viewport vp;
            Transform m2p;
            return ToPlanPoint(doc, active, picked, out plan, out model, out vp, out m2p);
        }

        /// <summary>
        /// Товшсон цэг → планы загварын цэг.  План идэвхтэй бол шууд; хуудас бол цэгийг агуулсан план viewport (хамгийн жижиг) → sheet →
        /// projection → model.
        /// </summary>
        internal static bool ToPlanPoint(Document doc, View active, XYZ picked, out ViewPlan plan, out XYZ model, out Viewport viewport, out Transform modelToProjection)
        {
            plan = null;
            model = null;
            viewport = null;
            modelToProjection = null;
            var vp0 = active as ViewPlan;
            if (vp0 != null && !vp0.IsTemplate && vp0.GenLevel != null) { plan = vp0; model = picked; return true; }
            var sheet = active as ViewSheet;
            if (sheet == null) return false;
            Viewport best = null;
            double bestArea = double.MaxValue;
            foreach (ElementId id in sheet.GetAllViewports())
            {
                var vp = doc.GetElement(id) as Viewport;
                var v = vp != null ? doc.GetElement(vp.ViewId) as ViewPlan : null;
                if (v == null || v.GenLevel == null) continue;
                Outline o;
                try { o = vp.GetBoxOutline(); } catch { continue; }
                if (picked.X < o.MinimumPoint.X || picked.X > o.MaximumPoint.X || picked.Y < o.MinimumPoint.Y || picked.Y > o.MaximumPoint.Y) continue;
                double a = (o.MaximumPoint.X - o.MinimumPoint.X) * (o.MaximumPoint.Y - o.MinimumPoint.Y);
                if (a < bestArea) { best = vp; bestArea = a; }
            }
            if (best == null) return false;
            var view = (ViewPlan)doc.GetElement(best.ViewId);
            try
            {
                XYZ proj = best.GetProjectionToSheetTransform().Inverse.OfPoint(new XYZ(picked.X, picked.Y, 0));
                IList<TransformWithBoundary> mtp = view.GetModelToProjectionTransforms();
                if (mtp == null || mtp.Count == 0) return false;
                // Хуваагдсан (split) планд хэсэг бүр өөр transform — цэг аль хэсгийнх болохыг хилээр нь.
                Transform chosen = null;
                foreach (TransformWithBoundary twb in mtp)
                {
                    Transform m2p = twb.GetModelToProjectionTransform();
                    XYZ cand = m2p.Inverse.OfPoint(proj);
                    CurveLoop bound = null;
                    try { bound = twb.GetBoundary(); } catch { bound = null; }
                    if (mtp.Count == 1 || bound == null || InsideXY(bound, cand)) { chosen = m2p; break; }
                }
                if (chosen == null) chosen = mtp[0].GetModelToProjectionTransform();
                model = chosen.Inverse.OfPoint(proj);
                plan = view;
                viewport = best;
                modelToProjection = chosen;
                return true;
            }
            catch (Exception ex)
            {
                WeLog.Info("pick", "хуудасны цэгийг план руу хөрвүүлж чадсангүй — " + ex.Message);
                return false;
            }
        }

        private static bool InsideXY(CurveLoop loop, XYZ p)
        {
            var pts = new List<XYZ>();
            foreach (Curve c in loop) pts.Add(c.GetEndPoint(0));
            bool inside = false;
            for (int i = 0, j = pts.Count - 1; i < pts.Count; j = i++)
            {
                XYZ a = pts[i], b = pts[j];
                if ((a.Y > p.Y) != (b.Y > p.Y) && p.X < (b.X - a.X) * (p.Y - a.Y) / (b.Y - a.Y) + a.X) inside = !inside;
            }
            return inside;
        }

        // ───────────────────────────── туслах ─────────────────────────────

        private static WeTargets ToTargets(Document doc, IEnumerable<WePickCandidate> items)
        {
            var t = new WeTargets();
            foreach (WePickCandidate c in items)
            {
                if (c.IsHost)
                {
                    Element e = doc.GetElement(c.Key);
                    if (e != null) t.Ids.Add(e.Id);
                }
                else t.RoomUids.Add(c.Key);
            }
            return t;
        }

        private static Phase PhaseOf(Document doc, View v)
        {
            try
            {
                Parameter p = v.get_Parameter(BuiltInParameter.VIEW_PHASE);
                return p != null ? doc.GetElement(p.AsElementId()) as Phase : null;
            }
            catch { return null; }
        }

        private static bool Hidden(RevitLinkInstance li, View v)
        {
            try
            {
                if (li.IsHidden(v)) return true;
                Category c = li.Category;
                return c != null && v.GetCategoryHidden(c.Id);
            }
            catch { return false; }
        }

        /// <summary>Идэвхтэй планд tag-тай link-ийн өрөөнүүд («inst:elem»).</summary>
        private static HashSet<string> TaggedLinkRooms(Document doc, View plan)
        {
            var s = new HashSet<string>(StringComparer.Ordinal);
            try
            {
                foreach (RoomTag t in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_RoomTags).WhereElementIsNotElementType().OfType<RoomTag>())
                {
                    if (t.OwnerViewId != plan.Id) continue;
                    LinkElementId lid;
                    try { lid = t.TaggedRoomId; } catch { continue; }
                    if (lid != null && lid.LinkInstanceId != ElementId.InvalidElementId) s.Add(lid.LinkInstanceId.Value + ":" + lid.LinkedElementId.Value);
                }
            }
            catch { }
            return s;
        }

        /// <summary>Цэгийг зузаандаа агуулсан host хана (шулуун, тэр өндөрт хүрдэг).  Link-ийн ханыг шууд сонгохгүй — өрөөн дотор дарна.</summary>
        private static Wall HostWallAt(Document doc, XYZ p, double z)
        {
            Wall best = null;
            double bestD = double.MaxValue;
            foreach (Wall w in new FilteredElementCollector(doc).OfClass(typeof(Wall)).Cast<Wall>())
            {
                var line = (w.Location as LocationCurve)?.Curve as Line;
                if (line == null) continue;
                BoundingBoxXYZ bb = w.get_BoundingBox(null);
                if (bb == null || bb.Min.Z > z || bb.Max.Z < z) continue;
                XYZ a = line.GetEndPoint(0), b = line.GetEndPoint(1);
                double dx = b.X - a.X, dy = b.Y - a.Y, len = Math.Sqrt(dx * dx + dy * dy);
                if (len < 1e-6) continue;
                double t = ((p.X - a.X) * dx + (p.Y - a.Y) * dy) / (len * len);
                if (t < 0 || t > 1) continue;
                double d = Math.Abs((p.X - a.X) * dy - (p.Y - a.Y) * dx) / len;
                double half;
                try { half = w.Width / 2; } catch { half = 0; }
                if (d > half + 30 / 304.8 || d >= bestD) continue;
                best = w;
                bestD = d;
            }
            return best;
        }

        /// <summary>Түр зураас ашиглах боломжгүй үед: host өрөө/хана, link-ийн өрөөний host tag-ийг сонголтоор тодруулна (план л).</summary>
        private static void SelectionHighlight(UIDocument uidoc, View active, WePickSet set)
        {
            if (!(active is ViewPlan)) return;
            Document doc = uidoc.Document;
            var ids = new List<ElementId>();
            var linkKeys = new HashSet<string>(StringComparer.Ordinal);
            foreach (WePickCandidate c in set.Items)
            {
                if (c.IsHost) { Element e = doc.GetElement(c.Key); if (e != null) ids.Add(e.Id); }
                else linkKeys.Add(c.Key);
            }
            if (linkKeys.Count > 0)
                foreach (RoomTag t in new FilteredElementCollector(doc, active.Id).OfCategory(BuiltInCategory.OST_RoomTags).WhereElementIsNotElementType().OfType<RoomTag>())
                {
                    RevitLinkInstance li;
                    Room r = WeRoomRef.FromTag(doc, t, out li);
                    if (r != null && li != null && linkKeys.Contains(WeRoomRef.Uid(r, li))) ids.Add(t.Id);
                }
            try { uidoc.Selection.SetElementIds(ids); } catch { }
        }

        // ───────────────────────────── курсор доорх тодруулгын индекс ─────────────────────────────

        /// <summary>
        /// Идэвхтэй план (эсвэл хуудасны план viewport бүр)-ын сонгож болох өрөөнүүдийн хил — ХАРУУЛАХ координатад (план — загварын XY, хуудас —
        /// хуудасны XY).  Курсор хөдлөх бүрт Revit API дуудахгүйн тулд сонголтын ӨМНӨ нэг удаа (API-ийн орчинд).  Өрөө, түлхүүр нь
        /// <see cref="At"/>-ийн давхрын хайлттай ИЖИЛ (host + ачаалагдсан link, давхар ±600 мм, шат).
        /// </summary>
        internal static List<WeHoverRoom> HoverIndex(Document doc, View active, out double bandWidth)
        {
            var list = new List<WeHoverRoom>();
            bandWidth = 0;
            var plan = active as ViewPlan;
            if (plan != null && !plan.IsTemplate && plan.GenLevel != null)
            {
                bandWidth = 1.2 / 304.8 * Math.Max(1, plan.Scale);
                double z = WeAnnoSourceReader.LevelZ(plan.GenLevel) + 50 / 304.8;
                AddPlanRooms(doc, plan, p => new XYZ(p.X, p.Y, z), list);
                return list;
            }
            var sheet = active as ViewSheet;
            if (sheet == null) return list;
            bandWidth = 0.9 / 304.8;
            foreach (ElementId id in sheet.GetAllViewports())
            {
                var vp = doc.GetElement(id) as Viewport;
                var v = vp != null ? doc.GetElement(vp.ViewId) as ViewPlan : null;
                if (v == null || v.GenLevel == null) continue;
                try
                {
                    IList<TransformWithBoundary> mtp = v.GetModelToProjectionTransforms();
                    if (mtp == null || mtp.Count == 0) continue;
                    Transform m2p = mtp[0].GetModelToProjectionTransform(), p2s = vp.GetProjectionToSheetTransform();
                    AddPlanRooms(doc, v, p => { XYZ s = p2s.OfPoint(m2p.OfPoint(p)); return new XYZ(s.X, s.Y, 0); }, list);
                }
                catch (Exception ex) { WeLog.Info("hover", "viewport «" + v.Name + "» — " + ex.Message); }
            }
            return list;
        }

        private static void AddPlanRooms(Document doc, ViewPlan plan, Func<XYZ, XYZ> toDisplay, List<WeHoverRoom> list)
        {
            Level lvl = plan.GenLevel;
            double planZ = WeAnnoSourceReader.LevelZ(lvl);
            Phase phase = PhaseOf(doc, plan);
            HashSet<string> tagged = TaggedLinkRooms(doc, plan);
            BoundingBoxXYZ crop = null;
            try { if (plan.CropBoxActive) crop = plan.CropBox; } catch { crop = null; }
            int order = list.Count;
            foreach (Room r in RoomsOnLevel(doc, lvl.Id, true))
            {
                if (phase != null && !PhaseIs(r, phase.Id)) continue;
                AddHoverRoom(r, null, Transform.Identity, false, lvl.Name, crop, toDisplay, order++, list);
            }
            foreach (LinkCtx lc in Links(doc, plan, phase))
            {
                if (!lc.Usable) continue;
                ElementId lid = lc.MatchLevel(planZ);
                if (lid == null) continue;
                foreach (Room r in RoomsOnLevel(lc.Doc, lid, true))
                {
                    if (lc.Phase != null && !PhaseIs(r, lc.Phase.Id)) continue;
                    AddHoverRoom(r, lc.Instance, lc.ToHost, tagged.Contains(lc.Instance.Id.Value + ":" + r.Id.Value), lvl.Name, crop, toDisplay, order++, list);
                }
            }
        }

        private static void AddHoverRoom(Room r, RevitLinkInstance li, Transform toHost, bool tagged, string levelName, BoundingBoxXYZ crop,
                                         Func<XYZ, XYZ> toDisplay, int order, List<WeHoverRoom> list)
        {
            try
            {
                var lp = r.Location as LocationPoint;
                BoundingBoxXYZ bb = r.get_BoundingBox(null);
                if (crop != null && bb != null)
                {
                    // Crop-ийн гадна бүрэн гарсан өрөө — алгасна (өрөөний хайрцгийн 4 булан + төв).
                    XYZ a = toHost.OfPoint(bb.Min), b = toHost.OfPoint(bb.Max);
                    bool any = new[] { a, b, new XYZ(a.X, b.Y, a.Z), new XYZ(b.X, a.Y, a.Z), (a + b) * 0.5 }.Any(p => InCrop(crop, p));
                    if (!any && lp != null && !InCrop(crop, toHost.OfPoint(lp.Point))) return;
                }
                IList<IList<BoundarySegment>> segs = r.GetBoundarySegments(new SpatialElementBoundaryOptions
                {
                    SpatialElementBoundaryLocation = SpatialElementBoundaryLocation.Finish,
                });
                if (segs == null || segs.Count == 0) return;
                var hr = new WeHoverRoom
                {
                    Candidate = Make(r, li, tagged, order).C,
                    Caption = Label(r) + " · " + levelName + (li != null ? " · link «" + LinkFileName(li) + "»" : string.Empty),
                };
                foreach (IList<BoundarySegment> loop in segs)
                {
                    var pts = new List<WeV3>();
                    foreach (BoundarySegment s in loop)
                    {
                        Curve c = s.GetCurve();
                        if (c == null) continue;
                        IList<XYZ> t = c.Tessellate();
                        for (int i = 0; i + 1 < t.Count; i++) { XYZ d = toDisplay(toHost.OfPoint(t[i])); pts.Add(new WeV3(d.X, d.Y, d.Z)); }
                    }
                    if (pts.Count >= 3) hr.Loops.Add(pts);
                }
                if (hr.Loops.Count == 0) return;
                hr.Grow();
                list.Add(hr);
            }
            catch { /* нэг өрөөний хил уншигдаагүй — тодруулгагүй, дарахад At() хэвээр олно */ }
        }

        private static string LinkFileName(RevitLinkInstance li)
        {
            try
            {
                var lt = li.Document.GetElement(li.GetTypeId()) as RevitLinkType;
                return lt != null ? lt.Name : SafeName(li);
            }
            catch { return SafeName(li); }
        }

        internal static string Label(Room r)
        {
            string name = string.Empty;
            try { Parameter p = r.get_Parameter(BuiltInParameter.ROOM_NAME); name = p != null ? p.AsString() ?? string.Empty : string.Empty; } catch { }
            return (r.Number + " " + name).Trim();
        }

        private static string WallLabel(Wall w)
        {
            try
            {
                Parameter m = w.get_Parameter(BuiltInParameter.ALL_MODEL_MARK);
                string mark = m != null ? m.AsString() : null;
                return !string.IsNullOrEmpty(mark) ? mark : "#" + w.Id.Value;
            }
            catch { return "#" + w.Id.Value; }
        }
    }

    /// <summary>
    /// Олон өрөөний горимын ТҮР тодруулга: сонгосон өрөө бүрийн хил (бүдүүн шугам) + «✓ нэр» идэвхтэй план / хуудсан дээр.  Бүх зураас нэг
    /// TransactionGroup-д; <see cref="Dispose"/> = RollBack — загварт юу ч үлдэхгүй, Undo-д ч орохгүй.  Алдаа гарвал өөрийгөө унтрааж
    /// (<see cref="Active"/> = false) сонголт үргэлжилнэ.
    /// </summary>
    internal sealed class WePickHighlight : IDisposable
    {
        private readonly UIDocument _uidoc;
        private readonly Document _doc;
        private readonly View _view;
        private TransactionGroup _group;
        private bool _off;
        private readonly List<ElementId> _drawn = new List<ElementId>();
        private GraphicsStyle _style;
        private ElementId _textType = ElementId.InvalidElementId;
        private bool _colour;
        private double _planZ;
        private bool _zeroZ;

        public WePickHighlight(UIDocument uidoc)
        {
            _uidoc = uidoc;
            _doc = uidoc.Document;
            _view = uidoc.ActiveView;
            _off = !(_view is ViewPlan || _view is ViewSheet);
        }

        /// <summary>Тодруулга ажиллаж байгаа (эсвэл хараахан эхлээгүй ч боломжтой).</summary>
        public bool Active { get { return !_off; } }

        public void Abandon(string why)
        {
            WeLog.Info("pick", "түр тодруулга унтарлаа — " + why);
            _off = true;
            RollBack();
        }

        /// <returns>false = тодруулга унтарсан (дуудагч сонголтоор тодруулна).</returns>
        public bool Show(IList<WePickHit> hits)
        {
            if (_off) return false;
            try
            {
                if (_group == null)
                {
                    Init();
                    _group = new TransactionGroup(_doc, "MGL — өрөө сонголт (түр)");
                    _group.Start();
                }
                using (var t = new Transaction(_doc, "MGL — сонголтын тодруулга"))
                {
                    FailureHandlingOptions fho = t.GetFailureHandlingOptions();
                    fho.SetFailuresPreprocessor(new WeFailureSwallower());
                    fho.SetClearAfterRollback(true);
                    t.SetFailureHandlingOptions(fho);
                    t.Start();
                    foreach (ElementId id in _drawn) { try { _doc.Delete(id); } catch { } }
                    _drawn.Clear();
                    foreach (WePickHit h in hits) Draw(h);
                    if (t.Commit() != TransactionStatus.Committed) throw new InvalidOperationException("тодруулгын transaction commit болсонгүй");
                }
                try { _uidoc.RefreshActiveView(); } catch { }
                return true;
            }
            catch (Exception ex)
            {
                Abandon(ex.Message);
                return false;
            }
        }

        private void Init()
        {
            var plan = _view as ViewPlan;
            if (plan != null) _planZ = WeAnnoSourceReader.LevelZ(plan.GenLevel);
            // Бүдүүн шугамын хэв маяг: «Wide Lines», байхгүй бол хамгийн бүдүүн.
            try
            {
                Category lines = _doc.Settings.Categories.get_Item(BuiltInCategory.OST_Lines);
                int bestScore = int.MinValue;
                foreach (Category sc in lines.SubCategories)
                {
                    GraphicsStyle gs = sc.GetGraphicsStyle(GraphicsStyleType.Projection);
                    if (gs == null) continue;
                    int? w = sc.GetLineWeight(GraphicsStyleType.Projection);
                    int score = sc.Id.Value == (long)BuiltInCategory.OST_CurvesWideLines ? 1000 : (w ?? 0);
                    if (score > bestScore) { bestScore = score; _style = gs; }
                }
            }
            catch { _style = null; }
            try { _textType = _doc.GetDefaultElementTypeId(ElementTypeGroup.TextNoteType); } catch { _textType = ElementId.InvalidElementId; }
            // Өнгөт override нь харагдацыг өөрчилнө — хуваалцсан (central-тай) файлд харагдацыг borrow хийхгүйн тулд зөвхөн тусгаарласан / ганц файлд.
            bool shared = false;
            try { shared = _doc.IsWorkshared && !_doc.IsDetached; } catch { shared = true; }
            try { _colour = !shared && _view.AreGraphicsOverridesAllowed(); } catch { _colour = false; }
        }

        private void Draw(WePickHit h)
        {
            var pts = new List<List<XYZ>>();
            XYZ anchor = null;
            if (h.Room != null)
            {
                Transform toHost = h.Link != null ? WeRoomRef.TransformOf(h.Link) : Transform.Identity;
                var opts = new SpatialElementBoundaryOptions { SpatialElementBoundaryLocation = SpatialElementBoundaryLocation.Finish };
                IList<IList<BoundarySegment>> loops = h.Room.GetBoundarySegments(opts);
                if (loops != null)
                    foreach (IList<BoundarySegment> loop in loops)
                    {
                        var poly = new List<XYZ>();
                        foreach (BoundarySegment s in loop)
                        {
                            Curve c = s.GetCurve();
                            if (c == null) continue;
                            IList<XYZ> tp = c.Tessellate();
                            for (int i = poly.Count == 0 ? 0 : 1; i < tp.Count; i++) poly.Add(toHost.OfPoint(tp[i]));
                        }
                        if (poly.Count > 1) pts.Add(poly);
                    }
                var lp = h.Room.Location as LocationPoint;
                if (lp != null) anchor = toHost.OfPoint(lp.Point);
            }
            else if (h.Wall != null)
            {
                var lc = h.Wall.Location as LocationCurve;
                if (lc != null && lc.Curve != null) { pts.Add(lc.Curve.Tessellate().ToList()); anchor = lc.Curve.Evaluate(0.5, true); }
            }

            var ogs = _colour ? new OverrideGraphicSettings().SetProjectionLineColor(new Color(255, 102, 0)).SetProjectionLineWeight(10) : null;
            foreach (List<XYZ> poly in pts)
                for (int i = 1; i < poly.Count; i++)
                {
                    XYZ a = ToView(h, poly[i - 1]), b = ToView(h, poly[i]);
                    if (a == null || b == null || a.DistanceTo(b) < _doc.Application.ShortCurveTolerance) continue;
                    DetailCurve dc = NewLine(a, b);
                    if (_style != null) { try { dc.LineStyle = _style; } catch { } }
                    if (ogs != null) { try { _view.SetElementOverrides(dc.Id, ogs); } catch { } }
                    _drawn.Add(dc.Id);
                }
            if (anchor != null && _textType != ElementId.InvalidElementId)
            {
                XYZ at = ToView(h, anchor);
                if (at != null)
                {
                    try
                    {
                        TextNote tn = TextNote.Create(_doc, _view.Id, at, "✓ " + h.Best.Label, _textType);
                        if (ogs != null) { try { _view.SetElementOverrides(tn.Id, ogs); } catch { } }
                        _drawn.Add(tn.Id);
                    }
                    catch { }
                }
            }
        }

        /// <summary>Host загварын цэг → идэвхтэй харагдацын цэг (план: давхрын хавтгай; хуудас: model → projection → sheet).</summary>
        private XYZ ToView(WePickHit h, XYZ p)
        {
            if (_view is ViewPlan) return new XYZ(p.X, p.Y, _zeroZ ? 0 : _planZ);
            if (h.Viewport == null || h.ModelToProjection == null) return null;
            XYZ proj = h.ModelToProjection.OfPoint(p);
            XYZ s = h.Viewport.GetProjectionToSheetTransform().OfPoint(proj);
            return new XYZ(s.X, s.Y, 0);
        }

        private DetailCurve NewLine(XYZ a, XYZ b)
        {
            try { return _doc.Create.NewDetailCurve(_view, Autodesk.Revit.DB.Line.CreateBound(a, b)); }
            catch (Autodesk.Revit.Exceptions.ArgumentException)
            {
                // Планы хавтгайн өндрийг Revit өөрөөр тооцсон бол Z=0-оор (план detail curve-ийг хавтгай руу буулгадаг).
                if (!(_view is ViewPlan) || _zeroZ) throw;
                _zeroZ = true;
                return _doc.Create.NewDetailCurve(_view, Autodesk.Revit.DB.Line.CreateBound(new XYZ(a.X, a.Y, 0), new XYZ(b.X, b.Y, 0)));
            }
        }

        private void RollBack()
        {
            try { if (_group != null && _group.HasStarted()) _group.RollBack(); } catch { }
            _group = null;
            _drawn.Clear();
        }

        public void Dispose()
        {
            RollBack();
        }
    }
}
