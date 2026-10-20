using System.Threading;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI;

namespace RevitMcpAddin.CloneDrawings
{
    public enum CdJobState
    {
        Queued,
        Running,
        Paused,
        Done,
        Cancelled,
        Failed,
    }

    /// <summary>
    /// АРЫН ГОРИМЫН ажил (<see cref="CdJobHost"/>) — Revit-ийн Idling дээр алхам алхмаар явж, хэрэглэгч хүлээх хооронд Revit-д
    /// үргэлжлүүлэн ажилладаг.  2026-10-01-нд «Зураг клонлох»-д (<see cref="CdJob"/>) зориулж хийсэн хостыг 2026-10-07-нд
    /// «Ханын дэлгээс» (<c>WallElevation.WeJob</c>) ч ашигладаг болсон — эзний хүсэлт: «хуудас үүсгэх дарсны дараа mouse loading
    /// болоод Revit-ээ ашиглаж чадахгүй байна, зураг клонлох шиг хүлээх хооронд дараагийн зургаа хийж суумаар байна».
    ///
    /// ГЭРЭЭ (хост ↔ ажил):
    ///   • <see cref="Step"/> = НЭГ богино алхам (нэг Transaction / TransactionGroup) — хэзээ ч шидэхгүй; алхмын гадуур нээлттэй
    ///     transaction үлдээхгүй.  Revit transaction хүлээж авахгүй үед <see cref="WaitingForRevit"/> = true (хост дараа нь дахин).
    ///   • <see cref="Pause"/>/<see cref="Resume"/>/<see cref="Cancel"/> — Revit API дуудахгүй (самбарын товч).
    ///   • <see cref="UndoAll"/>, <see cref="Open"/>, <see cref="Finished"/> — Revit API контекстод (хост Idling-д дуудна).
    ///   • <see cref="Card"/> — самбарын агшин зураг (Revit-ийн объектгүй); хост <c>Message</c>-ийг нэмнэ.
    /// </summary>
    internal interface IMglJob
    {
        int Number { get; }
        CdJobState State { get; }
        bool IsFinished { get; }
        bool WaitingForRevit { get; }
        bool DocAlive { get; }
        bool Undone { get; }
        bool Background { get; set; }
        double Fraction { get; }
        string Title { get; }

        /// <summary>Самбаргүй үед (хуучин Revit) дууссаны тайлангийн цонхны бичвэр.</summary>
        string FinalReport { get; }

        void Start();
        void Step(long budgetMs);
        void Pause();
        void Resume();
        void Cancel(string why = null);
        bool SameDoc(Document d);
        void OnDocumentChanged(DocumentChangedEventArgs e);
        string UndoAll();
        string Open(UIApplication app, bool sheet);
        CdJobCard Card();

        /// <summary>Дууссаны дараа нэг удаа (Revit API контекст) — жишээ нь хэрэглэгч хөдлөөгүй бол үр дүнг нээх.</summary>
        void Finished(UIApplication app);
    }

    /// <summary>Ажлын дугаар — бүх төрлийн ажилд НЭГ дараалал (самбарын товч дугаараар ажлаа олдог).</summary>
    internal static class MglJobSeq
    {
        private static int _n;

        internal static int Next() => Interlocked.Increment(ref _n);
    }
}
