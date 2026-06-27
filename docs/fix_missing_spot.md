# Introduction
Sometimes spots are missing because the backend cannot resolve geodata for a callsign.

# Steps
1. Login into the server: `ssh root@holycluster.iarc.org`
2. Use postgres user: `sudo -i -u postgres`
3. Enter psql console: `psql`
4. Connect to the holy cluster database: `\c holy_cluster`
5. Find recently dropped callsigns: `SELECT DISTINCT dx_callsign FROM spots_with_issues WHERE date >= CURRENT_DATE AND comment LIKE '%dx_country%';`
6. Check whether the callsign is missing from CTY resolution with `backend/query_geo.py`.
7. If CTY is missing or stale, add a targeted exact callsign override in `backend/shared/src/shared/geo.py`.
8. Avoid broad prefix overrides unless there is strong evidence that all matching callsigns share the same DXCC entity.
9. It might be needed to clear the geo cache: `TRUNCATE TABLE geo_cache;`
10. Restart the server and verify the spot is now displayed with the correct flag.
