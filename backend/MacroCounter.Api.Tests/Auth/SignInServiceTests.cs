using MacroCounter.Api.Auth;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace MacroCounter.Api.Tests.Auth;

/// <summary>
/// Password and authenticator code are checked together, and every failure looks the same (FR-006, research R4).
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

    private async Task<SignInOutcome> SignIn(string username, string password, string? code)
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        var service = scope.ServiceProvider.GetRequiredService<SignInService>();
        _hasher.Verifications = 0;
        return await service.SignInAsync(username, password, code, null, CancellationToken.None);
    }

    [Fact]
    public async Task Correct_password_and_code_sign_in_and_record_the_time()
    {
        var alice = await TestUsers.ActivateDirectlyAsync(db, _factory, "alice");

        var outcome = await SignIn("alice", alice.Password, alice.Code());

        Assert.Equal(alice.Id, Assert.IsType<SignInOutcome.SignedIn>(outcome).User.Id);
        Assert.Equal(_factory.Clock.GetUtcNow().UtcDateTime,
            await Sql.Scalar<DateTime>(db.AdminConnectionString, "select last_sign_in_at from macro.users"));
    }

    [Fact]
    public async Task The_username_is_trimmed_and_case_insensitive()
    {
        var alice = await TestUsers.ActivateDirectlyAsync(db, _factory, "alice");
        Assert.IsType<SignInOutcome.SignedIn>(await SignIn("  Alice ", alice.Password, alice.Code()));
    }

    [Fact]
    public async Task Every_failure_cause_gives_the_same_result()
    {
        var alice = await TestUsers.ActivateDirectlyAsync(db, _factory, "alice");
        var bob = await TestUsers.ActivateDirectlyAsync(db, _factory, "bob");
        await Sql.Execute(db.AdminConnectionString, "update macro.users set disabled_at = now() where username = 'bob'");
        await TestUsers.InviteAsync(db, "carol");
        await Sql.Execute(db.AdminConnectionString,
            "update macro.users set setup_expires_at = now() - interval '1 minute' where username = 'carol'");
        var carolCode = await TestUsers.InviteAsync(db, "dave");
        await Sql.Execute(db.AdminConnectionString, "update macro.users set temp_code_hash = null where username = 'dave'");

        var wrongCode = alice.Code() == "000000" ? "111111" : "000000";
        SignInOutcome[] outcomes =
        [
            await SignIn("alice", "wrong password entirely", alice.Code()),
            await SignIn("alice", alice.Password, wrongCode),
            await SignIn("alice", alice.Password, null),
            await SignIn("nobody", alice.Password, alice.Code()),
            await SignIn("bob", bob.Password, bob.Code()),
            await SignIn("carol", "AAAA-AAAA-AAAA-AAAA-AAAA", null),
            await SignIn("dave", carolCode, null),
        ];

        Assert.All(outcomes, o => Assert.Same(SignInOutcome.Failed.Instance, o));
    }

    [Fact]
    public async Task An_incomplete_account_fails_and_is_audited_as_such()
    {
        await TestUsers.InviteAsync(db, "dave");
        await Sql.Execute(db.AdminConnectionString, "update macro.users set temp_code_hash = null");

        Assert.Same(SignInOutcome.Failed.Instance, await SignIn("dave", "whatever-it-is-1", null));
        Assert.Equal(1L, await Sql.Scalar<long>(db.AdminConnectionString,
            "select count(*) from macro.audit_events where event_type = 'sign_in' and reason = 'account_incomplete'"));
    }

    [Fact]
    public async Task An_expired_invite_is_audited_as_setup_expired()
    {
        var code = await TestUsers.InviteAsync(db, "carol");
        await Sql.Execute(db.AdminConnectionString, "update macro.users set setup_expires_at = now() - interval '1 minute'");
        // The fake clock is earlier than the database clock; move it past the deadline too.
        _factory.Clock.SetUtcNow(DateTimeOffset.UtcNow.AddMinutes(1));

        Assert.Same(SignInOutcome.Failed.Instance, await SignIn("carol", code, null));
        Assert.Equal(1L, await Sql.Scalar<long>(db.AdminConnectionString,
            "select count(*) from macro.audit_events where event_type = 'sign_in' and reason = 'setup_expired'"));
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public async Task A_valid_temporary_code_starts_setup(bool withoutDashes, bool lowercase)
    {
        var code = await TestUsers.InviteAsync(db, "carol");
        if (withoutDashes) code = code.Replace("-", "");
        if (lowercase) code = code.ToLowerInvariant();

        var outcome = Assert.IsType<SignInOutcome.SetupRequired>(await SignIn("carol", code, null));
        Assert.Equal(SetupSteps.Password, outcome.Step);
    }

    [Fact]
    public async Task A_chosen_password_resumes_an_unfinished_setup()
    {
        var code = await TestUsers.InviteAsync(db, "carol");
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            var user = (await users.FindByNameAsync("carol"))!;
            user.PasswordHash = new PasswordHasher<AppUser>().HashPassword(user, TestUsers.DefaultPassword);
            user.TempCodeHash = null;
            await users.UpdateAsync(user);
        }

        Assert.Same(SignInOutcome.Failed.Instance, await SignIn("carol", code, null));
        var outcome = Assert.IsType<SignInOutcome.SetupRequired>(await SignIn("carol", TestUsers.DefaultPassword, null));
        Assert.Equal(SetupSteps.Totp, outcome.Step);
    }

    [Fact]
    public async Task The_notice_step_is_reported_when_only_it_remains_and_the_code_is_right()
    {
        var carol = await TestUsers.ActivateDirectlyAsync(db, _factory, "carol");
        await Sql.Execute(db.AdminConnectionString,
            "update macro.users set ai_notice_ack_at = null, setup_expires_at = now() + interval '1 day'");

        var outcome = Assert.IsType<SignInOutcome.SetupRequired>(await SignIn("carol", carol.Password, carol.Code()));
        Assert.Equal(SetupSteps.Notice, outcome.Step);
    }

    [Fact]
    public async Task Once_the_authenticator_is_confirmed_resuming_setup_needs_the_code()
    {
        // Otherwise the password alone reaches the notice step, and acknowledging it gives a full session (T126 review).
        var carol = await TestUsers.ActivateDirectlyAsync(db, _factory, "carol");
        await Sql.Execute(db.AdminConnectionString,
            "update macro.users set ai_notice_ack_at = null, setup_expires_at = now() + interval '1 day'");
        var wrongCode = carol.Code() == "000000" ? "111111" : "000000";

        Assert.Same(SignInOutcome.Failed.Instance, await SignIn("carol", carol.Password, null));
        Assert.Same(SignInOutcome.Failed.Instance, await SignIn("carol", carol.Password, wrongCode));
        Assert.Equal(1, _hasher.Verifications);
        Assert.Equal(2, await Sql.Scalar<int>(db.AdminConnectionString, "select access_failed_count from macro.users"));
        Assert.Equal(2L, await Sql.Scalar<long>(db.AdminConnectionString,
            "select count(*) from macro.audit_events where event_type = 'sign_in' and reason = 'bad_credentials'"));
    }

    [Fact]
    public async Task Exactly_one_password_hash_is_checked_on_every_path()
    {
        var alice = await TestUsers.ActivateDirectlyAsync(db, _factory, "alice");
        var code = await TestUsers.InviteAsync(db, "carol");

        foreach (var (username, password, totp) in new (string, string, string?)[]
                 {
                     ("alice", alice.Password, alice.Code()),
                     ("alice", "wrong password entirely", alice.Code()),
                     ("nobody", "wrong password entirely", "123456"),
                     ("carol", code, null),
                     ("carol", "AAAA-AAAA-AAAA-AAAA-AAAA", null),
                 })
        {
            await SignIn(username, password, totp);
            Assert.Equal(1, _hasher.Verifications);
        }
    }

    [Fact]
    public async Task Failures_count_toward_the_lockout()
    {
        var alice = await TestUsers.ActivateDirectlyAsync(db, _factory, "alice");

        await SignIn("alice", "wrong password entirely", alice.Code());
        await SignIn("alice", "wrong password entirely", alice.Code());

        Assert.Equal(2, await Sql.Scalar<int>(db.AdminConnectionString, "select access_failed_count from macro.users"));
    }
}
