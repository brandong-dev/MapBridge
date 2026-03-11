<script lang="ts">
	import '../app.css';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import CircleUserRound from '@lucide/svelte/icons/circle-user-round';
	import House from '@lucide/svelte/icons/house';
	import * as Select from '$lib/components/ui/select';
	import type { LayoutData } from './$types';
	import { onMount } from 'svelte';

	let { children, data }: { children: any; data: LayoutData } = $props();
	const PERSONAL_WORKSPACE_VALUE = '__personal__';
	let userMenuRef = $state<HTMLDetailsElement | null>(null);
	let guestMenuRef = $state<HTMLDetailsElement | null>(null);
	let scrolled = $state(false);
	let navWorkspaceValue = $state(PERSONAL_WORKSPACE_VALUE);
	let appliedWorkspaceValue = $state(PERSONAL_WORKSPACE_VALUE);
	const currentYear = new Date().getFullYear();

	const showWorkspaceSelector = $derived(data.pathname === '/' && data.user !== null);

	function normalizeWorkspaceValue(value: unknown): string {
		if (typeof value !== 'string') return PERSONAL_WORKSPACE_VALUE;
		const next = value.trim();
		if (next.length === 0 || next === PERSONAL_WORKSPACE_VALUE) return PERSONAL_WORKSPACE_VALUE;
		return data.workspaces.some((workspace) => workspace.id === next)
			? next
			: PERSONAL_WORKSPACE_VALUE;
	}

	function workspaceLabel(workspaceId: string): string {
		if (workspaceId === PERSONAL_WORKSPACE_VALUE) return 'Personal';
		const workspace = data.workspaces.find((item) => item.id === workspaceId);
		return workspace?.name ?? 'Personal';
	}

	$effect(() => {
		const next = normalizeWorkspaceValue(data.activeWorkspaceId ?? PERSONAL_WORKSPACE_VALUE);
		navWorkspaceValue = next;
		appliedWorkspaceValue = next;
	});

	$effect(() => {
		if (!browser || !showWorkspaceSelector) return;
		const next = normalizeWorkspaceValue(navWorkspaceValue);
		if (next === appliedWorkspaceValue) return;

		appliedWorkspaceValue = next;

		const url = new URL(window.location.href);
		if (next === PERSONAL_WORKSPACE_VALUE) {
			url.searchParams.delete('workspace');
		} else {
			url.searchParams.set('workspace', next);
		}

		goto(`${url.pathname}${url.search}${url.hash}`, {
			keepFocus: true,
			noScroll: true,
			replaceState: true,
			invalidateAll: true
		});
	});

	onMount(() => {
		function handleScroll() {
			scrolled = window.scrollY > 8;
		}

		function handlePointerDown(event: PointerEvent) {
			const target = event.target;
			if (!(target instanceof Node)) return;

			if (userMenuRef?.open && !userMenuRef.contains(target)) {
				userMenuRef.open = false;
			}

			if (guestMenuRef?.open && !guestMenuRef.contains(target)) {
				guestMenuRef.open = false;
			}
		}

		function handleEscape(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				if (userMenuRef?.open) userMenuRef.open = false;
				if (guestMenuRef?.open) guestMenuRef.open = false;
			}
		}

		handleScroll();
		window.addEventListener('scroll', handleScroll, { passive: true });
		document.addEventListener('pointerdown', handlePointerDown);
		document.addEventListener('keydown', handleEscape);

		return () => {
			window.removeEventListener('scroll', handleScroll);
			document.removeEventListener('pointerdown', handlePointerDown);
			document.removeEventListener('keydown', handleEscape);
		};
	});
</script>

<svelte:head>
	<link rel="icon" type="image/png" href="/navqr-favicon.png" />
	<link rel="apple-touch-icon" href="/navqr-favicon.png" />
</svelte:head>

