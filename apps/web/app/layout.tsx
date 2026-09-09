import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'VITALIS · Clinical command center',
  description: 'Synthetic clinical decision support. Protect the signal. Protect the context.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
