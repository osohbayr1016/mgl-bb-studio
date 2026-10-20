using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using RevitMcpAddin.CloneDrawings;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement
{
    /// <summary>
    /// «Арматур» хэрэгслүүдийн БҮХ харагдах текст НЭГ ГАЗАР — үндсэн хэл Монгол, нөөц Англи (`Lang.T(mn, en)`,
    /// энэ репогийн нэг л локализацийн арга).  Бизнес логик (Core, Revit үйлчилгээ) текст бичихгүй: тэд кодыг
    /// (enum) буцаана, UI/тайлан энд хөрвүүлнэ.
    ///
    /// ⚠️ Дараа нь англи хэл идэвхжүүлэхэд ЗӨВХӨН энэ файлыг засна.  `Lang.Current` анхдагчаар Монгол.
    /// </summary>
    internal static class RfText
    {
        private static string T(string mn, string en) { return Lang.T(mn, en); }

        private static string F(string fmt, params object[] args)
        {
            return string.Format(CultureInfo.CurrentCulture, fmt, args);
        }

        // ── Нийтлэг ─────────────────────────────────────────────────────
        public static string Cancel { get { return T("Болих", "Cancel"); } }
        public static string Close { get { return T("Хаах", "Close"); } }
        public static string Create { get { return T("Үүсгэх", "Create"); } }
        public static string Update { get { return T("Шинэчлэх", "Update"); } }
        public static string Preview { get { return T("Урьдчилан харах", "Preview"); } }
        public static string Skip { get { return T("Алгасах", "Skip"); } }
        public static string NoProject { get { return T("Зөвхөн project файл дээр ажиллана (family биш).", "Works on project files only (not families)."); } }
        public static string Ctrlz { get { return T("Бүгдийг нэг Ctrl+Z-ээр буцаана.", "Everything is undone with a single Ctrl+Z."); } }
        public static string Error(string msg) { return T("Алдаа: ", "Error: ") + msg; }

        // ── Шууд хайлт (тэмдэг, эх түүвэр) ───────────────────────────────
        public static string SearchHintSymbol { get { return T("Тэмдэг хайх (Family, Type)…", "Search symbols (Family, Type)…"); } }
        public static string SearchHintSchedule { get { return T("Эх түүвэр хайх…", "Search source schedules…"); } }
        public static string SearchNoResults { get { return T("Илэрц олдсонгүй", "No results found"); } }
        public static string SearchSelectedHidden(string label) { return F(T("Сонгосон: «{0}» (хайлтаар нуугдсан)", "Selected: “{0}” (hidden by the search)"), label); }
        public static string SearchCount(int shown, int total) { return F(T("{0} / {1}", "{0} / {1}"), shown, total); }

        // ── Түүвэр хувилах ─────────────────────────────────────────────
        public static string CloneTitle { get { return T("MGL — Түүвэр хувилах", "MGL — Clone schedules"); } }
        public static string CloneHeader { get { return T("Эх түүврийг арматурын бүлэг (Partition) бүрээр хувилна", "Clone the template schedule per Rebar Partition"); } }
        public static string CloneIntro
        {
            get
            {
                return T("Арматурын бүлэг (Partition) нь арматурын «Partition» параметрийн утга (жишээ нь DN-1) — Workset БИШ. "
                    + "Эх түүврээ инженер өөрөө форматласан хэвээр нь ХУВИЛЖ, зөвхөн Partition-ы шүүлтүүрийг солино. "
                    + "Багана, гарчиг, эрэмбэ, тооцоолсон талбар, формат хадгалагдана.",
                    "The template (e.g. DN-1) is DUPLICATED as the engineer formatted it; only the Partition filter changes.");
            }
        }
        public static string TemplateLabel { get { return T("Эх түүвэр", "Template schedule"); } }
        public static string PartitionFieldLabel { get { return T("Арматурын бүлгийн талбар (Partition)", "Partition field"); } }
        public static string AutoDetected { get { return T(" (автоматаар танисан)", " (auto-detected)"); } }
        public static string AddHiddenFieldOption { get { return T("(Partition — нуугдсан талбар нэмнэ)", "(Partition — add a hidden field)"); } }
        public static string AddHiddenFieldNote
        {
            get
            {
                return T("Эх түүвэрт Partition талбар алга. Хуулбар бүр дээр нуугдсан талбар нэмнэ — эх түүвэр ХӨНДӨГДӨХГҮЙ.",
                    "The template has no Partition field. A hidden field is added to each copy — the template is NOT touched.");
            }
        }
        public static string NoPartitionField
        {
            get
            {
                return T("Энэ түүвэрт арматурын Partition талбар алга, мөн нуугдсан талбар нэмэх боломжгүй. Өөр түүвэр сонгоно уу.",
                    "This schedule has no rebar Partition field and one cannot be added. Pick another schedule.");
            }
        }
        public static string NoTemplates
        {
            get
            {
                return T("Арматурын (Rebar) түүвэр олдсонгүй. Эхлээд нэг түүврийг (жишээ нь DN-1) бүрэн форматлаж бэлдэнэ үү.",
                    "No Rebar schedule found. Prepare one schedule (e.g. DN-1) fully formatted first.");
            }
        }
        public static string PartitionsLabel { get { return T("Үүсгэх арматурын бүлгүүд (Partition)", "Partitions to create"); } }
        public static string SelectAll { get { return T("Бүгдийг сонгох", "Select all"); } }
        public static string NamePatternLabel { get { return T("Үүсэх түүврийн нэрийн загвар", "Name pattern of the new schedules"); } }
        public static string NamePatternAdvanced { get { return T("Нэмэлт: үүсэх түүврийн нэрийг өөрчлөх", "Advanced: change the names of the new schedules"); } }

        public static string NamePatternHint
        {
            get
            {
                return T("Загвар нь ҮҮСЭХ түүвэр бүрийн нэрийг гаргана.  {Partition} → Partition-ий утга (ж. DN-2), {Template} → эх түүврийн нэр.  Өгөгдмөл нь эх түүврийн нэрнээс автоматаар таагдсан — ихэнхдээ өөрчлөх шаардлагагүй.",
                    "The pattern builds the NAME of every new schedule.  {Partition} → the Partition value (e.g. DN-2), {Template} → the source schedule's name.  The default is derived from the source name — usually no need to change it.");
            }
        }

        public static string NameExampleHeading { get { return T("Үүсэх түүврийн нэр", "Name of the new schedules"); } }
        public static string NameExampleNone { get { return T("Жишээ: Partition утга олдсонгүй.", "Example: no Partition value found."); } }

        /// <summary>«Жишээ: DN-2 → Beam DN-2 Reinforcement» — ЯГ бодит нэрийн томьёогоор (<c>RfScheduleNames.Resolve</c>).</summary>
        public static string NameExample(string partition, string name)
        {
            return F(T("Жишээ:  {0}  →  {1}", "Example:  {0}  →  {1}"), partition, name);
        }
        public static string ExistingPolicyLabel { get { return T("Байгаа түүвэр", "Existing schedule"); } }
        public static string PolicySkip { get { return T("Алгасах", "Skip"); } }
        public static string PolicyUpdate { get { return T("Filter шинэчлэх", "Update filter"); } }
        public static string PolicyReplace { get { return T("Солих (устгаад дахин үүсгэнэ)", "Replace (delete and recreate)"); } }
        public static string ColPartition { get { return T("Бүлэг (Partition)", "Partition"); } }
        public static string ColRebar { get { return T("Арматур", "Rebars"); } }
        public static string ColStatus { get { return T("Төлөв", "Status"); } }
        public static string ColName { get { return T("Үүсэх түүврийн нэр", "Name of the new schedule"); } }

        public static string ActionLabel(RfCloneAction a)
        {
            switch (a)
            {
                case RfCloneAction.Create: return T("+ Үүсгэнэ", "+ Create");
                case RfCloneAction.UpToDate: return T("✓ Байгаа", "✓ Exists");
                case RfCloneAction.UpdateFilter: return T("↻ Шинэчилнэ", "↻ Update");
                case RfCloneAction.Replace: return T("⇄ Солино", "⇄ Replace");
                case RfCloneAction.Skip: return T("○ Алгасна", "○ Skip");
                default: return T("! Мөргөлдөөн", "! Conflict");
            }
        }

        public static string ReasonLabel(RfCloneReason r)
        {
            switch (r)
            {
                case RfCloneReason.IsTemplate: return T("Эх түүвэр өөрөө", "This is the template itself");
                case RfCloneReason.SameTargetExists: return T("Нэр, шүүлтүүр зөв байна", "Name and filter already correct");
                case RfCloneReason.WrongTargetExists: return T("Нэр байгаа, гэхдээ шүүлтүүр өөр Partition-д", "Name exists but the filter targets another Partition");
                case RfCloneReason.NameTakenByOther: return T("Нэрийг өөр (Rebar биш) түүвэр эзэлсэн", "Name is used by a non-rebar schedule");
                case RfCloneReason.DuplicateName: return T("Өөр Partition-тай ижил нэр гарч байна", "Same name as another selected Partition");
                case RfCloneReason.InvalidName: return T("Нэр буруу (загварыг шалга)", "Invalid name (check the pattern)");
                case RfCloneReason.HandMadeNoPartitionFilter: return T("Таны гараар хийсэн, Partition шүүлтүүргүй түүвэр — хөндөхгүй (нэрийг өөрчилнө үү)", "A schedule you made by hand with no Partition filter — left untouched (rename it)");
                case RfCloneReason.ReplaceUnsupportedLayout: return T("Хуваагдсан (split) эсвэл «хуудсаар шүүх» түүвэр — «Солих» хуудасны байрлалыг сэргээж чадахгүй тул хөндөхгүй", "A split or filter-by-sheet schedule — “Replace” cannot restore its sheet placement, so it is left untouched");
                case RfCloneReason.ReplaceNotOwned: return T("Таны гараар хийсэн түүвэр — «Солих» зөвхөн энэ хэрэгслийн үүсгэсэнийг устгана (шүүлтүүрийг «Filter шинэчлэх»-ээр засна уу)", "A schedule you made by hand — “Replace” only deletes schedules this tool created (use “Update filter”)");
                default: return string.Empty;
            }
        }

        public static string WarnLabel(RfCloneWarn w)
        {
            switch (w)
            {
                case RfCloneWarn.EdgeWhitespace: return T("Утгын эхэнд/төгсгөлд хоосон зай бий", "Value has leading/trailing whitespace");
                case RfCloneWarn.CaseOrSpaceCollision: return T("Өөр утгатай зөвхөн том/жижиг үсэг, зайгаар ялгарна", "Differs from another value only by case/space");
                default: return T("Хуудсан дээрх байрлал дахин байрлуулагдана (шинэ түүврээр)", "Sheet placements will be re-placed with the new schedule");
            }
        }

        public static string PatternIssue(RfNameIssue i)
        {
            switch (i)
            {
                case RfNameIssue.Empty: return T("Нэрийн загвар хоосон байна.", "The name pattern is empty.");
                case RfNameIssue.NoPartitionToken: return T("Загварт {Partition} байх ёстой — эс бөгөөс бүх түүвэр ижил нэртэй болно.", "The pattern must contain {Partition}, otherwise every schedule gets the same name.");
                case RfNameIssue.InvalidChars: return T("Загварт Revit-д хориотой тэмдэгт байна: \\ : { } [ ] | ; < > ? ` ~", "The pattern has characters Revit forbids: \\ : { } [ ] | ; < > ? ` ~");
                default: return string.Empty;
            }
        }

        public static string PlanSummary(int create, int update, int replace, int exist, int skip, int conflict)
        {
            return F(T("{0} үүсгэнэ · {1} шинэчилнэ · {2} солино · {3} байгаа · {4} алгасна · {5} мөргөлдөөн",
                "{0} create · {1} update · {2} replace · {3} exist · {4} skip · {5} conflict"),
                create, update, replace, exist, skip, conflict);
        }

        public static string BlankWarning(int n)
        {
            return F(T("{0} арматурт Partition хоосон — тэдгээрт түүвэр үүсгэхгүй.", "{0} rebars have an empty Partition — no schedule is created for them."), n);
        }

        public static string FieldFoundOn(string bip)
        {
            return F(T("Partition параметр: {0}", "Partition parameter: {0}"), bip);
        }

        public static string ConfirmReplace(IList<string> names, int placements)
        {
            string list = string.Join("\n", names.Take(12).Select(n => "  • " + n)) + (names.Count > 12 ? "\n  …" : string.Empty);
            return F(T("«Солих» нь энэ хэрэгслийн өмнө үүсгэсэн дараах {0} түүврийг УСТГАНА (хуудсан дээрх {1} байрлалыг шинэ түүврээр дахин байрлуулна):\n{2}\n\nАль нэг алхам унавал бүгд буцаж хуучин түүвэр хэвээр үлдэнэ.\n\nҮргэлжлүүлэх үү?",
                "“Replace” will DELETE these {0} schedule(s) previously created by this tool (the {1} sheet placement(s) are re-placed with the new schedule):\n{2}\n\nIf any step fails everything is rolled back and the old schedule stays.\n\nContinue?"),
                names.Count, placements, list);
        }

        public static string ScheduleMarkerNotWritten
        {
            get
            {
                return T("Түүврийн тэмдэглэгээг (Extensible Storage) бичиж чадсангүй — түүврийг үлдээсэнгүй.",
                    "Could not write the schedule marker (Extensible Storage) — the schedule was not kept.");
            }
        }

        public static string ReplaceRolledBack(string why)
        {
            return F(T("«Солих» буцлаа, хуучин түүвэр хэвээр ({0})", "“Replace” was rolled back, the old schedule is unchanged ({0})"), why);
        }

        public static string NothingToDo { get { return T("Үүсгэх, шинэчлэх зүйл алга.", "Nothing to create or update."); } }

        // ── Үр дүн ─────────────────────────────────────────────────────
        public static string CloneDone { get { return T("Түүвэр хувилагдлаа", "Schedules cloned"); } }
        public static string CloneFailed { get { return T("Түүвэр хувилагдсангүй", "Schedules were not cloned"); } }

        public static string CloneUpdated { get { return T("Түүвэр шинэчлэгдлээ", "Schedules updated"); } }
        public static string CloneUnchanged { get { return T("Түүвэрт өөрчлөлт хийгдсэнгүй", "No schedule was changed"); } }

        /// <summary>Үүсгэсэн / Шинэчилсэн / Сольсон / Аль хэдийн зөв / Мөргөлдөөн (хөндөөгүй) / Бусад алгасалт / Алдаатай — тус тусад нь.</summary>
        public static string CloneResult(int created, int updated, int replaced, int upToDate, int conflicts, int otherSkipped, int failed)
        {
            string s = F(T("Үүсгэсэн: {0} · Шинэчилсэн: {1} · Сольсон: {2}", "Created: {0} · Updated: {1} · Replaced: {2}"), created, updated, replaced);
            if (upToDate > 0) s += "\n" + F(T("Аль хэдийн зөв (хөндөөгүй): {0}", "Already correct (untouched): {0}"), upToDate);
            if (conflicts > 0) s += "\n" + F(T("Мөргөлдөөн — хөндөөгүй: {0} (шалтгаан доор)", "Conflicts — left untouched: {0} (reasons below)"), conflicts);
            if (otherSkipped > 0) s += "\n" + F(T("Алгассан (хязгаар, эзэмшигч…): {0}", "Skipped (limit, owner…): {0}"), otherSkipped);
            if (failed > 0) s += "\n" + F(T("Алдаатай: {0} (шалтгаан доор)", "Failed: {0} (reasons below)"), failed);
            return s;
        }

        public static string FilterRejected(string why)
        {
            return F(T("Revit Partition шүүлтүүрийг хүлээж авсангүй — Partition талбар текст биш байж магадгүй ({0}).", "Revit rejected the Partition filter — the Partition field may not be a text field ({0})."), why);
        }

        public static string FilterRejectedSkipped(int n)
        {
            return F(T("{0} түүвэр алгасагдлаа — өмнөх түүвэрт Revit Partition шүүлтүүрийг хүлээж аваагүй тул үлдсэнийг дахин оролдсонгүй.",
                "{0} schedule(s) skipped — Revit rejected the Partition filter on a previous one, so the rest were not retried."), n);
        }

        public static string TooManyFilters
        {
            get { return T("Түүвэр 8 шүүлтүүртэй тул Partition шүүлтүүр нэмэх боломжгүй.", "The schedule already has 8 filters, so a Partition filter cannot be added."); }
        }

        public static string FilterLimitSkipped(int n)
        {
            return F(T("{0} түүвэр алгасагдлаа — " + TooManyFilters + " Эх түүврээс нэг шүүлтүүрийг хасаад дахин оролдоно уу.",
                "{0} schedule(s) skipped — " + TooManyFilters + " Remove one filter from the source and retry."), n);
        }

        public static string TemplateNotDuplicable
        {
            get { return T("Энэ түүврийг хуулах боломжгүй (Revit зөвшөөрөхгүй).", "This schedule cannot be duplicated (Revit refuses)."); }
        }

        public static string OwnedByOther(string owner)
        {
            return F(T("Энэ түүврийг өөр хэрэглэгч эзэмшиж байна: {0} — алгасав.", "This schedule is owned by another user: {0} — skipped."), owner);
        }

        public static string SearchLabel { get { return T("Хайх…", "Search…"); } }

        public static string ItemFailed(string partition, string why)
        {
            return F(T("{0}: {1}", "{0}: {1}"), partition, why);
        }

        public static string SheetsReplaced(int n)
        {
            return F(T("{0} түүврийн хуудсан дээрх байрлал шинэ түүврээр дахин байрлуулагдлаа.", "{0} sheet placement(s) were re-placed with the new schedule."), n);
        }

        public static string TemplateNotFilterable
        {
            get
            {
                return T("Энэ талбараар шүүлтүүр тавих боломжгүй (Revit зөвшөөрөхгүй).", "This field cannot be filtered (Revit refuses).");
            }
        }

        public static string NameRefused(string name, string msg)
        {
            return F(T("Revit «{0}» нэрийг хүлээж авсангүй ({1}).", "Revit refused the name “{0}” ({1})."), name, msg);
        }

        // ── Түүвэр синк хийх ──────────────────────────────────────────
        public static string SyncTitle { get { return T("MGL — Түүвэр синк хийх", "MGL — Schedule sync"); } }
        public static string SyncHeader { get { return T("Загварын Partition-ууд ба үүсгэсэн түүврүүдийг харьцуулна", "Compare model Partitions with generated schedules"); } }
        public static string SyncIntro
        {
            get
            {
                return T("Юуг ч АВТОМАТААР УСТГАХГҮЙ. Дутууг үүсгэх, буруу шүүлтүүрийг засах нь тусдаа товч; "
                    + "загварт үлдээгүй Partition-ы түүврийг устгахыг зөвхөн таны сонгосноор.",
                    "Nothing is deleted automatically. Creating missing and fixing filters are separate buttons; "
                    + "schedules of vanished Partitions are deleted only when you tick them.");
            }
        }

        public static string SyncStatusLabel(RfSyncStatus s)
        {
            switch (s)
            {
                case RfSyncStatus.Missing: return T("+ Дутуу түүвэр", "+ Missing schedule");
                case RfSyncStatus.UpToDate: return T("✓ Зөв", "✓ Up to date");
                case RfSyncStatus.UpToDateRenamed: return T("✓ Зөв (нэр өөр)", "✓ Up to date (renamed)");
                case RfSyncStatus.WrongTarget: return T("↻ Шүүлтүүр буруу", "↻ Wrong filter");
                case RfSyncStatus.Conflict: return T("! Нэр мөргөлдөв", "! Name conflict");
                default: return T("○ Загварт Partition алга", "○ Partition no longer in model");
            }
        }

        public static string SyncCreateMissing { get { return T("Дутууг үүсгэх", "Create missing"); } }
        public static string SyncFixFilters { get { return T("Шүүлтүүр засах", "Fix filters"); } }
        public static string SyncDeleteTicked { get { return T("Сонгосныг устгах", "Delete ticked"); } }
        public static string ColSchedule { get { return T("Одоогийн түүвэр", "Current schedule"); } }
        public static string ColTick { get { return T("Устгах", "Delete"); } }

        public static string ConfirmDelete(IList<string> names)
        {
            string list = string.Join("\n", names.Take(15).Select(n => "  • " + n)) + (names.Count > 15 ? "\n  …" : string.Empty);
            return F(T("Дараах {0} түүврийг УСТГАХ уу? Хуудсан дээрх байрлал нь хамт устна:\n{1}", "DELETE these {0} schedule(s)? Their sheet placements are removed too:\n{1}"), names.Count, list);
        }

        public static string DeleteResult(int n) { return F(T("Устгасан түүвэр: {0}", "Deleted schedules: {0}"), n); }
        public static string DeleteFailedCount(int n) { return F(T("устгаагүй: {0}", "not deleted: {0}"), n); }
        public static string NothingDeleted { get { return T("Юу ч устгагдсангүй.", "Nothing was deleted."); } }
        public static string DeleteNotFound { get { return T("түүвэр олдсонгүй (аль хэдийн устсан)", "schedule not found (already deleted)"); } }
        public static string DeleteIsTemplate { get { return T("эх түүвэр — устгахгүй", "this is the template — not deleted"); } }

        // ── Арматурын төгсгөлийн тэмдэг ───────────────────────────────
        public static string EndTitle { get { return T("MGL — Арматурын төгсгөлийн тэмдэг", "MGL — Rebar end symbol"); } }
        public static string RefreshTitle { get { return T("MGL — Тэмдэглэгээ шинэчлэх", "MGL — Refresh annotations"); } }
        public static string EndHeader { get { return T("Арматурын төгсгөлд тэмдэг тавих", "Place a symbol at rebar ends"); } }
        public static string EndIntro
        {
            get
            {
                return T("Эхлээд тэмдгийн төрлийг сонгоод, дараа нь арматур бүр дээр дараалан дарна (Esc = дуусгах) — арматурын бодит эхлэл/төгсгөл бүрт чиглэлээр нь эргүүлж, харагдацын координатаар автоматаар тавина. Тохирох family байхгүй бол код-оор зурах тэмдэг ашиглана.",
                    "Pick the symbol type first, then click rebars one after another (Esc finishes) — a symbol is placed at each real start/end, rotated along the bar in the active view. If no suitable family exists, a code-drawn marker is used.");
            }
        }
        public static string UnsupportedView
        {
            get
            {
                return T("Давхрын план, зүсэлт, фасад эсвэл detail харагдац нээгээд дахин дарна уу. 3D, хуудас, хүснэгт, legend дээр ажиллахгүй.",
                    "Open a plan, section, elevation or detail view. Not available in 3D, sheets, schedules or legends.");
            }
        }
        public static string NoSymbolChosen { get { return T("Тэмдэг сонгоогүй байна.", "No symbol selected."); } }
        public static string SymbolNotViewBased { get { return T("Энэ family харагдацад хамаарах (view-based) биш тул тэмдэг болгож болохгүй.", "This family is not view-based and cannot be used as a symbol."); } }
        public static string NoSymbols
        {
            get
            {
                return T("Харагдацад хамаарах (Detail Item эсвэл Generic Annotation) family ачаалаагүй байна — код-оор зурах тэмдэг (тойрог / загалмай / налуу зураас) ашиглана. Өөрийн family хэрэглэх бол Insert → Load Family-аар ачаална уу. (Add-in family-г өөрөө ачаалахгүй.)",
                    "No view-based (Detail Item / Generic Annotation) family is loaded — a code-drawn marker (circle / cross / slash) will be used. To use your own family, load it with Insert → Load Family. (The add-in never loads families by itself.)");
            }
        }
        public static string SymbolLabel { get { return T("Тэмдэг (Family / Type)", "Symbol (Family / Type)"); } }
        public static string MarkerOption { get { return T("◇ Код-оор зурах тэмдэг (family шаардахгүй)", "◇ Code-drawn marker (no family needed)"); } }
        public static string MarkerStyleLabel { get { return T("Хэлбэр", "Shape"); } }
        public static string MarkerCircle { get { return T("Тойрог", "Circle"); } }
        public static string MarkerCross { get { return T("Загалмай (×)", "Cross (×)"); } }
        public static string MarkerSlash { get { return T("Налуу зураас (/)", "Slash (/)"); } }
        public static string MarkerSizeLabel { get { return T("Хэмжээ (цаасан мм)", "Size (paper mm)"); } }

        public static string MarkerSizeInvalid(double min, double max)
        {
            return F(T("Тэмдгийн хэмжээ {0}–{1} мм (цаасан дээр) байх ёстой.", "The marker size must be {0}–{1} mm (on paper)."),
                min.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture), max.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture));
        }

        public static string MarkerNotDetectable { get { return T("Энэ харагдацад код-оор зурсан тэмдгийг дахин таних боломжгүй байна (давхардал хамгаалалт, «шинэчлэх» ажиллахгүй) — тэмдэг тавигдсангүй, бүгд буцлаа.  Family тэмдэг ашиглана уу.", "Code-drawn markers cannot be re-detected in this view (duplicate protection and Refresh would not work) — nothing was placed and everything was rolled back. Use a family symbol instead."); } }
        public static string MarkerNotDrawn { get { return T("Код-оор зурах тэмдгийн геометр үүссэнгүй (хэмжээ буруу байж магадгүй).", "The code-drawn marker produced no geometry (the size may be invalid)."); } }
        public static string PlaceLabel { get { return T("Байрлуулах", "Place at"); } }
        public static string PlaceBoth { get { return T("Эхлэл + Төгсгөл", "Start + End"); } }
        public static string PlaceStart { get { return T("Зөвхөн эхлэл", "Start only"); } }
        public static string PlaceEnd { get { return T("Зөвхөн төгсгөл", "End only"); } }
        public static string OrientLabel { get { return T("Эргүүлэх", "Rotation"); } }
        public static string OrientAuto { get { return T("Арматур дагуу", "Along the bar"); } }
        public static string OrientFixed { get { return T("Тогтмол", "Fixed"); } }
        public static string AngleLabel { get { return T("Өнцөг (°)", "Angle (°)"); } }
        public static string NaturalLabel { get { return T("Family-ийн заах чиглэл (°)", "Family's own direction (°)"); } }
        public static string NaturalHint { get { return T("Тэмдэг анхнаасаа баруун (X+) тийш заадаг бол 0. Өөр чиглэлтэй зурагдсан бол түүний өнцөг.", "0 if the symbol points to the right (X+) by default; otherwise its own angle."); } }
        public static string OffsetLabel(string unit) { return F(T("Оффсет ({0})", "Offset ({0})"), unit); }
        public static string OffsetHint { get { return T("Төгсгөлөөс арматурын чиглэлээр гадагш (загварын урт).", "Outward from the end along the bar (model length)."); } }
        public static string IncludeHooks { get { return T("Дэгээний үзүүрт тавих (дэгээг арматурын төгсгөл гэж тооцно)", "Place at the hook tip (hooks count as part of the bar)"); } }
        public static string BarSetLabel { get { return T("Олонлог (bar set)", "Bar set"); } }
        public static string BarSetNearest { get { return T("Сонгосон ширхэг (дарсан цэгт хамгийн ойр)", "Picked bar (nearest to the click)"); } }
        public static string BarSetAll { get { return T("Бүх ширхэг", "All bars"); } }
        public static string BarSetFirstLast { get { return T("Эхний ба сүүлийн ширхэг", "First and last bar"); } }
        public static string BarSetFirst { get { return T("Эхний ширхэг", "First bar only"); } }
        public static string BarSetHint
        {
            get
            {
                return T("«Эхний ширхэг» — олонлогийн тархалтын дарааллаар БОДИТООР БАЙГАА хамгийн эхний ширхэг (0 индекс гэж таамаглахгүй). Нягт олонлогт тэмдэг давхцахгүй.",
                    "“First bar only” — the first bar position that ACTUALLY exists in the set's distribution order (index 0 is not assumed). Avoids overlapping markers in dense sets.");
            }
        }

        // ── Эхлэл / төгсгөлийн эргэлт (бие даасан) ──────────────────────
        public static string StartRotLabel { get { return T("Эхлэлийн тэмдэг — эргэлт (°)", "Start symbol — rotation (°)"); } }
        public static string EndRotLabel { get { return T("Төгсгөлийн тэмдэг — эргэлт (°)", "End symbol — rotation (°)"); } }
        public static string RotHintAuto { get { return T("Автомат чиглэл дээр нэмэгдэх эргэлтийн өнцөг (CCW, градус; −45, 135, 22.5 г.м.). Эхлэл ба төгсгөл тус тусдаа.", "Rotation added on top of the automatic direction (CCW, degrees; −45, 135, 22.5 …). Start and end are independent."); } }
        public static string RotHintFixed { get { return T("Харагдацын хавтгай дахь ТОГТМОЛ өнцөг (баруун тэнхлэгээс CCW, градус). Эхлэл ба төгсгөл тус тусдаа.", "FIXED angle in the view plane (CCW from the right axis, degrees). Start and end are independent."); } }
        public static string EndOnRotationNote(int n)
        {
            return F(T("Харагдацын нормаль дагуух (цэг болж харагдах) {0} арматурт хоёр төгсгөл НЭГ цэгт давхцдаг тул ганц тэмдэг тавигдсан: ЭХЛЭЛИЙН эргэлт хэрэглэгдэж, Төгсгөлийнх хэрэглэгдээгүй.  Төгсгөлийн эргэлтээр тавихыг хүсвэл «Зөвхөн төгсгөл» сонгоно уу.",
                "{0} end-on rebar(s): both ends coincide at one point, so a single symbol was placed — the START rotation was used and the END rotation was not. Choose “End only” to use the end rotation."), n);
        }

        public static string RotationInvalid(string which) { return F(T("{0}: тоо бичнэ үү (ж: 0, 90, −45, 22.5).", "{0}: enter a number (e.g. 0, 90, −45, 22.5)."), which); }
        public static string SymbolRotateFailed(string deg, string msg)
        {
            return F(T("Тэмдгийн family-г {0}° эргүүлж чадсангүй (family эргэлтийг дэмжихгүй байж болно): {1} — тэмдэг тавигдсангүй.",
                "The symbol family could not be rotated by {0}° (it may not support rotation): {1} — no symbol was placed."), deg, msg);
        }
        public static string AllowDuplicates { get { return T("Давхар тавихыг зөвшөөрөх (өмнө тавьсан төгсгөл дээр дахин)", "Allow duplicates (again on an already marked end)"); } }
        public static string Remember { get { return T("Дараагийн удаа санах", "Remember for next time"); } }
        public static string PickRebars { get { return T("Арматур сонгох", "Pick rebars"); } }
        public static string PlaceNow { get { return T("Тавих", "Place"); } }

        public static string SelectionInfo(int rebars, int notRebar)
        {
            string skipped = notRebar > 0
                ? " " + F(T("Арматур биш {0} элемент алгасагдана.", "{0} non-rebar element(s) will be skipped."), notRebar)
                : string.Empty;
            if (rebars == 0)
                return T("Арматур сонгоогүй — товч дарсны дараа арматур бүр дээр ДАРААЛАН дарна: дарах бүрт тэмдэг шууд тавигдана. Esc = дуусгах.", "No rebar selected yet — after pressing the button, click rebars ONE AFTER ANOTHER: each click places its symbols at once. Esc finishes.") + skipped;
            return F(T("{0} арматур сонгосон.", "{0} rebar(s) selected."), rebars) + skipped;
        }

        /// <summary>Дараалан дарах горимын status bar-ын мөр: нийт тавьсан тоо + сүүлийн товшилтын үр дүн (цонх гаргахгүй).</summary>
        public static string PickLoopPrompt(int placed, string last)
        {
            string s = F(T("Тэмдэг тавих арматур дээр дараалан дарна уу (Esc = дуусгах)  ·  Тавьсан: {0}", "Click rebars one after another to place end symbols (Esc finishes)  ·  Placed: {0}"), placed);
            return string.IsNullOrEmpty(last) ? s : s + "  ·  " + T("Сүүлийнх: ", "Last: ") + last;
        }

        /// <summary>Нэг товшилтын үр дүнгийн богино тайлбар — тэмдэг тавигдаагүй бол ЯАГААД гэдгийг status bar-т шууд хэлнэ.</summary>
        public static string LastPick(RfEndSymbolReport r)
        {
            if (r.Placed > 0) return "+" + r.Placed.ToString(CultureInfo.CurrentCulture);
            if (r.DifferentSymbol > 0) return T("өөр төрлийн тэмдэг аль хэдийн тавигдсан", "a different symbol is already there");
            if (r.Duplicates > 0) return T("өмнө тавигдсан — давхар тавиагүй", "already marked — skipped");
            if (r.OutsideCrop > 0) return T("crop хүрээнээс гадна — тавиагүй", "outside the crop region — skipped");
            if (r.OutsideDepth > 0) return T("харагдацын гүнээс гадна — тавиагүй", "beyond the view depth — skipped");
            if (r.HiddenBars > 0 || r.NotVisible > 0) return T("энэ харагдацад харагдахгүй ширхэг — тавиагүй", "bar not visible in this view — skipped");
            if (r.FreeForm > 0) return T("freeform арматур дэмжигдэхгүй", "freeform rebar is not supported");
            if (r.NoGeometry > 0) return T("арматурын геометр уншигдсангүй", "rebar geometry could not be read");
            return T("тэмдэг тавигдсангүй", "nothing placed");
        }

        public static string CtrlzPerPick { get { return T("Ctrl+Z бүр СҮҮЛД дарсан арматурын тэмдгийг буцаана.", "Each Ctrl+Z undoes the symbols of the LAST clicked rebar."); } }

        public static string PickBarPrompt { get { return T("Олонлогийн аль ширхэгт тэмдэг тавихыг тэр ширхэг дээр дарж заана уу (Esc = цуцлах)", "Click the bar of the set to mark (Esc cancels)"); } }

        public static string EndDone { get { return T("Тэмдэг тавигдлаа", "Symbols placed"); } }
        public static string EndNothing { get { return T("Тэмдэг тавигдсангүй", "No symbols placed"); } }

        public static string EndResult(RfEndSymbolReport r)
        {
            string s = F(T("Тавигдсан: {0}  ·  Арматур: {1}", "Placed: {0}  ·  Rebars: {1}"), r.Placed, r.Rebars);
            if (r.Duplicates > 0) s += "\n" + F(T("Өмнө тавигдсан (давхар тавиагүй): {0}", "Already marked (skipped): {0}"), r.Duplicates);
            if (r.EndOn > 0) s += "\n" + F(T("Харагдацын нормальтай параллель (цэг болж харагдана — эргүүлээгүй): {0}", "End-on to the view (shown as a dot — not rotated): {0}"), r.EndOn);
            if (r.OutsideCrop > 0) s += "\n" + F(T("Crop хүрээнээс гадна (тавиагүй): {0}", "Outside the crop region (skipped): {0}"), r.OutsideCrop);
            if (r.HiddenBars > 0) s += "\n" + F(T("Энэ харагдацад нуугдсан ширхэг (алгассан): {0}", "Bars hidden in this view (skipped): {0}"), r.HiddenBars);
            if (r.NotVisible > 0) s += "\n" + F(T("Энэ харагдацад харагдахгүй арматур (алгассан): {0}", "Rebars not visible in this view (skipped): {0}"), r.NotVisible);
            if (r.OutsideDepth > 0) s += "\n" + F(T("Харагдацын гүнээс гадна төгсгөл (цэг болж харагдах арматур, алгассан): {0}", "Ends beyond the view depth (end-on bars, skipped): {0}"), r.OutsideDepth);
            if (r.FreeForm > 0) s += "\n" + F(T("Freeform арматур (дэмжигдэхгүй): {0}", "Freeform rebar (unsupported): {0}"), r.FreeForm);
            if (r.NoGeometry > 0) s += "\n" + F(T("Геометр уншигдаагүй арматур: {0}", "Rebars with no readable geometry: {0}"), r.NoGeometry);
            if (r.Unsupported > 0) s += "\n" + F(T("Арматур биш элемент (алгассан): {0}", "Non-rebar elements (skipped): {0}"), r.Unsupported);
            if (r.Damaged > 0) s += "\n" + F(T("Гэмтсэн тэмдэг (нэг хагас нь устсан эсвэл давхцуулж paste хийсэн) — ХӨНДӨӨГҮЙ; үлдсэнийг нь устгаад дахин тавина уу: {0}", "Damaged markers (half deleted or pasted on top) — left untouched; delete the remainder and place again: {0}"), r.Damaged);
            if (r.Copies > 0) s += "\n" + F(T("Copy/Paste-ийн хуулбар гэж таньсан тэмдэг (ХӨНДӨӨГҮЙ): {0}", "Markers recognised as Copy/Paste duplicates (left untouched): {0}"), r.Copies);
            if (r.DifferentSymbol > 0) s += "\n" + F(T("Энэ төгсгөлд ӨӨР төрлийн тэмдэг аль хэдийн тавигдсан тул солиогүй (хуучныг устгаад дахин тавина уу): {0}", "A DIFFERENT symbol was already placed at these ends, so it was not replaced (delete it and place again): {0}"), r.DifferentSymbol);
            if (r.Failures.Count > 0) s += "\n" + F(T("Алдаатай арматур: {0} (шалтгаан доор)", "Rebars that failed: {0} (reasons below)"), r.Failures.Count);
            if (r.NearestFallback > 0) s += "\n" + F(T("Олонлогийн (bar set) ширхгийг тодорхойлж чадсангүй (арматурыг урьдчилан сонгосон тул дарсан цэг байхгүй, эсвэл геометр уншигдсангүй) — бүх ширхэгт тавлаа: {0}", "Could not determine which bar of the set (no click point because the rebar was pre-selected, or geometry unreadable) — placed on every bar of the set: {0}"), r.NearestFallback);
            return s;
        }

        public static string MarkerNotWritten
        {
            get
            {
                return T("Тэмдэглэгээг (Extensible Storage) бичиж чадсангүй — тэмдгийг үлдээсэнгүй.",
                    "Could not write the marker (Extensible Storage) — the symbol was not kept.");
            }
        }

        public static string SymbolCategoryHidden(string cat)
        {
            return F(T("Анхааруулга: «{0}» ангилал энэ харагдацад НУУГДСАН (Visibility/Graphics) — тэмдэг тавигдсан ч харагдахгүй.", "Warning: the “{0}” category is HIDDEN in this view (Visibility/Graphics) — placed symbols will not be visible."), cat);
        }

        public static string SymbolCapReached(int n)
        {
            return F(T("Нэг удаад {0} тэмдгээс илүү тавихгүй — үлдсэнийг дахин ажиллуулж тавина уу.", "At most {0} symbols per run — run again for the rest."), n);
        }

        public static string EndFailed(string rebar, string msg)
        {
            return F(T("Арматур {0}: {1}", "Rebar {0}: {1}"), rebar, msg);
        }

        // ── Огтлолын арматурын тэмдэглэгээ ────────────────────────────
        public static string SecTitle { get { return T("MGL — Огтлолын арматурын тэмдэглэгээ", "MGL — Section rebar annotation"); } }
        public static string SecHeader { get { return T("Дам нуруу / баганын огтлол дээр хомутын хэмжээс, арматурын tag тавих", "Stirrup dimensions and rebar tags on a beam / column section"); } }
        public static string SecIntro
        {
            get
            {
                return T("Бетон нүүрээс хомутын гадна/дотор ирмэг хүртэл НЭГ ГИНЖИН хэмжээс (тэнхлэг бүрт), арматурын шошго тавина. Хэмжээс нь арматурын бодит лавлагаатай; нэмэлт шугам үүсгэхгүй. Огтлол эргэсэн ч (гишүүний тэнхлэгээр) зөв.",
                    "ONE continuous chain dimension per axis from the concrete face through the stirrup edges, and rebar tags. Dimensions use real rebar references; no helper lines are created. Works in rotated sections (uses the member's own axes).");
            }
        }
        public static string HostLabel { get { return T("Эзэн элемент", "Host"); } }
        public static string HostAuto { get { return T("Автомат", "Auto"); } }
        public static string HostBeam { get { return T("Дам нуруу", "Beam"); } }
        public static string HostColumn { get { return T("Багана", "Column"); } }

        public static string HostSelected(string name, string kind)
        {
            return F(T("Сонгосон: {0}  ({1})", "Selected: {0}  ({1})"), name, kind);
        }

        public static string HostMismatch(string detected)
        {
            return F(T("Сонгосон элемент «{0}» гэж танигдсан — таны сонгосон төрөлтэй таарахгүй байна.", "The element was recognised as “{0}” — it does not match the chosen kind."), detected);
        }

        public static string StirrupDimLabel { get { return T("Хэмжээс (гинжин)", "Dimensions (chain)"); } }
        public static string StirrupRefLabel { get { return T("Хомутын ирмэг", "Stirrup edge"); } }
        public static string TagsHeading { get { return T("Шошго (арматурын tag)", "Tags (rebar tags)"); } }
        public static string ContextViewLabel { get { return T("Харагдац:", "View:"); } }
        public static string ContextHostLabel { get { return T("Элемент:", "Element:"); } }
        public static string DimCategoryHidden { get { return T("Dimensions ангилал энэ харагдацад нуугдсан — хэмжээс үүссэн ч харагдахгүй.", "The Dimensions category is hidden in this view — dimensions would not be visible."); } }

        public static string ViewKindName(RfViewUse use)
        {
            switch (use)
            {
                case RfViewUse.Plan: return T("Төлөвлөгөө", "Plan");
                case RfViewUse.Section: return T("Огтлол", "Section");
                case RfViewUse.Elevation: return T("Фасад", "Elevation");
                case RfViewUse.Detail: return T("Detail", "Detail");
                default: return string.Empty;
            }
        }

        public static string PickHostAmbiguousPrompt { get { return T("Хэд хэдэн дам нуруу/багана сонгогдсон байна — НЭГИЙГ нь сонгоно уу (Esc = цуцлах).", "Several beams/columns are selected — pick ONE (Esc cancels)."); } }

        public static string SectionUnsupportedViewNamed(string viewName)
        {
            string tail = string.IsNullOrWhiteSpace(viewName) ? string.Empty : "\n\n" + F(T("Одоогийн харагдац: «{0}».", "Current view: “{0}”."), viewName);
            return T("Энэ хэрэгсэл огтлол (Section/Detail) эсвэл баганын план дээр ажиллана — дам нуруу/баганын огтлолын харагдацыг идэвхжүүлээд дахин дарна уу. Фасад, 3D, хуудас дээр ажиллахгүй.",
                "This tool works on a section (Section/Detail) or a column plan — activate the beam/column cut view and try again. It does not work in elevations, 3D or sheets.") + tail;
        }
        public static string RefOuter { get { return T("Хомутын гадна ирмэг — бетон гадаргуунд ойр тал", "Stirrup outer edge — the side nearer the concrete surface"); } }
        public static string RefInner { get { return T("Хомутын дотор ирмэг — огтлолын төв рүү харсан тал", "Stirrup inner edge — the side facing the section centre"); } }
        public static string RefCenter { get { return T("Тэнхлэг", "Centerline"); } }
        public static string SidesLabel { get { return T("Талууд", "Sides"); } }
        public static string SideLeft { get { return T("Зүүн", "Left"); } }
        public static string SideRight { get { return T("Баруун", "Right"); } }
        public static string SideTop { get { return T("Дээд", "Top"); } }
        public static string SideBottom { get { return T("Доод", "Bottom"); } }

        public static string SideName(RfSide s)
        {
            switch (s)
            {
                case RfSide.Left: return SideLeft;
                case RfSide.Right: return SideRight;
                case RfSide.Top: return SideTop;
                default: return SideBottom;
            }
        }

        public static string DimTypeLabel { get { return T("Хэмжээсийн төрөл", "Dimension type"); } }
        public static string DefaultType { get { return T("(файлын өгөгдмөл)", "(project default)"); } }
        public static string MainTagLabel { get { return T("Ажлын арматурын tag", "Longitudinal rebar tag"); } }
        public static string StirrupTagLabel { get { return T("Хомутын tag", "Stirrup tag"); } }
        public static string TagLayoutLabel { get { return T("Tag-ийн байрлуулалт", "Tag layout"); } }
        public static string LayoutAuto { get { return T("Автомат", "Auto"); } }
        public static string NoTagTypes { get { return T("(Rebar tag family ачаалаагүй)", "(no rebar tag family loaded)"); } }

        public static string DimOffsetLabel(string unit)
        {
            return F(T("Хэмжээсийн шугамын зай (цаасан дээр, {0})", "Dimension line offset (on paper, {0})"), unit);
        }

        public static string TagSpacingLabel(string unit)
        {
            return F(T("Tag хоорондын зай (цаасан дээр, {0})", "Tag spacing (on paper, {0})"), unit);
        }

        public static string DoDims { get { return T("Хомутын хэмжээс үүсгэх", "Create stirrup dimensions"); } }
        public static string TagLong { get { return T("Ажлын арматурыг tag-лах", "Tag the longitudinal bars"); } }
        public static string GroupTagsLabel { get { return T("Ижил дугаартай арматурын tag-ийг нэгтгэх (Rebar Number + төрөл / голч / shape / тал)", "Merge tags of bars with the same Rebar Number (+ type / diameter / shape / side)"); } }
        public static string ReplacePreviousLabel { get { return T("Өмнөх MGL тэмдэглэгээг солих", "Replace the previous MGL annotations"); } }
        public static string ReplacePreviousHint { get { return T("Зөвхөн энэ хэрэгслийн тавьсныг солино; гараар тавьсан хэмжээс, tag хэзээ ч устахгүй. Унтраавал өмнөх нь энгийн тэмдэглэгээ болж үлдэнэ.", "Only annotations placed by this tool are replaced; your own dimensions and tags are never deleted. If off, the previous ones stay as ordinary annotations."); } }
        public static string TagStirrupsLabel { get { return T("Хомутыг tag-лах", "Tag the stirrups"); } }
        public static string PreviewTitle { get { return T("Урьдчилсан харагдац", "Preview"); } }
        public static string Refreshing { get { return T("Шинэчилж байна…", "Updating…"); } }

        public static string AnalysisSummary(RfSectionContext c, RfSectionPlan p)
        {
            return F(T("Олдсон: хомут {0} · ажлын арматур {1} ширхэг ({2} элемент) · бетон нүүр {3}",
                "Found: {0} stirrup(s) · {1} longitudinal bar(s) ({2} element(s)) · {3} concrete face(s)"),
                p.Loops.Count, p.Bars.Count, p.Bars.Select(b => b.Id).Distinct().Count(), c.Input.Faces.Count);
        }

        public static string PlanSummary(RfSectionPlan p)
        {
            return F(T("Үүсгэнэ: {0} гинжин хэмжээс ({1} сегмент хүртэл) · {2} tag", "Will create: {0} chain dimension(s) (up to {1} segment(s)) · {2} tag(s)"),
                p.Chains.Count(ch => ch.IsValid), p.Chains.Where(ch => ch.IsValid).Sum(ch => ch.SegmentCount), p.Tags.Count);
        }

        public static string NoHostData
        {
            get
            {
                return T("Энэ элемент арматур агуулах боломжгүй (Rebar host биш). Дам нуруу, багана, ханан г.м. сонгоно уу.",
                    "This element cannot host rebar. Pick a beam, column, wall, etc.");
            }
        }

        public static string NotAHost { get { return T("Дам нуруу эсвэл баганаа сонгоно уу.", "Select a beam or a column."); } }
        public static string PickHostPrompt { get { return T("Огтлол дээрх дам нуруу эсвэл баганыг сонгоно уу.", "Select the beam or column in this section."); } }
        public static string SectionUnsupportedView
        {
            get
            {
                return T("Дам нурууны огтлол (Section/Detail) эсвэл баганын план нээгээд дахин дарна уу. Фасад, 3D, хуудас дээр ажиллахгүй.",
                    "Open a beam section (Section/Detail) or a column plan. Not available in elevations, 3D or sheets.");
            }
        }

        public static string SectionWarn(RfSectionWarning w)
        {
            switch (w.Code)
            {
                case RfSectionWarn.HostFaceMissing:
                    return F(T("«{0}» талын бетон нүүр олдсонгүй — тэр талд хэмжээс тавигдахгүй.", "No concrete face found on the “{0}” side — no dimension there."), SideByName(w.Arg));
                case RfSectionWarn.NotRectangular:
                    return T("Огтлол тэгш өнцөгт биш (налуу нүүртэй) — зөвхөн босоо/хэвтээ нүүрээр тооцлоо.", "The section is not rectangular (has sloped faces) — only axis-aligned faces were used.");
                case RfSectionWarn.NoFaces:
                    return T("Эзний нүүр олдсонгүй. Огтлолын хавтгай гишүүний тэнхлэгт перпендикуляр (±5°) байх ёстой.", "No host faces found. The section plane must be perpendicular (±5°) to the member axis.");
                case RfSectionWarn.NoStirrup:
                    return T("Хомут олдсонгүй (энэ харагдацад харагдаж буй, огтлолын хавтгайд ойр) — хомутын хэмжээс тавигдахгүй.", "No stirrup found (visible in this view and near the cut plane) — no stirrup dimensions.");
                case RfSectionWarn.NoLongitudinal:
                    return T("Огтлолыг огтолсон ажлын арматур олдсонгүй.", "No longitudinal bar is cut by the section.");
                case RfSectionWarn.StirrupSideMissing:
                    return F(T("«{0}» талд хомут олдсонгүй.", "No stirrup on the “{0}” side."), SideByName(w.Arg));
                case RfSectionWarn.StirrupOutsideConcrete:
                    return F(T("«{0}» талын хомут бетоноос гадна байна — өгөгдлийг шалгана уу (хэмжээс тавиагүй).", "The stirrup on the “{0}” side is outside the concrete — check the model (no dimension)."), SideByName(w.Arg));
                case RfSectionWarn.ManyStirrups:
                    return T("Хэд хэдэн өөр хомут бий — тал бүрт хамгийн гадна хомутыг хэмжлээ.", "Several different stirrups exist — the outermost one per side was dimensioned.");
                case RfSectionWarn.HostFaceAmbiguous:
                    return F(T("«{0}» талд огтлолыг хөвсөн, өөр байрлалтай хэд хэдэн параллель нүүр бий (T/L хэлбэр, ховил г.м.) — аль нь бетоны хил гэдэг тодорхойгүй тул хэмжээс тавигдсангүй.", "The “{0}” side has several parallel faces at different positions across the cut (T/L shape, rebate…) — the concrete boundary is ambiguous, so no dimension was placed."), SideByName(w.Arg));
                case RfSectionWarn.StirrupSideOpen:
                    return F(T("«{0}» талд хомутын бодит шулуун хэсэг дутуу (нээлттэй/U хэлбэр, ромб) — хэмжээсийг хүрээний хайрцгаар зохиохгүйн тулд алгаслаа.", "The stirrup has no real straight run on the “{0}” side (open/U-shaped, diamond) — the dimension was skipped rather than invented from a bounding box."), SideByName(w.Arg));
                case RfSectionWarn.StirrupDiameterUnknown:
                    return T("Хомутын голч уншигдсангүй — «Гадна/Дотор ирмэг» хэмжээс тавигдахгүй (зөвхөн «Тэнхлэг» боломжтой).", "The stirrup diameter could not be read — no outer/inner-edge dimensions (centerline only).");
                default:
                    return T("Зарим tag давхцаж магадгүй — гараар зөөнө үү.", "Some tags may still overlap — move them manually.");
            }
        }

        private static string SideByName(string arg)
        {
            RfSide s;
            return Enum.TryParse(arg, out s) ? SideName(s) : arg;
        }

        public static string SecDone { get { return T("Тэмдэглэгээ тавигдлаа", "Annotations placed"); } }
        public static string SecPartial { get { return T("Тэмдэглэгээ ХЭСЭГЧИЛЭН тавигдлаа", "Annotations placed PARTIALLY"); } }
        public static string ForeignRegistry
        {
            get
            {
                return T("Энэ харагдац өөр харагдацын хуулбар (Duplicate View) — хуулбар дахь өмнөх тэмдэглэгээнүүдийг энэ хэрэгсэл ТАНИХГҮЙ тул СОЛИХГҮЙ, устгахгүй; шинэ тэмдэглэгээ тэдгээрийн дээр нэмэгдэнэ. Давхардсаныг гараар цэвэрлэнэ үү.",
                    "This view is a copy of another view (Duplicate View) — the tool does not recognise the annotations copied into it, so it will NOT replace or delete them; new annotations are added on top. Clean up duplicates by hand.");
            }
        }
        public static string SecNothing { get { return T("Тэмдэглэгээ тавигдсангүй", "Nothing was placed"); } }

        public static string SecResult(RfSectionReport r)
        {
            string s = F(T("Гинжин хэмжээс: {0}/{1} ({2} сегмент)", "Chain dimensions: {0}/{1} ({2} segment(s))"), r.DimsMade, r.DimsPlanned, r.DimSegments);
            if (r.DimsMade > 0)
                s += T(" — арматурын БОДИТ лавлагаатай, нэмэлт шугам/зураасгүй (Revit-ийн жинхэнэ хэмжээс)", " — attached to real rebar references, no helper lines (a genuine Revit dimension)");
            if (r.DimsIncomplete > 0) s += "\n" + F(T("Бүрэн биш гинж: {0} (лавлагаа олдоогүй тал алгасагдсан — шалтгаан доор)", "Incomplete chains: {0} (sides without a rebar reference were skipped — reasons below)"), r.DimsIncomplete);
            if (r.DimsFailed > 0) s += "\n" + F(T("Үүсээгүй гинж: {0} (шалтгаан доор)", "Chains not created: {0} (reasons below)"), r.DimsFailed);
            s += "\n" + F(T("Tag: {0}/{1}", "Tags: {0}/{1}"), r.Tags, r.TagsPlanned);
            if (r.TagsPlanned > 0 && r.Tags < r.TagsPlanned) s += "\n" + F(T("⚠ {0} tag үүсээгүй — шалтгаан доор (Tag-ийн төрөл, ангилал нуугдсан эсэх, арматурын холбоос).", "⚠ {0} tag(s) were not created — see the reasons below (tag type, hidden category, rebar association)."), r.TagsPlanned - r.Tags);
            if (r.ReplacedPrevious > 0) s += "\n" + F(T("Өмнөх автомат тэмдэглэгээ солигдсон: {0}", "Previous automatic annotations replaced: {0}"), r.ReplacedPrevious);
            if (r.KeptPrevious > 0) s += "\n" + F(T("Өмнөх MGL тэмдэглэгээ {0} элемент солигдоогүй (энгийн тэмдэглэгээ болж үлдсэн).", "{0} element(s) of the previous MGL annotations were kept (now ordinary annotations)."), r.KeptPrevious);
            if (r.ProtectedPrevious > 0) s += "\n" + F(T("⚠ Өмнөх {0} элемент УСТГАГДААГҮЙ: тэдгээрт таны гараар тавьсан хэмжээс/тэмдэглэгээ холбогдсон (ж: үл үзэгдэх лавлагаа шугам).  Давхардал гарвал гараар цэвэрлэнэ үү.", "⚠ {0} previous element(s) were NOT deleted: your own dimensions/annotations are attached to them (e.g. the invisible reference line). Clean up duplicates by hand if any."), r.ProtectedPrevious);
            if (r.KeptOnFailure > 0) s += "\n" + F(T("Өмнөх {0} элемент УСТГАГДААГҮЙ: энэ удаа тэр төрлийн (хэмжээс/tag) шинэ тэмдэглэгээ БҮРЭН үүсээгүй. Давхардал харагдвал гараар цэвэрлэнэ үү.", "{0} previous element(s) were NOT deleted: the new annotations of that kind (dimensions/tags) were not fully created. Clean up duplicates by hand if any."), r.KeptOnFailure);
            if (r.StyleMismatch > 0) s += "\n" + F(T("RebarStyle ба геометр зөрсөн арматур (алгассан, таамаглаагүй): {0}", "Rebars whose RebarStyle and geometry disagree (skipped, not guessed): {0}"), r.StyleMismatch);
            if (r.GroupedTags > 0) s += "\n" + F(T("Ижил дугаартай (Rebar Number) арматурын tag нэгтгэгдсэн: {0}.  Нэгтгэсэн tag нь төлөөлөгч арматурын мэдээллийг л харуулна.", "Tags of bars with the same Rebar Number were merged: {0}. A merged tag shows only the representative bar's data."), r.GroupedTags);
            return s;
        }

        public static string NoReference { get { return T("Лавлагаа (Reference) олдсонгүй", "No Reference available"); } }
        public static string NoFaceReference { get { return T("Бетон нүүрний лавлагаа олдсонгүй", "No concrete-face Reference was found"); } }

        /// <summary>
        /// Арматурын хэмжээсийн лавлагаа олдоогүй үед тавигдах ЯГ ТОДОРХОЙ мэдэгдэл (инженерийн шаардлага).  Хуурамч лавлагаа ҮҮСГЭЖ «нөхөхгүй» — тэр талыг алгасна.
        /// </summary>
        public static string NoRebarRef { get { return T("Арматурын хэмжээсийн лавлагаа олдсонгүй.", "No rebar reference for the dimension was found."); } }

        public static string TryCenterHint { get { return T("«Тэнхлэг» горимыг сонгож үзнэ үү.", "Try the “Centerline” option."); } }
        public static string CylinderStats(string s) { return F(T("цилиндр нүүр: {0}", "cylindrical faces: {0}"), s); }
        public static string SetTooLarge { get { return F(T("олонлог хэт том (>{0} ширхэг) — лавлагаа хайгаагүй (удаан болох тул)", "bar set too large (>{0} bars) — references were not searched (too slow)"), RfRenderCaps.NativeSetCap); } }
        public static string CoverTooSmall { get { return T("Бетон нүүр ба хомутын ирмэг давхцсан (зай ≈ 0)", "Concrete face and stirrup edge coincide (distance ≈ 0)"); } }

        public static string AxisName(bool alongU) { return alongU ? T("Хэвтээ", "Horizontal") : T("Босоо", "Vertical"); }

        public static string ChainFailed(string axis, string reasons)
        {
            return F(T("«{0}» гинжин хэмжээс үүссэнгүй — {1}", "The “{0}” chain dimension was not created — {1}"), axis, reasons);
        }

        public static string ChainIncomplete(string axis, IList<RfSide> missing, string reasons)
        {
            string sides = string.Join(", ", missing.Select(SideName));
            return F(T("«{0}» гинж БҮРЭН БИШ: {1} тал(ууд) алгасагдлаа — {2}", "The “{0}” chain is INCOMPLETE: side(s) {1} were skipped — {2}"), axis, sides, reasons);
        }

        public static string ChainCoincident(string axis, IList<RfSide> sides)
        {
            return F(T("«{0}» гинж: {1} талд бетон нүүр ба хомутын ирмэг давхцсан тул тусдаа сегмент үүсээгүй.", "“{0}” chain: on side(s) {1} the concrete face and the stirrup edge coincide, so no separate segment was made."), axis, string.Join(", ", sides.Select(SideName)));
        }

        public static string MemberNothingLeft { get { return T("хучилт/ханын нүүрийг хассаны дараа гинжид хангалттай лавлагаа үлдсэнгүй", "not enough references remain after dropping slab/wall faces"); } }

        public static string MemberChainFailed(string axis, string reasons)
        {
            return F(T("Гишүүний «{0}» гадна хэмжээс (тэнхлэг/хучилт/хана) үүссэнгүй — {1}", "The member’s “{0}” outer dimension (grid/slab/wall) was not created — {1}"), axis, reasons);
        }

        public static string MemberDroppedNeighbors(string axis, string reasons)
        {
            return F(T("Гишүүний «{0}» гадна хэмжээсийг хучилт/ханын нүүргүйгээр тавилаа (тэдгээрийн лавлагаа хэмжигдсэнгүй — {1}).", "The member’s “{0}” outer dimension was placed without slab/wall faces (their references could not be measured — {1})."), axis, reasons);
        }

        public static string ChainReferenceCount(int actual, int expected)
        {
            return F(T("Хэмжээсийн лавлагааны тоо таарсангүй ({0} ≠ {1})", "Dimension reference count mismatch ({0} ≠ {1})"), actual, expected);
        }

        public static string ChainSegmentCount(int actual, int expected)
        {
            return F(T("Хэмжээсийн сегментийн тоо таарсангүй ({0} ≠ {1})", "Dimension segment count mismatch ({0} ≠ {1})"), actual, expected);
        }

        public static string ChainSegmentValue(int index, double actualFt, double expectedFt)
        {
            return F(T("{0}-р сегментийн утга таарсангүй ({1:0.##} мм ≠ {2:0.##} мм)", "Segment {0} value mismatch ({1:0.##} mm ≠ {2:0.##} mm)"),
                index, actualFt * RfTol.MmPerFoot, expectedFt * RfTol.MmPerFoot);
        }

        public static string ValueMismatch(double actual, double expected)
        {
            return F(T("Хэмжээсийн утга таарсангүй ({0:0.##} мм ≠ {1:0.##} мм)", "Dimension value mismatch ({0:0.##} mm ≠ {1:0.##} mm)"),
                actual * RfTol.MmPerFoot, expected * RfTol.MmPerFoot);
        }

        // ── Tag: урьдчилсан шалгалт ба алдаа ─────────────────────────────

        public static string TagCategoryHidden
        {
            get
            {
                return T("Structural Rebar Tags ангилал энэ харагдацад НУУГДСАН — tag үүссэн ч харагдахгүй тул үүсгээгүй. Харагдацын Visibility/Graphics (VG)-д «Structural Rebar Tags»-ыг нээнэ үү.",
                    "The Structural Rebar Tags category is HIDDEN in this view — tags would not be visible, so none were created. Turn it on in the view's Visibility/Graphics (VG).");
            }
        }

        public static string TagTypeNotForRebar { get { return T("Сонгосон шошго нь арматурт тохирохгүй байна (Structural Rebar Tag биш).", "The selected tag does not suit rebar (it is not a Structural Rebar Tag)."); } }
        public static string TagTypeNotSelected { get { return T("Арматурын шошгоны төрөл сонгоогүй байна.", "No rebar tag type is selected."); } }
        public static string TagTypeMissing { get { return T("Арматурын шошгоны төрөл олдсонгүй.", "No rebar tag type was found."); } }
        public static string TagTypeActivateFailed(string name, string msg) { return F(T("Шошгоны төрөл «{0}»-ийг идэвхжүүлж чадсангүй: {1}", "Could not activate the tag type “{0}”: {1}"), name, msg); }
        public static string TagFailedGeneral(string msg) { return F(T("Шошго үүсгэхэд алдаа гарлаа: {0}", "Tag creation failed: {0}"), msg); }
        public static string TagWrongType { get { return T("Үүссэн tag сонгосон төрөлтэй биш байна", "The created tag does not have the selected type"); } }
        public static string TagWrongView { get { return T("Үүссэн tag энэ харагдацад биш байна", "The created tag is not in this view"); } }
        public static string TagNotOnRebar
        {
            get
            {
                return T("⚠ Үүссэн tag энэ арматурт холбогдсоныг баталж чадсангүй (Revit-ийн холбоосын мэдээлэл өөр элементийг заав) — tag-ийг арматурыг сонгож шалгана уу.",
                    "⚠ Could not confirm that the created tag is attached to this rebar (Revit reported another element) — select the rebar and check the tag.");
            }
        }

        public static string TagProblemText(RfTagProblem p)
        {
            switch (p)
            {
                case RfTagProblem.NoTagTypes: return TagTypeMissing + " " + T("Insert → Load Family-аар Rebar tag ачаална уу.", "Load a rebar tag with Insert → Load Family.");
                case RfTagProblem.NotSelected: return TagTypeNotSelected;
                case RfTagProblem.NotRebarTag: return TagTypeNotForRebar;
                case RfTagProblem.CategoryHidden: return TagCategoryHidden;
                default: return string.Empty;
            }
        }

        public static string NoTagType(bool stirrup)
        {
            // Tag family ачаалаагүй бол tool унахгүй — tag-ийг алгасаж (хэмжээс хэвээр) ийм мэдэгдэл гаргана.
            return stirrup
                ? T("Арматурын tag family энэ төсөлд ачаалагдаагүй байна (хомутын tag алгасагдлаа). Insert → Load Family-аар Rebar tag ачаална уу.",
                    "No rebar tag family is loaded in this project (stirrup tags skipped). Load a rebar tag with Insert → Load Family.")
                : T("Арматурын tag family энэ төсөлд ачаалагдаагүй байна (ажлын арматурын tag алгасагдлаа). Insert → Load Family-аар Rebar tag ачаална уу.",
                    "No rebar tag family is loaded in this project (longitudinal tags skipped). Load a rebar tag with Insert → Load Family.");
        }

        public static string TagNoRebar(string id) { return F(T("Tag-ийн арматур {0} олдсонгүй.", "Rebar {0} for the tag was not found."), id); }
        public static string TagFailed(string id, string msg) { return F(T("Tag (арматур {0}): {1}", "Tag (rebar {0}): {1}"), id, msg); }
        public static string PreviousNotRemoved(string msg) { return F(T("Өмнөх автомат тэмдэглэгээг устгаж чадсангүй: {0}", "Could not remove the previous automatic annotations: {0}"), msg); }
        public static string ViewNotWritable
        {
            get
            {
                return T("Энэ харагдацыг өөр хэрэглэгч эзэмшиж байна (workshared) — бүртгэл бичигдэхгүй тул юу ч тавихгүй. Эзэмшил авсны дараа дахин оролдоно уу.",
                    "This view is owned by another user (workshared) — the record cannot be written, so nothing was placed. Take ownership and retry.");
            }
        }

        public static string TagLeaderNote(string rebar, string msg)
        {
            return F(T("Tag (арматур {0}): leader-ийн төгсгөлийг тохируулж чадсангүй ({1}) — tag арматурт холбогдсон хэвээр, гэхдээ leader өөр ширхэг рүү очсон байж магадгүй.",
                "Tag (rebar {0}): could not place the leader end ({1}) — the tag is still attached to the rebar but its leader may point at another bar."), rebar, msg);
        }

        public static string StoreNotWritten { get { return T("Бүртгэлийг харагдацад хадгалж чадсангүй (өөр хүн эзэмшиж байна уу?) — өөрчлөлт буцлаа.", "Could not store the record on the view (owned by someone else?) — the change was rolled back."); } }

        public static string EdgeLimitationNote
        {
            get
            {
                return T("⚠ Хэмжээс ЗӨВХӨН арматурын БОДИТ геометрийн Reference-аар үүснэ (нэмэлт шугам/зураас ХЭЗЭЭ Ч үүсгэхгүй). Revit API хомутын «гадна/дотор ирмэг»-д тогтвортой Reference өгдөггүй тул олдохгүй бол тэр талыг алгасч «Арматурын хэмжээсийн лавлагаа олдсонгүй.» гэж мэдэгдэнэ — «Тэнхлэг» горимыг ч сонгож үзнэ үү.",
                    "⚠ Dimensions are made ONLY from real rebar-geometry References (the tool never creates helper lines). Revit's API gives no stable Reference to a stirrup's outer/inner edge, so when none is found that side is skipped with “No rebar reference for the dimension was found.” — you can also try the Centerline option.");
            }
        }

        // ── Огтлол: ЗАГВАР ХАРАГДАЦААС ХУУЛАХ (2026-10-02) ───────────────
        public static string TplTitle { get { return T("MGL — Загвар харагдацаас хуулах", "MGL — Copy annotations from a template view"); } }
        public static string TplHeading { get { return T("Загвар харагдацаас хуулах", "Copy from a template view"); } }

        public static string TplIntro
        {
            get
            {
                return T("Өөрийн ГАРААР зурсан төстэй харагдацаа нэрээр нь сонгоно — түүний хэмжээс, арматурын tag, текстийг ЭНЭ харагдацын дам нуруу/багана дээр ижил байдлаар нэмнэ.  Шинэ харагдац ҮҮСГЭХГҮЙ: энэ харагдац дээр шууд нэмэгдэх тул дараа нь гараар засна.  Таны гараар тавьсан зүйл устахгүй.",
                    "Pick a similar view you drew by hand, by name — its dimensions, rebar tags and text are added to THIS view's beam/column the same way.  No new view is created: everything is added right on this view so you can edit it by hand afterwards.  Nothing you placed by hand is removed.");
            }
        }

        public static string TplSearchHint { get { return T("Загвар харагдац хайх (нэр)…", "Search template views (name)…"); } }
        public static string TplNoneChosen { get { return T("— загвар харагдац сонгоогүй —", "— no template view chosen —"); } }
        public static string TplNoCandidates { get { return T("Хэмжээс, tag-тай өөр харагдац олдсонгүй.", "No other view with dimensions or tags was found."); } }

        public static string TplCounts(int dims, int tags, int notes)
        {
            string s = F(T("хэмжээс {0} · tag {1}", "dimensions {0} · tags {1}"), dims, tags);
            if (notes > 0) s += F(T(" · текст {0}", " · text {0}"), notes);
            return s;
        }

        // ── «Хуулбарлаж зурах» таб (2026-10-05): «Хэмжээс, тэмдэглэгээ» хэрэгсэлд нэгтгэгдсэн
        public static string TplTabHeader { get { return T("Хуулбарлаж зурах", "Copy drawing"); } }
        public static string TplTargetLabel { get { return T("Зорилтот элемент (энэ харагдацад):", "Target element (in this view):"); } }
        public static string TplTargetPick { get { return T("Хэд хэдэн элемент байна — хуулж тавих нэгийг сонгоно уу:", "Several elements are in this view — pick the one to copy onto:"); } }

        public static string TplTargetNone
        {
            get
            {
                return T("Энэ харагдацад арматур агуулах дам нуруу/багана олдсонгүй — харагдацдаа элементээ харуулаад (эсвэл сонгоод) дахин нээнэ үү.",
                    "No beam/column that can host rebar is visible in this view — show the element (or select it) and reopen.");
            }
        }

        public static string TplUnsupportedView
        {
            get
            {
                return T("«Хуулбарлаж зурах» нь зөвхөн план, зүсэлт, detail харагдац дээр ажиллана (фасад дээр биш).",
                    "“Copy drawing” works only on plan, section and detail views (not elevations).");
            }
        }

        public static string TplHostLabel { get { return T("Загварын элемент:", "Template element:"); } }

        public static string TplHostNone
        {
            get
            {
                return T("Энэ харагдацын тэмдэглэгээнээс дам нуруу/баганыг тодорхойлж чадсангүй (хэмжээс, tag нь арматур эсвэл дам нуруу/баганыг заагаагүй байна) — өөр харагдац сонгоно уу.",
                    "No beam/column could be identified from this view's annotations (its dimensions/tags do not point at rebar or a beam/column) — pick another view.");
            }
        }

        public static string TplHostPick { get { return T("Хэд хэдэн элемент олдсон — загвар болгох нэгийг сонгоно уу:", "Several elements were found — pick the one to use as the template:"); } }
        public static string TplHostWorking { get { return T("Загварын элементийг тодорхойлж байна…", "Identifying the template element…"); } }

        public static string TplHostKindName(RfHostKind k)
        {
            return k == RfHostKind.Beam ? T("Дам нуруу", "Beam") : k == RfHostKind.Column ? T("Багана", "Column") : T("Элемент", "Element");
        }

        public static string TplHostKindMismatch(string tplKind, string tgtKind)
        {
            return F(T("Загвар нь «{0}», энэ харагдацын элемент «{1}» — өөр төрөл тул арматурын тулгалт бүрэн таарахгүй байж болно.",
                "The template is a “{0}” but this view's element is a “{1}” — a different kind, so the rebar matching may be incomplete."), tplKind, tgtKind);
        }

        public static string TplOptDims { get { return T("Хэмжээс (арматурын хэмжээс/MRA орно)", "Dimensions (incl. rebar dimensions/MRA)"); } }
        public static string TplOptTags { get { return T("Tag (арматурын шошго)", "Tags (rebar tags)"); } }
        public static string TplOptDetails { get { return T("Текст, 2D зураас", "Text, 2D lines"); } }
        public static string TplCopy { get { return T("Загвараас хуулах", "Copy from template"); } }
        public static string TplNeedOption { get { return T("Ядаж нэгийг сонгоно уу: хэмжээс, tag, текст.", "Choose at least one: dimensions, tags, text."); } }

        public static string TplDone { get { return T("Загвараас хууллаа", "Copied from the template"); } }
        public static string TplPartial { get { return T("Загвараас ХЭСЭГЧИЛЭН хууллаа", "Copied PARTIALLY from the template"); } }
        public static string TplNothing { get { return T("Юу ч хуулагдсангүй", "Nothing was copied"); } }
        public static string TplFlipNote { get { return T("Идэвхтэй харагдац загварыг ЭСРЭГ талаас харж байгаа тул байрлалыг зүүн-баруун эргүүлж буулгав.", "This view looks at the element from the OPPOSITE side of the template, so positions were mirrored left-right to match."); } }
        public static string TplRolledBack { get { return T("Revit хэмжээс/tag-ийг хүлээж авсангүй (алдаа) — бүгд буцаагдлаа, юу ч өөрчлөгдсөнгүй.", "Revit rejected the dimensions/tags — everything was rolled back, nothing changed."); } }
        public static string TplNoSource { get { return T("Загвар харагдацад хуулах тэмдэглэгээ олдсонгүй (сонгосон төрлөөр).", "The template view has nothing to copy (for the selected kinds)."); } }

        public static string TplResult(RfTemplateRunReport r, string templateName, string activeName)
        {
            CdReport c = r.Cd;
            var lines = new List<string>
            {
                F(T("Загвар: «{0}»  →  энэ харагдац: «{1}»", "Template: “{0}”  →  this view: “{1}”"), templateName, activeName),
                F(T("Хэмжээс: {0}", "Dimensions: {0}"), c.Dims) + Tail(c.DimsExisting, c.DimsSkipped),
                F(T("Tag (MRA орно): {0}", "Tags (incl. MRA): {0}"), c.Tags) + Tail(c.TagsExisting, c.TagsSkipped),
                F(T("Текст, 2D: {0}", "Text, 2D: {0}"), c.Details) + (c.DetailsSkipped > 0 ? F(T("   (алгассан {0})", "   (skipped {0})"), c.DetailsSkipped) : string.Empty),
            };
            if (c.RebarMatched + c.RebarUnmatched > 0)
                lines.Add(F(T("Арматур тулгасан: {0}", "Rebar matched: {0}"), c.RebarMatched)
                    + (c.RebarUnmatched > 0 ? F(T("   (тохирох нь олдоогүй {0})", "   (no counterpart found for {0})"), c.RebarUnmatched) : string.Empty));
            if (c.DimsAdapted > 0)
                lines.Add(F(T("Хэмжээний утга зорилтод тохирсон хэмжээс: {0} — утгыг шалгана уу.", "Dimensions whose value was adapted to this element: {0} — please check the values."), c.DimsAdapted));
            if (c.DimsValueMismatch > 0)
                lines.Add(F(T("Утга нь загвараас зөрсөн тул үүсгээгүй хэмжээс: {0}", "Dimensions not created because the value differed from the template: {0}"), c.DimsValueMismatch));
            if (r.Flipped) lines.Add(TplFlipNote);
            if (r.TemplateScale > 0 && r.TargetScale > 0 && r.TemplateScale != r.TargetScale)
                lines.Add(F(T("Харагдацын масштаб өөр (1:{0} → 1:{1}) — tag, хэмжээсийн зай цаасан дээр өөр харагдана; хэрэгтэй бол зөөнө үү.",
                    "The view scale differs (1:{0} → 1:{1}) — tag/dimension spacing looks different on paper; move them if needed."), r.TemplateScale, r.TargetScale));
            return string.Join("\n", lines);
        }

        private static string Tail(int existing, int skipped)
        {
            var parts = new List<string>();
            if (existing > 0) parts.Add(F(T("байсан {0}", "already there {0}"), existing));
            if (skipped > 0) parts.Add(F(T("алгассан {0}", "skipped {0}"), skipped));
            return parts.Count == 0 ? string.Empty : "   (" + string.Join(", ", parts) + ")";
        }

        public static string RefreshSecSummary(int sets, int dims, int tags, int orphans)
        {
            return F(T("Огтлолын багц: {0} · хэмжээс {1} · tag {2}", "Section sets: {0} · dimensions {1} · tags {2}"), sets, dims, tags)
                + (orphans > 0 ? "\n" + F(T("Эзэн олдохгүй эсвэл дахин тооцоход юу ч үүсэхгүй (хөндөөгүй, УСТГААГҮЙ): {0}", "Host missing or nothing to place on re-analysis (left as is, NOT deleted): {0}"), orphans) : string.Empty);
        }

        public static string RefreshAskTitle { get { return T("Огтлолын хэмжээс/tag-ийг дахин үүсгэх үү?", "Recreate the section dimensions/tags?"); } }

        public static string RefreshAskBody(int sets)
        {
            return F(T("Энэ харагдацад огтлолын тэмдэглэгээний {0} багц бий.  Тэдгээрийг шинэчлэх нь хэмжээс, tag-ийг ШИНЭЭР үүсгээд өмнөхийг солино — гараар зөөсөн/форматласан байрлал алдагдана (гараар тавьсан хэмжээс, tag хөндөгдөхгүй).",
                "This view has {0} section annotation set(s). Refreshing them recreates the dimensions and tags and replaces the previous ones — positions you moved/formatted by hand are lost (your own dimensions and tags are never touched)."), sets);
        }

        public static string RefreshAskAll { get { return T("Бүгдийг шинэчлэх (хэмжээс/tag дахин үүснэ)", "Refresh everything (dimensions/tags are recreated)"); } }
        public static string RefreshAskEndOnly { get { return T("Зөвхөн төгсгөлийн тэмдгийг шинэчлэх (аюулгүй)", "Refresh end symbols only (safe)"); } }

        public static string RefreshDone { get { return T("Тэмдэглэгээ шинэчлэгдлээ", "Annotations refreshed"); } }
        public static string RefreshNothing { get { return T("Энэ харагдацад энэ хэрэгслийн тавьсан тэмдэглэгээ олдсонгүй.", "No annotations placed by this tool were found in this view."); } }

        public static string RefreshResult(RfEndSymbolReport r)
        {
            string s = F(T("Шинэчилсэн: {0}  ·  Өөрчлөгдөөгүй: {1}", "Updated: {0}  ·  Unchanged: {1}"), r.Updated, r.Unchanged);
            if (r.Orphans > 0)
                s += "\n" + F(T("Арматур олдохгүй / төгсгөл тооцогдохгүй (хөндөөгүй, УСТГААГҮЙ): {0}", "Rebar missing / end not computable (left as is, NOT deleted): {0}"), r.Orphans);
            if (r.Damaged > 0)
                s += "\n" + F(T("Гэмтсэн тэмдэг (нэг хагас нь устсан эсвэл давхцуулж paste хийсэн) — ХӨНДӨӨГҮЙ: {0}", "Damaged markers (half deleted or pasted on top) — left untouched: {0}"), r.Damaged);
            if (r.Copies > 0)
                s += "\n" + F(T("Copy/Paste-ийн хуулбар гэж таньсан тэмдэг — ХӨНДӨӨГҮЙ: {0}", "Markers recognised as Copy/Paste duplicates — left untouched: {0}"), r.Copies);
            if (r.Failures.Count > 0)
                s += "\n" + F(T("Алдаатай: {0} (шалтгаан доор)", "Failed: {0} (reasons below)"), r.Failures.Count);
            return s;
        }
    }
}
