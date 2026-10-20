using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using RevitMcpAddin.SheetNumerator.Core;
using RevitMcpAddin.SheetNumerator.Ui;

namespace RevitMcpAddin.SheetNumerator.UiSmoke
{
    /// <summary>
    /// Санах ойн «Revit»: ViewModel-ийн gateway.  Бодит Apply-ийн гол гэрээг дууриана — гаднаас өөрчлөгдсөн хуудсыг
    /// (дугаар/нэр) таньж Stale, давхардлыг Blocked болгоно; амжилттай бол өөрийн snapshot-ыг шинэчилнэ.
    /// `ForcedApply` тохируулбал үр дүнг ШУУД буцаана (RolledBack, WorksharingBlocked … хэлбэрийн UI-г шалгахад).
    /// </summary>
    internal sealed class FakeGateway : ISheetNumeratorGateway
    {
        public DocumentSnapshot Doc;
        public ApplyResult ForcedApply;
        public MarkerCapabilities Markers = new MarkerCapabilities();
        public int DelayMs;

        public int LoadCount, ApplyCount, RenameCount, DeleteCount, StampCount, ProbeCount;
        public ApplyRequest LastApply;
        public RenameRequest LastRename;
        public DeleteRequest LastDelete;

        public string LogPath { get { return @"C:\fake\sheet-numerator.log"; } }

        private Task Pause()
        {
            return DelayMs > 0 ? Task.Delay(DelayMs) : Task.FromResult(0);
        }

        public async Task<SnapshotResult> LoadAsync()
        {
            LoadCount++;
            await Pause();
            if (Doc == null)
                return new SnapshotResult { Success = false, Error = Msg.NoDocumentNotice };
            return new SnapshotResult { Success = true, Snapshot = Docs.Clone(Doc) };
        }

        public DocumentStamp Stamp()
        {
            var s = new DocumentStamp { HasDocument = Doc != null, DocumentKey = Doc != null ? Doc.DocumentKey : null };
            if (Doc != null)
            {
                foreach (SheetSnapshot sh in Doc.Sheets)
                {
                    s.Sheets.Add(new SheetStamp
                    {
                        SheetId = sh.SheetId, UniqueId = sh.UniqueId, Number = sh.Number, Name = sh.Name,
                        CollectionId = sh.CollectionId, IsAssemblySheet = sh.IsAssemblySheet, AssemblyId = sh.AssemblyId,
                    });
                }
            }
            return s;
        }

        public async Task<DocumentStamp> ReadStampAsync()
        {
            StampCount++;
            await Pause();
            return Stamp();
        }

        public async Task<MarkerCapabilities> ProbeMarkersAsync()
        {
            ProbeCount++;
            await Pause();
            return Markers;
        }

