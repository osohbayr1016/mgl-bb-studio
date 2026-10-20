using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;

namespace RevitMcpAddin.Feedback.Core
{
    /// <summary>
    /// Нэг outbox item-ийг серверт хүргэх STATE MACHINE (Revit/UI-гүй — арын thread дээр, тестлэгдэнэ):
    ///
    ///   ноорог (idempotent: <c>client_request_id</c> = item.Id)
    ///   → хавсралт бүр: нөөцлөх (idempotent: <c>client_attachment_id</c>) → энгийн: нэг stream PUT /
    ///                   том: 8 MiB хэсэг тус бүр SHA-256-тай PUT (аль хэдийн хүлээн авсан хэсгийг алгасна) → complete
    ///   → submit (idempotent: сервер payload hash-аар) → дугаар (ПХ-…).
    ///
    /// Алхам БҮРИЙН дараа item хадгалагдана — процесс унасан / сүлжээ тасарсан ч дараагийн оролдлого өмнөх
    /// амжилттай алхмаас үргэлжилнэ (ноорог, хүлээн авсан хэсгүүд дахин илгээгдэхгүй).
    /// Хугацаа дууссан / цуцлагдсан хавсралт (410/409/404) → ШИНЭ түлхүүрээр дахин нөөцөлнө (локал хуулбараас).
    /// ⚠️ Файлыг хэзээ ч бүтнээр санах ойд уншихгүй: хэсэг тус бүрд ≤ part_size буфер, энгийн файл stream.
    /// ⚠️ Дуудагч <see cref="FeedbackOutbox.TryLease"/>-ийг барьсан байх ёстой (өөр процесс зэрэг илгээхгүй).
    /// </summary>
    public sealed class FeedbackSender
    {
        private readonly FeedbackOutbox _outbox;
        private readonly IFeedbackTransport _t;
        private readonly Func<DateTimeOffset> _now;
        private readonly Func<double> _jitter;

        public FeedbackSender(FeedbackOutbox outbox, IFeedbackTransport transport, Func<DateTimeOffset> now = null, Func<double> jitter = null)
        {
            _outbox = outbox ?? throw new ArgumentNullException(nameof(outbox));
            _t = transport ?? throw new ArgumentNullException(nameof(transport));
            _now = now ?? (() => DateTimeOffset.UtcNow);
            var rnd = new Random();
            _jitter = jitter ?? (() => { lock (rnd) return rnd.NextDouble(); });
        }

        /// <summary>Илгээгээд эцсийн ЛОКАЛ төлөвийг буцаана (submitted / retry_wait / auth_required / failed / queued).</summary>
        public async Task<string> SendAsync(FeedbackItem item, CancellationToken ct)
        {
            if (item == null) throw new ArgumentNullException(nameof(item));
            if (FeedbackStates.IsTerminal(item.State)) return item.State;
            item.State = FeedbackStates.Sending;
            item.Attempts++;
            try
            {
                Persist(item);
                await DoSendAsync(item, ct).ConfigureAwait(false);
                return item.State;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                // Revit хаагдаж байна г.м. — дараагийн эхлэлд үргэлжилнэ (оролдлого тоолохгүй).
                item.Attempts = Math.Max(0, item.Attempts - 1);
                item.State = FeedbackStates.Queued;
                TrySave(item);
                return item.State;
            }
            catch (ItemRemovedException)
            {
                return FeedbackStates.Cancelled;
            }
            catch (Exception ex)
            {
                FailureKind kind = FeedbackRetry.Classify(ex);
                var h = ex as FeedbackHttpException;
                item.LastError = new FeedbackError
                {
                    Code = h?.Code ?? (ex is FeedbackNetworkException ? "NETWORK" : ex.GetType().Name),
                    Message = FeedbackRetry.Describe(ex),
                    HttpStatus = h != null && h.Status > 0 ? h.Status : (int?)null,
                    At = FeedbackTime.Iso(_now()),
                };
                switch (kind)
                {
                    case FailureKind.Transient:
                        item.State = FeedbackStates.RetryWait;
                        item.NextAttemptAt = FeedbackTime.Iso(_now() + FeedbackRetry.Delay(item.Attempts, h?.RetryAfter, _jitter()));
                        break;
                    case FailureKind.AuthRequired:
                        // Нэвтрэх хүртэл оролдлого шатаахгүй; нэвтэрмэгц (эсвэл минут тутам) дахин шалгана.
                        item.Attempts = Math.Max(0, item.Attempts - 1);
                        item.State = FeedbackStates.AuthRequired;
                        item.NextAttemptAt = FeedbackTime.Iso(_now() + TimeSpan.FromMinutes(1));
                        break;
                    default:
                        item.State = FeedbackStates.Failed;
                        item.NextAttemptAt = null;
                        break;
                }
                TrySave(item);
                return item.State;
            }
        }

