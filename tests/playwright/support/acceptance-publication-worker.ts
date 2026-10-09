import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { acceptanceComposeArgs } from './acceptance-database.js';

// Advance only the disposable worker's clock. Approved schedules, payment facts
// and provider behavior remain unchanged; the real service performs the pass.
export async function runAcceptancePublicationWorker(
  now: Date
): Promise<boolean> {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error('The disposable publication worker requires a valid date.');
  }
  const { stdout } = await promisify(execFile)(
    'docker',
    [
      ...acceptanceComposeArgs(),
      'exec',
      '-T',
      'api',
      'node',
      '--input-type=module',
      '-e',
      `import pg from 'pg';
     import {loadApiRuntimeConfig} from './dist/apps/funding-api/src/api-runtime-config.js';
     import {createSponsorMediaStorage} from './dist/apps/funding-api/src/sponsor-media-storage.js';
     import {PublicationAutomationService} from './dist/apps/funding-api/src/publication-automation/service.js';
     if(process.env.FUNDING_PLATFORM_ENV!=='development' ||
        process.env.SPONSOR_MEDIA_STORAGE_DRIVER!=='local' ||
        process.env.SOCIAL_PUBLICATION_MODE!=='mock' ||
        process.env.SOCIAL_PUBLICATION_MOCK_URL!=='http://stripe-stub:4242/__test__/social')
       throw new Error('Disposable publication configuration required.');
     let database;
     try {database=new URL(process.env.DATABASE_URL);}
     catch {throw new Error('Disposable publication database required.');}
     if(!['postgres:','postgresql:'].includes(database.protocol) ||
        database.hostname!=='postgres' || database.pathname!=='/acceptance')
       throw new Error('Disposable publication database required.');
     const now=new Date(process.argv[1]);
     const currentTime=Date.now();
     if(!Number.isFinite(now.getTime()) || Math.abs(now.getTime()-currentTime)>180000)
       throw new Error('The disposable publication clock must stay within three minutes.');
     const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
     let completed=false;
     try {
       const {rows}=await pool.query(
         "SELECT EXISTS(SELECT 1 FROM publication_deliveries WHERE status='publishing') AS publishing, EXISTS(SELECT 1 FROM publication_feeds WHERE auto_prepare=TRUE) AS preparing"
       );
       if(now.getTime()>currentTime && rows[0].preparing)
         throw new Error('Disable automatic preparation before advancing the publication clock.');
       if(!rows[0].publishing) {
         const storage=createSponsorMediaStorage(loadApiRuntimeConfig().sponsorMediaStorageConfig);
         const service=new PublicationAutomationService(pool,storage);
         await service.tick(now);
         completed=true;
       }
     } finally {await pool.end();}
     console.log('PUBLICATION_WORKER_RESULT='+JSON.stringify({completed}));`,
      now.toISOString()
    ],
    { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 }
  );
  const result = stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith('PUBLICATION_WORKER_RESULT='));
  if (result === 'PUBLICATION_WORKER_RESULT={"completed":true}') return true;
  if (result === 'PUBLICATION_WORKER_RESULT={"completed":false}') return false;
  throw new Error(
    'The disposable publication worker returned no valid result.'
  );
}
