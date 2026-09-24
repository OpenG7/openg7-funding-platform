import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { acceptanceComposeArgs } from './acceptance-database.js';

// Only the reminder's clock is advanced. Payment, invoice and dossier dates are
// untouched. The existing mail queue and SMTP adapter deliver the reminder.
export async function runAcceptanceReviewReminder(now: Date) {
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
     import {queueDueSponsorshipReviewReminder,buildSponsorshipReviewReminderAdminUrl} from './dist/apps/funding-api/src/admin-reminder.service.js';
     if(process.env.FUNDING_PLATFORM_ENV!=='development' || process.env.SMTP_HOST!=='stripe-stub')
       throw new Error('Disposable notification configuration required.');
     const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
     try {
       const result=await queueDueSponsorshipReviewReminder(pool,{
         now:new Date(process.argv[1]),
         config:{enabled:true,minAgeDays:1,maxItems:100,pollIntervalMs:1000},
         adminUrl:buildSponsorshipReviewReminderAdminUrl(process.env.FUNDING_PUBLIC_BASE_URL)
       });
       console.log('REMINDER_RESULT='+JSON.stringify(result));
     } finally {await pool.end();}`,
      now.toISOString()
    ],
    { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 }
  );
  const result = stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith('REMINDER_RESULT='));
  if (!result)
    throw new Error('The disposable reminder returned no structured result.');
  return JSON.parse(result.slice('REMINDER_RESULT='.length)) as {
    checked: boolean;
    skippedReason: string | null;
    queued: boolean;
    duplicate: boolean;
    messageId: string | null;
    error: string | null;
  };
}
