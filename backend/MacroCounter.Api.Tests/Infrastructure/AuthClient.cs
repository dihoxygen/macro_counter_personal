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

    public AuthClient(ApiFactory factory, Uri? baseAddress = null)
    {
        Address = baseAddress ?? BaseAddress;
        Http = factory.CreateDefaultClient(Address, _cookies);
    }

    /// <summary>Where this client sends requests (https://localhost unless a test needs another host).</summary>
    public Uri Address { get; }

    public HttpClient Http { get; }

    /// <summary>The browser's cookie jar for this client.</summary>
    public CookieContainer Cookies => _cookies.Container;

    /// <summary>"__Host-mc_session=…", as a stolen cookie would be replayed.</summary>
    public string SessionCookieHeader()
    {
        var cookie = Cookies.GetCookies(Address)["__Host-mc_session"]
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

    /// <summary>
    /// Signs in like the app: the password step, then (when it asks for one and <paramref name="code"/> is given) the
    /// authenticator step. <paramref name="rememberDevice"/> is sent only when set, as the app sends it only when the
    /// person changed the box: an explicit false forgets a remembered device (004 FR-016a).
    /// </summary>
    public async Task<JsonElement> SignInAsync(string username, string password, string? code = null, bool? rememberDevice = null)
    {
        var state = await PasswordStepAsync(username, password, rememberDevice);
        return code is not null && state.GetProperty("state").GetString() == "mfa" ? await MfaAsync(code) : state;
    }

    /// <summary>POST /api/auth/sign-in only (004 step 1).</summary>
    public Task<JsonElement> PasswordStepAsync(string username, string password, bool? rememberDevice = null) =>
        PostForStateAsync("/api/auth/sign-in", rememberDevice is { } remember
            ? new { username, password, rememberDevice = remember }
            : (object)new { username, password });

    /// <summary>POST /api/auth/mfa only (004 step 2).</summary>
    public Task<JsonElement> MfaAsync(string code) => PostForStateAsync("/api/auth/mfa", new { code });

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
