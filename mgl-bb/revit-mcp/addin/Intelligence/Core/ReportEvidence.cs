using System;
using System.Collections.Generic;
using System.Globalization;
using RevitMcpAddin.Intelligence.Contracts;

namespace RevitMcpAddin.Intelligence.Core
{
    /// <summary>
    /// ЖУРНАЛ + ДААЛГАВАР + ОЛДВОР → ТАЙЛАНГИЙН НОТОЛГОО (§33–35, R-18).
    ///
    /// Баримт бүр `Source` + `EvidenceSeqs`-тэй.  Загвар ЭНД ХЭЗЭЭ Ч оролцохгүй.
    /// Нотолгоо дутуу бол `Gaps`-д ил бичнэ — «хийсэн зүйл алга» гэж ХУДЛАА
    /// дүгнэхгүй (§73: техник алдаа ≠ «асуудал олдсонгүй»).
    /// </summary>
    public static class ReportEvidenceBuilder
    {
        public static RevitReportEvidence Build(
            ReportPeriodKind period,
            DateTime periodStartUtc,
            DateTime periodEndUtc,
            IList<JournalEvent> events,
            RevitDocumentContext document,
            RevitProjectLink projectLink,
            RevitTaskContext tasks,
            IList<TaskCandidateSet> candidateSets,
            IList<RevitComplianceIssue> issues,
            int? taskId = null)
        {
            var ev = new RevitReportEvidence
            {
                Period = period,
                PeriodStart = periodStartUtc.ToString("o"),
                PeriodEnd = periodEndUtc.ToString("o"),
                DocKey = document != null ? document.DocKey : null,
                DocumentTitle = document != null ? document.Title : null,
                TaskId = taskId,
                GeneratedAt = periodEndUtc.ToString("o"),
            };
            string now = periodEndUtc.ToString("o");

            if (document != null)
            {
                ev.Facts.Add(new ReportFact { Kind = ReportFactKind.DOCUMENT, Value = document.Title, Source = ReportFactSource.SESSION, ObservedAt = now });
            }
            if (projectLink != null && projectLink.State == ProjectLinkState.CONFIRMED)
            {
                ev.ProjectId = projectLink.ProjectId;
                ev.ProjectName = projectLink.ProjectName;
                ev.Facts.Add(new ReportFact { Kind = ReportFactKind.PROJECT, Value = projectLink.ProjectName, Number = projectLink.ProjectId, Source = ReportFactSource.USER_CONFIRMED, ObservedAt = projectLink.ConfirmedAt ?? now });
            }
            else
            {
                ev.Gaps.Add("PROJECT_NOT_LINKED");
            }

            /* ── журналаас ─────────────────────────────────────────── */
            events = events ?? new List<JournalEvent>();
            var views = new Dictionary<string, List<long>>(StringComparer.Ordinal);
            var levels = new Dictionary<string, List<long>>(StringComparer.Ordinal);
            var cats = new Dictionary<string, int[]>(StringComparer.Ordinal);
            var catSeqs = new Dictionary<string, List<long>>(StringComparer.Ordinal);
            int added = 0, modified = 0, deleted = 0, changesets = 0;
            var changeSeqs = new List<long>();
            string sessionStart = null, sessionEnd = null;
            var issuesFound = new Dictionary<string, long>(StringComparer.Ordinal);
            var issuesResolved = new Dictionary<string, long>(StringComparer.Ordinal);
            var tasksTouched = new Dictionary<int, List<long>>();

            foreach (JournalEvent e in events)
            {
                switch (e.Kind)
                {
                    case JournalEventKind.SESSION_STARTED:
                        if (sessionStart == null) sessionStart = e.At;
                        break;
                    case JournalEventKind.SESSION_ENDED:
                        sessionEnd = e.At;
                        break;
                    case JournalEventKind.VIEW_CHANGED:
                        if (!string.IsNullOrEmpty(e.ViewName)) Bucket(views, e.ViewName).Add(e.Seq);
                        if (!string.IsNullOrEmpty(e.LevelName)) Bucket(levels, e.LevelName).Add(e.Seq);
                        break;
                    case JournalEventKind.CHANGESET:
                        changesets++;
                        changeSeqs.Add(e.Seq);
                        added += e.Added ?? 0; modified += e.Modified ?? 0; deleted += e.Deleted ?? 0;
                        if (e.CategoryCounts != null)
                        {
                            foreach (KeyValuePair<string, int[]> kv in e.CategoryCounts)
                            {
                                int[] acc;
                                if (!cats.TryGetValue(kv.Key, out acc)) { acc = new int[3]; cats[kv.Key] = acc; }
                                for (int i = 0; i < 3 && i < kv.Value.Length; i++) acc[i] += kv.Value[i];
                                Bucket(catSeqs, kv.Key).Add(e.Seq);
                            }
                        }
                        break;
                    case JournalEventKind.ISSUE_DETECTED:
                        if (e.IssueId != null) issuesFound[e.IssueId] = e.Seq;
                        break;
                    case JournalEventKind.ISSUE_RESOLVED:
                        if (e.IssueId != null) issuesResolved[e.IssueId] = e.Seq;
                        break;
                    case JournalEventKind.TASK_SELECTED:
                    case JournalEventKind.TASK_ELEMENT_REVIEWED:
                        if (e.TaskId != null)
                        {
                            List<long> l;
                            if (!tasksTouched.TryGetValue(e.TaskId.Value, out l)) { l = new List<long>(); tasksTouched[e.TaskId.Value] = l; }
                            l.Add(e.Seq);
                        }
                        break;
                }
            }

            if (sessionStart != null)
            {
                ev.Facts.Add(new ReportFact { Kind = ReportFactKind.SESSION_START, Value = sessionStart, Source = ReportFactSource.SESSION, ObservedAt = sessionStart });
                DateTime s, e2 = periodEndUtc;
                if (DateTime.TryParse(sessionStart, null, DateTimeStyles.RoundtripKind, out s))
                {
                    if (sessionEnd != null) DateTime.TryParse(sessionEnd, null, DateTimeStyles.RoundtripKind, out e2);
                    double min = Math.Max(0, Math.Round((e2.ToUniversalTime() - s.ToUniversalTime()).TotalMinutes));
                    ev.Facts.Add(new ReportFact { Kind = ReportFactKind.SESSION_DURATION_MIN, Number = min, Unit = "MIN", Source = ReportFactSource.SESSION, ObservedAt = now });
                }
            }
            else
            {
                ev.Gaps.Add("NO_SESSION_START");
            }

            foreach (KeyValuePair<string, List<long>> kv in views)
                ev.Facts.Add(new ReportFact { Kind = ReportFactKind.VIEW_TOUCHED, Value = kv.Key, Source = ReportFactSource.ACTIVITY_JOURNAL, ObservedAt = now, EvidenceSeqs = kv.Value });
            foreach (KeyValuePair<string, List<long>> kv in levels)
                ev.Facts.Add(new ReportFact { Kind = ReportFactKind.LEVEL_TOUCHED, Value = kv.Key, Source = ReportFactSource.ACTIVITY_JOURNAL, ObservedAt = now, EvidenceSeqs = kv.Value });

            if (changesets == 0)
            {
                ev.Gaps.Add("NO_CHANGESETS");
            }
            else
            {
                foreach (KeyValuePair<string, int[]> kv in cats)
                {
                    ev.Facts.Add(new ReportFact
                    {
                        Kind = ReportFactKind.CATEGORY_TOUCHED, Value = kv.Key, Subject = kv.Key,
                        Number = kv.Value[0] + kv.Value[1] + kv.Value[2],
                        Source = ReportFactSource.REVIT_CHANGESET, ObservedAt = now,
                        EvidenceSeqs = catSeqs[kv.Key], IsElementCount = true,
                    });
                }
                ev.Facts.Add(new ReportFact { Kind = ReportFactKind.ELEMENTS_ADDED, Number = added, Source = ReportFactSource.REVIT_CHANGESET, ObservedAt = now, EvidenceSeqs = changeSeqs, IsElementCount = true });
                ev.Facts.Add(new ReportFact { Kind = ReportFactKind.ELEMENTS_MODIFIED, Number = modified, Source = ReportFactSource.REVIT_CHANGESET, ObservedAt = now, EvidenceSeqs = changeSeqs, IsElementCount = true });
                ev.Facts.Add(new ReportFact { Kind = ReportFactKind.ELEMENTS_DELETED, Number = deleted, Source = ReportFactSource.REVIT_CHANGESET, ObservedAt = now, EvidenceSeqs = changeSeqs, IsElementCount = true });
            }

            /* ── ERP даалгавар ─────────────────────────────────────── */
            if (tasks == null || tasks.Status == TaskContextStatus.ERP_OFFLINE || tasks.Status == TaskContextStatus.AUTH_REQUIRED)
            {
                ev.Gaps.Add(tasks == null ? "ERP_OFFLINE" : tasks.Status.ToString());
            }
            else
            {
                foreach (RevitTaskItem t in tasks.Tasks)
                {
                    if (taskId != null && t.TaskId != taskId.Value) continue;
                    List<long> seqs;
                    bool touched = tasksTouched.TryGetValue(t.TaskId, out seqs);
                    if (taskId == null && !touched) continue;
                    var f = new ReportFact
                    {
                        Kind = ReportFactKind.TASK_REFERENCED, Value = t.Title, Number = t.TaskId, Subject = "task:" + t.TaskId,
                        Source = ReportFactSource.ERP_TASK, ObservedAt = tasks.FetchedAt ?? now,
                    };
                    if (touched) f.EvidenceSeqs = seqs;
                    ev.Facts.Add(f);
                    if (t.ChecklistTotal > 0)
                    {
                        ev.Facts.Add(new ReportFact
                        {
                            Kind = ReportFactKind.TASK_CHECKLIST, Subject = "task:" + t.TaskId,
                            Value = t.ChecklistDone + "/" + t.ChecklistTotal, Number = t.ChecklistDone,
                            Source = ReportFactSource.ERP_TASK, ObservedAt = tasks.FetchedAt ?? now,
                        });
                    }
                }
            }
            if (candidateSets != null)
            {
                foreach (TaskCandidateSet cs in candidateSets)
                {
                    if (taskId != null && cs.TaskId != taskId.Value) continue;
                    ev.Facts.Add(new ReportFact { Kind = ReportFactKind.TASK_ELEMENTS_CANDIDATE, Subject = "task:" + cs.TaskId, Number = cs.ElementIds.Count, Source = ReportFactSource.SCENE_GRAPH, ObservedAt = now, IsElementCount = true });
                    ev.Facts.Add(new ReportFact { Kind = ReportFactKind.TASK_ELEMENTS_REVIEWED, Subject = "task:" + cs.TaskId, Number = cs.ReviewedIds.Count, Source = ReportFactSource.USER_CONFIRMED, ObservedAt = now, IsElementCount = true });
                    // ⚠️ R-9: явцын хувь ЗОХИОХГҮЙ.
                    ev.Facts.Add(new ReportFact { Kind = ReportFactKind.PROGRESS_ESTIMATE, Subject = "task:" + cs.TaskId, Value = cs.Progress, Source = ReportFactSource.SCENE_GRAPH, ObservedAt = now });
                }
            }

            /* ── олдвор ─────────────────────────────────────────────── */
            int open = 0;
            if (issues != null)
            {
                foreach (RevitComplianceIssue i in issues)
                {
                    long seq;
                    bool inPeriod = issuesFound.TryGetValue(i.IssueId ?? "", out seq);
                    if (i.Status == IssueStatus.RESOLVED)
                    {
                        long rs;
                        if (issuesResolved.TryGetValue(i.IssueId ?? "", out rs))
                        {
                            ev.Facts.Add(new ReportFact { Kind = ReportFactKind.ISSUE_RESOLVED, Value = i.TitleMn, Subject = i.Class.ToString(), Source = ReportFactSource.COMPLIANCE_STATE, ObservedAt = i.ResolvedAt ?? now, EvidenceSeqs = new List<long> { rs } });
                        }
                        continue;
                    }
                    open++;
                    if (inPeriod)
                    {
                        ev.Facts.Add(new ReportFact { Kind = ReportFactKind.ISSUE_FOUND, Value = i.TitleMn, Subject = i.Class.ToString(), Source = ReportFactSource.COMPLIANCE_STATE, ObservedAt = i.DetectedAt ?? now, EvidenceSeqs = new List<long> { seq } });
                    }
                }
                ev.Facts.Add(new ReportFact { Kind = ReportFactKind.ISSUES_REMAINING, Number = open, Source = ReportFactSource.COMPLIANCE_STATE, ObservedAt = now });
            }
            return ev;
        }

