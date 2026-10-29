using System.Net;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;

namespace MacroCounter.Api.Tests.Auth;

/// <summary>
/// The authenticator step, POST /api/auth/mfa (004 FR-006 – FR-010, FR-020, research R1/R2), over HTTP.
/// </summary>
[Collection("Postgres")]
public class MfaStepTests(PostgresFixture db) : IAsyncLifetime
{
    private ApiFactory _factory = null!;
    private ActiveUser _carol = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _factory = new ApiFactory(db, apiKey: null);
        _carol = await TestUsers.ActivateDirectlyAsync(db, _factory, "carol");
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<AuthClient> Pending()
    {
        var client = new AuthClient(_factory);
        await client.SessionAsync();
        Assert.Equal("mfa", (await client.PasswordStepAsync("carol", _carol.Password)).GetProperty("state").GetString());
        return client;
    }

    private string WrongCode => _carol.Code() == "000000" ? "111111" : "000000";

    private static async Task<(HttpStatusCode Status, string? Code, int? AttemptsLeft)> Problem(HttpResponseMessage response)
    {
        var json = await AuthClient.Json(response);
        return (response.StatusCode,
            json.TryGetProperty("code", out var code) ? code.GetString() : null,
            json.TryGetProperty("attemptsLeft", out var left) ? left.GetInt32() : null);
    }

    private Task<long> Audits(string eventType, string? reason) => Sql.Scalar<long>(db.AdminConnectionString,
        "select count(*) from macro.audit_events where event_type = @e and reason is not distinct from @r",
        ("e", eventType), ("r", reason));

    [Fact]
    public async Task The_right_code_replaces_the_pending_session_with_a_new_full_one()
    {
        var client = await Pending();
        var pendingCookie = client.SessionCookieHeader();

        var state = await client.MfaAsync(_carol.Code());

        Assert.Equal("signed_in", state.GetProperty("state").GetString());
        Assert.Equal(_carol.Id.ToString(), state.GetProperty("user").GetProperty("id").GetString());
        Assert.NotEqual(pendingCookie, client.SessionCookieHeader());
        Assert.Equal(HttpStatusCode.OK, (await client.Http.GetAsync("/api/status")).StatusCode);
        Assert.Equal(0L, await Sql.Scalar<long>(db.AdminConnectionString, "select count(*) from macro.sessions where kind = 'mfa'"));
        Assert.Equal(1L, await Audits("sign_in", null));

        // The pending cookie is dead: replaying it gets nowhere.
        var replay = _factory.CreateDefaultClient(AuthClient.BaseAddress);
        replay.DefaultRequestHeaders.Add("Cookie", pendingCookie);
        Assert.Equal(HttpStatusCode.Unauthorized, (await replay.GetAsync("/api/status")).StatusCode);
    }

    [Fact]
    public async Task Wrong_codes_count_down_and_the_fifth_ends_the_pending_sign_in()
    {
        var client = await Pending();

        for (var left = 4; left >= 1; left--)
        {
            Assert.Equal((HttpStatusCode.BadRequest, "invalid_code", left), await Problem(await client.PostAsync("/api/auth/mfa", new { code = WrongCode })));
        }
        // The 5th: still 400 so the screen can say "too many codes", but the pending sign-in is over.
        Assert.Equal((HttpStatusCode.BadRequest, "invalid_code", 0), await Problem(await client.PostAsync("/api/auth/mfa", new { code = WrongCode })));

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/api/auth/mfa", new { code = _carol.Code() })).StatusCode);
        Assert.Equal(0L, await Sql.Scalar<long>(db.AdminConnectionString, "select count(*) from macro.sessions"));
        Assert.Equal(5L, await Audits("sign_in", "invalid_code"));
    }

    [Fact]
    public async Task A_code_used_once_is_refused_the_second_time()
    {
        var code = _carol.Code();
        await (await Pending()).MfaAsync(code);

        var again = await Pending();
        Assert.Equal((HttpStatusCode.BadRequest, "invalid_code", 4), await Problem(await again.PostAsync("/api/auth/mfa", new { code })));
    }

