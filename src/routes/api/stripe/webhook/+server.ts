import { createSupabaseAdminClient } from '$lib/server/supabase';
import {
	createStripeClient,
	derivePlanTierFromSubscription,
	getStripeConfig,
	type PaidPlanTier
} from '$lib/server/stripe';
import type { PlanTier } from '$lib/server/workspaces';
import type Stripe from 'stripe';

function asCustomerId(value: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
	if (typeof value === 'string') return value;
	if (value && typeof value.id === 'string') return value.id;
	return null;
}

function currentPeriodEndIso(subscription: Stripe.Subscription): string | null {
	const value = subscription.items.data[0]?.current_period_end;
	if (typeof value !== 'number') return null;
	return new Date(value * 1000).toISOString();
}

async function updateBillingProfile(params: {
	userId?: string | null;
	customerId?: string | null;
	planTier: PlanTier;
	subscriptionId: string | null;
	subscriptionStatus: string | null;
	priceId: string | null;
	currentPeriodEnd: string | null;
}) {
	const adminClient = createSupabaseAdminClient();
	const { userId, customerId, planTier, subscriptionId, subscriptionStatus, priceId, currentPeriodEnd } =
		params;

	const query =
		userId && userId.trim().length > 0
			? adminClient.from('user_profiles').update({
					plan_tier: planTier,
					stripe_customer_id: customerId ?? null,
					stripe_subscription_id: subscriptionId,
					stripe_subscription_status: subscriptionStatus,
					stripe_price_id: priceId,
					stripe_current_period_end: currentPeriodEnd,
					updated_at: new Date().toISOString()
				}).eq('user_id', userId)
			: adminClient.from('user_profiles').update({
					plan_tier: planTier,
					stripe_customer_id: customerId ?? null,
					stripe_subscription_id: subscriptionId,
					stripe_subscription_status: subscriptionStatus,
					stripe_price_id: priceId,
					stripe_current_period_end: currentPeriodEnd,
					updated_at: new Date().toISOString()
				}).eq('stripe_customer_id', customerId ?? '');

	const { error } = await query;
	if (error) throw error;
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
	if (session.mode !== 'subscription') return;

	const userId =
		typeof session.metadata?.supabase_user_id === 'string'
			? session.metadata.supabase_user_id
			: typeof session.client_reference_id === 'string'
				? session.client_reference_id
				: null;
	const customerId = asCustomerId(session.customer);
	const subscriptionId =
		typeof session.subscription === 'string'
			? session.subscription
			: session.subscription && typeof session.subscription.id === 'string'
				? session.subscription.id
				: null;
	const paidPlan =
		typeof session.metadata?.plan_tier === 'string'
			? (session.metadata.plan_tier as PaidPlanTier)
			: null;

	if (!userId && !customerId) return;

	await updateBillingProfile({
		userId,
		customerId,
		planTier: paidPlan === 'pro' || paidPlan === 'team' ? paidPlan : 'free',
		subscriptionId,
		subscriptionStatus: 'active',
		priceId: null,
		currentPeriodEnd: null
	});
}

async function handleSubscriptionChange(subscription: Stripe.Subscription) {
	const customerId = asCustomerId(subscription.customer);
	const userId =
		typeof subscription.metadata?.supabase_user_id === 'string'
			? subscription.metadata.supabase_user_id
			: null;
	const priceId =
		subscription.items.data[0]?.price && typeof subscription.items.data[0].price.id === 'string'
			? subscription.items.data[0].price.id
			: null;

	await updateBillingProfile({
		userId,
		customerId,
		planTier: derivePlanTierFromSubscription(subscription),
		subscriptionId: subscription.status === 'canceled' ? null : subscription.id,
		subscriptionStatus: subscription.status,
		priceId,
		currentPeriodEnd: subscription.status === 'canceled' ? null : currentPeriodEndIso(subscription)
	});
}

export const POST = async ({ request }) => {
	const stripeConfig = getStripeConfig();
	if (!stripeConfig.billingReady) {
		return new Response('Stripe billing is not configured.', { status: 500 });
	}

	const signature = request.headers.get('stripe-signature');
	if (!signature) {
		return new Response('Missing Stripe signature.', { status: 400 });
	}

	const rawBody = await request.text();
	const stripe = createStripeClient();

	let event: Stripe.Event;
	try {
		event = stripe.webhooks.constructEvent(rawBody, signature, stripeConfig.webhookSecret);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Invalid webhook signature.';
		return new Response(message, { status: 400 });
	}

	try {
		switch (event.type) {
			case 'checkout.session.completed':
				await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
				break;
			case 'customer.subscription.created':
			case 'customer.subscription.updated':
			case 'customer.subscription.deleted':
				await handleSubscriptionChange(event.data.object as Stripe.Subscription);
				break;
			default:
				break;
		}
	} catch (error) {
		console.error(error);
		return new Response('Webhook handler failed.', { status: 500 });
	}

	return new Response('ok');
};
