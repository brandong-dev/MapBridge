		<script lang="ts">
			import { enhance } from '$app/forms';
			import { browser } from '$app/environment';
			import { env as publicEnv } from '$env/dynamic/public';
		import {
			deleteDeviceHistoryRecord,
			editDeviceHistoryRecord,
			loadDeviceHistory,
			setDeviceHistoryDisabled,
			type DeviceHistoryLinkRecord
		} from '$lib/device-history';
		import { parseCoordinate } from '$lib/map';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';
	import { onMount } from 'svelte';
	import type { ActionData, PageData } from './$types';

let { data, form }: { data: PageData; form?: ActionData } = $props();
let deviceLinks = $state<DeviceHistoryLinkRecord[]>([]);
let deviceHistoryReady = $state(false);
let deviceQrByUrl = $state<Record<string, string>>({});
let accountQrBySlug = $state<Record<string, string>>({});
let historyDownloadError = $state('');
let historyMenuRef = $state<HTMLDivElement | null>(null);
let editingSlug = $state('');
let editName = $state('');
let editAddress = $state('');
let editNotes = $state('');
let editLat = $state('');
let editLng = $state('');
let editSearchValue = $state('');
let editSearchRef = $state<HTMLInputElement | null>(null);
let editMapsError = $state('');
let editingDeviceUrl = $state('');
let deviceEditName = $state('');
let deviceEditAddress = $state('');
let deviceEditNotes = $state('');
let deviceEditLat = $state('');
let deviceEditLng = $state('');
let deviceEditSearchValue = $state('');
let deviceEditSearchRef = $state<HTMLInputElement | null>(null);
let deviceMapsError = $state('');
let deviceManageError = $state('');
let deviceManageSuccess = $state('');

type PlaceGeometry = { location?: { lat: () => number; lng: () => number } };
type GooglePlace = { name?: string; formatted_address?: string; geometry?: PlaceGeometry };
type AutocompleteInstance = {
	addListener: (eventName: string, handler: () => void) => void;
	getPlace: () => GooglePlace;
};
type GoogleMapsWindow = Window & {
	google?: {
		maps?: {
			places?: {
				Autocomplete?: new (
					input: HTMLInputElement,
					options?: Record<string, unknown>
				) => AutocompleteInstance;
			};
			event?: { clearInstanceListeners: (instance: unknown) => void };
		};
	};
	__mapbridgePlacesPromise?: Promise<void>;
};

const googleMapsApiKey = publicEnv.PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? '';

	type HistoryDownloadFormat = 'png' | 'jpg' | 'webp' | 'svg';
	type HistoryMenuState = {
		key: string;
		generatedUrl: string;
		name: string;
		top: number;
		left: number;
		openUp: boolean;
		anchor: HTMLElement;
	};

	const HISTORY_MENU_WIDTH = 132;
	const HISTORY_MENU_GAP = 6;
	const HISTORY_MENU_MIN_EDGE = 8;
	const HISTORY_MENU_ESTIMATED_HEIGHT = 186;
	let historyMenu = $state<HistoryMenuState | null>(null);
	type AccountLink = PageData['links'][number];
	type PlanCard = {
		tier: 'free' | 'pro' | 'team';
		name: string;
		limit: string;
		copy: string;
	};
	const planCards: PlanCard[] = [
		{
			tier: 'free',
			name: 'Free',
			limit: '100 personal links',
			copy: 'Start with a lighter personal library and QR downloads.'
		},
		{
			tier: 'pro',
			name: 'Pro',
			limit: '2,000 personal links',
			copy: 'For heavier solo usage and a larger private destination library.'
		},
		{
			tier: 'team',
			name: 'Team',
			limit: '10,000 shared links per workspace',
			copy: 'Invite teammates into shared workspaces with private history.'
		}
	];

	const manageError = $derived(
		form && typeof form === 'object' && 'manageError' in form ? String(form.manageError ?? '') : ''
	);
	const manageSuccess = $derived(
		form && typeof form === 'object' && 'manageSuccess' in form ? String(form.manageSuccess ?? '') : ''
	);
	const teamError = $derived(
		form && typeof form === 'object' && 'teamError' in form ? String(form.teamError ?? '') : ''
	);
	const teamSuccess = $derived(
		form && typeof form === 'object' && 'teamSuccess' in form ? String(form.teamSuccess ?? '') : ''
	);
	const formActiveSlug = $derived(
		form && typeof form === 'object' && 'activeSlug' in form ? String(form.activeSlug ?? '') : ''
	);
	const formValues = $derived.by(() => {
		if (!form || typeof form !== 'object' || !('values' in form)) return null;
		const raw = form.values;
		if (!raw || typeof raw !== 'object') return null;
		const values = raw as Record<string, unknown>;
	return {
		name: typeof values.name === 'string' ? values.name : '',
		address: typeof values.address === 'string' ? values.address : '',
		notes: typeof values.notes === 'string' ? values.notes : '',
		lat: typeof values.lat === 'string' ? values.lat : '',
		lng: typeof values.lng === 'string' ? values.lng : ''
	};
	});

	const hasEditTarget = $derived(editingSlug.trim().length > 0);
	const hasDeviceEditTarget = $derived(editingDeviceUrl.trim().length > 0);
	const activeWorkspace = $derived(
		data.activeWorkspaceId
			? data.workspaces.find((workspace) => workspace.id === data.activeWorkspaceId) ?? null
			: null
	);

	function linkStatusLabel(link: AccountLink): string {
		return link.is_disabled ? 'Disabled' : 'Active';
	}

	function planCardIsCurrent(planTier: PlanCard['tier']): boolean {
		return data.planTier === planTier;
	}

	function formatMonthlyPrice(amountCents: number): string {
		return new Intl.NumberFormat(undefined, {
			style: 'currency',
			currency: 'USD',
			maximumFractionDigits: amountCents % 100 === 0 ? 0 : 2
		}).format(amountCents / 100);
	}

	function priceLabelForPlan(planTier: PlanCard['tier']): string {
		if (planTier === 'free') return 'Free';
		const amountCents =
			planTier === 'pro' ? data.billingPrices.proAmountCents : data.billingPrices.teamAmountCents;
		return `${formatMonthlyPrice(amountCents)}/mo`;
	}

	function billingStatusLabel(value: string | null): string {
		if (!value) return 'Not subscribed';
		return value.replace(/_/g, ' ');
	}

	function workspaceMemberLabel(member: PageData['activeWorkspaceMembers'][number]): string {
		if (member.email && member.email.trim().length > 0) return member.email;
		if (member.isCurrentUser) return 'You';
		return `Member ${member.userId.slice(0, 8)}`;
	}

	function workspaceRoleLabel(role: 'owner' | 'member'): string {
		return role === 'owner' ? 'Owner' : 'Member';
	}

	function formatInviteExpiry(value: string): string {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return value;
		return date.toLocaleString(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short'
		});
	}

	function deviceLinkStatusLabel(link: DeviceHistoryLinkRecord): string {
		return link.is_disabled ? 'Disabled' : 'Active';
	}

	function startEdit(link: AccountLink) {
		editingSlug = link.slug;
	editName = link.name;
	editAddress = link.address;
	editNotes = typeof link.notes === 'string' ? link.notes : '';
	editLat = typeof link.lat === 'number' && Number.isFinite(link.lat) ? String(link.lat) : '';
		editLng = typeof link.lng === 'number' && Number.isFinite(link.lng) ? String(link.lng) : '';
		editSearchValue = link.address;
		editMapsError = '';
	}

	function cancelEdit() {
		editingSlug = '';
	editName = '';
	editAddress = '';
	editNotes = '';
	editLat = '';
		editLng = '';
		editSearchValue = '';
		editMapsError = '';
	}

	function startDeviceEdit(link: DeviceHistoryLinkRecord) {
		editingDeviceUrl = link.generated_url;
	deviceEditName = link.name;
	deviceEditAddress = link.address;
	deviceEditNotes = typeof link.notes === 'string' ? link.notes : '';
	deviceEditLat = typeof link.lat === 'number' && Number.isFinite(link.lat) ? String(link.lat) : '';
		deviceEditLng = typeof link.lng === 'number' && Number.isFinite(link.lng) ? String(link.lng) : '';
		deviceEditSearchValue = link.address;
		deviceMapsError = '';
		deviceManageError = '';
		deviceManageSuccess = '';
	}

	function cancelDeviceEdit() {
		editingDeviceUrl = '';
	deviceEditName = '';
	deviceEditAddress = '';
	deviceEditNotes = '';
	deviceEditLat = '';
		deviceEditLng = '';
		deviceEditSearchValue = '';
		deviceMapsError = '';
	}

	function refreshDeviceHistory(records?: DeviceHistoryLinkRecord[]) {
		const nextRecords = records ?? loadDeviceHistory();
		deviceLinks = nextRecords;
		void buildDeviceQrMap(nextRecords);
	}

	function validateDeviceCoordinateInput() {
		const hasLat = deviceEditLat.trim().length > 0;
		const hasLng = deviceEditLng.trim().length > 0;
		if (hasLat !== hasLng) {
			return { error: 'Provide both latitude and longitude, or leave both empty.' };
		}

		const lat = parseCoordinate(deviceEditLat, -90, 90);
		const lng = parseCoordinate(deviceEditLng, -180, 180);
		if ((hasLat || hasLng) && (lat === null || lng === null)) {
			return {
				error: 'Latitude/longitude are invalid. Latitude must be -90..90 and longitude -180..180.'
			};
		}

		return { error: '', lat, lng };
	}

	function saveDeviceEdit(event: SubmitEvent) {
		event.preventDefault();
		deviceManageError = '';
		deviceManageSuccess = '';

		if (editingDeviceUrl.trim().length === 0) {
			deviceManageError = 'Select a link to edit first.';
			return;
		}

		const name = deviceEditName.trim();
		const address = deviceEditAddress.trim();
		const notes = deviceEditNotes.trim();
		if (name.length < 2) {
			deviceManageError = 'Location name must be at least 2 characters.';
			return;
		}

		if (address.length < 4) {
			deviceManageError = 'Address must be at least 4 characters.';
			return;
		}

		if (notes.length > 500) {
			deviceManageError = 'Notes must be 500 characters or fewer.';
			return;
		}

		const coordinates = validateDeviceCoordinateInput();
		if (coordinates.error.length > 0) {
			deviceManageError = coordinates.error;
			return;
		}

		const next = editDeviceHistoryRecord({
			generatedUrl: editingDeviceUrl,
			name,
			address,
			notes,
			lat: coordinates.lat ?? null,
			lng: coordinates.lng ?? null
		});
		refreshDeviceHistory(next);
		deviceManageSuccess = 'Link details updated on this device.';
		cancelDeviceEdit();
	}

	function toggleDeviceLink(link: DeviceHistoryLinkRecord) {
		deviceManageError = '';
		deviceManageSuccess = '';

		const nextDisabled = !link.is_disabled;
		const next = setDeviceHistoryDisabled(link.generated_url, nextDisabled);
		refreshDeviceHistory(next);
		deviceManageSuccess = nextDisabled
			? 'Link disabled on this device.'
			: 'Link enabled on this device.';
	}

	function deleteDeviceLink(link: DeviceHistoryLinkRecord) {
		if (!browser) return;
		if (!window.confirm('Delete this link from this device history?')) return;

		deviceManageError = '';
		deviceManageSuccess = '';
		const next = deleteDeviceHistoryRecord(link.generated_url);
		refreshDeviceHistory(next);
		if (editingDeviceUrl === link.generated_url) {
			cancelDeviceEdit();
		}
		if (historyMenu?.key === `guest-${link.generated_url}`) {
			historyMenu = null;
		}
		deviceManageSuccess = 'Link deleted from this device.';
	}

	function confirmDelete(event: SubmitEvent) {
		if (!browser) return;
		if (!window.confirm('Delete this link permanently? This cannot be undone.')) {
			event.preventDefault();
		}
	}

	function confirmDeleteWorkspace(event: SubmitEvent) {
		if (!browser) return;
		if (!window.confirm('Delete this workspace? This cannot be undone.')) {
			event.preventDefault();
		}
	}

	function sanitizeFilePart(value: string): string {
		return value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 48);
	}

	function historyQrFilenameBase(name: string): string {
		const fromName = sanitizeFilePart(name.trim());
		if (fromName.length > 0) return `navqr-${fromName}`;
		return 'navqr-code';
	}

	function triggerDownload(href: string, filename: string) {
		const anchor = document.createElement('a');
		anchor.href = href;
		anchor.download = filename;
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
	}

	async function historyRasterDataUrl(generatedUrl: string, format: Exclude<HistoryDownloadFormat, 'svg'>) {
		const { toCanvas } = await import('qrcode');
		const canvas = document.createElement('canvas');
		await toCanvas(canvas, generatedUrl, {
			width: 720,
			margin: 1,
			color: { light: '#ffffff' }
		});

		if (format === 'png') {
			return canvas.toDataURL('image/png');
		}
		if (format === 'jpg') {
			return canvas.toDataURL('image/jpeg', 0.92);
		}
		return canvas.toDataURL('image/webp', 0.92);
	}

	function toggleHistoryMenu(event: MouseEvent, key: string, generatedUrl: string, name: string) {
		if (!browser) return;

		const button = event.currentTarget;
		if (!(button instanceof HTMLElement)) return;

		if (historyMenu && historyMenu.key === key) {
			historyMenu = null;
			return;
		}

		const rect = button.getBoundingClientRect();
		const maxLeft = window.innerWidth - HISTORY_MENU_WIDTH - HISTORY_MENU_MIN_EDGE;
		const left = Math.max(HISTORY_MENU_MIN_EDGE, Math.min(rect.right - HISTORY_MENU_WIDTH, maxLeft));
		const spaceBelow = window.innerHeight - rect.bottom;
		const shouldOpenUp = spaceBelow < HISTORY_MENU_ESTIMATED_HEIGHT && rect.top > spaceBelow;
		const top = shouldOpenUp ? rect.top - HISTORY_MENU_GAP : rect.bottom + HISTORY_MENU_GAP;

		historyMenu = {
			key,
			generatedUrl,
			name,
			top,
			left,
			openUp: shouldOpenUp,
			anchor: button
		};
	}

	async function downloadHistoryQr(generatedUrl: string, name: string, format: HistoryDownloadFormat) {
		if (!browser) return;
		historyDownloadError = '';

		try {
			if (format === 'svg') {
				const { toString } = await import('qrcode');
				const svg = await toString(generatedUrl, { type: 'svg', margin: 1, width: 720, color: { light: '#ffffff' } });
				const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
				const blobUrl = URL.createObjectURL(blob);
				try {
					triggerDownload(blobUrl, `${historyQrFilenameBase(name)}.svg`);
				} finally {
					URL.revokeObjectURL(blobUrl);
				}
			} else {
				const dataUrl = await historyRasterDataUrl(generatedUrl, format);
				const extension = format === 'jpg' ? 'jpg' : format;
				triggerDownload(dataUrl, `${historyQrFilenameBase(name)}.${extension}`);
			}
		} catch {
			historyDownloadError = 'Unable to generate this QR download right now.';
		}
		historyMenu = null;
	}

