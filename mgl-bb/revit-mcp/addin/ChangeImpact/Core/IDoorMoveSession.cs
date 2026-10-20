using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>Хаалганы контекстыг (хост, нүх, саад, өрөө) унших дүн.  `Ok=false` бол `Problem` Монголоор «яагаад».</summary>
    public sealed class DoorContextLoad
    {
        public bool Ok { get; set; }
        public string Problem { get; set; }
        /// <summary>Revit энэ зөөлтийг ХИЙЛГЭХГҮЙ нь тодорхой (Pin, өөр хэрэглэгчийн эзэмшил) → 🔴.  false = зүгээр л дэмжигдээгүй → ⚪.</summary>
        public bool Refused { get; set; }
        public DoorMoveContext Context { get; set; }
        public List<string> Warnings { get; set; } = new List<string>();

        public static DoorContextLoad Fail(string problem, bool refused = false)
        {
            return new DoorContextLoad { Ok = false, Problem = problem, Refused = refused };
        }
    }

    /// <summary>Зураг дээр шинэ байрлал сонгосон дүн.  `OffsetMm` = хаалганы ОДООГИЙН төвөөс хостын дагуух тэмдэгтэй зай (мм).</summary>
    public sealed class DoorTargetPick
    {
        public bool Cancelled { get; set; }
        public string Message { get; set; }
        public double? OffsetMm { get; set; }

        public static DoorTargetPick Cancel() { return new DoorTargetPick { Cancelled = true }; }
        public static DoorTargetPick Fail(string msg) { return new DoorTargetPick { Message = msg }; }
        public static DoorTargetPick Of(double offsetMm) { return new DoorTargetPick { OffsetMm = offsetMm }; }
    }

    /// <summary>
    /// «Хаалга зөөх» симуляцийн Revit-тэй харилцах ГЭРЭЭ (`IPreChangeSession`-ий НЭМЭЛТ — preview/apply/харуулах/эзэмшил нь тэндээс).
    /// Цонх Revit-ийн төрлийг мэдэхгүй.  ⚠️ Энэ интерфейсийн АЛЬ Ч метод загварт ӨӨРЧЛӨЛТ ХИЙХГҮЙ; зөвхөн `IPreChangeSession.ApplyAsync` л бодит өөрчлөлт хийнэ.
    /// </summary>
    public interface IDoorMoveSession
    {
        /// <summary>Revit-д яг НЭГ хаалга сонгогдсон бол шалгаж буцаана (сонгоогүй бол Valid=false, Problem=null).</summary>
        Task<PreChangeSelection> GetDoorSelectionAsync(CancellationToken ct);
        /// <summary>Хялбар шалгалт: яг НЭГ хаалга сонгогдсон бол UniqueId (цонх 2 секунд тутам).</summary>
        Task<string> PeekSelectedDoorAsync(CancellationToken ct);
        /// <summary>Revit-д хаалгыг сонгуулна (native pick).  Цуцлавал Valid=false, Problem=null.</summary>
        Task<PreChangeSelection> PickDoorAsync(CancellationToken ct);
        /// <summary>Хаалганы контекстыг (хост геометр, бусад нүх, саад, өрөө) уншина.  Загварын тэмдэг өөрчлөгдөөгүй бол кэшээс.</summary>
        Task<DoorContextLoad> LoadContextAsync(PreChangeSelection door, CancellationToken ct);
        /// <summary>Контекст одоогийн загвартай таарч байгаа эсэх (Revit API-гүй, хурдан).  Тэмдэг уншигдаагүй = false (fail-closed).</summary>
        bool IsContextCurrent(DoorMoveContext ctx);
        /// <summary>Revit-ийн PickPoint-оор шинэ байрлал сонгуулж, хостын төв шугам дээр проекц хийнэ.</summary>
        Task<DoorTargetPick> PickTargetAsync(DoorMoveContext ctx, CancellationToken ct);

        /// <summary>
        /// Ghost + тодруулгыг ШУУД шинэчилнэ.  Блоклодоггүй; хамгийн сүүлийнх нь л үлдэнэ (latest-wins).  Загварт БИЧИХГҮЙ, транзакцгүй, Undo-д орохгүй.
        /// `visual.Generation` нь хуучирсан зураглалыг (удаан дууссан) шинийг дарахгүй байхад.
        /// </summary>
        void ShowVisual(DoorVisualState visual);
        /// <summary>Ghost, тодруулгыг арилгана (идемпотент).</summary>
        void ClearVisual();
    }
}
