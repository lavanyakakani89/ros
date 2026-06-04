-- CreateEnum
CREATE TYPE "ProductImageSuggestionProvider" AS ENUM ('GOOGLE_CUSTOM_SEARCH');

-- CreateEnum
CREATE TYPE "ProductImageRelevance" AS ENUM ('VERY_RELEVANT', 'RELEVANT', 'LOW');

-- CreateEnum
CREATE TYPE "ProductImageSuggestionStatus" AS ENUM ('SUGGESTED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "product_image_suggestions" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "provider" "ProductImageSuggestionProvider" NOT NULL DEFAULT 'GOOGLE_CUSTOM_SEARCH',
  "query" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "source_image_url" TEXT NOT NULL,
  "thumbnail_url" TEXT,
  "context_url" TEXT,
  "mime" TEXT,
  "width" INTEGER,
  "height" INTEGER,
  "byte_size" INTEGER,
  "rights" TEXT,
  "relevance" "ProductImageRelevance" NOT NULL,
  "score" INTEGER NOT NULL,
  "status" "ProductImageSuggestionStatus" NOT NULL DEFAULT 'SUGGESTED',
  "storage_object_name" TEXT,
  "approved_by_id" TEXT,
  "approved_at" TIMESTAMP(3),
  "rejected_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "product_image_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_image_suggestions_tenant_id_product_id_status_idx" ON "product_image_suggestions"("tenant_id", "product_id", "status");

-- CreateIndex
CREATE INDEX "product_image_suggestions_tenant_id_product_id_score_idx" ON "product_image_suggestions"("tenant_id", "product_id", "score");

-- CreateIndex
CREATE INDEX "product_image_suggestions_approved_by_id_idx" ON "product_image_suggestions"("approved_by_id");

-- AddForeignKey
ALTER TABLE "product_image_suggestions" ADD CONSTRAINT "product_image_suggestions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_image_suggestions" ADD CONSTRAINT "product_image_suggestions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_image_suggestions" ADD CONSTRAINT "product_image_suggestions_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
