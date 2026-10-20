using System;
using Autodesk.Revit.DB;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement
{
    internal enum RfViewUse
    {
        Unsupported = 0,
        Plan,
        Section,
        Elevation,
        Detail,
    }

    /// <summary>Харагдацын crop хайрцаг (харагдацын 2D координатад) + (зүсэлт/фасад/detail-д) гүнгийн муж.</summary>
    internal struct RfCrop
    {
        public bool Active;
        public RfV2 Min, Max;

        /// <summary>Гүнгийн муж crop хайрцгийн Z-ээс (зөвхөн зүсэлт, фасад, detail; план дээр View Range тул ашиглахгүй).</summary>
        public bool DepthActive;
        public double MinZ, MaxZ;
        public Transform Inverse;

        public bool Contains(RfV2 p)
        {
            return !Active || RfEndSymbolMath.InsideRect(p, Min, Max);
        }

        /// <summary>Загварын цэг харагдацын гүнгийн мужид байна уу (муж тодорхойгүй бол үргэлж true).</summary>
        public bool InDepth(XYZ model)
        {
            if (!DepthActive || Inverse == null) return true;
            try
            {
                double z = Inverse.OfPoint(model).Z;
                return z >= MinZ - 0.01 && z <= MaxZ + 0.01;
            }
            catch
            {
                return true;
            }
        }
    }

    internal static class RfConv
    {
        public static RfV3 V(XYZ p) { return new RfV3(p.X, p.Y, p.Z); }
        public static XYZ X(RfV3 v) { return new XYZ(v.X, v.Y, v.Z); }
    }

    /// <summary>
    /// Харагдац → Core-ийн координатын систем.  ⚠️ ХАРАГДАЦЫН координат л ашиглана: `RightDirection`,
    /// `UpDirection`, `ViewDirection`, `Origin` — «world X/Y/Z» гэж ХЭЗЭЭ Ч таамаглахгүй.
    /// </summary>
    internal static class RfView
    {
        /// <summary>
        /// View-specific (харагдацад хамаарах) тэмдэг тавьж болох харагдац: план, зүсэлт, фасад, detail.
        /// 3D, хуудас, хүснэгт, legend, drafting-д арматур/тэмдэг тавигдахгүй.
        /// </summary>
        public static RfViewUse Use(View v)
        {
            if (v == null || v.IsTemplate) return RfViewUse.Unsupported;
            try
            {
                switch (v.ViewType)
                {
                    case ViewType.FloorPlan:
                    case ViewType.EngineeringPlan:
                    case ViewType.CeilingPlan:
                        return RfViewUse.Plan;
                    case ViewType.Section:
                        return RfViewUse.Section;
                    case ViewType.Elevation:
                        return RfViewUse.Elevation;
                    case ViewType.Detail:
                        return RfViewUse.Detail;
                }
            }
            catch
            {
                // ViewType уншигдахгүй — дэмжигдэхгүй.
            }
            return RfViewUse.Unsupported;
        }

        /// <summary>
        /// Харагдацын хавтгайн цэг (annotation, detail шугам, family тавих хавтгай).
        /// ⚠️ `View.Origin` нь ПЛАН дээр утгагүй (Revit-ийн баримт: «The origin of a plan view is not meaningful») —
        /// тиймээс план дээр харагдацын түвшний `ProjectElevation`, бусад үед SketchPlane-ийн цэг, эцэст нь View.Origin.
        /// Энэ нь `CloneDrawings/CdEngine.ViewPlaneOrigin`-ийн бодит Revit дээр шалгагдсан логик.
        /// </summary>
        public static RfV3 PlaneOrigin(View v)
        {
            try
            {
                ViewPlan vp = v as ViewPlan;
                if (vp != null && vp.GenLevel != null)
                    return new RfV3(0, 0, vp.GenLevel.ProjectElevation);
                SketchPlane sp = v.SketchPlane;
                if (sp != null)
                {
                    // Work plane нь харагдацын хавтгайд ТАВИГДСАН үед л (ж: зүсэлтийн work plane нь өөр түвшинд тохируулагдсан байж
                    // болно — тэр үед NewDetailCurve «хавтгайд биш» гэж унана).  Үгүй бол View.Origin (зүсэлт/фасадад хавтгай дээр).
                    XYZ po = sp.GetPlane().Origin;
                    double signedOff = (po - v.Origin).DotProduct(v.ViewDirection);
                    // Хавтгайд (±0.03 мм) орших үед ЦЭГИЙГ хавтгай дээр ТОДОРХОЙ буулгана — үлдэгдэл хазайлт detail шугамыг «хавтгайд биш» болгохгүй.
                    if (Math.Abs(signedOff) < 1e-4) return RfConv.V(po - v.ViewDirection.Multiply(signedOff));
                }
            }
            catch
            {
                // Хавтгай уншигдахгүй — View.Origin.
            }
            return RfConv.V(v.Origin);
        }

        public static RfViewFrame Frame(View v)
        {
            RfV3 right = RfConv.V(v.RightDirection);
            RfV3 up = RfConv.V(v.UpDirection);
            // Нормаль = Right × Up (баруун гарын дүрэм, Revit-ийн ViewDirection-тай ижил): эргэлтийн тэнхлэг, өнцгийн тэмдэг (u, v)-тэй
            // БАЙЦГААМ нийцнэ.  Хоёр вектор давхцсан (хүчингүй) үед л ViewDirection.
            RfV3 normal = right.Cross(up);
            if (normal.Length < 0.5) normal = RfConv.V(v.ViewDirection);
            return new RfViewFrame(PlaneOrigin(v), right, up, normal);
        }

        public static RfCrop Crop(View v, RfViewFrame frame)
        {
            var crop = new RfCrop();
            try
            {
                if (!v.CropBoxActive) return crop;
                BoundingBoxXYZ bb = v.CropBox;
                if (bb == null) return crop;
                Transform tr = bb.Transform;
                double minU = double.MaxValue, minV = double.MaxValue, maxU = double.MinValue, maxV = double.MinValue;
                double[] xs = { bb.Min.X, bb.Max.X };
                double[] ys = { bb.Min.Y, bb.Max.Y };
                foreach (double x in xs)
                {
                    foreach (double y in ys)
                    {
                        RfV2 uv = frame.ToView(RfConv.V(tr.OfPoint(new XYZ(x, y, 0))));
                        if (uv.X < minU) minU = uv.X;
                        if (uv.X > maxU) maxU = uv.X;
                        if (uv.Y < minV) minV = uv.Y;
                        if (uv.Y > maxV) maxV = uv.Y;
                    }
                }
                crop.Active = true;
                crop.Min = new RfV2(minU, minV);
                crop.Max = new RfV2(maxU, maxV);

                RfViewUse use = Use(v);
                if (use == RfViewUse.Section || use == RfViewUse.Elevation || use == RfViewUse.Detail)
                {
                    double z0 = Math.Min(bb.Min.Z, bb.Max.Z), z1 = Math.Max(bb.Min.Z, bb.Max.Z);
                    if (z1 - z0 > 1e-6)
                    {
                        crop.DepthActive = true;
                        crop.MinZ = z0;
                        crop.MaxZ = z1;
                        crop.Inverse = tr.Inverse;
                    }
                }
            }
            catch
            {
                crop.Active = false;
            }
            return crop;
        }
    }
}
