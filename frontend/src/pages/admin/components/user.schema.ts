import * as z from 'zod'

export const userSchema = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters.'),
  email: z.string().email('Please enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.').optional().or(z.literal('')),
  roleIds: z.array(z.string()).min(1, 'At least one role is required.'),
  isActive: z.boolean(),
})

export type UserFormValues = z.infer<typeof userSchema>
