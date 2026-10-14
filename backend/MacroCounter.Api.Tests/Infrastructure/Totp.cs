using System.Buffers.Binary;
using System.Security.Cryptography;

namespace MacroCounter.Api.Tests.Infrastructure;

/// <summary>RFC 6238 (SHA-1, 30 s, 6 digits) for tests: what a person's authenticator app would show.</summary>
public static class Totp
{
    public static string Compute(string base32Secret, DateTimeOffset at) => Compute(Base32Decode(base32Secret), at);

    public static string Compute(byte[] secret, DateTimeOffset at)
    {
        var counter = new byte[8];
        BinaryPrimitives.WriteInt64BigEndian(counter, at.ToUnixTimeSeconds() / 30);
        var hash = HMACSHA1.HashData(secret, counter);
        var offset = hash[^1] & 0x0F;
        var binary = BinaryPrimitives.ReadInt32BigEndian(hash.AsSpan(offset)) & 0x7FFFFFFF;
        return (binary % 1_000_000).ToString("D6");
    }

    public static byte[] Base32Decode(string input)
    {
        const string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        var clean = input.Replace(" ", "").Replace("-", "").TrimEnd('=').ToUpperInvariant();
        var output = new List<byte>(clean.Length * 5 / 8);
        int buffer = 0, bits = 0;
        foreach (var c in clean)
        {
            var value = alphabet.IndexOf(c);
            if (value < 0) throw new FormatException($"Not base32: '{c}'.");
            buffer = (buffer << 5) | value;
            bits += 5;
            if (bits >= 8)
            {
                output.Add((byte)(buffer >> (bits - 8)));
                bits -= 8;
            }
        }
        return [.. output];
    }
}
