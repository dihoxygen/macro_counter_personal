using System.Security.Claims;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using MacroCounter.Api.Audit;
using MacroCounter.Api.Data;
using MacroCounter.Api.Endpoints;
using MacroCounter.Api.Security;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace MacroCounter.Api.Auth;

// Request and response shapes from contracts/auth-api.yaml.

/// <summary>RememberDevice is sent only when the person changed the box: null keeps the current state (004 FR-003).</summary>
public sealed record SignInRequest(string? Username, string? Password, bool? RememberDevice);

public sealed record NewPasswordRequest(string? NewPassword);

public sealed record CodeRequest(string? Code);

public sealed record NoticeRequest(bool? Acknowledged);

public sealed record ChangePasswordRequest(string? CurrentPassword, string? Code, string? NewPassword);

public sealed record SessionUser(Guid Id, string Username, string Role);

public sealed record SessionState(
    string State,
    string CsrfToken,
    bool DeviceRemembered,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? SetupStep = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] SessionUser? User = null);

public sealed record TotpEnrollmentResponse(string SetupKey, string OtpauthUri);

public static partial class AuthEndpoints
{
    public const int MaxBodyBytes = 4096;
    private const int MaxUsernameLength = 64;
    private const int MaxPasswordLength = 128;

    public static void MapAuthEndpoints(this IEndpointRouteBuilder api)
    {
        var auth = api.MapGroup("/auth");
        auth.MapGet("/session", GetSession).AllowAnonymous();
        auth.MapPost("/sign-in", SignIn).AllowAnonymous().RequireRateLimiting(RateLimits.SignIn);
        auth.MapPost("/mfa", VerifyMfa).RequireAuthorization(AccessPolicies.MfaSession).RequireRateLimiting(RateLimits.SignIn);
        var setup = auth.MapGroup("/setup").RequireAuthorization(AccessPolicies.SetupSession).RequireRateLimiting(RateLimits.SignIn);
        setup.MapPost("/password", SetPassword);
        setup.MapPost("/totp", StartTotp);
        setup.MapPost("/totp/confirm", ConfirmTotp);
        setup.MapPost("/notice", AcknowledgeNotice);
        auth.MapPost("/sign-out", SignOut).RequireAuthorization(AccessPolicies.AnySession);
        auth.MapPost("/sign-out-everywhere", SignOutEverywhere).RequireAuthorization(AccessPolicies.FullSession);
        auth.MapPost("/password", ChangePassword).RequireAuthorization(AccessPolicies.FullSession).RequireRateLimiting(RateLimits.SignIn);
    }

    private static async Task<IResult> GetSession(HttpContext context, UserManager<AppUser> users, TrustedDeviceStore devices,
        IAntiforgery antiforgery)
    {
        var kind = context.User.FindFirstValue(AuthClaims.SessionKind);
        var user = kind is null ? null : await CurrentUser(context, users);
        // Pre-ticks Remember User (004 FR-003). A cookie that does not unprotect costs no database query.
        var remembered = devices.ReadToken(context) is { } token && await devices.FindValidAsync(token, context.RequestAborted) is not null;
        if (user is not null && kind == SessionRecord.FullKind)
        {
            return Results.Ok(State(context, antiforgery, "signed_in", user: user, deviceRemembered: remembered));
        }
        if (user is not null && kind == SessionRecord.SetupKind && SetupSteps.Next(user) is { } step)
        {
            return Results.Ok(State(context, antiforgery, "setup", step, deviceRemembered: remembered));
        }
        if (user is not null && kind == SessionRecord.MfaKind)
        {
            return Results.Ok(State(context, antiforgery, "mfa", deviceRemembered: remembered));
        }
        return Results.Ok(State(context, antiforgery, "signed_out", deviceRemembered: remembered));
    }

