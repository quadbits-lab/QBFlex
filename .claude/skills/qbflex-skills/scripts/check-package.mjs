#!/usr/bin/env node
import { readFileSync, readdirSync, lstatSync, existsSync, realpathSync } from 'node:fs';
import { resolve, relative, join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function filesIn(directory, base = directory) {
  const files = [];
  for (const entry of readdirSync(directory).sort()) {
    const file = join(directory, entry),
      stat = lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error('Bundle symlinks are not permitted');
    if (stat.isDirectory()) files.push(...filesIn(file, base));
    else if (stat.isFile()) files.push(relative(base, file).split(sep).join('/'));
  }
  return files.sort();
}
export function checkPackage(directory) {
  const root = resolve(directory),
    files = filesIn(root);
  const manifest = JSON.parse(readFileSync(join(root, 'MANIFEST.json'), 'utf8'));
  if (
    manifest.name !== 'qbflex-skills' ||
    manifest.version !== '0.1.0' ||
    manifest.productVersion !== '0.1.0' ||
    manifest.formatVersion !== 1 ||
    manifest.checksumAlgorithm !== 'sha256'
  )
    throw new Error('Invalid manifest metadata');
  if (
    !manifest.sources?.length ||
    !manifest.sources.every(
      (s) => !s.path.startsWith('/') && !s.path.includes('..') && /^[a-f0-9]{64}$/.test(s.sha256),
    )
  )
    throw new Error('Invalid source provenance');
  const actual = files.filter((f) => f !== 'MANIFEST.json'),
    expected = Object.keys(manifest.files).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error('Manifest file inventory mismatch');
  for (const file of actual) {
    if (sha256(readFileSync(join(root, file))) !== manifest.files[file])
      throw new Error(`Checksum mismatch: ${file}`);
    if (/(^|\/)(node_modules|dist|\.env|master\.key|bootstrap\.token)(\/|$)/.test(file))
      throw new Error(`Unsafe bundled file: ${file}`);
  }
  const entry = readFileSync(join(root, 'SKILL.md'), 'utf8');
  const front = entry.match(/^---\n([\s\S]*?)\n---\n/);
  if (
    !front ||
    !/^name: qbflex-skills$/m.test(front[1]) ||
    !/^description: .{30,1024}$/m.test(front[1]) ||
    !/^metadata:$/m.test(front[1]) ||
    !/^  version: "0.1.0"$/m.test(front[1])
  )
    throw new Error('Invalid Agent Skills frontmatter');
  const frontLines = front[1].split('\n').filter(Boolean);
  if (
    frontLines.length !== 6 ||
    frontLines.some(
      (line) =>
        !/^(name: qbflex-skills|description: .+|metadata:|  version: "0\.1\.0"|  product: "QB Flex"|  compatibility: "QB Flex 0\.1\.0")$/.test(
          line,
        ),
    )
  )
    throw new Error('Invalid or unsupported frontmatter fields');
  const metadata = readFileSync(join(root, 'agents/openai.yaml'), 'utf8');
  const description = metadata.match(/short_description: "([^"]+)"/);
  if (
    !/^interface:$/m.test(metadata) ||
    !/^  display_name: "[^"\n]+"$/m.test(metadata) ||
    !description ||
    description[1].length < 25 ||
    description[1].length > 64 ||
    !/default_prompt: "[^"\n]*\$qbflex-skills[^"\n]*"/.test(metadata) ||
    !/^  allow_implicit_invocation: true$/m.test(metadata)
  )
    throw new Error('Invalid Codex metadata');
  const metadataLines = metadata.split('\n').filter(Boolean);
  if (
    metadataLines.length !== 6 ||
    metadataLines.some(
      (line) =>
        !/^(interface:|policy:|  (display_name|short_description|default_prompt): "[^"\n]+"|  allow_implicit_invocation: true)$/.test(
          line,
        ),
    )
  )
    throw new Error('Invalid or unsupported Codex metadata fields');
  for (const file of files.filter((f) => /\.(md|mjs|tsx?|js|json|yaml|html|sql)$/.test(f))) {
    const text = readFileSync(join(root, file), 'utf8');
    if (/\/Users\/|\/home\/[A-Za-z0-9_.-]+\//.test(text))
      throw new Error(`Personal filesystem path: ${file}`);
    if (file.endsWith('.md')) {
      const prose = text.replace(/```[\s\S]*?```/g, '');
      for (const match of prose.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const href = match[1].split('#')[0];
        if (!href || /^(https?:|mailto:)/.test(href)) continue;
        const target = resolve(root, file, '..', decodeURIComponent(href));
        if (!target.startsWith(root + sep) || !existsSync(target))
          throw new Error(`Broken or external local link: ${file} -> ${href}`);
        const fragment = match[1].split('#')[1];
        if (fragment) {
          const headings = readFileSync(target, 'utf8').match(/^#{1,6} .+$/gm) ?? [];
          const slugs = headings.map((h) =>
            h
              .replace(/^#+ /, '')
              .toLowerCase()
              .replace(/[^\p{L}\p{N}\s-]/gu, '')
              .replace(/\s/g, '-'),
          );
          if (!slugs.includes(fragment))
            throw new Error(`Broken heading link: ${file} -> ${match[1]}`);
        }
      }
    }
  }
  for (const kind of ['react', 'vanilla']) {
    const pkg = JSON.parse(
      readFileSync(join(root, 'assets/examples', kind, 'package.json'), 'utf8'),
    );
    if (!pkg.private || pkg.type !== 'module' || JSON.stringify(pkg).includes('workspace:'))
      throw new Error('Non-portable example manifest');
  }
  return {
    name: manifest.name,
    version: manifest.version,
    files: files.length,
    sources: manifest.sources.length,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    console.log(
      JSON.stringify(checkPackage(process.argv[2] ?? resolve(import.meta.dirname, '..'))),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
