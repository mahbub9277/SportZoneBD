-- Durable record of the ZiniPay transaction verification behind a payment: the provider verification id,
-- the verified amount/provider/status, a masked sender and the confirm outcome with its timestamps.
-- Nullable and additive: every existing payment keeps its data, manual payments stay null, and a payment
-- whose provider outcome is still ambiguous keeps the facts needed to reconcile it later.
ALTER TABLE "Payment" ADD COLUMN "providerVerification" JSONB;
