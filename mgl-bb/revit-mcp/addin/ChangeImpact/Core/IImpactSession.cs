using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>Нөлөөллийн шинжилгээний хүсэлт — аль өөрчлөлтүүдийг шинжлэх, ямар гүнзгий.</summary>
    public sealed class ImpactRequest
    {
        /// <summary>`Seq` НЬ ЭНЭ ДУГААРААС ИХ өөрчлөлтүүдийг шинжилнэ (checkpoint-ийн дугаар).</summary>
        public long FromSeqExclusive { get; set; }
        public long ToSeqInclusive { get; set; } = long.MaxValue;
        /// <summary>Заасан бол ЗӨВХӨН эдгээр багцыг (муж дотроос).  null = муж доторх бүгд.</summary>
        public IReadOnlyCollection<long> OnlyBatchSeqs { get; set; }
        /// <summary>«Магадгүй харагдаж байна» (C) шинжилгээ — харагдац бүрийг Revit-ээр шүүх тул ХУРДАН БИШ.</summary>
        public bool IncludeVisibility { get; set; } = true;
        /// <summary>
        /// Заасан бол Revit-ийн `Document.GetChangedElements(versionGuid)`-ээр ТЭР хувилбараас хойших өөрчлөлтийг
        /// (манай бүртгэлд ОРООГҮЙ — өөр session/хэрэглэгч) нэмж шинжилнэ.  ⚠️ Revit өөрөө «version GUID бүх өөрчлөлтөд
        /// шинэчлэгддэггүй» гэсэн тул ЗӨВХӨН НЭМЭЛТ нотолгоо (зөвхөн-засвар өөрчлөлтийг алгасаж болно).
        /// </summary>
        public string BaselineVersionGuid { get; set; }
        /// <summary>Хүснэгтийн (schedule) хамаарал.</summary>
        public bool IncludeSchedules { get; set; } = true;
        /// <summary>Өрөөний хилийн хамаарал (өрөө бүрийн хилийг уншдаг — олон өрөөтэй загварт удаан).</summary>
        public bool IncludeRooms { get; set; } = true;
        public ImpactLimits Limits { get; set; }
    }

    /// <summary>
    /// «Өөрчлөлтийн нөлөө» цонхны Revit-тэй харилцах ГЭРЭЭ.  Цонх Revit-ийн төрлийг мэдэхгүй; бүх Revit ажил `await`-аар.
    /// Бүртгэл/түүхийг унших нь Revit API-гүй (санах ой + диск) тул UI thread-ээс шууд.
    /// </summary>
    public interface IImpactSession
    {
        string DocumentTitle { get; }
        /// <summary>Өөрчлөлт бүртгэх (DocumentChanged) идэвхтэй эсэх — унтраавал шинэ өөрчлөлт бүртгэгдэхгүй.</summary>
        bool TrackingEnabled { get; set; }
        /// <summary>Бүртгэгдээгүй (хэт олон/дараалал дүүрсэн) багцын тоо.</summary>
        int DroppedBatches { get; }

        /// <summary>Хүлээгдэж буй өөрчлөлтийн ИДЕНТИТИ-г (Revit-ээр) уншиж, бүртгэлийн ХУУЛБАР буцаана.</summary>
        Task<IReadOnlyList<ChangeBatch>> GetBatchesAsync(CancellationToken ct);

        IReadOnlyList<ModelCheckpoint> Checkpoints();
        Task<ModelCheckpoint> AddCheckpointAsync(string label, CancellationToken ct);
        void DeleteCheckpoint(string id);

        Task<ImpactReport> AnalyzeAsync(ImpactRequest request, IProgress<JobProgress> progress, CancellationToken ct);
        ImpactReport LastReport();
        IReadOnlyList<ImpactReportHeader> History();

        /// <summary>Хуудас/харагдацыг нээнэ, элемент бол сонгож ойртуулна.</summary>
        Task<SelectOutcome> ShowAsync(ImpactItem item, CancellationToken ct);
        /// <summary>Тайлан гарсанаас хойш загвар өөрчлөгдсөн эсэх.</summary>
        bool IsStale(ImpactReport report);
        /// <summary>Бүртгэлийг (өөрчлөлтийн багцууд) цэвэрлэнэ — шалгах цэг, түүх хөндөгдөхгүй.</summary>
        Task ClearLogAsync(CancellationToken ct);
    }
}
