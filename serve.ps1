# LLM Quota Hub - local HTTP server + live sync API
# ASCII-only on purpose: PowerShell 5.1 reads a no-BOM script as ANSI.
#   GET  /api/quota    current values
#   POST /api/quota    update values (Chrome extension, bookmarklet, manual form)
#   GET  /api/history     Claude usage samples for the chart (JSON array)
#   GET  /api/history-ag  Antigravity samples: [{t, m:{model group: % left}}]
#   GET  /api/tokens      daily token totals from local Claude Code / Codex logs (tokens.ps1)
param(
    [int]$Port = 8089,
    [string]$DataDir = ""
)

$baseDir  = $PSScriptRoot
if (-not $DataDir) { $DataDir = $baseDir }
$dataFile = Join-Path $DataDir "quota_state.json"
$histFile = Join-Path $DataDir "quota_history.jsonl"
$agHistFile = Join-Path $DataDir "quota_ag_history.jsonl"
$cxHistFile = Join-Path $DataDir "quota_cx_history.jsonl"
. (Join-Path $baseDir "tokens.ps1")
$listener = New-Object System.Net.HttpListener
$prefix   = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)

$histMax       = 20000      # lines kept (about 2 weeks at one sample per minute)
$histKeepAlive = 600000     # write an unchanged sample at most every 10 minutes
$script:lastSample = $null
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$newline = [Environment]::NewLine

function Set-Field($obj, [string]$name, $value) {
    $obj | Add-Member -MemberType NoteProperty -Name $name -Value $value -Force
}

