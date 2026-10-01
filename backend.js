/* Kesu Wallet – telefonos háttér (a Python-verzió Api osztályának JavaScript megfelelője).
   Ugyanazok a függvénynevek és válaszformák, így a felület változatlanul működik vele. */
"use strict";
const KesuApi = (() => {
  const K = KesuCore;
  const SOL = "So11111111111111111111111111111111111111112";
  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
  const TOKEN_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
  const JUP = "https://api.jup.ag/swap/v2", GT = "https://api.geckoterminal.com/api/v2", DS = "https://api.dexscreener.com/latest/dex";
  const DEFAULT_RPC = "https://api.mainnet-beta.solana.com", MOONPAY_URL = "https://www.moonpay.com/buy/sol";
  const FEE_RESERVE = 0.01, QUOTE_VALID_S = 40, TX_FEE = 5000, RENT_MIN = 890880;
  const CBBTC = "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij", WBTC = "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh";  // Bitcoin Solanán
  const TRUSTED = new Set([CBBTC, WBTC]);
  const POPULAR = [SOL, USDC, USDT, CBBTC, WBTC, "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
    "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN",
    "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof"];
  const TL = "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/";
  const KNOWN = { [SOL]: { symbol: "SOL", name: "Solana", logo: TL + SOL + "/logo.png" },
    [USDC]: { symbol: "USDC", name: "USD Coin", logo: TL + USDC + "/logo.png", stable: true },
    [USDT]: { symbol: "USDT", name: "Tether USD", logo: TL + USDT + "/logo.svg", stable: true } };
  const ACCENTS = ["#8b6cff", "#5b8cff", "#22c55e", "#f59e0b", "#ec4899", "#14b8a6", "#ef4444"];
  const B58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, USER_RE = /^[a-z0-9_]{3,20}$/, INVITE_RE = /^@?([A-Za-z0-9_]{3,20})\s*[/:]\s*([1-9A-HJ-NP-Za-km-z]{32,44})$/;

  // ---------------- tárolás ----------------
  const load = (k, d) => { try { const v = localStorage.getItem("kesu_" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const save = (k, v) => localStorage.setItem("kesu_" + k, JSON.stringify(v));
  const prefs = () => { const p = load("profile", {}); return { lang: ["en", "hu"].includes(p.lang) ? p.lang : "en", accent: ACCENTS.includes(p.accent) ? p.accent : ACCENTS[0] }; };
  const L = (en, hu) => prefs().lang === "hu" ? hu : en;
  class WErr extends Error {}
  const fail = (en, hu) => { throw new WErr(L(en, hu)); };

  // ---------------- hálózat ----------------
  async function fetchJson(url, opts = {}, timeout = 12000) {
    const ctl = new AbortController(), id = setTimeout(() => ctl.abort(), timeout);
    try { const r = await fetch(url, { ...opts, signal: ctl.signal }); let js = null; try { js = await r.json(); } catch (e) {} return { ok: r.ok, status: r.status, js }; }
    finally { clearTimeout(id); }
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // GeckoTerminal: token-vödör (ingyen ~30 kérés/perc)
  const bucket = { tokens: 8, last: Date.now(), rate: 0.45 / 1000, chain: Promise.resolve() };
  function take() {
    const p = bucket.chain.then(async () => {
      const now = Date.now(); bucket.tokens = Math.min(8, bucket.tokens + (now - bucket.last) * bucket.rate); bucket.last = now;
      if (bucket.tokens < 1) { await sleep((1 - bucket.tokens) / bucket.rate); bucket.tokens = 1; bucket.last = Date.now(); }
      bucket.tokens -= 1;
    });
    bucket.chain = p.catch(() => {}); return p;
  }
  async function gtGet(path, params) {
    const url = GT + path + "?" + new URLSearchParams(params);
    for (let a = 0; a < 2; a++) {
      await take();
      let r; try { r = await fetchJson(url, { headers: { Accept: "application/json" } }, 10000); } catch (e) { await sleep(500); continue; }
      if (r.status === 429) { bucket.tokens = 0; await sleep(2500 * (a + 1)); continue; }
      return r.ok ? r.js : null;
    }
    return null;
  }
  async function rpc(method, params) {
    const url = load("settings", {}).rpc || DEFAULT_RPC;
    let r; try { r = await fetchJson(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }, 20000); }
    catch (e) { fail("Can't reach the Solana network. Check your internet.", "A Solana hálózat nem érhető el. Ellenőrizd az internetet."); }
    if (!r.js) fail("Can't reach the Solana network. Check your internet.", "A Solana hálózat nem érhető el. Ellenőrizd az internetet.");
    if (r.js.error) fail("Solana error: " + (r.js.error.message || JSON.stringify(r.js.error)), "Solana hiba: " + (r.js.error.message || JSON.stringify(r.js.error)));
    return r.js.result;
  }
  const getSolBalance = async pub => (await rpc("getBalance", [pub, { commitment: "confirmed" }])).value;
  async function getTokens(pub) {
    const out = {};
    for (const prog of TOKEN_PROGRAMS) {
      const res = await rpc("getTokenAccountsByOwner", [pub, { programId: prog }, { encoding: "jsonParsed", commitment: "confirmed" }]);
      for (const acc of res.value) {
        const info = acc.account.data.parsed.info, amt = info.tokenAmount, raw = BigInt(amt.amount);
        if (raw === 0n) continue;
        const e = out[info.mint] || (out[info.mint] = { raw: 0n, decimals: amt.decimals });
        e.raw += raw;
      }
    }
    for (const e of Object.values(out)) e.ui = Number(e.raw) / 10 ** e.decimals;
    return out;
  }
  const getDecimals = async m => m === SOL ? 9 : (await rpc("getTokenSupply", [m])).value.decimals;

  // ---------------- piaci adatok ----------------
  const POOL = {}, MCACHE = {}, CHART = {};
  const ageMin = ms => ms ? (Date.now() - ms) / 60000 : null;
  function pairSummary(p) {
    const info = p.info || {}, base = p.baseToken, kn = KNOWN[base.address] || {}, tx = (p.txns || {}).h1 || {};
    return { address: base.address, symbol: kn.symbol || base.symbol || "?", name: kn.name || base.name || "", logo: info.imageUrl || kn.logo || "",
      price: +(p.priceUsd || 0), change24h: +((p.priceChange || {}).h24 || 0), volume24: +((p.volume || {}).h24 || 0),
      liquidity: +((p.liquidity || {}).usd || 0), mcap: +(p.marketCap || p.fdv || 0), pair: p.pairAddress, dex: p.dexId || "",
      age_min: ageMin(p.pairCreatedAt), buys_h1: tx.buys || 0, sells_h1: tx.sells || 0,
      websites: (info.websites || []).map(w => w.url).filter(Boolean).slice(0, 3),
      socials: (info.socials || []).filter(s => s.url).map(s => ({ type: s.type || "", url: s.url })).slice(0, 4) };
  }
  async function dsTokens(mints) {
    mints = [...new Set(mints.filter(Boolean))]; const out = {};
    for (let i = 0; i < mints.length; i += 30) {
      const chunk = mints.slice(i, i + 30);
      let pairs = []; try { const r = await fetchJson(DS + "/tokens/" + chunk.join(","), {}, 15000); pairs = (r.js && r.js.pairs) || []; } catch (e) { continue; }
      const best = {};
      for (const p of pairs) {
        if (p.chainId !== "solana") continue;
        const m = p.baseToken.address, liq = (p.liquidity || {}).usd || 0;
        if (chunk.includes(m) && liq >= ((best[m] || [-1])[0])) best[m] = [liq, p];
      }
      for (const [m, [, p]] of Object.entries(best)) { out[m] = pairSummary(p); if (out[m].pair) POOL[m] = out[m].pair; }
    }
    for (const m of mints) { const k = KNOWN[m]; if (!out[m] && k) out[m] = { address: m, symbol: k.symbol, name: k.name, logo: k.logo, price: k.stable ? 1 : 0, change24h: 0, volume24: 0, liquidity: 0, mcap: 0, pair: null, dex: "", age_min: null, buys_h1: 0, sells_h1: 0, websites: [], socials: [] }; }
    return out;
  }
  async function cached(key, ttl, fn) { const h = MCACHE[key]; if (h && Date.now() - h[0] < ttl * 1000) return h[1]; const v = await fn(); MCACHE[key] = [Date.now(), v]; return v; }
  async function popular() { const info = await dsTokens(POPULAR); return POPULAR.filter(m => info[m]).map(m => info[m]); }
  async function gtTokens(kind) {
    const js = await gtGet(`/networks/solana/${kind === "new" ? "new_pools" : "trending_pools"}`, { include: "base_token", page: 1 });
    if (!js) fail("The coin list isn't available right now. Try again in 30 seconds.", "A coinlista most nem érhető el. Próbáld újra fél perc múlva.");
    const inc = {}; for (const tk of js.included || []) if (tk.type === "token") inc[tk.id] = tk.attributes || {};
    const out = [], seen = new Set();
    for (const p of js.data || []) {
      const a = p.attributes || {}; let bid; try { bid = p.relationships.base_token.data.id; } catch (e) { continue; }
      const tk = inc[bid] || {}, addr = tk.address || bid.split("_").slice(1).join("_");
      if (seen.has(addr) || KNOWN[addr]) continue; seen.add(addr);
      let logo = tk.image_url || ""; if (logo.includes("missing")) logo = "";
      if (a.address && !POOL[addr]) POOL[addr] = a.address;
      out.push({ address: addr, symbol: tk.symbol || "?", name: tk.name || "", logo, price: +(a.base_token_price_usd || 0),
        change24h: +((a.price_change_percentage || {}).h24 || 0), volume24: +((a.volume_usd || {}).h24 || 0), liquidity: +(a.reserve_in_usd || 0),
        mcap: +(a.market_cap_usd || a.fdv_usd || 0), age_min: a.pool_created_at ? (Date.now() - Date.parse(a.pool_created_at)) / 60000 : null });
    }
    return out;
  }
  async function searchTokens(q) {
    q = q.trim(); if (!q) return [];
    if (B58_RE.test(q)) { const r = await dsTokens([q]); if (!Object.keys(r).length) fail("No Solana token found at this address.", "Ehhez a címhez nem találtam Solana tokent."); return Object.values(r); }
    let pairs; try { const r = await fetchJson(DS + "/search?" + new URLSearchParams({ q }), {}, 15000); pairs = (r.js && r.js.pairs) || []; }
    catch (e) { fail("Search isn't available right now.", "A keresés most nem érhető el."); }
    const best = {};
    for (const p of pairs) { if (p.chainId !== "solana") continue; const m = p.baseToken.address, liq = (p.liquidity || {}).usd || 0; if (liq >= ((best[m] || [-1])[0])) best[m] = [liq, p]; }
    const out = Object.values(best).sort((a, b) => b[0] - a[0]).map(x => pairSummary(x[1]));
    for (const tk of out) if (tk.pair && !POOL[tk.address]) POOL[tk.address] = tk.pair;
    return out.slice(0, 25);
  }
  const CHART_TF = { "1ó": ["minute", 1, 60], "24ó": ["minute", 15, 96], "7n": ["hour", 1, 168], "30n": ["hour", 4, 180] };
  const CHART_TTL = { "1ó": 45, "24ó": 90, "7n": 300, "30n": 600 };
  async function chartPoints(mint, tf) {
    if (!CHART_TF[tf]) tf = "24ó";
    const h = CHART[mint + tf]; if (h && Date.now() - h[0] < CHART_TTL[tf] * 1000) return h[1];
    if (!POOL[mint]) await dsTokens([mint]);
    const pool = POOL[mint]; if (!pool) fail("No chart for this token.", "Ehhez a tokenhez nincs grafikon.");
    const [frame, agg, limit] = CHART_TF[tf];
    const js = await gtGet(`/networks/solana/pools/${pool}/ohlcv/${frame}`, { aggregate: agg, limit, currency: "usd", token: mint });
    if (!js) fail("Chart data isn't available right now. Try again.", "A grafikon adatai most nem érhetők el.");
    const rows = (((js.data || {}).attributes || {}).ohlcv_list || []).slice().sort((a, b) => a[0] - b[0]);
    const pts = rows.filter(r => r[4]).map(r => [Math.floor(r[0]), +r[4]]);
    if (pts.length < 2) fail("No chart yet for this token (too new, or no trading).", "Ehhez a tokenhez még nincs grafikon (túl új, vagy nem kereskednek vele).");
    CHART[mint + tf] = [Date.now(), pts]; return pts;
  }
  async function walletSnapshot(pub) {
    const lam = await getSolBalance(pub), toks = await getTokens(pub), info = await dsTokens([SOL, ...Object.keys(toks)]);
    const sol = info[SOL] || {};
    const items = [{ ...sol, address: SOL, symbol: "SOL", name: "Solana", logo: sol.logo || KNOWN[SOL].logo, amount: lam / 1e9, value: lam / 1e9 * (sol.price || 0) }];
    const rest = Object.entries(toks).filter(([m]) => m !== SOL).map(([m, t]) => {
      const i = info[m] || { address: m, symbol: m.slice(0, 4) + "…", name: "", logo: "", price: 0, change24h: 0 };
      return { ...i, address: m, amount: t.ui, value: t.ui * (i.price || 0) };
    }).sort((a, b) => b.value - a.value);
    items.push(...rest);
    const total = items.reduce((s, x) => s + x.value, 0);
    const prev = items.filter(x => (x.change24h || 0) > -99).reduce((s, x) => s + x.value / (1 + (x.change24h || 0) / 100), 0);
    return { pubkey: pub, lamports: lam, sol: lam / 1e9, sol_price: sol.price || 0, total, change_usd: prev ? total - prev : 0, change_pct: prev ? (total / prev - 1) * 100 : 0, items };
  }
  async function resolveSolName(name) {
    let stem = name.trim().toLowerCase(); if (stem.endsWith(".sol")) stem = stem.slice(0, -4);
    if (!/^[a-z0-9_-]{1,64}$/.test(stem)) fail("Invalid .sol name.", "Érvénytelen .sol név.");
    let js; try { js = (await fetchJson("https://sdk-proxy.sns.id/resolve/" + stem, {}, 12000)).js; } catch (e) { fail(".sol name lookup isn't available right now.", "A .sol névfeloldás most nem érhető el."); }
    const addr = js && js.s === "ok" ? js.result : null;
    if (!addr || !B58_RE.test(String(addr))) fail(`${stem}.sol doesn't exist or has no owner.`, `A(z) ${stem}.sol név nem létezik, vagy nincs tulajdonosa.`);
    return addr;
  }

  // ---------------- rug-kockázat ----------------
  const RISK = { "Mint Authority still enabled": ["The developer can still mint new tokens", "A fejlesztő még tud új tokent nyomtatni"],
    "Freeze Authority still enabled": ["The developer can freeze your wallet", "A fejlesztő befagyaszthatja a tárcádat"],
    "Large Amount of LP Unlocked": ["Liquidity is not locked and can be pulled", "A likviditás nincs lezárva, kihúzható"],
    "Low Liquidity": ["Low liquidity", "Alacsony likviditás"], "Top 10 holders high ownership": ["Top 10 wallets hold most of the supply", "A top 10 tárcánál van a tokenek nagy része"],
    "Single holder ownership": ["A single wallet holds a very large share", "Egyetlen tárcánál nagyon sok token van"],
    "High holder concentration": ["Supply is concentrated in few wallets", "Kevés tárcánál van a tokenek nagy része"],
    "Low amount of LP Providers": ["Few liquidity providers", "Kevés likviditás-szolgáltató"], "Mutable metadata": ["Token metadata can be changed", "A token adatai módosíthatók"],
    "Copycat token": ["Copycat token", "Másolt (copycat) token"], "Creator history of rugged tokens": ["The creator's earlier tokens rugged", "A készítő korábbi tokenjei rugoltak"] };
  async function rugCheck(t) {
    const reasons = []; let level = 0;
    try {
      const r = await fetchJson(`https://api.rugcheck.xyz/v1/tokens/${t.address}/report/summary`, {}, 12000);
      if (r.ok && r.js) {
        for (const risk of r.js.risks || []) {
          const name = risk.name || "", lvl = risk.level || "";
          if (name === "Low Liquidity" && t.liquidity >= 10000) continue;
          const text = RISK[name] ? L(...RISK[name]) : name;
          if (lvl === "danger") { level = 2; reasons.push({ level: "danger", text }); }
          else if (lvl === "warn") { if (name !== "Mutable metadata") level = Math.max(level, 1); reasons.push({ level: "warn", text }); }
        }
        const sc = r.js.score_normalised; if (sc != null) level = Math.max(level, sc >= 50 ? 2 : sc >= 20 ? 1 : 0);
      }
    } catch (e) { reasons.push({ level: "warn", text: L("RugCheck is unavailable, rug risk unknown", "A RugCheck nem érhető el, a rug-kockázat ismeretlen") }); level = Math.max(level, 1); }
    const liq = t.liquidity, usd = "$" + Math.round(liq).toLocaleString("en-US");
    if (liq < 5000) { level = 2; reasons.unshift({ level: "danger", text: L(`Very low liquidity (${usd})`, `Nagyon kevés likviditás (${usd})`) }); }
    else if (liq < 20000) { level = Math.max(level, 1); reasons.unshift({ level: "warn", text: L(`Low liquidity (${usd})`, `Kevés likviditás (${usd})`) }); }
    if (t.sells_h1 > 20 && t.sells_h1 > 2 * t.buys_h1) { level = Math.max(level, 1); reasons.push({ level: "warn", text: L("Many more sells than buys in the last hour", "Az elmúlt órában sokkal több eladás volt, mint vétel") }); }
    return [level, reasons];
  }

  // ---------------- Jupiter ----------------
  function jupHeaders() { const key = (load("settings", {}).jup_key || "").trim(); if (!key) fail("Buying needs a Jupiter API key. Add it in Settings.", "A vásárláshoz Jupiter API kulcs kell. Add meg a Beállításokban."); return { "x-api-key": key }; }
  async function jupOrder(input, output, amountRaw, taker) {
    const headers = jupHeaders(); let r;
    try { r = await fetchJson(JUP + "/order?" + new URLSearchParams({ inputMint: input, outputMint: output, amount: String(amountRaw), taker }), { headers }, 20000); }
    catch (e) { fail("Can't reach Jupiter. Check your internet.", "A Jupiter nem érhető el. Ellenőrizd az internetet."); }
    if (r.status === 401 || r.status === 403) fail("The Jupiter API key is invalid. Check it in Settings.", "A Jupiter API kulcs érvénytelen. Ellenőrizd a Beállításokban.");
    if (r.status === 429) fail("Too many requests to Jupiter. Wait half a minute.", "Túl sok kérés a Jupiter felé. Várj fél percet.");
    if (!r.js) fail(`Unexpected response from Jupiter (${r.status}).`, `Váratlan válasz a Jupitertől (${r.status}).`);
    if (!r.ok || !r.js.transaction) { const err = r.js.errorMessage || r.js.error || r.js.message || r.status; fail("No quote available: " + err, "Nincs elérhető ajánlat: " + err); }
    r.js._time = Date.now(); return r.js;
  }
  async function jupExecute(signed, requestId) {
    const headers = { ...jupHeaders(), "Content-Type": "application/json" };
    try { const r = await fetchJson(JUP + "/execute", { method: "POST", headers, body: JSON.stringify({ signedTransaction: signed, requestId }) }, 60000); if (r.js) return r.js; } catch (e) {}
    fail("The result is unknown (network error). Refresh your balance in a few minutes before trying again.", "A végrehajtás állapota ismeretlen (hálózati hiba). Néhány perc múlva frissítsd az egyenleget, mielőtt újra próbálod.");
  }
  const impactPct = o => { const v = o.priceImpact != null ? Math.abs(+o.priceImpact) : o.priceImpactPct != null ? Math.abs(+o.priceImpactPct) * 100 : 0; return isFinite(v) ? v : 0; };
  const txFailMsg = res => L(`The transaction failed (${res.code ?? "?"}): ${res.error || res.errorMessage || "unknown error"}. If it failed, your money was not spent.`,
    `A tranzakció nem sikerült (${res.code ?? "?"}): ${res.error || res.errorMessage || "ismeretlen hiba"}. Ha nem volt sikeres, a pénzed nem ment el.`);

  // ---------------- segédek ----------------
  function num(text) {
    const v = parseFloat(String(text).replace(",", ".").replace(/\s/g, ""));
    if (!isFinite(v)) fail("The amount is not a number.", "Az összeg nem szám.");
    if (!(v > 0)) fail("The amount must be greater than zero.", "Az összeg legyen nagyobb nullánál.");
    return v;
  }
  function parseAddress(text) {
    let raw; try { raw = K.b58decode((text || "").trim()); } catch (e) { fail("This is not a valid Solana address.", "Ez nem érvényes Solana cím."); }
    if (raw.length !== 32) fail("This is not a valid Solana address (wrong length). Check what you copied.", "Ez nem érvényes Solana cím (rossz hossz). Ellenőrizd a másolást.");
    return raw;
  }
  const fmtG = (v, d = 6) => Number(v).toLocaleString("en-US", { maximumSignificantDigits: d }).replace(/,/g, " ");
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return; } catch (e) {}
    const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); ta.remove(); if (!ok) throw new Error("copy");
  }
  function openExternal(url) {
    const B = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
    if (B) return B.open({ url }); window.open(url, "_blank");
  }

  // ---------------- élő kötések (1 mp-es gyertyákhoz) ----------------
  const TRADES = {};
  async function poolTrades(mint) {
    const h = TRADES[mint]; if (h && (Date.now() - h[0] < 2500 || bucket.tokens < 2)) return h[1];
    if (!POOL[mint]) await dsTokens([mint]);
    const pool = POOL[mint]; if (!pool) fail("There's no trade data for this token.", "Ehhez a tokenhez nincs kereskedési adat.");
    const js = await gtGet(`/networks/solana/pools/${pool}/trades`, {});
    if (!js) { if (h) return h[1]; fail("Trade data isn't available right now.", "A kereskedési adatok most nem érhetők el."); }
    const out = [];
    for (const d of js.data || []) {
      const a = d.attributes || {}; const t = Date.parse(a.block_timestamp) / 1000; let p, side;
      if (a.to_token_address === mint) { p = +a.price_to_in_usd; side = "buy"; } else if (a.from_token_address === mint) { p = +a.price_from_in_usd; side = "sell"; } else continue;
      if (p > 0 && isFinite(t)) out.push({ id: d.id || `${t}${p}`, t, p, v: +a.volume_in_usd || 0, side });
    }
    out.sort((x, y) => x.t - y.t); TRADES[mint] = [Date.now(), out]; return out;
  }

  // ---------------- Kesu fiók (Supabase): e-mail + felhasználónév + jelszó + e-mailes kód ----------------
  const SB_URL = "https://tztoupnggoaqvharzmax.supabase.co", SB_KEY = "";   // a nyilvános (anon) kulcs
  const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,}$/;
  const sbConf = () => { const s = load("settings", {}); return [(s.sb_url || SB_URL).trim().replace(/\/+$/, ""), (s.sb_key || SB_KEY).trim()]; };
  class SbErr extends WErr { constructor(status, msg, code) { super(msg || "HTTP " + status); this.status = status; this.msg = msg || ""; this.code = code || ""; } }
  async function sb(method, path, body, token, params, prefer) {
    const [url, key] = sbConf();
    if (!url || !key) fail("The account server isn't set up (Settings → Account server).", "A fiók-szerver nincs beállítva (Beállítások → Fiók-szerver).");
    const h = { apikey: key, "Content-Type": "application/json", Accept: "application/json" };
    if (token || key.startsWith("eyJ")) h.Authorization = "Bearer " + (token || key);
    if (prefer) h.Prefer = prefer;
    let r;
    try { r = await fetchJson(url + path + (params ? "?" + new URLSearchParams(params) : ""), { method, headers: h, body: body ? JSON.stringify(body) : undefined }, 20000); }
    catch (e) { fail("The account server isn't reachable right now. Try again later.", "A fiók-szerver most nem érhető el. Próbáld újra később."); }
    if (r.status >= 400) { const j = r.js || {}; throw new SbErr(r.status, String(j.msg || j.error_description || j.message || j.error || ""), String(j.error_code || j.code || "")); }
    return r.js;
  }
  const sbProfile = async (f, v) => { const rows = await sb("GET", "/rest/v1/profiles", null, null, { [f]: "eq." + v, select: "id,username,sol_address,btc_address" }); return (rows && rows[0]) || null; };
  const acct = () => { const a = load("profile", {}).account; return a && a.uid && a.sol === S.pub ? a : null; };
  async function acctFinish(sess) {
    need(); const user = sess.user || {}, uid = user.id, token = sess.access_token;
    let prof = uid ? await sbProfile("id", uid) : null;
    if (!prof) fail("The account server isn't fully set up (the profiles table is missing).", "A fiók-szerver nincs teljesen beállítva (hiányzik a profiles tábla).");
    if (prof.sol_address && prof.sol_address !== S.pub) { const a = prof.sol_address; fail(`This account belongs to another wallet (${a.slice(0, 4)}…${a.slice(-4)}). Log in with that wallet.`, `Ez a fiók egy másik tárcához tartozik (${a.slice(0, 4)}…${a.slice(-4)}). Lépj be azzal a tárcával.`); }
    if (!prof.sol_address) {
      try { await sb("PATCH", "/rest/v1/profiles", { sol_address: S.pub }, token, { id: "eq." + uid }, "return=minimal"); }
      catch (e) { if (e.status === 409 || e.code === "23505") fail("This wallet already belongs to another account.", "Ez a tárca már egy másik fiókhoz tartozik."); throw e; }
      prof = await sbProfile("id", uid);
      if (!prof || prof.sol_address !== S.pub) fail("Couldn't link the wallet to the account. Try again.", "Nem sikerült a tárcát a fiókhoz kötni. Próbáld újra.");
    }
    save("profile", { ...load("profile", {}), account: { uid, email: user.email || "", username: prof.username, sol: S.pub }, username: prof.username });
    return { username: prof.username, email: user.email || "", logged_in: true };
  }

  // ---------------- API ----------------
  const S = { seed: null, pub: null, orders: {}, rug: {} };
  const need = () => { if (!S.seed) fail("The wallet is locked.", "A tárca zárolva van."); return S; };
  const open = async seed => { S.seed = seed; S.pub = K.b58encode(await K.pubFromSeed(seed)); };
  function store(order, meta) { const id = K.b64e(K.rand(8)); S.orders[id] = { order, time: Date.now(), ...meta }; return id; }
  function summary(id, pay, payUsd, get) {
    const o = S.orders[id].order, fees = ["signatureFeeLamports", "prioritizationFeeLamports", "rentFeeLamports"].reduce((s, k) => s + (+o[k] || 0), 0) / 1e9;
    return { order_id: id, pay, pay_usd: payUsd, get, impact: impactPct(o), slippage: (+o.slippageBps || 0) / 100, fees_sol: fees, gasless: !!o.gasless, rug_level: S.orders[id].rug_level || 0, valid_s: QUOTE_VALID_S };
  }

  const M = {
    async state() { const w = load("wallet", null); return { has_wallet: !!w, unlocked: !!S.seed, pubkey: S.pub || (w && w.pubkey), has_jup_key: !!(load("settings", {}).jup_key || "").trim(), ...prefs() }; },
    async create_wallet(pw) {
      if ((pw || "").length < 8) fail("The password must be at least 8 characters.", "A jelszó legyen legalább 8 karakter.");
      if (load("wallet", null)) fail("There is already a wallet here.", "Már van tárca itt.");
      const seed = K.rand(32); save("wallet", await K.encryptSeed(seed, pw)); await open(seed);
      return { secret: await K.secretToExport(seed), pubkey: S.pub };
    },
    async import_wallet(secret, pw) {
      if ((pw || "").length < 8) fail("The password must be at least 8 characters.", "A jelszó legyen legalább 8 karakter.");
      const seed = await K.parseImport(secret, L); save("wallet", await K.encryptSeed(seed, pw)); await open(seed); return { pubkey: S.pub };
    },
    async unlock(pw) { const w = load("wallet", null); if (!w) fail("No saved wallet.", "Nincs elmentett tárca."); await open(await K.decryptSeed(w, pw || "", L)); return { pubkey: S.pub }; },
    async lock() { S.seed = null; S.pub = null; S.orders = {}; },
    async export_secret(pw) { need(); const s = await K.decryptSeed(load("wallet"), pw || "", L); if (!K.eq(s, S.seed)) fail("Wrong password.", "Hibás jelszó."); return { secret: await K.secretToExport(S.seed) }; },
    async change_password(old, nw) {
      need(); let ok = false; try { ok = K.eq(await K.decryptSeed(load("wallet"), old || "", L), S.seed); } catch (e) {}
      if (!ok) fail("The current password is wrong.", "A régi jelszó hibás.");
      if ((nw || "").length < 8) fail("The password must be at least 8 characters.", "A jelszó legyen legalább 8 karakter.");
      if (nw === old) fail("The new password must be different from the current one.", "Az új jelszó nem lehet ugyanaz, mint a régi.");
      save("wallet", await K.encryptSeed(S.seed, nw));
    },
    async settings_get() { const s = load("settings", {}); return { jup_key: s.jup_key || "", rpc: s.rpc || "" }; },
    async settings_save(key, url) {
      url = (url || "").trim(); if (url && !url.startsWith("https://")) fail("The RPC URL must start with https://", "Az RPC cím https:// kezdetű legyen.");
      save("settings", { ...load("settings", {}), jup_key: (key || "").trim(), rpc: url });
    },
    async profile_get() {
      const p = load("profile", {}), s = load("settings", {});
      const a = acct();
      return { username: a ? a.username : "", registered: !!a, email: a ? a.email : "", avatar: p.avatar || "", autolock: +(p.autolock ?? 15), default_buy: p.default_buy || "0.1",
        instant_sell: !!p.instant_sell, max_impact: +(p.max_impact ?? 10), pubkey: S.pub, jup_key: s.jup_key || "", rpc: s.rpc || "",
        data_dir: window.Capacitor ? L("This phone (app storage)", "Ez a telefon (app tárhelye)") : L("This browser (encrypted, on this device only)", "Ez a böngésző (titkosítva, csak ezen az eszközön)"), ...prefs() };
    },
    async profile_set() { fail("You get a username by registering (Create account).", "Felhasználónevet regisztrációval kapsz (Fiók létrehozása)."); },
    async acct_status() { const [url, key] = sbConf(), a = acct(); return { configured: !!(url && key), logged_in: !!a, email: a ? a.email : "", username: a ? a.username : "", url, key }; },
    async acct_server(url, key) {
      url = (url || "").trim().replace(/\/+$/, ""); key = (key || "").trim();
      if (url && !/^https:\/\/[\w.-]+$/.test(url)) fail("The server address should look like https://something.supabase.co", "A szerver címe így nézzen ki: https://valami.supabase.co");
      save("settings", { ...load("settings", {}), sb_url: url, sb_key: key });
    },
    async acct_register(email, username, pw, pw2) {
      need(); email = (email || "").trim().toLowerCase(); const u = (username || "").trim().replace(/^@/, "").toLowerCase();
      if (!EMAIL_RE.test(email)) fail("Invalid email address.", "Érvénytelen e-mail cím.");
      if (!USER_RE.test(u)) fail("Username: 3–20 characters, lowercase letters, numbers or _", "A felhasználónév 3–20 karakter legyen: kisbetű, szám vagy _");
      if ((pw || "").length < 8) fail("The password must be at least 8 characters.", "A jelszó legyen legalább 8 karakter.");
      if (pw !== pw2) fail("The two passwords don't match.", "A két jelszó nem egyezik.");
      if (await sbProfile("username", u)) fail("This username is already taken. Choose another one.", "Ez a felhasználónév már foglalt. Válassz másikat.");
      if (await sbProfile("sol_address", S.pub)) fail("This wallet already has an account. Log in with it.", "Ehhez a tárcához már tartozik fiók. Lépj be azzal.");
      let js;
      try { js = await sb("POST", "/auth/v1/signup", { email, password: pw, data: { username: u } }); }
      catch (e) {
        if (!(e instanceof SbErr)) throw e; const m = e.msg.toLowerCase();
        if (m.includes("database error")) fail("This username is already taken. Choose another one.", "Ez a felhasználónév már foglalt. Válassz másikat.");
        if (m.includes("already") || e.code === "user_already_exists") fail("There's already an account with this email. Log in.", "Ezzel az e-mail címmel már van fiók. Lépj be.");
        if (e.status === 429 || m.includes("rate limit") || m.includes("security purposes")) fail("Too many emails were sent. Wait a few minutes, then try again.", "Túl sok e-mail ment ki. Várj pár percet, aztán próbáld újra.");
        if (m.includes("password")) fail("The password isn't accepted: " + e.msg, "A jelszó nem megfelelő: " + e.msg);
        fail("Registration failed: " + e.msg, "A regisztráció nem sikerült: " + e.msg);
      }
      if (js && js.access_token) return acctFinish(js);
      return { need_code: true, email };
    },
    async acct_verify(email, code) {
      need(); email = (email || "").trim().toLowerCase(); code = String(code || "").replace(/\D/g, "");
      if (code.length !== 6) fail("The code has 6 digits.", "A kód 6 számjegyből áll.");
      let sess = null;
      for (const type of ["email", "signup"]) {
        try { sess = await sb("POST", "/auth/v1/verify", { type, email, token: code }); break; }
        catch (e) { if (!(e instanceof SbErr)) throw e; if (e.status >= 500 || e.status === 429) fail("The account server isn't reachable right now. Try again later.", "A fiók-szerver most nem érhető el. Próbáld újra később."); }
      }
      if (!sess || !sess.access_token) fail("Wrong or expired code. Check it again, or ask for a new one.", "Hibás vagy lejárt kód. Nézd meg újra, vagy kérj újat.");
      return acctFinish(sess);
    },
    async acct_resend(email) {
      try { await sb("POST", "/auth/v1/resend", { type: "signup", email: (email || "").trim().toLowerCase() }); }
      catch (e) { if (!(e instanceof SbErr)) throw e; const m = e.msg.toLowerCase();
        if (e.status === 429 || m.includes("security purposes") || m.includes("rate limit")) fail("Wait a little before asking for a new code.", "Várj még egy kicsit, mielőtt új kódot kérsz.");
        fail("Couldn't send a new code: " + e.msg, "Nem sikerült új kódot küldeni: " + e.msg); }
    },
    async acct_login(email, pw) {
      need(); email = (email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) fail("Invalid email address.", "Érvénytelen e-mail cím.");
      let sess;
      try { sess = await sb("POST", "/auth/v1/token", { email, password: pw || "" }, null, { grant_type: "password" }); }
      catch (e) {
        if (!(e instanceof SbErr)) throw e; const m = e.msg.toLowerCase();
        if (m.includes("not confirmed") || e.code === "email_not_confirmed") { try { await sb("POST", "/auth/v1/resend", { type: "signup", email }); } catch (e2) {} return { need_code: true, email }; }
        if (m.includes("invalid") || e.code === "invalid_credentials") fail("Wrong email or password.", "Hibás e-mail cím vagy jelszó.");
        if (e.status === 429) fail("Too many attempts. Wait a few minutes.", "Túl sok próbálkozás. Várj pár percet.");
        fail("Login failed: " + e.msg, "A belépés nem sikerült: " + e.msg);
      }
      return acctFinish(sess);
    },
    async acct_logout() { const p = load("profile", {}); delete p.account; delete p.username; save("profile", p); },
    async logout(pw) {
      need(); let ok = false; try { ok = K.eq(await K.decryptSeed(load("wallet"), pw || "", L), S.seed); } catch (e) {}
      if (!ok) fail("Wrong password.", "Hibás jelszó.");
      save("logged_out_" + Date.now(), { wallet: load("wallet", null), profile: load("profile", {}), friends: load("friends", []) });   // titkosított másolat
      localStorage.removeItem("kesu_wallet"); localStorage.removeItem("kesu_friends");
      const p = load("profile", {}); delete p.account; delete p.username; save("profile", p);
      S.seed = null; S.pub = null; S.orders = {};
      return { archive: L("this browser (encrypted copy)", "ez a böngésző (titkosított másolat)") };
    },
    async trades(mint) { return { t: Date.now() / 1000, trades: await poolTrades(mint) }; },
    async profile_update(f) {
      const p = load("profile", {});
      for (let [k, v] of Object.entries(f || {})) {
        const bad = () => fail("Invalid setting: " + k, "Érvénytelen beállítás: " + k);
        if (k === "email") { v = String(v).trim(); if (v && !/^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,}$/.test(v)) fail("Invalid email address.", "Érvénytelen e-mail cím."); }
        else if (k === "avatar") { v = String(v); if (v && (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) || v.length > 400000)) fail("The profile picture is too large or not an image.", "A profilkép túl nagy, vagy nem kép."); }
        else if (k === "lang") { if (!["en", "hu"].includes(v)) bad(); }
        else if (k === "accent") { if (!ACCENTS.includes(v)) bad(); }
        else if (k === "autolock") { v = +v; if (![0, 5, 15, 30, 60].includes(v)) bad(); }
        else if (k === "default_buy") v = String(num(v));
        else if (k === "instant_sell") v = !!v;
        else if (k === "max_impact") { v = num(v); if (v < 0.5 || v > 50) bad(); }
        else bad();
        p[k] = v;
      }
      save("profile", p);
    },
    async invite_code() { need(); const a = acct(); if (!a) fail("Create your account first (register).", "Előbb hozd létre a fiókodat (regisztráció)."); return { code: `@${a.username}/${S.pub}` }; },
    async friends_list() { return { items: load("friends", []) }; },
    async friend_add(text, nick) {
      text = (text || "").trim(); nick = (nick || "").trim().replace(/^@/, ""); let name, addr; const m = text.match(INVITE_RE);
      if (m) { name = m[1].toLowerCase(); addr = m[2];
        let prof = null; try { prof = await sbProfile("username", name); } catch (e) {}
        if (prof && prof.sol_address && prof.sol_address !== addr) fail(`This invite code is fake: @${name} belongs to someone else.`, `Ez a meghívókód hamis: @${name} valaki másé.`); }
      else if (text.startsWith("@") && USER_RE.test(text.slice(1).toLowerCase())) {
        name = text.slice(1).toLowerCase(); const prof = await sbProfile("username", name); addr = prof && prof.sol_address;
        if (!addr) fail("No such user: @" + name, "Nincs ilyen felhasználó: @" + name); }
      else if (text.toLowerCase().endsWith(".sol")) { addr = await resolveSolName(text); name = text.toLowerCase().slice(0, -4); }
      else if (B58_RE.test(text)) { addr = text; name = ""; }
      else fail("Not recognised. Enter your friend's invite code (@name/address), wallet address or .sol name.", "Ezt nem ismerem fel. Add meg a barátod meghívókódját (@név/cím), a tárcacímét, vagy a .sol nevét.");
      if (nick) name = nick;
      if (!name) fail("Give your friend a name too.", "Adj meg egy nevet is a barátodnak.");
      if (!/^[\w.\- ]{1,24}$/.test(name)) fail("Name: up to 24 characters (letters, numbers, space, . - _)", "A név legfeljebb 24 karakter: betű, szám, szóköz, pont, - vagy _");
      parseAddress(addr); if (addr === S.pub) fail("This is your own address.", "Ez a saját címed.");
      const fr = load("friends", []); if (fr.some(f => f.address === addr)) fail("Already your friend.", "Ő már a barátod.");
      const item = { name, address: addr, added: Math.floor(Date.now() / 1000) }; fr.push(item); save("friends", fr); return item;
    },
    async friend_remove(addr) { save("friends", load("friends", []).filter(f => f.address !== addr)); },
    async wallet_view(addr) { parseAddress(addr); const snap = await walletSnapshot(addr); return { ...snap, friend: load("friends", []).find(f => f.address === addr) || null, is_me: addr === S.pub }; },
    async search_all(q) {
      q = (q || "").trim(); const out = { coins: [], friends: [], wallets: [] }; if (!q) return out;
      const key = q.replace(/^@/, "").toLowerCase();
      out.friends = load("friends", []).filter(f => f.name.toLowerCase().includes(key) || f.address === q).slice(0, 5);
      if (q.toLowerCase().endsWith(".sol")) { try { out.wallets.push({ address: await resolveSolName(q), name: q.toLowerCase() }); } catch (e) { out.note = e.message; } return out; }
      if (B58_RE.test(q)) { const c = (await dsTokens([q]))[q]; if (c) out.coins = [c]; else if (!out.friends.length) out.wallets.push({ address: q, name: "" }); return out; }
      if (q.startsWith("@") && USER_RE.test(key)) { try { const prof = await sbProfile("username", key), a = prof && prof.sol_address;
        if (a && a !== S.pub && !out.friends.some(f => f.address === a)) out.wallets.push({ address: a, name: "@" + key }); } catch (e) {} }
      if (key.length >= 2 && !q.startsWith("@")) { try { out.coins = (await searchTokens(q)).slice(0, 6); } catch (e) {} }
      return out;
    },
    async portfolio() { need(); return walletSnapshot(S.pub); },
    async market(kind) {
      if (kind === "popular") return { items: await cached("popular", 30, popular) };
      if (kind === "trending" || kind === "new") return { items: await cached(kind, 45, () => gtTokens(kind)) };
      fail("Unknown list.", "Ismeretlen lista.");
    },
    async search(q) { return { items: await searchTokens(q || "") }; },
    async token(mint) {
      const info = (await dsTokens([mint]))[mint]; if (!info) fail("No Solana token found at this address.", "Ehhez a címhez nem találtam Solana tokent.");
      const [level, reasons] = (KNOWN[mint] || TRUSTED.has(mint)) ? [0, []] : await rugCheck(info); S.rug[mint] = level;
      let held = 0; if (S.pub) { try { held = mint === SOL ? (await getSolBalance(S.pub)) / 1e9 : ((await getTokens(S.pub))[mint] || {}).ui || 0; } catch (e) {} }
      return { ...info, rug: { level, reasons }, held };
    },
    async chart(mint, tf) { return { points: await chartPoints(mint, tf) }; },
    async live(mint) {
      let pairs; try { const r = await fetchJson(DS + "/tokens/" + mint, {}, 6000); pairs = ((r.js && r.js.pairs) || []).filter(p => p.chainId === "solana" && p.baseToken.address === mint); }
      catch (e) { fail("Live price isn't available right now.", "Az élő ár most nem érhető el."); }
      if (!pairs.length) fail("No Solana token found at this address.", "Ehhez a címhez nem találtam Solana tokent.");
      const p = pairs.reduce((a, b) => (((b.liquidity || {}).usd || 0) > ((a.liquidity || {}).usd || 0) ? b : a));
      const pc = p.priceChange || {}, tx5 = (p.txns || {}).m5 || {}, n = v => v == null ? null : +v;
      return { t: Date.now() / 1000, price: +(p.priceUsd || 0), m5: n(pc.m5), h1: n(pc.h1), h6: n(pc.h6), h24: n(pc.h24), buys5: tx5.buys || 0, sells5: tx5.sells || 0, age_min: ageMin(p.pairCreatedAt) };
    },
    async quote_buy(mint, amount) {
      need(); if (mint === SOL) fail("You can't buy SOL with SOL. Use “Buy SOL” to buy SOL with a card.", "SOL-t SOL-ért nem lehet venni. SOL-t a „SOL vásárlás” gombbal tudsz venni.");
      const sol = num(amount), have = (await getSolBalance(S.pub)) / 1e9;
      if (sol > have - FEE_RESERVE) fail(`Not enough SOL. Balance: ${have.toFixed(4)} SOL, and 0.01 SOL must stay for fees.`, `Nincs elég SOL. Egyenleg: ${have.toFixed(4)} SOL, és 0.01 SOL-nak maradnia kell a díjakra.`);
      const info = await dsTokens([mint, SOL]), t = info[mint] || {};
      if (S.rug[mint] == null && !KNOWN[mint] && !TRUSTED.has(mint) && t.address) S.rug[mint] = (await rugCheck(t))[0];
      const order = await jupOrder(SOL, mint, Math.round(sol * 1e9), S.pub), dec = await getDecimals(mint), sym = t.symbol || "token";
      const id = store(order, { side: "buy", mint, symbol: sym, rug_level: S.rug[mint] || 0 });
      return summary(id, `${sol} SOL`, sol * ((info[SOL] || {}).price || 0), `${fmtG(Number(order.outAmount) / 10 ** dec)} ${sym}`);
    },
    async quote_sell(mint, pct) {
      need(); pct = +pct; if (![25, 50, 100].includes(pct)) fail("Invalid percentage.", "Érvénytelen arány.");
      const tok = (await getTokens(S.pub))[mint]; if (!tok) fail("You don't hold this token.", "Ebből a tokenből nincs a tárcádban.");
      if ((await getSolBalance(S.pub)) < 3000000) fail("Selling also needs a little SOL for fees (min. 0.003 SOL).", "Az eladáshoz is kell egy kevés SOL a díjakra (min. 0,003 SOL).");
      const raw = pct === 100 ? tok.raw : tok.raw * BigInt(pct) / 100n, info = (await dsTokens([mint]))[mint] || {}, sym = info.symbol || "token";
      const order = await jupOrder(mint, SOL, raw.toString(), S.pub), ui = Number(raw) / 10 ** tok.decimals;
      const id = store(order, { side: "sell", mint, symbol: sym, rug_level: 0 });
      return summary(id, `${fmtG(ui)} ${sym} (${pct}%)`, ui * (info.price || 0), `${fmtG(Number(order.outAmount) / 1e9)} SOL`);
    },
    async instant_sell(mint, pct) {
      need(); const prof = load("profile", {});
      if (!prof.instant_sell) fail("Instant sell is turned off in Settings.", "Az azonnali eladás nincs bekapcsolva a beállításokban.");
      pct = +pct; if (![25, 50, 100].includes(pct)) fail("Invalid percentage.", "Érvénytelen arány.");
      const tok = (await getTokens(S.pub))[mint]; if (!tok) fail("You don't hold this token.", "Ebből a tokenből nincs a tárcádban.");
      const raw = pct === 100 ? tok.raw : tok.raw * BigInt(pct) / 100n;
      const order = await jupOrder(mint, SOL, raw.toString(), S.pub), imp = impactPct(order), lim = +(prof.max_impact ?? 10);
      if (imp > lim) fail(`Sale stopped: price impact is ${imp.toFixed(1)}%, your limit is ${lim}%.`, `Az eladás leállítva: az ár-hatás ${imp.toFixed(1)}%, a határod ${lim}%.`);
      const res = await jupExecute(await K.signTransaction(order.transaction, S.seed, L), order.requestId);
      return res.status === "Success" ? { success: true, signature: res.signature, sol: Number(order.outAmount) / 1e9 } : { success: false, signature: res.signature, message: txFailMsg(res) };
    },
    async execute(id, confirm) {
      need(); const o = S.orders[id]; delete S.orders[id];
      if (!o) fail("This quote is no longer valid. Get a new one.", "Ez az ajánlat már nem érvényes. Kérj újat.");
      if (Date.now() - o.time > QUOTE_VALID_S * 1000) fail("The quote expired. Get a new one.", "Az ajánlat lejárt. Kérj újat.");
      if (o.side === "buy" && o.rug_level === 2 && !["IGEN", "YES"].includes((confirm || "").trim().toUpperCase())) fail("High rug risk: you must type YES to confirm.", "Magas rug-kockázatnál be kell írni: IGEN");
      const res = await jupExecute(await K.signTransaction(o.order.transaction, S.seed, L), o.order.requestId);
      return res.status === "Success" ? { success: true, signature: res.signature, symbol: o.symbol, side: o.side } : { success: false, signature: res.signature, message: txFailMsg(res) };
    },
    async send_check(to, amount) {
      need(); to = (to || "").trim(); const toB = parseAddress(to);
      if (K.eq(toB, await K.pubFromSeed(S.seed))) fail("This is your own address.", "Ez a saját címed.");
      const lam = Math.round(num(amount) * 1e9), bal = await getSolBalance(S.pub), hasTok = Object.keys(await getTokens(S.pub)).length > 0, rest = bal - lam - TX_FEE;
      if (rest < 0) fail("You don't have that much SOL (include the fee).", "Nincs ennyi SOL a tárcában (a díjat is számold bele).");
      if (rest > 0 && rest < RENT_MIN) fail("That would leave less than 0.0009 SOL, which the network doesn't allow. Send less, or use Max.", "Így 0,0009 SOL alatt maradna a tárcában, ezt a hálózat nem engedi. Küldj kevesebbet, vagy használd a Max gombot.");
      if (hasTok && rest < 2000000) fail("Keep at least 0.002 SOL, or you won't be able to pay fees to sell your tokens.", "Hagyj legalább 0,002 SOL-t, különben nem tudod eladni a tokenjeidet (nem lesz pénz a díjra).");
      const rb = await getSolBalance(to);
      if (rb === 0 && lam < RENT_MIN) fail("This address is empty, so you must send at least 0.0009 SOL to it (network rule).", "Ez a cím még üres, ezért legalább 0,0009 SOL-t kell küldeni rá (a hálózat szabálya).");
      return { to, lamports: lam, new_addr: rb === 0 };
    },
    async send_max() { need(); const bal = await getSolBalance(S.pub), keep = Object.keys(await getTokens(S.pub)).length ? 3000000 : 0; return { sol: Math.max(bal - TX_FEE - keep, 0) / 1e9, kept_for_tokens: keep > 0 }; },
    async send(to, lamports) {
      need(); const toB = parseAddress(to);
      if (K.eq(toB, await K.pubFromSeed(S.seed))) fail("You can't send to yourself.", "Saját magadnak nem küldhetsz.");
      const bh = (await rpc("getLatestBlockhash", [{ commitment: "confirmed" }])).value.blockhash;
      const tx = await K.buildSolTransfer(S.seed, toB, +lamports, bh);
      const sig = await rpc("sendTransaction", [tx, { encoding: "base64", preflightCommitment: "confirmed" }]);
      for (let i = 0; i < 30; i++) {
        await sleep(2000); const st = (await rpc("getSignatureStatuses", [[sig]])).value[0];
        if (st) { if (st.err) fail("The network rejected the transfer. Your money was not sent.", "A hálózat elutasította az utalást. A pénz nem ment el."); if (["confirmed", "finalized"].includes(st.confirmationStatus)) return { signature: sig, confirmed: true }; }
      }
      return { signature: sig, confirmed: false };
    },
    async copy(text) { await copyText(String(text)); },
    async open_url(url) { if (!/^https?:\/\//.test(String(url))) fail("Only web links can be opened.", "Csak webcím nyitható meg."); await openExternal(url); },
    async open_moonpay() { if (S.pub) { try { await copyText(S.pub); } catch (e) {} } await openExternal(MOONPAY_URL); },
  };
  // minden hívás: hibák -> {error: "..."} (mint a Python-verzióban)
  const api = {};
  for (const [name, fn] of Object.entries(M)) api[name] = async (...a) => {
    try { const r = await fn(...a); return r === undefined ? { ok: true } : r; }
    catch (e) { return { error: (e instanceof WErr || (e && e.user)) ? e.message : L("Unexpected error: ", "Váratlan hiba: ") + (e && e.message || e) }; }
  };
  return api;
})();
window.pywebview = { api: KesuApi };
