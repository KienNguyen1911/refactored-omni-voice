import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "vietnamese"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "OmniVoice Studio | Swiss Precision Audio Workstation",
  description:
    "Trạm làm việc âm thanh chuyên nghiệp: Zero-shot Voice Cloning và Voice Design với hơn 600 ngôn ngữ, độ trễ siêu thấp RTF 0.025.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className="dark">
      <body className={`${inter.className} bg-[#08090b] text-[#f1f3f7] min-h-screen antialiased selection:bg-blue-600/30 selection:text-white`}>
        {children}
      </body>
    </html>
  );
}
