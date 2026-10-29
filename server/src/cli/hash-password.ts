import { Writable } from 'node:stream';
import readline from 'node:readline';
import { hashPassword } from '../auth/password.js';

// Scripted use: `printf '%s\n' "$PASSWORD" | node hash-password.js --stdin` reads one line and prints the hash.
if (process.argv.includes('--stdin')) {
  const first = await new Promise<string>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    // Resolve first: closing the reader fires 'close', whose handler would otherwise win with an empty answer.
    rl.once('line', (l) => { resolve(l); rl.close(); });
    rl.once('close', () => resolve(''));
  });
  if (first.length < 12) {
    console.error('Use at least 12 characters.');
    process.exit(1);
  }
  console.log(`ADMIN_PASSWORD_HASH=${await hashPassword(first)}`);
  process.exit(0);
}

// Prompt without echoing, so the password never lands in the terminal or shell history.
let muted = false;
const out = new Writable({
  write(chunk, _enc, cb) {
    if (!muted) process.stderr.write(chunk);
    cb();
  },
});
const rl = readline.createInterface({ input: process.stdin, output: out, terminal: true });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stderr.write(question);
    muted = true;
    rl.question('', (answer) => {
      muted = false;
      process.stderr.write('\n');
      resolve(answer);
    });
  });
}

const first = await ask('New admin password: ');
const second = await ask('Repeat password: ');
rl.close();

if (first.length < 12) {
  console.error('Use at least 12 characters.');
  process.exit(1);
}
if (first !== second) {
  console.error('Passwords do not match.');
  process.exit(1);
}
console.log(`ADMIN_PASSWORD_HASH=${await hashPassword(first)}`);
