<#
.SYNOPSIS
  The merge gate (constitution: Development Workflow). Runs every check in order and stops at the
  first failure with a non-zero exit code. Run from anywhere: .\scripts\check.ps1
  CI runs exactly this script (.github/workflows/ci.yml).

  Claude, Have I Been Pwned and Supabase are never contacted: every test uses mocks, fakes and a
  throwaway local PostgreSQL database (MACROCOUNTER_TEST_PG).
#>
# Native tools report failure through exit codes; in Windows PowerShell 5.1, 'Stop' would also
# abort on harmless stderr output (warnings), so check $LASTEXITCODE instead.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot

# Preflight: the backend and end-to-end tests need a local PostgreSQL superuser connection.
if (-not $env:MACROCOUNTER_TEST_PG -and $IsWindows -ne $false) {
    # setx only reaches processes started afterwards; pass the user-level value on to the tools below.
    $env:MACROCOUNTER_TEST_PG = [Environment]::GetEnvironmentVariable('MACROCOUNTER_TEST_PG', 'User')
}
if (-not $env:MACROCOUNTER_TEST_PG) {
    Write-Host 'MACROCOUNTER_TEST_PG is not set. Point it at a local PostgreSQL superuser, e.g.' -ForegroundColor Red
    Write-Host '  setx MACROCOUNTER_TEST_PG "Host=localhost;Username=postgres;Password=<your password>"' -ForegroundColor Red
    Write-Host 'See specs/003-auth-security-foundations/quickstart.md.' -ForegroundColor Red
    exit 2
}

function Test-VulnerablePackages {
    $output = dotnet list "$root/backend" package --vulnerable --include-transitive 2>&1 | Out-String
    Write-Host $output
    if ($LASTEXITCODE -ne 0) { return $LASTEXITCODE }
    if ($output -match '\b(High|Critical)\b') {
        Write-Host 'A NuGet dependency has a high or critical vulnerability (constitution VII).' -ForegroundColor Red
        return 1
    }
    return 0
}

<#
  FR-030: no secret in the repository or the built client. Placeholders in docs and variables in scripts
  (Password=<...>, Password= followed by an ellipsis, Password=$var, Password=${{ ... }}) are allowed.
  This file is kept ASCII-only: Windows PowerShell 5.1 reads BOM-less UTF-8 scripts as ANSI.
#>
function Test-NoSecrets {
    $patterns = @(
        'sk-ant-[A-Za-z0-9_-]{20,}',
        'Password=(?![<$\{\u2026])[^;"''\s]{4,}',
        '-----BEGIN (RSA |EC )?PRIVATE KEY-----',
        '"ApiKey"\s*:\s*"[^"]+"'
    )
    $binary = '\.(png|jpe?g|gif|ico|webp|woff2?|ttf|zip|pfx|p12|dll|exe|lock)$'
    # This script holds the patterns themselves.
    $allowlisted = @('scripts/check.ps1')
    $files = @(git -C $root ls-files | Where-Object { $_ -notmatch $binary -and $allowlisted -notcontains $_ } |
        ForEach-Object { Join-Path $root $_ })
    $wwwroot = Join-Path $root 'backend/MacroCounter.Api/wwwroot'
    if (Test-Path $wwwroot) {
        $files += Get-ChildItem $wwwroot -Recurse -File | Where-Object { $_.Name -notmatch $binary } | ForEach-Object { $_.FullName }
    }
    $found = @()
    foreach ($file in $files) {
        if (-not (Test-Path $file)) { continue }
        foreach ($match in Select-String -Path $file -Pattern $patterns -AllMatches -Encoding UTF8 -ErrorAction SilentlyContinue) {
            $found += "$($match.Path):$($match.LineNumber)"
        }
    }
    if ($found.Count -gt 0) {
        Write-Host 'Possible secrets found (constitution VII, FR-030):' -ForegroundColor Red
        $found | Sort-Object -Unique | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
        return 1
    }
    Write-Host "No secrets found in $($files.Count) files."
    return 0
}

$steps = @(
    @{ Name = 'Backend restore (locked)';   Command = { dotnet restore "$root/backend" --locked-mode } },
    @{ Name = 'Backend format';             Command = { dotnet format "$root/backend" --verify-no-changes } },
    @{ Name = 'Backend tests + coverage';   Command = { dotnet test "$root/backend" /p:CollectCoverage=true } },
    @{ Name = 'Backend vulnerability scan'; Command = { $global:LASTEXITCODE = Test-VulnerablePackages } },
    @{ Name = 'Frontend lint';              Command = { npm --prefix "$root/frontend" run lint } },
    @{ Name = 'Frontend typecheck';         Command = { npm --prefix "$root/frontend" run typecheck } },
    @{ Name = 'Frontend tests + coverage';  Command = { npm --prefix "$root/frontend" test -- --coverage } },
    @{ Name = 'Frontend vulnerability scan'; Command = { npm --prefix "$root/frontend" audit --audit-level=high } },
    # Includes the auth projects: playwright.config.ts resets macro_e2e (scripts/e2e-db.ps1) and builds first.
    @{ Name = 'End-to-end tests';           Command = { npm --prefix "$root/frontend" run e2e } },
    # After the e2e step, so the production build in wwwroot is scanned too.
    @{ Name = 'Secret scan';                Command = { $global:LASTEXITCODE = Test-NoSecrets } }
)

$index = 0
foreach ($step in $steps) {
    $index++
    Write-Host ""
    Write-Host "[$index/$($steps.Count)] $($step.Name)" -ForegroundColor Cyan
    $global:LASTEXITCODE = 0
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
