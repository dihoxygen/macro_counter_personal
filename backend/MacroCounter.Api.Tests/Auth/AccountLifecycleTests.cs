using System.Net;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;

namespace MacroCounter.Api.Tests.Auth;

/// <summary>What the owner's procedures mean for a person using the app (US2.4, US2.5, SC-005).</summary>
[Collection("Postgres")]
public class AccountLifecycleTests(PostgresFixture db) : IAsyncLifetime
{
    private ApiFactory _factory = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _factory = new ApiFactory(db, apiKey: null);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<HttpStatusCode> SignInStatus(ActiveUser user, int stepsAhead)
    {
        var client = new AuthClient(_factory);
        await client.SessionAsync();
        var response = await client.PostAsync("/api/auth/sign-in",
            new { username = user.Username, password = user.Password, code = user.Code(stepsAhead) });
        return response.StatusCode;
    }

    [Fact]
    public async Task Disabling_ends_access_on_the_very_next_request_and_enabling_restores_it()
    {
        var (client, carol) = await TestUsers.ActivateAsync(db, _factory, "carol");
        Assert.Equal(HttpStatusCode.OK, (await client.Http.GetAsync("/api/status")).StatusCode);

        await Sql.Execute(db.AdminConnectionString, "select macro_admin.disable_user('carol')");

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.Http.GetAsync("/api/status")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, await SignInStatus(carol, 1));

        await Sql.Execute(db.AdminConnectionString, "select macro_admin.enable_user('carol')");

        Assert.Equal(HttpStatusCode.OK, await SignInStatus(carol, 2));
    }

    [Fact]
    public async Task After_a_reset_the_old_credentials_fail_and_the_new_code_starts_setup()
    {
        var (client, carol) = await TestUsers.ActivateAsync(db, _factory, "carol");

        var code = await Sql.Scalar<string>(db.AdminConnectionString, "select macro_admin.reset_user('carol')");

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.Http.GetAsync("/api/status")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, await SignInStatus(carol, 1));

        var fresh = new AuthClient(_factory);
        await fresh.SessionAsync();
        var state = await fresh.SignInAsync("carol", code);
        Assert.Equal("setup", state.GetProperty("state").GetString());
        Assert.Equal("password", state.GetProperty("setupStep").GetString());
    }

    [Fact]
    public async Task An_expired_invite_is_refused_and_audited()
    {
        var code = await TestUsers.InviteAsync(db, "carol");
        await Sql.Execute(db.AdminConnectionString, "update macro.users set setup_expires_at = now() - interval '1 minute'");
        _factory.Clock.SetUtcNow(DateTimeOffset.UtcNow.AddMinutes(1));

        var client = new AuthClient(_factory);
        await client.SessionAsync();
        var response = await client.PostAsync("/api/auth/sign-in", new { username = "carol", password = code });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(1L, await Sql.Scalar<long>(db.AdminConnectionString,
            "select count(*) from macro.audit_events where reason = 'setup_expired'"));
    }

    [Fact]
    public async Task Revoking_sessions_signs_the_person_out_without_disabling_them()
    {
        var (client, carol) = await TestUsers.ActivateAsync(db, _factory, "carol");

        await Sql.Execute(db.AdminConnectionString, "select macro_admin.revoke_sessions('carol')");

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.Http.GetAsync("/api/status")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, await SignInStatus(carol, 1));
    }
}
