// backend/server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { spawn } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json());

// where recordings are stored
const RECORD_DIR = path.join(__dirname, '../runner/recordings');
if (!fs.existsSync(RECORD_DIR)) fs.mkdirSync(RECORD_DIR, { recursive: true });

// where runner/target jars live
const RUNNER_TARGET = path.join(__dirname, '../runner/target');

// helper: find a sensible jar to run
function findRunnerJar() {
  try {
    if (!fs.existsSync(RUNNER_TARGET)) return null;
    const files = fs.readdirSync(RUNNER_TARGET).filter(f => f.endsWith('.jar'));
    if (files.length === 0) return null;

    // prefer jar-with-dependencies
    let found = files.find(f => f.includes('jar-with-dependencies'));
    if (found) return path.join(RUNNER_TARGET, found);

    // fallback: prefer one that includes 'record' or 'runner'
    found = files.find(f => /record|runner/i.test(f));
    if (found) return path.join(RUNNER_TARGET, found);

    // else return the first jar
    return path.join(RUNNER_TARGET, files[0]);
  } catch (e) {
    console.error('[server] findRunnerJar error', e);
    return null;
  }
}

// helper: normalize POST /save payload formats (array, {actions:[]}, or {startUrl, actions})
function extractActionsAndMeta(body) {
  let actions = null;
  let startUrl = null;

  if (!body) return null;

  if (Array.isArray(body)) {
    actions = body;
    return { actions, startUrl: null };
  }

  if (typeof body === 'object') {
    if (Array.isArray(body.actions)) {
      actions = body.actions;
      if (body.startUrl) startUrl = body.startUrl;
      return { actions, startUrl };
    }
    // sometimes actions come as JSON string
    if (typeof body.actions === 'string') {
      try {
        const parsed = JSON.parse(body.actions);
        if (Array.isArray(parsed)) {
          actions = parsed;
          if (body.startUrl) startUrl = body.startUrl;
          return { actions, startUrl };
        }
      } catch (e) {
        // ignore parse error
      }
    }
  }

  return null;
}

// Save endpoint: saves as { startUrl:..., actions: [...] }
app.post('/save', (req, res) => {
  try {
    const incoming = extractActionsAndMeta(req.body);
    if (!incoming || !incoming.actions) {
      return res.status(400).json({ ok: false, error: 'Invalid payload. Expected array or { startUrl, actions: [...] }' });
    }
    const { actions, startUrl } = incoming;
    const name = 'recording-' + Date.now() + '.json';
    const filepath = path.join(RECORD_DIR, name);

    const output = {
      startUrl: startUrl || null,
      actions: actions
    };

    fs.writeFileSync(filepath, JSON.stringify(output, null, 2), 'utf8');
    console.log(`[server] Saved ${name} (${actions.length} actions) startUrl=${startUrl || '<<none>>'}`);
    return res.json({ ok: true, name });
  } catch (err) {
    console.error('[server] save error', err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get('/recordings', (req, res) => {
  try {
    const files = fs.readdirSync(RECORD_DIR).filter(f => f.endsWith('.json'));
    return res.json(files);
  } catch (err) {
    console.error('[server] list error', err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// Run a recording via the Java runner.
// Body: { file: "recording-....json", mode?: "local"|"remote" } 
app.post('/run', (req, res) => {
  const file = req.body.file;
  const mode = req.body.mode || 'local'; // default remote (uses -DremoteUrl)
  if (!file) return res.status(400).json({ ok: false, error: 'file field missing' });

  const jarPath = findRunnerJar();
  if (!jarPath) {
    // list files for diagnostics
    let targetFiles = [];
    try { targetFiles = fs.existsSync(RUNNER_TARGET) ? fs.readdirSync(RUNNER_TARGET).filter(f => f.endsWith('.jar')) : []; } catch(e){}
    return res.status(500).json({
      ok: false,
      error: 'Runner JAR missing — run mvn -U clean package in runner folder',
      diagnostics: { RUNNER_TARGET, jars: targetFiles }
    });
  }

  const recordingFile = path.join(RECORD_DIR, file);
  if (!fs.existsSync(recordingFile)) {
    return res.status(400).json({ ok: false, error: 'Recording not found: ' + file });
  }

  // ensure logs dir exists (optional; runner may use it)
  const logsDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  // Build command args
  const args = [
    `-DlogDir=${logsDir}`,
    `-jar`, jarPath,
    recordingFile,
    mode,
    'false' // headless false (keeps same signature)
  ];

  // If remote mode ensure remoteUrl env is set via -DremoteUrl system property. We'll still default to localhost:4444
  const remoteUrl = process.env.REMOTE_URL || 'http://localhost:4444';
  args.unshift(`-DremoteUrl=${remoteUrl}`);
  args.unshift(`-Dbrowser=chrome`); // second system property

  console.log('[server] running jar:', jarPath, ' recording:', recordingFile, 'mode:', mode);

  // spawn java to stream logs
  const child = spawn('java', args, { env: process.env });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (data) => {
    const s = data.toString();
    stdout += s;
    process.stdout.write('[runner stdout] ' + s);
  });

  child.stderr.on('data', (data) => {
    const s = data.toString();
    stderr += s;
    process.stderr.write('[runner stderr] ' + s);
  });

  child.on('close', (code) => {
    console.log(`[server] runner exited code=${code}`);
    return res.json({ ok: code === 0, exitCode: code, stdout, stderr });
  });

  child.on('error', (err) => {
    console.error('[server] spawn error', err);
    return res.status(500).json({ ok: false, error: String(err) });
  });

  // respond later when child closes — keep request open
});

// health
app.get('/ping', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[server] Backend running at http://localhost:${PORT}`));