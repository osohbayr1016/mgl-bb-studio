using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using RevitMcpAddin.Intelligence.Contracts;
using RevitMcpAddin.Intelligence.Core;

namespace RevitMcpAddin.Intelligence.Erp
{
    /* ================================================================== */
    /*  ERP АДАПТЕРУУД (§27–29) — НЭВТРЭЛТТЭЙ API-аар л, D1 руу ХЭЗЭЭ Ч ҮГҮЙ  */
    /*                                                                    */
    /*  Аль хэдийн байгаа `RevitApi.GetContextAsync` (`GET /api/revit/context`) */
    /*  ба `ApiClient.GetProjectsAsync` (`GET /api/projects`)-ийг дахин     */
    /*  ашиглана.  Шинэ endpoint, шинэ эрх ЗОХИОХГҮЙ.                      */
    /* ================================================================== */

    public interface IRevitTaskContextProvider
    {
        Task<RevitTaskContext> GetAsync(string docKey, int? projectId, CancellationToken ct);
    }

    public interface IErpProjectsProvider
    {
        /// <summary>null = ERP хүрэхгүй / нэвтрээгүй.</summary>
        Task<List<ErpProjectRef>> ListAsync(CancellationToken ct);
    }

    public sealed class ErpTaskContextProvider : IRevitTaskContextProvider
    {
        private RevitTaskContext _last;
        private readonly object _gate = new object();

        /// <summary>Сүүлийн амжилттай татсан контекст — офлайн үед `FromCache = true`, огноотой (§74).</summary>
        public RevitTaskContext LastKnown { get { lock (_gate) return _last; } }

        public async Task<RevitTaskContext> GetAsync(string docKey, int? projectId, CancellationToken ct)
        {
            AddinSettings st = SettingsStore.Load();
            var ctx = new RevitTaskContext { FetchedAt = DateTime.UtcNow.ToString("o"), ProjectId = projectId };
            if (string.IsNullOrEmpty(st.Token))
            {
                ctx.Status = TaskContextStatus.AUTH_REQUIRED;
                return WithCache(ctx);
            }
            if (projectId == null)
            {
                ctx.Status = TaskContextStatus.PROJECT_NOT_LINKED;
                return ctx;
            }
            try
            {
                ContextResult r = await RevitApi.GetContextAsync(st.ApiHost, st.Token, docKey, projectId).ConfigureAwait(false);
                ctx.Status = TaskContextStatus.OK;
                ctx.IsManager = r.IsManager;
                ctx.Scope = r.Scope;
                if (r.Document != null)
                {
                    ctx.ProjectId = r.Document.ProjectId;
                    ctx.ProjectName = r.Document.ProjectName;
                }
                foreach (ResolvedTaskDto t in r.Resolved)
                {
                    ctx.Tasks.Add(new RevitTaskItem
                    {
                        TaskId = t.TaskId,
                        Title = t.TaskName,
                        DrawingName = t.DrawingName,
                        BlockName = t.BlockName,
                        AssignedToMe = t.Assigned,
                        CurrentProgress = t.CurrentProgress,
                        ChecklistDone = t.Checklist != null ? t.Checklist.Done : 0,
                        ChecklistTotal = t.Checklist != null ? t.Checklist.Total : 0,
                        ReportedToday = t.ReportedToday,
                        SheetUids = t.SheetUids ?? new List<string>(),
                        ProjectId = ctx.ProjectId,
                        ProjectName = ctx.ProjectName,
                        Status = t.CurrentProgress >= 100 ? "done" : "active",
                    });
                }
                if (ctx.Tasks.Count == 0) ctx.Status = TaskContextStatus.NO_TASKS;
                lock (_gate) _last = ctx;
                return ctx;
            }
            catch (UnauthorizedException)
            {
                ctx.Status = TaskContextStatus.AUTH_REQUIRED;
                return WithCache(ctx);
            }
            catch (ApiException ex)
            {
                // 404 = баримт/төсөл бүртгэлгүй → холбоос; бусад = ERP-ийн алдаа.
                ctx.Status = ex.StatusCode == 404 ? TaskContextStatus.PROJECT_NOT_LINKED : TaskContextStatus.ERP_OFFLINE;
                ctx.Error = RevitApi.FriendlyError(ex);
                return WithCache(ctx);
            }
            catch (Exception ex)
            {
                ctx.Status = TaskContextStatus.ERP_OFFLINE;
                ctx.Error = ex is HttpRequestException || ex is OperationCanceledException ? RevitApi.FriendlyError(ex) : ex.GetType().Name;
                return WithCache(ctx);
            }
        }

        private RevitTaskContext WithCache(RevitTaskContext fresh)
        {
            RevitTaskContext last;
            lock (_gate) last = _last;
            if (last == null) return fresh;
            // Кэшийг «одоогийнх» гэж ХЭЗЭЭ Ч харуулахгүй — огноо + туг (§74).
            fresh.Tasks = last.Tasks;
            fresh.ProjectName = fresh.ProjectName ?? last.ProjectName;
            fresh.FromCache = true;
            fresh.FetchedAt = last.FetchedAt;
            return fresh;
        }
    }

    public sealed class ErpProjectsProvider : IErpProjectsProvider
    {
        private List<ErpProjectRef> _cache;
        private DateTime _cachedAt;

        public async Task<List<ErpProjectRef>> ListAsync(CancellationToken ct)
        {
            if (_cache != null && (DateTime.UtcNow - _cachedAt).TotalMinutes < 10) return _cache;
            AddinSettings st = SettingsStore.Load();
            if (string.IsNullOrEmpty(st.Token)) return null;
            try
            {
                List<ProjectInfo> list = await ApiClient.GetProjectsAsync(st.ApiHost, st.Token).ConfigureAwait(false);
                var refs = new List<ErpProjectRef>();
                foreach (ProjectInfo p in list) refs.Add(new ErpProjectRef { Id = p.Id, Name = p.Name });
                _cache = refs;
                _cachedAt = DateTime.UtcNow;
                return refs;
            }
            catch
            {
                return _cache; // хуучин жагсаалт, эсвэл null
            }
        }
    }
}
