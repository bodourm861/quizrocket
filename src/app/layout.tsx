import type { Metadata, Viewport } from 'next';
import './globals.css';

const APP = process.env.NEXT_PUBLIC_APP_NAME || 'QuizRocket';

export const metadata: Metadata = {
  title: { default: `${APP} — live classroom quizzes`, template: `%s · ${APP}` },
  description: 'Teacher-controlled, real-time quiz games for the classroom and Microsoft Teams lessons.',
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#4722c9' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Nunito:wght@500;600;700;800&display=swap"
        />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
