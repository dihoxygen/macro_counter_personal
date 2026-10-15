using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using MacroCounter.Api.Tests.Endpoints;
using MacroCounter.Api.Tests.Infrastructure;

namespace MacroCounter.Api.Tests.Audit;

/// <summary>
/// One run through everything security-relevant (FR-024): invites, failed and successful sign-ins, the whole
/// setup with its rejections, lockouts and rate limits, AI quotas, sign-outs and every owner procedure.
/// Records every secret and every piece of food text it used, so tests can prove none was stored or logged.
/// </summary>
public sealed class AuditScenario(PostgresFixture db, ApiFactory factory)
{
    public const string FoodDescription = "2 scrambled eggs with smoked salmon";
    public const string PhotoNote = "grilled, no sauce, side of kimchi";
    public const string TypedUnknownName = "Pa55word!not-a-user";

    private static readonly byte[] Photo = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x42, 0x13, 0x37];

    /// <summary>Everything that must never appear in the audit table or the logs.</summary>
    public List<string> Secrets { get; } = [FoodDescription, PhotoNote, TypedUnknownName, Convert.ToBase64String(Photo)];

    /// <summary>The limits the scenario needs, set on the factory before it starts.</summary>
    public static void Configure(ApiFactory factory)
    {
        factory.Settings["Limits:Ai:PerUserDaily"] = "2";
        factory.Settings["Limits:Ai:GlobalDaily"] = "3";
        // Lockout (layer 3) must be reached before the name throttle (layer 2) so sign_in_locked happens.
        factory.Settings["Security:SignIn:PerUsernameFailures"] = "100";
        // Room for the scenario's own sign-ins and setup steps; the probe address then exceeds it on purpose.
        factory.Settings["Security:SignIn:PerIpLimit"] = "60";
    }

    public async Task RunAsync()
    {
        // Invite, and a wrong temporary code.
        var carolCode = await Remember(TestUsers.InviteAsync(db, "carol"));
        Secrets.Add(carolCode.Replace("-", ""));
        var carol = new AuthClient(factory);
        await carol.SessionAsync();
        await Expect(carol.PostAsync("/api/auth/sign-in", new { username = "carol", password = "AAAA-BBBB-CCCC-DDDD-EEEE" }),
            HttpStatusCode.Unauthorized);
        await Expect(carol.PostAsync("/api/auth/sign-in", new { username = TypedUnknownName, password = "unknown-person-pw" }),
            HttpStatusCode.Unauthorized);
        Secrets.Add("unknown-person-pw");

        // Setup: rejected passwords, a breached one, then a good one.
        await carol.SignInAsync("carol", carolCode);
        Remember(carol);
        await Expect(carol.PostAsync("/api/auth/setup/password", new { newPassword = "carol-short" }), HttpStatusCode.BadRequest);
        await Expect(carol.PostAsync("/api/auth/setup/password", new { newPassword = "password1234" }), HttpStatusCode.BadRequest);
        const string carolPassword = "a long and audited passphrase for her";
        Secrets.AddRange(["carol-short", "password1234", carolPassword]);
        await carol.PostForStateAsync("/api/auth/setup/password", new { newPassword = carolPassword });

        // Five wrong authenticator codes end the setup session.
        var setupKey = await StartTotp(carol);
        var right = Totp.Compute(setupKey, DateTimeOffset.UtcNow);
        var wrong = right == "000000" ? "111111" : "000000";
        Secrets.Add(wrong);
        for (var i = 0; i < 5; i++) await carol.PostAsync("/api/auth/setup/totp/confirm", new { code = wrong });

        // Resume with the chosen password, finish the authenticator and the notice.
        carol = new AuthClient(factory);
        await carol.SessionAsync();
        await carol.SignInAsync("carol", carolPassword);
        Assert.Equal(setupKey, await StartTotp(carol));
        Secrets.Add(right);
        await carol.PostForStateAsync("/api/auth/setup/totp/confirm", new { code = right });
        await carol.PostForStateAsync("/api/auth/setup/notice", new { acknowledged = true });
        Remember(carol);

        // AI: a text and a photo lookup, then carol's daily limit.
        await Expect(carol.PostAsync("/api/estimates/text", new { description = FoodDescription }), HttpStatusCode.OK);
        await Expect(PostPhoto(carol), HttpStatusCode.OK);
        await Expect(carol.PostAsync("/api/estimates/text", new { description = FoodDescription }), HttpStatusCode.TooManyRequests);

        // A normal sign-in for dave, who then reaches the overall daily ceiling.
        var daveUser = await TestUsers.ActivateDirectlyAsync(db, factory, "dave");
        Secrets.Add(daveUser.Password);
        var dave = new AuthClient(factory);
        await dave.SessionAsync();
        var daveCode = daveUser.Code();
        Secrets.Add(daveCode);
        await dave.SignInAsync("dave", daveUser.Password, daveCode);
        Remember(dave);
        await Expect(dave.PostAsync("/api/estimates/text", new { description = FoodDescription }), HttpStatusCode.OK);
        await Expect(dave.PostAsync("/api/estimates/text", new { description = FoodDescription }), HttpStatusCode.TooManyRequests);

        // Ten wrong passwords lock eve's account; the next attempt is refused as locked.
        var eveUser = await TestUsers.ActivateDirectlyAsync(db, factory, "eve");
        Secrets.Add(eveUser.Password);
        var eve = new AuthClient(factory);
        await eve.SessionAsync();
        for (var i = 0; i < 10; i++)
        {
            await Expect(eve.PostAsync("/api/auth/sign-in", new { username = "eve", password = $"eve-wrong-{i}" }), HttpStatusCode.Unauthorized);
            Secrets.Add($"eve-wrong-{i}");
        }
        await Expect(eve.PostAsync("/api/auth/sign-in", new { username = "eve", password = eveUser.Password, code = eveUser.Code() }),
            HttpStatusCode.TooManyRequests);

        // The per-IP limit, from an address of its own.
        for (var i = 0; i < 61; i++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/sign-in")
            {
                Content = JsonContent.Create(new { username = $"probe{i}", password = "probe-password" }),
            };
            request.Headers.Add("X-CSRF-Token", eve.Csrf);
            request.Headers.Add("X-Forwarded-For", "203.0.113.50");
            await eve.Http.SendAsync(request);
        }

        // Signing out, everywhere, and every owner procedure.
        await Expect(carol.PostAsync("/api/auth/sign-out"), HttpStatusCode.NoContent);
        await Expect(dave.PostAsync("/api/auth/sign-out-everywhere"), HttpStatusCode.NoContent);
        await Sql.Execute(db.AdminConnectionString, "select macro_admin.revoke_sessions('eve')");
        await Sql.Execute(db.AdminConnectionString, "select macro_admin.disable_user('carol')");
        await Sql.Execute(db.AdminConnectionString, "select macro_admin.enable_user('carol')");
        await Sql.Execute(db.AdminConnectionString, "select macro_admin.unlock_user('eve')");
        var resetCode = await Sql.Scalar<string>(db.AdminConnectionString, "select macro_admin.reset_user('dave')");
        Secrets.AddRange([resetCode, resetCode.Replace("-", "")]);
    }

    private async Task<string> Remember(Task<string> secret)
    {
        var value = await secret;
        Secrets.Add(value);
        return value;
    }

    /// <summary>The session cookie and CSRF token currently held by this client.</summary>
    private void Remember(AuthClient client)
    {
        Secrets.Add(client.SessionCookieHeader().Split('=', 2)[1]);
        if (client.Csrf is not null) Secrets.Add(client.Csrf);
    }

    private async Task<string> StartTotp(AuthClient client)
    {
        var enrollment = await AuthClient.Json(await client.PostAsync("/api/auth/setup/totp"));
        var key = enrollment.GetProperty("setupKey").GetString()!;
        Secrets.AddRange([key, key.Replace(" ", "")]);
        return key.Replace(" ", "");
    }

    private static Task<HttpResponseMessage> PostPhoto(AuthClient client)
    {
        var form = new MultipartFormDataContent();
        var photo = new ByteArrayContent(Photo);
        photo.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        form.Add(photo, "photo", "meal.jpg");
        form.Add(new StringContent(PhotoNote), "note");
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/estimates/photo") { Content = form };
        request.Headers.Add("X-CSRF-Token", client.Csrf);
        return client.Http.SendAsync(request);
    }

    private static async Task Expect(Task<HttpResponseMessage> call, HttpStatusCode status)
    {
        var response = await call;
        Assert.True(response.StatusCode == status,
            $"{response.RequestMessage?.RequestUri?.AbsolutePath}: expected {(int)status}, got {(int)response.StatusCode}: " +
            await response.Content.ReadAsStringAsync());
    }

    /// <summary>Every audit row as JSON text, the way an owner would export it.</summary>
    public static async Task<string> AuditDump(PostgresFixture db) =>
        await Sql.Scalar<string>(db.AdminConnectionString,
            "select coalesce(string_agg(row_to_json(a)::text, E'\\n' order by id), '') from macro.audit_events a");

    /// <summary>Audit rows as (event, outcome, has user, has time).</summary>
    public static async Task<List<(string Event, string Outcome, bool HasUser, bool HasTime)>> AuditRows(PostgresFixture db)
    {
        var json = await Sql.Scalar<string>(db.AdminConnectionString, """
            select coalesce(json_agg(json_build_object('e', event_type, 'o', outcome, 'u', user_id is not null,
                                                       't', occurred_at is not null))::text, '[]')
            from macro.audit_events
            """);
        return [.. JsonDocument.Parse(json).RootElement.EnumerateArray().Select(r =>
            (r.GetProperty("e").GetString()!, r.GetProperty("o").GetString()!, r.GetProperty("u").GetBoolean(), r.GetProperty("t").GetBoolean()))];
    }
}
