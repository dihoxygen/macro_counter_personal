using System.Net;
using System.Security.Cryptography;
using System.Text;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;

namespace MacroCounter.Api.Tests.Auth;

/// <summary>
/// Remember User (004 US3, FR-015 – FR-019, research R3): a browser skips only the authenticator step for one
/// account, for a fixed 7 days, and every revocation path ends it.
/// </summary>
[Collection("Postgres")]
public class TrustedDeviceTests(PostgresFixture db) : IAsyncLifetime
{
    private const string DeviceCookie = "__Host-mc_device";

    private ApiFactory _factory = null!;
    private ActiveUser _carol = null!;
    private int _step;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _factory = new ApiFactory(db, apiKey: null);
        _carol = await TestUsers.ActivateDirectlyAsync(db, _factory, "carol");
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    /// <summary>
    /// A code that differs from the last one used, so the replay guard (which remembers only the last code) never
    /// refuses it; alternating two steps keeps it inside the authenticator's time window.
    /// </summary>
    private string NextCode(ActiveUser user) => user.Code(++_step % 2);

    private async Task<AuthClient> Browser()
    {
        var client = new AuthClient(_factory);
        await client.SessionAsync();
        return client;
    }

    /// <summary>Signs in fully with the box ticked, then signs out normally (which keeps the device).</summary>
    private async Task<AuthClient> RememberedBrowser(ActiveUser user)
    {
        var client = await Browser();
        var state = await client.SignInAsync(user.Username, user.Password, NextCode(user), rememberDevice: true);
        Assert.Equal("signed_in", state.GetProperty("state").GetString());
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/auth/sign-out")).StatusCode);
        await client.SessionAsync();
        return client;
    }

    private static string? DeviceToken(AuthClient client) => client.Cookies.GetCookies(client.Address)[DeviceCookie]?.Value;

    private Task<long> Devices(string? username = null) => Sql.Scalar<long>(db.AdminConnectionString, """
        select count(*) from macro.trusted_devices d join macro.users u on u.id = d.user_id
        where @u::text is null or u.username = @u::text
        """, ("u", username));

    private Task<long> Audits(string eventType, string? reason = null) => Sql.Scalar<long>(db.AdminConnectionString,
        "select count(*) from macro.audit_events where event_type = @e and reason is not distinct from @r",
        ("e", eventType), ("r", reason));

    private static string State(System.Text.Json.JsonElement json) => json.GetProperty("state").GetString()!;

    // ----- Remembering ------------------------------------------------------------------------------------

