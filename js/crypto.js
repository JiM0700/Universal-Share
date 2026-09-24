/**
 * Universal Share - Cryptography Engine
 * 100% Zero-Knowledge End-to-End Encryption (E2EE)
 * Using Web Crypto API: ECDH (P-256) Key Exchange + AES-GCM-256 Chunk Encryption + SHA-256
 */

class UniCrypto {
  constructor() {
    this.keyPair = null;
    this.peerPublicKey = null;
    this.sharedSecret = null;
    this.aesKey = null;
    this.sasCode = null;
    this.sasEmoji = null;
  }

  /**
   * Generates an ephemeral ECDH keypair using curve P-256.
   * Keys exist solely in browser memory and are discarded when session closes.
   */
  async generateKeyPair() {
    this.keyPair = await window.crypto.subtle.generateKey(
      {
        name: 'ECDH',
        namedCurve: 'P-256'
      },
      true, // extractable for exporting raw public key
      ['deriveKey', 'deriveBits']
    );
    return this.keyPair;
  }

  /**
   * Exports the local public key as a raw Uint8Array (65 bytes uncompressed P-256 point).
   */
  async exportPublicKey() {
    if (!this.keyPair) await this.generateKeyPair();
    const raw = await window.crypto.subtle.exportKey('raw', this.keyPair.publicKey);
    return new Uint8Array(raw);
  }

  /**
   * Imports the remote peer's raw public key and computes the shared AES-GCM-256 key.
   * Also computes the 6-digit Short Authentication String (SAS) for visual MITM verification.
   * @param {Uint8Array} peerRawKey 
   */
  async establishSharedKey(peerRawKey) {
    if (!this.keyPair) await this.generateKeyPair();

    // Import peer public key
    this.peerPublicKey = await window.crypto.subtle.importKey(
      'raw',
      peerRawKey,
      {
        name: 'ECDH',
        namedCurve: 'P-256'
      },
      false,
      []
    );

    // Derive 256-bit AES-GCM symmetric key
    this.aesKey = await window.crypto.subtle.deriveKey(
      {
        name: 'ECDH',
        public: this.peerPublicKey
      },
      this.keyPair.privateKey,
      {
        name: 'AES-GCM',
        length: 256
      },
      false,
      ['encrypt', 'decrypt']
    );

    // Derive bits for SAS (Short Authentication String)
    const derivedBits = await window.crypto.subtle.deriveBits(
      {
        name: 'ECDH',
        public: this.peerPublicKey
      },
      this.keyPair.privateKey,
      256
    );

    this._computeSas(new Uint8Array(derivedBits));
    return {
      sasCode: this.sasCode,
      sasEmoji: this.sasEmoji
    };
  }

  /**
   * Computes a 6-digit numeric verification code and a 6-emoji phrase
   * from the derived shared secret for visual comparison.
   * @private
   */
  _computeSas(bits) {
    // Generate 6-digit numeric code
    const view = new DataView(bits.buffer, bits.byteOffset, bits.byteLength);
    const num = view.getUint32(0, false) % 1000000;
    this.sasCode = num.toString().padStart(6, '0');

    // Generate 4 emoji icons
    const emojiList = [
      '⚡', '🚀', '🔒', '🛡️', '🌟', '💎', '🔑', '🦊',
      '🐬', '🔥', '🌈', '🛸', '🎯', '🍀', '🍕', '🛰️'
    ];
    const e1 = emojiList[bits[4] % emojiList.length];
    const e2 = emojiList[bits[5] % emojiList.length];
    const e3 = emojiList[bits[6] % emojiList.length];
    const e4 = emojiList[bits[7] % emojiList.length];
    const e5 = emojiList[bits[8] % emojiList.length];
    const e6 = emojiList[bits[9] % emojiList.length];
    this.sasEmoji = `${e1} ${e2} ${e3} ${e4} ${e5} ${e6}`;
  }

  /**
   * Encrypts a binary chunk with AES-GCM-256.
   * Prepends a cryptographically secure random 12-byte IV to the ciphertext.
   * Returns: [12 bytes IV] + [Ciphertext + 16 bytes auth tag]
   * @param {ArrayBuffer|Uint8Array} plaintextBuffer
   * @returns {Promise<Uint8Array>}
   */
  async encryptChunk(plaintextBuffer) {
    if (!this.aesKey) {
      throw new Error('E2EE AES Key not established yet.');
    }

    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await window.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv,
        tagLength: 128
      },
      this.aesKey,
      plaintextBuffer
    );

    const result = new Uint8Array(iv.length + ciphertext.byteLength);
    result.set(iv, 0);
    result.set(new Uint8Array(ciphertext), iv.length);
    return result;
  }

  /**
   * Decrypts an encrypted binary chunk.
   * Reads 12-byte IV from the front and decrypts the remaining payload.
   * @param {Uint8Array} encryptedBuffer
   * @returns {Promise<ArrayBuffer>}
   */
  async decryptChunk(encryptedBuffer) {
    if (!this.aesKey) {
      throw new Error('E2EE AES Key not established yet.');
    }

    if (encryptedBuffer.byteLength < 28) { // 12 bytes IV + min 16 bytes tag
      throw new Error('Malformed encrypted chunk: too short.');
    }

    const iv = encryptedBuffer.subarray(0, 12);
    const ciphertext = encryptedBuffer.subarray(12);

    const decrypted = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv,
        tagLength: 128
      },
      this.aesKey,
      ciphertext
    );

    return decrypted;
  }

  /**
   * Computes SHA-256 checksum of an ArrayBuffer or Blob.
   * @param {ArrayBuffer|Blob} data
   * @returns {Promise<string>} Hex string
   */
  static async sha256(data) {
    let buffer;
    if (data instanceof Blob) {
      buffer = await data.arrayBuffer();
    } else if (data instanceof Uint8Array) {
      buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    } else {
      buffer = data;
    }

    const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

// Export for ES or global browser scope
if (typeof window !== 'undefined') {
  window.UniCrypto = UniCrypto;
}
