using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RevitMcpAddin.WorkTracking.Core
{
    /// <summary>
    /// КОНТЕКСТЫН САНАМЖ — «энэ баримт аль төсөлд харьяалагддаг» ба «энэ
    /// хэрэглэгч энэ төсөл дээр аль таскийг сонгосон».
    ///
    /// Яагаад: ажилтан Revit-ийг хааж нээх, эсвэл А баримтаас Б руу шилжиж
    /// буцах бүрд таскаа дахин сонгох ёсгүй — ӨӨРИЙН сонгосон таск нь автоматаар
    /// үргэлжилнэ («Resume» товчгүй).  Хэзээ ч ЭХНИЙ таскийг ДУРААРАА сонгохгүй:
    /// сонголт нь ҮРГЭЛЖ ажилтных.
    ///
    /// Файл: `%APPDATA%\RevitMcpAddin\tracking\context.json`.  Ховор бичигдэнэ
    /// (сонголт солигдох, шинэ баримт холбогдох үед л) — хоёр Revit зэрэг бичвэл
    /// сүүлийнх нь ялна; тэр нь САНАМЖ, тоологдсон цаг биш.
    /// </summary>
    public sealed class TrackingContextMemory
    {
        private readonly object _gate = new object();
        private readonly string _path;
        private MemoryDoc _doc = new MemoryDoc();

        public TrackingContextMemory(string path)
        {
            _path = path;
            Load();
        }

        public static TrackingContextMemory InMemory() => new TrackingContextMemory(null);

        public sealed class DocInfo
        {
            [JsonPropertyName("project_id")] public int ProjectId { get; set; }
            [JsonPropertyName("project_name")] public string ProjectName { get; set; }
            [JsonPropertyName("revit_document_id")] public int? RevitDocumentId { get; set; }
            [JsonPropertyName("doc_name")] public string DocName { get; set; }
            [JsonPropertyName("seen_at")] public string SeenAt { get; set; }
        }

        public sealed class TaskChoice
        {
            [JsonPropertyName("task_id")] public int TaskId { get; set; }
            [JsonPropertyName("task_name")] public string TaskName { get; set; }
            [JsonPropertyName("at")] public string At { get; set; }
        }

        internal sealed class MemoryDoc
        {
            [JsonPropertyName("docs")] public Dictionary<string, DocInfo> Docs { get; set; } = new Dictionary<string, DocInfo>();
            [JsonPropertyName("tasks")] public Dictionary<string, TaskChoice> Tasks { get; set; } = new Dictionary<string, TaskChoice>();
        }

        private static string TaskKey(int userId, int projectId) =>
            "u" + userId.ToString(CultureInfo.InvariantCulture) + ":p" + projectId.ToString(CultureInfo.InvariantCulture);

        public void RememberDoc(string docKey, DocInfo info)
        {
            if (string.IsNullOrEmpty(docKey) || info == null || info.ProjectId <= 0) return;
            lock (_gate)
            {
                DocInfo cur;
                bool same = _doc.Docs.TryGetValue(docKey, out cur) && cur.ProjectId == info.ProjectId &&
                            cur.RevitDocumentId == info.RevitDocumentId && cur.ProjectName == info.ProjectName &&
                            cur.DocName == info.DocName;
                if (same) return;
                _doc.Docs[docKey] = info;
            }
            Save();
        }

        public DocInfo Doc(string docKey)
        {
            if (string.IsNullOrEmpty(docKey)) return null;
            lock (_gate)
            {
                DocInfo d;
                return _doc.Docs.TryGetValue(docKey, out d) ? d : null;
            }
        }

        public void RememberTask(int userId, int projectId, int taskId, string taskName)
        {
            if (userId <= 0 || projectId <= 0 || taskId <= 0) return;
            lock (_gate)
            {
                TaskChoice cur;
                if (_doc.Tasks.TryGetValue(TaskKey(userId, projectId), out cur) && cur.TaskId == taskId && cur.TaskName == taskName) return;
                _doc.Tasks[TaskKey(userId, projectId)] = new TaskChoice
                {
                    TaskId = taskId,
                    TaskName = taskName,
                    At = WorkTracker.Iso(DateTime.UtcNow),
                };
            }
            Save();
        }

        public void ForgetTask(int userId, int projectId)
        {
            bool changed;
            lock (_gate) changed = _doc.Tasks.Remove(TaskKey(userId, projectId));
            if (changed) Save();
        }

        public TaskChoice Task(int userId, int projectId)
        {
            lock (_gate)
            {
                TaskChoice t;
                return _doc.Tasks.TryGetValue(TaskKey(userId, projectId), out t) ? t : null;
            }
        }

        /// <summary>
        /// ЦЭВЭР ШИЙДВЭР — идэвхтэй баримт + хэрэглэгч → тоолох контекст эсвэл шалтгаан.
        /// Баримт/төсөл солигдоход яг энэ дүрмээр автоматаар шилжинэ.
        /// </summary>
        public WorkContext Resolve(int? userId, string docKey, string docName, out TrackState reason)
        {
            if (!userId.HasValue || userId.Value <= 0) { reason = TrackState.SignedOut; return null; }
            if (string.IsNullOrEmpty(docKey)) { reason = TrackState.NoDocument; return null; }
            DocInfo d = Doc(docKey);
            if (d == null) { reason = TrackState.NoTask; return null; }        // баримт төсөлд холбогдоогүй / мэдэгдэхгүй
            TaskChoice t = Task(userId.Value, d.ProjectId);
            if (t == null) { reason = TrackState.NoTask; return null; }
            reason = TrackState.Working;
            return new WorkContext
            {
                UserId = userId.Value,
                TaskId = t.TaskId,
                TaskName = t.TaskName,
                ProjectId = d.ProjectId,
                ProjectName = d.ProjectName,
                DocKey = docKey,
                RevitDocumentId = d.RevitDocumentId,
                DocName = string.IsNullOrEmpty(docName) ? d.DocName : docName,
            };
        }

        private void Load()
        {
            if (string.IsNullOrEmpty(_path)) return;
            try
            {
                if (!File.Exists(_path)) return;
                MemoryDoc d = JsonSerializer.Deserialize<MemoryDoc>(File.ReadAllText(_path));
                if (d != null)
                {
                    d.Docs = d.Docs ?? new Dictionary<string, DocInfo>();
                    d.Tasks = d.Tasks ?? new Dictionary<string, TaskChoice>();
                    lock (_gate) _doc = d;
                }
            }
            catch
            {
                // Гэмтсэн санамж — хоосноор эхэлнэ (ажилтан таскаа дахин сонгоно).
            }
        }

        private void Save()
        {
            if (string.IsNullOrEmpty(_path)) return;
            try
            {
                string json;
                lock (_gate) json = JsonSerializer.Serialize(_doc);
                Directory.CreateDirectory(Path.GetDirectoryName(_path));
                string tmp = _path + "." + Environment.ProcessId.ToString(CultureInfo.InvariantCulture) + ".tmp";
                File.WriteAllText(tmp, json);
                if (File.Exists(_path)) File.Replace(tmp, _path, null);
                else File.Move(tmp, _path);
            }
            catch
            {
                // Санамж хадгалагдаагүй — тоолол үргэлжилнэ.
            }
        }
    }
}
