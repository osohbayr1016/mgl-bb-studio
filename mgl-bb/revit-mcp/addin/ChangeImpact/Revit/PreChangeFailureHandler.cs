using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.ChangeImpact.Core;

namespace RevitMcpAddin.ChangeImpact
{
    /// <summary>
    /// Sandbox/Apply-ийн коммитын үеийн Revit failure-ыг ЦУГЛУУЛНА (`FailureNote`).
    ///
    /// ЯАГААД КОММИТ: Revit хязгаарлалт (locked dimension, align), pin, join-ийн алдааг ЗӨВХӨН транзакцийг commit хийх үед (failure
    /// processing) мэдэгддэг — `Regenerate()` дангаараа тэдгээрийг мэдэгдэхгүй.  Тиймээс preview түр группэд КОММИТЛОЖ, дараа нь
    /// группийг БҮТНЭЭР буцаадаг (docs/CHANGE_IMPACT_RADAR_MVP.md).
    ///
    ///   • Error → ЦУГЛУУЛААД `ProceedWithRollBack` (ноцтой алдааг ХЭЗЭЭ Ч «шийдвэрлэхгүй», элемент устгахгүй) → commit амжилтгүй → «БОЛОМЖГҮЙ».
    ///   • Warning → ЦУГЛУУЛНА.  `swallowWarnings` (зөвхөн PREVIEW) үед сануулгын цонх гарахгүйн тулд мессежийг устгана (элементийг БИШ);
    ///     Apply дээр устгахгүй — Revit хэрэглэгчид ердийн сануулгаа харуулна.
    /// </summary>
    internal sealed class PreChangeFailureHandler : IFailuresPreprocessor
    {
        private readonly bool _swallowWarnings;
        internal readonly List<FailureNote> Notes = new List<FailureNote>();
        internal bool HadError { get; private set; }

        internal PreChangeFailureHandler(bool swallowWarnings)
        {
            _swallowWarnings = swallowWarnings;
        }

        public FailureProcessingResult PreprocessFailures(FailuresAccessor failuresAccessor)
        {
            try
            {
                IList<FailureMessageAccessor> msgs = failuresAccessor.GetFailureMessages();
                foreach (FailureMessageAccessor m in msgs)
                {
                    FailureSeverity sev = m.GetSeverity();
                    string text = null;
                    try { text = m.GetDescriptionText(); } catch (Exception) { }
                    var ids = new List<long>();
                    try { ids.AddRange(m.GetFailingElementIds().Select(i => i.Value)); } catch (Exception) { }

                    if (sev == FailureSeverity.Warning)
                    {
                        Notes.Add(new FailureNote { IsError = false, Text = text ?? "Revit анхааруулга", ElementIds = ids });
                        if (_swallowWarnings)
                        {
                            try { failuresAccessor.DeleteWarning(m); } catch (Exception) { }
                        }
                    }
                    else
                    {
                        HadError = true;
                        Notes.Add(new FailureNote { IsError = true, Text = text ?? "Revit алдаа", ElementIds = ids });
                    }
                }
            }
            catch (Exception ex)
            {
                // Failure-ыг уншиж чадсангүй — аюулгүй тал: алдаа гэж үзэж буцаана (хэрэглэгчид «боломжгүй» гэж хэлнэ).
                HadError = true;
                Notes.Add(new FailureNote { IsError = true, Text = "Revit-ийн failure мэдээллийг уншиж чадсангүй (" + ex.GetType().Name + ")." });
            }
            return HadError ? FailureProcessingResult.ProceedWithRollBack : FailureProcessingResult.Continue;
        }

        internal static void Attach(Transaction t, PreChangeFailureHandler handler)
        {
            FailureHandlingOptions o = t.GetFailureHandlingOptions();
            o.SetFailuresPreprocessor(handler);
            o.SetClearAfterRollback(true);
            o.SetForcedModalHandling(false);
            t.SetFailureHandlingOptions(o);
        }
    }
}
