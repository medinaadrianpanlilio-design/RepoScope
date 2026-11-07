-- The server writes shared data with the secret key, which acts as service_role.
-- Stated explicitly so it doesn't depend on a project's default privileges.

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
