using System.Net;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;
using MacroCounter.Api.Tests.Sync;
using static MacroCounter.Api.Tests.Sync.SyncTestData;

namespace MacroCounter.Api.Tests.Security;

/// <summary>
/// SC-005: no sync path reads or changes another person's data. A request cannot name another user, so the proof is
/// that using the same ids leaves the other person's rows alone and out of sight (FR-013, R10).
/// </summary>
[Collection("Postgres")]
public class SyncIsolationTests(PostgresFixture db) : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private AuthClient _x = null!;
    private AuthClient _y = null!;
    private ActiveUser _xUser = null!;
    private ActiveUser _yUser = null!;

    private DateTimeOffset Now => _factory.Clock.GetUtcNow();

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _factory = new ApiFactory(db, apiKey: null);
        (_x, _xUser) = await TestUsers.ActivateAsync(db, _factory, "xavier");
        (_y, _yUser) = await TestUsers.ActivateAsync(db, _factory, "yuki");
        await _x.AcknowledgeAsync();
        await _y.AcknowledgeAsync();
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private Task<double> AmountFor(ActiveUser user, Guid id) => Sql.Scalar<double>(db.AdminConnectionString,
        "select quantity_amount from macro_data.log_entries where user_id = @u and id = @i", ("u", user.Id), ("i", id));

    [Fact]
    public async Task Upserting_with_another_users_id_makes_your_own_row()
    {
        var id = Guid.NewGuid();
        await _y.PushAsync(Now, Upsert("entry", id, Entry(id, Now.AddMinutes(-1), 100)));

        var result = await _x.PushAsync(Now, Upsert("entry", id, Entry(id, Now, 999)));

        Assert.Equal(["applied"], result.Statuses());
        Assert.Equal(100, await AmountFor(_yUser, id));
        Assert.Equal(999, await AmountFor(_xUser, id));
    }

    [Fact]
    public async Task Deleting_with_another_users_id_leaves_their_entry_alone()
    {
        var id = Guid.NewGuid();
        await _y.PushAsync(Now, Upsert("entry", id, Entry(id, Now.AddMinutes(-1), 100)));

        await _x.PushAsync(Now, Delete(id, Now));

        Assert.Equal(100, await AmountFor(_yUser, id));
        var change = (await _y.PullAllAsync()).Find("entry", id);
        Assert.NotNull(change);
        Assert.False(change.Value.TryGetProperty("deleted", out _));
    }

    [Fact]
    public async Task Restoring_with_another_users_id_revives_nothing_of_theirs()
    {
        var id = Guid.NewGuid();
        await _y.PushAsync(Now, Delete(id, Now.AddMinutes(-1)));

        await _x.PushAsync(Now, Restore(id, Entry(id, Now, 999)));

        Assert.True((await _y.PullAllAsync()).Find("entry", id)!.Value.GetProperty("deleted").GetBoolean());
    }

    [Fact]
    public async Task A_version_with_another_users_ids_stays_your_own()
    {
        var entry = Guid.NewGuid();
        var state = Guid.NewGuid();
        await _y.PushAsync(Now, Insert(state, Version(state, entry, Now.AddMinutes(-1), Now.AddMinutes(-1), amount: 100)));

        await _x.PushAsync(Now, Insert(state, Version(state, entry, Now, Now, amount: 999)));

        Assert.Equal(100, (await _y.PullAllAsync()).Find("version", state)!.Value.GetProperty("record").GetProperty("quantity").GetProperty("amount").GetDouble());
        Assert.Equal(999, (await _x.PullAllAsync()).Find("version", state)!.Value.GetProperty("record").GetProperty("quantity").GetProperty("amount").GetDouble());
    }

    [Fact]
    public async Task A_pull_never_contains_another_users_records()
    {
        var (mine, theirs, theirFood, theirGoal) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        await _y.PushAsync(Now, Upsert("entry", theirs, Entry(theirs, Now)), Upsert("food", theirFood, Food(theirFood, Now)),
            Upsert("goal", theirGoal, Goal(theirGoal, Now)));
        await _x.PushAsync(Now, Upsert("entry", mine, Entry(mine, Now)));

        var changes = await _x.PullAllAsync();

        Assert.NotNull(changes.Find("entry", mine));
        Assert.Single(changes);
    }

    /// <summary>A tab still open for one account, after the browser's shared cookie moved on to another (threat S16).</summary>
    private void ActAsStaleTabOf(ActiveUser previous)
    {
        _y.Http.DefaultRequestHeaders.Remove(SyncTestData.AccountHeader);
        _y.Http.DefaultRequestHeaders.Add(SyncTestData.AccountHeader, previous.Id.ToString());
    }

    [Theory]
    [InlineData("/api/sync/state")]
    [InlineData("/api/sync/changes?since=0")]
    public async Task A_stale_tab_reads_nothing_of_the_account_now_signed_in(string path)
    {
        var id = Guid.NewGuid();
        await _y.PushAsync(Now, Upsert("entry", id, Entry(id, Now, name: "Yuki's lunch")));
        ActAsStaleTabOf(_xUser);

        var response = await _y.Http.GetAsync(path);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("unauthenticated", (await AuthClient.Json(response)).GetProperty("code").GetString());
        Assert.DoesNotContain("lunch", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task A_stale_tab_cannot_write_to_the_account_now_signed_in()
    {
        ActAsStaleTabOf(_xUser);
        var id = Guid.NewGuid();

        var push = await _y.PostAsync("/api/sync/push", new { clientNow = Iso(Now), changes = new[] { Upsert("entry", id, Entry(id, Now)) } });
        var notice = await _y.PostAsync("/api/sync/notice");

        Assert.Equal(HttpStatusCode.Unauthorized, push.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, notice.StatusCode);
        Assert.Equal(0L, await Sql.Scalar<long>(db.AdminConnectionString, "select count(*) from macro_data.log_entries where id = @i", ("i", id)));
    }

    [Fact]
    public async Task A_sync_request_that_names_no_account_is_refused()
    {
        _y.Http.DefaultRequestHeaders.Remove(SyncTestData.AccountHeader);

        Assert.Equal(HttpStatusCode.Unauthorized, (await _y.Http.GetAsync("/api/sync/changes?since=0")).StatusCode);
    }

    [Fact]
    public async Task Naming_your_own_account_works_as_usual()
    {
        var id = Guid.NewGuid();
        await _x.PushAsync(Now, Upsert("entry", id, Entry(id, Now)));

        Assert.NotNull((await _x.PullAllAsync()).Find("entry", id));
    }

    [Fact]
    public async Task No_request_can_name_a_user()
    {
        var id = Guid.NewGuid();

        var inBody = await _x.PostRawAsync("/api/sync/push",
            $$"""{"clientNow":"{{Iso(Now)}}","userId":"{{_yUser.Id}}","changes":[{"type":"entry","op":"delete","id":"{{id}}","deletedAt":"{{Iso(Now)}}"}]}""");
        Assert.Equal(HttpStatusCode.BadRequest, inBody.StatusCode);

        var inChange = await _x.PostRawAsync("/api/sync/push",
            $$"""{"clientNow":"{{Iso(Now)}}","changes":[{"type":"entry","op":"delete","id":"{{id}}","deletedAt":"{{Iso(Now)}}","userId":"{{_yUser.Id}}"}]}""");
        Assert.Equal(HttpStatusCode.BadRequest, inChange.StatusCode);

        // A query value is simply not read.
        var inQuery = await _x.Http.GetAsync($"/api/sync/changes?since=0&userId={_yUser.Id}");
        var page = await AuthClient.Json(inQuery);
        Assert.Equal(0, page.GetProperty("changes").GetArrayLength());
    }

    [Fact]
    public async Task A_push_with_a_photo_or_preference_field_is_refused()
    {
        var id = Guid.NewGuid();
        var entry = (Dictionary<string, object?>)Entry(id, Now);
        entry["photo"] = "data:image/jpeg;base64,AAAA";

        var withPhoto = await _x.PostAsync("/api/sync/push", new { clientNow = Iso(Now), changes = new[] { Upsert("entry", id, entry) } });

        var withPreference = await _x.PostAsync("/api/sync/push", new
        {
            clientNow = Iso(Now),
            changes = new[] { new { type = "preference", op = "upsert", id, record = new { cameraId = "abc" } } },
        });

        Assert.Equal(HttpStatusCode.BadRequest, withPhoto.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, withPreference.StatusCode);
    }

    [Fact]
    public async Task No_table_has_anywhere_to_keep_a_photo_or_a_preference()
    {
        Assert.Equal(0L, await Sql.Scalar<long>(db.AdminConnectionString, """
            select count(*) from information_schema.columns
            where table_schema = 'macro_data'
              and (column_name ilike '%photo%' or column_name ilike '%image%' or column_name ilike '%camera%' or data_type = 'bytea')
            """));
    }
}