    [Fact]
    public async Task Wrong_passwords_and_wrong_codes_share_one_lockout()
    {
        var client = new AuthClient(_factory);
        await client.SessionAsync();
        for (var i = 0; i < 5; i++)
        {
            Assert.Equal(HttpStatusCode.Unauthorized,
                (await client.PostAsync("/api/auth/sign-in", new { username = "carol", password = $"wrong password {i}" })).StatusCode);
        }
        var pending = await Pending();
        for (var i = 0; i < 4; i++) await pending.PostAsync("/api/auth/mfa", new { code = WrongCode });
        // Correct passwords in between reset nothing (threat T10).
        pending = await Pending();
        await pending.PostAsync("/api/auth/mfa", new { code = WrongCode });

        var locked = await client.PostAsync("/api/auth/sign-in", new { username = "carol", password = _carol.Password });
        Assert.Equal(HttpStatusCode.TooManyRequests, locked.StatusCode);
    }

    [Fact]
    public async Task A_lockout_that_starts_while_waiting_refuses_the_code()
    {
        var client = await Pending();
        await Sql.Execute(db.AdminConnectionString, "update macro.users set lockout_end = now() + interval '1 hour'");

        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.PostAsync("/api/auth/mfa", new { code = _carol.Code() })).StatusCode);
    }

    [Fact]
    public async Task The_pending_sign_in_ends_after_5_minutes()
    {
        var client = await Pending();
        _factory.Clock.Advance(TimeSpan.FromMinutes(5) + TimeSpan.FromSeconds(1));

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/api/auth/mfa", new { code = _carol.Code() })).StatusCode);
    }

    [Fact]
    public async Task Use_a_different_account_discards_the_pending_sign_in()
    {
        var client = await Pending();

        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/auth/sign-out")).StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/api/auth/mfa", new { code = _carol.Code() })).StatusCode);
        Assert.Equal("signed_out", (await client.SessionAsync()).GetProperty("state").GetString());
    }

    [Fact]
    public async Task A_pending_sign_in_cannot_use_the_app()
    {
        var client = await Pending();

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.Http.GetAsync("/api/status")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/api/auth/sign-out-everywhere")).StatusCode);
    }

    [Fact]
    public async Task Two_tabs_sharing_one_pending_sign_in_finish_only_once()
    {
        var first = await Pending();
        var second = new AuthClient(_factory) { Csrf = first.Csrf };
        second.Cookies.SetCookies(AuthClient.BaseAddress, first.SessionCookieHeader() + "; path=/; secure");

        await first.MfaAsync(_carol.Code());

        Assert.Equal(HttpStatusCode.Unauthorized, (await second.PostAsync("/api/auth/mfa", new { code = _carol.Code(1) })).StatusCode);
    }

    [Fact]
    public async Task With_only_the_notice_left_the_code_leads_to_a_new_setup_session_at_the_notice()
    {
        await Sql.Execute(db.AdminConnectionString,
            "update macro.users set ai_notice_ack_at = null, setup_expires_at = now() + interval '1 day'");
        var client = await Pending();
        var pendingCookie = client.SessionCookieHeader();

        var state = await client.MfaAsync(_carol.Code());

        Assert.Equal("setup", state.GetProperty("state").GetString());
        Assert.Equal("notice", state.GetProperty("setupStep").GetString());
        Assert.NotEqual(pendingCookie, client.SessionCookieHeader());
        Assert.Equal(1L, await Sql.Scalar<long>(db.AdminConnectionString, "select count(*) from macro.sessions where kind = 'setup'"));
        Assert.Equal(0L, await Sql.Scalar<long>(db.AdminConnectionString, "select count(*) from macro.sessions where kind = 'mfa'"));

        var done = await client.PostForStateAsync("/api/auth/setup/notice", new { acknowledged = true });
        Assert.Equal("signed_in", done.GetProperty("state").GetString());
    }

    [Fact]
    public async Task A_full_session_cannot_call_the_authenticator_step()
    {
        var client = await Pending();
        await client.MfaAsync(_carol.Code());

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/api/auth/mfa", new { code = _carol.Code(1) })).StatusCode);
    }
}
