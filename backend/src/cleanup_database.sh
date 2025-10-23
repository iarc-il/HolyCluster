#!/bin/zsh
cd /opt/HolyCluster/
source /opt/HolyCluster/.venv/bin/activate
/opt/HolyCluster/.venv/bin/python3 /opt/HolyCluster/backend/src/cleanup_database.py 
