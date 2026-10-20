using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Structure;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement
{
    internal sealed class RfEndSymbolOptions
    {
        public FamilySymbol Symbol;
        public RfPlaceMode Place = RfPlaceMode.Both;
        /// <summary>true = арматурын чиглэлээр (+ Эхлэл/Төгсгөлийн эргэлт нь offset), false = тогтмол (Эхлэл/Төгсгөлийн өнцөг нь абсолют).</summary>
        public bool AutoOrient = true;

        /// <summary>
        /// Эхлэлийн тэмдгийн эргэлт (°) ба Төгсгөлийн тэмдгийн эргэлт (°) — ТУСДАА хоёр утга (<see cref="RfEndSymbolMath.TargetAngle"/>).
        /// Автомат горимд автомат чиглэл ДЭЭР нэмэгдэнэ; тогтмол горимд харагдацын хавтгай дахь абсолют өнцөг.
        /// </summary>
        public double StartRotationDeg, EndRotationDeg;
        /// <summary>Family-ийн ӨӨРИЙН «заах» чиглэл (X тэнхлэгээс CCW градус).</summary>
        public double SymbolNaturalDeg;
        public double OffsetFt;
        public bool IncludeHooks = true;
        public RfBarSetMode BarSet = RfBarSetMode.Nearest;
        public bool AllowDuplicates;

        /// <summary>true = family биш, код-оор зурсан тэмдэг (detail шугам/нум) — <see cref="Symbol"/> шаардахгүй.</summary>
        public bool UseMarker;
        public RfMarkerStyle Marker = RfMarkerStyle.Circle;
        /// <summary>Код-оор зурсан тэмдгийн ЦААСАН хэмжээ, мм.</summary>
        public double MarkerSizeMm = RfMarkerGeometry.DefaultSizeMm;

        /// <summary>Хэрэглэгчийн дарсан цэг (загварын координат) — <see cref="RfBarSetMode.Nearest"/>-д; мэдэгдэхгүй бол null.</summary>
        public RfV3? PickPoint;
    }

    /// <summary>Код-оор зурсан тэмдгийг «давхардлын хайлт» дахин олж чадахгүй — ажиллуулалтыг бүхэлд нь буцаана.</summary>
    internal sealed class RfMarkerNotDetectableException : Exception
    {
        public RfMarkerNotDetectableException() : base(RfText.MarkerNotDetectable) { }
    }

    internal sealed class RfEndSymbolReport
    {
        public int Rebars, Placed, Duplicates, EndOn, OutsideCrop, HiddenBars, Updated, Unchanged, Orphans;
        /// <summary>Энэ харагдацад харагдахгүй (нуугдсан/харагдацын гадна) арматур — тэмдэг тавигдаагүй.</summary>
        public int NotVisible;
        /// <summary>Цэг болж харагдах (end-on) арматурын харагдацын гүнгээс гадна орсон төгсгөл.</summary>
        public int OutsideDepth;
        public int FreeForm, NoGeometry, Unsupported;
        /// <summary>«Сонгосон ширхэг» горимд дарсан цэгт ойр ширхэг тодорхойлогдож чадаагүй (олонлог) — бүх ширхэгт тавьсан арматурын тоо.</summary>
        public int NearestFallback;

        /// <summary>end-on арматур (хоёр төгсгөл нэг цэгт, ганц тэмдэг) дээр Эхлэл ≠ Төгсгөлийн эргэлт — Төгсгөлийнх хэрэглэгдээгүй ширхгийн тоо.</summary>
        public int EndOnRotationIgnored;

        /// <summary>Энэ төгсгөлд ӨӨР төрлийн тэмдэг аль хэдийн тавигдсан тул шинийг тавиагүй (солиогүй) төгсгөлийн тоо.</summary>
        public int DifferentSymbol;

        /// <summary>Код-оор зурсан тэмдэг: гэмтсэн (элементийн тоо дутуу/илүү) — хөндөөгүй, тавиагүй.</summary>
        public int Damaged;

        /// <summary>Код-оор зурсан тэмдэг: Copy/Paste-ийн хуулбар гэж таньсан бүлэг — ХӨНДӨӨГҮЙ.</summary>
        public int Copies;

        /// <summary>Энэ ажиллуулалтад тавьсан тэмдэг «давхардлын хайлт»-аар дахин танигдаж байгааг нэг удаа баталгаажуулсан эсэх.</summary>
        public bool MarkerVerified;
        public long ElapsedMs;
        public readonly List<string> Failures = new List<string>();
        public readonly List<string> Notes = new List<string>();

        /// <summary>
        /// Дараалан дарах горимд товшилт бүрийн тайланг нийлүүлнэ.  Тоо бүрийг нэмнэ; тэмдэглэл (ж: «ангилал нуугдсан»)
        /// товшилт бүрд давтагддаг тул НЭГ л удаа.  ⚠️ Шинэ тоолуур нэмбэл ЭНД ч нэм — эс бөгөөс эцсийн тайланд алга болно.
        /// </summary>
        public void Add(RfEndSymbolReport o)
        {
            // end-on эргэлтийн тэмдэглэл ТООТОЙ («N арматурт…») — товшилт бүрийнхийг биш, НИЙТ тоотойг ганцхан үлдээнэ.
            string oldEndOn = EndOnRotationIgnored > 0 ? RfText.EndOnRotationNote(EndOnRotationIgnored) : null;
            string newEndOn = o.EndOnRotationIgnored > 0 ? RfText.EndOnRotationNote(o.EndOnRotationIgnored) : null;
            if (newEndOn != null && oldEndOn != null) Notes.Remove(oldEndOn);

            Rebars += o.Rebars; Placed += o.Placed; Duplicates += o.Duplicates; EndOn += o.EndOn;
            OutsideCrop += o.OutsideCrop; HiddenBars += o.HiddenBars; Updated += o.Updated; Unchanged += o.Unchanged;
            Orphans += o.Orphans; NotVisible += o.NotVisible; OutsideDepth += o.OutsideDepth; FreeForm += o.FreeForm;
            NoGeometry += o.NoGeometry; Unsupported += o.Unsupported; NearestFallback += o.NearestFallback;
            EndOnRotationIgnored += o.EndOnRotationIgnored; DifferentSymbol += o.DifferentSymbol; Damaged += o.Damaged;
            Copies += o.Copies;
            MarkerVerified |= o.MarkerVerified;
            ElapsedMs += o.ElapsedMs;
            Failures.AddRange(o.Failures);
            foreach (string n in o.Notes)
            {
                if (n != newEndOn && !Notes.Contains(n)) Notes.Add(n);
            }
            if (newEndOn != null) Notes.Add(RfText.EndOnRotationNote(EndOnRotationIgnored));
        }

        /// <summary>
        /// Дараалан дарах горимын эцсийн тайлан харуулах эсэх: алдаа, анхааруулга эсвэл ҮЙЛДЭЛ шаардах алгасалт.
        /// «Өмнө тавигдсан» (ижил арматур дээр дахин дарсан) ЗОРИУД ороогүй — status bar аль хэдийн хэлсэн, хор хөнөөлгүй.
        /// </summary>
        public bool HasIssues
        {
            get
            {
                return Failures.Count > 0 || Notes.Count > 0 || OutsideCrop + HiddenBars + NotVisible + OutsideDepth
                    + FreeForm + NoGeometry + Unsupported + NearestFallback + DifferentSymbol + Damaged + Copies > 0;
            }
        }
    }

    /// <summary>
    /// «Арматурын төгсгөлийн тэмдэг» — Revit давхарга.  Бүх тооцоо (чиглэл, байрлал, өнцөг, давхардал) Core-ийн
    /// <see cref="RfEndSymbolMath"/>-д; энд Revit-ийг уншиж/бичнэ.  Бүгд НЭГ TransactionGroup → нэг Ctrl+Z.
    /// </summary>
    internal static class EndSymbolService
    {
        /// <summary>Нэг ажиллуулалтад тавих тэмдгийн дээд хязгаар (санамсаргүй асар олон ширхэгээс хамгаална).</summary>
        public const int MaxSymbols = 5000;

        /// <summary>
        /// Тэмдэг болох боломжтой family: харагдацад хамаарах (ViewBased) Generic Annotation эсвэл Detail Item.
        /// Tag-уудыг (өөрийн ангилал) оруулахгүй.
        /// </summary>
        public static List<FamilySymbol> ListSymbols(Document doc)
        {
            var list = new List<FamilySymbol>();
            foreach (FamilySymbol fs in new FilteredElementCollector(doc).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>())
            {
                try
                {
                    Family fam = fs.Family;
                    if (fam == null || fam.FamilyPlacementType != FamilyPlacementType.ViewBased) continue;
                    long cat = fs.Category == null ? 0 : fs.Category.Id.Value;
                    if (cat != (long)BuiltInCategory.OST_GenericAnnotation && cat != (long)BuiltInCategory.OST_DetailComponents) continue;
                    list.Add(fs);
                }
                catch
                {
                    // Family уншигдахгүй — алгасна.
                }
            }
            list.Sort((a, b) => string.Compare(Label(a), Label(b), StringComparison.CurrentCultureIgnoreCase));
            return list;
        }

        public static string Label(FamilySymbol fs)
        {
            string cat = fs.Category == null ? string.Empty : fs.Category.Name;
            return fs.FamilyName + " : " + fs.Name + (cat.Length > 0 ? "   [" + cat + "]" : string.Empty);
        }

        /// <summary>
        /// Хадгалсан Family + Type НЭРээр (ElementId/UniqueId БИШ — файл бүрд өөр).  Хуучин «Family : Type» нэг мөр
        /// тохиргоог ч уншина.  Олдохгүй бол null.
        /// </summary>
        public static FamilySymbol Resolve(IList<FamilySymbol> symbols, string family, string type, string legacyName)
        {
            if ((string.IsNullOrEmpty(family) || string.IsNullOrEmpty(type)) && !string.IsNullOrEmpty(legacyName))
            {
                int at = legacyName.IndexOf(" : ", StringComparison.Ordinal);
                if (at > 0)
                {
                    family = legacyName.Substring(0, at);
                    type = legacyName.Substring(at + 3);
                }
            }
            if (string.IsNullOrEmpty(family) || string.IsNullOrEmpty(type)) return null;
            foreach (FamilySymbol s in symbols)
            {
                if (string.Equals(s.FamilyName, family, StringComparison.OrdinalIgnoreCase)
                    && string.Equals(s.Name, type, StringComparison.OrdinalIgnoreCase)) return s;
            }
            return null;
        }

        /// <summary>
        /// Анхны сонголт (тохиргоо байхгүй үед): «MGL» угтвартай family (төслийн өөрийн тэмдэг) байвал тэр, үгүй бол жагсаалтын эхнийх.
        /// </summary>
        public static FamilySymbol Preferred(IList<FamilySymbol> symbols)
        {
            foreach (FamilySymbol s in symbols)
            {
                if (s.FamilyName != null && s.FamilyName.StartsWith("MGL", StringComparison.OrdinalIgnoreCase)) return s;
            }
            return symbols.Count > 0 ? symbols[0] : null;
        }

        /// <summary>⚠️ Нээлттэй Transaction-гүй үед л дуудна.</summary>
        public static RfEndSymbolReport Place(Document doc, View view, IList<Rebar> rebars, RfEndSymbolOptions o)
        {
            var rep = new RfEndSymbolReport();
            var sw = Stopwatch.StartNew();

            RfViewUse use = RfView.Use(view);
            if (use == RfViewUse.Unsupported)
            {
                rep.Failures.Add(RfText.UnsupportedView);
                return rep;
            }
            if (!o.UseMarker)
            {
                if (o.Symbol == null)
                {
                    rep.Failures.Add(RfText.NoSymbolChosen);
                    return rep;
                }
                Family fam = o.Symbol.Family;
                if (fam == null || fam.FamilyPlacementType != FamilyPlacementType.ViewBased)
                {
                    rep.Failures.Add(RfText.SymbolNotViewBased);
                    return rep;
                }
            }

            RfViewFrame frame = RfView.Frame(view);
            RfCrop crop = RfView.Crop(view, frame);
            NoteHiddenCategory(doc, view, o, rep);
            // Код-оор зурсан тэмдэгт family-ийн «заах чиглэл» гэж байхгүй (0).
            double natural = o.UseMarker ? 0.0 : o.SymbolNaturalDeg * Math.PI / 180.0;
            Dictionary<string, RfPlacedEnd> existing = o.AllowDuplicates
                ? new Dictionary<string, RfPlacedEnd>()
                : RfEndSymbolStore.Previous(doc, view);

            // Энэ харагдацад ХАРАГДАЖ БУЙ арматур (сонгосон арматур нуугдсан/харагдацын гадна байж болно).
            var visible = new HashSet<long>();
            foreach (ElementId id in new FilteredElementCollector(doc, view.Id).OfClass(typeof(Rebar)).ToElementIds())
                visible.Add(id.Value);
            var endOnPlaced = new HashSet<string>(StringComparer.Ordinal);

            using (var tg = new TransactionGroup(doc, RfText.EndTitle))
            {
                tg.Start();
                try
                {
                    using (var t = new Transaction(doc, RfText.EndTitle))
                    {
                        t.Start();
                        FailureHandlingOptions fho = t.GetFailureHandlingOptions();
                        fho.SetFailuresPreprocessor(new RfWarningSwallower());
                        t.SetFailureHandlingOptions(fho);

                        if (!o.UseMarker && !o.Symbol.IsActive)
                        {
                            o.Symbol.Activate();
                            doc.Regenerate();
                        }

                        foreach (Rebar rebar in rebars)
                        {
                            if (rep.Placed >= MaxSymbols)
                            {
                                rep.Notes.Add(RfText.SymbolCapReached(MaxSymbols));
                                break;
                            }
                            rep.Rebars++;
                            if (!visible.Contains(rebar.Id.Value))
                            {
                                rep.NotVisible++;
                                continue;
                            }
                            PlaceFor(doc, view, frame, crop, rebar, o, natural, existing, endOnPlaced, rep);
                        }

                        TransactionStatus st = t.Commit();
                        if (st != TransactionStatus.Committed)
                        {
                            rep.Failures.Add("Revit өөрчлөлтийг буцаасан (" + st + ").");
                            rep.Placed = 0;
                        }
                    }
                }
                catch (Exception ex)
                {
                    rep.Failures.Add(ex.Message);
                    rep.Placed = 0;
                }

                if (rep.Placed > 0) tg.Assimilate();
                else tg.RollBack();
            }
            if (rep.EndOnRotationIgnored > 0) rep.Notes.Add(RfText.EndOnRotationNote(rep.EndOnRotationIgnored));
            rep.ElapsedMs = sw.ElapsedMilliseconds;
            return rep;
        }

        /// <summary>Тэмдгийн ангилал ЭНЭ харагдацад нуугдсан бол (Visibility/Graphics) тавьсан тэмдэг харагдахгүй — урьдчилан мэдэгдэнэ.</summary>
        private static void NoteHiddenCategory(Document doc, View view, RfEndSymbolOptions o, RfEndSymbolReport rep)
        {
            try
            {
                ElementId cat = o.UseMarker
                    ? new ElementId(BuiltInCategory.OST_Lines)
                    : (o.Symbol != null && o.Symbol.Category != null ? o.Symbol.Category.Id : null);
                if (cat != null && view.GetCategoryHidden(cat))
                    rep.Notes.Add(RfText.SymbolCategoryHidden(o.UseMarker ? "Lines" : o.Symbol.Category.Name));
            }
            catch
            {
                // Ангилал нуугдах боломжгүй / уншигдахгүй — мэдэгдэхгүй.
            }
        }

        private static void PlaceFor(Document doc, View view, RfViewFrame frame, RfCrop crop, Rebar rebar,
            RfEndSymbolOptions o, double natural, Dictionary<string, RfPlacedEnd> existing, HashSet<string> endOnPlaced,
            RfEndSymbolReport rep)
        {
            RfRebarEndsResult ends = RfRebarEnds.Compute(rebar, view, o.IncludeHooks, o.BarSet, o.PickPoint);
            rep.HiddenBars += ends.HiddenBars;
            if (ends.NearestFallback) rep.NearestFallback++;
            if (ends.Ends.Count == 0)
            {
                if (ends.FreeForm) rep.FreeForm++;
                else rep.NoGeometry++;
                return;
            }

            foreach (RfBarEnd end in ends.Ends)
            {
                if (!RfEndSymbolMath.Wants(o.Place, end.Kind)) continue;

                string key = RfEndSymbolMath.DupKey(rebar.UniqueId, end.Kind, end.BarIndex, o.IncludeHooks);
                double autoAngle;
                bool endOn = !RfEndSymbolMath.TryViewAngle(frame, end.OutwardTangent, out autoAngle);
                string wantSymbol = o.UseMarker ? RfMarkerGeometry.Tag(o.Marker) : o.Symbol.UniqueId;
                if (!o.AllowDuplicates
                    && RfEndSymbolMath.AlreadyPlaced(k => existing.ContainsKey(k), rebar.UniqueId, end.Kind, end.BarIndex, o.IncludeHooks, endOn))
                {
                    rep.Duplicates++;
                    // end-on + «Эхлэл + Төгсгөл»: хоёр төгсгөл НЭГ цэгт тул ганц тэмдэг — Эхлэлийнх хэрэглэгдэж, Төгсгөлийн эргэлт ӨӨР бол ИЛ мэдэгдэнэ.
                    if (endOn && end.Kind == RfEndKind.End && o.Place == RfPlaceMode.Both
                        && Math.Abs(RfEndSymbolMath.NormalizeDegrees(o.StartRotationDeg - o.EndRotationDeg)) > 1e-6)
                        rep.EndOnRotationIgnored++;
                    // end-on үед тэмдэг нөгөө төгсгөлийн түлхүүрээр бүртгэгдсэн байж болно.
                    RfPlacedEnd hit;
                    if (!existing.TryGetValue(key, out hit))
                        existing.TryGetValue(RfEndSymbolMath.DupKey(rebar.UniqueId,
                            end.Kind == RfEndKind.Start ? RfEndKind.End : RfEndKind.Start, end.BarIndex, o.IncludeHooks), out hit);
                    if (hit != null)
                    {
                        if (hit.Damaged) rep.Damaged++;
                        // Өөр төрлийн тэмдэг аль хэдийн тавигдсан бол ЭНЭ тэмдгээр ДАРАХГҮЙ — харин чимээгүй алгасахгүй, мэдэгдэнэ.
                        if (!string.Equals(hit.SymbolUid, wantSymbol, StringComparison.Ordinal)) rep.DifferentSymbol++;
                    }
                    continue;
                }

                if (endOn)
                {
                    // Харагдацын нормаль дагуух арматур (зүсэлтэд цэг болж харагдана): хоёр төгсгөл нэг цэгт давхцана.
                    // Зөвхөн харагдацын гүнд ЖИНХЭНЭ төгсөж буй төгсгөлд, нэг ширхэгт нэг л тэмдэг.
                    if (!crop.InDepth(RfConv.X(end.Position)))
                    {
                        rep.OutsideDepth++;
                        continue;
                    }
                    if (!endOnPlaced.Add(rebar.UniqueId + "|" + end.BarIndex))
                    {
                        rep.Duplicates++;
                        continue;
                    }
                }

                // Эхлэл, Төгсгөл тус тусдаа эргэлттэй: автомат горимд (автомат чиглэл + хэрэглэгчийн эргэлт), тогтмол горимд хэрэглэгчийн абсолют өнцөг.
                if (o.AutoOrient && endOn) rep.EndOn++;
                double target = RfEndSymbolMath.TargetAngle(o.AutoOrient, endOn, autoAngle, end.Kind, o.StartRotationDeg, o.EndRotationDeg);
                double rot = RfEndSymbolMath.RotationToApply(target, natural);
                // «Шинэчлэх» хэрэглэгчийн эргэлтийг алдахгүйн тулд (schema өөрчлөхгүй) тэр өнцгийг хадгалах «байгалийн» өнцөгт шингээнэ.
                double storedNatural = RfEndSymbolMath.NaturalToStore(o.AutoOrient, natural, end.Kind, o.StartRotationDeg, o.EndRotationDeg);

                RfV3 pt = RfEndSymbolMath.PlacementPoint(frame, end.Position, end.OutwardTangent, o.OffsetFt);
                if (!crop.Contains(frame.ToView(pt)))
                {
                    rep.OutsideCrop++;
                    continue;
                }

                FamilyInstance fi = null;
                List<Element> drawn = null;
                try
                {
                    XYZ origin = RfConv.X(pt);
                    var placed = new RfPlacedEnd
                    {
                        RebarUid = rebar.UniqueId,
                        Kind = end.Kind,
                        BarIndex = end.BarIndex,
                        SymbolUid = wantSymbol,
                        Rot = rot,
                        Natural = storedNatural,
                        OffsetFt = o.OffsetFt,
                        Hooks = o.IncludeHooks,
                        Auto = o.AutoOrient,
                    };
                    if (o.UseMarker)
                    {
                        // Family-гүй: detail шугам/нумаар зурна (харагдацад хамаарах, цаасан хэмжээтэй).
                        int scale = view.Scale > 0 ? view.Scale : 100;
                        // Радиус нь Revit-ийн «богино муруй»-ийн хязгаараас (ShortCurveTolerance) 2 дахин их — өчүүхэн тэмдэг шугам/нум үүсгэхэд унахгүй.
                        double radius = Math.Max(RfMarkerGeometry.RadiusFt(o.MarkerSizeMm, scale), 2.0 * doc.Application.ShortCurveTolerance);
                        drawn = RfMarkerDraw.Create(doc, view, frame, pt, o.Marker, radius, rot);
                        if (drawn.Count == 0) throw new InvalidOperationException(RfText.MarkerNotDrawn);
                        foreach (Element part in drawn)
                        {
                            placed.Parts.Add(part);
                            // ⚠️ Тэмдэглэгээ бичигдэхгүй бол тэмдэг «манай» гэж танигдахгүй — үлдээхгүй, алдаа гэж буцаана.
                            if (!RfEndSymbolStore.Write(part, placed))
                                throw new InvalidOperationException(RfText.MarkerNotWritten);
                        }

                        // RUNTIME БАТАЛГААЖУУЛАЛТ (нэг удаа): дөнгөж үүсгэсэн тэмдгийг «давхардлын хайлт» (Previous-ийн асуулга) ДАХИН олж чадах ёстой.
                        // Олохгүй бол энэ Revit/харагдац дээр давхардал хамгаалалт, «шинэчлэх» чимээгүй унтарна — тиймээс БҮГДИЙГ буцаана.
                        if (!rep.MarkerVerified)
                        {
                            if (!RfEndSymbolStore.IsDetectable(doc, view, drawn[0].Id))
                                throw new RfMarkerNotDetectableException();
                            rep.MarkerVerified = true;
                        }
                    }
                    else
                    {
                        fi = doc.Create.NewFamilyInstance(origin, o.Symbol, view);
                        if (Math.Abs(rot) > 1e-9)
                        {
                            // Харагдацын нормаль тэнхлэгээр, ТЭМДГИЙН ӨӨРИЙН цэгийн (оруулах цэг) эргэн тойронд — төслийн эхлэл биш.
                            // Family эргэхгүй бол чимээгүй орхихгүй: тавьсан тэмдгийг устгаж (гаднах catch) ИЛ мэдэгдэнэ.
                            try
                            {
                                Line axis = Line.CreateBound(origin, origin + RfConv.X(frame.Normal));
                                ElementTransformUtils.RotateElement(doc, fi.Id, axis, rot);
                            }
                            catch (Exception rex)
                            {
                                throw new InvalidOperationException(RfText.SymbolRotateFailed(
                                    Math.Round(rot * 180.0 / Math.PI, 2).ToString(System.Globalization.CultureInfo.InvariantCulture), rex.Message));
                            }
                        }
                        placed.Instance = fi;
                        placed.Parts.Add(fi);
                        if (!RfEndSymbolStore.Write(fi, placed))
                            throw new InvalidOperationException(RfText.MarkerNotWritten);
                    }
                    existing[key] = placed;
                    rep.Placed++;
                }
                catch (Exception ex)
                {
                    // Хагас тавигдсан (эргүүлж чадаагүй / бүртгэгдээгүй) тэмдгийг үлдээхгүй.
                    try { if (fi != null && fi.IsValidObject) doc.Delete(fi.Id); } catch { }
                    if (drawn != null)
                    {
                        foreach (Element part in drawn)
                        {
                            try { if (part != null && part.IsValidObject) doc.Delete(part.Id); } catch { }
                        }
                    }
                    // Танигдахгүй (давхардлыг хамгаалах боломжгүй) бол энэ арматурын алдаа биш — БҮХ ажиллуулалтыг зогсооно (гаднах catch буцаана).
                    if (ex is RfMarkerNotDetectableException) throw;
                    rep.Failures.Add(RfText.EndFailed(rebar.Id.Value.ToString(), ex.Message));
                }
            }
        }

        /// <summary>
        /// «Тэмдэглэгээ шинэчлэх»: энэ харагдацад энэ хэрэгслийн тавьсан тэмдэг бүрийг арматурын ОДООГИЙН
        /// геометрээр дахин тооцож зөөнө/эргүүлнэ.  Тэмдгийг УСТГАХГҮЙ — арматур алга/нуугдсан бол «өнчин» гэж
        /// тайлагнана.  ⚠️ Нээлттэй Transaction-гүй үед л дуудна.
        /// </summary>
        public static RfEndSymbolReport Refresh(Document doc, View view)
        {
            var rep = new RfEndSymbolReport();
            var sw = Stopwatch.StartNew();
            if (RfView.Use(view) == RfViewUse.Unsupported)
            {
                rep.Failures.Add(RfText.UnsupportedView);
                return rep;
            }

            Dictionary<string, RfPlacedEnd> previous = RfEndSymbolStore.Previous(doc, view);
            if (previous.Count == 0) return rep;

            RfViewFrame frame = RfView.Frame(view);
            var byRebar = previous.Values.GroupBy(p => p.RebarUid).ToList();
            var cache = new Dictionary<string, RfRebarEndsResult>(StringComparer.Ordinal);

            using (var tg = new TransactionGroup(doc, RfText.RefreshTitle))
            {
                tg.Start();
                try
                {
                    using (var t = new Transaction(doc, RfText.RefreshTitle))
                    {
                        t.Start();
                        FailureHandlingOptions fho = t.GetFailureHandlingOptions();
                        fho.SetFailuresPreprocessor(new RfWarningSwallower());
                        t.SetFailureHandlingOptions(fho);

                        foreach (var group in byRebar)
                        {
                            rep.Rebars++;
                            Rebar rebar = doc.GetElement(group.Key) as Rebar;
                            foreach (RfPlacedEnd p in group)
                            {
                                if (rebar == null)
                                {
                                    rep.Orphans++;
                                    continue;
                                }
                                RfRebarEndsResult ends;
                                string ck = group.Key + "|" + (p.Hooks ? "h" : "n");
                                if (!cache.TryGetValue(ck, out ends))
                                    cache[ck] = ends = RfRebarEnds.Compute(rebar, view, p.Hooks, RfBarSetMode.All);
                                RfBarEnd end = ends.Ends.FirstOrDefault(x => x.Kind == p.Kind && x.BarIndex == p.BarIndex);
                                if (end == null)
                                {
                                    rep.Orphans++;
                                    continue;
                                }
                                RefreshOne(doc, view, frame, p, end, rep);
                            }
                        }

                        TransactionStatus st = t.Commit();
                        if (st != TransactionStatus.Committed)
                        {
                            rep.Failures.Add("Revit өөрчлөлтийг буцаасан (" + st + ").");
                            rep.Updated = 0;
                        }
                    }
                }
                catch (Exception ex)
                {
                    rep.Failures.Add(ex.Message);
                    rep.Updated = 0;
                }

                if (rep.Updated > 0) tg.Assimilate();
                else tg.RollBack();
            }
            rep.ElapsedMs = sw.ElapsedMilliseconds;
            return rep;
        }

        /// <summary>
        /// Код-оор зурсан тэмдгийн БҮХ элементийг (detail шугам/нум) шинэ төгсгөл рүү зөөж, чиглэл өөрчлөгдсөн бол төвөөр нь эргүүлнэ.
        /// Төвийг элементүүдийн ДУНД цэгийн дунджаас олно (Core: <see cref="RfMarkerGeometry.CenterOf"/>).  Юу ч УСТГАХГҮЙ.
        /// </summary>
        private static void RefreshMarker(Document doc, RfViewFrame frame, RfPlacedEnd p, RfBarEnd end, RfEndSymbolReport rep)
        {
            rep.Copies += p.Copies;
            if (p.Damaged)
            {
                // Нэг хагасыг нь устгасан / давхцуулж paste хийсэн: төвийг найдвартай тооцох боломжгүй — хөндөхгүй, УСТГАХГҮЙ.
                rep.Damaged++;
                return;
            }
            try
            {
                var ids = new List<ElementId>();
                var mids = new List<RfV2>();
                foreach (Element part in p.Parts)
                {
                    CurveElement ce = part as CurveElement;
                    if (ce == null || !ce.IsValidObject) continue;
                    Curve cv = ce.GeometryCurve;
                    if (cv == null) continue;
                    mids.Add(frame.ToView(RfConv.V(cv.Evaluate(0.5, true))));
                    ids.Add(ce.Id);
                }
                if (ids.Count == 0)
                {
                    rep.Orphans++;
                    return;
                }

                RfV2 cur = RfMarkerGeometry.CenterOf(mids);
                RfV3 want = RfEndSymbolMath.PlacementPoint(frame, end.Position, end.OutwardTangent, p.OffsetFt);
                RfV2 wantView = frame.ToView(want);
                RfV2 d = wantView - cur;
                bool changed = false;

                if (d.Length > RfTol.PointFt)
                {
                    XYZ delta = RfConv.X(frame.Right * d.X + frame.Up * d.Y);
                    ElementTransformUtils.MoveElements(doc, ids, delta);
                    changed = true;
                }

                double newRot = p.Rot;
                if (p.Auto)
                {
                    double target;
                    if (!RfEndSymbolMath.TryViewAngle(frame, end.OutwardTangent, out target)) target = 0;
                    newRot = RfEndSymbolMath.RotationToApply(target, p.Natural);
                    double dr = RfEndSymbolMath.NormalizeAngle(newRot - p.Rot);
                    if (Math.Abs(dr) > 1e-4)
                    {
                        XYZ origin = RfConv.X(want);
                        Line axis = Line.CreateBound(origin, origin + RfConv.X(frame.Normal));
                        ElementTransformUtils.RotateElements(doc, ids, axis, dr);
                        changed = true;
                    }
                }

                if (changed)
                {
                    p.Rot = newRot;
                    foreach (Element part in p.Parts)
                    {
                        if (part != null && part.IsValidObject) RfEndSymbolStore.Write(part, p);
                    }
                    rep.Updated++;
                }
                else
                {
                    rep.Unchanged++;
                }
            }
            catch (Exception ex)
            {
                rep.Failures.Add(RfText.EndFailed(p.RebarUid, ex.Message));
            }
        }

        private static void RefreshOne(Document doc, View view, RfViewFrame frame, RfPlacedEnd p, RfBarEnd end, RfEndSymbolReport rep)
        {
            if (p.IsMarker)
            {
                RefreshMarker(doc, frame, p, end, rep);
                return;
            }
            try
            {
                FamilyInstance fi = p.Instance;
                if (fi == null)
                {
                    rep.Orphans++;
                    return;
                }
                LocationPoint lp = fi.Location as LocationPoint;
                if (lp == null)
                {
                    rep.Orphans++;
                    return;
                }

                RfV3 want = RfEndSymbolMath.PlacementPoint(frame, end.Position, end.OutwardTangent, p.OffsetFt);
                RfV3 cur = frame.Project(RfConv.V(lp.Point));
                RfV3 delta = want - cur;
                bool changed = false;

                if (delta.Length > RfTol.PointFt)
                {
                    ElementTransformUtils.MoveElement(doc, fi.Id, RfConv.X(delta));
                    changed = true;
                }

                double newRot = p.Rot;
                if (p.Auto)
                {
                    double target;
                    if (!RfEndSymbolMath.TryViewAngle(frame, end.OutwardTangent, out target)) target = 0;
                    newRot = RfEndSymbolMath.RotationToApply(target, p.Natural);
                    double d = RfEndSymbolMath.NormalizeAngle(newRot - p.Rot);
                    if (Math.Abs(d) > 1e-4)
                    {
                        XYZ origin = RfConv.X(want);
                        Line axis = Line.CreateBound(origin, origin + RfConv.X(frame.Normal));
                        ElementTransformUtils.RotateElement(doc, fi.Id, axis, d);
                        changed = true;
                    }
                }

                if (changed)
                {
                    p.Rot = newRot;
                    RfEndSymbolStore.Write(fi, p);
                    rep.Updated++;
                }
                else
                {
                    rep.Unchanged++;
                }
            }
            catch (Exception ex)
            {
                rep.Failures.Add(RfText.EndFailed(p.RebarUid, ex.Message));
            }
        }
    }
}
