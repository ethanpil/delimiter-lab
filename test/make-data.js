/* Generates test data files in test/data. Run: node test/make-data.js [bigRows] */
'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'data');
fs.mkdirSync(dir, { recursive: true });

// 1. Small messy contacts file (UTF-8 with BOM, CRLF).
const contacts = '﻿' + [
  'Full Name,Email,City,Amount,Signup Date,Status,Notes',
  'dr. john a. smith jr.,John.Smith@example.com,new york,"1,250.50",2024-01-15,active,"Says ""hi"", often"',
  '"Doe, Jane",jane@example.com,  Boston ,89,02/03/2024,Active,',
  'maría garcía,maria@example,Madrid,"2.300,75",2023-12-01,inactive,Ñandú',
  'Ludwig van Beethoven,ludwig@example.org,Bonn,,1827-03-26,active,"multi',
  'line note"',
  'dr. john a. smith jr.,John.Smith@example.com,new york,"1,250.50",2024-01-15,active,dup',
  'Li Wei,li.wei@example.cn,Shanghai,15000,2024-05-20,pending,中文',
  'Amara Okafor,amara@example.com,Lagos,-45,2024-06-30,active,',
  "Sam O'Neil,sam@example.com,Dublin,120,not a date,ACTIVE,",
  ',,,,,,',
  'Zoë  Müller,zoe@example.de,Köln,1e3,2024-07-04,active,émoji 🎉'
].join('\r\n') + '\r\n';
fs.writeFileSync(path.join(dir, 'contacts.csv'), contacts, 'utf8');

// 2. Malformed: ragged rows, unbalanced quote, blank lines, mixed line endings, extra columns.
const malformed = [
  'id,name,value',
  '1,alpha,10',
  '2,"beta,20',
  '3,gamma',
  '',
  '4,delta,40,extra,more',
  '   ',
  '5,"epsilon ""quoted""",50\r',
  '6,zeta,60'
].join('\n') + '\n';
fs.writeFileSync(path.join(dir, 'malformed.csv'), malformed, 'utf8');

// 3. European semicolon file in Windows-1252 (latin1 bytes).
const euro = [
  'Kunde;Stadt;Betrag;Datum',
  'Müller;München;1.234,56;31.12.2023',
  'Schäfer;Köln;99,90;01.01.2024',
  'Øyvind;Tromsø;-12,00;15.06.2024',
  'Dupont;Paris;"1.000.000,00";29.02.2024'
].join('\r\n') + '\r\n';
fs.writeFileSync(path.join(dir, 'euro-1252.csv'), Buffer.from(euro, 'latin1'));

// 4. TSV without header row.
const tsv = ['a\t1\tx', 'b\t2\ty', 'c\t3\tz'].join('\n');
fs.writeFileSync(path.join(dir, 'noheader.tsv'), tsv, 'utf8');

// 5. UTF-16LE with BOM.
fs.writeFileSync(path.join(dir, 'utf16.csv'), Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('name,city\nÅsa,Göteborg\nJosé,São Paulo\n', 'utf16le')]));

// 6. Pipe delimited with a title line before the header.
fs.writeFileSync(path.join(dir, 'pipes.txt'), 'Report generated 2024-01-01\n\nsku|qty|price\nA1|3|9.99\nB2|0|12.50\n', 'utf8');

// 7. Excel workbook with two sheets.
const XLSX = require('../vendor/xlsx.full.min.js');
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['Product', 'Qty', 'Price', 'Date'],
  ['Widget', 3, 9.99, new Date(2024, 0, 15)],
  ['Gadget', 10, 1234.5, new Date(2024, 1, 29)],
  ['', null, 0, null],
  ['Ünïcode', 1, 0.5, new Date(2023, 11, 31)]
]), 'Orders');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['Code', 'Region'], ['N', 'North'], ['S', 'South']
]), 'Lookup');
fs.writeFileSync(path.join(dir, 'workbook.xlsx'), Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })));

// 8. Big file.
const bigRows = parseInt(process.argv[2], 10) || 300000;
const first = ['john', 'JANE', 'maría', 'Li', 'Amara', 'Sam', 'Zoë', 'Ludwig'];
const last = ['smith', 'DOE', 'garcía', 'Wei', 'Okafor', "O'Neil", 'Müller', 'van Beethoven'];
const cities = ['New York', 'Boston', 'Madrid', 'Shanghai', 'Lagos', 'Dublin', 'Köln', 'Bonn'];
const status = ['active', 'Active', 'inactive', 'pending', ''];
const out = fs.createWriteStream(path.join(dir, 'big.csv'));
out.write('id,first,last,email,city,amount,date,status,score,notes\n');
let seed = 42;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
let buf = '';
for (let i = 0; i < bigRows; i++) {
  const f = first[i % first.length], l = last[Math.floor(rnd() * last.length)];
  const amount = rnd() < 0.02 ? '' : (rnd() * 10000 - 500).toFixed(2);
  const date = '20' + String(20 + Math.floor(rnd() * 5)).padStart(2, '0') + '-' + String(1 + Math.floor(rnd() * 12)).padStart(2, '0') + '-' + String(1 + Math.floor(rnd() * 28)).padStart(2, '0');
  const score = rnd() < 0.001 ? (rnd() * 100000).toFixed(0) : (rnd() * 100).toFixed(0);
  const notes = rnd() < 0.05 ? '"has, comma and ""quote"""' : '';
  buf += [i + 1, f, l, (f + '.' + l + i + '@example.com').toLowerCase().replace(/[^a-z0-9@.]/g, ''), cities[i % cities.length], amount, date, status[Math.floor(rnd() * status.length)], score, notes].join(',') + '\n';
  if (buf.length > 1 << 20) { out.write(buf); buf = ''; }
}
out.write(buf);
out.end(() => {
  const size = fs.statSync(path.join(dir, 'big.csv')).size;
  console.log('Wrote test data. big.csv: ' + bigRows + ' rows, ' + (size / 1048576).toFixed(1) + ' MB');
});
