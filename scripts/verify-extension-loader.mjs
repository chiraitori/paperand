import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9337;
const profile = await mkdtemp(path.join(tmpdir(), 'paperand-loader-'));
const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

const endpoint = `http://127.0.0.1:${port}`;
const waitForChrome = async () => {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Chrome DevTools endpoint did not start');
};

try {
  await waitForChrome();

  const source = await readFile(new URL('../src/components/ExtensionRunner.tsx', import.meta.url), 'utf8');
  const templateStart = source.indexOf('const webViewHtml =');
  const quote = String.fromCharCode(96);
  const htmlStart = source.indexOf(quote, templateStart) + 1;
  const htmlEnd = source.indexOf(`${quote};`, htmlStart);
  let html = source.slice(htmlStart, htmlEnd).replaceAll('\\\\', '\\');
  html = html.replace(/<script src="[^"]*cheerio[^>]*><\/script>/i, '');

  const ehentaiBundle = await fetch(
    'https://chiraitori.github.io/paperback-extensions/main/EHentai/source.js'
  ).then(response => {
    if (!response.ok) throw new Error(`Could not download E-Hentai fixture: HTTP ${response.status}`);
    return response.text();
  });

  const bridgeStub = `<script>
    window.ReactNativeWebView = { postMessage(value) {
      const message = JSON.parse(value);
      if (message.requestId === 9001) {
        if (message.error) document.title = 'FAIL:' + message.error;
        else window.handleMessage(JSON.stringify({
          type: 'runMethod', requestId: 9002,
          extensionId: 'LegacyMetadataId', method: 'ping', args: []
        }));
      } else if (message.requestId === 9002) {
        if (message.error || !message.result || message.result.ok !== true) {
          document.title = 'FAIL:' + (message.error || JSON.stringify(message.result));
        } else {
          window.handleMessage(JSON.stringify({
            type: 'loadExtension', requestId: 9003,
            extensionId: 'EHentai', sourceJs: window.__ehentaiBundle,
            apiVersion: '0.8', initialState: {}
          }));
        }
      } else if (message.requestId === 9003) {
        if (message.error) document.title = 'FAIL:E-Hentai:' + message.error;
        else window.handleMessage(JSON.stringify({
          type: 'loadExtension', requestId: 9004,
          extensionId: 'Modern',
          sourceJs: 'var source={Modern:{initialise:async function(){}}};',
          apiVersion: '0.9', initialState: {}
        }));
      } else if (message.requestId === 9004) {
        document.title = message.error
          ? 'FAIL:Paperback-0.9:' + message.error
          : 'PASS:paperback-0.8+EHentai+paperback-0.9';
      }
    }};
    window.__ehentaiBundle = ${JSON.stringify(ehentaiBundle)};
  </script>`;
  html = html.replace('</head>', `${bridgeStub}</head>`);

  const testBundle = `window.Sources = {
    ActualExportName: class ActualExportName {
      async ping() { return { ok: true }; }
    }
  };`;
  const startTest = `<script>
    document.title = 'PENDING:paperback-0.8-loader';
    window.handleMessage(JSON.stringify({
      type: 'loadExtension', requestId: 9001,
      extensionId: 'LegacyMetadataId', sourceJs: ${JSON.stringify(testBundle)},
      apiVersion: '0.8', initialState: {}
    }));
  </script>`;
  const bodyEnd = html.lastIndexOf('</body>');
  html = `${html.slice(0, bodyEnd)}${startTest}${html.slice(bodyEnd)}`;

  const targetUrl = `data:text/html;base64,${Buffer.from(html).toString('base64')}`;
  const created = await fetch(`${endpoint}/json/new?${encodeURIComponent(targetUrl)}`, { method: 'PUT' });
  if (!created.ok) throw new Error(`Could not open test page: HTTP ${created.status}`);

  for (let attempt = 0; attempt < 100; attempt++) {
    const targets = await fetch(`${endpoint}/json/list`).then(response => response.json());
    const title = targets.map(target => target.title).find(value => /^(PASS|FAIL):/.test(value));
    if (title) {
      if (title.startsWith('FAIL:')) throw new Error(title);
      console.log(title);
      process.exitCode = 0;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    if (attempt === 99) {
      const titles = targets.map(target => target.title || '(untitled)').join(', ');
      throw new Error(`Timed out waiting for loader result; targets: ${titles}`);
    }
  }
} finally {
  chrome.kill();
  await Promise.race([
    once(chrome, 'exit'),
    new Promise(resolve => setTimeout(resolve, 2000)),
  ]);
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await rm(profile, { recursive: true, force: true });
      break;
    } catch (error) {
      if (error?.code !== 'EBUSY' || attempt === 9) throw error;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
}
