# 5-minute Auto Sync Daemon for AI_TokenWatch -> GitHub Pages
# Runs in background or terminal window. Press Ctrl+C to exit.

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host " AI_TokenWatch -> 5-min Auto Sync Daemon" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "Mobile URL : https://ysparkbc37D.github.io/AI_TokenWatch/" -ForegroundColor White
Write-Host "Press Ctrl + C at any time to stop.`n" -ForegroundColor DarkGray

$baseDir = $PSScriptRoot

while ($true) {
    $nowStr = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    Write-Host "[$nowStr] Exporting snapshots & syncing to GitHub..." -ForegroundColor Yellow
    
    try {
        & (Join-Path $baseDir "sync-github.ps1")
    } catch {
        Write-Host "[$nowStr] Error during sync: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    Write-Host "`n[$nowStr] Done. Waiting 5 minutes for next sync..." -ForegroundColor DarkCyan
    Start-Sleep -Seconds 300
}
