export interface MapDestination {
	name: string;
	address: string;
	lat: number | null;
	lng: number | null;
}

export interface MapUrls {
	appleApp: string;
	appleWeb: string;
	google: string;
	waze: string;
}

export function buildMapUrls(destination: MapDestination): MapUrls {
	const query = destination.address.trim().length > 0 ? destination.address : destination.name;
	const nameQuery = destination.name.trim();
	const addressQuery = destination.address.trim();
	const placeQuery =
		nameQuery.length > 0 && addressQuery.length > 0
			? `${nameQuery}, ${addressQuery}`
			: nameQuery.length > 0
				? nameQuery
				: addressQuery;

	if (destination.lat !== null && destination.lng !== null) {
		const coordinatePair = `${destination.lat},${destination.lng}`;
		const googleQuery = placeQuery.length > 0 ? `${placeQuery} (${coordinatePair})` : coordinatePair;
		const wazeQuery = placeQuery.length > 0 ? placeQuery : query;

		return {
			appleWeb: `https://maps.apple.com/?q=${encodeURIComponent(destination.name)}&ll=${encodeURIComponent(coordinatePair)}`,
			appleApp: `maps://?q=${encodeURIComponent(destination.name)}&ll=${encodeURIComponent(coordinatePair)}`,
			google: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(googleQuery)}`,
			waze: `https://www.waze.com/ul?q=${encodeURIComponent(wazeQuery)}&ll=${encodeURIComponent(coordinatePair)}&navigate=yes`
		};
	}

	const encodedQuery = encodeURIComponent(query);
	return {
		appleWeb: `https://maps.apple.com/?q=${encodedQuery}`,
		appleApp: `maps://?q=${encodedQuery}`,
		google: `https://www.google.com/maps/search/?api=1&query=${encodedQuery}`,
		waze: `https://www.waze.com/ul?q=${encodedQuery}&navigate=yes`
	};
}

export function isIOSUserAgent(userAgent: string): boolean {
	const ua = userAgent || '';
	return /iPhone|iPad|iPod/i.test(ua);
}

export function getPreferredMapUrl(userAgent: string, urls: MapUrls): string {
	return isIOSUserAgent(userAgent) ? urls.appleApp : urls.google;
}

export function parseCoordinate(value: FormDataEntryValue | null, min: number, max: number): number | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (trimmed.length === 0) return null;

	const numeric = Number(trimmed);
	if (!Number.isFinite(numeric)) return null;
	if (numeric < min || numeric > max) return null;

	return numeric;
}

export function slugFromName(name: string): string {
	const core = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

	const fallback = core.length > 0 ? core : 'location';
	const suffix = Math.random().toString(36).slice(2, 7);
	return `${fallback}-${suffix}`;
}
