namespace MacroCounter.Api.Sync;

/// <summary>
/// Orders edits without trusting device clocks (FR-007, research R3). A device's clock error is the same when it
/// makes an edit and when it pushes it, so the difference between its clock and the server's cancels the error out.
/// </summary>
public static class ClockSkew
{
    /// <summary>
    /// The server-time equivalent of a device timestamp, never later than <paramref name="serverNow"/>, so a
    /// future-dated edit cannot win forever. Milliseconds only, the precision device timestamps have.
    /// </summary>
    public static DateTimeOffset Correct(DateTimeOffset deviceTime, DateTimeOffset clientNow, DateTimeOffset serverNow)
    {
        var corrected = deviceTime + (serverNow - clientNow);
        var clamped = corrected < serverNow ? corrected : serverNow;
        return new DateTimeOffset(clamped.Ticks - (clamped.Ticks % TimeSpan.TicksPerMillisecond), clamped.Offset);
    }
}
