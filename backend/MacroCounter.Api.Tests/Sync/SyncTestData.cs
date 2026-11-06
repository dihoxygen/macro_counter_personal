using System.Net;
using System.Text.Json;
using MacroCounter.Api.Tests.Infrastructure;

namespace MacroCounter.Api.Tests.Sync;

/// <summary>Wire-shaped records and calls for the sync tests (contracts/sync-api.yaml).</summary>
public static class SyncTestData
{
    /// <summary>Which account a tab is syncing for (contracts/sync-api.yaml). TestUsers.ActivateAsync sets it.</summary>
    public const string AccountHeader = "X-Sync-Account";

    public static readonly DateTimeOffset Start = new(2026, 11, 4, 8, 0, 0, TimeSpan.Zero);

    public static string Iso(DateTimeOffset time) => time.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'");

    public static object Entry(Guid id, DateTimeOffset updatedAt, double amount = 120, string name = "Banana",
        Guid? versionId = null, string dayKey = "2026-11-04", string? meal = "breakfast", Guid? savedFoodId = null,
        double kcal = 107) => new Dictionary<string, object?>
        {
            ["id"] = id,
            ["versionId"] = versionId ?? Guid.NewGuid(),
            ["createdAt"] = Iso(Start),
            ["updatedAt"] = Iso(updatedAt),
            ["schemaVersion"] = 1,
            ["dayKey"] = dayKey,
            ["loggedAt"] = Iso(Start),
            ["name"] = name,
            ["quantity"] = new { amount, unit = "g" },
            ["macros"] = new { kcal, proteinG = 1.3, carbsG = 27.5, fatG = 0.4 },
            ["source"] = "manual",
            ["savedFoodId"] = savedFoodId,
            ["mealCategory"] = meal,
        };

    public static object Food(Guid id, DateTimeOffset updatedAt, string name = "Greek yogurt", string unit = "g",
        DateTimeOffset? lastUsedAt = null, double kcal = 100) => new Dictionary<string, object?>
        {
            ["id"] = id,
            ["createdAt"] = Iso(Start),
            ["updatedAt"] = Iso(updatedAt),
            ["schemaVersion"] = 1,
            ["name"] = name,
            ["referenceQuantity"] = new { amount = 100, unit },
            ["macros"] = new { kcal, proteinG = 10, carbsG = 4, fatG = 5 },
            ["source"] = "ai",
            ["lastUsedAt"] = Iso(lastUsedAt ?? updatedAt),
        };

    public static object Goal(Guid id, DateTimeOffset updatedAt, double? grams = 150, string effectiveFrom = "2026-11-04") =>
        new Dictionary<string, object?>
        {
            ["id"] = id,
            ["createdAt"] = Iso(Start),
            ["updatedAt"] = Iso(updatedAt),
            ["schemaVersion"] = 1,
            ["effectiveFrom"] = effectiveFrom,
            ["grams"] = grams,
        };

    public static object Version(Guid id, Guid entryId, DateTimeOffset updatedAt, DateTimeOffset replacedAt,
        string changeType = "edit", double amount = 120, string? meal = "breakfast", Guid? savedFoodId = null) =>
        new Dictionary<string, object?>
        {
            ["id"] = id,
            ["entryId"] = entryId,
            ["changeType"] = changeType,
            ["replacedAt"] = Iso(replacedAt),
            ["createdAt"] = Iso(Start),
            ["updatedAt"] = Iso(updatedAt),
            ["schemaVersion"] = 1,
            ["dayKey"] = "2026-11-04",
            ["loggedAt"] = Iso(Start),
            ["name"] = "Banana",
            ["quantity"] = new { amount, unit = "g" },
            ["macros"] = new { kcal = 107, proteinG = 1.3, carbsG = 27.5, fatG = 0.4 },
            ["source"] = "manual",
            ["savedFoodId"] = savedFoodId,
            ["mealCategory"] = meal,
        };

    public static object Upsert(string type, Guid id, object record) => new { type, op = "upsert", id, record };

    public static object Restore(Guid id, object record) => new { type = "entry", op = "restore", id, record };

    public static object Insert(Guid id, object version) => new { type = "version", op = "insert", id, record = version };

    public static object Delete(Guid id, DateTimeOffset deletedAt) => new { type = "entry", op = "delete", id, deletedAt = Iso(deletedAt) };

    /// <summary>Pushes, asserting a 200, and returns the body.</summary>
    public static async Task<JsonElement> PushAsync(this AuthClient client, DateTimeOffset clientNow, params object[] changes)
    {
        var response = await client.PostAsync("/api/sync/push", new { clientNow = Iso(clientNow), changes });
        Assert.True(response.StatusCode == HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        return await AuthClient.Json(response);
    }

    public static string[] Statuses(this JsonElement push) =>
        [.. push.GetProperty("results").EnumerateArray().Select(r => r.GetProperty("status").GetString()!)];

    /// <summary>Every change after <paramref name="since"/>, following pages.</summary>
    public static async Task<List<JsonElement>> PullAllAsync(this AuthClient client, long since = 0)
    {
        var all = new List<JsonElement>();
        var cursor = since;
        while (true)
        {
            var response = await client.Http.GetAsync($"/api/sync/changes?since={cursor}");
            Assert.True(response.StatusCode == HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
            var page = await AuthClient.Json(response);
            all.AddRange(page.GetProperty("changes").EnumerateArray());
            cursor = page.GetProperty("cursor").GetInt64();
            if (!page.GetProperty("hasMore").GetBoolean()) return all;
        }
    }

    public static async Task AcknowledgeAsync(this AuthClient client) =>
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/sync/notice")).StatusCode);

    public static JsonElement? Find(this IEnumerable<JsonElement> changes, string type, Guid id) =>
        changes.Where(c => c.GetProperty("type").GetString() == type
                && (c.TryGetProperty("id", out var bare) ? bare.GetGuid() : c.GetProperty("record").GetProperty("id").GetGuid()) == id)
            .Cast<JsonElement?>().LastOrDefault();
}
