using System;
using System.IO;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading;
using Autodesk.Revit.UI;

namespace RevitMcpAddin
{
    /// <summary>
    /// Tiny localhost HTTP server hosted inside Revit. Accepts code-execution
    /// requests on a background thread, hands them to the Revit main thread via
    /// ExternalEvent, and blocks until the result is ready. One request executes
    /// at a time (single-flight) to avoid overlapping transactions.
    /// </summary>
    public class HttpServer
    {
        private readonly ExternalEvent _externalEvent;
        private readonly CodeExecutorEventHandler _handler;
        private readonly int _port;
        private readonly SemaphoreSlim _gate = new SemaphoreSlim(1, 1);

        private HttpListener _listener;
        private Thread _thread;
        private volatile bool _running;

        public HttpServer(ExternalEvent externalEvent, CodeExecutorEventHandler handler, int port)
        {
            _externalEvent = externalEvent;
            _handler = handler;
            _port = port;
        }

        public void Start()
        {
            _listener = new HttpListener();
            // "localhost" prefix does not require an admin URL ACL reservation.
            _listener.Prefixes.Add($"http://localhost:{_port}/");
            _listener.Start();
            _running = true;

            _thread = new Thread(Loop) { IsBackground = true, Name = "RevitMcpHttp" };
            _thread.Start();
        }

        public void Stop()
        {
            _running = false;
            try { _listener?.Stop(); } catch { }
            try { _listener?.Close(); } catch { }
        }

        private void Loop()
        {
            while (_running)
            {
                HttpListenerContext ctx;
                try { ctx = _listener.GetContext(); }
                catch { break; } // listener stopped
                ThreadPool.QueueUserWorkItem(_ => Handle(ctx));
            }
        }

        private void Handle(HttpListenerContext ctx)
        {
            int status = 200;
            object response;

            try
            {
                string path = ctx.Request.Url.AbsolutePath.TrimEnd('/');
                string method = ctx.Request.HttpMethod;

                // ХӨТЧӨӨС ирсэн хүсэлтийг (drive-by) ЭХЭНД таслана.  Хөтөч cross-origin хүсэлт бүрт `Origin`
                // толгой нэмдэг (JavaScript өөрчилж чадахгүй), харин bridge-ийн жинхэнэ клиентүүд
                // (Python MCP, curl, PowerShell) нэмдэггүй.  Токен ямар нэг шалтгаанаар вэб хуудсанд
                // алдагдсан ч localhost руу хөтчөөр хандах боломжгүй.  (`localhost` prefix нь DNS
                // rebinding-ийг Host толгойн тулгалтаар аль хэдийн хаадаг; CORS толгой огт буцаахгүй.)
                if (ctx.Request.Headers["Origin"] != null)
                {
                    status = 403;
                    response = new { success = false, error = "Browser requests are not allowed." };
                }
                // /health нь ТОКЕНГҮЙ хэвээр: өгөгдөл буцаадаггүй, зөвхөн
                // "би амьд байна" гэдгийг хэлдэг.  Суулгацыг шалгахад хэрэгтэй.
                else if (method == "GET" && (path == "/health" || path == string.Empty))
                {
                    response = new { status = "ok", server = "revit-mcp", port = _port };
                }
                // БУСАД БҮХ ЗАМ токен шаардана.
                //
                // ⚠️ Энэ шалгалт 404-өөс ӨМНӨ байгаа тул танихгүй зам ч 401
                // буцаана (404 биш).  Санаатай: ямар зам байдгийг задруулахгүй.
                // Python bridge-ийг дибаг хийхэд үүнийг санаж яв.
                else if (!BridgeAuth.Check(ctx))
                {
                    status = 401;
                    response = new
                    {
                        success = false,
                        error = "Unauthorized: bridge token required " +
                                "(see bridge.json in the RevitMcpAddin folder under APPDATA)"
                    };
                }
                // ЛИЦЕНЗ (1.9.0): bridge-ийн хэрэгслүүд ч add-in-ий нэг хэсэг — компанийн
                // бүртгэл + ажлын компьютерын лицензгүй бол 403 (`Licensing/LicenseGate.cs`).
                else if (!Licensing.LicenseGate.IsLicensedNow())
                {
                    status = 403;
                    response = new
                    {
                        success = false,
                        error = "MGL license required: sign in with the company account " +
                                "(MGL → Тохиргоо → «MGL нэвтрэлт») on your work computer."
                    };
                }
                // ШИНЭ: typed хэрэгсэл — дурын код БИШ, тиймээс анхдагчаар нээлттэй.
                else if (method == "POST" && path == "/tool")
                {
                    string body;
                    using (var reader = new StreamReader(ctx.Request.InputStream, Encoding.UTF8))
                        body = reader.ReadToEnd();

                    string tool = TryReadString(body, "tool", out string terr);
                    if (terr != null)
                    {
                        status = 400;
                        response = new { success = false, error = terr };
                    }
                    else if (string.IsNullOrWhiteSpace(tool))
                    {
                        status = 400;
                        response = new { success = false, error = "Missing 'tool' field." };
                    }
                    else
                    {
                        string argsJson = TryReadRawObject(body, "args");
                        ToolCall call = RevitToolBus.Call(tool, argsJson);
                        if (!call.Success) status = 400;
                        response = new
                        {
                            success = call.Success,
                            result = call.ResultJson,
                            error = call.Error
                        };
                    }
                }
                else if (method == "POST" && path == "/execute")
                {
                    // Дурын C# нь Revit + MGL API-г бүрэн эзэмших эрх тул
                    // АНХДАГЧААР УНТРААЛТТАЙ.  Typed /tool-ыг хэрэглэ.
                    if (!BridgeAuth.ArbitraryCodeAllowed)
                    {
                        WriteJson(ctx, 403, new
                        {
                            success = false,
                            error = "Arbitrary code execution is disabled. " +
                                    "Set MGL_ALLOW_EXEC=1 to enable, or use POST /tool."
                        });
                        return;
                    }

                    string body;
                    using (var reader = new StreamReader(ctx.Request.InputStream, Encoding.UTF8))
                        body = reader.ReadToEnd();

                    string code = TryReadCode(body, out string parseError);
                    if (parseError != null)
                    {
                        status = 400;
                        response = new { success = false, error = parseError };
                    }
                    else if (string.IsNullOrWhiteSpace(code))
                    {
                        status = 400;
                        response = new { success = false, error = "Missing or empty 'code' field." };
                    }
                    else
                    {
                        ExecuteRequest req = RunOnRevit(code);
                        response = new
                        {
                            success = req.Success,
                            result = req.Result,
                            output = req.Output,
                            error = req.Error
                        };
                    }
                }
                else
                {
                    status = 404;
                    response = new { success = false, error = $"Not found: {method} {path}" };
                }
            }
            catch (Exception ex)
            {
                status = 500;
                response = new { success = false, error = ex.Message };
            }

            WriteJson(ctx, status, response);
        }

