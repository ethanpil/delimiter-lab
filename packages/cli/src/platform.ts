/* What the engine needs from Node.
 *
 * The engine reads bytes out of a file, parses delimited text, reads workbooks and says what it is
 * doing. In a browser worker those come from FileReaderSync and from scripts that the worker loads.
 * Here they come from the file system and from the same two libraries that the page uses, so that
 * the two platforms read a file the same way, down to the version of the parser.
 */
import { DL } from '@engine';
import * as fs from 'node:fs';
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
  const name = path.split(/[\/]/).pop() || path;
  return new NodeFile(buf, name, stat.mtimeMs);
}

export function installPlatform(onProgress?: (phase: string, percent: number) => void) {
  DL.platform.readBuffer = function (file: NodeFile) {
    return file.buf.buffer.slice(file.buf.byteOffset, file.buf.byteOffset + file.buf.length);
  };
  DL.platform.papa = Papa;
  DL.platform.xlsx = function () { return XLSX; };
  DL.platform.progress = function (phase: string, percent: number) {
    if (onProgress) onProgress(phase, percent);
  };
}
