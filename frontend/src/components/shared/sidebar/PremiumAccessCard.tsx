import { Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'

export function PremiumAccessCard() {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} whileHover={{ scale: 1.02, y: -4 }} whileTap={{ scale: 0.98 }}>
    <Link to="/subscriptions" className="block rounded-[1.4rem] border border-border bg-[linear-gradient(135deg,rgba(247,199,93,0.14),rgba(126,200,255,0.08))] p-4 shadow-[0_15px_40px_rgba(2,6,23,0.16)] transition-all hover:border-accent/40 hover:shadow-[0_20px_50px_rgba(247,199,93,0.14)]">
      <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
        <Sparkles className="h-4 w-4 text-accent" />
        Premium access
      </div>
      <p className="mt-2 text-sm text-text-muted">Live matches, curated highlights, and elite viewing in one elegant hub.</p>
    </Link>
    </motion.div>
  )
}