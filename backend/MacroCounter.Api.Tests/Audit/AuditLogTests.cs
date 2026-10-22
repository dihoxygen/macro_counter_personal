using System.Net;
using MacroCounter.Api.Audit;
using MacroCounter.Api.Tests.Infrastructure;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace MacroCounter.Api.Tests.Audit;

[Collection("Postgres")]
public class AuditLogTests(PostgresFixture db) : IAsyncLifetime
{
    private readonly CapturingLoggerProvider _logs = new();

    public Task InitializeAsync() => db.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private AuditLog Create(string connectionString) =>
        new(NpgsqlDataSource.Create(connectionString), _logs.CreateLogger<AuditLog>());

    [Fact]
    public async Task Writes_one_row_as_the_app_role_with_user_actor()
    {
        var user = await Sql.InsertUser(db.AdminConnectionString, "alice");

        await Create(db.AppConnectionString).WriteAsync(
            AuditEvent.SignIn, AuditOutcome.Failure, user, AuditReason.BadCredentials, IPAddress.Parse("203.0.113.7"));

        await using var connection = await PostgresFixture.Open(db.AdminConnectionString);
        await using var command = new NpgsqlCommand(
            "select event_type, outcome, actor, user_id, reason, host(source_ip), occurred_at > now() - interval '1 minute' from macro.audit_events",
            connection);
        await using var reader = await command.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        Assert.Equal("sign_in", reader.GetString(0));
        Assert.Equal("failure", reader.GetString(1));
        Assert.Equal("user", reader.GetString(2));
        Assert.Equal(user, reader.GetGuid(3));
        Assert.Equal("bad_credentials", reader.GetString(4));
        Assert.Equal("203.0.113.7", reader.GetString(5));
        Assert.True(reader.GetBoolean(6));
        Assert.False(await reader.ReadAsync());
    }

    [Fact]
    public async Task Uses_the_system_actor_when_no_user_is_known()
    {
        await Create(db.AppConnectionString).WriteAsync(AuditEvent.RateLimited, AuditOutcome.Failure, null, AuditReason.RateLimited, null);

        Assert.Equal("system", await Sql.Scalar<string>(db.AdminConnectionString, "select actor from macro.audit_events"));
    }

    [Fact]
    public async Task Every_event_and_reason_maps_to_a_value_the_database_accepts()
    {
        var log = Create(db.AppConnectionString);
        foreach (var auditEvent in Enum.GetValues<AuditEvent>())
        {
            await log.WriteAsync(auditEvent, AuditOutcome.Info, null, null, null);
        }
        foreach (var reason in Enum.GetValues<AuditReason>())
        {
            await log.WriteAsync(AuditEvent.SignIn, AuditOutcome.Failure, null, reason, null);
        }

        Assert.Equal((long)(Enum.GetValues<AuditEvent>().Length + Enum.GetValues<AuditReason>().Length),
            await Sql.Scalar<long>(db.AdminConnectionString, "select count(*) from macro.audit_events"));
        Assert.DoesNotContain(_logs.Entries, e => e.Level >= LogLevel.Error);
    }

    [Fact]
    public async Task A_database_failure_is_logged_and_never_thrown_into_the_request()
    {
        var unreachable = new NpgsqlConnectionStringBuilder(db.AppConnectionString) { Port = 1, Timeout = 2 }.ConnectionString;

        await Create(unreachable).WriteAsync(AuditEvent.SignIn, AuditOutcome.Success, Guid.NewGuid(), null, null);

        Assert.Contains(_logs.Entries, e => e.Level == LogLevel.Error && e.Text.Contains("sign_in"));
    }
}
