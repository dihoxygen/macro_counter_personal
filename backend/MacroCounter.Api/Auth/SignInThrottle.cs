using System.Collections.Concurrent;
using MacroCounter.Api.Security;
using Microsoft.Extensions.Options;

namespace MacroCounter.Api.Auth;

/// <summary>
/// Failed sign-ins per normalized username in a sliding window (research R7, layer 2). It is keyed by the
/// name typed, not by account, so a name that does not exist is limited exactly like a real one and a
/// lockout never reveals whether an account exists (FR-006). In memory: the account lockout stored on the
/// user (layer 3) covers restarts.
/// </summary>
public sealed class SignInThrottle(TimeProvider clock, IOptions<SecurityOptions> options)
{
    private static readonly TimeSpan SweepInterval = TimeSpan.FromMinutes(1);

    private readonly ConcurrentDictionary<string, Queue<DateTimeOffset>> _failures = new(StringComparer.Ordinal);
    private DateTimeOffset _lastSweep = DateTimeOffset.MinValue;

    /// <summary>For tests: how many names are currently remembered.</summary>
    public int TrackedNames => _failures.Count;

    public bool IsBlocked(string name, out TimeSpan retryAfter)
    {
        var now = clock.GetUtcNow();
        var (limit, window) = Settings();
        retryAfter = TimeSpan.Zero;
        if (!_failures.TryGetValue(name, out var queue)) return false;

        lock (queue)
        {
            Prune(queue, now - window);
            if (queue.Count < limit) return false;
            retryAfter = queue.Peek() + window - now;
            return true;
        }
    }

    public void RecordFailure(string name)
    {
        var now = clock.GetUtcNow();
        Sweep(now);
        var queue = _failures.GetOrAdd(name, _ => new Queue<DateTimeOffset>());
        lock (queue)
        {
            queue.Enqueue(now);
            // Only the failures inside the window matter; never keep more than the limit's worth.
            while (queue.Count > Settings().Limit) queue.Dequeue();
        }
    }

    public void RecordSuccess(string name) => _failures.TryRemove(name, out _);

    private (int Limit, TimeSpan Window) Settings()
    {
        var signIn = options.Value.SignIn;
        return (signIn.PerUsernameFailures, signIn.PerUsernameWindow);
    }

    private static void Prune(Queue<DateTimeOffset> queue, DateTimeOffset cutoff)
    {
        while (queue.Count > 0 && queue.Peek() <= cutoff) queue.Dequeue();
    }

    /// <summary>Forgets names with no failure inside the window, so memory stays bounded.</summary>
    private void Sweep(DateTimeOffset now)
    {
        if (now - _lastSweep < SweepInterval) return;
        _lastSweep = now;
        var cutoff = now - Settings().Window;
        foreach (var (name, queue) in _failures)
        {
            bool idle;
            lock (queue)
            {
                Prune(queue, cutoff);
                idle = queue.Count == 0;
            }
            if (idle) _failures.TryRemove(new KeyValuePair<string, Queue<DateTimeOffset>>(name, queue));
        }
    }
}
