/**
 * Universal Share - Main Application Orchestrator
 * Connects Crypto, WebRTC, QR Signaling, Streaming, and UI.
 */

class UniShareApp {
  constructor() {
    this.crypto = new UniCrypto();
    this.webrtc = new UniWebRTC();
    this.streamer = new FileStreamer(this.webrtc, this.crypto);
    this.ui = new UniUI();
    this.scanner = null;

    this.pairingRole = null; // 'initiator' | 'receiver'
    this.localPublicKeyRaw = null;
    this.transferWakeLock = null;
    this.transferActive = false;

    this.init();
  }

  async init() {
    try {
      // 1. Initialize Crypto Engine
      await this.crypto.generateKeyPair();
      this.localPublicKeyRaw = await this.crypto.exportPublicKey();

      // 2. Setup WebRTC & Streamer Event Listeners
      this._bindWebRtcEvents();
      this._bindStreamerEvents();
      this._bindUiEvents();

      // 3. Register Service Worker for Offline PWA
      this._registerServiceWorker();

      // 4. Initial UI State
      this.ui.setConnectionState('disconnected');
    } catch (err) {
      console.error('Initialization error:', err);
      this.ui.showToast('Initialization failed: ' + err.message, 'error');
    }
  }

  _bindWebRtcEvents() {
    this.webrtc.onConnectionState = (state) => {
      console.log('WebRTC Connection State:', state);
      if (state === 'connected') {
        this.ui.setConnectionState('connected');
        this.ui.closeModal(this.ui.elements.pairingModal);
        this._stopCamera();
        this.ui.showToast('Secure direct P2P link established!', 'success');
        if (this.crypto.sasCode) {
          this.ui.showSecurityFingerprint(this.crypto.sasCode, this.crypto.sasEmoji);
        }
      } else if (state === 'connecting') {
        this.ui.setConnectionState('connecting');
      } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        const wasConnected = this.webrtc.connected;
        this.ui.setConnectionState('disconnected');
        if (wasConnected) {
          this.ui.showToast('Connection closed or disconnected', 'warning');
        }
      }
    };

    this.webrtc.onDataChannelOpen = () => {
      console.log('DataChannel opened successfully');
      this.ui.setConnectionState('connected');
    };

    this.webrtc.onDataChannelClose = () => {
      this.ui.setConnectionState('disconnected');
    };

    this.webrtc.onMessage = (data) => {
      this.streamer.handleMessage(data);
    };

