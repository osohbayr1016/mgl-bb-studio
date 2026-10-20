using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using Autodesk.Revit.DB;
using RevitMcpAddin.RoomPlan.Core;

namespace RevitMcpAddin.RoomPlan
{
    internal sealed class PythonUnitRequest
    {
        internal string Id;
        internal ExistingFloorBoundary Boundary;
        internal PlanEntrySide Entry;
        internal int Bedrooms;
        internal int Bathrooms = 1;
        /// <summary>Sides that may carry windows (lower-case south/north/west/east).</summary>
        internal List<string> Facades = new List<string>();
        internal double HallWidth = 1.4;
        /// <summary>
        /// Бодит ханын БҮТЭН зузаан (м) — Python тавилгыг ханын НҮҮРнээс байрлуулна
        /// (`exterior_wall_thickness_m` / `interior_wall_thickness_m`).  0 = тэнхлэгийн шугамаар
        /// (2026-10-14-өөс өмнөх зан төлөв).  Revit талд `WallType.Width`-аас бөглөнө.
        /// </summary>
        internal double ExteriorWallThickness;
        internal double InteriorWallThickness;
        /// <summary>Тавилгын зэрэглэл: economy / standard / luxury (python plan_furniture.TIERS).</summary>
        internal string Tier = "standard";
        /// <summary>
        /// «Давхрын план»-ы студи: Revit-д хана үүсэхээс ӨМНӨ, арын урсгалд (Revit API дуудахгүйгээр) хүсэлт илгээхэд
        /// айлын хэмжээг (м) шууд өгнө.  NaN = <see cref="Boundary"/>-оос (Revit-ийн нэгж хувиргалт — зөвхөн API контекстод).
        /// </summary>
        internal double WidthM = double.NaN, HeightM = double.NaN;
        internal double Width { get { return double.IsNaN(WidthM) ? Boundary.WidthMeters : WidthM; } }
        internal double Height { get { return double.IsNaN(HeightM) ? Boundary.HeightMeters : HeightM; } }
    }

    internal sealed class PythonOption
    {
        internal string OptionId, Template, Topology, LibraryOrigin, Explanation;
        internal double Score, BaseScore, EfficiencyPercent, MinBedroomArea;
        internal int DaylitRooms, HabitableRooms;
        /// <summary>0..1 parts of the score: daylight, area_fit, squareness, circulation, zoning.</summary>
        internal Dictionary<string, double> Parts = new Dictionary<string, double>(StringComparer.Ordinal);
        internal List<string> Facades = new List<string>();
        internal GeneratedPlan Plan;
        internal double Part(string key) { return Parts.TryGetValue(key, out double v) ? v : 0; }
        public override string ToString()
        {
            return Score.ToString("0") + "% · ☀" + DaylitRooms + "/" + HabitableRooms + " · " +
                RoomPlanLabels.Topology(Topology, LibraryOrigin) + " · " +
                Plan.Rooms.Count(r => r.Name != "Хонгил") + " өрөө";
        }
    }

    internal static class RoomPlanLabels
    {
        internal static string Topology(string topology, string origin = null)
        {
            if (!string.IsNullOrEmpty(origin)) return origin;
            switch (topology)
            {
                case "t-hall": return "Т коридор";
                case "l-hall": return "Г коридор";
                case "central-hall": return "Төв коридор";
                case "side-hall": return "Хажуу коридор";
                case "entry-gallery": return "Үүдний коридор";
                case "living-hub": return "Зочны өрөөний төвтэй";
                case "living-column": return "Зочны өрөө хажуудаа";
                case "split-living": return "Унтлагын өрөө 2 талд";
                case "saved-adapted": return "Өмнө ашигласан";
                default: return topology ?? "";
            }
        }
    }

    internal sealed class PythonUnitResult
    {
        internal string Id;
        internal ExistingFloorBoundary Boundary;
        internal PlanEntrySide Entry;
        internal int Bedrooms, Bathrooms;
        internal List<string> Facades = new List<string>();
        /// <summary>Why this unit has no option (Python per-unit error), or null.</summary>
        internal string Error;
        /// <summary>
        /// Python-ий анхааруулга (жишээ: хүссэн хонгил хэт нарийн тул 1.4 м-ээр гаргасан;
        /// сонголтын сан ашиглах боломжгүй).  Ерөнхий «БНбД баталгаа биш» мөр орохгүй.
        /// </summary>
        internal List<string> Warnings = new List<string>();
        internal int TotalValid;
        internal List<PythonOption> Options = new List<PythonOption>();
    }

