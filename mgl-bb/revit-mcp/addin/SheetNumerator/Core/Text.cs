using System;
using System.Globalization;

namespace RevitMcpAddin.SheetNumerator.Core
{
    /// <summary>
    /// «Зургийн хуудас дугаарлах»-ын Монгол мессежүүд — НЭГ ГАЗАР.  Цэвэр логик (Core), Revit давхарга, UI
    /// гурвуулаа эндээс авна → нэр томьёо зөрөхгүй.
    ///
    /// ⚠️ Хэрэглэгчид Revit/.NET-ийн түүхий exception бичвэрийг ҮНДСЭН мессеж болгож харуулахгүй — товч Монгол
    /// тайлбар; техникийн дэлгэрэнгүй нь `sheet-numerator.log`-д.
    /// </summary>
    public static class Msg
    {
        private static string F(string fmt, params object[] args)
        {
            return string.Format(CultureInfo.CurrentCulture, fmt, args);
        }

        // ── Нэр томьёо ──────────────────────────────────────────────
        public const string ToolTitle = "Хуудас дугаарлах";
        public const string TransactionGroupName = "MGL – Зургийн хуудас дугаарлах";
        public const string TempTransactionName = "MGL – Түр дугаар";
        public const string FinalTransactionName = "MGL – Хуудасны дугаар, нэр";
        public const string RenameTransactionName = "MGL – Хуудасны нэр өөрчлөх";
        public const string DeleteTransactionName = "MGL – Хуудас устгах";

        // ── Бүлгийн гарчиг ──────────────────────────────────────────
        public const string AllSheetsTitle = "Бүх хуудас";
        public const string SheetsRootTitle = "Хуудаснууд";
        public const string CollectionsSectionTitle = "Хуудасны цуглуулгууд";
        public const string AssembliesSectionTitle = "Assembly хуудаснууд";

        public static string CollectionTitle(string name)
        {
            return F("Цуглуулга: {0}", name ?? "?");
        }

        public static string AssemblyTitle(string name)
        {
            return F("Assembly: {0}", name ?? "?");
        }

        // ── Давхардал ───────────────────────────────────────────────
        public static string DuplicateNumber(string number)
        {
            return F("Дугаар давхардсан байна.\n“{0}” дугаар энэ дугаарлалтын хүрээнд аль хэдийн ашиглагдаж байна.", number);
        }

        public static string DuplicateWith(string number, string name, bool hiddenByFilter)
        {
            return F("Давхцсан хуудас: {0} — {1}{2}", number, name,
                hiddenByFilter ? " (Project Browser-ийн шүүлтэнд нуугдсан)" : string.Empty);
        }

        // ── Дугаар, нэр ─────────────────────────────────────────────
        public const string EmptyNumber = "Хуудасны дугаар хоосон байна.";
        public const string NumberTrimmed = "Дугаарын захын хоосон зайг Revit хасна.";
        public const string NumericOverflow = "Тоо хэт том утга болно.";
        public const string NoNumericToken = "Тоон хэсэг олдсонгүй.";
        public const string TokenTooLong = "Тоон хэсэг хэт урт байна.";
        public const string TokenBecameNegative = "Тоон хэсэг сөрөг утга болно.";
        public const string PlaceholderSheet = "Placeholder хуудас.";
        public const string WorkingOrderDiffers = "Жагсаалтын дараалал Project Browser-оос өөрчлөгдсөн байна.";
        public const string EmptyGeneratedText = "Үүсгэсэн бичвэр хоосон тул хуудасны нэрийг өөрчилсөнгүй.";
        public const string MarkerExhausted = "Давхардлыг ялгах тэмдгийн дараалал дууслаа — өөр дугаар сонгоно уу.";

        public static string ProhibitedInNumber(string chars)
        {
            return F("Хуудасны дугаарт Revit-д хориглогдсон тэмдэгт байна: {0}", chars);
        }

        public static string ProhibitedInName(string chars)
        {
            return F("Хуудасны нэрэнд Revit-д хориглогдсон тэмдэгт байна: {0}", chars);
        }

        public static string TokenIndexOutOfRange(int oneBased)
        {
            return F("{0}-р тоон хэсэг олдсонгүй.", oneBased);
        }

        public static string MultipleTokens(int count, int usedOneBased)
        {
            return F("Дугаарт {0} тоон хэсэг байна — {1}-р хэсгийг ашиглав.", count, usedOneBased);
        }

        public static string PartLimitExceeded(int part)
        {
            return F("Хэсэг {0}-ийн хязгаар давагдсан.", part);
        }

        public static string ContainsMarker(string escaped)
        {
            return F("Дугаарт хэвлэгддэггүй Unicode тэмдэг байна: {0}", escaped);
        }

        public static string MarkerAdded(string escaped)
        {
            return F("Давхардлыг ялгахын тулд хэвлэгддэггүй тэмдэг нэмсэн: {0}", escaped);
        }

        // ── Параметр ────────────────────────────────────────────────
        public const string ParameterNotSelected = "Параметр сонгоогүй байна.";