    this.webrtc.onError = (err) => {
      this.ui.showToast('Transfer error: ' + err.message, 'error');
    };
  }

  _bindStreamerEvents() {
    this.streamer.onTransferStart = (data) => {
      this._setTransferActive(true);
      this.ui.showToast(`${data.direction === 'send' ? 'Sending' : 'Receiving'} "${data.name}"`, 'info');
      this.ui.updateTransferProgress({ ...data, progress: 0 });
    };

    this.streamer.onTransferProgress = (data) => {
      this.ui.updateTransferProgress(data);
    };

    this.streamer.onTransferComplete = (data) => {
      this.ui.completeTransfer(data);
      this.ui.showToast(`Completed "${data.name}"`, 'success');
      setTimeout(() => this._syncTransferActivity(), 0);
    };

    this.streamer.onTransferError = (err) => {
      this.ui.showToast(err.error || 'Transfer failed', 'error');
      setTimeout(() => this._syncTransferActivity(), 0);
    };

    this.streamer.onClipboardReceived = (text) => {
      this.ui.showToast('Received text snippet!', 'info');
      navigator.clipboard.writeText(text).then(() => {
        this.ui.showToast('Copied incoming text to clipboard', 'success');
      }).catch(() => {});
      // Also show prompt or display
      prompt('Incoming text from peer:', text);
    };
  }

  _syncTransferActivity() {
    const active = this.streamer.isSending || this.streamer.incomingTransfers.size > 0;
    this._setTransferActive(active);
  }

  _setTransferActive(active) {
    this.transferActive = active;
    const notice = document.getElementById('background-note');
    if (notice) notice.classList.toggle('hidden', !active);
    if (!active) {
      if (this.transferWakeLock) {
        this.transferWakeLock.release().catch(() => {});
        this.transferWakeLock = null;
      }
      return;
    }
    if (!document.hidden && navigator.wakeLock && !this.transferWakeLock) {
      navigator.wakeLock.request('screen').then(lock => {
        if (!this.transferActive || document.hidden) {
          lock.release().catch(() => {});
          return;
        }
        this.transferWakeLock = lock;
        lock.addEventListener('release', () => {
          if (this.transferWakeLock === lock) this.transferWakeLock = null;
        }, { once: true });
      }).catch(() => {});
    }
  }

  _bindUiEvents() {
    const el = this.ui.elements;

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.transferWakeLock) {
          this.transferWakeLock.release().catch(() => {});
          this.transferWakeLock = null;
        }
      } else if (this.transferActive) {
        this._setTransferActive(true);
      }
    });

    // Connect Device / Pair Button
    el.btnPairDevice.addEventListener('click', () => {
      this.startPairingWorkflow();
    });

    el.btnCloseModal.addEventListener('click', () => {
      this.ui.closeModal(el.pairingModal);
      this._stopCamera();
    });

    // Pairing Modal Tabs (QR vs Manual)
    el.tabQr.addEventListener('click', () => {
      el.tabQr.classList.add('tab-active');
      el.tabManual.classList.remove('tab-active');
      el.panelQr.classList.remove('hidden');
      el.panelManual.classList.add('hidden');
    });

    el.tabManual.addEventListener('click', () => {
      el.tabManual.classList.add('tab-active');
      el.tabQr.classList.remove('tab-active');
      el.panelManual.classList.remove('hidden');
      el.panelQr.classList.add('hidden');
    });

    // Camera scanner controls
    el.btnStartScan.addEventListener('click', () => {
      this._startCamera();
    });

    el.btnStopScan.addEventListener('click', () => {
      this._stopCamera();
    });

    el.btnFlipCamera.addEventListener('click', async () => {
      if (this.scanner) {
        await this.scanner.toggleCamera();
      }
    });

    // Manual copy/paste code
    el.btnCopyCode.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(el.manualCodeOut.value);
        this.ui.showToast('Copied code to clipboard!', 'success');
      } catch (e) {
        el.manualCodeOut.select();
        document.execCommand('copy');
        this.ui.showToast('Copied code!', 'success');
      }
    });

    el.btnApplyCode.addEventListener('click', async () => {
      const inputCode = el.manualCodeIn.value.trim();
      if (!inputCode) {
        this.ui.showToast('Please paste a valid connection code', 'warning');
        return;
      }
      await this.processIncomingSignalingPayload(inputCode);
    });

    // File Drag & Drop
    const dropzone = el.dropzone;
    ['dragenter', 'dragover'].forEach(name => {
      dropzone.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('dropzone-active');
      });
    });

    ['dragleave', 'drop'].forEach(name => {
      dropzone.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('dropzone-active');
      });
    });

    dropzone.addEventListener('drop', (e) => {
      if (!this.webrtc.connected) {
        this.ui.showToast('Connect a device first to send files', 'warning');
        return;
      }
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        this.streamer.sendFiles(e.dataTransfer.files);
      }
    });

    // File / Folder selection buttons
    el.btnSelectFiles.addEventListener('click', () => {
      if (!this.webrtc.connected) {
        this.ui.showToast('Connect a device first to send files', 'warning');
        return;
      }
      el.fileInput.click();
    });

    el.btnSelectFolder.addEventListener('click', () => {
      if (!this.webrtc.connected) {
        this.ui.showToast('Connect a device first to send files', 'warning');
        return;
      }
      el.folderInput.click();
    });

    el.fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        this.streamer.sendFiles(e.target.files);
        e.target.value = ''; // Reset
      }
    });

    el.folderInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        this.streamer.sendFiles(e.target.files);
        e.target.value = '';
      }
    });

    // Instant Text / Clipboard share
    el.btnSendText.addEventListener('click', () => {
      const text = el.textShareInput.value.trim();
      if (!text) return;
      if (!this.webrtc.connected) {
        this.ui.showToast('Connect a device first to send text', 'warning');
        return;
      }
      this.streamer.sendClipboard(text);
      el.textShareInput.value = '';
      this.ui.showToast('Sent text to peer', 'success');
    });
  }

  /**
   * Begins pairing workflow: generates WebRTC offer with all local ICE candidates,
   * compresses it with local ECDH public key, and renders QR code.
   */
  async startPairingWorkflow() {
    this.pairingRole = 'initiator';
    this.ui.openModal(this.ui.elements.pairingModal);
    this.ui.elements.qrInstructions.textContent = 'Generating local pairing session...';

    try {
      await this.crypto.generateKeyPair();
      this.localPublicKeyRaw = await this.crypto.exportPublicKey();
      const offer = await this.webrtc.createOffer();

      const payload = {
        type: 'offer',
        sdp: SdpCompressor.minifySdp(offer.sdp),
        key: Array.from(this.localPublicKeyRaw)
      };

      const compressedToken = await SdpCompressor.compress(payload);

      // Populate manual code first so it is guaranteed to be available
      this.ui.elements.manualCodeOut.value = compressedToken;

      // Render QR Code onto canvas with graceful fallback
      try {
        QRGenerator.render(this.ui.elements.qrCanvas, compressedToken, {
          size: 260,
          errorCorrection: 'L',
          darkColor: '#0f172a'
        });
        this.ui.elements.qrInstructions.innerHTML = `
          <strong>Step 1:</strong> Scan this code with your phone.<br/>
          <strong>Step 2:</strong> When your phone displays its Answer, click <em>"📷 Open Camera Scanner"</em> below to scan it, or paste it in <em>"Manual Code"</em>.
        `;
      } catch (qrErr) {
        console.warn('QR render error, falling back to manual code:', qrErr);
        this.ui.elements.qrInstructions.innerHTML = `
          <strong>Connection code ready!</strong><br/>
          Switch to the <em>"Manual Code"</em> tab above to copy and share your code.
        `;
      }
    } catch (err) {
      console.error('Failed to create offer:', err);
      this.ui.showToast('Failed to start pairing: ' + err.message, 'error');
    }
  }

  /**
   * Processes an incoming signaling payload scanned from QR or pasted manually.
   * Handles both Offer (creates Answer) and Answer (establishes P2P).
   * @param {string} token 
   */
  async processIncomingSignalingPayload(token) {
    try {
      this.ui.showToast('Processing connection payload...', 'info');
      const payload = await SdpCompressor.decompress(token);

      if (!payload || !payload.type || !payload.sdp) {
        throw new Error('Invalid signaling payload content');
      }

      const peerRawKey = new Uint8Array(payload.key);

      if (payload.type === 'offer') {
        // We are the receiver
        this.pairingRole = 'receiver';
        this._stopCamera();

        await this.crypto.generateKeyPair();
        this.localPublicKeyRaw = await this.crypto.exportPublicKey();

        // Establish E2EE Shared Key
        const { sasCode, sasEmoji } = await this.crypto.establishSharedKey(peerRawKey);
        this.ui.showSecurityFingerprint(sasCode, sasEmoji);

        // Generate Answer
        this.ui.elements.qrInstructions.textContent = 'Generating answer...';
        const answer = await this.webrtc.handleOfferAndCreateAnswer({
          type: 'offer',
          sdp: payload.sdp
        });

        const answerPayload = {
          type: 'answer',
          sdp: SdpCompressor.minifySdp(answer.sdp),
          key: Array.from(this.localPublicKeyRaw)
        };

        const compressedAnswer = await SdpCompressor.compress(answerPayload);

        // Populate manual code first
        this.ui.elements.manualCodeOut.value = compressedAnswer;

        // Render Answer QR with graceful fallback
        try {
          QRGenerator.render(this.ui.elements.qrCanvas, compressedAnswer, {
            size: 260,
            errorCorrection: 'L',
            darkColor: '#0f172a'
          });
          this.ui.elements.qrInstructions.innerHTML = `
            <strong>Step 2:</strong> Scan this Answer QR code with your original device (Mac) to finalize the link! Or copy the code in <em>"Manual Code"</em>.
          `;
        } catch (qrErr) {
          console.warn('Answer QR render error, falling back to manual code:', qrErr);
          this.ui.elements.qrInstructions.innerHTML = `
            <strong>Answer code ready!</strong><br/>
            Switch to the <em>"Manual Code"</em> tab above to copy and share your answer code.
          `;
        }
        this.ui.showToast('Offer accepted! Now scan this Answer on Mac', 'success');

      } else if (payload.type === 'answer') {
        // We are initiator, receiving Answer
        this._stopCamera();

        // Establish E2EE Shared Key
        const { sasCode, sasEmoji } = await this.crypto.establishSharedKey(peerRawKey);
        this.ui.showSecurityFingerprint(sasCode, sasEmoji);

        await this.webrtc.handleAnswer({
          type: 'answer',
          sdp: payload.sdp
        });

        this.ui.showToast('Answer registered! Establishing direct P2P link...', 'success');
      }
    } catch (err) {
      console.error('Error processing signaling payload:', err);
      this.ui.showToast('Failed to parse code: ' + err.message, 'error');
    }
  }

  async _startCamera() {
    try {
      this.ui.elements.scannerContainer.classList.remove('hidden');
      if (!this.scanner) {
        this.scanner = new QRScanner(this.ui.elements.scannerVideo, (scannedText) => {
          this.processIncomingSignalingPayload(scannedText);
        });
      }
      await this.scanner.start();
    } catch (err) {
      this.ui.showToast('Camera access denied or unavailable: ' + err.message, 'error');
      this.ui.elements.scannerContainer.classList.add('hidden');
    }
  }

  _stopCamera() {
    if (this.scanner) {
      this.scanner.stop();
    }
    if (this.ui.elements.scannerContainer) {
      this.ui.elements.scannerContainer.classList.add('hidden');
    }
  }

  _registerServiceWorker() {
    if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost')) {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => {
          console.log('Universal Share Service Worker registered:', reg.scope);
          if (this.ui.elements.offlineBadge) {
            this.ui.elements.offlineBadge.classList.remove('hidden');
          }
        })
        .catch(err => {
          console.warn('Service Worker registration skipped/failed:', err);
        });
    }
  }
}

// Bootstrap on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new UniShareApp();
});
