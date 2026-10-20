using System;

namespace RevitMcpAddin.ChangeImpact.Core
{
    /// <summary>
    /// «Өөрчлөхөөс өмнө шалгах»-ын ҮЙЛДЛИЙН төрөл.  Шийдвэрийн хөдөлгүүр, snapshot/diff, sandbox, Apply, хуучирсан эсэх, кэш, зураглал бүгд ХУВААЛЦАГДАНА —
    /// үйлдэл тус бүрийн өөр зүйл нь ЗӨВХӨН: эх элементийн шалгалт, нэр дэвшигч бэлтгэл, хөдөлгөөний вектор, үйлдэлд хамаарах diff мөрүүд.
    ///
    ///   WallMove   Нэг шулуун ханыг зөөх (анхны MVP).
    ///   DoorMove   Хананд хостлогдсон нэг хаалгыг ЭНЭ ХАНЫН ДАГУУ зөөх (интерактив simulation).
    /// </summary>
    public enum PreChangeOperationKind
    {
        WallMove = 0,
        DoorMove = 1,
    }

    /// <summary>Үйлдлээс хамаарах Монгол үгсийн ГАНЦ эх сурвалж (тэмдэг/нэр томьёоны хэлбэр солигдох: хана → ханыг, хаалга → хаалгыг).</summary>
    public static class PreChangeOperations
    {
        public static string Noun(PreChangeOperationKind k)
        {
            return k == PreChangeOperationKind.DoorMove ? "хаалга" : "хана";
        }

        /// <summary>Хаалгыг / ханыг.</summary>
        public static string Accusative(PreChangeOperationKind k)
        {
            return k == PreChangeOperationKind.DoorMove ? "хаалгыг" : "ханыг";
        }

        /// <summary>Хаалгатай / ханатай.</summary>
        public static string Comitative(PreChangeOperationKind k)
        {
            return k == PreChangeOperationKind.DoorMove ? "хаалгатай" : "ханатай";
        }

        /// <summary>Хаалганы / хананы.</summary>
        public static string Genitive(PreChangeOperationKind k)
        {
            return k == PreChangeOperationKind.DoorMove ? "хаалганы" : "хананы";
        }

        /// <summary>«Хаалга» / «Хана» — өгүүлбэрийн эхэнд.</summary>
        public static string NounCap(PreChangeOperationKind k)
        {
            return k == PreChangeOperationKind.DoorMove ? "Хаалга" : "Хана";
        }

        /// <summary>Revit-ийн Undo жагсаалтад харагдах нэр (`TransactionGroup` нэр) — «MGL — Хаалга зөөх».</summary>
        public static string UndoName(PreChangeOperationKind k)
        {
            return k == PreChangeOperationKind.DoorMove ? "MGL — Хаалга зөөх" : "MGL — Нөлөө шалгаж зөөх";
        }

        public static PreChangeOperationKind Of(PreChangeRequest r)
        {
            return r != null ? r.Operation : PreChangeOperationKind.WallMove;
        }
    }
}
