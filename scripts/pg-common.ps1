<#
.SYNOPSIS
  Shared helpers for the local identity databases (dev-db.ps1, e2e-db.ps1). Dot-source it.
  Uses MACROCOUNTER_TEST_PG (a local PostgreSQL superuser connection string). Never touches Supabase.
#>

function Get-AdminConnectionString {
    $value = $env:MACROCOUNTER_TEST_PG
    if (-not $value -and $IsWindows -ne $false) {
        $value = [Environment]::GetEnvironmentVariable('MACROCOUNTER_TEST_PG', 'User')
    }
    if (-not $value) {
        throw 'MACROCOUNTER_TEST_PG is not set. See specs/003-auth-security-foundations/quickstart.md.'
    }
    return $value
}

function ConvertFrom-ConnectionString([string] $connectionString) {
    $parts = @{}
    foreach ($pair in $connectionString.Split(';')) {
        if ($pair -match '^\s*([^=]+?)\s*=\s*(.*)$') { $parts[$matches[1].ToLowerInvariant()] = $matches[2] }
    }
    return @{
        Host     = $(if ($parts['host']) { $parts['host'] } else { 'localhost' })
        Port     = $(if ($parts['port']) { $parts['port'] } else { '5432' })
        Username = $(if ($parts['username']) { $parts['username'] } elseif ($parts['user id']) { $parts['user id'] } else { 'postgres' })
        Password = $parts['password']
    }
}

function Find-Psql {
    $onPath = Get-Command psql -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    $installed = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue |
        Sort-Object { [int]$_.Directory.Parent.Name } -Descending | Select-Object -First 1
    if ($installed) { return $installed.FullName }
    throw 'psql was not found. Install PostgreSQL (winget install PostgreSQL.PostgreSQL.17) or add its bin folder to PATH.'
}

# Session state for the helpers below. Set by Connect-AdminDatabase.
$script:PgAdmin = $null
$script:Psql = $null

function Connect-AdminDatabase {
    $script:PgAdmin = ConvertFrom-ConnectionString (Get-AdminConnectionString)
    $script:Psql = Find-Psql
    $env:PGPASSWORD = $script:PgAdmin.Password
    $env:PGOPTIONS = '-c client_min_messages=warning'
}

function Disconnect-AdminDatabase {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:PGOPTIONS -ErrorAction SilentlyContinue
}

function Invoke-Psql([string] $Database, [string] $Sql, [switch] $Scalar) {
    $a = $script:PgAdmin
    $arguments = @('-h', $a.Host, '-p', $a.Port, '-U', $a.Username, '-d', $Database, '-v', 'ON_ERROR_STOP=1', '-q')
    if ($Scalar) { $arguments += @('-tA') }
    $output = $Sql | & $script:Psql @arguments
    if ($LASTEXITCODE -ne 0) { throw "psql failed against $Database." }
    return $output
}

function New-RandomPassword {
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

<#
  Creates (or, with -Recreate, drops and recreates) a database, gives the login role a password (fresh
  and random unless -AppPassword is given), applies the idempotent migration script as the admin, and grants the role. Returns the app
  role's connection string.
#>
function Initialize-IdentityDatabase([string] $Root, [string] $Database, [string] $AppRole, [switch] $Recreate, [string] $AppPassword) {
    if ($Recreate) {
        Invoke-Psql 'postgres' "drop database if exists $Database with (force);" | Out-Null
    }
    $exists = Invoke-Psql 'postgres' "select 1 from pg_database where datname = '$Database';" -Scalar
    if (-not $exists) {
        Invoke-Psql 'postgres' "create database $Database;" | Out-Null
    }

    $appPassword = $(if ($AppPassword) { $AppPassword } else { New-RandomPassword })
    Invoke-Psql 'postgres' @"
do `$`$ begin
  if not exists (select 1 from pg_roles where rolname = '$AppRole') then
    create role $AppRole login password '$appPassword';
  else
    alter role $AppRole with login password '$appPassword';
  end if;
end `$`$;
"@ | Out-Null

    # The same idempotent script the owner runs on Supabase.
    $script = Join-Path ([System.IO.Path]::GetTempPath()) "macro-migrations-$([guid]::NewGuid()).sql"
    try {
        Push-Location $Root
        try {
            dotnet tool restore | Out-Null
            dotnet ef migrations script --idempotent --project backend/MacroCounter.Api --output $script | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'dotnet ef migrations script failed.' }
        }
        finally { Pop-Location }
        $a = $script:PgAdmin
        & $script:Psql -h $a.Host -p $a.Port -U $a.Username -d $Database -v ON_ERROR_STOP=1 -q -f $script | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Applying migrations to $Database failed." }
    }
    finally {
        Remove-Item $script -ErrorAction SilentlyContinue
    }
    Invoke-Psql $Database "select macro_admin.grant_app_role('$AppRole');" | Out-Null

    $a = $script:PgAdmin
    return "Host=$($a.Host);Port=$($a.Port);Database=$Database;Username=$AppRole;Password=$appPassword"
}
