using System;
using System.Threading;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI;
using RevitMcpAddin.ChangeImpact.Core;
using RevitMcpAddin.Smart;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// Apply-ийн `TransactionGroup` дотор дотоод commit-ийн `DocumentChanged`-ийг ХОЙШЛУУЛНА (Revit-тэй хэсэг; төлөвийн машин нь
    /// <see cref="ObservationBuffer{T}"/> — ЦЭВЭР, тестлэгдсэн).
    ///
    ///   Begin    MGL-ийн ажиглагчдыг «хойшлогдсон» болгоно (`ImpactSimulationScope.BeginDeferral`) + энэ баримтын үйл явдлыг хуулбарлан (detached) буферлэнэ
    ///   Publish  бүлэг `Assimilate` АМЖИЛТТАЙ болсны дараа: хойшлолтыг БОЛИУЛААД (ImpactCapture-ийн дарангуйлал суларна) буферлэсэн ҮНЭН өөрчлөлтийг
    ///            `ImpactObservationSinks`-ээр НЭГ УДАА, дарааллаар нь дахин тоглуулна
    ///   Discard  бүлэг буцсан: буферийг хаяна — түүхэнд ХЭЗЭЭ Ч болоогүй өөрчлөлт үлдэхгүй
    ///
    /// ⚠️ ЗӨВХӨН MGL-ийн ажиглагчид.  Гуравдагч талын add-in `DocumentChanged`-ийг ӨӨРСДӨӨ харна (Revit-ийн хязгаар — баримтжуулсан).
    /// ⚠️ Хуулбар алдвал (`Lost`) дахин тоглуулалт ДУТУУ: `ImpactCapture`-д «цоорхой» гэж тэмдэглэнэ — өөрчлөлт чимээгүй алдагдахгүй.
    /// </summary>
    internal sealed class ObservationDeferral : IDisposable
    {
        private readonly UIApplication _app;
        private readonly Document _doc;
        private readonly ObservationBuffer<DetachedDocChange> _buffer = new ObservationBuffer<DetachedDocChange>();
        private readonly EventHandler<DocumentChangedEventArgs> _listener;
        private IDisposable _scope;
        private bool _listening;
        private int _lost;

        /// <summary>Хуулбарлаж чадаагүй үйл явдлын тоо (дахин тоглуулалт дутуу).</summary>
        internal int Lost { get { return Volatile.Read(ref _lost); } }
        internal DeferralState State { get { return _buffer.State; } }
        internal int Buffered { get { return _buffer.Count; } }

        private ObservationDeferral(UIApplication app, Document doc)
        {
            _app = app;
            _doc = doc;
            _listener = OnChanged;
        }

        internal static ObservationDeferral Begin(UIApplication app, Document doc)
        {
            var d = new ObservationDeferral(app, doc);
            d._buffer.Begin();
            d._scope = ImpactSimulationScope.BeginDeferral();
            try { app.Application.DocumentChanged += d._listener; d._listening = true; }
            catch (Exception) { Interlocked.Increment(ref d._lost); }
            return d;
        }

        private void OnChanged(object sender, DocumentChangedEventArgs e)
        {
            try
            {
                Document d = e.GetDocument();
                if (d == null || !SmartDocs.Same(d, _doc)) return;
                DetachedDocChange c = DetachedDocChange.From(e);
                if (c == null || !_buffer.Add(c)) Interlocked.Increment(ref _lost);
            }
            catch (Exception) { Interlocked.Increment(ref _lost); }
        }

        private void Unlisten()
        {
            if (!_listening) return;
            _listening = false;
            try { _app.Application.DocumentChanged -= _listener; } catch (Exception) { }
        }

        private void EndScope()
        {
            IDisposable s = _scope;
            _scope = null;
            if (s != null) { try { s.Dispose(); } catch (Exception) { } }
        }

        /// <summary>Бүлэг баталгаажлаа: хойшлолтыг дуусгаад хуримтлуулсныг НЭГ удаа нийтэлнэ.  Нийтэлсэн тоог буцаана.</summary>
        internal int Publish()
        {
            Unlisten();
            EndScope();                              // ЭХЛЭЭД дарангуйллыг салгана — эс бөгөөс ImpactCapture тоглуулсныг хаяна
            int failed;
            int n = _buffer.Publish(c => { int f = ImpactObservationSinks.Replay(c); if (f > 0) Interlocked.Increment(ref _lost); }, out failed);
            if (failed > 0 || Lost > 0) ReportGap();
            return n;
        }

        /// <summary>Бүлэг буцлаа: хаяна.  Хаясан тоо.</summary>
        internal int Discard()
        {
            Unlisten();
            int n = _buffer.Discard();
            EndScope();
            return n;
        }

        /// <summary>
        /// Хуулбар/тоглуулалт ДУТУУ: нэг ч ажиглагч хэмжээгээ мэдэхгүй өөрчлөлт бодитоор болсон — `ImpactCapture`-д цоорхой гэж тэмдэглэнэ
        /// (өөрчлөлтийн бүртгэл «бүрэн БИШ» гэж ИЛ хэлнэ).
        /// </summary>
        private static void ReportGap()
        {
            try { ImpactCapture.ReportLostObservation(); } catch (Exception) { }
            SmartLog.Warn("prechange", "observation_gap", null);
        }

        public void Dispose()
        {
            // Аюулгүйн сүлжээ: Publish/Discard дуудагдаагүй (exception) бол ХАЯНА — хойшлуулсныг баталгаагүй нийтлэхгүй.
            if (_buffer.State == DeferralState.Deferring) Discard();
            else { Unlisten(); EndScope(); }
        }
    }
}
