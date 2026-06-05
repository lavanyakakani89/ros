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
  Loader2,
  LogIn,
  LogOut,
  Minus,
  PackageCheck,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
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
  const bestSellers = initialBootstrap.products.slice(0, 8);
  const offerProducts = initialBootstrap.products.filter((product) => product.discountPercent > 0).slice(0, 4);
  const recentlyViewedProducts = recentlyViewedIds
    .map((productId) => productCache[productId])
    .filter((product): product is StorefrontProduct => Boolean(product));
  const wishlistProducts = wishlistIds
    .map((productId) => productCache[productId])
    .filter((product): product is StorefrontProduct => Boolean(product));
  const selectedCategory = page.kind === "category" ? categories.find((category) => category.id === page.categoryId) ?? null : null;

  return (
    <div className="min-h-screen bg-white text-slate-950" style={{
      ["--store-primary" as string]: initialBootstrap.storefront.primaryColor ?? "#29433b",
      ["--store-accent" as string]: initialBootstrap.storefront.accentColor ?? "#c99847",
    }}>
      <StoreHeader
        bootstrap={initialBootstrap}
        cartCount={cartCount}
        wishlistCount={wishlistIds.length}
        customer={customer}
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
        onLogout={handleLogout}
      />

      <main className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        {page.kind === "home" ? (
          <HomeView
            bootstrap={initialBootstrap}
            heroBanner={heroBanner}
            secondaryBanner={secondaryBanner}
            bestSellers={bestSellers}
            offerProducts={offerProducts}
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
            onAuthModeChange={setAuthMode}
            onAuthFormChange={setAuthForm}
            onAuthSubmit={handleAuthSubmit}
            onLoadOrders={handleLoadOrders}
          />
        ) : null}

        {page.kind === "wishlist" ? (
          <WishlistView
            products={wishlistProducts}
            onToggleWishlist={toggleWishlist}
            onAddToCart={addToCart}
          />
        ) : null}
      </main>

      <StoreFooter bootstrap={initialBootstrap} />
    </div>
  );
}

