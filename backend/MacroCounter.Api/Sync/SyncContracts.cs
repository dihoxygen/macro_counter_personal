using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using MacroCounter.Api.Endpoints;

namespace MacroCounter.Api.Sync;

// The wire shapes of specs/007-cross-device-sync/contracts/sync-api.yaml. No request names a user: the user is
// always the session's (research R10).

public sealed record PushRequest(DateTimeOffset ClientNow, IReadOnlyList<SyncChange> Changes);

/// <summary>One change. <see cref="Record"/> is read per change, so one bad record is reported by its index.</summary>
public sealed record SyncChange(string Type, string Op, Guid Id, JsonElement? Record = null, DateTimeOffset? DeletedAt = null);

public sealed record QuantityDto(double Amount, string Unit);

public sealed record MacrosDto(double Kcal, double ProteinG, double CarbsG, double FatG);

public sealed record LogEntryDto(
    Guid Id,
    Guid VersionId,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    int SchemaVersion,
    DateOnly DayKey,
    DateTimeOffset LoggedAt,
    string Name,
    QuantityDto Quantity,
    MacrosDto Macros,
    string Source,
    Guid? SavedFoodId,
    string? MealCategory);

/// <summary>A replaced state of an entry. <see cref="Id"/> is that state's version id (R14).</summary>
public sealed record EntryVersionDto(
    Guid Id,
    Guid EntryId,
    string ChangeType,
    DateTimeOffset ReplacedAt,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    int SchemaVersion,
    DateOnly DayKey,
    DateTimeOffset LoggedAt,
    string Name,
    QuantityDto Quantity,
    MacrosDto Macros,
    string Source,
    Guid? SavedFoodId,
    string? MealCategory);

public sealed record SavedFoodDto(
    Guid Id,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    int SchemaVersion,
    string Name,
    QuantityDto ReferenceQuantity,
    MacrosDto Macros,
    string Source,
    DateTimeOffset LastUsedAt);

public sealed record ProteinGoalDto(
    Guid Id,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    int SchemaVersion,
    DateOnly EffectiveFrom,
    double? Grams);

public sealed record PushResult(string Type, Guid Id, string Status,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] Guid? CanonicalId = null);

public sealed record PushResponse(long Revision, IReadOnlyList<PushResult> Results);

public sealed record PulledRecord(string Type, long Revision, object Record);

public sealed record PulledDeletion(string Type, long Revision, Guid Id)
{
    public bool Deleted => true;
}

public sealed record PullResponse(IReadOnlyList<object> Changes, long Cursor, bool HasMore, DateTimeOffset ServerNow);

public sealed record SyncStateResponse(bool NoticeAcknowledged, long Revision);

/// <summary>A pulled entry: what was pushed, plus the server-assigned restore time (R15).</summary>
public sealed record PulledEntry(
    Guid Id,
    Guid VersionId,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    int SchemaVersion,
    DateOnly DayKey,
    DateTimeOffset LoggedAt,
    string Name,
    QuantityDto Quantity,
    MacrosDto Macros,
    string Source,
    Guid? SavedFoodId,
    string? MealCategory,
    DateTimeOffset? RestoredAt);

/// <summary>A pulled version: the pushed shape, plus the server-assigned restore time.</summary>
public sealed record PulledVersion(
    Guid Id,
    Guid EntryId,
    string ChangeType,
    DateTimeOffset ReplacedAt,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    int SchemaVersion,
    DateOnly DayKey,
    DateTimeOffset LoggedAt,
    string Name,
    QuantityDto Quantity,
    MacrosDto Macros,
    string Source,
    Guid? SavedFoodId,
    string? MealCategory,
    DateTimeOffset? RestoredAt);

/// <summary>JSON rules for sync bodies: strict like <see cref="StrictJson"/>, with every field required.</summary>
public static class SyncJson
{
    public static readonly JsonSerializerOptions Options = new(StrictJson.Options)
    {
        RespectNullableAnnotations = true,
        RespectRequiredConstructorParameters = true,
        Converters = { new OffsetTimestampConverter() },
    };

    /// <summary>
    /// Reads ISO 8601 only with an explicit offset, and writes what the device's toISOString() writes. The device
    /// compares these strings, so one format must hold everywhere.
    /// </summary>
    private sealed class OffsetTimestampConverter : JsonConverter<DateTimeOffset>
    {
        public override DateTimeOffset Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            var text = reader.GetString();
            var hasOffset = text is not null && text.Length > 10 && text.IndexOf('T') > 0
                && (text.EndsWith('Z') || text.LastIndexOfAny(['+', '-']) > text.IndexOf('T'));
            return hasOffset && DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var value)
                ? value
                : throw new JsonException("A timestamp needs ISO 8601 with an offset.");
        }

        public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options) =>
            writer.WriteStringValue(value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture));
    }
}
