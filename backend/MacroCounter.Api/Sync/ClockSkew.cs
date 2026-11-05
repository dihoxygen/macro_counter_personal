namespace MacroCounter.Api.Sync;

/// <summary>
/// Orders edits without trusting device clocks (FR-007, research R3). A device's clock error is the same when it
/// makes an edit and when it pushes it, so the difference between its clock and the server's cancels the error out.
/// </summary>
public static class ClockSkew
{
    /// <summary>
    /// The server-time equivalent of a device timestamp, never later than <paramref name="serverNow"/>, so a
    /// future-dated edit cannot win forever. Milliseconds only, the precision device timestamps have. Worked out in
    /// wider numbers: a device can send any date, and the sum must not run off the end of the calendar.
    /// </summary>
    public static DateTimeOffset Correct(DateTimeOffset deviceTime, DateTimeOffset clientNow, DateTimeOffset serverNow)
    {
        var corrected = (Int128)deviceTime.UtcTicks + serverNow.UtcTicks - clientNow.UtcTicks;
        var clamped = (long)Int128.Clamp(corrected, DateTimeOffset.MinValue.UtcTicks, serverNow.UtcTicks);
        return new DateTimeOffset(clamped - (clamped % TimeSpan.TicksPerMillisecond), TimeSpan.Zero);
    }
}
