import type { Pool } from 'pg';

import type {
  AdminSponsorshipReviewReminderConfig,
  buildSponsorshipReviewReminderAdminUrl,
  queueDueSponsorshipReviewReminder
} from './admin-reminder.service.js';
import type { ContributionActivityService } from './contribution-activity.service.js';
import type { processQueuedEmailMessages } from './email-notification.service.js';
import type { PublicationAutomationService } from './publication-automation/service.js';

export interface ApiBackgroundWorkerTimer {
  unref(): unknown;
}

export interface ApiBackgroundWorkersDependencies {
  readonly hasDatabase: boolean;
  readonly dbPool: Pool | null;
  readonly emailQueueWorkerEnabled: boolean;
  readonly emailQueueBatchSize: number;
  readonly emailQueuePollIntervalMs: number;
  readonly adminSponsorshipReviewReminderConfig: AdminSponsorshipReviewReminderConfig;
  readonly publicBaseUrl: string | null;
  readonly processQueuedEmailMessages: typeof processQueuedEmailMessages;
  readonly queueDueSponsorshipReviewReminder: typeof queueDueSponsorshipReviewReminder;
  readonly buildSponsorshipReviewReminderAdminUrl: typeof buildSponsorshipReviewReminderAdminUrl;
  readonly contributionActivity: Pick<
    ContributionActivityService,
    'tick'
  > | null;
  readonly publicationAutomation: Pick<
    PublicationAutomationService,
    'tick'
  > | null;
  readonly logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  readonly setInterval?: (
    callback: () => void,
    intervalMs: number
  ) => ApiBackgroundWorkerTimer;
}

export const createApiBackgroundWorkers = (
  dependencies: ApiBackgroundWorkersDependencies
) => {
  const {
    hasDatabase,
    dbPool,
    emailQueueWorkerEnabled,
    emailQueueBatchSize,
    emailQueuePollIntervalMs,
    adminSponsorshipReviewReminderConfig,
    publicBaseUrl,
    processQueuedEmailMessages,
    queueDueSponsorshipReviewReminder,
    buildSponsorshipReviewReminderAdminUrl,
    contributionActivity,
    publicationAutomation
  } = dependencies;
  const logger = dependencies.logger ?? console;
  const scheduleInterval = dependencies.setInterval ?? setInterval;
  let emailQueueProcessing = false;
  let adminSponsorshipReviewReminderProcessing = false;

  const runEmailQueueWorker = async (): Promise<void> => {
    if (!dbPool || !emailQueueWorkerEnabled || emailQueueProcessing) {
      return;
    }

    emailQueueProcessing = true;
    try {
      const result = await processQueuedEmailMessages(dbPool, {
        limit: emailQueueBatchSize
      });

      if (result.sent > 0 || result.failed > 0) {
        logger.info(
          `Email queue processed ${result.attempted} message(s): ${result.sent} sent, ${result.failed} failed.`
        );
      }
    } catch (error) {
      logger.error('Failed to process email queue.', error);
    } finally {
      emailQueueProcessing = false;
    }
  };

  const runAdminSponsorshipReviewReminderWorker = async (): Promise<void> => {
    if (!dbPool || adminSponsorshipReviewReminderProcessing) {
      return;
    }

    adminSponsorshipReviewReminderProcessing = true;
    try {
      const result = await queueDueSponsorshipReviewReminder(dbPool, {
        config: adminSponsorshipReviewReminderConfig,
        adminUrl: buildSponsorshipReviewReminderAdminUrl(publicBaseUrl)
      });

      if (
        result.checked &&
        !result.duplicate &&
        (result.queued || result.sent)
      ) {
        logger.info(
          `Admin sponsorship review reminder queued for ${result.dueCount} pending sponsorship(s).`
        );
      }

      if (result.checked && !result.duplicate && result.error) {
        logger.warn(
          'Admin sponsorship review reminder could not be delivered.',
          result.error
        );
      }
    } catch (error) {
      logger.error('Failed to queue admin sponsorship review reminder.', error);
    } finally {
      adminSponsorshipReviewReminderProcessing = false;
    }
  };

  const runContributionActivity = async (): Promise<void> => {
    try {
      await contributionActivity?.tick();
    } catch {
      logger.error(
        'Contribution activity worker interrupted; verify migration 027 and database availability.'
      );
    }
  };

  const runPublicationWorker = async (): Promise<void> => {
    try {
      await publicationAutomation?.tick();
    } catch {
      logger.error(
        'Publication worker interrupted; inspect publication exceptions and database availability.'
      );
    }
  };

  const start = (): void => {
    if (!hasDatabase) return;

    void runEmailQueueWorker();
    void runContributionActivity();
    const contributionTimer = scheduleInterval(
      () => void runContributionActivity(),
      2000
    );
    contributionTimer.unref();
    void runPublicationWorker();
    const publicationTimer = scheduleInterval(
      () => void runPublicationWorker(),
      30000
    );
    publicationTimer.unref();
    void runAdminSponsorshipReviewReminderWorker();
    const emailQueueTimer = scheduleInterval(
      () => void runEmailQueueWorker(),
      emailQueuePollIntervalMs
    );
    emailQueueTimer.unref();
    const adminSponsorshipReviewReminderTimer = scheduleInterval(
      () => void runAdminSponsorshipReviewReminderWorker(),
      adminSponsorshipReviewReminderConfig.pollIntervalMs
    );
    adminSponsorshipReviewReminderTimer.unref();
  };

  return {
    runEmailQueueWorker,
    runAdminSponsorshipReviewReminderWorker,
    runContributionActivity,
    runPublicationWorker,
    start
  };
};
