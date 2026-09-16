/**
 * Universal Share - UI Controller & DOM Handler
 * Manages views, radar state, toasts, drag-and-drop, progress displays, and modals.
 */

class UniUI {
  constructor() {
    this.elements = {};
    this.initElements();
    this.initTheme();
  }

  initElements() {
    this.elements = {
      themeToggle: document.getElementById('theme-toggle'),
      connectionBadge: document.getElementById('connection-badge'),
      offlineBadge: document.getElementById('offline-badge'),
      radarStatus: document.getElementById('radar-status'),
      radarSubtitle: document.getElementById('radar-subtitle'),
      radarVisual: document.getElementById('radar-visual'),
      btnPairDevice: document.getElementById('btn-pair-device'),
      securityCard: document.getElementById('security-card'),
      sasCode: document.getElementById('sas-code'),
      sasEmoji: document.getElementById('sas-emoji'),

      // Dropzone & File selection
      dropzone: document.getElementById('dropzone'),
      fileInput: document.getElementById('file-input'),
      folderInput: document.getElementById('folder-input'),
      btnSelectFiles: document.getElementById('btn-select-files'),
      btnSelectFolder: document.getElementById('btn-select-folder'),

      // Clipboard / Text share
      textShareInput: document.getElementById('text-share-input'),
      btnSendText: document.getElementById('btn-send-text'),

      // Transfers & Lists
      transferSection: document.getElementById('transfer-section'),
      transferList: document.getElementById('transfer-list'),
      receivedSection: document.getElementById('received-section'),
      receivedList: document.getElementById('received-list'),

      // Modals & QR
      pairingModal: document.getElementById('pairing-modal'),
      btnCloseModal: document.getElementById('btn-close-modal'),
      tabQr: document.getElementById('tab-qr'),
      tabManual: document.getElementById('tab-manual'),
      panelQr: document.getElementById('panel-qr'),
      panelManual: document.getElementById('panel-manual'),

      qrCanvas: document.getElementById('qr-canvas'),
      qrInstructions: document.getElementById('qr-instructions'),
      btnStartScan: document.getElementById('btn-start-scan'),
      scannerContainer: document.getElementById('scanner-container'),
      scannerVideo: document.getElementById('scanner-video'),
      btnStopScan: document.getElementById('btn-stop-scan'),
      btnFlipCamera: document.getElementById('btn-flip-camera'),

      manualCodeOut: document.getElementById('manual-code-out'),
      btnCopyCode: document.getElementById('btn-copy-code'),
      manualCodeIn: document.getElementById('manual-code-in'),
      btnApplyCode: document.getElementById('btn-apply-code'),

      toastContainer: document.getElementById('toast-container')
    };
  }

