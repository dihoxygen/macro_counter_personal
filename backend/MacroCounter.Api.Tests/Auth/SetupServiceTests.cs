using System.Buffers.Binary;
using System.Security.Claims;
using MacroCounter.Api.Auth;
using MacroCounter.Api.Data;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;

namespace MacroCounter.Api.Tests.Auth;

/// <summary>First-time setup: password → authenticator → notice, in order (FR-004, research R3/R4).</summary>
[Collection("Postgres")]
public class SetupServiceTests(PostgresFixture db) : IAsyncLifetime
{
    private const string GoodPassword = "a long and unbreached test passphrase";
    private ApiFactory _factory = null!;
    private Guid _userId;
    private string _sessionKey = "";

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _factory = new ApiFactory(db, apiKey: null);
        await TestUsers.InviteAsync(db, "carol");
        _userId = await Sql.Scalar<Guid>(db.AdminConnectionString, "select id from macro.users");
        var ticketStore = _factory.Services.GetRequiredService<PostgresTicketStore>();
        _sessionKey = await ticketStore.StoreAsync(new AuthenticationTicket(
            new ClaimsPrincipal(new ClaimsIdentity(
                [new Claim(AuthClaims.Subject, _userId.ToString()), new Claim(AuthClaims.SessionKind, SessionRecord.SetupKind)],
                "test")),
            "test"));
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<SetupResult> Run(Func<SetupService, AppUser, Task<SetupResult>> step)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var user = (await users.FindByIdAsync(_userId.ToString()))!;
        return await step(scope.ServiceProvider.GetRequiredService<SetupService>(), user);
    }

    private Task<SetupResult> SetPassword(string password) =>
        Run((s, u) => s.SetPasswordAsync(u, password, _sessionKey, null, CancellationToken.None));

    private Task<SetupResult> StartTotp() => Run((s, u) => s.StartTotpAsync(u, CancellationToken.None));

    private Task<SetupResult> ConfirmTotp(string code) =>
        Run((s, u) => s.ConfirmTotpAsync(u, code, _sessionKey, null, CancellationToken.None));

    private Task<SetupResult> AcknowledgeNotice() => Run((s, u) => s.AcknowledgeNoticeAsync(u, null, CancellationToken.None));

    private Task<long> AuditCount(string eventType) => Sql.Scalar<long>(db.AdminConnectionString,
        "select count(*) from macro.audit_events where event_type = @e", ("e", eventType));

    private async Task<string> EnrolledSecret()
    {
        Assert.IsType<SetupResult.Advanced>(await SetPassword(GoodPassword));
        return Assert.IsType<SetupResult.Enrollment>(await StartTotp()).SetupKey.Replace(" ", "");
    }

    [Fact]
    public async Task Steps_out_of_order_are_refused_with_the_expected_step()
    {
        Assert.Equal(SetupSteps.Password, Assert.IsType<SetupResult.WrongStep>(await StartTotp()).Expected);
        Assert.Equal(SetupSteps.Password, Assert.IsType<SetupResult.WrongStep>(await ConfirmTotp("123456")).Expected);
        Assert.Equal(SetupSteps.Password, Assert.IsType<SetupResult.WrongStep>(await AcknowledgeNotice()).Expected);

        await SetPassword(GoodPassword);
        Assert.Equal(SetupSteps.Totp, Assert.IsType<SetupResult.WrongStep>(await SetPassword(GoodPassword + "!")).Expected);
        Assert.Equal(SetupSteps.Totp, Assert.IsType<SetupResult.WrongStep>(await AcknowledgeNotice()).Expected);
    }

    [Fact]
    public async Task Setting_the_password_uses_up_the_temporary_code_and_rotates_the_stamp()
    {
        var stampBefore = await Sql.Scalar<string>(db.AdminConnectionString, "select security_stamp from macro.users");

        var result = Assert.IsType<SetupResult.Advanced>(await SetPassword(GoodPassword));

        Assert.Equal(SetupSteps.Totp, result.NextStep);
        Assert.True(await Sql.Scalar<bool>(db.AdminConnectionString, "select temp_code_hash is null from macro.users"));
        Assert.NotEqual(stampBefore, await Sql.Scalar<string>(db.AdminConnectionString, "select security_stamp from macro.users"));
        // The current setup session follows the new stamp; it is not ended by its own password change.
        Assert.True(await Sql.Scalar<bool>(db.AdminConnectionString,
            "select s.security_stamp = u.security_stamp from macro.sessions s join macro.users u on u.id = s.user_id"));
        Assert.Equal(1L, await AuditCount("password_set"));
    }

    [Fact]
    public async Task The_stored_hash_is_pbkdf2_sha512_with_210000_iterations()
    {
        await SetPassword(GoodPassword);

        var hash = Convert.FromBase64String(await Sql.Scalar<string>(db.AdminConnectionString, "select password_hash from macro.users"));
        Assert.Equal(0x01, hash[0]); // Identity format v3
        Assert.Equal(2u, BinaryPrimitives.ReadUInt32BigEndian(hash.AsSpan(1))); // KeyDerivationPrf.HMACSHA512
        Assert.Equal(210_000u, BinaryPrimitives.ReadUInt32BigEndian(hash.AsSpan(5)));
        var row = await Sql.Scalar<string>(db.AdminConnectionString, "select row_to_json(u)::text from macro.users u");
        Assert.DoesNotContain(GoodPassword, row);
    }

    [Fact]
    public async Task A_policy_failure_is_rejected_with_reasons_and_audited()
    {
        var result = Assert.IsType<SetupResult.PasswordRejected>(await SetPassword("carol-short"));

        Assert.Equal(["too_short", "contains_username"], result.Reasons);
        Assert.Equal(1L, await AuditCount("password_rejected"));
        Assert.False(await Sql.Scalar<bool>(db.AdminConnectionString, "select temp_code_hash is null from macro.users"));
    }

    [Fact]
    public async Task A_breached_password_is_rejected()
    {
        _factory.Breach.Breached.Add(GoodPassword);
        Assert.Equal(["breached"], Assert.IsType<SetupResult.PasswordRejected>(await SetPassword(GoodPassword)).Reasons);
    }

    [Fact]
    public async Task An_unavailable_breach_check_fails_closed_and_is_audited()
    {
        _factory.Breach.Unavailable = true;

        Assert.IsType<SetupResult.BreachCheckUnavailable>(await SetPassword(GoodPassword));
        Assert.True(await Sql.Scalar<bool>(db.AdminConnectionString, "select password_hash is null from macro.users"));
        Assert.Equal(1L, await Sql.Scalar<long>(db.AdminConnectionString,
            "select count(*) from macro.audit_events where reason = 'breach_check_unavailable'"));
    }

    [Fact]
    public async Task Starting_the_authenticator_returns_the_same_key_until_confirmed()
    {
        await SetPassword(GoodPassword);

        var first = Assert.IsType<SetupResult.Enrollment>(await StartTotp());
        var second = Assert.IsType<SetupResult.Enrollment>(await StartTotp());

        Assert.Equal(first.SetupKey, second.SetupKey);
        Assert.Matches("^([A-Z2-7]{4} )*[A-Z2-7]{1,4}$", first.SetupKey);
        var key = first.SetupKey.Replace(" ", "");
        Assert.Equal(
            $"otpauth://totp/Macro%20Counter:carol?secret={key}&issuer=Macro%20Counter&digits=6&period=30",
            first.OtpauthUri);
    }

    [Fact]
    public async Task A_valid_code_enrols_the_authenticator()
    {
        var secret = await EnrolledSecret();

        var result = Assert.IsType<SetupResult.Advanced>(await ConfirmTotp(Totp.Compute(secret, DateTimeOffset.UtcNow)));

        Assert.Equal(SetupSteps.Notice, result.NextStep);
        Assert.True(await Sql.Scalar<bool>(db.AdminConnectionString, "select two_factor_enabled from macro.users"));
        Assert.Equal(1L, await AuditCount("totp_enrolled"));
    }

    [Fact]
    public async Task Wrong_codes_count_down_and_the_fifth_revokes_the_setup_session()
    {
        var secret = await EnrolledSecret();
        var wrong = Totp.Compute(secret, DateTimeOffset.UtcNow) == "000000" ? "111111" : "000000";

        for (var left = 4; left >= 1; left--)
        {
            Assert.Equal(left, Assert.IsType<SetupResult.InvalidCode>(await ConfirmTotp(wrong)).AttemptsLeft);
        }
        Assert.IsType<SetupResult.SetupSessionRevoked>(await ConfirmTotp(wrong));

        Assert.Equal(0L, await Sql.Scalar<long>(db.AdminConnectionString, "select count(*) from macro.sessions"));
        Assert.Equal(1L, await AuditCount("totp_failed"));
        Assert.False(await Sql.Scalar<bool>(db.AdminConnectionString, "select two_factor_enabled from macro.users"));
    }

    [Fact]
    public async Task Acknowledging_the_notice_completes_setup()
    {
        var secret = await EnrolledSecret();
        await ConfirmTotp(Totp.Compute(secret, DateTimeOffset.UtcNow));

        var result = Assert.IsType<SetupResult.Advanced>(await AcknowledgeNotice());

        Assert.Null(result.NextStep);
        Assert.True(await Sql.Scalar<bool>(db.AdminConnectionString,
            "select ai_notice_ack_at is not null and setup_expires_at is null from macro.users"));
        Assert.Equal(1L, await AuditCount("ai_notice_acknowledged"));
    }

    [Fact]
    public async Task After_a_reset_the_already_acknowledged_notice_is_skipped()
    {
        await Sql.Execute(db.AdminConnectionString, "update macro.users set ai_notice_ack_at = now()");
        var secret = await EnrolledSecret();

        var result = Assert.IsType<SetupResult.Advanced>(await ConfirmTotp(Totp.Compute(secret, DateTimeOffset.UtcNow)));

        Assert.Null(result.NextStep);
        Assert.True(await Sql.Scalar<bool>(db.AdminConnectionString, "select setup_expires_at is null from macro.users"));
    }
}
