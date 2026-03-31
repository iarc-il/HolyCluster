# HolyCluster - Field Day Computer Setup Guide

Follow these steps **in order**. Each step must be completed before moving to the next.

---

## What you need before you start

- The field day computer (Windows, with OmniRig already installed)
- Internet connection

---

## Step 1 — Install Git

Git is needed to download the HolyCluster code.

1. Go to **git-scm.com** and download Git for Windows
2. Run the installer — click Next on everything, no changes needed
3. When done, open Command Prompt and type `git --version` — you should see a version number

---

## Step 2 — Install Node.js

Node.js is needed to run the frontend.

1. Go to **nodejs.org** and download the **LTS** version for Windows
2. Run the installer — click Next on everything, no changes needed
3. When done, open Command Prompt and type `node --version` — you should see a version number

---

## Step 3 — Install Docker Desktop

Docker runs the database and collector.

1. Go to **docker.com** and download **Docker Desktop for Windows (AMD64)**
2. Run the installer
3. When it asks about WSL, say Yes to everything
4. Restart the computer when asked

---

## Step 4 — Install WSL and Ubuntu

WSL is required by Docker.

1. After restarting, open **Command Prompt as Administrator**
   - Click Start, type `cmd`, right-click on Command Prompt, choose "Run as administrator"
2. Type this command and press Enter:
   ```
   wsl --install -d Ubuntu
   ```
3. Wait for it to finish — it will ask you to create a username and password for Ubuntu
   - Pick anything simple (you won't need these again)
4. Close the Ubuntu window when done
5. Restart the computer

---

## Step 5 — Install the HolyCluster CAT Server

The CAT server connects HolyCluster to your radio via OmniRig.

1. Go to **holycluster.iarc.org** and download the HolyCluster installer (MSI file)
2. Run the installer — click Next on everything
3. After installation, you should see a HolyCluster icon appear in your system tray (bottom-right near the clock)

---

## Step 6 — Download the HolyCluster code

1. Open Command Prompt (regular, not administrator)
2. Type these commands one at a time:
   ```
   d:
   mkdir holyclusterD
   cd holyclusterD
   git clone https://github.com/iarc-il/HolyCluster.git
   cd HolyCluster
   git checkout Dani
   ```

---

## Step 7 — Install the frontend packages

1. In the same Command Prompt, type:
   ```
   cd ui
   npm install
   cd ..
   ```
2. Wait for it to finish (may take a few minutes)

---

## Step 8 — Build the frontend

1. In the same Command Prompt, type:
   ```
   cd ui
   npm run build
   ```
2. Wait for it to finish
3. Now copy the built files to where Docker expects them:
   ```
   wsl mkdir -p /tmp/ui
   wsl cp -r /mnt/d/holyclusterD/HolyCluster/ui/dist/. /tmp/ui/
   ```

---

## Step 9 — Copy the settings file

The settings file contains the project credentials shared by the whole team.
Get it from a team member via USB drive, WhatsApp, or any file sharing method.

**Important: this file is intentionally NOT included in Git because the repository is public on GitHub. Never upload it to GitHub.**

1. Get the `.env` file from a team member
2. Open Windows Explorer and go to:
   ```
   D:\holyclusterD\HolyCluster\backend\
   ```
3. Paste the `.env` file into that folder

   **Note:** The file may not be visible by default because its name starts with a dot.
   To show it: in Windows Explorer click **View** → check **Hidden items**

---

## Step 10 — Start HolyCluster

1. Make sure **Docker Desktop is open** and shows a green "Running" indicator in the taskbar
   - If it's not open, find it in the Start menu and launch it, then wait for it to turn green before continuing

2. Open Windows Explorer and go to:
   ```
   D:\holyclusterD\HolyCluster\
   ```
3. You will see a file called **start.bat** — double-click it

4. **The first time only:** Docker needs to build the services, which takes 5–10 minutes. You will see a lot of text scrolling. This is normal — wait until it stops.

5. Wait about 30 seconds after the build finishes

6. The browser will open **twice** — this is normal:
   - One tab opens the **released version** of HolyCluster (opened automatically by the CAT server) — **close this tab**
   - The other tab opens at `http://localhost:5173` — **this is your version, keep this one**

You should see spots on the map and the radio frequency displayed.

---

## Notes

- The database starts empty on a new computer — history builds up as time goes by
- Every time you want to use HolyCluster, always double-click `start.bat` — even if you just closed the browser and want to reopen it. This ensures the CAT server and all services are running properly
- Docker Desktop must be open and showing a green "Running" indicator before you run start.bat (it may need to be launched manually from the Start menu)
- You need an internet connection for spots to appear

---

## If something goes wrong

- Make sure Docker Desktop is open and shows a green "Running" indicator
- Make sure OmniRig is configured and working
- Make sure the released HolyCluster app started (check system tray for its icon)
- Try restarting the computer and running `start.bat` again
