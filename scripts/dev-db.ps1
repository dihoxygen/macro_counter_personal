<#
.SYNOPSIS
  Creates (or updates) the local development identity database "macro_dev" and the least-privilege
  login role "macro_app", applies all migrations, and stores the app's connection string in User
  Secrets as ConnectionStrings:Identity. Run from anywhere: .\scripts\dev-db.ps1

  Uses MACROCOUNTER_TEST_PG (a local PostgreSQL superuser connection string) as the admin.
  Never touches Supabase. Never prints passwords.
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'pg-common.ps1')

Connect-AdminDatabase
try {
    $appConnection = Initialize-IdentityDatabase -Root $root -Database 'macro_dev' -AppRole 'macro_app'
    Write-Host 'Migrations applied and macro_app granted.'

    # The backend connects as the app role; stored outside the repository.
    dotnet user-secrets set 'ConnectionStrings:Identity' $appConnection --project (Join-Path $root 'backend/MacroCounter.Api') | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'dotnet user-secrets set failed.' }
    Write-Host 'Stored ConnectionStrings:Identity in User Secrets.'

    Write-Host ''
    Write-Host 'Next: invite yourself as the owner and keep the code it prints:' -ForegroundColor Cyan
    Write-Host "  psql -d macro_dev -c `"select macro_admin.invite_user('<you>', 'owner');`""
}
finally {
    Disconnect-AdminDatabase
}
