using System;
using System.Collections.Generic;
using System.Text;

namespace RevitMcpAddin.Reinforcement.Core
{
    /// <summary>Нэрний загварын асуудал (UI тайлбарыг <c>RfText</c> өгнө — Core-д текст байхгүй).</summary>
    public enum RfNameIssue
    {
        None = 0,
        /// <summary>Загвар хоосон.</summary>
        Empty,
        /// <summary>«{Partition}» байхгүй — бүх хүснэгт ижил нэртэй болно.</summary>
        NoPartitionToken,
        /// <summary>Revit-ийн нэрэнд хориотой тэмдэгт (\ : { } [ ] | ; &lt; &gt; ? ` ~) загварт байна.</summary>
        InvalidChars,
    }

    /// <summary>
    /// Үүсгэх хүснэгтийн нэр.  Загвар: «Beam {Partition} Reinforcement»; токен: {Partition}, {Template}
    /// (том/жижиг үсэг үл хамаарна).
    /// </summary>
    public static class RfScheduleNames
    {
        public const string PartitionToken = "{Partition}";
        public const string TemplateToken = "{Template}";

        /// <summary>Revit-ийн харагдац/хүснэгтийн нэрэнд хориотой тэмдэгтүүд.</summary>
        public const string InvalidChars = "\\:{}[]|;<>?`~";

        public static bool HasInvalidChar(string s)
        {
            if (string.IsNullOrEmpty(s)) return false;
            return s.IndexOfAny(InvalidChars.ToCharArray()) >= 0;
        }

        /// <summary>Хориотой тэмдэгтийг «_»-ээр сольж, захын хоосон зайг хасна.</summary>
        public static string Sanitize(string s)
        {
            if (string.IsNullOrEmpty(s)) return string.Empty;
            var sb = new StringBuilder(s.Length);
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                sb.Append(InvalidChars.IndexOf(c) >= 0 || char.IsControl(c) ? '_' : c);
            }
            return sb.ToString().Trim();
        }

        public static RfNameIssue Validate(string pattern)
        {
            if (string.IsNullOrWhiteSpace(pattern)) return RfNameIssue.Empty;
            if (IndexOfIgnoreCase(pattern, PartitionToken, 0) < 0) return RfNameIssue.NoPartitionToken;
            string rest = ReplaceIgnoreCase(ReplaceIgnoreCase(pattern, PartitionToken, ""), TemplateToken, "");
            return HasInvalidChar(rest) ? RfNameIssue.InvalidChars : RfNameIssue.None;
        }

        /// <summary>Загвараас нэр гаргана; утга/загварын нэрэн дэх хориотой тэмдэгтийг «_» болгоно.</summary>
        public static string Resolve(string pattern, string templateName, string partition)
        {
            string name = ReplaceIgnoreCase(pattern ?? string.Empty, TemplateToken, Sanitize(templateName));
            name = ReplaceIgnoreCase(name, PartitionToken, Sanitize(partition));
            return name.Trim();
        }

        /// <summary>
        /// «Жишээ» нэрийг үзүүлэхэд ашиглах Partition: ЭХЛЭЭД хэрэглэгчийн сонгосон (чагталсан) мөрийн эхнийх, байхгүй бол загварын БҮХ Partition-аас
        /// эх түүврийн өөрийнхөөс (аль хэдийн агуулдаг) ӨӨР эхнийх, байхгүй бол эхнийх.  Хоосон утгыг алгасна.  Ердөө нэг Partition ч байхгүй бол null.
        /// Жишээ нэр нь ЯГ <see cref="Resolve"/>-оор (бодит нэрийн томьёо) гарна — тусдаа «жишээ» томьёо БАЙХГҮЙ.
        /// </summary>
        public static string PickExamplePartition(IEnumerable<string> preferred, IEnumerable<string> all, string templateValue)
        {
            if (preferred != null)
            {
                foreach (string p in preferred)
                    if (!string.IsNullOrWhiteSpace(p)) return p;
            }
            string firstAny = null;
            if (all != null)
            {
                foreach (string p in all)
                {
                    if (string.IsNullOrWhiteSpace(p)) continue;
                    if (firstAny == null) firstAny = p;
                    if (!string.Equals(p, templateValue, StringComparison.Ordinal)) return p;
                }
            }
            return firstAny;
        }

