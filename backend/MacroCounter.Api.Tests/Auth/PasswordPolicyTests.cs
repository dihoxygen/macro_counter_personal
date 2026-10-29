using MacroCounter.Api.Auth;
using MacroCounter.Api.Security;
using Microsoft.Extensions.Options;

namespace MacroCounter.Api.Tests.Auth;

/// <summary>NIST SP 800-63B style policy: 12–128 characters, no composition rules (research R2).</summary>
public class PasswordPolicyTests
{
    private static readonly PasswordPolicy Policy = new(Options.Create(new SecurityOptions()));

    [Fact]
    public void Eleven_characters_is_too_short()
    {
        Assert.Equal(["too_short"], Policy.Check("abcdefghijk", "alice"));
    }

    [Fact]
    public void Twelve_characters_is_accepted()
    {
        Assert.Empty(Policy.Check("abcdefghijkl", "alice"));
    }

    [Fact]
    public void Over_128_characters_is_too_long()
    {
        Assert.Empty(Policy.Check(new string('x', 128), "alice"));
        Assert.Equal(["too_long"], Policy.Check(new string('x', 129), "alice"));
    }

    [Theory]
    [InlineData("my-alice-password")]
    [InlineData("MY-ALICE-PASSWORD")]
    [InlineData("xxAlIcExxxxxxx")]
    public void Containing_the_username_in_any_case_is_rejected(string password)
    {
        Assert.Equal(["contains_username"], Policy.Check(password, "alice"));
    }

    [Fact]
    public void Has_no_composition_rules()
    {
        Assert.Empty(Policy.Check("aaaaaaaaaaaa", "alice"));
        Assert.Empty(Policy.Check("correct horse battery staple", "alice"));
    }

    [Fact]
    public void Length_is_measured_after_nfkc_normalization()
    {
        // Twelve full-width letters normalize to twelve ASCII letters; the ligature "ﬁ" becomes two letters.
        Assert.Equal("ABCDEFGHIJKL", PasswordPolicy.Normalize("ＡＢＣＤＥＦＧＨＩＪＫＬ"));
        Assert.Empty(Policy.Check("ＡＢＣＤＥＦＧＨＩＪＫＬ", "alice"));
        Assert.Empty(Policy.Check("ﬁﬁﬁﬁﬁﬁ", "alice"));
    }

    [Fact]
    public void Counts_characters_not_utf16_units()
    {
        // Eleven emoji are 22 UTF-16 code units but still only eleven characters.
        Assert.Equal(["too_short"], Policy.Check(string.Concat(Enumerable.Repeat("🍌", 11)), "alice"));
    }

    [Fact]
    public void Reports_every_reason_together()
    {
        Assert.Equal(["too_short", "contains_username"], Policy.Check("alice1", "alice"));
    }
}
