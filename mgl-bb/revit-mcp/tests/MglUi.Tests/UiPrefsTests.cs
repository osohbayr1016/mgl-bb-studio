using System;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin.Ui.Tests
{
    public static class UiPrefsTests
    {
        [Test]
        public static void Roundtrip_keeps_windows_and_flags()
        {
            var p = new UiPrefs();
            p.SetWindow("sheet-numerator", new UiRect(10, 20, 900, 600));
            p.SetFlag("catalog.hint.dismissed", true);
            UiPrefs q = UiPrefsJson.Parse(UiPrefsJson.Serialize(p));
            UiRect r;
            Assert.True(q.TryGetWindow("sheet-numerator", out r));
            Assert.Eq(900.0, r.Width);
            Assert.Eq(20.0, r.Top);
            Assert.True(q.GetFlag("catalog.hint.dismissed"));
            Assert.False(q.GetFlag("never.set"));
        }

        [Test]
        public static void Json_uses_stable_snake_case_names()
        {
            var p = new UiPrefs();
            p.SetWindow("w", new UiRect(1, 2, 300, 200));
            string json = UiPrefsJson.Serialize(p);
            Assert.True(json.Contains("\"schema_version\""), json);
            Assert.True(json.Contains("\"windows\""), json);
            Assert.True(json.Contains("\"flags\""), json);
        }

        [Test]
        public static void Corrupt_empty_or_hostile_files_never_throw()
        {
            foreach (string bad in new[] { null, "", "   ", "{", "not json", "[1,2,3]", "{\"windows\": 5}", "{\"windows\":{\"a\":null}}" })
            {
                UiPrefs p = UiPrefsJson.Parse(bad);
                Assert.NotNull(p, "'" + bad + "'");
                UiRect r;
                Assert.False(p.TryGetWindow("a", out r));
            }
        }

        [Test]
        public static void Nonsense_window_values_are_dropped_on_parse()
        {
            string json = "{\"windows\":{\"ok\":{\"left\":1,\"top\":2,\"width\":500,\"height\":400},"
                        + "\"tiny\":{\"left\":1,\"top\":2,\"width\":5,\"height\":5},"
                        + "\"neg\":{\"left\":1,\"top\":2,\"width\":-500,\"height\":400}}}";
            UiPrefs p = UiPrefsJson.Parse(json);
            UiRect r;
            Assert.True(p.TryGetWindow("ok", out r));
            Assert.False(p.TryGetWindow("tiny", out r));
            Assert.False(p.TryGetWindow("neg", out r));
        }

        [Test]
        public static void Entry_count_and_key_length_are_capped()
        {
            var p = new UiPrefs();
            for (int i = 0; i < 200; i++) p.SetWindow("w" + i, new UiRect(0, 0, 400, 300));
            Assert.Eq(UiPrefs.MaxEntries, p.Windows.Count);
            p.SetWindow(new string('x', UiPrefs.MaxKeyLength + 1), new UiRect(0, 0, 400, 300));
            Assert.Eq(UiPrefs.MaxEntries, p.Windows.Count);
            // аль хэдийн байгаа түлхүүрийг шинэчлэх нь хязгаарт тулсан ч ажиллана
            p.SetWindow("w0", new UiRect(5, 5, 700, 500));
            UiRect r;
            Assert.True(p.TryGetWindow("w0", out r));
            Assert.Eq(700.0, r.Width);
        }

        [Test]
        public static void Setting_nan_or_tiny_window_is_ignored()
        {
            var p = new UiPrefs();
            p.SetWindow("a", new UiRect(double.NaN, 0, 400, 300));
            p.SetWindow("b", new UiRect(0, 0, 10, 10));
            p.SetWindow("", new UiRect(0, 0, 400, 300));
            Assert.Eq(0, p.Windows.Count);
        }
    }
}
