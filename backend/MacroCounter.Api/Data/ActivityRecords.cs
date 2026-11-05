namespace MacroCounter.Api.Data;

// Mapped so migrations create the tables; rows are written with raw SQL by SyncStore (007 research R1).

/// <summary>One log entry. A tombstone keeps only keys and times: its food data lives in a version (R16).</summary>
public sealed class LogEntryRow
{
    public Guid UserId { get; set; }
    public Guid Id { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset EffectiveAt { get; set; }
    public int SchemaVersion { get; set; }
    public long Revision { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    public DateOnly? DayKey { get; set; }
    public DateTimeOffset? LoggedAt { get; set; }
    public string? Name { get; set; }
    public double? QuantityAmount { get; set; }
    public string? QuantityUnit { get; set; }
    public double? Kcal { get; set; }
    public double? ProteinG { get; set; }
    public double? CarbsG { get; set; }
    public double? FatG { get; set; }
    public string? Source { get; set; }
    public Guid? SavedFoodId { get; set; }
    public string? MealCategory { get; set; }
    public Guid? VersionId { get; set; }
    public DateTimeOffset? RestoredAt { get; set; }
}

/// <summary>A replaced state of an entry. Insert-only: <see cref="Id"/> is that state's version id (R14).</summary>
public sealed class EntryVersionRow
{
    public Guid UserId { get; set; }
    public Guid Id { get; set; }
    public Guid EntryId { get; set; }
    public required string ChangeType { get; set; }
    public DateTimeOffset ReplacedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset EffectiveAt { get; set; }
    public int SchemaVersion { get; set; }
    public long Revision { get; set; }
    public DateOnly DayKey { get; set; }
    public DateTimeOffset LoggedAt { get; set; }
    public required string Name { get; set; }
    public double QuantityAmount { get; set; }
    public required string QuantityUnit { get; set; }
    public double Kcal { get; set; }
    public double ProteinG { get; set; }
    public double CarbsG { get; set; }
    public double FatG { get; set; }
    public required string Source { get; set; }
    public Guid? SavedFoodId { get; set; }
    public string? MealCategory { get; set; }
    public DateTimeOffset? RestoredAt { get; set; }
}

public sealed class SavedFoodRow
{
    public Guid UserId { get; set; }
    public Guid Id { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset EffectiveAt { get; set; }
    public int SchemaVersion { get; set; }
    public long Revision { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    public required string Name { get; set; }
    public required string NormalizedName { get; set; }
    public double RefAmount { get; set; }
    public required string RefUnit { get; set; }
    public double Kcal { get; set; }
    public double ProteinG { get; set; }
    public double CarbsG { get; set; }
    public double FatG { get; set; }
    public required string Source { get; set; }
    public DateTimeOffset LastUsedAt { get; set; }
}

public sealed class ProteinGoalRow
{
    public Guid UserId { get; set; }
    public Guid Id { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset EffectiveAt { get; set; }
    public int SchemaVersion { get; set; }
    public long Revision { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    public DateOnly EffectiveFrom { get; set; }
    public double? Grams { get; set; }
}

public sealed class SavedFoodAlias
{
    public Guid UserId { get; set; }
    public Guid AliasId { get; set; }
    public Guid CanonicalId { get; set; }
}

public sealed class ProteinGoalAlias
{
    public Guid UserId { get; set; }
    public Guid AliasId { get; set; }
    public Guid CanonicalId { get; set; }
}

/// <summary>Per-user sync bookkeeping: the revision counter, and when the sync notice was acknowledged (R2, R7).</summary>
public sealed class SyncState
{
    public Guid UserId { get; set; }
    public long Revision { get; set; }
    public DateTimeOffset? NoticeAckAt { get; set; }
}
