self.addEventListener("push", (event) => {
  const payload = parsePayload(event.data);
  if (!payload) {
    return;
  }

  event.waitUntil(self.registration.showNotification(payload.title || "BizBil Delivery", {
    body: payload.body || "New delivery assigned",
    tag: payload.tag || "bizbil-delivery",
    renotify: true,
    requireInteraction: true,
    badge: "/icons/icon-192.png",
    icon: "/icons/icon-192.png",
    data: {
      url: payload.url || "/delivery-app",
    },
    vibrate: [450, 120, 450, 120, 700],
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/delivery-app";
  event.waitUntil(focusDeliveryClient(targetUrl));
});

function parsePayload(data) {
  if (!data) {
    return null;
  }

  try {
    return data.json();
  } catch {
    try {
      return JSON.parse(data.text());
    } catch {
      return null;
    }
  }
}

async function focusDeliveryClient(targetUrl) {
  const windowClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windowClients) {
    if ("focus" in client) {
      await client.focus();
      if ("navigate" in client) {
        await client.navigate(targetUrl);
      }
      return;
    }
  }

  if (self.clients.openWindow) {
    await self.clients.openWindow(targetUrl);
  }
}
