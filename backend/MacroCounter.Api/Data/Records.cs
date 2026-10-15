namespace MacroCounter.Api.Data;

// Server-side records other than the user (data-model.md). Column names are mapped in IdentityDbContext.

/// <summary>A signed-in (or setting-up) session; the cookie holds only the key whose SHA-256 is stored here.</summary>
public sealed class SessionRecord
{
    public const string SetupKind = "setup";
    public const string FullKind = "full";

    public required byte[] KeyHash { get; set; }
    public Guid UserId { get; set; }
    public required string Kind { get; set; }
    public required string SecurityStamp { get; set; }
    public required byte[] Ticket { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset LastSeenAt { get; set; }
    public DateTimeOffset AbsoluteExpiresAt { get; set; }
    public short SetupFailedCodes { get; set; }
}

public sealed class AiUsageDaily
{
    public Guid UserId { get; set; }
    public DateOnly Day { get; set; }
    public int Count { get; set; }
}

public sealed class AiUsageGlobalDaily
{
    public DateOnly Day { get; set; }
    public int Count { get; set; }
    public DateTimeOffset? CeilingHitAt { get; set; }
}

/// <summary>Mapped only so migrations create the table; rows are written with raw SQL by AuditLog (insert-only role).</summary>
public sealed class AuditEventRecord
{
    public long Id { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
    public required string EventType { get; set; }
    public required string Outcome { get; set; }
    public Guid? UserId { get; set; }
    public required string Actor { get; set; }
    public System.Net.IPAddress? SourceIp { get; set; }
    public string? Reason { get; set; }
}
