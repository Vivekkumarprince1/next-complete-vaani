import './globals.css'
import { AuthProvider } from '../src/contexts/AuthContext'
import { TranslationProvider } from '../src/contexts/TranslationContext'
import { Analytics } from '@vercel/analytics/react'

export const metadata = {
  title: 'Vaani',
  description: 'Real-time video calling and chat app with translation',
}

export default function RootLayout({
  children,
}) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <TranslationProvider>
            {children}
          </TranslationProvider>
        </AuthProvider>
        <Analytics />
      </body>
    </html>
  )
}