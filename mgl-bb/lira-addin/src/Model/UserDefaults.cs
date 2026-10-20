using System;
using System.IO;
using System.Runtime.Serialization.Json;

namespace MglLiraReport.Model
{
    /// <summary>
    /// Төслөөс үл хамаарах мэдээллийг (компани, захирал, инженер, лиценз, хаяг) хэрэглэгчийн
    /// компьютерт санаж, шинэ тайланд урьдчилан бөглөнө.  Төслийн нэр/шифр/захиалагчийг САНАХГҮЙ.
    /// </summary>
    public static class UserDefaults
    {
        static string FilePath => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "MGL", "LiraReport", "defaults.json");

        public static void Remember(ProjectInfo p)
        {
            try
            {
                var keep = new ProjectInfo
                {
                    Title = p.Title, Company = p.Company, Director = p.Director, Engineer = p.Engineer,
                    Authors = p.Authors, Program = p.Program, License = p.License,
                    CoverLine1 = p.CoverLine1, CoverLine2 = p.CoverLine2, CompanyAddress = p.CompanyAddress,
                    Name = "", Location = "", Shifr = "", Client = "", ClientAddress = "", Date = "", Year = "",
                };
                Directory.CreateDirectory(Path.GetDirectoryName(FilePath));
                using (var fs = File.Create(FilePath))
                    new DataContractJsonSerializer(typeof(ProjectInfo)).WriteObject(fs, keep);
            }
            catch { /* санах нь заавал биш */ }
        }

        public static void Apply(ProjectInfo target)
        {
            try
            {
                if (!File.Exists(FilePath)) return;
                ProjectInfo saved;
                using (var fs = File.OpenRead(FilePath))
                    saved = (ProjectInfo)new DataContractJsonSerializer(typeof(ProjectInfo)).ReadObject(fs);
                if (saved == null) return;
                saved.Normalize();
                target.Title = saved.Title; target.Company = saved.Company; target.Director = saved.Director;
                target.Engineer = saved.Engineer; target.Program = saved.Program; target.License = saved.License;
                target.CoverLine1 = saved.CoverLine1; target.CoverLine2 = saved.CoverLine2;
                target.CompanyAddress = saved.CompanyAddress;
                target.Authors = saved.Authors.ConvertAll(a => new AuthorInfo { Name = a.Name, Qualification = a.Qualification });
            }
            catch { }
        }
    }
}
