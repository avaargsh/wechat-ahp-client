import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// AHP builds an existing Mini Program. It does not initialize new projects
// from attacker-provided Git URLs. The removed downloader's HTTP/Got tests
// were replaced with executable lockfile/manifest denial contracts: the old
// downloader must NOT be reachable in the installed Taro CLI graph.
test('Taro build dependency graph excludes unused template clone execution', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const app = JSON.parse(readFileSync(new URL('../apps/miniprogram/package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.pnpm?.overrides?.['@tarojs/cli@4.3.3>download-git-repo'], '-',
    'Taro CLI scaffolding downloader must be disabled by an exact versioned override');
  assert.equal(app.devDependencies['@tarojs/cli'], '4.3.3',
    'changing the CLI version requires a new explicit security review');
  assert.equal(app.scripts.build, 'taro build --type weapp',
    'the existing Mini Program build must stay available');
  const lockfile = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
  assert.match(lockfile, /^  '@tarojs\/cli@4\.3\.3>download-git-repo': '-'$/m);
  assert.doesNotMatch(lockfile, /^  download-git-repo@/m,
    'removed Taro scaffolding downloader was restored to pnpm-lock.yaml');
  assert.doesNotMatch(lockfile, /^  git-clone@/m,
    'unpatched vulnerable git-clone was restored to pnpm-lock.yaml');
  assert.doesNotMatch(lockfile, /^\s{6}git-clone: /m,
    'an installed snapshot still depends on git-clone');
});

test('full high-severity audit has no expired git-clone allowlist entry', () => {
  const { exceptions } = JSON.parse(readFileSync(new URL('../security/dependency-audit-exceptions.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(exceptions));
  assert.equal(exceptions.length, 0,
    'removed vulnerable dependency must not rely on a dated audit exception');
});