    internal sealed class PythonBatch
    {
        internal string BatchId;
        internal List<PythonUnitResult> Units = new List<PythonUnitResult>();
    }

    /// <summary>
    /// Python stdlib executable; stdin/stdout JSON. NEVER runs Python from a
    /// model-supplied path or invokes a shell, AI model, API, MGL AI or network.
    /// Requires locally installed Python 3 with the packaged .py source.
    /// </summary>
    internal static class RoomPlanPythonBridge
    {
        private static string ScriptPath
        {
            get
            {
                string addinFolder = Path.GetDirectoryName(typeof(RoomPlanPythonBridge).Assembly.Location);
                string script = Path.Combine(addinFolder, "RoomPlan", "Python", "roomplan_cli.py");
                if (!File.Exists(script))
                    throw new InvalidOperationException("Python хөдөлгүүр олдсонгүй: " + script +
                        ". MGL add-in bundle-аа дахин суулгана уу.");
                return script;
            }
        }

        internal static string Call(string json)
        {
            if (string.IsNullOrWhiteSpace(json) || json.Length > 512 * 1024)
                throw new ArgumentException("Python request-ийн хэмжээ буруу.");
            // A verified Windows QA bundle can include the frozen Python
            // executable. This removes any Python installation requirement
            // from employees' machines, without introducing AI or remote APIs.
            string script = ScriptPath;
            string packagedExe = Path.Combine(Path.GetDirectoryName(script), "roomplan_cli.exe");
            bool frozen = File.Exists(packagedExe);
            string python = Environment.GetEnvironmentVariable("MGL_ROOMPLAN_PYTHON");
            if (string.IsNullOrWhiteSpace(python)) python = "python";
            var start = new ProcessStartInfo
            {
                FileName = frozen ? packagedExe : python,
                Arguments = frozen ? "" : "\"" + script.Replace("\"", "") + "\"",
                CreateNoWindow = true, UseShellExecute = false,
                RedirectStandardInput = true, RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
                WorkingDirectory = Path.GetDirectoryName(ScriptPath)
            };
            start.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
            start.EnvironmentVariables["PYTHONUTF8"] = "1";
            // Full Unicode room names must survive redirected Windows pipes.
            try
            {
                using (var process = new Process { StartInfo = start })
                {
                    if (!process.Start()) throw new InvalidOperationException("Python процесс эхэлсэнгүй.");
                    var stdout = process.StandardOutput.ReadToEndAsync();
                    var stderr = process.StandardError.ReadToEndAsync();
                    process.StandardInput.Write(json);
                    process.StandardInput.Close();
                    if (!process.WaitForExit(60000))
                    {
                        try { process.Kill(); } catch { }
                        throw new TimeoutException("Python хөдөлгүүр 60 секундэд хариулсангүй.");
                    }
                    string result = stdout.GetAwaiter().GetResult();
                    string error = stderr.GetAwaiter().GetResult();
                    if (result.Length > 8 * 1024 * 1024)
                        throw new InvalidOperationException("Python output хэт том.");
                    if (process.ExitCode != 0)
                        throw new InvalidOperationException("Python хөдөлгүүр: " +
                            (result.Length > 0 ? result : error).Substring(
                                0, Math.Min((result.Length > 0 ? result : error).Length, 900)));
                    return result;
                }
            }
            catch (System.ComponentModel.Win32Exception)
            {
                throw new InvalidOperationException("Bundled Python worker болон Python 3 суулгац хоёулаа алга. " +
                    "Python 3.10+ суулгаад Revit restart хийнэ. AI/API хэрэггүй.");
            }
        }

