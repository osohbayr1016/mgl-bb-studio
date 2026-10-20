using System;
using System.IO;

// Линкээр эмхэтгэсэн үндсэн plugin-ий хөдөлгүүр кодонд (Reinforcement/*, AutoAnnotate/Core/*) хэрэгтэй цөөн тэмдэгт.
// ⚠️ Үндсэн plugin-ий тохиргооны хавтсыг (%APPDATA%\RevitMcpAddin) ХЭЗЭЭ Ч хуваалцахгүй — тусдаа plugin түүний тохиргоог өөрчлөх ёсгүй.
namespace RevitMcpAddin
{
    internal static class SettingsStore
    {
        public static string Dir
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "MGL", "BbStudio", "engine"); }
        }
    }
}

// RfText.TplResult-ийн гарын үсэгт л хэрэгтэй (энэ plugin «загвараас хуулах»-ыг ДУУДАХГҮЙ).  Талбарууд CloneDrawings/CdModel.cs-ийн ижил нэртэй.
namespace RevitMcpAddin.CloneDrawings
{
    internal sealed class CdReport
    {
        public int Dims, DimsExisting, DimsSkipped, Tags, TagsExisting, TagsSkipped, Details, DetailsSkipped;
        public int RebarMatched, RebarUnmatched, DimsAdapted, DimsValueMismatch;
    }
}

namespace RevitMcpAddin.Reinforcement
{
    internal sealed class RfTemplateRunReport
    {
        public RevitMcpAddin.CloneDrawings.CdReport Cd = new RevitMcpAddin.CloneDrawings.CdReport();
        public bool Flipped;
        public int TemplateScale, TargetScale;
    }
}
