using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MacroCounter.Api.Data.Migrations
{
    /// <summary>
    /// Two-step sign-in and Remember User (specs/004-security-qol/data-model.md): the pending-sign-in session kind,
    /// the trusted_devices table (no update grant, so expiry can never be extended), new audit codes, and the owner
    /// procedures that end access now also forget every remembered device.
    /// </summary>
    public partial class TwoStepSignIn : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "ck_sessions_kind",
                schema: "macro",
                table: "sessions");

            migrationBuilder.DropCheckConstraint(
                name: "ck_audit_events_event_type",
                schema: "macro",
                table: "audit_events");

            migrationBuilder.DropCheckConstraint(
                name: "ck_audit_events_reason",
                schema: "macro",
                table: "audit_events");

            migrationBuilder.CreateTable(
                name: "trusted_devices",
                schema: "macro",
                columns: table => new
                {
                    token_hash = table.Column<byte[]>(type: "bytea", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    security_stamp = table.Column<string>(type: "text", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_trusted_devices", x => x.token_hash);
                    table.ForeignKey(
                        name: "FK_trusted_devices_users_user_id",
                        column: x => x.user_id,
                        principalSchema: "macro",
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.AddCheckConstraint(
                name: "ck_sessions_kind",
                schema: "macro",
                table: "sessions",
                sql: "kind in ('setup', 'full', 'mfa')");

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

            migrationBuilder.CreateIndex(
                name: "ix_trusted_devices_user_id",
                schema: "macro",
                table: "trusted_devices",
                column: "user_id");

            migrationBuilder.Sql("""
                alter table macro.trusted_devices enable row level security;
                revoke all on macro.trusted_devices from public;
                """);
            migrationBuilder.Sql(GrantAppRole(withTrustedDevices: true));
            migrationBuilder.Sql(OwnerProcedures(withTrustedDevices: true));
            // Roles granted before this migration (production's macro_app) get the new table too.
            migrationBuilder.Sql(RegrantExistingAppRoles);
        }

        private const string RegrantExistingAppRoles = """
            do $$
            declare r name;
            begin
              for r in select distinct unnest(roles) from pg_policies
                       where schemaname = 'macro' and tablename = 'sessions' and policyname like 'app\_access\_%'
              loop
                perform macro_admin.grant_app_role(r);
              end loop;
            end $$;
            """;

        /// <summary>
        /// macro_admin.grant_app_role as defined in RolesGrantsAndRls, plus select/insert/delete (never update) on
        /// trusted_devices and its RLS policy.
        /// </summary>
        private static string GrantAppRole(bool withTrustedDevices) => $$"""
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
            {{(withTrustedDevices ? """
              -- Remembered devices: no update, so an expiry can never be extended (004 threat T8).
              execute format('grant select, insert, delete on macro.trusted_devices to %I', p_role);
            """ : "")}}
              execute format('grant select on macro.user_claims, macro.user_logins to %I', p_role);
              execute format('grant select, insert on macro.data_protection_keys to %I', p_role);
              execute format('grant insert on macro.audit_events to %I', p_role);
              execute format('grant usage on all sequences in schema macro to %I', p_role);

              -- RLS: let the app role through on everything it is granted; audit is insert-only.
              foreach t in array array['users', 'user_tokens', 'user_claims', 'user_logins', 'sessions',
                                       'ai_usage_daily', 'ai_usage_global_daily', 'data_protection_keys'{{(withTrustedDevices ? ", 'trusted_devices'" : "")}}] loop
                execute format('drop policy if exists %I on macro.%I', policy, t);
                execute format('create policy %I on macro.%I for all to %I using (true) with check (true)', policy, t, p_role);
              end loop;
              execute format('drop policy if exists %I on macro.audit_events', policy);
              execute format('create policy %I on macro.audit_events for insert to %I with check (true)', policy, p_role);
            end
            $fn$;

            revoke all on function macro_admin.grant_app_role(name) from public;
            """;

        /// <summary>
        /// reset_user, disable_user and revoke_sessions as defined in OwnerProcedures, and purge_expired as defined in
        /// AuditRetention, each also deleting remembered devices (004 FR-018).
        /// </summary>
        private static string OwnerProcedures(bool withTrustedDevices)
        {
            var forgetDevices = withTrustedDevices ? "delete from macro.trusted_devices where user_id = v_id;" : "";
            var purgeDevices = withTrustedDevices
                ? """
                  delete from macro.trusted_devices where expires_at < now();
                  get diagnostics v_count = row_count; v_total := v_total + v_count;
                  """
                : "";
            return $$"""
                create or replace function macro_admin.reset_user(p_username text) returns text
                language plpgsql volatile
                set search_path = macro, extensions, public, pg_temp
                as $fn$
                declare
                  v_id uuid := macro_admin.find_user(p_username);
                  v_code text := macro_admin.new_temporary_code();
                begin
                  update macro.users set
                    password_hash = null,
                    temp_code_hash = sha256(convert_to(replace(v_code, '-', ''), 'UTF8')),
                    setup_expires_at = now() + interval '72 hours',
                    two_factor_enabled = false,
                    totp_last_code = null,
                    totp_last_used_at = null,
                    lockout_end = null,
                    access_failed_count = 0,
                    security_stamp = macro_admin.new_security_stamp(),
                    concurrency_stamp = gen_random_uuid()::text
                  where id = v_id;
                  delete from macro.user_tokens where user_id = v_id;
                  delete from macro.sessions where user_id = v_id;
                  {{forgetDevices}}
                  perform macro_admin.owner_audit('account_reset', v_id);
                  return v_code;
                end
                $fn$;

                create or replace function macro_admin.disable_user(p_username text) returns void
                language plpgsql volatile
                set search_path = macro, extensions, public, pg_temp
                as $fn$
                declare
                  v_id uuid := macro_admin.find_user(p_username);
                begin
                  update macro.users set disabled_at = now(), security_stamp = macro_admin.new_security_stamp(),
                                         concurrency_stamp = gen_random_uuid()::text
                  where id = v_id;
                  delete from macro.sessions where user_id = v_id;
                  {{forgetDevices}}
                  perform macro_admin.owner_audit('account_disabled', v_id);
                end
                $fn$;

                create or replace function macro_admin.revoke_sessions(p_username text) returns int
                language plpgsql volatile
                set search_path = macro, extensions, public, pg_temp
                as $fn$
                declare
                  v_id uuid := macro_admin.find_user(p_username);
                  v_count int;
                begin
                  delete from macro.sessions where user_id = v_id;
                  get diagnostics v_count = row_count;
                  {{forgetDevices}}
                  update macro.users set security_stamp = macro_admin.new_security_stamp(),
                                         concurrency_stamp = gen_random_uuid()::text
                  where id = v_id;
                  perform macro_admin.owner_audit('session_revoked', v_id);
                  return v_count;
                end
                $fn$;

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
                  {{purgeDevices}}
                  delete from macro.ai_usage_daily where day < current_date - 400;
                  get diagnostics v_count = row_count; v_total := v_total + v_count;
                  delete from macro.ai_usage_global_daily where day < current_date - 400;
                  get diagnostics v_count = row_count; v_total := v_total + v_count;
                  return v_total;
                end
                $fn$;
                """;
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(OwnerProcedures(withTrustedDevices: false));
            migrationBuilder.Sql(GrantAppRole(withTrustedDevices: false));
            migrationBuilder.Sql("""
                delete from macro.sessions where kind = 'mfa';
                delete from macro.audit_events
                where event_type in ('password_accepted', 'device_remembered', 'device_forgotten')
                   or reason in ('remembered_device', 'invite_code');
                """);

            migrationBuilder.DropTable(
                name: "trusted_devices",
                schema: "macro");

            migrationBuilder.DropCheckConstraint(
                name: "ck_sessions_kind",
                schema: "macro",
                table: "sessions");

            migrationBuilder.DropCheckConstraint(
                name: "ck_audit_events_event_type",
                schema: "macro",
                table: "audit_events");

            migrationBuilder.DropCheckConstraint(
                name: "ck_audit_events_reason",
                schema: "macro",
                table: "audit_events");

            migrationBuilder.AddCheckConstraint(
                name: "ck_sessions_kind",
                schema: "macro",
                table: "sessions",
                sql: "kind in ('setup', 'full')");

            migrationBuilder.AddCheckConstraint(
                name: "ck_audit_events_event_type",
                schema: "macro",
                table: "audit_events",
                sql: "event_type in ('sign_in', 'sign_in_locked', 'rate_limited', 'sign_out', 'sign_out_everywhere', 'session_revoked', 'setup_started', 'password_set', 'password_rejected', 'totp_enrolled', 'totp_failed', 'ai_notice_acknowledged', 'account_invited', 'account_reset', 'account_disabled', 'account_enabled', 'account_unlocked', 'quota_exceeded', 'ceiling_hit')");

            migrationBuilder.AddCheckConstraint(
                name: "ck_audit_events_reason",
                schema: "macro",
                table: "audit_events",
                sql: "reason is null or reason in ('bad_credentials', 'locked', 'rate_limited', 'account_incomplete', 'account_disabled', 'setup_expired', 'breach_check_unavailable', 'quota_user_daily', 'quota_global_daily', 'quota_global_monthly', 'invalid_code')");
        }
    }
}