        /// <summary>Required furniture per room (see FurniturePlanner.Required).</summary>
        private static bool Furnished(GeneratedPlan plan)
        {
            foreach (PlanRoom room in plan.Rooms)
            {
                var kinds = new HashSet<FurnitureKind>(plan.Furnishings.Where(f => f.RoomName == room.Name).Select(f => f.Kind));
                if (room.Name.StartsWith("Унтлагын", StringComparison.Ordinal) &&
                    !kinds.Contains(FurnitureKind.Bed) && !kinds.Contains(FurnitureKind.BedSingle)) return false;
                if (room.Name.StartsWith("Зочны", StringComparison.Ordinal) &&
                    !(kinds.Contains(FurnitureKind.Sofa) && kinds.Contains(FurnitureKind.Kitchen))) return false;
                if (room.Name.StartsWith("Ариун", StringComparison.Ordinal) &&
                    !(kinds.Contains(FurnitureKind.Toilet) && kinds.Contains(FurnitureKind.Basin))) return false;
            }
            return true;
        }

        internal static PythonBatch Generate(IReadOnlyList<PythonUnitRequest> requests, int maxOptions = 36)
        {
            var payload = new
            {
                command = "generate_batch",
                batch_id = Guid.NewGuid().ToString("N"),
                units = requests.Select(r => new
                {
                    unit_id = r.Id,
                    width_m = r.Width,
                    height_m = r.Height,
                    bedrooms = r.Bedrooms,
                    bathrooms = r.Bathrooms,
                    entry = r.Entry.ToString().ToLowerInvariant(),
                    facades = r.Facades.ToArray(),
                    hall_width = r.HallWidth,
                    exterior_wall_thickness_m = r.ExteriorWallThickness,
                    interior_wall_thickness_m = r.InteriorWallThickness,
                    tier = r.Tier,
                    max_options = maxOptions
                }).ToArray()
            };
            using (JsonDocument response = Parse(Call(JsonSerializer.Serialize(payload))))
            {
                var root = response.RootElement;
                var result = new PythonBatch { BatchId = Prop(root, "batch_id").GetString() };
                JsonElement units = Prop(root, "units");
                foreach (var item in units.EnumerateArray())
                {
                    string id = Prop(item, "unit_id").GetString();
                    PythonUnitRequest req = requests.FirstOrDefault(x => x.Id == id);
                    if (req == null) throw new InvalidOperationException("Python unknown unit.");
                    var unit = new PythonUnitResult
                    {
                        Id = id, Boundary = req.Boundary, Entry = req.Entry,
                        Bedrooms = req.Bedrooms, Bathrooms = req.Bathrooms,
                        Facades = req.Facades.ToList()
                    };
                    if (item.TryGetProperty("error", out JsonElement unitError) &&
                        unitError.ValueKind == JsonValueKind.String)
                        unit.Error = unitError.GetString();
                    if (item.TryGetProperty("warnings", out JsonElement warnings) &&
                        warnings.ValueKind == JsonValueKind.Array)
                        foreach (var warning in warnings.EnumerateArray())
                            if (warning.ValueKind == JsonValueKind.String &&
                                !warning.GetString().StartsWith("Оноо нь БНбД", StringComparison.Ordinal))
                                unit.Warnings.Add(warning.GetString());
                    if (item.TryGetProperty("total_valid", out JsonElement totalValid) &&
                        totalValid.ValueKind == JsonValueKind.Number)
                        unit.TotalValid = totalValid.GetInt32();
                    foreach (var candidate in Prop(item, "options").EnumerateArray())
                    {
                        var plan = new GeneratedPlan
                        {
                            Width = Prop(candidate, "width_m").GetDouble(),
                            Height = Prop(candidate, "height_m").GetDouble(),
                            Bedrooms = req.Bedrooms, PythonGenerated = true,
                            ExteriorThickness = req.ExteriorWallThickness,
                            InteriorThickness = req.InteriorWallThickness
                        };
                        foreach (var wall in Prop(candidate, "walls").EnumerateArray())
                        {
                            var a = Prop(wall, "start"); var b = Prop(wall, "end");
                            plan.Walls.Add(new PlanWall(Prop(wall, "id").GetString(),
                                Prop(a, "x").GetDouble(), Prop(a, "y").GetDouble(),
                                Prop(b, "x").GetDouble(), Prop(b, "y").GetDouble()));
                        }
                        foreach (var room in Prop(candidate, "rooms").EnumerateArray())
                            plan.Rooms.Add(new PlanRoom(Prop(room, "name").GetString(),
                                Prop(room, "x1").GetDouble(), Prop(room, "y1").GetDouble(),
                                Prop(room, "x2").GetDouble(), Prop(room, "y2").GetDouble()));
                        foreach (var door in Prop(candidate, "doors").EnumerateArray())
                        {
                            var c = Prop(door, "center");
                            plan.Doors.Add(new PlanDoor(Prop(door, "host_wall").GetString(),
                                Prop(c, "x").GetDouble(), Prop(c, "y").GetDouble()));
                        }
                        foreach (var obj in Prop(candidate, "furniture").EnumerateArray())
                        {
                            string kindName = Prop(obj, "kind").GetString();
                            string roomName = Prop(obj, "room").GetString();
                            if (!Enum.TryParse(kindName, false, out FurnitureKind kind))
                                throw new InvalidOperationException("Python unknown furniture kind: " + kindName);
                            PlanRoom room = plan.Rooms.FirstOrDefault(q => q.Name == roomName);
                            if (room == null) throw new InvalidOperationException("Python furniture room missing: " + roomName);
                            var target = new FurnitureTarget(kind,room,
                                Prop(obj,"x").GetDouble(),Prop(obj,"y").GetDouble(),
                                Prop(obj,"width").GetDouble(),Prop(obj,"depth").GetDouble());
                            if (obj.TryGetProperty("back", out JsonElement back) && back.ValueKind == JsonValueKind.String)
                            {
                                string side = back.GetString();
                                if (side != "south" && side != "north" && side != "west" && side != "east")
                                    throw new InvalidOperationException("Python furniture back side: " + side);
                                target.Back = side;
                            }
                            plan.Furnishings.Add(target);
                        }
                        // Program check: exactly the requested bedrooms; every bedroom has a
                        // bed, the living room a sofa and a kitchen, every bathroom a WC and
                        // a basin.  Companions (night stands, wardrobe, tub …) are optional.
                        int beds = plan.Rooms.Count(r => r.Name.StartsWith("Унтлагын", StringComparison.Ordinal));
                        int baths = plan.Rooms.Count(r => r.Name.StartsWith("Ариун", StringComparison.Ordinal));
                        if (beds != req.Bedrooms || baths < 1 || !Furnished(plan))
                            continue;
                        // Fail closed; never trust a subprocess output before Revit apply.
                        string reason;
                        if (!RoomPlanRanking.GeometrySafe(plan, out reason))
                            continue;
                        if (!FurniturePlanner.Safe(plan.Furnishings, plan, out string furnitureError,
                                req.ExteriorWallThickness, req.InteriorWallThickness))
                            continue;
                        // Хэмжээ = сонгосон хил, периметр бүтэн, өрөө хучилт, хаалга ШУГАМ дээр —
                        // GeometrySafe эдгээрийг шалгадаггүй (2026-10-14 аудит P2-d).
                        if (!RoomPlanPlanCheck.Consistent(plan, req.Width,
                                req.Height, out string consistency))
                            continue;
                        var parsed = new PythonOption
                        {
                            OptionId = Prop(candidate, "option_id").GetString(),
                            Template = Prop(candidate, "template").GetString(),
                            Topology = Prop(candidate, "topology").GetString(),
                            LibraryOrigin = Prop(candidate, "library_origin").ValueKind == JsonValueKind.Null ? null : Prop(candidate, "library_origin").GetString(),
                            Explanation = Prop(candidate, "explanation").GetString(),
                            Score = Prop(candidate, "score").GetDouble(),
                            BaseScore = Prop(candidate, "base_score").GetDouble(),
                            EfficiencyPercent = Prop(Prop(candidate, "metrics"), "area_efficiency_percent").GetDouble(),
                            MinBedroomArea = Prop(Prop(candidate, "metrics"), "min_bedroom_area_m2").GetDouble(),
                            Plan = plan
                        };
                        JsonElement metrics = Prop(candidate, "metrics");
                        if (metrics.TryGetProperty("daylit_rooms", out JsonElement lit))
                            parsed.DaylitRooms = lit.GetInt32();
                        if (metrics.TryGetProperty("habitable_rooms", out JsonElement hab))
                            parsed.HabitableRooms = hab.GetInt32();
                        if (candidate.TryGetProperty("score_parts", out JsonElement parts) &&
                            parts.ValueKind == JsonValueKind.Object)
                            foreach (var part in parts.EnumerateObject())
                                if (part.Value.ValueKind == JsonValueKind.Number)
                                    parsed.Parts[part.Name] = part.Value.GetDouble();
                        if (candidate.TryGetProperty("facades", out JsonElement fac) &&
                            fac.ValueKind == JsonValueKind.Array)
                            parsed.Facades = fac.EnumerateArray().Select(x => x.GetString()).ToList();
                        unit.Options.Add(parsed);
                    }
                    result.Units.Add(unit);
                }
                return result;
            }
        }

