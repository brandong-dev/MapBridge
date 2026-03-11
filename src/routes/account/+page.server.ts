import { parseCoordinate } from '$lib/map';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import {
	createStripeClient,
	getStripeConfig,
	getStripePlanDefinition,
	normalizePaidPlanTier
} from '$lib/server/stripe';
import {
	ensureUserProfileAndPlan,
	getWorkspaceRole,
	linkLimitForPlan,
	listUserWorkspaces,
	resolveWorkspaceSelection
} from '$lib/server/workspaces';
import type { MapLinkRecord } from '$lib/types';
import { fail, redirect } from '@sveltejs/kit';
import { randomBytes } from 'node:crypto';
import type { Actions, PageServerLoad } from './$types';

const RECENT_LINK_LIMIT = 50;
const MAX_NOTES_LENGTH = 500;
const INVITE_EXPIRY_DAYS = 14;

type LinkEditValues = {
	slug: string;
	name: string;
	address: string;
	notes: string;
	lat: string;
	lng: string;
};

type WorkspaceInviteSummary = {
	id: string;
	workspaceId: string;
	code: string;
	expiresAt: string;
	createdAt: string;
};

type WorkspaceMemberSummary = {
	userId: string;
	email: string | null;
	role: 'owner' | 'member';
	createdAt: string;
	isCurrentUser: boolean;
};

function normalizeSlug(value: FormDataEntryValue | null): string {
	if (typeof value !== 'string') return '';
	return value.trim().toLowerCase();
}

function normalizeWorkspaceId(value: FormDataEntryValue | null): string {
	if (typeof value !== 'string') return '';
	return value.trim();
}

