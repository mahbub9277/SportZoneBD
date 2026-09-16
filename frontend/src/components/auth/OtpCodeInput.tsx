import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'

interface OtpCodeInputProps {
  value: string
  onChange: (value: string) => void
  name?: string
  id?: string
  disabled?: boolean
  autoFocus?: boolean
  error?: boolean
}

export function OtpCodeInput({ value, onChange, name = 'otp', id = 'otp', disabled = false, autoFocus = false, error = false }: OtpCodeInputProps) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([])
  const digits = value.replace(/\D/g, '').slice(0, 6).split('')

  useEffect(() => {
    if (autoFocus) inputRefs.current[0]?.focus()
  }, [autoFocus])

  const updateDigit = (index: number, nextValue: string) => {
    const nextDigits = [...digits]
    nextDigits[index] = nextValue.replace(/\D/g, '').slice(-1)
    onChange(nextDigits.join(''))
    if (nextDigits[index] && index < 5) inputRefs.current[index + 1]?.focus()
  }

  const handleKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      event.preventDefault()
      const nextDigits = [...digits]
      nextDigits[index - 1] = ''
      onChange(nextDigits.join(''))
      inputRefs.current[index - 1]?.focus()
    }
    if (event.key === 'ArrowLeft' && index > 0) inputRefs.current[index - 1]?.focus()
    if (event.key === 'ArrowRight' && index < 5) inputRefs.current[index + 1]?.focus()
  }

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault()
    onChange(event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6))
    inputRefs.current[Math.min(5, event.clipboardData.getData('text').replace(/\D/g, '').length)]?.focus()
  }

  return (
    <div id={id} role="group" aria-label="Six-digit verification code" className="mx-auto grid w-full max-w-lg grid-cols-6 gap-2.5 sm:gap-3.5">
      {Array.from({ length: 6 }, (_, index) => (
        <motion.input
          key={`${name}-${index}`}
          ref={(element) => { inputRefs.current[index] = element }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]"
          maxLength={1}
          value={digits[index] ?? ''}
          onChange={(event) => updateDigit(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          disabled={disabled}
          autoFocus={autoFocus && index === 0}
          aria-label={`Verification code digit ${index + 1}`}
          className={`h-14 w-full rounded-2xl border bg-surface-soft/95 text-center text-xl font-bold text-text-primary shadow-[0_8px_20px_rgba(2,6,23,0.16)] outline-none transition-all placeholder:text-text-muted/50 focus:scale-105 focus:border-accent focus:ring-2 focus:ring-accent/30 focus:shadow-[0_0_0_3px_rgba(247,199,93,0.16),0_12px_28px_rgba(2,6,23,0.2)] disabled:cursor-not-allowed disabled:opacity-60 sm:h-16 sm:text-2xl ${error ? 'border-red-400/80 focus:border-red-500 focus:ring-red-400/25' : 'border-accent/40 hover:border-accent/75'}`}
        />
      ))}
    </div>
  )
}
