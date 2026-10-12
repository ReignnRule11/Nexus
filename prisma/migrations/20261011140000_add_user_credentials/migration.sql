-- AlterTable
ALTER TABLE "users" ADD COLUMN "email" VARCHAR(254) NOT NULL;
ALTER TABLE "users" ADD COLUMN "email_normalized" VARCHAR(254) NOT NULL;
ALTER TABLE "users" ADD COLUMN "password_hash" VARCHAR(255) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_email_normalized_key" ON "users"("email_normalized");
