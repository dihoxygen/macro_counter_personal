using MacroCounter.Api.Sync;
using Microsoft.Extensions.Time.Testing;

namespace MacroCounter.Api.Tests.Sync;

/// <summary>FR-007: ordering never trusts a device clock (R3).</summary>
public class ClockSkewTests
{
    private static readonly DateTimeOffset ServerNow = new(2026, 11, 4, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void A_correct_clock_changes_nothing()
    {
        var edit = ServerNow.AddMinutes(-5);

        Assert.Equal(edit, ClockSkew.Correct(edit, clientNow: ServerNow, serverNow: ServerNow));
    }

    [Theory]
    [InlineData(2)]
    [InlineData(-2)]
    [InlineData(72)]
    [InlineData(-72)]
    public void A_wrong_clock_is_cancelled_out(int hoursWrong)
    {
        var error = TimeSpan.FromHours(hoursWrong);
        var realEdit = ServerNow.AddMinutes(-5);

        var corrected = ClockSkew.Correct(realEdit + error, clientNow: ServerNow + error, serverNow: ServerNow);

        Assert.Equal(realEdit, corrected);
    }

    [Fact]
    public void Two_devices_with_different_clock_errors_order_by_real_time()
    {
        var earlier = ClockSkew.Correct(ServerNow.AddMinutes(-10).AddHours(2), ServerNow.AddHours(2), ServerNow);
        var later = ClockSkew.Correct(ServerNow.AddMinutes(-5).AddHours(-3), ServerNow.AddHours(-3), ServerNow);

        Assert.True(later > earlier);
    }

    [Fact]
    public void A_future_dated_edit_is_clamped_to_server_time()
    {
        var clock = new FakeTimeProvider(ServerNow);

        Assert.Equal(clock.GetUtcNow(), ClockSkew.Correct(ServerNow.AddDays(30), ServerNow, clock.GetUtcNow()));
    }

    [Fact]
    public void Equal_inputs_give_equal_outputs()
    {
        var edit = ServerNow.AddMinutes(-1);

        Assert.Equal(ClockSkew.Correct(edit, ServerNow.AddHours(1), ServerNow), ClockSkew.Correct(edit, ServerNow.AddHours(1), ServerNow));
    }

    [Fact]
    public void Times_at_the_ends_of_the_calendar_do_not_overflow()
    {
        Assert.Equal(ServerNow, ClockSkew.Correct(DateTimeOffset.MaxValue, DateTimeOffset.MinValue, ServerNow));
        Assert.Equal(DateTimeOffset.MinValue, ClockSkew.Correct(DateTimeOffset.MinValue, DateTimeOffset.MaxValue, ServerNow));
    }

    [Fact]
    public void The_result_is_in_utc()
    {
        var edit = new DateTimeOffset(2026, 11, 4, 11, 0, 0, TimeSpan.FromHours(1));

        Assert.Equal(TimeSpan.Zero, ClockSkew.Correct(edit, ServerNow, ServerNow).Offset);
    }

    [Fact]
    public void The_result_has_millisecond_precision_like_the_device()
    {
        var edit = ServerNow.AddMinutes(-1);

        var corrected = ClockSkew.Correct(edit, clientNow: ServerNow.AddTicks(-1234), serverNow: ServerNow);

        Assert.Equal(0, corrected.Ticks % TimeSpan.TicksPerMillisecond);
    }
}
