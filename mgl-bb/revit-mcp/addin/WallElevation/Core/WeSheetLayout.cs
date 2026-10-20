using System;
using System.Collections.Generic;

namespace RevitMcpAddin.WallElevation.Core
{
    /// <summary>Нэг харагдацын хуудсан дээрх байрлал (төв) ба хуудасны дугаар (0 = эхний хуудас).</summary>
    public sealed class WeSheetSlot
    {
        public int Index;
        public int Page;
        public double CenterX;
        public double CenterY;
        /// <summary>Ажлын талбараас том — тусдаа хуудсанд, ирмэгээс хальж болзошгүй.</summary>
        public bool Oversize;
        /// <summary>Байршуулсан хэмжээ (0 = блокийн хэмжээ) — рендерийн байрыг доод сул зайд багтаахаар жижигрүүлсэн үед.</summary>
        public double W, H;
        /// <summary>Урсгалын мөрийн дугаар (хуудас бүрт давтагдахгүй; −1 = мөргүй — зүүн багана, рендерийн доод мөр).  Гарчгийг мөрөөр тэгшлэхэд.</summary>
        public int Row = -1;
        /// <summary>
        /// Нэг хуудасны горим (<see cref="WeSingleSheet"/>): бүсдээ багтаагүй — бүсийн эхний зургаас шилжүүлсэн ОВООЛГОД (гарчиг нь харагдана,
        /// дарж сонгогдоно).  Хэрэглэгч дараа нь цэгцэлнэ.
        /// </summary>
        public bool Stacked;
        /// <summary>Нэг хуудасны горим: хуудасны сул зайд ч багтаагүй — хуудасны баруун талд (title block-ийн гадна) баганаар.</summary>
        public bool Spill;
        /// <summary>Нэг хуудасны горимын бүс: 0 зүүн дээд · 1 баруун дээд · 2 зүүн доод · 3 баруун доод; −1 = туслах/сул зай.</summary>
        public int Region = -1;
    }

    /// <summary>
    /// Хуудсан дээр харагдацуудыг ДАВХЦАХГҮЙ байрлуулах (мөрөөр — зүүнээс баруун, дээрээс доош).  ЦЭВЭР тооцоо:
    /// хэмжээ нь (crop / масштаб + шошгоны зай) — Revit-ийн regenerate хэрэггүй.  Бүх утга хуудасны дотоод нэгж (фут).
    /// </summary>
    public static class WeSheetLayout
    {
        /// <param name="sizes">X = өргөн, Y = өндөр (шошго орсон).</param>
        /// <param name="firstPageTop">Эхний хуудасны чөлөөт талбайн дээд хил (өмнөх viewport-ийн доор); ≥ maxY бол бүтэн.</param>
        public static List<WeSheetSlot> Pack(IList<WeV3> sizes, double minX, double minY, double maxX, double maxY,
                                             double gap, double firstPageTop)
        {
            var slots = new List<WeSheetSlot>();
            if (sizes == null || sizes.Count == 0) return slots;
            double areaW = maxX - minX;
            double areaH = maxY - minY;
            if (areaW <= 0 || areaH <= 0) throw new ArgumentException("Хуудасны ажлын талбай хоосон");

            int page = 0;
            double top = Math.Min(firstPageTop, maxY);
            double x = minX;
            double y = top;             // одоогийн мөрийн дээд хил
            double rowH = 0;
            bool pageEmpty = true;
            double pageTop = top;       // энэ хуудасны чөлөөт дээд хил (эхний хуудсанд өмнөх viewport-ийн доор)

            for (int i = 0; i < sizes.Count; i++)
            {
                double w = Math.Max(0, sizes[i].X);
                double h = Math.Max(0, sizes[i].Y);
                bool oversize = w > areaW + 1e-9 || h > areaH + 1e-9;

                if (oversize)
                {
                    // Бүтэн хуудас шаардана: эхэлсэн эсвэл хэсэгчлэн эзлэгдсэн хуудсан дээр тавихгүй.
                    if (!pageEmpty || pageTop < maxY - 1e-9) { page++; }
                    slots.Add(new WeSheetSlot { Index = i, Page = page, CenterX = minX + w / 2, CenterY = maxY - h / 2, Oversize = true });
                    page++;
                    x = minX; y = maxY; rowH = 0; pageEmpty = true; pageTop = maxY;
                    continue;
                }

                if (!pageEmpty && x + w > maxX + 1e-9)
                {
                    // Шинэ мөр.
                    x = minX;
                    y = y - rowH - gap;
                    rowH = 0;
                }
                if (y - h < minY - 1e-9)
                {
                    // Шинэ хуудас.
                    page++;
                    x = minX; y = maxY; rowH = 0; pageEmpty = true; pageTop = maxY;
                    if (y - h < minY - 1e-9)
                    {
                        // Эхний хуудасны чөлөөт хэсэгт ч, бүтэн хуудсанд ч багтахгүй — oversize-аас өмнө барина (энд ирэхгүй).
                        slots.Add(new WeSheetSlot { Index = i, Page = page, CenterX = minX + w / 2, CenterY = maxY - h / 2, Oversize = true });
                        page++;
                        continue;
                    }
                }

                slots.Add(new WeSheetSlot { Index = i, Page = page, CenterX = x + w / 2, CenterY = y - h / 2 });
                x += w + gap;
                rowH = Math.Max(rowH, h);
                pageEmpty = false;
            }
            return slots;
        }

        /// <summary>Хоёр тэгш өнцөгт (төв + хэмжээ) давхцах уу — тест ба шалгалтад.</summary>
        public static bool Overlaps(WeSheetSlot a, WeV3 sa, WeSheetSlot b, WeV3 sb)
        {
            if (a.Page != b.Page) return false;
            return Math.Abs(a.CenterX - b.CenterX) * 2 < sa.X + sb.X - 1e-9
                && Math.Abs(a.CenterY - b.CenterY) * 2 < sa.Y + sb.Y - 1e-9;
        }
    }
}
