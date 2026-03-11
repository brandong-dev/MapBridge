import { parseCoordinate, slugFromName } from '$lib/map';
import {
	ensureUserProfileAndPlan,
	getWorkspaceRole,
	linkLimitForPlan,
	listUserWorkspaces,
	resolveWorkspaceSelection,
	type WorkspaceMembership
} from '$lib/server/workspaces';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const customSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const maxCustomSlugLength = 64;
const minCustomSlugLength = 3;
const maxNotesLength = 500;

function normalizeCustomSlug(value: FormDataEntryValue | null): string {
	if (typeof value !== 'string') return '';

	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function isValidCustomSlug(slug: string): boolean {
	return (
		slug.length >= minCustomSlugLength &&
		slug.length <= maxCustomSlugLength &&
		customSlugPattern.test(slug)
	);
}

export const load: PageServerLoad = async ({ url, locals }) => {
	const origin = url.origin;
	const user = locals.user ? { id: locals.user.id, email: locals.user.email ?? null } : null;
	const requestedWorkspaceId = url.searchParams.get('workspace');

	try {
		const supabase = locals.supabase;
		if (!supabase) {
			return {
				origin,
				user,
				planTier: 'free' as const,
				workspaces: [] as WorkspaceMembership[],
				activeWorkspaceId: null as string | null,
				supabaseReady: false,
				loadError:
					'Supabase is not configured yet. Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY.'
			};
		}

		let planTier: 'free' | 'pro' | 'team' = 'free';
		let workspaces: WorkspaceMembership[] = [];
		let activeWorkspaceId: string | null = null;

		if (locals.user) {
			planTier = await ensureUserProfileAndPlan(supabase, locals.user.id);
			workspaces = await listUserWorkspaces(supabase, locals.user.id);
			activeWorkspaceId = resolveWorkspaceSelection(requestedWorkspaceId, workspaces);
		}

		return {
			origin,
			user,
			planTier,
			workspaces,
			activeWorkspaceId,
			supabaseReady: true,
			loadError: null as string | null
		};
	} catch (error) {
		console.error(error);
		return {
			origin,
			user,
			planTier: 'free' as const,
			workspaces: [] as WorkspaceMembership[],
			activeWorkspaceId: null as string | null,
			supabaseReady: false,
			loadError: 'Supabase is not configured correctly for read operations.'
		};
	}
};

export const actions: Actions = {
	create: async ({ request, url, locals }) => {
		const formData = await request.formData();
		const name = String(formData.get('name') ?? '').trim();
		const address = String(formData.get('address') ?? '').trim();
		const notes = String(formData.get('notes') ?? '').trim();
		const customSlugInput = String(formData.get('customSlug') ?? '');
		const customSlug = normalizeCustomSlug(formData.get('customSlug'));
		const workspaceIdRaw = String(formData.get('workspaceId') ?? '').trim();
		const lat = parseCoordinate(formData.get('lat'), -90, 90);
		const lng = parseCoordinate(formData.get('lng'), -180, 180);
		const values = {
			name,
			address,
			notes,
			customSlug,
			workspaceId: workspaceIdRaw,
			lat: String(formData.get('lat') ?? ''),
			lng: String(formData.get('lng') ?? '')
		};

		if (name.length < 2) {
			return fail(400, { error: 'Location name must be at least 2 characters.', values });
		}

		if (address.length < 4) {
			return fail(400, { error: 'Address must be at least 4 characters.', values });
		}

		if (notes.length > maxNotesLength) {
			return fail(400, { error: `Notes must be ${maxNotesLength} characters or fewer.`, values });
		}

		const hasLatInput = values.lat.trim().length > 0;
		const hasLngInput = values.lng.trim().length > 0;
		if (hasLatInput !== hasLngInput) {
			return fail(400, { error: 'Provide both latitude and longitude, or leave both empty.', values });
		}

		if (hasLatInput && (lat === null || lng === null)) {
			return fail(400, {
				error: 'Latitude/longitude are invalid. Latitude must be -90..90 and longitude -180..180.',
				values
			});
		}

		if (customSlugInput.trim().length > 0 && customSlug.length === 0) {
			return fail(400, {
				error: 'Custom slug is invalid. Use letters, numbers, and hyphens.',
				values
			});
		}

		if (customSlug.length > 0 && !isValidCustomSlug(customSlug)) {
			return fail(400, {
				error: `Custom slug must be ${minCustomSlugLength}-${maxCustomSlugLength} characters using letters, numbers, and hyphens.`,
				values
			});
		}

		try {
			const supabase = locals.supabase;
			if (!supabase) {
				return fail(500, {
					error: 'Supabase is not configured yet. Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY.',
					values
				});
			}

			const workspaceId = workspaceIdRaw.length > 0 ? workspaceIdRaw : null;
			let resolvedWorkspaceId: string | null = null;
			let linkLimit = linkLimitForPlan('free');

			if (locals.user) {
				const planTier = await ensureUserProfileAndPlan(supabase, locals.user.id);
				linkLimit = linkLimitForPlan(planTier);

				if (workspaceId) {
					const workspaceRole = await getWorkspaceRole(supabase, locals.user.id, workspaceId);
					if (!workspaceRole) {
						return fail(403, {
							error: 'You do not have access to that workspace.',
							values
						});
					}
					resolvedWorkspaceId = workspaceId;
					linkLimit = linkLimitForPlan('team');
				}
			} else if (workspaceId) {
				return fail(401, {
					error: 'Sign in to create links in a shared workspace.',
					values
				});
			}

			if (locals.user) {
				const countQuery = resolvedWorkspaceId
					? supabase
							.from('links')
							.select('id', { count: 'exact', head: true })
							.eq('workspace_id', resolvedWorkspaceId)
					: supabase
							.from('links')
							.select('id', { count: 'exact', head: true })
							.eq('user_id', locals.user.id)
							.is('workspace_id', null);

				const { count, error: countError } = await countQuery;
				if (countError) {
					console.error(countError);
					return fail(500, {
						error: 'Could not validate your plan limits right now.',
						values
					});
				}

				if ((count ?? 0) >= linkLimit) {
					return fail(403, {
						error:
							resolvedWorkspaceId === null
								? `You reached your current plan limit of ${linkLimit} personal links.`
								: `This team workspace reached its current limit of ${linkLimit} links.`,
						values
					});
				}
			}

			if (customSlug.length > 0) {
				const payload = {
					slug: customSlug,
					name,
					address,
					notes: notes.length > 0 ? notes : null,
					lat,
					lng,
					user_id: locals.user?.id ?? null,
					workspace_id: resolvedWorkspaceId
				};

				const { error } = await supabase.from('links').insert(payload);
				if (!error) {
					return {
						success: true,
						generatedUrl: `${url.origin}/r/${customSlug}`,
						values
					};
				}

				if (error.code === '23505') {
					return fail(409, {
						error: 'That custom slug is already taken. Try another one.',
						values
					});
				}

				console.error(error);
				return fail(500, { error: error.message, values });
			}

			for (let i = 0; i < 5; i += 1) {
				const slug = slugFromName(name);
				const payload = {
					slug,
					name,
					address,
					notes: notes.length > 0 ? notes : null,
					lat,
					lng,
					user_id: locals.user?.id ?? null,
					workspace_id: resolvedWorkspaceId
				};

				const { error } = await supabase.from('links').insert(payload);
				if (!error) {
					return {
						success: true,
						generatedUrl: `${url.origin}/r/${slug}`,
						values
					};
				}

				if (error.code !== '23505') {
					console.error(error);
					return fail(500, { error: error.message, values });
				}
			}

			return fail(500, {
				error: 'Could not generate a unique link slug. Try submitting again.',
				values
			});
		} catch (error) {
			console.error(error);
			return fail(500, {
				error: 'Supabase is not configured correctly for write operations.',
				values
			});
		}
	}
};
