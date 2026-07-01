"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Boxes,
  ChevronRight,
  CreditCard,
  Heart,
  History,
  Leaf,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  Minus,
  PackageCheck,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Tag,
  Trash2,
  Truck,
  User,
} from "lucide-react";

import {
  createStorefrontCheckout,
  getStorefrontCustomer,
  getStorefrontProductDetail,
  getStorefrontProducts,
  listStorefrontCustomerOrders,
  loginStorefrontCustomer,
  logoutStorefrontCustomer,
  registerStorefrontCustomer,
  storefrontImageUrl,
  type StorefrontBootstrap,
  type StorefrontCheckoutResponse,
  type StorefrontCustomer,
  type StorefrontOrder,
  type StorefrontProduct,
  type StorefrontProductDetail,
  validateStorefrontCoupon,
  verifyStorefrontRazorpay,
} from "@/lib/storefront-api";

type PortalPage =
  | { kind: "home" }
  | { kind: "category"; categoryId: string }
  | { kind: "search"; query: string }
  | { kind: "product"; productId: string }
  | { kind: "cart" }
  | { kind: "checkout" }
  | { kind: "account" }
  | { kind: "wishlist" };

interface StorefrontPortalProps {
  initialBootstrap: StorefrontBootstrap;
  locator: {
    tenantSlug: string;
    host?: string;
  };
  page: PortalPage;
}

interface CheckoutFormState {
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  notes: string;
  couponCode: string;
  paymentMethod: "COD" | "RAZORPAY";
}

interface AuthFormState {
  name: string;
  phone: string;
  email: string;
  password: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
}

interface CatalogFiltersState {
  brand: string;
  size: string;
  color: string;
  sort: "FEATURED" | "PRICE_ASC" | "PRICE_DESC" | "DISCOUNT" | "NAME" | "NEWEST";
}

interface RazorpaySuccessResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: "INR";
  name: string;
  description: string;
  order_id: string;
  prefill: {
    name: string;
    contact: string;
    email?: string | undefined;
  };
  theme: {
    color: string;
  };
  handler: (response: RazorpaySuccessResponse) => void;
  modal: {
    ondismiss: () => void;
  };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
  }
}

const emptyCheckoutForm: CheckoutFormState = {
  name: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  state: "",
  postalCode: "",
  notes: "",
  couponCode: "",
  paymentMethod: "COD",
};

const emptyAuthForm: AuthFormState = {
  name: "",
  phone: "",
  email: "",
  password: "",
  address: "",
  city: "",
  state: "",
  postalCode: "",
};

const emptyCatalogFilters: CatalogFiltersState = {
  brand: "",
  size: "",
  color: "",
  sort: "FEATURED",
};

interface StoreTheme {
  mode: "CLASSIC_RETAIL" | "PREMIUM_BRAND";
  page: string;
  ink: string;
  backdrop: string;
  header: string;
  topBar: string;
  panel: string;
  panelDivider: string;
  heroMuted: string;
  heroButton: string;
  heroShowcase: string;
  heroShelf: string;
  muted: string;
  iconMuted: string;
  primary: string;
  accent: string;
  primaryBg: string;
  accentBg: string;
  ctaBg: string;
  cartButton: string;
  productButton: string;
  accentText: string;
  softBg: string;
  outline: string;
  outlineActive: string;
  summary: string;
  line: string;
  empty: string;
  imageBg: string;
  productStage: string;
  stockBadge: string;
  progressTrack: string;
  quantity: string;
  activePayment: string;
  inactivePayment: string;
  errorBg: string;
  skeleton: string;
  uiFont: string;
  displayFont: string;
}

