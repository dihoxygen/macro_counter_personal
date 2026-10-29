using MacroCounter.Api.Audit;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;

namespace MacroCounter.Api.Tests.Audit;

/// <summary>SC-009 / FR-024: every kind of security event leaves an audit row with a time and an outcome.</summary>
[Collection("Postgres")]
public class AuditCoverageTests(PostgresFixture db) : IAsyncLifetime
{
    private static readonly string[] AboutAKnownAccount =
    [
        "account_invited", "account_reset", "account_disabled", "account_enabled", "account_unlocked",
        "setup_started", "password_set", "password_rejected", "totp_enrolled", "totp_failed", "ai_notice_acknowledged",
        "sign_out", "sign_out_everywhere", "session_revoked", "sign_in_locked", "quota_exceeded",
        "password_accepted", "device_remembered", "device_forgotten",
    ];

    public Task InitializeAsync() => db.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Every_audit_event_type_is_recorded_with_time_outcome_and_account()
    {
        await using var factory = new ApiFactory(db, "test-key-not-real", FakeEstimator.Returning(FakeEstimator.Banana));
        AuditScenario.Configure(factory);

        await new AuditScenario(db, factory).RunAsync();

        var rows = await AuditScenario.AuditRows(db);
        var missing = AuditLog.EventCodes.Where(code => rows.All(r => r.Event != code)).ToList();
        Assert.True(missing.Count == 0, "No audit row for: " + string.Join(", ", missing));
        Assert.All(rows, r => Assert.True(r.HasTime));
        Assert.All(rows, r => Assert.Contains(r.Outcome, AuditLog.OutcomeCodes));
        Assert.All(rows.Where(r => AboutAKnownAccount.Contains(r.Event)),
            r => Assert.True(r.HasUser, $"{r.Event} should name the account"));
        Assert.Contains(rows, r => r is { Event: "sign_in", Outcome: "success", HasUser: true });
        Assert.Contains(rows, r => r is { Event: "sign_in", Outcome: "failure", HasUser: false }); // the unknown name
    }
}
