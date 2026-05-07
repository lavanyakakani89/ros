"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookMarked, Download, MessageCircle, Pause, Printer, Receipt, RefreshCcw, Search, Trash2, Truck, UserPlus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { apiUrl, createAuthenticatedApiClient, downloadApiFile, listProducts, refreshAuthSession } from "@/lib/api-client";
import type { ProductRecord } from "@/lib/api-client";
import type { InvoiceRecord } from "@/components/billing/invoice-history";
import { useBillingStore } from "@/lib/billing-store";
import { printViaLocalAgent } from "@/lib/local-print-agent";
import { getPendingInvoiceCounts, queueInvoice, syncPendingInvoices } from "@/lib/offline-queue";
import { getStoredTenant, hasStoredAuthSession, storeAuthSession } from "@/lib/vertical-config";

const PAYMENT_SHORTCUTS = [
  { mode: "CASH", key: "1", displayKey: "Ctrl+1", label: "Cash" },
  { mode: "UPI", key: "2", displayKey: "Ctrl+2", label: "UPI" },
  { mode: "CARD", key: "3", displayKey: "Ctrl+3", label: "Card" },
  { mode: "CREDIT", key: "4", displayKey: "Ctrl+4", label: "Credit" },
] as const;
const PAYMENT_MODES = ["CASH", "UPI", "CARD", "CREDIT", "NETBANKING"] as const;
const PRODUCT_SEARCH_MODES = [
  { value: "AUTO", label: "Auto" },
  { value: "NAME", label: "Product name" },
  { value: "BARCODE", label: "Barcode" },
  { value: "SKU", label: "SKU" },
] as const;
type PaymentMode = (typeof PAYMENT_MODES)[number];
type ProductSearchMode = (typeof PRODUCT_SEARCH_MODES)[number]["value"];
type PrinterConnectionType = "NONE" | "NETWORK" | "USB_PRINTNODE" | "BLUETOOTH" | "LOCAL_AGENT";
type InvoiceLineRecord = NonNullable<InvoiceRecord["items"]>[number];

interface SplitEntry {
  mode: PaymentMode;
  amount: number;
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

interface LastBill {
  id: string;
  invoiceNumber: string;
  grandTotal: number;
  subtotal: number;
  lineDiscount: number;
  billLevelDiscount: number;
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

interface PosInvoicePanelProps {
  editingInvoice?: InvoiceRecord | null;
  onEditComplete?: () => void;
}

export function PosInvoicePanel({ editingInvoice = null, onEditComplete }: PosInvoicePanelProps) {
  const queryClient = useQueryClient();
  const { lines, setLines, setLine, addLine, removeLine, reset, holdBill, restoreHeld, deleteHeld, heldBills } = useBillingStore();
  const barcodeRef = useRef<HTMLInputElement>(null);
  const isEditMode = Boolean(editingInvoice);
  const [online, setOnline] = useState(true);
  const [gstEnabled, setGstEnabled] = useState(true);
  const [queueCounts, setQueueCounts] = useState({ pending: 0, syncing: 0, failed: 0 });
  const [status, setStatus] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"green" | "red">("green");
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
  const [amountReceived, setAmountReceived] = useState(0);
  const [appliedCoupon, setAppliedCoupon] = useState("");
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponInput, setCouponInput] = useState("");
  const [loyaltyRedeem, setLoyaltyRedeem] = useState(0);
  const [loyaltyBalance, setLoyaltyBalance] = useState<number | null>(null);
  const [showHeld, setShowHeld] = useState(false);
  const [notes, setNotes] = useState("");
  const [deliveryRequired, setDeliveryRequired] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [lastBill, setLastBill] = useState<LastBill | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const productsQuery = useQuery({
    queryKey: ["products", "billing"],
    queryFn: () => listProducts(),
  });
  const customersQuery = useQuery({
    queryKey: ["customers", "billing", customerSearch],
    queryFn: () =>
      createAuthenticatedApiClient().get<{ data: CustomerApiRecord[] }>(
        `/customers?limit=20${customerSearch ? `&search=${encodeURIComponent(customerSearch)}` : ""}`,
      ),
  });
  const printerQuery = useQuery({
    queryKey: ["printer", "billing"],
    queryFn: () => createAuthenticatedApiClient().get<PrinterResponse>("/printer"),
  });
  const products = productsQuery.data?.data ?? [];
  const customerResults = useMemo(
    () => (customersQuery.data?.data ?? []).map(normalizeCustomer),
    [customersQuery.data?.data],
  );
  const visibleCustomerResults = customerSearch && !selectedCustomer ? customerResults.slice(0, 4) : [];
  const productResults = useMemo(() => {
    const term = barcodeInput.trim().toLowerCase();
    if (!term) return [];
    return products
      .filter((product) => matchesProductSearch(product, term, productSearchMode))
      .sort((left, right) => productMatchRank(left, term) - productMatchRank(right, term))
      .slice(0, 6);
  }, [barcodeInput, productSearchMode, products]);

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
    const billLevelDiscount = Math.min(Math.max(billDiscount, 0) + couponDiscount + loyaltyRedeem, totalTaxable);
    const taxTotals = itemTotals.reduce(
      (accumulator, item) => {
        const share = totalTaxable > 0 ? roundMoney(billLevelDiscount * (item.taxable / totalTaxable)) : 0;
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
    const grandTotal = taxTotals.grandTotal;
    return { subtotal, lineDiscount, billLevelDiscount, discount: lineDiscount + billLevelDiscount, cgst, sgst, grandTotal };
  }, [lines, billDiscount, couponDiscount, loyaltyRedeem, gstEnabled]);
  const changeDue = selectedPaymentMode === "CASH" && amountReceived > 0 ? amountReceived - totals.grandTotal : 0;