    private static async Task<IResult> SignIn(HttpContext context, SignInService signIn, TrustedDeviceStore devices,
        IAntiforgery antiforgery, IOptions<SecurityOptions> options, TimeProvider clock)
    {
        var (request, problem) = await StrictJson.ReadAsync<SignInRequest>(context, MaxBodyBytes);
        if (problem is not null) return problem;

        var username = request!.Username?.Trim() ?? "";
        if (username.Length is 0 or > MaxUsernameLength
            || request.Password is not { Length: > 0 and <= MaxPasswordLength } password)
        {
            return Problems.InvalidRequest("Enter a username and a password.");
        }

        // Only an explicit tick is carried to the step that completes sign-in (004 FR-003, FR-015).
        var remember = request.RememberDevice == true;
        var deviceToken = devices.ReadToken(context);
        var outcome = await signIn.VerifyPasswordAsync(username, password, request.RememberDevice, deviceToken,
            context.Connection.RemoteIpAddress, context.RequestAborted);
        switch (outcome)
        {
            case SignInOutcome.SignedIn signedIn:
                return await IssueSession(context, signedIn.User, SessionRecord.FullKind, antiforgery, options, clock,
                    deviceRemembered: signedIn.ViaRememberedDevice);
            case SignInOutcome.PasswordAccepted accepted:
                if (accepted.ForgetDevice) await devices.ForgetAsync(context, deviceToken!, accepted.User.Id, context.RequestAborted);
                return await IssueSession(context, accepted.User, SessionRecord.MfaKind, antiforgery, options, clock,
                    remember: remember);
            case SignInOutcome.SetupRequired setup:
                return await IssueSession(context, setup.User, SessionRecord.SetupKind, antiforgery, options, clock, setup.Step,
                    remember);
            case SignInOutcome.Locked locked:
                return Problems.RateLimited(locked.RetryAfter);
            default:
                return Problems.SignInFailed();
        }
    }

    private static async Task<IResult> VerifyMfa(HttpContext context, UserManager<AppUser> users, SignInService signIn,
        TrustedDeviceStore devices, IAntiforgery antiforgery, IOptions<SecurityOptions> options, TimeProvider clock)
    {
        var (request, problem) = await StrictJson.ReadAsync<CodeRequest>(context, MaxBodyBytes);
        if (problem is not null) return problem;
        if (request!.Code is not { } code || !SixDigits().IsMatch(code))
        {
            return Problems.InvalidRequest("Enter the 6-digit code from your authenticator app.");
        }

        var user = await CurrentUser(context, users);
        if (user is null) return Problems.Unauthenticated();
        var remember = context.User.FindFirstValue(AuthClaims.Remember) == "true";
        var outcome = await signIn.VerifyMfaAsync(user, code, SessionKey(context), context.Connection.RemoteIpAddress,
            context.RequestAborted);
        switch (outcome)
        {
            case SignInOutcome.SignedIn signedIn:
                if (remember) await devices.RememberAsync(context, signedIn.User, context.RequestAborted);
                return await IssueSession(context, signedIn.User, SessionRecord.FullKind, antiforgery, options, clock,
                    deviceRemembered: remember);
            case SignInOutcome.SetupRequired setup:
                // Only the notice is left: the device is remembered when setup completes (AcknowledgeNotice).
                return await IssueSession(context, setup.User, SessionRecord.SetupKind, antiforgery, options, clock, setup.Step,
                    remember);
            case SignInOutcome.InvalidCode invalid:
                return Problems.InvalidCode(invalid.AttemptsLeft);
            case SignInOutcome.PendingRevoked:
                // Still a 400 with no attempts left, so the screen can say "too many codes" rather than "timed out".
                await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                return Problems.InvalidCode(0);
            case SignInOutcome.Locked locked:
                return Problems.RateLimited(locked.RetryAfter);
            default:
                throw new InvalidOperationException($"Unexpected sign-in outcome {outcome.GetType().Name}.");
        }
    }

    private static async Task<IResult> SetPassword(HttpContext context, UserManager<AppUser> users, SetupService setup,
        IAntiforgery antiforgery, IOptions<SecurityOptions> options, TimeProvider clock)
    {
        var (request, problem) = await StrictJson.ReadAsync<NewPasswordRequest>(context, MaxBodyBytes);
        if (problem is not null) return problem;
        if (request!.NewPassword is not { Length: > 0 and <= MaxPasswordLength * 4 } newPassword)
        {
            return Problems.InvalidRequest("Enter a new password.");
        }

        var user = await CurrentUser(context, users);
        if (user is null) return Problems.Unauthenticated();
        var result = await setup.SetPasswordAsync(user, newPassword, SessionKey(context), context.Connection.RemoteIpAddress,
            context.RequestAborted);
        return await Respond(context, user, result, antiforgery, options, clock);
    }

    private static async Task<IResult> StartTotp(HttpContext context, UserManager<AppUser> users, SetupService setup,
        IAntiforgery antiforgery, IOptions<SecurityOptions> options, TimeProvider clock)
    {
        var user = await CurrentUser(context, users);
        if (user is null) return Problems.Unauthenticated();
        var result = await setup.StartTotpAsync(user, context.RequestAborted);
        return result is SetupResult.Enrollment enrollment
            ? Results.Ok(new TotpEnrollmentResponse(enrollment.SetupKey, enrollment.OtpauthUri))
            : await Respond(context, user, result, antiforgery, options, clock);
    }

