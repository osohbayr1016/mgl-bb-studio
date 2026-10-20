using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace RevitMcpAddin.ChangeImpact.Core
{
    public sealed class SimLoadProgress
    {
        public int Done { get; set; }
        public int Total { get; set; }
    }

    /// <summary>Сцен ачаалсан дүн.  `Ok=false` бол `Problem` — ЯАГААД (Монголоор).</summary>
    public sealed class SimLoadOutcome
    {
        public bool Ok { get; set; }
        public string Problem { get; set; }
        /// <summary>Revit энэ элементийг зөөлгүй нь тодорхой (Pin, өөр хэрэглэгчийн эзэмшил) — «зөөхгүй».</summary>
        public bool Refused { get; set; }
        /// <summary>Ажлын багийн загвар: элемент хэнд ч эзэмшигдээгүй — шинжилгээ түр эзэмшил үүсгэж болзошгүй, ЭХЛЭЭД хэрэглэгчээс асууна.</summary>
        public bool NeedsOwnershipAck { get; set; }
        public SimScene Scene { get; set; }
        public double LoadMs { get; set; }
        public string DocumentTitle { get; set; }
        /// <summary>Ачаалах үеийн загварын өөрчлөлтийн тэмдэг — загвар түүнээс хойш өөрчлөгдсөн эсэхийг мэдэхэд.</summary>
        public string Stamp { get; set; }
    }

    /// <summary>
    /// Simulation цонхны Revit-тэй харилцах гэрээ.  Цонх (модальгүй) Revit API-д ЗӨВХӨН энэ сессээр хүрнэ; хулганаар чирэх үед ЭНД ЮУ Ч дуудагдахгүй (бүх урьдчилсан тооцоо цонхны thread-д, Core-д).
    /// Revit-д очдог зүйл: ачаалалт (1 удаа), «Revit-ээр шалгах» (чирж дуусаад), «Зөвшөөрөх» (1 удаа), зураг дээрх сүүдэр, элементийг Revit-д харуулах.
    /// </summary>
    public interface ISimSession
    {
        string DocumentTitle { get; }
        Task<SimLoadOutcome> LoadAsync(IProgress<SimLoadProgress> progress, CancellationToken ct);
        bool OwnershipAcknowledged { get; }
        void AcknowledgeOwnership();
        /// <summary>Revit-ийн sandbox (TransactionGroup, ҮРГЭЛЖ RollBack): энэ offset-д ЯГ зөөгөөд settled төлвийг уншина.  Generation-тэй (хуучин нь шинийг дарахгүй).</summary>
        Task<SimExactResult> AnalyzeAsync(SimVec offsetMm, int generation, CancellationToken ct);
        /// <summary>Нэг бодит зөөлт (нэг Undo).  `preview` нь ЯГ энэ offset-ийн Simulated дүн байх ёстой.</summary>
        Task<ApplyOutcome> ApplyAsync(SimVec offsetMm, SimExactResult preview, CancellationToken ct);
        /// <summary>Revit-ийн зураг дээрх (DirectContext3D) сүүдэр — зөвхөн дэлгэц, загварт бичихгүй.  Идэмпотент, Revit API-г хүлээхгүй.</summary>
        void ShowGhost(GhostScene scene);
        void ClearGhost();
        /// <summary>Revit-д элементийг сонгож, харагдац руу ойртуулна (мөр дээр дарахад).</summary>
        Task ShowElementAsync(long id, int slot, CancellationToken ct);
        /// <summary>Загвар `stamp`-аас хойш өөрчлөгдсөн эсэх (Revit API-гүй, ChangeStamp).  true = өөрчлөгдсөн (эсвэл тэмдэг уншигдсангүй — fail-closed).</summary>
        bool ModelChangedSince(string stamp);
        /// <summary>Revit-ийн дотоод нэгж / мм (`UnitUtils`) — зураг дээрх сүүдрийг угсрахад.</summary>
        double InternalUnitsPerMm { get; }
        /// <summary>Revit-д зөөх элемент сонгуулна (хэрэглэгч Revit-ийн зураг дээр дарна; Esc = цуцлах).  Хоосон = цуцалсан / сонгоогүй.</summary>
        Task<IList<long>> PickAsync(CancellationToken ct);
        /// <summary>Дараагийн `LoadAsync` ЭНЭ элемент(үүд)-ийг ачаална.</summary>
        void SetSelection(IList<long> ids);
    }
}
