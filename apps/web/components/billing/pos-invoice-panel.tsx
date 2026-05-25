"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookMarked, ClipboardPaste, Download, MessageCircle, Pause, Printer, Receipt, RefreshCcw, Search, Trash2, Truck, UserPlus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { apiUrl, createAuthenticatedApiClient, downloadApiFile, listProducts, lookupProductByCode, refreshAuthSession } from "@/lib/api-client";
import type { ProductRecord } from "@/lib/api-client";
import type { InvoiceRecord } from "@/components/billing/invoice-history";
import { useBillingStore } from "@/lib/billing-store";
import { printViaLocalAgent } from "@/lib/local-print-agent";
import { getPendingInvoiceCounts, queueInvoice, syncPendingInvoices } from "@/lib/offline-queue";
import { getStoredTenant, hasStoredAuthSession, storeAuthSession } from "@/lib/vertical-config";
import { fetchWhatsappMessageTemplates, formatInvoiceWhatsappMessage, getWhatsappTemplateBody, openWhatsappMessage } from "@/lib/whatsapp";

const PAYMENT_MODES = ["CASH", "UPI", "CARD", "CREDIT", "NETBANKING"] as const;
const PRODUCT_SEARCH_MODES = [
  { value: "AUTO", label: "Auto" },
  { value: "NAME", label: "Product name" },
  { value: "BARCODE", label: "Barcode" },
  { value: "SKU", label: "SKU" },
] as const;
const BILLING_SEARCH_RESULT_LIMIT = 100;
type PaymentMode = (typeof PAYMENT_MODES)[number];
type ProductSearchMode = (typeof PRODUCT_SEARCH_MODES)[number]["value"];
type PrinterConnectionType = "NONE" | "NETWORK" | "USB_PRINTNODE" | "BLUETOOTH" | "LOCAL_AGENT";
type InvoiceLineRecord = NonNullable<InvoiceRecord["items"]>[number];
type StatusTone = "green" | "amber" | "red";

interface SplitEntry {
  mode: PaymentMode;
  paymentMethodId?: string | undefined;
  amount: number;
  referenceNumber?: string | undefined;
}

type DecimalValue = string | number | null | undefined;

interface CustomerApiRecord {
  id: string;
  name: string;
  phone: string;
  address?: string | null;
  creditLimit?: DecimalValue;
  outstandingDue?: DecimalValue;
}

interface CustomerRecord {
  id: string;
  name: string;
  phone: string;
  address: string | null;
  creditLimit?: number | null;
  outstandingDue?: number | null;
}

interface PrinterConfig {
  connectionType: PrinterConnectionType;
  isActive: boolean;
  localPrinterName?: string | null;
  localAgentUrl?: string | null;
}

interface PrinterResponse {
  printer: PrinterConfig | null;
}

interface PrinterResult {
  status: string;
  message: string;
  bytesBase64?: string;
  printerName?: string | null;
  agentUrl?: string | null;
}

interface StockWarning {
  productId: string;
  productName: string;
  available: number;
  requested: number;
  shortage: number;
}

interface InvoiceMutationResult {
  id: string;
  invoiceNumber: string;
  grandTotal: string | number;
  stockWarnings?: StockWarning[];
}

interface LastBill {
  id: string;
  invoiceNumber: string;
  grandTotal: number;
  subtotal: number;
  lineDiscount: number;
  billLevelDiscount: number;
  deliveryCharge: number;
  cgst: number;
  sgst: number;
  paymentMode: PaymentMode;
  customer: CustomerRecord | null;
  lines: Array<{
    productName: string;
    quantity: number;
    sellingPrice: number;
    discount: number;
    gstRate: number;
    total: number;
  }>;
  pdfViewUrl: string;
}

interface PaymentMethodRecord {
  id: string;
  name: string;
  short_code: string;
  type: "cash" | "upi" | "card" | "credit" | "custom";
  color: string;
  icon: string;
  keyboard_shortcut: string | null;
  display_order: number;
  requires_reference: boolean;
  reference_label: string | null;
  allows_split: boolean;
  upi_id: string | null;
  upi_qr_data: string | null;
  allowed_roles: string[];
}

interface PosInvoicePanelProps {
  editingInvoice?: InvoiceRecord | null;
  onEditComplete?: () => void;
  onDraftReady?: (invoice: InvoiceRecord) => void;
}

interface PasteWhatsappOrderResponse {
  status: string;
  orderId?: string;
  messageId?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  unmatchedLines?: Array<{
    line: string;
    reason: string;
  }>;
}

