import type { ReactNode } from 'react';

import { Providers } from './providers';
import './globals.css';

export const metadata = {
  description: 'Competitive pinochle.',
  title: 'MeldRank',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
