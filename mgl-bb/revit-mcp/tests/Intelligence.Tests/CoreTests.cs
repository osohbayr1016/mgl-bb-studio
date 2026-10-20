using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.Intelligence.Contracts;
using RevitMcpAddin.Intelligence.Core;

namespace RevitMcpAddin.Intelligence.Tests
{
    /* ================================================================== */
    /*  НЭГЖ (§14, R-3)                                                    */
    /* ================================================================== */
    public static class UnitsTests
    {
        [Test] public static void FeetToMm_IsExact()
        {
            Assert.Near(304.8, UnitsBoundary.FeetToMm(1), 1e-12);
            Assert.Near(1200, UnitsBoundary.FeetToMm(1200 / 304.8), 1e-9);
            Assert.Near(1, UnitsBoundary.MmToFeet(304.8), 1e-12);
        }

        [Test] public static void AreaVolumeAngle()
        {
            Assert.Near(0.09290304, UnitsBoundary.SqFeetToM2(1), 1e-12);
            Assert.Near(0.028316846592, UnitsBoundary.CuFeetToM3(1), 1e-15);
            Assert.Near(90, UnitsBoundary.RadToDeg(Math.PI / 2), 1e-9);
        }

        [Test] public static void LengthMm_KeepsProvenance()
        {
            Measure m = UnitsBoundary.LengthMm("width_mm", 3.0, QuantitySource.TypedParam, "spec");
            Assert.Eq("MM", m.Unit);
            Assert.Eq(MeasureSource.TYPED_PARAM, m.Source);
            Assert.Eq("spec", m.SpecId);
            Assert.Near(914.4, m.Value, 1e-9);
            Assert.False(m.Missing);
        }

        /// <summary>§14: аюултай хоёрдмол нэгж тестийг УНАГААХ ёстой — untyped параметрийг хөрвүүлэхгүй.</summary>
        [Test] public static void UntypedParam_NeverConverted()
        {
            Assert.Throws<ArgumentException>(() => UnitsBoundary.LengthMm("x", 1200, QuantitySource.UntypedParam, null));
            Assert.Throws<ArgumentException>(() => UnitsBoundary.LengthMm("x", 1200, QuantitySource.TypedParam, null), "spec-гүй typed нь ч хөрвөхгүй");
            Measure raw = UnitsBoundary.Raw("x", 1200, null);
            Assert.Eq("NONE", raw.Unit);
            Assert.Eq(MeasureSource.UNTYPED_PARAM, raw.Source);
            Assert.True(UnitsBoundary.Format(raw).EndsWith("⚠"), "нэгжгүй утга ил тэмдэглэгдэнэ");
        }

        [Test] public static void RequireSameUnit_FailsLoud()
        {
            Measure m = UnitsBoundary.LengthMm("w", 3, QuantitySource.BuiltinGeometry, null);
            UnitsBoundary.RequireSameUnit(m, "MM");
            Assert.Throws<UnitMismatchException>(() => UnitsBoundary.RequireSameUnit(m, "M"));
        }

        [Test] public static void Absent_IsMissing()
        {
            Measure m = UnitsBoundary.Absent("h");
            Assert.True(m.Missing);
            Assert.Eq("—", UnitsBoundary.Format(m));
        }
    }

    /* ================================================================== */
    /*  SCENE GRAPH (§20–23, R-4, R-5)                                     */
    /* ================================================================== */
    public static class SceneGraphTests
    {
        [Test] public static void Build_HasExpectedShape()
        {
            SceneGraphStore g = SyntheticModel.Build();
            Assert.Eq(8, g.NodeCount);
            Assert.True(g.EdgeCount >= 14, "edges " + g.EdgeCount);
            Assert.Eq(2, g.Neighbors(SyntheticModel.Wall2, EdgeRelation.BOUNDS_ROOM).Count);
        }

