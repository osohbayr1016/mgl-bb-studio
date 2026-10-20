using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using RevitMcpAddin.SmartPublish.Core;

namespace RevitMcpAddin.Smart.Tests
{
    /// <summary>Санах ойн файлын систем — түгжигдсэн/байхгүй хавтас, хоосон файл, шинэчлэгдэхгүй файлыг дуурайна.</summary>
    public sealed class MemoryFileSystem : IFileSystem
    {
        private readonly Dictionary<string, FileFacts> _files = new Dictionary<string, FileFacts>(StringComparer.OrdinalIgnoreCase);
        private readonly HashSet<string> _dirs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        public HashSet<string> ReadOnlyDirs { get; } = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        public MemoryFileSystem AddDir(string dir)
        {
            string d = dir.TrimEnd('\\', '/');
            while (!string.IsNullOrEmpty(d))
            {
                _dirs.Add(d);
                string parent = Path.GetDirectoryName(d);
                if (string.IsNullOrEmpty(parent) || parent == d) break;
                d = parent.TrimEnd('\\', '/');
            }
            return this;
        }

        public MemoryFileSystem AddFile(string path, long length = 1000, DateTime? writeUtc = null)
        {
            AddDir(Path.GetDirectoryName(path));
            _files[path] = new FileFacts { Path = path, Length = length, LastWriteUtc = writeUtc ?? new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc) };
            return this;
        }

        public void Remove(string path) { _files.Remove(path); }

        public bool FileExists(string path) { return _files.ContainsKey(path); }
        public bool DirectoryExists(string path) { return _dirs.Contains((path ?? "").TrimEnd('\\', '/')); }
        public void CreateDirectory(string path) { AddDir(path); }

        public bool TryProbeWritable(string directory, out string error)
        {
            error = null;
            if (!DirectoryExists(directory)) { error = "Хавтас байхгүй"; return false; }
            if (ReadOnlyDirs.Contains(directory.TrimEnd('\\', '/'))) { error = "UnauthorizedAccessException"; return false; }
            return true;
        }

        public FileFacts GetFile(string path)
        {
            FileFacts f;
            return _files.TryGetValue(path, out f) ? f : null;
        }

        public IReadOnlyList<FileFacts> ListFiles(string directory)
        {
            string d = (directory ?? "").TrimEnd('\\', '/');
            return _files.Values.Where(f => string.Equals(Path.GetDirectoryName(f.Path), d, StringComparison.OrdinalIgnoreCase))
                .Select(f => new FileFacts { Path = f.Path, Length = f.Length, LastWriteUtc = f.LastWriteUtc }).ToList();
        }
    }

    public static class Samples
    {
        public static PublishContext Project(DateTime? now = null)
        {
            return new PublishContext
            {
                DocumentTitle = "Tennis-Hall",
                ProjectName = "Теннисний ордон",
                ProjectNumber = "MGL-251006",
                ProjectClient = "ХХК",
                Now = now ?? new DateTime(2026, 10, 1, 9, 30, 0),
                ProjectValues = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { { "Phase", "DD" } },
            };
        }

        public static PublishItem Sheet(string id, string number, string name, string rev = "A", bool printable = true, bool placeholder = false)
        {
            var it = new PublishItem
            {
                Id = id,
                Kind = PublishItemKind.Sheet,
                Number = number,
                Name = name,
                RevisionNumber = rev,
                CanBePrinted = printable,
                IsPlaceholder = placeholder,
            };
            it.Values["Discipline"] = "Architecture";
            return it;
        }

        public static PublishProfile Profile(string baseFolder = @"D:\Out")
        {
            var p = new PublishProfile
            {
                Name = "Test",
                Formats = new List<PublishFormat> { PublishFormat.Pdf },
                Overwrite = OverwriteMode.Version,
                Destination = new DestinationRule { BaseFolder = baseFolder, SubfolderTemplate = "{Format}" },
                Naming = new NamingSettings { SheetTemplate = "{SheetNumber}_{SheetName}[_{Revision}]" },
            };
            return p;
        }

        public static PreflightContext Pre(PublishProfile profile, IReadOnlyList<PublishItem> items, IFileSystem fs, EnvironmentFacts env = null)
        {
            PublishContext ctx = Project();
            PublishPlan plan = PublishPlanner.Build(profile, items, ctx, fs);
            return new PreflightContext { Profile = profile, Items = items, Plan = plan, Project = ctx, Fs = fs, Env = env ?? new EnvironmentFacts() };
        }
    }
}