        public async Task<ApplyResult> ApplyAsync(ApplyRequest request)
        {
            await Pause();
            if (ForcedApply != null)
                return ForcedApply;

            ApplyCount++;
            LastApply = request;

            if (!string.Equals(request.DocumentKey, Doc.DocumentKey, StringComparison.Ordinal))
                return new ApplyResult { Outcome = ApplyOutcome.Stale, Message = Msg.DocumentChangedNotice };

            var stale = new List<ApplyProblem>();
            foreach (ApplyItem it in request.Items)
            {
                SheetSnapshot sh = Doc.FindSheet(it.SheetId);
                if (sh == null)
                {
                    stale.Add(new ApplyProblem { SheetId = it.SheetId, Number = it.ExpectedNumber, Name = it.ExpectedName, Message = "Хуудас устсан." });
                    continue;
                }
                if (!string.Equals(sh.Number, it.ExpectedNumber, StringComparison.Ordinal)
                    || !string.Equals(sh.Name, it.ExpectedName, StringComparison.Ordinal))
                {
                    stale.Add(new ApplyProblem { SheetId = it.SheetId, Number = sh.Number, Name = sh.Name, Message = "Дугаар/нэр гаднаас өөрчлөгдсөн." });
                }
            }
            if (stale.Count > 0)
                return new ApplyResult { Outcome = ApplyOutcome.Stale, Message = Msg.StaleNotice, Problems = stale };

            IReadOnlyList<DuplicateHit> hits = FreshnessChecker.FindLiveDuplicates(Stamp(), Doc.Uniqueness, request.Items);
            if (hits.Count > 0)
            {
                var blocked = new ApplyResult { Outcome = ApplyOutcome.Blocked, Message = Msg.BlockedByDuplicates(hits.Count) };
                foreach (DuplicateHit h in hits)
                    blocked.Problems.Add(new ApplyProblem { SheetId = h.SheetId, Number = h.Number, Message = Msg.DuplicateNumber(h.Number) });
                return blocked;
            }

            int numbers = 0, names = 0, writes = 0;
            foreach (ApplyItem it in request.Items)
            {
                SheetSnapshot sh = Doc.FindSheet(it.SheetId);
                if (it.NumberChanges)
                {
                    sh.Number = it.NewNumber;
                    numbers++;
                }
                if (it.NameChanges)
                {
                    sh.Name = it.NewName;
                    names++;
                }
                if (it.Writes != null && it.Writes.Count > 0)
                {
                    var d = new Dictionary<string, SheetParameterValue>(sh.Parameters.ToDictionary(kv => kv.Key, kv => kv.Value));
                    foreach (ParameterWrite w in it.Writes)
                    {
                        d[w.Key.Stable] = new SheetParameterValue(true, w.Describe());
                        writes++;
                    }
                    sh.Parameters = d;
                }
            }
            return new ApplyResult
            {
                Outcome = ApplyOutcome.Applied,
                Message = Msg.Applied(numbers, names, writes),
                NumbersChanged = numbers, NamesChanged = names, ParametersWritten = writes,
            };
        }

        public async Task<OperationResult> RenameAsync(RenameRequest request)
        {
            RenameCount++;
            LastRename = request;
            await Pause();
            SheetSnapshot sh = Doc.FindSheet(request.SheetId);
            if (sh == null || sh.Number != request.ExpectedNumber || sh.Name != request.ExpectedName)
                return new OperationResult { Success = false, Stale = true, Message = Msg.StaleNotice };
            sh.Name = request.NewName;
            return new OperationResult { Success = true, Message = "Нэр өөрчлөгдлөө." };
        }

        public async Task<OperationResult> DeleteAsync(DeleteRequest request)
        {
            DeleteCount++;
            LastDelete = request;
            await Pause();
            SheetSnapshot sh = Doc.FindSheet(request.SheetId);
            if (sh == null || sh.Number != request.ExpectedNumber || sh.Name != request.ExpectedName)
                return new OperationResult { Success = false, Stale = true, Message = Msg.StaleNotice };
            Doc.Sheets = Doc.Sheets.Where(s => s.SheetId != request.SheetId).ToList();
            return new OperationResult { Success = true, Message = "Хуудас устгагдлаа." };
        }
    }

    /// <summary>Хэрэглэгчийн цонхуудын (баталгаа, текст, алдаа) хуурамч хариулт.  Дуудлага бүр бүртгэгдэнэ.</summary>
    internal sealed class FakePrompts : IUserPrompts
    {
        public bool ConfirmAnswer = true;
        public string TextAnswer;                     // null = болиулсан
        public readonly List<string> Confirms = new List<string>();
        public readonly List<string> Errors = new List<string>();
        public readonly List<string> Infos = new List<string>();
        public readonly List<string> TextPrompts = new List<string>();

        public bool Confirm(string title, string message, bool destructive)
        {
            Confirms.Add(message);
            return ConfirmAnswer;
        }

        public string AskText(string title, string prompt, string initial)
        {
            TextPrompts.Add(prompt + " | " + initial);
            return TextAnswer;
        }

        public void ShowError(string title, string message, string detail)
        {
            Errors.Add(message + (string.IsNullOrEmpty(detail) ? string.Empty : " || " + detail));
        }

        public void ShowInfo(string title, string message)
        {
            Infos.Add(message);
        }
    }

