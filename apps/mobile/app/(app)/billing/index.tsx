import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { ApiError, calculateBillTotals, calculateLineTotal, createInvoiceSchema, formatCurrency, useBillingStore } from "@bizbil/shared";

import { BarcodeScanner } from "@/components/billing/BarcodeScanner";
import { BillPreviewBottomSheet } from "@/components/billing/BillPreviewBottomSheet";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { apiClient } from "@/lib/api-client";
import { queueInvoice } from "@/lib/offline-queue";
import { useAuthStore } from "@/stores/auth-store";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";
import { type BillingProduct, useBillingProducts, useFilteredBillingProducts } from "@/hooks/useBillingProducts";

interface Customer {
  id: string;
  name: string;
  phone: string;
  outstandingDue?: number;
}

export default function BillingScreen() {
  const { lines, heldBills, setLine, removeLine, reset, holdBill, addOrIncrementLine } = useBillingStore();
  const tenant = useAuthStore((state) => state.tenant);
  const user = useAuthStore((state) => state.user);
  const { data: products = [] } = useBillingProducts();
  const [productSearch, setProductSearch] = useState("");
  const filteredProducts = useFilteredBillingProducts(productSearch, products);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [paymentMode, setPaymentMode] = useState<"CASH" | "UPI" | "CARD" | "CREDIT">("CASH");
  const [billDiscount, setBillDiscount] = useState("0");
  const [amountReceived, setAmountReceived] = useState("");
  const [confirmedInvoice, setConfirmedInvoice] = useState<any>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!customerSearch.trim()) {
        setCustomers([]);
        return;
      }
      void apiClient.get<{ data: Customer[] }>(`/api/customers?search=${encodeURIComponent(customerSearch)}`).then((response) => setCustomers(response.data ?? [])).catch(() => setCustomers([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [customerSearch]);

  const totals = useMemo(() => calculateBillTotals(
    lines.filter((line) => line.productId).map((line) => ({
      qty: line.quantity,
      sellingPrice: line.sellingPrice,
      discountPct: line.discount,
      gstRate: line.gstRate,
    })),
    Number(billDiscount || 0),
    tenant?.gstEnabled ?? true,
  ), [billDiscount, lines, tenant?.gstEnabled]);

  const change = Math.max(0, Number(amountReceived || 0) - totals.grandTotal);

  function addProduct(product: BillingProduct) {
    const line = {
      productId: product.id,
      productName: product.name,
      quantity: 1,
      sellingPrice: Number(product.sellingPrice ?? 0),
      discount: 0,
      gstRate: Number(product.gstRate ?? 0),
      unit: product.unit ?? "piece",
      stock: Number(product.currentStock ?? 0),
    };
    addOrIncrementLine({
      ...line,
      ...(product.sku ? { sku: product.sku } : {}),
      ...(product.barcode ? { barcode: product.barcode } : {}),
    });
    setProductSearch("");
  }

  function handleScan(barcode: string) {
    const match = products.find((product) => String(product.barcode ?? "") === barcode || String(product.sku ?? "") === barcode);
    if (match) addProduct(match);
    setScannerVisible(false);
  }

  async function confirmBill() {
    const validLines = lines.filter((line) => line.productId);
    const outOfStock = validLines.find((line) => Number(line.stock ?? 1) <= 0);
    if (outOfStock && user?.role !== "OWNER" && user?.role !== "MANAGER") return;

    const payload = createInvoiceSchema.parse({
      customerId: customer?.id,
      paymentMode,
      billDiscount: Number(billDiscount || 0),
      items: validLines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        sellingPrice: line.sellingPrice,
        discountPercent: line.discount,
      })),
    });

    try {
      const invoice = await apiClient.post<any>("/api/billing/invoices", payload);
      setConfirmedInvoice({
        invoiceNumber: invoice.invoiceNumber ?? "Draft invoice",
        invoiceDate: invoice.invoiceDate ?? new Date().toISOString(),
        customer: customer ?? undefined,
        items: validLines.map((line) => ({ name: line.productName, quantity: line.quantity, price: line.sellingPrice, amount: calculateLineTotal(line.quantity, line.sellingPrice, line.discount, line.gstRate, tenant?.gstEnabled ?? true).total })),
        grandTotal: totals.grandTotal,
        paymentMode,
        totalCgst: totals.totalCgst,
        totalSgst: totals.totalSgst,
        discountAmount: totals.totalLineDiscount + totals.billDiscount,
      });
    } catch (error) {
      if (!(error instanceof ApiError)) {
        await queueInvoice(payload);
      }
    }
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Billing" subtitle="Scan, search, and confirm invoices" rightAction={<Badge label={`${heldBills.length} held`} color={heldBills.length > 0 ? "amber" : "gray"} />} />
      <View style={styles.top}>
        {customer ? (
          <Card style={styles.customerChip}>
            <Text style={styles.customerName}>{customer.name} | {customer.phone}</Text>
            <Pressable onPress={() => setCustomer(null)}><MaterialCommunityIcons name="close" size={18} color={colors.slateMid} /></Pressable>
            {Number(customer.outstandingDue ?? 0) > 0 ? <Text style={styles.warning}>Outstanding due {formatCurrency(Number(customer.outstandingDue))}</Text> : null}
          </Card>
        ) : (
          <View>
            <Input placeholder="Search customer" value={customerSearch} onChangeText={setCustomerSearch} />
            {customers.length > 0 ? (
              <Card style={styles.dropdown}>
                {customers.map((item) => (
                  <Pressable key={item.id} style={styles.resultRow} onPress={() => { setCustomer(item); setCustomerSearch(""); setCustomers([]); }}>
                    <Text style={styles.resultTitle}>{item.name}</Text>
                    <Text style={styles.resultMeta}>{item.phone} {Number(item.outstandingDue ?? 0) > 0 ? `| due ${formatCurrency(Number(item.outstandingDue))}` : ""}</Text>
                  </Pressable>
                ))}
                <Text style={styles.newCustomer}>New customer</Text>
              </Card>
            ) : null}
          </View>
        )}

        <View style={styles.scanRow}>
          <Pressable style={styles.scanButton} onPress={() => setScannerVisible(true)}><MaterialCommunityIcons name="camera" size={22} color={colors.white} /></Pressable>
          <TextInput
            placeholder="Search by name, SKU, barcode"
            value={productSearch}
            onChangeText={setProductSearch}
            onSubmitEditing={() => filteredProducts[0] && addProduct(filteredProducts[0])}
            style={styles.searchInput}
          />
        </View>
        {productSearch ? (
          <Card style={styles.dropdown}>
            {filteredProducts.slice(0, 5).map((product) => (
              <Pressable key={product.id} style={styles.resultRow} onPress={() => addProduct(product)}>
                <Text style={styles.resultTitle}>{product.name}</Text>
                <Text style={styles.resultMeta}>{product.sku ?? product.barcode ?? "No SKU"} | {formatCurrency(Number(product.sellingPrice ?? 0))}</Text>
              </Pressable>
            ))}
          </Card>
        ) : null}

        <FlatList
          data={lines.filter((line) => line.productId)}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<EmptyState icon="barcode-scan" title="Scan or search for a product to start billing" />}
          renderItem={({ item }) => {
            const total = calculateLineTotal(item.quantity, item.sellingPrice, item.discount, item.gstRate, tenant?.gstEnabled ?? true).total;
            return (
              <Card style={styles.lineCard}>
                <View style={styles.lineHeader}>
                  <View style={styles.lineCopy}><Text style={styles.productName}>{item.productName}</Text><Text style={styles.resultMeta}>{item.unit ?? "piece"}</Text></View>
                  <Pressable onPress={() => removeLine(item.id)}><MaterialCommunityIcons name="delete" size={22} color={colors.red} /></Pressable>
                </View>
                <View style={styles.lineControls}>
                  <Input keyboardType="numeric" value={String(item.quantity)} onChangeText={(value) => setLine(item.id, { quantity: Number(value || 0) })} />
                  <Input keyboardType="numeric" value={String(item.discount)} onChangeText={(value) => setLine(item.id, { discount: Number(value || 0) })} />
                  <Text style={styles.lineTotal}>{formatCurrency(total)}</Text>
                </View>
              </Card>
            );
          }}
        />
      </View>
      <ScrollView style={styles.summary} contentContainerStyle={styles.summaryContent}>
        <SummaryRow label="Subtotal" value={formatCurrency(totals.subtotal)} />
        <SummaryRow label="Line discounts" value={formatCurrency(totals.totalLineDiscount)} />
        <Input label="Bill discount" keyboardType="numeric" value={billDiscount} onChangeText={setBillDiscount} />
        {tenant?.gstEnabled !== false ? (
          <>
            <SummaryRow label="CGST" value={formatCurrency(totals.totalCgst)} />
            <SummaryRow label="SGST" value={formatCurrency(totals.totalSgst)} />
          </>
        ) : null}
        <Text style={styles.grandTotal}>{formatCurrency(totals.grandTotal)}</Text>
        <View style={styles.modeGrid}>
          {(["CASH", "UPI", "CARD", "CREDIT"] as const).map((mode, index) => (
            <Pressable key={mode} style={[styles.mode, paymentMode === mode && styles.modeSelected]} onPress={() => setPaymentMode(mode)}>
              <Text style={[styles.modeText, paymentMode === mode && styles.modeTextSelected]}>{mode}</Text>
              <Text style={[styles.shortcut, paymentMode === mode && styles.modeTextSelected]}>Ctrl+{index + 1}</Text>
            </Pressable>
          ))}
        </View>
        {paymentMode === "CASH" ? (
          <>
            <Input label="Amount received" keyboardType="numeric" value={amountReceived} onChangeText={setAmountReceived} />
            <SummaryRow label="Change to return" value={formatCurrency(change)} />
          </>
        ) : null}
        <Button label={`Held bills${heldBills.length ? ` (${heldBills.length})` : ""}`} variant="secondary" onPress={() => holdBill(customer?.id ?? "")} />
        <Button label="Confirm bill" fullWidth onPress={() => void confirmBill()} />
      </ScrollView>
      <BarcodeScanner visible={scannerVisible} onClose={() => setScannerVisible(false)} onScan={handleScan} />
      <BillPreviewBottomSheet visible={Boolean(confirmedInvoice)} invoice={confirmedInvoice} shopName={tenant?.name ?? "BizBil"} gstEnabled={tenant?.gstEnabled ?? true} onNewBill={() => { setConfirmedInvoice(null); reset(); }} />
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.summaryRow}><Text style={styles.summaryLabel}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  top: { flex: 1, gap: spacing.md },
  customerChip: { gap: spacing.xs },
  customerName: { color: colors.slate, fontWeight: fontWeights.bold },
  warning: { color: colors.amber, fontSize: fontSizes.sm, fontWeight: fontWeights.semibold },
  scanRow: { flexDirection: "row", gap: spacing.sm },
  scanButton: { width: 48, borderRadius: 8, backgroundColor: colors.teal, alignItems: "center", justifyContent: "center" },
  searchInput: { flex: 1, minHeight: 46, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, paddingHorizontal: spacing.md },
  dropdown: { gap: spacing.sm, padding: spacing.md },
  resultRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  resultTitle: { color: colors.slate, fontWeight: fontWeights.semibold },
  resultMeta: { color: colors.slateMid, fontSize: fontSizes.sm },
  newCustomer: { color: colors.teal, fontWeight: fontWeights.bold },
  lineCard: { marginBottom: spacing.sm, gap: spacing.md },
  lineHeader: { flexDirection: "row", justifyContent: "space-between" },
  lineCopy: { flex: 1 },
  productName: { color: colors.slate, fontWeight: fontWeights.bold },
  lineControls: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  lineTotal: { flex: 1, textAlign: "right", color: colors.teal, fontWeight: fontWeights.bold, fontSize: fontSizes.md, paddingBottom: spacing.md },
  summary: { maxHeight: "44%" },
  summaryContent: { gap: spacing.md, paddingTop: spacing.md },
  summaryRow: { flexDirection: "row", justifyContent: "space-between" },
  summaryLabel: { color: colors.slateMid, fontWeight: fontWeights.medium },
  summaryValue: { color: colors.slate, fontWeight: fontWeights.bold },
  grandTotal: { color: colors.teal, fontSize: 32, fontWeight: fontWeights.bold, textAlign: "right" },
  modeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  mode: { width: "48%", borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: spacing.md, backgroundColor: colors.white },
  modeSelected: { backgroundColor: colors.teal, borderColor: colors.teal },
  modeText: { color: colors.slate, fontWeight: fontWeights.bold },
  modeTextSelected: { color: colors.white },
  shortcut: { color: colors.slateMid, fontSize: fontSizes.xs },
});
