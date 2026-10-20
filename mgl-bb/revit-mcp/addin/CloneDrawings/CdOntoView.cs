using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using RevitMcpAddin.CloneDrawings.Core;

namespace RevitMcpAddin.CloneDrawings
{
    /// <summary>
    /// «Загвар харагдацаас ИДЭВХТЭЙ харагдац руу хуулах» (2026-10-02).  «Зураг клонлох»-ын ЯГ ТЭР хөдөлгүүр (tag, хэмжээс, MRA,
    /// 2D; арматурын тулгалт; лавлагааг зорилтын нүүр рүү буулгах; үүссэн хэмжээсийн утга шалгах; давхардал хасах) — гэхдээ
    /// ШИНЭ ХАРАГДАЦ ҮҮСГЭХГҮЙ: хэрэглэгчийн аль хэдийн зурсан (идэвхтэй) харагдац дээр шууд нэмнэ, тиймээс хэрэглэгч түүнийг
    /// дараа нь гараар засна.  Хэрэглэгчийн ГАРААР тавьсан тэмдэглэгээ ХЭЗЭЭ Ч устахгүй — зөвхөн нэмнэ.
    ///
    /// Зорилтын хүрээг (<see cref="CdFrame"/>) эндээс гаднаас нь өгнө: идэвхтэй харагдац дам нурууг загварын харагдацаас ЭСРЭГ
    /// талаас харж байвал (<see cref="OntoViewRules.NeedsFlip"/>) хүрээг 180° эргүүлж, хуулсан зүйл зүүн-баруун толин тусгал
    /// болохгүй.  Хуурамч (үл үзэгдэх) геометр ХЭЗЭЭ Ч үүсэхгүй — буулгаж чадаагүй лавлагаа алгасагдаж тайланд бичигдэнэ.
    ///
    /// ⚠️ Нээлттэй Transaction дотор дуудна (хэрэглэгч/команд эзэмшинэ).  Энд зөвхөн SubTransaction.
    /// </summary>
    internal static class CdOntoView
    {
        internal sealed class Outcome
        {
            public CdReport Report;
            /// <summary>Зорилтын хүрээг эргүүлсэн (идэвхтэй харагдац загвараас эсрэг талаас харж байна).</summary>
            public bool Flipped;
            /// <summary>Хуулах гогцоо ажилласан.  false бол <see cref="Problem"/> нь шалтгаан.</summary>
            public bool Ran;
            public string Problem;
            /// <summary>Загварын харагдацад хуулах гэж байсан тэмдэглэгээний тоо (төлөвлөсөн).</summary>
            public int SourceTags, SourceMras, SourceDims, SourceDetails;
            /// <summary>Харагдацын масштаб (1:N) — өөр бол tag, хэмжээсийн зай (цаасан дээр) өөр харагдана.</summary>
            public int TemplateScale, TargetScale;
        }