        /// <summary>
        /// Загварын нэрнээс ӨГӨГДМӨЛ загвар таана: загвар хүснэгтийн нэр өөрийн Partition утгыг (бүтэн токен
        /// хэлбэрээр) агуулсан бол тэр хэсгийг {Partition}-оор солино («Beam DN-1 Reinforcement» →
        /// «Beam {Partition} Reinforcement»).  Үгүй бол «{Template} — {Partition}» (урт зураас).
        /// </summary>
        public static string SuggestPattern(string templateName, string templatePartition)
        {
            if (!string.IsNullOrWhiteSpace(templateName) && !string.IsNullOrWhiteSpace(templatePartition))
            {
                string val = templatePartition.Trim();
                int from = 0;
                while (true)
                {
                    int at = IndexOfIgnoreCase(templateName, val, from);
                    if (at < 0) break;
                    int end = at + val.Length;
                    bool leftOk = at == 0 || !IsWordChar(templateName[at - 1]);
                    bool rightOk = end >= templateName.Length || !IsWordChar(templateName[end]);
                    if (leftOk && rightOk)
                        return templateName.Substring(0, at) + PartitionToken + templateName.Substring(end);
                    from = at + 1;
                }
            }
            return TemplateToken + " — " + PartitionToken;
        }

        /// <summary>
        /// Partition утгыг ШҮҮЛТҮҮРТ ямар харьцуулалтаар тулгах: ЗӨВХӨН бүтэн тэнцүү (ordinal) — Revit-ийн
        /// <c>ScheduleFilterType.Equal</c>-тай ижил.  «DN-1» нь «DN-10»-той ХЭЗЭЭ Ч таарахгүй (Contains/StartsWith БИШ).
        /// </summary>
        public static bool SameValue(string a, string b)
        {
            return string.Equals(a, b, StringComparison.Ordinal);
        }

        private static bool IsWordChar(char c) { return char.IsLetterOrDigit(c); }

        internal static int IndexOfIgnoreCase(string s, string value, int start)
        {
            return s.IndexOf(value, start, StringComparison.OrdinalIgnoreCase);
        }

