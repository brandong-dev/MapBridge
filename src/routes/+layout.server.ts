import {
	listUserWorkspaces,
	resolveWorkspaceSelection,
	type WorkspaceMembership
} from '$lib/server/workspaces';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	const requestedWorkspaceId = url.searchParams.get('workspace');
	let workspaces: WorkspaceMembership[] = [];
	let activeWorkspaceId: string | null = null;

	if (locals.user && locals.supabase) {
		try {
			workspaces = await listUserWorkspaces(locals.supabase, locals.user.id);
			activeWorkspaceId = resolveWorkspaceSelection(requestedWorkspaceId, workspaces);
		} catch (error) {
			console.error(error);
			workspaces = [];
			activeWorkspaceId = null;
		}
	}

	return {
		user: locals.user ? { id: locals.user.id, email: locals.user.email ?? null } : null,
		pathname: url.pathname,
		workspaces,
		activeWorkspaceId
	};
};
