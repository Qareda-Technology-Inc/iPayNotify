import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

console.log('Supabase config:', { 
  url: supabaseUrl, 
  hasKey: !!supabaseAnonKey,
  keyLength: supabaseAnonKey?.length 
});

// Dev-only defaults allow local boot without envs. In production, envs are required.
const defaultUrl = 'https://olfjevbmqiqyvttpetlj.supabase.co'
const defaultKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9sZmpldmJtcWlxeXZ0dHBldGxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1NjQ5MDEsImV4cCI6MjA3NDE0MDkwMX0.xDf6LLPIB-HzJv2VTiHrfQD2jpu5Tkj9k131Hn_NunU'

const isDev = import.meta.env.DEV
const resolvedUrl = isDev ? (supabaseUrl || defaultUrl) : supabaseUrl
const resolvedKey = isDev ? (supabaseAnonKey || defaultKey) : supabaseAnonKey

if (!resolvedUrl || !resolvedKey) {
  throw new Error('Missing Supabase configuration. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
}

export const supabase = createClient(resolvedUrl, resolvedKey)