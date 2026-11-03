import { siMailchimp, siMeta, siWordpress, type SimpleIcon } from 'simple-icons'
import { cn } from '@/lib/utils'

// Logos of the platforms that ClearPath connects to, shown only to name the channel.
// Meta, Mailchimp and WordPress come from simple-icons (CC0 SVG paths of brand logos).
// Google uses its four-color "G", because the one-color version does not read as Google.

/** One-color brand mark. Mailchimp's yellow has too little contrast on white, so it uses ink. */
function SimpleLogo({ icon, color, className }: { icon: SimpleIcon; color?: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('size-4 shrink-0', className)} fill={color ?? `#${icon.hex}`}>
      <path d={icon.path} />
    </svg>
  )
}

export const MetaLogo = ({ className }: { className?: string }) => <SimpleLogo icon={siMeta} className={className} />
export const MailchimpLogo = ({ className }: { className?: string }) => <SimpleLogo icon={siMailchimp} color="currentColor" className={cn('text-foreground', className)} />
export const WordPressLogo = ({ className }: { className?: string }) => <SimpleLogo icon={siWordpress} className={className} />

export function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={cn('size-4 shrink-0', className)}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}
