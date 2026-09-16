/**
 * Read the whole of stdin as UTF-8.
 *
 * Shared by every command that takes a value off a pipe rather than a flag —
 * a secret's value, a file of assistant instructions — so the value never
 * lands in shell history. Callers decide about whitespace: a secret is
 * trimmed, a document is not.
 */
export function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}