  initTheme() {
    const savedTheme = localStorage.getItem('unishare-theme') || 
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', savedTheme);

    if (this.elements.themeToggle) {
      this.elements.themeToggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('unishare-theme', next);
      });
    }
  }

  showToast(message, type = 'info', duration = 3500) {
    if (!this.elements.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icon = type === 'success' ? '✓' : (type === 'error' ? '✕' : 'ℹ');
    toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-msg">${message}</span>`;

    this.elements.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-fade');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  setConnectionState(state, peerName = '') {
    if (!this.elements.connectionBadge) return;

    this.elements.connectionBadge.className = 'badge';
    if (state === 'connected') {
      this.elements.connectionBadge.classList.add('badge-success');
      this.elements.connectionBadge.innerHTML = `<span class="badge-dot"></span>Connected: ${peerName || 'Direct P2P'}`;
      this.elements.radarStatus.textContent = 'Device Connected & Ready';
      this.elements.radarSubtitle.textContent = 'Local encrypted channel established over Wi-Fi/Hotspot';
      this.elements.radarVisual.classList.add('radar-connected');
      this.elements.btnPairDevice.textContent = 'Connection Active';
      this.elements.btnPairDevice.classList.add('btn-disabled');
      this.elements.dropzone.classList.remove('dropzone-disabled');
    } else if (state === 'connecting') {
      this.elements.connectionBadge.classList.add('badge-warning');
      this.elements.connectionBadge.innerHTML = `<span class="badge-dot"></span>Negotiating Link...`;
      this.elements.radarStatus.textContent = 'Connecting Devices...';
      this.elements.radarSubtitle.textContent = 'Exchanging encryption keys and local network routes';
      this.elements.radarVisual.classList.remove('radar-connected');
      this.elements.dropzone.classList.add('dropzone-disabled');
    } else {
      this.elements.connectionBadge.classList.add('badge-secondary');
      this.elements.connectionBadge.innerHTML = `<span class="badge-dot"></span>Ready to Pair`;
      this.elements.radarStatus.textContent = 'No Device Connected';
      this.elements.radarSubtitle.textContent = 'Tap "Connect Device" to pair via QR code or local Wi-Fi';
      this.elements.radarVisual.classList.remove('radar-connected');
      this.elements.btnPairDevice.textContent = '⚡ Connect Device';
      this.elements.btnPairDevice.classList.remove('btn-disabled');
      this.elements.dropzone.classList.add('dropzone-disabled');
      this.hideSecurityFingerprint();
    }
  }

  showSecurityFingerprint(sasCode, sasEmoji) {
    if (this.elements.securityCard) {
      this.elements.securityCard.classList.remove('hidden');
      this.elements.sasCode.textContent = sasCode;
      this.elements.sasEmoji.textContent = sasEmoji;
    }
  }

  hideSecurityFingerprint() {
    if (this.elements.securityCard) {
      this.elements.securityCard.classList.add('hidden');
    }
  }

  openModal(modal) {
    if (modal) {
      modal.classList.add('modal-open');
    }
  }

  closeModal(modal) {
    if (modal) {
      modal.classList.remove('modal-open');
    }
  }

  updateTransferProgress(data) {
    this.elements.transferSection.classList.remove('hidden');
    let item = document.getElementById(`transfer-${data.fileId}`);

    if (!item) {
      item = document.createElement('div');
      item.id = `transfer-${data.fileId}`;
      item.className = 'transfer-card';
      item.innerHTML = `
        <div class="transfer-info">
          <div class="transfer-header">
            <span class="transfer-name font-medium">${this.escapeHtml(data.name)}</span>
            <span class="transfer-badge ${data.direction === 'send' ? 'badge-send' : 'badge-recv'}">
              ${data.direction === 'send' ? '↑ Sending' : '↓ Receiving'}
            </span>
          </div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width: 0%"></div>
          </div>
          <div class="transfer-meta text-muted">
            <span class="transfer-bytes">0 / ${this.formatBytes(data.totalBytes)}</span>
            <span class="transfer-speed">0 MB/s</span>
            <span class="transfer-eta">Calculating...</span>
          </div>
        </div>
      `;
      this.elements.transferList.prepend(item);
    }

    const fill = item.querySelector('.progress-bar-fill');
    const bytesSpan = item.querySelector('.transfer-bytes');
    const speedSpan = item.querySelector('.transfer-speed');
    const etaSpan = item.querySelector('.transfer-eta');

    const sent = data.sentBytes || data.receivedBytes || 0;
    fill.style.width = `${data.progress.toFixed(1)}%`;
    bytesSpan.textContent = `${this.formatBytes(sent)} / ${this.formatBytes(data.totalBytes)} (${data.progress.toFixed(0)}%)`;
    speedSpan.textContent = `${this.formatBytes(data.speedBps)}/s`;
    etaSpan.textContent = data.etaSeconds > 0 ? `${data.etaSeconds}s remaining` : 'Almost done';
  }

  completeTransfer(data) {
    const item = document.getElementById(`transfer-${data.fileId}`);
    if (item) {
      setTimeout(() => item.remove(), 1200);
    }

    if (data.direction === 'receive') {
      this.elements.receivedSection.classList.remove('hidden');
      const recvItem = document.createElement('div');
      recvItem.className = 'received-card';
      recvItem.innerHTML = `
        <div class="received-icon">${this.getFileIcon(data.name)}</div>
        <div class="received-details">
          <div class="received-title">${this.escapeHtml(data.name)}</div>
          <div class="received-meta text-muted">
            <span>${this.formatBytes(data.size)}</span>
            <span class="hash-tag" title="SHA-256 Checksum: ${data.sha256}">
              ${data.verified ? '✓ SHA-256 Verified' : '⚠ Hash mismatch'}
            </span>
          </div>
        </div>
        <div class="received-actions">
          <button class="btn btn-sm btn-primary btn-save">💾 Save</button>
          ${navigator.canShare ? '<button class="btn btn-sm btn-secondary btn-share">↗ Share</button>' : ''}
        </div>
      `;

      // Save button handler
      const btnSave = recvItem.querySelector('.btn-save');
      btnSave.addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = data.url;
        a.download = data.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        this.showToast(`Saved "${data.name}"`, 'success');
      });

      // Native Web Share sheet handler (iOS Safari / Android)
      const btnShare = recvItem.querySelector('.btn-share');
      if (btnShare) {
        btnShare.addEventListener('click', async () => {
          try {
            const file = new File([data.blob], data.name, { type: data.mimeType });
            if (navigator.canShare({ files: [file] })) {
              await navigator.share({
                files: [file],
                title: data.name
              });
            } else {
              this.showToast('Web Share not supported for this file type', 'warning');
            }
          } catch (err) {
            if (err.name !== 'AbortError') {
              this.showToast('Share failed: ' + err.message, 'error');
            }
          }
        });
      }

      this.elements.receivedList.prepend(recvItem);
    }
  }

  getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'heic'].includes(ext)) return '🖼️';
    if (['mp4', 'mov', 'mkv', 'webm', 'avi'].includes(ext)) return '🎬';
    if (['mp3', 'wav', 'flac', 'aac', 'm4a'].includes(ext)) return '🎵';
    if (['pdf', 'doc', 'docx', 'txt', 'rtf', 'md'].includes(ext)) return '📄';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '📦';
    return '📁';
  }

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  escapeHtml(str) {
    return str.replace(/[&<>'"]/g, 
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
  }
}

if (typeof window !== 'undefined') {
  window.UniUI = UniUI;
}
