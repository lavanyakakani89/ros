import { useEffect, useRef, useState } from "react";
import { Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions, type CameraView as CameraViewType } from "expo-camera";
import * as Location from "expo-location";

import { Button } from "@/components/ui/Button";
import { apiClient } from "@/lib/api-client";
import { colors, fontSizes, fontWeights, spacing } from "@/theme";

export function DeliveryProofSheet({
  visible,
  delivery,
  onClose,
  onDelivered,
}: {
  visible: boolean;
  delivery: any | null;
  onClose: () => void;
  onDelivered: () => void;
}) {
  const cameraRef = useRef<CameraViewType>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [cashCollected, setCashCollected] = useState(false);

  useEffect(() => {
    if (!visible) return;
    void Location.requestForegroundPermissionsAsync().then(async (permissionResult) => {
      if (permissionResult.granted) {
        setLocation(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      }
    });
  }, [visible]);

  async function capturePhoto() {
    if (!permission?.granted) {
      await requestPermission();
      return;
    }
    const photo = await cameraRef.current?.takePictureAsync({ quality: 0.7 });
    if (photo?.uri) setPhotoUri(photo.uri);
  }

  async function confirm() {
    if (!delivery || !photoUri) return;
    await apiClient.put(`/api/delivery/${delivery.id}/status`, { status: "DELIVERED" });
    await apiClient.post(`/api/delivery/${delivery.id}/proof`, {
      deliveryId: delivery.id,
      proofType: "PHOTO",
      photoUrl: photoUri,
      latitude: location?.coords.latitude,
      longitude: location?.coords.longitude,
      cashCollected,
    });
    onDelivered();
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Delivery proof</Text>
          <Text style={styles.step}>1. Photo proof</Text>
          {photoUri ? <Image source={{ uri: photoUri }} style={styles.thumbnail} /> : permission?.granted ? <CameraView ref={cameraRef} style={styles.camera} /> : null}
          <Button label={photoUri ? "Retake" : "Capture photo"} variant="secondary" onPress={() => { if (photoUri) setPhotoUri(null); else void capturePhoto(); }} />
          <Text style={styles.step}>2. GPS location</Text>
          <Text style={location ? styles.ok : styles.error}>{location ? "Location captured" : "Waiting for location"}</Text>
          {delivery?.paymentMode === "CREDIT" ? null : (
            <>
              <Text style={styles.step}>3. Cash collection</Text>
              <Pressable style={styles.toggle} onPress={() => setCashCollected((value) => !value)}>
                <View style={[styles.checkbox, cashCollected && styles.checked]} />
                <Text>Confirm you collected cash from customer</Text>
              </Pressable>
            </>
          )}
          <Button label="Confirm delivered" disabled={!photoUri} onPress={() => void confirm()} />
          <Button label="Cancel" variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.35)" },
  sheet: { backgroundColor: colors.white, padding: spacing.xl, borderTopLeftRadius: 18, borderTopRightRadius: 18, gap: spacing.md },
  title: { color: colors.slate, fontSize: fontSizes.xl, fontWeight: fontWeights.bold },
  step: { color: colors.slate, fontWeight: fontWeights.bold },
  camera: { height: 180, borderRadius: 8, overflow: "hidden" },
  thumbnail: { height: 180, borderRadius: 8 },
  ok: { color: colors.teal },
  error: { color: colors.red },
  toggle: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1, borderColor: colors.border },
  checked: { backgroundColor: colors.teal, borderColor: colors.teal },
});