        [Test] public static void EdgeProvenance_ApproximateIsNotAuthoritative()
        {
            SceneGraphStore g = SyntheticModel.Build();
            List<long> all = g.Neighbors(SyntheticModel.Wall2, EdgeRelation.BOUNDS_ROOM);
            List<long> auth = g.Neighbors(SyntheticModel.Wall2, EdgeRelation.BOUNDS_ROOM, authoritativeOnly: true);
            Assert.Eq(2, all.Count);
            Assert.Eq(1, auth.Count);
            Assert.Eq(SyntheticModel.RoomA, auth[0]);
        }

        [Test] public static void ApproximateEdge_NeverOverridesAuthoritative()
        {
            SceneGraphStore g = SyntheticModel.Build();
            bool added = g.AddEdge(new SceneEdge { From = SyntheticModel.Wall1, To = SyntheticModel.RoomA, Relation = EdgeRelation.BOUNDS_ROOM, Source = EdgeSource.BOUNDING_BOX_APPROXIMATION, Confidence = EdgeConfidence.APPROXIMATE });
            Assert.False(added);
            SceneEdge e = g.EdgesOf(SyntheticModel.Wall1, EdgeRelation.BOUNDS_ROOM)[0];
            Assert.Eq(EdgeConfidence.AUTHORITATIVE, e.Confidence);
            // Эсрэгээр: эрх бүхий нь ойролцоололыг ДАРНА.
            bool up = g.AddEdge(new SceneEdge { From = SyntheticModel.Wall2, To = SyntheticModel.RoomB, Relation = EdgeRelation.BOUNDS_ROOM, Source = EdgeSource.ROOM_BOUNDARY, Confidence = EdgeConfidence.AUTHORITATIVE });
            Assert.True(up);
            Assert.Eq(2, g.Neighbors(SyntheticModel.Wall2, EdgeRelation.BOUNDS_ROOM, true).Count);
        }

        [Test] public static void Upsert_IndexDoesNotDowngradeGeometry()
        {
            SceneGraphStore g = SyntheticModel.Build();
            g.Upsert(new SceneNode { ElementId = SyntheticModel.Wall1, Kind = SceneNodeKind.WALL, Category = "Walls", Detail = SceneDetailLevel.INDEX, TypeName = "Renamed" });
            SceneNode n = g.Get(SyntheticModel.Wall1);
            Assert.Eq(SceneDetailLevel.GEOMETRY, n.Detail);
            Assert.Eq("Renamed", n.TypeName);
            Assert.NotNull(n.Measures);
        }

        [Test] public static void Query_TypedFilter()
        {
            SceneGraphStore g = SyntheticModel.Build();
            var q = new ElementQuery();
            q.Kinds.Add(SceneNodeKind.DOOR);
            q.LevelNames.Add("Level 1");
            Assert.Eq(2, g.Query(q).Count);
            var q2 = new ElementQuery();
            q2.RoomIds.Add(SyntheticModel.RoomA);
            List<long> ids = g.Query(q2).Select(n => n.ElementId).ToList();
            Assert.Contains(ids, SyntheticModel.Wall1);
            Assert.Contains(ids, SyntheticModel.Door1);
            Assert.Contains(ids, SyntheticModel.Floor1);
            var q3 = new ElementQuery { NameContains = "concrete" };
            Assert.Eq(1, g.Query(q3).Count);
        }

        [Test] public static void Snapshot_IsDeterministicAndSerializable()
        {
            SceneGraphStore g = SyntheticModel.Build();
            string a = IntelligenceJson.Serialize(g.Snapshot());
            string b = IntelligenceJson.Serialize(g.Snapshot());
            Assert.Eq(a, b);
            Assert.True(a.Contains("\"relation\":\"BOUNDS_ROOM\""), "enum нэрээр");
            Assert.True(a.Contains("\"source\":\"BOUNDING_BOX_APPROXIMATION\""));
            SceneGraphSnapshot back = IntelligenceJson.Deserialize<SceneGraphSnapshot>(a);
            Assert.Eq(8, back.Nodes.Count);
        }
    }

