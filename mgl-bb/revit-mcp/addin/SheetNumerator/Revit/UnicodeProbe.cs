using System;
using Autodesk.Revit.DB;
using RevitMcpAddin.SheetNumerator.Core;

namespace RevitMcpAddin.SheetNumerator.Revit
{
    /// <summary>
    /// «Ямар үл үзэгдэх тэмдэг энэ Revit-д ХАДГАЛАГДАХ вэ?» гэдгийг БОДИТООР шалгана.
    ///
    /// Каталогийн тэмдэгт бүрийг түр placeholder хуудасны дугаарын төгсгөлд тавьж, Revit-ийн setter-ээр бичээд
    /// буцаан уншина.  ХОЁР нөхцөлөөр л хүлээн авна:
    ///  1. Буцаан уншсан утга ЯГ ижил (Revit тайраагүй, хөрвүүлээгүй) — хэмжсэн: U+180E, NBSP, U+2003, U+202F
    ///     захад ТАЙРАГДАЖ арилдаг;
    ///  2. «base» ба «base + тэмдэг» хоёр өөр дугаар болж ЗЭРЭГ оршино (Revit давхардал гэж үзэхгүй).
    ///
    /// Бүгд БУЦААГДАХ Transaction дотор (`RollBack`) — document-д ямар ч ул мөр үлдэхгүй.  ExternalEvent handler
    /// (Revit API-ийн хүчинтэй контекст)-оос дуудна.  Тэмдэг нь ХЭРЭГЛЭГЧИЙН «Давхардлыг ялгах» сонголт бүрт
    /// баталгаажаагүй бол ашиглагдахгүй (<see cref="MarkerCapabilities.IsProbed"/>).
    /// </summary>
    internal static class UnicodeProbe
    {
        public static MarkerCapabilities Probe(Document doc)
        {
            var caps = new MarkerCapabilities();
            if (doc == null || doc.IsFamilyDocument)
            {
                caps.ProbeError = Msg.NoDocumentNotice;
                return caps;
            }
            if (doc.IsReadOnly)
            {
                caps.ProbeError = Msg.ReadOnlyDocument;
                return caps;
            }

            try
            {
                using (var t = new Transaction(doc, "MGL probe (буцаагдана)"))
                {
                    t.Start();
                    try
                    {
                        ViewSheet probe = ViewSheet.CreatePlaceholder(doc);
                        ViewSheet other = ViewSheet.CreatePlaceholder(doc);
                        string baseNumber = "MGLPROBE-" + Guid.NewGuid().ToString("N").Substring(0, 10);

                        foreach (MarkerCandidate c in UnicodeMarkerCatalog.Candidates)
                        {
                            string reason;
                            if (TestOne(probe, other, baseNumber, c.Char, out reason))
                                caps.Accept(c.Char);
                            else
                                caps.Reject(c.Char, reason);
                        }
                        caps.IsProbed = true;
                    }
                    finally
                    {
                        // ҮРГЭЛЖ буцаана — probe-ийн хуудас document-д үлдэх ёсгүй.
                        if (t.GetStatus() == TransactionStatus.Started)
                            t.RollBack();
                    }
                }
            }
            catch (Exception ex)
            {
                caps.IsProbed = false;
                caps.ProbeError = ex.Message;
                SheetNumeratorLog.Error("unicode-probe", "Үл үзэгдэх тэмдгийн probe амжилтгүй", ex);
            }
            return caps;
        }

        private static bool TestOne(ViewSheet probe, ViewSheet other, string baseNumber, char marker, out string reason)
        {
            reason = null;
            string withMarker = baseNumber + marker;
            try
            {
                other.SheetNumber = "MGLPROBE-FREE-" + (int)marker;
                probe.SheetNumber = withMarker;
                if (!string.Equals(probe.SheetNumber, withMarker, StringComparison.Ordinal))
                {
                    reason = "Revit дугаараас тайрсан/өөрчилсөн";
                    return false;
                }

                // Хоёр дахь хуудас «base» (тэмдэггүй)-ийг авч чадах ёстой — үгүй бол Revit тэмдгийг үл тоож байна.
                other.SheetNumber = baseNumber;
                if (!string.Equals(other.SheetNumber, baseNumber, StringComparison.Ordinal))
                {
                    reason = "Тэмдэггүй дугаар хадгалагдсангүй";
                    return false;
                }
                return true;
            }
            catch (Autodesk.Revit.Exceptions.ArgumentException ex)
            {
                reason = "Revit татгалзсан: " + ex.Message.Split('\n')[0].Trim();
                return false;
            }
            catch (Exception ex)
            {
                reason = ex.Message;
                SheetNumeratorLog.Error("unicode-probe", "Тэмдэг U+" + ((int)marker).ToString("X4") + " шалгахад алдаа", ex);
                return false;
            }
            finally
            {
                // Дараагийн тэмдэгтэд дугаар чөлөөлнө.
                try
                {
                    probe.SheetNumber = "MGLPROBE-IDLE-" + (int)marker;
                    other.SheetNumber = "MGLPROBE-IDLE2-" + (int)marker;
                }
                catch (Exception)
                {
                    // Transaction rolled back at the end anyway.
                }
            }
        }
    }
}
