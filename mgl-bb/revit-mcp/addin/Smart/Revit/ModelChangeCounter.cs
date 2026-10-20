using System;
using System.Threading;
using Autodesk.Revit.ApplicationServices;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Events;

namespace RevitMcpAddin.Smart
{
    /// <summary>
    /// Загварын «өөрчлөлтийн дугаар» — үр дүн (Smart Count, Clash) ХУУЧИРСАН эсэхийг шийднэ.
    ///
    /// ЯАГААД `Document.GetDocumentVersion().VersionGUID` БИШ: Revit өөрөө «GUID нь өөрчлөлт бүрд заавал
    /// шинэчлэгдэхгүй байж болно» гэж баримтжуулсан (`DocumentVersion.VersionGUID`) — «хуучирсан»-ыг
    /// мэдэхгүй өнгөрөөх эрсдэлтэй.  Харин `DocumentChanged` нь коммит, undo, redo бүрд дуудагддаг.
    ///
    /// ⚠️ Handler нь ХАЛУУН ЗАМ: транзакц бүрд дуудагдана.  Зөвхөн атом өсгөлт — диск, лог, түлхүүр тооцоолол,
    /// элемент унших ХЭЗЭЭ Ч үгүй.  Баримт бүрийн тоолуур `DocumentTable`-д (Revit-ийн `Equals`/`GetHashCode`-оор тодорхойлогдоно —
    /// ижил баримтын өөр wrapper-т ч ижил тоолуур).  Дугаар нь баримтын нээлт тутамд хамаарах тул файл хаагаад дахин
    /// нээхэд `Stamp` өөрчлөгдөнө — өмнөх үр дүн «хуучирсан» болно.
    /// </summary>
    /// <summary>
    /// Нэг баримтын (нээлт тутмын) өөрчлөлтийн тоолуурын БАРИХ ХЭРЭГСЭЛ.  Session үүсгэх үед (Revit API context) авч, дараа нь цонхны
    /// thread-ээс `Current`-ийг ШУУД уншина — `Document` обьектод (Revit API: `Equals`/`GetHashCode` ч) хүрэх шаардлагагүй.
    /// </summary>
    internal sealed class ChangeStamp
    {
        internal readonly string Id = Guid.NewGuid().ToString("N").Substring(0, 8);
        internal long Count;

        /// <summary>Одоогийн тэмдэг: `&lt;нээлтийн id&gt;:&lt;өөрчлөлтийн тоо&gt;`.</summary>
        public string Current
        {
            get { return Id + ":" + Interlocked.Read(ref Count); }
        }
    }

    internal static class ModelChangeCounter
    {
        private static readonly DocumentTable<ChangeStamp> Boxes = new DocumentTable<ChangeStamp>();
        private static ControlledApplication _app;

        internal static void Init(ControlledApplication app)
        {
            if (_app != null || app == null) return;
            _app = app;
            app.DocumentChanged += OnChanged;
            app.DocumentClosed += OnClosed;
            ImpactObservationSinks.Register("model-change-counter", OnReplayed);
        }

        internal static void Shutdown()
        {
            try
            {
                if (_app != null)
                {
                    _app.DocumentChanged -= OnChanged;
                    _app.DocumentClosed -= OnClosed;
                    ImpactObservationSinks.Unregister("model-change-counter");
                }
            }
            catch (Exception) { }
            _app = null;
        }

        /// <summary>
        /// Баримт ХААГДСАН (`DocumentClosed` нь хаалт цуцлагдсан үед ч ирдэг — амьд баримтыг `IsValidObject`-оор үлдээнэ).  Хаагдсан баримтын
        /// тоолуурыг (`DocumentTable` нь баримтыг хүчтэй лавладаг) болон түр тэмдгийг санах ойгоос цэвэрлэнэ.
        /// </summary>
        private static void OnClosed(object sender, DocumentClosedEventArgs e)
        {
            try
            {
                Boxes.PurgeDead();
                RevitDocumentKeys.PurgeClosed();
                RevitMcpAddin.ChangeImpact.PreChangePlanCache.PurgeAll();   // хаагдсан баримтын «өөрчлөхөөс өмнө шалгах» кэш (id л) үлдэхгүй
            }
            catch (Exception) { }
        }

        private static void OnChanged(object sender, DocumentChangedEventArgs e)
        {
            try
            {
                // «Өөрчлөхөөс өмнө шалгах»-ын sandbox коммитлоод буцаадаг — загварыг ӨӨРЧЛӨӨГҮЙ; Apply-ийн дотоод commit хойшлогдсон (SimulationScope.cs).
                if (ImpactSimulationScope.Suppressed) return;
                Count(e.GetDocument(), e.Operation);
            }
            catch (Exception)
            {
                // Тоолуур нь ХЭЗЭЭ Ч транзакцийг саатуулах ёсгүй.
            }
        }

        /// <summary>Хойшлуулсан (Apply-ийн баталгаажсан) commit-ийг ЭНЭ тоолуурт нэг удаа тоолно.</summary>
        private static void OnReplayed(DetachedDocChange c)
        {
            Count(c.GetDocument(), c.Operation);
        }

        private static void Count(Document d, UndoOperation op)
        {
            // Буцаасан (rolled back) транзакц загварыг ӨӨРЧЛӨӨГҮЙ — жишээ нь Smart Publish-ийн IFC экспортын түр транзакц;
            // тоолбол Count/Clash-ийн үр дүн экспорт бүрийн дараа «хуучирсан» болно.
            if (op == UndoOperation.TransactionRolledBack || op == UndoOperation.TransactionGroupRolledBack) return;
            if (d == null) return;
            Interlocked.Increment(ref Boxes.GetOrAdd(d, () => new ChangeStamp()).Count);
        }

        /// <summary>
        /// Загвар БОДИТОЙР өөрчлөгдсөн (эсвэл өөрчлөгдсөн эсэх нь баталгаагүй) атлаа ажиглагчдын `DocumentChanged` тоолуурт хүрээгүй үед (Apply-ийн хойшлуулсан
        /// commit-ийг дахин тоглуулж чадаагүй г.м.) тэмдгийг ХҮЧЭЭР урагшлуулна — өмнөх preview/кэш «хуучраагүй» гэж үлдэхгүй.  Fail-closed.
        /// </summary>
        internal static void ForceBump(Document doc)
        {
            if (doc == null) return;
            try { Interlocked.Increment(ref HandleFor(doc).Count); } catch (Exception) { }
        }

        /// <summary>`before`-оос хойш тэмдэг ӨӨРЧЛӨГДӨӨГҮЙ бол л <see cref="ForceBump"/> — аль хэдийн урагшилсан бол давхар нэмэхгүй.</summary>
        internal static void EnsureAdvanced(Document doc, string before)
        {
            if (doc == null) return;
            try { if (string.Equals(Stamp(doc), before, StringComparison.Ordinal)) ForceBump(doc); } catch (Exception) { }
        }

        /// <summary>Баримтын тоолуурын барих хэрэгсэл (Revit API context-д: command, `SmartExecutor` job, event).</summary>
        internal static ChangeStamp HandleFor(Document doc)
        {
            return doc == null ? null : Boxes.GetOrAdd(doc, () => new ChangeStamp());
        }

        /// <summary>Одоогийн тэмдэг: `&lt;нээлтийн id&gt;:&lt;өөрчлөлтийн тоо&gt;`.  Revit API context-д.</summary>
        internal static string Stamp(Document doc)
        {
            ChangeStamp b = HandleFor(doc);
            return b == null ? null : b.Current;
        }
    }
}
