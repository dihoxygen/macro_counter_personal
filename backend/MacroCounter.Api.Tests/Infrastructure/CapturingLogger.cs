using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;

namespace MacroCounter.Api.Tests.Infrastructure;

/// <summary>Records every log message (and exception text) so tests can inspect what would be logged.</summary>
public sealed class CapturingLoggerProvider : ILoggerProvider
{
    public ConcurrentQueue<(LogLevel Level, string Category, string Text)> Entries { get; } = new();

    public ILogger CreateLogger(string categoryName) => new Logger(this, categoryName);

    public ILogger<T> CreateLogger<T>() => new Logger<T>(new Factory(this));

    public void Dispose()
    {
    }

    private sealed class Factory(CapturingLoggerProvider provider) : ILoggerFactory
    {
        public ILogger CreateLogger(string categoryName) => provider.CreateLogger(categoryName);

        public void AddProvider(ILoggerProvider provider)
        {
        }

        public void Dispose()
        {
        }
    }

    private sealed class Logger(CapturingLoggerProvider provider, string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            provider.Entries.Enqueue((logLevel, category, formatter(state, exception) + (exception is null ? "" : "\n" + exception)));
        }
    }
}
