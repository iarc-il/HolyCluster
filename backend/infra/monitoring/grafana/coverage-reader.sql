\getenv reader GRAFANA_POSTGRES_USER
\getenv reader_password GRAFANA_POSTGRES_PASSWORD

BEGIN;

SELECT length(:'reader') BETWEEN 1 AND 63
    AND :'reader' <> current_user AS valid_reader \gset
\if :valid_reader
\else
    DO $$ BEGIN
        RAISE EXCEPTION 'Use a dedicated Grafana login with at most 63 characters.';
    END $$;
\endif

-- Do not convert an existing owner or role member into a dashboard login.
SELECT EXISTS (
    SELECT 1 FROM pg_roles r
    WHERE r.rolname = :'reader'
      AND (
          EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid)
          OR EXISTS (
              SELECT 1 FROM pg_shdepend d
              WHERE d.refclassid = 'pg_authid'::regclass
                AND d.refobjid = r.oid AND d.deptype = 'o'
          )
      )
) AS unsafe_reader \gset
\if :unsafe_reader
    DO $$ BEGIN
        RAISE EXCEPTION 'The Grafana login must not own objects or have role memberships.';
    END $$;
\endif

SELECT format('CREATE ROLE %I', :'reader')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'reader') \gexec

SELECT format(
    'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L',
    :'reader', :'reader_password'
) \gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'reader') \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'reader') \gexec
-- Table grants also cover future rows and columns. Schema-wide default grants
-- would expose unrelated application tables. Run this again after table recreation.
SELECT format('GRANT SELECT ON TABLE public.spot_coverage_samples TO %I', :'reader') \gexec

COMMIT;
