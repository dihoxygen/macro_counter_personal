using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using MacroCounter.Api.Tests.Endpoints;

namespace MacroCounter.Api.Tests.Infrastructure;

/// <summary>
/// A browser-like client: keeps cookies (over https, so Secure cookies are sent) and sends the latest CSRF
/// token on unsafe requests, as frontend/src/api/http.ts does.
/// </summary>
public sealed class AuthClient
{
    public static readonly Uri BaseAddress = new("https://localhost");

    private readonly CookieHandler _cookies = new();

    public AuthClient(ApiFactory factory)
    {
        Http = factory.CreateDefaultClient(BaseAddress, _cookies);
    }

    public HttpClient Http { get; }

    /// <summary>The browser's cookie jar for this client.</summary>
    public CookieContainer Cookies => _cookies.Container;

    /// <summary>"__Host-mc_session=…", as a stolen cookie would be replayed.</summary>
    public string SessionCookieHeader()
    {
        var cookie = Cookies.GetCookies(BaseAddress)["__Host-mc_session"]
            ?? throw new InvalidOperationException("No session cookie.");
        return $"{cookie.Name}={cookie.Value}";
    }

    public string? Csrf { get; set; }

    /// <summary>GET /api/auth/session; remembers the CSRF token it returns.</summary>
    public async Task<JsonElement> SessionAsync()
    {
        var response = await Http.GetAsync("/api/auth/session");
        response.EnsureSuccessStatusCode();
        return await Remember(response);
    }

    public async Task<HttpResponseMessage> PostAsync(string path, object? body = null, bool withCsrf = true)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path);
        if (body is not null) request.Content = JsonContent.Create(body);
        if (withCsrf && Csrf is not null) request.Headers.Add("X-CSRF-Token", Csrf);
        return await Http.SendAsync(request);
    }

    public async Task<HttpResponseMessage> PostRawAsync(string path, string json)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
        if (Csrf is not null) request.Headers.Add("X-CSRF-Token", Csrf);
        return await Http.SendAsync(request);
    }

    /// <summary>POSTs and, on success, remembers the new CSRF token from the session state it returns.</summary>
    public async Task<JsonElement> PostForStateAsync(string path, object? body = null)
    {
        var response = await PostAsync(path, body);
        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException($"{path} returned {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        }
        return await Remember(response);
    }

    public Task<JsonElement> SignInAsync(string username, string password, string? code = null) =>
        PostForStateAsync("/api/auth/sign-in", code is null ? new { username, password } : new { username, password, code });

    public static async Task<JsonElement> Json(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();

    private async Task<JsonElement> Remember(HttpResponseMessage response)
    {
        var json = await Json(response);
        if (json.TryGetProperty("csrfToken", out var token)) Csrf = token.GetString();
        return json;
    }

    private sealed class CookieHandler : DelegatingHandler
    {
        public CookieContainer Container { get; } = new();

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var header = Container.GetCookieHeader(request.RequestUri!);
            if (!string.IsNullOrEmpty(header)) request.Headers.Add("Cookie", header);
            var response = await base.SendAsync(request, cancellationToken);
            if (response.Headers.TryGetValues("Set-Cookie", out var values))
            {
                foreach (var value in values) Container.SetCookies(request.RequestUri!, value);
            }
            return response;
        }
    }
}