export function StorefrontPortal({ initialBootstrap, locator, page }: Readonly<StorefrontPortalProps>) {
  const router = useRouter();
  const tenantSlug = locator.tenantSlug;
  const [productCache, setProductCache] = useState<Record<string, StorefrontProduct>>(() => indexProducts(initialBootstrap.products));
  const [cart, setCart] = useState<Record<string, number>>({});
  const [wishlistIds, setWishlistIds] = useState<string[]>([]);
  const [recentlyViewedIds, setRecentlyViewedIds] = useState<string[]>([]);
  const [customer, setCustomer] = useState<StorefrontCustomer | null>(null);
  const [orders, setOrders] = useState<StorefrontOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authForm, setAuthForm] = useState<AuthFormState>(emptyAuthForm);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [checkoutForm, setCheckoutForm] = useState<CheckoutFormState>(emptyCheckoutForm);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [completedOrder, setCompletedOrder] = useState<StorefrontOrder | null>(null);
  const [coupon, setCoupon] = useState<{ code: string; discount: number; label: string } | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [catalogProducts, setCatalogProducts] = useState<StorefrontProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(page.kind === "category" || page.kind === "search");
  const [catalogError, setCatalogError] = useState("");
  const [catalogFilters, setCatalogFilters] = useState<CatalogFiltersState>(emptyCatalogFilters);
  const [productDetail, setProductDetail] = useState<StorefrontProductDetail | null>(null);
  const [productDetailLoading, setProductDetailLoading] = useState(page.kind === "product");
  const [productDetailError, setProductDetailError] = useState("");
  const [relatedProducts, setRelatedProducts] = useState<StorefrontProduct[]>([]);
  const [frequentlyBoughtTogether, setFrequentlyBoughtTogether] = useState<StorefrontProduct[]>([]);
  const [selectedVariantProductId, setSelectedVariantProductId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(page.kind === "search" ? page.query : "");

  const categories = initialBootstrap.categories;
  const productFilters = initialBootstrap.productFilters;
  const heroBanner = initialBootstrap.storefront.banners[0]?.imageUrl ? storefrontImageUrl(initialBootstrap.storefront.banners[0].imageUrl) : null;
  const secondaryBanner = initialBootstrap.storefront.banners[1]?.imageUrl ? storefrontImageUrl(initialBootstrap.storefront.banners[1].imageUrl) : null;

  useEffect(() => {
    setProductCache((current) => {
      const next = { ...readProductCache(tenantSlug), ...current, ...indexProducts(initialBootstrap.products) };
      return next;
    });
    setCart(readJson<Record<string, number>>(cartStorageKey(tenantSlug), {}));
    setWishlistIds(readJson<string[]>(wishlistStorageKey(tenantSlug), []));
    setRecentlyViewedIds(readJson<string[]>(recentStorageKey(tenantSlug), []));
  }, [initialBootstrap.products, tenantSlug]);

  useEffect(() => {
    writeJson(cartStorageKey(tenantSlug), cart);
  }, [cart, tenantSlug]);

  useEffect(() => {
    writeJson(wishlistStorageKey(tenantSlug), wishlistIds);
  }, [tenantSlug, wishlistIds]);

  useEffect(() => {
    writeJson(recentStorageKey(tenantSlug), recentlyViewedIds);
  }, [recentlyViewedIds, tenantSlug]);

  useEffect(() => {
    writeJson(productCacheStorageKey(tenantSlug), productCache);
  }, [productCache, tenantSlug]);

  useEffect(() => {
    let cancelled = false;

    getStorefrontCustomer(tenantSlug)
      .then((response) => {
        if (cancelled) {
          return;
        }

        setCustomer(response.customer);
        if (response.customer) {
          setCheckoutForm((current) => ({
            ...current,
            name: current.name || response.customer?.name || "",
            phone: current.phone || response.customer?.phone || "",
            email: current.email || response.customer?.email || "",
            address: current.address || response.customer?.address || "",
            city: current.city || response.customer?.city || "",
            state: current.state || response.customer?.state || "",
            postalCode: current.postalCode || response.customer?.postalCode || "",
          }));
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  useEffect(() => {
    if (page.kind !== "category" && page.kind !== "search") {
      return;
    }

    let cancelled = false;
    setCatalogLoading(true);
    setCatalogError("");

    getStorefrontProducts(tenantSlug, {
      ...(page.kind === "category" ? { categoryId: page.categoryId } : {}),
      ...(page.kind === "search" && page.query ? { search: page.query } : {}),
      ...(catalogFilters.brand ? { brand: catalogFilters.brand } : {}),
      ...(catalogFilters.size ? { size: catalogFilters.size } : {}),
      ...(catalogFilters.color ? { color: catalogFilters.color } : {}),
      sort: catalogFilters.sort,
      page: 1,
      pageSize: 36,
    })
      .then((response) => {
        if (cancelled) {
          return;
        }

        setCatalogProducts(response.data);
        upsertProducts(response.data);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCatalogError(error instanceof Error ? error.message : "Products could not be loaded");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCatalogLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [catalogFilters, page, tenantSlug]);

  useEffect(() => {
    if (page.kind !== "product") {
      return;
    }

    let cancelled = false;
    setProductDetailLoading(true);
    setProductDetailError("");

    getStorefrontProductDetail(tenantSlug, page.productId)
      .then((response) => {
        if (cancelled) {
          return;
        }

        setProductDetail(response.product);
        setRelatedProducts(response.relatedProducts);
        setFrequentlyBoughtTogether(response.frequentlyBoughtTogether);
        setSelectedVariantProductId(response.product.variants[0]?.productId ?? response.product.id);
        upsertProducts([
          response.product,
          ...response.relatedProducts,
          ...response.frequentlyBoughtTogether,
          ...response.product.variants.map((variant) => storefrontProductFromVariant(response.product, variant)),
        ]);
        rememberRecentlyViewed(response.product.id);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setProductDetailError(error instanceof Error ? error.message : "Product could not be loaded");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setProductDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [page, tenantSlug]);

  useEffect(() => {
    const missingProductIds = Object.keys(cart).filter((productId) => !productCache[productId]);
    if (missingProductIds.length === 0) {
      return;
    }

    let cancelled = false;
    Promise.all(missingProductIds.map(async (productId) => {
      const response = await getStorefrontProductDetail(tenantSlug, productId);
      return response.product;
    }))
      .then((products) => {
        if (!cancelled) {
          upsertProducts(products);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [cart, productCache, tenantSlug]);

  const cartItems = useMemo(() => Object.entries(cart)
    .map(([productId, quantity]) => {
      const product = productCache[productId];
      return product ? { product, quantity } : null;
    })
    .filter((item): item is { product: StorefrontProduct; quantity: number } => Boolean(item)), [cart, productCache]);
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cartItems.reduce((sum, item) => sum + item.product.sellingPrice * item.quantity, 0);
  const deliveryCharge = subtotal > 0 && subtotal - (coupon?.discount ?? 0) < initialBootstrap.checkout.freeDeliveryAbove
    ? initialBootstrap.checkout.deliveryCharge
    : 0;
  const grandTotal = Math.max(subtotal - (coupon?.discount ?? 0), 0) + deliveryCharge;
  const activeProduct = useMemo(() => {
    if (!productDetail) {
      return null;
    }

    return productDetail.variants.find((variant) => variant.productId === selectedVariantProductId) ?? productDetail.variants[0] ?? null;
  }, [productDetail, selectedVariantProductId]);

  function upsertProducts(products: StorefrontProduct[]) {
    setProductCache((current) => {
      const next = { ...current };
      for (const product of products) {
        next[product.id] = product;
      }
      return next;
    });
  }

  function rememberRecentlyViewed(productId: string) {
    setRecentlyViewedIds((current) => [productId, ...current.filter((value) => value !== productId)].slice(0, 12));
  }

  function addToCart(product: StorefrontProduct, quantity = 1) {
    upsertProducts([product]);
    setCart((current) => ({
      ...current,
      [product.id]: Math.min((current[product.id] ?? 0) + quantity, Math.max(Math.floor(product.currentStock), 1)),
    }));
  }

  function updateCartQuantity(productId: string, quantity: number) {
    setCart((current) => {
      if (quantity <= 0) {
        return Object.fromEntries(Object.entries(current).filter(([id]) => id !== productId));
      }

      return {
        ...current,
        [productId]: quantity,
      };
    });
  }

  function toggleWishlist(productId: string) {
    setWishlistIds((current) => current.includes(productId)
      ? current.filter((value) => value !== productId)
      : [productId, ...current]);
  }

  async function handleAuthSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError("");

    try {
      const response = authMode === "login"
        ? await loginStorefrontCustomer(tenantSlug, {
            phone: authForm.phone,
            password: authForm.password,
          })
        : await registerStorefrontCustomer(tenantSlug, {
            name: authForm.name,
            phone: authForm.phone,
            email: authForm.email || undefined,
            password: authForm.password,
            address: authForm.address,
            city: authForm.city || undefined,
            state: authForm.state || undefined,
            postalCode: authForm.postalCode || undefined,
          });

      setCustomer(response.customer);
      setCheckoutForm((current) => ({
        ...current,
        name: response.customer.name,
        phone: response.customer.phone,
        email: response.customer.email ?? "",
        address: response.customer.address ?? "",
        city: response.customer.city ?? "",
        state: response.customer.state ?? "",
        postalCode: response.customer.postalCode ?? "",
      }));
      setAuthForm(emptyAuthForm);
    } catch (error: unknown) {
      setAuthError(error instanceof Error ? error.message : "Authentication failed");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    await logoutStorefrontCustomer(tenantSlug).catch(() => undefined);
    setCustomer(null);
    setOrders([]);
  }

  async function handleLoadOrders() {
    setOrdersLoading(true);

    try {
      const response = await listStorefrontCustomerOrders(tenantSlug);
      setOrders(response.orders);
    } finally {
      setOrdersLoading(false);
    }
  }

  async function handleApplyCoupon() {
    if (!checkoutForm.couponCode.trim() || cartItems.length === 0) {
      setCoupon(null);
      return;
    }

    setCouponLoading(true);
    setCheckoutError("");
    try {
      const response = await validateStorefrontCoupon(tenantSlug, {
        code: checkoutForm.couponCode.trim(),
        items: cartItems.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
        })),
      });
      setCoupon(response);
    } catch (error: unknown) {
      setCoupon(null);
      setCheckoutError(error instanceof Error ? error.message : "Coupon could not be applied");
    } finally {
      setCouponLoading(false);
    }
  }

  async function handleCheckoutSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cartItems.length === 0) {
      setCheckoutError("Your cart is empty.");
      return;
    }

    setCheckoutLoading(true);
    setCheckoutError("");

    try {
      const response = await createStorefrontCheckout(tenantSlug, {
        customer: {
          name: checkoutForm.name,
          phone: checkoutForm.phone,
          email: checkoutForm.email || undefined,
          address: checkoutForm.address,
          city: checkoutForm.city || undefined,
          state: checkoutForm.state || undefined,
          postalCode: checkoutForm.postalCode || undefined,
        },
        items: cartItems.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
        })),
        paymentMethod: checkoutForm.paymentMethod,
        couponCode: coupon?.code,
        delivery: {
          address: checkoutForm.address,
          notes: checkoutForm.notes || undefined,
        },
      });

      if (response.razorpay) {
        await openRazorpayCheckout({
          bootstrap: initialBootstrap,
          response,
          customer: checkoutForm,
          onVerified: (order) => {
            setCompletedOrder(order);
            setCart({});
            router.push(accountHref());
          },
        });
      } else {
        setCompletedOrder(response.order);
        setCart({});
      }
    } catch (error: unknown) {
      setCheckoutError(error instanceof Error ? error.message : "Checkout failed");
    } finally {
      setCheckoutLoading(false);
    }
  }

  async function openRazorpayCheckout(input: {
    bootstrap: StorefrontBootstrap;
    response: StorefrontCheckoutResponse;
    customer: CheckoutFormState;
    onVerified: (order: StorefrontOrder) => void | Promise<void>;
  }) {
    await ensureRazorpayLoaded();
    if (!window.Razorpay || !input.response.razorpay) {
      throw new Error("Razorpay checkout could not be loaded");
    }

    const checkout = new window.Razorpay({
      key: input.response.razorpay.keyId,
      amount: input.response.razorpay.amount,
      currency: "INR",
      name: input.response.razorpay.name,
      description: input.response.razorpay.description,
      order_id: input.response.razorpay.orderId,
      prefill: input.response.razorpay.prefill,
      theme: {
        color: input.bootstrap.storefront.primaryColor ?? "#234239",
      },
      handler: async (paymentResponse) => {
        const verified = await verifyStorefrontRazorpay(tenantSlug, {
          invoiceId: input.response.order.invoiceId,
          razorpayOrderId: paymentResponse.razorpay_order_id,
          razorpayPaymentId: paymentResponse.razorpay_payment_id,
          razorpaySignature: paymentResponse.razorpay_signature,
        });
        await input.onVerified(verified.order);
      },
      modal: {
        ondismiss: () => undefined,
      },
    });

    checkout.open();
  }

  const displayedProducts = page.kind === "category" || page.kind === "search" ? catalogProducts : initialBootstrap.products;
  const theme = themeFor(initialBootstrap.storefront);
  const bestSellers = initialBootstrap.products.slice(0, 8);
  const offerProducts = initialBootstrap.products.filter((product) => product.discountPercent > 0).slice(0, 4);
  const recentlyViewedProducts = recentlyViewedIds
    .map((productId) => productCache[productId])
    .filter((product): product is StorefrontProduct => Boolean(product));
  const wishlistProducts = wishlistIds
    .map((productId) => productCache[productId])
    .filter((product): product is StorefrontProduct => Boolean(product));
  const selectedCategory = page.kind === "category" ? categories.find((category) => category.id === page.categoryId) ?? null : null;
  const categoryHighlights = useMemo(
    () =>
      categories
        .filter((category) => category.productCount > 0)
        .map((category) => ({
          id: category.id,
          name: category.name,
          productCount: category.productCount,
          product: initialBootstrap.products.find((product) => product.categoryId === category.id || product.categoryParentId === category.id) ?? null,
        }))
        .slice(0, theme.mode === "PREMIUM_BRAND" ? 4 : 6),
    [categories, initialBootstrap.products, theme.mode],
  );
  const brandHighlights = useMemo(() => {
    const seen = new Set<string>();
    return initialBootstrap.products.flatMap((product) => {
      const brand = product.brand?.trim();
      if (!brand || seen.has(brand)) {
        return [];
      }
      seen.add(brand);
      return [{ brand, product }];
    }).slice(0, theme.mode === "PREMIUM_BRAND" ? 3 : 4);
  }, [initialBootstrap.products, theme.mode]);
  const featureProducts = offerProducts.length > 0 ? offerProducts : bestSellers.slice(0, 4);

  return (
    <div
      className={`min-h-screen overflow-x-hidden font-[family:var(--store-ui-font)] ${theme.page} ${theme.ink}`}
      style={{
        ["--store-primary" as string]: initialBootstrap.storefront.primaryColor ?? theme.primary,
        ["--store-accent" as string]: initialBootstrap.storefront.accentColor ?? theme.accent,
        ["--store-ui-font" as string]: theme.uiFont,
        ["--store-display-font" as string]: theme.displayFont,
      }}
    >
      <div className={`pointer-events-none absolute inset-0 ${theme.backdrop}`} />
      <StoreHeader
        bootstrap={initialBootstrap}
        cartCount={cartCount}
        wishlistCount={wishlistIds.length}
        customer={customer}
        searchInput={searchInput}
        theme={theme}
        onSearchInputChange={setSearchInput}
        onLogout={handleLogout}
      />

      <main className="relative mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        {page.kind === "home" ? (
          <HomeView
            bootstrap={initialBootstrap}
            heroBanner={heroBanner}
            secondaryBanner={secondaryBanner}
            theme={theme}
            categoryHighlights={categoryHighlights}
            brandHighlights={brandHighlights}
            bestSellers={bestSellers}
            offerProducts={featureProducts}
            recentlyViewedProducts={recentlyViewedProducts}
            onToggleWishlist={toggleWishlist}
            wishlistIds={wishlistIds}
            onAddToCart={addToCart}
          />
        ) : null}

        {page.kind === "category" || page.kind === "search" ? (
          <CatalogView
            title={page.kind === "category" ? selectedCategory?.name ?? "Category" : `Search results for "${page.query}"`}
            subtitle={page.kind === "category"
              ? "Browse the live BizBil catalog with stock-aware variant families."
              : "Results update from the same live inventory used in billing."}
            products={displayedProducts}
            loading={catalogLoading}
            error={catalogError}
            theme={theme}
            filters={catalogFilters}
            availableFilters={productFilters}
            onFiltersChange={setCatalogFilters}
            onToggleWishlist={toggleWishlist}
            wishlistIds={wishlistIds}
            onAddToCart={addToCart}
          />
        ) : null}

        {page.kind === "product" ? (
          <ProductView
            loading={productDetailLoading}
            error={productDetailError}
            product={productDetail}
            activeVariant={activeProduct}
            theme={theme}
            relatedProducts={relatedProducts}
            frequentlyBoughtTogether={frequentlyBoughtTogether}
            wishlistIds={wishlistIds}
            onVariantChange={setSelectedVariantProductId}
            onAddToCart={(product, quantity) => addToCart(product, quantity)}
            onToggleWishlist={toggleWishlist}
          />
        ) : null}

        {page.kind === "cart" ? (
          <CartView
            cartItems={cartItems}
            coupon={coupon}
            deliveryCharge={deliveryCharge}
            subtotal={subtotal}
            total={grandTotal}
            theme={theme}
            onQuantityChange={updateCartQuantity}
          />
        ) : null}

        {page.kind === "checkout" ? (
          <CheckoutView
            bootstrap={initialBootstrap}
            cartItems={cartItems}
            customer={customer}
            form={checkoutForm}
            coupon={coupon}
            couponLoading={couponLoading}
            completedOrder={completedOrder}
            checkoutError={checkoutError}
            checkoutLoading={checkoutLoading}
            deliveryCharge={deliveryCharge}
            subtotal={subtotal}
            total={grandTotal}
            theme={theme}
            onApplyCoupon={handleApplyCoupon}
            onFormChange={setCheckoutForm}
            onSubmit={handleCheckoutSubmit}
          />
        ) : null}

        {page.kind === "account" ? (
          <AccountView
            bootstrap={initialBootstrap}
            customer={customer}
            orders={orders}
            ordersLoading={ordersLoading}
            authMode={authMode}
            authForm={authForm}
            authError={authError}
            authLoading={authLoading}
            theme={theme}
            onAuthModeChange={setAuthMode}
            onAuthFormChange={setAuthForm}
            onAuthSubmit={handleAuthSubmit}
            onLoadOrders={handleLoadOrders}
          />
        ) : null}

        {page.kind === "wishlist" ? (
          <WishlistView
            products={wishlistProducts}
            theme={theme}
            onToggleWishlist={toggleWishlist}
            onAddToCart={addToCart}
          />
        ) : null}
      </main>

      <StoreFooter bootstrap={initialBootstrap} theme={theme} />
    </div>
  );
}

function StoreHeader({
  bootstrap,
  cartCount,
  wishlistCount,
  customer,
  searchInput,
  theme,
  onSearchInputChange,
  onLogout,
}: Readonly<{
  bootstrap: StorefrontBootstrap;
  cartCount: number;
  wishlistCount: number;
  customer: StorefrontCustomer | null;
  searchInput: string;
  theme: StoreTheme;
  onSearchInputChange: (value: string) => void;
  onLogout: () => void;
}>) {
  return (
    <header className={`sticky top-0 z-40 border-b backdrop-blur-xl ${theme.header}`}>
      <div className={`hidden border-b text-xs font-semibold sm:block ${theme.topBar}`}>
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2 sm:px-6 lg:px-8">
          <span className="flex min-w-0 items-center gap-2 truncate">
            <Truck className="size-4 shrink-0" />
            Live stock, proper checkout, and tenant-approved storefront branding
          </span>
          <span className="hidden items-center gap-2 lg:flex">
            <ShieldCheck className="size-4" />
            Powered by BizBil ecommerce
          </span>
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(220px,auto)_minmax(0,1fr)_auto] lg:items-center lg:px-8">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <LogoMark src={bootstrap.tenant.logoUrl} name={bootstrap.storefront.displayName} theme={theme} />
          <div className="min-w-0">
            <div className={`truncate text-[11px] font-semibold uppercase tracking-[0.18em] ${theme.muted}`}>{bootstrap.tenant.name}</div>
            <div className="truncate font-[family:var(--store-display-font)] text-xl font-semibold tracking-tight text-current">{bootstrap.storefront.displayName}</div>
          </div>
        </Link>

        <div className="grid gap-3">
          <form action={searchHref()} className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className={`pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 ${theme.iconMuted}`} />
              <input
                name="q"
                value={searchInput}
                onChange={(event) => onSearchInputChange(event.target.value)}
                placeholder="Search products, brands, categories, SKU"
                className={`h-11 w-full rounded-full border px-11 text-sm outline-none transition ${theme.outline} focus:border-[color:var(--store-primary)] focus:bg-white`}
              />
            </div>
            <button className={`inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold shadow-sm ${theme.ctaBg}`}>
              Search
            </button>
          </form>

          <nav className="hidden items-center gap-4 lg:flex">
            {bootstrap.categories.slice(0, 5).map((category) => (
              <Link key={category.id} href={categoryHref(category.id)} className={`text-sm font-medium transition hover:text-slate-950 ${theme.muted}`}>
                {category.name}
              </Link>
            ))}
          </nav>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Link href={wishlistHref()} className={`relative inline-flex size-11 items-center justify-center rounded-full border transition ${theme.outline}`} aria-label="Wishlist">
            <Heart className="size-4" />
            {wishlistCount > 0 ? <CountBubble value={wishlistCount} /> : null}
          </Link>
          <Link href={accountHref()} className={`inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition ${theme.outline}`}>
            <User className="size-4" />
            <span className="hidden sm:inline">{customer ? customer.name.split(" ")[0] : "Account"}</span>
          </Link>
          <Link href={cartHref()} className={`relative inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold shadow-sm ${theme.cartButton}`}>
            <ShoppingBag className="size-4" />
            <span className="hidden sm:inline">Cart</span>
            {cartCount > 0 ? <CountBubble value={cartCount} dark={theme.mode === "PREMIUM_BRAND"} /> : null}
          </Link>
          {customer ? (
            <button type="button" onClick={onLogout} className={`hidden h-11 rounded-full border px-4 text-sm font-medium transition xl:inline-flex xl:items-center xl:gap-2 ${theme.outline}`}>
              <LogOut className="size-4" />
              Sign out
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function HomeView({
  bootstrap,
  heroBanner,
  secondaryBanner,
  theme,
  categoryHighlights,
  brandHighlights,
  bestSellers,
  offerProducts,
  recentlyViewedProducts,
  wishlistIds,
  onToggleWishlist,
  onAddToCart,
}: Readonly<{
  bootstrap: StorefrontBootstrap;
  heroBanner: string | null;
  secondaryBanner: string | null;
  theme: StoreTheme;
  categoryHighlights: Array<{ id: string; name: string; productCount: number; product: StorefrontProduct | null }>;
  brandHighlights: Array<{ brand: string; product: StorefrontProduct }>;
  bestSellers: StorefrontProduct[];
  offerProducts: StorefrontProduct[];
  recentlyViewedProducts: StorefrontProduct[];
  wishlistIds: string[];
  onToggleWishlist: (productId: string) => void;
  onAddToCart: (product: StorefrontProduct, quantity?: number) => void;
}>) {
  return (
    <div className="space-y-10 lg:space-y-12">
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_380px] lg:items-stretch">
        <div className={`relative overflow-hidden rounded-[34px] border px-7 py-8 shadow-[0_28px_90px_-48px_rgba(15,23,42,0.38)] sm:px-9 sm:py-10 ${theme.mode === "PREMIUM_BRAND" ? "border-slate-800/70 bg-slate-950 text-white" : "border-white/80 bg-white/85 backdrop-blur"}`}>
          {heroBanner ? <img src={heroBanner} alt={bootstrap.storefront.displayName} className={`absolute inset-0 h-full w-full object-cover ${theme.mode === "PREMIUM_BRAND" ? "opacity-28" : "opacity-12"}`} /> : null}
          <div className={`absolute inset-0 ${theme.mode === "PREMIUM_BRAND" ? "bg-[linear-gradient(135deg,rgba(15,23,42,0.96),rgba(15,23,42,0.84),rgba(217,119,6,0.26))]" : "bg-[radial-gradient(circle_at_top_left,rgba(222,109,45,0.12),transparent_36%),linear-gradient(135deg,rgba(255,255,255,0.94),rgba(255,255,255,0.78))]"}`} />
          <div className="relative z-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-end">
            <div className="max-w-2xl">
              <h1 className="font-[family:var(--store-display-font)] text-4xl font-semibold tracking-tight sm:text-5xl lg:text-[3.85rem]">
                {bootstrap.storefront.heroTitle ?? bootstrap.storefront.displayName}
              </h1>
              <p className={`mt-4 max-w-xl text-base leading-7 sm:text-lg ${theme.mode === "PREMIUM_BRAND" ? "text-white/78" : theme.heroMuted}`}>
                {bootstrap.storefront.heroSubtitle ?? "A cleaner, faster tenant storefront with live stock, proper product pages, and checkout that feels complete."}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={categoryHref(categoryHighlights[0]?.id ?? bootstrap.categories[0]?.id)} className={`inline-flex h-12 items-center gap-2 rounded-full px-6 text-sm font-semibold shadow-sm ${theme.ctaBg}`}>
                  Shop products
                  <ArrowRight className="size-4" />
                </Link>
                <Link href={searchHref()} className={`inline-flex h-12 items-center gap-2 rounded-full border px-6 text-sm font-semibold ${theme.heroButton}`}>
                  Browse catalog
                </Link>
              </div>
              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                <TrustTile theme={theme} icon={<Truck className="size-4" />} title="Delivery ready" detail="Checkout built for real local order flow." />
                <TrustTile theme={theme} icon={<ShieldCheck className="size-4" />} title="Live inventory" detail="Only active BizBil stock is shown online." />
                <TrustTile theme={theme} icon={<CreditCard className="size-4" />} title="Flexible payment" detail="COD and prepaid support for approved tenants." />
              </div>
            </div>

            <div className={`rounded-[28px] border p-5 ${theme.heroShowcase}`}>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${theme.muted}`}>Storefront summary</div>
                    <div className="mt-1 font-[family:var(--store-display-font)] text-2xl font-semibold">{bootstrap.storefront.displayName}</div>
                  </div>
                  <div className={`inline-flex size-12 items-center justify-center rounded-2xl ${theme.softBg}`}>
                    <Sparkles className="size-5" />
                  </div>
                </div>
                <div className={`rounded-[24px] border p-4 ${theme.heroShelf}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className={`text-sm font-semibold ${theme.accentText}`}>Approved categories</span>
                    <span className={`text-xs ${theme.muted}`}>{bootstrap.categories.length} live</span>
                  </div>
                  <div className="mt-4 grid gap-2">
                    {categoryHighlights.slice(0, 3).map((category) => (
                      <Link key={category.id} href={categoryHref(category.id)} className={`flex items-center justify-between rounded-2xl border px-3 py-3 text-sm transition ${theme.outline}`}>
                        <span>{category.name}</span>
                        <span className={theme.muted}>{category.productCount}</span>
                      </Link>
                    ))}
                  </div>
                </div>
                <div className={`rounded-[24px] border p-4 ${theme.heroShelf}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">Top offer window</div>
                      <div className={`mt-1 text-sm leading-6 ${theme.heroMuted}`}>
                        {offerProducts[0]?.discountPercent ? `${String(offerProducts[0].discountPercent)}% off on selected products` : "Featured products surfaced for faster conversion."}
                      </div>
                    </div>
                    <Tag className={`size-4 shrink-0 ${theme.accentText}`} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-5">
          <div className={`rounded-[30px] border p-6 shadow-[0_18px_70px_-42px_rgba(15,23,42,0.25)] ${theme.panel}`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-base font-semibold text-slate-950">Category discovery</div>
                <div className={`mt-1 text-sm leading-6 ${theme.heroMuted}`}>Start from the sections customers scan first.</div>
              </div>
              <div className={`inline-flex size-11 items-center justify-center rounded-2xl ${theme.softBg}`}>
                <Boxes className="size-5" />
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {categoryHighlights.slice(0, 4).map((category) => (
                <Link key={category.id} href={categoryHref(category.id)} className={`flex items-center justify-between rounded-[20px] border px-4 py-3 text-sm font-medium transition ${theme.outline}`}>
                  <span>{category.name}</span>
                  <span className={theme.muted}>{category.productCount}</span>
                </Link>
              ))}
            </div>
          </div>

          <div className={`relative overflow-hidden rounded-[30px] border p-6 shadow-[0_18px_70px_-42px_rgba(15,23,42,0.25)] ${theme.mode === "PREMIUM_BRAND" ? "border-amber-200/50 bg-[linear-gradient(160deg,#fff8eb_0%,#fff_100%)]" : "border-white/80 bg-[linear-gradient(160deg,rgba(35,66,57,0.95),rgba(35,66,57,0.78))] text-white"}`}>
            {secondaryBanner ? <img src={secondaryBanner} alt="Store promotion" className={`absolute inset-0 h-full w-full object-cover ${theme.mode === "PREMIUM_BRAND" ? "opacity-18" : "opacity-14"}`} /> : null}
            <div className="relative z-10">
              <div className={`text-sm font-semibold ${theme.mode === "PREMIUM_BRAND" ? "text-amber-700" : "text-white/78"}`}>Curated online merchandising</div>
              <div className={`mt-2 font-[family:var(--store-display-font)] text-3xl font-semibold ${theme.mode === "PREMIUM_BRAND" ? "text-slate-950" : "text-white"}`}>
                {offerProducts[0]?.discountPercent ? `${String(offerProducts[0].discountPercent)}% offer window` : "Thoughtful storefront presentation"}
              </div>
              <div className={`mt-2 max-w-xs text-sm leading-6 ${theme.mode === "PREMIUM_BRAND" ? "text-slate-600" : "text-white/76"}`}>
                Keep homepage discovery strong while deeper shopping actions move into category, product, cart, and checkout pages.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={`grid gap-4 rounded-[28px] border p-5 shadow-[0_18px_60px_-40px_rgba(15,23,42,0.24)] md:grid-cols-3 ${theme.panel}`}>
        <InfoTile icon={<Leaf className="size-4" />} title="Clean browsing rhythm" detail="Less clutter above the fold, more product clarity where customers need it." theme={theme} />
        <InfoTile icon={<MapPin className="size-4" />} title="Local commerce ready" detail="Works for delivery, COD, and tenant-specific online merchandising." theme={theme} />
        <InfoTile icon={<History className="size-4" />} title="Account-aware flow" detail="Saved account, order history, and checkout behavior stay within the storefront." theme={theme} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.92fr_1.08fr]">
        <div>
          <SectionHeading theme={theme} title="Best sellers" subtitle="A stronger first shopping surface with product-led cards and clearer purchase actions." actionHref={searchHref()} actionLabel="View all products" />
          <ProductGrid theme={theme} products={bestSellers} wishlistIds={wishlistIds} onToggleWishlist={onToggleWishlist} onAddToCart={onAddToCart} />
        </div>
        <div className={`rounded-[30px] border p-6 shadow-[0_18px_70px_-42px_rgba(15,23,42,0.24)] ${theme.panel}`}>
          <SectionHeading theme={theme} title="Category spotlight" subtitle="Category entry points stay useful, but the presentation feels more deliberate." />
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {categoryHighlights.map((category) => (
              <Link key={category.id} href={categoryHref(category.id)} className={`group overflow-hidden rounded-[24px] border transition hover:-translate-y-0.5 ${theme.outline}`}>
                <div className={`aspect-[1.3] overflow-hidden ${theme.imageBg}`}>
                  <ProductStage product={category.product} label={category.name} theme={theme} />
                </div>
                <div className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-base font-semibold text-slate-950">{category.name}</div>
                    <ChevronRight className={`size-4 transition group-hover:translate-x-0.5 ${theme.iconMuted}`} />
                  </div>
                  <div className={`mt-1 text-sm ${theme.heroMuted}`}>{category.productCount} products online</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {brandHighlights.length > 0 ? (
        <section>
          <SectionHeading theme={theme} title="Shop by brand" subtitle="Useful shortcuts for customers who already know the brand they want." />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {brandHighlights.map(({ brand, product }) => (
              <Link key={brand} href={productHref(product.id)} className={`group flex items-center gap-4 rounded-[24px] border p-4 transition hover:-translate-y-0.5 ${theme.panel}`}>
                <div className={`grid size-14 shrink-0 place-items-center rounded-2xl ${theme.softBg}`}>
                  <Star className="size-5" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-950">{brand}</div>
                  <div className={`mt-1 truncate text-xs ${theme.muted}`}>{product.categoryName}</div>
                </div>
                <ChevronRight className={`ml-auto size-4 shrink-0 transition group-hover:translate-x-0.5 ${theme.iconMuted}`} />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <SectionHeading theme={theme} title="Offers and discovery" subtitle="Promotional and discovery products stay visible without collapsing the homepage into a dense catalog wall." />
        <ProductGrid theme={theme} products={offerProducts} wishlistIds={wishlistIds} onToggleWishlist={onToggleWishlist} onAddToCart={onAddToCart} compact />
      </section>

      {recentlyViewedProducts.length > 0 ? (
        <section>
          <SectionHeading theme={theme} title="Recently viewed" subtitle="Customers can return to products they already explored without starting over." />
          <ProductGrid theme={theme} products={recentlyViewedProducts.slice(0, 4)} wishlistIds={wishlistIds} onToggleWishlist={onToggleWishlist} onAddToCart={onAddToCart} compact />
        </section>
      ) : null}
    </div>
  );
}

function CatalogView({
  title,
  subtitle,
  products,
  loading,
  error,
  theme,
  filters,
  availableFilters,
  wishlistIds,
  onFiltersChange,
  onToggleWishlist,
  onAddToCart,
}: Readonly<{
  title: string;
  subtitle: string;
  products: StorefrontProduct[];
  loading: boolean;
  error: string;
  theme: StoreTheme;
  filters: CatalogFiltersState;
  availableFilters: StorefrontBootstrap["productFilters"];
  wishlistIds: string[];
  onFiltersChange: (value: CatalogFiltersState) => void;
  onToggleWishlist: (productId: string) => void;
  onAddToCart: (product: StorefrontProduct, quantity?: number) => void;
}>) {
  return (
    <div className="grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className={`rounded-[28px] border p-5 lg:sticky lg:top-24 lg:self-start ${theme.panel}`}>
        <div className="text-sm font-semibold text-slate-950">Filters</div>
        <div className="mt-4 space-y-4">
          <SelectField theme={theme} label="Brand" value={filters.brand} options={availableFilters.brands} onChange={(value) => onFiltersChange({ ...filters, brand: value })} />
          <SelectField theme={theme} label="Size" value={filters.size} options={availableFilters.sizes} onChange={(value) => onFiltersChange({ ...filters, size: value })} />
          <SelectField theme={theme} label="Color" value={filters.color} options={availableFilters.colors} onChange={(value) => onFiltersChange({ ...filters, color: value })} />
          <SelectField
            theme={theme}
            label="Sort"
            value={filters.sort}
            options={["FEATURED", "PRICE_ASC", "PRICE_DESC", "DISCOUNT", "NAME", "NEWEST"]}
            onChange={(value) => onFiltersChange({
              ...filters,
              sort: asSort(value),
            })}
          />
        </div>
      </aside>

      <section>
        <SectionHeading theme={theme} title={title} subtitle={subtitle} />
        {loading ? <LoadingPanel theme={theme} message="Loading products..." /> : null}
        {error ? <ErrorPanel theme={theme} message={error} /> : null}
        {!loading && !error && products.length === 0 ? <EmptyPanel theme={theme} message="No products matched this view." /> : null}
        {!loading && !error && products.length > 0 ? (
          <ProductGrid theme={theme} products={products} wishlistIds={wishlistIds} onToggleWishlist={onToggleWishlist} onAddToCart={onAddToCart} />
        ) : null}
      </section>
    </div>
  );
}

function ProductView({
  loading,
  error,
  product,
  activeVariant,
  theme,
  relatedProducts,
  frequentlyBoughtTogether,
  wishlistIds,
  onVariantChange,
  onAddToCart,
  onToggleWishlist,
}: Readonly<{
  loading: boolean;
  error: string;
  product: StorefrontProductDetail | null;
  activeVariant: StorefrontProductDetail["variants"][number] | null;
  theme: StoreTheme;
  relatedProducts: StorefrontProduct[];
  frequentlyBoughtTogether: StorefrontProduct[];
  wishlistIds: string[];
  onVariantChange: (productId: string) => void;
  onAddToCart: (product: StorefrontProduct, quantity?: number) => void;
  onToggleWishlist: (productId: string) => void;
}>) {
  const displayProduct = product && activeVariant ? storefrontProductFromVariant(product, activeVariant) : product;

  if (loading) {
    return <LoadingPanel theme={theme} message="Loading product..." />;
  }

  if (error || !product || !displayProduct) {
    return <ErrorPanel theme={theme} message={error || "Product not found"} />;
  }

  const imageUrl = storefrontImageUrl(activeVariant?.imageUrl ?? product.imageUrl);

  return (
    <div className="space-y-12">
      <div className="grid gap-8 lg:grid-cols-[1fr_0.95fr]">
        <div className={`rounded-[32px] border p-6 shadow-[0_22px_80px_-46px_rgba(15,23,42,0.25)] ${theme.panel}`}>
          <div className={`aspect-square overflow-hidden rounded-[26px] ${theme.imageBg}`}>
            {imageUrl ? <img src={imageUrl} alt={product.name} className="h-full w-full object-cover" /> : <ProductStage product={displayProduct} label={product.name} theme={theme} />}
          </div>
        </div>

        <div>
          <div className={`text-sm font-medium ${theme.muted}`}>{product.categoryName}</div>
          <h1 className="mt-3 font-[family:var(--store-display-font)] text-4xl font-semibold tracking-tight text-slate-950">{product.name}</h1>
          <div className={`mt-3 flex flex-wrap items-center gap-3 text-sm ${theme.muted}`}>
            {displayProduct.sku ? <span>SKU {displayProduct.sku}</span> : null}
            {displayProduct.barcode ? <span>Barcode {displayProduct.barcode}</span> : null}
            {product.hsnCode ? <span>HSN {product.hsnCode}</span> : null}
            <span>GST {String(product.gstRate)}%</span>
          </div>

          <div className="mt-6 flex items-end gap-3">
            <div className="text-3xl font-semibold text-slate-950">{formatCurrency(displayProduct.sellingPrice)}</div>
            {displayProduct.mrp > displayProduct.sellingPrice ? <div className={`pb-1 text-base line-through ${theme.muted}`}>{formatCurrency(displayProduct.mrp)}</div> : null}
            {product.discountPercent > 0 ? <div className={`rounded-full px-3 py-1 text-xs font-semibold ${theme.stockBadge}`}>{String(product.discountPercent)}% off</div> : null}
          </div>

          <div className={`mt-5 text-sm ${theme.heroMuted}`}>
            {displayProduct.currentStock > 0 ? `${String(displayProduct.currentStock)} units available` : "Currently out of stock"}
          </div>

          {product.variants.length > 0 ? (
            <div className="mt-8">
              <div className="text-sm font-semibold text-slate-950">{product.variantAttributeLabel ?? "Options"}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {product.variants.map((variant) => (
                  <button
                    key={variant.id}
                    type="button"
                    onClick={() => onVariantChange(variant.productId)}
                    className={`rounded-full border px-4 py-2 text-sm font-medium transition ${variant.productId === activeVariant?.productId ? `${theme.primaryBg} border-[color:var(--store-primary)] text-white` : theme.outline}`}
                  >
                    {variant.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => onAddToCart(displayProduct, 1)}
              disabled={displayProduct.currentStock <= 0}
              className={`inline-flex h-12 items-center gap-2 rounded-full px-6 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${theme.productButton}`}
            >
              <ShoppingBag className="size-4" />
              Add to cart
            </button>
            <button type="button" onClick={() => onToggleWishlist(displayProduct.id)} className={`inline-flex h-12 items-center gap-2 rounded-full border px-6 text-sm font-semibold ${theme.outline}`}>
              <Heart className={`size-4 ${wishlistIds.includes(displayProduct.id) ? "fill-current text-rose-600" : ""}`} />
              Wishlist
            </button>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <InfoTile theme={theme} icon={<Truck className="size-4" />} title="Delivery" detail="Delivery estimate is confirmed at checkout." />
            <InfoTile theme={theme} icon={<ShieldCheck className="size-4" />} title="Store support" detail="Post-purchase support remains handled by the tenant team." />
          </div>

          {product.description ? <p className={`mt-8 text-sm leading-7 ${theme.heroMuted}`}>{product.description}</p> : null}

          {product.specifications.length > 0 ? (
            <div className={`mt-8 rounded-[24px] border ${theme.panel}`}>
              <div className={`border-b px-5 py-4 text-sm font-semibold text-slate-950 ${theme.panelDivider}`}>Specifications</div>
              <div className={`divide-y ${theme.panelDivider}`}>
                {product.specifications.map((specification) => (
                  <div key={`${specification.label}-${specification.value}`} className="flex items-start justify-between gap-4 px-5 py-3 text-sm">
                    <span className={theme.muted}>{specification.label}</span>
                    <span className="text-right font-medium text-slate-950">{specification.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {relatedProducts.length > 0 ? (
        <section>
          <SectionHeading theme={theme} title="Related products" subtitle="Customers can continue browsing without losing the product context." />
          <ProductGrid theme={theme} products={relatedProducts} wishlistIds={wishlistIds} onToggleWishlist={onToggleWishlist} onAddToCart={onAddToCart} compact />
        </section>
      ) : null}

      {frequentlyBoughtTogether.length > 0 ? (
        <section>
          <SectionHeading theme={theme} title="Frequently bought together" subtitle="Useful add-ons surfaced from the same live inventory." />
          <ProductGrid theme={theme} products={frequentlyBoughtTogether} wishlistIds={wishlistIds} onToggleWishlist={onToggleWishlist} onAddToCart={onAddToCart} compact />
        </section>
      ) : null}
    </div>
  );
}

function CartView({
  cartItems,
  coupon,
  deliveryCharge,
  subtotal,
  total,
  theme,
  onQuantityChange,
}: Readonly<{
  cartItems: Array<{ product: StorefrontProduct; quantity: number }>;
  coupon: { code: string; discount: number; label: string } | null;
  deliveryCharge: number;
  subtotal: number;
  total: number;
  theme: StoreTheme;
  onQuantityChange: (productId: string, quantity: number) => void;
}>) {
  if (cartItems.length === 0) {
    return <EmptyPanel theme={theme} message="Your cart is empty. Start with a category or product page." />;
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className={`rounded-[28px] border shadow-[0_20px_70px_-46px_rgba(15,23,42,0.22)] ${theme.panel}`}>
        <div className={`border-b px-6 py-5 ${theme.panelDivider}`}>
          <div className="text-lg font-semibold text-slate-950">Cart</div>
          <div className={`mt-1 text-sm ${theme.heroMuted}`}>Review products before moving to the checkout page.</div>
        </div>
        <div className={`divide-y ${theme.panelDivider}`}>
          {cartItems.map(({ product, quantity }) => (
            <div key={product.id} className="flex items-center gap-4 px-6 py-5">
              <ProductThumbnail product={product} theme={theme} />
              <div className="min-w-0 flex-1">
                <Link href={productHref(product.id)} className="truncate text-sm font-semibold text-slate-950 hover:text-[color:var(--store-primary)]">
                  {product.name}
                </Link>
                <div className={`mt-1 text-sm ${theme.muted}`}>{formatCurrency(product.sellingPrice)} each</div>
              </div>
              <div className={`flex items-center gap-2 rounded-full border px-2 py-1 ${theme.quantity}`}>
                <button type="button" className="inline-flex size-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100" onClick={() => onQuantityChange(product.id, quantity - 1)}>
                  <Minus className="size-4" />
                </button>
                <span className="min-w-8 text-center text-sm font-semibold text-slate-950">{quantity}</span>
                <button type="button" className="inline-flex size-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100" onClick={() => onQuantityChange(product.id, quantity + 1)}>
                  <Plus className="size-4" />
                </button>
              </div>
              <button type="button" className="inline-flex size-10 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-red-600" onClick={() => onQuantityChange(product.id, 0)}>
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      </section>

      <OrderSummaryCard theme={theme} subtotal={subtotal} deliveryCharge={deliveryCharge} coupon={coupon} total={total} />
    </div>
  );
}

function CheckoutView({
  bootstrap,
  cartItems,
  customer,
  form,
  coupon,
  couponLoading,
  completedOrder,
  checkoutError,
  checkoutLoading,
  deliveryCharge,
  subtotal,
  total,
  theme,
  onApplyCoupon,
  onFormChange,
  onSubmit,
}: Readonly<{
  bootstrap: StorefrontBootstrap;
  cartItems: Array<{ product: StorefrontProduct; quantity: number }>;
  customer: StorefrontCustomer | null;
  form: CheckoutFormState;
  coupon: { code: string; discount: number; label: string } | null;
  couponLoading: boolean;
  completedOrder: StorefrontOrder | null;
  checkoutError: string;
  checkoutLoading: boolean;
  deliveryCharge: number;
  subtotal: number;
  total: number;
  theme: StoreTheme;
  onApplyCoupon: () => Promise<void>;
  onFormChange: React.Dispatch<React.SetStateAction<CheckoutFormState>>;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
}>) {
  if (completedOrder) {
    return (
      <div className={`mx-auto max-w-3xl rounded-[32px] border px-8 py-10 shadow-[0_18px_70px_-42px_rgba(15,23,42,0.18)] ${theme.panel}`}>
        <div className="inline-flex size-12 items-center justify-center rounded-full bg-white text-emerald-700">
          <PackageCheck className="size-6" />
        </div>
        <h1 className="mt-5 font-[family:var(--store-display-font)] text-3xl font-semibold text-slate-950">Order placed successfully</h1>
        <p className={`mt-3 text-sm leading-7 ${theme.heroMuted}`}>Your order {completedOrder.orderNumber} has been created from the storefront and synced into BizBil.</p>
        <div className={`mt-6 rounded-[24px] p-5 ${theme.summary}`}>
          <div className="text-sm font-semibold text-slate-950">Grand total</div>
          <div className="mt-2 text-2xl font-semibold text-slate-950">{formatCurrency(completedOrder.grandTotal)}</div>
        </div>
      </div>
    );
  }

  if (cartItems.length === 0) {
    return <EmptyPanel theme={theme} message="Your cart is empty. Add products before checking out." />;
  }

  const canUseRazorpay = Boolean(bootstrap.checkout.razorpayKeyId && bootstrap.checkout.paymentMethods.includes("RAZORPAY"));

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      <form className={`space-y-6 rounded-[28px] border p-6 shadow-[0_20px_70px_-46px_rgba(15,23,42,0.22)] ${theme.panel}`} onSubmit={(event) => void onSubmit(event)}>
        <div>
          <div className="text-lg font-semibold text-slate-950">Checkout</div>
          <div className={`mt-1 text-sm ${theme.heroMuted}`}>
            {customer ? "Your saved customer details are prefilled from storefront login." : "Guest checkout is available, with validation against live BizBil stock before order creation."}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField theme={theme} label="Name" value={form.name} onChange={(value) => onFormChange((current) => ({ ...current, name: value }))} required />
          <FormField theme={theme} label="Phone" value={form.phone} onChange={(value) => onFormChange((current) => ({ ...current, phone: value }))} required />
          <FormField theme={theme} label="Email" value={form.email} onChange={(value) => onFormChange((current) => ({ ...current, email: value }))} />
          <FormField theme={theme} label="Address" value={form.address} onChange={(value) => onFormChange((current) => ({ ...current, address: value }))} required className="sm:col-span-2" />
          <FormField theme={theme} label="City" value={form.city} onChange={(value) => onFormChange((current) => ({ ...current, city: value }))} />
          <FormField theme={theme} label="State" value={form.state} onChange={(value) => onFormChange((current) => ({ ...current, state: value }))} />
          <FormField theme={theme} label="Postal code" value={form.postalCode} onChange={(value) => onFormChange((current) => ({ ...current, postalCode: value }))} />
          <FormField theme={theme} label="Order notes" value={form.notes} onChange={(value) => onFormChange((current) => ({ ...current, notes: value }))} className="sm:col-span-2" />
        </div>

        <div className={`rounded-[24px] border p-4 ${theme.summary}`}>
          <div className="flex flex-wrap items-end gap-3">
            <FormField theme={theme} label="Coupon" value={form.couponCode} onChange={(value) => onFormChange((current) => ({ ...current, couponCode: value }))} />
            <button type="button" disabled={couponLoading} onClick={() => void onApplyCoupon()} className={`inline-flex h-11 items-center gap-2 rounded-full border bg-white px-5 text-sm font-semibold disabled:opacity-60 ${theme.outline}`}>
              {couponLoading ? <Loader2 className="size-4 animate-spin" /> : null}
              Apply coupon
            </button>
          </div>
          {coupon ? <div className="mt-3 text-sm font-medium text-emerald-700">{coupon.label}</div> : null}
        </div>

        <div className={`rounded-[24px] border p-4 ${theme.summary}`}>
          <div className="text-sm font-semibold text-slate-950">Payment method</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => onFormChange((current) => ({ ...current, paymentMethod: "COD" }))} className={`rounded-full border px-4 py-2 text-sm font-medium ${form.paymentMethod === "COD" ? theme.activePayment : theme.inactivePayment}`}>
              Cash on delivery
            </button>
            {canUseRazorpay ? (
              <button type="button" onClick={() => onFormChange((current) => ({ ...current, paymentMethod: "RAZORPAY" }))} className={`rounded-full border px-4 py-2 text-sm font-medium ${form.paymentMethod === "RAZORPAY" ? theme.activePayment : theme.inactivePayment}`}>
                Online payment
              </button>
            ) : null}
          </div>
        </div>

        {checkoutError ? <ErrorPanel theme={theme} message={checkoutError} /> : null}

        <button className={`inline-flex h-12 items-center gap-2 rounded-full px-6 text-sm font-semibold disabled:opacity-60 ${theme.ctaBg}`} disabled={checkoutLoading}>
          {checkoutLoading ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
          Place order
        </button>
      </form>

      <OrderSummaryCard theme={theme} subtotal={subtotal} deliveryCharge={deliveryCharge} coupon={coupon} total={total} />
    </div>
  );
}

function AccountView({
  bootstrap,
  customer,
  orders,
  ordersLoading,
  authMode,
  authForm,
  authError,
  authLoading,
  theme,
  onAuthModeChange,
  onAuthFormChange,
  onAuthSubmit,
  onLoadOrders,
}: Readonly<{
  bootstrap: StorefrontBootstrap;
  customer: StorefrontCustomer | null;
  orders: StorefrontOrder[];
  ordersLoading: boolean;
  authMode: "login" | "register";
  authForm: AuthFormState;
  authError: string;
  authLoading: boolean;
  theme: StoreTheme;
  onAuthModeChange: (mode: "login" | "register") => void;
  onAuthFormChange: React.Dispatch<React.SetStateAction<AuthFormState>>;
  onAuthSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onLoadOrders: () => Promise<void>;
}>) {
  if (!bootstrap.storefront.allowCustomerLogin) {
    return <EmptyPanel theme={theme} message="Customer login is not enabled for this storefront." />;
  }

  if (!customer) {
    return (
      <div className={`mx-auto max-w-2xl rounded-[28px] border p-6 shadow-[0_20px_70px_-46px_rgba(15,23,42,0.22)] ${theme.panel}`}>
        <div className="flex items-center gap-2 text-lg font-semibold text-slate-950">
          <LogIn className="size-5 text-[color:var(--store-primary)]" />
          Customer account
        </div>
        <div className={`mt-1 text-sm ${theme.heroMuted}`}>Use the same storefront account to review orders and speed up checkout.</div>
        <div className="mt-6 flex gap-2">
          <button type="button" onClick={() => onAuthModeChange("login")} className={`rounded-full px-4 py-2 text-sm font-semibold ${authMode === "login" ? `${theme.primaryBg} text-white` : theme.outlineActive}`}>Login</button>
          <button type="button" onClick={() => onAuthModeChange("register")} className={`rounded-full px-4 py-2 text-sm font-semibold ${authMode === "register" ? `${theme.primaryBg} text-white` : theme.outlineActive}`}>Create account</button>
        </div>
        <form className="mt-6 grid gap-4 sm:grid-cols-2" onSubmit={(event) => void onAuthSubmit(event)}>
          {authMode === "register" ? <FormField theme={theme} label="Name" value={authForm.name} onChange={(value) => onAuthFormChange((current) => ({ ...current, name: value }))} required /> : null}
          <FormField theme={theme} label="Phone" value={authForm.phone} onChange={(value) => onAuthFormChange((current) => ({ ...current, phone: value }))} required />
          {authMode === "register" ? <FormField theme={theme} label="Email" value={authForm.email} onChange={(value) => onAuthFormChange((current) => ({ ...current, email: value }))} /> : null}
          <PasswordField theme={theme} label="Password" value={authForm.password} onChange={(value) => onAuthFormChange((current) => ({ ...current, password: value }))} />
          {authMode === "register" ? (
            <>
              <FormField theme={theme} label="Address" value={authForm.address} onChange={(value) => onAuthFormChange((current) => ({ ...current, address: value }))} required className="sm:col-span-2" />
              <FormField theme={theme} label="City" value={authForm.city} onChange={(value) => onAuthFormChange((current) => ({ ...current, city: value }))} />
              <FormField theme={theme} label="State" value={authForm.state} onChange={(value) => onAuthFormChange((current) => ({ ...current, state: value }))} />
              <FormField theme={theme} label="Postal code" value={authForm.postalCode} onChange={(value) => onAuthFormChange((current) => ({ ...current, postalCode: value }))} />
            </>
          ) : null}
          {authError ? <div className="sm:col-span-2 text-sm text-red-700">{authError}</div> : null}
          <button className={`inline-flex h-12 items-center gap-2 rounded-full px-6 text-sm font-semibold text-white disabled:opacity-60 sm:col-span-2 ${theme.ctaBg}`} disabled={authLoading}>
            {authLoading ? <Loader2 className="size-4 animate-spin" /> : <User className="size-4" />}
            {authMode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
      <section className={`rounded-[28px] border p-6 ${theme.panel}`}>
        <div className="text-lg font-semibold text-slate-950">Profile</div>
        <div className={`mt-4 space-y-3 text-sm ${theme.heroMuted}`}>
          <div><span className="font-semibold text-slate-950">Name:</span> {customer.name}</div>
          <div><span className="font-semibold text-slate-950">Phone:</span> {customer.phone}</div>
          <div><span className="font-semibold text-slate-950">Email:</span> {customer.email ?? "-"}</div>
          <div><span className="font-semibold text-slate-950">Address:</span> {customer.address ?? "-"}</div>
        </div>
      </section>

      <section className={`rounded-[28px] border p-6 ${theme.panel}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-950">Order history</div>
            <div className={`mt-1 text-sm ${theme.heroMuted}`}>A dedicated account page instead of a side sheet.</div>
          </div>
          <button type="button" onClick={() => void onLoadOrders()} className={`inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold ${theme.outline}`}>
            {ordersLoading ? <Loader2 className="size-4 animate-spin" /> : <PackageCheck className="size-4" />}
            Refresh
          </button>
        </div>
        <div className="mt-5 space-y-3">
          {orders.length === 0 && !ordersLoading ? <EmptyPanel theme={theme} message="No storefront orders yet." compact /> : null}
          {orders.map((order) => (
            <div key={order.invoiceId} className={`rounded-[24px] border p-4 ${theme.summary}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-950">{order.orderNumber}</div>
                  <div className={`mt-1 text-xs ${theme.muted}`}>{order.items.length} items</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-slate-950">{formatCurrency(order.grandTotal)}</div>
                  <div className={`mt-1 text-xs ${theme.muted}`}>{order.status}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function WishlistView({
  products,
  theme,
  onToggleWishlist,
  onAddToCart,
}: Readonly<{
  products: StorefrontProduct[];
  theme: StoreTheme;
  onToggleWishlist: (productId: string) => void;
  onAddToCart: (product: StorefrontProduct, quantity?: number) => void;
}>) {
  if (products.length === 0) {
    return <EmptyPanel theme={theme} message="Your wishlist is empty. Save products from the category and product pages." />;
  }

  return (
    <section>
      <SectionHeading theme={theme} title="Wishlist" subtitle="A separate saved-items page, like a complete ecommerce storefront." />
      <ProductGrid theme={theme} products={products} wishlistIds={products.map((product) => product.id)} onToggleWishlist={onToggleWishlist} onAddToCart={onAddToCart} />
    </section>
  );
}

function ProductGrid({
  products,
  wishlistIds,
  theme,
  onToggleWishlist,
  onAddToCart,
  compact = false,
}: Readonly<{
  products: StorefrontProduct[];
  wishlistIds: string[];
  theme: StoreTheme;
  onToggleWishlist: (productId: string) => void;
  onAddToCart: (product: StorefrontProduct, quantity?: number) => void;
  compact?: boolean;
}>) {
  return (
    <div className={`grid gap-4 ${compact ? "sm:grid-cols-2 xl:grid-cols-4" : theme.mode === "CLASSIC_RETAIL" ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-2 xl:grid-cols-3"}`}>
      {products.map((product) => (
        <article key={product.id} className={`group overflow-hidden rounded-[28px] border shadow-[0_18px_60px_-42px_rgba(15,23,42,0.22)] transition hover:-translate-y-0.5 hover:shadow-[0_26px_75px_-42px_rgba(15,23,42,0.28)] ${theme.panel}`}>
          <Link href={productHref(product.id)} className="block">
            <div className={`aspect-[1/1] overflow-hidden ${theme.imageBg}`}>
              {storefrontImageUrl(product.imageUrl)
                ? <img src={storefrontImageUrl(product.imageUrl) ?? ""} alt={product.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                : <ProductStage product={product} label={product.name} theme={theme} />}
            </div>
          </Link>
          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className={`text-xs font-medium uppercase tracking-[0.18em] ${theme.accentText}`}>{product.categoryName}</div>
                <Link href={productHref(product.id)} className="mt-2 block line-clamp-2 font-[family:var(--store-display-font)] text-base font-semibold text-slate-950 hover:text-[color:var(--store-primary)]">
                  {product.name}
                </Link>
              </div>
              <button type="button" onClick={() => onToggleWishlist(product.id)} className={`inline-flex size-10 items-center justify-center rounded-full border transition ${theme.outline}`}>
                <Heart className={`size-4 ${wishlistIds.includes(product.id) ? "fill-current text-rose-600" : ""}`} />
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {product.variantLabels.slice(0, 4).map((variantLabel) => (
                <span key={`${product.id}-${variantLabel}`} className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${theme.softBg}`}>
                  {variantLabel}
                </span>
              ))}
            </div>

            <div className="mt-4 flex items-end gap-2">
              <div className="text-xl font-semibold text-slate-950">{formatCurrency(product.sellingPrice)}</div>
              {product.mrp > product.sellingPrice ? <div className={`pb-0.5 text-sm line-through ${theme.muted}`}>{formatCurrency(product.mrp)}</div> : null}
            </div>
            <div className={`mt-1 text-sm ${theme.heroMuted}`}>{product.currentStock > 0 ? `${String(product.currentStock)} in stock` : "Out of stock"}</div>

            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={() => onAddToCart(product, 1)}
                disabled={product.currentStock <= 0}
                className={`inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${theme.productButton}`}
              >
                <ShoppingBag className="size-4" />
                Add
              </button>
              <Link href={productHref(product.id)} className={`inline-flex h-11 items-center justify-center rounded-full border px-4 text-sm font-semibold ${theme.outline}`}>
                View
              </Link>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function SectionHeading({
  title,
  subtitle,
  theme,
  actionHref,
  actionLabel,
}: Readonly<{
  title: string;
  subtitle: string;
  theme: StoreTheme;
  actionHref?: string;
  actionLabel?: string;
}>) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="font-[family:var(--store-display-font)] text-2xl font-semibold tracking-tight text-slate-950">{title}</div>
        <div className={`mt-2 text-sm leading-6 ${theme.heroMuted}`}>{subtitle}</div>
      </div>
      {actionHref && actionLabel ? (
        <Link href={actionHref} className="inline-flex items-center gap-2 text-sm font-semibold text-[color:var(--store-primary)]">
          {actionLabel}
          <ChevronRight className="size-4" />
        </Link>
      ) : null}
    </div>
  );
}

function TrustTile({ icon, title, detail, theme }: Readonly<{ icon: React.ReactNode; title: string; detail: string; theme: StoreTheme }>) {
  return (
    <div className={`rounded-[22px] border p-4 backdrop-blur ${theme.mode === "PREMIUM_BRAND" ? "border-white/10 bg-white/10" : "border-white/70 bg-white/70"}`}>
      <div className={`inline-flex size-9 items-center justify-center rounded-full ${theme.mode === "PREMIUM_BRAND" ? "bg-white/15 text-white" : theme.softBg}`}>{icon}</div>
      <div className={`mt-3 text-sm font-semibold ${theme.mode === "PREMIUM_BRAND" ? "text-white" : "text-slate-950"}`}>{title}</div>
      <div className={`mt-1 text-xs leading-5 ${theme.mode === "PREMIUM_BRAND" ? "text-white/70" : theme.heroMuted}`}>{detail}</div>
    </div>
  );
}

function InfoTile({ icon, title, detail, theme }: Readonly<{ icon: React.ReactNode; title: string; detail: string; theme: StoreTheme }>) {
  return (
    <div className={`rounded-[22px] border p-4 ${theme.summary}`}>
      <div className={`inline-flex size-9 items-center justify-center rounded-full ${theme.softBg}`}>{icon}</div>
      <div className="mt-3 text-sm font-semibold text-slate-950">{title}</div>
      <div className={`mt-1 text-xs leading-5 ${theme.heroMuted}`}>{detail}</div>
    </div>
  );
}

function OrderSummaryCard({
  subtotal,
  deliveryCharge,
  coupon,
  total,
  theme,
}: Readonly<{
  subtotal: number;
  deliveryCharge: number;
  coupon: { code: string; discount: number; label: string } | null;
  total: number;
  theme: StoreTheme;
}>) {
  return (
    <aside className={`rounded-[28px] border p-6 shadow-[0_18px_60px_-42px_rgba(15,23,42,0.22)] lg:sticky lg:top-24 lg:self-start ${theme.summary}`}>
      <div className="text-lg font-semibold text-slate-950">Order summary</div>
      <div className="mt-5 space-y-3 text-sm">
        <SummaryRow label="Subtotal" value={formatCurrency(subtotal)} />
        <SummaryRow label="Delivery" value={deliveryCharge > 0 ? formatCurrency(deliveryCharge) : "Free"} />
        {coupon ? <SummaryRow label={coupon.code} value={`-${formatCurrency(coupon.discount)}`} accent /> : null}
      </div>
      <div className={`mt-5 border-t pt-5 ${theme.panelDivider}`}>
        <SummaryRow label="Total" value={formatCurrency(total)} strong />
      </div>
      <div className={`mt-5 space-y-2 text-xs leading-5 ${theme.heroMuted}`}>
        <div className="flex items-start gap-2">
          <Truck className="mt-0.5 size-3.5 shrink-0 text-[color:var(--store-primary)]" />
          Delivery and totals are validated using live BizBil pricing and stock before final order creation.
        </div>
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-[color:var(--store-primary)]" />
          Out-of-stock products stay unavailable for purchase.
        </div>
      </div>
      <Link href={checkoutHref()} className={`mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold ${theme.ctaBg}`}>
        Continue to checkout
        <ArrowRight className="size-4" />
      </Link>
    </aside>
  );
}

function SummaryRow({
  label,
  value,
  accent = false,
  strong = false,
}: Readonly<{
  label: string;
  value: string;
  accent?: boolean;
  strong?: boolean;
}>) {
  return (
    <div className={`flex items-center justify-between gap-3 ${strong ? "text-base font-semibold text-slate-950" : accent ? "font-medium text-emerald-700" : "text-slate-600"}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function FormField({
  label,
  value,
  theme,
  onChange,
  required = false,
  className = "",
}: Readonly<{
  label: string;
  value: string;
  theme: StoreTheme;
  onChange: (value: string) => void;
  required?: boolean;
  className?: string;
}>) {
  return (
    <label className={`block text-sm font-medium text-slate-700 ${className}`}>
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} required={required} className={`mt-1 h-11 w-full rounded-2xl border bg-white px-4 text-sm outline-none transition focus:border-[color:var(--store-primary)] ${theme.outline}`} />
    </label>
  );
}

function PasswordField({ label, value, onChange, theme }: Readonly<{ label: string; value: string; onChange: (value: string) => void; theme: StoreTheme }>) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input type="password" value={value} onChange={(event) => onChange(event.target.value)} className={`mt-1 h-11 w-full rounded-2xl border bg-white px-4 text-sm outline-none transition focus:border-[color:var(--store-primary)] ${theme.outline}`} />
    </label>
  );
}

function SelectField({
  label,
  value,
  theme,
  options,
  onChange,
}: Readonly<{
  label: string;
  value: string;
  theme: StoreTheme;
  options: string[];
  onChange: (value: string) => void;
}>) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className={`mt-1 h-11 w-full rounded-2xl border bg-white px-4 text-sm outline-none transition focus:border-[color:var(--store-primary)] ${theme.outline}`}>
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>{formatSortLabel(option)}</option>
        ))}
      </select>
    </label>
  );
}

function ProductThumbnail({ product, theme }: Readonly<{ product: StorefrontProduct; theme: StoreTheme }>) {
  const imageUrl = storefrontImageUrl(product.imageUrl);
  return (
    <div className={`size-20 overflow-hidden rounded-[20px] ${theme.imageBg}`}>
      {imageUrl ? <img src={imageUrl} alt={product.name} className="h-full w-full object-cover" /> : <ProductStage product={product} label={product.name} theme={theme} />}
    </div>
  );
}

function CountBubble({ value, dark = false }: Readonly<{ value: number; dark?: boolean }>) {
  return (
    <span className={`absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold ${dark ? "bg-white text-slate-950" : "bg-slate-950 text-white"}`}>
      {String(value)}
    </span>
  );
}

function LoadingPanel({ message, theme }: Readonly<{ message: string; theme: StoreTheme }>) {
  return (
    <div className={`rounded-[28px] border px-6 py-12 text-center text-sm ${theme.panel}`}>
      <Loader2 className="mx-auto mb-3 size-5 animate-spin text-[color:var(--store-primary)]" />
      {message}
    </div>
  );
}

function ErrorPanel({ message, theme }: Readonly<{ message: string; theme: StoreTheme }>) {
  return (
    <div className={`rounded-[28px] border border-red-200 px-6 py-5 text-sm text-red-700 ${theme.errorBg}`}>
      {message}
    </div>
  );
}

function EmptyPanel({ message, compact = false, theme }: Readonly<{ message: string; compact?: boolean; theme: StoreTheme }>) {
  return (
    <div className={`rounded-[28px] border border-dashed text-center text-sm ${theme.empty} ${compact ? "px-5 py-6" : "px-6 py-12"}`}>
      {message}
    </div>
  );
}

function StoreFooter({ bootstrap, theme }: Readonly<{ bootstrap: StorefrontBootstrap; theme: StoreTheme }>) {
  return (
    <footer className={`border-t ${theme.mode === "PREMIUM_BRAND" ? "border-slate-200 bg-white/80" : "border-white/70 bg-white/70"}`}>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-10 sm:px-6 lg:flex-row lg:items-start lg:justify-between lg:px-8">
        <div className="max-w-md">
          <div className="font-[family:var(--store-display-font)] text-lg font-semibold text-slate-950">{bootstrap.storefront.displayName}</div>
          <div className={`mt-2 text-sm leading-7 ${theme.heroMuted}`}>{bootstrap.tenant.address ?? "Online store powered by BizBil with live catalog sync and a proper multi-page shopping flow."}</div>
        </div>
        <div className={`grid gap-4 text-sm ${theme.heroMuted} sm:grid-cols-3`}>
          <FooterLinkGroup title="Shop" links={[
            { href: searchHref(), label: "All products" },
            { href: cartHref(), label: "Cart" },
            { href: wishlistHref(), label: "Wishlist" },
          ]} />
          <FooterLinkGroup title="Account" links={[
            { href: accountHref(), label: "Customer account" },
            { href: checkoutHref(), label: "Checkout" },
          ]} />
          <FooterLinkGroup title="Contact" links={[
            { href: `tel:${bootstrap.tenant.phone}`, label: bootstrap.tenant.phone },
          ]} />
        </div>
      </div>
    </footer>
  );
}

function FooterLinkGroup({
  title,
  links,
}: Readonly<{
  title: string;
  links: Array<{ href: string; label: string }>;
}>) {
  return (
    <div>
      <div className="font-semibold text-slate-950">{title}</div>
      <div className="mt-3 space-y-2">
        {links.map((link) => (
          <Link key={`${title}-${link.href}`} href={link.href} className="block transition hover:text-slate-950">
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function LogoMark({ src, name, theme }: Readonly<{ src: string | null; name: string; theme: StoreTheme }>) {
  const imageUrl = storefrontImageUrl(src);
  if (imageUrl) {
    return <img src={imageUrl} alt={name} className="size-11 rounded-2xl object-cover" />;
  }

  return (
    <div className={`grid size-11 place-items-center rounded-2xl text-sm font-bold text-white ${theme.primaryBg}`}>
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

function ProductStage({
  product,
  label,
  theme,
}: Readonly<{
  product: StorefrontProduct | null;
  label: string;
  theme: StoreTheme;
}>) {
  const accent = product ? productAccent(product) : "var(--store-accent)";
  const initialsValue = initials(label);

  return (
    <div
      className={`relative grid h-full w-full place-items-center overflow-hidden ${theme.productStage}`}
      style={{
        backgroundImage: `radial-gradient(circle at top left, ${accent}26, transparent 34%), radial-gradient(circle at bottom right, rgba(15,23,42,0.12), transparent 38%)`,
      }}
    >
      <div className="absolute left-4 top-4 rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 backdrop-blur">
        {product?.brand ?? product?.categoryName ?? "Featured"}
      </div>
      <div className="text-center">
        <div
          className="mx-auto grid size-20 place-items-center rounded-[28px] text-2xl font-semibold text-white shadow-[0_18px_45px_-18px_rgba(15,23,42,0.45)]"
          style={{ background: `linear-gradient(145deg, ${accent}, var(--store-primary))` }}
        >
          {initialsValue}
        </div>
        <div className="mt-4 max-w-[16rem] px-4 text-sm font-medium text-slate-700">{label}</div>
      </div>
    </div>
  );
}

function storefrontProductFromVariant(base: StorefrontProduct, variant: StorefrontProductDetail["variants"][number]): StorefrontProduct {
  return {
    ...base,
    id: variant.productId,
    name: variant.name,
    sku: variant.sku,
    barcode: variant.barcode,
    sellingPrice: variant.sellingPrice,
    mrp: variant.mrp,
    currentStock: variant.currentStock,
    imageUrl: variant.imageUrl ?? base.imageUrl,
    size: variant.label,
  };
}

function indexProducts(products: StorefrontProduct[]): Record<string, StorefrontProduct> {
  return Object.fromEntries(products.map((product) => [product.id, product]));
}

function readProductCache(tenantSlug: string): Record<string, StorefrontProduct> {
  return readJson<Record<string, StorefrontProduct>>(productCacheStorageKey(tenantSlug), {});
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore local storage failures
  }
}

function cartStorageKey(tenantSlug: string): string {
  return `bizbil:storefront:cart:${tenantSlug}`;
}

function wishlistStorageKey(tenantSlug: string): string {
  return `bizbil:storefront:wishlist:${tenantSlug}`;
}

function recentStorageKey(tenantSlug: string): string {
  return `bizbil:storefront:recent:${tenantSlug}`;
}

function productCacheStorageKey(tenantSlug: string): string {
  return `bizbil:storefront:products:${tenantSlug}`;
}

function productHref(productId: string): string {
  return `/products/${productId}`;
}

function categoryHref(categoryId?: string | null): string {
  return categoryId ? `/categories/${categoryId}` : searchHref();
}

function searchHref(query?: string): string {
  return query?.trim() ? `/search?q=${encodeURIComponent(query.trim())}` : "/search";
}

function cartHref(): string {
  return "/cart";
}

function checkoutHref(): string {
  return "/checkout";
}

function accountHref(): string {
  return "/account";
}

function wishlistHref(): string {
  return "/wishlist";
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatSortLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function asSort(value: string): CatalogFiltersState["sort"] {
  if (value === "PRICE_ASC" || value === "PRICE_DESC" || value === "DISCOUNT" || value === "NAME" || value === "NEWEST") {
    return value;
  }
  return "FEATURED";
}

function themeFor(storefront: StorefrontBootstrap["storefront"] | undefined): StoreTheme {
  if (storefront?.theme === "PREMIUM_BRAND") {
    return {
      mode: "PREMIUM_BRAND",
      page: "bg-[#f5f1ea]",
      ink: "text-slate-950",
      backdrop: "bg-[radial-gradient(circle_at_top_left,rgba(217,119,6,0.12),transparent_24%),radial-gradient(circle_at_top_right,rgba(15,23,42,0.12),transparent_26%)]",
      header: "border-slate-800/80 bg-slate-950/95 text-white shadow-sm shadow-slate-950/12",
      topBar: "border-amber-400/20 bg-slate-900 text-amber-100",
      panel: "border-slate-200 bg-white",
      panelDivider: "border-slate-200",
      heroMuted: "text-slate-600",
      heroButton: "border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50",
      heroShowcase: "border-slate-200 bg-white",
      heroShelf: "border-slate-200 bg-white",
      muted: "text-slate-500",
      iconMuted: "text-slate-400",
      primary: "#111827",
      accent: "#d97706",
      primaryBg: "bg-slate-950",
      accentBg: "bg-[var(--store-accent)]",
      ctaBg: "bg-amber-500 text-slate-950 hover:bg-amber-400",
      cartButton: "bg-amber-500 text-slate-950 hover:bg-amber-400",
      productButton: "bg-slate-950 text-white hover:bg-slate-800",
      accentText: "text-[var(--store-accent)]",
      softBg: "bg-amber-50 text-amber-700",
      outline: "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
      outlineActive: "border-slate-200 bg-slate-100 text-slate-800",
      summary: "border-slate-200 bg-slate-50 text-slate-700",
      line: "border-slate-100 bg-white",
      empty: "border-slate-300 bg-slate-50 text-slate-500",
      imageBg: "bg-[#efe8de]",
      productStage: "bg-[linear-gradient(180deg,#f7f2ea_0%,#eee5d8_100%)]",
      stockBadge: "bg-amber-50 text-amber-700",
      progressTrack: "bg-slate-100",
      quantity: "border-slate-200 bg-white",
      activePayment: "border-slate-950 bg-slate-950 text-white",
      inactivePayment: "border-slate-200 bg-white text-slate-700",
      errorBg: "bg-red-50",
      skeleton: "bg-slate-200",
      uiFont: "\"Aptos\", \"Segoe UI\", \"Trebuchet MS\", sans-serif",
      displayFont: "\"Iowan Old Style\", \"Palatino Linotype\", Georgia, serif",
    };
  }

  return {
    mode: "CLASSIC_RETAIL",
    page: "bg-[#f4f6f2]",
    ink: "text-slate-950",
    backdrop: "bg-[radial-gradient(circle_at_top_left,rgba(35,66,57,0.12),transparent_26%),radial-gradient(circle_at_top_right,rgba(222,109,45,0.10),transparent_24%)]",
    header: "border-white/70 bg-[#f7f8f4]/92 text-slate-950 shadow-sm shadow-slate-200/50",
    topBar: "border-emerald-100 bg-emerald-50 text-emerald-800",
    panel: "border-white/75 bg-white/86 backdrop-blur",
    panelDivider: "border-slate-200",
    heroMuted: "text-slate-600",
    heroButton: "border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50",
    heroShowcase: "border-white/70 bg-white/90",
    heroShelf: "border-white/70 bg-white/88",
    muted: "text-slate-500",
    iconMuted: "text-slate-400",
    primary: "#234239",
    accent: "#de6d2d",
    primaryBg: "bg-[var(--store-primary)]",
    accentBg: "bg-[var(--store-accent)]",
    ctaBg: "bg-[var(--store-primary)] text-white hover:brightness-110",
    cartButton: "bg-[var(--store-primary)] text-white hover:brightness-110",
    productButton: "bg-[var(--store-primary)] text-white hover:brightness-110",
    accentText: "text-[var(--store-accent)]",
    softBg: "bg-[rgba(35,66,57,0.08)] text-[var(--store-primary)]",
    outline: "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
    outlineActive: "border-[var(--store-primary)] bg-[rgba(35,66,57,0.08)] text-[var(--store-primary)]",
    summary: "border-slate-200 bg-slate-50 text-slate-700",
    line: "border-slate-100 bg-white",
    empty: "border-slate-300 bg-slate-50 text-slate-500",
    imageBg: "bg-[#eef3ef]",
    productStage: "bg-[linear-gradient(180deg,#f3faf5_0%,#e5efe7_100%)]",
    stockBadge: "bg-[rgba(35,66,57,0.08)] text-[var(--store-primary)]",
    progressTrack: "bg-slate-100",
    quantity: "border-[var(--store-primary)] bg-white",
    activePayment: "border-[var(--store-primary)] bg-[var(--store-primary)] text-white",
    inactivePayment: "border-slate-200 bg-white text-slate-700",
    errorBg: "bg-red-50",
    skeleton: "bg-slate-200",
    uiFont: "\"Aptos\", \"Segoe UI\", \"Trebuchet MS\", sans-serif",
    displayFont: "\"Aptos Display\", \"Trebuchet MS\", \"Segoe UI\", sans-serif",
  };
}

function productAccent(product: StorefrontProduct): string {
  const text = `${product.name} ${product.categoryName} ${product.brand ?? ""}`.toLowerCase();
  if (text.includes("mustard")) return "#d97706";
  if (text.includes("sunflower")) return "#15803d";
  if (text.includes("groundnut") || text.includes("peanut")) return "#8b5a1f";
  if (text.includes("fashion")) return "#9f1239";
  if (text.includes("pharma") || text.includes("pharmacy")) return "#0f766e";
  return "#0f766e";
}

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "BB";
}

async function ensureRazorpayLoaded(): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("Razorpay can be opened only in the browser");
  }

  if (window.Razorpay) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-razorpay-checkout]");
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Razorpay checkout could not be loaded")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.dataset.razorpayCheckout = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Razorpay checkout could not be loaded"));
    document.body.append(script);
  });
}
