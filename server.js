const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = Number(process.env.PORT || 3000);
const INDEX_PATH = path.join(__dirname, 'index.html');
const configuredBaseUrl = process.env.OPENAI_BASE_URL || process.env.ANTHROPIC_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_BASE_URL = normalizeBaseUrl(configuredBaseUrl);
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.5';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.API_KEY;

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      const html = fs.readFileSync(INDEX_PATH);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/chat') {
      if (!OPENAI_API_KEY) {
        writeJson(res, 500, { error: { message: '服务端缺少 OPENAI_API_KEY 或 ANTHROPIC_AUTH_TOKEN 环境变量。' } });
        return;
      }

      const payload = JSON.parse(await readBody(req) || '{}');
      const messages = normalizeMessages(payload.messages);
      if (!messages.length) {
        writeJson(res, 400, { error: { message: '消息列表不能为空。' } });
        return;
      }

      const upstream = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: buildMessages(payload.system, messages),
          stream: true
        })
      });

      if (!upstream.ok) {
        const raw = await upstream.text();
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
        writeJson(res, upstream.status, { error: { message: extractError(data) || `${upstream.status} ${upstream.statusText}` } });
        return;
      }

      await streamText(upstream, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (error) {
    writeJson(res, 500, { error: { message: error.message } });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`GPT 聊天网页已启动：${url}`);
  console.log(`同一 Wi-Fi 手机访问：http://你的电脑局域网IP:${PORT}`);
  if (process.env.OPEN_BROWSER === '1') openBrowser(url);
});

function openBrowser(url) {
  const command = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(command, () => {});
}

function normalizeBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || '').replace(/\/$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function writeJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((message) => ['system', 'user', 'assistant'].includes(message.role) && typeof message.content === 'string')
    .filter((message) => message.role !== 'system')
    .map((message) => ({ role: message.role, content: message.content }));
}

function buildMessages(system, messages) {
  const systemText = String(system || '').trim();
  return systemText ? [{ role: 'system', content: systemText }, ...messages] : messages;
}

function extractReply(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  if (data.choices?.[0]?.message?.content) return normalizeContent(data.choices[0].message.content);
  if (data.choices?.[0]?.text) return data.choices[0].text;
  if (typeof data.output_text === 'string') return data.output_text;
  if (typeof data.text === 'string') return data.text;
  if (typeof data.message === 'string') return data.message;
  return JSON.stringify(data, null, 2);
}

async function streamText(upstream, res) {
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of upstream.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const text = parseStreamLine(line);
      if (text) res.write(text);
    }
  }
  const remaining = decoder.decode();
  if (remaining) buffer += remaining;
  for (const line of buffer.split('\n')) {
    const text = parseStreamLine(line);
    if (text) res.write(text);
  }
  res.end();
}

function parseStreamLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed === 'data: [DONE]') return '';
  const jsonText = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
  try {
    const data = JSON.parse(jsonText);
    return data.choices?.[0]?.delta?.content || data.choices?.[0]?.text || data.output_text || '';
  } catch {
    return '';
  }
}

function normalizeContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => part.text || part.content || '').join('').trim();
  return JSON.stringify(content, null, 2);
}

function extractError(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  return data.error?.message || data.message || data.detail || '';
}
