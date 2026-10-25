using System;
using System.Linq;
using System.Reflection;
using Autodesk.Revit.UI;

namespace MglBb.Infra
{
    /// <summary>
    /// Үндсэн MGL plugin-тэй (RevitMcpAddin.dll) ЦОРЫН ГАНЦ холбоос — лицензийн шалгалт.  Reflection-оор: тусдаа plugin үндсэн plugin-ийг
    /// компайлын үед ХАМААРАХГҮЙ (тэр шинэчлэгдэхэд энэ эвдрэхгүй), харин ажиллах үед компанийн бүртгэл + ажлын компьютерын лицензийг
    /// (Licensing/LicenseGate.cs) ЯГ ТЭР журмаар шаардана.  Үндсэн plugin ачаалагдаагүй бол ажиллахгүй (DLL хуулсан ч ашиглагдахгүй).
    /// </summary>
    internal static class MainPlugin
    {
        private const string AssemblyName = "RevitMcpAddin";
        private const string GateType = "RevitMcpAddin.Licensing.LicenseGate";
#if BB_NOLICENSE
        public const bool NoLicense = true;
#else
        public const bool NoLicense = false;
#endif

        public static Assembly Find()
        {
            try
            {
                return AppDomain.CurrentDomain.GetAssemblies()
                    .FirstOrDefault(a => string.Equals(a.GetName().Name, AssemblyName, StringComparison.OrdinalIgnoreCase));
            }
            catch
            {
                return null;
            }
        }

        public static string Version()
        {
            Assembly a = Find();
            if (a == null) return null;
            try
            {
                var info = a.GetCustomAttribute<AssemblyInformationalVersionAttribute>();
                return info?.InformationalVersion ?? a.GetName().Version?.ToString();
            }
            catch
            {
                return null;
            }
        }

        /// <summary>Команд бүрийн эхэнд.  false бол шалтгааныг хэрэглэгчид аль хэдийн хэлсэн.</summary>
        public static bool EnsureLicensed()
        {
#if BB_NOLICENSE
            return true;   // лицензгүй туршилтын багц (package.ps1 -NoLicense)
#else
            Assembly a = Find();
            if (a == null)
            {
                TaskDialog.Show("MGL ББ",
                    "Үндсэн «MGL» plugin ачаалагдаагүй байна.\n\n«MGL ББ» нь компанийн бүртгэл ба лицензийг үндсэн MGL plugin-ээр шалгадаг. " +
                    "MGL plugin-ийг суулгаад Revit-ийг дахин нээнэ үү.");
                return false;
            }
            try
            {
                Type t = a.GetType(GateType, false);
                MethodInfo m = t?.GetMethod("Ensure", BindingFlags.Public | BindingFlags.Static, null, Type.EmptyTypes, null);
                if (m == null)
                {
                    TaskDialog.Show("MGL ББ", "Үндсэн MGL plugin-ий хувилбар (" + (Version() ?? "?") + ") лицензийн шалгалтгүй байна — MGL plugin-ийг шинэчилнэ үү.");
                    return false;
                }
                object r = m.Invoke(null, null);
                return r is bool b && b;
            }
            catch (TargetInvocationException ex)
            {
                TaskDialog.Show("MGL ББ", "Лицензийн шалгалт унав:\n\n" + (ex.InnerException?.Message ?? ex.Message));
                return false;
            }
            catch (Exception ex)
            {
                TaskDialog.Show("MGL ББ", "Лицензийн шалгалт унав:\n\n" + ex.Message);
                return false;
            }
#endif
        }
    }
}