        /// <summary>Нэрлэсэн мөр талбарыг уншина.</summary>
        private static string TryReadString(string body, string name, out string parseError)
        {
            parseError = null;
            try
            {
                using JsonDocument doc = JsonDocument.Parse(body);
                if (doc.RootElement.TryGetProperty(name, out JsonElement v) &&
                    v.ValueKind == JsonValueKind.String)
                {
                    return v.GetString();
                }
                return null;
            }
            catch (Exception ex)
            {
                parseError = "Invalid JSON body: " + ex.Message;
                return null;
            }
        }

        /// <summary>Нэрлэсэн объектыг ТҮҮХИЙ JSON мөр болгож буцаана.</summary>
        private static string TryReadRawObject(string body, string name)
        {
            try
            {
                using JsonDocument doc = JsonDocument.Parse(body);
                if (doc.RootElement.TryGetProperty(name, out JsonElement v) &&
                    v.ValueKind == JsonValueKind.Object)
                {
                    return v.GetRawText();
                }
            }
            catch { }
            return "{}";
        }

        private static string TryReadCode(string body, out string parseError)
        {
            parseError = null;
            try
            {
                using JsonDocument doc = JsonDocument.Parse(body);
                if (doc.RootElement.TryGetProperty("code", out JsonElement code) &&
                    code.ValueKind == JsonValueKind.String)
                {
                    return code.GetString();
                }
                return null;
            }
            catch (Exception ex)
            {
                parseError = "Invalid JSON body: " + ex.Message;
                return null;
            }
        }

        private ExecuteRequest RunOnRevit(string code)
        {
            _gate.Wait();
            try
            {
                var req = new ExecuteRequest { Code = code };
                _handler.Enqueue(req);

                ExternalEventRequest raised = _externalEvent.Raise();
                if (raised != ExternalEventRequest.Accepted)
                {
                    req.Success = false;
                    req.Error = "Revit did not accept the external event: " + raised;
                    return req;
                }

                if (!req.Done.Wait(TimeSpan.FromSeconds(60)))
                {
                    req.Success = false;
                    req.Error = "Timed out after 60s. Revit may be busy or a modal dialog is open.";
                    return req;
                }

                return req;
            }
            finally
            {
                _gate.Release();
            }
        }

        private static void WriteJson(HttpListenerContext ctx, int status, object payload)
        {
            try
            {
                string json = JsonSerializer.Serialize(payload);
                byte[] bytes = Encoding.UTF8.GetBytes(json);
                ctx.Response.StatusCode = status;
                ctx.Response.ContentType = "application/json";
                ctx.Response.ContentLength64 = bytes.Length;
                ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
                ctx.Response.OutputStream.Close();
            }
            catch { /* client went away */ }
        }
    }
}
