-- Durable state of the provider's hosted checkout behind a payment: the payment page URL the customer was
-- sent to, and when the server last checked the invoice and what it answered. Nullable and additive: every
-- existing payment keeps its data, and payments made before the hosted checkout existed are untouched.
ALTER TABLE "Payment" ADD COLUMN "providerCheckout" JSONB;