async function buildDeviceQrMap(records: DeviceHistoryLinkRecord[]) {
	if (records.length === 0) {
		deviceQrByUrl = {};
		return;
	}

		try {
			const { toDataURL } = await import('qrcode');
			const pairs = await Promise.all(
				records.map(async (record) => {
					try {
						const qrDataUrl = await toDataURL(record.generated_url, {
							width: 96,
							margin: 1
						});
						return [record.generated_url, qrDataUrl] as const;
					} catch {
						return [record.generated_url, ''] as const;
					}
				})
			);

			const nextMap: Record<string, string> = {};
			for (const [url, qrDataUrl] of pairs) {
				if (qrDataUrl.length > 0) {
					nextMap[url] = qrDataUrl;
				}
			}
			deviceQrByUrl = nextMap;
		} catch {
			deviceQrByUrl = {};
	}
}

async function buildAccountQrMap(records: Array<{ slug: string }>) {
	if (records.length === 0) {
		accountQrBySlug = {};
		return;
	}

	try {
		const { toDataURL } = await import('qrcode');
		const pairs = await Promise.all(
			records.map(async (record) => {
				const slug = String(record.slug ?? '').trim();
				if (slug.length === 0) return ['', ''] as const;

				const linkUrl = `${data.origin}/r/${slug}`;
				try {
					const qrDataUrl = await toDataURL(linkUrl, {
						width: 96,
						margin: 1
					});
					return [slug, qrDataUrl] as const;
				} catch {
					return [slug, ''] as const;
				}
			})
		);

		const nextMap: Record<string, string> = {};
		for (const [slug, qrDataUrl] of pairs) {
			if (slug.length > 0 && qrDataUrl.length > 0) {
				nextMap[slug] = qrDataUrl;
			}
		}
		accountQrBySlug = nextMap;
	} catch {
		accountQrBySlug = {};
	}
}

function formatHistoryTimestamp(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;

	return date.toLocaleString(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short'
	});
}

function useBuilderHref(input: {
	generatedUrl: string;
	name: string;
	address: string;
	notes?: string;
	customSlug?: string;
	lat?: number | null;
	lng?: number | null;
}): string {
	const payload = {
		generatedUrl: String(input.generatedUrl ?? '').trim(),
		name: String(input.name ?? '').trim(),
		address: String(input.address ?? '').trim(),
		notes: String(input.notes ?? '').trim(),
		customSlug: String(input.customSlug ?? '').trim(),
		lat: typeof input.lat === 'number' && Number.isFinite(input.lat) ? String(input.lat) : '',
		lng: typeof input.lng === 'number' && Number.isFinite(input.lng) ? String(input.lng) : ''
	};

	const params = new URLSearchParams();
	params.set('use', JSON.stringify(payload));
	if (data.activeWorkspaceId) {
		params.set('workspace', data.activeWorkspaceId);
	}
	return `/?${params.toString()}`;
}

function deriveNameFromAddress(input: string): string {
	const first = input.split(',')[0]?.trim() ?? '';
	return first.length > 0 ? first : 'Pinned location';
}

