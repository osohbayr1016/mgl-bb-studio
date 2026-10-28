using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using MglBb.Core;
using MglBb.RevitSide;

namespace MglBb.Gate
{
    /// <summary>Gate-ийн үйлдлүүд (scratch harness-аас): үүсгэх, тэмдэглэх, харьцуулах, зураг гаргах.</summary>
    internal static class GateOps
    {
        private static Dictionary<string, string> Kv(string rest)
        {
            var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (string part in (rest ?? "").Split(';'))
            {
                int i = part.IndexOf('=');
                if (i > 0) d[part.Substring(0, i).Trim()] = part.Substring(i + 1).Trim();
                else if (part.Trim().Length > 0) d["_" + d.Count] = part.Trim();
            }
            return d;
        }

        public static BbStandard LoadStd(Dictionary<string, string> kv, string outDir)
        {
            string p = kv.TryGetValue("std", out string sp) ? sp : Path.Combine(outDir, "standard-learned.json");
            // Жинхэнэ ачаалалттай адил (BbStore) — компанийн тогтмол дүрэм давхарлана.
            return BbCompanyRules.Apply(File.Exists(p) ? BbStandard.Load(p) : new BbStandard());
        }

        public static string Run(UIApplication app, Document doc, string op, string rest, string outDir)
        {
            var kv = Kv(rest);
            var sb = new StringBuilder();
            switch (op)
            {
                case "generate":
                    {
                        BbStandard std = LoadStd(kv, outDir);
                        var opt = new BbGenOptions
                        {
                            NameSuffix = kv.TryGetValue("suffix", out string suf) ? suf : " (MGL)",
                            SectionMode = kv.TryGetValue("mode", out string md) ? md : "auto",
                            Existing = "new",
                        };
                        var marks = new List<string>();
                        if (kv.TryGetValue("marks", out string ms)) marks.AddRange(ms.Split(',').Select(x => x.Trim()).Where(x => x.Length > 0));
                        foreach (string mark in marks)
                        {
                            FamilyInstance col = new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_StructuralColumns).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>()
                                .Where(f => BbGeom.Mark(f) == mark).OrderByDescending(BbGeom.RebarCount).FirstOrDefault();
                            if (col != null && !mark.Contains("Н"))
                            {
                                BbColumnStack cs = BbColumns.Stack(doc, col);
                                sb.AppendLine(mark + ": багана " + cs.Members.Count + " давхар, өндөр " + BbGeom.ToMm(cs.Top - cs.Bottom).ToString("0") + " мм, арматур " + cs.RebarCount);
                                BbGenResult cr;
                                using (var t = new Transaction(doc, "MGL ББ gate: " + mark))
                                {
                                    t.Start();
                                    cr = BbColumns.Create(doc, cs, std, opt);
                                    t.Commit();
                                }
                                sb.AppendLine("   дэлгээс " + cr.Elevations.Count + ", огтлол " + cr.Sections.Count + " (давхардсан алгассан " + cr.SkippedDuplicates + ")");
                                foreach (ViewSection v in cr.Elevations.Concat(cr.Sections))
                                {
                                    BoundingBoxXYZ cb = v.CropBox;
                                    sb.AppendLine("     " + v.Id.Value + " «" + v.Name + "» 1:" + v.Scale + " crop " + BbGeom.ToMm(cb.Max.X - cb.Min.X).ToString("0") + "×" + BbGeom.ToMm(cb.Max.Y - cb.Min.Y).ToString("0") +
                                        " depth " + BbGeom.ToMm(cb.Max.Z - cb.Min.Z).ToString("0") + " R " + v.RightDirection + " V " + v.ViewDirection + " tpl=" + (doc.GetElement(v.ViewTemplateId)?.Name ?? "-"));
                                }
                                foreach (string nn in cr.Notes) sb.AppendLine("   note " + nn);
                                foreach (BbIssue i in cr.Issues) sb.AppendLine("   issue " + i.Problem);
                                if (kv.ContainsKey("img"))
                                    foreach (ViewSection v in cr.Elevations.Concat(cr.Sections)) sb.AppendLine("   img " + ExportImage(doc, v, outDir));
                                continue;
                            }
                            FamilyInstance seed = SeedForMark(doc, mark, kv.TryGetValue("level", out string lv) ? lv : null);
                            if (seed == null) { sb.AppendLine(mark + ": seed олдсонгүй"); continue; }
                            BbBeamChain chain = BbGeom.BeamChain(doc, seed, gridOrder: kv.ContainsKey("drawn") ? 0 : kv.TryGetValue("dir", out string gdir) && gdir == "desc" ? -1 : 1);
                            sb.AppendLine(mark + ": гинж " + chain.Members.Count + " элемент, урт " + BbGeom.ToMm(chain.S1 - chain.S0).ToString("0") + " мм, тулгуур " + chain.Supports.Count +
                                ", арматур " + chain.RebarCount + (chain.Aux ? " (туслах)" : ""));
                            BbGenResult r;
                            var sw = System.Diagnostics.Stopwatch.StartNew();
                            using (var t = new Transaction(doc, "MGL ББ gate: " + mark))
                            {
                                t.Start();
                                r = BbViews.CreateBeam(doc, chain, std, opt);
                                t.Commit();
                            }
                            sb.AppendLine("   дэлгээс " + r.Elevations.Count + ", огтлол " + r.Sections.Count + " (давхардсан алгассан " + r.SkippedDuplicates + ") " + sw.ElapsedMilliseconds + " ms");
                            foreach (ViewSection v in r.Elevations.Concat(r.Sections))
                            {
                                BoundingBoxXYZ cb = v.CropBox;
                                sb.AppendLine("     " + v.Id.Value + " «" + v.Name + "» 1:" + v.Scale + " crop " + BbGeom.ToMm(cb.Max.X - cb.Min.X).ToString("0") + "×" + BbGeom.ToMm(cb.Max.Y - cb.Min.Y).ToString("0") +
                                    " depth " + BbGeom.ToMm(cb.Max.Z - cb.Min.Z).ToString("0") + " tpl=" + (doc.GetElement(v.ViewTemplateId)?.Name ?? "-") + " type=" + doc.GetElement(v.GetTypeId())?.Name);
                            }
                            sb.AppendLine("   огтлолын байрлал (мм): " + string.Join(", ", r.Stations.Select(x => x.ToString("0"))));
                            sb.AppendLine("   тулгуур: " + string.Join(" ", chain.Supports.OrderBy(x => x.A).Select(x => x.ToString())));
                            sb.AppendLine("   инженерийн огтлол (мм): " + string.Join(", ", EngineerStations(doc, chain, std).Select(x => x.ToString("0"))));
                            foreach (string n in r.Notes) sb.AppendLine("   note " + n);
                            foreach (BbIssue i in r.Issues) sb.AppendLine("   issue " + i.Problem);
                            if (kv.ContainsKey("img"))
                                foreach (ViewSection v in r.Elevations.Concat(r.Sections)) sb.AppendLine("   img " + ExportImage(doc, v, outDir));
                        }
                        break;
                    }
                case "sig":
                    {
                        BbStandard std = LoadStd(kv, outDir);
                        foreach (string mark in (kv.TryGetValue("marks", out string ms2) ? ms2 : "").Split(',').Select(x => x.Trim()).Where(x => x.Length > 0))
                        {
                            FamilyInstance seed = SeedForMark(doc, mark, null);
                            if (seed == null) continue;
                            BbBeamChain chain = BbGeom.BeamChain(doc, seed);
                            BbRebarSig sig = BbRebarSig.Of(doc, chain);
                            BbMemberStandard m = std.For(chain.Aux ? BbMemberKind.BeamAux : BbMemberKind.Beam);
                            var member = new BbSpan(BbGeom.ToMm(chain.S0), BbGeom.ToMm(chain.S1));
                            var spans = BbLayoutMath.ClearSpans(member, chain.Supports);
                            sb.AppendLine(mark + " members " + string.Join(",", chain.Members.Select(x => x.Id.Value)) + " rebar items " + sig.Count + " spans " + string.Join(" ", spans.Select(x => x.ToString())));
                            foreach (double st in BbLayoutMath.SectionStations(member, spans, chain.Supports, m.SecSupportOffsetMm, m.SecSupportRatio, true, true, m.SecMinGapMm))
                                sb.AppendLine("   cand " + st.ToString("0") + " : " + sig.At(st));
                            foreach (double st in EngineerStations(doc, chain, std))
                                sb.AppendLine("   ENG  " + st.ToString("0") + " : " + sig.At(st));
                        }
                        break;
                    }
                case "annotate":
                    {
                        BbStandard std = LoadStd(kv, outDir);
                        string suffix = kv.TryGetValue("suffix", out string suf2) ? suf2 : "(MGL)";
                        var marks = (kv.TryGetValue("marks", out string ms3) ? ms3 : "").Split(',').Select(x => x.Trim()).Where(x => x.Length > 0).ToList();
                        var rep = new BbAnnoReport();
                        var views = new FilteredElementCollector(doc).OfClass(typeof(ViewSection)).Cast<ViewSection>()
                            .Where(v => !v.IsTemplate && v.Name.Contains(suffix) && marks.Any(m => BbNames.IndexOfMark(v.Name, m) >= 0)).ToList();
                        var sw = System.Diagnostics.Stopwatch.StartNew();
                        foreach (ViewSection v in views)
                        {
                            BbViewSample smp = BbLearner.Classify(doc, v);
                            if (smp == null) { sb.AppendLine("  «" + v.Name + "»: ангилагдсангүй"); continue; }
                            if (kv.TryGetValue("only", out string only) && ((only == "elev" && smp.IsSection) || (only == "sec" && !smp.IsSection))) continue;
                            BbMemberStandard m = std.For(smp.Kind);
                            if (smp.IsSection) BbAnnotate.Section(doc, v, smp.Host, m, rep, smp.Mark);
                            else
                            {
                                BbAnnotate.Elevation(doc, v, BbAnnotate.ElevationHosts(doc, v, smp), m, rep, smp.Mark);
                            }
                            sb.AppendLine("  «" + v.Name + "» → " + smp.Kind + (smp.IsSection ? " огтлол" : " дэлгээс") + " " + Counts(doc, v));
                            if (kv.ContainsKey("img")) sb.AppendLine("     img " + ExportImage(doc, v, outDir));
                        }
                        sb.AppendLine("views " + rep.Views + " secDims " + rep.SecDims + " memberDims " + rep.SecMemberDims + " secTags " + rep.SecTags + " barChains " + rep.BarChains + " (+" + rep.BarChainRefs + " refs)" +
                            " elevTags " + rep.ElevTags + " (side " + rep.ElevSideTags + ") mras " + rep.ElevMras + " (dupes " + rep.ElevStirrupDupes + ")" + " laps " + rep.ElevLaps + " spans " + rep.ElevSpans + " in " + sw.ElapsedMilliseconds + " ms");
                        foreach (string n in rep.Notes.Take(40)) sb.AppendLine("  note " + n);
                        foreach (BbIssue i in rep.Issues.Take(40)) sb.AppendLine("  issue " + i.View + ": " + i.Problem);
                        break;
                    }
                case "learnview":
                    {
                        // «Стандарт сурах»-ын заасан горим (нэг харагдац) — std= суурь дээр, standard-learned.json руу.
                        BbStandard baseStd = LoadStd(kv, outDir);
                        string vname = kv.TryGetValue("view", out string vn8) ? vn8 : "";
                        var names = new HashSet<string>(vname.Split('|').Select(x => x.Trim()));   // олон харагдац: «A|B»
                        var only = new HashSet<long>(new FilteredElementCollector(doc).OfClass(typeof(ViewSection)).Cast<ViewSection>().Where(x => names.Contains(x.Name)).Select(x => x.Id.Value));
                        BbStandard learned = BbLearner.Learn(doc, baseStd, 100000, out BbLearnReport lr, only);
                        learned.Save(Path.Combine(outDir, "standard-learned.json"));
                        File.WriteAllText(Path.Combine(outDir, "learn-elev.txt"), lr.ElevDump.ToString(), new UTF8Encoding(true));
                        sb.AppendLine("views " + only.Count + " classified " + lr.Classified + " fields " + lr.FieldsLearned);
                        string flt = kv.TryGetValue("keys", out string ks) ? ks : "";
                        if (flt.Length > 0)
                            foreach (string key in lr.Samples.Keys.Where(x => flt.Split(',').Any(x.Contains)))
                                sb.AppendLine("  sample " + key + " n=" + lr.Samples.Count(key) + " med=" + lr.Samples.Median(key) + " mode=" + lr.Samples.Mode(key) + " hist " + string.Join(", ", lr.Samples.Histogram(key).Take(6).Select(h => h.Key + "×" + h.Value)));
                        foreach (string key in new[] { "ElevDimFirstPaperMm", "DimPitchPaperMm", "StirrupDimOffsetPaperMm", "ElevEndSymBottom", "ElevEndSymTop" })
                            sb.AppendLine("  " + key + " = " + typeof(BbMemberStandard).GetField(key)?.GetValue(learned.Beam));
                        break;
                    }
                case "dimtest":
                    {
                        // Огтлолын ирмэгийн хос лавлагаагаар хэмжээс: шугамын (u, гүн) бүрд үүссэн байрлал (буцаана).
                        string vname = kv.TryGetValue("view", out string vn3b) ? vn3b : "";
                        var v = new FilteredElementCollector(doc).OfClass(typeof(ViewSection)).Cast<ViewSection>().FirstOrDefault(x => x.Name == vname);
                        BbFrame f = BbFrame.Of(v);
                        var refs = kv["refs"].Split('|').Select(x => x.Trim()).Select(x => x.StartsWith("el:") ? new Reference(doc.GetElement(new ElementId(long.Parse(x.Substring(3))))) : Reference.ParseFromStableRepresentation(doc, x)).ToList();
                        double r0t = kv.TryGetValue("r0", out string r0s) ? double.Parse(r0s) : 2000, r1t = kv.TryGetValue("r1", out string r1s) ? double.Parse(r1s) : 3500;
                        using (var t = new Transaction(doc, "dimtest"))
                        {
                            t.Start();
                            foreach (string zs in kv["z"].Split(','))
                            {
                                double z = BbGeom.Ft(double.Parse(zs)), u = BbGeom.Ft(double.Parse(kv["u"]));
                                using (var st = new SubTransaction(doc))
                                {
                                    st.Start();
                                    try
                                    {
                                        var ra = new ReferenceArray(); foreach (Reference r in refs) ra.Append(r);
                                        Dimension d = doc.Create.NewDimension(v, Line.CreateBound(f.World(BbGeom.Ft(r0t), u, z), f.World(BbGeom.Ft(r1t), u, z)), ra);
                                        doc.Regenerate();
                                        XYZ o = f.Local((d.Curve as Line).Origin);
                                        sb.AppendLine("z " + zs + " → u " + BbGeom.ToMm(o.Y).ToString("0") + " z " + BbGeom.ToMm(o.Z).ToString("0"));
                                    }
                                    catch (Exception ex) { sb.AppendLine("z " + zs + " FAIL " + ex.Message.Split('\n')[0]); }
                                    st.RollBack();
                                }
                            }
                            t.RollBack();
                        }
                        break;
                    }
                case "cutedge":
                    {
                        // Налуу нүүрний огтлолын ирмэгийн лавлагаа (…:24:CUT_EDGE/k) — аль k хүчинтэй вэ (түр хэмжээс, буцаана).
                        string vname = kv.TryGetValue("view", out string vn4) ? vn4 : "";
                        var v = new FilteredElementCollector(doc).OfClass(typeof(ViewSection)).Cast<ViewSection>().FirstOrDefault(x => x.Name == vname);
                        Element e = doc.GetElement(new ElementId(long.Parse(kv["el"])));
                        BbFrame f = BbFrame.Of(v);
                        string uid = e.UniqueId;
                        // Харагдацын геометрээс ирмэгүүд (Edge.Reference) — нүүрний ирмэг бүр.
                        GeometryElement ge = e.get_Geometry(new Options { ComputeReferences = true, View = v });
                        BbElevTopChain.Walk(ge, Transform.Identity, (so, tr) =>
                        {
                            foreach (Edge ed in so.Edges)
                            {
                                Reference r = ed.Reference;
                                if (r == null) continue;
                                Curve c = ed.AsCurve();
                                if (!(c is Line l)) continue;
                                XYZ a = f.Local(tr.OfPoint(l.GetEndPoint(0))), b = f.Local(tr.OfPoint(l.GetEndPoint(1)));
                                if (Math.Abs(a.Z) > 0.05 || Math.Abs(b.Z) > 0.05) continue;   // харагдацын хавтгай дахь ирмэг
                                sb.AppendLine("edge " + r.ConvertToStableRepresentation(doc) + " r " + BbGeom.ToMm(a.X).ToString("0") + ".." + BbGeom.ToMm(b.X).ToString("0") + " u " + BbGeom.ToMm(a.Y).ToString("0") + ".." + BbGeom.ToMm(b.Y).ToString("0"));
                            }
                        });
                        foreach (string fa in new[] { "24", "28" })
                            for (int k = 0; k < 8; k++)
                            {
                                string rep = uid + ":" + fa + ":CUT_EDGE/" + k;
                                try
                                {
                                    Reference r = Reference.ParseFromStableRepresentation(doc, rep);
                                    sb.AppendLine("parse " + rep.Substring(rep.Length - 14) + " ok " + (r != null));
                                }
                                catch (Exception ex) { sb.AppendLine("parse " + fa + "/" + k + " fail " + ex.Message.Split('\n')[0]); }
                            }
                        break;
                    }
                case "dimrefs":
                    {
                        foreach (string id in (kv.TryGetValue("ids", out string ids5) ? ids5 : "").Split(','))
                        {
                            if (!(doc.GetElement(new ElementId(long.Parse(id.Trim()))) is Dimension d)) { sb.AppendLine(id + ": no dim"); continue; }
                            sb.AppendLine("DIM " + id + " view " + d.OwnerViewId.Value);
                            var vv = doc.GetElement(d.OwnerViewId) as View;
                            if (vv != null && d.Curve is Line dl)
                            {
                                BbFrame ff = BbFrame.Of(vv);
                                Func<XYZ, string> L = q => { XYZ z = ff.Local(q); return "(" + BbGeom.ToMm(z.X).ToString("0") + "," + BbGeom.ToMm(z.Y).ToString("0") + "," + BbGeom.ToMm(z.Z).ToString("0") + ")"; };
                                sb.AppendLine("   curve origin " + L(dl.Origin) + " dir " + dl.Direction.DotProduct(ff.R).ToString("0.000") + " segs " + (d.Segments?.Size ?? 0) + (d.Segments != null && d.Segments.Size > 0 ? " seg0 " + L(d.Segments.get_Item(0).Origin) : " dimOrigin " + L(d.Origin)));
                            }
                            foreach (Reference r in d.References) sb.AppendLine("   " + r.ConvertToStableRepresentation(doc) + " type " + r.ElementReferenceType);
                        }
                        string vname = kv.TryGetValue("view", out string vn5) ? vn5 : "";
                        var v = new FilteredElementCollector(doc).OfClass(typeof(ViewSection)).Cast<ViewSection>().FirstOrDefault(x => x.Name == vname);
                        if (v != null && kv.TryGetValue("el", out string el))
                        {
                            BbFrame f = BbFrame.Of(v);
                            Element e = doc.GetElement(new ElementId(long.Parse(el)));
                            BbElevTopChain.Walk(e.get_Geometry(new Options { ComputeReferences = true, View = v }), Transform.Identity, (so, tr) =>
                            {
                                foreach (Face fc in so.Faces)
                                    if (fc is PlanarFace pf && pf.Reference != null && Math.Abs(tr.OfVector(pf.FaceNormal).DotProduct(f.R)) > 0.9)
                                        sb.AppendLine("   face " + pf.Reference.ConvertToStableRepresentation(doc) + " R " + BbGeom.ToMm(BbElevStirrupDims.PlaneR(f, tr.OfPoint(pf.Origin), tr.OfVector(pf.FaceNormal))).ToString("0") + " solidVol " + so.Volume.ToString("0.000"));
                            });
                        }
                        break;
                    }
                case "cropinfo":
                    {
                        foreach (string vname in (kv.TryGetValue("view", out string vn6) ? vn6 : "").Split('|'))
                        {
                            var v = new FilteredElementCollector(doc).OfClass(typeof(ViewSection)).Cast<ViewSection>().FirstOrDefault(x => x.Name == vname.Trim());
                            if (v == null) { sb.AppendLine("no view " + vname); continue; }
                            BoundingBoxXYZ cb = v.CropBox;
                            var mgr = v.GetCropRegionShapeManager();
                            sb.AppendLine("«" + v.Name + "» crop " + v.CropBoxActive + " visible " + v.CropBoxVisible + " min " + BbGeom.ToMm(cb.Min.X).ToString("0") + "," + BbGeom.ToMm(cb.Min.Y).ToString("0") + "," + BbGeom.ToMm(cb.Min.Z).ToString("0")
                                + " max " + BbGeom.ToMm(cb.Max.X).ToString("0") + "," + BbGeom.ToMm(cb.Max.Y).ToString("0") + "," + BbGeom.ToMm(cb.Max.Z).ToString("0")
                                + " annoCrop " + v.get_Parameter(BuiltInParameter.VIEWER_ANNOTATION_CROP_ACTIVE)?.AsInteger()
                                + " offsets L" + BbGeom.ToMm(mgr.LeftAnnotationCropOffset).ToString("0") + " R" + BbGeom.ToMm(mgr.RightAnnotationCropOffset).ToString("0") + " T" + BbGeom.ToMm(mgr.TopAnnotationCropOffset).ToString("0") + " B" + BbGeom.ToMm(mgr.BottomAnnotationCropOffset).ToString("0")
                                + " shapeSplit " + mgr.Split + " template " + v.ViewTemplateId.Value);
                            var own = new FilteredElementCollector(doc).OwnedByView(v.Id).ToElements();
                            var vis = new HashSet<long>(new FilteredElementCollector(doc, v.Id).ToElementIds().Select(x => x.Value));
                            foreach (var g in own.GroupBy(e => e.Category?.Name ?? e.GetType().Name))
                                sb.AppendLine("   " + g.Key + " owned " + g.Count() + " visible " + g.Count(e => vis.Contains(e.Id.Value)));
                            View fv = v.ViewTemplateId != ElementId.InvalidElementId ? doc.GetElement(v.ViewTemplateId) as View ?? v : v;
                            var tagsOwn = own.OfType<IndependentTag>().ToList();
                            IndependentTag hid = tagsOwn.FirstOrDefault(x => !vis.Contains(x.Id.Value)), shown = tagsOwn.FirstOrDefault(x => vis.Contains(x.Id.Value) && x.GetTypeId() == hid?.GetTypeId());
                            foreach (ElementId fid in fv.GetFilters())
                            {
                                var pf = doc.GetElement(fid) as FilterElement;
                                string pass = "";
                                try
                                {
                                    ElementFilter ef = (pf as ParameterFilterElement)?.GetElementFilter();
                                    var cats = (pf as ParameterFilterElement)?.GetCategories();
                                    bool catTag = cats != null && cats.Contains(new ElementId(BuiltInCategory.OST_RebarTags));
                                    if (hid != null) pass += " hid:" + (catTag && (ef == null || ef.PassesFilter(hid)));
                                    if (shown != null) pass += " shown:" + (catTag && (ef == null || ef.PassesFilter(shown)));
                                }
                                catch (Exception ex) { pass = " err " + ex.Message.Split('\n')[0]; }
                                sb.AppendLine("   FILTER «" + pf?.Name + "» visible " + fv.GetFilterVisibility(fid) + pass);
                            }
                            if (hid != null) foreach (Parameter pr in hid.Parameters) { string a1 = pr.AsValueString() ?? pr.AsString() ?? ""; string b1 = shown == null ? "" : (shown.get_Parameter(pr.Definition)?.AsValueString() ?? shown.get_Parameter(pr.Definition)?.AsString() ?? ""); if (a1 != b1) sb.AppendLine("   PARAM " + pr.Definition.Name + " hid=" + a1 + " shown=" + b1); }
                            BbFrame cf = BbFrame.Of(v);
                            foreach (var rbx in new FilteredElementCollector(doc, v.Id).OfClass(typeof(Autodesk.Revit.DB.Structure.Rebar)).Cast<Autodesk.Revit.DB.Structure.Rebar>())
                            {
                                var zs = new List<string>();
                                for (int i = 0; i < rbx.NumberOfBarPositions; i++)
                                {
                                    double z = 0; try { z = v.CropBox.Transform.Inverse.OfPoint(rbx.GetTransformedCenterlineCurves(false, true, true, Autodesk.Revit.DB.Structure.MultiplanarOption.IncludeOnlyPlanarCurves, i)[0].Evaluate(0.5, true)).Z; } catch { }
                                    zs.Add(i + ":" + BbGeom.ToMm(z).ToString("0"));
                                }
                                var vz = new List<string>();
                                try { foreach (GeometryObject go in rbx.get_Geometry(new Options { View = v })) if (go is Curve cc) vz.Add(BbGeom.ToMm(v.CropBox.Transform.Inverse.OfPoint(cc.Evaluate(0.5, true)).Z).ToString("0")); } catch { }
                                sb.AppendLine("   REBAR " + rbx.Id.Value + " mode " + rbx.GetPresentationMode(v) + " bars " + string.Join(" ", zs) + " | visible geom z " + string.Join(",", vz.Distinct()));
                            }
                            foreach (IndependentTag t in own.OfType<IndependentTag>())
                            {
                                string tg = ""; try { tg = string.Join(",", t.GetTaggedLocalElementIds().Select(x => x.Value + (vis.Contains(x.Value) ? "" : "(hidden)"))); } catch { }
                                try { tg += " refs " + string.Join(",", t.GetTaggedReferences().Select(r => r.ConvertToStableRepresentation(doc).Split(':').Skip(1).DefaultIfEmpty("").Aggregate((x, y) => x + ":" + y))); } catch { }
                                XYZ h = cf.Local(t.TagHeadPosition);
                                var tt = doc.GetElement(t.GetTypeId()) as FamilySymbol;
                                sb.AppendLine("   TAG " + t.Id.Value + " type «" + tt?.FamilyName + " : " + tt?.Name + "» typeId " + t.GetTypeId().Value + " ws " + t.WorksetId.IntegerValue + " orient " + t.TagOrientation + " vis " + vis.Contains(t.Id.Value) + " hiddenInView " + t.IsHidden(v) + " head " + BbGeom.ToMm(h.X).ToString("0") + "," + BbGeom.ToMm(h.Y).ToString("0") + "," + BbGeom.ToMm(h.Z).ToString("0") + " → " + tg + " txt " + (t.TagText ?? "").Replace('\n', ' '));
                            }
                        }
                        break;
                    }
                case "supports":
                    {
                        string vname = kv.TryGetValue("view", out string vn7) ? vn7 : "";
                        var v = new FilteredElementCollector(doc).OfClass(typeof(ViewSection)).Cast<ViewSection>().FirstOrDefault(x => x.Name == vname);
                        if (v == null) { sb.AppendLine("no view"); break; }
                        BbFrame f = BbFrame.Of(v);
                        foreach (var sp in BbElevStirrupDims.Supports(doc, v, f, true))
                            sb.AppendLine("support r " + BbGeom.ToMm(sp.R0).ToString("0") + ".." + BbGeom.ToMm(sp.R1).ToString("0"));
                        foreach (Element e in new FilteredElementCollector(doc, v.Id).OfCategory(BuiltInCategory.OST_StructuralFraming).WhereElementIsNotElementType())
                        {
                            string dir = e.Location is LocationCurve lc && lc.Curve is Line ln ? Math.Abs(ln.Direction.DotProduct(f.R)).ToString("0.000") : (e.Location is LocationCurve lc2 ? lc2.Curve.GetType().Name : "nolc");
                            var faces = new List<string>();
                            try
                            {
                                GeometryElement ge = e.get_Geometry(new Options { ComputeReferences = true, View = v });
                                BbElevTopChain.Walk(ge, Transform.Identity, (so, tr) =>
                                {
                                    foreach (Face fc in so.Faces)
                                        if (fc is PlanarFace pf) { XYZ nn = tr.OfVector(pf.FaceNormal); if (Math.Abs(nn.DotProduct(f.R)) > 0.9) faces.Add(BbGeom.ToMm(f.Local(tr.OfPoint(pf.Origin)).X).ToString("0") + (pf.Reference == null ? "(noref)" : "") + "/" + Math.Abs(nn.DotProduct(f.R)).ToString("0.000")); }
                                });
                            }
                            catch (Exception ex) { faces.Add("ERR " + ex.Message); }
                            sb.AppendLine("framing " + e.Id.Value + " " + e.Name + " dir·R " + dir + " faces " + string.Join(" ", faces));
                        }
                        break;
                    }
                case "dupanno":
                    {
                        // Инженерийн харагдацыг (тэмдэглэгээгүй) хуулбарлаж плагинаар тэмдэглээд хоёуланг нь BbElevDump-аар — «сурах → харьцуулах» давталт.
                        BbStandard std = LoadStd(kv, outDir);
                        string vname = kv.TryGetValue("view", out string vn9) ? vn9 : "";
                        var src = new FilteredElementCollector(doc).OfClass(typeof(ViewSection)).Cast<ViewSection>().FirstOrDefault(x => x.Name == vname);
                        if (src == null) { sb.AppendLine("no view"); break; }
                        ViewSection dup;
                        using (var t = new Transaction(doc, "gate dup"))
                        {
                            t.Start();
                            dup = doc.GetElement(src.Duplicate(ViewDuplicateOption.Duplicate)) as ViewSection;
                            dup.Name = vname + " (MGL " + DateTime.Now.ToString("HHmmss") + ")";
                            t.Commit();
                        }
                        BbViewSample smp = BbLearner.Classify(doc, dup);
                        if (smp == null) { sb.AppendLine("ангилагдсангүй"); break; }
                        var rep = new BbAnnoReport();
                        BbAnnotate.Elevation(doc, dup, BbAnnotate.ElevationHosts(doc, dup, smp), std.For(smp.Kind), rep, smp.Mark);
                        sb.AppendLine("«" + dup.Name + "» " + Counts(doc, dup) + " tags " + rep.ElevTags + " mras " + rep.ElevMras + " laps " + rep.ElevLaps + " spans " + rep.ElevSpans);
                        foreach (string n in rep.Notes.Take(20)) sb.AppendLine("  note " + n);
                        foreach (BbIssue i in rep.Issues.Take(20)) sb.AppendLine("  issue " + i.Problem);
                        foreach (ViewSection v in new[] { src, dup })
                        {
                            var dump = new StringBuilder();
                            BbViewSample s2 = BbLearner.Classify(doc, v);
                            if (s2 != null) BbElevDump.Beam(doc, s2, dump);
                            File.WriteAllText(Path.Combine(outDir, (v == src ? "eng" : "mgl") + "-elev.txt"), dump.ToString(), new UTF8Encoding(true));
                        }
                        if (kv.ContainsKey("img")) sb.AppendLine("img " + ExportImage(doc, dup, outDir) + " | " + ExportImage(doc, src, outDir));
                        break;
                    }
                case "compare":
                    {
                        string suffix = kv.TryGetValue("suffix", out string suf3) ? suf3 : " (MGL)";
                        var marks = (kv.TryGetValue("marks", out string ms4) ? ms4 : "").Split(',').Select(x => x.Trim()).Where(x => x.Length > 0).ToList();
                        var all = new FilteredElementCollector(doc).OfClass(typeof(ViewSection)).Cast<ViewSection>().Where(v => !v.IsTemplate).ToList();
                        foreach (ViewSection g in all.Where(v => v.Name.EndsWith(suffix, StringComparison.Ordinal) && marks.Any(m => BbNames.IndexOfMark(v.Name, m) >= 0)).OrderBy(v => v.Name))
                        {
                            string baseName = g.Name.Substring(0, g.Name.Length - suffix.Length);
                            ViewSection e = all.FirstOrDefault(v => v.Name == baseName);
                            sb.AppendLine("«" + baseName + "»  инженер: " + (e == null ? "—" : Counts(doc, e)) + "   MGL: " + Counts(doc, g));
                        }
                        break;
                    }
                case "extents":
                    {
                        foreach (string id in (kv.TryGetValue("views", out string vs2) ? vs2 : "").Split(','))
                        {
                            if (!long.TryParse(id.Trim(), out long l) || !(doc.GetElement(new ElementId(l)) is View v)) continue;
                            BbFrame f = BbFrame.Of(v);
                            BoundingBoxXYZ cb = v.CropBox;
                            sb.AppendLine("«" + v.Name + "» crop r " + BbGeom.ToMm(cb.Min.X).ToString("0") + ".." + BbGeom.ToMm(cb.Max.X).ToString("0") + " u " + BbGeom.ToMm(cb.Min.Y).ToString("0") + ".." + BbGeom.ToMm(cb.Max.Y).ToString("0"));
                            foreach (Element e in new FilteredElementCollector(doc, v.Id).WhereElementIsNotElementType())
                            {
                                BoundingBoxXYZ bb;
                                try { bb = e.get_BoundingBox(v); } catch { continue; }
                                if (bb == null) continue;
                                f.Extent(bb, out XYZ a, out XYZ b);
                                double out1 = Math.Max(Math.Max(cb.Min.X - a.X, b.X - cb.Max.X), Math.Max(cb.Min.Y - a.Y, b.Y - cb.Max.Y));
                                if (out1 > BbGeom.Ft(1500))
                                    sb.AppendLine("   " + e.Id.Value + " " + e.GetType().Name + " " + (e.Category?.Name ?? "") + " owner=" + (e.OwnerViewId == v.Id) + " r " + BbGeom.ToMm(a.X).ToString("0") + ".." + BbGeom.ToMm(b.X).ToString("0") + " u " + BbGeom.ToMm(a.Y).ToString("0") + ".." + BbGeom.ToMm(b.Y).ToString("0") + " name=" + e.Name);
                            }
                        }
                        break;
                    }
                case "refs":
                    {
                        // Инженерийн огтлолын хэмжээсийн арматурын лавлагаа ба тэр арматурын харагдацын геометрийн лавлагаанууд.
                        string vname = kv.TryGetValue("view", out string vn) ? vn : "ДН-1 S1";
                        View v = new FilteredElementCollector(doc).OfClass(typeof(ViewSection)).Cast<View>().FirstOrDefault(x => x.Name == vname);
                        if (v == null) { sb.AppendLine("no view"); break; }
                        BbFrame f = BbFrame.Of(v);
                        var rebars = new HashSet<long>();
                        foreach (Dimension d in new FilteredElementCollector(doc, v.Id).OfClass(typeof(Dimension)).Cast<Dimension>())
                        {
                            if (d.OwnerViewId != v.Id) continue;
                            sb.AppendLine("DIM " + d.Id.Value);
                            foreach (Reference r in d.References)
                            {
                                Element re = doc.GetElement(r.ElementId);
                                string st = "";
                                try { st = r.ConvertToStableRepresentation(doc); } catch { }
                                sb.AppendLine("   " + (re?.GetType().Name ?? "?") + " " + r.ElementReferenceType + " " + st.Substring(Math.Max(0, st.Length - 40)));
                                if (re is Autodesk.Revit.DB.Structure.Rebar) rebars.Add(re.Id.Value);
                            }
                        }
                        foreach (long rid in rebars.Take(3))
                        {
                            var rb = (Autodesk.Revit.DB.Structure.Rebar)doc.GetElement(new ElementId(rid));
                            sb.AppendLine("REBAR " + rid + " positions " + rb.NumberOfBarPositions);
                            foreach (var o in new[] { new Options { ComputeReferences = true, View = v, IncludeNonVisibleObjects = true }, new Options { ComputeReferences = true, DetailLevel = ViewDetailLevel.Fine } })
                            {
                                sb.AppendLine("  options view=" + (o.View != null));
                                int n = 0;
                                Dump(doc, rb, rb.get_Geometry(o), f, sb, ref n, 0);
                            }
                        }
                        break;
                    }
                case "anno":
                    {
                        // Харагдацын MRA (хэмжээс + шошго) ба бие даасан шошгоны дэлгэрэнгүй — цаасны мм, BbFrame-ийн хүрээнд.
                        string vname = kv.TryGetValue("view", out string vn2) ? vn2 : "";
                        View v = new FilteredElementCollector(doc).OfClass(typeof(ViewSection)).Cast<View>().FirstOrDefault(x => x.Name == vname);
                        if (v == null) { sb.AppendLine("no view"); break; }
                        BbFrame f = BbFrame.Of(v);
                        double sc = v.Scale;
                        Func<XYZ, string> P = p => p == null ? "-" : "(" + (BbGeom.ToMm(f.Local(p).X) / sc).ToString("0.0") + "," + (BbGeom.ToMm(f.Local(p).Y) / sc).ToString("0.0") + ")";
                        BoundingBoxXYZ cb = v.CropBox;
                        sb.AppendLine("«" + v.Name + "» 1:" + sc + " crop paper r " + (BbGeom.ToMm(cb.Min.X) / sc).ToString("0") + ".." + (BbGeom.ToMm(cb.Max.X) / sc).ToString("0") + " u " + (BbGeom.ToMm(cb.Min.Y) / sc).ToString("0") + ".." + (BbGeom.ToMm(cb.Max.Y) / sc).ToString("0"));
                        var mraTags = new HashSet<long>();
                        foreach (MultiReferenceAnnotation m in new FilteredElementCollector(doc, v.Id).OfClass(typeof(MultiReferenceAnnotation)).Cast<MultiReferenceAnnotation>())
                        {
                            var d = doc.GetElement(m.DimensionId) as Dimension;
                            var t = doc.GetElement(m.TagId) as IndependentTag;
                            if (t != null) mraTags.Add(t.Id.Value);
                            var rebarIds = new HashSet<long>();
                            int nref = 0;
                            if (d != null) foreach (Reference r in d.References) { nref++; rebarIds.Add(r.ElementId.Value); }
                            string line = "-";
                            if (d?.Curve is Line l && l.IsBound) line = P(l.GetEndPoint(0)) + "→" + P(l.GetEndPoint(1));
                            else if (d != null && d.Segments != null && d.Segments.Size > 0) line = "seg " + P(d.Segments.get_Item(0).Origin) + ".." + P(d.Segments.get_Item(d.Segments.Size - 1).Origin);
                            else if (d != null) { try { line = "o" + P(d.Origin); } catch { } }
                            string head = "-", lead = "";
                            if (t != null)
                            {
                                try { head = P(t.TagHeadPosition); } catch { }
                                try { lead = " leader=" + t.HasLeader + " " + t.LeaderEndCondition; } catch { }
                                try
                                {
                                    BoundingBoxXYZ tb = t.get_BoundingBox(v);
                                    if (tb != null) { f.Extent(tb, out XYZ ta, out XYZ tz); lead += " bb u " + (BbGeom.ToMm(ta.X) / sc).ToString("0.0") + ".." + (BbGeom.ToMm(tz.X) / sc).ToString("0.0") + " v " + (BbGeom.ToMm(ta.Y) / sc).ToString("0.0") + ".." + (BbGeom.ToMm(tz.Y) / sc).ToString("0.0"); }
                                }
                                catch { }
                            }
                            string bars = string.Join(",", rebarIds.Select(id => { var rb = doc.GetElement(new ElementId(id)) as Autodesk.Revit.DB.Structure.Rebar; return id + (rb != null ? "[" + rb.NumberOfBarPositions + "]" : ""); }));
                            string seg = d != null && d.Segments != null && d.Segments.Size > 0 ? " segs " + d.Segments.Size + " v0 " + BbGeom.ToMm(d.Segments.get_Item(0).Value ?? 0).ToString("0") : (d != null ? " v " + BbGeom.ToMm(d.Value ?? 0).ToString("0") : "");
                            sb.AppendLine("MRA " + m.Id.Value + " " + doc.GetElement(m.GetTypeId())?.Name + " refs " + nref + seg + " line " + line + " head " + head + lead + " bars " + bars);
                        }
                        foreach (IndependentTag t in new FilteredElementCollector(doc, v.Id).OfClass(typeof(IndependentTag)).Cast<IndependentTag>())
                        {
                            if (mraTags.Contains(t.Id.Value)) continue;
                            string head = "-";
                            try { head = P(t.TagHeadPosition); } catch { }
                            string tagged = "";
                            try { tagged = string.Join(",", t.GetTaggedLocalElementIds().Select(x => x.Value)); } catch { }
                            string elbow = "", end = "";
                            try
                            {
                                foreach (Reference r in t.GetTaggedReferences())
                                {
                                    try { elbow += P(t.GetLeaderElbow(r)); } catch { }
                                    try { end += P(t.GetLeaderEnd(r)); } catch { }
                                }
                            }
                            catch { }
                            string tbb = "";
                            try
                            {
                                BoundingBoxXYZ tb = t.get_BoundingBox(v);
                                if (tb != null) { f.Extent(tb, out XYZ ta, out XYZ tz); tbb = " bb u " + (BbGeom.ToMm(ta.X) / sc).ToString("0.0") + ".." + (BbGeom.ToMm(tz.X) / sc).ToString("0.0") + " v " + (BbGeom.ToMm(ta.Y) / sc).ToString("0.0") + ".." + (BbGeom.ToMm(tz.Y) / sc).ToString("0.0"); }
                            }
                            catch { }
                            sb.AppendLine("TAG " + t.Id.Value + " " + doc.GetElement(t.GetTypeId())?.Name + " head " + head + " leader=" + t.HasLeader + " " + t.LeaderEndCondition + " elbow " + elbow + " end " + end + tbb + " tagged " + tagged + " txt " + (t.TagText ?? "").Replace('\n', ' ').Replace('\r', ' '));
                        }
                        break;
                    }
                case "barrefs":
                    {
                        string vname = kv.TryGetValue("view", out string vn3) ? vn3 : "";
                        var v = new FilteredElementCollector(doc).OfClass(typeof(ViewSection)).Cast<ViewSection>().FirstOrDefault(x => x.Name == vname);
                        if (v == null) { sb.AppendLine("no view"); break; }
                        BbViewSample smp = BbLearner.Classify(doc, v);
                        if (smp == null) { sb.AppendLine("not classified"); break; }
                        IList<Element> hosts = BbGeom.ChainHostsInView(doc, v, smp.Host);
                        sb.AppendLine("host " + smp.Host.Id.Value + " hosts " + string.Join(",", hosts.Select(h => h.Id.Value)));
                        sb.Append(BbBarChain.Diagnose(doc, v, hosts));
                        break;
                    }
                case "sheet":
                    {
                        BbStandard std = LoadStd(kv, outDir);
                        string suffix = kv.TryGetValue("suffix", out string suf5) ? suf5 : "(MGL)";
                        foreach (string mark in (kv.TryGetValue("marks", out string ms5) ? ms5 : "").Split(',').Select(x => x.Trim()).Where(x => x.Length > 0))
                        {
                            var views = new FilteredElementCollector(doc).OfClass(typeof(ViewSection)).Cast<ViewSection>()
                                .Where(v => !v.IsTemplate && v.Name.Contains(suffix) && BbNames.IndexOfMark(v.Name, mark) >= 0).ToList();
                            var elevs = new List<ViewSection>(); var secs = new List<ViewSection>();
                            BbMemberKind kind = BbMemberKind.Beam;
                            foreach (ViewSection v in views)
                            {
                                BbViewSample smp = BbLearner.Classify(doc, v);
                                if (smp == null) continue;
                                kind = smp.Kind;
                                (smp.IsSection ? secs : elevs).Add(v);
                            }
                            elevs = elevs.OrderBy(v => v.Name, StringComparer.Ordinal).ToList();
                            secs = secs.OrderBy(v => SecNo(v.Name)).ToList();
                            var issues = new List<BbIssue>(); var notes = new List<string>();
                            List<ViewSheet> sheets;
                            using (var t = new Transaction(doc, "MGL ББ gate: хуудас " + mark))
                            {
                                t.Start();
                                sheets = BbSheets.Place(doc, mark, kind, elevs.Cast<View>().ToList(), secs.Cast<View>().ToList(), std, issues, notes);
                                t.Commit();
                            }
                            sb.AppendLine(mark + ": дэлгээс " + elevs.Count + ", огтлол " + secs.Count + " → хуудас " + sheets.Count);
                            foreach (ViewSheet sh in sheets)
                            {
                                sb.AppendLine("   " + sh.Id.Value + " «" + sh.SheetNumber + " " + sh.Name + "» viewports " + sh.GetAllViewports().Count);
                                foreach (ElementId vid in sh.GetAllViewports())
                                {
                                    var vpp = (Viewport)doc.GetElement(vid);
                                    var vv = (View)doc.GetElement(vpp.ViewId);
                                    Outline bo = vpp.GetBoxOutline();
                                    BbSheets.Rect cr = BbSheets.Content(doc, vpp, vv);
                                    sb.AppendLine("      " + vv.Name + " box " + ((bo.MaximumPoint.X - bo.MinimumPoint.X) * 304.8).ToString("0") + "x" + ((bo.MaximumPoint.Y - bo.MinimumPoint.Y) * 304.8).ToString("0") + " content " + (cr.W * 304.8).ToString("0") + "x" + (cr.H * 304.8).ToString("0") + " at " + (cr.X0 * 304.8).ToString("0") + "," + (cr.Y0 * 304.8).ToString("0"));
                                }
                                if (kv.ContainsKey("img")) sb.AppendLine("   img " + ExportImage(doc, sh, outDir));
                            }
                            foreach (string nn in notes) sb.AppendLine("   note " + nn);
                            foreach (BbIssue i in issues) sb.AppendLine("   issue " + i.Problem);
                        }
                        break;
                    }
                case "flow":
                    {
                        // «Ажлын зураг үүсгэх»-ийн цонхгүй бүтэн урсгал: сонголт (тэмдгээр) → TransactionGroup → үүсгэх → тэмдэглэх → хуудас → Excel (outDir).
                        BbStandard std = LoadStd(kv, outDir);
                        var picked = new List<Element>();
                        foreach (string mark in (kv.TryGetValue("marks", out string ms6) ? ms6 : "").Split(',').Select(x => x.Trim()).Where(x => x.Length > 0))
                        {
                            FamilyInstance fi = new FilteredElementCollector(doc).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>()
                                .Where(f => (f.Category?.Id.Value == (long)BuiltInCategory.OST_StructuralFraming || f.Category?.Id.Value == (long)BuiltInCategory.OST_StructuralColumns) && BbGeom.Mark(f) == mark)
                                .OrderByDescending(BbGeom.RebarCount).FirstOrDefault();
                            Element w = fi != null ? null : new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Walls).OfClass(typeof(Wall)).FirstOrDefault(x => BbGeom.Mark(x) == mark);
                            if (fi != null) picked.Add(fi); else if (w != null) picked.Add(w); else sb.AppendLine(mark + ": олдсонгүй");
                        }
                        foreach (string lname in (kv.TryGetValue("levels", out string lv6) ? lv6 : "").Split('|').Select(x => x.Trim()).Where(x => x.Length > 0))
                        {
                            Floor fl = new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Floors).OfClass(typeof(Floor)).Cast<Floor>()
                                .Where(x => (doc.GetElement(x.LevelId) as Level)?.Name == lname).OrderByDescending(BbGeom.RebarCount).FirstOrDefault();
                            if (fl != null) picked.Add(fl); else sb.AppendLine(lname + ": хучилт олдсонгүй");
                        }
                        var items = MglBb.Generate.GenerateFlow.BuildItems(doc, picked);
                        foreach (string fname in (kv.TryGetValue("frames", out string fr6) ? fr6 : "").Split('|').Select(x => x.Trim()).Where(x => x.Length > 0))
                        {
                            Level flv = new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>().FirstOrDefault(x => x.Name == fname);
                            if (flv == null) { sb.AppendLine(fname + ": түвшин олдсонгүй"); continue; }
                            BbFrameLevel fl = BbFramePlan.Of(doc, flv);
                            items.Add(new MglBb.Generate.GenerateFlow.Item { Mark = fl.LevelText, Frame = fl, Text = MglBb.Generate.GenerateFlow.FrameText(fl) });
                        }
                        foreach (var it in items) sb.AppendLine("  " + it.Text);
                        var opt = new BbGenOptions { NameSuffix = kv.TryGetValue("suffix", out string suf6) ? suf6 : "", Existing = "new", SectionMode = kv.TryGetValue("mode", out string md6) ? md6 : "auto" };
                        var g = MglBb.Generate.GenerateFlow.Execute(doc, items, std, opt, true, !kv.ContainsKey("nosheet"));
                        sb.AppendLine("дэлгээс " + g.Elevs + ", огтлол " + g.Secs + ", хуудас " + g.Sheets + " · " + g.Watch.ElapsedMilliseconds + " ms · асуудал " + g.Issues.Count + " · тэмдэглэгээ: хэмж " + g.Rep.SecDims + " гинж " + g.Rep.BarChains + " шошго " + (g.Rep.SecTags + g.Rep.ElevTags) + " MRA " + g.Rep.ElevMras);
                        string xl = Path.Combine(outDir, "issues-" + DateTime.Now.ToString("HHmmss") + ".xlsx");
                        BbIssueBook.Merge(xl, g.Issues, DateTime.Now);
                        sb.AppendLine("excel " + xl);
                        foreach (string nn in g.Notes.Take(12)) sb.AppendLine("  note " + nn);
                        foreach (BbIssue iss in g.Issues.Where(x => x.Severity != BbSeverity.Info).Take(12)) sb.AppendLine("  issue " + iss.Member + " | " + iss.View + " | " + iss.Problem);
                        sb.AppendLine("  түүвэр " + g.Schedules);
                        foreach (ViewSheet sh in g.CreatedSheets)
                        {
                            sb.AppendLine("  sheet " + sh.SheetNumber + " «" + sh.Name + "» viewports " + sh.GetAllViewports().Count + " schedules " + new FilteredElementCollector(doc, sh.Id).OfClass(typeof(ScheduleSheetInstance)).Cast<ScheduleSheetInstance>().Count(x => !x.IsTitleblockRevisionSchedule));
                            foreach (string pn in new[] { "* Type Designator", "* Classification", "Drawn By" }) sb.AppendLine("     " + pn + " = " + (sh.LookupParameter(pn)?.AsString() ?? "-"));
                            if (kv.ContainsKey("img")) sb.AppendLine("     img " + ExportImage(doc, sh, outDir));
                        }
                        if (kv.ContainsKey("img") && g.First != null && !(g.First is ViewSheet)) sb.AppendLine("  img " + ExportImage(doc, g.First, outDir));
                        break;
                    }
                case "acropdbg":
                    {
                        string like = kv.TryGetValue("like", out string lk) ? lk : "";
                        foreach (View v in new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>().Where(x => !x.IsTemplate && (x.Name ?? "").Contains(like)).Take(4))
                        {
                            BoundingBoxXYZ cb = v.CropBox;
                            Transform inv = cb.Transform.Inverse;
                            double sc = v.Scale;
                            Func<double, string> pm = ft => (ft * 304.8 / sc).ToString("0.0");
                            sb.AppendLine("«" + v.Name + "» 1:" + sc + " crop " + pm(cb.Max.X - cb.Min.X) + " x " + pm(cb.Max.Y - cb.Min.Y) + " annCrop " + v.get_Parameter(BuiltInParameter.VIEWER_ANNOTATION_CROP_ACTIVE)?.AsInteger());
                            try
                            {
                                var m = v.GetCropRegionShapeManager();
                                sb.AppendLine("   offsets L " + (m.LeftAnnotationCropOffset * 304.8).ToString("0.0") + " R " + (m.RightAnnotationCropOffset * 304.8).ToString("0.0") + " B " + (m.BottomAnnotationCropOffset * 304.8).ToString("0.0") + " T " + (m.TopAnnotationCropOffset * 304.8).ToString("0.0"));
                            }
                            catch (Exception ex) { sb.AppendLine("   offsets ERR " + ex.Message); }
                            foreach (Element e in new FilteredElementCollector(doc).OwnedByView(v.Id).WhereElementIsNotElementType())
                            {
                                if (!(e is Dimension || e is IndependentTag || e is MultiReferenceAnnotation || e is TextNote)) continue;
                                BoundingBoxXYZ b2 = e.get_BoundingBox(v);
                                if (b2 == null) { sb.AppendLine("   " + e.GetType().Name + " " + e.Id.Value + " no bbox"); continue; }
                                XYZ q0 = inv.OfPoint((b2.Transform ?? Transform.Identity).OfPoint(b2.Min)), q1 = inv.OfPoint((b2.Transform ?? Transform.Identity).OfPoint(b2.Max));
                                double l = cb.Min.X - Math.Min(q0.X, q1.X), r = Math.Max(q0.X, q1.X) - cb.Max.X, bo = cb.Min.Y - Math.Min(q0.Y, q1.Y), t = Math.Max(q0.Y, q1.Y) - cb.Max.Y;
                                if (Math.Max(Math.Max(l, r), Math.Max(bo, t)) > 0) sb.AppendLine("   " + e.GetType().Name + " " + e.Id.Value + " over L " + pm(l) + " R " + pm(r) + " B " + pm(bo) + " T " + pm(t));
                            }
                        }
                        break;
                    }
                case "annoone":
                    {
                        // Жинхэнэ «Стандартаар тэмдэглэх»-ийн нэг харагдацын зам (огтлолын шошгоны үүрэг / хугарал орно).
                        BbStandard std = LoadStd(kv, outDir);
                        var rep = new BbAnnoReport();
                        foreach (string vn in (kv.TryGetValue("view", out string vn9) ? vn9 : "").Split('|').Select(x => x.Trim()).Where(x => x.Length > 0))
                        {
                            View v = new FilteredElementCollector(doc).OfClass(typeof(ViewSection)).Cast<View>().FirstOrDefault(x => x.Name == vn);
                            if (v == null) { sb.AppendLine("no view " + vn); continue; }
                            MglBb.Generate.GenerateFlow.AnnotateOne(doc, v, std, rep);
                            sb.AppendLine("«" + vn + "» roleTags " + rep.RoleTags);
                        }
                        foreach (string n in rep.Notes.Take(20)) sb.AppendLine("  note " + n);
                        break;
                    }
                case "listviews":
                    {
                        // Огтлол / дэлгээсийн нэр (like= шүүлтүүр), хуудастай эсэх, ангилал.
                        string like = kv.TryGetValue("like", out string lk2) ? lk2 : "";
                        foreach (ViewSection v in new FilteredElementCollector(doc).OfClass(typeof(ViewSection)).Cast<ViewSection>().Where(x => !x.IsTemplate && x.Name.Contains(like)))
                        {
                            BbViewSample smp = null;
                            try { smp = BbLearner.Classify(doc, v); } catch { }
                            if (smp == null && kv.ContainsKey("onlyknown")) continue;
                            sb.AppendLine(v.Name + " | sheet=" + (v.get_Parameter(BuiltInParameter.VIEWPORT_SHEET_NUMBER)?.AsString() ?? "-") +
                                " | " + (smp == null ? "-" : smp.Kind + (smp.IsSection ? " sec " : " elev ") + smp.Mark));
                        }
                        break;
                    }
                case "viewers":
                    {
                        string like = kv.TryGetValue("like", out string lk) ? lk : "";
                        View target = new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>().FirstOrDefault(x => !x.IsTemplate && x.Name == (kv.TryGetValue("in", out string inn) ? inn : ""));
                        sb.AppendLine("target " + (target?.Name ?? "-"));
                        foreach (BuiltInCategory cat in new[] { BuiltInCategory.OST_Viewers, BuiltInCategory.OST_Sections, BuiltInCategory.OST_CalloutHeads, BuiltInCategory.OST_SectionHeads })
                        {
                            int k = 0;
                            foreach (Element e in new FilteredElementCollector(doc).OfCategory(cat).WhereElementIsNotElementType())
                            {
                                if (!(e.Name ?? "").Contains(like)) continue;
                                if (++k > 12) break;
                                string vis = target == null ? "" : " hidden=" + e.IsHidden(target) + " canHide=" + e.CanBeHidden(target);
                                sb.AppendLine("  " + cat + " " + e.Id.Value + " " + e.GetType().Name + " «" + e.Name + "» owner " + e.OwnerViewId.Value + vis);
                            }
                        }
                        if (target != null)
                            foreach (Element e in new FilteredElementCollector(doc, target.Id).WhereElementIsNotElementType().Where(x => x.Category != null && (x.Category.Id.Value == (long)BuiltInCategory.OST_Viewers)).Take(20))
                                sb.AppendLine("  in-view viewer " + e.Id.Value + " «" + e.Name + "»");
                        break;
                    }
                case "breaks":
                    {
                        // views=«нэр|нэр»: инженерийн break line-ыг (ХУУЛБАР дээр) тэмдэглээд устгаж, хэрэгслээр дахин тавиад харьцуулна.  2 дахь удаа = давхардал.
                        BbStandard std = MglBb.Infra.BbStore.LoadStandard(out string _);
                        foreach (string vn in (kv.TryGetValue("views", out string bvs) ? bvs : "").Split('|').Select(x => x.Trim()).Where(x => x.Length > 0))
                        {
                            ViewSection v = new FilteredElementCollector(doc).OfClass(typeof(ViewSection)).Cast<ViewSection>().FirstOrDefault(x => !x.IsTemplate && x.Name == vn);
                            if (v == null) { sb.AppendLine("«" + vn + "» алга"); continue; }
                            BbViewSample smp = BbLearner.Classify(doc, v);
                            Transform inv = v.CropBox.Transform.Inverse;
                            Func<FamilyInstance, string> desc = fi =>
                            {
                                XYZ q = inv.OfPoint(((LocationPoint)fi.Location).Point);
                                XYZ h = inv.OfVector(fi.HandOrientation), fc = inv.OfVector(fi.FacingOrientation);
                                Func<string, string> P = n => { Parameter p = fi.LookupParameter(n); return p == null ? "-" : (BbGeom.ToMm(p.AsDouble())).ToString("0.0", CultureInfo.InvariantCulture); };
                                return fi.Symbol.Name + " (" + BbGeom.ToMm(q.X).ToString("0.0", CultureInfo.InvariantCulture) + "," + BbGeom.ToMm(q.Y).ToString("0.0", CultureInfo.InvariantCulture) + ") hand(" + h.X.ToString("0.0", CultureInfo.InvariantCulture) + "," + h.Y.ToString("0.0", CultureInfo.InvariantCulture)
                                    + ") facing(" + fc.X.ToString("0.0", CultureInfo.InvariantCulture) + "," + fc.Y.ToString("0.0", CultureInfo.InvariantCulture) + ") left " + P("left") + " right " + P("right") + " mask " + P("masking depth extension");
                            };
                            Func<List<FamilyInstance>> breaks = () => new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_DetailComponents)
                                .WherePasses(new ElementOwnerViewFilter(v.Id)).OfType<FamilyInstance>().Where(BbBreaks.IsBreakFamily).ToList();
                            sb.AppendLine("== «" + vn + "» " + (smp == null ? "ангилагдсангүй" : smp.Kind + (smp.IsSection ? " огтлол" : "")) + " 1:" + v.Scale);
                            List<FamilyInstance> orig = breaks();
                            foreach (FamilyInstance fi in orig) sb.AppendLine("  инженер: " + desc(fi));
                            using (var t = new Transaction(doc, "gate: break устгах"))
                            {
                                t.Start();
                                foreach (FamilyInstance fi in orig) doc.Delete(fi.Id);
                                t.Commit();
                            }
                            if (smp == null) continue;
                            var rep = new BbAnnoReport();
                            int n1 = BbBreaks.Section(doc, v, std.For(smp.Kind), rep, smp.Mark);
                            foreach (FamilyInstance fi in breaks()) sb.AppendLine("  хэрэгсэл: " + desc(fi));
                            int n2 = BbBreaks.Section(doc, v, std.For(smp.Kind), rep, smp.Mark);
                            sb.AppendLine("  тавьсан " + n1 + ", дахин ажиллуулахад " + n2 + ", харагдацад одоо " + breaks().Count + (rep.Issues.Count > 0 ? " · асуудал: " + string.Join(" | ", rep.Issues.Select(i => i.Problem)) : ""));
                        }
                        break;
                    }
                case "dimline":
                    {
                        // view=«нэр»; cfg=«тохиргоо»: баганын төвөөр дайрсан хэвтээ ба босоо шугамаар (crop-ын өргөнөөр) «Шугамаар хэмжээс»-ийг (ХУУЛБАР дээр).
                        View v = new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>().FirstOrDefault(x => !x.IsTemplate && x.Name == (kv.TryGetValue("view", out string dvn) ? dvn : ""));
                        if (v == null)
                            v = new FilteredElementCollector(doc).OfClass(typeof(ViewPlan)).Cast<ViewPlan>().Where(x => !x.IsTemplate && x.CropBoxActive)
                                .FirstOrDefault(x => new FilteredElementCollector(doc, x.Id).OfCategory(BuiltInCategory.OST_StructuralColumns).GetElementCount() > 3);
                        if (v == null) { sb.AppendLine("харагдац алга"); break; }
                        BbDimLines book = BbDimLines.Load(MglBb.DimLines.DimLineFlow.BookPath);
                        BbDimConfig cfg = book.Find(kv.TryGetValue("cfg", out string dcn) ? dcn : book.Current);
                        if (kv.TryGetValue("cats", out string dcats))       // cats=OST_Levels,OST_Walls:e,OST_StructuralColumns:ec (e = захын нүүр, c = төв)
                        {
                            cfg = new BbDimConfig { Name = "gate" };
                            foreach (string part in dcats.Split(',').Select(x => x.Trim()).Where(x => x.Length > 0))
                            {
                                string[] kf = part.Split(':');
                                string fl = kf.Length > 1 ? kf[1] : "";
                                cfg.Cats.Add(new BbDimCat { Key = kf[0], Edges = fl.Contains("e"), Center = fl.Contains("c") });
                            }
                        }
                        if (cfg == null) { sb.AppendLine("тохиргоо алга"); break; }
                        if (kv.ContainsKey("section"))
                            v = new FilteredElementCollector(doc).OfClass(typeof(ViewSection)).Cast<ViewSection>().Where(x => !x.IsTemplate && x.ViewType == ViewType.Section)
                                .FirstOrDefault(x => new FilteredElementCollector(doc, x.Id).OfCategory(BuiltInCategory.OST_StructuralColumns).GetElementCount() > 0
                                                     && x.Scale >= 50) ?? v;
                        FamilyInstance col = new FilteredElementCollector(doc, v.Id).OfCategory(BuiltInCategory.OST_StructuralColumns).OfType<FamilyInstance>().FirstOrDefault();
                        if (col == null) { sb.AppendLine("баганагүй харагдац"); break; }
                        BbFrame f = BbFrame.Of(v);
                        XYZ c0 = f.Local(((LocationPoint)col.Location).Point);
                        BoundingBoxXYZ cb = v.CropBox;
                        sb.AppendLine("«" + v.Name + "» 1:" + v.Scale + " · «" + cfg.Name + "» · багана " + col.Id.Value);
                        foreach (bool horiz in new[] { true, false })
                        {
                            XYZ p0 = horiz ? f.World(cb.Min.X, c0.Y, 0) : f.World(c0.X, cb.Min.Y, 0);
                            XYZ p1 = horiz ? f.World(cb.Max.X, c0.Y, 0) : f.World(c0.X, cb.Max.Y, 0);
                            List<BbDimCand> refs = MglBb.DimLines.DimLineFlow.Collect(doc, v, p0, p1, cfg, book.Linked);
                            sb.AppendLine((horiz ? "  хэвтээ" : "  босоо") + ": " + refs.Count + " лавлагаа — " + string.Join(" ", refs.Select(r => r.Cat.Replace("OST_", "") + (r.Kind == BbDimCand.Face ? "|" : r.Kind == BbDimCand.Center ? "+" : "#")
                                + BbGeom.ToMm(r.At).ToString("0", CultureInfo.InvariantCulture))));
                            if (refs.Count < 2) continue;
                            using (var t = new Transaction(doc, "gate: шугамаар хэмжээс"))
                            {
                                t.Start();
                                string err = MglBb.DimLines.DimLineFlow.Place(doc, v, p0, p1, (horiz ? f.World(0, c0.Y + 3, 0) : f.World(c0.X + 3, 0, 0)), refs, null);
                                if (err != null) { sb.AppendLine("    алдаа: " + err); t.RollBack(); continue; }
                                t.Commit();
                            }
                            Dimension dim = new FilteredElementCollector(doc, v.Id).OfClass(typeof(Dimension)).Cast<Dimension>().OrderByDescending(x => x.Id.Value).First();
                            sb.AppendLine("    хэмжээс " + dim.Id.Value + ": " + (dim.NumberOfSegments == 0 ? dim.ValueString
                                : string.Join(" ", dim.Segments.Cast<DimensionSegment>().Select(s => s.ValueString))));
                        }
                        break;
                    }
                case "marktidy":
                    {
                        // Хамааралгүй тэмдэг нуух: views=«нэр|нэр» (эсвэл бүх танигдсан дэлгээсийн эхний n=6) — нуух өмнө/дараах тэмдгийг жагсааж БУЦААНА.
                        BbStandard std = MglBb.Infra.BbStore.LoadStandard(out string _);
                        var names = (kv.TryGetValue("views", out string mvs) ? mvs : "").Split('|').Select(x => x.Trim()).Where(x => x.Length > 0).ToList();
                        List<string> pats = BbMarkTidy.ElevPatterns(std);
                        var elevs = new FilteredElementCollector(doc).OfClass(typeof(ViewSection)).Cast<ViewSection>().Where(x => !x.IsTemplate)
                            .Where(x => names.Count > 0 ? names.Contains(x.Name) : BbMarkNames.MarkOf(x.Name, pats) != null)
                            .Take(names.Count > 0 ? 100 : (kv.TryGetValue("n", out string mn) ? int.Parse(mn) : 6)).ToList();
                        using (var t = new Transaction(doc, "MGL gate marktidy"))
                        {
                            t.Start();
                            foreach (ViewSection v in elevs)
                            {
                                string mark = BbMarkTidy.ElevationMark(doc, v, std);
                                if (kv.ContainsKey("reveal"))
                                {
                                    // Инженерийн гараар нуусныг эхлээд гаргана — хэрэгсэл юуг нуухыг цэвэр шалгах.
                                    var hid = new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Viewers).WhereElementIsNotElementType().Where(e => e.IsHidden(v)).Select(e => e.Id).ToList();
                                    if (hid.Count > 0) { v.UnhideElements(hid); doc.Regenerate(); }
                                }
                                if (kv.ContainsKey("probe") && mark != null)
                                {
                                    // Дэлгээсийг crop-ын төвд хөндлөн огтлох 2 огтлол: харь («Б-99 S1» — нуух ёстой) ба өөрийн («<mark> S99» — үлдэх ёстой).
                                    BoundingBoxXYZ cb = v.CropBox;
                                    XYZ c = cb.Transform.OfPoint((cb.Min + cb.Max) / 2);
                                    XYZ bz = v.RightDirection, by = XYZ.BasisZ, bx = by.CrossProduct(bz);
                                    for (int k = 0; k < 2; k++)
                                    {
                                        var box = new BoundingBoxXYZ { Transform = Transform.Identity, Min = new XYZ(-40, -15, 0), Max = new XYZ(40, 15, 2) };
                                        Transform tr = Transform.Identity;
                                        tr.Origin = c + bz * (k * 1.5); tr.BasisX = bx; tr.BasisY = by; tr.BasisZ = bz;
                                        box.Transform = tr;
                                        ViewSection s = ViewSection.CreateDetail(doc, v.GetTypeId(), box);
                                        s.Name = k == 0 ? "Б-99 S1 (gate)" : mark + " S99";
                                        s.Scale = v.Scale;
                                    }
                                    doc.Regenerate();
                                }
                                Func<List<string>> seen = () => new FilteredElementCollector(doc, v.Id).OfCategory(BuiltInCategory.OST_Viewers).WhereElementIsNotElementType().Select(e => e.Name).OrderBy(x => x).ToList();
                                List<string> before = seen();
                                foreach (Element e in new FilteredElementCollector(doc, v.Id).OfCategory(BuiltInCategory.OST_Viewers).WhereElementIsNotElementType())
                                {
                                    View tv = new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>().FirstOrDefault(x => !x.IsTemplate && x.Name == e.Name);
                                    sb.AppendLine("   viewer " + e.Id.Value + " «" + e.Name + "» " + e.GetType().Name + " canHide " + e.CanBeHidden(v) + " owner " + e.OwnerViewId.Value
                                        + " view " + (tv == null ? "-" : tv.Id.Value + " " + tv.ViewType + " sheet " + tv.get_Parameter(BuiltInParameter.VIEWER_SHEET_NUMBER)?.AsString()));
                                }
                                int h = mark == null ? 0 : BbMarkTidy.HideForeign(doc, v, mark, null);
                                doc.Regenerate();
                                List<string> after = seen();
                                sb.AppendLine("== «" + v.Name + "» mark " + (mark ?? "-") + " sheetmates " + BbMarkTidy.SheetMates(doc, v, mark).Count + " hidden " + h);
                                sb.AppendLine("   kept   " + string.Join(" | ", after));
                                sb.AppendLine("   hidden " + string.Join(" | ", before.Except(after)));
                            }
                            t.RollBack();
                        }
                        break;
                    }
                case "delwatch":
                    {
                        // Устгалтын бүртгэл: элементийг (ids=1,2 эсвэл анхны n=3 багана/дамнуруу) Delete командын оронд API-аар устгаж updater-ийн
                        // бичсэн DataStorage-ийг уншина; дараа нь БҮГДИЙГ буцаана (TransactionGroup.RollBack).  Цонхгүй.
                        BbDeleteWatch.InitForGate(app);
                        var ids = (kv.TryGetValue("ids", out string idsu) ? idsu : "").Split(',').Where(x => x.Trim().Length > 0).Select(x => new ElementId(long.Parse(x.Trim()))).ToList();
                        if (ids.Count == 0)
                            ids = new FilteredElementCollector(doc).WhereElementIsNotElementType()
                                .Where(x => x.Category != null && (x.Category.Id.Value == (long)BuiltInCategory.OST_StructuralColumns || x.Category.Id.Value == (long)BuiltInCategory.OST_StructuralFraming))
                                .Take(kv.TryGetValue("n", out string nu) ? int.Parse(nu) : 3).Select(x => x.Id).ToList();
                        int before = BbDeleteWatch.ReadAll(doc).Count;
                        using (var g = new TransactionGroup(doc, "MGL gate delwatch"))
                        {
                            g.Start();
                            BbDeleteWatch.ArmForGate(doc, ids);
                            using (var t = new Transaction(doc, "Delete"))
                            {
                                t.Start();
                                ICollection<ElementId> gone = doc.Delete(ids);
                                sb.AppendLine("deleted " + ids.Count + " picked, " + gone.Count + " total");
                                t.Commit();
                            }
                            List<BbDeleteBatch> all = BbDeleteWatch.ReadAll(doc);
                            sb.AppendLine("log batches before " + before + " after " + all.Count);
                            foreach (string l in BbDeleteLog.Lines(all.OrderBy(b => b.When), x => x.ToLocalTime(), 40)) sb.AppendLine("  " + l);
                            g.RollBack();
                        }
                        sb.AppendLine("after rollback " + BbDeleteWatch.ReadAll(doc).Count + " · elements back " + ids.Count(i => doc.GetElement(i) != null) + "/" + ids.Count);
                        break;
                    }
                case "hostfix":
                    {
                        // «Хост засах»: mark= (тэмдэгтэй гишүүдийн хүрээ; хоосон бол бүх загвар) — санал болгосон шилжүүлэлт; apply=1 бол хийж, дэлгээсийн
                        // нуусан арматурыг тоолоод БУЦААНА (RollBack; keep=1 бол хадгална — зөвхөн хуулбар дээр).
                        string mk = kv.TryGetValue("mark", out string mk1) ? mk1 : "";
                        var scope = mk.Length == 0 ? new List<Element>() : new FilteredElementCollector(doc).WherePasses(new ElementMulticategoryFilter(new List<BuiltInCategory>
                            { BuiltInCategory.OST_StructuralFraming, BuiltInCategory.OST_StructuralColumns })).WhereElementIsNotElementType().Where(e => BbGeom.Mark(e) == mk).ToList();
                        foreach (FamilyInstance e in scope.Take(3).OfType<FamilyInstance>())
                        {
                            BoundingBoxXYZ bb = e.get_BoundingBox(null);
                            string og = "-";
                            try
                            {
                                BoundingBoxXYZ ob = e.GetOriginalGeometry(new Options()).GetTransformed(e.GetTotalTransform()).GetBoundingBox();
                                og = BbGeom.ToMm(ob.Min.X).ToString("0") + "," + BbGeom.ToMm(ob.Min.Y).ToString("0") + "," + BbGeom.ToMm(ob.Min.Z).ToString("0") + " .. " + BbGeom.ToMm(ob.Max.X).ToString("0") + "," + BbGeom.ToMm(ob.Max.Y).ToString("0") + "," + BbGeom.ToMm(ob.Max.Z).ToString("0");
                            }
                            catch (Exception ex) { og = ex.Message; }
                            sb.AppendLine("member " + e.Id.Value + " bbox " + BbGeom.ToMm(bb.Min.X).ToString("0") + "," + BbGeom.ToMm(bb.Min.Y).ToString("0") + "," + BbGeom.ToMm(bb.Min.Z).ToString("0") + " .. " + BbGeom.ToMm(bb.Max.X).ToString("0") + "," + BbGeom.ToMm(bb.Max.Y).ToString("0") + "," + BbGeom.ToMm(bb.Max.Z).ToString("0") + " | original " + og);
                        }
                        var sw = System.Diagnostics.Stopwatch.StartNew();
                        List<BbHostFix> fixes = BbRebarHost.Find(doc, scope, out int chk, out int unc);
                        sb.AppendLine("checked " + chk + " unclear " + unc + " fixes " + fixes.Count + " in " + sw.ElapsedMilliseconds + " ms");
                        foreach (BbHostFix f in fixes.Take(60))
                            sb.AppendLine("  " + f.Bar.Id.Value + " " + doc.GetElement(f.Bar.GetTypeId())?.Name + " : " + BbRebarHost.Describe(f.From) + " " + (f.FromShare * 100).ToString("0") + "% -> " + BbRebarHost.Describe(f.To) + " " + (f.Share * 100).ToString("0") + "% | " + f.Bar.get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS)?.AsString() + " | by " + WorksharingUtils.GetWorksharingTooltipInfo(doc, f.Bar.Id).Creator);
                        if (kv.ContainsKey("apply"))
                        {
                            BbStandard std = LoadStd(kv, outDir);
                            using (var t = new Transaction(doc, "MGL gate hostfix"))
                            {
                                t.Start();
                                var errs = new List<string>();
                                int done = BbRebarHost.Apply(doc, fixes, std, errs, out int shown, out int hidden);
                                sb.AppendLine("applied " + done + " shown " + shown + " hidden " + hidden);
                                foreach (string er in errs.Take(10)) sb.AppendLine("  err " + er);
                                List<BbHostFix> again = BbRebarHost.Find(doc, scope, out int chk2, out int _);
                                sb.AppendLine("re-check fixes " + again.Count + " of " + chk2);
                                if (kv.ContainsKey("keep")) t.Commit(); else t.RollBack();
                            }
                        }
                        break;
                    }
                case "rebargen":
                    sb.Append(GateRebar.Run(doc, kv));
                    break;
                case "rebarcompare":
                    sb.Append(GateRebar.Compare(doc, kv));
                    break;
                case "colrebargen":
                    sb.Append(GateRebar.Columns(doc, kv));
                    break;
                case "rebarprobe":
                    sb.Append(GateRebar.Probe(doc, kv));
                    break;
                case "ping":
                    {
                        // Арын ажил явж байхад өөр команд (хэрэглэгчийн ажил) гүйцэтгэгдэж байгааг шалгана.
                        sb.AppendLine("busy " + MglBb.Generate.GenJobHost.Busy + " views " + new FilteredElementCollector(doc).OfClass(typeof(View)).GetElementCount() + " at " + DateTime.Now.ToString("HH:mm:ss.fff"));
                        break;
                    }
                case "ui":
                    {
                        // Цонхтой урсгал (лицензийн шалгалтгүй — үндсэн plugin harness-д байхгүй).  Цонхыг гаднаас UIA driver дарна.
                        UIDocument ud = app.ActiveUIDocument;
                        var sel = new List<ElementId>();
                        foreach (string mark in (kv.TryGetValue("marks", out string msu) ? msu : "").Split(',').Select(x => x.Trim()).Where(x => x.Length > 0))
                        {
                            Element e = new FilteredElementCollector(doc).WhereElementIsNotElementType()
                                .Where(x => x.Category != null && (x.Category.Id.Value == (long)BuiltInCategory.OST_StructuralFraming || x.Category.Id.Value == (long)BuiltInCategory.OST_StructuralColumns || x.Category.Id.Value == (long)BuiltInCategory.OST_Walls) && BbGeom.Mark(x) == mark)
                                .OrderByDescending(BbGeom.RebarCount).FirstOrDefault();
                            if (e != null) sel.Add(e.Id);
                        }
                        foreach (string vn in (kv.TryGetValue("views", out string vsu) ? vsu : "").Split('|').Select(x => x.Trim()).Where(x => x.Length > 0))
                        {
                            View v = new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>().FirstOrDefault(x => !x.IsTemplate && x.Name == vn);
                            if (v != null) sel.Add(v.Id);
                        }
                        ud.Selection.SetElementIds(sel);
                        if (kv.TryGetValue("active", out string avn))
                        {
                            View av = new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>().FirstOrDefault(x => !x.IsTemplate && x.Name == avn);
                            if (av != null) ud.ActiveView = av;
                        }
                        Result res;
                        switch (kv.TryGetValue("cmd", out string cmd) ? cmd : "")
                        {
                            case "generate": res = MglBb.Generate.GenerateFlow.Run(ud); break;
                            case "annotate": res = MglBb.Annotate.AnnotateFlow.Run(ud); break;
                            case "issues": res = MglBb.Issues.IssuesFlow.Run(ud); break;
                            case "learn": res = MglBb.Learn.LearnFlow.Run(ud); break;
                            case "settings": res = MglBb.Settings.SettingsFlow.Run(ud); break;
                            case "dimline": res = MglBb.DimLines.DimLineFlow.Run(ud); break;
                            case "beamrebar": res = MglBb.BeamRebar.BeamRebarFlow.Run(ud); break;
                            case "colrebar": res = MglBb.BeamRebar.ColumnRebarFlow.Run(ud); break;
                            default: return "cmd=generate|annotate|issues|learn|settings|dimline|beamrebar|colrebar";
                        }
                        sb.AppendLine("result " + res + " selected " + sel.Count + " active «" + ud.ActiveView?.Name + "»");
                        break;
                    }
                case "seedissue":
                    {
                        string vn = kv.TryGetValue("view", out string vv) ? vv : "";
                        View v = new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>().FirstOrDefault(x => !x.IsTemplate && x.Name == vn);
                        var iss = new BbIssue { Tool = "Gate", Severity = BbSeverity.Warning, Member = "ЦХ-1", View = vn, ViewId = v?.Id.Value ?? -1, Problem = "Туршилтын асуудал (UI gate)", Proposal = "—", Key = "gate|seed|" + vn };
                        string path = MglBb.Infra.BbStore.WriteIssues(doc, new List<BbIssue> { iss }, out string err);
                        sb.AppendLine("seeded " + path + " " + err + " view " + (v?.Id.Value ?? -1));
                        break;
                    }
                case "plates":
                    sb.Append(GatePlates.Probe(doc, kv));
                    break;
                case "mraelbow":
                    sb.Append(GatePlates.MraElbows(doc, kv));
                    break;
                case "plateanno":
                    {
                        // Хана/хучилтын инженерийн харагдацыг (тэмдэглэгээгүй) хуулбарлаж плагинаар тэмдэглээд MRA-г хэмжинэ.
                        BbStandard std = LoadStd(kv, outDir);
                        var dups = new List<string>();
                        foreach (string vname in (kv.TryGetValue("views", out string pv) ? pv : "").Split('|').Where(x => x.Length > 0))
                        {
                            View src = new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>().FirstOrDefault(x => !x.IsTemplate && x.Name == vname);
                            if (src == null) { sb.AppendLine("no view «" + vname + "»"); continue; }
                            View dup;
                            using (var t = new Transaction(doc, "gate dup"))
                            {
                                t.Start();
                                dup = doc.GetElement(src.Duplicate(ViewDuplicateOption.Duplicate)) as View;
                                dup.Name = vname + " (MGL " + DateTime.Now.ToString("HHmmss") + ")";
                                t.Commit();
                            }
                            string role = BbPlates.Classify(doc, dup, std.Plate, out List<Element> hosts, out string pmark);
                            if (role == null) { sb.AppendLine("«" + dup.Name + "» ангилагдсангүй"); continue; }
                            var rep = new BbAnnoReport();
                            var sw = System.Diagnostics.Stopwatch.StartNew();
                            BbPlates.Annotate(doc, dup, role, hosts, std.Plate, rep, pmark);
                            sb.AppendLine("«" + dup.Name + "» " + role + " hosts " + hosts.Count + " mras " + rep.ElevMras + " elbows " + rep.ElevMraElbows + " in " + sw.ElapsedMilliseconds + " ms");
                            foreach (string n in rep.Notes.Take(10)) sb.AppendLine("  note " + n);
                            foreach (BbIssue i in rep.Issues.Take(10)) sb.AppendLine("  issue " + i.Problem);
                            if (kv.ContainsKey("img")) sb.AppendLine("  img " + ExportImage(doc, dup, outDir) + " | " + ExportImage(doc, src, outDir));
                            dups.Add(dup.Name);
                        }
                        if (dups.Count > 0) sb.Append(GatePlates.MraElbows(doc, new Dictionary<string, string> { ["views"] = string.Join("|", dups) }));
                        break;
                    }
                case "store":
                    {
                        BbStandard s = MglBb.Infra.BbStore.LoadStandard(out string src);
                        sb.AppendLine("source " + src);
                        sb.AppendLine("beam " + s.Beam.ElevViewType + " 1:" + s.Beam.ElevScale + " | column " + s.Column.ElevNamePattern + " part " + s.Column.ElevMaxPartPaperMm + " | mra " + s.Beam.MraType + " layout " + s.Beam.ElevMraLayout);
                        sb.AppendLine("issues " + MglBb.Infra.BbStore.IssuesPath(doc));
                        break;
                    }
                case "tagtest":
                    {
                        // Шошгоны толгой/leader-ийн тохиргооны дараалал харагдах байрлалд яаж нөлөөлөхийг шалгана (ҮРГЭЛЖ буцаана).
                        var tag = doc.GetElement(new ElementId(long.Parse(kv["id"]))) as IndependentTag;
                        View v = doc.GetElement(tag.OwnerViewId) as View;
                        BbFrame f = BbFrame.Of(v);
                        double sc = v.Scale;
                        Func<string> st = () =>
                        {
                            BoundingBoxXYZ tb = tag.get_BoundingBox(v);
                            f.Extent(tb, out XYZ ta, out XYZ tz);
                            XYZ h = f.Local(tag.TagHeadPosition);
                            return "head (" + (BbGeom.ToMm(h.X) / sc).ToString("0.0") + "," + (BbGeom.ToMm(h.Y) / sc).ToString("0.0") + ") bb u " + (BbGeom.ToMm(ta.X) / sc).ToString("0.0") + ".." + (BbGeom.ToMm(tz.X) / sc).ToString("0.0") + " v " + (BbGeom.ToMm(ta.Y) / sc).ToString("0.0") + ".." + (BbGeom.ToMm(tz.Y) / sc).ToString("0.0");
                        };
                        sb.AppendLine("now " + st());
                        XYZ head = tag.TagHeadPosition;
                        Reference rr = tag.GetTaggedReferences()[0];
                        foreach (int variant in new[] { 3, 5, 6 })
                        {
                            using (var t = new Transaction(doc, "tagtest"))
                            {
                                t.Start();
                                try
                                {
                                    XYZ end = tag.GetLeaderEnd(rr);
                                    if (variant == 1) { tag.TagHeadPosition = head; }
                                    if (variant == 2) { tag.TagHeadPosition = head + XYZ.Zero; doc.Regenerate(); tag.TagHeadPosition = head; }
                                    if (variant == 3) { tag.LeaderEndCondition = LeaderEndCondition.Attached; doc.Regenerate(); tag.TagHeadPosition = head; tag.LeaderEndCondition = LeaderEndCondition.Free; tag.SetLeaderEnd(rr, end); }
                                    if (variant == 4) { tag.HasLeader = false; doc.Regenerate(); tag.TagHeadPosition = head; doc.Regenerate(); tag.HasLeader = true; tag.LeaderEndCondition = LeaderEndCondition.Free; tag.SetLeaderEnd(rr, end); }
                                    XYZ elbow = head + (end - head).DotProduct(v.RightDirection) * 0.6 * v.RightDirection;
                                    if (variant == 5) { tag.LeaderEndCondition = LeaderEndCondition.Attached; doc.Regenerate(); tag.TagHeadPosition = head; tag.LeaderEndCondition = LeaderEndCondition.Free; tag.SetLeaderEnd(rr, end); doc.Regenerate(); tag.SetLeaderElbow(rr, elbow); }
                                    if (variant == 6) { tag.LeaderEndCondition = LeaderEndCondition.Attached; doc.Regenerate(); tag.LeaderEndCondition = LeaderEndCondition.Free; tag.SetLeaderEnd(rr, end); tag.SetLeaderElbow(rr, elbow); doc.Regenerate(); tag.TagHeadPosition = head; }
                                    doc.Regenerate();
                                    sb.AppendLine("v" + variant + " " + st());
                                }
                                catch (Exception ex) { sb.AppendLine("v" + variant + " ERR " + ex.Message); }
                                t.RollBack();
                            }
                        }
                        break;
                    }
                case "img":
                    {
                        foreach (string id in (kv.TryGetValue("views", out string vs) ? vs : "").Split(','))
                        {
                            if (!long.TryParse(id.Trim(), out long l)) continue;
                            if (doc.GetElement(new ElementId(l)) is View v) sb.AppendLine(ExportImage(doc, v, outDir));
                        }
                        if (kv.TryGetValue("like", out string like))
                            foreach (View v in new FilteredElementCollector(doc).OfClass(typeof(View)).Cast<View>().Where(x => !x.IsTemplate && (x.Name ?? "").Contains(like)).Take(16))
                                sb.AppendLine(v.Name + " → " + ExportImage(doc, v, outDir));
                        break;
                    }
                default:
                    return "unknown op '" + op + "'";
            }
            File.WriteAllText(Path.Combine(outDir, op + ".txt"), sb.ToString(), new UTF8Encoding(false));
            return sb.ToString();
        }

        /// <summary>Тэмдэгтэй, арматуртай framing — түвшний нэр өгвөл тэр түвшний, үгүй бол хамгийн их арматуртай.</summary>
        private static FamilyInstance SeedForMark(Document doc, string mark, string level)
        {
            var cands = new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_StructuralFraming).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>()
                .Where(f => BbGeom.Mark(f) == mark).ToList();
            if (!string.IsNullOrEmpty(level))
                cands = cands.Where(f => (doc.GetElement(f.LevelId)?.Name ?? (f.get_Parameter(BuiltInParameter.INSTANCE_REFERENCE_LEVEL_PARAM)?.AsValueString() ?? "")) == level).ToList();
            return cands.OrderByDescending(BbGeom.RebarCount).FirstOrDefault();
        }

        /// <summary>Инженерийн «{mark} S{n}» огтлолуудын байрлал (энэ гинжийн тэнхлэгийн дагуу, мм) — харьцуулалтад.</summary>
        private static List<double> EngineerStations(Document doc, BbBeamChain chain, BbStandard std)
        {
            var res = new List<double>();
            foreach (ViewSection v in new FilteredElementCollector(doc).OfClass(typeof(ViewSection)).Cast<ViewSection>())
            {
                if (v.IsTemplate || v.Name.Contains("(MGL)")) continue;
                string pat = BbNames.SectionPattern(v.Name, chain.Mark);
                if (pat == null) continue;
                try
                {
                    BbFrame f = BbFrame.Of(v);
                    if (Math.Abs(f.V.DotProduct(chain.Axis)) < 0.99) continue;
                    res.Add(BbGeom.ToMm(chain.Station(f.O)));
                }
                catch { }
            }
            res.Sort();
            return res;
        }

        private static int SecNo(string name)
        {
            var m = System.Text.RegularExpressions.Regex.Match(name ?? "", @"S\s*(\d+)");
            return m.Success ? int.Parse(m.Groups[1].Value) : 999;
        }

        private static void Dump(Document doc, Autodesk.Revit.DB.Structure.Rebar rb, GeometryElement ge, BbFrame f, StringBuilder sb, ref int n, int depth)
        {
            if (ge == null) return;
            foreach (GeometryObject go in ge)
            {
                if (++n > 80) return;
                string pad = new string(' ', 4 + depth * 2);
                if (go is Solid s)
                {
                    sb.AppendLine(pad + "Solid faces " + s.Faces.Size + " edges " + s.Edges.Size);
                    int k = 0;
                    foreach (Face fc in s.Faces)
                    {
                        if (++k > 6) break;
                        string st = "";
                        try { st = fc.Reference?.ConvertToStableRepresentation(doc) ?? "null"; } catch { }
                        int idx = -9;
                        try { if (fc.Reference != null) idx = rb.GetBarIndexFromReference(fc.Reference); } catch { }
                        string extra = fc is CylindricalFace cf ? " axis " + f.Local(cf.Origin + cf.Axis).Subtract(f.Local(cf.Origin)).ToString() + " o " + f.Local(cf.Origin).ToString() : "";
                        sb.AppendLine(pad + "  " + fc.GetType().Name + " bar " + idx + " " + st.Substring(Math.Max(0, st.Length - 30)) + extra);
                    }
                }
                else if (go is Curve c)
                {
                    string st = "";
                    try { st = c.Reference?.ConvertToStableRepresentation(doc) ?? "null"; } catch { }
                    int idx = -9;
                    try { if (c.Reference != null) idx = rb.GetBarIndexFromReference(c.Reference); } catch { }
                    string ends = c.IsBound ? f.Local(c.GetEndPoint(0)) + " → " + f.Local(c.GetEndPoint(1)) : "unbound";
                    sb.AppendLine(pad + c.GetType().Name + " bar " + idx + " " + st.Substring(Math.Max(0, st.Length - 30)) + " " + ends);
                }
                else if (go is GeometryInstance gi)
                {
                    sb.AppendLine(pad + "Instance");
                    Dump(doc, rb, gi.GetSymbolGeometry(), f, sb, ref n, depth + 1);
                }
                else sb.AppendLine(pad + go.GetType().Name);
            }
        }

        /// <summary>Харагдацын тэмдэглэгээний тоо: хэмжээс (арматуртай/бусад), шошго, MRA, текст.</summary>
        public static string Counts(Document doc, View v)
        {
            int dimR = 0, dimO = 0, tags = 0, mra = 0, notes = 0;
            var mraDims = new HashSet<long>();
            foreach (MultiReferenceAnnotation m in new FilteredElementCollector(doc, v.Id).OfClass(typeof(MultiReferenceAnnotation)).Cast<MultiReferenceAnnotation>())
            {
                if (m.OwnerViewId != v.Id) continue;
                mra++;
                mraDims.Add(m.DimensionId.Value);
            }
            foreach (Dimension d in new FilteredElementCollector(doc, v.Id).OfClass(typeof(Dimension)).Cast<Dimension>())
            {
                if (d.OwnerViewId != v.Id || mraDims.Contains(d.Id.Value) || d is SpotDimension) continue;
                bool rb = false;
                try { foreach (Reference r in d.References) if (doc.GetElement(r.ElementId) is Autodesk.Revit.DB.Structure.Rebar) { rb = true; break; } } catch { }
                if (rb) dimR++; else dimO++;
            }
            foreach (IndependentTag t in new FilteredElementCollector(doc, v.Id).OfClass(typeof(IndependentTag)).Cast<IndependentTag>()) if (t.OwnerViewId == v.Id) tags++;
            foreach (TextNote t in new FilteredElementCollector(doc, v.Id).OfClass(typeof(TextNote)).Cast<TextNote>()) if (t.OwnerViewId == v.Id) notes++;
            return "хэмж(арм) " + dimR + " · хэмж(бусад) " + dimO + " · шошго " + tags + " · MRA " + mra + " · текст " + notes;
        }

        public static string ExportImage(Document doc, View v, string outDir)
        {
            string dir = Path.Combine(outDir, "img");
            Directory.CreateDirectory(dir);
            string name = "view_" + v.Id.Value;
            var opt = new ImageExportOptions
            {
                ExportRange = ExportRange.SetOfViews,
                FilePath = Path.Combine(dir, name),
                FitDirection = FitDirectionType.Horizontal,
                PixelSize = v.ViewType == ViewType.Detail && v.Scale >= 50 ? 4000 : 1400,
                HLRandWFViewsFileType = ImageFileType.PNG,
                ShadowViewsFileType = ImageFileType.PNG,
                ImageResolution = ImageResolution.DPI_150,
                ZoomType = ZoomFitType.FitToPage,
            };
            opt.SetViewsAndSheets(new List<ElementId> { v.Id });
            try { doc.ExportImage(opt); return name; }
            catch (Exception ex) { return "fail " + name + " " + ex.Message; }
        }
    }
}
