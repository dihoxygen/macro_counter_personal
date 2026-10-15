using Microsoft.AspNetCore.Identity;

namespace MacroCounter.Api.Auth;

/// <summary>
/// An invited account (data-model.md, macro.users). Rows are created only by the owner through
/// macro_admin.invite_user; the app's database role cannot insert them.
/// </summary>
public sealed class AppUser : IdentityUser<Guid>
{
    public const string OwnerRole = "owner";
    public const string UserRole = "user";

    /// <summary>"owner" or "user". The app cannot change it.</summary>
    public string Role { get; set; } = UserRole;

    /// <summary>SHA-256 of the normalized temporary code; cleared when the password is set (single use).</summary>
    public byte[]? TempCodeHash { get; set; }

    /// <summary>Invite or reset time + 72 h. Cleared when setup completes.</summary>
    public DateTimeOffset? SetupExpiresAt { get; set; }

    /// <summary>Replay guard for authenticator codes (research R3).</summary>
    public string? TotpLastCode { get; set; }

    public DateTimeOffset? TotpLastUsedAt { get; set; }

    /// <summary>When the person acknowledged what is sent to Claude.</summary>
    public DateTimeOffset? AiNoticeAckAt { get; set; }

    /// <summary>Non-null means disabled. The app cannot change it.</summary>
    public DateTimeOffset? DisabledAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? LastSignInAt { get; set; }
}
