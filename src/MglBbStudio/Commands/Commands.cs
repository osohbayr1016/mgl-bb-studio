using System;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using MglBb.Infra;

namespace MglBb.Commands
{
    /// <summary>Бүх командын нийтлэг эхлэл: лиценз (үндсэн plugin-оор), баримт нээлттэй эсэх, барьж авсан алдааг ойлгомжтой хэлэх.</summary>
    internal static class CommandGuard
    {
        public static bool Begin(ExternalCommandData data, out UIDocument uidoc)
        {
            uidoc = data?.Application?.ActiveUIDocument;
            if (uidoc == null || uidoc.Document == null)
            {
                TaskDialog.Show("MGL ББ", "Revit-д төсөл нээгээгүй байна.");
                return false;
            }
            if (uidoc.Document.IsFamilyDocument)
            {
                TaskDialog.Show("MGL ББ", "Family файлд ажиллахгүй — төслийн файл нээнэ үү.");
                return false;
            }
            return MainPlugin.EnsureLicensed();
        }

        public static Result Fail(string tool, Exception ex)
        {
            TaskDialog td = new TaskDialog("MGL ББ — " + tool)
            {
                MainInstruction = "Хэрэгсэл алдаатай зогслоо — загварт юу ч өөрчлөгдөөгүй (бүх өөрчлөлт буцаагдсан).",
                MainContent = ex.Message,
                ExpandedContent = ex.ToString(),
            };
            td.Show();
            return Result.Failed;
        }
    }

    [Transaction(TransactionMode.Manual)]
    public sealed class LearnCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            if (!CommandGuard.Begin(commandData, out UIDocument uidoc)) return Result.Cancelled;
            try { return Learn.LearnFlow.Run(uidoc); }
            catch (Exception ex) { return CommandGuard.Fail("Стандарт сурах", ex); }
        }
    }

    [Transaction(TransactionMode.Manual)]
    public sealed class GenerateCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            if (!CommandGuard.Begin(commandData, out UIDocument uidoc)) return Result.Cancelled;
            try { return Generate.GenerateFlow.Run(uidoc); }
            catch (Exception ex) { return CommandGuard.Fail("Ажлын зураг үүсгэх", ex); }
        }
    }

    [Transaction(TransactionMode.Manual)]
    public sealed class ScheduleCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            if (!CommandGuard.Begin(commandData, out UIDocument uidoc)) return Result.Cancelled;
            try { return Schedules.ScheduleFlow.Run(uidoc); }
            catch (Exception ex) { return CommandGuard.Fail("Түүвэр үүсгэх", ex); }
        }
    }

    [Transaction(TransactionMode.Manual)]
    public sealed class AnnotateCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            if (!CommandGuard.Begin(commandData, out UIDocument uidoc)) return Result.Cancelled;
            try { return Annotate.AnnotateFlow.Run(uidoc); }
            catch (Exception ex) { return CommandGuard.Fail("Стандартаар тэмдэглэх", ex); }
        }
    }

    [Transaction(TransactionMode.Manual)]
    public sealed class BreakCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            if (!CommandGuard.Begin(commandData, out UIDocument uidoc)) return Result.Cancelled;
            try { return Breaks.BreakFlow.Run(uidoc); }
            catch (Exception ex) { return CommandGuard.Fail("Break line", ex); }
        }
    }

    [Transaction(TransactionMode.Manual)]
    public sealed class EndSymbolCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            if (!CommandGuard.Begin(commandData, out UIDocument uidoc)) return Result.Cancelled;
            try { return EndSymbols.EndSymbolFlow.Run(uidoc); }
            catch (Exception ex) { return CommandGuard.Fail("Төгсгөлийн тэмдэг", ex); }
        }
    }

    [Transaction(TransactionMode.Manual)]
    public sealed class SettingsCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            if (!CommandGuard.Begin(commandData, out UIDocument uidoc)) return Result.Cancelled;
            try { return Settings.SettingsFlow.Run(uidoc); }
            catch (Exception ex) { return CommandGuard.Fail("Тохиргоо", ex); }
        }
    }

    [Transaction(TransactionMode.Manual)]
    public sealed class IssuesCommand : IExternalCommand
    {
        public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
        {
            if (!CommandGuard.Begin(commandData, out UIDocument uidoc)) return Result.Cancelled;
            try { return Issues.IssuesFlow.Run(uidoc); }
            catch (Exception ex) { return CommandGuard.Fail("Асуудал – Шийдэл", ex); }
        }
    }
}
