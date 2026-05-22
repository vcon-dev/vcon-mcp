alter table analysis alter column created_at set default now();
update analysis set created_at = now() where created_at is null;
