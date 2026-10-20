using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using RevitMcpAddin.Feedback.Core;

namespace RevitMcpAddin.Feedback
{
    /// <summary>
    /// «Санал хүсэлт»-ийн АРЫН ИЛГЭЭГЧ (нэг Revit процесст нэг).  Revit API-д ХЭЗЭЭ Ч хүрэхгүй — зөвхөн outbox + HTTP,
    /// тиймээс UI thread-ийг хэзээ ч саатуулахгүй, загвар засварлах ажлыг тасалдуулахгүй.
    ///
    ///   • 60 секунд тутам + шинэ хүсэлт нэмэгдэх / нэвтрэх / цонх нээгдэх бүрд <see cref="Kick"/>;
    ///   • зөвхөн ОДООГИЙН нэвтэрсэн хэрэглэгчийн хүрээний (сервер × tenant × хэрэглэгч) item-ийг авна;
    ///   • item бүрийг <see cref="FeedbackOutbox.TryLease"/>-аар — хоёр Revit зэрэг нээлттэй байсан ч нэг хүсэлт нэг удаа явна;
    ///   • Revit хаагдахад (<see cref="Shutdown"/>) явж буй илгээлтийг цуцалж queued болгоно (дараагийн нээлтэд үргэлжилнэ).
    /// </summary>
    internal sealed class FeedbackService
    {
        private static FeedbackService _instance;
        private static readonly object InitGate = new object();

        public static FeedbackService Instance
        {
            get
            {
                if (_instance != null) return _instance;
                lock (InitGate) return _instance ?? (_instance = new FeedbackService(FeedbackOutbox.DefaultRoot()));
            }
        }

        public FeedbackOutbox Outbox { get; }
        public string RevitYear { get; private set; }

        /// <summary>Outbox өөрчлөгдсөн (арын thread-ээс — UI өөрөө Dispatcher рүү шилжүүлнэ).</summary>
        public event Action Changed;

        private readonly CancellationTokenSource _stop = new CancellationTokenSource();
        private Timer _timer;
        private int _running;
        private int _again;
        private DateTimeOffset _capsAt = DateTimeOffset.MinValue;

        private FeedbackService(string root)
        {
            Outbox = new FeedbackOutbox(root);
        }

        /// <summary>App.OnStartup — таймерыг эхлүүлнэ (эхний тик 20 с дараа: Revit-ийн эхлэлийг удаашруулахгүй).</summary>
        public void Start(string revitYear)
        {
            RevitYear = revitYear;
            if (_timer != null) return;
            _timer = new Timer(_ => Kick(), null, TimeSpan.FromSeconds(20), TimeSpan.FromSeconds(60));
        }

        public void Shutdown()
        {
            try { _stop.Cancel(); } catch (Exception) { }
            try { _timer?.Dispose(); } catch (Exception) { }
        }

        /// <summary>Одоогийн (host, token) — тохиргооноос (төхөөрөмжийн session идэвхтэй бол session).</summary>
        public static (string host, string token) CurrentCredentials()
        {
            try
            {
                AddinSettings s = SettingsStore.Load();
                return (s.ApiHost, s.Token);
            }
            catch (Exception)
            {
                return (null, null);
            }
        }

        /// <summary>Одоогийн хүрээ (нэвтрээгүй бол null).</summary>
        public string CurrentScope(out long userId, out string tenant, out string host)
        {
            (string h, string token) = CurrentCredentials();
            host = h;
            userId = 0;
            tenant = null;
            if (string.IsNullOrEmpty(h) || string.IsNullOrEmpty(token)) return null;
            if (!FeedbackScope.TryReadToken(token, out userId, out tenant)) return null;
            return FeedbackScope.Key(h, tenant, userId);
        }

        public List<FeedbackItem> CurrentItems()
        {
            string scope = CurrentScope(out _, out _, out _);
            if (scope == null) return new List<FeedbackItem>();
            try { return Outbox.List(scope); } catch (Exception) { return new List<FeedbackItem>(); }
        }

        /// <summary>
        /// Шинэ хүсэлтийг дараалалд нэмж илгээлтийг эхлүүлнэ.  Нэвтрээгүй бол <see cref="InvalidOperationException"/>
        /// («Бүртгэл, эрх»-ээр нэвтэрнэ үү) — нэвтрээгүй үед бичсэн хүсэлтийг ХЭНИЙ нэрээр илгээхээ мэдэхгүй тул хадгалахгүй.
        /// </summary>
        public FeedbackItem Enqueue(FeedbackFields fields, string diagnosticsJson, IList<FeedbackSourceFile> files)
        {
            string scope = CurrentScope(out long userId, out string tenant, out string host);
            if (scope == null) throw new InvalidOperationException("Илгээхийн тулд «Бүртгэл, эрх»-ээр нэвтэрнэ үү.  Бичсэн зүйл тань цонхонд хадгалагдсан хэвээр.");
            string problem = fields?.Problem();
            if (problem != null) throw new InvalidOperationException(problem);
            var item = new FeedbackItem
            {
                Id = FeedbackItem.NewClientId("rvt"),
                Scope = scope,
                Host = FeedbackScope.NormalizeHost(host),
                Tenant = tenant,
                UserId = userId,
                CreatedAt = FeedbackTime.Iso(DateTimeOffset.UtcNow),
                State = FeedbackStates.Queued,
                Fields = fields.Clone(),
                DiagnosticsJson = diagnosticsJson,
            };
            item.UpdatedAt = item.CreatedAt;
            Outbox.Enqueue(item, files ?? new List<FeedbackSourceFile>());
            RaiseChanged();
            Kick();
            return item;
        }