function Read-State {
    if (Test-Path $dataFile) {
        try { return ([System.IO.File]::ReadAllText($dataFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json) } catch {}
    }
    return [pscustomobject]@{}
}

function Send-Json($response, [string]$json, [int]$status = 200) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $response.StatusCode = $status
    $response.ContentType = "application/json; charset=utf-8"
    $response.ContentLength64 = $bytes.Length
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Format-Num($v) {
    if ($null -eq $v) { return "null" }
    return ([double]$v).ToString([Globalization.CultureInfo]::InvariantCulture)
}

function Add-HistorySample($claude) {
    $f = $claude.fiveHourPct
    $w = $claude.weeklyPct
    if ($null -eq $f -and $null -eq $w) { return }
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $last = $script:lastSample
    if ($last -and $last.f -eq $f -and $last.w -eq $w -and ($now - $last.t) -lt $histKeepAlive) { return }
    $line = '{"t":' + $now + ',"f":' + (Format-Num $f) + ',"w":' + (Format-Num $w) + '}'
    [System.IO.File]::AppendAllText($histFile, $line + $newline, $utf8NoBom)
    $script:lastSample = @{ t = $now; f = $f; w = $w }
    Limit-HistoryFile $histFile
}

# Trim now and then so a history file never grows without bound
function Limit-HistoryFile([string]$file) {
    if ((Get-Random -Maximum 200) -ne 0) { return }
    $lines = [System.IO.File]::ReadAllLines($file)
    if ($lines.Length -gt $histMax) {
        [System.IO.File]::WriteAllLines($file, $lines[($lines.Length - $histMax)..($lines.Length - 1)], $utf8NoBom)
    }
}

$script:lastAgSample = $null
function Add-AgHistorySample($models) {
    $parts = @()
    foreach ($m in $models) {
        $name = ([string]@($m.names)[0]) -replace '["\\]', ''
        $parts += ('"' + $name + '":' + (Format-Num $m.left))
    }
    if (-not $parts.Count) { return }
    $body = '{' + ($parts -join ',') + '}'
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $last = $script:lastAgSample
    if ($last -and $last.body -eq $body -and ($now - $last.t) -lt $histKeepAlive) { return }
    [System.IO.File]::AppendAllText($agHistFile, ('{"t":' + $now + ',"m":' + $body + '}') + $newline, $utf8NoBom)
    $script:lastAgSample = @{ t = $now; body = $body }
    Limit-HistoryFile $agHistFile
}

# ChatGPT plan limits as seen by Codex: {t, p: primary % used, s: secondary % used}
$script:lastCxSample = $null
$script:tokNext = 0
function Update-CodexHistory {
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    if ($now -lt $script:tokNext) { return }
    $script:tokNext = $now + 120000
    $null = Get-TokenReportJson
    $l = $script:codexLimits
    if (-not $l) { return }
    $p = if ($l.primary) { $l.primary.used } else { $null }
    $s = if ($l.secondary) { $l.secondary.used } else { $null }
    $body = '"p":' + (Format-Num $p) + ',"s":' + (Format-Num $s)
    $last = $script:lastCxSample
    if ($last -and $last.body -eq $body -and ($now - $last.t) -lt $histKeepAlive) { return }
    [System.IO.File]::AppendAllText($cxHistFile, ('{"t":' + $now + ',' + $body + '}') + $newline, $utf8NoBom)
    $script:lastCxSample = @{ t = $now; body = $body }
    Limit-HistoryFile $cxHistFile
}

# Periodic jobs; each one decides itself whether it is due
function Invoke-Background {
    try { Update-Antigravity } catch { Write-Host ("antigravity: " + $_.Exception.Message) -ForegroundColor DarkYellow }
    try { Update-CodexHistory } catch { Write-Host ("codex: " + $_.Exception.Message) -ForegroundColor DarkYellow }
}

function Get-HistoryJson([string]$file) {
    $lines = @()
    if (Test-Path $file) { $lines = @([System.IO.File]::ReadAllLines($file) | Where-Object { $_ -match '^\{.*\}$' }) }
    return "[" + ($lines -join ",") + "]"
}

# ---- Antigravity (Gemini / Claude / GPT quota inside the Antigravity IDE) ----
# Antigravity runs a local language_server.exe that knows the per-model quota.
# Its port is random and it requires the CSRF token from its own command line,
# so both are looked up from the running process. The token is only held in
# memory for the request; it is never written to disk or logged.
# Polled once a minute in the background (and on demand), so its history keeps
# filling even while the dashboard is closed.
$agInterval = 60000
$script:agNext = 0
$script:agConn = $null   # @{ url = ...; token = ... } cached while it keeps working

function Find-AntigravityConn {
    $procs = @(Get-CimInstance Win32_Process -Filter "Name='language_server.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'antigravity' })
    foreach ($p in $procs) {
        $m = [regex]::Match("$($p.CommandLine)", '--csrf_token[= ]([^\s"]+)')
        if (-not $m.Success) { continue }
        $ports = @(Get-NetTCPConnection -OwningProcess $p.ProcessId -State Listen -ErrorAction SilentlyContinue |
            ForEach-Object { $_.LocalPort } | Sort-Object -Unique)
        foreach ($port in $ports) {
            $conn = @{ url = "http://127.0.0.1:$port/exa.language_server_pb.LanguageServerService/GetUserStatus"; token = $m.Groups[1].Value }
            if (Invoke-AntigravityStatus $conn) { return $conn }
        }
    }
    return $null
}

function Invoke-AntigravityStatus($conn) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $conn.url -TimeoutSec 2 `
            -Headers @{ 'X-Codeium-Csrf-Token' = $conn.token; 'Connect-Protocol-Version' = '1' } `
            -ContentType 'application/json' -Body '{"metadata":{"ideName":"antigravity","extensionName":"antigravity","locale":"en"}}'
        $j = [System.Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()) | ConvertFrom-Json
        if ($j.userStatus.cascadeModelConfigData) { return $j }
    } catch {}
    return $null
}

