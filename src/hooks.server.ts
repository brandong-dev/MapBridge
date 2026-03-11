import { createSupabaseAuthServerClient, getSupabaseConfig } from '$lib/server/supabase';
import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.supabase = null;
	event.locals.user = null;

	const config = getSupabaseConfig();
	if (config) {
		const supabase = createSupabaseAuthServerClient(event.cookies);
		event.locals.supabase = supabase;

		const {
			data: { user }
		} = await supabase.auth.getUser();
		event.locals.user = user;
	}

	return resolve(event, {
		filterSerializedResponseHeaders: (name) =>
			name === 'content-range' || name === 'x-supabase-api-version'
	});
};
