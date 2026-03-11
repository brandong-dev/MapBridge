<script lang="ts">
	type RouteError = { message?: string };

	let { error, status }: { error: RouteError; status: number } = $props();

	const title = $derived(status === 404 ? 'Link not found' : 'Something went wrong');
	const message = $derived(
		status === 404
			? 'This NavQR link no longer exists or has been disabled.'
			: error?.message?.trim() || 'Unable to open this NavQR link right now.'
	);
</script>

<svelte:head>
	<title>{title} - NavQR</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="missing-shell">
	<section class="missing-card">
		<p class="missing-status">Error {status}</p>
		<h1 class="missing-title">{title}</h1>
		<p class="missing-copy">{message}</p>
		<div class="missing-actions">
			<a href="/" class="missing-action is-primary">Go to NavQR</a>
			<a href="/account" class="missing-action">View history</a>
		</div>
	</section>
</main>

<style>
	.missing-shell {
		min-height: 100vh;
		display: grid;
		place-items: center;
		padding: 1.25rem;
	}

	.missing-card {
		width: min(32rem, 100%);
		display: grid;
		gap: 0.7rem;
		padding: 1.15rem;
		border-radius: 1rem;
		border: 1px solid rgba(148, 163, 184, 0.34);
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.91));
		box-shadow:
			0 16px 34px rgba(15, 23, 42, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.72);
	}

	.missing-status {
		margin: 0;
		font-size: 0.74rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #0e7490;
	}

	.missing-title {
		margin: 0;
		font-size: clamp(1.3rem, 2.5vw, 1.65rem);
		line-height: 1.1;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: #0f172a;
	}

	.missing-copy {
		margin: 0;
		font-size: 0.94rem;
		line-height: 1.5;
		color: #334155;
	}

	.missing-actions {
		margin-top: 0.1rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.missing-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 2.2rem;
		padding: 0 0.82rem;
		border-radius: 0.64rem;
		border: 1px solid rgba(148, 163, 184, 0.4);
		background: rgba(255, 255, 255, 0.92);
		color: #0f172a;
		font-size: 0.86rem;
		font-weight: 600;
		text-decoration: none;
	}

	.missing-action.is-primary {
		border-color: rgba(3, 105, 161, 0.45);
		background: linear-gradient(135deg, #0ea5e9, #0369a1);
		color: #fff;
	}
</style>
