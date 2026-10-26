using System;
using Autodesk.Revit.UI;

namespace MglBb
{
    /// <summary>
    /// mgl-e-c-ийн үндсэн MGL plugin (RevitMcpAddin) энэ DLL-ийг «Бүтээц» самбарын товчнуудаар ачаалдаг — тэнд энэ assembly-ийн
    /// <see cref="App"/> (IExternalApplication) ажилладаггүй тул байнгын event-ийг (<see cref="RevitSide.BbDeleteWatch"/>) үндсэн plugin
    /// Revit асахад ЭНЭ оролтоор асаана: reflection-оор, НЭРЭЭР (компайлын лавлагаагүй).  Нэр, сигнатурыг солибол mgl-e-c-ийн
    /// `addin/Ui/Revit/BbStudioHost.cs`-ийг дагуулж засна.  Тусдаа «MGL ББ» суулгацад <see cref="App.OnStartup"/> өөрөө асаадаг.
    /// </summary>
    public static class HostHooks
    {
        /// <summary>«Устгалтын анхааруулга»-ыг асаана.  Амжилттай бол null, унавал шалтгаан (Revit-ийн ажлыг хэзээ ч саатуулахгүй).</summary>
        public static string StartDeleteWatch(UIControlledApplication application)
        {
            try
            {
                RevitSide.BbDeleteWatch.Init(application);
                return null;
            }
            catch (Exception ex)
            {
                return ex.Message;
            }
        }
    }
}
