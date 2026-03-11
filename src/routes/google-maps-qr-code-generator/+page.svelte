<svelte:head>
	<title>Google Maps QR Code Generator | NavQR</title>
	<meta
		name="description"
		content="Create a Google Maps QR code for any destination. Generate shareable links and QR codes for events, venues, and local businesses."
	/>
	<link rel="canonical" href="https://navqr.app/google-maps-qr-code-generator" />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="NavQR" />
	<meta property="og:title" content="Google Maps QR Code Generator | NavQR" />
	<meta property="og:description" content="Generate destination QR codes that support Google Maps and other map apps." />
	<meta property="og:url" content="https://navqr.app/google-maps-qr-code-generator" />
	<meta property="og:image" content="https://navqr.app/social-image" />
</svelte:head>

<main class="landing-shell">
	<section class="landing-card">
		<p class="landing-eyebrow">NavQR guide</p>
		<h1 class="landing-title">Google Maps QR code generator</h1>
		<p class="landing-copy">
			Create QR codes for Google Maps destinations while keeping compatibility with Apple Maps and Waze for
			broader coverage.
		</p>
		<ul class="landing-list">
			<li>Search addresses with Google Places autofill.</li>
			<li>Download PNG, JPG, WEBP, or SVG QR formats.</li>
			<li>Share one URL that routes to map app choices.</li>
		</ul>
		<div class="landing-actions">
			<a href="/" class="landing-action is-primary">Open NavQR builder</a>
			<a href="/directions-qr-code-generator" class="landing-action">Directions QR page</a>
			<a href="/map-link-generator" class="landing-action">Map link generator page</a>
		</div>
	</section>
</main>

<style>
	.landing-shell {
		min-height: 100vh;
		padding: 6rem 1rem 2rem;
	}

	.landing-card {
		width: min(58rem, 100%);
		margin: 0 auto;
		display: grid;
		gap: 0.65rem;
		padding: 1.05rem 1.1rem;
		border-radius: 1rem;
		border: 1px solid rgba(148, 163, 184, 0.32);
		border-top-color: rgba(14, 116, 144, 0.34);
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(255, 255, 255, 0.9));
		backdrop-filter: blur(11px);
		box-shadow:
			0 14px 34px rgba(15, 23, 42, 0.08),
			inset 0 1px 0 rgba(255, 255, 255, 0.72);
	}

	.landing-eyebrow {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #64748b;
	}

	.landing-title {
		margin: 0;
		font-size: clamp(1.35rem, 3vw, 1.95rem);
		line-height: 1.1;
		font-weight: 800;
		letter-spacing: -0.02em;
		color: #0f172a;
	}

	.landing-copy {
		margin: 0;
		font-size: 0.96rem;
		line-height: 1.5;
		color: #334155;
	}

	.landing-list {
		margin: 0;
		padding-left: 1rem;
		display: grid;
		gap: 0.28rem;
		font-size: 0.9rem;
		line-height: 1.45;
		color: #475569;
	}

	.landing-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}

	.landing-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 2.1rem;
		padding: 0 0.72rem;
		border-radius: 0.62rem;
		border: 1px solid rgba(148, 163, 184, 0.4);
		background: rgba(248, 250, 252, 0.88);
		font-size: 0.84rem;
		font-weight: 600;
		color: #0369a1;
		text-decoration: none;
	}

	.landing-action.is-primary {
		border-color: rgba(14, 116, 144, 0.42);
		background: rgba(240, 249, 255, 0.9);
	}
</style>
