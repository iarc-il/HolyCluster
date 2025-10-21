# Introduction
Sometimes there are missing spots because we fails to obtains certain data or there are errors when processing them.
There is a simple procedure to fix the missing spots, especially if it is because unidentified prefix

# Steps
1. Login into the server: `ssh root@holycluster.iarc.org`
2. Use postgres user: `sudo -i -u postgres`
3. Enter psql console: `psql`
4. Connect to the holy cluster database: `\c holy_cluster`
5. Execute the following query: `SELECT DISTINCT dx_callsign FROM spots_with_issues WHERE date >= CURRENT_DATE AND comment LIKE '%dx_country%';`
   This shows the spots that where dropped today due to unknown prefix.
6. After collecting the relevant callsigns, Update the file `backend/src/prefixes_list.csv`
7. It might be needed to clear the geo cache: `TRUNCATE TABLE geo_cache;`
8. Restart the server and verify the spot is now displayed with the correct flag
