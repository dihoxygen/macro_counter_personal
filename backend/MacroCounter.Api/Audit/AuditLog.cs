using System.Net;
using System.Text.RegularExpressions;
using Npgsql;
using NpgsqlTypes;

namespace MacroCounter.Api.Audit;

/// <summary>Security-relevant events (FR-024). Stored as snake_case; the database CHECK uses the same list.</summary>
public enum AuditEvent
{
    SignIn,
    SignInLocked,
    RateLimited,
    SignOut,
    SignOutEverywhere,
    SessionRevoked,
    SetupStarted,
    PasswordSet,
    PasswordRejected,
    TotpEnrolled,
    TotpFailed,
    AiNoticeAcknowledged,
    AccountInvited,
    AccountReset,
    AccountDisabled,
    AccountEnabled,
    AccountUnlocked,
    QuotaExceeded,
    CeilingHit,
}

public enum AuditOutcome
{
    Success,
    Failure,
    Info,
}

/// <summary>A closed list of machine codes. Audit rows never carry free text (FR-025).</summary>
public enum AuditReason
{
    BadCredentials,
    Locked,
    RateLimited,
    AccountIncomplete,
    AccountDisabled,
    SetupExpired,
    BreachCheckUnavailable,
    QuotaUserDaily,
    QuotaGlobalDaily,
    QuotaGlobalMonthly,
    InvalidCode,
}

public interface IAuditLog
{
    /// <summary>Records one event. Never throws: a failed write is logged instead (the request carries on).</summary>
    Task WriteAsync(AuditEvent auditEvent, AuditOutcome outcome, Guid? userId, AuditReason? reason, IPAddress? sourceIp,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Writes audit rows on its own connection, so they are kept even when the caller's transaction rolls
/// back. Uses a plain INSERT without RETURNING: the app role may insert audit rows but never read them.
/// </summary>
public sealed partial class AuditLog(NpgsqlDataSource dataSource, ILogger<AuditLog> logger) : IAuditLog
{
    public static readonly IReadOnlyList<string> EventCodes = Codes<AuditEvent>();
    public static readonly IReadOnlyList<string> OutcomeCodes = Codes<AuditOutcome>();
    public static readonly IReadOnlyList<string> ReasonCodes = Codes<AuditReason>();
    public static readonly IReadOnlyList<string> Actors = ["user", "system", "owner"];

    public async Task WriteAsync(AuditEvent auditEvent, AuditOutcome outcome, Guid? userId, AuditReason? reason,
        IPAddress? sourceIp, CancellationToken cancellationToken = default)
    {
        var eventCode = Code(auditEvent);
        try
        {
            await using var command = dataSource.CreateCommand("""
                insert into macro.audit_events (event_type, outcome, user_id, actor, source_ip, reason)
                values ($1, $2, $3, $4, $5, $6)
                """);
            command.Parameters.Add(new NpgsqlParameter { Value = eventCode });
            command.Parameters.Add(new NpgsqlParameter { Value = Code(outcome) });
            command.Parameters.Add(new NpgsqlParameter { Value = (object?)userId ?? DBNull.Value, NpgsqlDbType = NpgsqlDbType.Uuid });
            command.Parameters.Add(new NpgsqlParameter { Value = userId is null ? "system" : "user" });
            command.Parameters.Add(new NpgsqlParameter { Value = (object?)sourceIp ?? DBNull.Value, NpgsqlDbType = NpgsqlDbType.Inet });
            command.Parameters.Add(new NpgsqlParameter
            {
                Value = reason is { } r ? Code(r) : DBNull.Value,
                NpgsqlDbType = NpgsqlDbType.Text,
            });
            // Not tied to the request: an audit row should be written even if the client disconnects.
            await command.ExecuteNonQueryAsync(CancellationToken.None);
        }
        catch (Exception ex) when (ex is NpgsqlException or InvalidOperationException or TimeoutException)
        {
            LogWriteFailed(logger, ex, eventCode);
        }
    }

    public static string Code<T>(T value) where T : struct, Enum => SnakeCase(value.ToString());

    private static List<string> Codes<T>() where T : struct, Enum => [.. Enum.GetValues<T>().Select(Code)];

    private static string SnakeCase(string pascal) => UpperBoundary().Replace(pascal, "_$1").ToLowerInvariant();

    [GeneratedRegex("(?<!^)([A-Z])")]
    private static partial Regex UpperBoundary();

    [LoggerMessage(Level = LogLevel.Error, Message = "Could not write audit event {AuditEvent}.")]
    private static partial void LogWriteFailed(ILogger logger, Exception exception, string auditEvent);
}
