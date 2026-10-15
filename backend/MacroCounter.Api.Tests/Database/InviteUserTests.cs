using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using MacroCounter.Api.Tests.Infrastructure;
using Npgsql;

namespace MacroCounter.Api.Tests.Database;

/// <summary>macro_admin.invite_user: the only way an account comes into existence (contracts/owner-procedures.md).</summary>
[Collection("Postgres")]
public partial class InviteUserTests(PostgresFixture db) : IAsyncLifetime
{
    public Task InitializeAsync() => db.ResetAsync();

    public Task DisposeAsync() => Task.CompletedTask;

    private Task<string> Invite(string username, string? role = null) => role is null
        ? Sql.Scalar<string>(db.AdminConnectionString, "select macro_admin.invite_user(@u)", ("u", username))
        : Sql.Scalar<string>(db.AdminConnectionString, "select macro_admin.invite_user(@u, @r)", ("u", username), ("r", role));

    [GeneratedRegex("^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$")]
    private static partial Regex CodeFormat();

    [Fact]
    public async Task Returns_a_formatted_one_time_code()
    {
        var code = await Invite("alice");
        Assert.Matches(CodeFormat(), code);
        Assert.DoesNotContain('I', code);
        Assert.DoesNotContain('O', code);
    }

    [Fact]
    public async Task Codes_differ_between_invites()
    {
        var first = await Invite("alice");
        var second = await Invite("bob");
        Assert.NotEqual(first, second);
    }

    [Fact]
    public async Task Stores_only_the_sha256_of_the_normalized_code()
    {
        var code = await Invite("alice");

        var stored = await Sql.Scalar<byte[]>(db.AdminConnectionString, "select temp_code_hash from macro.users where username = 'alice'");
        var expected = SHA256.HashData(Encoding.UTF8.GetBytes(code.Replace("-", "")));
        Assert.Equal(expected, stored);

        var row = await Sql.Scalar<string>(db.AdminConnectionString, "select row_to_json(u)::text from macro.users u where username = 'alice'");
        Assert.DoesNotContain(code, row);
        Assert.DoesNotContain(code.Replace("-", ""), row);
    }

    [Fact]
    public async Task Trims_and_lowercases_the_username_and_sets_up_the_account()
    {
        await Invite("  Alice ");

        await using var connection = await PostgresFixture.Open(db.AdminConnectionString);
        await using var command = new NpgsqlCommand("""
            select username, normalized_username, role, lockout_enabled, two_factor_enabled, access_failed_count,
                   password_hash is null, setup_expires_at = created_at + interval '72 hours',
                   length(security_stamp) >= 16, length(concurrency_stamp) >= 16
            from macro.users
            """, connection);
        await using var reader = await command.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        Assert.Equal("alice", reader.GetString(0));
        Assert.Equal("ALICE", reader.GetString(1));
        Assert.Equal("user", reader.GetString(2));
        Assert.True(reader.GetBoolean(3));
        Assert.False(reader.GetBoolean(4));
        Assert.Equal(0, reader.GetInt32(5));
        Assert.True(reader.GetBoolean(6));
        Assert.True(reader.GetBoolean(7));
        Assert.True(reader.GetBoolean(8));
        Assert.True(reader.GetBoolean(9));
    }

    [Fact]
    public async Task Can_invite_the_owner()
    {
        await Invite("sam", "owner");
        Assert.Equal("owner", await Sql.Scalar<string>(db.AdminConnectionString, "select role from macro.users"));
    }

    [Theory]
    [InlineData("ab")]
    [InlineData("al ice")]
    [InlineData("alice@example.com")]
    [InlineData("")]
    public async Task Rejects_invalid_usernames(string username)
    {
        var error = await Assert.ThrowsAsync<PostgresException>(() => Invite(username));
        Assert.Contains("invalid username", error.MessageText);
    }

    [Fact]
    public async Task Rejects_a_duplicate_username()
    {
        await Invite("alice");
        var error = await Assert.ThrowsAsync<PostgresException>(() => Invite("ALICE"));
        Assert.Equal("user already exists: alice", error.MessageText);
    }

    [Fact]
    public async Task Rejects_a_second_owner()
    {
        await Invite("sam", "owner");
        var error = await Assert.ThrowsAsync<PostgresException>(() => Invite("kim", "owner"));
        Assert.Equal("an owner already exists", error.MessageText);
    }

    [Fact]
    public async Task Rejects_an_unknown_role()
    {
        var error = await Assert.ThrowsAsync<PostgresException>(() => Invite("alice", "admin"));
        Assert.Equal("invalid role: admin", error.MessageText);
    }

    [Fact]
    public async Task Writes_exactly_one_owner_audit_row()
    {
        await Invite("alice");

        await using var connection = await PostgresFixture.Open(db.AdminConnectionString);
        await using var command = new NpgsqlCommand("""
            select a.event_type, a.outcome, a.actor, a.user_id = u.id
            from macro.audit_events a cross join macro.users u
            """, connection);
        await using var reader = await command.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        Assert.Equal(("account_invited", "success", "owner", true),
            (reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetBoolean(3)));
        Assert.False(await reader.ReadAsync());
    }

    [Fact]
    public async Task Works_with_pgcrypto_outside_the_callers_search_path()
    {
        // The fixture installs pgcrypto in "extensions" (as on Supabase). Force a search_path without it.
        await using var connection = await PostgresFixture.Open(db.AdminConnectionString);
        await PostgresFixture.Execute(connection, "set search_path = pg_catalog");
        await using var command = new NpgsqlCommand("select macro_admin.invite_user('alice')", connection);
        Assert.Matches(CodeFormat(), (string)(await command.ExecuteScalarAsync())!);
    }
}
