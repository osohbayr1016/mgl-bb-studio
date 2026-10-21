using System;
using System.IO;
using System.Reflection;
using System.Windows.Media.Imaging;
using Autodesk.Revit.UI;
using MglBb.Infra;

namespace MglBb
{
    /// <summary>
    /// «MGL ББ» — тусдаа ribbon таб.  Үндсэн MGL plugin-ий табыг («MGL») ХӨНДӨХГҮЙ.  OnStartup юу ч уншихгүй, ямар ч event бүртгэхгүй —
    /// товч дарах хүртэл энэ plugin Revit-ийн ажилд оролцохгүй (үндсэн plugin-д нөлөөлөх зүйл байхгүй).
    /// </summary>
    public sealed class App : IExternalApplication
    {
        public const string TabName = "MGL ББ";
        internal static string AssemblyPath;
        internal static UIControlledApplication Ui;

        public Result OnStartup(UIControlledApplication application)
        {
            Ui = application;
            AssemblyPath = Assembly.GetExecutingAssembly().Location;
            try
            {
                try { application.CreateRibbonTab(TabName); }
                catch (Autodesk.Revit.Exceptions.ArgumentException) { /* таб аль хэдийн бий */ }

                RibbonPanel drawings = application.CreateRibbonPanel(TabName, "Ажлын зураг");
                Add(drawings, "MglBbGenerate", "Ажлын зураг\nүүсгэх", typeof(Commands.GenerateCommand), "Г",
                    "Арматуртай дамнуруу, багана, цутгамал хана (ЦХ), хучилтын (түвшнээр) ажлын зургийг сурсан стандартаар үүсгэж хэмжээс, шошго, MRA тавина, хуудсанд байрлуулж түүврийг хувилна.");
                Add(drawings, "MglBbAnnotate", "Стандартаар\nтэмдэглэх", typeof(Commands.AnnotateCommand), "Т",
                    "Идэвхтэй (эсвэл сонгосон) огтлол, дэлгээс, хучилтын төлөвлөгөөнд хэмжээс, шошго, MRA-г сурсан стандартаар тавина (өмнөхийг солино).");
                Add(drawings, "MglBbBreaks", "Break\nline", typeof(Commands.BreakCommand), "≈",
                    "Дамнурууны огтлол: crop-ын зүүн/баруун ирмэгийг дайрсан хучилтад; дэлгээс: ирмэгийг дайрсан дамнуруу, баганад «DET-Symbol_Break_Line» тавина (өмнөхийг солино, гараар тавьсныг хөндөхгүй).");
                Add(drawings, "MglBbEndSymbols", "Төгсгөлийн\nтэмдэг", typeof(Commands.EndSymbolCommand), "Ө",
                    "Дамнурууны дэлгээсэд арматурын төгсгөлийн тэмдгийг «Стандарт сурах»-аар сурсан дүрмээр тавина (тэмдэг, үе, ширхэг, эргэлт; өмнөхийг солино, гараар тавьсныг хөндөхгүй).");
                Add(drawings, "MglBbSchedules", "Түүвэр\nүүсгэх", typeof(Commands.ScheduleCommand), "Ү",
                    "Сонгосон дамнуруу, багана, ханын бетон ба арматурын түүврийг төсөлд байгаа өөр гишүүний түүврээс хувилж (нэр, шүүлтүүрийн тэмдэг сольж) хуудсанд байрлуулна.");

                RibbonPanel learn = application.CreateRibbonPanel(TabName, "Стандарт");
                Add(learn, "MglBbLearn", "Стандарт\nсурах", typeof(Commands.LearnCommand), "С",
                    "Энэ төслийн аль хэдийн зурсан дамнуруу, багана, хана, хучилтын ажлын зургаас (дэлгээс, огтлол, хуудас, түүвэр) зургийн стандартыг уншиж хадгална.");
                Add(learn, "MglBbSettings", "Тохиргоо", typeof(Commands.SettingsCommand), "⚙",
                    "Ажлын зураг ба стандартаар тэмдэглэхэд хэрэглэх арматурын шошго, хомутын шошго, MRA-ийн төрлийн option.  «Үндсэн» = сурсан стандарт; шинэ option үүсгэж хадгалаад төсөл бүрт өөр option сонгож болно.");
                Add(learn, "MglBbIssues", "Асуудал\nШийдэл", typeof(Commands.IssuesCommand), "А",
                    "«Асуудал – Шийдэл» Excel: шийдэгдээгүй мөр бүрийн харагдац руу очих, «Шийдсэн» болгох, Excel нээх.");
            }
            catch (Exception ex)
            {
                // Ribbon үүсгэж чадсангүй — Revit-ийг саатуулахгүй, үндсэн plugin-д нөлөөлөхгүй.
                try { File.AppendAllText(Path.Combine(Paths.Root, "startup-error.txt"), DateTime.Now.ToString("o") + " " + ex + Environment.NewLine); }
                catch { }
            }
            return Result.Succeeded;
        }

        public Result OnShutdown(UIControlledApplication application) { return Result.Succeeded; }

        private static void Add(RibbonPanel panel, string name, string text, Type command, string glyph, string tooltip)
        {
            var data = new PushButtonData(name, text, AssemblyPath, command.FullName)
            {
                ToolTip = tooltip,
                LargeImage = Icons.Glyph(glyph, 32),
                Image = Icons.Glyph(glyph, 16),
            };
            panel.AddItem(data);
        }
    }

    internal static class Paths
    {
        public static string Root
        {
            get
            {
                string d = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "MGL", "BbStudio");
                try { Directory.CreateDirectory(d); } catch { }
                return d;
            }
        }
    }
}