        internal static string ReplaceIgnoreCase(string s, string oldValue, string newValue)
        {
            if (string.IsNullOrEmpty(s) || string.IsNullOrEmpty(oldValue)) return s ?? string.Empty;
            var sb = new StringBuilder();
            int pos = 0;
            while (true)
            {
                int at = s.IndexOf(oldValue, pos, StringComparison.OrdinalIgnoreCase);
                if (at < 0) break;
                sb.Append(s, pos, at - pos).Append(newValue);
                pos = at + oldValue.Length;
            }
            sb.Append(s, pos, s.Length - pos);
            return sb.ToString();
        }
    }

    /// <summary>
    /// Загварын БҮХ Partition-аас гарах нэр хоорондоо мөргөлдөх бүлэг: ӨӨР (ordinal) Partition утгууд нэг нэрэнд (том/жижиг үсэг үл
    /// хамаарна) хөрвөх — «DN-2» ба «dn-2», «DN:1» ба «DN_1» (хориотой тэмдэгт «_» болно), «DN-1» ба «DN-1 » (захын зай тайрагдана).
    /// ⚠️ Ийм нэр БАЙГАА түүвэрт ХЭЗЭЭ Ч «шинэчлэх/солих/засах» хийхгүй: түүвэр аль Partition-ийных нь тодорхойгүй тул хоёр Partition
    /// түүврийг ээлжлэн дахин чиглүүлж (flip-flop) бие биенийхээ шүүлтүүрийг эвдэнэ.
    /// </summary>
    public static class RfNameCollisions
    {
        /// <returns>Хоёр ба түүнээс олон ӨӨР Partition-д ногдох нэрс (OrdinalIgnoreCase); загвар буруу бол хоосон.</returns>
        public static HashSet<string> Find(string pattern, string templateName, IEnumerable<string> partitions)
        {
            var result = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (partitions == null || RfScheduleNames.Validate(pattern) != RfNameIssue.None) return result;
            var seen = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var distinct = new HashSet<string>(StringComparer.Ordinal);
            foreach (string p in partitions)
            {
                if (p == null || !distinct.Add(p)) continue;
                string name = RfScheduleNames.Resolve(pattern, templateName, p);
                if (name.Length == 0) continue;
                if (seen.ContainsKey(name)) result.Add(name);
                else seen[name] = p;
            }
            return result;
        }
    }

    /// <summary>Revit-ийн түүврийн хязгаар.</summary>
    public static class RfScheduleLimits
    {
        /// <summary>Нэг түүвэрт тавьж болох шүүлтүүрийн дээд тоо (Revit: 8).</summary>
        public const int MaxFilters = 8;

        /// <summary>
        /// Partition шүүлтүүр тавьж болох уу: түүвэрт аль хэдийн Partition шүүлтүүр бий (СОЛИНО — тоо нэмэгдэхгүй) эсвэл
        /// нийт шүүлтүүр 8-аас бага (НЭМНЭ).
        /// </summary>
        public static bool CanApplyPartitionFilter(int filterCount, bool hasPartitionFilter)
        {
            return hasPartitionFilter || filterCount < MaxFilters;
        }
    }

    public enum RfFilterOp
    {
        /// <summary>Байгаа Partition шүүлтүүрийг ӨӨР ДЭЭРХ индексээр нь солино (бусад шүүлтүүр хөндөгдөхгүй).</summary>
        Set = 0,
        /// <summary>Partition шүүлтүүр байхгүй — төгсгөлд НЭМНЭ (бусад шүүлтүүр хөндөгдөхгүй).</summary>
        Add,
        /// <summary>Partition шүүлтүүр байхгүй бөгөөд шүүлтүүр аль хэдийн 8 — нэмэх боломжгүй.</summary>
        TooMany,
    }

    public struct RfFilterDecision
    {
        public RfFilterOp Op;

        /// <summary>Set үед солих шүүлтүүрийн индекс; бусад үед −1.</summary>
        public int Index;
    }

    /// <summary>
    /// Түүвэрт Partition шүүлтүүр тавих ЦЭВЭР шийдвэр.  Revit-д <c>SetFilter(index)</c> / <c>AddFilter</c>-ээр ЗӨВХӨН нэг шүүлтүүрийг
    /// хөндөнө — <c>SetFilters(list)</c> гэж бүх жагсаалтыг дахин бичихгүй, ингэснээр эх түүврийн бусад шүүлтүүр алдагдахгүй.
    /// </summary>
    public static class RfFilterPlan
    {
        /// <param name="filterFieldIds">Түүврийн одоогийн шүүлтүүр бүрийн талбарын id (шүүлтүүрийн дарааллаар).</param>
        /// <param name="partitionFieldId">Partition талбарын id.</param>
        public static RfFilterDecision Decide(IList<int> filterFieldIds, int partitionFieldId)
        {
            int count = filterFieldIds == null ? 0 : filterFieldIds.Count;
            for (int i = 0; i < count; i++)
            {
                // Нэг талбар дээр хэд хэдэн шүүлтүүр байвал ЭХНИЙХИЙГ л солино.
                if (filterFieldIds[i] == partitionFieldId)
                    return new RfFilterDecision { Op = RfFilterOp.Set, Index = i };
            }
            return RfScheduleLimits.CanApplyPartitionFilter(count, false)
                ? new RfFilterDecision { Op = RfFilterOp.Add, Index = -1 }
                : new RfFilterDecision { Op = RfFilterOp.TooMany, Index = -1 };
        }
    }

    /// <summary>Арматур дээрх Partition параметрийн сонголт (нэг scan-ы дүнгээс).</summary>
    public enum RfPartitionParam
    {
        None = 0,
        /// <summary><c>NUMBER_PARTITION_PARAM</c> — арматурын Partition (ЗӨВХӨН энэ; <c>ELEM_PARTITION_PARAM</c> нь Workset тул хэзээ ч биш).</summary>
        Number = 1,
    }

    public static class RfPartitionChoice
    {
        /// <summary>
        /// Загварын БҮХ арматурыг НЭГ удаа уншсан дүнгээс: <c>NUMBER_PARTITION_PARAM</c> хоосон биш утгатай бол ТЭР; үгүй бол None.
        /// Workset (<c>ELEM_PARTITION_PARAM</c>)-ийг нөөц болгон ХЭЗЭЭ Ч ашиглахгүй.
        /// </summary>
        public static RfPartitionParam Choose(int numberNonBlank)
        {
            return numberNonBlank > 0 ? RfPartitionParam.Number : RfPartitionParam.None;
        }
    }

    /// <summary>Байгаа хүснэгтийн тухай Revit-гүй зураг (planner-д).</summary>
    public sealed class RfExistingSchedule
    {
        public long Id;
        public string Name;

        /// <summary>Загвартай ижил ангилалтай (Rebar) — шүүлтүүрийг нь аюулгүй өөрчилж болно.</summary>
        public bool Compatible;

        /// <summary>Partition талбарын «тэнцүү» шүүлтүүрийн утга; байхгүй бол null.</summary>
        public string FilterValue;

        /// <summary>Хуудсан дээр байрлуулсан тоо (Replace устгавал алдагдана).</summary>
        public int SheetPlacements;

        /// <summary>Энэ add-in-ийн үүсгэсэн (Extensible Storage) бол тэмдэглэсэн Partition; үгүй бол null.</summary>
        public string GeneratedPartition;

        /// <summary>Тэмдэглэгээ нь ЯГ ЭНЭ эх түүврээс үүссэн гэж заасан (бусад эх түүврийн үр дүнг «нэр өөр» гэж таниулахгүйн тулд).</summary>
        public bool GeneratedFromThisTemplate;

        /// <summary>Хуудсан дээрх хэд хэдэн хэсэгт хуваагдсан (split) түүврийн хэсгийн тоо; энгийн нь 1.</summary>
        public int SegmentCount = 1;

        /// <summary>«Хуудсаар шүүх» (filter by sheet) түүвэр — хуудасны байрлалыг нь хуулж сэргээх боломжгүй.</summary>
        public bool FilteredBySheet;
    }

    public enum RfExistingPolicy
    {
        /// <summary>Байгааг ХӨНДӨХГҮЙ.</summary>
        Skip = 0,
        /// <summary>Байгаа хүснэгтийн ЗӨВХӨН Partition шүүлтүүрийг шинэчилнэ.</summary>
        UpdateFilter = 1,
        /// <summary>Байгааг устгаад шинээр үүсгэнэ — ЗӨВХӨН хэрэглэгч ил сонговол.</summary>
        Replace = 2,
    }

    public enum RfCloneAction
    {
        Create,
        /// <summary>Аль хэдийн зөв (нэр + шүүлтүүр) — юу ч хийхгүй.</summary>
        UpToDate,
        /// <summary>Хөндөхгүй (бодлого «Алгасах» эсвэл загвар өөрөө).</summary>
        Skip,
        UpdateFilter,
        Replace,
        /// <summary>Нэр мөргөлдсөн / буруу — үүсгэхгүй.</summary>
        Conflict,
    }

    public enum RfCloneReason
    {
        None = 0,
        /// <summary>Энэ нь загвар хүснэгт өөрөө.</summary>
        IsTemplate,
        SameTargetExists,
        WrongTargetExists,
        /// <summary>Нэр өөр (Rebar биш) хүснэгтэд эзлэгдсэн.</summary>
        NameTakenByOther,
        /// <summary>Өөр сонгосон Partition-тай ижил нэр гарч байна.</summary>
        DuplicateName,
        InvalidName,
        /// <summary>«Солих» зөвхөн ЭНЭ хэрэгслийн үүсгэсэн түүврийг устгана — энэ нь хэрэглэгчийн гараар хийсэн.</summary>
        ReplaceNotOwned,
        /// <summary>
        /// Гараар хийсэн, Partition шүүлтүүргүй (эсвэл «тэнцүү» биш шүүлтүүртэй) түүвэр — «Filter шинэчлэх» нь түүнд ШҮҮЛТҮҮР НЭМЭХГҮЙ
        /// (өөр зорилготой хүснэгтийг хөндөхгүй).  Нэрийг нь өөрчилнө үү.
        /// </summary>
        HandMadeNoPartitionFilter,
        /// <summary>«Солих» нь хуваагдсан (split) эсвэл «хуудсаар шүүх» түүврийн хуудасны байрлалыг сэргээж чадахгүй — солихгүй.</summary>
        ReplaceUnsupportedLayout,
    }

    public enum RfCloneWarn
    {
        EdgeWhitespace,
        CaseOrSpaceCollision,
        ReplaceLosesSheetPlacements,
    }

    public sealed class RfClonePlanItem
    {
        public string Partition;
        public int RebarCount;
        public string ProposedName;
        public RfCloneAction Action;
        public RfCloneReason Reason;
        public long ExistingId;
        public int SheetPlacements;
        public readonly List<RfCloneWarn> Warnings = new List<RfCloneWarn>();
    }

    /// <summary>
    /// «Түүвэр хувилах»-ын ТӨЛӨВЛӨГӨӨ — Revit-д юу ч бичихээс ӨМНӨ, цэвэр логикоор: Урьдчилан харах
    /// (+ Үүсгэх, ✓ Байгаа, ↻ Шинэчлэх, ! Нэрийн мөргөлдөөн) яг энэ үр дүнгээс.
    /// </summary>
    public static class RfClonePlanner
    {
        public static List<RfClonePlanItem> Plan(
            IList<RfPartitionValue> chosen,
            string pattern,
            string templateName,
            long templateId,
            IList<RfExistingSchedule> existing,
            RfExistingPolicy policy,
            IList<string> allPartitions = null)
        {
            // Нэрийн мөргөлдөөнийг БҮХ Partition (сонгоогүй ч) дээр шалгана — сонгоогүй Partition-ий түүвэр нэгэн нэрийг эзэлж болно.
            HashSet<string> collided = RfNameCollisions.Find(pattern, templateName, UnionValues(chosen, allPartitions));

            var byName = new Dictionary<string, RfExistingSchedule>(StringComparer.OrdinalIgnoreCase);
            if (existing != null)
            {
                for (int i = 0; i < existing.Count; i++)
                {
                    RfExistingSchedule e = existing[i];
                    if (!string.IsNullOrEmpty(e.Name) && !byName.ContainsKey(e.Name))
                        byName[e.Name] = e;
                }
            }

            var used = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var result = new List<RfClonePlanItem>();
            bool patternOk = RfScheduleNames.Validate(pattern) == RfNameIssue.None;

            foreach (RfPartitionValue p in chosen)
            {
                var item = new RfClonePlanItem
                {
                    Partition = p.Value,
                    RebarCount = p.RebarCount,
                    ProposedName = patternOk ? RfScheduleNames.Resolve(pattern, templateName, p.Value) : string.Empty,
                };
                if (p.HasEdgeWhitespace) item.Warnings.Add(RfCloneWarn.EdgeWhitespace);
                if (p.CaseOrSpaceCollision) item.Warnings.Add(RfCloneWarn.CaseOrSpaceCollision);
                result.Add(item);

                if (!patternOk || item.ProposedName.Length == 0)
                {
                    item.Action = RfCloneAction.Conflict;
                    item.Reason = RfCloneReason.InvalidName;
                    continue;
                }
                if (used.ContainsKey(item.ProposedName))
                {
                    item.Action = RfCloneAction.Conflict;
                    item.Reason = RfCloneReason.DuplicateName;
                    continue;
                }
                used[item.ProposedName] = p.Value;

                RfExistingSchedule ex;
                if (!byName.TryGetValue(item.ProposedName, out ex))
                {
                    item.Action = RfCloneAction.Create;
                    continue;
                }

                item.ExistingId = ex.Id;
                item.SheetPlacements = ex.SheetPlacements;
                if (ex.Id == templateId)
                {
                    item.Action = RfCloneAction.Skip;
                    item.Reason = RfCloneReason.IsTemplate;
                }
                else if (!ex.Compatible)
                {
                    item.Action = RfCloneAction.Conflict;
                    item.Reason = RfCloneReason.NameTakenByOther;
                }
                else if (collided.Contains(item.ProposedName))
                {
                    // Энэ нэр хоёр ӨӨР Partition-д ногдож байгаа ба ийм нэртэй түүвэр аль хэдийн бий — аль Partition-ийных нь тодорхойгүй.
                    item.Action = RfCloneAction.Conflict;
                    item.Reason = RfCloneReason.DuplicateName;
                }
                else if (ex.FilterValue != null
                    && RfScheduleNames.SameValue(ex.FilterValue, p.Value)
                    && (policy != RfExistingPolicy.Replace || ex.GeneratedPartition == null))
                {
                    // Нэр, шүүлтүүр зөв.  «Солих» нь зөвхөн ЭНЭ хэрэгслийн үүсгэсэн түүвэрт — хэрэглэгчийн зөв түүврийг хөндөхгүй.
                    item.Action = RfCloneAction.UpToDate;
                    item.Reason = RfCloneReason.SameTargetExists;
                }
                else
                {
                    item.Reason = RfCloneReason.WrongTargetExists;
                    switch (policy)
                    {
                        case RfExistingPolicy.UpdateFilter:
                            // Нэр яг таарсан ч ГАРААР хийсэн, Partition шүүлтүүргүй түүвэр бол өөр зорилготой байж болно — түүнд Partition
                            // шүүлтүүр НЭМЭХГҮЙ.  Шинэчлэх нь ЭНЭ хэрэгслийн үүсгэсэн, эсвэл аль хэдийн Partition-ий «тэнцүү» шүүлтүүртэй (ЗӨВХӨН утга нь буруу) түүвэрт.
                            if (ex.GeneratedPartition == null && ex.FilterValue == null)
                            {
                                item.Action = RfCloneAction.Conflict;
                                item.Reason = RfCloneReason.HandMadeNoPartitionFilter;
                            }
                            else
                            {
                                item.Action = RfCloneAction.UpdateFilter;
                            }
                            break;
                        case RfExistingPolicy.Replace:
                            if (ex.GeneratedPartition == null)
                            {
                                // Хэрэглэгчийн ГАРААР хийсэн түүврийг (өөрийн харагдацын параметр, тохиргоотой) «Солих»-оор
                                // УСТГАХГҮЙ.  «Filter шинэчлэх» эсвэл нэрийг гараар солихыг санал болгоно.
                                item.Action = RfCloneAction.Conflict;
                                item.Reason = RfCloneReason.ReplaceNotOwned;
                            }
                            else if (ex.SegmentCount > 1 || ex.FilteredBySheet)
                            {
                                // Хуваагдсан / «хуудсаар шүүх» түүврийн байрлалыг шинэ (хуваагдаагүй) түүвэрт сэргээж чадахгүй — устгахгүй.
                                item.Action = RfCloneAction.Conflict;
                                item.Reason = RfCloneReason.ReplaceUnsupportedLayout;
                            }
                            else
                            {
                                item.Action = RfCloneAction.Replace;
                                if (ex.SheetPlacements > 0) item.Warnings.Add(RfCloneWarn.ReplaceLosesSheetPlacements);
                            }
                            break;
                        default:
                            item.Action = RfCloneAction.Skip;
                            break;
                    }
                }
            }
            return result;
        }

        private static IEnumerable<string> UnionValues(IList<RfPartitionValue> chosen, IList<string> all)
        {
            var list = new List<string>();
            if (all != null) list.AddRange(all);
            if (chosen != null)
            {
                for (int i = 0; i < chosen.Count; i++) list.Add(chosen[i].Value);
            }
            return list;
        }
    }

    public enum RfSyncStatus
    {
        /// <summary>Загварт Partition бий, хүснэгт алга.</summary>
        Missing,
        /// <summary>Хүлээсэн нэртэй, шүүлтүүр нь зөв.</summary>
        UpToDate,
        /// <summary>Шүүлтүүр нь зөв боловч нэр нь өөр (хэрэглэгч нэрийг өөрчилсөн) — давхар үүсгэхгүй.</summary>
        UpToDateRenamed,
        /// <summary>Хүлээсэн нэртэй хүснэгт бий, гэхдээ шүүлтүүр нь ӨӨР Partition (эсвэл шүүлтүүргүй).</summary>
        WrongTarget,
        /// <summary>Хүлээсэн нэр өөр (Rebar биш) хүснэгтэд эзлэгдсэн.</summary>
        Conflict,
        /// <summary>Хүснэгтийн Partition загварт байхгүй болсон.  ХЭЗЭЭ Ч автоматаар устгахгүй.</summary>
        Orphan,
    }

    public sealed class RfSyncRow
    {
        public RfSyncStatus Status;
        public string Partition;
        public string ExpectedName;
        public long ScheduleId;
        public string ScheduleName;
    }

    /// <summary>«Түүвэр синк хийх» — загварын Partition-ууд ба үүсгэсэн хүснэгтүүдийг харьцуулна.</summary>
    public static class RfSyncPlanner
    {
        public static List<RfSyncRow> Plan(
            IList<string> modelPartitions,
            string pattern,
            string templateName,
            long templateId,
            IList<RfExistingSchedule> existing)
        {
            var rows = new List<RfSyncRow>();
            var present = new HashSet<string>(StringComparer.Ordinal);
            foreach (string p in modelPartitions) present.Add(p);

            var byName = new Dictionary<string, RfExistingSchedule>(StringComparer.OrdinalIgnoreCase);
            foreach (RfExistingSchedule e in existing)
            {
                if (!string.IsNullOrEmpty(e.Name) && !byName.ContainsKey(e.Name))
                    byName[e.Name] = e;
            }

            bool patternOk = RfScheduleNames.Validate(pattern) == RfNameIssue.None;
            var covered = new HashSet<long>();
            // Хоёр ӨӨР Partition нэг нэрэнд хөрвөх бол тэр нэртэй түүвэр аль нэгнийх нь гэж ХЭЗЭЭ Ч шийдэхгүй (flip-flop-ийг хаана).
            HashSet<string> collided = RfNameCollisions.Find(pattern, templateName, modelPartitions);

            foreach (string p in modelPartitions)
            {
                string expected = patternOk ? RfScheduleNames.Resolve(pattern, templateName, p) : string.Empty;
                var row = new RfSyncRow { Partition = p, ExpectedName = expected };
                rows.Add(row);

                RfExistingSchedule named;
                if (expected.Length > 0 && byName.TryGetValue(expected, out named))
                {
                    row.ScheduleId = named.Id;
                    row.ScheduleName = named.Name;
                    covered.Add(named.Id);
                    bool filterOk = named.FilterValue != null && RfScheduleNames.SameValue(named.FilterValue, p);
                    if (named.Id == templateId)
                        // Эх түүвэр (master) — хэзээ ч «засах» ажиллагаанд орохгүй: зөв бол ✓, үгүй бол Мөргөлдөөн
                        // (нэрийн загвар эх түүврийн нэртэй давхцаж байна).
                        row.Status = filterOk ? RfSyncStatus.UpToDate : RfSyncStatus.Conflict;
                    else if (!named.Compatible)
                        row.Status = RfSyncStatus.Conflict;
                    else if (collided.Contains(expected))
                        row.Status = RfSyncStatus.Conflict;
                    else if (filterOk)
                        row.Status = RfSyncStatus.UpToDate;
                    else if (named.GeneratedPartition == null && named.FilterValue == null)
                        // Гараар хийсэн, Partition шүүлтүүргүй — «шүүлтүүр засах»-д ОРУУЛАХГҮЙ (өөр зорилготой хүснэгтэд шүүлтүүр нэмэхгүй).
                        row.Status = RfSyncStatus.Conflict;
                    else
                        row.Status = RfSyncStatus.WrongTarget;
                    continue;
                }

                // «Нэр өөр» гэж таних нь ЗӨВХӨН ЭНЭ эх түүврээс энэ хэрэгслийн үүсгэсэн (тэмдэглэгээтэй) түүвэрт — өөр эх түүвэр (ж: Багана)
                // эсвэл хэрэглэгчийн гараар хийсэн ижил Partition шүүлтүүртэй түүвэр нь «Дам»-ын түүврийг орлохгүй.
                RfExistingSchedule byFilter = null;
                foreach (RfExistingSchedule e in existing)
                {
                    if (e.Compatible && e.Id != templateId && e.FilterValue != null
                        && e.GeneratedPartition != null && e.GeneratedFromThisTemplate
                        && RfScheduleNames.SameValue(e.FilterValue, p))
                    {
                        byFilter = e;
                        break;
                    }
                }
                if (byFilter != null)
                {
                    row.Status = RfSyncStatus.UpToDateRenamed;
                    row.ScheduleId = byFilter.Id;
                    row.ScheduleName = byFilter.Name;
                    covered.Add(byFilter.Id);
                }
                else
                {
                    row.Status = RfSyncStatus.Missing;
                }
            }

            // Орхигдсон хүснэгт: ЗӨВХӨН энэ add-in-ийн үүсгэсэн (тэмдэглэгээтэй), эсвэл нэр нь одоогийн загвартай
            // яг таарч буй хүснэгт.  Хэрэглэгчийн бусад хүснэгтийг хэзээ ч «орхигдсон» гэж нэрлэхгүй.
            foreach (RfExistingSchedule e in existing)
            {
                if (!e.Compatible || e.Id == templateId || covered.Contains(e.Id)) continue;
                string gone = null;
                if (e.GeneratedPartition != null && !present.Contains(e.GeneratedPartition))
                    gone = e.GeneratedPartition;
                else if (patternOk && e.FilterValue != null && !present.Contains(e.FilterValue)
                    && string.Equals(RfScheduleNames.Resolve(pattern, templateName, e.FilterValue), e.Name,
                        StringComparison.OrdinalIgnoreCase))
                    gone = e.FilterValue;
                if (gone == null) continue;
                rows.Add(new RfSyncRow
                {
                    Status = RfSyncStatus.Orphan,
                    Partition = gone,
                    ExpectedName = e.Name,
                    ScheduleId = e.Id,
                    ScheduleName = e.Name,
                });
            }
            return rows;
        }
    }
}
