# ==============================================================================
# CALRIMS Local Multi-Tenant Hosts Configuration Script
# ==============================================================================

$hostsPath = "$env:windir\System32\drivers\etc\hosts"
$marker = "# CALRIMS Multi-Tenant Local Domains"

$content = Get-Content $hostsPath -Raw

if ($content -match "acme\.calrims\.local") {
    Write-Host "[OK] CALRIMS local subdomains are already configured in $hostsPath" -ForegroundColor Green
} else {
    $newEntries = @"

$marker
127.0.0.1    acme.calrims.local
127.0.0.1    nexus.calrims.local
127.0.0.1    calrims.local
"@

    try {
        Add-Content -Path $hostsPath -Value $newEntries -ErrorAction Stop
        Write-Host "[SUCCESS] Added local tenant domains to $hostsPath" -ForegroundColor Green
        ipconfig /flushdns | Out-Null
        Write-Host "[SUCCESS] Flushed Windows DNS resolver cache." -ForegroundColor Green
    } catch {
        Write-Host "[NOTICE] Writing to $hostsPath requires Administrator privileges." -ForegroundColor Yellow
        Write-Host "Elevating privileges to apply hosts configuration..." -ForegroundColor Cyan
        
        $scriptPath = $MyInvocation.MyCommand.Definition
        Start-Process powershell.exe -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -File `"$scriptPath`""
    }
}
