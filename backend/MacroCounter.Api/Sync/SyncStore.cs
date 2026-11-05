using System.Data;
using MacroCounter.Api.Audit;
using Npgsql;

namespace MacroCounter.Api.Sync;

/// <summary>The result of a push: applied in full, or refused in full with the changes to blame.</summary>
public sealed record PushOutcome(PushResponse? Response, IReadOnlyList<InvalidChange> Invalid);

/// <summary>
/// The only code that reads or writes macro_data (Principle III). Every statement runs inside a transaction that
/// sets macro.user_id, so row-level security pins it to the session's user even if a query forgets its filter (R10).
/// </summary>
public sealed class SyncStore(NpgsqlDataSource dataSource)
{
    private const string Applied = "applied";
    private const string Superseded = "superseded";

    private static readonly string DayKeyChanged = AuditLog.Code(AuditReason.DayKeyChanged);

    private sealed class UserTransaction(NpgsqlConnection connection, NpgsqlTransaction transaction) : IAsyncDisposable
    {
        public NpgsqlTransaction Transaction { get; } = transaction;

        public NpgsqlCommand Command(string sql, params object?[] parameters)
        {
            var command = new NpgsqlCommand(sql, connection, Transaction);
            foreach (var parameter in parameters) command.Parameters.Add(new NpgsqlParameter { Value = parameter ?? DBNull.Value });
            return command;
        }

        public async ValueTask DisposeAsync()
        {
            await Transaction.DisposeAsync();
            await connection.DisposeAsync();
        }
    }

    private async Task<UserTransaction> BeginUserTransactionAsync(Guid userId, IsolationLevel isolation, CancellationToken cancellationToken)
    {
        var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var transaction = await connection.BeginTransactionAsync(isolation, cancellationToken);
        var scope = new UserTransaction(connection, transaction);
        await using var set = scope.Command("select set_config('macro.user_id', $1, true)", userId.ToString());
        await set.ExecuteNonQueryAsync(cancellationToken);
        return scope;
    }

    public async Task<SyncStateResponse> GetStateAsync(Guid userId, CancellationToken cancellationToken)
    {
        await using var scope = await BeginUserTransactionAsync(userId, IsolationLevel.ReadCommitted, cancellationToken);
        await using var select = scope.Command("select notice_ack_at is not null, revision from macro_data.sync_state where user_id = $1", userId);
        await using var reader = await select.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? new SyncStateResponse(reader.GetBoolean(0), reader.GetInt64(1))
            : new SyncStateResponse(false, 0);
    }

    /// <summary>Idempotent: the first acknowledgement's time stands.</summary>
    public async Task AcknowledgeNoticeAsync(Guid userId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var scope = await BeginUserTransactionAsync(userId, IsolationLevel.ReadCommitted, cancellationToken);
        await using (var upsert = scope.Command("""
            insert into macro_data.sync_state (user_id, revision, notice_ack_at) values ($1, 0, $2)
            on conflict (user_id) do update set notice_ack_at = coalesce(macro_data.sync_state.notice_ack_at, excluded.notice_ack_at)
            """, userId, now))
        {
            await upsert.ExecuteNonQueryAsync(cancellationToken);
        }
        await scope.Transaction.CommitAsync(cancellationToken);
    }

    /// <summary>
    /// Applies a validated push in one transaction, all or nothing (FR-014). The sync_state row lock serializes a
    /// user's pushes, so revisions commit in order and every decision below sees settled data (R2).
    /// </summary>
    public async Task<PushOutcome> PushAsync(Guid userId, DateTimeOffset clientNow, IReadOnlyList<ValidChange> changes,
        DateTimeOffset serverNow, CancellationToken cancellationToken)
    {
        await using var scope = await BeginUserTransactionAsync(userId, IsolationLevel.ReadCommitted, cancellationToken);
        long revision;
        await using (var select = scope.Command("select revision from macro_data.sync_state where user_id = $1 for update", userId))
        {
            revision = (long)(await select.ExecuteScalarAsync(cancellationToken))!;
        }

        var push = new Push(scope, userId, clientNow, serverNow, revision, cancellationToken);
        // Versions first, so a device's own change type beats the "edit" recorded for a state it displaced (R14).
        foreach (var change in changes.OrderBy(c => c.Change.Type == "version" ? 0 : 1).ThenBy(c => c.Index))
        {
            await push.ApplyAsync(change);
        }
        if (push.Invalid.Count > 0) return new PushOutcome(null, [.. push.Invalid.OrderBy(i => i.Index)]);

        await using (var update = scope.Command("update macro_data.sync_state set revision = $2 where user_id = $1", userId, push.Revision))
        {
            await update.ExecuteNonQueryAsync(cancellationToken);
        }
        await scope.Transaction.CommitAsync(cancellationToken);
        return new PushOutcome(new PushResponse(push.Revision, [.. push.Results.OrderBy(r => r.Key).Select(r => r.Value)]), []);
    }

