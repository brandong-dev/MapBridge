import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
	const lastmod = new Date().toISOString();
	const entries = [
		{
			loc: `${url.origin}/`,
			changefreq: 'weekly',
			priority: '1.0'
		},
		{
			loc: `${url.origin}/directions-qr-code-generator`,
			changefreq: 'monthly',
			priority: '0.8'
		},
		{
			loc: `${url.origin}/map-link-generator`,
			changefreq: 'monthly',
			priority: '0.8'
		},
		{
			loc: `${url.origin}/google-maps-qr-code-generator`,
			changefreq: 'monthly',
			priority: '0.8'
		}
	];

	const urls = entries
		.map(
			(entry) =>
				`<url><loc>${entry.loc}</loc><lastmod>${lastmod}</lastmod><changefreq>${entry.changefreq}</changefreq><priority>${entry.priority}</priority></url>`
		)
		.join('');

	const body = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;

	return new Response(body, {
		headers: {
			'Content-Type': 'application/xml; charset=utf-8',
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
