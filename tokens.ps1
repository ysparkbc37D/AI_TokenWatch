# Token usage report from local AI tool logs (dot-sourced by serve.ps1).
# ASCII-only on purpose (PowerShell 5.1 reads a no-BOM script as ANSI).
#
# Sources (numbers only - conversation text is never kept or sent anywhere):
#   Claude Code : %USERPROFILE%\.claude\projects\**\*.jsonl   one "usage" block per reply
#   Codex       : %USERPROFILE%\.codex\sessions\**\*.jsonl     running "total_token_usage" per session
#
# Categories (all raw token counts):
#   in  = new input   cw = cache write   cr = cache read   out = output
# Weighted ("input-equivalent") = in + 1.25*cw + 0.1*cr + 5*out  (approximate price ratios)
#
# Each file is parsed once and cached by (length, last write time) in
# quota_tokens_cache.json, so only files that changed are read again.

$tokDays      = 100                 # look back this many days
$tokMemoMs    = 120000              # rebuild the report at most every 2 minutes
$tokCacheFile = Join-Path $DataDir "quota_tokens_cache.json"
$script:tokFiles   = $null          # path -> @{ len; mtime; rows = @{key=double[5]}; hours = @{key=double} }
$script:tokMemo    = $null
$script:tokMemoAt  = 0

$rxUsageIn  = New-Object regex '"input_tokens":(\d+)', 'Compiled'
$rxUsageCw  = New-Object regex '"cache_creation_input_tokens":(\d+)', 'Compiled'
$rxUsageCr  = New-Object regex '"cache_read_input_tokens":(\d+)', 'Compiled'
$rxUsageOut = New-Object regex '"output_tokens":(\d+)', 'Compiled'
$rxMsgId    = New-Object regex '"id":"(msg_[A-Za-z0-9]+)"', 'Compiled'
$rxModel    = New-Object regex '"model":"([^"]+)"', 'Compiled'
$rxTs       = New-Object regex '"timestamp":"([^"]+)"', 'Compiled'
$rxCwd      = New-Object regex '"cwd":"((?:[^"\\]|\\.)*)"', 'Compiled'
$rxTotObj   = New-Object regex '"total_token_usage":\{([^}]*)\}', 'Compiled'
$rxCxCached = New-Object regex '"cached_input_tokens":(\d+)', 'Compiled'
$rxCxWrite  = New-Object regex '"cache_write_input_tokens":(\d+)', 'Compiled'
$rxRateWin  = New-Object regex '"(primary|secondary)":\{"used_percent":([\d.]+),"window_minutes":(\d+),"resets_at":(\d+)', 'Compiled'
$script:codexLimits = $null         # latest Codex rate limits seen in any log

# Codex keeps its current log open for writing: open with full sharing so reading never fails
function Open-SharedReader([string]$path) {
    $fs = New-Object System.IO.FileStream($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read,
        ([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete))
    return New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)
}

