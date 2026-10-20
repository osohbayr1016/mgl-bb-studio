using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

namespace MglWeGate
{
    /// <summary>
    /// `live-report.json` (gate.ps1 уншина) + `live-report.md` (хүн уншина).  Synthetic live-ийн дүн нь сценарийн статусаас ЛАВ гарна:
    /// FAIL (шинэ) → FAIL; зөвхөн known → KNOWN; BLOCKED → NOT VERIFIED; бүгд PASS → PASS.  Real-project validation энд ХЭЗЭЭ Ч PASS биш.
    /// </summary>
    internal static class Report
    {
        public static void Write(GateRunner r, LiveContext L)
        {
            List<ScenarioResult> res = L.Results;
            string overall = res.Any(x => x.Status == "FAIL") ? "FAIL"
                           : res.Any(x => x.Status == "BLOCKED") ? "NOT VERIFIED"
                           : res.Any(x => x.Status == "KNOWN") ? "KNOWN"
                           : res.Count > 0 ? "PASS" : "NOT RUN";
            r.Facts["synthetic_live_status"] = overall;

            var j = new Json().Obj()
                .Prop("schema", "mgl-we-live-report-v1")
                .Prop("year", r.Job.Year)
                .Prop("generated_at", DateTime.Now.ToString("o"))
                .Prop("synthetic_live_status", overall)
                .Prop("real_project_validation", "NOT VERIFIED")
                .Prop("product_dll", L.ProductDll)
                .Prop("product_sha256", L.ProductSha)
                .Prop("product_file_version", L.ProductVersion)
                .Prop("command_id", L.CmdName)
                // V04: gate.ps1 нь хэсэгчилсэн ажиллуулалтыг (scenarios != "*") хэзээ ч PASS гэж үзэхгүй.
                .Prop("phase", r.Job.Phase)
                .Prop("scenario_filter", r.Job.Scenarios);
            // V04: fixture-ийн ID/хувилбар — synthetic загваруудыг энэ generator (LiveGate DLL) + энэ оны template-ээс үүсгэсэн.
            // Тайлан нь тэдгээрт уяатай; gate fixture-гүй тайланг PASS гэж үзэхгүй.
            string generator = typeof(Report).Assembly.Location;
            j.Key("fixture").Obj()
                .Prop("kind", "synthetic")
                .Prop("generator", Path.GetFileName(generator))
                .Prop("generator_sha256", Sha256Of(generator))
                .Prop("template", string.IsNullOrEmpty(r.Job.Template) ? null : Path.GetFileName(r.Job.Template))
                .Prop("template_sha256", Sha256Of(r.Job.Template))
                .EndObj();
            // Бүх төлөвлөгдсөн сценари (шүүлтүүрээс үл хамаарна) — дундаас унасан ажиллуулалтыг gate барина.
            j.Key("scenario_plan").Arr();
            foreach (string id in Scenarios.PlannedIds()) j.Str(id);
            j.EndArr();
            j.Key("scenarios").Arr();
            foreach (ScenarioResult s in res)
            {
                j.Obj().Prop("id", s.Id).Prop("title", s.Title).Prop("category", s.Category).Prop("status", s.Status).Prop("seconds", s.Seconds);
                j.Key("known_ids").Arr();
                foreach (string k in s.Checks.Where(c => c.Status == "KNOWN").Select(c => c.KnownId).Distinct()) j.Str(k);
                j.EndArr();
                j.Key("checks").Arr();
                foreach (Check c in s.Checks) j.Obj().Prop("id", c.Id).Prop("status", c.Status).Prop("detail", c.Detail).Prop("known_id", c.KnownId).EndObj();
                j.EndArr();
                j.Key("evidence").Arr();
                foreach (string e in s.Evidence) j.Str(e);
                j.EndArr();
                j.EndObj();
            }
            j.EndArr().EndObj();
            j.Save(Path.Combine(r.Job.RunDir, "live-report.json"));

            var md = new StringBuilder();
            md.AppendLine("# Wall Elevation — synthetic live test, Revit " + r.Job.Year);
            md.AppendLine();
            md.AppendLine("- Synthetic Live Test: **" + overall + "**");
            md.AppendLine("- Real-Project Validation: **NOT VERIFIED** (production загвар байхгүй)");
            md.AppendLine("- Add-in: `" + L.ProductDll + "` · " + L.ProductVersion + " · sha256 `" + L.ProductSha + "`");
            md.AppendLine();
            md.AppendLine("| Сценари | Ангилал | Дүн | Хугацаа |");
            md.AppendLine("|---|---|---|---|");
            foreach (ScenarioResult s in res)
                md.AppendLine("| " + s.Id + " — " + s.Title + " | " + s.Category + " | " + s.Status
                              + (s.Status == "KNOWN" ? " (" + string.Join(", ", s.Checks.Where(c => c.Status == "KNOWN").Select(c => c.KnownId).Distinct()) + ")" : "")
                              + " | " + U.F(s.Seconds) + " с |");
            md.AppendLine();
            foreach (ScenarioResult s in res)
            {
                md.AppendLine("## " + s.Id + " — " + s.Status);
                foreach (Check c in s.Checks) md.AppendLine("- `" + c.Status + "` " + c.Id + " — " + (c.Detail ?? "").Replace("\n", " "));
                md.AppendLine();
            }
            File.WriteAllText(Path.Combine(r.Job.RunDir, "live-report.md"), md.ToString(), new UTF8Encoding(false));
            GateLog.Info("live-report: " + overall);
        }

        /// <summary>Файлын SHA-256 (жижиг үсэг); байхгүй/уншигдахгүй бол null — gate тэр тохиолдолд fixture-ийг уяагүй гэж үзнэ.</summary>
        private static string Sha256Of(string path)
        {
            try
            {
                if (string.IsNullOrEmpty(path) || !File.Exists(path)) return null;
                using (var s = File.OpenRead(path))
                using (var sha = System.Security.Cryptography.SHA256.Create())
                    return BitConverter.ToString(sha.ComputeHash(s)).Replace("-", "").ToLowerInvariant();
            }
            catch (Exception ex) { GateLog.Error("sha256 " + path, ex); return null; }
        }
    }
}
