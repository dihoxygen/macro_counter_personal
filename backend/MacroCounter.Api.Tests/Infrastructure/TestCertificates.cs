using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace MacroCounter.Api.Tests.Infrastructure;

/// <summary>Throwaway values that let the app start in the Production environment inside tests.</summary>
public static class TestCertificates
{
    private static readonly Lazy<string> Pfx = new(() =>
    {
        using var rsa = RSA.Create(2048);
        var request = new CertificateRequest("CN=MacroCounter test", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        using var cert = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1));
        return Convert.ToBase64String(cert.Export(X509ContentType.Pfx, Password));
    });

    private const string Password = "test-only";

    public static IEnumerable<KeyValuePair<string, string?>> ProductionSettings() =>
    [
        new("DataProtection:CertificatePfxBase64", Pfx.Value),
        new("DataProtection:CertificatePassword", Password),
        new("AllowedHosts", "localhost"),
        new("Security:AllowedOrigins:0", "https://localhost"),
    ];
}
