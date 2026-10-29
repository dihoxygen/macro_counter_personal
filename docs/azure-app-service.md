# Setting up Azure App Service (plan B1)

This guide is for the owner. It expands step 2.1 of `docs/deploy.md`. It creates the App Service
plan, the web app, a Key Vault for the secrets and a cost alert. When you are done, go back to
`docs/deploy.md` step 2.2.

You need an Azure subscription (pay-as-you-go is fine) and, for the command-line version, the
Azure CLI (`az login`). The portal and the CLI steps do the same thing, so pick one.

Placeholders used below:

| Placeholder | Example | Notes |
|---|---|---|
| `<group>` | `macro-counter-rg` | resource group that holds everything |
| `<region>` | `eastus` | the Azure region closest to your Supabase region, e.g. AWS `us-east-1` → `eastus` |
| `<plan>` | `macro-counter-plan` | the App Service plan |
| `<app>` | `macro-counter-<something>` | must be unique across Azure |
| `<vault>` | `macro-counter-kv` | must be unique across Azure, 3–24 letters, digits and dashes |

## What it costs

- **B1 is a fixed hourly rate** that adds up to a fixed monthly price, roughly $13 a month on Linux.
  Check the price for your region in the [Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/).
  With one instance and no autoscale, the plan can't cost more than that.
