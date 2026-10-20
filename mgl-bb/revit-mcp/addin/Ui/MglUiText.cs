namespace RevitMcpAddin.Ui
{
    /// <summary>
    /// ХУВААЛЦСАН UI бичвэр: үйлдлийн нийтлэг үгс, төлөв.  Хэрэгсэл бүрийн ӨӨРИЙН бичвэр (Reinforcement/RfText,
    /// SheetNumerator/Text, ToolCatalogData) тэндээ ХЭВЭЭР — энд давхар «эх сурвалж» үүсгэхгүй.
    ///
    /// ⚠️ ЗӨВХӨН харагдах бичвэрийг энд.  Машины танигч (enum, параметрийн нэр, payload түлхүүр, нийлүүлэгчийн
    /// нэр, нэршлийн загварын токен, хэрэглэгчийн оруулсан нэр) ХЭЗЭЭ Ч орчуулагдахгүй.
    /// ⚠️ `Lang.cs`-ийн хэлний илрүүлэлт (AI хариултын хэл) UI-ийн хэлнээс ТУСДАА — энд хөндөхгүй.
    /// </summary>
    internal static class MglUiText
    {
        // Нийтлэг үйлдэл
        public const string Cancel = "Болих";
        public const string Close = "Хаах";
        public const string Save = "Хадгалах";
        public const string Apply = "Хэрэгжүүлэх";
        public const string Open = "Нээх";
        public const string Retry = "Дахин оролдох";
        public const string Copy = "Хуулах";
        public const string Refresh = "Шинэчлэх";
        public const string Search = "Хайх";
        public const string Back = "Буцах";

        /// <summary>Сонголтыг ЦУЦЛАХ (мөрийг устгахгүй) — «Цэвэрлэх» гэсэн ойлгомжгүй үгийн оронд.</summary>
        public const string ClearSelection = "Сонголт цуцлах";
        public const string SelectAll = "Бүгдийг сонгох";

        // Төлөв
        public const string Loading = "Ачаалж байна…";
        public const string Working = "Ажиллаж байна…";
        public const string Done = "Дууслаа";
        public const string Failed = "Амжилтгүй";
        public const string NoResults = "Илэрц алга";
        public const string NotSignedIn = "Нэвтрээгүй";
        public const string SignedIn = "Нэвтэрсэн";

        // Нийтлэг шалтгаан
        public const string AlwaysAvailable = "Товч үргэлж идэвхтэй.";
        public const string CopiedToClipboard = "Хууллаа";

        /// <summary>Нэг үйлдлээр олон зүйл сонгогдсон үед тоо: «3 / 12 сонгосон».</summary>
        public static string SelectedOf(int selected, int total)
        {
            return selected + " / " + total + " сонгосон";
        }
    }
}
