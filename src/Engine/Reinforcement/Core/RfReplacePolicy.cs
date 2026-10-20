namespace RevitMcpAddin.Reinforcement.Core
{
    /// <summary>
    /// «Өмнөхийг солих» үед өмнөх автомат тэмдэглэгээг УСТГАХ эсэх ЦЭВЭР шийдвэр (Revit-гүй, тестлэгдсэн).
    /// Зарчим: хэрэглэгчийн сайн тэмдэглэгээг устгахаас давхардал дээр.  Өмнөх нэг төрлийг (хэмжээс / tag) зөвхөн ШИНЭ тэр төрөл
    /// БҮРЭН үүссэн үед л устгана — дутуу үүссэн (4 хэмжээснээс 1 нь) эсвэл энэ удаа огт төлөвлөөгүй (хомут олдоогүй, хэмжээсийг унтраасан) бол үлдээнэ.
    /// </summary>
    public static class RfReplacePolicy
    {
        public static bool DimsReplaceable(int planned, int made, int failed)
        {
            return planned > 0 && failed == 0 && made >= planned;
        }

        public static bool TagsReplaceable(int planned, int made)
        {
            return planned > 0 && made >= planned;
        }
    }
}
