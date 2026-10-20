using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.SheetNumerator.Core;

namespace RevitMcpAddin.SheetNumerator.Revit
{
    /// <summary>
    /// Дугаарлалтыг Revit-д БИЧИХ ГАНЦ газар — зөвхөн ExternalEvent handler-ээс (Revit API-ийн хүчинтэй контекст).
    ///
    /// АТОМ алгоритм (эзний ШААРДЛАГА — шууд нэг нэгээр нь оноож БОЛОХГҮЙ: 01↔02 солилт хоёр дахь оноолтод
    /// давхардаж унана):
    ///   1. Идэвхтэй document, хуудас, давхардлыг ҮНЭН (одоогийн) байдлаар дахин шалгана.
    ///   2. TransactionGroup «MGL – Зургийн хуудас дугаарлах».
    ///   3. Transaction A: өөрчлөгдөх хуудас бүрт ХУУЛЬ ЁСНЫ, ДАВХЦАХГҮЙ түр дугаар `MGLTMP_&lt;guid&gt;_&lt;i&gt;`.
    ///   4. Transaction B: эцсийн дугаар, нэр, параметр.
    ///   5. Буцаан уншиж баталгаажуулна → `Assimilate()` (нэг Ctrl+Z).
    ///   6. Аль ч алхамд алдаа гарвал TransactionGroup-ийг БҮХЭЛД НЬ `RollBack()` — хагас дугаарлалт үлдэхгүй.
    ///
    /// ⚠️ «Юу ч өөрчлөгдөөгүй» гэж ЗӨВХӨН буцаалт бодитоор амжилттай (дугаар, нэр анхных болсныг уншиж баталгаажуулсан)
    /// үед л мэдэгдэнэ.  Үгүй бол <see cref="ApplyOutcome.RollbackUnverified"/> + хэрэглэгчид шалгахыг хэлнэ.
    /// ⚠️ Өөр хэрэглэгчийн эзэмшилд байгаа хуудсыг ЗАВШИХ (checkout хийх) оролдлого ХИЙХГҮЙ — ямар ч өөрчлөлтөөс өмнө
    /// бүгдийг шалгаж, нэг нь ч боломжгүй бол юу ч бичихгүйгээр зогсоно.
    /// </summary>
    internal static class RenumberApplyService
    {
        /// <summary>
        /// ТЕСТИЙН ЦООРХОЙ (Revit дотор гараар/harness-аар): «after-temp» гэж тавибал түр дугаар оноож Transaction A
        /// commit хийгдсэний ДАРАА зориуд алдаа шидэж, TransactionGroup-ийн буцаалтыг шалгана.  Үйлдвэрлэлд ХЭЗЭЭ Ч
        /// тохируулагдахгүй (null).
        /// </summary>
        internal static string FailAtStage { get; set; }

        private sealed class SheetOpException : Exception
        {
            public SheetOpException(ApplyProblem problem, Exception inner)
                : base(problem.Message, inner)
            {
                Problem = problem;
            }

            public ApplyProblem Problem { get; }
        }

        public static ApplyResult Apply(UIApplication uiapp, ApplyRequest req)
        {
            UIDocument uidoc = uiapp.ActiveUIDocument;
            return Apply(uidoc != null ? uidoc.Document : null, req);
        }

