-- M4: when a New request was last alerted to its supervisor, and when it was moved to another department.
ALTER TABLE "requests" ADD COLUMN "alerted_at" TIMESTAMPTZ(3);
ALTER TABLE "requests" ADD COLUMN "transferred_at" TIMESTAMPTZ(3);
