/**
 * Universal Share - High Performance File Streaming Engine
 * Handles chunking, backpressure-aware transmission, E2E chunk encryption,
 * SHA-256 integrity verification, and cross-platform file saving.
 */

class FileStreamer {
  constructor(webrtc, crypto) {
    this.webrtc = webrtc;
    this.crypto = crypto;

    this.CHUNK_SIZE = 64 * 1024; // 64 KB optimal SCTP chunk size
    this.currentFileId = 1;
    this.sendingQueue = [];
    this.isSending = false;

    // Active incoming transfers: fileId -> { meta, chunks, receivedBytes, startTime, sha256 }
    this.incomingTransfers = new Map();

    // Callbacks for UI updates
    this.onTransferStart = () => {};
    this.onTransferProgress = () => {};
    this.onTransferComplete = () => {};
    this.onTransferError = () => {};
    this.onClipboardReceived = () => {};
  }

  /**
   * Dispatches incoming DataChannel messages.
   * @param {ArrayBuffer|string} rawData 
   */
  async handleMessage(rawData) {
    if (typeof rawData === 'string') {
      try {
        const msg = JSON.parse(rawData);
        await this._handleControlMessage(msg);
      } catch (err) {
        console.error('Failed to parse control message:', err);
      }
    } else if (rawData instanceof ArrayBuffer) {
      await this._handleBinaryChunk(rawData);
    }
  }

  /**
   * Processes control packets (FILE_HEADER, ACK, CANCEL, CLIPBOARD).
   * @private
   */
  async _handleControlMessage(msg) {
    switch (msg.type) {
      case 'FILE_HEADER':
        this._initIncomingFile(msg);
        break;

      case 'FILE_COMPLETE_CONFIRM':
        // Sender confirmed transmission complete
        this._finalizeIncomingFile(msg.fileId);
        break;

      case 'FILE_CANCEL':
        this._handleCancel(msg.fileId);
        break;

      case 'CLIPBOARD':
        this.onClipboardReceived(msg.text);
        break;

      default:
        console.warn('Unknown control message:', msg);
    }
  }

  /**
   * Prepares to receive a file described by FILE_HEADER.
   * @private
   */
  _initIncomingFile(meta) {
    const maxTransferBytes = 1024 * 1024 * 1024;
    if (!Number.isSafeInteger(meta.fileId) || meta.fileId < 1 ||
        !Number.isSafeInteger(meta.size) || meta.size < 0 || meta.size > maxTransferBytes ||
        !Number.isSafeInteger(meta.totalChunks) || meta.totalChunks < 1 || meta.totalChunks > 16384 ||
        meta.totalChunks !== (Math.ceil(meta.size / this.CHUNK_SIZE) || 1) ||
        typeof meta.name !== 'string' || meta.name.length === 0 || meta.name.length > 255 ||
        typeof meta.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(meta.sha256)) {
      this.onTransferError({ fileId: meta.fileId, error: 'Peer sent invalid file details.' });
      return;
    }
    if (this.incomingTransfers.has(meta.fileId)) {
      this.onTransferError({ fileId: meta.fileId, error: 'Duplicate file transfer was rejected.' });
      return;
    }
    const transfer = {
      fileId: meta.fileId,
      name: meta.name,
      size: meta.size,
      mimeType: meta.mimeType || 'application/octet-stream',
      totalChunks: meta.totalChunks,
      expectedSha256: meta.sha256,
      relativePath: meta.relativePath || meta.name,
      receivedBytes: 0,
      receivedChunks: 0,
      chunks: new Array(meta.totalChunks),
      startTime: performance.now(),
      lastSpeedTime: performance.now(),
      lastSpeedBytes: 0,
      speedBps: 0
    };

    this.incomingTransfers.set(meta.fileId, transfer);
    this.onTransferStart({ direction: 'receive', ...transfer, totalBytes: meta.size, stage: 'Receiving' });
  }

