using System;
using System.Linq;
using RevitMcpAddin.Reinforcement.Core;

namespace RevitMcpAddin.Reinforcement.Tests
{
    /// <summary>
    /// 2026-10-12 (эзний t1.pdf): НЭГ «Байрлал» хэрэгслийн БҮХ хэмжээсэд — (1) дэлгээсийн хэмжээсийн шугам «эхний гинж»-ээс ойр биш,
    /// (2) баганын дэлгээсийн хэмжээсийн тал зүүн/баруун (<see cref="RfElevHostFrame.RotatedLeft"/>).  Revit-гүй.
    /// </summary>
    public static class PlacementOct12Tests
    {
        private const double Mm = 1.0 / 304.8;

        private static RfElevInput Beam()
        {
            var i = new RfElevInput { BeamU0 = 0, BeamU1 = 6000 * Mm, BeamV0 = 0, BeamV1 = 500 * Mm };
            i.Options.TagOffsetFt = 100 * Mm;
            i.Options.TagGapFt = 40 * Mm;
            i.Options.DimPitchFt = 150 * Mm;
            i.Options.DefaultTagWidthFt = 300 * Mm;
            i.Options.DefaultTagHeightFt = 120 * Mm;
            i.Options.TagBars = false;
            i.Options.LapDims = false;
            i.GridU.Add(0);
            i.GridU.Add(3000 * Mm);
            i.GridU.Add(6000 * Mm);
            i.Stirrups.Add(new RfElevStirrup { Id = 9, U0 = 100 * Mm, U1 = 5900 * Mm, Count = 20 });
            return i;
        }

        [Test]
        public static void Zero_first_distance_keeps_the_old_layout()
        {
            RfElevInput a = Beam();
            RfElevInput b = Beam();
            b.Options.DimFirstFt = 0;
            RfElevPlan pa = RfElevPlanner.Build(a, null), pb = RfElevPlanner.Build(b, null);
            Assert.Near(pa.Mras[0].LineV, pb.Mras[0].LineV, 1e-12);
            Assert.Near(pa.Spans[0].LineV, pb.Spans[0].LineV, 1e-12);
        }

        [Test]
        public static void First_distance_pushes_the_first_dimension_line_out_to_exactly_that_distance()
        {
            RfElevInput i = Beam();
            double before = RfElevPlanner.Build(i, null).Mras[0].LineV;
            i.Options.DimFirstFt = 1000 * Mm;   // автомат MRA-ийн шугамаас хол
            RfElevPlan p = RfElevPlanner.Build(i, null);
            Assert.True(before > -1000 * Mm, "суурь: шугам 1000 мм-ээс ойр байсан");
            Assert.Near(-1000 * Mm, p.Mras[0].LineV, 1e-9, "MRA-ийн шугам ирмэгээс яг эхний гинжийн зайд");
            Assert.True(p.Mras[0].Head.Y > p.Mras[0].LineV, "MRA-ийн шошго шугамаас гишүүн рүү");
            Assert.True(p.Spans.All(s => s.LineV < p.Mras[0].LineV - 1e-9), "тэнхлэгийн гинж MRA-ийн гадна");
            Assert.Near(p.Spans[0].LineV - 150 * Mm, p.Spans[1].LineV, 1e-9, "нийт = гинжээс нэг алхам");
        }

        [Test]
        public static void First_distance_never_pulls_dimensions_into_the_tags()
        {
            RfElevInput i = Beam();
            double before = RfElevPlanner.Build(i, null).Mras[0].LineV;
            i.Options.DimFirstFt = 5 * Mm;      // шошгоны эгнээнээс ойр — нөлөөгүй
            Assert.Near(before, RfElevPlanner.Build(i, null).Mras[0].LineV, 1e-12);
        }

        [Test]
        public static void First_distance_applies_to_spans_when_there_is_no_mra()
        {
            RfElevInput i = Beam();
            i.Stirrups.Clear();
            i.Options.StirrupMra = false;
            i.Options.DimFirstFt = 700 * Mm;
            RfElevPlan p = RfElevPlanner.Build(i, null);
            Assert.Near(-700 * Mm, p.Spans[0].LineV, 1e-9);
        }

        [Test]
        public static void First_distance_applies_to_top_laps()
        {
            var i = new RfElevInput { BeamU0 = 0, BeamU1 = 8000 * Mm, BeamV0 = 0, BeamV1 = 500 * Mm };
            i.Options.TagOffsetFt = 100 * Mm;
            i.Options.TagGapFt = 40 * Mm;
            i.Options.DimPitchFt = 150 * Mm;
            i.Options.DefaultTagWidthFt = 300 * Mm;
            i.Options.DefaultTagHeightFt = 120 * Mm;
            i.Options.TagBars = false;
            i.Options.StirrupMra = false;
            i.Options.SpanDims = false;
            i.Bars.Add(new RfElevBar { Id = 1, Diameter = 20 * Mm, U0 = 0, U1 = 5000 * Mm, AnchorV = 450 * Mm, MeanV = 450 * Mm, Straight = true });
            i.Bars.Add(new RfElevBar { Id = 2, Diameter = 20 * Mm, U0 = 4500 * Mm, U1 = 8000 * Mm, AnchorV = 450 * Mm, MeanV = 450 * Mm, Straight = true });
            i.Options.DimFirstFt = 900 * Mm;
            RfElevPlan p = RfElevPlanner.Build(i, null);
            Assert.Eq(1, p.Laps.Count);
            Assert.Near(500 * Mm + 900 * Mm, p.Laps[0].LineV, 1e-9, "дээд давхцал ирмэгээс эхний гинжийн зайд");
        }

        [Test]
        public static void Rotated_left_puts_the_planner_bottom_on_the_view_left_and_keeps_handedness()
        {
            var view = new RfViewFrame(new RfV3(0, 0, 0), new RfV3(1, 0, 0), new RfV3(0, 0, 1), new RfV3(0, -1, 0));
            RfViewFrame right = RfElevHostFrame.Rotated(view), left = RfElevHostFrame.RotatedLeft(view);
            // Харагдацын баруун талын цэг (x > 0): Rotated-д v < 0 («доод» = баруун), RotatedLeft-д v > 0 («дээд»).
            Assert.True(right.ToView(new RfV3(1, 0, 2)).Y < 0, "Rotated: доод тал = баруун");
            Assert.True(left.ToView(new RfV3(-1, 0, 2)).Y < 0, "RotatedLeft: доод тал = зүүн");
            Assert.True(left.ToView(new RfV3(1, 0, 2)).Y > 0);
            RfV3 n = left.Right.Cross(left.Up);
            Assert.Near(view.Normal.X, n.X, 1e-12);
            Assert.Near(view.Normal.Y, n.Y, 1e-12);
            Assert.Near(view.Normal.Z, n.Z, 1e-12);
            // Буцааж загварын цэг
            RfV3 back = left.ToModel(left.ToView(new RfV3(-0.7, 0, 3.2)));
            Assert.Near(-0.7, back.X, 1e-12);
            Assert.Near(3.2, back.Z, 1e-12);
        }
    }
}
