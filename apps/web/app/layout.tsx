import type { Metadata, Viewport } from "next";
import { RegisterSW } from "@/components/RegisterSW";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agenda Citas",
  description: "Agenda de citas con WhatsApp — multiplataforma PC y Android",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Agenda" },
};

export const viewport: Viewport = {
  themeColor: "#0f766e",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <RegisterSW />
        {children}
      </body>
    </html>
  );
}
