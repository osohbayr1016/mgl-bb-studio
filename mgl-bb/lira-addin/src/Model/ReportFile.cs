using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.IO.Compression;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Xml;

namespace MglLiraReport.Model
{
    /// <summary>
    /// .mglrep = zip { report.json, images/&lt;id&gt; }.  Зураг нь санах ойд байт хэлбэрээр байна.
    /// </summary>
    public class ReportFile
    {
        public const string Extension = ".mglrep";
        const string JsonEntry = "report.json";
        const string ImageDir = "images/";

        public ReportDocument Document { get; private set; }
        public Dictionary<string, byte[]> Images { get; } = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
        public string Path { get; set; }

        public ReportFile(ReportDocument doc) { Document = doc; Document.Normalize(); }

        public static ReportFile Load(string path)
        {
            using (var zip = ZipFile.OpenRead(path))
            {
                var entry = zip.GetEntry(JsonEntry) ?? throw new InvalidDataException("report.json олдсонгүй — энэ MGL тайлангийн файл биш.");
                ReportDocument doc;
                using (var s = entry.Open()) doc = (ReportDocument)Serializer().ReadObject(s);
                var file = new ReportFile(doc) { Path = path };
                foreach (var e in zip.Entries)
                {
                    if (!e.FullName.StartsWith(ImageDir, StringComparison.OrdinalIgnoreCase) || e.Name.Length == 0) continue;
                    using (var s = e.Open())
                    using (var ms = new MemoryStream())
                    {
                        s.CopyTo(ms);
                        file.Images[e.Name] = ms.ToArray();
                    }
                }
                return file;
            }
        }

        /// <summary>Түр файлд бичээд солих — хадгалах дундуур унавал хуучин файл эвдрэхгүй.</summary>
        public void Save(string path)
        {
            Document.Schema = ReportDocument.CurrentSchema;
            string dir = System.IO.Path.GetDirectoryName(System.IO.Path.GetFullPath(path));
            Directory.CreateDirectory(dir);
            string tmp = path + ".tmp";
            using (var fs = new FileStream(tmp, FileMode.Create, FileAccess.Write))
            using (var zip = new ZipArchive(fs, ZipArchiveMode.Create))
            {
                var json = zip.CreateEntry(JsonEntry, CompressionLevel.Optimal);
                using (var s = json.Open())
                using (var w = JsonReaderWriterFactory.CreateJsonWriter(s, new UTF8Encoding(false), false, true, "  "))
                {
                    Serializer().WriteObject(w, Document);
                    w.Flush();
                }
                foreach (var id in UsedImageIds())
                {
                    if (!Images.TryGetValue(id, out var bytes)) continue;
                    var e = zip.CreateEntry(ImageDir + id, CompressionLevel.NoCompression);
                    using (var s = e.Open()) s.Write(bytes, 0, bytes.Length);
                }
            }
            if (File.Exists(path)) File.Replace(tmp, path, null);
            else File.Move(tmp, path);
            Path = path;
        }

        /// <summary>Зургийг файлд нэмж id буцаана.  PNG/JPEG-ээс бусдыг PNG болгоно.</summary>
        public string AddImage(byte[] bytes)
        {
            string ext;
            using (var ms = new MemoryStream(bytes))
            using (var img = Image.FromStream(ms))
            {
                if (img.RawFormat.Guid == ImageFormat.Jpeg.Guid) ext = ".jpg";
                else if (img.RawFormat.Guid == ImageFormat.Png.Guid) ext = ".png";
                else
                {
                    using (var outMs = new MemoryStream())
                    {
                        img.Save(outMs, ImageFormat.Png);
                        bytes = outMs.ToArray();
                    }
                    ext = ".png";
                }
            }
            string id = Guid.NewGuid().ToString("N").Substring(0, 12) + ext;
            Images[id] = bytes;
            return id;
        }

        public string AddImage(Image image)
        {
            using (var ms = new MemoryStream())
            {
                image.Save(ms, ImageFormat.Png);
                return AddImage(ms.ToArray());
            }
        }

        public HashSet<string> UsedImageIds()
        {
            var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (!string.IsNullOrEmpty(Document.Project.EngineerSignatureImage)) used.Add(Document.Project.EngineerSignatureImage);
            foreach (var p in Document.Pages)
                foreach (var b in p.Blocks)
                    foreach (var r in b.Images)
                        if (!string.IsNullOrEmpty(r.ImageId)) used.Add(r.ImageId);
            return used;
        }

        static DataContractJsonSerializer Serializer() =>
            new DataContractJsonSerializer(typeof(ReportDocument), new DataContractJsonSerializerSettings { UseSimpleDictionaryFormat = true });

        /// <summary>report.json-ыг текстээр (жишээ нь загвар болгон шалгахад).</summary>
        public string ToJson()
        {
            using (var ms = new MemoryStream())
            {
                using (var w = JsonReaderWriterFactory.CreateJsonWriter(ms, new UTF8Encoding(false), false, true, "  "))
                {
                    Serializer().WriteObject(w, Document);
                    w.Flush();
                }
                return Encoding.UTF8.GetString(ms.ToArray());
            }
        }
    }
}
