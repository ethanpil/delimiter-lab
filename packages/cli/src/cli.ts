/* The entry point of the dl command. The build puts the line that names the runner at the top. */
import { main } from './main.js';

// A reader such as head or less closes the pipe as soon as it has enough. Writing to a closed pipe
// is not a fault of this command, so it stops quietly in place of showing the inside of the runtime.
process.stdout.on('error', function (e: any) {
  if (e && (e.code === 'EPIPE' || e.code === 'ERR_STREAM_DESTROYED')) process.exit(0);
  process.stderr.write('dl: ' + (e && e.message ? e.message : String(e)) + '\n');
  process.exit(1);
});

main(process.argv.slice(2)).catch(function (e: any) {
  process.stderr.write('dl: ' + (e && e.message ? e.message : String(e)) + '\n');
  process.exit(1);
});
