import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Online Store | BizBil",
  description: "Order online with live BizBil stock, checkout, and delivery details.",
};

export default function StorePage() {
  notFound();
}
