using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.AutoAnnotate.Core;

namespace RevitMcpAddin.AutoAnnotate
{
    /// <summary>
    /// ЗҮСЭЛТ / ФАСАДЫН ХЭМЖЭЭС (харагдацын U = баруун, V = дээш хавтгайд):
    ///   • Зүүн (ба баруун) талд — түвшин хоорондын (давхрын өндөр) гинж + нийт өндөр.
    ///   • Доод (ба дээд) талд — тэнхлэг хоорондын гинж + нийт.
    ///   • Цонх, хаалга бүрийн хажууд — доорх түвшнээс доод ирмэг, дээд ирмэг.  Ижил өндөртэй
    ///     цонхны эгнээнд ГАНЦ удаа (хамгийн зүүн талынхад) — ажлын зурагт давтдаггүй.
    /// </summary>
    internal static class AaSectionDims
    {
        public static void Run(ViewData d, AaOptions o, AaReport rep, DimensionType type)
        {
            AaFrame f = d.F;
            if (d.Building.IsEmpty)
            {
                rep.Note("Харагдацад хэмжих модель элемент олдсонгүй.");
                return;
            }

            bool levelsInScope = d.Scope == null || d.Levels.Any(l => d.In(l.Level, l.Src));
            bool gridsInScope = d.Scope == null || d.Grids.Any(g => d.In(g.Grid, g.Src));
            if (o.LevelDims && levelsInScope)
            {
                List<ChainItem> lv = LevelItems(d);
                foreach (Side s in o.AllSides ? new[] { Side.Left, Side.Right } : new[] { o.RightSide ? Side.Right : Side.Left })
                {
                    int used = PlaceStack(d, o, rep, type, s, lv, "Түвшний хэмжээс", ref rep.DimsLevel);
                    if (used > 0 && o.ExtendGrids)
                        ExtendAll(d, o, rep, d.Levels.Where(l => l.Src == null).Select(l => (DatumPlane)l.Level), s, used, 26);
                }
            }
            if (o.GridDims && gridsInScope)
            {
                List<ChainItem> gr = d.Grids.Select(g => new ChainItem(g.Seg.A.X, Chain.PriorityGrid, g.Ref, "grid").WithNormal(g.SectionNormal)).ToList();
                foreach (Side s in o.AllSides ? new[] { Side.Bottom, Side.Top } : new[] { Side.Bottom })
                {
                    int used = PlaceStack(d, o, rep, type, s, gr, "Тэнхлэгийн хэмжээс", ref rep.DimsGrid, o.GridChain);
                    if (used > 0 && o.ExtendGrids)
                        ExtendAll(d, o, rep, d.Grids.Where(g => g.Src == null).Select(g => (DatumPlane)g.Grid), s, used, 5);
                }
            }
            if (o.OpeningHeights)
                OpeningHeights(d, o, rep, type);
        }

        private static List<ChainItem> LevelItems(ViewData d)
        {
            var r = new List<ChainItem>();
            foreach (LevelData l in d.Levels)
            {
                double v = d.ToView(new XYZ(d.Origin.X, d.Origin.Y, l.Z)).Y;
                r.Add(new ChainItem(v, Chain.PriorityGrid, l.Ref, "level"));
            }
            return r;
        }

        /// <summary>
        /// Түвшний тэмдэг / тэнхлэгийн бөмбөлгийг тухайн талын хамгийн гадна гинжээс цааш.
        /// marginMm: тэмдгийн хэмжээ — түвшний тэмдгийн бичвэр («Parapet 2 / 70'-10"») шугамын үзүүрээс
        /// ДОТОГШ ~20 мм сунадаг (хэмжсэн: Snowdon-ийн зүсэлтэд гинжтэй давхцсан), бөмбөлөг ~5 мм.
        /// </summary>
        private static void ExtendAll(ViewData d, AaOptions o, AaReport rep, IEnumerable<DatumPlane> datums, Side s, int used, double marginMm)
        {
            V2 outward = d.F.Outward(s);
            double need = d.Building.Edge(s) + d.Feet(o.FirstMm + o.StepMm * (used - 1) + marginMm);
            foreach (DatumPlane dp in datums)
                AaDim.ExtendDatum(d, dp, outward, need, rep);
        }

        /// <summary>Гинж (3+ бол) + нийт (2+) — барилгын ирмэгээс гадагш дараалан.  Ашигласан эгнээний тоо.</summary>
        private static int PlaceStack(ViewData d, AaOptions o, AaReport rep, DimensionType type, Side s,
            List<ChainItem> items, string what, ref int counter, bool chain = true)
        {
            List<ChainItem> norm = Chain.Normalize(Chain.KeepParallel(items), AaDim.Tol);
            if (norm.Count < 2)
                return 0;
            V2 along = d.F.Along(s), outward = d.F.Outward(s);
            double edge = d.Building.Edge(s);
            int slot = 0;
            if (chain && norm.Count > 2 && AaDim.Create(d, norm, along, outward, edge + d.Feet(o.FirstMm + o.StepMm * slot), type, rep, what) != null)
            {
                counter++;
                slot++;
            }
            if (AaDim.Create(d, Chain.Overall(norm), along, outward, edge + d.Feet(o.FirstMm + o.StepMm * slot), type, rep, what + " (нийт)") != null)
            {
                counter++;
                slot++;
            }
            return slot;
        }

        private static void OpeningHeights(ViewData d, AaOptions o, AaReport rep, DimensionType type)
        {
            List<ChainItem> levels = Chain.Normalize(LevelItems(d), AaDim.Tol);
            var rows = new List<Tuple<double, List<ChainItem>>>();
            foreach (SecOpening so in d.SectionOpenings)
            {
                FamilyInstance fi = so.Fi;
                if (!d.In(fi, so.Src))
                    continue;
                Reference bottom = Lk.FirstRef(fi, FamilyInstanceReferenceType.Bottom, so.Src);
                Reference top = Lk.FirstRef(fi, FamilyInstanceReferenceType.Top, so.Src);
                if (bottom == null || top == null)
                    continue;
                BoundingBoxXYZ bb = fi.get_BoundingBox(null);
                if (bb == null)
                    continue;
                var box = new Box();
                foreach (XYZ c in Lk.Corners(bb, so.Src))
                    box.Add(d.F, d.ToView(c));
                var items = new List<ChainItem>
                {
                    new ChainItem(box.MinV, Chain.PriorityFace, bottom, "sill"),
                    new ChainItem(box.MaxV, Chain.PriorityFace, top, "head"),
                };
                ChainItem below = levels.Where(l => l.Pos <= box.MinV + AaDim.Tol).OrderByDescending(l => l.Pos).FirstOrDefault();
                if (below != null)
                    items.Add(new ChainItem(below.Pos, Chain.PriorityGrid, below.Ref, "level"));
                rows.Add(Tuple.Create(box.MinU, items));
            }
            var seen = new HashSet<string>();
            foreach (Tuple<double, List<ChainItem>> r in rows.OrderBy(x => x.Item1))
            {
                List<ChainItem> norm = Chain.Normalize(r.Item2, AaDim.Tol);
                if (norm.Count < 2 || !seen.Add(Chain.Signature(norm, 0.01)))
                    continue;
                // Цонхны зүүн талд, босоо.
                double c = -(r.Item1 - d.Feet(5));
                if (AaDim.Create(d, norm, d.F.V, -d.F.U, c, type, rep, "Цонх/хаалганы өндөр") != null)
                    rep.DimsOpening++;
            }
        }
    }
}
