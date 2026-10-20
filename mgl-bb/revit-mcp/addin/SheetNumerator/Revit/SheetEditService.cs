using System;
using System.Collections.Generic;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using RevitMcpAddin.SheetNumerator.Core;

namespace RevitMcpAddin.SheetNumerator.Revit
{
    /// <summary>
    /// Нэг хуудсыг ПЕРЕИМЕНОВАТЬ (Sheet Name — Sheet Number БИШ) эсвэл УСТГАХ.  ExternalEvent handler-ээс.
    ///
    /// Хоёулаа: идэвхтэй document, хуудас оршиж байгаа (UniqueId), дугаар/нэр хэрэглэгчийн харсан утгатай ТААРАХ
    /// ёстой — үгүй бол «хуучирсан» гэж татгалзана (ӨӨР хүний засварыг чимээгүй дарахгүй).  Устгах нь ЭМНЭЛТЭЙ —
    /// UI хэрэглэгчээс баталгаа авсны дараа л энд ирнэ.
    /// </summary>
    internal static class SheetEditService
    {
        public static OperationResult Rename(UIApplication uiapp, RenameRequest r)
        {
            UIDocument uidoc = uiapp.ActiveUIDocument;
            return Rename(uidoc != null ? uidoc.Document : null, r);
        }

        /// <summary>Document-оор (UIApplication-гүй) — ExternalEvent-ийн дундуур орохгүй автомат шалгалтад ч адил.</summary>
        public static OperationResult Rename(Document activeDoc, RenameRequest r)
        {
            Document doc;
            ViewSheet sheet;
            OperationResult early = Locate(activeDoc, r.DocumentKey, r.SheetId, r.UniqueId, r.ExpectedNumber, r.ExpectedName, out doc, out sheet);
            if (early != null)
                return early;

            string name = RevitSheetRules.Normalize(r.NewName);
            if (name.Length == 0)
                return new OperationResult { Success = false, Message = "Хуудасны нэр хоосон байж болохгүй." };
            IReadOnlyList<char> bad = RevitSheetRules.FindProhibited(name);
            if (bad.Count > 0)
                return new OperationResult { Success = false, Message = Msg.ProhibitedInName(RevitSheetRules.DescribeChars(bad)) };
            if (string.Equals(name, sheet.Name, StringComparison.Ordinal))
                return new OperationResult { Success = true, Message = string.Empty };

            OperationResult blocked = CheckEditable(doc, sheet, r.ExpectedNumber, r.ExpectedName);
            if (blocked != null)
                return blocked;

            try
            {
                using (var t = new Transaction(doc, Msg.RenameTransactionName))
                {
                    t.Start();
                    sheet.Name = name;
                    if (!string.Equals(sheet.Name, name, StringComparison.Ordinal))
                        throw new InvalidOperationException("Revit нэрийг өөрчилж хадгалсан: «" + sheet.Name + "»");
                    TransactionStatus st = t.Commit();
                    if (st != TransactionStatus.Committed)
                        throw new InvalidOperationException("Transaction commit хийгдсэнгүй: " + st);
                }
            }
            catch (Exception ex)
            {
                SheetNumeratorLog.Error("rename", "Хуудасны нэр өөрчлөхөд алдаа: " + r.ExpectedNumber, ex);
                return new OperationResult
                {
                    Success = false,
                    Message = "Хуудасны нэрийг өөрчилж чадсангүй. Өөрчлөлт хадгалагдсангүй.",
                    Detail = ex.GetType().Name + ": " + ex.Message + "\nLog: " + SheetNumeratorLog.LogPath,
                };
            }
            SheetNumeratorLog.Info("rename", r.ExpectedNumber + ": «" + r.ExpectedName + "» → «" + name + "»");
            return new OperationResult { Success = true, Message = string.Empty };
        }

        public static OperationResult Delete(UIApplication uiapp, DeleteRequest r)
        {
            UIDocument uidoc = uiapp.ActiveUIDocument;
            ElementId activeView = null;
            try
            {
                if (uidoc != null && uidoc.ActiveView != null)
                    activeView = uidoc.ActiveView.Id;
            }
            catch (Exception)
            {
                // Идэвхтэй харагдацыг мэдэхгүй бол Revit өөрөө татгалзана (доор барина).
            }
            return Delete(uidoc != null ? uidoc.Document : null, activeView, r);
        }