function StoreHeader({
  bootstrap,
  cartCount,
  wishlistCount,
  customer,
  searchInput,
  onSearchInputChange,
  onLogout,
}: Readonly<{
  bootstrap: StorefrontBootstrap;
  cartCount: number;
  wishlistCount: number;
  customer: StorefrontCustomer | null;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  onLogout: () => void;
}>) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <LogoMark src={bootstrap.tenant.logoUrl} name={bootstrap.storefront.displayName} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-950">{bootstrap.storefront.displayName}</div>
            <div className="truncate text-xs text-slate-500">{bootstrap.tenant.name}</div>
          </div>
        </Link>

        <form action={searchHref()} className="hidden flex-1 items-center gap-3 md:flex">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              name="q"
              value={searchInput}
              onChange={(event) => onSearchInputChange(event.target.value)}
              placeholder="Search oils, packs, brands, or categories"
              className="h-11 w-full rounded-full border border-slate-200 bg-slate-50 px-10 text-sm outline-none transition focus:border-[color:var(--store-primary)] focus:bg-white"
            />
          </div>
          <button className="inline-flex h-11 items-center gap-2 rounded-full bg-[color:var(--store-primary)] px-5 text-sm font-semibold text-white">
            Search
          </button>
        </form>

        <nav className="hidden items-center gap-4 lg:flex">
          {bootstrap.categories.slice(0, 4).map((category) => (
            <Link key={category.id} href={categoryHref(category.id)} className="text-sm font-medium text-slate-600 transition hover:text-slate-950">
              {category.name}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link href={wishlistHref()} className="relative inline-flex size-11 items-center justify-center rounded-full border border-slate-200 text-slate-700 transition hover:border-slate-300 hover:bg-slate-50" aria-label="Wishlist">
            <Heart className="size-4" />
            {wishlistCount > 0 ? <CountBubble value={wishlistCount} /> : null}
          </Link>
          <Link href={accountHref()} className="inline-flex h-11 items-center gap-2 rounded-full border border-slate-200 px-4 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
            <User className="size-4" />
            <span className="hidden sm:inline">{customer ? customer.name.split(" ")[0] : "Account"}</span>
          </Link>
          <Link href={cartHref()} className="relative inline-flex h-11 items-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-semibold text-white">
            <ShoppingBag className="size-4" />
            <span className="hidden sm:inline">Cart</span>
            {cartCount > 0 ? <CountBubble value={cartCount} dark /> : null}
          </Link>
          {customer ? (
            <button type="button" onClick={onLogout} className="hidden h-11 rounded-full border border-slate-200 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 xl:inline-flex xl:items-center xl:gap-2">
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
  bestSellers: StorefrontProduct[];
  offerProducts: StorefrontProduct[];
  recentlyViewedProducts: StorefrontProduct[];
  wishlistIds: string[];
  onToggleWishlist: (productId: string) => void;
  onAddToCart: (product: StorefrontProduct, quantity?: number) => void;
}>) {
  return (
    <div className="space-y-12">
      <section className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="relative overflow-hidden rounded-[28px] bg-slate-900 px-8 py-10 text-white">
          {heroBanner ? <img src={heroBanner} alt={bootstrap.storefront.displayName} className="absolute inset-0 h-full w-full object-cover opacity-40" /> : null}
          <div className="absolute inset-0 bg-gradient-to-br from-slate-950/90 via-slate-900/75 to-[color:var(--store-primary)]/70" />
          <div className="relative z-10 max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/80">
              <Sparkles className="size-3.5" />
              Online store
            </div>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">
              {bootstrap.storefront.heroTitle ?? bootstrap.storefront.displayName}
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-white/80">
              {bootstrap.storefront.heroSubtitle ?? "Fresh stock, clean category browsing, and a proper checkout flow for every tenant storefront."}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={categoryHref(bootstrap.categories[0]?.id)} className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-slate-950">
                Shop now
                <ArrowRight className="size-4" />
              </Link>
              <Link href={searchHref()} className="inline-flex h-12 items-center gap-2 rounded-full border border-white/20 px-5 text-sm font-semibold text-white">
                Browse catalog
              </Link>
            </div>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <TrustTile icon={<Truck className="size-4" />} title="Fast dispatch" detail="Built for real order flow." />
              <TrustTile icon={<ShieldCheck className="size-4" />} title="Live stock" detail="Synced with BizBil inventory." />
              <TrustTile icon={<CreditCard className="size-4" />} title="Simple checkout" detail="COD and online payment support." />
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-950">Featured categories</div>
                <div className="mt-1 text-sm text-slate-500">Start with the product families customers usually scan first.</div>
              </div>
              <Boxes className="size-5 text-[color:var(--store-primary)]" />
            </div>
            <div className="mt-5 space-y-3">
              {bootstrap.categories.slice(0, 4).map((category) => (
                <Link key={category.id} href={categoryHref(category.id)} className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100">
                  <span>{category.name}</span>
                  <span className="text-slate-400">{category.productCount}</span>
                </Link>
              ))}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[28px] border border-slate-200 bg-[color:var(--store-primary)] px-6 py-7 text-white">
            {secondaryBanner ? <img src={secondaryBanner} alt="Store banner" className="absolute inset-0 h-full w-full object-cover opacity-20" /> : null}
            <div className="relative z-10">
              <div className="text-sm font-semibold">Today's value picks</div>
              <div className="mt-2 text-2xl font-semibold">{offerProducts[0]?.discountPercent ? `${String(offerProducts[0].discountPercent)}% off` : "Featured savings"}</div>
              <div className="mt-2 max-w-xs text-sm leading-6 text-white/80">Use the product pages for variant selection, the cart for review, and the checkout page for final order confirmation.</div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <SectionHeading title="Best sellers" subtitle="A tighter storefront homepage with the main shopping action pushed into dedicated pages." actionHref={searchHref()} actionLabel="View all products" />
        <ProductGrid products={bestSellers} wishlistIds={wishlistIds} onToggleWishlist={onToggleWishlist} onAddToCart={onAddToCart} />
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-6">
          <div className="text-sm font-semibold text-slate-950">Shop by category</div>
          <div className="mt-2 text-sm leading-6 text-slate-500">Each category now gets its own browsing page, so customers can move through the store like a normal ecommerce site.</div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {bootstrap.categories.slice(0, 6).map((category) => (
              <Link key={category.id} href={categoryHref(category.id)} className="rounded-2xl border border-slate-200 bg-white px-4 py-4 transition hover:-translate-y-0.5 hover:border-slate-300">
                <div className="text-sm font-semibold text-slate-950">{category.name}</div>
                <div className="mt-1 text-xs text-slate-500">{category.productCount} products</div>
              </Link>
            ))}
          </div>
        </div>

        <div>
          <SectionHeading title="Offers and discovery" subtitle="The homepage stays light, while product detail, cart, checkout, and account now live on their own routes." />
          <ProductGrid products={offerProducts} wishlistIds={wishlistIds} onToggleWishlist={onToggleWishlist} onAddToCart={onAddToCart} compact />
        </div>
      </section>

      {recentlyViewedProducts.length > 0 ? (
        <section>
          <SectionHeading title="Recently viewed" subtitle="Customers can pick up where they left off without re-scanning the whole catalog." />
          <ProductGrid products={recentlyViewedProducts.slice(0, 4)} wishlistIds={wishlistIds} onToggleWishlist={onToggleWishlist} onAddToCart={onAddToCart} compact />
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
  filters: CatalogFiltersState;
  availableFilters: StorefrontBootstrap["productFilters"];
  wishlistIds: string[];
  onFiltersChange: (value: CatalogFiltersState) => void;
  onToggleWishlist: (productId: string) => void;
  onAddToCart: (product: StorefrontProduct, quantity?: number) => void;
}>) {
  return (
    <div className="grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="rounded-[28px] border border-slate-200 bg-slate-50 p-5 lg:sticky lg:top-24 lg:self-start">
        <div className="text-sm font-semibold text-slate-950">Filters</div>
        <div className="mt-4 space-y-4">
          <SelectField label="Brand" value={filters.brand} options={availableFilters.brands} onChange={(value) => onFiltersChange({ ...filters, brand: value })} />
          <SelectField label="Size" value={filters.size} options={availableFilters.sizes} onChange={(value) => onFiltersChange({ ...filters, size: value })} />
          <SelectField label="Color" value={filters.color} options={availableFilters.colors} onChange={(value) => onFiltersChange({ ...filters, color: value })} />
          <SelectField
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
        <SectionHeading title={title} subtitle={subtitle} />
        {loading ? <LoadingPanel message="Loading products..." /> : null}
        {error ? <ErrorPanel message={error} /> : null}
        {!loading && !error && products.length === 0 ? <EmptyPanel message="No products matched this view." /> : null}
        {!loading && !error && products.length > 0 ? (
          <ProductGrid products={products} wishlistIds={wishlistIds} onToggleWishlist={onToggleWishlist} onAddToCart={onAddToCart} />
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
  relatedProducts: StorefrontProduct[];
  frequentlyBoughtTogether: StorefrontProduct[];
  wishlistIds: string[];
  onVariantChange: (productId: string) => void;
  onAddToCart: (product: StorefrontProduct, quantity?: number) => void;
  onToggleWishlist: (productId: string) => void;
}>) {
  const displayProduct = product && activeVariant ? storefrontProductFromVariant(product, activeVariant) : product;

  if (loading) {
    return <LoadingPanel message="Loading product..." />;
  }

  if (error || !product || !displayProduct) {
    return <ErrorPanel message={error || "Product not found"} />;
  }

  const imageUrl = storefrontImageUrl(activeVariant?.imageUrl ?? product.imageUrl);

  return (
    <div className="space-y-12">
      <div className="grid gap-8 lg:grid-cols-[1fr_0.95fr]">
        <div className="rounded-[32px] border border-slate-200 bg-slate-50 p-6">
          <div className="aspect-square overflow-hidden rounded-[24px] bg-white">
            {imageUrl ? <img src={imageUrl} alt={product.name} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-sm text-slate-400">No image available</div>}
          </div>
        </div>

        <div>
          <div className="text-sm font-medium text-slate-500">{product.categoryName}</div>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">{product.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-500">
            {displayProduct.sku ? <span>SKU {displayProduct.sku}</span> : null}
            {displayProduct.barcode ? <span>Barcode {displayProduct.barcode}</span> : null}
            {product.hsnCode ? <span>HSN {product.hsnCode}</span> : null}
            <span>GST {String(product.gstRate)}%</span>
          </div>

          <div className="mt-6 flex items-end gap-3">
            <div className="text-3xl font-semibold text-slate-950">{formatCurrency(displayProduct.sellingPrice)}</div>
            {displayProduct.mrp > displayProduct.sellingPrice ? <div className="pb-1 text-base text-slate-400 line-through">{formatCurrency(displayProduct.mrp)}</div> : null}
            {product.discountPercent > 0 ? <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">{String(product.discountPercent)}% off</div> : null}
          </div>

          <div className="mt-5 text-sm text-slate-600">
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
                    className={`rounded-full border px-4 py-2 text-sm font-medium transition ${variant.productId === activeVariant?.productId ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"}`}
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
              className="inline-flex h-12 items-center gap-2 rounded-full bg-[color:var(--store-primary)] px-6 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ShoppingBag className="size-4" />
              Add to cart
            </button>
            <button type="button" onClick={() => onToggleWishlist(displayProduct.id)} className="inline-flex h-12 items-center gap-2 rounded-full border border-slate-200 px-6 text-sm font-semibold text-slate-700">
              <Heart className={`size-4 ${wishlistIds.includes(displayProduct.id) ? "fill-current text-rose-600" : ""}`} />
              Wishlist
            </button>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <InfoTile icon={<Truck className="size-4" />} title="Delivery" detail="Delivery estimate is confirmed at checkout." />
            <InfoTile icon={<ShieldCheck className="size-4" />} title="Returns" detail="Return and support policy can be handled by the store team." />
          </div>

          {product.description ? <p className="mt-8 text-sm leading-7 text-slate-600">{product.description}</p> : null}

          {product.specifications.length > 0 ? (
            <div className="mt-8 rounded-[24px] border border-slate-200">
              <div className="border-b border-slate-200 px-5 py-4 text-sm font-semibold text-slate-950">Specifications</div>
              <div className="divide-y divide-slate-200">
                {product.specifications.map((specification) => (
                  <div key={`${specification.label}-${specification.value}`} className="flex items-start justify-between gap-4 px-5 py-3 text-sm">
                    <span className="text-slate-500">{specification.label}</span>
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
          <SectionHeading title="Related products" subtitle="Customers can continue browsing through dedicated product pages instead of losing context in a modal." />
          <ProductGrid products={relatedProducts} wishlistIds={wishlistIds} onToggleWishlist={onToggleWishlist} onAddToCart={onAddToCart} compact />
        </section>
      ) : null}

      {frequentlyBoughtTogether.length > 0 ? (
        <section>
          <SectionHeading title="Frequently bought together" subtitle="Useful add-ons from the same live inventory." />
          <ProductGrid products={frequentlyBoughtTogether} wishlistIds={wishlistIds} onToggleWishlist={onToggleWishlist} onAddToCart={onAddToCart} compact />
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
  onQuantityChange,
}: Readonly<{
  cartItems: Array<{ product: StorefrontProduct; quantity: number }>;
  coupon: { code: string; discount: number; label: string } | null;
  deliveryCharge: number;
  subtotal: number;
  total: number;
  onQuantityChange: (productId: string, quantity: number) => void;
}>) {
  if (cartItems.length === 0) {
    return <EmptyPanel message="Your cart is empty. Start with a category or product page." />;
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-[28px] border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-5">
          <div className="text-lg font-semibold text-slate-950">Cart</div>
          <div className="mt-1 text-sm text-slate-500">Review products before moving to the checkout page.</div>
        </div>
        <div className="divide-y divide-slate-200">
          {cartItems.map(({ product, quantity }) => (
            <div key={product.id} className="flex items-center gap-4 px-6 py-5">
              <ProductThumbnail product={product} />
              <div className="min-w-0 flex-1">
                <Link href={productHref(product.id)} className="truncate text-sm font-semibold text-slate-950 hover:text-[color:var(--store-primary)]">
                  {product.name}
                </Link>
                <div className="mt-1 text-sm text-slate-500">{formatCurrency(product.sellingPrice)} each</div>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-slate-200 px-2 py-1">
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

      <OrderSummaryCard subtotal={subtotal} deliveryCharge={deliveryCharge} coupon={coupon} total={total} />
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
  onApplyCoupon: () => Promise<void>;
  onFormChange: React.Dispatch<React.SetStateAction<CheckoutFormState>>;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
}>) {
  if (completedOrder) {
    return (
      <div className="mx-auto max-w-3xl rounded-[32px] border border-emerald-200 bg-emerald-50 px-8 py-10">
        <div className="inline-flex size-12 items-center justify-center rounded-full bg-white text-emerald-700">
          <PackageCheck className="size-6" />
        </div>
        <h1 className="mt-5 text-3xl font-semibold text-slate-950">Order placed successfully</h1>
        <p className="mt-3 text-sm leading-7 text-slate-600">Your order {completedOrder.orderNumber} has been created from the storefront and synced into BizBil.</p>
        <div className="mt-6 rounded-[24px] bg-white p-5">
          <div className="text-sm font-semibold text-slate-950">Grand total</div>
          <div className="mt-2 text-2xl font-semibold text-slate-950">{formatCurrency(completedOrder.grandTotal)}</div>
        </div>
      </div>
    );
  }

  if (cartItems.length === 0) {
    return <EmptyPanel message="Your cart is empty. Add products before checking out." />;
  }

  const canUseRazorpay = Boolean(bootstrap.checkout.razorpayKeyId && bootstrap.checkout.paymentMethods.includes("RAZORPAY"));

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      <form className="space-y-6 rounded-[28px] border border-slate-200 bg-white p-6" onSubmit={(event) => void onSubmit(event)}>
        <div>
          <div className="text-lg font-semibold text-slate-950">Checkout</div>
          <div className="mt-1 text-sm text-slate-500">
            {customer ? "Your saved customer details are prefilled from storefront login." : "Guest checkout is available, with validation against live BizBil stock before order creation."}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Name" value={form.name} onChange={(value) => onFormChange((current) => ({ ...current, name: value }))} required />
          <FormField label="Phone" value={form.phone} onChange={(value) => onFormChange((current) => ({ ...current, phone: value }))} required />
          <FormField label="Email" value={form.email} onChange={(value) => onFormChange((current) => ({ ...current, email: value }))} />
          <FormField label="Address" value={form.address} onChange={(value) => onFormChange((current) => ({ ...current, address: value }))} required className="sm:col-span-2" />
          <FormField label="City" value={form.city} onChange={(value) => onFormChange((current) => ({ ...current, city: value }))} />
          <FormField label="State" value={form.state} onChange={(value) => onFormChange((current) => ({ ...current, state: value }))} />
          <FormField label="Postal code" value={form.postalCode} onChange={(value) => onFormChange((current) => ({ ...current, postalCode: value }))} />
          <FormField label="Order notes" value={form.notes} onChange={(value) => onFormChange((current) => ({ ...current, notes: value }))} className="sm:col-span-2" />
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <FormField label="Coupon" value={form.couponCode} onChange={(value) => onFormChange((current) => ({ ...current, couponCode: value }))} />
            <button type="button" disabled={couponLoading} onClick={() => void onApplyCoupon()} className="inline-flex h-11 items-center gap-2 rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 disabled:opacity-60">
              {couponLoading ? <Loader2 className="size-4 animate-spin" /> : null}
              Apply coupon
            </button>
          </div>
          {coupon ? <div className="mt-3 text-sm font-medium text-emerald-700">{coupon.label}</div> : null}
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-semibold text-slate-950">Payment method</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => onFormChange((current) => ({ ...current, paymentMethod: "COD" }))} className={`rounded-full border px-4 py-2 text-sm font-medium ${form.paymentMethod === "COD" ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-700"}`}>
              Cash on delivery
            </button>
            {canUseRazorpay ? (
              <button type="button" onClick={() => onFormChange((current) => ({ ...current, paymentMethod: "RAZORPAY" }))} className={`rounded-full border px-4 py-2 text-sm font-medium ${form.paymentMethod === "RAZORPAY" ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-700"}`}>
                Online payment
              </button>
            ) : null}
          </div>
        </div>

        {checkoutError ? <ErrorPanel message={checkoutError} /> : null}

        <button className="inline-flex h-12 items-center gap-2 rounded-full bg-[color:var(--store-primary)] px-6 text-sm font-semibold text-white disabled:opacity-60" disabled={checkoutLoading}>
          {checkoutLoading ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
          Place order
        </button>
      </form>

      <OrderSummaryCard subtotal={subtotal} deliveryCharge={deliveryCharge} coupon={coupon} total={total} />
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
  onAuthModeChange: (mode: "login" | "register") => void;
  onAuthFormChange: React.Dispatch<React.SetStateAction<AuthFormState>>;
  onAuthSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  onLoadOrders: () => Promise<void>;
}>) {
  if (!bootstrap.storefront.allowCustomerLogin) {
    return <EmptyPanel message="Customer login is not enabled for this storefront." />;
  }

  if (!customer) {
    return (
      <div className="mx-auto max-w-2xl rounded-[28px] border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-2 text-lg font-semibold text-slate-950">
          <LogIn className="size-5 text-[color:var(--store-primary)]" />
          Customer account
        </div>
        <div className="mt-1 text-sm text-slate-500">Use the same storefront account to review orders and speed up checkout.</div>
        <div className="mt-6 flex gap-2">
          <button type="button" onClick={() => onAuthModeChange("login")} className={`rounded-full px-4 py-2 text-sm font-semibold ${authMode === "login" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"}`}>Login</button>
          <button type="button" onClick={() => onAuthModeChange("register")} className={`rounded-full px-4 py-2 text-sm font-semibold ${authMode === "register" ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700"}`}>Create account</button>
        </div>
        <form className="mt-6 grid gap-4 sm:grid-cols-2" onSubmit={(event) => void onAuthSubmit(event)}>
          {authMode === "register" ? <FormField label="Name" value={authForm.name} onChange={(value) => onAuthFormChange((current) => ({ ...current, name: value }))} required /> : null}
          <FormField label="Phone" value={authForm.phone} onChange={(value) => onAuthFormChange((current) => ({ ...current, phone: value }))} required />
          {authMode === "register" ? <FormField label="Email" value={authForm.email} onChange={(value) => onAuthFormChange((current) => ({ ...current, email: value }))} /> : null}
          <PasswordField label="Password" value={authForm.password} onChange={(value) => onAuthFormChange((current) => ({ ...current, password: value }))} />
          {authMode === "register" ? (
            <>
              <FormField label="Address" value={authForm.address} onChange={(value) => onAuthFormChange((current) => ({ ...current, address: value }))} required className="sm:col-span-2" />
              <FormField label="City" value={authForm.city} onChange={(value) => onAuthFormChange((current) => ({ ...current, city: value }))} />
              <FormField label="State" value={authForm.state} onChange={(value) => onAuthFormChange((current) => ({ ...current, state: value }))} />
              <FormField label="Postal code" value={authForm.postalCode} onChange={(value) => onAuthFormChange((current) => ({ ...current, postalCode: value }))} />
            </>
          ) : null}
          {authError ? <div className="sm:col-span-2 text-sm text-red-700">{authError}</div> : null}
          <button className="inline-flex h-12 items-center gap-2 rounded-full bg-[color:var(--store-primary)] px-6 text-sm font-semibold text-white disabled:opacity-60 sm:col-span-2" disabled={authLoading}>
            {authLoading ? <Loader2 className="size-4 animate-spin" /> : <User className="size-4" />}
            {authMode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
      <section className="rounded-[28px] border border-slate-200 bg-white p-6">
        <div className="text-lg font-semibold text-slate-950">Profile</div>
        <div className="mt-4 space-y-3 text-sm text-slate-600">
          <div><span className="font-semibold text-slate-950">Name:</span> {customer.name}</div>
          <div><span className="font-semibold text-slate-950">Phone:</span> {customer.phone}</div>
          <div><span className="font-semibold text-slate-950">Email:</span> {customer.email ?? "-"}</div>
          <div><span className="font-semibold text-slate-950">Address:</span> {customer.address ?? "-"}</div>
        </div>
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-950">Order history</div>
            <div className="mt-1 text-sm text-slate-500">A dedicated account page instead of a side sheet.</div>
          </div>
          <button type="button" onClick={() => void onLoadOrders()} className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 px-4 text-sm font-semibold text-slate-700">
            {ordersLoading ? <Loader2 className="size-4 animate-spin" /> : <PackageCheck className="size-4" />}
            Refresh
          </button>
        </div>
        <div className="mt-5 space-y-3">
          {orders.length === 0 && !ordersLoading ? <EmptyPanel message="No storefront orders yet." compact /> : null}
          {orders.map((order) => (
            <div key={order.invoiceId} className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-950">{order.orderNumber}</div>
                  <div className="mt-1 text-xs text-slate-500">{order.items.length} items</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-slate-950">{formatCurrency(order.grandTotal)}</div>
                  <div className="mt-1 text-xs text-slate-500">{order.status}</div>
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
  onToggleWishlist,
  onAddToCart,
}: Readonly<{
  products: StorefrontProduct[];
  onToggleWishlist: (productId: string) => void;
  onAddToCart: (product: StorefrontProduct, quantity?: number) => void;
}>) {
  if (products.length === 0) {
    return <EmptyPanel message="Your wishlist is empty. Save products from the category and product pages." />;
  }

  return (
    <section>
      <SectionHeading title="Wishlist" subtitle="A separate saved-items page, like a normal ecommerce storefront." />
      <ProductGrid products={products} wishlistIds={products.map((product) => product.id)} onToggleWishlist={onToggleWishlist} onAddToCart={onAddToCart} />
    </section>
  );
}

function ProductGrid({
  products,
  wishlistIds,
  onToggleWishlist,
  onAddToCart,
  compact = false,
}: Readonly<{
  products: StorefrontProduct[];
  wishlistIds: string[];
  onToggleWishlist: (productId: string) => void;
  onAddToCart: (product: StorefrontProduct, quantity?: number) => void;
  compact?: boolean;
}>) {
  return (
    <div className={`grid gap-4 ${compact ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-2 xl:grid-cols-3"}`}>
      {products.map((product) => (
        <article key={product.id} className="group overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
          <Link href={productHref(product.id)} className="block">
            <div className="aspect-[1/1] overflow-hidden bg-slate-50">
              {storefrontImageUrl(product.imageUrl) ? <img src={storefrontImageUrl(product.imageUrl) ?? ""} alt={product.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" /> : <div className="flex h-full items-center justify-center text-sm text-slate-400">No image</div>}
            </div>
          </Link>
          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">{product.categoryName}</div>
                <Link href={productHref(product.id)} className="mt-2 block line-clamp-2 text-base font-semibold text-slate-950 hover:text-[color:var(--store-primary)]">
                  {product.name}
                </Link>
              </div>
              <button type="button" onClick={() => onToggleWishlist(product.id)} className="inline-flex size-10 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:bg-slate-50">
                <Heart className={`size-4 ${wishlistIds.includes(product.id) ? "fill-current text-rose-600" : ""}`} />
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {product.variantLabels.slice(0, 4).map((variantLabel) => (
                <span key={`${product.id}-${variantLabel}`} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                  {variantLabel}
                </span>
              ))}
            </div>

            <div className="mt-4 flex items-end gap-2">
              <div className="text-xl font-semibold text-slate-950">{formatCurrency(product.sellingPrice)}</div>
              {product.mrp > product.sellingPrice ? <div className="pb-0.5 text-sm text-slate-400 line-through">{formatCurrency(product.mrp)}</div> : null}
            </div>
            <div className="mt-1 text-sm text-slate-500">{product.currentStock > 0 ? `${String(product.currentStock)} in stock` : "Out of stock"}</div>

            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={() => onAddToCart(product, 1)}
                disabled={product.currentStock <= 0}
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ShoppingBag className="size-4" />
                Add
              </button>
              <Link href={productHref(product.id)} className="inline-flex h-11 items-center justify-center rounded-full border border-slate-200 px-4 text-sm font-semibold text-slate-700">
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
  actionHref,
  actionLabel,
}: Readonly<{
  title: string;
  subtitle: string;
  actionHref?: string;
  actionLabel?: string;
}>) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="text-2xl font-semibold tracking-tight text-slate-950">{title}</div>
        <div className="mt-2 text-sm leading-6 text-slate-500">{subtitle}</div>
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

function TrustTile({ icon, title, detail }: Readonly<{ icon: React.ReactNode; title: string; detail: string }>) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-white/10 p-4 backdrop-blur">
      <div className="inline-flex size-9 items-center justify-center rounded-full bg-white/15 text-white">{icon}</div>
      <div className="mt-3 text-sm font-semibold text-white">{title}</div>
      <div className="mt-1 text-xs leading-5 text-white/70">{detail}</div>
    </div>
  );
}

function InfoTile({ icon, title, detail }: Readonly<{ icon: React.ReactNode; title: string; detail: string }>) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
      <div className="inline-flex size-9 items-center justify-center rounded-full bg-white text-[color:var(--store-primary)]">{icon}</div>
      <div className="mt-3 text-sm font-semibold text-slate-950">{title}</div>
      <div className="mt-1 text-xs leading-5 text-slate-500">{detail}</div>
    </div>
  );
}

function OrderSummaryCard({
  subtotal,
  deliveryCharge,
  coupon,
  total,
}: Readonly<{
  subtotal: number;
  deliveryCharge: number;
  coupon: { code: string; discount: number; label: string } | null;
  total: number;
}>) {
  return (
    <aside className="rounded-[28px] border border-slate-200 bg-slate-50 p-6 lg:sticky lg:top-24 lg:self-start">
      <div className="text-lg font-semibold text-slate-950">Order summary</div>
      <div className="mt-5 space-y-3 text-sm">
        <SummaryRow label="Subtotal" value={formatCurrency(subtotal)} />
        <SummaryRow label="Delivery" value={deliveryCharge > 0 ? formatCurrency(deliveryCharge) : "Free"} />
        {coupon ? <SummaryRow label={coupon.code} value={`-${formatCurrency(coupon.discount)}`} accent /> : null}
      </div>
      <div className="mt-5 border-t border-slate-200 pt-5">
        <SummaryRow label="Total" value={formatCurrency(total)} strong />
      </div>
      <div className="mt-5 space-y-2 text-xs leading-5 text-slate-500">
        <div className="flex items-start gap-2">
          <Truck className="mt-0.5 size-3.5 shrink-0 text-[color:var(--store-primary)]" />
          Delivery and totals are validated using live BizBil pricing and stock before final order creation.
        </div>
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-[color:var(--store-primary)]" />
          Out-of-stock products stay unavailable for purchase.
        </div>
      </div>
      <Link href={checkoutHref()} className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-semibold text-white">
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
  onChange,
  required = false,
  className = "",
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  className?: string;
}>) {
  return (
    <label className={`block text-sm font-medium text-slate-700 ${className}`}>
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} required={required} className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none transition focus:border-[color:var(--store-primary)]" />
    </label>
  );
}

function PasswordField({ label, value, onChange }: Readonly<{ label: string; value: string; onChange: (value: string) => void }>) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input type="password" value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none transition focus:border-[color:var(--store-primary)]" />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: Readonly<{
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}>) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none transition focus:border-[color:var(--store-primary)]">
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>{formatSortLabel(option)}</option>
        ))}
      </select>
    </label>
  );
}

function ProductThumbnail({ product }: Readonly<{ product: StorefrontProduct }>) {
  const imageUrl = storefrontImageUrl(product.imageUrl);
  return (
    <div className="size-20 overflow-hidden rounded-[20px] bg-slate-100">
      {imageUrl ? <img src={imageUrl} alt={product.name} className="h-full w-full object-cover" /> : null}
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

function LoadingPanel({ message }: Readonly<{ message: string }>) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500">
      <Loader2 className="mx-auto mb-3 size-5 animate-spin text-[color:var(--store-primary)]" />
      {message}
    </div>
  );
}

function ErrorPanel({ message }: Readonly<{ message: string }>) {
  return (
    <div className="rounded-[28px] border border-red-200 bg-red-50 px-6 py-5 text-sm text-red-700">
      {message}
    </div>
  );
}

function EmptyPanel({ message, compact = false }: Readonly<{ message: string; compact?: boolean }>) {
  return (
    <div className={`rounded-[28px] border border-dashed border-slate-300 bg-slate-50 text-center text-sm text-slate-500 ${compact ? "px-5 py-6" : "px-6 py-12"}`}>
      {message}
    </div>
  );
}

function StoreFooter({ bootstrap }: Readonly<{ bootstrap: StorefrontBootstrap }>) {
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-10 sm:px-6 lg:flex-row lg:items-start lg:justify-between lg:px-8">
        <div className="max-w-md">
          <div className="text-lg font-semibold text-slate-950">{bootstrap.storefront.displayName}</div>
          <div className="mt-2 text-sm leading-7 text-slate-500">{bootstrap.tenant.address ?? "Online store powered by BizBil with live catalog sync and a proper multi-page shopping flow."}</div>
        </div>
        <div className="grid gap-4 text-sm text-slate-600 sm:grid-cols-3">
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

function LogoMark({ src, name }: Readonly<{ src: string | null; name: string }>) {
  const imageUrl = storefrontImageUrl(src);
  if (imageUrl) {
    return <img src={imageUrl} alt={name} className="size-11 rounded-2xl object-cover" />;
  }

  return (
    <div className="grid size-11 place-items-center rounded-2xl bg-[color:var(--store-primary)] text-sm font-bold text-white">
      {name.slice(0, 2).toUpperCase()}
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
