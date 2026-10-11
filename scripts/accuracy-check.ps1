<#
.SYNOPSIS
  Manual, opt-in accuracy check for SC-007. NOT part of the test suite.

.DESCRIPTION
  !! WARNING: THIS SPENDS ANTHROPIC API CREDITS. !!
  It sends 20 real requests to Claude through your locally running app.

  Posts each food in accuracy-reference.json to /api/estimates/text and reports how many calorie
  estimates fall within +/-20% of the USDA reference value. SC-007 target: at least 80%.

  Start the app first (with your API key set via dotnet user-secrets):
    dotnet run --project backend/MacroCounter.Api

.EXAMPLE
  .\scripts\accuracy-check.ps1
  .\scripts\accuracy-check.ps1 -BaseUrl http://localhost:5080 -Yes
#>
param(
    [string]$BaseUrl = 'http://localhost:5080',
    # Skip the "this costs credits" confirmation.
    [switch]$Yes
)
$ErrorActionPreference = 'Stop'

$reference = Get-Content -Raw -Path (Join-Path $PSScriptRoot 'accuracy-reference.json') | ConvertFrom-Json
$foods = $reference.foods

Write-Host "This sends $($foods.Count) requests to Claude via $BaseUrl and spends API credits." -ForegroundColor Yellow
if (-not $Yes) {
    $answer = Read-Host 'Continue? (y/N)'
    if ($answer -notmatch '^[yY]') {
        Write-Host 'Cancelled.'
        exit 0
    }
}

$status = Invoke-RestMethod -Uri "$BaseUrl/api/status"
if (-not $status.aiAvailable) {
    Write-Host 'AI is not available (no Anthropic:ApiKey configured). Nothing to check.' -ForegroundColor Red
    exit 1
}

$results = @()
foreach ($food in $foods) {
    $body = @{ description = $food.description } | ConvertTo-Json
    try {
        $estimate = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/estimates/text" -ContentType 'application/json' -Body $body
        $kcal = [double]$estimate.total.kcal
        $relativeError = [math]::Abs($kcal - $food.kcal) / $food.kcal
        $within = $relativeError -le $reference.tolerance
        $results += [pscustomobject]@{
            Food      = $food.description
            Reference = $food.kcal
            Estimate  = [math]::Round($kcal)
            ErrorPct  = [math]::Round($relativeError * 100, 1)
            Within    = $within
        }
    }
    catch {
        $results += [pscustomobject]@{
            Food = $food.description; Reference = $food.kcal; Estimate = 'error'; ErrorPct = $null; Within = $false
        }
    }
}

$results | Format-Table -AutoSize
$passed = ($results | Where-Object { $_.Within }).Count
$share = $passed / $foods.Count
$percent = [math]::Round($share * 100)
$target = [math]::Round($reference.target * 100)
if ($share -ge $reference.target) {
    Write-Host "$passed of $($foods.Count) ($percent%) within +/-20%. Meets the SC-007 target of $target%." -ForegroundColor Green
    exit 0
}
Write-Host "$passed of $($foods.Count) ($percent%) within +/-20%. Below the SC-007 target of $target%." -ForegroundColor Red
exit 1