        private static List<long> Bucket(Dictionary<string, List<long>> d, string key)
        {
            List<long> l;
            if (!d.TryGetValue(key, out l)) { l = new List<long>(); d[key] = l; }
            return l;
        }
    }

    /// <summary>
    /// НОТОЛГОО → ДЕТЕРМИНИСТ МОНГОЛ ТАЙЛАН (§35–36, R-8, R-19).
    ///
    /// Мөр бүр `LineFacts`-аар баримтдаа холбогдоно.  `MANAGER_REPORT` нь
    /// `IsElementCount` баримтыг ХЭЗЭЭ Ч мөр болгохгүй — эзний 2026-08-26-ны
    /// дүрэм («үйлдлийн тоо ≠ бүтээмж»).  Загвар байхгүй ч энэ ажиллана.
    /// </summary>
    public static class ReportRenderer
    {
        public static RevitReport Render(RevitReportEvidence ev, ReportAudience audience)
        {
            if (ev == null) throw new ArgumentNullException(nameof(ev));
            var r = new RevitReport { Audience = audience, Period = ev.Period, Evidence = ev };
            r.TitleMn = TitleFor(ev.Period);
            bool countsAllowed = audience == ReportAudience.TECHNICAL_SELF_REPORT;

            Line(r, ev, ReportFactKind.DOCUMENT, f => "Файл: " + f.Value);
            Line(r, ev, ReportFactKind.PROJECT, f => "Төсөл: " + f.Value);
            Line(r, ev, ReportFactKind.SESSION_DURATION_MIN, f => "Сессийн үргэлжлэл: " + Num(f.Number) + " мин");

            var levels = Collect(ev, ReportFactKind.LEVEL_TOUCHED);
            if (levels.Count > 0) Multi(r, ev, levels, "Ажилласан давхар: " + JoinValues(ev, levels));
            var views = Collect(ev, ReportFactKind.VIEW_TOUCHED);
            if (views.Count > 0) Multi(r, ev, views, "Ажилласан харагдац: " + JoinValues(ev, views));

            var cats = Collect(ev, ReportFactKind.CATEGORY_TOUCHED);
            if (cats.Count > 0)
            {
                if (countsAllowed)
                {
                    var parts = new List<string>();
                    foreach (int i in cats) parts.Add(ev.Facts[i].Value + " (" + Num(ev.Facts[i].Number) + ")");
                    Multi(r, ev, cats, "Хөндсөн категори: " + string.Join(", ", parts));
                    Line(r, ev, ReportFactKind.ELEMENTS_ADDED, f => "Нэмсэн элемент: " + Num(f.Number));
                    Line(r, ev, ReportFactKind.ELEMENTS_MODIFIED, f => "Зассан элемент: " + Num(f.Number));
                    Line(r, ev, ReportFactKind.ELEMENTS_DELETED, f => "Устгасан элемент: " + Num(f.Number));
                }
                else
                {
                    // Юуг, хаана — ХЭД биш.
                    var names = new List<string>();
                    foreach (int i in cats) names.Add(ev.Facts[i].Value);
                    Multi(r, ev, cats, "Ажилласан хэсэг: " + string.Join(", ", names));
                }
            }

            foreach (int i in Collect(ev, ReportFactKind.TASK_REFERENCED))
            {
                ReportFact f = ev.Facts[i];
                var idx = new List<int> { i };
                string line = "Даалгавар: " + f.Value;
                int ck = FindSubject(ev, ReportFactKind.TASK_CHECKLIST, f.Subject);
                if (ck >= 0) { line += " · дэд жагсаалт " + ev.Facts[ck].Value; idx.Add(ck); }
                int cand = FindSubject(ev, ReportFactKind.TASK_ELEMENTS_CANDIDATE, f.Subject);
                int rev = FindSubject(ev, ReportFactKind.TASK_ELEMENTS_REVIEWED, f.Subject);
                if (cand >= 0 && rev >= 0 && audience != ReportAudience.MANAGER_REPORT)
                {
                    line += " · " + Num(ev.Facts[cand].Number) + " боломжит элементээс " + Num(ev.Facts[rev].Number) + "-г шалгасан";
                    idx.Add(cand); idx.Add(rev);
                }
                int pe = FindSubject(ev, ReportFactKind.PROGRESS_ESTIMATE, f.Subject);
                if (pe >= 0) { line += " · явц: тооцоолоогүй (дүрэм байхгүй)"; idx.Add(pe); }
                Add(r, line, idx);
            }

            foreach (int i in Collect(ev, ReportFactKind.ISSUE_FOUND))
                Add(r, "Илэрсэн: " + ev.Facts[i].Value + " [" + ClassMn(ev.Facts[i].Subject) + "]", new List<int> { i });
            foreach (int i in Collect(ev, ReportFactKind.ISSUE_RESOLVED))
                Add(r, "Шийдсэн: " + ev.Facts[i].Value + " [" + ClassMn(ev.Facts[i].Subject) + "]", new List<int> { i });
            Line(r, ev, ReportFactKind.ISSUES_REMAINING, f => "Нээлттэй асуудал: " + Num(f.Number));

            foreach (string g in ev.Gaps)
            {
                Add(r, "⚠ " + GapMn(g), new List<int>());
            }
            if (r.LinesMn.Count == 0) Add(r, "Нотолгоо алга — тайлан гаргах өгөгдөл бүртгэгдээгүй.", new List<int>());
            return r;
        }

