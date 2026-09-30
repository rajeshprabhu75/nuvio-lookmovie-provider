# LookMovie2 Scraper for Nuvio

A high-performance, Promise-based provider plugin for [Nuvio](https://github.com/NuvioMedia/NuvioDesktop) (supporting Nuvio Desktop, NuvioTV, and NuvioMobile) that scrapes movies and TV shows from LookMovie2.

---

## ✨ Features

- **Movies & TV Series:** Full playback support for both movies and multi-season TV shows.
- **Multiple Qualities:** Streams available in 1080p (Full HD), 720p (HD), 480p (SD), and Auto.
- **Subtitles:** Automatic discovery and loading of multi-language subtitles (.vtt format).
- **Settings Dialog (`onSettings`):**
  - Custom domain / mirror entry to bypass regional ISP or DNS blocks.
  - Optional LookMovie user account login (email and password) to unlock 1080p and VIP stream tiers.
  - Quality preference selector.
- **Full Sandbox Compatibility:** Built with pure Promise chains (`.then()` / `.catch()`) compatible with QuickJS, React Native Hermes, and Android/iOS V8 engines without requiring compilation or node modules.

---

## 📁 Repository Structure

```text
nuvio-lookmovie2-plugin/
├── manifest.json            # Nuvio scraper manifest
├── providers/
│   └── lookmovie2.js        # Core provider implementation
├── test_mock_pipeline.js    # Unit test suite verifying parsing & extraction
├── test_lookmovie2.js       # Live integration test runner
└── README.md                # Documentation and installation guide
```

---

## 🚀 How to Publish & Install in Nuvio

Nuvio downloads and executes plugins directly from public Git repositories via raw GitHub URLs.

### Step 1: Create a GitHub Repository

1. Go to [GitHub](https://github.com/new) and create a new **public** repository (e.g. `nuvio-lookmovie-provider`).
2. Do **not** initialize with README or license.

### Step 2: Push the Files

Open PowerShell or Terminal in the `nuvio-lookmovie2-plugin` directory:

```bash
cd nuvio-lookmovie2-plugin
git init
git add .
git commit -m "feat: LookMovie2 scraper for Nuvio"
git branch -M main
git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/nuvio-lookmovie-provider.git
git push -u origin main
```

### Step 3: Add to Nuvio

1. Open **Nuvio Desktop**, **NuvioTV**, or **Nuvio Mobile**.
2. Go to **Settings** (`⚙`) → **Plugins** (or **Local Scrapers**).
3. Click **Add Repository URL** (or paste URL):
   ```text
   https://raw.githubusercontent.com/<YOUR_GITHUB_USERNAME>/nuvio-lookmovie-provider/main/manifest.json
   ```
4. Click **Install / Add**.
5. Enable the **LookMovie2** provider toggle.

---

## ⚙ Configuration & Settings

Click on the **gear / settings icon** next to **LookMovie2** in Nuvio to configure:

| Setting | Description | Default |
| :--- | :--- | :--- |
| **LookMovie Domain** | The base LookMovie domain or mirror (e.g. `https://lookmovie2.la`, `https://lookmovie2.to`, or a proxy) | `https://lookmovie2.la` |
| **Account Email** | Optional LookMovie login email (needed to access 1080p FHD streams) | *Empty* |
| **Account Password** | Optional LookMovie password | *Empty* |
| **Quality Selection** | Preferred stream quality or "All" | `All` |

---

## 🛡 ISP & Regional Blocking Note

In several countries (e.g. India, UK, Australia), ISPs block pirate domains like `lookmovie2.la` at the DNS or TLS SNI level:
- If streams fail to fetch, enable a **VPN** (e.g., ProtonVPN, Mullvad, WireGuard) on your device.
- Alternatively, enter an active mirror or reverse-proxy URL in the plugin settings.

---

## 🧪 Testing Locally

You can run the mock unit tests or live integration tests using Node.js:

```bash
# Run unit tests (verifies storage regexes, parsing, and stream formatting):
node test_mock_pipeline.js

# Run live integration test against TMDB:
node test_lookmovie2.js
```
