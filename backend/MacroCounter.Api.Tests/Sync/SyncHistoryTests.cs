using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;
using static MacroCounter.Api.Tests.Sync.SyncTestData;

namespace MacroCounter.Api.Tests.Sync;

/// <summary>What the server keeps as history (R14, R16, R17, FR-024, FR-026, SC-007).</summary>
[Collection("Postgres")]
public class SyncHistoryTests(PostgresFixture db) : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private AuthClient _client = null!;
    private ActiveUser _user = null!;
    private readonly Guid _id = Guid.NewGuid();

    private DateTimeOffset Now => _factory.Clock.GetUtcNow();

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _factory = new ApiFactory(db, apiKey: null);
        (_client, _user) = await TestUsers.ActivateAsync(db, _factory, "alice");
        await _client.AcknowledgeAsync();
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private void Advance() => _factory.Clock.Advance(TimeSpan.FromMinutes(1));

    private Task<long> Versions() => Sql.Scalar<long>(db.AdminConnectionString,
        "select count(*) from macro_data.entry_versions where user_id = @u", ("u", _user.Id));

    private Task<string> ChangeType(Guid version) => Sql.Scalar<string>(db.AdminConnectionString,
        "select change_type from macro_data.entry_versions where id = @v", ("v", version));

    private Task<double> VersionAmount(Guid version) => Sql.Scalar<double>(db.AdminConnectionString,
        "select quantity_amount from macro_data.entry_versions where id = @v", ("v", version));

    private async Task<Guid> SeedLive(double amount = 100)
    {
        var version = Guid.NewGuid();
        await _client.PushAsync(Now, Upsert("entry", _id, Entry(_id, Now, amount, versionId: version)));
        Advance();
        return version;
    }

    [Fact]
    public async Task An_applied_edit_keeps_the_state_it_replaced()
    {
        var first = await SeedLive(100);

        await _client.PushAsync(Now, Upsert("entry", _id, Entry(_id, Now, 200)));

        Assert.Equal("edit", await ChangeType(first));
        Assert.Equal(100, await VersionAmount(first));
    }

    [Fact]
    public async Task A_delete_keeps_the_state_it_replaced()
    {
        var first = await SeedLive(100);

        await _client.PushAsync(Now, Delete(_id, Now));

        Assert.Equal("delete", await ChangeType(first));
        Assert.Equal(100, await VersionAmount(first));
    }

    [Fact]
    public async Task A_restore_keeps_the_state_it_replaced()
    {
        var first = await SeedLive(100);

        await _client.PushAsync(Now, Restore(_id, Entry(_id, Now, 150)));

        Assert.Equal("restore", await ChangeType(first));
    }

    [Fact]
    public async Task A_losing_edit_is_kept()
    {
        await SeedLive(100);
        var losing = Guid.NewGuid();

        await _client.PushAsync(Now, Upsert("entry", _id, Entry(_id, Now.AddHours(-1), 200, versionId: losing)));

        Assert.Equal(200, await VersionAmount(losing));
    }

    [Fact]
    public async Task An_edit_that_lost_to_a_delete_is_kept()
    {
        await SeedLive(100);
        await _client.PushAsync(Now, Delete(_id, Now));
        Advance();
        var losing = Guid.NewGuid();

        await _client.PushAsync(Now, Upsert("entry", _id, Entry(_id, Now, 200, versionId: losing)));

        Assert.Equal(200, await VersionAmount(losing));
    }

    [Fact]
    public async Task The_same_state_from_two_devices_is_one_row_and_the_first_arrival_stands()
    {
        var entry = Guid.NewGuid();
        var state = Guid.NewGuid();
        var firstReplaced = Now.AddMinutes(-2);

        await _client.PushAsync(Now, Insert(state, Version(state, entry, Now.AddMinutes(-9), firstReplaced, "edit")));
        Advance();
        await _client.PushAsync(Now, Insert(state, Version(state, entry, Now.AddMinutes(-9), Now, "delete")));

        Assert.Equal(1L, await Versions());
        Assert.Equal("edit", await ChangeType(state));
        Assert.Equal(firstReplaced.UtcDateTime, await Sql.Scalar<DateTime>(db.AdminConnectionString,
            "select replaced_at from macro_data.entry_versions where id = @v", ("v", state)));
    }

    [Fact]
    public async Task Versions_run_first_so_a_devices_own_change_type_beats_the_default()
    {
        var first = await SeedLive(100);

        await _client.PushAsync(Now,
            Upsert("entry", _id, Entry(_id, Now, 150)),
            Insert(first, Version(first, _id, Now.AddMinutes(-1), Now, "restore", amount: 100)));

        Assert.Equal("restore", await ChangeType(first));
    }

    [Fact]
    public async Task Replaced_time_is_corrected_for_the_devices_clock()
    {
        var entry = Guid.NewGuid();
        var state = Guid.NewGuid();
        var realReplaced = Now.AddMinutes(-5);
        var fast = TimeSpan.FromHours(2);

        await _client.PushAsync(Now + fast, Insert(state, Version(state, entry, Now + fast, realReplaced + fast)));

        Assert.Equal(realReplaced.UtcDateTime, await Sql.Scalar<DateTime>(db.AdminConnectionString,
            "select replaced_at from macro_data.entry_versions where id = @v", ("v", state)));
    }

    [Fact]
    public async Task A_future_replaced_time_is_clamped()
    {
        var entry = Guid.NewGuid();
        var state = Guid.NewGuid();

        await _client.PushAsync(Now, Insert(state, Version(state, entry, Now, Now.AddDays(5))));

        Assert.Equal(Now.UtcDateTime, await Sql.Scalar<DateTime>(db.AdminConnectionString,
            "select replaced_at from macro_data.entry_versions where id = @v", ("v", state)));
    }

    [Fact]
    public async Task A_tombstone_holds_no_food_data_and_its_delete_version_does()
    {
        var first = await SeedLive(100);

        await _client.PushAsync(Now, Delete(_id, Now));

        Assert.Equal(0L, await Sql.Scalar<long>(db.AdminConnectionString,
            "select count(*) from macro_data.log_entries where id = @i and (name is not null or kcal is not null or day_key is not null)",
            ("i", _id)));
        Assert.Equal(100, await VersionAmount(first));
    }

    [Fact]
    public async Task A_null_category_never_replaces_a_category()
    {
        await SeedLive();

        await _client.PushAsync(Now, Upsert("entry", _id, Entry(_id, Now, 200, meal: null)));

        Assert.Equal("breakfast", await Sql.Scalar<string>(db.AdminConnectionString,
            "select meal_category from macro_data.log_entries where id = @i", ("i", _id)));

        Advance();
        await _client.PushAsync(Now, Restore(_id, Entry(_id, Now, 300, meal: null)));

        Assert.Equal("breakfast", await Sql.Scalar<string>(db.AdminConnectionString,
            "select meal_category from macro_data.log_entries where id = @i", ("i", _id)));
    }

    [Fact]
    public async Task A_pushed_version_of_the_current_state_takes_its_fields_from_the_stored_row()
    {
        // The state in place came from a restore, so its time is already corrected and it has a restore marker.
        var restored = Guid.NewGuid();
        await SeedLive();
        var restoredAt = Now;
        await _client.PushAsync(restoredAt, Restore(_id, Entry(_id, restoredAt, 150, versionId: restored)));
        Advance();

        // A device two hours fast edits it. Its copy of the state has no marker, and a time that needs no correcting.
        var fast = TimeSpan.FromHours(2);
        await _client.PushAsync(Now + fast,
            Insert(restored, Version(restored, _id, restoredAt, Now + fast, "edit", amount: 150)),
            Upsert("entry", _id, Entry(_id, Now + fast, 175)));

        Assert.Equal(restoredAt.UtcDateTime, await Sql.Scalar<DateTime>(db.AdminConnectionString,
            "select restored_at from macro_data.entry_versions where id = @v", ("v", restored)));
        Assert.Equal(restoredAt.UtcDateTime, await Sql.Scalar<DateTime>(db.AdminConnectionString,
            "select effective_at from macro_data.entry_versions where id = @v", ("v", restored)));
        Assert.Equal("edit", await ChangeType(restored));
        Assert.Equal(Now.UtcDateTime, await Sql.Scalar<DateTime>(db.AdminConnectionString,
            "select replaced_at from macro_data.entry_versions where id = @v", ("v", restored)));
    }

    [Fact]
    public async Task Versions_come_back_in_a_pull_with_every_field()
    {
        var first = await SeedLive(100);
        await _client.PushAsync(Now, Upsert("entry", _id, Entry(_id, Now, 200)));

        var version = (await _client.PullAllAsync()).Find("version", first);

        Assert.NotNull(version);
        var record = version.Value.GetProperty("record");
        Assert.Equal(_id, record.GetProperty("entryId").GetGuid());
        Assert.Equal("edit", record.GetProperty("changeType").GetString());
        Assert.Equal(100, record.GetProperty("quantity").GetProperty("amount").GetDouble());
    }
}
