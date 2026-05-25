import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { BarCodeScanner } from "expo-barcode-scanner";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { colors, fontSizes, fontWeights, spacing } from "@/theme";

export function BarcodeScanner({ visible, onClose, onScan }: { visible: boolean; onClose: () => void; onScan: (barcode: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [locked, setLocked] = useState(false);
  void BarCodeScanner;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            enableTorch={torch}
            barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "qr", "code128", "upc_a", "upc_e"] }}
            onBarcodeScanned={(event) => {
              if (locked) return;
              setLocked(true);
              onScan(event.data);
              setTimeout(() => setLocked(false), 800);
            }}
          />
        ) : (
          <Pressable style={styles.permission} onPress={() => void requestPermission()}>
            <Text style={styles.permissionText}>Allow camera access to scan barcodes</Text>
          </Pressable>
        )}
        <View style={styles.topBar}>
          <Pressable style={styles.iconButton} onPress={onClose}><MaterialCommunityIcons name="close" size={24} color={colors.white} /></Pressable>
          <Pressable style={styles.iconButton} onPress={() => setTorch((value) => !value)}><MaterialCommunityIcons name={torch ? "flashlight-off" : "flashlight"} size={24} color={colors.white} /></Pressable>
        </View>
        <View style={styles.frame} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.slate },
  topBar: { position: "absolute", top: 48, left: spacing.lg, right: spacing.lg, flexDirection: "row", justifyContent: "space-between" },
  iconButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(15,23,42,0.7)", alignItems: "center", justifyContent: "center" },
  frame: { position: "absolute", left: 42, right: 42, top: "35%", height: 180, borderWidth: 2, borderColor: colors.white, borderRadius: 12 },
  permission: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxl },
  permissionText: { color: colors.white, fontSize: fontSizes.md, fontWeight: fontWeights.semibold, textAlign: "center" },
});