        /// <summary>Загварт өгөх ЗААВАР — баримтын жагсаалт + хориотой зүйл.  Загвар шинэ баримт нэмэхгүй.</summary>
        public static string WordingInstructionMn(RevitReport r)
        {
            var sb = new System.Text.StringBuilder();
            sb.Append("Доорх мөрүүдийг монголоор, албан хэллэгээр, УТГА ӨӨРЧЛӨХГҮЙГЭЭР нэг цогц тайлан болго. ");
            sb.Append("Шинэ тоо, шинэ баримт, шинэ дүгнэлт НЭМЭХГҮЙ; байхгүй мөрийг зохиохгүй.\n");
            foreach (string l in r.LinesMn) sb.Append("- ").Append(l).Append('\n');
            return sb.ToString();
        }

        private static string TitleFor(ReportPeriodKind p)
        {
            switch (p)
            {
                case ReportPeriodKind.TODAY: return "Өнөөдрийн ажлын тайлан";
                case ReportPeriodKind.THIS_SESSION: return "Энэ сессийн тайлан";
                case ReportPeriodKind.TASK: return "Даалгаврын тайлан";
                default: return "Асуудлын тайлан";
            }
        }

        private static string ClassMn(string cls)
        {
            switch (cls)
            {
                case "VERIFIED_NORM": return "баталгаажсан норм";
                case "MODEL_QUALITY": return "загварын чанар";
                default: return "хүний хяналт шаардлагатай";
            }
        }

