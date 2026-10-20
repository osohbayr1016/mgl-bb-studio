using System.Threading.Tasks;
using RevitMcpAddin.SheetNumerator.Core;

namespace RevitMcpAddin.SheetNumerator.Ui
{
    /// <summary>
    /// Цонх (ViewModel) → Revit руу хүрэх ГАНЦ хаалга.  ViewModel нь Revit-ийн ямар ч төрөл ХАРАХГҮЙ —
    /// бүх Revit ажил ExternalEvent-ээр (Revit-ийн API контекстэд) хийгдэж, үр дүн нь ЭНГИЙН DTO-оор буцна.
    /// Тест, UI smoke-д хуурамч хэрэгжүүлэлт (Revit-гүй) тавина.
    ///
    /// ⚠️ Бүх Task нь UI thread дээр үргэлжилнэ (дуудсан thread-ийн SynchronizationContext).
    /// </summary>
    public interface ISheetNumeratorGateway
    {
        /// <summary>Идэвхтэй document-ийн БҮХ хуудсыг snapshot болгон уншина.</summary>
        Task<SnapshotResult> LoadAsync();

        /// <summary>Төлөвлөсөн өөрчлөлтийг АТОМ байдлаар (TransactionGroup) бичнэ.</summary>
        Task<ApplyResult> ApplyAsync(ApplyRequest request);

        Task<OperationResult> RenameAsync(RenameRequest request);

        Task<OperationResult> DeleteAsync(DeleteRequest request);

        /// <summary>Хөнгөн «тамга» (document key + бүх хуудасны дугаар/нэр) — хуучирсан эсэхийг шалгахад.</summary>
        Task<DocumentStamp> ReadStampAsync();

        /// <summary>Үл үзэгдэх тэмдэг Revit-д хадгалагдах эсэхийг БОДИТООР шалгана (буцаагддаг Transaction).</summary>
        Task<MarkerCapabilities> ProbeMarkersAsync();

        /// <summary>Техникийн логийн зам (алдааны мессежид).</summary>
        string LogPath { get; }
    }
}
