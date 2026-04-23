import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const SUPABASE_URL = 'https://tszqochhftsighhxtmgc.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRzenFvY2hoZnRzaWdoaHh0bWdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5NDY4NzIsImV4cCI6MjA5MDUyMjg3Mn0.iCNhXZZVDjpxY-oi1_bFvL_sU0bq3phnSU7z7SxwYJ0'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)