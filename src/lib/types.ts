export interface MapLinkRecord {
	slug: string;
	name: string;
	address: string;
	notes: string | null;
	lat: number | null;
	lng: number | null;
	is_disabled: boolean;
	created_at: string;
}
