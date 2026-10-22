import assert from 'node:assert/strict';
import http from 'node:http';
import { createProxy, parseTarget, ALLOWED_ORIGINS } from '../tools/ai-local-proxy.mjs';

// Synthetic software test: a local mock "relay" with no CORS support stands in for a real upstream.
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const seen = [];
const upstream = http.createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c; });
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, origin: req.headers.origin, cookie: req.headers.cookie, body });
    if (req.method === 'OPTIONS') { res.writeHead(403).end(); return; } // 与真实中转站一致：不支持跨域预检
    if (req.url === '/v1/slow') { setTimeout(() => res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"slow":true}'), 300); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'upstream=1' }).end(JSON.stringify({ choices: [{ message: { content: 'ok' } }], echo: JSON.parse(body || '{}') }));
  });
});
const upstreamPort = await listen(upstream);
const logs = [];
const proxy = createProxy({ target: `http://127.0.0.1:${upstreamPort}/v1/`, allowLocalTarget: true, log: line => logs.push(line) });
const port = await listen(proxy);
const base = `http://127.0.0.1:${port}`, origin = 'https://xiaochuan1989.github.io';

// 上游地址校验：须为 HTTP(S)、不含账号/查询参数，正常使用时不能指向本机（避免转发回自己）。
assert.equal(parseTarget('https://relay.example.com/v1/').href, 'https://relay.example.com/v1');
assert.throws(() => parseTarget('ftp://relay.example.com'), /HTTP\(S\)/);
assert.throws(() => parseTarget('https://u:p@relay.example.com/v1'), /账号/);
assert.throws(() => parseTarget('https://relay.example.com/v1?key=1'), /查询参数/);
assert.throws(() => parseTarget('http://127.0.0.1:8787'), /本机/);
assert(ALLOWED_ORIGINS.includes(origin));

// 浏览器预检：本机直接应答（不打扰上游），允许本工具网页、私有网络访问与所需请求头。
const pre = await fetch(`${base}/chat/completions`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type', 'Access-Control-Request-Private-Network': 'true' } });
assert.equal(pre.status, 204);
assert.equal(pre.headers.get('access-control-allow-origin'), origin);
assert.equal(pre.headers.get('access-control-allow-private-network'), 'true');
assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);
assert.equal(seen.length, 0, '预检不转发给上游');

// 正式请求：路径拼到上游 Base URL 之后，Key 与正文原样转发；不转发浏览器来源与 Cookie；响应带回跨域头，不回传上游 Cookie。
const body = { model: 'synthetic-model', messages: [{ role: 'user', content: '合成测试' }] };
const res = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { Origin: origin, Authorization: 'Bearer sk-synthetic', 'Content-Type': 'application/json', Cookie: 'site=1' }, body: JSON.stringify(body) });
assert.equal(res.status, 200);
assert.equal(res.headers.get('access-control-allow-origin'), origin);
assert.equal(res.headers.get('set-cookie'), null);
assert.deepEqual((await res.json()).echo, body);
assert.equal(seen[0].url, '/v1/chat/completions');
assert.equal(seen[0].auth, 'Bearer sk-synthetic');
assert.equal(seen[0].origin, undefined, '上游看不到浏览器来源，不触发跨域');
assert.equal(seen[0].cookie, undefined);

// 其他网站不能借用本机转发；无来源的请求只能看状态；带查询参数的路径拒绝。
const evil = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { Origin: 'https://evil.example.com', 'Content-Type': 'application/json' }, body: '{}' });
assert.equal(evil.status, 403);
assert.equal(evil.headers.get('access-control-allow-origin'), null);
assert.equal((await fetch(`${base}/chat/completions`, { method: 'POST', body: '{}' })).status, 403);
const status = await (await fetch(`${base}/__status`)).json();
assert.equal(status.ok, true); assert.match(status.target, new RegExp(`127\\.0\\.0\\.1:${upstreamPort}/v1$`));
assert.equal((await fetch(`${base}/chat/completions?x=1`, { method: 'POST', headers: { Origin: origin }, body: '{}' })).status, 400);
assert.equal(seen.length, 1, '被拒请求都没有到达上游');

// 慢响应照常返回（不设超时）；上游不可达时返回可读的 502 错误，而不是让网页卡住。
assert.deepEqual(await (await fetch(`${base}/slow`, { headers: { Origin: origin } })).json(), { slow: true });
const dead = createProxy({ target: 'http://127.0.0.1:1/v1', allowLocalTarget: true });
const deadPort = await listen(dead);
const bad = await fetch(`http://127.0.0.1:${deadPort}/chat/completions`, { method: 'POST', headers: { Origin: origin }, body: '{}' });
assert.equal(bad.status, 502);
assert.equal(bad.headers.get('access-control-allow-origin'), origin, '错误也带跨域头，网页能读到原因');
assert.match((await bad.json()).error.message, /本机转发连接上游失败/);

// 网页侧提示：网络层失败给出可操作原因（直连→建议本机转发；本机转发→检查窗口与本地网络权限）；其他 TypeError 原样抛出。
{
  const { requestSpecJson, specConnectionHint } = await import('../src/modules/spec-ai-client.js');
  const cfg = baseUrl => ({ model: 'synthetic', apiKey: 'sk-synthetic', baseUrl, anthropic: false });
  const call = (baseUrl, error) => requestSpecJson(cfg(baseUrl), { system: 's', user: 'u' }, async () => { throw error; });
  await assert.rejects(() => call('https://relay.example.com/v1', new TypeError('Failed to fetch')), /start-ai-proxy\.cmd.*127\.0\.0\.1:8787/);
  await assert.rejects(() => call('http://127.0.0.1:8787', new TypeError('NetworkError when attempting to fetch resource.')), /无法连接本机转发/);
  await assert.rejects(() => call('https://relay.example.com/v1', new TypeError("Cannot read properties of undefined (reading '0')")), /Cannot read properties/);
  assert.match(specConnectionHint('https://api.deepseek.com'), /网络\/代理\/DNS.*代理例外/);
  assert.doesNotMatch(specConnectionHint('https://api.deepseek.com'), /start-ai-proxy/, 'DeepSeek官方支持跨域，不引导开中转转发');
}
// 日志不含 Key 与正文。
assert(logs.length >= 5 && logs.every(l => !l.includes('sk-synthetic') && !l.includes('合成测试')));
await Promise.all([proxy, upstream, dead].map(s => new Promise(r => s.close(r))));
console.log('AI本机转发：上游校验、预检本机应答与私有网络、请求转发与来源剥离、来源白名单、慢响应与上游故障、日志脱敏通过（合成软件用例）');
