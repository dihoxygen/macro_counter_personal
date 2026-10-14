using System.Security.Cryptography.X509Certificates;
using MacroCounter.Api.Audit;
using MacroCounter.Api.Auth;
using MacroCounter.Api.Security;
using MacroCounter.Api.Usage;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using Npgsql;

namespace MacroCounter.Api.Data;

public static class IdentityServices
{
    public const string ConnectionStringName = "Identity";

    /// <summary>
    /// The identity store (Supabase PostgreSQL in production, local PostgreSQL in tests), ASP.NET Core
    /// Identity, Data Protection keys, the audit log and the security/limits options.
    /// </summary>
    public static WebApplicationBuilder AddIdentityStore(this WebApplicationBuilder builder)
    {
        var services = builder.Services;
        var configuration = builder.Configuration;

        services.Configure<SecurityOptions>(configuration.GetSection(SecurityOptions.Section));
        services.Configure<LimitsOptions>(configuration.GetSection(LimitsOptions.Section));
        services.AddSingleton(TimeProvider.System);

        // Resolved lazily so host-level configuration (environment, secrets, test overrides) applies;
        // Program resolves it right after Build() so a missing connection string still stops startup.
        services.AddSingleton(sp =>
        {
            var connectionString = sp.GetRequiredService<IConfiguration>().GetConnectionString(ConnectionStringName);
            if (string.IsNullOrWhiteSpace(connectionString))
            {
                throw new InvalidOperationException(
                    $"ConnectionStrings:{ConnectionStringName} is not set. Run scripts/dev-db.ps1 for local development, " +
                    "or set ConnectionStrings__Identity on the host (docs/deploy.md).");
            }
            return NpgsqlDataSource.Create(connectionString);
        });
        services.AddDbContext<IdentityDbContext>((sp, options) =>
            IdentityDbContext.UseMacroNpgsql(options, sp.GetRequiredService<NpgsqlDataSource>()));
        services.AddSingleton<IAuditLog, AuditLog>();

        var dataProtection = services.AddDataProtection()
            .SetApplicationName("MacroCounter")
            .PersistKeysToDbContext<IdentityDbContext>();
        if (builder.Environment.IsProduction())
        {
            dataProtection.ProtectKeysWithCertificate(LoadDataProtectionCertificate(configuration));
        }

        services.AddOptions<PasswordHasherOptions>()
            .Configure<IOptions<SecurityOptions>>((o, security) => o.IterationCount = security.Value.Password.Pbkdf2Iterations);
        services.AddOptions<IdentityOptions>().Configure<IOptions<SecurityOptions>>((o, security) =>
        {
            o.Lockout.MaxFailedAccessAttempts = security.Value.SignIn.LockoutFailures;
            o.Lockout.DefaultLockoutTimeSpan = security.Value.SignIn.LockoutDuration;
        });
        services.AddIdentityCore<AppUser>(o =>
            {
                o.Lockout.AllowedForNewUsers = true;
                o.User.AllowedUserNameCharacters = "abcdefghijklmnopqrstuvwxyz0123456789._-";
                o.User.RequireUniqueEmail = false;
            })
            .AddEntityFrameworkStores<IdentityDbContext>()
            .AddTokenProvider<AuthenticatorTokenProvider<AppUser>>(TokenOptions.DefaultAuthenticatorProvider);

        return builder;
    }

    private static X509Certificate2 LoadDataProtectionCertificate(IConfiguration configuration)
    {
        var pfx = configuration["DataProtection:CertificatePfxBase64"];
        if (string.IsNullOrWhiteSpace(pfx))
        {
            throw new InvalidOperationException(
                "DataProtection:CertificatePfxBase64 is not set. Production encrypts Data Protection keys at rest " +
                "with this certificate (research R13, docs/deploy.md).");
        }
        return X509CertificateLoader.LoadPkcs12(Convert.FromBase64String(pfx), configuration["DataProtection:CertificatePassword"]);
    }
}
