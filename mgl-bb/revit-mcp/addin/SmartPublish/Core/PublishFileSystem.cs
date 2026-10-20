using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace RevitMcpAddin.SmartPublish.Core
{
    public sealed class FileFacts
    {
        public string Path { get; set; }
        public long Length { get; set; }
        public DateTime LastWriteUtc { get; set; }
    }

    /// <summary>
    /// Файлын системийн ТОДОРХОЙ гарц — planner, preflight, artifact validator бүгд үүгээр
    /// дамжина.  Тестэд санах ойн хуурамч (`MemoryFileSystem`) орлуулж, түгжигдсэн/байхгүй
    /// хавтас, хоосон файл, сүлжээний тасралтыг дуурайна.
    /// </summary>
    public interface IFileSystem
    {
        bool FileExists(string path);
        bool DirectoryExists(string path);
        void CreateDirectory(string path);
        /// <summary>Хавтсанд түр файл үүсгээд устгаж бичих эрхийг шалгана (хавтас байхгүй бол false).</summary>
        bool TryProbeWritable(string directory, out string error);
        FileFacts GetFile(string path);
        /// <summary>Хавтсын шууд (рекурсгүй) файлууд.  Хавтас байхгүй бол хоосон.</summary>
        IReadOnlyList<FileFacts> ListFiles(string directory);
    }

    public sealed class RealFileSystem : IFileSystem
    {
        public static readonly RealFileSystem Instance = new RealFileSystem();

        public bool FileExists(string path)
        {
            try { return File.Exists(path); }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is ArgumentException || ex is NotSupportedException)
            { return false; }
        }

        public bool DirectoryExists(string path)
        {
            try { return Directory.Exists(path); }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is ArgumentException || ex is NotSupportedException)
            { return false; }
        }

        public void CreateDirectory(string path)
        {
            Directory.CreateDirectory(path);
        }

        public bool TryProbeWritable(string directory, out string error)
        {
            error = null;
            try
            {
                if (!Directory.Exists(directory)) { error = "Хавтас байхгүй"; return false; }
                string probe = System.IO.Path.Combine(directory, ".mgl-write-test-" + Guid.NewGuid().ToString("N").Substring(0, 8));
                using (var fs = new FileStream(probe, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1, FileOptions.DeleteOnClose))
                {
                    fs.WriteByte(0);
                }
                return true;
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is ArgumentException || ex is NotSupportedException)
            {
                error = ex.GetType().Name;
                return false;
            }
        }

        public FileFacts GetFile(string path)
        {
            try
            {
                var fi = new FileInfo(path);
                if (!fi.Exists) return null;
                return new FileFacts { Path = fi.FullName, Length = fi.Length, LastWriteUtc = fi.LastWriteTimeUtc };
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is ArgumentException || ex is NotSupportedException)
            { return null; }
        }

        public IReadOnlyList<FileFacts> ListFiles(string directory)
        {
            try
            {
                if (!Directory.Exists(directory)) return new FileFacts[0];
                return new DirectoryInfo(directory).GetFiles()
                    .Select(f => new FileFacts { Path = f.FullName, Length = f.Length, LastWriteUtc = f.LastWriteTimeUtc })
                    .ToList();
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is ArgumentException || ex is NotSupportedException)
            { return new FileFacts[0]; }
        }
    }
}
