# Deploying Macro Counter

This guide is for the owner. It sets up the identity database on **Supabase** and the app on **Azure
App Service** (research R12 and R15 in `specs/003-auth-security-foundations/research.md`). Nothing
here goes in the repository: every secret lives in Supabase, App Service settings or Key Vault, and
your password manager.

Before inviting anyone other than yourself, complete the security review in the last section
(Constitution: Governance).

## 1. Supabase (identity and security data only)

1. **Create a project** in the region closest to where the app will run. Turn on **MFA on your
   Supabase account**: anyone with access to it controls every account in the app.
2. **Turn off the Data API** (Project Settings → API). The app never uses it, so nothing in the
   database is reachable through PostgREST. The tables also sit in a private `macro` schema with
   row-level security as a second layer.
3. **Enable `pg_cron`** (Database → Extensions). This lets the migration schedule the daily
   retention purge.
4. **Download the root certificate** (Database Settings → SSL Configuration) and save it as
   `backend/MacroCounter.Api/certs/supabase-root-ca.crt`. It is public, not a secret, and is
   committed so `SSL Mode=VerifyFull` can check the server.
5. **Apply the migrations** as the owner (`postgres`). Generate the idempotent script:

   ```powershell
   dotnet tool install --global dotnet-ef   # once; skip if `dotnet ef --version` already works
   dotnet ef migrations script --idempotent --project backend/MacroCounter.Api --output migrate.sql
   ```

   Paste `migrate.sql` into the SQL editor and run it. Running it again later only applies new
   migrations. Then delete the local `migrate.sql`.
6. **Create the app's database login.** Generate a long random password and keep it in your
   password manager. In the SQL editor:

   ```sql
   create role macro_app login password '<long random password>';
   select macro_admin.grant_app_role('macro_app');
   ```

   `macro_app` can read and update sign-in data, but it **cannot create, rename, promote or
   re-enable accounts**, and it can only add audit rows, never read or change them
   (`specs/003-auth-security-foundations/data-model.md`).
7. **Restrict network access** (Database Settings → Network Restrictions) to the App Service's
   outbound IP addresses (step 2.3) and your own IP.
8. **Invite yourself:** `select macro_admin.invite_user('<you>', 'owner');`. Keep the printed code
   for your first sign-in. From now on, the owner runbook in
   `specs/003-auth-security-foundations/contracts/owner-procedures.md` covers adding and managing
   people.

The connection string the app uses (Supavisor **session** pooler, IPv4):

```text
Host=aws-0-<region>.pooler.supabase.com;Port=5432;Database=postgres;Username=macro_app.<project-ref>;Password=<macro_app password>;SSL Mode=VerifyFull;Root Certificate=certs/supabase-root-ca.crt
```

## 2. Azure App Service (one instance)

1. **Create the app:** Linux, .NET 10, plan **B1**, in the same region as Supabase. Step by step,
   with the Key Vault and a cost alert: `docs/azure-app-service.md`.
   - Settings → Configuration: **Always On** on, **HTTPS Only** on, minimum TLS 1.2, FTP state
     **Disabled**.
   - Scale out: **1 instance**. The per-IP and per-minute rate limits are kept in memory, so more
     instances would multiply them. The AI quotas are safe with any number of instances because
     they live in the database.
2. **Create the Data Protection certificate.** It encrypts the key ring that protects sessions,
   CSRF tokens and **every authenticator secret**. Keep the PFX and its password safe in your
   password manager. If it is lost, everyone is signed out and every account needs
   `macro_admin.reset_user`. In PowerShell:

   ```powershell
   $cert = New-SelfSignedCertificate -Subject 'CN=MacroCounter Data Protection' -KeyExportPolicy Exportable `
       -KeyAlgorithm RSA -KeyLength 3072 -NotAfter (Get-Date).AddYears(5) -CertStoreLocation Cert:\CurrentUser\My
   $password = Read-Host -AsSecureString 'PFX password'
   Export-PfxCertificate -Cert $cert -FilePath .\dp.pfx -Password $password | Out-Null
   [Convert]::ToBase64String([IO.File]::ReadAllBytes('.\dp.pfx')) | Set-Clipboard   # paste into Key Vault
   Remove-Item .\dp.pfx; Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)"
   ```

3. **Note the outbound IPs** (Networking → Outbound addresses) for the Supabase network restriction.
4. **App settings.** Prefer Key Vault references, for example
   `@Microsoft.KeyVault(SecretUri=...)`, for every secret:

   | Setting | Value |
   |---|---|
   | `ASPNETCORE_ENVIRONMENT` | `Production` |
   | `ASPNETCORE_FORWARDEDHEADERS_ENABLED` | `true` |
   | `AllowedHosts` | your host name, e.g. `<app>.azurewebsites.net` (never `*`) |
   | `Security__AllowedOrigins__0` | `https://<app>.azurewebsites.net` |
   | `ConnectionStrings__Identity` | the connection string from step 1 (secret) |
   | `DataProtection__CertificatePfxBase64` | the base64 PFX (secret) |
   | `DataProtection__CertificatePassword` | its password (secret) |
   | `Anthropic__ApiKey` | your Anthropic API key (secret) |
   | `Limits__Ai__GlobalMonthly` | `71` (a $25 monthly worst case: 71 × $0.35) |
   | `Limits__Ai__GlobalDaily` | `10` (a $3.50 daily worst case, so one day can't use up the month) |

   The app **refuses to start** in Production if `AllowedHosts` is `*` or missing, if no allowed
   origin is set, if the connection is not `SSL Mode=VerifyFull`, or if the Data Protection
   certificate is missing. At startup it logs the worst-case AI spend its limits allow. With the
   settings above that is $3.50 a day and $24.85 a month; check that the log says so. The built-in
   defaults (200 a day, 3,000 a month) allow about $70 a day and $1,050 a month, so don't leave
   these two settings out. The owner's initial budget is $25 a month. To raise it, set
   `GlobalMonthly` to the budget divided by `Limits__Ai__WorstCaseCostPerRequestUsd`, rounded down.

   Also set a **$25 monthly spend limit** for the API key's workspace in the Claude Console. It is
   the backstop if the app's worst-case estimate is ever wrong, for example if a retried call
   is billed twice (research R8).

## 3. Build and deploy

```powershell
npm --prefix frontend ci
npm --prefix frontend run build                    # writes the app into backend/MacroCounter.Api/wwwroot
dotnet publish backend/MacroCounter.Api -c Release -o publish
Compress-Archive -Path publish\* -DestinationPath app.zip -Force
az webapp deploy --resource-group <group> --name <app> --src-path app.zip --type zip
Remove-Item -Recurse publish, app.zip
```

Then sign in as the owner with the code from step 1.8.

## 4. Before inviting anyone else

1. Run the production smoke check, quickstart **V12**
   (`specs/003-auth-security-foundations/quickstart.md`). It covers the HTTPS redirect, every
   protective header, refusing a foreign origin, refusing an unknown host, and `macro_app` being
   unable to insert users.
2. Run `/security-review` on the branch and an OWASP ASVS Level 2 checklist pass
   (`specs/003-auth-security-foundations/checklists/asvs-l2.md`). Resolve each finding, or record a
   written risk acceptance in `plan.md`.
3. Tell each friend what is sent to Claude and that you run the server. The app also shows this
   during their first-time setup.
