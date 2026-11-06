using System.Net;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;
using static MacroCounter.Api.Tests.Sync.SyncTestData;

namespace MacroCounter.Api.Tests.Sync;

/// <summary>The push contract: all or nothing (FR-014), and repeats are harmless (R2).</summary>
[Collection("Postgres")]
public class SyncPushTests(PostgresFixture db) : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private AuthClient _client = null!;
    private ActiveUser _user = null!;

    private DateTimeOffset Now => _factory.Clock.GetUtcNow();

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _factory = new ApiFactory(db, apiKey: null);
        (_client, _user) = await TestUsers.ActivateAsync(db, _factory, "alice");
        await _client.AcknowledgeAsync();
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private Task<long> Count(string table) =>
        Sql.Scalar<long>(db.AdminConnectionString, $"select count(*) from macro_data.{table} where user_id = @u", ("u", _user.Id));

    [Fact]
    public async Task An_entry_a_food_and_a_goal_are_applied()
    {
        var (entry, food, goal) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());

        var result = await _client.PushAsync(Now,
            Upsert("entry", entry, Entry(entry, Now)),
            Upsert("food", food, Food(food, Now)),
            Upsert("goal", goal, Goal(goal, Now)));

        Assert.Equal(["applied", "applied", "applied"], result.Statuses());
        Assert.Equal(3, result.GetProperty("revision").GetInt64());
        Assert.Equal(entry, result.GetProperty("results")[0].GetProperty("id").GetGuid());
        Assert.Equal("food", result.GetProperty("results")[1].GetProperty("type").GetString());
        Assert.Equal(1L, await Count("log_entries"));
        Assert.Equal(1L, await Count("saved_foods"));
        Assert.Equal(1L, await Count("protein_goals"));
    }

    [Fact]
    public async Task Sending_the_same_push_again_changes_no_data()
    {
        var id = Guid.NewGuid();
        var change = Upsert("entry", id, Entry(id, Now.AddMinutes(-1)));
        await _client.PushAsync(Now, change);

        var again = await _client.PushAsync(Now, change);

        Assert.Equal(["superseded"], again.Statuses());
        Assert.Equal(1L, await Count("log_entries"));
        Assert.Equal(0L, await Count("entry_versions"));
    }

    [Fact]
    public async Task A_retry_that_lands_a_moment_later_does_not_version_itself()
    {
        var id = Guid.NewGuid();
        var versionId = Guid.NewGuid();
        var sentAt = Now;
        var change = Upsert("entry", id, Entry(id, sentAt, versionId: versionId));
        await _client.PushAsync(sentAt, change);

        _factory.Clock.Advance(TimeSpan.FromSeconds(30));
        await _client.PushAsync(sentAt, change);

        Assert.Equal(0L, await Count("entry_versions"));
    }

    [Fact]
    public async Task Changing_an_entrys_day_rejects_the_whole_push()
    {
        var id = Guid.NewGuid();
        await _client.PushAsync(Now, Upsert("entry", id, Entry(id, Now.AddMinutes(-1), dayKey: "2026-11-04")));
        var other = Guid.NewGuid();

        var response = await _client.PostAsync("/api/sync/push", new
        {
            clientNow = Iso(Now),
            changes = new[]
            {
                Upsert("entry", other, Entry(other, Now)),
                Upsert("entry", id, Entry(id, Now, dayKey: "2026-11-05")),
            },
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await AuthClient.Json(response);
        Assert.Equal("invalid_request", problem.GetProperty("code").GetString());
        var invalid = problem.GetProperty("invalid")[0];
        Assert.Equal(1, invalid.GetProperty("index").GetInt32());
        Assert.Equal("day_key_changed", invalid.GetProperty("reason").GetString());
        Assert.Equal(1L, await Count("log_entries"));
    }

    [Fact]
    public async Task One_invalid_change_applies_nothing_and_is_audited_by_code_only()
    {
        var changes = Enumerable.Range(0, 5).Select(i =>
        {
            var id = Guid.NewGuid();
            return Upsert("entry", id, Entry(id, Now, name: i == 2 ? " " : "Banana"));
        }).ToArray();

        var response = await _client.PostAsync("/api/sync/push", new { clientNow = Iso(Now), changes });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await AuthClient.Json(response);
        Assert.Equal(2, problem.GetProperty("invalid")[0].GetProperty("index").GetInt32());
        Assert.Equal("invalid_record", problem.GetProperty("invalid")[0].GetProperty("reason").GetString());
        Assert.Equal(0L, await Count("log_entries"));
        Assert.Equal(1L, await Sql.Scalar<long>(db.AdminConnectionString,
            "select count(*) from macro.audit_events where event_type = 'sync_rejected' and reason = 'invalid_record' and user_id = @u",
            ("u", _user.Id)));
    }

    [Fact]
    public async Task Too_many_changes_is_refused_and_audited()
    {
        var changes = Enumerable.Range(0, 201).Select(_ =>
        {
            var id = Guid.NewGuid();
            return Upsert("entry", id, Entry(id, Now));
        }).ToArray();

        var response = await _client.PostAsync("/api/sync/push", new { clientNow = Iso(Now), changes });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("too_many_changes", (await AuthClient.Json(response)).GetProperty("code").GetString());
        Assert.Equal(1L, await Sql.Scalar<long>(db.AdminConnectionString,
            "select count(*) from macro.audit_events where event_type = 'sync_rejected' and reason = 'too_many_changes'"));
    }

    [Fact]
    public async Task A_timestamp_in_any_offset_is_stored_as_the_same_moment()
    {
        var id = Guid.NewGuid();
        var record = (Dictionary<string, object?>)Entry(id, Now);
        record["loggedAt"] = "2026-11-04T09:00:00.000+01:00";

        var result = await _client.PushAsync(Now, Upsert("entry", id, record));

        Assert.Equal(["applied"], result.Statuses());
        Assert.Equal(new DateTime(2026, 11, 4, 8, 0, 0, DateTimeKind.Utc), await Sql.Scalar<DateTime>(db.AdminConnectionString,
            "select logged_at from macro_data.log_entries where id = @i", ("i", id)));
        var pulled = (await _client.PullAllAsync()).Find("entry", id)!.Value.GetProperty("record");
        Assert.Equal("2026-11-04T08:00:00.000Z", pulled.GetProperty("loggedAt").GetString());
    }

    [Theory]
    [InlineData("0001-01-01T00:00:00.000Z", "9999-12-31T23:59:59.000Z")]
    [InlineData("9999-12-31T23:59:59.000Z", "0001-01-01T00:00:00.000Z")]
    public async Task Extreme_times_are_handled_and_never_a_server_error(string clientNow, string updatedAt)
    {
        var id = Guid.NewGuid();
        var record = (Dictionary<string, object?>)Entry(id, Now);
        record["updatedAt"] = updatedAt;

        var response = await _client.PostAsync("/api/sync/push", new { clientNow, changes = new[] { Upsert("entry", id, record) } });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task A_body_without_the_device_time_is_invalid()
    {
        var response = await _client.PostAsync("/api/sync/push", new { changes = Array.Empty<object>() });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
