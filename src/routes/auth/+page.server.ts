import { fail, redirect } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import type { Actions, PageServerLoad } from './$types';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;

function normalizeEmail(value: FormDataEntryValue | null): string {
	return String(value ?? '')
		.trim()
		.toLowerCase();
}

function normalizePassword(value: FormDataEntryValue | null): string {
	return String(value ?? '').trim();
}

function authValues(email: string) {
	return { email };
}

function getSupabaseGoogleCallbackUrl(): string {
	const supabaseUrl = publicEnv.PUBLIC_SUPABASE_URL?.trim() ?? '';
	if (supabaseUrl.length === 0) {
		return 'https://<PROJECT_REF>.supabase.co/auth/v1/callback';
	}

	try {
		return new URL('/auth/v1/callback', supabaseUrl).toString();
	} catch {
		return 'https://<PROJECT_REF>.supabase.co/auth/v1/callback';
	}
}

function isGoogleProviderMisconfigured(message: string): boolean {
	const normalized = message.toLowerCase();
	return (
		normalized.includes('provider is not enabled') ||
		normalized.includes('unsupported provider') ||
		normalized.includes('oauth') ||
		normalized.includes('invalid redirect_uri')
	);
}

function googleSetupHelp(origin: string): string {
	return [
		'Google sign-in is not fully configured.',
		`Google OAuth redirect URI: ${getSupabaseGoogleCallbackUrl()}`,
		`Supabase allowed redirect URL: ${origin}/auth/callback`
	].join(' ');
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = locals.user ? { id: locals.user.id, email: locals.user.email ?? null } : null;

	return {
		user,
		supabaseReady: locals.supabase !== null,
		authError: url.searchParams.get('authError'),
		authMessage: url.searchParams.get('authMessage')
	};
};

export const actions: Actions = {
	signInGoogle: async ({ locals, url }) => {
		const supabase = locals.supabase;
		if (!supabase) {
			return fail(500, {
				authError:
					'Supabase is not configured yet. Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY.'
			});
		}

		const redirectTo = new URL('/auth/callback', url.origin);
		redirectTo.searchParams.set('next', '/');

		const { data, error } = await supabase.auth.signInWithOAuth({
			provider: 'google',
			options: {
				redirectTo: redirectTo.toString()
			}
		});

		if (error) {
			if (isGoogleProviderMisconfigured(error.message)) {
				return fail(400, { authError: googleSetupHelp(url.origin) });
			}
			return fail(400, { authError: error.message });
		}

		if (!data.url) {
			return fail(500, { authError: 'Unable to start Google sign-in.' });
		}

		redirect(303, data.url);
	},
	signInPassword: async ({ request, locals }) => {
		const formData = await request.formData();
		const email = normalizeEmail(formData.get('email'));
		const password = normalizePassword(formData.get('password'));
		const values = authValues(email);

		if (!EMAIL_PATTERN.test(email)) {
			return fail(400, { authError: 'Enter a valid email address.', authValues: values });
		}

		if (password.length === 0) {
			return fail(400, { authError: 'Enter your password.', authValues: values });
		}

		const supabase = locals.supabase;
		if (!supabase) {
			return fail(500, {
				authError:
					'Supabase is not configured yet. Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY.',
				authValues: values
			});
		}

		const { error } = await supabase.auth.signInWithPassword({
			email,
			password
		});

		if (error) {
			return fail(400, {
				authError: error.message,
				authValues: values
			});
		}

		redirect(303, '/');
	},
	signUpPassword: async ({ request, locals, url }) => {
		const formData = await request.formData();
		const email = normalizeEmail(formData.get('email'));
		const password = normalizePassword(formData.get('password'));
		const values = authValues(email);

		if (!EMAIL_PATTERN.test(email)) {
			return fail(400, { authError: 'Enter a valid email address.', authValues: values });
		}

		if (password.length < PASSWORD_MIN_LENGTH) {
			return fail(400, {
				authError: `Use at least ${PASSWORD_MIN_LENGTH} characters for password.`,
				authValues: values
			});
		}

		const supabase = locals.supabase;
		if (!supabase) {
			return fail(500, {
				authError:
					'Supabase is not configured yet. Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY.',
				authValues: values
			});
		}

		const callbackUrl = new URL('/auth/callback', url.origin);
		callbackUrl.searchParams.set('next', '/');

		const { data, error } = await supabase.auth.signUp({
			email,
			password,
			options: {
				emailRedirectTo: callbackUrl.toString()
			}
		});

		if (error) {
			return fail(400, {
				authError: error.message,
				authValues: values
			});
		}

		if (data.session) {
			redirect(303, '/');
		}

		const nextUrl = new URL('/auth', url.origin);
		nextUrl.searchParams.set('authMessage', 'Account created. Check your email to confirm sign-in.');
		redirect(303, nextUrl.toString());
	},
	signOut: async ({ locals }) => {
		const supabase = locals.supabase;
		if (supabase) {
			const { error } = await supabase.auth.signOut();
			if (error) {
				return fail(400, { authError: error.message });
			}
		}

		redirect(303, '/auth');
	}
};
