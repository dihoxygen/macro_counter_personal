namespace MacroCounter.Api.Security;

/// <summary>Bound from "Security" (defaults from research.md; configurable per environment).</summary>
public sealed class SecurityOptions
{
    public const string Section = "Security";

    /// <summary>Origins allowed to make unsafe /api requests (FR-029). Never "*".</summary>
    public string[] AllowedOrigins { get; set; } = [];

    public SessionSettings Session { get; set; } = new();
    public SignInSettings SignIn { get; set; } = new();
    public PasswordSettings Password { get; set; } = new();
    public TotpSettings Totp { get; set; } = new();

    public sealed class SessionSettings
    {
        public TimeSpan IdleTimeout { get; set; } = TimeSpan.FromHours(24);
        public TimeSpan AbsoluteLifetime { get; set; } = TimeSpan.FromDays(7);
        public TimeSpan SetupLifetime { get; set; } = TimeSpan.FromMinutes(15);
    }

    public sealed class SignInSettings
    {
        public int PerIpLimit { get; set; } = 20;
        public TimeSpan PerIpWindow { get; set; } = TimeSpan.FromMinutes(15);
        public int PerUsernameFailures { get; set; } = 10;
        public TimeSpan PerUsernameWindow { get; set; } = TimeSpan.FromMinutes(15);
        public int LockoutFailures { get; set; } = 10;
        public TimeSpan LockoutDuration { get; set; } = TimeSpan.FromMinutes(15);
    }

    public sealed class PasswordSettings
    {
        public int MinLength { get; set; } = 12;
        public int MaxLength { get; set; } = 128;
        public int Pbkdf2Iterations { get; set; } = 210_000;
    }

    public sealed class TotpSettings
    {
        public TimeSpan ReplayWindow { get; set; } = TimeSpan.FromMinutes(5);
        public int SetupMaxFailures { get; set; } = 5;
    }
}