  /**
   * Processes an incoming encrypted chunk packet.
   * Binary packet format:
   * [1 byte: 0x02 TAG]
   * [4 bytes: uint32 fileId]
   * [4 bytes: uint32 chunkIndex]
   * [N bytes: AES-GCM Encrypted chunk (12B IV + ciphertext + 16B tag)]
   * @private
   */
  async _handleBinaryChunk(arrayBuffer) {
    if (arrayBuffer.byteLength < 9) return;
    const view = new DataView(arrayBuffer);
    const tag = view.getUint8(0);
    if (tag !== 0x02) return; // Not a chunk packet

    const fileId = view.getUint32(1, false);
    const chunkIndex = view.getUint32(5, false);
    const encryptedData = new Uint8Array(arrayBuffer, 9);

    const transfer = this.incomingTransfers.get(fileId);
    if (!transfer) return;
    if (chunkIndex >= transfer.totalChunks || transfer.chunks[chunkIndex]) {
      this.incomingTransfers.delete(fileId);
      this.onTransferError({ fileId, error: 'Invalid or repeated file data was rejected.' });
      return;
    }

    // Decrypt chunk with E2EE key
    let decryptedChunk;
    try {
      decryptedChunk = await this.crypto.decryptChunk(encryptedData);
    } catch (err) {
      console.error(`Decryption failed on chunk ${chunkIndex}:`, err);
      this.incomingTransfers.delete(fileId);
      this.onTransferError({ fileId, error: 'Decryption failed: integrity compromised.' });
      return;
    }

    transfer.chunks[chunkIndex] = new Uint8Array(decryptedChunk);
    transfer.receivedBytes += decryptedChunk.byteLength;
    transfer.receivedChunks++;

    // Calculate real-time throughput & ETA
    const now = performance.now();
    const timeDiff = (now - transfer.lastSpeedTime) / 1000;
    if (timeDiff >= 0.5) {
      const bytesDiff = transfer.receivedBytes - transfer.lastSpeedBytes;
      transfer.speedBps = bytesDiff / timeDiff;
      transfer.lastSpeedTime = now;
      transfer.lastSpeedBytes = transfer.receivedBytes;
    }

    const progress = transfer.size === 0 ? 100 : Math.min(100, (transfer.receivedBytes / transfer.size) * 100);
    const remainingBytes = transfer.size - transfer.receivedBytes;
    const etaSeconds = transfer.speedBps > 0 ? Math.ceil(remainingBytes / transfer.speedBps) : 0;

    this.onTransferProgress({
      direction: 'receive',
      fileId,
      name: transfer.name,
      receivedBytes: transfer.receivedBytes,
      totalBytes: transfer.size,
      progress,
      speedBps: transfer.speedBps,
      etaSeconds
    });

    if (transfer.receivedChunks >= transfer.totalChunks) {
      await this._finalizeIncomingFile(fileId);
    }
  }

  /**
   * Reassembles chunks, verifies SHA-256 integrity, and generates downloadable Blob.
   * @private
   */
  async _finalizeIncomingFile(fileId) {
    const transfer = this.incomingTransfers.get(fileId);
    if (!transfer || transfer.completed) return;
    transfer.completed = true;

    // Reconstruct full Blob
    const blob = new Blob(transfer.chunks, { type: transfer.mimeType });
    const computedSha256 = await UniCrypto.sha256(blob);

    const verified = (computedSha256 === transfer.expectedSha256);

    // Free individual chunk array buffers
    transfer.chunks = null;

    if (!verified) {
      this.incomingTransfers.delete(fileId);
      this.onTransferError({ fileId, error: 'File integrity check failed. The received file was discarded.' });
      return;
    }

    const result = {
      direction: 'receive',
      fileId,
      name: transfer.name,
      size: transfer.size,
      mimeType: transfer.mimeType,
      blob,
      url: URL.createObjectURL(blob),
      sha256: computedSha256,
      verified,
      totalTimeMs: performance.now() - transfer.startTime
    };

    this.incomingTransfers.delete(fileId);
    this.onTransferComplete(result);
  }

  /**
   * Queues and sends files or directories.
   * @param {FileList|File[]|File} files 
   */
  async sendFiles(files) {
    const fileList = Array.from(files instanceof FileList ? files : (Array.isArray(files) ? files : [files]));
    for (const file of fileList) {
      this.sendingQueue.push(file);
    }

    if (!this.isSending) {
      this._processSendQueue();
    }
  }

