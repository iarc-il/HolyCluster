#!/bin/bash
set -e

# Load environment variables
export $(grep -v '^#' .env | xargs)

echo "🚀 Starting HolyCluster first-time setup for domain ${DOMAIN}"

# Step 1: Create necessary directories
mkdir -p certbot/conf/live/${DOMAIN}
mkdir -p certbot/www

# Step 2: Generate temporary self-signed certificate for NGINX
echo "🔑 Generating temporary self-signed certificate..."
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout certbot/conf/live/${DOMAIN}/privkey.pem \
  -out certbot/conf/live/${DOMAIN}/fullchain.pem \
  -subj "/CN=${DOMAIN}"

# Step 3: Build and start all containers (Nginx will start with self-signed cert)
echo "🛠 Building Docker containers..."
docker compose up -d --build

echo "✅ Containers started with temporary self-signed certificate."

# Wait a few seconds for NGINX and app-test to be up
sleep 5

# Step 4: Removing temporary self-signed certificate for NGINX
echo "🔑 Removing temporary self-signed certificate..."
rm certbot/conf/live/${DOMAIN}/*.pem

# Step 5: Issue a certificate using Certbot webroot
echo "🌐 Issuing Let's Encrypt certificate..."
docker exec -it certbot certbot certonly --webroot \
  --webroot-path=/var/www/certbot \
  -d ${DOMAIN} \
  --email ${EMAIL} \
  --agree-tos \
  --no-eff-email

# Step 6: Reload NGINX to use the new staging certificate
echo "🔄 Reloading NGINX with staging certificate..."
docker compose exec nginx nginx -s reload

echo "✅ NGINX reloaded with staging certificate."

echo "🎉 First-time setup complete! Verify your site at https://${DOMAIN}"

echo "⚠️ Once verified, re-run the Certbot command without --staging to get a real certificate:"
echo "docker compose run --rm certbot certonly --webroot --webroot-path=/var/www/certbot -d ${DOMAIN} --email ${EMAIL} --agree-tos --no-eff-email"