        /// <summary>Document-оор (UIApplication-гүй) — scratch document дээрх автомат шалгалтад ч адил.</summary>
        public static ApplyResult Apply(Document doc, ApplyRequest req)
        {
            if (doc == null || doc.IsFamilyDocument)
                return Stale(Msg.NoDocumentNotice, null);

            if (!string.Equals(SheetSnapshotService.DocumentKeyOf(doc), req.DocumentKey, StringComparison.Ordinal))
                return Stale(Msg.DocumentChangedNotice, null);

            List<ApplyItem> items = req.Items.Where(i => i.AnyChange).ToList();
            if (items.Count == 0)
                return new ApplyResult { Outcome = ApplyOutcome.NothingToDo, Message = Msg.NothingToApply };

            if (doc.IsReadOnly)
                return Blocked(Msg.ReadOnlyDocument, null);

            // ── 1. Одоогийн байдал ──────────────────────────────────
            DocumentStamp live = SheetSnapshotService.ReadStamp(doc);
            var sheets = new Dictionary<long, ViewSheet>();
            var stale = new List<string>();
            foreach (ApplyItem it in items)
            {
                ViewSheet sh = doc.GetElement(new ElementId(it.SheetId)) as ViewSheet;
                if (sh == null || !string.Equals(sh.UniqueId, it.UniqueId, StringComparison.Ordinal))
                {
                    stale.Add(Msg.SheetNoLongerExists(it.ExpectedNumber, it.ExpectedName));
                    continue;
                }
                sheets[it.SheetId] = sh;
                if (!string.Equals(sh.SheetNumber, it.ExpectedNumber, StringComparison.Ordinal))
                    stale.Add(Msg.SheetNumberChangedExternally(it.ExpectedNumber, sh.SheetNumber));
                if (!string.Equals(sh.Name, it.ExpectedName, StringComparison.Ordinal))
                    stale.Add(Msg.SheetNameChangedExternally(it.ExpectedNumber, it.ExpectedName, sh.Name));
            }
            if (stale.Count > 0)
                return Stale(Msg.StaleNotice, stale);

            // ── 2. Давхардал (ҮНЭН дугаарууд дээр) ──────────────────
            var numberProblems = new List<ApplyProblem>();
            foreach (ApplyItem it in items.Where(i => i.NumberChanges))
            {
                string why = NumberProblem(it.NewNumber);
                if (why != null)
                    numberProblems.Add(Problem(it, why));
            }
            IReadOnlyList<DuplicateHit> dups = FreshnessChecker.FindLiveDuplicates(live, req.Uniqueness, items);
            foreach (DuplicateHit h in dups)
            {
                ApplyItem it = items.First(i => i.SheetId == h.SheetId);
                numberProblems.Add(Problem(it, Msg.DuplicateNumber(h.Number).Replace("\n", " ")));
            }
            if (numberProblems.Count > 0)
            {
                ApplyResult r = Blocked(Msg.BlockedByDuplicates(numberProblems.Count), numberProblems);
                return r;
            }

            // ── 3. Эзэмшил (workshared) ─────────────────────────────
            if (doc.IsWorkshared)
            {
                List<ApplyProblem> notEditable = CheckModifiable(doc, items, sheets);
                if (notEditable.Count > 0)
                    return Blocked(Msg.WorksharingBlocked, notEditable);
            }

            // ── 4. Параметрийн холбоо ───────────────────────────────
            var bindingProblems = new List<ApplyProblem>();
            foreach (ApplyItem it in items)
            {
                foreach (ParameterWrite w in it.Writes)
                {
                    string why = SheetParameterService.CheckWritable(sheets[it.SheetId], w);
                    if (why != null)
                        bindingProblems.Add(Problem(it, why));
                }
            }
            if (bindingProblems.Count > 0)
                return Blocked(Msg.StaleNotice, bindingProblems);

            return Write(doc, req, items, sheets, live);
        }

        // ══════════════════════════════════════════════════════════════
        //  Бичих (TransactionGroup)
        // ══════════════════════════════════════════════════════════════
        private static ApplyResult Write(Document doc, ApplyRequest req, List<ApplyItem> items,
            Dictionary<long, ViewSheet> sheets, DocumentStamp live)
        {
            List<ApplyItem> numberItems = items.Where(i => i.NumberChanges).ToList();
            List<ApplyItem> nameItems = items.Where(i => i.NameChanges).ToList();
            int writeCount = items.Sum(i => i.Writes != null ? i.Writes.Count : 0);

            SheetNumeratorLog.Info("apply", "эхэлж байна: " + numberItems.Count + " дугаар, " + nameItems.Count + " нэр, "
                + writeCount + " параметр · " + doc.Title);

            var tg = new TransactionGroup(doc, string.IsNullOrEmpty(req.Label) ? Msg.TransactionGroupName : req.Label);
            tg.Start();
            try
            {
                // ── Transaction A: түр дугаар ──────────────────────
                if (numberItems.Count > 0)
                {
                    string token = UniqueToken(live);
                    using (var ta = new Transaction(doc, Msg.TempTransactionName))
                    {
                        ta.Start();
                        Configure(ta);
                        for (int i = 0; i < numberItems.Count; i++)
                        {
                            ApplyItem it = numberItems[i];
                            string temp = RevitSheetRules.TempNumber(token, i);
                            try
                            {
                                sheets[it.SheetId].SheetNumber = temp;
                            }
                            catch (Exception ex)
                            {
                                throw new SheetOpException(Problem(it, "түр дугаар оноож чадсангүй"), ex);
                            }
                        }
                        Commit(ta);
                    }
                }

                if (string.Equals(FailAtStage, "after-temp", StringComparison.Ordinal))
                    throw new InvalidOperationException("TEST: зориуд алдаа (түр дугаар оноосны дараа)");

                // ── Transaction B: эцсийн дугаар, нэр, параметр ────
                using (var tb = new Transaction(doc, Msg.FinalTransactionName))
                {
                    tb.Start();
                    Configure(tb);

                    foreach (ApplyItem it in numberItems)
                    {
                        ViewSheet sh = sheets[it.SheetId];
                        try
                        {
                            sh.SheetNumber = it.NewNumber;
                        }
                        catch (Exception ex)
                        {
                            throw new SheetOpException(Problem(it, "Revit «" + it.NewNumber + "» дугаарыг хүлээн авсангүй (давхардсан эсвэл хориглосон тэмдэгттэй)"), ex);
                        }
                        if (!string.Equals(sh.SheetNumber, it.NewNumber, StringComparison.Ordinal))
                            throw new SheetOpException(Problem(it, "Revit дугаарыг өөрчилж хадгалсан: «" + sh.SheetNumber + "»"), null);
                    }

                    foreach (ApplyItem it in nameItems)
                    {
                        ViewSheet sh = sheets[it.SheetId];
                        try
                        {
                            sh.Name = it.NewName;
                        }
                        catch (Exception ex)
                        {
                            throw new SheetOpException(Problem(it, "Revit «" + it.NewName + "» нэрийг хүлээн авсангүй"), ex);
                        }
                        if (!string.Equals(sh.Name, it.NewName, StringComparison.Ordinal))
                            throw new SheetOpException(Problem(it, "Revit нэрийг өөрчилж хадгалсан: «" + sh.Name + "»"), null);
                    }

                    foreach (ApplyItem it in items)
                    {
                        if (it.Writes == null)
                            continue;
                        foreach (ParameterWrite w in it.Writes)
                        {
                            string reason;
                            bool ok;
                            try
                            {
                                ok = SheetParameterService.TryWrite(sheets[it.SheetId], w, out reason);
                            }
                            catch (Exception ex)
                            {
                                throw new SheetOpException(Problem(it, "«" + w.DisplayName + "» параметр бичиж чадсангүй"), ex);
                            }
                            if (!ok)
                                throw new SheetOpException(Problem(it, reason), null);
                        }
                    }

                    Commit(tb);
                }

                // ── Баталгаажуулалт ────────────────────────────────
                foreach (ApplyItem it in numberItems)
                {
                    ViewSheet sh = (ViewSheet)doc.GetElement(new ElementId(it.SheetId));
                    if (sh == null || !string.Equals(sh.SheetNumber, it.NewNumber, StringComparison.Ordinal))
                        throw new SheetOpException(Problem(it, "бичсэний дараах уншилт таарсангүй"), null);
                }

                tg.Assimilate();
            }
            catch (Exception ex)
            {
                return HandleFailure(doc, tg, items, ex);
            }

            SheetNumeratorLog.Info("apply", "амжилттай: " + numberItems.Count + " дугаар, " + nameItems.Count + " нэр, " + writeCount + " параметр");
            return new ApplyResult
            {
                Outcome = ApplyOutcome.Applied,
                Message = Msg.Applied(numberItems.Count, nameItems.Count, writeCount),
                NumbersChanged = numberItems.Count,
                NamesChanged = nameItems.Count,
                ParametersWritten = writeCount,
            };
        }

