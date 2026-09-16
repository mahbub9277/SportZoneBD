import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Formats a number into a currency string.
 * Defaults to BDT (Bangladeshi Taka) if no currency is specified.
 * @param amount - The numeric amount to format.
 * @param currency - The ISO currency code (e.g., 'USD', 'EUR'). Defaults to 'BDT'.
 * @returns A formatted currency string (e.g., "৳1,250.00").
 */
export function formatCurrency(amount: number | string, currency = 'BDT'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(Number(amount));
}