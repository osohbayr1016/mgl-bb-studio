using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>Эх элементийн (хана эсвэл хаалга) шалгалтын нэгдсэн дүн.  ⚠️ `Source` амьд обьект — ЗӨВХӨН нэг Step дотор.</summary>
    internal sealed class OpCheck
    {
        public bool Ok;
        public string Problem;
        public bool Refused;
        public bool NeedsCheckoutAck;
        public Element Source;
        public string SourceUid;
        public List<string> Warnings = new List<string>();
        public WallCheck Wall;
        public DoorCheck Door;
    }

    /// <summary>
    /// «Өөрчлөхөөс өмнө шалгах»-ын ҮЙЛДЛИЙН Revit-ийн салаа.  Job, sandbox, capture, apply, шийдвэр, кэш, хуучирсан эсэх, зураглал бүгд ХУВААЛЦАГДАНА —
    /// ЭНД зөвхөн үйлдэл тус бүрээр ЯЛГАГДАХ зүйл: эх элементийн шалгалт, нэр дэвшигч бэлтгэл (өрөө, клэш), хуурууны хээ, хамаарлын эзэмшил.
    /// WallMove нь анхны MVP-ийн код (үг үсэг, дараалал өөрчлөгдөөгүй).
    /// </summary>
    internal interface IPreChangeOperation
    {
        PreChangeOperationKind Kind { get; }
        /// <summary>Эх элементийг шалгана (id-аар).  Загварт ХҮРЭХГҮЙ.</summary>
        OpCheck Check(Document doc, long sourceId);
        string SourceChangedText { get; }
        string LinkNote { get; }
        /// <summary>Зайнаас ХАМААРАХГҮЙ plan-ийн суурь (хост элемент, join, хаалганы контекст, орчны зай харагдац, эх сурвалжууд).</summary>
        void BuildPlanBase(Document doc, DocumentKey key, OpCheck check, PreChangePlan plan, string stamp, StageClock clock);
        /// <summary>Хамаарах элементийн эзэмшил (workshare).  null = асуудалгүй.</summary>
        string DependentOwnership(Document doc, PreChangePlan plan, out int notOwned);
        /// <summary>Зайнаас ХАМААРАХ нэр дэвшигч (өрөө, клэш, гарц) — `spec`-д бөглөнө.</summary>
        void PlanCandidates(Document doc, DocumentKey key, PreChangeRequest req, XYZ moveFt, Element source, PreChangePlan plan, CaptureSpec spec, StageClock clock);
        List<long> ReduceVisibility(Document doc, IEnumerable<long> views, Element source, XYZ moveFt, out int excluded, out int unreadable);
        /// <summary>Preview-д аль хэдийн төлөвлөсөн жагсаалтаар хурууны хээ (Apply-ийн `FingerprintNow`-тай ИЖИЛ хэш).</summary>
        PreChangeFingerprint FingerprintFrom(Document doc, DocumentKey key, PreChangeRequest req, string stamp, CaptureSpec spec);
        /// <summary>Apply-ийн мөчид дахин төлөвлөж хурууны хээ тооцно.</summary>
        PreChangeFingerprint FingerprintNow(Document doc, DocumentKey key, PreChangeRequest req);
        /// <summary>Үйлдэлд хамаарах нэмэлт оролт (хаалганы контекст г.м.) — `PreChangeDiff.Compute`-д.</summary>
        void FillInput(PreChangeInput input, PreChangePlan plan);
    }

    internal static class PreChangeOperationRegistry
    {
        private static readonly IPreChangeOperation Wall = new WallMoveOperation();
        private static readonly IPreChangeOperation Door = new DoorMoveOperation();

        internal static IPreChangeOperation For(PreChangeOperationKind kind)
        {
            return kind == PreChangeOperationKind.DoorMove ? Door : Wall;
        }

        internal static IPreChangeOperation For(PreChangeRequest req)
        {
            return For(req != null ? req.Operation : PreChangeOperationKind.WallMove);
        }
    }

    /* ====================================================================== */
    /*  ХАНА ЗӨӨХ — анхны MVP-ийн логик (PreChangeJob-оос ЯГ ХӨДЛҮҮЛСЭН).        */
    /* ====================================================================== */

    internal sealed class WallMoveOperation : IPreChangeOperation
    {
        public PreChangeOperationKind Kind { get { return PreChangeOperationKind.WallMove; } }
        public string SourceChangedText { get { return "Хана солигдсон байна — дахин сонгоно уу."; } }
        public string LinkNote { get { return "Линк загварын ДОТОРХ ханыг энд зөөхгүй (зөвхөн MEP-ийн clash тулгана)."; } }

        public OpCheck Check(Document doc, long sourceId)
        {
            WallCheck wc = PreChangeWallRules.Check(doc, doc.GetElement(new ElementId(sourceId)));
            var oc = new OpCheck { Ok = wc.Ok, Problem = wc.Problem, Refused = wc.Refused, NeedsCheckoutAck = wc.NeedsCheckoutAck, Wall = wc };
            if (wc.Ok)
            {
                oc.Source = wc.Wall;
                oc.SourceUid = wc.Wall.UniqueId;
                oc.Warnings.AddRange(wc.Warnings);
            }
            return oc;
        }

        public void BuildPlanBase(Document doc, DocumentKey key, OpCheck check, PreChangePlan plan, string stamp, StageClock clock)
        {
            Wall wall = check.Wall.Wall;
            int total; bool trunc;
            plan.HostedIds = PreChangeWallRules.InsertIds(wall, out total, out trunc);
            if (total < 0) plan.RequiredReasons.Add("Хананд хостлогдсон элементүүдийг (хаалга, цонх) уншиж чадсангүй.");
            else if (trunc) plan.RequiredReasons.Add("Хананд хостлогдсон элемент " + total + " — эхний " + PreChangeWallRules.MaxInserts + "-г л авав.");

            plan.JoinedIds = PreChangeCapture.PlanJoined(doc, wall, plan.AdvisoryReasons);
            clock.Measure("unenclosed_index_ms", () => plan.Unenclosed = PreChangeCapture.BuildUnenclosedIndex(doc));

            string clrProblem;
            View3D v3 = PreChangeClearanceProbe.FindView(doc, out clrProblem);
            plan.Clearance3dViewId = v3 != null ? v3.Id.Value : 0;
            plan.Clearance3dProblem = clrProblem;

            plan.SourceIds = new List<long> { wall.Id.Value };
            plan.SourceIds.AddRange(plan.HostedIds);
            plan.ScheduleCandidateIds = plan.SourceIds.ToList();
        }

        public string DependentOwnership(Document doc, PreChangePlan plan, out int notOwned)
        {
            return PreChangeWallRules.DependentOwnership(doc, plan.HostedIds.Concat(plan.JoinedIds), out notOwned);
        }

        public void PlanCandidates(Document doc, DocumentKey key, PreChangeRequest req, XYZ moveFt, Element source, PreChangePlan plan, CaptureSpec spec, StageClock clock)
        {
            var wall = (Wall)source;
            spec.BoundaryId = wall.Id.Value;
            clock.Measure("plan_rooms_ms", () => spec.RoomIds = PreChangeCapture.PlanRooms(doc, wall, moveFt, spec.IncompleteReasons, plan.Unenclosed));
            clock.Measure("plan_mep_ms", () => spec.Clash = PreChangeClashProbe.Plan(doc, wall, moveFt));
            clock.Measure("plan_egress_ms", () => spec.Egress = PreChangeEgressProbe.Plan(doc, key, spec.RoomIds));
            if (spec.HostedIds.Count > 0 && spec.Egress != null && !spec.Egress.Configured)
                spec.Notes.Add("Гарцын зам зөвхөн зэргэлдээ өрөөнүүдээс (нэр дэвшигч) тооцогдоно.");
        }

        public List<long> ReduceVisibility(Document doc, IEnumerable<long> views, Element source, XYZ moveFt, out int excluded, out int unreadable)
        {
            return PreChangeVisibilityReducer.Reduce(doc, views, source, moveFt, out excluded, out unreadable);
        }

        public PreChangeFingerprint FingerprintFrom(Document doc, DocumentKey key, PreChangeRequest req, string stamp, CaptureSpec spec)
        {
            return PreChangeFingerprints.ComputeFrom(doc, key, spec.SourceId, req, stamp, spec.HostedIds, spec.JoinedIds, spec.RoomIds);
        }

        public PreChangeFingerprint FingerprintNow(Document doc, DocumentKey key, PreChangeRequest req)
        {
            return PreChangeFingerprints.Compute(doc, key, req.SourceId, req);
        }

        public void FillInput(PreChangeInput input, PreChangePlan plan) { }
    }

    /* ====================================================================== */
    /*  ХААЛГА ЗӨӨХ — энэ ХАНЫН ДАГУУ, хостоо хадгална.                         */
    /* ====================================================================== */

    internal sealed class DoorMoveOperation : IPreChangeOperation
    {
        public PreChangeOperationKind Kind { get { return PreChangeOperationKind.DoorMove; } }
        public string SourceChangedText { get { return "Хаалга солигдсон байна — дахин сонгоно уу."; } }
        public string LinkNote { get { return "Линк загварын доторх элементийг энд зөөхгүй (зөвхөн саад, клэшээр тулгана)."; } }

        public OpCheck Check(Document doc, long sourceId)
        {
            DoorCheck dc = PreChangeDoorRules.Check(doc, doc.GetElement(new ElementId(sourceId)));
            var oc = new OpCheck { Ok = dc.Ok, Problem = dc.Problem, Refused = dc.Refused, NeedsCheckoutAck = dc.NeedsCheckoutAck, Door = dc };
            if (dc.Ok)
            {
                oc.Source = dc.Door;
                oc.SourceUid = dc.Door.UniqueId;
                oc.Warnings.AddRange(dc.Warnings);
            }
            return oc;
        }

        public void BuildPlanBase(Document doc, DocumentKey key, OpCheck check, PreChangePlan plan, string stamp, StageClock clock)
        {
            FamilyInstance door = check.Door.Door;
            // Хаалганы контекст (хост, нүх, саад, өрөө) — UI аль хэдийн уншсан бол кэшээс (зайнаас ХАМААРАХГҮЙ).
            bool fromCache = false;
            clock.Measure("door_context_ms", () => plan.Door = PreChangeDoorContext.GetOrBuild(doc, key, check.Door, stamp, out fromCache));

            plan.HostedIds = new List<long> { door.Id.Value };      // хаалга өөрөө = «hosted» snapshot (байрлал, хост, From/To, орчны зай)
            plan.JoinedIds = new List<long>();                      // хаалга зөөхөд хөрш хана ХӨДӨЛДӨГГҮЙ
            clock.Measure("unenclosed_index_ms", () => plan.Unenclosed = PreChangeCapture.BuildUnenclosedIndex(doc));

            string clrProblem;
            View3D v3 = PreChangeClearanceProbe.FindView(doc, out clrProblem);
            plan.Clearance3dViewId = v3 != null ? v3.Id.Value : 0;
            plan.Clearance3dProblem = clrProblem;

            plan.SourceIds = new List<long> { door.Id.Value };
            plan.ScheduleCandidateIds = plan.SourceIds.ToList();
            // Саад цуглуулалт бүрэн биш (хязгаар, unload хийсэн линк, хаалттай workset) бол «дүгнэх боломжгүй» — ЧИМЭЭГҮЙ алгасахгүй.
            foreach (string reason in plan.Door.Ctx.IncompleteReasons) plan.RequiredReasons.Add(reason);
        }

        public string DependentOwnership(Document doc, PreChangePlan plan, out int notOwned)
        {
            // Хост хана ба хаалга — `Check` дээр аль хэдийн шалгасан.  Энд хост дээрх БУСАД нүхний эзэмшил (нүхний хэмжээ, хана засагдахад) шалгахгүй.
            notOwned = 0;
            return null;
        }

        public void PlanCandidates(Document doc, DocumentKey key, PreChangeRequest req, XYZ moveFt, Element source, PreChangePlan plan, CaptureSpec spec, StageClock clock)
        {
            var door = (FamilyInstance)source;
            Wall host = door.Host as Wall;
            spec.BoundaryId = host != null ? host.Id.Value : 0;
            clock.Measure("plan_rooms_ms", () => spec.RoomIds = PreChangeDoorContext.PlanRooms(doc, door, host, moveFt, plan.Unenclosed, spec.IncompleteReasons));
            clock.Measure("plan_clash_ms", () => spec.Clash = PreChangeDoorContext.ClashSpecFor(plan.Door, req.OffsetMm));
            clock.Measure("plan_egress_ms", () => spec.Egress = PreChangeEgressProbe.Plan(doc, key, spec.RoomIds));
            if (spec.Egress != null && !spec.Egress.Configured)
                spec.Notes.Add("Гарцын зам зөвхөн зэргэлдээ өрөөнүүдээс (нэр дэвшигч) тооцогдоно.");
        }

        public List<long> ReduceVisibility(Document doc, IEnumerable<long> views, Element source, XYZ moveFt, out int excluded, out int unreadable)
        {
            return PreChangeVisibilityReducer.Reduce(doc, views, source, moveFt, out excluded, out unreadable);
        }

        public PreChangeFingerprint FingerprintFrom(Document doc, DocumentKey key, PreChangeRequest req, string stamp, CaptureSpec spec)
        {
            return PreChangeFingerprints.ComputeDoor(doc, key, req, stamp, spec.RoomIds);
        }

        public PreChangeFingerprint FingerprintNow(Document doc, DocumentKey key, PreChangeRequest req)
        {
            return PreChangeFingerprints.ComputeDoor(doc, key, req, null, null);
        }

        public void FillInput(PreChangeInput input, PreChangePlan plan)
        {
            if (plan != null && plan.Door != null) input.Door = plan.Door.Ctx;
        }
    }
}
