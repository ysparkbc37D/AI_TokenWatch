# Builds TokenDashboard.exe (+ icon.png / icon.ico) next to this script.
# The exe only runs launch.ps1 without a console window, so rebuilding is
# needed only when this file changes, not when the dashboard changes.
# ASCII-only on purpose (PowerShell 5.1 reads a no-BOM script as ANSI).
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
Add-Type -AssemblyName System.Drawing

# ---- icon: a gauge ring on a dark rounded square ----
function New-IconPng([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear([System.Drawing.Color]::Transparent)
    $r = [int]($size * 0.22)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $s = $size - 1
    $path.AddArc(0, 0, $r, $r, 180, 90); $path.AddArc($s - $r, 0, $r, $r, 270, 90)
    $path.AddArc($s - $r, $s - $r, $r, $r, 0, 90); $path.AddArc(0, $s - $r, $r, $r, 90, 90)
    $path.CloseFigure()
    $g.FillPath((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 23, 26, 33))), $path)
    $w = [single]($size * 0.13)
    $m = [single]($size * 0.2)
    $rect = New-Object System.Drawing.RectangleF($m, $m, ($size - 2 * $m), ($size - 2 * $m))
    $track = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 48, 53, 66), $w)
    $bar = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 91, 141, 255), $w)
    $bar.StartCap = 'Round'; $bar.EndCap = 'Round'
    $g.DrawEllipse($track, $rect)
    $g.DrawArc($bar, $rect, -90, 250)
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    return ,$ms.ToArray()
}

$png256 = New-IconPng 256
[System.IO.File]::WriteAllBytes((Join-Path $dir 'icon.png'), (New-IconPng 64))

# ICO with a single PNG-compressed 256x256 image (supported since Windows Vista)
$ico = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ico)
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]1)
$bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0)
$bw.Write([UInt16]1); $bw.Write([UInt16]32)
$bw.Write([UInt32]$png256.Length); $bw.Write([UInt32]22)
$bw.Write($png256)
$bw.Flush()
$icoPath = Join-Path $env:TEMP 'TokenDashboard.ico'
[System.IO.File]::WriteAllBytes($icoPath, $ico.ToArray())
Copy-Item $icoPath (Join-Path $dir 'icon.ico') -Force

# ---- exe: starts launch.ps1 hidden, passing through any arguments ----
$source = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows.Forms;

static class TokenDashboard {
    [STAThread]
    static void Main(string[] args) {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string script = Path.Combine(dir, "launch.ps1");
        if (!File.Exists(script)) {
            MessageBox.Show("launch.ps1 not found next to the exe:\n" + script, "Token Dashboard",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        string extra = string.Join(" ", args.Select(a => "\"" + a.Replace("\"", "") + "\""));
        var psi = new ProcessStartInfo("powershell.exe",
            "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + script + "\" " + extra);
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.WorkingDirectory = dir;
        Process.Start(psi);
    }
}
'@

$tmpExe = Join-Path $env:TEMP 'TokenDashboard.exe'
if (Test-Path $tmpExe) { Remove-Item $tmpExe -Force }
$cp = New-Object System.CodeDom.Compiler.CompilerParameters
$cp.GenerateExecutable = $true
$cp.OutputAssembly = $tmpExe
$cp.CompilerOptions = "/target:winexe /win32icon:`"$icoPath`" /optimize"
[void]$cp.ReferencedAssemblies.Add('System.dll')
[void]$cp.ReferencedAssemblies.Add('System.Core.dll')
[void]$cp.ReferencedAssemblies.Add('System.Windows.Forms.dll')
Add-Type -TypeDefinition $source -Language CSharp -CompilerParameters $cp

$target = Join-Path $dir 'TokenDashboard.exe'
Copy-Item $tmpExe $target -Force
Write-Host "built: $target"
