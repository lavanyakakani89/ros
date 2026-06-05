import { createHmac, timingSafeEqual } from "node:crypto";

import { hash, verify } from "@node-rs/argon2";
import {
  InvoiceStatus,
  ModuleSubscriptionStatus,
  PaymentMode,
  PlatformModule,
  StorefrontApprovalType,
  StorefrontDomainStatus,
  StorefrontDomainType,
  StorefrontPaymentProvider,
  StorefrontStatus,
  TenantStatus,
  UserRole,
  type Prisma,
  type StorefrontSettings,
  type Tenant,
} from "@prisma/client";
import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { getCookieValue } from "../../plugins/auth.js";
import { BillingError, BillingService } from "../billing/billing.service.js";
import { DeliveryError, DeliveryService } from "../delivery/delivery.service.js";
import { decryptStorefrontSecret, encryptStorefrontSecret } from "./storefront.credentials.js";
import {
  asRecord,
  buildFamilyProductMap,
  buildProductFamilySuggestions,
  chooseDefaultFamilyProduct,
  ecommerceProductFamilyInclude,
  extractVariantCandidate,
  listEligibleFamilyProducts,
  listTenantProductFamilies,
  readText,
  slugifyFamilyName,
  sortVariantLabel,
} from "./storefront.families.js";
import {
  storefrontAddFamilyItemsSchema,
  storefrontCatalogQuerySchema,
  storefrontCategoryProductsParamsSchema,
  storefrontCheckoutSchema,
  storefrontCreateProductFamilySchema,
  storefrontCouponSchema,
  storefrontCustomerLoginSchema,
  storefrontCustomerRegisterSchema,
  storefrontProductListQuerySchema,
  storefrontDomainRequestSchema,
  storefrontFamilyItemParamsSchema,
  storefrontFamilyParamsSchema,
  storefrontProductParamsSchema,
  storefrontRazorpayVerifySchema,
  storefrontSearchQuerySchema,
  storefrontSettingsRequestSchema,
  storefrontTenantParamsSchema,
  storefrontUpdateProductFamilySchema,
} from "./storefront.schema.js";

const storefrontCustomerCookie = "storefront_customer_token";
const storefrontMediaParamsSchema = storefrontTenantParamsSchema.extend({
  asset: z.enum(["logo", "banner-1", "banner-2"]),
});
const tenantStorefrontMediaParamsSchema = z.object({
  asset: z.enum(["logo", "banner-1", "banner-2"]),
});
const allowedStorefrontMediaTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const storefrontLogoMaxBytes = 256 * 1024;
const storefrontBannerMaxBytes = 700 * 1024;

export class StorefrontError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

type StorefrontContext = {
  tenant: Tenant;
  settings: StorefrontSettings;
  hostname: string | null;
  defaultHostname: string;
};

type RazorpayConfig = {
  provider: StorefrontPaymentProvider;
  keyId: string;
  keySecret: string;
};