        internal static bool TryEvent(PythonBatch batch, PythonUnitResult unit,
            PythonOption option, string action, string reason, out string error)
        {
            error = null;
            try
            {
                string payload = JsonSerializer.Serialize(new
                {
                    command = "record_event",
                    batch_id = batch.BatchId, unit_id = unit.Id,
                    option_id = option.OptionId, action,
                    reason, event_id = Guid.NewGuid().ToString("N")
                });
                using (JsonDocument ignored = Parse(Call(payload))) { }
                return true;
            }
            catch (Exception ex) { error = ex.Message; return false; }
        }

        /// <summary>
        /// Fire-and-forget feedback (viewed / selected).  Runs the Python
        /// process on a worker thread so a click never waits for it; touches
        /// no Revit API.  Explicit decisions (rejected / applied) stay
        /// synchronous so the architect sees a failure.
        /// </summary>
        internal static void EventInBackground(PythonBatch batch, PythonUnitResult unit,
            PythonOption option, string action)
        {
            if (option == null) return;
            System.Threading.Tasks.Task.Run(() =>
            {
                if (!TryEvent(batch, unit, option, action, null, out string error))
                    Debug.WriteLine("RoomPlan feedback: " + error);
            });
        }

        internal static string Analytics()
        {
            using (JsonDocument output = Parse(Call("{\"command\":\"analytics\"}")))
            {
                var root = output.RootElement;
                int generated = Prop(root, "generated").GetInt32();
                var actions = Prop(root, "actions");
                int applied = 0;
                if (actions.TryGetProperty("applied", out JsonElement value))
                    applied = value.GetInt32();
                var sb = new StringBuilder("Local Python статистик\n");
                sb.AppendLine("Үүсгэсэн хувилбарууд: " + generated);
                sb.AppendLine("Амжилттай Revit-д хэрэглэсэн: " + applied);
                sb.AppendLine("Дахин санал болгох local plan: " +
                    Prop(root,"locally_saved_applied_plans").GetInt32());
                sb.AppendLine("Тэмдэглэл: оноо нь бодит БНбД/MNS шалгалтын дүн биш.");
                foreach (var x in Prop(root, "templates").EnumerateArray())
                    sb.AppendLine(Prop(x, "template").GetString() + ": " +
                        Prop(x, "applied").GetInt32() + " хэрэглэсэн / " +
                        Prop(x, "generated").GetInt32() + " үүсгэсэн");
                sb.AppendLine("\nТатгалзсан шалтгаан (зөвхөн архитекторын өгсөн):");
                foreach (var item in Prop(root, "explicit_rejection_reasons").EnumerateObject())
                    sb.AppendLine(item.Name + ": " + item.Value.GetInt32());
                return sb.ToString();
            }
        }

        private static JsonDocument Parse(string response)
        {
            var result = JsonDocument.Parse(response);
            if (result.RootElement.TryGetProperty("error", out JsonElement error))
            {
                string message = error.GetString();
                result.Dispose();
                throw new InvalidOperationException(message);
            }
            return result;
        }

        private static JsonElement Prop(JsonElement e, string name)
        {
            if (!e.TryGetProperty(name, out JsonElement value))
                throw new InvalidOperationException("Python output-д " + name + " байхгүй.");
            return value;
        }
    }
}
