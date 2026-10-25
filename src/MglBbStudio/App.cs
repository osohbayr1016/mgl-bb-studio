using System;
using System.IO;
using System.Reflection;
using System.Windows.Media.Imaging;
using Autodesk.Revit.UI;
using MglBb.Infra;

namespace MglBb
{
    /// <summary>
    /// «MGL ББ» — тусдаа ribbon таб.  Үндсэн MGL plugin-ий табыг («MGL») ХӨНДӨХГҮЙ.  OnStartup юу ч уншихгүй; ЦОРЫН ГАНЦ байнгын event =
    /// «Устгалтын анхааруулга» (<see cref="RevitSide.BbDeleteWatch"/>) — бусад нь товч дарах хүртэл Revit-ийн ажилд оролцохгүй.
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
                Add(drawings, "MglBbMarkTidy", "Хамааралгүй\nтэмдэг нуух", typeof(Commands.MarkTidyCommand), "Н",
                    "Дэлгээс (сонгосон / идэвхтэй; сонгоогүй бол төслийн бүх дэлгээс) бүрт тэр гишүүнд хамааралгүй огтлол, хэсэглэлийн тэмдгийг нууна.  Нэрэнд гишүүний тэмдэгтэй, эсвэл ижил хуудсанд байрласан харагдацынх үлдэнэ.  «Ажлын зураг үүсгэх» үүнийг автоматаар хийдэг.");
                Add(drawings, "MglBbEndSymbols", "Төгсгөлийн\nтэмдэг", typeof(Commands.EndSymbolCommand), "Ө",
                    "Дамнурууны дэлгээсэд арматурын төгсгөлийн тэмдгийг «Стандарт сурах»-аар сурсан дүрмээр тавина (тэмдэг, үе, ширхэг, эргэлт; өмнөхийг солино, гараар тавьсныг хөндөхгүй).");
                Add(drawings, "MglBbDimLine", "Шугамаар\nхэмжээс", typeof(Commands.DimLineCommand), "↔",
                    "Хоёр цэгээр шугам заахад түүнийг огтолсон элементүүдийн (тохиргооны ангилал: багана, хана, дамнуруу, тэнхлэг, түвшин …) нүүр / төвд нэг хэмжээсийн гинж тавина.  Нэрлэсэн тохиргоо хэдэн ч үүсгэж болно; «Давтах» бол Esc дарах хүртэл.");
                Add(drawings, "MglBbSchedules", "Түүвэр\nүүсгэх", typeof(Commands.ScheduleCommand), "Ү",
                    "Сонгосон дамнуруу, багана, ханын бетон ба арматурын түүврийг төсөлд байгаа өөр гишүүний түүврээс хувилж (нэр, шүүлтүүрийн тэмдэг сольж) хуудсанд байрлуулна.");

                RibbonPanel model = application.CreateRibbonPanel(TabName, "Арматур");
                Add(model, "MglBbBeamRebar", "Дамнурууны\nарматур", typeof(Commands.BeamRebarCommand), "Д",
                    "Төмөр бетон дамнуруунд (олон алгаслын, туслах дамнуруутай) арматур үүсгэнэ: компанийн хэв маяг (ЖИШЭЭ-1) эсвэл СП 52-101, LIRA-ийн As-аас санал.  " +
                    "Дахин ажиллуулахад өмнө үүсгэсэн арматурыг солино; гараар тавьсныг хөндөхгүй (сонголтоор солино).");
                Add(model, "MglBbColumnRebar", "Баганын\nарматур", typeof(Commands.ColumnRebarCommand), "Б",
                    "Төмөр бетон баганад (давхар бүрийн элемент) арматур үүсгэнэ: ажлын арматур периметрээр (дээд давхартай давхцал эсвэл зангилаанд L), " +
                    "гадна битүү хомут + C-хомут, доод / дээд нягт бүс.  Өмнө үүсгэснийг солино; гараар тавьсныг хөндөхгүй.");
                Add(model, "MglBbHostFix", "Хост\nзасах", typeof(Commands.HostFixCommand), "Х",
                    "Арматур буруу гишүүнд хостлогдсон бол (жишээ нь туслах дамнурууны арматур тулгуур дамнуруунд) дэлгээс түүнийг харуулдаггүй.  " +
                    "Сонгосон арматур / гишүүд, эсвэл идэвхтэй огтлол, дэлгээсийн гишүүд (сонгоогүй бол бүх загвар) — арматурын тэнхлэг аль гишүүнд " +
                    "багтсанаар зөв хостыг олж, жагсаалтаар баталгаажуулаад шилжүүлнэ.");

                RibbonPanel tools = application.CreateRibbonPanel(TabName, "Шүүлт");
                Add(tools, "MglBbFilter", "Параметрээр\nшүүх", typeof(Commands.FilterCommand), "Ш",
                    "Нэрлэсэн шүүлтүүр (ангилал, ≤ 3 параметрийн нөхцөл, харагдацын төрөл) хадгалж, идэвхтэй харагдацын элементүүдийг нэг товшилтоор сонгоно эсвэл түр тусгаарлана.  Цонх нээлттэй үлдэнэ.");

                RibbonPanel watch = application.CreateRibbonPanel(TabName, "Хамтын ажил");
                Add(watch, "MglBbDeleteLog", "Устгалтын\nтүүх", typeof(Commands.DeleteLogCommand), "У",
                    "Загварт бүртгэгдсэн устгалт: аль элементийг хэн, хэзээ устгасан.  Delete дарахад анхааруулж, устгалтыг загварт бичнэ — Synchronize хийсний дараа хамт ажилладаг бүх хүнд «… элементийг … устгалаа» гэж мэдэгдэнэ.");

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
            try { RevitSide.BbDeleteWatch.Init(application); }
            catch (Exception ex)
            {
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
