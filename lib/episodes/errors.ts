export class EpisodeSplitError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export class EpisodeSourceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "EpisodeSourceError";
  }
}
