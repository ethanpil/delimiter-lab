/* What the engine needs from Node.
 *
 * The engine reads bytes out of a file, parses delimited text, reads workbooks and says what it is
 * doing. In a browser worker those come from FileReaderSync and from scripts that the worker loads.
 * Here they come from the file system and from the same two libraries that the page uses, so that
 * the two platforms read a file the same way, down to the version of the parser.
 */
import { DL } from '@engine';
import * as fs from 'node:fs';
import * as v8 from 'node:v8';
import Papa from '../../../vendor/papaparse.min.js';
import * as XLSX from '../../../vendor/xlsx.full.min.js';

/* A file, in the shape the engine expects: a size, a name and slice(). The engine only ever asks
 * for bytes through DL.platform.readBuffer, so the bytes can live wherever this class puts them. */
export class NodeFile {
  buf: Uint8Array;
  name: string;
  size: number;
  lastModified: number;
  constructor(buf: Uint8Array, name: string, lastModified: number) {
    this.buf = buf;
    this.name = name;
    this.size = buf.length;
    this.lastModified = lastModified;
  }
  slice(start: number, end?: number) {
    return new NodeFile(this.buf.subarray(start, end), this.name, this.lastModified);
  }
}

export function openFile(path: string): NodeFile {
  const stat = fs.statSync(path);
  const buf = fs.readFileSync(path);
  // Only the name of the file, never the way to it. Windows divides a path with a backslash, and
  // the name can reach the answer itself, in the Source file column and in every note.
  const name = path.split(/[\\/]/).pop() || path;
  return new NodeFile(buf, name, stat.mtimeMs);
}

// How many values the engine may hold. The page asks the browser how much memory the machine has;
// here the answer comes from the heap that this runtime allows itself, at about 128 bytes for a
// value. Without this the command would keep the limit that the engine starts with, which is a
// limit for a browser, and would refuse files that the page reads without trouble.
function cellBudget(): number {
  let limit = 4e9; // what a 64-bit runtime usually allows itself
  try { limit = v8.getHeapStatistics().heap_size_limit || limit; } catch (e) { /* keep the number above */ }
  return Math.max(8e6, Math.floor(limit / 128));
}

export function installPlatform() {
  DL.platform.readBuffer = function (file: NodeFile) {
    return file.buf.buffer.slice(file.buf.byteOffset, file.buf.byteOffset + file.buf.length);
  };
  DL.platform.papa = Papa;
  DL.platform.xlsx = function () { return XLSX; };
  DL.maxCells = cellBudget();
}
