import { createClient } from '@supabase/supabase-js';

// Project URL and publishable key are public by design; access is controlled by row-level security.
const url = import.meta.env.VITE_SUPABASE_URL || 'https://txgsbggvkwyrecpwaxns.supabase.co';
const key = import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_1soy5jquSZJkd6OrqV9Jzg_t7N-I01J';

export const supabase = createClient(url, key);