        private static string GapMn(string g)
        {
            switch (g)
            {
                case "PROJECT_NOT_LINKED": return "ERP төсөл баталгаажаагүй — даалгаврын мэдээлэл ороогүй.";
                case "ERP_OFFLINE": return "ERP хүрэхгүй — даалгаврын мэдээлэл ороогүй.";
                case "AUTH_REQUIRED": return "ERP нэвтрэлт шаардлагатай — даалгаврын мэдээлэл ороогүй.";
                case "NO_CHANGESETS": return "Энэ хугацаанд загварын өөрчлөлт бүртгэгдээгүй.";
                case "NO_SESSION_START": return "Сессийн эхлэл бүртгэгдээгүй.";
                default: return g;
            }
        }

        private static string Num(double? n) => n == null ? "—" : n.Value.ToString("0.##", CultureInfo.InvariantCulture);

        private static void Line(RevitReport r, RevitReportEvidence ev, ReportFactKind kind, Func<ReportFact, string> fmt)
        {
            for (int i = 0; i < ev.Facts.Count; i++)
            {
                if (ev.Facts[i].Kind == kind) { Add(r, fmt(ev.Facts[i]), new List<int> { i }); return; }
            }
        }

        private static List<int> Collect(RevitReportEvidence ev, ReportFactKind kind)
        {
            var l = new List<int>();
            for (int i = 0; i < ev.Facts.Count; i++) if (ev.Facts[i].Kind == kind) l.Add(i);
            return l;
        }

        private static int FindSubject(RevitReportEvidence ev, ReportFactKind kind, string subject)
        {
            for (int i = 0; i < ev.Facts.Count; i++)
                if (ev.Facts[i].Kind == kind && string.Equals(ev.Facts[i].Subject, subject, StringComparison.Ordinal)) return i;
            return -1;
        }

        private static string JoinValues(RevitReportEvidence ev, List<int> idx)
        {
            return string.Join(", ", idx.ConvertAll(i => ev.Facts[i].Value));
        }

        private static void Multi(RevitReport r, RevitReportEvidence ev, List<int> idx, string text)
        {
            Add(r, text, idx);
        }

        private static void Add(RevitReport r, string line, List<int> facts)
        {
            r.LinesMn.Add(line);
            r.LineFacts.Add(facts);
        }
    }
}
