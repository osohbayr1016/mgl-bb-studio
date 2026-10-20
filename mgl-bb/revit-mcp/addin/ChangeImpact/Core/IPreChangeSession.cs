using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>Хананы нэг тал — хөдөлгөөний чиглэл сонгох.</summary>
    public sealed class WallSideInfo
    {
        public int Index { get; set; }
        /// <summary>«Коридор тал руу» / «A тал руу» — өрөөний нэрийг ТААМАГЛАХГҮЙ: олдоогүй бол саармаг A/B.</summary>
        public string Label { get; set; }
        public double DirX { get; set; }
        public double DirY { get; set; }
        public long RoomId { get; set; }
        public string RoomName { get; set; }
    }

    /// <summary>Сонгосон ханын шалгалтын дүн — `Valid=false` бол `Problem` нь Монголоор «яагаад».</summary>
    public sealed class PreChangeSelection
    {
        public bool Valid { get; set; }
        public string Problem { get; set; }
        public long SourceId { get; set; }
        public string SourceUid { get; set; }
        public string Label { get; set; }
        public string TypeName { get; set; }
        public string LevelName { get; set; }
        public double LengthMm { get; set; }
        public double ThicknessMm { get; set; }
        public List<WallSideInfo> Sides { get; set; } = new List<WallSideInfo>();
        /// <summary>Сануулга (workshare checkout г.м.) — хориг биш.</summary>
        public List<string> Warnings { get; set; } = new List<string>();
        public int HostedCount { get; set; }
        /// <summary>Ажлын багийн загварт хана (эсвэл хамаарах элемент) хэнд ч эзэмшигдээгүй: preview түр эзэмшил (checkout) үүсгэж болзошгүй — эхлэхээс ӨМНӨ асууна.</summary>
        public bool NeedsCheckoutAck { get; set; }

        /// <summary>Сонгосон элементийн үйлдэл.  `DoorMove` үед `SourceId` = хаалга, доорх `Host*`/`Door*` талбарууд бөглөгдөнө.</summary>
        public PreChangeOperationKind Operation { get; set; }
        public long HostId { get; set; }
        public string HostUid { get; set; }
        public string HostLabel { get; set; }
        /// <summary>Хостын чиглэл (нэгж, XY) — offset-ийн тэмдгийг тодорхойлно.</summary>
        public double TangentX { get; set; }
        public double TangentY { get; set; }
        /// <summary>Хаалганы тэмдэглэгээ (Mark): «D-120».</summary>
        public string Mark { get; set; }
        public double DoorWidthMm { get; set; }
        public double DoorHeightMm { get; set; }
        /// <summary>Хаалганы хоёр талын өрөө (уншигдсан л бол).</summary>
        public string FromRoom { get; set; }
        public string ToRoom { get; set; }

        public static PreChangeSelection Invalid(string problem)
        {
            return new PreChangeSelection { Valid = false, Problem = problem };
        }
    }

    public sealed class ExitInfo
    {
        public string Uid { get; set; }
        public long Id { get; set; }
        public string Name { get; set; }
        public string Level { get; set; }
    }

    public sealed class ExitConfigResult
    {
        public bool Ok { get; set; }
        public string Message { get; set; }
        public List<ExitInfo> Exits { get; set; } = new List<ExitInfo>();
    }

    /// <summary>Файл (DocumentKey) тус бүрийн ГАРЦЫН хаалганы тохиргоо — UniqueId-аар, ЛОКАЛ (загварт бичихгүй).</summary>
    public sealed class ExitConfigFile
    {
        public List<ExitInfo> Exits { get; set; } = new List<ExitInfo>();
    }

    public static class PreChangeExitStore
    {
        public const int Schema = 1;
        /// <summary>Гарцын хаалганы дээд тоо — замын тооцоо нэр дэвшигч×гарц тул хязгаартай.</summary>
        public const int MaxExits = 12;

        private static readonly DocStore<ExitConfigFile> Store =
            new DocStore<ExitConfigFile>("prechange-exits.json", Schema, () => new ExitConfigFile());

        public static List<ExitInfo> Load(DocumentKey key)
        {
            LoadResult<ExitConfigFile> r = Store.Load(key);
            ExitConfigFile f = r.Value ?? new ExitConfigFile();
            return f.Exits ?? new List<ExitInfo>();
        }

        public static bool Save(DocumentKey key, List<ExitInfo> exits, out string error)
        {
            var f = new ExitConfigFile { Exits = exits ?? new List<ExitInfo>() };
            return Store.Save(key, f, out error);
        }
    }

    /// <summary>Зураг дээр (canvas) хананы талыг сонгосон дүн.</summary>
    public sealed class SidePickResult
    {
        public bool Cancelled { get; set; }
        /// <summary>Сонгосон талын индекс (`WallSideInfo.Index`).  `Cancelled`/алдаа үед -1.</summary>
        public int SideIndex { get; set; } = -1;
        public string Message { get; set; }

        public static SidePickResult Cancel() { return new SidePickResult { Cancelled = true }; }
        public static SidePickResult Fail(string msg) { return new SidePickResult { Message = msg }; }
        public static SidePickResult Of(int index) { return new SidePickResult { SideIndex = index }; }
    }

    /// <summary>
    /// «Сүүдэр» (ghost) зурах хүсэлт: хананы ШИНЭ байрлал (түр) — загварт БИЧИХГҮЙ.  Өнгө = шийдвэр (ногоон/шар/улаан/саарал).
    /// </summary>
    public sealed class PreChangeGhostRequest
    {
        public long WallId { get; set; }
        public double[] VectorMm { get; set; }
        public ApplyTone Tone { get; set; } = ApplyTone.Gray;
    }

    /// <summary>
    /// «Өөрчлөхөөс өмнө шалгах» цонхны Revit-тэй харилцах ГЭРЭЭ.  Цонх Revit-ийн төрлийг мэдэхгүй; бүх Revit ажил `await`-аар.
    /// ⚠️ `PreviewAsync` загварыг ӨӨРЧИЛӨХГҮЙ (түр транзакц буцаагдана).  `ApplyAsync` л бодит өөрчлөлт хийнэ.
    /// </summary>
    public interface IPreChangeSession
    {
        string DocumentTitle { get; }

        /// <summary>Revit-д одоо сонгогдсон ханыг шалгана (сонгоогүй бол Valid=false).</summary>
        Task<PreChangeSelection> GetSelectionAsync(CancellationToken ct);
        /// <summary>
        /// ХЯЛБАР шалгалт: Revit-д яг НЭГ хана сонгогдсон бол түүний UniqueId, үгүй бол null.  Цонх 2 секунд тутам өөр хана сонгогдсон эсэхийг үүгээр л шалгана
        /// (өрөө/хост/эзэмшлийн бүтэн `GetSelectionAsync` нь зөвхөн сонголт ӨӨРЧЛӨГДСӨН үед).
        /// </summary>
        Task<string> PeekSelectedWallAsync(CancellationToken ct);
        /// <summary>Revit-д ханыг сонгуулна (Revit-ийн status bar).  Цуцлавал Valid=false, Problem=null.</summary>
        Task<PreChangeSelection> PickWallAsync(CancellationToken ct);
        /// <summary>Зураг дээр цэг сонгуулж, хананы ямар тал руу зөөхийг (цэг ↔ хананы нормалийн скаляр үржвэр) тодорхойлно.</summary>
        Task<SidePickResult> PickSideAsync(PreChangeSelection wall, CancellationToken ct);

        /// <summary>
        /// Нөлөөллийг тооцно.  `onProvisional` — ТҮР ДҮН (`Stage == Quick`) бэлэн болоход (Revit-ийн thread-ээс; дуудагч өөрийн thread руу шилжүүлнэ).
        /// Буцаах тайлан нь эцсийн (`Stage == Full`).
        /// </summary>
        Task<PreChangeReport> PreviewAsync(PreChangeRequest request, IProgress<JobProgress> progress, Action<PreChangeReport> onProvisional, CancellationToken ct);
        Task<ApplyOutcome> ApplyAsync(PreChangeReport preview, PreChangeRequest currentRequest, IProgress<JobProgress> progress, CancellationToken ct);

        /// <summary>
        /// Preview-ийн дараа загвар өөрчлөгдсөн эсэх (Revit API-гүй, хурдан) — UI-ийн баннерт.  `Unknown` нь `Fresh` БИШ (fail-closed): баталгаажуулж чадаагүй
        /// бол Apply хаалттай.  (Линк/гарцын тохиргооны өөрчлөлтийг Apply-ийн мөчид бүтэн хурууны хээгээр шалгана.)
        /// </summary>
        FreshnessState CheckFreshness(PreChangeReport report);

        Task<SelectOutcome> ShowAsync(PreChangeItem item, CancellationToken ct);

        /// <summary>Эзэмшил (workshare checkout) сэрэмжлүүлгийг энэ хананд хэрэглэгч зөвшөөрсөн эсэх (энэ цонхны хугацаанд).</summary>
        bool OwnershipAcknowledged(PreChangeSelection wall);
        void AcknowledgeOwnership(PreChangeSelection wall);

        /// <summary>Ханын «сүүдэр»-ийг (DirectContext3D) зурна.  Загварт БИЧИХГҮЙ, транзакцгүй, Undo-д орохгүй.</summary>
        Task SetGhostAsync(PreChangeGhostRequest ghost, CancellationToken ct);
        /// <summary>Сүүдрийг арилгана (идемпотент).</summary>
        Task ClearGhostAsync();

        IReadOnlyList<ExitInfo> Exits();
        Task<ExitConfigResult> SetExitsFromSelectionAsync(CancellationToken ct);
        Task<ExitConfigResult> ClearExitsAsync(CancellationToken ct);
    }
}
