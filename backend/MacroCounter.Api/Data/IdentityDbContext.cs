using MacroCounter.Api.Audit;
using MacroCounter.Api.Auth;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace MacroCounter.Api.Data;

/// <summary>
/// The server-side store: identity, security and activity data (constitution v3.0.0), never photos. Identity and
/// security live in the private "macro" schema and activity data in "macro_data", with explicit snake_case names
/// (data-model.md).
/// </summary>
public sealed class IdentityDbContext(DbContextOptions<IdentityDbContext> options)
    : IdentityUserContext<AppUser, Guid>(options), IDataProtectionKeyContext
{
    public const string Schema = "macro";
    public const string ActivitySchema = "macro_data";
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
    public DbSet<LogEntryRow> LogEntries => Set<LogEntryRow>();
    public DbSet<EntryVersionRow> EntryVersions => Set<EntryVersionRow>();
    public DbSet<SavedFoodRow> SavedFoods => Set<SavedFoodRow>();
    public DbSet<ProteinGoalRow> ProteinGoals => Set<ProteinGoalRow>();
    public DbSet<SavedFoodAlias> SavedFoodAliases => Set<SavedFoodAlias>();
    public DbSet<ProteinGoalAlias> ProteinGoalAliases => Set<ProteinGoalAlias>();
    public DbSet<SyncState> SyncStates => Set<SyncState>();

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

        MapActivityData(builder);
    }

    /// <summary>Whitespace the device's trim() removes; SQL's btrim() on its own only removes spaces.</summary>
    private const string TrimmedName = @"btrim(name, E' \t\n\r')";
    private const string NameRule = $"char_length(name) <= 120 and {TrimmedName} <> ''";
    private const string QuantityRule = "between 0 and 100000";
    private const string UnitRule = "in ('g', 'ml', 'serving')";
    private const string KcalRule = "kcal between 0 and 100000";
    private const string MacroRule = "protein_g between 0 and 10000 and carbs_g between 0 and 10000 and fat_g between 0 and 10000";
    private const string SourceRule = "source in ('ai', 'ai-edited', 'manual')";
    private const string CategoryRule = "meal_category is null or meal_category in ('breakfast', 'lunch', 'dinner', 'snacks')";

    private static void MapActivityData(ModelBuilder builder)
    {
        builder.Entity<LogEntryRow>(entry =>
        {
            entry.ToTable("log_entries", ActivitySchema, t =>
            {
                t.HasCheckConstraint("ck_log_entries_name", $"name is null or ({NameRule})");
                t.HasCheckConstraint("ck_log_entries_quantity", $"quantity_amount is null or quantity_amount {QuantityRule}");
                t.HasCheckConstraint("ck_log_entries_unit", $"quantity_unit is null or quantity_unit {UnitRule}");
                t.HasCheckConstraint("ck_log_entries_kcal", $"kcal is null or {KcalRule}");
                t.HasCheckConstraint("ck_log_entries_macros", $"protein_g is null or carbs_g is null or fat_g is null or ({MacroRule})");
                t.HasCheckConstraint("ck_log_entries_source", $"source is null or {SourceRule}");
                t.HasCheckConstraint("ck_log_entries_category", CategoryRule);
                // A live entry has all its data; a tombstone has none of it (research R16).
                t.HasCheckConstraint("ck_log_entries_live", "deleted_at is not null or (day_key is not null and logged_at is not null "
                    + "and name is not null and quantity_amount is not null and quantity_unit is not null and kcal is not null "
                    + "and protein_g is not null and carbs_g is not null and fat_g is not null and source is not null and version_id is not null)");
                t.HasCheckConstraint("ck_log_entries_tombstone", "deleted_at is null or (day_key is null and logged_at is null and name is null "
                    + "and quantity_amount is null and quantity_unit is null and kcal is null and protein_g is null and carbs_g is null "
                    + "and fat_g is null and source is null and saved_food_id is null and meal_category is null and version_id is null)");
            });
            entry.HasKey(e => new { e.UserId, e.Id });
            entry.Property(e => e.UserId).HasColumnName("user_id");
            entry.Property(e => e.Id).HasColumnName("id");
            entry.Property(e => e.CreatedAt).HasColumnName("created_at");
            entry.Property(e => e.EffectiveAt).HasColumnName("effective_at");
            entry.Property(e => e.SchemaVersion).HasColumnName("schema_version");
            entry.Property(e => e.Revision).HasColumnName("revision");
            entry.Property(e => e.DeletedAt).HasColumnName("deleted_at");
            entry.Property(e => e.DayKey).HasColumnName("day_key");
            entry.Property(e => e.LoggedAt).HasColumnName("logged_at");
            entry.Property(e => e.Name).HasColumnName("name");
            entry.Property(e => e.QuantityAmount).HasColumnName("quantity_amount");
            entry.Property(e => e.QuantityUnit).HasColumnName("quantity_unit");
            entry.Property(e => e.Kcal).HasColumnName("kcal");
            entry.Property(e => e.ProteinG).HasColumnName("protein_g");
            entry.Property(e => e.CarbsG).HasColumnName("carbs_g");
            entry.Property(e => e.FatG).HasColumnName("fat_g");
            entry.Property(e => e.Source).HasColumnName("source");
            entry.Property(e => e.SavedFoodId).HasColumnName("saved_food_id");
            entry.Property(e => e.MealCategory).HasColumnName("meal_category");
            entry.Property(e => e.VersionId).HasColumnName("version_id");
            entry.Property(e => e.RestoredAt).HasColumnName("restored_at");
            entry.HasIndex(e => new { e.UserId, e.Revision }).HasDatabaseName("ix_log_entries_user_id_revision");
            entry.HasIndex(e => new { e.UserId, e.DayKey }).HasDatabaseName("ix_log_entries_user_id_day_key");
            entry.HasOne<AppUser>().WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<EntryVersionRow>(version =>
        {
            version.ToTable("entry_versions", ActivitySchema, t =>
            {
                t.HasCheckConstraint("ck_entry_versions_change_type", "change_type in ('edit', 'delete', 'restore')");
                t.HasCheckConstraint("ck_entry_versions_name", NameRule);
                t.HasCheckConstraint("ck_entry_versions_quantity", $"quantity_amount {QuantityRule}");
                t.HasCheckConstraint("ck_entry_versions_unit", $"quantity_unit {UnitRule}");
                t.HasCheckConstraint("ck_entry_versions_kcal", KcalRule);
                t.HasCheckConstraint("ck_entry_versions_macros", MacroRule);
                t.HasCheckConstraint("ck_entry_versions_source", SourceRule);
                t.HasCheckConstraint("ck_entry_versions_category", CategoryRule);
            });
            version.HasKey(v => new { v.UserId, v.Id });
            version.Property(v => v.UserId).HasColumnName("user_id");
            version.Property(v => v.Id).HasColumnName("id");
            version.Property(v => v.EntryId).HasColumnName("entry_id");
            version.Property(v => v.ChangeType).HasColumnName("change_type");
            version.Property(v => v.ReplacedAt).HasColumnName("replaced_at");
            version.Property(v => v.CreatedAt).HasColumnName("created_at");
            version.Property(v => v.EffectiveAt).HasColumnName("effective_at");
            version.Property(v => v.SchemaVersion).HasColumnName("schema_version");
            version.Property(v => v.Revision).HasColumnName("revision");
            version.Property(v => v.DayKey).HasColumnName("day_key");
            version.Property(v => v.LoggedAt).HasColumnName("logged_at");
            version.Property(v => v.Name).HasColumnName("name");
            version.Property(v => v.QuantityAmount).HasColumnName("quantity_amount");
            version.Property(v => v.QuantityUnit).HasColumnName("quantity_unit");
            version.Property(v => v.Kcal).HasColumnName("kcal");
            version.Property(v => v.ProteinG).HasColumnName("protein_g");
            version.Property(v => v.CarbsG).HasColumnName("carbs_g");
            version.Property(v => v.FatG).HasColumnName("fat_g");
            version.Property(v => v.Source).HasColumnName("source");
            version.Property(v => v.SavedFoodId).HasColumnName("saved_food_id");
            version.Property(v => v.MealCategory).HasColumnName("meal_category");
            version.Property(v => v.RestoredAt).HasColumnName("restored_at");
            version.HasIndex(v => new { v.UserId, v.Revision }).HasDatabaseName("ix_entry_versions_user_id_revision");
            version.HasIndex(v => new { v.UserId, v.EntryId }).HasDatabaseName("ix_entry_versions_user_id_entry_id");
            version.HasIndex(v => v.ReplacedAt).HasDatabaseName("ix_entry_versions_replaced_at");
            version.HasOne<AppUser>().WithMany().HasForeignKey(v => v.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<SavedFoodRow>(food =>
        {
            food.ToTable("saved_foods", ActivitySchema, t =>
            {
                t.HasCheckConstraint("ck_saved_foods_name", NameRule);
                t.HasCheckConstraint("ck_saved_foods_quantity", $"ref_amount {QuantityRule}");
                t.HasCheckConstraint("ck_saved_foods_unit", $"ref_unit {UnitRule}");
                t.HasCheckConstraint("ck_saved_foods_kcal", KcalRule);
                t.HasCheckConstraint("ck_saved_foods_macros", MacroRule);
                t.HasCheckConstraint("ck_saved_foods_source", SourceRule);
            });
            food.HasKey(f => new { f.UserId, f.Id });
            food.Property(f => f.UserId).HasColumnName("user_id");
            food.Property(f => f.Id).HasColumnName("id");
            food.Property(f => f.CreatedAt).HasColumnName("created_at");
            food.Property(f => f.EffectiveAt).HasColumnName("effective_at");
            food.Property(f => f.SchemaVersion).HasColumnName("schema_version");
            food.Property(f => f.Revision).HasColumnName("revision");
            food.Property(f => f.DeletedAt).HasColumnName("deleted_at");
            food.Property(f => f.Name).HasColumnName("name");
            food.Property(f => f.NormalizedName).HasColumnName("normalized_name");
            food.Property(f => f.RefAmount).HasColumnName("ref_amount");
            food.Property(f => f.RefUnit).HasColumnName("ref_unit");
            food.Property(f => f.Kcal).HasColumnName("kcal");
            food.Property(f => f.ProteinG).HasColumnName("protein_g");
            food.Property(f => f.CarbsG).HasColumnName("carbs_g");
            food.Property(f => f.FatG).HasColumnName("fat_g");
            food.Property(f => f.Source).HasColumnName("source");
            food.Property(f => f.LastUsedAt).HasColumnName("last_used_at");
            food.HasIndex(f => new { f.UserId, f.Revision }).HasDatabaseName("ix_saved_foods_user_id_revision");
            food.HasIndex(f => new { f.UserId, f.NormalizedName, f.RefUnit }).HasDatabaseName("ux_saved_foods_natural_key")
                .IsUnique().HasFilter("deleted_at is null");
            food.HasOne<AppUser>().WithMany().HasForeignKey(f => f.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<ProteinGoalRow>(goal =>
        {
            goal.ToTable("protein_goals", ActivitySchema, t =>
                t.HasCheckConstraint("ck_protein_goals_grams", "grams is null or (grams > 0 and grams <= 10000)"));
            goal.HasKey(g => new { g.UserId, g.Id });
            goal.Property(g => g.UserId).HasColumnName("user_id");
            goal.Property(g => g.Id).HasColumnName("id");
            goal.Property(g => g.CreatedAt).HasColumnName("created_at");
            goal.Property(g => g.EffectiveAt).HasColumnName("effective_at");
            goal.Property(g => g.SchemaVersion).HasColumnName("schema_version");
            goal.Property(g => g.Revision).HasColumnName("revision");
            goal.Property(g => g.DeletedAt).HasColumnName("deleted_at");
            goal.Property(g => g.EffectiveFrom).HasColumnName("effective_from");
            goal.Property(g => g.Grams).HasColumnName("grams");
            goal.HasIndex(g => new { g.UserId, g.Revision }).HasDatabaseName("ix_protein_goals_user_id_revision");
            goal.HasIndex(g => new { g.UserId, g.EffectiveFrom }).HasDatabaseName("ux_protein_goals_natural_key").IsUnique();
            goal.HasOne<AppUser>().WithMany().HasForeignKey(g => g.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<SavedFoodAlias>(alias =>
        {
            alias.ToTable("saved_food_aliases", ActivitySchema);
            alias.HasKey(a => new { a.UserId, a.AliasId });
            alias.Property(a => a.UserId).HasColumnName("user_id");
            alias.Property(a => a.AliasId).HasColumnName("alias_id");
            alias.Property(a => a.CanonicalId).HasColumnName("canonical_id");
            alias.HasOne<AppUser>().WithMany().HasForeignKey(a => a.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<ProteinGoalAlias>(alias =>
        {
            alias.ToTable("protein_goal_aliases", ActivitySchema);
            alias.HasKey(a => new { a.UserId, a.AliasId });
            alias.Property(a => a.UserId).HasColumnName("user_id");
            alias.Property(a => a.AliasId).HasColumnName("alias_id");
            alias.Property(a => a.CanonicalId).HasColumnName("canonical_id");
            alias.HasOne<AppUser>().WithMany().HasForeignKey(a => a.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<SyncState>(state =>
        {
            state.ToTable("sync_state", ActivitySchema);
            state.HasKey(s => s.UserId);
            state.Property(s => s.UserId).HasColumnName("user_id");
            state.Property(s => s.Revision).HasColumnName("revision").HasDefaultValue(0L);
            state.Property(s => s.NoticeAckAt).HasColumnName("notice_ack_at");
            state.HasOne<AppUser>().WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Cascade);
        });
    }

    private static string SqlList(IEnumerable<string> values) => string.Join(", ", values.Select(v => $"'{v}'"));
}
