using System.Drawing;
using System.IO;

namespace MglLiraReport.UI
{
    static class ImageUtil
    {
        /// <summary>Stream-ээс салгасан хуулбар — Image.FromStream нь stream-ийг амьд барих шаардлагатай.</summary>
        public static Image FromBytes(byte[] bytes)
        {
            try
            {
                using (var ms = new MemoryStream(bytes))
                using (var img = Image.FromStream(ms))
                    return new Bitmap(img);
            }
            catch { return null; }
        }
    }
}