    private static async Task<IResult> ConfirmTotp(HttpContext context, UserManager<AppUser> users, SetupService setup,
        IAntiforgery antiforgery, IOptions<SecurityOptions> options, TimeProvider clock)
    {
        var (request, problem) = await StrictJson.ReadAsync<CodeRequest>(context, MaxBodyBytes);
        if (problem is not null) return problem;
        if (request!.Code is not { } code || !SixDigits().IsMatch(code))
        {
            return Problems.InvalidRequest("Enter the 6-digit code from your authenticator app.");
        }

        var user = await CurrentUser(context, users);
        if (user is null) return Problems.Unauthenticated();
        var result = await setup.ConfirmTotpAsync(user, code, SessionKey(context), context.Connection.RemoteIpAddress,
            context.RequestAborted);
        return await Respond(context, user, result, antiforgery, options, clock);
    }

    private static async Task<IResult> AcknowledgeNotice(HttpContext context, UserManager<AppUser> users, SetupService setup,
        TrustedDeviceStore devices, IAntiforgery antiforgery, IOptions<SecurityOptions> options, TimeProvider clock)
    {
        var (request, problem) = await StrictJson.ReadAsync<NoticeRequest>(context, MaxBodyBytes);
        if (problem is not null) return problem;
        if (request!.Acknowledged is not true) return Problems.InvalidRequest("Acknowledge the notice to continue.");

        var user = await CurrentUser(context, users);
        if (user is null) return Problems.Unauthenticated();
        var remember = context.User.FindFirstValue(AuthClaims.Remember) == "true";
        var result = await setup.AcknowledgeNoticeAsync(user, context.Connection.RemoteIpAddress, context.RequestAborted);
        // Setup is complete: if Remember User was ticked when it started, remember this browser now (004 FR-015).
        if (remember && result is SetupResult.Advanced { NextStep: null })
        {
            await devices.RememberAsync(context, user, context.RequestAborted);
        }
        return await Respond(context, user, result, antiforgery, options, clock, deviceRemembered: remember);
    }

    private static async Task<IResult> ChangePassword(HttpContext context, UserManager<AppUser> users, SetupService setup,
        TrustedDeviceStore devices)
    {
        var (request, problem) = await StrictJson.ReadAsync<ChangePasswordRequest>(context, MaxBodyBytes);
        if (problem is not null) return problem;
        if (request!.CurrentPassword is not { Length: > 0 and <= MaxPasswordLength } currentPassword
            || request.Code is not { } code || !SixDigits().IsMatch(code)
            || request.NewPassword is not { Length: > 0 and <= MaxPasswordLength * 4 } newPassword)
        {
            return Problems.InvalidRequest("Enter your current password, a 6-digit code and a new password.");
        }

        var user = await CurrentUser(context, users);
        if (user is null) return Problems.Unauthenticated();
        var result = await setup.ChangePasswordAsync(user, currentPassword, code, newPassword, SessionKey(context),
            context.Connection.RemoteIpAddress, context.RequestAborted);
        // The stamp rotation already makes every remembered device stale; delete them now too (004 FR-018).
        if (result is SetupResult.PasswordChanged) await devices.ForgetAllForUserAsync(context, user.Id, context.RequestAborted);
        return result switch
        {
            SetupResult.PasswordChanged => Results.NoContent(),
            SetupResult.CurrentCredentialsWrong => Problems.InvalidCredentials(),
            SetupResult.PasswordRejected rejected => Problems.PasswordRejected(rejected.Reasons),
            SetupResult.BreachCheckUnavailable => Problems.BreachCheckUnavailable(),
            SetupResult.WrongStep wrong => Problems.WrongSetupStep(wrong.Expected),
            _ => throw new InvalidOperationException($"Unexpected password change result {result.GetType().Name}."),
        };
    }

    private static async Task<IResult> SignOut(HttpContext context, IAuditLog audit)
    {
        var userId = UserId(context);
        await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        await audit.WriteAsync(AuditEvent.SignOut, AuditOutcome.Success, userId, null, context.Connection.RemoteIpAddress,
            context.RequestAborted);
        return Results.NoContent();
    }

    private static async Task<IResult> SignOutEverywhere(HttpContext context, UserManager<AppUser> users,
        PostgresTicketStore sessions, TrustedDeviceStore devices, IAuditLog audit)
    {
        var user = await CurrentUser(context, users);
        if (user is null) return Problems.Unauthenticated();
        await sessions.RemoveAllForUserAsync(user.Id, context.RequestAborted);
        await devices.ForgetAllForUserAsync(context, user.Id, context.RequestAborted);
        await users.UpdateSecurityStampAsync(user);
        await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        await audit.WriteAsync(AuditEvent.SignOutEverywhere, AuditOutcome.Success, user.Id, null,
            context.Connection.RemoteIpAddress, context.RequestAborted);
        return Results.NoContent();
    }

