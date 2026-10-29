using MacroCounter.Api.Audit;
using Microsoft.Extensions.Options;
using Npgsql;

namespace MacroCounter.Api.Usage;

public static class QuotaScopes
{
    public const string UserDaily = "user_daily";
    public const string GlobalDaily = "global_daily";
    public const string GlobalMonthly = "global_monthly";
}

public abstract record QuotaResult
{
    public sealed record Reserved : QuotaResult;

    public sealed record Exceeded(string Scope, DateTimeOffset ResetAt) : QuotaResult;
}

/// <summary>
/// Reserves one AI lookup before Claude is called (research R8). One transaction locks today's global row
/// first, so concurrent reservations take turns and the limits can never be overshot (SC-008). A reservation
/// is never refunded: a failed call may still have been billed.
/// </summary>
public sealed class AiQuotaService(
    NpgsqlDataSource dataSource,
    IOptions<LimitsOptions> limits,
    TimeProvider clock,
    IAuditLog audit)
{
    public async Task<QuotaResult> TryReserveAsync(Guid userId, CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow().ToUniversalTime();
        var today = DateOnly.FromDateTime(now.UtcDateTime);
        var monthStart = new DateOnly(today.Year, today.Month, 1);
        var settings = limits.Value.Ai;

        string? exceeded = null;
        await using (var connection = await dataSource.OpenConnectionAsync(cancellationToken))
        await using (var transaction = await connection.BeginTransactionAsync(cancellationToken))
        {
            await Execute(connection, transaction, """
                insert into macro.ai_usage_global_daily (day, count) values ($1, 0) on conflict (day) do nothing
                """, cancellationToken, today);
            var globalToday = (int)(await Scalar(connection, transaction,
                "select count from macro.ai_usage_global_daily where day = $1 for update", cancellationToken, today))!;
            var globalMonth = (long)(await Scalar(connection, transaction, """
                select coalesce(sum(count), 0) from macro.ai_usage_global_daily where day >= $1 and day <= $2
                """, cancellationToken, monthStart, today))!;

            if (globalToday >= settings.GlobalDaily) exceeded = QuotaScopes.GlobalDaily;
            else if (globalMonth >= settings.GlobalMonthly) exceeded = QuotaScopes.GlobalMonthly;
            else
            {
                var counted = await Scalar(connection, transaction, """
                    insert into macro.ai_usage_daily (user_id, day, count) values ($1, $2, 1)
                    on conflict (user_id, day) do update set count = macro.ai_usage_daily.count + 1
                      where macro.ai_usage_daily.count < $3
                    returning count
                    """, cancellationToken, userId, today, settings.PerUserDaily);
                if (counted is null) exceeded = QuotaScopes.UserDaily;
            }

            if (exceeded is null)
            {
                await Execute(connection, transaction,
                    "update macro.ai_usage_global_daily set count = count + 1 where day = $1", cancellationToken, today);
                await transaction.CommitAsync(cancellationToken);
                return new QuotaResult.Reserved();
            }
            await transaction.RollbackAsync(cancellationToken);
        }

        await RecordRefusal(userId, exceeded, today, now, cancellationToken);
        var resetAt = exceeded == QuotaScopes.GlobalMonthly
            ? new DateTimeOffset(monthStart.AddMonths(1).ToDateTime(TimeOnly.MinValue), TimeSpan.Zero)
            : new DateTimeOffset(today.AddDays(1).ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
        return new QuotaResult.Exceeded(exceeded, resetAt);
    }

    private async Task RecordRefusal(Guid userId, string scope, DateOnly today, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var reason = scope switch
        {
            QuotaScopes.GlobalDaily => AuditReason.QuotaGlobalDaily,
            QuotaScopes.GlobalMonthly => AuditReason.QuotaGlobalMonthly,
            _ => AuditReason.QuotaUserDaily,
        };
        await audit.WriteAsync(AuditEvent.QuotaExceeded, AuditOutcome.Failure, userId, reason, null, cancellationToken);
        if (scope == QuotaScopes.UserDaily) return;

        // The owner sees that the overall ceiling was reached (US5.3): flag the day once, and audit that first time.
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var flagged = await Scalar(connection, null, """
            update macro.ai_usage_global_daily set ceiling_hit_at = $2
            where day = $1 and ceiling_hit_at is null
            returning day
            """, cancellationToken, today, now);
        if (flagged is not null)
        {
            await audit.WriteAsync(AuditEvent.CeilingHit, AuditOutcome.Info, null, reason, null, cancellationToken);
        }
    }

    private static async Task Execute(NpgsqlConnection connection, NpgsqlTransaction transaction, string sql,
        CancellationToken cancellationToken, params object[] values)
    {
        await using var command = Command(connection, transaction, sql, values);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task<object?> Scalar(NpgsqlConnection connection, NpgsqlTransaction? transaction, string sql,
        CancellationToken cancellationToken, params object[] values)
    {
        await using var command = Command(connection, transaction, sql, values);
        return await command.ExecuteScalarAsync(cancellationToken);
    }

    private static NpgsqlCommand Command(NpgsqlConnection connection, NpgsqlTransaction? transaction, string sql, object[] values)
    {
        var command = new NpgsqlCommand(sql, connection, transaction);
        foreach (var value in values) command.Parameters.Add(new NpgsqlParameter { Value = value });
        return command;
    }
}
