<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let previewImageLoading = $state(true);

	function handlePreviewImageLoaded() {
		previewImageLoading = false;
	}
</script>

<svelte:head>
	<title>{data.title}</title>
	<meta name="description" content={data.description} />
	<meta name="robots" content="noindex, nofollow" />
	<link rel="canonical" href={`${data.origin}/r/${data.slug}`} />

	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="NavQR" />
	<meta property="og:url" content={`${data.origin}/r/${data.slug}`} />
	<meta property="og:title" content={data.title} />
	<meta property="og:description" content={data.description} />
	<meta property="og:image" content={data.socialImageUrl} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content="Preview image for this location link" />

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={data.title} />
	<meta name="twitter:description" content={data.description} />
	<meta name="twitter:image" content={data.socialImageUrl} />
	<meta name="twitter:image:alt" content="Preview image for this location link" />
</svelte:head>

<main class="preview-shell">
	<section class="preview-card">
		<div class="preview-media">
			{#if previewImageLoading}
				<div class="preview-media-skeleton" aria-hidden="true"></div>
			{/if}
			<img
				src={data.socialImageUrl}
				alt={`Preview for ${data.locationName}`}
				class="preview-image"
				class:is-loaded={!previewImageLoading}
				onload={handlePreviewImageLoaded}
				onerror={handlePreviewImageLoaded}
			/>
		</div>
		<p class="preview-eyebrow">Location link</p>
		<h1 class="preview-title">{data.locationName}</h1>
		{#if data.address.length > 0}
			<p class="preview-address">{data.address}</p>
		{/if}
		{#if data.notes.length > 0}
			<p class="preview-notes">{data.notes}</p>
		{/if}
		<p class="preview-copy">Choose a map app to open directions.</p>
		<div class="preview-provider-grid">
			{#each data.mapProviders as provider}
				<a href={provider.href} class="preview-link">
					<span>Open in {provider.label}</span>
					{#if provider.label === data.preferredProvider}
						<span class="preview-link-meta">Recommended</span>
					{/if}
				</a>
			{/each}
		</div>
		<p class="preview-hint">If an app is not installed, a web version may open instead.</p>
	</section>
</main>

<style>
	.preview-shell {
		min-height: 100vh;
		display: grid;
		place-items: center;
		padding: 1.25rem;
	}

	.preview-card {
		width: min(38rem, 100%);
		border-radius: 1rem;
		border: 1px solid rgba(148, 163, 184, 0.34);
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.91));
		padding: 1rem;
		box-shadow:
			0 16px 34px rgba(15, 23, 42, 0.1),
			inset 0 1px 0 rgba(255, 255, 255, 0.72);
		display: grid;
		gap: 0.5rem;
	}

	.preview-media {
		position: relative;
		overflow: hidden;
		border-radius: 0.8rem;
		border: 1px solid rgba(148, 163, 184, 0.24);
		background: rgba(248, 250, 252, 0.92);
		aspect-ratio: 1200 / 630;
	}

	.preview-image {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		opacity: 0;
		transition: opacity 200ms ease;
	}

	.preview-image.is-loaded {
		opacity: 1;
	}

	.preview-media-skeleton {
		position: absolute;
		inset: 0;
		background: linear-gradient(
			110deg,
			rgba(226, 232, 240, 0.66) 18%,
			rgba(241, 245, 249, 0.92) 36%,
			rgba(226, 232, 240, 0.66) 55%
		);
		background-size: 220% 100%;
		animation: previewShimmer 1.2s linear infinite;
	}

	@keyframes previewShimmer {
		0% {
			background-position: 100% 0;
		}
		100% {
			background-position: -100% 0;
		}
	}

	.preview-eyebrow {
		margin: 0.05rem 0 0;
		display: inline-flex;
		width: fit-content;
		align-items: center;
		padding: 0.22rem 0.52rem;
		border-radius: 999px;
		border: 1px solid rgba(14, 116, 144, 0.28);
		background: rgba(224, 242, 254, 0.78);
		font-size: 0.66rem;
		font-weight: 700;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: #0e7490;
	}

	.preview-title {
		margin: 0;
		font-size: 1.2rem;
		font-weight: 800;
		letter-spacing: -0.015em;
		color: #0f172a;
	}

	.preview-address {
		margin: 0;
		font-size: 0.92rem;
		color: #334155;
	}

	.preview-notes {
		margin: 0;
		padding: 0.58rem 0.66rem;
		border-radius: 0.62rem;
		border: 1px solid rgba(148, 163, 184, 0.28);
		background: rgba(248, 250, 252, 0.76);
		font-size: 0.84rem;
		line-height: 1.45;
		white-space: pre-line;
		color: #334155;
	}

	.preview-copy {
		margin: 0.15rem 0 0;
		font-size: 0.86rem;
		color: #475569;
	}

	.preview-provider-grid {
		display: grid;
		gap: 0.45rem;
	}

	.preview-link {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 2.5rem;
		width: 100%;
		padding: 0.52rem 0.82rem;
		border-radius: 0.7rem;
		border: 1px solid rgba(148, 163, 184, 0.38);
		text-decoration: none;
		font-size: 0.88rem;
		font-weight: 600;
		color: #0f172a;
		background: rgba(255, 255, 255, 0.92);
		transition: border-color 120ms ease, background 120ms ease, transform 120ms ease;
	}

	.preview-link:hover {
		transform: translateY(-1px);
		border-color: rgba(14, 116, 144, 0.45);
		background: rgba(240, 249, 255, 0.9);
	}

	.preview-link-meta {
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: #0369a1;
	}

	.preview-hint {
		margin: 0;
		font-size: 0.78rem;
		line-height: 1.4;
		color: #64748b;
	}
</style>
