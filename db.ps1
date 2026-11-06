# LLM Quota Hub - Long-term SQLite Vault & Monthly/Yearly Aggregator
# Dot-sourced by serve.ps1. ASCII-only for PowerShell 5.1 compatibility.

$dbScript = @"
using System;
using System.Runtime.InteropServices;

public class WinSqliteBridge {
    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_open", CallingConvention = CallingConvention.Cdecl)]
    public static extern int Open([MarshalAs(UnmanagedType.LPStr)] string filename, out IntPtr db);

    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_close", CallingConvention = CallingConvention.Cdecl)]
    public static extern int Close(IntPtr db);

    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_exec", CallingConvention = CallingConvention.Cdecl)]
    public static extern int Exec(IntPtr db, [MarshalAs(UnmanagedType.LPStr)] string sql, IntPtr callback, IntPtr arg, out IntPtr errMsg);

    [DllImport("winsqlite3.dll", EntryPoint = "sqlite3_free", CallingConvention = CallingConvention.Cdecl)]
    public static extern void Free(IntPtr ptr);
}
"@

if (-not ([System.Management.Automation.PSTypeName]'WinSqliteBridge').Type) {
    try { Add-Type -TypeDefinition $dbScript } catch {}
}

if (-not $DataDir) { $DataDir = if ($PSScriptRoot) { $PSScriptRoot } else { "." } }
$vaultDir   = Join-Path $DataDir "data"
if (-not (Test-Path $vaultDir)) { New-Item -ItemType Directory -Path $vaultDir -Force | Out-Null }

$sqliteDbFile = Join-Path $vaultDir "tokens_vault.db"
$vaultJsonFile = Join-Path $vaultDir "vault_db.json"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Init-VaultDatabase {
    $dbPtr = [IntPtr]::Zero
    $rc = [WinSqliteBridge]::Open($sqliteDbFile, [ref]$dbPtr)
    if ($rc -ne 0) { return }
    $err = [IntPtr]::Zero
    $schema = @"
CREATE TABLE IF NOT EXISTS daily_tokens (
    date TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    project TEXT NOT NULL,
    in_tokens REAL DEFAULT 0,
    cw_tokens REAL DEFAULT 0,
    cr_tokens REAL DEFAULT 0,
    out_tokens REAL DEFAULT 0,
    turns INT DEFAULT 0,
    weighted REAL DEFAULT 0,
    PRIMARY KEY (date, provider, model, project)
);
CREATE TABLE IF NOT EXISTS monthly_summary (
    year_month TEXT PRIMARY KEY,
    total_tokens REAL DEFAULT 0,
    turns INT DEFAULT 0,
    saved_tokens REAL DEFAULT 0,
    frugal_score REAL DEFAULT 0,
    updated_at TEXT
);
"@
    [void][WinSqliteBridge]::Exec($dbPtr, $schema, [IntPtr]::Zero, [IntPtr]::Zero, [ref]$err)
    [void][WinSqliteBridge]::Close($dbPtr)
}

function Escape-Sql([string]$s) {
    if ($null -eq $s) { return "''" }
    return "'" + ($s -replace "'", "''") + "'"
}

