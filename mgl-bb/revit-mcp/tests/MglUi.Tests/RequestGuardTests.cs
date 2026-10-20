using System;
using RevitMcpAddin.Ui.Core;

namespace RevitMcpAddin.Ui.Tests
{
    /// <summary>Нэвтрэх/жагсаалт ачаалах async-ийн «хоцорсон хариу», цонх хаагдах, хаяг солигдох үеийн дүрэм.</summary>
    public static class RequestGuardTests
    {
        [Test]
        public static void Only_the_latest_request_is_accepted()
        {
            var g = new RequestGuard();
            int first = g.Begin();
            int e = g.Epoch;
            Assert.True(g.Accept(first, e));
            int second = g.Begin();                    // шинэ хүсэлт эхэллээ
            Assert.False(g.Accept(first, e), "хуучин хүсэлтийн хариу хаягдана");
            Assert.True(g.Accept(second, e));
        }

        [Test]
        public static void Changing_the_server_address_discards_the_response_in_flight()
        {
            var g = new RequestGuard();
            int id = g.Begin();
            int epoch = g.Epoch;                       // хүсэлт хуучин хаяг руу явсан
            g.InvalidateInFlight();                    // хэрэглэгч хаяг засав
            Assert.False(g.Accept(id, epoch), "хуучин хаягийн хариу шинэ хаягийн жагсаалтыг дарж болохгүй");
            // Шинэ хүсэлт шинэ epoch-оор хүчинтэй
            int id2 = g.Begin();
            Assert.True(g.Accept(id2, g.Epoch));
        }

        [Test]
        public static void A_closed_window_accepts_nothing()
        {
            var g = new RequestGuard();
            int id = g.Begin();
            int epoch = g.Epoch;
            Assert.False(g.IsClosed);
            g.Close();
            Assert.True(g.IsClosed);
            Assert.False(g.Accept(id, epoch), "цонх хаагдсаны дараа хоцорсон хариу UI-д хүрэхгүй");
        }

        [Test]
        public static void Late_401_for_an_old_credential_never_clears_a_newer_login()
        {
            // «Хуучин токентой auto-load 401 өгөхөд хэрэглэгч шинэ нэвтрэлт хийчихсэн» хөндлөнгийн тохиолдол.
            Assert.False(RequestGuard.ShouldClearCredential("old-token", "new-token"));
            Assert.True(RequestGuard.ShouldClearCredential("same", "same"));
            Assert.False(RequestGuard.ShouldClearCredential(null, "x"));
            Assert.False(RequestGuard.ShouldClearCredential("", ""), "хоосон токеныг «арилгах»-гүй");
            Assert.False(RequestGuard.ShouldClearCredential("x", null), "нэвтрэлт аль хэдийн байхгүй");
        }

        [Test]
        public static void Login_started_while_project_load_is_in_flight_supersedes_it()
        {
            var g = new RequestGuard();
            int load = g.Begin();
            int loadEpoch = g.Epoch;
            int login = g.Begin();                     // хэрэглэгч «Нэвтрэх» дарав
            Assert.False(g.Accept(load, loadEpoch));
            Assert.True(g.Accept(login, g.Epoch));
        }
    }
}
