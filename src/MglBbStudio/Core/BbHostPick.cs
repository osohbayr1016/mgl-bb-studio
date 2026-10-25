using System;
using System.Collections.Generic;
using System.Linq;

namespace MglBb.Core
{
    /// <summary>Арматурын тэнхлэгийг дайрсан нэг хост-нэр дэвшигч: тэнхлэгийн хэдэн фут нь энэ элементийн биет дотор байгаа.</summary>
    public sealed class BbHostCand
    {
        public long Id;
        /// <summary>Нэг гишүүний бүлэг (ижил тэмдэгтэй ижил ангиллын элементүүд — олон алгаслын дамнуруу, давхрын багана).  Хоосон бол Id.</summary>
        public string Group;
        /// <summary>Ангиллын давуу эрэмбэ (<see cref="BbHostPick.PriorityFraming"/> …) — биет давхцвал өндөр нь хост болно.</summary>
        public int Priority;
        public double Inside;
    }

    /// <summary>
    /// Арматурын ЗӨВ хостыг геометрээр шийднэ (Revit-гүй).  Хэрэглэгч арматурыг хөрш дамнуруу / баганад хостлосон бол дэлгээс тэр арматурыг
    /// «хамааралгүй» гэж нуудаг (ЖИШЭЭ-5 ТДН-4, 2026-10-25).  Дүрэм: тэнхлэгийн ≥ <see cref="MinShare"/> нь багтсан бүлгүүдээс давуу эрэмбэ өндөр,
    /// дараа нь илүү урт хэсэг нь багтсан нь зөв хост; одоогийн хост тийм бүлэгт (ижил буюу өндөр эрэмбээр) байвал, эсвэл өндөр эрэмбийн хост дээр ≥ <see cref="KeepShare"/> бол хөндөхгүй.
    /// </summary>
    public static class BbHostPick
    {
        public const int PriorityFloor = 0, PriorityWall = 1, PriorityColumn = 2, PriorityFraming = 3;
        public const double MinShare = 0.5;
        /// <summary>Өндөр эрэмбийн одоогийн хост (дамнуруу) дээр арматурын энэ хувь нь багтвал доод эрэмбийнх (багана) рүү шилжүүлэхгүй — тулгуурын
        /// дээд арматурын тал нь баганад байдаг (ЖИШЭЭ-5 ДН-2: 47% дамнуруу / 52% багана).</summary>
        public const double KeepShare = 0.25;

        /// <summary>Шилжүүлэх хостын Id, эсвэл 0 (одоогийнх зөв / тодорхойгүй).  <paramref name="share"/> = зорилтот бүлэгт багтсан хувь.</summary>
        public static long Pick(long current, double total, IList<BbHostCand> cands, out double share, out double currentShare)
        {
            share = currentShare = 0;
            if (total <= 1e-9 || cands == null || cands.Count == 0) return 0;
            var groups = cands.GroupBy(c => string.IsNullOrEmpty(c.Group) ? "#" + c.Id : c.Group)
                .Select(g => new { Members = g.ToList(), Share = Math.Min(1.0, g.Sum(c => c.Inside) / total), Priority = g.Max(c => c.Priority) })
                .ToList();
            var cur = groups.FirstOrDefault(g => g.Members.Any(c => c.Id == current));
            if (cur != null) currentShare = cur.Share;
            var best = groups.Where(g => g.Share >= MinShare).OrderByDescending(g => g.Priority).ThenByDescending(g => g.Share).FirstOrDefault();
            if (best == null) return 0;
            share = best.Share;
            if (cur != null && (cur == best || (cur.Share >= MinShare && cur.Priority >= best.Priority) || (cur.Share >= KeepShare && cur.Priority > best.Priority))) return 0;
            return best.Members.OrderByDescending(c => c.Inside).First().Id;
        }
    }
}
