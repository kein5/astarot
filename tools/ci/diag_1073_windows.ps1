# Temporary (Issue #1073): how often the Credential Manager tests of native/core/tests/secret_store.rs
# fail ("current": as voice-tests.yml runs them, the two tests in parallel; "serial": one at a time),
# and whether the Credential Manager itself loses a delete when two threads of one process write
# and delete at the same time ("credrace", without the app).
param([string]$Variant, [int]$Runs)
$ErrorActionPreference = 'Continue'

if ($Variant -eq 'credrace') {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class CredRace {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct CREDENTIAL {
        public uint Flags; public uint Type; public string TargetName; public string Comment;
        public long LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob;
        public uint Persist; public uint AttributeCount; public IntPtr Attributes;
        public string TargetAlias; public string UserName;
    }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CredWriteW(ref CREDENTIAL credential, uint flags);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CredReadW(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CredDeleteW(string target, uint type, uint flags);
    [DllImport("advapi32.dll")]
    static extern void CredFree(IntPtr credential);
    const uint GENERIC = 1, LOCAL_MACHINE = 2, NOT_FOUND = 1168;

    static void Write(string target, string value) {
        byte[] bytes = Encoding.UTF8.GetBytes(value);
        IntPtr blob = Marshal.AllocHGlobal(bytes.Length);
        Marshal.Copy(bytes, 0, blob, bytes.Length);
        var c = new CREDENTIAL { Type = GENERIC, TargetName = target, CredentialBlobSize = (uint)bytes.Length,
            CredentialBlob = blob, Persist = LOCAL_MACHINE, UserName = "diag-1073" };
        bool ok = CredWriteW(ref c, 0);
        int error = Marshal.GetLastWin32Error();
        Marshal.FreeHGlobal(blob);
        if (!ok) throw new Exception("CredWrite " + error);
    }
    static bool Exists(string target) {
        IntPtr found;
        if (CredReadW(target, GENERIC, 0, out found)) { CredFree(found); return true; }
        int error = Marshal.GetLastWin32Error();
        if (error == NOT_FOUND) return false;
        throw new Exception("CredRead " + error);
    }
    static void Delete(string target) {
        if (!CredDeleteW(target, GENERIC, 0)) {
            int error = Marshal.GetLastWin32Error();
            if (error != NOT_FOUND) throw new Exception("CredDelete " + error);
        }
    }

    // Each thread writes, reads back and deletes credentials of its own; a credential that is
    // there again after a delete that succeeded, or at the end, is counted.
    public static string Run(int threads, int rounds) {
        int back = 0, left = 0, errors = 0;
        string run = Guid.NewGuid().ToString("N").Substring(0, 8);
        var workers = new Thread[threads];
        for (int t = 0; t < threads; t++) {
            int id = t;
            workers[t] = new Thread(() => {
                for (int r = 0; r < rounds; r++) {
                    string a = "DIAG-1073/" + run + "/" + id + "/" + r + "/a", b = "DIAG-1073/" + run + "/" + id + "/" + r + "/b";
                    try {
                        Write(a, "value-a"); Write(b, "value-b");
                        if (!Exists(a) || !Exists(b)) Interlocked.Increment(ref errors);
                        Delete(a); Delete(b);
                        if (Exists(a)) Interlocked.Increment(ref back);
                        if (Exists(b)) Interlocked.Increment(ref back);
                    } catch (Exception) { Interlocked.Increment(ref errors); }
                }
            });
            workers[t].Start();
        }
        foreach (var w in workers) w.Join();
        for (int t = 0; t < threads; t++)
            for (int r = 0; r < rounds; r++)
                foreach (var e in new[] { "a", "b" }) {
                    string target = "DIAG-1073/" + run + "/" + t + "/" + r + "/" + e;
                    if (Exists(target)) { left++; Delete(target); }
                }
        return string.Format("threads={0} rounds={1} back-after-delete={2} left-at-end={3} errors={4}", threads, rounds, back, left, errors);
    }
}
'@
    foreach ($threads in 1, 2, 4) {
        for ($i = 1; $i -le 5; $i++) { [CredRace]::Run($threads, $Runs) }
    }
    exit 0
}

$bin = Get-ChildItem -Recurse native/core/target/debug -Filter 'secret_store-*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$extra = @()
if ($Variant -eq 'serial') { $extra = @('--test-threads=1') }
$pass = 0; $fail = 0
for ($i = 1; $i -le $Runs; $i++) {
    $out = & $bin.FullName --ignored @extra 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0) { $pass++ } else {
        $fail++
        Write-Output "::group::run $i failed"
        ($out -split "`n") | Select-String 'panicked|left:|right:|FAILED' | ForEach-Object { $_.Line }
        Write-Output '::endgroup::'
    }
}
Write-Output "variant=$Variant pass=$pass fail=$fail"
