using System;
using System.Collections.Generic;
using RevitMcpAddin.WallElevation.Core;

namespace RevitMcpAddin.WallElevation.Tests
{
    /// <summary>Тестийн өгөгдөл — бүх урт ФУТ (Revit-ийн дотоод нэгж), мм-ээс <see cref="Mm"/>-ээр.</summary>
    public static class Fx
    {
        public static readonly IWeUnits Units = new WeFixedUnits();

        public static double Mm(double mm) { return Units.MmToInternal(mm); }

        public static WeV3 P(double xMm, double yMm, double zMm = 0) { return new WeV3(Mm(xMm), Mm(yMm), Mm(zMm)); }

        private static int _seq = 1000;

        public static WeWallInfo Wall(WeV3 start, WeV3 end, WeV3 exteriorHint, double widthMm = 200, double heightMm = 3000,
                                      WeWallKind kind = WeWallKind.Basic, string level = "L01", long id = 0)
        {
            long wid = id != 0 ? id : ++_seq;
            return new WeWallInfo
            {
                UniqueId = "wall-" + wid,
                Id = wid,
                Mark = string.Empty,
                TypeName = "Generic 200",
                LevelName = level,
                Kind = kind,
                HasLocationLine = true,
                IsCurved = false,
                IsSlanted = false,
                LocationIsCenterline = true,
                Start = start,
                End = end,
                Width = Mm(widthMm),
                BottomZ = 0,
                TopZ = Mm(heightMm),
                OrientationHint = exteriorHint,
            };
        }

        /// <summary>Тэгш өнцөгт өрөө (0,0)–(w,h) мм, 4 хана, гадна тал нь өрөөнөөс ГАДАГШ.  ccw = контурын чиглэл.</summary>
        public static WeRequest SquareRoom(double wMm, double hMm, bool ccw = true, string number = "101")
        {
            var req = new WeRequest();
            WeV3 a = P(0, 0), b = P(wMm, 0), c = P(wMm, hMm), d = P(0, hMm);
            WeWallInfo south = Wall(a, b, new WeV3(0, -1, 0));
            WeWallInfo east = Wall(b, c, new WeV3(1, 0, 0));
            WeWallInfo north = Wall(c, d, new WeV3(0, 1, 0));
            WeWallInfo west = Wall(d, a, new WeV3(-1, 0, 0));
            foreach (WeWallInfo w in new[] { south, east, north, west }) req.WallLookup[w.UniqueId] = w;

            var loop = new WeRoomLoop();
            var segs = new List<WeBoundarySegment>
            {
                Seg(south, a, b), Seg(east, b, c), Seg(north, c, d), Seg(west, d, a),
            };
            if (!ccw)
            {
                // Урвуу контур: сегмент бүрийг эсрэг чиглэлд, дарааллыг урвуу.
                var rev = new List<WeBoundarySegment>();
                for (int i = segs.Count - 1; i >= 0; i--)
                    rev.Add(new WeBoundarySegment { Host = WeBoundaryHost.Wall, WallUniqueId = segs[i].WallUniqueId, IsStraight = true, A = segs[i].B, B = segs[i].A });
                segs = rev;
            }
            loop.Segments.AddRange(segs);

            req.Rooms.Add(new WeRoomInfo
            {
                UniqueId = "room-" + number,
                Id = 500,
                Number = number,
                Name = "Office",
                LevelName = "L01",
                BottomZ = 0,
                TopZ = Mm(2800),
                IsPlaced = true,
                IsEnclosed = true,
                Loops = { loop },
            });
            return req;
        }

        public static WeBoundarySegment Seg(WeWallInfo w, WeV3 a, WeV3 b)
        {
            return new WeBoundarySegment { Host = WeBoundaryHost.Wall, WallUniqueId = w.UniqueId, IsStraight = true, A = a, B = b };
        }

        public static WePlanContext Ctx(Action<WeSettings> tweak = null)
        {
            var s = new WeSettings();
            if (tweak != null) tweak(s);
            return new WePlanContext { Settings = s, Units = Units, ViewSetupToken = "type:1|tpl:0|scale:" + s.Scale };
        }

        /// <summary>Төлөвлөгөөг «үүсгэсэн» мэт байгаа харагдац болгоно (дахин ажиллуулах тест).</summary>
        public static List<WeExistingView> AsExisting(WePlan plan)
        {
            var r = new List<WeExistingView>();
            long id = 9000;
            foreach (WePlannedElevation i in plan.Items)
            {
                if (i.Action != WeAction.Create) continue;
                r.Add(new WeExistingView
                {
                    ViewId = ++id,
                    Key = i.Key,
                    Signature = i.Signature,
                    Name = i.Name,
                    GeneratedName = i.Name,
                    WallUid = i.WallUid,
                    RoomUid = i.RoomUid,
                    GeneratorVersion = WeIdentity.GeneratorVersion,
                    SourceWallExists = true,
                    SourceRoomExists = true,
                });
            }
            return r;
        }

        public static WePlannedElevation Only(WePlan plan)
        {
            Assert.Eq(1, plan.Items.Count, "төлөвлөгөөний мөрийн тоо");
            return plan.Items[0];
        }

        /// <summary>Төлөвлөсөн хүрээгээр «Revit-ийн» зөв харагдацын snapshot (validator тест).</summary>
        public static WeViewSnapshot SnapshotOf(WePlannedElevation p)
        {
            return new WeViewSnapshot
            {
                Exists = true,
                Center = p.Frame.ToWorld(p.Box.LocalCenter.X, p.Box.LocalCenter.Y, p.Box.LocalCenter.Z),
                Right = p.Frame.Right,
                Up = p.Frame.Up,
                ViewDirection = p.Frame.ViewDirection,
                Half = p.Box.Half,
                CropActive = true,
                FarClipDepth = p.Box.Depth,
                TemplateId = -1,
                IdentityKey = p.Key,
                SameKeyCount = 1,
            };
        }
    }
}
