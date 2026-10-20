using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using RevitMcpAddin.Feedback.Core;

namespace RevitMcpAddin.Feedback.Tests
{
    /// <summary>
    /// `/api/engineering-feedback`-ийн илгээгчийн талын ХУУРАМЧ сервер — бодит route-ийн гол дүрмүүдийг давтана:
    /// client_request_id / client_attachment_id idempotency, single ↔ multipart (том өргөтгөл + 25 MiB-аас их),
    /// хэсгийн хэмжээ/хэш шалгалт, complete-ийн дутуу хэсэг, submit-ийн payload hash, дугаар олголт.
    /// Алдааг `Fail(op, ex)`-ээр урьдчилан тарина (op = "draft", "reserve", "content", "part:3", "complete", "submit").
    /// </summary>
    public sealed class FakeServer : IFeedbackTransport
    {
        public sealed class Att
        {
            public string Id, Cid, Name, State, Mode, Sha;
            public long Size;
            public int PartSize, PartCount;
            public SortedDictionary<int, byte[]> Parts = new SortedDictionary<int, byte[]>();
            public byte[] Bytes;
        }

        public sealed class Draft
        {
            public string Id, Crid, Status = "draft", Hash;
            public int? Number;
            public FeedbackFields Fields;
            public string Diagnostics;
            public List<Att> Atts = new List<Att>();
        }

        public readonly Dictionary<string, Draft> Drafts = new Dictionary<string, Draft>();
        public readonly Dictionary<string, Att> AttsById = new Dictionary<string, Att>();
        private readonly Dictionary<string, Queue<Exception>> _faults = new Dictionary<string, Queue<Exception>>();
        public readonly List<string> Calls = new List<string>();
        public int PartBytes = 8 * 1024 * 1024;
        private int _seq;
        private int _number;

        public void Fail(string op, Exception ex)
        {
            if (!_faults.TryGetValue(op, out Queue<Exception> q)) _faults[op] = q = new Queue<Exception>();
            q.Enqueue(ex);
        }

        private void Maybe(string op)
        {
            Calls.Add(op);
            if (_faults.TryGetValue(op, out Queue<Exception> q) && q.Count > 0) throw q.Dequeue();
        }

        public Task<FeedbackDraftResult> CreateDraftAsync(string clientRequestId, FeedbackFields fields, string diagnosticsJson, CancellationToken ct)
        {
            Maybe("draft");
            Draft d = Drafts.Values.FirstOrDefault(x => x.Crid == clientRequestId);
            bool reused = d != null;
            if (d == null)
            {
                d = new Draft { Id = "efr_" + (++_seq).ToString("D24"), Crid = clientRequestId, Fields = fields.Clone(), Diagnostics = diagnosticsJson };
                Drafts[d.Id] = d;
            }
            return Task.FromResult(new FeedbackDraftResult { Id = d.Id, Status = d.Status, Reused = reused });
        }

        public Task<FeedbackReservedAttachment> ReserveAsync(string draftId, FeedbackAttachment a, bool sendHash, CancellationToken ct)
        {
            Maybe("reserve");
            Draft d = Drafts[draftId];
            if (d.Status != "draft") throw new FeedbackHttpException(409, "ALREADY_SUBMITTED", "submitted");
            Att same = d.Atts.FirstOrDefault(x => x.Cid == a.ClientAttachmentId);
            if (same != null)
            {
                if (same.State == "aborted" || same.State == "deleted") throw new FeedbackHttpException(409, "ATTACHMENT_GONE", "gone");
                return Task.FromResult(Shape(same));
            }
            string ext = FeedbackLimits.ExtensionOf(a.Name);
            var att = new Att
            {
                Id = "efa_" + (++_seq).ToString("D24"),
                Cid = a.ClientAttachmentId,
                Name = a.Name,
                Size = a.Size,
                Sha = sendHash ? a.Sha256 : null,
                Mode = FeedbackLimits.IsMultipart(ext, a.Size) ? "multipart" : "single",
                PartSize = PartBytes,
            };
            att.PartCount = att.Mode == "multipart" ? FeedbackLimits.PartCount(a.Size, PartBytes) : 1;
            att.State = att.Mode == "multipart" ? "uploading" : "reserved";
            d.Atts.Add(att);
            AttsById[att.Id] = att;
            return Task.FromResult(Shape(att));
        }

        public async Task<FeedbackReservedAttachment> PutContentAsync(string attachmentId, Stream content, long length, CancellationToken ct)
        {
            Maybe("content");
            Att a = Live(attachmentId);
            if (a.Mode != "single") throw new FeedbackHttpException(409, "WRONG_MODE", "parts");
            if (a.State == "ready") return Shape(a);
            var ms = new MemoryStream();
            await content.CopyToAsync(ms).ConfigureAwait(false);
            byte[] bytes = ms.ToArray();
            if (bytes.Length != a.Size) throw new FeedbackHttpException(400, "SIZE_MISMATCH", "size");
            if (a.Sha != null && a.Sha != Hex(bytes)) throw new FeedbackHttpException(422, "HASH_MISMATCH", "hash");
            a.Bytes = bytes;
            a.State = "ready";
            return Shape(a);
        }

