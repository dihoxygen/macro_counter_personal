using System.Security.Claims;
using MacroCounter.Api.Audit;
using MacroCounter.Api.Auth;
using MacroCounter.Api.Endpoints;
using MacroCounter.Api.Security;

namespace MacroCounter.Api.Sync;

/// <summary>
/// /api/sync (specs/007-cross-device-sync/contracts/sync-api.yaml). Everything needs a full session through the
/// fallback policy, and the user comes only from that session: no request can name another user (R10).
/// </summary>
public static class SyncEndpoints
{
    /// <summary>R11: a push of 200 changes fits comfortably.</summary>
    public const int MaxPushBytes = 256 * 1024;

    public const int MaxPageSize = 500;

    public static void MapSyncEndpoints(this IEndpointRouteBuilder api)
    {
        var sync = api.MapGroup("/sync").RequireRateLimiting(RateLimits.SyncPerUser);
        sync.MapGet("/state", GetState);
        sync.MapPost("/notice", AcknowledgeNotice);
        sync.MapPost("/push", Push);
        sync.MapGet("/changes", Changes);
    }

    private static Guid UserId(HttpContext context) => Guid.Parse(context.User.FindFirstValue(AuthClaims.Subject)!);

    private static async Task<IResult> GetState(HttpContext context, SyncStore store) =>
        Results.Json(await store.GetStateAsync(UserId(context), context.RequestAborted), SyncJson.Options);

    private static async Task<IResult> AcknowledgeNotice(HttpContext context, SyncStore store, TimeProvider clock)
    {
        await store.AcknowledgeNoticeAsync(UserId(context), clock.GetUtcNow(), context.RequestAborted);
        return Results.NoContent();
    }

    private static async Task<bool> NoticeAcknowledged(HttpContext context, SyncStore store) =>
        (await store.GetStateAsync(UserId(context), context.RequestAborted)).NoticeAcknowledged;

    private static Task AuditRejected(HttpContext context, IAuditLog audit, AuditReason reason) =>
        audit.WriteAsync(AuditEvent.SyncRejected, AuditOutcome.Failure, UserId(context), reason,
            context.Connection.RemoteIpAddress, context.RequestAborted);

    private static AuditReason ReasonFor(string code) =>
        code == AuditLog.Code(AuditReason.DayKeyChanged) ? AuditReason.DayKeyChanged
        : code == AuditLog.Code(AuditReason.UnknownSchemaVersion) ? AuditReason.UnknownSchemaVersion
        : AuditReason.InvalidRecord;

    private static async Task<IResult> Push(HttpContext context, SyncStore store, IAuditLog audit, TimeProvider clock)
    {
        if (!await NoticeAcknowledged(context, store)) return Problems.SyncNoticeRequired();
        var (request, problem) = await StrictJson.ReadAsync<PushRequest>(context, MaxPushBytes, SyncJson.Options);
        if (problem is not null) return problem;
        if (request!.Changes.Count == 0) return Problems.InvalidRequest("Send at least one change.");

        var validation = SyncValidator.Validate(request);
        if (validation.TooMany)
        {
            await AuditRejected(context, audit, AuditReason.TooManyChanges);
            return Problems.TooManyChanges();
        }
        if (validation.Invalid.Count > 0)
        {
            await AuditRejected(context, audit, ReasonFor(validation.Invalid[0].Reason));
            return Problems.InvalidChanges(validation.Invalid);
        }

        var outcome = await store.PushAsync(UserId(context), request.ClientNow, validation.Changes, clock.GetUtcNow(), context.RequestAborted);
        if (outcome.Response is null)
        {
            await AuditRejected(context, audit, ReasonFor(outcome.Invalid[0].Reason));
            return Problems.InvalidChanges(outcome.Invalid);
        }
        return Results.Json(outcome.Response, SyncJson.Options);
    }

    private static async Task<IResult> Changes(HttpContext context, SyncStore store, TimeProvider clock, long? since, int? limit)
    {
        if (!await NoticeAcknowledged(context, store)) return Problems.SyncNoticeRequired();
        if (since is not >= 0) return Problems.InvalidRequest("Send since, the last revision this device has seen.");
        if (limit < 1) return Problems.InvalidRequest("limit must be at least 1.");

        var page = await store.PullAsync(UserId(context), since.Value, Math.Min(limit ?? MaxPageSize, MaxPageSize), clock.GetUtcNow(), context.RequestAborted);
        return Results.Json(page, SyncJson.Options);
    }
}
