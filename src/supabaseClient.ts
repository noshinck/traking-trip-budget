import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://vrveezwtlgdwpvkisbsl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZydmVlend0bGdkd3B2a2lzYnNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MDE1NzUsImV4cCI6MjA5NzM3NzU3NX0.GQt6-jbvBSBoS2Y_Y_-t3Q6kiLmKgxJTfjNIQBDebPc';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
