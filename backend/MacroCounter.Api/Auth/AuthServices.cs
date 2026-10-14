using MacroCounter.Api.Endpoints;
using MacroCounter.Api.Security;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace MacroCounter.Api.Auth;

public static class AuthServices
{
    public const string SessionCookie = "__Host-mc_session";
    public const string AntiforgeryCookie = "__Host-mc_af";
    public const string CsrfHeader = "X-CSRF-Token";

    /// <summary>
    /// Cookie sessions stored server-side, antiforgery, authorization policies and the sign-in/setup services
    /// (research R3–R5, R10). Requires <see cref="Data.IdentityServices.AddIdentityStore"/> first.
    /// </summary>
    public static WebApplicationBuilder AddAuth(this WebApplicationBuilder builder)
    {
        var services = builder.Services;

        services.AddScoped<EncryptedUserStore>();
        services.Replace(ServiceDescriptor.Scoped<IUserStore<AppUser>>(sp => sp.GetRequiredService<EncryptedUserStore>()));
        services.AddSingleton<PasswordPolicy>();
        services.AddSingleton<SignInThrottle>();
        services.AddScoped<SignInService>();
        services.AddScoped<SetupService>();
        services.AddSingleton<PostgresTicketStore>();
        services.AddHttpClient<IBreachedPasswordChecker, HibpBreachedPasswordChecker>(client =>
        {
            client.BaseAddress = HibpBreachedPasswordChecker.BaseAddress;
            client.Timeout = TimeSpan.FromSeconds(5);
            client.DefaultRequestHeaders.UserAgent.ParseAdd("MacroCounter");
        });

        services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
            .AddCookie(options =>
            {
                options.Cookie.Name = SessionCookie;
                options.Cookie.HttpOnly = true;
                options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
                options.Cookie.SameSite = SameSiteMode.Strict;
                options.Cookie.Path = "/";
                options.SlidingExpiration = false;
                options.CookieManager = new SessionRotation.CookieManager();
                options.Events.OnRedirectToLogin = context => Problems.Unauthenticated().ExecuteAsync(context.HttpContext);
                options.Events.OnRedirectToAccessDenied = context => Problems.Unauthenticated().ExecuteAsync(context.HttpContext);
            });
        services.AddSingleton<IPostConfigureOptions<CookieAuthenticationOptions>, SessionStoreSetup>();
        services.AddOptions<CookieAuthenticationOptions>(CookieAuthenticationDefaults.AuthenticationScheme)
            .Configure<IOptions<SecurityOptions>, TimeProvider>((cookie, security, clock) =>
            {
                cookie.ExpireTimeSpan = security.Value.Session.AbsoluteLifetime;
                cookie.TimeProvider = clock;
            });

        services.AddAuthorization(AccessPolicies.Configure);

        services.AddAntiforgery(options =>
        {
            options.Cookie.Name = AntiforgeryCookie;
            options.Cookie.HttpOnly = true;
            options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
            options.Cookie.SameSite = SameSiteMode.Strict;
            options.Cookie.Path = "/";
            options.HeaderName = CsrfHeader;
            // Frame protection is a response header for every response (http-hardening.md), not antiforgery's job.
            options.SuppressXFrameOptionsHeader = true;
        });

        return builder;
    }
}
