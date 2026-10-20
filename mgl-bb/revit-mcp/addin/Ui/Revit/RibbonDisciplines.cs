using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Threading;
using Autodesk.Revit.UI;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin.Ui.Revit
{
    /// <summary>
    /// Туузан цэсийг ажилтны САЛБАРААР шүүнэ (2026-10-13).  Дүрэм нь `Ui/Core/ToolDiscipline.cs` + `RibbonPlan`-д (цэвэр,
    /// тесттэй); энд зөвхөн Revit-ийн САЛБАРЫН самбаруудын `Visible`-ийг тавина.
    ///
    ///  • Салбарын хэрэгсэл зөвхөн салбарын самбарт (Архитектур / Интерьер / Бүтээц / Инженерийн шугам) байрладаг тул нуух
    ///    нэгж нь САМБАР — товч тус бүрийг хөндөхгүй.  Самбар үүссэн хэвээр, зөвхөн нуугдана: QAT/гарын товчлуур,
    ///    «Хэрэгсэл хайх»-ын «Нээх» (команд ID) хэвээр, салбар солиход Revit дахин асаах шаардлагагүй.
    ///  • Салбар = ERP-ийн баг (`/api/auth/me` → `teams`, үндсэн + нэмэлт), ажилтан Тохиргооноос өөрчилнө.
    ///    ERP-ийн хариуг `ui-prefs.json`-д кэшлэнэ — дараагийн асаалтад сүлжээ хүлээлгүй шууд шүүнэ.
    ///  • ⚠️ `Visible`-ийг ЗӨВХӨН Revit-ийн UI thread дээр тавина (`Apply`).  Арын thread → `_ui.BeginInvoke`.
    ///  • Алдаа бүр `ribbon-startup.log`-д; нэг самбар унавал бусад үргэлжилнэ.  Мэдэгдэхгүй үед БҮГД харагдана.
    /// </summary>
    internal static class RibbonDisciplines
    {
        private static readonly object Gate = new object();
        private static IReadOnlyList<RibbonPanelPlan> _plan = new RibbonPanelPlan[0];
        private static readonly Dictionary<ToolPanelId, RibbonPanel> Panels = new Dictionary<ToolPanelId, RibbonPanel>();
        private static Dispatcher _ui;
        private static int _refreshing;

        /// <summary>ERP-ээс баг татсаны дараа (UI thread дээр) — Тохиргооны цонх төлөвөө шинэчилнэ.</summary>
        internal static event Action Changed;

        // ── Бүртгэл (RibbonBuilder) ──────────────────────────────────────

        internal static void Begin(IReadOnlyList<RibbonPanelPlan> plan)
        {
            lock (Gate)
            {
                _plan = plan ?? new RibbonPanelPlan[0];
                Panels.Clear();
            }
        }

        internal static void TrackPanel(ToolPanelId id, RibbonPanel panel)
        {
            if (panel == null) return;
            lock (Gate) Panels[id] = panel;
        }

        // ── Төлөв ────────────────────────────────────────────────────────

        internal static RibbonPrefs Prefs
        {
            get { return MglUiPrefs.Load().Ribbon ?? new RibbonPrefs(); }
        }

        /// <summary>Одоо хүчинтэй салбарын олонлог (хэзээ ч None биш).</summary>
        internal static ToolDiscipline Active
        {
            get { return Prefs.Active; }
        }

        /// <summary>Горим / гараар сонгосон салбарыг хадгалаад ШУУД хэрэгжүүлнэ.  UI thread-ээс дуудна.</summary>
        internal static void SetChoice(RibbonFilterMode mode, ToolDiscipline manual)
        {
            MglUiPrefs.Update(p =>
            {
                if (p.Ribbon == null) p.Ribbon = new RibbonPrefs();
                p.Ribbon.Mode = ToolDisciplines.ModeKey(mode);
                p.Ribbon.Manual = ToolDisciplines.ToKeys(manual);
            });
            Apply();
        }

        // ── Хэрэгжүүлэлт (UI thread) ─────────────────────────────────────

        /// <summary>Асаалтад: UI thread-ийг санаж, кэшээр шүүгээд, ERP-ээс багийг арын thread-д шинэчилнэ.</summary>
        internal static void Init()
        {
            try { _ui = Dispatcher.CurrentDispatcher; } catch { _ui = null; }
            Apply();
            StartBackgroundRefresh();
        }

        internal static void Apply()
        {
            IReadOnlyList<RibbonPanelPlan> plan;
            Dictionary<ToolPanelId, RibbonPanel> panels;
            lock (Gate)
            {
                plan = _plan;
                panels = new Dictionary<ToolPanelId, RibbonPanel>(Panels);
            }

            RibbonVisibilityPlan hide = ToolDisciplines.Plan(plan, Active);
            foreach (KeyValuePair<ToolPanelId, RibbonPanel> kv in panels)
            {
                try
                {
                    bool visible = !hide.HiddenPanels.Contains(kv.Key);
                    if (kv.Value.Visible != visible) kv.Value.Visible = visible;
                }
                catch (Exception ex) { RibbonBuilder.LogFailure("«" + kv.Key + "» самбарыг нуух/харуулах", ex); }
            }
        }

        private static void PostToUi()
        {
            Action run = () =>
            {
                Apply();
                Action handler = Changed;
                if (handler != null)
                {
                    try { handler(); } catch { /* цонх хаагдсан — үл хамаарна */ }
                }
            };
            Dispatcher ui = _ui;
            if (ui == null) return;
            try { ui.BeginInvoke(DispatcherPriority.Background, run); } catch { }
        }

        // ── ERP-ийн баг ──────────────────────────────────────────────────

        /// <summary>
        /// Асаалтын дараа токен бэлэн болтол хэд дахин оролдоно (лицензийн session арын дэвсгэрт ирдэг).
        /// Шөнийн багц (BatchQto) дээр сүлжээнд гарахгүй.
        /// </summary>
        private static void StartBackgroundRefresh()
        {
            if (Interlocked.Exchange(ref _refreshing, 1) == 1) return;
            Task.Run(async () =>
            {
                try
                {
                    int[] delaysSec = { 4, 20, 60, 180, 600 };
                    foreach (int d in delaysSec)
                    {
                        await Task.Delay(TimeSpan.FromSeconds(d)).ConfigureAwait(false);
                        if (BatchQto.IsBatch) return;
                        AddinSettings st = SettingsStore.Load();
                        if (string.IsNullOrWhiteSpace(st.Token)) continue;
                        string host = string.IsNullOrWhiteSpace(st.ApiHost) ? AddinSettings.DefaultApiHost : st.ApiHost;
                        if (await RefreshFromErpAsync(host, st.Token, CancellationToken.None).ConfigureAwait(false)) return;
                    }
                }
                catch
                {
                    // Сүлжээгүй — кэш хэвээр.
                }
                finally
                {
                    Interlocked.Exchange(ref _refreshing, 0);
                }
            });
        }

        /// <summary>
        /// `GET /api/auth/me` → ажилтны багуудын код → кэш → UI thread дээр шүүлтийг дахин хэрэгжүүлнэ.
        /// Амжилтгүй (сүлжээ, 401, буруу хариу) бол false, кэш ХӨНДӨГДӨХГҮЙ.  Хэзээ ч throw хийхгүй.
        /// </summary>
        internal static async Task<bool> RefreshFromErpAsync(string host, string token, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(host) || string.IsNullOrWhiteSpace(token)) return false;
            try
            {
                using (var req = new HttpRequestMessage(HttpMethod.Get, ApiClient.Url(host, "/api/auth/me")))
                {
                    req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                    using (HttpResponseMessage res = await AiHttp.Http.SendAsync(req, ct).ConfigureAwait(false))
                    {
                        if (!res.IsSuccessStatusCode) return false;
                        string body = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
                        string[] codes = ParseTeamCodes(body);
                        if (codes == null) return false;
                        MglUiPrefs.Update(p =>
                        {
                            if (p.Ribbon == null) p.Ribbon = new RibbonPrefs();
                            p.Ribbon.ErpTeams = codes;
                            p.Ribbon.ErpFetchedAtUnix = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                            p.Ribbon = RibbonPrefs.Sanitize(p.Ribbon);
                        });
                        PostToUi();
                        return true;
                    }
                }
            }
            catch
            {
                return false;
            }
        }

        /// <summary>`{user:{team_code, teams:[{code}]}}` → кодууд (үндсэн нь эхэнд).  Буруу хэлбэр → null.</summary>
        private static string[] ParseTeamCodes(string body)
        {
            try
            {
                using (JsonDocument doc = JsonDocument.Parse(body))
                {
                    JsonElement user;
                    if (!doc.RootElement.TryGetProperty("user", out user) || user.ValueKind != JsonValueKind.Object) return null;
                    var codes = new List<string>();
                    JsonElement primary;
                    if (user.TryGetProperty("team_code", out primary) && primary.ValueKind == JsonValueKind.String)
                        codes.Add(primary.GetString());
                    JsonElement teams;
                    if (user.TryGetProperty("teams", out teams) && teams.ValueKind == JsonValueKind.Array)
                    {
                        foreach (JsonElement t in teams.EnumerateArray())
                        {
                            JsonElement code;
                            if (t.ValueKind == JsonValueKind.Object && t.TryGetProperty("code", out code) && code.ValueKind == JsonValueKind.String)
                                codes.Add(code.GetString());
                        }
                    }
                    return codes.ToArray();
                }
            }
            catch
            {
                return null;
            }
        }
    }
}