    private sealed record EntryData(
        DateOnly DayKey, DateTimeOffset LoggedAt, string Name, double Amount, string Unit, double Kcal, double ProteinG,
        double CarbsG, double FatG, string Source, Guid? SavedFoodId, string? MealCategory)
    {
        public static EntryData From(LogEntryDto e) => new(e.DayKey, e.LoggedAt, e.Name, e.Quantity.Amount, e.Quantity.Unit,
            e.Macros.Kcal, e.Macros.ProteinG, e.Macros.CarbsG, e.Macros.FatG, e.Source, e.SavedFoodId, e.MealCategory);

        public static EntryData From(EntryVersionDto v) => new(v.DayKey, v.LoggedAt, v.Name, v.Quantity.Amount, v.Quantity.Unit,
            v.Macros.Kcal, v.Macros.ProteinG, v.Macros.CarbsG, v.Macros.FatG, v.Source, v.SavedFoodId, v.MealCategory);
    }

    /// <summary>A row of log_entries. <see cref="Data"/> is null on a tombstone.</summary>
    private sealed record StoredEntry(Guid Id, DateTimeOffset CreatedAt, DateTimeOffset EffectiveAt, int SchemaVersion,
        DateTimeOffset? DeletedAt, EntryData? Data, Guid? VersionId, DateTimeOffset? RestoredAt);