function Get-ProjectName([string]$cwd) {
    if (-not $cwd) { return "(unknown)" }
    $p = $cwd -replace '\\\\', '\' -replace '/', '\'
    $p = $p.TrimEnd('\')
    $leaf = $p.Substring($p.LastIndexOf('\') + 1)
    if (-not $leaf) { return $p }
    return $leaf
}

function Add-TokRow($rows, [string]$key, [double]$in, [double]$cw, [double]$cr, [double]$out) {
    if (-not $rows.ContainsKey($key)) { $rows[$key] = New-Object 'double[]' 5 }
    $a = $rows[$key]
    $a[0] += $in; $a[1] += $cw; $a[2] += $cr; $a[3] += $out; $a[4] += 1
}

function Add-TokHour($hours, [string]$key, [double]$w) {
    if ($hours.ContainsKey($key)) { $hours[$key] += $w } else { $hours[$key] = $w }
}

function Get-Weighted([double]$in, [double]$cw, [double]$cr, [double]$out) {
    return $in + 1.25 * $cw + 0.1 * $cr + 5 * $out
}

function Read-ClaudeLog([string]$path) {
    # Streaming writes the same reply several times; keep the last copy per message id
    $byId = @{}
    $project = $null
    $reader = Open-SharedReader $path
    try {
    while ($null -ne ($line = $reader.ReadLine())) {
        if (-not $project -and $line.Contains('"cwd":"')) {
            $m = $rxCwd.Match($line); if ($m.Success) { $project = Get-ProjectName $m.Groups[1].Value }
        }
        if (-not $line.Contains('"usage":{') -or -not $line.Contains('"type":"assistant"')) { continue }
        $model = $rxModel.Match($line).Groups[1].Value
        if (-not $model -or $model -eq '<synthetic>') { continue }
        $u = $line.LastIndexOf('"usage":{')
        $seg = $line.Substring($u, [Math]::Min(800, $line.Length - $u))
        $mi = $rxUsageIn.Match($seg)
        if (-not $mi.Success) { continue }
        $tsAll = $rxTs.Matches($line)
        if ($tsAll.Count -eq 0) { continue }
        $id = $rxMsgId.Match($line).Groups[1].Value
        if (-not $id) { $id = "line" + $byId.Count }
        $byId[$id] = @(
            $tsAll[$tsAll.Count - 1].Groups[1].Value, $model,
            [double]$mi.Groups[1].Value,
            [double]$rxUsageCw.Match($seg).Groups[1].Value,
            [double]$rxUsageCr.Match($seg).Groups[1].Value,
            [double]$rxUsageOut.Match($seg).Groups[1].Value)
    }
    } finally { $reader.Close() }
    $rows = @{}; $hours = @{}
    if (-not $project) { $project = "(unknown)" }
    foreach ($r in $byId.Values) {
        try { $local = [DateTimeOffset]::Parse($r[0], [Globalization.CultureInfo]::InvariantCulture).LocalDateTime } catch { continue }
        $day = $local.ToString('yyyy-MM-dd')
        Add-TokRow $rows "$day|claude|$($r[1])|$project" $r[2] $r[3] $r[4] $r[5]
        Add-TokHour $hours "$day|$($local.Hour)|claude" (Get-Weighted $r[2] $r[3] $r[4] $r[5])
    }
    return @{ rows = $rows; hours = $hours }
}

function Read-CodexLog([string]$path) {
    $rows = @{}; $hours = @{}
    $model = "codex"; $project = "(unknown)"
    $prev = $null
    $limits = $null
    $reader = Open-SharedReader $path
    try {
    while ($null -ne ($line = $reader.ReadLine())) {
        if ($line.Contains('"type":"session_meta"') -or $line.Contains('"type":"turn_context"')) {
            $m = $rxCwd.Match($line); if ($m.Success) { $project = Get-ProjectName $m.Groups[1].Value }
            $mm = $rxModel.Match($line); if ($mm.Success) { $model = $mm.Groups[1].Value }
            continue
        }
        if (-not $line.Contains('"total_token_usage"')) { continue }
        $t = $rxTotObj.Match($line)
        if (-not $t.Success) { continue }
        $o = $t.Groups[1].Value
        # [input (includes cached + cache write), cached, cache write, output]
        $cur = @([double]$rxUsageIn.Match($o).Groups[1].Value, [double]$rxCxCached.Match($o).Groups[1].Value,
                 [double]$rxCxWrite.Match($o).Groups[1].Value, [double]$rxUsageOut.Match($o).Groups[1].Value)
        if ($prev -and $cur[0] -ge $prev[0] -and $cur[3] -ge $prev[3]) {
            $d = @(($cur[0] - $prev[0]), ($cur[1] - $prev[1]), ($cur[2] - $prev[2]), ($cur[3] - $prev[3]))
        } else {
            $d = $cur     # first event, or the session's counter restarted
        }
        $prev = $cur
        $ts = $rxTs.Match($line)
        if (-not $ts.Success) { continue }
        try { $stamp = [DateTimeOffset]::Parse($ts.Groups[1].Value, [Globalization.CultureInfo]::InvariantCulture) } catch { continue }

        $rl = $rxRateWin.Matches($line)
        if ($rl.Count) {
            $lim = @{ at = $stamp.ToUnixTimeMilliseconds() }
            foreach ($w in $rl) { $lim[$w.Groups[1].Value] = @{ used = [double]$w.Groups[2].Value; windowMin = [int]$w.Groups[3].Value; resetsAt = [long]$w.Groups[4].Value * 1000 } }
            $limits = $lim
        }

        if ($d[0] -le 0 -and $d[3] -le 0) { continue }   # repeated event, nothing new
        $local = $stamp.LocalDateTime
        $day = $local.ToString('yyyy-MM-dd')
        $cr = [Math]::Max(0, $d[1]); $cw = [Math]::Max(0, $d[2])
        $newIn = [Math]::Max(0, $d[0] - $cr - $cw)
        Add-TokRow $rows "$day|codex|$model|$project" $newIn $cw $cr $d[3]
        Add-TokHour $hours "$day|$($local.Hour)|codex" (Get-Weighted $newIn $cw $cr $d[3])
    }
    } finally { $reader.Close() }
    return @{ rows = $rows; hours = $hours; limits = $limits }
}

function Read-TokCache {
    $files = @{}
    if (-not (Test-Path $tokCacheFile)) { return $files }
    try {
        $j = [System.IO.File]::ReadAllText($tokCacheFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
        foreach ($p in $j.PSObject.Properties) {
            $rows = @{}; $hours = @{}
            foreach ($s in @($p.Value.rows)) {
                $f = $s.Split('|'); if ($f.Length -ne 9) { continue }
                $rows["$($f[0])|$($f[1])|$($f[2])|$($f[3])"] = [double[]]@([double]$f[4], [double]$f[5], [double]$f[6], [double]$f[7], [double]$f[8])
            }
            foreach ($s in @($p.Value.hours)) {
                $f = $s.Split('|'); if ($f.Length -ne 4) { continue }
                $hours["$($f[0])|$($f[1])|$($f[2])"] = [double]$f[3]
            }
            $lim = $null
            if ($p.Value.limits) {
                $lim = @{ at = [long]$p.Value.limits.at }
                foreach ($w in 'primary', 'secondary') {
                    $x = $p.Value.limits.$w
                    if ($x) { $lim[$w] = @{ used = [double]$x.used; windowMin = [int]$x.windowMin; resetsAt = [long]$x.resetsAt } }
                }
            }
            $files[$p.Name] = @{ len = [long]$p.Value.len; mtime = [long]$p.Value.mtime; rows = $rows; hours = $hours; limits = $lim }
        }
    } catch {}
    return $files
}

function Save-TokCache {
    $out = [ordered]@{}
    foreach ($path in $script:tokFiles.Keys) {
        $e = $script:tokFiles[$path]
        $out[$path] = [ordered]@{
            len   = $e.len
            mtime = $e.mtime
            rows  = @($e.rows.GetEnumerator() | ForEach-Object { $_.Key + '|' + (($_.Value | ForEach-Object { $_.ToString([Globalization.CultureInfo]::InvariantCulture) }) -join '|') })
            hours = @($e.hours.GetEnumerator() | ForEach-Object { $_.Key + '|' + $_.Value.ToString([Globalization.CultureInfo]::InvariantCulture) })
            limits = $e.limits
        }
    }
    try { [System.IO.File]::WriteAllText($tokCacheFile, ($out | ConvertTo-Json -Depth 4 -Compress), $utf8NoBom) } catch {}
}

function Get-TokenReportJson {
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    if ($script:tokMemo -and ($now - $script:tokMemoAt) -lt $tokMemoMs) { return $script:tokMemo }
    if ($null -eq $script:tokFiles) { $script:tokFiles = Read-TokCache }

    $since = (Get-Date).AddDays(-$tokDays)
    $sources = @(
        @{ name = 'claude'; dir = (Join-Path $env:USERPROFILE '.claude\projects') },
        @{ name = 'codex';  dir = (Join-Path $env:USERPROFILE '.codex\sessions') }
    )
    $seen = @{}
    $changed = $false
    $srcInfo = [ordered]@{}
    foreach ($src in $sources) {
        $count = 0
        if (Test-Path $src.dir) {
            foreach ($f in (Get-ChildItem $src.dir -Recurse -Filter *.jsonl -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -ge $since })) {
                $count++
                $seen[$f.FullName] = $true
                $e = $script:tokFiles[$f.FullName]
                $mt = $f.LastWriteTimeUtc.Ticks
                if ($e -and $e.len -eq $f.Length -and $e.mtime -eq $mt) { continue }
                try {
                    $parsed = if ($src.name -eq 'claude') { Read-ClaudeLog $f.FullName } else { Read-CodexLog $f.FullName }
                    $script:tokFiles[$f.FullName] = @{ len = $f.Length; mtime = $mt; rows = $parsed.rows; hours = $parsed.hours; limits = $parsed.limits }
                    $changed = $true
                } catch {
                    Write-Host ("tokens: skip " + $f.Name + ": " + $_.Exception.Message) -ForegroundColor DarkYellow
                }
            }
        }
        $srcInfo[$src.name] = @{ files = $count; found = (Test-Path $src.dir) }
    }
    foreach ($k in @($script:tokFiles.Keys)) { if (-not $seen.ContainsKey($k)) { $script:tokFiles.Remove($k); $changed = $true } }
    if ($changed) { Save-TokCache }

    # Merge every file's rows
    $sinceDay = $since.ToString('yyyy-MM-dd')
    $rows = @{}; $hours = @{}
    $codexLimits = $null
    foreach ($e in $script:tokFiles.Values) {
        if ($e.limits -and (-not $codexLimits -or $e.limits.at -gt $codexLimits.at)) { $codexLimits = $e.limits }
        foreach ($kv in $e.rows.GetEnumerator()) {
            if ($kv.Key.Substring(0, 10) -lt $sinceDay) { continue }
            if (-not $rows.ContainsKey($kv.Key)) { $rows[$kv.Key] = New-Object 'double[]' 5 }
            $a = $rows[$kv.Key]; for ($i = 0; $i -lt 5; $i++) { $a[$i] += $kv.Value[$i] }
        }
        foreach ($kv in $e.hours.GetEnumerator()) {
            if ($kv.Key.Substring(0, 10) -lt $sinceDay) { continue }
            Add-TokHour $hours $kv.Key $kv.Value
        }
    }

    $inv = [Globalization.CultureInfo]::InvariantCulture
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('{"generatedAt":').Append($now).Append(',"days":').Append($tokDays)
    [void]$sb.Append(',"weights":{"in":1,"cw":1.25,"cr":0.1,"out":5}')
    [void]$sb.Append(',"sources":').Append(($srcInfo | ConvertTo-Json -Compress -Depth 3))
    $script:codexLimits = $codexLimits
    $limJson = if ($codexLimits) { $codexLimits | ConvertTo-Json -Compress -Depth 3 } else { 'null' }
    [void]$sb.Append(',"codexLimits":').Append($limJson)
    [void]$sb.Append(',"daily":[')
    $first = $true
    foreach ($kv in $rows.GetEnumerator()) {
        $k = $kv.Key.Split('|'); $v = $kv.Value
        if (-not $first) { [void]$sb.Append(',') }; $first = $false
        [void]$sb.Append('{"d":"').Append($k[0]).Append('","src":"').Append($k[1])
        [void]$sb.Append('","model":').Append(($k[2] | ConvertTo-Json -Compress)).Append(',"project":').Append(($k[3] | ConvertTo-Json -Compress))
        [void]$sb.Append(',"in":').Append($v[0].ToString($inv)).Append(',"cw":').Append($v[1].ToString($inv))
        [void]$sb.Append(',"cr":').Append($v[2].ToString($inv)).Append(',"out":').Append($v[3].ToString($inv))
        [void]$sb.Append(',"n":').Append($v[4].ToString($inv)).Append('}')
    }
    [void]$sb.Append('],"hourly":[')
    $first = $true
    foreach ($kv in $hours.GetEnumerator()) {
        $k = $kv.Key.Split('|')
        if (-not $first) { [void]$sb.Append(',') }; $first = $false
        [void]$sb.Append('{"d":"').Append($k[0]).Append('","h":').Append($k[1]).Append(',"src":"').Append($k[2])
        [void]$sb.Append('","w":').Append(([Math]::Round($kv.Value)).ToString($inv)).Append('}')
    }
    [void]$sb.Append(']}')

    $script:tokMemo = $sb.ToString()
    $script:tokMemoAt = $now
    return $script:tokMemo
}
