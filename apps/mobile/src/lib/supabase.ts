import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Project URL and publishable key are public by design; access is controlled by row-level security.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://txgsbggvkwyrecpwaxns.supabase.co';
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY || 'sb_publishable_1soy5jquSZJkd6OrqV9Jzg_t7N-I01J';

export const supabase = createClient(url, key, {
  auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
});
