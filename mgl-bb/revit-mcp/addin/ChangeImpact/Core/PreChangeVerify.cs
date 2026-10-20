using System;
using System.Collections.Generic;
using System.Linq;
using RevitMcpAddin.ClashCheck.Core;

namespace RevitMcpAddin.ChangeImpact.Core
{
    public sealed class VerifyResult
    {
        public bool Matches { get { return Differences.Count == 0 && Compared.Count > 0; } }
        /// <summary>Нэг ч ялгаа олдсонгүй ч ЮУ Ч тулгаагүй бол «баталгаажсан» гэж хэлэхгүй.</summary>
        public bool NothingCompared { get { return Compared.Count == 0; } }
        public List<string> Differences { get; set; } = new List<string>();
        public List<string> Compared { get; set; } = new List<string>();
        public List<string> NotCompared { get; set; } = new List<string>();
    }

    /// <summary>
    /// Preview-ийн ДАРААХ snapshot-г БОДИТ хэрэгжүүлсний ДАРААХ snapshot-той тулгана — ЦЭВЭР.
    /// Хоёр нь ижил загвар, ижил үйлдлээс гарах тул хатуу хүлцэлтэй (`Verify*`).  Материаллаг ялгаа = Apply-г буцаана.
    ///
    /// ПРИНЦИП: тулгаж чадаагүй хэсгийг «таарсан» гэж хэлэхгүй — `NotCompared`-д ил жагсаана.
    /// </summary>
    public static class PreChangeVerifier
    {
        public static VerifyResult Compare(StateSnapshot preview, StateSnapshot actual)
        {
            var res = new VerifyResult();
            if (preview == null || actual == null || !preview.Captured || !actual.Captured)
            {
                res.NotCompared.Add("бүгд (snapshot бүрэн биш)");
                return res;
            }

            CompareRooms(preview, actual, res);
            CompareDimensions(preview, actual, res);
            CompareHosted(preview, actual, res);
            CompareJoined(preview, actual, res);
            CompareSchedules(preview, actual, res);
            CompareClash(preview, actual, res);
            CompareEgress(preview, actual, res);
            return res;
        }

        private static void CompareRooms(StateSnapshot p, StateSnapshot a, VerifyResult res)
        {
            if (p.Rooms.Count == 0 && a.Rooms.Count == 0) { res.NotCompared.Add("өрөө (нэр дэвшигч алга)"); return; }
            res.Compared.Add("өрөө");
            foreach (long id in p.Rooms.Keys.Union(a.Rooms.Keys))
            {
                RoomSnap x, y;
                bool hx = p.Rooms.TryGetValue(id, out x), hy = a.Rooms.TryGetValue(id, out y);
                if (hx != hy) { res.Differences.Add("Өрөө #" + id + (hx ? " бодитоор алга боллоо" : " бодитоор шинээр үүслээ")); continue; }
                if (!x.Readable || !y.Readable) continue;
                bool ex = x.Placed && x.Enclosed, ey = y.Placed && y.Enclosed;
                if (ex != ey) { res.Differences.Add(x.Label + ": хаалттай эсэх preview-ээс өөр"); continue; }
                if (ex && Math.Abs(x.AreaM2 - y.AreaM2) > PreChangeTolerance.VerifyAreaM2)
                    res.Differences.Add(x.Label + ": талбай preview " + PreChangeText.M2(x.AreaM2) + ", бодит " + PreChangeText.M2(y.AreaM2));
            }
        }

        private static void CompareDimensions(StateSnapshot p, StateSnapshot a, VerifyResult res)
        {
            if (p.Dimensions.Count == 0 && a.Dimensions.Count == 0) { res.NotCompared.Add("хэмжээс (нэр дэвшигч алга)"); return; }
            res.Compared.Add("хэмжээс");
            foreach (long id in p.Dimensions.Keys.Union(a.Dimensions.Keys))
            {
                DimSnap x, y;
                bool hx = p.Dimensions.TryGetValue(id, out x), hy = a.Dimensions.TryGetValue(id, out y);
                if (hx != hy) { res.Differences.Add("Хэмжээс #" + id + " preview-тэй таарсангүй (байгаа/байхгүй)"); continue; }
                if (!x.Readable || !y.Readable) continue;
                if (x.SegmentsMm.Count != y.SegmentsMm.Count) { res.Differences.Add("Хэмжээс #" + id + ": сегментийн тоо өөр"); continue; }
                for (int i = 0; i < x.SegmentsMm.Count; i++)
                    if (Math.Abs(x.SegmentsMm[i] - y.SegmentsMm[i]) > PreChangeTolerance.VerifyLengthMm)
                    {
                        res.Differences.Add("Хэмжээс #" + id + ": preview " + PreChangeText.Mm(x.SegmentsMm[i]) + ", бодит " + PreChangeText.Mm(y.SegmentsMm[i]));
                        break;
                    }
            }
        }