    /* ================================================================== */
    /*  ӨӨРЧЛӨЛТ → ГРАФ (§23–25, §53, R-14)                                */
    /* ================================================================== */
    public static class ChangeAdapterTests
    {
        private static LogicalChangeSet Logical(params long[] ids)
        {
            return new LogicalChangeSet { DocKey = SyntheticModel.DocKey, ElementIds = ids, CloseReason = "settle", MayCollect = true, TxnCount = 1, FirstSeq = 1, LastSeq = 3 };
        }

        [Test] public static void Classifies_DeletedWins()
        {
            RevitChangeSet cs = ChangeSetAdapter.FromLogical(
                Logical(1, 2, 3, 4, 4),
                trackerAdded: new HashSet<long> { 1, 3 },
                trackerModified: new HashSet<long> { 2, 3 },
                trackerDeleted: new HashSet<long> { 3 },
                transactionNames: new[] { "Move", "Move", "" });
            Assert.Eq(1, cs.Added.Count); Assert.Eq(1L, cs.Added[0]);
            Assert.Eq(1, cs.Modified.Count); Assert.Eq(2L, cs.Modified[0]);
            Assert.Eq(1, cs.Deleted.Count); Assert.Eq(3L, cs.Deleted[0]);
            Assert.Eq(1, cs.Unclassified.Count); Assert.Eq(4L, cs.Unclassified[0]);
            Assert.Eq(1, cs.TransactionNames.Count);
            Assert.Eq(4, cs.Total);
        }

        [Test] public static void Merge_CoalescesWithoutLosingFinalState()
        {
            var a = ChangeSetAdapter.FromLogical(Logical(10, 11), new HashSet<long> { 10 }, new HashSet<long> { 11 }, new HashSet<long>(), null);
            var b = ChangeSetAdapter.FromLogical(Logical(10, 12), new HashSet<long>(), new HashSet<long>(), new HashSet<long> { 10 }, null);
            RevitChangeSet m = ChangeSetAdapter.Merge(new[] { a, b });
            Assert.Eq(1, m.Deleted.Count);
            Assert.Eq(0, m.Added.Count, "нэмээд устгасан → зөвхөн устгасан");
            Assert.Eq(1, m.Unclassified.Count);
            Assert.Eq("merged", m.CloseReason);
        }

        [Test] public static void ApplyChangeSet_DeletionIsSafe()
        {
            SceneGraphStore g = SyntheticModel.Build();
            var cs = new RevitChangeSet { DocKey = SyntheticModel.DocKey };
            cs.Deleted.Add(SyntheticModel.Wall2);
            cs.Deleted.Add(999999); // загварт огт байгаагүй id — унахгүй
            cs.Modified.Add(SyntheticModel.Door1);
            cs.Modified.Add(SyntheticModel.Wall2); // устгагдсан нь бохирдсонд ОРОХГҮЙ
            List<long> dirty = g.ApplyChangeSet(cs);
            Assert.Eq(1, dirty.Count);
            Assert.Eq(SyntheticModel.Door1, dirty[0]);
            SceneNode w = g.Get(SyntheticModel.Wall2);
            Assert.True(w.Deleted);
            Assert.Eq(0, g.EdgesOf(SyntheticModel.Wall2).Count, "устгагдсан зангилааны ирмэг арилна");
            Assert.Eq(0, g.EdgesOf(SyntheticModel.Door1, EdgeRelation.HOSTED_BY).Count);
            Assert.True(g.IsDirty(SyntheticModel.Door1));
            Assert.False(g.Query(new ElementQuery()).Any(n => n.ElementId == SyntheticModel.Wall2), "устгагдсан нь хайлтад гарахгүй");
        }

