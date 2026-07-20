import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

const bashCandidates =
  process.platform === 'win32'
    ? [
        process.env.BASH,
        'bash',
        'C:\\Program Files\\Git\\bin\\bash.exe',
        'C:\\Program Files\\Git\\usr\\bin\\bash.exe'
      ].filter(Boolean)
    : [process.env.BASH, 'bash'].filter(Boolean);

const findBash = () =>
  bashCandidates.find((candidate) => {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    return result.status === 0 && /bash/i.test(result.stdout + result.stderr);
  });

const runBash = (script) =>
  spawnSync(findBash() ?? 'bash', ['-lc', script], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

test('OVH storage env example uses Beauharnois buckets without credentials', () => {
  const envExample = fs
    .readFileSync('.env.example', 'utf8')
    .replace(/\r\n/g, '\n');

  assert.ok(envExample.includes('SPONSOR_MEDIA_STORAGE_DRIVER=ovh-s3'));
  assert.ok(envExample.includes('SPONSOR_MEDIA_REGION=bhs'));
  assert.ok(
    envExample.includes(
      'SPONSOR_MEDIA_ENDPOINT=https://s3.bhs.io.cloud.ovh.net'
    )
  );
  assert.ok(
    envExample.includes(
      'SPONSOR_MEDIA_PUBLIC_BUCKET=openg7-funding-sponsor-media-public-prod'
    )
  );
  assert.ok(
    envExample.includes(
      'SPONSOR_MEDIA_PRIVATE_BUCKET=openg7-funding-sponsor-media-private-prod'
    )
  );
  assert.ok(
    envExample.includes(
      'SPONSOR_MEDIA_PUBLIC_BASE_URL=https://openg7-funding-sponsor-media-public-prod.s3.bhs.io.cloud.ovh.net'
    )
  );
  assert.ok(
    envExample.includes(
      'SPONSOR_MEDIA_PRIVATE_BASE_URL=https://openg7-funding-sponsor-media-private-prod.s3.bhs.io.cloud.ovh.net'
    )
  );
  assert.ok(envExample.includes('OVH_S3_ACCESS_KEY_ID=\n'));
  assert.ok(envExample.includes('OVH_S3_SECRET_ACCESS_KEY=\n'));
  assert.equal(envExample.includes(['ca-east', 'tor'].join('-')), false);
});

test('OVH storage npm shortcuts are registered', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

  assert.equal(
    pkg.scripts['storage:check'],
    'bash scripts/storage/check-ovh-storage.sh'
  );
  assert.equal(
    pkg.scripts['storage:test'],
    'bash scripts/storage/test-ovh-storage.sh'
  );
  assert.equal(
    pkg.scripts['storage:provision'],
    'bash scripts/storage/provision-ovh-storage.sh'
  );
  assert.equal(
    pkg.scripts['storage:publish'],
    'bash scripts/storage/publish-sponsor-media.sh'
  );
  assert.equal(
    pkg.scripts['storage:unpublish'],
    'bash scripts/storage/unpublish-sponsor-media.sh'
  );
});

test('OVH storage scripts expose help without loading credentials', (t) => {
  const bash = findBash();
  if (!bash) {
    t.skip('bash is not available');
    return;
  }

  for (const script of [
    'scripts/storage/check-ovh-storage.sh',
    'scripts/storage/test-ovh-storage.sh',
    'scripts/storage/provision-ovh-storage.sh',
    'scripts/storage/publish-sponsor-media.sh',
    'scripts/storage/unpublish-sponsor-media.sh'
  ]) {
    const result = spawnSync(bash, [script, '--help'], {
      cwd: process.cwd(),
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, `${script} --help should exit 0`);
    assert.match(result.stdout, /Usage:/);
  }
});

test('OVH storage common helper validates safe public object keys', (t) => {
  if (!findBash()) {
    t.skip('bash is not available');
    return;
  }

  const result = runBash(`
    set -Eeuo pipefail
    source scripts/storage/lib/ovh-s3-common.sh
    [[ "$(ovh_public_url "https://example.test/" "/public/sponsors/a.webp")" == "https://example.test/public/sponsors/a.webp" ]]
    ovh_validate_public_sponsor_key "public/sponsors/123/profile.webp"
    ! (ovh_validate_public_sponsor_key "public/sponsors/")
    ! (ovh_validate_public_sponsor_key "/public/sponsors/123/profile.webp")
    ! (ovh_validate_public_sponsor_key "public/sponsors/../secret.webp")
    ! (ovh_validate_public_sponsor_key "other/profile.webp")
  `);

  assert.equal(result.status, 0, result.stderr);
});

test('OVH storage scripts keep public-read scoped to object operations', () => {
  const provision = fs.readFileSync(
    'scripts/storage/provision-ovh-storage.sh',
    'utf8'
  );
  const publish = fs.readFileSync(
    'scripts/storage/publish-sponsor-media.sh',
    'utf8'
  );
  const functionalTest = fs.readFileSync(
    'scripts/storage/test-ovh-storage.sh',
    'utf8'
  );

  assert.equal(provision.includes('--acl public-read'), false);
  assert.ok(publish.includes('--acl public-read'));
  assert.ok(functionalTest.includes('put-object-acl'));
  assert.ok(functionalTest.includes('--acl public-read'));
  assert.ok(
    fs
      .readFileSync('scripts/storage/lib/ovh-s3-common.sh', 'utf8')
      .includes('AWS_EC2_METADATA_DISABLED=true')
  );
});
