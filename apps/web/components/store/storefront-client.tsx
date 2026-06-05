"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Grid2x2,
  Heart,
  History,
  Leaf,
  List,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  Minus,
  PackageCheck,
  Phone,
  Plus,
  Search,
  Share2,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Star,
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
  getStorefrontProductDetail,
  getStorefrontProducts,
  listStorefrontCustomerOrders,
  loginStorefrontCustomer,
  logoutStorefrontCustomer,
  registerStorefrontCustomer,
  searchStorefrontProducts,
  storefrontImageUrl,
  type StorefrontBootstrap,
  type StorefrontCheckoutResponse,
  type StorefrontCustomer,
  type StorefrontOrder,
  type StorefrontProductDetail,
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
type ProductSort = "FEATURED" | "PRICE_ASC" | "PRICE_DESC" | "DISCOUNT" | "NAME" | "NEWEST";
type CatalogView = "grid" | "list";

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

interface CatalogFilterState {
  brand: string;
  size: string;
  color: string;
  minPrice: string;
  maxPrice: string;
  discountOnly: boolean;
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

const initialCatalogFilters: CatalogFilterState = {
  brand: "",
  size: "",
  color: "",
  minPrice: "",
  maxPrice: "",
  discountOnly: false,
};

export function StorefrontClient({ tenantSlug, host }: Readonly<{ tenantSlug?: string; host?: string }>) {
  const [bootstrap, setBootstrap] = useState<StorefrontBootstrap | null>(null);
  const [catalogProducts, setCatalogProducts] = useState<StorefrontProduct[]>([]);
  const [catalogFilters, setCatalogFilters] = useState<StorefrontBootstrap["productFilters"] | null>(null);
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogTotalPages, setCatalogTotalPages] = useState(1);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [productsById, setProductsById] = useState<Record<string, StorefrontProduct>>({});
  const [cart, setCart] = useState<Record<string, number>>({});
  const [selectedCategory, setSelectedCategory] = useState("");
  const [search, setSearch] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchSuggestions, setSearchSuggestions] = useState<StorefrontProduct[]>([]);
  const [sortBy, setSortBy] = useState<ProductSort>("FEATURED");
  const [viewMode, setViewMode] = useState<CatalogView>("grid");
  const [filters, setFilters] = useState<CatalogFilterState>(initialCatalogFilters);
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
  const [selectedProduct, setSelectedProduct] = useState<StorefrontProduct | null>(null);
  const [selectedProductDetail, setSelectedProductDetail] = useState<StorefrontProductDetail | null>(null);
  const [relatedProducts, setRelatedProducts] = useState<StorefrontProduct[]>([]);
  const [frequentlyBoughtTogether, setFrequentlyBoughtTogether] = useState<StorefrontProduct[]>([]);
  const [productDetailLoading, setProductDetailLoading] = useState(false);
  const [recentlyViewedIds, setRecentlyViewedIds] = useState<string[]>([]);
  const [wishlistIds, setWishlistIds] = useState<string[]>([]);
  const searchMenuRef = useRef<HTMLDivElement | null>(null);

  const activeTenantSlug = bootstrap?.tenant.slug ?? tenantSlug ?? "";
  const deferredSearch = useDeferredValue(search);

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
      },
    )
      .then((data) => {
        if (cancelled) {
          return;
        }

        setBootstrap(data);
        setCatalogFilters(data.productFilters);
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
  }, [host, tenantSlug]);

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

  useEffect(() => {
    if (typeof window === "undefined" || !activeTenantSlug) {
      return;
    }

    try {
      const raw = window.localStorage.getItem(recentlyViewedKey(activeTenantSlug));
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        setRecentlyViewedIds(parsed.filter((value): value is string => typeof value === "string"));
      }
    } catch {
      setRecentlyViewedIds([]);
    }
  }, [activeTenantSlug]);

  useEffect(() => {
    if (typeof window === "undefined" || !activeTenantSlug) {
      return;
    }

    try {
      window.localStorage.setItem(recentlyViewedKey(activeTenantSlug), JSON.stringify(recentlyViewedIds.slice(0, 12)));
    } catch {
      // Local recent history is non-critical.
    }
  }, [activeTenantSlug, recentlyViewedIds]);

  useEffect(() => {
    if (typeof window === "undefined" || !activeTenantSlug) {
      return;
    }

    try {
      const raw = window.localStorage.getItem(recentSearchesKey(activeTenantSlug));
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        setRecentSearches(parsed.filter((value): value is string => typeof value === "string"));
      }
    } catch {
      setRecentSearches([]);
    }
  }, [activeTenantSlug]);

  useEffect(() => {
    if (typeof window === "undefined" || !activeTenantSlug) {
      return;
    }

    try {
      const raw = window.localStorage.getItem(wishlistKey(activeTenantSlug));
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        setWishlistIds(parsed.filter((value): value is string => typeof value === "string"));
      }
    } catch {
      setWishlistIds([]);
    }
  }, [activeTenantSlug]);

  useEffect(() => {
    if (typeof window === "undefined" || !activeTenantSlug) {
      return;
    }

    try {
      window.localStorage.setItem(recentSearchesKey(activeTenantSlug), JSON.stringify(recentSearches.slice(0, 8)));
    } catch {
      // Local recent history is non-critical.
    }
  }, [activeTenantSlug, recentSearches]);

  useEffect(() => {
    if (typeof window === "undefined" || !activeTenantSlug) {
      return;
    }

    try {
      window.localStorage.setItem(wishlistKey(activeTenantSlug), JSON.stringify(wishlistIds.slice(0, 24)));
    } catch {
      // Wishlist is local-only fallback for now.
    }
  }, [activeTenantSlug, wishlistIds]);

  useEffect(() => {
    setCatalogPage(1);
  }, [
    deferredSearch,
    filters.brand,
    filters.color,
    filters.discountOnly,
    filters.maxPrice,
    filters.minPrice,
    filters.size,
    selectedCategory,
    sortBy,
  ]);

  useEffect(() => {
    if (!activeTenantSlug) {
      return;
    }

    let cancelled = false;
    const isLoadingMore = catalogPage > 1;
    if (isLoadingMore) {
      setCatalogLoadingMore(true);
    } else {
      setCatalogLoading(true);
      setCatalogError("");
    }

    getStorefrontProducts(activeTenantSlug, {
      ...(deferredSearch.trim() ? { search: deferredSearch.trim() } : {}),
      ...(selectedCategory ? { categoryId: selectedCategory } : {}),
      ...(filters.brand ? { brand: filters.brand } : {}),
      ...(filters.size ? { size: filters.size } : {}),
      ...(filters.color ? { color: filters.color } : {}),
      ...(filters.minPrice ? { minPrice: Number(filters.minPrice) } : {}),
      ...(filters.maxPrice ? { maxPrice: Number(filters.maxPrice) } : {}),
      ...(filters.discountOnly ? { discountOnly: true } : {}),
      sort: sortBy,
      page: catalogPage,
      pageSize: 24,
    })
      .then((result) => {
        if (cancelled) {
          return;
        }

        setCatalogProducts((current) => (catalogPage > 1 ? [...current, ...result.data] : result.data));
        setCatalogFilters(result.filters);
        setCatalogTotal(result.total);
        setCatalogTotalPages(result.totalPages);
        setProductsById((current) => {
          const next = { ...current };
          for (const product of result.data) {
            next[product.id] = product;
          }
          return next;
        });
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setCatalogError(loadError instanceof Error ? loadError.message : "Products could not be loaded");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCatalogLoading(false);
          setCatalogLoadingMore(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTenantSlug, catalogPage, deferredSearch, filters.brand, filters.color, filters.discountOnly, filters.maxPrice, filters.minPrice, filters.size, selectedCategory, sortBy]);

  useEffect(() => {
    if (!activeTenantSlug || !searchFocused) {
      return;
    }

    const queryText = deferredSearch.trim();
    if (!queryText) {
      setSearchSuggestions([]);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);
    searchStorefrontProducts(activeTenantSlug, queryText, 8)
      .then((result) => {
        if (!cancelled) {
          setSearchSuggestions(result.suggestions);
          setProductsById((current) => {
            const next = { ...current };
            for (const product of result.suggestions) {
              next[product.id] = product;
            }
            return next;
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSearchSuggestions([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSearchLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTenantSlug, deferredSearch, searchFocused]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (searchMenuRef.current && !searchMenuRef.current.contains(event.target as Node)) {
        setSearchFocused(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

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
  const liveCatalogProducts = catalogProducts;
  const tenant = bootstrap?.tenant;
  const storefront = bootstrap?.storefront;
  const categories = bootstrap?.categories ?? [];
  const canUseRazorpay = Boolean(bootstrap?.checkout.razorpayKeyId && bootstrap.checkout.paymentMethods.includes("RAZORPAY"));
  const canUseCod = Boolean(bootstrap?.checkout.paymentMethods.includes("COD"));
  const checkoutRequiresLogin = Boolean(storefront && !storefront.allowGuestCheckout && !customer);
  const theme = themeFor(storefront);
  const displayName = storefront?.displayName ?? tenant?.name ?? "Online Store";
  const defaultHostname = storefront?.defaultHostname ?? "BizBil online store";
  const heroTitle = storefront?.heroTitle ?? displayName;
  const heroSubtitle = storefront?.heroSubtitle ?? "Browse live stock, place your order, and choose delivery with cash or online payment where available.";
  const heroBanner = storefront?.banners[0]?.imageUrl ? storefrontImageUrl(storefront.banners[0].imageUrl) : null;
  const secondaryBanner = storefront?.banners[1]?.imageUrl ? storefrontImageUrl(storefront.banners[1].imageUrl) : null;
  const freeDeliveryAbove = bootstrap?.checkout.freeDeliveryAbove ?? 0;
  const discountedSubtotal = Math.max(subtotal - (coupon?.discount ?? 0), 0);
  const freeDeliveryBalance = Math.max(freeDeliveryAbove - discountedSubtotal, 0);
  const freeDeliveryProgress = freeDeliveryAbove > 0 ? Math.min((discountedSubtotal / freeDeliveryAbove) * 100, 100) : 0;

  const categorySummaries = useMemo(() => categories.map((category) => {
    const categoryProducts = products.filter((product) => product.categoryId === category.id || category.children.some((child) => child.id === product.categoryId));
    return {
      id: category.id,
      name: category.name,
      code: category.code,
      count: category.productCount,
      product: categoryProducts[0] ?? null,
    };
  }).filter((category) => category.count > 0), [categories, products]);

  const spotlightCategories = categorySummaries.slice(0, 4);
  const discountedProducts = products.filter((product) => discountPercent(product) > 0).sort((left, right) => discountPercent(right) - discountPercent(left)).slice(0, 4);
  const heroProducts = products.slice(0, 3);
  const freshProducts = [...products].slice(0, 4);
  const bestSellerProducts = [...products]
    .sort((left, right) => right.currentStock - left.currentStock || discountPercent(right) - discountPercent(left) || left.name.localeCompare(right.name))
    .slice(0, 4);
  const topBrands = (bootstrap?.productFilters.brands ?? []).slice(0, 6).map((brand) => ({
    brand,
    product: products.find((product) => product.brand === brand) ?? null,
  })).filter((entry) => entry.product);
  const recentlyViewedProducts = recentlyViewedIds
    .map((productId) => productsById[productId])
    .filter((product): product is StorefrontProduct => Boolean(product))
    .slice(0, 6);
  const wishlistProducts = wishlistIds
    .map((productId) => productsById[productId])
    .filter((product): product is StorefrontProduct => Boolean(product))
    .slice(0, 6);
  const selectedCategoryName = categorySummaries.find((category) => category.id === selectedCategory)?.name ?? "All products";
  const filtersSummaryCount = [filters.brand, filters.size, filters.color, filters.minPrice, filters.maxPrice].filter(Boolean).length + (filters.discountOnly ? 1 : 0);

  function storefrontProductFromVariant(base: StorefrontProduct, variant: StorefrontProductDetail["variants"][number]): StorefrontProduct {
    return {
      ...base,
      id: variant.productId,
      name: variant.name,
      sku: variant.sku,
      barcode: variant.barcode,
      unit: variant.unit,
      mrp: variant.mrp,
      sellingPrice: variant.sellingPrice,
      currentStock: variant.currentStock,
      imageUrl: variant.imageUrl,
      size: variant.label,
      hasVariants: false,
      grouped: false,
      groupId: base.groupId,
      groupName: base.groupName,
      variantAttributeLabel: null,
      variantCount: 0,
      variantLabels: [],
      defaultVariantLabel: variant.label,
    };
  }

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

  function rememberSearch(term: string) {
    const normalized = term.trim();
    if (!normalized) {
      return;
    }

    setRecentSearches((current) => [normalized, ...current.filter((value) => value.toLowerCase() !== normalized.toLowerCase())].slice(0, 8));
  }

  function commitSearch(term: string) {
    const normalized = term.trim();
    setSearch(normalized);
    if (normalized) {
      rememberSearch(normalized);
    }
    setSearchFocused(false);
    startTransition(() => {
      setSelectedCategory("");
    });
  }

  function updateCatalogFilter(field: keyof CatalogFilterState, value: string | boolean) {
    setFilters((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function clearCatalogFilters() {
    setFilters(initialCatalogFilters);
  }

  function toggleWishlist(productId: string) {
    setWishlistIds((current) => current.includes(productId)
      ? current.filter((value) => value !== productId)
      : [productId, ...current].slice(0, 24));
  }

  async function shareProduct(product: StorefrontProduct) {
    const shareUrl = typeof window !== "undefined" ? window.location.href : "";
    const shareData = {
      title: product.name,
      text: `${product.name} - ${money(product.sellingPrice)}`,
      url: shareUrl,
    };

    try {
      if (typeof navigator !== "undefined" && "share" in navigator) {
        await navigator.share(shareData);
        return;
      }
      if (typeof window !== "undefined") {
        await window.navigator.clipboard.writeText(`${shareData.title}\n${shareData.url}`);
      }
    } catch {
      setError("Product link could not be shared.");
    }
  }

  function openProductDetails(product: StorefrontProduct) {
    setSelectedProduct(product);
    setSelectedProductDetail(null);
    setRelatedProducts([]);
    setFrequentlyBoughtTogether([]);
    setProductDetailLoading(true);
    startTransition(() => {
      setRecentlyViewedIds((current) => [product.id, ...current.filter((value) => value !== product.id)].slice(0, 12));
    });
    if (!activeTenantSlug) {
      setProductDetailLoading(false);
      return;
    }

    void getStorefrontProductDetail(activeTenantSlug, product.id)
      .then((result) => {
        setSelectedProduct(result.product);
        setSelectedProductDetail(result.product);
        setRelatedProducts(result.relatedProducts);
        setFrequentlyBoughtTogether(result.frequentlyBoughtTogether);
        setProductsById((current) => {
          const next = {
            ...current,
            [result.product.id]: result.product,
          };
          for (const variant of result.product.variants) {
            next[variant.productId] = storefrontProductFromVariant(result.product, variant);
          }
          for (const item of [...result.relatedProducts, ...result.frequentlyBoughtTogether]) {
            next[item.id] = item;
          }
          return next;
        });
      })
      .catch((detailError: unknown) => {
        setError(detailError instanceof Error ? detailError.message : "Product details could not be loaded");
      })
      .finally(() => setProductDetailLoading(false));
  }

  function loadMoreProducts() {
    if (catalogPage >= catalogTotalPages || catalogLoadingMore) {
      return;
    }
    setCatalogPage((current) => current + 1);
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

  async function openOrders() {
    if (!activeTenantSlug || !customer) {
      setAuthOpen(true);
      return;
    }

    setOrdersOpen(true);
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
        color: storefront?.primaryColor ?? "#234239",
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
      className={`relative min-h-screen overflow-x-hidden ${theme.page} ${theme.ink}`}
      style={{
        "--store-primary": storefront?.primaryColor ?? theme.primary,
        "--store-accent": storefront?.accentColor ?? theme.accent,
      } as React.CSSProperties}
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-0 top-0 h-[420px] w-full bg-[radial-gradient(circle_at_top_left,_rgba(255,172,120,0.16),_transparent_42%),radial-gradient(circle_at_top_right,_rgba(35,66,57,0.10),_transparent_34%)]" />
        <div className="absolute inset-x-0 top-[22rem] h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
      </div>

      <header className={`sticky top-0 z-30 border-b backdrop-blur-xl ${theme.header}`}>
        <div className={`hidden border-b text-xs font-semibold sm:block ${theme.topBar}`}>
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-2 lg:px-8">
            <span className="flex min-w-0 items-center gap-2 truncate">
              <Truck className="h-4 w-4 shrink-0" />
              {freeDeliveryAbove > 0 ? `Free delivery above ${money(freeDeliveryAbove)}` : "Fast local delivery"}
            </span>
            <span className="hidden items-center gap-2 md:flex">
              <PackageCheck className="h-4 w-4" />
              Live stock synced from BizBil POS
            </span>
            {tenant?.phone ? (
              <a className="flex shrink-0 items-center gap-2" href={`tel:${tenant.phone}`}>
                <Phone className="h-4 w-4" />
                {tenant.phone}
              </a>
            ) : null}
          </div>
        </div>

        <div className="mx-auto grid max-w-7xl gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(240px,auto)_minmax(320px,1fr)_auto] lg:items-center lg:px-8">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <StoreLogo tenantName={displayName} logoUrl={tenant?.logoUrl} />
              <div className="min-w-0">
                <div className={`truncate text-[11px] font-semibold uppercase tracking-[0.18em] ${theme.muted}`}>{defaultHostname}</div>
                <h1 className="truncate text-xl font-semibold tracking-tight md:text-[1.7rem]">{displayName}</h1>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 lg:hidden">
              <button className={iconButtonClass(theme)} type="button" onClick={() => setAuthOpen(true)} aria-label="Account">
                <User className="h-5 w-5" />
              </button>
              <button className={`${iconButtonClass(theme)} relative`} type="button" onClick={() => document.getElementById("checkout")?.scrollIntoView({ behavior: "smooth", block: "start" })} aria-label="Cart">
                <ShoppingBag className="h-5 w-5" />
                {cartCount > 0 ? <CountBadge count={cartCount} /> : null}
              </button>
            </div>
          </div>

          <div className="relative block" ref={searchMenuRef}>
            <Search className={`pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 ${theme.iconMuted}`} />
            <input
              className={inputClass(theme, "h-12 w-full border-white/70 bg-white/80 pl-12 pr-12 text-sm shadow-sm")}
              placeholder="Search by product, SKU, barcode, or brand"
              value={search}
              onFocus={() => setSearchFocused(true)}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitSearch(search);
                }
              }}
            />
            {search ? (
              <button
                className={`absolute right-3 top-1/2 z-10 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full ${theme.softBg}`}
                type="button"
                onClick={() => {
                  setSearch("");
                  setSearchFocused(false);
                }}
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
            {searchFocused ? (
              <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-[0_24px_70px_-32px_rgba(15,23,42,0.35)]">
                {searchLoading ? (
                  <div className="flex items-center gap-2 px-4 py-4 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching catalog...
                  </div>
                ) : deferredSearch.trim() ? (
                  searchSuggestions.length > 0 ? (
                    <div className="divide-y divide-slate-100">
                      {searchSuggestions.map((product) => (
                        <button
                          className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
                          key={product.id}
                          type="button"
                          onClick={() => {
                            commitSearch(product.name);
                            openProductDetails(product);
                          }}
                        >
                          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl">
                            <ProductVisual product={product} theme={theme} tenantName={displayName} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-slate-950">{product.name}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {product.brand ? `${product.brand} | ` : ""}{product.sku ?? product.categoryName}
                            </div>
                          </div>
                          <div className="text-sm font-semibold text-slate-950">{money(product.sellingPrice)}</div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-4 text-sm text-slate-500">
                      No direct matches yet. Try category names, barcode, or a broader search term.
                    </div>
                  )
                ) : recentSearches.length > 0 ? (
                  <div className="p-4">
                    <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Recent searches</div>
                    <div className="flex flex-wrap gap-2">
                      {recentSearches.map((term) => (
                        <button
                          className="rounded-full border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                          key={term}
                          type="button"
                          onClick={() => commitSearch(term)}
                        >
                          {term}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="px-4 py-4 text-sm text-slate-500">
                    Start typing to search the live catalog.
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <div className="hidden items-center justify-end gap-2 lg:flex">
            {storefront?.allowCustomerLogin ? customer ? (
              <>
                <button className={outlineButtonClass(theme)} type="button" onClick={() => void openOrders()}>
                  <History className="h-4 w-4" />
                  Orders
                </button>
                <button className={outlineButtonClass(theme)} type="button" onClick={() => void signOutCustomer()}>
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </>
            ) : (
              <button className={outlineButtonClass(theme)} type="button" onClick={() => setAuthOpen(true)}>
                <LogIn className="h-4 w-4" />
                Account
              </button>
            ) : null}
            <button className={`relative inline-flex h-12 items-center gap-3 rounded-full px-5 text-sm font-semibold shadow-sm ${theme.cartButton}`} type="button" onClick={() => document.getElementById("checkout")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              <ShoppingBag className="h-5 w-5" />
              {cartCount} item{cartCount === 1 ? "" : "s"}
              {cartCount > 0 ? <CountBadge count={cartCount} inset /> : null}
            </button>
          </div>
        </div>
      </header>

      <section className="relative">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 pb-6 pt-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_440px] lg:items-center lg:px-8 lg:pt-14">
          <div className="max-w-2xl">
            <div className={`inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] shadow-sm ${theme.muted}`}>
              <Sparkles className="h-3.5 w-3.5 text-[var(--store-accent)]" />
              Fast local ecommerce
            </div>
            <h2 className="mt-5 max-w-[14ch] text-[2.9rem] font-semibold leading-[0.95] tracking-tight text-slate-950 sm:text-[4rem] lg:text-[4.7rem]">{heroTitle}</h2>
            <p className={`mt-5 max-w-xl text-base leading-7 sm:text-lg ${theme.heroMuted}`}>{heroSubtitle}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a className={`inline-flex h-12 items-center justify-center rounded-full px-6 text-sm font-semibold shadow-sm transition hover:-translate-y-0.5 ${theme.ctaBg}`} href="#store-products">
                Shop products
              </a>
              <button className={`inline-flex h-12 items-center justify-center gap-2 rounded-full border px-6 text-sm font-semibold ${theme.heroButton}`} type="button" onClick={() => document.getElementById("category-discovery")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                Explore categories
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <HeroMetric label="Products online" value={String(products.length || 0)} />
              <HeroMetric label="Payments" value={canUseRazorpay ? "COD + prepaid" : canUseCod ? "Cash on delivery" : "Online only"} />
              <HeroMetric label="Delivery" value={freeDeliveryAbove > 0 ? `${money(freeDeliveryAbove)}+ free` : "Same-city"} />
            </div>
          </div>

          <div className="relative">
            {heroBanner ? (
              <HeroBannerShowcase imageUrl={heroBanner} secondaryImageUrl={secondaryBanner} theme={theme} tenantName={displayName} />
            ) : (
              <HeroProductShowcase products={heroProducts} theme={theme} tenantName={displayName} />
            )}
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <TrustTile icon={<ShieldCheck className="h-4 w-4" />} title="Verified stock" subtitle="Inventory stays in sync with BizBil." />
              <TrustTile icon={<Leaf className="h-4 w-4" />} title="Fresh assortment" subtitle="Only in-stock items are shown online." />
              <TrustTile icon={<Truck className="h-4 w-4" />} title="Ready to deliver" subtitle="COD and prepaid checkout supported." />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-4 sm:px-6 lg:px-8">
        <div className="grid gap-4 rounded-[28px] border border-white/70 bg-white/75 p-5 shadow-[0_20px_80px_-45px_rgba(15,23,42,0.4)] backdrop-blur sm:grid-cols-3">
          <FeatureStripItem icon={<PackageCheck className="h-5 w-5" />} title="Live stock only" detail="Online catalog hides unavailable items automatically." />
          <FeatureStripItem icon={<CreditCard className="h-5 w-5" />} title="Checkout that feels simple" detail="Guest checkout, account login, and payment choice in one flow." />
          <FeatureStripItem icon={<History className="h-5 w-5" />} title="Customer account ready" detail="Order history and sign-in stay within the storefront." />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8" id="category-discovery">
        <SectionHeader
          title="Shop by category"
          subtitle="Quick ways into the catalog, shaped around what this tenant already has online."
          action={categorySummaries.length > 4 ? `${String(categorySummaries.length)} live categories` : undefined}
        />
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {spotlightCategories.map((category) => (
            <CategorySpotlightCard
              key={category.id}
              active={selectedCategory === category.id}
              count={category.count}
              product={category.product}
              theme={theme}
              title={category.name}
              onClick={() => startTransition(() => setSelectedCategory(category.id))}
            />
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-8 sm:px-6 lg:px-8">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-[28px] border border-white/70 bg-white/80 p-5 shadow-[0_18px_70px_-42px_rgba(15,23,42,0.24)] backdrop-blur">
            <SectionHeader
              title="Best sellers"
              subtitle="High-demand products surfaced from the live online assortment."
            />
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {bestSellerProducts.map((product) => (
                <CompactProductRow
                  key={product.id}
                  product={product}
                  theme={theme}
                  tenantName={displayName}
                  onClick={() => openProductDetails(product)}
                />
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/70 bg-white/80 p-5 shadow-[0_18px_70px_-42px_rgba(15,23,42,0.24)] backdrop-blur">
            <SectionHeader
              title="New arrivals"
              subtitle="Fresh products that give the storefront a sense of movement."
            />
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {freshProducts.map((product) => (
                <CompactProductRow
                  key={product.id}
                  product={product}
                  theme={theme}
                  tenantName={displayName}
                  onClick={() => openProductDetails(product)}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {topBrands.length > 0 ? (
        <section className="mx-auto max-w-7xl px-4 pb-8 sm:px-6 lg:px-8">
          <SectionHeader
            title="Shop by brand"
            subtitle="Simple brand-led entry points for customers who already know what they want."
          />
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {topBrands.map(({ brand, product }) => (
              <button
                className="group flex items-center gap-4 rounded-[26px] border border-white/70 bg-white/80 p-4 text-left shadow-[0_16px_50px_-36px_rgba(15,23,42,0.28)] transition hover:-translate-y-0.5 hover:border-slate-200 hover:shadow-[0_24px_65px_-32px_rgba(15,23,42,0.3)]"
                key={brand}
                type="button"
                onClick={() => {
                  updateCatalogFilter("brand", brand);
                  document.getElementById("store-products")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                <div className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl ${theme.softBg}`}>
                  <Star className="h-5 w-5 text-[var(--store-primary)]" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-slate-950">{brand}</div>
                  <div className="mt-1 text-sm text-slate-500">{product?.categoryName ?? "Browse brand catalog"}</div>
                </div>
                <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mx-auto max-w-7xl px-4 pb-8 sm:px-6 lg:px-8">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
          <OfferPanel
            product={discountedProducts[0] ?? heroProducts[0] ?? null}
            theme={theme}
            tenantName={displayName}
            onBrowse={() => document.getElementById("store-products")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          />
          <MerchandisingPanel
            products={discountedProducts.length > 0 ? discountedProducts : freshProducts}
            theme={theme}
            title={discountedProducts.length > 0 ? "Offers worth highlighting" : "Fresh online picks"}
            subtitle={discountedProducts.length > 0 ? "A quick shortlist for the products with the strongest value." : "A compact set of items now available in the storefront."}
            onProductClick={openProductDetails}
          />
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-8 px-4 pb-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_392px] lg:px-8">
        <section className="min-w-0" id="store-products">
          <div className="rounded-[28px] border border-white/70 bg-white/80 p-5 shadow-[0_18px_70px_-42px_rgba(15,23,42,0.28)] backdrop-blur">
            <div className="flex flex-col gap-5 border-b border-slate-200/80 pb-5">
              <SectionHeader
                title={selectedCategory ? selectedCategoryName : "Browse the storefront"}
                subtitle={`${String(catalogTotal || liveCatalogProducts.length)} product${catalogTotal === 1 ? "" : "s"} available online now`}
              />
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  <CategoryChip active={selectedCategory === ""} label="All products" theme={theme} onClick={() => startTransition(() => setSelectedCategory(""))} />
                  {categorySummaries.map((category) => (
                    <CategoryChip
                      active={selectedCategory === category.id}
                      key={category.id}
                      label={category.name}
                      theme={theme}
                      onClick={() => startTransition(() => setSelectedCategory(category.id))}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="min-w-[180px]">
                    <span className="sr-only">Sort products</span>
                    <select
                      className={inputClass(theme, "h-11 w-full border-white/70 bg-white/90 px-4 shadow-sm")}
                      value={sortBy}
                      onChange={(event) => setSortBy(event.target.value as ProductSort)}
                    >
                      <option value="FEATURED">Featured first</option>
                      <option value="NEWEST">Newest</option>
                      <option value="PRICE_ASC">Price: low to high</option>
                      <option value="PRICE_DESC">Price: high to low</option>
                      <option value="DISCOUNT">Best discount</option>
                      <option value="NAME">Alphabetical</option>
                    </select>
                  </label>
                  <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm">
                    <button className={modeButtonClass(viewMode === "grid", theme)} type="button" onClick={() => setViewMode("grid")} aria-label="Grid view">
                      <Grid2x2 className="h-4 w-4" />
                    </button>
                    <button className={modeButtonClass(viewMode === "list", theme)} type="button" onClick={() => setViewMode("list")} aria-label="List view">
                      <List className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_120px_120px_auto]">
                <label>
                  <span className="sr-only">Filter by brand</span>
                  <select className={inputClass(theme, "h-11 w-full border-white/70 bg-white/90 px-4 shadow-sm")} value={filters.brand} onChange={(event) => updateCatalogFilter("brand", event.target.value)}>
                    <option value="">All brands</option>
                    {(catalogFilters?.brands ?? bootstrap?.productFilters.brands ?? []).map((brand) => (
                      <option key={brand} value={brand}>{brand}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="sr-only">Filter by size</span>
                  <select className={inputClass(theme, "h-11 w-full border-white/70 bg-white/90 px-4 shadow-sm")} value={filters.size} onChange={(event) => updateCatalogFilter("size", event.target.value)}>
                    <option value="">All sizes</option>
                    {(catalogFilters?.sizes ?? bootstrap?.productFilters.sizes ?? []).map((size) => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="sr-only">Filter by color</span>
                  <select className={inputClass(theme, "h-11 w-full border-white/70 bg-white/90 px-4 shadow-sm")} value={filters.color} onChange={(event) => updateCatalogFilter("color", event.target.value)}>
                    <option value="">All colors</option>
                    {(catalogFilters?.colors ?? bootstrap?.productFilters.colors ?? []).map((color) => (
                      <option key={color} value={color}>{color}</option>
                    ))}
                  </select>
                </label>
                <input
                  className={inputClass(theme, "h-11 w-full border-white/70 bg-white/90 px-4 shadow-sm")}
                  placeholder="Min"
                  inputMode="numeric"
                  value={filters.minPrice}
                  onChange={(event) => updateCatalogFilter("minPrice", event.target.value.replace(/[^\d.]/g, ""))}
                />
                <input
                  className={inputClass(theme, "h-11 w-full border-white/70 bg-white/90 px-4 shadow-sm")}
                  placeholder="Max"
                  inputMode="numeric"
                  value={filters.maxPrice}
                  onChange={(event) => updateCatalogFilter("maxPrice", event.target.value.replace(/[^\d.]/g, ""))}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className={`inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold ${filters.discountOnly ? theme.outlineActive : theme.outline}`}
                    type="button"
                    onClick={() => updateCatalogFilter("discountOnly", !filters.discountOnly)}
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                    Offers only
                  </button>
                  {filtersSummaryCount > 0 ? (
                    <button className="text-sm font-semibold text-slate-500 transition hover:text-slate-700" type="button" onClick={clearCatalogFilters}>
                      Clear {filtersSummaryCount}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            {error ? <ErrorBanner theme={theme} message={error} onClose={() => setError("")} /> : null}
            {catalogError ? <ErrorBanner theme={theme} message={catalogError} onClose={() => setCatalogError("")} /> : null}

            {loading && !bootstrap ? (
              <div className="mt-6">
                <ProductSkeleton theme={theme} />
              </div>
            ) : catalogLoading ? (
              <div className="mt-6">
                <ProductSkeleton theme={theme} />
              </div>
            ) : liveCatalogProducts.length === 0 ? (
              <div className={`mt-6 rounded-[24px] border border-dashed p-10 text-center ${theme.empty}`}>
                <div className={`mx-auto grid h-14 w-14 place-items-center rounded-2xl ${theme.softBg}`}>
                  <Search className="h-6 w-6" />
                </div>
                <h3 className="mt-5 text-xl font-semibold text-slate-950">No products match this view</h3>
                <p className={`mx-auto mt-2 max-w-md text-sm leading-6 ${theme.muted}`}>Try a different search term, clear one of the active filters, or switch categories to keep browsing the online catalog.</p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {recentSearches.slice(0, 3).map((term) => (
                    <button className="rounded-full border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50" key={term} type="button" onClick={() => commitSearch(term)}>
                      {term}
                    </button>
                  ))}
                  {categorySummaries.slice(0, 3).map((category) => (
                    <button className="rounded-full border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50" key={category.id} type="button" onClick={() => setSelectedCategory(category.id)}>
                      {category.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div className={viewMode === "grid" ? "mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" : "mt-6 space-y-4"}>
                  {liveCatalogProducts.map((product, index) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      quantity={product.grouped ? 0 : (cart[product.id] ?? 0)}
                      rank={index + 1}
                      theme={theme}
                      tenantName={displayName}
                      viewMode={viewMode}
                      wishlisted={wishlistIds.includes(product.id)}
                      onAdd={() => addToCart(product)}
                      onDecrement={() => decrement(product.id)}
                      onQuickView={() => openProductDetails(product)}
                      onWishlist={() => toggleWishlist(product.id)}
                    />
                  ))}
                </div>
                {catalogPage < catalogTotalPages ? (
                  <div className="mt-6 flex justify-center">
                    <button className={`inline-flex h-12 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold ${theme.outline}`} type="button" onClick={loadMoreProducts} disabled={catalogLoadingMore}>
                      {catalogLoadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Load more products
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>

          {wishlistProducts.length > 0 ? (
            <section className="mt-8 rounded-[28px] border border-white/70 bg-white/80 p-5 shadow-[0_18px_70px_-42px_rgba(15,23,42,0.24)] backdrop-blur">
              <SectionHeader
                title="Wishlist"
                subtitle="Saved items that customers may want to revisit before checkout."
              />
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {wishlistProducts.map((product) => (
                  <CompactProductRow
                    key={product.id}
                    product={product}
                    theme={theme}
                    tenantName={displayName}
                    onClick={() => openProductDetails(product)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {recentlyViewedProducts.length > 0 ? (
            <section className="mt-8 rounded-[28px] border border-white/70 bg-white/80 p-5 shadow-[0_18px_70px_-42px_rgba(15,23,42,0.24)] backdrop-blur">
              <SectionHeader
                title="Recently viewed"
                subtitle="Shortcuts back to products the customer explored during this visit."
              />
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {recentlyViewedProducts.map((product) => (
                  <CompactProductRow
                    key={product.id}
                    product={product}
                    theme={theme}
                    tenantName={displayName}
                    onClick={() => openProductDetails(product)}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </section>

        <aside className="lg:sticky lg:top-24 lg:self-start" id="checkout">
          <form className={`overflow-hidden rounded-[30px] border border-white/70 bg-white/88 shadow-[0_28px_90px_-46px_rgba(15,23,42,0.38)] backdrop-blur ${theme.panel}`} onSubmit={submitOrder}>
            <div className={`border-b p-6 ${theme.panelDivider}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${theme.muted}`}>Cart summary</div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Ready to place order</h2>
                  <p className={`mt-1 text-sm ${theme.muted}`}>{cartCount} item{cartCount === 1 ? "" : "s"} selected</p>
                </div>
                <div className={`grid h-12 w-12 place-items-center rounded-2xl ${theme.softBg}`}>
                  <ShoppingBag className="h-5 w-5 text-[var(--store-primary)]" />
                </div>
              </div>
              {freeDeliveryAbove > 0 ? (
                <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/90 p-4">
                  <div className={`flex items-center justify-between text-xs font-semibold ${theme.muted}`}>
                    <span>{freeDeliveryBalance > 0 ? `${money(freeDeliveryBalance)} away from free delivery` : "Free delivery unlocked"}</span>
                    <span>{money(discountedSubtotal)} / {money(freeDeliveryAbove)}</span>
                  </div>
                  <div className={`mt-3 h-2 overflow-hidden rounded-full ${theme.progressTrack}`}>
                    <div className="h-full rounded-full bg-[var(--store-primary)] transition-all" style={{ width: `${String(freeDeliveryProgress)}%` }} />
                  </div>
                </div>
              ) : null}
            </div>

            <div className="max-h-[32vh] overflow-y-auto px-5 py-5">
              {cartLines.length === 0 ? (
                <div className={`rounded-[22px] border border-dashed p-5 text-sm leading-6 ${theme.empty}`}>
                  Add products to start an online order. The checkout will calculate tax and delivery from live catalog data.
                </div>
              ) : (
                <div className="space-y-3">
                  {cartLines.map((line) => (
                    <div className={`grid grid-cols-[1fr_auto] gap-3 rounded-[22px] border p-4 ${theme.line}`} key={line.product.id}>
                      <div className="min-w-0">
                        <button className="text-left" type="button" onClick={() => openProductDetails(line.product)}>
                          <div className="truncate text-sm font-semibold text-slate-950">{line.product.name}</div>
                        </button>
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
                        <button className="grid h-8 w-8 place-items-center rounded-full text-red-600 transition hover:bg-red-50" type="button" onClick={() => removeFromCart(line.product.id)} aria-label={`Remove ${line.product.name}`}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                        <div className="text-sm font-semibold text-slate-950">{money(line.product.sellingPrice * line.quantity)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={`border-y px-5 py-5 ${theme.summary}`}>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <label className="relative block">
                  <Tag className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${theme.accentText}`} />
                  <input
                    className={inputClass(theme, "h-11 w-full border-white/70 bg-white/90 pl-10 pr-3 shadow-sm")}
                    placeholder="Coupon code"
                    value={form.couponCode}
                    onChange={(event) => updateFormField("couponCode", event.target.value)}
                  />
                </label>
                <button className={`inline-flex h-11 items-center justify-center rounded-full px-4 text-sm font-semibold text-white disabled:opacity-50 ${theme.accentBg}`} type="button" disabled={couponLoading || cartItems.length === 0} onClick={() => void applyCoupon()}>
                  {couponLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
                </button>
              </div>
              {coupon ? <div className="mt-3 text-xs font-semibold text-[var(--store-primary)]">{coupon.code}: {coupon.label}</div> : null}
              {couponError ? <div className="mt-3 text-xs font-semibold text-red-600">{couponError}</div> : null}

              <div className="mt-5 space-y-2 text-sm">
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

            <div className="space-y-4 p-5">
              {checkoutRequiresLogin ? (
                <button className={`inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border text-sm font-semibold ${theme.outline}`} type="button" onClick={() => setAuthOpen(true)}>
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
              <TextAreaField theme={theme} label="Delivery note" value={form.notes} onChange={(value) => updateFormField("notes", value)} />

              <div className="grid grid-cols-2 gap-2">
                <PaymentButton theme={theme} active={form.paymentMethod === "COD"} disabled={!canUseCod} icon={<Truck className="h-4 w-4" />} label="Cash on delivery" onClick={() => updateFormField("paymentMethod", "COD")} />
                <PaymentButton theme={theme} active={form.paymentMethod === "RAZORPAY"} disabled={!canUseRazorpay} icon={<CreditCard className="h-4 w-4" />} label="Pay online" onClick={() => updateFormField("paymentMethod", "RAZORPAY")} />
              </div>

              <button className={`inline-flex h-12 w-full items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-60 ${theme.ctaBg}`} disabled={submitting || cartItems.length === 0 || checkoutRequiresLogin} type="submit">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingBag className="h-4 w-4" />}
                Proceed to checkout
              </button>

              <div className={`grid gap-2 rounded-[22px] border border-slate-200 bg-slate-50/80 p-4 text-xs ${theme.muted}`}>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-[var(--store-primary)]" />
                  Price, stock, and checkout totals are validated from BizBil before order creation.
                </div>
                <div className="flex items-center gap-2">
                  <Truck className="h-4 w-4 text-[var(--store-primary)]" />
                  Orders are placed only for products that are still available online.
                </div>
              </div>
            </div>
          </form>

          {completedOrder ? <OrderComplete theme={theme} order={completedOrder} /> : null}
        </aside>
      </div>

      {authOpen ? (
        <SideSheet title={authMode === "login" ? "Customer account" : "Create account"} subtitle="Sign in to keep order history connected to the storefront." onClose={() => setAuthOpen(false)}>
          <AccountPanel
            authMode={authMode}
            authForm={authForm}
            authLoading={authLoading}
            authError={authError}
            theme={theme}
            onModeChange={setAuthMode}
            onFieldChange={updateAuthField}
            onSubmit={submitAuth}
          />
        </SideSheet>
      ) : null}

      {ordersOpen ? (
        <SideSheet title="Your orders" subtitle="Track online orders placed from this storefront." onClose={() => setOrdersOpen(false)}>
          <OrderHistory orders={orders} loading={ordersLoading} theme={theme} />
        </SideSheet>
      ) : null}

      {selectedProduct ? (
        <SideSheet
          title={selectedProduct.name}
          subtitle={selectedProduct.categoryName}
          onClose={() => {
            setSelectedProduct(null);
            setSelectedProductDetail(null);
            setRelatedProducts([]);
            setFrequentlyBoughtTogether([]);
          }}
          wide
        >
          <ProductQuickView
            product={selectedProduct}
            detail={selectedProductDetail}
            relatedProducts={relatedProducts}
            frequentlyBoughtTogether={frequentlyBoughtTogether}
            loading={productDetailLoading}
            theme={theme}
            tenantName={displayName}
            cart={cart}
            productsById={productsById}
            onAddProduct={addToCart}
            onDecrementProduct={decrement}
            onSelectProduct={openProductDetails}
            onWishlist={() => toggleWishlist(selectedProduct.id)}
            onShare={() => void shareProduct(selectedProduct)}
            wishlisted={wishlistIds.includes(selectedProduct.id)}
          />
        </SideSheet>
      ) : null}

      <FloatingCartButton cartCount={cartCount} total={estimatedTotal} onClick={() => document.getElementById("checkout")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
    </main>
  );
}

function SectionHeader({
  title,
  subtitle,
  action,
}: Readonly<{
  title: string;
  subtitle: string;
  action?: string | undefined;
}>) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
      <div>
        <h2 className="text-[1.9rem] font-semibold tracking-tight text-slate-950">{title}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">{subtitle}</p>
      </div>
      {action ? <div className="text-sm font-semibold text-slate-500">{action}</div> : null}
    </div>
  );
}

function HeroMetric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-[22px] border border-white/70 bg-white/78 px-4 py-4 shadow-sm">
      <div className="text-lg font-semibold tracking-tight text-slate-950">{value}</div>
      <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
    </div>
  );
}

function FeatureStripItem({
  icon,
  title,
  detail,
}: Readonly<{
  icon: React.ReactNode;
  title: string;
  detail: string;
}>) {
  return (
    <div className="flex gap-3 rounded-[22px] border border-slate-200/80 bg-white/70 p-4">
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[rgba(35,66,57,0.08)] text-[var(--store-primary)]">
        {icon}
      </div>
      <div>
        <div className="text-sm font-semibold text-slate-950">{title}</div>
        <div className="mt-1 text-sm leading-6 text-slate-500">{detail}</div>
      </div>
    </div>
  );
}

function TrustTile({
  icon,
  title,
  subtitle,
}: Readonly<{
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}>) {
  return (
    <div className="rounded-[22px] border border-white/75 bg-white/78 p-4 shadow-sm">
      <div className="flex items-center gap-2 text-[var(--store-primary)]">
        {icon}
        <span className="text-sm font-semibold text-slate-950">{title}</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-500">{subtitle}</p>
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
    <div className={`relative hidden overflow-hidden rounded-[32px] border p-6 shadow-[0_28px_100px_-50px_rgba(15,23,42,0.5)] md:block ${theme.heroShowcase}`}>
      <div className="pointer-events-none absolute inset-x-12 bottom-12 h-10 rounded-full bg-black/12 blur-2xl" />
      <div className="grid min-h-[330px] grid-cols-[0.82fr_1fr_0.82fr] items-end gap-4">
        {showcaseProducts.slice(0, 3).map((product, index) => (
          <div className={index === 1 ? "pb-4" : "pb-10"} key={product?.id ?? `hero-product-${String(index)}`}>
            {product ? (
              <ProductVisual product={product} theme={theme} tenantName={tenantName} hero={index === 1} />
            ) : (
              <ProductPlaceholderVisual index={index} theme={theme} tenantName={tenantName} hero={index === 1} />
            )}
          </div>
        ))}
      </div>
      <div className={`mt-5 rounded-[24px] border px-5 py-4 ${theme.heroShelf}`}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-slate-950">Curated for online orders</div>
            <div className="mt-1 text-xs leading-5 text-slate-500">The storefront stays rooted in the live BizBil catalog while presenting products more cleanly.</div>
          </div>
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--store-accent)]/10 text-[var(--store-accent)]">
            <Sparkles className="h-5 w-5" />
          </div>
        </div>
      </div>
    </div>
  );
}

function HeroBannerShowcase({
  imageUrl,
  secondaryImageUrl,
  theme,
  tenantName,
}: Readonly<{ imageUrl: string; secondaryImageUrl: string | null; theme: StoreTheme; tenantName: string }>) {
  return (
    <div className={`relative hidden overflow-hidden rounded-[32px] border shadow-[0_28px_100px_-50px_rgba(15,23,42,0.5)] md:block ${theme.heroShowcase}`}>
      <img className="absolute inset-0 h-full w-full object-cover" src={imageUrl} alt={`${tenantName} ecommerce banner`} />
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/75 via-slate-950/18 to-transparent" />
      <div className="relative flex min-h-[390px] flex-col justify-between p-6">
        <div className="self-end rounded-full border border-white/30 bg-white/12 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/90 backdrop-blur">
          Online storefront
        </div>
        <div className="grid gap-4">
          <div>
            <div className="text-2xl font-semibold tracking-tight text-white">Built for local retail that wants to look polished online.</div>
            <div className="mt-2 max-w-sm text-sm leading-6 text-white/78">Hero-led merchandising, cleaner browsing, and checkout that still maps back to BizBil operations.</div>
          </div>
          {secondaryImageUrl ? (
            <div className="grid grid-cols-[1.15fr_0.85fr] gap-3">
              <div className="rounded-[24px] border border-white/15 bg-white/10 p-4 backdrop-blur">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">What customers feel</div>
                <div className="mt-2 text-base font-semibold text-white">A calmer storefront with stronger hierarchy and faster scanability.</div>
              </div>
              <div className="overflow-hidden rounded-[24px] border border-white/15">
                <img className="h-full w-full object-cover" src={secondaryImageUrl} alt={`${tenantName} secondary ecommerce banner`} />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CategorySpotlightCard({
  active,
  count,
  product,
  theme,
  title,
  onClick,
}: Readonly<{
  active: boolean;
  count: number;
  product: StorefrontProduct | null;
  theme: StoreTheme;
  title: string;
  onClick: () => void;
}>) {
  return (
    <button
      className={`group overflow-hidden rounded-[26px] border p-4 text-left transition duration-300 hover:-translate-y-1 hover:shadow-[0_16px_60px_-32px_rgba(15,23,42,0.35)] ${active ? "border-[var(--store-primary)] bg-[rgba(35,66,57,0.04)]" : "border-white/70 bg-white/82"}`}
      type="button"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold tracking-tight text-slate-950">{title}</div>
          <div className="mt-1 text-sm text-slate-500">{count} live product{count === 1 ? "" : "s"}</div>
        </div>
        <div className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${active ? "bg-[var(--store-primary)] text-white" : "bg-slate-100 text-slate-600"}`}>
          Browse
        </div>
      </div>
      <div className="mt-4 overflow-hidden rounded-[22px]">
        {product ? (
          <ProductVisual product={product} theme={theme} tenantName={title} />
        ) : (
          <div className="aspect-[1.2] bg-slate-100" />
        )}
      </div>
      <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[var(--store-primary)]">
        Explore category
        <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
      </div>
    </button>
  );
}

function OfferPanel({
  product,
  theme,
  tenantName,
  onBrowse,
}: Readonly<{
  product: StorefrontProduct | null;
  theme: StoreTheme;
  tenantName: string;
  onBrowse: () => void;
}>) {
  return (
    <section className="relative overflow-hidden rounded-[32px] border border-[rgba(35,66,57,0.16)] bg-[linear-gradient(135deg,#fff8ee_0%,#ffffff_42%,#f3faf5_100%)] p-6 shadow-[0_26px_80px_-45px_rgba(15,23,42,0.32)]">
      <div className="absolute right-0 top-0 h-44 w-44 rounded-full bg-[rgba(255,157,91,0.18)] blur-3xl" />
      <div className="absolute bottom-0 left-0 h-40 w-40 rounded-full bg-[rgba(35,66,57,0.12)] blur-3xl" />
      <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(35,66,57,0.12)] bg-white/88 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600">
            <Star className="h-3.5 w-3.5 text-[var(--store-accent)]" />
            Storefront highlight
          </div>
          <h3 className="mt-5 max-w-[12ch] text-[2.4rem] font-semibold leading-[0.96] tracking-tight text-slate-950">A cleaner way to merchandise the catalog online.</h3>
          <p className="mt-4 max-w-lg text-sm leading-7 text-slate-600">Use the hero for branding, the category cards for wayfinding, and the catalog grid for fast comparison. The customer gets a calmer storefront without losing any real product detail.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button className="inline-flex h-11 items-center justify-center rounded-full bg-[var(--store-primary)] px-5 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5" type="button" onClick={onBrowse}>
              Browse products
            </button>
            <div className="inline-flex h-11 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600">
              {product ? `${String(discountPercent(product))}% off on selected lines` : "Live offers and pricing"}
            </div>
          </div>
        </div>
        <div className="relative">
          {product ? (
            <ProductVisual product={product} theme={theme} tenantName={tenantName} hero />
          ) : (
            <HeroProductShowcase products={[]} theme={theme} tenantName={tenantName} />
          )}
        </div>
      </div>
    </section>
  );
}

function MerchandisingPanel({
  products,
  theme,
  title,
  subtitle,
  onProductClick,
}: Readonly<{
  products: StorefrontProduct[];
  theme: StoreTheme;
  title: string;
  subtitle: string;
  onProductClick: (product: StorefrontProduct) => void;
}>) {
  return (
    <section className="rounded-[32px] border border-white/70 bg-white/82 p-6 shadow-[0_18px_70px_-42px_rgba(15,23,42,0.28)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xl font-semibold tracking-tight text-slate-950">{title}</div>
          <div className="mt-1 text-sm leading-6 text-slate-500">{subtitle}</div>
        </div>
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[rgba(255,140,86,0.10)] text-[var(--store-accent)]">
          <Sparkles className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-5 space-y-3">
        {products.map((product) => (
          <button className="flex w-full items-center gap-3 rounded-[22px] border border-slate-200/80 bg-white p-3 text-left transition hover:border-slate-300 hover:shadow-sm" key={product.id} type="button" onClick={() => onProductClick(product)}>
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-[18px]">
              <ProductVisual product={product} theme={theme} tenantName={product.categoryName} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-slate-950">{product.name}</div>
              <div className="mt-1 text-xs text-slate-500">{product.categoryName}</div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-950">{money(product.sellingPrice)}</span>
                {discountPercent(product) > 0 ? <span className="text-xs font-semibold text-[var(--store-accent)]">{discountPercent(product)}% off</span> : null}
              </div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          </button>
        ))}
      </div>
    </section>
  );
}

function CategoryChip({
  active,
  label,
  theme,
  onClick,
}: Readonly<{
  active: boolean;
  label: string;
  theme: StoreTheme;
  onClick: () => void;
}>) {
  return (
    <button
      className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition ${
        active ? `border-[var(--store-primary)] ${theme.primaryBg} text-white` : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-950"
      }`}
      type="button"
      onClick={onClick}
    >
      {label}
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
}: Readonly<{
  authMode: AuthMode;
  authForm: AuthFormState;
  authLoading: boolean;
  authError: string;
  theme: StoreTheme;
  onModeChange: (mode: AuthMode) => void;
  onFieldChange: (field: keyof AuthFormState, value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}>) {
  return (
    <form className={`rounded-[28px] border p-5 ${theme.panel}`} onSubmit={onSubmit}>
      <div className="mb-4 grid grid-cols-2 gap-2">
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
      {authError ? <div className="mt-4 text-sm font-semibold text-red-600">{authError}</div> : null}
      <button className={`mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold text-white ${theme.primaryBg}`} disabled={authLoading} type="submit">
        {authLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
        {authMode === "login" ? "Sign in" : "Create account"}
      </button>
    </form>
  );
}

function OrderHistory({ orders, loading, theme }: Readonly<{ orders: StorefrontOrder[]; loading: boolean; theme: StoreTheme }>) {
  return (
    <section className={`rounded-[28px] border ${theme.panel}`}>
      {loading ? (
        <div className="p-5 text-sm text-slate-500">Loading orders...</div>
      ) : orders.length === 0 ? (
        <div className="p-5 text-sm text-slate-500">No online orders yet.</div>
      ) : (
        <div className="divide-y divide-slate-200/80">
          {orders.map((order) => (
            <div className="grid gap-2 p-5 md:grid-cols-[1fr_auto]" key={order.invoiceId}>
              <div>
                <div className="text-sm font-semibold text-slate-950">{order.orderNumber}</div>
                <div className="mt-1 text-sm text-slate-500">{order.items.length} item{order.items.length === 1 ? "" : "s"} | {order.status}</div>
                <div className="mt-1 text-xs text-slate-400">{order.deliveryAddress}</div>
              </div>
              <div className="text-sm font-semibold text-slate-950">{money(order.grandTotal)}</div>
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
  rank,
  theme,
  tenantName,
  viewMode,
  wishlisted,
  onAdd,
  onDecrement,
  onQuickView,
  onWishlist,
}: Readonly<{
  product: StorefrontProduct;
  quantity: number;
  rank: number;
  theme: StoreTheme;
  tenantName: string;
  viewMode: CatalogView;
  wishlisted: boolean;
  onAdd: () => void;
  onDecrement: () => void;
  onQuickView: () => void;
  onWishlist: () => void;
}>) {
  const saving = product.mrp > product.sellingPrice ? product.mrp - product.sellingPrice : 0;
  const discount = discountPercent(product);

  return (
    <article className={`group min-w-0 overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-[0_12px_40px_-28px_rgba(15,23,42,0.35)] transition duration-300 hover:-translate-y-1 hover:border-slate-300 hover:shadow-[0_24px_70px_-32px_rgba(15,23,42,0.38)] ${theme.panel} ${viewMode === "list" ? "md:grid md:grid-cols-[220px_minmax(0,1fr)]" : ""}`}>
      <div className="relative">
        <button className="block w-full text-left" type="button" onClick={onQuickView}>
          <ProductVisual product={product} theme={theme} tenantName={tenantName} />
        </button>
        <div className="pointer-events-none absolute left-4 top-4 inline-flex items-center gap-2 rounded-full bg-white/92 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600 shadow-sm">
          #{rank}
          {discount > 0 ? <span className="text-[var(--store-accent)]">{discount}% off</span> : null}
        </div>
        <button
          className={`absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full border border-white/80 bg-white/92 shadow-sm transition ${wishlisted ? "text-rose-500" : "text-slate-500 hover:text-rose-500"}`}
          type="button"
          onClick={onWishlist}
          aria-label={wishlisted ? `Remove ${product.name} from wishlist` : `Add ${product.name} to wishlist`}
        >
          <Heart className={`h-4 w-4 ${wishlisted ? "fill-current" : ""}`} />
        </button>
      </div>
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className={`truncate text-[11px] font-semibold uppercase tracking-[0.16em] ${theme.accentText}`}>{product.categoryName}</div>
            <h3 className="mt-2 line-clamp-2 min-h-[48px] text-base font-semibold leading-snug text-slate-950">{product.name}</h3>
          </div>
          <div className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${theme.stockBadge}`}>
            {product.grouped && product.variantCount > 1 ? `${String(product.variantCount)} options` : `${String(product.currentStock)} left`}
          </div>
        </div>
        <div className={`mt-2 text-xs ${theme.muted}`}>
          {product.brand ? `${product.brand} | ` : ""}{product.sku ? `SKU ${product.sku} | ` : ""}{product.unit}
        </div>
        {product.grouped && product.variantLabels.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {product.variantLabels.slice(0, 4).map((label) => (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600" key={label}>{label}</span>
            ))}
          </div>
        ) : product.size || product.color ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {product.size ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{product.size}</span> : null}
            {product.color ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{product.color}</span> : null}
          </div>
        ) : null}
        <div className="mt-5 grid gap-3">
          {quantity > 0 ? (
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <div className="whitespace-nowrap text-2xl font-semibold leading-none tracking-tight">{money(product.sellingPrice)}</div>
                <div className={`mt-1 truncate text-xs ${theme.muted}`}>
                  {saving > 0 ? <span>MRP {money(product.mrp)} | Save {money(saving)}</span> : <span>Live stock</span>}
                </div>
              </div>
              <QuantityControl quantity={quantity} theme={theme} onDecrease={onDecrement} onIncrease={onAdd} label={product.name} compact />
            </div>
          ) : (
            <>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="whitespace-nowrap text-2xl font-semibold leading-none tracking-tight">{money(product.sellingPrice)}</div>
                  <div className={`mt-1 truncate text-xs ${theme.muted}`}>
                    {saving > 0 ? <span>MRP {money(product.mrp)} | Save {money(saving)}</span> : <span>{product.unit}</span>}
                  </div>
                </div>
                {discount > 0 ? (
                  <div className="rounded-full bg-[rgba(255,140,86,0.10)] px-2.5 py-1 text-xs font-semibold text-[var(--store-accent)]">
                    {discount}% off
                  </div>
                ) : null}
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <button className={`inline-flex h-11 items-center justify-center rounded-full border px-3 text-sm font-semibold ${theme.outline}`} type="button" onClick={onQuickView}>
                  {product.grouped ? "Choose variant" : "View details"}
                </button>
                {product.grouped && product.variantCount > 1 ? (
                  <button className={`inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold text-white ${theme.productButton}`} type="button" onClick={onQuickView}>
                    Choose
                  </button>
                ) : (
                  <button className={`inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${theme.productButton}`} type="button" disabled={product.currentStock <= 0} onClick={onAdd}>
                    <Plus className="h-4 w-4" />
                    Add
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function CompactProductRow({
  product,
  theme,
  tenantName,
  onClick,
}: Readonly<{
  product: StorefrontProduct;
  theme: StoreTheme;
  tenantName: string;
  onClick: () => void;
}>) {
  return (
    <button className="flex items-center gap-3 rounded-[22px] border border-slate-200 bg-white p-3 text-left transition hover:border-slate-300 hover:shadow-sm" type="button" onClick={onClick}>
      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-[18px]">
        <ProductVisual product={product} theme={theme} tenantName={tenantName} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-slate-950">{product.name}</div>
        <div className="mt-1 text-xs text-slate-500">{product.categoryName}</div>
        <div className="mt-2 text-sm font-semibold text-slate-950">{money(product.sellingPrice)}</div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
    </button>
  );
}

function ProductQuickView({
  product,
  detail,
  relatedProducts,
  frequentlyBoughtTogether,
  loading,
  theme,
  tenantName,
  cart,
  productsById,
  onAddProduct,
  onDecrementProduct,
  onSelectProduct,
  onWishlist,
  onShare,
  wishlisted,
}: Readonly<{
  product: StorefrontProduct;
  detail: StorefrontProductDetail | null;
  relatedProducts: StorefrontProduct[];
  frequentlyBoughtTogether: StorefrontProduct[];
  loading: boolean;
  theme: StoreTheme;
  tenantName: string;
  cart: Record<string, number>;
  productsById: Record<string, StorefrontProduct>;
  onAddProduct: (product: StorefrontProduct) => void;
  onDecrementProduct: (productId: string) => void;
  onSelectProduct: (product: StorefrontProduct) => void;
  onWishlist: () => void;
  onShare: () => void;
  wishlisted: boolean;
}>) {
  const specifications = detail?.specifications ?? [];
  const variants = detail?.variants ?? [];
  const [selectedVariantProductId, setSelectedVariantProductId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedVariantProductId(detail?.variants[0]?.productId ?? null);
  }, [detail?.id, detail?.variants]);

  const activeVariant = variants.find((variant) => variant.productId === selectedVariantProductId) ?? variants[0] ?? null;
  const displayProduct = activeVariant ? productsById[activeVariant.productId] ?? product : product;
  const discount = discountPercent(displayProduct);
  const saving = displayProduct.mrp > displayProduct.sellingPrice ? displayProduct.mrp - displayProduct.sellingPrice : 0;
  const currentQuantity = cart[displayProduct.id] ?? 0;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(260px,360px)_minmax(0,1fr)]">
      <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-slate-50">
        <ProductVisual product={displayProduct} theme={theme} tenantName={tenantName} />
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">{displayProduct.categoryName}</span>
          {discount > 0 ? <span className="rounded-full bg-[rgba(255,140,86,0.10)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--store-accent)]">{discount}% off</span> : null}
          {displayProduct.brand ? <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600">{displayProduct.brand}</span> : null}
        </div>
        <h3 className="mt-4 text-[2rem] font-semibold leading-tight tracking-tight text-slate-950">{product.name}</h3>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="text-[2rem] font-semibold tracking-tight text-slate-950">{money(displayProduct.sellingPrice)}</div>
          {displayProduct.mrp > displayProduct.sellingPrice ? <div className="text-sm font-medium text-slate-400 line-through">{money(displayProduct.mrp)}</div> : null}
          {saving > 0 ? <div className="text-sm font-semibold text-[var(--store-accent)]">Save {money(saving)}</div> : null}
        </div>
        <div className="mt-4 grid gap-3 rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-600">
          <DetailRow label="Unit" value={displayProduct.unit} />
          <DetailRow label="Stock" value={`${String(displayProduct.currentStock)} available`} />
          <DetailRow label="SKU" value={displayProduct.sku ?? "Not specified"} />
          <DetailRow label="Barcode" value={displayProduct.barcode ?? "Not specified"} />
          <DetailRow label="HSN" value={displayProduct.hsnCode ?? "Not specified"} />
          <DetailRow label="GST" value={`${String(displayProduct.gstRate)}%`} />
        </div>
        <div className="mt-5 text-sm leading-7 text-slate-600">
          {product.description?.trim() || "This product is available in the online catalog with live pricing, tax details, and stock-aware checkout."}
        </div>
        {loading ? (
          <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading product details
          </div>
        ) : null}
        {variants.length > 0 ? (
          <div className="mt-5">
            <div className="text-sm font-semibold text-slate-950">{product.variantAttributeLabel ?? "Available variants"}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {variants.map((variant) => (
                <button
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${activeVariant?.productId === variant.productId ? "border-[var(--store-primary)] bg-[rgba(35,66,57,0.08)] text-[var(--store-primary)]" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"}`}
                  key={variant.id}
                  type="button"
                  onClick={() => setSelectedVariantProductId(variant.productId)}
                >
                  {variant.label} - {money(variant.sellingPrice)}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {specifications.length > 0 ? (
          <div className="mt-5 grid gap-3 rounded-[24px] border border-slate-200 bg-white p-4">
            <div className="text-sm font-semibold text-slate-950">Specifications</div>
            <div className="grid gap-3 sm:grid-cols-2">
              {specifications.map((item) => (
                <DetailRow key={`${item.label}-${item.value}`} label={item.label} value={item.value} />
              ))}
            </div>
          </div>
        ) : null}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {currentQuantity > 0 ? (
            <QuantityControl
              quantity={currentQuantity}
              theme={theme}
              onDecrease={() => onDecrementProduct(displayProduct.id)}
              onIncrease={() => onAddProduct(displayProduct)}
              label={displayProduct.name}
            />
          ) : null}
          <button className={`inline-flex h-12 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold text-white ${theme.productButton}`} type="button" onClick={() => onAddProduct(displayProduct)}>
            <Plus className="h-4 w-4" />
            {currentQuantity > 0 ? "Add one more" : "Add to cart"}
          </button>
          <button className={`inline-flex h-12 items-center justify-center gap-2 rounded-full border px-5 text-sm font-semibold ${theme.outline}`} type="button" onClick={onWishlist}>
            <Heart className={`h-4 w-4 ${wishlisted ? "fill-current text-rose-500" : ""}`} />
            Wishlist
          </button>
          <button className={`inline-flex h-12 items-center justify-center gap-2 rounded-full border px-5 text-sm font-semibold ${theme.outline}`} type="button" onClick={onShare}>
            <Share2 className="h-4 w-4" />
            Share
          </button>
        </div>
        <div className="mt-6 grid gap-3 rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-600">
          <DetailRow label="Delivery estimate" value="Estimate shown at checkout" />
          <DetailRow label="Return policy" value="Standard store policy applies" />
        </div>
        {relatedProducts.length > 0 ? (
          <div className="mt-6">
            <div className="text-sm font-semibold text-slate-950">Related products</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {relatedProducts.map((item) => (
                <CompactProductRow key={item.id} product={item} theme={theme} tenantName={tenantName} onClick={() => onSelectProduct(item)} />
              ))}
            </div>
          </div>
        ) : null}
        {frequentlyBoughtTogether.length > 0 ? (
          <div className="mt-6">
            <div className="text-sm font-semibold text-slate-950">Frequently bought together</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {frequentlyBoughtTogether.map((item) => (
                <CompactProductRow key={item.id} product={item} theme={theme} tenantName={tenantName} onClick={() => onSelectProduct(item)} />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-semibold text-slate-900">{value}</span>
    </div>
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
      <div className={`${hero ? "h-[260px]" : "aspect-[1.02]"} overflow-hidden ${theme.imageBg}`}>
        <img alt={product.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" src={imageUrl} />
      </div>
    );
  }

  return (
    <div className={`relative grid ${hero ? "h-[260px]" : "aspect-[1.02]"} place-items-center overflow-hidden ${theme.productStage}`} style={style}>
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
    barcode: null,
    description: null,
    categoryId: null,
    categoryName: "Cooking Oils",
    categoryParentId: null,
    unit: index === 1 ? "5 L" : "1 L",
    mrp: 0,
    sellingPrice: 0,
    defaultDiscountPercent: null,
    discountPercent: 0,
    gstRate: 0,
    hsnCode: null,
    currentStock: 1,
    imageUrl: null,
    brand: tenantName,
    size: index === 1 ? "5 L" : "1 L",
    color: null,
    hasVariants: false,
    grouped: false,
    groupId: null,
    groupName: null,
    variantAttributeLabel: null,
    variantCount: 0,
    variantLabels: [],
    defaultVariantLabel: null,
  } satisfies StorefrontProduct;

  return <ProductVisual product={product} theme={theme} tenantName={tenantName} hero={hero} />;
}

function ProductPack({ product, tenantName, hero }: Readonly<{ product: StorefrontProduct; tenantName: string; hero: boolean }>) {
  const kind = productPackageKind(product);
  const sizeClass = hero ? "h-52 w-36" : "h-40 w-28 sm:h-44 sm:w-32";
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
    <div className={`mt-3 flex h-11 shrink-0 items-center rounded-full border ${theme.quantity} ${compact ? "mt-0" : ""}`}>
      <button className="grid h-11 w-11 place-items-center text-[var(--store-primary)]" type="button" onClick={onDecrease} aria-label={`Decrease ${label}`}>
        <Minus className="h-4 w-4" />
      </button>
      <div className="grid h-11 w-10 place-items-center text-sm font-semibold text-slate-950">{quantity}</div>
      <button className="grid h-11 w-11 place-items-center text-[var(--store-primary)]" type="button" onClick={onIncrease} aria-label={`Increase ${label}`}>
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function StoreLogo({ tenantName, logoUrl }: Readonly<{ tenantName: string; logoUrl: string | null | undefined }>) {
  if (logoUrl) {
    return (
      <div className="grid h-12 w-12 place-items-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <img alt={tenantName} className="h-full w-full object-contain" src={logoUrl} />
      </div>
    );
  }

  return <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--store-primary)] text-sm font-semibold text-white shadow-sm">{initials(tenantName)}</div>;
}

function ErrorBanner({ message, onClose, theme }: Readonly<{ message: string; onClose: () => void; theme: StoreTheme }>) {
  return (
    <div className={`mt-5 flex items-start justify-between gap-3 rounded-[22px] border border-red-200 p-4 text-sm font-medium text-red-700 ${theme.errorBg}`}>
      <span>{message}</span>
      <button className="grid h-6 w-6 place-items-center rounded-full hover:bg-white" type="button" onClick={onClose} aria-label="Dismiss error">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function MoneyRow({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span className={value < 0 ? "font-semibold text-[var(--store-primary)]" : "font-medium text-slate-900"}>{money(value)}</span>
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
    <label className={`block text-[11px] font-semibold uppercase tracking-[0.16em] ${theme.muted}`}>
      {label}
      <input
        className={inputClass(theme, "mt-2 h-11 w-full border-white/70 bg-white/90 px-4 text-sm font-normal normal-case shadow-sm")}
        inputMode={inputMode}
        required={required}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  theme,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  theme: StoreTheme;
}>) {
  return (
    <label className={`block text-[11px] font-semibold uppercase tracking-[0.16em] ${theme.muted}`}>
      {label}
      <textarea
        className={inputClass(theme, "mt-2 min-h-[92px] w-full resize-none border-white/70 bg-white/90 px-4 py-3 text-sm font-normal normal-case shadow-sm")}
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
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-[18px] border px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
        active ? theme.activePayment : theme.inactivePayment
      }`}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {icon}
      <span className="text-center leading-tight">{label}</span>
    </button>
  );
}

function OrderComplete({ order, theme }: Readonly<{ order: StorefrontOrder; theme: StoreTheme }>) {
  return (
    <div className={`mt-4 rounded-[28px] border border-white/70 p-5 shadow-sm ${theme.panel}`}>
      <div className="flex items-start gap-3">
        <div className={`grid h-11 w-11 place-items-center rounded-2xl ${theme.softBg}`}>
          <CheckCircle2 className="h-5 w-5 text-[var(--store-primary)]" />
        </div>
        <div>
          <div className="text-base font-semibold text-slate-950">Order received</div>
          <div className={`mt-1 text-sm ${theme.muted}`}>{order.orderNumber} | {money(order.grandTotal)}</div>
        </div>
      </div>
      <div className={`mt-4 flex items-start gap-2 rounded-[20px] p-4 text-sm ${theme.summary}`}>
        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--store-primary)]" />
        <span>{order.deliveryAddress}</span>
      </div>
    </div>
  );
}

function ProductSkeleton({ theme }: Readonly<{ theme: StoreTheme }>) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <div className={`overflow-hidden rounded-[28px] border ${theme.panel}`} key={index}>
          <div className={`aspect-[1.02] animate-pulse ${theme.skeleton}`} />
          <div className="space-y-3 p-5">
            <div className={`h-4 w-24 animate-pulse rounded-full ${theme.skeleton}`} />
            <div className={`h-5 w-4/5 animate-pulse rounded ${theme.skeleton}`} />
            <div className={`h-11 animate-pulse rounded-full ${theme.skeleton}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SideSheet({
  title,
  subtitle,
  wide = false,
  children,
  onClose,
}: Readonly<{
  title: string;
  subtitle: string;
  wide?: boolean;
  children: React.ReactNode;
  onClose: () => void;
}>) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-sm">
      <div className={`ml-auto flex h-full w-full ${wide ? "max-w-[880px]" : "max-w-[540px]"} flex-col bg-[#fcfcfb] shadow-2xl`}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-5">
          <div>
            <div className="text-xl font-semibold tracking-tight text-slate-950">{title}</div>
            <div className="mt-1 text-sm text-slate-500">{subtitle}</div>
          </div>
          <button className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-950" type="button" onClick={onClose} aria-label="Close panel">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {children}
        </div>
      </div>
    </div>
  );
}

function FloatingCartButton({
  cartCount,
  total,
  onClick,
}: Readonly<{
  cartCount: number;
  total: number;
  onClick: () => void;
}>) {
  if (cartCount <= 0) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 bottom-4 z-40 px-4 lg:hidden">
      <button className="mx-auto flex h-14 w-full max-w-md items-center justify-between rounded-full bg-[var(--store-primary)] px-5 text-sm font-semibold text-white shadow-[0_24px_60px_-26px_rgba(15,23,42,0.55)]" type="button" onClick={onClick}>
        <span className="flex items-center gap-3">
          <ShoppingBag className="h-5 w-5" />
          {cartCount} item{cartCount === 1 ? "" : "s"}
        </span>
        <span>{money(total)}</span>
      </button>
    </div>
  );
}

function CountBadge({ count, inset = false }: Readonly<{ count: number; inset?: boolean }>) {
  return (
    <span className={`absolute grid min-h-5 min-w-5 place-items-center rounded-full bg-[#ff5d4a] px-1 text-[11px] font-bold text-white ${inset ? "-right-1 -top-1" : "-right-1 -top-1"}`}>
      {count}
    </span>
  );
}

interface StoreTheme {
  page: string;
  ink: string;
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
}

function themeFor(storefront: StorefrontBootstrap["storefront"] | undefined): StoreTheme {
  if (storefront?.theme === "PREMIUM_BRAND") {
    return {
      page: "bg-[#f5f3ef]",
      ink: "text-slate-950",
      header: "border-slate-800/80 bg-slate-950/96 text-white shadow-sm shadow-slate-950/10",
      topBar: "border-amber-400/20 bg-slate-900 text-amber-100",
      panel: "bg-white",
      panelDivider: "border-slate-200",
      heroMuted: "text-slate-600",
      heroButton: "border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50",
      heroShowcase: "border-slate-200 bg-white",
      heroShelf: "border-slate-200 bg-white",
      muted: "text-slate-500",
      iconMuted: "text-slate-400",
      primary: "#1e293b",
      accent: "#d97706",
      primaryBg: "bg-slate-950",
      accentBg: "bg-[var(--store-accent)]",
      ctaBg: "bg-amber-500 text-slate-950 hover:bg-amber-400",
      cartButton: "bg-amber-500 text-slate-950 hover:bg-amber-400",
      productButton: "bg-slate-950 text-white hover:bg-slate-800",
      accentText: "text-[var(--store-accent)]",
      softBg: "bg-amber-50 text-amber-700",
      outline: "border-slate-200 bg-white text-slate-700",
      outlineActive: "border-slate-950 bg-slate-100 text-slate-950",
      summary: "border-slate-200 bg-slate-50 text-slate-700",
      line: "border-slate-100 bg-white",
      empty: "border-slate-300 bg-slate-50 text-slate-500",
      imageBg: "bg-slate-100",
      productStage: "bg-white",
      stockBadge: "bg-amber-50 text-amber-700",
      progressTrack: "bg-slate-100",
      quantity: "border-slate-950 bg-white",
      activePayment: "border-slate-950 bg-slate-100 text-slate-950",
      inactivePayment: "border-slate-200 bg-white text-slate-600",
      errorBg: "bg-red-50",
      skeleton: "bg-slate-200",
    };
  }

  return {
    page: "bg-[#f6f4ef]",
    ink: "text-slate-950",
    header: "border-white/70 bg-[#f8f6f1]/90 shadow-sm shadow-slate-200/50",
    topBar: "border-emerald-100 bg-emerald-50 text-emerald-800",
    panel: "bg-white",
    panelDivider: "border-slate-200",
    heroMuted: "text-slate-600",
    heroButton: "border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50",
    heroShowcase: "border-white/70 bg-white/88",
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
    outline: "border-slate-200 bg-white text-slate-700",
    outlineActive: "border-[var(--store-primary)] bg-[rgba(35,66,57,0.08)] text-[var(--store-primary)]",
    summary: "border-slate-200 bg-slate-50 text-slate-700",
    line: "border-slate-100 bg-white",
    empty: "border-slate-300 bg-slate-50 text-slate-500",
    imageBg: "bg-[#eef3ef]",
    productStage: "bg-[linear-gradient(180deg,#f3faf5_0%,#eaf5ee_100%)]",
    stockBadge: "bg-[rgba(35,66,57,0.08)] text-[var(--store-primary)]",
    progressTrack: "bg-slate-100",
    quantity: "border-[var(--store-primary)] bg-white",
    activePayment: "border-[var(--store-primary)] bg-[rgba(35,66,57,0.08)] text-[var(--store-primary)]",
    inactivePayment: "border-slate-200 bg-white text-slate-600",
    errorBg: "bg-red-50",
    skeleton: "bg-slate-200",
  };
}

function discountPercent(product: StorefrontProduct): number {
  if (product.mrp <= product.sellingPrice || product.mrp <= 0) {
    return 0;
  }

  return Math.round(((product.mrp - product.sellingPrice) / product.mrp) * 100);
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
  return `inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold ${theme.outline}`;
}

function iconButtonClass(theme: StoreTheme): string {
  return `grid h-11 w-11 place-items-center rounded-full border ${theme.outline}`;
}

function inputClass(theme: StoreTheme, extra: string): string {
  return `${extra} rounded-2xl border ${theme.outline} text-sm outline-none transition focus:border-[var(--store-primary)] focus:bg-white`;
}

function modeButtonClass(active: boolean, theme: StoreTheme): string {
  return `h-10 rounded-full border text-sm font-semibold ${active ? `border-[var(--store-primary)] ${theme.primaryBg} text-white` : theme.outline}`;
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

function recentlyViewedKey(tenantSlug: string): string {
  return `bizbil:storefront:recent:${tenantSlug}`;
}

function recentSearchesKey(tenantSlug: string): string {
  return `bizbil:storefront:search:${tenantSlug}`;
}

function wishlistKey(tenantSlug: string): string {
  return `bizbil:storefront:wishlist:${tenantSlug}`;
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
