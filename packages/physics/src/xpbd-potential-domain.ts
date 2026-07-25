/**
 * Typed refusal for a mathematically valid potential whose open domain does
 * not contain a requested candidate state.
 *
 * Incremental-potential line searches may backtrack this error. Malformed
 * inputs, arithmetic failures, and ordinary provider errors remain fatal.
 *
 * @typeParam TReason Stable machine-readable reason vocabulary of the law.
 */
export class XpbdPotentialDomainErrorN<
  TReason extends string = string
> extends Error {
  /** Stable identifier of the potential law or provider refusing evaluation. */
  readonly lawId: string;
  /** Machine-readable reason within the law's domain vocabulary. */
  readonly reason: TReason;

  /**
   * Creates a recoverable mathematical-domain refusal.
   *
   * @param lawId Stable identifier of the potential law or provider.
   * @param reason Machine-readable reason within that law's vocabulary.
   * @param message Human-readable explanation of the refused candidate.
   */
  constructor(lawId: string, reason: TReason, message: string) {
    super(message);
    this.name = 'XpbdPotentialDomainErrorN';
    this.lawId = lawId;
    this.reason = reason;
  }
}
