import type { SupabaseClient } from '@supabase/supabase-js';

export type PlanTier = 'free' | 'pro' | 'team';
export type WorkspaceRole = 'owner' | 'member';

export type WorkspaceMembership = {
	id: string;
	name: string;
	role: WorkspaceRole;
	ownerUserId: string;
};

const PLAN_LINK_LIMITS: Record<PlanTier, number> = {
	free: 100,
	pro: 2000,
	team: 10000
};

function normalizePlanTier(value: unknown): PlanTier {
	if (value === 'pro' || value === 'team') return value;
	return 'free';
}

export function linkLimitForPlan(planTier: PlanTier): number {
	return PLAN_LINK_LIMITS[planTier];
}

export async function ensureUserProfileAndPlan(
	supabase: SupabaseClient,
	userId: string
): Promise<PlanTier> {
	const { data, error } = await supabase
		.from('user_profiles')
		.select('plan_tier')
		.eq('user_id', userId)
		.maybeSingle();

	if (error) {
		throw error;
	}

	if (data) {
		return normalizePlanTier(data.plan_tier);
	}

	const { data: inserted, error: insertError } = await supabase
		.from('user_profiles')
		.insert({ user_id: userId })
		.select('plan_tier')
		.single();

	if (insertError) {
		if (insertError.code === '23505') {
			const { data: fallback, error: fallbackError } = await supabase
				.from('user_profiles')
				.select('plan_tier')
				.eq('user_id', userId)
				.maybeSingle();

			if (fallbackError) throw fallbackError;
			return normalizePlanTier(fallback?.plan_tier);
		}
		throw insertError;
	}

	return normalizePlanTier(inserted.plan_tier);
}

export async function listUserWorkspaces(
	supabase: SupabaseClient,
	userId: string
): Promise<WorkspaceMembership[]> {
	const { data: memberships, error: membershipError } = await supabase
		.from('workspace_members')
		.select('workspace_id,role')
		.eq('user_id', userId);

	if (membershipError) {
		throw membershipError;
	}

	const rows = memberships ?? [];
	if (rows.length === 0) return [];

	const workspaceIds = rows
		.map((row) => (typeof row.workspace_id === 'string' ? row.workspace_id : ''))
		.filter((value) => value.length > 0);

	if (workspaceIds.length === 0) return [];

	const { data: workspaces, error: workspaceError } = await supabase
		.from('workspaces')
		.select('id,name,owner_user_id')
		.in('id', workspaceIds);

	if (workspaceError) {
		throw workspaceError;
	}

	const byId = new Map<string, { id: string; name: string; owner_user_id: string }>();
	for (const workspace of workspaces ?? []) {
		if (typeof workspace.id !== 'string' || workspace.id.length === 0) continue;
		byId.set(workspace.id, {
			id: workspace.id,
			name: typeof workspace.name === 'string' ? workspace.name : 'Workspace',
			owner_user_id: typeof workspace.owner_user_id === 'string' ? workspace.owner_user_id : ''
		});
	}

	const merged: WorkspaceMembership[] = [];
	for (const membership of rows) {
		const workspaceId =
			typeof membership.workspace_id === 'string' ? membership.workspace_id : '';
		if (workspaceId.length === 0) continue;

		const workspace = byId.get(workspaceId);
		if (!workspace) continue;

		merged.push({
			id: workspace.id,
			name: workspace.name,
			role: membership.role === 'owner' ? 'owner' : 'member',
			ownerUserId: workspace.owner_user_id
		});
	}

	merged.sort((a, b) => a.name.localeCompare(b.name));
	return merged;
}

export async function getWorkspaceRole(
	supabase: SupabaseClient,
	userId: string,
	workspaceId: string
): Promise<WorkspaceRole | null> {
	const trimmedWorkspaceId = workspaceId.trim();
	if (trimmedWorkspaceId.length === 0) return null;

	const { data, error } = await supabase
		.from('workspace_members')
		.select('role')
		.eq('workspace_id', trimmedWorkspaceId)
		.eq('user_id', userId)
		.maybeSingle();

	if (error) {
		throw error;
	}

	if (!data) return null;
	return data.role === 'owner' ? 'owner' : 'member';
}

export function resolveWorkspaceSelection(
	requestedWorkspaceId: string | null | undefined,
	workspaces: WorkspaceMembership[]
): string | null {
	const requested = requestedWorkspaceId?.trim() ?? '';
	if (requested.length === 0) return null;
	return workspaces.some((workspace) => workspace.id === requested) ? requested : null;
}