        /// <param name="rep">Дуудагчийн тайлан (failure handler-тэй хуваалцдаг).</param>
        internal static Outcome Run(Document doc, View templateView, Element templateHost, View targetView, Element targetHost,
            CdOptions options, CdReport rep)
        {
            var o = new Outcome { Report = rep };
            try { o.TemplateScale = templateView == null ? 0 : templateView.Scale; o.TargetScale = targetView == null ? 0 : targetView.Scale; }
            catch { }
            if (templateView == null || targetView == null || templateHost == null || targetHost == null)
            {
                o.Problem = "Загвар/зорилтын харагдац, элемент дутуу байна.";
                return o;
            }
            if (templateView.Id == targetView.Id)
            {
                o.Problem = "Загвар харагдац ба идэвхтэй харагдац ижил байна.";
                return o;
            }

            CdHostIndex hosts = CdHostIndex.Build(doc);
            CdTemplateInfo info = CdAnalysis.CoreInfo(doc, templateHost, hosts);
            var lv = new CdLinkedView
            {
                ViewId = templateView.Id,
                UniqueId = templateView.UniqueId,
                Name = templateView.Name,
                ViewType = templateView.ViewType,
                CanClone = true,
                Dedicated = true,
                Manual = true,
                // NewView = «энэ харагдац бүхэлдээ загварт зориулагдсан» — бүх tag/хэмжээс/2D-г хуулна, хөрш элементийг байрлалаар нь
                // олно.  Харин ШИНЭ харагдац үүсгэхгүй: зорилтын харагдацыг доор ctx.Dest-д ШУУД өгнө.
                Mode = CdViewMode.NewView,
            };
            CdPlan plan = CdPlan.Prepare(doc, templateHost, info, new List<CdLinkedView> { lv }, options, hosts);
            CdSourceAnnotations a = plan.Sources[templateView.Id];
            o.SourceTags = a.Tags.Count;
            o.SourceMras = a.Mras.Count;
            o.SourceDims = a.Dims.Count;
            o.SourceDetails = options.Details ? a.Details.Count : 0;

            bool flipped;
            CdFrame tgtFrame = TargetFrame(info.Frame, templateView, targetView, targetHost, out flipped);
            o.Flipped = flipped;

            CdContext ctx = CdEngine.BeginTarget(plan, targetHost, rep, false, tgtFrame);
            ctx.Dest[templateView.Id] = targetView;
            ctx.DestIds[templateView.Id] = targetView.Id;
            // Идэвхтэй харагдацад хэрэглэгчийн өөрийн 2D (текст, зураас) байж болно — давхар хуулахгүйн тулд байгааг шалгана.
            ctx.DetailCheck.Add(targetView.Id);

            CdAnnotateWork w = CdEngine.BeginAnnotate(ctx, lv);
            if (w == null)
            {
                o.Problem = "Идэвхтэй харагдацад тэмдэглэгээ хуулах боломжгүй байна.";
                return o;
            }
            // ⚠️ «Хол байгаа зүсэлтийн тэмдгийг нуух» нь ШИНЭ клон харагдацад л зориулагдсан — хэрэглэгчийн өөрийн харагдацад
            // юу ч нууж болохгүй.
            w.Stray = false;
            CdEngine.ContinueAnnotate(ctx, w, null);
            o.Ran = true;
            return o;
        }

        /// <summary>
        /// Зорилтын хүрээ.  Дам нурууг тэнхлэгийн дагуу харсан (огтлол) хоёр харагдацад хоёр харагдац эсрэг талаас харж байвал
        /// зорилтын хүрээг эргүүлнэ; бусад тохиолдолд «Зураг клонлох»-ын ердийн (загварын чиглэлд ойртуулсан) хүрээ.
        /// </summary>
        private static CdFrame TargetFrame(CdFrame tplFrame, View templateView, View targetView, Element target, out bool flipped)
        {
            flipped = false;
            CdFrame plain = CdFrame.Of(target);
            if (tplFrame.Kind != CdFrameKind.Curve || plain.Kind != CdFrameKind.Curve || tplFrame.Axis == null || plain.Axis == null)
                return CdFrame.Of(target, tplFrame);

            double tplDot = templateView.ViewDirection.DotProduct(tplFrame.Axis);
            double tgtDot = targetView.ViewDirection.DotProduct(plain.Axis);
            if (!OntoViewRules.IsEndOn(tplDot) || !OntoViewRules.IsEndOn(tgtDot))
                return CdFrame.Of(target, tplFrame);

            flipped = OntoViewRules.NeedsFlip(tplDot, tgtDot);
            // CdFrame.Of нь align-ийн тэнхлэгтэй < 90°-д ойр чиглэлийг сонгоно — эргүүлэх бол эсрэг тэнхлэгийг align болгоно.
            var align = new CdFrame { Kind = CdFrameKind.Curve, Axis = flipped ? plain.Axis.Negate() : plain.Axis };
            return CdFrame.Of(target, align);
        }
    }
}
