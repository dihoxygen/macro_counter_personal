using System.Text.Json;
using MacroCounter.Api.Endpoints;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace MacroCounter.Api.Tests.Endpoints;

/// <summary>Every 003 problem response carries the status and code from contracts/auth-api.yaml.</summary>
public class ProblemsTests
{
    private static async Task<(int Status, IHeaderDictionary Headers, JsonElement Body)> Run(IResult result)
    {
        var context = new DefaultHttpContext
        {
            RequestServices = new ServiceCollection().AddLogging().AddProblemDetails().BuildServiceProvider(),
        };
        context.Response.Body = new MemoryStream();
        await result.ExecuteAsync(context);
        context.Response.Body.Position = 0;
        var body = await JsonDocument.ParseAsync(context.Response.Body);
        return (context.Response.StatusCode, context.Response.Headers, body.RootElement);
    }

    public static TheoryData<string, int, string> Simple => new()
    {
        { nameof(Problems.Unauthenticated), 401, "unauthenticated" },
        { nameof(Problems.CsrfFailed), 403, "csrf_failed" },
        { nameof(Problems.SignInFailed), 401, "sign_in_failed" },
        { nameof(Problems.BreachCheckUnavailable), 503, "breach_check_unavailable" },
        { nameof(Problems.ServiceUnavailable), 503, "service_unavailable" },
    };

    [Theory]
    [MemberData(nameof(Simple))]
    public async Task Simple_problems_have_the_contract_status_and_code(string factory, int status, string code)
    {
        var result = (IResult)typeof(Problems).GetMethod(factory)!.Invoke(null, null)!;
        var (actualStatus, _, body) = await Run(result);

        Assert.Equal(status, actualStatus);
        Assert.Equal(code, body.GetProperty("code").GetString());
        Assert.Equal(status, body.GetProperty("status").GetInt32());
        Assert.False(string.IsNullOrWhiteSpace(body.GetProperty("title").GetString()));
    }

    [Fact]
    public async Task Sign_in_failure_has_the_exact_generic_message()
    {
        var (_, _, body) = await Run(Problems.SignInFailed());
        Assert.Equal("Username or password is incorrect.", body.GetProperty("detail").GetString());
    }

    [Fact]
    public async Task Rate_limited_sets_retry_after_in_whole_seconds()
    {
        var (status, headers, body) = await Run(Problems.RateLimited(TimeSpan.FromSeconds(89.2)));
        Assert.Equal(429, status);
        Assert.Equal("rate_limited", body.GetProperty("code").GetString());
        Assert.Equal("90", headers.RetryAfter.ToString());
        Assert.Equal("Too many attempts. Try again later.", body.GetProperty("detail").GetString());
    }

    [Fact]
    public async Task Quota_exceeded_carries_scope_reset_time_and_retry_after()
    {
        var resetAt = new DateTimeOffset(2026, 10, 15, 0, 0, 0, TimeSpan.Zero);
        var (status, headers, body) = await Run(Problems.QuotaExceeded("user_daily", resetAt, TimeSpan.FromMinutes(30)));

        Assert.Equal(429, status);
        Assert.Equal("quota_exceeded", body.GetProperty("code").GetString());
        Assert.Equal("user_daily", body.GetProperty("scope").GetString());
        Assert.Equal(resetAt, body.GetProperty("resetAt").GetDateTimeOffset());
        Assert.Equal("1800", headers.RetryAfter.ToString());
    }

    [Fact]
    public async Task Password_rejected_lists_the_reasons()
    {
        var (status, _, body) = await Run(Problems.PasswordRejected(["too_short", "breached"]));
        Assert.Equal(400, status);
        Assert.Equal("password_rejected", body.GetProperty("code").GetString());
        Assert.Equal(["too_short", "breached"], body.GetProperty("reasons").EnumerateArray().Select(e => e.GetString()));
    }

    [Fact]
    public async Task Invalid_code_reports_attempts_left()
    {
        var (status, _, body) = await Run(Problems.InvalidCode(3));
        Assert.Equal(400, status);
        Assert.Equal("invalid_code", body.GetProperty("code").GetString());
        Assert.Equal(3, body.GetProperty("attemptsLeft").GetInt32());
    }

    [Fact]
    public async Task Wrong_setup_step_names_the_expected_step()
    {
        var (status, _, body) = await Run(Problems.WrongSetupStep("totp"));
        Assert.Equal(409, status);
        Assert.Equal("wrong_setup_step", body.GetProperty("code").GetString());
        Assert.Equal("totp", body.GetProperty("setupStep").GetString());
    }
}
