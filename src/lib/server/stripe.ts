import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import Stripe from 'stripe';
import type { PlanTier } from '$lib/server/workspaces';

export type PaidPlanTier = Exclude<PlanTier, 'free'>;

export type StripePlanDefinition = {
	tier: PaidPlanTier;
	name: string;
	description: string;
	amountCents: number;
};

const DEFAULT_PRO_MONTHLY_AMOUNT = 1200;
const DEFAULT_TEAM_MONTHLY_AMOUNT = 3900;

function normalizeEnv(value: string | undefined): string {
	return value?.trim() ?? '';
}

function parseAmount(value: string | undefined, fallback: number): number {
	const parsed = Number.parseInt(value?.trim() ?? '', 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return parsed;
}

export function normalizePaidPlanTier(value: unknown): PaidPlanTier | null {
	return value === 'pro' || value === 'team' ? value : null;
}

export function getStripeConfig() {
	const publishableKey = normalizeEnv(publicEnv.PUBLIC_STRIPE_PUBLISHABLE_KEY);
	const secretKey = normalizeEnv(privateEnv.STRIPE_SECRET_KEY);
	const webhookSecret = normalizeEnv(privateEnv.STRIPE_WEBHOOK_SECRET);
	const proMonthlyAmount = parseAmount(privateEnv.STRIPE_PRO_MONTHLY_AMOUNT, DEFAULT_PRO_MONTHLY_AMOUNT);
	const teamMonthlyAmount = parseAmount(
		privateEnv.STRIPE_TEAM_MONTHLY_AMOUNT,
		DEFAULT_TEAM_MONTHLY_AMOUNT
	);

	return {
		publishableKey,
		secretKey,
		webhookSecret,
		checkoutReady: secretKey.length > 0,
		billingReady: secretKey.length > 0 && webhookSecret.length > 0,
		plans: {
			pro: {
				tier: 'pro',
				name: 'Pro',
				description: 'Expanded private destination library for individual professionals.',
				amountCents: proMonthlyAmount
			} satisfies StripePlanDefinition,
			team: {
				tier: 'team',
				name: 'Team',
				description: 'Shared workspace access and higher link capacity for teams.',
				amountCents: teamMonthlyAmount
			} satisfies StripePlanDefinition
		}
	};
}

export function getStripePlanDefinition(tier: PaidPlanTier): StripePlanDefinition {
	return getStripeConfig().plans[tier];
}

export function createStripeClient(): Stripe {
	const { secretKey } = getStripeConfig();
	if (secretKey.length === 0) {
		throw new Error('Missing STRIPE_SECRET_KEY');
	}

	return new Stripe(secretKey, {
		maxNetworkRetries: 2
	});
}

export function derivePlanTierFromSubscription(subscription: Stripe.Subscription): PlanTier {
	const paidTier = normalizePaidPlanTier(subscription.metadata?.plan_tier);
	if (!paidTier) return 'free';

	switch (subscription.status) {
		case 'active':
		case 'trialing':
		case 'past_due':
			return paidTier;
		default:
			return 'free';
	}
}
