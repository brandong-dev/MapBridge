import { buildMapUrls, isIOSUserAgent } from '$lib/map';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

function formatLocationName(name: string, address: string): string {
	const trimmedName = name.trim();
	if (trimmedName.length > 0) return trimmedName;

	const trimmedAddress = address.trim();
	if (trimmedAddress.length > 0) return trimmedAddress;

	return 'Location';
}

function buildDescription(locationName: string, address: string, notes: string): string {
	const trimmedNotes = notes.trim();
	if (trimmedNotes.length > 0) {
		return trimmedNotes;
	}

	const trimmedAddress = address.trim();
	if (trimmedAddress.length > 0) {
		return `Directions to ${locationName} at ${trimmedAddress}.`;
	}

	return `Directions to ${locationName}.`;
}

export const load: PageServerLoad = async ({ params, request, url }) => {
	const slug = params.slug?.trim().toLowerCase();
	if (!slug) {
		error(400, 'Missing slug.');
	}

	let supabase;
	try {
		supabase = createSupabaseAdminClient();
	} catch (cause) {
		console.error(cause);
		error(500, 'Unable to resolve link.');
	}

	const { data, error: queryError } = await supabase
		.from('links')
		.select('slug,name,address,notes,lat,lng,is_disabled')
		.eq('slug', slug)
		.maybeSingle();

	if (queryError) {
		console.error(queryError);
		error(500, 'Unable to resolve link.');
	}

	if (!data) {
		error(404, 'This NavQR link was removed or is no longer active.');
	}

	if (data.is_disabled === true) {
		error(404, 'This NavQR link was removed or is no longer active.');
	}

	const name = typeof data.name === 'string' ? data.name : '';
	const address = typeof data.address === 'string' ? data.address : '';
	const notes = typeof data.notes === 'string' ? data.notes.trim() : '';

	const urls = buildMapUrls({
		name,
		address,
		lat: data.lat,
		lng: data.lng
	});

	const userAgent = request.headers.get('user-agent') ?? '';
	const isIOS = isIOSUserAgent(userAgent);
	const preferredProvider = isIOS ? 'Apple Maps' : 'Google Maps';
	const mapProviders = [
		{ id: 'apple', label: 'Apple Maps', href: isIOS ? urls.appleApp : urls.appleWeb },
		{ id: 'google', label: 'Google Maps', href: urls.google },
		{ id: 'waze', label: 'Waze', href: urls.waze }
	] as const;

	const locationName = formatLocationName(name, address);
	const title = `${locationName} - NavQR`;
	const description = buildDescription(locationName, address, notes);
	const socialImageUrl = `${url.origin}/r/${slug}/social-image`;

	return {
		address,
		description,
		locationName,
		notes,
		mapProviders,
		origin: url.origin,
		preferredProvider,
		socialImageUrl,
		slug,
		title
	};
};
