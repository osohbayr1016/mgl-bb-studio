// ⚠️ ХАРНЕССИЙН ЖОЛООЧ — `check_emitter.py` энэ exe-г ОЛОН УДАА, өөр өөр
//    тугтай ажиллуулна.  Тугууд:
//
//      --dir D            `BimEmitter.Dir` (жинхэнэ %APPDATA%-ийн орлуулга)
//      --ctl D            сүлжээний удирдлага + POST-ын бүртгэлийн хавтас
//      --run-id R         бүртгэлийн файлын өвөрмөц таг
//      --emit N           N гүйлгээг `ChangeTracker`-аар дамжуулж түлхэнэ
//      --emit-chunk C     нэг багцад C ширхэг (дараалал дүүрэхээс хамгаална)
//      --emit-delay-ms D  багц хоорондын завсар
//      --touches T        гүйлгээ тутмын элементийн түүврийн урт
//      --docs K           K өөр баримт (K сесс)
//      --enqueue-raw N    `BimEmitter.Enqueue`-г N удаа ШУУД (дараалал дүүргэх)
//      --enqueue-raw-late N  ЯГ `Cancel()`-ийн ӨМНӨ N мөр түлхэнэ — `PostLoop`-ийн
//                         `finally` дэх ЭЦСИЙН ШАВХАЛТ заавал ажиллана
//                         (ОЛОЛТ B: диск унасан үеийн унтраалтын алдагдал)
//      --inject-dropped N цагираг дүүрсэн дуурайлт
//      --run-ms M         түлхсэний дараа M мс ажиллуулна
//      --join-ms J        `Cancel()`-ийн дараах хүлээлтийн төсөв
//      --exit MODE        hard (TerminateProcess) | graceful | none
//      --no-start         `BimEmitter.Start` ДУУДАХГҮЙ (цэвэр дарааллын тест)
//
//    Гаралт: `<ctl>/status-<runid>.json` — `pending`, `dropped`, `emitted`.

using System;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;
using RevitMcpAddin;

static string Arg(string[] a, string k, string d)
{
    for (int i = 0; i < a.Length - 1; i++) if (a[i] == k) return a[i + 1];
    return d;
}

static int ArgI(string[] a, string k, int d)
{
    string s = Arg(a, k, null);
    int v;
    return s != null && int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out v) ? v : d;
}

static bool Flag(string[] a, string k)
{
    for (int i = 0; i < a.Length; i++) if (a[i] == k) return true;
    return false;
}

Console.OutputEncoding = Encoding.UTF8;

string[] a = args;
Harness.Dir = Arg(a, "--dir", null);
Harness.CtlDir = Arg(a, "--ctl", null);
Harness.RunId = Arg(a, "--run-id", "r0");

int emit = ArgI(a, "--emit", 0);
int chunk = Math.Max(1, ArgI(a, "--emit-chunk", 200));
int chunkDelay = ArgI(a, "--emit-delay-ms", 60);
int touches = ArgI(a, "--touches", 4);
int docs = Math.Max(1, ArgI(a, "--docs", 1));
int rawEnq = ArgI(a, "--enqueue-raw", 0);
int rawLate = ArgI(a, "--enqueue-raw-late", 0);
int injectDropped = ArgI(a, "--inject-dropped", 0);
int runMs = ArgI(a, "--run-ms", 1500);
int joinMs = ArgI(a, "--join-ms", 400);
string exitMode = Arg(a, "--exit", "graceful");
bool noStart = Flag(a, "--no-start");