export const storefrontRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const billing = new BillingService(fastify);
  const delivery = new DeliveryService(fastify);

  fastify.get("/api/public/storefront/bootstrap", async (request, reply) => {
    return handleStorefront(reply, async () => {
      const query = storefrontCatalogQuerySchema.parse(request.query);
      const host = query.host ?? forwardedHost(request);
      const context = await resolveStorefrontContext(fastify, { host });
      return buildStorefrontBootstrap(fastify, context, query);
    });
  });

  fastify.get("/api/public/storefront/:tenantSlug/bootstrap", async (request, reply) => {
    return handleStorefront(reply, async () => {
      const params = storefrontTenantParamsSchema.parse(request.params);
      const query = storefrontCatalogQuerySchema.parse(request.query);
      const context = await resolveStorefrontContext(fastify, { tenantSlug: params.tenantSlug, host: query.host ?? forwardedHost(request) });
      return buildStorefrontBootstrap(fastify, context, query);
    });
  });

  fastify.get("/api/public/storefront/:tenantSlug/categories", async (request, reply) => {
    return handleStorefront(reply, async () => {
      const params = storefrontTenantParamsSchema.parse(request.params);
      const { tenant } = await resolveStorefrontContext(fastify, { tenantSlug: params.tenantSlug, host: forwardedHost(request) });
      await setTenantContext(fastify, tenant.id);
      return {
        categories: await listCategories(fastify, tenant.id),
      };
    });
  });

  fastify.get("/api/public/storefront/:tenantSlug/categories/:categoryId/products", async (request, reply) => {
    return handleStorefront(reply, async () => {
      const params = storefrontCategoryProductsParamsSchema.parse(request.params);
      const query = storefrontProductListQuerySchema.parse(request.query);
      const context = await resolveStorefrontContext(fastify, { tenantSlug: params.tenantSlug, host: query.host ?? forwardedHost(request) });
      await setTenantContext(fastify, context.tenant.id);
      const result = await listProducts(fastify, context.tenant.slug, context.tenant.id, {
        ...query,
        categoryId: params.categoryId,
      });
      return result;
    });
  });

  fastify.get("/api/public/storefront/:tenantSlug/products", async (request, reply) => {
    return handleStorefront(reply, async () => {
      const params = storefrontTenantParamsSchema.parse(request.params);
      const query = storefrontProductListQuerySchema.parse(request.query);
      const context = await resolveStorefrontContext(fastify, { tenantSlug: params.tenantSlug, host: query.host ?? forwardedHost(request) });
      await setTenantContext(fastify, context.tenant.id);
      return listProducts(fastify, context.tenant.slug, context.tenant.id, query);
    });
  });

  fastify.get("/api/public/storefront/:tenantSlug/products/:productId", async (request, reply) => {
    return handleStorefront(reply, async () => {
      const params = storefrontProductParamsSchema.parse(request.params);
      const { tenant } = await resolveStorefrontContext(fastify, { tenantSlug: params.tenantSlug, host: forwardedHost(request) });
      await setTenantContext(fastify, tenant.id);
      return getStorefrontProductDetail(fastify, tenant.id, tenant.slug, params.productId);
    });
  });

  fastify.get("/api/public/storefront/:tenantSlug/search", async (request, reply) => {
    return handleStorefront(reply, async () => {
      const params = storefrontTenantParamsSchema.parse(request.params);
      const query = storefrontSearchQuerySchema.parse(request.query);
      const { tenant } = await resolveStorefrontContext(fastify, { tenantSlug: params.tenantSlug, host: query.host ?? forwardedHost(request) });
      await setTenantContext(fastify, tenant.id);
      return searchStorefrontProducts(fastify, tenant.id, tenant.slug, query);
    });
  });

  fastify.get("/api/public/storefront/:tenantSlug/products/:productId/image", async (request, reply) => {
    return handleStorefront(reply, async () => {
      const params = storefrontProductParamsSchema.parse(request.params);
      const { tenant } = await resolveStorefrontContext(fastify, { tenantSlug: params.tenantSlug });
      await setTenantContext(fastify, tenant.id);

      const product = await fastify.prisma.product.findFirst({
        where: {
          id: params.productId,
          tenantId: tenant.id,
          isActive: true,
          ecommerceDisabled: false,
        },
        select: {
          imageUrl: true,
        },
      });

      if (!product?.imageUrl) {
        throw new StorefrontError("Product image not found", 404);
      }

      const stream = await fastify.minio.getObject(fastify.minioBucket, product.imageUrl);
      reply.header("Cache-Control", "public, max-age=900");
      reply.type(contentTypeForImageObject(product.imageUrl));
      return reply.send(stream);
    });
  });

  fastify.get("/api/public/storefront/:tenantSlug/media/:asset", async (request, reply) => {
    return handleStorefront(reply, async () => {
      const params = storefrontMediaParamsSchema.parse(request.params);
      const { tenant, settings } = await resolveStorefrontContext(fastify, { tenantSlug: params.tenantSlug });
      const objectName = storefrontMediaObjectForAsset(settings, tenant, params.asset);

      if (!objectName) {
        throw new StorefrontError("Storefront media not found", 404);
      }

      const stream = await fastify.minio.getObject(fastify.minioBucket, objectName);
      reply.header("Cache-Control", "public, max-age=900");
      reply.type(contentTypeForImageObject(objectName));
      return reply.send(stream);
    });
  });

  fastify.post("/api/public/storefront/:tenantSlug/coupons/validate", async (request, reply) => {
    return handleStorefront(reply, async () => {
      const params = storefrontTenantParamsSchema.parse(request.params);
      const input = storefrontCouponSchema.parse(request.body);
      const { tenant } = await resolveStorefrontContext(fastify, { tenantSlug: params.tenantSlug });
      await setTenantContext(fastify, tenant.id);

      const cart = await buildCart(fastify, tenant.id, input.items);
      const coupon = await validateCoupon(fastify, tenant.id, input.code, cart.subtotal);

      return {
        code: coupon.code,
        discount: coupon.discount,
        label: couponLabel(coupon),
      };
    });
  });

  fastify.post("/api/public/storefront/:tenantSlug/customers/register", async (request, reply) => {
    return handleStorefront(reply, async () => {
      const params = storefrontTenantParamsSchema.parse(request.params);
      const input = storefrontCustomerRegisterSchema.parse(request.body);
      const { tenant, settings } = await resolveStorefrontContext(fastify, { tenantSlug: params.tenantSlug });
      if (!settings.allowCustomerLogin) {
        throw new StorefrontError("Customer login is not enabled for this store", 403);
      }

      await setTenantContext(fastify, tenant.id);
      const customer = await createOrUpdateEcommerceCustomer(fastify, tenant.id, input, await hashPassword(input.password));
      await fastify.prisma.customer.update({
        where: {
          id: customer.id,
        },
        data: {
          ecommerceLastLoginAt: new Date(),
        },
      });
      setCustomerCookie(fastify, reply, tenant.id, customer.id);
      return { customer: customerResponse(customer) };
    });
  });

  fastify.post("/api/public/storefront/:tenantSlug/customers/login", async (request, reply) => {
    return handleStorefront(reply, async () => {
      const params = storefrontTenantParamsSchema.parse(request.params);
      const input = storefrontCustomerLoginSchema.parse(request.body);
      const { tenant, settings } = await resolveStorefrontContext(fastify, { tenantSlug: params.tenantSlug });
      if (!settings.allowCustomerLogin) {
        throw new StorefrontError("Customer login is not enabled for this store", 403);
      }

      await setTenantContext(fastify, tenant.id);
      const customer = await fastify.prisma.customer.findFirst({
        where: {
          tenantId: tenant.id,
          phone: normalizePhone(input.phone),
        },
      });
      if (!customer?.ecommercePasswordHash || !(await verify(customer.ecommercePasswordHash, input.password))) {
        throw new StorefrontError("Invalid phone number or password", 401);
      }

      const updated = await fastify.prisma.customer.update({
        where: {
          id: customer.id,
        },
        data: {
          ecommerceLastLoginAt: new Date(),
        },
      });
      setCustomerCookie(fastify, reply, tenant.id, updated.id);
      return { customer: customerResponse(updated) };
    });
  });

  fastify.post("/api/public/storefront/:tenantSlug/customers/logout", async (_request, reply) => {
    clearCustomerCookie(reply);
    return { status: "ok" };
  });

  fastify.get("/api/public/storefront/:tenantSlug/customers/me", async (request, reply) => {
    return handleStorefront(reply, async () => {
      const params = storefrontTenantParamsSchema.parse(request.params);
      const { tenant } = await resolveStorefrontContext(fastify, { tenantSlug: params.tenantSlug });
      await setTenantContext(fastify, tenant.id);
      const customerId = readStorefrontCustomerId(fastify, request, tenant.id);
      if (!customerId) {
        return { customer: null };
      }

      const customer = await fastify.prisma.customer.findFirst({
        where: {
          id: customerId,
          tenantId: tenant.id,
        },
      });
      return { customer: customer ? customerResponse(customer) : null };
    });
  });

  fastify.get("/api/public/storefront/:tenantSlug/customers/orders", async (request, reply) => {
    return handleStorefront(reply, async () => {
      const params = storefrontTenantParamsSchema.parse(request.params);
      const { tenant } = await resolveStorefrontContext(fastify, { tenantSlug: params.tenantSlug });
      await setTenantContext(fastify, tenant.id);
      const customerId = readStorefrontCustomerId(fastify, request, tenant.id);
      if (!customerId) {
        throw new StorefrontError("Sign in to view order history", 401);
      }

      const invoices = await fastify.prisma.invoice.findMany({
        where: {
          tenantId: tenant.id,
          customerId,
        },
        include: {
          items: true,
          delivery: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 50,
      });

      return {
        orders: invoices
          .filter((invoice) => asRecord(invoice.verticalData).source === "ECOMMERCE")
          .map((invoice) => orderResponse(invoice, invoice.delivery?.id ?? null, asRecord(invoice.verticalData).deliveryAddress ?? "")),
      };
    });
  });

  fastify.post("/api/public/storefront/:tenantSlug/checkout", async (request, reply) => {
    return handleStorefront(reply, async () => {
      const params = storefrontTenantParamsSchema.parse(request.params);
      const input = storefrontCheckoutSchema.parse(request.body);
      const { tenant, settings, hostname, defaultHostname } = await resolveStorefrontContext(fastify, { tenantSlug: params.tenantSlug });
      await setTenantContext(fastify, tenant.id);

      const customerId = readStorefrontCustomerId(fastify, request, tenant.id);
      if (!customerId && !settings.allowGuestCheckout) {
        throw new StorefrontError("Sign in before checkout", 401);
      }
      if (input.paymentMethod === "COD" && !settings.allowCod) {
        throw new StorefrontError("Cash on delivery is not enabled for this store", 400);
      }

      const razorpayConfig = resolveRazorpayConfig(settings);
      if (input.paymentMethod === "RAZORPAY" && !razorpayConfig) {
        throw new StorefrontError("Online payment is not configured", 501);
      }

      const cart = await buildCart(fastify, tenant.id, input.items);
      const coupon = input.couponCode ? await validateCoupon(fastify, tenant.id, input.couponCode, cart.subtotal) : null;
      const store = await findDefaultStore(fastify, tenant.id);
      const customer = customerId
        ? await updateAuthenticatedCustomer(fastify, tenant.id, customerId, input.customer)
        : await findOrCreateCustomer(fastify, tenant.id, input.customer);
      const deliveryAddress = input.delivery?.address ?? input.customer.address;
      const deliveryCharge = calculateDeliveryCharge(cart.subtotal - (coupon?.discount ?? 0), settings);
      const sourceMetadata = {
        source: "ECOMMERCE",
        storefrontTenantSlug: tenant.slug,
        channel: "WEB",
        domain: hostname ?? defaultHostname,
        customer: {
          name: input.customer.name,
          phone: input.customer.phone,
          ...(input.customer.email ? { email: input.customer.email } : {}),
        },
        deliveryAddress,
        paymentIntent: input.paymentMethod,
        ...(coupon ? { coupon: { id: coupon.id, code: coupon.code, discount: coupon.discount }, couponUsed: input.paymentMethod === "COD" } : {}),
        deliveryCharge,
      };
      const invoice = await billing.createInvoice(tenant, {
        customerId: customer.id,
        ...(store?.id ? { storeId: store.id } : {}),
        paymentMode: input.paymentMethod === "RAZORPAY" ? PaymentMode.UPI : PaymentMode.CREDIT,
        billDiscount: coupon?.discount ?? 0,
        verticalData: sourceMetadata,
        notes: orderNotes(input.delivery?.notes),
        items: cart.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          sellingPrice: item.sellingPrice,
        })),
      });

      if (coupon) {
        await setInvoiceCouponCode(fastify, tenant.id, invoice.id, coupon.code);
        if (input.paymentMethod === "COD") {
          await incrementCouponUse(fastify, tenant.id, coupon.id);
        }
      }

      const deliveryRecord = await createStorefrontDelivery(delivery, tenant, {
        invoiceId: invoice.id,
        customerId: customer.id,
        deliveryAddress,
        notes: input.delivery?.notes,
        scheduledAt: input.delivery?.scheduledAt,
      }, fastify);

      if (input.paymentMethod === "COD") {
        const confirmedInvoice = await billing.confirmInvoice(tenant, invoice.id, "storefront");
        return {
          order: orderResponse(confirmedInvoice, deliveryRecord?.id ?? null, deliveryAddress),
          razorpay: null,
        };
      }

      if (!razorpayConfig) {
        throw new StorefrontError("Online payment is not configured", 501);
      }

      const razorpay = await createRazorpayOrder(fastify, tenant, razorpayConfig, invoice.id, invoice.invoiceNumber, invoice.grandTotal.toNumber());
      await updateInvoiceMetadata(fastify, tenant.id, invoice.id, {
        ...sourceMetadata,
        paymentProvider: "RAZORPAY",
        razorpayKeySource: razorpayConfig.provider,
        razorpayOrderId: razorpay.id,
      });

      return {
        order: orderResponse(invoice, deliveryRecord?.id ?? null, deliveryAddress),
        razorpay: {
          keyId: razorpayConfig.keyId,
          orderId: razorpay.id,
          amount: razorpay.amount,
          currency: "INR",
          name: settings.displayName ?? tenant.name,
          description: `Order ${invoice.invoiceNumber}`,
          prefill: {
            name: input.customer.name,
            contact: normalizePhone(input.customer.phone),
            ...(input.customer.email ? { email: input.customer.email } : {}),
          },
        },
      };
    });
  });

  fastify.post("/api/public/storefront/:tenantSlug/checkout/verify-razorpay", async (request, reply) => {
    return handleStorefront(reply, async () => {
      const params = storefrontTenantParamsSchema.parse(request.params);
      const input = storefrontRazorpayVerifySchema.parse(request.body);
      const { tenant, settings } = await resolveStorefrontContext(fastify, { tenantSlug: params.tenantSlug });
      await setTenantContext(fastify, tenant.id);

      let invoice = await billing.getInvoice(tenant, input.invoiceId);
      const metadata = asRecord(invoice.verticalData);
      const razorpayConfig = resolveRazorpayConfig(settings, readString(metadata, "razorpayKeySource"));
      if (!razorpayConfig) {
        throw new StorefrontError("Online payment is not configured", 501);
      }

      verifyRazorpaySignature(input, razorpayConfig.keySecret);
      if (metadata.source !== "ECOMMERCE" || metadata.razorpayOrderId !== input.razorpayOrderId) {
        throw new StorefrontError("Payment does not match this storefront order", 400);
      }

      if (invoice.status === InvoiceStatus.DRAFT || invoice.status === InvoiceStatus.PENDING_WHATSAPP) {
        invoice = await billing.confirmInvoice(tenant, invoice.id, "system");
      }

      await recordStorefrontPayment(fastify, tenant.id, invoice.id, invoice.grandTotal.toNumber(), input.razorpayPaymentId);
      await markVerifiedCouponUsed(fastify, tenant.id, invoice.id, metadata);
      const paidInvoice = await billing.getInvoice(tenant, invoice.id);

      return {
        verified: true,
        order: orderResponse(paidInvoice, paidInvoice.delivery?.id ?? null, metadata.deliveryAddress ?? ""),
      };
    });
  });

  fastify.get("/api/storefront/settings", async (request) => {
    const settings = await ensureTenantStorefrontSettings(fastify, request.tenant);
    const [subscription, domains, approvals, pricing] = await Promise.all([
      fastify.prisma.tenantModuleSubscription.findUnique({
        where: {
          tenantId_module: {
            tenantId: request.tenant.id,
            module: PlatformModule.ECOMMERCE,
          },
        },
      }),
      fastify.prisma.storefrontDomain.findMany({
        where: {
          tenantId: request.tenant.id,
        },
        orderBy: [
          { type: "asc" },
          { createdAt: "desc" },
        ],
      }),
      fastify.prisma.storefrontApprovalRequest.findMany({
        where: {
          tenantId: request.tenant.id,
        },
        orderBy: {
          requestedAt: "desc",
        },
        take: 20,
      }),
      fastify.prisma.modulePricing.findUnique({
        where: {
          module: PlatformModule.ECOMMERCE,
        },
      }),
    ]);

    return {
      settings: formatSettings(settings, request.tenant),
      subscription: subscription ? formatSubscription(subscription) : null,
      domains,
      approvals,
      pricing: pricing ? formatModulePricing(pricing) : null,
      defaultHostname: defaultHostnameForTenant(request.tenant, settings),
    };
  });

  fastify.post("/api/storefront/request-enable", async (request) => {
    const settings = await ensureTenantStorefrontSettings(fastify, request.tenant);
    const subdomain = settings.subdomain ?? request.tenant.slug;
    const defaultHostname = defaultHostnameForSubdomain(subdomain);
    const actorId = request.user.userId;

    const [approval, nextSettings] = await fastify.prisma.$transaction(async (tx) => {
      const next = await tx.storefrontSettings.update({
        where: {
          tenantId: request.tenant.id,
        },
        data: {
          status: settings.status === StorefrontStatus.ACTIVE ? StorefrontStatus.ACTIVE : StorefrontStatus.REQUESTED,
          subdomain,
        },
      });

      await tx.tenantModuleSubscription.upsert({
        where: {
          tenantId_module: {
            tenantId: request.tenant.id,
            module: PlatformModule.ECOMMERCE,
          },
        },
        create: {
          tenantId: request.tenant.id,
          module: PlatformModule.ECOMMERCE,
          status: ModuleSubscriptionStatus.REQUESTED,
          requestedAt: new Date(),
        },
        update: {
          status: ModuleSubscriptionStatus.REQUESTED,
          requestedAt: new Date(),
        },
      });

      await tx.storefrontDomain.upsert({
        where: {
          hostname: defaultHostname,
        },
        create: {
          tenantId: request.tenant.id,
          storefrontId: next.id,
          hostname: defaultHostname,
          type: StorefrontDomainType.DEFAULT_SUBDOMAIN,
          status: StorefrontDomainStatus.REQUESTED,
          requestedById: actorId,
        },
        update: {
          tenantId: request.tenant.id,
          storefrontId: next.id,
          type: StorefrontDomainType.DEFAULT_SUBDOMAIN,
          status: StorefrontDomainStatus.REQUESTED,
          requestedById: actorId,
          requestedAt: new Date(),
        },
      });

      const createdApproval = await tx.storefrontApprovalRequest.create({
        data: {
          tenantId: request.tenant.id,
          type: StorefrontApprovalType.ENABLEMENT,
          requestedById: actorId,
          payload: {
            status: StorefrontStatus.ACTIVE,
            subdomain,
            hostname: defaultHostname,
          },
        },
      });

      return [createdApproval, next] as const;
    });

    return {
      settings: formatSettings(nextSettings, request.tenant),
      approval,
      defaultHostname,
    };
  });

  fastify.post("/api/storefront/settings/request", async (request) => {
    const input = storefrontSettingsRequestSchema.parse(request.body);
    await ensureTenantStorefrontSettings(fastify, request.tenant);

    const payload = cleanRequestPayload({
      theme: input.theme,
      displayName: input.displayName,
      heroTitle: input.heroTitle,
      heroSubtitle: input.heroSubtitle,
      primaryColor: input.primaryColor,
      accentColor: input.accentColor,
      allowGuestCheckout: input.allowGuestCheckout,
      allowCustomerLogin: input.allowCustomerLogin,
      allowCod: input.allowCod,
      paymentProvider: input.paymentProvider,
      tenantRazorpayKeyId: input.tenantRazorpayKeyId,
      tenantRazorpayKeySecretCiphertext: input.tenantRazorpayKeySecret ? encryptStorefrontSecret(input.tenantRazorpayKeySecret) : undefined,
      deliveryCharge: input.deliveryCharge,
      freeDeliveryAbove: input.freeDeliveryAbove,
    });

    const approval = await fastify.prisma.storefrontApprovalRequest.create({
      data: {
        tenantId: request.tenant.id,
        type: StorefrontApprovalType[input.requestType],
        requestedById: request.user.userId,
        payload: payload as Prisma.InputJsonValue,
        notes: input.notes ?? null,
      },
    });

    return { approval };
  });

  fastify.post("/api/storefront/domain-requests", async (request) => {
    const input = storefrontDomainRequestSchema.parse(request.body);
    const settings = await ensureTenantStorefrontSettings(fastify, request.tenant);
    const actorId = request.user.userId;

    const [domain, approval] = await fastify.prisma.$transaction(async (tx) => {
      const nextDomain = await tx.storefrontDomain.upsert({
        where: {
          hostname: input.hostname,
        },
        create: {
          tenantId: request.tenant.id,
          storefrontId: settings.id,
          hostname: input.hostname,
          type: StorefrontDomainType.CUSTOM,
          status: StorefrontDomainStatus.REQUESTED,
          requestedById: actorId,
          notes: input.notes ?? null,
        },
        update: {
          tenantId: request.tenant.id,
          storefrontId: settings.id,
          type: StorefrontDomainType.CUSTOM,
          status: StorefrontDomainStatus.REQUESTED,
          requestedById: actorId,
          requestedAt: new Date(),
          notes: input.notes ?? null,
        },
      });

      const createdApproval = await tx.storefrontApprovalRequest.create({
        data: {
          tenantId: request.tenant.id,
          type: StorefrontApprovalType.DOMAIN,
          requestedById: actorId,
          payload: {
            hostname: input.hostname,
            type: StorefrontDomainType.CUSTOM,
          },
          notes: input.notes ?? null,
        },
      });

      return [nextDomain, createdApproval] as const;
    });

    return { domain, approval };
  });

  fastify.get("/api/storefront/media/:asset/view", async (request, reply) => {
    return handleStorefront(reply, async () => {
      const params = tenantStorefrontMediaParamsSchema.parse(request.params);
      const settings = await ensureTenantStorefrontSettings(fastify, request.tenant);
      const objectName = storefrontMediaObjectForAsset(settings, request.tenant, params.asset);
      if (!objectName) {
        throw new StorefrontError("Storefront media not found", 404);
      }

      const stream = await fastify.minio.getObject(fastify.minioBucket, objectName);
      reply.header("Cache-Control", "private, max-age=300");
      reply.type(contentTypeForImageObject(objectName));
      return reply.send(stream);
    });
  });

  fastify.post("/api/storefront/media/:asset", async (request, reply) => {
    return handleStorefront(reply, async () => {
      ensureStorefrontMediaManager(request.user.role);
      const params = tenantStorefrontMediaParamsSchema.parse(request.params);
      const settings = await ensureTenantStorefrontSettings(fastify, request.tenant);
      const file = await request.file();
      if (!file) {
        throw new StorefrontError("Image file is required", 400);
      }

      const contentType = file.mimetype.toLowerCase();
      if (!allowedStorefrontMediaTypes.has(contentType)) {
        throw new StorefrontError("Upload a JPG, PNG, or WEBP image", 400);
      }

      const buffer = await file.toBuffer();
      const maxBytes = storefrontMediaMaxBytes(params.asset);
      if (buffer.length > maxBytes) {
        throw new StorefrontError(`${storefrontMediaLabel(params.asset)} must be ${formatKilobytes(maxBytes)} KB or smaller`, 400);
      }

      const extension = extensionForContentType(contentType);
      const objectName = `storefront/${request.tenant.id}/${params.asset}.${extension}`;
      await fastify.minio.putObject(fastify.minioBucket, objectName, buffer, buffer.length, {
        "Content-Type": contentType,
      });

      const previousObject = storefrontOwnedMediaObjectForAsset(settings, params.asset);
      if (previousObject && previousObject !== objectName) {
        await fastify.minio.removeObject(fastify.minioBucket, previousObject).catch(() => undefined);
      }

      const nextCustomizations = updateStorefrontMediaCustomization(settings.customizations, params.asset, objectName);
      const data: Prisma.StorefrontSettingsUpdateInput = params.asset === "logo"
        ? { logoUrl: objectName, customizations: nextCustomizations as Prisma.InputJsonValue }
        : { customizations: nextCustomizations as Prisma.InputJsonValue };
      const updated = await fastify.prisma.storefrontSettings.update({
        where: {
          tenantId: request.tenant.id,
        },
        data,
      });

      return { settings: formatSettings(updated, request.tenant) };
    });
  });

  fastify.delete("/api/storefront/media/:asset", async (request, reply) => {
    return handleStorefront(reply, async () => {
      ensureStorefrontMediaManager(request.user.role);
      const params = tenantStorefrontMediaParamsSchema.parse(request.params);
      const settings = await ensureTenantStorefrontSettings(fastify, request.tenant);
      const previousObject = storefrontOwnedMediaObjectForAsset(settings, params.asset);
      if (previousObject) {
        await fastify.minio.removeObject(fastify.minioBucket, previousObject).catch(() => undefined);
      }

      const nextCustomizations = removeStorefrontMediaCustomization(settings.customizations, params.asset);
      const data: Prisma.StorefrontSettingsUpdateInput = params.asset === "logo"
        ? { logoUrl: null, customizations: nextCustomizations as Prisma.InputJsonValue }
        : { customizations: nextCustomizations as Prisma.InputJsonValue };
      const updated = await fastify.prisma.storefrontSettings.update({
        where: {
          tenantId: request.tenant.id,
        },
        data,
      });

      return { settings: formatSettings(updated, request.tenant) };
    });
  });

  fastify.get("/api/storefront/product-families", async (request, reply) => {
    return handleStorefront(reply, async () => {
      ensureStorefrontMediaManager(request.user.role);
      const [families, products] = await Promise.all([
        listTenantProductFamilies(fastify, request.tenant.id),
        listEligibleFamilyProducts(fastify, request.tenant.id),
      ]);
      const groupedProductIds = new Set(families.flatMap((family) => family.items.map((item) => item.productId)));

      return {
        families: families.map((family) => ({
          id: family.id,
          name: family.name,
          slug: family.slug,
          attributeLabel: family.attributeLabel,
          source: family.source,
          isActive: family.isActive,
          items: family.items.map((item) => ({
            id: item.id,
            productId: item.productId,
            productName: item.product.name,
            sku: item.product.sku,
            barcode: item.product.barcode,
            imageUrl: item.product.imageUrl ? `/api/inventory/products/${item.productId}/image` : null,
            currentStock: item.product.currentStock.toNumber(),
            mrp: item.product.mrp.toNumber(),
            sellingPrice: item.product.sellingPrice.toNumber(),
            categoryName: item.product.category?.name ?? "Featured",
            brand: readText(item.product.verticalData, "brand"),
            size: readText(item.product.verticalData, "size"),
            variantLabel: item.variantLabel,
            sortOrder: item.sortOrder,
            isDefault: item.isDefault,
          })),
        })),
        suggestions: buildProductFamilySuggestions(products, groupedProductIds),
        ungroupedProducts: products
          .filter((product) => !groupedProductIds.has(product.id))
          .map((product) => ({
            id: product.id,
            name: product.name,
            sku: product.sku,
            barcode: product.barcode,
            imageUrl: product.imageUrl ? `/api/inventory/products/${product.id}/image` : null,
            currentStock: product.currentStock.toNumber(),
            mrp: product.mrp.toNumber(),
            sellingPrice: product.sellingPrice.toNumber(),
            categoryName: product.category?.name ?? "Featured",
            brand: readText(product.verticalData, "brand"),
            size: readText(product.verticalData, "size"),
            suggestedVariantLabel: extractVariantCandidate(product)?.variantLabel ?? null,
          })),
      };
    });
  });

  fastify.post("/api/storefront/product-families", async (request, reply) => {
    return handleStorefront(reply, async () => {
      ensureStorefrontMediaManager(request.user.role);
      const input = storefrontCreateProductFamilySchema.parse(request.body);
      const productIds = input.items.map((item) => item.productId);
      const products = await fastify.prisma.product.findMany({
        where: {
          tenantId: request.tenant.id,
          id: { in: productIds },
          isActive: true,
          ecommerceDisabled: false,
        },
        include: {
          category: {
            select: {
              id: true,
              name: true,
              parentId: true,
            },
          },
        },
      });
      if (products.length !== productIds.length) {
        throw new StorefrontError("Some selected products are not available for ecommerce grouping", 400);
      }

      const existingItems = await fastify.prisma.ecommerceProductFamilyItem.findMany({
        where: {
          tenantId: request.tenant.id,
          productId: { in: productIds },
        },
        select: {
          productId: true,
        },
      });
      if (existingItems.length > 0) {
        throw new StorefrontError("One or more selected products already belong to another ecommerce family", 409);
      }

      const nextSlug = await uniqueFamilySlug(fastify, request.tenant.id, input.name);
      const created = await fastify.prisma.ecommerceProductFamily.create({
        data: {
          tenantId: request.tenant.id,
          name: input.name,
          slug: nextSlug,
          attributeLabel: input.attributeLabel,
          source: input.source,
          items: {
            create: input.items.map((item, index) => {
              const product = products.find((candidate) => candidate.id === item.productId);
              return {
                tenantId: request.tenant.id,
                productId: item.productId,
                variantLabel: item.variantLabel?.trim() || extractVariantCandidate(product ?? { name: "", verticalData: null })?.variantLabel || product?.name || `Variant ${String(index + 1)}`,
                sortOrder: item.sortOrder ?? sortVariantLabel(item.variantLabel?.trim() || extractVariantCandidate(product ?? { name: "", verticalData: null })?.variantLabel || product?.name || ""),
                isDefault: item.isDefault ?? index === 0,
              };
            }),
          },
        },
        include: ecommerceProductFamilyInclude,
      });

      await normalizeFamilyDefaults(fastify, request.tenant.id, created.id);
      return { family: created };
    });
  });

  fastify.patch("/api/storefront/product-families/:familyId", async (request, reply) => {
    return handleStorefront(reply, async () => {
      ensureStorefrontMediaManager(request.user.role);
      const params = storefrontFamilyParamsSchema.parse(request.params);
      const input = storefrontUpdateProductFamilySchema.parse(request.body);

      const family = await fastify.prisma.ecommerceProductFamily.findFirst({
        where: {
          id: params.familyId,
          tenantId: request.tenant.id,
          isActive: true,
        },
        include: ecommerceProductFamilyInclude,
      });
      if (!family) {
        throw new StorefrontError("Ecommerce family not found", 404);
      }

      await fastify.prisma.$transaction(async (tx) => {
        await tx.ecommerceProductFamily.update({
          where: {
            id: family.id,
          },
          data: {
            ...(input.name ? { name: input.name, slug: await uniqueFamilySlug(fastify, request.tenant.id, input.name, family.id) } : {}),
            ...(input.attributeLabel ? { attributeLabel: input.attributeLabel } : {}),
          },
        });

        if (input.items) {
          for (const item of input.items) {
            await tx.ecommerceProductFamilyItem.update({
              where: {
                id: item.id,
              },
              data: {
                variantLabel: item.variantLabel,
                sortOrder: item.sortOrder,
                isDefault: item.isDefault,
              },
            });
          }
        }
      });

      await normalizeFamilyDefaults(fastify, request.tenant.id, family.id);
      return {
        family: await fastify.prisma.ecommerceProductFamily.findUnique({
          where: {
            id: family.id,
          },
          include: ecommerceProductFamilyInclude,
        }),
      };
    });
  });

  fastify.post("/api/storefront/product-families/:familyId/items", async (request, reply) => {
    return handleStorefront(reply, async () => {
      ensureStorefrontMediaManager(request.user.role);
      const params = storefrontFamilyParamsSchema.parse(request.params);
      const input = storefrontAddFamilyItemsSchema.parse(request.body);

      const family = await fastify.prisma.ecommerceProductFamily.findFirst({
        where: {
          id: params.familyId,
          tenantId: request.tenant.id,
          isActive: true,
        },
      });
      if (!family) {
        throw new StorefrontError("Ecommerce family not found", 404);
      }

      const productIds = input.items.map((item) => item.productId);
      const [products, existingItems] = await Promise.all([
        fastify.prisma.product.findMany({
          where: {
            tenantId: request.tenant.id,
            id: { in: productIds },
            isActive: true,
            ecommerceDisabled: false,
          },
        }),
        fastify.prisma.ecommerceProductFamilyItem.findMany({
          where: {
            tenantId: request.tenant.id,
            productId: { in: productIds },
          },
          select: {
            productId: true,
            familyId: true,
          },
        }),
      ]);
      if (products.length !== productIds.length) {
        throw new StorefrontError("Some selected products are not available for ecommerce grouping", 400);
      }
      if (existingItems.some((item) => item.familyId !== family.id)) {
        throw new StorefrontError("One or more selected products already belong to another ecommerce family", 409);
      }

      await fastify.prisma.ecommerceProductFamilyItem.createMany({
        data: input.items
          .filter((item) => !existingItems.some((existing) => existing.productId === item.productId))
          .map((item, index) => {
            const product = products.find((candidate) => candidate.id === item.productId);
            const derivedLabel = extractVariantCandidate(product ?? { name: "", verticalData: null })?.variantLabel;
            return {
              tenantId: request.tenant.id,
              familyId: family.id,
              productId: item.productId,
              variantLabel: item.variantLabel?.trim() || derivedLabel || product?.name || `Variant ${String(index + 1)}`,
              sortOrder: item.sortOrder ?? sortVariantLabel(item.variantLabel?.trim() || derivedLabel || product?.name || ""),
              isDefault: item.isDefault ?? false,
            };
          }),
      });

      await normalizeFamilyDefaults(fastify, request.tenant.id, family.id);
      return {
        family: await fastify.prisma.ecommerceProductFamily.findUnique({
          where: {
            id: family.id,
          },
          include: ecommerceProductFamilyInclude,
        }),
      };
    });
  });

  fastify.delete("/api/storefront/product-families/:familyId/items/:itemId", async (request, reply) => {
    return handleStorefront(reply, async () => {
      ensureStorefrontMediaManager(request.user.role);
      const params = storefrontFamilyItemParamsSchema.parse(request.params);
      const item = await fastify.prisma.ecommerceProductFamilyItem.findFirst({
        where: {
          id: params.itemId,
          familyId: params.familyId,
          tenantId: request.tenant.id,
        },
      });
      if (!item) {
        throw new StorefrontError("Ecommerce family item not found", 404);
      }

      await fastify.prisma.ecommerceProductFamilyItem.delete({
        where: {
          id: item.id,
        },
      });

      const remaining = await fastify.prisma.ecommerceProductFamilyItem.count({
        where: {
          familyId: params.familyId,
          tenantId: request.tenant.id,
        },
      });
      if (remaining < 2) {
        await fastify.prisma.ecommerceProductFamily.update({
          where: {
            id: params.familyId,
          },
          data: {
            isActive: false,
          },
        });
        return { family: null, archived: true };
      }

      await normalizeFamilyDefaults(fastify, request.tenant.id, params.familyId);
      return {
        family: await fastify.prisma.ecommerceProductFamily.findUnique({
          where: {
            id: params.familyId,
          },
          include: ecommerceProductFamilyInclude,
        }),
      };
    });
  });

  fastify.delete("/api/storefront/product-families/:familyId", async (request, reply) => {
    return handleStorefront(reply, async () => {
      ensureStorefrontMediaManager(request.user.role);
      const params = storefrontFamilyParamsSchema.parse(request.params);
      await fastify.prisma.ecommerceProductFamily.updateMany({
        where: {
          id: params.familyId,
          tenantId: request.tenant.id,
        },
        data: {
          isActive: false,
        },
      });
      return { status: "ok" };
    });
  });

  done();
};

