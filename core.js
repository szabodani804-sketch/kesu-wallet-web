/* Kesu Wallet – kriptográfiai mag (Ed25519, base58, titkosítás, Solana-tranzakciók)
   Külső könyvtár nélkül: BigInt + WebCrypto. A titkos kulcs csak titkosítva kerül tárolásra. */
"use strict";
const KesuCore = (() => {
  const uerr = m => Object.assign(new Error(m), { user: true });   // a felhasználónak szóló hiba
  // ---------------- bájtsegédek ----------------
  const enc = s => new TextEncoder().encode(s);
  const concat = (...arrs) => { const n = arrs.reduce((a, b) => a + b.length, 0), out = new Uint8Array(n); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };
  const b64e = b => { let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); };
  const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const rand = n => crypto.getRandomValues(new Uint8Array(n));
  const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  // ---------------- base58 ----------------
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function b58encode(b) {
    let n = 0n; for (const x of b) n = n * 256n + BigInt(x);
    let s = ""; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
    let z = 0; while (z < b.length && b[z] === 0) z++;
    return "1".repeat(z) + s;
  }
  function b58decode(s) {
    let n = 0n; for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error("b58"); n = n * 58n + BigInt(i); }
    const out = []; while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
    let z = 0; while (z < s.length && s[z] === "1") z++;
    return new Uint8Array([...new Array(z).fill(0), ...out]);
  }

  // ---------------- Ed25519 (RFC 8032) ----------------
  const P = (1n << 255n) - 19n, N = (1n << 252n) + 27742317777372353535851937790883648493n;
  const mod = (a, m = P) => { const r = a % m; return r >= 0n ? r : r + m; };
  const pow = (b, e, m = P) => { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; };
  const inv = a => pow(a, P - 2n);
  const D = mod(-121665n * inv(121666n));
  const D2 = mod(2n * D);
  const GX = 15112221349535400772501151409588531511454012693041857206046113283949847762202n;
  const GY = 46316835694926478169428394003475163141307993866256225615783033603165251855960n;
  const G = [GX, GY, 1n, mod(GX * GY)];
  function add(p, q) {
    const [X1, Y1, Z1, T1] = p, [X2, Y2, Z2, T2] = q;
    const A = mod((Y1 - X1) * (Y2 - X2)), B = mod((Y1 + X1) * (Y2 + X2));
    const C = mod(T1 * D2 * T2), DD = mod(2n * Z1 * Z2);
    const E = B - A, F = DD - C, Gg = DD + C, H = B + A;
    return [mod(E * F), mod(Gg * H), mod(F * Gg), mod(E * H)];
  }
  function mul(s, p) { let q = [0n, 1n, 1n, 0n]; while (s > 0n) { if (s & 1n) q = add(q, p); p = add(p, p); s >>= 1n; } return q; }
  const le32 = n => { const b = new Uint8Array(32); for (let i = 0; i < 32; i++) { b[i] = Number(n & 255n); n >>= 8n; } return b; };
  const fromLE = b => { let n = 0n; for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) + BigInt(b[i]); return n; };
  function encodePoint(p) { const [X, Y, Z] = p, zi = inv(Z), x = mod(X * zi), y = mod(Y * zi); const b = le32(y); if (x & 1n) b[31] |= 0x80; return b; }
  const sha512 = async b => new Uint8Array(await crypto.subtle.digest("SHA-512", b));
  const keyCache = new Map();
  async function expand(seed) {
    const id = b64e(seed); if (keyCache.has(id)) return keyCache.get(id);
    const h = await sha512(seed), a32 = h.slice(0, 32);
    a32[0] &= 248; a32[31] &= 127; a32[31] |= 64;
    const a = fromLE(a32), k = { a, prefix: h.slice(32), pub: encodePoint(mul(a, G)) };
    keyCache.clear(); keyCache.set(id, k); return k;
  }
  async function pubFromSeed(seed) { return (await expand(seed)).pub; }
  async function sign(msg, seed) {
    const k = await expand(seed);
    const r = mod(fromLE(await sha512(concat(k.prefix, msg))), N);
    const R = encodePoint(mul(r, G));
    const h = mod(fromLE(await sha512(concat(R, k.pub, msg))), N);
    return concat(R, le32(mod(r + h * k.a, N)));
  }

  // ---------------- kulcsformátumok ----------------
  async function secretToExport(seed) { return b58encode(concat(seed, await pubFromSeed(seed))); }
  async function parseImport(text, L) {
    text = (text || "").trim(); let raw;
    try { raw = text.startsWith("[") ? new Uint8Array(JSON.parse(text)) : b58decode(text); }
    catch (e) { throw uerr(L("This doesn't look like a secret key.", "Ezt nem tudom titkos kulcsként értelmezni.")); }
    if (raw.length !== 64) throw uerr(L("The secret key has the wrong length (64 bytes needed).", "A titkos kulcs hossza nem megfelelő (64 bájt kell)."));
    const seed = raw.slice(0, 32);
    if (!eq(await pubFromSeed(seed), raw.slice(32))) throw uerr(L("The secret key is damaged (the public part doesn't match).", "A titkos kulcs sérült (a nyilvános rész nem egyezik)."));
    return seed;
  }

  // ---------------- jelszavas titkosítás (PBKDF2-SHA256 + AES-GCM) ----------------
  const ITER = 310000, AAD = enc("kesu-wallet-mobile-v1");
  async function kdf(pw, salt, iter) {
    const base = await crypto.subtle.importKey("raw", enc(pw), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function encryptSeed(seed, pw) {
    const salt = rand(16), iv = rand(12), key = await kdf(pw, salt, ITER);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, key, seed));
    return { v: 1, pubkey: b58encode(await pubFromSeed(seed)), iter: ITER, salt: b64e(salt), iv: b64e(iv), ct: b64e(ct) };
  }
  async function decryptSeed(rec, pw, L) {
    const key = await kdf(pw, b64d(rec.salt), rec.iter);
    let seed;
    try { seed = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(rec.iv), additionalData: AAD }, key, b64d(rec.ct))); }
    catch (e) { throw uerr(L("Wrong password.", "Hibás jelszó.")); }
    if (b58encode(await pubFromSeed(seed)) !== rec.pubkey) throw uerr(L("The wallet file is damaged.", "A tárcafájl sérült."));
    return seed;
  }

  // ---------------- Solana tranzakciók ----------------
  function cu16(buf, off) { let v = 0, sh = 0; for (let i = 0; i < 3; i++) { const b = buf[off++]; v |= (b & 0x7f) << sh; if (!(b & 0x80)) return [v, off]; sh += 7; } throw new Error("cu16"); }
  function cu16enc(n) { const out = []; for (;;) { const b = n & 0x7f; n >>= 7; if (n) out.push(b | 0x80); else { out.push(b); return new Uint8Array(out); } } }
  async function signTransaction(txB64, seed, L) {
    const raw = b64d(txB64);
    const [nSigs, sigStart] = cu16(raw, 0);
    const msg = raw.slice(sigStart + 64 * nSigs);
    const m = msg[0] & 0x80 ? 1 : 0;
    if (m && (msg[0] & 0x7f) !== 0) throw uerr(L("Unknown transaction version.", "Ismeretlen tranzakció-verzió."));
    const numReq = msg[m];
    const [nKeys, koff] = cu16(msg, m + 3);
    const me = await pubFromSeed(seed);
    let idx = -1;
    for (let i = 0; i < Math.min(numReq, nKeys); i++) if (eq(msg.slice(koff + 32 * i, koff + 32 * (i + 1)), me)) { idx = i; break; }
    if (idx < 0) throw uerr(L("This transaction isn't meant to be signed by this wallet. Cancelled.", "A tranzakciót nem ennek a tárcának kell aláírnia. Megszakítva."));
    if (nSigs !== numReq) throw uerr(L("Invalid transaction (signature count).", "Hibás tranzakció (aláírások száma)."));
    const sig = await sign(msg, seed), out = raw.slice();
    out.set(sig, sigStart + 64 * idx);
    return b64e(out);
  }
  async function buildSolTransfer(seed, to, lamports, blockhash) {
    const me = await pubFromSeed(seed), sys = new Uint8Array(32);
    const data = new Uint8Array(12); const dv = new DataView(data.buffer);
    dv.setUint32(0, 2, true); dv.setBigUint64(4, BigInt(lamports), true);
    const ix = concat(new Uint8Array([2]), cu16enc(2), new Uint8Array([0, 1]), cu16enc(data.length), data);
    const bh = b58decode(blockhash); if (bh.length !== 32) throw new Error("blockhash");
    const msg = concat(new Uint8Array([1, 0, 1]), cu16enc(3), me, to, sys, bh, cu16enc(1), ix);
    return b64e(concat(cu16enc(1), await sign(msg, seed), msg));
  }

  return { enc, concat, b64e, b64d, rand, eq, b58encode, b58decode, pubFromSeed, sign, secretToExport, parseImport,
           encryptSeed, decryptSeed, signTransaction, buildSolTransfer, cu16, cu16enc };
})();
if (typeof module !== "undefined") module.exports = KesuCore;
