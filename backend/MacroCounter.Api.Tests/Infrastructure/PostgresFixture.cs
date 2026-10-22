using System.Security.Cryptography;
using MacroCounter.Api.Data;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace MacroCounter.Api.Tests.Infrastructure;

[CollectionDefinition("Postgres")]
public sealed class PostgresCollection : ICollectionFixture<PostgresFixture>;

/// <summary>
/// A throwaway database on the local PostgreSQL server (research R14). It applies every migration as
/// the admin, then creates a per-run least-privilege app role so tests exercise the real grants and
/// RLS policies. The live Supabase project is never contacted.
/// </summary>
public sealed class PostgresFixture : IAsyncLifetime
{
    public const string EnvironmentVariable = "MACROCOUNTER_TEST_PG";

    private string _serverAdmin = "";
    private readonly string _database = $"macro_test_{Guid.NewGuid():N}";

    /// <summary>Superuser connection to the test database (plays the owner in the SQL editor).</summary>
    public string AdminConnectionString { get; private set; } = "";

    /// <summary>Connection as the least-privilege app role, like the deployed backend.</summary>
    public string AppConnectionString { get; private set; } = "";

    public string AppRole { get; } = $"macro_app_{Guid.NewGuid():N}"[..22];

    public async Task InitializeAsync()
    {
        _serverAdmin = ReadAdminConnectionString();
        var appPassword = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));

        await using (var server = await Open(_serverAdmin))
        {
            await Execute(server, $"""create database "{_database}" """);
            await Execute(server, $"""create role "{AppRole}" login password '{appPassword}' """);
        }

        AdminConnectionString = new NpgsqlConnectionStringBuilder(_serverAdmin) { Database = _database }.ConnectionString;
        AppConnectionString = new NpgsqlConnectionStringBuilder(_serverAdmin)
        {
            Database = _database,
            Username = AppRole,
            Password = appPassword,
        }.ConnectionString;

        // Mirror Supabase: pgcrypto lives in its own "extensions" schema, outside the default search_path.
        await using (var admin = await Open(AdminConnectionString))
        {
            await Execute(admin, "create schema extensions; create extension pgcrypto schema extensions;");
        }

        var options = new DbContextOptionsBuilder<IdentityDbContext>();
        IdentityDbContext.UseMacroNpgsql(options, AdminConnectionString);
        await using (var context = new IdentityDbContext(options.Options))
        {
            await context.Database.MigrateAsync();
        }

        await using (var admin = await Open(AdminConnectionString))
        {
            await using var grant = new NpgsqlCommand("select macro_admin.grant_app_role(@role)", admin);
            grant.Parameters.AddWithValue("role", AppRole);
            await grant.ExecuteNonQueryAsync();
        }
    }

    /// <summary>Empties every table so each test starts clean.</summary>
    public async Task ResetAsync()
    {
        await using var admin = await Open(AdminConnectionString);
        await Execute(admin, """
            do $$
            declare t text;
            begin
              for t in select tablename from pg_tables where schemaname = 'macro' and tablename <> '__EFMigrationsHistory'
              loop
                execute format('truncate table macro.%I restart identity cascade', t);
              end loop;
            end $$;
            """);
    }

    public async Task DisposeAsync()
    {
        NpgsqlConnection.ClearAllPools();
        await using var server = await Open(_serverAdmin);
        await Execute(server, $"""drop database if exists "{_database}" with (force)""");
        await Execute(server, $"""drop role if exists "{AppRole}" """);
    }

    public static async Task<NpgsqlConnection> Open(string connectionString)
    {
        var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        return connection;
    }

    public static async Task Execute(NpgsqlConnection connection, string sql)
    {
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    private static string ReadAdminConnectionString()
    {
        var value = Environment.GetEnvironmentVariable(EnvironmentVariable);
        // setx only reaches processes started afterwards; also read the user scope on Windows.
        if (string.IsNullOrWhiteSpace(value) && OperatingSystem.IsWindows())
        {
            value = Environment.GetEnvironmentVariable(EnvironmentVariable, EnvironmentVariableTarget.User);
        }
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new InvalidOperationException(
                $"{EnvironmentVariable} is not set. Point it at a local PostgreSQL superuser, e.g. " +
                "\"Host=localhost;Username=postgres;Password=…\" (see specs/003-auth-security-foundations/quickstart.md).");
        }
        return new NpgsqlConnectionStringBuilder(value) { Database = "postgres", Pooling = false }.ConnectionString;
    }
}
