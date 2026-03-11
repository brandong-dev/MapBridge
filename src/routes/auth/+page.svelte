<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();

	const authError = $derived(
		(form && typeof form === 'object' && 'authError' in form ? String(form.authError ?? '') : '') ||
			(data.authError ?? '')
	);
	const authMessage = $derived(
		(form && typeof form === 'object' && 'authMessage' in form ? String(form.authMessage ?? '') : '') ||
			(data.authMessage ?? '')
	);
	const authEmailValue = $derived(
		form &&
			typeof form === 'object' &&
			'authValues' in form &&
			form.authValues &&
			typeof form.authValues === 'object' &&
			'email' in form.authValues
			? String(form.authValues.email ?? '')
			: ''
	);

	let emailValue = $state('');
	let passwordValue = $state('');

	$effect(() => {
		emailValue = authEmailValue;
	});
</script>

<svelte:head>
	<title>Sign In | NavQR</title>
	<meta name="description" content="Sign in to NavQR with Google or email and password." />
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="auth-shell">
	<div class="mx-auto flex min-h-screen w-full max-w-md items-center px-4 pb-10 pt-24 md:px-6">
		<Card class="auth-card w-full">
			<CardHeader class="space-y-2">
				<p class="auth-eyebrow">Account</p>
				<CardTitle>Sign in</CardTitle>
				<CardDescription>Save and manage your links from any device.</CardDescription>
			</CardHeader>
			<CardContent>
				{#if !data.supabaseReady}
					<p class="text-sm text-muted-foreground">
						Supabase is not configured yet. Set env values to enable authentication.
					</p>
				{:else if data.user}
					<div class="space-y-3">
						<p class="text-sm text-slate-600">Signed in as {data.user.email ?? 'user'}.</p>
						<div class="space-y-2">
							<Button href="/account" class="w-full">Open account</Button>
							<form method="POST" action="?/signOut">
								<Button type="submit" variant="outline" class="w-full">Sign out</Button>
							</form>
						</div>
					</div>
				{:else}
						<div class="space-y-4">
							<form method="POST" action="?/signInGoogle">
								<Button type="submit" variant="secondary" class="w-full">Continue with Google</Button>
							</form>

							<div class="divider"><span>Email and password</span></div>

						<form method="POST" action="?/signInPassword" use:enhance class="space-y-3">
							<div class="space-y-2">
								<Label for="auth-email">Email</Label>
								<Input
									id="auth-email"
									name="email"
									type="email"
									required
									autocomplete="email"
									bind:value={emailValue}
								/>
							</div>
							<div class="space-y-2">
								<Label for="auth-password">Password</Label>
								<Input
									id="auth-password"
									name="password"
									type="password"
									required
									autocomplete="current-password"
									bind:value={passwordValue}
								/>
							</div>
							<div class="grid gap-2 sm:grid-cols-2">
								<Button type="submit" class="w-full">Sign in</Button>
								<Button type="submit" formaction="?/signUpPassword" variant="outline" class="w-full">
									Create account
								</Button>
							</div>
						</form>
					</div>
				{/if}

				{#if authError}
					<p class="mt-4 text-sm font-medium text-destructive">{authError}</p>
				{/if}

				{#if authMessage}
					<p class="mt-4 text-sm font-medium text-emerald-700">{authMessage}</p>
				{/if}
			</CardContent>
		</Card>
	</div>
</main>

<style>
	.auth-shell {
		min-height: 100vh;
	}

	:global(.auth-card) {
		border-radius: 1rem;
		border: 1px solid rgba(148, 163, 184, 0.34);
		border-top-color: rgba(14, 116, 144, 0.36);
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.91));
		backdrop-filter: blur(12px);
		box-shadow:
			0 16px 36px rgba(15, 23, 42, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.74);
	}

	.auth-eyebrow {
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

	:global(.auth-card [data-slot='card-title']) {
		font-size: clamp(1.52rem, 5.2vw, 1.92rem);
		letter-spacing: -0.02em;
	}

	:global(.auth-card [data-slot='card-description']) {
		color: #64748b;
	}

	.divider {
		position: relative;
		text-align: center;
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #64748b;
	}

	.divider::before {
		content: '';
		position: absolute;
		top: 50%;
		left: 0;
		right: 0;
		height: 1px;
		background: rgba(148, 163, 184, 0.38);
	}

	.divider span {
		position: relative;
		padding: 0 0.5rem;
		background: rgba(255, 255, 255, 0.92);
	}
</style>
