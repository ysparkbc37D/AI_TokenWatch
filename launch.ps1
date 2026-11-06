# 토큰 대시보드 실행기
# 1) 포트를 잡고 있는 이전 서버(어떤 프로세스든)를 강제로 끝낸다
# 2) serve.ps1 을 창 없이 새로 띄우고 응답할 때까지 기다린다
# 3) Chrome(없으면 Edge, 그것도 없으면 기본 브라우저) 앱 창으로 대시보드를 연다
# 이 파일은 한글 메시지 때문에 UTF-8 BOM 으로 저장한다 (PowerShell 5.1 호환).
param(
    [int]$Port = 8089,
    [string]$DataDir = "",
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$dir   = $PSScriptRoot
$serve = Join-Path $dir 'serve.ps1'
$url   = "http://localhost:$Port/"
$title = '토큰 대시보드'

function Show-Message([string]$text, [string]$icon = 'Error') {
    Write-Host $text
    if ($NoBrowser) { return }
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show($text, $title, 'OK', $icon)
}

# 포트를 쓰고 있는 프로세스 ID 목록 (HttpListener 는 HTTP.sys 를 통하므로 netsh 로, 일반 서버는 TCP 로 찾는다)
function Get-PortOwners([int]$p) {
    $ids = New-Object 'System.Collections.Generic.HashSet[int]'
    try {
        # 창 없이 실행되면 netsh 가 한국어로 출력하므로 언어와 무관하게 읽는다:
        # 요청 큐 항목은 0열에서 시작하고, 프로세스 줄은 "ID: 1234, ..." 형태다.
        $text = (& netsh http show servicestate view=requestq) -join "`n"
        foreach ($block in ($text -split '(?m)^(?=\S)')) {
            if ($block -match "(?i)https?://[^/\s]+:$p/") {
                foreach ($m in [regex]::Matches($block, '\bID:\s*(\d+),')) { [void]$ids.Add([int]$m.Groups[1].Value) }
            }
        }
    } catch {}
    try {
        Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction Stop |
            ForEach-Object { [void]$ids.Add([int]$_.OwningProcess) }
    } catch {}
    # 0/4 는 시스템(HTTP.sys) 이라 끌 수 없고, 자기 자신도 제외
    @($ids | Where-Object { $_ -gt 4 -and $_ -ne $PID })
}

function Test-PrefixFree([int]$p) {
    $l = New-Object System.Net.HttpListener
    $l.Prefixes.Add("http://localhost:$p/")
    try { $l.Start(); $l.Stop(); return $true } catch { return $false } finally { $l.Close() }
}

function Clear-Port([int]$p) {
    for ($round = 0; $round -lt 4; $round++) {
        $owners = Get-PortOwners $p
        foreach ($id in $owners) {
            $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Host "포트 $p 사용 중인 프로세스 종료: PID $id ($($proc.ProcessName))"
                try { Stop-Process -Id $id -Force -ErrorAction Stop } catch { Write-Host "  종료 실패: $($_.Exception.Message)" }
            }
        }
        Start-Sleep -Milliseconds 500
        if ((Get-PortOwners $p).Count -eq 0 -and (Test-PrefixFree $p)) { return $true }
    }
    return $false
}

function Find-Browser {
    $candidates = @()
    foreach ($exe in 'chrome.exe', 'msedge.exe') {
        foreach ($hive in 'HKCU', 'HKLM') {
            try {
                $v = (Get-ItemProperty "${hive}:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$exe" -ErrorAction Stop).'(default)'
                if ($v) { $candidates += $v }
            } catch {}
        }
    }
    $candidates += @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
    )
    foreach ($c in $candidates) { if ($c -and (Test-Path -LiteralPath $c)) { return $c } }
    return $null
}

try {
    if (-not (Test-Path -LiteralPath $serve)) { throw "serve.ps1 을 찾을 수 없습니다: $serve" }

    # 1) 이전 서버 정리
    if (-not (Clear-Port $Port)) {
        $left = (Get-PortOwners $Port) -join ', '
        throw "포트 $Port 를 비우지 못했습니다.`n남은 프로세스: $left`n관리자 권한 프로그램이 잡고 있을 수 있습니다. 작업 관리자에서 해당 PID 를 끝낸 뒤 다시 실행하세요."
    }

    # 2) 서버 시작 (창 없이)
    $psArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$serve`"", '-Port', "$Port")
    if ($DataDir) { $psArgs += @('-DataDir', "`"$DataDir`"") }
    $server = Start-Process -FilePath 'powershell.exe' -ArgumentList $psArgs -WindowStyle Hidden -PassThru
    Write-Host "서버 시작: PID $($server.Id)"

    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        if ($server.HasExited) { break }
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri "${url}api/quota" -TimeoutSec 2
            if ($r.StatusCode -eq 200) { $ready = $true; break }
        } catch {}
        Start-Sleep -Milliseconds 250
    }
    if (-not $ready) {
        throw "서버가 응답하지 않습니다 (포트 $Port).`n같은 폴더에서 serve.ps1 을 직접 실행하면 오류 내용을 볼 수 있습니다."
    }
    Write-Host "준비 완료: $url"

    # 3) 대시보드 창 열기
    if (-not $NoBrowser) {
        $browser = Find-Browser
        if ($browser) {
            Start-Process -FilePath $browser -ArgumentList @("--app=$url", '--window-size=1120,900')
        } else {
            Start-Process $url
        }
    }
    exit 0
}
catch {
    Show-Message $_.Exception.Message
    exit 1
}
