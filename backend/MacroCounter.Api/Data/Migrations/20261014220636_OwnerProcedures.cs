using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MacroCounter.Api.Data.Migrations
{
    /// <summary>
    /// The owner's account procedures and read-only views (contracts/owner-procedures.md). Run by the owner
    /// in the Supabase SQL editor; the app role can neither call nor read anything in macro_admin.
    /// </summary>
    public partial class OwnerProcedures : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                -- Looks a user up the way the owner types it (trimmed, any case); unknown names are an error.
                create or replace function macro_admin.find_user(p_username text) returns uuid
                language plpgsql stable
                set search_path = macro, extensions, public, pg_temp
                as $fn$
                declare
                  v_name text := lower(btrim(coalesce(p_username, '')));
                  v_id uuid;
                begin
                  select id into v_id from macro.users where username = v_name;
                  if v_id is null then
                    raise exception 'no such user: %', v_name using errcode = 'P0002';
                  end if;
                  return v_id;
                end
                $fn$;

                -- A 100-bit one-time code in the invite format, XXXX-XXXX-XXXX-XXXX-XXXX (research R6).
                create or replace function macro_admin.new_temporary_code() returns text
                language plpgsql volatile
                set search_path = macro, extensions, public, pg_temp
                as $fn$
                declare
                  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
                  v_bytes bytea := gen_random_bytes(20);
                  v_code text := '';
                begin
                  for i in 0..19 loop
                    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
                  end loop;
                  return substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4)
                      || '-' || substr(v_code, 13, 4) || '-' || substr(v_code, 17, 4);
                end
                $fn$;

                create or replace function macro_admin.new_security_stamp() returns text
                language sql volatile
                set search_path = macro, extensions, public, pg_temp
                as $fn$ select upper(encode(gen_random_bytes(20), 'hex')) $fn$;

                create or replace function macro_admin.owner_audit(p_event text, p_user uuid) returns void
                language sql volatile
                set search_path = macro, extensions, public, pg_temp
                as $fn$
                  insert into macro.audit_events (event_type, outcome, user_id, actor) values (p_event, 'success', p_user, 'owner')
                $fn$;

                -- Lost password or authenticator: wipe the credentials and sessions, issue a new code (US2.5).
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
                  perform macro_admin.owner_audit('account_reset', v_id);
                  return v_code;
                end
                $fn$;

                -- Access ends at the person's next request (SC-005). Rows are kept so the audit trail stays whole.
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
                  perform macro_admin.owner_audit('account_disabled', v_id);
                end
                $fn$;

                create or replace function macro_admin.enable_user(p_username text) returns void
                language plpgsql volatile
                set search_path = macro, extensions, public, pg_temp
                as $fn$
                declare
                  v_id uuid := macro_admin.find_user(p_username);
                begin
                  update macro.users set disabled_at = null, concurrency_stamp = gen_random_uuid()::text where id = v_id;
                  perform macro_admin.owner_audit('account_enabled', v_id);
                end
                $fn$;

                create or replace function macro_admin.unlock_user(p_username text) returns void
                language plpgsql volatile
                set search_path = macro, extensions, public, pg_temp
                as $fn$
                declare
                  v_id uuid := macro_admin.find_user(p_username);
                begin
                  update macro.users set lockout_end = null, access_failed_count = 0,
                                         concurrency_stamp = gen_random_uuid()::text
                  where id = v_id;
                  perform macro_admin.owner_audit('account_unlocked', v_id);
                end
                $fn$;

                -- Signs the person out everywhere without disabling them.
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
                  update macro.users set security_stamp = macro_admin.new_security_stamp(),
                                         concurrency_stamp = gen_random_uuid()::text
                  where id = v_id;
                  perform macro_admin.owner_audit('session_revoked', v_id);
                  return v_count;
                end
                $fn$;

                -- Who exists, and in which state of the data-model.md state machine.
                create or replace view macro_admin.users_overview with (security_invoker = true) as
                select u.username,
                       u.role,
                       case
                         when u.disabled_at is not null then 'disabled'
                         when u.password_hash is not null and u.two_factor_enabled and u.ai_notice_ack_at is not null then 'active'
                         when u.setup_expires_at is null or (u.password_hash is null and u.temp_code_hash is null) then 'incomplete'
                         when u.setup_expires_at <= now() then 'expired'
                         when u.password_hash is null then 'invited'
                         else 'setup'
                       end as state,
                       u.created_at,
                       u.last_sign_in_at,
                       case when u.lockout_end > now() then u.lockout_end end as locked_until,
                       (select count(*) from macro.sessions s
                        where s.user_id = u.id and s.absolute_expires_at > now()) as active_sessions
                from macro.users u;

                -- Today's AI lookups (UTC days, as the quota uses), plus the month so far and the ceiling flag.
                -- The limits themselves are app configuration (Limits:Ai in appsettings), not stored here.
                create or replace view macro_admin.ai_usage_today with (security_invoker = true) as
                with today as (select (now() at time zone 'utc')::date as day)
                select u.username,
                       coalesce(d.count, 0) as user_today,
                       coalesce(g.count, 0) as global_today,
                       (select coalesce(sum(m.count), 0) from macro.ai_usage_global_daily m
                        where m.day >= date_trunc('month', t.day)::date and m.day <= t.day) as global_month,
                       g.ceiling_hit_at
                from macro.users u
                cross join today t
                left join macro.ai_usage_daily d on d.user_id = u.id and d.day = t.day
                left join macro.ai_usage_global_daily g on g.day = t.day;

                revoke all on all functions in schema macro_admin from public;
                revoke all on all tables in schema macro_admin from public;
                """);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                drop view if exists macro_admin.ai_usage_today;
                drop view if exists macro_admin.users_overview;
                drop function if exists macro_admin.revoke_sessions(text);
                drop function if exists macro_admin.unlock_user(text);
                drop function if exists macro_admin.enable_user(text);
                drop function if exists macro_admin.disable_user(text);
                drop function if exists macro_admin.reset_user(text);
                drop function if exists macro_admin.owner_audit(text, uuid);
                drop function if exists macro_admin.new_security_stamp();
                drop function if exists macro_admin.new_temporary_code();
                drop function if exists macro_admin.find_user(text);
                """);
        }
    }
}
