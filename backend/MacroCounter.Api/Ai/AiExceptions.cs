namespace MacroCounter.Api.Ai;

/// <summary>No key configured, or Claude could not be reached (503 ai_unavailable).</summary>
public sealed class AiUnavailableException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>Claude did not answer in time (504 ai_timeout).</summary>
public sealed class AiTimeoutException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>Claude refused or returned unusable output (502 invalid_ai_response).</summary>
public sealed class InvalidAiResponseException(string message, Exception? inner = null) : Exception(message, inner);
