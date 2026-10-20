using System;
using System.Collections.Generic;

namespace RevitMcpAddin.ChangeImpact.Core
{
    public enum DeferralState
    {
        Idle = 0,
        /// <summary>Өөрчлөлтийн үйл явдлыг хуримтлуулж байна (одоохондоо хэнд ч «нийтлээгүй»).</summary>
        Deferring,
        /// <summary>Бодит өөрчлөлт баталгаажсан — хуримтлуулсныг НЭГ удаа, дарааллаар нь нийтэлсэн.</summary>
        Published,
        /// <summary>Группийг буцаасан — хуримтлуулсныг хаясан (хэн ч харахгүй).</summary>
        Discarded,
    }

    /// <summary>
    /// «Хойшлуулсан ажиглалт»-ын ЦЭВЭР төлөвийн машин (Revit-гүй, тестлэгдэнэ).
    ///
    ///   Idle ──Begin──► Deferring ──Add*──► Deferring ──Publish──► Published   (хуримтлуулсныг дарааллаар нэг удаа sink-д өгнө)
    ///                                              └──Discard──► Discarded   (юу ч нийтлэхгүй)
    ///
    /// ЯАГААД: Apply нь `TransactionGroup { Transaction(commit) → settled-төлөв тулгах }`.  Дотоод commit-ийн `DocumentChanged` нь бүлэг
    /// `Assimilate` хийгдэх эсвэл `RollBack` болох ЭСЭХ нь мэдэгдэхээс ӨМНӨ ирдэг.  MGL-ийн ажиглагчид (ChangeTracker, ImpactCapture, ModelChangeCounter...)
    /// тэр өөрчлөлтийг шууд бүртгэвэл, дараа нь буцаагдсан үед «хэзээ ч болоогүй өөрчлөлт» түүхэнд үлдэнэ.  Тиймээс ажиглагчид хойшлогдсон
    /// үед үйл явдлыг ӨӨРСДӨӨ боловсруулахгүй; энэ буфер ДЭЭР хуулбарлан (detached) хадгалж, бүлэг БАТАЛГААЖСНЫ дараа л нэг удаа дахин тоглуулна.
    ///
    /// Гэрээ:
    ///   • `Add` нь ЗӨВХӨН `Deferring` үед хүлээн авна (бусад үед false — алдагдахгүйгээр дуудагч мэднэ).
    ///   • `Publish` / `Discard` нь ДАХИН дуудахад хоёр дахь удаа юу ч хийхгүй (идемпотент) — нэг өөрчлөлт хоёр удаа бүртгэгдэхгүй.
    ///   • `Publish` нь sink-ийн алдааг тусгаарлана: нэг sink унахад үлдсэн үйл явдал алдагдахгүй (унасан тоог буцаана).
    ///   • Thread-safe (Revit-ийн үндсэн thread дээр л ашиглагдах ч дотоод буфер түгжээтэй).
    /// </summary>
    public sealed class ObservationBuffer<T>
    {
        private readonly object _gate = new object();
        private readonly List<T> _items = new List<T>();
        private DeferralState _state = DeferralState.Idle;

        public DeferralState State { get { lock (_gate) return _state; } }
        public int Count { get { lock (_gate) return _items.Count; } }

        /// <summary>`Idle → Deferring`.  Аль хэдийн эхэлсэн/дууссан бол false.</summary>
        public bool Begin()
        {
            lock (_gate)
            {
                if (_state != DeferralState.Idle) return false;
                _state = DeferralState.Deferring;
                return true;
            }
        }

        /// <summary>Хуримтлуулна.  Зөвхөн `Deferring` үед.</summary>
        public bool Add(T item)
        {
            lock (_gate)
            {
                if (_state != DeferralState.Deferring) return false;
                _items.Add(item);
                return true;
            }
        }

        /// <summary>
        /// `Deferring → Published`: хуримтлуулсныг ДАРААЛЛААР `sink`-д нэг удаа өгнө.  Өгсөн тоог буцаана; `failed` = sink-ийн алдсан тоо.
        /// Төлөв `Deferring` биш бол юу ч хийхгүй (0).
        /// </summary>
        public int Publish(Action<T> sink, out int failed)
        {
            failed = 0;
            List<T> snapshot;
            lock (_gate)
            {
                if (_state != DeferralState.Deferring) return 0;
                _state = DeferralState.Published;      // sink дотроос `Add` дуудагдвал хүлээн авахгүй
                snapshot = new List<T>(_items);
                _items.Clear();
            }
            int delivered = 0;
            foreach (T item in snapshot)
            {
                try { if (sink != null) sink(item); delivered++; }
                catch (Exception) { failed++; }
            }
            return delivered;
        }

        /// <summary>`Deferring → Discarded`: юу ч нийтлэхгүй.  Хаясан тоог буцаана.  Төлөв `Deferring` биш бол 0.</summary>
        public int Discard()
        {
            lock (_gate)
            {
                if (_state != DeferralState.Deferring) return 0;
                _state = DeferralState.Discarded;
                int n = _items.Count;
                _items.Clear();
                return n;
            }
        }
    }
}