function loadGooglePlacesLibrary(): Promise<void> {
	const key = googleMapsApiKey;
	if (key.length === 0) {
		return Promise.reject(new Error('Missing PUBLIC_GOOGLE_MAPS_API_KEY'));
	}

	const win = window as GoogleMapsWindow;
	if (win.google?.maps?.places?.Autocomplete) {
		return Promise.resolve();
	}

	if (win.__mapbridgePlacesPromise) {
		return win.__mapbridgePlacesPromise;
	}

	win.__mapbridgePlacesPromise = new Promise<void>((resolve, reject) => {
		const existing = document.getElementById('mapbridge-google-places-script') as HTMLScriptElement | null;
		if (existing) {
			existing.addEventListener('load', () => resolve(), { once: true });
			existing.addEventListener('error', () => reject(new Error('Google Maps script failed to load.')), {
				once: true
			});
			return;
		}

		const script = document.createElement('script');
		script.id = 'mapbridge-google-places-script';
		script.async = true;
		script.defer = true;
		script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&v=weekly`;
		script.addEventListener('load', () => resolve(), { once: true });
		script.addEventListener('error', () => reject(new Error('Google Maps script failed to load.')), {
			once: true
		});
		document.head.appendChild(script);
	});

	return win.__mapbridgePlacesPromise;
}

function applyPlaceToAccountEdit(place: GooglePlace) {
	const formattedAddress = place.formatted_address?.trim() ?? '';
	if (formattedAddress.length > 0) {
		editAddress = formattedAddress;
		editSearchValue = formattedAddress;
	}

	const fallbackAddress = formattedAddress || editAddress || editSearchValue;
	editName = place.name?.trim() || deriveNameFromAddress(fallbackAddress);

	const lat = place.geometry?.location?.lat?.();
	const lng = place.geometry?.location?.lng?.();
	editLat = Number.isFinite(lat) ? String(lat) : '';
	editLng = Number.isFinite(lng) ? String(lng) : '';
	editMapsError = '';
}

function applyPlaceToDeviceEdit(place: GooglePlace) {
	const formattedAddress = place.formatted_address?.trim() ?? '';
	if (formattedAddress.length > 0) {
		deviceEditAddress = formattedAddress;
		deviceEditSearchValue = formattedAddress;
	}

	const fallbackAddress = formattedAddress || deviceEditAddress || deviceEditSearchValue;
	deviceEditName = place.name?.trim() || deriveNameFromAddress(fallbackAddress);

	const lat = place.geometry?.location?.lat?.();
	const lng = place.geometry?.location?.lng?.();
	deviceEditLat = Number.isFinite(lat) ? String(lat) : '';
	deviceEditLng = Number.isFinite(lng) ? String(lng) : '';
	deviceMapsError = '';
}

$effect(() => {
	const slug = formActiveSlug.trim();
	if (slug.length === 0) return;
	editingSlug = slug;

	const nextValues = formValues;
	if (nextValues) {
		editName = nextValues.name;
		editAddress = nextValues.address;
		editNotes = nextValues.notes;
		editLat = nextValues.lat;
		editLng = nextValues.lng;
		editSearchValue = nextValues.address;
		return;
	}

	const linked = data.links.find((link) => link.slug === slug);
	if (linked) {
		editName = linked.name;
		editAddress = linked.address;
		editNotes = typeof linked.notes === 'string' ? linked.notes : '';
		editLat = typeof linked.lat === 'number' && Number.isFinite(linked.lat) ? String(linked.lat) : '';
		editLng = typeof linked.lng === 'number' && Number.isFinite(linked.lng) ? String(linked.lng) : '';
		editSearchValue = linked.address;
	}
});

$effect(() => {
	if (manageSuccess.length === 0) return;
	if (formActiveSlug.trim().length === 0) {
		cancelEdit();
	}
});

$effect(() => {
	if (!browser || !hasEditTarget || !editSearchRef) return;

	if (googleMapsApiKey.length === 0) {
		editMapsError = 'Google address search is unavailable right now.';
		return;
	}

	let disposed = false;
	let autocomplete: AutocompleteInstance | null = null;

	void loadGooglePlacesLibrary()
		.then(() => {
			if (disposed || !editSearchRef) return;

			const win = window as GoogleMapsWindow;
			const Autocomplete = win.google?.maps?.places?.Autocomplete;
			if (!Autocomplete) {
				throw new Error('Google Places Autocomplete unavailable.');
			}

			autocomplete = new Autocomplete(editSearchRef, {
				fields: ['name', 'formatted_address', 'geometry'],
				types: ['geocode', 'establishment']
			});
			autocomplete.addListener('place_changed', () => {
				const place = autocomplete?.getPlace();
				if (!place) return;
				applyPlaceToAccountEdit(place);
			});
		})
		.catch((error) => {
			if (disposed) return;
			console.error(error);
			editMapsError = 'Google address search is unavailable right now.';
		});

	return () => {
		disposed = true;
		const win = window as GoogleMapsWindow;
		if (autocomplete && win.google?.maps?.event?.clearInstanceListeners) {
			win.google.maps.event.clearInstanceListeners(autocomplete);
		}
	};
});

$effect(() => {
	if (!browser || !hasDeviceEditTarget || !deviceEditSearchRef) return;

	if (googleMapsApiKey.length === 0) {
		deviceMapsError = 'Google address search is unavailable right now.';
		return;
	}

	let disposed = false;
	let autocomplete: AutocompleteInstance | null = null;

	void loadGooglePlacesLibrary()
		.then(() => {
			if (disposed || !deviceEditSearchRef) return;

			const win = window as GoogleMapsWindow;
			const Autocomplete = win.google?.maps?.places?.Autocomplete;
			if (!Autocomplete) {
				throw new Error('Google Places Autocomplete unavailable.');
			}

			autocomplete = new Autocomplete(deviceEditSearchRef, {
				fields: ['name', 'formatted_address', 'geometry'],
				types: ['geocode', 'establishment']
			});
			autocomplete.addListener('place_changed', () => {
				const place = autocomplete?.getPlace();
				if (!place) return;
				applyPlaceToDeviceEdit(place);
			});
		})
		.catch((error) => {
			if (disposed) return;
			console.error(error);
			deviceMapsError = 'Google address search is unavailable right now.';
		});

	return () => {
		disposed = true;
		const win = window as GoogleMapsWindow;
		if (autocomplete && win.google?.maps?.event?.clearInstanceListeners) {
			win.google.maps.event.clearInstanceListeners(autocomplete);
		}
	};
});

onMount(() => {
	deviceLinks = loadDeviceHistory();
	deviceHistoryReady = true;
	void buildDeviceQrMap(deviceLinks);

		function handlePointerDown(event: PointerEvent) {
			if (!historyMenu) return;
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (historyMenuRef?.contains(target)) return;
			if (historyMenu.anchor.contains(target)) return;
			historyMenu = null;
		}

		function handleEscape(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				historyMenu = null;
			}
		}

		function handleViewportChange() {
			if (historyMenu) {
				historyMenu = null;
			}
		}

		document.addEventListener('pointerdown', handlePointerDown);
		document.addEventListener('keydown', handleEscape);
		window.addEventListener('resize', handleViewportChange);
		window.addEventListener('scroll', handleViewportChange, true);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown);
			document.removeEventListener('keydown', handleEscape);
		window.removeEventListener('resize', handleViewportChange);
		window.removeEventListener('scroll', handleViewportChange, true);
	};
});

$effect(() => {
	if (!browser) return;
	void buildAccountQrMap(data.links);
});
</script>

<svelte:head>
	<title>Account | NavQR</title>
	<meta name="description" content="View your NavQR history on this device or in your account." />
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="account-shell">
	<div class="mx-auto w-full max-w-6xl space-y-6 px-4 pb-10 pt-24 md:px-6">
		<section class="heading-stack">
			<p class="account-eyebrow">{data.user ? 'Cloud history' : 'Device history'}</p>
			<h1 class="account-title">Account history</h1>
			{#if data.user}
				<p class="account-copy">Signed in as {data.user.email}.</p>
			{:else}
				<p class="account-copy">Recent links are saved on this device.</p>
			{/if}
		</section>

		{#if data.user && data.supabaseReady}
			<div class="account-management-grid">
				<Card class="account-card">
					<CardHeader>
						<CardTitle>Plan and usage</CardTitle>
						<CardDescription>Current limits for your private library and team access.</CardDescription>
					</CardHeader>
					<CardContent class="space-y-5">
						{#if teamError}
							<p class="text-sm font-medium text-destructive">{teamError}</p>
						{/if}
						{#if teamSuccess}
							<p class="text-sm font-medium text-emerald-700">{teamSuccess}</p>
						{/if}
						{#if data.billingResult === 'success'}
							<p class="text-sm font-medium text-emerald-700">
								Checkout completed. Your plan will update as soon as Stripe confirms the subscription.
							</p>
						{:else if data.billingResult === 'cancelled'}
							<p class="text-sm font-medium text-slate-600">Checkout was cancelled.</p>
						{/if}

						<div class="team-summary-grid">
							<div class="team-summary-card">
								<p class="team-summary-label">Current plan</p>
								<p class="team-summary-value">{data.planTier.toUpperCase()}</p>
							</div>
							<div class="team-summary-card">
								<p class="team-summary-label">Personal library</p>
								<p class="team-summary-value">{data.personalLinkCount} / {data.linkLimit}</p>
							</div>
							<div class="team-summary-card">
								<p class="team-summary-label">Workspace creation</p>
								<p class="team-summary-value">{data.planTier === 'team' ? 'Enabled' : 'Team only'}</p>
							</div>
							<div class="team-summary-card">
								<p class="team-summary-label">Billing status</p>
								<p class="team-summary-value">{billingStatusLabel(data.billingSubscriptionStatus)}</p>
							</div>
						</div>

						{#if data.planTier !== 'free' && data.billingPortalReady}
							<form method="POST" action="?/manageBilling" use:enhance class="plan-billing-actions">
								<Button type="submit" size="sm" variant="outline">Manage billing</Button>
							</form>
						{:else if data.billingSetupIncomplete}
							<p class="plan-billing-note">
								Stripe checkout is configured, but the webhook secret still needs to be added before billing can be enabled.
							</p>
						{:else if !data.billingReady}
							<p class="plan-billing-note">Stripe billing is not configured yet.</p>
						{/if}

						<div class="plan-card-grid">
							{#each planCards as plan}
								<article class="plan-card" class:is-current={planCardIsCurrent(plan.tier)}>
									<div class="plan-card-top">
										<p class="plan-card-name">{plan.name}</p>
										{#if planCardIsCurrent(plan.tier)}
											<span class="plan-card-badge">Current</span>
										{/if}
									</div>
									<p class="plan-card-price">{priceLabelForPlan(plan.tier)}</p>
									<p class="plan-card-limit">{plan.limit}</p>
									<p class="plan-card-copy">{plan.copy}</p>
									{#if data.planTier === 'free' && plan.tier !== 'free' && data.billingReady}
										<form method="POST" action="?/startCheckout" use:enhance class="plan-card-action">
											<input type="hidden" name="planTier" value={plan.tier} />
											<Button type="submit" size="sm" variant="outline">Choose {plan.name}</Button>
										</form>
									{/if}
								</article>
							{/each}
						</div>
					</CardContent>
				</Card>

				<Card class="account-card">
					<CardHeader>
						<CardTitle>Workspace access</CardTitle>
						<CardDescription>Switch between personal history and private shared workspaces.</CardDescription>
					</CardHeader>
					<CardContent class="space-y-5">
						<div class="workspace-scope-pills" aria-label="Available history scopes">
							<a href="/account" class="workspace-scope-pill" class:is-active={data.activeWorkspaceId === null}>
								Personal
							</a>
							{#each data.workspaces as workspace}
								<a
									href={`/account?workspace=${workspace.id}`}
									class="workspace-scope-pill"
									class:is-active={data.activeWorkspaceId === workspace.id}
								>
									<span>{workspace.name}</span>
									<span class="workspace-scope-role">{workspaceRoleLabel(workspace.role)}</span>
								</a>
							{/each}
						</div>

						{#if data.activeWorkspaceId && activeWorkspace}
							<div class="workspace-active-banner">
								<p>
									Viewing <strong>{activeWorkspace.name}</strong> as {workspaceRoleLabel(activeWorkspace.role).toLowerCase()}.
								</p>
							</div>
						{/if}

						<form method="POST" action="?/joinWorkspace" use:enhance class="workspace-inline-form">
							<div class="manage-field">
								<Label for="join-invite-code">Join workspace by invite code</Label>
								<Input
									id="join-invite-code"
									name="inviteCode"
									placeholder="Paste invite code"
									autocomplete="off"
									spellcheck="false"
								/>
							</div>
							<Button type="submit" size="sm">Join</Button>
						</form>

						{#if data.planTier === 'team'}
							<form method="POST" action="?/createWorkspace" use:enhance class="workspace-inline-form">
								<div class="manage-field">
									<Label for="workspace-name">Create workspace</Label>
									<Input
										id="workspace-name"
										name="workspaceName"
										minlength={2}
										maxlength={80}
										placeholder="Team workspace name"
										required
									/>
								</div>
								<Button type="submit" size="sm">Create</Button>
							</form>
						{:else}
							<p class="team-upgrade-copy">Team unlocks shared workspace creation and owner controls.</p>
						{/if}
					</CardContent>
				</Card>
			</div>

			{#if data.activeWorkspaceId && activeWorkspace}
				<Card class="account-card">
					<CardHeader>
						<CardTitle>Active workspace</CardTitle>
						<CardDescription>Manage members, invite codes, and shared link capacity.</CardDescription>
					</CardHeader>
					<CardContent class="space-y-5">
						<div class="team-summary-grid">
							<div class="team-summary-card">
								<p class="team-summary-label">Role</p>
								<p class="team-summary-value">{workspaceRoleLabel(activeWorkspace.role)}</p>
							</div>
							<div class="team-summary-card">
								<p class="team-summary-label">Members</p>
								<p class="team-summary-value">{data.activeWorkspaceMembers.length}</p>
							</div>
							<div class="team-summary-card">
								<p class="team-summary-label">Shared links</p>
								<p class="team-summary-value">
									{data.activeWorkspaceLinkCount} / {data.teamLinkLimit}
								</p>
							</div>
							<div class="team-summary-card">
								<p class="team-summary-label">Open invites</p>
								<p class="team-summary-value">{data.activeWorkspaceInvites.length}</p>
							</div>
						</div>

						{#if activeWorkspace.role === 'owner'}
							<section class="workspace-manage-section">
								<div class="workspace-section-head">
									<div>
										<p class="workspace-section-label">Workspace details</p>
										<p class="workspace-section-copy">Rename the shared workspace shown in the navbar and account history.</p>
									</div>
								</div>
								<form method="POST" action="?/renameWorkspace" use:enhance class="workspace-inline-form">
									<input type="hidden" name="workspaceId" value={data.activeWorkspaceId} />
									<div class="manage-field">
										<Label for="active-workspace-name">Workspace name</Label>
										<Input
											id="active-workspace-name"
											name="workspaceName"
											minlength={2}
											maxlength={80}
											value={activeWorkspace.name}
											required
										/>
									</div>
									<Button type="submit" size="sm" variant="outline">Save</Button>
								</form>
							</section>

							<section class="workspace-manage-section">
								<div class="workspace-section-head">
									<div>
										<p class="workspace-section-label">Invite codes</p>
										<p class="workspace-section-copy">Create private invite codes for new members.</p>
									</div>
									<form method="POST" action="?/createInvite" use:enhance>
										<input type="hidden" name="workspaceId" value={data.activeWorkspaceId} />
										<Button type="submit" size="sm" variant="outline">Create invite</Button>
									</form>
								</div>
								{#if data.activeWorkspaceInvites.length === 0}
									<p class="workspace-empty-copy">No active invite codes yet.</p>
								{:else}
									<div class="workspace-list">
										{#each data.activeWorkspaceInvites as invite}
											<div class="workspace-list-row">
												<div class="workspace-list-copy">
													<p class="workspace-list-title">{invite.code}</p>
													<p class="workspace-list-meta">
														Expires {formatInviteExpiry(invite.expiresAt)}
													</p>
												</div>
												<form method="POST" action="?/revokeInvite" use:enhance>
													<input type="hidden" name="workspaceId" value={data.activeWorkspaceId} />
													<input type="hidden" name="inviteId" value={invite.id} />
													<Button type="submit" size="sm" variant="ghost">Revoke</Button>
												</form>
											</div>
										{/each}
									</div>
								{/if}
							</section>

							<section class="workspace-manage-section">
								<div class="workspace-section-head">
									<div>
										<p class="workspace-section-label">Members</p>
										<p class="workspace-section-copy">Owners can remove member access from this workspace.</p>
									</div>
								</div>
								<div class="workspace-list">
									{#each data.activeWorkspaceMembers as member}
										<div class="workspace-list-row">
											<div class="workspace-list-copy">
												<p class="workspace-list-title">{workspaceMemberLabel(member)}</p>
												<p class="workspace-list-meta">
													{workspaceRoleLabel(member.role)}{member.isCurrentUser ? ' · You' : ''}
												</p>
											</div>
											{#if !member.isCurrentUser && member.role !== 'owner'}
												<form method="POST" action="?/removeMember" use:enhance>
													<input type="hidden" name="workspaceId" value={data.activeWorkspaceId} />
													<input type="hidden" name="memberUserId" value={member.userId} />
													<Button type="submit" size="sm" variant="ghost">Remove</Button>
												</form>
											{/if}
										</div>
									{/each}
								</div>
							</section>

							<section class="workspace-manage-section workspace-danger-zone">
								<div class="workspace-section-head">
									<div>
										<p class="workspace-section-label">Danger zone</p>
										<p class="workspace-section-copy">
											Delete this workspace after removing its shared links.
										</p>
									</div>
								</div>
								<form
									method="POST"
									action="?/deleteWorkspace"
									use:enhance
									class="workspace-inline-form"
									onsubmit={confirmDeleteWorkspace}
								>
									<input type="hidden" name="workspaceId" value={data.activeWorkspaceId} />
									<Button type="submit" size="sm" variant="destructive">Delete workspace</Button>
								</form>
							</section>
						{:else}
							<section class="workspace-manage-section">
								<div class="workspace-section-head">
									<div>
										<p class="workspace-section-label">Members</p>
										<p class="workspace-section-copy">You can view the current workspace roster.</p>
									</div>
								</div>
								<div class="workspace-list">
									{#each data.activeWorkspaceMembers as member}
										<div class="workspace-list-row">
											<div class="workspace-list-copy">
												<p class="workspace-list-title">{workspaceMemberLabel(member)}</p>
												<p class="workspace-list-meta">
													{workspaceRoleLabel(member.role)}{member.isCurrentUser ? ' · You' : ''}
												</p>
											</div>
										</div>
									{/each}
								</div>
							</section>

							<form method="POST" action="?/leaveWorkspace" use:enhance class="workspace-inline-form">
								<input type="hidden" name="workspaceId" value={data.activeWorkspaceId} />
								<Button type="submit" size="sm" variant="outline">Leave workspace</Button>
							</form>
						{/if}
					</CardContent>
				</Card>
			{/if}
		{/if}

		{#if !data.user}
			<Card class="account-card">
				<CardHeader>
					<CardTitle>This device</CardTitle>
					<CardDescription>Your recent QR link history in this browser.</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					{#if deviceManageError}
						<p class="text-sm font-medium text-destructive">{deviceManageError}</p>
					{/if}
					{#if deviceManageSuccess}
						<p class="text-sm font-medium text-emerald-700">{deviceManageSuccess}</p>
					{/if}

					{#if hasDeviceEditTarget}
						<section class="manage-panel">
							<div class="manage-panel-head">
								<p class="manage-panel-title">Editing this device record</p>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									class="h-7 px-2 text-xs text-slate-600"
									onclick={cancelDeviceEdit}
								>
									Cancel
								</Button>
							</div>
							<form class="manage-panel-form" onsubmit={saveDeviceEdit}>
								<div class="manage-field">
									<Label for="device-edit-search">Search address</Label>
									<Input
										id="device-edit-search"
										bind:ref={deviceEditSearchRef}
										bind:value={deviceEditSearchValue}
										placeholder="Search place or address"
										autocomplete="off"
										oninput={() => (deviceMapsError = '')}
									/>
									{#if deviceMapsError}
										<p class="manage-field-error">{deviceMapsError}</p>
									{/if}
								</div>
								<div class="manage-field">
									<Label for="device-edit-name">Location name</Label>
									<Input id="device-edit-name" bind:value={deviceEditName} minlength={2} required />
								</div>
								<div class="manage-field">
									<Label for="device-edit-address">Address</Label>
									<Input id="device-edit-address" bind:value={deviceEditAddress} minlength={4} required />
								</div>
								<div class="manage-field">
									<Label for="device-edit-notes">Notes (optional)</Label>
									<Textarea
										id="device-edit-notes"
										bind:value={deviceEditNotes}
										rows={3}
										maxlength={500}
										placeholder="Add extra details for anyone opening this link."
									/>
								</div>
								<details class="manage-advanced">
									<summary>Advanced coordinates</summary>
									<div class="manage-coordinates">
										<div class="manage-field">
											<Label for="device-edit-lat">Latitude (optional)</Label>
											<Input id="device-edit-lat" bind:value={deviceEditLat} inputmode="decimal" />
										</div>
										<div class="manage-field">
											<Label for="device-edit-lng">Longitude (optional)</Label>
											<Input id="device-edit-lng" bind:value={deviceEditLng} inputmode="decimal" />
										</div>
									</div>
								</details>
								<div class="manage-panel-actions">
									<Button type="submit" size="sm">Save changes</Button>
								</div>
							</form>
						</section>
					{/if}

					{#if !deviceHistoryReady}
						<p class="text-sm text-slate-500">Loading device history...</p>
					{:else if deviceLinks.length === 0}
						<p class="text-sm text-slate-500">No saved links yet on this device.</p>
					{:else}
						<div class="history-table-desktop">
							<div class="history-table-shell">
								<Table class="history-table">
									<TableHeader>
										<TableRow>
											<TableHead>Destination</TableHead>
											<TableHead>QR</TableHead>
											<TableHead>Link</TableHead>
											<TableHead>Download</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{#each deviceLinks as link}
											<TableRow
												class={`${link.is_disabled ? 'history-row-disabled ' : ''}${editingDeviceUrl === link.generated_url ? 'history-row-editing' : ''}`}
											>
												<TableCell class="history-destination-cell">
													<div class="history-destination-top">
														<p class="history-name">{link.name}</p>
														<p class="history-status-pill" class:is-disabled={link.is_disabled}>
															{deviceLinkStatusLabel(link)}
														</p>
													</div>
													<p class="history-address">{link.address}</p>
													{#if link.notes && link.notes.trim().length > 0}
														<p class="history-notes">{link.notes}</p>
													{/if}
													<p class="history-meta">{formatHistoryTimestamp(link.created_at)}</p>
												</TableCell>
												<TableCell class="w-[4.5rem] min-w-[4.5rem]">
													{#if deviceQrByUrl[link.generated_url]}
														<img
															src={deviceQrByUrl[link.generated_url]}
															alt={`QR code for ${link.name}`}
															class="history-qr"
														/>
													{:else}
														<span class="text-xs text-slate-500">Unavailable</span>
													{/if}
												</TableCell>
												<TableCell class="history-link-cell">
													<div class="history-link-stack">
														{#if link.is_disabled}
															<span class="history-link is-disabled">
																{link.slug.length > 0 ? `/r/${link.slug}` : 'Open link'}
															</span>
														{:else}
															<a class="history-link" href={link.generated_url}>
																{link.slug.length > 0 ? `/r/${link.slug}` : 'Open link'}
															</a>
														{/if}
														<a
															class="history-use-link"
															href={useBuilderHref({
																generatedUrl: link.generated_url,
																name: link.name,
																address: link.address,
																notes: link.notes ?? '',
																customSlug: link.slug,
																lat: link.lat,
																lng: link.lng
															})}
														>
															Use in builder
															</a>
															<div class="history-manage-actions">
																<button type="button" class="history-manage-action" onclick={() => startDeviceEdit(link)}>
																	Edit
																</button>
																<button
																	type="button"
																	class="history-manage-action"
																	onclick={() => toggleDeviceLink(link)}
																>
																	{link.is_disabled ? 'Enable' : 'Disable'}
																</button>
																<button
																	type="button"
																	class="history-manage-action is-danger"
																	onclick={() => deleteDeviceLink(link)}
																>
																	Delete
																</button>
															</div>
														</div>
													</TableCell>
												<TableCell class="w-[7.4rem] min-w-[7.4rem]">
													<button
														type="button"
														class="history-download-trigger"
														class:is-open={historyMenu?.key === `guest-${link.generated_url}`}
														onclick={(event) =>
															toggleHistoryMenu(event, `guest-${link.generated_url}`, link.generated_url, link.name)}
													>
														Download
													</button>
												</TableCell>
											</TableRow>
										{/each}
									</TableBody>
								</Table>
							</div>
						</div>

						<div class="history-mobile-list">
							{#each deviceLinks as link}
								<article
									class="history-mobile-item"
									class:is-disabled={link.is_disabled}
									class:is-editing={editingDeviceUrl === link.generated_url}
								>
									<div class="history-mobile-top">
										<div class="history-mobile-copy">
											<p class="history-name">{link.name}</p>
											<p class="history-status-pill" class:is-disabled={link.is_disabled}>
												{deviceLinkStatusLabel(link)}
											</p>
											<p class="history-meta">{formatHistoryTimestamp(link.created_at)}</p>
										</div>
										<button
											type="button"
											class="history-download-trigger"
											class:is-open={historyMenu?.key === `guest-${link.generated_url}`}
											onclick={(event) =>
												toggleHistoryMenu(event, `guest-${link.generated_url}`, link.generated_url, link.name)}
										>
											Download
										</button>
									</div>
									<p class="history-address">{link.address}</p>
									{#if link.notes && link.notes.trim().length > 0}
										<p class="history-notes">{link.notes}</p>
									{/if}
									<div class="history-mobile-bottom">
										<div class="history-mobile-qr">
											{#if deviceQrByUrl[link.generated_url]}
												<img
													src={deviceQrByUrl[link.generated_url]}
													alt={`QR code for ${link.name}`}
													class="history-qr"
												/>
											{:else}
												<span class="text-xs text-slate-500">Unavailable</span>
											{/if}
										</div>
										<div class="history-mobile-link-stack">
											{#if link.is_disabled}
												<span class="history-link is-disabled">
													{link.slug.length > 0 ? `/r/${link.slug}` : 'Open link'}
												</span>
											{:else}
												<a class="history-link" href={link.generated_url}>
													{link.slug.length > 0 ? `/r/${link.slug}` : 'Open link'}
												</a>
											{/if}
											<a
												class="history-use-link"
												href={useBuilderHref({
													generatedUrl: link.generated_url,
													name: link.name,
													address: link.address,
													notes: link.notes ?? '',
													customSlug: link.slug,
													lat: link.lat,
													lng: link.lng
												})}
											>
												Use in builder
												</a>
												<div class="history-manage-actions">
													<button type="button" class="history-manage-action" onclick={() => startDeviceEdit(link)}>
														Edit
													</button>
													<button
														type="button"
														class="history-manage-action"
														onclick={() => toggleDeviceLink(link)}
													>
														{link.is_disabled ? 'Enable' : 'Disable'}
													</button>
													<button
														type="button"
														class="history-manage-action is-danger"
														onclick={() => deleteDeviceLink(link)}
													>
														Delete
													</button>
												</div>
											</div>
										</div>
								</article>
							{/each}
						</div>
					{/if}

					{#if historyDownloadError}
						<p class="text-sm text-destructive">{historyDownloadError}</p>
					{/if}

					{#if data.supabaseReady}
						<Button href="/auth">Sign in to sync across devices</Button>
					{:else if data.loadError}
						<p class="text-sm text-muted-foreground">{data.loadError}</p>
					{/if}
				</CardContent>
			</Card>
		{:else if !data.supabaseReady}
			<Card class="account-card">
				<CardHeader>
					<CardTitle>Supabase not configured</CardTitle>
					<CardDescription>
						Set environment variables and create the `links` table before using account features.
					</CardDescription>
				</CardHeader>
				<CardContent class="text-sm text-muted-foreground">
					<p>{data.loadError}</p>
				</CardContent>
			</Card>
		{:else}
			<Card class="account-card">
				<CardHeader>
					<CardTitle>{data.activeWorkspaceId ? 'Workspace links' : 'Your links'}</CardTitle>
					<CardDescription>
						{data.activeWorkspaceId
							? 'Visible to members in this shared workspace.'
							: 'Visible only to your signed-in account.'}
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					{#if manageError}
						<p class="text-sm font-medium text-destructive">{manageError}</p>
					{/if}
					{#if manageSuccess}
						<p class="text-sm font-medium text-emerald-700">{manageSuccess}</p>
					{/if}

					{#if hasEditTarget}
						<section class="manage-panel">
							<div class="manage-panel-head">
								<p class="manage-panel-title">Editing /r/{editingSlug}</p>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									class="h-7 px-2 text-xs text-slate-600"
									onclick={cancelEdit}
								>
									Cancel
								</Button>
							</div>
								<form method="POST" action="?/updateLink" use:enhance class="manage-panel-form">
									<input type="hidden" name="slug" value={editingSlug} />
									<div class="manage-field">
										<Label for="edit-search">Search address</Label>
										<Input
											id="edit-search"
											bind:ref={editSearchRef}
											bind:value={editSearchValue}
											placeholder="Search place or address"
											autocomplete="off"
											oninput={() => (editMapsError = '')}
										/>
										{#if editMapsError}
											<p class="manage-field-error">{editMapsError}</p>
										{/if}
									</div>
									<div class="manage-field">
										<Label for="edit-name">Location name</Label>
										<Input id="edit-name" name="name" bind:value={editName} minlength={2} required />
									</div>
									<div class="manage-field">
										<Label for="edit-address">Address</Label>
										<Input id="edit-address" name="address" bind:value={editAddress} minlength={4} required />
									</div>
									<div class="manage-field">
										<Label for="edit-notes">Notes (optional)</Label>
										<Textarea
											id="edit-notes"
											name="notes"
											bind:value={editNotes}
											rows={3}
											maxlength={500}
											placeholder="Add extra details for anyone opening this link."
										/>
									</div>
									<details class="manage-advanced">
										<summary>Advanced coordinates</summary>
										<div class="manage-coordinates">
											<div class="manage-field">
												<Label for="edit-lat">Latitude (optional)</Label>
												<Input id="edit-lat" name="lat" bind:value={editLat} inputmode="decimal" />
											</div>
											<div class="manage-field">
												<Label for="edit-lng">Longitude (optional)</Label>
												<Input id="edit-lng" name="lng" bind:value={editLng} inputmode="decimal" />
											</div>
										</div>
									</details>
									<div class="manage-panel-actions">
										<Button type="submit" size="sm">Save changes</Button>
									</div>
								</form>
							</section>
					{/if}

					{#if data.links.length === 0}
						<p class="text-sm text-slate-500">No saved links yet.</p>
					{:else}
						<div class="history-table-desktop">
							<div class="history-table-shell">
								<Table class="history-table">
									<TableHeader>
										<TableRow>
											<TableHead>Destination</TableHead>
											<TableHead>QR</TableHead>
											<TableHead>Link</TableHead>
											<TableHead>Download</TableHead>
										</TableRow>
										</TableHeader>
										<TableBody>
											{#each data.links as link}
												<TableRow
													class={`${link.is_disabled ? 'history-row-disabled ' : ''}${editingSlug === link.slug ? 'history-row-editing' : ''}`}
												>
													<TableCell class="history-destination-cell">
														<div class="history-destination-top">
															<p class="history-name">{link.name}</p>
															<p class="history-status-pill" class:is-disabled={link.is_disabled}>
																{linkStatusLabel(link)}
															</p>
														</div>
														<p class="history-address">{link.address}</p>
														{#if link.notes && link.notes.trim().length > 0}
															<p class="history-notes">{link.notes}</p>
														{/if}
														<p class="history-meta">{formatHistoryTimestamp(link.created_at)}</p>
													</TableCell>
													<TableCell class="w-[4.5rem] min-w-[4.5rem]">
														{#if accountQrBySlug[link.slug]}
														<img
															src={accountQrBySlug[link.slug]}
															alt={`QR code for ${link.name}`}
															class="history-qr"
														/>
													{:else}
														<span class="text-xs text-slate-500">Unavailable</span>
													{/if}
												</TableCell>
												<TableCell class="history-link-cell">
													<div class="history-link-stack">
														<a class="history-link" href={`/r/${link.slug}`}>
															/r/{link.slug}
														</a>
														<a
															class="history-use-link"
																href={useBuilderHref({
																	generatedUrl: `${data.origin}/r/${link.slug}`,
																	name: link.name,
																	address: link.address,
																	notes: link.notes ?? '',
																	customSlug: link.slug,
																	lat: link.lat,
																	lng: link.lng
															})}
																>
																	Use in builder
																</a>
																<div class="history-manage-actions">
																	<button type="button" class="history-manage-action" onclick={() => startEdit(link)}>
																		Edit
																	</button>
																	<form method="POST" action="?/toggleLink" use:enhance class="history-inline-form">
																		<input type="hidden" name="slug" value={link.slug} />
																		<input type="hidden" name="disable" value={link.is_disabled ? 'false' : 'true'} />
																		<button type="submit" class="history-manage-action">
																			{link.is_disabled ? 'Enable' : 'Disable'}
																		</button>
																	</form>
																	<form
																		method="POST"
																		action="?/deleteLink"
																		use:enhance
																		class="history-inline-form"
																		onsubmit={confirmDelete}
																	>
																		<input type="hidden" name="slug" value={link.slug} />
																		<button type="submit" class="history-manage-action is-danger">
																			Delete
																		</button>
																	</form>
																</div>
															</div>
														</TableCell>
													<TableCell class="w-[7.4rem] min-w-[7.4rem]">
														<button
															type="button"
														class="history-download-trigger"
														class:is-open={historyMenu?.key === `account-${link.slug}`}
														onclick={(event) =>
															toggleHistoryMenu(
																event,
																`account-${link.slug}`,
																`${data.origin}/r/${link.slug}`,
																link.name
															)}
													>
														Download
													</button>
												</TableCell>
											</TableRow>
										{/each}
									</TableBody>
								</Table>
							</div>
						</div>

						<div class="history-mobile-list">
							{#each data.links as link}
								<article
									class="history-mobile-item"
									class:is-disabled={link.is_disabled}
									class:is-editing={editingSlug === link.slug}
								>
									<div class="history-mobile-top">
										<div class="history-mobile-copy">
											<p class="history-name">{link.name}</p>
											<p class="history-status-pill" class:is-disabled={link.is_disabled}>
												{linkStatusLabel(link)}
											</p>
											<p class="history-meta">{formatHistoryTimestamp(link.created_at)}</p>
										</div>
										<button
											type="button"
											class="history-download-trigger"
											class:is-open={historyMenu?.key === `account-${link.slug}`}
											onclick={(event) =>
												toggleHistoryMenu(
													event,
													`account-${link.slug}`,
													`${data.origin}/r/${link.slug}`,
													link.name
												)}
										>
											Download
										</button>
									</div>
									<p class="history-address">{link.address}</p>
									{#if link.notes && link.notes.trim().length > 0}
										<p class="history-notes">{link.notes}</p>
									{/if}
									<div class="history-mobile-bottom">
										<div class="history-mobile-qr">
											{#if accountQrBySlug[link.slug]}
												<img
													src={accountQrBySlug[link.slug]}
													alt={`QR code for ${link.name}`}
													class="history-qr"
												/>
											{:else}
												<span class="text-xs text-slate-500">Unavailable</span>
											{/if}
										</div>
										<div class="history-mobile-link-stack">
											<a class="history-link" href={`/r/${link.slug}`}>
												/r/{link.slug}
											</a>
											<a
												class="history-use-link"
												href={useBuilderHref({
													generatedUrl: `${data.origin}/r/${link.slug}`,
													name: link.name,
													address: link.address,
													notes: link.notes ?? '',
													customSlug: link.slug,
													lat: link.lat,
													lng: link.lng
												})}
											>
												Use in builder
												</a>
												<div class="history-manage-actions">
													<button type="button" class="history-manage-action" onclick={() => startEdit(link)}>
														Edit
													</button>
														<form method="POST" action="?/toggleLink" use:enhance class="history-inline-form">
														<input type="hidden" name="slug" value={link.slug} />
														<input type="hidden" name="disable" value={link.is_disabled ? 'false' : 'true'} />
														<button type="submit" class="history-manage-action">
															{link.is_disabled ? 'Enable' : 'Disable'}
														</button>
													</form>
													<form method="POST" action="?/deleteLink" use:enhance class="history-inline-form" onsubmit={confirmDelete}>
														<input type="hidden" name="slug" value={link.slug} />
														<button type="submit" class="history-manage-action is-danger">
															Delete
														</button>
													</form>
												</div>
											</div>
										</div>
								</article>
							{/each}
						</div>
					{/if}

					{#if historyDownloadError}
						<p class="text-sm text-destructive">{historyDownloadError}</p>
					{/if}
				</CardContent>
			</Card>
			{/if}
		</div>

		{#if historyMenu}
			<div
				bind:this={historyMenuRef}
				class="history-download-popover"
				style={`top:${historyMenu.top}px;left:${historyMenu.left}px;${historyMenu.openUp ? 'transform: translateY(-100%);' : ''}`}
			>
				<button type="button" class="history-download-option" onclick={() => void downloadHistoryQr(historyMenu!.generatedUrl, historyMenu!.name, 'png')}>
					PNG
				</button>
				<button type="button" class="history-download-option" onclick={() => void downloadHistoryQr(historyMenu!.generatedUrl, historyMenu!.name, 'jpg')}>
					JPG
				</button>
				<button type="button" class="history-download-option" onclick={() => void downloadHistoryQr(historyMenu!.generatedUrl, historyMenu!.name, 'webp')}>
					WEBP
				</button>
				<button type="button" class="history-download-option" onclick={() => void downloadHistoryQr(historyMenu!.generatedUrl, historyMenu!.name, 'svg')}>
					SVG
				</button>
			</div>
		{/if}
	</main>

<style>
	.account-shell {
		min-height: 100vh;
	}

	.heading-stack {
		display: grid;
		gap: 0.4rem;
	}

	.account-eyebrow {
		margin: 0;
		display: inline-flex;
		width: fit-content;
		align-items: center;
		padding: 0.24rem 0.56rem;
		border-radius: 999px;
		border: 1px solid rgba(14, 116, 144, 0.28);
		background: rgba(224, 242, 254, 0.78);
		font-size: 0.69rem;
		font-weight: 700;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: #0e7490;
	}

	.account-title {
		margin: 0;
		font-size: clamp(1.55rem, 3vw, 2.2rem);
		line-height: 1.12;
		font-weight: 800;
		letter-spacing: -0.03em;
		color: #0f172a;
	}

	.account-copy {
		margin: 0;
		font-size: 0.96rem;
		line-height: 1.5;
		color: #334155;
	}

	:global(.account-card) {
		border-radius: 1rem;
		border: 1px solid rgba(148, 163, 184, 0.32);
		border-top-color: rgba(14, 116, 144, 0.34);
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.9));
		backdrop-filter: blur(10px);
		box-shadow:
			0 14px 34px rgba(15, 23, 42, 0.08),
			inset 0 1px 0 rgba(255, 255, 255, 0.72);
	}

	:global(.account-card [data-slot='card-title']) {
		font-size: 0.82rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #475569;
	}

	:global(.account-card [data-slot='card-description']) {
		color: #64748b;
	}

	.account-management-grid {
		display: grid;
		gap: 1rem;
	}

	.team-summary-grid {
		display: grid;
		gap: 0.58rem;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.team-summary-card {
		padding: 0.72rem 0.8rem;
		border-radius: 0.88rem;
		border: 1px solid rgba(148, 163, 184, 0.22);
		background: rgba(248, 250, 252, 0.72);
	}

	.team-summary-label {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #64748b;
	}

	.team-summary-value {
		margin: 0.15rem 0 0;
		font-size: 0.96rem;
		font-weight: 700;
		color: #0f172a;
	}

	.plan-card-grid {
		display: grid;
		gap: 0.7rem;
	}

	.plan-billing-actions {
		display: flex;
		justify-content: flex-start;
	}

	.plan-billing-note {
		margin: 0;
		font-size: 0.83rem;
		line-height: 1.5;
		color: #64748b;
	}

	.plan-card {
		display: grid;
		gap: 0.42rem;
		padding: 0.9rem;
		border-radius: 1rem;
		border: 1px solid rgba(148, 163, 184, 0.24);
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(248, 250, 252, 0.78));
	}

	.plan-card.is-current {
		border-color: rgba(14, 116, 144, 0.3);
		background:
			linear-gradient(180deg, rgba(240, 249, 255, 0.96), rgba(248, 250, 252, 0.82));
		box-shadow:
			0 14px 30px rgba(14, 116, 144, 0.08),
			inset 0 1px 0 rgba(255, 255, 255, 0.82);
	}

	.plan-card-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.plan-card-name {
		margin: 0;
		font-size: 0.94rem;
		font-weight: 700;
		color: #0f172a;
	}

	.plan-card-badge {
		display: inline-flex;
		align-items: center;
		height: 1.45rem;
		padding: 0 0.5rem;
		border-radius: 999px;
		background: rgba(14, 116, 144, 0.12);
		font-size: 0.7rem;
		font-weight: 700;
		color: #0e7490;
	}

	.plan-card-price {
		margin: 0;
		font-size: 1rem;
		font-weight: 800;
		color: #0f172a;
	}

	.plan-card-limit {
		margin: 0;
		font-size: 0.82rem;
		font-weight: 700;
		color: #0369a1;
	}

	.plan-card-copy {
		margin: 0;
		font-size: 0.83rem;
		line-height: 1.5;
		color: #475569;
	}

	.plan-card-action {
		padding-top: 0.2rem;
	}

	.workspace-scope-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.55rem;
	}

	.workspace-scope-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 2rem;
		padding: 0.45rem 0.72rem;
		border-radius: 999px;
		border: 1px solid rgba(148, 163, 184, 0.26);
		background: rgba(248, 250, 252, 0.84);
		font-size: 0.82rem;
		font-weight: 600;
		color: #0f172a;
		text-decoration: none;
	}

	.workspace-scope-pill.is-active {
		border-color: rgba(14, 116, 144, 0.28);
		background: rgba(240, 249, 255, 0.92);
		color: #0c4a6e;
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.78);
	}

	.workspace-scope-role {
		color: #64748b;
		font-size: 0.74rem;
	}

	.workspace-inline-form {
		display: grid;
		gap: 0.58rem;
	}

	.workspace-active-banner {
		padding: 0.58rem 0.68rem;
		border-radius: 0.74rem;
		border: 1px solid rgba(125, 211, 252, 0.36);
		background: rgba(240, 249, 255, 0.75);
	}

	.workspace-active-banner p {
		margin: 0;
		font-size: 0.84rem;
		color: #0f172a;
	}

	.team-upgrade-copy {
		margin: 0;
		font-size: 0.83rem;
		color: #64748b;
	}

	.workspace-manage-section {
		display: grid;
		gap: 0.85rem;
		padding-top: 0.1rem;
	}

	.workspace-section-head {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 0.9rem;
	}

	.workspace-section-label {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #64748b;
	}

	.workspace-section-copy,
	.workspace-empty-copy {
		margin: 0;
		font-size: 0.84rem;
		line-height: 1.5;
		color: #64748b;
	}

	.workspace-list {
		display: grid;
		gap: 0.62rem;
	}

	.workspace-list-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.9rem;
		padding: 0.78rem 0.82rem;
		border-radius: 0.88rem;
		border: 1px solid rgba(148, 163, 184, 0.2);
		background: rgba(248, 250, 252, 0.68);
	}

	.workspace-list-copy {
		min-width: 0;
		display: grid;
		gap: 0.14rem;
	}

	.workspace-list-title {
		margin: 0;
		font-size: 0.88rem;
		font-weight: 700;
		color: #0f172a;
		word-break: break-word;
	}

	.workspace-list-meta {
		margin: 0;
		font-size: 0.78rem;
		color: #64748b;
	}

	.workspace-danger-zone {
		padding-top: 1rem;
		border-top: 1px solid rgba(248, 113, 113, 0.2);
	}

	.manage-panel {
		display: grid;
		gap: 0.62rem;
		padding: 0.68rem;
		border-radius: 0.8rem;
		border: 1px solid rgba(148, 163, 184, 0.3);
		background: rgba(248, 250, 252, 0.7);
	}

	.manage-panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.manage-panel-title {
		margin: 0;
		font-size: 0.82rem;
		font-weight: 700;
		color: #0f172a;
	}

	.manage-panel-form {
		display: grid;
		gap: 0.6rem;
	}

	.manage-field {
		display: grid;
		gap: 0.28rem;
	}

	.manage-field-error {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 500;
		line-height: 1.3;
		color: #dc2626;
	}

	.manage-coordinates {
		display: grid;
		gap: 0.6rem;
		padding-top: 0.5rem;
	}

	.manage-advanced {
		border-top: 1px dashed rgba(148, 163, 184, 0.4);
		padding-top: 0.45rem;
	}

	.manage-advanced > summary {
		cursor: pointer;
		list-style: none;
		font-size: 0.73rem;
		font-weight: 600;
		color: #475569;
	}

	.manage-advanced > summary::-webkit-details-marker {
		display: none;
	}

	.manage-advanced > summary::before {
		content: '+ ';
		color: #64748b;
	}

	.manage-advanced[open] > summary::before {
		content: '- ';
	}

	.manage-panel-actions {
		display: flex;
		justify-content: flex-end;
	}

	.history-table-shell {
		overflow: hidden;
		border-radius: 0.85rem;
		border: 1px solid rgba(148, 163, 184, 0.28);
		background: rgba(248, 250, 252, 0.55);
	}

	.history-table-desktop {
		display: none;
	}

	.history-mobile-list {
		display: grid;
		gap: 0.75rem;
	}

	.history-mobile-item {
		display: grid;
		gap: 0.56rem;
		padding: 0.72rem;
		border-radius: 0.74rem;
		border: 1px solid rgba(148, 163, 184, 0.26);
		background: rgba(248, 250, 252, 0.72);
	}

	.history-mobile-top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.65rem;
	}

	.history-mobile-copy {
		display: grid;
		gap: 0.14rem;
		min-width: 0;
	}

	.history-mobile-item.is-disabled {
		opacity: 0.76;
	}

	.history-mobile-item.is-editing {
		border-color: rgba(2, 132, 199, 0.42);
		box-shadow: inset 0 0 0 1px rgba(2, 132, 199, 0.12);
	}

	.history-mobile-bottom {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		min-width: 0;
	}

	.history-mobile-qr {
		flex: 0 0 auto;
	}

	:global(.history-destination-cell) {
		min-width: 0;
		white-space: normal;
	}

	:global(.history-link-cell) {
		min-width: 0;
		white-space: normal;
	}

	:global(.history-row-disabled [data-slot='table-cell']) {
		opacity: 0.76;
	}

	:global(.history-row-editing [data-slot='table-cell']) {
		background: rgba(186, 230, 253, 0.16);
	}

	.history-destination-top {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
	}

	.history-name {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
		line-height: 1.34;
		color: #0f172a;
		overflow-wrap: anywhere;
	}

	.history-address {
		margin: 0.14rem 0 0;
		font-size: 0.8rem;
		line-height: 1.35;
		color: #475569;
		overflow-wrap: anywhere;
	}

	.history-notes {
		margin: 0.16rem 0 0;
		padding: 0.34rem 0.42rem;
		border-radius: 0.46rem;
		border: 1px solid rgba(148, 163, 184, 0.26);
		background: rgba(248, 250, 252, 0.72);
		font-size: 0.75rem;
		line-height: 1.35;
		color: #334155;
		white-space: pre-line;
		overflow-wrap: anywhere;
	}

	.history-meta {
		margin: 0.24rem 0 0;
		font-size: 0.72rem;
		line-height: 1.25;
		color: #64748b;
	}

	.history-status-pill {
		margin: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.12rem 0.45rem;
		border-radius: 999px;
		border: 1px solid rgba(16, 185, 129, 0.3);
		background: rgba(220, 252, 231, 0.86);
		color: #166534;
		font-size: 0.66rem;
		font-weight: 700;
		line-height: 1.2;
		white-space: nowrap;
	}

	.history-status-pill.is-disabled {
		border-color: rgba(148, 163, 184, 0.42);
		background: rgba(241, 245, 249, 0.9);
		color: #475569;
	}

	.history-link {
		display: inline-block;
		max-width: 100%;
		font-size: 0.8rem;
		font-weight: 600;
		line-height: 1.35;
		color: #0369a1;
		text-decoration: none;
		overflow-wrap: anywhere;
		word-break: break-word;
	}

	.history-link:hover {
		text-decoration: underline;
	}

	.history-link.is-disabled {
		color: #64748b;
		text-decoration: none;
		pointer-events: none;
	}

	.history-link-stack {
		display: grid;
		gap: 0.32rem;
		min-width: 0;
	}

	.history-mobile-link-stack {
		display: grid;
		gap: 0.24rem;
		min-width: 0;
	}

	.history-manage-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.28rem;
	}

	.history-inline-form {
		display: inline-flex;
	}

	.history-manage-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 1.45rem;
		padding: 0 0.45rem;
		border-radius: 0.42rem;
		border: 1px solid rgba(148, 163, 184, 0.42);
		background: rgba(248, 250, 252, 0.9);
		color: #334155;
		font-size: 0.68rem;
		font-weight: 650;
		line-height: 1;
		letter-spacing: 0.01em;
		cursor: pointer;
		transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
	}

	.history-manage-action:hover {
		background: rgba(226, 232, 240, 0.85);
		border-color: rgba(100, 116, 139, 0.48);
		color: #0f172a;
	}

	.history-manage-action.is-danger {
		border-color: rgba(244, 63, 94, 0.32);
		background: rgba(255, 241, 242, 0.92);
		color: #be123c;
	}

	.history-manage-action.is-danger:hover {
		border-color: rgba(225, 29, 72, 0.45);
		background: rgba(255, 228, 230, 0.95);
		color: #9f1239;
	}

	.history-use-link {
		display: inline-flex;
		width: fit-content;
		font-size: 0.74rem;
		font-weight: 600;
		line-height: 1.25;
		color: #0f766e;
		text-decoration: none;
		white-space: nowrap;
	}

	.history-use-link:hover {
		text-decoration: underline;
	}

	.history-table-shell :global([data-slot='table-container']) {
		overflow-x: hidden;
	}

	:global(table.history-table) {
		width: 100%;
		table-layout: fixed;
	}

	:global(table.history-table [data-slot='table-head']) {
		padding: 0.56rem 0.58rem;
		height: auto;
		white-space: normal;
		font-size: 0.72rem;
		font-weight: 650;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: #64748b;
	}

	:global(table.history-table [data-slot='table-cell']) {
		padding: 0.58rem;
		white-space: normal;
		vertical-align: top;
	}

	:global(table.history-table [data-slot='table-head']:nth-child(2)),
	:global(table.history-table [data-slot='table-cell']:nth-child(2)) {
		width: 4.7rem;
	}

	:global(table.history-table [data-slot='table-head']:nth-child(4)),
	:global(table.history-table [data-slot='table-cell']:nth-child(4)) {
		width: 8rem;
	}

	:global(table.history-table [data-slot='table-cell']:nth-child(3)) {
		word-break: break-word;
	}

	.history-qr {
		width: 3.5rem;
		height: 3.5rem;
		min-width: 3.5rem;
		min-height: 3.5rem;
		border-radius: 0.5rem;
		border: 1px solid rgba(148, 163, 184, 0.32);
		background: #fff;
		object-fit: contain;
	}

	.history-download-trigger {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 2rem;
		padding: 0 0.7rem;
		border-radius: 0.55rem;
		border: 1px solid rgba(100, 116, 139, 0.36);
		background: rgba(241, 245, 249, 0.92);
		color: #0f172a;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		user-select: none;
		transition: background 140ms ease, border-color 140ms ease;
	}

	.history-download-trigger.is-open {
		background: rgba(226, 232, 240, 0.88);
		border-color: rgba(71, 85, 105, 0.45);
	}

	.history-download-trigger:hover {
		background: rgba(226, 232, 240, 0.84);
		border-color: rgba(71, 85, 105, 0.45);
	}

	.history-download-popover {
		position: fixed;
		display: grid;
		gap: 0.2rem;
		min-width: 7.5rem;
		padding: 0.35rem;
		border-radius: 0.62rem;
		border: 1px solid rgba(148, 163, 184, 0.33);
		background: rgba(255, 255, 255, 0.96);
		backdrop-filter: blur(10px);
		box-shadow: 0 12px 24px rgba(15, 23, 42, 0.11);
		z-index: 120;
	}

	.history-download-option {
		border: 0;
		border-radius: 0.5rem;
		background: transparent;
		padding: 0.42rem 0.52rem;
		text-align: left;
		font-size: 0.82rem;
		color: #0f172a;
		cursor: pointer;
	}

	.history-download-option:hover {
		background: rgba(226, 232, 240, 0.78);
	}

	@media (min-width: 768px) {
		.account-management-grid {
			grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
			align-items: start;
		}

		.team-summary-grid {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}

		.plan-card-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}

		.workspace-inline-form {
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: end;
		}

		.history-table-desktop {
			display: block;
		}

		.history-mobile-list {
			display: none;
		}
	}

	@media (min-width: 640px) {
		.manage-coordinates {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
