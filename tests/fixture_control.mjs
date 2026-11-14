// A native harness's channel to its fixture (tests/fixtures/ui_http.py): one JSON request per line on the fixture's
// stdin, one answer per line on its stdout, matched by id. Once the fixture has exited, every request still open and
// every later one is refused with how it ended, so a harness whose fixture died fails its next step, closes its
// browsers and writes its evidence, instead of waiting forever on an answer nobody will send.
import { createInterface } from 'node:readline';

export function fixtureControl(fixture) {
  let serial = 0, errors = '', ended = null;
  const requests = new Map();
  fixture.stderr.on('data', data => { errors += data; });
  // A write the fixture can no longer read: it has died, and its exit says how.
  fixture.stdin.on('error', error => { errors += `stdin: ${error.message}\n`; });
  createInterface({ input: fixture.stdout }).on('line', line => {
    // Node can report the exit before the last lines are read: their requests were refused at exit, and the
    // last line may be cut short by the death, so a line read after the exit is dropped.
    if (ended) return;
    const result = JSON.parse(line), request = requests.get(result.id); requests.delete(result.id);
    if (!request) throw Error(`The fixture answered request ${result.id}, which was never asked: ${line}`);
    if (result.failure) request.reject(Error(result.failure)); else request.resolve(result.answer);
  });
  // How the fixture ended, held from its launch: its exit code, or the signal that ended it.
  const exit = new Promise(resolve => fixture.once('exit', (code, signal) => {
    ended = () => Error(`Fixture exited ${code ?? signal}: ${errors}`);
    for (const request of requests.values()) request.reject(ended());
    requests.clear();
    resolve({ code, signal });
  }));
  const control = data => new Promise((resolve, reject) => {
    if (ended) { reject(ended()); return; }
    const id = ++serial; requests.set(id, { resolve, reject });
    fixture.stdin.write(JSON.stringify({ ...data, id }) + '\n');
  });
  return { control, exit, errors: () => errors };
}
