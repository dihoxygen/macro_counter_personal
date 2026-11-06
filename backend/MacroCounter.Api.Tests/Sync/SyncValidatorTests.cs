using System.Text.Json;
using System.Text.Json.Nodes;
using MacroCounter.Api.Endpoints;
using MacroCounter.Api.Sync;
using MacroCounter.Api.Tests.Security;

namespace MacroCounter.Api.Tests.Sync;

/// <summary>FR-014: the server checks every record, and reports only indexes and fixed codes (R9).</summary>
public class SyncValidatorTests
{
    private static readonly JsonNode Vectors = JsonNode.Parse(File.ReadAllText(Path.Combine(
        EndpointInventoryTests.RepoRoot(), "backend", "MacroCounter.Api.Tests", "Sync", "vectors", "bounds.json")))!;

    public static TheoryData<string> Cases()
    {
        var names = new TheoryData<string>();
        foreach (var vector in Vectors["cases"]!.AsArray()) names.Add(vector!["name"]!.GetValue<string>());
        return names;
    }

    private static SyncChange ChangeFor(string type, JsonObject record) => type == "version"
        ? new SyncChange(type, "insert", record["id"]!.GetValue<Guid>(), JsonSerializer.SerializeToElement(record), null)
        : new SyncChange(type, "upsert", record["id"]!.GetValue<Guid>(), JsonSerializer.SerializeToElement(record), null);

    private static SyncValidation Validate(params SyncChange[] changes) =>
        SyncValidator.Validate(new PushRequest(DateTimeOffset.UnixEpoch, changes));

    [Theory]
    [MemberData(nameof(Cases))]
    public void Vector(string name)
    {
        var vector = Vectors["cases"]!.AsArray().Single(v => v!["name"]!.GetValue<string>() == name)!;
        var type = vector["type"]!.GetValue<string>();
        var record = Vectors["base"]![type]!.AsObject().DeepClone().AsObject();
        foreach (var (key, value) in vector["patch"]!.AsObject()) record[key] = value?.DeepClone();

        var result = Validate(ChangeFor(type, record));

        if (vector["valid"]!.GetValue<bool>())
        {
            Assert.Empty(result.Invalid);
        }
        else
        {
            var invalid = Assert.Single(result.Invalid);
            Assert.Equal(0, invalid.Index);
            Assert.Equal(vector["reason"]!.GetValue<string>(), invalid.Reason);
        }
    }

    private static SyncChange ValidEntry(string op = "upsert", string type = "entry")
    {
        var record = Vectors["base"]!["entry"]!.AsObject();
        return new SyncChange(type, op, record["id"]!.GetValue<Guid>(), JsonSerializer.SerializeToElement(record), null);
    }

    [Fact]
    public void The_record_id_must_match_the_change_id()
    {
        var change = ValidEntry() with { Id = Guid.NewGuid() };

        Assert.Equal("invalid_record", Assert.Single(Validate(change).Invalid).Reason);
    }

    [Theory]
    [InlineData("food", "delete")]
    [InlineData("goal", "delete")]
    [InlineData("version", "delete")]
    [InlineData("food", "restore")]
    [InlineData("version", "restore")]
    [InlineData("entry", "insert")]
    [InlineData("food", "insert")]
    [InlineData("entry", "merge")]
    [InlineData("photo", "upsert")]
    public void Only_some_operations_fit_each_type(string type, string op)
    {
        var change = new SyncChange(type, op, Guid.NewGuid(),
            op == "delete" ? null : JsonSerializer.SerializeToElement(new { }), op == "delete" ? DateTimeOffset.UnixEpoch : null);

        Assert.Equal("invalid_record", Assert.Single(Validate(change).Invalid).Reason);
    }

    [Fact]
    public void A_delete_needs_its_time()
    {
        var change = new SyncChange("entry", "delete", Guid.NewGuid(), null, null);

        Assert.Equal("invalid_record", Assert.Single(Validate(change).Invalid).Reason);
    }

    [Fact]
    public void A_delete_and_a_restore_of_an_entry_are_accepted()
    {
        var result = Validate(new SyncChange("entry", "delete", Guid.NewGuid(), null, DateTimeOffset.UnixEpoch), ValidEntry("restore"));

        Assert.Empty(result.Invalid);
        Assert.Equal(2, result.Changes.Count);
    }

    [Fact]
    public void More_than_200_changes_is_too_many_and_versions_count()
    {
        var version = Vectors["base"]!["version"]!.AsObject();
        var changes = Enumerable.Repeat(ChangeFor("version", version), 201).ToArray();

        Assert.True(Validate(changes).TooMany);
        Assert.False(Validate(changes[..200]).TooMany);
    }

    [Fact]
    public void Every_invalid_index_is_listed_with_no_field_values()
    {
        var bad = Vectors["base"]!["entry"]!.AsObject().DeepClone().AsObject();
        bad["name"] = "";
        bad["source"] = "SECRET-VALUE";

        var result = Validate(ValidEntry(), ChangeFor("entry", bad), ValidEntry(), ChangeFor("entry", bad));

        Assert.Equal([1, 3], result.Invalid.Select(i => i.Index));
        Assert.DoesNotContain("SECRET-VALUE", JsonSerializer.Serialize(result.Invalid, StrictJson.Options));
    }
}
