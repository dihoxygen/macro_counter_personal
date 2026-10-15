using System.Net;
using System.Security.Cryptography;
using System.Text;
using MacroCounter.Api.Auth;

namespace MacroCounter.Api.Tests.Auth;

/// <summary>Have I Been Pwned k-anonymity range API; fails closed (research R2). Never calls the real service.</summary>
public class BreachedPasswordCheckerTests
{
    private sealed class FakeHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        public List<HttpRequestMessage> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(request);
            return respond(request);
        }
    }

    private static (string Prefix, string Suffix) Split(string password)
    {
        var hex = Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(password)));
        return (hex[..5], hex[5..]);
    }

    private static HibpBreachedPasswordChecker Checker(FakeHandler handler) =>
        new(new HttpClient(handler) { BaseAddress = HibpBreachedPasswordChecker.BaseAddress });

    private static Func<HttpRequestMessage, Task<HttpResponseMessage>> Body(string body) =>
        _ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body) });

    [Fact]
    public async Task Sends_only_the_first_five_hex_characters_with_padding()
    {
        const string password = "correct horse battery staple";
        var (prefix, suffix) = Split(password);
        var handler = new FakeHandler(Body("0000000000000000000000000000000000A:0\r\n"));

        await Checker(handler).IsBreachedAsync(password, CancellationToken.None);

        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Get, request.Method);
        Assert.Equal($"https://api.pwnedpasswords.com/range/{prefix}", request.RequestUri!.ToString());
        Assert.Equal("true", Assert.Single(request.Headers.GetValues("Add-Padding")));
        Assert.DoesNotContain(password, request.RequestUri.ToString());
        Assert.DoesNotContain(suffix, request.RequestUri.ToString(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task A_matching_suffix_with_a_count_means_breached()
    {
        var (_, suffix) = Split("password1234");
        var handler = new FakeHandler(Body($"0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n{suffix}:4123\r\nFFFF0000000000000000000000000000000:2"));

        Assert.True(await Checker(handler).IsBreachedAsync("password1234", CancellationToken.None));
    }

    [Fact]
    public async Task Matching_is_case_insensitive()
    {
        var (_, suffix) = Split("password1234");
        var handler = new FakeHandler(Body($"{suffix.ToLowerInvariant()}:7"));

        Assert.True(await Checker(handler).IsBreachedAsync("password1234", CancellationToken.None));
    }

    [Fact]
    public async Task A_padding_entry_with_count_zero_is_not_breached()
    {
        var (_, suffix) = Split("a very unusual passphrase");
        var handler = new FakeHandler(Body($"{suffix}:0\r\n0018A45C4D1DEF81644B54AB7F969B88D65:3"));

        Assert.False(await Checker(handler).IsBreachedAsync("a very unusual passphrase", CancellationToken.None));
    }

    [Fact]
    public async Task No_match_is_not_breached()
    {
        var handler = new FakeHandler(Body("0018A45C4D1DEF81644B54AB7F969B88D65:3"));
        Assert.False(await Checker(handler).IsBreachedAsync("a very unusual passphrase", CancellationToken.None));
    }

    public static TheoryData<string> Failures => new() { "500", "429", "network", "timeout" };

    [Theory]
    [MemberData(nameof(Failures))]
    public async Task Any_failure_fails_closed(string failure)
    {
        var handler = new FakeHandler(_ => failure switch
        {
            "network" => throw new HttpRequestException("connection refused"),
            "timeout" => throw new TaskCanceledException("timed out"),
            _ => Task.FromResult(new HttpResponseMessage((HttpStatusCode)int.Parse(failure))),
        });

        await Assert.ThrowsAsync<BreachCheckUnavailableException>(
            () => Checker(handler).IsBreachedAsync("anything at all", CancellationToken.None));
    }
}
