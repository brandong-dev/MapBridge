import { browser } from '$app/environment';

export interface DeviceHistoryLinkRecord {
	slug: string;
	name: string;
	address: string;
	notes: string;
	lat: number | null;
	lng: number | null;
	is_disabled: boolean;
	created_at: string;
	generated_url: string;
}

interface SaveDeviceHistoryInput {
	name: string;
	address: string;
	notes?: string;
	lat?: number | null;
	lng?: number | null;
	generatedUrl: string;
	createdAt?: string;
}

const DEVICE_HISTORY_KEY = 'navqr.device-history.v1';
const DEVICE_HISTORY_LIMIT = 50;

function parseSlugFromGeneratedUrl(generatedUrl: string): string {
	if (!browser) return '';

	try {
		const url = new URL(generatedUrl, window.location.origin);
		const [root, slug] = url.pathname.split('/').filter(Boolean);
		if (root === 'r' && slug) {
			return slug;
		}
		return '';
	} catch {
		return '';
	}
}

function sanitizeRecord(value: unknown): DeviceHistoryLinkRecord | null {
	if (!value || typeof value !== 'object') return null;

	const record = value as Partial<DeviceHistoryLinkRecord>;
	const slug = typeof record.slug === 'string' ? record.slug.trim() : '';
	const name = typeof record.name === 'string' ? record.name.trim() : '';
	const address = typeof record.address === 'string' ? record.address.trim() : '';
	const notes = typeof record.notes === 'string' ? record.notes.trim() : '';
	const generatedUrl = typeof record.generated_url === 'string' ? record.generated_url.trim() : '';
	const createdAt = typeof record.created_at === 'string' ? record.created_at : '';
	const lat = typeof record.lat === 'number' && Number.isFinite(record.lat) ? record.lat : null;
	const lng = typeof record.lng === 'number' && Number.isFinite(record.lng) ? record.lng : null;
	const isDisabled = record.is_disabled === true;

	if (name.length < 2 || address.length < 4 || generatedUrl.length === 0) return null;
	if (!Number.isFinite(Date.parse(createdAt))) return null;

	return {
		slug,
		name,
		address,
		notes,
		lat,
		lng,
		is_disabled: isDisabled,
		generated_url: generatedUrl,
		created_at: createdAt
	};
}

function writeHistory(records: DeviceHistoryLinkRecord[]): DeviceHistoryLinkRecord[] {
	if (!browser) return [];
	window.localStorage.setItem(DEVICE_HISTORY_KEY, JSON.stringify(records));
	return records;
}

export function loadDeviceHistory(): DeviceHistoryLinkRecord[] {
	if (!browser) return [];

	try {
		const raw = window.localStorage.getItem(DEVICE_HISTORY_KEY);
		if (!raw) return [];

		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];

		return parsed
			.map((entry) => sanitizeRecord(entry))
			.filter((entry): entry is DeviceHistoryLinkRecord => entry !== null)
			.slice(0, DEVICE_HISTORY_LIMIT);
	} catch {
		return [];
	}
}

export function saveDeviceHistory(input: SaveDeviceHistoryInput): DeviceHistoryLinkRecord[] {
	if (!browser) return [];

	const name = input.name.trim();
	const address = input.address.trim();
	const notes = typeof input.notes === 'string' ? input.notes.trim() : '';
	const generatedUrl = input.generatedUrl.trim();
	if (name.length < 2 || address.length < 4 || generatedUrl.length === 0) {
		return loadDeviceHistory();
	}

	const createdAt =
		typeof input.createdAt === 'string' && Number.isFinite(Date.parse(input.createdAt))
			? input.createdAt
			: new Date().toISOString();

	const nextRecord: DeviceHistoryLinkRecord = {
		slug: parseSlugFromGeneratedUrl(generatedUrl),
		name,
		address,
		notes,
		lat: typeof input.lat === 'number' && Number.isFinite(input.lat) ? input.lat : null,
		lng: typeof input.lng === 'number' && Number.isFinite(input.lng) ? input.lng : null,
		is_disabled: false,
		generated_url: generatedUrl,
		created_at: createdAt
	};

	const current = loadDeviceHistory();
	const deduped = current.filter((record) => record.generated_url !== nextRecord.generated_url);
	const next = [nextRecord, ...deduped].slice(0, DEVICE_HISTORY_LIMIT);
	return writeHistory(next);
}

export function clearDeviceHistory() {
	if (!browser) return;
	window.localStorage.removeItem(DEVICE_HISTORY_KEY);
}

function updateRecord(
	generatedUrl: string,
	mapper: (record: DeviceHistoryLinkRecord) => DeviceHistoryLinkRecord | null
) {
	if (!browser) return [];

	const targetUrl = generatedUrl.trim();
	if (targetUrl.length === 0) return loadDeviceHistory();

	const current = loadDeviceHistory();
	const next: DeviceHistoryLinkRecord[] = [];
	for (const record of current) {
		if (record.generated_url !== targetUrl) {
			next.push(record);
			continue;
		}

		const mapped = mapper(record);
		if (mapped) {
			next.push(mapped);
		}
	}

	return writeHistory(next);
}

export function editDeviceHistoryRecord(input: {
	generatedUrl: string;
	name: string;
	address: string;
	notes?: string;
	lat?: number | null;
	lng?: number | null;
}) {
	const name = input.name.trim();
	const address = input.address.trim();
	const notes = typeof input.notes === 'string' ? input.notes.trim() : '';
	const hasLat = typeof input.lat === 'number' && Number.isFinite(input.lat);
	const hasLng = typeof input.lng === 'number' && Number.isFinite(input.lng);
	const lat = hasLat ? input.lat! : null;
	const lng = hasLng ? input.lng! : null;

	return updateRecord(input.generatedUrl, (record) => {
		if (name.length < 2 || address.length < 4) return record;
		return {
			...record,
			name,
			address,
			notes,
			lat,
			lng
		};
	});
}

export function setDeviceHistoryDisabled(generatedUrl: string, isDisabled: boolean) {
	return updateRecord(generatedUrl, (record) => ({
		...record,
		is_disabled: isDisabled
	}));
}

export function deleteDeviceHistoryRecord(generatedUrl: string) {
	return updateRecord(generatedUrl, () => null);
}
