using System;

namespace RevitMcpAddin.Smart.Core
{
    /// <summary>Загвар дахь ангилал (UI-ийн сонголт) — Smart Count ба Clash хоёулаа ашиглана.</summary>
    public sealed class CategoryInfo
    {
        /// <summary>`OST_Walls` — BuiltInCategory-ийн нэр (хэл солигдсон ч тогтвортой).</summary>
        public string Id { get; set; }
        /// <summary>Харагдах (орчуулагдсан) нэр.</summary>
        public string Name { get; set; }
    }

    /// <summary>
    /// «Сонгох / Харуулах» үйлдлийн дүн (Smart Count, Clash, Change Impact хуваалцана).
    /// `Missing` = UniqueId-аар олдоогүй (устсан) элемент.
    /// </summary>
    public sealed class SelectOutcome
    {
        public int Requested { get; set; }
        public int Applied { get; set; }
        public int Missing { get; set; }
        public string Message { get; set; }
    }
}
