using MacroCounter.Api.Audit;
using MacroCounter.Api.Tests.Infrastructure;
using MacroCounter.Api.Usage;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;
using Npgsql;

namespace MacroCounter.Api.Tests.Usage;

/// <summary>R8 / SC-008: AI lookups are reserved in the database before Claude is called, and never overshoot.</summary>
[Collection("Postgres")]
public class AiQuotaServiceTests(PostgresFixture db) : IAsyncLifetime
{
    private readonly FakeTimeProvider _clock = new(new DateTimeOffset(2026, 10, 14, 15, 30, 0, TimeSpan.Zero));
    private Guid _alice;
    private Guid _bob;
    private Guid _carol;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _alice = await Sql.InsertUser(db.AdminConnectionString, "alice");
        _bob = await Sql.InsertUser(db.AdminConnectionString, "bob");
        _carol = await Sql.InsertUser(db.AdminConnectionString, "carol");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private AiQuotaService Service(int perUser = 30, int globalDaily = 200, int globalMonthly = 3000)
    {
        var dataSource = NpgsqlDataSource.Create(db.AppConnectionString);
        var limits = new LimitsOptions { Ai = new() { PerUserDaily = perUser, GlobalDaily = globalDaily, GlobalMonthly = globalMonthly } };
        return new AiQuotaService(dataSource, Options.Create(limits), _clock, new AuditLog(dataSource, NullLogger<AuditLog>.Instance));
    }

    private Task<int> UserCount(Guid user, DateOnly day) => Sql.Scalar<int>(db.AdminConnectionString,
        "select coalesce((select count from macro.ai_usage_daily where user_id = @u and day = @d), 0)", ("u", user), ("d", day));

    private Task<int> GlobalCount(DateOnly day) => Sql.Scalar<int>(db.AdminConnectionString,
        "select coalesce((select count from macro.ai_usage_global_daily where day = @d), 0)", ("d", day));

    private static readonly DateOnly Today = new(2026, 10, 14);

    [Fact]
    public async Task Thirty_a_day_per_person_then_refused_until_midnight_utc()
    {
        var quota = Service();
        for (var i = 0; i < 30; i++)
        {
            Assert.IsType<QuotaResult.Reserved>(await quota.TryReserveAsync(_alice, CancellationToken.None));
        }

        var refused = Assert.IsType<QuotaResult.Exceeded>(await quota.TryReserveAsync(_alice, CancellationToken.None));

        Assert.Equal(QuotaScopes.UserDaily, refused.Scope);
        Assert.Equal(new DateTimeOffset(2026, 10, 15, 0, 0, 0, TimeSpan.Zero), refused.ResetAt);
        Assert.Equal(30, await UserCount(_alice, Today));
        Assert.Equal(30, await GlobalCount(Today));
        Assert.IsType<QuotaResult.Reserved>(await quota.TryReserveAsync(_bob, CancellationToken.None));
        Assert.Equal(1L, await Sql.Scalar<long>(db.AdminConnectionString,
            "select count(*) from macro.audit_events where event_type = 'quota_exceeded' and reason = 'quota_user_daily'"));
    }

    [Fact]
    public async Task The_global_daily_ceiling_stops_everyone_and_is_recorded()
    {
        var quota = Service(globalDaily: 3);
        foreach (var user in new[] { _alice, _bob, _carol })
        {
            Assert.IsType<QuotaResult.Reserved>(await quota.TryReserveAsync(user, CancellationToken.None));
        }

        var refused = Assert.IsType<QuotaResult.Exceeded>(await quota.TryReserveAsync(_alice, CancellationToken.None));

        Assert.Equal(QuotaScopes.GlobalDaily, refused.Scope);
        Assert.Equal(3, await GlobalCount(Today));
        Assert.Equal(1, await UserCount(_alice, Today));
        Assert.True(await Sql.Scalar<bool>(db.AdminConnectionString,
            "select ceiling_hit_at is not null from macro.ai_usage_global_daily where day = @d", ("d", Today)));
        Assert.Equal(1L, await Sql.Scalar<long>(db.AdminConnectionString,
            "select count(*) from macro.audit_events where event_type = 'ceiling_hit' and reason = 'quota_global_daily'"));
    }

    [Fact]
    public async Task The_global_monthly_ceiling_resets_on_the_first_of_next_month()
    {
        await Sql.Execute(db.AdminConnectionString, """
            insert into macro.ai_usage_global_daily (day, count) values ('2026-10-01', 2), ('2026-10-09', 2), ('2026-09-30', 50);
            """);
        var quota = Service(globalMonthly: 5);

        Assert.IsType<QuotaResult.Reserved>(await quota.TryReserveAsync(_alice, CancellationToken.None));
        var refused = Assert.IsType<QuotaResult.Exceeded>(await quota.TryReserveAsync(_alice, CancellationToken.None));

        Assert.Equal(QuotaScopes.GlobalMonthly, refused.Scope);
        Assert.Equal(new DateTimeOffset(2026, 11, 1, 0, 0, 0, TimeSpan.Zero), refused.ResetAt);
        Assert.Equal(1L, await Sql.Scalar<long>(db.AdminConnectionString,
            "select count(*) from macro.audit_events where event_type = 'ceiling_hit' and reason = 'quota_global_monthly'"));
    }

    [Fact]
    public async Task A_refusal_leaves_every_count_unchanged()
    {
        var quota = Service(perUser: 1);
        await quota.TryReserveAsync(_alice, CancellationToken.None);

        await quota.TryReserveAsync(_alice, CancellationToken.None);

        Assert.Equal(1, await UserCount(_alice, Today));
        Assert.Equal(1, await GlobalCount(Today));
    }

    [Fact]
    public async Task Fifty_at_once_never_go_over_the_limit()
    {
        var quota = Service();

        var results = await Task.WhenAll(Enumerable.Range(0, 50).Select(_ => quota.TryReserveAsync(_alice, CancellationToken.None)));

        Assert.Equal(30, results.Count(r => r is QuotaResult.Reserved));
        Assert.Equal(20, results.Count(r => r is QuotaResult.Exceeded));
        Assert.Equal(30, await UserCount(_alice, Today));
        Assert.Equal(30, await GlobalCount(Today));
    }

    [Fact]
    public async Task A_new_utc_day_starts_a_new_count()
    {
        _clock.SetUtcNow(new DateTimeOffset(2026, 10, 14, 23, 59, 59, TimeSpan.Zero));
        var quota = Service(perUser: 1);
        Assert.IsType<QuotaResult.Reserved>(await quota.TryReserveAsync(_alice, CancellationToken.None));
        Assert.IsType<QuotaResult.Exceeded>(await quota.TryReserveAsync(_alice, CancellationToken.None));

        _clock.SetUtcNow(new DateTimeOffset(2026, 10, 15, 0, 0, 0, TimeSpan.Zero));

        Assert.IsType<QuotaResult.Reserved>(await quota.TryReserveAsync(_alice, CancellationToken.None));
        Assert.Equal(1, await UserCount(_alice, new DateOnly(2026, 10, 15)));
    }
}