        [Test] public static void Coalescer_ExistingTimingsPreserved()
        {
            // R-14: 1200 / 15000 / 2000 — одоо байгаа тохиргоо; энд зөвхөн Track 2-ийн анги ажиллаж буйг батална.
            var c = new ChangeSetCoalescer(1200, 15000, 2000);
            c.Feed(1, 0, "d", new long[] { 5, 6 }, 2, false);
            Assert.Null(c.TryClose(500, false), "намжаагүй байхад хаагдахгүй");
            LogicalChangeSet s = c.TryClose(1300, false);
            Assert.NotNull(s);
            Assert.Eq("settle", s.CloseReason);
            Assert.Eq(2, s.ElementIds.Length);
        }

        [Test] public static void Debouncer_CollapsesBurst()
        {
            int fired = 0;
            using (var d = new Debouncer(40, () => System.Threading.Interlocked.Increment(ref fired)))
            {
                for (int i = 0; i < 50; i++) d.Trigger();
                System.Threading.Thread.Sleep(200);
            }
            Assert.Eq(1, fired);
        }
    }

    /* ================================================================== */
    /*  ДААЛГАВАР (§30–32, R-9)                                            */
    /* ================================================================== */
    public static class TaskInterpretationTests
    {
        [Test] public static void Mongolian_FireExitDoorsLevel3()
        {
            RevitTaskInterpretation r = TaskInterpreter.Interpret(7, "3-р давхрын галын гарцын хаалгуудыг шалгах");
            Assert.Eq("TASK_INTERPRETATION", r.Label);
            Assert.Contains(r.TargetLevels, "3");
            Assert.Contains(r.TargetKinds, SceneNodeKind.DOOR);
            Assert.False(r.TargetKinds.Contains(SceneNodeKind.FLOOR), "«шалгах» нь «шал» биш");
            Assert.Eq("check", r.Intent);
            Assert.True(r.UnresolvedTerms.Count >= 1, "«галын гарц» тайлагдаагүй үлдэнэ");
            Assert.Eq(InterpretationConfidence.MEDIUM, r.Confidence);
        }

        [Test] public static void Latin_AndEnglish()
        {
            RevitTaskInterpretation a = TaskInterpreter.Interpret(1, "2 davhriin hanuudiig zurah");
            Assert.Contains(a.TargetLevels, "2");
            Assert.Contains(a.TargetKinds, SceneNodeKind.WALL);
            Assert.Eq("draw", a.Intent);
            RevitTaskInterpretation b = TaskInterpreter.Interpret(2, "Check windows on Level 1");
            Assert.Contains(b.TargetLevels, "1");
            Assert.Contains(b.TargetKinds, SceneNodeKind.WINDOW);
            Assert.Eq("check", b.Intent);
        }

        [Test] public static void RoomWord_DoesNotMatchEntrance()
        {
            RevitTaskInterpretation a = TaskInterpreter.Interpret(1, "Орох хэсгийн оролтын хаалга");
            Assert.False(a.TargetKinds.Contains(SceneNodeKind.ROOM), "«орох/оролт» нь өрөө биш");
            RevitTaskInterpretation b = TaskInterpreter.Interpret(2, "Өрөөнүүдийн талбайг шалгах");
            Assert.Contains(b.TargetKinds, SceneNodeKind.ROOM);
        }

        [Test] public static void NoKind_NoQuery()
        {
            RevitTaskInterpretation r = TaskInterpreter.Interpret(3, "Тайлан бичих");
            Assert.Eq(InterpretationConfidence.NONE, r.Confidence);
            Assert.Null(r.Query);
        }

        [Test] public static void LevelMatcher_Standalone()
        {
            Assert.True(LevelMatcher.Matches("Level 3", "3"));
            Assert.True(LevelMatcher.Matches("3-р давхар", "3"));
            Assert.True(LevelMatcher.Matches("03", "3"));
            Assert.False(LevelMatcher.Matches("Level 13", "3"));
            Assert.True(LevelMatcher.Matches("Level 1", "level 1"));
        }

