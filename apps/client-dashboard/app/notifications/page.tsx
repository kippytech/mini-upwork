import type { Metadata } from "next";
import { ClientShell } from "../_components/dashboard/client-shell";
import { ClientNotifications } from "./client-notifications";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Notifications | Mini-upwork.io",
  description:
    "Review client updates about proposals, contracts, messages, and payments.",
};

export default function ClientNotificationsPage() {
  return (
    <Suspense>
      <ClientShell>
        <ClientNotifications />
      </ClientShell>
    </Suspense>
  );
}
