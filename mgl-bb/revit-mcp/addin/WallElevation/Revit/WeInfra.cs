using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Autodesk.Revit.DB;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// «Ханын дэлгээс»-ийн техникийн лог: `%APPDATA%\RevitMcpAddin\wall-elevations.log` (SheetNumeratorLog-той ижил хэлбэр).
    /// Хэрэглэгчид товч Монгол мессеж, ЭНД exception-ы бүтэн мэдээлэл.  Хэзээ ч throw хийхгүй; ~1 MB-д эргэнэ.
    /// </summary>
    internal static class WeLog
    {
        private const long MaxBytes = 1024 * 1024;
        private static readonly object Gate = new object();

        public static string LogPath { get { return Path.Combine(SettingsStore.Dir, "wall-elevations.log"); } }

        public static void Info(string op, string message) { Write("INFO", op, message, null); }

        public static void Error(string op, string message, Exception ex) { Write("ERROR", op, message, ex); }

        private static void Write(string level, string op, string message, Exception ex)
        {
            try
            {
                var sb = new StringBuilder();
                sb.Append(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff")).Append(' ').Append(level)
                  .Append(" [").Append(op).Append("] addin ").Append(BuildInfo.Version).Append(" · ")
                  .AppendLine(message ?? string.Empty);
                if (ex != null)
                {
                    sb.Append("    ").Append(ex.GetType().FullName).Append(": ").AppendLine(ex.Message);
                    if (!string.IsNullOrEmpty(ex.StackTrace)) sb.AppendLine(ex.StackTrace);
                }
                lock (Gate)
                {
                    string path = LogPath;
                    Directory.CreateDirectory(Path.GetDirectoryName(path));
                    var fi = new FileInfo(path);
                    if (fi.Exists && fi.Length > MaxBytes)
                    {
                        string old = path + ".1";
                        if (File.Exists(old)) File.Delete(old);
                        File.Move(path, old);
                    }
                    File.AppendAllText(path, sb.ToString(), new UTF8Encoding(false));
                }
            }
            catch
            {
                // Лог бичиж чадахгүй нь ажиллагааг унагах ёсгүй.
            }
        }
    }

    /// <summary>Тохиргоо: `%APPDATA%\RevitMcpAddin\wall-elevations.json` (агуулга нь <see cref="WeSettings.Serialize"/>).  Атом бичилт.</summary>
    internal static class WePrefsStore
    {
        private static string PathOf { get { return Path.Combine(SettingsStore.Dir, "wall-elevations.json"); } }

        public static WeSettings Load()
        {
            try
            {
                if (File.Exists(PathOf)) return WeSettings.Deserialize(File.ReadAllText(PathOf, Encoding.UTF8));
            }
            catch (Exception ex)
            {
                WeLog.Error("prefs", "Тохиргоо уншиж чадсангүй — өгөгдмөлөөр", ex);
            }
            return new WeSettings();
        }

        public static void Save(WeSettings s)
        {
            try
            {
                string path = PathOf;
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                string tmp = path + ".tmp";
                File.WriteAllText(tmp, s.Serialize(), new UTF8Encoding(false));
                if (File.Exists(path)) File.Delete(path);
                File.Move(tmp, path);
            }
            catch (Exception ex)
            {
                WeLog.Error("prefs", "Тохиргоо хадгалж чадсангүй", ex);
            }
        }
    }

    /// <summary>
    /// Анхааруулгыг (warning) диалоггүйгээр нууж ТООЛНО; шийдэгдэхгүй алдааг Revit-ийн цонхгүйгээр буцааж, шалтгааныг хадгална.
    /// </summary>
    internal sealed class WeFailureSwallower : IFailuresPreprocessor
    {
        public int WarningsHidden;
        public string LastError;

        public FailureProcessingResult PreprocessFailures(FailuresAccessor accessor)
        {
            try
            {
                if (!accessor.IsTransactionBeingCommitted()) return FailureProcessingResult.Continue;
            }
            catch
            {
                // Хуучин Revit — доорх замаар.
            }
            bool hasError = false;
            foreach (FailureMessageAccessor f in accessor.GetFailureMessages())
            {
                if (f.GetSeverity() == FailureSeverity.Warning)
                {
                    accessor.DeleteWarning(f);
                    WarningsHidden++;
                }
                else
                {
                    hasError = true;
                    LastError = f.GetDescriptionText();
                }
            }
            return hasError ? FailureProcessingResult.ProceedWithRollBack : FailureProcessingResult.Continue;
        }

        public static WeFailureSwallower Attach(Transaction t)
        {
            var h = new WeFailureSwallower();
            FailureHandlingOptions o = t.GetFailureHandlingOptions();
            o.SetFailuresPreprocessor(h);
            o.SetClearAfterRollback(true);
            t.SetFailureHandlingOptions(o);
            return h;
        }
    }

    /// <summary>Команд ажиллах хугацаанд нэг удаа хэмжинэ.</summary>
    /// <summary>
    /// Title block-ийн зурах талбайн КЭШ (санах ой + диск) — <c>EditFamily</c> бодит загварт 5 с (хэмжсэн, GATEWAY).  Мөр бүр
    /// «түлхүүр \t 8 тоо».  Унших/бичих алдаа хэзээ ч ажиллагааг зогсоохгүй (кэшгүй л болно).
    /// </summary>
    internal static class WeFrameCache
    {
        private static Dictionary<string, double[]> _mem;
        private static string PathOf { get { return Path.Combine(SettingsStore.Dir, "wall-elevation-titleblocks.txt"); } }

        private static Dictionary<string, double[]> Load()
        {
            if (_mem != null) return _mem;
            _mem = new Dictionary<string, double[]>(StringComparer.Ordinal);
            try
            {
                if (!File.Exists(PathOf)) return _mem;
                foreach (string line in File.ReadAllLines(PathOf, Encoding.UTF8))
                {
                    string[] parts = line.Split('\t');
                    if (parts.Length != 2) continue;
                    double[] v = parts[1].Split(';').Select(x => { double d; return double.TryParse(x, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out d) ? d : double.NaN; }).ToArray();
                    if (v.Length == 8 && v.All(d => !double.IsNaN(d) && !double.IsInfinity(d))) _mem[parts[0]] = v;
                }
            }
            catch (Exception ex) { WeLog.Error("sheets", "title block кэш унших", ex); }
            return _mem;
        }

        public static bool TryGet(string key, out double[] frame)
        {
            frame = null;
            return key != null && Load().TryGetValue(key, out frame) && frame != null;
        }

        public static void Put(string key, double[] frame)
        {
            if (key == null || frame == null || frame.Length != 8 || key.IndexOf('\t') >= 0 || key.IndexOf('\n') >= 0) return;
            Load()[key] = (double[])frame.Clone();
            try
            {
                Directory.CreateDirectory(SettingsStore.Dir);
                var sb = new StringBuilder();
                foreach (KeyValuePair<string, double[]> kv in _mem)
                    sb.Append(kv.Key).Append('\t').Append(string.Join(";", kv.Value.Select(d => d.ToString("R", System.Globalization.CultureInfo.InvariantCulture)))).Append('\n');
                File.WriteAllText(PathOf, sb.ToString(), new UTF8Encoding(false));
            }
            catch (Exception ex) { WeLog.Error("sheets", "title block кэш бичих", ex); }
        }
    }

    internal sealed class WeTimings
    {
        private readonly List<KeyValuePair<string, long>> _items = new List<KeyValuePair<string, long>>();

        public IList<KeyValuePair<string, long>> Items { get { return _items; } }

        public T Measure<T>(string stage, Func<T> f)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            try { return f(); }
            finally { Add(stage, sw.ElapsedMilliseconds); }
        }

        public void Measure(string stage, Action a)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            try { a(); }
            finally { Add(stage, sw.ElapsedMilliseconds); }
        }

        public void Add(string stage, long ms)
        {
            for (int i = 0; i < _items.Count; i++)
            {
                if (_items[i].Key == stage)
                {
                    _items[i] = new KeyValuePair<string, long>(stage, _items[i].Value + ms);
                    return;
                }
            }
            _items.Add(new KeyValuePair<string, long>(stage, ms));
        }

        public override string ToString()
        {
            var sb = new StringBuilder();
            foreach (KeyValuePair<string, long> kv in _items)
            {
                if (sb.Length > 0) sb.Append(" · ");
                sb.Append(kv.Key).Append(' ').Append(kv.Value).Append(" мс");
            }
            return sb.ToString();
        }
    }

    /// <summary>Revit-ийн мм ↔ дотоод нэгж — `UnitUtils`-аар (цөм 304.8-ыг өөрөө бичихгүй).</summary>
    internal sealed class WeRevitUnits : IWeUnits
    {
        public double MmToInternal(double mm) { return UnitUtils.ConvertToInternalUnits(mm, UnitTypeId.Millimeters); }
        public double InternalToMeters(double ft) { return UnitUtils.ConvertFromInternalUnits(ft, UnitTypeId.Meters); }
    }

    internal static class WeXyz
    {
        public static XYZ ToXyz(this WeV3 v) { return new XYZ(v.X, v.Y, v.Z); }
        public static WeV3 ToWe(this XYZ p) { return p == null ? WeV3.Zero : new WeV3(p.X, p.Y, p.Z); }
    }
}