function Update-Antigravity {
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    if ($now -lt $script:agNext) { return }
    $script:agNext = $now + $agInterval

    $status = $null
    if ($script:agConn) { $status = Invoke-AntigravityStatus $script:agConn }
    if (-not $status) {
        $script:agConn = Find-AntigravityConn
        if ($script:agConn) { $status = Invoke-AntigravityStatus $script:agConn }
    }

    $state = Read-State
    if (-not $status) {
        # Antigravity closed: keep the last values, just flag it
        if ($state.antigravity) {
            Set-Field $state.antigravity "running" $false
            [System.IO.File]::WriteAllText($dataFile, ($state | ConvertTo-Json -Depth 6), $utf8NoBom)
        }
        return
    }

    # Models sharing one quota report the same (fraction, reset) pair: group them
    $groups = [ordered]@{}
    foreach ($cfg in @($status.userStatus.cascadeModelConfigData.clientModelConfigs)) {
        $q = $cfg.quotaInfo
        if ($null -eq $q) { continue }
        $frac = if ($null -eq $q.remainingFraction) { 0 } else { [double]$q.remainingFraction }
        $reset = $null
        if ($q.resetTime) { try { $reset = ([DateTimeOffset]::Parse($q.resetTime)).ToUnixTimeMilliseconds() } catch {} }
        $key = "$frac|$reset"
        $base = ([string]$cfg.label -replace '\s*\([^)]*\)\s*$', '').Trim()
        if (-not $groups.Contains($key)) { $groups[$key] = @{ names = New-Object System.Collections.ArrayList; left = [Math]::Round($frac * 100, 1); reset = $reset } }
        if (-not $groups[$key].names.Contains($base)) { [void]$groups[$key].names.Add($base) }
    }
    $models = @($groups.Values | Sort-Object { $_.left } | ForEach-Object {
        [pscustomobject]@{ names = @($_.names); left = $_.left; resetTime = $_.reset }
    })
    Set-Field $state "antigravity" ([pscustomobject]@{
        running     = $true
        plan        = [string]$status.userStatus.userTier.name
        models      = $models
        lastUpdated = (Get-Date).ToString("o")
    })
    [System.IO.File]::WriteAllText($dataFile, ($state | ConvertTo-Json -Depth 6), $utf8NoBom)
    Add-AgHistorySample $models
}

# Numeric fields accepted per provider (anything else in the payload is ignored)
$allowed = @{
    claude = @("fiveHourPct", "weeklyPct", "fiveHourResetTime", "weeklyResetTime")
    gemini = @("fiveHourLeft", "weeklyLeft", "claudeGptWeeklyLeft", "argonWeeklyLeft")
}

$mimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".htm"  = "text/html; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
}

