export interface RetentionPolicy {
  apply(): Promise<void>;
}

export class NoopRetentionPolicy implements RetentionPolicy {
  async apply(): Promise<void> {
    return Promise.resolve();
  }
}
