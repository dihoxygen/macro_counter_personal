using Anthropic;
using MacroCounter.Api.Ai;
using MacroCounter.Api.Auth;
using MacroCounter.Api.Contracts;
using MacroCounter.Api.Data;
using MacroCounter.Api.Endpoints;
using MacroCounter.Api.Security;
using MacroCounter.Api.Testing;
using MacroCounter.Api.Usage;
using Microsoft.Extensions.Options;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);

// Identity and security data only (FR-019). The app never migrates the database: the owner applies
// migrations as a script, and the app's database role has no DDL rights (research R12).
builder.AddIdentityStore();
// Invite-only sign-in with server-side sessions, CSRF protection and access policies (feature 003).
builder.AddAuth();
builder.AddRateLimits();

builder.Services.Configure<AnthropicOptions>(builder.Configuration.GetSection(AnthropicOptions.Section));
builder.Services.AddProblemDetails();

// The real Claude estimator only exists when a key is configured; otherwise every AI call
// reports "unavailable" and the UI falls back to manual entry (FR-008).
builder.Services.AddSingleton<IEstimator>(sp =>
{
    var options = sp.GetRequiredService<IOptions<AnthropicOptions>>();
    if (!options.Value.HasApiKey) return new UnavailableEstimator();
    var client = new AnthropicClient { ApiKey = options.Value.ApiKey! };
    return new ClaudeEstimator(
        new AnthropicMessageSender(client), options, logger: sp.GetRequiredService<ILogger<ClaudeEstimator>>());
});

// Inert outside the "Testing" environment (end-to-end test host only).
builder.AddTestingSwitches();

var app = builder.Build();

// Fail fast when the identity store is not configured (it is resolved lazily, after all configuration).
_ = app.Services.GetRequiredService<NpgsqlDataSource>();
SpendCap.LogAtStartup(app.Services);

app.UseForwardedHeaders();
app.UseExceptionHandler();
// Outside Production only: http://localhost counts as a secure context, as browsers treat it.
app.UseLocalhostSecureContext(app.Environment);
app.UseStatusCodePages();
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();
// After authorization: anonymous requests to protected features are refused before they use up a limit.
app.UseRateLimiter();

var api = app.MapGroup("/api");
api.AddEndpointFilter<CsrfEndpointFilter>();
// Public: says only that the service is up, nothing about users or configuration (R16).
api.MapGet("/health", () => new { status = "ok" }).AllowAnonymous();
// Everything below needs a full session through the fallback policy (deny by default, FR-013).
api.MapGet("/status", (IOptions<AnthropicOptions> options) => new StatusResponse(options.Value.HasApiKey));
api.MapEstimateEndpoints();
api.MapAuthEndpoints();

// The app shell is public so it can show sign-in, but /api never falls back to it: unknown /api paths
// get no endpoint, so the fallback policy refuses them like any other server feature.
app.MapFallbackToFile("{*path:nonfile:regex(^(?!api(/|$)).*$)}", "index.html").AllowAnonymous();

app.Run();

public partial class Program;
