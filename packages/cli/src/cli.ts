/* The entry point of the dl command. The build puts the line that names the runner at the top. */
import { main } from './main.js';

main(process.argv.slice(2)).catch(function (e: any) {
  process.stderr.write('dl: ' + (e && e.message ? e.message : String(e)) + '\n');
  process.exit(1);
});
