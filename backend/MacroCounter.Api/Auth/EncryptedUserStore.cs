using MacroCounter.Api.Data;
using MacroCounter.Api.Security;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using UserOnlyStoreBase = Microsoft.AspNetCore.Identity.EntityFrameworkCore.UserOnlyStore<MacroCounter.Api.Auth.AppUser, MacroCounter.Api.Data.IdentityDbContext, System.Guid>;

namespace MacroCounter.Api.Auth;

/// <summary>
/// Identity's user store with two additions (research R3): the authenticator secret is encrypted at rest
/// with Data Protection, and an accepted code cannot be used again within the replay window.
/// </summary>
public sealed class EncryptedUserStore(
    IdentityDbContext context,
    IDataProtectionProvider dataProtection,
    IOptions<SecurityOptions> options,
    IdentityErrorDescriber? describer = null)
    : UserOnlyStoreBase(context, describer)
{
    private readonly IDataProtector _protector = dataProtection.CreateProtector("MacroCounter.Totp.v1");

    public override Task SetAuthenticatorKeyAsync(AppUser user, string key, CancellationToken cancellationToken) =>
        base.SetAuthenticatorKeyAsync(user, _protector.Protect(key), cancellationToken);

    public override async Task<string?> GetAuthenticatorKeyAsync(AppUser user, CancellationToken cancellationToken)
    {
        var stored = await base.GetAuthenticatorKeyAsync(user, cancellationToken);
        return stored is null ? null : _protector.Unprotect(stored);
    }

    /// <summary>
    /// Saves only the columns that changed. Identity's default marks every column modified, but the app's
    /// database role may not write username, role or disabled_at (research R6), so a blanket update is refused.
    /// </summary>
    public override async Task<IdentityResult> UpdateAsync(AppUser user, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(user);
        if (Context.Entry(user).State == EntityState.Detached)
        {
            throw new InvalidOperationException("Update a user loaded through this store, so only changed columns are written.");
        }

        user.ConcurrencyStamp = Guid.NewGuid().ToString();
        try
        {
            await SaveChanges(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return IdentityResult.Failed(ErrorDescriber.ConcurrencyFailure());
        }
        return IdentityResult.Success;
    }

    /// <summary>
    /// Records <paramref name="code"/> as used. Returns false (and records nothing) if the same code was
    /// accepted within the replay window.
    /// </summary>
    public async Task<bool> TryConsumeTotpAsync(AppUser user, string code, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (user.TotpLastCode == code && user.TotpLastUsedAt is { } lastUsed
            && now - lastUsed < options.Value.Totp.ReplayWindow)
        {
            return false;
        }
        user.TotpLastCode = code;
        user.TotpLastUsedAt = now;
        await Context.SaveChangesAsync(cancellationToken);
        return true;
    }
}
