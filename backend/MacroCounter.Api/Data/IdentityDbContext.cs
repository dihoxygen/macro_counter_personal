using MacroCounter.Api.Audit;
using MacroCounter.Api.Auth;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace MacroCounter.Api.Data;

/// <summary>
/// The server-side store: identity and security data only, never food, photos or goals (FR-019).
/// Everything lives in the private "macro" schema with explicit snake_case names (data-model.md).
/// </summary>
public sealed class IdentityDbContext(DbContextOptions<IdentityDbContext> options)
    : IdentityUserContext<AppUser, Guid>(options), IDataProtectionKeyContext
{
    public const string Schema = "macro";
    public const string UsernamePattern = "^[a-z0-9._-]{3,32}$";

    /// <summary>The one place the Npgsql provider is configured (app, tests and design-time tools).</summary>
    public static void UseMacroNpgsql(DbContextOptionsBuilder options, string connectionString) =>
        options.UseNpgsql(connectionString, npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", Schema));

    /// <inheritdoc cref="UseMacroNpgsql(DbContextOptionsBuilder, string)"/>
    public static void UseMacroNpgsql(DbContextOptionsBuilder options, Npgsql.NpgsqlDataSource dataSource) =>
        options.UseNpgsql(dataSource, npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", Schema));

    public DbSet<SessionRecord> Sessions => Set<SessionRecord>();
    public DbSet<TrustedDevice> TrustedDevices => Set<TrustedDevice>();
    public DbSet<AiUsageDaily> AiUsageDaily => Set<AiUsageDaily>();
    public DbSet<AiUsageGlobalDaily> AiUsageGlobalDaily => Set<AiUsageGlobalDaily>();
    public DbSet<AuditEventRecord> AuditEvents => Set<AuditEventRecord>();
    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);
        builder.HasDefaultSchema(Schema);

        builder.Entity<AppUser>(user =>
        {
            user.ToTable("users", t =>
            {
                t.HasCheckConstraint("ck_users_username", $"username ~ '{UsernamePattern}'");
                t.HasCheckConstraint("ck_users_role", $"role in ('{AppUser.OwnerRole}', '{AppUser.UserRole}')");
            });
            user.Ignore(u => u.Email);
            user.Ignore(u => u.NormalizedEmail);
            user.Ignore(u => u.EmailConfirmed);
            user.Ignore(u => u.PhoneNumber);
            user.Ignore(u => u.PhoneNumberConfirmed);

            user.Property(u => u.Id).HasColumnName("id");
            user.Property(u => u.UserName).HasColumnName("username").IsRequired().HasMaxLength(32);
            user.Property(u => u.NormalizedUserName).HasColumnName("normalized_username").IsRequired().HasMaxLength(32);
            user.Property(u => u.Role).HasColumnName("role").IsRequired().HasDefaultValue(AppUser.UserRole);
            user.Property(u => u.PasswordHash).HasColumnName("password_hash");
            user.Property(u => u.TempCodeHash).HasColumnName("temp_code_hash");
            user.Property(u => u.SetupExpiresAt).HasColumnName("setup_expires_at");
            user.Property(u => u.TwoFactorEnabled).HasColumnName("two_factor_enabled").HasDefaultValue(false);
            user.Property(u => u.TotpLastCode).HasColumnName("totp_last_code");
            user.Property(u => u.TotpLastUsedAt).HasColumnName("totp_last_used_at");
            user.Property(u => u.AiNoticeAckAt).HasColumnName("ai_notice_ack_at");
            user.Property(u => u.SecurityStamp).HasColumnName("security_stamp").IsRequired();
            user.Property(u => u.ConcurrencyStamp).HasColumnName("concurrency_stamp").IsRequired();
            user.Property(u => u.AccessFailedCount).HasColumnName("access_failed_count").HasDefaultValue(0);
            user.Property(u => u.LockoutEnabled).HasColumnName("lockout_enabled").HasDefaultValue(true);
            user.Property(u => u.LockoutEnd).HasColumnName("lockout_end");
            user.Property(u => u.DisabledAt).HasColumnName("disabled_at");
            user.Property(u => u.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()");
            user.Property(u => u.LastSignInAt).HasColumnName("last_sign_in_at");

            // Identity's own index on normalized_username is unique; keep it, and add one on username.
            user.HasIndex(u => u.NormalizedUserName).HasDatabaseName("ix_users_normalized_username").IsUnique();
            user.HasIndex(u => u.UserName).HasDatabaseName("ix_users_username").IsUnique();
            user.HasIndex(u => u.Role).HasDatabaseName("ux_users_single_owner").IsUnique()
                .HasFilter($"role = '{AppUser.OwnerRole}'");
        });

        builder.Entity<IdentityUserToken<Guid>>(token =>
        {
            token.ToTable("user_tokens");
            token.Property(t => t.UserId).HasColumnName("user_id");
            token.Property(t => t.LoginProvider).HasColumnName("login_provider");
            token.Property(t => t.Name).HasColumnName("name");
            token.Property(t => t.Value).HasColumnName("value");
        });

        builder.Entity<IdentityUserClaim<Guid>>(claim =>
        {
            claim.ToTable("user_claims");
            claim.Property(c => c.Id).HasColumnName("id");
            claim.Property(c => c.UserId).HasColumnName("user_id");
            claim.Property(c => c.ClaimType).HasColumnName("claim_type");
            claim.Property(c => c.ClaimValue).HasColumnName("claim_value");
        });

        builder.Entity<IdentityUserLogin<Guid>>(login =>
        {
            login.ToTable("user_logins");
            login.Property(l => l.LoginProvider).HasColumnName("login_provider");
            login.Property(l => l.ProviderKey).HasColumnName("provider_key");
            login.Property(l => l.ProviderDisplayName).HasColumnName("provider_display_name");
            login.Property(l => l.UserId).HasColumnName("user_id");
        });

        builder.Entity<SessionRecord>(session =>
        {
            session.ToTable("sessions", t => t.HasCheckConstraint("ck_sessions_kind",
                $"kind in ('{SessionRecord.SetupKind}', '{SessionRecord.FullKind}', '{SessionRecord.MfaKind}')"));
            session.HasKey(s => s.KeyHash);
            session.Property(s => s.KeyHash).HasColumnName("key_hash");
            session.Property(s => s.UserId).HasColumnName("user_id");
            session.Property(s => s.Kind).HasColumnName("kind");
            session.Property(s => s.SecurityStamp).HasColumnName("security_stamp");
            session.Property(s => s.Ticket).HasColumnName("ticket");
            session.Property(s => s.CreatedAt).HasColumnName("created_at");
            session.Property(s => s.LastSeenAt).HasColumnName("last_seen_at");
            session.Property(s => s.AbsoluteExpiresAt).HasColumnName("absolute_expires_at");
            session.Property(s => s.SetupFailedCodes).HasColumnName("setup_failed_codes").HasDefaultValue((short)0);
            session.HasIndex(s => s.UserId).HasDatabaseName("ix_sessions_user_id");
            session.HasOne<AppUser>().WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<TrustedDevice>(device =>
        {
            device.ToTable("trusted_devices");
            device.HasKey(d => d.TokenHash);
            device.Property(d => d.TokenHash).HasColumnName("token_hash");
            device.Property(d => d.UserId).HasColumnName("user_id");
            device.Property(d => d.SecurityStamp).HasColumnName("security_stamp");
            device.Property(d => d.CreatedAt).HasColumnName("created_at");
            device.Property(d => d.ExpiresAt).HasColumnName("expires_at");
            device.HasIndex(d => d.UserId).HasDatabaseName("ix_trusted_devices_user_id");
            device.HasOne<AppUser>().WithMany().HasForeignKey(d => d.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<AiUsageDaily>(usage =>
        {
            usage.ToTable("ai_usage_daily", t => t.HasCheckConstraint("ck_ai_usage_daily_count", "count >= 0"));
            usage.HasKey(u => new { u.UserId, u.Day });
            usage.Property(u => u.UserId).HasColumnName("user_id");
            usage.Property(u => u.Day).HasColumnName("day");
            usage.Property(u => u.Count).HasColumnName("count");
            usage.HasOne<AppUser>().WithMany().HasForeignKey(u => u.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<AiUsageGlobalDaily>(usage =>
        {
            usage.ToTable("ai_usage_global_daily", t => t.HasCheckConstraint("ck_ai_usage_global_daily_count", "count >= 0"));
            usage.HasKey(u => u.Day);
            usage.Property(u => u.Day).HasColumnName("day");
            usage.Property(u => u.Count).HasColumnName("count");
            usage.Property(u => u.CeilingHitAt).HasColumnName("ceiling_hit_at");
        });

        builder.Entity<AuditEventRecord>(audit =>
        {
            audit.ToTable("audit_events", t =>
            {
                t.HasCheckConstraint("ck_audit_events_event_type", $"event_type in ({SqlList(AuditLog.EventCodes)})");
                t.HasCheckConstraint("ck_audit_events_outcome", $"outcome in ({SqlList(AuditLog.OutcomeCodes)})");
                t.HasCheckConstraint("ck_audit_events_actor", $"actor in ({SqlList(AuditLog.Actors)})");
                t.HasCheckConstraint("ck_audit_events_reason", $"reason is null or reason in ({SqlList(AuditLog.ReasonCodes)})");
            });
            audit.Property(a => a.Id).HasColumnName("id").UseIdentityAlwaysColumn();
            audit.Property(a => a.OccurredAt).HasColumnName("occurred_at").HasDefaultValueSql("now()");
            audit.Property(a => a.EventType).HasColumnName("event_type");
            audit.Property(a => a.Outcome).HasColumnName("outcome");
            audit.Property(a => a.UserId).HasColumnName("user_id");
            audit.Property(a => a.Actor).HasColumnName("actor");
            audit.Property(a => a.SourceIp).HasColumnName("source_ip").HasColumnType("inet");
            audit.Property(a => a.Reason).HasColumnName("reason");
            audit.HasIndex(a => a.OccurredAt).HasDatabaseName("ix_audit_events_occurred_at");
            // Audit history outlives accounts: deleting a user keeps their events, unlinked.
            audit.HasOne<AppUser>().WithMany().HasForeignKey(a => a.UserId).OnDelete(DeleteBehavior.SetNull);
        });

        builder.Entity<DataProtectionKey>(key =>
        {
            key.ToTable("data_protection_keys");
            key.Property(k => k.Id).HasColumnName("id");
            key.Property(k => k.FriendlyName).HasColumnName("friendly_name");
            key.Property(k => k.Xml).HasColumnName("xml");
        });
    }

    private static string SqlList(IEnumerable<string> values) => string.Join(", ", values.Select(v => $"'{v}'"));
}
