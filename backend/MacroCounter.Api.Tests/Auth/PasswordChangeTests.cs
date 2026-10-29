using System.Net;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;

namespace MacroCounter.Api.Tests.Auth;

/// <summary>
/// POST /api/auth/password (contracts/auth-api.yaml): a signed-in person changes their own password with
/// the current password and an authenticator code (ASVS 2.1.5, 2.1.6, 3.3.3; checklists/asvs-l2.md G1).
/// </summary>
[Collection("Postgres")]
public class PasswordChangeTests(PostgresFixture db) : IAsyncLifetime
{
    private const string NewPassword = "a different and still unbreached passphrase";

    private ApiFactory _factory = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _factory = new ApiFactory(db, apiKey: null);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private static async Task AssertProblem(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal(code, (await AuthClient.Json(response)).GetProperty("code").GetString());
    }

    private static Task<long> AuditCount(PostgresFixture db, string eventType, string? reason = null) =>
        Sql.Scalar<long>(db.AdminConnectionString,
            "select count(*) from macro.audit_events where event_type = @e and reason is not distinct from @r",
            ("e", eventType), ("r", (object?)reason ?? DBNull.Value));

    [Fact]
    public async Task The_password_changes_other_sessions_end_and_this_one_stays_signed_in()
    {
        var (client, carol) = await TestUsers.ActivateAsync(db, _factory, "carol");
        var other = new AuthClient(_factory);
        await other.SessionAsync();
        await other.SignInAsync("carol", carol.Password, carol.Code(1));

        var response = await client.PostAsync("/api/auth/password",
            new { currentPassword = carol.Password, code = carol.Code(2), newPassword = NewPassword });

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.Http.GetAsync("/api/status")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await other.Http.GetAsync("/api/status")).StatusCode);
        Assert.Equal(2L, await AuditCount(db, "password_set")); // one from setup, one now

        // Later sign-ins need the new password; the old one no longer works.
        _factory.Clock.Advance(TimeSpan.FromMinutes(6)); // past the code replay window
        var next = new AuthClient(_factory);
        await next.SessionAsync();
        await AssertProblem(await next.PostAsync("/api/auth/sign-in", new { username = "carol", password = carol.Password }),
            HttpStatusCode.Unauthorized, "sign_in_failed");
        Assert.Equal("signed_in", (await next.SignInAsync("carol", NewPassword, carol.Code(1))).GetProperty("state").GetString());
    }

    [Fact]
    public async Task A_wrong_current_password_or_code_gets_one_message_and_changes_nothing()
    {
        var (client, carol) = await TestUsers.ActivateAsync(db, _factory, "carol");
        var wrongCode = carol.Code(1) == "000000" ? "111111" : "000000";

        await AssertProblem(await client.PostAsync("/api/auth/password",
            new { currentPassword = "not the current password", code = carol.Code(1), newPassword = NewPassword }),
            HttpStatusCode.BadRequest, "invalid_credentials");
        await AssertProblem(await client.PostAsync("/api/auth/password",
            new { currentPassword = carol.Password, code = wrongCode, newPassword = NewPassword }),
            HttpStatusCode.BadRequest, "invalid_credentials");

        Assert.Equal(HttpStatusCode.OK, (await client.Http.GetAsync("/api/status")).StatusCode);
        Assert.Equal(2L, await AuditCount(db, "password_rejected", "bad_credentials"));
        Assert.Equal(1L, await AuditCount(db, "password_set"));
    }

    [Fact]
    public async Task The_code_used_to_sign_in_cannot_be_used_again_to_change_the_password()
    {
        var (_, carol) = await TestUsers.ActivateAsync(db, _factory, "carol");
        var client = new AuthClient(_factory);
        await client.SessionAsync();
        var code = carol.Code(1);
        await client.SignInAsync("carol", carol.Password, code);

        await AssertProblem(await client.PostAsync("/api/auth/password",
            new { currentPassword = carol.Password, code, newPassword = NewPassword }),
            HttpStatusCode.BadRequest, "invalid_credentials");
    }

    [Theory]
    [InlineData("too short", "too_short")]
    [InlineData("password1234", "breached")]
    [InlineData("carol has a long password", "contains_username")]
    public async Task The_new_password_follows_the_setup_rules(string newPassword, string reason)
    {
        var (client, carol) = await TestUsers.ActivateAsync(db, _factory, "carol");

        var response = await client.PostAsync("/api/auth/password",
            new { currentPassword = carol.Password, code = carol.Code(1), newPassword });

        await AssertProblem(response, HttpStatusCode.BadRequest, "password_rejected");
        Assert.Contains(reason, (await AuthClient.Json(response)).GetProperty("reasons").EnumerateArray().Select(r => r.GetString()));
        Assert.Equal(1L, await AuditCount(db, "password_set"));
    }

    [Fact]
    public async Task An_unavailable_breach_check_refuses_the_change()
    {
        var (client, carol) = await TestUsers.ActivateAsync(db, _factory, "carol");
        _factory.Breach.Unavailable = true;

        await AssertProblem(await client.PostAsync("/api/auth/password",
            new { currentPassword = carol.Password, code = carol.Code(1), newPassword = NewPassword }),
            HttpStatusCode.ServiceUnavailable, "breach_check_unavailable");
    }

    [Fact]
    public async Task Every_field_is_required_and_unknown_fields_are_refused()
    {
        var (client, carol) = await TestUsers.ActivateAsync(db, _factory, "carol");

        await AssertProblem(await client.PostAsync("/api/auth/password", new { currentPassword = carol.Password, newPassword = NewPassword }),
            HttpStatusCode.BadRequest, "invalid_request");
        await AssertProblem(await client.PostAsync("/api/auth/password",
            new { currentPassword = carol.Password, code = carol.Code(1), newPassword = NewPassword, userId = carol.Id }),
            HttpStatusCode.BadRequest, "invalid_request");
    }
}
