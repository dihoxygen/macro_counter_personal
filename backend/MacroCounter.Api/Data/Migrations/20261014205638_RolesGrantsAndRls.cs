using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MacroCounter.Api.Data.Migrations
{
    /// <summary>
    /// Least privilege for the backend's database role, and row-level security (research R12, data-model.md).
    /// The role name is a parameter so the same grants apply to production (macro_app) and per-test roles.
    /// </summary>
    public partial class RolesGrantsAndRls : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                -- On Supabase pgcrypto already lives in "extensions"; locally it lands in the default schema.
                create extension if not exists pgcrypto;

                create schema if not exists macro_admin;

                -- Nothing in either schema is reachable by default.
                revoke all on schema macro from public;
                revoke all on schema macro_admin from public;
                revoke all on all tables in schema macro from public;
                alter default privileges in schema macro_admin revoke execute on functions from public;

                do $$
                begin
                  -- Supabase-only roles; absent on a plain PostgreSQL server.
                  if exists (select 1 from pg_roles where rolname = 'anon') then
                    execute 'revoke all on schema macro, macro_admin from anon, authenticated';
                    execute 'revoke all on all tables in schema macro from anon, authenticated';
                  end if;
                end $$;

                -- RLS on every table. Only the app role gets policies (created by grant_app_role), so any
                -- other role, including Supabase's anon/authenticated, sees zero rows even with a grant.
                alter table macro.users enable row level security;
                alter table macro.user_tokens enable row level security;
                alter table macro.user_claims enable row level security;
                alter table macro.user_logins enable row level security;
                alter table macro.sessions enable row level security;
                alter table macro.ai_usage_daily enable row level security;
                alter table macro.ai_usage_global_daily enable row level security;
                alter table macro.audit_events enable row level security;
                alter table macro.data_protection_keys enable row level security;

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
                  execute format('grant select on macro.user_claims, macro.user_logins to %I', p_role);
                  execute format('grant select, insert on macro.data_protection_keys to %I', p_role);
                  execute format('grant insert on macro.audit_events to %I', p_role);
                  execute format('grant usage on all sequences in schema macro to %I', p_role);

                  -- RLS: let the app role through on everything it is granted; audit is insert-only.
                  foreach t in array array['users', 'user_tokens', 'user_claims', 'user_logins', 'sessions',
                                           'ai_usage_daily', 'ai_usage_global_daily', 'data_protection_keys'] loop
                    execute format('drop policy if exists %I on macro.%I', policy, t);
                    execute format('create policy %I on macro.%I for all to %I using (true) with check (true)', policy, t, p_role);
                  end loop;
                  execute format('drop policy if exists %I on macro.audit_events', policy);
                  execute format('create policy %I on macro.audit_events for insert to %I with check (true)', policy, p_role);
                end
                $fn$;

                revoke all on function macro_admin.grant_app_role(name) from public;
                """);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                drop function if exists macro_admin.grant_app_role(name);
                alter table macro.users disable row level security;
                alter table macro.user_tokens disable row level security;
                alter table macro.user_claims disable row level security;
                alter table macro.user_logins disable row level security;
                alter table macro.sessions disable row level security;
                alter table macro.ai_usage_daily disable row level security;
                alter table macro.ai_usage_global_daily disable row level security;
                alter table macro.audit_events disable row level security;
                alter table macro.data_protection_keys disable row level security;
                """);
        }
    }
}
