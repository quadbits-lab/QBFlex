#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkPackage, filesIn, sha256 } from './check-package.mjs';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function pack(directory, output) {
  checkPackage(directory);
  const root = resolve(directory),
    destination = resolve(output);
  if (destination.startsWith(root + '/'))
    throw new Error('Archive output must be outside the skill directory');
  const local = [],
    central = [];
  let offset = 0;
  for (const file of filesIn(root)) {
    const name = Buffer.from('qbflex-skills/' + file),
      bytes = readFileSync(resolve(root, file)),
      crc = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, bytes);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8);
    record.writeUInt16LE(33, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(bytes.length, 20);
    record.writeUInt32LE(bytes.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + bytes.length;
  }
  const directoryBytes = Buffer.concat(central),
    end = Buffer.alloc(22),
    count = central.length / 2;
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  const archive = Buffer.concat([...local, directoryBytes, end]);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, archive);
  return { files: count, bytes: archive.length, sha256: sha256(archive) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    if (!process.argv[2] || !process.argv[3])
      throw new Error('Use pack.mjs <skill-directory> <output.zip>');
    console.log(JSON.stringify(pack(process.argv[2], process.argv[3])));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
