import { getTranslations } from "next-intl/server";

import type { NotificationLabels } from "@/components/notifications/notification-center";

/** Notification texts for the console's language. Templates ("{count} new orders") are filled in the browser. */
export async function notificationLabels(area: "orders" | "platform"): Promise<NotificationLabels> {
  const t = await getTranslations("notifications");
  const raw = (key: string) => t.raw(key) as string;
  return {
    alertsOn: t(area === "orders" ? "orderAlertsOn" : "platformAlertsOn"),
    alertsOff: t(area === "orders" ? "orderAlertsOff" : "platformAlertsOff"),
    enableSound: t("enableSound"),
    enablePrompt: t(area === "orders" ? "enablePromptOrders" : "enablePromptPlatform"),
    dismiss: t("dismiss"),
    newBadge: t("newBadge"),
    newOrder: t("newOrder"),
    orderNumber: raw("orderNumber"),
    itemsOne: t("itemsOne"),
    itemsOther: raw("itemsOther"),
    newOrders: raw("newOrders"),
    latest: t("latest"),
    viewOrder: t("viewOrder"),
    viewOrders: t("viewOrders"),
    newOrderNotification: t("newOrderNotification"),
    newSubscriber: t("newSubscriber"),
    joined: raw("joined"),
    plan: raw("plan"),
    upgrade: t("upgrade"),
    upgraded: raw("upgraded"),
    viewSubscriber: t("viewSubscriber"),
    newSubscriberNotification: t("newSubscriberNotification"),
    upgradeNotification: t("upgradeNotification"),
  };
}
