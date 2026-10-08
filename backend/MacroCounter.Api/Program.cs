using Anthropic;
using MacroCounter.Api.Ai;
using MacroCounter.Api.Contracts;
using MacroCounter.Api.Endpoints;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<AnthropicOptions>(builder.Configuration.GetSection(AnthropicOptions.Section));
builder.Services.AddProblemDetails();

// The real Claude estimator only exists when a key is configured; otherwise every AI call
// reports "unavailable" and the UI falls back to manual entry (FR-008).
builder.Services.AddSingleton<IEstimator>(sp =>
{
    var options = sp.GetRequiredService<IOptions<AnthropicOptions>>();
    if (!options.Value.HasApiKey) return new UnavailableEstimator();
    var client = new AnthropicClient { ApiKey = options.Value.ApiKey! };
    return new ClaudeEstimator(new AnthropicMessageSender(client), options);
});

var app = builder.Build();

app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseDefaultFiles();
app.UseStaticFiles();

var api = app.MapGroup("/api");
api.MapGet("/status", (IOptions<AnthropicOptions> options) => new StatusResponse(options.Value.HasApiKey));
api.MapEstimateEndpoints();

app.MapFallbackToFile("index.html");

app.Run();

public partial class Program;
