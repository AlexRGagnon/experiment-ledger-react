import { resolve } from 'node:path';
import { Ledger } from './store.js';
import { createApp } from './app.js';
const port = Number(process.env.LEDGER_PORT ?? 8784);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('LEDGER_PORT must be 1..65535');
const ledger = new Ledger(process.env.LEDGER_DB ?? 'data/ledger.sqlite');
const server = createApp(ledger, resolve('dist/client'));
server.on('error', (error) => {
  console.error(error.message);
  ledger.close();
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`Experiment Ledger: http://127.0.0.1:${port}`));
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  server.close(() => ledger.close());
  server.closeIdleConnections();
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