void WriteStatus(string phase)
{
    try
    {
        string p = Path.Combine(Harness.CtlDir, "status-" + Harness.RunId + ".json");
        var sb = new StringBuilder(256);
        sb.Append("{\"phase\":\"").Append(phase).Append("\"");
        sb.Append(",\"pending\":").Append(BimEmitter.PendingCount.ToString(CultureInfo.InvariantCulture));
        sb.Append(",\"dropped\":").Append(BimEmitter.DroppedCount.ToString(CultureInfo.InvariantCulture));
        // ⚠️ ОЛОЛТ B / D — дискний ба серверийн ТООЛУУРУУД.  Эдгээр нь
        //    `ctl/` -д бичигдэнэ, `--dir` -д БИШ: T7 нь `--dir` -ыг
        //    бичигдэхгүй болгодог тул нотолгоо тэнд байвал БАС алга болно.
        sb.Append(",\"disk_fail\":").Append(BimEmitter.DiskFailCount.ToString(CultureInfo.InvariantCulture));
        sb.Append(",\"disk_fail_lines\":").Append(BimEmitter.DiskFailLines.ToString(CultureInfo.InvariantCulture));
        sb.Append(",\"disk_lost\":").Append(BimEmitter.DiskLostLines.ToString(CultureInfo.InvariantCulture));
        sb.Append(",\"srv_rejected\":").Append(BimEmitter.ServerRejectedCount.ToString(CultureInfo.InvariantCulture));
        sb.Append(",\"srv_dropped\":").Append(BimEmitter.ServerDroppedCount.ToString(CultureInfo.InvariantCulture));
        sb.Append(",\"srv_unaccounted\":").Append(BimEmitter.ServerUnaccountedCount.ToString(CultureInfo.InvariantCulture));
        sb.Append(",\"emitted\":").Append(emit.ToString(CultureInfo.InvariantCulture));
        sb.Append(",\"raw\":").Append(rawEnq.ToString(CultureInfo.InvariantCulture));
        sb.Append(",\"raw_late\":").Append(rawLate.ToString(CultureInfo.InvariantCulture));
        sb.Append(",\"ms\":").Append(Harness.Clock.ElapsedMilliseconds.ToString(CultureInfo.InvariantCulture));
        sb.Append("}");
        File.WriteAllText(p, sb.ToString(), new UTF8Encoding(false));
    }
    catch { }
}

if (!noStart) BimEmitter.Start("2027", "27.0.0.42");

if (injectDropped > 0) ChangeTracker.InjectDropped(injectDropped);

// ⚠️ ТҮҮХИЙ ДАРААЛАЛД ТҮЛХЭХ — дараалал дүүрэлтийг ХЭМЖИХ цорын ганц
//    детерминист зам (`Start` дуудалгүй бол шавхагч байхгүй).
for (int i = 0; i < rawEnq; i++)
{
    BimEmitter.Enqueue(
        "{\"n\":0,\"s\":\"harness-raw\",\"t\":\"txn\",\"b\":{\"txn_uid\":\"raw:" +
        i.ToString(CultureInfo.InvariantCulture) + "\"}}");
}

int done = 0;
while (done < emit)
{
    int k = Math.Min(chunk, emit - done);
    for (int i = 0; i < k; i++)
        ChangeTracker.Push("doc-" + Harness.RunId + "-" +
                           ((done + i) % docs).ToString(CultureInfo.InvariantCulture), touches);
    done += k;
    if (done < emit && chunkDelay > 0) Thread.Sleep(chunkDelay);
}

if (runMs > 0) Thread.Sleep(runMs);

WriteStatus("pre-exit");

if (exitMode == "hard")
{
    // ⚠️ ЖИНХЭНЭ TerminateProcess — `finally` блок, ProcessExit дэгээ,
    //    background thread БҮГД шууд тасарна.  Revit унасныг ЭНЭ Л
    //    зөв дуурайна (`Environment.Exit` нь хэт эелдэг).
    System.Diagnostics.Process.GetCurrentProcess().Kill();
    Thread.Sleep(10000);
}

// ⚠️ ОЛОЛТ B — УНТРААЛТЫН ЦОНХ.  Эдгээр мөрүүд `Pending`-д үлдэж
//    `PostLoop`-ийн `finally` дэх шавхалт руу ОРНО.  Диск бичигдэхгүй үед
//    тэр шавхалт нь өмнө нь ХООСОН `catch {}`-аар залгидаг байсан —
//    БҮРМӨСӨН, ТООЛУУРГҮЙ алдагдал.
for (int i = 0; i < rawLate; i++)
{
    BimEmitter.Enqueue(
        "{\"n\":0,\"s\":\"harness-late\",\"t\":\"txn\",\"b\":{\"txn_uid\":\"late:" +
        i.ToString(CultureInfo.InvariantCulture) + "\"}}");
}

if (exitMode == "graceful")
{
    BimEmitter.Cancel();
    BimEmitter.Join(joinMs);
    WriteStatus("post-join");
}

return 0;