    [Fact]
    public async Task Ticking_the_box_and_entering_the_code_remembers_this_browser()
    {
        var client = await Browser();
        await client.PasswordStepAsync("carol", _carol.Password, rememberDevice: true);
        var response = await client.PostAsync("/api/auth/mfa", new { code = NextCode(_carol) });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var setCookie = response.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith(DeviceCookie + "=", StringComparison.Ordinal));
        Assert.Contains("httponly", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("secure", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=strict", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("path=/", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("domain=", setCookie, StringComparison.OrdinalIgnoreCase);
        var expires = client.Cookies.GetCookies(client.Address)[DeviceCookie]!.Expires.ToUniversalTime();
        Assert.InRange(expires, _factory.Clock.GetUtcNow().UtcDateTime.AddDays(7).AddMinutes(-1),
            _factory.Clock.GetUtcNow().UtcDateTime.AddDays(7).AddMinutes(1));

        Assert.Equal(1L, await Devices("carol"));
        var row = await Sql.Scalar<string>(db.AdminConnectionString, "select row_to_json(d)::text from macro.trusted_devices d");
        Assert.DoesNotContain(DeviceToken(client)!, row);
        Assert.Equal(1L, await Audits("device_remembered"));
        Assert.True((await AuthClient.Json(response)).GetProperty("deviceRemembered").GetBoolean());
    }

    [Theory]
    [InlineData(null)]
    [InlineData(true)]
    public async Task A_remembered_browser_needs_only_the_password(bool? rememberDevice)
    {
        var client = await RememberedBrowser(_carol);
        var expiresBefore = await Sql.Scalar<DateTime>(db.AdminConnectionString, "select expires_at from macro.trusted_devices");
        _factory.Clock.Advance(TimeSpan.FromDays(3));

        var state = await client.PasswordStepAsync("carol", _carol.Password, rememberDevice);

        Assert.Equal("signed_in", State(state));
        Assert.Equal(HttpStatusCode.OK, (await client.Http.GetAsync("/api/status")).StatusCode);
        Assert.Equal(1L, await Audits("sign_in", "remembered_device"));
        // Using the device never extends it (FR-017).
        Assert.Equal(expiresBefore, await Sql.Scalar<DateTime>(db.AdminConnectionString, "select expires_at from macro.trusted_devices"));
    }

    [Fact]
    public async Task A_remembered_browser_still_needs_the_right_password()
    {
        var client = await RememberedBrowser(_carol);

        var response = await client.PostAsync("/api/auth/sign-in", new { username = "carol", password = "not the password" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(1L, await Devices());
    }

    // ----- What does not get remembered -------------------------------------------------------------------

    [Fact]
    public async Task An_abandoned_code_step_remembers_nothing()
    {
        var client = await Browser();
        await client.PasswordStepAsync("carol", _carol.Password, rememberDevice: true);

        Assert.Null(DeviceToken(client));
        Assert.Equal(0L, await Devices());
    }

    [Theory]
    [InlineData(null)]
    [InlineData(false)]
    public async Task Without_ticking_the_box_nothing_is_remembered(bool? rememberDevice)
    {
        var client = await Browser();
        await client.SignInAsync("carol", _carol.Password, NextCode(_carol), rememberDevice);

        Assert.Null(DeviceToken(client));
        Assert.Equal(0L, await Devices());
    }

    // ----- Limits on use ----------------------------------------------------------------------------------

    [Fact]
    public async Task Another_account_on_the_same_browser_still_needs_its_code_and_leaves_the_device_alone()
    {
        var dave = await TestUsers.ActivateDirectlyAsync(db, _factory, "dave");
        var client = await RememberedBrowser(_carol);
        var token = DeviceToken(client);

        Assert.Equal("mfa", State(await client.PasswordStepAsync("dave", dave.Password)));
        Assert.Equal("signed_in", State(await client.MfaAsync(NextCode(dave))));
        await client.PostAsync("/api/auth/sign-out");
        await client.SessionAsync();

        Assert.Equal(0L, await Devices("dave"));
        Assert.Equal(token, DeviceToken(client));
        Assert.Equal("signed_in", State(await client.PasswordStepAsync("carol", _carol.Password)));
    }

    [Fact]
    public async Task After_7_days_the_code_is_asked_for_again()
    {
        var client = await RememberedBrowser(_carol);
        _factory.Clock.Advance(TimeSpan.FromDays(7) + TimeSpan.FromSeconds(1));
        // The cookie's own expiry is only a convenience: the server's clock decides. Keep sending it.
        client.Cookies.SetCookies(client.Address, $"{DeviceCookie}={DeviceToken(client)}; path=/; secure");

        Assert.Equal("mfa", State(await client.PasswordStepAsync("carol", _carol.Password)));
    }

    [Fact]
    public async Task A_tampered_or_unknown_device_cookie_is_ignored()
    {
        var client = await Browser();
        client.Cookies.SetCookies(client.Address, $"{DeviceCookie}=not-a-real-token; path=/; secure");

        Assert.False((await client.SessionAsync()).GetProperty("deviceRemembered").GetBoolean());
        Assert.Equal("mfa", State(await client.PasswordStepAsync("carol", _carol.Password)));
    }

    // ----- Opting out and revocation ----------------------------------------------------------------------

    [Fact]
    public async Task Unticking_the_box_forgets_the_device()
    {
        var client = await RememberedBrowser(_carol);

        Assert.Equal("mfa", State(await client.PasswordStepAsync("carol", _carol.Password, rememberDevice: false)));

        Assert.Null(DeviceToken(client));
        Assert.Equal(0L, await Devices());
        Assert.Equal(1L, await Audits("device_forgotten"));
    }

    [Fact]
    public async Task A_normal_sign_out_keeps_the_device()
    {
        var client = await RememberedBrowser(_carol);

        Assert.NotNull(DeviceToken(client));
        Assert.Equal(1L, await Devices());
        Assert.True((await client.SessionAsync()).GetProperty("deviceRemembered").GetBoolean());
    }

    public static TheoryData<string> Revocations => new() { "sign-out-everywhere", "password-change", "reset", "disable" };

    [Theory]
    [MemberData(nameof(Revocations))]
    public async Task Every_revocation_path_ends_remembering_on_every_device(string revocation)
    {
        var phone = await RememberedBrowser(_carol);
        var laptop = await RememberedBrowser(_carol);
        Assert.Equal(2L, await Devices());

        switch (revocation)
        {
            case "sign-out-everywhere":
                await laptop.SignInAsync("carol", _carol.Password);
                Assert.Equal(HttpStatusCode.NoContent, (await laptop.PostAsync("/api/auth/sign-out-everywhere")).StatusCode);
                break;
            case "password-change":
                await laptop.SignInAsync("carol", _carol.Password);
                Assert.Equal(HttpStatusCode.NoContent, (await laptop.PostAsync("/api/auth/password", new
                {
                    currentPassword = _carol.Password,
                    code = NextCode(_carol),
                    newPassword = "a brand new and private passphrase",
                })).StatusCode);
                _carol = _carol with { Password = "a brand new and private passphrase" };
                break;
            case "reset":
                await Sql.Execute(db.AdminConnectionString, "select macro_admin.reset_user('carol')");
                break;
            case "disable":
                await Sql.Execute(db.AdminConnectionString, "select macro_admin.disable_user('carol')");
                break;
        }

        Assert.Equal(0L, await Devices());
        if (revocation is "sign-out-everywhere" or "password-change")
        {
            await phone.SessionAsync();
            Assert.Equal("mfa", State(await phone.PasswordStepAsync("carol", _carol.Password)));
        }
    }

    // ----- Replacing and protecting the cookie ------------------------------------------------------------

    [Fact]
    public async Task Another_account_that_ticks_the_box_replaces_the_device()
    {
        var dave = await TestUsers.ActivateDirectlyAsync(db, _factory, "dave");
        var client = await RememberedBrowser(_carol);
        var carolToken = DeviceToken(client);

        await client.SignInAsync("dave", dave.Password, NextCode(dave), rememberDevice: true);

        Assert.Equal(0L, await Devices("carol"));
        Assert.Equal(1L, await Devices("dave"));
        Assert.NotEqual(carolToken, DeviceToken(client));
    }

    [Fact]
    public async Task The_row_holds_only_a_hash_of_the_token()
    {
        var client = await RememberedBrowser(_carol);
        var stored = await Sql.Scalar<byte[]>(db.AdminConnectionString, "select token_hash from macro.trusted_devices");

        Assert.Equal(32, stored.Length);
        // The cookie value is the Data-Protection-wrapped token, never the hash itself.
        Assert.NotEqual(Convert.ToHexString(stored), DeviceToken(client), StringComparer.OrdinalIgnoreCase);
        Assert.NotEqual(stored, SHA256.HashData(Encoding.UTF8.GetBytes(DeviceToken(client)!)));
    }

    // ----- Session state and setup ------------------------------------------------------------------------

    [Fact]
    public async Task Session_state_says_whether_this_browser_is_remembered()
    {
        var plain = await Browser();
        Assert.False((await plain.SessionAsync()).GetProperty("deviceRemembered").GetBoolean());

        var remembered = await RememberedBrowser(_carol);
        Assert.True((await remembered.SessionAsync()).GetProperty("deviceRemembered").GetBoolean());
    }

    [Fact]
    public async Task First_sign_in_remembers_the_browser_only_when_setup_completes()
    {
        var code = await TestUsers.InviteAsync(db, "erin");
        var client = await Browser();
        await client.PasswordStepAsync("erin", code, rememberDevice: true);
        await client.PostForStateAsync("/api/auth/setup/password", new { newPassword = TestUsers.DefaultPassword });
        var secret = (await AuthClient.Json(await client.PostAsync("/api/auth/setup/totp"))).GetProperty("setupKey").GetString()!.Replace(" ", "");
        await client.PostForStateAsync("/api/auth/setup/totp/confirm", new { code = Totp.Compute(secret, DateTimeOffset.UtcNow) });
        Assert.Equal(0L, await Devices("erin"));

        var done = await client.PostForStateAsync("/api/auth/setup/notice", new { acknowledged = true });

        Assert.Equal("signed_in", State(done));
        Assert.Equal(1L, await Devices("erin"));
        Assert.NotNull(DeviceToken(client));
    }

    [Fact]
    public async Task An_abandoned_first_sign_in_remembers_nothing()
    {
        var code = await TestUsers.InviteAsync(db, "erin");
        var client = await Browser();
        await client.PasswordStepAsync("erin", code, rememberDevice: true);
        await client.PostForStateAsync("/api/auth/setup/password", new { newPassword = TestUsers.DefaultPassword });

        Assert.Equal(0L, await Devices());
        Assert.Null(DeviceToken(client));
    }
}
