using System;

namespace RevitMcpAddin
{
    /// <summary>
    /// «ӨӨРЧЛӨХӨӨС ӨМНӨ ШАЛГАХ» (Change Impact Radar)-ын sandbox ажиллаж байх хугацаанд MGL-ийн ӨӨРИЙН `DocumentChanged` ажиглагчдыг
    /// «хэрэглэгч бодитоор өөрчлөлт хийлээ» гэж ойлгохоос сэргийлнэ.
    ///
    /// ЯАГААД: sandbox нь түр транзакц (TransactionGroup) нээж, хананы байрлалыг өөрчлөөд дараа нь БҮТНЭЭР буцаадаг.  Revit
    /// `DocumentChanged`-ийг коммит БА буцаалт бүрд ДАЛ ЭНЭ THREAD ДЭЭР, ЭСЭЛТЭЭР (synchronous) дуудна.  Аудит (2026-10-05) —
    /// MGL-ийн ажиглагчид:
    ///   • `ImpactCapture`         — өөрчлөлтийн бүртгэл.  `Suppress()` + энэ scope.
    ///   • `ModelChangeCounter`    — «хуучирсан» тэмдэг.  Буцаалтыг аль хэдийн алгасдаг, ГЭХДЭЭ sandbox-ийн коммит нь тоолуурыг өсгөнө.
    ///   • `ChangeTracker`         — AI туслахын «өнөөдөр юу өөрчилсөн» жагсаалт.  Буцаалтыг АЛГАСДАГГҮЙ.
    ///   • `RevitIntelligenceHost` — AI-ийн CONFIRM_WRITE preview-ийн `ChangeSeq`.  Буцаалтыг АЛГАСДАГГҮЙ.
    ///   • `CdJobHost`             — «Зураг клонлох» ажлын хяналт.
    /// Эдгээр нь `IsActive`-ийг шалгаж, scope дотор ирсэн үйл явдлыг орхино.
    ///
    /// ⚠️ ЗОРИУДААР ЗӨВХӨН MGL-ийн ажиглагчид: гуравдагч талын add-in-ийн `DocumentChanged`-ийг бид хаах эрхгүй (тэд sandbox-ийн
    /// коммит/буцаалтыг харна — docs/CHANGE_IMPACT_RADAR_MVP.md «Хязгаар»).
    ///
    /// Thread-static: үйл явдал sandbox-ийг ажиллуулсан thread дээр дуудагддаг тул өөр thread-ийн бодит өөрчлөлтийг ХЭЗЭЭ Ч хаахгүй.
    /// Давхар scope дэмжигдэнэ (гүн тоологч).
    /// </summary>
    internal static class ImpactSimulationScope
    {
        [ThreadStatic] private static int _depth;
        [ThreadStatic] private static int _defer;

        /// <summary>Энэ thread дээр sandbox ажиллаж байна (түр өөрчлөлт — ХЭЗЭЭ Ч дахин тоглуулахгүй).</summary>
        internal static bool IsActive
        {
            get { return _depth > 0; }
        }

        /// <summary>
        /// Энэ thread дээр Apply-ийн дотоод commit хойшлогдсон: ажиглагчид үйл явдлыг ШУУД бүртгэхгүй — `ImpactObservationSinks`-ээр
        /// бүлэг `Assimilate` хийгдсэний ДАРАА нэг удаа дахин тоглуулна (эсвэл буцвал хаяна).
        /// </summary>
        internal static bool IsDeferring
        {
            get { return _defer > 0; }
        }

        /// <summary>MGL-ийн ажиглагчид ЭНЭ thread-ийн одоогийн `DocumentChanged`-ийг боловсруулахгүй (sandbox эсвэл хойшлуулсан).</summary>
        internal static bool Suppressed
        {
            get { return _depth > 0 || _defer > 0; }
        }

        internal static IDisposable Begin()
        {
            _depth++;
#if MGL_SMART
            IDisposable capture = null;
            try { capture = ChangeImpact.ImpactCapture.Suppress(); }
            catch (Exception) { /* бүртгэл суугаагүй — IsActive шалгалт л үлдэнэ */ }
            return new Token(capture, false);
#else
            return new Token(null, false);
#endif
        }

        /// <summary>Apply-ийн дотоод commit-ийн ажиглалтыг хойшлуулна.  `Dispose` = хойшлуулалт дууссан (replay/discard-ийн ДАРАА).</summary>
        internal static IDisposable BeginDeferral()
        {
            _defer++;
#if MGL_SMART
            IDisposable capture = null;
            try { capture = ChangeImpact.ImpactCapture.Suppress(); }
            catch (Exception) { }
            return new Token(capture, true);
#else
            return new Token(null, true);
#endif
        }

        private sealed class Token : IDisposable
        {
            private readonly IDisposable _inner;
            private readonly bool _deferral;
            private bool _done;

            public Token(IDisposable inner, bool deferral) { _inner = inner; _deferral = deferral; }

            public void Dispose()
            {
                if (_done) return;
                _done = true;
                try { if (_inner != null) _inner.Dispose(); }
                catch (Exception) { }
                if (_deferral) { if (_defer > 0) _defer--; }
                else if (_depth > 0) _depth--;
            }
        }
    }
}
