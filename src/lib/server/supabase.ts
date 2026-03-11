import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { Cookies } from '@sveltejs/kit';

function normalizeEnv(value: string | undefined): string {
	return value?.trim() ?? '';
}

function requireEnv(value: string, key: string): string {
	if (value.length === 0) {
		throw new Error(`Missing required environment variable: ${key}`);
	}

	return value;
}

export function getSupabaseConfig():
	| {
			url: string;
			anonKey: string;
	  }
	| null {
	const url = normalizeEnv(publicEnv.PUBLIC_SUPABASE_URL);
	const anonKey = normalizeEnv(publicEnv.PUBLIC_SUPABASE_ANON_KEY);

	if (url.length === 0 || anonKey.length === 0) {
		return null;
	}

	return { url, anonKey };
}

export function createSupabaseAuthServerClient(cookies: Cookies) {
	const config = getSupabaseConfig();
	if (!config) {
		throw new Error('Missing PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY');
	}

	return createServerClient(config.url, config.anonKey, {
		cookies: {
			getAll: () => cookies.getAll(),
			setAll: (cookiesToSet) => {
				for (const { name, value, options } of cookiesToSet) {
					cookies.set(name, value, { ...options, path: '/' });
				}
			}
		}
	});
}

export function createSupabaseAdminClient() {
	const config = getSupabaseConfig();
	if (!config) {
		throw new Error('Missing PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY');
	}

	const serviceRoleKey = normalizeEnv(privateEnv.SUPABASE_SERVICE_ROLE_KEY);
	return createClient(
		config.url,
		requireEnv(serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY'),
		{
			auth: {
				autoRefreshToken: false,
				persistSession: false
			}
		}
	);
}