    private static async Task<IResult> Respond(HttpContext context, AppUser user, SetupResult result, IAntiforgery antiforgery,
        IOptions<SecurityOptions> options, TimeProvider clock, bool deviceRemembered = false)
    {
        switch (result)
        {
            case SetupResult.Advanced { NextStep: null }:
                // Setup complete: swap the setup session for a brand-new full session (no fixation).
                return await IssueSession(context, user, SessionRecord.FullKind, antiforgery, options, clock,
                    deviceRemembered: deviceRemembered);
            case SetupResult.Advanced advanced:
                return Results.Ok(State(context, antiforgery, "setup", advanced.NextStep));
            case SetupResult.WrongStep wrong:
                return Problems.WrongSetupStep(wrong.Expected);
            case SetupResult.PasswordRejected rejected:
                return Problems.PasswordRejected(rejected.Reasons);
            case SetupResult.BreachCheckUnavailable:
                return Problems.BreachCheckUnavailable();
            case SetupResult.InvalidCode invalid:
                return Problems.InvalidCode(invalid.AttemptsLeft);
            case SetupResult.SetupSessionRevoked:
                await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                return Problems.Unauthenticated();
            default:
                throw new InvalidOperationException($"Unexpected setup result {result.GetType().Name}.");
        }
    }

    private static async Task<IResult> IssueSession(HttpContext context, AppUser user, string kind, IAntiforgery antiforgery,
        IOptions<SecurityOptions> options, TimeProvider clock, string? setupStep = null, bool remember = false,
        bool deviceRemembered = false)
    {
        List<Claim> claims =
        [
            new(AuthClaims.Subject, user.Id.ToString()),
            new(AuthClaims.Username, user.UserName!),
            new(AuthClaims.Role, user.Role),
            new(AuthClaims.SessionKind, kind),
        ];
        // Only a pending or setup session carries the Remember User choice to the step that completes sign-in.
        if (remember && kind != SessionRecord.FullKind) claims.Add(new(AuthClaims.Remember, "true"));
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims,
            CookieAuthenticationDefaults.AuthenticationScheme, AuthClaims.Username, AuthClaims.Role));
        var (lifetime, _) = PostgresTicketStore.Limits(options.Value.Session, kind);
        await SessionRotation.SignInWithNewKeyAsync(context, new AuthenticationTicket(principal, new AuthenticationProperties
        {
            IsPersistent = true,
            AllowRefresh = false,
            ExpiresUtc = clock.GetUtcNow() + lifetime,
        }, CookieAuthenticationDefaults.AuthenticationScheme));

        // The CSRF token must be bound to the new identity, not the anonymous caller.
        context.User = principal;
        return kind switch
        {
            SessionRecord.FullKind => Results.Ok(State(context, antiforgery, "signed_in", user: user, deviceRemembered: deviceRemembered)),
            SessionRecord.MfaKind => Results.Ok(State(context, antiforgery, "mfa")),
            _ => Results.Ok(State(context, antiforgery, "setup", setupStep ?? SetupSteps.Next(user))),
        };
    }

    /// <param name="deviceRemembered">
    /// Whether this browser is remembered: checked on GET /auth/session, and known after a sign-in step that used or
    /// set the device cookie; false otherwise.
    /// </param>
    private static SessionState State(HttpContext context, IAntiforgery antiforgery, string state, string? setupStep = null,
        AppUser? user = null, bool deviceRemembered = false) =>
        new(state, antiforgery.GetAndStoreTokens(context).RequestToken!, deviceRemembered, setupStep,
            user is null ? null : new SessionUser(user.Id, user.UserName!, user.Role));

    private static Guid? UserId(HttpContext context) =>
        Guid.TryParse(context.User.FindFirstValue(AuthClaims.Subject), out var id) ? id : null;

    private static async Task<AppUser?> CurrentUser(HttpContext context, UserManager<AppUser> users) =>
        UserId(context) is { } id ? await users.FindByIdAsync(id.ToString()) : null;

    private static string SessionKey(HttpContext context) =>
        context.Items[PostgresTicketStore.SessionKeyItem] as string
        ?? throw new InvalidOperationException("No session key on an authenticated request.");

    [GeneratedRegex("^[0-9]{6}$")]
    private static partial Regex SixDigits();
}
