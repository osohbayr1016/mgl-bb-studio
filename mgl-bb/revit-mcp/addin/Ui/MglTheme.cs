using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin.Ui
{
    /// <summary>
    /// MGL цонх/самбарт ДУНДЫН сэдэв (Light / Dark / Өндөр контраст) өгнө.
    ///
    ///  • ⚠️ `Application.Current` / `Application.Resources`-ийг ХЭЗЭЭ Ч ХӨНДӨХГҮЙ — токен, загварыг ЗӨВХӨН
    ///    тухайн цонх/самбарын ӨӨРИЙН `Resources`-д нэмнэ (Revit, бусад add-in-д нөлөөлөхгүй).
    ///  • Сэдэв: Windows-ийн өндөр контраст &gt; Revit-ийн сэдэв (`SetRevitThemeProvider`) &gt; цайвар.
    ///  • Токен `DynamicResource` тул сэдэв солигдоход нээлттэй цонх шууд дахин будагдана (`Refresh`).
    ///  • `MglControls.xaml` ачаалагдаагүй бол (`MglStyles.LastError`) токен л тавигдана (implicit загвар үгүй) — `Apply` нь false буцаана.
    /// </summary>
    internal static class MglTheme
    {
        private const string MarkerKey = "__MglTokens";
        private static readonly object Gate = new object();
        private static readonly List<WeakReference<FrameworkElement>> Roots = new List<WeakReference<FrameworkElement>>();
        private static bool _hooked;
        private static Func<string> _revitTheme;

        /// <summary>`App` нь Revit-ийн `UIThemeManager.CurrentTheme`-ийг «Dark»/«Light» гэж буцаах функц тавина.</summary>
        internal static void SetRevitThemeProvider(Func<string> provider)
        {
            _revitTheme = provider;
        }

        internal static MglThemeMode Resolve()
        {
            bool hc = false;
            string revit = null;
            try { hc = SystemParameters.HighContrast; } catch { /* мэдэгдэхгүй — цайвар */ }
            try { Func<string> p = _revitTheme; if (p != null) revit = p(); } catch { /* мэдэгдэхгүй */ }
            return MglThemeResolver.Resolve(hc, revit);
        }

        /// <summary>
        /// Цонх/самбарт токен + загвар нэмж, суурь өнгийг тавина.  Давтан дуудахад аюулгүй.
        /// <paramref name="baseFontSize"/> &gt; 0 бол Window/UserControl-ийн FontSize-г тавина (өгөгдмөл 13).
        /// Буцаах: хуваалцсан загвар (MglControls) ТАВИГДСАН эсэх (токен үргэлж тавигдана).
        /// </summary>
        internal static bool Apply(FrameworkElement root, double baseFontSize = 13.0)
        {
            if (root == null) return false;
            try
            {
                // Токен нь палитраас (WPF-гүй) — загвар ачаалагдаагүй ч ҮРГЭЛЖ тавина: самбарууд (WorkPane, MglAssistant,
                // Intelligence) өөрийн local загвартаа `DynamicResource Bg/Fg/…` хэрэглэдэг тул токенгүй бол ил тод дэвсгэр
                // дээр хар бичвэр болно.  Харин `MglControls.xaml` (implicit загвар) унавал зөвхөн системийн анхдагч товч/талбар.
                ResourceDictionary styles = MglStyles.Get();

                ResourceDictionary tokens = FindTokens(root);
                if (tokens == null)
                {
                    tokens = new ResourceDictionary();
                    tokens[MarkerKey] = true;
                    root.Resources.MergedDictionaries.Add(tokens);
                }
                if (styles != null && !root.Resources.MergedDictionaries.Contains(styles))
                    root.Resources.MergedDictionaries.Add(styles);
                FillTokens(tokens, Resolve());

                var control = root as Control;
                if (control != null)
                {
                    control.SetResourceReference(Control.BackgroundProperty, "Bg");
                    control.SetResourceReference(Control.ForegroundProperty, "Fg");
                    if (baseFontSize > 0) control.FontSize = baseFontSize;
                }
                else
                {
                    root.SetResourceReference(System.Windows.Documents.TextElement.ForegroundProperty, "Fg");
                }

                Register(root);
                return styles != null;
            }
            catch (Exception ex)
            {
                MglStyles_RecordFailure(ex);
                return false;
            }
        }

        // ── Сэдэв солигдсон мэдэгдэл ───────────────────────────────────────

        /// <summary>Revit-ийн `ThemeChanged` үед `RevitThemeBridge` дууддаг.</summary>
        internal static void NotifyRevitThemeChanged()
        {
            Refresh();
        }

        /// <summary>Бүртгэлтэй бүх нээлттэй цонхны токеныг одоогийн сэдвээр дахин бодно.</summary>
        internal static void Refresh()
        {
            List<FrameworkElement> alive = SnapshotAlive();
            foreach (FrameworkElement el in alive)
            {
                FrameworkElement target = el;
                try
                {
                    target.Dispatcher.BeginInvoke(new Action(() =>
                    {
                        try
                        {
                            ResourceDictionary tokens = FindTokens(target);
                            if (tokens != null) FillTokens(tokens, Resolve());
                        }
                        catch { /* нэг цонх унавал бусдыг хөндөхгүй */ }
                    }));
                }
                catch { /* цонх хаагдсан */ }
            }
        }

        // ── Токен ──────────────────────────────────────────────────────

        private static void FillTokens(ResourceDictionary d, MglThemeMode mode)
        {
            MglBrushes.Update(mode);   // кодоор угсарсан цонхны live brush-ууд (RfUi, UiKit) сэдвийг дагана
            IReadOnlyDictionary<string, string> map = MglPalette.For(mode);
            foreach (string key in MglPalette.Keys)
                d[key] = map != null ? (object)FrozenBrush(map[key]) : SystemBrushFor(key);
        }

        private static Brush FrozenBrush(string hex)
        {
            int r, g, b;
            if (!MglContrast.TryParseHex(hex, out r, out g, out b)) return Brushes.Magenta;   // тест хаадаг — харагдахуйц алдаа
            var brush = new SolidColorBrush(Color.FromRgb((byte)r, (byte)g, (byte)b));
            brush.Freeze();
            return brush;
        }

        /// <summary>Өндөр контраст: өнгийг СИСТЕМЭЭС.  Утга өнгөөр ГАНЦААРАА илэрдэггүй (дүрс + бичвэр хамт).</summary>
        private static Brush SystemBrushFor(string key)
        {
            switch (key)
            {
                case "Fg": case "FgMuted": case "Line": case "LineStrong":
                case "Ok": case "Warn": case "Danger": case "Info":
                    return SystemColors.WindowTextBrush;
                case "FgDisabled":
                    return SystemColors.GrayTextBrush;
                case "Accent":
                    return SystemColors.HotTrackBrush;
                case "Hover": case "Pressed": case "Selected":
                    return SystemColors.HighlightBrush;
                case "HoverFg": case "PressedFg": case "SelectedFg":
                    return SystemColors.HighlightTextBrush;
                default:   // Bg, BgRaised, BgInput, AccentFg, AccentSoft, AccentDim, OkBg, WarnBg, DangerBg, InfoBg
                    return SystemColors.WindowBrush;
            }
        }

        private static ResourceDictionary FindTokens(FrameworkElement root)
        {
            foreach (ResourceDictionary d in root.Resources.MergedDictionaries)
                if (d.Contains(MarkerKey)) return d;
            return null;
        }

        // ── Бүртгэл ────────────────────────────────────────────────────

        private static void Register(FrameworkElement root)
        {
            lock (Gate)
            {
                Roots.RemoveAll(w => { FrameworkElement t; return !w.TryGetTarget(out t); });
                foreach (WeakReference<FrameworkElement> w in Roots)
                {
                    FrameworkElement t;
                    if (w.TryGetTarget(out t) && ReferenceEquals(t, root)) { EnsureHooks(); return; }
                }
                Roots.Add(new WeakReference<FrameworkElement>(root));
                EnsureHooks();
            }
        }

        private static List<FrameworkElement> SnapshotAlive()
        {
            var list = new List<FrameworkElement>();
            lock (Gate)
            {
                foreach (WeakReference<FrameworkElement> w in Roots)
                {
                    FrameworkElement t;
                    if (w.TryGetTarget(out t)) list.Add(t);
                }
            }
            return list;
        }

        private static void EnsureHooks()
        {
            if (_hooked) return;
            _hooked = true;
            try
            {
                SystemParameters.StaticPropertyChanged += (s, e) =>
                {
                    // Өндөр контраст болон системийн өнгө солигдоход.
                    if (e == null) return;
                    string n = e.PropertyName;
                    if (n == "HighContrast" || n == "WindowGlassColor" || string.IsNullOrEmpty(n)) Refresh();
                };
            }
            catch { /* hook тавигдаагүй ч Apply ажиллана */ }
        }

        private static void MglStyles_RecordFailure(Exception ex)
        {
            // Тусгай лог системгүй (SettingsStore-ийн хажууд) — Debug гаралтад л.
            System.Diagnostics.Debug.WriteLine("[MglTheme] Apply унав: " + ex.GetType().Name + ": " + ex.Message);
        }
    }
}
