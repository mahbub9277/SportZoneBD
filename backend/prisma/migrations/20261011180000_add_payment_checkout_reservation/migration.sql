-- The reservation marker behind a hosted checkout session, plus the constraint that makes the reservation
-- atomic: at most one open hosted session per customer and plan.
--
-- The partial index deliberately requires `checkoutReservationAt IS NOT NULL`, so it applies only to rows the
-- hosted checkout created for a session. Every pre-existing payment (any provider, any status, including
-- historical PENDING_REVIEW records) has a NULL value there and can therefore never violate it, so no data
-- has to be backfilled, changed or deleted for this migration to apply safely.
ALTER TABLE "Payment" ADD COLUMN "checkoutReservationAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Payment_hosted_open_session_key"
  ON "Payment" ("userId", "subscriptionPlanId")
  WHERE "status" = 'PENDING' AND "provider" = 'zinipay' AND "deletedAt" IS NULL AND "checkoutReservationAt" IS NOT NULL;
