using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json;
using RevitMcpAddin.Intelligence.Contracts;

namespace RevitMcpAddin.Intelligence.Core
{
    /// <summary>
    /// Баталгаажсан холбоосын хадгалалт — `intelligence/project-links.json`
    /// (`doc_key` → холбоос).  ЖИЖИГ файл (баримт тутам нэг мөр) тул бүтэн
    /// дахин бичилт зөвшөөрөгдөнө; tmp + move атомаар.
    /// ⚠️ ERP-ийн мөр ЭНД ХУУЛАГДАХГҮЙ — зөвхөн id, нэр, хэзээ, хэн (§28).
    /// </summary>
    public sealed class ProjectLinkStore
    {
        private readonly object _gate = new object();
        private readonly IIntelligenceStoragePaths _paths;
        private Dictionary<string, StoredProjectLink> _links;

        public ProjectLinkStore(IIntelligenceStoragePaths paths)
        {
            _paths = paths ?? new NoDiskStoragePaths();
        }

        private string PathOrNull
        {
            get { string r = _paths.RootDir; return string.IsNullOrEmpty(r) ? null : Path.Combine(r, "project-links.json"); }
        }

        public StoredProjectLink Get(string docKey)
        {
            if (string.IsNullOrEmpty(docKey)) return null;
            lock (_gate)
            {
                Load();
                StoredProjectLink l;
                return _links.TryGetValue(docKey, out l) ? l : null;
            }
        }

        public void Put(StoredProjectLink link)
        {
            if (link == null || string.IsNullOrEmpty(link.DocKey)) throw new ArgumentException("link");
            lock (_gate)
            {
                Load();
                _links[link.DocKey] = link;
                Save();
            }
        }

        public bool Remove(string docKey)
        {
            lock (_gate)
            {
                Load();
                bool ok = _links.Remove(docKey ?? "");
                if (ok) Save();
                return ok;
            }
        }

        private sealed class Row
        {
            public string doc_key { get; set; }
            public int project_id { get; set; }
            public string project_name { get; set; }
            public string confirmed_at { get; set; }
            public string confirmed_by { get; set; }
        }

        private void Load()
        {
            if (_links != null) return;
            _links = new Dictionary<string, StoredProjectLink>(StringComparer.Ordinal);
            string p = PathOrNull;
            if (p == null || !File.Exists(p)) return;
            try
            {
                var rows = JsonSerializer.Deserialize<List<Row>>(File.ReadAllText(p, Encoding.UTF8));
                if (rows == null) return;
                foreach (Row r in rows)
                {
                    if (string.IsNullOrEmpty(r.doc_key) || r.project_id <= 0) continue;
                    _links[r.doc_key] = new StoredProjectLink
                    {
                        DocKey = r.doc_key, ProjectId = r.project_id, ProjectName = r.project_name,
                        ConfirmedAt = r.confirmed_at, ConfirmedBy = r.confirmed_by,
                    };
                }
            }
            catch
            {
                // Эвдэрсэн файл = холбоосгүй; хэрэглэгч дахин баталгаажуулна.
            }
        }

        private void Save()
        {
            string p = PathOrNull;
            if (p == null) return;
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(p));
                var rows = new List<Row>();
                foreach (StoredProjectLink l in _links.Values)
                    rows.Add(new Row { doc_key = l.DocKey, project_id = l.ProjectId, project_name = l.ProjectName, confirmed_at = l.ConfirmedAt, confirmed_by = l.ConfirmedBy });
                string tmp = p + ".tmp";
                File.WriteAllText(tmp, JsonSerializer.Serialize(rows, new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(false));
                if (File.Exists(p)) File.Replace(tmp, p, null); else File.Move(tmp, p);
            }
            catch { }
        }
    }
}
