<script lang="ts">
	import { env as publicEnv } from '$env/dynamic/public';
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import { saveDeviceHistory } from '$lib/device-history';
	import Share2 from '@lucide/svelte/icons/share-2';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import * as InputGroup from '$lib/components/ui/input-group';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { Textarea } from '$lib/components/ui/textarea';
	import { onMount } from 'svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();

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

	const PERSONAL_WORKSPACE_VALUE = '__personal__';

	const fallbackValues: {
		name: string;
		address: string;
		notes: string;
		customSlug: string;
		workspaceId: string;
		lat: string;
		lng: string;
	} = {
		name: '',
		address: '',
		notes: '',
		customSlug: '',
		workspaceId: PERSONAL_WORKSPACE_VALUE,
		lat: '',
		lng: ''
	};

	type ActionValues = {
		name: string;
		address: string;
		notes: string;
		customSlug: string;
		workspaceId: string;
		lat: string;
		lng: string;
	};
	type QrVisualStyle = 'square' | 'rounded' | 'connected' | 'dots';

	function actionValuesFromForm(actionForm: ActionData | undefined): ActionValues | null {
		const values =
			actionForm &&
			typeof actionForm === 'object' &&
			'values' in actionForm &&
			actionForm.values &&
			typeof actionForm.values === 'object'
				? actionForm.values
				: null;
		if (!values) return null;

		const withStrings = values as Partial<ActionValues>;
		return {
			name: withStrings.name ?? '',
			address: withStrings.address ?? '',
			notes: withStrings.notes ?? '',
			customSlug: withStrings.customSlug ?? '',
			workspaceId: withStrings.workspaceId ?? PERSONAL_WORKSPACE_VALUE,
			lat: withStrings.lat ?? '',
			lng: withStrings.lng ?? ''
		};
	}

	const generatedUrlFromAction = $derived(
		form && typeof form === 'object' && 'generatedUrl' in form ? String(form.generatedUrl ?? '') : ''
	);
	let persistedGeneratedUrl = $state('');
	let forceCleared = $state(false);
	const generatedUrl = $derived.by(() => {
		if (forceCleared) return '';
		const actionUrl = generatedUrlFromAction.trim();
		if (actionUrl.length > 0) return actionUrl;
		return persistedGeneratedUrl;
	});
	const generatedSocialPreviewUrl = $derived.by(() => {
		if (generatedUrl.trim().length === 0) return '';

		try {
			const parsed = new URL(generatedUrl, data.origin);
			const match = parsed.pathname.match(/^\/r\/([^/]+)$/);
			const slug = match?.[1] ?? '';
			if (slug.length === 0) return '';
			return `${parsed.origin}/r/${slug}/social-image`;
		} catch {
			return '';
		}
	});
	const createError = $derived(
		forceCleared ? '' : form && typeof form === 'object' && 'error' in form ? String(form.error ?? '') : ''
	);
	const googleMapsApiKey = publicEnv.PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? '';

	let searchInputRef = $state<HTMLInputElement | null>(null);
	let nameValue = $state(fallbackValues.name);
	let addressValue = $state(fallbackValues.address);
	let notesValue = $state(fallbackValues.notes);
	let customSlugValue = $state(fallbackValues.customSlug);
	let workspaceScopeValue = $state(PERSONAL_WORKSPACE_VALUE);
	let latValue = $state(fallbackValues.lat);
	let lngValue = $state(fallbackValues.lng);
	let searchValue = $state(fallbackValues.address);
	let mapsError = $state('');

	let qrDataUrl = $state('');
	let qrSvg = $state('');
	let qrError = $state('');
	let qrDownloadError = $state('');
	let qrDownloadInfo = $state('');
	let socialPreviewLoading = $state(false);
	let shareInfo = $state('');
	let qrVisualStyle = $state<QrVisualStyle>('connected');
	let qrForegroundColor = $state('#0f172a');
	let qrBackgroundColor = $state('#ffffff');
	let qrBackgroundTransparent = $state(false);
	let qrDownloadMenuRef = $state<HTMLDetailsElement | null>(null);
	let lastSavedDeviceHistoryUrl = $state('');

	const GENERATOR_STATE_KEY = 'navqr.generator-state.v1';
	const QR_PREVIEW_SIZE = 360;
	const QR_DOWNLOAD_SIZE = 720;
	const QR_MARGIN = 1;
	const qrStyleOptions: Array<{ value: QrVisualStyle; label: string }> = [
		{ value: 'connected', label: 'Smooth' },
		{ value: 'rounded', label: 'Rounded' },
		{ value: 'square', label: 'Classic' },
		{ value: 'dots', label: 'Dots' }
	];
	const faqItems = [
		{
			question: 'How does this directions QR code generator work?',
			answer:
				'Search a destination, generate the link, then download the QR code. Scanning opens a map app option page with Apple Maps, Google Maps, and Waze.'
		},
		{
			question: 'Can I create a QR code for Google Maps links?',
			answer:
				'Yes. NavQR generates a share link and QR code that supports Google Maps while still letting people choose Apple Maps or Waze.'
		},
		{
			question: 'Can I use custom slugs for map links?',
			answer:
				'Yes. You can set a custom slug so destination links are cleaner for print, social posts, and event materials.'
		},
		{
			question: 'Do I need an account to generate links?',
			answer:
				'No. You can create links and QR codes without signing in. Sign-in is optional for syncing history across devices.'
		}
	] as const;

	type PersistedGeneratorState = {
		generatedUrl: string;
		name: string;
		address: string;
		notes: string;
		customSlug: string;
		workspaceId: string;
		lat: string;
		lng: string;
		search: string;
		qrVisualStyle: QrVisualStyle;
		qrForegroundColor: string;
		qrBackgroundColor: string;
		qrBackgroundTransparent: boolean;
	};

	function asTrimmedString(value: unknown): string {
		return typeof value === 'string' ? value.trim() : '';
	}

	function normalizeHexColor(value: unknown, fallback: string): string {
		if (typeof value !== 'string') return fallback;
		const next = value.trim();
		if (!/^#[0-9a-fA-F]{6}$/.test(next)) return fallback;
		return next.toLowerCase();
	}

	function normalizePersistedGeneratedUrl(value: unknown): string {
		if (!browser || typeof value !== 'string') return '';
		const raw = value.trim();
		if (raw.length === 0) return '';

		try {
			const parsed = new URL(raw, window.location.origin);
			const match = parsed.pathname.match(/^\/r\/([^/]+)$/);
			const slug = match?.[1]?.trim() ?? '';
			if (slug.length === 0) return '';
			return `${window.location.origin}/r/${slug}`;
		} catch {
			return '';
		}
	}

	function normalizeQrVisualStyle(value: unknown): QrVisualStyle {
		if (value === 'square' || value === 'rounded' || value === 'connected' || value === 'dots') {
			return value;
		}
		return 'connected';
	}

	function normalizeWorkspaceScope(value: unknown): string {
		if (typeof value !== 'string') return PERSONAL_WORKSPACE_VALUE;
		const next = value.trim();
		if (next.length === 0 || next === PERSONAL_WORKSPACE_VALUE) {
			return PERSONAL_WORKSPACE_VALUE;
		}

		if (!data.user) return PERSONAL_WORKSPACE_VALUE;
		return data.workspaces.some((workspace) => workspace.id === next)
			? next
			: PERSONAL_WORKSPACE_VALUE;
	}

	function loadPersistedGeneratorState(): PersistedGeneratorState | null {
		if (!browser) return null;

		try {
			const raw = window.localStorage.getItem(GENERATOR_STATE_KEY);
			if (!raw) return null;

			const parsed = JSON.parse(raw) as Record<string, unknown>;
			const generatedUrl = normalizePersistedGeneratedUrl(parsed.generatedUrl);
			if (generatedUrl.length === 0) return null;

			return {
				generatedUrl,
				name: asTrimmedString(parsed.name),
				address: asTrimmedString(parsed.address),
				notes: asTrimmedString(parsed.notes),
				customSlug: asTrimmedString(parsed.customSlug),
				workspaceId: normalizeWorkspaceScope(parsed.workspaceId),
				lat: asTrimmedString(parsed.lat),
				lng: asTrimmedString(parsed.lng),
				search: asTrimmedString(parsed.search),
				qrVisualStyle: normalizeQrVisualStyle(parsed.qrVisualStyle),
				qrForegroundColor: normalizeHexColor(parsed.qrForegroundColor, '#0f172a'),
				qrBackgroundColor: normalizeHexColor(parsed.qrBackgroundColor, '#ffffff'),
				qrBackgroundTransparent: parsed.qrBackgroundTransparent === true
			};
		} catch {
			return null;
		}
	}

	function savePersistedGeneratorState(state: PersistedGeneratorState) {
		if (!browser) return;
		window.localStorage.setItem(GENERATOR_STATE_KEY, JSON.stringify(state));
	}

	function clearPersistedGeneratorState() {
		if (!browser) return;
		window.localStorage.removeItem(GENERATOR_STATE_KEY);
	}

	function applyGeneratorState(state: PersistedGeneratorState) {
		forceCleared = false;
		persistedGeneratedUrl = state.generatedUrl;
		nameValue = state.name;
		addressValue = state.address;
		notesValue = state.notes;
		customSlugValue = state.customSlug;
		workspaceScopeValue = normalizeWorkspaceScope(state.workspaceId);
		latValue = state.lat;
		lngValue = state.lng;
		searchValue = state.search.length > 0 ? state.search : state.address;
		qrVisualStyle = state.qrVisualStyle;
		qrForegroundColor = state.qrForegroundColor;
		qrBackgroundColor = state.qrBackgroundColor;
		qrBackgroundTransparent = state.qrBackgroundTransparent;
	}

	function clearUseQueryParam() {
		if (!browser) return;
		const url = new URL(window.location.href);
		if (!url.searchParams.has('use')) return;
		url.searchParams.delete('use');
		const nextPath = `${url.pathname}${url.search}${url.hash}`;
		window.history.replaceState(window.history.state, '', nextPath);
	}

	function loadGeneratorStateFromUseQuery(): PersistedGeneratorState | null {
		if (!browser) return null;

		const params = new URLSearchParams(window.location.search);
		const rawUse = params.get('use');
		if (!rawUse) return null;

		try {
			const parsed = JSON.parse(rawUse) as Record<string, unknown>;
			const generatedUrl = normalizePersistedGeneratedUrl(parsed.generatedUrl);
			if (generatedUrl.length === 0) return null;

			const existing = loadPersistedGeneratorState();
			const address = asTrimmedString(parsed.address);
			const search = asTrimmedString(parsed.search);

			return {
				generatedUrl,
				name: asTrimmedString(parsed.name),
				address,
				notes: asTrimmedString(parsed.notes),
				customSlug: asTrimmedString(parsed.customSlug),
				workspaceId: normalizeWorkspaceScope(
					parsed.workspaceId ?? data.activeWorkspaceId ?? existing?.workspaceId
				),
				lat: asTrimmedString(parsed.lat),
				lng: asTrimmedString(parsed.lng),
				search: search.length > 0 ? search : address,
				qrVisualStyle: existing?.qrVisualStyle ?? 'connected',
				qrForegroundColor: existing?.qrForegroundColor ?? '#0f172a',
				qrBackgroundColor: existing?.qrBackgroundColor ?? '#ffffff',
				qrBackgroundTransparent: existing?.qrBackgroundTransparent ?? false
			};
		} catch {
			return null;
		}
	}

	function currentQrStyleLabel(style: QrVisualStyle): string {
		return qrStyleOptions.find((option) => option.value === style)?.label ?? 'Smooth';
	}

	function clearBuilderState() {
		forceCleared = true;
		persistedGeneratedUrl = '';
		nameValue = fallbackValues.name;
		addressValue = fallbackValues.address;
		notesValue = fallbackValues.notes;
		customSlugValue = fallbackValues.customSlug;
		workspaceScopeValue = data.activeWorkspaceId ?? PERSONAL_WORKSPACE_VALUE;
		latValue = fallbackValues.lat;
		lngValue = fallbackValues.lng;
		searchValue = fallbackValues.address;
		mapsError = '';
		qrVisualStyle = 'connected';
		qrForegroundColor = '#0f172a';
		qrBackgroundColor = '#ffffff';
		qrBackgroundTransparent = false;
		qrDataUrl = '';
		qrSvg = '';
		qrError = '';
		qrDownloadError = '';
		qrDownloadInfo = '';
		shareInfo = '';
		socialPreviewLoading = false;
		lastSavedDeviceHistoryUrl = '';
		if (qrDownloadMenuRef) qrDownloadMenuRef.open = false;
		clearPersistedGeneratorState();
		clearUseQueryParam();
	}

	const hasResolvedLocation = $derived(nameValue.trim().length > 0 && addressValue.trim().length > 0);
	const hasClearableState = $derived(
		generatedUrl.trim().length > 0 ||
			searchValue.trim().length > 0 ||
			customSlugValue.trim().length > 0 ||
			nameValue.trim().length > 0 ||
			addressValue.trim().length > 0 ||
			notesValue.trim().length > 0 ||
			latValue.trim().length > 0 ||
			lngValue.trim().length > 0 ||
			qrVisualStyle !== 'connected' ||
			qrForegroundColor !== '#0f172a' ||
			qrBackgroundColor !== '#ffffff' ||
			qrBackgroundTransparent
	);

	function workspaceIdForSubmit(value: string): string {
		return value === PERSONAL_WORKSPACE_VALUE ? '' : value;
	}

	function parseHexColor(hex: string) {
		const normalized = hex.replace('#', '');
		if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;

		return {
			r: Number.parseInt(normalized.slice(0, 2), 16),
			g: Number.parseInt(normalized.slice(2, 4), 16),
			b: Number.parseInt(normalized.slice(4, 6), 16)
		};
	}

	function isDarkHexColor(hex: string): boolean {
		const rgb = parseHexColor(hex);
		if (!rgb) return false;

		const r = rgb.r / 255;
		const g = rgb.g / 255;
		const b = rgb.b / 255;
		const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
		return luminance < 0.45;
	}

	function relativeLuminance(hex: string): number | null {
		const rgb = parseHexColor(hex);
		if (!rgb) return null;

		const mapChannel = (value: number) => {
			const srgb = value / 255;
			return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
		};

		const r = mapChannel(rgb.r);
		const g = mapChannel(rgb.g);
		const b = mapChannel(rgb.b);
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	}

	function colorContrastRatio(a: string, b: string): number | null {
		const luminanceA = relativeLuminance(a);
		const luminanceB = relativeLuminance(b);
		if (luminanceA === null || luminanceB === null) return null;

		const lighter = Math.max(luminanceA, luminanceB);
		const darker = Math.min(luminanceA, luminanceB);
		return (lighter + 0.05) / (darker + 0.05);
	}

	const qrContrastNotice = $derived.by(() => {
		if (qrBackgroundTransparent) {
			return 'Transparent QR codes inherit the surface background. Dark surfaces can reduce scan reliability.';
		}

		const contrast = colorContrastRatio(qrForegroundColor, qrBackgroundColor);
		if (contrast !== null && contrast < 3.5) {
			return 'Low contrast between pattern and background can reduce scan reliability.';
		}

		if (isDarkHexColor(qrBackgroundColor)) {
			return 'Dark QR backgrounds can reduce scan reliability. Use lighter colors for best results.';
		}

		return '';
	});

	function qrLightColor(useOpaqueFallback = false): string {
		if (qrBackgroundTransparent && useOpaqueFallback) return '#ffffff';
		return qrBackgroundTransparent ? '#0000' : qrBackgroundColor;
	}

	type QrCornerRadii = { tl: number; tr: number; br: number; bl: number };

	function qrLayout(modulesSize: number, targetSize: number) {
		const totalModules = modulesSize + QR_MARGIN * 2;
		const cell = Math.max(1, Math.floor(targetSize / totalModules));
		const actualSize = totalModules * cell;
		const offset = QR_MARGIN * cell;
		return { cell, offset, actualSize };
	}

	function isDarkModule(
		modules: { size: number; get: (row: number, col: number) => number },
		row: number,
		col: number
	): boolean {
		if (row < 0 || col < 0 || row >= modules.size || col >= modules.size) return false;
		return modules.get(row, col) === 1;
	}

	function moduleRadii(
		style: QrVisualStyle,
		modules: { size: number; get: (row: number, col: number) => number },
		row: number,
		col: number,
		cell: number
	): QrCornerRadii {
		if (style === 'rounded') {
			const rounded = cell * 0.35;
			return { tl: rounded, tr: rounded, br: rounded, bl: rounded };
		}

		if (style === 'connected') {
			const top = isDarkModule(modules, row - 1, col);
			const right = isDarkModule(modules, row, col + 1);
			const bottom = isDarkModule(modules, row + 1, col);
			const left = isDarkModule(modules, row, col - 1);
			const radius = cell * 0.46;

			return {
				tl: !top && !left ? radius : 0,
				tr: !top && !right ? radius : 0,
				br: !bottom && !right ? radius : 0,
				bl: !bottom && !left ? radius : 0
			};
		}

		return { tl: 0, tr: 0, br: 0, bl: 0 };
	}

	function drawRoundedRect(
		ctx: CanvasRenderingContext2D,
		x: number,
		y: number,
		size: number,
		radii: QrCornerRadii
	) {
		ctx.beginPath();
		ctx.moveTo(x + radii.tl, y);
		ctx.lineTo(x + size - radii.tr, y);
		if (radii.tr > 0) {
			ctx.quadraticCurveTo(x + size, y, x + size, y + radii.tr);
		}
		ctx.lineTo(x + size, y + size - radii.br);
		if (radii.br > 0) {
			ctx.quadraticCurveTo(x + size, y + size, x + size - radii.br, y + size);
		}
		ctx.lineTo(x + radii.bl, y + size);
		if (radii.bl > 0) {
			ctx.quadraticCurveTo(x, y + size, x, y + size - radii.bl);
		}
		ctx.lineTo(x, y + radii.tl);
		if (radii.tl > 0) {
			ctx.quadraticCurveTo(x, y, x + radii.tl, y);
		}
		ctx.closePath();
		ctx.fill();
	}

	function roundedRectPath(x: number, y: number, size: number, radii: QrCornerRadii): string {
		const right = x + size;
		const bottom = y + size;
		return [
			`M ${x + radii.tl} ${y}`,
			`L ${right - radii.tr} ${y}`,
			radii.tr > 0 ? `Q ${right} ${y} ${right} ${y + radii.tr}` : `L ${right} ${y}`,
			`L ${right} ${bottom - radii.br}`,
			radii.br > 0 ? `Q ${right} ${bottom} ${right - radii.br} ${bottom}` : `L ${right} ${bottom}`,
			`L ${x + radii.bl} ${bottom}`,
			radii.bl > 0 ? `Q ${x} ${bottom} ${x} ${bottom - radii.bl}` : `L ${x} ${bottom}`,
			`L ${x} ${y + radii.tl}`,
			radii.tl > 0 ? `Q ${x} ${y} ${x + radii.tl} ${y}` : `L ${x} ${y}`,
			'Z'
		].join(' ');
	}

	async function renderStyledQrCanvas(
		value: string,
		targetSize: number,
		lightColor: string,
		style: QrVisualStyle,
		foregroundColor: string
	): Promise<HTMLCanvasElement> {
		const { create } = await import('qrcode');
		const qr = create(value, { errorCorrectionLevel: 'M' });
		const modules = qr.modules;
		const { cell, offset, actualSize } = qrLayout(modules.size, targetSize);

		const canvas = document.createElement('canvas');
		canvas.width = actualSize;
		canvas.height = actualSize;

		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('2d context unavailable');

		ctx.clearRect(0, 0, actualSize, actualSize);
		if (lightColor !== '#0000') {
			ctx.fillStyle = lightColor;
			ctx.fillRect(0, 0, actualSize, actualSize);
		}

		ctx.fillStyle = foregroundColor;

		for (let row = 0; row < modules.size; row += 1) {
			for (let col = 0; col < modules.size; col += 1) {
				if (!isDarkModule(modules, row, col)) continue;

				const x = offset + col * cell;
				const y = offset + row * cell;

				if (style === 'dots') {
					ctx.beginPath();
					ctx.arc(x + cell / 2, y + cell / 2, cell * 0.42, 0, Math.PI * 2);
					ctx.fill();
					continue;
				}

				if (style === 'square') {
					ctx.fillRect(x, y, cell, cell);
					continue;
				}

				drawRoundedRect(ctx, x, y, cell, moduleRadii(style, modules, row, col, cell));
			}
		}

		return canvas;
	}

	async function renderStyledQrSvg(
		value: string,
		targetSize: number,
		lightColor: string,
		style: QrVisualStyle,
		foregroundColor: string
	): Promise<string> {
		const { create } = await import('qrcode');
		const qr = create(value, { errorCorrectionLevel: 'M' });
		const modules = qr.modules;
		const { cell, offset, actualSize } = qrLayout(modules.size, targetSize);

		const darkElements: string[] = [];

		for (let row = 0; row < modules.size; row += 1) {
			for (let col = 0; col < modules.size; col += 1) {
				if (!isDarkModule(modules, row, col)) continue;

				const x = offset + col * cell;
				const y = offset + row * cell;

				if (style === 'dots') {
					const radius = cell * 0.42;
					darkElements.push(
						`<circle cx="${x + cell / 2}" cy="${y + cell / 2}" r="${radius}" />`
					);
					continue;
				}

				if (style === 'square') {
					darkElements.push(`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" />`);
					continue;
				}

				const pathData = roundedRectPath(x, y, cell, moduleRadii(style, modules, row, col, cell));
				darkElements.push(`<path d="${pathData}" />`);
			}
		}

		const backgroundRect =
			lightColor !== '#0000'
				? `<rect width="${actualSize}" height="${actualSize}" fill="${lightColor}" />`
				: '';
		return `<svg xmlns="http://www.w3.org/2000/svg" width="${actualSize}" height="${actualSize}" viewBox="0 0 ${actualSize} ${actualSize}">${backgroundRect}<g fill="${foregroundColor}">${darkElements.join('')}</g></svg>`;
	}

	const isIOSDevice = $derived(
		browser
			? /iPad|iPhone|iPod/.test(navigator.userAgent) ||
					(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
			: false
	);

	$effect(() => {
		if (actionValuesFromForm(form)) return;
		workspaceScopeValue = normalizeWorkspaceScope(data.activeWorkspaceId ?? PERSONAL_WORKSPACE_VALUE);
	});

	$effect(() => {
		const next = actionValuesFromForm(form);
		if (!next) return;

		nameValue = next.name ?? fallbackValues.name;
		addressValue = next.address ?? fallbackValues.address;
		notesValue = next.notes ?? fallbackValues.notes;
		customSlugValue = next.customSlug ?? fallbackValues.customSlug;
		workspaceScopeValue = normalizeWorkspaceScope(next.workspaceId);
		latValue = next.lat ?? fallbackValues.lat;
		lngValue = next.lng ?? fallbackValues.lng;
		searchValue = next.address ?? fallbackValues.address;
	});

	$effect(() => {
		if (generatedUrlFromAction.trim().length > 0) {
			forceCleared = false;
		}
	});

	$effect(() => {
		const actionGeneratedUrl = generatedUrlFromAction.trim();
		if (!browser || actionGeneratedUrl.length === 0) return;
		if (actionGeneratedUrl === lastSavedDeviceHistoryUrl) return;

		const actionValues = actionValuesFromForm(form);
		const recordName = (actionValues?.name ?? nameValue).trim();
		const recordAddress = (actionValues?.address ?? addressValue).trim();
		const recordNotes = (actionValues?.notes ?? notesValue).trim();
		const parsedLat = Number(actionValues?.lat ?? latValue);
		const parsedLng = Number(actionValues?.lng ?? lngValue);
		const recordLat = Number.isFinite(parsedLat) ? parsedLat : null;
		const recordLng = Number.isFinite(parsedLng) ? parsedLng : null;
		if (recordName.length < 2 || recordAddress.length < 4) return;

		saveDeviceHistory({
			name: recordName,
			address: recordAddress,
			notes: recordNotes,
			lat: recordLat,
			lng: recordLng,
			generatedUrl: actionGeneratedUrl
		});
		lastSavedDeviceHistoryUrl = actionGeneratedUrl;
	});

	$effect(() => {
		const actionGeneratedUrl = generatedUrlFromAction.trim();
		if (actionGeneratedUrl.length === 0) return;
		persistedGeneratedUrl = actionGeneratedUrl;
	});

	$effect(() => {
		if (!browser) return;

		const urlToPersist = generatedUrl.trim();
		if (urlToPersist.length === 0) return;

		savePersistedGeneratorState({
			generatedUrl: urlToPersist,
			name: nameValue,
			address: addressValue,
			notes: notesValue,
			customSlug: customSlugValue,
			workspaceId: workspaceScopeValue,
			lat: latValue,
			lng: lngValue,
			search: searchValue,
			qrVisualStyle,
			qrForegroundColor,
			qrBackgroundColor,
			qrBackgroundTransparent
		});
	});

	$effect(() => {
		socialPreviewLoading = generatedSocialPreviewUrl.trim().length > 0;
	});

	function handleSocialPreviewLoaded() {
		socialPreviewLoading = false;
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

	function resetResolvedLocation() {
		nameValue = '';
		addressValue = '';
		latValue = '';
		lngValue = '';
	}

	function deriveNameFromAddress(input: string): string {
		const first = input.split(',')[0]?.trim() ?? '';
		return first.length > 0 ? first : 'Pinned location';
	}

	function ensureSubmissionValues() {
		if (hasResolvedLocation) return true;

		const query = searchValue.trim();
		if (query.length < 4) {
			mapsError = 'Search for a place first, then select a suggestion.';
			return false;
		}

		nameValue = deriveNameFromAddress(query);
		addressValue = query;
		latValue = '';
		lngValue = '';
		return true;
	}

	function handleCreateSubmit(event: SubmitEvent) {
		forceCleared = false;
		mapsError = '';
		if (!ensureSubmissionValues()) {
			event.preventDefault();
		}
	}

	function handleSearchInput() {
		mapsError = '';
		resetResolvedLocation();
	}

	onMount(() => {
		if (!browser) return;

		const hadUseQuery = new URLSearchParams(window.location.search).has('use');
		const stateFromUseQuery = loadGeneratorStateFromUseQuery();
		if (hadUseQuery) {
			clearUseQueryParam();
		}
		if (stateFromUseQuery) {
			applyGeneratorState(stateFromUseQuery);
			savePersistedGeneratorState(stateFromUseQuery);
		} else {
			const hasActionPayload =
				generatedUrlFromAction.trim().length > 0 || actionValuesFromForm(form) !== null;
			if (!hasActionPayload) {
				const persisted = loadPersistedGeneratorState();
				if (persisted) {
					applyGeneratorState(persisted);
				}
			}
		}

		function handlePointerDown(event: PointerEvent) {
			if (!qrDownloadMenuRef?.open) return;
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (!qrDownloadMenuRef.contains(target)) {
				qrDownloadMenuRef.open = false;
			}
		}

		document.addEventListener('pointerdown', handlePointerDown);

		if (googleMapsApiKey.length === 0) {
			mapsError = 'Google Places API key missing. Set PUBLIC_GOOGLE_MAPS_API_KEY.';
			return () => {
				document.removeEventListener('pointerdown', handlePointerDown);
			};
		}

		let disposed = false;
		let autocomplete: AutocompleteInstance | null = null;

		void loadGooglePlacesLibrary()
			.then(() => {
				if (disposed || !searchInputRef) return;

				const win = window as GoogleMapsWindow;
				const Autocomplete = win.google?.maps?.places?.Autocomplete;
				if (!Autocomplete) {
					throw new Error('Google Places Autocomplete unavailable.');
				}

				autocomplete = new Autocomplete(searchInputRef, {
					fields: ['name', 'formatted_address', 'geometry'],
					types: ['geocode', 'establishment']
				});
				autocomplete.addListener('place_changed', () => {
					const place = autocomplete?.getPlace();
					const lat = place?.geometry?.location?.lat?.();
					const lng = place?.geometry?.location?.lng?.();

					if (place?.formatted_address) {
						addressValue = place.formatted_address;
						searchValue = place.formatted_address;
					}
					nameValue = place?.name?.trim() || deriveNameFromAddress(addressValue || searchValue);
					latValue = Number.isFinite(lat) ? String(lat) : '';
					lngValue = Number.isFinite(lng) ? String(lng) : '';
					mapsError = '';
				});
			})
			.catch((error) => {
				console.error(error);
				mapsError = 'Google address search is unavailable right now.';
			});

		return () => {
			disposed = true;
			document.removeEventListener('pointerdown', handlePointerDown);
			const win = window as GoogleMapsWindow;
			if (autocomplete && win.google?.maps?.event?.clearInstanceListeners) {
				win.google.maps.event.clearInstanceListeners(autocomplete);
			}
		};
	});

	$effect(() => {
		if (!browser || generatedUrl.length === 0) {
			qrDataUrl = '';
			qrSvg = '';
			qrError = '';
			qrDownloadError = '';
			qrDownloadInfo = '';
			return;
		}

		let cancelled = false;
		const lightColor = qrLightColor();
		const visualStyle = qrVisualStyle;
		const foregroundColor = qrForegroundColor;
		Promise.all([
			renderStyledQrCanvas(
				generatedUrl,
				QR_PREVIEW_SIZE,
				lightColor,
				visualStyle,
				foregroundColor
			),
			renderStyledQrSvg(generatedUrl, QR_PREVIEW_SIZE, lightColor, visualStyle, foregroundColor)
		])
			.then(([canvas, svgMarkup]) => {
				const pngDataUrl = canvas.toDataURL('image/png');
				return { pngDataUrl, svgMarkup };
			})
			.then((result) => {
				if (cancelled) return;
				qrDataUrl = result.pngDataUrl;
				qrSvg = result.svgMarkup;
				qrError = '';
			})
			.catch(() => {
				if (cancelled) return;
				qrDataUrl = '';
				qrSvg = '';
				qrError = 'QR generation failed.';
			});

		return () => {
			cancelled = true;
		};
	});

	async function shareGeneratedUrl() {
		if (!browser || generatedUrl.length === 0) return;
		shareInfo = '';

		const shareTitle = nameValue.trim().length > 0 ? `${nameValue.trim()} - NavQR` : 'NavQR link';

		try {
			if (typeof navigator.share === 'function') {
				await navigator.share({
					title: shareTitle,
					url: generatedUrl
				});
				return;
			}

			await navigator.clipboard.writeText(generatedUrl);
			shareInfo = 'Link copied. Paste it to share.';
			window.setTimeout(() => {
				shareInfo = '';
			}, 2200);
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') return;
			shareInfo = 'Unable to open share options right now.';
		}
	}

	function sanitizeFilePart(value: string): string {
		return value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 48);
	}

	function qrFilenameBase(): string {
		const fromName = sanitizeFilePart(nameValue.trim());
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

	type RasterFormat = 'png' | 'jpg' | 'webp';

	async function rasterDataUrl(format: RasterFormat): Promise<string> {
		const lightColor = qrLightColor(format === 'jpg');
		const visualStyle = qrVisualStyle;
		const foregroundColor = qrForegroundColor;
		const canvas = await renderStyledQrCanvas(
			generatedUrl,
			QR_DOWNLOAD_SIZE,
			lightColor,
			visualStyle,
			foregroundColor
		);

		if (format === 'png') {
			return canvas.toDataURL('image/png');
		}

		if (format === 'jpg') {
			return canvas.toDataURL('image/jpeg', 0.92);
		}

		return canvas.toDataURL('image/webp', 0.92);
	}

	async function downloadQrRaster(format: RasterFormat) {
		if (!browser || generatedUrl.length === 0) return;

		qrDownloadError = '';
		qrDownloadInfo = '';

		try {
			const extension = format === 'jpg' ? 'jpg' : format;
			const dataUrl =
				format === 'png' && qrDataUrl.length > 0 ? qrDataUrl : await rasterDataUrl(format);
			triggerDownload(dataUrl, `${qrFilenameBase()}.${extension}`);
		} catch {
			qrDownloadError = 'Unable to generate this format on this browser.';
		}

		if (qrDownloadMenuRef) qrDownloadMenuRef.open = false;
	}

	function downloadQrPng() {
		void downloadQrRaster('png');
	}

	function downloadQrJpg() {
		void downloadQrRaster('jpg');
	}

	function downloadQrWebp() {
		void downloadQrRaster('webp');
	}

	function downloadQrSvg() {
		if (!browser || qrSvg.length === 0) return;
		qrDownloadError = '';
		qrDownloadInfo = '';
		const blob = new Blob([qrSvg], { type: 'image/svg+xml;charset=utf-8' });
		const blobUrl = URL.createObjectURL(blob);
		try {
			triggerDownload(blobUrl, `${qrFilenameBase()}.svg`);
		} finally {
			URL.revokeObjectURL(blobUrl);
		}
		if (qrDownloadMenuRef) qrDownloadMenuRef.open = false;
	}

	async function saveQrToPhotosIOS() {
		if (!browser || qrDataUrl.length === 0) return;

		qrDownloadError = '';
		qrDownloadInfo = '';

		try {
			const blob = await fetch(qrDataUrl).then((response) => response.blob());
			const filename = `${qrFilenameBase()}.png`;
			const file = new File([blob], filename, { type: 'image/png' });

			if (
				typeof navigator.share === 'function' &&
				typeof navigator.canShare === 'function' &&
				navigator.canShare({ files: [file] })
			) {
				await navigator.share({
					title: 'NavQR Code',
					text: 'Save this QR image to Photos.',
					files: [file]
				});
				qrDownloadInfo = 'In the share sheet, choose “Save Image” to add it to Photos.';
			} else {
				window.open(qrDataUrl, '_blank', 'noopener,noreferrer');
				qrDownloadInfo = 'Long-press the opened image, then choose “Save to Photos”.';
			}
		} catch {
			qrDownloadError = 'Unable to open iOS save flow right now.';
		}

		if (qrDownloadMenuRef) qrDownloadMenuRef.open = false;
	}
</script>

<svelte:head>
	<title>NavQR | Map Link & Directions QR Code Generator</title>
	<meta
		name="description"
		content="Generate map links and directions QR codes that open in Apple Maps, Google Maps, or Waze. Create, customize, and share destination QR codes in seconds."
	/>
	<meta name="keywords" content="map link generator, directions QR code generator, map QR code, navigation QR code, Google Maps QR code, Apple Maps QR code, Waze QR code" />
	<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
	<link rel="canonical" href={`${data.origin}/`} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="NavQR" />
	<meta property="og:url" content={`${data.origin}/`} />
	<meta property="og:title" content="NavQR | Map Link & Directions QR Code Generator" />
	<meta
		property="og:description"
		content="Create directions QR codes and map links that open in Apple Maps, Google Maps, or Waze."
	/>
	<meta property="og:image" content={`${data.origin}/social-image`} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content="NavQR map link and directions QR code generator preview" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="NavQR | Map Link & Directions QR Code Generator" />
	<meta
		name="twitter:description"
		content="Create directions QR codes and map links that open in Apple Maps, Google Maps, or Waze."
	/>
	<meta name="twitter:image" content={`${data.origin}/social-image`} />
	<meta name="twitter:image:alt" content="NavQR map link and directions QR code generator preview" />
	<script type="application/ld+json">
		{JSON.stringify({
			'@context': 'https://schema.org',
			'@graph': [
				{
					'@type': 'WebSite',
					name: 'NavQR',
					url: `${data.origin}/`
				},
				{
					'@type': 'SoftwareApplication',
					name: 'NavQR',
					applicationCategory: 'BusinessApplication',
					operatingSystem: 'Web',
					url: `${data.origin}/`,
					description:
						'Map link and directions QR code generator for Apple Maps, Google Maps, and Waze.',
					offers: {
						'@type': 'Offer',
						price: '0',
						priceCurrency: 'USD'
					}
				},
				{
					'@type': 'FAQPage',
					mainEntity: faqItems.map((item) => ({
						'@type': 'Question',
						name: item.question,
						acceptedAnswer: {
							'@type': 'Answer',
							text: item.answer
						}
					}))
				}
			]
		})}
	</script>
</svelte:head>

<main class="generator-shell">
	<div class="mx-auto w-full max-w-6xl space-y-6 px-4 pb-0 pt-24 md:space-y-7 md:px-6">
		<section class="hero-layout">
			<section class="intro-stack">
				<p class="intro-eyebrow">NavQR</p>
				<h1 class="intro-title">Map links and QR codes for personal and professional use</h1>
				<p class="intro-copy">
					Create one destination link and let every person open it in Apple Maps, Google Maps, or Waze with no extra setup.
				</p>
				<div class="intro-highlights" aria-label="Key features">
					<span class="intro-highlight">One destination link</span>
					<span class="intro-highlight">QR downloads included</span>
					<span class="intro-highlight">Editable after sharing</span>
				</div>
			</section>

			<section class="product-overview" aria-label="Product overview">
				<article class="overview-main">
					<p class="overview-label">Cross-platform routing</p>
					<h2 class="overview-title">Built for invites, signage, storefronts, and shared team workflows</h2>
					<p class="overview-copy">
						NavQR keeps one clean destination page between your audience and their preferred map provider, while keeping the link editable on your side.
					</p>
				</article>
				<div class="overview-provider-row" aria-label="Supported map providers">
					<span class="overview-provider-pill">Apple Maps</span>
					<span class="overview-provider-pill">Google Maps</span>
					<span class="overview-provider-pill">Waze</span>
				</div>
			</section>
		</section>

		<div class="content-stack">
			{#if !data.supabaseReady}
				<Card class="panel-card">
					<CardHeader>
						<CardTitle>Supabase not configured</CardTitle>
						<CardDescription>
							Set environment variables and create the `links` table before using the generator.
						</CardDescription>
					</CardHeader>
					<CardContent class="text-sm text-muted-foreground">
						<p>{data.loadError}</p>
					</CardContent>
				</Card>
			{/if}

			<section class="quick-guide" aria-label="How NavQR works">
				<p class="quick-guide-title">How it works</p>
				<div class="quick-guide-grid">
					<article class="quick-guide-item">
						<p class="quick-guide-step">1</p>
						<p class="quick-guide-copy">Search a destination and generate a shareable map link.</p>
					</article>
					<article class="quick-guide-item">
						<p class="quick-guide-step">2</p>
						<p class="quick-guide-copy">Customize and download a QR code for print or digital channels.</p>
					</article>
					<article class="quick-guide-item">
						<p class="quick-guide-step">3</p>
						<p class="quick-guide-copy">People scan once and choose Apple Maps, Google Maps, or Waze.</p>
					</article>
				</div>
			</section>

			<section class="workspace-grid" id="builder">
				<Card class="panel-card generator-card">
					<CardHeader>
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0 space-y-1">
								<CardTitle>Create map link</CardTitle>
								<CardDescription>Search for a destination and generate your link.</CardDescription>
							</div>
							{#if hasClearableState}
								<Button
									type="button"
									variant="outline"
									size="sm"
									class="mt-0.5 shrink-0 px-3 text-slate-600 hover:text-slate-900"
									onclick={clearBuilderState}
								>
									Clear
								</Button>
							{/if}
						</div>
					</CardHeader>
					<CardContent>
						<form method="POST" action="?/create" use:enhance onsubmit={handleCreateSubmit} class="space-y-5">
						<div class="space-y-2">
							<Label for="search">Destination</Label>
							<Input
								id="search"
								placeholder="Search place or address"
								bind:value={searchValue}
								bind:ref={searchInputRef}
								autocomplete="off"
								oninput={handleSearchInput}
							/>
							{#if mapsError}
								<p class="text-xs font-medium text-rose-600">{mapsError}</p>
							{/if}
						</div>

						<div class="space-y-2">
							<Label for="custom-slug">Custom link slug (optional)</Label>
							<Input
								id="custom-slug"
								name="customSlug"
								placeholder="my-location"
								bind:value={customSlugValue}
								autocomplete="off"
								spellcheck="false"
							/>
							<p class="text-xs text-slate-500">Use letters, numbers, and hyphens.</p>
						</div>

						<div class="space-y-2">
							<Label for="notes">Notes (optional)</Label>
							<Textarea
								id="notes"
								name="notes"
								maxlength={500}
								rows={3}
								placeholder="Add arrival notes, parking details, or meeting instructions."
								bind:value={notesValue}
							/>
							<p class="text-xs text-slate-500">{notesValue.length}/500</p>
						</div>

						<div class="selection-panel">
							<p class="selection-label">Current selection</p>
							{#if hasResolvedLocation}
								<p class="selection-name">{nameValue}</p>
								<p class="selection-address">{addressValue}</p>
							{:else}
								<p class="text-sm text-slate-500">Choose a destination from search suggestions.</p>
							{/if}
						</div>

						<input type="hidden" name="name" value={nameValue} />
						<input type="hidden" name="address" value={addressValue} />
						<input type="hidden" name="workspaceId" value={workspaceIdForSubmit(workspaceScopeValue)} />
						<input type="hidden" name="lat" value={latValue} />
						<input type="hidden" name="lng" value={lngValue} />

						{#if createError}
							<p class="text-sm font-medium text-destructive">{createError}</p>
						{/if}

						<Button type="submit" class="w-full" disabled={!data.supabaseReady}>Generate link</Button>
						</form>
					</CardContent>
				</Card>

				<Card class="panel-card output-card">
					<CardHeader>
						<CardTitle>Link and QR</CardTitle>
						<CardDescription>Ready for copy, share, or print.</CardDescription>
					</CardHeader>
					<CardContent class="space-y-4">
					{#if generatedUrl}
						{#if generatedSocialPreviewUrl.length > 0}
							<div class="space-y-2">
								<Label>Social preview</Label>
								<div class="social-preview-frame">
									{#if socialPreviewLoading}
										<div class="social-preview-skeleton" aria-hidden="true"></div>
									{/if}
									<img
										src={generatedSocialPreviewUrl}
										alt={`Social preview for ${nameValue || 'generated location'}`}
										class="social-preview-image"
										class:is-loaded={!socialPreviewLoading}
										loading="lazy"
										onload={handleSocialPreviewLoaded}
										onerror={handleSocialPreviewLoaded}
									/>
								</div>
							</div>
						{/if}

						<div class="space-y-2">
							<Label>Shareable URL</Label>
							<InputGroup.Root>
								<InputGroup.Input readonly value={generatedUrl} />
								<InputGroup.Addon align="inline-end" class="ps-1 pe-3 me-0">
									<InputGroup.Button
										size="icon-xs"
										aria-label="Share link"
										title="Share link"
										onclick={shareGeneratedUrl}
									>
										<Share2 size={15} />
									</InputGroup.Button>
								</InputGroup.Addon>
							</InputGroup.Root>
							{#if shareInfo.length > 0}
								<p class="text-xs text-slate-600">{shareInfo}</p>
							{/if}
						</div>

						{#if qrDataUrl}
							<div class="space-y-2">
								<Label>QR code</Label>
								<div class="qr-panel">
									<div class="qr-preview">
										<div class="qr-frame">
											<img
												src={qrDataUrl}
												alt="QR code for generated map link"
												class="qr-image"
											/>
										</div>
									</div>

									<div class="qr-controls">
										<div class="qr-customize">
											<p class="qr-customize-title">Customize</p>
											<div class="qr-customize-grid">
												<div class="qr-compact-row">
													<label for="qr-style-trigger" class="qr-control-label">Style</label>
													<Select.Root type="single" bind:value={qrVisualStyle}>
														<Select.Trigger
															id="qr-style-trigger"
															class="qr-style-select-trigger"
															aria-label="QR code style"
														>
															{currentQrStyleLabel(qrVisualStyle)}
														</Select.Trigger>
														<Select.Content>
															{#each qrStyleOptions as option}
																<Select.Item value={option.value} label={option.label} />
															{/each}
														</Select.Content>
													</Select.Root>
												</div>

												<div class="qr-compact-row qr-compact-row-colors">
													<span class="qr-control-label">Colors</span>
													<div class="qr-inline-controls">
														<label class="qr-mini-field" for="qr-foreground">
															<span class="qr-mini-label">Pattern</span>
															<input
																id="qr-foreground"
																type="color"
																bind:value={qrForegroundColor}
																class="qr-color-picker qr-color-picker-compact"
																aria-label="QR pattern color"
															/>
														</label>
														<label class="qr-mini-field" for="qr-background">
															<span class="qr-mini-label">Background</span>
															<input
																id="qr-background"
																type="color"
																bind:value={qrBackgroundColor}
																class="qr-color-picker qr-color-picker-compact"
																aria-label="QR background color"
																disabled={qrBackgroundTransparent}
															/>
														</label>
														<label class="qr-transparent-toggle">
															<input type="checkbox" bind:checked={qrBackgroundTransparent} />
															<span>Transparent</span>
														</label>
													</div>
												</div>
											</div>
										</div>

										{#if qrContrastNotice.length > 0}
											<p class="qr-notice">{qrContrastNotice}</p>
										{/if}

										<details bind:this={qrDownloadMenuRef} class="qr-download-menu">
											<summary class="qr-download-trigger">Download QR</summary>
											<div class="qr-download-popover">
												<button type="button" class="qr-download-option" onclick={downloadQrPng}>
													PNG
												</button>
												<button type="button" class="qr-download-option" onclick={downloadQrJpg}>
													JPG
												</button>
												<button type="button" class="qr-download-option" onclick={downloadQrWebp}>
													WEBP
												</button>
												<button type="button" class="qr-download-option" onclick={downloadQrSvg}>
													SVG
												</button>
												{#if isIOSDevice}
													<button type="button" class="qr-download-option" onclick={saveQrToPhotosIOS}>
														Save to Photos (iOS)
													</button>
												{/if}
											</div>
										</details>

										{#if qrDownloadError.length > 0}
											<p class="text-xs text-destructive">{qrDownloadError}</p>
										{/if}
										{#if qrDownloadInfo.length > 0}
											<p class="text-xs text-slate-600">{qrDownloadInfo}</p>
										{/if}
									</div>
								</div>
							</div>
						{:else if qrError}
							<p class="text-sm text-destructive">{qrError}</p>
						{/if}
					{:else}
						<div class="output-empty-state">
							<p class="output-empty-title">Ready when you are</p>
							<p class="output-empty-copy">Generate a link to preview sharing and download options.</p>
						</div>
					{/if}
					</CardContent>
				</Card>
			</section>

			<section class="faq-section" aria-label="Frequently asked questions">
				<Card class="faq-card">
					<CardHeader>
						<CardTitle>Frequently asked questions</CardTitle>
						<CardDescription>Answers about map links and directions QR codes.</CardDescription>
					</CardHeader>
					<CardContent class="space-y-3">
						{#each faqItems as item}
							<details class="faq-item">
								<summary>{item.question}</summary>
								<p>{item.answer}</p>
							</details>
						{/each}
						<div class="faq-guides">
							<p class="faq-guides-label">Helpful guides</p>
							<div class="faq-guides-links">
								<a href="/directions-qr-code-generator">Directions QR code generator</a>
								<a href="/map-link-generator">Map link generator</a>
								<a href="/google-maps-qr-code-generator">Google Maps QR code generator</a>
							</div>
						</div>
					</CardContent>
				</Card>
			</section>
		</div>
	</div>
</main>

<style>
	.generator-shell {
		min-height: 100vh;
		position: relative;
		isolation: isolate;
		background:
			radial-gradient(78rem 38rem at 10% -12%, rgba(125, 211, 252, 0.24), transparent 55%),
			radial-gradient(54rem 28rem at 100% 0%, rgba(14, 165, 233, 0.14), transparent 52%),
			linear-gradient(180deg, #f8fbff 0%, #f7fafc 36%, #ffffff 100%);
		overflow: clip;
	}

	.generator-shell::before,
	.generator-shell::after {
		content: '';
		position: absolute;
		inset: auto;
		pointer-events: none;
		z-index: -1;
		filter: blur(32px);
	}

	.generator-shell::before {
		top: 8rem;
		right: -8rem;
		width: 24rem;
		height: 24rem;
		border-radius: 999px;
		background: rgba(56, 189, 248, 0.12);
	}

	.generator-shell::after {
		top: 28rem;
		left: -10rem;
		width: 22rem;
		height: 22rem;
		border-radius: 999px;
		background: rgba(34, 197, 94, 0.08);
	}

	.hero-layout {
		display: grid;
		gap: 1.35rem;
		align-items: start;
	}

	.content-stack {
		display: grid;
		gap: 1rem;
		padding-top: 0.85rem;
	}

	.intro-stack {
		max-width: 52rem;
		display: grid;
		gap: 0.78rem;
	}

	.intro-eyebrow {
		margin: 0;
		display: inline-flex;
		width: fit-content;
		align-items: center;
		padding: 0.26rem 0.6rem;
		border-radius: 999px;
		border: 1px solid rgba(14, 116, 144, 0.28);
		background: rgba(224, 242, 254, 0.78);
		font-size: 0.69rem;
		font-weight: 700;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: #0e7490;
	}

	.intro-title {
		margin: 0;
		font-size: clamp(1.9rem, 4vw, 3.3rem);
		line-height: 0.98;
		font-weight: 800;
		letter-spacing: -0.045em;
		color: #0f172a;
		text-wrap: balance;
	}

	.intro-copy {
		margin: 0;
		max-width: 37rem;
		font-size: 1.02rem;
		line-height: 1.6;
		color: #334155;
	}

	.intro-highlights {
		display: flex;
		flex-wrap: wrap;
		gap: 0.55rem;
		padding-top: 0.05rem;
	}

	.intro-highlight {
		display: inline-flex;
		align-items: center;
		height: 1.95rem;
		padding: 0 0.78rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.72);
		border: 1px solid rgba(148, 163, 184, 0.24);
		box-shadow: 0 12px 30px rgba(15, 23, 42, 0.05);
		font-size: 0.78rem;
		font-weight: 600;
		color: #0f172a;
	}

	.product-overview {
		position: relative;
		display: grid;
		gap: 1rem;
		padding: 1.35rem;
		border-radius: 2rem 1rem 2rem 1.25rem;
		border: 1px solid rgba(125, 211, 252, 0.28);
		background:
			radial-gradient(140% 120% at 0% 0%, rgba(224, 242, 254, 0.92), rgba(255, 255, 255, 0.72) 52%),
			linear-gradient(135deg, rgba(255, 255, 255, 0.9), rgba(240, 249, 255, 0.86));
		backdrop-filter: blur(16px);
		box-shadow:
			0 24px 48px rgba(14, 116, 144, 0.12),
			inset 0 1px 0 rgba(255, 255, 255, 0.88);
		overflow: hidden;
	}

	.product-overview::before {
		content: '';
		position: absolute;
		top: -3rem;
		right: -2rem;
		width: 12rem;
		height: 12rem;
		border-radius: 999px;
		background: rgba(56, 189, 248, 0.18);
		filter: blur(8px);
		opacity: 0.9;
		pointer-events: none;
	}

	.overview-main {
		position: relative;
		display: grid;
		gap: 0.52rem;
		z-index: 1;
	}

	.overview-label {
		margin: 0;
		font-size: 0.69rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #0369a1;
	}

	.overview-title {
		margin: 0;
		font-size: clamp(1.2rem, 2.4vw, 1.65rem);
		line-height: 1.15;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: #0f172a;
		text-wrap: balance;
	}

	.overview-copy {
		margin: 0;
		max-width: 29rem;
		font-size: 0.92rem;
		line-height: 1.6;
		color: #334155;
	}

	.overview-provider-row {
		position: relative;
		z-index: 1;
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

	.overview-provider-pill {
		display: inline-flex;
		align-items: center;
		height: 1.85rem;
		padding: 0 0.72rem;
		border-radius: 999px;
		border: 1px solid rgba(14, 116, 144, 0.18);
		background: rgba(255, 255, 255, 0.78);
		font-size: 0.76rem;
		font-weight: 700;
		color: #0c4a6e;
	}

	.quick-guide {
		display: grid;
		gap: 0.72rem;
		padding: 0.25rem 0 0.15rem;
	}

	.quick-guide-title {
		margin: 0;
		font-size: 0.82rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #475569;
	}

	.quick-guide-grid {
		display: grid;
		gap: 0.7rem;
	}

	.quick-guide-item {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: start;
		gap: 0.72rem;
		padding: 0.9rem 0 0.85rem;
		border-top: 1px solid rgba(148, 163, 184, 0.28);
	}

	.quick-guide-step {
		margin: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 1.7rem;
		min-width: 1.7rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		border: 1px solid rgba(14, 116, 144, 0.24);
		background: rgba(224, 242, 254, 0.72);
		font-size: 0.72rem;
		font-weight: 700;
		color: #0e7490;
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
	}

	.quick-guide-copy {
		margin: 0;
		font-size: 0.86rem;
		line-height: 1.5;
		color: #334155;
	}

	.workspace-grid {
		display: grid;
		gap: 1rem;
		align-items: start;
	}

	.social-preview-frame {
		position: relative;
		overflow: hidden;
		border-radius: 0.82rem;
		border: 1px solid rgba(148, 163, 184, 0.32);
		background: rgba(248, 250, 252, 0.94);
		aspect-ratio: 1200 / 630;
	}

	.social-preview-image {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		opacity: 0;
		transition: opacity 200ms ease;
	}

	.social-preview-image.is-loaded {
		opacity: 1;
	}

	.social-preview-skeleton {
		position: absolute;
		inset: 0;
		background: linear-gradient(
			110deg,
			rgba(226, 232, 240, 0.66) 18%,
			rgba(241, 245, 249, 0.92) 36%,
			rgba(226, 232, 240, 0.66) 55%
		);
		background-size: 220% 100%;
		animation: socialPreviewShimmer 1.2s linear infinite;
	}

	@keyframes socialPreviewShimmer {
		0% {
			background-position: 100% 0;
		}
		100% {
			background-position: -100% 0;
		}
	}

	:global(.panel-card) {
		border-radius: 1.4rem;
		border: 1px solid rgba(148, 163, 184, 0.24);
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.9));
		backdrop-filter: blur(16px);
		box-shadow:
			0 18px 40px rgba(15, 23, 42, 0.08),
			inset 0 1px 0 rgba(255, 255, 255, 0.78);
	}

	:global(.panel-card [data-slot='card-title']) {
		font-size: 0.82rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #475569;
	}

	:global(.panel-card [data-slot='card-description']) {
		color: #64748b;
	}

	:global(.generator-card) {
		border-top-color: rgba(14, 116, 144, 0.3);
		box-shadow:
			0 22px 48px rgba(15, 23, 42, 0.08),
			0 8px 20px rgba(14, 116, 144, 0.06),
			inset 0 1px 0 rgba(255, 255, 255, 0.82);
	}

	:global(.output-card) {
		border-top-color: rgba(37, 99, 235, 0.26);
		background:
			linear-gradient(180deg, rgba(248, 250, 252, 0.94), rgba(255, 255, 255, 0.95)),
			radial-gradient(140% 120% at 100% 0%, rgba(219, 234, 254, 0.18), transparent 55%);
		box-shadow:
			0 22px 50px rgba(15, 23, 42, 0.08),
			0 10px 22px rgba(37, 99, 235, 0.06),
			inset 0 1px 0 rgba(255, 255, 255, 0.84);
	}

	:global(.faq-card) {
		border: 0;
		background: transparent;
		box-shadow: none;
		gap: 0;
		padding: 0;
	}

	:global(.faq-card [data-slot='card-title']) {
		font-size: 0.82rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #475569;
	}

	:global(.faq-card [data-slot='card-header']) {
		padding-left: 0;
		padding-right: 0;
		padding-bottom: 0.9rem;
	}

	:global(.faq-card [data-slot='card-content']) {
		padding: 0;
	}

	.faq-section {
		position: relative;
		isolation: isolate;
		margin-top: 2.85rem;
		padding: 1.6rem 0;
	}

	.faq-section::before {
		content: '';
		position: absolute;
		z-index: -2;
		top: -0.8rem;
		bottom: -0.8rem;
		left: 50%;
		width: 100vw;
		transform: translateX(-50%);
		background:
			radial-gradient(80rem 24rem at 0% 0%, rgba(224, 242, 254, 0.82), transparent 58%),
			radial-gradient(56rem 18rem at 100% 12%, rgba(186, 230, 253, 0.42), transparent 54%),
			linear-gradient(180deg, rgba(241, 245, 249, 0.88), rgba(248, 250, 252, 0.96));
		border-top: 1px solid rgba(148, 163, 184, 0.24);
		border-bottom: 1px solid rgba(148, 163, 184, 0.24);
		pointer-events: none;
	}

	.faq-section::after {
		content: '';
		position: absolute;
		z-index: -1;
		top: -2.8rem;
		right: -2.4rem;
		width: 11rem;
		height: 11rem;
		border-radius: 999px;
		background: rgba(56, 189, 248, 0.14);
		filter: blur(14px);
		pointer-events: none;
	}

	.faq-item {
		padding: 0.95rem 0;
		border-top: 1px solid rgba(148, 163, 184, 0.28);
	}

	.faq-item:first-of-type {
		border-top: 0;
		padding-top: 0;
	}

	.faq-item > summary {
		cursor: pointer;
		list-style: none;
		font-size: 0.9rem;
		font-weight: 600;
		color: #0f172a;
	}

	.faq-item > summary::-webkit-details-marker {
		display: none;
	}

	.faq-item > summary::before {
		content: '+ ';
		color: #64748b;
	}

	.faq-item[open] > summary::before {
		content: '- ';
	}

	.faq-item > p {
		margin: 0.34rem 0 0.62rem 0;
		font-size: 0.85rem;
		line-height: 1.45;
		color: #475569;
	}

	.faq-guides {
		display: grid;
		gap: 0.4rem;
		padding-top: 0.22rem;
	}

	.faq-guides-label {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #64748b;
	}

	.faq-guides-links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

	.faq-guides-links a {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 1.9rem;
		padding: 0 0.62rem;
		border-radius: 0.58rem;
		border: 1px solid rgba(148, 163, 184, 0.4);
		background: rgba(248, 250, 252, 0.88);
		font-size: 0.79rem;
		font-weight: 600;
		color: #0369a1;
		text-decoration: none;
	}

	.faq-guides-links a:hover {
		border-color: rgba(14, 116, 144, 0.4);
		background: rgba(240, 249, 255, 0.88);
	}

	.selection-panel {
		border: 1px solid rgba(14, 116, 144, 0.18);
		border-radius: 1rem;
		padding: 0.9rem 0.9rem;
		background:
			linear-gradient(180deg, rgba(240, 249, 255, 0.82), rgba(236, 253, 245, 0.74));
	}

	.selection-label {
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #0f766e;
	}

	.selection-name {
		margin-top: 0.35rem;
		font-size: 1.02rem;
		font-weight: 700;
		color: #0f172a;
	}

	.selection-address {
		margin-top: 0.22rem;
		font-size: 0.9rem;
		color: #334155;
	}

	:global([data-slot='input-group']) {
		background: rgba(248, 250, 252, 0.65);
		border-color: rgba(148, 163, 184, 0.46);
	}

	:global([data-slot='input-group-control']) {
		color: #0f172a;
		font-size: 0.92rem;
	}

	.output-empty-state {
		display: grid;
		gap: 0.28rem;
		padding: 0.65rem 0.15rem;
	}

	.output-empty-title {
		margin: 0;
		font-size: 0.94rem;
		font-weight: 700;
		color: #0f172a;
	}

	.output-empty-copy {
		margin: 0;
		font-size: 0.86rem;
		line-height: 1.45;
		color: #64748b;
	}

	.qr-frame {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		box-sizing: border-box;
		padding: 0.72rem;
		border-radius: 0.84rem;
		border: 1px solid rgba(148, 163, 184, 0.32);
		background: rgba(255, 255, 255, 0.96);
	}

	.qr-image {
		display: block;
		width: 100%;
		height: auto;
		aspect-ratio: 1 / 1;
		border-radius: 0.65rem;
	}

	.qr-panel {
		display: grid;
		gap: 0.84rem;
		padding: 0.84rem;
		border-radius: 0.86rem;
		border: 1px solid rgba(148, 163, 184, 0.3);
		background:
			linear-gradient(180deg, rgba(248, 250, 252, 0.95), rgba(255, 255, 255, 0.98));
	}

	.qr-preview {
		display: flex;
		width: 100%;
	}

	.qr-controls {
		display: grid;
		gap: 0.7rem;
	}

	.qr-customize {
		display: grid;
		gap: 0.48rem;
	}

	.qr-customize-title {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #475569;
	}

	.qr-customize-grid {
		display: grid;
		gap: 0.46rem;
	}

	.qr-control-label {
		font-size: 0.82rem;
		font-weight: 600;
		color: #334155;
	}

	.qr-compact-row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		column-gap: 0.72rem;
		row-gap: 0.42rem;
		min-height: 2.26rem;
		padding: 0.5rem 0.66rem;
		border-radius: 0.66rem;
		border: 1px solid rgba(148, 163, 184, 0.28);
		background: rgba(248, 250, 252, 0.84);
	}

	.qr-compact-row-colors {
		align-items: flex-start;
		padding-top: 0.56rem;
		padding-bottom: 0.56rem;
	}

	:global(.qr-style-select-trigger) {
		height: 1.9rem;
		width: min(100%, 9.4rem);
		margin-left: auto;
		padding: 0 0.56rem;
		border-radius: 0.5rem;
		border-color: rgba(148, 163, 184, 0.5);
		background: #ffffff;
		font-size: 0.8rem;
		font-weight: 500;
		color: #0f172a;
	}

	.qr-inline-controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		justify-content: flex-end;
		min-width: 0;
	}

	.qr-mini-field {
		display: inline-flex;
		align-items: center;
		gap: 0.38rem;
	}

	.qr-mini-label {
		font-size: 0.73rem;
		font-weight: 600;
		color: #475569;
	}

	.qr-color-picker {
		width: 2.5rem;
		height: 2.5rem;
		padding: 0.2rem;
		border-radius: 0.6rem;
		border: 1px solid rgba(148, 163, 184, 0.5);
		background: #ffffff;
		cursor: pointer;
	}

	.qr-color-picker:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.qr-color-picker-compact {
		width: 1.92rem;
		height: 1.92rem;
		padding: 0.12rem;
		border-radius: 0.46rem;
	}

	.qr-transparent-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.76rem;
		color: #334155;
		user-select: none;
		white-space: nowrap;
	}

	.qr-notice {
		font-size: 0.8rem;
		line-height: 1.4;
		border-radius: 0.62rem;
		border: 1px solid rgba(245, 158, 11, 0.35);
		background: rgba(255, 251, 235, 0.9);
		padding: 0.5rem 0.62rem;
		color: #92400e;
	}

	.qr-download-menu {
		position: relative;
		display: block;
		width: 100%;
	}

	.qr-download-trigger {
		list-style: none;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 2.16rem;
		padding: 0 0.9rem;
		border-radius: 0.6rem;
		border: 1px solid rgba(100, 116, 139, 0.36);
		background: rgba(241, 245, 249, 0.92);
		color: #0f172a;
		font-size: 0.84rem;
		font-weight: 600;
		cursor: pointer;
		user-select: none;
		transition: background 140ms ease, border-color 140ms ease;
	}

	.qr-download-trigger:hover {
		background: rgba(226, 232, 240, 0.8);
		border-color: rgba(71, 85, 105, 0.44);
	}

	.qr-download-trigger::-webkit-details-marker {
		display: none;
	}

	.qr-download-trigger::marker {
		content: '';
	}

	.qr-download-popover {
		position: absolute;
		left: 0;
		top: calc(100% + 0.45rem);
		display: grid;
		gap: 0.22rem;
		min-width: 8rem;
		padding: 0.35rem;
		border-radius: 0.62rem;
		border: 1px solid rgba(148, 163, 184, 0.32);
		background: rgba(255, 255, 255, 0.96);
		backdrop-filter: blur(10px);
		box-shadow: 0 14px 26px rgba(15, 23, 42, 0.11);
		z-index: 10;
	}

	.qr-download-option {
		border: 0;
		border-radius: 0.5rem;
		background: transparent;
		padding: 0.45rem 0.55rem;
		text-align: left;
		font-size: 0.85rem;
		color: #0f172a;
		cursor: pointer;
	}

	.qr-download-option:hover {
		background: rgba(226, 232, 240, 0.78);
	}

	@media (min-width: 1024px) {
		.hero-layout {
			grid-template-columns: minmax(0, 1.02fr) minmax(0, 0.98fr);
			gap: 1.6rem;
		}

		.content-stack {
			padding-top: 1.15rem;
		}

		.workspace-grid {
			grid-template-columns: minmax(0, 1.03fr) minmax(0, 0.97fr);
			gap: 1.4rem;
		}

		:global(.generator-card) {
			position: sticky;
			top: 6rem;
		}

		.quick-guide-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 1rem;
		}

	}

	@media (min-width: 640px) {
		.qr-panel {
			grid-template-columns: auto minmax(0, 1fr);
			align-items: start;
		}

		.qr-preview {
			display: inline-flex;
			width: auto;
		}

		.qr-frame {
			width: auto;
		}

		.qr-image {
			height: 14rem;
			width: 14rem;
			aspect-ratio: auto;
		}
	}

	@media (max-width: 639px) {
		.intro-title {
			font-size: clamp(1.8rem, 10vw, 2.4rem);
		}

		.intro-copy {
			font-size: 0.93rem;
		}

		.intro-highlights {
			gap: 0.45rem;
		}

		.intro-highlight {
			height: 1.82rem;
			padding: 0 0.68rem;
			font-size: 0.74rem;
		}

		.product-overview {
			padding: 1.05rem;
			border-radius: 1.5rem 0.95rem 1.5rem 1rem;
		}

		.content-stack {
			padding-top: 0.65rem;
		}

		.faq-section {
			margin-top: 2.35rem;
			padding: 1.2rem 0 0.7rem;
		}

		.qr-compact-row {
			grid-template-columns: minmax(0, 1fr);
			align-items: flex-start;
		}

		:global(.qr-style-select-trigger) {
			width: 100%;
			max-width: none;
			margin-left: 0;
		}

		.qr-inline-controls {
			width: 100%;
			min-width: 0;
			justify-content: flex-start;
		}
	}
</style>
