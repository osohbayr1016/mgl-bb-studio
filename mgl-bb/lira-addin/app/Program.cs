using System;
using System.IO;
using System.Windows.Forms;
using MglLiraReport.Docx;
using MglLiraReport.Model;
using MglLiraReport.UI;

namespace MglReportEditor
{
    static class Program
    {
        /// <summary>
        ///   MglReportEditor.exe                       — засварлагч
        ///   MglReportEditor.exe тайлан.mglrep         — файлыг нээнэ
        ///   MglReportEditor.exe --export in.mglrep out.docx — цонхгүйгээр Word гаргана (шалгалт, багц)
        /// </summary>
        [STAThread]
        static int Main(string[] args)
        {
            if (args.Length == 3 && args[0] == "--export")
            {
                try
                {
                    new DocxBuilder(ReportFile.Load(args[1])).Save(args[2]);
                    return 0;
                }
                catch (Exception ex)
                {
                    File.WriteAllText(args[2] + ".error.txt", ex.ToString());
                    return 1;
                }
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var form = new ReportEditorForm(null);
            if (args.Length == 1 && File.Exists(args[0])) form.Shown += (s, e) => form.OpenPath(args[0]);
            Application.Run(form);
            return 0;
        }
    }
}
