#!/bin/bash
set -e

if [ ! -f .env ]; then
    echo "Error: .env file not found"
    exit 1
fi

# Load environment variables
export $(grep -v '^#' .env | xargs)

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
    echo "Error: DOMAIN and EMAIL must be set in .env"
    exit 1
fi

echo "Starting HolyCluster first-time setup for domain ${DOMAIN}"

mkdir -p infra/certbot/conf/live/${DOMAIN}
mkdir -p infra/certbot/www

echo "Generating temporary self-signed certificate..."
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout ./infra/certbot/conf/live/${DOMAIN}/privkey.pem \
  -out ./infra/certbot/conf/live/${DOMAIN}/fullchain.pem \
  -subj "/CN=${DOMAIN}"

echo "Building Docker containers..."
docker compose up -d --build

echo "Containers started with temporary self-signed certificate."

# Wait a few seconds for NGINX and app-test to be up
sleep 5

echo "Removing temporary self-signed certificate..."
rm infra/certbot/conf/live/${DOMAIN}/*.pem

echo "Issuing Let's Encrypt certificate..."
docker exec -it certbot certbot certonly --webroot \
  --webroot-path=/var/www/certbot \
  -d ${DOMAIN} \
  --email ${EMAIL} \
  --agree-tos \
  --no-eff-email

echo "Reloading NGINX with staging certificate..."
docker compose exec nginx nginx -s reload

echo "NGINX reloaded with Let's Encrypt certificate."
echo "First-time setup complete! Verify your site at https://${DOMAIN}"
