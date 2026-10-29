using MacroCounter.Api.Auth;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;

namespace MacroCounter.Api.Tests.Auth;

/// <summary>The authenticator secret is encrypted at rest, and accepted codes cannot be replayed (research R3).</summary>
[Collection("Postgres")]
public class EncryptedUserStoreTests(PostgresFixture db) : IAsyncLifetime
{
    private ApiFactory _factory = null!;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        await TestUsers.InviteAsync(db, "alice");
        _factory = new ApiFactory(db, apiKey: null);
    }

    public async Task DisposeAsync() => await _factory.DisposeAsync();

    [Fact]
    public async Task The_authenticator_key_is_not_stored_in_plaintext_and_round_trips()
    {
        const string key = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<EncryptedUserStore>();
            var user = (await store.FindByNameAsync("ALICE", CancellationToken.None))!;
            await store.SetAuthenticatorKeyAsync(user, key, CancellationToken.None);
            await store.UpdateAsync(user, CancellationToken.None);
        }

        var raw = await Sql.Scalar<string>(db.AdminConnectionString, "select value from macro.user_tokens where name = 'AuthenticatorKey'");
        Assert.NotEqual(key, raw);
        Assert.DoesNotContain(key, raw);

        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
            var user = (await users.FindByNameAsync("alice"))!;
            Assert.Equal(key, await users.GetAuthenticatorKeyAsync(user));
        }
    }

    [Fact]
    public async Task An_accepted_code_cannot_be_replayed_for_five_minutes()
    {
        await using var scope = _factory.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<EncryptedUserStore>();
        var user = (await store.FindByNameAsync("ALICE", CancellationToken.None))!;
        var now = _factory.Clock.GetUtcNow();

        Assert.True(await store.TryConsumeTotpAsync(user, "123456", now, CancellationToken.None));
        Assert.False(await store.TryConsumeTotpAsync(user, "123456", now.AddMinutes(4).AddSeconds(59), CancellationToken.None));
        Assert.True(await store.TryConsumeTotpAsync(user, "654321", now.AddMinutes(1), CancellationToken.None));
        Assert.True(await store.TryConsumeTotpAsync(user, "123456", now.AddMinutes(6).AddSeconds(1), CancellationToken.None));
    }

    [Fact]
    public async Task The_replay_guard_is_persisted()
    {
        var now = _factory.Clock.GetUtcNow();
        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<EncryptedUserStore>();
            var user = (await store.FindByNameAsync("ALICE", CancellationToken.None))!;
            Assert.True(await store.TryConsumeTotpAsync(user, "123456", now, CancellationToken.None));
        }

        await using (var scope = _factory.Services.CreateAsyncScope())
        {
            var store = scope.ServiceProvider.GetRequiredService<EncryptedUserStore>();
            var user = (await store.FindByNameAsync("ALICE", CancellationToken.None))!;
            Assert.False(await store.TryConsumeTotpAsync(user, "123456", now.AddMinutes(1), CancellationToken.None));
        }
    }
}