async function buildStorefrontBootstrap(
  fastify: FastifyInstance,
  context: StorefrontContext,
  query: z.infer<typeof storefrontCatalogQuerySchema>,
) {
  const { tenant, settings, defaultHostname } = context;
  await setTenantContext(fastify, tenant.id);

  const [categories, productResult] = await Promise.all([
    listCategories(fastify, tenant.id),
    listProducts(fastify, tenant.slug, tenant.id, query),
  ]);
  const razorpayConfig = resolveRazorpayConfig(settings);
  const paymentMethods = [
    ...(settings.allowCod ? ["COD" as const] : []),
    ...(razorpayConfig ? ["RAZORPAY" as const] : []),
  ];

  return {
    tenant: {
      name: tenant.name,
      slug: tenant.slug,
      phone: tenant.phone,
      address: tenant.address,
      gstEnabled: tenant.gstEnabled,
      gstNumber: tenant.gstNumber,
      currency: tenant.currency,
      logoUrl: storefrontMediaObjectForAsset(settings, tenant, "logo") ? `/api/public/storefront/${tenant.slug}/media/logo` : null,
    },
    storefront: {
      status: settings.status,
      theme: settings.theme,
      defaultHostname,
      displayName: settings.displayName ?? tenant.name,
      heroTitle: settings.heroTitle,
      heroSubtitle: settings.heroSubtitle,
      primaryColor: settings.primaryColor,
      accentColor: settings.accentColor,
      allowGuestCheckout: settings.allowGuestCheckout,
      allowCustomerLogin: settings.allowCustomerLogin,
      allowCod: settings.allowCod,
      paymentProvider: settings.paymentProvider,
      banners: storefrontBannerUrls(settings, tenant.slug),
    },
    categories,
    products: productResult.data,
    productFilters: productResult.filters,
    checkout: {
      deliveryCharge: settings.deliveryCharge.toNumber(),
      freeDeliveryAbove: settings.freeDeliveryAbove.toNumber(),
      razorpayKeyId: razorpayConfig?.keyId ?? null,
      paymentMethods,
    },
  };
}

