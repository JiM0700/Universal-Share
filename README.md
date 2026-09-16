# ⚡ Universal Share

> **100% Serverless, Zero-Knowledge, Browser-Based Cross-Platform P2P File Sharing**
> Built for iOS (Safari), Android (Chrome), macOS, and Desktop.

---

## 🌟 Highlights

- **Zero Cloud Servers**: File data travels directly device-to-device across your local Wi-Fi or Hotspot via WebRTC `RTCDataChannel` (SCTP over DTLS/UDP). No file payload or metadata is ever uploaded to any external server.
- **Air-Gapped QR Signaling**: No signaling server required. Devices pair by generating and scanning dynamic high-density QR codes directly using device cameras.
- **End-to-End Encrypted (E2EE)**:
  - Ephemeral **ECDH (P-256)** key agreement in browser memory.
  - **AES-GCM-256** authenticated encryption on every chunk.
  - **6-digit Short Authentication String (SAS)** and visual emoji verification to prevent Man-in-the-Middle (MITM) attacks.
  - **SHA-256** full-file digest verification for bit-for-bit integrity.
- **High Throughput & Backpressure**: Streams files in 64 KB chunks with active buffer flow control, allowing multi-gigabyte transfers without browser memory crashes.
- **Cross-Platform**: Works natively on **iOS Safari**, **Android Chrome**, **macOS**, Windows, and Linux.
- **Folder & Batch Transfers**: Supports sending entire directories with relative file paths preserved (`webkitdirectory`).
- **Offline PWA**: Service Worker pre-caches all code so the app can be opened without an active internet connection.
- **Native Web Share**: Directly integrates with iOS & Android native share sheets (`navigator.share`) to save received photos and videos directly into Camera Roll or Files.

---

## 🚀 Quick Start (Local Network)

### 1. Start the Local Server on Mac

Open your terminal in this directory and run:

```bash
# Standard HTTP (ideal for localhost / same machine testing)
python3 serve.py

# OR HTTPS (recommended for mobile phone Wi-Fi camera scanning)
python3 serve.py --https
```

The terminal will display your local network addresses:
- **Local Mac**: `http://localhost:8080` (or `https://localhost:8443`)
- **Phone / LAN**: `https://192.168.x.x:8443`

---

## 📲 How to Connect Two Devices

### Method A: Camera QR Scan (100% Serverless)
1. Open **Universal Share** on **Device A** (e.g. Mac).
2. Open **Universal Share** on **Device B** (e.g. iPhone or Android phone on the same Wi-Fi).
3. On **Device A**, tap **"Connect Device"**. A QR code containing the encrypted connection offer will appear.
4. On **Device B**, tap **"Connect Device"** -> **"Open Camera Scanner"** and scan the QR code on Device A's screen.
5. Device B will accept the offer and display an **Answer QR Code**.
6. On **Device A**, click **"Open Camera Scanner"** and scan Device B's Answer QR code.
7. The direct P2P link opens immediately! Both screens will display an identical **6-digit security code** and **emoji phrase**.

### Method B: Manual Code Copy/Paste (No Camera Needed)
If a device lacks a camera or camera permissions are denied:
1. On Device A, click **"Connect Device"** -> select the **"Manual Code"** tab.
2. Click **"Copy Code"** and paste it into Device B's **"Paste Peer Code"** box -> click **"Connect"**.
3. Copy the generated Answer code from Device B back into Device A.
4. Connection is established instantly!

---

## 🛡️ Security & Privacy Architecture

```
[Sender Device]                                [Receiver Device]
      │                                                │
      ├────── ECDH P-256 Ephemeral Key Generation ─────┤
      │                                                │
      ├─── Compute Shared Secret & Derive AES-256-GCM ─┤
      │                                                │
      ├─── Derive 6-Digit SAS Code (Visual Verify) ────┤
      │                                                │
      ├─── 64KB Chunk Slices ──────────────────────────┤
      │    • Encrypt with AES-GCM (12-byte IV)         │
      │    • Stream via WebRTC DataChannel (DTLS)      │
      │    • Manage SCTP Backpressure Buffer           │
      │                                                │
      └─── Compute & Verify SHA-256 Checksum ──────────┘
```

1. **DTLS Transport**: All WebRTC traffic is encrypted at the transport layer using DTLS.
2. **Application E2EE**: Chunks are individually encrypted with AES-256-GCM before transmission. Even an entity intercepting raw Wi-Fi frames cannot read file data.
3. **Zero-Server Guarantee**: The application contains no upload endpoints. Data is held in transient browser memory and streamed directly to disk.

---

## 📱 Hardware & Platform Compatibility Notes

| Operating System | Browser | WebRTC P2P | Camera QR Scanner | Bluetooth File Sharing |
|---|---|---|---|---|
| **iOS (iPhone/iPad)** | Safari / WebKit | ✅ Supported | ✅ Supported | ❌ Not supported in WebKit |
| **Android** | Chrome / Edge | ✅ Supported | ✅ Supported | ⚠️ Central only (No Peripheral) |
| **macOS** | Safari / Chrome | ✅ Supported | ✅ Supported | ⚠️ Central only |
| **Windows / Linux**| Chrome / Firefox | ✅ Supported | ✅ Supported | ⚠️ Central only |

> [!NOTE]
> **Why Wi-Fi instead of Web Bluetooth on iOS?**
> Apple's WebKit team has explicitly refused to implement Web Bluetooth in iOS Safari for security and privacy reasons. Furthermore, standard Web Bluetooth in Chrome only operates as a GATT *client* (Central) and cannot advertise files as a *peripheral*.
> WebRTC over local Wi-Fi / Hotspot solves this cleanly: it is universally supported across all browsers and delivers speeds **100x faster than Bluetooth** (100–500 Mbps vs ~1 Mbps).

---

## 📁 File Structure

```
Universal Share/
├── index.html            # Main responsive web application
├── manifest.json         # PWA Manifest for Add to Home Screen
├── sw.js                 # Service worker for 100% offline caching
├── serve.py              # Local LAN server with auto-IP and HTTPS
├── css/
│   └── styles.css        # Responsive dark/light theme & glassmorphic UI
├── js/
│   ├── app.js            # Master application state coordinator
│   ├── crypto.js         # Web Crypto: ECDH P-256, AES-GCM-256, SHA-256, SAS
│   ├── sdp-compress.js   # SDP minification, Deflate compression & Base64
│   ├── qr-codec.js       # Standalone QR generator & camera scanner
│   ├── webrtc.js         # WebRTC DataChannel engine with backpressure
│   ├── file-streamer.js  # 64KB chunk streaming, ETA calculation, file assembler
│   └── ui.js             # UI controls, drag & drop, radar animation, toasts
└── icons/
    └── icon.svg          # Vector application icon
```