        public Task<IList<int>> PutPartAsync(string attachmentId, int partNumber, byte[] buffer, int count, string sha256, CancellationToken ct)
        {
            Maybe("part:" + partNumber);
            Att a = Live(attachmentId);
            if (a.Mode != "multipart") throw new FeedbackHttpException(409, "WRONG_MODE", "content");
            long expected = FeedbackLimits.ExpectedPartSize(a.Size, partNumber, a.PartSize);
            if (expected < 0) throw new FeedbackHttpException(400, "BAD_PART", "bad part");
            if (count != expected) throw new FeedbackHttpException(400, "SIZE_MISMATCH", "part size");
            byte[] copy = new byte[count];
            Buffer.BlockCopy(buffer, 0, copy, 0, count);
            if (sha256 != null && sha256 != Hex(copy)) throw new FeedbackHttpException(422, "HASH_MISMATCH", "part hash");
            a.Parts[partNumber] = copy;
            return Task.FromResult<IList<int>>(a.Parts.Keys.ToList());
        }

        public Task<FeedbackReservedAttachment> CompleteAsync(string attachmentId, CancellationToken ct)
        {
            Maybe("complete");
            Att a = Live(attachmentId);
            if (a.State == "ready") return Task.FromResult(Shape(a));
            var missing = new List<int>();
            for (int i = 1; i <= a.PartCount; i++) if (!a.Parts.ContainsKey(i)) missing.Add(i);
            if (missing.Count > 0) throw new FeedbackHttpException(409, "PARTS_MISSING", "missing", missing: missing);
            a.Bytes = a.Parts.Values.SelectMany(x => x).ToArray();
            a.State = "ready";
            return Task.FromResult(Shape(a));
        }

        public Task<FeedbackSubmitResult> SubmitAsync(string draftId, string clientRequestId, FeedbackFields fields, IList<string> attachmentIds, CancellationToken ct)
        {
            Maybe("submit");
            Draft d = Drafts[draftId];
            string hash = (fields.Title ?? "") + "|" + (fields.Description ?? "") + "|" + string.Join(",", attachmentIds.OrderBy(x => x, StringComparer.Ordinal));
            if (d.Status != "draft")
            {
                FeedbackReceipt receipt = Receipt(d);
                if (d.Hash == hash) return Task.FromResult(new FeedbackSubmitResult { Receipt = receipt, AlreadySubmitted = true });
                throw new FeedbackHttpException(409, "IDEMPOTENCY_CONFLICT", "conflict", receipt: receipt);
            }
            foreach (string id in attachmentIds)
            {
                Att a = d.Atts.FirstOrDefault(x => x.Id == id);
                if (a == null) throw new FeedbackHttpException(400, "BAD_ATTACHMENTS", "not ours");
                if (a.State != "ready") throw new FeedbackHttpException(409, "ATTACHMENTS_PENDING", "pending");
            }
            foreach (Att a in d.Atts) if (!attachmentIds.Contains(a.Id) && a.State != "deleted") a.State = "aborted";
            d.Status = "received";
            d.Hash = hash;
            d.Number = ++_number;
            return Task.FromResult(new FeedbackSubmitResult { Receipt = Receipt(d), AlreadySubmitted = false });
        }

        /* ── сценарийн туслах ── */

        /// <summary>Серверийн цэвэрлэгч хавсралтыг (хугацаа дууссан) цуцалсныг дуурайна.</summary>
        public void Expire(string attachmentId) => AttsById[attachmentId].State = "aborted";

        private Att Live(string id)
        {
            if (!AttsById.TryGetValue(id, out Att a)) throw new FeedbackHttpException(404, "NOT_FOUND", "Олдсонгүй");
            if (a.State == "aborted" || a.State == "deleted") throw new FeedbackHttpException(409, "ATTACHMENT_GONE", "Хавсралт цуцлагдсан");
            return a;
        }

        private static FeedbackReservedAttachment Shape(Att a) => new FeedbackReservedAttachment
        {
            Id = a.Id,
            State = a.State,
            Mode = a.Mode,
            PartSize = a.Mode == "multipart" ? a.PartSize : 0,
            PartCount = a.PartCount,
            UploadedParts = a.Parts.Keys.ToList(),
        };

        private static FeedbackReceipt Receipt(Draft d) => new FeedbackReceipt
        {
            RequestId = d.Id,
            Number = d.Number,
            DisplayNumber = "ПХ-" + (d.Number ?? 0).ToString("D4"),
            Status = d.Status,
            StatusLabel = "Хүлээн авсан",
        };

        public static string Hex(byte[] b)
        {
            using (SHA256 sha = SHA256.Create()) return FeedbackOutbox.Hex(sha.ComputeHash(b));
        }
    }
}
