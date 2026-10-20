using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Autodesk.Revit.UI;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin.Ui.Revit
{
    internal sealed class LaunchResult
    {
        public bool Ok;
        public string Message;
        public string UsedId;
    }

    /// <summary>
    /// Бүртгэлтэй MGL командыг ribbon-ийн команд ID-аар `UIApplication.PostCommand`-оор ажиллуулна.
    ///
    ///  • ⚠️ `IExternalCommand.Execute`-ийг ХЭЗЭЭ Ч шууд дууддаггүй, `ExternalCommandData` зохиодоггүй, UI товч
    ///    «дарж» дууриадаггүй.  Revit өөрөө команд эхлүүлэхэд тухайн команд ӨӨРИЙН лиценз/идэвхжилт/харагдацын
    ///    шалгалтыг хийнэ — каталогт харагдах нь эрх олгох ГЭСЭН ҮГ БИШ.
    ///  • `PostCommand` нь «нэг л команд дараалалд байж болно» гэсэн хязгаартай: `CanPostCommand` шалгаж,
    ///    `InvalidOperationException`-ийг ТАЙЛБАРЛАНА.  `CanPostCommand` ганцаараа БҮРЭН шалгалт БИШ —
    ///    команд бодитоор эхлэх үед контекстыг дахин шалгах нь тэр командын үүрэг (availability + Execute guard).
    ///  • ⚠️ ID таамаг БАТАЛГААЖААГҮЙ (docs §5.3): `LookupCommandId` null буцаавал ТАЙЛБАРТАЙ татгалзаж,
    ///    оролдсон ID-г `%APPDATA%\RevitMcpAddin\ribbon-ids.log`-д бичнэ — амьд Revit дээр шалгахад хэрэгтэй.
    /// </summary>
    internal static class ToolLauncher
    {
        private static readonly object Gate = new object();
        private sealed class Placement
        {
            public ToolDiscipline Discipline;   // None = нийтлэг самбар
            public List<string> Ids;
        }

        /// <summary>Хэрэгсэл → ribbon дээрх байрлал(ууд).  Олон салбарт давтагдсан хэрэгсэлд салбар бүрт нэг.</summary>
        private static readonly Dictionary<string, List<Placement>> Candidates = new Dictionary<string, List<Placement>>(StringComparer.Ordinal);

        /// <summary>
        /// Ribbon-д товч нэмэх бүрд `RibbonBuilder` дуудна.  `buttonName` = `PushButtonData.Name` (олон салбарт давтагдсан
        /// хэрэгсэлд `Name_салбар` байж болно — `RibbonPlan.ButtonName`).
        /// </summary>
        internal static void Register(string toolName, string buttonName, string tab, string panelTitle, string pulldownName, ToolDiscipline discipline)
        {
            if (string.IsNullOrEmpty(toolName)) return;
            if (string.IsNullOrEmpty(buttonName)) buttonName = toolName;
            var ids = new List<string> { RibbonIds.Predict(tab, panelTitle, pulldownName, buttonName) };
            if (string.IsNullOrEmpty(pulldownName))
            {
                // Stack доторх товчны ID хэлбэр баталгаагүй — нэмэлт таамаг (олдсон нь шалгагдана).
                ids.Add("CustomCtrl_%CustomCtrl_%CustomCtrl_%" + tab + "%" + panelTitle + "%" + buttonName);
            }
            lock (Gate)
            {
                List<Placement> list;
                if (!Candidates.TryGetValue(toolName, out list)) Candidates[toolName] = list = new List<Placement>();
                list.RemoveAll(p => p.Discipline == discipline);
                list.Add(new Placement { Discipline = discipline, Ids = ids });
            }
        }

        internal static bool IsRegistered(string toolName)
        {
            lock (Gate) return !string.IsNullOrEmpty(toolName) && Candidates.ContainsKey(toolName);
        }

        internal static LaunchResult TryPost(UIApplication uiApp, ToolMeta tool)
        {
            if (uiApp == null || tool == null) return Fail("Revit-ийн контекст олдсонгүй.");

            List<string> ids;
            lock (Gate)
            {
                List<Placement> placements;
                if (!Candidates.TryGetValue(tool.Name, out placements) || placements.Count == 0)
                    return Fail("«" + tool.LabelOneLine + "» энэ Revit-ийн ribbon дээр бүртгэгдээгүй байна.");
                // Ажилтны салбарын (харагдаж буй) байрлал түрүүлнэ — салбарын хувилбартай хэрэгсэлд зөв хувилбар нээгдэнэ.
                ToolDiscipline active = RibbonDisciplines.Active;
                ids = placements
                    .OrderBy(p => p.Discipline == ToolDiscipline.None || ToolDisciplines.IsAll(active) || (p.Discipline & active) != 0 ? 0 : 1)
                    .SelectMany(p => p.Ids).ToList();
            }

            RevitCommandId command = null;
            string used = null;
            foreach (string id in ids)
            {
                try
                {
                    command = RevitCommandId.LookupCommandId(id);
                }
                catch (Exception ex)
                {
                    Log(tool.Name, id, "lookup throw: " + ex.GetType().Name);
                    command = null;
                }
                Log(tool.Name, id, command == null ? "олдсонгүй" : "олдлоо");
                if (command != null) { used = id; break; }
            }

            if (command == null)
                return Fail("Revit «" + tool.LabelOneLine + "» командыг олсонгүй (ribbon-ы бүтэц саяхан өөрчлөгдсөн байж болзошгүй). "
                    + "Ribbon дээрх товчийг шууд дарна уу.");

            try
            {
                if (!uiApp.CanPostCommand(command))
                    return Fail("Одоо «" + tool.LabelOneLine + "» командыг дараалалд оруулах боломжгүй байна. "
                        + "Өөр команд ажиллаж байвал дуусгаад (эсвэл Esc дараад) дахин оролдоно уу.");

                uiApp.PostCommand(command);
                return new LaunchResult { Ok = true, UsedId = used };
            }
            catch (Autodesk.Revit.Exceptions.InvalidOperationException)
            {
                // «Өөр команд аль хэдийн дараалалд орсон» — Revit-ийн баримтжуулсан хязгаарлалт.
                return Fail("Өөр команд аль хэдийн дараалалд орсон байна. Түр хүлээгээд дахин оролдоно уу.");
            }
            catch (Exception ex)
            {
                Log(tool.Name, used, "post throw: " + ex.GetType().Name + ": " + ex.Message);
                return Fail("Командыг эхлүүлж чадсангүй: " + ex.Message);
            }
        }

        private static LaunchResult Fail(string message)
        {
            return new LaunchResult { Ok = false, Message = message };
        }

        private static void Log(string tool, string id, string result)
        {
            try
            {
                string path = Path.Combine(SettingsStore.Dir, "ribbon-ids.log");
                Directory.CreateDirectory(SettingsStore.Dir);
                // Хязгааргүй өсөхөөс сэргийлнэ.
                FileInfo fi = new FileInfo(path);
                if (fi.Exists && fi.Length > 200 * 1024) File.Delete(path);
                File.AppendAllText(path, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + tool + "  " + id + "  → " + result + Environment.NewLine);
            }
            catch
            {
                // Лог бичигдэхгүй байх нь ажиллагаанд нөлөөлөхгүй.
            }
        }
    }
}
