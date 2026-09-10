import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VITALIS — AI-Powered Remote Patient Monitoring',
  description:
    'VITALIS helps clinicians monitor patients in real time, detect health risks early, and protect healthcare AI workflows from unsafe or malicious clinical content.',
  icons: [{ rel: 'icon', url: '/favicon.svg', type: 'image/svg+xml' }],
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f9fc' },
    { media: '(prefers-color-scheme: dark)', color: '#07111f' },
  ],
};

// Runs before hydration to set the theme attribute from localStorage.
// Avoids a flash of the wrong theme on first paint.
const themeInit = `
(function(){try{
  var s=localStorage.getItem('vitalis-theme');
  if(s==='dark'||s==='light'){document.documentElement.setAttribute('data-theme',s);}
}catch(_){}})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <link rel="preconnect" href="https://rsms.me/" />
        <link rel="stylesheet" href="https://rsms.me/inter/inter.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
