import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const DEFAULT_SOCIAL_IMAGE_PATH = '/navqr-social-preview.png';
const FETCH_TIMEOUT_MS = 3200;

type LinkRow = {
	name: string;
	address: string;
	lat: number | null;
	lng: number | null;
};

type PlaceSearchResponse = {
	candidates?: Array<{
		photos?: Array<{ photo_reference?: string | null }> | null;
	}> | null;
	status?: string;
};

type StreetViewMetadataResponse = {
	status?: string;
};

function clean(value: string | undefined): string {
	return value?.trim() ?? '';
}

function getGoogleMapsServerKey(): string {
	const serverKey = clean(privateEnv.GOOGLE_MAPS_SERVER_API_KEY);
	if (serverKey.length > 0) return serverKey;
	return clean(publicEnv.PUBLIC_GOOGLE_MAPS_API_KEY);
}

function isFiniteCoordinate(value: number | null): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function buildPlaceQuery(name: string, address: string): string {
	const trimmedName = name.trim();
	const trimmedAddress = address.trim();

	if (trimmedName.length > 0 && trimmedAddress.length > 0) {
		return `${trimmedName}, ${trimmedAddress}`;
	}

	return trimmedName.length > 0 ? trimmedName : trimmedAddress;
}

async function fetchWithTimeout(input: string, init: RequestInit = {}): Promise<Response> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try {
		return await fetch(input, { ...init, signal: controller.signal, redirect: 'follow' });
	} finally {
		clearTimeout(timeout);
	}
}

async function fetchImageBytes(imageUrl: string): Promise<Response | null> {
	try {
		const response = await fetchWithTimeout(imageUrl, {
			headers: {
				accept: 'image/*'
			}
		});

		if (!response.ok) return null;
		const contentType = response.headers.get('content-type') ?? '';
		if (!contentType.toLowerCase().startsWith('image/')) return null;

		const body = await response.arrayBuffer();
		if (body.byteLength === 0) return null;

		return new Response(body, {
			status: 200,
			headers: {
				'content-type': contentType,
				'cache-control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800'
			}
		});
	} catch {
		return null;
	}
}

async function getPlacePhotoUrl(args: {
	key: string;
	name: string;
	address: string;
	lat: number | null;
	lng: number | null;
}): Promise<string | null> {
	const query = buildPlaceQuery(args.name, args.address);
	if (query.length < 3) return null;

	try {
		const searchUrl = new URL('https://maps.googleapis.com/maps/api/place/findplacefromtext/json');
		searchUrl.searchParams.set('input', query);
		searchUrl.searchParams.set('inputtype', 'textquery');
		searchUrl.searchParams.set('fields', 'photos');
		if (isFiniteCoordinate(args.lat) && isFiniteCoordinate(args.lng)) {
			searchUrl.searchParams.set('locationbias', `point:${args.lat},${args.lng}`);
		}
		searchUrl.searchParams.set('key', args.key);

		const response = await fetchWithTimeout(searchUrl.toString(), {
			headers: {
				accept: 'application/json'
			}
		});
		if (!response.ok) return null;

		const payload = (await response.json()) as PlaceSearchResponse;
		const photoReference = payload?.candidates?.[0]?.photos?.[0]?.photo_reference?.trim() ?? '';
		if (photoReference.length === 0) return null;

		const photoUrl = new URL('https://maps.googleapis.com/maps/api/place/photo');
		photoUrl.searchParams.set('maxwidth', '1200');
		photoUrl.searchParams.set('photo_reference', photoReference);
		photoUrl.searchParams.set('key', args.key);
		return photoUrl.toString();
	} catch {
		return null;
	}
}

async function getStreetViewImageUrl(args: {
	key: string;
	lat: number | null;
	lng: number | null;
}): Promise<string | null> {
	if (!isFiniteCoordinate(args.lat) || !isFiniteCoordinate(args.lng)) return null;

	const location = `${args.lat},${args.lng}`;
	try {
		const metadataUrl = new URL('https://maps.googleapis.com/maps/api/streetview/metadata');
		metadataUrl.searchParams.set('location', location);
		metadataUrl.searchParams.set('size', '1200x630');
		metadataUrl.searchParams.set('key', args.key);

		const metadataResponse = await fetchWithTimeout(metadataUrl.toString(), {
			headers: {
				accept: 'application/json'
			}
		});
		if (!metadataResponse.ok) return null;

		const payload = (await metadataResponse.json()) as StreetViewMetadataResponse;
		if ((payload.status ?? '').toUpperCase() !== 'OK') return null;

		const imageUrl = new URL('https://maps.googleapis.com/maps/api/streetview');
		imageUrl.searchParams.set('location', location);
		imageUrl.searchParams.set('size', '1200x630');
		imageUrl.searchParams.set('fov', '90');
		imageUrl.searchParams.set('pitch', '0');
		imageUrl.searchParams.set('key', args.key);
		return imageUrl.toString();
	} catch {
		return null;
	}
}

async function resolveLink(slug: string): Promise<LinkRow | null> {
	const supabase = createSupabaseAdminClient();
	const { data, error: queryError } = await supabase
		.from('links')
		.select('name,address,lat,lng,is_disabled')
		.eq('slug', slug)
		.maybeSingle();

	if (queryError) {
		console.error(queryError);
		error(500, 'Unable to resolve link.');
	}

	if (!data) return null;
	if (data.is_disabled === true) return null;

	return {
		name: typeof data.name === 'string' ? data.name : '',
		address: typeof data.address === 'string' ? data.address : '',
		lat: isFiniteCoordinate(data.lat) ? data.lat : null,
		lng: isFiniteCoordinate(data.lng) ? data.lng : null
	};
}

export const GET: RequestHandler = async ({ params, url }) => {
	const slug = params.slug?.trim().toLowerCase();
	if (!slug) {
		redirect(307, `${url.origin}${DEFAULT_SOCIAL_IMAGE_PATH}`);
	}

	let link: LinkRow | null = null;
	try {
		link = await resolveLink(slug);
	} catch (cause) {
		console.error(cause);
		link = null;
	}

	if (!link) {
		redirect(307, `${url.origin}${DEFAULT_SOCIAL_IMAGE_PATH}`);
	}

	const key = getGoogleMapsServerKey();
	if (key.length > 0) {
		const placePhotoUrl = await getPlacePhotoUrl({
			key,
			name: link.name,
			address: link.address,
			lat: link.lat,
			lng: link.lng
		});

		if (placePhotoUrl) {
			const placePhoto = await fetchImageBytes(placePhotoUrl);
			if (placePhoto) return placePhoto;
		}

		const streetViewUrl = await getStreetViewImageUrl({
			key,
			lat: link.lat,
			lng: link.lng
		});

		if (streetViewUrl) {
			const streetViewPhoto = await fetchImageBytes(streetViewUrl);
			if (streetViewPhoto) return streetViewPhoto;
		}
	}

	redirect(307, `${url.origin}${DEFAULT_SOCIAL_IMAGE_PATH}`);
};
