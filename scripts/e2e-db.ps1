<#
.SYNOPSIS
  Resets the local end-to-end database "macro_e2e" for the Playwright "auth" projects: recreates it,
  applies the migrations, grants the "macro_app_e2e" role, and invites e2e-owner (owner) and e2e-friend.

  Writes two untracked files the tests read:
    frontend/tests/e2e/auth/.codes.json   the invite codes
    frontend/tests/e2e/auth/.e2e-db.json  the app role's connection string (local throwaway database)

  Uses MACROCOUNTER_TEST_PG. Never touches Supabase.
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'pg-common.ps1')

$database = 'macro_e2e'
$outDir = Join-Path $root 'frontend/tests/e2e/auth'

Connect-AdminDatabase
try {
    # Keep the role's password across resets so a backend that is already running stays connected.
    $dbFile = Join-Path $outDir '.e2e-db.json'
    $previous = $null
    if (Test-Path $dbFile) {
        $previous = ((Get-Content $dbFile -Raw | ConvertFrom-Json).connectionString -split ';' |
            Where-Object { $_ -like 'Password=*' }) -replace '^Password=', ''
    }
    $appConnection = Initialize-IdentityDatabase -Root $root -Database $database -AppRole 'macro_app_e2e' -Recreate -AppPassword $previous
    # No pooling: the database is dropped and recreated between runs, which would leave pooled connections dead.
    $appConnection += ';Pooling=false'
    $codes = [ordered]@{}
    foreach ($user in @(@{ Name = 'e2e-owner'; Role = 'owner' }, @{ Name = 'e2e-friend'; Role = 'user' })) {
        $code = Invoke-Psql $database "select macro_admin.invite_user('$($user.Name)', '$($user.Role)');" -Scalar
        $codes[$user.Name] = "$code".Trim()
    }

    New-Item -ItemType Directory -Force $outDir | Out-Null
    # UTF-8 without a BOM: Node's JSON.parse rejects one.
    [System.IO.File]::WriteAllText((Join-Path $outDir '.codes.json'), ($codes | ConvertTo-Json))
    [System.IO.File]::WriteAllText($dbFile, (@{ connectionString = $appConnection } | ConvertTo-Json))
    Write-Host "Reset $database and invited e2e-owner and e2e-friend."
}
finally {
    Disconnect-AdminDatabase
}