        /// <summary>Хэрэглэгч «Дахин оролдох» дарсан — failed/retry_wait/auth_required-ийг queued болгоно.</summary>
        public static void ResetForRetry(FeedbackItem item)
        {
            if (item == null || FeedbackStates.IsTerminal(item.State)) return;
            item.State = FeedbackStates.Queued;
            item.NextAttemptAt = null;
        }

        private async Task DoSendAsync(FeedbackItem item, CancellationToken ct)
        {
            string problem = item.Fields?.Problem();
            if (problem != null) throw new FeedbackHttpException(422, "INCOMPLETE", problem);

            if (string.IsNullOrEmpty(item.DraftId))
            {
                FeedbackDraftResult d = await _t.CreateDraftAsync(item.Id, item.Fields, item.DiagnosticsJson, ct).ConfigureAwait(false);
                item.DraftId = d.Id;
                Persist(item);
            }

            for (int pass = 0; pass < 2; pass++)
            {
                foreach (FeedbackAttachment a in item.Attachments)
                {
                    ct.ThrowIfCancellationRequested();
                    if (!a.Ready) await UploadAsync(item, a, ct).ConfigureAwait(false);
                }
                try
                {
                    List<string> ids = item.Attachments.Where(x => x.Ready && !string.IsNullOrEmpty(x.ServerId)).Select(x => x.ServerId).ToList();
                    FeedbackSubmitResult r = await _t.SubmitAsync(item.DraftId, item.Id, item.Fields, ids, ct).ConfigureAwait(false);
                    Complete(item, r.Receipt, null);
                    return;
                }
                catch (FeedbackHttpException h) when (h.Code == "ATTACHMENTS_PENDING" && pass == 0)
                {
                    // Сервер хавсралтыг бэлэн биш гэж үзсэн (хугацаа дууссан, цэвэрлэгдсэн) — дахин шалгаж/илгээнэ.
                    foreach (FeedbackAttachment a in item.Attachments) a.Ready = false;
                    Persist(item);
                }
                catch (FeedbackHttpException h) when (h.Code == "IDEMPOTENCY_CONFLICT" && h.Receipt != null)
                {
                    Complete(item, h.Receipt, "Энэ хүсэлт өмнө нь илгээгдсэн — анхны дугаар хэвээр.");
                    return;
                }
            }
            throw new FeedbackHttpException(409, "ATTACHMENTS_PENDING", "Хавсралтыг сервер бэлэн гэж хүлээн авсангүй — дахин оролдоно.");
        }

