using Npgsql;

namespace MacroCounter.Api.Tests.Infrastructure;

/// <summary>Raw SQL helpers for database tests.</summary>
public static class Sql
{
    public static async Task Execute(string connectionString, string sql, params (string Name, object? Value)[] parameters)
    {
        await using var connection = await PostgresFixture.Open(connectionString);
        await using var command = Command(connection, sql, parameters);
        await command.ExecuteNonQueryAsync();
    }

    public static async Task<T> Scalar<T>(string connectionString, string sql, params (string Name, object? Value)[] parameters)
    {
        await using var connection = await PostgresFixture.Open(connectionString);
        await using var command = Command(connection, sql, parameters);
        var value = await command.ExecuteScalarAsync();
        return (T)value!;
    }

    /// <summary>Runs the SQL and returns the PostgreSQL error code it failed with.</summary>
    public static async Task<string> FailureCode(string connectionString, string sql, params (string Name, object? Value)[] parameters)
    {
        var error = await Assert.ThrowsAsync<PostgresException>(() => Execute(connectionString, sql, parameters));
        return error.SqlState;
    }

    /// <summary>Inserts a minimal valid user as the admin and returns its id.</summary>
    public static async Task<Guid> InsertUser(string adminConnectionString, string username, string role = "user")
    {
        var id = Guid.NewGuid();
        await Execute(adminConnectionString, """
            insert into macro.users (id, username, normalized_username, role, security_stamp, concurrency_stamp,
                                     lockout_enabled, two_factor_enabled, access_failed_count)
            values (@id, @username, upper(@username), @role, 'stamp', 'concurrency', true, false, 0)
            """, ("id", id), ("username", username), ("role", role));
        return id;
    }

    private static NpgsqlCommand Command(NpgsqlConnection connection, string sql, (string Name, object? Value)[] parameters)
    {
        var command = new NpgsqlCommand(sql, connection);
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value ?? DBNull.Value);
        }
        return command;
    }
}
