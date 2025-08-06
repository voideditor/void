# Docker Desktop 메모리 설정 자동화 스크립트
# PowerShell을 관리자 권한으로 실행하세요

Write-Host "Docker Desktop 메모리 설정 스크립트" -ForegroundColor Green
Write-Host "=================================" -ForegroundColor Green

# .wslconfig 파일 경로
$wslConfigPath = "$env:USERPROFILE\.wslconfig"

# .wslconfig 내용
$wslConfig = @"
[wsl2]
memory=10GB
processors=4
swap=8GB
localhostForwarding=true
nestedVirtualization=true
"@

# 기존 파일 백업
if (Test-Path $wslConfigPath) {
    $backupPath = "$wslConfigPath.backup_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
    Copy-Item $wslConfigPath $backupPath
    Write-Host "기존 설정 백업 완료: $backupPath" -ForegroundColor Yellow
}

# 새 설정 파일 작성
Set-Content -Path $wslConfigPath -Value $wslConfig -Encoding UTF8
Write-Host ".wslconfig 파일 생성 완료" -ForegroundColor Green

# WSL 재시작
Write-Host "`nWSL 재시작 중..." -ForegroundColor Yellow
wsl --shutdown
Start-Sleep -Seconds 3

# Docker Desktop 재시작 안내
Write-Host "`n설정 완료!" -ForegroundColor Green
Write-Host "Docker Desktop을 수동으로 재시작해주세요:" -ForegroundColor Cyan
Write-Host "1. 시스템 트레이에서 Docker 아이콘 우클릭" -ForegroundColor White
Write-Host "2. 'Restart' 클릭" -ForegroundColor White
Write-Host "`n또는 아래 명령 실행:" -ForegroundColor Cyan
Write-Host "Restart-Service com.docker.service" -ForegroundColor White

# 메모리 확인
Write-Host "`n재시작 후 메모리 확인:" -ForegroundColor Yellow
Write-Host "wsl -d docker-desktop -e free -h" -ForegroundColor White