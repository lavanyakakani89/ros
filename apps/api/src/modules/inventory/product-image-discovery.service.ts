import { ProductImageRelevance, ProductImageSuggestionStatus, type ProductImageSuggestion } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import { InventoryError } from "./inventory.service.js";

interface GoogleImageSearchResponse {
  items?: GoogleImageSearchItem[];
}

interface GoogleImageSearchItem {
  title?: string;
  link?: string;
  mime?: string;
  image?: {
    contextLink?: string;
    height?: number;
    width?: number;
    byteSize?: number;
    thumbnailLink?: string;
  };
}

interface ProductForImageSearch {
  id: string;
  tenantId: string;
  name: string;
  sku: string | null;
  unit: string;
  imageUrl: string | null;
  category: {
    name: string;
  } | null;
}

interface RankedImageCandidate {
  query: string;
  title: string;
  sourceImageUrl: string;
  thumbnailUrl: string | null;
  contextUrl: string | null;
  mime: string | null;
  width: number | null;
  height: number | null;
  byteSize: number | null;
  rights: string | null;
  relevance: ProductImageRelevance;
  score: number;
}

export class ProductImageDiscoveryService {
  constructor(private readonly fastify: FastifyInstance) {}

  isConfigured(): boolean {
    return Boolean(searchApiKey() && searchEngineId());
  }

  async listSuggestions(tenantId: string, productId: string): Promise<ProductImageSuggestion[]> {
    await this.ensureProduct(tenantId, productId);
    return this.fastify.prisma.productImageSuggestion.findMany({
      where: {
        tenantId,
        productId,
      },
      orderBy: [
        { status: "asc" },
        { score: "desc" },
        { createdAt: "desc" },
      ],
      take: 24,
    });
  }

  async searchSuggestions(tenant: { id: string; name: string }, productId: string, limit = 6): Promise<ProductImageSuggestion[]> {
    if (!this.isConfigured()) {
      throw new InventoryError("Google image search is not configured", 400);
    }

    const product = await this.ensureProduct(tenant.id, productId);
    const query = productSearchQuery(tenant.name, product);
    const response = await fetchGoogleImages(query, Math.min(Math.max(limit, 1), 10));
    const candidates = rankCandidates(tenant.name, product, query, response.items ?? []);

    await this.fastify.prisma.$transaction(async (tx) => {
      await tx.productImageSuggestion.deleteMany({
        where: {
          tenantId: tenant.id,
          productId,
          status: ProductImageSuggestionStatus.SUGGESTED,
        },
      });

      if (candidates.length > 0) {
        await tx.productImageSuggestion.createMany({
          data: candidates.map((candidate) => ({
            tenantId: tenant.id,
            productId,
            query: candidate.query,
            title: candidate.title,
            sourceImageUrl: candidate.sourceImageUrl,
            thumbnailUrl: candidate.thumbnailUrl,
            contextUrl: candidate.contextUrl,
            mime: candidate.mime,
            width: candidate.width,
            height: candidate.height,
            byteSize: candidate.byteSize,
            rights: candidate.rights,
            relevance: candidate.relevance,
            score: candidate.score,
          })),
        });
      }
    });

    return this.listSuggestions(tenant.id, productId);
  }

