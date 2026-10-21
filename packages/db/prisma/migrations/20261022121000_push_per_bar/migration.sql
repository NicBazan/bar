-- DropIndex
DROP INDEX "PushSubscription_endpoint_key";

-- CreateIndex
CREATE INDEX "PushSubscription_endpoint_idx" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_customerId_endpoint_key" ON "PushSubscription"("customerId", "endpoint");