async function resolveStorefrontContext(
  fastify: FastifyInstance,
  source: { tenantSlug?: string | undefined; host?: string | undefined },
): Promise<StorefrontContext> {
  const hostname = normalizeHost(source.host);
  if (hostname) {
    const byDomain = await resolveStorefrontByHostname(fastify, hostname);
    if (byDomain) {
      return byDomain;
    }

    const subdomain = storefrontSubdomainFromHost(hostname);
    if (subdomain) {
      const bySubdomain = await resolveStorefrontBySubdomain(fastify, subdomain, hostname);
      if (bySubdomain) {
        return bySubdomain;
      }
    }
  }

  if (!source.tenantSlug) {
    throw new StorefrontError("Storefront is not available", 404);
  }

  const tenant = await fastify.prisma.tenant.findUnique({
    where: {
      slug: source.tenantSlug,
    },
    include: {
      storefrontSettings: true,
    },
  });

  if (!tenant || tenant.status === TenantStatus.SUSPENDED || !tenant.storefrontSettings || tenant.storefrontSettings.status !== StorefrontStatus.ACTIVE) {
    throw new StorefrontError("Storefront is not available", 404);
  }

  return {
    tenant,
    settings: tenant.storefrontSettings,
    hostname,
    defaultHostname: defaultHostnameForTenant(tenant, tenant.storefrontSettings),
  };
}

async function resolveStorefrontByHostname(fastify: FastifyInstance, hostname: string): Promise<StorefrontContext | null> {
  const candidates = hostname.startsWith("www.") ? [hostname, hostname.slice(4)] : [hostname, `www.${hostname}`];
  const domain = await fastify.prisma.storefrontDomain.findFirst({
    where: {
      hostname: {
        in: candidates,
      },
      status: StorefrontDomainStatus.ACTIVE,
    },
    include: {
      tenant: {
        include: {
          storefrontSettings: true,
        },
      },
    },
  });

  if (!domain?.tenant.storefrontSettings || domain.tenant.status === TenantStatus.SUSPENDED || domain.tenant.storefrontSettings.status !== StorefrontStatus.ACTIVE) {
    return null;
  }

  return {
    tenant: domain.tenant,
    settings: domain.tenant.storefrontSettings,
    hostname: domain.hostname,
    defaultHostname: defaultHostnameForTenant(domain.tenant, domain.tenant.storefrontSettings),
  };
}

async function resolveStorefrontBySubdomain(fastify: FastifyInstance, subdomain: string, hostname: string): Promise<StorefrontContext | null> {
  const settings = await fastify.prisma.storefrontSettings.findFirst({
    where: {
      subdomain,
      status: StorefrontStatus.ACTIVE,
      tenant: {
        status: {
          not: TenantStatus.SUSPENDED,
        },
      },
    },
    include: {
      tenant: true,
    },
  });

  if (!settings) {
    return null;
  }

  return {
    tenant: settings.tenant,
    settings,
    hostname,
    defaultHostname: defaultHostnameForTenant(settings.tenant, settings),
  };
}

async function ensureTenantStorefrontSettings(fastify: FastifyInstance, tenant: Tenant): Promise<StorefrontSettings> {
  const existing = await fastify.prisma.storefrontSettings.findUnique({
    where: {
      tenantId: tenant.id,
    },
  });
  if (existing) {
    return existing;
  }

  return fastify.prisma.storefrontSettings.create({
    data: {
      tenantId: tenant.id,
      status: StorefrontStatus.DISABLED,
      theme: "CLASSIC_RETAIL",
      subdomain: tenant.slug,
      displayName: tenant.name,
      heroTitle: tenant.name,
      heroSubtitle: "Order online from your local store",
    },
  });
}

