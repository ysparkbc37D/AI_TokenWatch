# 1-Click Sync to GitHub (AI_TokenWatch)
# ASCII-only on purpose for PowerShell 5.1 compatibility.

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host " AI_TokenWatch -> GitHub Sync" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Cyan

$baseDir = $PSScriptRoot
. (Join-Path $baseDir "tokens.ps1")
. (Join-Path $baseDir "db.ps1")

Write-Host "1. Exporting latest database & quota snapshots..." -ForegroundColor Yellow
Export-StaticSnapshots

Write-Host "2. Checking Git remote..." -ForegroundColor Yellow
$remoteUrl = "https://github.com/ysparkbc37D/AI_TokenWatch.git"
$remotes = git remote -v
if (-not ($remotes -match "origin")) {
    git remote add origin $remoteUrl
    Write-Host "Added remote origin: $remoteUrl" -ForegroundColor Cyan
}

Write-Host "3. Staging changes..." -ForegroundColor Yellow
git add .

$status = git status --short
if (-not $status) {
    Write-Host "Nothing changed. Everything is up to date." -ForegroundColor Green
} else {
    $nowStr = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    Write-Host "4. Committing changes ($nowStr)..." -ForegroundColor Yellow
    git commit -m "Auto sync: AI Token Quota & SQLite Vault snapshot ($nowStr)"
    
    Write-Host "5. Pushing to GitHub (main & gh-pages)..." -ForegroundColor Yellow
    git branch -M main
    git push -u origin main
    git push origin main:gh-pages
}

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host " Done! PWA & Mobile snapshots are synced to GitHub." -ForegroundColor Green
Write-Host " Mobile URL: https://ysparkbc37D.github.io/AI_TokenWatch/" -ForegroundColor White
Write-Host "========================================================" -ForegroundColor Cyan