        public bool Retry(FeedbackItem item)
        {
            FeedbackItem cur = Outbox.Load(item.Scope, item.Id);
            if (cur == null || FeedbackStates.IsTerminal(cur.State)) return false;
            using (IDisposable lease = Outbox.TryLease(cur))
            {
                if (lease == null) return false;
                FeedbackSender.ResetForRetry(cur);
                Outbox.Save(cur);
            }
            RaiseChanged();
            Kick();
            return true;
        }

        /// <summary>Илгээгдээгүй хүсэлтийг цуцална (илгээж байгаа бол false).  Серверийн ноорог 30 хоногт өөрөө цэвэрлэгдэнэ.</summary>
        public bool Cancel(FeedbackItem item)
        {
            FeedbackItem cur = Outbox.Load(item.Scope, item.Id);
            if (cur == null) return true;
            if (cur.State == FeedbackStates.Submitted) return false;
            using (IDisposable lease = Outbox.TryLease(cur))
            {
                if (lease == null) return false;
                cur.State = FeedbackStates.Cancelled;
                cur.NextAttemptAt = null;
                Outbox.Save(cur);
                Outbox.DropFiles(cur);
            }
            RaiseChanged();
            return true;
        }

        /// <summary>Нэг тик (давхардахгүй): ажиллаж байхад дахин дуудвал дууссаны дараа нэг удаа давтана.</summary>
        public void Kick()
        {
            if (_stop.IsCancellationRequested) return;
            if (Interlocked.CompareExchange(ref _running, 1, 0) != 0)
            {
                Interlocked.Exchange(ref _again, 1);
                return;
            }
            Task.Run(async () =>
            {
                try
                {
                    do
                    {
                        Interlocked.Exchange(ref _again, 0);
                        await RunOnceAsync(_stop.Token).ConfigureAwait(false);
                    }
                    while (Interlocked.CompareExchange(ref _again, 0, 1) == 1 && !_stop.IsCancellationRequested);
                }
                catch (Exception ex)
                {
                    Log("tick failed: " + ex.GetType().Name + ": " + ex.Message);
                }
                finally
                {
                    Interlocked.Exchange(ref _running, 0);
                }
            });
        }

        private async Task RunOnceAsync(CancellationToken ct)
        {
            string scope = CurrentScope(out _, out _, out _);
            if (scope == null) return;
            List<FeedbackItem> items = Outbox.List(scope);
            DateTimeOffset now = DateTimeOffset.UtcNow;
            List<FeedbackItem> due = items.Where(i => i.IsDue(now)).ToList();
            if (due.Count == 0)
            {
                Outbox.Prune(scope);
                return;
            }
            var transport = new FeedbackHttpTransport(scope, CurrentCredentials);
            await RefreshLimitsAsync(transport, ct).ConfigureAwait(false);
            var sender = new FeedbackSender(Outbox, transport);
            foreach (FeedbackItem it in due)
            {
                if (ct.IsCancellationRequested) break;
                using (IDisposable lease = Outbox.TryLease(it))
                {
                    if (lease == null) continue;   // өөр Revit процесс илгээж байна
                    FeedbackItem fresh = Outbox.Load(scope, it.Id);
                    if (fresh == null || !fresh.IsDue(DateTimeOffset.UtcNow)) continue;
                    string before = fresh.State;
                    string after = await sender.SendAsync(fresh, ct).ConfigureAwait(false);
                    Log(fresh.Id + " " + before + " → " + after + (fresh.LastError != null ? " (" + fresh.LastError.Code + ")" : ""));
                }
                RaiseChanged();
            }
        }

        /// <summary>Серверийн хязгаарыг цагт нэг удаа авна (амжилтгүй бол өгөгдмөл хэвээр — илгээлтийг саатуулахгүй).</summary>
        private async Task RefreshLimitsAsync(FeedbackHttpTransport transport, CancellationToken ct)
        {
            if (DateTimeOffset.UtcNow - _capsAt < TimeSpan.FromHours(1)) return;
            _capsAt = DateTimeOffset.UtcNow;
            try
            {
                string json = await transport.CapabilitiesJsonAsync(ct).ConfigureAwait(false);
                FeedbackLimits.ApplyCapabilities(json);
            }
            catch (Exception)
            {
                // хязгаарыг сервер илгээх үед ДАХИН шалгадаг тул өгөгдмөл хангалттай
            }
        }

        private void RaiseChanged()
        {
            try { Changed?.Invoke(); } catch (Exception) { }
        }

        internal static void Log(string line)
        {
            try
            {
                string dir = FeedbackOutbox.DefaultRoot();
                Directory.CreateDirectory(dir);
                string path = Path.Combine(dir, "feedback.log");
                var fi = new FileInfo(path);
                if (fi.Exists && fi.Length > 512 * 1024) File.Delete(path);
                File.AppendAllText(path, DateTimeOffset.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + FeedbackDiagnostics.Mask(line) + Environment.NewLine);
            }
            catch (Exception)
            {
                // лог бичигдэхгүй байх нь илгээлтээс чухал биш
            }
        }
    }
}
