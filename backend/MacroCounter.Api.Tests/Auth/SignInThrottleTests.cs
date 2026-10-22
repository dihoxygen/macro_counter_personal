using MacroCounter.Api.Auth;
using MacroCounter.Api.Security;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;

namespace MacroCounter.Api.Tests.Auth;

/// <summary>R7 layer 2: failures per username in a sliding window, applied the same way to names that don't exist.</summary>
public class SignInThrottleTests
{
    private readonly FakeTimeProvider _clock = new(new DateTimeOffset(2026, 10, 14, 12, 0, 0, TimeSpan.Zero));
    private readonly SignInThrottle _throttle;

    public SignInThrottleTests() => _throttle = new SignInThrottle(_clock, Options.Create(new SecurityOptions()));

    private void Fail(string key, int times)
    {
        for (var i = 0; i < times; i++) _throttle.RecordFailure(key);
    }

    [Fact]
    public void Ten_failures_within_the_window_block_with_a_retry_time()
    {
        Fail("alice", 9);
        Assert.False(_throttle.IsBlocked("alice", out _));

        _throttle.RecordFailure("alice");

        Assert.True(_throttle.IsBlocked("alice", out var retryAfter));
        Assert.Equal(TimeSpan.FromMinutes(15), retryAfter);
    }

    [Fact]
    public void A_success_for_another_name_does_not_unblock()
    {
        Fail("alice", 10);
        _throttle.RecordSuccess("bob");
        Assert.True(_throttle.IsBlocked("alice", out _));
    }

    [Fact]
    public void Failures_expire_after_the_window()
    {
        Fail("alice", 5);
        _clock.Advance(TimeSpan.FromMinutes(10));
        Fail("alice", 5);
        Assert.True(_throttle.IsBlocked("alice", out var retryAfter));
        Assert.Equal(TimeSpan.FromMinutes(5), retryAfter);

        _clock.Advance(TimeSpan.FromMinutes(5) + TimeSpan.FromSeconds(1));
        Assert.False(_throttle.IsBlocked("alice", out _));
    }

    [Fact]
    public void Unknown_names_are_treated_exactly_like_real_ones()
    {
        Fail("alice", 10);
        Fail("nobody-here", 10);

        Assert.True(_throttle.IsBlocked("alice", out var real));
        Assert.True(_throttle.IsBlocked("nobody-here", out var unknown));
        Assert.Equal(real, unknown);
    }

    [Fact]
    public void A_success_clears_that_name()
    {
        Fail("alice", 9);
        _throttle.RecordSuccess("alice");
        Fail("alice", 9);
        Assert.False(_throttle.IsBlocked("alice", out _));
    }

    [Fact]
    public void Idle_names_are_forgotten_so_memory_stays_bounded()
    {
        for (var i = 0; i < 500; i++) _throttle.RecordFailure($"name{i}");
        Assert.Equal(500, _throttle.TrackedNames);

        _clock.Advance(TimeSpan.FromMinutes(16));
        _throttle.RecordFailure("fresh");

        Assert.Equal(1, _throttle.TrackedNames);
    }
}
