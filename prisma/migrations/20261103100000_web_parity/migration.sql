CREATE TABLE "WebSettings" (
  "id" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  CONSTRAINT "WebSettings_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WebUndo" (
  "id" TEXT NOT NULL,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  CONSTRAINT "WebUndo_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Category" ADD COLUMN "side" TEXT,
  ADD COLUMN "otherSide" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "originalName" TEXT,
  ADD COLUMN "removed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Category"
  ADD CONSTRAINT "Category_side_check"
  CHECK ("side" IS NULL OR "side" IN ('spend', 'income'));