        /// <param name="activeViewId">Хэрэглэгчийн ИДЭВХТЭЙ харагдац (null = мэдэхгүй) — идэвхтэй хуудсыг устгахыг урьдчилан хаана.</param>
        public static OperationResult Delete(Document activeDoc, ElementId activeViewId, DeleteRequest r)
        {
            Document doc;
            ViewSheet sheet;
            OperationResult early = Locate(activeDoc, r.DocumentKey, r.SheetId, r.UniqueId, r.ExpectedNumber, r.ExpectedName, out doc, out sheet);
            if (early != null)
                return early;

            if (activeViewId != null && activeViewId == sheet.Id)
                return new OperationResult { Success = false, Message = Msg.DeleteActiveViewFailed };

            OperationResult blocked = CheckEditable(doc, sheet, r.ExpectedNumber, r.ExpectedName);
            if (blocked != null)
                return blocked;

            try
            {
                int deleted;
                using (var t = new Transaction(doc, Msg.DeleteTransactionName))
                {
                    t.Start();
                    ICollection<ElementId> ids = doc.Delete(sheet.Id);
                    deleted = ids != null ? ids.Count : 0;
                    TransactionStatus st = t.Commit();
                    if (st != TransactionStatus.Committed)
                        throw new InvalidOperationException("Transaction commit хийгдсэнгүй: " + st);
                }
                SheetNumeratorLog.Info("delete", r.ExpectedNumber + " — " + r.ExpectedName + " устгагдлаа (хамт " + deleted + " элемент)");
            }
            catch (Exception ex)
            {
                SheetNumeratorLog.Error("delete", "Хуудас устгахад алдаа: " + r.ExpectedNumber, ex);
                return new OperationResult
                {
                    Success = false,
                    Message = "Хуудсыг устгаж чадсангүй. Өөрчлөлт хадгалагдсангүй.",
                    Detail = ex.GetType().Name + ": " + ex.Message + "\nLog: " + SheetNumeratorLog.LogPath,
                };
            }
            return new OperationResult { Success = true, Message = string.Empty };
        }

        // ── Туслахууд ───────────────────────────────────────────────
        private static OperationResult Locate(Document activeDoc, string docKey, long sheetId, string uniqueId,
            string expectedNumber, string expectedName, out Document doc, out ViewSheet sheet)
        {
            doc = null;
            sheet = null;
            if (activeDoc == null || activeDoc.IsFamilyDocument)
                return new OperationResult { Success = false, Stale = true, Message = Msg.NoDocumentNotice };
            doc = activeDoc;
            if (!string.Equals(SheetSnapshotService.DocumentKeyOf(doc), docKey, StringComparison.Ordinal))
                return new OperationResult { Success = false, Stale = true, Message = Msg.DocumentChangedNotice };
            if (doc.IsReadOnly)
                return new OperationResult { Success = false, Message = Msg.ReadOnlyDocument };

            sheet = doc.GetElement(new ElementId(sheetId)) as ViewSheet;
            if (sheet == null || !string.Equals(sheet.UniqueId, uniqueId, StringComparison.Ordinal))
                return new OperationResult { Success = false, Stale = true, Message = Msg.StaleNotice, Detail = Msg.SheetNoLongerExists(expectedNumber, expectedName) };
            if (!string.Equals(sheet.SheetNumber, expectedNumber, StringComparison.Ordinal)
                || !string.Equals(sheet.Name, expectedName, StringComparison.Ordinal))
            {
                return new OperationResult
                {
                    Success = false,
                    Stale = true,
                    Message = Msg.StaleNotice,
                    Detail = Msg.SheetNumberChangedExternally(expectedNumber, sheet.SheetNumber)
                        + "\n" + Msg.SheetNameChangedExternally(expectedNumber, expectedName, sheet.Name),
                };
            }
            return null;
        }

        private static OperationResult CheckEditable(Document doc, ViewSheet sheet, string number, string name)
        {
            if (!doc.IsWorkshared)
                return null;
            try
            {
                string owner;
                CheckoutStatus status = WorksharingUtils.GetCheckoutStatus(doc, sheet.Id, out owner);
                ModelUpdatesStatus updates = WorksharingUtils.GetModelUpdatesStatus(doc, sheet.Id);
                if (status == CheckoutStatus.OwnedByOtherUser)
                    return new OperationResult { Success = false, Message = Msg.WorksharingBlocked, Detail = Msg.SheetNotModifiable(number, name, owner) };
                if (updates == ModelUpdatesStatus.UpdatedInCentral || updates == ModelUpdatesStatus.DeletedInCentral)
                    return new OperationResult { Success = false, Message = Msg.WorksharingBlocked, Detail = Msg.SheetNotModifiable(number, name, null) };
            }
            catch (Exception ex)
            {
                SheetNumeratorLog.Error("edit", "Эзэмшил шалгаж чадсангүй: " + number, ex);
                return new OperationResult { Success = false, Message = Msg.WorksharingBlocked, Detail = Msg.SheetNotModifiable(number, name, null) };
            }
            return null;
        }
    }
}
