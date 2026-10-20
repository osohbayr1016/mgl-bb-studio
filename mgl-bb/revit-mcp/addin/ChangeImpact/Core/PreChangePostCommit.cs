using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.ChangeImpact.Core
{
    public enum PostCommitAction
    {
        /// <summary>`TransactionGroup.Assimilate()` — нэг Undo.</summary>
        Assimilate = 0,
        /// <summary>`TransactionGroup.RollBack()` — commit хийсэн ч БҮГДИЙГ буцаана.</summary>
        RollBack,
    }

    public sealed class PostCommitVerdict
    {
        public PostCommitAction Action { get; set; }
        public ApplyStatus Status { get; set; }
        public string Message { get; set; }
        public List<string> Details { get; set; } = new List<string>();
        public List<string> Compared { get; set; } = new List<string>();
        public List<string> NotCompared { get; set; } = new List<string>();
    }

    /// <summary>
    /// «Хэрэгжүүлэх»-ийн commit-ийн ДАРАА (settled) төлвийг preview-ийн settled төлөвтэй тулгаж, группийг `Assimilate` эсвэл `RollBack` хийхийг
    /// шийднэ — ЦЭВЭР.
    ///
    ///   TransactionGroup { Transaction { Move → Regenerate → Commit } → settled төлөв уншина → ЭНД тулгана → Assimilate | RollBack }
    ///
    /// ⚠️ «Preview ба бодит таарсан» гэж ЗӨВХӨН дотоод транзакц АМЖИЛТТАЙ commit хийгдсэний ДАРАА уншсан төлөвтэй тулгасан үед хэлнэ.
    /// Тулгаж чадахгүй (settled төлөв уншигдаагүй) бол fail-closed: буцаана.  Хананы ӨӨРИЙН байрлалыг үргэлж тулгана — тиймээс өрөө, хэмжээс,
    /// хаалгагүй хананд ч «юу ч тулгаагүй» гэсэн хоосон баталгаа үүсэхгүй.
    /// </summary>
    public static class PreChangePostCommitGate
    {
        public static PostCommitVerdict Decide(PreChangeRequest request, StateSnapshot previewSettled, StateSnapshot actualSettled, bool committed)
        {
            var v = new PostCommitVerdict { Action = PostCommitAction.RollBack, Status = ApplyStatus.Failed };

            if (!committed)
            {
                v.Message = "Revit хөдөлгөөнийг commit хийсэнгүй — загварт өөрчлөлт хийгдээгүй.";
                return v;
            }
            if (previewSettled == null || !previewSettled.Captured)
            {
                v.Message = "Preview-ийн settled төлөв байхгүй тул бодит үр дүнг тулгаж чадахгүй — буцаалаа. Нөлөөллийг дахин шалгана уу.";
                return v;
            }
            if (actualSettled == null || !actualSettled.Captured)
            {
                v.Message = "Commit-ийн дараах бодит (settled) төлвийг бүрэн уншиж чадсангүй — тулгаж чадахгүй тул буцаалаа.";
                return v;
            }

            VerifyResult verify = PreChangeVerifier.Compare(previewSettled, actualSettled);
            v.Compared.AddRange(verify.Compared);
            v.NotCompared.AddRange(verify.NotCompared);
            v.Details.AddRange(verify.Differences);

            // Хананы өөрийнх нь settled байрлал.
            ElementPlace p = previewSettled.Source, a = actualSettled.Source;
            bool doorOp = PreChangeOperations.Of(request) == PreChangeOperationKind.DoorMove;
            string place = doorOp ? "хаалганы байрлал" : "хананы байрлал";
            if (p == null || a == null || p.Location == null || a.Location == null || p.Location.Length != a.Location.Length)
            {
                v.NotCompared.Add(place);
            }
            else
            {
                bool same = true;
                for (int i = 0; i < p.Location.Length; i++)
                    if (Math.Abs(p.Location[i] - a.Location[i]) > PreChangeTolerance.VerifyLengthMm) { same = false; break; }
                if (same) v.Compared.Add(place);
                else v.Details.Add((doorOp ? "Хаалга" : "Хана") + " preview-д тооцсон байрлалд очсонгүй (commit-ийн дараа).");
            }

            if (v.Details.Count > 0)
            {
                v.Status = ApplyStatus.RolledBackMismatch;
                v.Message = "Commit-ийн дараах бодит төлөв preview-ээс ялгаатай байсан тул хөдөлгөөнийг БУЦААЛАА — загварт өөрчлөлт хийгдээгүй. Нөлөөллийг дахин шалгана уу.";
                return v;
            }
            if (v.Compared.Count == 0)
            {
                v.Message = "Бодит төлвийг preview-тэй юугаар ч тулгаж чадсангүй — баталгаажуулах боломжгүй тул буцаалаа.";
                return v;
            }

            v.Action = PostCommitAction.Assimilate;
            v.Status = ApplyStatus.AppliedVerified;
            return v;
        }
    }
}