  async approveSuggestion(tenantId: string, productId: string, suggestionId: string, approvedById: string): Promise<{ imageUrl: string; suggestion: ProductImageSuggestion }> {
    const suggestion = await this.fastify.prisma.productImageSuggestion.findFirst({
      where: {
        id: suggestionId,
        tenantId,
        productId,
      },
    });

    if (!suggestion) {
      throw new InventoryError("Image suggestion not found", 404);
    }

    const product = await this.ensureProduct(tenantId, productId);
    const downloaded = await downloadSuggestedImage(suggestion.sourceImageUrl);
    const extension = extensionForContentType(downloaded.contentType);
    const objectName = `products/${tenantId}/${productId}-suggested.${extension}`;

    await this.fastify.minio.putObject(this.fastify.minioBucket, objectName, downloaded.buffer, downloaded.buffer.length, {
      "Content-Type": downloaded.contentType,
    });

    const approved = await this.fastify.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: {
          id: productId,
        },
        data: {
          imageUrl: objectName,
        },
      });

      await tx.productImageSuggestion.updateMany({
        where: {
          tenantId,
          productId,
          status: ProductImageSuggestionStatus.APPROVED,
          id: {
            not: suggestionId,
          },
        },
        data: {
          status: ProductImageSuggestionStatus.REJECTED,
          rejectedAt: new Date(),
        },
      });

      return tx.productImageSuggestion.update({
        where: {
          id: suggestionId,
        },
        data: {
          status: ProductImageSuggestionStatus.APPROVED,
          storageObjectName: objectName,
          approvedById,
          approvedAt: new Date(),
          rejectedAt: null,
        },
      });
    });

    if (product.imageUrl && product.imageUrl !== objectName) {
      await this.fastify.minio.removeObject(this.fastify.minioBucket, product.imageUrl).catch(() => undefined);
    }

    return {
      imageUrl: productImageViewUrl(productId),
      suggestion: approved,
    };
  }

  async rejectSuggestion(tenantId: string, productId: string, suggestionId: string): Promise<ProductImageSuggestion> {
    await this.ensureProduct(tenantId, productId);
    const suggestion = await this.fastify.prisma.productImageSuggestion.findFirst({
      where: {
        id: suggestionId,
        tenantId,
        productId,
      },
    });

    if (!suggestion) {
      throw new InventoryError("Image suggestion not found", 404);
    }

    return this.fastify.prisma.productImageSuggestion.update({
      where: {
        id: suggestionId,
      },
      data: {
        status: ProductImageSuggestionStatus.REJECTED,
        rejectedAt: new Date(),
      },
    });
  }

  private async ensureProduct(tenantId: string, productId: string): Promise<ProductForImageSearch> {
    const product = await this.fastify.prisma.product.findFirst({
      where: {
        id: productId,
        tenantId,
        isActive: true,
      },
      select: {
        id: true,
        tenantId: true,
        name: true,
        sku: true,
        unit: true,
        imageUrl: true,
        category: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!product) {
      throw new InventoryError("Product not found", 404);
    }

    return product;
  }
}

function searchApiKey(): string {
  return process.env.GOOGLE_CUSTOM_SEARCH_API_KEY?.trim() ?? "";
}

function searchEngineId(): string {
  return process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID?.trim() ?? "";
}

function searchRights(): string {
  return process.env.GOOGLE_CUSTOM_SEARCH_IMAGE_RIGHTS?.trim() ?? "";
}

function productSearchQuery(tenantName: string, product: ProductForImageSearch): string {
  return [
    tenantName,
    product.name,
    product.category?.name,
    product.unit,
    product.sku,
    "product image",
  ].filter(Boolean).join(" ");
}

async function fetchGoogleImages(query: string, limit: number): Promise<GoogleImageSearchResponse> {
  const apiKey = searchApiKey();
  const cx = searchEngineId();
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", query);
  url.searchParams.set("searchType", "image");
  url.searchParams.set("num", String(limit));
  url.searchParams.set("safe", process.env.GOOGLE_CUSTOM_SEARCH_SAFE?.trim() || "active");
  url.searchParams.set("gl", process.env.GOOGLE_CUSTOM_SEARCH_COUNTRY?.trim() || "in");
  url.searchParams.set("hl", process.env.GOOGLE_CUSTOM_SEARCH_LANGUAGE?.trim() || "en");
  url.searchParams.set("imgType", "photo");
  url.searchParams.set("imgSize", "medium");

  const rights = searchRights();
  if (rights) {
    url.searchParams.set("rights", rights);
  }

  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new InventoryError(`Google image search failed: ${response.statusText}`, response.status === 403 ? 502 : 400);
  }

  return response.json() as Promise<GoogleImageSearchResponse>;
}

