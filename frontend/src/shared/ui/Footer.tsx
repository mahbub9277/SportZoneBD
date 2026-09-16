import { Link } from 'react-router-dom'
import { FaFacebookF, FaInstagram, FaTiktok, FaYoutube } from 'react-icons/fa6'
import { appRoutes } from '../lib/routes'
import localLogo from '../../assets/logo.png.jpeg'

const socialLinks = [
  {
    href: 'http://www.youtube.com/@SportZoneBD204',
    label: 'YouTube',
    icon: FaYoutube,
  },
  {
    href: 'https://facebook.com/SportZoneBD',
    label: 'Facebook',
    icon: FaFacebookF,
  },
  {
    href: 'https://instagram.com',
    label: 'Instagram',
    icon: FaInstagram,
  },
  {
    href: 'https://tiktok.com',
    label: 'TikTok',
    icon: FaTiktok,
  },
]

export function Footer() {
  return (
    <footer className="border-t border-(--border) bg-[linear-gradient(180deg,var(--surface),var(--background))] text-sm text-text-muted shadow-[0_-22px_80px_var(--shadow)] backdrop-blur-2xl transition-colors duration-200">
      <div className="mx-auto w-full max-w-[1600px] px-3 pt-4 pb-25 sm:px-6 sm:py-12 lg:px-8 lg:pb-8">
        <div className="flex min-w-0 flex-col items-center gap-5 rounded-3xl border border-(--border) bg-(--surface-soft)/70 p-4 shadow-[0_18px_60px_var(--shadow)] backdrop-blur-xl transition-colors duration-200 sm:gap-6 sm:p-8">
          <Link to="/" aria-label="SportZoneBD home" className="group max-w-full rounded-3xl border border-(--border) bg-(--surface)/60 px-4 py-2 transition hover:border-accent/40 hover:bg-(--surface-soft)">
            <img src={localLogo} alt="SportZoneBD logo" className="h-10 w-auto max-w-[min(15rem,75vw)] object-contain transition duration-300 group-hover:scale-[1.04] sm:h-12" />
          </Link>
          <p className="text-center text-xs text-text-muted sm:text-sm">
            © {new Date().getFullYear()} SportZoneBD. All rights reserved.
          </p>
          <div className="flex w-full min-w-0 flex-col items-center gap-3 sm:flex-row sm:justify-between sm:gap-6">
            <div className="flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-2 text-center">
              <Link to={appRoutes.termsOfService} className="text-sm text-text-muted transition hover:text-text-primary">Terms of Service</Link>
              <span className="text-text-muted" aria-hidden="true">•</span>
              <Link to={appRoutes.privacyPolicy} className="text-sm text-text-muted transition hover:text-text-primary">Privacy Policy</Link>
            </div>
            <div className="relative z-10 flex shrink-0 items-center gap-2">
              {socialLinks.map((link) => (
                <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" aria-label={link.label} title={link.label} className="rounded-full border border-(--border) bg-(--surface)/60 p-2.5 text-text-muted transition-all hover:-translate-y-1 hover:border-accent/40 hover:bg-accent/10 hover:text-accent">
                  <link.icon className="h-5 w-5" aria-hidden="true" />
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
