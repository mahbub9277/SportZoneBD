/**
 * What the checkout return page shows for the transaction-reference path.
 *
 * The page must never imply that typing a reference pays for anything, so the presentation is decided here
 * rather than in the markup: the form only appears when the backend says the capability is switched on, a
 * reference shorter than a real transaction ID cannot be submitted, and the result of an attempt is either the
 * backend's own sentence or nothing at all.
 */

/** Shortest length a real transaction reference can have; anything shorter is a typo, not a reference. */
export const MIN_REFERENCE_LENGTH = 6

export type TrxOutcomeTone = 'success' | 'pending' | 'error'

export interface TrxVerificationOutcome {
  tone: TrxOutcomeTone
  message: string
}

export interface TrxVerificationView {
  /** Whether the form is offered at all. */
  visible: boolean
  /** Whether the button may be pressed right now. */
  canSubmit: boolean
  /** What to say after an attempt, or null before one. */
  outcome: TrxVerificationOutcome | null
}

export interface TrxVerificationInput {
  /** The flag the backend reported with the payment status. */
  enabled: boolean | undefined
  /** The payment status the backend reported. */
  paymentStatus: string
  isVerifying: boolean
  reference: string
  /** The last successful answer, if there was one. */
  attempt: { activated: boolean; message: string } | null
  /** The last failure message, if there was one. */
  error: string | null
}

export function describeTrxVerification(input: TrxVerificationInput): TrxVerificationView {
  // Only an invoice that is still open (or that could not be decided) can be helped by a transaction reference.
  // A decided payment is either already active or closed, and the backend refuses both.
  const openForVerification = input.paymentStatus === 'PENDING' || input.paymentStatus === 'UNKNOWN'
  const visible = input.enabled === true && openForVerification

  let outcome: TrxVerificationOutcome | null = null
  if (input.error) {
    outcome = { tone: 'error', message: input.error }
  } else if (input.attempt) {
    outcome = {
      tone: input.attempt.activated ? 'success' : 'pending',
      message: input.attempt.message,
    }
  }

  return {
    visible,
    canSubmit: visible && !input.isVerifying && input.reference.trim().length >= MIN_REFERENCE_LENGTH,
    outcome,
  }
}