export function PosInvoicePanel({ editingInvoice = null, onEditComplete, onDraftReady }: PosInvoicePanelProps) {
  const queryClient = useQueryClient();
  const { lines, setLines, setLine, addLine, removeLine, reset, holdBill, restoreHeld, deleteHeld, heldBills } = useBillingStore();
  const barcodeRef = useRef<HTMLInputElement>(null);
  const isEditMode = Boolean(editingInvoice);
  const [online, setOnline] = useState(true);
  const [gstEnabled, setGstEnabled] = useState(true);
  const [queueCounts, setQueueCounts] = useState({ pending: 0, syncing: 0, failed: 0 });
  const [status, setStatus] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<StatusTone>("green");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerHighlightIndex, setCustomerHighlightIndex] = useState(0);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRecord | null>(null);
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [newCustomerAddress, setNewCustomerAddress] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [productSearchMode, setProductSearchMode] = useState<ProductSearchMode>("AUTO");
  const [productHighlightIndex, setProductHighlightIndex] = useState(0);
  const [billDiscount, setBillDiscount] = useState(0);
  const [splitEntries, setSplitEntries] = useState<SplitEntry[]>([{ mode: "CASH", amount: 0 }]);
  const [useSplit, setUseSplit] = useState(false);
  const [selectedPaymentMode, setSelectedPaymentMode] = useState<PaymentMode>("CASH");
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState<string | null>(null);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [amountReceived, setAmountReceived] = useState(0);
  const [appliedCoupon, setAppliedCoupon] = useState("");
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponInput, setCouponInput] = useState("");
  const [loyaltyRedeem, setLoyaltyRedeem] = useState(0);
  const [loyaltyBalance, setLoyaltyBalance] = useState<number | null>(null);
  const [showHeld, setShowHeld] = useState(false);
  const [showPasteOrder, setShowPasteOrder] = useState(false);
  const [pasteOrderPhone, setPasteOrderPhone] = useState("");
  const [pasteOrderName, setPasteOrderName] = useState("");
  const [pasteOrderText, setPasteOrderText] = useState("");
  const [pasteOrderReviewLines, setPasteOrderReviewLines] = useState<Array<{ line: string; reason: string }>>([]);
  const [isPastingOrder, setIsPastingOrder] = useState(false);
  const [notes, setNotes] = useState("");
  const [deliveryRequired, setDeliveryRequired] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [deliveryCharge, setDeliveryCharge] = useState(0);
  const [scheduledDeliveryTime, setScheduledDeliveryTime] = useState("");
  const [lastBill, setLastBill] = useState<LastBill | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({});
  const [knownProducts, setKnownProducts] = useState<ProductRecord[]>([]);

  function focusBarcodeSoon() {
    window.setTimeout(() => barcodeRef.current?.focus(), 0);
  }

  const productSearch = buildProductSearchTerm(barcodeInput);
  const productExactQuery = useQuery({
    queryKey: ["products", "billing-lookup", productSearch.value],
    queryFn: () => lookupProductByCode(productSearch.value),
    enabled: Boolean(productSearch.value),
    staleTime: 15_000,
  });
  const productSearchQuery = useQuery({
    queryKey: ["products", "billing-search", productSearchMode, productSearch.value, productSearch.trailingSpace],
    queryFn: () => listProducts({ search: productSearch.value, limit: BILLING_SEARCH_RESULT_LIMIT }),
    enabled: Boolean(productSearch.value),
    staleTime: 15_000,
  });
  const customersQuery = useQuery({
    queryKey: ["customers", "billing", customerSearch],
    queryFn: () =>
      createAuthenticatedApiClient().get<{ data: CustomerApiRecord[] }>(
        `/customers?limit=${String(BILLING_SEARCH_RESULT_LIMIT)}${customerSearch ? `&search=${encodeURIComponent(customerSearch)}` : ""}`,
      ),
  });
  const printerQuery = useQuery({
    queryKey: ["printer", "billing"],
    queryFn: () => createAuthenticatedApiClient().get<PrinterResponse>("/printer"),
  });
  const whatsappTemplatesQuery = useQuery({
    queryKey: ["whatsapp-message-templates"],
    queryFn: fetchWhatsappMessageTemplates,
    staleTime: 60_000,
  });
  const paymentMethodsQuery = useQuery({
    queryKey: ["payment-methods", "pos"],
    queryFn: () => createAuthenticatedApiClient().get<PaymentMethodRecord[]>("/payment-methods"),
    staleTime: 0,
  });
  const products = knownProducts;
  const paymentMethods = useMemo(() => paymentMethodsQuery.data ?? [], [paymentMethodsQuery.data]);
  const selectedPaymentMethod = paymentMethods.find((method) => method.id === selectedPaymentMethodId) ?? paymentMethods[0] ?? null;
  const customerResults = useMemo(
    () => (customersQuery.data?.data ?? []).map(normalizeCustomer),
    [customersQuery.data?.data],
  );
  const visibleCustomerResults = customerSearch && !selectedCustomer ? customerResults : [];
  const productResults = useMemo(() => {
    if (!productSearch.value) return [];
    const exactProducts = productExactQuery.data ? [productExactQuery.data] : [];
    const searchProducts = (productSearchQuery.data?.data ?? [])
      .filter((product) => matchesProductSearch(product, productSearch, productSearchMode))
      .sort((left, right) => productMatchRank(left, productSearch) - productMatchRank(right, productSearch) || left.name.localeCompare(right.name));
    return mergeProducts(exactProducts, searchProducts);
  }, [productExactQuery.data, productSearch.value, productSearch.trailingSpace, productSearchMode, productSearchQuery.data?.data]);

  const totals = useMemo(() => {
    const itemTotals = lines.map((line) => {
      const gross = line.quantity * line.sellingPrice;
      const discountAmount = Math.min(gross, roundMoney(gross * (line.discount / 100)));
      const taxable = Math.max(gross - discountAmount, 0);
      return {
        gross,
        discountAmount,
        taxable,
        gstRate: line.gstRate,
      };
    });
    const subtotal = itemTotals.reduce((sum, item) => sum + item.gross, 0);
    const lineDiscount = itemTotals.reduce((sum, item) => sum + item.discountAmount, 0);
    const totalTaxable = itemTotals.reduce((sum, item) => sum + item.taxable, 0);
    const billLevelDiscount = roundMoney(Math.min(Math.max(billDiscount, 0) + couponDiscount + loyaltyRedeem, totalTaxable));
    const billDiscountShares = allocateBillDiscountShares(itemTotals.map((item) => item.taxable), billLevelDiscount);
    const taxTotals = itemTotals.reduce(
      (accumulator, item, index) => {
        const share = billDiscountShares[index] ?? 0;
        const taxableAfterBillDiscount = Math.max(item.taxable - share, 0);
        const gst = gstEnabled ? taxableAfterBillDiscount * (item.gstRate / 100) : 0;
        return {
          cgst: roundMoney(accumulator.cgst + gst / 2),
          sgst: roundMoney(accumulator.sgst + gst / 2),
          grandTotal: roundMoney(accumulator.grandTotal + taxableAfterBillDiscount + gst),
        };
      },
      { cgst: 0, sgst: 0, grandTotal: 0 },
    );
    const cgst = taxTotals.cgst;
    const sgst = taxTotals.sgst;
    const activeDeliveryCharge = selectedCustomer && deliveryRequired ? roundMoney(Math.max(deliveryCharge, 0)) : 0;
    const grandTotal = roundMoney(taxTotals.grandTotal + activeDeliveryCharge);
    const totalItems = lines.filter((line) => line.productId).length;
    const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);
    return {
      subtotal: roundMoney(subtotal),
      lineDiscount: roundMoney(lineDiscount),
      billLevelDiscount,
      discount: roundMoney(lineDiscount + billLevelDiscount),
      cgst,
      sgst,
      deliveryCharge: activeDeliveryCharge,
      grandTotal,
      totalItems,
      totalQuantity: roundQuantity(totalQuantity),
    };
  }, [lines, billDiscount, couponDiscount, loyaltyRedeem, gstEnabled, selectedCustomer, deliveryRequired, deliveryCharge]);
  const changeDue = selectedPaymentMethod?.type === "cash" && amountReceived > 0 ? amountReceived - totals.grandTotal : 0;

  useEffect(() => {
    setGstEnabled(getStoredTenant()?.gstEnabled ?? true);
    barcodeRef.current?.focus();
  }, []);

  useEffect(() => {
    if (paymentMethods.length === 0) return;
    const current = selectedPaymentMethodId ? paymentMethods.find((method) => method.id === selectedPaymentMethodId) : null;
    const next = current ?? paymentMethods[0];
    if (!next) return;
    setSelectedPaymentMethodId(next.id);
    setSelectedPaymentMode(paymentMethodToMode(next));
    setSplitEntries((current) => current.map((entry) => entry.paymentMethodId ? entry : { ...entry, paymentMethodId: next.id, mode: paymentMethodToMode(next) }));
  }, [paymentMethods, selectedPaymentMethodId]);

  useEffect(() => {
    if (!selectedCustomer) {
      setLoyaltyBalance(null);
      setDeliveryRequired(false);
      setDeliveryAddress("");
      setDeliveryCharge(0);
      setScheduledDeliveryTime("");
      return;
    }

    setDeliveryAddress((current) => current || (selectedCustomer.address ?? ""));
    createAuthenticatedApiClient()
      .get<{ points: number }>(`/loyalty/${selectedCustomer.id}`)
      .then((data) => setLoyaltyBalance(data.points))
      .catch(() => setLoyaltyBalance(null));
  }, [selectedCustomer]);

  useEffect(() => {
    if (!editingInvoice) return;

    const lineItems = editingInvoice.items ?? [];
    const billDiscountAmount = getVerticalNumber(editingInvoice.verticalData, "billDiscountAmount") ?? 0;
    const couponAmount = getVerticalNumber(editingInvoice.verticalData, "couponDiscount") ?? 0;
    const redeemedPoints = getVerticalNumber(editingInvoice.verticalData, "loyaltyRedeem") ?? 0;
    const savedDeliveryCharge = decimalToNumberOrNull(editingInvoice.deliveryCharge) ?? getVerticalNumber(editingInvoice.verticalData, "deliveryCharge") ?? 0;
    const couponCode = getVerticalString(editingInvoice.verticalData, "couponCode");
    const scheduledAt = editingInvoice.delivery?.scheduledAt ?? getVerticalString(editingInvoice.verticalData, "scheduledDeliveryTime");
    setQuantityDrafts({});
    setLines(lineItems.map((item) => ({
      id: item.id ?? crypto.randomUUID(),
      productId: item.productId,
      productName: item.productName,
      quantity: decimalToNumber(item.quantity),
      sellingPrice: decimalToNumber(item.sellingPrice),
      discount: deriveLineDiscountPercent(item, billDiscountAmount, lineItems),
      gstRate: gstEnabled ? decimalToNumber(item.gstRate) : 0,
    })));
    setSelectedCustomer(editingInvoice.customer
      ? {
          id: editingInvoice.customer.id,
          name: editingInvoice.customer.name,
          phone: editingInvoice.customer.phone ?? "",
          address: editingInvoice.customer.address ?? null,
          creditLimit: decimalToNumberOrNull(editingInvoice.customer.creditLimit),
          outstandingDue: decimalToNumberOrNull(editingInvoice.customer.outstandingDue),
        }
      : null);
    setCustomerSearch(editingInvoice.customer ? `${editingInvoice.customer.name} ${editingInvoice.customer.phone ?? ""}`.trim() : "");
    setShowNewCustomerForm(false);
    setBarcodeInput("");
    setProductHighlightIndex(0);
    setBillDiscount(billDiscountAmount);
    setCouponDiscount(couponAmount);
    setAppliedCoupon(couponCode ?? "");
    setCouponInput("");
    setLoyaltyRedeem(redeemedPoints);
    setNotes(editingInvoice.notes ?? "");
    setDeliveryRequired(Boolean(editingInvoice.delivery));
    setDeliveryAddress(editingInvoice.delivery?.deliveryAddress ?? editingInvoice.customer?.address ?? "");
    setDeliveryNotes(editingInvoice.delivery?.notes ?? "");
    setDeliveryCharge(savedDeliveryCharge);
    setScheduledDeliveryTime(toDateTimeLocalInputValue(scheduledAt));
    setSplitEntries([{ mode: coercePaymentMode(editingInvoice.paymentMode), amount: decimalToNumber(editingInvoice.amountPaid ?? 0) }]);
    setUseSplit(false);
    setAmountReceived(0);
    setSelectedPaymentMode(coercePaymentMode(editingInvoice.paymentMode));
    setLastBill(null);
    notify(`Editing ${editingInvoice.invoiceNumber}. Save keeps the same invoice number.`);
    barcodeRef.current?.focus();
  }, [editingInvoice, gstEnabled, setLines]);

  useEffect(() => {
    setCustomerHighlightIndex(0);
  }, [customerSearch, visibleCustomerResults.length]);

  useEffect(() => {
    setProductHighlightIndex(0);
  }, [barcodeInput, productResults.length]);

  useEffect(() => {
    const fetched = productSearchQuery.data?.data ?? [];
    if (fetched.length === 0) return;
    setKnownProducts((current) => mergeProducts(current, fetched));
  }, [productSearchQuery.data?.data]);

  useEffect(() => {
    const exactProduct = productExactQuery.data;
    if (!exactProduct) return;
    setKnownProducts((current) => mergeProducts(current, [exactProduct]));
  }, [productExactQuery.data]);

  useEffect(() => {
    async function refreshCounts() {
      setQueueCounts(await getPendingInvoiceCounts());
    }
    function handleOnline() {
      setOnline(true);
      void syncNow();
    }
    function handleOffline() {
      setOnline(false);
    }

    setOnline(navigator.onLine);
    void refreshCounts();
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      const key = event.key;
      const shortcut = paymentMethods.find((method) => method.keyboard_shortcut?.toLowerCase() === `ctrl+${key}`.toLowerCase());
      if (shortcut) {
        event.preventDefault();
        selectPaymentMethod(shortcut);
        void confirmInvoice(paymentMethodToMode(shortcut), shortcut.id);
        return;
      }
      if (key.toLowerCase() === "h") {
        event.preventDefault();
        if (isEditMode) {
          notify("Finish or cancel invoice editing before holding a bill.", "red");
          return;
        }
        holdCurrentBill(selectedCustomer?.id ?? "");
      }
      if (key.toLowerCase() === "n") {
        event.preventDefault();
        clearBill();
      }
      if (key.toLowerCase() === "p" && lastBill) {
        event.preventDefault();
        openInvoicePdfPreview(lastBill);
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  async function syncNow() {
    const hasSession = await ensureAuthenticatedSession();
    if (!hasSession) {
      notify("Sign in before syncing.", "red");
      return;
    }

    await syncPendingInvoices(async () => {
      const auth = await refreshAuthSession();
      storeAuthSession(auth);
      return createAuthenticatedApiClient();
    });
    setQueueCounts(await getPendingInvoiceCounts());
    notify("Offline queue synced.");
  }

  async function ensureAuthenticatedSession(): Promise<boolean> {
    if (hasStoredAuthSession()) {
      return true;
    }

    try {
      const auth = await refreshAuthSession();
      storeAuthSession(auth);
      await queryClient.invalidateQueries({ queryKey: ["printer", "billing"] });
      return true;
    } catch {
      return false;
    }
  }

  function selectPaymentMethod(method: PaymentMethodRecord) {
    setSelectedPaymentMethodId(method.id);
    setSelectedPaymentMode(paymentMethodToMode(method));
    setReferenceNumber("");
    if (method.type !== "cash") {
      setAmountReceived(0);
    }
  }

  function printUpiQr(method: PaymentMethodRecord) {
    if (!method.upi_qr_data) return;
    const tenant = getStoredTenant();
    const storeName = tenant?.name ?? "RetailOS";
    const printWindow = window.open("", "_blank", "width=420,height=520");
    if (!printWindow) return;
    printWindow.document.write(`<!doctype html>
      <html>
        <head>
          <title>${escapeHtml(method.name)} QR</title>
          <style>
            @page { size: 100mm 120mm; margin: 5mm; }
            body { font-family: sans-serif; text-align: center; }
            .store-name { font-size: 16pt; font-weight: bold; margin-bottom: 8px; }
            .qr { width: 80mm; height: 80mm; }
            .upi-id { font-size: 11pt; margin-top: 8px; color: #333; }
            .tagline { font-size: 9pt; color: #666; margin-top: 4px; }
          </style>
        </head>
        <body onload="window.print()">
          <div class="store-name">${escapeHtml(storeName)}</div>
          <img class="qr" src="${method.upi_qr_data}" alt="UPI QR" />
          <div class="upi-id">${escapeHtml(method.upi_id ?? "")}</div>
          <div class="tagline">Scan to pay via any UPI app</div>
        </body>
      </html>`);
    printWindow.document.close();
  }

  function notify(message: string, tone: StatusTone = "green") {
    setStatus(message);
    setStatusTone(tone);
  }

  function collectStockWarnings(activeLines: Array<{ productId: string; productName: string; quantity: number }>): StockWarning[] {
    return activeLines.flatMap((line) => {
      const product = products.find((item) => item.id === line.productId);
      if (!product) return [];

      const available = decimalToNumber(product.currentStock);
      if (line.quantity <= available + 0.0005) return [];

      return [{
        productId: line.productId,
        productName: line.productName,
        available,
        requested: line.quantity,
        shortage: Math.max(line.quantity - available, 0),
      }];
    });
  }

  function showStockWarnings(warnings: StockWarning[]) {
    if (warnings.length === 0) return;

    const summary = warnings
      .slice(0, 3)
      .map((warning) => `${warning.productName}: stock ${warning.available.toFixed(3)}, billed ${warning.requested.toFixed(3)}`)
      .join(" | ");
    const extra = warnings.length > 3 ? ` | ${String(warnings.length - 3)} more item(s)` : "";
    notify(`Invoice saved with stock warning. ${summary}${extra}`, "amber");
  }

  function insertProduct(product: ProductRecord) {
    setKnownProducts((current) => mergeProducts(current, [product]));
    const existing = lines.find((line) => line.productId === product.id);
    if (existing) {
      setLines([
        { ...existing, quantity: existing.quantity + 1 },
        ...lines.filter((line) => line.id !== existing.id),
      ]);
    } else {
      const lineId = addLine();
      setLine(lineId, {
        productId: product.id,
        productName: product.name,
        sellingPrice: decimalToNumber(product.sellingPrice),
        gstRate: gstEnabled ? decimalToNumber(product.gstRate) : 0,
        quantity: 1,
        discount: 0,
      });
    }
    setLastBill(null);
    barcodeRef.current?.focus();
  }

  function selectCustomer(customer: CustomerApiRecord | CustomerRecord) {
    const normalizedCustomer = normalizeCustomer(customer);
    setSelectedCustomer(normalizedCustomer);
    setCustomerSearch(`${normalizedCustomer.name} ${normalizedCustomer.phone}`);
    setShowNewCustomerForm(false);
  }

  function handleBarcodeKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && productResults.length > 0) {
      event.preventDefault();
      setProductHighlightIndex((index) => (index + 1) % productResults.length);
      return;
    }

    if (event.key === "ArrowUp" && productResults.length > 0) {
      event.preventDefault();
      setProductHighlightIndex((index) => (index - 1 + productResults.length) % productResults.length);
      return;
    }

    if (event.key === "Escape") {
      setBarcodeInput("");
      return;
    }

    if (event.key !== "Enter" || !barcodeInput.trim()) return;
    event.preventDefault();
    void addProductFromSearch(barcodeInput);
  }

  async function addProductFromSearch(input: string) {
    const code = input.trim();
    const codeLower = code.toLowerCase();
    const search = buildProductSearchTerm(input);
    let candidates = productResults;

    try {
      const exactProduct = await lookupProductByCode(code);
      if (exactProduct) {
        insertProduct(exactProduct);
        setBarcodeInput("");
        return;
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Product lookup failed", "red");
      return;
    }

    if (candidates.length === 0 || !candidates.some((item) => exactProductIdentifierMatch(item, codeLower))) {
      try {
        const fetched = await listProducts({ search: search.value, limit: 8 });
        candidates = mergeProducts(candidates, fetched.data);
      } catch {
        // The normal authenticated API error message is shown below as no match.
      }
    }
    const exactProduct = mergeProducts(candidates, products).find((item) => exactProductIdentifierMatch(item, codeLower));
    const product =
      exactProduct ??
      candidates[productHighlightIndex] ??
      candidates.find((item) => matchesProductSearch(item, search, productSearchMode));
    if (!product) {
      notify(`No product found for ${code}`, "red");
      setBarcodeInput("");
      return;
    }

    insertProduct(product);
    setBarcodeInput("");
  }

  function handleCustomerSearchKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && visibleCustomerResults.length > 0) {
      event.preventDefault();
      setCustomerHighlightIndex((index) => (index + 1) % visibleCustomerResults.length);
      return;
    }

    if (event.key === "ArrowUp" && visibleCustomerResults.length > 0) {
      event.preventDefault();
      setCustomerHighlightIndex((index) => (index - 1 + visibleCustomerResults.length) % visibleCustomerResults.length);
      return;
    }

    if (event.key === "Enter" && visibleCustomerResults[customerHighlightIndex]) {
      event.preventDefault();
      selectCustomer(visibleCustomerResults[customerHighlightIndex]);
      return;
    }

    if (event.key === "Escape") {
      setCustomerSearch("");
      setSelectedCustomer(null);
      setShowNewCustomerForm(false);
    }
  }

  async function createCustomerInline() {
    if (!newCustomerName.trim() || !newCustomerPhone.trim() || !newCustomerAddress.trim()) {
      notify("Customer name, phone and address are required.", "red");
      return;
    }

    try {
      const customer = await createAuthenticatedApiClient().post<CustomerApiRecord>("/customers", {
        customerCode: `CUST-${newCustomerPhone.trim()}`,
        name: newCustomerName.trim(),
        phone: newCustomerPhone.trim(),
        address: newCustomerAddress.trim(),
      });
      selectCustomer(customer);
      setNewCustomerName("");
      setNewCustomerPhone("");
      setNewCustomerAddress("");
      await queryClient.invalidateQueries({ queryKey: ["customers", "billing"] });
      notify("Customer added.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to add customer.", "red");
    }
  }

  async function submitPastedWhatsappOrder() {
    if (!pasteOrderPhone.trim() || !pasteOrderText.trim()) {
      notify("Customer phone and WhatsApp order text are required.", "red");
      return;
    }

    const hasSession = await ensureAuthenticatedSession();
    if (!hasSession) {
      notify("Sign in before creating a pasted WhatsApp order.", "red");
      return;
    }

    setIsPastingOrder(true);
    setPasteOrderReviewLines([]);
    try {
      const result = await createAuthenticatedApiClient().post<PasteWhatsappOrderResponse>("/whatsapp/orders/paste", {
        phone: pasteOrderPhone.trim(),
        ...(pasteOrderName.trim() ? { customerName: pasteOrderName.trim() } : {}),
        body: pasteOrderText.trim(),
      });

      if (!result.invoiceId) {
        setPasteOrderReviewLines(result.unmatchedLines ?? []);
        notify("WhatsApp order saved for review, but no product lines matched.", "red");
        return;
      }

      const draftInvoice = await createAuthenticatedApiClient().get<InvoiceRecord>(`/billing/invoices/${result.invoiceId}`);
      onDraftReady?.(draftInvoice);
      await queryClient.invalidateQueries({ queryKey: ["invoices"] });
      setShowPasteOrder(false);
      setPasteOrderPhone("");
      setPasteOrderName("");
      setPasteOrderText("");
      setPasteOrderReviewLines([]);
      notify(`Draft invoice ${result.invoiceNumber ?? draftInvoice.invoiceNumber} created from WhatsApp order.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to create draft from pasted WhatsApp order.", "red");
    } finally {
      setIsPastingOrder(false);
    }
  }

  async function applyCoupon() {
    if (!couponInput.trim()) return;
    try {
      const result = await createAuthenticatedApiClient().post<{ discount: number }>("/coupons/validate", {
        code: couponInput.trim(),
        orderTotal: totals.grandTotal,
      });
      setCouponDiscount(result.discount);
      setAppliedCoupon(couponInput.trim());
      notify(`Coupon applied: ₹${result.discount.toFixed(2)} off`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Invalid coupon", "red");
    }
  }

  async function confirmInvoice(paymentModeOverride?: PaymentMode, paymentMethodIdOverride?: string) {
    const activeLines = lines.filter((line) => line.productId);
    if (activeLines.length === 0) {
      notify("Add at least one product.", "red");
      return;
    }

    const splitPaymentEntries = normalizedSplitEntries();
    const paymentMethodId = useSplit ? splitPaymentEntries[0]?.paymentMethodId ?? selectedPaymentMethod?.id ?? null : paymentMethodIdOverride ?? selectedPaymentMethodId;
    const activePaymentMethod = paymentMethodId ? paymentMethods.find((method) => method.id === paymentMethodId) ?? selectedPaymentMethod : selectedPaymentMethod;
    const paymentMode = useSplit ? splitPaymentEntries[0]?.mode ?? "CASH" : paymentModeOverride ?? selectedPaymentMode;
    if (!useSplit && !paymentMethodId) {
      notify("Select a payment method.", "red");
      return;
    }
    if (!useSplit) {
      setSelectedPaymentMode(paymentMode);
    }
    if (!useSplit && activePaymentMethod?.requires_reference && !referenceNumber.trim()) {
      notify(`${activePaymentMethod.reference_label || "Reference number"} is required.`, "red");
      return;
    }
    const customerId = selectedCustomer?.id;
    const scheduledDeliveryAt = deliveryRequired ? toIsoDateTime(scheduledDeliveryTime) : undefined;
    const deliveryPayload = deliveryRequired && selectedCustomer
      ? {
          customerId: selectedCustomer.id,
          deliveryAddress: deliveryAddress.trim() || selectedCustomer.address || "",
          ...(scheduledDeliveryAt ? { scheduledAt: scheduledDeliveryAt } : {}),
          ...(deliveryNotes.trim() ? { notes: deliveryNotes.trim() } : {}),
        }
      : undefined;

    if (deliveryRequired && (!customerId || !deliveryPayload?.deliveryAddress || deliveryPayload.deliveryAddress.length < 5)) {
      notify("Select a customer and enter a delivery address.", "red");
      return;
    }

    if (selectedCustomer) {
      const limit = selectedCustomer.creditLimit ?? 0;
      const outstanding = selectedCustomer.outstandingDue ?? 0;
      if (paymentMode === "CREDIT" && limit > 0 && outstanding + totals.grandTotal > limit) {
        notify(`Credit limit exceeded. Outstanding ₹${outstanding.toFixed(2)}, limit ₹${limit.toFixed(2)}`, "red");
        return;
      }
    }

    if (!useSplit && paymentMode === "CASH" && amountReceived > 0 && amountReceived + 0.01 < totals.grandTotal) {
      notify("Cash received is less than the bill total.", "red");
      return;
    }

    if (useSplit) {
      const splitAmount = splitPaymentEntries.reduce((sum, entry) => sum + entry.amount, 0);
      if (splitPaymentEntries.length === 0) {
        notify("Add at least one split payment row.", "red");
        return;
      }
      if (splitPaymentEntries.some((entry) => !entry.paymentMethodId)) {
        notify("Select a method for every split payment row.", "red");
        return;
      }
      const missingReference = splitPaymentEntries.find((entry) => {
        const method = paymentMethods.find((item) => item.id === entry.paymentMethodId);
        return method?.requires_reference && !entry.referenceNumber?.trim();
      });
      if (missingReference) {
        const method = paymentMethods.find((item) => item.id === missingReference.paymentMethodId);
        notify(`${method?.reference_label || "Reference number"} is required for ${method?.name || "this payment"}.`, "red");
        return;
      }
      if (Math.abs(splitAmount - totals.grandTotal) > 0.01) {
        notify(`Split payment total must match grand total. Remaining ₹${(totals.grandTotal - splitAmount).toFixed(2)}`, "red");
        return;
      }
    }

    const localStockWarnings = collectStockWarnings(activeLines);
    if (localStockWarnings.length > 0) {
      showStockWarnings(localStockWarnings);
    }

    const billLevelDiscount = Math.min(totals.billLevelDiscount, totals.subtotal);
    const verticalData = {
      ...toRecord(editingInvoice?.verticalData),
      billDiscountAmount: billLevelDiscount,
      couponDiscount,
      loyaltyRedeem,
      ...(appliedCoupon ? { couponCode: appliedCoupon } : {}),
      deliveryCharge: deliveryPayload ? totals.deliveryCharge : 0,
      scheduledDeliveryTime: deliveryPayload && scheduledDeliveryAt ? scheduledDeliveryAt : null,
    };
    const invoicePayload = {
      paymentMode,
      billDiscount: billLevelDiscount,
      ...(isEditMode ? { customerId: customerId ?? null } : customerId ? { customerId } : {}),
      ...(isEditMode ? { notes: notes.trim() || null } : notes.trim() ? { notes: notes.trim() } : {}),
      verticalData,
      items: activeLines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        sellingPrice: line.sellingPrice,
        discountPercent: line.discount,
      })),
    };

    setIsSubmitting(true);
    setLastBill(null);
    const billSnapshot = createBillPreviewSnapshot(activeLines, totals, paymentMode, selectedCustomer);

    try {
      if (!online) {
        if (isEditMode) {
          notify("Invoice edits need internet because stock and payments must be reconciled immediately.", "red");
          return;
        }
        await queueOfflineInvoice(invoicePayload, deliveryPayload, paymentMode, splitPaymentEntries);
        clearBill();
        return;
      }

      const hasSession = await ensureAuthenticatedSession();
      if (!hasSession) {
        notify("Session expired. Please sign in again before confirming this bill.", "red");
        return;
      }

      if (editingInvoice) {
        const updated = await createAuthenticatedApiClient().put<InvoiceMutationResult>(
          `/billing/invoices/${editingInvoice.id}`,
          invoicePayload,
        );
        const pdfViewUrl = apiUrl(`/billing/invoices/${updated.id}/pdf/view`);
        const nextBill = {
          id: updated.id,
          invoiceNumber: updated.invoiceNumber,
          grandTotal: Number(updated.grandTotal),
          subtotal: billSnapshot.subtotal,
          lineDiscount: billSnapshot.lineDiscount,
          billLevelDiscount: billSnapshot.billLevelDiscount,
          deliveryCharge: billSnapshot.deliveryCharge,
          cgst: billSnapshot.cgst,
          sgst: billSnapshot.sgst,
          paymentMode,
          customer: billSnapshot.customer,
          lines: billSnapshot.lines,
          pdfViewUrl,
        };
        setLastBill(nextBill);
        const outputOk = await handleConfiguredInvoiceOutput(nextBill.id, nextBill.invoiceNumber, "Invoice updated");
        if (outputOk) {
          showStockWarnings(updated.stockWarnings ?? localStockWarnings);
        }
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["invoices"] }),
          queryClient.invalidateQueries({ queryKey: ["products"] }),
        ]);
        onEditComplete?.();
        return;
      }

      const created = await createAuthenticatedApiClient().post<InvoiceMutationResult>("/billing/invoices", invoicePayload);
      const confirmed = await createAuthenticatedApiClient().post<InvoiceMutationResult>(`/billing/invoices/${created.id}/confirm`, {});

      await createAuthenticatedApiClient().post(`/invoices/${created.id}/payments`, {
        payments: useSplit
          ? splitPaymentEntries.map((entry) => ({
              payment_method_id: entry.paymentMethodId,
              amount: entry.amount,
              ...(entry.referenceNumber ? { reference_number: entry.referenceNumber } : {}),
            }))
          : [{
              payment_method_id: paymentMethodId,
              amount: Number(confirmed.grandTotal),
              ...(referenceNumber.trim() ? { reference_number: referenceNumber.trim() } : {}),
            }],
      });

      if (loyaltyRedeem > 0 && customerId) {
        await createAuthenticatedApiClient().post("/loyalty/redeem", {
          customerId,
          invoiceId: created.id,
          points: Math.floor(loyaltyRedeem),
        }).catch(() => undefined);
      }

      if (deliveryPayload) {
        await createAuthenticatedApiClient().post("/delivery", {
          ...deliveryPayload,
          invoiceId: created.id,
        });
      }

      const pdfViewUrl = apiUrl(`/billing/invoices/${created.id}/pdf/view`);
      const nextBill = {
        id: created.id,
        invoiceNumber: confirmed.invoiceNumber,
        grandTotal: Number(confirmed.grandTotal),
        subtotal: billSnapshot.subtotal,
        lineDiscount: billSnapshot.lineDiscount,
        billLevelDiscount: billSnapshot.billLevelDiscount,
        deliveryCharge: billSnapshot.deliveryCharge,
        cgst: billSnapshot.cgst,
        sgst: billSnapshot.sgst,
        paymentMode,
        customer: billSnapshot.customer,
        lines: billSnapshot.lines,
        pdfViewUrl,
      };
      setLastBill(nextBill);
      const outputOk = await handleConfiguredInvoiceOutput(nextBill.id, nextBill.invoiceNumber);
      if (outputOk) {
        showStockWarnings(confirmed.stockWarnings ?? localStockWarnings);
      }
      await queryClient.invalidateQueries({ queryKey: ["invoices"] });
    } catch (error) {
      if (!isEditMode && isNetworkError(error)) {
        await queueOfflineInvoice(invoicePayload, deliveryPayload, paymentMode, splitPaymentEntries);
        clearBill();
        return;
      }

      notify(error instanceof Error ? error.message : isEditMode ? "Unable to update invoice." : "Unable to create invoice.", "red");
    } finally {
      setIsSubmitting(false);
      focusBarcodeSoon();
    }
  }

  async function queueOfflineInvoice(
    invoicePayload: object,
    deliveryPayload: { customerId: string; deliveryAddress: string; scheduledAt?: string; notes?: string } | undefined,
    paymentMode: PaymentMode,
    splitPayments: SplitEntry[] = [],
  ) {
    await queueInvoice(
      {
        invoice: invoicePayload,
        ...(deliveryPayload ? { delivery: deliveryPayload } : {}),
        ...(splitPayments.length > 0 ? { splitPayments } : { autoPay: { mode: paymentMode } }),
      },
      getStoredTenant()?.slug ?? "local-tenant",
    );
    setQueueCounts(await getPendingInvoiceCounts());
    notify("Invoice saved offline. It will sync when internet and sign-in are available.");
  }

  function shareWhatsApp() {
    if (!lastBill?.customer) return;
    const opened = openWhatsappMessage(
      lastBill.customer.phone,
      formatInvoiceWhatsappMessage({
        invoiceNumber: lastBill.invoiceNumber,
        grandTotal: lastBill.grandTotal,
        paymentMode: lastBill.paymentMode,
        tenantName: getStoredTenant()?.name ?? "RetailOS",
        customerName: lastBill.customer.name,
        items: lastBill.lines,
        templateBody: getWhatsappTemplateBody(whatsappTemplatesQuery.data, "invoiceReady"),
      }),
    );
    notify(opened ? "WhatsApp opened with invoice message." : "Customer phone number is invalid for WhatsApp.", opened ? "green" : "red");
  }

  async function printThermalInvoice() {
    if (!lastBill) return;
    try {
      const result = await createAuthenticatedApiClient().post<PrinterResult>(`/billing/invoices/${lastBill.id}/print`, {});
      const handled = await handlePrinterResult(result, "Thermal print", lastBill.invoiceNumber);
      if (!handled) {
        notify(result.message || `Printer status: ${result.status}`);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Thermal print failed.", "red");
    }
  }

  async function handleConfiguredInvoiceOutput(invoiceId: string, invoiceNumber: string, actionLabel = "Invoice confirmed"): Promise<boolean> {
    try {
      const printer =
        printerQuery.data?.printer ??
        (await createAuthenticatedApiClient()
          .get<PrinterResponse>("/printer")
          .then((response) => response.printer)
          .catch(() => null));

      if (!printer?.isActive || printer.connectionType === "NONE") {
        await downloadInvoicePdf(invoiceId, invoiceNumber);
        notify(`${actionLabel}. PDF downloaded.`);
        return true;
      }

      const result = await createAuthenticatedApiClient().post<PrinterResult>(`/billing/invoices/${invoiceId}/print`, {});
      const handled = await handlePrinterResult(result, actionLabel, invoiceNumber);
      if (handled) {
        return true;
      }

      await downloadInvoicePdf(invoiceId, invoiceNumber);
      notify(`${result.message || "Printer not available."} PDF downloaded instead.`);
      return true;
    } catch (error) {
      notify(`${actionLabel}. Output failed: ${error instanceof Error ? error.message : "PDF or printer failed."}`, "red");
      return false;
    }
  }

  async function handlePrinterResult(result: PrinterResult, actionLabel: string, invoiceNumber: string): Promise<boolean> {
    if (result.status === "printed" || result.status === "queued") {
      notify(result.message || `${actionLabel}. Invoice printed.`);
      return true;
    }

    if (result.status === "local_agent_payload") {
      await printViaLocalAgent({
        agentUrl: result.agentUrl,
        printerName: result.printerName,
        bytesBase64: result.bytesBase64,
        jobName: `RetailOS ${invoiceNumber}`,
      });
      notify(`${actionLabel}. Printed through RetailOS Local Print Agent.`);
      return true;
    }

    if (result.status === "bluetooth_payload") {
      notify(`${actionLabel}. Bluetooth printer payload is ready from the Thermal button.`);
      return true;
    }

    return false;
  }

  async function downloadInvoicePdf(invoiceId: string, invoiceNumber: string) {
    await downloadApiFile(`/billing/invoices/${invoiceId}/pdf/view`, `${invoiceNumber}.pdf`);
  }

  function openInvoicePdfPreview(bill: LastBill) {
    window.open(bill.pdfViewUrl, "_blank", "noopener,noreferrer");
  }

  function clearBill() {
    reset();
    setQuantityDrafts({});
    setSelectedCustomer(null);
    setCustomerSearch("");
    setShowNewCustomerForm(false);
    setNewCustomerName("");
    setNewCustomerPhone("");
    setNewCustomerAddress("");
    setBarcodeInput("");
    setBillDiscount(0);
    setCouponDiscount(0);
    setAppliedCoupon("");
    setCouponInput("");
    setLoyaltyRedeem(0);
    setNotes("");
    setDeliveryRequired(false);
    setDeliveryAddress("");
    setDeliveryNotes("");
    setDeliveryCharge(0);
    setScheduledDeliveryTime("");
    const defaultMethod = paymentMethods[0] ?? null;
    setSplitEntries([{ mode: defaultMethod ? paymentMethodToMode(defaultMethod) : "CASH", paymentMethodId: defaultMethod?.id, amount: 0 }]);
    setUseSplit(false);
    setAmountReceived(0);
    if (defaultMethod) {
      setSelectedPaymentMethodId(defaultMethod.id);
      setSelectedPaymentMode(paymentMethodToMode(defaultMethod));
    } else {
      setSelectedPaymentMethodId(null);
      setSelectedPaymentMode("CASH");
    }
    setReferenceNumber("");
    setLastBill(null);
    onEditComplete?.();
    focusBarcodeSoon();
  }

  function holdCurrentBill(customerId: string) {
    holdBill(customerId);
    setQuantityDrafts({});
    focusBarcodeSoon();
  }

  function restoreHeldBill(billId: string) {
    restoreHeld(billId);
    setQuantityDrafts({});
    setShowHeld(false);
    focusBarcodeSoon();
  }

  function removeBillingLine(lineId: string) {
    removeLine(lineId);
    setQuantityDrafts((current) => withoutRecordKey(current, lineId));
  }

  function handleQuantityChange(lineId: string, rawValue: string) {
    setQuantityDrafts((current) => ({ ...current, [lineId]: rawValue }));
    const quantity = Number(rawValue);
    if (Number.isFinite(quantity) && quantity > 0) {
      setLine(lineId, { quantity });
    }
  }

  function handleQuantityBlur(lineId: string, currentQuantity: number) {
    const rawValue = quantityDrafts[lineId];
    if (rawValue === undefined) {
      return;
    }

    setLine(lineId, { quantity: normalizeBillingQuantity(rawValue, currentQuantity) });
    setQuantityDrafts((current) => withoutRecordKey(current, lineId));
  }

  function dismissBillPreview() {
    setLastBill(null);
    clearBill();
  }

  function splitTotal(): number {
    return splitEntries.reduce((sum, entry) => sum + entry.amount, 0);
  }

  function normalizedSplitEntries(): SplitEntry[] {
    return splitEntries
      .map((entry) => ({
        mode: entry.mode,
        paymentMethodId: entry.paymentMethodId,
        amount: roundMoney(entry.amount || 0),
        referenceNumber: entry.referenceNumber,
      }))
      .filter((entry) => entry.amount > 0);
  }

  function createBillPreviewSnapshot(
    activeLines: typeof lines,
    billTotals: typeof totals,
    paymentMode: PaymentMode,
    customer: CustomerRecord | null,
  ): Omit<LastBill, "id" | "invoiceNumber" | "grandTotal" | "pdfViewUrl"> {
    return {
      subtotal: billTotals.subtotal,
      lineDiscount: billTotals.lineDiscount,
      billLevelDiscount: billTotals.billLevelDiscount,
      deliveryCharge: billTotals.deliveryCharge,
      cgst: billTotals.cgst,
      sgst: billTotals.sgst,
      paymentMode,
      customer,
      lines: activeLines.map((line) => ({
        productName: line.productName,
        quantity: line.quantity,
        sellingPrice: line.sellingPrice,
        discount: line.discount,
        gstRate: line.gstRate,
        total: lineTotal(line, gstEnabled),
      })),
    };
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[1fr_390px]">
      <div className="rounded-md border border-border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <Receipt className="size-4 text-emerald-700" aria-hidden="true" />
            {editingInvoice ? `Editing ${editingInvoice.invoiceNumber}` : "POS invoice"}
            {editingInvoice ? <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">{editingInvoice.status}</span> : null}
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
              {totals.totalItems} item{totals.totalItems === 1 ? "" : "s"} | Qty {formatQuantityInput(totals.totalQuantity)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex size-3 rounded-full"
              title={`${online ? "Online" : "Offline billing active"} | pending ${String(queueCounts.pending)}, syncing ${String(queueCounts.syncing)}, failed ${String(queueCounts.failed)}`}
            >
              <span className={`size-3 rounded-full ${online ? "bg-emerald-500" : "bg-red-500"}`} />
            </span>
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-slate-700" onClick={() => void syncNow()}>
              <RefreshCcw className="size-4" aria-hidden="true" />
              Sync
            </button>
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-800" onClick={() => setShowPasteOrder(true)}>
              <ClipboardPaste className="size-4" aria-hidden="true" />
              Paste order
            </button>
            {heldBills.length > 0 ? (
              <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-slate-700" onClick={() => setShowHeld((value) => !value)}>
                <BookMarked className="size-4" aria-hidden="true" />
                Held ({heldBills.length})
              </button>
            ) : null}
            <button
              className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium disabled:opacity-50 ${
                heldBills.length > 0 ? "border-amber-300 bg-amber-50 text-amber-800" : "border-border text-amber-700"
              }`}
              onClick={() => holdCurrentBill(selectedCustomer?.id ?? "")}
              disabled={lines.length === 0 || isEditMode}
            >
              <Pause className="size-4" aria-hidden="true" />
              Hold <span className="text-xs text-amber-600">Ctrl+H</span>
            </button>
            {isEditMode ? (
              <button className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700" onClick={clearBill}>
                Cancel edit
              </button>
            ) : null}
          </div>
        </div>

        {showHeld && heldBills.length > 0 ? (
          <div className="border-b border-border bg-amber-50 p-3">
            <div className="mb-2 text-xs font-semibold text-amber-800">Held bills</div>
            <div className="flex flex-wrap gap-2">
              {heldBills.map((bill) => (
                <div key={bill.id} className="flex items-center gap-2 rounded-md border border-amber-200 bg-white px-2 py-1">
                  <span className="text-xs text-slate-700">{bill.label} ({bill.lines.length} items)</span>
                  <button className="text-xs font-medium text-emerald-700" onClick={() => restoreHeldBill(bill.id)}>Restore</button>
                  <button className="text-xs text-red-600" onClick={() => deleteHeld(bill.id)}>Remove</button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 border-b border-border p-3 lg:grid-cols-[1fr_1.1fr]">
          <div className="relative">
            <label className="text-xs font-medium text-slate-500">Customer search</label>
            <div className="mt-1 flex h-10 items-center gap-2 rounded-md border border-border px-3">
              <Search className="size-4 text-slate-400" aria-hidden="true" />
              <input
                value={customerSearch}
                onChange={(event) => {
                  setCustomerSearch(event.target.value);
                  setSelectedCustomer(null);
                  setShowNewCustomerForm(false);
                }}
                onKeyDown={handleCustomerSearchKey}
                placeholder="Name or phone"
                className="min-w-0 flex-1 text-sm outline-none"
              />
            </div>
            <div className="mt-2 grid gap-1">
              {selectedCustomer ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">
                  Selected: {selectedCustomer.name} | {selectedCustomer.phone}
                  <button className="ml-2 font-semibold text-emerald-800" onClick={() => setSelectedCustomer(null)}>Clear</button>
                </div>
              ) : null}
              {customerSearch && !selectedCustomer ? (
                <div className="grid max-h-56 gap-1 overflow-y-auto pr-1">
                  {visibleCustomerResults.map((customer, index) => (
                    <button
                      key={customer.id}
                      className={`rounded-md border px-2 py-1 text-left text-xs ${index === customerHighlightIndex ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
                      onClick={() => selectCustomer(customer)}
                    >
                      {customer.name} | {customer.phone}
                    </button>
                  ))}
                </div>
              ) : null}
              {customerSearch && !selectedCustomer && !showNewCustomerForm ? (
                <button className="inline-flex h-8 items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 text-left text-xs font-semibold text-emerald-800" onClick={() => {
                  setShowNewCustomerForm(true);
                  setNewCustomerName(customerSearch.replace(/\d/g, "").trim());
                  setNewCustomerPhone(customerSearch.replace(/\D/g, "").slice(0, 15));
                }}>
                  <UserPlus className="size-3.5" aria-hidden="true" />
                  New customer
                </button>
              ) : null}
            </div>
            {showNewCustomerForm ? (
              <div className="mt-2 grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                  Add customer
                  <button className="text-slate-500" onClick={() => setShowNewCustomerForm(false)}>
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </div>
              <input value={newCustomerName} onChange={(event) => setNewCustomerName(event.target.value)} placeholder="Customer name" className="h-9 rounded-md border border-border px-3 text-sm" />
              <input value={newCustomerPhone} onChange={(event) => setNewCustomerPhone(event.target.value)} placeholder="Phone number" className="h-9 rounded-md border border-border px-3 text-sm" />
              <input value={newCustomerAddress} onChange={(event) => setNewCustomerAddress(event.target.value)} placeholder="Address" className="h-9 rounded-md border border-border px-3 text-sm" />
              <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 text-sm font-medium text-emerald-800" onClick={() => void createCustomerInline()}>
                <UserPlus className="size-4" aria-hidden="true" />
                Save customer
              </button>
              </div>
            ) : null}
          </div>

          <div className="relative">
            <label className="text-xs font-medium text-slate-500">Product search</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                ref={barcodeRef}
                value={barcodeInput}
                onChange={(event) => setBarcodeInput(event.target.value)}
                onKeyDown={handleBarcodeKey}
                placeholder={productSearchPlaceholder(productSearchMode)}
                className="h-10 min-w-0 flex-1 rounded-md border border-border px-3 font-mono text-sm"
              />
              <select
                value={productSearchMode}
                onChange={(event) => setProductSearchMode(event.target.value as ProductSearchMode)}
                className="h-10 w-32 shrink-0 rounded-md border border-border bg-white px-2 text-xs font-medium text-slate-700"
                aria-label="Product search mode"
              >
                {PRODUCT_SEARCH_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
              </select>
            </div>
            {barcodeInput.trim() ? (
              <div className="mt-2 grid max-h-64 gap-1 overflow-y-auto pr-1">
                {productResults.length > 0 ? productResults.map((product, index) => {
                  const imageSrc = productSearchImageSrc(product);
                  return (
                    <button
                      key={product.id}
                      className={`rounded-md border px-2 py-1 text-left text-xs ${index === productHighlightIndex ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
                      onClick={() => {
                        insertProduct(product);
                        setBarcodeInput("");
                      }}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          {imageSrc ? (
                            <img src={imageSrc} alt="" className="size-8 shrink-0 rounded border border-slate-200 object-cover" />
                          ) : (
                            <span className="flex size-8 shrink-0 items-center justify-center rounded border border-dashed border-slate-300 bg-white text-[9px] font-bold uppercase text-slate-400">Img</span>
                          )}
                          <span className="min-w-0 truncate">
                            {product.name} <span className="text-slate-400">| {productSearchPrice(product)} | {productSearchIdentifier(product)}</span>
                          </span>
                        </span>
                        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
                          {productMatchLabel(product, barcodeInput, productSearchMode)}
                        </span>
                      </span>
                    </button>
                  );
                }) : <div className="rounded-md border border-red-100 bg-red-50 px-2 py-1 text-xs text-red-700">No matching product</div>}
              </div>
            ) : (
              <div className="mt-2 text-xs text-slate-500">Scan or search to add products.</div>
            )}
          </div>
        </div>

        {selectedCustomer && (selectedCustomer.outstandingDue ?? 0) > 0 ? (
          <div className="border-b border-border bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Outstanding due: ₹{(selectedCustomer.outstandingDue ?? 0).toFixed(2)}
            {selectedCustomer.creditLimit ? ` | Credit limit: ₹${selectedCustomer.creditLimit.toFixed(2)}` : ""}
          </div>
        ) : null}

        <div className="max-h-[46vh] overflow-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-2 py-2 font-medium">Qty</th>
                <th className="px-2 py-2 font-medium">Rate</th>
                <th className="px-2 py-2 font-medium">Discount %</th>
                {gstEnabled ? <th className="px-2 py-2 font-medium">GST%</th> : null}
                <th className="px-2 py-2 text-right font-medium">Total</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={gstEnabled ? 7 : 6} className="px-3 py-8 text-center text-sm text-slate-500">Scan a barcode or search a product to start billing.</td>
                </tr>
              ) : null}
              {lines.map((line) => {
                const product = products.find((item) => item.id === line.productId);
                const stock = product ? decimalToNumber(product.currentStock) : null;
                const mrp = product ? decimalToNumber(product.mrp) : null;
                const reorderLevel = product?.reorderLevel ? decimalToNumber(product.reorderLevel) : null;
                const stockTone = stock !== null && stock <= 0 ? "bg-red-50 text-red-700" : stock !== null && reorderLevel !== null && stock <= reorderLevel ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600";
                const barcode = product?.barcode?.trim();
                const total = lineTotal(line, gstEnabled);
                const aboveMrp = mrp !== null && line.sellingPrice > mrp;
                return (
                  <tr key={line.id} className="border-t border-border">
                    <td className="px-3 py-1.5">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="min-w-0 truncate font-medium text-slate-900">{line.productName}</span>
                        {barcode ? <span className="inline-flex rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">Barcode {barcode}</span> : null}
                        {stock !== null ? <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] ${stockTone}`}>Stock {stock.toFixed(3)}</span> : null}
                      </div>
                      {aboveMrp ? <div className="mt-0.5 text-[11px] font-semibold text-red-700">Selling price above MRP ₹{mrp.toFixed(2)}</div> : null}
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        className="h-8 w-16 rounded-md border border-border px-2"
                        type="number"
                        inputMode="decimal"
                        min="0.5"
                        step="0.5"
                        value={quantityDrafts[line.id] ?? formatQuantityInput(line.quantity)}
                        onChange={(event) => handleQuantityChange(line.id, event.target.value)}
                        onBlur={() => handleQuantityBlur(line.id, line.quantity)}
                      />
                    </td>
                    <td className="px-2 py-1.5"><input className="h-8 w-20 rounded-md border border-border px-2" type="number" min="0" value={line.sellingPrice} onChange={(event) => setLine(line.id, { sellingPrice: Number(event.target.value) })} /></td>
                    <td className="px-2 py-1.5"><input className="h-8 w-20 rounded-md border border-border px-2" type="number" min="0" max="100" value={line.discount} onChange={(event) => setLine(line.id, { discount: Math.min(Math.max(Number(event.target.value), 0), 100) })} /></td>
                    {gstEnabled ? <td className="px-2 py-1.5 text-slate-500">{line.gstRate}%</td> : null}
                    <td className="px-2 py-1.5 text-right font-semibold">₹{total.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-right">
                      <button className="inline-flex size-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100" onClick={() => removeBillingLine(line.id)}>
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 border-t border-border p-3 md:grid-cols-2">
          <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Invoice notes (optional)" className="h-9 rounded-md border border-border px-3 text-sm" />
          {selectedCustomer ? (
            <label className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={deliveryRequired} onChange={(event) => setDeliveryRequired(event.target.checked)} className="size-4 accent-emerald-600" />
              Delivery required
            </label>
          ) : null}
        </div>

        {selectedCustomer && deliveryRequired ? (
          <div className="grid gap-3 border-t border-border bg-slate-50 p-3 md:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">
              Delivery address
              <input value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Delivery notes
              <input value={deliveryNotes} onChange={(event) => setDeliveryNotes(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Delivery charge (₹)
              <input type="number" min="0" value={deliveryCharge} onChange={(event) => setDeliveryCharge(Number(event.target.value) || 0)} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Scheduled for
              <input type="datetime-local" value={scheduledDeliveryTime} onChange={(event) => setScheduledDeliveryTime(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" />
            </label>
          </div>
        ) : null}
      </div>

      <aside className="rounded-md border border-border bg-white p-4">
        <div className="text-sm font-semibold text-slate-950">Bill summary</div>
        <div className="mt-4 grid gap-2 text-sm">
          <SummaryTextRow label="Total items" value={String(totals.totalItems)} />
          <SummaryTextRow label="Total quantity" value={formatQuantityInput(totals.totalQuantity)} />
          <SummaryRow label="Subtotal" value={totals.subtotal} />
          <SummaryRow label="Line discount" value={-totals.lineDiscount} />
          <SummaryRow label="Bill discount" value={-totals.billLevelDiscount} />
          {totals.deliveryCharge > 0 ? <SummaryRow label="Delivery charge" value={totals.deliveryCharge} /> : null}
          {gstEnabled ? <SummaryRow label="CGST" value={totals.cgst} /> : null}
          {gstEnabled ? <SummaryRow label="SGST" value={totals.sgst} /> : null}
          <div className="flex justify-between border-t border-border pt-3 text-base font-bold"><span>Grand total</span><span>₹{totals.grandTotal.toFixed(2)}</span></div>
        </div>

        <label className="mt-4 block text-sm font-medium text-slate-700">
          Total bill discount (amount)
          <input type="number" min="0" value={billDiscount} onChange={(event) => setBillDiscount(Number(event.target.value))} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" />
        </label>

        <div className="mt-4 flex gap-2">
          <input value={couponInput} onChange={(event) => setCouponInput(event.target.value)} placeholder="Coupon code" className="h-9 flex-1 rounded-md border border-border px-3 text-sm" />
          <button className="h-9 rounded-md border border-border px-3 text-sm font-medium" onClick={() => void applyCoupon()}>Apply</button>
        </div>
        {appliedCoupon ? <div className="mt-1 text-xs text-emerald-700">{appliedCoupon} applied (-₹{couponDiscount.toFixed(2)})</div> : null}

        {loyaltyBalance !== null ? (
          <div className="mt-3 rounded-md border border-border p-2">
            <div className="mb-1 text-xs text-slate-500">Loyalty points: {loyaltyBalance}</div>
            <div className="flex items-center gap-2">
              <input type="number" min="0" max={Math.min(loyaltyBalance, totals.grandTotal)} value={loyaltyRedeem} onChange={(event) => setLoyaltyRedeem(Math.min(Number(event.target.value), loyaltyBalance, totals.grandTotal))} className="h-8 w-24 rounded-md border border-border px-2 text-sm" />
              <span className="text-xs text-slate-500">points to redeem</span>
            </div>
          </div>
        ) : null}

        <label className="mt-4 flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={useSplit} onChange={(event) => setUseSplit(event.target.checked)} className="size-4 accent-emerald-600" />
          Split payment
        </label>
        {useSplit ? (
          <div className="mt-2 grid gap-2">
            {splitEntries.map((entry, index) => (
              <div key={`${entry.paymentMethodId ?? entry.mode}-${String(index)}`} className="grid gap-2 rounded-md border border-border bg-white p-2">
                <div className="flex items-center gap-2">
                  <select
                    value={entry.paymentMethodId ?? selectedPaymentMethodId ?? ""}
                    onChange={(event) => {
                      const method = paymentMethods.find((item) => item.id === event.target.value);
                      setSplitEntries((current) => current.map((item, itemIndex) => itemIndex === index ? {
                        ...item,
                        paymentMethodId: method?.id,
                        mode: method ? paymentMethodToMode(method) : item.mode,
                        referenceNumber: "",
                      } : item));
                    }}
                    className="h-9 flex-1 rounded-md border border-border px-2 text-sm"
                  >
                    {paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
                  </select>
                  <input type="number" min="0" value={entry.amount} onChange={(event) => setSplitEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, amount: Number(event.target.value) } : item))} className="h-9 w-28 rounded-md border border-border px-2 text-sm" />
                  {index > 0 ? <button className="text-sm text-red-600" onClick={() => setSplitEntries((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button> : null}
                </div>
                {paymentMethods.find((method) => method.id === entry.paymentMethodId)?.requires_reference ? (
                  <input
                    value={entry.referenceNumber ?? ""}
                    onChange={(event) => setSplitEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, referenceNumber: event.target.value } : item))}
                    placeholder={paymentMethods.find((method) => method.id === entry.paymentMethodId)?.reference_label ?? "Reference number"}
                    className="h-9 rounded-md border border-border px-2 text-sm"
                  />
                ) : null}
              </div>
            ))}
            <button
              className="text-left text-sm font-medium text-emerald-700"
              onClick={() => {
                const method = paymentMethods[0];
                setSplitEntries((current) => [...current, { mode: method ? paymentMethodToMode(method) : "CASH", paymentMethodId: method?.id, amount: 0 }]);
              }}
            >
              Add payment method
            </button>
            {Math.abs(splitTotal() - totals.grandTotal) > 0.01 ? (
              <div className="text-xs text-amber-600">Split total ₹{splitTotal().toFixed(2)} | Remaining ₹{(totals.grandTotal - splitTotal()).toFixed(2)}</div>
            ) : <div className="text-xs text-emerald-700">Split total matches the bill. Any payment button will record these split rows.</div>}
          </div>
        ) : null}

        {!useSplit ? (
          <div className="mt-4 grid gap-2 rounded-md border border-border bg-slate-50 p-3">
            <div className="text-xs font-semibold text-slate-600">Selected payment: {selectedPaymentMethod?.name ?? selectedPaymentMode}</div>
            {selectedPaymentMethod?.requires_reference ? (
              <label className="block text-sm font-medium text-slate-700">
                {selectedPaymentMethod.reference_label || "Reference number"}
                <input value={referenceNumber} onChange={(event) => setReferenceNumber(event.target.value)} placeholder={`Enter ${(selectedPaymentMethod.reference_label || "reference").toLowerCase()}`} className="mt-1 h-9 w-full rounded-md border border-border px-3 text-sm" autoFocus />
              </label>
            ) : null}
            {selectedPaymentMethod?.type === "upi" && selectedPaymentMethod.upi_qr_data ? (
              <div className="flex items-center gap-3 rounded-md border border-border bg-white p-2">
                <img src={selectedPaymentMethod.upi_qr_data} width={96} height={96} alt="UPI QR" className="size-24 rounded-sm border border-slate-200" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-800">{selectedPaymentMethod.upi_id}</div>
                  <button className="mt-2 h-8 rounded-md border border-border px-3 text-xs font-medium text-slate-700" onClick={() => printUpiQr(selectedPaymentMethod)}>Print QR</button>
                </div>
              </div>
            ) : null}
            {selectedPaymentMethod?.type === "cash" ? (
              <label className="block text-sm font-medium text-slate-700">
                Cash received
                <input type="number" min="0" value={amountReceived} onChange={(event) => {
                  if (selectedPaymentMethod) selectPaymentMethod(selectedPaymentMethod);
                  setAmountReceived(Number(event.target.value));
                }} className="mt-1 h-9 w-full rounded-md border border-border px-3 text-sm" />
              </label>
            ) : null}
            {amountReceived > 0 ? (
              <div className={`text-xs font-semibold ${changeDue >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                {changeDue >= 0 ? "Change" : "Short"} ₹{Math.abs(changeDue).toFixed(2)}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-2">
          {paymentMethods.map((method) => (
            <button
              key={method.id}
              className="rounded-md border px-3 py-2 text-left text-sm font-semibold disabled:opacity-50"
              style={{
                borderColor: selectedPaymentMethodId === method.id ? method.color : `${method.color}55`,
                backgroundColor: selectedPaymentMethodId === method.id ? `${method.color}22` : "#ffffff",
                color: method.color,
              }}
              onClick={() => {
                selectPaymentMethod(method);
                void confirmInvoice(paymentMethodToMode(method), method.id);
              }}
              disabled={isSubmitting || lines.length === 0 || paymentMethodsQuery.isLoading}
            >
              <span className="block">{useSplit ? "Confirm split" : isEditMode ? `Save ${method.name}` : method.name}</span>
              {useSplit ? (
                <span className="text-xs font-medium text-slate-600">Uses split rows</span>
              ) : (
                <span className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-500">{method.short_code}</span>
                  {method.keyboard_shortcut ? (
                    <kbd className="inline-flex rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
                      {method.keyboard_shortcut.replace("Ctrl+", "^")}
                    </kbd>
                  ) : null}
                </span>
              )}
            </button>
          ))}
          {paymentMethods.length === 0 ? (
            <div className="col-span-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">No active payment methods found.</div>
          ) : null}
        </div>

        <div className="mt-4 rounded-md border border-border bg-slate-50 p-2 text-xs text-slate-600">
          Offline queue: pending {queueCounts.pending} | syncing {queueCounts.syncing} | failed {queueCounts.failed}
          <div className="mt-1">Offline bills sync after sign-in and internet restore. PDF/print is available after sync.</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            Shortcuts:
            <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[11px]">Ctrl+H</kbd> hold
            <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[11px]">Ctrl+N</kbd> new bill
            <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[11px]">Ctrl+P</kbd> print preview
          </div>
        </div>

        {status ? (
          <div className={`mt-3 rounded-md border px-3 py-2 text-sm ${statusTone === "green" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : statusTone === "amber" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-red-200 bg-red-50 text-red-800"}`}>{status}</div>
        ) : null}

        {lastBill ? (
          <section className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-sm font-semibold text-emerald-950">Bill ready</div>
            <div className="mt-1 text-xs text-emerald-800">{lastBill.invoiceNumber} | {lastBill.paymentMode} | ₹{lastBill.grandTotal.toFixed(2)}</div>
            <button className="mt-3 h-9 w-full rounded-md border border-emerald-300 bg-white text-sm font-medium text-emerald-900" onClick={() => openInvoicePdfPreview(lastBill)}>
              Print preview
            </button>
          </section>
        ) : null}

        {selectedCustomer && deliveryRequired ? (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 p-2 text-xs text-sky-800">
            <Truck className="size-4" aria-hidden="true" />
            {isEditMode ? "Delivery stays linked to this invoice." : "Delivery will be created after invoice confirmation."}
          </div>
        ) : null}
      </aside>

      {showPasteOrder ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <section className="w-full max-w-2xl rounded-md border border-border bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-border p-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                  <MessageCircle className="size-4 text-emerald-700" aria-hidden="true" />
                  Paste WhatsApp order
                </div>
                <div className="mt-1 text-xs text-slate-500">Creates an unconfirmed draft invoice for review.</div>
              </div>
              <button className="inline-flex size-9 items-center justify-center rounded-md hover:bg-slate-100" onClick={() => setShowPasteOrder(false)}>
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div className="grid gap-3 p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block text-sm font-medium text-slate-700">
                  Customer phone
                  <input value={pasteOrderPhone} onChange={(event) => setPasteOrderPhone(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" placeholder="9876543210" />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Customer name
                  <input value={pasteOrderName} onChange={(event) => setPasteOrderName(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border px-3 text-sm" placeholder="Optional" />
                </label>
              </div>
              <label className="block text-sm font-medium text-slate-700">
                Order message
                <textarea
                  value={pasteOrderText}
                  onChange={(event) => setPasteOrderText(event.target.value)}
                  className="mt-1 min-h-40 w-full rounded-md border border-border px-3 py-2 text-sm"
                  placeholder={"Groundnut Oil 500ML x 2\nSunflower Oil 1L qty 1\nAddress: ..."}
                />
              </label>
              {pasteOrderReviewLines.length > 0 ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <div className="mb-1 font-semibold">Needs review</div>
                  {pasteOrderReviewLines.map((line) => (
                    <div key={`${line.line}-${line.reason}`}>{line.line} - {line.reason}</div>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-border p-4">
              <button className="h-10 rounded-md border border-border px-4 text-sm font-medium text-slate-700" onClick={() => setShowPasteOrder(false)}>Cancel</button>
              <button
                className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
                disabled={isPastingOrder || !pasteOrderPhone.trim() || !pasteOrderText.trim()}
                onClick={() => void submitPastedWhatsappOrder()}
              >
                <ClipboardPaste className="size-4" aria-hidden="true" />
                {isPastingOrder ? "Creating..." : "Create draft"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {lastBill ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 print:static print:bg-white print:p-0">
          <section className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-md border border-border bg-white shadow-xl print:max-h-none print:max-w-none print:border-0 print:shadow-none">
            <div className="flex items-start justify-between gap-4 border-b border-border p-4 print:hidden">
              <div>
                <div className="text-sm font-semibold text-slate-950">Invoice preview</div>
                <div className="text-xs text-slate-500">{lastBill.invoiceNumber} | {lastBill.paymentMode}</div>
              </div>
              <button className="inline-flex size-9 items-center justify-center rounded-md hover:bg-slate-100" onClick={dismissBillPreview}>
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-bold text-slate-950">RetailOS Invoice</div>
                  <div className="text-sm text-slate-500">{lastBill.invoiceNumber}</div>
                  {lastBill.customer ? <div className="mt-2 text-sm text-slate-700">{lastBill.customer.name} | {lastBill.customer.phone}</div> : null}
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase text-slate-500">Grand total</div>
                  <div className="text-2xl font-bold text-slate-950">₹{lastBill.grandTotal.toFixed(2)}</div>
                </div>
              </div>
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead className="border-y border-border bg-slate-50 text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-2 py-2 font-medium">Product</th>
                      <th className="px-2 py-2 text-right font-medium">Qty</th>
                      <th className="px-2 py-2 text-right font-medium">Rate</th>
                      <th className="px-2 py-2 text-right font-medium">Disc %</th>
                      {gstEnabled ? <th className="px-2 py-2 text-right font-medium">GST</th> : null}
                      <th className="px-2 py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lastBill.lines.map((line, index) => (
                      <tr key={`${line.productName}-${String(index)}`} className="border-b border-border">
                        <td className="px-2 py-2">{line.productName}</td>
                        <td className="px-2 py-2 text-right">{line.quantity}</td>
                        <td className="px-2 py-2 text-right">₹{line.sellingPrice.toFixed(2)}</td>
                        <td className="px-2 py-2 text-right">{line.discount}%</td>
                        {gstEnabled ? <td className="px-2 py-2 text-right">{line.gstRate}%</td> : null}
                        <td className="px-2 py-2 text-right font-semibold">₹{line.total.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="ml-auto mt-5 grid max-w-sm gap-2 text-sm">
                <SummaryRow label="Subtotal" value={lastBill.subtotal} />
                <SummaryRow label="Line discount" value={-lastBill.lineDiscount} />
                <SummaryRow label="Bill discount" value={-lastBill.billLevelDiscount} />
                {lastBill.deliveryCharge > 0 ? <SummaryRow label="Delivery charge" value={lastBill.deliveryCharge} /> : null}
                {gstEnabled ? <SummaryRow label="CGST" value={lastBill.cgst} /> : null}
                {gstEnabled ? <SummaryRow label="SGST" value={lastBill.sgst} /> : null}
                <div className="flex justify-between border-t border-border pt-2 text-base font-bold"><span>Total</span><span>₹{lastBill.grandTotal.toFixed(2)}</span></div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-border p-4 print:hidden">
              <button className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-medium text-white" onClick={() => openInvoicePdfPreview(lastBill)}>
                <Printer className="size-4" aria-hidden="true" />
                Print preview
              </button>
              <button className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 text-sm font-medium text-amber-900" onClick={() => void printThermalInvoice()}>
                <Printer className="size-4" aria-hidden="true" />
                Thermal
              </button>
              <button className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 text-sm font-medium text-emerald-900" onClick={() => void downloadInvoicePdf(lastBill.id, lastBill.invoiceNumber)}>
                <Download className="size-4" aria-hidden="true" />
                PDF
              </button>
              {lastBill.customer ? (
                <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-green-300 bg-green-50 px-3 text-sm font-medium text-green-800" onClick={shareWhatsApp}>
                  <MessageCircle className="size-4" aria-hidden="true" />
                  Send WhatsApp
                </button>
              ) : null}
              <button className="h-10 rounded-md border border-border px-4 text-sm font-medium text-slate-700" onClick={dismissBillPreview}>New bill</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function SummaryRow({ label, value }: Readonly<{ label: string; value: number }>) {
  const prefix = value < 0 ? "-₹" : "₹";
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span>{prefix}{Math.abs(value).toFixed(2)}</span>
    </div>
  );
}

function SummaryTextRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span>{value}</span>
    </div>
  );
}

interface ProductSearchTerm {
  value: string;
  tokens: string[];
  trailingSpace: boolean;
}

function buildProductSearchTerm(input: string): ProductSearchTerm {
  const value = normalizeProductSearchText(input);
  return {
    value,
    tokens: value ? value.split(" ") : [],
    trailingSpace: /\s$/.test(input),
  };
}

function normalizeProductSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function productNameParts(product: ProductRecord) {
  const normalizedName = normalizeProductSearchText(product.name);
  return {
    normalizedName,
    words: normalizedName ? normalizedName.split(" ") : [],
  };
}

function matchesProductSearch(product: ProductRecord, search: ProductSearchTerm, mode: ProductSearchMode): boolean {
  const { normalizedName, words } = productNameParts(product);
  const sku = normalizeProductSearchText(product.sku ?? "");
  const barcode = normalizeProductSearchText(product.barcode ?? "");
  const term = search.value;

  if (mode === "BARCODE") {
    return barcode.includes(term);
  }

  if (mode === "SKU") {
    return sku.includes(term);
  }

  if (mode === "AUTO") {
    return productNameMatches(normalizedName, words, search) || sku.includes(term) || barcode.includes(term);
  }

  return productNameMatches(normalizedName, words, search);
}

function exactProductIdentifierMatch(product: ProductRecord, term: string): boolean {
  return (product.barcode ?? "").trim().toLowerCase() === term || (product.sku ?? "").trim().toLowerCase() === term;
}

function productNameMatches(normalizedName: string, words: string[], search: ProductSearchTerm): boolean {
  if (!search.value) return false;
  if (search.trailingSpace && search.tokens.length === 1) {
    return words.includes(search.value);
  }
  if (normalizedName.includes(search.value)) return true;
  return wordsContainOrderedPrefixes(words, search.tokens);
}

function wordsContainOrderedPrefixes(words: string[], tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  let wordIndex = 0;
  for (const token of tokens) {
    const matchIndex = words.findIndex((word, index) => index >= wordIndex && word.startsWith(token));
    if (matchIndex === -1) return false;
    wordIndex = matchIndex + 1;
  }
  return true;
}

function productMatchRank(product: ProductRecord, search: ProductSearchTerm): number {
  const { normalizedName, words } = productNameParts(product);
  const sku = normalizeProductSearchText(product.sku ?? "");
  const barcode = normalizeProductSearchText(product.barcode ?? "");
  const term = search.value;
  const firstWord = words[0] ?? "";

  if (barcode === term) return 0;
  if (sku === term) return 1;
  if (normalizedName === term) return 2;
  if (search.trailingSpace && firstWord === term) return 3;
  if (firstWord === term) return 4;
  if (barcode.startsWith(term)) return 5;
  if (sku.startsWith(term)) return 6;
  if (firstWord.startsWith(term)) return 7;
  if (words.includes(term)) return 8;
  if (words.some((word) => word.startsWith(term))) return 9;
  if (normalizedName.includes(term)) return 10;
  return 11;
}

function productMatchLabel(product: ProductRecord, input: string, mode: ProductSearchMode): string {
  const term = buildProductSearchTerm(input).value;
  const sku = normalizeProductSearchText(product.sku ?? "");
  const barcode = normalizeProductSearchText(product.barcode ?? "");
  const { normalizedName } = productNameParts(product);

  if (barcode && barcode.includes(term)) return "Barcode";
  if (sku && sku.includes(term)) return "SKU";
  if (normalizedName.includes(term)) return "Name";
  return PRODUCT_SEARCH_MODES.find((item) => item.value === mode)?.label ?? "Match";
}

function productSearchPrice(product: ProductRecord): string {
  return `₹${decimalToNumber(product.sellingPrice).toFixed(2)}`;
}

function productSearchIdentifier(product: ProductRecord): string {
  const barcode = product.barcode?.trim();
  if (barcode) return `Barcode ${barcode}`;

  const sku = product.sku?.trim();
  if (sku) return `SKU ${sku}`;

  return "No barcode";
}

function productSearchImageSrc(product: ProductRecord): string | null {
  if (!product.imageUrl) {
    return null;
  }

  return `${apiUrl(`/inventory/products/${product.id}/image`)}?v=${encodeURIComponent(product.imageUrl)}`;
}

function productSearchPlaceholder(mode: ProductSearchMode): string {
  if (mode === "BARCODE") return "Scan or type barcode + Enter";
  if (mode === "SKU") return "Scan or type SKU + Enter";
  if (mode === "AUTO") return "Scan barcode/SKU, or type product name + Enter";
  return "Type product name, or scan exact barcode/SKU + Enter";
}

function mergeProducts(...groups: ProductRecord[][]): ProductRecord[] {
  const byId = new Map<string, ProductRecord>();
  for (const group of groups) {
    for (const product of group) {
      byId.set(product.id, product);
    }
  }
  return [...byId.values()];
}

function withoutRecordKey<T>(record: Record<string, T>, keyToRemove: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== keyToRemove));
}

function normalizeBillingQuantity(value: string, fallback = 1): number {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) return fallback > 0 ? fallback : 1;
  return quantity;
}

function formatQuantityInput(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function lineTotal(line: { quantity: number; sellingPrice: number; discount: number; gstRate: number }, gstEnabled = true): number {
  const gross = line.quantity * line.sellingPrice;
  const discountAmount = Math.min(gross, gross * (line.discount / 100));
  const taxable = Math.max(gross - discountAmount, 0);
  const gst = gstEnabled ? taxable * (line.gstRate / 100) : 0;
  return roundMoney(taxable + gst);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function allocateBillDiscountShares(lineTaxableBases: number[], billDiscount: number): number[] {
  const cappedDiscount = roundMoney(Math.max(billDiscount, 0));
  const totalTaxableBase = lineTaxableBases.reduce((sum, value) => sum + Math.max(value, 0), 0);
  if (cappedDiscount <= 0 || totalTaxableBase <= 0) {
    return lineTaxableBases.map(() => 0);
  }

  let allocated = 0;
  const lastDiscountableIndex = findLastDiscountableIndex(lineTaxableBases);

  return lineTaxableBases.map((lineTaxableBase, index) => {
    if (lineTaxableBase <= 0) {
      return 0;
    }

    const remaining = roundMoney(cappedDiscount - allocated);
    if (remaining <= 0) {
      return 0;
    }

    if (index === lastDiscountableIndex) {
      return Math.min(remaining, roundMoney(lineTaxableBase));
    }

    const share = Math.min(roundMoney(cappedDiscount * (lineTaxableBase / totalTaxableBase)), roundMoney(lineTaxableBase), remaining);
    allocated = roundMoney(allocated + share);
    return share;
  });
}

function findLastDiscountableIndex(values: number[]): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if ((values[index] ?? 0) > 0) {
      return index;
    }
  }

  return -1;
}

function decimalToNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

function decimalToNumberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return decimalToNumber(value);
}

function toDateTimeLocalInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function toIsoDateTime(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function coercePaymentMode(value: string): PaymentMode {
  return PAYMENT_MODES.includes(value as PaymentMode) ? value as PaymentMode : "CASH";
}

function paymentMethodToMode(method: PaymentMethodRecord): PaymentMode {
  const code = method.short_code === "CRED" ? "CREDIT" : method.short_code;
  if (PAYMENT_MODES.includes(code as PaymentMode)) return code as PaymentMode;
  if (method.type === "upi") return "UPI";
  if (method.type === "card") return "CARD";
  if (method.type === "credit") return "CREDIT";
  return "CASH";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeCustomer(customer: CustomerApiRecord | CustomerRecord): CustomerRecord {
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    address: customer.address ?? null,
    creditLimit: decimalToNumberOrNull(customer.creditLimit),
    outstandingDue: decimalToNumberOrNull(customer.outstandingDue),
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getVerticalNumber(value: unknown, key: string): number | null {
  const entry = toRecord(value)[key];
  if (typeof entry === "number" && Number.isFinite(entry)) return entry;
  if (typeof entry === "string" && entry.trim() && Number.isFinite(Number(entry))) return Number(entry);
  return null;
}

function getVerticalString(value: unknown, key: string): string | null {
  const entry = toRecord(value)[key];
  return typeof entry === "string" && entry.trim() ? entry : null;
}

function deriveLineDiscountPercent(item: InvoiceLineRecord, billDiscountAmount: number, allItems: InvoiceLineRecord[]): number {
  const gross = decimalToNumber(item.sellingPrice) * decimalToNumber(item.quantity);
  if (gross <= 0) return 0;

  const totalTaxableBeforeBillDiscount = allItems.reduce((sum, line) => {
    const lineGross = decimalToNumber(line.sellingPrice) * decimalToNumber(line.quantity);
    const lineDiscount = Math.min(lineGross, decimalToNumber(line.discount));
    return sum + Math.max(lineGross - lineDiscount, 0);
  }, 0);
  const taxableBeforeBillDiscount = Math.max(gross - decimalToNumber(item.discount), 0);
  const estimatedBillShare = totalTaxableBeforeBillDiscount > 0 ? billDiscountAmount * (taxableBeforeBillDiscount / totalTaxableBeforeBillDiscount) : 0;
  const lineDiscountAmount = Math.max(decimalToNumber(item.discount) - estimatedBillShare, 0);
  return Math.min(roundMoney((lineDiscountAmount / gross) * 100), 100);
}

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("failed to fetch") || message.includes("networkerror") || message.includes("load failed");
}
