import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const DEFAULT_SOCIAL_IMAGE_PATH = '/navqr-social-preview.png';
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function clean(value: string | undefined): string {
	return value?.trim().toLowerCase() ?? '';
}

function getFeaturedSlug(): string {
	const privateSlug = clean(privateEnv.SITE_PREVIEW_SLUG);
	if (privateSlug.length > 0) return privateSlug;

	return clean(publicEnv.PUBLIC_SITE_PREVIEW_SLUG);
}

export const GET: RequestHandler = async ({ url }) => {
	const featuredSlug = getFeaturedSlug();
	if (slugPattern.test(featuredSlug)) {
		redirect(307, `${url.origin}/r/${featuredSlug}/social-image`);
	}

	redirect(307, `${url.origin}${DEFAULT_SOCIAL_IMAGE_PATH}`);
};