        private static void CompareHosted(StateSnapshot p, StateSnapshot a, VerifyResult res)
        {
            if (p.Hosted.Count == 0 && a.Hosted.Count == 0) return;     // хаалга/цонхгүй хана — тулгах зүйл байхгүй (алдаа биш)
            res.Compared.Add("хаалга/цонх");
            foreach (long id in p.Hosted.Keys.Union(a.Hosted.Keys))
            {
                HostedSnap x, y;
                bool hx = p.Hosted.TryGetValue(id, out x), hy = a.Hosted.TryGetValue(id, out y);
                if (hx != hy || (hx && x.Exists != y.Exists)) { res.Differences.Add("Хаалга/цонх #" + id + " preview-тэй таарсангүй"); continue; }
                double[] d = PreChangeTolerance.DiffMm(x.LocationMm, y.LocationMm);
                if (d != null && PreChangeTolerance.LengthOfMm(d) > PreChangeTolerance.VerifyLengthMm)
                    res.Differences.Add("Хаалга/цонх #" + id + ": байрлал preview-ээс " + PreChangeText.Mm(PreChangeTolerance.LengthOfMm(d)) + "-ээр зөрсөн");
                // Хост ба From/To өрөө: preview-д хэмжсэнтэй ИЖИЛ байх ёстой (хаалга зөөхөд чухал; хана зөөхөд ч зөв).
                if (x.HostKnown && y.HostKnown && x.HostId != y.HostId)
                    res.Differences.Add("Хаалга/цонх #" + id + ": хост preview-ээс өөр боллоо");
                if (x.RoomsReadable && y.RoomsReadable && (x.FromRoomId != y.FromRoomId || x.ToRoomId != y.ToRoomId))
                    res.Differences.Add("Хаалга/цонх #" + id + ": From/To өрөө preview-ээс өөр боллоо");
            }
        }

        private static void CompareJoined(StateSnapshot p, StateSnapshot a, VerifyResult res)
        {
            foreach (long id in p.Joined.Keys)
            {
                ElementPlace x = p.Joined[id], y;
                // Preview-д байсан холбогдсон хана бодит settled төлөвт ОЛДООГҮЙ (устсан/уншигдаагүй) — чимээгүй алгасахгүй, ялгаа гэж тооцно.
                if (!a.Joined.TryGetValue(id, out y)) { res.Differences.Add("Холбогдсон хана #" + id + " бодит төлөвт олдсонгүй (preview-д байсан)"); continue; }
                if (x.Location == null || y.Location == null || x.Location.Length != y.Location.Length) continue;
                for (int i = 0; i < x.Location.Length; i++)
                    if (Math.Abs(x.Location[i] - y.Location[i]) > PreChangeTolerance.VerifyLengthMm)
                    {
                        res.Differences.Add("Холбогдсон хана #" + id + " preview-ээс өөр хэлбэртэй боллоо");
                        break;
                    }
            }
        }

        private static void CompareSchedules(StateSnapshot p, StateSnapshot a, VerifyResult res)
        {
            var common = p.Schedules.Keys.Where(a.Schedules.ContainsKey).Where(k => p.Schedules[k].Evaluated && a.Schedules[k].Evaluated).ToList();
            if (common.Count == 0) { if (p.Schedules.Count > 0) res.NotCompared.Add("хүснэгт"); return; }
            res.Compared.Add("хүснэгт");
            foreach (long id in common)
                if (!p.Schedules[id].Members.SetEquals(a.Schedules[id].Members))
                    res.Differences.Add("Хүснэгт «" + p.Schedules[id].Name + "»: мөрийн гишүүнчлэл preview-ээс өөр");
        }

        private static void CompareClash(StateSnapshot p, StateSnapshot a, VerifyResult res)
        {
            if (!p.Clash.Evaluated || !a.Clash.Evaluated) { res.NotCompared.Add("MEP clash"); return; }
            res.Compared.Add("MEP clash");
            var pp = new HashSet<string>(p.Clash.Pairs.Values.Where(x => x.Verdict == ClashVerdict.ConfirmedClash).Select(x => x.Key), StringComparer.Ordinal);
            var aa = new HashSet<string>(a.Clash.Pairs.Values.Where(x => x.Verdict == ClashVerdict.ConfirmedClash).Select(x => x.Key), StringComparer.Ordinal);
            if (!pp.SetEquals(aa))
                res.Differences.Add("MEP clash-ийн багц preview-ээс өөр (" + pp.Count + " → " + aa.Count + ")");
        }

        private static void CompareEgress(StateSnapshot p, StateSnapshot a, VerifyResult res)
        {
            if (!p.Egress.Configured || !p.Egress.Evaluated || !a.Egress.Evaluated) { res.NotCompared.Add("гарцын зам"); return; }
            res.Compared.Add("гарцын зам");
            foreach (long id in p.Egress.Routes.Keys)
            {
                EgressRoute x = p.Egress.Routes[id], y;
                if (!a.Egress.Routes.TryGetValue(id, out y) || !x.Evaluated || !y.Evaluated) continue;
                if (x.LengthM.HasValue != y.LengthM.HasValue) { res.Differences.Add("Гарцын зам (" + x.RoomName + "): боломжтой эсэх preview-ээс өөр"); continue; }
                if (x.LengthM.HasValue && Math.Abs(x.LengthM.Value - y.LengthM.Value) > PreChangeTolerance.VerifyRouteM)
                    res.Differences.Add("Гарцын зам (" + x.RoomName + "): preview " + PreChangeText.M(x.LengthM) + ", бодит " + PreChangeText.M(y.LengthM));
            }
        }
    }
}