    /// <summary>One push in progress: the rules of research R3, R4, R14 and R15.</summary>
    private sealed class Push(UserTransaction scope, Guid userId, DateTimeOffset clientNow, DateTimeOffset serverNow, long revision,
        CancellationToken cancellationToken)
    {
        public long Revision { get; private set; } = revision;

        public List<InvalidChange> Invalid { get; } = [];

        public Dictionary<int, PushResult> Results { get; } = [];

        private DateTimeOffset Correct(DateTimeOffset deviceTime) => ClockSkew.Correct(deviceTime, clientNow, serverNow);

        private long NextRevision() => ++Revision;

        private async Task<int> ExecuteAsync(string sql, params object?[] parameters)
        {
            await using var command = scope.Command(sql, parameters);
            return await command.ExecuteNonQueryAsync(cancellationToken);
        }

        public async Task ApplyAsync(ValidChange valid)
        {
            var change = valid.Change;
            var (status, canonicalId) = change.Type switch
            {
                "version" => (await InsertVersionAsync((EntryVersionDto)valid.Record!), null),
                "food" => await UpsertFoodAsync((SavedFoodDto)valid.Record!),
                "goal" => await UpsertGoalAsync((ProteinGoalDto)valid.Record!),
                _ => (change.Op == "delete"
                    ? await DeleteEntryAsync(change.Id, Correct(change.DeletedAt!.Value))
                    : await UpsertEntryAsync(valid.Index, (LogEntryDto)valid.Record!, restore: change.Op == "restore"), (Guid?)null),
            };
            if (status is not null) Results[valid.Index] = new PushResult(change.Type, change.Id, status, canonicalId);
        }

        // ---- Entries ----

        private const string EntryColumns = """
            id, created_at, effective_at, schema_version, deleted_at, day_key, logged_at, name, quantity_amount, quantity_unit,
            kcal, protein_g, carbs_g, fat_g, source, saved_food_id, meal_category, version_id, restored_at
            """;

        private async Task<StoredEntry?> LoadEntryAsync(Guid id)
        {
            await using var select = scope.Command(
                $"select {EntryColumns} from macro_data.log_entries where user_id = $1 and id = $2", userId, id);
            await using var reader = await select.ExecuteReaderAsync(cancellationToken);
            return await reader.ReadAsync(cancellationToken) ? ReadEntry(reader) : null;
        }

        private static StoredEntry ReadEntry(NpgsqlDataReader r)
        {
            var deletedAt = r.IsDBNull(4) ? (DateTimeOffset?)null : r.GetFieldValue<DateTimeOffset>(4);
            var data = deletedAt is not null ? null : new EntryData(r.GetFieldValue<DateOnly>(5), r.GetFieldValue<DateTimeOffset>(6),
                r.GetString(7), r.GetDouble(8), r.GetString(9), r.GetDouble(10), r.GetDouble(11), r.GetDouble(12), r.GetDouble(13),
                r.GetString(14), r.IsDBNull(15) ? null : r.GetGuid(15), r.IsDBNull(16) ? null : r.GetString(16));
            return new StoredEntry(r.GetGuid(0), r.GetFieldValue<DateTimeOffset>(1), r.GetFieldValue<DateTimeOffset>(2), r.GetInt32(3),
                deletedAt, data, r.IsDBNull(17) ? null : r.GetGuid(17), r.IsDBNull(18) ? null : r.GetFieldValue<DateTimeOffset>(18));
        }

        private async Task<string?> UpsertEntryAsync(int index, LogEntryDto entry, bool restore)
        {
            var effective = Correct(entry.UpdatedAt);
            var data = EntryData.From(entry) with { SavedFoodId = await CanonicalFoodIdAsync(entry.SavedFoodId) };
            var stored = await LoadEntryAsync(entry.Id);

            if (stored is null)
            {
                await WriteEntryAsync(entry.Id, entry.CreatedAt, entry.VersionId, data, effective, entry.SchemaVersion,
                    restore ? effective : null, insert: true);
                return Applied;
            }

            if (stored.Data is { } live)
            {
                if (live.DayKey != entry.DayKey)
                {
                    Invalid.Add(new InvalidChange(index, DayKeyChanged));
                    return null;
                }
                if (stored.VersionId == entry.VersionId || effective <= stored.EffectiveAt)
                {
                    return await LoseToStoredAsync(stored, entry, data, effective);
                }

                await KeepStoredAsVersionAsync(stored, live, restore ? "restore" : "edit", effective);
                // A null category never replaces one: "Uncategorized" is not something an entry can go back to (R17).
                await WriteEntryAsync(entry.Id, stored.CreatedAt, entry.VersionId,
                    data with { MealCategory = data.MealCategory ?? live.MealCategory }, effective, entry.SchemaVersion,
                    restore ? effective : stored.RestoredAt, insert: false);
                return Applied;
            }

            // A tombstone: only an explicit, later restore brings an entry back (R15).
            if (restore && effective > stored.DeletedAt)
            {
                await WriteEntryAsync(entry.Id, stored.CreatedAt, entry.VersionId, data, effective, entry.SchemaVersion, effective, insert: false);
                return Applied;
            }
            return await LoseToStoredAsync(stored, entry, data, effective);
        }

        /// <summary>
        /// The stored row won. The losing state stays recoverable (SC-007), and the winner takes a new revision: a pull
        /// may have skipped it while this change was pending and moved the cursor past it (R2).
        /// </summary>
        private async Task<string> LoseToStoredAsync(StoredEntry stored, LogEntryDto entry, EntryData data, DateTimeOffset effective)
        {
            if (stored.VersionId != entry.VersionId)
            {
                await InsertVersionRowAsync(entry.VersionId, entry.Id, "edit", effective, entry.CreatedAt, effective,
                    entry.SchemaVersion, data, restoredAt: null);
            }
            await BumpAsync("log_entries", entry.Id);
            return Superseded;
        }

        private async Task BumpAsync(string table, Guid id) =>
            await ExecuteAsync($"update macro_data.{table} set revision = $3 where user_id = $1 and id = $2", userId, id, NextRevision());

        private Task KeepStoredAsVersionAsync(StoredEntry stored, EntryData live, string changeType, DateTimeOffset replacedAt) =>
            InsertVersionRowAsync(stored.VersionId!.Value, stored.Id, changeType, replacedAt, stored.CreatedAt, stored.EffectiveAt,
                stored.SchemaVersion, live, stored.RestoredAt);

        private async Task WriteEntryAsync(Guid id, DateTimeOffset createdAt, Guid versionId, EntryData data, DateTimeOffset effective,
            int schemaVersion, DateTimeOffset? restoredAt, bool insert)
        {
            object?[] values =
            [
                userId, id, createdAt, effective, schemaVersion, NextRevision(), data.DayKey, data.LoggedAt, data.Name, data.Amount, data.Unit,
                data.Kcal, data.ProteinG, data.CarbsG, data.FatG, data.Source, data.SavedFoodId, data.MealCategory, versionId, restoredAt,
            ];
            await ExecuteAsync(insert
                ? """
                  insert into macro_data.log_entries (user_id, id, created_at, effective_at, schema_version, revision, day_key, logged_at,
                      name, quantity_amount, quantity_unit, kcal, protein_g, carbs_g, fat_g, source, saved_food_id, meal_category, version_id, restored_at)
                  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
                  """
                : """
                  update macro_data.log_entries set created_at = $3, effective_at = $4, schema_version = $5, revision = $6, deleted_at = null,
                      day_key = $7, logged_at = $8, name = $9, quantity_amount = $10, quantity_unit = $11, kcal = $12, protein_g = $13,
                      carbs_g = $14, fat_g = $15, source = $16, saved_food_id = $17, meal_category = $18, version_id = $19, restored_at = $20
                  where user_id = $1 and id = $2
                  """, values);
        }

        private async Task<string> DeleteEntryAsync(Guid id, DateTimeOffset effective)
        {
            var stored = await LoadEntryAsync(id);
            if (stored is null)
            {
                await ExecuteAsync("""
                    insert into macro_data.log_entries (user_id, id, created_at, effective_at, schema_version, revision, deleted_at)
                    values ($1, $2, $3, $3, $4, $5, $3)
                    """, userId, id, effective, SyncValidator.KnownSchemaVersion, NextRevision());
                return Applied;
            }
            if (stored.Data is not { } live) return Applied;

            // This delete was made before the entry was restored, so the restore is the newer decision (R15).
            if (stored.RestoredAt > effective)
            {
                await BumpAsync("log_entries", id);
                return Superseded;
            }

            await KeepStoredAsVersionAsync(stored, live, "delete", effective);
            // The food data now lives only in the version, so the 90-day purge removes all of it (R16).
            await ExecuteAsync("""
                update macro_data.log_entries set deleted_at = $3, effective_at = $3, revision = $4, day_key = null, logged_at = null,
                    name = null, quantity_amount = null, quantity_unit = null, kcal = null, protein_g = null, carbs_g = null, fat_g = null,
                    source = null, saved_food_id = null, meal_category = null, version_id = null
                where user_id = $1 and id = $2
                """, userId, id, effective, NextRevision());
            return Applied;
        }

        // ---- Entry versions ----

        private async Task<string> InsertVersionAsync(EntryVersionDto version)
        {
            var replacedAt = Correct(version.ReplacedAt);
            var current = await LoadEntryAsync(version.EntryId);

            // The device's copy of the state in place may be a pulled one: its times are already corrected, and it does
            // not carry the restore marker. The stored row is the authority for that state (R14).
            if (current is { Data: { } live } && current.VersionId == version.Id)
            {
                await KeepStoredAsVersionAsync(current, live, version.ChangeType, replacedAt);
                return Applied;
            }

            var data = EntryData.From(version) with { SavedFoodId = await CanonicalFoodIdAsync(version.SavedFoodId) };
            await InsertVersionRowAsync(version.Id, version.EntryId, version.ChangeType, replacedAt, version.CreatedAt,
                Correct(version.UpdatedAt), version.SchemaVersion, data, restoredAt: null);
            return Applied;
        }

        /// <summary>Insert-only. The same state from a second device leaves the first arrival in place (R14).</summary>
        private async Task InsertVersionRowAsync(Guid id, Guid entryId, string changeType, DateTimeOffset replacedAt, DateTimeOffset createdAt,
            DateTimeOffset effectiveAt, int schemaVersion, EntryData data, DateTimeOffset? restoredAt)
        {
            var inserted = await ExecuteAsync("""
                insert into macro_data.entry_versions (user_id, id, entry_id, change_type, replaced_at, created_at, effective_at, schema_version,
                    revision, day_key, logged_at, name, quantity_amount, quantity_unit, kcal, protein_g, carbs_g, fat_g, source,
                    saved_food_id, meal_category, restored_at)
                values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
                on conflict (user_id, id) do nothing
                """, userId, id, entryId, changeType, replacedAt, createdAt, effectiveAt, schemaVersion, Revision + 1, data.DayKey, data.LoggedAt,
                data.Name, data.Amount, data.Unit, data.Kcal, data.ProteinG, data.CarbsG, data.FatG, data.Source, data.SavedFoodId,
                data.MealCategory, restoredAt);
            if (inserted > 0) NextRevision();
        }

        // ---- Saved foods and goals ----

        private const string Merged = "merged";

        private async Task<Guid?> ScalarGuidAsync(string sql, params object?[] parameters)
        {
            await using var select = scope.Command(sql, parameters);
            return await select.ExecuteScalarAsync(cancellationToken) as Guid?;
        }

        private async Task<DateTimeOffset?> EffectiveAtAsync(string table, Guid id)
        {
            await using var select = scope.Command($"select effective_at from macro_data.{table} where user_id = $1 and id = $2", userId, id);
            return await select.ExecuteScalarAsync(cancellationToken) is DateTime at ? new DateTimeOffset(at, TimeSpan.Zero) : null;
        }

        /// <summary>Devices that have not heard about a merge may still link to the old id (R4).</summary>
        private async Task<Guid?> CanonicalFoodIdAsync(Guid? id) => id is null
            ? null
            : await ScalarGuidAsync("select canonical_id from macro_data.saved_food_aliases where user_id = $1 and alias_id = $2", userId, id.Value) ?? id;

        /// <summary>The row a food or goal change belongs to: a known alias's target, or the natural key's owner, recorded as a new alias (R4).</summary>
        private async Task<Guid?> MergeTargetAsync(string aliasTable, Guid id, string naturalKeyQuery, params object?[] naturalKey)
        {
            var known = await ScalarGuidAsync($"select canonical_id from macro_data.{aliasTable} where user_id = $1 and alias_id = $2", userId, id);
            if (known is not null) return known;
            if (await EffectiveAtAsync(aliasTable == "saved_food_aliases" ? "saved_foods" : "protein_goals", id) is not null) return null;

            var canonical = await ScalarGuidAsync(naturalKeyQuery, [userId, .. naturalKey]);
            if (canonical is not null)
            {
                await ExecuteAsync($"insert into macro_data.{aliasTable} (user_id, alias_id, canonical_id) values ($1, $2, $3) on conflict do nothing",
                    userId, id, canonical);
            }
            return canonical;
        }

        private async Task<(string Status, Guid? CanonicalId)> UpsertFoodAsync(SavedFoodDto food)
        {
            var effective = Correct(food.UpdatedAt);
            var normalized = Normalize(food.Name);
            var canonical = await MergeTargetAsync("saved_food_aliases", food.Id,
                "select id from macro_data.saved_foods where user_id = $1 and normalized_name = $2 and ref_unit = $3 and deleted_at is null",
                normalized, food.ReferenceQuantity.Unit);
            var target = canonical ?? food.Id;
            var mergedOr = (string other) => canonical is null ? other : Merged;

            if (await EffectiveAtAsync("saved_foods", target) is { } storedAt)
            {
                if (storedAt >= effective)
                {
                    // The rest of the food lost, but its last use still counts (R4), and the winner goes out again (R2).
                    await ExecuteAsync("""
                        update macro_data.saved_foods set last_used_at = greatest(last_used_at, $3), revision = $4
                        where user_id = $1 and id = $2
                        """, userId, target, food.LastUsedAt, NextRevision());
                    return (mergedOr(Superseded), canonical);
                }
                // A merged duplicate brings its macros, not its spelling: the canonical row keeps its name.
                await ExecuteAsync("""
                    update macro_data.saved_foods set effective_at = $3, schema_version = $4, revision = $5,
                        name = case when $6::boolean then name else $7 end, normalized_name = case when $6::boolean then normalized_name else $8 end,
                        ref_amount = $9, ref_unit = $10, kcal = $11, protein_g = $12, carbs_g = $13, fat_g = $14, source = $15,
                        last_used_at = greatest(last_used_at, $16)
                    where user_id = $1 and id = $2
                    """, userId, target, effective, food.SchemaVersion, NextRevision(), canonical is not null, food.Name, normalized,
                    food.ReferenceQuantity.Amount, food.ReferenceQuantity.Unit, food.Macros.Kcal, food.Macros.ProteinG,
                    food.Macros.CarbsG, food.Macros.FatG, food.Source, food.LastUsedAt);
                return (mergedOr(Applied), canonical);
            }

            await ExecuteAsync("""
                insert into macro_data.saved_foods (user_id, id, created_at, effective_at, schema_version, revision, name, normalized_name,
                    ref_amount, ref_unit, kcal, protein_g, carbs_g, fat_g, source, last_used_at)
                values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                """, userId, food.Id, food.CreatedAt, effective, food.SchemaVersion, NextRevision(), food.Name, normalized,
                food.ReferenceQuantity.Amount, food.ReferenceQuantity.Unit, food.Macros.Kcal, food.Macros.ProteinG, food.Macros.CarbsG,
                food.Macros.FatG, food.Source, food.LastUsedAt);
            return (Applied, null);
        }

        /// <summary>Done here rather than in SQL: C# and the device's trim() agree on Unicode whitespace (vectors/normalize.json).</summary>
        private static string Normalize(string name) => name.Trim().ToLowerInvariant();

        private async Task<(string Status, Guid? CanonicalId)> UpsertGoalAsync(ProteinGoalDto goal)
        {
            var effective = Correct(goal.UpdatedAt);
            var canonical = await MergeTargetAsync("protein_goal_aliases", goal.Id,
                "select id from macro_data.protein_goals where user_id = $1 and effective_from = $2", goal.EffectiveFrom);
            var target = canonical ?? goal.Id;
            var mergedOr = (string other) => canonical is null ? other : Merged;

            if (await EffectiveAtAsync("protein_goals", target) is { } storedAt)
            {
                if (storedAt >= effective)
                {
                    await BumpAsync("protein_goals", target);
                    return (mergedOr(Superseded), canonical);
                }
                await ExecuteAsync("""
                    update macro_data.protein_goals set effective_at = $3, schema_version = $4, revision = $5, grams = $6
                    where user_id = $1 and id = $2
                    """, userId, target, effective, goal.SchemaVersion, NextRevision(), goal.Grams);
                return (mergedOr(Applied), canonical);
            }

            await ExecuteAsync("""
                insert into macro_data.protein_goals (user_id, id, created_at, effective_at, schema_version, revision, effective_from, grams)
                values ($1, $2, $3, $4, $5, $6, $7, $8)
                """, userId, goal.Id, goal.CreatedAt, effective, goal.SchemaVersion, NextRevision(), goal.EffectiveFrom, goal.Grams);
            return (Applied, null);
        }
    }

