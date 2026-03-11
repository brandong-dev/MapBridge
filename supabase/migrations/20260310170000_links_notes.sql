alter table public.links
add column if not exists notes text;

do $$
begin
	if not exists (
		select 1
		from pg_constraint
		where conname = 'links_notes_length_check'
	) then
		alter table public.links
		add constraint links_notes_length_check
		check (notes is null or char_length(notes) <= 500);
	end if;
end
$$;
