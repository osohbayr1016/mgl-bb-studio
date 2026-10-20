using System;
using System.Collections.Generic;

namespace RevitMcpAddin.Feedback.Core
{
    /// <summary>
    /// Хэрэгслийн СҮҮЛИЙН алдаа (санах ойд, процессын турш) — арын ажил (ж: «Ханын дэлгээс»-ийн Idling алхам) унахад
    /// хэрэглэгч тэр агшинд цонх нээх боломжгүй; дараа нь «Санал хүсэлт» нээхэд тэр алдаа (үе шат, exception) урьдчилан
    /// хавсаргагдана.  2 цагаас хуучныг санал болгохгүй.  Диск, сүлжээ ашиглахгүй.
    /// </summary>
    public static class FeedbackRecentErrors
    {
        public static readonly TimeSpan Window = TimeSpan.FromHours(2);
        private static readonly object Gate = new object();
        private static readonly Dictionary<string, Entry> ByTool = new Dictionary<string, Entry>(StringComparer.Ordinal);

        public sealed class Entry
        {
            public string ToolId { get; set; }
            public string ToolLabel { get; set; }
            public string Stage { get; set; }
            public Exception Error { get; set; }
            public DateTimeOffset At { get; set; }
        }

        public static void Remember(string toolId, string toolLabel, string stage, Exception error, DateTimeOffset? at = null)
        {
            if (error == null || string.IsNullOrEmpty(toolId)) return;
            lock (Gate)
                ByTool[toolId] = new Entry { ToolId = toolId, ToolLabel = toolLabel, Stage = stage, Error = error, At = at ?? DateTimeOffset.UtcNow };
        }

        /// <summary>Тухайн хэрэгслийн (null бол аль ч хэрэгслийн) хамгийн сүүлийн, 2 цагаас шинэ алдаа.</summary>
        public static Entry Latest(string toolId, DateTimeOffset now)
        {
            lock (Gate)
            {
                Entry best = null;
                foreach (Entry e in ByTool.Values)
                {
                    if (toolId != null && e.ToolId != toolId) continue;
                    if (now - e.At > Window) continue;
                    if (best == null || e.At > best.At) best = e;
                }
                return best;
            }
        }

        /// <summary>Хүсэлтэд хавсаргасны дараа (давхар санал болгохгүй).</summary>
        public static void Forget(string toolId)
        {
            if (toolId == null) return;
            lock (Gate) ByTool.Remove(toolId);
        }
    }
}
