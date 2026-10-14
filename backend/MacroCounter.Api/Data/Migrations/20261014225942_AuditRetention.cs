using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MacroCounter.Api.Data.Migrations
{
    /// <summary>
    /// The owner's view of recent audit history and the daily retention purge (FR-026): audit rows for 180 days,
    /// expired sessions, and usage counts older than 400 days. On Supabase the purge is scheduled with pg_cron.
    /// </summary>
    public partial class AuditRetention : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                create or replace view macro_admin.recent_audit with (security_invoker = true) as
                select a.id, a.occurred_at, a.event_type, a.outcome, a.actor, u.username, a.reason, a.source_ip
                from macro.audit_events a
                left join macro.users u on u.id = a.user_id
                where a.occurred_at > now() - interval '30 days'
                order by a.occurred_at desc, a.id desc;

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
                  delete from macro.ai_usage_daily where day < current_date - 400;
                  get diagnostics v_count = row_count; v_total := v_total + v_count;
                  delete from macro.ai_usage_global_daily where day < current_date - 400;
                  get diagnostics v_count = row_count; v_total := v_total + v_count;
                  return v_total;
                end
                $fn$;

                revoke all on function macro_admin.purge_expired() from public;
                revoke all on macro_admin.recent_audit from public;

                -- Supabase: run the purge daily at 03:15 UTC. Plain PostgreSQL has no pg_cron; run it by hand there.
                do $$
                begin
                  if exists (select 1 from pg_extension where extname = 'pg_cron') then
                    perform cron.schedule('macro-purge', '15 3 * * *', 'select macro_admin.purge_expired()');
                  end if;
                end $$;
                """);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                do $$
                begin
                  if exists (select 1 from pg_extension where extname = 'pg_cron') then
                    perform cron.unschedule('macro-purge');
                  end if;
                end $$;
                drop function if exists macro_admin.purge_expired();
                drop view if exists macro_admin.recent_audit;
                """);
        }
    }
}
