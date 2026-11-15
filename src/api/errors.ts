/** A response from OnlyCars that isn't a success. `status` is null when there was no response at all. */
export class ApiError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  constructor(status: number | null, code: string | null, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
