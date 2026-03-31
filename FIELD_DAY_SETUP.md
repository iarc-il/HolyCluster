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
5. After restarting, open Docker Desktop and enable automatic startup:
   - Click the **gear icon** (Settings) in the top right
   - Check **"Start Docker Desktop when you sign in to your computer"**
   - Click **Apply & restart**

   This is mandatory — without this, the database collector will stop every time the computer restarts.

---

## Step 4 — Install WSL and Ubuntu

WSL is required by Docker.

1. After restarting, open **Command Prompt as Administrator**
   - Click Start, type `cmd`, right-click on Command Prompt, choose "Run as administrator"
2. Type this command and press Enter:
   ```
   wsl --install -d Ubuntu
   ```
3. Wait for it to finish — it will ask you to create a username and password for Ubuntu:
   - When you see `Enter new UNIX username:` — type anything simple (e.g. `user`) and press Enter
   - When you see `New password:` — type anything and press Enter
   - When you see `Retype new password:` — type the same thing and press Enter
   - When you see a prompt like `user@computer:~$` — it is done
4. Close the Ubuntu window
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

## Step 8 — Copy the settings file

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

## Step 9 — Start HolyCluster

1. Open Windows Explorer and go to:
   ```
   D:\holyclusterD\HolyCluster\
   ```
2. You will see a file called **start.bat** — double-click it
3. Wait about 30 seconds
4. The browser will open **twice** — this is normal:
   - One tab opens the **released version** of HolyCluster (opened automatically by the CAT server) — **close this tab**
   - The other tab opens at `http://localhost:5173` — **this is your version, keep this one**

You should see spots on the map and the radio frequency displayed.

---

## Notes

- The database starts empty on a new computer — history builds up as time goes by
- Every time you want to use HolyCluster, always double-click `start.bat` — even if you just closed the browser and want to reopen it. This ensures the CAT server and all services are running properly
- Docker must be running (it starts automatically with Windows after first setup)
- You need an internet connection for spots to appear

---

## If something goes wrong

- Make sure Docker Desktop is open and shows a green "Running" indicator
- Make sure OmniRig is configured and working
- Make sure the released HolyCluster app started (check system tray for its icon)
- Try restarting the computer and running `start.bat` again