    /// <summary>
    /// Everything after <paramref name="since"/>, oldest first. One repeatable-read snapshot covers all four tables, so a
    /// push committing partway through cannot leave a change behind the returned cursor.
    /// </summary>
    public async Task<PullResponse> PullAsync(Guid userId, long since, int limit, DateTimeOffset serverNow, CancellationToken cancellationToken)
    {
        await using var scope = await BeginUserTransactionAsync(userId, IsolationLevel.RepeatableRead, cancellationToken);

        await using (var state = scope.Command("select revision from macro_data.sync_state where user_id = $1", userId))
        {
            // The usual poll: nothing has changed, and one indexed read says so.
            if (await state.ExecuteScalarAsync(cancellationToken) is not long revision || revision <= since)
            {
                return new PullResponse([], since, false, serverNow);
            }
        }

        var rows = new List<(long Revision, object Change)>();

        async Task ReadAsync(string columns, string table, Func<NpgsqlDataReader, (long, object)> read)
        {
            await using var select = scope.Command(
                $"select {columns} from macro_data.{table} where user_id = $1 and revision > $2 order by revision limit $3",
                userId, since, limit + 1);
            await using var reader = await select.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken)) rows.Add(read(reader));
        }

        await ReadAsync("""
            revision, id, created_at, effective_at, schema_version, deleted_at, day_key, logged_at, name, quantity_amount, quantity_unit,
            kcal, protein_g, carbs_g, fat_g, source, saved_food_id, meal_category, version_id, restored_at
            """, "log_entries", r =>
        {
            var revision = r.GetInt64(0);
            return !r.IsDBNull(5)
                ? (revision, new PulledDeletion("entry", revision, r.GetGuid(1)))
                : (revision, new PulledRecord("entry", revision, new PulledEntry(r.GetGuid(1), r.GetGuid(18), r.GetFieldValue<DateTimeOffset>(2),
                    r.GetFieldValue<DateTimeOffset>(3), r.GetInt32(4), r.GetFieldValue<DateOnly>(6), r.GetFieldValue<DateTimeOffset>(7), r.GetString(8),
                    new QuantityDto(r.GetDouble(9), r.GetString(10)), new MacrosDto(r.GetDouble(11), r.GetDouble(12), r.GetDouble(13), r.GetDouble(14)),
                    r.GetString(15), r.IsDBNull(16) ? null : r.GetGuid(16), r.IsDBNull(17) ? null : r.GetString(17),
                    r.IsDBNull(19) ? null : r.GetFieldValue<DateTimeOffset>(19))));
        });

        await ReadAsync("""
            revision, id, entry_id, change_type, replaced_at, created_at, effective_at, schema_version, day_key, logged_at, name,
            quantity_amount, quantity_unit, kcal, protein_g, carbs_g, fat_g, source, saved_food_id, meal_category, restored_at
            """, "entry_versions", r =>
        {
            var revision = r.GetInt64(0);
            return (revision, new PulledRecord("version", revision, new PulledVersion(r.GetGuid(1), r.GetGuid(2), r.GetString(3),
                r.GetFieldValue<DateTimeOffset>(4), r.GetFieldValue<DateTimeOffset>(5), r.GetFieldValue<DateTimeOffset>(6), r.GetInt32(7),
                r.GetFieldValue<DateOnly>(8), r.GetFieldValue<DateTimeOffset>(9), r.GetString(10), new QuantityDto(r.GetDouble(11), r.GetString(12)),
                new MacrosDto(r.GetDouble(13), r.GetDouble(14), r.GetDouble(15), r.GetDouble(16)), r.GetString(17),
                r.IsDBNull(18) ? null : r.GetGuid(18), r.IsDBNull(19) ? null : r.GetString(19),
                r.IsDBNull(20) ? null : r.GetFieldValue<DateTimeOffset>(20))));
        });

        await ReadAsync("""
            revision, id, created_at, effective_at, schema_version, name, ref_amount, ref_unit, kcal, protein_g, carbs_g, fat_g, source, last_used_at
            """, "saved_foods", r =>
        {
            var revision = r.GetInt64(0);
            return (revision, new PulledRecord("food", revision, new SavedFoodDto(r.GetGuid(1), r.GetFieldValue<DateTimeOffset>(2),
                r.GetFieldValue<DateTimeOffset>(3), r.GetInt32(4), r.GetString(5), new QuantityDto(r.GetDouble(6), r.GetString(7)),
                new MacrosDto(r.GetDouble(8), r.GetDouble(9), r.GetDouble(10), r.GetDouble(11)), r.GetString(12), r.GetFieldValue<DateTimeOffset>(13))));
        });

        await ReadAsync("revision, id, created_at, effective_at, schema_version, effective_from, grams", "protein_goals", r =>
        {
            var revision = r.GetInt64(0);
            return (revision, new PulledRecord("goal", revision, new ProteinGoalDto(r.GetGuid(1), r.GetFieldValue<DateTimeOffset>(2),
                r.GetFieldValue<DateTimeOffset>(3), r.GetInt32(4), r.GetFieldValue<DateOnly>(5), r.IsDBNull(6) ? null : r.GetDouble(6))));
        });

        var page = rows.OrderBy(r => r.Revision).Take(limit).ToList();
        var cursor = page.Count > 0 ? page[^1].Revision : since;
        return new PullResponse([.. page.Select(r => r.Change)], cursor, rows.Count > limit, serverNow);
    }
}