        [Test] public static void Resolve_CandidatesNoProgress()
        {
            SceneGraphStore g = SyntheticModel.Build();
            RevitTaskInterpretation r = TaskInterpreter.Interpret(9, "1-р давхрын хаалгануудыг шалгах");
            TaskCandidateSet cs = TaskCandidateResolver.Resolve(r, g, new HashSet<long> { SyntheticModel.Door1 });
            Assert.Eq(2, cs.ElementIds.Count);
            Assert.Eq(1, cs.ReviewedIds.Count);
            Assert.Eq("PROGRESS_ESTIMATE_UNAVAILABLE", cs.Progress);
            Assert.Eq(2, cs.ByKind["DOOR"]);
        }

        [Test] public static void Resolve_UnknownLevel_NoWidening()
        {
            SceneGraphStore g = SyntheticModel.Build();
            RevitTaskInterpretation r = TaskInterpreter.Interpret(9, "7-р давхрын хаалгануудыг шалгах");
            TaskCandidateSet cs = TaskCandidateResolver.Resolve(r, g);
            Assert.Eq(0, cs.ElementIds.Count, "давхар олдохгүй бол бүх давхар руу ӨРГӨТГӨХГҮЙ");
        }
    }

    /* ================================================================== */
    /*  ТӨСЛИЙН ХОЛБООС (§27–28, R-10)                                      */
    /* ================================================================== */
    public static class ProjectLinkTests
    {
        private static readonly List<ErpProjectRef> Erp = new List<ErpProjectRef>
        {
            new ErpProjectRef { Id = 41, Name = "MGL-251006 EVERGREEN-AZ" },
            new ErpProjectRef { Id = 37, Name = "MGL-251006 EVERGREEN-ZA" },
            new ErpProjectRef { Id = 30, Name = "MGL-250101 Хүй 7 сургууль" },
        };

        [Test] public static void FuzzyMatch_IsOnlySuggestion()
        {
            RevitProjectLink l = ProjectLinkPolicy.Resolve("doc1", "MGL-251006_EVERGREEN_AR.rvt", null, null, null, null, null, null, Erp, true);
            Assert.Eq(ProjectLinkState.SUGGESTED, l.State);
            Assert.Null(l.ProjectId, "санал нь project_id болохгүй");
            Assert.True(l.Suggestions.Count >= 2);
            Assert.Eq(0.95, l.Suggestions[0].Score);
            Assert.True(l.Suggestions[0].Reason.StartsWith("code:"));
        }

        [Test] public static void Settings_IsStrongSuggestionNotConfirmed()
        {
            RevitProjectLink l = ProjectLinkPolicy.Resolve("doc1", "random.rvt", null, null, null, null, 30, "Хүй 7", Erp, true);
            Assert.Eq(ProjectLinkState.SUGGESTED, l.State);
            Assert.Eq(30, l.Suggestions[0].ProjectId);
            Assert.Eq("settings", l.Suggestions[0].Reason);
        }

        [Test] public static void Stored_IsConfirmed()
        {
            StoredProjectLink s = ProjectLinkPolicy.Confirm("doc1", 41, "EVERGREEN-AZ", new DateTime(2026, 9, 14, 0, 0, 0, DateTimeKind.Utc));
            RevitProjectLink l = ProjectLinkPolicy.Resolve("doc1", "x.rvt", null, s, null, null, 30, "other", Erp, true);
            Assert.Eq(ProjectLinkState.CONFIRMED, l.State);
            Assert.Eq(41, l.ProjectId);
            Assert.Eq("USER_CONFIRMED", l.ConfirmedBy);
            // Өөр баримтад хамаарахгүй.
            RevitProjectLink other = ProjectLinkPolicy.Resolve("doc2", "x.rvt", null, s, null, null, null, null, Erp, true);
            Assert.False(other.State == ProjectLinkState.CONFIRMED);
        }

