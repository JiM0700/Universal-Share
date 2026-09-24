# Localdrop

Localdrop sends files directly between two browsers on the same Wi‑Fi or hotspot. The transfer itself does not need internet access. It works in current Safari, Chrome, Edge, and Firefox on iOS, Android, macOS, Windows, and Linux. No account or file-upload service is involved.

## Recommended offline setup

For repeat use, open Localdrop on both devices once from a trusted HTTPS address while you have internet, then install it or let the app finish loading so its offline cache is ready. When you want to share without internet:

1. Turn on the personal hotspot on one device and connect the other device to it.
2. Open Localdrop on both devices.
3. On one device, choose **Start pairing**. On the other, choose **Scan a code** and scan it. You can exchange codes manually if scanning is unavailable.
4. Compare the verification code and icons on both screens. Continue only if they match.
5. Choose files to send and save them on the receiving device.

For first use without internet, serve the app from a computer joined to that hotspot. Run `python3 serve.py --https` in this folder and open the printed HTTPS address on both devices. The development certificate is self-signed; some mobile browsers require extra steps or may refuse it. The app needs to be loaded on each device before the computer can be disconnected.

The hotspot must allow connected devices to communicate with each other. Some phone models or network settings isolate clients; if pairing never connects, try the other device as the hotspot or use a normal private Wi‑Fi network. Browser pages cannot reliably discover nearby devices, so pairing uses a QR code or copied code.

## Browser limitations

- **Bluetooth:** Localdrop uses direct WebRTC over the shared Wi‑Fi/hotspot. Browser Bluetooth support is missing or restricted on several target platforms, especially iOS Safari, so Bluetooth is not used.
- **Backgrounding:** Keep the page open in the foreground during a transfer. Where supported, Localdrop requests a screen wake lock while transferring and re-acquires it when the page becomes visible. Mobile browsers can still pause or terminate a background page, so uninterrupted background transfer cannot be guaranteed.
- **Progress:** Each file shows its current stage, bytes, percentage, speed, and estimated time. The sender shows **Preparing** while hashing the file before transfer begins.
- **File size and memory:** A transfer is capped at 1 GiB. Hashing reads the source file into memory, and the receiver holds the file until it can offer a download. A device may run out of memory before that cap, especially with large files on phones.
- **Reliability:** The connection is encrypted and ordered. If a device leaves the hotspot, the browser closes, or the connection drops, the current file must be sent again; automatic resume is not supported.

WebRTC encrypts the link with DTLS. File chunks are also encrypted with AES-GCM using a key derived from an ephemeral P-256 ECDH exchange, then checked against a SHA-256 digest. Compare the verification phrase on both devices to detect a substituted pairing code. Share pairing codes only with the intended device.

## Run locally

```sh
python3 serve.py --https
```

The app is static. Python serves only the app files; it does not relay or store transfers. HTTPS is needed for camera access and Web Crypto on phones. `http://localhost:8080` can be used for desktop testing.

## Project layout

- `index.html`, `css/styles.css`: responsive interface
- `js/app.js`: pairing, wake lock, and UI orchestration
- `js/crypto.js`: ECDH, AES-GCM, and SHA-256
- `js/webrtc.js`: direct local-network data channel
- `js/file-streamer.js`: encrypted file chunks and integrity checks
- `js/sdp-compress.js`, `js/qr-codec.js`: QR and copy/paste pairing
- `sw.js`: offline app-shell cache
- `serve.py`: local static development server

No build step or external runtime dependency is required.