        private async Task UploadAsync(FeedbackItem item, FeedbackAttachment a, CancellationToken ct)
        {
            string path = _outbox.FilePath(item, a);
            if (!File.Exists(path))
                throw new FeedbackHttpException(0, "LOCAL_FILE_MISSING", "Хавсралтын локал хуулбар олдсонгүй: " + a.Name + " — хүсэлтийг цуцлаад дахин илгээнэ үү.");

            for (int round = 0; round < 2; round++)
            {
                try
                {
                    if (string.IsNullOrEmpty(a.ServerId))
                    {
                        FeedbackReservedAttachment r = await _t.ReserveAsync(item.DraftId, a, true, ct).ConfigureAwait(false);
                        a.ServerId = r.Id;
                        a.Mode = r.Mode;
                        a.PartSize = r.PartSize;
                        a.PartCount = r.PartCount;
                        a.UploadedParts = r.UploadedParts ?? new List<int>();
                        Persist(item);
                        if (r.State == "ready")
                        {
                            a.Ready = true;
                            Persist(item);
                            return;
                        }
                    }
                    if (a.Mode == "multipart") await UploadPartsAsync(item, a, path, ct).ConfigureAwait(false);
                    else
                    {
                        using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, true))
                        {
                            FeedbackReservedAttachment r = await _t.PutContentAsync(a.ServerId, fs, a.Size, ct).ConfigureAwait(false);
                            if (r != null && !string.IsNullOrEmpty(r.State) && r.State != "ready")
                                throw new FeedbackHttpException(409, "VERIFY_FAILED", "Сервер файлыг бэлэн гэж баталгаажуулсангүй");
                        }
                    }
                    a.Ready = true;
                    Persist(item);
                    return;
                }
                catch (FeedbackHttpException h) when (round == 0 && IsGone(h))
                {
                    // Нөөцөлсөн хавсралтын хугацаа дууссан / цэвэрлэгдсэн — ШИНЭ түлхүүрээр, локал хуулбараас дахин.
                    a.ServerId = null;
                    a.Mode = null;
                    a.UploadedParts = new List<int>();
                    a.ClientAttachmentId = FeedbackItem.NewClientId("att");
                    Persist(item);
                }
            }
        }

        private async Task UploadPartsAsync(FeedbackItem item, FeedbackAttachment a, string path, CancellationToken ct)
        {
            int partSize = a.PartSize > 0 ? a.PartSize : FeedbackLimits.PartBytes;
            int count = a.PartCount > 0 ? a.PartCount : FeedbackLimits.PartCount(a.Size, partSize);
            for (int attempt = 0; attempt < 2; attempt++)
            {
                byte[] buf = new byte[partSize];
                using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 81920))
                {
                    for (int n = 1; n <= count; n++)
                    {
                        if (a.UploadedParts.Contains(n)) continue;
                        ct.ThrowIfCancellationRequested();
                        long offset = (long)(n - 1) * partSize;
                        int len = (int)Math.Min(partSize, a.Size - offset);
                        fs.Seek(offset, SeekOrigin.Begin);
                        ReadExactly(fs, buf, len);
                        string sha = Sha256(buf, len);
                        IList<int> parts = await _t.PutPartAsync(a.ServerId, n, buf, len, sha, ct).ConfigureAwait(false);
                        if (parts != null && parts.Count > 0) a.UploadedParts = new List<int>(parts);
                        else if (!a.UploadedParts.Contains(n)) a.UploadedParts.Add(n);
                        Persist(item);
                    }
                }
                try
                {
                    await _t.CompleteAsync(a.ServerId, ct).ConfigureAwait(false);
                    return;
                }
                catch (FeedbackHttpException h) when (attempt == 0 && h.Code == "PARTS_MISSING" && h.Missing != null)
                {
                    a.UploadedParts.RemoveAll(x => h.Missing.Contains(x));
                    Persist(item);
                }
            }
        }

        private void Complete(FeedbackItem item, FeedbackReceipt receipt, string note)
        {
            item.Receipt = receipt ?? new FeedbackReceipt();
            if (string.IsNullOrEmpty(item.Receipt.RequestId)) item.Receipt.RequestId = item.DraftId;
            if (note != null) item.Receipt.Note = note;
            item.State = FeedbackStates.Submitted;
            item.LastError = null;
            item.NextAttemptAt = null;
            Persist(item);
            _outbox.DropFiles(item);
        }

        private static bool IsGone(FeedbackHttpException h) =>
            h.Code == "UPLOAD_EXPIRED" || h.Code == "ATTACHMENT_GONE" || (h.Status == 404 && h.Code == "NOT_FOUND");

        private void Persist(FeedbackItem item)
        {
            item.UpdatedAt = FeedbackTime.Iso(_now());
            if (!_outbox.Save(item)) throw new ItemRemovedException();
        }

        private void TrySave(FeedbackItem item)
        {
            try
            {
                item.UpdatedAt = FeedbackTime.Iso(_now());
                _outbox.Save(item);
            }
            catch (Exception)
            {
                // Диск бичигдэхгүй бол санах ойн төлөв хэвээр — дараагийн тик дахин оролдоно.
            }
        }

        private static void ReadExactly(Stream s, byte[] buf, int len)
        {
            int read = 0;
            while (read < len)
            {
                int n = s.Read(buf, read, len - read);
                if (n <= 0) throw new IOException("Хавсралтын локал хуулбар дутуу (" + read + "/" + len + " байт)");
                read += n;
            }
        }

        private static string Sha256(byte[] buf, int len)
        {
            using (SHA256 sha = SHA256.Create()) return FeedbackOutbox.Hex(sha.ComputeHash(buf, 0, len));
        }

        /// <summary>Илгээх явцад хэрэглэгч item-ийг цуцалж/устгасан.</summary>
        private sealed class ItemRemovedException : Exception { }
    }
}