        [Test] public static void ServerHandshake_IsConfirmed()
        {
            RevitProjectLink l = ProjectLinkPolicy.Resolve("doc1", "x.rvt", null, null, 37, "EVERGREEN-ZA", null, null, Erp, true);
            Assert.Eq(ProjectLinkState.CONFIRMED, l.State);
            Assert.Eq("SERVER_HANDSHAKE", l.ConfirmedBy);
        }

        [Test] public static void Offline_NoSuggestions()
        {
            RevitProjectLink l = ProjectLinkPolicy.Resolve("doc1", "x.rvt", null, null, null, null, null, null, null, false);
            Assert.Eq(ProjectLinkState.ERP_OFFLINE, l.State);
            RevitProjectLink u = ProjectLinkPolicy.Resolve("doc1", "zzz.rvt", null, null, null, null, null, null, Erp, true);
            Assert.Eq(ProjectLinkState.UNLINKED, u.State);
        }

        [Test] public static void Wire_OnlyConfirmedProjectId()
        {
            var snap = new RevitContextSnapshot
            {
                Document = new RevitDocumentContext { DocKey = "d", Title = "T", RevitVersion = "2027" },
                ProjectLink = new RevitProjectLink { State = ProjectLinkState.SUGGESTED, Suggestions = { new ProjectLinkSuggestion { ProjectId = 41, Score = 0.95 } } },
            };
            for (int i = 0; i < 30; i++) snap.Selection.Add(new RevitElementSummary { ElementId = i, Category = "Walls" });
            for (int i = 30; i < 60; i++) snap.SelectionRest.Add(new RevitElementRef { ElementId = i, Category = "Doors" });
            snap.SelectionTotal = 60;
            MglAiRevitContextWire w = MglAiWire.FromSnapshot(snap);
            Assert.Null(w.ProjectId);
            Assert.Eq(55, w.Selection.Count, "25 хураангуй + 30 үлдсэн");
            Assert.Eq("Doors", w.Selection[54].Category);
            snap.ProjectLink.State = ProjectLinkState.CONFIRMED; snap.ProjectLink.ProjectId = 41;
            Assert.Eq(41, MglAiWire.FromSnapshot(snap).ProjectId);
            string json = IntelligenceJson.Serialize(w);
            Assert.True(json.Contains("\"docUid\":\"d\"") && json.Contains("\"activeViewName\"") == false, "серверийн camelCase талбарууд, null хасагдана");
        }
    }
}

namespace RevitMcpAddin.Intelligence.Tests
{
    /// <summary>§11 — файлын зам гэрээнд ХЭЗЭЭ Ч орохгүй.</summary>
    public static class DocKeyTests
    {
        [Test] public static void PathKey_IsHashed()
        {
            string raw = @"path:\192.168.0.157\01.architecture\MGL-240506\model.rfa";
            string k = DocKeys.Normalize(raw);
            Assert.True(k.StartsWith("path:"), k);
            Assert.Eq(5 + 16, k.Length);
            Assert.False(k.Contains("192.168"), "зам алга болно");
            Assert.Eq(k, DocKeys.Normalize(raw), "детерминист");
            Assert.True(DocKeys.IsPathBased(k));
        }

        [Test] public static void ProjectInfoKey_Unchanged()
        {
            Assert.Eq("09a23078-100f-42a4-8c86-d57dbb6406e5-003e50b9", DocKeys.Normalize("09a23078-100f-42a4-8c86-d57dbb6406e5-003e50b9"));
            Assert.Null(DocKeys.Normalize(null));
        }
    }
}