try {
    $listener.Start()
    Write-Host "========================================================" -ForegroundColor Cyan
    Write-Host " AI quota dashboard server is running" -ForegroundColor Green
    Write-Host " Dashboard : $prefix" -ForegroundColor Yellow
    Write-Host " Sync API  : ${prefix}api/quota" -ForegroundColor White
    Write-Host " Press Ctrl + C to stop." -ForegroundColor DarkCyan
    Write-Host "========================================================" -ForegroundColor Cyan

    while ($listener.IsListening) {
        # Wait for a request, doing background work (Antigravity poll) every 5 s meanwhile
        $pending = $listener.BeginGetContext($null, $null)
        while (-not $pending.AsyncWaitHandle.WaitOne(5000)) { Invoke-Background }
        $context  = $listener.EndGetContext($pending)
        $request  = $context.Request
        $response = $context.Response

        try {
            # CORS allow-list: the dashboard itself, a file:// page (Origin "null"),
            # claude.ai (bookmarklet) and the Chrome extension. Any other website
            # must not be able to read usage or post fake numbers.
            $origin = $request.Headers["Origin"]
            $originOk = (-not $origin) -or ($origin -eq "null") -or ($origin -eq "https://claude.ai") -or
                        ($origin -like "chrome-extension://*") -or ($origin -match '^http://(localhost|127\.0\.0\.1)(:\d+)?$')
            if ($origin -and $originOk) {
                $response.AddHeader("Access-Control-Allow-Origin", $origin)
                $response.AddHeader("Vary", "Origin")
                $response.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                $response.AddHeader("Access-Control-Allow-Headers", "Content-Type")
                $response.AddHeader("Access-Control-Allow-Private-Network", "true")
            }
            $response.AddHeader("Cache-Control", "no-store")

            $urlPath = $request.Url.LocalPath

            if ($urlPath.StartsWith("/api/") -and -not $originOk) {
                Send-Json $response '{"status":"error","message":"origin not allowed"}' 403
            }
            elseif ($request.HttpMethod -eq "OPTIONS") {
                $response.StatusCode = 204
            }
            elseif ($urlPath -eq "/api/quota" -and $request.HttpMethod -eq "GET") {
                try { Update-Antigravity } catch { Write-Host ("antigravity: " + $_.Exception.Message) -ForegroundColor DarkYellow }
                Send-Json $response ((Read-State) | ConvertTo-Json -Depth 6 -Compress)
            }
            elseif ($urlPath -eq "/api/history" -and $request.HttpMethod -eq "GET") {
                Send-Json $response (Get-HistoryJson $histFile)
            }
            elseif ($urlPath -eq "/api/history-ag" -and $request.HttpMethod -eq "GET") {
                Send-Json $response (Get-HistoryJson $agHistFile)
            }
            elseif ($urlPath -eq "/api/history-cx" -and $request.HttpMethod -eq "GET") {
                Send-Json $response (Get-HistoryJson $cxHistFile)
            }
            elseif ($urlPath -eq "/api/tokens" -and $request.HttpMethod -eq "GET") {
                Send-Json $response (Get-TokenReportJson)
            }
            elseif ($urlPath -eq "/api/quota" -and $request.HttpMethod -eq "POST") {
                $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
                $body = $reader.ReadToEnd()
                $reader.Close()
                try {
                    $payload = $body | ConvertFrom-Json
                    $current = Read-State
                    $nowIso  = (Get-Date).ToString("o")

                    foreach ($provider in $allowed.Keys) {
                        $incoming = $payload.$provider
                        if ($null -eq $incoming) { continue }
                        if ($null -eq $current.$provider) { Set-Field $current $provider ([pscustomobject]@{}) }
                        foreach ($field in $allowed[$provider]) {
                            $v = $incoming.$field
                            if ($null -ne $v) { Set-Field $current.$provider $field ([double]$v) }
                        }
                        if ($incoming.source) {
                            $src = [string]$incoming.source
                            Set-Field $current.$provider "source" $src.Substring(0, [Math]::Min(32, $src.Length))
                        }
                        Set-Field $current.$provider "lastUpdated" $nowIso
                    }

                    [System.IO.File]::WriteAllText($dataFile, ($current | ConvertTo-Json -Depth 6), $utf8NoBom)
                    if ($payload.claude) { Add-HistorySample $current.claude }
                    Send-Json $response '{"status":"ok","message":"synced"}'
                    Write-Host ("[{0}] sync from {1}" -f (Get-Date -Format "HH:mm:ss"), $request.RemoteEndPoint) -ForegroundColor DarkGray
                }
                catch {
                    $msg = ($_.Exception.Message -replace '"', "'")
                    Send-Json $response ('{"status":"error","message":"' + $msg + '"}') 400
                }
            }
            else {
                # Static files, confined to $baseDir; data files are API-only
                $cleanPath = [Uri]::UnescapeDataString($urlPath.TrimStart('/'))
                if ([string]::IsNullOrWhiteSpace($cleanPath)) { $cleanPath = "index.html" }
                $filePath = [System.IO.Path]::GetFullPath((Join-Path $baseDir $cleanPath))
                $root = [System.IO.Path]::GetFullPath($baseDir).TrimEnd('\') + '\'
                $inside = $filePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)
                $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
                $isData = ([System.IO.Path]::GetFileName($filePath) -like "quota_*")
                if ($inside -and -not $isData -and $mimeTypes.ContainsKey($ext) -and (Test-Path $filePath -PathType Leaf)) {
                    $response.ContentType = $mimeTypes[$ext]
                    $bytes = [System.IO.File]::ReadAllBytes($filePath)
                    $response.ContentLength64 = $bytes.Length
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                } else {
                    $response.StatusCode = 404
                    $err = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
                    $response.ContentLength64 = $err.Length
                    $response.OutputStream.Write($err, 0, $err.Length)
                }
            }
        }
        catch {
            Write-Host ("request error: " + $_.Exception.Message) -ForegroundColor Red
        }
        finally {
            $response.Close()
        }
        # Busy dashboards poll every few seconds, so also run the (time-gated) jobs here
        Invoke-Background
    }
}
catch {
    Write-Error $_
}
finally {
    if ($listener.IsListening) { $listener.Stop() }
}