function normalizeInviteCode(value: FormDataEntryValue | null): string {
	if (typeof value !== 'string') return '';
	return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeEditValues(formData: FormData): LinkEditValues {
	return {
		slug: normalizeSlug(formData.get('slug')),
		name: String(formData.get('name') ?? '').trim(),
		address: String(formData.get('address') ?? '').trim(),
		notes: String(formData.get('notes') ?? '').trim(),
		lat: String(formData.get('lat') ?? '').trim(),
		lng: String(formData.get('lng') ?? '').trim()
	};
}

function requireSignedIn(locals: App.Locals) {
	if (!locals.user || !locals.supabase) {
		return fail(401, {
			manageError: 'Sign in to manage links.',
			activeSlug: '',
			values: null
		});
	}
	return null;
}

function requireSignedInForTeam(locals: App.Locals) {
	if (!locals.user || !locals.supabase) {
		return fail(401, {
			teamError: 'Sign in to manage workspaces.'
		});
	}
	return null;
}

function validateEdit(values: LinkEditValues) {
	if (values.slug.length === 0) {
		return 'Missing link slug.';
	}

	if (values.name.length < 2) {
		return 'Location name must be at least 2 characters.';
	}

	if (values.address.length < 4) {
		return 'Address must be at least 4 characters.';
	}

	if (values.notes.length > MAX_NOTES_LENGTH) {
		return `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`;
	}

	const hasLat = values.lat.length > 0;
	const hasLng = values.lng.length > 0;
	if (hasLat !== hasLng) {
		return 'Provide both latitude and longitude, or leave both empty.';
	}

	const lat = parseCoordinate(values.lat, -90, 90);
	const lng = parseCoordinate(values.lng, -180, 180);
	if ((hasLat || hasLng) && (lat === null || lng === null)) {
		return 'Latitude/longitude are invalid. Latitude must be -90..90 and longitude -180..180.';
	}

	return null;
}

function buildInviteCode(): string {
	return randomBytes(5).toString('hex');
}

async function countPersonalLinks(supabase: App.Locals['supabase'], userId: string): Promise<number> {
	if (!supabase) return 0;

	const { count, error } = await supabase
		.from('links')
		.select('id', { count: 'exact', head: true })
		.eq('user_id', userId)
		.is('workspace_id', null);

	if (error) throw error;
	return count ?? 0;
}

async function countWorkspaceLinks(
	supabase: App.Locals['supabase'],
	workspaceId: string
): Promise<number> {
	if (!supabase) return 0;

	const { count, error } = await supabase
		.from('links')
		.select('id', { count: 'exact', head: true })
		.eq('workspace_id', workspaceId);

	if (error) throw error;
	return count ?? 0;
}

async function resolveMemberEmails(userIds: string[]): Promise<Map<string, string | null>> {
	const ids = [...new Set(userIds.filter((value) => value.trim().length > 0))];
	const resolved = new Map<string, string | null>();
	if (ids.length === 0) return resolved;

	let adminClient;
	try {
		adminClient = createSupabaseAdminClient();
	} catch (error) {
		console.error(error);
		return resolved;
	}

	await Promise.all(
		ids.map(async (userId) => {
			const { data, error } = await adminClient.auth.admin.getUserById(userId);
			if (error) {
				console.error(error);
				resolved.set(userId, null);
				return;
			}

			resolved.set(userId, data.user.email ?? null);
		})
	);

	return resolved;
}

async function listWorkspaceMembers(
	supabase: App.Locals['supabase'],
	currentUserId: string,
	workspaceId: string
): Promise<WorkspaceMemberSummary[]> {
	if (!supabase) return [];

	const { data, error } = await supabase
		.from('workspace_members')
		.select('user_id,role,created_at')
		.eq('workspace_id', workspaceId)
		.order('created_at', { ascending: true });

	if (error) throw error;

	const rows = data ?? [];
	const emailMap = await resolveMemberEmails(
		rows.map((row) => (typeof row.user_id === 'string' ? row.user_id : ''))
	);

	return rows
		.map((row) => {
			const userId = typeof row.user_id === 'string' ? row.user_id : '';
			if (userId.length === 0) return null;

			return {
				userId,
				email: emailMap.get(userId) ?? null,
				role: row.role === 'owner' ? 'owner' : 'member',
				createdAt: typeof row.created_at === 'string' ? row.created_at : '',
				isCurrentUser: userId === currentUserId
			} satisfies WorkspaceMemberSummary;
		})
		.filter((value): value is WorkspaceMemberSummary => value !== null);
}

async function listWorkspaceInvites(
	supabase: App.Locals['supabase'],
	workspaceId: string
): Promise<WorkspaceInviteSummary[]> {
	if (!supabase) return [];

	const { data, error } = await supabase
		.from('workspace_invites')
		.select('id,workspace_id,code,expires_at,used_at,created_at')
		.eq('workspace_id', workspaceId)
		.is('used_at', null)
		.gt('expires_at', new Date().toISOString())
		.order('created_at', { ascending: false });

	if (error) throw error;

	return (data ?? [])
		.map((invite) => {
			const id = typeof invite.id === 'string' ? invite.id.trim() : '';
			const inviteWorkspaceId =
				typeof invite.workspace_id === 'string' ? invite.workspace_id.trim() : '';
			const code = typeof invite.code === 'string' ? invite.code.trim() : '';
			const expiresAt = typeof invite.expires_at === 'string' ? invite.expires_at : '';
			const createdAt = typeof invite.created_at === 'string' ? invite.created_at : '';
			if (
				id.length === 0 ||
				inviteWorkspaceId.length === 0 ||
				code.length === 0 ||
				expiresAt.length === 0
			) {
				return null;
			}

			return {
				id,
				workspaceId: inviteWorkspaceId,
				code,
				expiresAt,
				createdAt
			} satisfies WorkspaceInviteSummary;
		})
		.filter((value): value is WorkspaceInviteSummary => value !== null);
}

async function createInviteCode(
	supabase: App.Locals['supabase'],
	workspaceId: string,
	userId: string
): Promise<string> {
	if (!supabase) {
		throw new Error('Supabase client is not available.');
	}

	const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

	for (let i = 0; i < 5; i += 1) {
		const code = buildInviteCode();
		const { error } = await supabase.from('workspace_invites').insert({
			workspace_id: workspaceId,
			created_by_user_id: userId,
			code,
			expires_at: expiresAt
		});

		if (!error) return code;
		if (error.code !== '23505') {
			throw error;
		}
	}

	throw new Error('Could not generate a unique invite code.');
}

async function getBillingProfile(
	supabase: App.Locals['supabase'],
	userId: string
): Promise<{
	stripeCustomerId: string | null;
	stripeSubscriptionStatus: string | null;
}> {
	if (!supabase) {
		return {
			stripeCustomerId: null,
			stripeSubscriptionStatus: null
		};
	}

	const { data, error } = await supabase
		.from('user_profiles')
		.select('stripe_customer_id,stripe_subscription_status')
		.eq('user_id', userId)
		.maybeSingle();

	if (error) throw error;

	return {
		stripeCustomerId:
			typeof data?.stripe_customer_id === 'string' && data.stripe_customer_id.trim().length > 0
				? data.stripe_customer_id.trim()
				: null,
		stripeSubscriptionStatus:
			typeof data?.stripe_subscription_status === 'string' &&
			data.stripe_subscription_status.trim().length > 0
				? data.stripe_subscription_status.trim()
				: null
	};
}

async function ensureStripeCustomer(
	supabase: App.Locals['supabase'],
	userId: string,
	email: string | null
): Promise<string> {
	if (!supabase) {
		throw new Error('Supabase client is not available.');
	}

	const billingProfile = await getBillingProfile(supabase, userId);
	if (billingProfile.stripeCustomerId) {
		return billingProfile.stripeCustomerId;
	}

	const stripe = createStripeClient();
	const customer = await stripe.customers.create({
		email: email ?? undefined,
		metadata: {
			supabase_user_id: userId
		}
	});

	const { error } = await supabase
		.from('user_profiles')
		.update({
			stripe_customer_id: customer.id,
			updated_at: new Date().toISOString()
		})
		.eq('user_id', userId);

	if (error) throw error;
	return customer.id;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const origin = url.origin;
	const user = locals.user ? { id: locals.user.id, email: locals.user.email ?? null } : null;
	const requestedWorkspaceId = url.searchParams.get('workspace');
	const billingResult = url.searchParams.get('checkout');
	const stripeConfig = getStripeConfig();

	try {
		const supabase = locals.supabase;
		if (!supabase) {
			return {
				origin,
				user,
				links: [] as MapLinkRecord[],
				planTier: 'free' as const,
				linkLimit: linkLimitForPlan('free'),
				personalLinkCount: 0,
				teamLinkLimit: linkLimitForPlan('team'),
				billingReady: stripeConfig.billingReady,
				billingSetupIncomplete: stripeConfig.checkoutReady && !stripeConfig.billingReady,
				billingPortalReady: false,
				billingSubscriptionStatus: null as string | null,
				billingResult,
				billingPrices: {
					proAmountCents: stripeConfig.plans.pro.amountCents,
					teamAmountCents: stripeConfig.plans.team.amountCents
				},
				workspaces: [] as Array<{ id: string; name: string; role: 'owner' | 'member' }>,
				activeWorkspaceId: null as string | null,
				activeWorkspaceName: null as string | null,
				activeWorkspaceLinkCount: 0,
				activeWorkspaceMembers: [] as WorkspaceMemberSummary[],
				activeWorkspaceInvites: [] as WorkspaceInviteSummary[],
				supabaseReady: false,
				loadError:
					'Supabase is not configured yet. Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY.'
			};
		}

		if (!user) {
			return {
				origin,
				user,
				links: [] as MapLinkRecord[],
				planTier: 'free' as const,
				linkLimit: linkLimitForPlan('free'),
				personalLinkCount: 0,
				teamLinkLimit: linkLimitForPlan('team'),
				billingReady: stripeConfig.billingReady,
				billingSetupIncomplete: stripeConfig.checkoutReady && !stripeConfig.billingReady,
				billingPortalReady: false,
				billingSubscriptionStatus: null as string | null,
				billingResult,
				billingPrices: {
					proAmountCents: stripeConfig.plans.pro.amountCents,
					teamAmountCents: stripeConfig.plans.team.amountCents
				},
				workspaces: [] as Array<{ id: string; name: string; role: 'owner' | 'member' }>,
				activeWorkspaceId: null as string | null,
				activeWorkspaceName: null as string | null,
				activeWorkspaceLinkCount: 0,
				activeWorkspaceMembers: [] as WorkspaceMemberSummary[],
				activeWorkspaceInvites: [] as WorkspaceInviteSummary[],
				supabaseReady: true,
				loadError: null as string | null
			};
		}

		const planTier = await ensureUserProfileAndPlan(supabase, user.id);
		const billingProfile = await getBillingProfile(supabase, user.id);
		const workspaces = await listUserWorkspaces(supabase, user.id);
		const activeWorkspaceId = resolveWorkspaceSelection(requestedWorkspaceId, workspaces);
		const activeWorkspaceName =
			activeWorkspaceId === null
				? null
				: workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.name ?? null;
		const activeWorkspaceRole =
			activeWorkspaceId === null
				? null
				: workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.role ?? null;
		const personalLinkCount = await countPersonalLinks(supabase, user.id);
		const activeWorkspaceLinkCount =
			activeWorkspaceId === null ? 0 : await countWorkspaceLinks(supabase, activeWorkspaceId);
		const activeWorkspaceMembers =
			activeWorkspaceId === null
				? []
				: await listWorkspaceMembers(supabase, user.id, activeWorkspaceId);
		const activeWorkspaceInvites =
			activeWorkspaceId === null || activeWorkspaceRole !== 'owner'
				? []
				: await listWorkspaceInvites(supabase, activeWorkspaceId);

		const linksQuery =
			activeWorkspaceId === null
				? supabase
						.from('links')
						.select('slug,name,address,notes,lat,lng,is_disabled,created_at')
						.eq('user_id', user.id)
						.is('workspace_id', null)
				: supabase
						.from('links')
						.select('slug,name,address,notes,lat,lng,is_disabled,created_at')
						.eq('workspace_id', activeWorkspaceId);

		const { data, error } = await linksQuery
			.order('created_at', { ascending: false })
			.limit(RECENT_LINK_LIMIT);

		if (error) {
			return {
				origin,
				user,
				links: [] as MapLinkRecord[],
				planTier,
				linkLimit: linkLimitForPlan(planTier),
				personalLinkCount,
				teamLinkLimit: linkLimitForPlan('team'),
				billingReady: stripeConfig.billingReady,
				billingSetupIncomplete: stripeConfig.checkoutReady && !stripeConfig.billingReady,
				billingPortalReady:
					stripeConfig.billingReady && billingProfile.stripeCustomerId !== null,
				billingSubscriptionStatus: billingProfile.stripeSubscriptionStatus,
				billingResult,
				billingPrices: {
					proAmountCents: stripeConfig.plans.pro.amountCents,
					teamAmountCents: stripeConfig.plans.team.amountCents
				},
				workspaces,
				activeWorkspaceId,
				activeWorkspaceName,
				activeWorkspaceLinkCount,
				activeWorkspaceMembers,
				activeWorkspaceInvites,
				supabaseReady: true,
				loadError: error.message
			};
		}

		return {
			origin,
			user,
			links: (data ?? []) as MapLinkRecord[],
			planTier,
			linkLimit: linkLimitForPlan(planTier),
			personalLinkCount,
			teamLinkLimit: linkLimitForPlan('team'),
			billingReady: stripeConfig.billingReady,
			billingSetupIncomplete: stripeConfig.checkoutReady && !stripeConfig.billingReady,
			billingPortalReady: stripeConfig.billingReady && billingProfile.stripeCustomerId !== null,
			billingSubscriptionStatus: billingProfile.stripeSubscriptionStatus,
			billingResult,
			billingPrices: {
				proAmountCents: stripeConfig.plans.pro.amountCents,
				teamAmountCents: stripeConfig.plans.team.amountCents
			},
			workspaces,
			activeWorkspaceId,
			activeWorkspaceName,
			activeWorkspaceLinkCount,
			activeWorkspaceMembers,
			activeWorkspaceInvites,
			supabaseReady: true,
			loadError: null as string | null
		};
	} catch (error) {
		console.error(error);
		return {
			origin,
			user,
			links: [] as MapLinkRecord[],
			planTier: 'free' as const,
			linkLimit: linkLimitForPlan('free'),
			personalLinkCount: 0,
			teamLinkLimit: linkLimitForPlan('team'),
			billingReady: stripeConfig.billingReady,
			billingSetupIncomplete: stripeConfig.checkoutReady && !stripeConfig.billingReady,
			billingPortalReady: false,
			billingSubscriptionStatus: null as string | null,
			billingResult,
			billingPrices: {
				proAmountCents: stripeConfig.plans.pro.amountCents,
				teamAmountCents: stripeConfig.plans.team.amountCents
			},
			workspaces: [] as Array<{ id: string; name: string; role: 'owner' | 'member' }>,
			activeWorkspaceId: null as string | null,
			activeWorkspaceName: null as string | null,
			activeWorkspaceLinkCount: 0,
			activeWorkspaceMembers: [] as WorkspaceMemberSummary[],
			activeWorkspaceInvites: [] as WorkspaceInviteSummary[],
			supabaseReady: false,
			loadError: 'Supabase is not configured correctly for account operations.'
		};
	}
};

export const actions: Actions = {
	startCheckout: async ({ request, locals, url }) => {
		if (!locals.user || !locals.supabase) {
			return fail(401, { teamError: 'Sign in to upgrade your plan.' });
		}

		const stripeConfig = getStripeConfig();
		if (!stripeConfig.billingReady) {
			return fail(500, {
				teamError: 'Stripe billing is not fully configured yet. Add the webhook secret before enabling checkout.'
			});
		}

		const formData = await request.formData();
		const requestedPlanTier = normalizePaidPlanTier(formData.get('planTier'));
		if (!requestedPlanTier) {
			return fail(400, { teamError: 'Select a valid paid plan.' });
		}

		const currentPlanTier = await ensureUserProfileAndPlan(locals.supabase, locals.user.id);
		if (currentPlanTier !== 'free') {
			return fail(400, {
				teamError: 'Use Manage billing to change or cancel an existing paid plan.'
			});
		}

		try {
			const stripe = createStripeClient();
			const customerId = await ensureStripeCustomer(
				locals.supabase,
				locals.user.id,
				locals.user.email ?? null
			);
			const plan = getStripePlanDefinition(requestedPlanTier);
			const session = await stripe.checkout.sessions.create({
				mode: 'subscription',
				customer: customerId,
				client_reference_id: locals.user.id,
				allow_promotion_codes: true,
				metadata: {
					supabase_user_id: locals.user.id,
					plan_tier: requestedPlanTier
				},
				line_items: [
					{
						price_data: {
							currency: 'usd',
							unit_amount: plan.amountCents,
							recurring: {
								interval: 'month'
							},
							product_data: {
								name: `NavQR ${plan.name}`,
								description: plan.description
							}
						},
						quantity: 1
					}
				],
				subscription_data: {
					metadata: {
						supabase_user_id: locals.user.id,
						plan_tier: requestedPlanTier
					}
				},
				success_url: `${url.origin}/account?checkout=success`,
				cancel_url: `${url.origin}/account?checkout=cancelled`
			});

			if (!session.url) {
				return fail(500, { teamError: 'Stripe checkout did not return a redirect URL.' });
			}

			throw redirect(303, session.url);
		} catch (error) {
			console.error(error);
			return fail(500, { teamError: 'Could not start checkout right now.' });
		}
	},
	manageBilling: async ({ locals, url }) => {
		if (!locals.user || !locals.supabase) {
			return fail(401, { teamError: 'Sign in to manage billing.' });
		}

		const stripeConfig = getStripeConfig();
		if (!stripeConfig.billingReady) {
			return fail(500, { teamError: 'Stripe billing is not fully configured yet.' });
		}

		const billingProfile = await getBillingProfile(locals.supabase, locals.user.id);
		if (!billingProfile.stripeCustomerId) {
			return fail(400, { teamError: 'No Stripe billing profile was found for this account yet.' });
		}

		try {
			const stripe = createStripeClient();
			const session = await stripe.billingPortal.sessions.create({
				customer: billingProfile.stripeCustomerId,
				return_url: `${url.origin}/account`
			});

			throw redirect(303, session.url);
		} catch (error) {
			console.error(error);
			return fail(500, { teamError: 'Could not open the billing portal right now.' });
		}
	},
	updateLink: async ({ request, locals }) => {
		const authFailure = requireSignedIn(locals);
		if (authFailure) return authFailure;

		const formData = await request.formData();
		const values = normalizeEditValues(formData);
		const validationError = validateEdit(values);
		if (validationError) {
			return fail(400, {
				manageError: validationError,
				activeSlug: values.slug,
				values
			});
		}

		const lat = parseCoordinate(values.lat, -90, 90);
		const lng = parseCoordinate(values.lng, -180, 180);

		const { data, error } = await locals.supabase!
			.from('links')
			.update({
				name: values.name,
				address: values.address,
				notes: values.notes.length > 0 ? values.notes : null,
				lat,
				lng
			})
			.eq('slug', values.slug)
			.select('slug')
			.maybeSingle();

		if (error) {
			console.error(error);
			return fail(500, {
				manageError: 'Could not update this link right now.',
				activeSlug: values.slug,
				values
			});
		}

		if (!data) {
			return fail(404, {
				manageError: 'Link not found in this workspace.',
				activeSlug: values.slug,
				values
			});
		}

		return {
			manageSuccess: 'Link updated.',
			activeSlug: values.slug,
			values
		};
	},
	toggleLink: async ({ request, locals }) => {
		const authFailure = requireSignedIn(locals);
		if (authFailure) return authFailure;

		const formData = await request.formData();
		const slug = normalizeSlug(formData.get('slug'));
		const disableRequested = String(formData.get('disable') ?? '').trim() === 'true';
		if (slug.length === 0) {
			return fail(400, { manageError: 'Missing link slug.', activeSlug: '', values: null });
		}

		const { data, error } = await locals.supabase!
			.from('links')
			.update({ is_disabled: disableRequested })
			.eq('slug', slug)
			.select('slug')
			.maybeSingle();

		if (error) {
			console.error(error);
			return fail(500, {
				manageError: 'Could not update link status right now.',
				activeSlug: '',
				values: null
			});
		}

		if (!data) {
			return fail(404, {
				manageError: 'Link not found in this workspace.',
				activeSlug: '',
				values: null
			});
		}

		return {
			manageSuccess: disableRequested ? 'Link disabled.' : 'Link enabled.',
			activeSlug: '',
			values: null
		};
	},
	deleteLink: async ({ request, locals }) => {
		const authFailure = requireSignedIn(locals);
		if (authFailure) return authFailure;

		const formData = await request.formData();
		const slug = normalizeSlug(formData.get('slug'));
		if (slug.length === 0) {
			return fail(400, { manageError: 'Missing link slug.', activeSlug: '', values: null });
		}

		const { data, error } = await locals.supabase!
			.from('links')
			.delete()
			.eq('slug', slug)
			.select('slug')
			.maybeSingle();

		if (error) {
			console.error(error);
			return fail(500, {
				manageError: 'Could not delete this link right now.',
				activeSlug: '',
				values: null
			});
		}

		if (!data) {
			return fail(404, {
				manageError: 'Link not found in this workspace.',
				activeSlug: '',
				values: null
			});
		}

		return {
			manageSuccess: 'Link deleted.',
			activeSlug: '',
			values: null
		};
	},
	createWorkspace: async ({ request, locals }) => {
		const authFailure = requireSignedInForTeam(locals);
		if (authFailure) return authFailure;

		const formData = await request.formData();
		const name = String(formData.get('workspaceName') ?? '').trim();

		if (name.length < 2) {
			return fail(400, { teamError: 'Workspace name must be at least 2 characters.' });
		}

		if (name.length > 80) {
			return fail(400, { teamError: 'Workspace name must be 80 characters or fewer.' });
		}

		const planTier = await ensureUserProfileAndPlan(locals.supabase!, locals.user!.id);
		if (planTier !== 'team') {
			return fail(403, {
				teamError: 'Team plan is required to create a workspace.'
			});
		}

		const { data, error } = await locals.supabase!
			.from('workspaces')
			.insert({
				name,
				owner_user_id: locals.user!.id
			})
			.select('id')
			.single();

		if (error) {
			console.error(error);
			return fail(500, { teamError: 'Could not create workspace right now.' });
		}

		const workspaceId = data.id;
		const { error: memberError } = await locals.supabase!.from('workspace_members').upsert(
			{
				workspace_id: workspaceId,
				user_id: locals.user!.id,
				role: 'owner'
			},
			{ onConflict: 'workspace_id,user_id' }
		);

		if (memberError) {
			console.error(memberError);
			return fail(500, { teamError: 'Workspace created, but owner membership could not be saved.' });
		}

		throw redirect(303, `/account?workspace=${encodeURIComponent(workspaceId)}`);
	},
	createInvite: async ({ request, locals }) => {
		const authFailure = requireSignedInForTeam(locals);
		if (authFailure) return authFailure;

		const formData = await request.formData();
		const workspaceId = normalizeWorkspaceId(formData.get('workspaceId'));
		if (workspaceId.length === 0) {
			return fail(400, { teamError: 'Missing workspace.' });
		}

		const role = await getWorkspaceRole(locals.supabase!, locals.user!.id, workspaceId);
		if (role !== 'owner') {
			return fail(403, { teamError: 'Only workspace owners can create invite codes.' });
		}

		try {
			await createInviteCode(locals.supabase, workspaceId, locals.user!.id);
		} catch (error) {
			console.error(error);
			return fail(500, { teamError: 'Could not create invite code right now.' });
		}

		throw redirect(303, `/account?workspace=${encodeURIComponent(workspaceId)}`);
	},
	joinWorkspace: async ({ request, locals }) => {
		const authFailure = requireSignedInForTeam(locals);
		if (authFailure) return authFailure;

		const formData = await request.formData();
		const code = normalizeInviteCode(formData.get('inviteCode'));
		if (code.length < 6) {
			return fail(400, { teamError: 'Enter a valid invite code.' });
		}

		let adminClient;
		try {
			adminClient = createSupabaseAdminClient();
		} catch (error) {
			console.error(error);
			return fail(500, { teamError: 'Team invites are not configured yet.' });
		}

		const { data: invite, error: inviteError } = await adminClient
			.from('workspace_invites')
			.select('id,workspace_id,expires_at,used_at')
			.eq('code', code)
			.maybeSingle();

		if (inviteError) {
			console.error(inviteError);
			return fail(500, { teamError: 'Could not validate this invite right now.' });
		}

		if (!invite) {
			return fail(404, { teamError: 'Invite code not found.' });
		}

		if (invite.used_at) {
			return fail(410, { teamError: 'That invite code has already been used.' });
		}

		const expiresAt = new Date(invite.expires_at);
		if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
			return fail(410, { teamError: 'That invite code has expired.' });
		}

		const workspaceId = String(invite.workspace_id ?? '').trim();
		if (workspaceId.length === 0) {
			return fail(400, { teamError: 'Invite is missing workspace information.' });
		}

		const { data: existingMember, error: existingMemberError } = await adminClient
			.from('workspace_members')
			.select('workspace_id')
			.eq('workspace_id', workspaceId)
			.eq('user_id', locals.user!.id)
			.maybeSingle();

		if (existingMemberError) {
			console.error(existingMemberError);
			return fail(500, { teamError: 'Could not join workspace right now.' });
		}

		if (!existingMember) {
			const { error: joinError } = await adminClient.from('workspace_members').insert({
				workspace_id: workspaceId,
				user_id: locals.user!.id,
				role: 'member'
			});

			if (joinError) {
				console.error(joinError);
				return fail(500, { teamError: 'Could not join workspace right now.' });
			}
		}

		const { error: consumeError } = await adminClient
			.from('workspace_invites')
			.update({
				used_at: new Date().toISOString(),
				used_by_user_id: locals.user!.id
			})
			.eq('id', invite.id);

		if (consumeError) {
			console.error(consumeError);
			return fail(500, { teamError: 'Joined workspace, but invite could not be finalized.' });
		}

		throw redirect(303, `/account?workspace=${encodeURIComponent(workspaceId)}`);
	},
	leaveWorkspace: async ({ request, locals }) => {
		const authFailure = requireSignedInForTeam(locals);
		if (authFailure) return authFailure;

		const formData = await request.formData();
		const workspaceId = normalizeWorkspaceId(formData.get('workspaceId'));
		if (workspaceId.length === 0) {
			return fail(400, { teamError: 'Missing workspace.' });
		}

		const role = await getWorkspaceRole(locals.supabase!, locals.user!.id, workspaceId);
		if (!role) {
			return fail(404, { teamError: 'Workspace membership not found.' });
		}

		if (role === 'owner') {
			return fail(400, {
				teamError: 'Workspace owners cannot leave. Transfer ownership or delete the workspace first.'
			});
		}

		const { error } = await locals.supabase!
			.from('workspace_members')
			.delete()
			.eq('workspace_id', workspaceId)
			.eq('user_id', locals.user!.id);

		if (error) {
			console.error(error);
			return fail(500, { teamError: 'Could not leave workspace right now.' });
		}

		throw redirect(303, '/account');
	},
	renameWorkspace: async ({ request, locals }) => {
		const authFailure = requireSignedInForTeam(locals);
		if (authFailure) return authFailure;

		const formData = await request.formData();
		const workspaceId = normalizeWorkspaceId(formData.get('workspaceId'));
		const name = String(formData.get('workspaceName') ?? '').trim();

		if (workspaceId.length === 0) {
			return fail(400, { teamError: 'Missing workspace.' });
		}

		if (name.length < 2 || name.length > 80) {
			return fail(400, { teamError: 'Workspace name must be between 2 and 80 characters.' });
		}

		const role = await getWorkspaceRole(locals.supabase!, locals.user!.id, workspaceId);
		if (role !== 'owner') {
			return fail(403, { teamError: 'Only workspace owners can rename a workspace.' });
		}

		const { error } = await locals.supabase!
			.from('workspaces')
			.update({ name })
			.eq('id', workspaceId);

		if (error) {
			console.error(error);
			return fail(500, { teamError: 'Could not rename this workspace right now.' });
		}

		throw redirect(303, `/account?workspace=${encodeURIComponent(workspaceId)}`);
	},
	revokeInvite: async ({ request, locals }) => {
		const authFailure = requireSignedInForTeam(locals);
		if (authFailure) return authFailure;

		const formData = await request.formData();
		const workspaceId = normalizeWorkspaceId(formData.get('workspaceId'));
		const inviteId = String(formData.get('inviteId') ?? '').trim();

		if (workspaceId.length === 0 || inviteId.length === 0) {
			return fail(400, { teamError: 'Missing invite information.' });
		}

		const role = await getWorkspaceRole(locals.supabase!, locals.user!.id, workspaceId);
		if (role !== 'owner') {
			return fail(403, { teamError: 'Only workspace owners can revoke invite codes.' });
		}

		const { error } = await locals.supabase!
			.from('workspace_invites')
			.delete()
			.eq('id', inviteId)
			.eq('workspace_id', workspaceId);

		if (error) {
			console.error(error);
			return fail(500, { teamError: 'Could not revoke this invite right now.' });
		}

		throw redirect(303, `/account?workspace=${encodeURIComponent(workspaceId)}`);
	},
	removeMember: async ({ request, locals }) => {
		const authFailure = requireSignedInForTeam(locals);
		if (authFailure) return authFailure;

		const formData = await request.formData();
		const workspaceId = normalizeWorkspaceId(formData.get('workspaceId'));
		const memberUserId = String(formData.get('memberUserId') ?? '').trim();

		if (workspaceId.length === 0 || memberUserId.length === 0) {
			return fail(400, { teamError: 'Missing member information.' });
		}

		if (memberUserId === locals.user!.id) {
			return fail(400, { teamError: 'Use Leave workspace to remove your own access.' });
		}

		const role = await getWorkspaceRole(locals.supabase!, locals.user!.id, workspaceId);
		if (role !== 'owner') {
			return fail(403, { teamError: 'Only workspace owners can remove members.' });
		}

		const { data: targetMembership, error: targetError } = await locals.supabase!
			.from('workspace_members')
			.select('role')
			.eq('workspace_id', workspaceId)
			.eq('user_id', memberUserId)
			.maybeSingle();

		if (targetError) {
			console.error(targetError);
			return fail(500, { teamError: 'Could not validate this workspace member right now.' });
		}

		if (!targetMembership) {
			return fail(404, { teamError: 'Workspace member not found.' });
		}

		if (targetMembership.role === 'owner') {
			return fail(400, { teamError: 'Owners cannot be removed from the workspace.' });
		}

		const { error } = await locals.supabase!
			.from('workspace_members')
			.delete()
			.eq('workspace_id', workspaceId)
			.eq('user_id', memberUserId);

		if (error) {
			console.error(error);
			return fail(500, { teamError: 'Could not remove this member right now.' });
		}

		throw redirect(303, `/account?workspace=${encodeURIComponent(workspaceId)}`);
	},
	deleteWorkspace: async ({ request, locals }) => {
		const authFailure = requireSignedInForTeam(locals);
		if (authFailure) return authFailure;

		const formData = await request.formData();
		const workspaceId = normalizeWorkspaceId(formData.get('workspaceId'));

		if (workspaceId.length === 0) {
			return fail(400, { teamError: 'Missing workspace.' });
		}

		const role = await getWorkspaceRole(locals.supabase!, locals.user!.id, workspaceId);
		if (role !== 'owner') {
			return fail(403, { teamError: 'Only workspace owners can delete a workspace.' });
		}

		const workspaceLinkCount = await countWorkspaceLinks(locals.supabase, workspaceId);
		if (workspaceLinkCount > 0) {
			return fail(400, {
				teamError: 'Remove shared links from this workspace before deleting it.'
			});
		}

		const { error } = await locals.supabase!.from('workspaces').delete().eq('id', workspaceId);
		if (error) {
			console.error(error);
			return fail(500, { teamError: 'Could not delete this workspace right now.' });
		}

		throw redirect(303, '/account');
	}
};
