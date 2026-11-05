using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MacroCounter.Api.Data.Migrations
{
    /// <summary>
    /// Activity data on the server (specs/007-cross-device-sync/data-model.md): the macro_data schema, row-level
    /// security pinned to the transaction's user, grants with no delete and an insert-only history, new audit
    /// codes, and the 90-day purge of entry versions (research R10, R14, R16).
    /// </summary>
    public partial class ActivityData : Migration
    {
        private const string LockDownSchema = """
            revoke all on schema macro_data from public;
            revoke all on all tables in schema macro_data from public;

            do $$
            begin
              -- Supabase-only roles; absent on a plain PostgreSQL server.
              if exists (select 1 from pg_roles where rolname = 'anon') then
                execute 'revoke all on schema macro_data from anon, authenticated';
                execute 'revoke all on all tables in schema macro_data from anon, authenticated';
              end if;
            end $$;

            alter table macro_data.log_entries enable row level security;
            alter table macro_data.entry_versions enable row level security;
            alter table macro_data.saved_foods enable row level security;
            alter table macro_data.protein_goals enable row level security;
            alter table macro_data.saved_food_aliases enable row level security;
            alter table macro_data.protein_goal_aliases enable row level security;
            alter table macro_data.sync_state enable row level security;
            """;

        /// <summary>
        /// macro_admin.grant_app_role as defined in TwoStepSignIn, plus macro_data: no delete anywhere, an insert-only
        /// history, and a policy pinning every row to macro.user_id. Connections are pooled, so the setting can be an
        /// empty string instead of absent; nullif keeps that case at "no rows" rather than a cast error.
        /// </summary>
        private const string GrantAppRole = """
            create or replace function macro_admin.grant_app_role(p_role name) returns void
            language plpgsql
            set search_path = macro, extensions, public, pg_temp
            as $fn$
            declare
              t text;
              policy text := 'app_access_' || p_role;
            begin
              execute format('grant usage on schema macro to %I', p_role);

              -- users: read, and update only the sign-in bookkeeping. Never insert, delete, rename,
              -- change role or re-enable (no grant on username, normalized_username, role, disabled_at, created_at, id).
              execute format('grant select on macro.users to %I', p_role);
              execute format('grant update (password_hash, temp_code_hash, setup_expires_at, two_factor_enabled, '
                'totp_last_code, totp_last_used_at, ai_notice_ack_at, security_stamp, concurrency_stamp, '
                'access_failed_count, lockout_enabled, lockout_end, last_sign_in_at) on macro.users to %I', p_role);

              foreach t in array array['user_tokens', 'sessions', 'ai_usage_daily', 'ai_usage_global_daily'] loop
                execute format('grant select, insert, update, delete on macro.%I to %I', t, p_role);
              end loop;
              -- Remembered devices: no update, so an expiry can never be extended (006 threat T8).
              execute format('grant select, insert, delete on macro.trusted_devices to %I', p_role);
              execute format('grant select on macro.user_claims, macro.user_logins to %I', p_role);
              execute format('grant select, insert on macro.data_protection_keys to %I', p_role);
              execute format('grant insert on macro.audit_events to %I', p_role);
              execute format('grant usage on all sequences in schema macro to %I', p_role);

              -- RLS: let the app role through on everything it is granted; audit is insert-only.
              foreach t in array array['users', 'user_tokens', 'user_claims', 'user_logins', 'sessions',
                                       'ai_usage_daily', 'ai_usage_global_daily', 'data_protection_keys', 'trusted_devices'] loop
                execute format('drop policy if exists %I on macro.%I', policy, t);
                execute format('create policy %I on macro.%I for all to %I using (true) with check (true)', policy, t, p_role);
              end loop;
              execute format('drop policy if exists %I on macro.audit_events', policy);
              execute format('create policy %I on macro.audit_events for insert to %I with check (true)', policy, p_role);

              -- Activity data (007): deleting is a tombstone update, and history is written once (R10, R14).
              execute format('grant usage on schema macro_data to %I', p_role);
              foreach t in array array['log_entries', 'saved_foods', 'protein_goals', 'saved_food_aliases',
                                       'protein_goal_aliases', 'sync_state'] loop
                execute format('grant select, insert, update on macro_data.%I to %I', t, p_role);
              end loop;
              execute format('grant select, insert on macro_data.entry_versions to %I', p_role);

              foreach t in array array['log_entries', 'entry_versions', 'saved_foods', 'protein_goals', 'saved_food_aliases',
                                       'protein_goal_aliases', 'sync_state'] loop
                execute format('drop policy if exists %I on macro_data.%I', policy, t);
                execute format('create policy %I on macro_data.%I for all to %I '
                  'using (user_id = nullif(current_setting(''macro.user_id'', true), '''')::uuid) '
                  'with check (user_id = nullif(current_setting(''macro.user_id'', true), '''')::uuid)', policy, t, p_role);
              end loop;
            end
            $fn$;

            revoke all on function macro_admin.grant_app_role(name) from public;
            """;

        /// <summary>
        /// Removes an account and everything it owns (FR-016). The audit row comes first, while the user still exists; the
        /// cascade then removes the account's rows and leaves its audit history, unlinked.
        /// </summary>
        private const string DeleteUser = """
            create or replace function macro_admin.delete_user(p_username text) returns void
            language plpgsql volatile
            set search_path = macro, extensions, public, pg_temp
            as $fn$
            declare
              v_id uuid := macro_admin.find_user(p_username);
            begin
              perform macro_admin.owner_audit('user_deleted', v_id);
              delete from macro.users where id = v_id;
            end
            $fn$;

            revoke all on function macro_admin.delete_user(text) from public;
            """;

        /// <summary>purge_expired as defined in TwoStepSignIn, plus entry versions after 90 days (FR-027).</summary>
        private const string PurgeExpired = """
            create or replace function macro_admin.purge_expired() returns int
            language plpgsql volatile
            set search_path = macro, extensions, public, pg_temp
            as $fn$
            declare
              v_total int := 0;
              v_count int;
            begin
              delete from macro.audit_events where occurred_at < now() - interval '180 days';
              get diagnostics v_count = row_count; v_total := v_total + v_count;
              delete from macro.sessions where absolute_expires_at < now();
              get diagnostics v_count = row_count; v_total := v_total + v_count;
              delete from macro.trusted_devices where expires_at < now();
              get diagnostics v_count = row_count; v_total := v_total + v_count;
              delete from macro.ai_usage_daily where day < current_date - 400;
              get diagnostics v_count = row_count; v_total := v_total + v_count;
              delete from macro.ai_usage_global_daily where day < current_date - 400;
              get diagnostics v_count = row_count; v_total := v_total + v_count;
              delete from macro_data.entry_versions where replaced_at < now() - interval '90 days';
              get diagnostics v_count = row_count; v_total := v_total + v_count;
              return v_total;
            end
            $fn$;
            """;

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_audit_events_event_type",
                schema: "macro",
                table: "audit_events");

            migrationBuilder.DropCheckConstraint(
                name: "ck_audit_events_reason",
                schema: "macro",
                table: "audit_events");

            migrationBuilder.EnsureSchema(
                name: "macro_data");

            migrationBuilder.CreateTable(
                name: "entry_versions",
                schema: "macro_data",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    entry_id = table.Column<Guid>(type: "uuid", nullable: false),
                    change_type = table.Column<string>(type: "text", nullable: false),
                    replaced_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    effective_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    schema_version = table.Column<int>(type: "integer", nullable: false),
                    revision = table.Column<long>(type: "bigint", nullable: false),
                    day_key = table.Column<DateOnly>(type: "date", nullable: false),
                    logged_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    name = table.Column<string>(type: "text", nullable: false),
                    quantity_amount = table.Column<double>(type: "double precision", nullable: false),
                    quantity_unit = table.Column<string>(type: "text", nullable: false),
                    kcal = table.Column<double>(type: "double precision", nullable: false),
                    protein_g = table.Column<double>(type: "double precision", nullable: false),
                    carbs_g = table.Column<double>(type: "double precision", nullable: false),
                    fat_g = table.Column<double>(type: "double precision", nullable: false),
                    source = table.Column<string>(type: "text", nullable: false),
                    saved_food_id = table.Column<Guid>(type: "uuid", nullable: true),
                    meal_category = table.Column<string>(type: "text", nullable: true),
                    restored_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_entry_versions", x => new { x.user_id, x.id });
                    table.CheckConstraint("ck_entry_versions_category", "meal_category is null or meal_category in ('breakfast', 'lunch', 'dinner', 'snacks')");
                    table.CheckConstraint("ck_entry_versions_change_type", "change_type in ('edit', 'delete', 'restore')");
                    table.CheckConstraint("ck_entry_versions_kcal", "kcal between 0 and 100000");
                    table.CheckConstraint("ck_entry_versions_macros", "protein_g between 0 and 10000 and carbs_g between 0 and 10000 and fat_g between 0 and 10000");
                    table.CheckConstraint("ck_entry_versions_name", "char_length(name) <= 120 and btrim(name, E' \\t\\n\\r') <> ''");
                    table.CheckConstraint("ck_entry_versions_quantity", "quantity_amount between 0 and 100000");
                    table.CheckConstraint("ck_entry_versions_source", "source in ('ai', 'ai-edited', 'manual')");
                    table.CheckConstraint("ck_entry_versions_unit", "quantity_unit in ('g', 'ml', 'serving')");
                    table.ForeignKey(
                        name: "FK_entry_versions_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "macro",
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "log_entries",
                schema: "macro_data",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    effective_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    schema_version = table.Column<int>(type: "integer", nullable: false),
                    revision = table.Column<long>(type: "bigint", nullable: false),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    day_key = table.Column<DateOnly>(type: "date", nullable: true),
                    logged_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    name = table.Column<string>(type: "text", nullable: true),
                    quantity_amount = table.Column<double>(type: "double precision", nullable: true),
                    quantity_unit = table.Column<string>(type: "text", nullable: true),
                    kcal = table.Column<double>(type: "double precision", nullable: true),
                    protein_g = table.Column<double>(type: "double precision", nullable: true),
                    carbs_g = table.Column<double>(type: "double precision", nullable: true),
                    fat_g = table.Column<double>(type: "double precision", nullable: true),
                    source = table.Column<string>(type: "text", nullable: true),
                    saved_food_id = table.Column<Guid>(type: "uuid", nullable: true),
                    meal_category = table.Column<string>(type: "text", nullable: true),
                    version_id = table.Column<Guid>(type: "uuid", nullable: true),
                    restored_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_log_entries", x => new { x.user_id, x.id });
                    table.CheckConstraint("ck_log_entries_category", "meal_category is null or meal_category in ('breakfast', 'lunch', 'dinner', 'snacks')");
                    table.CheckConstraint("ck_log_entries_kcal", "kcal is null or kcal between 0 and 100000");
                    table.CheckConstraint("ck_log_entries_live", "deleted_at is not null or (day_key is not null and logged_at is not null and name is not null and quantity_amount is not null and quantity_unit is not null and kcal is not null and protein_g is not null and carbs_g is not null and fat_g is not null and source is not null and version_id is not null)");
                    table.CheckConstraint("ck_log_entries_macros", "protein_g is null or carbs_g is null or fat_g is null or (protein_g between 0 and 10000 and carbs_g between 0 and 10000 and fat_g between 0 and 10000)");
                    table.CheckConstraint("ck_log_entries_name", "name is null or (char_length(name) <= 120 and btrim(name, E' \\t\\n\\r') <> '')");
                    table.CheckConstraint("ck_log_entries_quantity", "quantity_amount is null or quantity_amount between 0 and 100000");
                    table.CheckConstraint("ck_log_entries_source", "source is null or source in ('ai', 'ai-edited', 'manual')");
                    table.CheckConstraint("ck_log_entries_tombstone", "deleted_at is null or (day_key is null and logged_at is null and name is null and quantity_amount is null and quantity_unit is null and kcal is null and protein_g is null and carbs_g is null and fat_g is null and source is null and saved_food_id is null and meal_category is null and version_id is null)");
                    table.CheckConstraint("ck_log_entries_unit", "quantity_unit is null or quantity_unit in ('g', 'ml', 'serving')");
                    table.ForeignKey(
                        name: "FK_log_entries_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "macro",
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "protein_goal_aliases",
                schema: "macro_data",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    alias_id = table.Column<Guid>(type: "uuid", nullable: false),
                    canonical_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_protein_goal_aliases", x => new { x.user_id, x.alias_id });
                    table.ForeignKey(
                        name: "FK_protein_goal_aliases_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "macro",
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "protein_goals",
                schema: "macro_data",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    effective_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    schema_version = table.Column<int>(type: "integer", nullable: false),
                    revision = table.Column<long>(type: "bigint", nullable: false),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    effective_from = table.Column<DateOnly>(type: "date", nullable: false),
                    grams = table.Column<double>(type: "double precision", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_protein_goals", x => new { x.user_id, x.id });
                    table.CheckConstraint("ck_protein_goals_grams", "grams is null or (grams > 0 and grams <= 10000)");
                    table.ForeignKey(
                        name: "FK_protein_goals_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "macro",
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "saved_food_aliases",
                schema: "macro_data",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    alias_id = table.Column<Guid>(type: "uuid", nullable: false),
                    canonical_id = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_saved_food_aliases", x => new { x.user_id, x.alias_id });
                    table.ForeignKey(
                        name: "FK_saved_food_aliases_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "macro",
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "saved_foods",
                schema: "macro_data",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    effective_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    schema_version = table.Column<int>(type: "integer", nullable: false),
                    revision = table.Column<long>(type: "bigint", nullable: false),
                    deleted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    name = table.Column<string>(type: "text", nullable: false),
                    normalized_name = table.Column<string>(type: "text", nullable: false),
                    ref_amount = table.Column<double>(type: "double precision", nullable: false),
                    ref_unit = table.Column<string>(type: "text", nullable: false),
                    kcal = table.Column<double>(type: "double precision", nullable: false),
                    protein_g = table.Column<double>(type: "double precision", nullable: false),
                    carbs_g = table.Column<double>(type: "double precision", nullable: false),
                    fat_g = table.Column<double>(type: "double precision", nullable: false),
                    source = table.Column<string>(type: "text", nullable: false),
                    last_used_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_saved_foods", x => new { x.user_id, x.id });
                    table.CheckConstraint("ck_saved_foods_kcal", "kcal between 0 and 100000");
                    table.CheckConstraint("ck_saved_foods_macros", "protein_g between 0 and 10000 and carbs_g between 0 and 10000 and fat_g between 0 and 10000");
                    table.CheckConstraint("ck_saved_foods_name", "char_length(name) <= 120 and btrim(name, E' \\t\\n\\r') <> ''");
                    table.CheckConstraint("ck_saved_foods_quantity", "ref_amount between 0 and 100000");
                    table.CheckConstraint("ck_saved_foods_source", "source in ('ai', 'ai-edited', 'manual')");
                    table.CheckConstraint("ck_saved_foods_unit", "ref_unit in ('g', 'ml', 'serving')");
                    table.ForeignKey(
                        name: "FK_saved_foods_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "macro",
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "sync_state",
                schema: "macro_data",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    revision = table.Column<long>(type: "bigint", nullable: false, defaultValue: 0L),
                    notice_ack_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_sync_state", x => x.user_id);
                    table.ForeignKey(
                        name: "FK_sync_state_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "macro",
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.AddCheckConstraint(
                name: "ck_audit_events_event_type",
                schema: "macro",
                table: "audit_events",
                sql: "event_type in ('sign_in', 'sign_in_locked', 'rate_limited', 'sign_out', 'sign_out_everywhere', 'session_revoked', 'setup_started', 'password_set', 'password_rejected', 'totp_enrolled', 'totp_failed', 'ai_notice_acknowledged', 'account_invited', 'account_reset', 'account_disabled', 'account_enabled', 'account_unlocked', 'quota_exceeded', 'ceiling_hit', 'password_accepted', 'device_remembered', 'device_forgotten', 'sync_rejected', 'user_deleted')");

            migrationBuilder.AddCheckConstraint(
                name: "ck_audit_events_reason",
                schema: "macro",
                table: "audit_events",
                sql: "reason is null or reason in ('bad_credentials', 'locked', 'rate_limited', 'account_incomplete', 'account_disabled', 'setup_expired', 'breach_check_unavailable', 'quota_user_daily', 'quota_global_daily', 'quota_global_monthly', 'invalid_code', 'remembered_device', 'invite_code', 'invalid_record', 'day_key_changed', 'too_many_changes', 'unknown_schema_version', 'sync')");

            migrationBuilder.CreateIndex(
                name: "ix_entry_versions_replaced_at",
                schema: "macro_data",
                table: "entry_versions",
                column: "replaced_at");

            migrationBuilder.CreateIndex(
                name: "ix_entry_versions_user_id_entry_id",
                schema: "macro_data",
                table: "entry_versions",
                columns: new[] { "user_id", "entry_id" });

            migrationBuilder.CreateIndex(
                name: "ix_entry_versions_user_id_revision",
                schema: "macro_data",
                table: "entry_versions",
                columns: new[] { "user_id", "revision" });

            migrationBuilder.CreateIndex(
                name: "ix_log_entries_user_id_day_key",
                schema: "macro_data",
                table: "log_entries",
                columns: new[] { "user_id", "day_key" });

            migrationBuilder.CreateIndex(
                name: "ix_log_entries_user_id_revision",
                schema: "macro_data",
                table: "log_entries",
                columns: new[] { "user_id", "revision" });

            migrationBuilder.CreateIndex(
                name: "ix_protein_goals_user_id_revision",
                schema: "macro_data",
                table: "protein_goals",
                columns: new[] { "user_id", "revision" });

            migrationBuilder.CreateIndex(
                name: "ux_protein_goals_natural_key",
                schema: "macro_data",
                table: "protein_goals",
                columns: new[] { "user_id", "effective_from" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_saved_foods_user_id_revision",
                schema: "macro_data",
                table: "saved_foods",
                columns: new[] { "user_id", "revision" });

            migrationBuilder.CreateIndex(
                name: "ux_saved_foods_natural_key",
                schema: "macro_data",
                table: "saved_foods",
                columns: new[] { "user_id", "normalized_name", "ref_unit" },
                unique: true,
                filter: "deleted_at is null");

            migrationBuilder.Sql(LockDownSchema);
            migrationBuilder.Sql(GrantAppRole);
            migrationBuilder.Sql(PurgeExpired);
            migrationBuilder.Sql(DeleteUser);
            // Roles granted before this migration (production's macro_app) get the new tables too.
            migrationBuilder.Sql(TwoStepSignIn.RegrantExistingAppRoles);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("drop function if exists macro_admin.delete_user(text);");
            migrationBuilder.Sql(TwoStepSignIn.OwnerProcedures(withTrustedDevices: true));
            migrationBuilder.Sql(TwoStepSignIn.GrantAppRole(withTrustedDevices: true));
            migrationBuilder.Sql("""
                delete from macro.audit_events
                where event_type in ('sync_rejected', 'user_deleted')
                   or reason in ('invalid_record', 'day_key_changed', 'too_many_changes', 'unknown_schema_version', 'sync');
                """);

            migrationBuilder.DropTable(
                name: "entry_versions",
                schema: "macro_data");

            migrationBuilder.DropTable(
                name: "log_entries",
                schema: "macro_data");

            migrationBuilder.DropTable(
                name: "protein_goal_aliases",
                schema: "macro_data");

            migrationBuilder.DropTable(
                name: "protein_goals",
                schema: "macro_data");

            migrationBuilder.DropTable(
                name: "saved_food_aliases",
                schema: "macro_data");

            migrationBuilder.DropTable(
                name: "saved_foods",
                schema: "macro_data");

            migrationBuilder.DropTable(
                name: "sync_state",
                schema: "macro_data");

            migrationBuilder.Sql("drop schema if exists macro_data");

            migrationBuilder.DropCheckConstraint(
                name: "ck_audit_events_event_type",
                schema: "macro",
                table: "audit_events");

            migrationBuilder.DropCheckConstraint(
                name: "ck_audit_events_reason",
                schema: "macro",
                table: "audit_events");

            migrationBuilder.AddCheckConstraint(
                name: "ck_audit_events_event_type",
                schema: "macro",
                table: "audit_events",
                sql: "event_type in ('sign_in', 'sign_in_locked', 'rate_limited', 'sign_out', 'sign_out_everywhere', 'session_revoked', 'setup_started', 'password_set', 'password_rejected', 'totp_enrolled', 'totp_failed', 'ai_notice_acknowledged', 'account_invited', 'account_reset', 'account_disabled', 'account_enabled', 'account_unlocked', 'quota_exceeded', 'ceiling_hit', 'password_accepted', 'device_remembered', 'device_forgotten')");

            migrationBuilder.AddCheckConstraint(
                name: "ck_audit_events_reason",
                schema: "macro",
                table: "audit_events",
                sql: "reason is null or reason in ('bad_credentials', 'locked', 'rate_limited', 'account_incomplete', 'account_disabled', 'setup_expired', 'breach_check_unavailable', 'quota_user_daily', 'quota_global_daily', 'quota_global_monthly', 'invalid_code', 'remembered_device', 'invite_code')");
        }
    }
}
