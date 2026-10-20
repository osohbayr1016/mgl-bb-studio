using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Events;
using Autodesk.Revit.DB.ExtensibleStorage;
using Autodesk.Revit.UI;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Revit
{
    /// <summary>
    /// Render зургийг перспективын БАЙРАНД «Canva шиг» (2026-10-14, интерьерийн баг: «render зураг оруулах хэсэгт зургаа ойртуулахад тухайн
    /// хэсэгт автоматаар fill хийж ордог болго»).  Хуудсан дээр (Insert → Image, эсвэл байгаа зургийг чирж) зургийг «ХАРАГДАХ БАЙДАЛ NN»
    /// байранд ойртуулмагц: байрны харьцаагаар ТӨВӨӨС нь тайрч, байрыг бүтэн дүүргэн яг байрлуулна (хоосон зай үлдэхгүй, хүрээнээс гарахгүй).
    /// <list type="bullet">
    /// <item>Таних: <c>DocumentChanged</c> (зөвхөн хэрэглэгчийн commit, Undo/Redo биш, өөрийн гүйлгээ биш) → хуудасны ImageInstance — ЗӨВХӨН
    /// унших.  Засвар нь дараагийн Idling-д (<c>CdJobHost.Post</c>) НЭГ гүйлгээ «MGL — Зураг байранд» → нэг Ctrl+Z-ээр буцаана.</item>
    /// <item>Байр: <see cref="WeImageSlots"/> — «ХАРАГДАХ БАЙДАЛ» бичвэрийг тойрсон 4 шулуун (хэрэгслийн <c>DrawPlaceholder</c>).</item>
    /// <item>Тайралт: Revit-д зураг тайрах API байхгүй — эх зургийг (<c>ImageType.GetImage</c>, эсвэл эх файл) WPF-ээр тайрч PNG болгоод ШИНЭ
    /// ImageType (Import — проект дотор), хуучин instance-ийг солино.  Эх ImageType үлдэнэ (өөр байранд зөөхөд тэндээс дахин тайрна —
    /// ES «Source»).  Харьцаа ижил бол зөвхөн хэмжээ, байрлал.</item>
    /// <item>Зураг урд давхаргад (Foreground) — байрны бичвэрийг далдална, хүрээний шугам хил болж үлдэнэ.</item>
    /// </list>
    /// </summary>
    internal static class WeImageFill
    {
        internal const string TxName = "MGL — Зураг байранд";
        /// <summary>Байрны захаас хэр гадна төвтэй зургийг «ойртуулсан» гэж үзэх (цаасны мм).</summary>
        private const double SnapMarginMm = 15;
        private const double TolMm = 0.5;
        /// <summary>Тайрсан зургийн урт талын дээд хэмжээ (пиксел) — 180 мм байранд ≈ 420 dpi; төслийн файлыг томруулахгүй.</summary>
        private const int MaxPixels = 3000;

        private static bool _wired;
        private static bool _posted;
        private static readonly List<KeyValuePair<Document, long>> Pending = new List<KeyValuePair<Document, long>>();

        internal static void Init(UIControlledApplication app)
        {
            if (_wired || app == null) return;
            _wired = true;
            app.ControlledApplication.DocumentChanged += OnChanged;
        }

        private static void OnChanged(object sender, DocumentChangedEventArgs e)
        {
            try
            {
                if (e.Operation != UndoOperation.TransactionCommitted) return;
                if (e.GetTransactionNames().Any(n => n == TxName)) return;
                Document doc = e.GetDocument();
                if (doc == null || doc.IsFamilyDocument || doc.IsLinked) return;
                var filter = new ElementClassFilter(typeof(ImageInstance));
                var ids = new List<ElementId>();
                ids.AddRange(e.GetAddedElementIds(filter));
                ids.AddRange(e.GetModifiedElementIds(filter));
                bool any = false;
                foreach (ElementId id in ids.Distinct())
                {
                    var ii = doc.GetElement(id) as ImageInstance;
                    if (ii == null || !(doc.GetElement(ii.OwnerViewId) is ViewSheet)) continue;
                    if (!Pending.Any(p => ReferenceEquals(p.Key, doc) && p.Value == id.Value)) Pending.Add(new KeyValuePair<Document, long>(doc, id.Value));
                    any = true;
                }
                if (!any || _posted || !CloneDrawings.CdJobHost.IsReady) return;
                _posted = true;
                CloneDrawings.CdJobHost.Post(Process);
            }
            catch (Exception ex) { WeLog.Error("imagefill", "DocumentChanged", ex); }
        }

        /// <summary>Idling (API контекст): хүлээгдэж буй зургууд — баримт тус бүр НЭГ гүйлгээ.</summary>
        private static void Process(UIApplication uiapp)
        {
            _posted = false;
            List<KeyValuePair<Document, long>> work = Pending.ToList();
            Pending.Clear();
            foreach (IGrouping<Document, KeyValuePair<Document, long>> g in work.GroupBy(p => p.Key))
            {
                Document doc = g.Key;
                try
                {
                    if (doc == null || !doc.IsValidObject || doc.IsReadOnly) continue;
                    if (doc.IsModifiable)
                    {
                        // Өөр гүйлгээ нээлттэй (ховор) — дараагийн Idling-д.
                        foreach (KeyValuePair<Document, long> p in g) Pending.Add(p);
                        if (!_posted && CloneDrawings.CdJobHost.IsReady) { _posted = true; CloneDrawings.CdJobHost.Post(Process); }
                        continue;
                    }
                    using (var t = new Transaction(doc, TxName))
                    {
                        t.Start();
                        int changed = 0;
                        foreach (KeyValuePair<Document, long> p in g)
                        {
                            var ii = doc.GetElement(new ElementId(p.Value)) as ImageInstance;
                            if (ii != null && FillOne(doc, ii)) changed++;
                        }
                        if (changed > 0) t.Commit();
                        else t.RollBack();
                    }
                }
                catch (Exception ex) { WeLog.Error("imagefill", "гүйлгээ", ex); }
            }
        }

        /// <summary>Нэг зураг: байранд ойртуулсан бол тайрч дүүргэнэ.  true = өөрчилсөн.</summary>
        private static bool FillOne(Document doc, ImageInstance ii)
        {
            var sheet = doc.GetElement(ii.OwnerViewId) as ViewSheet;
            if (sheet == null) return false;
            List<WeRect> slots;
            List<int> numbers;
            Slots(doc, sheet, out slots, out numbers);
            if (slots.Count == 0) return false;

            XYZ c = ii.GetLocation(BoxPlacement.Center);
            double w = ii.Width, h = ii.Height;
            WeRect image = WeRect.Around(c.X, c.Y, w, h);
            int idx = WeImageSlots.Target(image, slots, Mm(SnapMarginMm));
            if (idx < 0) return false;
            WeRect slot = slots[idx];
            if (WeImageSlots.Fills(image, slot, Mm(TolMm))) return false;

            var type = doc.GetElement(ii.GetTypeId()) as ImageType;
            if (WeImageSlots.SameAspect(w, h, slot, 0.005))
            {
                Place(ii, slot);
                WeLog.Info("imagefill", sheet.SheetNumber + ": байр " + numbers[idx] + " — хэмжээ, байрлал");
                return true;
            }

            // Эх зураг: өмнө нь тайрсан бол АНХНЫ эхээс (өөр харьцаатай байранд дахин тайрахад алдагдалгүй).
            ImageType source = SourceOf(doc, type) ?? type;
            string why;
            string file = Crop(source, slot, numbers[idx], out why);
            if (file == null)
            {
                // Тайрч чадаагүй — байранд БАГТААЖ (contain) голлуулна, хүрээнээс гарахгүй.
                Contain(ii, slot);
                WeLog.Info("imagefill", sheet.SheetNumber + ": байр " + numbers[idx] + " — тайрч чадсангүй (" + why + "), багтаав");
                return true;
            }
            try
            {
                ImageType nt = ImageType.Create(doc, new ImageTypeOptions(file, false, ImageTypeSource.Import));
                Rename(doc, nt, (source != null ? source.Name : "Зураг") + " — байр " + numbers[idx].ToString("00", CultureInfo.InvariantCulture));
                WriteSource(nt, source != null ? source.UniqueId : null);
                ImageInstance ni = ImageInstance.Create(doc, sheet, nt.Id, new ImagePlacementOptions(new XYZ(slot.Cx, slot.Cy, 0), BoxPlacement.Center));
                Place(ni, slot);
                doc.Delete(ii.Id);
                WeLog.Info("imagefill", sheet.SheetNumber + ": байр " + numbers[idx] + " — тайрч дүүргэв («" + (source != null ? source.Name : "?") + "»)");
                return true;
            }
            finally
            {
                try { File.Delete(file); } catch { }
            }
        }

        private static void Place(ImageInstance ii, WeRect slot)
        {
            try { ii.LockProportions = true; } catch { }
            ii.Width = slot.W;
            if (Math.Abs(ii.Height - slot.H) > Mm(TolMm))
            {
                // Харьцаа бага зэрэг зөрвөл (пикселийн бутархай) — өндрийг ч тааруулна.
                try { ii.LockProportions = false; ii.Height = slot.H; ii.LockProportions = true; } catch { }
            }
            ii.SetLocation(new XYZ(slot.Cx, slot.Cy, 0), BoxPlacement.Center);
            try { ii.DrawLayer = DrawLayer.Foreground; } catch { }
        }

        private static void Contain(ImageInstance ii, WeRect slot)
        {
            try { ii.LockProportions = true; } catch { }
            double w = ii.Width, h = ii.Height;
            if (w > 0 && h > 0)
            {
                double k = Math.Min(slot.W / w, slot.H / h);
                ii.Width = w * k;
            }
            ii.SetLocation(new XYZ(slot.Cx, slot.Cy, 0), BoxPlacement.Center);
            try { ii.DrawLayer = DrawLayer.Foreground; } catch { }
        }

        /// <summary>Хуудсан дээрх перспективын байрууд (хэрэгслийн «ХАРАГДАХ БАЙДАЛ NN» + 4 шулуун).</summary>
        private static void Slots(Document doc, ViewSheet sheet, out List<WeRect> slots, out List<int> numbers)
        {
            slots = new List<WeRect>();
            numbers = new List<int>();
            List<TextNote> labels = new FilteredElementCollector(doc, sheet.Id).OfClass(typeof(TextNote)).Cast<TextNote>()
                .Where(t => WeImageSlots.IsLabel(SafeText(t))).ToList();
            if (labels.Count == 0) return;
            var lines = new List<WeSegment2>();
            foreach (CurveElement ce in new FilteredElementCollector(doc, sheet.Id).OfClass(typeof(CurveElement)).Cast<CurveElement>())
            {
                var l = ce.GeometryCurve as Line;
                if (l == null) continue;
                XYZ a = l.GetEndPoint(0), b = l.GetEndPoint(1);
                lines.Add(new WeSegment2(a.X, a.Y, b.X, b.Y));
            }
            foreach (TextNote t in labels)
            {
                WeRect? r = WeImageSlots.SlotAround(lines, t.Coord.X, t.Coord.Y, Mm(TolMm));
                if (!r.HasValue) continue;
                slots.Add(r.Value);
                numbers.Add(WeImageSlots.LabelNumber(SafeText(t)));
            }
        }

        private static string SafeText(TextNote t)
        {
            try { return t.Text; } catch { return null; }
        }

        /// <summary>Эх зургийг байрны харьцаагаар тайрч түр PNG болгоно (амжилтгүй бол null).</summary>
        private static string Crop(ImageType source, WeRect slot, int no, out string why)
        {
            why = null;
            byte[] bytes = SourceBytes(source, out why);
            if (bytes == null || bytes.Length == 0) { why = why ?? "эх зураг уншигдсангүй"; return null; }
            try
            {
                BitmapDecoder dec;
                using (var ms = new MemoryStream(bytes))
                    dec = BitmapDecoder.Create(ms, BitmapCreateOptions.PreservePixelFormat | BitmapCreateOptions.IgnoreColorProfile, BitmapCacheOption.OnLoad);
                BitmapSource src = dec.Frames[0];
                int x, y, w, h;
                WeImageSlots.CropFor(src.PixelWidth, src.PixelHeight, slot.W, slot.H, out x, out y, out w, out h);
                BitmapSource outBmp = new CroppedBitmap(src, new Int32Rect(x, y, w, h));
                int longSide = Math.Max(w, h);
                if (longSide > MaxPixels)
                {
                    double k = (double)MaxPixels / longSide;
                    outBmp = new TransformedBitmap(outBmp, new ScaleTransform(k, k));
                }
                var enc = new PngBitmapEncoder();
                enc.Frames.Add(BitmapFrame.Create(outBmp));
                string dir = Path.Combine(Path.GetTempPath(), "MGL", "we-fill");
                Directory.CreateDirectory(dir);
                string name = Clean(source != null ? source.Name : "zurag");
                string file = Path.Combine(dir, name + "-" + no.ToString("00", CultureInfo.InvariantCulture) + "-" + Guid.NewGuid().ToString("N").Substring(0, 6) + ".png");
                using (FileStream fs = File.Create(file)) enc.Save(fs);
                return file;
            }
            catch (Exception ex)
            {
                why = ex.Message;
                return null;
            }
        }

        /// <summary>
        /// Эх зургийн байт: <c>ImageType.GetImage()</c> (Revit дотор хадгалсан, эх файл устсан ч) — System.Drawing-ийн төрлийг эмхэтгэлд
        /// холбохгүйн тулд reflection-оор PNG болгоно; амжилтгүй бол эх файл (<c>ImageType.Path</c>).
        /// </summary>
        private static byte[] SourceBytes(ImageType t, out string why)
        {
            why = null;
            if (t == null) { why = "зургийн төрөл алга"; return null; }
            try
            {
                MethodInfo get = t.GetType().GetMethod("GetImage", Type.EmptyTypes);
                object bmp = get != null ? get.Invoke(t, null) : null;
                if (bmp != null)
                {
                    try
                    {
                        Type fmt = bmp.GetType().Assembly.GetType("System.Drawing.Imaging.ImageFormat");
                        object png = fmt != null ? fmt.GetProperty("Png", BindingFlags.Public | BindingFlags.Static).GetValue(null, null) : null;
                        MethodInfo save = fmt != null ? bmp.GetType().GetMethod("Save", new[] { typeof(Stream), fmt }) : null;
                        if (save != null && png != null)
                            using (var ms = new MemoryStream())
                            {
                                save.Invoke(bmp, new[] { (object)ms, png });
                                if (ms.Length > 0) return ms.ToArray();
                            }
                    }
                    finally { (bmp as IDisposable)?.Dispose(); }
                }
            }
            catch (Exception ex) { why = "GetImage: " + (ex.InnerException ?? ex).Message; }
            try
            {
                string p = t.Path;
                if (!string.IsNullOrEmpty(p) && File.Exists(p)) return File.ReadAllBytes(p);
            }
            catch (Exception ex) { why = (why != null ? why + "; " : string.Empty) + "файл: " + ex.Message; }
            return null;
        }

        // ── ES: тайрсан ImageType → анхны эх ─────────────────────────

        private static readonly Guid SchemaGuid = new Guid("7d3c9a51-2e6f-4b84-a1c0-5f9e8d2b6a17");

        private static Schema FillSchema(bool create)
        {
            Schema s = Autodesk.Revit.DB.ExtensibleStorage.Schema.Lookup(SchemaGuid);
            if (s != null || !create) return s;
            var b = new SchemaBuilder(SchemaGuid);
            b.SetSchemaName("MglImageFill");
            b.SetReadAccessLevel(AccessLevel.Public);
            b.SetWriteAccessLevel(AccessLevel.Public);
            b.SetVendorId("com.revitmcp");
            b.SetDocumentation("MGL «Ханын дэлгээс»: перспективын байранд тайрсан зургийн анхны ImageType (UniqueId).");
            b.AddSimpleField("Source", typeof(string));
            return b.Finish();
        }

        private static void WriteSource(ImageType t, string sourceUid)
        {
            if (t == null || string.IsNullOrEmpty(sourceUid)) return;
            try
            {
                Schema s = FillSchema(true);
                var ent = new Entity(s);
                ent.Set("Source", sourceUid);
                t.SetEntity(ent);
            }
            catch (Exception ex) { WeLog.Info("imagefill", "эх тэмдэглэх — " + ex.Message); }
        }

        private static ImageType SourceOf(Document doc, ImageType t)
        {
            try
            {
                Schema s = FillSchema(false);
                if (s == null || t == null) return null;
                Entity ent = t.GetEntity(s);
                if (ent == null || !ent.IsValid()) return null;
                string uid = ent.Get<string>("Source");
                return string.IsNullOrEmpty(uid) ? null : doc.GetElement(uid) as ImageType;
            }
            catch { return null; }
        }

        private static void Rename(Document doc, ImageType t, string want)
        {
            try
            {
                string name = Clean(want);
                if (string.IsNullOrEmpty(name)) return;
                var taken = new HashSet<string>(new FilteredElementCollector(doc).OfClass(typeof(ImageType)).Select(e => e.Name), StringComparer.OrdinalIgnoreCase);
                string n = name;
                for (int i = 2; taken.Contains(n) && i < 100; i++) n = name + " (" + i.ToString(CultureInfo.InvariantCulture) + ")";
                t.Name = n;
            }
            catch { /* нэр нь файлын нэрээр үлдэнэ */ }
        }

        private static string Clean(string s)
        {
            if (string.IsNullOrEmpty(s)) return "zurag";
            foreach (char ch in Path.GetInvalidFileNameChars().Concat(new[] { '{', '}', '[', ']', '|', ';', '<', '>', '?', '`', '~', ':', '\\' }))
                s = s.Replace(ch, '-');
            s = s.Trim();
            if (s.Length > 60) s = s.Substring(0, 60);
            return s.Length == 0 ? "zurag" : s;
        }

        private static double Mm(double mm) { return mm / 304.8; }
    }
}