<div class="site-shell">
	<div class="top-scrim" class:is-visible={scrolled} aria-hidden="true"></div>

	<header class="site-header">
		<div class="nav-frame" class:is-scrolled={scrolled}>
			<div class="nav-inner">
				<a href="/" class="nav-title" aria-label="NavQR home">
					<img src="/navqr-title.png" alt="NavQR" class="nav-title-image" />
				</a>

				<div class="nav-actions">
					{#if showWorkspaceSelector}
						<div class="nav-workspace">
							<Select.Root type="single" bind:value={navWorkspaceValue}>
								<Select.Trigger
									size="sm"
									class="nav-workspace-trigger"
									aria-label="Select workspace"
								>
									{workspaceLabel(navWorkspaceValue)}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value={PERSONAL_WORKSPACE_VALUE} label="Personal" />
									{#each data.workspaces as workspace}
										<Select.Item value={workspace.id} label={workspace.name} />
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
					{/if}

					{#if data.pathname === '/auth'}
						<a href="/" class="icon-trigger" aria-label="Go to home">
							<House size={21} />
						</a>
					{:else if !data.user}
						<details bind:this={guestMenuRef} class="user-menu">
							<summary class="user-trigger" aria-label="Open guest menu">
								<CircleUserRound size={21} />
							</summary>
							<div class="user-popover">
								<a class="menu-link" href="/account">History</a>
								<a class="menu-link" href="/auth">Sign in</a>
							</div>
						</details>
					{:else}
						<details bind:this={userMenuRef} class="user-menu">
							<summary class="user-trigger" aria-label="Open user menu">
								<CircleUserRound size={21} />
							</summary>
							<div class="user-popover">
								<p class="user-email">{data.user.email ?? 'Signed in'}</p>
								<a class="menu-link" href="/account">Account</a>
								<form method="POST" action="/auth?/signOut">
									<button type="submit" class="menu-button">Sign out</button>
								</form>
							</div>
						</details>
					{/if}
				</div>
			</div>
		</div>
	</header>

	<div class="site-content">
		{@render children()}
	</div>

	<footer class="site-footer" class:is-home={data.pathname === '/'}>
		<div class="footer-frame">
			<div class="footer-brand">
				<a href="/" class="footer-title" aria-label="NavQR home">
					<img src="/navqr-title.png" alt="NavQR" class="footer-title-image" />
				</a>
				<p class="footer-copy">Map links and directions QR codes for Apple Maps, Google Maps, and Waze.</p>
			</div>

			<nav class="footer-links" aria-label="Footer">
				<a href="/">Home</a>
				<a href="/account">{data.user ? 'Account' : 'History'}</a>
				<a href="/directions-qr-code-generator">Directions QR guide</a>
				<a href="/map-link-generator">Map link guide</a>
			</nav>

			<p class="footer-meta">© {currentYear} NavQR</p>
		</div>
	</footer>
</div>

<style>
	.site-shell {
		position: relative;
		min-height: 100vh;
		isolation: isolate;
		display: flex;
		flex-direction: column;
	}

	.site-shell::before {
		content: '';
		position: fixed;
		inset: 0;
		z-index: -3;
		background:
			radial-gradient(980px 560px at -8% -14%, rgba(14, 165, 233, 0.24), transparent 62%),
			radial-gradient(960px 540px at 112% 8%, rgba(6, 182, 212, 0.17), transparent 62%),
			radial-gradient(760px 420px at 56% 108%, rgba(56, 189, 248, 0.14), transparent 68%),
			linear-gradient(180deg, #f7fbff 0%, #f2f7fd 56%, #edf4fb 100%);
	}

	.site-shell::after {
		content: '';
		position: fixed;
		inset: 0;
		z-index: -2;
		background-image:
			linear-gradient(rgba(15, 23, 42, 0.02) 1px, transparent 1px),
			linear-gradient(90deg, rgba(15, 23, 42, 0.02) 1px, transparent 1px);
		background-size: 24px 24px;
		opacity: 0.42;
		pointer-events: none;
	}

	.site-header {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 40;
		pointer-events: none;
	}

	.top-scrim {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 3.85rem;
		z-index: 35;
		pointer-events: none;
		opacity: 0;
		transition: opacity 180ms ease;
		background:
			linear-gradient(
				180deg,
				rgba(247, 251, 255, 0.94) 0%,
				rgba(247, 251, 255, 0.8) 34%,
				rgba(247, 251, 255, 0.46) 66%,
				rgba(247, 251, 255, 0.14) 86%,
				rgba(247, 251, 255, 0) 100%
			);
		backdrop-filter: blur(8px);
	}

	.top-scrim.is-visible {
		opacity: 1;
	}

	.nav-frame {
		pointer-events: auto;
		width: 100%;
		margin-top: 0;
		padding: 0.16rem 0;
		border-bottom: 1px solid transparent;
		transition:
			background 180ms ease,
			border-color 180ms ease,
			box-shadow 180ms ease,
			backdrop-filter 180ms ease;
	}

	.nav-frame.is-scrolled {
		background: rgba(248, 250, 252, 0.9);
		border-color: rgba(148, 163, 184, 0.22);
		backdrop-filter: blur(14px) saturate(1.12);
		box-shadow:
			0 10px 24px rgba(15, 23, 42, 0.05),
			inset 0 1px 0 rgba(255, 255, 255, 0.72);
	}

	.nav-inner {
		display: flex;
		width: min(74rem, calc(100% - 1.2rem));
		margin: 0 auto;
		align-items: center;
		justify-content: space-between;
		padding: 0.56rem 0.2rem;
	}

	.nav-title {
		display: inline-flex;
		align-items: center;
		line-height: 0;
		text-decoration: none;
	}

	.nav-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.nav-workspace {
		min-width: 0;
		max-width: min(12.5rem, calc(100vw - 8.4rem));
	}

	:global(.nav-workspace-trigger) {
		width: min(12.5rem, calc(100vw - 8.4rem));
		height: 2.3rem;
		border-radius: 999px;
		border-color: rgba(148, 163, 184, 0.42);
		background: rgba(255, 255, 255, 0.88);
		backdrop-filter: blur(8px);
		box-shadow: 0 8px 18px rgba(15, 23, 42, 0.09);
		padding-inline: 0.82rem;
		font-size: 0.82rem;
		font-weight: 600;
		color: #0f172a;
	}

	:global(.nav-workspace-trigger [data-slot='select-value']) {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.nav-title-image {
		display: block;
		height: clamp(2.2rem, 4.4vw, 2.7rem);
		width: auto;
		filter: drop-shadow(0 9px 20px rgba(3, 105, 161, 0.14));
	}

	.icon-trigger {
		display: inline-grid;
		place-items: center;
		height: 2.3rem;
		width: 2.3rem;
		margin: 0;
		padding: 0;
		border-radius: 9999px;
		border: 1px solid rgba(148, 163, 184, 0.46);
		background: rgba(255, 255, 255, 0.88);
		backdrop-filter: blur(8px);
		color: #0f172a;
		text-decoration: none;
		box-shadow: 0 8px 18px rgba(15, 23, 42, 0.09);
		line-height: 0;
		font-size: 0;
		-webkit-tap-highlight-color: transparent;
		transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
	}

	.icon-trigger:hover {
		transform: translateY(-1px);
		background: rgba(255, 255, 255, 0.96);
		border-color: rgba(14, 116, 144, 0.38);
	}

	.icon-trigger:focus-visible {
		outline: 2px solid rgba(14, 116, 144, 0.45);
		outline-offset: 1px;
	}

	.user-menu {
		position: relative;
	}

	.user-trigger {
		list-style: none;
		display: inline-grid;
		place-items: center;
		width: 2.3rem;
		height: 2.3rem;
		margin: 0;
		padding: 0;
		border-radius: 9999px;
		border: 1px solid rgba(148, 163, 184, 0.46);
		background: rgba(255, 255, 255, 0.88);
		color: #0f172a;
		backdrop-filter: blur(8px);
		box-shadow: 0 8px 18px rgba(15, 23, 42, 0.09);
		cursor: pointer;
		line-height: 0;
		font-size: 0;
		-webkit-appearance: none;
		appearance: none;
		-webkit-tap-highlight-color: transparent;
		transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
	}

	.user-trigger:hover {
		transform: translateY(-1px);
		background: rgba(255, 255, 255, 0.96);
		border-color: rgba(14, 116, 144, 0.38);
	}

	.user-trigger:focus-visible {
		outline: 2px solid rgba(14, 116, 144, 0.45);
		outline-offset: 1px;
	}

	.user-trigger::-webkit-details-marker {
		display: none;
	}

	.user-trigger::marker {
		content: '';
	}

	.icon-trigger :global(svg),
	.user-trigger :global(svg) {
		display: block;
		width: 1.2rem;
		height: 1.2rem;
	}

	.user-popover {
		position: absolute;
		right: 0;
		top: calc(100% + 0.48rem);
		min-width: 14rem;
		border-radius: 0.84rem;
		border: 1px solid rgba(148, 163, 184, 0.34);
		background: rgba(255, 255, 255, 0.94);
		padding: 0.48rem;
		backdrop-filter: blur(10px);
		box-shadow: 0 14px 30px rgba(15, 23, 42, 0.12);
	}

	.user-email {
		margin: 0.18rem 0.35rem 0.45rem;
		font-size: 0.78rem;
		color: #475569;
		word-break: break-all;
	}

	.menu-link,
	.menu-button {
		display: block;
		width: 100%;
		border: 0;
		border-radius: 0.5rem;
		background: transparent;
		padding: 0.5rem 0.62rem;
		text-align: left;
		font-size: 0.84rem;
		color: #0f172a;
		text-decoration: none;
		cursor: pointer;
	}

	.menu-link:hover,
	.menu-button:hover {
		background: rgba(226, 232, 240, 0.7);
	}

	.site-content {
		flex: 1 0 auto;
		min-height: 0;
	}

	.site-footer {
		position: relative;
		padding: 1.6rem 0 2rem;
	}

	.site-footer.is-home {
		padding-top: 0.95rem;
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(240, 244, 248, 0.98));
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.82);
	}

	.site-footer::before {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		height: 1px;
		background: linear-gradient(90deg, transparent, rgba(148, 163, 184, 0.34), transparent);
	}

	.site-footer.is-home::before {
		display: block;
		background: linear-gradient(90deg, transparent, rgba(100, 116, 139, 0.3), transparent);
	}

	.footer-frame {
		display: grid;
		gap: 1rem;
		width: min(74rem, calc(100% - 1.2rem));
		margin: 0 auto;
		padding: 0.6rem 0.2rem 0;
	}

	.footer-brand {
		display: grid;
		gap: 0.45rem;
		max-width: 26rem;
	}

	.footer-title {
		display: inline-flex;
		align-items: center;
		line-height: 0;
		text-decoration: none;
		width: fit-content;
	}

	.footer-title-image {
		display: block;
		height: 2rem;
		width: auto;
		opacity: 0.96;
	}

	.footer-copy {
		margin: 0;
		font-size: 0.84rem;
		line-height: 1.5;
		color: #475569;
	}

	.footer-links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.75rem;
	}

	.footer-links a {
		font-size: 0.82rem;
		font-weight: 600;
		color: #0f172a;
		text-decoration: none;
	}

	.footer-links a:hover {
		color: #0369a1;
	}

	.footer-meta {
		margin: 0;
		font-size: 0.76rem;
		color: #64748b;
	}

	@media (min-width: 768px) {
		.nav-inner {
			width: min(74rem, calc(100% - 2rem));
			padding-left: 0.32rem;
			padding-right: 0.32rem;
		}

		.nav-workspace {
			max-width: 13.5rem;
		}

		:global(.nav-workspace-trigger) {
			width: 13.5rem;
		}

		.footer-frame {
			width: min(74rem, calc(100% - 2rem));
			grid-template-columns: minmax(0, 1.2fr) auto auto;
			align-items: end;
			gap: 1.2rem;
			padding-left: 0.32rem;
			padding-right: 0.32rem;
		}

		.footer-links {
			justify-content: center;
		}

		.footer-meta {
			text-align: right;
			white-space: nowrap;
		}
	}
</style>
