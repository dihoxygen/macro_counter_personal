using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MacroCounter.Api.Data.Migrations
{
    /// <summary>
    /// macro_admin.invite_user: the only way an account is created (FR-002, FR-003). Run by the owner in the
    /// Supabase SQL editor; the app role cannot call it (contracts/owner-procedures.md).
    /// </summary>
    public partial class InviteUser : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                create or replace function macro_admin.invite_user(p_username text, p_role text default 'user') returns text
                language plpgsql
                set search_path = macro, extensions, public, pg_temp
                as $fn$
                declare
                  v_name text := lower(btrim(coalesce(p_username, '')));
                  -- 32 symbols without I, O, 0 and 1: 5 bits each, 20 symbols = 100 bits (research R6).
                  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
                  v_bytes bytea := gen_random_bytes(20);
                  v_code text := '';
                  v_id uuid := gen_random_uuid();
                begin
                  if v_name !~ '^[a-z0-9._-]{3,32}$' then
                    raise exception 'invalid username: % (use 3-32 of a-z 0-9 . _ -)', v_name using errcode = '22023';
                  end if;
                  if p_role is null or p_role not in ('owner', 'user') then
                    raise exception 'invalid role: %', p_role using errcode = '22023';
                  end if;
                  if exists (select 1 from macro.users where username = v_name) then
                    raise exception 'user already exists: %', v_name using errcode = '23505';
                  end if;
                  if p_role = 'owner' and exists (select 1 from macro.users where role = 'owner') then
                    raise exception 'an owner already exists' using errcode = '23505';
                  end if;

                  -- 256 is a multiple of 32, so "byte % 32" is uniform.
                  for i in 0..19 loop
                    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
                  end loop;

                  insert into macro.users (id, username, normalized_username, role, temp_code_hash, setup_expires_at,
                                           security_stamp, concurrency_stamp, lockout_enabled, two_factor_enabled,
                                           access_failed_count, created_at)
                  values (v_id, v_name, upper(v_name), p_role, sha256(convert_to(v_code, 'UTF8')), now() + interval '72 hours',
                          upper(encode(gen_random_bytes(20), 'hex')), gen_random_uuid()::text, true, false,
                          0, now());

                  insert into macro.audit_events (event_type, outcome, user_id, actor)
                  values ('account_invited', 'success', v_id, 'owner');

                  -- Shown once; only the hash is stored.
                  return substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4)
                      || '-' || substr(v_code, 13, 4) || '-' || substr(v_code, 17, 4);
                end
                $fn$;

                revoke all on function macro_admin.invite_user(text, text) from public;
                """);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("drop function if exists macro_admin.invite_user(text, text);");
        }
    }
}