async function setTenantContext(fastify: FastifyInstance, tenantId: string): Promise<void> {
  await fastify.prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, FALSE)`;
}

async function listCategories(fastify: FastifyInstance, tenantId: string) {
  const categories = await fastify.prisma.category.findMany({
    where: {
      tenantId,
      isActive: true,
      OR: visibleCategoryProductScope(tenantId),
    },
    orderBy: [
      { parentId: "asc" },
      { sortOrder: "asc" },
      { name: "asc" },
    ],
    select: {
      id: true,
      name: true,
      code: true,
      parentId: true,
    },
  });

  const counts = await fastify.prisma.product.groupBy({
    by: ["categoryId"],
    where: {
      tenantId,
      isActive: true,
      ecommerceDisabled: false,
      currentStock: {
        gt: 0,
      },
      categoryId: {
        not: null,
      },
    },
    _count: {
      _all: true,
    },
  });
  const countByCategoryId = new Map(counts.map((item) => [item.categoryId ?? "", item._count._all]));

  const topLevel = categories.filter((category) => !category.parentId);
  return topLevel
    .map((category) => {
      const children = categories
        .filter((candidate) => candidate.parentId === category.id)
        .map((child) => ({
          id: child.id,
          name: child.name,
          code: child.code,
          parentId: child.parentId,
          productCount: countByCategoryId.get(child.id) ?? 0,
        }))
        .filter((child) => child.productCount > 0);
      const directCount = countByCategoryId.get(category.id) ?? 0;
      const childCount = children.reduce((sum, child) => sum + child.productCount, 0);
      return {
        id: category.id,
        name: category.name,
        code: category.code,
        parentId: null,
        productCount: directCount + childCount,
        children,
      };
    })
    .filter((category) => category.productCount > 0);
}

async function listProducts(
  fastify: FastifyInstance,
  tenantSlug: string,
  tenantId: string,
  query: z.infer<typeof storefrontCatalogQuerySchema> | z.infer<typeof storefrontProductListQuerySchema>,
) {
  const categoryIds = query.categoryId ? await storefrontCategoryScope(fastify, tenantId, query.categoryId) : null;
  const search = "search" in query ? query.search : undefined;
  const page = "page" in query ? query.page : 1;
  const pageSize = "pageSize" in query ? query.pageSize : query.limit;
  const sort = "sort" in query ? query.sort : "FEATURED";
  const filterBrand = "brand" in query ? query.brand : undefined;
  const filterSize = "size" in query ? query.size : undefined;
  const filterColor = "color" in query ? query.color : undefined;
  const discountOnly = "discountOnly" in query ? query.discountOnly : false;
  const minPrice = "minPrice" in query ? query.minPrice : undefined;
  const maxPrice = "maxPrice" in query ? query.maxPrice : undefined;

  const products = await fastify.prisma.product.findMany({
    where: {
      tenantId,
      isActive: true,
      ecommerceDisabled: false,
      currentStock: {
        gt: 0,
      },
      ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { description: { contains: search, mode: "insensitive" } },
              { sku: { contains: search, mode: "insensitive" } },
              { barcode: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(discountOnly
        ? {
            mrp: {
              gt: 0,
            },
          }
        : {}),
      ...(minPrice !== undefined || maxPrice !== undefined
        ? {
            sellingPrice: {
              ...(minPrice !== undefined ? { gte: minPrice } : {}),
              ...(maxPrice !== undefined ? { lte: maxPrice } : {}),
            },
          }
        : {}),
    },
    include: {
      category: {
        select: {
          id: true,
          name: true,
          parentId: true,
        },
      },
      variants: {
        where: {
          isActive: true,
          currentStock: {
            gt: 0,
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  const [families, shaped] = await Promise.all([
    listTenantProductFamilies(fastify, tenantId),
    Promise.resolve(products.map((product) => storefrontProductCard(product, tenantSlug))),
  ]);
  const familyMap = buildFamilyProductMap(families);
  const grouped = groupStorefrontProducts(shaped, familyMap);
  const filtered = grouped.filter((product) => {
    if (filterBrand && normalizeSearchValue(product.brand) !== normalizeSearchValue(filterBrand)) {
      return false;
    }
    if (filterSize && !product.variantLabels.some((label) => normalizeSearchValue(label) === normalizeSearchValue(filterSize))) {
      return false;
    }
    if (filterColor && normalizeSearchValue(product.color) !== normalizeSearchValue(filterColor)) {
      return false;
    }
    if (discountOnly && product.discountPercent <= 0) {
      return false;
    }
    return true;
  });
  const sorted = sortStorefrontProducts(filtered, sort);
  const total = sorted.length;
  const start = (page - 1) * pageSize;
  const data = sorted.slice(start, start + pageSize);

  return {
    data,
    page,
    pageSize,
    total,
    totalPages: Math.max(Math.ceil(total / pageSize), 1),
    filters: collectStorefrontFilters(sorted),
  };
}

async function getStorefrontProductDetail(
  fastify: FastifyInstance,
  tenantId: string,
  tenantSlug: string,
  productId: string,
) {
  const familyItem = await fastify.prisma.ecommerceProductFamilyItem.findFirst({
    where: {
      tenantId,
      productId,
      family: {
        isActive: true,
      },
    },
    include: {
      family: {
        include: ecommerceProductFamilyInclude,
      },
    },
  });

  if (familyItem?.family) {
    const family = familyItem.family;
    const visibleItems = family.items.filter((item) =>
      item.product.isActive &&
      !item.product.ecommerceDisabled &&
      item.product.currentStock.toNumber() > 0);
    const defaultItem = chooseDefaultFamilyProduct(visibleItems.length > 0 ? visibleItems : family.items);
    const primaryProduct = defaultItem.product;
    const relatedProducts = await relatedStorefrontProducts(fastify, tenantId, tenantSlug, primaryProduct.id, primaryProduct.categoryId, readText(primaryProduct.verticalData, "brand"));

    return {
      product: storefrontProductDetail({
        ...primaryProduct,
        category: primaryProduct.category,
        variants: primaryProduct.variants,
      }, tenantSlug, {
        familyId: family.id,
        familyName: family.name,
        attributeLabel: family.attributeLabel,
        familyItems: visibleItems.length > 0 ? visibleItems : family.items,
      }),
      relatedProducts: relatedProducts
        .slice(0, 4),
      frequentlyBoughtTogether: relatedProducts
        .slice(4, 8),
    };
  }

  const product = await fastify.prisma.product.findFirst({
    where: {
      id: productId,
      tenantId,
      isActive: true,
      ecommerceDisabled: false,
      currentStock: {
        gt: 0,
      },
    },
    include: {
      category: {
        select: {
          id: true,
          name: true,
          parentId: true,
        },
      },
      variants: {
        where: {
          isActive: true,
          currentStock: {
            gt: 0,
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!product) {
    throw new StorefrontError("Product not found", 404);
  }

  const relatedProducts = await relatedStorefrontProducts(fastify, tenantId, tenantSlug, product.id, product.categoryId, readText(product.verticalData, "brand"));

  return {
    product: storefrontProductDetail(product, tenantSlug),
    relatedProducts: relatedProducts
      .slice(0, 4),
    frequentlyBoughtTogether: relatedProducts
      .slice(4, 8),
  };
}

async function searchStorefrontProducts(
  fastify: FastifyInstance,
  tenantId: string,
  tenantSlug: string,
  query: z.infer<typeof storefrontSearchQuerySchema>,
) {
  const result = await listProducts(fastify, tenantSlug, tenantId, {
    search: query.query,
    limit: query.limit,
    page: 1,
    pageSize: query.limit,
    sort: "FEATURED",
    discountOnly: false,
  });

  const normalizedQuery = normalizeSearchValue(query.query);
  const suggestions = result.data
    .sort((left, right) => storefrontSearchRank(left, normalizedQuery) - storefrontSearchRank(right, normalizedQuery))
    .slice(0, query.limit);

  return {
    query: query.query,
    suggestions,
  };
}

function visibleCategoryProductScope(tenantId: string): Prisma.CategoryWhereInput[] {
  return [
    {
      products: {
        some: {
          tenantId,
          isActive: true,
          ecommerceDisabled: false,
          currentStock: {
            gt: 0,
          },
        },
      },
    },
    {
      children: {
        some: {
          isActive: true,
          products: {
            some: {
              tenantId,
              isActive: true,
              ecommerceDisabled: false,
              currentStock: {
                gt: 0,
              },
            },
          },
        },
      },
    },
  ];
}

type StorefrontCatalogProduct = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  description: string | null;
  categoryId: string | null;
  categoryName: string;
  categoryParentId: string | null;
  unit: string;
  mrp: number;
  sellingPrice: number;
  defaultDiscountPercent: number | null;
  discountPercent: number;
  gstRate: number;
  hsnCode: string | null;
  currentStock: number;
  imageUrl: string | null;
  brand: string | null;
  size: string | null;
  color: string | null;
  hasVariants: boolean;
  grouped: boolean;
  groupId: string | null;
  groupName: string | null;
  variantAttributeLabel: string | null;
  variantCount: number;
  variantLabels: string[];
  defaultVariantLabel: string | null;
};

function storefrontProductCard(
  product: {
    id: string;
    name: string;
    sku: string | null;
    barcode: string | null;
    description: string | null;
    unit: string;
    mrp: { toNumber(): number };
    sellingPrice: { toNumber(): number };
    defaultDiscountPercent: { toNumber(): number } | null;
    gstRate: { toNumber(): number };
    hsnCode: string | null;
    currentStock: { toNumber(): number };
    imageUrl: string | null;
    verticalData: unknown;
    categoryId: string | null;
    category: { id: string; name: string; parentId: string | null } | null;
    variants: Array<{
      id: string;
      name: string;
      sku: string | null;
      barcode: string | null;
      sellingPrice: { toNumber(): number };
      mrp: { toNumber(): number };
      currentStock: { toNumber(): number };
      attributes: unknown;
    }>;
  },
  tenantSlug: string,
): StorefrontCatalogProduct {
  const brand = readText(product.verticalData, "brand");
  const size = readText(product.verticalData, "size");
  const color = readText(product.verticalData, "color");
  const mrp = product.mrp.toNumber();
  const sellingPrice = product.sellingPrice.toNumber();
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    description: product.description,
    categoryId: product.categoryId,
    categoryName: product.category?.name ?? "Featured",
    categoryParentId: product.category?.parentId ?? null,
    unit: product.unit,
    mrp,
    sellingPrice,
    defaultDiscountPercent: product.defaultDiscountPercent?.toNumber() ?? null,
    discountPercent: mrp > sellingPrice && mrp > 0 ? Math.round(((mrp - sellingPrice) / mrp) * 100) : 0,
    gstRate: product.gstRate.toNumber(),
    hsnCode: product.hsnCode,
    currentStock: product.currentStock.toNumber(),
    imageUrl: product.imageUrl ? `/api/public/storefront/${tenantSlug}/products/${product.id}/image` : null,
    brand,
    size,
    color,
    hasVariants: product.variants.length > 0,
    grouped: false,
    groupId: null,
    groupName: null,
    variantAttributeLabel: null,
    variantCount: product.variants.length,
    variantLabels: size ? [size] : [],
    defaultVariantLabel: size,
  };
}

function storefrontProductDetail(
  product: Parameters<typeof storefrontProductCard>[0],
  tenantSlug: string,
  family?: {
    familyId: string;
    familyName: string;
    attributeLabel: string;
    familyItems: Array<{
      id: string;
      productId: string;
      variantLabel: string;
      sortOrder: number;
      isDefault: boolean;
      product: {
        id: string;
        name: string;
        sku: string | null;
        barcode: string | null;
        unit: string;
        mrp: { toNumber(): number };
        sellingPrice: { toNumber(): number };
        currentStock: { toNumber(): number };
        imageUrl: string | null;
      };
    }>;
  },
) {
  const base = storefrontProductCard(product, tenantSlug);
  const familyVariants = family?.familyItems.map((item) => ({
    id: item.id,
    productId: item.productId,
    label: item.variantLabel,
    name: item.product.name,
    sku: item.product.sku,
    barcode: item.product.barcode,
    sellingPrice: item.product.sellingPrice.toNumber(),
    mrp: item.product.mrp.toNumber(),
    currentStock: item.product.currentStock.toNumber(),
    imageUrl: item.product.imageUrl ? `/api/public/storefront/${tenantSlug}/products/${item.productId}/image` : null,
    unit: item.product.unit,
    attributes: {
      [family.attributeLabel.toLowerCase()]: item.variantLabel,
    },
  })) ?? [];

  return {
    ...base,
    ...(family ? {
      grouped: true,
      groupId: family.familyId,
      groupName: family.familyName,
      variantAttributeLabel: family.attributeLabel,
      variantCount: family.familyItems.length,
      variantLabels: family.familyItems.map((item) => item.variantLabel),
      defaultVariantLabel: family.familyItems.find((item) => item.isDefault)?.variantLabel ?? family.familyItems[0]?.variantLabel ?? null,
    } : {}),
    variants: familyVariants.length > 0
      ? familyVariants
      : product.variants.map((variant) => ({
        id: variant.id,
        productId: product.id,
        label: variant.name,
        name: variant.name,
        sku: variant.sku,
        barcode: variant.barcode,
        sellingPrice: variant.sellingPrice.toNumber(),
        mrp: variant.mrp.toNumber(),
        currentStock: variant.currentStock.toNumber(),
        imageUrl: product.imageUrl ? `/api/public/storefront/${tenantSlug}/products/${product.id}/image` : null,
        unit: product.unit,
        attributes: asRecord(variant.attributes),
      })),
    specifications: [
      { label: "Brand", value: readText(product.verticalData, "brand") },
      { label: "Size", value: readText(product.verticalData, "size") },
      { label: "Color", value: readText(product.verticalData, "color") },
      ...(familyVariants.length > 0 ? [{ label: family?.attributeLabel ?? "Variants", value: familyVariants.map((variant) => variant.label).join(", ") }] : []),
      { label: "HSN", value: product.hsnCode },
      { label: "GST", value: `${String(product.gstRate.toNumber())}%` },
      { label: "Barcode", value: product.barcode },
      { label: "SKU", value: product.sku },
    ].filter((item): item is { label: string; value: string } => Boolean(item.value)),
  };
}

function collectStorefrontFilters(products: Array<ReturnType<typeof storefrontProductCard>>) {
  return {
    brands: uniqueValues(products.map((product) => product.brand)),
    sizes: uniqueValues(products.flatMap((product) => product.variantLabels.length > 0 ? product.variantLabels : [product.size])),
    colors: uniqueValues(products.map((product) => product.color)),
    priceRange: {
      min: products.reduce((min, product) => Math.min(min, product.sellingPrice), products[0]?.sellingPrice ?? 0),
      max: products.reduce((max, product) => Math.max(max, product.sellingPrice), products[0]?.sellingPrice ?? 0),
    },
  };
}

function uniqueValues(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))].sort((left, right) => left.localeCompare(right));
}

function groupStorefrontProducts(
  products: Array<ReturnType<typeof storefrontProductCard>>,
  familyMap: ReturnType<typeof buildFamilyProductMap>,
) {
  const groupedProducts: Array<ReturnType<typeof storefrontProductCard>> = [];
  const seenFamilies = new Set<string>();

  for (const product of products) {
    const family = familyMap.get(product.id);
    if (!family) {
      groupedProducts.push(product);
      continue;
    }
    if (seenFamilies.has(family.familyId)) {
      continue;
    }

    const visibleItems = family.items.filter((item) =>
      item.product.isActive &&
      !item.product.ecommerceDisabled &&
      item.product.currentStock.toNumber() > 0);
    if (visibleItems.length === 0) {
      continue;
    }

    const defaultItem = chooseDefaultFamilyProduct(visibleItems);
    const representative = products.find((candidate) => candidate.id === defaultItem.productId) ?? product;
    const variantLabels = visibleItems
      .map((item) => item.variantLabel)
      .filter((value, index, list) => list.indexOf(value) === index)
      .sort((left, right) => sortVariantLabel(left) - sortVariantLabel(right) || left.localeCompare(right));

    groupedProducts.push({
      ...representative,
      name: family.familyName,
      grouped: true,
      groupId: family.familyId,
      groupName: family.familyName,
      hasVariants: visibleItems.length > 1,
      variantAttributeLabel: family.attributeLabel,
      variantCount: visibleItems.length,
      variantLabels,
      defaultVariantLabel: defaultItem.variantLabel,
      size: defaultItem.variantLabel,
      currentStock: visibleItems.reduce((sum, item) => sum + item.product.currentStock.toNumber(), 0),
    });
    seenFamilies.add(family.familyId);
  }

  return groupedProducts;
}

function sortStorefrontProducts(
  products: Array<ReturnType<typeof storefrontProductCard>>,
  sort: "DISCOUNT" | "FEATURED" | "NAME" | "NEWEST" | "PRICE_ASC" | "PRICE_DESC",
) {
  const sorted = [...products];
  if (sort === "PRICE_ASC") {
    return sorted.sort((left, right) => left.sellingPrice - right.sellingPrice || left.name.localeCompare(right.name));
  }
  if (sort === "PRICE_DESC") {
    return sorted.sort((left, right) => right.sellingPrice - left.sellingPrice || left.name.localeCompare(right.name));
  }
  if (sort === "DISCOUNT") {
    return sorted.sort((left, right) => right.discountPercent - left.discountPercent || left.name.localeCompare(right.name));
  }
  if (sort === "NAME") {
    return sorted.sort((left, right) => left.name.localeCompare(right.name));
  }
  if (sort === "NEWEST") {
    return sorted.sort((left, right) => right.id.localeCompare(left.id));
  }

  return sorted.sort((left, right) =>
    right.discountPercent - left.discountPercent ||
    right.currentStock - left.currentStock ||
    left.name.localeCompare(right.name));
}

async function relatedStorefrontProducts(
  fastify: FastifyInstance,
  tenantId: string,
  tenantSlug: string,
  productId: string,
  categoryId: string | null,
  brand: string | null,
) {
  const categoryIds = categoryId ? await storefrontCategoryScope(fastify, tenantId, categoryId) : [];
  const relatedCandidates = await fastify.prisma.product.findMany({
    where: {
      tenantId,
      isActive: true,
      ecommerceDisabled: false,
      currentStock: {
        gt: 0,
      },
      id: {
        not: productId,
      },
    },
    include: {
      category: {
        select: {
          id: true,
          name: true,
          parentId: true,
        },
      },
      variants: {
        where: {
          isActive: true,
          currentStock: {
            gt: 0,
          },
        },
      },
    },
    take: 24,
    orderBy: {
      name: "asc",
    },
  });

  const families = await listTenantProductFamilies(fastify, tenantId);
  const familyMap = buildFamilyProductMap(families);
  return groupStorefrontProducts(
    relatedCandidates
      .map((item) => storefrontProductCard(item, tenantSlug))
      .map((item) => ({
        ...item,
        _score: (
          (item.categoryId && categoryIds.includes(item.categoryId) ? 4 : 0) +
          (brand && item.brand === brand ? 3 : 0) +
          (item.hasVariants ? 1 : 0)
        ),
      }))
      .filter((candidate) => candidate._score > 0)
      .sort((left, right) => right._score - left._score || left.name.localeCompare(right.name))
      .map((candidate) => {
        const next = { ...candidate };
        delete (next as { _score?: number })._score;
        return next;
      }),
    familyMap,
  ).slice(0, 8);
}

function storefrontSearchRank(product: ReturnType<typeof storefrontProductCard>, normalizedQuery: string): number {
  const name = normalizeSearchValue(product.name);
  const brand = normalizeSearchValue(product.brand);
  const sku = normalizeSearchValue(product.sku);
  const barcode = normalizeSearchValue(product.barcode);
  const category = normalizeSearchValue(product.categoryName);
  const variants = product.variantLabels.map((value) => normalizeSearchValue(value));

  if (barcode === normalizedQuery) return 0;
  if (sku === normalizedQuery) return 1;
  if (name === normalizedQuery) return 2;
  if (name.startsWith(normalizedQuery)) return 3;
  if (brand.startsWith(normalizedQuery)) return 4;
  if (category.startsWith(normalizedQuery)) return 5;
  if (variants.some((value) => value === normalizedQuery)) return 6;
  if (variants.some((value) => value.startsWith(normalizedQuery))) return 7;
  if (name.includes(normalizedQuery)) return 6;
  if (brand.includes(normalizedQuery)) return 7;
  if (category.includes(normalizedQuery)) return 8;
  return 9;
}

function normalizeSearchValue(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

async function storefrontCategoryScope(fastify: FastifyInstance, tenantId: string, categoryId: string): Promise<string[]> {
  const category = await fastify.prisma.category.findFirst({
    where: {
      id: categoryId,
      tenantId,
      isActive: true,
      parentId: null,
    },
    include: {
      children: {
        where: {
          isActive: true,
        },
        select: {
          id: true,
        },
      },
    },
  });

  if (!category) {
    return [categoryId];
  }

  return [category.id, ...category.children.map((child) => child.id)];
}

async function buildCart(
  fastify: FastifyInstance,
  tenantId: string,
  inputItems: Array<{ productId: string; quantity: number }>,
) {
  const quantityByProduct = new Map<string, number>();
  for (const item of inputItems) {
    quantityByProduct.set(item.productId, roundQuantity((quantityByProduct.get(item.productId) ?? 0) + item.quantity));
  }

  const products = await fastify.prisma.product.findMany({
    where: {
      tenantId,
      id: {
        in: [...quantityByProduct.keys()],
      },
      isActive: true,
      ecommerceDisabled: false,
    },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  if (products.length !== quantityByProduct.size) {
    throw new StorefrontError("One or more cart items are no longer available", 400);
  }

  const items = [];
  for (const [productId, quantity] of quantityByProduct) {
    const product = productById.get(productId);
    if (!product) {
      throw new StorefrontError("One or more cart items are no longer available", 400);
    }

    const stock = product.currentStock.toNumber();
    if (stock <= 0) {
      throw new StorefrontError(`${product.name} is currently out of stock`, 409);
    }
    if (quantity > stock + 0.0005) {
      throw new StorefrontError(`${product.name} has only ${formatQuantity(stock)} ${product.unit} available`, 409);
    }

    const sellingPrice = product.sellingPrice.toNumber();
    items.push({
      productId,
      name: product.name,
      quantity,
      unit: product.unit,
      sellingPrice,
      lineTotal: roundMoney(sellingPrice * quantity),
    });
  }

  return {
    items,
    subtotal: roundMoney(items.reduce((sum, item) => sum + item.lineTotal, 0)),
  };
}

async function validateCoupon(fastify: FastifyInstance, tenantId: string, code: string, orderTotal: number) {
  const coupon = await fastify.prisma.coupon.findFirst({
    where: {
      tenantId,
      code: code.toUpperCase(),
      isActive: true,
    },
  });

  if (!coupon) {
    throw new StorefrontError("Coupon not found", 404);
  }

  const now = new Date();
  if (now < coupon.validFrom || now > coupon.validUntil) {
    throw new StorefrontError("Coupon expired or not yet active", 400);
  }
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
    throw new StorefrontError("Coupon usage limit reached", 400);
  }
  if (coupon.minOrderValue !== null && orderTotal < coupon.minOrderValue.toNumber()) {
    throw new StorefrontError(`Minimum order value is Rs ${coupon.minOrderValue.toNumber().toFixed(2)}`, 400);
  }

  const rawDiscount = coupon.discountType === "FLAT"
    ? coupon.discountValue.toNumber()
    : orderTotal * coupon.discountValue.toNumber() / 100;
  const cappedDiscount = coupon.maxDiscount !== null ? Math.min(rawDiscount, coupon.maxDiscount.toNumber()) : rawDiscount;

  return {
    id: coupon.id,
    code: coupon.code,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue.toNumber(),
    discount: roundMoney(Math.min(cappedDiscount, orderTotal)),
  };
}

async function findDefaultStore(fastify: FastifyInstance, tenantId: string) {
  return fastify.prisma.store.findFirst({
    where: {
      tenantId,
      isActive: true,
    },
    orderBy: [
      { isDefault: "desc" },
      { createdAt: "asc" },
    ],
  });
}

async function updateAuthenticatedCustomer(
  fastify: FastifyInstance,
  tenantId: string,
  customerId: string,
  input: {
    name: string;
    phone: string;
    email?: string | undefined;
    address: string;
    city?: string | undefined;
    state?: string | undefined;
    postalCode?: string | undefined;
  },
) {
  const customer = await fastify.prisma.customer.findFirst({
    where: {
      id: customerId,
      tenantId,
    },
  });
  if (!customer) {
    throw new StorefrontError("Customer account was not found", 401);
  }

  return fastify.prisma.customer.update({
    where: {
      id: customer.id,
    },
    data: customerUpdateData(input),
  });
}

async function findOrCreateCustomer(
  fastify: FastifyInstance,
  tenantId: string,
  input: {
    name: string;
    phone: string;
    email?: string | undefined;
    address: string;
    city?: string | undefined;
    state?: string | undefined;
    postalCode?: string | undefined;
  },
) {
  const normalizedPhone = normalizePhone(input.phone);
  const existing = await fastify.prisma.customer.findFirst({
    where: {
      tenantId,
      phone: normalizedPhone,
    },
  });

  if (existing) {
    return fastify.prisma.customer.update({
      where: {
        id: existing.id,
      },
      data: customerUpdateData(input),
    });
  }

  return fastify.prisma.customer.create({
    data: {
      tenantId,
      customerCode: `WEB-${Date.now().toString(36).toUpperCase()}`,
      remarks: "Created from online store",
      ...customerUpdateData(input),
    },
  });
}

async function createOrUpdateEcommerceCustomer(
  fastify: FastifyInstance,
  tenantId: string,
  input: z.infer<typeof storefrontCustomerRegisterSchema>,
  passwordHash: string,
) {
  const normalizedPhone = normalizePhone(input.phone);
  const existing = await fastify.prisma.customer.findFirst({
    where: {
      tenantId,
      phone: normalizedPhone,
    },
  });

  if (existing) {
    return fastify.prisma.customer.update({
      where: {
        id: existing.id,
      },
      data: {
        ...customerUpdateData(input),
        ecommercePasswordHash: passwordHash,
      },
    });
  }

  return fastify.prisma.customer.create({
    data: {
      tenantId,
      customerCode: `WEB-${Date.now().toString(36).toUpperCase()}`,
      remarks: "Created from online store customer signup",
      ecommercePasswordHash: passwordHash,
      ...customerUpdateData(input),
    },
  });
}

function customerUpdateData(input: {
  name: string;
  phone: string;
  email?: string | undefined;
  address: string;
  city?: string | undefined;
  state?: string | undefined;
  postalCode?: string | undefined;
}) {
  return {
    name: input.name,
    phone: normalizePhone(input.phone),
    ...(input.email ? { email: input.email } : {}),
    address: input.address,
    ...(input.city ? { city: input.city } : {}),
    ...(input.state ? { state: input.state } : {}),
    ...(input.postalCode ? { postalCode: input.postalCode } : {}),
  };
}

async function createStorefrontDelivery(
  delivery: DeliveryService,
  tenant: Tenant,
  input: {
    invoiceId: string;
    customerId: string;
    deliveryAddress: string;
    notes?: string | undefined;
    scheduledAt?: Date | undefined;
  },
  fastify: FastifyInstance,
) {
  try {
    return await delivery.createDelivery(tenant, {
      invoiceId: input.invoiceId,
      customerId: input.customerId,
      deliveryAddress: input.deliveryAddress,
      priority: 20,
      ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
      notes: input.notes ? `Online order: ${input.notes}` : "Online order",
    });
  } catch (error) {
    if (error instanceof DeliveryError) {
      fastify.log.warn({ error, invoiceId: input.invoiceId, tenantId: tenant.id }, "Storefront delivery record was not created");
      return null;
    }

    throw error;
  }
}

async function setInvoiceCouponCode(fastify: FastifyInstance, tenantId: string, invoiceId: string, code: string) {
  await fastify.prisma.invoice.updateMany({
    where: {
      id: invoiceId,
      tenantId,
    },
    data: {
      couponCode: code,
    },
  });
}

async function incrementCouponUse(fastify: FastifyInstance, tenantId: string, couponId: string) {
  await fastify.prisma.coupon.updateMany({
    where: {
      id: couponId,
      tenantId,
    },
    data: {
      usedCount: {
        increment: 1,
      },
    },
  });
}

async function markVerifiedCouponUsed(
  fastify: FastifyInstance,
  tenantId: string,
  invoiceId: string,
  metadata: Record<string, unknown>,
) {
  if (metadata.couponUsed === true) {
    return;
  }

  const couponId = readString(metadata.coupon, "id");
  if (!couponId) {
    return;
  }

  await incrementCouponUse(fastify, tenantId, couponId);
  await updateInvoiceMetadata(fastify, tenantId, invoiceId, {
    ...metadata,
    couponUsed: true,
    paymentVerifiedAt: new Date().toISOString(),
  });
}

async function updateInvoiceMetadata(fastify: FastifyInstance, tenantId: string, invoiceId: string, metadata: Record<string, unknown>) {
  await fastify.prisma.invoice.updateMany({
    where: {
      id: invoiceId,
      tenantId,
    },
    data: {
      verticalData: metadata as Prisma.InputJsonValue,
    },
  });
}

async function createRazorpayOrder(
  fastify: FastifyInstance,
  tenant: Tenant,
  config: RazorpayConfig,
  invoiceId: string,
  invoiceNumber: string,
  amount: number,
) {
  const Razorpay = (await import("razorpay")).default;
  const razorpay = new Razorpay({
    key_id: config.keyId,
    key_secret: config.keySecret,
  });

  const order = await razorpay.orders.create({
    amount: Math.round(amount * 100),
    currency: "INR",
    receipt: invoiceNumber,
    notes: {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      invoiceId,
      source: "ECOMMERCE",
      provider: config.provider,
    },
  });

  const id = readString(order, "id");
  if (!id) {
    throw new StorefrontError("Razorpay order could not be created", 502);
  }

  return {
    id,
    amount: Number(readString(order, "amount") ?? Math.round(amount * 100)),
  };
}

function verifyRazorpaySignature(input: z.infer<typeof storefrontRazorpayVerifySchema>, keySecret: string): void {
  const expected = createHmac("sha256", keySecret)
    .update(`${input.razorpayOrderId}|${input.razorpayPaymentId}`)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(input.razorpaySignature);

  if (expectedBuffer.length !== signatureBuffer.length || !timingSafeEqual(expectedBuffer, signatureBuffer)) {
    throw new StorefrontError("Payment verification failed", 400);
  }
}

async function recordStorefrontPayment(
  fastify: FastifyInstance,
  tenantId: string,
  invoiceId: string,
  amount: number,
  razorpayPaymentId: string,
) {
  const existing = await fastify.prisma.payment.findFirst({
    where: {
      tenantId,
      razorpayId: razorpayPaymentId,
    },
  });
  if (existing) {
    return existing;
  }

  return fastify.prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: {
        id: invoiceId,
        tenantId,
        status: {
          notIn: [InvoiceStatus.DRAFT, InvoiceStatus.PENDING_WHATSAPP, InvoiceStatus.CANCELLED],
        },
      },
    });
    if (!invoice) {
      throw new StorefrontError("Confirmed invoice not found for payment", 404);
    }

    const store = invoice.storeId
      ? { id: invoice.storeId }
      : await tx.store.findFirst({
          where: {
            tenantId,
            isActive: true,
          },
          orderBy: [
            { isDefault: "desc" },
            { createdAt: "asc" },
          ],
        });
    if (!store?.id) {
      throw new StorefrontError("Store is not configured for payments", 409);
    }

    const paymentMethod = await tx.paymentMethod.findFirst({
      where: {
        tenantId,
        storeId: store.id,
        shortCode: PaymentMode.UPI,
        isActive: true,
        deletedAt: null,
      },
    });
    if (!paymentMethod) {
      throw new StorefrontError("UPI payment method is not configured", 409);
    }

    const amountDue = invoice.amountDue.toNumber();
    const paymentAmount = Math.min(roundMoney(amount), amountDue);
    if (paymentAmount <= 0.01) {
      return null;
    }

    const payment = await tx.payment.create({
      data: {
        tenantId,
        invoiceId,
        amount: paymentAmount,
        paymentMethodId: paymentMethod.id,
        mode: PaymentMode.UPI,
        createdBy: "storefront",
        razorpayId: razorpayPaymentId,
        referenceNumber: razorpayPaymentId,
      },
    });
    const nextAmountPaid = roundMoney(invoice.amountPaid.toNumber() + paymentAmount);
    const nextAmountDue = Math.max(roundMoney(invoice.grandTotal.toNumber() - nextAmountPaid), 0);

    await tx.invoice.update({
      where: {
        id: invoiceId,
      },
      data: {
        amountPaid: nextAmountPaid,
        amountDue: nextAmountDue,
        status: nextAmountDue <= 0.01 ? InvoiceStatus.PAID : InvoiceStatus.PARTIAL,
        paymentMode: PaymentMode.UPI,
        paymentMethodId: paymentMethod.id,
      },
    });

    return payment;
  });
}

function resolveRazorpayConfig(settings: StorefrontSettings, forcedProvider?: string): RazorpayConfig | null {
  const provider = forcedProvider && forcedProvider in StorefrontPaymentProvider
    ? StorefrontPaymentProvider[forcedProvider as keyof typeof StorefrontPaymentProvider]
    : settings.paymentProvider;

  if (provider === StorefrontPaymentProvider.TENANT_RAZORPAY) {
    const keySecret = decryptStorefrontSecret(settings.tenantRazorpayKeySecretCiphertext);
    if (settings.tenantRazorpayKeyId && keySecret) {
      return {
        provider,
        keyId: settings.tenantRazorpayKeyId,
        keySecret,
      };
    }
  }

  if (provider === StorefrontPaymentProvider.PLATFORM_RAZORPAY || !provider) {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (keyId && keySecret) {
      return {
        provider: StorefrontPaymentProvider.PLATFORM_RAZORPAY,
        keyId,
        keySecret,
      };
    }
  }

  return null;
}

function orderResponse(
  invoice: {
    id: string;
    invoiceNumber: string;
    status: InvoiceStatus;
    subtotal: { toNumber(): number };
    totalDiscount: { toNumber(): number };
    totalCgst: { toNumber(): number };
    totalSgst: { toNumber(): number };
    deliveryCharge: { toNumber(): number };
    grandTotal: { toNumber(): number };
    amountDue: { toNumber(): number };
    items: Array<{
      productId: string;
      productName: string;
      quantity: { toNumber(): number };
      unit: string;
      sellingPrice: { toNumber(): number };
      total: { toNumber(): number };
    }>;
  },
  deliveryId: string | null,
  deliveryAddress: unknown,
) {
  return {
    invoiceId: invoice.id,
    orderNumber: invoice.invoiceNumber,
    status: invoice.status,
    subtotal: invoice.subtotal.toNumber(),
    totalDiscount: invoice.totalDiscount.toNumber(),
    totalCgst: invoice.totalCgst.toNumber(),
    totalSgst: invoice.totalSgst.toNumber(),
    deliveryCharge: invoice.deliveryCharge.toNumber(),
    grandTotal: invoice.grandTotal.toNumber(),
    amountDue: invoice.amountDue.toNumber(),
    deliveryId,
    deliveryAddress: typeof deliveryAddress === "string" ? deliveryAddress : "",
    items: invoice.items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity.toNumber(),
      unit: item.unit,
      sellingPrice: item.sellingPrice.toNumber(),
      total: item.total.toNumber(),
    })),
  };
}

function setCustomerCookie(fastify: FastifyInstance, reply: FastifyReply, tenantId: string, customerId: string): void {
  const token = fastify.jwt.sign(
    {
      userId: customerId,
      customerId,
      tenantId,
      role: UserRole.STAFF,
      tokenType: "storefront_customer",
    },
    {
      expiresIn: "30d",
    },
  );
  reply.header("Set-Cookie", serializeCookie(storefrontCustomerCookie, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/api/public/storefront",
    maxAge: 30 * 24 * 60 * 60,
  }));
}

function clearCustomerCookie(reply: FastifyReply): void {
  reply.header("Set-Cookie", serializeCookie(storefrontCustomerCookie, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/api/public/storefront",
    maxAge: 0,
  }));
}

function readStorefrontCustomerId(fastify: FastifyInstance, request: FastifyRequest, tenantId: string): string | null {
  const token = getCookieValue(request.headers.cookie, storefrontCustomerCookie);
  if (!token) {
    return null;
  }

  try {
    const payload = fastify.jwt.verify<{
      customerId?: string;
      tenantId?: string;
      tokenType?: string;
    }>(token);
    const customerId = typeof payload.customerId === "string" ? payload.customerId : null;
    if (payload.tokenType !== "storefront_customer" || payload.tenantId !== tenantId || !customerId) {
      return null;
    }

    return customerId;
  } catch {
    return null;
  }
}

function customerResponse(customer: {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}) {
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    city: customer.city,
    state: customer.state,
    postalCode: customer.postalCode,
  };
}

function orderNotes(notes: string | undefined): string {
  return notes ? `Online order. Delivery note: ${notes}` : "Online order";
}

function calculateDeliveryCharge(orderTotal: number, settings: StorefrontSettings): number {
  const charge = settings.deliveryCharge.toNumber();
  const freeAbove = settings.freeDeliveryAbove.toNumber();
  if (charge <= 0) {
    return 0;
  }

  return freeAbove > 0 && orderTotal >= freeAbove ? 0 : charge;
}

async function uniqueFamilySlug(
  fastify: FastifyInstance,
  tenantId: string,
  name: string,
  ignoreFamilyId?: string,
): Promise<string> {
  const base = slugifyFamilyName(name) || "product-family";
  let candidate = base;
  let attempt = 1;

  for (;;) {
    const existing = await fastify.prisma.ecommerceProductFamily.findFirst({
      where: {
        tenantId,
        slug: candidate,
        ...(ignoreFamilyId ? { id: { not: ignoreFamilyId } } : {}),
      },
      select: {
        id: true,
      },
    });
    if (!existing) {
      return candidate;
    }
    attempt += 1;
    candidate = `${base}-${String(attempt)}`;
  }
}

async function normalizeFamilyDefaults(fastify: FastifyInstance, tenantId: string, familyId: string): Promise<void> {
  const items = await fastify.prisma.ecommerceProductFamilyItem.findMany({
    where: {
      tenantId,
      familyId,
    },
    include: {
      product: true,
    },
    orderBy: [
      { sortOrder: "asc" },
      { createdAt: "asc" },
    ],
  });
  if (items.length === 0) {
    return;
  }

  const defaultItem = items.find((item) => item.isDefault && item.product.currentStock.toNumber() > 0)
    ?? items.find((item) => item.isDefault)
    ?? items.find((item) => item.product.currentStock.toNumber() > 0)
    ?? items[0];
  if (!defaultItem) {
    return;
  }

  await fastify.prisma.$transaction(items.map((item) =>
    fastify.prisma.ecommerceProductFamilyItem.update({
      where: {
        id: item.id,
      },
      data: {
        isDefault: item.id === defaultItem.id,
      },
    })));
}

function storefrontRootDomain(): string {
  return normalizeHost(process.env.STOREFRONT_ROOT_DOMAIN ?? "bizbil.com") ?? "bizbil.com";
}

function defaultHostnameForTenant(tenant: Tenant, settings: StorefrontSettings): string {
  return defaultHostnameForSubdomain(settings.subdomain ?? tenant.slug);
}

function defaultHostnameForSubdomain(subdomain: string): string {
  return `${subdomain}.${storefrontRootDomain()}`;
}

function forwardedHost(request: FastifyRequest): string | undefined {
  const forwarded = request.headers["x-forwarded-host"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]?.trim();
  }

  return request.headers.host;
}

function normalizeHost(host: string | undefined): string | null {
  if (!host) {
    return null;
  }

  const withoutProtocol = host.trim().toLowerCase().replace(/^https?:\/\//, "");
  const firstHost = withoutProtocol.split("/")[0] ?? withoutProtocol;
  const withoutPort = firstHost.replace(/:\d+$/, "").replace(/\.$/, "");
  if (!withoutPort || withoutPort === "localhost" || withoutPort === "127.0.0.1" || withoutPort === "::1") {
    return null;
  }

  return withoutPort;
}

function storefrontSubdomainFromHost(hostname: string): string | null {
  const root = storefrontRootDomain();
  const suffix = `.${root}`;
  if (!hostname.endsWith(suffix)) {
    return null;
  }

  const subdomain = hostname.slice(0, -suffix.length);
  return subdomain && !subdomain.includes(".") && subdomain !== "www" ? subdomain : null;
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function couponLabel(coupon: { discountType: string; discountValue: number; discount: number }): string {
  if (coupon.discountType === "PERCENTAGE") {
    return `${String(coupon.discountValue)}% off`;
  }

  return `Rs ${coupon.discount.toFixed(2)} off`;
}

function contentTypeForImageObject(objectName: string): string {
  if (objectName.endsWith(".png")) return "image/png";
  if (objectName.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function extensionForContentType(contentType: string): "jpg" | "png" | "webp" {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

function storefrontMediaMaxBytes(asset: "logo" | "banner-1" | "banner-2"): number {
  return asset === "logo" ? storefrontLogoMaxBytes : storefrontBannerMaxBytes;
}

function storefrontMediaLabel(asset: "logo" | "banner-1" | "banner-2"): string {
  return asset === "logo" ? "Logo" : asset === "banner-1" ? "Banner 1" : "Banner 2";
}

function formatKilobytes(bytes: number): string {
  return String(Math.floor(bytes / 1024));
}

function ensureStorefrontMediaManager(role: UserRole): void {
  if (role !== UserRole.OWNER && role !== UserRole.MANAGER) {
    throw new StorefrontError("Only owners and managers can manage ecommerce media", 403);
  }
}

function storefrontMediaObjectForAsset(settings: StorefrontSettings, tenant: Pick<Tenant, "logoUrl">, asset: "logo" | "banner-1" | "banner-2"): string | null {
  if (asset === "logo") {
    return settings.logoUrl ?? tenant.logoUrl ?? null;
  }

  return storefrontCustomizations(settings.customizations).banners[asset] ?? null;
}

function storefrontOwnedMediaObjectForAsset(settings: StorefrontSettings, asset: "logo" | "banner-1" | "banner-2"): string | null {
  if (asset === "logo") {
    return settings.logoUrl ?? null;
  }

  return storefrontCustomizations(settings.customizations).banners[asset] ?? null;
}

function storefrontBannerUrls(settings: StorefrontSettings, tenantSlug: string): Array<{ slot: "banner-1" | "banner-2"; imageUrl: string }> {
  const banners = storefrontCustomizations(settings.customizations).banners;
  return (["banner-1", "banner-2"] as const)
    .filter((slot) => Boolean(banners[slot]))
    .map((slot) => ({
      slot,
      imageUrl: `/api/public/storefront/${tenantSlug}/media/${slot}`,
    }));
}

function updateStorefrontMediaCustomization(value: unknown, asset: "logo" | "banner-1" | "banner-2", objectName: string): Record<string, unknown> {
  const current = storefrontCustomizations(value);
  return {
    ...current.raw,
    media: {
      ...current.mediaRaw,
      banners: {
        ...current.banners,
        ...(asset === "logo" ? {} : { [asset]: objectName }),
      },
    },
  };
}

function removeStorefrontMediaCustomization(value: unknown, asset: "logo" | "banner-1" | "banner-2"): Record<string, unknown> {
  const current = storefrontCustomizations(value);
  const nextBanners = asset === "banner-1"
    ? { ...(current.banners["banner-2"] ? { "banner-2": current.banners["banner-2"] } : {}) }
    : asset === "banner-2"
      ? { ...(current.banners["banner-1"] ? { "banner-1": current.banners["banner-1"] } : {}) }
      : current.banners;

  return {
    ...current.raw,
    media: {
      ...current.mediaRaw,
      banners: nextBanners,
    },
  };
}

function storefrontCustomizations(value: unknown): {
  raw: Record<string, unknown>;
  mediaRaw: Record<string, unknown>;
  banners: Partial<Record<"banner-1" | "banner-2", string>>;
} {
  const raw = asRecord(value);
  const mediaRaw = asRecord(raw.media);
  const bannerRaw = asRecord(mediaRaw.banners);
  const banners: Partial<Record<"banner-1" | "banner-2", string>> = {};
  for (const slot of ["banner-1", "banner-2"] as const) {
    const banner = bannerRaw[slot];
    if (typeof banner === "string" && banner.trim()) {
      banners[slot] = banner;
    }
  }

  return { raw, mediaRaw, banners };
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function readString(record: unknown, key: string): string | undefined {
  const value = asRecord(record)[key];
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function cleanRequestPayload(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== ""));
}

async function hashPassword(value: string): Promise<string> {
  return hash(value, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
    path: string;
    maxAge: number;
  },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${String(options.maxAge)}`,
    `Path=${options.path}`,
    `SameSite=${options.sameSite}`,
  ];

  if (options.httpOnly) {
    parts.push("HttpOnly");
  }

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function formatSettings(settings: StorefrontSettings, tenant: Tenant) {
  return {
    id: settings.id,
    tenantId: settings.tenantId,
    status: settings.status,
    theme: settings.theme,
    subdomain: settings.subdomain,
    defaultHostname: defaultHostnameForTenant(tenant, settings),
    displayName: settings.displayName,
    logoUrl: storefrontMediaObjectForAsset(settings, tenant, "logo") ? "/api/storefront/media/logo/view" : null,
    heroTitle: settings.heroTitle,
    heroSubtitle: settings.heroSubtitle,
    primaryColor: settings.primaryColor,
    accentColor: settings.accentColor,
    allowGuestCheckout: settings.allowGuestCheckout,
    allowCustomerLogin: settings.allowCustomerLogin,
    allowCod: settings.allowCod,
    paymentProvider: settings.paymentProvider,
    tenantRazorpayKeyId: settings.tenantRazorpayKeyId,
    hasTenantRazorpaySecret: Boolean(settings.tenantRazorpayKeySecretCiphertext),
    deliveryCharge: settings.deliveryCharge.toString(),
    freeDeliveryAbove: settings.freeDeliveryAbove.toString(),
    banners: storefrontBannerUrls(settings, tenant.slug).map((banner) => ({
      ...banner,
      imageUrl: banner.imageUrl.replace(`/api/public/storefront/${tenant.slug}`, "/api/storefront"),
    })),
    customizations: settings.customizations,
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt,
  };
}

function formatSubscription(subscription: {
  module: PlatformModule;
  status: ModuleSubscriptionStatus;
  priceOverride: { toString(): string } | null;
  currency: string;
  billingCycle: string;
  requestedAt: Date | null;
  approvedAt: Date | null;
}) {
  return {
    ...subscription,
    priceOverride: subscription.priceOverride?.toString() ?? null,
  };
}

function formatModulePricing(pricing: {
  module: PlatformModule;
  displayName: string;
  description: string | null;
  basePrice: { toString(): string };
  currency: string;
  billingCycle: string;
  isActive: boolean;
}) {
  return {
    ...pricing,
    basePrice: pricing.basePrice.toString(),
  };
}

async function handleStorefront<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof StorefrontError || error instanceof BillingError || error instanceof DeliveryError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: "Validation failed",
        issues: error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    throw error;
  }
}
