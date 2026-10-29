using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql;

namespace MacroCounter.Api.Tests.Security;

/// <summary>
/// An unreachable identity database gives 503 service_unavailable (auth-api.yaml), so the client shows
/// "temporarily unavailable" and falls back to offline grace (R9) instead of a generic sign-in failure.
/// Found by quickstart V9.2.
/// </summary>
[Collection("Postgres")]
public class DatabaseOutageTests(PostgresFixture db) : IAsyncLifetime
{
    public Task InitializeAsync() => db.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private static readonly string[] Leaks = ["Npgsql", "Socket", "Exception", "127.0.0.1", " at ", "stackTrace"];

    private static async Task AssertServiceUnavailable(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var body = await response.Content.ReadAsStringAsync();
        foreach (var leak in Leaks) Assert.DoesNotContain(leak, body, StringComparison.OrdinalIgnoreCase);
        Assert.Equal("service_unavailable", (await AuthClient.Json(response)).GetProperty("code").GetString());
    }

    [Fact]
    public async Task The_session_check_while_the_database_is_down_is_service_unavailable()
    {
        await using var factory = new ApiFactory(db, apiKey: null);
        // Nothing listens on port 1: every connection is refused, as when PostgreSQL is stopped.
        factory.ServiceOverrides.Add(services => services.Replace(ServiceDescriptor.Singleton(
            NpgsqlDataSource.Create("Host=127.0.0.1;Port=1;Username=nobody;Password=x;Timeout=2"))));
        var client = new AuthClient(factory);

        await AssertServiceUnavailable(await client.Http.GetAsync("/api/auth/session"));
    }

    [Fact]
    public async Task Sign_in_from_an_open_sign_in_screen_after_the_database_goes_down_is_service_unavailable()
    {
        var down = false;
        await using var factory = new ApiFactory(db, apiKey: null);
        // No pooling, so every request opens a connection; "down" makes those opens fail like a refused socket.
        var builder = new NpgsqlDataSourceBuilder(db.AppConnectionString + ";Pooling=false");
        var password = builder.ConnectionStringBuilder.Password!;
        builder.ConnectionStringBuilder.Password = null;
        string Password() => down ? throw Refused() : password;
        builder.UsePasswordProvider(_ => Password(), (_, _) => ValueTask.FromResult(Password()));
        factory.ServiceOverrides.Add(services => services.Replace(ServiceDescriptor.Singleton(builder.Build())));
        var client = new AuthClient(factory);
        await client.SessionAsync();

        down = true;
        var response = await client.PostAsync("/api/auth/sign-in",
            new { username = "alice", password = "a long and private passphrase", code = "123456" });

        await AssertServiceUnavailable(response);
    }

    private static NpgsqlException Refused() =>
        new("Failed to connect", new SocketException((int)SocketError.ConnectionRefused));

    public static TheoryData<Exception> DatabaseUnreachable() => new()
    {
        Refused(),
        // EF Core wraps transient provider errors like this when it does not retry.
        new InvalidOperationException("An exception has been raised that is likely due to a transient failure.", Refused()),
    };

    [Theory]
    [MemberData(nameof(DatabaseUnreachable))]
    public async Task A_signed_in_request_that_loses_the_database_is_service_unavailable(Exception error)
    {
        await using var factory = new ApiFactory(db, apiKey: "test-key-not-real", FakeEstimator.Throwing(error));
        var client = await factory.SignedInClientAsync();

        var response = await client.PostAsJsonAsync("/api/estimates/text", new { description = "banana" });

        await AssertServiceUnavailable(response);
    }

    [Fact]
    public async Task A_database_error_that_is_not_an_outage_stays_a_generic_500()
    {
        var error = new PostgresException("permission denied for table users", "ERROR", "ERROR", PostgresErrorCodes.InsufficientPrivilege);
        await using var factory = new ApiFactory(db, apiKey: "test-key-not-real", FakeEstimator.Throwing(error));
        var client = await factory.SignedInClientAsync();

        var response = await client.PostAsJsonAsync("/api/estimates/text", new { description = "banana" });

        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
    }
}
