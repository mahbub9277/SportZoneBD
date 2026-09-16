import { Link } from 'react-router-dom'
import localLogo from '../../../assets/logo.png.jpeg'

export function SidebarHeader() {
  return (
    <div className="flex h-20 items-center justify-between border-b border-border/22 px-8 py-4 sm:h-22 sm:px-8">
      <Link to="/" className="flex items-center gap-10 font-bold text-text-primary">
        <img src={localLogo} alt="SportZoneBD logo" className="h-35 w-auto max-w-45 object-contain" />
      </Link>
    </div>
  )
}