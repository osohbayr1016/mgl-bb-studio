using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace RevitMcpAddin.ChangeImpact.Core
{
    public enum SimSeverity
    {
        Info = 0,
        /// <summary>Хөдөлгөөн боломжтой, гэхдээ хянаж/дахин хийх зүйл бий (🟠).</summary>
        Review,
        /// <summary>Батлагдсан ноцтой — Revit зөвшөөрөхгүй, эсвэл элемент устна (🔴).</summary>
        Blocking,
    }

    /// <summary>Хэрэглэгч харах нэг мөр: «юу болох» + «юуг дахин хийх / ямар асуудал гарах».</summary>
    public sealed class SimLine
    {
        public string Code { get; set; }
        public SimSeverity Severity { get; set; }
        public string Mark { get; set; }
        public string Text { get; set; }
        /// <summary>«Үүнийг дахин хийх / ийм асуудал гарна» — бодит үр дагавар.</summary>
        public string Consequence { get; set; }
        /// <summary>3D дээр улаанаар тодруулах орчны элементүүдийн түлхүүр.</summary>
        public List<string> Keys { get; set; } = new List<string>();
        public long Id { get; set; }
        public int Slot { get; set; } = -1;
        public SimKind Kind { get; set; }
        /// <summary>Revit-ийн бодит тооцооноос (true) эсвэл урьдчилсан хайрцаг/гурвалжингаас (false).</summary>
        public bool Exact { get; set; }
        /// <summary>Тодруулах хайрцаг (local мм) — улаан эзлэхүүн.  null бол ганц элементийг л тодруулна.</summary>
        public double[] BoxMm { get; set; }
    }

    public enum SimPhase
    {
        /// <summary>Хулганаар чирэхгүй, шинжилгээ ажиллахгүй.</summary>
        Idle = 0,
        /// <summary>Хулганыг барьж чирж байна — зөвхөн урьдчилсан дүн.</summary>
        Dragging,
        /// <summary>Тавьсан; Revit-ийн sandbox ажиллаж байна.</summary>
        Analyzing,
    }

    /// <summary>Нэг агшны бүтэн тайлан — цонх үүнийг л зурна (бүх шийдвэр ЭНД, цонхонд биш → тестлэгдэнэ).</summary>
    public sealed class SimReport
    {
        public MoveVerdict Verdict { get; set; }
        public string Mark { get; set; }
        public string Title { get; set; }
        public string Subtitle { get; set; }
        public bool IsPending { get; set; }
        public bool IsFinal { get; set; }
        public SimPhase Phase { get; set; }
        /// <summary>«Хэрэв та «…»-г эндээс тийш зөөвөл (X +350 мм):»</summary>
        public string Headline { get; set; }
        public string OffsetText { get; set; }
        public double DistanceMm { get; set; }
        public List<SimLine> Lines { get; set; } = new List<SimLine>();
        public int BlockingCount { get; set; }
        public int ReviewCount { get; set; }
        /// <summary>Хэрэглэгчид «юу шалгасан, юуг шалгаагүй» гэдгийг ИЛ хэлнэ.</summary>
        public List<string> Coverage { get; set; } = new List<string>();
        public string ModelLine { get; set; }
        public string NormLine { get; set; }
        public string ModelOnlyNote { get; set; }
        public bool CanApply { get; set; }
        /// <summary>
        /// 🔴 боловч Revit өөрөө зөвшөөрсөн (sandbox Simulated) — архитектор ШАЛТГААН бичээд өөрийн шийдвэрээр зөвшөөрч болно (эзэн 2026-10-06:
        /// «архитектор зөвшөөрвөл зөөнө»).  Revit татгалзсан / шалгалт дуусаагүй үед ХЭЗЭЭ Ч үгүй.
        /// </summary>
        public bool CanForce { get; set; }
        public string ApplyHint { get; set; }
        /// <summary>3D дээр улаанаар тодруулах орчны түлхүүрүүд (мөр бүрийн нийлбэр).</summary>
        public HashSet<string> HighlightKeys { get; set; } = new HashSet<string>(StringComparer.Ordinal);
    }

    /// <summary>
    /// «Хэрэв та X-г эндээс тийш зөөвөл …» гэсэн тайлан, шийдвэр (🟢/🟠/🔴/⚪).  ЦЭВЭР: Revit, WPF-гүй — бүх текст, дараалал, шийдвэр ЭНД тестлэгдэнэ.
    ///
    /// ПРИНЦИП:
    ///   • Чирж байх үед ЗӨВХӨН урьдчилсан (хайрцаг/гурвалжин) — «🟢» ХЭЗЭЭ Ч гарахгүй (⚪ «Шалгаж байна»).
    ///   • Тавьсны дараа Revit sandbox-ийн ЭЦСИЙН дүн (энэ offset-д) гарвал л 🟢/🟠/🔴.
    ///   • Монгол нормын автомат баталгаа БИШ — тусдаа мөр.  «Нормд нийцсэн» гэж ХЭЗЭЭ Ч бичихгүй.
    ///   • Шалгаагүй зүйлээ ИЛ хэлнэ (харагдац, хуудас, хүснэгт, гарц).
    /// </summary>
    public static class SimNarrative
    {
        public const double RoomAreaEpsM2 = 0.05;
        private const int MaxIndividualClashLines = 5;

        public static SimReport Build(SimScene scene, SimVec offset, SimConflictResult live, SimExactResult exact, SimPhase phase)
        {
            var r = new SimReport { Phase = phase, DistanceMm = Math.Sqrt(offset.X * offset.X + offset.Y * offset.Y + offset.Z * offset.Z) };
            string name = scene != null && !string.IsNullOrEmpty(scene.MovingName) ? scene.MovingName : "элемент";
            r.OffsetText = FormatOffset(offset);
            r.ModelOnlyNote = PreChangeDecisionEngine.ModelOnlyNote;
            r.NormLine = PreChangeDecisionEngine.NormLineText;
            bool zero = r.DistanceMm < 0.5;
            bool current = exact != null && exact.Matches(offset);

            if (zero)
            {
                r.Headline = "Элементийг хулганаар барьж чирээд хүссэн газартаа тавина уу — «" + name + "»-г тийш зөөвөл юу нөлөөлөхийг шууд энд харуулна.";
                r.Verdict = MoveVerdict.Unknown;
                r.Mark = "⚪"; r.Title = "ЗӨӨЛТ ХИЙГДЭЭГҮЙ";
                r.Subtitle = "Элемент анхны байрлалдаа байна.";
                r.IsPending = false; r.IsFinal = false;
                r.CanApply = false; r.ApplyHint = "Эхлээд элементийг хулганаар чирж зөөнө үү.";
                r.ModelLine = "Моделийн нөлөөлөл: — зөөлтгүй";
                return r;
            }

            r.Headline = "Хэрэв та «" + name + "»-г эндээс тийш зөөвөл (" + r.OffsetText + "):";

            if (current) BuildFinal(r, scene, live, exact);
            else BuildPreliminary(r, scene, live, phase);

            Sort(r);
            r.BlockingCount = r.Lines.Count(l => l.Severity == SimSeverity.Blocking);
            r.ReviewCount = r.Lines.Count(l => l.Severity == SimSeverity.Review);
            // УЛААН = зөвхөн мөргөлдөөн.  Revit-ээр дагаж өөрчлөгдөх (affected) нь улбар шараар (settled геометр) зурагдана; нэгдсэн ханыг (reactive, ℹ) будахгүй —
            // Revit 2027-д хэмжсэн: өмнө нь шал бүхэлдээ «мөргөлдөөн» өнгөөр будагдаж, жинхэнэ мөргөлдөөнийг нууж байв.
            foreach (SimLine l in r.Lines)
                if (l.Code != null && l.Code.StartsWith("clash", StringComparison.Ordinal) && l.Code != "clash.reactive")
                    foreach (string k in l.Keys) r.HighlightKeys.Add(k);
            return r;
        }

        /* ============================== ЧИРЖ БАЙХ ҮЕД (урьдчилсан) ============ */

        private static void BuildPreliminary(SimReport r, SimScene scene, SimConflictResult live, SimPhase phase)
        {
            r.IsFinal = false;
            r.IsPending = true;
            r.Verdict = MoveVerdict.Unknown;
            r.Mark = "⚪";
            r.Title = phase == SimPhase.Dragging ? "ЧИРЖ БАЙНА…" : "ШАЛГАЖ БАЙНА…";
            r.CanApply = false;
            r.ApplyHint = phase == SimPhase.Dragging ? "Хулганыг тавина уу — Revit-ээр шалгана." : "Revit-ээр шалгаж дуустал хүлээнэ үү.";

            List<SimHit> real = live == null ? new List<SimHit>() : live.Hits.Where(h => h.IsNew && !h.Reactive).ToList();
            List<SimHit> reactive = live == null ? new List<SimHit>() : live.Hits.Where(h => h.IsNew && h.Reactive).ToList();
            AddClashLines(r, real.Select(PrelimOf).ToList(), false);
            foreach (SimHit h in reactive) r.Lines.Add(ReactiveLine(h.Key, h.Id, h.Slot, h.Label, h.Kind, false));

            if (real.Count == 0)
                r.Subtitle = "Урьдчилсан: огтлолцол илрээгүй" + (phase == SimPhase.Analyzing ? " — Revit-ээр баталгаажуулж байна…" : ".");
            else
                r.Subtitle = "Урьдчилсан: " + real.Count + " элементтэй огтлолцож байна" + (phase == SimPhase.Analyzing ? " — Revit-ээр баталгаажуулж байна…" : ".");
            r.ModelLine = "Моделийн нөлөөлөл: … түр дүн (хайрцаг/гурвалжин)";
            if (scene != null && scene.IncompleteReasons.Count > 0)
                foreach (string reason in scene.IncompleteReasons.Take(2)) r.Coverage.Add("⚠ " + reason);
        }

        private sealed class Clash
        {
            public string Key; public long Id; public int Slot; public string Label; public string Category; public SimKind Kind;
            public bool Reactive; public bool Confirmed; public double VolumeCm3; public double[] Box; public bool Volumetric; public double DepthMm;
        }

        private static Clash PrelimOf(SimHit h)
        {
            return new Clash
            {
                Key = h.Key, Id = h.Id, Slot = h.Slot, Label = h.Label, Category = h.CategoryName, Kind = h.Kind, Reactive = h.Reactive, Confirmed = false,
                Box = h.Region.IsEmpty ? null : h.Region.ToArray(), Volumetric = h.Volumetric, DepthMm = h.DepthMm,
            };
        }

        /* ============================== ЭЦСИЙН (Revit) ====================== */

        private static void BuildFinal(SimReport r, SimScene scene, SimConflictResult live, SimExactResult e)
        {
            r.IsFinal = true;
            r.IsPending = false;
            bool refused = e.Outcome == SandboxOutcome.Blocked || e.Outcome == SandboxOutcome.Rejected;
            bool fault = e.Outcome == SandboxOutcome.Faulted || e.Outcome == SandboxOutcome.NotRestored || e.Outcome == SandboxOutcome.Unknown;

            if (e.Outcome != SandboxOutcome.Simulated)
            {
                string why = e.BlockReasons.Count > 0 ? string.Join(" ", e.BlockReasons) : "Revit энэ зөөлтийг гүйцэтгэж чадсангүй.";
                var line = new SimLine
                {
                    Code = refused ? "revit.refused" : "revit.fault", Severity = SimSeverity.Blocking, Mark = "🔴", Exact = true,
                    Text = refused ? "Revit энэ зөөлтийг зөвшөөрөхгүй: " + why : "Шалгалт дуусаагүй: " + why,
                    Consequence = refused ? "Зөөлтийг өөрчил (түгжигдсэн хэмжээс, Pin, join, хост шалтгаан байж болно) — загварт ЮУ Ч өөрчлөгдөөгүй." : "Загварыг Ctrl+Z-ээр шалгана уу.",
                };
                foreach (FailureNote f in e.Failures.Where(f => f.IsError).Take(3))
                    line.Consequence += " · Revit: " + f.Text;
                r.Lines.Add(line);
                r.Verdict = fault ? MoveVerdict.Unknown : MoveVerdict.DoNotMove;
                r.Mark = fault ? "⚪" : "🔴";
                r.Title = fault ? "ДҮГНЭХ БОЛОМЖГҮЙ" : "ЗӨӨХГҮЙ";
                r.Subtitle = refused ? "Revit энэ хөдөлгөөнийг зөвшөөрөхгүй." : "Шаардлагатай шалгалт дуусаагүй.";
                r.CanApply = false;
                r.ApplyHint = refused ? "Revit зөвшөөрөхгүй байна." : "Дүгнэлт бүрэн биш.";
                r.ModelLine = "Моделийн нөлөөлөл: — шалгаагүй";
                if (e.Outcome == SandboxOutcome.NotRestored) r.Coverage.Add("⚠ Загвар анхны төлөвтөө буцсан эсэх БАТЛАГДААГҮЙ — Ctrl+Z-ээр шалгана уу.");
                return;
            }

            // --- мөргөлдөөн: Revit-ийн boolean + урьдчилсан (баталгаажаагүйг) нэгтгэнэ ---
            var clashes = MergeClashes(scene, live, e);
            AddClashLines(r, clashes.Where(c => !c.Reactive).ToList(), true);
            foreach (Clash c in clashes.Where(c => c.Reactive))
                r.Lines.Add(ReactiveLine(c.Key, c.Id, c.Slot, c.Label, c.Kind, true));

            // --- өрөө ---
            foreach (SimRoomChange rc in e.Rooms)
            {
                if (rc.Deleted)
                    r.Lines.Add(new SimLine { Code = "room.deleted", Severity = SimSeverity.Blocking, Mark = "🔴", Exact = true, Id = rc.Id, Text = "Өрөө «" + rc.Name + "» устна", Consequence = "Өрөөг дахин үүсгэж, тэмдэглэгээг сэргээх шаардлагатай." });
                else if (rc.NotEnclosed)
                    r.Lines.Add(new SimLine { Code = "room.open", Severity = SimSeverity.Review, Mark = "🟠", Exact = true, Id = rc.Id, Text = "Өрөө «" + rc.Name + "» хаагдахаа больно (хил тасарна)", Consequence = "Хана/хилийг засаж өрөөг дахин тодорхойлох шаардлагатай." });
                else if (Math.Abs(rc.DeltaM2) >= RoomAreaEpsM2)
                    r.Lines.Add(new SimLine
                    {
                        Code = "room.area", Severity = SimSeverity.Review, Mark = "🟠", Exact = true, Id = rc.Id,
                        Text = "Өрөө «" + rc.Name + "»: талбай " + M2(rc.BeforeM2) + " → " + M2(rc.AfterM2) + " м² (" + Signed(rc.DeltaM2, "0.0#") + ")",
                        Consequence = "Өрөөний талбай, тэмдэглэгээ, өнгөлгөөний хүснэгтийг шинэчлэх шаардлагатай.",
                    });
            }

            // --- устах элемент ---
            List<SimDeletedElement> known = e.Deleted.Where(d => d.Known).ToList();
            List<SimDeletedElement> internalOnly = e.Deleted.Where(d => !d.Known).ToList();
            if (known.Count > 0)
            {
                string names = string.Join(", ", known.Take(3).Select(d => d.Label)) + (known.Count > 3 ? " …" : "");
                r.Lines.Add(new SimLine
                {
                    Code = "deleted", Severity = SimSeverity.Blocking, Mark = "🔴", Exact = true,
                    Text = known.Count + " элемент УСТНА: " + names,
                    Consequence = "Устсан элементүүдийг дахин үүсгэж, холбоосыг сэргээх шаардлагатай.",
                });
            }
            if (internalOnly.Count > 0)
                r.Lines.Add(new SimLine
                {
                    Code = "deleted.internal", Severity = SimSeverity.Review, Mark = "🟠", Exact = true,
                    Text = "Revit " + internalOnly.Count + " дотоод элементийг (нүх, зүсэлт, тэмдэглэгээ г.м.) шинэчлэхдээ устгана",
                    Consequence = "Зөөлтийн дараа нүх/зүсэлт/хэмжээсийг шалгана уу.",
                });

            // --- Revit-ийн анхааруулга ---
            foreach (FailureNote f in e.Failures.Where(f => !f.IsError).GroupBy(f => f.Text).Select(g => g.First()).Take(4))
                r.Lines.Add(new SimLine { Code = "revit.warning", Severity = SimSeverity.Review, Mark = "🟠", Exact = true, Text = "Revit анхааруулга: " + f.Text, Consequence = "Анхааруулгыг арилгах эсвэл зөөлтийг өөрчлөх шаардлагатай." });

            // --- хамт өөрчлөгдөх зүйл (мэдээлэл) ---
            if (e.Dependents.Count > 0)
            {
                var groups = e.Dependents.GroupBy(d => string.IsNullOrEmpty(d.Category) ? "Элемент" : d.Category).OrderByDescending(g => g.Count()).Take(5)
                    .Select(g => g.Key + " ×" + g.Count());
                r.Lines.Add(new SimLine { Code = "dependents", Severity = SimSeverity.Info, Mark = "ℹ", Exact = true, Text = "Хамт өөрчлөгдөнө: " + string.Join(", ", groups), Consequence = "Хостлогдсон элемент, хэмжээс, шошго автоматаар дагана." });
            }
            AddAffectedLines(r, e, clashes);
            if (e.ModifiedCount > 0)
                r.Lines.Add(new SimLine { Code = "modified", Severity = SimSeverity.Info, Mark = "ℹ", Exact = true, Text = "Revit нийт " + e.ModifiedCount + " элементийг автоматаар шинэчилнэ.", Consequence = null });

            // --- шийдвэр ---
            bool blocking = r.Lines.Any(l => l.Severity == SimSeverity.Blocking);
            bool review = r.Lines.Any(l => l.Severity == SimSeverity.Review);
            bool incomplete = !e.ClashesEvaluated || !e.ClashesComplete;
            if (blocking)
            {
                r.Verdict = MoveVerdict.DoNotMove; r.Mark = "🔴"; r.Title = "ЗӨӨХГҮЙ";
                SimLine first = r.Lines.First(l => l.Severity == SimSeverity.Blocking);
                int nb = r.Lines.Count(l => l.Severity == SimSeverity.Blocking);
                r.Subtitle = first.Text + (nb > 1 ? "  (+" + (nb - 1) + " өөр)" : "");
            }
            else if (incomplete)
            {
                r.Verdict = MoveVerdict.Unknown; r.Mark = "⚪"; r.Title = "ДҮГНЭХ БОЛОМЖГҮЙ";
                r.Subtitle = e.IncompleteReasons.Count > 0 ? e.IncompleteReasons[0] : "Огтлолцлын шалгалт бүрэн дуусаагүй.";
            }
            else if (review)
            {
                r.Verdict = MoveVerdict.MoveWithReview; r.Mark = "🟠"; r.Title = "ХЯНААД ЗӨӨ";
                int n = r.Lines.Count(l => l.Severity == SimSeverity.Review);
                r.Subtitle = "Хөдөлгөөн боломжтой, " + n + " зүйлийг дахин хийх/хянах шаардлагатай.";
            }
            else
            {
                r.Verdict = MoveVerdict.MoveOk; r.Mark = "🟢"; r.Title = "ТЕХНИКИЙН ХУВЬД ЗӨӨЖ БОЛНО";
                r.Subtitle = "Шалгасан бүх зүйлд мөргөлдөөн, өөрчлөлт илрээгүй.";
            }
            r.ModelLine = blocking ? "Моделийн нөлөөлөл: ✕ ноцтой" : incomplete ? "Моделийн нөлөөлөл: ? бүрэн шалгаж чадсангүй" : "Моделийн нөлөөлөл: ✓ шалгасан";

            r.CanApply = r.Verdict == MoveVerdict.MoveOk || r.Verdict == MoveVerdict.MoveWithReview;
            r.CanForce = r.Verdict == MoveVerdict.DoNotMove && e.Outcome == SandboxOutcome.Simulated;
            r.ApplyHint = r.CanApply ? null : r.CanForce ? "Ноцтой үр дагавартай — зөөх бол шалтгаанаа бичиж, өөрийн шийдвэрээр зөвшөөрнө (холбогдох хүмүүст мэдэгдэнэ)."
                : (r.Verdict == MoveVerdict.DoNotMove ? "Батлагдсан ноцтой үр дагавартай — зөөхгүй." : "Дүгнэлт бүрэн биш — зөөхгүй.");

            // --- хамрах хүрээ: юуг шалгасан, юуг шалгаагүй ---
            int confirmed = clashes.Count(c => c.Confirmed);
            r.Coverage.Add("✓ Revit-ийн бодит тооцоо: огтлолцол" + (e.ClashesEvaluated ? " (" + confirmed + " батлагдсан)" : " — шалгаагүй") + ", өрөө" + (e.RoomsEvaluated ? " (" + e.Rooms.Count + " өөрчлөгдөнө)" : " — шалгаагүй") + ", Revit-ийн алдаа/анхааруулга.");
            foreach (string a in e.AdvisoryReasons.Take(3)) r.Coverage.Add("⚠ " + a);
            foreach (string a in e.IncompleteReasons.Take(3)) r.Coverage.Add("⚠ " + a);
            r.Coverage.Add("— Шалгаагүй: харагдац, хуудас, хүснэгт, гарц, MEP-ийн холболт, Монгол норм (ханыг/хаалгыг «Өөрчлөхөөс өмнө»-ийн бүтэн шалгалтаар шалгана).");
        }

        /// <summary>Дагаж өөрчлөгдөх биеийн ач холбогдол (бага = чухал): бүтэц → MEP → хана/шат → бусад → шал/дээвэр/тааз (нүх, зүсэлт л шинэчлэгдэнэ).</summary>
        public static int AffectedRank(SimKind k)
        {
            switch (k)
            {
                case SimKind.Column: case SimKind.Framing: case SimKind.Foundation: return 0;
                case SimKind.Duct: case SimKind.Pipe: case SimKind.Conduit: case SimKind.CableTray: case SimKind.Fitting: return 1;
                case SimKind.Wall: case SimKind.Stair: case SimKind.Railing: case SimKind.Door: case SimKind.Window: return 2;
                case SimKind.Floor: case SimKind.Roof: case SimKind.Ceiling: case SimKind.Topography: return 4;
                default: return 3;
            }
        }

        /// <summary>
        /// «Багана зөөхөд дам нуруу ×8-ийн төгсгөл дагаж шилжинэ» — Revit өөрөө өөрчлөх бие.  Бүтэц/MEP/хана = 🟠 (тэр ажлыг хийсэн хүн дахин шалгана, мэдэгдэл очно);
        /// шал/дээвэр (нүх, зүсэлт л шинэчлэгдэнэ) ба бусад = ℹ.  Огтлолцлын мөрөнд аль хэдийн байгаа элемент давхардахгүй.
        /// </summary>
        private static void AddAffectedLines(SimReport r, SimExactResult e, List<Clash> clashes)
        {
            if (e.Affected == null || e.Affected.Count == 0) return;
            var clashed = new HashSet<string>(clashes.Select(c => c.Key), StringComparer.Ordinal);
            List<SimAffected> list = e.Affected.Where(a => !clashed.Contains("h:" + a.Id)).ToList();
            // Байрлал нь хөдлөөгүй нь (зөвхөн холболт/нэгдэл шинэчлэгдсэн) — мэдээлэл; шилжсэн эсвэл мэдэгдэхгүй (шууд зөөлт) нь бүтэц/MEP/хананд 🟠.
            foreach (IGrouping<string, SimAffected> g in list.GroupBy(a => a.Kind + "|" + (a.LocationChanged == false ? "join" : a.LocationChanged == true ? "moved" : "unknown"))
                .OrderBy(g => AffectedRank(g.First().Kind)).ThenBy(g => g.First().LocationChanged == false ? 1 : 0))
            {
                SimKind kind = g.First().Kind;
                bool? moved = g.First().LocationChanged;
                bool review = AffectedRank(kind) <= 2 && moved != false;
                string names = string.Join(", ", g.Take(2).Select(a => "«" + a.Label + "»")) + (g.Count() > 2 ? " …" : "");
                string what = AffectedRank(kind) == 4 ? "нүх/зүсэлт нь шинэчлэгдэнэ"
                    : moved == false ? "холболт/нэгдэл нь шинэчлэгдэнэ (байрлал хэвээр)"
                    : moved == null ? "Revit-ээр шинэчлэгдсэн (холболт, нэгдэл эсвэл байрлал) — шалгана уу"
                    : kind == SimKind.Framing || kind == SimKind.Column || kind == SimKind.Foundation ? "холболтыг дагаж байрлал/урт нь өөрчлөгдөнө"
                    : AffectedRank(kind) == 1 ? "холболтыг дагаж шилжинэ"
                    : kind == SimKind.Wall ? "нэгдсэн төгсгөл нь өөрчлөгдөнө" : "Revit-ээр өөрчлөгдөнө";
                r.Lines.Add(new SimLine
                {
                    Code = review ? "affected" : "affected.info", Severity = review ? SimSeverity.Review : SimSeverity.Info, Mark = review ? "🟠" : "ℹ", Exact = true, Kind = kind,
                    Text = Plural(kind) + " ×" + g.Count() + " " + what + ": " + names,
                    Consequence = review ? Consequence(kind) : null,
                    Keys = g.Select(a => "h:" + a.Id).ToList(), Id = g.First().Id,
                });
            }
        }

        private static List<Clash> MergeClashes(SimScene scene, SimConflictResult live, SimExactResult e)
        {
            var byKey = new Dictionary<string, Clash>(StringComparer.Ordinal);
            var exactByKey = new Dictionary<string, SimExactClash>(StringComparer.Ordinal);
            foreach (SimExactClash x in e.Clashes) exactByKey[x.Key] = x;

            foreach (SimExactClash x in e.Clashes)
            {
                if (x.State != SimClashState.Confirmed || !x.IsNew) continue;
                byKey[x.Key] = new Clash
                {
                    Key = x.Key, Id = x.Id, Slot = x.Slot, Label = x.Label, Category = x.CategoryName, Kind = x.Kind, Reactive = x.Reactive, Confirmed = true,
                    VolumeCm3 = x.VolumeCm3, Box = x.BoxMm,
                };
            }

            // Урьдчилсан олсон боловч Revit ШАЛГАЖ ЧАДААГҮЙ (бодисгүй / алдаа / жагсаалтад алга) — «батлагдаагүй» гэж үлдээнэ (алдахгүй).
            if (live != null)
            {
                foreach (SimHit h in live.Hits.Where(h => h.IsNew))
                {
                    if (byKey.ContainsKey(h.Key)) continue;
                    SimExactClash x;
                    if (exactByKey.TryGetValue(h.Key, out x))
                    {
                        if (x.State == SimClashState.NoClash) continue;            // Revit-ийн тооцоогоор давхцаагүй — урьдчилсан нь тессел/ойролцоо
                        if (x.State == SimClashState.Confirmed) continue;         // шинэ биш (хөдөлгөөнгүй үеэс байсан)
                    }
                    Clash c = PrelimOf(h);
                    byKey[h.Key] = c;
                }
            }
            return byKey.Values.OrderByDescending(c => c.Confirmed).ThenByDescending(c => c.VolumeCm3).ThenBy(c => c.Label, StringComparer.Ordinal).ToList();
        }

        /* ============================== МӨР ҮҮСГЭХ ========================== */

        private static void AddClashLines(SimReport r, List<Clash> clashes, bool exact)
        {
            if (clashes.Count == 0) return;
            if (clashes.Count <= MaxIndividualClashLines)
            {
                foreach (Clash c in clashes) r.Lines.Add(ClashLine(c, exact));
                return;
            }

            // Олон: ангиллаар бүлэглэнэ.
            foreach (IGrouping<SimKind, Clash> g in clashes.GroupBy(c => c.Kind).OrderByDescending(g => g.Count()))
            {
                if (g.Count() == 1) { r.Lines.Add(ClashLine(g.First(), exact)); continue; }
                string firstNames = string.Join(", ", g.Take(2).Select(c => c.Label)) + (g.Count() > 2 ? " …" : "");
                bool allConfirmed = g.All(c => c.Confirmed);
                r.Lines.Add(new SimLine
                {
                    Code = "clash.group", Severity = SimSeverity.Review, Mark = "🟠", Exact = allConfirmed, Kind = g.Key,
                    Text = Plural(g.Key) + " ×" + g.Count() + " огтлолцоно" + (allConfirmed ? "" : " (зарим нь урьдчилсан)") + ": " + firstNames,
                    Consequence = Consequence(g.Key),
                    Keys = g.Select(c => c.Key).ToList(), Id = g.First().Id, Slot = g.First().Slot,
                });
            }
        }

        private static SimLine ClashLine(Clash c, bool exact)
        {
            string detail = "";
            if (c.Confirmed && c.VolumeCm3 > 0) detail = " (давхцсан эзлэхүүн ≈ " + Volume(c.VolumeCm3) + ")";
            else if (!c.Confirmed && c.DepthMm > 0) detail = " (нэвтрэлт ≈ " + Mm(c.DepthMm) + ")";
            string tail = c.Confirmed ? "" : (exact ? " — урьдчилсан, Revit-ээр баталгаажуулж чадсангүй" : " — урьдчилсан");
            if (!c.Confirmed && c.Volumetric && c.DepthMm <= 0) tail = (exact ? " — урьдчилсан, Revit-ээр баталгаажуулж чадсангүй" : " — урьдчилсан");
            return new SimLine
            {
                Code = c.Confirmed ? "clash" : "clash.prelim", Severity = SimSeverity.Review, Mark = "🟠", Exact = c.Confirmed, Kind = c.Kind,
                Text = "«" + c.Label + "»-тай огтлолцоно" + detail + tail,
                Consequence = Consequence(c.Kind),
                Keys = new List<string> { c.Key }, Id = c.Id, Slot = c.Slot, BoxMm = c.Box,
            };
        }

        private static SimLine ReactiveLine(string key, long id, int slot, string label, SimKind kind, bool exact)
        {
            return new SimLine
            {
                Code = "clash.reactive", Severity = SimSeverity.Info, Mark = "ℹ", Exact = exact, Kind = kind,
                Text = "Нэгдсэн «" + label + "»: Revit төгсгөлийн холбоосыг автоматаар засна",
                Consequence = "Хэмжээ өөрчлөгдөнө — зөөлтийн дараа шалгана уу.",
                Keys = new List<string> { key }, Id = id, Slot = slot,
            };
        }

        /// <summary>Элемент бүрт «юуг дахин хийх / ямар асуудал гарах» — ӨРГӨН ТАЙЛБАР биш, бодит үр дагавар.</summary>
        public static string Consequence(SimKind kind)
        {
            switch (kind)
            {
                case SimKind.Wall: return "Хана хоорондын огтлолцлыг засах: богиносгох/дахин холбох эсвэл зөөлтийг өөрчлөх.";
                case SimKind.Floor: return "Шалны нүх, зүсэлтийг дахин зурах (эсвэл шалыг засах) шаардлагатай.";
                case SimKind.Roof: return "Дээврийн нүх, зүсэлтийг дахин зурах шаардлагатай.";
                case SimKind.Ceiling: return "Таазны хэсгийг дахин зурах шаардлагатай.";
                case SimKind.Door: return "Хаалганы байрлалыг дахин зохиох шаардлагатай.";
                case SimKind.Window: return "Цонхны байрлалыг дахин зохиох шаардлагатай.";
                case SimKind.Column: return "Бүтцийн багана — инженерийн шийдэл (багана зөөх/тойрох) шаардлагатай.";
                case SimKind.Framing: return "Бүтцийн дам нуруу — инженерийн шалгалт, дахин зураг шаардлагатай.";
                case SimKind.Foundation: return "Суурь — бүтцийн хяналт, дахин тооцоо шаардлагатай.";
                case SimKind.Stair: return "Шатыг дахин зурах, гарцын өргөнийг шалгах шаардлагатай.";
                case SimKind.Railing: return "Хашлагыг дахин зурах шаардлагатай.";
                case SimKind.Furniture: return "Тавилгыг дахин байршуулах шаардлагатай.";
                case SimKind.Equipment: return "Тоног төхөөрөмжийг дахин байршуулах шаардлагатай.";
                case SimKind.Duct: return "Агааржуулалтын сувгийг дахин трассчлах (эсвэл нүх гаргах) шаардлагатай.";
                case SimKind.Pipe: return "Хоолойг дахин трассчлах (эсвэл нүх гаргах) шаардлагатай.";
                case SimKind.Conduit: return "Цахилгааны хоолойг дахин трассчлах шаардлагатай.";
                case SimKind.CableTray: return "Кабелийн тавиурыг дахин трассчлах шаардлагатай.";
                case SimKind.Fitting: return "Инженерийн холбох хэсгийг дахин зохиох шаардлагатай.";
                case SimKind.Lighting: return "Гэрэлтүүлгийн байрлалыг шинэчлэх шаардлагатай.";
                case SimKind.Topography: return "Газрын гадаргуутай огтлолцож байна — босоо зураг, газар шорооны ажлыг шалгах.";
                default: return "Огтлолцлыг засч дахин зурах шаардлагатай.";
            }
        }

        /// <summary>Олон тооны нэр (бүлэглэхэд).</summary>
        public static string Plural(SimKind kind)
        {
            switch (kind)
            {
                case SimKind.Wall: return "Хана";
                case SimKind.Floor: return "Шал";
                case SimKind.Roof: return "Дээвэр";
                case SimKind.Ceiling: return "Таазны хэсэг";
                case SimKind.Door: return "Хаалга";
                case SimKind.Window: return "Цонх";
                case SimKind.Column: return "Багана";
                case SimKind.Framing: return "Дам нуруу";
                case SimKind.Foundation: return "Суурь";
                case SimKind.Stair: return "Шат";
                case SimKind.Railing: return "Хашлага";
                case SimKind.Furniture: return "Тавилга";
                case SimKind.Equipment: return "Тоног төхөөрөмж";
                case SimKind.Duct: return "Агааржуулалтын суваг";
                case SimKind.Pipe: return "Хоолой";
                case SimKind.Conduit: return "Цахилгааны хоолой";
                case SimKind.CableTray: return "Кабелийн тавиур";
                case SimKind.Fitting: return "Холбох хэсэг";
                case SimKind.Lighting: return "Гэрэлтүүлэг";
                case SimKind.Topography: return "Газрын гадаргуу";
                default: return "Элемент";
            }
        }

        private static void Sort(SimReport r)
        {
            r.Lines = r.Lines
                .OrderByDescending(l => (int)l.Severity)
                .ThenByDescending(l => l.Exact)
                .ThenBy(l => l.Code, StringComparer.Ordinal)
                .ThenBy(l => l.Text, StringComparer.Ordinal)
                .ToList();
        }

        /* ============================== ФОРМАТ ============================== */

        public static string FormatOffset(SimVec v)
        {
            var parts = new List<string>();
            if (Math.Abs(v.X) >= 0.5) parts.Add("X " + Signed(v.X, "0") + " мм");
            if (Math.Abs(v.Y) >= 0.5) parts.Add("Y " + Signed(v.Y, "0") + " мм");
            if (Math.Abs(v.Z) >= 0.5) parts.Add("Z " + Signed(v.Z, "0") + " мм");
            if (parts.Count == 0) return "0 мм";
            double total = Math.Sqrt(v.X * v.X + v.Y * v.Y + v.Z * v.Z);
            return string.Join(" · ", parts) + (parts.Count > 1 ? " (нийт " + Mm(total) + ")" : "");
        }

        private static string Signed(double v, string fmt)
        {
            string s = Math.Abs(v).ToString(fmt, CultureInfo.InvariantCulture);
            return (v < 0 ? "−" : "+") + s;
        }

        private static string Mm(double mm)
        {
            if (mm >= 10000) return (mm / 1000.0).ToString("0.0", CultureInfo.InvariantCulture) + " м";
            return Math.Round(mm).ToString("0", CultureInfo.InvariantCulture) + " мм";
        }

        private static string M2(double v) { return v.ToString("0.0#", CultureInfo.InvariantCulture); }

        private static string Volume(double cm3)
        {
            if (cm3 >= 10000) return (cm3 / 1000000.0).ToString("0.00", CultureInfo.InvariantCulture) + " м³";
            return Math.Round(cm3).ToString("0", CultureInfo.InvariantCulture) + " см³";
        }
    }
}
