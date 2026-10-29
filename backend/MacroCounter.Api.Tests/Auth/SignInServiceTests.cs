using System.Security.Claims;
using MacroCounter.Api.Auth;
using MacroCounter.Api.Data;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace MacroCounter.Api.Tests.Auth;

/// <summary>
/// Two-step sign-in (004 research R1, R2): the password is checked first and every failure looks the same; a
/// correct password resets nothing until the authenticator step completes (threat T10).
/// </summary>
[Collection("Postgres")]
public class SignInServiceTests(PostgresFixture db) : IAsyncLifetime
{
    private sealed class CountingHasher(IPasswordHasher<AppUser> inner) : IPasswordHasher<AppUser>
    {
        public int Verifications;

        public string HashPassword(AppUser user, string password) => inner.HashPassword(user, password);

        public PasswordVerificationResult VerifyHashedPassword(AppUser user, string hashedPassword, string providedPassword)
        {
            Interlocked.Increment(ref Verifications);
            return inner.VerifyHashedPassword(user, hashedPassword, providedPassword);
        }
    }

    private readonly CountingHasher _hasher = new(new PasswordHasher<AppUser>());
    private ApiFactory _factory = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _factory = new ApiFactory(db, apiKey: null);
        _factory.ServiceOverrides.Add(s => s.Replace(ServiceDescriptor.Singleton<IPasswordHasher<AppUser>>(_hasher)));
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    private async Task<SignInOutcome> SignIn(string username, string password)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        var service = scope.ServiceProvider.GetRequiredService<SignInService>();
        _hasher.Verifications = 0;
        return await service.VerifyPasswordAsync(username, password, null, null, null, CancellationToken.None);
    }

    /// <summary>Step 2 for a user, on a pending session created the way step 1's endpoint would.</summary>
    private async Task<SignInOutcome> Mfa(Guid userId, string code, string? sessionKey = null)
    {
        sessionKey ??= await PendingSession(userId);
        await using var scope = _factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var user = (await users.FindByIdAsync(userId.ToString()))!;
        return await scope.ServiceProvider.GetRequiredService<SignInService>()
            .VerifyMfaAsync(user, code, sessionKey, null, CancellationToken.None);
    }

    private Task<string> PendingSession(Guid userId) =>
        _factory.Services.GetRequiredService<PostgresTicketStore>().StoreAsync(new AuthenticationTicket(
            new ClaimsPrincipal(new ClaimsIdentity(
                [new Claim(AuthClaims.Subject, userId.ToString()), new Claim(AuthClaims.SessionKind, SessionRecord.MfaKind)],
                "test")),
            "test"));

    private Task<int> FailedCount() =>
        Sql.Scalar<int>(db.AdminConnectionString, "select access_failed_count from macro.users");

    private Task<long> Audits(string eventType, string? reason = null) => Sql.Scalar<long>(db.AdminConnectionString,
        "select count(*) from macro.audit_events where event_type = @e and reason is not distinct from @r",
        ("e", eventType), ("r", reason));

    private static string WrongCode(ActiveUser user) => user.Code() == "000000" ? "111111" : "000000";

    // ----- Step 1: the password ---------------------------------------------------------------------------

    [Fact]
    public async Task A_correct_password_waits_for_the_code_and_is_audited()
    {
        var alice = await TestUsers.ActivateDirectlyAsync(db, _factory, "alice");

        var outcome = await SignIn("alice", alice.Password);

        Assert.Equal(alice.Id, Assert.IsType<SignInOutcome.PasswordAccepted>(outcome).User.Id);
        Assert.Equal(1L, await Audits("password_accepted"));
        // Not signed in yet: the sign-in time is set only after the code.
        Assert.Null(await Sql.Scalar<object>(db.AdminConnectionString, "select last_sign_in_at from macro.users") as DateTime?);
    }

    [Fact]
    public async Task The_username_is_trimmed_and_case_insensitive()
    {
        var alice = await TestUsers.ActivateDirectlyAsync(db, _factory, "alice");
        Assert.IsType<SignInOutcome.PasswordAccepted>(await SignIn("  Alice ", alice.Password));
    }

    [Fact]
    public async Task Every_failure_cause_gives_the_same_result()
    {
        await TestUsers.ActivateDirectlyAsync(db, _factory, "alice");
        var bob = await TestUsers.ActivateDirectlyAsync(db, _factory, "bob");
        await Sql.Execute(db.AdminConnectionString, "update macro.users set disabled_at = now() where username = 'bob'");
        await TestUsers.InviteAsync(db, "carol");
        await Sql.Execute(db.AdminConnectionString,
            "update macro.users set setup_expires_at = now() - interval '1 minute' where username = 'carol'");
        var carolCode = await TestUsers.InviteAsync(db, "dave");
        await Sql.Execute(db.AdminConnectionString, "update macro.users set temp_code_hash = null where username = 'dave'");

        SignInOutcome[] outcomes =
        [
            await SignIn("alice", "wrong password entirely"),
            await SignIn("nobody", "wrong password entirely"),
            await SignIn("bob", bob.Password),
            await SignIn("carol", "AAAA-AAAA-AAAA-AAAA-AAAA"),
            await SignIn("dave", carolCode),
        ];

        Assert.All(outcomes, o => Assert.Same(SignInOutcome.Failed.Instance, o));
    }

    [Fact]
    public async Task An_incomplete_account_fails_and_is_audited_as_such()
    {
        await TestUsers.InviteAsync(db, "dave");
        await Sql.Execute(db.AdminConnectionString, "update macro.users set temp_code_hash = null");

        Assert.Same(SignInOutcome.Failed.Instance, await SignIn("dave", "whatever-it-is-1"));
        Assert.Equal(1L, await Audits("sign_in", "account_incomplete"));
    }

    [Fact]
    public async Task Exactly_one_password_hash_is_checked_on_every_path()
    {
        var alice = await TestUsers.ActivateDirectlyAsync(db, _factory, "alice");
        var code = await TestUsers.InviteAsync(db, "carol");

        foreach (var (username, password) in new[]
                 {
                     ("alice", alice.Password),
                     ("alice", "wrong password entirely"),
                     ("nobody", "wrong password entirely"),
                     ("carol", code),
                     ("carol", "AAAA-AAAA-AAAA-AAAA-AAAA"),
                 })
        {
            await SignIn(username, password);
            Assert.Equal(1, _hasher.Verifications);
        }
    }

    [Fact]
    public async Task Wrong_passwords_count_toward_the_lockout_and_the_tenth_locks()
    {
        var alice = await TestUsers.ActivateDirectlyAsync(db, _factory, "alice");

        await SignIn("alice", "wrong password entirely");
        await SignIn("alice", "wrong password entirely");
        Assert.Equal(2, await FailedCount());

        for (var i = 0; i < 8; i++) await SignIn("alice", "wrong password entirely");
        Assert.NotNull(await Sql.Scalar<object>(db.AdminConnectionString, "select lockout_end from macro.users") as DateTime?);
        Assert.Equal(1L, await Audits("sign_in_locked", "locked"));
        Assert.IsType<SignInOutcome.Locked>(await SignIn("alice", alice.Password));
    }

    [Fact]
    public async Task A_correct_password_resets_neither_the_failure_count_nor_the_throttle()
    {
        var alice = await TestUsers.ActivateDirectlyAsync(db, _factory, "alice");
        for (var i = 0; i < 3; i++) await SignIn("alice", "wrong password entirely");

        Assert.IsType<SignInOutcome.PasswordAccepted>(await SignIn("alice", alice.Password));

        Assert.Equal(3, await FailedCount());
        var throttle = _factory.Services.GetRequiredService<SignInThrottle>();
        for (var i = 0; i < 6; i++) throttle.RecordFailure("alice");
        // 3 + 6 = 9 failures in the window: one more would block. Had the correct password reset the throttle, it would not.
        throttle.RecordFailure("alice");
        Assert.True(throttle.IsBlocked("alice", out _));
    }

    // ----- Step 2: the authenticator code ------------------------------------------------------------------

    [Fact]
    public async Task A_correct_code_signs_in_and_resets_the_counters()
    {
        var alice = await TestUsers.ActivateDirectlyAsync(db, _factory, "alice");
        for (var i = 0; i < 3; i++) await SignIn("alice", "wrong password entirely");

        var outcome = await Mfa(alice.Id, alice.Code());

        Assert.Equal(alice.Id, Assert.IsType<SignInOutcome.SignedIn>(outcome).User.Id);
        Assert.Equal(0, await FailedCount());
        Assert.Equal(_factory.Clock.GetUtcNow().UtcDateTime,
            await Sql.Scalar<DateTime>(db.AdminConnectionString, "select last_sign_in_at from macro.users"));
        Assert.Equal(1L, await Audits("sign_in"));
        Assert.False(_factory.Services.GetRequiredService<SignInThrottle>().IsBlocked("alice", out _));
    }

    [Fact]
    public async Task Wrong_codes_count_down_and_the_fifth_ends_the_pending_sign_in()
    {
        var alice = await TestUsers.ActivateDirectlyAsync(db, _factory, "alice");
        var session = await PendingSession(alice.Id);

        for (var left = 4; left >= 1; left--)
        {
            Assert.Equal(left, Assert.IsType<SignInOutcome.InvalidCode>(await Mfa(alice.Id, WrongCode(alice), session)).AttemptsLeft);
        }
        Assert.IsType<SignInOutcome.PendingRevoked>(await Mfa(alice.Id, WrongCode(alice), session));

        Assert.Equal(0L, await Sql.Scalar<long>(db.AdminConnectionString, "select count(*) from macro.sessions"));
        Assert.Equal(5, await FailedCount());
        Assert.Equal(5L, await Audits("sign_in", "invalid_code"));
    }

    [Fact]
    public async Task Correct_passwords_between_wrong_codes_never_reset_the_lockout()
    {
        // Threat T10: 9 wrong codes over 3 pending sign-ins, each opened with the right password, then one more.
        var alice = await TestUsers.ActivateDirectlyAsync(db, _factory, "alice");
        for (var round = 0; round < 3; round++)
        {
            Assert.IsType<SignInOutcome.PasswordAccepted>(await SignIn("alice", alice.Password));
            var session = await PendingSession(alice.Id);
            for (var i = 0; i < 3; i++) await Mfa(alice.Id, WrongCode(alice), session);
        }
        Assert.Equal(9, await FailedCount());

        await Mfa(alice.Id, WrongCode(alice));

        Assert.IsType<SignInOutcome.Locked>(await SignIn("alice", alice.Password));
    }

    [Fact]
    public async Task A_lockout_that_starts_while_waiting_for_the_code_refuses_the_code()
    {
        var alice = await TestUsers.ActivateDirectlyAsync(db, _factory, "alice");
        var session = await PendingSession(alice.Id);
        await Sql.Execute(db.AdminConnectionString, "update macro.users set lockout_end = now() + interval '1 hour'");

        Assert.IsType<SignInOutcome.Locked>(await Mfa(alice.Id, alice.Code(), session));
    }

    [Fact]
    public async Task A_code_cannot_be_reused()
    {
        var alice = await TestUsers.ActivateDirectlyAsync(db, _factory, "alice");
        var code = alice.Code();

        Assert.IsType<SignInOutcome.SignedIn>(await Mfa(alice.Id, code));
        Assert.IsType<SignInOutcome.InvalidCode>(await Mfa(alice.Id, code));
    }

    // ----- First sign-in and unfinished setup (US2) --------------------------------------------------------

    [Theory]
    [InlineData(false, false)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public async Task A_valid_invite_code_starts_setup_at_the_password_step(bool withoutDashes, bool lowercase)
    {
        var code = await TestUsers.InviteAsync(db, "carol");
        if (withoutDashes) code = code.Replace("-", "");
        if (lowercase) code = code.ToLowerInvariant();

        var outcome = Assert.IsType<SignInOutcome.SetupRequired>(await SignIn("carol", code));

        Assert.Equal(SetupSteps.Password, outcome.Step);
        Assert.Equal(1L, await Audits("setup_started", "invite_code"));
    }

    [Fact]
    public async Task An_expired_invite_is_audited_as_setup_expired()
    {
        var code = await TestUsers.InviteAsync(db, "carol");
        await Sql.Execute(db.AdminConnectionString, "update macro.users set setup_expires_at = now() - interval '1 minute'");
        // The fake clock is earlier than the database clock; move it past the deadline too.
        _factory.Clock.SetUtcNow(DateTimeOffset.UtcNow.AddMinutes(1));

        Assert.Same(SignInOutcome.Failed.Instance, await SignIn("carol", code));
        Assert.Equal(1L, await Audits("sign_in", "setup_expired"));
    }

    private async Task ChoosePasswordOnly(string username)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var user = (await users.FindByNameAsync(username))!;
        user.PasswordHash = new PasswordHasher<AppUser>().HashPassword(user, TestUsers.DefaultPassword);
        user.TempCodeHash = null;
        await users.UpdateAsync(user);
    }

    [Fact]
    public async Task A_chosen_password_without_an_authenticator_resumes_at_authenticator_setup()
    {
        var code = await TestUsers.InviteAsync(db, "carol");
        await ChoosePasswordOnly("carol");

        Assert.Same(SignInOutcome.Failed.Instance, await SignIn("carol", code));
        var outcome = Assert.IsType<SignInOutcome.SetupRequired>(await SignIn("carol", TestUsers.DefaultPassword));
        Assert.Equal(SetupSteps.Totp, outcome.Step);
        Assert.Equal(1L, await Audits("setup_started"));
    }

    [Fact]
    public async Task After_the_setup_deadline_a_chosen_password_is_refused()
    {
        await TestUsers.InviteAsync(db, "carol");
        await ChoosePasswordOnly("carol");
        await Sql.Execute(db.AdminConnectionString, "update macro.users set setup_expires_at = now() - interval '1 minute'");
        _factory.Clock.SetUtcNow(DateTimeOffset.UtcNow.AddMinutes(1));

        Assert.Same(SignInOutcome.Failed.Instance, await SignIn("carol", TestUsers.DefaultPassword));
        Assert.Equal(1L, await Audits("sign_in", "setup_expired"));
    }

    [Fact]
    public async Task With_only_the_notice_left_the_password_asks_for_the_code_then_the_notice()
    {
        var carol = await TestUsers.ActivateDirectlyAsync(db, _factory, "carol");
        await Sql.Execute(db.AdminConnectionString,
            "update macro.users set ai_notice_ack_at = null, setup_expires_at = now() + interval '1 day'");

        Assert.IsType<SignInOutcome.PasswordAccepted>(await SignIn("carol", carol.Password));
        var outcome = Assert.IsType<SignInOutcome.SetupRequired>(await Mfa(carol.Id, carol.Code()));

        Assert.Equal(SetupSteps.Notice, outcome.Step);
        // Not signed in until the notice is acknowledged.
        Assert.Null(await Sql.Scalar<object>(db.AdminConnectionString, "select last_sign_in_at from macro.users") as DateTime?);
    }

    [Fact]
    public async Task With_only_the_notice_left_a_correct_password_resets_nothing()
    {
        // Threat T10 for an account whose notice step is still pending.
        var carol = await TestUsers.ActivateDirectlyAsync(db, _factory, "carol");
        await Sql.Execute(db.AdminConnectionString,
            "update macro.users set ai_notice_ack_at = null, setup_expires_at = now() + interval '1 day'");
        for (var i = 0; i < 3; i++) await SignIn("carol", "wrong password entirely");

        Assert.IsType<SignInOutcome.PasswordAccepted>(await SignIn("carol", carol.Password));

        Assert.Equal(3, await FailedCount());
        Assert.Equal(1, _hasher.Verifications);
    }
}
