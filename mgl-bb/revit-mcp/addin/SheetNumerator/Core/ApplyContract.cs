using System;
using System.Collections.Generic;
using System.Linq;

namespace RevitMcpAddin.SheetNumerator.Core
{
    /// <summary>Нэг хуудсанд хийх өөрчлөлт — Revit-ийн handler-д дамжих ЭНГИЙН өгөгдөл (Revit объектгүй).</summary>
    public sealed class ApplyItem
    {
        public long SheetId { get; set; }
        public string UniqueId { get; set; }

        /// <summary>Snapshot авах үеийн дугаар/нэр — Apply-ийн үед ӨӨР болсон (гаднаас засагдсан) эсэхийг шалгана.</summary>
        public string ExpectedNumber { get; set; }
        public string ExpectedName { get; set; }

        public string NewNumber { get; set; }

        /// <summary>null = нэрийг ХӨНДӨХГҮЙ.</summary>
        public string NewName { get; set; }

        public List<ParameterWrite> Writes { get; set; } = new List<ParameterWrite>();

        public bool NumberChanges => !string.Equals(ExpectedNumber, NewNumber, StringComparison.Ordinal);
        public bool NameChanges => NewName != null && !string.Equals(ExpectedName, NewName, StringComparison.Ordinal);
        public bool AnyChange => NumberChanges || NameChanges || (Writes != null && Writes.Count > 0);
    }

    public sealed class ApplyRequest
    {
        public string DocumentKey { get; set; }
        public UniquenessMode Uniqueness { get; set; }
        public List<ApplyItem> Items { get; set; } = new List<ApplyItem>();

        /// <summary>TransactionGroup-ийн нэр.</summary>
        public string Label { get; set; } = Msg.TransactionGroupName;
    }

    public enum ApplyOutcome
    {
        /// <summary>Бүгд хэрэгжиж, нэг Undo алхам болсон.</summary>
        Applied = 0,

        NothingToDo = 1,

        /// <summary>Document / хуудас гаднаас өөрчлөгдсөн — Юу ч бичигдээгүй, жагсаалтыг шинэчлэх хэрэгтэй.</summary>
        Stale = 2,

        /// <summary>Урьдчилсан шалгалт хаасан (давхардал, эзэмшилд байгаа хуудас, параметр) — Юу ч бичигдээгүй.</summary>
        Blocked = 3,

        /// <summary>Бичих явцад алдаа гарч БҮГДИЙГ нь буцаасан — буцаалт БАТАЛГААЖСАН.</summary>
        RolledBack = 4,

        /// <summary>Алдаа гарсан, гэвч буцаалтыг баталгаажуулж чадсангүй — хэрэглэгч шалгах ёстой.</summary>
        RollbackUnverified = 5,
    }

    /// <summary>Тодорхой хуудастай холбоотой асуудал.</summary>
    public sealed class ApplyProblem
    {
        public long SheetId { get; set; }
        public string Number { get; set; }
        public string Name { get; set; }
        public string Message { get; set; }

        public override string ToString()
        {
            return Number + " — " + Name + ": " + Message;
        }
    }

    public sealed class ApplyResult
    {
        public ApplyOutcome Outcome { get; set; }

        /// <summary>Хэрэглэгчид харуулах товч Монгол мессеж.</summary>
        public string Message { get; set; }

        /// <summary>Тайлбарын дэлгэрэнгүй (хуудас бүр, технологийн мэдээлэл — нэг мөрөөр).</summary>
        public string Detail { get; set; }

        public List<ApplyProblem> Problems { get; set; } = new List<ApplyProblem>();

        /// <summary>Алдааны дараа бодит дугаарууд анхных болсныг уншиж баталгаажуулсан.</summary>
        public bool RollbackVerified { get; set; }

        public int NumbersChanged { get; set; }
        public int NamesChanged { get; set; }
        public int ParametersWritten { get; set; }

        public bool Success => Outcome == ApplyOutcome.Applied || Outcome == ApplyOutcome.NothingToDo;
    }

    /// <summary>Snapshot унших үйлдлийн үр дүн.</summary>
    public sealed class SnapshotResult
    {
        public bool Success { get; set; }

        /// <summary>Амжилтгүй бол хэрэглэгчид харуулах Монгол тайлбар.</summary>
        public string Error { get; set; }

        public DocumentSnapshot Snapshot { get; set; }
    }

    /// <summary>«Хуудасны нэр өөрчлөх» хүсэлт.</summary>
    public sealed class RenameRequest
    {
        public string DocumentKey { get; set; }
        public long SheetId { get; set; }
        public string UniqueId { get; set; }
        public string ExpectedNumber { get; set; }
        public string ExpectedName { get; set; }
        public string NewName { get; set; }
    }

    /// <summary>«Хуудас устгах» хүсэлт (хэрэглэгч баталгаажуулсны ДАРАА).</summary>
    public sealed class DeleteRequest
    {
        public string DocumentKey { get; set; }
        public long SheetId { get; set; }
        public string UniqueId { get; set; }
        public string ExpectedNumber { get; set; }
        public string ExpectedName { get; set; }
    }

    /// <summary>Нэг хуудсанд хийх энгийн үйлдлийн (нэр өөрчлөх, устгах) үр дүн.</summary>
    public sealed class OperationResult
    {
        public bool Success { get; set; }

        /// <summary>Хэрэглэгчид харуулах товч мессеж.</summary>
        public string Message { get; set; }

        public string Detail { get; set; }

        /// <summary>Хуудас/document гаднаас өөрчлөгдсөн — шинэчлэх хэрэгтэй.</summary>
        public bool Stale { get; set; }
    }

    public static class ApplyRequestBuilder
    {
        /// <summary>Төлөвлөгөөний ӨӨРЧЛӨГДӨЖ БУЙ мөрүүдээс Apply-ийн хүсэлт үүсгэнэ.</summary>
        public static ApplyRequest Build(RenumberPlan plan, DocumentSnapshot doc)
        {
            var req = new ApplyRequest
            {
                DocumentKey = doc.DocumentKey,
                Uniqueness = doc.Uniqueness,
            };
            foreach (PlannedRow r in plan.Rows)
            {
                if (!r.IsChanged)
                    continue;
                req.Items.Add(new ApplyItem
                {
                    SheetId = r.Sheet.SheetId,
                    UniqueId = r.Sheet.UniqueId,
                    ExpectedNumber = r.Sheet.Number,
                    ExpectedName = r.Sheet.Name,
                    NewNumber = r.NewNumber,
                    NewName = r.NameChanged ? r.NewName : null,
                    Writes = r.Writes.ToList(),
                });
            }
            return req;
        }
    }
}