  /**
   * Iterates through the file send queue.
   * @private
   */
  async _processSendQueue() {
    if (this.sendingQueue.length === 0) {
      this.isSending = false;
      return;
    }

    this.isSending = true;
    const file = this.sendingQueue.shift();

    try {
      await this._sendFile(file);
    } catch (err) {
      console.error('Failed to send file:', err);
      this.onTransferError({ name: file.name, error: err.message });
    }

    // Continue to next file
    this._processSendQueue();
  }

  /**
   * Streams a single file in 64KB chunks with E2EE encryption & flow control.
   * @private
   */
  async _sendFile(file) {
    if (file.size > 1024 * 1024 * 1024) {
      throw new Error('This browser app supports files up to 1 GiB per transfer.');
    }
    const fileId = this.currentFileId++;
    const totalChunks = Math.ceil(file.size / this.CHUNK_SIZE) || 1;

    this.onTransferStart({
      direction: 'send', fileId, name: file.name, size: file.size,
      totalBytes: file.size, totalChunks, stage: 'Preparing'
    });

    // Compute SHA-256 digest upfront. This may take time for large files.
    const sha256 = await UniCrypto.sha256(file);

    // Send FILE_HEADER
    const header = {
      type: 'FILE_HEADER',
      fileId,
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      relativePath: file.webkitRelativePath || file.name,
      totalChunks,
      sha256
    };

    await this.webrtc.send(JSON.stringify(header));

    let sentBytes = 0;
    let lastSpeedTime = performance.now();
    let lastSpeedBytes = 0;
    let speedBps = 0;

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * this.CHUNK_SIZE;
      const end = Math.min(start + this.CHUNK_SIZE, file.size);
      const slice = file.slice(start, end);
      const arrayBuffer = await slice.arrayBuffer();

      // Encrypt chunk using AES-GCM-256
      const encryptedPayload = await this.crypto.encryptChunk(arrayBuffer);

      // Construct binary packet: [0x02 TAG (1B)][fileId (4B)][chunkIndex (4B)][EncryptedPayload]
      const packet = new Uint8Array(9 + encryptedPayload.byteLength);
      const view = new DataView(packet.buffer);
      view.setUint8(0, 0x02);
      view.setUint32(1, fileId, false);
      view.setUint32(5, chunkIndex, false);
      packet.set(encryptedPayload, 9);

      // Send via WebRTC with active backpressure control
      await this.webrtc.send(packet.buffer);

      sentBytes += arrayBuffer.byteLength;

      // Speed & ETA calculations
      const now = performance.now();
      const timeDiff = (now - lastSpeedTime) / 1000;
      if (timeDiff >= 0.5) {
        speedBps = (sentBytes - lastSpeedBytes) / timeDiff;
        lastSpeedTime = now;
        lastSpeedBytes = sentBytes;
      }

      const progress = file.size === 0 ? 100 : Math.min(100, (sentBytes / file.size) * 100);
      const remainingBytes = file.size - sentBytes;
      const etaSeconds = speedBps > 0 ? Math.ceil(remainingBytes / speedBps) : 0;

      this.onTransferProgress({
        direction: 'send',
        fileId,
        name: file.name,
        sentBytes,
        totalBytes: file.size,
        progress,
        speedBps,
        etaSeconds,
        stage: 'Sending'
      });
    }

    // Confirm completion
    await this.webrtc.send(JSON.stringify({
      type: 'FILE_COMPLETE_CONFIRM',
      fileId
    }));

    this.onTransferComplete({
      direction: 'send',
      fileId,
      name: file.name,
      size: file.size,
      sha256
    });
  }

  /**
   * Sends instant clipboard text snippet to peer.
   * @param {string} text 
   */
  async sendClipboard(text) {
    const msg = {
      type: 'CLIPBOARD',
      text
    };
    await this.webrtc.send(JSON.stringify(msg));
  }

  _handleCancel(fileId) {
    if (this.incomingTransfers.has(fileId)) {
      this.incomingTransfers.delete(fileId);
      this.onTransferError({ fileId, error: 'Transfer cancelled by sender.' });
    }
  }
}

if (typeof window !== 'undefined') {
  window.FileStreamer = FileStreamer;
}