        public static string ParameterNotFound(string key)
        {
            return F("Параметр олдсонгүй: {0}", key);
        }

        public static string MissingParameterOnSheet(string name)
        {
            return F("Энэ хуудсанд «{0}» параметр байхгүй.", name);
        }

        public static string EmptyParameterOnSheet(string name)
        {
            return F("«{0}» параметрийн утга хоосон байна.", name);
        }

        public static string TargetReadOnly(string name)
        {
            return F("«{0}» параметр зөвхөн унших боломжтой — бичих боломжгүй.", name);
        }

        public static string TargetIncompatible(string name)
        {
            return F("«{0}» параметрт энэ утгыг бичих боломжгүй (төрөл таарахгүй). Зөвхөн текст, бүхэл тоо, нэгжгүй тоо зөвшөөрөгдөнө.", name);
        }

        public static string InvalidInteger(string name, string text)
        {
            return F("«{0}» параметр бүхэл тоо шаардана, гэвч «{1}» нь бүхэл тоо биш.", name, text);
        }

        public static string InvalidNumber(string name, string text)
        {
            return F("«{0}» параметр тоо шаардана, гэвч «{1}» нь тоо биш.", name, text);
        }

        // ── Тохиргооны шалгалт ──────────────────────────────────────
        public const string ValueOutOfRange = "Утга зөвшөөрөгдөх хүрээнээс хэтэрсэн байна.";
        public const string WidthOutOfRange = "Дугаарын орон 0–18 хооронд байх ёстой.";
        public const string StepOutOfRange = "Алхам 1-ээс бага байж болохгүй.";
        public const string LimitBelowStart = "Өсөх дарааллын хязгаар эхлэх утгаас бага байж болохгүй.";
        public const string LimitAboveStart = "Буурах дарааллын хязгаар эхлэх утгаас их байж болохгүй.";
        public const string NoPartEnabled = "Ядаж нэг хэсгийг идэвхжүүлнэ үү.";
        public const string SameTargetParameter = "«Үр дүнг параметрт бичих» ба «Бүлгийн хуудасны тоо» нэг параметр руу бичиж болохгүй.";
        public const string SourceNotAvailable = "Энэ горимд сонгосон эх сурвалж боломжгүй (хэсгийн эх сурвалж зөвхөн Нарийвчилсан дугаарлалтад).";
        public const string MarkerNotProbed = "Үл үзэгдэх тэмдэг Revit-д хадгалагдах эсэхийг шалгаагүй байна.";
        public const string MarkerNotAccepted = "Сонгосон тэмдгийг Revit дугаарт хадгалахгүй (тайрдаг). Өөр тэмдэг сонгоно уу.";

        public static string ProhibitedInSetting(string chars)
        {
            return F("Revit-д хориглогдсон тэмдэгт байна: {0}", chars);
        }

        public static string ProhibitedInNameSeparator(string chars)
        {
            return F("Тусгаарлагчид Revit-д хориглогдсон тэмдэгт байна: {0}", chars);
        }

        // ── Хуучирсан байдал ────────────────────────────────────────
        public const string StaleNotice =
            "Төсөл tool нээгдсэнээс хойш өөрчлөгдсөн байна.\nАлдаатай overwrite хийхээс сэргийлж жагсаалтыг шинэчилнэ үү.";

        public const string DocumentChangedNotice =
            "Идэвхтэй төсөл солигдсон байна. Жагсаалтыг шинэчилж дахин ачаална уу.";

        public const string NoDocumentNotice = "Нээлттэй төсөл байхгүй байна.";

        public static string SheetNoLongerExists(string number, string name)
        {
            return F("Хуудас устсан: {0} — {1}", number, name);
        }

        public static string SheetNumberChangedExternally(string was, string now)
        {
            return F("Хуудасны дугаар өөрчлөгдсөн: {0} → {1}", was, now);
        }

        public static string SheetNameChangedExternally(string number, string was, string now)
        {
            return F("Хуудасны нэр өөрчлөгдсөн ({0}): «{1}» → «{2}»", number, was, now);
        }

        public static string SheetAddedExternally(string number, string name)
        {
            return F("Шинэ хуудас нэмэгдсэн: {0} — {1}", number, name);
        }

        // ── Apply-ийн үр дүн ────────────────────────────────────────
        public const string WorksharingBlocked =
            "Зарим хуудсыг өөрчлөх боломжгүй байна.\nХуудас өөр хэрэглэгчийн эзэмшилд байгаа эсвэл одоогоор засварлах боломжгүй байна. Ямар ч өөрчлөлт хадгалагдсангүй.";

        public const string UnknownApplyError =
            "Өөрчлөлтийг хэрэгжүүлэх үед алдаа гарлаа.\nТөслийн өөрчлөлт хадгалагдсангүй.\nДэлгэрэнгүй мэдээллийг MGL Add-in log-оос шалгана уу.";

