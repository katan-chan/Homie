import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const root = new URL('../../', import.meta.url);

// Exercise the browser's module loader and real editor DOM, without a DOM mock.
export async function withBrowser(callback, assetRoot = root, { origin } = {}) {
  const chrome = process.env.CHROME_PATH || [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  ].find(existsSync);
  assert.ok(chrome, 'Install Chromium/Chrome or set CHROME_PATH for the real editor proof');
  const profile = await mkdtemp(resolve(tmpdir(), 'homie-notes-chrome-'));
  const requests = [];
  const server = createServer(async (req, res) => {
    requests.push(req.url);
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<!doctype html><html lang="vi"><body></body></html>');
    } else if (req.url === '/assets/vendor/notes.js') {
      try {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(await readFile(new URL('assets/vendor/notes.js', assetRoot)));
      } catch {
        res.writeHead(404).end();
      }
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const browser = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const browserTerminated = new Promise(resolveExit => {
    browser.once('exit', resolveExit);
    browser.once('error', resolveExit);
  });
  let browserLog = '';
  browser.stderr.on('data', chunk => { browserLog += chunk; });
  let ws;
  try {
    let startupTimer;
    const endpoint = await new Promise((resolveEndpoint, reject) => {
      startupTimer = setTimeout(() => reject(Error(`Chrome startup timed out: ${browserLog}`)), 15000);
      browser.once('error', reject);
      browser.once('exit', (code, signal) => reject(Error(`Chrome exited during startup (${signal || code}): ${browserLog}`)));
      browser.stderr.on('data', () => {
        const match = browserLog.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) resolveEndpoint(match[1]);
      });
    }).finally(() => clearTimeout(startupTimer));
    const debugOrigin = new URL(endpoint).origin.replace('ws:', 'http:');
    const targets = await (await fetch(`${debugOrigin}/json/list`)).json();
    ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolveOpen, reject) => {
      ws.addEventListener('open', resolveOpen, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    let serial = 0;
    const pending = new Map();
    ws.addEventListener('message', event => {
      const response = JSON.parse(event.data);
      if (!response.id) return;
      const request = pending.get(response.id);
      pending.delete(response.id);
      response.error ? request.reject(Error(response.error.message)) : request.resolve(response.result);
    });
    const call = (method, params = {}) => new Promise((resolveCall, reject) => {
      const id = ++serial;
      pending.set(id, { resolve: resolveCall, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
    await call('Page.enable');
    const loaded = new Promise(resolveLoad => ws.addEventListener('message', event => {
      if (JSON.parse(event.data).method === 'Page.loadEventFired') resolveLoad();
    }));
    await call('Page.navigate', { url: (origin || `http://127.0.0.1:${server.address().port}`) + "/" });
    await loaded;
    const evaluate = async expression => {
      const evaluation = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      assert.equal(evaluation.exceptionDetails, undefined,
        evaluation.exceptionDetails?.exception?.description || evaluation.exceptionDetails?.text);
      return evaluation.result.value;
    };
    const result = await callback(evaluate, { call, origin: origin || `http://127.0.0.1:${server.address().port}` });
    if (!origin) assert.ok(requests.includes('/assets/vendor/notes.js'), 'The vendor module was loaded over local HTTP');
    return result;
  } finally {
    ws?.close();
    browser.kill();
    await browserTerminated;
    await new Promise(resolveClose => server.close(resolveClose));
    await rm(profile, { recursive: true, force: true, maxRetries: 5 });
  }
}

