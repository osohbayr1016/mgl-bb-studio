using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using MglBb.Core;

namespace MglBb.RevitSide
{
    /// <summary>
    /// Огтлолын «арматурын гарын үсэг»: тухайн цэг дээр огтлогдох ажлын арматур (дээд/дунд/доод тал × голч × ДУГААР × ширхэг) + хомутын
    /// (голч × алхам × дугаар) багц.  Дугаар (позиц) заавал: ЖИШЭЭ-1-ийн ДН-1-д хэлбэр ижил ч алгасал бүрд өөр дугаартай тул инженер алгасал бүрд огтолсон.  Хоёр огтлолын гарын үсэг ижил бол инженерийн зураг шиг ДАВТАХГҮЙ (ЖИШЭЭ-1: 911 огтлолын 895 давтагдашгүй).
    /// </summary>
    internal sealed class BbRebarSig
    {
        private sealed class Item
        {
            public string Key;     // "T|22|" г.м.
            public int Qty;
            public double Lo, Hi;  // тэнхлэгийн дагуух муж (мм, гинжийн эхнээс)
            public bool Stirrup;
        }

        private readonly List<Item> _items = new List<Item>();

        public static BbRebarSig Of(Document doc, BbBeamChain chain)
        {
            var sig = new BbRebarSig();
            double mid = (chain.Bottom + chain.Top) / 2;
            foreach (FamilyInstance host in chain.Members)
            {
                IList<ElementId> ids;
                try
                {
                    RebarHostData hd = RebarHostData.GetRebarHostData(host);
                    if (hd == null) continue;
                    ids = hd.GetRebarsInHost().Select(r => r.Id).ToList();
                }
                catch { continue; }
                foreach (ElementId id in ids)
                {
                    if (!(doc.GetElement(id) is Rebar r)) continue;
                    try { sig.Add(doc, chain, r, mid); }
                    catch { /* уншигдаагүй арматур — гарын үсэгт оролцохгүй */ }
                }
            }
            return sig;
        }

        private void Add(Document doc, BbBeamChain chain, Rebar r, double midZ)
        {
            RebarShape shape = doc.GetElement(r.GetShapeId()) as RebarShape;
            bool stirrup = shape != null && shape.RebarStyle == RebarStyle.StirrupTie;
            string d = "?";
            string num = "";
            try { num = r.get_Parameter(BuiltInParameter.REBAR_NUMBER)?.AsString() ?? ""; } catch { }
            try
            {
                if (doc.GetElement(r.GetTypeId()) is RebarBarType bt) d = Math.Round(BbGeom.ToMm(bt.BarModelDiameter)).ToString(CultureInfo.InvariantCulture);
            }
            catch { }
            IList<Curve> cs = r.GetCenterlineCurves(false, false, false, MultiplanarOption.IncludeOnlyPlanarCurves, 0);
            var pts = new List<XYZ>();
            foreach (Curve c in cs) { pts.Add(c.GetEndPoint(0)); pts.Add(c.GetEndPoint(1)); }
            if (pts.Count == 0) return;
            XYZ normal = XYZ.Zero;
            double arrayLen = 0;
            try
            {
                RebarShapeDrivenAccessor acc = r.GetShapeDrivenAccessor();
                normal = acc.Normal;
                arrayLen = acc.ArrayLength;
            }
            catch { }
            bool alongAxis = Math.Abs(normal.DotProduct(chain.Axis)) > 0.9;
            if (stirrup || alongAxis)
            {
                double baseS = pts.Average(p => BbGeom.ToMm(chain.Station(p)));
                double len = BbGeom.ToMm(arrayLen) * (normal.DotProduct(chain.Axis) >= 0 ? 1 : -1);
                string sp = "";
                try { sp = Math.Round(BbGeom.ToMm(r.MaxSpacing)).ToString(CultureInfo.InvariantCulture); } catch { }
                _items.Add(new Item { Key = "S|" + d + "|" + sp + "|" + num, Qty = 1, Lo = Math.Min(baseS, baseS + len) - 5, Hi = Math.Max(baseS, baseS + len) + 5, Stirrup = true });
            }
            else
            {
                double zc = pts.Average(p => p.Z);
                string side = zc > midZ + BbGeom.Ft(50) ? "T" : zc < midZ - BbGeom.Ft(50) ? "B" : "M";
                double lo = pts.Min(p => BbGeom.ToMm(chain.Station(p))), hi = pts.Max(p => BbGeom.ToMm(chain.Station(p)));
                int qty = 1;
                try { qty = r.Quantity; } catch { }
                _items.Add(new Item { Key = side + "|" + d + "|" + num, Qty = qty, Lo = lo, Hi = hi });
            }
        }

        /// <summary>Тэнхлэгийн дагуух цэг (мм) дээрх гарын үсэг — эрэмбэлсэн, давтагдашгүй бичвэр.  Хоосон = арматургүй.</summary>
        public string At(double stationMm)
        {
            var acc = new SortedDictionary<string, int>(StringComparer.Ordinal);
            foreach (Item i in _items)
            {
                if (stationMm < i.Lo || stationMm > i.Hi) continue;
                acc[i.Key] = (acc.TryGetValue(i.Key, out int n) ? n : 0) + (i.Stirrup ? 0 : i.Qty);
            }
            return string.Join(";", acc.Select(kv => kv.Key + "×" + kv.Value));
        }

        public int Count { get { return _items.Count; } }
    }
}
