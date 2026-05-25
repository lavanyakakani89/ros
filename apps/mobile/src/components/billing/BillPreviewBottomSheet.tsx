import { Linking, Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { formatCurrency, formatDate, numberToWords } from "@retailos/shared";

import { Button } from "@/components/ui/Button";
import { printReceipt, type PrintableInvoice } from "@/lib/bluetooth-print";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

interface BillPreviewProps {
  visible: boolean;
  invoice: PrintableInvoice | null;
  shopName: string;
  gstEnabled: boolean;
  onNewBill: () => void;
}

export function BillPreviewBottomSheet({ visible, invoice, shopName, gstEnabled, onNewBill }: BillPreviewProps) {
  if (!invoice) return null;

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.shop}>{shopName}</Text>
            <Text style={styles.meta}>{invoice.invoiceNumber} | {formatDate(invoice.invoiceDate)}</Text>
            {invoice.items.map((item, index) => (
              <View key={`${item.name}-${index}`} style={styles.line}>
                <Text style={styles.item}>{item.name}</Text>
                <Text style={styles.amount}>{formatCurrency(item.amount)}</Text>
              </View>
            ))}
            {gstEnabled ? (
              <View style={styles.tax}>
                <Text>CGST {formatCurrency(invoice.totalCgst ?? 0)}</Text>
                <Text>SGST {formatCurrency(invoice.totalSgst ?? 0)}</Text>
              </View>
            ) : null}
            <Text style={styles.total}>{formatCurrency(invoice.grandTotal)}</Text>
            <Text style={styles.words}>{numberToWords(invoice.grandTotal)} Only</Text>
            <Text style={styles.meta}>Payment mode: {invoice.paymentMode}</Text>
          </ScrollView>
          <View style={styles.actions}>
            <Button label="Print" icon="printer" onPress={() => void printReceipt(invoice, { shopName, gstEnabled })} />
            <Button label="WhatsApp" variant="secondary" icon="whatsapp" onPress={() => void Linking.openURL(`whatsapp://send?text=${encodeURIComponent(`Invoice ${invoice.invoiceNumber} ${formatCurrency(invoice.grandTotal)}`)}`)} />
            <Button label="New bill" variant="ghost" onPress={onNewBill} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(15, 23, 42, 0.35)", justifyContent: "flex-end" },
  sheet: { maxHeight: "86%", backgroundColor: colors.white, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: spacing.lg },
  content: { gap: spacing.md },
  shop: { textAlign: "center", color: colors.slate, fontSize: fontSizes.xl, fontWeight: fontWeights.bold },
  meta: { textAlign: "center", color: colors.slateMid, fontSize: fontSizes.sm },
  line: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.sm },
  item: { color: colors.slate, fontWeight: fontWeights.semibold },
  amount: { color: colors.slate, fontWeight: fontWeights.bold },
  tax: { gap: spacing.xs },
  total: { color: colors.teal, fontSize: 30, fontWeight: fontWeights.bold, textAlign: "right" },
  words: { color: colors.slateMid, fontStyle: "italic" },
  actions: { gap: spacing.sm, paddingTop: spacing.md },
});
