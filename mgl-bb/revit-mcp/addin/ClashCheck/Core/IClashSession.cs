using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.ClashCheck.Core
{
    public enum ClashTarget { A, B, Both }

    /// <summary>Нэг шалгалтын эцсийн дүн (UI-д харуулах).  Issue-ийн жагсаалт нь `LoadState()`-ээр шинэчилнэ.</summary>
    public sealed class ClashRunOutcome
    {
        public ClashRunRecord Run { get; set; }
        public int New { get; set; }
        public int Resolved { get; set; }
        public int Reappeared { get; set; }
        public int Unverified { get; set; }
    }

    /// <summary>
    /// Clash цонхны Revit-тэй харилцах ГЭРЭЭ.  Цонх Revit-ийн төрлийг мэдэхгүй; бүх Revit ажил `await`-аар.
    /// `LoadState`/`UpdateState` нь Revit API-гүй (диск) тул UI thread-ээс шууд.
    /// </summary>
    public interface IClashSession
    {
        string DocumentTitle { get; }
        ClashRulesFile Rules { get; }
        void SaveRules();
        ClashState LoadState();
        /// <summary>
        /// Хадгалсан төлөвийг ШИНЭЭР уншиж (шалгалт тэр хооронд дүн нэмсэн байж болно) `mutate` хэрэглээд хадгална.
        /// Хэрэглэгчийн төлөв солилт ЗӨВХӨН энэ замаар — хуучирсан хуулбарыг буцааж бичихгүй.
        /// </summary>
        bool UpdateState(Action<ClashState> mutate, out string error);
        Task<IReadOnlyList<CategoryInfo>> GetCategoriesAsync(CancellationToken ct);
        Task<ClashRunOutcome> RunAsync(ClashRule rule, IProgress<JobProgress> progress, CancellationToken ct);
        Task<SelectOutcome> SelectAsync(ClashIssue issue, ClashTarget target, CancellationToken ct);
        /// <summary>Clash руу зөөлөн ойртуулж (zoom) харуулна; host элемент байвал сонгоно.</summary>
        Task<SelectOutcome> ShowAsync(ClashIssue issue, CancellationToken ct);
        /// <summary>Сүүлийн шалгалтаас хойш загвар өөрчлөгдсөн эсэх.</summary>
        bool IsStale(ClashRunRecord lastRun);
    }
}
