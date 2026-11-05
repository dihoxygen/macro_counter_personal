using System.Text.Json;
using MacroCounter.Api.Audit;

namespace MacroCounter.Api.Sync;

public sealed record InvalidChange(int Index, string Reason);

/// <summary>A change that passed validation, with its record parsed.</summary>
public sealed record ValidChange(int Index, SyncChange Change, object? Record);

public sealed record SyncValidation(IReadOnlyList<ValidChange> Changes, IReadOnlyList<InvalidChange> Invalid, bool TooMany);

/// <summary>
/// Checks a whole push against data-model.md "Validation bounds", the same bounds the device checks before pushing
/// (R6). These are looser than the AI limits on purpose: sync must not reject what a user already saved. Failures
/// carry only an index and a fixed code, never a field value (FR-015).
/// </summary>
public static class SyncValidator
{
    public const int MaxChanges = 200;
    public const int KnownSchemaVersion = 1;

    private const double MaxQuantity = 100_000;
    private const double MaxKcal = 100_000;
    private const double MaxMacro = 10_000;
    private const int MaxNameLength = 120;

    public static readonly string InvalidRecord = AuditLog.Code(AuditReason.InvalidRecord);
    public static readonly string UnknownSchemaVersion = AuditLog.Code(AuditReason.UnknownSchemaVersion);

    public static SyncValidation Validate(PushRequest request)
    {
        if (request.Changes.Count > MaxChanges) return new SyncValidation([], [], TooMany: true);

        var valid = new List<ValidChange>(request.Changes.Count);
        var invalid = new List<InvalidChange>();
        for (var index = 0; index < request.Changes.Count; index++)
        {
            var (record, reason) = Check(request.Changes[index]);
            if (reason is null) valid.Add(new ValidChange(index, request.Changes[index], record));
            else invalid.Add(new InvalidChange(index, reason));
        }
        return new SyncValidation(valid, invalid, TooMany: false);
    }

    private static (object? Record, string? Reason) Check(SyncChange change) => (change.Type, change.Op) switch
    {
        ("entry", "delete") => change.DeletedAt is null ? (null, InvalidRecord) : (null, null),
        ("entry", "upsert" or "restore") => Read<LogEntryDto>(change, e => e.Id, IsValid),
        ("food", "upsert") => Read<SavedFoodDto>(change, f => f.Id, IsValid),
        ("goal", "upsert") => Read<ProteinGoalDto>(change, g => g.Id, IsValid),
        ("version", "insert") => Read<EntryVersionDto>(change, v => v.Id, IsValid),
        _ => (null, InvalidRecord),
    };

    private static (object? Record, string? Reason) Read<T>(SyncChange change, Func<T, Guid> id, Func<T, bool> isValid)
        where T : class
    {
        if (change.Record is not { ValueKind: JsonValueKind.Object } json) return (null, InvalidRecord);
        if (json.TryGetProperty("schemaVersion", out var version)
            && version.TryGetInt32(out var number) && number != KnownSchemaVersion)
        {
            return (null, UnknownSchemaVersion);
        }

        T? record;
        try
        {
            record = json.Deserialize<T>(SyncJson.Options);
        }
        catch (JsonException)
        {
            return (null, InvalidRecord);
        }
        return record is not null && id(record) == change.Id && isValid(record) ? (record, null) : (null, InvalidRecord);
    }

    private static bool IsValid(LogEntryDto e) =>
        IsName(e.Name) && IsQuantity(e.Quantity) && IsMacros(e.Macros) && IsSource(e.Source) && IsCategory(e.MealCategory);

    private static bool IsValid(EntryVersionDto v) =>
        IsName(v.Name) && IsQuantity(v.Quantity) && IsMacros(v.Macros) && IsSource(v.Source) && IsCategory(v.MealCategory)
        && v.ChangeType is "edit" or "delete" or "restore";

    private static bool IsValid(SavedFoodDto f) =>
        IsName(f.Name) && IsQuantity(f.ReferenceQuantity) && IsMacros(f.Macros) && IsSource(f.Source);

    private static bool IsValid(ProteinGoalDto g) =>
        g.Grams is null || (double.IsFinite(g.Grams.Value) && g.Grams > 0 && g.Grams <= MaxMacro);

    private static bool IsName(string name) => name.Trim().Length > 0 && name.Length <= MaxNameLength;

    private static bool InRange(double value, double max) => double.IsFinite(value) && value >= 0 && value <= max;

    private static bool IsQuantity(QuantityDto q) => InRange(q.Amount, MaxQuantity) && q.Unit is "g" or "ml" or "serving";

    private static bool IsMacros(MacrosDto m) =>
        InRange(m.Kcal, MaxKcal) && InRange(m.ProteinG, MaxMacro) && InRange(m.CarbsG, MaxMacro) && InRange(m.FatG, MaxMacro);

    private static bool IsSource(string source) => source is "ai" or "ai-edited" or "manual";

    private static bool IsCategory(string? category) => category is null or "breakfast" or "lunch" or "dinner" or "snacks";
}
