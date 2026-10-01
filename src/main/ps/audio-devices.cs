// Læser Windows' standard-afspilningsenhed via Core Audio (IMMDeviceEnumerator).
// Kompileres af PowerShell (Add-Type) i src/main/ps/audio-watch.ps1. Kun læsning.
using System;
using System.Runtime.InteropServices;

namespace VisampAudio
{
    [StructLayout(LayoutKind.Sequential)]
    public struct PropertyKey { public Guid fmtid; public int pid; }

    [StructLayout(LayoutKind.Explicit)]
    public struct PropVariant { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr pointerValue; }

    [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPropertyStore
    {
        int GetCount(out int count);
        int GetAt(int index, out PropertyKey key);
        int GetValue(ref PropertyKey key, out PropVariant value);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDevice
    {
        int Activate(ref Guid iid, int context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object result);
        int OpenPropertyStore(int access, out IPropertyStore store);
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        int GetState(out int state);
    }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDeviceEnumerator
    {
        int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    public class MMDeviceEnumeratorComObject { }

    public static class Audio
    {
        // dataFlow 0 = afspilning; role 1 = multimedie (den rolle musik-apps som Spotify bruger).
        public static string DefaultRender()
        {
            var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            IMMDevice device;
            Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
            string id;
            Marshal.ThrowExceptionForHR(device.GetId(out id));
            IPropertyStore store;
            Marshal.ThrowExceptionForHR(device.OpenPropertyStore(0, out store));
            var key = new PropertyKey { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
            PropVariant value;
            Marshal.ThrowExceptionForHR(store.GetValue(ref key, out value));
            string name = value.pointerValue == IntPtr.Zero ? "" : Marshal.PtrToStringUni(value.pointerValue);
            return id + "|" + name;
        }
    }
}
