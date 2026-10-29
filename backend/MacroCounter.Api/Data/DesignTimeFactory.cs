using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace MacroCounter.Api.Data;

/// <summary>
/// Lets `dotnet ef` build the model without starting the app or touching a real database. Migrations
/// are applied by the owner as an idempotent script, never by the app (research R12).
/// </summary>
public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<IdentityDbContext>
{
    public IdentityDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<IdentityDbContext>();
        IdentityDbContext.UseMacroNpgsql(options, "Host=localhost;Database=design_time_only");
        return new IdentityDbContext(options.Options);
    }
}
