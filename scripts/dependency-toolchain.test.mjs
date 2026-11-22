import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

// Remote Taro template initialization is intentionally unsupported. The
// existing Mini Program must still compile; its Taro CLI imports a local
// no-network replacement instead of the vulnerable download/git-clone chain.
test('Taro build dependency graph pins a local no-network template stub', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const app = JSON.parse(readFileSync(new URL('../apps/miniprogram/package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.pnpm?.overrides?.['@tarojs/cli@4.3.3>download-git-repo'],
    'link:./packages/taro-template-download-blocked',
    'Taro CLI must use a scoped local no-network replacement');
  assert.equal(app.devDependencies['@tarojs/cli'], '4.3.3',
    'different CLI versions require separate dependency review');
  assert.equal(app.scripts.build, 'taro build --type weapp');
  const lockfile = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
  assert.match(lockfile, /^  '@tarojs\/cli@4\.3\.3>download-git-repo': link:\.\/packages\/taro-template-download-blocked$/m);
  assert.doesNotMatch(lockfile, /^  download-git-repo@/m,
    'the vulnerable upstream downloader must not be installed');
  assert.doesNotMatch(lockfile, /^  git-clone@/m,
    'the upstream unpatched git-clone must not be installed');
  assert.doesNotMatch(lockfile, /^\s{6}git-clone: /m,
    'installed snapshots must not depend on vulnerable git-clone');
});

test('Taro CLI import resolves the fail-closed local module, not a real git downloader', () => {
  const fromApp = createRequire(new URL('../apps/miniprogram/package.json', import.meta.url));
  const fromCLI = createRequire(fromApp.resolve('@tarojs/cli/package.json'));
  const disabledDownloader = fromCLI('download-git-repo');
  assert.equal(typeof disabledDownloader, 'function');
  assert.throws(
    () => disabledDownloader('direct:https://untrusted.invalid/template', 'outside-workspace', { clone: true }),
    (error) => error?.code === 'ERR_TARO_REMOTE_TEMPLATE_DISABLED',
    'local replacement must reject remote template cloning, never spawn git',
  );
});

test('removed upstream vulnerability has no full-audit exception', () => {
  const { exceptions } = JSON.parse(readFileSync(new URL('../security/dependency-audit-exceptions.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(exceptions));
  assert.equal(exceptions.length, 0, 'no expired or silent git-clone waiver is acceptable');
});
