using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>
    /// «Энэ зөөлтийг хийх үү?» гэсэн НЭГ шийдвэр — Revit-гүй ЦЭВЭР.
    ///
    /// ⚠️ Энэ нь МОДЕЛИЙН техникийн нөлөөллийн дүгнэлт.  Хууль, Монгол нормын (БНбД) баталгаа БИШ — норм тусдаа мөрөнд
    /// («Монгол нормын автомат баталгаажуулалт хийгдээгүй.») харагдана; ногоон нь нормын зөвшөөрөл мэт харагдах ёсгүй.
    /// </summary>
    public enum MoveVerdict
    {
        /// <summary>Дүгнэх боломжгүй (шаардлагатай шалгалт дутуу / сэргээлт батлагдаагүй / дэмжигдээгүй) — Apply хаалттай.  Анхдагч = аюулгүй тал.</summary>
        Unknown = 0,
        /// <summary>🟢 Техникийн хувьд зөөж болно: Revit зөвшөөрнө, шаардлагатай бүх шалгалт дууссан, хянах нөлөөлөл алга.</summary>
        MoveOk,
        /// <summary>🟠 Хөдөлгөөн боломжтой, гэхдээ архитекторын хянах (батлагдсан) нөлөөлөл бий.</summary>
        MoveWithReview,
        /// <summary>🔴 Батлагдсан хориглох үр дагавар бий — Apply анхдагчаар хаалттай.</summary>
        DoNotMove,
    }

    public enum CheckState
    {
        Ok = 0,
        /// <summary>Өөрчлөлт/хянах зүйл бий.</summary>
        Review,
        /// <summary>Батлагдсан ноцтой.</summary>
        Alert,
        /// <summary>Гүн шалгалт үргэлжилж байна (түр дүн).</summary>
        Pending,
        /// <summary>Шалгалт бүрэн дууссангүй.</summary>
        Incomplete,
        /// <summary>Хэрэглэгч тохируулаагүй (гарц) — алдаа биш.</summary>
        NotConfigured,
        /// <summary>Тус шалгалт огт байхгүй (норм) эсвэл хийх боломжгүй байсан.</summary>
        NotChecked,
    }

    /// <summary>Шийдвэрийн нэг шалтгаан — хүнд ойлгомжтой ТОВЧ өгүүлбэр + эрэмбэлэх түлхүүрүүд (тодорхойлогдсон).</summary>
    public sealed class DecisionReason
    {
        public string Code { get; set; }
        public string Text { get; set; }
        public PreChangeCategory Category { get; set; }
        public string ItemKey { get; set; }
        public long Id { get; set; }
        public ImpactNodeKind Kind { get; set; }
        /// <summary>Бага = түрүүлж.  Ангилал доторх эрэмбэ.</summary>
        public int Priority { get; set; }
        /// <summary>Нэг ангилал доторх том нь түрүүлнэ (талбайн |өөрчлөлт|).</summary>
        public double Weight { get; set; }
    }

    public sealed class CheckChip
    {
        public string Key { get; set; }
        public string Label { get; set; }
        public CheckState State { get; set; }
        /// <summary>«Өрөө ✓», «Гарц — тохируулаагүй», «Норм — шалгаагүй».</summary>
        public string Text { get; set; }
        /// <summary>Загварын шалгалтаас ТУСДАА (норм) — UI өөр хэв маягаар харуулна.</summary>
        public bool Separate { get; set; }
    }

    public sealed class MoveDecision
    {
        public MoveVerdict Verdict { get; set; }
        public AnalysisStage Stage { get; set; }
        /// <summary>Түр дүн: гүн шалгалт (MEP, гарц...) дуусаагүй — ЭЦСИЙН «ногоон» харуулахгүй.</summary>
        public bool IsPending { get; set; }
        public bool IsFinal { get { return Stage == AnalysisStage.Full; } }
        /// <summary>🟢 🟠 🔴 ⚪ — тэмдэг ГАНЦААРАА биш: `Title` үгээр заавал дагалдана.</summary>
        public string Mark { get; set; }
        public string Title { get; set; }
        public string Subtitle { get; set; }
        public DecisionReason Primary { get; set; }
        /// <summary>Дээд тал нь 3 — тодорхойлогдсон дарааллаар.</summary>
        public List<DecisionReason> Top { get; set; } = new List<DecisionReason>();
        public List<DecisionReason> Blocking { get; set; } = new List<DecisionReason>();
        public List<DecisionReason> UnknownReasons { get; set; } = new List<DecisionReason>();
        public List<DecisionReason> ReviewReasons { get; set; } = new List<DecisionReason>();
        public List<CheckChip> Checks { get; set; } = new List<CheckChip>();
        /// <summary>«Моделийн нөлөөлөл: ✓ шалгасан» — нормоос ТУСДАА мөр.</summary>
        public string ModelLine { get; set; }
        /// <summary>«Монгол норм: — автомат шалгалт хийгдээгүй» — ХЭЗЭЭ Ч «шалгасан» мэт харагдахгүй.</summary>
        public string NormLine { get; set; }
        /// <summary>⚠️ Загвар анхны төлөвт буцсан эсэх батлагдаагүй — хэрэглэгч ЗААВАЛ Ctrl+Z-ээр шалгана.</summary>
        public bool ModelMayBeModified { get; set; }
        public RejectionKind Rejection { get; set; }

        public bool CanBeApplied
        {
            get { return IsFinal && !IsPending && (Verdict == MoveVerdict.MoveOk || Verdict == MoveVerdict.MoveWithReview); }
        }

        public CheckChip Chip(string key) { return Checks.FirstOrDefault(c => c.Key == key); }
    }

    /// <summary>
    /// Шийдвэрийн хөдөлгүүр.  Тодорхойлогдсон: ижил тайлан → ижил шийдвэр, ижил шалтгааны дараалал.
    ///
    ///   ДАРААЛАЛ:  Revit татгалзсан/хана хүчингүй → 🔴  ·  сэргээлт батлагдаагүй/дэмжигдээгүй/хэрэгслийн алдаа → ⚪
    ///              ·  (симуляц амжилттай) батлагдсан ноцтой → 🔴  ·  ШААРДЛАГАТАЙ шалгалт дутуу → ⚪  ·  батлагдсан/хянах нөлөөлөл → 🟠  ·  үгүй бол 🟢
    ///
    ///   • «Норм шалгаагүй» ба «гарц тохируулаагүй» нь шийдвэрийг ХЭЗЭЭ Ч өөрчлөхгүй (тусдаа чип).  Харин гарц ТОХИРУУЛСАН хэрнээ тооцоо унавал ⚪.
    ///   • Quick (түр) шатанд «🟢» ХЭЗЭЭ Ч гарахгүй — «Шалгаж байна…» (⚪ + IsPending).
    /// </summary>
    public static class PreChangeDecisionEngine
    {
        public const string NormAutoNotDone = "Монгол нормын автомат баталгаажуулалт хийгдээгүй.";
        public const string ModelOnlyNote = "Энэ нь моделийн техникийн дүгнэлт — хууль, Монгол нормын зөвшөөрөл биш.";
        public const string NormLineText = "Монгол норм: — автомат шалгалт хийгдээгүй";

        public static MoveDecision Decide(PreChangeReport r)
        {
            var d = new MoveDecision { NormLine = NormLineText };
            if (r == null)
            {
                d.Verdict = MoveVerdict.Unknown;
                d.Stage = AnalysisStage.Full;
                Finish(d, "Нөлөөллийг хараахан шалгаагүй байна.");
                d.ModelLine = "Моделийн нөлөөлөл: — шалгаагүй";
                return d;
            }

            d.Stage = r.Stage;
            d.Rejection = r.Rejection;
            bool quick = r.Stage == AnalysisStage.Quick;

            if (r.Outcome != SandboxOutcome.Simulated)
            {
                DecideNotSimulated(r, d);
                d.Checks = ChipsNotSimulated(r);
                return d;
            }

            // ---- симуляц амжилттай
            d.Blocking = BlockingReasons(r);
            d.UnknownReasons = r.RequiredIncomplete.Select((t, i) => new DecisionReason
            {
                Code = "incomplete.required", Text = t, Category = PreChangeCategory.Model, Priority = i,
            }).ToList();
            d.ReviewReasons = ReviewReasonsOf(r);

            if (d.Blocking.Count > 0) d.Verdict = MoveVerdict.DoNotMove;
            else if (d.UnknownReasons.Count > 0) d.Verdict = MoveVerdict.Unknown;
            else if (d.ReviewReasons.Count > 0) d.Verdict = MoveVerdict.MoveWithReview;
            else d.Verdict = MoveVerdict.MoveOk;

            d.IsPending = quick;
            // Түр шатанд ногоон гарахгүй: ямар ч хүндрэл олдоогүй ч гүн шалгалт (MEP, гарц...) хүлээгдэж байна.
            bool pendingNeutral = quick && d.Verdict == MoveVerdict.MoveOk;
            if (pendingNeutral) d.Verdict = MoveVerdict.Unknown;

            List<DecisionReason> pool = d.Verdict == MoveVerdict.DoNotMove ? d.Blocking
                : d.Verdict == MoveVerdict.Unknown && !pendingNeutral ? d.UnknownReasons
                : d.Verdict == MoveVerdict.MoveWithReview ? d.ReviewReasons
                : new List<DecisionReason>();
            d.Top = Order(pool).Take(3).ToList();
            d.Primary = d.Top.FirstOrDefault();

            d.Checks = Chips(r, quick);
            Compose(r, d, pendingNeutral);
            return d;
        }

        /* ============================== SIMULATED БИШ ======================== */

        private static void DecideNotSimulated(PreChangeReport r, MoveDecision d)
        {
            string first = r.BlockReasons.FirstOrDefault(s => !string.IsNullOrWhiteSpace(s));
            d.IsPending = false;
            d.Stage = AnalysisStage.Full;
            d.ModelLine = "Моделийн нөлөөлөл: — шалгаагүй";
            switch (r.Outcome)
            {
                case SandboxOutcome.NotRestored:
                    d.Verdict = MoveVerdict.Unknown;
                    d.ModelMayBeModified = true;
                    d.Primary = Reason("restore.unknown", first ?? "Загвар анхны төлөвт буцсаныг баталгаажуулж чадсангүй.", PreChangeCategory.Failure, 0);
                    d.UnknownReasons.Add(d.Primary);
                    break;
                case SandboxOutcome.Blocked:
                    d.Verdict = MoveVerdict.DoNotMove;
                    d.Primary = Reason("move.refused", first ?? "Revit энэ хөдөлгөөнийг зөвшөөрөөгүй.", PreChangeCategory.Failure, 0);
                    d.Blocking.Add(d.Primary);
                    break;
                case SandboxOutcome.Rejected:
                    if (r.Rejection == RejectionKind.Refused)
                    {
                        d.Verdict = MoveVerdict.DoNotMove;
                        d.Primary = Reason("move.refused", first ?? "Revit энэ " + PreChangeOperations.Accusative(PreChangeOperations.Of(r.Request)) + " зөөхийг зөвшөөрөхгүй.", PreChangeCategory.Failure, 0);
                        d.Blocking.Add(d.Primary);
                    }
                    else
                    {
                        d.Verdict = MoveVerdict.Unknown;
                        d.Primary = Reason("check.unsupported", first ?? "Энэ " + PreChangeOperations.Accusative(PreChangeOperations.Of(r.Request)) + " шалгах боломжгүй.", PreChangeCategory.Failure, 0);
                        d.UnknownReasons.Add(d.Primary);
                    }
                    break;
                default:    // Faulted, Unknown
                    d.Verdict = MoveVerdict.Unknown;
                    d.Primary = Reason("check.faulted", first ?? "Шалгалт дуусаагүй (хэрэгслийн алдаа) — загвар өөрчлөгдөөгүй.", PreChangeCategory.Failure, 0);
                    d.UnknownReasons.Add(d.Primary);
                    break;
            }
            d.Top = new List<DecisionReason> { d.Primary };
            Compose(r, d, false);
            d.ModelLine = "Моделийн нөлөөлөл: — шалгаагүй";
        }

        private static DecisionReason Reason(string code, string text, PreChangeCategory cat, int priority)
        {
            return new DecisionReason { Code = code, Text = text, Category = cat, Priority = priority };
        }

        /* ============================== ХОРИГЛОХ (🔴) ======================== */

        private static int BlockingPriority(string code)
        {
            switch (code)
            {
                case ItemCodes.SourceMissing: return 0;
                case ItemCodes.DoorLost: return 0;
                case ItemCodes.ModelDeleted: return 1;
                case ItemCodes.DoorOutsideHost: return 1;
                case ItemCodes.RoomUnenclosed: return 2;
                case ItemCodes.RoomRemoved: return 3;
                case ItemCodes.HostDeleted: return 4;
                case ItemCodes.HostLost: return 5;
                case ItemCodes.DoorOpeningOverlap: return 5;
                case ItemCodes.DoorStructureClash: return 6;
                case ItemCodes.ClashNew: return 6;
                case ItemCodes.EgressLost: return 7;
                case ItemCodes.DimDeleted: return 8;
                case ItemCodes.FailureError: return 9;
                default: return 10;
            }
        }

        private static List<DecisionReason> BlockingReasons(PreChangeReport r)
        {
            var list = new List<DecisionReason>();
            var critical = r.Items.Where(i => i.Truth == TruthState.Confirmed && i.Severity == ItemSeverity.Critical).ToList();

            // Шинэ MEP clash — олон бол НЭГ нэгтгэсэн шалтгаан (дэлгэрэнгүй нь MEP картанд).
            List<PreChangeItem> clashes = critical.Where(i => i.Code == ItemCodes.ClashNew).OrderBy(i => i.Subject ?? "", StringComparer.Ordinal).ToList();
            if (clashes.Count == 1)
                list.Add(FromItem(clashes[0], Subj(clashes[0]) + "-тай шинэ clash үүснэ."));
            else if (clashes.Count > 1)
            {
                DecisionReason agg = FromItem(clashes[0], clashes.Count + " шинэ MEP clash үүснэ (" + Subj(clashes[0]) + " г.м.).");
                list.Add(agg);
            }

            foreach (PreChangeItem i in critical.Where(x => x.Code != ItemCodes.ClashNew))
                list.Add(FromItem(i, BlockingText(i)));
            return Order(list).ToList();
        }

        private static string Subj(PreChangeItem i)
        {
            return string.IsNullOrWhiteSpace(i.Subject) ? (i.Title ?? "элемент") : i.Subject;
        }

        private static string BlockingText(PreChangeItem i)
        {
            switch (i.Code)
            {
                case ItemCodes.SourceMissing: return "Хана өөрөө загварт алга болно.";
                case ItemCodes.DoorLost: return "Хаалга өөрөө загварт алга болно.";
                case ItemCodes.ModelDeleted: return Subj(i) + " элемент устна.";
                case ItemCodes.RoomUnenclosed: return Subj(i) + ": хаалттай орон зай байхаа болино.";
                case ItemCodes.RoomRemoved: return Subj(i) + " өрөө алга болно.";
                case ItemCodes.HostDeleted: return Subj(i) + " устна.";
                case ItemCodes.HostLost: return Subj(i) + " ханаасаа сална (хостоо алдана).";
                case ItemCodes.EgressLost: return Subj(i) + ": гарц руу зам тасарна.";
                case ItemCodes.DimDeleted: return Subj(i) + " хэмжээс устна.";
                case ItemCodes.FailureError: return string.IsNullOrWhiteSpace(i.Why) ? "Revit алдаа гаргана." : "Revit алдаа: " + i.Why;
                default: return string.IsNullOrWhiteSpace(i.Title) ? "Батлагдсан ноцтой нөлөөлөл." : i.Title;
            }
        }

        private static DecisionReason FromItem(PreChangeItem i, string text)
        {
            return new DecisionReason
            {
                Code = i.Code ?? "item.critical", Text = text, Category = i.Category, ItemKey = i.Key, Id = i.Id, Kind = i.Kind,
                Priority = BlockingPriority(i.Code), Weight = Math.Abs(i.DeltaValue ?? 0),
            };
        }

        /* ============================== ХЯНАХ (🟠) =========================== */

        private static bool IsReviewWorthy(PreChangeItem i)
        {
            if (i.Truth == TruthState.Confirmed && i.Severity == ItemSeverity.Critical) return false;      // 🔴-д
            switch (i.Code)
            {
                case ItemCodes.HostMoved:           // хаалга/цонх ханатайгаа хамт — архитекторт харагдах нөлөөлөл
                case ItemCodes.View:
                case ItemCodes.Sheet:
                case ItemCodes.ScheduleReview:
                case ItemCodes.ScheduleChanged:
                case ItemCodes.DimReview:
                    return true;
                case ItemCodes.ClashOld:
                case ItemCodes.ClashNone:
                case ItemCodes.ClashResolved:       // clash арилах нь сайн мэдээ; өөрөө хянах шаардлагагүй
                case ItemCodes.DimUnchanged:
                case ItemCodes.Tags:
                case ItemCodes.NormNe:
                case ItemCodes.ClashNe:
                case ItemCodes.EgressNe:
                case ItemCodes.EgressNotConfigured:
                case ItemCodes.ClearanceNe:
                case ItemCodes.ScheduleNe:
                case ItemCodes.ClashIncomplete:
                    return false;
            }
            if (i.Truth == TruthState.Confirmed) return i.Severity >= ItemSeverity.Notice;
            if (i.Truth == TruthState.Review) return i.Severity >= ItemSeverity.Notice;
            return false;
        }

        /// <summary>`ReviewReasonsOf` өөрийн шалтгааныг тусгайлан бүтээдэг кодууд (бусад нь 11b-ийн хамгаалалтаар нэгтгэгдэнэ).</summary>
        private static readonly HashSet<string> HandledReviewCodes = new HashSet<string>(StringComparer.Ordinal)
        {
            ItemCodes.RoomArea, ItemCodes.RoomCreated, ItemCodes.RoomEnclosed, ItemCodes.HostDisplaced, ItemCodes.ClashUnknown,
            ItemCodes.EgressChanged, ItemCodes.EgressGained, ItemCodes.EgressUnreachable, ItemCodes.ClearanceChanged,
            ItemCodes.DimChanged, ItemCodes.DimReview, ItemCodes.Sheet, ItemCodes.ScheduleChanged, ItemCodes.ScheduleReview,
            ItemCodes.HostMoved, ItemCodes.JoinedMoved, ItemCodes.View, ItemCodes.FailureWarning, ItemCodes.HostRooms,
            // Хаалга зөөх — доор тусгайлан боловсруулагдана (DoorRoomAffected нь DoorRoomsChanged-ийн дэд мөр: тусдаа шалтгаан үүсгэхгүй).
            ItemCodes.DoorDeviated, ItemCodes.DoorFlip, ItemCodes.DoorOpeningUnverified, ItemCodes.DoorWallEnd, ItemCodes.DoorPathCrossing,
            ItemCodes.DoorObstacleCandidate, ItemCodes.DoorFurnitureClash, ItemCodes.DoorRoomsChanged, ItemCodes.DoorRoomAffected,
        };

        private static List<DecisionReason> ReviewReasonsOf(PreChangeReport r)
        {
            var list = new List<DecisionReason>();
            List<PreChangeItem> items = r.Items.Where(IsReviewWorthy).ToList();

            // 1. Өрөө — |талбайн өөрчлөлт| ихээс бага руу.
            foreach (PreChangeItem i in items.Where(x => x.Code == ItemCodes.RoomArea || x.Code == ItemCodes.RoomCreated || x.Code == ItemCodes.RoomEnclosed))
            {
                string text = i.Code == ItemCodes.RoomArea ? Subj(i) + ": " + i.Delta
                    : i.Code == ItemCodes.RoomCreated ? Subj(i) + ": шинэ өрөө үүснэ"
                    : Subj(i) + ": шинээр хаалттай болно";
                list.Add(new DecisionReason
                {
                    Code = i.Code, Text = text, Category = PreChangeCategory.Room, ItemKey = i.Key, Id = i.Id, Kind = i.Kind,
                    Priority = 10, Weight = Math.Abs(i.DeltaValue ?? i.AfterValue ?? i.BeforeValue ?? 0),
                });
            }

            // 2. Ханаас өөр хэмжээгээр хөдөлсөн хаалга/цонх.
            List<PreChangeItem> displaced = items.Where(x => x.Code == ItemCodes.HostDisplaced).ToList();
            if (displaced.Count > 0)
                list.Add(Agg(ItemCodes.HostDisplaced, displaced.Count + " хаалга/цонх ханаас ӨӨР хэмжээгээр хөдөлнө", PreChangeCategory.Hosted, 15, displaced[0]));

            // 3. Clash-ийн шинэ эсэх батлагдаагүй.
            List<PreChangeItem> unk = items.Where(x => x.Code == ItemCodes.ClashUnknown).ToList();
            if (unk.Count > 0)
                list.Add(Agg(ItemCodes.ClashUnknown, unk.Count + " MEP огтлолцол шинэ эсэх батлагдсангүй", PreChangeCategory.Clash, 18, unk[0]));

            // 4. Гарцын зам.
            foreach (PreChangeItem i in items.Where(x => x.Code == ItemCodes.EgressChanged || x.Code == ItemCodes.EgressGained || x.Code == ItemCodes.EgressUnreachable))
            {
                string text = i.Code == ItemCodes.EgressChanged ? "Гарцын зам " + Subj(i) + ": " + i.Delta
                    : i.Code == ItemCodes.EgressGained ? Subj(i) + ": гарц руу зам нээгдэнэ"
                    : Subj(i) + ": гарц руу зам олдохгүй (өмнө ч байгаагүй)";
                list.Add(new DecisionReason
                {
                    Code = i.Code, Text = text, Category = PreChangeCategory.Egress, ItemKey = i.Key, Id = i.Id, Kind = i.Kind,
                    Priority = 20, Weight = Math.Abs(i.DeltaValue ?? 0),
                });
            }

            // 5. Хаалганы орчны зай.
            foreach (PreChangeItem i in items.Where(x => x.Code == ItemCodes.ClearanceChanged))
                list.Add(new DecisionReason
                {
                    Code = i.Code, Text = Subj(i) + ": орчны зай " + i.Delta, Category = PreChangeCategory.Clearance, ItemKey = i.Key, Id = i.Id, Kind = i.Kind,
                    Priority = 30, Weight = Math.Abs(i.DeltaValue ?? 0),
                });

            // 6. Хэмжээс.
            List<PreChangeItem> dims = items.Where(x => x.Code == ItemCodes.DimChanged).ToList();
            if (dims.Count > 0) list.Add(Agg(ItemCodes.DimChanged, dims.Count + " хэмжээс шинэчлэгдэнэ", PreChangeCategory.Dimension, 40, dims[0]));
            List<PreChangeItem> dimRev = items.Where(x => x.Code == ItemCodes.DimReview).ToList();
            if (dimRev.Count > 0) list.Add(Agg(ItemCodes.DimReview, dimRev.Count + " хэмжээсийг гараар хянана", PreChangeCategory.Dimension, 41, dimRev[0]));

            // 7. Хуудас.
            List<string> nums = items.Where(x => x.Code == ItemCodes.Sheet).Select(x => x.SheetNumber).Where(n => !string.IsNullOrWhiteSpace(n))
                .Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(n => n, StringComparer.OrdinalIgnoreCase).ToList();
            int sheetTotal = Math.Max(r.DistinctSheetCount, Math.Max(nums.Count, items.Count(x => x.Code == ItemCodes.Sheet)));
            if (sheetTotal > 0)
            {
                string text = nums.Count > 0
                    ? string.Join(", ", nums.Take(3)) + (sheetTotal > Math.Min(3, nums.Count) ? " +" + (sheetTotal - Math.Min(3, nums.Count)) : "") + " хуудас хянана"
                    : sheetTotal + " хуудас хянана";
                list.Add(Agg(ItemCodes.Sheet, text, PreChangeCategory.Sheet, 50, items.FirstOrDefault(x => x.Code == ItemCodes.Sheet)));
            }

            // 8. Хүснэгт.
            List<PreChangeItem> sched = items.Where(x => x.Code == ItemCodes.ScheduleChanged || x.Code == ItemCodes.ScheduleReview).ToList();
            if (sched.Count > 0) list.Add(Agg(ItemCodes.ScheduleChanged, sched.Count + " хүснэгт хянана", PreChangeCategory.Schedule, 60, sched[0]));

            // 9. Хамт хөдөлсөн хаалга/цонх.
            List<PreChangeItem> moved = items.Where(x => x.Code == ItemCodes.HostMoved).ToList();
            if (moved.Count > 0) list.Add(Agg(ItemCodes.HostMoved, moved.Count + " хаалга/цонх ханатайгаа хамт хөдөлнө", PreChangeCategory.Hosted, 70, moved[0]));

            // 10. Холбогдсон хана.
            List<PreChangeItem> joined = items.Where(x => x.Code == ItemCodes.JoinedMoved).ToList();
            if (joined.Count > 0) list.Add(Agg(ItemCodes.JoinedMoved, joined.Count + " холбогдсон хана өөрчлөгдөнө", PreChangeCategory.Hosted, 80, joined[0]));

            // 11. Харагдац.
            List<PreChangeItem> views = items.Where(x => x.Code == ItemCodes.View).ToList();
            if (views.Count > 0) list.Add(Agg(ItemCodes.View, views.Count + " харагдац хянана", PreChangeCategory.View, 90, views[0]));

            // 11a. Revit-ийн анхааруулга (preview-д `DeleteWarning`-оор залгигдсан ч Apply-д Revit хэрэглэгчид харуулна) ба хаалганы From/To өрөө солигдох.
            //      ⚠️ Өмнө нь `IsReviewWorthy` энэ мөрүүдийг «хянах» гэж үздэг боловч шалтгаан үүсгэдэггүй байсан тул шийдвэр ХУДЛАА 🟢 болдог байв.
            List<PreChangeItem> warns = items.Where(x => x.Code == ItemCodes.FailureWarning).ToList();
            if (warns.Count > 0)
                list.Add(Agg(ItemCodes.FailureWarning, warns.Count == 1 ? "Revit анхааруулга: " + (string.IsNullOrWhiteSpace(warns[0].Why) ? "хөдөлгөөн анхааруулга гаргана" : warns[0].Why)
                    : warns.Count + " Revit анхааруулга гарна", PreChangeCategory.Failure, 12, warns[0]));
            List<PreChangeItem> hostRooms = items.Where(x => x.Code == ItemCodes.HostRooms).ToList();
            if (hostRooms.Count > 0)
                list.Add(Agg(ItemCodes.HostRooms, hostRooms.Count + " хаалганы From/To өрөө өөрчлөгдөнө", PreChangeCategory.Hosted, 16, hostRooms[0]));

            // 11a'. ХААЛГА ЗӨӨХ — тусгай шалтгаанууд (үйлдэл бүр өөрийн хэлээр; хана зөөхөд эдгээр код үүсэхгүй).
            DoorReviewReasons(items, list);

            // 11b. БАРИХ ХАМГААЛАЛТ: «хянах» гэж үнэлэгдсэн ямар ч мөр шалтгаангүй үлдэж, шийдвэрийг 🟢 болгож БОЛОХГҮЙ.
            //      Дээр нэрлэж боловсруулаагүй код бүр өөрийн нэр/гарчгаараа нэгтгэгдэнэ.
            foreach (IGrouping<string, PreChangeItem> g in items.Where(x => !HandledReviewCodes.Contains(x.Code ?? "")).GroupBy(x => x.Code ?? "item.review"))
            {
                PreChangeItem first = g.First();
                string t = string.IsNullOrWhiteSpace(first.Title) ? g.Key : first.Title;
                list.Add(Agg(g.Key, g.Count() == 1 ? t : g.Count() + " × " + t, first.Category, 85, first));
            }

            // 12. Зөвхөн «хянах» шаарддаг дутагдал (ногоон болгохгүй).
            int k = 0;
            foreach (string a in r.AdvisoryIncomplete)
                list.Add(new DecisionReason { Code = "incomplete.advisory", Text = "Бүрэн биш: " + a, Category = PreChangeCategory.Model, Priority = 100 + (k++) });

            return Order(list).ToList();
        }

        private static void DoorReviewReasons(List<PreChangeItem> items, List<DecisionReason> list)
        {
            List<PreChangeItem> dev = items.Where(x => x.Code == ItemCodes.DoorDeviated).ToList();
            if (dev.Count > 0) list.Add(Agg(ItemCodes.DoorDeviated, dev[0].Title, PreChangeCategory.Hosted, 11, dev[0]));

            List<PreChangeItem> furn = items.Where(x => x.Code == ItemCodes.DoorFurnitureClash).OrderBy(x => x.Subject ?? "", StringComparer.Ordinal).ToList();
            if (furn.Count == 1) list.Add(Agg(ItemCodes.DoorFurnitureClash, Subj(furn[0]) + ": хаалганы геометртэй огтлолцоно (геометрээр батлагдсан)", PreChangeCategory.Obstacle, 13, furn[0]));
            else if (furn.Count > 1)
                list.Add(Agg(ItemCodes.DoorFurnitureClash, furn.Count + " тавилга/төхөөрөмж хаалгатай огтлолцоно (" + Subj(furn[0]) + " г.м.)", PreChangeCategory.Obstacle, 13, furn[0]));

            List<PreChangeItem> unv = items.Where(x => x.Code == ItemCodes.DoorOpeningUnverified).ToList();
            if (unv.Count > 0)
                list.Add(Agg(ItemCodes.DoorOpeningUnverified, unv.Count == 1 ? unv[0].Title : unv.Count + " нүхтэй давхцах эсэх батлагдсангүй", PreChangeCategory.Opening, 14, unv[0]));

            List<PreChangeItem> rooms = items.Where(x => x.Code == ItemCodes.DoorRoomsChanged).ToList();
            if (rooms.Count > 0)
            {
                PreChangeItem rc = rooms[0];
                string pair = !string.IsNullOrEmpty(rc.Before) || !string.IsNullOrEmpty(rc.After) ? " (" + (rc.Before ?? PreChangeText.Unknown) + " → " + (rc.After ?? PreChangeText.Unknown) + ")" : "";
                list.Add(Agg(ItemCodes.DoorRoomsChanged, Subj(rc) + ": From/To өрөө өөрчлөгдөнө" + pair, PreChangeCategory.Hosted, 16, rc));
            }

            // «Өрөө өөрчлөгдсөн» нэгтгэсэн мөр байхгүй ч өрөөний дэд мөр ганцаараа ирвэл шалтгаангүй үлдэж 🟢 болгож БОЛОХГҮЙ.
            if (rooms.Count == 0)
            {
                List<PreChangeItem> aff = items.Where(x => x.Code == ItemCodes.DoorRoomAffected).OrderBy(x => x.Id).ToList();
                if (aff.Count > 0)
                    list.Add(Agg(ItemCodes.DoorRoomAffected, aff.Count == 1 ? aff[0].Title : aff.Count + " өрөөний From/To шинэчлэгдэнэ", PreChangeCategory.Room, 16, aff[0]));
            }

            List<PreChangeItem> cand = items.Where(x => x.Code == ItemCodes.DoorObstacleCandidate).ToList();
            if (cand.Count > 0)
                list.Add(Agg(ItemCodes.DoorObstacleCandidate,
                    cand.Count == 1 ? Subj(cand[0]) + " хаалганы байрлалд ойр — геометрээр батлагдаагүй" : cand.Count + " элемент хаалганы байрлалд ойр — геометрээр батлагдаагүй (" + Subj(cand[0]) + " г.м.)",
                    PreChangeCategory.Obstacle, 17, cand[0]));

            List<PreChangeItem> flip = items.Where(x => x.Code == ItemCodes.DoorFlip).ToList();
            if (flip.Count > 0) list.Add(Agg(ItemCodes.DoorFlip, flip[0].Title, PreChangeCategory.Hosted, 19, flip[0]));

            List<PreChangeItem> end = items.Where(x => x.Code == ItemCodes.DoorWallEnd).ToList();
            if (end.Count > 0) list.Add(Agg(ItemCodes.DoorWallEnd, end[0].Title, PreChangeCategory.Opening, 21, end[0]));

            List<PreChangeItem> path = items.Where(x => x.Code == ItemCodes.DoorPathCrossing).ToList();
            if (path.Count > 0)
                list.Add(Agg(ItemCodes.DoorPathCrossing, path.Count == 1 ? path[0].Title : path.Count + " нүхийг дайран зөөгдөнө — дараалал солигдоно", PreChangeCategory.Opening, 22, path[0]));
        }

        private static DecisionReason Agg(string code, string text, PreChangeCategory cat, int priority, PreChangeItem first)
        {
            return new DecisionReason
            {
                Code = code, Text = text, Category = cat, Priority = priority,
                ItemKey = first != null ? first.Key : null, Id = first != null ? first.Id : 0, Kind = first != null ? first.Kind : ImpactNodeKind.Element,
            };
        }

        /// <summary>Тодорхойлогдсон эрэмбэ: Priority ↑, Weight ↓, Text (ordinal) ↑.</summary>
        private static IEnumerable<DecisionReason> Order(IEnumerable<DecisionReason> reasons)
        {
            return reasons.OrderBy(x => x.Priority).ThenByDescending(x => x.Weight).ThenBy(x => x.Text ?? "", StringComparer.Ordinal);
        }

        /* ============================== ТЭМДЭГ, ТЕКСТ ======================== */

        private static void Compose(PreChangeReport r, MoveDecision d, bool pendingNeutral)
        {
            bool quick = d.IsPending;
            if (pendingNeutral)
            {
                Finish(d, "Түр дүн: одоогоор хүндрэл илрээгүй — MEP, гарц, хуудсыг шалгаж байна.");
                d.Mark = "⚪"; d.Title = "ШАЛГАЖ БАЙНА…";
                d.ModelLine = "Моделийн нөлөөлөл: … гүн шалгалт үргэлжилж байна";
                return;
            }

            switch (d.Verdict)
            {
                case MoveVerdict.MoveOk:
                    Finish(d, "Техникийн хувьд зөөж болно — шалгасан бүх зүйлд өөрчлөлт илрээгүй.");
                    d.ModelLine = "Моделийн нөлөөлөл: ✓ шалгасан";
                    break;
                case MoveVerdict.MoveWithReview:
                    Finish(d, "Хөдөлгөөн боломжтой, " + d.ReviewReasons.Count + " зүйл хянана.");
                    d.ModelLine = quick ? "Моделийн нөлөөлөл: … түр дүн" : "Моделийн нөлөөлөл: ✓ шалгасан";
                    break;
                case MoveVerdict.DoNotMove:
                    Finish(d, d.Primary != null ? d.Primary.Text + (d.Blocking.Count > 1 ? "  (+" + (d.Blocking.Count - 1) + " өөр)" : "") : "Батлагдсан ноцтой үр дагавар бий.");
                    d.ModelLine = r != null && r.Outcome != SandboxOutcome.Simulated ? "Моделийн нөлөөлөл: — шалгаагүй" : (quick ? "Моделийн нөлөөлөл: … түр дүн" : "Моделийн нөлөөлөл: ✓ шалгасан");
                    break;
                default:
                    Finish(d, d.Primary != null ? d.Primary.Text : "Шаардлагатай шалгалт дуусаагүй.");
                    d.ModelLine = "Моделийн нөлөөлөл: ? бүрэн шалгаж чадсангүй";
                    break;
            }
        }

        private static void Finish(MoveDecision d, string subtitle)
        {
            switch (d.Verdict)
            {
                case MoveVerdict.MoveOk: d.Mark = "🟢"; d.Title = "ТЕХНИКИЙН ХУВЬД ЗӨӨЖ БОЛНО"; break;
                case MoveVerdict.MoveWithReview: d.Mark = "🟠"; d.Title = "ХЯНААД ЗӨӨ"; break;
                case MoveVerdict.DoNotMove: d.Mark = "🔴"; d.Title = "ЗӨӨХГҮЙ"; break;
                default: d.Mark = "⚪"; d.Title = "ДҮГНЭХ БОЛОМЖГҮЙ"; break;
            }
            d.Subtitle = subtitle;
        }

        /* ============================== ЧИП (төлөвийн мөр) ================== */

        private static CheckChip Chip(string key, string label, CheckState st, string suffix, bool separate = false)
        {
            return new CheckChip { Key = key, Label = label, State = st, Text = label + " " + suffix, Separate = separate };
        }

        private static List<CheckChip> ChipsNotSimulated(PreChangeReport r)
        {
            var chips = new List<CheckChip>
            {
                Chip("rooms", "Өрөө", CheckState.NotChecked, "—"),
                Chip("dimensions", "Хэмжээс", CheckState.NotChecked, "—"),
                Chip("mep", "MEP", CheckState.NotChecked, "—"),
                Chip("egress", "Гарц", CheckState.NotChecked, "—"),
                Chip("sheets", "Хуудас", CheckState.NotChecked, "—"),
                NormChip(),
            };
            return chips;
        }

        private static CheckChip NormChip()
        {
            return new CheckChip { Key = "norm", Label = "Норм", State = CheckState.NotChecked, Text = "Норм — шалгаагүй", Separate = true };
        }

        private static List<CheckChip> Chips(PreChangeReport r, bool quick)
        {
            PreChangeCoverage cov = r.Coverage ?? new PreChangeCoverage();
            var chips = new List<CheckChip>();

            bool roomAlert = r.Items.Any(i => i.Category == PreChangeCategory.Room && i.Truth == TruthState.Confirmed && i.Severity == ItemSeverity.Critical);
            chips.Add(!cov.RoomsChecked ? Chip("rooms", "Өрөө", CheckState.Incomplete, "?")
                : roomAlert ? Chip("rooms", "Өрөө", CheckState.Alert, "✕")
                : Chip("rooms", "Өрөө", CheckState.Ok, "✓"));

            bool dimAlert = r.Items.Any(i => i.Category == PreChangeCategory.Dimension && i.Truth == TruthState.Confirmed && i.Severity == ItemSeverity.Critical);
            chips.Add(!cov.DimensionsChecked ? Chip("dimensions", "Хэмжээс", CheckState.Incomplete, "?")
                : dimAlert ? Chip("dimensions", "Хэмжээс", CheckState.Alert, "✕")
                : Chip("dimensions", "Хэмжээс", CheckState.Ok, "✓"));

            // MEP
            int newClash = PreChangeDiff.NewClashCount(r);
            if (quick) chips.Add(Chip("mep", "MEP", CheckState.Pending, "…"));
            else if (newClash > 0) chips.Add(Chip("mep", "MEP", CheckState.Alert, "✕"));
            else if (!cov.ClashEvaluated) chips.Add(Chip("mep", "MEP", CheckState.Incomplete, "?"));
            else if (!cov.ClashComplete) chips.Add(Chip("mep", "MEP", CheckState.Incomplete, "бүрэн биш"));
            else chips.Add(Chip("mep", "MEP", CheckState.Ok, "✓"));

            // Гарц — тохируулаагүй нь алдаа БИШ.
            bool egressAlert = r.Items.Any(i => i.Category == PreChangeCategory.Egress && i.Truth == TruthState.Confirmed && i.Severity == ItemSeverity.Critical);
            if (!cov.EgressConfigured) chips.Add(new CheckChip { Key = "egress", Label = "Гарц", State = CheckState.NotConfigured, Text = "Гарц — тохируулаагүй" });
            else if (quick) chips.Add(Chip("egress", "Гарц", CheckState.Pending, "…"));
            else if (egressAlert) chips.Add(Chip("egress", "Гарц", CheckState.Alert, "✕"));
            else if (!cov.EgressEvaluated) chips.Add(Chip("egress", "Гарц", CheckState.Incomplete, "?"));
            else chips.Add(Chip("egress", "Гарц", CheckState.Ok, "✓"));

            // Хуудас
            int sheets = Math.Max(r.DistinctSheetCount, r.Items.Where(i => i.Code == ItemCodes.Sheet).Select(i => i.Id).Distinct().Count());
            if (!cov.ViewsChecked) chips.Add(Chip("sheets", "Хуудас", CheckState.Incomplete, "?"));
            else if (quick) chips.Add(Chip("sheets", "Хуудас", CheckState.Pending, sheets > 0 ? sheets.ToString(CultureInfo.InvariantCulture) + "…" : "…"));
            else if (sheets > 0) chips.Add(Chip("sheets", "Хуудас", CheckState.Review, sheets.ToString(CultureInfo.InvariantCulture)));
            else chips.Add(Chip("sheets", "Хуудас", CheckState.Ok, "✓"));

            chips.Add(NormChip());
            return chips;
        }
    }
}
