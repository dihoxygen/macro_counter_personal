using System.Text;

namespace MacroCounter.Api.Tests.Infrastructure;

/// <summary>The test helper itself matches RFC 6238 Appendix B (SHA-1), truncated to 6 digits.</summary>
public class TotpTests
{
    private static readonly byte[] RfcSecret = Encoding.ASCII.GetBytes("12345678901234567890");

    [Theory]
    [InlineData(59, "287082")]
    [InlineData(1111111109, "081804")]
    [InlineData(1111111111, "050471")]
    [InlineData(1234567890, "005924")]
    [InlineData(2000000000, "279037")]
    public void Matches_the_rfc_reference_values(long unixSeconds, string expected)
    {
        Assert.Equal(expected, Totp.Compute(RfcSecret, DateTimeOffset.FromUnixTimeSeconds(unixSeconds)));
    }

    [Fact]
    public void Decodes_base32_with_spaces_and_lowercase()
    {
        Assert.Equal(RfcSecret, Totp.Base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq"));
    }
}