namespace RevitMcpAddin.Intelligence.Tests
{
    /// <summary>Phase 5 — runtime `/turn` SSE-ийн `result`/`error` frame → RevitTurnResult (оркестраци C#-д БАЙХГҮЙ).</summary>
    public static class TurnClientTests
    {
        [Test] public static void ResultFrame_ModelAnswer()
        {
            var r = new RevitTurnResult();
            RevitMcpAddin.Intelligence.Ai.MglAiTurnClient.Handle("result", "{\"answer\":\"Хана 200 мм.\",\"engine\":\"llama\",\"error\":null,\"citations\":[{\"label\":\"БНбД 31-03\"}],\"contractDiag\":{\"final\":\"repaired\"}}", r);
            Assert.Eq("Хана 200 мм.", r.AnswerMn);
            Assert.Eq(TurnAnswerSource.MODEL, r.Source);
            Assert.Contains(r.Citations, "БНбД 31-03");
            Assert.Contains(r.Notices, "contract:repaired");
        }

        [Test] public static void ResultFrame_TemplateAndOffline()
        {
            var r = new RevitTurnResult();
            RevitMcpAddin.Intelligence.Ai.MglAiTurnClient.Handle("result", "{\"answer\":\"—\",\"engine\":\"retrieval-only\",\"error\":{\"code\":\"LOCAL_RUNTIME_OFFLINE\"},\"contractDiag\":{\"final\":\"template\"}}", r);
            Assert.Eq(TurnAnswerSource.SERVER_TEMPLATE, r.Source);
            Assert.Eq(RevitErrorState.MGL_AI_OFFLINE, r.State);
            Assert.Contains(r.Notices, "LOCAL_RUNTIME_OFFLINE");
        }

        [Test] public static void ResultFrame_BackendOffline_MapsToErpOffline()
        {
            var r = new RevitTurnResult();
            RevitMcpAddin.Intelligence.Ai.MglAiTurnClient.Handle("result", "{\"answer\":\"\",\"engine\":null,\"error\":{\"code\":\"BACKEND_OFFLINE\"},\"contractDiag\":null}", r);
            Assert.Eq(RevitErrorState.ERP_OFFLINE, r.State);
            Assert.Contains(r.Notices, "BACKEND_OFFLINE");
        }

        [Test] public static void ErrorFrame_AndGarbage()
        {
            var r = new RevitTurnResult();
            RevitMcpAddin.Intelligence.Ai.MglAiTurnClient.Handle("error", "{\"message\":\"boom\"}", r);
            Assert.Eq(RevitErrorState.MGL_AI_OFFLINE, r.State);
            Assert.True(r.AnswerMn.Contains("boom"));
            RevitMcpAddin.Intelligence.Ai.MglAiTurnClient.Handle("ai", "not json", r); // унахгүй
            RevitMcpAddin.Intelligence.Ai.MglAiTurnClient.Handle("ai", "{\"type\":\"notice\",\"safeUserMessage\":\"Нотолгоо алга\"}", r);
            Assert.Contains(r.Notices, "Нотолгоо алга");
        }

        [Test] public static void NoSecret_IsAuthRequired_NotCrash()
        {
            var c = new RevitMcpAddin.Intelligence.Ai.MglAiTurnClient(new RevitMcpAddin.Intelligence.Ai.NotConfiguredLocalAuthProvider(), () => null, "http://127.0.0.1:1");
            RevitTurnResult r = c.AskAsync(new RevitTurnRequest { Question = "x", ConvUid = "c" }, System.Threading.CancellationToken.None).GetAwaiter().GetResult();
            Assert.Eq(RevitErrorState.AUTH_REQUIRED, r.State);
            Assert.Eq("LIVE:/turn", c.Binding);
        }
    }
}

namespace RevitMcpAddin.Intelligence.Tests
{
    public static class ReportKeywordTests
    {
        // R3.5: host.LooksLikeReportQuestion нь TextFold дээр «tailan» хайдаг — галиг тогтвортой байх ёстой.
        [Test] public static void Fold_ReportKeyword()
        {
            string f = RevitMcpAddin.TextFold.Fold("Өнөөдрийн хийсэн ажлын тайлан гарга.");
            Assert.True(f.Contains("tailan"), "fold=" + f);
            Assert.False(RevitMcpAddin.TextFold.Fold("Энэ юу вэ?").Contains("tailan"), "no false positive");
        }
    }
}