        private static ApplyResult HandleFailure(Document doc, TransactionGroup tg, List<ApplyItem> items, Exception ex)
        {
            var problem = (ex as SheetOpException) != null ? ((SheetOpException)ex).Problem : null;
            SheetNumeratorLog.Error("apply", "алдаа гарлаа — TransactionGroup-ийг буцааж байна"
                + (problem != null ? " · " + problem : string.Empty) + " · хөндөгдсөн: " + Describe(items), ex);

            bool rolledBack = false;
            try
            {
                if (tg.GetStatus() == TransactionStatus.Started)
                    tg.RollBack();
                rolledBack = tg.GetStatus() == TransactionStatus.RolledBack;
            }
            catch (Exception rex)
            {
                SheetNumeratorLog.Error("apply", "TransactionGroup.RollBack амжилтгүй", rex);
            }

            bool verified = rolledBack && VerifyOriginal(doc, items);
            var result = new ApplyResult
            {
                RollbackVerified = verified,
                Outcome = verified ? ApplyOutcome.RolledBack : ApplyOutcome.RollbackUnverified,
                Detail = (problem != null ? problem.ToString() + "\n" : string.Empty)
                    + ex.GetType().Name + ": " + ex.Message
                    + "\nLog: " + SheetNumeratorLog.LogPath,
            };
            if (problem != null)
                result.Problems.Add(problem);

            if (verified)
            {
                result.Message = problem != null ? Msg.ApplyRolledBack(problem.Message) : Msg.UnknownApplyError;
            }
            else
            {
                result.Message = Msg.RollbackUnverified;
            }
            return result;
        }

        /// <summary>Буцаалтын дараа хуудас бүрийн дугаар, нэр АНХНЫХ болсныг ҮНЭН уншиж баталгаажуулна.</summary>
        private static bool VerifyOriginal(Document doc, List<ApplyItem> items)
        {
            try
            {
                foreach (ApplyItem it in items)
                {
                    ViewSheet sh = doc.GetElement(new ElementId(it.SheetId)) as ViewSheet;
                    if (sh == null)
                        return false;
                    if (!string.Equals(sh.SheetNumber, it.ExpectedNumber, StringComparison.Ordinal))
                        return false;
                    if (!string.Equals(sh.Name, it.ExpectedName, StringComparison.Ordinal))
                        return false;
                }
                return true;
            }
            catch (Exception ex)
            {
                SheetNumeratorLog.Error("apply", "Буцаалтыг баталгаажуулахад алдаа", ex);
                return false;
            }
        }

        // ══════════════════════════════════════════════════════════════
        //  Урьдчилсан шалгалтууд
        // ══════════════════════════════════════════════════════════════

        private static string NumberProblem(string number)
        {
            if (RevitSheetRules.IsBlank(number))
                return Msg.EmptyNumber;
            IReadOnlyList<char> bad = RevitSheetRules.FindProhibited(number);
            if (bad.Count > 0)
                return Msg.ProhibitedInNumber(RevitSheetRules.DescribeChars(bad));
            return null;
        }

        /// <summary>
        /// Хөндөх хуудас бүрийн эзэмшлийг шалгана.  ⚠️ Checkout ХИЙХГҮЙ.  Өөр хэрэглэгч эзэмшсэн, эсвэл төвд
        /// шинэчлэгдсэн/устсан (бидний хуулбар хуучирсан) бол засварлах боломжгүй.
        /// </summary>
        private static List<ApplyProblem> CheckModifiable(Document doc, List<ApplyItem> items, Dictionary<long, ViewSheet> sheets)
        {
            var problems = new List<ApplyProblem>();
            foreach (ApplyItem it in items)
            {
                ViewSheet sh = sheets[it.SheetId];
                try
                {
                    string owner;
                    CheckoutStatus status = WorksharingUtils.GetCheckoutStatus(doc, sh.Id, out owner);
                    ModelUpdatesStatus updates = WorksharingUtils.GetModelUpdatesStatus(doc, sh.Id);
                    if (status == CheckoutStatus.OwnedByOtherUser)
                        problems.Add(Problem(it, Msg.SheetNotModifiable(it.ExpectedNumber, it.ExpectedName, owner)));
                    else if (updates == ModelUpdatesStatus.UpdatedInCentral || updates == ModelUpdatesStatus.DeletedInCentral)
                        problems.Add(Problem(it, Msg.SheetNotModifiable(it.ExpectedNumber, it.ExpectedName, null)));
                }
                catch (Exception ex)
                {
                    SheetNumeratorLog.Error("apply", "Эзэмшил шалгаж чадсангүй: " + it.ExpectedNumber, ex);
                    problems.Add(Problem(it, Msg.SheetNotModifiable(it.ExpectedNumber, it.ExpectedName, null)));
                }
            }
            return problems;
        }