function rankCandidates(tenantName: string, product: ProductForImageSearch, query: string, items: GoogleImageSearchItem[]): RankedImageCandidate[] {
  const productTokens = meaningfulTokens(product.name);
  const tenantTokens = meaningfulTokens(tenantName);
  const categoryTokens = meaningfulTokens(product.category?.name ?? "");
  const unitTokens = meaningfulTokens(product.unit);
  const rights = searchRights() || null;

  return items
    .flatMap((item) => {
      if (!item.link || !isHttpUrl(item.link)) {
        return [];
      }

      const haystack = [
        item.title,
        item.link,
        item.image?.contextLink,
      ].filter(Boolean).join(" ");
      const haystackTokens = meaningfulTokens(haystack);
      const productMatch = tokenCoverage(productTokens, haystackTokens);
      const tenantMatch = tokenCoverage(tenantTokens, haystackTokens);
      const categoryMatch = tokenCoverage(categoryTokens, haystackTokens);
      const unitMatch = tokenCoverage(unitTokens, haystackTokens);
      const imageScore = imageQualityScore(item);
      const score = Math.min(100, Math.round((productMatch * 42) + (tenantMatch * 24) + (categoryMatch * 12) + (unitMatch * 10) + imageScore));

      return [{
        query,
        title: item.title?.trim() || product.name,
        sourceImageUrl: item.link,
        thumbnailUrl: item.image?.thumbnailLink ?? null,
        contextUrl: item.image?.contextLink ?? null,
        mime: item.mime ?? null,
        width: item.image?.width ?? null,
        height: item.image?.height ?? null,
        byteSize: item.image?.byteSize ?? null,
        rights,
        relevance: relevanceForScore(score),
        score,
      } satisfies RankedImageCandidate];
    })
    .sort((first, second) => second.score - first.score);
}

function meaningfulTokens(value: string): string[] {
  const stopWords = new Set(["and", "for", "the", "with", "product", "image", "photo", "online", "store", "pvt", "ltd"]);
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length >= 2 && !stopWords.has(token));
}

function tokenCoverage(needles: string[], haystack: string[]): number {
  if (needles.length === 0) {
    return 0;
  }

  const haystackSet = new Set(haystack);
  const matches = needles.filter((token) => haystackSet.has(token) || [...haystackSet].some((candidate) => candidate.includes(token) || token.includes(candidate))).length;
  return matches / needles.length;
}

function imageQualityScore(item: GoogleImageSearchItem): number {
  const width = item.image?.width ?? 0;
  const height = item.image?.height ?? 0;
  const mime = item.mime?.toLowerCase() ?? "";
  let score = 2;
  if (width >= 400 && height >= 400) score += 5;
  if (width > 0 && height > 0) score += 2;
  if (mime === "image/jpeg" || mime === "image/png" || mime === "image/webp") score += 2;
  return score;
}

function relevanceForScore(score: number): ProductImageRelevance {
  if (score >= 82) {
    return ProductImageRelevance.VERY_RELEVANT;
  }
  if (score >= 52) {
    return ProductImageRelevance.RELEVANT;
  }
  return ProductImageRelevance.LOW;
}

async function downloadSuggestedImage(sourceImageUrl: string): Promise<{ buffer: Buffer; contentType: "image/jpeg" | "image/png" | "image/webp" }> {
  if (!isHttpUrl(sourceImageUrl)) {
    throw new InventoryError("Image source URL is not supported", 400);
  }

  const response = await fetch(sourceImageUrl, {
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new InventoryError("Suggested image could not be downloaded", 400);
  }

  const contentType = normalizeImageContentType(response.headers.get("content-type"));
  if (!contentType) {
    throw new InventoryError("Suggested image must be JPG, PNG, or WEBP", 400);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxSuggestedImageBytes) {
    throw new InventoryError("Suggested image must be 350 KB or smaller", 400);
  }

  return { buffer, contentType };
}

function normalizeImageContentType(value: string | null): "image/jpeg" | "image/png" | "image/webp" | null {
  const contentType = value?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (contentType === "image/jpeg" || contentType === "image/png" || contentType === "image/webp") {
    return contentType;
  }
  return null;
}

function extensionForContentType(contentType: "image/jpeg" | "image/png" | "image/webp"): "jpg" | "png" | "webp" {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function productImageViewUrl(productId: string): string {
  return `/api/inventory/products/${productId}/image`;
}

const maxSuggestedImageBytes = 350 * 1024;
