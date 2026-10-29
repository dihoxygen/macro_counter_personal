using MacroCounter.Api.Auth;
using MacroCounter.Api.Tests.Endpoints;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;

namespace MacroCounter.Api.Tests.Infrastructure;

/// <summary>An account that finished setup: what a test needs to sign in as it.</summary>
public sealed record ActiveUser(Guid Id, string Username, string Password, string TotpSecret)
{
    /// <summary>The code an authenticator app shows now, optionally a few 30-second steps later.</summary>
    public string Code(int stepsAhead = 0) => Totp.Compute(TotpSecret, DateTimeOffset.UtcNow.AddSeconds(30 * stepsAhead));
}

/// <summary>Provisions accounts the way the owner does: through macro_admin procedures as the admin.</summary>
public static class TestUsers
{
    public const string DefaultPassword = "a long and unbreached test passphrase";

    /// <summary>Invites a user and returns the one-time temporary code.</summary>
    public static Task<string> InviteAsync(PostgresFixture db, string username, string role = "user") =>
        Sql.Scalar<string>(db.AdminConnectionString, "select macro_admin.invite_user(@u, @r)", ("u", username), ("r", role));

    /// <summary>
    /// Invites a user and completes setup directly through the app's services (password, authenticator,
    /// notice), as the app role. For tests that are not about the setup flow itself.
    /// </summary>
    public static async Task<ActiveUser> ActivateDirectlyAsync(PostgresFixture db, ApiFactory factory, string username,
        string role = "user", string password = DefaultPassword)
    {
        await InviteAsync(db, username, role);
        await using var scope = factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
        var store = scope.ServiceProvider.GetRequiredService<EncryptedUserStore>();
        var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher<AppUser>>();

        var user = (await users.FindByNameAsync(username))!;
        var secret = users.GenerateNewAuthenticatorKey();
        user.PasswordHash = hasher.HashPassword(user, PasswordPolicy.Normalize(password));
        user.TempCodeHash = null;
        user.TwoFactorEnabled = true;
        user.AiNoticeAckAt = factory.Clock.GetUtcNow();
        user.SetupExpiresAt = null;
        await store.SetAuthenticatorKeyAsync(user, secret, CancellationToken.None);
        await store.UpdateAsync(user, CancellationToken.None);
        return new ActiveUser(user.Id, username, password, secret);
    }

    /// <summary>
    /// Invites a user and completes the whole first-time setup over HTTP, like a person in the browser.
    /// Returns a client holding a full session and the current CSRF token.
    /// </summary>
    public static async Task<(AuthClient Client, ActiveUser User)> ActivateAsync(PostgresFixture db, ApiFactory factory,
        string username, string role = "user", string password = DefaultPassword)
    {
        var code = await InviteAsync(db, username, role);
        var client = new AuthClient(factory);
        await client.SessionAsync();
        await client.SignInAsync(username, code);
        await client.PostForStateAsync("/api/auth/setup/password", new { newPassword = password });
        var enrollment = await AuthClient.Json(await client.PostAsync("/api/auth/setup/totp"));
        var secret = enrollment.GetProperty("setupKey").GetString()!.Replace(" ", "");
        var state = await client.PostForStateAsync("/api/auth/setup/totp/confirm",
            new { code = Totp.Compute(secret, DateTimeOffset.UtcNow) });
        if (state.GetProperty("state").GetString() == "setup")
        {
            state = await client.PostForStateAsync("/api/auth/setup/notice", new { acknowledged = true });
        }
        var id = Guid.Parse(state.GetProperty("user").GetProperty("id").GetString()!);
        return (client, new ActiveUser(id, username, password, secret));
    }
}