    /// <summary>Смоукт хэрэглэх жишиг төслүүд.</summary>
    internal static class Docs
    {
        public static readonly ParameterKey IssueKey = ParameterKey.Project("Issue Code");
        public static readonly ParameterKey GroupCountKey = ParameterKey.Project("Group Count");
        public static readonly ParameterKey DisciplineKey = ParameterKey.BuiltIn(-1007404);

        private static FolderSegment Seg(string name)
        {
            return new FolderSegment(name, -1007404);
        }

        private static int _index;

        private static SheetSnapshot Sheet(long id, string number, string name, string folder = null, long collection = 0,
            string collectionName = null, bool assembly = false, long assemblyId = 0, bool placeholder = false, bool hidden = false,
            string issue = null)
        {
            var s = new SheetSnapshot
            {
                SheetId = id,
                UniqueId = "uid-" + id,
                Number = number,
                Name = name,
                IsPlaceholder = placeholder,
                IsAssemblySheet = assembly,
                AssemblyId = assemblyId,
                AssemblyName = assembly ? "Фасадны assembly " + assemblyId : null,
                CollectionId = collection,
                CollectionName = collectionName,
                BrowserPath = folder != null ? new[] { Seg(folder) } : new FolderSegment[0],
                SatisfiesBrowserFilter = !hidden,
                SortKey = number,
                DocumentIndex = _index++,
            };
            var p = new Dictionary<string, SheetParameterValue>();
            p[IssueKey.Stable] = new SheetParameterValue(issue != null, issue ?? string.Empty);
            p[GroupCountKey.Stable] = new SheetParameterValue(false, string.Empty);
            p[DisciplineKey.Stable] = new SheetParameterValue(folder != null, folder ?? string.Empty);
            s.Parameters = p;
            return s;
        }

        /// <summary>
        /// Бодит төсөлд ойр: 3 хавтас (АРХ/КОН/ЦАХ), хуудасны цуглуулга, assembly, placeholder, нуугдсан хуудас.
        /// Идэвхтэй хуудас = «КОН» бүлгийн К-002.
        /// </summary>
        public static DocumentSnapshot Typical()
        {
            _index = 0;
            var sheets = new List<SheetSnapshot>
            {
                Sheet(101, "A-001", "Нүүр фасад", "АРХ", issue: "IFC-1"),
                Sheet(102, "A-002", "Хойд фасад", "АРХ", issue: "IFC-1"),
                Sheet(103, "A-003", "1-р давхрын план", "АРХ", issue: "IFC-2"),
                Sheet(104, "A-004", "2-р давхрын план", "АРХ"),
                Sheet(105, "A-005", "Зүсэлт 1-1", "АРХ"),
                Sheet(106, "A-006", "Зүсэлт 2-2", "АРХ", placeholder: true),
                Sheet(201, "K-001", "Суурийн план", "КОН"),
                Sheet(202, "K-002", "Тулгуурын схем", "КОН"),
                Sheet(203, "K-003", "Хөндлөвчний схем", "КОН"),
                Sheet(204, "K-004", "Арматурын задлал", "КОН"),
                Sheet(301, "E-01", "Цахилгааны нэг шугамын схем", "ЦАХ"),
                Sheet(302, "E-02", "Гэрэлтүүлгийн план", "ЦАХ"),
                Sheet(303, "E-03", "Хүчний сүлжээ", "ЦАХ"),
                Sheet(401, "S-01", "Эхний шатны ерөнхий план", collection: 5001, collectionName: "1-р шат"),
                Sheet(402, "S-02", "Эхний шатны зүсэлт", collection: 5001, collectionName: "1-р шат"),
                Sheet(403, "S-01", "Хоёр дахь шатны ерөнхий план", collection: 5002, collectionName: "2-р шат"),
                Sheet(501, "ASM-01", "Фасадны угсралт 1", assembly: true, assemblyId: 9001),
                Sheet(502, "ASM-02", "Фасадны угсралт 1 — дэлгэрэнгүй", assembly: true, assemblyId: 9001),
                Sheet(601, "X-99", "Шүүлтүүрээр нуугдсан хуудас", "АРХ", hidden: true),
            };
            return new DocumentSnapshot
            {
                DocumentKey = "doc-typical",
                DocumentTitle = "Тест төсөл — MGL.rvt",
                RevitVersion = "2027",
                RevitVersionNumber = 2027,
                IsWorkshared = false,
                Uniqueness = UniquenessMode.PerSheetCollection,
                Sheets = sheets,
                ParameterCatalog = new List<SheetParameterInfo>
                {
                    new SheetParameterInfo { Key = IssueKey, DisplayName = "Issue Code", ValueKind = ParamValueKind.Text, PresentOnSheets = sheets.Count },
                    new SheetParameterInfo { Key = GroupCountKey, DisplayName = "Group Count", ValueKind = ParamValueKind.Integer, PresentOnSheets = sheets.Count },
                    new SheetParameterInfo { Key = DisciplineKey, DisplayName = "Discipline", ValueKind = ParamValueKind.Text, PresentOnSheets = sheets.Count },
                    new SheetParameterInfo { Key = ParameterKey.BuiltIn(-1007406), DisplayName = "Sheet Issue Date", ValueKind = ParamValueKind.Text, IsReadOnly = true, PresentOnSheets = sheets.Count },
                },
                ActiveSheetId = 202,
                Browser = new BrowserInfo { OrganizationName = "Хавтасаар (Discipline)", HasGrouping = true, SortParameterName = "Sheet Number" },
                Collections = new List<CollectionInfo>
                {
                    new CollectionInfo { Id = 5001, Name = "1-р шат" },
                    new CollectionInfo { Id = 5002, Name = "2-р шат" },
                },
                CapturedUtc = DateTime.UtcNow,
            };
        }

