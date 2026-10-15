import { createHmac } from 'node:crypto';

/** RFC 6238 (SHA-1, 30 s, 6 digits): what an authenticator app shows for a base32 setup key. */
export function totp(setupKey: string, at: Date = new Date()): string {
  const secret = base32Decode(setupKey);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at.getTime() / 1000 / 30)));
  const hash = createHmac('sha1', secret).update(counter).digest();
  const offset = hash[hash.length - 1]! & 0x0f;
  const binary = hash.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, '0');
}

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const c of clean) {
    const value = alphabet.indexOf(c);
    if (value < 0) throw new Error(`Not base32: ${c}`);
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