        public const string RollbackUnverified =
            "Өөрчлөлтийг хэрэгжүүлэх үед алдаа гарлаа, гэвч буцаалтыг баталгаажуулж чадсангүй.\nХуудасны дугаарыг шалгаж, шаардлагатай бол Ctrl+Z ашиглана уу.\nДэлгэрэнгүй мэдээллийг MGL Add-in log-оос шалгана уу.";

        public const string ReadOnlyDocument = "Төсөл зөвхөн унших горимд байна — өөрчлөлт хийх боломжгүй.";
        public const string NothingToApply = "Хэрэгжүүлэх өөрчлөлт алга.";

        public static string Applied(int sheets, int names, int writes)
        {
            string s = F("Хэрэгжүүллээ: {0} хуудасны дугаар", sheets);
            if (names > 0)
                s += F(", {0} нэр", names);
            if (writes > 0)
                s += F(", {0} параметр", writes);
            return s + ". Нэг Ctrl+Z-ээр буцаана.";
        }

        public static string BlockedByDuplicates(int count)
        {
            return F("Дугаар давхардсан байна ({0} хуудас). Ямар ч өөрчлөлт хадгалагдсангүй.", count);
        }

        public static string ApplyRolledBack(string reason)
        {
            return F("Өөрчлөлтийг хэрэгжүүлэх үед алдаа гарлаа: {0}\nБүх өөрчлөлт буцаагдсан — ямар ч өөрчлөлт хадгалагдсангүй.", reason);
        }

        public static string SheetNotModifiable(string number, string name, string owner)
        {
            return string.IsNullOrEmpty(owner)
                ? F("{0} — {1}: засварлах боломжгүй", number, name)
                : F("{0} — {1}: «{2}»-ийн эзэмшилд байна", number, name, owner);
        }

        public static string ParameterBindingMissing(string number, string parameter)
        {
            return F("{0}: «{1}» параметр олдсонгүй, эсвэл бичих боломжгүй болсон.", number, parameter);
        }

        // ── Нэр өөрчлөх / устгах ────────────────────────────────────
        public const string RenameTitle = "Хуудасны нэр өөрчлөх";
        public const string RenamePrompt = "Хуудасны шинэ нэр:";
        public const string DeleteTitle = "Хуудас устгах";

        public static string DeleteConfirm(string number, string name)
        {
            return F("{0} — {1}\nхуудас болон Revit-ийн устгалтай холбоотой хамааралтай элементүүдийг устгах гэж байна. Үргэлжлүүлэх үү?", number, name);
        }

        public const string DeleteActiveViewFailed =
            "Идэвхтэй харагдацыг устгах боломжгүй. Эхлээд өөр харагдац руу шилжээд дахин оролдоно уу.";

        /// <summary>
        /// Хуудас устгахад хэрэгжүүлээгүй зөөсөн дараалал байвал баталгааны цонхонд НЭМЖ харуулна: дараалал ЧИМЭЭГҮЙ дахин
        /// суурилагдахгүй (устгасан хуудсыг л хасна), хэрэглэгч мэдсээр баталгаажуулна.
        /// </summary>
        public const string DeleteKeepsPendingOrder =
            "Жагсаалтын хэрэгжүүлээгүй зөөсөн дараалал хэвээр үлдэнэ (зөвхөн устгасан хуудсыг хасна).";

        public const string DiscardOrderConfirm =
            "Жагсаалтын өөрчлөгдсөн дараалал хадгалагдаагүй байна. Шинэчилбэл алдагдана. Үргэлжлүүлэх үү?";

        public const string SwitchGroupConfirm =
            "Энэ бүлгийн жагсаалтын дараалал өөрчлөгдсөн, хэрэгжүүлээгүй байна. Бүлэг солиход алдагдана. Үргэлжлүүлэх үү?";

        public const string CloseDirtyConfirm =
            "Жагсаалтын өөрчилсөн дараалал хадгалагдаагүй байна. Цонхыг хаавал алдагдана. Үргэлжлүүлэх үү?";

        public const string InvalidDrop =
            "Хуудсыг зөвхөн ӨӨРИЙН бүлэг дотор зөөнө — өөр бүлэг рүү зөөх боломжгүй.";

        public const string UnexpectedUiError =
            "Хүлээгдээгүй алдаа гарлаа. Төсөлд өөрчлөлт хийгдээгүй. Дэлгэрэнгүй мэдээллийг MGL Add-in log-оос шалгана уу.";

        // ── Үл үзэгдэх тэмдэг ───────────────────────────────────────
        public const string MarkerFirstUseWarning =
            "Энэ арга нь харагдахдаа ижил боловч дотроо өөр Unicode тэмдэгтэй дугаар үүсгэнэ. Экспорт, schedule, файл нэр болон бусад add-in-д ялгаатай утга гэж уншигдаж болно.";

        public const string MarkerNoneAvailable =
            "Энэ Revit-д хадгалагдах үл үзэгдэх тэмдэг олдсонгүй — функц боломжгүй.";

        public const string CleanMarkersNothing = "Хэвлэгддэггүй тэмдэг агуулсан дугаар олдсонгүй.";
    }
}
