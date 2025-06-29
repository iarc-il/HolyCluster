# HolyCluster-server
The server side implementation of HolyCluster

# Prerequisites
1. Install PostgreSQL https://www.postgresql.org/ 
2. Create /src/.env file with the database credentials (use /src/env.example as template)

# Create database
initiliaze_database.py: 
1. Delete exisitng "holy_cluster" database
2. Create "holy_cluster" database
3. Create tables

# Crontab
0-59 * * * * /opt/HolyCluster-server/src/run_collector.sh  
1 0 * * * /opt/HolyCluster-server/src/cleanup_database.sh  

# .sh files
chmod +x /opt/HolyCluster-server/src/run_collector.sh  
chmod +x /opt/HolyCluster-server/src/cleanup_database.sh  
