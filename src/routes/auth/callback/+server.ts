import { redirect } from '@sveltejs/kit';
import type { EmailOtpType } from '@supabase/supabase-js';
import type { RequestHandler } from './$types';

function resolveNextPath(next: string | null): string {
	if (!next || !next.startsWith('/')) {
		return '/';
	}

	if (next.startsWith('//')) {
		return '/';
	}

	return next;
}

function withAuthError(path: string, message: string): string {
	const separator = path.includes('?') ? '&' : '?';
	return `${path}${separator}authError=${encodeURIComponent(message)}`;
}

const EMAIL_OTP_TYPES: ReadonlySet<EmailOtpType> = new Set([
	'signup',
	'invite',
	'magiclink',
	'recovery',
	'email',
	'email_change'
]);

function isEmailOtpType(value: string | null): value is EmailOtpType {
	return value !== null && EMAIL_OTP_TYPES.has(value as EmailOtpType);
}

export const GET: RequestHandler = async ({ url, locals }) => {
	const code = url.searchParams.get('code');
	const tokenHash = url.searchParams.get('token_hash');
	const otpType = url.searchParams.get('type');
	const next = resolveNextPath(url.searchParams.get('next'));

	const supabase = locals.supabase;
	if (!supabase) {
		redirect(303, withAuthError(next, 'Supabase is not configured'));
	}

	if (!code && (!tokenHash || !isEmailOtpType(otpType))) {
		redirect(303, withAuthError(next, 'Missing authentication code'));
	}

	const { error } = code
		? await supabase.auth.exchangeCodeForSession(code)
		: await supabase.auth.verifyOtp({
				token_hash: tokenHash ?? '',
				type: otpType as EmailOtpType
			});
	if (error) {
		redirect(303, withAuthError(next, error.message));
	}

	redirect(303, next);
};