        // ══════════════════════════════════════════════════════════════
        //  Туслахууд
        // ══════════════════════════════════════════════════════════════

        private static string UniqueToken(DocumentStamp live)
        {
            string token;
            bool clash;
            do
            {
                token = Guid.NewGuid().ToString("N").Substring(0, 8);
                string prefix = RevitSheetRules.TempPrefix + token;
                clash = live.Sheets.Any(s => s.Number.StartsWith(prefix, StringComparison.OrdinalIgnoreCase));
            }
            while (clash);
            return token;
        }

        private static void Configure(Transaction t)
        {
            FailureHandlingOptions fho = t.GetFailureHandlingOptions();
            fho.SetFailuresPreprocessor(new ApplyFailurePreprocessor());
            fho.SetClearAfterRollback(true);
            t.SetFailureHandlingOptions(fho);
        }

        private static void Commit(Transaction t)
        {
            TransactionStatus st = t.Commit();
            if (st != TransactionStatus.Committed)
                throw new InvalidOperationException("Transaction «" + t.GetName() + "» commit хийгдсэнгүй: " + st);
        }

        private static ApplyProblem Problem(ApplyItem it, string message)
        {
            return new ApplyProblem { SheetId = it.SheetId, Number = it.ExpectedNumber, Name = it.ExpectedName, Message = message };
        }

        private static string Describe(List<ApplyItem> items)
        {
            var sb = new StringBuilder();
            int n = 0;
            foreach (ApplyItem it in items)
            {
                if (n++ >= 12)
                {
                    sb.Append(" … +").Append(items.Count - 12);
                    break;
                }
                if (sb.Length > 0)
                    sb.Append(", ");
                sb.Append('#').Append(it.SheetId).Append(' ').Append(it.ExpectedNumber).Append("→").Append(it.NewNumber);
            }
            return sb.ToString();
        }

        private static ApplyResult Stale(string message, List<string> details)
        {
            return new ApplyResult
            {
                Outcome = ApplyOutcome.Stale,
                Message = message,
                Detail = details != null ? string.Join("\n", details.Take(15)) : null,
            };
        }

        private static ApplyResult Blocked(string message, List<ApplyProblem> problems)
        {
            var r = new ApplyResult { Outcome = ApplyOutcome.Blocked, Message = message };
            if (problems != null)
            {
                r.Problems.AddRange(problems);
                r.Detail = string.Join("\n", problems.Take(15).Select(p => p.ToString()));
            }
            return r;
        }

        /// <summary>Warning-ийг устгана; алдаа бол Transaction-ийг буцаана (ProceedWithCommit ХЭЗЭЭ Ч — Revit унадаг).</summary>
        private sealed class ApplyFailurePreprocessor : IFailuresPreprocessor
        {
            public FailureProcessingResult PreprocessFailures(FailuresAccessor accessor)
            {
                bool error = false;
                foreach (FailureMessageAccessor f in accessor.GetFailureMessages())
                {
                    if (f.GetSeverity() == FailureSeverity.Warning)
                        accessor.DeleteWarning(f);
                    else
                        error = true;
                }
                return error ? FailureProcessingResult.ProceedWithRollBack : FailureProcessingResult.Continue;
            }
        }
    }
}
