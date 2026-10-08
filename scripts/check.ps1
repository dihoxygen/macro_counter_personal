<#
.SYNOPSIS
  The merge gate (constitution: Development Workflow). Runs every check in order and stops at the
  first failure with a non-zero exit code. Run from anywhere: .\scripts\check.ps1

  Claude is mocked in every test; this script never calls api.anthropic.com.
#>
# Native tools report failure through exit codes; in Windows PowerShell 5.1, 'Stop' would also
# abort on harmless stderr output (warnings), so check $LASTEXITCODE instead.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot

$steps = @(
    @{ Name = 'Backend format';          Command = { dotnet format "$root/backend" --verify-no-changes } },
    @{ Name = 'Backend tests + coverage'; Command = { dotnet test "$root/backend" /p:CollectCoverage=true } },
    @{ Name = 'Frontend lint';           Command = { npm --prefix "$root/frontend" run lint } },
    @{ Name = 'Frontend typecheck';      Command = { npm --prefix "$root/frontend" run typecheck } },
    @{ Name = 'Frontend tests + coverage'; Command = { npm --prefix "$root/frontend" test -- --coverage } },
    @{ Name = 'End-to-end tests';        Command = { npm --prefix "$root/frontend" run e2e } }
)

$index = 0
foreach ($step in $steps) {
    $index++
    Write-Host ""
    Write-Host "[$index/$($steps.Count)] $($step.Name)" -ForegroundColor Cyan
    & $step.Command
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "FAILED: $($step.Name) (exit code $LASTEXITCODE)" -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

Write-Host ""
Write-Host "All checks passed." -ForegroundColor Green
exit 0
