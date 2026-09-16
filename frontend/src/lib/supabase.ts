import { createClient } from '@supabase/supabase-js'

// It's crucial to use environment variables for your Supabase URL and anon key.
// Ensure you have a .env file in your frontend's root directory with these variables.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase URL and/or anon key are missing from environment variables.')
}

// Create and export the Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey)