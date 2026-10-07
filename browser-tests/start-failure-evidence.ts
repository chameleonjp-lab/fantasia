export const START_FAILURE_STATE = 'fantasia-start-pause-failure-state';
export const START_FAILURE_ERROR = 'fantasia-start-pause-failure-evidence-error';

type Attachment = { path: string; contentType: string } | { body: string; contentType: string };
export interface StartFailureEvidenceOperations {
  read(): Promise<string>;
  persist(name: string, body: string): Promise<string>;
  attach(name: string, attachment: Attachment): Promise<void>;
  warn(message: string): void;
}
const describe = (error: unknown) => error instanceof Error ? error.stack ?? error.message : String(error);

/** Failure-only observation. Callers must rethrow their original assertion. */
export async function collectStartFailureEvidence(operations: StartFailureEvidenceOperations): Promise<void> {
  let stage = 'collection';
  try {
    const body = await operations.read();
    stage = 'state-file';
    const path = await operations.persist(`${START_FAILURE_STATE}.json`, body);
    stage = 'state-attachment';
    await operations.attach(START_FAILURE_STATE, { path, contentType: 'application/json' });
  } catch (error) {
    const report: Record<string, string> = { stage, error: describe(error) };
    let path: string | undefined;
    try {
      path = await operations.persist(`${START_FAILURE_ERROR}.json`, JSON.stringify(report, null, 2));
    } catch (persistenceError) {
      report.errorFileFailure = describe(persistenceError);
    }
    try {
      await operations.attach(START_FAILURE_ERROR, path
        ? { path, contentType: 'application/json' }
        : { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    } catch (attachmentError) {
      report.errorAttachmentFailure = describe(attachmentError);
      operations.warn(`${START_FAILURE_ERROR}: ${JSON.stringify(report)}`);
    }
  }
}
