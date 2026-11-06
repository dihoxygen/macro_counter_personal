using System.Text.Json;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;
using static MacroCounter.Api.Tests.Sync.SyncTestData;

namespace MacroCounter.Api.Tests.Sync;

/// <summary>The conflict rules (R3, R15, FR-007, SC-007, constitution III). Every row of the R15 table is here.</summary>
[Collection("Postgres")]
public class SyncConflictTests(PostgresFixture db) : IAsyncLifetime
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

    private void Advance(int minutes = 1) => _factory.Clock.Advance(TimeSpan.FromMinutes(minutes));

    private Task<double> Amount() => Sql.Scalar<double>(db.AdminConnectionString,
        "select quantity_amount from macro_data.log_entries where user_id = @u and id = @i", ("u", _user.Id), ("i", _id));

    private Task<bool> IsDeleted() => Sql.Scalar<bool>(db.AdminConnectionString,
        "select deleted_at is not null from macro_data.log_entries where user_id = @u and id = @i", ("u", _user.Id), ("i", _id));

    private async Task SeedLive(double amount = 100)
    {
        await _client.PushAsync(Now, Upsert("entry", _id, Entry(_id, Now, amount)));
        Advance();
    }

    private async Task SeedTombstone()
    {
        await SeedLive();
        await _client.PushAsync(Now, Delete(_id, Now));
        Advance();
    }

    [Fact]
    public async Task A_newer_edit_wins_and_an_older_one_loses()
    {
        await SeedLive();
        var older = Now.AddMinutes(-30);

        var newer = await _client.PushAsync(Now, Upsert("entry", _id, Entry(_id, Now, 200)));
        Assert.Equal(["applied"], newer.Statuses());

        Advance();
        var stale = await _client.PushAsync(Now, Upsert("entry", _id, Entry(_id, older, 300)));

        Assert.Equal(["superseded"], stale.Statuses());
        Assert.Equal(200, await Amount());
    }

    [Fact]
    public async Task A_tie_keeps_the_stored_version()
    {
        var at = Now;
        await _client.PushAsync(at, Upsert("entry", _id, Entry(_id, at, 100)));

        var tie = await _client.PushAsync(at, Upsert("entry", _id, Entry(_id, at, 200)));

        Assert.Equal(["superseded"], tie.Statuses());
        Assert.Equal(100, await Amount());
    }

    [Fact]
    public async Task A_device_two_hours_fast_does_not_beat_a_later_edit()
    {
        await SeedLive();
        var fast = TimeSpan.FromHours(2);
        var deviceAEdit = Now + fast;
        Advance(5);
        var clientNowOnB = Now;
        await _client.PushAsync(clientNowOnB, Upsert("entry", _id, Entry(_id, clientNowOnB, 300)));
        Advance();

        var late = await _client.PushAsync(Now + fast, Upsert("entry", _id, Entry(_id, deviceAEdit, 200)));

        Assert.Equal(["superseded"], late.Statuses());
        Assert.Equal(300, await Amount());
    }

    [Fact]
    public async Task A_delete_beats_an_older_edit_and_a_newer_one()
    {
        await SeedLive();
        await _client.PushAsync(Now, Upsert("entry", _id, Entry(_id, Now, 200)));
        Advance();
        var deletedBefore = Now.AddMinutes(-30);

        var result = await _client.PushAsync(Now, Delete(_id, deletedBefore));

        Assert.Equal(["applied"], result.Statuses());
        Assert.True(await IsDeleted());
    }

    // ---- The R15 table, row by row ----

    [Fact]
    public async Task Absent_and_upsert_inserts()
    {
        Assert.Equal(["applied"], (await _client.PushAsync(Now, Upsert("entry", _id, Entry(_id, Now)))).Statuses());
    }

    [Fact]
    public async Task Absent_and_restore_inserts()
    {
        Assert.Equal(["applied"], (await _client.PushAsync(Now, Restore(_id, Entry(_id, Now)))).Statuses());
        Assert.False(await IsDeleted());
    }

    [Fact]
    public async Task Absent_and_delete_inserts_a_tombstone_dated_by_the_delete()
    {
        var deletedAt = Now.AddMinutes(-3);

        Assert.Equal(["applied"], (await _client.PushAsync(Now, Delete(_id, deletedAt))).Statuses());

        Assert.True(await IsDeleted());
        Assert.Equal(deletedAt.UtcDateTime, await Sql.Scalar<DateTime>(db.AdminConnectionString,
            "select created_at from macro_data.log_entries where id = @i", ("i", _id)));
    }

    [Fact]
    public async Task Live_and_restore_is_last_writer_wins_and_records_the_restore()
    {
        await SeedLive();
        var at = Now;

        Assert.Equal(["applied"], (await _client.PushAsync(at, Restore(_id, Entry(_id, at, 150)))).Statuses());

        Assert.Equal(150, await Amount());
        Assert.Equal(at.UtcDateTime, await Sql.Scalar<DateTime>(db.AdminConnectionString,
            "select restored_at from macro_data.log_entries where id = @i", ("i", _id)));
    }

    [Fact]
    public async Task Live_and_a_delete_made_before_the_restore_is_superseded()
    {
        await SeedTombstone();
        var deleteMadeEarlier = Now.AddSeconds(-1);
        Advance();
        await _client.PushAsync(Now, Restore(_id, Entry(_id, Now, 150)));
        Advance();

        var late = await _client.PushAsync(Now, Delete(_id, deleteMadeEarlier));

        Assert.Equal(["superseded"], late.Statuses());
        Assert.False(await IsDeleted());
    }

    [Fact]
    public async Task Live_and_a_delete_made_after_the_restore_wins()
    {
        await SeedTombstone();
        await _client.PushAsync(Now, Restore(_id, Entry(_id, Now, 150)));
        Advance();

        Assert.Equal(["applied"], (await _client.PushAsync(Now, Delete(_id, Now))).Statuses());
        Assert.True(await IsDeleted());
    }

    [Fact]
    public async Task Tombstone_and_upsert_is_superseded_even_with_a_newer_time()
    {
        await SeedTombstone();

        var stale = await _client.PushAsync(Now, Upsert("entry", _id, Entry(_id, Now, 999)));

        Assert.Equal(["superseded"], stale.Statuses());
        Assert.True(await IsDeleted());
    }

    [Fact]
    public async Task Tombstone_and_a_later_restore_revives_the_entry()
    {
        await SeedTombstone();

        Assert.Equal(["applied"], (await _client.PushAsync(Now, Restore(_id, Entry(_id, Now, 150)))).Statuses());

        Assert.False(await IsDeleted());
        Assert.Equal(150, await Amount());
    }

    [Fact]
    public async Task Tombstone_and_an_earlier_restore_stays_deleted()
    {
        await SeedLive();
        var restoreMadeFirst = Now;
        Advance();
        await _client.PushAsync(Now, Delete(_id, Now));
        Advance();

        var late = await _client.PushAsync(Now, Restore(_id, Entry(_id, restoreMadeFirst, 150)));

        Assert.Equal(["superseded"], late.Statuses());
        Assert.True(await IsDeleted());
    }

    [Fact]
    public async Task Tombstone_and_delete_changes_nothing()
    {
        await SeedTombstone();
        var before = await Sql.Scalar<long>(db.AdminConnectionString,
            "select revision from macro_data.sync_state where user_id = @u", ("u", _user.Id));

        await _client.PushAsync(Now, Delete(_id, Now));

        Assert.True(await IsDeleted());
        Assert.Equal(before, await Sql.Scalar<long>(db.AdminConnectionString,
            "select revision from macro_data.sync_state where user_id = @u", ("u", _user.Id)));
    }

    [Fact]
    public async Task A_device_two_hours_fast_cannot_revive_a_tombstone_with_a_stale_upsert()
    {
        await SeedTombstone();
        var fast = Now.AddHours(2);

        var stale = await _client.PushAsync(fast, Upsert("entry", _id, Entry(_id, fast, 999)));

        Assert.Equal(["superseded"], stale.Statuses());
        Assert.True(await IsDeleted());
    }

    // ---- A pull may already have skipped the winner (R2, constitution III) ----

    private async Task<long> Cursor()
    {
        var page = await AuthClient.Json(await _client.Http.GetAsync("/api/sync/changes?since=0"));
        return page.GetProperty("cursor").GetInt64();
    }

    [Fact]
    public async Task A_tombstone_that_beats_a_change_comes_back_in_the_next_pull()
    {
        await SeedTombstone();
        var cursor = await Cursor();

        await _client.PushAsync(Now, Upsert("entry", _id, Entry(_id, Now, 999)));

        var change = (await _client.PullAllAsync(cursor)).Find("entry", _id);
        Assert.NotNull(change);
        Assert.True(change.Value.GetProperty("deleted").GetBoolean());
    }

    [Fact]
    public async Task A_stored_entry_that_beats_a_change_comes_back_in_the_next_pull()
    {
        await SeedLive(100);
        var cursor = await Cursor();

        await _client.PushAsync(Now, Upsert("entry", _id, Entry(_id, Now.AddHours(-1), 999)));

        var change = (await _client.PullAllAsync(cursor)).Find("entry", _id);
        Assert.NotNull(change);
        Assert.Equal(100, change.Value.GetProperty("record").GetProperty("quantity").GetProperty("amount").GetDouble());
    }

    [Fact]
    public async Task A_stored_food_or_goal_that_beats_a_change_comes_back_in_the_next_pull()
    {
        var (food, goal) = (Guid.NewGuid(), Guid.NewGuid());
        await _client.PushAsync(Now, Upsert("food", food, Food(food, Now)), Upsert("goal", goal, Goal(goal, Now)));
        Advance();
        var cursor = await Cursor();

        await _client.PushAsync(Now, Upsert("food", food, Food(food, Now.AddHours(-1))), Upsert("goal", goal, Goal(goal, Now.AddHours(-1))));

        var changes = await _client.PullAllAsync(cursor);
        Assert.NotNull(changes.Find("food", food));
        Assert.NotNull(changes.Find("goal", goal));
    }

    // ---- Long offline (constitution III) ----

    [Fact]
    public async Task A_device_offline_for_weeks_with_a_drifting_clock_converges_and_the_delete_holds()
    {
        var (kept, removed, added) = (_id, Guid.NewGuid(), Guid.NewGuid());
        // Times are carried by the requests: the server clock stays put so the session does not expire.
        var start = Now.AddDays(-22);
        await _client.PushAsync(Now, Upsert("entry", kept, Entry(kept, start, 100)), Upsert("entry", removed, Entry(removed, start, 100)));

        // A week later the other device edits one entry and deletes the other.
        var otherDevice = Now.AddDays(-14);
        await _client.PushAsync(Now, Upsert("entry", kept, Entry(kept, otherDevice, 300)), Delete(removed, otherDevice));

        // This device went offline with a clock 40 minutes slow, and edited both entries the day after the start.
        var slow = TimeSpan.FromMinutes(-40);
        var offlineEdit = Now.AddDays(-21) + slow;

        // It reconnects, three weeks on: its older edits lose, and its new entry syncs.
        var result = await _client.PushAsync(Now + slow,
            Upsert("entry", kept, Entry(kept, offlineEdit, 200)),
            Upsert("entry", removed, Entry(removed, offlineEdit, 200)),
            Upsert("entry", added, Entry(added, Now + slow, 50)));

        Assert.Equal(["superseded", "superseded", "applied"], result.Statuses());
        var changes = await _client.PullAllAsync();
        JsonElement record = changes.Find("entry", kept)!.Value.GetProperty("record");
        Assert.Equal(300, record.GetProperty("quantity").GetProperty("amount").GetDouble());
        Assert.True(changes.Find("entry", removed)!.Value.GetProperty("deleted").GetBoolean());
        Assert.NotNull(changes.Find("entry", added));
    }
}
