using MacroCounter.Api.Tests.Infrastructure;

namespace MacroCounter.Api.Tests.Database;

/// <summary>
/// 004 data-model.md: the pending-sign-in session kind, the remembered-device table and its grants, the new audit
/// codes, and the owner procedures that end remembering.
/// </summary>
[Collection("Postgres")]
public class TwoStepSignInMigrationTests(PostgresFixture db) : IAsyncLifetime
{
    private const string CheckViolation = "23514";
    private const string InsufficientPrivilege = "42501";

    private Guid _alice;

    public async Task InitializeAsync()
    {
        await db.ResetAsync();
        _alice = await Sql.InsertUser(db.AdminConnectionString, "alice");
    }

    public Task DisposeAsync() => Task.CompletedTask;

    private Task InsertDevice(string connectionString, byte hash, string expiresIn = "7 days") =>
        Sql.Execute(connectionString, $"""
            insert into macro.trusted_devices (token_hash, user_id, security_stamp, created_at, expires_at)
            values (decode(lpad(to_hex({hash}), 2, '0'), 'hex'), @a, 'stamp', now(), now() + interval '{expiresIn}')
            """, ("a", _alice));

    private Task<long> Devices() =>
        Sql.Scalar<long>(db.AdminConnectionString, "select count(*) from macro.trusted_devices");

    [Fact]
    public async Task Sessions_accept_the_mfa_kind_and_still_reject_unknown_kinds()
    {
        const string insert = """
            insert into macro.sessions (key_hash, user_id, kind, security_stamp, ticket, created_at, last_seen_at, absolute_expires_at)
            values (@k, @a, @kind, 'stamp', '\x00', now(), now(), now() + interval '5 minutes')
            """;
        await Sql.Execute(db.AppConnectionString, insert, ("k", new byte[] { 1 }), ("a", _alice), ("kind", "mfa"));

        Assert.Equal(CheckViolation,
            await Sql.FailureCode(db.AppConnectionString, insert, ("k", new byte[] { 2 }), ("a", _alice), ("kind", "other")));
    }

    [Fact]
    public async Task Trusted_devices_has_the_documented_shape()
    {
        var columns = await Sql.Scalar<string>(db.AdminConnectionString, """
            select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position)
            from information_schema.columns where table_schema = 'macro' and table_name = 'trusted_devices'
            """);
        Assert.Equal(
            "token_hash:bytea:NO,user_id:uuid:NO,security_stamp:text:NO," +
            "created_at:timestamp with time zone:NO,expires_at:timestamp with time zone:NO",
            columns);

        Assert.Equal("token_hash", await Sql.Scalar<string>(db.AdminConnectionString, """
            select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
            where i.indrelid = 'macro.trusted_devices'::regclass and i.indisprimary
            """));
        Assert.Equal(1L, await Sql.Scalar<long>(db.AdminConnectionString, """
            select count(*) from pg_indexes where schemaname = 'macro' and tablename = 'trusted_devices'
              and indexdef like '%(user_id)%'
            """));
        Assert.Equal("c", await Sql.Scalar<string>(db.AdminConnectionString, """
            select confdeltype::text from pg_constraint
            where conrelid = 'macro.trusted_devices'::regclass and contype = 'f'
            """));
        Assert.True(await Sql.Scalar<bool>(db.AdminConnectionString,
            "select relrowsecurity from pg_class where oid = 'macro.trusted_devices'::regclass"));
    }

    [Fact]
    public async Task The_app_role_can_insert_read_and_delete_devices_but_never_update_them()
    {
        await InsertDevice(db.AppConnectionString, 1);
        Assert.Equal(1L, await Sql.Scalar<long>(db.AppConnectionString, "select count(*) from macro.trusted_devices"));

        // No update grant: a compromised app process cannot extend a device's expiry (threat T8).
        Assert.Equal(InsufficientPrivilege, await Sql.FailureCode(db.AppConnectionString,
            "update macro.trusted_devices set expires_at = now() + interval '1 year'"));

        await Sql.Execute(db.AppConnectionString, "delete from macro.trusted_devices");
        Assert.Equal(0L, await Devices());
    }

    [Fact]
    public async Task Deleting_a_user_deletes_their_devices()
    {
        await InsertDevice(db.AdminConnectionString, 1);
        await Sql.Execute(db.AdminConnectionString, "delete from macro.users where id = @a", ("a", _alice));
        Assert.Equal(0L, await Devices());
    }

    [Theory]
    [InlineData("password_accepted", null)]
    [InlineData("device_remembered", null)]
    [InlineData("device_forgotten", null)]
    [InlineData("sign_in", "remembered_device")]
    [InlineData("setup_started", "invite_code")]
    public async Task The_audit_table_accepts_the_new_codes(string eventType, string? reason)
    {
        await Sql.Execute(db.AppConnectionString, """
            insert into macro.audit_events (event_type, outcome, user_id, actor, reason) values (@e, 'success', @a, 'user', @r)
            """, ("e", eventType), ("a", _alice), ("r", reason));
        Assert.Equal(1L, await Sql.Scalar<long>(db.AdminConnectionString, "select count(*) from macro.audit_events"));
    }

    [Theory]
    [InlineData("reset_user")]
    [InlineData("disable_user")]
    [InlineData("revoke_sessions")]
    public async Task Owner_procedures_that_end_access_also_forget_every_device(string procedure)
    {
        await InsertDevice(db.AdminConnectionString, 1);
        await InsertDevice(db.AdminConnectionString, 2);

        await Sql.Execute(db.AdminConnectionString, $"select macro_admin.{procedure}('alice')");

        Assert.Equal(0L, await Devices());
    }

    [Fact]
    public async Task Purge_removes_expired_devices_and_keeps_current_ones()
    {
        await InsertDevice(db.AdminConnectionString, 1, expiresIn: "-1 second");
        await InsertDevice(db.AdminConnectionString, 2);

        Assert.Equal(1, await Sql.Scalar<int>(db.AdminConnectionString, "select macro_admin.purge_expired()"));

        Assert.Equal(1L, await Devices());
    }
}