  useEffect(() => {
    setGstEnabled(getStoredTenant()?.gstEnabled ?? true);
    barcodeRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!selectedCustomer) {
      setLoyaltyBalance(null);
      setDeliveryRequired(false);
      setDeliveryAddress("");
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
    const couponCode = getVerticalString(editingInvoice.verticalData, "couponCode");
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
      const key = event.key.toLowerCase();
      const shortcut = PAYMENT_SHORTCUTS.find((item) => item.key === key);
      if (shortcut) {
        event.preventDefault();
        void confirmInvoice(shortcut.mode);
        return;
      }
      if (key === "h") {
        event.preventDefault();
        if (isEditMode) {
          notify("Finish or cancel invoice editing before holding a bill.", "red");
          return;
        }
        holdBill(selectedCustomer?.id ?? "");
      }
      if (key === "n") {
        event.preventDefault();
        clearBill();
      }
      if (key === "p" && lastBill) {
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

  function notify(message: string, tone: "green" | "red" = "green") {
    setStatus(message);
    setStatusTone(tone);
  }

  function insertProduct(product: ProductRecord) {
    const existing = lines.find((line) => line.productId === product.id);
    if (existing) {
      setLine(existing.id, { quantity: existing.quantity + 1 });
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
    const code = barcodeInput.trim();
    const codeLower = code.toLowerCase();
    const exactProduct = products.find((item) => exactProductIdentifierMatch(item, codeLower));
    const product = exactProduct ?? productResults[productHighlightIndex] ?? products.find((item) => item.name.toLowerCase().includes(codeLower));
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

  async function confirmInvoice(paymentModeOverride?: PaymentMode) {
    const activeLines = lines.filter((line) => line.productId);
    if (activeLines.length === 0) {
      notify("Add at least one product.", "red");
      return;
    }

    const paymentMode = paymentModeOverride ?? (useSplit ? splitEntries[0]?.mode ?? "CASH" : selectedPaymentMode);
    setSelectedPaymentMode(paymentMode);
    const customerId = selectedCustomer?.id;
    const deliveryPayload = deliveryRequired && selectedCustomer
      ? {
          customerId: selectedCustomer.id,
          deliveryAddress: deliveryAddress.trim() || selectedCustomer.address || "",
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

    const outOfStockLine = isEditMode ? undefined : activeLines.find((line) => {
      const product = products.find((item) => item.id === line.productId);
      return product ? line.quantity > decimalToNumber(product.currentStock) : false;
    });
    if (outOfStockLine) {
      notify(`${outOfStockLine.productName} does not have enough stock. Adjust stock or quantity before confirming.`, "red");
      return;
    }

    const billLevelDiscount = Math.min(totals.billLevelDiscount, totals.subtotal);
    const verticalData = {
      ...toRecord(editingInvoice?.verticalData),
      billDiscountAmount: billLevelDiscount,
      couponDiscount,
      loyaltyRedeem,
      ...(appliedCoupon ? { couponCode: appliedCoupon } : {}),
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
        await queueOfflineInvoice(invoicePayload, deliveryPayload, paymentMode);
        clearBill();
        return;
      }

      const hasSession = await ensureAuthenticatedSession();
      if (!hasSession) {
        notify("Session expired. Please sign in again before confirming this bill.", "red");
        return;
      }

      if (editingInvoice) {
        const updated = await createAuthenticatedApiClient().put<{ id: string; invoiceNumber: string; grandTotal: string | number }>(
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
          cgst: billSnapshot.cgst,
          sgst: billSnapshot.sgst,
          paymentMode,
          customer: billSnapshot.customer,
          lines: billSnapshot.lines,
          pdfViewUrl,
        };
        setLastBill(nextBill);
        await handleConfiguredInvoiceOutput(nextBill.id, nextBill.invoiceNumber, "Invoice updated");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["invoices"] }),
          queryClient.invalidateQueries({ queryKey: ["products"] }),
        ]);
        onEditComplete?.();
        return;
      }

      const created = await createAuthenticatedApiClient().post<{ id: string; invoiceNumber: string; grandTotal: string | number }>("/billing/invoices", invoicePayload);
      const confirmed = await createAuthenticatedApiClient().post<{ id: string; invoiceNumber: string; grandTotal: string | number }>(`/billing/invoices/${created.id}/confirm`, {});

      if (useSplit) {
        for (const entry of splitEntries.filter((item) => item.amount > 0)) {
          await createAuthenticatedApiClient().post("/payments", {
            invoiceId: created.id,
            amount: entry.amount,
            mode: entry.mode,
          });
        }
      } else if (paymentMode !== "CREDIT") {
        await createAuthenticatedApiClient().post("/payments", {
          invoiceId: created.id,
          amount: Number(confirmed.grandTotal),
          mode: paymentMode,
        });
      }

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
        cgst: billSnapshot.cgst,
        sgst: billSnapshot.sgst,
        paymentMode,
        customer: billSnapshot.customer,
        lines: billSnapshot.lines,
        pdfViewUrl,
      };
      setLastBill(nextBill);
      await handleConfiguredInvoiceOutput(nextBill.id, nextBill.invoiceNumber);
      await queryClient.invalidateQueries({ queryKey: ["invoices"] });
    } catch (error) {
      if (!isEditMode && isNetworkError(error)) {
        await queueOfflineInvoice(invoicePayload, deliveryPayload, paymentMode);
        clearBill();
        return;
      }

      notify(error instanceof Error ? error.message : isEditMode ? "Unable to update invoice." : "Unable to create invoice.", "red");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function queueOfflineInvoice(
    invoicePayload: object,
    deliveryPayload: { customerId: string; deliveryAddress: string; notes?: string } | undefined,
    paymentMode: PaymentMode,
  ) {
    await queueInvoice(
      {
        invoice: invoicePayload,
        ...(deliveryPayload ? { delivery: deliveryPayload } : {}),
        autoPay: { mode: paymentMode },
      },
      getStoredTenant()?.slug ?? "local-tenant",
    );
    setQueueCounts(await getPendingInvoiceCounts());
    notify("Invoice saved offline. It will sync when internet and sign-in are available.");
  }

  async function shareWhatsApp() {
    if (!lastBill?.customer) return;
    try {
      await createAuthenticatedApiClient().post(`/billing/invoices/${lastBill.id}/share`, { channel: "whatsapp" });
      notify("Invoice sent via WhatsApp.");
    } catch {
      notify("WhatsApp share failed.", "red");
    }
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

  async function handleConfiguredInvoiceOutput(invoiceId: string, invoiceNumber: string, actionLabel = "Invoice confirmed") {
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
        return;
      }

      const result = await createAuthenticatedApiClient().post<PrinterResult>(`/billing/invoices/${invoiceId}/print`, {});
      const handled = await handlePrinterResult(result, actionLabel, invoiceNumber);
      if (handled) {
        return;
      }

      await downloadInvoicePdf(invoiceId, invoiceNumber);
      notify(`${result.message || "Printer not available."} PDF downloaded instead.`);
    } catch (error) {
      notify(`${actionLabel}. Output failed: ${error instanceof Error ? error.message : "PDF or printer failed."}`, "red");
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
    setSplitEntries([{ mode: "CASH", amount: 0 }]);
    setUseSplit(false);
    setAmountReceived(0);
    setSelectedPaymentMode("CASH");
    setLastBill(null);
    onEditComplete?.();
    barcodeRef.current?.focus();
  }

  function dismissBillPreview() {
    setLastBill(null);
    clearBill();
  }

  function splitTotal(): number {
    return splitEntries.reduce((sum, entry) => sum + entry.amount, 0);
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
            {heldBills.length > 0 ? (
              <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-slate-700" onClick={() => setShowHeld((value) => !value)}>
                <BookMarked className="size-4" aria-hidden="true" />
                Held ({heldBills.length})
              </button>
            ) : null}
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-amber-700 disabled:opacity-50" onClick={() => holdBill(selectedCustomer?.id ?? "")} disabled={lines.length === 0 || isEditMode}>
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
                  <button className="text-xs font-medium text-emerald-700" onClick={() => { restoreHeld(bill.id); setShowHeld(false); }}>Restore</button>
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
              {customerSearch && !selectedCustomer
                ? visibleCustomerResults.map((customer, index) => (
                    <button
                      key={customer.id}
                      className={`rounded-md border px-2 py-1 text-left text-xs ${index === customerHighlightIndex ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
                      onClick={() => selectCustomer(customer)}
                    >
                      {customer.name} | {customer.phone}
                    </button>
                  ))
                : null}
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
              <div className="mt-2 grid gap-1">
                {productResults.length > 0 ? productResults.map((product, index) => (
                  <button
                    key={product.id}
                    className={`rounded-md border px-2 py-1 text-left text-xs ${index === productHighlightIndex ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
                    onClick={() => {
                      insertProduct(product);
                      setBarcodeInput("");
                    }}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">
                        {product.name} <span className="text-slate-400">| Stock {decimalToNumber(product.currentStock).toFixed(3)}</span>
                      </span>
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
                        {productMatchLabel(product, barcodeInput, productSearchMode)}
                      </span>
                    </span>
                  </button>
                )) : <div className="rounded-md border border-red-100 bg-red-50 px-2 py-1 text-xs text-red-700">No matching product</div>}
              </div>
            ) : (
              <div className="mt-2 text-xs text-slate-500">{productsQuery.isLoading ? "Loading products..." : "Scan or search to add products."}</div>
            )}
          </div>
        </div>

        {selectedCustomer && (selectedCustomer.outstandingDue ?? 0) > 0 ? (
          <div className="border-b border-border bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Outstanding due: ₹{(selectedCustomer.outstandingDue ?? 0).toFixed(2)}
            {selectedCustomer.creditLimit ? ` | Credit limit: ₹${selectedCustomer.creditLimit.toFixed(2)}` : ""}
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-3 font-medium">Product</th>
                <th className="px-3 py-3 font-medium">Qty</th>
                <th className="px-3 py-3 font-medium">Rate</th>
                <th className="px-3 py-3 font-medium">Discount %</th>
                {gstEnabled ? <th className="px-3 py-3 font-medium">GST%</th> : null}
                <th className="px-3 py-3 text-right font-medium">Total</th>
                <th className="px-3 py-3" />
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
                const total = lineTotal(line, gstEnabled);
                const aboveMrp = mrp !== null && line.sellingPrice > mrp;
                return (
                  <tr key={line.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-900">{line.productName}</div>
                      {stock !== null ? <span className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-[11px] ${stockTone}`}>Stock {stock.toFixed(3)}</span> : null}
                      {aboveMrp ? <div className="mt-1 text-xs font-semibold text-red-700">Selling price above MRP ₹{mrp.toFixed(2)}</div> : null}
                    </td>
                    <td className="px-3 py-2"><input className="h-9 w-20 rounded-md border border-border px-2" type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => setLine(line.id, { quantity: Number(event.target.value) })} /></td>
                    <td className="px-3 py-2"><input className="h-9 w-24 rounded-md border border-border px-2" type="number" min="0" value={line.sellingPrice} onChange={(event) => setLine(line.id, { sellingPrice: Number(event.target.value) })} /></td>
                    <td className="px-3 py-2"><input className="h-9 w-24 rounded-md border border-border px-2" type="number" min="0" max="100" value={line.discount} onChange={(event) => setLine(line.id, { discount: Math.min(Math.max(Number(event.target.value), 0), 100) })} /></td>
                    {gstEnabled ? <td className="px-3 py-2 text-slate-500">{line.gstRate}%</td> : null}
                    <td className="px-3 py-2 text-right font-semibold">₹{total.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">
                      <button className="inline-flex size-9 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100" onClick={() => removeLine(line.id)}>
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
          </div>
        ) : null}
      </div>

      <aside className="rounded-md border border-border bg-white p-4">
        <div className="text-sm font-semibold text-slate-950">Bill summary</div>
        <div className="mt-4 grid gap-2 text-sm">
          <SummaryRow label="Subtotal" value={totals.subtotal} />
          <SummaryRow label="Line discount" value={-totals.lineDiscount} />
          <SummaryRow label="Bill discount" value={-totals.billLevelDiscount} />
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
              <div key={`${entry.mode}-${String(index)}`} className="flex items-center gap-2">
                <select value={entry.mode} onChange={(event) => setSplitEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, mode: event.target.value as PaymentMode } : item))} className="h-9 flex-1 rounded-md border border-border px-2 text-sm">
                  {PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                </select>
                <input type="number" min="0" value={entry.amount} onChange={(event) => setSplitEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, amount: Number(event.target.value) } : item))} className="h-9 w-28 rounded-md border border-border px-2 text-sm" />
                {index > 0 ? <button className="text-sm text-red-600" onClick={() => setSplitEntries((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button> : null}
              </div>
            ))}
            <button className="text-left text-sm font-medium text-emerald-700" onClick={() => setSplitEntries((current) => [...current, { mode: "CASH", amount: 0 }])}>Add payment mode</button>
            {Math.abs(splitTotal() - totals.grandTotal) > 0.01 ? (
              <div className="text-xs text-amber-600">Split total ₹{splitTotal().toFixed(2)} | Remaining ₹{(totals.grandTotal - splitTotal()).toFixed(2)}</div>
            ) : null}
          </div>
        ) : null}

        {!useSplit ? (
          <div className="mt-4 grid gap-2 rounded-md border border-border bg-slate-50 p-3">
            <div className="text-xs font-semibold text-slate-600">Selected payment: {selectedPaymentMode}</div>
            <label className="block text-sm font-medium text-slate-700">
              Cash received
              <input type="number" min="0" value={amountReceived} onChange={(event) => {
                setSelectedPaymentMode("CASH");
                setAmountReceived(Number(event.target.value));
              }} className="mt-1 h-9 w-full rounded-md border border-border px-3 text-sm" />
            </label>
            {amountReceived > 0 ? (
              <div className={`text-xs font-semibold ${changeDue >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                {changeDue >= 0 ? "Change" : "Short"} ₹{Math.abs(changeDue).toFixed(2)}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-2">
          {PAYMENT_SHORTCUTS.map((shortcut) => (
            <button key={shortcut.mode} className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-left text-sm font-semibold text-emerald-900 disabled:opacity-50" onClick={() => void confirmInvoice(shortcut.mode)} disabled={isSubmitting || lines.length === 0}>
              <span className="block">{isEditMode ? `Save ${shortcut.label}` : shortcut.label}</span>
              <span className="text-xs font-medium text-emerald-700">{shortcut.displayKey}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 rounded-md border border-border bg-slate-50 p-2 text-xs text-slate-600">
          Network: {online ? "online" : "offline"} | Offline queue: pending {queueCounts.pending} | syncing {queueCounts.syncing} | failed {queueCounts.failed}
          <div className="mt-1">Offline bills sync after sign-in and internet restore. PDF/print is available after sync.</div>
          <div className="mt-1">Shortcuts: Ctrl+H hold | Ctrl+N new bill | Ctrl+P print preview</div>
        </div>

        {status ? (
          <div className={`mt-3 rounded-md border px-3 py-2 text-sm ${statusTone === "green" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>{status}</div>
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
                <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-green-300 bg-green-50 px-3 text-sm font-medium text-green-800" onClick={() => void shareWhatsApp()}>
                  <MessageCircle className="size-4" aria-hidden="true" />
                  WA
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

function matchesProductSearch(product: ProductRecord, term: string, mode: ProductSearchMode): boolean {
  const name = product.name.toLowerCase();
  const sku = (product.sku ?? "").toLowerCase();
  const barcode = (product.barcode ?? "").toLowerCase();

  if (mode === "BARCODE") {
    return barcode.includes(term);
  }

  if (mode === "SKU") {
    return sku.includes(term);
  }

  if (mode === "AUTO") {
    return name.includes(term) || sku.includes(term) || barcode.includes(term);
  }

  return name.includes(term);
}

function exactProductIdentifierMatch(product: ProductRecord, term: string): boolean {
  return (product.barcode ?? "").trim().toLowerCase() === term || (product.sku ?? "").trim().toLowerCase() === term;
}

function productMatchRank(product: ProductRecord, term: string): number {
  const name = product.name.toLowerCase();
  const sku = (product.sku ?? "").toLowerCase();
  const barcode = (product.barcode ?? "").toLowerCase();

  if (barcode === term) return 0;
  if (sku === term) return 1;
  if (name === term) return 2;
  if (barcode.startsWith(term)) return 3;
  if (sku.startsWith(term)) return 4;
  if (name.startsWith(term)) return 5;
  return 6;
}

function productMatchLabel(product: ProductRecord, input: string, mode: ProductSearchMode): string {
  const term = input.trim().toLowerCase();
  const sku = (product.sku ?? "").toLowerCase();
  const barcode = (product.barcode ?? "").toLowerCase();
  const name = product.name.toLowerCase();

  if (barcode && barcode.includes(term)) return "Barcode";
  if (sku && sku.includes(term)) return "SKU";
  if (name.includes(term)) return "Name";
  return PRODUCT_SEARCH_MODES.find((item) => item.value === mode)?.label ?? "Match";
}

function productSearchPlaceholder(mode: ProductSearchMode): string {
  if (mode === "BARCODE") return "Scan or type barcode + Enter";
  if (mode === "SKU") return "Scan or type SKU + Enter";
  if (mode === "AUTO") return "Scan barcode/SKU, or type product name + Enter";
  return "Type product name, or scan exact barcode/SKU + Enter";
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

function decimalToNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

function decimalToNumberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return decimalToNumber(value);
}

function coercePaymentMode(value: string): PaymentMode {
  return PAYMENT_MODES.includes(value as PaymentMode) ? value as PaymentMode : "CASH";
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
