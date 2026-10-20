using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Microsoft.Win32;
using RevitMcpAddin.Licensing.Core;

// Зөвхөн Windows-ийн API (registry, user32) — add-in ч, тест ч Windows дээр л ажиллана.
#pragma warning disable CA1416

namespace RevitMcpAddin.Licensing
{
    /// <summary>
    /// Энэ компьютерын лицензийн профайлыг Windows-оос уншина (Revit-ээс үл хамаарна).
    ///
    ///   DeviceId — SHA-256(MachineGuid | Windows хэрэглэгч)  (`DeviceProfile.ComputeDeviceId`)
    ///   Gpus     — registry-ийн дэлгэцийн адаптерын анги (DriverDesc) + EnumDisplayDevices.
    ///              Хөтчийн WebGL renderer нь DXGI-ийн адаптерын тайлбарыг өгдөг бөгөөд
    ///              тэр нь драйверын DriverDesc-тэй ИЖИЛ мөр (сервер хоёуланг нормчилно).
    ///              Зөөврийн компьютерт integrated + NVIDIA хоёулаа жагсаалтад орно.
    ///   Cores    — `Environment.ProcessorCount` (= хөтчийн `hardwareConcurrency`).
    ///   Screens  — холбогдсон дэлгэц бүрийн ФИЗИК нягтрал (EnumDisplaySettings).
    ///              Хөтчийнх нь масштабтай CSS хэмжээ — сервер харьцаагаар тулгана.
    ///
    /// ⚠️ АЛДАА ШИДЭХГҮЙ: аль нэг эх сурвалж уншигдахгүй бол хоосон үлдэнэ — сервер
    ///    хангалтгүй профайлыг `NO_HW_PROFILE` гэж хэлж, admin гараар зөвшөөрөх замыг
    ///    үлдээнэ.  Түүхий утга (машины нэр, GUID) сервер рүү ХЭЗЭЭ Ч явахгүй.
    /// </summary>
    public static class HardwareProbe
    {
        private const string DisplayClassKey =
            @"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}";

        private static string _deviceIdCache;

        /// <summary>Энэ компьютерын төхөөрөмжийн id (процесс тутамд нэг удаа уншина).</summary>
        public static string DeviceId()
        {
            string cached = _deviceIdCache;
            if (cached != null) return cached;
            string guid = ReadMachineGuid();
            string user = SafeUser();
            string id = DeviceProfile.ComputeDeviceId(
                string.IsNullOrEmpty(guid) ? "name:" + SafeMachineName() : guid,
                user);
            _deviceIdCache = id;
            return id;
        }

        /// <summary>Бүтэн профайл — дэлгэц залгах/салгахыг тусгахын тулд хүсэлт бүрд шинээр.</summary>
        public static DeviceProfile Read()
        {
            var gpus = new List<string>();
            var screens = new List<string>();
            try { gpus.AddRange(ReadRegistryAdapters()); } catch { }
            try { ReadDisplayDevices(gpus, screens); } catch { }
            int cores = 0;
            try { cores = Environment.ProcessorCount; } catch { }
            return new DeviceProfile(DeviceId(), gpus, cores, screens);
        }

        private static string SafeUser()
        {
            try { return Environment.UserDomainName + "\\" + Environment.UserName; }
            catch { return string.Empty; }
        }

        private static string SafeMachineName()
        {
            try { return Environment.MachineName; } catch { return string.Empty; }
        }

        private static string ReadMachineGuid()
        {
            try
            {
                using (RegistryKey hklm = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
                using (RegistryKey k = hklm.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography"))
                {
                    return k?.GetValue("MachineGuid") as string;
                }
            }
            catch
            {
                return null;
            }
        }

        private static IEnumerable<string> ReadRegistryAdapters()
        {
            var list = new List<string>();
            using (RegistryKey hklm = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64))
            using (RegistryKey cls = hklm.OpenSubKey(DisplayClassKey))
            {
                if (cls == null) return list;
                foreach (string name in cls.GetSubKeyNames())
                {
                    // Зөвхөн «0000», «0001» … драйверын жишээ; «Properties» г.м. алгасна.
                    if (name.Length != 4 || !int.TryParse(name, out _)) continue;
                    try
                    {
                        using (RegistryKey sub = cls.OpenSubKey(name))
                        {
                            if (sub?.GetValue("DriverDesc") is string desc && !string.IsNullOrWhiteSpace(desc))
                                list.Add(desc.Trim());
                        }
                    }
                    catch
                    {
                        // Эрхгүй дэд түлхүүр — алгасна.
                    }
                }
            }
            return list;
        }

        private static void ReadDisplayDevices(List<string> gpus, List<string> screens)
        {
            for (uint i = 0; i < 32; i++)
            {
                var dd = new DISPLAY_DEVICE();
                dd.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE));
                if (!EnumDisplayDevices(null, i, ref dd, 0)) break;
                if ((dd.StateFlags & DISPLAY_DEVICE_MIRRORING_DRIVER) != 0) continue;
                if (!string.IsNullOrWhiteSpace(dd.DeviceString)) gpus.Add(dd.DeviceString.Trim());
                if ((dd.StateFlags & DISPLAY_DEVICE_ATTACHED_TO_DESKTOP) == 0) continue;

                var dm = new DEVMODE();
                dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
                if (EnumDisplaySettings(dd.DeviceName, ENUM_CURRENT_SETTINGS, ref dm))
                {
                    string key = DeviceProfile.ScreenKey(dm.dmPelsWidth, dm.dmPelsHeight);
                    if (key != null) screens.Add(key);
                }
            }
        }

        // ── user32 ──────────────────────────────────────────────────────

        private const int ENUM_CURRENT_SETTINGS = -1;
        private const int DISPLAY_DEVICE_ATTACHED_TO_DESKTOP = 0x1;
        private const int DISPLAY_DEVICE_MIRRORING_DRIVER = 0x8;

        [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "EnumDisplayDevicesW")]
        private static extern bool EnumDisplayDevices(string lpDevice, uint iDevNum, ref DISPLAY_DEVICE lpDisplayDevice, uint dwFlags);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "EnumDisplaySettingsW")]
        private static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct DISPLAY_DEVICE
        {
            public int cb;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString;
            public int StateFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey;
        }

        /// <summary>DEVMODEW (дэлгэцийн хувилбар) — 220 байт.</summary>
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct DEVMODE
        {
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
            public short dmSpecVersion;
            public short dmDriverVersion;
            public short dmSize;
            public short dmDriverExtra;
            public int dmFields;
            public int dmPositionX;
            public int dmPositionY;
            public int dmDisplayOrientation;
            public int dmDisplayFixedOutput;
            public short dmColor;
            public short dmDuplex;
            public short dmYResolution;
            public short dmTTOption;
            public short dmCollate;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
            public short dmLogPixels;
            public int dmBitsPerPel;
            public int dmPelsWidth;
            public int dmPelsHeight;
            public int dmDisplayFlags;
            public int dmDisplayFrequency;
            public int dmICMMethod;
            public int dmICMIntent;
            public int dmMediaType;
            public int dmDitherType;
            public int dmReserved1;
            public int dmReserved2;
            public int dmPanningWidth;
            public int dmPanningHeight;
        }
    }
}
