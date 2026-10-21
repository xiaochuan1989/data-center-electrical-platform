#!/usr/bin/env node
// 本机 AI 接口转发：网页受浏览器跨域限制，不能直接调用不支持跨域的 OpenAI 兼容中转接口；
// 桌面程序（Codex 等）不受此限制。本程序在本机转发请求，让网页也能使用这类接口。
// 安全边界：只监听 127.0.0.1；只转发到启动时指定的一个上游地址；只允许本工具网页的来源调用；不记录 Key 与请求内容。
// 用法：node tools/ai-local-proxy.mjs --target https://中转站/v1 [--port 8787]
// 网页"设置"里 Base URL 改为 http://127.0.0.1:8787（原来填在 Base URL 的地址交给 --target）。
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ALLOWED_ORIGINS = Object.freeze(['https://xiaochuan1989.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:8080', 'http://127.0.0.1:8080']);
const FORWARD_HEADERS = ['authorization', 'content-type', 'accept', 'x-api-key', 'anthropic-version', 'anthropic-dangerous-direct-browser-access'];

export function parseTarget(value, { allowLocal = false } = {}) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('上游地址无效，例如 https://中转站/v1'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('上游地址须为不含账号、查询参数或片段的 HTTP(S) 地址');
  if (!allowLocal && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) throw new Error('上游地址不能指向本机，避免转发回自己');
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}

export function createProxy({ target, allowedOrigins = ALLOWED_ORIGINS, log = () => {}, allowLocalTarget = false }) {
  const upstreamBase = parseTarget(target, { allowLocal: allowLocalTarget }); // allowLocalTarget 仅供自动化测试
  const client = upstreamBase.protocol === 'https:' ? https : http;
  const server = http.createServer((req, res) => {
    const started = Date.now(), origin = req.headers.origin;
    const cors = origin && allowedOrigins.includes(origin) ? {
      'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': FORWARD_HEADERS.join(', '), 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600' } : {};
    const done = status => log(`${new Date().toLocaleTimeString()} ${req.method} ${req.url.split('?')[0]} → ${status} ${Date.now() - started}ms`);
    // 浏览器来源必须在白名单内；无来源（如命令行自测）只允许查看状态。
    if (origin && !allowedOrigins.includes(origin)) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('来源不在允许列表'); return done(403); }
    if (req.method === 'OPTIONS') { res.writeHead(204, cors).end(); return done(204); }
    if (req.method === 'GET' && (req.url === '/' || req.url === '/__status')) {
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ ok: true, target: upstreamBase.href }));
      return done(200);
    }
    if (!origin) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('仅供本工具网页调用'); return done(403); }
    if (!['GET', 'POST'].includes(req.method)) { res.writeHead(405, cors).end(); return done(405); }
    const incoming = new URL(req.url, 'http://127.0.0.1');
    if (incoming.search) { res.writeHead(400, cors).end(); return done(400); }
    const upstream = new URL(upstreamBase.href);
    upstream.pathname = upstreamBase.pathname + incoming.pathname;
    const headers = Object.fromEntries(FORWARD_HEADERS.filter(h => req.headers[h]).map(h => [h, req.headers[h]]));
    const forward = client.request(upstream, { method: req.method, headers }, upstreamRes => {
      const pass = Object.fromEntries(['content-type', 'cache-control'].filter(h => upstreamRes.headers[h]).map(h => [h, upstreamRes.headers[h]]));
      res.writeHead(upstreamRes.statusCode || 502, { ...pass, ...cors });
      upstreamRes.pipe(res);
      upstreamRes.on('end', () => done(upstreamRes.statusCode));
    });
    // 规范书整理单次请求可能数分钟：不设超时；网页取消或关闭时中止上游请求。
    forward.on('error', error => { if (!res.headersSent) res.writeHead(502, { ...cors, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { message: `本机转发连接上游失败：${error.code || error.message}` } })); done(502); });
    res.on('close', () => { if (!res.writableFinished) forward.destroy(); });
    req.pipe(forward);
  });
  server.requestTimeout = 0; server.headersTimeout = 60000;
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2), get = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const configPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ai-local-proxy.config.json');
  let config = {};
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { /* 首次运行没有配置 */ }
  const target = get('--target') || config.target, port = Number(get('--port') || config.port || 8787);
  if (!target) { console.error('缺少上游地址。用法：node tools/ai-local-proxy.mjs --target https://中转站/v1 [--port 8787]'); process.exit(2); }
  let parsed;
  try { parsed = parseTarget(target); } catch (error) { console.error(error.message); process.exit(2); }
  if (get('--target')) fs.writeFileSync(configPath, JSON.stringify({ target: parsed.href, port }, null, 2));
  const server = createProxy({ target: parsed.href, log: line => console.log(line) });
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，可能转发程序已在运行；或用 --port 换一个端口` : error.message); process.exit(1); });
  server.listen(port, '127.0.0.1', () => {
    console.log(`AI 本机转发已启动：http://127.0.0.1:${port}  →  ${parsed.href}`);
    console.log(`网页"设置"里的 Base URL 填：http://127.0.0.1:${port}`);
    console.log('使用期间请保持本窗口打开；关闭窗口即停止转发。日志只记录时间、路径与状态，不记录 Key 和内容。');
    console.log('若 Chrome 弹出"允许访问本地网络/本地设备"，请选择允许。更换中转地址：删除同目录 ai-local-proxy.config.json 后重新运行。');
  });
}