        /// <summary>Нэг том бүлэг (N хуудас) — гүйцэтгэлийн шалгалт.</summary>
        public static DocumentSnapshot Large(int count)
        {
            _index = 0;
            var sheets = new List<SheetSnapshot>();
            for (int i = 1; i <= count; i++)
                sheets.Add(Sheet(1000 + i, "A-" + i.ToString("000"), "Зураг " + i, "АРХ"));
            var doc = Typical();
            doc.DocumentKey = "doc-large";
            doc.Sheets = sheets;
            doc.Collections = new CollectionInfo[0];
            doc.ActiveSheetId = 0;
            return doc;
        }

        public static DocumentSnapshot Clone(DocumentSnapshot d)
        {
            return new DocumentSnapshot
            {
                DocumentKey = d.DocumentKey,
                DocumentTitle = d.DocumentTitle,
                RevitVersion = d.RevitVersion,
                RevitVersionNumber = d.RevitVersionNumber,
                IsWorkshared = d.IsWorkshared,
                Uniqueness = d.Uniqueness,
                Sheets = d.Sheets.Select(CloneSheet).ToList(),
                ParameterCatalog = d.ParameterCatalog,
                ActiveSheetId = d.ActiveSheetId,
                Browser = d.Browser,
                Collections = d.Collections,
                CapturedUtc = DateTime.UtcNow,
            };
        }

        private static SheetSnapshot CloneSheet(SheetSnapshot s)
        {
            return new SheetSnapshot
            {
                SheetId = s.SheetId, UniqueId = s.UniqueId, Number = s.Number, Name = s.Name,
                IsPlaceholder = s.IsPlaceholder, IsAssemblySheet = s.IsAssemblySheet, AssemblyId = s.AssemblyId,
                AssemblyName = s.AssemblyName, CollectionId = s.CollectionId, CollectionName = s.CollectionName,
                BrowserPath = s.BrowserPath, SatisfiesBrowserFilter = s.SatisfiesBrowserFilter, SortKey = s.SortKey,
                DocumentIndex = s.DocumentIndex, Parameters = new Dictionary<string, SheetParameterValue>(s.Parameters.ToDictionary(kv => kv.Key, kv => kv.Value)),
            };
        }
    }
}
