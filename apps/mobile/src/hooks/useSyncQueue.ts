import { useEffect, useState } from "react";
import NetInfo from "@react-native-community/netinfo";

import { apiClient } from "@/lib/api-client";
import { getImpersonationHeaderToken } from "@/lib/impersonation";
import { getQueuedInvoices, syncQueue } from "@/lib/offline-queue";

export function useSyncQueue() {
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    async function refreshCount() {
      const queue = await getQueuedInvoices();
      if (mounted) setPendingCount(queue.length);
    }

    async function syncWhenAllowed() {
      if (getImpersonationHeaderToken()) {
        await refreshCount();
        return;
      }
      await syncQueue(apiClient);
      await refreshCount();
    }

    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected) {
        void syncWhenAllowed();
      }
    });

    void refreshCount();
    void NetInfo.fetch().then((state) => {
      if (state.isConnected) void syncWhenAllowed();
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return {
    pendingCount,
    sync: async () => {
      if (getImpersonationHeaderToken()) {
        const queue = await getQueuedInvoices();
        setPendingCount(queue.length);
        return { synced: 0, failed: 0 };
      }
      const result = await syncQueue(apiClient);
      const queue = await getQueuedInvoices();
      setPendingCount(queue.length);
      return result;
    },
  };
}
