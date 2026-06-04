"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CreditCard,
  History,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  Minus,
  PackageCheck,
  Phone,
  Plus,
  Search,
  ShoppingBag,
  Tag,
  Trash2,
  Truck,
  User,
  X,
} from "lucide-react";

import {
  createStorefrontCheckout,
  getStorefrontBootstrap,
  getStorefrontCustomer,
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
  validateStorefrontCoupon,
  verifyStorefrontRazorpay,
} from "@/lib/storefront-api";

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

type PaymentMethod = "COD" | "RAZORPAY";
type AuthMode = "login" | "register";

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
  paymentMethod: PaymentMethod;
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

const initialForm: CheckoutFormState = {
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

const initialAuthForm: AuthFormState = {
  name: "",
  phone: "",
  email: "",
  password: "",
  address: "",
  city: "",
  state: "",
  postalCode: "",
};

export function StorefrontClient({ tenantSlug, host }: Readonly<{ tenantSlug?: string; host?: string }>) {
  const [bootstrap, setBootstrap] = useState<StorefrontBootstrap | null>(null);
  const [productsById, setProductsById] = useState<Record<string, StorefrontProduct>>({});
  const [cart, setCart] = useState<Record<string, number>>({});
  const [selectedCategory, setSelectedCategory] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(initialForm);
  const [coupon, setCoupon] = useState<{ code: string; discount: number; label: string } | null>(null);
  const [couponError, setCouponError] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completedOrder, setCompletedOrder] = useState<StorefrontOrder | null>(null);
  const [customer, setCustomer] = useState<StorefrontCustomer | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authOpen, setAuthOpen] = useState(false);
  const [authForm, setAuthForm] = useState(initialAuthForm);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [orders, setOrders] = useState<StorefrontOrder[]>([]);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);

  const activeTenantSlug = bootstrap?.tenant.slug ?? tenantSlug ?? "";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    getStorefrontBootstrap(
      {
        ...(tenantSlug ? { tenantSlug } : {}),
        ...(host ? { host } : {}),
      },
      {
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(selectedCategory ? { categoryId: selectedCategory } : {}),
      },
    )
      .then((data) => {
        if (cancelled) {
          return;
        }

        setBootstrap(data);
        setProductsById((current) => {
          const next = { ...current };
          for (const product of data.products) {
            next[product.id] = product;
          }
          return next;
        });
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Storefront could not be loaded");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [tenantSlug, host, selectedCategory, search]);

  useEffect(() => {
    if (!activeTenantSlug || !bootstrap?.storefront.allowCustomerLogin) {
      return;
    }

    let cancelled = false;
    getStorefrontCustomer(activeTenantSlug)
      .then(({ customer: currentCustomer }) => {
        if (!cancelled) {
          setCustomer(currentCustomer);
          if (currentCustomer) {
            prefillCustomer(currentCustomer);
          }
        }
      })
      .catch(() => null);

    return () => {
      cancelled = true;
    };
  }, [activeTenantSlug, bootstrap?.storefront.allowCustomerLogin]);

  const cartLines = useMemo(() => Object.entries(cart)
    .flatMap(([productId, quantity]) => {
      const product = productsById[productId];
      return product && quantity > 0 ? [{ product, quantity }] : [];
    }), [cart, productsById]);

  const cartItems = useMemo(() => cartLines.map((line) => ({
    productId: line.product.id,
    quantity: line.quantity,
  })), [cartLines]);

  const subtotal = useMemo(
    () => roundMoney(cartLines.reduce((sum, line) => sum + line.product.sellingPrice * line.quantity, 0)),
    [cartLines],
  );
  const deliveryCharge = useMemo(() => {
    const configuredCharge = bootstrap?.checkout.deliveryCharge ?? 0;
    const freeAbove = bootstrap?.checkout.freeDeliveryAbove ?? 0;
    const discountedSubtotal = Math.max(subtotal - (coupon?.discount ?? 0), 0);
    return configuredCharge > 0 && (freeAbove <= 0 || discountedSubtotal < freeAbove) ? configuredCharge : 0;
  }, [bootstrap?.checkout.deliveryCharge, bootstrap?.checkout.freeDeliveryAbove, coupon?.discount, subtotal]);
  const gstEstimate = useMemo(() => {
    if (!bootstrap?.tenant.gstEnabled || subtotal <= 0) {
      return 0;
    }

    const discount = coupon?.discount ?? 0;
    return roundMoney(cartLines.reduce((sum, line) => {
      const gross = line.product.sellingPrice * line.quantity;
      const discountShare = subtotal > 0 ? discount * (gross / subtotal) : 0;
      return sum + Math.max(gross - discountShare, 0) * (line.product.gstRate / 100);
    }, 0));
  }, [bootstrap?.tenant.gstEnabled, cartLines, coupon?.discount, subtotal]);
  const estimatedTotal = roundMoney(Math.max(subtotal - (coupon?.discount ?? 0), 0) + gstEstimate + deliveryCharge);
  const cartCount = cartLines.reduce((sum, line) => sum + line.quantity, 0);

  useEffect(() => {
    setCoupon(null);
    setCouponError("");
  }, [cartItems]);

  const products = bootstrap?.products ?? [];
  const tenant = bootstrap?.tenant;
  const storefront = bootstrap?.storefront;
  const canUseRazorpay = Boolean(bootstrap?.checkout.razorpayKeyId && bootstrap.checkout.paymentMethods.includes("RAZORPAY"));
  const canUseCod = Boolean(bootstrap?.checkout.paymentMethods.includes("COD"));
  const checkoutRequiresLogin = Boolean(storefront && !storefront.allowGuestCheckout && !customer);
  const theme = themeFor(storefront);
  const displayName = storefront?.displayName ?? tenant?.name ?? "Online Store";
  const defaultHostname = storefront?.defaultHostname ?? "BizBil online store";
  const heroTitle = storefront?.heroTitle ?? displayName;
  const heroSubtitle = storefront?.heroSubtitle ?? "Browse live stock, place your order, and choose delivery with cash or online payment where available.";
  const heroHeadingClass = heroTitle.length > 34 ? "text-4xl md:text-5xl" : "text-5xl md:text-7xl";
  const heroBanner = storefront?.banners[0]?.imageUrl ? storefrontImageUrl(storefront.banners[0].imageUrl) : null;
  const freeDeliveryAbove = bootstrap?.checkout.freeDeliveryAbove ?? 0;
  const freeDeliveryBalance = Math.max(freeDeliveryAbove - subtotal, 0);
  const freeDeliveryProgress = freeDeliveryAbove > 0 ? Math.min((subtotal / freeDeliveryAbove) * 100, 100) : 0;

  function addToCart(product: StorefrontProduct) {
    setCompletedOrder(null);
    setCart((current) => {
      const currentQuantity = current[product.id] ?? 0;
      const nextQuantity = Math.min(currentQuantity + 1, Math.floor(product.currentStock));
      return {
        ...current,
        [product.id]: nextQuantity,
      };
    });
  }

  function decrement(productId: string) {
    setCart((current) => {
      const nextQuantity = Math.max((current[productId] ?? 0) - 1, 0);
      if (nextQuantity <= 0) {
        const { [productId]: _removed, ...next } = current;
        void _removed;
        return next;
      }
      return { ...current, [productId]: nextQuantity };
    });
  }

  function removeFromCart(productId: string) {
    setCart((current) => {
      const { [productId]: _removed, ...next } = current;
      void _removed;
      return next;
    });
  }

  function updateFormField(field: keyof CheckoutFormState, value: string) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateAuthField(field: keyof AuthFormState, value: string) {
    setAuthForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function prefillCustomer(nextCustomer: StorefrontCustomer) {
    setForm((current) => ({
      ...current,
      name: nextCustomer.name,
      phone: nextCustomer.phone,
      email: nextCustomer.email ?? "",
      address: nextCustomer.address ?? "",
      city: nextCustomer.city ?? "",
      state: nextCustomer.state ?? "",
      postalCode: nextCustomer.postalCode ?? "",
    }));
    setAuthForm((current) => ({
      ...current,
      name: nextCustomer.name,
      phone: nextCustomer.phone,
      email: nextCustomer.email ?? "",
      address: nextCustomer.address ?? "",
      city: nextCustomer.city ?? "",
      state: nextCustomer.state ?? "",
      postalCode: nextCustomer.postalCode ?? "",
    }));
  }

  async function applyCoupon() {
    if (!form.couponCode.trim() || cartItems.length === 0 || !activeTenantSlug) {
      return;
    }

    setCouponLoading(true);
    setCouponError("");
    try {
      const result = await validateStorefrontCoupon(activeTenantSlug, {
        code: form.couponCode,
        items: cartItems,
      });
      setCoupon(result);
      setForm((current) => ({
        ...current,
        couponCode: result.code,
      }));
    } catch (applyError) {
      setCoupon(null);
      setCouponError(applyError instanceof Error ? applyError.message : "Coupon could not be applied");
    } finally {
      setCouponLoading(false);
    }
  }

  async function submitAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeTenantSlug) {
      return;
    }

    setAuthLoading(true);
    setAuthError("");
    try {
      const result = authMode === "login"
        ? await loginStorefrontCustomer(activeTenantSlug, {
            phone: authForm.phone,
            password: authForm.password,
          })
        : await registerStorefrontCustomer(activeTenantSlug, {
            name: authForm.name,
            phone: authForm.phone,
            ...(authForm.email.trim() ? { email: authForm.email.trim() } : {}),
            password: authForm.password,
            address: authForm.address,
            ...(authForm.city.trim() ? { city: authForm.city.trim() } : {}),
            ...(authForm.state.trim() ? { state: authForm.state.trim() } : {}),
            ...(authForm.postalCode.trim() ? { postalCode: authForm.postalCode.trim() } : {}),
          });
      setCustomer(result.customer);
      prefillCustomer(result.customer);
      setAuthOpen(false);
      setAuthForm((current) => ({ ...current, password: "" }));
    } catch (authSubmitError) {
      setAuthError(authSubmitError instanceof Error ? authSubmitError.message : "Account request failed");
    } finally {
      setAuthLoading(false);
    }
  }

  async function signOutCustomer() {
    if (!activeTenantSlug) {
      return;
    }

    await logoutStorefrontCustomer(activeTenantSlug).catch(() => null);
    setCustomer(null);
    setOrders([]);
    setOrdersOpen(false);
  }

  async function loadOrders() {
    if (!activeTenantSlug || !customer) {
      setAuthOpen(true);
      return;
    }

    setOrdersOpen((value) => !value);
    if (orders.length > 0) {
      return;
    }

    setOrdersLoading(true);
    try {
      const result = await listStorefrontCustomerOrders(activeTenantSlug);
      setOrders(result.orders);
    } catch (ordersError) {
      setError(ordersError instanceof Error ? ordersError.message : "Order history could not be loaded");
    } finally {
      setOrdersLoading(false);
    }
  }

  async function submitOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cartItems.length === 0) {
      setError("Add at least one product to your cart.");
      return;
    }
    if (checkoutRequiresLogin) {
      setAuthOpen(true);
      setError("Sign in before checkout.");
      return;
    }
    if (!activeTenantSlug) {
      setError("Storefront could not be resolved.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const response = await createStorefrontCheckout(activeTenantSlug, {
        customer: {
          name: form.name,
          phone: form.phone,
          ...(form.email.trim() ? { email: form.email.trim() } : {}),
          address: form.address,
          ...(form.city.trim() ? { city: form.city.trim() } : {}),
          ...(form.state.trim() ? { state: form.state.trim() } : {}),
          ...(form.postalCode.trim() ? { postalCode: form.postalCode.trim() } : {}),
        },
        items: cartItems,
        paymentMethod: form.paymentMethod,
        ...(coupon ? { couponCode: coupon.code } : {}),
        delivery: {
          address: form.address,
          ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
        },
      });

      if (form.paymentMethod === "RAZORPAY" && response.razorpay) {
        await openRazorpay(response);
        return;
      }

      finishOrder(response.order);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Order could not be placed");
      setSubmitting(false);
    }
  }

  async function openRazorpay(response: StorefrontCheckoutResponse) {
    if (!response.razorpay || !activeTenantSlug) {
      throw new Error("Online payment is not available");
    }

    await loadRazorpayScript();
    if (!window.Razorpay) {
      throw new Error("Razorpay checkout could not be loaded");
    }

    const checkout = new window.Razorpay({
      key: response.razorpay.keyId,
      amount: response.razorpay.amount,
      currency: response.razorpay.currency,
      name: response.razorpay.name,
      description: response.razorpay.description,
      order_id: response.razorpay.orderId,
      prefill: response.razorpay.prefill,
      theme: {
        color: storefront?.primaryColor ?? "#166534",
      },
      handler: (paymentResponse) => {
        void verifyStorefrontRazorpay(activeTenantSlug, {
          invoiceId: response.order.invoiceId,
          razorpayOrderId: paymentResponse.razorpay_order_id,
          razorpayPaymentId: paymentResponse.razorpay_payment_id,
          razorpaySignature: paymentResponse.razorpay_signature,
        })
          .then((verified) => finishOrder(verified.order))
          .catch((verifyError: unknown) => {
            setError(verifyError instanceof Error ? verifyError.message : "Payment verification failed");
          })
          .finally(() => setSubmitting(false));
      },
      modal: {
        ondismiss: () => setSubmitting(false),
      },
    });
    checkout.open();
  }

  function finishOrder(order: StorefrontOrder) {
    setCompletedOrder(order);
    setCart({});
    setCoupon(null);
    setCouponError("");
    setForm(customer
      ? {
          ...initialForm,
          name: customer.name,
          phone: customer.phone,
          email: customer.email ?? "",
          address: customer.address ?? "",
          city: customer.city ?? "",
          state: customer.state ?? "",
          postalCode: customer.postalCode ?? "",
          paymentMethod: "COD",
        }
      : initialForm);
    setOrders([]);
    setSubmitting(false);
  }

  return (
    <main
      className={`min-h-screen ${theme.page} ${theme.ink}`}
      style={{
        "--store-primary": storefront?.primaryColor ?? theme.primary,
        "--store-accent": storefront?.accentColor ?? theme.accent,
      } as React.CSSProperties}
    >
      <header className={`${theme.header} border-b`}>
        <div className={`hidden border-b text-xs font-semibold sm:block ${theme.topBar}`}>
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-2 lg:px-8">
            <div className="flex min-w-0 items-center gap-2">
              <Truck className="h-4 w-4 shrink-0" />
              <span className="truncate">
                {freeDeliveryAbove > 0 ? `Free delivery above ${money(freeDeliveryAbove)}` : "Fast local delivery on every order"}
              </span>
            </div>
            <div className="hidden items-center gap-2 md:flex">
              <PackageCheck className="h-4 w-4" />
              <span>Live stock from BizBil inventory</span>
            </div>
            {tenant?.phone ? (
              <a className="flex shrink-0 items-center gap-2" href={`tel:${tenant.phone}`}>
                <Phone className="h-4 w-4" />
                {tenant.phone}
              </a>
            ) : null}
          </div>
        </div>
        <div className="mx-auto grid max-w-7xl gap-4 px-4 py-3 sm:px-6 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center lg:px-8">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <StoreLogo tenantName={displayName} logoUrl={tenant?.logoUrl} />
              <div className="min-w-0">
                <div className={`truncate text-xs font-semibold ${theme.muted}`}>{defaultHostname}</div>
                <h1 className="truncate text-2xl font-bold leading-tight md:text-3xl">{displayName}</h1>
              </div>
            </div>
            <div className="flex shrink-0 gap-2 lg:hidden">
              <button className={iconButtonClass(theme)} type="button" onClick={() => setAuthOpen((value) => !value)} aria-label="Account">
                <User className="h-5 w-5" />
              </button>
              <a className={`${iconButtonClass(theme)} relative`} href="#checkout" aria-label="Cart">
                <ShoppingBag className="h-5 w-5" />
                {cartCount > 0 ? <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">{cartCount}</span> : null}
              </a>
            </div>
          </div>

          <label className="relative block">
            <Search className={`pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 ${theme.iconMuted}`} />
            <input
              className={inputClass(theme, "h-12 w-full pl-12 pr-4 text-base")}
              placeholder="Search oils, grocery products, and offers"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          <div className="hidden items-center gap-2 lg:flex">
            {storefront?.allowCustomerLogin ? (
              customer ? (
                <>
                  <button className={outlineButtonClass(theme)} type="button" onClick={() => void loadOrders()}>
                    <History className="h-4 w-4" />
                    Orders
                  </button>
                  <button className={outlineButtonClass(theme)} type="button" onClick={() => void signOutCustomer()}>
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </>
              ) : (
                <button className={outlineButtonClass(theme)} type="button" onClick={() => setAuthOpen((value) => !value)}>
                  <LogIn className="h-4 w-4" />
                  Account
                </button>
              )
            ) : null}
            <a className={`inline-flex h-12 items-center gap-3 rounded-md px-4 text-sm font-bold text-white ${theme.primaryBg}`} href="#checkout">
              <ShoppingBag className="h-5 w-5" />
              <span>{cartCount} item{cartCount === 1 ? "" : "s"}</span>
            </a>
          </div>
        </div>
      </header>

      <section className={`overflow-hidden ${theme.hero}`}>
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-7 sm:px-6 md:py-8 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-center lg:px-8">
          <div className="max-w-3xl">
            <h2 className={`${heroHeadingClass} font-bold leading-tight text-white`}>{heroTitle}</h2>
            <p className={`mt-4 max-w-2xl text-lg leading-7 md:text-xl ${theme.heroMuted}`}>{heroSubtitle}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a className={`inline-flex h-12 items-center justify-center rounded-md px-5 text-base font-bold text-white ${theme.ctaBg}`} href="#store-products">
                Shop products
              </a>
              {tenant?.phone ? (
                <a className={`inline-flex h-12 items-center justify-center gap-2 rounded-md border px-5 text-base font-semibold ${theme.heroButton}`} href={`tel:${tenant.phone}`}>
                  <Phone className="h-4 w-4" />
                  Call store
                </a>
              ) : null}
            </div>
            <div className="mt-6 grid max-w-2xl grid-cols-3 gap-3">
              <HeroMetric label="Products" value={products.length > 0 ? String(products.length) : "Live"} />
              <HeroMetric label={freeDeliveryAbove > 0 ? "Free delivery" : "Delivery"} value={freeDeliveryAbove > 0 ? `${money(freeDeliveryAbove)}+` : "Local"} />
              <HeroMetric label="Payment" value={canUseRazorpay ? "COD + Online" : canUseCod ? "COD" : "Online"} />
            </div>
          </div>
          {heroBanner ? <HeroBannerShowcase imageUrl={heroBanner} theme={theme} tenantName={displayName} /> : <HeroProductShowcase products={products.slice(0, 4)} theme={theme} tenantName={displayName} />}
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
        <div className="flex gap-3 overflow-x-auto pb-3">
          <CategoryTile
            active={selectedCategory === ""}
            label="All products"
            meta={`${String(products.length)} items`}
            theme={theme}
            onClick={() => setSelectedCategory("")}
          />
          {(bootstrap?.categories ?? []).map((category) => (
            <CategoryTile
              active={selectedCategory === category.id}
              key={category.id}
              label={category.name}
              meta="Shop now"
              theme={theme}
              onClick={() => setSelectedCategory(category.id)}
            />
          ))}
        </div>

        <div className={`mb-4 grid overflow-hidden rounded-md border sm:grid-cols-3 ${theme.trustStrip}`}>
          <StoreSignal theme={theme} icon={<PackageCheck className="h-4 w-4" />} label="100% live stock" value="Synced from BizBil inventory" />
          <StoreSignal theme={theme} icon={<Truck className="h-4 w-4" />} label="Delivery ready" value="Address saved with every order" />
          <StoreSignal theme={theme} icon={<CreditCard className="h-4 w-4" />} label="Secure payment" value={canUseRazorpay ? "COD and online payment" : canUseCod ? "COD available" : "Online payment only"} />
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 pb-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:px-8">
        <section className="min-w-0" id="store-products">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-bold">Best sellers</h2>
              <p className={`text-sm ${theme.muted}`}>{products.length} product{products.length === 1 ? "" : "s"} available online</p>
            </div>
            <button className={categoryClass(selectedCategory === "", theme)} type="button" onClick={() => setSelectedCategory("")}>
              View all
            </button>
          </div>

          {error ? <ErrorBanner theme={theme} message={error} onClose={() => setError("")} /> : null}

          {authOpen && storefront?.allowCustomerLogin ? (
            <AccountPanel
              authMode={authMode}
              authForm={authForm}
              authLoading={authLoading}
              authError={authError}
              theme={theme}
              onModeChange={setAuthMode}
              onFieldChange={updateAuthField}
              onSubmit={submitAuth}
              onClose={() => setAuthOpen(false)}
            />
          ) : null}

          {ordersOpen ? (
            <OrderHistory orders={orders} loading={ordersLoading} theme={theme} />
          ) : null}

          {loading && !bootstrap ? (
            <ProductSkeleton theme={theme} />
          ) : products.length === 0 ? (
            <div className={`rounded-md border p-8 text-center ${theme.panel}`}>
              <div className={`mx-auto grid h-12 w-12 place-items-center rounded-md ${theme.softBg}`}>
                <Search className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-lg font-semibold">No products found</h2>
              <p className={`mt-1 text-sm ${theme.muted}`}>Try a different search or category.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-3">
              {products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  quantity={cart[product.id] ?? 0}
                  theme={theme}
                  tenantName={displayName}
                  onAdd={() => addToCart(product)}
                  onDecrement={() => decrement(product.id)}
                />
              ))}
            </div>
          )}
        </section>

        <aside className="lg:sticky lg:top-5 lg:self-start" id="checkout">
          <form className={`overflow-hidden rounded-md border shadow-xl shadow-black/5 ${theme.panel}`} onSubmit={submitOrder}>
            <div className={`border-b p-5 ${theme.panelDivider}`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold">Your cart</h2>
                  <p className={`text-sm ${theme.muted}`}>{cartCount} item{cartCount === 1 ? "" : "s"} selected</p>
                </div>
                <div className={`grid h-11 w-11 place-items-center rounded-md ${theme.softBg}`}>
                  <ShoppingBag className="h-5 w-5 text-[var(--store-primary)]" />
                </div>
              </div>
              {freeDeliveryAbove > 0 ? (
                <div className="mt-4">
                  <div className={`flex items-center justify-between text-xs font-semibold ${theme.muted}`}>
                    <span>{freeDeliveryBalance > 0 ? `${money(freeDeliveryBalance)} away from free delivery` : "Free delivery unlocked"}</span>
                    <span>{money(subtotal)} / {money(freeDeliveryAbove)}</span>
                  </div>
                  <div className={`mt-2 h-2 overflow-hidden rounded-full ${theme.progressTrack}`}>
                    <div className="h-full rounded-full bg-[var(--store-primary)] transition-all" style={{ width: `${String(freeDeliveryProgress)}%` }} />
                  </div>
                </div>
              ) : null}
            </div>

            <div className="max-h-[34vh] overflow-y-auto p-4 lg:max-h-[32vh]">
              {cartLines.length === 0 ? (
                <div className={`rounded-md border border-dashed p-5 text-sm ${theme.empty}`}>
                  Add products to start an online order.
                </div>
              ) : (
                <div className="space-y-3">
                  {cartLines.map((line) => (
                    <div className={`grid grid-cols-[1fr_auto] gap-3 rounded-md border p-3 ${theme.line}`} key={line.product.id}>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{line.product.name}</div>
                        <div className={`mt-1 text-xs ${theme.muted}`}>{money(line.product.sellingPrice)} / {line.product.unit}</div>
                        <QuantityControl
                          quantity={line.quantity}
                          theme={theme}
                          onDecrease={() => decrement(line.product.id)}
                          onIncrease={() => addToCart(line.product)}
                          label={line.product.name}
                        />
                      </div>
                      <div className="flex flex-col items-end justify-between">
                        <button className="grid h-8 w-8 place-items-center rounded-md text-red-600 hover:bg-red-50" type="button" onClick={() => removeFromCart(line.product.id)} aria-label={`Remove ${line.product.name}`}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                        <div className="text-sm font-semibold">{money(line.product.sellingPrice * line.quantity)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={`border-y p-4 ${theme.summary}`}>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <label className="relative block">
                  <Tag className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${theme.accentText}`} />
                  <input
                    className={inputClass(theme, "h-10 w-full pl-10 pr-3")}
                    placeholder="Coupon code"
                    value={form.couponCode}
                    onChange={(event) => updateFormField("couponCode", event.target.value)}
                  />
                </label>
                <button className={`inline-flex h-10 items-center justify-center rounded-md px-3 text-sm font-bold text-white disabled:opacity-50 ${theme.accentBg}`} type="button" disabled={couponLoading || cartItems.length === 0} onClick={() => void applyCoupon()}>
                  {couponLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
                </button>
              </div>
              {coupon ? <div className="mt-2 text-xs font-semibold text-[var(--store-primary)]">{coupon.code}: {coupon.label}</div> : null}
              {couponError ? <div className="mt-2 text-xs font-semibold text-red-600">{couponError}</div> : null}

              <div className="mt-4 space-y-2 text-sm">
                <MoneyRow label="Subtotal" value={subtotal} />
                <MoneyRow label="Discount" value={-(coupon?.discount ?? 0)} />
                <MoneyRow label="GST estimate" value={gstEstimate} />
                <MoneyRow label="Delivery" value={deliveryCharge} />
                <div className={`flex items-center justify-between border-t pt-3 text-base font-semibold ${theme.panelDivider}`}>
                  <span>Total</span>
                  <span>{money(estimatedTotal)}</span>
                </div>
              </div>
            </div>

            <div className="space-y-3 p-4">
              {checkoutRequiresLogin ? (
                <button className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border text-sm font-semibold ${theme.outline}`} type="button" onClick={() => setAuthOpen(true)}>
                  <LogIn className="h-4 w-4" />
                  Sign in to checkout
                </button>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <TextField theme={theme} label="Name" value={form.name} onChange={(value) => updateFormField("name", value)} required />
                <TextField theme={theme} label="Phone" value={form.phone} onChange={(value) => updateFormField("phone", value)} required inputMode="tel" />
              </div>
              <TextField theme={theme} label="Email" value={form.email} onChange={(value) => updateFormField("email", value)} inputMode="email" />
              <TextField theme={theme} label="Delivery address" value={form.address} onChange={(value) => updateFormField("address", value)} required />
              <div className="grid grid-cols-2 gap-3">
                <TextField theme={theme} label="City" value={form.city} onChange={(value) => updateFormField("city", value)} />
                <TextField theme={theme} label="PIN code" value={form.postalCode} onChange={(value) => updateFormField("postalCode", value)} inputMode="numeric" />
              </div>
              <TextField theme={theme} label="Delivery note" value={form.notes} onChange={(value) => updateFormField("notes", value)} />

              <div className="grid grid-cols-2 gap-2">
                <PaymentButton theme={theme} active={form.paymentMethod === "COD"} disabled={!canUseCod} icon={<Truck className="h-4 w-4" />} label="COD" onClick={() => updateFormField("paymentMethod", "COD")} />
                <PaymentButton theme={theme} active={form.paymentMethod === "RAZORPAY"} disabled={!canUseRazorpay} icon={<CreditCard className="h-4 w-4" />} label="Prepaid" onClick={() => updateFormField("paymentMethod", "RAZORPAY")} />
              </div>

              <button className={`inline-flex h-12 w-full items-center justify-center gap-2 rounded-md px-4 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60 ${theme.ctaBg}`} disabled={submitting || cartItems.length === 0 || checkoutRequiresLogin} type="submit">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingBag className="h-4 w-4" />}
                Proceed to checkout
              </button>
            </div>
          </form>

          {completedOrder ? <OrderComplete theme={theme} order={completedOrder} /> : null}
        </aside>
      </div>
    </main>
  );
}

function HeroMetric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="border-l border-white/20 pl-3">
      <div className="text-base font-bold text-white md:text-lg">{value}</div>
      <div className="text-[10px] font-semibold uppercase text-white/65 md:text-xs">{label}</div>
    </div>
  );
}

function HeroProductShowcase({
  products,
  theme,
  tenantName,
}: Readonly<{
  products: StorefrontProduct[];
  theme: StoreTheme;
  tenantName: string;
}>) {
  const showcaseProducts = products.length > 0 ? products : [null, null, null];

  return (
    <div className={`relative hidden min-h-[292px] overflow-hidden rounded-md border p-4 shadow-2xl md:block ${theme.heroShowcase}`}>
      <div className="absolute inset-x-6 bottom-7 h-8 rounded-full bg-black/25 blur-xl" />
      <div className="relative grid h-full grid-cols-[0.82fr_1fr_0.82fr] items-end gap-3">
        {showcaseProducts.slice(0, 3).map((product, index) => (
          <div className={index === 1 ? "pb-2" : "pb-10"} key={product?.id ?? `hero-product-${String(index)}`}>
            {product ? (
              <ProductVisual product={product} theme={theme} tenantName={tenantName} hero={index === 1} />
            ) : (
              <ProductPlaceholderVisual index={index} theme={theme} tenantName={tenantName} hero={index === 1} />
            )}
          </div>
        ))}
      </div>
      <div className={`relative mt-3 rounded-md border px-4 py-3 ${theme.heroShelf}`}>
        <div className="text-sm font-bold text-white">Ready for online orders</div>
        <div className="mt-1 text-xs text-white/70">Catalog, cart, login, and checkout connected to BizBil.</div>
      </div>
    </div>
  );
}

function HeroBannerShowcase({ imageUrl, theme, tenantName }: Readonly<{ imageUrl: string; theme: StoreTheme; tenantName: string }>) {
  return (
    <div className={`relative hidden min-h-[292px] overflow-hidden rounded-md border shadow-2xl md:block ${theme.heroShowcase}`}>
      <img className="absolute inset-0 h-full w-full object-cover" src={imageUrl} alt={`${tenantName} ecommerce banner`} />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-5">
        <div className="text-sm font-bold text-white">Ready for online orders</div>
        <div className="mt-1 text-xs text-white/75">Catalog, cart, login, and checkout connected to BizBil.</div>
      </div>
    </div>
  );
}

function CategoryTile({
  active,
  label,
  meta,
  theme,
  onClick,
}: Readonly<{
  active: boolean;
  label: string;
  meta: string;
  theme: StoreTheme;
  onClick: () => void;
}>) {
  return (
    <button
      className={`grid min-w-[150px] grid-cols-[36px_1fr] items-center gap-3 rounded-md border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md ${
        active ? theme.categoryActive : theme.categoryTile
      }`}
      type="button"
      onClick={onClick}
    >
      <span className={`grid h-9 w-9 place-items-center rounded-md ${active ? "bg-white/20 text-white" : theme.softBg}`}>
        <Tag className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold">{label}</span>
        <span className={`block truncate text-xs ${active ? "text-white/75" : theme.muted}`}>{meta}</span>
      </span>
    </button>
  );
}

function AccountPanel({
  authMode,
  authForm,
  authLoading,
  authError,
  theme,
  onModeChange,
  onFieldChange,
  onSubmit,
  onClose,
}: Readonly<{
  authMode: AuthMode;
  authForm: AuthFormState;
  authLoading: boolean;
  authError: string;
  theme: StoreTheme;
  onModeChange: (mode: AuthMode) => void;
  onFieldChange: (field: keyof AuthFormState, value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}>) {
  return (
    <form className={`mb-4 rounded-md border p-4 ${theme.panel}`} onSubmit={onSubmit}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold">{authMode === "login" ? "Customer sign in" : "Create customer account"}</div>
          <div className={`text-sm ${theme.muted}`}>Password login with order history.</div>
        </div>
        <button className="grid h-8 w-8 place-items-center rounded-md border" type="button" onClick={onClose} aria-label="Close account panel">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <button className={modeButtonClass(authMode === "login", theme)} type="button" onClick={() => onModeChange("login")}>Sign in</button>
        <button className={modeButtonClass(authMode === "register", theme)} type="button" onClick={() => onModeChange("register")}>Register</button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {authMode === "register" ? (
          <>
            <TextField theme={theme} label="Name" value={authForm.name} onChange={(value) => onFieldChange("name", value)} required />
            <TextField theme={theme} label="Email" value={authForm.email} onChange={(value) => onFieldChange("email", value)} inputMode="email" />
          </>
        ) : null}
        <TextField theme={theme} label="Phone" value={authForm.phone} onChange={(value) => onFieldChange("phone", value)} required inputMode="tel" />
        <TextField theme={theme} label="Password" type="password" value={authForm.password} onChange={(value) => onFieldChange("password", value)} required />
        {authMode === "register" ? (
          <>
            <TextField theme={theme} label="Address" value={authForm.address} onChange={(value) => onFieldChange("address", value)} required />
            <TextField theme={theme} label="PIN code" value={authForm.postalCode} onChange={(value) => onFieldChange("postalCode", value)} inputMode="numeric" />
          </>
        ) : null}
      </div>
      {authError ? <div className="mt-3 text-sm font-semibold text-red-600">{authError}</div> : null}
      <button className={`mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold text-white ${theme.primaryBg}`} disabled={authLoading} type="submit">
        {authLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
        {authMode === "login" ? "Sign in" : "Create account"}
      </button>
    </form>
  );
}

function OrderHistory({ orders, loading, theme }: Readonly<{ orders: StorefrontOrder[]; loading: boolean; theme: StoreTheme }>) {
  return (
    <section className={`mb-4 rounded-md border ${theme.panel}`}>
      <div className={`border-b px-4 py-3 ${theme.panelDivider}`}>
        <div className="flex items-center gap-2 font-semibold">
          <History className="h-4 w-4" />
          Order history
        </div>
      </div>
      {loading ? (
        <div className={`p-4 text-sm ${theme.muted}`}>Loading orders...</div>
      ) : orders.length === 0 ? (
        <div className={`p-4 text-sm ${theme.muted}`}>No online orders yet.</div>
      ) : (
        <div className="divide-y">
          {orders.map((order) => (
            <div className="grid gap-2 p-4 text-sm md:grid-cols-[1fr_auto]" key={order.invoiceId}>
              <div>
                <div className="font-semibold">{order.orderNumber}</div>
                <div className={theme.muted}>{order.items.length} item{order.items.length === 1 ? "" : "s"} | {order.status}</div>
              </div>
              <div className="font-semibold">{money(order.grandTotal)}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ProductCard({
  product,
  quantity,
  theme,
  tenantName,
  onAdd,
  onDecrement,
}: Readonly<{
  product: StorefrontProduct;
  quantity: number;
  theme: StoreTheme;
  tenantName: string;
  onAdd: () => void;
  onDecrement: () => void;
}>) {
  const saving = product.mrp > product.sellingPrice ? product.mrp - product.sellingPrice : 0;

  return (
    <article className={`group overflow-hidden rounded-md border shadow-sm transition hover:-translate-y-1 hover:shadow-xl hover:shadow-black/10 ${theme.panel}`}>
      <ProductVisual product={product} theme={theme} tenantName={tenantName} />
      <div className="p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <div className={`truncate text-[11px] font-bold uppercase ${theme.accentText}`}>{product.categoryName}</div>
          <div className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${product.currentStock > 0 ? theme.stockBadge : theme.outBadge}`}>
            {product.currentStock > 0 ? "In stock" : "Sold out"}
          </div>
        </div>
        <h3 className="mt-2 min-h-[42px] text-sm font-bold leading-snug sm:text-base">{product.name}</h3>
        <p className={`mt-2 line-clamp-2 min-h-[36px] text-xs leading-5 sm:text-sm ${theme.muted}`}>{product.description ?? `${product.unit} pack ready for delivery.`}</p>
        <div className="mt-4 grid gap-3">
          {quantity > 0 ? (
            <div className="flex items-end justify-between gap-2">
              <div className="min-w-0">
                <div className="whitespace-nowrap text-lg font-black leading-none sm:text-xl">{money(product.sellingPrice)}</div>
                <div className={`mt-1 truncate text-[11px] sm:text-xs ${theme.muted}`}>
                  {saving > 0 ? <span>MRP {money(product.mrp)} | Save {money(saving)}</span> : <span>{product.unit} pack</span>}
                </div>
              </div>
              <QuantityControl quantity={quantity} theme={theme} onDecrease={onDecrement} onIncrease={onAdd} label={product.name} compact />
            </div>
          ) : (
            <>
              <div>
                <div className="whitespace-nowrap text-lg font-black leading-none sm:text-xl">{money(product.sellingPrice)}</div>
                <div className={`mt-1 truncate text-[11px] sm:text-xs ${theme.muted}`}>
                  {saving > 0 ? <span>MRP {money(product.mrp)} | Save {money(saving)}</span> : <span>{product.currentStock} {product.unit} available</span>}
                </div>
              </div>
              <button className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-md px-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60 ${theme.primaryBg}`} type="button" disabled={product.currentStock <= 0} onClick={onAdd}>
                <Plus className="h-4 w-4" />
                Add to cart
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function ProductVisual({
  product,
  theme,
  tenantName,
  hero = false,
}: Readonly<{
  product: StorefrontProduct;
  theme: StoreTheme;
  tenantName: string;
  hero?: boolean;
}>) {
  const imageUrl = storefrontImageUrl(product.imageUrl);
  const style = { "--product-accent": productAccent(product) } as React.CSSProperties;

  if (imageUrl) {
    return (
      <div className={`${hero ? "h-[220px]" : "aspect-square"} overflow-hidden ${theme.imageBg}`}>
        <img alt={product.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" src={imageUrl} />
      </div>
    );
  }

  return (
    <div className={`relative grid ${hero ? "h-[220px]" : "aspect-square"} place-items-center overflow-hidden ${theme.productStage}`} style={style}>
      <div className="absolute inset-x-8 bottom-5 h-5 rounded-full bg-black/15 blur-md" />
      <ProductPack product={product} tenantName={tenantName} hero={hero} />
    </div>
  );
}

function ProductPlaceholderVisual({
  index,
  theme,
  tenantName,
  hero = false,
}: Readonly<{ index: number; theme: StoreTheme; tenantName: string; hero?: boolean }>) {
  const product = {
    id: `placeholder-${String(index)}`,
    name: index === 1 ? `${tenantName} Sunflower Oil` : index === 2 ? `${tenantName} Rice Bran Oil` : `${tenantName} Groundnut Oil`,
    sku: null,
    description: null,
    categoryId: null,
    categoryName: "Cooking Oils",
    unit: index === 1 ? "5 L" : "1 L",
    mrp: 0,
    sellingPrice: 0,
    defaultDiscountPercent: null,
    gstRate: 0,
    currentStock: 1,
    imageUrl: null,
  } satisfies StorefrontProduct;

  return <ProductVisual product={product} theme={theme} tenantName={tenantName} hero={hero} />;
}

function ProductPack({ product, tenantName, hero }: Readonly<{ product: StorefrontProduct; tenantName: string; hero: boolean }>) {
  const kind = productPackageKind(product);
  const sizeClass = hero ? "h-48 w-32" : "h-40 w-28 sm:h-44 sm:w-32";
  const labelText = product.name.replace(tenantName, "").trim() || product.name;

  if (kind === "jar") {
    return (
      <div className={`relative flex ${sizeClass} flex-col items-center justify-end`}>
        <div className="h-3 w-16 rounded-t-md bg-amber-500 shadow-sm" />
        <div className="relative h-[76%] w-full overflow-hidden rounded-b-2xl rounded-t-md border border-amber-200 bg-amber-300 shadow-xl">
          <div className="absolute inset-x-5 top-3 h-10 rounded-full bg-white/30" />
          <ProductPackLabel label={labelText} tenantName={tenantName} unit={product.unit} />
        </div>
      </div>
    );
  }

  if (kind === "pouch") {
    return (
      <div className={`relative ${sizeClass}`}>
        <div className="absolute inset-x-2 bottom-0 top-7 skew-y-2 rounded-md border border-white/40 bg-[var(--product-accent)] shadow-xl" />
        <div className="absolute inset-x-5 top-4 h-4 rounded-sm bg-white/40" />
        <ProductPackLabel label={labelText} tenantName={tenantName} unit={product.unit} />
      </div>
    );
  }

  if (kind === "tin") {
    return (
      <div className={`relative ${sizeClass}`}>
        <div className="absolute inset-x-1 bottom-0 top-4 rounded-md border border-white/40 bg-[var(--product-accent)] shadow-xl" />
        <div className="absolute inset-x-0 top-0 h-5 rounded-sm bg-white/80 shadow-sm" />
        <ProductPackLabel label={labelText} tenantName={tenantName} unit={product.unit} />
      </div>
    );
  }

  return (
    <div className={`relative flex ${sizeClass} flex-col items-center justify-end`}>
      <div className="h-4 w-9 rounded-t-sm bg-red-600 shadow-sm" />
      <div className="h-6 w-11 bg-amber-100/90" />
      <div className="relative h-[78%] w-full overflow-hidden rounded-b-2xl rounded-t-lg border border-amber-200 bg-amber-300 shadow-xl">
        <div className="absolute inset-x-5 top-5 h-20 rounded-full bg-white/25" />
        <div className="absolute inset-y-0 right-3 w-5 bg-white/25" />
        <ProductPackLabel label={labelText} tenantName={tenantName} unit={product.unit} />
      </div>
    </div>
  );
}

function ProductPackLabel({ label, tenantName, unit }: Readonly<{ label: string; tenantName: string; unit: string }>) {
  return (
    <div className="absolute inset-x-4 bottom-6 rounded-md bg-white/95 p-2 text-center shadow-sm">
      <div className="truncate text-[10px] font-black uppercase text-[var(--store-primary)]">{tenantName}</div>
      <div className="mt-1 line-clamp-2 text-[10px] font-bold leading-tight text-slate-800">{label}</div>
      <div className="mt-2 inline-flex rounded-sm bg-[var(--product-accent)] px-2 py-0.5 text-[10px] font-black text-white">{unit}</div>
    </div>
  );
}

function QuantityControl({
  quantity,
  theme,
  compact = false,
  label,
  onDecrease,
  onIncrease,
}: Readonly<{
  quantity: number;
  theme: StoreTheme;
  compact?: boolean;
  label: string;
  onDecrease: () => void;
  onIncrease: () => void;
}>) {
  return (
    <div className={`mt-2 flex h-10 shrink-0 items-center rounded-md border ${theme.quantity} ${compact ? "mt-0" : ""}`}>
      <button className="grid h-10 w-10 place-items-center text-[var(--store-primary)]" type="button" onClick={onDecrease} aria-label={`Decrease ${label}`}>
        <Minus className="h-4 w-4" />
      </button>
      <div className="grid h-10 w-9 place-items-center text-sm font-semibold">{quantity}</div>
      <button className="grid h-10 w-10 place-items-center text-[var(--store-primary)]" type="button" onClick={onIncrease} aria-label={`Increase ${label}`}>
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function StoreLogo({ tenantName, logoUrl }: Readonly<{ tenantName: string; logoUrl: string | null | undefined }>) {
  if (logoUrl) {
    return (
      <div className="grid h-12 w-12 place-items-center overflow-hidden rounded-md border bg-white">
        <img alt={tenantName} className="h-full w-full object-contain" src={logoUrl} />
      </div>
    );
  }

  return <div className="grid h-12 w-12 place-items-center rounded-md bg-[var(--store-primary)] text-sm font-bold text-white">{initials(tenantName)}</div>;
}

function StoreSignal({ icon, label, value, theme }: Readonly<{ icon: React.ReactNode; label: string; value: string; theme: StoreTheme }>) {
  return (
    <div className={`p-4 ${theme.signal}`}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className={`grid h-7 w-7 place-items-center rounded-md ${theme.softBg}`}>{icon}</span>
        {label}
      </div>
      <div className={`mt-1 text-xs ${theme.muted}`}>{value}</div>
    </div>
  );
}

function ErrorBanner({ message, onClose, theme }: Readonly<{ message: string; onClose: () => void; theme: StoreTheme }>) {
  return (
    <div className={`mb-4 flex items-start justify-between gap-3 rounded-md border border-red-200 p-3 text-sm font-medium text-red-700 ${theme.errorBg}`}>
      <span>{message}</span>
      <button className="grid h-6 w-6 place-items-center rounded-md hover:bg-white" type="button" onClick={onClose} aria-label="Dismiss error">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function MoneyRow({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span className={value < 0 ? "font-semibold text-[var(--store-primary)]" : "font-medium"}>{money(value)}</span>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  theme,
  required = false,
  inputMode,
  type = "text",
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  theme: StoreTheme;
  required?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  type?: "password" | "text";
}>) {
  return (
    <label className={`block text-xs font-semibold uppercase ${theme.muted}`}>
      {label}
      <input
        className={inputClass(theme, "mt-1 h-10 w-full px-3 font-normal normal-case")}
        inputMode={inputMode}
        required={required}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function PaymentButton({
  active,
  disabled = false,
  icon,
  label,
  theme,
  onClick,
}: Readonly<{
  active: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  theme: StoreTheme;
  onClick: () => void;
}>) {
  return (
    <button
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-md border text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
        active ? theme.activePayment : theme.inactivePayment
      }`}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function OrderComplete({ order, theme }: Readonly<{ order: StorefrontOrder; theme: StoreTheme }>) {
  return (
    <div className={`mt-4 rounded-md border p-4 shadow-sm ${theme.panel}`}>
      <div className="flex items-start gap-3">
        <div className={`grid h-10 w-10 place-items-center rounded-md ${theme.softBg}`}>
          <CheckCircle2 className="h-5 w-5 text-[var(--store-primary)]" />
        </div>
        <div>
          <div className="text-sm font-semibold">Order received</div>
          <div className={`mt-1 text-sm ${theme.muted}`}>{order.orderNumber} | {money(order.grandTotal)}</div>
        </div>
      </div>
      <div className={`mt-3 flex items-start gap-2 rounded-md p-3 text-sm ${theme.summary}`}>
        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--store-primary)]" />
        <span>{order.deliveryAddress}</span>
      </div>
    </div>
  );
}

function ProductSkeleton({ theme }: Readonly<{ theme: StoreTheme }>) {
  return (
    <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div className={`overflow-hidden rounded-md border ${theme.panel}`} key={index}>
          <div className={`aspect-square animate-pulse ${theme.skeleton}`} />
          <div className="space-y-3 p-4">
            <div className={`h-4 w-20 animate-pulse rounded ${theme.skeleton}`} />
            <div className={`h-5 w-4/5 animate-pulse rounded ${theme.skeleton}`} />
            <div className={`h-10 animate-pulse rounded ${theme.skeleton}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

interface StoreTheme {
  page: string;
  ink: string;
  header: string;
  topBar: string;
  panel: string;
  panelDivider: string;
  hero: string;
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
  accentText: string;
  softBg: string;
  customerBadge: string;
  outline: string;
  summary: string;
  line: string;
  empty: string;
  imageBg: string;
  productStage: string;
  categoryTile: string;
  categoryActive: string;
  trustStrip: string;
  signal: string;
  stockBadge: string;
  outBadge: string;
  progressTrack: string;
  quantity: string;
  activePayment: string;
  inactivePayment: string;
  errorBg: string;
  skeleton: string;
}

function themeFor(storefront: StorefrontBootstrap["storefront"] | undefined): StoreTheme {
  if (storefront?.theme === "PREMIUM_BRAND") {
    return {
      page: "bg-[#f8fafc]",
      ink: "text-slate-950",
      header: "border-slate-800 bg-slate-950 text-white",
      topBar: "border-amber-400/20 bg-slate-900 text-amber-100",
      panel: "border-slate-200 bg-white",
      panelDivider: "border-slate-200",
      hero: "bg-slate-950 text-white",
      heroMuted: "text-slate-300",
      heroButton: "border-amber-300/35 bg-white/5 text-white hover:bg-white/10",
      heroShowcase: "border-amber-300/25 bg-slate-900",
      heroShelf: "border-amber-300/20 bg-slate-800",
      muted: "text-slate-500",
      iconMuted: "text-slate-300",
      primary: "#0f172a",
      accent: "#f59e0b",
      primaryBg: "bg-slate-950",
      accentBg: "bg-[var(--store-accent)]",
      ctaBg: "bg-amber-500 hover:bg-amber-400 text-slate-950",
      accentText: "text-[var(--store-accent)]",
      softBg: "bg-amber-50 text-amber-700",
      customerBadge: "border-amber-300/30 bg-white/10 text-white",
      outline: "border-slate-200 bg-white text-slate-700",
      summary: "border-slate-200 bg-slate-50 text-slate-700",
      line: "border-slate-100 bg-white",
      empty: "border-slate-300 bg-slate-50 text-slate-500",
      imageBg: "bg-slate-100",
      productStage: "bg-white",
      categoryTile: "border-slate-200 bg-white text-slate-900",
      categoryActive: "border-slate-950 bg-slate-950 text-white",
      trustStrip: "border-slate-200 bg-white",
      signal: "bg-transparent",
      stockBadge: "bg-amber-50 text-amber-700",
      outBadge: "bg-red-50 text-red-700",
      progressTrack: "bg-slate-100",
      quantity: "border-slate-950 bg-white",
      activePayment: "border-slate-950 bg-slate-100 text-slate-950",
      inactivePayment: "border-slate-200 bg-white text-slate-600",
      errorBg: "bg-red-50",
      skeleton: "bg-slate-200",
    };
  }

  return {
    page: "bg-white",
    ink: "text-slate-950",
    header: "border-slate-200 bg-white",
    topBar: "border-emerald-900 bg-emerald-950 text-white",
    panel: "border-slate-200 bg-white",
    panelDivider: "border-slate-200",
    hero: "bg-emerald-950 text-white",
    heroMuted: "text-white/75",
    heroButton: "border-white/25 bg-white/10 text-white hover:bg-white/15",
    heroShowcase: "border-white/15 bg-white/10 backdrop-blur-sm",
    heroShelf: "border-white/15 bg-white/10",
    muted: "text-slate-500",
    iconMuted: "text-slate-400",
    primary: "#166534",
    accent: "#f97316",
    primaryBg: "bg-[var(--store-primary)]",
    accentBg: "bg-[var(--store-accent)]",
    ctaBg: "bg-[#ff4b3e] hover:bg-[#e83d31]",
    accentText: "text-[var(--store-accent)]",
    softBg: "bg-emerald-50 text-[var(--store-primary)]",
    customerBadge: "border-emerald-100 bg-white text-slate-900",
    outline: "border-slate-200 bg-white text-slate-700",
    summary: "border-slate-200 bg-slate-50 text-slate-700",
    line: "border-slate-100 bg-white",
    empty: "border-slate-300 bg-slate-50 text-slate-500",
    imageBg: "bg-slate-100",
    productStage: "bg-[#f7faf8]",
    categoryTile: "border-slate-200 bg-white text-slate-900",
    categoryActive: "border-[var(--store-primary)] bg-[var(--store-primary)] text-white",
    trustStrip: "border-slate-200 bg-[#f7faf8]",
    signal: "bg-transparent",
    stockBadge: "bg-emerald-50 text-emerald-700",
    outBadge: "bg-red-50 text-red-700",
    progressTrack: "bg-slate-100",
    quantity: "border-[var(--store-primary)] bg-white",
    activePayment: "border-[var(--store-primary)] bg-emerald-50 text-[var(--store-primary)]",
    inactivePayment: "border-slate-200 bg-white text-slate-600",
    errorBg: "bg-red-50",
    skeleton: "bg-slate-200",
  };
}

function productPackageKind(product: StorefrontProduct): "bottle" | "tin" | "pouch" | "jar" {
  const text = `${product.name} ${product.categoryName} ${product.unit}`.toLowerCase();
  if (text.includes("ghee") || text.includes("honey") || text.includes("jar")) {
    return "jar";
  }
  if (text.includes("flour") || text.includes("rice") || text.includes("peanut") || text.includes("kg") || text.includes("pouch")) {
    return "pouch";
  }
  if (text.includes("sunflower") || text.includes("refined") || text.includes("5 l") || text.includes("5l")) {
    return "tin";
  }
  return "bottle";
}

function productAccent(product: StorefrontProduct): string {
  const text = `${product.name} ${product.categoryName}`.toLowerCase();
  if (text.includes("mustard")) {
    return "#d97706";
  }
  if (text.includes("sunflower")) {
    return "#0f7a3f";
  }
  if (text.includes("groundnut") || text.includes("peanut")) {
    return "#8b5a1f";
  }
  if (text.includes("rice")) {
    return "#6b9b3a";
  }
  if (text.includes("ghee")) {
    return "#f59e0b";
  }
  return "#0f766e";
}

function outlineButtonClass(theme: StoreTheme): string {
  return `inline-flex h-10 items-center gap-2 rounded-md border px-3 font-medium ${theme.outline}`;
}

function iconButtonClass(theme: StoreTheme): string {
  return `grid h-11 w-11 place-items-center rounded-md border ${theme.outline}`;
}

function inputClass(theme: StoreTheme, extra: string): string {
  return `${extra} rounded-md border ${theme.outline} text-sm outline-none transition focus:border-[var(--store-primary)] focus:bg-white`;
}

function categoryClass(active: boolean, theme: StoreTheme): string {
  return `h-10 shrink-0 rounded-md border px-3 text-sm font-semibold ${
    active ? `border-[var(--store-primary)] ${theme.primaryBg} text-white` : theme.outline
  }`;
}

function modeButtonClass(active: boolean, theme: StoreTheme): string {
  return `h-9 rounded-md border text-sm font-semibold ${active ? `border-[var(--store-primary)] ${theme.primaryBg} text-white` : theme.outline}`;
}

function money(value: number): string {
  const sign = value < 0 ? "-" : "";
  const amount = roundMoney(Math.abs(value));
  const fractionDigits = Number.isInteger(amount) ? 0 : 2;
  return `${sign}Rs ${Math.abs(value).toLocaleString("en-IN", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function initials(value: string): string {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "BB"
  );
}

async function loadRazorpayScript(): Promise<void> {
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