- **Small extras:** Key Vault charges per operation (cents a month here), and outbound data past
  the free monthly allowance (a food log won't come near it). Tax depends on where you live.
- **You pay for the plan, not the app.** Stopping the app does not stop the bill. To stop paying,
  delete the plan (or the whole resource group).
- **Azure has no hard spending cap** on pay-as-you-go. The budget in step 6 only emails you.

## 1. Create the plan and the app

**Portal:** Create a resource → **Web App**.

- **Basics**
  - Resource group: **Create new** → `<group>`.
  - Name: `<app>`.
  - Publish: **Code**. Runtime stack: **.NET 10 (LTS)**. Operating system: **Linux**.
  - Region: `<region>`.
  - Linux plan: **Create new** → `<plan>`. Pricing plan: **Basic B1**. If B1 isn't listed, choose
    **Explore pricing plans** and pick it there.
  - Leave **Zone redundancy** off (it needs a higher plan and more instances).
- **Database:** none. The app uses Supabase.
- **Deployment:** leave continuous deployment **disabled**. Deploys go through `az webapp deploy`.
  Set **Basic authentication** to **Disabled**.
- **Networking:** leave public access **on**. Friends reach the app over the internet.
- **Monitoring:** Application Insights **No**. It is billed by volume and the app doesn't need it.
- **Review + create** → **Create**.

**CLI:**

```powershell
az group create --name <group> --location <region>
az appservice plan create --name <plan> --resource-group <group> --location <region> --sku B1 --is-linux
az webapp list-runtimes --os linux --query "[?contains(@, 'DOTNET')]"   # confirm the .NET 10 name
az webapp create --name <app> --resource-group <group> --plan <plan> --runtime "DOTNETCORE:10.0"
```

## 2. Lock down the configuration

**Portal:** open the app → Settings → **Configuration** → **General settings**:

| Setting | Value |
|---|---|
| HTTPS Only | **On** |
| Minimum inbound TLS version | **1.2** |
| Always On | **On** (B1 supports it; the free plan doesn't) |
| FTP state | **Disabled** |
| SCM Basic Auth Publishing Credentials | **Off** |
| FTP Basic Auth Publishing Credentials | **Off** |
| HTTP version | **2.0** |

Save. Then Settings → **Scale out (App Service plan)**: **Manual**, **1 instance**. The per-IP
and per-minute rate limits are kept in memory, so a second instance would double them.

**CLI:**

```powershell
az webapp update --name <app> --resource-group <group> --https-only true
az webapp config set --name <app> --resource-group <group> `
    --always-on true --min-tls-version 1.2 --ftps-state Disabled --http20-enabled true
az resource update --resource-group <group> --namespace Microsoft.Web --resource-type basicPublishingCredentialsPolicies `
    --parent sites/<app> --name scm --set properties.allow=false
az resource update --resource-group <group> --namespace Microsoft.Web --resource-type basicPublishingCredentialsPolicies `
    --parent sites/<app> --name ftp --set properties.allow=false
```

`az webapp deploy` signs in with your Azure account, so turning basic authentication off doesn't
stop deploys.

## 3. Note the host name and outbound IPs

**The host name.** New apps may get a *unique default host name*, such as
`<app>-a1b2c3d4e5f6g7h8.<region>-01.azurewebsites.net`, instead of `<app>.azurewebsites.net`.
Copy the **Default domain** from the app's **Overview** page and use exactly that wherever
`docs/deploy.md` says `<app>.azurewebsites.net`: `AllowedHosts`, `Security__AllowedOrigins__0`,
and the URL you send friends. If the two don't match, the app refuses the request.

**The outbound IPs.** Settings → **Networking** → **Outbound addresses**. Use the **Additional
outbound addresses** list too: it is every address the app might use, so the Supabase network
restriction (`docs/deploy.md` step 1.7) keeps working if Azure moves the app.

```powershell
az webapp show --name <app> --resource-group <group> --query defaultHostName -o tsv
az webapp show --name <app> --resource-group <group> --query possibleOutboundIpAddresses -o tsv
```

## 4. Key Vault for the secrets

The app reads its secrets through Key Vault references, so the values never sit in the App Service
settings in plain text.

1. **Give the app an identity.** Settings → **Identity** → System assigned → **On** → Save. Copy
   the **Object (principal) ID**.
2. **Create the vault.** Create a resource → **Key Vault**: resource group `<group>`, name
   `<vault>`, region `<region>`, pricing tier **Standard**. On the **Access configuration** tab,
   choose **Azure role-based access control**.
3. **Grant access** (vault → Access control (IAM) → Add role assignment):
   - **Key Vault Secrets Officer** to yourself, so you can add secrets.
   - **Key Vault Secrets User** to the app's managed identity, so it can only read them.
4. **Add the secrets** (vault → Objects → **Secrets** → Generate/Import). Type the values in the
   portal rather than on the command line, so they don't end up in your shell history:

   | Secret name | Value |
   |---|---|
   | `IdentityConnectionString` | the connection string from `docs/deploy.md` step 1 |
   | `DataProtectionPfx` | the base64 PFX from `docs/deploy.md` step 2.2 |
   | `DataProtectionPassword` | its password |
   | `AnthropicApiKey` | your Anthropic API key |

   You make the certificate in `docs/deploy.md` step 2.2, after this guide, so add the two
   `DataProtection` secrets then.

5. **Reference them** in the app settings (`docs/deploy.md` step 2.4), for example:

   ```text
   Anthropic__ApiKey = @Microsoft.KeyVault(VaultName=<vault>;SecretName=AnthropicApiKey)
   ```

   After saving, the settings page shows a green check next to each reference that resolved. A red
   cross usually means the role assignment from step 3 hasn't taken effect yet (it can take a few
   minutes) or the secret name is wrong.

**CLI** for steps 1–3 (add the secret values in the portal):

On a new subscription, `az keyvault create` fails with `MissingSubscriptionRegistration` until the
Key Vault provider is registered. That is a one-time, free step (the portal does it for you):

```powershell
az provider register --namespace Microsoft.KeyVault --wait
```

```powershell
$principal = az webapp identity assign --name <app> --resource-group <group> --query principalId -o tsv
az keyvault create --name <vault> --resource-group <group> --location <region> --enable-rbac-authorization true
$vaultId = az keyvault show --name <vault> --query id -o tsv
$me = az ad signed-in-user show --query id -o tsv
az role assignment create --role "Key Vault Secrets Officer" --assignee $me --scope $vaultId
az role assignment create --role "Key Vault Secrets User" --assignee-object-id $principal `
    --assignee-principal-type ServicePrincipal --scope $vaultId
```

## 5. Logs you can read

The startup log shows the worst-case AI spend (`docs/deploy.md` step 2.4), so turn on the free
file-system logs: Monitoring → **App Service logs** → Application logging **File System**,
retention **7 days** → Save. Read them live under Monitoring → **Log stream**, or:

```powershell
az webapp log tail --name <app> --resource-group <group>
```

## 6. A cost alert

Cost Management → **Budgets** → **Add**:

- Scope: your subscription (or `<group>`).
- Reset period: **Monthly**. Amount: **15** (B1 plus a margin).
- Alerts: **Actual** at **80%** and **100%**, emailed to you.

It only warns you. Nothing is stopped at the limit. The AI spend is capped separately by the app's
limits and the Claude Console limit.

## Done

Continue with `docs/deploy.md` step 2.2, the Data Protection certificate.