function Sync-TokenDatabase {
    try {
        Init-VaultDatabase
        $repJson = Get-TokenReportJson
        if (-not $repJson) { return }
        $rep = $repJson | ConvertFrom-Json
        if (-not $rep.daily) { return }

        $dbPtr = [IntPtr]::Zero
        $rc = [WinSqliteBridge]::Open($sqliteDbFile, [ref]$dbPtr)
        if ($rc -eq 0) {
            $err = [IntPtr]::Zero
            [void][WinSqliteBridge]::Exec($dbPtr, "BEGIN TRANSACTION;", [IntPtr]::Zero, [IntPtr]::Zero, [ref]$err)

            $inv = [Globalization.CultureInfo]::InvariantCulture
            foreach ($row in $rep.daily) {
                $d = [string]$row.d
                $src = [string]$row.src
                $model = [string]$row.model
                $proj = [string]$row.project
                $in = [double]$row.in
                $cw = [double]$row.cw
                $cr = [double]$row.cr
                $out = [double]$row.out
                $n = [int]$row.n
                $w = $in + 1.25 * $cw + 0.1 * $cr + 5.0 * $out

                $sql = "INSERT OR REPLACE INTO daily_tokens (date, provider, model, project, in_tokens, cw_tokens, cr_tokens, out_tokens, turns, weighted) " +
                       "VALUES (" + (Escape-Sql $d) + "," + (Escape-Sql $src) + "," + (Escape-Sql $model) + "," + (Escape-Sql $proj) + "," +
                       $in.ToString($inv) + "," + $cw.ToString($inv) + "," + $cr.ToString($inv) + "," + $out.ToString($inv) + "," +
                       $n.ToString($inv) + "," + $w.ToString($inv) + ");"
                [void][WinSqliteBridge]::Exec($dbPtr, $sql, [IntPtr]::Zero, [IntPtr]::Zero, [ref]$err)
            }
            [void][WinSqliteBridge]::Exec($dbPtr, "COMMIT;", [IntPtr]::Zero, [IntPtr]::Zero, [ref]$err)
            [void][WinSqliteBridge]::Close($dbPtr)
        }

        # Build portable monthly/yearly JSON archive
        $months = [ordered]@{}
        $years = [ordered]@{}
        foreach ($row in $rep.daily) {
            $d = [string]$row.d
            if ($d.Length -lt 7) { continue }
            $ym = $d.Substring(0, 7)
            $yr = $d.Substring(0, 4)
            $w = [double]$row.in + 1.25 * [double]$row.cw + 0.1 * [double]$row.cr + 5.0 * [double]$row.out

            if (-not $months.Contains($ym)) {
                $months[$ym] = [ordered]@{
                    month = $ym
                    total = 0.0
                    in = 0.0; cw = 0.0; cr = 0.0; out = 0.0; turns = 0
                    byProvider = [ordered]@{}
                    byModel = [ordered]@{}
                }
            }
            $mObj = $months[$ym]
            $mObj.total += $w
            $mObj.in    += [double]$row.in
            $mObj.cw    += [double]$row.cw
            $mObj.cr    += [double]$row.cr
            $mObj.out   += [double]$row.out
            $mObj.turns += [int]$row.n

            $prov = [string]$row.src
            if (-not $mObj.byProvider.Contains($prov)) { $mObj.byProvider[$prov] = 0.0 }
            $mObj.byProvider[$prov] += $w

            $mod = [string]$row.model
            if (-not $mObj.byModel.Contains($mod)) { $mObj.byModel[$mod] = 0.0 }
            $mObj.byModel[$mod] += $w

            if (-not $years.Contains($yr)) {
                $years[$yr] = [ordered]@{ year = $yr; total = 0.0; turns = 0; months = @() }
            }
            $years[$yr].total += $w
            $years[$yr].turns += [int]$row.n
        }

        foreach ($yr in @($years.Keys)) {
            $mList = @()
            foreach ($ym in @($months.Keys)) {
                if ($ym.StartsWith($yr)) { $mList += $months[$ym] }
            }
            $years[$yr].months = $mList
        }

        $vaultData = [ordered]@{
            updatedAt = (Get-Date).ToString("o")
            months = $months
            years  = $years
            totalRows = $rep.daily.Count
            engine = "SQLite + Portable JSON Vault"
        }

        [System.IO.File]::WriteAllText($vaultJsonFile, ($vaultData | ConvertTo-Json -Depth 6), $utf8NoBom)
    } catch {
        Write-Host ("db: " + $_.Exception.Message) -ForegroundColor DarkYellow
    }
}

# Export snapshots for serverless GitHub Pages / mobile view
function Export-StaticSnapshots {
    try {
        $stateFile = Join-Path $DataDir "quota_state.json"
        if (Test-Path $stateFile) {
            Copy-Item $stateFile (Join-Path $vaultDir "quota.json") -Force
        }
        $histFile = Join-Path $DataDir "quota_history.jsonl"
        if (Test-Path $histFile) {
            $lines = @([System.IO.File]::ReadAllLines($histFile) | Where-Object { $_ -match '^\{.*\}$' })
            [System.IO.File]::WriteAllText((Join-Path $vaultDir "history.json"), ("[" + ($lines -join ",") + "]"), $utf8NoBom)
        }
        $agHistFile = Join-Path $DataDir "quota_ag_history.jsonl"
        if (Test-Path $agHistFile) {
            $lines = @([System.IO.File]::ReadAllLines($agHistFile) | Where-Object { $_ -match '^\{.*\}$' })
            [System.IO.File]::WriteAllText((Join-Path $vaultDir "history-ag.json"), ("[" + ($lines -join ",") + "]"), $utf8NoBom)
        }
        $tokRep = Get-TokenReportJson
        if ($tokRep) {
            [System.IO.File]::WriteAllText((Join-Path $vaultDir "tokens.json"), $tokRep, $utf8NoBom)
        }
        Sync-TokenDatabase
    } catch {
        Write-Host ("export-snapshots: " + $_.Exception.Message) -ForegroundColor DarkYellow
    }
}
