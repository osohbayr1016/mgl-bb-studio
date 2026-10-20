using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>Төлөвлөгчийн тохиргоо + нэгж + харагдацын тохиргооны тэмдэг (төрөл, загвар, масштабын id).</summary>
    public sealed class WePlanContext
    {
        public WeSettings Settings = new WeSettings();
        public IWeUnits Units = new WeFixedUnits();
        /// <summary>Сонгосон харагдацын төрөл / загвар / масштабын тэмдэг — өөрчлөгдвөл харагдац «өөрчлөгдсөн» болно.</summary>
        public string ViewSetupToken = string.Empty;
    }

    /// <summary>
    /// Сонголт → дэлгээсний ТӨЛӨВЛӨГӨӨ.  Загварт ХҮРЭХГҮЙ (Revit-гүй) — урьдчилсан харагдац ба үүсгэлт хоёулаа
    /// үүнийг ашиглана, тиймээс урьдчилж харсан нь ЯГ үүсгэгдэнэ.
    ///
    /// Дүрэм:
    ///   • Ready/Warning → үүсгэнэ (эсвэл шинэчилнэ); RequiresReview/Unsupported/Failed → ҮҮСГЭХГҮЙ (таахгүй).
    ///   • Нэг логик дэлгээс (ижил түлхүүр) ХЭЗЭЭ Ч хоёр удаа үүсэхгүй.
    ///   • Хадгалсан тэмдэг ижил → харагдацад хүрэхгүй (Keep); өөр → Update; харагдацгүй → Create.
    ///   • Эх нь устсан харагдацыг УСТГАХГҮЙ — «өнчин» гэж мэдээлнэ.
    /// </summary>
    public static class WallElevationPlanner
    {
        private sealed class Candidate
        {
            public WePlannedElevation Item;
            public WeV3 A;
            public WeV3 B;
            public WeV3 Look;
            public double FaceLength;
            public double BottomZ;
            public double TopZ;
            public double FaceInFront;
            public double FaceToBack;
            /// <summary>Талын хамгийн зузаан ханын зузаан — нүхний spot level ханын ДУНД (ниш гүнийг оруулахгүй).</summary>
            public double WallWidth;
            public bool Geometric;
            public double Azimuth;
            public double Along;
            public string WallMark;
            public string WallType;
            public bool HasDirection;
            public WeWallInfo Wall;
            public WeRoomInfo Room;
            /// <summary>«Өрөөний дунд хүртэл» горимд тооцсон зүсэх хавтгайн зай (гадаргуунаас); NaN = тогтмол.</summary>
            public double NearOverride = double.NaN;
            /// <summary>Үсэг оноох — АНХНЫ геометрээр (тохируулсан шугам чирэхэд үсэг солигдохгүй).</summary>
            public double LetterAzimuth = double.NaN;
            public double LetterAlong;
            public double LetterLength;
            /// <summary>Муруй тал: хөвчөөр хүрээ гаргах өгөгдөл бэлэн (хэрэглэгч хүчлэвэл л <see cref="Geometric"/> болно).</summary>
            public bool ChordReady;
            /// <summary>«+ Хана нэмэх»-ийн нэмэлт тал (<see cref="WePlannedElevation.Manual"/>) — үсэг өрөөний бусад талын ДАРАА, шугам нь тохируулга.</summary>
            public bool Manual;
            public int ManualOrder;
            /// <summary>Нэмэлт талын анхааруулга (link хана г.м.) — мессежид залгана.</summary>
            public string ManualNote;
        }

        /// <summary>Нэг шулууны хоёр хэсгийг давж нэгтгэх хамгийн их цухуйлт/ниш (мм).  Гүнзгий бол тусдаа тал.</summary>
        public const double MaxJogMm = 1000;
        /// <summary>Нэг шулуун гэж үзэх зай (мм).</summary>
        public const double LineTolMm = 5;
        /// <summary>
        /// W10: муруй ханыг хүчилж үүсгэсэн харагдацын ШУДАРГА тайлбар (цонх, тайлан нэг бичвэр).  Нумын уртаар дэлгэсэн дүрслэлийг архитекторууд
        /// сонгох хүртэл хойшлуулсан — «дэлгэсэн» гэж ХЭЗЭЭ Ч бүү нэрлэ.
        /// </summary>
        public const string ChordViewNote = "Муруй хана: ХӨВЧӨӨР харсан хавтгай харагдац — нумын уртаар дэлгэсэн (unwrapped) зураг БИШ, хэмжээс хөвчийн дагуу.";

        public static WePlan Plan(WeRequest req, WePlanContext ctx)
        {
            if (req == null) throw new ArgumentNullException("req");
            if (ctx == null) ctx = new WePlanContext();
            WeSettings s = ctx.Settings ?? new WeSettings();
            IWeUnits u = ctx.Units ?? new WeFixedUnits();
            double pad = u.MmToInternal(s.PaddingMm);
            double near = u.MmToInternal(s.NearOffsetMm);
            double far = u.MmToInternal(s.FarDepthMm);

            var plan = new WePlan();
            plan.Notes.AddRange(req.SelectionNotes);
            var cands = new List<Candidate>();

            // ── 0. Зориулалт (W09): өрөө бүрт — цонхонд сонгосон › харагдац дээр хадгалсан › санал › өгөгдмөл ──
            Dictionary<string, RoomPreset> roomPresets = ResolvePresets(req, s);
            var presetSettings = new Dictionary<string, WeSettings>(StringComparer.Ordinal);
            Func<string, WeSettings> settingsFor = id =>
            {
                string k = WePresetId.IsKnown(id) ? id : WePresetId.Custom;
                WeSettings r;
                if (!presetSettings.TryGetValue(k, out r)) { r = s.ForPreset(k); presetSettings[k] = r; }
                return r;
            };
            string defaultPreset = WePresetId.IsKnown(s.DefaultPreset) ? s.DefaultPreset : WePresetId.Custom;

            // ── 1. Өрөө ───────────────────────────────────────────────
            IEnumerable<WeRoomInfo> rooms = req.Rooms
                .OrderBy(r => r.LevelElevation)
                .ThenBy(r => r.Number ?? string.Empty, StringComparer.Ordinal)
                .ThenBy(r => r.Id);
            foreach (WeRoomInfo room in rooms)
            {
                AddRoom(req, room, cands, plan, s, u);
                AddExtra(req, room, cands, plan, s);
                if (room.Loops != null && room.Loops.Count > 0)
                    plan.Outlines["room:" + room.UniqueId] = room.Loops.Select(l => l.Segments.Select(sg => sg.A.Flat()).ToList()).Where(l => l.Count >= 3).ToList();
            }

            // ── 2. Хана ───────────────────────────────────────────────
            foreach (WeWallInfo w in req.Walls.OrderBy(w => w.Id))
                AddWall(w, s.WallSide, cands);

            // ── 3. Давхардал (нэг түлхүүр = нэг дэлгээс) ─────────────
            var seen = new HashSet<string>(StringComparer.Ordinal);
            var unique = new List<Candidate>();
            int dup = 0;
            foreach (Candidate c in cands)
            {
                if (seen.Add(c.Item.Key)) unique.Add(c);
                else dup++;
            }
            if (dup > 0) plan.Notes.Add(dup.ToString(CultureInfo.InvariantCulture) + " давхар сонголтыг нэг болгов.");

            // ── 4. Хүрээ, хайрцаг ────────────────────────────────────
            double minNear = u.MmToInternal(100), maxDepth = u.MmToInternal(s.MaxDepthMm);
            // Хэрэглэгчийн тохируулга: энэ ажиллуулалтын (цонхноос) › харагдац дээр хадгалсан.
            var stored = new Dictionary<string, WeSideOverride>(StringComparer.Ordinal);
            foreach (WeExistingView e in req.Existing)
            {
                WeSideOverride so = WeSideOverride.Parse(e.Override);
                if (so != null && !so.Reset && !string.IsNullOrEmpty(e.Key) && !stored.ContainsKey(e.Key)) stored[e.Key] = so;
            }
            // W07: харагдац дээр хадгалсан босоо хүрээ (түлхүүр → эхний харагдац; давхардалтай түлхүүр «Skip» болдог).
            var storedViews = new Dictionary<string, WeExistingView>(StringComparer.Ordinal);
            foreach (WeExistingView e in req.Existing.OrderBy(x => x.ViewId))
                if (!string.IsNullOrEmpty(e.Key) && !storedViews.ContainsKey(e.Key)) storedViews[e.Key] = e;
            foreach (Candidate c in unique)
            {
                // Хүчээр үүсгэх (2026-10-14): «шалгах»/«дэмжигдэхгүй» мөрийг хэрэглэгч чагталсан — муруй талыг хөвчөөр.
                bool reviewable = c.Item.Status == WeStatus.RequiresReview || c.Item.Status == WeStatus.Unsupported;
                bool wantForce = reviewable && s.Forced != null && s.Forced.Contains(c.Item.Key);
                if (wantForce && !c.Geometric && c.ChordReady) c.Geometric = true;
                if (c.Geometric)
                {
                    // Анхны геометр — үсэг, сүүдэр, «буцаах».
                    SetDirection(c, c.A, c.B, c.Look);
                    c.LetterAzimuth = c.Azimuth;
                    c.LetterAlong = c.Along;
                    c.LetterLength = c.FaceLength;
                    c.Item.OrigA = c.A.Flat();
                    c.Item.OrigB = c.B.Flat();
                    c.Item.OrigLook = c.Look.Flat().Normalized();
                    WeSideOverride ov = null, mine;
                    if (s.Overrides != null && s.Overrides.TryGetValue(c.Item.Key, out mine) && mine != null)
                    {
                        // Нэмэлт талын шугам = түүний тохируулга — «анхных руу» буцаахад харагдац дээрх шугамаа ХАДГАЛНА (арилгавал тал алга болно).
                        if (mine.Reset && c.Manual) stored.TryGetValue(c.Item.Key, out ov);
                        else if (mine.Reset) c.Item.ClearStoredOverride = stored.ContainsKey(c.Item.Key);
                        else ov = mine;
                    }
                    else stored.TryGetValue(c.Item.Key, out ov);
                    if (ov != null && ov.IsValid) ApplyOverride(c, ov, s, u);
                    if (c.Manual)
                        c.Item.Message = "Нэмэлт тал (цонхонд нэмсэн) — план дээр чирж байрлал, уртыг тохируулна"
                                         + (string.IsNullOrEmpty(c.ManualNote) ? string.Empty : "; " + c.ManualNote);
                }
                double n = near;
                if (s.DepthMode == WeDepthMode.HalfRoom && !double.IsNaN(c.NearOverride))
                    // Зүсэх хавтгай = өрөөний дунд (цухуйлтаас ядаж 100 мм өмнө, дээд хязгаартай).
                    n = Math.Max(minNear, Math.Min(maxDepth, Math.Max(c.NearOverride, c.FaceInFront + minNear)) - c.FaceInFront);
                BuildGeometry(c, pad, n, far, ctx.ViewSetupToken);
                bool framed = c.Item.Frame != null && c.Item.Box != null;
                c.Item.CanForce = (c.Item.Status == WeStatus.RequiresReview || c.Item.Status == WeStatus.Unsupported) && (framed || c.ChordReady);
                if (wantForce && c.Item.CanForce && framed)
                {
                    c.Item.Forced = true;
                    c.Item.ForcedReason = c.Item.Message;
                    c.Item.Status = WeStatus.Warning;
                    c.Item.Message = c.ChordReady
                        // W10: муруй ханын хүчилсэн дэлгээс нь ХӨВЧӨӨР харсан ХАВТГАЙ харагдац — нумын уртаар дэлгэсэн (unwrapped) зураг БИШ.  Архитекторууд
                        // муруй ханын дүрслэлийг сонгох хүртэл «дэмжигдэхгүй» хэвээр; энд түр хэрэглэгчийн сонголтоор.
                        ? "Таны сонголтоор үүсгэнэ — " + ChordViewNote + "  Үр дүнг шалгана уу"
                        : "Таны сонголтоор үүсгэнэ (автоматаар үүсэхгүй байсан: " + (string.IsNullOrEmpty(c.Item.ForcedReason) ? "шалгах" : c.Item.ForcedReason) + ") — үр дүнг шалгана уу";
                }
                ApplyDeclaredCrop(c, s, storedViews, req.Sources, u, ctx.ViewSetupToken);
                AssignPreset(c.Item, roomPresets, defaultPreset);
                Annotate(c, req.Sources, settingsFor(c.Item.PresetId), u, ctx.ViewSetupToken);
            }

            // ── 5. Талын үсэг ────────────────────────────────────────
            AssignLetters(unique);
            // Бүлэг (өрөө) бүрийн дотор A, B, C … дарааллаар — урьдчилсан дүн, тайлан, хуудсанд ижил.  Бүлгийн дараалал хэвээр.
            var groupOrder = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (Candidate c in unique) if (!groupOrder.ContainsKey(c.Item.GroupKey)) groupOrder[c.Item.GroupKey] = groupOrder.Count;
            unique = unique.OrderBy(c => groupOrder[c.Item.GroupKey])
                           // Хана горим: нэг хананы гадна/дотор тал зэрэгцэнэ (A, B — дараагийн хана).
                           .ThenBy(c => c.Item.Kind == WeSourceKind.Wall ? c.Item.WallId : 0)
                           .ThenBy(c => c.Item.SideLetter == "?" ? 1 : 0)
                           .ThenBy(c => (c.Item.SideLetter ?? string.Empty).Length)
                           .ThenBy(c => c.Item.SideLetter ?? string.Empty, StringComparer.Ordinal)
                           .ToList();

            // ── 6. Нэр + байгаа харагдацтай тулгалт ──────────────────
            Dictionary<string, List<WeExistingView>> byKey = new Dictionary<string, List<WeExistingView>>(StringComparer.Ordinal);
            foreach (WeExistingView e in req.Existing)
            {
                if (string.IsNullOrEmpty(e.Key)) continue;
                List<WeExistingView> l;
                if (!byKey.TryGetValue(e.Key, out l)) { l = new List<WeExistingView>(); byKey[e.Key] = l; }
                l.Add(e);
            }
            // Бүлэг доторх дугаар ({WallIndex}) ба үсгийн муж ({SideRange}) — нэр, тэмдэгт.
            var ranges = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (IGrouping<string, Candidate> g in unique.GroupBy(c => c.Item.GroupKey))
            {
                int idx = 0;
                foreach (Candidate c in g) if (c.Item.SideLetter != "?") c.Item.SideIndex = ++idx;
            }
            // W05 (2026-10-16): {Side}-ийн утга — үсэг (өгөгдмөл, өрөө тус бүр = компасын үсэг ЯГ) эсвэл тоо, өрөө тус бүр эсвэл багц даяар тасралтгүй.
            WeNumbering.AssignTokens(unique.Select(c => c.Item).ToList(), s);
            foreach (IGrouping<string, Candidate> g in unique.GroupBy(c => c.Item.GroupKey))
                ranges[g.Key] = WeNaming.SideRange(g.Where(c => c.Item.Frame != null && c.Item.Status <= WeStatus.Warning).Select(c => c.Item.SideToken));
            var taken = new HashSet<string>(req.ExistingViewNames ?? new HashSet<string>(), StringComparer.OrdinalIgnoreCase);
            foreach (Candidate c in unique)
            {
                string range;
                ranges.TryGetValue(c.Item.GroupKey, out range);
                c.Item.Label = c.Item.Frame != null ? WeNaming.Expand(s.LabelPattern, TokenValues(c, range)) : string.Empty;
                c.Item.Title = c.Item.Frame != null && !string.IsNullOrWhiteSpace(s.TitlePattern) ? WeNaming.Expand(s.TitlePattern, TokenValues(c, range)) : string.Empty;
                ResolveAction(c, byKey, s, taken, range);
                plan.Items.Add(c.Item);
            }

            // ── 7. Өнчин харагдац ────────────────────────────────────
            var plannedKeys = new HashSet<string>(unique.Select(c => c.Item.Key), StringComparer.Ordinal);
            var selectedRooms = new HashSet<string>(req.Rooms.Select(r => r.UniqueId ?? string.Empty), StringComparer.Ordinal);
            // Нэгтгэсэн талын ЗАНГУУ БИШ хана (өрөө тус бүр) — тэдний хуучин дэлгээсийг «нэгтгэгдсэн» гэж тайлбарлана.
            var mergedWalls = new HashSet<string>(unique.Where(c => c.Item.Kind == WeSourceKind.Room)
                .SelectMany(c => c.Item.WallUids.Skip(1).Select(w => c.Item.RoomUid + "|" + w)), StringComparer.Ordinal);
            foreach (WeExistingView e in req.Existing.OrderBy(e => e.ViewId))
            {
                string reason = null;
                if (!e.SourceWallExists) reason = "Эх хана устсан";
                else if (!string.IsNullOrEmpty(e.RoomUid) && !e.SourceRoomExists) reason = "Эх өрөө устсан";
                else if (!string.IsNullOrEmpty(e.RoomUid) && selectedRooms.Contains(e.RoomUid) && !plannedKeys.Contains(e.Key))
                    reason = WeExtraSides.IsExtraKey(e.Key) ? "Нэмэлт талын байрлал харагдац дээр уншигдсангүй"
                        : mergedWalls.Contains(e.RoomUid + "|" + (e.WallUid ?? string.Empty))
                        ? "Энэ хана нэг шулуун дээрх хөрш хананы дэлгээстэй нэгдсэн («Нэг шулуун дээрх хана → нэг дэлгээс»)"
                        : "Энэ хана өрөөний хил байхаа больсон";
                if (reason != null)
                    plan.Orphans.Add(new WeOrphan { ViewId = e.ViewId, Name = e.Name, Reason = reason + " — харагдацыг устгаагүй, гараар шалгана уу." });
            }

            // ── 7b. Elevation: ШИНЭ дэлгээсийн маркер (тэгш өнцөгт өрөөнд нэг маркер 4 сумтай) ──
            if (s.ViewKind == WeViewKind.Elevation)
            {
                var roomMap = req.Rooms.Where(r => !string.IsNullOrEmpty(r.UniqueId)).GroupBy(r => r.UniqueId)
                                       .ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);
                WeMarkerPlanner.Assign(plan.Items, roomMap, u,
                    room => u.MmToInternal(WeKeyPlanner.MarkerPaperMm * WeKeyPlanner.SeparationScale(room, s, u)));
                int legacy = plan.Items.Count(i => i.ExistingIsSection && (i.Action == WeAction.Update || i.Action == WeAction.Keep));
                if (legacy > 0)
                    plan.Notes.Add(legacy.ToString(CultureInfo.InvariantCulture) + " дэлгээс өмнөх хувилбарт зүсэлт (Section)-ээр үүссэн — зүсэлтээрээ шинэчлэгдэнэ.  "
                                   + "Elevation болгох бол тэдгээр харагдацыг устгаад дахин ажиллуулна уу (хуудсан дээрх байрлал, гараар нэмсэн тэмдэглэгээ алдагдана).");
            }
            if (s.FromOlderFile && req.Existing.Count > 0)
                plan.Notes.Add("Тохиргоо өмнөх хувилбарынх — шинэ өгөгдмөл асаалттай: Elevation маркер, нэг шулуун дээрх хана → нэг дэлгээс, харах гүн өрөөний дунд хүртэл, "
                               + "хэмжээс ангиллаар.  Хуучин байдал руу «Нарийвчилсан»-аас.");

            // ── 8. Хуудасны нэмэлт блок: түлхүүр план, 3D ───────────
            if (s.Output == WeOutputMode.ViewsAndSheets)
            {
                var roomsByUid = req.Rooms.Where(r => !string.IsNullOrEmpty(r.UniqueId)).GroupBy(r => r.UniqueId)
                                          .ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);
                foreach (IGrouping<string, WePlannedElevation> g in plan.Items.Where(i => i.Kind == WeSourceKind.Room).GroupBy(i => i.GroupKey))
                {
                    WeRoomInfo room;
                    if (!roomsByUid.TryGetValue(g.First().RoomUid ?? string.Empty, out room)) continue;
                    // W09: түлхүүр план, 3D өрөөний ЗОРИУЛАЛТААР (архитектурын өрөөнд 3D-гүй байж болно).
                    string groupPreset = g.First().PresetId;
                    WeSettings sg = settingsFor(groupPreset);
                    if (!sg.SheetExtras) continue;
                    List<WePlannedElevation> items = g.Where(i => i.Frame != null && i.Status <= WeStatus.Warning).ToList();
                    if (items.Count == 0) continue;
                    string range;
                    ranges.TryGetValue(g.Key, out range);
                    var gi = new WeGroupInfo
                    {
                        GroupKey = g.Key, GroupLabel = g.First().GroupLabel, RoomUid = room.UniqueId, RoomId = room.Id,
                        RoomNumber = room.Number, RoomName = room.Name, LevelName = room.LevelName, LevelId = room.LevelId,
                        SideRange = range,
                        Label = WeNaming.Expand(s.LabelPattern, WeNaming.Values(room.LevelName, Trimmed(room.Number), room.Name, range, string.Empty, 0, string.Empty, range)),
                    };
                    double width = items.SelectMany(i => i.WallUids)
                                        .Select(w => { WeWallInfo wi; return req.WallLookup.TryGetValue(w, out wi) ? Math.Max(0, wi.Width) : 0; })
                                        .DefaultIfEmpty(0).Max();
                    gi.PresetId = groupPreset;
                    if (sg.KeyPlan)
                    {
                        gi.KeyPlan = WeKeyPlanner.Plan(room, items, sg, u);
                        gi.KeyPlan.Avoid = items.Where(i => i.Marker != null).Select(i => i.Marker.Position).ToList();
                    }
                    if (sg.Axon) gi.Axon = WeAxonPlanner.Plan(room, WeAxonPlanner.CeilingZ(room, req.Sources, u), width, sg, u);
                    plan.Groups.Add(gi);
                }
            }
            return plan;
        }

        // ══════════════════════════════════════════════════════════════

        /// <summary>Өрөөний зориулалтын шийдвэр (W09).</summary>
        private sealed class RoomPreset
        {
            public string Id;
            public WePresetSource Source;
            public string Reason;
            public string SuggestedId;
            public string SuggestedReason;
        }

        /// <summary>
        /// Өрөө бүрийн зориулалт: цонхонд сонгосон › өмнө үүсгэсэн дэлгээсийн харагдац дээр хадгалсан › санал (<see cref="WePresetSuggester"/> —
        /// зөвхөн өгөгдмөл нь «Тусгай» БИШ үед автоматаар) › өгөгдмөл.  «Тусгай» өгөгдмөл үед санал зөвхөн харагдана (хэрэглэгчийн өөрийн тохиргоог
        /// чимээгүй дарахгүй).
        /// </summary>
        private static Dictionary<string, RoomPreset> ResolvePresets(WeRequest req, WeSettings s)
        {
            var r = new Dictionary<string, RoomPreset>(StringComparer.Ordinal);
            string def = WePresetId.IsKnown(s.DefaultPreset) ? s.DefaultPreset : WePresetId.Custom;
            foreach (WeRoomInfo room in req.Rooms)
            {
                if (room == null || string.IsNullOrEmpty(room.UniqueId) || r.ContainsKey(room.UniqueId)) continue;
                var rp = new RoomPreset();
                string why;
                rp.SuggestedId = WePresetSuggester.Suggest(room.Name, room.Number, ContentsOf(req, room), out why);
                rp.SuggestedReason = why;
                string chosen = s.ChosenPresetFor(room.UniqueId), stored = StoredPreset(req, room.UniqueId);
                if (chosen != null) { rp.Id = chosen; rp.Source = WePresetSource.Chosen; }
                else if (stored != null) { rp.Id = stored; rp.Source = WePresetSource.Stored; rp.Reason = "өмнө үүсгэсэн дэлгээсээс"; }
                else if (rp.SuggestedId != null && def != WePresetId.Custom) { rp.Id = rp.SuggestedId; rp.Source = WePresetSource.Suggested; rp.Reason = why; }
                else { rp.Id = def; rp.Source = WePresetSource.Default; }
                r[room.UniqueId] = rp;
            }
            return r;
        }

        private static void AssignPreset(WePlannedElevation item, Dictionary<string, RoomPreset> roomPresets, string defaultPreset)
        {
            RoomPreset rp;
            if (item.Kind == WeSourceKind.Room && !string.IsNullOrEmpty(item.RoomUid) && roomPresets.TryGetValue(item.RoomUid, out rp))
            {
                item.PresetId = rp.Id;
                item.PresetSource = rp.Source;
                item.PresetReason = rp.Reason;
                item.SuggestedPreset = rp.SuggestedId;
                item.SuggestedReason = rp.SuggestedReason;
                return;
            }
            item.PresetId = defaultPreset;
            item.PresetSource = WePresetSource.Default;
        }

        /// <summary>Өрөөний харагдацууд дээр хадгалсан зориулалт (олонх; тэнцвэл эхний харагдацынх).  null = хадгалаагүй.</summary>
        private static string StoredPreset(WeRequest req, string roomUid)
        {
            return req.Existing.Where(e => string.Equals(e.RoomUid, roomUid, StringComparison.Ordinal) && WePresetId.IsKnown(e.Preset))
                      .OrderBy(e => e.ViewId).GroupBy(e => e.Preset).OrderByDescending(g => g.Count()).Select(g => g.Key).FirstOrDefault();
        }

        /// <summary>Өрөөнд байгаа сантехник, тавилга, тогтмол тавилгын тоо (төв нь өрөөний план дотор, өндрөөр өрөөнд).</summary>
        internal static WeRoomContents ContentsOf(WeRequest req, WeRoomInfo room)
        {
            var c = new WeRoomContents();
            if (req == null || req.Sources == null || room == null || room.Loops.Count == 0) return c;
            foreach (WeTaggable t in req.Sources.Taggables)
            {
                string k = t.CategoryKey ?? string.Empty;
                if (k != "plumbing" && k != "furniture" && k != "casework") continue;
                var mid = new WeV3((t.Min.X + t.Max.X) / 2, (t.Min.Y + t.Max.Y) / 2, 0);
                if (t.Max.Z < room.BottomZ - 1e-6 || t.Min.Z > room.TopZ + 1e-6 || !WeKeyPlanner.InsideRoom(room, mid)) continue;
                if (k == "plumbing") c.Plumbing++;
                else if (k == "furniture") c.Furniture++;
                else c.Casework++;
            }
            return c;
        }

        private static void AddRoom(WeRequest req, WeRoomInfo room, List<Candidate> cands, WePlan plan, WeSettings s, IWeUnits u)
        {
            string group = "room:" + room.UniqueId;
            string label = RoomLabel(room);

            if (!room.IsPlaced || !room.IsEnclosed)
            {
                cands.Add(new Candidate
                {
                    Item = NewItem(WeIdentity.Key(room.UniqueId, string.Empty, "room"), WeSourceKind.Room, group, label, room, null,
                        WeStatus.Unsupported, !room.IsPlaced ? "Өрөө байршаагүй (Not placed)" : "Өрөө хүрээлэгдээгүй (талбай 0)"),
                });
                return;
            }

            var skipped = new List<KeyValuePair<WeBoundarySegment, string>>();
            List<WeRoomSide> sides = RoomBoundaryAnalyzer.Sides(room, skipped, s.MergeCollinear, u.MmToInternal(MaxJogMm), u.MmToInternal(LineTolMm));
            if (skipped.Count > 0)
            {
                IEnumerable<string> reasons = skipped.GroupBy(k => k.Value).Select(g => g.Count().ToString(CultureInfo.InvariantCulture) + " " + g.Key);
                plan.Notes.Add(label + ": хилийн " + string.Join(", ", reasons) + " — дэлгээсгүй.");
            }
            if (sides.Count == 0)
            {
                cands.Add(new Candidate
                {
                    Item = NewItem(WeIdentity.Key(room.UniqueId, string.Empty, "room"), WeSourceKind.Room, group, label, room, null,
                        WeStatus.Unsupported, "Өрөөний хилд хана олдсонгүй"),
                });
                return;
            }

            // Өмнө үүссэн дэлгээсийн түлхүүр: нэгтгэсэн талын зангуу (хамгийн урт) хана солигдсон ч (хоёр ханын урт тэнцүү орчим,
            // нэг нь богиноссон) ХУУЧИН дэлгээс дээр үргэлжилнэ — эс бөгөөс давхар дэлгээс үүсч, хуучин нь «нэгдсэн» өнчин болдог (аудит).
            var existingKeys = new HashSet<string>(req.Existing.Where(e => !string.IsNullOrEmpty(e.Key)).Select(e => e.Key), StringComparer.Ordinal);
            var usedKeys = new HashSet<string>(StringComparer.Ordinal);
            foreach (WeRoomSide face in sides)
            {
                WeWallInfo wall;
                req.WallLookup.TryGetValue(face.AnchorWallUid ?? string.Empty, out wall);
                if (wall == null && face.IsCurved)
                {
                    cands.Add(new Candidate
                    {
                        Item = NewItem(WeIdentity.Key(room.UniqueId, face.AnchorWallUid, "?"), WeSourceKind.Room, group, label, room, null,
                            WeStatus.Failed, "Хилийн ханыг уншиж чадсангүй"),
                    });
                    continue;
                }
                if (face.IsCurved)
                {
                    var curved = new Candidate
                    {
                        Item = NewItem(WeIdentity.Key(room.UniqueId, wall.UniqueId, "curve"), WeSourceKind.Room, group, label, room, wall,
                            WeStatus.Unsupported, "Муруй хана — дэмжигдэхгүй (зураг буруу гарахаас сэргийлж үүсгэсэнгүй)"),
                    };
                    // Үүсгэхгүй ч компасын үсэг тогтвортой байх ёстой (эс бөгөөс бусад ханын үсэг шилжинэ) — хөвчөөр.
                    if (!face.ChordNormal.IsZero)
                    {
                        SetDirection(curved, face.A, face.B, -face.ChordNormal);
                        // Хэрэглэгч хүчлэвэл (2026-10-14) — ХӨВЧӨӨР: муруйн нум хөвчөөс ≤ хагас урт (хагас тойрог хүртэл) аль ч тийш —
                        // гүн хоёр тийшээ хагас урт + ханын зузаан хамарна.
                        double chord = (face.B - face.A).Flat().Length;
                        if (chord > WeTol.MinWallLength && room.TopZ - room.BottomZ > WeTol.Length)
                        {
                            curved.A = face.A;
                            curved.B = face.B;
                            curved.Look = -face.ChordNormal;
                            curved.FaceLength = chord;
                            curved.BottomZ = room.BottomZ;
                            curved.TopZ = room.TopZ;
                            curved.WallWidth = Math.Max(0, wall.Width);
                            curved.FaceInFront = chord / 2;
                            curved.FaceToBack = chord / 2 + curved.WallWidth;
                            curved.WallMark = wall.Mark;
                            curved.WallType = wall.TypeName;
                            curved.Wall = wall;
                            curved.Room = room;
                            curved.ChordReady = true;
                            curved.Item.ChordView = true;
                            curved.Item.Side = SideOf(wall, curved.Look);
                            curved.Item.WallUids = new List<string> { wall.UniqueId };
                            curved.Item.WallIds = new List<long> { wall.Id };
                        }
                    }
                    cands.Add(curved);
                    continue;
                }

                WeV3 look = -face.InteriorNormal;
                WeV3 faceT = WallFrameCalculator.Tangent(face.A, face.B);
                string suffix = face.Part > 1 ? "|part:" + face.Part.ToString(CultureInfo.InvariantCulture) : string.Empty;
                WeStatus st = WeStatus.Ready;
                string msg = null;

                // Талын хана (уншигдсан нь; дараалал = урт → богино).
                var members = new List<WeWallInfo>();
                var memberParts = new Dictionary<string, WeSidePart>(StringComparer.Ordinal);
                int unread = 0;
                foreach (WeSidePart part in face.Walls)
                {
                    WeWallInfo w;
                    if (req.WallLookup.TryGetValue(part.WallUniqueId ?? string.Empty, out w)) { members.Add(w); memberParts[w.UniqueId] = part; }
                    else unread++;
                }
                if (members.Count == 0)
                {
                    cands.Add(new Candidate
                    {
                        Item = NewItem(WeIdentity.Key(room.UniqueId, face.AnchorWallUid, "?"), WeSourceKind.Room, group, label, room, null,
                            WeStatus.Failed, "Хилийн ханыг уншиж чадсангүй"),
                    });
                    continue;
                }

                // Зангуу: (1) өмнө нь дэлгээс үүссэн хана, (2) асуудалгүй хамгийн урт, (3) хамгийн урт.  Түлхүүр өрөөнд давхардахгүй.
                Func<WeWallInfo, string> keyOf = w => WeIdentity.Key(room.UniqueId, w.UniqueId, SideOf(w, look)) + suffix;
                wall = members.FirstOrDefault(w => existingKeys.Contains(keyOf(w)) && !usedKeys.Contains(keyOf(w)))
                       ?? members.FirstOrDefault(w => Healthy(w, faceT) && !usedKeys.Contains(keyOf(w)))
                       ?? members.FirstOrDefault(w => !usedKeys.Contains(keyOf(w)))
                       ?? members[0];
                string side = SideOf(wall, look);
                if (side == "?") Worse(ref st, ref msg, WeStatus.RequiresReview, "Ханын гадна/дотор тал тодорхойгүй");
                members.Remove(wall);
                members.Insert(0, wall);

                // Зангуу хана — дэлгээсийн суурь: асуудал нь бүх талыг хаана.  Бусад хана — зөвхөн анхааруулга (аудит: 0.5 м налуу хана
                // 5.5 м-ийн хананы дэлгээсийг бүхэлд нь хааж байсан; хуучин горимд тэр урт хананы дэлгээс үүсдэг байв).
                double maxWidth = 0;
                foreach (WeWallInfo w in members)
                {
                    bool anchor = ReferenceEquals(w, wall);
                    WeStatus ws; string wm;
                    WallIssue(w, out ws, out wm);
                    bool parallel = Parallel(w, faceT);
                    WeSidePart part;
                    bool disagree = memberParts.TryGetValue(w.UniqueId, out part) && part.ProbeDisagrees;
                    if (anchor)
                    {
                        Worse(ref st, ref msg, ws, wm);
                        if (!parallel) Worse(ref st, ref msg, WeStatus.RequiresReview, "Өрөөний хил ханатай параллель биш");
                        if (disagree) Worse(ref st, ref msg, WeStatus.RequiresReview, "Өрөөний аль тал нь болохыг Revit-ийн шалгалт батлаагүй");
                    }
                    else
                    {
                        string who = "«" + WallLabelOf(w) + "»";
                        if (ws > WeStatus.Ready) Worse(ref st, ref msg, WeStatus.Warning, who + ": " + wm + " — тэр хананд хэмжээс/шошго алдаж болно");
                        if (!parallel) Worse(ref st, ref msg, WeStatus.Warning, who + " өрөөний хилтэй параллель биш");
                        if (disagree) Worse(ref st, ref msg, WeStatus.Warning, who + ": өрөөний тал Revit-ийн шалгалтаар батлагдаагүй");
                    }
                    maxWidth = Math.Max(maxWidth, Math.Max(0, w.Width));
                }
                if (unread > 0)
                    Worse(ref st, ref msg, WeStatus.Warning, unread.ToString(CultureInfo.InvariantCulture) + " хилийн ханыг уншиж чадсангүй");
                if (face.HasLinked)
                    Worse(ref st, ref msg, WeStatus.Warning, "Талд холбоос (link) загварын хана орсон — тэдгээрт хэмжээс тавигдахгүй байж болно");
                if (room.TopZ - room.BottomZ <= WeTol.Length)
                    Worse(ref st, ref msg, WeStatus.Unsupported, "Өрөөний өндөр 0");

                string key = keyOf(wall);
                usedKeys.Add(key);
                var item = NewItem(key, WeSourceKind.Room, group, label, room, wall, st, msg);
                item.Side = side;
                item.WallUids = members.Select(w => w.UniqueId).ToList();
                item.WallIds = members.Select(w => w.Id).ToList();
                item.HasNonWallBoundary = face.HasNonWall;
                if (members.Count > 1) item.WallLabel = WallLabelOf(wall) + " +" + (members.Count - 1).ToString(CultureInfo.InvariantCulture) + " хана";
                var c = new Candidate
                {
                    Item = item,
                    A = face.A,
                    B = face.B,
                    Look = look,
                    FaceLength = face.Length,
                    BottomZ = room.BottomZ,
                    TopZ = room.TopZ,
                    // Цухуйлт (пилястр) өрөө рүү — зүсэх хавтгай түүнээс өмнө; ниш — гүн түүнийг хамарна.
                    FaceInFront = Math.Max(0, face.Protrusion),
                    FaceToBack = Math.Max(maxWidth, face.Recess > 0 ? face.Recess + maxWidth : 0),
                    WallWidth = maxWidth,
                    Geometric = true,
                    WallMark = wall.Mark,
                    WallType = wall.TypeName,
                    Wall = wall,
                    Room = room,
                };
                if (s.DepthMode == WeDepthMode.HalfRoom)
                {
                    double d = RoomBoundaryAnalyzer.DepthInFront(room, face.A, face.B, face.InteriorNormal,
                                                                 u.MmToInternal(LineTolMm) + Math.Max(0, face.Protrusion) + WeTol.Length);
                    if (!double.IsNaN(d)) c.NearOverride = d / 2;
                }
                cands.Add(c);
            }
        }

        private static string RoomLabel(WeRoomInfo room)
        {
            return "Өрөө " + Trimmed(room.Number) + (string.IsNullOrWhiteSpace(room.Name) ? string.Empty : " — " + room.Name.Trim())
                + (string.IsNullOrWhiteSpace(room.LevelName) ? string.Empty : " (" + room.LevelName + ")");
        }

        /// <summary>
        /// «+ Хана нэмэх» (2026-10-14, интерьерийн баг): өрөөний НЭМЭЛТ тал — цонхонд нэмж план дээр чирсэн шугам (<see cref="WeExtraSides"/>).
        /// Нэмэлт талууд: цонхонд нэмсэн (<see cref="WeSettings.ExtraSides"/>) + өмнө үүссэн (харагдац дээр «extra» түлхүүр, шугам нь хадгалсан
        /// тохируулга).  Шугам = тохируулга (цонхных › харагдац дээрх); байхгүй бол тайлбар.  Ард нь байгаа хилийн хана (нүх, шошго) шугамаас.
        /// Геометр (гүн, «өрөөний дунд хүртэл») нь ердийн тохируулгын замаар (<see cref="ApplyOverride"/>).
        /// </summary>
        private static void AddExtra(WeRequest req, WeRoomInfo room, List<Candidate> cands, WePlan plan, WeSettings s)
        {
            if (room == null || !room.IsPlaced || !room.IsEnclosed || string.IsNullOrEmpty(room.UniqueId)) return;
            var ids = new List<string>(s.ExtraSidesOf(room.UniqueId));
            var stored = new Dictionary<string, WeSideOverride>(StringComparer.Ordinal);
            foreach (WeExistingView e in req.Existing.OrderBy(x => x.ViewId))
            {
                if (!WeExtraSides.IsExtraKey(e.Key) || !string.Equals(e.RoomUid, room.UniqueId, StringComparison.Ordinal)) continue;
                string id = WeExtraSides.IdOf(e.Key);
                if (string.IsNullOrEmpty(id)) continue;
                if (!ids.Contains(id)) ids.Add(id);
                WeSideOverride so = WeSideOverride.Parse(e.Override);
                if (so != null && !so.Reset && so.IsValid && !stored.ContainsKey(e.Key)) stored[e.Key] = so;
            }
            if (ids.Count == 0) return;
            // Үсэг нэмсэн дарааллаар (дугаараар) — дахин ажиллуулахад шинээр нэмсэн нь өмнө үүссэний (E) үсгийг хэзээ ч булаахгүй.
            ids = ids.Distinct(StringComparer.Ordinal)
                     .OrderBy(x => { int n; return int.TryParse(x, NumberStyles.None, CultureInfo.InvariantCulture, out n) ? n : int.MaxValue; })
                     .ThenBy(x => x, StringComparer.Ordinal).ToList();
            string group = "room:" + room.UniqueId;
            string label = RoomLabel(room);
            int order = 0;
            foreach (string id in ids)
            {
                string key = WeExtraSides.Key(room.UniqueId, id);
                WeSideOverride line = null, mine;
                if (s.Overrides != null && s.Overrides.TryGetValue(key, out mine) && mine != null && !mine.Reset && mine.IsValid) line = mine;
                if (line == null) stored.TryGetValue(key, out line);
                if (line == null)
                {
                    plan.Notes.Add(label + ": нэмэлт талын байрлал алга — «+ Хана нэмэх»-ээр дахин нэмнэ үү.");
                    continue;
                }
                List<WeWallInfo> walls = WeExtraSides.WallsBehind(room, line.A, line.B, line.Look)
                    .Select(w => { WeWallInfo wi; return req.WallLookup.TryGetValue(w, out wi) ? wi : null; })
                    .Where(w => w != null).ToList();
                WeWallInfo anchor = walls.FirstOrDefault();
                var item = NewItem(key, WeSourceKind.Room, group, label, room, anchor, WeStatus.Ready, null);
                item.Manual = true;
                item.Side = anchor != null ? SideOf(anchor, line.Look) : WeSide.Interior;
                // Эх элемент (ES, «эх нь байна уу») — ард нь хана олдохгүй бол өрөө өөрөө.
                if (anchor == null) item.WallUid = room.UniqueId;
                item.WallUids = walls.Select(w => w.UniqueId).ToList();
                item.WallIds = walls.Select(w => w.Id).ToList();
                double width = walls.Select(w => Math.Max(0, w.Width)).DefaultIfEmpty(0).Max();
                var c = new Candidate
                {
                    Item = item,
                    Manual = true,
                    ManualOrder = order++,
                    A = new WeV3(line.A.X, line.A.Y, room.BottomZ),
                    B = new WeV3(line.B.X, line.B.Y, room.BottomZ),
                    Look = line.Look.Flat().Normalized(),
                    FaceLength = line.Length,
                    BottomZ = room.BottomZ,
                    TopZ = room.TopZ,
                    FaceInFront = 0,
                    FaceToBack = Math.Max(width, 100 / 304.8),
                    WallWidth = width,
                    Geometric = true,
                    WallMark = anchor != null ? anchor.Mark : null,
                    WallType = anchor != null ? anchor.TypeName : null,
                    Wall = anchor,
                    Room = room,
                };
                if (walls.Any(w => w.IsLinked))
                {
                    // Өрөөний талын адил (link-ийн ханад хэмжээс тавигдахгүй байж болно) — анхааруулга.
                    c.ManualNote = "ард нь холбоос (link) загварын хана — хэмжээс тавигдахгүй байж болно";
                    if (item.Status < WeStatus.Warning) item.Status = WeStatus.Warning;
                }
                if (room.TopZ - room.BottomZ <= WeTol.Length) Worse(ref item.Status, ref item.Message, WeStatus.Unsupported, "Өрөөний өндөр 0");
                cands.Add(c);
            }
        }

        private static void AddWall(WeWallInfo w, WeWallSidePick pick, List<Candidate> cands)
        {
            string level = string.IsNullOrWhiteSpace(w.LevelName) ? "—" : w.LevelName;
            string group = "walls:" + level;
            string label = "Хана — " + level;

            WeStatus st; string msg;
            WallIssue(w, out st, out msg);

            WeV3 t = WallFrameCalculator.Tangent(w.Start, w.End);
            WeV3 ext;
            bool hasExt = WallFrameCalculator.TryExteriorNormal(t, w.OrientationHint, out ext);
            if (st <= WeStatus.Warning && !hasExt)
                Worse(ref st, ref msg, WeStatus.Failed, "Ханын гадна тал тодорхойгүй (Orientation шугамд перпендикуляр биш)");

            var sides = new List<string>();
            if (pick == WeWallSidePick.Exterior || pick == WeWallSidePick.Both) sides.Add(WeSide.Exterior);
            if (pick == WeWallSidePick.Interior || pick == WeWallSidePick.Both) sides.Add(WeSide.Interior);

            foreach (string side in sides)
            {
                var item = NewItem(WeIdentity.Key(string.Empty, w.UniqueId, side), WeSourceKind.Wall, group, label, null, w, st, msg);
                item.Side = side;
                item.WallUids.Add(w.UniqueId);
                item.WallIds.Add(w.Id);
                var c = new Candidate { Item = item, WallMark = w.Mark, WallType = w.TypeName, Wall = w };
                if (hasExt && !t.IsZero)
                {
                    double width = Math.Max(0, w.Width);
                    c.A = w.Start;
                    c.B = w.End;
                    c.Look = side == WeSide.Exterior ? -ext : ext;
                    // Хана булангаар нийлэхэд гадаргуу шугамаас хагас зузаанаар уртасна.
                    c.FaceLength = (w.End - w.Start).Flat().Length + width;
                    c.BottomZ = w.BottomZ;
                    c.TopZ = w.TopZ;
                    // Location line нь тэнхлэг бол гадаргуу яг W/2; бусад (Finish/Core face) үед аль ч тал W хүртэл байж болно.
                    c.FaceInFront = w.LocationIsCenterline ? width / 2 : width;
                    c.FaceToBack = w.LocationIsCenterline ? width / 2 : width;
                    c.Geometric = true;
                }
                cands.Add(c);
            }
        }

        /// <summary>
        /// Хэрэглэгчийн тохируулсан ЗҮСЭХ ШУГАМ (2026-10-14): гадаргуу = шугам, харах чиглэл = тохиргоо; зүсэх хавтгай шугамаас өмнө
        /// (тогтмол эсвэл «өрөөний дунд хүртэл» — шугамын өмнөх хил хүртэлх зайн хагас), ар тал = харах чиглэлийн өрөөний хил (хана) + ханын
        /// зузаан.  Хил олдохгүй бол (хана горим) анхны гүн хэвээр.
        /// </summary>
        private static void ApplyOverride(Candidate c, WeSideOverride ov, WeSettings s, IWeUnits u)
        {
            double z = c.A.Z;
            c.A = new WeV3(ov.A.X, ov.A.Y, z);
            c.B = new WeV3(ov.B.X, ov.B.Y, z);
            c.Look = ov.Look.Flat().Normalized();
            c.FaceLength = (c.B - c.A).Flat().Length;
            c.FaceInFront = 0;
            c.NearOverride = double.NaN;
            if (c.Room != null)
            {
                double tol = u.MmToInternal(LineTolMm);
                double back = RoomBoundaryAnalyzer.DepthInFront(c.Room, c.A, c.B, c.Look, tol);
                if (!double.IsNaN(back)) c.FaceToBack = back + Math.Max(c.WallWidth, u.MmToInternal(100));
                if (s.DepthMode == WeDepthMode.HalfRoom)
                {
                    double front = RoomBoundaryAnalyzer.DepthInFront(c.Room, c.A, c.B, -c.Look, tol);
                    if (!double.IsNaN(front)) c.NearOverride = front / 2;
                }
            }
            c.Item.Override = ov.Clone();
            c.Item.Message = string.IsNullOrEmpty(c.Item.Message) ? "Таны тохируулсан байрлал" : "Таны тохируулсан байрлал; " + c.Item.Message;
        }

        /// <summary>Чиглэл, план дахь үзүүр, компас — хүрээ үүсгэх эсэхээс үл хамааран.</summary>
        private static void SetDirection(Candidate c, WeV3 a, WeV3 b, WeV3 look)
        {
            WeV3 l = look.Flat().Normalized();
            if (l.IsZero) return;
            c.Item.PlanLook = l;
            c.Item.PlanA = a;
            c.Item.PlanB = b;
            c.Azimuth = RoomBoundaryAnalyzer.Azimuth(l);
            c.Along = ((a + b) * 0.5).Dot(l.Cross(WeV3.UnitZ));
            c.HasDirection = true;
        }

        /// <summary>150 мм (фут) — өрөөний дэлгээсийн босоо зайн дээд хязгаар.</summary>
        private const double RoomVerticalPadFt = 150 / 304.8;

        private static void BuildGeometry(Candidate c, double pad, double near, double far, string setupToken)
        {
            WePlannedElevation item = c.Item;
            if (!c.Geometric) return;
            SetDirection(c, c.A, c.B, c.Look);

            WeFrame frame;
            string err;
            if (!WallFrameCalculator.TryCreate(c.A, c.B, c.Look, c.BottomZ, out frame, out err))
            {
                Worse(ref item.Status, ref item.Message, WeStatus.Failed, err);
                return;
            }
            WeBox box;
            // Өрөөний дэлгээс: босоо зай ≤ 150 мм (жишиг — давхрын шалнаас 145 мм доош); ханын горимд хэвээр.
            double vpad = c.Room != null ? Math.Min(pad, RoomVerticalPadFt) : pad;
            if (!ElevationBoundsCalculator.TryCompute(c.FaceLength, c.BottomZ, c.TopZ, frame.Origin.Z,
                                                      c.FaceInFront, c.FaceToBack, near, far, pad, out box, out err, vpad))
            {
                Worse(ref item.Status, ref item.Message, item.Status >= WeStatus.RequiresReview ? item.Status : WeStatus.Unsupported, err);
                return;
            }

            item.Frame = frame;
            item.Box = box;
            item.FaceLength = c.FaceLength;
            item.FaceHeight = c.TopZ - c.BottomZ;
            item.Signature = WeIdentity.Signature(frame, box, setupToken);
            item.ProbePoints = Probes(c, (c.TopZ - c.BottomZ) / 2);
        }

        /// <summary>Шалгалтын цэгүүд: гадаргуугийн эхлэл, дунд, төгсгөл ба ханын ар тал — дотоод өндөр <paramref name="y"/> дээр.</summary>
        private static WeV3[] Probes(Candidate c, double y)
        {
            WeFrame frame = c.Item.Frame;
            double half = (c.B - c.A).Flat().Length / 2;
            double back = c.FaceToBack * 0.99;
            return new[]
            {
                frame.ToWorld(-half, y, 0),
                frame.ToWorld(0, y, 0),
                frame.ToWorld(half, y, 0),
                frame.ToWorld(0, y, back),
            };
        }

        /// <summary>Геометр + харагдацын тохиргоо + хэрэглэгчийн тогтоосон босоо хүрээ (W07) — тэмдэглэгээгүй тэмдэг.</summary>
        private static string GeoSignature(WePlannedElevation item, string setupToken)
        {
            return WeIdentity.WithCrop(WeIdentity.Signature(item.Frame, item.Box, setupToken), item.CropLowerMm, item.CropUpperMm);
        }

        /// <summary>
        /// W07: хэрэглэгчийн ТОГТООСОН босоо хүрээ — тэмдэглэгээнээс ӨМНӨ (тэмдэглэгээ тэр хилийн дотор төлөвлөгдөж, гадуурх лавлагаа хасагдана).
        /// Шийдвэр: цонхонд энэ удаа өгсөн › харагдац дээр хадгалсан › авто (<see cref="WeVerticalCrop.Resolve"/>).  Хүрээ ЯГ тогтоосон хил —
        /// дээд давхрын түвшин, «таазаар таслах» автомат хязгаар үйлчлэхгүй (хэрэглэгчийн ИЛ шийдвэр), харин дээд давхрын түвшнээс дээш / шалнаас
        /// хэт доош бол анхааруулна (хөрш давхрын элемент харагдана).  Хэсэгчилсэн хүрээ ЗОРИУД — мессежид тэмдэглээд шалгалтын цэгийг харагдах
        /// хэсгийн дунд руу шилжүүлнэ (эх, чиглэл, гүний шалгалт хэвээр).  Ханын гадаргууг огт хамрахгүй бол «шалгах».
        /// </summary>
        private static void ApplyDeclaredCrop(Candidate c, WeSettings s, Dictionary<string, WeExistingView> storedViews, WeAnnoSources src,
                                              IWeUnits u, string setupToken)
        {
            WePlannedElevation item = c.Item;
            if (item.Frame == null || item.Box == null) return;
            WeCropOverride mine = null;
            if (s.Crops != null) s.Crops.TryGetValue(item.Key, out mine);
            WeExistingView ev;
            storedViews.TryGetValue(item.Key, out ev);
            WeVerticalCrop.Resolved r = WeVerticalCrop.Resolve(mine, ev != null ? ev.CropLowerMm : double.NaN, ev != null ? ev.CropUpperMm : double.NaN);
            if (r.Error != null) item.Message = string.IsNullOrEmpty(item.Message) ? r.Error : item.Message + "; " + r.Error;
            if (!r.Declared) return;
            string desc = WeVerticalCrop.Describe(r.LowerMm, r.UpperMm);
            if (!WeVerticalCrop.Apply(item.Box, r.LowerMm, r.UpperMm, u))
            {
                Worse(ref item.Status, ref item.Message, WeStatus.RequiresReview,
                    "Таны тохируулсан босоо хүрээ (" + desc + ") хүчингүй — дээд хил доод хилээс дээр байх ёстой");
                return;
            }
            item.CropLowerMm = r.LowerMm;
            item.CropUpperMm = r.UpperMm;
            item.CropFromView = r.FromView;
            item.Signature = GeoSignature(item, setupToken);
            double lo, hi;
            if (!WeVerticalCrop.VisiblePart(item.Box.MinY, item.Box.MaxY, item.FaceHeight, out lo, out hi))
            {
                Worse(ref item.Status, ref item.Message, WeStatus.RequiresReview,
                    "Таны тохируулсан босоо хүрээ (" + desc + ") ханын гадаргууг хамрахгүй — дэлгээст хана харагдахгүй");
                return;
            }
            item.ProbePoints = Probes(c, (lo + hi) / 2);
            double tol = u.MmToInternal(1);
            bool partial = lo > tol || hi < item.FaceHeight - tol;
            string note = "Босоо хүрээ таны тохируулсан (" + desc + ")" + (partial ? " — хэсэгчилсэн: ханын бүх өндөр харагдахгүй" : string.Empty);
            item.Message = string.IsNullOrEmpty(item.Message) ? note : item.Message + "; " + note;
            double cap = item.Kind == WeSourceKind.Room ? RoomCropTopCap(c, src) : double.NaN;
            if (!double.IsNaN(r.UpperMm) && !double.IsNaN(cap) && item.Box.MaxY > cap + u.MmToInternal(5))
                Worse(ref item.Status, ref item.Message, WeStatus.Warning, "Дээд хил дээд давхрын түвшнээс дээш — дээд давхрын элемент дэлгээст харагдана");
            if (!double.IsNaN(r.LowerMm) && r.LowerMm < -WeVerticalCrop.BelowFloorWarnMm)
                Worse(ref item.Status, ref item.Message, WeStatus.Warning,
                    "Доод хил шалнаас " + WeVerticalCrop.BelowFloorWarnMm.ToString("0", CultureInfo.InvariantCulture) + " мм-ээс доош — доод давхрын элемент харагдаж болно");
        }

        /// <summary>
        /// Тэмдэглэгээ (spot level, хэмжээс, шошго) — хүрээ гарсны ДАРАА.  Босоо лавлагааг багтаахын тулд хүрээг босоо
        /// чиглэлд томруулж болно; тэмдэглэгээний хураангуй тэмдэгт залгагдана (өөрчлөгдвөл «шинэчлэгдэнэ»).
        /// </summary>
        private static void Annotate(Candidate c, WeAnnoSources src, WeSettings s, IWeUnits u, string setupToken)
        {
            WePlannedElevation item = c.Item;
            if (item.Frame == null || item.Box == null || item.Status > WeStatus.Warning || src == null) return;
            bool wallMode = item.Kind == WeSourceKind.Wall;
            var input = new WeAnnoInput
            {
                Item = item,
                FaceLength = c.FaceLength,
                FaceHeight = c.TopZ - c.BottomZ,
                LevelZ = !wallMode && c.Room != null ? c.Room.LevelElevation : c.BottomZ,
                WallMode = wallMode,
                WallWidth = c.Wall != null ? Math.Max(0, c.Wall.Width) : 0,
                // Өрөө: хана гадаргуунаас ЦААШ [0, W]; хана: location line (≈ тэнхлэг) дээр.
                // Ханын дунд: ништэй талд FaceToBack = ниш + зузаан — түүний хагас ханын АРД гардаг байв (аудит: 600 мм ниш → 400 мм).
                WallMidDepth = wallMode ? 0 : c.WallWidth / 2,
                CropTopCap = wallMode ? double.NaN : RoomCropTopCap(c, src),
                // W07: хэрэглэгчийн тогтоосон тал ЯГ — тэмдэглэгээ томруулахгүй, гадуурх лавлагааг хасна.
                FixedMinY = double.IsNaN(item.CropLowerMm) ? double.NaN : item.Box.MinY,
                FixedMaxY = double.IsNaN(item.CropUpperMm) ? double.NaN : item.Box.MaxY,
            };
            double minY, maxY;
            WeAnnotationPlan ap = WeAnnotationPlanner.Plan(input, src, s, u, out minY, out maxY);
            double newMin = double.IsNaN(input.FixedMinY) ? Math.Min(item.Box.MinY, minY) : item.Box.MinY;
            double newMax = double.IsNaN(input.FixedMaxY) ? Math.Max(item.Box.MaxY, maxY) : item.Box.MaxY;
            if (double.IsNaN(input.FixedMaxY))
            {
                // WE-BUG-001: өрөөний дэлгээсийн хүрээ өрөөний орой дээрх эхний түвшнээс ДЭЭШ гарахгүй — өрөөний 150 мм-ийн босоо зай
                // (RoomVerticalPadFt) ч, тэмдэглэгээний томруулалт ч.  Хасах чиглэлд ч өөрчилнө (өмнө нь зөвхөн томруулдаг байв).
                if (!double.IsNaN(input.CropTopCap) && newMax > input.CropTopCap) newMax = Math.Max(input.CropTopCap, newMin + 1e-6);
                // Таазны дээр трибун/шат (эзний шийдвэр 2026-10-14): хүрээ таазаар — өрөөний анхны хүрээнээс ч БАГАСНА.
                if (!double.IsNaN(ap.CeilingCutY) && newMax > ap.CeilingCutY) newMax = Math.Max(ap.CeilingCutY, newMin + 1e-6);
            }
            if (Math.Abs(newMin - item.Box.MinY) > 1e-9 || Math.Abs(newMax - item.Box.MaxY) > 1e-9)
            {
                item.Box.MinY = newMin;
                item.Box.MaxY = newMax;
                item.Signature = GeoSignature(item, setupToken);
            }
            item.Annotation = ap;
            item.Signature = WeIdentity.WithAnnotation(item.Signature, ap.Digest);
        }

        /// <summary>
        /// WE-BUG-001: өрөөний дэлгээсийн хүрээний дээд хязгаар (дотоод y) = өрөөний оройтой тэнцүү буюу дээш (−5 мм хүлцэл) ЭХНИЙ түвшин,
        /// өрөөний өөрийн түвшнээс ≥ 1.5 м дээш.  Энгийн өрөөнд = дээд давхрын түвшин; хоёр давхар өндөр өрөө (атриум) тэр түвшнээр
        /// тасрахгүй — дараагийн түвшин.  Түвшин мэдэгдэхгүй бол NaN (хязгааргүй — өмнөх зан төлөв).
        /// </summary>
        private static double RoomCropTopCap(Candidate c, WeAnnoSources src)
        {
            if (c == null || c.Room == null || c.Item == null || c.Item.Frame == null || src == null || src.Levels == null) return double.NaN;
            double top = c.Room.TopZ, own = c.Room.LevelElevation;
            WeLevelInfo lv = src.Levels.Where(l => l.Z >= top - 5 / 304.8 && l.Z > own + 1500 / 304.8).OrderBy(l => l.Z).ThenBy(l => l.Id).FirstOrDefault();
            return lv == null ? double.NaN : lv.Z - c.Item.Frame.Origin.Z;
        }

        /// <summary>
        /// Өрөө тус бүр — төслийн жишиг (MITIC 2-р давхрын 40 өрөө, 2026-10-08 хэмжсэн): A = БАРУУН хана (харах чиглэл −X), B = хойд, C = зүүн,
        /// D = урд (цагийн зүүний дагуу); чиглэл бүрийн ГОЛ (хамгийн урт) тал эхний үсгүүдийг авч, нэмэлт талууд (ниш, тусгаарлах хана) E, F …
        /// мөн тэр дарааллаар (216: A W · B N · C E · D S · E E · F W).  Хана тус бүр: A = гадна, B = дотор.  Геометргүй мөр «?».
        /// </summary>
        private static void AssignLetters(List<Candidate> list)
        {
            foreach (IGrouping<string, Candidate> g in list.Where(c => c.Item.Kind == WeSourceKind.Room).GroupBy(c => c.Item.GroupKey))
            {
                // Баруунаас эхэлсэн компас: W 0°, N 90°, E 180°, S 270°.
                Func<Candidate, double> az = c => double.IsNaN(c.LetterAzimuth) ? c.Azimuth : c.LetterAzimuth;
                Func<Candidate, double> rot = c => (az(c) + 90.0) % 360.0;
                Func<Candidate, int> bucket = c => (int)Math.Round(rot(c) / 90.0) % 4;
                // Гараар нэмсэн хана (2026-10-14) компасын дараалалд ОРОЛЦОХГҮЙ — өрөөний A–D-г хэзээ ч солихгүй, ард нь E, F …
                List<Candidate> dir = g.Where(c => c.HasDirection && !c.Manual).ToList();
                Func<Candidate, double> len = c => double.IsNaN(c.LetterAzimuth) ? c.FaceLength : c.LetterLength;
                Func<Candidate, double> along = c => double.IsNaN(c.LetterAzimuth) ? c.Along : c.LetterAlong;
                var primary = new HashSet<Candidate>(dir.GroupBy(bucket).Select(b => b.OrderByDescending(c => Math.Round(len(c), 4))
                                                                                       .ThenBy(c => Math.Round(along(c), 4))
                                                                                       .ThenBy(c => c.Item.WallUid ?? string.Empty, StringComparer.Ordinal).First()));
                int i = 0;
                foreach (Candidate c in dir.OrderBy(c => primary.Contains(c) ? 0 : 1)
                                           .ThenBy(c => Math.Round(rot(c), 3))
                                           .ThenBy(c => Math.Round(along(c), 4))
                                           .ThenBy(c => c.Item.WallUid ?? string.Empty, StringComparer.Ordinal))
                    c.Item.SideLetter = WeNaming.Letter(i++);
                foreach (Candidate c in g.Where(c => c.Manual && c.HasDirection).OrderBy(c => c.ManualOrder))
                    c.Item.SideLetter = WeNaming.Letter(i++);
            }
            foreach (Candidate c in list)
            {
                if (c.Item.SideLetter != null) continue;
                if (c.Item.Kind == WeSourceKind.Wall)
                    c.Item.SideLetter = c.Item.Side == WeSide.Interior ? "B" : "A";
                else
                    c.Item.SideLetter = "?";
            }
        }

        private static void ResolveAction(Candidate c, Dictionary<string, List<WeExistingView>> byKey, WeSettings s, HashSet<string> taken, string range)
        {
            WePlannedElevation item = c.Item;
            bool generatable = item.Status <= WeStatus.Warning && item.Frame != null && item.Box != null;
            string desired = generatable || item.Frame != null ? WeNaming.Expand(s.NamePattern, TokenValues(c, range)) : string.Empty;

            List<WeExistingView> existing;
            byKey.TryGetValue(item.Key, out existing);
            if (existing != null && existing.Count > 1)
            {
                item.ExistingViewId = existing.OrderBy(e => e.ViewId).First().ViewId;
                item.ExistingName = existing.OrderBy(e => e.ViewId).First().Name;
                item.Name = item.ExistingName;
                if (generatable)
                    Worse(ref item.Status, ref item.Message, WeStatus.RequiresReview,
                        existing.Count.ToString(CultureInfo.InvariantCulture) + " харагдац нэг дэлгээсийг төлөөлж байна (давхардал) — илүүг нь гараар устгана уу");
                item.CanForce = false;   // давхардлыг хүчлэхэд ч засагдахгүй — гараар
                item.Action = WeAction.Skip;
                item.ActionNote = "Давхардсан харагдацад хүрэхгүй";
                return;
            }

            if (existing != null && existing.Count == 1)
            {
                WeExistingView e = existing[0];
                item.ExistingViewId = e.ViewId;
                item.ExistingIsSection = e.IsSection;
                item.ExistingName = e.Name;
                item.Name = e.Name;
                if (!generatable)
                {
                    item.Action = WeAction.Skip;
                    item.ActionNote = "Хуучин харагдац хөндөгдөхгүй";
                    return;
                }
                if (e.OwnedByOtherUser)
                {
                    item.CanForce = false;
                    item.Action = WeAction.Skip;
                    Worse(ref item.Status, ref item.Message, WeStatus.RequiresReview, "Харагдацыг өөр хэрэглэгч эзэмшиж байна (worksharing)");
                    return;
                }

                bool userRenamed = !string.IsNullOrEmpty(e.GeneratedName) && !string.Equals(e.Name, e.GeneratedName, StringComparison.Ordinal);
                bool wantRename = !userRenamed && !string.IsNullOrEmpty(desired) && !string.Equals(desired, e.Name, StringComparison.Ordinal)
                                  && !taken.Contains(desired);
                bool geometryChanged = !string.Equals(e.Signature ?? string.Empty, item.Signature ?? string.Empty, StringComparison.Ordinal)
                                       || e.GeneratorVersion != WeIdentity.GeneratorVersion;
                bool onlyAnnotation = geometryChanged && e.GeneratorVersion == WeIdentity.GeneratorVersion
                                      && string.Equals(WeIdentity.GeometryPart(e.Signature), WeIdentity.GeometryPart(item.Signature), StringComparison.Ordinal);

                if ((geometryChanged || wantRename) && s.UpdateExisting)
                {
                    item.Action = WeAction.Update;
                    item.ActionNote = onlyAnnotation ? (wantRename ? "Тэмдэглэгээ ба нэр шинэчлэгдэнэ" : "Тэмдэглэгээ шинэчлэгдэнэ")
                        : geometryChanged ? (wantRename ? "Геометр ба нэр шинэчлэгдэнэ" : "Геометр шинэчлэгдэнэ") : "Нэр шинэчлэгдэнэ";
                    if (wantRename)
                    {
                        item.Name = desired;
                        item.Rename = true;
                        taken.Add(desired);
                    }
                }
                else
                {
                    item.Action = WeAction.Keep;
                    item.ActionNote = geometryChanged ? "Өөрчлөгдсөн боловч «шинэчлэх» унтраалттай" : "Өөрчлөлтгүй";
                }
                return;
            }

            if (!generatable)
            {
                item.Action = WeAction.Skip;
                item.Name = desired;
                return;
            }
            item.Action = WeAction.Create;
            item.Name = WeNaming.Unique(desired, taken);
            taken.Add(item.Name);
        }

        /// <summary>Нэр, тэмдгийн загварын утгууд (хана горимд {Room} = ханын тэмдэг эсвэл «W&lt;id&gt;»).</summary>
        private static Dictionary<string, string> TokenValues(Candidate c, string range)
        {
            WePlannedElevation i = c.Item;
            string room = i.Kind == WeSourceKind.Room
                ? Trimmed(i.RoomNumber)
                : (!string.IsNullOrWhiteSpace(c.WallMark) ? c.WallMark.Trim() : "W" + i.WallId.ToString(CultureInfo.InvariantCulture));
            string wall = !string.IsNullOrWhiteSpace(c.WallMark) ? c.WallMark.Trim() : i.WallId.ToString(CultureInfo.InvariantCulture);
            return WeNaming.Values(i.LevelName, room, i.RoomName, i.SideToken ?? i.SideLetter, wall, i.SideIndex, c.WallType, range);
        }

        // ══════════════════════════════════════════════════════════════

        private static WePlannedElevation NewItem(string key, WeSourceKind kind, string group, string label,
                                                  WeRoomInfo room, WeWallInfo wall, WeStatus status, string message)
        {
            return new WePlannedElevation
            {
                Key = key,
                Kind = kind,
                GroupKey = group,
                GroupLabel = label,
                RoomUid = room != null ? room.UniqueId : string.Empty,
                RoomNumber = room != null ? room.Number : null,
                RoomName = room != null ? room.Name : null,
                WallUid = wall != null ? wall.UniqueId : string.Empty,
                WallId = wall != null ? wall.Id : 0,
                WallLabel = wall != null ? WallLabelOf(wall) : string.Empty,
                LevelName = room != null ? room.LevelName : (wall != null ? wall.LevelName : null),
                Status = status,
                Message = message,
                Action = WeAction.Skip,
            };
        }

        /// <summary>Харагч ханын аль талд байгаа (<paramref name="look"/> = харагчаас хана руу); тодорхойгүй бол «?».</summary>
        private static string SideOf(WeWallInfo w, WeV3 look)
        {
            WeV3 ext;
            return WallFrameCalculator.TryExteriorNormal(WallFrameCalculator.Tangent(w.Start, w.End), w.OrientationHint, out ext)
                ? (look.Dot(ext) < 0 ? WeSide.Exterior : WeSide.Interior)
                : "?";
        }

        /// <summary>Хана талын шулуунтай параллель (хэвтээ чиглэлээр).</summary>
        private static bool Parallel(WeWallInfo w, WeV3 faceT)
        {
            WeV3 wt = WallFrameCalculator.Tangent(w.Start, w.End);
            return wt.IsZero || faceT.IsZero || Math.Abs(wt.Cross(faceT).Z) <= 1e-3;
        }

        /// <summary>Зангуу болж болох (дэмжигдсэн, параллель) хана.</summary>
        private static bool Healthy(WeWallInfo w, WeV3 faceT)
        {
            WeStatus ws; string wm;
            WallIssue(w, out ws, out wm);
            return ws <= WeStatus.Warning && Parallel(w, faceT);
        }

        private static string WallLabelOf(WeWallInfo w)
        {
            string id = "#" + w.Id.ToString(CultureInfo.InvariantCulture);
            string type = string.IsNullOrWhiteSpace(w.TypeName) ? "Хана" : w.TypeName.Trim();
            return string.IsNullOrWhiteSpace(w.Mark) ? type + " " + id : type + " " + w.Mark.Trim() + " (" + id + ")";
        }

        /// <summary>
        /// Хэрэглэгчийн урьдчилсан дүнгээс ХАССАН дэлгээс: үүсгэх/шинэчлэхгүй (байгаа харагдацад хүрэхгүй).
        /// Төлөв хэвээр — зөвхөн үйлдэл «алгасах» болно.
        /// </summary>
        public static void ApplyExclusions(WePlan plan, ICollection<string> excludedKeys)
        {
            if (plan == null || excludedKeys == null || excludedKeys.Count == 0) return;
            foreach (WePlannedElevation i in plan.Items)
            {
                if (!excludedKeys.Contains(i.Key)) continue;
                if (i.Action == WeAction.Create || i.Action == WeAction.Update || i.Action == WeAction.Keep)
                {
                    i.Action = WeAction.Skip;
                    i.ActionNote = "Та хассан";
                }
            }
        }

        /// <summary>Ханын геометрийн дэмжлэгийн шалгалт (хямд өгөгдлөөр).</summary>
        public static void WallIssue(WeWallInfo w, out WeStatus status, out string message)
        {
            status = WeStatus.Ready;
            message = null;
            if (!w.HasLocationLine) { status = WeStatus.Unsupported; message = "Байрлалын шугамгүй хана (in-place / тусгай)"; return; }
            if (w.IsCurved) { status = WeStatus.Unsupported; message = "Муруй хана — дэмжигдэхгүй (зураг буруу гарахаас сэргийлж үүсгэсэнгүй)"; return; }
            if ((w.End - w.Start).Flat().Length < WeTol.MinWallLength) { status = WeStatus.Unsupported; message = "Хэт богино хана"; return; }
            if (w.TopZ - w.BottomZ <= WeTol.Length) { status = WeStatus.Unsupported; message = "Ханын өндөр тодорхойгүй"; return; }
            if (w.IsSlanted) { status = WeStatus.RequiresReview; message = "Налуу / нарийссан хана — хүрээ, гүнийг гараар шалгах шаардлагатай"; return; }
            switch (w.Kind)
            {
                case WeWallKind.Unknown:
                    status = WeStatus.RequiresReview; message = "Танихгүй ханын төрөл"; return;
                case WeWallKind.Curtain:
                    status = WeStatus.Warning; message = "Хөшиг хана — гадаргуугийн байрлалыг гүний нөөцөөр хамруулав"; return;
                case WeWallKind.Stacked:
                    status = WeStatus.Warning; message = "Давхарласан хана — гүнийг нийт зузаанаар бодов"; return;
            }
            if (!(w.Width > 0)) { status = WeStatus.Failed; message = "Ханын зузаан 0"; }
        }

        /// <summary>Хүнд төлөвийг (enum дарааллаар) сонгоно; мессежийг нэмж бичнэ.</summary>
        internal static void Worse(ref WeStatus status, ref string message, WeStatus candidate, string text)
        {
            if (string.IsNullOrEmpty(text)) { if (candidate > status) status = candidate; return; }
            if (candidate > status) status = candidate;
            if (candidate == WeStatus.Ready) return;
            message = string.IsNullOrEmpty(message) ? text : message + "; " + text;
        }

        private static string Trimmed(string s) { return string.IsNullOrWhiteSpace(s) ? string.Empty : s.Trim(); }
    }
}
