using System;
using Autodesk.Revit.UI;
using RevitMcpAddin.Smart.Core;

namespace RevitMcpAddin.Smart
{
    /// <summary>
    /// «MGL Smart» дэд системийн ГАНЦ орох/гарах цэг — `App.OnStartup` / `OnShutdown` нь ЗӨВХӨН
    /// энийг дуудна (`#if MGL_SMART`).  Дэд систем бүрийн (Impact capture г.м.) асаалт энд.
    ///
    /// ⚠️ ТУСДАА try: нэг дэд системийн уналт add-in-ийг ачаалагдахгүй болгох ёсгүй
    /// (App.cs дахь бусад host-тай ижил дүрэм).  Бүртгэл унавал Smart товчнууд алдаагаа
    /// өөрсдөө хэлнэ; Revit болон бусад товч хэвийн ажиллана.
    /// </summary>
    internal static class SmartHost
    {
        private static bool _started;

        internal static void Init(UIControlledApplication application)
        {
            if (_started) return;
            _started = true;

            try { SmartExecutor.Init(); }
            catch (Exception ex) { SmartLog.Error("host", "executor_init_failed", ex); }

            try { ModelChangeCounter.Init(application.ControlledApplication); }
            catch (Exception ex) { SmartLog.Error("host", "change_counter_init_failed", ex); }

            // Өөрчлөлтийн нөлөөллийн БҮРТГЭЛ — handler нь зөвхөн id хуулдаг (ImpactCapture-ийн тайлбар).
            try { ChangeImpact.ImpactCapture.Init(application.ControlledApplication); }
            catch (Exception ex) { SmartLog.Error("host", "impact_capture_init_failed", ex); }

            SmartLog.Info("host", "started", new { rev = application.ControlledApplication.VersionNumber });
        }

        internal static void Shutdown()
        {
            if (!_started) return;
            _started = false;

            try { ChangeImpact.PreChangeGhost.Shutdown(); } catch (Exception) { }
            try { ChangeImpact.ImpactCapture.Shutdown(); } catch (Exception) { }
            try { ModelChangeCounter.Shutdown(); } catch (Exception) { }
            try { SmartWindows.CloseAll(); } catch (Exception) { }
            try { SmartExecutor.Shutdown(); } catch (Exception) { }
            SmartLog.Info("host", "stopped");
            SmartLog.Flush(800);
        }
    }
}
