import CallCenterAgent from "@/components/CallCenterAgent";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "E-commerce Call Agent",
  description: "Real-time voice agent for handling customer support calls."
};

export default function Page() {
  return <CallCenterAgent />;
}
